// ============================================================================
// FlyttGo — invoice-run Edge Function (daily, and on demand by an admin)
// ============================================================================
//
// The invoicing round, like an accounting system's daily job:
//   1. Invoice what is due. Completed company bookings on invoice are
//      invoiced; a late cancellation is invoiced for its fee only (Terms
//      §6.1). Per-booking companies get one invoice per booking; monthly
//      companies get one consolidated invoice (samlefaktura) for the
//      previous month.
//   2. Issue each invoice (number, due date from the company's terms, KID)
//      and email it as PDF with the EHF file.
//   2b. White label (docs/WHITE_LABEL.md): each company on a plan gets its
//      plan's invoice: the set-up fee once, the monthly fee in advance, and
//      under Model B what FlyttGo kept from last month's customer payments
//      (recorded as paid at once: it was taken through Stripe).
//   2c. The accounting add-on: each month at the company's turnover band
//      price (00015), on FlyttGo's invoice.
//   3. Remind. An unpaid invoice gets a reminder each time the configured
//      number of days passes after its due date (invoice_reminder_after_days),
//      at most two; the fee and interest come from the settings. After that
//      it is a case for debt collection (inkasso), handled by hand.
//
//   POST /functions/v1/invoice-run
//   Authorization: Bearer <service role key> (schedule) or an administrator's token
//   { "dryRun": true }   lists what would happen, changes nothing
//
// DEPLOY: supabase functions deploy invoice-run --no-verify-jwt
// Schedule: daily, e.g. 06:15 Oslo time (docs/INVOICING.md).
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, isServiceRequest, serviceClient } from '../_shared/auth.ts';
import { cancellationFee } from '../_shared/invoices.ts';
import { emailInvoice, loadInvoice } from '../_shared/invoice-data.ts';

