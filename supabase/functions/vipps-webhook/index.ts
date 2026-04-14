// ============================================================================
// FlyttGo — vipps-webhook Edge Function
// ============================================================================
//
// Receives webhook callbacks from Vipps Checkout and flips the booking's
// payment_status to 'paid' + the escrow_payments row to 'escrow' once
// the customer has successfully completed payment in the Vipps app.
//
// Paired with create-vipps-session. When that function creates a
// Vipps Checkout session it passes VIPPS_WEBHOOK_SECRET as the
// callbackAuthorizationToken. Vipps echoes that string back verbatim
// in the Authorization header on every webhook call, which is how
// this function verifies the caller. Treat VIPPS_WEBHOOK_SECRET like
// a password — anyone who knows it can forge "paid" state changes.
//
// DEPLOY
// ------
//   supabase functions deploy vipps-webhook --no-verify-jwt
//
// The --no-verify-jwt flag is required because Vipps doesn't send a
// Supabase JWT — it sends its own callbackAuthorizationToken, which
// we verify manually in verifyVippsAuth() below.
//
// REQUIRED SECRETS
// ----------------
//   supabase secrets set VIPPS_WEBHOOK_SECRET=<must-match-create-vipps-session>
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected.)
//
// IDEMPOTENCY
// -----------
// Vipps can send the same "PaymentSuccessful" event more than once
// (retries on network errors, at-least-once delivery semantics). We
// handle this by checking the booking's current payment_status before
// writing: if it's already 'paid' / 'escrow' / 'released' we short-
// circuit with a 200 and { idempotent: true }.
//
// VIPPS WEBHOOK PAYLOAD (checkout v3)
// ------------------------------------
//   {
//     "sessionId":    "8b...",
//     "merchantSerialNumber": "123456",
//     "reference":    "booking-<uuid>-<timestamp>",  // set by create-vipps-session
//     "sessionState": "PaymentSuccessful" | "PaymentInitiated" | "SessionExpired" | "SessionTerminated",
//     "amount":       { "value": 402500, "currency": "NOK" },
//     "timestamp":    "2026-04-15T12:34:56Z"
//   }
//
// We only act on sessionState === 'PaymentSuccessful'. All other
// states get a 200 with { ignored: true } so Vipps doesn't retry.
// ============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ─── Env ──────────────────────────────────────────────────────── */
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VIPPS_WEBHOOK_SECRET      = Deno.env.get('VIPPS_WEBHOOK_SECRET') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

/* ─── Auth verification ────────────────────────────────────────── */

/**
 * Vipps sends the callbackAuthorizationToken we registered at session
 * creation time back verbatim in the Authorization header. Support
 * both forms: bare token or "Bearer <token>".
 */
function verifyVippsAuth(req: Request): boolean {
  if (!VIPPS_WEBHOOK_SECRET) return false; // fail closed if the secret isn't set
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? '';
  if (!auth) return false;
  if (auth === VIPPS_WEBHOOK_SECRET) return true;
  if (auth === `Bearer ${VIPPS_WEBHOOK_SECRET}`) return true;
  return false;
}

/* ─── Reference parsing ────────────────────────────────────────── */

/**
 * create-vipps-session encodes booking id as `booking-<uuid>-<timestamp>`.
 * Pull the uuid out. Returns null if the reference doesn't match the
 * expected shape (e.g. a subscription payment using a different prefix).
 */
function extractBookingId(reference: string | undefined | null): string | null {
  if (!reference) return null;
  const m = /^booking-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/.exec(reference);
  return m ? m[1] : null;
}

/* ─── Idempotent state update ──────────────────────────────────── */

/**
 * Mark the booking as paid and flip the escrow_payments row from
 * 'held' to 'escrow' (money has been captured, now sitting in escrow
 * until the delivery is confirmed). If the booking is already paid
 * or beyond, return { idempotent: true } and do nothing.
 */
async function markBookingPaid(bookingId: string, amountOre: number) {
  /* Check current state first so we can bail out idempotently. */
  const { data: booking, error: readErr } = await supabase
    .from('bookings')
    .select('id, payment_status')
    .eq('id', bookingId)
    .maybeSingle();

  if (readErr) throw new Error(`booking read failed: ${readErr.message}`);
  if (!booking) throw new Error(`booking ${bookingId} not found`);

  /* 'pending' is the only state where we should mutate. Any other
   * value means we've already processed this payment (or the booking
   * is beyond the payment stage entirely). */
  const alreadyProcessed = ['paid', 'escrow', 'released', 'refunded'];
  if (alreadyProcessed.includes(String(booking.payment_status))) {
    return { ok: true, idempotent: true, previousStatus: booking.payment_status };
  }

  /* 1) bookings.payment_status = 'paid' */
  const { error: bookingErr } = await supabase
    .from('bookings')
    .update({ payment_status: 'paid' })
    .eq('id', bookingId);
  if (bookingErr) throw new Error(`booking update failed: ${bookingErr.message}`);

  /* 2) escrow_payments.status flips from 'held' (reserved) to 'escrow'
   *    (money captured, waiting on delivery confirmation). This matches
   *    the lifecycle the process-payment release_escrow action expects
   *    ('held' → 'escrow' → 'released'). */
  const { error: escrowErr } = await supabase
    .from('escrow_payments')
    .update({ status: 'escrow' })
    .eq('booking_id', bookingId);
  if (escrowErr) {
    /* Don't fail the webhook just because the escrow row is missing —
     * the booking is now paid either way. Ops can reconcile manually. */
    console.warn(`escrow update for ${bookingId} failed: ${escrowErr.message}`);
  }

  return { ok: true, idempotent: false, amountOre };
}

/* ─── Handler ──────────────────────────────────────────────────── */

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  /* Read the body as text first — some signature schemes require the
   * raw bytes. We parse JSON after auth verification. */
  const rawBody = await req.text();

  if (!verifyVippsAuth(req)) {
    console.warn('vipps-webhook rejected: invalid authorization header');
    return json({ error: 'Invalid webhook authorization' }, 401);
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const sessionState = String(event.sessionState ?? '');
  const reference    = typeof event.reference === 'string' ? event.reference : null;
  const amount       = (event.amount as { value?: number } | undefined)?.value ?? 0;

  /* Only act on successful payments — everything else gets a 200 so
   * Vipps stops retrying. */
  if (sessionState !== 'PaymentSuccessful') {
    return json({ ok: true, ignored: true, reason: `sessionState=${sessionState}` });
  }

  const bookingId = extractBookingId(reference);
  if (!bookingId) {
    /* Unknown reference shape — probably a subscription payment that
     * this webhook doesn't handle yet. 200 so Vipps doesn't retry; log
     * so ops can add the missing handler later. */
    console.warn(`vipps-webhook ignoring unknown reference: ${reference}`);
    return json({ ok: true, ignored: true, reason: 'unknown reference shape', reference });
  }

  try {
    const result = await markBookingPaid(bookingId, amount);
    return json({ ...result, bookingId, reference });
  } catch (err) {
    console.error('vipps-webhook markBookingPaid error:', err);
    /* 500 so Vipps retries — the failure is probably transient (DB
     * blip). Idempotency guards against double-processing on retry. */
    return json({ error: (err as Error).message }, 500);
  }
});
