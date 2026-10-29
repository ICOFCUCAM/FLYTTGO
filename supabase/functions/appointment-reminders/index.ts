// ============================================================================
// FlyttGo — appointment-reminders Edge Function (hourly)
// ============================================================================
//
// Emails customers the day before their appointment (00013), once each:
// the company's name, the service, the time (Europe/Oslo), the place's
// contact, and how to cancel. Replies go to the company. The same run
// reminds guests of a table reservation the day before and hotel guests the
// day before arrival (00019), once each.
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

type Db = ReturnType<typeof serviceClient>;
type Report = { sent: unknown[]; errors: unknown[] };

/** The company's name and contact for a reminder. */
async function companyOf(db: Db, orgId: string) {
  const [{ data: wl }, { data: org }] = await Promise.all([
    db.from('organization_white_label').select('display_name, support_email, support_phone').eq('organization_id', orgId).maybeSingle(),
    db.from('organizations').select('name, slug').eq('id', orgId).maybeSingle(),
  ]);
  return { name: (wl?.display_name ?? org?.name ?? '') as string, email: wl?.support_email as string | null, phone: wl?.support_phone as string | null };
}

/** Sends one reminder through Resend (idempotent per key); null on success. */
async function sendReminder(key: string, company: { name: string; email: string | null }, to: string, subject: string, html: string) {
  const address = /<([^>]+)>/.exec(FLYTTGO_FROM)?.[1] ?? FLYTTGO_FROM;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({
      from: `"${company.name.replace(/["<>\r\n]/g, '')}" <${address}>`, to: [to],
      ...(company.email ? { reply_to: company.email } : {}), subject, html,
    }),
  }).catch((e: Error) => ({ ok: false, status: 599, text: async () => e.message }));
  return res.ok ? null : `email ${res.status}`;
}

/** Table reservations tomorrow and hotel arrivals tomorrow (00019). */
async function remindReservations(db: Db, dry: boolean, report: Report) {
  const { data: tables, error: e1 } = await db.rpc('restaurant_reservations_to_remind');
  if (e1) report.errors.push({ restaurant: e1.message });
  for (const r of tables ?? []) {
    const c = await companyOf(db, r.organization_id);
    const company = c.name || 'Your table';
    const when = new Date(r.starts_at).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    if (dry) { report.sent.push({ reservation: r.id, to: r.customer.email, dryRun: true }); continue; }
    if (!RESEND_API_KEY) { report.errors.push({ reservation: r.id, error: 'RESEND_API_KEY not set' }); continue; }
    const err = await sendReminder(`restaurant-reminder-${r.id}`, { name: company, email: c.email }, r.customer.email,
      `Påminnelse: bord for ${r.party_size} ${when}`,
      `<p>Hei ${esc(r.customer.name)},</p><p>Dette er en påminnelse om bordet ditt hos <strong>${esc(company)}</strong>:
       ${esc(r.party_size)} personer, <strong>${esc(when)}</strong>.</p>
       <p>Må du avbestille? Gjør det under <a href="${FRONTEND_URL}/my-services">Mine timer og oppdrag</a>, eller kontakt
       ${esc(company)}${c.phone ? ` på ${esc(c.phone)}` : ''}.</p>`);
    if (err) { report.errors.push({ reservation: r.id, error: err }); continue; }
    await db.rpc('mark_restaurant_reservation_reminded', { p_id: r.id });
    report.sent.push({ reservation: r.id });
  }
  const { data: stays, error: e2 } = await db.rpc('hotel_stays_to_remind');
  if (e2) report.errors.push({ hotel: e2.message });
  for (const s of stays ?? []) {
    const [c, { data: settings }, { data: type }] = await Promise.all([
      companyOf(db, s.organization_id),
      db.from('hotel_settings').select('check_in_from').eq('organization_id', s.organization_id).maybeSingle(),
      db.from('hotel_room_types').select('name').eq('id', s.room_type_id).maybeSingle(),
    ]);
    const company = c.name || 'Your stay';
    const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo', weekday: 'long', day: 'numeric', month: 'long' });
    if (dry) { report.sent.push({ stay: s.id, to: s.customer.email, dryRun: true }); continue; }
    if (!RESEND_API_KEY) { report.errors.push({ stay: s.id, error: 'RESEND_API_KEY not set' }); continue; }
    const err = await sendReminder(`hotel-reminder-${s.id}`, { name: company, email: c.email }, s.customer.email,
      `Påminnelse: ankomst ${day(s.check_in)}`,
      `<p>Hei ${esc(s.customer.name)},</p><p>Velkommen til <strong>${esc(company)}</strong> i morgen:
       ${esc(type?.name)}, ${esc(s.nights)} ${s.nights === 1 ? 'natt' : 'netter'}, ankomst <strong>${esc(day(s.check_in))}</strong>
       ${settings?.check_in_from ? `fra kl. ${esc(String(settings.check_in_from).slice(0, 5))}` : ''}, avreise ${esc(day(s.check_out))}.</p>
       <p>Spørsmål eller endringer? Kontakt ${esc(company)}${c.phone ? ` på ${esc(c.phone)}` : ''}, eller se
       <a href="${FRONTEND_URL}/my-services">Mine timer og oppdrag</a>.</p>`);
    if (err) { report.errors.push({ stay: s.id, error: err }); continue; }
    await db.rpc('mark_hotel_stay_reminded', { p_id: s.id });
    report.sent.push({ stay: s.id });
  }
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!isServiceRequest(req)) return json({ error: 'the scheduler only' }, 403);
  const dry = !!(await req.json().catch(() => ({})) as { dryRun?: boolean }).dryRun;
  const db = serviceClient();
  const { data: due, error } = await db.rpc('appointments_to_remind');
  if (error) return json({ error: error.message }, 500);
  const report: Report = { sent: [], errors: [] };
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
  await remindReservations(db, dry, report);
  return json({ dryRun: dry, ...report });
});
