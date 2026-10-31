/**
 * Tracking (/track), rebuilt on 31 October 2026 (owner: premium tracking, real data only).
 *
 * Before: the page searched a uuid with the first eight characters customers were shown (never matched),
 * mapped statuses that do not exist, called a single fetch "live", and showed a made-up driver with a phone
 * number, a scripted chat reply, a fake arrival countdown and invented step times.
 *
 * Now:
 *  - Lookup by the booking's own short reference (bookings.booking_ref, FG-XXXXXX, migration 00029) through
 *    track_booking(), which anyone holding the reference may call: status, times, van and the two towns only.
 *  - The booking's own customer (signed in) gets the full booking under the usual row rules: the road route
 *    on the map (components/RouteMap), the driver's live position (lib/driverTracking) and an arrival
 *    estimate from that position (labelled an estimate), and the status follows the database over realtime,
 *    with a timed refetch as fallback. The page says "live" only while that subscription is connected.
 *  - One status mapping for every real status (lib/trackingStatus.ts); cancelled shown as cancelled.
 *  - Only real times; nothing invented. Where something is not known, it says so.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { followBookingDriver, type Coords } from '../lib/driverTracking';
import { formatDuration, routeGeometry } from '../lib/routeGeometry';
import { TRACKING_STEPS, isUuid, normaliseRef, stepTime, trackingState } from '../lib/trackingStatus';

const RouteMap = lazy(() => import('../components/RouteMap'));

/** What track_booking() returns to anyone holding the reference. */
interface PublicTrack {
  ref: string; status: string; paid: boolean; created_at: string | null; updated_at: string | null;
  move_date: string | null; move_time: string | null; start_time: string | null; end_time: string | null;
  cancelled_at: string | null; van_type: string | null; pickup_city: string | null; dropoff_city: string | null;
  driver_assigned: boolean; is_owner: boolean; booking_id: string | null;
}
type OwnBooking = Record<string, any>;

const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24513B]';
const POLL_MS = 30_000;

