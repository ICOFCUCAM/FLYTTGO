// ============================================================================
// FlyttGo — appointment-reminders Edge Function (hourly)
// ============================================================================
//
// Emails customers the day before their appointment (00013), once each:
// the company's name, the service, the time (Europe/Oslo), the place's
// contact, and how to cancel. Replies go to the company.
//
//   POST /functions/v1/appointment-reminders
//   Authorization: Bearer <service role key>    { "dryRun": true } lists only
//
// DEPLOY: supabase functions deploy appointment-reminders --no-verify-jwt
// Schedule hourly (pg_cron + pg_net, or Supabase scheduled functions).
// Secrets: RESEND_API_KEY, FLYTTGO_FROM.
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { isServiceRequest, serviceClient } from '../_shared/auth.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FLYTTGO_FROM   = Deno.env.get('FLYTTGO_FROM') ?? 'FlyttGo <faktura@flyttgo.no>';
const FRONTEND_URL   = (Deno.env.get('FRONTEND_URL') ?? 'https://flyttgo.no').replace(/\/$/, '');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!isServiceRequest(req)) return json({ error: 'the scheduler only' }, 403);
  const dry = !!(await req.json().catch(() => ({})) as { dryRun?: boolean }).dryRun;
  const db = serviceClient();
  const { data: due, error } = await db.rpc('appointments_to_remind');
  if (error) return json({ error: error.message }, 500);
  const report = { sent: [] as unknown[], errors: [] as unknown[] };
  for (const a of due ?? []) {
    const [{ data: svc }, { data: wl }, { data: org }] = await Promise.all([
      db.from('appointment_services').select('name').eq('id', a.service_id).maybeSingle(),
      db.from('organization_white_label').select('display_name, support_email, support_phone').eq('organization_id', a.organization_id).maybeSingle(),
      db.from('organizations').select('name, slug').eq('id', a.organization_id).maybeSingle(),
    ]);
    const company = wl?.display_name ?? org?.name ?? 'Your appointment';
    const when = new Date(a.starts_at).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    if (dry) { report.sent.push({ appointment: a.id, to: a.customer.email, dryRun: true }); continue; }
    if (!RESEND_API_KEY) { report.errors.push({ appointment: a.id, error: 'RESEND_API_KEY not set' }); continue; }
    const address = /<([^>]+)>/.exec(FLYTTGO_FROM)?.[1] ?? FLYTTGO_FROM;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `appointment-reminder-${a.id}` },
      body: JSON.stringify({
        from: `"${company.replace(/["<>\r\n]/g, '')}" <${address}>`, to: [a.customer.email],
        ...(wl?.support_email ? { reply_to: wl.support_email } : {}),
        subject: `Påminnelse: ${svc?.name ?? 'time'} ${when}`,
        html: `<p>Hei ${esc(a.customer.name)},</p><p>Dette er en påminnelse om timen din hos <strong>${esc(company)}</strong>:
               ${esc(svc?.name)}, <strong>${esc(when)}</strong>.</p>
               <p>Må du avbestille? Gjør det under <a href="${FRONTEND_URL}/my-services">Mine timer og oppdrag</a>, eller kontakt
               ${esc(company)}${wl?.support_phone ? ` på ${esc(wl.support_phone)}` : ''}.</p>`,
      }),
    }).catch((e: Error) => ({ ok: false, status: 599, text: async () => e.message }));
    if (!res.ok) { report.errors.push({ appointment: a.id, error: `email ${res.status}` }); continue; }
    await db.rpc('mark_appointment_reminded', { p_id: a.id });
    report.sent.push({ appointment: a.id });
  }
  return json({ dryRun: dry, ...report });
});
