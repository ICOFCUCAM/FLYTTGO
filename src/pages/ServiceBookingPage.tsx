/**
 * Booking on a company's own page outside moving (docs/SERVICE_PLATFORM.md):
 *   Jobs (trades): choose a service, give the address and what needs doing,
 *     and send the request (a fixed or hourly price is agreed by booking; a
 *     quote comes from the company).
 *   Appointments: choose a service, a person (or anyone), a day and a free
 *     time, and book.
 * Visitors see services and free times; booking needs a FlyttGo sign-in.
 * The company is the seller; the page says so.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { useWhiteLabel } from '../lib/whiteLabelContext';
import { textOn } from '../lib/whiteLabel';
import { formatNok } from '../lib/invoicing';
import { supabase } from '../lib/supabase';
import { useContact } from '../hooks/useContact';
import {
  PRICE_TYPE, addDays, bookAppointment, freeSlots, osloDateTime, osloTime, osloToday, requestJob,
  type AppointmentService, type JobService, type Resource,
} from '../lib/services';

const input = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm';

export default function ServiceBookingPage() {
  const { site } = useWhiteLabel();
  if (!site) return <div className="min-h-[50vh] flex items-center justify-center text-gray-500">This booking page isn't available.</div>;
  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-extrabold text-gray-900 mb-1">{site.booking === 'jobs' ? 'Ask for a job' : 'Book a time'}</h1>
      <p className="text-gray-500 mb-6">{site.display_name}</p>
      {site.booking === 'jobs' ? <JobRequest /> : site.booking === 'appointments' ? <AppointmentBooking /> : <p>Online booking is not open yet.</p>}
      <p className="text-xs text-gray-500 mt-8">{site.seller_notice}</p>
    </div>
  );
}

function SignInFirst() {
  const { setShowAuthModal, setAuthMode } = useApp();
  return (
    <button onClick={() => { setAuthMode('signin'); setShowAuthModal(true); }} className="w-full py-3 rounded-xl bg-gray-900 text-white font-semibold">
      Sign in to book
    </button>
  );
}

function JobRequest() {
  const { site } = useWhiteLabel();
  const { user } = useAuth();
  const { setPage } = useApp();
  const [services, setServices] = useState<JobService[]>([]);
  const [service, setService] = useState('');
  const [place, setPlace] = useState({ address: '', postcode: '', city: '' });
  const [description, setDescription] = useState('');
  const [preferred, setPreferred] = useState('');
  const [contact, setContact] = useContact();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<number | null>(null);
  useEffect(() => {
    if (!site) return;
    supabase.from('job_services').select('*').eq('organization_id', site.organization_id).eq('active', true).order('sort')
      .then(({ data }) => { setServices((data ?? []) as JobService[]); setService(data?.[0]?.id ?? ''); });
  }, [site?.organization_id]);
  if (!site) return null;
  const s = services.find(x => x.id === service);
  const accent = site.accent_color ?? '#10b981';
  if (done !== null) return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
      <h2 className="font-bold text-lg mb-1">Request {done} sent</h2>
      <p className="text-sm text-gray-700">{s?.price_type === 'quote' ? `${site.display_name} will send you a quote.` : `${site.display_name} will confirm a time with you.`}
        {' '}You can follow it under My jobs and appointments.</p>
      <button onClick={() => setPage('my-services')} className="mt-4 underline text-sm">My jobs and appointments</button>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        {services.map(x => (
          <label key={x.id} className={`border-2 rounded-xl p-4 cursor-pointer ${service === x.id ? 'border-gray-900' : 'border-gray-200'}`}>
            <input type="radio" className="sr-only" checked={service === x.id} onChange={() => setService(x.id)} />
            <div className="flex justify-between"><span className="font-semibold">{x.name}</span>
              <span className="text-sm">{x.price_type === 'quote' ? 'Price on quote' : `${formatNok(x.price ?? 0)}${x.price_type === 'hourly' ? ' / hour' : ''}`}</span></div>
            {x.description && <div className="text-sm text-gray-500">{x.description}</div>}
            {x.call_out_fee ? <div className="text-xs text-gray-500">+ call-out {formatNok(x.call_out_fee)}</div> : null}
          </label>
        ))}
        {services.length === 0 && <p className="text-sm text-gray-500">No services are open for online requests yet.</p>}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="sm:col-span-3 text-sm">Address of the job<input className={input} value={place.address} onChange={e => setPlace({ ...place, address: e.target.value })} /></label>
        <label className="text-sm">Postcode<input className={input} value={place.postcode} onChange={e => setPlace({ ...place, postcode: e.target.value })} /></label>
        <label className="sm:col-span-2 text-sm">Town<input className={input} value={place.city} onChange={e => setPlace({ ...place, city: e.target.value })} /></label>
      </div>
      <label className="block text-sm">What needs doing<textarea rows={3} className={input} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <label className="block text-sm">When suits you (optional)<input className={input} value={preferred} placeholder="e.g. weekday mornings" onChange={e => setPreferred(e.target.value)} /></label>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-sm">Name<input className={input} value={contact.name} onChange={e => setContact({ ...contact, name: e.target.value })} /></label>
        <label className="text-sm">Phone<input className={input} value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} /></label>
        <label className="text-sm">Email<input className={input} value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} /></label>
      </div>
      {s && <p className="text-xs text-gray-500">{PRICE_TYPE[s.price_type]}{s.price_type === 'quote' ? ': you accept or decline the quote before any work.' : ': by sending the request you accept this price; hours and materials are invoiced as used.'}
        {site.terms_url ? <> See <a className="underline" href={site.terms_url} target="_blank" rel="noopener noreferrer">{site.display_name}'s terms</a>.</> : null}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!user ? <SignInFirst /> : (
        <button disabled={busy || !service} style={{ background: accent, color: textOn(accent) }} className="w-full py-3 rounded-xl font-semibold disabled:opacity-50"
          onClick={async () => {
            setBusy(true); setError('');
            const r = await requestJob(site.organization_id, service, contact, place, description, preferred);
            setBusy(false);
            if (r.error) setError(r.error); else setDone(r.job?.number ?? 0);
          }}>Send request</button>
      )}
    </div>
  );
}

function AppointmentBooking() {
  const { site } = useWhiteLabel();
  const { user } = useAuth();
  const { setPage } = useApp();
  const [services, setServices] = useState<AppointmentService[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [links, setLinks] = useState<{ resource_id: string; service_id: string }[]>([]);
  const [service, setService] = useState('');
  const [resource, setResource] = useState('');
  const [day, setDay] = useState(osloToday());
  const [slots, setSlots] = useState<{ resource_id: string; resource_name: string; starts_at: string }[]>([]);
  const [pick, setPick] = useState<{ resource_id: string; starts_at: string } | null>(null);
  const [contact, setContact] = useContact();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!site) return;
    (async () => {
      const [{ data: s }, { data: r }] = await Promise.all([
        supabase.from('appointment_services').select('*').eq('organization_id', site.organization_id).eq('active', true).order('sort'),
        supabase.from('appointment_resources').select('*').eq('organization_id', site.organization_id).eq('active', true).order('sort'),
      ]);
      setServices((s ?? []) as AppointmentService[]); setResources((r ?? []) as Resource[]); setService(s?.[0]?.id ?? '');
      const ids = (r ?? []).map((x: Resource) => x.id);
      if (ids.length) { const { data: l } = await supabase.from('appointment_resource_services').select('*').in('resource_id', ids); setLinks(l ?? []); }
    })();
  }, [site?.organization_id]);
  useEffect(() => {
    if (!site || !service) return;
    setPick(null);
    freeSlots(site.organization_id, service, day, resource || null).then(setSlots);
  }, [site?.organization_id, service, resource, day]);
  if (!site) return null;
  const accent = site.accent_color ?? '#10b981';
  const offering = resources.filter(r => links.some(l => l.resource_id === r.id && l.service_id === service));
  const times = Array.from(new Map(slots.map(s => [s.starts_at, s])).values());
  if (done) return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
      <h2 className="font-bold text-lg mb-1">Booked: {done}</h2>
      <p className="text-sm text-gray-700">You'll get a reminder the day before. You can cancel under My jobs and appointments.</p>
      <button onClick={() => setPage('my-services')} className="mt-4 underline text-sm">My jobs and appointments</button>
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-2">
        {services.map(x => (
          <label key={x.id} className={`border-2 rounded-xl p-4 cursor-pointer ${service === x.id ? 'border-gray-900' : 'border-gray-200'}`}>
            <input type="radio" className="sr-only" checked={service === x.id} onChange={() => { setService(x.id); setResource(''); }} />
            <div className="flex justify-between"><span className="font-semibold">{x.name}</span><span className="text-sm">{formatNok(x.price)} · {x.duration_minutes} min</span></div>
            {x.description && <div className="text-sm text-gray-500">{x.description}</div>}
          </label>
        ))}
        {services.length === 0 && <p className="text-sm text-gray-500">No services are open for online booking yet.</p>}
      </div>
      {offering.length > 1 && (
        <label className="block text-sm">With<select className={input} value={resource} onChange={e => setResource(e.target.value)}>
          <option value="">Anyone</option>{offering.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      )}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => day > osloToday() && setDay(addDays(day, -1))} className="px-3 py-1 rounded-lg bg-gray-100">‹</button>
          <input type="date" min={osloToday()} value={day} onChange={e => setDay(e.target.value)} className="border rounded-lg px-2 py-1 text-sm" />
          <button onClick={() => setDay(addDays(day, 1))} className="px-3 py-1 rounded-lg bg-gray-100">›</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {times.map(t => (
            <button key={t.starts_at} onClick={() => setPick({ resource_id: resource || t.resource_id, starts_at: t.starts_at })}
              className={`px-3 py-2 rounded-lg border text-sm ${pick?.starts_at === t.starts_at ? 'bg-gray-900 text-white' : 'bg-white'}`}>{osloTime(t.starts_at)}</button>
          ))}
          {times.length === 0 && <p className="text-sm text-gray-500">No free times this day. Try another day.</p>}
        </div>
      </div>
      {pick && (
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="text-sm">Name<input className={input} value={contact.name} onChange={e => setContact({ ...contact, name: e.target.value })} /></label>
          <label className="text-sm">Phone<input className={input} value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} /></label>
          <label className="text-sm">Email (reminder)<input className={input} value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} /></label>
        </div>
      )}
      {site.terms_url && <p className="text-xs text-gray-500">Cancellation and no-show rules: <a className="underline" href={site.terms_url} target="_blank" rel="noopener noreferrer">{site.display_name}'s terms</a>.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {pick && (!user ? <SignInFirst /> : (
        <button disabled={busy} style={{ background: accent, color: textOn(accent) }} className="w-full py-3 rounded-xl font-semibold disabled:opacity-50"
          onClick={async () => {
            setBusy(true); setError('');
            const r = await bookAppointment(site.organization_id, service, resource || null, pick.starts_at, contact, '');
            setBusy(false);
            if (r.error) { setError(r.error); freeSlots(site.organization_id, service, day, resource || null).then(setSlots); }
            else setDone(osloDateTime(pick.starts_at));
          }}>Book {osloDateTime(pick.starts_at)}</button>
      ))}
    </div>
  );
}
