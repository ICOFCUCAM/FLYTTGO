/**
 * Corporate dashboard → Appointments (00013): the day's calendar per staff
 * member (book a phone customer, complete, no-show, cancel, invoice), the
 * services, the staff with their services and hours, and the booking rules.
 * Staff see their own calendar. The database checks every step.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Membership } from '../../lib/organizations';
import { formatNok } from '../../lib/invoicing';
import {
  APPOINTMENT_STATUS, WEEKDAYS, addDays, addTimeOff, cancelAppointment, closeAppointment, createAppointment, freeSlots,
  invoiceAppointment, loadAppointmentSetup, loadAppointments, loadMembers, memberName, osloInstant, osloTime, osloToday,
  saveAppointmentService, saveAppointmentSettings, saveResource,
  type Appointment, type AppointmentService, type AppointmentSettings, type Hours, type Member, type Resource,
} from '../../lib/services';

const input = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm';
const btn = 'px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50';
type Setup = Awaited<ReturnType<typeof loadAppointmentSetup>>;

export default function AppointmentsPanel({ membership }: { membership: Membership }) {
  const org = membership.organization;
  const role = membership.role;
  const manage = role === 'owner' || role === 'admin';
  const book = manage || role === 'booker';
  const [view, setView] = useState<'calendar' | 'services' | 'staff' | 'rules'>('calendar');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [day, setDay] = useState(osloToday());
  const [list, setList] = useState<Appointment[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [s, m, a] = await Promise.all([loadAppointmentSetup(org.id), loadMembers(org.id),
      loadAppointments({ orgId: org.id, from: osloInstant(day, '00:00'), to: osloInstant(addDays(day, 1), '00:00') })]);
    setSetup(s); setMembers(m); setList(a);
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
  const svcName = (id: string) => setup.services.find(s => s.id === id)?.name ?? '';

  return (
    <div className="space-y-5 max-w-6xl">
      {msg && <div className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
      <div className="flex gap-2 flex-wrap">
        {(['calendar', 'services', 'staff', 'rules'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-full text-xs font-medium ${view === v ? 'bg-gray-900 text-white' : 'bg-white border'}`}>
            {{ calendar: 'Calendar', services: `Services (${setup.services.length})`, staff: `Staff and hours (${setup.resources.length})`, rules: 'Booking rules' }[v]}
          </button>
        ))}
      </div>

      {view === 'calendar' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setDay(addDays(day, -1))} className={`${btn} bg-gray-100`}>‹</button>
            <input type="date" value={day} onChange={e => setDay(e.target.value)} className="border rounded-lg px-2 py-1 text-sm" />
            <button onClick={() => setDay(addDays(day, 1))} className={`${btn} bg-gray-100`}>›</button>
            <button onClick={() => setDay(osloToday())} className={`${btn} bg-gray-100`}>Today</button>
            {book && setup.services.length > 0 && <PhoneBooking orgId={org.id} setup={setup} day={day} busy={busy} run={run} />}
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {setup.resources.filter(r => r.active).map(r => (
              <div key={r.id} className="bg-white rounded-2xl border">
                <div className="px-4 py-2 border-b font-semibold text-sm">{r.name}</div>
                {list.filter(a => a.resource_id === r.id).map(a => (
                  <div key={a.id} className={`px-4 py-2 border-b text-sm ${a.status === 'cancelled' ? 'opacity-50' : ''}`}>
                    <div className="flex justify-between"><span className="font-medium">{osloTime(a.starts_at)}–{osloTime(a.ends_at)} {svcName(a.service_id)}</span>
                      <span className="text-xs text-gray-500">{APPOINTMENT_STATUS[a.status]}</span></div>
                    <div className="text-xs text-gray-500">{a.customer.name} · {a.customer.phone}{a.notes ? ` · ${a.notes}` : ''}</div>
                    <div className="flex gap-1 mt-1">
                      {a.status === 'booked' && new Date(a.starts_at) <= new Date() && <>
                        <button disabled={busy} onClick={() => run(() => closeAppointment(a.id, 'completed'), 'Completed.')} className={`${btn} bg-emerald-600 text-white`}>Done</button>
                        <button disabled={busy} onClick={() => run(() => closeAppointment(a.id, 'no_show'), 'Marked no-show.')} className={`${btn} bg-orange-500 text-white`}>No-show</button>
                      </>}
                      {a.status === 'booked' && book && <button disabled={busy} onClick={() => { const why = prompt('Reason for cancelling'); if (why !== null) run(() => cancelAppointment(a.id, why), 'Cancelled.'); }} className={`${btn} bg-gray-100`}>Cancel</button>}
                      {['completed', 'no_show'].includes(a.status) && !a.invoice_id && ['owner', 'admin', 'finance'].includes(role) &&
                        <button disabled={busy} onClick={() => run(() => invoiceAppointment(a.id), 'Invoiced in your company\'s name.')} className={`${btn} bg-gray-100`}>Invoice</button>}
                      {a.invoice_id && <span className="text-xs text-gray-400">invoiced</span>}
                    </div>
                  </div>
                ))}
                {list.filter(a => a.resource_id === r.id).length === 0 && <p className="px-4 py-3 text-xs text-gray-400">Nothing booked.</p>}
                <TimeOffButton resource={r} busy={busy} run={run} />
              </div>
            ))}
            {setup.resources.length === 0 && <p className="text-sm text-gray-500">Add your staff (or rooms) and their hours under Staff and hours.</p>}
          </div>
        </div>
      )}

      {view === 'services' && <ServiceEditor orgId={org.id} services={setup.services} canEdit={manage} busy={busy} run={run} />}
      {view === 'staff' && <StaffEditor orgId={org.id} setup={setup} members={members} canEdit={manage} busy={busy} run={run} />}
      {view === 'rules' && <RulesEditor orgId={org.id} settings={setup.settings} canEdit={manage} busy={busy} run={run} />}
    </div>
  );
}

type Run = (f: () => Promise<string | null>, ok: string) => void;

function PhoneBooking({ orgId, setup, day, busy, run }: { orgId: string; setup: Setup; day: string; busy: boolean; run: Run }) {
  const [open, setOpen] = useState(false);
  const [service, setService] = useState(setup.services[0]?.id ?? '');
  const [resource, setResource] = useState('');
  const [slots, setSlots] = useState<{ resource_id: string; resource_name: string; starts_at: string }[]>([]);
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  useEffect(() => { if (open && service) freeSlots(orgId, service, day, resource || null).then(setSlots); }, [open, service, resource, day, orgId]);
  if (!open) return <button onClick={() => setOpen(true)} className={`${btn} bg-[#0B2E59] text-white ms-auto`}>+ Book for a customer</button>;
  return (
    <div className="w-full bg-white border rounded-xl p-3 flex flex-wrap gap-2 items-end">
      <label className="text-xs">Service<select className={input} value={service} onChange={e => setService(e.target.value)}>{setup.services.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="text-xs">Staff<select className={input} value={resource} onChange={e => setResource(e.target.value)}><option value="">Anyone</option>{setup.resources.filter(r => r.active).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label className="text-xs">Free time<select className={input} value={time} onChange={e => setTime(e.target.value)}><option value="">Choose</option>{slots.map(s => <option key={s.resource_id + s.starts_at} value={`${s.resource_id}|${s.starts_at}`}>{osloTime(s.starts_at)} {s.resource_name}</option>)}</select></label>
      <label className="text-xs">Name<input className={input} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="text-xs">Phone<input className={input} value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <button disabled={busy || !time || !name || !phone} onClick={() => {
        const [rid, start] = time.split('|');
        run(async () => { const e = await createAppointment(orgId, service, rid, start, { name, phone }, ''); if (!e) setOpen(false); return e; }, 'Booked.');
      }} className={`${btn} bg-[#0B2E59] text-white`}>Book</button>
      <button onClick={() => setOpen(false)} className={`${btn} bg-gray-100`}>Close</button>
    </div>
  );
}

function TimeOffButton({ resource, busy, run }: { resource: Resource; busy: boolean; run: Run }) {
  return (
    <div className="px-4 py-2">
      <button disabled={busy} onClick={() => {
        const from = prompt('Time off from (YYYY-MM-DD HH:MM)'); if (!from) return;
        const to = prompt('Until (YYYY-MM-DD HH:MM)'); if (!to) return;
        const [fd, ft] = from.trim().split(/\s+/); const [td, tt] = to.trim().split(/\s+/);
        run(() => addTimeOff(resource.id, osloInstant(fd, ft ?? '00:00'), osloInstant(td, tt ?? '23:59'), prompt('Reason (optional)') ?? ''), 'Time off added.');
      }} className="text-xs text-[#0B2E59]">+ Time off</button>
    </div>
  );
}

function ServiceEditor({ orgId, services, canEdit, busy, run }: { orgId: string; services: AppointmentService[]; canEdit: boolean; busy: boolean; run: Run }) {
  const blank = { name: '', description: '', duration_minutes: 30, buffer_minutes: 0, price: 0, vat_rate: 25, active: true, sort: services.length + 1 };
  const [edit, setEdit] = useState<{ id: string | null; s: typeof blank } | null>(null);
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr>{['Service', 'Duration', 'Buffer', 'Price incl. MVA', 'Shown', ''].map(h => <th key={h} className="text-left p-3 text-xs text-gray-500">{h}</th>)}</tr></thead>
          <tbody>
            {services.map(s => (
              <tr key={s.id} className="border-t">
                <td className="p-3">{s.name}</td><td className="p-3">{s.duration_minutes} min</td><td className="p-3">{s.buffer_minutes} min</td>
                <td className="p-3">{formatNok(s.price)}</td><td className="p-3">{s.active ? 'Yes' : 'No'}</td>
                <td className="p-3">{canEdit && <button onClick={() => setEdit({ id: s.id, s: { ...blank, ...s, description: s.description ?? '' } })} className="text-xs text-[#0B2E59]">Edit</button>}</td>
              </tr>
            ))}
            {services.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-400">No services yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {canEdit && !edit && <button onClick={() => setEdit({ id: null, s: blank })} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">+ Service</button>}
      {edit && (
        <div className="bg-white rounded-2xl border p-5 grid md:grid-cols-3 gap-3 text-sm">
          <label>Name<input className={input} value={edit.s.name} onChange={e => setEdit({ ...edit, s: { ...edit.s, name: e.target.value } })} /></label>
          <label>Duration (minutes)<input type="number" min={5} max={480} className={input} value={edit.s.duration_minutes} onChange={e => setEdit({ ...edit, s: { ...edit.s, duration_minutes: Number(e.target.value) } })} /></label>
          <label>Buffer after (minutes)<input type="number" min={0} max={120} className={input} value={edit.s.buffer_minutes} onChange={e => setEdit({ ...edit, s: { ...edit.s, buffer_minutes: Number(e.target.value) } })} /></label>
          <label>Price incl. MVA<input type="number" step="any" className={input} value={edit.s.price} onChange={e => setEdit({ ...edit, s: { ...edit.s, price: Number(e.target.value) } })} /></label>
          <label>MVA %<select className={input} value={edit.s.vat_rate} onChange={e => setEdit({ ...edit, s: { ...edit.s, vat_rate: Number(e.target.value) } })}>{[25, 15, 12, 0].map(r => <option key={r} value={r}>{r}</option>)}</select></label>
          <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={edit.s.active} onChange={e => setEdit({ ...edit, s: { ...edit.s, active: e.target.checked } })} /> Shown to customers</label>
          <div className="md:col-span-3 flex gap-2">
            <button disabled={busy} onClick={() => run(async () => { const e = await saveAppointmentService(orgId, edit.id, edit.s); if (!e) setEdit(null); return e; }, 'Service saved.')} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">Save</button>
            <button onClick={() => setEdit(null)} className="px-4 py-2 rounded-xl bg-gray-100 text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function StaffEditor({ orgId, setup, members, canEdit, busy, run }: { orgId: string; setup: Setup; members: Member[]; canEdit: boolean; busy: boolean; run: Run }) {
  type Edit = { id: string | null; name: string; user_id: string; active: boolean; service_ids: string[]; hours: { weekday: number; start: string; end: string }[] };
  const [edit, setEdit] = useState<Edit | null>(null);
  const hoursOf = (rid: string) => setup.hours.filter((h: Hours) => h.resource_id === rid)
    .map(h => ({ weekday: h.weekday, start: h.start_time.slice(0, 5), end: h.end_time.slice(0, 5) }));
  const startEdit = (r?: Resource) => setEdit(r
    ? { id: r.id, name: r.name, user_id: r.user_id ?? '', active: r.active, service_ids: setup.links.filter(l => l.resource_id === r.id).map(l => l.service_id), hours: hoursOf(r.id) }
    : { id: null, name: '', user_id: '', active: true, service_ids: setup.services.map(s => s.id),
        hours: [1, 2, 3, 4, 5].map(d => ({ weekday: d, start: '09:00', end: '17:00' })) });
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">Each person (or room) offers some services in weekly hours. Link a member with the role Staff so they see their own calendar.</p>
      <div className="grid md:grid-cols-2 gap-3">
        {setup.resources.map(r => (
          <div key={r.id} className="bg-white rounded-2xl border p-4 text-sm">
            <div className="flex justify-between"><span className="font-semibold">{r.name}{r.active ? '' : ' (hidden)'}</span>{canEdit && <button onClick={() => startEdit(r)} className="text-xs text-[#0B2E59]">Edit</button>}</div>
            <div className="text-xs text-gray-500">{r.user_id ? memberName(members.find(m => m.user_id === r.user_id)) : 'No member linked'}</div>
            <div className="text-xs mt-1">{hoursOf(r.id).sort((a, b) => a.weekday - b.weekday).map(h => `${WEEKDAYS[h.weekday - 1]} ${h.start}–${h.end}`).join(' · ') || 'No hours'}</div>
          </div>
        ))}
      </div>
      {canEdit && !edit && <button onClick={() => startEdit()} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">+ Staff member or room</button>}
      {edit && (
        <div className="bg-white rounded-2xl border p-5 space-y-3 text-sm">
          <div className="grid md:grid-cols-2 gap-3">
            <label>Name<input className={input} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
            <label>Member (sees this calendar)<select className={input} value={edit.user_id} onChange={e => setEdit({ ...edit, user_id: e.target.value })}>
              <option value="">None</option>{members.map(m => <option key={m.user_id} value={m.user_id}>{memberName(m)} ({m.role})</option>)}</select></label>
          </div>
          <div><div className="text-xs text-gray-500 mb-1">Services</div>
            <div className="flex flex-wrap gap-3">{setup.services.map(s => (
              <label key={s.id} className="flex items-center gap-1"><input type="checkbox" checked={edit.service_ids.includes(s.id)}
                onChange={e => setEdit({ ...edit, service_ids: e.target.checked ? [...edit.service_ids, s.id] : edit.service_ids.filter(x => x !== s.id) })} />{s.name}</label>))}</div></div>
          <div><div className="text-xs text-gray-500 mb-1">Weekly hours</div>
            {WEEKDAYS.map((d, i) => {
              const h = edit.hours.find(x => x.weekday === i + 1);
              return (
                <div key={d} className="flex items-center gap-2 mb-1">
                  <label className="w-16 flex items-center gap-1"><input type="checkbox" checked={!!h} onChange={e => setEdit({ ...edit, hours: e.target.checked
                    ? [...edit.hours, { weekday: i + 1, start: '09:00', end: '17:00' }] : edit.hours.filter(x => x.weekday !== i + 1) })} />{d}</label>
                  {h && <><input type="time" value={h.start} className="border rounded px-2 py-1" onChange={e => setEdit({ ...edit, hours: edit.hours.map(x => x.weekday === i + 1 ? { ...x, start: e.target.value } : x) })} />
                    –<input type="time" value={h.end} className="border rounded px-2 py-1" onChange={e => setEdit({ ...edit, hours: edit.hours.map(x => x.weekday === i + 1 ? { ...x, end: e.target.value } : x) })} /></>}
                </div>
              );
            })}</div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} /> Takes bookings</label>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => run(async () => {
              const e = await saveResource(orgId, edit.id, { name: edit.name, user_id: edit.user_id || null, active: edit.active, service_ids: edit.service_ids, hours: edit.hours });
              if (!e) setEdit(null); return e;
            }, 'Saved.')} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">Save</button>
            <button onClick={() => setEdit(null)} className="px-4 py-2 rounded-xl bg-gray-100 text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RulesEditor({ orgId, settings, canEdit, busy, run }: { orgId: string; settings: AppointmentSettings | null; canEdit: boolean; busy: boolean; run: Run }) {
  const [s, setS] = useState<AppointmentSettings>(settings ?? { cancel_hours: 24, slot_step_minutes: 15, horizon_days: 60, min_notice_minutes: 120, no_show_fee: null });
  return (
    <div className="bg-white rounded-2xl border p-5 grid md:grid-cols-3 gap-3 text-sm max-w-3xl">
      <label>Customers cancel online up to (hours before)<input type="number" min={0} max={168} className={input} value={s.cancel_hours} disabled={!canEdit} onChange={e => setS({ ...s, cancel_hours: Number(e.target.value) })} /></label>
      <label>Times offered every (minutes)<select className={input} value={s.slot_step_minutes} disabled={!canEdit} onChange={e => setS({ ...s, slot_step_minutes: Number(e.target.value) })}>{[5, 10, 15, 20, 30, 60].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      <label>Bookable up to (days ahead)<input type="number" min={1} max={365} className={input} value={s.horizon_days} disabled={!canEdit} onChange={e => setS({ ...s, horizon_days: Number(e.target.value) })} /></label>
      <label>Minimum notice (minutes)<input type="number" min={0} className={input} value={s.min_notice_minutes} disabled={!canEdit} onChange={e => setS({ ...s, min_notice_minutes: Number(e.target.value) })} /></label>
      <label>No-show fee incl. MVA (empty: none)<input type="number" min={0} className={input} value={s.no_show_fee ?? ''} disabled={!canEdit} onChange={e => setS({ ...s, no_show_fee: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      <p className="md:col-span-3 text-xs text-gray-500">State your cancellation rule and any no-show fee in your terms: customers must know them before they book.</p>
      {canEdit && <button disabled={busy} onClick={() => run(() => saveAppointmentSettings(orgId, s), 'Rules saved.')} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold w-fit">Save</button>}
    </div>
  );
}
