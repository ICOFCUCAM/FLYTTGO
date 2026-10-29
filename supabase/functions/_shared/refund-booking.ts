// ============================================================================
// FlyttGo — refund a booking through its provider (shared by
// refund-payment, for administrators, and cancel-booking, for customers)
// ============================================================================
//
// The amount comes from the booking (_shared/pricing.ts refundAmountFor:
// the manual percentage, the cancellation policy, or the status share),
// applied on the server to what was actually paid. The flow and its
// guarantees are in _shared/refunds.ts. A cancelled booking whose Vipps
// payment was never captured keeps its fee by capturing that part and
// cancelling the rest (allowCaptureRest).
// ============================================================================
import { refundAmountFor } from './pricing.ts';
import { processRefund, stripeRefund, vippsRefund, type RefundRow } from './refunds.ts';
import { VIPPS_BASE, vippsApiHeaders, vippsMissingConfig } from './vipps.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

export const REFUND_BOOKING_COLUMNS =
  'id, status, price_estimate, paid_amount, manual_refund_percent, payment_provider, payment_status, ' +
  'cancelled_by, cancelled_at, move_date, move_time, customer_id';

export interface RefundAnswer { status: number; body: Record<string, unknown> }

// deno-lint-ignore no-explicit-any
export async function refundBooking(db: any, booking: any, requestedBy: string | null, reason: string | null): Promise<RefundAnswer> {
  /* Paid on the company's invoice: no money was taken, so nothing is
   * refunded. A cancellation fee is invoiced by the invoice run; an
   * invoice already issued is corrected with a credit note. */
  if (booking.payment_provider === 'invoice') {
    return { status: 409, body: { error: 'this booking is paid on invoice: correct it with a credit note on the company\'s invoice', invoice: true } };
  }
  const amountNok = refundAmountFor(booking);
  if (amountNok <= 0) {
    const why = booking.status === 'cancelled' && !booking.cancelled_by
      ? 'this booking was cancelled before cancellations were recorded: set a manual refund percentage'
      : `no refund is due for a booking with status ${booking.status}`;
    return { status: 409, body: { error: why } };
  }
  const cancelled = booking.status === 'cancelled';

  try {
    const result = await processRefund({
      begin: async () => {
        const { data, error } = await db.rpc('refund_request_begin', {
          p_booking_id: booking.id, p_amount: amountNok,
          p_requested_by: requestedBy, p_reason: reason?.slice(0, 500) ?? null,
        });
        if (error) throw Object.assign(new Error(error.message), { status: 409 });
        return data as RefundRow;
      },
      mark: async (id, status, providerRefundId, error) => {
        const { data, error: markErr } = await db.rpc('refund_mark', {
          p_refund_id: id, p_status: status, p_provider_refund_id: providerRefundId, p_error: error,
        });
        if (markErr) throw new Error(`refund_mark failed: ${markErr.message}`);
        return data as RefundRow;
      },
      provider: async (row) => {
        const amountOre = Math.round(Number(row.amount) * 100);
        if (row.provider === 'stripe') {
          if (!STRIPE_SECRET_KEY) return { kind: 'retry', error: 'STRIPE_SECRET_KEY not configured' };
          return stripeRefund(fetch, STRIPE_SECRET_KEY, {
            paymentIntentId: row.provider_reference, amountOre,
            idempotencyKey: row.idempotency_key, refundId: row.id, bookingId: row.booking_id,
          });
        }
        const missing = vippsMissingConfig();
        if (missing.length) return { kind: 'retry', error: `Vipps not configured: ${missing.join(', ')}` };
        return vippsRefund(fetch, { base: VIPPS_BASE, headers: await vippsApiHeaders() }, {
          reference: row.provider_reference, amountOre, idempotencyKey: row.idempotency_key,
          allowCaptureRest: cancelled,
        });
      },
    });
    if (result.outcome === 'retry') {
      console.warn(`refund ${result.refund.id} not confirmed: ${result.error}`);
      return { status: 202, body: { status: 'requested', retry: true, error: result.error, refund: result.refund } };
    }
    return { status: 200, body: { status: result.outcome, error: result.error, note: result.note, refund: result.refund } };
  } catch (err) {
    return { status: (err as { status?: number }).status ?? 500, body: { error: (err as Error).message } };
  }
}
