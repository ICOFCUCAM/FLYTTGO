// ============================================================================
// FlyttGo — book-on-invoice Edge Function
// ============================================================================
//
// Pays a company booking on the company's invoice (docs/INVOICING.md).
// The price is computed on the server, as for card and Vipps
// (_shared/booking-charge.ts), then the database checks the company's
// terms (book_on_invoice, migration 00008):
//   - the company is active;
//   - the caller is its owner, admin or booker;
//   - FlyttGo has switched invoicing on;
//   - the booking stays within the credit limit;
//   - the company has a current credit check, when the admin setting asks
//     for one.
// A booking over the member's spending limits or under the company's
// approval rules (migration 00017) is not put on invoice: the answer is
// 409 { awaitingApproval: true, approval } and it waits, unpaid, until an
// owner, admin or finance member approves it. Then the same call books it.
// The booking is then paid on invoice and goes to dispatch like a paid
// booking. It is invoiced after the move (per booking or monthly, as the
// company chose).
//
//   POST /functions/v1/book-on-invoice
//   Authorization: Bearer <access token>
//   { "bookingId": "<uuid>" }
//
// DEPLOY: supabase functions deploy book-on-invoice --no-verify-jwt
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient } from '../_shared/auth.ts';
import { chargeForBooking, chargeRefusal } from '../_shared/booking-charge.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);
  const db = serviceClient();
  const caller = await getCaller(req, db);
  if (!caller) return json({ error: 'Sign in required' }, 401);

  let body: { bookingId?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!body?.bookingId) return json({ error: 'bookingId is required' }, 400);

  const charge = await chargeForBooking(db, body.bookingId, caller.id);
  /* Waits for the company's approval (409, awaitingApproval): nothing is put on invoice yet. */
  if (!charge.ok) return json(chargeRefusal(charge), charge.status);

  const { data, error } = await db.rpc('book_on_invoice', { p_booking: body.bookingId, p_caller: caller.id });
  if (error) return json({ error: error.message }, error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 409);
  return json({ ok: true, amountNok: charge.amountNok, priceChanged: charge.priceChanged, ...data });
});
