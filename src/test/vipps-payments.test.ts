import { describe, expect, it } from 'vitest';
import { constantTimeEqual, vippsCapture, vippsConfirmAuthorized } from '../../supabase/functions/_shared/vipps-payments.ts';
import { vippsRefund } from '../../supabase/functions/_shared/refunds.ts';

type Call = { url: string; init?: any };

/** A fake fetch answering from a queue of [status, body] per URL suffix. */
function fakeFetch(routes: Record<string, Array<[number, unknown] | Error>>) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: any) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find(k => url.endsWith(k) && routes[k].length > 0);
    if (!key) throw new Error(`unexpected call ${init?.method ?? 'GET'} ${url}`);
    const next = routes[key].shift()!;
    if (next instanceof Error) throw next;
    const [status, body] = next;
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  return { fn, calls };
}

const api = { base: 'https://apitest.vipps.no', headers: { Authorization: 'Bearer t' } };
const ref = 'booking-b1-1';
const pay = (state: string, a: Record<string, number>) => ({
  state, pspReference: 'psp-1',
  aggregate: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, currency: 'NOK' }])),
});

describe('confirming a Vipps payment', () => {
  it('accepts only an AUTHORIZED reservation of the expected amount', async () => {
    const ok = fakeFetch({ [`/payments/${ref}`]: [[200, pay('AUTHORIZED', { authorizedAmount: 287500 })]] });
    expect((await vippsConfirmAuthorized(ok.fn, api, ref, 287500)).kind).toBe('authorized');
    expect(ok.calls[0].init.method).toBe('GET');

    const wrong = fakeFetch({ [`/payments/${ref}`]: [[200, pay('AUTHORIZED', { authorizedAmount: 100 })]] });
    expect((await vippsConfirmAuthorized(wrong.fn, api, ref, 287500)).kind).toBe('failed');

    const created = fakeFetch({ [`/payments/${ref}`]: [[200, pay('CREATED', { authorizedAmount: 0 })]] });
    expect((await vippsConfirmAuthorized(created.fn, api, ref, 287500)).kind).toBe('failed');

    const gone = fakeFetch({ [`/payments/${ref}`]: [[200, pay('AUTHORIZED', { authorizedAmount: 287500, cancelledAmount: 287500 })]] });
    expect((await vippsConfirmAuthorized(gone.fn, api, ref, 287500)).kind).toBe('failed');

    const down = fakeFetch({ [`/payments/${ref}`]: [[503, {}]] });
    expect((await vippsConfirmAuthorized(down.fn, api, ref, 287500)).kind).toBe('retry');
  });
});

describe('capturing on delivery', () => {
  const capArgs = { reference: ref, amountOre: 287500, idempotencyKey: 'flyttgo-capture-b1' };

  it('captures the amount with the idempotency key', async () => {
    const f = fakeFetch({
      [`/payments/${ref}`]:         [[200, pay('AUTHORIZED', { authorizedAmount: 287500 })]],
      [`/payments/${ref}/capture`]: [[200, pay('AUTHORIZED', { authorizedAmount: 287500, capturedAmount: 287500 })]],
    });
    expect(await vippsCapture(f.fn, api, capArgs)).toMatchObject({ kind: 'captured', capturedOre: 287500 });
    expect(f.calls[1].init.headers['Idempotency-Key']).toBe('flyttgo-capture-b1');
    expect(JSON.parse(f.calls[1].init.body)).toEqual({ modificationAmount: { currency: 'NOK', value: 287500 } });
  });

  it('does not capture twice', async () => {
    const f = fakeFetch({ [`/payments/${ref}`]: [[200, pay('AUTHORIZED', { authorizedAmount: 287500, capturedAmount: 287500 })]] });
    expect((await vippsCapture(f.fn, api, capArgs)).kind).toBe('captured');
    expect(f.calls).toHaveLength(1);
  });

  it('refuses an expired or cancelled reservation, retries outages', async () => {
    const exp = fakeFetch({ [`/payments/${ref}`]: [[200, pay('EXPIRED', { authorizedAmount: 287500 })]] });
    expect((await vippsCapture(exp.fn, api, capArgs)).kind).toBe('failed');
    const part = fakeFetch({ [`/payments/${ref}`]: [[200, pay('AUTHORIZED', { authorizedAmount: 287500, cancelledAmount: 287500 })]] });
    expect((await vippsCapture(part.fn, api, capArgs)).kind).toBe('failed');
    const down = fakeFetch({
      [`/payments/${ref}`]:         [[200, pay('AUTHORIZED', { authorizedAmount: 287500 })]],
      [`/payments/${ref}/capture`]: [[502, {}]],
    });
    expect((await vippsCapture(down.fn, api, capArgs)).kind).toBe('retry');
  });
});

