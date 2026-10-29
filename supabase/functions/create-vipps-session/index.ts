// ============================================================================
// FlyttGo — create-vipps-session Edge Function
// ============================================================================
//
// Creates a Vipps Checkout session so FlyttGo customers can pay for a
// booking (or a driver subscription) with Vipps. Returns a redirect URL
// the frontend navigates to so the customer completes payment in the
// Vipps app or web checkout.
//
// API version note
// ----------------
// The user originally asked for "Vipps Checkout API v2". v2 was the old
// ePayment API and has been deprecated. This function uses Vipps
// Checkout API **v3**, which is the currently supported endpoint
// (POST /checkout/v3/session). All the env-var names, the request
// shape, and the response shape requested in the spec still apply.
//
// DEPLOY
// ------
//   supabase functions deploy create-vipps-session --no-verify-jwt
//
// REQUIRED SECRETS
// ----------------
//   supabase secrets set VIPPS_CLIENT_ID=<your-client-id>
//   supabase secrets set VIPPS_CLIENT_SECRET=<your-client-secret>
//   supabase secrets set VIPPS_SUBSCRIPTION_KEY=<your-subscription-key>
//   supabase secrets set VIPPS_MSN=<your-merchant-serial-number>
//   supabase secrets set VIPPS_WEBHOOK_SECRET=<any-long-random-string>
//   supabase secrets set VIPPS_MODE=test        # or "production"
//   supabase secrets set FRONTEND_URL=https://flyttgo.no
//
// The VIPPS_WEBHOOK_SECRET is passed to Vipps as the session's
// callbackAuthorizationToken. Vipps echoes it back verbatim in the
// Authorization header on every webhook call, which vipps-webhook
// verifies before mutating state.
//
// FRONTEND REQUEST
// ----------------
//   POST /functions/v1/create-vipps-session
//   Authorization: Bearer <signed-in user's access token>
//   Content-Type: application/json
//
//   { "bookingId": "a1b2c3d4-e5f6-7890-..." }
//
// The caller must be the booking's customer and the booking must still
// be awaiting payment. The amount is computed on the server from the
// booking (_shared/booking-charge.ts); an `amount` in the body is
// ignored. Driver subscriptions are not sold through Vipps yet: a
// `type: "subscription"` request is refused with 400.
//
// FRONTEND RESPONSE (200)
// -----------------------
//   {
//     "redirectUrl":    "https://vipps.no/checkout/...",   // send customer here
//     "pollingUrl":     "https://api.vipps.no/checkout/...",
//     "sessionToken":   "...",
//     "reference":      "booking-a1b2c3d4-1712934512"
//   }
//
// ============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { serviceClient, getCaller } from '../_shared/auth.ts';
import { chargeForBooking } from '../_shared/booking-charge.ts';
import { VIPPS_BASE, vippsApiHeaders, vippsMissingConfig } from '../_shared/vipps.ts';

/* ─── Env ──────────────────────────────────────────────────────── */
const VIPPS_WEBHOOK_SECRET   = Deno.env.get('VIPPS_WEBHOOK_SECRET')   ?? '';
const FRONTEND_URL           = Deno.env.get('FRONTEND_URL')           ?? 'https://flyttgo.no';
const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')           ?? '';

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

/* ─── Checkout session creation ────────────────────────────────── */

interface CreateSessionInput {
  bookingId:    string;
  amount:       number;   // whole NOK, computed on the server
  description?: string;
}

interface CreateSessionOutput {
  redirectUrl:  string;
  pollingUrl:   string;
  sessionToken: string;
  reference:    string;
  amount:       number;
  provider:     'vipps';
}

async function createCheckoutSession(
  input: CreateSessionInput,
): Promise<CreateSessionOutput> {
  const amountOre = Math.round(input.amount * 100); // NOK → øre
  if (!Number.isFinite(amountOre) || amountOre <= 0) {
    throw new Error('amount must be a positive number of NOK');
  }

  /* Reference is an arbitrary merchant string Vipps echoes back on
   * webhooks. We encode the bookingId in it so the webhook can look
   * up the booking without needing separate metadata storage.
   *
   * Vipps reference constraint: 8–50 chars, alphanumeric + dashes.
   * UUID is 36 chars, 'booking-' is 8, plus ~13 for the unix ms
   * timestamp — fits comfortably. */
  const reference = `booking-${input.bookingId}-${Date.now()}`;

  /* callbackUrl must be reachable by Vipps's servers. Supabase
   * automatically exposes edge functions at
   *   <SUPABASE_URL>/functions/v1/<function-name>
   * so we derive the webhook URL from SUPABASE_URL. */
  const callbackUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/vipps-webhook`;
  const returnUrl   = `${FRONTEND_URL.replace(/\/$/, '')}/my-bookings?payment=success&ref=${encodeURIComponent(reference)}`;

  const body = {
    merchantInfo: {
      callbackUrl,
      returnUrl,
      /* Vipps passes this string back verbatim in the Authorization
       * header on every webhook call, which is how vipps-webhook
       * verifies the caller. Treat it like a password. */
      callbackAuthorizationToken: VIPPS_WEBHOOK_SECRET,
      /* Required for merchants in Norway. */
      callbackAuthorizationTokenType: 'bearer',
    },
    transaction: {
      amount:  {
        value:    amountOre,
        currency: 'NOK',
      },
      reference,
      paymentDescription: input.description?.slice(0, 100) ?? `FlyttGo booking ${input.bookingId.slice(0, 8)}`,
    },
  };

  const res = await fetch(`${VIPPS_BASE}/checkout/v3/session`, {
    method: 'POST',
    headers: { ...(await vippsApiHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Vipps checkout ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = await res.json();
  /* Vipps Checkout v3 returns:
   *   { token, checkoutFrontendUrl, pollingUrl, expiresAt } */
  const redirectUrl  = data.checkoutFrontendUrl;
  const pollingUrl   = data.pollingUrl;
  const sessionToken = data.token;

  if (!redirectUrl) throw new Error('Vipps checkout response missing checkoutFrontendUrl');

  return { redirectUrl, pollingUrl, sessionToken, reference, amount: input.amount, provider: 'vipps' };
}

/* ─── Handler ──────────────────────────────────────────────────── */

interface RequestBody {
  bookingId?: string;
  type?:      string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  /* Env guard — fail fast with a useful message rather than silently
   * hitting Vipps with an empty header. */
  const missing = vippsMissingConfig();
  if (!VIPPS_WEBHOOK_SECRET)   missing.push('VIPPS_WEBHOOK_SECRET');
  if (!SUPABASE_URL)           missing.push('SUPABASE_URL');
  if (missing.length) {
    return json({ error: 'Vipps not configured', missing }, 500);
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

  if (body?.type === 'subscription') {
    return json({ error: 'Vipps is not available for driver subscriptions yet; pay by card' }, 400);
  }
  if (!body?.bookingId || typeof body.bookingId !== 'string') {
    return json({ error: 'bookingId is required and must be a string' }, 400);
  }

  const charge = await chargeForBooking(db, body.bookingId, caller.id);
  if (!charge.ok) return json({ error: charge.error }, charge.status);

  try {
    const session = await createCheckoutSession({ bookingId: body.bookingId, amount: charge.amountNok });
    return json(session);
  } catch (err) {
    console.error('create-vipps-session error:', err);
    return json({ error: 'Vipps session creation failed', detail: (err as Error).message }, 500);
  }
});
