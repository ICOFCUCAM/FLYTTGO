// ============================================================================
// FlyttGo — refunds through Stripe and Vipps
// ============================================================================
//
// A refund is real only when the provider says so. Flow (refund-payment):
//
//   begin()  refund_request_begin: a payment_refunds row with an
//            idempotency key, or the row already in progress (a retry
//            reuses its key, so the provider never refunds twice)
//   provider stripeRefund() / vippsRefund(): ask, then read back what the
//            provider reports
//   mark()   refund_mark: record the outcome; the database follows the
//            money (escrow, driver wallet, booking) on the first
//            'succeeded', once
//
// Outcomes: 'succeeded' and 'failed' are the provider's final answer;
// 'pending' means the provider accepted it and will finish later (Stripe
// sends refund.updated, handled in stripe-webhook); 'retry' means we do
// not know (network error, 5xx): the row stays 'requested' and the same
// request is repeated with the same key.
//
// Vipps reservations that were never captured: a full refund cancels the
// reservation; a partial one (a cancelled booking keeping a cancellation
// fee) is allowed only with allowCaptureRest, and captures the fee before
// cancelling the rest.
//
// No Deno or network imports: fetch is passed in, so the Vitest suite
// (src/test/refunds.test.ts) runs these against fake providers.
// ============================================================================

import { vippsCapture } from './vipps-payments.ts';

export type RefundOutcome =
  | { kind: 'succeeded' | 'pending'; providerRefundId: string | null; note?: string }
  | { kind: 'failed'; error: string; providerRefundId?: string | null }
  | { kind: 'retry'; error: string };

export interface RefundRow {
  id:                 string;
  booking_id:         string;
  provider:           'stripe' | 'vipps';
  provider_reference: string;
  amount:             number | string;
  idempotency_key:    string;
  status:             'requested' | 'pending' | 'succeeded' | 'failed';
  provider_refund_id?: string | null;
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

async function readJson(res: { text: () => Promise<string> }): Promise<any> {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text.slice(0, 300) }; }
}

/* ─── Stripe ───────────────────────────────────────────────────── */

export function mapStripeRefundStatus(status: string | null | undefined): 'succeeded' | 'pending' | 'failed' {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed' || status === 'canceled') return 'failed';
  return 'pending';                                   // pending, requires_action
}

export async function stripeRefund(
  fetchFn: Fetch,
  secretKey: string,
  r: { paymentIntentId: string; amountOre: number; idempotencyKey: string; refundId: string; bookingId: string },
): Promise<RefundOutcome> {
  const body = new URLSearchParams();
  body.set('payment_intent', r.paymentIntentId);
  body.set('amount', String(r.amountOre));
  body.set('metadata[refund_id]', r.refundId);
  body.set('metadata[booking_id]', r.bookingId);

  let res;
  try {
    res = await fetchFn('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization:     `Bearer ${secretKey}`,
        'Content-Type':    'application/x-www-form-urlencoded',
        'Idempotency-Key': r.idempotencyKey,
        'Stripe-Version':  '2024-06-20',
      },
      body,
    });
  } catch (err) {
    return { kind: 'retry', error: `stripe unreachable: ${(err as Error).message}` };
  }

  const data = await readJson(res);
  if (res.status >= 500 || res.status === 409 || res.status === 429) {
    return { kind: 'retry', error: `stripe ${res.status}: ${data?.error?.message ?? 'try again'}` };
  }
  if (!res.ok) {
    return { kind: 'failed', error: `stripe ${res.status}: ${data?.error?.code ?? ''} ${data?.error?.message ?? ''}`.trim() };
  }
  const kind = mapStripeRefundStatus(data?.status);
  const providerRefundId = typeof data?.id === 'string' ? data.id : null;
  if (kind === 'failed') return { kind, error: `stripe refund ${data?.status}: ${data?.failure_reason ?? ''}`.trim(), providerRefundId };
  if (Number(data?.amount) !== r.amountOre) {
    return { kind: 'failed', error: `stripe refunded ${data?.amount} øre, asked ${r.amountOre}`, providerRefundId };
  }
  return { kind, providerRefundId };
}

