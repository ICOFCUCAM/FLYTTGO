/**
 * The Shipments tab for a real company: the bookings made for it
 * (bookings.organization_id, 00007), readable by every member. New
 * bookings go through the ordinary booking flow ("Book for").
 * Bookings over a member's spending limit or under the company's
 * approval rules wait at the top (00017): owners, admins and finance
 * approve or refuse them, never the person who booked.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../lib/store';
import { useAuth } from '../../lib/auth';
import {
  canBookFor, decideApproval, loadApprovals, loadCompanyBookings, type BookingApproval, type Membership,
} from '../../lib/organizations';
import {
  APPROVAL_REASON_LABELS, APPROVAL_STATUS_LABELS, canApprove, canManageSpending,
} from '../../../supabase/functions/_shared/spending';

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600', confirmed: 'bg-gray-100 text-gray-600',
  driver_assigned: 'bg-blue-100 text-blue-700', pickup_arrived: 'bg-blue-100 text-blue-700',
  loading: 'bg-blue-100 text-blue-700', in_transit: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-700',
};
const APPROVAL_STYLE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700',
  refused: 'bg-red-100 text-red-700', expired: 'bg-gray-100 text-gray-600', withdrawn: 'bg-gray-100 text-gray-600',
};

export default function CompanyBookings({ membership }: { membership: Membership }) {
  const { setPage } = useApp();
  const { user } = useAuth();
  const [rows, setRows] = useState<any[] | null>(null);
  const [approvals, setApprovals] = useState<Record<string, BookingApproval>>({});
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const orgId = membership.organization.id;
    const a = await loadApprovals(orgId);          // ends expired requests first
    setApprovals(Object.fromEntries(a.map(x => [x.booking_id, x])));
    setRows(await loadCompanyBookings(orgId));
  }, [membership.organization.id]);

  useEffect(() => {
    setRows(null);
    reload();
  }, [reload]);

  async function decide(bookingId: string, approve: boolean) {
    let reason: string | null = null;
    if (!approve) {
      reason = prompt('Why is this booking not approved? The person who booked sees the reason.');
      if (reason === null) return;
      if (!reason.trim()) { setMessage({ ok: false, text: 'A refusal needs a reason.' }); return; }
    }
    setBusy(true); setMessage(null);
    const err = await decideApproval(bookingId, approve, reason);
    setBusy(false);
    setMessage(err ? { ok: false, text: err }
      : { ok: true, text: approve ? 'Approved. The person who booked can now complete it.' : 'Refused. The booking is cancelled without any fee.' });
    if (!err) await reload();
  }

  const q = search.toLowerCase();
  const shown = (rows ?? []).filter(b =>
    (status === 'all' || b.status === status || (status === 'awaiting_approval' && approvals[b.id]?.status === 'pending')) &&
    (!q || [b.id, b.pickup_city, b.dropoff_city, b.customer_name, b.customer_email].some(v => String(v ?? '').toLowerCase().includes(q))));
  const waiting = (rows ?? []).filter(b => approvals[b.id]?.status === 'pending');
  const approver = canManageSpending(membership.role);

  return (
    <div className="space-y-4">
      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{message.text}</div>
      )}

      {waiting.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-100 bg-amber-50 font-semibold text-amber-800 text-sm">
            Waiting for approval ({waiting.length})
          </div>
          {waiting.map(b => {
            const a = approvals[b.id];
            const own = a.requested_by === user?.id || b.customer_id === user?.id;
            return (
              <div key={b.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 text-sm border-b border-gray-50 last:border-0">
                <div>
                  <div className="font-medium text-gray-900">
                    {Math.round(Number(a.amount)).toLocaleString('nb-NO')} NOK · {b.pickup_city ?? '—'} → {b.dropoff_city ?? '—'}
                    {b.move_date ? ` · ${new Date(b.move_date).toLocaleDateString('nb-NO')}` : ''}
                  </div>
                  <div className="text-xs text-gray-500">
                    Booked by {b.customer_name ?? b.customer_email ?? '—'} · {a.reasons.map(r => APPROVAL_REASON_LABELS[r] ?? r).join('; ')}
                    {a.expires_at ? ` · expires ${new Date(a.expires_at).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' })}` : ''}
                  </div>
                </div>
                {canApprove(membership.role, own) ? (
                  <div className="flex gap-2">
                    <button disabled={busy} onClick={() => decide(b.id, true)}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">Approve</button>
                    <button disabled={busy} onClick={() => decide(b.id, false)}
                      className="px-4 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 hover:text-red-600 disabled:opacity-50">Refuse…</button>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">{own && approver ? 'Your own booking: another approver decides' : 'Waiting for an approver'}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search booking, city or person..."
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-white">
          <option value="all">All Status</option>
          <option value="awaiting_approval">awaiting approval</option>
          {Object.keys(STATUS_STYLE).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        {canBookFor(membership) && (
          <button onClick={() => setPage('booking')} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition">
            + New Shipment
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Booking', 'From', 'To', 'Date', 'Status', 'Payment', 'Approval', 'Booked by', 'Price'].map(h =>
              <th key={h} className="text-left py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wide">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {shown.map(b => {
              const a = approvals[b.id];
              return (
                <tr key={b.id} className="hover:bg-gray-50 transition">
                  <td className="py-3.5 px-4 font-mono text-xs text-gray-600">{String(b.id).slice(0, 8)}</td>
                  <td className="py-3.5 px-4 text-gray-700">{b.pickup_city ?? '—'}</td>
                  <td className="py-3.5 px-4 text-gray-700">{b.dropoff_city ?? '—'}</td>
                  <td className="py-3.5 px-4 text-gray-600">{b.move_date ? new Date(b.move_date).toLocaleDateString('nb-NO') : '—'}{b.move_time ? ` ${String(b.move_time).slice(0, 5)}` : ''}</td>
                  <td className="py-3.5 px-4"><span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLE[b.status] ?? 'bg-gray-100 text-gray-600'}`}>{String(b.status).replace('_', ' ')}</span></td>
                  <td className="py-3.5 px-4 text-gray-600">{b.payment_status}</td>
                  <td className="py-3.5 px-4 text-gray-600">
                    {a ? (
                      <span title={a.decision_reason ?? undefined} className={`px-2.5 py-1 rounded-full text-xs font-medium ${APPROVAL_STYLE[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {APPROVAL_STATUS_LABELS[a.status]}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-3.5 px-4 text-gray-600">{b.customer_name ?? b.customer_email ?? '—'}</td>
                  <td className="py-3.5 px-4 font-medium text-gray-900">{b.price_estimate != null ? `${Math.round(Number(b.price_estimate)).toLocaleString('nb-NO')} NOK` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows === null && <div className="py-12 text-center text-gray-400">Loading…</div>}
        {rows !== null && shown.length === 0 && (
          <div className="py-12 text-center text-gray-400">
            {rows.length === 0 ? 'No bookings for this company yet.' : 'No bookings match your search.'}
          </div>
        )}
      </div>
    </div>
  );
}
