import { describe, expect, it, vi } from 'vitest';
import {
  mapStripeRefundStatus,
  processRefund,
  stripeRefund,
  vippsRefund,
  type RefundRow,
} from '../../supabase/functions/_shared/refunds.ts';

type Call = { url: string; init?: any };

/** A fake fetch answering from a queue of [status, body] per URL suffix. */
function fakeFetch(routes: Record<string, Array<[number, unknown] | Error>>) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: any) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find(k => url.endsWith(k) && (routes[k].length > 0));
    if (!key) throw new Error(`unexpected call ${init?.method ?? 'GET'} ${url}`);
    const next = routes[key].shift()!;
    if (next instanceof Error) throw next;
    const [status, body] = next;
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  return { fn, calls };
}

const stripeArgs = { paymentIntentId: 'pi_1', amountOre: 287500, idempotencyKey: 'flyttgo-refund-r1', refundId: 'r1', bookingId: 'b1' };

describe('Stripe refunds', () => {
  it('maps refund statuses', () => {
    expect(mapStripeRefundStatus('succeeded')).toBe('succeeded');
    expect(mapStripeRefundStatus('pending')).toBe('pending');
    expect(mapStripeRefundStatus('requires_action')).toBe('pending');
    expect(mapStripeRefundStatus('failed')).toBe('failed');
    expect(mapStripeRefundStatus('canceled')).toBe('failed');
  });

  it('sends the PaymentIntent, amount and idempotency key, and reports success', async () => {
    const f = fakeFetch({ '/v1/refunds': [[200, { id: 're_1', status: 'succeeded', amount: 287500 }]] });
    const out = await stripeRefund(f.fn, 'sk_test', stripeArgs);
    expect(out).toEqual({ kind: 'succeeded', providerRefundId: 're_1' });
    const sent = f.calls[0];
    expect(sent.init.headers['Idempotency-Key']).toBe('flyttgo-refund-r1');
    const body = new URLSearchParams(sent.init.body);
    expect(body.get('payment_intent')).toBe('pi_1');
    expect(body.get('amount')).toBe('287500');
    expect(body.get('metadata[refund_id]')).toBe('r1');
  });

  it('refunds a company\'s sale on its own account and gives back FlyttGo\'s share (white label, Model B)', async () => {
    const f = fakeFetch({ '/v1/refunds': [[200, { id: 're_2', status: 'succeeded', amount: 287500 }]] });
    await stripeRefund(f.fn, 'sk_test', { ...stripeArgs, stripeAccount: 'acct_1Acme' });
    expect(f.calls[0].init.headers['Stripe-Account']).toBe('acct_1Acme');
    expect(new URLSearchParams(f.calls[0].init.body).get('refund_application_fee')).toBe('true');
  });

  it('refunds FlyttGo\'s own sales without a connected account', async () => {
    const f = fakeFetch({ '/v1/refunds': [[200, { id: 're_3', status: 'succeeded', amount: 287500 }]] });
    await stripeRefund(f.fn, 'sk_test', stripeArgs);
    expect(f.calls[0].init.headers['Stripe-Account']).toBeUndefined();
    expect(new URLSearchParams(f.calls[0].init.body).get('refund_application_fee')).toBeNull();
  });

  it('reports pending refunds as pending', async () => {
    const f = fakeFetch({ '/v1/refunds': [[200, { id: 're_1', status: 'pending', amount: 287500 }]] });
    expect((await stripeRefund(f.fn, 'sk', stripeArgs)).kind).toBe('pending');
  });

  it('treats a 4xx as the provider refusing', async () => {
    const f = fakeFetch({ '/v1/refunds': [[400, { error: { code: 'charge_already_refunded', message: 'already refunded' } }]] });
    const out = await stripeRefund(f.fn, 'sk', stripeArgs);
    expect(out.kind).toBe('failed');
    expect((out as any).error).toMatch(/charge_already_refunded/);
  });

  it('retries on 5xx, 409, 429 and network errors (same key next time)', async () => {
    for (const answer of [[500, {}], [409, {}], [429, {}], new Error('ECONNRESET')] as const) {
      const f = fakeFetch({ '/v1/refunds': [answer as any] });
      expect((await stripeRefund(f.fn, 'sk', stripeArgs)).kind).toBe('retry');
    }
  });

  it('refuses a refund for a different amount than asked', async () => {
    const f = fakeFetch({ '/v1/refunds': [[200, { id: 're_1', status: 'succeeded', amount: 100 }]] });
    expect((await stripeRefund(f.fn, 'sk', stripeArgs)).kind).toBe('failed');
  });
});

const api = { base: 'https://apitest.vipps.no', headers: { Authorization: 'Bearer t' } };
const vippsArgs = { reference: 'booking-b1-1', amountOre: 100000, idempotencyKey: 'flyttgo-refund-r2' };
const agg = (a: Record<string, number>) => ({
  aggregate: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, currency: 'NOK' }])),
});