/* ─── Vipps (ePayment API, used by Checkout v3) ───────────────── */

export interface VippsApi {
  base:    string;                                   // https://api.vipps.no or https://apitest.vipps.no
  headers: Record<string, string>;                   // Authorization, Ocp-Apim-Subscription-Key, Merchant-Serial-Number, …
}

function value(a: any): number {
  const v = Number(a?.value);
  return Number.isFinite(v) ? v : 0;
}

export async function vippsRefund(
  fetchFn: Fetch,
  api: VippsApi,
  r: { reference: string; amountOre: number; idempotencyKey: string; allowCaptureRest?: boolean },
): Promise<RefundOutcome> {
  const url = `${api.base}/epayment/v1/payments/${encodeURIComponent(r.reference)}`;

  let res;
  try {
    res = await fetchFn(url, { method: 'GET', headers: api.headers });
  } catch (err) {
    return { kind: 'retry', error: `vipps unreachable: ${(err as Error).message}` };
  }
  if (res.status >= 500 || res.status === 429) return { kind: 'retry', error: `vipps ${res.status}` };
  if (res.status === 404) return { kind: 'failed', error: `vipps has no payment ${r.reference}` };
  const payment = await readJson(res);
  if (!res.ok) return { kind: 'failed', error: `vipps ${res.status}: ${payment?.title ?? payment?.detail ?? ''}`.trim() };

  const agg        = payment?.aggregate ?? {};
  const authorized = value(agg.authorizedAmount);
  const captured   = value(agg.capturedAmount);
  const refunded   = value(agg.refundedAmount);
  const cancelled  = value(agg.cancelledAmount);

  /* An earlier attempt with our key already went through (we crashed
   * before recording it): report it instead of asking again. One live
   * refund per booking (payment_refunds) makes this unambiguous. */
  if (refunded >= r.amountOre) return { kind: 'succeeded', providerRefundId: payment?.pspReference ?? null, note: 'already refunded at Vipps' };
  if (captured === 0 && cancelled >= authorized && authorized > 0 && r.amountOre >= authorized) {
    return { kind: 'succeeded', providerRefundId: payment?.pspReference ?? null, note: 'already cancelled at Vipps' };
  }

  const write = async (action: 'refund' | 'cancel', body: unknown) => {
    try {
      return await fetchFn(`${url}/${action}`, {
        method:  'POST',
        headers: { ...api.headers, 'Content-Type': 'application/json', 'Idempotency-Key': r.idempotencyKey },
        body:    JSON.stringify(body),
      });
    } catch (err) {
      return { ok: false, status: 599, text: async () => (err as Error).message };
    }
  };

  /* A cancelled booking keeping a fee: the refund is the uncaptured part
   * of the reservation. Capture the fee (up to authorized − refund), then
   * cancel the rest. Decided by what is still uncaptured, so a retry
   * after a capture that went through cancels instead of refunding. */
  if (r.allowCaptureRest) {
    const uncaptured = authorized - captured - cancelled;
    if (cancelled >= r.amountOre && captured + cancelled >= authorized && authorized > 0) {
      return { kind: 'succeeded', providerRefundId: payment?.pspReference ?? null, note: 'fee captured and rest cancelled at Vipps' };
    }
    if (uncaptured >= r.amountOre && uncaptured > 0) {
      const keepTotal = authorized - cancelled - r.amountOre;          // total to have captured
      if (keepTotal > captured) {
        const cap = await vippsCapture(fetchFn, api, { reference: r.reference, amountOre: keepTotal, idempotencyKey: `${r.idempotencyKey}-capture` });
        if (cap.kind === 'retry') return cap;
        if (cap.kind === 'failed') return { kind: 'failed', error: `keeping the fee: ${cap.error}` };
      }
      const out = await write('cancel', {});
      if (out.status >= 500 || out.status === 429) return { kind: 'retry', error: `vipps cancel ${out.status}` };
      const after = await readJson(out);
      if (!out.ok) return { kind: 'failed', error: `vipps cancel ${out.status}: ${after?.title ?? after?.detail ?? ''}`.trim() };
      if (value(after?.aggregate?.cancelledAmount) >= r.amountOre || after?.state === 'TERMINATED') {
        return { kind: 'succeeded', providerRefundId: after?.pspReference ?? null, note: keepTotal > 0 ? 'fee captured, rest cancelled' : 'reservation cancelled' };
      }
      return { kind: 'pending', providerRefundId: after?.pspReference ?? null };
    }
  }

  if (captured - refunded >= r.amountOre) {
    const out = await write('refund', { modificationAmount: { currency: 'NOK', value: r.amountOre } });
    if (out.status >= 500 || out.status === 429) return { kind: 'retry', error: `vipps refund ${out.status}` };
    const after = await readJson(out);
    if (!out.ok) return { kind: 'failed', error: `vipps refund ${out.status}: ${after?.title ?? after?.detail ?? ''}`.trim() };
    if (value(after?.aggregate?.refundedAmount) >= refunded + r.amountOre) {
      return { kind: 'succeeded', providerRefundId: after?.pspReference ?? null };
    }
    return { kind: 'pending', providerRefundId: after?.pspReference ?? null, note: 'vipps accepted; refunded amount not yet shown' };
  }

  if (captured === 0 && authorized > 0) {
    /* Reserved, never captured: the money is returned by cancelling the
     * reservation, which is all or nothing (unless allowCaptureRest,
     * handled above). */
    if (r.amountOre < authorized - cancelled) {
      return { kind: 'failed', error: 'vipps payment was never captured: only a full refund (cancellation) is possible' };
    }
    const out = await write('cancel', {});
    if (out.status >= 500 || out.status === 429) return { kind: 'retry', error: `vipps cancel ${out.status}` };
    const after = await readJson(out);
    if (!out.ok) return { kind: 'failed', error: `vipps cancel ${out.status}: ${after?.title ?? after?.detail ?? ''}`.trim() };
    if (value(after?.aggregate?.cancelledAmount) >= authorized || after?.state === 'TERMINATED') {
      return { kind: 'succeeded', providerRefundId: after?.pspReference ?? null, note: 'reservation cancelled' };
    }
    return { kind: 'pending', providerRefundId: after?.pspReference ?? null };
  }

  return { kind: 'failed', error: `vipps: captured ${captured - refunded} øre is less than the refund of ${r.amountOre} øre` };
}

