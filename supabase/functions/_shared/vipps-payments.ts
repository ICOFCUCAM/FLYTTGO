// ============================================================================
// FlyttGo — Vipps payment lifecycle (ePayment API, used by Checkout v3)
// ============================================================================
//
// Reserve → capture → (refund), or reserve → cancel. Decided 2026-10-29
// (docs/PREDEPLOY_REVIEW.md §4.2):
//
//   * A booking counts as paid only when Vipps itself reports the payment
//     AUTHORIZED for the expected amount (vippsConfirmAuthorized), not
//     because a callback says so.
//   * The money is captured when delivery is confirmed (the escrow
//     release point): vippsCapture, called by capture-payment.
//   * A booking cancelled before capture keeps any cancellation fee by
//     capturing that part and cancels the rest of the reservation
//     (vippsRefund with allowCaptureRest, in refunds.ts).
//
// No Deno or network imports: fetch is passed in, so the Vitest suite
// (src/test/vipps-payments.test.ts) runs these against a fake Vipps.
// ============================================================================

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface VippsApi {
  base:    string;
  headers: Record<string, string>;
}

export interface VippsPayment {
  state:      string;            // CREATED | AUTHORIZED | ABORTED | EXPIRED | TERMINATED
  authorized: number;            // øre
  captured:   number;
  refunded:   number;
  cancelled:  number;
  pspReference: string | null;
}

export type Read =
  | { kind: 'ok'; payment: VippsPayment }
  | { kind: 'failed'; error: string }
  | { kind: 'retry'; error: string };

async function readJson(res: { text: () => Promise<string> }): Promise<any> {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text.slice(0, 300) }; }
}

function value(a: any): number {
  const v = Number(a?.value);
  return Number.isFinite(v) ? v : 0;
}

export function paymentUrl(api: VippsApi, reference: string): string {
  return `${api.base}/epayment/v1/payments/${encodeURIComponent(reference)}`;
}

export function parsePayment(p: any): VippsPayment {
  const agg = p?.aggregate ?? {};
  return {
    state:        String(p?.state ?? ''),
    authorized:   value(agg.authorizedAmount),
    captured:     value(agg.capturedAmount),
    refunded:     value(agg.refundedAmount),
    cancelled:    value(agg.cancelledAmount),
    pspReference: typeof p?.pspReference === 'string' ? p.pspReference : null,
  };
}

/** GET the payment as Vipps sees it. */
export async function vippsGetPayment(fetchFn: Fetch, api: VippsApi, reference: string): Promise<Read> {
  let res;
  try {
    res = await fetchFn(paymentUrl(api, reference), { method: 'GET', headers: api.headers });
  } catch (err) {
    return { kind: 'retry', error: `vipps unreachable: ${(err as Error).message}` };
  }
  if (res.status >= 500 || res.status === 429) return { kind: 'retry', error: `vipps ${res.status}` };
  if (res.status === 404) return { kind: 'failed', error: `vipps has no payment ${reference}` };
  const body = await readJson(res);
  if (!res.ok) return { kind: 'failed', error: `vipps ${res.status}: ${body?.title ?? body?.detail ?? ''}`.trim() };
  return { kind: 'ok', payment: parsePayment(body) };
}

/**
 * Is this reservation real? Vipps must report AUTHORIZED with at least
 * the expected amount reserved and nothing cancelled. A callback alone
 * proves nothing beyond knowing the shared secret.
 */
export async function vippsConfirmAuthorized(
  fetchFn: Fetch, api: VippsApi, reference: string, expectedOre: number,
): Promise<{ kind: 'authorized'; payment: VippsPayment } | { kind: 'failed'; error: string } | { kind: 'retry'; error: string }> {
  const read = await vippsGetPayment(fetchFn, api, reference);
  if (read.kind !== 'ok') return read;
  const p = read.payment;
  if (p.state !== 'AUTHORIZED') return { kind: 'failed', error: `vipps state is ${p.state || 'unknown'}, not AUTHORIZED` };
  if (p.cancelled > 0) return { kind: 'failed', error: 'vipps reservation has been cancelled' };
  if (p.authorized !== expectedOre) {
    return { kind: 'failed', error: `vipps reserved ${p.authorized} øre, expected ${expectedOre}` };
  }
  return { kind: 'authorized', payment: p };
}

export type CaptureOutcome =
  | { kind: 'captured'; capturedOre: number; pspReference: string | null; note?: string }
  | { kind: 'failed'; error: string }
  | { kind: 'retry'; error: string };

/**
 * Capture amountOre of a reservation. Repeating with the same key is
 * safe: if Vipps already shows the amount captured (an earlier attempt
 * went through), nothing is asked again.
 */
export async function vippsCapture(
  fetchFn: Fetch, api: VippsApi,
  r: { reference: string; amountOre: number; idempotencyKey: string },
): Promise<CaptureOutcome> {
  if (!(r.amountOre > 0)) return { kind: 'failed', error: 'nothing to capture' };
  const read = await vippsGetPayment(fetchFn, api, r.reference);
  if (read.kind !== 'ok') return read;
  const p = read.payment;
  if (p.captured >= r.amountOre) {
    return { kind: 'captured', capturedOre: p.captured, pspReference: p.pspReference, note: 'already captured at Vipps' };
  }
  if (p.state !== 'AUTHORIZED') return { kind: 'failed', error: `vipps state is ${p.state || 'unknown'}; cannot capture` };
  const remaining = p.authorized - p.cancelled - p.captured;
  const need = r.amountOre - p.captured;
  if (need > remaining) return { kind: 'failed', error: `vipps has ${remaining} øre left to capture, asked ${need}` };

  let res;
  try {
    res = await fetchFn(`${paymentUrl(api, r.reference)}/capture`, {
      method:  'POST',
      headers: { ...api.headers, 'Content-Type': 'application/json', 'Idempotency-Key': r.idempotencyKey },
      body:    JSON.stringify({ modificationAmount: { currency: 'NOK', value: need } }),
    });
  } catch (err) {
    return { kind: 'retry', error: `vipps unreachable: ${(err as Error).message}` };
  }
  if (res.status >= 500 || res.status === 429) return { kind: 'retry', error: `vipps capture ${res.status}` };
  const after = await readJson(res);
  if (!res.ok) return { kind: 'failed', error: `vipps capture ${res.status}: ${after?.title ?? after?.detail ?? ''}`.trim() };
  const captured = value(after?.aggregate?.capturedAmount);
  if (captured < r.amountOre) return { kind: 'retry', error: `vipps shows ${captured} øre captured, expected ${r.amountOre}` };
  return { kind: 'captured', capturedOre: captured, pspReference: after?.pspReference ?? p.pspReference };
}

/** Compare two secrets without leaking where they differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
