/**
 * Admin → Invoicing (migration 00008, docs/INVOICING.md): FlyttGo's own
 * invoice ledger. Settings (seller details, reminders, interest, and the
 * credit-check switch), every company's invoices with their actions,
 * manual invoices, bank payments matched by KID (pasted rows, or a Nets
 * OCR / camt.054 bank file, 00016), the invoice run and the export for the
 * accountant. Every action is a database function that
 * checks the caller and is logged on the invoice.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  INVOICE_STATUS_LABELS, callJson, creditInvoice, deleteDraft, formatNok, isOverdue, issueInvoice, loadInvoiceSettings,
  loadInvoices, openInvoiceDocument, outstanding, recordPayment, recordPaymentByKid, saveInvoiceSettings, sendReminder,
  type InvoiceRow, type InvoiceSettings,
} from '../../lib/invoicing';
import { invoicesCsv, parseBankRows } from '../../../supabase/functions/_shared/invoices';
import { importPastedRows } from '../../lib/bank-import';
import BankFileImport from '../invoicing/BankFileImport';

type Filter = 'open' | 'overdue' | 'drafts' | 'paid' | 'all';

const LABELS: Array<[keyof InvoiceSettings, string, string?]> = [
  ['invoice_seller_name', 'Legal name'], ['invoice_seller_org_number', 'Organisation number'],
  ['invoice_seller_address', 'Street address'], ['invoice_seller_postcode_city', 'Postcode and city'],
  ['invoice_seller_email', 'Invoice email'], ['invoice_seller_phone', 'Phone'],
  ['invoice_seller_bank_account', 'Bank account (11 digits)'], ['invoice_seller_iban', 'IBAN'], ['invoice_seller_bic', 'BIC'],
  ['invoice_reminder_after_days', 'Days between reminders'], ['invoice_reminder_fee', 'Reminder fee (NOK)', 'Check the legal maximum (inkassoforskriften) before charging one.'],
  ['invoice_late_interest_pct', 'Late-payment interest, % a year', 'The rate the Ministry of Finance sets (forsinkelsesrente). Empty: none.'],
  ['credit_check_max_age_days', 'Credit check valid for (days)'], ['credit_check_provider', 'Credit check provider'],
];

export default function InvoicingPanel() {
  const [settings, setSettings] = useState<InvoiceSettings | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [bankText, setBankText] = useState('');
  const [bankKey, setBankKey] = useState(0);
  const [manual, setManual] = useState({ org: '', description: '', quantity: 1, price: 0, vat: 25 });

  const reload = useCallback(async () => {
    const [s, i, { data: o }] = await Promise.all([
      loadInvoiceSettings(), loadInvoices(),
      supabase.from('organizations').select('id, name').order('name'),
    ]);
    setSettings(s); setInvoices(i); setOrgs(o ?? []);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const orgName = useMemo(() => Object.fromEntries(orgs.map(o => [o.id, o.name])), [orgs]);

  async function run(fn: () => Promise<string | null>, ok: string) {
    setBusy(true); setMessage(null);
    const err = await fn();
    setBusy(false);
    setMessage(err ? { ok: false, text: err } : { ok: true, text: ok });
    await reload();
  }

  const shown = invoices.filter(i => ({
    open: i.kind === 'invoice' && ['issued', 'partially_paid'].includes(i.status),
    overdue: isOverdue(i),
    drafts: i.status === 'draft',
    paid: i.status === 'paid' || i.status === 'credited' || i.kind === 'credit_note',
    all: true,
  }[filter]));
  const totals = {
    open: invoices.filter(i => i.kind === 'invoice' && ['issued', 'partially_paid'].includes(i.status)).reduce((s, i) => s + outstanding(i), 0),
    overdue: invoices.filter(i => isOverdue(i)).reduce((s, i) => s + outstanding(i), 0),
  };
  const input = 'border border-gray-200 rounded px-2 py-1.5 text-sm w-full';
  const btn = 'px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Invoicing</h1>
        <p className="text-sm text-gray-500">
          FlyttGo's invoices to companies. Issued invoices are final: corrections are credit notes. Outstanding {formatNok(totals.open)},
          of which overdue <span className={totals.overdue > 0 ? 'text-red-600 font-medium' : ''}>{formatNok(totals.overdue)}</span>.
        </p>
      </div>
      {message && <div className={`rounded-lg px-4 py-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{message.text}</div>}

      {/* ── Run ── */}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} className={`${btn} bg-gray-100 text-gray-700`} onClick={() => run(async () => {
          const r = await callJson('invoice-run', { dryRun: true });
          if (!r.ok) return r.data.error ?? 'failed';
          setMessage({ ok: true, text: `Would issue ${r.data.issued.length} invoice(s) and send ${r.data.reminded.length} reminder(s).` });
          return null;
        }, 'Checked.')}>Preview invoice run</button>
        <button disabled={busy} className={`${btn} bg-emerald-600 text-white`} onClick={() => confirm('Issue and email all invoices that are due, and send reminders?') && run(async () => {
          const r = await callJson('invoice-run', {});
          if (!r.ok) return r.data.error ?? 'failed';
          const errs = [...r.data.errors, ...r.data.issued.filter((x: any) => x.emailError), ...r.data.reminded.filter((x: any) => x.emailError)];
          return errs.length ? `Done with problems: ${errs.map((e: any) => e.error ?? e.emailError).join('; ')}` : null;
        }, 'Invoice run done.')}>Run invoicing now</button>
        <button className={`${btn} bg-gray-100 text-gray-700`} onClick={() => {
          const rows = invoices.filter(i => i.status !== 'draft').map(i => ({ ...i, buyer: i.buyer ?? {}, organization_name: orgName[i.organization_id] }));
          const blob = new Blob(['﻿' + invoicesCsv(rows as any)], { type: 'text/csv;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = `flyttgo-invoices-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
        }}>Export CSV (accountant)</button>
      </div>

      {/* ── Ledger ── */}
      <div>
        <div className="flex gap-2 mb-3">
          {(['open', 'overdue', 'drafts', 'paid', 'all'] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize ${filter === f ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>{f}</button>
          ))}
        </div>
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['No.', 'Company', 'Issued', 'Due', 'Total', 'Outstanding', 'Status', ''].map(h => <th key={h} className="text-left p-3 text-xs uppercase text-gray-500">{h}</th>)}</tr></thead>
            <tbody>
              {shown.map(i => (
                <tr key={i.id} className="border-t align-top">
                  <td className="p-3 font-mono text-xs">{i.number ? `${i.kind === 'credit_note' ? 'CN ' : ''}${i.number}` : 'draft'}</td>
                  <td className="p-3">{orgName[i.organization_id] ?? i.buyer?.name ?? '—'}</td>
                  <td className="p-3">{i.issue_date ?? '—'}</td>
                  <td className={`p-3 ${isOverdue(i) ? 'text-red-600 font-medium' : ''}`}>{i.kind === 'invoice' ? i.due_date ?? '—' : '—'}</td>
                  <td className="p-3">{formatNok(i.total)}</td>
                  <td className="p-3">{i.kind === 'invoice' && i.status !== 'draft' ? formatNok(outstanding(i)) : '—'}</td>
                  <td className="p-3">{i.kind === 'credit_note' ? 'Credit note' : isOverdue(i) ? `Overdue${i.reminder_level ? ` (reminder ${i.reminder_level})` : ''}` : INVOICE_STATUS_LABELS[i.status]}{i.sent_at ? '' : i.status !== 'draft' ? ' · not sent' : ''}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {i.status === 'draft' ? (
                        <>
                          <button disabled={busy} className={`${btn} bg-emerald-600 text-white`} onClick={() => confirm('Issue this invoice? It cannot be changed afterwards.') && run(() => issueInvoice(i.id), 'Issued.')}>Issue</button>
                          <button disabled={busy} className={`${btn} bg-gray-100 text-gray-700`} onClick={() => run(() => deleteDraft(i.id), 'Draft deleted.')}>Delete</button>
                        </>
                      ) : (
                        <>
                          <button className={`${btn} bg-gray-100 text-gray-700`} onClick={async () => { const e = await openInvoiceDocument(i.id, 'pdf'); if (e) setMessage({ ok: false, text: e }); }}>PDF</button>
                          <button className={`${btn} bg-gray-100 text-gray-700`} onClick={async () => { const e = await openInvoiceDocument(i.id, 'ehf'); if (e) setMessage({ ok: false, text: e }); }}>EHF</button>
                          <button disabled={busy} className={`${btn} bg-blue-600 text-white`} onClick={() => run(async () => {
                            const r = await callJson('invoice-send', { invoiceId: i.id });
                            return r.ok ? null : r.data.error ?? 'failed';
                          }, 'Sent.')}>Send</button>
                        </>
                      )}
                      {i.kind === 'invoice' && ['issued', 'partially_paid'].includes(i.status) && (
                        <>
                          <button disabled={busy} className={`${btn} bg-emerald-50 text-emerald-700`} onClick={() => {
                            const a = prompt(`Payment amount (owed ${outstanding(i)} NOK):`, String(outstanding(i)));
                            if (!a) return;
                            const d = prompt('Paid on (YYYY-MM-DD):', new Date().toISOString().slice(0, 10)) ?? '';
                            const ref = prompt('Bank reference (optional):') ?? '';
                            run(() => recordPayment(i.id, Number(a.replace(',', '.')), d, 'bank', ref), 'Payment recorded.');
                          }}>Payment</button>
                          {isOverdue(i) && (
                            <button disabled={busy} className={`${btn} bg-orange-100 text-orange-700`} onClick={() => run(async () => {
                              const err = await sendReminder(i.id);
                              if (err) return err;
                              const r = await callJson('invoice-send', { invoiceId: i.id, purpose: 'reminder' });
                              return r.ok ? null : `reminder recorded, but the email failed: ${r.data.error}`;
                            }, 'Reminder recorded and sent.')}>Remind</button>
                          )}
                        </>
                      )}
                      {i.kind === 'invoice' && ['issued', 'partially_paid', 'paid'].includes(i.status) && (
                        <button disabled={busy} className={`${btn} bg-gray-100 text-gray-700`} onClick={() => {
                          const a = prompt('Credit how much incl. MVA? Leave empty for the whole invoice.');
                          if (a === null) return;
                          const reason = prompt('Reason (printed on the credit note):');
                          if (!reason?.trim()) return;
                          run(() => creditInvoice(i.id, a.trim() ? Number(a.replace(',', '.')) : null, reason.trim()), 'Credit note issued. Send it with "Send".');
                        }}>Credit</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-400">No invoices.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ── Manual invoice ── */}
        <div className="bg-white rounded-lg shadow p-5 space-y-3">
          <h3 className="font-bold">New invoice (manual line)</h3>
          <p className="text-xs text-gray-500">For a service outside a booking. Creates a draft you can issue from the list.</p>
          <select className={input} value={manual.org} onChange={e => setManual(m => ({ ...m, org: e.target.value }))}>
            <option value="">Choose company…</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <input className={input} placeholder="Description" value={manual.description} onChange={e => setManual(m => ({ ...m, description: e.target.value }))} />
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-gray-500">Quantity<input type="number" min={0.01} step="any" className={input} value={manual.quantity} onChange={e => setManual(m => ({ ...m, quantity: Number(e.target.value) }))} /></label>
            <label className="text-xs text-gray-500">Price excl. MVA<input type="number" min={0} step="any" className={input} value={manual.price} onChange={e => setManual(m => ({ ...m, price: Number(e.target.value) }))} /></label>
            <label className="text-xs text-gray-500">MVA %<select className={input} value={manual.vat} onChange={e => setManual(m => ({ ...m, vat: Number(e.target.value) }))}>{[25, 15, 12, 0].map(v => <option key={v}>{v}</option>)}</select></label>
          </div>
          <button disabled={busy || !manual.org || !manual.description.trim()} className={`${btn} bg-gray-900 text-white`} onClick={() => run(async () => {
            const { data: d, error } = await supabase.rpc('create_invoice_draft', { p_org: manual.org, p_bookings: [], p_amounts: null, p_notes: null });
            if (error) return error.message;
            const { error: e2 } = await supabase.rpc('add_invoice_line', { p_invoice: (d as any).id, p_description: manual.description,
              p_quantity: manual.quantity, p_unit_price: manual.price, p_vat_rate: manual.vat });
            if (e2) { await deleteDraft((d as any).id); return e2.message; }
            setManual(m => ({ ...m, description: '', quantity: 1, price: 0 }));
            setFilter('drafts');
            return null;
          }, 'Draft created.')}>Create draft</button>
        </div>

        {/* ── Bank file ── */}
        <div className="bg-white rounded-lg shadow p-5 space-y-3">
          <h3 className="font-bold">Bank payments (match by KID)</h3>
          <p className="text-xs text-gray-500">Paste rows from the bank: date;amount;KID;reference. Rows already recorded are skipped; unmatched KIDs are listed. For the bank's own file (Nets OCR, camt.054), use Bank file below.</p>
          <textarea className={`${input} h-28 font-mono text-xs`} value={bankText} onChange={e => setBankText(e.target.value)} placeholder={'29.10.2026;1200,00;000000018;NETS-123'} />
          <button disabled={busy || !bankText.trim()} className={`${btn} bg-gray-900 text-white`} onClick={() => run(async () => {
            const rows = parseBankRows(bankText);
            if (!rows.length) return 'no rows recognised';
            // Recorded as an import (00016), so unmatched rows stay listed under Bank file;
            // without 00016 in the database, row by row as before.
            const imp = await importPastedRows(null, bankText);
            if (imp.result) {
              setBankText(''); setBankKey(k => k + 1);
              const open = imp.result.unmatched + imp.result.overpayments;
              return open ? `${imp.result.matched} matched, ${imp.result.already_recorded + imp.result.already_imported} already recorded. ${open} not matched: listed under Bank file → To handle by hand.` : null;
            }
            if (!imp.missing) return imp.error ?? 'failed';
            const unmatched: string[] = []; const failed: string[] = [];
            for (const r of rows) {
              const { invoiceId, error } = await recordPaymentByKid(r.kid, r.amount, r.paid_on, r.reference);
              if (error) failed.push(`${r.kid}: ${error}`); else if (!invoiceId) unmatched.push(`${r.kid} (${r.amount} NOK)`);
            }
            setBankText('');
            return failed.length || unmatched.length
              ? `${rows.length - failed.length - unmatched.length} matched. ${unmatched.length ? `No invoice for KID ${unmatched.join(', ')}.` : ''} ${failed.join('; ')}`
              : null;
          }, 'All payments matched.')}>Record payments</button>
        </div>
      </div>

      {/* ── Bank file (00016) ── */}
      <div className="bg-white rounded-lg shadow p-5 space-y-3">
        <h3 className="font-bold">Bank file (Nets OCR, camt.054)</h3>
        <BankFileImport key={bankKey} orgId={null} onChanged={reload} />
      </div>

      {/* ── Settings ── */}
      {settings && (
        <div className="bg-white rounded-lg shadow p-5 space-y-4">
          <h3 className="font-bold">Invoice settings</h3>
          <p className="text-xs text-gray-500">The seller's legal details are printed on every invoice. Invoices cannot be issued until name, organisation number, address and bank account are filled in.</p>
          <div className="grid md:grid-cols-2 gap-3">
            {LABELS.map(([k, label, hint]) => (
              <label key={k} className="text-xs text-gray-600">{label}
                <input className={input} value={settings[k]} onChange={e => setSettings(s => s && ({ ...s, [k]: e.target.value }))} />
                {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
              </label>
            ))}
            <label className="text-xs text-gray-600 flex items-center gap-2">
              <input type="checkbox" checked={settings.invoice_seller_vat_registered === 'true'}
                onChange={e => setSettings(s => s && ({ ...s, invoice_seller_vat_registered: e.target.checked ? 'true' : 'false' }))} />
              FlyttGo is registered for MVA (prints "MVA" after the organisation number)
            </label>
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={settings.credit_check_enabled === 'true'}
              onChange={e => setSettings(s => s && ({ ...s, credit_check_enabled: e.target.checked ? 'true' : 'false' }))} />
            <span>
              <strong>Require credit check</strong> before a company can pay on invoice.
              <span className="block text-xs text-gray-500">Off: no credit check is asked for. On: invoicing can only be switched on for a company with a passed credit check, and bookings on invoice need one no older than the validity above. Checks are recorded under Companies.</span>
            </span>
          </label>
          <button disabled={busy} className={`${btn} bg-gray-900 text-white`} onClick={() => run(() => saveInvoiceSettings(settings), 'Settings saved.')}>Save settings</button>
        </div>
      )}
    </div>
  );
}
