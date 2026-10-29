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
//                                      payment_status: 'pending' → 'paid',
//                                      with provider, PaymentIntent id and
//                                      amount paid (needed for refunds)
//                                    + the related escrow_payments row
//                                      status: 'held' → 'escrow'
//
//   metadata.type = 'subscription' → activates the plan through
//                                     change_driver_subscription
//                                     (plan_id, end date from the plan's
//                                      billing period).
//
// and refund.created / refund.updated / refund.failed for refunds made
// by refund-payment (metadata.refund_id) → refund_mark.
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
// select the events `checkout.session.completed`,
// `checkout.session.async_payment_succeeded`, `refund.created`,
// `refund.updated` and `refund.failed`, save, then click
// "Reveal" next to "Signing secret" and copy the whsec_... string.
//
// IDEMPOTENCY
// -----------
// Stripe uses at-least-once delivery, so the same event can arrive
// twice on retries. Every processed event is recorded in
// payment_events (provider, event id) and skipped when seen again;
// the booking path also checks the current payment_status, and
// refund_mark applies a refund's effects once.
//
// ============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { paidAmountMatches } from '../_shared/pricing.ts';
import { mapStripeRefundStatus } from '../_shared/refunds.ts';

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
async function markBookingPaid(bookingId: string, session: StripeCheckoutSession) {
  const sessionId = session.id;
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

  /* The provider reference and the amount actually paid are what a
   * refund is later sent back against (refund-payment). */
  const { error: bookingErr } = await supabase
    .from('bookings')
    .update({
      payment_status:    'paid',
      payment_provider:  'stripe',
      payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      stripe_session_id: sessionId,
      paid_amount:       typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
      paid_at:           new Date().toISOString(),
    })
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

/**
 * Record that a provider reported a payment that does not match what
 * we charged. The booking stays unpaid (no escrow, no dispatch) until
 * someone reviews it; the provider gets a 200 so it stops retrying.
 */
async function flagPaymentReview(bookingId: string, reason: string) {
  console.error(`payment held for review — booking ${bookingId}: ${reason}`);
  const { error } = await supabase
    .from('bookings')
    .update({ payment_review_reason: reason.slice(0, 500) })
    .eq('id', bookingId);
  if (error) console.warn(`payment_review_reason update failed: ${error.message}`);
  return { ok: true, held: true, reason: 'amount mismatch; held for review' };
}

/* ─── Subscription paid path ───────────────────────────────────── */

/**
 * A paid driver subscription: activate the plan through
 * change_driver_subscription (service role), which resolves the plan
 * slug to plan_id, sets the end date from the plan's billing period and
 * keeps driver_profiles.subscription_plan in step — the same path as
 * every other plan change. Retries are filtered out by payment_events.
 */
async function markSubscriptionPaid(
  driverUserId: string,
  planId:       string,
  session:      StripeCheckoutSession,
) {
  const { error } = await supabase.rpc('change_driver_subscription', {
    p_driver_id: driverUserId,
    p_new_plan:  planId,
  });
  if (error) throw new Error(`plan activation failed: ${error.message}`);

  /* Record what was paid on the now-active row. */
  const paid = typeof session.amount_total === 'number' ? session.amount_total / 100 : null;
  if (paid !== null) {
    const { data: active } = await supabase
      .from('driver_subscriptions')
      .select('id')
      .eq('driver_id', driverUserId)
      .eq('subscription_status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (active) {
      await supabase.from('driver_subscriptions')
        .update({ amount_paid_nok: paid, vat_nok: Math.round(paid - paid / 1.25), payment_method: 'stripe' })
        .eq('id', active.id);
    }
  }
  return { ok: true, plan: planId, sessionId: session.id };
}

/* ─── Refund updates ───────────────────────────────────────────── */

/**
 * refund.updated / refund.failed for refunds created by refund-payment
 * (metadata.refund_id). refund_mark applies the database effects on the
 * first 'succeeded', once, and never moves a refund back.
 */
async function updateRefund(refund: StripeRefund) {
  const refundId = refund.metadata?.refund_id;
  if (!refundId) return { ok: true, ignored: true, reason: 'refund not created by FlyttGo' };
  const { error } = await supabase.rpc('refund_mark', {
    p_refund_id:          refundId,
    p_status:             mapStripeRefundStatus(refund.status),
    p_provider_refund_id: refund.id,
    p_error:              refund.failure_reason ?? null,
  });
  if (error) throw new Error(`refund_mark failed: ${error.message}`);
  return { ok: true, refundId, status: refund.status };
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
  payment_intent?: string | null;
}

interface StripeRefund {
  id:      string;
  object:  'refund';
  status?: string;
  amount?: number;
  failure_reason?: string | null;
  metadata?: Record<string, string>;
}

interface StripeEvent {
  id:   string;
  type: string;
  data: { object: StripeCheckoutSession | StripeRefund };
}

async function handleEvent(event: StripeEvent) {
  if (event.type === 'refund.updated' || event.type === 'refund.failed' || event.type === 'refund.created') {
    return await updateRefund(event.data.object as StripeRefund);
  }
  if (
    event.type !== 'checkout.session.completed' &&
    event.type !== 'checkout.session.async_payment_succeeded'
  ) {
    return { ok: true, ignored: true, reason: `event type ${event.type}` };
  }

  const session   = event.data.object as StripeCheckoutSession;
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

  /* The amount must be exactly what create-checkout-session asked
   * for (metadata.amount_ore is written by the server, never the
   * browser). Sessions created before that field existed carried a
   * browser-chosen amount and are held for review, not marked paid. */
  const expectedOre = Number(metadata.amount_ore);
  const amountOk = Number.isFinite(expectedOre) && expectedOre > 0 &&
    paidAmountMatches(session.amount_total, session.currency, expectedOre / 100);

  if (kind === 'booking') {
    const bookingId = metadata.bookingId ?? null;
    if (!bookingId) {
      return { ok: true, ignored: true, reason: 'booking type without metadata.bookingId' };
    }
    if (!amountOk) {
      const reason = `stripe ${sessionId}: paid ${session.amount_total} ${session.currency ?? '?'}, expected ${metadata.amount_ore ?? 'unknown'} øre`;
      return await flagPaymentReview(bookingId, reason);
    }
    return await markBookingPaid(bookingId, session);
  }

  if (kind === 'subscription') {
    /* driver_subscriptions.driver_id is the auth user id. Sessions
     * created before this change put driver_profiles.id in driverId
     * and the auth id in userId, so prefer the user id fields. */
    const driverId = metadata.user_id ?? metadata.userId ?? metadata.driverId ?? null;
    const planId   = metadata.planId   ?? null;
    if (!driverId || !planId) {
      return { ok: true, ignored: true, reason: 'subscription type missing driverId/planId' };
    }
    if (!amountOk) {
      console.error(`stripe-webhook: subscription ${sessionId} for ${driverId} paid ${session.amount_total} ${session.currency}, expected ${metadata.amount_ore ?? 'unknown'} øre — not activated`);
      return { ok: true, ignored: true, reason: 'amount mismatch; held for review' };
    }
    return await markSubscriptionPaid(driverId, planId, session);
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
    /* Each event is applied once: Stripe retries and may deliver twice. */
    const { data: seen } = await supabase
      .from('payment_events')
      .select('event_id')
      .eq('provider', 'stripe')
      .eq('event_id', event.id)
      .maybeSingle();
    if (seen) return json({ received: true, duplicate: true, eventId: event.id, eventType: event.type });

    const result = await handleEvent(event);
    const meta = (event.data.object as { metadata?: Record<string, string> }).metadata ?? {};
    const { error: logErr } = await supabase.from('payment_events').insert({
      provider: 'stripe', event_id: event.id, kind: event.type,
      booking_id: meta.bookingId ?? meta.booking_id ?? null, result,
    });
    if (logErr && logErr.code !== '23505') console.warn(`payment_events insert failed: ${logErr.message}`);
    return json({ received: true, ...result, eventId: event.id, eventType: event.type });
  } catch (err) {
    console.error('stripe-webhook handler error:', err);
    /* Return 500 so Stripe retries. Idempotency in markBookingPaid /
     * markSubscriptionPaid guards against double-processing on retry. */
    return json({ error: (err as Error).message }, 500);
  }
});