export default function TrackingPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'no' ? 'no' : 'en';
  const locale = lang === 'no' ? 'nb-NO' : 'en-GB';
  const { setPage, setShowAuthModal, setAuthMode } = useApp();
  const { user } = useAuth();

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [pub, setPub] = useState<PublicTrack | null>(null);
  const [own, setOwn] = useState<OwnBooking | null>(null);
  const [live, setLive] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [driverPos, setDriverPos] = useState<Coords | null>(null);
  const [eta, setEta] = useState<{ minutes: number; to: 'pickup' | 'dropoff'; road: boolean } | null>(null);

  const status = own?.status ?? pub?.status ?? null;
  const state = trackingState(status);
  const ref = own?.booking_ref ?? pub?.ref ?? null;
  const times = own ?? pub ?? {};

  /* ── Loading a booking ─────────────────────────────────────────── */
  const loadOwn = useCallback(async (id: string) => {
    const { data } = await supabase.from('bookings').select('*').eq('id', id).maybeSingle();
    if (data) { setOwn(data); setPub(null); setCheckedAt(new Date()); return true; }
    return false;
  }, []);

  const lookup = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setLoading(true); setError(''); setSearched(true); setOwn(null); setPub(null); setDriverPos(null); setEta(null);
    try {
      if (isUuid(text) && user) { if (await loadOwn(text)) return; }
      const refValue = normaliseRef(text);
      if (!refValue) { setError(t('trackingV2.badRef')); return; }
      const { data, error: rpcError } = await supabase.rpc('track_booking', { p_ref: refValue });
      if (rpcError) { setError(t('trackingV2.unavailable')); return; }
      const found = data as PublicTrack | null;
      if (!found) return;
      if (found.is_owner && found.booking_id && await loadOwn(found.booking_id)) return;
      setPub(found); setCheckedAt(new Date());
      try { const u = new URL(window.location.href); u.searchParams.set('ref', found.ref); window.history.replaceState(null, '', u.toString()); } catch { /* no URL API */ }
    } finally { setLoading(false); }
  }, [user, loadOwn, t]);

  /* A reference in the address (/track?ref=FG-…) opens straight away; otherwise a signed-in customer's active booking. */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    const fromUrl = (() => { try { return new URLSearchParams(window.location.search).get('ref'); } catch { return null; } })();
    if (fromUrl) { started.current = true; setQuery(fromUrl); void lookup(fromUrl); return; }
    if (!user) return;
    started.current = true;
    void Promise.resolve(supabase.from('bookings').select('*').eq('customer_id', user.id)
      .not('status', 'in', '("completed","cancelled")').order('created_at', { ascending: false }).limit(1))
      .then(({ data }) => { if (data?.[0]) { setOwn(data[0]); setSearched(true); setCheckedAt(new Date()); } })
      .catch(() => {});
  }, [user, lookup]);

  /* ── Keeping it current ────────────────────────────────────────── */
  const ownId = own?.id as string | undefined;
  useEffect(() => {
    if (!ownId) return;
    setLive(false);
    const channel = supabase.channel(`booking-${ownId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${ownId}` },
          (payload: { new?: OwnBooking }) => { if (payload.new) { setOwn(o => ({ ...(o ?? {}), ...payload.new })); setCheckedAt(new Date()); } })
      .subscribe((s: string) => setLive(s === 'SUBSCRIBED'));
    const timer = window.setInterval(() => { void loadOwn(ownId); }, POLL_MS);
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel); setLive(false); };
  }, [ownId, loadOwn]);

  const pubRef = pub?.ref;
  useEffect(() => {
    if (!pubRef) return;
    const timer = window.setInterval(async () => {
      const { data } = await supabase.rpc('track_booking', { p_ref: pubRef });
      if (data) { setPub(data as PublicTrack); setCheckedAt(new Date()); }
    }, POLL_MS * 2);
    return () => window.clearInterval(timer);
  }, [pubRef]);

  /* The driver's live position, while the job is in flight (the database allows it only then). */
  const inFlight = state.step >= 1 && state.step <= 4;
  useEffect(() => {
    setDriverPos(null);
    if (!ownId || !inFlight) return;
    return followBookingDriver(supabase, ownId, setDriverPos);
  }, [ownId, inFlight]);

  /* Arrival estimate from the driver's position to the next stop, refreshed as the driver moves. */
  const pickup = own && own.pickup_lat != null ? { lat: Number(own.pickup_lat), lng: Number(own.pickup_lng) } : null;
  const dropoff = own && own.dropoff_lat != null ? { lat: Number(own.dropoff_lat), lng: Number(own.dropoff_lng) } : null;
  const target = state.heading === 'pickup' ? pickup : state.heading === 'dropoff' ? dropoff : null;
  const driverKey = driverPos ? `${driverPos.lat.toFixed(3)},${driverPos.lng.toFixed(3)}` : '';
  useEffect(() => {
    if (!driverPos || !target || !state.heading) { setEta(null); return; }
    let on = true;
    void routeGeometry(driverPos, target).then(r => { if (on) setEta({ minutes: r.durationMinutes, to: state.heading!, road: r.source === 'road' }); });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverKey, target?.lat, target?.lng, state.heading]);

  /* ── Formatting ────────────────────────────────────────────────── */
  const time = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  const moveDay = (d: string | null | undefined, tm: string | null | undefined) => d
    ? `${new Date(d).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' })}${tm ? ` · ${String(tm).slice(0, 5)}` : ''}` : null;
  const statusLabel = state.cancelled ? t('trackingV2.cancelled') : state.unknown ? t('trackingV2.unknownStatus', { status: status ?? '—' })
    : t(`trackingV2.step.${TRACKING_STEPS[state.step]}`);
  const vanName = (v: string | null | undefined) => v ? t(`trackingV2.vans.${v}`, v.replace(/_/g, ' ')) : '—';
  const from = own?.pickup_city || pub?.pickup_city || null;
  const to = own?.dropoff_city || pub?.dropoff_city || null;
  const found = !!(own || pub);

  const facts = useMemo(() => {
    const rows: [string, string][] = [
      [t('trackingV2.ref'), ref ?? '—'],
      [t('trackingV2.van'), vanName(own?.van_type ?? pub?.van_type)],
      [t('trackingV2.moveDate'), moveDay(own?.move_date ?? pub?.move_date, own?.move_time ?? pub?.move_time) ?? '—'],
      [t('trackingV2.payment'), (own ? ['paid', 'escrow', 'released'].includes(own.payment_status) : pub?.paid) ? t('trackingV2.paid') : t('trackingV2.notPaid')],
    ];
    if (own) {
      rows.push([t('trackingV2.from'), own.pickup_address ?? '—'], [t('trackingV2.to'), own.dropoff_address ?? '—']);
      const price = Number(own.final_price ?? own.price_estimate);
      if (Number.isFinite(price) && price > 0) rows.push([t('trackingV2.total'), `${price.toLocaleString(locale, { maximumFractionDigits: 0 })} NOK`]);
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, pub, ref, lang]);

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#17212E]">
      {/* ── Search ─────────────────────────────────────────────── */}
      <section className="bg-[#1F3A2E] text-[#F3F6F5] pt-12 pb-14">
        <div className="max-w-3xl mx-auto px-5">
          <p className="text-xs font-bold tracking-[.16em] uppercase text-[#A7D3BA] mb-3">{t('trackingV2.eyebrow')}</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight text-[#FFFFFF] mb-3">{t('trackingV2.title')}</h1>
          <p className="text-[#D5DDD7] mb-7 max-w-[60ch]">{t('trackingV2.lede')}</p>
          <form className="flex flex-col sm:flex-row gap-2" onSubmit={e => { e.preventDefault(); void lookup(query); }}>
            <label htmlFor="track-ref" className="sr-only">{t('trackingV2.refLabel')}</label>
            <input id="track-ref" value={query} onChange={e => setQuery(e.target.value)} placeholder="FG-7K3M9Q" autoComplete="off" autoCapitalize="characters"
                   className="flex-1 min-h-[52px] px-4 bg-white text-[#17212E] text-[17px] tracking-wide border border-transparent outline-none focus:ring-2 focus:ring-[#A7D3BA]" />
            <button type="submit" disabled={loading} className={`min-h-[52px] px-7 bg-white hover:bg-[#E6EEE9] text-[#17212E] font-bold disabled:opacity-60 ${focus}`}>
              {loading ? t('trackingV2.searching') : t('trackingV2.track')}
            </button>
          </form>
          <p className="text-[13px] text-[#BFCBC3] mt-3">
            {t('trackingV2.refHint')}{' '}
            {!user && <button type="button" onClick={() => { setAuthMode('signin'); setShowAuthModal(true); }} className={`underline ${focus}`}>{t('trackingV2.signInHint')}</button>}
          </p>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-5 py-10">
        {error && <p role="alert" className="max-w-3xl mx-auto mb-6 p-4 border-s-4 border-[#A4271C] bg-[#FBEDEA] text-[#5E1610] font-semibold">{error}</p>}

        {searched && !loading && !found && !error && (
          <div className="max-w-xl mx-auto text-center py-12">
            <h2 className="text-2xl font-bold mb-2">{t('trackingV2.notFoundTitle')}</h2>
            <p className="text-[#4A5260] mb-6">{t('trackingV2.notFoundBody')}</p>
            <button type="button" onClick={() => setPage('my-bookings')} className={`min-h-[48px] px-6 bg-[#24513B] text-white font-bold ${focus}`}>{t('trackingV2.myBookings')}</button>
          </div>
        )}

        {found && (
          <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-8">
            <div className="min-w-0 space-y-6">
              {/* Status */}
              <div className="bg-[#FFFFFF] border border-[#E1E6E3] p-6 md:p-8">
                <div className="flex flex-wrap items-center gap-3 mb-1">
                  <p className="text-xs font-bold tracking-[.14em] uppercase text-[#24513B] m-0">{ref}</p>
                  {own && (
                    <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${live ? 'text-[#24513B]' : 'text-[#4A5260]'}`}>
                      <span className={`w-2 h-2 rounded-full ${live ? 'bg-[#24513B] animate-pulse' : 'bg-[#C8D0CB]'}`} aria-hidden="true" />
                      {live ? t('trackingV2.live') : t('trackingV2.refreshing')}
                    </span>
                  )}
                </div>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight m-0" aria-live="polite">{statusLabel}</h2>
                {(from || to) && <p className="text-[#4A5260] mt-2 mb-0">{from ?? '—'} → {to ?? '—'}</p>}
                {eta && (
                  <p className="mt-4 mb-0 inline-flex items-baseline gap-2 px-4 py-2 bg-[#F3F6F5] text-[15px]">
                    <b>{t(eta.to === 'pickup' ? 'trackingV2.etaPickup' : 'trackingV2.etaDropoff', { time: formatDuration(eta.minutes, lang) })}</b>
                    <span className="text-[13px] text-[#4A5260]">{eta.road ? t('trackingV2.etaNote') : t('trackingV2.etaNoteStraight')}</span>
                  </p>
                )}
                {state.cancelled && <p className="mt-3 mb-0 text-[#4A5260]">{t('trackingV2.cancelledBody', { when: time(times.cancelled_at) ?? '—' })}</p>}
                {checkedAt && <p className="mt-4 mb-0 text-[12px] text-[#4A5260]">{t('trackingV2.checked', { time: checkedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</p>}
              </div>

              {/* Map: the booking's own customer sees the road and the driver */}
              {pickup && dropoff ? (
                <Suspense fallback={<div className="h-80 bg-[#F3F6F5] border border-[#E1E6E3] animate-pulse" aria-hidden="true" />}>
                  <RouteMap pickup={pickup} dropoff={dropoff} driver={driverPos} height="h-80 md:h-[420px]"
                            pickupLabel={own?.pickup_city || undefined} dropoffLabel={own?.dropoff_city || undefined} />
                </Suspense>
              ) : (
                <div className="p-6 border border-dashed border-[#C8D0CB] bg-[#FFFFFF] text-[15px] text-[#4A5260]">
                  {t('trackingV2.mapForOwner')}
                </div>
              )}
              {own && inFlight && !driverPos && <p className="text-[13px] text-[#4A5260] -mt-3">{t('trackingV2.noDriverPos')}</p>}
            </div>

            <aside className="space-y-6">
              {/* Timeline */}
              <div className="bg-[#FFFFFF] border border-[#E1E6E3] p-6">
                <h3 className="text-xs font-bold !tracking-[.14em] uppercase text-[#4A5260] mb-5">{t('trackingV2.timeline')}</h3>
                {state.cancelled ? (
                  <p className="m-0 text-[15px]">{t('trackingV2.cancelled')}{time(times.cancelled_at) ? ` · ${time(times.cancelled_at)}` : ''}</p>
                ) : (
                  <ol className="list-none p-0 m-0">
                    {TRACKING_STEPS.map((s, i) => {
                      const done = i <= state.step, now = i === state.step;
                      const at = done ? time(stepTime(s, times)) : null;
                      return (
                        <li key={s} className="relative flex gap-4 pb-5 last:pb-0" aria-current={now ? 'step' : undefined}>
                          {i < TRACKING_STEPS.length - 1 && <span aria-hidden="true" className={`absolute start-[11px] top-6 bottom-0 w-[2px] ${i < state.step ? 'bg-[#24513B]' : 'bg-[#E1E6E3]'}`} />}
                          <span aria-hidden="true" className={`relative z-10 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                            now ? 'bg-[#24513B] text-white ring-4 ring-[#24513B]/15' : done ? 'bg-[#24513B] text-white' : 'bg-[#F3F6F5] text-[#4A5260] border border-[#C8D0CB]'}`}>{done && !now ? '✓' : i + 1}</span>
                          <div>
                            <p className={`m-0 text-[15px] ${now ? 'font-bold' : done ? 'font-semibold' : 'text-[#4A5260]'}`}>{t(`trackingV2.step.${s}`)}</p>
                            {at && <p className="m-0 text-[12px] text-[#4A5260]">{at}</p>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              {/* The booking */}
              <div className="bg-[#FFFFFF] border border-[#E1E6E3] p-6">
                <h3 className="text-xs font-bold !tracking-[.14em] uppercase text-[#4A5260] mb-4">{t('trackingV2.details')}</h3>
                <dl className="m-0 space-y-3">
                  {facts.map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 text-[14px]">
                      <dt className="text-[#4A5260]">{k}</dt><dd className="m-0 font-semibold break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
                {!own && <p className="text-[12px] text-[#4A5260] mt-4 mb-0">{t('trackingV2.publicNote')}</p>}
                <div className="flex flex-wrap gap-2 mt-5">
                  {own && <button type="button" onClick={() => setPage('my-bookings')} className={`min-h-[44px] px-4 border border-[#C8D0CB] font-semibold text-sm hover:bg-[#F3F6F5] ${focus}`}>{t('trackingV2.myBookings')}</button>}
                  <button type="button" onClick={() => setPage('contact')} className={`min-h-[44px] px-4 border border-[#C8D0CB] font-semibold text-sm hover:bg-[#F3F6F5] ${focus}`}>{t('trackingV2.help')}</button>
                </div>
              </div>
            </aside>
          </div>
        )}

        {!searched && (
          <ul className="list-none p-0 m-0 grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto pt-4">
            {(['ref', 'live', 'escrow'] as const).map(k => (
              <li key={k} className="border-t-2 border-[#24513B] pt-4">
                <h3 className="text-[17px] font-bold mb-1">{t(`trackingV2.feature.${k}`)}</h3>
                <p className="text-[14px] text-[#4A5260] m-0">{t(`trackingV2.feature.${k}Desc`)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
