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
//   Content-Type: application/json
//
//   {
//     "bookingId":    "a1b2c3d4-e5f6-7890-...",      // uuid from bookings
//     "amount":        4025,                          // whole NOK
//     "method":        "card" | "google_pay" | ...,  // optional; honoured where it matters
//     "customerEmail": "customer@example.com",        // optional, pre-fills Stripe email
//     "description":   "FlyttGo booking"              // optional
//   }
//
// Alternative (subscription) request shape from DriverPortal:
//
//   {
//     "type":      "subscription",
//     "planId":    "pro",
//     "planLabel": "Pro",
//     "driverId":  "<uuid>",
//     "userId":    "<uuid>",
//     "amount":    1875                               // whole NOK (incl. MVA)
//   }
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
  type?:          undefined;
  bookingId:      string;
  amount:         number;
  method?:        'card' | 'google_pay' | 'apple_pay' | 'klarna' | 'link';
  customerEmail?: string;
  description?:   string;
}

interface SubscriptionRequest {
  type:        'subscription';
  planId:      string;
  planLabel?:  string;
  driverId:    string;
  userId?:     string;
  amount:      number;
  description?:string;
  /* Optional VAT split — our PRICING uses 25% VAT included, so
   * amountExVat + vatAmount should equal amount. Kept loose. */
  amountExVat?: number;
  vatAmount?:   number;
  billing?:     string;
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

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const amount = Number((body as { amount?: unknown }).amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return json({ error: 'amount is required and must be a positive number (NOK)' }, 400);
  }

  /* Build the common pieces up-front and then branch on request type. */
  const amountOre = Math.round(amount * 100); // NOK → øre

  let reference:   string;
  let productName: string;
  const metadata:  Record<string, string> = {};

  if (isSubscription(body)) {
    if (!body.planId || !body.driverId) {
      return json({ error: 'planId and driverId are required for subscription type' }, 400);
    }
    reference   = `subscription-${body.driverId}-${body.planId}-${Date.now()}`;
    productName = `FlyttGo ${body.planLabel ?? body.planId} subscription`;
    metadata.type     = 'subscription';
    metadata.driverId = body.driverId;
    metadata.planId   = body.planId;
    if (body.userId)      metadata.userId   = body.userId;
    if (body.billing)     metadata.billing  = body.billing;
  } else {
    if (!body.bookingId) {
      return json({ error: 'bookingId is required' }, 400);
    }
    reference   = `booking-${body.bookingId}-${Date.now()}`;
    productName = body.description?.slice(0, 80) ?? `FlyttGo booking ${body.bookingId.slice(0, 8)}`;
    metadata.type      = 'booking';
    metadata.bookingId = body.bookingId;
  }
  metadata.reference = reference;

  /* Success / cancel URLs now point at real FlyttGo paths and include
   * the Stripe session id + reference so the frontend can display
   * the right confirmation UI on return. */
  const successUrl = `${FRONTEND_URL}/my-bookings?payment=success&session_id={CHECKOUT_SESSION_ID}&ref=${encodeURIComponent(reference)}`;
  const cancelUrl  = isSubscription(body)
    ? `${FRONTEND_URL}/driver-subscriptions?payment=cancelled`
    : `${FRONTEND_URL}/payment?payment=cancelled&ref=${encodeURIComponent(reference)}`;

  /* Build Stripe's URL-encoded form body. Stripe's REST API is
   * x-www-form-urlencoded with bracketed field names rather than
   * JSON, which is why we assemble URLSearchParams manually.
   *
   * Payment method types: we always include `card`. Stripe Checkout
   * automatically enables Google Pay / Apple Pay / Link as wallet
   * overlays on top of the card flow for supported devices, so the
   * client-supplied `method` is a UI hint only — Stripe detects the
   * actual wallet availability from the user agent. Adding
   * `klarna` or `link` explicitly is only needed if you want them
   * as their own rows in the method list. */
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
  if (body.description) {
    params.set('line_items[0][price_data][product_data][description]', body.description.slice(0, 240));
  }

  /* Reference + metadata — both client_reference_id and metadata
   * make their way into the Stripe webhook event, so the webhook
   * can look up the booking by either. client_reference_id is more
   * visible in the Stripe dashboard. */
  params.set('client_reference_id', reference);
  for (const [k, v] of Object.entries(metadata)) {
    params.set(`metadata[${k}]`, String(v));
  }

  /* Pre-fill the customer's email on Stripe's form if we know it.
   * Only for booking payments — subscription payments come from a
   * signed-in driver whose email Stripe will already know if they've
   * paid before. */
  if (!isSubscription(body) && body.customerEmail) {
    params.set('customer_email', body.customerEmail);
  }

  /* Call Stripe. */
  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
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
    provider:  'stripe',
  });
});