describe('cancelling a reserved booking with a fee', () => {
  // 2875 NOK reserved; late cancellation keeps 50% (143750 øre), refunds 143750.
  const args = { reference: ref, amountOre: 143750, idempotencyKey: 'flyttgo-refund-r9', allowCaptureRest: true };

  it('captures the fee, then cancels the rest', async () => {
    const f = fakeFetch({
      [`/payments/${ref}`]:         [[200, pay('AUTHORIZED', { authorizedAmount: 287500 })],
                                     [200, pay('AUTHORIZED', { authorizedAmount: 287500 })]],
      [`/payments/${ref}/capture`]: [[200, pay('AUTHORIZED', { authorizedAmount: 287500, capturedAmount: 143750 })]],
      [`/payments/${ref}/cancel`]:  [[200, pay('TERMINATED', { authorizedAmount: 287500, capturedAmount: 143750, cancelledAmount: 143750 })]],
    });
    expect((await vippsRefund(f.fn, api, args)).kind).toBe('succeeded');
    const posts = f.calls.filter(c => c.init?.method === 'POST');
    expect(posts.map(c => c.url.split('/').pop())).toEqual(['capture', 'cancel']);
    expect(posts[0].init.headers['Idempotency-Key']).toBe('flyttgo-refund-r9-capture');
    expect(JSON.parse(posts[0].init.body)).toEqual({ modificationAmount: { currency: 'NOK', value: 143750 } });
  });

  it('after a capture that went through, a retry cancels and never refunds the fee', async () => {
    const f = fakeFetch({
      [`/payments/${ref}`]:        [[200, pay('AUTHORIZED', { authorizedAmount: 287500, capturedAmount: 143750 })]],
      [`/payments/${ref}/cancel`]: [[200, pay('TERMINATED', { authorizedAmount: 287500, capturedAmount: 143750, cancelledAmount: 143750 })]],
    });
    expect((await vippsRefund(f.fn, api, args)).kind).toBe('succeeded');
    expect(f.calls.some(c => c.url.endsWith('/refund'))).toBe(false);
  });

  it('a retry after both went through asks nothing', async () => {
    const f = fakeFetch({
      [`/payments/${ref}`]: [[200, pay('TERMINATED', { authorizedAmount: 287500, capturedAmount: 143750, cancelledAmount: 143750 })]],
    });
    expect((await vippsRefund(f.fn, api, args)).kind).toBe('succeeded');
    expect(f.calls).toHaveLength(1);
  });

  it('without allowCaptureRest a partial refund of a reservation is still refused', async () => {
    const f = fakeFetch({ [`/payments/${ref}`]: [[200, pay('AUTHORIZED', { authorizedAmount: 287500 })]] });
    expect((await vippsRefund(f.fn, api, { ...args, allowCaptureRest: false })).kind).toBe('failed');
  });
});

describe('webhook secret', () => {
  it('compares exactly', () => {
    expect(constantTimeEqual('Bearer abc', 'Bearer abc')).toBe(true);
    expect(constantTimeEqual('Bearer abc', 'Bearer abd')).toBe(false);
    expect(constantTimeEqual('Bearer abc', 'Bearer abcd')).toBe(false);
    expect(constantTimeEqual('', 'x')).toBe(false);
  });
});