describe('Vipps refunds', () => {
  it('refunds a captured payment and verifies the refunded amount', async () => {
    const f = fakeFetch({
      '/payments/booking-b1-1':        [[200, agg({ authorizedAmount: 287500, capturedAmount: 287500, refundedAmount: 0, cancelledAmount: 0 })]],
      '/payments/booking-b1-1/refund': [[200, { pspReference: 'psp-9', ...agg({ refundedAmount: 100000 }) }]],
    });
    const out = await vippsRefund(f.fn, api, vippsArgs);
    expect(out).toEqual({ kind: 'succeeded', providerRefundId: 'psp-9' });
    const refundCall = f.calls[1];
    expect(refundCall.init.headers['Idempotency-Key']).toBe('flyttgo-refund-r2');
    expect(JSON.parse(refundCall.init.body)).toEqual({ modificationAmount: { currency: 'NOK', value: 100000 } });
  });

  it('does not ask again when an earlier attempt already refunded', async () => {
    const f = fakeFetch({
      '/payments/booking-b1-1': [[200, agg({ authorizedAmount: 287500, capturedAmount: 287500, refundedAmount: 100000 })]],
    });
    const out = await vippsRefund(f.fn, api, vippsArgs);
    expect(out.kind).toBe('succeeded');
    expect(f.calls).toHaveLength(1);
  });

  it('cancels an uncaptured reservation for a full refund', async () => {
    const f = fakeFetch({
      '/payments/booking-b1-1':        [[200, agg({ authorizedAmount: 100000, capturedAmount: 0, refundedAmount: 0, cancelledAmount: 0 })]],
      '/payments/booking-b1-1/cancel': [[200, { state: 'TERMINATED', ...agg({ cancelledAmount: 100000 }) }]],
    });
    expect((await vippsRefund(f.fn, api, vippsArgs)).kind).toBe('succeeded');
    expect(f.calls[1].url).toMatch(/\/cancel$/);
  });

  it('refuses a partial refund of an uncaptured reservation', async () => {
    const f = fakeFetch({
      '/payments/booking-b1-1': [[200, agg({ authorizedAmount: 287500, capturedAmount: 0, refundedAmount: 0, cancelledAmount: 0 })]],
    });
    const out = await vippsRefund(f.fn, api, vippsArgs);
    expect(out.kind).toBe('failed');
    expect(f.calls).toHaveLength(1);
  });

  it('refuses when less was captured than the refund', async () => {
    const f = fakeFetch({
      '/payments/booking-b1-1': [[200, agg({ authorizedAmount: 287500, capturedAmount: 50000, refundedAmount: 0 })]],
    });
    expect((await vippsRefund(f.fn, api, vippsArgs)).kind).toBe('failed');
  });

  it('reports an unknown payment as failed and outages as retry', async () => {
    expect((await vippsRefund(fakeFetch({ '/payments/booking-b1-1': [[404, {}]] }).fn, api, vippsArgs)).kind).toBe('failed');
    expect((await vippsRefund(fakeFetch({ '/payments/booking-b1-1': [[503, {}]] }).fn, api, vippsArgs)).kind).toBe('retry');
    expect((await vippsRefund(fakeFetch({ '/payments/booking-b1-1': [new Error('timeout')] }).fn, api, vippsArgs)).kind).toBe('retry');
    const f = fakeFetch({
      '/payments/booking-b1-1':        [[200, agg({ authorizedAmount: 287500, capturedAmount: 287500 })]],
      '/payments/booking-b1-1/refund': [[502, {}]],
    });
    expect((await vippsRefund(f.fn, api, vippsArgs)).kind).toBe('retry');
  });
});

describe('processRefund', () => {
  const row: RefundRow = {
    id: 'r1', booking_id: 'b1', provider: 'stripe', provider_reference: 'pi_1',
    amount: 2875, idempotency_key: 'flyttgo-refund-r1', status: 'requested',
  };

  it('records the provider outcome once', async () => {
    const mark = vi.fn(async (_id, status) => ({ ...row, status }));
    const out = await processRefund({
      begin: async () => row,
      provider: async () => ({ kind: 'succeeded', providerRefundId: 're_1' }),
      mark,
    });
    expect(out.outcome).toBe('succeeded');
    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith('r1', 'succeeded', 're_1', null);
  });

  it('records a refusal with its reason', async () => {
    const mark = vi.fn(async (_id, status) => ({ ...row, status }));
    const out = await processRefund({
      begin: async () => row,
      provider: async () => ({ kind: 'failed', error: 'card closed' }),
      mark,
    });
    expect(out.outcome).toBe('failed');
    expect(mark).toHaveBeenCalledWith('r1', 'failed', null, 'card closed');
  });

  it('leaves the request open when the provider did not answer', async () => {
    const mark = vi.fn();
    const out = await processRefund({
      begin: async () => row,
      provider: async () => ({ kind: 'retry', error: 'stripe 503' }),
      mark,
    });
    expect(out.outcome).toBe('retry');
    expect(mark).not.toHaveBeenCalled();
  });

  it('asks the provider again with the same key on retry', async () => {
    const keys: string[] = [];
    const provider = async (r: RefundRow) => { keys.push(r.idempotency_key); return { kind: 'retry' as const, error: 'x' }; };
    await processRefund({ begin: async () => row, provider, mark: vi.fn() });
    await processRefund({ begin: async () => row, provider, mark: vi.fn() });
    expect(keys).toEqual(['flyttgo-refund-r1', 'flyttgo-refund-r1']);
  });

  it('does not call the provider when the database refuses (already refunded)', async () => {
    const provider = vi.fn();
    await expect(processRefund({
      begin: async () => { throw new Error('refund: booking already refunded'); },
      provider,
      mark: vi.fn(),
    })).rejects.toThrow(/already refunded/);
    expect(provider).not.toHaveBeenCalled();
  });
});
