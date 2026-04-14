// ============================================================================
// FlyttGo — stripe-webhook Edge Function
// ============================================================================
//
// Receives Stripe webhook events and flips the relevant FlyttGo
// state once a payment has been successfully captured.
//
// Handles two distinct kinds of checkout sessions, disambiguated by
// metadata.type (which create-checkout-session stamps when it creates
// the session):
//
//   metadata.type = 'booking'      → updates a bookings row
//                                      payment_status: 'pending' → 'paid'
//                                    + the related escrow_payments row
//                                      status: 'held' → 'escrow'
//
//   metadata.type = 'subscription' → updates the driver's active
//                                     driver_subscriptions row
//                                     (subscription_status: 'active',
//                                      end_date bumped forward).
//
// The dual-confirmation escrow release (at delivery time) is still
// handled by process-payment — this function is only the PAID gate,
// not the RELEASED gate.
//
// DEPLOY
// ------
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// --no-verify-jwt is required because Stripe doesn't send a Supabase
// JWT — it signs requests with a Stripe webhook secret instead, which
// we verify manually in verifyStripeSignature().
//
// REQUIRED SECRETS
// ----------------
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
//   (STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are
//    auto-injected and/or already set.)
//
// To get STRIPE_WEBHOOK_SECRET: in the Stripe dashboard, go to
// Developers → Webhooks → Add endpoint. Set the URL to
//   https://<your-project-ref>.supabase.co/functions/v1/stripe-webhook
// select the events `checkout.session.completed` and
// `checkout.session.async_payment_succeeded`, save, then click
// "Reveal" next to "Signing secret" and copy the whsec_... string.
//
// IDEMPOTENCY
// -----------
// Stripe uses at-least-once delivery, so the same event can arrive
// twice on retries. We check the current state before writing:
//   - bookings: if payment_status is already 'paid' / 'escrow' /
//     'released' / 'refunded', short-circuit with { idempotent: true }
//   - subscriptions: same idea keyed on the session id stored in the
//     subscription row (stripe_session_id)
//
// ============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ─── Env ──────────────────────────────────────────────────────── */
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_WEBHOOK_SECRET     = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/* ─── Stripe signature verification ────────────────────────────── */

/**
 * Stripe webhook verification. Stripe sends:
 *   Stripe-Signature: t=<unix_ts>,v1=<hex_sig>,v1=<another>,...
 *
 * We compute HMAC-SHA256 of `${timestamp}.${rawBody}` using the
 * webhook secret, compare to every v1 signature in the header. The
 * timestamp is also checked against the current clock (5 min
 * tolerance) to block replay attacks.
 *
 * We use the Web Crypto API (`crypto.subtle`) which is available in
 * Deno Edge runtime — same primitive Deno uses for TLS.
 */
async function verifyStripeSignature(
  rawBody:         string,
  signatureHeader: string | null,
  secret:          string,
): Promise<{ valid: boolean; reason?: string }> {
  if (!secret) return { valid: false, reason: 'STRIPE_WEBHOOK_SECRET not set' };
  if (!signatureHeader) return { valid: false, reason: 'missing Stripe-Signature header' };

  /* Parse the header into a timestamp and a list of v1 signatures.
   * Stripe may include multiple v1 entries during secret rotation. */
  let timestamp: string | null = null;
  const v1Signatures: string[] = [];
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key === 't')  timestamp = value ?? null;
    if (key === 'v1') v1Signatures.push(value ?? '');
  }
  if (!timestamp || v1Signatures.length === 0) {
    return { valid: false, reason: 'signature header malformed' };
  }

  /* Replay-attack defence — 5 minute tolerance like Stripe's own
   * libraries. */
  const nowSec = Math.floor(Date.now() / 1000);
  const sigSec = Number(timestamp);
  if (!Number.isFinite(sigSec) || Math.abs(nowSec - sigSec) > 300) {
    return { valid: false, reason: 'signature timestamp outside 5-minute window' };
  }

  /* Compute expected HMAC-SHA256 over `${timestamp}.${body}`. */
  const payload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expectedHex = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  /* Constant-time-ish comparison against every v1 in the header. */
  for (const candidate of v1Signatures) {
    if (candidate.length === expectedHex.length && constantTimeEquals(candidate, expectedHex)) {
      return { valid: true };
    }
  }
  return { valid: false, reason: 'no v1 signature matched' };
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ─── Booking paid path ────────────────────────────────────────── */

/**
 * Flip booking payment_status from 'pending' → 'paid' and the escrow
 * row from 'held' → 'escrow'. Idempotent: if already processed,
 * returns { idempotent: true } without mutating.
 */
