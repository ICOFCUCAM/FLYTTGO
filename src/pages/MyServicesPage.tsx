/**
 * My jobs and appointments: what a customer has booked with companies on
 * the platform outside moving (docs/SERVICE_PLATFORM.md), and the invoices
 * those companies sent. Accept or decline a quote, cancel within the rules,
 * download an invoice or pay it by card when the company takes cards.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useApp } from '../lib/store';
import { INVOICE_STATUS_LABELS, formatNok, openInvoiceDocument, outstanding } from '../lib/invoicing';
import {
  APPOINTMENT_STATUS, JOB_STATUS, cancelAppointment, cancelJob, loadAppointments, loadJobs, loadMyInvoices, osloDateTime,
  payInvoiceByCard, respondToQuote, type Appointment, type Job, type SalesInvoice,
} from '../lib/services';

const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50';

export default function MyServicesPage() {
  const { user } = useAuth();
  const { setShowAuthModal, setAuthMode } = useApp();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    const [j, a, i] = await Promise.all([loadJobs({ customer: user.id }), loadAppointments({ customer: user.id }), loadMyInvoices(user.id)]);
    setJobs(j); setAppointments(a.reverse()); setInvoices(i);
  }, [user]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('invoice');
    if (q === 'paid') setMsg({ ok: true, text: 'Thank you: the payment is being confirmed by the card company.' });
  }, []);

  async function run(fn: () => Promise<string | null>, ok: string) {
    setBusy(true); setMsg(null);
    const e = await fn();
    setBusy(false);
    setMsg(e ? { ok: false, text: e } : { ok: true, text: ok });
    await reload();
  }

  if (!user) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold mb-3">My jobs and appointments</h1>
      <button onClick={() => { setAuthMode('signin'); setShowAuthModal(true); }} className="px-5 py-2.5 rounded-xl bg-gray-900 text-white font-semibold">Sign in</button>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      <h1 className="text-3xl font-extrabold text-gray-900">My jobs and appointments</h1>
      {msg && <div className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}

      <section>
        <h2 className="font-bold text-lg mb-2">Appointments</h2>
        <div className="space-y-2">
          {appointments.map(a => (
            <div key={a.id} className="bg-white border rounded-xl p-4 flex flex-wrap justify-between gap-2 text-sm">
              <div><div className="font-medium">{osloDateTime(a.starts_at)}</div><div className="text-gray-500">{formatNok(a.price)} · {APPOINTMENT_STATUS[a.status]}</div></div>
              {a.status === 'booked' && new Date(a.starts_at) > new Date() &&
                <button disabled={busy} onClick={() => { if (confirm('Cancel this appointment?')) run(() => cancelAppointment(a.id, ''), 'Cancelled.'); }} className={`${btn} bg-gray-100`}>Cancel</button>}
            </div>
          ))}
          {appointments.length === 0 && <p className="text-sm text-gray-500">No appointments.</p>}
        </div>
      </section>

      <section>
        <h2 className="font-bold text-lg mb-2">Jobs</h2>
        <div className="space-y-2">
          {jobs.map(j => (
            <div key={j.id} className="bg-white border rounded-xl p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <div><div className="font-medium">Job {j.number} · {j.address}</div><div className="text-gray-500">{JOB_STATUS[j.status]}{j.window_start ? ` · ${osloDateTime(j.window_start)}` : ''}</div></div>
                {['requested', 'quoted', 'accepted', 'scheduled'].includes(j.status) &&
                  <button disabled={busy} onClick={() => { if (confirm('Cancel this job?')) run(() => cancelJob(j.id, ''), 'Cancelled.'); }} className={`${btn} bg-gray-100 h-fit`}>Cancel</button>}
              </div>
              {j.status === 'quoted' && (
                <div className="mt-3 bg-gray-50 rounded-lg p-3">
                  <div>Quote: <strong>{formatNok(j.quote_amount ?? 0)}</strong> incl. MVA, valid until {j.quote_valid_until}</div>
                  {j.quote_note && <div className="text-gray-600">{j.quote_note}</div>}
                  <div className="flex gap-2 mt-2">
                    <button disabled={busy} onClick={() => run(() => respondToQuote(j.id, true), 'Quote accepted.')} className={`${btn} bg-emerald-600 text-white`}>Accept</button>
                    <button disabled={busy} onClick={() => run(() => respondToQuote(j.id, false), 'Quote declined.')} className={`${btn} bg-gray-200`}>Decline</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {jobs.length === 0 && <p className="text-sm text-gray-500">No jobs.</p>}
        </div>
      </section>

      <section>
        <h2 className="font-bold text-lg mb-2">Invoices</h2>
        <div className="space-y-2">
          {invoices.map(i => (
            <div key={i.id} className="bg-white border rounded-xl p-4 flex flex-wrap justify-between gap-2 text-sm">
              <div><div className="font-medium">{i.seller?.name} · {i.kind === 'credit_note' ? 'credit note' : 'invoice'} {i.number}</div>
                <div className="text-gray-500">{formatNok(i.total)} · due {i.due_date} · {INVOICE_STATUS_LABELS[i.status] ?? i.status}</div></div>
              <div className="flex gap-2">
                <button onClick={() => openInvoiceDocument(i.id, 'pdf').then(e => e && setMsg({ ok: false, text: e }))} className={`${btn} bg-gray-100`}>PDF</button>
                {i.kind === 'invoice' && outstanding(i) > 0 && <button disabled={busy} onClick={() => run(async () => {
                  const r = await payInvoiceByCard(i.id);
                  if (r.ok && r.data?.url) { window.location.href = r.data.url; return null; }
                  return r.data?.error ?? 'card payment could not be started';
                }, 'Opening card payment…')} className={`${btn} bg-gray-900 text-white`}>Pay {formatNok(outstanding(i))} by card</button>}
              </div>
            </div>
          ))}
          {invoices.length === 0 && <p className="text-sm text-gray-500">No invoices.</p>}
        </div>
      </section>
    </div>
  );
}
