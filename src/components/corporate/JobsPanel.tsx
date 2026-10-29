/**
 * Corporate dashboard → Jobs (00012): the company's services, and its jobs
 * from request to invoice: quote, schedule to a worker, hours and
 * materials, complete, invoice in the company's name. Staff see the jobs
 * given to them. The database checks every step.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Membership } from '../../lib/organizations';
import { formatNok } from '../../lib/invoicing';
import {
  AUTHORISATION_KINDS, JOB_STATUS, PRICE_TYPE, addJobItem, cancelJob, completeJob, createJob, invoiceJob, loadJobItems,
  loadJobServices, loadJobs, loadMembers, memberName, osloDateTime, osloInstant, quoteJob, removeJobItem, saveJobService,
  scheduleJob, startJob, type Job, type JobItem, type JobService, type Member, type PriceType,
} from '../../lib/services';

const input = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm';
const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50';

export default function JobsPanel({ membership }: { membership: Membership }) {
  const org = membership.organization;
  const role = membership.role;
  const manage = role === 'owner' || role === 'admin';
  const book = manage || role === 'booker';
  const [view, setView] = useState<'jobs' | 'services'>('jobs');
  const [services, setServices] = useState<JobService[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState<Job | null>(null);
  const [items, setItems] = useState<JobItem[]>([]);
  const [filter, setFilter] = useState('active');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [s, j, m] = await Promise.all([loadJobServices(org.id), loadJobs({ orgId: org.id }), loadMembers(org.id)]);
    setServices(s); setJobs(j); setMembers(m);
    setOpen(o => o ? j.find(x => x.id === o.id) ?? null : null);
  }, [org.id]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (open) loadJobItems(open.id).then(setItems); else setItems([]); }, [open?.id, open?.status]);

  async function run(fn: () => Promise<string | null>, ok: string) {
    setBusy(true); setMsg(null);
    const e = await fn();
    setBusy(false);
    setMsg(e ? { ok: false, text: e } : { ok: true, text: ok });
    await reload();
    if (open) setItems(await loadJobItems(open.id));
  }

  const workers = members.filter(m => ['staff', 'owner', 'admin'].includes(m.role));
  const shown = useMemo(() => jobs.filter(j => filter === 'all' || (filter === 'active'
    ? !['invoiced', 'cancelled', 'declined'].includes(j.status) : j.status === filter)), [jobs, filter]);
  const svc = (id: string) => services.find(s => s.id === id);

  return (
    <div className="space-y-5 max-w-6xl">
      {msg && <div className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
      <div className="flex gap-2">
        {(['jobs', 'services'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-full text-xs font-medium ${view === v ? 'bg-gray-900 text-white' : 'bg-white border'}`}>
            {v === 'jobs' ? `Jobs (${jobs.length})` : `Services (${services.length})`}
          </button>
        ))}
      </div>

      {view === 'services' && <ServicesEditor orgId={org.id} services={services} canEdit={manage} busy={busy} run={run} />}

      {view === 'jobs' && (
        <div className="grid lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2 bg-white rounded-2xl border overflow-hidden">
            <div className="p-3 border-b flex gap-2 items-center">
              <select value={filter} onChange={e => setFilter(e.target.value)} className="border rounded-lg px-2 py-1 text-xs">
                <option value="active">Open</option><option value="all">All</option>
                {Object.entries(JOB_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {book && services.length > 0 && <button onClick={() => {
                const s = services.find(x => x.active); if (!s) return;
                const name = prompt('Customer name'); if (!name) return;
                const phone = prompt('Customer phone') ?? ''; const address = prompt('Address of the job') ?? '';
                const sid = prompt(`Service (number):\n${services.filter(x => x.active).map((x, i) => `${i + 1}. ${x.name}`).join('\n')}`, '1');
                const chosen = services.filter(x => x.active)[Number(sid) - 1] ?? s;
                run(() => createJob(org.id, chosen.id, { name, phone }, { address }, prompt('What needs doing?') ?? ''), 'Job recorded.');
              }} className={`${btn} bg-[#0B2E59] text-white ms-auto`}>+ Phone job</button>}
            </div>
            <div className="max-h-[70vh] overflow-auto">
              {shown.map(j => (
                <button key={j.id} onClick={() => setOpen(j)} className={`w-full text-left px-4 py-3 border-b text-sm ${open?.id === j.id ? 'bg-gray-50' : ''}`}>
                  <div className="flex justify-between"><span className="font-medium">#{j.number} {svc(j.service_id)?.name}</span><span className="text-xs text-gray-500">{JOB_STATUS[j.status]}</span></div>
                  <div className="text-xs text-gray-500">{j.customer.name} · {j.address}{j.city ? `, ${j.city}` : ''}</div>
                  {j.window_start && <div className="text-xs text-gray-500">{osloDateTime(j.window_start)}{j.assigned_to ? ` · ${memberName(members.find(m => m.user_id === j.assigned_to))}` : ''}</div>}
                </button>
              ))}
              {shown.length === 0 && <p className="p-4 text-sm text-gray-500">No jobs here.</p>}
            </div>
          </div>

          <div className="lg:col-span-3">
            {!open ? <p className="text-sm text-gray-500">Choose a job.</p> : (
              <div className="bg-white rounded-2xl border p-5 space-y-4 text-sm">
                <div className="flex justify-between">
                  <div><h3 className="font-bold text-lg">#{open.number} {svc(open.service_id)?.name}</h3>
                    <div className="text-gray-500">{PRICE_TYPE[open.price_type]}{open.agreed_price != null ? ` · agreed ${formatNok(open.agreed_price)}` : ''}</div></div>
                  <span className="text-xs bg-gray-100 rounded px-2 py-1 h-fit">{JOB_STATUS[open.status]}</span>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  <div><div className="text-xs text-gray-500">Customer</div>{open.customer.name}<br />{open.customer.phone}{open.customer.email ? <><br />{open.customer.email}</> : null}</div>
                  <div><div className="text-xs text-gray-500">Address</div>{open.address}<br />{[open.postcode, open.city].filter(Boolean).join(' ')}</div>
                </div>
                {open.description && <div><div className="text-xs text-gray-500">What needs doing</div>{open.description}</div>}
                {open.preferred_time && <div><div className="text-xs text-gray-500">Preferred time</div>{open.preferred_time}</div>}
                {open.quote_amount != null && <div><div className="text-xs text-gray-500">Quote</div>{formatNok(open.quote_amount)} incl. MVA, valid until {open.quote_valid_until}{open.quote_note ? ` · ${open.quote_note}` : ''}</div>}
                {open.window_start && <div><div className="text-xs text-gray-500">Scheduled</div>{osloDateTime(open.window_start)} – {osloDateTime(open.window_end!)}{open.assigned_to ? ` · ${memberName(members.find(m => m.user_id === open.assigned_to))}` : ''}</div>}

                <div className="flex flex-wrap gap-2">
                  {book && ['requested', 'quoted'].includes(open.status) && <button disabled={busy} onClick={() => {
                    const a = prompt('Quote amount incl. MVA (NOK)'); if (!a) return;
                    run(() => quoteJob(open.id, Number(a.replace(',', '.')), prompt('What the quote includes') ?? '', Number(prompt('Valid for how many days?', '14') ?? 14)), 'Quote sent to the customer.');
                  }} className={`${btn} bg-[#0B2E59] text-white`}>{open.status === 'quoted' ? 'Change quote' : 'Send quote'}</button>}
                  {book && ['accepted', 'scheduled'].includes(open.status) && <ScheduleButton job={open} workers={workers} busy={busy} run={run} />}
                  {open.status === 'scheduled' && <button disabled={busy} onClick={() => run(() => startJob(open.id), 'Started.')} className={`${btn} bg-gray-100`}>Start</button>}
                  {['scheduled', 'in_progress'].includes(open.status) && <button disabled={busy} onClick={() => run(() => completeJob(open.id, prompt('Job report: what was done') ?? ''), 'Completed.')} className={`${btn} bg-emerald-600 text-white`}>Complete</button>}
                  {open.status === 'completed' && ['owner', 'admin', 'finance'].includes(role) && <button disabled={busy} onClick={() => run(() => invoiceJob(open.id), "Invoiced in your company's name. Send it from Invoices to customers.")} className={`${btn} bg-emerald-600 text-white`}>Invoice</button>}
                  {book && !['completed', 'invoiced', 'cancelled'].includes(open.status) && <button disabled={busy} onClick={() => { const r = prompt('Reason for cancelling'); if (r !== null) run(() => cancelJob(open.id, r), 'Cancelled.'); }} className={`${btn} bg-gray-100`}>Cancel</button>}
                </div>

                <div>
                  <div className="font-semibold mb-1">Hours, materials and other lines</div>
                  <table className="w-full text-xs">
                    <tbody>
                      {items.map(i => (
                        <tr key={i.id} className="border-t">
                          <td className="py-1">{i.kind}</td><td>{i.description}</td><td>{i.quantity} × {formatNok(i.unit_price)}</td>
                          <td>{formatNok(i.quantity * i.unit_price * (1 + i.vat_rate / 100))}</td>
                          <td>{!['invoiced', 'cancelled'].includes(open.status) && <button onClick={() => run(() => removeJobItem(i.id), 'Line removed.')} className="text-red-600">Remove</button>}</td>
                        </tr>
                      ))}
                      {items.length === 0 && <tr><td className="py-1 text-gray-400">None yet. A fixed price or accepted quote is added when the job is completed.</td></tr>}
                    </tbody>
                  </table>
                  {!['invoiced', 'cancelled', 'declined'].includes(open.status) && <AddItem jobId={open.id} busy={busy} run={run} />}
                </div>
                {open.report && <div><div className="text-xs text-gray-500">Report</div>{open.report}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleButton({ job, workers, busy, run }: { job: Job; workers: Member[]; busy: boolean; run: (f: () => Promise<string | null>, ok: string) => void }) {
  const [openForm, setOpenForm] = useState(false);
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState('08:00');
  const [to, setTo] = useState('10:00');
  const [who, setWho] = useState(job.assigned_to ?? '');
  if (!openForm) return <button onClick={() => setOpenForm(true)} className={`${btn} bg-[#0B2E59] text-white`}>{job.status === 'scheduled' ? 'Reschedule' : 'Schedule'}</button>;
  return (
    <div className="w-full flex flex-wrap gap-2 items-end bg-gray-50 p-3 rounded-lg">
      <label className="text-xs">Day<input type="date" className={input} value={day} onChange={e => setDay(e.target.value)} /></label>
      <label className="text-xs">From<input type="time" className={input} value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label className="text-xs">To<input type="time" className={input} value={to} onChange={e => setTo(e.target.value)} /></label>
      <label className="text-xs">Worker<select className={input} value={who} onChange={e => setWho(e.target.value)}>
        <option value="">(not yet)</option>{workers.map(w => <option key={w.user_id} value={w.user_id}>{memberName(w)}</option>)}</select></label>
      <button disabled={busy} onClick={() => run(async () => { const e = await scheduleJob(job.id, osloInstant(day, from), osloInstant(day, to), who || null); if (!e) setOpenForm(false); return e; }, 'Scheduled.')} className={`${btn} bg-[#0B2E59] text-white`}>Save</button>
    </div>
  );
}

function AddItem({ jobId, busy, run }: { jobId: string; busy: boolean; run: (f: () => Promise<string | null>, ok: string) => void }) {
  const [kind, setKind] = useState('labour');
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  return (
    <div className="flex flex-wrap gap-2 items-end mt-2">
      <select className="border rounded-lg px-2 py-1.5 text-xs" value={kind} onChange={e => setKind(e.target.value)}>
        <option value="labour">Hours</option><option value="material">Material</option><option value="call_out">Call-out</option><option value="other">Other</option>
      </select>
      <input className="border rounded-lg px-2 py-1.5 text-xs flex-1 min-w-[140px]" placeholder="Description" value={desc} onChange={e => setDesc(e.target.value)} />
      <input type="number" step="any" className="border rounded-lg px-2 py-1.5 text-xs w-16" value={qty} onChange={e => setQty(Number(e.target.value))} title="Quantity / hours" />
      <input type="number" step="any" className="border rounded-lg px-2 py-1.5 text-xs w-24" value={price} onChange={e => setPrice(Number(e.target.value))} title="Unit price excl. MVA" />
      <button disabled={busy || !desc} onClick={() => run(async () => { const e = await addJobItem(jobId, kind, desc, qty, price); if (!e) setDesc(''); return e; }, 'Line added.')} className={`${btn} bg-gray-100`}>Add (excl. MVA)</button>
    </div>
  );
}

function ServicesEditor({ orgId, services, canEdit, busy, run }: { orgId: string; services: JobService[]; canEdit: boolean; busy: boolean;
  run: (f: () => Promise<string | null>, ok: string) => void }) {
  const blank = { name: '', description: '', price_type: 'fixed' as PriceType, price: null as number | null, vat_rate: 25, call_out_fee: null as number | null,
                  requires_authorisation: '' as string | null, active: true, sort: services.length + 1 };
  const [edit, setEdit] = useState<{ id: string | null; s: typeof blank } | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">Prices include MVA. A service that needs an authorisation (for example electrical work) is offered only once FlyttGo has it on record.</p>
      <div className="bg-white rounded-2xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr>{['Service', 'Price', 'Call-out', 'Needs', 'Shown', ''].map(h => <th key={h} className="text-left p-3 text-xs text-gray-500">{h}</th>)}</tr></thead>
          <tbody>
            {services.map(s => (
              <tr key={s.id} className="border-t">
                <td className="p-3">{s.name}</td>
                <td className="p-3">{PRICE_TYPE[s.price_type]}{s.price != null ? ` ${formatNok(s.price)}` : ''}</td>
                <td className="p-3">{s.call_out_fee != null ? formatNok(s.call_out_fee) : '—'}</td>
                <td className="p-3 text-xs">{s.requires_authorisation ? AUTHORISATION_KINDS[s.requires_authorisation] : '—'}</td>
                <td className="p-3">{s.active ? 'Yes' : 'No'}</td>
                <td className="p-3">{canEdit && <button onClick={() => setEdit({ id: s.id, s: { ...blank, ...s, description: s.description ?? '', requires_authorisation: s.requires_authorisation ?? '' } })} className="text-xs text-[#0B2E59]">Edit</button>}</td>
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
          <label>Price type<select className={input} value={edit.s.price_type} onChange={e => setEdit({ ...edit, s: { ...edit.s, price_type: e.target.value as PriceType } })}>
            {Object.entries(PRICE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Price incl. MVA{edit.s.price_type === 'hourly' ? ' per hour' : ''}<input type="number" step="any" disabled={edit.s.price_type === 'quote'} className={input} value={edit.s.price ?? ''} onChange={e => setEdit({ ...edit, s: { ...edit.s, price: e.target.value === '' ? null : Number(e.target.value) } })} /></label>
          <label>Call-out fee incl. MVA<input type="number" step="any" className={input} value={edit.s.call_out_fee ?? ''} onChange={e => setEdit({ ...edit, s: { ...edit.s, call_out_fee: e.target.value === '' ? null : Number(e.target.value) } })} /></label>
          <label>Needs authorisation<select className={input} value={edit.s.requires_authorisation ?? ''} onChange={e => setEdit({ ...edit, s: { ...edit.s, requires_authorisation: e.target.value } })}>
            <option value="">None</option>{Object.entries(AUTHORISATION_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={edit.s.active} onChange={e => setEdit({ ...edit, s: { ...edit.s, active: e.target.checked } })} /> Shown to customers</label>
          <label className="md:col-span-3">Description<textarea className={input} value={edit.s.description} onChange={e => setEdit({ ...edit, s: { ...edit.s, description: e.target.value } })} /></label>
          <div className="md:col-span-3 flex gap-2">
            <button disabled={busy} onClick={() => run(async () => { const e = await saveJobService(orgId, edit.id, edit.s as any); if (!e) setEdit(null); return e; }, 'Service saved.')} className="px-4 py-2 rounded-xl bg-[#0B2E59] text-white text-sm font-semibold">Save</button>
            <button onClick={() => setEdit(null)} className="px-4 py-2 rounded-xl bg-gray-100 text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
