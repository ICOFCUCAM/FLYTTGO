// ============================================================================
// FlyttGo — white-label-domain Edge Function
// ============================================================================
//
// Verifies that a company controls the domain it gave for its page
// (docs/WHITE_LABEL.md). The company adds a DNS TXT record
//   _flyttgo.<domain>  =  flyttgo-verify=<token>
// (the token comes from set_white_label_domain) and points the domain at
// FlyttGo's host with a CNAME. This function looks the TXT record up through
// DNS over HTTPS and, when the token is there, marks the domain verified.
// Serving the domain (adding it to the hosting project and its
// certificate) is then done by FlyttGo; see the checklist in the doc.
//
//   POST /functions/v1/white-label-domain
//   Authorization: Bearer <access token of an owner or admin>
//   { "organizationId": "<uuid>" }
//
// DEPLOY: supabase functions deploy white-label-domain --no-verify-jwt
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient } from '../_shared/auth.ts';

const DOH = 'https://cloudflare-dns.com/dns-query';
const CNAME_TARGET = Deno.env.get('WHITE_LABEL_CNAME_TARGET') ?? 'cname.vercel-dns.com';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

/** TXT values for a name, through DNS over HTTPS (RFC 8484 JSON). */
async function txtRecords(name: string): Promise<string[]> {
  const res = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=TXT`, { headers: { Accept: 'application/dns-json' } });
  if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
  const data = await res.json() as { Answer?: Array<{ type: number; data: string }> };
  return (data.Answer ?? []).filter(a => a.type === 16)
    .map(a => a.data.replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);
  const db = serviceClient();
  const caller = await getCaller(req, db);
  if (!caller) return json({ error: 'Sign in required' }, 401);
  const body = await req.json().catch(() => ({})) as { organizationId?: string };
  if (!body.organizationId) return json({ error: 'organizationId is required' }, 400);

  const { data: member } = await db.from('organization_members').select('role')
    .eq('organization_id', body.organizationId).eq('user_id', caller.id).eq('status', 'active').maybeSingle();
  if (!caller.isAdmin && !['owner', 'admin'].includes(member?.role ?? '')) return json({ error: 'owners and admins only' }, 403);

  const { data: wl } = await db.from('organization_white_label').select('custom_domain, domain_token, domain_verified_at')
    .eq('organization_id', body.organizationId).maybeSingle();
  if (!wl?.custom_domain || !wl.domain_token) return json({ error: 'set a domain first' }, 409);
  const records = {
    txt:   { name: `_flyttgo.${wl.custom_domain}`, value: `flyttgo-verify=${wl.domain_token}` },
    cname: { name: wl.custom_domain, value: CNAME_TARGET },
  };
  if (wl.domain_verified_at) return json({ verified: true, records });

  let found: string[];
  try { found = await txtRecords(records.txt.name); } catch (e) { return json({ verified: false, records, error: (e as Error).message }, 502); }
  if (!found.includes(records.txt.value)) {
    return json({ verified: false, records, found, error: 'the TXT record is not there yet (DNS changes can take up to a few hours)' });
  }
  const { error } = await db.rpc('mark_white_label_domain_verified', { p_org: body.organizationId, p_domain: wl.custom_domain });
  if (error) return json({ error: error.message }, 409);
  return json({ verified: true, records });
});
