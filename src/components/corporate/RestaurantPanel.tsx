/**
 * Corporate dashboard → Restaurant (00019): the day's reservations by time
 * (book a phone guest, seat a walk-in, seat, done, no-show, cancel, invoice
 * the no-show fee), the tables and the combinations allowed, the service
 * periods and closed dates, and the booking rules with turn times. Floor
 * staff seat guests and take walk-ins. The database checks every step and
 * never gives a table twice.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Membership } from '../../lib/organizations';
import { formatNok } from '../../lib/invoicing';
import { WEEKDAYS, addDays, osloInstant, osloTime, osloToday } from '../../lib/services';
import {
  DEFAULT_RESTAURANT_SETTINGS, TABLE_STATUS, addClosedDate, cancelReservation, closeReservation, createTableReservation,
  freeTableTimes, invoiceNoShow, loadRestaurantSetup, loadTableReservations, removeClosedDate, saveRestaurantPeriods,
  saveRestaurantSettings, saveRestaurantTable, saveTableGroup, seatReservation,
  type FreeTime, type RestaurantSettings, type RestaurantTable, type TableGroup, type TableReservation, type TurnTime,
} from '../../lib/reservations';

const input = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm';
const btn = 'px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50';
type Setup = Awaited<ReturnType<typeof loadRestaurantSetup>>;
type Run = (f: () => Promise<string | null>, ok: string) => void;

export default function RestaurantPanel({ membership }: { membership: Membership }) {
  const org = membership.organization;
  const role = membership.role;
  const manage = role === 'owner' || role === 'admin';
  const book = manage || role === 'booker' || role === 'staff';
  const cancel = manage || role === 'booker';
  const [view, setView] = useState<'day' | 'tables' | 'periods' | 'rules'>('day');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [day, setDay] = useState(osloToday());
  const [list, setList] = useState<TableReservation[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [s, r] = await Promise.all([loadRestaurantSetup(org.id),
      loadTableReservations({ orgId: org.id, from: osloInstant(day, '00:00'), to: osloInstant(addDays(day, 1), '00:00') })]);
    setSetup(s); setList(r);
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
  const tableNames = (r: TableReservation) => (r.restaurant_reservation_tables ?? [])
    .map(x => setup.tables.find(t => t.id === x.table_id)?.name ?? '').filter(Boolean).join('+');
  const guests = list.filter(r => r.status !== 'cancelled').reduce((n, r) => n + r.party_size, 0);

  return (
    <div className="space-y-5 max-w-6xl">
      {msg && <div className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
      {!setup.settings && <div className="rounded-xl px-4 py-3 text-sm bg-amber-50 text-amber-800">Save your booking rules under Booking rules before guests can book.</div>}
      <div className="flex gap-2 flex-wrap">
        {(['day', 'tables', 'periods', 'rules'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-full text-xs font-medium ${view === v ? 'bg-gray-900 text-white' : 'bg-white border'}`}>
            {{ day: 'Reservations', tables: `Tables (${setup.tables.length})`, periods: 'Opening and closed dates', rules: 'Booking rules' }[v]}
          </button>
        ))}
      </div>

      {view === 'day' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setDay(addDays(day, -1))} className={`${btn} bg-gray-100`}>‹</button>
            <input type="date" value={day} onChange={e => setDay(e.target.value)} className="border rounded-lg px-2 py-1 text-sm" />
            <button onClick={() => setDay(addDays(day, 1))} className={`${btn} bg-gray-100`}>›</button>
            <button onClick={() => setDay(osloToday())} className={`${btn} bg-gray-100`}>Today</button>
            <span className="text-xs text-gray-500">{guests} guests</span>
            {book && setup.tables.length > 0 && <CompanyBooking orgId={org.id} tables={setup.tables} day={day} busy={busy} run={run} />}
          </div>
          <div className="bg-white rounded-2xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr>{['Time', 'Guests', 'Name', 'Table', 'Notes', 'Status', ''].map(h => <th key={h} className="text-left p-3 text-xs text-gray-500">{h}</th>)}</tr></thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id} className={`border-t ${r.status === 'cancelled' ? 'opacity-50' : ''}`}>
                    <td className="p-3 whitespace-nowrap">{osloTime(r.starts_at)}–{osloTime(r.ends_at)}{r.period ? <div className="text-xs text-gray-400">{r.period}</div> : null}</td>
                    <td className="p-3">{r.party_size}</td>
                    <td className="p-3">{r.customer.name}<div className="text-xs text-gray-500">{r.customer.phone ?? ''}{r.source !== 'online' ? ` · ${r.source === 'walk_in' ? 'walk-in' : 'phone'}` : ''}</div></td>
                    <td className="p-3">{tableNames(r)}</td>
                    <td className="p-3 text-xs text-gray-600 max-w-[16rem]">{r.notes}</td>
                    <td className="p-3 text-xs">{TABLE_STATUS[r.status]}{r.no_show_fee ? <div className="text-gray-400">no-show fee {formatNok(r.no_show_fee)}</div> : null}</td>
                    <td className="p-3"><div className="flex gap-1 flex-wrap">
                      {r.status === 'booked' && book && <SeatButton r={r} tables={setup.tables} busy={busy} run={run} />}
                      {r.status === 'seated' && book && <button disabled={busy} onClick={() => run(() => closeReservation(r.id, 'completed'), 'Completed: the table is free.')} className={`${btn} bg-emerald-600 text-white`}>Done</button>}
                      {r.status === 'booked' && book && new Date(r.starts_at) <= new Date() &&
                        <button disabled={busy} onClick={() => run(() => closeReservation(r.id, 'no_show'), 'Marked no-show.')} className={`${btn} bg-orange-500 text-white`}>No-show</button>}
                      {r.status === 'booked' && cancel && <button disabled={busy} onClick={() => { const why = prompt('Reason for cancelling'); if (why !== null) run(() => cancelReservation(r.id, why), 'Cancelled.'); }} className={`${btn} bg-gray-100`}>Cancel</button>}
                      {r.status === 'no_show' && !r.invoice_id && (r.no_show_fee ?? 0) > 0 && ['owner', 'admin', 'finance'].includes(role) &&
                        <button disabled={busy} onClick={() => run(() => invoiceNoShow(r.id), 'No-show fee invoiced in your company\'s name.')} className={`${btn} bg-gray-100`}>Invoice fee</button>}
                      {r.invoice_id && <span className="text-xs text-gray-400">invoiced</span>}
                    </div></td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-gray-400">No reservations this day.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'tables' && <TablesEditor orgId={org.id} tables={setup.tables} groups={setup.groups} canEdit={manage} busy={busy} run={run} />}
      {view === 'periods' && <PeriodsEditor orgId={org.id} setup={setup} canEdit={manage} canClose={cancel} busy={busy} run={run} />}
      {view === 'rules' && <RulesEditor orgId={org.id} settings={setup.settings} turns={setup.turns} canEdit={manage} busy={busy} run={run} />}
    </div>
  );
}

/** A phone guest at a free time (or any time on named tables), or a walk-in now. */
function CompanyBooking({ orgId, tables, day, busy, run }: { orgId: string; tables: RestaurantTable[]; day: string; busy: boolean; run: Run }) {
  const [open, setOpen] = useState<'phone' | 'walk_in' | null>(null);
  const [party, setParty] = useState(2);
  const [times, setTimes] = useState<FreeTime[]>([]);
  const [time, setTime] = useState('');
  const [own, setOwn] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => { if (open === 'phone') freeTableTimes(orgId, day, party).then(setTimes); }, [open, orgId, day, party]);
  if (!open) return (
    <div className="ms-auto flex gap-2">
      <button onClick={() => setOpen('phone')} className={`${btn} bg-[#0B2E59] text-white`}>+ Phone booking</button>
      <button onClick={() => setOpen('walk_in')} className={`${btn} bg-[#0B2E59] text-white`}>+ Walk-in</button>
    </div>
  );
  const start = open === 'walk_in' ? null : own ? osloInstant(day, own) : time;
  return (
    <div className="w-full bg-white border rounded-xl p-3 flex flex-wrap gap-2 items-end">
      <label className="text-xs">Guests<input type="number" min={1} max={100} className={input} value={party} onChange={e => setParty(Number(e.target.value))} /></label>
      {open === 'phone' && <>
        <label className="text-xs">Free time<select className={input} value={time} onChange={e => { setTime(e.target.value); setOwn(''); }}>
          <option value="">Choose</option>{times.map(t => <option key={t.starts_at} value={t.starts_at}>{osloTime(t.starts_at)} {t.period ?? ''}</option>)}</select></label>
        <label className="text-xs">or a time<input type="time" className={input} value={own} onChange={e => setOwn(e.target.value)} /></label>
      </>}
      <label className="text-xs">Tables (optional)<select multiple className={`${input} h-16`} value={chosen}
        onChange={e => setChosen(Array.from(e.target.selectedOptions).map(o => o.value))}>
        {tables.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name} ({t.seats})</option>)}</select></label>
      <label className="text-xs">Name<input className={input} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="text-xs">Phone<input className={input} value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <label className="text-xs">Notes<input className={input} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <button disabled={busy || !name || (open === 'phone' && (!start || !phone))} onClick={() =>
        run(async () => {
          const e = await createTableReservation(orgId, start, party, { name, phone }, notes, open, chosen);
          if (!e) setOpen(null);
          return e;
        }, open === 'walk_in' ? 'Seated.' : 'Booked.')} className={`${btn} bg-[#0B2E59] text-white`}>{open === 'walk_in' ? 'Seat now' : 'Book'}</button>
      <button onClick={() => setOpen(null)} className={`${btn} bg-gray-100`}>Close</button>
    </div>
  );
}

