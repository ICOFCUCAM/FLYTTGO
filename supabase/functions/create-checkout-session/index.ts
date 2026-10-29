// ============================================================================
// FlyttGo — create-checkout-session Edge Function (Stripe)
// ============================================================================
//
// Creates a Stripe Checkout session so FlyttGo customers can pay for a
// booking (or a driver subscription) with card, Google Pay or Apple Pay.
// Returns a redirect URL the frontend navigates to so the customer
// completes payment on Stripe's hosted page.
//
// This version supersedes the older Supabase-only one that had three
// bugs:
//   1) No CORS headers → every browser call failed preflight silently,
//      which caused PaymentPage to fall through to its escrow-update
//      fallback path and show a success screen without capturing money.
//   2) Hardcoded success/cancel URLs pointing at example.com → after
//      payment the customer landed on a random domain.
//   3) Ignored the `method` parameter PaymentPage sends, so there was
//      no wallet or alternative-method routing.
//
// DEPLOY
// ------
//   supabase functions deploy create-checkout-session --no-verify-jwt
//
// REQUIRED SECRETS
// ----------------
//   supabase secrets set STRIPE_SECRET_KEY=<sk_test_... or sk_live_...>
//   supabase secrets set FRONTEND_URL=https://flyttgo.no
//
// Optional (used by stripe-webhook, not read here):
//   supabase secrets set STRIPE_WEBHOOK_SECRET=<whsec_...>
//
// FRONTEND REQUEST
// ----------------
//   POST /functions/v1/create-checkout-session
//   Authorization: Bearer <signed-in user's access token>
//   Content-Type: application/json
//
//   { "bookingId": "a1b2c3d4-...", "method": "card" | "google_pay" | ... }
//
// The caller must be the booking's customer and the booking must still
// be awaiting payment. The amount is NOT taken from the request: it is
// re-computed on the server from the booking (see
// _shared/booking-charge.ts). An `amount` in the body is ignored.
//
// A booking the company sells on its own page (white label, Model B) is a
// direct charge on the company's connected Stripe account, at the
// company's price, with FlyttGo's price and platform fee taken as the
// application fee (docs/WHITE_LABEL.md). The customer returns to the
// company's domain when it has one.
//
// Subscription request shape from DriverPortal:
//
//   { "type": "subscription", "planId": "pro" }
//
// The driver is the signed-in caller; the price (with the Pro →
// Unlimited proration) comes from _shared/pricing.ts.
//
// FRONTEND RESPONSE (200)
// -----------------------
//   {
//     "url":      "https://checkout.stripe.com/...",  // window.location.href = url
//     "sessionId":"cs_test_...",
//     "reference":"booking-a1b2c3d4-1712934512",
//     "provider": "stripe"
//   }
//
// ============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { serviceClient, getCaller, driverProfileIdOf } from '../_shared/auth.ts';
import { chargeForBooking } from '../_shared/booking-charge.ts';
import { subscriptionCharge, DRIVER_PLAN_LABELS } from '../_shared/pricing.ts';
import { currentSubscription } from '../_shared/plans.ts';

/* ─── Env ──────────────────────────────────────────────────────── */
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const FRONTEND_URL      = (Deno.env.get('FRONTEND_URL') ?? 'https://flyttgo.no').replace(/\/$/, '');

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

/* ─── Request shapes ───────────────────────────────────────────── */

interface BookingRequest {
  type?:     undefined;
  bookingId: string;
  method?:   'card' | 'google_pay' | 'apple_pay' | 'klarna' | 'link';
}

interface SubscriptionRequest {
  type:   'subscription';
  planId: string;
}

type RequestBody = BookingRequest | SubscriptionRequest;

function isSubscription(body: RequestBody): body is SubscriptionRequest {
  return (body as SubscriptionRequest).type === 'subscription';
}

