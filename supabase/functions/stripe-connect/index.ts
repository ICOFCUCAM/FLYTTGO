// ============================================================================
// FlyttGo — stripe-connect Edge Function (white label, Model B)
// ============================================================================
//
// A company that sells on its own page (plan Own seller) takes its
// customers' payments into its own Stripe account (docs/WHITE_LABEL.md).
// This function, for the company's owner:
//   action "onboard": creates the company's Stripe account (Standard: the
//                     company has its own Stripe dashboard and is the
//                     merchant) when it has none, and returns Stripe's
//                     onboarding link;
//   action "status":  reads the account from Stripe and records whether it
//                     can take payments (also kept current by the Connect
//                     webhook's account.updated).
//
//   POST /functions/v1/stripe-connect
//   Authorization: Bearer <access token of the company's owner>
//   { "organizationId": "<uuid>", "action": "onboard" | "status" }
//
// DEPLOY: supabase functions deploy stripe-connect --no-verify-jwt
// Needs STRIPE_SECRET_KEY with Connect enabled on FlyttGo's Stripe account,
// and FRONTEND_URL.
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient } from '../_shared/auth.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const FRONTEND_URL = (Deno.env.get('FRONTEND_URL') ?? 'https://flyttgo.no').replace(/\/$/, '');
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

async function stripe(path: string, params?: URLSearchParams, idempotencyKey?: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Stripe-Version': '2024-06-20',
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: params,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? `stripe ${res.status}`), { status: 502 });
  return data;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: 'STRIPE_SECRET_KEY not configured' }, 500);
  const db = serviceClient();
  const caller = await getCaller(req, db);
  if (!caller) return json({ error: 'Sign in required' }, 401);
  const body = await req.json().catch(() => ({})) as { organizationId?: string; action?: string };
  if (!body.organizationId || !['onboard', 'status'].includes(body.action ?? '')) {
    return json({ error: 'organizationId and action (onboard or status) are required' }, 400);
  }
  const org = body.organizationId;

  const { data: member } = await db.from('organization_members').select('role')
    .eq('organization_id', org).eq('user_id', caller.id).eq('status', 'active').maybeSingle();
  if (member?.role !== 'owner') return json({ error: 'the company\'s owner connects its Stripe account' }, 403);
  const { data: wl } = await db.from('organization_white_label').select('plan_code, requested_plan_code, stripe_account_id')
    .eq('organization_id', org).maybeSingle();
  if (!wl) return json({ error: 'choose a plan first' }, 409);
  const { data: plan } = await db.from('white_label_plans').select('seller_model')
    .eq('code', wl.requested_plan_code ?? wl.plan_code).maybeSingle();
  if (plan?.seller_model !== 'company') return json({ error: 'only the Own seller plan takes payments into the company\'s account' }, 409);
  const { data: company } = await db.from('organizations').select('name, billing_email, country').eq('id', org).maybeSingle();

  try {
    let account = wl.stripe_account_id as string | null;
    if (!account && body.action === 'onboard') {
      const p = new URLSearchParams();
      p.set('type', 'standard');
      p.set('country', company?.country ?? 'NO');
      if (company?.billing_email) p.set('email', company.billing_email);
      if (company?.name) p.set('business_profile[name]', company.name);
      p.set('metadata[organization_id]', org);
      const created = await stripe('accounts', p, `flyttgo-connect-${org}`);
      account = created.id;
      const { error } = await db.rpc('set_white_label_stripe_account', { p_org: org, p_account: account, p_charges_enabled: !!created.charges_enabled });
      if (error) return json({ error: error.message }, 409);
    }
    if (!account) return json({ connected: false });

    const acct = await stripe(`accounts/${account}`);
    const { error } = await db.rpc('set_white_label_stripe_account', { p_org: org, p_account: account, p_charges_enabled: !!acct.charges_enabled });
    if (error) return json({ error: error.message }, 409);
    if (body.action === 'status' || acct.charges_enabled) {
      return json({ connected: true, account, charges_enabled: !!acct.charges_enabled, details_submitted: !!acct.details_submitted });
    }
    const link = new URLSearchParams();
    link.set('account', account);
    link.set('type', 'account_onboarding');
    link.set('refresh_url', `${FRONTEND_URL}/business/dashboard?white_label=stripe_refresh`);
    link.set('return_url', `${FRONTEND_URL}/business/dashboard?white_label=stripe_return`);
    const l = await stripe('account_links', link);
    return json({ connected: true, account, charges_enabled: false, url: l.url });
  } catch (e) {
    return json({ error: (e as Error).message }, (e as { status?: number }).status ?? 500);
  }
});
