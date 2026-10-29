/**
 * Booking on a company's own page outside moving (docs/SERVICE_PLATFORM.md):
 *   Jobs (trades): choose a service, give the address and what needs doing,
 *     and send the request (a fixed or hourly price is agreed by booking; a
 *     quote comes from the company).
 *   Appointments: choose a service, a person (or anyone), a day and a free
 *     time, and book.
 *   Restaurant: the party size, a day and a free time, and book a table
 *     (notes such as allergies in the guest's own words).
 *   Hotel: the dates and guests, a free room type, and book the stay.
 * Visitors see services, free times and rooms; booking needs a FlyttGo
 * sign-in.
 * The company is the seller; the page says so.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { useWhiteLabel } from '../lib/whiteLabelContext';
import { bookingLabel, textOn } from '../lib/whiteLabel';
import { formatNok } from '../lib/invoicing';
import { supabase } from '../lib/supabase';
import {
  PRICE_TYPE, addDays, bookAppointment, freeSlots, osloDateTime, osloTime, osloToday, requestJob,
  type AppointmentService, type JobService, type Resource,
} from '../lib/services';
import {
  bookStay, bookTable, freeRooms, freeTableTimes, loadHotelSettings, loadRestaurantPublic, nightsBetween, noShowFeeFor,
  stayCancellationRule, timesByPeriod, type FreeRoomType, type FreeTime, type HotelSettings, type RestaurantSettings,
} from '../lib/reservations';

const input = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm';

export default function ServiceBookingPage() {
  const { site } = useWhiteLabel();
  if (!site) return <div className="min-h-[50vh] flex items-center justify-center text-gray-500">This booking page isn't available.</div>;
  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-extrabold text-gray-900 mb-1">{bookingLabel(site.booking, 'Book a time')}</h1>
      <p className="text-gray-500 mb-6">{site.display_name}</p>
      {site.booking === 'jobs' ? <JobRequest /> : site.booking === 'appointments' ? <AppointmentBooking />
        : site.booking === 'hotel' || site.booking === 'restaurant' ? <Reservations /> : <p>Online booking is not open yet.</p>}
      <p className="text-xs text-gray-500 mt-8">{site.seller_notice}</p>
    </div>
  );
}

function useContact() {
  const { user } = useAuth();
  const [contact, setContact] = useState({ name: '', phone: '', email: '' });
  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('first_name, last_name, phone, email').eq('user_id', user.id).maybeSingle().then(({ data }) => {
      if (data) setContact(c => ({ name: c.name || [data.first_name, data.last_name].filter(Boolean).join(' '), phone: c.phone || data.phone || '', email: c.email || data.email || user.email || '' }));
    });
  }, [user]);
  return [contact, setContact] as const;
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

/** Tables and rooms: a hotel with a restaurant on its plan offers both. */
function Reservations() {
  const { site } = useWhiteLabel();
  const [kind, setKind] = useState<'hotel' | 'restaurant'>(site?.booking === 'restaurant' ? 'restaurant' : 'hotel');
  if (!site) return null;
  const both = site.modules.includes('hotel_reservations') && site.modules.includes('restaurant_reservations');
  return (
    <div className="space-y-5">
      {both && (
        <div className="flex gap-2">
          {(['hotel', 'restaurant'] as const).map(k => (
            <button key={k} onClick={() => setKind(k)} className={`px-3 py-1.5 rounded-full text-sm ${kind === k ? 'bg-gray-900 text-white' : 'bg-white border'}`}>
              {bookingLabel(k)}</button>
          ))}
        </div>
      )}
      {kind === 'hotel' && site.modules.includes('hotel_reservations') ? <HotelBooking /> : <TableBooking />}
    </div>
  );
}

