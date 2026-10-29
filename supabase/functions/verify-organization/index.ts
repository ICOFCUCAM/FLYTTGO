// ============================================================================
// FlyttGo — verify-organization Edge Function
// ============================================================================
//
// A platform administrator checks a Norwegian company against
// Brønnøysundregistrene before activating it (decided 2026-10-29). The
// result and what was seen are recorded (organization_verifications);
// admin_set_organization_status('active') then requires a passed check
// of the current organisation number, at most 30 days old. A company
// outside the register is verified by a manual check the administrator
// records with record_organization_verification(..., 'manual', ...).
//
//   POST /functions/v1/verify-organization
//   Authorization: Bearer <administrator's access token>
//   { "organizationId": "<uuid>" }
//
// Responses: 200 { passed, findings, verification }
//            409 not a Norwegian company or no organisation number
//            503 the register could not be reached (try again)
//
// DEPLOY:
//   supabase functions deploy verify-organization --no-verify-jwt
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient } from '../_shared/auth.ts';
import { checkBrreg } from '../_shared/brreg.ts';

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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  const db     = serviceClient();
  const caller = await getCaller(req, db);
  if (!caller)         return json({ error: 'Sign in required' }, 401);
  if (!caller.isAdmin) return json({ error: 'Administrators only' }, 403);

  let body: { organizationId?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!body?.organizationId) return json({ error: 'organizationId is required' }, 400);

  const { data: org } = await db.from('organizations')
    .select('id, name, country, org_number, vat_registered')
    .eq('id', body.organizationId).maybeSingle();
  if (!org) return json({ error: 'organisation not found' }, 404);
  if (org.country !== 'NO' || !org.org_number) {
    return json({ error: 'only Norwegian companies with an organisation number are checked in the register; record a manual check' }, 409);
  }

  const out = await checkBrreg(fetch, org.org_number, org.name);
  if (out.kind === 'retry')  return json({ error: out.error, retry: true }, 503);
  if (out.kind === 'failed') return json({ error: out.error }, 502);

  const { data: verification, error } = await db.rpc('record_organization_verification', {
    p_org: org.id, p_source: 'brreg', p_passed: out.passed,
    p_findings: { ...out.findings, requestedBy: caller.id },
  });
  if (error) return json({ error: `could not record the check: ${error.message}` }, 500);

  /* The register is the source for VAT registration. */
  if (out.passed && typeof out.findings.vatRegistered === 'boolean' && out.findings.vatRegistered !== org.vat_registered) {
    await db.from('organizations').update({ vat_registered: out.findings.vatRegistered, updated_at: new Date().toISOString() }).eq('id', org.id);
  }

  return json({ passed: out.passed, findings: out.findings, verification });
});