/* ─── Orchestration ────────────────────────────────────────────── */

export interface RefundDeps {
  begin:    () => Promise<RefundRow>;
  mark:     (id: string, status: 'requested' | 'pending' | 'succeeded' | 'failed', providerRefundId: string | null, error: string | null) => Promise<RefundRow>;
  provider: (row: RefundRow) => Promise<RefundOutcome>;
}

export interface RefundResult {
  refund:  RefundRow;
  outcome: RefundOutcome['kind'];
  error?:  string;
  note?:   string;
}

/**
 * begin → provider → mark. A refund that already succeeded is refused by
 * begin(); one in progress is asked again with the same key. 'retry'
 * leaves the row 'requested' for the next attempt.
 */
export async function processRefund(deps: RefundDeps): Promise<RefundResult> {
  const row = await deps.begin();
  const outcome = await deps.provider(row);
  if (outcome.kind === 'retry') {
    return { refund: row, outcome: 'retry', error: outcome.error };
  }
  const providerRefundId = outcome.providerRefundId ?? row.provider_refund_id ?? null;
  const error = outcome.kind === 'failed' ? outcome.error : null;
  const marked = await deps.mark(row.id, outcome.kind, providerRefundId, error);
  return { refund: marked, outcome: outcome.kind, error: error ?? undefined, note: 'note' in outcome ? outcome.note : undefined };
}
