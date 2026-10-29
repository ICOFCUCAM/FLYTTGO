// ============================================================================
// FlyttGo — config-check Edge Function
// ============================================================================
//
// Which function secrets are set, for the operator: secret values are never
// returned (only "set" or "missing"; for the Stripe key its mode, test or
// live, or what is wrong with it). Plain settings (addresses, modes) are returned as they are.
// Service role key only; called from the SQL editor through
// flyttgo_ops.call_function('config-check') (supabase/ops/schedules.sql).
//
// DEPLOY: supabase functions deploy config-check --no-verify-jwt
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { isServiceRequest } from '../_shared/auth.ts';

const SECRETS = [
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_WEBHOOK_SECRET',
  'RESEND_API_KEY', 'EMAIL_FUNCTION_SECRET',
  'VIPPS_CLIENT_ID', 'VIPPS_CLIENT_SECRET', 'VIPPS_SUBSCRIPTION_KEY', 'VIPPS_MSN', 'VIPPS_WEBHOOK_SECRET',
  'CREDIT_CHECK_API_KEY', 'ROUTE_PROVIDER_KEY', 'ROUTE_PROVIDER_URL',
];
const SETTINGS = [
  'FRONTEND_URL', 'FLYTTGO_FROM', 'FLYTTGO_REPLY_TO', 'WHITE_LABEL_CNAME_TARGET', 'VIPPS_MODE',
  'ROUTE_PROVIDER_KIND',
];

/** The kind of a Stripe key, from its public prefix only. */
function stripeKind(v: string): string {
  const notes: string[] = [];
  if (v !== v.trim()) notes.push('has spaces or a line break at the start or end');
  if (/^["']|["']$/.test(v.trim())) notes.push('is wrapped in quotes');
  const t = v.trim().replace(/^["']|["']$/g, '');
  const m = /^(sk|rk|pk|whsec)_(live|test)?_?/.exec(t);
  const kind = !m ? 'not a Stripe key prefix'
    : m[1] === 'pk' ? `a publishable key (pk_${m[2] ?? ''}), not the secret key`
    : m[1] === 'whsec' ? 'a webhook signing secret (whsec_), not the secret key'
    : `${m[1]}_${m[2] ?? '?'}`;
  return [kind, ...notes].join('; ');
}

serve((req: Request) => {
  if (!isServiceRequest(req)) return new Response(JSON.stringify({ error: 'service role only' }), { status: 403 });
  const secrets: Record<string, string> = {};
  for (const n of SECRETS) secrets[n] = Deno.env.get(n) ? 'set' : 'missing';
  const stripe = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  if (stripe) secrets.STRIPE_SECRET_KEY = `set: ${stripeKind(stripe)}`;
  const hook = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  if (hook) secrets.STRIPE_WEBHOOK_SECRET = /^whsec_/.test(hook.trim()) ? 'set: whsec_' : 'set: does not start with whsec_';
  const settings: Record<string, string | null> = {};
  for (const n of SETTINGS) settings[n] = Deno.env.get(n) ?? null;
  return new Response(JSON.stringify({ secrets, settings }), { headers: { 'Content-Type': 'application/json' } });
});