function TableBooking() {
  const { site } = useWhiteLabel();
  const { user } = useAuth();
  const { setPage } = useApp();
  const [rules, setRules] = useState<RestaurantSettings | null>(null);
  const [party, setParty] = useState(2);
  const [day, setDay] = useState(osloToday());
  const [times, setTimes] = useState<FreeTime[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [contact, setContact] = useContact();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { if (site) loadRestaurantPublic(site.organization_id).then(r => setRules(r.settings)); }, [site?.organization_id]);
  useEffect(() => {
    if (!site) return;
    setPick(null);
    freeTableTimes(site.organization_id, day, party).then(setTimes);
  }, [site?.organization_id, day, party]);
  if (!site) return null;
  const accent = site.accent_color ?? '#10b981';
  const max = rules?.max_party_online ?? 8;
  const fee = noShowFeeFor(rules, party);
  if (done) return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
      <h2 className="font-bold text-lg mb-1">Table booked: {done}</h2>
      <p className="text-sm text-gray-700">You'll get a reminder the day before. You can cancel under My jobs and appointments.</p>
      <button onClick={() => setPage('my-services')} className="mt-4 underline text-sm">My jobs and appointments</button>
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Guests<select className={input} value={party} onChange={e => setParty(Number(e.target.value))}>
          {Array.from({ length: max }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <div className="flex items-center gap-2">
          <button onClick={() => day > osloToday() && setDay(addDays(day, -1))} className="px-3 py-1 rounded-lg bg-gray-100">‹</button>
          <input type="date" min={osloToday()} value={day} onChange={e => setDay(e.target.value)} className="border rounded-lg px-2 py-1 text-sm" />
          <button onClick={() => setDay(addDays(day, 1))} className="px-3 py-1 rounded-lg bg-gray-100">›</button>
        </div>
      </div>
      <p className="text-xs text-gray-500">More than {max} guests? Call {site.display_name}{site.support?.phone ? ` on ${site.support.phone}` : ''}.</p>
      <div className="space-y-3">
        {timesByPeriod(times).map(g => (
          <div key={g.period}>
            {g.period && <div className="text-xs text-gray-500 mb-1">{g.period}</div>}
            <div className="flex flex-wrap gap-2">
              {g.times.map(t => (
                <button key={t.starts_at} onClick={() => setPick(t.starts_at)}
                  className={`px-3 py-2 rounded-lg border text-sm ${pick === t.starts_at ? 'bg-gray-900 text-white' : 'bg-white'}`}>{osloTime(t.starts_at)}</button>
              ))}
            </div>
          </div>
        ))}
        {times.length === 0 && <p className="text-sm text-gray-500">No free tables for {party} this day. Try another day.</p>}
      </div>
      {pick && (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="text-sm">Name<input className={input} value={contact.name} onChange={e => setContact({ ...contact, name: e.target.value })} /></label>
            <label className="text-sm">Phone<input className={input} value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} /></label>
            <label className="text-sm">Email (reminder)<input className={input} value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} /></label>
          </div>
          <label className="block text-sm">Anything the restaurant should know (optional)
            <textarea rows={2} className={input} value={notes} placeholder="e.g. a birthday, a high chair, allergies" onChange={e => setNotes(e.target.value)} /></label>
        </div>
      )}
      <p className="text-xs text-gray-500">
        {rules ? `Cancel online up to ${rules.cancel_hours} hours before. ` : ''}
        {fee ? `If nobody comes, ${site.display_name} charges a no-show fee of ${formatNok(fee)}. ` : ''}
        {site.terms_url && <>See <a className="underline" href={site.terms_url} target="_blank" rel="noopener noreferrer">{site.display_name}'s terms</a>.</>}
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {pick && (!user ? <SignInFirst /> : (
        <button disabled={busy} style={{ background: accent, color: textOn(accent) }} className="w-full py-3 rounded-xl font-semibold disabled:opacity-50"
          onClick={async () => {
            setBusy(true); setError('');
            const r = await bookTable(site.organization_id, pick, party, contact, notes);
            setBusy(false);
            if (r.error) { setError(r.error); freeTableTimes(site.organization_id, day, party).then(setTimes); }
            else setDone(`${osloDateTime(pick)}, ${party} ${party === 1 ? 'guest' : 'guests'}`);
          }}>Book a table for {party}, {osloDateTime(pick)}</button>
      ))}
    </div>
  );
}

