/**
 * The old homepage's booking widget in the design's booking card, between
 * the hero and the first section of the platform front page (owner,
 * 2026-10-30; docs/HOMEPAGES.md). The same fields, wording and behaviour as
 * BookingWidget in HomePage.tsx: Kartverket address lookup, move type, date,
 * the route distance, Get Estimate (estimateMovePrice) and Book Now, which
 * hands everything to the booking flow. It looks like the old widget (its
 * colours, layout and height) with the design's square card corners, across
 * the design's full width (owner, 2026-10-30).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../lib/store';
import { getRouteDistance } from '../../lib/routing';
import { estimateMovePrice } from '../../lib/moveEstimate';
import NorwayAddressAutocomplete, { type NorwegianAddress } from '../NorwayAddressAutocomplete';

const MOVE_TYPES = [
  ['single-item', 'home.moveSingleItem'],
  ['student', 'home.moveStudent'],
  ['apartment', 'home.moveApartment'],
  ['house', 'home.moveHouse'],
  ['office', 'home.moveOffice'],
] as const;

export default function BookingCard() {
  const { t, i18n: { language } } = useTranslation();
  const { setPage, setBookingData } = useApp();
  const [pickup, setPickup] = useState<NorwegianAddress | null>(null);
  const [dropoff, setDropoff] = useState<NorwegianAddress | null>(null);
  const [moveType, setMoveType] = useState('apartment');
  const [moveDate, setMoveDate] = useState('');
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [estimatedPrice, setEstimatedPrice] = useState<number | null>(null);
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  /* Real driving distance and time, as the old widget gets them. */
  useEffect(() => {
    let cancelled = false;
    setDistanceKm(null);
    setDurationMinutes(null);
    if (pickup?.lat == null || pickup.lng == null || dropoff?.lat == null || dropoff.lng == null) return;
    void getRouteDistance({ lat: pickup.lat, lng: pickup.lng }, { lat: dropoff.lat, lng: dropoff.lng }).then(res => {
      if (cancelled || !res) return;
      setDistanceKm(res.distanceKm);
      setDurationMinutes(res.durationMinutes);
    });
    return () => { cancelled = true; };
  }, [pickup, dropoff]);

  const handleEstimate = () => {
    if (!pickup?.formatted || !dropoff?.formatted) return;
    setEstimatedPrice(estimateMovePrice(moveType, distanceKm));
  };

  const handleBookNow = () => {
    setBookingData({
      pickupAddress: pickup?.formatted ?? '', pickupLat: pickup?.lat ?? null, pickupLng: pickup?.lng ?? null,
      pickupPostcode: pickup?.postcode ?? '', pickupCity: pickup?.city ?? '', pickupAddressData: pickup ?? undefined,
      dropoffAddress: dropoff?.formatted ?? '', dropoffLat: dropoff?.lat ?? null, dropoffLng: dropoff?.lng ?? null,
      dropoffPostcode: dropoff?.postcode ?? '', dropoffCity: dropoff?.city ?? '', dropoffAddressData: dropoff ?? undefined,
      distanceKm, durationMinutes, moveType, moveDate, step: 2,
    });
    setPage('booking');
  };

  const nf = new Intl.NumberFormat(language === 'no' ? 'nb-NO' : 'en-GB');
  const field = 'w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm bg-white';
  const icon = 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none';
  const badges: [string, string][] = [
    [t('home.insured'), 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'],
    [t('home.twoHrMin'), 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'],
    [t('home.mvaIncl'), 'M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2-1 2 1 2-1 2 1 2-1zm0 0l2 1 2-1 2 1V6a1 1 0 00-1-1h-4'],
  ];

  /* The old widget's look (navy header, white body, navy and emerald
   * buttons, its height) with the design's square corners and full width. */
  return (
    <div className="fgp-oldcard bg-white shadow-2xl border border-gray-100">
      <div className="bg-gradient-to-r from-[#1A365D] to-[#2D4A7A] px-6 sm:px-8 py-5 flex items-center justify-between">
        <div>
          <h2 className="text-white text-xl font-bold">{t('home.quoteTitle')}</h2>
          <p className="text-white/60 text-sm mt-0.5">{t('home.quoteSubtitle')}</p>
        </div>
        <div className="hidden sm:flex items-center gap-5 text-sm text-white/70">
          {badges.map(([label, path]) => (
            <span key={label} className="flex items-center gap-1.5">
              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path}/></svg>
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="px-6 sm:px-8 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label htmlFor="fgp-pickup" className="block text-sm font-medium text-gray-700 mb-1.5">{t('home.pickup')}</label>
            <NorwayAddressAutocomplete id="fgp-pickup" value={pickup?.formatted ?? ''} onSelect={setPickup} placeholder={t('home.pickupAddress')} />
          </div>
          <div>
            <label htmlFor="fgp-dropoff" className="block text-sm font-medium text-gray-700 mb-1.5">{t('home.delivery')}</label>
            <NorwayAddressAutocomplete id="fgp-dropoff" value={dropoff?.formatted ?? ''} onSelect={setDropoff} placeholder={t('home.deliveryAddress')} />
          </div>
          <div>
            <label htmlFor="fgp-move-type" className="block text-sm font-medium text-gray-700 mb-1.5">{t('home.moveType')}</label>
            <div className="relative">
              <svg className={icon} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
              <select id="fgp-move-type" value={moveType} onChange={e => { setMoveType(e.target.value); setEstimatedPrice(null); }} className={`${field} appearance-none`}>
                {MOVE_TYPES.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="fgp-move-date" className="block text-sm font-medium text-gray-700 mb-1.5">{t('home.movingDate')}</label>
            <div className="relative">
              <svg className={icon} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
              <input id="fgp-move-date" type="date" min={today} value={moveDate} onChange={e => setMoveDate(e.target.value)} className={field} />
            </div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-between mt-5 gap-3">
          <div className="text-xs text-gray-400 min-h-[20px]" aria-live="polite">
            {distanceKm != null && durationMinutes != null && (
              <span className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full font-medium">
                📍 {distanceKm.toFixed(1)} km · {durationMinutes} min
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {estimatedPrice != null && (
              <div className="text-right mr-1" aria-live="polite">
                <div className="text-xs text-gray-400">{t('home.estFrom')}</div>
                <div className="text-xl font-bold text-[#1A365D]">{nf.format(estimatedPrice)} <span className="text-sm font-normal">{language === 'no' ? 'kr' : 'NOK'}</span></div>
              </div>
            )}
            <button type="button" onClick={handleEstimate} className="px-5 py-3 bg-[#1A365D] text-white rounded-xl font-semibold hover:bg-[#2D4A7A] transition text-sm">{t('home.getEstimate')}</button>
            <button type="button" onClick={handleBookNow} className="group px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-semibold hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/25 transition flex items-center gap-2 text-sm">
              {t('home.bookNow')}
              <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