const MAX_REMINDERS = 2;
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
  if (!isServiceRequest(req)) {
    const caller = await getCaller(req, db);
    if (!caller?.isAdmin) return json({ error: 'Administrators only' }, 403);
  }
  const body = await req.json().catch(() => ({})) as { dryRun?: boolean };
  const dry = !!body.dryRun;
  const report = { issued: [] as unknown[], reminded: [] as unknown[], skipped: [] as unknown[], errors: [] as unknown[] };

  /* 1–2: what is due for invoicing, grouped as each company chose. */
  const { data: due, error } = await db.rpc('uninvoiced_bookings');
  if (error) return json({ error: error.message }, 500);
  const groups = new Map<string, { org: string; bookings: string[] }>();
  for (const r of (due ?? []) as Array<{ organization_id: string; booking_id: string; cycle: string }>) {
    const key = r.cycle === 'monthly' ? r.organization_id : `${r.organization_id}:${r.booking_id}`;
    const g = groups.get(key) ?? { org: r.organization_id, bookings: [] };
    g.bookings.push(r.booking_id);
    groups.set(key, g);
  }

  for (const g of groups.values()) {
    const { data: rows } = await db.from('bookings')
      .select('id, status, final_price, price_estimate, cancelled_by, cancelled_at, move_date, move_time')
      .in('id', g.bookings);
    const amounts = g.bookings.map(id => {
      const b = (rows ?? []).find((x: any) => x.id === id);
      if (!b || b.status !== 'cancelled') return null;          // the database prices completed bookings
      return cancellationFee({ price: Number(b.final_price ?? b.price_estimate ?? 0), cancelled_by: b.cancelled_by,
                               cancelled_at: b.cancelled_at, move_date: b.move_date, move_time: b.move_time });
    });
    if (amounts.every(a => a === 0)) { report.skipped.push({ organization: g.org, bookings: g.bookings, reason: 'no fee due' }); continue; }
    if (dry) { report.issued.push({ organization: g.org, bookings: g.bookings, dryRun: true }); continue; }

    const { data: draft, error: dErr } = await db.rpc('create_invoice_draft', { p_org: g.org, p_bookings: g.bookings, p_amounts: amounts });
    if (dErr) { report.errors.push({ organization: g.org, error: dErr.message }); continue; }
    const { data: inv, error: iErr } = await db.rpc('issue_invoice', { p_invoice: draft.id });
    if (iErr) {
      await db.rpc('delete_invoice_draft', { p_invoice: draft.id });
      report.errors.push({ organization: g.org, error: iErr.message });
      continue;
    }
    const li = await loadInvoice(db, inv.id);
    const mailErr = li ? await emailInvoice(db, li, 'invoice') : 'could not load the invoice';
    report.issued.push({ number: inv.number, organization: g.org, total: inv.total, emailed: !mailErr, emailError: mailErr ?? undefined });
  }

  /* 2b: white-label plans. */
  const { data: plans } = await db.from('organization_white_label').select('organization_id').not('started_at', 'is', null);
  for (const w of plans ?? []) {
    if (dry) { report.issued.push({ organization: w.organization_id, whiteLabel: true, dryRun: true }); continue; }
    const { data: draft, error: wErr } = await db.rpc('create_white_label_invoice', { p_org: w.organization_id });
    if (wErr) { report.errors.push({ organization: w.organization_id, whiteLabel: true, error: wErr.message }); continue; }
    if (!draft?.id) continue;                                   // nothing due
    const { data: inv, error: iErr } = await db.rpc('issue_invoice', { p_invoice: draft.id });
    if (iErr) {
      await db.rpc('delete_invoice_draft', { p_invoice: draft.id });
      report.errors.push({ organization: w.organization_id, whiteLabel: true, error: iErr.message });
      continue;
    }
    const { error: sErr } = await db.rpc('settle_white_label_invoice', { p_invoice: inv.id });
    if (sErr) report.errors.push({ number: inv.number, whiteLabel: true, error: `recording what was collected: ${sErr.message}` });
    const li = await loadInvoice(db, inv.id);
    const mailErr = li ? await emailInvoice(db, li, 'invoice') : 'could not load the invoice';
    report.issued.push({ number: inv.number, organization: w.organization_id, whiteLabel: true, total: inv.total,
                         emailed: !mailErr, emailError: mailErr ?? undefined });
  }

  /* 2c: the accounting add-on (docs/ACCOUNTING_CORE.md), by turnover band. */
  const { data: ledgers } = await db.schema('accounting').from('ledgers').select('tenant_id')
    .not('tenant_id', 'is', null).in('status', ['active', 'ended']).not('decided_at', 'is', null);
  for (const l of ledgers ?? []) {
    if (dry) { report.issued.push({ organization: l.tenant_id, accounting: true, dryRun: true }); continue; }
    const { data: draft, error: aErr } = await db.rpc('create_accounting_invoice', { p_org: l.tenant_id });
    if (aErr) { report.errors.push({ organization: l.tenant_id, accounting: true, error: aErr.message }); continue; }
    if (!draft?.id) continue;                                   // nothing due
    const { data: inv, error: iErr } = await db.rpc('issue_invoice', { p_invoice: draft.id });
    if (iErr) {
      await db.rpc('delete_invoice_draft', { p_invoice: draft.id });
      report.errors.push({ organization: l.tenant_id, accounting: true, error: iErr.message });
      continue;
    }
    const li = await loadInvoice(db, inv.id);
    const mailErr = li ? await emailInvoice(db, li, 'invoice') : 'could not load the invoice';
    report.issued.push({ number: inv.number, organization: l.tenant_id, accounting: true, total: inv.total,
                         emailed: !mailErr, emailError: mailErr ?? undefined });
  }

  /* 3: reminders for unpaid invoices past their due date. */
  const { data: cfg } = await db.from('platform_config').select('config_value').eq('config_key', 'invoice_reminder_after_days').maybeSingle();
  const every = Math.max(1, Number(cfg?.config_value ?? 7) || 7);
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
  const { data: open } = await db.from('invoices').select('id, number, due_date, reminder_level')
    .eq('kind', 'invoice').eq('series', 'main')            // FlyttGo's own; companies remind their customers themselves
    .in('status', ['issued', 'partially_paid']).lt('reminder_level', MAX_REMINDERS);
  for (const i of open ?? []) {
    const due = new Date(`${i.due_date}T00:00:00`);
    const daysLate = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
    if (daysLate < every * (i.reminder_level + 1)) continue;
    if (dry) { report.reminded.push({ number: i.number, level: i.reminder_level + 1, dryRun: true }); continue; }
    const { data: rem, error: rErr } = await db.rpc('record_invoice_reminder', { p_invoice: i.id });
    if (rErr) { report.errors.push({ number: i.number, error: rErr.message }); continue; }
    const li = await loadInvoice(db, i.id);
    const mailErr = li ? await emailInvoice(db, li, 'reminder', { reminderLevel: rem.level }) : 'could not load the invoice';
    report.reminded.push({ number: i.number, level: rem.level, fee: rem.fee, interest: rem.interest, emailed: !mailErr, emailError: mailErr ?? undefined });
  }

  return json({ dryRun: dry, ...report });
});