function HotelBooking() {
  const { site } = useWhiteLabel();
  const { user } = useAuth();
  const { setPage } = useApp();
  const [rules, setRules] = useState<HotelSettings | null>(null);
  const [checkIn, setCheckIn] = useState(addDays(osloToday(), 1));
  const [checkOut, setCheckOut] = useState(addDays(osloToday(), 2));
  const [guests, setGuests] = useState(2);
  const [rooms, setRooms] = useState<FreeRoomType[]>([]);
  const [pick, setPick] = useState('');
  const [notes, setNotes] = useState('');
  const [contact, setContact] = useContact();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { if (site) loadHotelSettings(site.organization_id).then(setRules); }, [site?.organization_id]);
  useEffect(() => {
    if (!site) return;
    setPick('');
    if (nightsBetween(checkIn, checkOut) < 1) { setRooms([]); return; }
    freeRooms(site.organization_id, checkIn, checkOut, guests).then(setRooms);
  }, [site?.organization_id, checkIn, checkOut, guests]);
  if (!site) return null;
  const accent = site.accent_color ?? '#10b981';
  const nights = nightsBetween(checkIn, checkOut);
  const chosen = rooms.find(r => r.room_type_id === pick);
  const rule = chosen ? stayCancellationRule(rules, checkIn, chosen.total) : null;
  if (done) return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
      <h2 className="font-bold text-lg mb-1">Room booked: {done}</h2>
      <p className="text-sm text-gray-700">You'll get a reminder the day before you arrive. You can cancel under My jobs and appointments.</p>
      <button onClick={() => setPage('my-services')} className="mt-4 underline text-sm">My jobs and appointments</button>
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-sm">Arrival<input type="date" min={osloToday()} className={input} value={checkIn}
          onChange={e => { setCheckIn(e.target.value); if (e.target.value >= checkOut) setCheckOut(addDays(e.target.value, 1)); }} /></label>
        <label className="text-sm">Departure<input type="date" min={addDays(checkIn, 1)} className={input} value={checkOut} onChange={e => setCheckOut(e.target.value)} /></label>
        <label className="text-sm">Guests<select className={input} value={guests} onChange={e => setGuests(Number(e.target.value))}>
          {Array.from({ length: 8 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
      {rules && <p className="text-xs text-gray-500">Check-in from {rules.check_in_from.slice(0, 5)}, check-out by {rules.check_out_by.slice(0, 5)}.</p>}
      <div className="grid gap-2">
        {rooms.map(r => (
          <label key={r.room_type_id} className={`border-2 rounded-xl p-4 cursor-pointer ${pick === r.room_type_id ? 'border-gray-900' : 'border-gray-200'}`}>
            <input type="radio" className="sr-only" checked={pick === r.room_type_id} onChange={() => setPick(r.room_type_id)} />
            <div className="flex justify-between"><span className="font-semibold">{r.name}</span>
              <span className="text-sm">{formatNok(r.total)} · {r.nights} {r.nights === 1 ? 'night' : 'nights'}</span></div>
            <div className="text-sm text-gray-500">{formatNok(r.nightly_price)} a night incl. MVA · up to {r.capacity} guests{r.rooms_free <= 2 ? ` · ${r.rooms_free} left` : ''}</div>
            {r.description && <div className="text-sm text-gray-500">{r.description}</div>}
          </label>
        ))}
        {rooms.length === 0 && <p className="text-sm text-gray-500">{nights < 1 ? 'Choose a departure after the arrival.' : 'No rooms are free for these dates. Try other dates.'}</p>}
      </div>
      {chosen && (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="text-sm">Name<input className={input} value={contact.name} onChange={e => setContact({ ...contact, name: e.target.value })} /></label>
            <label className="text-sm">Phone<input className={input} value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} /></label>
            <label className="text-sm">Email (reminder)<input className={input} value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} /></label>
          </div>
          <label className="block text-sm">Message to the hotel (optional)<textarea rows={2} className={input} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        </div>
      )}
      {chosen && <p className="text-xs text-gray-500">
        {rule?.fee != null && rule.freeUntil ? `Free cancellation until ${rule.freeUntil}; after that ${formatNok(rule.fee)}. ` : 'Cancel online until the day before arrival. '}
        {site.terms_url && <>See <a className="underline" href={site.terms_url} target="_blank" rel="noopener noreferrer">{site.display_name}'s terms</a>.</>}
      </p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {chosen && (!user ? <SignInFirst /> : (
        <button disabled={busy} style={{ background: accent, color: textOn(accent) }} className="w-full py-3 rounded-xl font-semibold disabled:opacity-50"
          onClick={async () => {
            setBusy(true); setError('');
            const r = await bookStay(site.organization_id, chosen.room_type_id, checkIn, checkOut, guests, contact, notes);
            setBusy(false);
            if (r.error) { setError(r.error); freeRooms(site.organization_id, checkIn, checkOut, guests).then(setRooms); }
            else setDone(`${chosen.name}, ${checkIn} to ${checkOut}`);
          }}>Book {chosen.name} for {formatNok(chosen.total)}</button>
      ))}
    </div>
  );
}
