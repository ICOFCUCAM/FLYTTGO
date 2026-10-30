/**
 * The old homepage's booking widget in the design's booking card, between
 * the hero and the first section of the platform front page (owner,
 * 2026-10-30; docs/HOMEPAGES.md). The same fields, wording and behaviour as
 * BookingWidget in HomePage.tsx: Kartverket address lookup, move type, date,
 * the route distance, Get Estimate (estimateMovePrice) and Book Now, which
 * hands everything to the booking flow. It wears the design's card classes
 * (.booking-heading, .field, .btn), so it looks like the rest of the design.
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

  return (
    <>
      <div className="booking-heading">
        <h2>{t('home.quoteTitle')}</h2>
        <p>{t('home.quoteSubtitle')} · {t('home.insured')} · {t('home.twoHrMin')} · {t('home.mvaIncl')}</p>
      </div>
      <div className="field">
        <label htmlFor="fgp-pickup">{t('home.pickup')}</label>
        <div className="fgp-address">
          <NorwayAddressAutocomplete id="fgp-pickup" value={pickup?.formatted ?? ''} onSelect={setPickup} placeholder={t('home.pickupAddress')} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="fgp-dropoff">{t('home.delivery')}</label>
        <div className="fgp-address">
          <NorwayAddressAutocomplete id="fgp-dropoff" value={dropoff?.formatted ?? ''} onSelect={setDropoff} placeholder={t('home.deliveryAddress')} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="fgp-move-type">{t('home.moveType')}</label>
        <select id="fgp-move-type" value={moveType} onChange={e => { setMoveType(e.target.value); setEstimatedPrice(null); }}>
          {MOVE_TYPES.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="fgp-move-date">{t('home.movingDate')}</label>
        <input id="fgp-move-date" type="date" min={today} value={moveDate} onChange={e => setMoveDate(e.target.value)} />
      </div>
      <div className="fgp-booking-actions">
        <button type="button" className="btn btn-light" onClick={handleEstimate}>{t('home.getEstimate')}</button>
        <button type="button" className="btn btn-primary" onClick={handleBookNow}>{t('home.bookNow')} <span className="arrow">→</span></button>
      </div>
      <p className="booking-status" aria-live="polite" role="status">
        {distanceKm != null && durationMinutes != null && <span>📍 {distanceKm.toFixed(1)} km · {durationMinutes} min</span>}
        {estimatedPrice != null && <strong className="fgp-estimate">{t('home.estFrom')} {nf.format(estimatedPrice)} {language === 'no' ? 'kr' : 'NOK'}</strong>}
      </p>
    </>
  );
}
