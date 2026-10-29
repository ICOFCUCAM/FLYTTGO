// ============================================================================
// FlyttGo — send-organization-invitation Edge Function
// ============================================================================
//
// An owner or admin of a company invites someone by email (decided
// 2026-10-29: invitations are sent by the server). The invitation is
// created as the caller (invite_member, migration 00005), so the database
// decides whether they may invite and with which role; the token it
// returns goes only into the email, never back to the browser.
//
//   POST /functions/v1/send-organization-invitation
//   Authorization: Bearer <owner's or admin's access token>
//   { "organizationId": "<uuid>", "email": "person@company.no", "role": "booker" }
//
// Limits: 20 invitations per company per hour.
//
// DEPLOY:
//   supabase functions deploy send-organization-invitation --no-verify-jwt
// Secrets: RESEND_API_KEY, FLYTTGO_FROM, FLYTTGO_REPLY_TO (as
// send-booking-email), FRONTEND_URL (for the link).
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient, userClient } from '../_shared/auth.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FLYTTGO_FROM   = Deno.env.get('FLYTTGO_FROM') ?? 'FlyttGo <no-reply@flyttgo.no>';
const REPLY_TO       = Deno.env.get('FLYTTGO_REPLY_TO') ?? 'support@flyttgo.no';
const FRONTEND_URL   = (Deno.env.get('FRONTEND_URL') ?? 'https://flyttgo.no').replace(/\/+$/, '');
const HOURLY_LIMIT   = 20;

const ROLE_LABELS: Record<string, string> = {
  owner: 'owner', admin: 'administrator', booker: 'booker', finance: 'finance', viewer: 'viewer',
};

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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);
  if (!RESEND_API_KEY)          return json({ error: 'email is not configured (RESEND_API_KEY)' }, 503);

  const db     = serviceClient();
  const caller = await getCaller(req, db);
  if (!caller) return json({ error: 'Sign in required' }, 401);

  let body: { organizationId?: string; email?: string; role?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const email = String(body?.email ?? '').trim().toLowerCase();
  const role  = String(body?.role ?? '');
  if (!body?.organizationId || !email || !ROLE_LABELS[role]) {
    return json({ error: 'organizationId, email and a valid role are required' }, 400);
  }

  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await db.from('organization_invitations')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', body.organizationId).gte('created_at', since);
  if ((count ?? 0) >= HOURLY_LIMIT) return json({ error: 'too many invitations this hour; try again later' }, 429);

  /* As the caller: the database checks their company role. */
  const { data: rows, error } = await userClient(req).rpc('invite_member', {
    p_org: body.organizationId, p_email: email, p_role: role,
  });
  if (error) return json({ error: error.message }, error.code === '42501' ? 403 : 409);
  const invitation = Array.isArray(rows) ? rows[0] : rows;
  if (!invitation?.token) return json({ error: 'invitation was not created' }, 500);

  const { data: org } = await db.from('organizations').select('name').eq('id', body.organizationId).maybeSingle();
  const company = escapeHtml(org?.name ?? 'a company');
  const link    = `${FRONTEND_URL}/business/invite?token=${encodeURIComponent(invitation.token)}`;
  const expires = new Date(invitation.expires_at).toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo' });

  const html = `<p>Hello,</p>
<p>You have been invited to join <strong>${company}</strong> on FlyttGo Business as ${ROLE_LABELS[role]}.</p>
<p><a href="${escapeHtml(link)}">Accept the invitation</a></p>
<p>Sign in with this email address (${escapeHtml(email)}). The link works once and expires on ${escapeHtml(expires)}.</p>
<p>If you were not expecting this, you can ignore this email.</p>
<p>— FlyttGo</p>`;

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json',
               'Idempotency-Key': `org-invitation-${invitation.invitation_id}` },
    body: JSON.stringify({
      from: FLYTTGO_FROM, to: [email], reply_to: REPLY_TO,
      subject: `Invitation to ${org?.name ?? 'a company'} on FlyttGo`,
      html,
    }),
  }).catch((err: Error) => ({ ok: false, status: 599, text: async () => err.message }));

  if (!send.ok) {
    /* The invitation exists but its link never left: revoke it, so a
     * retry starts clean (invite_member would replace it anyway). */
    await userClient(req).rpc('revoke_invitation', { p_invitation: invitation.invitation_id });
    return json({ error: `the email could not be sent (${send.status}); the invitation was withdrawn, try again` }, 502);
  }
  return json({ ok: true, invitationId: invitation.invitation_id, expiresAt: invitation.expires_at });
});