function SeatButton({ r, tables, busy, run }: { r: TableReservation; tables: RestaurantTable[]; busy: boolean; run: Run }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  if (!open) return <button disabled={busy} onClick={() => setOpen(true)} className={`${btn} bg-emerald-600 text-white`}>Seat</button>;
  return (
    <span className="flex gap-1 items-center">
      <select multiple className="border rounded text-xs h-14" value={chosen} onChange={e => setChosen(Array.from(e.target.selectedOptions).map(o => o.value))}>
        {tables.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name} ({t.seats})</option>)}</select>
      <button disabled={busy} onClick={() => run(() => seatReservation(r.id, chosen), 'Seated.')} className={`${btn} bg-emerald-600 text-white`}>
        {chosen.length ? 'Seat there' : 'Seat as booked'}</button>
      <button onClick={() => setOpen(false)} className={`${btn} bg-gray-100`}>×</button>
    </span>
  );
}

function TablesEditor({ orgId, tables, groups, canEdit, busy, run }: { orgId: string; tables: RestaurantTable[]; groups: TableGroup[]; canEdit: boolean; busy: boolean; run: Run }) {
  const blank = { name: '', area: '', seats: 2, min_seats: 1, combinable: false, active: true, sort: tables.length + 1 };
  const [edit, setEdit] = useState<{ id: string | null; t: typeof blank } | null>(null);
  const [group, setGroup] = useState<{ id: string | null; name: string; min_seats: number; active: boolean; table_ids: string[] } | null>(null);
  const name = (id: string) => tables.find(t => t.id === id)?.name ?? '';
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr>{['Table', 'Area', 'Seats', 'Online from', 'Combinable', 'In use', ''].map(h => <th key={h} className="text-left p-3 text-xs text-gray-500">{h}</th>)}</tr></thead>
          <tbody>
            {tables.map(t => (
              <tr key={t.id} className="border-t">
                <td className="p-3">{t.name}</td><td className="p-3">{t.area ?? ''}</td><td className="p-3">{t.seats}</td>
                <td className="p-3">{t.min_seats} {t.min_seats === 1 ? 'guest' : 'guests'}</td><td className="p-3">{t.combinable ? 'Yes' : 'No'}</td>
                <td className="p-3">{t.active ? 'Yes' : 'No'}</td>
                <td className="p-3">{canEdit && <button onClick={() => setEdit({ id: t.id, t: { ...blank, ...t, area: t.area ?? '' } })} className="text-xs text-[#0B2E59]">Edit</button>}</td>
              </tr>
            ))}
            {tables.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-gray-400">No tables yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {canEdit && !edit && <button onClick={() => setEdit({ id: null, t: blank })} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">+ Table</button>}
      {edit && (
        <div className="bg-white rounded-2xl border p-5 grid md:grid-cols-3 gap-3 text-sm">
          <label>Name<input className={input} value={edit.t.name} onChange={e => setEdit({ ...edit, t: { ...edit.t, name: e.target.value } })} /></label>
          <label>Area (optional)<input className={input} value={edit.t.area} onChange={e => setEdit({ ...edit, t: { ...edit.t, area: e.target.value } })} /></label>
          <label>Seats<input type="number" min={1} max={50} className={input} value={edit.t.seats} onChange={e => setEdit({ ...edit, t: { ...edit.t, seats: Number(e.target.value) } })} /></label>
          <label>Smallest party online<input type="number" min={1} max={edit.t.seats} className={input} value={edit.t.min_seats} onChange={e => setEdit({ ...edit, t: { ...edit.t, min_seats: Number(e.target.value) } })} /></label>
          <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={edit.t.combinable} onChange={e => setEdit({ ...edit, t: { ...edit.t, combinable: e.target.checked } })} /> Can be combined</label>
          <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={edit.t.active} onChange={e => setEdit({ ...edit, t: { ...edit.t, active: e.target.checked } })} /> In use</label>
          <div className="md:col-span-3 flex gap-2">
            <button disabled={busy} onClick={() => run(async () => { const e = await saveRestaurantTable(orgId, edit.id, edit.t); if (!e) setEdit(null); return e; }, 'Table saved.')} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">Save</button>
            <button onClick={() => setEdit(null)} className="px-4 py-2 rounded-xl bg-gray-100 text-sm">Cancel</button>
          </div>
        </div>
      )}

      <h3 className="font-semibold text-sm pt-2">Combinations</h3>
      <p className="text-sm text-gray-500">Tables you push together for larger parties. Only combinable tables; a party gets a combination when no single table fits.</p>
      <div className="grid md:grid-cols-2 gap-3">
        {groups.map(g => (
          <div key={g.id} className="bg-white rounded-2xl border p-4 text-sm flex justify-between">
            <div><div className="font-semibold">{g.name}{g.active ? '' : ' (not in use)'}</div>
              <div className="text-xs text-gray-500">{g.restaurant_table_group_members.map(m => name(m.table_id)).join(' + ')} · from {g.min_seats} guests ·{' '}
                {g.restaurant_table_group_members.reduce((n, m) => n + (tables.find(t => t.id === m.table_id)?.seats ?? 0), 0)} seats</div></div>
            {canEdit && <button onClick={() => setGroup({ id: g.id, name: g.name, min_seats: g.min_seats, active: g.active, table_ids: g.restaurant_table_group_members.map(m => m.table_id) })} className="text-xs text-[#0B2E59]">Edit</button>}
          </div>
        ))}
      </div>
      {canEdit && !group && <button onClick={() => setGroup({ id: null, name: '', min_seats: 1, active: true, table_ids: [] })} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">+ Combination</button>}
      {group && (
        <div className="bg-white rounded-2xl border p-5 space-y-3 text-sm">
          <div className="grid md:grid-cols-2 gap-3">
            <label>Name<input className={input} value={group.name} onChange={e => setGroup({ ...group, name: e.target.value })} /></label>
            <label>Smallest party<input type="number" min={1} className={input} value={group.min_seats} onChange={e => setGroup({ ...group, min_seats: Number(e.target.value) })} /></label>
          </div>
          <div className="flex flex-wrap gap-3">{tables.filter(t => t.combinable).map(t => (
            <label key={t.id} className="flex items-center gap-1"><input type="checkbox" checked={group.table_ids.includes(t.id)}
              onChange={e => setGroup({ ...group, table_ids: e.target.checked ? [...group.table_ids, t.id] : group.table_ids.filter(x => x !== t.id) })} />{t.name} ({t.seats})</label>))}
            {tables.filter(t => t.combinable).length === 0 && <span className="text-gray-500">Mark tables as combinable first.</span>}</div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={group.active} onChange={e => setGroup({ ...group, active: e.target.checked })} /> In use</label>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => run(async () => { const e = await saveTableGroup(orgId, group.id, group); if (!e) setGroup(null); return e; }, 'Combination saved.')} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">Save</button>
            <button onClick={() => setGroup(null)} className="px-4 py-2 rounded-xl bg-gray-100 text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PeriodsEditor({ orgId, setup, canEdit, canClose, busy, run }: { orgId: string; setup: Setup; canEdit: boolean; canClose: boolean; busy: boolean; run: Run }) {
  type P = { weekday: number; name: string; start: string; end: string; last_seating: string | null };
  const [periods, setPeriods] = useState<P[]>(() => setup.periods.map(p => ({ weekday: p.weekday, name: p.name, start: p.start_time.slice(0, 5),
    end: p.end_time.slice(0, 5), last_seating: p.last_seating ? p.last_seating.slice(0, 5) : null })));
  const [closeDay, setCloseDay] = useState('');
  const set = (i: number, p: Partial<P>) => setPeriods(periods.map((x, j) => j === i ? { ...x, ...p } : x));
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border p-5 text-sm space-y-2">
        <p className="text-gray-500">Service periods each weekday (local time). Without a last seating, the last table is given a turn before the end.</p>
        {WEEKDAYS.map((d, wd) => (
          <div key={d} className="flex flex-wrap items-center gap-2">
            <span className="w-10 font-medium">{d}</span>
            {periods.map((p, i) => p.weekday !== wd + 1 ? null : (
              <span key={i} className="flex items-center gap-1 border rounded-lg px-2 py-1">
                <input className="w-20 border rounded px-1" value={p.name} disabled={!canEdit} onChange={e => set(i, { name: e.target.value })} />
                <input type="time" value={p.start} disabled={!canEdit} className="border rounded px-1" onChange={e => set(i, { start: e.target.value })} />–
                <input type="time" value={p.end} disabled={!canEdit} className="border rounded px-1" onChange={e => set(i, { end: e.target.value })} />
                <span className="text-xs text-gray-500">last</span>
                <input type="time" value={p.last_seating ?? ''} disabled={!canEdit} className="border rounded px-1" onChange={e => set(i, { last_seating: e.target.value || null })} />
                {canEdit && <button onClick={() => setPeriods(periods.filter((_, j) => j !== i))} className="text-xs text-red-600">×</button>}
              </span>
            ))}
            {canEdit && <button onClick={() => setPeriods([...periods, { weekday: wd + 1, name: 'Dinner', start: '17:00', end: '22:00', last_seating: null }])} className="text-xs text-[#0B2E59]">+ period</button>}
          </div>
        ))}
        {canEdit && <button disabled={busy} onClick={() => run(() => saveRestaurantPeriods(orgId, periods), 'Opening saved.')} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">Save</button>}
      </div>
      <div className="bg-white rounded-2xl border p-5 text-sm space-y-2">
        <div className="font-semibold">Closed dates</div>
        {setup.closed.map(c => (
          <div key={c.id} className="flex items-center gap-2">{c.day}{c.reason ? ` · ${c.reason}` : ''}
            {canClose && <button disabled={busy} onClick={() => run(() => removeClosedDate(c.id), 'Open again.')} className="text-xs text-red-600">Remove</button>}</div>
        ))}
        {setup.closed.length === 0 && <p className="text-gray-400">None.</p>}
        {canClose && <div className="flex gap-2 items-center"><input type="date" min={osloToday()} value={closeDay} onChange={e => setCloseDay(e.target.value)} className="border rounded-lg px-2 py-1" />
          <button disabled={busy || !closeDay} onClick={() => run(() => addClosedDate(orgId, closeDay, prompt('Reason (optional)') ?? ''), 'Closed that day.')} className={`${btn} bg-gray-100`}>Close that day</button></div>}
      </div>
    </div>
  );
}

function RulesEditor({ orgId, settings, turns, canEdit, busy, run }: { orgId: string; settings: RestaurantSettings | null; turns: TurnTime[]; canEdit: boolean; busy: boolean; run: Run }) {
  const [s, setS] = useState<RestaurantSettings>(settings ?? DEFAULT_RESTAURANT_SETTINGS);
  const [t, setT] = useState<TurnTime[]>(turns.length ? turns : [{ up_to_party: 2, minutes: 90 }, { up_to_party: 4, minutes: 120 }]);
  const num = (v: string) => Number(v);
  return (
    <div className="bg-white rounded-2xl border p-5 grid md:grid-cols-3 gap-3 text-sm max-w-3xl">
      <label>Times offered every (minutes)<select className={input} value={s.slot_step_minutes} disabled={!canEdit} onChange={e => setS({ ...s, slot_step_minutes: num(e.target.value) })}>{[10, 15, 20, 30, 60].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      <label>Bookable up to (days ahead)<input type="number" min={1} max={365} className={input} value={s.booking_window_days} disabled={!canEdit} onChange={e => setS({ ...s, booking_window_days: num(e.target.value) })} /></label>
      <label>Minimum notice (minutes)<input type="number" min={0} className={input} value={s.lead_time_minutes} disabled={!canEdit} onChange={e => setS({ ...s, lead_time_minutes: num(e.target.value) })} /></label>
      <label>Largest party online<input type="number" min={1} max={100} className={input} value={s.max_party_online} disabled={!canEdit} onChange={e => setS({ ...s, max_party_online: num(e.target.value) })} /></label>
      <label>Guests cancel online up to (hours before)<input type="number" min={0} max={168} className={input} value={s.cancel_hours} disabled={!canEdit} onChange={e => setS({ ...s, cancel_hours: num(e.target.value) })} /></label>
      <label>Table kept, larger parties (minutes)<input type="number" min={15} max={480} className={input} value={s.default_turn_minutes} disabled={!canEdit} onChange={e => setS({ ...s, default_turn_minutes: num(e.target.value) })} /></label>
      <div className="md:col-span-3">
        <div className="text-xs text-gray-500 mb-1">Table kept by party size</div>
        {t.map((x, i) => (
          <div key={i} className="flex items-center gap-2 mb-1">up to <input type="number" min={1} className="w-16 border rounded px-2 py-1" value={x.up_to_party} disabled={!canEdit}
            onChange={e => setT(t.map((y, j) => j === i ? { ...y, up_to_party: num(e.target.value) } : y))} /> guests:
            <input type="number" min={15} className="w-20 border rounded px-2 py-1" value={x.minutes} disabled={!canEdit}
              onChange={e => setT(t.map((y, j) => j === i ? { ...y, minutes: num(e.target.value) } : y))} /> minutes
            {canEdit && <button onClick={() => setT(t.filter((_, j) => j !== i))} className="text-xs text-red-600">×</button>}</div>
        ))}
        {canEdit && <button onClick={() => setT([...t, { up_to_party: (t[t.length - 1]?.up_to_party ?? 0) + 2, minutes: 150 }])} className="text-xs text-[#0B2E59]">+ size</button>}
      </div>
      <label>No-show fee incl. MVA (empty: none)<input type="number" min={0} className={input} value={s.no_show_fee ?? ''} disabled={!canEdit} onChange={e => setS({ ...s, no_show_fee: e.target.value === '' ? null : num(e.target.value) })} /></label>
      <label>Charged<select className={input} value={s.no_show_fee_per} disabled={!canEdit} onChange={e => setS({ ...s, no_show_fee_per: e.target.value as 'guest' | 'booking' })}>
        <option value="guest">per guest</option><option value="booking">per booking</option></select></label>
      <label>MVA on the fee %<select className={input} value={s.no_show_vat_rate ?? ''} disabled={!canEdit} onChange={e => setS({ ...s, no_show_vat_rate: e.target.value === '' ? null : num(e.target.value) })}>
        <option value="">Choose (ask your accountant)</option>{[25, 15, 12, 0].map(r => <option key={r} value={r}>{r}</option>)}</select></label>
      <p className="md:col-span-3 text-xs text-gray-500">A fee applies only to bookings made after you saved it. State your cancellation rule and any no-show fee in your terms: guests must know them before they book.</p>
      {canEdit && <button disabled={busy} onClick={() => run(() => saveRestaurantSettings(orgId, { ...s, turn_times: t }), 'Rules saved.')} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold w-fit">Save</button>}
    </div>
  );
}
