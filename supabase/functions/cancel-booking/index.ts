// ============================================================================
// FlyttGo — cancel-booking Edge Function
// ============================================================================
//
// A customer cancels their own booking and gets back what the published
// cancellation policy gives (Terms §6.1; _shared/pricing.ts):
//   more than 24 hours before pickup → everything; within 24 hours → 50%.
// Allowed before the driver arrives (pending, confirmed, driver_assigned).
//
//   POST /functions/v1/cancel-booking
//   Authorization: Bearer <customer's access token>
//   { "bookingId": "<uuid>", "reason": "optional text" }
//
// The cancellation is written as the customer (their token), so the
// database guard decides whether it is allowed and stamps who cancelled
// and when (migration 00006); the customer cannot choose either. The
// refund then goes through the provider as in refund-payment
// (_shared/refund-booking.ts). Calling again after a refund that did not
// complete (provider unreachable) repeats the same refund request.
//
// Responses: 200 { cancelled: true, refund: { status, … } | null }
//            202 when the refund is requested but not yet confirmed
//
// DEPLOY:
//   supabase functions deploy cancel-booking --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, VIPPS_* (as refund-payment).
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient, userClient } from '../_shared/auth.ts';
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

const CANCELLABLE = ['pending', 'confirmed', 'driver_assigned'];

interface BookingRow {
  id: string; customer_id: string; status: string; payment_status: string | null;
  payment_provider: string | null; cancelled_by: string | null; cancelled_at: string | null;
  price_estimate: number | null; paid_amount: number | null; manual_refund_percent: number | null;
  move_date: string | null; move_time: string | null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  const db     = serviceClient();
  const caller = await getCaller(req, db);
  if (!caller) return json({ error: 'Sign in required' }, 401);

  let body: { bookingId?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body?.bookingId || typeof body.bookingId !== 'string') return json({ error: 'bookingId is required' }, 400);

  const read = async () =>
    (await db.from('bookings').select(REFUND_BOOKING_COLUMNS).eq('id', body.bookingId).maybeSingle()).data as BookingRow | null;
  let booking = await read();
  if (!booking || booking.customer_id !== caller.id) return json({ error: 'booking not found' }, 404);

  if (booking.status !== 'cancelled') {
    if (!CANCELLABLE.includes(String(booking.status))) {
      return json({ error: `a booking that is ${booking.status} can no longer be cancelled here; contact support` }, 409);
    }
    /* As the customer: the guard allows it and the database records who
     * and when. */
    const { error } = await userClient(req)
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', booking.id);
    if (error) return json({ error: `cancellation refused: ${error.message}` }, 409);
    if (body.reason) {
      await db.from('bookings').update({ cancellation_reason: String(body.reason).slice(0, 500) }).eq('id', booking.id);
    }
    booking = await read();
    if (!booking) return json({ error: 'booking not found' }, 404);
  } else if (booking.cancelled_by !== 'customer') {
    return json({ cancelled: true, refund: null, note: 'cancelled by FlyttGo; the refund is handled by support' });
  }

  /* Nothing was paid: nothing to give back. */
  if (!['paid', 'escrow'].includes(String(booking.payment_status))) {
    return json({ cancelled: true, refund: null });
  }
  if (!booking.payment_provider) {
    return json({ cancelled: true, refund: null, note: 'paid before provider references were recorded; support will refund it' });
  }

  const answer = await refundBooking(db, booking, caller.id, body.reason ?? 'cancelled by the customer');
  return json({ cancelled: true, refund: answer.body }, answer.status === 202 ? 202 : 200);
});
