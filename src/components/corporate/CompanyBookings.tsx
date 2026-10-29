/**
 * The Shipments tab for a real company: the bookings made for it
 * (bookings.organization_id, 00007), readable by every member. New
 * bookings go through the ordinary booking flow ("Book for").
 */
import { useEffect, useState } from 'react';
import { useApp } from '../../lib/store';
import { canBookFor, loadCompanyBookings, type Membership } from '../../lib/organizations';

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600', confirmed: 'bg-gray-100 text-gray-600',
  driver_assigned: 'bg-blue-100 text-blue-700', pickup_arrived: 'bg-blue-100 text-blue-700',
  loading: 'bg-blue-100 text-blue-700', in_transit: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-700',
};

export default function CompanyBookings({ membership }: { membership: Membership }) {
  const { setPage } = useApp();
  const [rows, setRows] = useState<any[] | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    setRows(null);
    loadCompanyBookings(membership.organization.id).then(setRows);
  }, [membership.organization.id]);

  const q = search.toLowerCase();
  const shown = (rows ?? []).filter(b =>
    (status === 'all' || b.status === status) &&
    (!q || [b.id, b.pickup_city, b.dropoff_city, b.customer_name, b.customer_email].some(v => String(v ?? '').toLowerCase().includes(q))));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search booking, city or person..."
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-white">
          <option value="all">All Status</option>
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
            <tr>{['Booking', 'From', 'To', 'Date', 'Status', 'Payment', 'Booked by', 'Price'].map(h =>
              <th key={h} className="text-left py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wide">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {shown.map(b => (
              <tr key={b.id} className="hover:bg-gray-50 transition">
                <td className="py-3.5 px-4 font-mono text-xs text-gray-600">{String(b.id).slice(0, 8)}</td>
                <td className="py-3.5 px-4 text-gray-700">{b.pickup_city ?? '—'}</td>
                <td className="py-3.5 px-4 text-gray-700">{b.dropoff_city ?? '—'}</td>
                <td className="py-3.5 px-4 text-gray-600">{b.move_date ? new Date(b.move_date).toLocaleDateString('nb-NO') : '—'}{b.move_time ? ` ${String(b.move_time).slice(0, 5)}` : ''}</td>
                <td className="py-3.5 px-4"><span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLE[b.status] ?? 'bg-gray-100 text-gray-600'}`}>{String(b.status).replace('_', ' ')}</span></td>
                <td className="py-3.5 px-4 text-gray-600">{b.payment_status}</td>
                <td className="py-3.5 px-4 text-gray-600">{b.customer_name ?? b.customer_email ?? '—'}</td>
                <td className="py-3.5 px-4 font-medium text-gray-900">{b.price_estimate != null ? `${Math.round(Number(b.price_estimate)).toLocaleString('nb-NO')} NOK` : '—'}</td>
              </tr>
            ))}
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
