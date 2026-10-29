/**
 * Corporate dashboard → Hotel (00019): the desk for a day (arrivals, guests
 * in the house, departures: book a guest, check in, also to another room,
 * check out, no-show, cancel, invoice the stay or the fee), room types and
 * rooms, closed rooms and dates, and the hotel's rules (its MVA rate for
 * accommodation, times, nights, cancellation). Desk staff check guests in
 * and out. The database checks every step and never sells a night twice.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Membership } from '../../lib/organizations';
import { formatNok } from '../../lib/invoicing';
import { addDays, osloToday } from '../../lib/services';
import {
  DEFAULT_HOTEL_SETTINGS, STAY_STATUS, addClosure, cancelStay, checkInStay, checkOutStay, createStay, invoiceStay,
  loadHotelSetup, loadStays, markStayNoShow, nightsBetween, removeClosure, saveHotelSettings, saveRoom, saveRoomType,
  type HotelSettings, type HotelStay, type Room, type RoomType,
} from '../../lib/reservations';

const input = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm';
const btn = 'px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50';
type Setup = Awaited<ReturnType<typeof loadHotelSetup>>;
type Run = (f: () => Promise<string | null>, ok: string) => void;

export default function HotelPanel({ membership }: { membership: Membership }) {
  const org = membership.organization;
  const role = membership.role;
  const manage = role === 'owner' || role === 'admin';
  const desk = manage || role === 'booker' || role === 'staff';
  const book = manage || role === 'booker';
  const [view, setView] = useState<'desk' | 'rooms' | 'closures' | 'rules'>('desk');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [day, setDay] = useState(osloToday());
  const [stays, setStays] = useState<HotelStay[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [s, l] = await Promise.all([loadHotelSetup(org.id), loadStays({ orgId: org.id, from: day, to: day })]);
    setSetup(s); setStays(l);
  }, [org.id, day]);
  useEffect(() => { reload(); }, [reload]);

  async function run(fn: () => Promise<string | null>, ok: string) {
    setBusy(true); setMsg(null);
    const e = await fn();
    setBusy(false);
    setMsg(e ? { ok: false, text: e } : { ok: true, text: ok });
    await reload();
  }
  if (!setup) return <p className="text-sm text-gray-500">Loading…</p>;
  const roomName = (id: string) => setup.rooms.find(r => r.id === id)?.name ?? '';
  const typeName = (id: string) => setup.types.find(t => t.id === id)?.name ?? '';
  const arrivals = stays.filter(s => s.check_in === day);
  const departures = stays.filter(s => s.check_out === day);
  const inHouse = stays.filter(s => s.check_in < day && s.check_out > day);
  const section = (title: string, list: HotelStay[]) => (
    <div className="bg-white rounded-2xl border">
      <div className="px-4 py-2 border-b font-semibold text-sm">{title} ({list.filter(s => s.status !== 'cancelled').length})</div>
      {list.map(s => (
        <div key={s.id} className={`px-4 py-2 border-b text-sm ${s.status === 'cancelled' ? 'opacity-50' : ''}`}>
          <div className="flex justify-between gap-2"><span className="font-medium">{roomName(s.room_id)} · {s.customer.name}</span>
            <span className="text-xs text-gray-500">{STAY_STATUS[s.status]}</span></div>
          <div className="text-xs text-gray-500">{typeName(s.room_type_id)} · {s.guests} {s.guests === 1 ? 'guest' : 'guests'} · {s.check_in} → {s.check_out}
            ({s.nights} {s.nights === 1 ? 'night' : 'nights'}) · {formatNok(s.total)} · {s.customer.phone}{s.notes ? ` · ${s.notes}` : ''}</div>
          {s.cancel_fee ? <div className="text-xs text-gray-500">Fee {formatNok(s.cancel_fee)}</div> : null}
          <div className="flex gap-1 mt-1 flex-wrap">
            {s.status === 'booked' && desk && day >= s.check_in && <CheckInButton stay={s} rooms={setup.rooms} busy={busy} run={run} />}
            {s.status === 'checked_in' && desk && <button disabled={busy} onClick={() => run(() => checkOutStay(s.id), 'Checked out.')} className={`${btn} bg-emerald-600 text-white`}>Check out</button>}
            {s.status === 'booked' && book && osloToday() >= s.check_in &&
              <button disabled={busy} onClick={() => run(() => markStayNoShow(s.id), 'Marked no-show.')} className={`${btn} bg-orange-500 text-white`}>No-show</button>}
            {s.status === 'booked' && book && <button disabled={busy} onClick={() => {
              const why = prompt('Reason for cancelling'); if (why === null) return;
              const late = s.free_cancel_until != null && osloToday() > s.free_cancel_until && (s.late_cancel_fee ?? 0) > 0;
              const charge = late && confirm(`The free cancellation ended ${s.free_cancel_until}. Charge the fee of ${formatNok(s.late_cancel_fee ?? 0)}?`);
              run(() => cancelStay(s.id, why, charge), charge ? 'Cancelled with the fee.' : 'Cancelled.');
            }} className={`${btn} bg-gray-100`}>Cancel</button>}
            {!s.invoice_id && ['owner', 'admin', 'finance'].includes(role) && (['checked_in', 'checked_out'].includes(s.status) || (s.cancel_fee ?? 0) > 0) &&
              <button disabled={busy} onClick={() => run(() => invoiceStay(s.id), 'Invoiced in your company\'s name.')} className={`${btn} bg-gray-100`}>
                {['checked_in', 'checked_out'].includes(s.status) ? 'Invoice stay' : 'Invoice fee'}</button>}
            {s.invoice_id && <span className="text-xs text-gray-400">invoiced</span>}
          </div>
        </div>
      ))}
      {list.length === 0 && <p className="px-4 py-3 text-xs text-gray-400">None.</p>}
    </div>
  );

  return (
    <div className="space-y-5 max-w-6xl">
      {msg && <div className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
      {setup.settings?.vat_rate == null && <div className="rounded-xl px-4 py-3 text-sm bg-amber-50 text-amber-800">Set your MVA rate for accommodation under Rules before guests can book.</div>}
      <div className="flex gap-2 flex-wrap">
        {(['desk', 'rooms', 'closures', 'rules'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-full text-xs font-medium ${view === v ? 'bg-gray-900 text-white' : 'bg-white border'}`}>
            {{ desk: 'Front desk', rooms: `Rooms (${setup.rooms.length})`, closures: 'Closed rooms and dates', rules: 'Rules' }[v]}
          </button>
        ))}
      </div>

      {view === 'desk' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setDay(addDays(day, -1))} className={`${btn} bg-gray-100`}>‹</button>
            <input type="date" value={day} onChange={e => setDay(e.target.value)} className="border rounded-lg px-2 py-1 text-sm" />
            <button onClick={() => setDay(addDays(day, 1))} className={`${btn} bg-gray-100`}>›</button>
            <button onClick={() => setDay(osloToday())} className={`${btn} bg-gray-100`}>Today</button>
            {desk && setup.types.length > 0 && <CompanyStay orgId={org.id} setup={setup} day={day} busy={busy} run={run} />}
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            {section('Arrivals', arrivals)}
            {section('In the house', inHouse)}
            {section('Departures', departures)}
          </div>
        </div>
      )}
      {view === 'rooms' && <RoomsEditor orgId={org.id} setup={setup} canEdit={manage} busy={busy} run={run} />}
      {view === 'closures' && (
        <div className="bg-white rounded-2xl border p-5 text-sm space-y-2 max-w-3xl">
          <p className="text-gray-500">A closed room (or the whole hotel) is not offered for those nights. Stays already booked stay; move or cancel them.</p>
          {setup.closures.map(c => (
            <div key={c.id} className="flex items-center gap-2">{c.room_id ? `Room ${roomName(c.room_id)}` : 'The whole hotel'}: nights {c.from_date} up to {c.to_date}{c.reason ? ` · ${c.reason}` : ''}
              {book && <button disabled={busy} onClick={() => run(() => removeClosure(c.id), 'Open again.')} className="text-xs text-red-600">Remove</button>}</div>
          ))}
          {setup.closures.length === 0 && <p className="text-gray-400">None.</p>}
          {book && <ClosureForm orgId={org.id} rooms={setup.rooms} busy={busy} run={run} />}
        </div>
      )}
      {view === 'rules' && <RulesEditor orgId={org.id} settings={setup.settings} canEdit={manage} busy={busy} run={run} />}
    </div>
  );
}

function CheckInButton({ stay, rooms, busy, run }: { stay: HotelStay; rooms: Room[]; busy: boolean; run: Run }) {
  const [room, setRoom] = useState('');
  return (
    <span className="flex gap-1 items-center">
      <select className="border rounded text-xs py-1" value={room} onChange={e => setRoom(e.target.value)}>
        <option value="">booked room</option>{rooms.filter(r => r.active && r.id !== stay.room_id).map(r => <option key={r.id} value={r.id}>room {r.name}</option>)}</select>
      <button disabled={busy} onClick={() => run(() => checkInStay(stay.id, room || null), 'Checked in.')} className={`${btn} bg-emerald-600 text-white`}>Check in</button>
    </span>
  );
}

/** A guest by phone or at the desk: a room type (or a named room) for dates. */
function CompanyStay({ orgId, setup, day, busy, run }: { orgId: string; setup: Setup; day: string; busy: boolean; run: Run }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(setup.types[0]?.id ?? '');
  const [room, setRoom] = useState('');
  const [checkIn, setCheckIn] = useState(day);
  const [checkOut, setCheckOut] = useState(addDays(day, 1));
  const [guests, setGuests] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  if (!open) return <button onClick={() => setOpen(true)} className={`${btn} bg-[#0B2E59] text-white ms-auto`}>+ Book a guest</button>;
  return (
    <div className="w-full bg-white border rounded-xl p-3 flex flex-wrap gap-2 items-end">
      <label className="text-xs">Room type<select className={input} value={type} onChange={e => { setType(e.target.value); setRoom(''); }}>
        {setup.types.map(t => <option key={t.id} value={t.id}>{t.name} ({t.capacity})</option>)}</select></label>
      <label className="text-xs">Room<select className={input} value={room} onChange={e => setRoom(e.target.value)}>
        <option value="">Any free</option>{setup.rooms.filter(r => r.room_type_id === type && r.active).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label className="text-xs">Arrival<input type="date" className={input} value={checkIn} onChange={e => setCheckIn(e.target.value)} /></label>
      <label className="text-xs">Departure<input type="date" className={input} value={checkOut} onChange={e => setCheckOut(e.target.value)} /></label>
      <label className="text-xs">Guests<input type="number" min={1} max={20} className={input} value={guests} onChange={e => setGuests(Number(e.target.value))} /></label>
      <label className="text-xs">Name<input className={input} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="text-xs">Phone<input className={input} value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <label className="text-xs">Email<input className={input} value={email} onChange={e => setEmail(e.target.value)} /></label>
      <span className="text-xs text-gray-500">{nightsBetween(checkIn, checkOut)} nights</span>
      <button disabled={busy || !type || !name || !phone || nightsBetween(checkIn, checkOut) < 1} onClick={() =>
        run(async () => { const e = await createStay(orgId, type, room || null, checkIn, checkOut, guests, { name, phone, email }, ''); if (!e) setOpen(false); return e; }, 'Booked.')}
        className={`${btn} bg-[#0B2E59] text-white`}>Book</button>
      <button onClick={() => setOpen(false)} className={`${btn} bg-gray-100`}>Close</button>
    </div>
  );
}

function ClosureForm({ orgId, rooms, busy, run }: { orgId: string; rooms: Room[]; busy: boolean; run: Run }) {
  const [room, setRoom] = useState('');
  const [from, setFrom] = useState(osloToday());
  const [to, setTo] = useState(addDays(osloToday(), 1));
  const [reason, setReason] = useState('');
  return (
    <div className="flex flex-wrap gap-2 items-end pt-2">
      <label className="text-xs">Room<select className={input} value={room} onChange={e => setRoom(e.target.value)}>
        <option value="">The whole hotel</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label className="text-xs">First night<input type="date" className={input} value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label className="text-xs">Open again on<input type="date" className={input} value={to} onChange={e => setTo(e.target.value)} /></label>
      <label className="text-xs">Reason<input className={input} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button disabled={busy || to <= from} onClick={() => run(() => addClosure(orgId, room || null, from, to, reason), 'Closed.')} className={`${btn} bg-gray-100`}>Close</button>
    </div>
  );
}

function RoomsEditor({ orgId, setup, canEdit, busy, run }: { orgId: string; setup: Setup; canEdit: boolean; busy: boolean; run: Run }) {
  const blankType = { name: '', description: '', capacity: 2, nightly_price: 0, active: true, sort: setup.types.length + 1 };
  const [editType, setEditType] = useState<{ id: string | null; t: typeof blankType } | null>(null);
  const [editRoom, setEditRoom] = useState<{ id: string | null; name: string; room_type_id: string; active: boolean } | null>(null);
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr>{['Room type', 'Guests', 'Per night incl. MVA', 'Rooms', 'Shown', ''].map(h => <th key={h} className="text-left p-3 text-xs text-gray-500">{h}</th>)}</tr></thead>
          <tbody>
            {setup.types.map((t: RoomType) => (
              <tr key={t.id} className="border-t">
                <td className="p-3">{t.name}</td><td className="p-3">{t.capacity}</td><td className="p-3">{formatNok(t.nightly_price)}</td>
                <td className="p-3">{setup.rooms.filter(r => r.room_type_id === t.id).map(r => (
                  <button key={r.id} disabled={!canEdit} onClick={() => setEditRoom({ id: r.id, name: r.name, room_type_id: r.room_type_id, active: r.active })}
                    className={`me-1 px-1.5 rounded border text-xs ${r.active ? '' : 'opacity-50'}`}>{r.name}</button>))}</td>
                <td className="p-3">{t.active ? 'Yes' : 'No'}</td>
                <td className="p-3">{canEdit && <button onClick={() => setEditType({ id: t.id, t: { ...blankType, ...t, description: t.description ?? '' } })} className="text-xs text-[#0B2E59]">Edit</button>}</td>
              </tr>
            ))}
            {setup.types.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-400">No room types yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {canEdit && <div className="flex gap-2">
        {!editType && <button onClick={() => setEditType({ id: null, t: blankType })} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">+ Room type</button>}
        {!editRoom && setup.types.length > 0 && <button onClick={() => setEditRoom({ id: null, name: '', room_type_id: setup.types[0].id, active: true })} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">+ Room</button>}
      </div>}
      {editType && (
        <div className="bg-white rounded-2xl border p-5 grid md:grid-cols-3 gap-3 text-sm">
          <label>Name<input className={input} value={editType.t.name} onChange={e => setEditType({ ...editType, t: { ...editType.t, name: e.target.value } })} /></label>
          <label>Guests (most)<input type="number" min={1} max={20} className={input} value={editType.t.capacity} onChange={e => setEditType({ ...editType, t: { ...editType.t, capacity: Number(e.target.value) } })} /></label>
          <label>Price per night incl. MVA<input type="number" step="any" className={input} value={editType.t.nightly_price} onChange={e => setEditType({ ...editType, t: { ...editType.t, nightly_price: Number(e.target.value) } })} /></label>
          <label className="md:col-span-2">Description<input className={input} value={editType.t.description} onChange={e => setEditType({ ...editType, t: { ...editType.t, description: e.target.value } })} /></label>
          <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={editType.t.active} onChange={e => setEditType({ ...editType, t: { ...editType.t, active: e.target.checked } })} /> Shown to guests</label>
          <div className="md:col-span-3 flex gap-2">
            <button disabled={busy} onClick={() => run(async () => { const e = await saveRoomType(orgId, editType.id, editType.t); if (!e) setEditType(null); return e; }, 'Room type saved.')} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">Save</button>
            <button onClick={() => setEditType(null)} className="px-4 py-2 rounded-xl bg-gray-100 text-sm">Cancel</button>
          </div>
        </div>
      )}
      {editRoom && (
        <div className="bg-white rounded-2xl border p-5 grid md:grid-cols-3 gap-3 text-sm">
          <label>Room (number or name)<input className={input} value={editRoom.name} onChange={e => setEditRoom({ ...editRoom, name: e.target.value })} /></label>
          <label>Type<select className={input} value={editRoom.room_type_id} onChange={e => setEditRoom({ ...editRoom, room_type_id: e.target.value })}>
            {setup.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={editRoom.active} onChange={e => setEditRoom({ ...editRoom, active: e.target.checked })} /> In use</label>
          <div className="md:col-span-3 flex gap-2">
            <button disabled={busy} onClick={() => run(async () => { const e = await saveRoom(orgId, editRoom.id, editRoom); if (!e) setEditRoom(null); return e; }, 'Room saved.')} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">Save</button>
            <button onClick={() => setEditRoom(null)} className="px-4 py-2 rounded-xl bg-gray-100 text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RulesEditor({ orgId, settings, canEdit, busy, run }: { orgId: string; settings: HotelSettings | null; canEdit: boolean; busy: boolean; run: Run }) {
  const [s, setS] = useState<HotelSettings>(settings ?? DEFAULT_HOTEL_SETTINGS);
  const num = (v: string) => Number(v);
  return (
    <div className="bg-white rounded-2xl border p-5 grid md:grid-cols-3 gap-3 text-sm max-w-3xl">
      <label>MVA rate for accommodation %<select className={input} value={s.vat_rate ?? ''} disabled={!canEdit} onChange={e => setS({ ...s, vat_rate: e.target.value === '' ? null : num(e.target.value) })}>
        <option value="">Choose (ask your accountant)</option>{[12, 15, 25, 0].map(r => <option key={r} value={r}>{r}</option>)}</select></label>
      <label>Check-in from<input type="time" className={input} value={s.check_in_from.slice(0, 5)} disabled={!canEdit} onChange={e => setS({ ...s, check_in_from: e.target.value })} /></label>
      <label>Check-out by<input type="time" className={input} value={s.check_out_by.slice(0, 5)} disabled={!canEdit} onChange={e => setS({ ...s, check_out_by: e.target.value })} /></label>
      <label>Bookable up to (days ahead)<input type="number" min={1} max={730} className={input} value={s.booking_window_days} disabled={!canEdit} onChange={e => setS({ ...s, booking_window_days: num(e.target.value) })} /></label>
      <label>Days' notice before arrival<input type="number" min={0} max={60} className={input} value={s.lead_days} disabled={!canEdit} onChange={e => setS({ ...s, lead_days: num(e.target.value) })} /></label>
      <span />
      <label>Fewest nights<input type="number" min={1} className={input} value={s.min_nights} disabled={!canEdit} onChange={e => setS({ ...s, min_nights: num(e.target.value) })} /></label>
      <label>Most nights online<input type="number" min={1} className={input} value={s.max_nights} disabled={!canEdit} onChange={e => setS({ ...s, max_nights: num(e.target.value) })} /></label>
      <span />
      <label>Free cancellation until (days before arrival)<input type="number" min={0} max={90} className={input} value={s.free_cancel_days} disabled={!canEdit} onChange={e => setS({ ...s, free_cancel_days: num(e.target.value) })} /></label>
      <label>Then a fee of (% of the stay; empty: none)<input type="number" min={1} max={100} className={input} value={s.late_cancel_fee_pct ?? ''} disabled={!canEdit} onChange={e => setS({ ...s, late_cancel_fee_pct: e.target.value === '' ? null : num(e.target.value) })} /></label>
      <p className="md:col-span-3 text-xs text-gray-500">The rule and price apply to stays booked after you saved them. State your cancellation and no-show rules in your terms. Your duties as an accommodation business (for example a guest register) stay yours: FlyttGo stores only what the booking needs.</p>
      {canEdit && <button disabled={busy} onClick={() => run(() => saveHotelSettings(orgId, s), 'Rules saved.')} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold w-fit">Save</button>}
    </div>
  );
}