/* ─── Handler ──────────────────────────────────────────────────── */

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  if (!STRIPE_SECRET_KEY) {
    return json({ error: 'STRIPE_SECRET_KEY not configured' }, 500);
  }

  const db     = serviceClient();
  const caller = await getCaller(req, db);
  if (!caller) return json({ error: 'Sign in required' }, 401);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  let amountNok:     number;
  let reference:     string;
  let productName:   string;
  let description:   string | undefined;
  let customerEmail: string | null = null;
  let connect:       { account: string; applicationFeeOre: number; siteBase: string | null } | null = null;
  const metadata:    Record<string, string> = {};

  if (isSubscription(body)) {
    if (!body.planId || typeof body.planId !== 'string') {
      return json({ error: 'planId is required for subscription type' }, 400);
    }
    if (!(await driverProfileIdOf(db, caller.id))) {
      return json({ error: 'Only drivers can buy a driver subscription' }, 403);
    }
    /* driver_subscriptions.driver_id is the auth user id (DriverPortal,
     * the dispatch engine and stripe-webhook all key on it). */
    const current = await currentSubscription(db, caller.id);
    const charge = subscriptionCharge(body.planId, current);
    if (!charge) return json({ error: `plan ${body.planId} has nothing to pay` }, 400);
    if (charge.total <= 0) return json({ error: 'nothing to pay for this plan change' }, 409);

    amountNok   = charge.total;
    reference   = `subscription-${caller.id}-${body.planId}-${Date.now()}`;
    productName = `FlyttGo ${DRIVER_PLAN_LABELS[body.planId] ?? body.planId} subscription`;
    description = charge.prorated
      ? `Prorated: ${charge.creditExVat} NOK ex. MVA credit for unused Pro days (incl. 25% MVA)`
      : 'Incl. 25% MVA';
    metadata.type     = 'subscription';
    metadata.driverId = caller.id;
    metadata.planId   = body.planId;
  } else {
    if (!body.bookingId || typeof body.bookingId !== 'string') {
      return json({ error: 'bookingId is required' }, 400);
    }
    const charge = await chargeForBooking(db, body.bookingId, caller.id, { allowConnect: true });
    if (!charge.ok) return json({ error: charge.error }, charge.status);

    amountNok     = charge.amountNok;
    customerEmail = charge.customerEmail ?? caller.email;
    reference     = `booking-${body.bookingId}-${Date.now()}`;
    productName   = charge.connect
      ? `${charge.connect.sellerName}: moving booking ${body.bookingId.slice(0, 8)}`
      : `FlyttGo booking ${body.bookingId.slice(0, 8)}`;
    description   = 'Incl. 25% MVA';
    if (charge.connect) {
      connect = charge.connect;
      metadata.connected_account = charge.connect.account;
      metadata.application_fee_ore = String(charge.connect.applicationFeeOre);
    }
    metadata.type      = 'booking';
    metadata.bookingId = body.bookingId;
  }

  const amountOre = Math.round(amountNok * 100); // NOK → øre
  metadata.reference = reference;
  /* What we asked Stripe to charge. stripe-webhook compares the paid
   * amount with this before marking anything paid. */
  metadata.amount_ore = String(amountOre);
  metadata.user_id    = caller.id;

  /* Success / cancel URLs now point at real FlyttGo paths and include
   * the Stripe session id + reference so the frontend can display
   * the right confirmation UI on return. */
  const base = connect?.siteBase ?? FRONTEND_URL;
  const successUrl = `${base}/my-bookings?payment=success&session_id={CHECKOUT_SESSION_ID}&ref=${encodeURIComponent(reference)}`;
  const cancelUrl  = isSubscription(body)
    ? `${FRONTEND_URL}/driver-subscriptions?payment=cancelled`
    : `${base}/payment?payment=cancelled&ref=${encodeURIComponent(reference)}`;

  /* Build Stripe's URL-encoded form body. Stripe's REST API is
   * x-www-form-urlencoded with bracketed field names rather than
   * JSON, which is why we assemble URLSearchParams manually.
   *
   * Payment method types: we always include `card`. Stripe Checkout
   * automatically enables Google Pay / Apple Pay / Link as wallet
   * overlays on top of the card flow for supported devices, so the
   * client-supplied `method` is a UI hint only. */
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', successUrl);
  params.set('cancel_url',  cancelUrl);
  params.append('payment_method_types[]', 'card');

  if (!isSubscription(body) && (body.method === 'klarna')) {
    params.append('payment_method_types[]', 'klarna');
  }

  /* Line item. One line item = the full booking/subscription total
   * including MVA. The customer sees this label in Stripe Checkout. */
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'nok');
  params.set('line_items[0][price_data][unit_amount]', String(amountOre));
  params.set('line_items[0][price_data][product_data][name]', productName);
  if (description) {
    params.set('line_items[0][price_data][product_data][description]', description.slice(0, 240));
  }

  /* Reference + metadata — both client_reference_id and metadata
   * make their way into the Stripe webhook event. */
  params.set('client_reference_id', reference);
  for (const [k, v] of Object.entries(metadata)) {
    params.set(`metadata[${k}]`, String(v));
  }

  if (customerEmail) {
    params.set('customer_email', customerEmail);
  }

  /* Model B: FlyttGo's share comes out of the company's payment. */
  if (connect) {
    params.set('payment_intent_data[application_fee_amount]', String(connect.applicationFeeOre));
    for (const [k, v] of Object.entries(metadata)) params.set(`payment_intent_data[metadata][${k}]`, String(v));
  }

  /* Call Stripe. */
  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
      ...(connect ? { 'Stripe-Account': connect.account } : {}),
    },
    body: params,
  });

  const stripeText = await stripeRes.text();

  if (!stripeRes.ok) {
    console.error('Stripe checkout error:', stripeRes.status, stripeText.slice(0, 400));
    /* Surface Stripe's own error message to the client so the
     * frontend can show something useful instead of a generic
     * "something went wrong". Truncated to avoid leaking stack
     * traces. */
    let detail = stripeText.slice(0, 400);
    try { detail = JSON.parse(stripeText).error?.message ?? detail; } catch { /* keep raw */ }
    return json({ error: 'Stripe session creation failed', detail }, 502);
  }

  let session: { id?: string; url?: string };
  try {
    session = JSON.parse(stripeText);
  } catch {
    return json({ error: 'Stripe returned non-JSON response' }, 502);
  }

  if (!session.url) {
    return json({ error: 'Stripe session has no url', session }, 502);
  }

  return json({
    url:       session.url,
    sessionId: session.id,
    reference,
    amount:    amountNok,
    provider:  'stripe',
    seller:    connect ? 'company' : 'flyttgo',
  });
});
