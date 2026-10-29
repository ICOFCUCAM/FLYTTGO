/**
 * Corporate dashboard → Invoices to customers (00011): the company's own
 * invoices, in its name, its number series and bank account. Settings
 * (the seller on the invoice), new invoices with lines, and per invoice:
 * issue, PDF/EHF, email, payment, reminder, credit note. Jobs and
 * appointments are invoiced from their own tabs. Owners, admins and
 * finance; the database checks every step.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Membership } from '../../lib/organizations';
import { INVOICE_STATUS_LABELS, formatNok, isOverdue, openInvoiceDocument, outstanding } from '../../lib/invoicing';
import {
  createSalesInvoice, creditInvoice, deleteDraft, issueInvoice, loadInvoiceSettings, loadSalesInvoices, recordPayment,
  saveInvoiceSettings, sendInvoice, sendReminder, type InvoiceSettings, type SalesInvoice,
} from '../../lib/services';

const input = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm';
const btn = 'px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50';
type Line = { description: string; quantity: number; unit_price: number; vat_rate: number };

export default function SalesInvoicesPanel({ membership }: { membership: Membership }) {
  const org = membership.organization;
  const canOperate = ['owner', 'admin', 'finance'].includes(membership.role);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [settings, setSettings] = useState<Partial<InvoiceSettings>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<{ name: string; email: string; address: string; postcode_city: string; org_number: string; reference: string; lines: Line[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [i, s] = await Promise.all([loadSalesInvoices(org.id), loadInvoiceSettings(org.id)]);
    setInvoices(i); setSettings(s ?? { terms_days: 14, reminder_fee: 0, logo_on_invoices: true });
    if (!s?.bank_account) setShowSettings(true);
  }, [org.id]);
  useEffect(() => { reload(); }, [reload]);

  async function run(fn: () => Promise<string | null>, ok: string) {
    setBusy(true); setMsg(null);
    const e = await fn();
    setBusy(false);
    setMsg(e ? { ok: false, text: e } : { ok: true, text: ok });
    await reload();
  }
  if (!canOperate) return <p className="text-sm text-gray-500">The company's owners, admins and finance handle its invoices.</p>;

  const set = (k: keyof InvoiceSettings, v: unknown) => setSettings({ ...settings, [k]: v });
  const total = (lines: Line[]) => lines.reduce((s, l) => s + l.quantity * l.unit_price * (1 + l.vat_rate / 100), 0);
  const open = invoices.filter(i => i.kind === 'invoice' && ['issued', 'partially_paid'].includes(i.status));

  return (
    <div className="space-y-5 max-w-5xl">
      {msg && <div className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border p-4"><div className="text-xs text-gray-500">Outstanding</div><div className="text-xl font-bold">{formatNok(open.reduce((s, i) => s + outstanding(i), 0))}</div></div>
        <div className="bg-white rounded-2xl border p-4"><div className="text-xs text-gray-500">Overdue</div><div className="text-xl font-bold text-red-700">{formatNok(open.filter(i => isOverdue(i)).reduce((s, i) => s + outstanding(i), 0))}</div></div>
        <div className="bg-white rounded-2xl border p-4 flex items-center gap-2">
          <button onClick={() => setDraft({ name: '', email: '', address: '', postcode_city: '', org_number: '', reference: '', lines: [{ description: '', quantity: 1, unit_price: 0, vat_rate: 25 }] })}
            className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">New invoice</button>
          <button onClick={() => setShowSettings(!showSettings)} className="px-4 py-2 rounded-xl bg-gray-100 text-sm">Invoice settings</button>
        </div>
      </div>

      {showSettings && (
        <div className="bg-white rounded-2xl border p-5">
          <h3 className="font-bold mb-1">The seller on your invoices</h3>
          <p className="text-xs text-gray-500 mb-3">Your company issues these invoices in its own name and number series; the organisation number and MVA status come from your company details.</p>
          <div className="grid md:grid-cols-3 gap-3 text-sm">
            <label>Legal name<input className={input} value={settings.legal_name ?? ''} placeholder={org.name} onChange={e => set('legal_name', e.target.value)} /></label>
            <label>Address<input className={input} value={settings.address ?? ''} onChange={e => set('address', e.target.value)} /></label>
            <label>Postcode and town<input className={input} value={settings.postcode_city ?? ''} onChange={e => set('postcode_city', e.target.value)} /></label>
            <label>Invoice email (replies)<input className={input} value={settings.email ?? ''} onChange={e => set('email', e.target.value)} /></label>
            <label>Phone<input className={input} value={settings.phone ?? ''} onChange={e => set('phone', e.target.value)} /></label>
            <label>Bank account (11 digits)<input className={input} value={settings.bank_account ?? ''} onChange={e => set('bank_account', e.target.value)} /></label>
            <label>IBAN (optional)<input className={input} value={settings.iban ?? ''} onChange={e => set('iban', e.target.value)} /></label>
            <label>BIC (optional)<input className={input} value={settings.bic ?? ''} onChange={e => set('bic', e.target.value)} /></label>
            <label>Payment terms (days)<input type="number" min={0} max={60} className={input} value={settings.terms_days ?? 14} onChange={e => set('terms_days', Number(e.target.value))} /></label>
            <label>Reminder fee (NOK)<input type="number" min={0} className={input} value={settings.reminder_fee ?? 0} onChange={e => set('reminder_fee', Number(e.target.value))} /></label>
            <label>Late interest % per year (empty: none)<input type="number" min={0} step="0.25" className={input} value={settings.late_interest_pct ?? ''} onChange={e => set('late_interest_pct', e.target.value === '' ? null : Number(e.target.value))} /></label>
            <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={settings.logo_on_invoices ?? true} onChange={e => set('logo_on_invoices', e.target.checked)} /> Logo on invoices</label>
          </div>
          <p className="text-xs text-gray-500 mt-2">Check the reminder fee and interest against inkassoforskriften and the current forsinkelsesrente before you set them.</p>
          <button disabled={busy} onClick={() => run(() => saveInvoiceSettings(org.id, settings), 'Invoice settings saved.')} className="mt-3 px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">Save settings</button>
        </div>
      )}

      {draft && (
        <div className="bg-white rounded-2xl border p-5">
          <h3 className="font-bold mb-3">New invoice</h3>
          <div className="grid md:grid-cols-3 gap-3 text-sm">
            <label>Customer name<input className={input} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>Email (to send it)<input className={input} value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} /></label>
            <label>Organisation number (businesses)<input className={input} value={draft.org_number} onChange={e => setDraft({ ...draft, org_number: e.target.value })} /></label>
            <label>Address<input className={input} value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} /></label>
            <label>Postcode and town<input className={input} value={draft.postcode_city} onChange={e => setDraft({ ...draft, postcode_city: e.target.value })} /></label>
            <label>Their reference<input className={input} value={draft.reference} onChange={e => setDraft({ ...draft, reference: e.target.value })} /></label>
          </div>
          <table className="w-full text-sm mt-4">
            <thead><tr className="text-xs text-gray-500 text-left"><th>Description</th><th className="w-20">Qty</th><th className="w-32">Price excl. MVA</th><th className="w-24">MVA %</th><th /></tr></thead>
            <tbody>
              {draft.lines.map((l, i) => (
                <tr key={i}>
                  <td className="pe-2 py-1"><input className={input} value={l.description} onChange={e => { const ls = [...draft.lines]; ls[i] = { ...l, description: e.target.value }; setDraft({ ...draft, lines: ls }); }} /></td>
                  <td className="pe-2"><input type="number" step="any" className={input} value={l.quantity} onChange={e => { const ls = [...draft.lines]; ls[i] = { ...l, quantity: Number(e.target.value) }; setDraft({ ...draft, lines: ls }); }} /></td>
                  <td className="pe-2"><input type="number" step="any" className={input} value={l.unit_price} onChange={e => { const ls = [...draft.lines]; ls[i] = { ...l, unit_price: Number(e.target.value) }; setDraft({ ...draft, lines: ls }); }} /></td>
                  <td className="pe-2"><select className={input} value={l.vat_rate} onChange={e => { const ls = [...draft.lines]; ls[i] = { ...l, vat_rate: Number(e.target.value) }; setDraft({ ...draft, lines: ls }); }}>{[25, 15, 12, 0].map(r => <option key={r} value={r}>{r}</option>)}</select></td>
                  <td><button onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })} className="text-xs text-red-600">Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between items-center mt-3">
            <button onClick={() => setDraft({ ...draft, lines: [...draft.lines, { description: '', quantity: 1, unit_price: 0, vat_rate: 25 }] })} className="text-sm text-[#0B2E59]">+ Line</button>
            <div className="text-sm">Total incl. MVA: <strong>{formatNok(total(draft.lines))}</strong></div>
          </div>
          <div className="flex gap-2 mt-4">
            <button disabled={busy} onClick={() => run(async () => {
              const r = await createSalesInvoice(org.id, { name: draft.name, email: draft.email, address: draft.address, postcode_city: draft.postcode_city, org_number: draft.org_number },
                                                 draft.lines, draft.reference);
              if (!r.error) setDraft(null);
              return r.error;
            }, 'Draft saved. Issue it to give it its number.')} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">Save draft</button>
            <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-xl bg-gray-100 text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr>{['No.', 'Customer', 'Date', 'Due', 'Total', 'Owed', 'Status', ''].map(h => <th key={h} className="text-left p-3 text-xs text-gray-500">{h}</th>)}</tr></thead>
          <tbody>
            {invoices.map(i => (
              <tr key={i.id} className="border-t align-top">
                <td className="p-3">{i.number ?? '—'}{i.kind === 'credit_note' ? ' (credit)' : ''}</td>
                <td className="p-3">{i.buyer?.name}<div className="text-xs text-gray-400">{i.source_type === 'job' ? 'Job' : i.source_type === 'appointment' ? 'Appointment' : ''} {i.reference ?? ''}</div></td>
                <td className="p-3">{i.issue_date ?? '—'}</td>
                <td className={`p-3 ${isOverdue(i) ? 'text-red-700 font-medium' : ''}`}>{i.due_date ?? '—'}</td>
                <td className="p-3">{formatNok(i.total)}</td>
                <td className="p-3">{i.kind === 'invoice' && i.status !== 'draft' ? formatNok(outstanding(i)) : ''}</td>
                <td className="p-3 text-xs">{INVOICE_STATUS_LABELS[i.status] ?? i.status}{i.sent_at ? ' · sent' : ''}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {i.status === 'draft' ? (<>
                      <button disabled={busy} onClick={() => run(() => issueInvoice(i.id), 'Issued.')} className={`${btn} bg-[#0B2E59] text-white`}>Issue</button>
                      <button disabled={busy} onClick={() => run(() => deleteDraft(i.id), 'Draft deleted.')} className={`${btn} bg-gray-100`}>Delete</button>
                    </>) : (<>
                      <button onClick={() => openInvoiceDocument(i.id, 'pdf').then(e => e && setMsg({ ok: false, text: e }))} className={`${btn} bg-gray-100`}>PDF</button>
                      <button onClick={() => openInvoiceDocument(i.id, 'ehf').then(e => e && setMsg({ ok: false, text: e }))} className={`${btn} bg-gray-100`}>EHF</button>
                      <button disabled={busy} onClick={() => run(async () => { const r = await sendInvoice(i.id); return r.ok ? null : (r.data?.error ?? 'send failed'); }, 'Sent.')} className={`${btn} bg-gray-100`}>Email</button>
                      {i.kind === 'invoice' && outstanding(i) > 0 && (<>
                        <button disabled={busy} onClick={() => {
                          const a = prompt(`Amount received (owed ${outstanding(i)})`, String(outstanding(i)));
                          if (a) run(() => recordPayment(i.id, Number(a.replace(',', '.')), new Date().toISOString().slice(0, 10), 'bank', prompt('Bank reference (optional)') ?? ''), 'Payment recorded.');
                        }} className={`${btn} bg-emerald-600 text-white`}>Payment</button>
                        {isOverdue(i) && <button disabled={busy} onClick={() => run(async () => {
                          const e = await sendReminder(i.id); if (e) return e;
                          const r = await sendInvoice(i.id, 'reminder'); return r.ok ? null : (r.data?.error ?? 'reminder recorded; email failed');
                        }, 'Reminder sent.')} className={`${btn} bg-orange-500 text-white`}>Reminder</button>}
                      </>)}
                      {i.kind === 'invoice' && i.status !== 'credited' && <button disabled={busy} onClick={() => {
                        const why = prompt('Reason for the credit note'); if (!why) return;
                        const amt = prompt('Amount to credit incl. MVA (empty: the whole invoice)') ?? '';
                        run(() => creditInvoice(i.id, amt.trim() ? Number(amt.replace(',', '.')) : null, why), 'Credit note issued.');
                      }} className={`${btn} bg-gray-100`}>Credit</button>}
                    </>)}
                  </div>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-400">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
