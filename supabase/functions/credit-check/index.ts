// ============================================================================
// FlyttGo — credit-check Edge Function
// ============================================================================
//
// Built and dormant (decided 2026-10-29). Credit checks are required only
// when an administrator ticks "Require credit check" in the invoice
// settings (platform_config credit_check_enabled). With it on:
//   - invoicing cannot be switched on for a company without a passed check;
//   - a booking cannot be paid on invoice without one, less than
//     credit_check_max_age_days old.
//
// Results come from a provider (set credit_check_provider and its key) or
// from an administrator's manual assessment, recorded with its evidence
// (record_credit_check, 'manual'). Provider adapters plug in below; none
// is connected yet, so 'manual' is the only working source today
// (docs/INVOICING.md, integration point).
//
//   POST /functions/v1/credit-check
//   Authorization: Bearer <administrator's access token>
//   { "organizationId": "<uuid>" }
//
// DEPLOY: supabase functions deploy credit-check --no-verify-jwt
// Secrets: CREDIT_CHECK_API_KEY (when a provider is connected).
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient } from '../_shared/auth.ts';

/** A provider's answer, normalised. */
interface CreditResult { passed: boolean; score: string | null; recommendedLimit: number | null; findings: Record<string, unknown> }
type Provider = (orgNumber: string, apiKey: string) => Promise<CreditResult | { error: string; retry?: boolean }>;

/* Adapters by name (credit_check_provider). Add a provider here, e.g.
 * Creditsafe, Dun & Bradstreet or Experian, mapping its rating and
 * recommended limit into CreditResult. */
const PROVIDERS: Record<string, Provider> = {};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);
  const db = serviceClient();
  const caller = await getCaller(req, db);
  if (!caller)         return json({ error: 'Sign in required' }, 401);
  if (!caller.isAdmin) return json({ error: 'Administrators only' }, 403);
  let body: { organizationId?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { data: org } = await db.from('organizations').select('id, org_number, country').eq('id', body?.organizationId ?? '').maybeSingle();
  if (!org) return json({ error: 'organisation not found' }, 404);
  const { data: cfg } = await db.from('platform_config').select('config_value').eq('config_key', 'credit_check_provider').maybeSingle();
  const name = (cfg?.config_value ?? 'manual').trim() || 'manual';
  const provider = PROVIDERS[name];
  const apiKey = Deno.env.get('CREDIT_CHECK_API_KEY') ?? '';
  if (!provider || !apiKey) {
    return json({ error: `no credit provider is connected (setting: ${name}); record a manual assessment with its evidence instead`,
                  manual: true }, 409);
  }
  if (!org.org_number) return json({ error: 'the company has no organisation number' }, 409);
  const out = await provider(org.org_number, apiKey);
  if ('error' in out) return json({ error: out.error, retry: !!out.retry }, out.retry ? 503 : 502);
  const { data, error } = await db.rpc('record_credit_check', {
    p_org: org.id, p_provider: name, p_passed: out.passed, p_score: out.score,
    p_recommended_limit: out.recommendedLimit, p_findings: { ...out.findings, requestedBy: caller.id },
  });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, check: data });
});
