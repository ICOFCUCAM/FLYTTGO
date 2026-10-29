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
// The amount is the booking's manual_refund_percent, the cancellation
// policy for a cancelled booking, or the status share, applied on the
// server to what was actually paid (_shared/pricing.ts refundAmountFor;
// _shared/refund-booking.ts). The flow and its guarantees are
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
import { REFUND_BOOKING_COLUMNS, refundBooking } from '../_shared/refund-booking.ts';


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
    .select(REFUND_BOOKING_COLUMNS)
    .eq('id', body.bookingId)
    .maybeSingle();
  if (readErr)  return json({ error: 'booking read failed' }, 500);
  if (!booking) return json({ error: 'booking not found' }, 404);

  const answer = await refundBooking(db, booking, caller.id, body.reason ?? null);
  return json(answer.body, answer.status);
});