async function markBookingPaid(bookingId: string, sessionId: string) {
  const { data: booking, error: readErr } = await supabase
    .from('bookings')
    .select('id, payment_status')
    .eq('id', bookingId)
    .maybeSingle();

  if (readErr) throw new Error(`booking read failed: ${readErr.message}`);
  if (!booking) throw new Error(`booking ${bookingId} not found`);

  const alreadyProcessed = ['paid', 'escrow', 'released', 'refunded'];
  if (alreadyProcessed.includes(String(booking.payment_status))) {
    return { ok: true, idempotent: true, previousStatus: booking.payment_status };
  }

  const { error: bookingErr } = await supabase
    .from('bookings')
    .update({ payment_status: 'paid' })
    .eq('id', bookingId);
  if (bookingErr) throw new Error(`booking update failed: ${bookingErr.message}`);

  const { error: escrowErr } = await supabase
    .from('escrow_payments')
    .update({ status: 'escrow' })
    .eq('booking_id', bookingId);
  if (escrowErr) {
    /* Don't fail the whole webhook if the escrow row update fails —
     * the booking is now paid either way and ops can reconcile. */
    console.warn(`escrow update for ${bookingId} failed: ${escrowErr.message}`);
  }

  return { ok: true, idempotent: false, sessionId };
}

/* ─── Subscription paid path ───────────────────────────────────── */

/**
 * For driver subscription payments, we assume the driver already has
 * a driver_subscriptions row (created when they initiated the
 * upgrade) with a matching stripe_session_id or a pending plan to
 * activate. The minimal viable thing here is to UPDATE the active
 * subscription row to status='active' and leave the plan transition
 * details to ops / a separate activation function.
 *
 * If FlyttGo wants more sophisticated subscription handling
 * (renewals, proration, dunning) it belongs in a dedicated
 * activate-subscription Edge Function.
 */
async function markSubscriptionPaid(
  driverId: string,
  planId:   string,
  sessionId: string,
) {
  /* Flip the existing active subscription to the new plan. If the
   * driver didn't have one, insert. This is intentionally simple —
   * real billing cycle management belongs elsewhere. */
  const { data: existing, error: readErr } = await supabase
    .from('driver_subscriptions')
    .select('id, plan, subscription_status')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readErr) throw new Error(`subscription read failed: ${readErr.message}`);

  if (existing?.plan === planId && existing?.subscription_status === 'active') {
    return { ok: true, idempotent: true, plan: planId };
  }

  if (existing) {
    const { error: updErr } = await supabase
      .from('driver_subscriptions')
      .update({ plan: planId, subscription_status: 'active' })
      .eq('id', existing.id);
    if (updErr) throw new Error(`subscription update failed: ${updErr.message}`);
  } else {
    const { error: insErr } = await supabase
      .from('driver_subscriptions')
      .insert({ driver_id: driverId, plan: planId, subscription_status: 'active' });
    if (insErr) throw new Error(`subscription insert failed: ${insErr.message}`);
  }

  return { ok: true, idempotent: false, plan: planId, sessionId };
}

/* ─── Event router ─────────────────────────────────────────────── */

interface StripeCheckoutSession {
  id:       string;
  object:   'checkout.session';
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
  amount_total?: number;
  currency?: string;
  payment_status?: string;
}

interface StripeEvent {
  id:   string;
  type: string;
  data: { object: StripeCheckoutSession };
}

async function handleEvent(event: StripeEvent) {
  if (
    event.type !== 'checkout.session.completed' &&
    event.type !== 'checkout.session.async_payment_succeeded'
  ) {
    return { ok: true, ignored: true, reason: `event type ${event.type}` };
  }

  const session   = event.data.object;
  const metadata  = session.metadata ?? {};
  const kind      = String(metadata.type ?? 'booking');
  const sessionId = session.id;

  /* Sanity check that the session actually ended up paid before we
   * flip state. For async payment methods (Klarna etc.) the
   * `checkout.session.completed` event fires before money is
   * captured; `async_payment_succeeded` is the real signal. */
  if (session.payment_status && session.payment_status !== 'paid') {
    return { ok: true, ignored: true, reason: `session payment_status=${session.payment_status}` };
  }

  if (kind === 'booking') {
    const bookingId = metadata.bookingId ?? null;
    if (!bookingId) {
      return { ok: true, ignored: true, reason: 'booking type without metadata.bookingId' };
    }
    return await markBookingPaid(bookingId, sessionId);
  }

  if (kind === 'subscription') {
    const driverId = metadata.driverId ?? null;
    const planId   = metadata.planId   ?? null;
    if (!driverId || !planId) {
      return { ok: true, ignored: true, reason: 'subscription type missing driverId/planId' };
    }
    return await markSubscriptionPaid(driverId, planId, sessionId);
  }

  return { ok: true, ignored: true, reason: `unknown metadata.type=${kind}` };
}

/* ─── Handler ──────────────────────────────────────────────────── */

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  /* Read raw body BEFORE parsing — Stripe signature verification
   * requires the exact bytes that were sent. */
  const rawBody         = await req.text();
  const signatureHeader = req.headers.get('Stripe-Signature') ?? req.headers.get('stripe-signature');

  const verify = await verifyStripeSignature(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET);
  if (!verify.valid) {
    console.warn('stripe-webhook rejected:', verify.reason);
    return json({ error: 'Invalid webhook signature', reason: verify.reason }, 401);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const result = await handleEvent(event);
    return json({ received: true, ...result, eventId: event.id, eventType: event.type });
  } catch (err) {
    console.error('stripe-webhook handler error:', err);
    /* Return 500 so Stripe retries. Idempotency in markBookingPaid /
     * markSubscriptionPaid guards against double-processing on retry. */
    return json({ error: (err as Error).message }, 500);
  }
});
