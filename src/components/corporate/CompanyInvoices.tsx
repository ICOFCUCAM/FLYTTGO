/**
 * The Invoices tab for a real company (migration 00008): its invoices and
 * credit notes with what is owed, PDF and EHF downloads; the payment terms
 * and invoicing cycle the company chooses (owner, admin, finance); and the
 * logo used on its invoices on the special plan (owner, admin).
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Membership } from '../../lib/organizations';
import {
  INVOICE_STATUS_LABELS, formatNok, isOverdue, loadInvoices, logoUrl, openInvoiceDocument, outstanding,
  setBillingPreferences, termsLabel, uploadLogo, type InvoiceRow,
} from '../../lib/invoicing';

interface Billing {
  payment_terms_type: 'days' | 'day_of_month'; payment_terms_days: number; payment_terms_day: number | null;
  invoice_cycle: 'per_booking' | 'monthly'; invoice_reference: string | null; invoicing_enabled: boolean;
  credit_limit: number | null; billing_plan: string; logo_path: string | null; customer_number: number | null;
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
      <div className={`text-2xl font-extrabold ${tone}`}>{value}</div>
      <div className="text-sm text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

export default function CompanyInvoices({ membership }: { membership: Membership }) {
  const org = membership.organization;
  const role = membership.role;
  const mayReadInvoices = ['owner', 'admin', 'finance'].includes(role);
  const mayEditTerms = mayReadInvoices;
  const mayEditLogo = role === 'owner' || role === 'admin';

  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [form, setForm] = useState({ termsType: 'days' as 'days' | 'day_of_month', preset: '14', days: 14, day: 20, cycle: 'per_booking' as 'per_booking' | 'monthly', reference: '' });
  const [logo, setLogo] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const { data } = await supabase.from('organizations')
      .select('payment_terms_type, payment_terms_days, payment_terms_day, invoice_cycle, invoice_reference, invoicing_enabled, credit_limit, billing_plan, logo_path, customer_number')
      .eq('id', org.id).maybeSingle();
    if (data) {
      const b = data as Billing;
      setBilling(b);
      setForm({
        termsType: b.payment_terms_type, preset: [14, 30].includes(b.payment_terms_days) ? String(b.payment_terms_days) : 'custom',
        days: b.payment_terms_days, day: b.payment_terms_day ?? 20, cycle: b.invoice_cycle, reference: b.invoice_reference ?? '',
      });
      setLogo(await logoUrl(b.logo_path));
    }
    setInvoices(mayReadInvoices ? await loadInvoices(org.id) : []);
  }, [org.id, mayReadInvoices]);
  useEffect(() => { reload(); }, [reload]);

  async function saveTerms() {
    setBusy(true); setMessage(null);
    const days = form.preset === 'custom' ? form.days : Number(form.preset);
    const err = await setBillingPreferences(org.id, { termsType: form.termsType, termsDays: days,
      termsDay: form.termsType === 'day_of_month' ? form.day : null, cycle: form.cycle, reference: form.reference });
    setBusy(false);
    setMessage(err ? { ok: false, text: err } : { ok: true, text: 'Billing preferences saved. They apply to invoices issued from now on.' });
    if (!err) reload();
  }

  async function onLogo(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMessage(null);
    const err = await uploadLogo(org.id, file);
    setBusy(false);
    setMessage(err ? { ok: false, text: err } : { ok: true, text: 'Logo saved.' });
    if (!err) reload();
  }

  const rows = invoices ?? [];
  const open = rows.filter(i => i.kind === 'invoice' && ['issued', 'partially_paid'].includes(i.status));
  const owed = open.reduce((s, i) => s + outstanding(i), 0);
  const overdue = open.filter(i => isOverdue(i)).reduce((s, i) => s + outstanding(i), 0);
  const year = String(new Date().getFullYear());
  const paidThisYear = rows.filter(i => i.issue_date?.startsWith(year)).reduce((s, i) => s + Number(i.amount_paid ?? 0), 0);
  const field = 'border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white';

  return (
    <div className="space-y-6">
      {message && <div className={`rounded-xl px-4 py-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{message.text}</div>}

      {billing && !billing.invoicing_enabled && (
        <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600">
          Invoice payment is not switched on for {org.name} yet. FlyttGo switches it on after reviewing the company;
          until then bookings are paid by card or Vipps.
        </div>
      )}

      {mayReadInvoices && (
        <div className="grid sm:grid-cols-3 gap-4">
          <StatCard label="Outstanding" value={formatNok(owed)} tone="text-gray-900" />
          <StatCard label="Overdue" value={formatNok(overdue)} tone={overdue > 0 ? 'text-red-600' : 'text-gray-900'} />
          <StatCard label={`Paid in ${year}`} value={formatNok(paidThisYear)} tone="text-emerald-700" />
        </div>
      )}

      {mayReadInvoices ? (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>{['Number', 'Date', 'Due', 'Amount', 'Outstanding', 'Status', ''].map(h =>
                <th key={h} className="text-left py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wide">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(i => {
                const late = isOverdue(i);
                return (
                  <tr key={i.id} className="hover:bg-gray-50">
                    <td className="py-3.5 px-4 font-mono text-xs">{i.kind === 'credit_note' ? 'CN ' : ''}{i.number}</td>
                    <td className="py-3.5 px-4">{i.issue_date ? new Date(i.issue_date).toLocaleDateString('nb-NO') : '—'}</td>
                    <td className={`py-3.5 px-4 ${late ? 'text-red-600 font-medium' : ''}`}>{i.kind === 'invoice' && i.due_date ? new Date(i.due_date).toLocaleDateString('nb-NO') : '—'}</td>
                    <td className="py-3.5 px-4 font-medium">{formatNok(i.total)}</td>
                    <td className="py-3.5 px-4">{i.kind === 'invoice' ? formatNok(outstanding(i)) : '—'}</td>
                    <td className="py-3.5 px-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${late ? 'bg-red-100 text-red-700'
                        : i.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : i.status === 'credited' || i.kind === 'credit_note' ? 'bg-gray-100 text-gray-600' : 'bg-orange-100 text-orange-700'}`}>
                        {i.kind === 'credit_note' ? 'Credit note' : late ? 'Overdue' : INVOICE_STATUS_LABELS[i.status] ?? i.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 flex gap-3">
                      <button className="text-xs text-emerald-600 hover:underline" onClick={async () => { const e = await openInvoiceDocument(i.id, 'pdf'); if (e) setMessage({ ok: false, text: e }); }}>PDF</button>
                      <button className="text-xs text-gray-500 hover:underline" onClick={async () => { const e = await openInvoiceDocument(i.id, 'ehf'); if (e) setMessage({ ok: false, text: e }); }}>EHF</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {invoices === null && <div className="py-10 text-center text-gray-400">Loading…</div>}
          {invoices !== null && rows.length === 0 && <div className="py-10 text-center text-gray-400">No invoices yet.</div>}
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600">Invoices are visible to the company's owners, administrators and finance.</div>
      )}

      {billing && (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <h3 className="font-bold text-gray-900">Payment terms and invoicing</h3>
            <p className="text-xs text-gray-500">
              Now: {termsLabel(billing)} · {billing.invoice_cycle === 'monthly' ? 'one invoice a month' : 'one invoice per booking'}
              {billing.customer_number ? ` · customer number ${billing.customer_number}` : ''}
              {billing.credit_limit != null ? ` · credit limit ${formatNok(billing.credit_limit)}` : ''}
            </p>
            <fieldset disabled={!mayEditTerms || busy} className="space-y-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={form.termsType === 'days'} onChange={() => setForm(f => ({ ...f, termsType: 'days' }))} />
                Pay within
                <select className={field} value={form.preset} onChange={e => setForm(f => ({ ...f, preset: e.target.value }))}>
                  <option value="14">14 days</option><option value="30">30 days</option><option value="custom">other</option>
                </select>
                {form.preset === 'custom' && (
                  <><input type="number" min={1} max={60} className={`${field} w-20`} value={form.days}
                      onChange={e => setForm(f => ({ ...f, days: Number(e.target.value) }))} /> days (up to 60)</>
                )}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={form.termsType === 'day_of_month'} onChange={() => setForm(f => ({ ...f, termsType: 'day_of_month' }))} />
                Due on day
                <input type="number" min={1} max={28} className={`${field} w-20`} value={form.day}
                  onChange={e => setForm(f => ({ ...f, day: Number(e.target.value) }))} /> of the following month
              </label>
              <label className="flex items-center gap-2">
                Invoices
                <select className={field} value={form.cycle} onChange={e => setForm(f => ({ ...f, cycle: e.target.value as 'per_booking' | 'monthly' }))}>
                  <option value="per_booking">one per booking, after the move</option>
                  <option value="monthly">one a month (all bookings of the month)</option>
                </select>
              </label>
              <label className="block">
                Your reference on invoices (PO number, cost centre)
                <input className={`${field} w-full mt-1`} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
              </label>
              {mayEditTerms && <button onClick={saveTerms} className="px-5 py-2 bg-[#0B2E59] text-white rounded-xl text-sm font-semibold disabled:opacity-50">Save</button>}
            </fieldset>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <h3 className="font-bold text-gray-900">Logo on invoices</h3>
            <p className="text-xs text-gray-500">
              {billing.billing_plan === 'special'
                ? 'Your company is on the special plan: your name and logo head your invoices.'
                : 'On the special price plan your company\'s name and logo head your invoices. Contact FlyttGo to change plan; you can upload the logo now.'}
            </p>
            {logo ? <img src={logo} alt={`${org.name} logo`} className="max-h-16 max-w-[220px] object-contain" /> : <div className="text-sm text-gray-400">No logo uploaded.</div>}
            {mayEditLogo && (
              <label className="inline-block">
                <span className="px-4 py-2 border border-gray-200 rounded-xl text-sm cursor-pointer hover:bg-gray-50">Upload PNG or JPEG (max 1 MB)</span>
                <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={busy} onChange={e => onLogo(e.target.files?.[0])} />
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
