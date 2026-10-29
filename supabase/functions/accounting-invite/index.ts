// ============================================================================
// FlyttGo — accounting-invite Edge Function
// ============================================================================
//
// A company's owner or admin invites someone to its accounting back office
// (accountant, bookkeeper, external auditor, viewer; docs/ACCOUNTING_CORE.md).
// The invitation is created as the caller (accounting.invite, 00014), so the
// database decides; its token goes only into the email, never back to the
// browser. The email is in Norwegian or English, as the inviter chose.
//
//   POST /functions/v1/accounting-invite
//   Authorization: Bearer <owner's or admin's access token>
//   { "ledgerId": "<uuid>", "email": "regnskap@firma.no", "role": "accountant",
//     "name": "…", "firm": "…", "validUntil": "2027-06-30", "lang": "no" }
//
// Limits: 20 invitations per ledger per hour.
//
// DEPLOY: supabase functions deploy accounting-invite --no-verify-jwt
// Secrets: RESEND_API_KEY, FLYTTGO_FROM, FLYTTGO_REPLY_TO, FRONTEND_URL.
// The project exposes the `accounting` schema to its API.
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient, userClient } from '../_shared/auth.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FLYTTGO_FROM   = Deno.env.get('FLYTTGO_FROM') ?? 'FlyttGo <no-reply@flyttgo.no>';
const REPLY_TO       = Deno.env.get('FLYTTGO_REPLY_TO') ?? 'support@flyttgo.no';
const FRONTEND_URL   = (Deno.env.get('FRONTEND_URL') ?? 'https://flyttgo.no').replace(/\/+$/, '');
const HOURLY_LIMIT   = 20;

const ROLES: Record<string, { no: string; en: string }> = {
  accountant: { no: 'regnskapsfører', en: 'accountant' },
  bookkeeper: { no: 'regnskapsmedarbeider', en: 'bookkeeper' },
  auditor:    { no: 'ekstern revisor', en: 'external auditor' },
  viewer:     { no: 'lesetilgang', en: 'viewer' },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);
  if (!RESEND_API_KEY)          return json({ error: 'email is not configured (RESEND_API_KEY)' }, 503);

  const db = serviceClient();
  const caller = await getCaller(req, db);
  if (!caller) return json({ error: 'Sign in required' }, 401);

  let body: { ledgerId?: string; email?: string; role?: string; name?: string; firm?: string; validUntil?: string | null; lang?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const email = String(body?.email ?? '').trim().toLowerCase();
  const role = String(body?.role ?? '');
  const lang: 'no' | 'en' = body?.lang === 'en' ? 'en' : 'no';
  if (!body?.ledgerId || !email || !ROLES[role]) return json({ error: 'ledgerId, email and a valid role are required' }, 400);

  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await db.schema('accounting').from('invitations').select('id', { count: 'exact', head: true })
    .eq('ledger_id', body.ledgerId).gte('created_at', since);
  if ((count ?? 0) >= HOURLY_LIMIT) return json({ error: 'too many invitations this hour; try again later' }, 429);

  /* As the caller: the database checks that they manage this back office. */
  const asCaller = userClient(req).schema('accounting');
  const { data: rows, error } = await asCaller.rpc('invite', {
    p_ledger: body.ledgerId, p_email: email, p_role: role, p_name: body.name ?? null, p_firm: body.firm ?? null,
    p_valid_until: body.validUntil || null,
  });
  if (error) return json({ error: error.message.replace(/^accounting: /, '') }, error.code === '42501' ? 403 : 409);
  const invitation = Array.isArray(rows) ? rows[0] : rows;
  if (!invitation?.token) return json({ error: 'invitation was not created' }, 500);

  const { data: ledger } = await db.schema('accounting').from('ledgers').select('legal_name').eq('id', body.ledgerId).maybeSingle();
  const company = escapeHtml(ledger?.legal_name ?? (lang === 'no' ? 'et selskap' : 'a company'));
  const link = `${FRONTEND_URL}/accounting?invite=${encodeURIComponent(invitation.token)}`;
  const expires = new Date(invitation.expires_at).toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-GB', { timeZone: 'Europe/Oslo' });
  const until = body.validUntil ? new Date(`${body.validUntil}T12:00:00`).toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-GB') : null;
  const r = ROLES[role][lang];

  const html = lang === 'no'
    ? `<p>Hei,</p><p>Du er invitert til regnskapet til <strong>${company}</strong> som ${r}.${until ? ` Tilgangen varer til og med ${escapeHtml(until)}.` : ''}</p>
<p><a href="${escapeHtml(link)}">Godta invitasjonen</a></p>
<p>Logg inn eller opprett en konto med denne e-postadressen (${escapeHtml(email)}). Lenken virker én gang og utløper ${escapeHtml(expires)}.</p>
<p>Var du ikke forberedt på dette, kan du se bort fra e-posten.</p><p>— FlyttGo Regnskap</p>`
    : `<p>Hello,</p><p>You have been invited to the books of <strong>${company}</strong> as ${r}.${until ? ` Your access lasts until ${escapeHtml(until)}.` : ''}</p>
<p><a href="${escapeHtml(link)}">Accept the invitation</a></p>
<p>Sign in or create an account with this email address (${escapeHtml(email)}). The link works once and expires on ${escapeHtml(expires)}.</p>
<p>If you were not expecting this, you can ignore this email.</p><p>— FlyttGo Regnskap</p>`;

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json',
               'Idempotency-Key': `accounting-invitation-${invitation.invitation_id}` },
    body: JSON.stringify({
      from: FLYTTGO_FROM, to: [email], reply_to: REPLY_TO,
      subject: lang === 'no' ? `Invitasjon til regnskapet til ${ledger?.legal_name ?? 'et selskap'}` : `Invitation to the books of ${ledger?.legal_name ?? 'a company'}`,
      html,
    }),
  }).catch((err: Error) => ({ ok: false, status: 599, text: async () => err.message }));

  if (!send.ok) {
    /* The link never left: withdraw the invitation so a retry starts clean. */
    await asCaller.rpc('revoke_invitation', { p_invitation: invitation.invitation_id });
    return json({ error: `the email could not be sent (${send.status}); the invitation was withdrawn, try again` }, 502);
  }
  return json({ ok: true, invitationId: invitation.invitation_id, expiresAt: invitation.expires_at });
});
