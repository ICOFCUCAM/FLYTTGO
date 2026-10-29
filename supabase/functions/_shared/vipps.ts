// ============================================================================
// FlyttGo — Vipps API access (shared by create-vipps-session and
// refund-payment)
// ============================================================================

const VIPPS_CLIENT_ID        = Deno.env.get('VIPPS_CLIENT_ID')        ?? '';
const VIPPS_CLIENT_SECRET    = Deno.env.get('VIPPS_CLIENT_SECRET')    ?? '';
const VIPPS_SUBSCRIPTION_KEY = Deno.env.get('VIPPS_SUBSCRIPTION_KEY') ?? '';
const VIPPS_MSN              = Deno.env.get('VIPPS_MSN')              ?? '';
const VIPPS_MODE             = (Deno.env.get('VIPPS_MODE') ?? 'test').toLowerCase();

export const VIPPS_BASE = VIPPS_MODE === 'production' ? 'https://api.vipps.no' : 'https://apitest.vipps.no';

export function vippsMissingConfig(): string[] {
  const missing: string[] = [];
  if (!VIPPS_CLIENT_ID)        missing.push('VIPPS_CLIENT_ID');
  if (!VIPPS_CLIENT_SECRET)    missing.push('VIPPS_CLIENT_SECRET');
  if (!VIPPS_SUBSCRIPTION_KEY) missing.push('VIPPS_SUBSCRIPTION_KEY');
  if (!VIPPS_MSN)              missing.push('VIPPS_MSN');
  return missing;
}

const SYSTEM_HEADERS = {
  'Vipps-System-Name':           'FlyttGo',
  'Vipps-System-Version':        '1.0.0',
  'Vipps-System-Plugin-Name':    'flyttgo-backend',
  'Vipps-System-Plugin-Version': '1.0.0',
};

interface TokenCache { token: string; expiresAt: number }
let tokenCache: TokenCache | null = null;

/** Access token, cached for the life of the function instance. */
export async function getVippsAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const res = await fetch(`${VIPPS_BASE}/accesstoken/get`, {
    method: 'POST',
    headers: {
      /* Custom header names per the Vipps Access Token API, not Basic auth. */
      'client_id':                 VIPPS_CLIENT_ID,
      'client_secret':             VIPPS_CLIENT_SECRET,
      'Ocp-Apim-Subscription-Key': VIPPS_SUBSCRIPTION_KEY,
      'Merchant-Serial-Number':    VIPPS_MSN,
      ...SYSTEM_HEADERS,
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

/** Headers for an authenticated Vipps API call. */
export async function vippsApiHeaders(): Promise<Record<string, string>> {
  return {
    Authorization:               `Bearer ${await getVippsAccessToken()}`,
    'Ocp-Apim-Subscription-Key': VIPPS_SUBSCRIPTION_KEY,
    'Merchant-Serial-Number':    VIPPS_MSN,
    ...SYSTEM_HEADERS,
  };
}
