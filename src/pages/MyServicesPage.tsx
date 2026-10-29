/**
 * My jobs and appointments: what a customer has booked with companies on
 * the platform outside moving (docs/SERVICE_PLATFORM.md), and the invoices
 * those companies sent. Accept or decline a quote, cancel within the rules,
 * download an invoice or pay it by card when the company takes cards.
 * Orders from companies' shops (00020): pay or cancel an unpaid order,
 * follow delivery, the receipt, and withdraw from a purchase (the form is
 * recorded; the shop refunds).
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useApp } from '../lib/store';
import { INVOICE_STATUS_LABELS, formatNok, openInvoiceDocument, outstanding } from '../lib/invoicing';
import {
  APPOINTMENT_STATUS, JOB_STATUS, cancelAppointment, cancelJob, loadAppointments, loadJobs, loadMyInvoices, osloDateTime,
  payInvoiceByCard, respondToQuote, type Appointment, type Job, type SalesInvoice,
} from '../lib/services';
import {
  ORDER_STATUS, WITHDRAWAL_STATUS, canWithdraw, cancelOrder, loadOrders, loadReturns, payOrder, requestWithdrawal, withdrawalDeadline,
  type ShopOrder, type ShopRefund, type ShopWithdrawal,
} from '../lib/shop';

const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50';

export default function MyServicesPage() {
  const { user } = useAuth();
  const { setShowAuthModal, setAuthMode } = useApp();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [returns, setReturns] = useState<{ withdrawals: ShopWithdrawal[]; refunds: ShopRefund[] }>({ withdrawals: [], refunds: [] });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    const [j, a, i, o] = await Promise.all([loadJobs({ customer: user.id }), loadAppointments({ customer: user.id }), loadMyInvoices(user.id),
                                            loadOrders({ customer: user.id })]);
    setJobs(j); setAppointments(a.reverse()); setInvoices(i); setOrders(o);
    setReturns(await loadReturns(o.map(x => x.id)));
  }, [user]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('invoice');
    if (q === 'paid') setMsg({ ok: true, text: 'Thank you: the payment is being confirmed by the card company.' });
    if (new URLSearchParams(window.location.search).get('order') === 'paid') {
      setMsg({ ok: true, text: 'Thank you for your order: the payment is being confirmed, and the shop emails you the confirmation.' });
    }
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
        <h2 className="font-bold text-lg mb-2">Orders</h2>
        <div className="space-y-2">
          {orders.map(o => <OrderCard key={o.id} o={o} busy={busy} run={run}
            withdrawals={returns.withdrawals.filter(w => w.order_id === o.id)} refunds={returns.refunds.filter(r => r.order_id === o.id)}
            seller={invoices.find(i => i.id === o.invoice_id)?.seller?.name ?? null} />)}
          {orders.length === 0 && <p className="text-sm text-gray-500">No orders.</p>}
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

function OrderCard({ o, withdrawals, refunds, seller, busy, run }: {
  o: ShopOrder; withdrawals: ShopWithdrawal[]; refunds: ShopRefund[]; seller: string | null; busy: boolean;
  run: (fn: () => Promise<string | null>, ok: string) => Promise<void>;
}) {
  const [form, setForm] = useState<Record<string, number> | null>(null);
  const [message, setMessage] = useState('');
  const deadline = withdrawalDeadline(o.delivered_at);
  const pending = withdrawals.some(w => w.status === 'requested' || w.status === 'received');
  const left = (o.shop_order_lines ?? []).filter(l => l.quantity > l.refunded_quantity);
  return (
    <div className="bg-white border rounded-xl p-4 text-sm space-y-2">
      <div className="flex flex-wrap justify-between gap-2">
        <div><div className="font-medium">{seller ? `${seller} · ` : ''}Order {o.number} · {formatNok(o.total)} incl. MVA</div>
          <div className="text-gray-500">{ORDER_STATUS[o.status]} · {osloDateTime(o.created_at)}{o.tracking ? ` · ${o.tracking}` : ''}
            {o.refunded_amount > 0 ? ` · refunded ${formatNok(o.refunded_amount)}` : ''}</div></div>
        <div className="flex gap-2 h-fit">
          {o.status === 'awaiting_payment' && <>
            <button disabled={busy} onClick={() => run(async () => {
              const r = await payOrder(o.id);
              if (r.ok && r.data?.url) { window.location.href = r.data.url; return null; }
              return r.data?.error ?? 'card payment could not be started';
            }, 'Opening card payment…')} className={`${btn} bg-gray-900 text-white`}>Pay {formatNok(o.total)} by card</button>
            <button disabled={busy} onClick={() => { if (confirm('Cancel this order?')) run(() => cancelOrder(o.id, ''), 'Cancelled.'); }} className={`${btn} bg-gray-100`}>Cancel</button>
          </>}
          {o.invoice_id && <button onClick={() => openInvoiceDocument(o.invoice_id!, 'pdf')} className={`${btn} bg-gray-100`}>Receipt</button>}
        </div>
      </div>
      <ul className="text-gray-600">{(o.shop_order_lines ?? []).map(l => <li key={l.id}>{l.quantity} × {l.name} · {formatNok(l.total)}</li>)}
        <li>{o.delivery_method === 'shipping' ? `Shipping to ${o.delivery_address?.address}, ${o.delivery_address?.postcode} ${o.delivery_address?.city}` : 'Pickup'} · {formatNok(o.delivery_price)}</li></ul>
      {o.status === 'awaiting_payment' && <p className="text-xs text-gray-500">The goods are held for you until {osloDateTime(o.expires_at)}.</p>}
      {withdrawals.map(w => <p key={w.id} className="text-xs text-gray-600">Withdrawal {osloDateTime(w.requested_at)}: {WITHDRAWAL_STATUS[w.status]}{w.note ? ` (${w.note})` : ''}</p>)}
      {refunds.filter(r => r.status === 'succeeded').map(r => <p key={r.id} className="text-xs text-emerald-700">Refunded {formatNok(r.amount)} to your card.</p>)}
      {canWithdraw(o) && !pending && left.length > 0 && (form === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={busy} onClick={() => setForm(Object.fromEntries(left.map(l => [l.id, l.quantity - l.refunded_quantity])))} className={`${btn} bg-gray-100`}>Withdraw from the purchase…</button>
          <span className="text-xs text-gray-500">{deadline ? `The 14-day right of withdrawal runs until ${deadline}.` : 'You have 14 days from receiving the goods.'}</span>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg p-3 space-y-2">
          <div className="font-medium">I withdraw from my purchase of:</div>
          {left.map(l => (
            <label key={l.id} className="flex items-center gap-2">
              <input type="number" min={0} max={l.quantity - l.refunded_quantity} value={form[l.id] ?? 0} className="border rounded px-2 py-1 w-16"
                onChange={e => setForm({ ...form, [l.id]: Math.max(0, Math.min(l.quantity - l.refunded_quantity, Number(e.target.value))) })} />
              <span>of {l.quantity - l.refunded_quantity} × {l.name}</span>
            </label>
          ))}
          <textarea rows={2} className="w-full border rounded-lg px-3 py-2" placeholder="Message to the shop (optional; no reason is needed)" value={message} onChange={e => setMessage(e.target.value)} />
          <p className="text-xs text-gray-500">Your withdrawal is recorded with today's date and shown to the shop. Send the goods back as the shop asks; when it refunds, the money goes back to your card.</p>
          <div className="flex gap-2">
            <button disabled={busy || !Object.values(form).some(q => q > 0)} className={`${btn} bg-gray-900 text-white`} onClick={() => run(async () => {
              const lines = Object.entries(form).filter(([, q]) => q > 0).map(([line_id, quantity]) => ({ line_id, quantity }));
              const e = await requestWithdrawal(o.id, lines, message);
              if (!e) setForm(null);
              return e;
            }, 'Your withdrawal is recorded.')}>Send the withdrawal</button>
            <button onClick={() => setForm(null)} className={`${btn} bg-gray-200`}>Close</button>
          </div>
        </div>
      ))}
    </div>
  );
}
