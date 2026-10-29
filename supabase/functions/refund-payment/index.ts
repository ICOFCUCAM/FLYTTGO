// ============================================================================
// FlyttGo — refund-payment Edge Function
// ============================================================================
//
// Refunds a booking through the provider that took the money (Stripe or
// Vipps), for administrators only. Replaces the admin dashboard's refund,
// which only wrote database rows.
//
//   POST /functions/v1/refund-payment
//   Authorization: Bearer <admin's access token>
//   { "bookingId": "<uuid>", "reason": "optional text" }
//
// The amount is the dashboard's rule (status share or the booking's
// manual_refund_percent) applied on the server to what was actually paid
// (_shared/pricing.ts refundAmountFor). The flow and its guarantees are
// described in _shared/refunds.ts: one live refund per booking, the same
// idempotency key on every retry, database effects only after the
// provider confirms, once.
//
// Responses: 200 { status: 'succeeded' | 'pending' | 'failed', refund }
//            202 { status: 'requested', retry: true } — provider not
//                reachable; calling again repeats the same request
//
// DEPLOY:
//   supabase functions deploy refund-payment --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, VIPPS_* (as create-vipps-session).
// ============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { serviceClient, getCaller } from '../_shared/auth.ts';
import { refundAmountFor } from '../_shared/pricing.ts';
import { processRefund, stripeRefund, vippsRefund, type RefundRow } from '../_shared/refunds.ts';
import { VIPPS_BASE, vippsApiHeaders, vippsMissingConfig } from '../_shared/vipps.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  const db     = serviceClient();
  const caller = await getCaller(req, db);
  if (!caller)         return json({ error: 'Sign in required' }, 401);
  if (!caller.isAdmin) return json({ error: 'Administrators only' }, 403);

  let body: { bookingId?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body?.bookingId || typeof body.bookingId !== 'string') {
    return json({ error: 'bookingId is required' }, 400);
  }

  const { data: booking, error: readErr } = await db
    .from('bookings')
    .select('id, status, price_estimate, paid_amount, manual_refund_percent, payment_provider')
    .eq('id', body.bookingId)
    .maybeSingle();
  if (readErr)  return json({ error: 'booking read failed' }, 500);
  if (!booking) return json({ error: 'booking not found' }, 404);

  const amountNok = refundAmountFor(booking);
  if (amountNok <= 0) {
    return json({ error: `No refund is due for a booking with status ${booking.status}` }, 409);
  }

  try {
    const result = await processRefund({
      begin: async () => {
        const { data, error } = await db.rpc('refund_request_begin', {
          p_booking_id: body.bookingId, p_amount: amountNok,
          p_requested_by: caller.id, p_reason: body.reason?.slice(0, 500) ?? null,
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
        });
      },
    });

    if (result.outcome === 'retry') {
      console.warn(`refund ${result.refund.id} not confirmed: ${result.error}`);
      return json({ status: 'requested', retry: true, error: result.error, refund: result.refund }, 202);
    }
    return json({ status: result.outcome, error: result.error, note: result.note, refund: result.refund });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return json({ error: (err as Error).message }, status);
  }
});
