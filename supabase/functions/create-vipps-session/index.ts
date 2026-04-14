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
//   Content-Type: application/json
//
//   {
//     "bookingId": "a1b2c3d4-e5f6-7890-...",   // uuid from bookings table
//     "amount":    4025,                         // NOK, whole number
//     "description": "FlyttGo booking"          // optional
//   }
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

/* ─── Env ──────────────────────────────────────────────────────── */
const VIPPS_CLIENT_ID        = Deno.env.get('VIPPS_CLIENT_ID')        ?? '';
const VIPPS_CLIENT_SECRET    = Deno.env.get('VIPPS_CLIENT_SECRET')    ?? '';
const VIPPS_SUBSCRIPTION_KEY = Deno.env.get('VIPPS_SUBSCRIPTION_KEY') ?? '';
const VIPPS_MSN              = Deno.env.get('VIPPS_MSN')              ?? '';
const VIPPS_WEBHOOK_SECRET   = Deno.env.get('VIPPS_WEBHOOK_SECRET')   ?? '';
const VIPPS_MODE             = (Deno.env.get('VIPPS_MODE') ?? 'test').toLowerCase();
const FRONTEND_URL           = Deno.env.get('FRONTEND_URL')           ?? 'https://flyttgo.no';
const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')           ?? '';

const VIPPS_BASE = VIPPS_MODE === 'production'
  ? 'https://api.vipps.no'
  : 'https://apitest.vipps.no';

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

/* ─── Access token (cached across invocations of the same instance) ── */

interface TokenCache { token: string; expiresAt: number }
let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const res = await fetch(`${VIPPS_BASE}/accesstoken/get`, {
    method: 'POST',
    headers: {
      /* Per Vipps Access Token API — these are custom header names, NOT
       * HTTP Basic auth. All four must be present. */
      'client_id':                VIPPS_CLIENT_ID,
      'client_secret':            VIPPS_CLIENT_SECRET,
      'Ocp-Apim-Subscription-Key': VIPPS_SUBSCRIPTION_KEY,
      'Merchant-Serial-Number':   VIPPS_MSN,
      'Vipps-System-Name':        'FlyttGo',
      'Vipps-System-Version':     '1.0.0',
      'Vipps-System-Plugin-Name': 'flyttgo-backend',
      'Vipps-System-Plugin-Version': '1.0.0',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Vipps access-token ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const token = data.access_token as string | undefined;
  const ttlSec = Number(data.expires_in ?? 3600);

  if (!token) throw new Error('Vipps access-token response missing access_token field');

  /* Subtract 60 s so we never serve an about-to-expire token. */
  tokenCache = { token, expiresAt: Date.now() + (ttlSec - 60) * 1000 };
  return token;
}

/* ─── Checkout session creation ────────────────────────────────── */

interface CreateSessionInput {
  bookingId:    string;
  amount:       number;   // whole NOK
  description?: string;
}

interface CreateSessionOutput {
  redirectUrl:  string;
  pollingUrl:   string;
  sessionToken: string;
  reference:    string;
  provider:     'vipps';
}

async function createCheckoutSession(
  accessToken: string,
  input:       CreateSessionInput,
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
    headers: {
      'Authorization':              `Bearer ${accessToken}`,
      'Ocp-Apim-Subscription-Key':  VIPPS_SUBSCRIPTION_KEY,
      'Merchant-Serial-Number':     VIPPS_MSN,
      'Vipps-System-Name':          'FlyttGo',
      'Vipps-System-Version':       '1.0.0',
      'Vipps-System-Plugin-Name':   'flyttgo-backend',
      'Vipps-System-Plugin-Version':'1.0.0',
      'Content-Type':               'application/json',
    },
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

  return { redirectUrl, pollingUrl, sessionToken, reference, provider: 'vipps' };
}

/* ─── Handler ──────────────────────────────────────────────────── */

interface RequestBody {
  bookingId:    string;
  amount:       number;
  description?: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  /* Env guard — fail fast with a useful message rather than silently
   * hitting Vipps with an empty header. */
  const missing: string[] = [];
  if (!VIPPS_CLIENT_ID)        missing.push('VIPPS_CLIENT_ID');
  if (!VIPPS_CLIENT_SECRET)    missing.push('VIPPS_CLIENT_SECRET');
  if (!VIPPS_SUBSCRIPTION_KEY) missing.push('VIPPS_SUBSCRIPTION_KEY');
  if (!VIPPS_MSN)              missing.push('VIPPS_MSN');
  if (!VIPPS_WEBHOOK_SECRET)   missing.push('VIPPS_WEBHOOK_SECRET');
  if (!SUPABASE_URL)           missing.push('SUPABASE_URL');
  if (missing.length) {
    return json({ error: 'Vipps not configured', missing }, 500);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body?.bookingId || typeof body.bookingId !== 'string') {
    return json({ error: 'bookingId is required and must be a string' }, 400);
  }
  if (!body?.amount || typeof body.amount !== 'number' || body.amount <= 0) {
    return json({ error: 'amount is required and must be a positive number (NOK)' }, 400);
  }

  try {
    const token   = await getAccessToken();
    const session = await createCheckoutSession(token, body);
    return json(session);
  } catch (err) {
    console.error('create-vipps-session error:', err);
    return json({ error: 'Vipps session creation failed', detail: (err as Error).message }, 500);
  }
});
