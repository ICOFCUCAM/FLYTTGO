import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { HERO_SLIDES, VAN_TYPES, CITIES, TESTIMONIALS, HOW_IT_WORKS, SUBSCRIPTION_PLANS, calculateCommission } from '../lib/constants';
import NorwayAddressAutocomplete, { NorwegianAddress } from './NorwayAddressAutocomplete';
import { getRouteDistance } from '../lib/routing';

/* ── HERO SLIDER ── */
function HeroSlider() {
  const [idx, setIdx] = useState(0);
  const { setPage } = useApp();
  const { t } = useTranslation();
  useEffect(() => {
    const t = setInterval(() => setIdx(p => (p + 1) % HERO_SLIDES.length), 5000);
    return () => clearInterval(t);
  }, []);
  const slide = HERO_SLIDES[idx];

  return (
    <div className="relative h-[80vh] min-h-[560px] w-full overflow-hidden">
      {HERO_SLIDES.map((s, i) => (
        /* Hero stays eager — the carousel cycles every 5s and we want
         * every slide ready ahead of time so the cross-fade is clean. */
        <img key={i} src={s.image} alt={s.title}
          width={1920} height={1080}
          loading={i === 0 ? 'eager' : 'eager'}
          fetchPriority={i === 0 ? 'high' : 'auto'}
          decoding="async"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${i === idx ? 'opacity-100' : 'opacity-0'}`} />
      ))}
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/50 to-transparent" />
      <div className="absolute inset-0 flex items-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-emerald-600/20 backdrop-blur-sm border border-emerald-500/30 rounded-full px-4 py-1.5 mb-6">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-emerald-300 text-sm font-medium">{t('home.heroBadge')}</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4 leading-tight">
              {t(`home.slide${slide.key}Title`, slide.title)}
            </h1>
            <p className="text-lg text-gray-200 mb-8 max-w-lg">
              {t(`home.slide${slide.key}Sub`, slide.subtitle)}
            </p>
            <div className="flex flex-wrap gap-4">
              <button onClick={() => setPage('booking')}
                className="px-8 py-3.5 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition shadow-lg shadow-emerald-600/30">
                {t(`home.slide${slide.key}Cta`, slide.cta)}
              </button>
              <button onClick={() => setPage('van-guide')}
                className="px-8 py-3.5 bg-white/10 backdrop-blur-sm text-white rounded-xl font-semibold hover:bg-white/20 transition border border-white/20">
                {t('home.vanSizeGuide')}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
        {HERO_SLIDES.map((_, i) => (
          <button key={i} onClick={() => setIdx(i)}
            className={`h-3 rounded-full transition-all ${i === idx ? 'bg-emerald-500 w-8' : 'bg-white/40 hover:bg-white/60 w-3'}`} />
        ))}
      </div>
    </div>
  );
}

/* ── BOOKING WIDGET ── */

function BookingWidget() {
  const { setPage, setBookingData } = useApp();
  const { t } = useTranslation();
  /* Structured Norwegian addresses from Kartverket (same component the
   * booking flow uses). Stored as full objects so we can pass them
   * straight through to bookingData and the booking flow can pre-fill
   * its own state without forcing the customer to re-enter anything. */
  const [pickup,  setPickup]  = useState<NorwegianAddress | null>(null);
  const [dropoff, setDropoff] = useState<NorwegianAddress | null>(null);
  const [moveType, setMoveType] = useState('apartment');
  const [moveDate, setMoveDate] = useState('');
  const [distanceKm,      setDistanceKm]      = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [estimatedPrice,  setEstimatedPrice]  = useState<number | null>(null);

  /* Real driving distance + duration via the route-distance edge
   * function (OSRM). Falls back to Haversine + 70 km/h in
   * lib/routing.ts when the edge function isn't reachable, so the
   * widget never stalls on the customer. */
  useEffect(() => {
    let cancelled = false;
    if (pickup?.lat == null || pickup?.lng == null || dropoff?.lat == null || dropoff?.lng == null) {
      setDistanceKm(null);
      setDurationMinutes(null);
      return;
    }
    (async () => {
      const res = await getRouteDistance(
        { lat: pickup.lat!, lng: pickup.lng! },
        { lat: dropoff.lat!, lng: dropoff.lng! },
      );
      if (cancelled || !res) return;
      setDistanceKm(res.distanceKm);
      setDurationMinutes(res.durationMinutes);
    })();
    return () => { cancelled = true; };
  }, [pickup, dropoff]);

  const handleEstimate = () => {
    if (!pickup?.formatted || !dropoff?.formatted) return;
    const base: Record<string, number> = { 'single-item': 850, 'student': 1150, 'apartment': 1500, 'house': 2400, 'office': 3200 };
    const km = distanceKm ?? 0;
    setEstimatedPrice(Math.round((base[moveType] || 1500) + km * 12));
  };

  const handleBookNow = () => {
    setBookingData({
      /* Flat fields — preserved for backward compat with anything else
       * reading bookingData.pickupAddress as a string. */
      pickupAddress: pickup?.formatted ?? '',
      pickupLat: pickup?.lat ?? null,
      pickupLng: pickup?.lng ?? null,
      pickupPostcode: pickup?.postcode ?? '',
      pickupCity: pickup?.city ?? '',
      /* Structured field — used by BookingFlow to pre-fill its own
       * NorwegianAddress state on mount. */
      pickupAddressData: pickup ?? undefined,
      dropoffAddress: dropoff?.formatted ?? '',
      dropoffLat: dropoff?.lat ?? null,
      dropoffLng: dropoff?.lng ?? null,
      dropoffPostcode: dropoff?.postcode ?? '',
      dropoffCity: dropoff?.city ?? '',
      dropoffAddressData: dropoff ?? undefined,
      distanceKm,
      durationMinutes,
      moveType,
      moveDate,
      step: 2,
    });
    setPage('booking');
  };

  return (
    <section className="relative -mt-20 z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* No overflow-hidden on the card — the address autocomplete
       * dropdown needs to escape the card boundary. The header below
       * gets explicit rounded-t-2xl so the corners still look right. */}
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100">
        <div className="bg-gradient-to-r from-[#1A365D] to-[#2D4A7A] rounded-t-2xl px-6 sm:px-8 py-5 flex items-center justify-between">
          <div>
            <h2 className="text-white text-xl font-bold">{t('home.quoteTitle')}</h2>
            <p className="text-white/60 text-sm mt-0.5">{t('home.quoteSubtitle')}</p>
          </div>
          <div className="hidden sm:flex items-center gap-5 text-sm text-white/70">
            {[[t('home.insured'), 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'],
               [t('home.twoHrMin'), 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'],
               [t('home.mvaIncl'), 'M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2-1 2 1 2-1 2 1 2-1zm0 0l2 1 2-1 2 1V6a1 1 0 00-1-1h-4']].map(([label, path]) => (
              <span key={label} className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path}/></svg>
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="px-6 sm:px-8 py-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('home.pickup')}</label>
              <NorwayAddressAutocomplete
                value={pickup?.formatted ?? ''}
                onSelect={setPickup}
                placeholder={t('home.pickupAddress')}
                id="home-pickup"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('home.delivery')}</label>
              <NorwayAddressAutocomplete
                value={dropoff?.formatted ?? ''}
                onSelect={setDropoff}
                placeholder={t('home.deliveryAddress')}
                id="home-dropoff"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('home.moveType')}</label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                <select value={moveType} onChange={e => setMoveType(e.target.value)} className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm appearance-none bg-white">
                  <option value="single-item">{t('home.moveSingleItem')}</option>
                  <option value="student">{t('home.moveStudent')}</option>
                  <option value="apartment">{t('home.moveApartment')}</option>
                  <option value="house">{t('home.moveHouse')}</option>
                  <option value="office">{t('home.moveOffice')}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('home.movingDate')}</label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                <input type="date" value={moveDate} onChange={e => setMoveDate(e.target.value)} className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm"/>
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between mt-5 gap-3">
            <div className="text-xs text-gray-400 min-h-[20px]">
              {distanceKm && durationMinutes && (
                <span className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full font-medium">
                  📍 {distanceKm.toFixed(1)} km · {durationMinutes} min drive
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {estimatedPrice && (
                <div className="text-right mr-1">
                  <div className="text-xs text-gray-400">{t('home.estFrom')}</div>
                  <div className="text-xl font-bold text-[#1A365D]">{estimatedPrice.toLocaleString()} <span className="text-sm font-normal">NOK</span></div>
                </div>
              )}
              <button onClick={handleEstimate} className="px-5 py-3 bg-[#1A365D] text-white rounded-xl font-semibold hover:bg-[#2D4A7A] transition text-sm">{t('home.getEstimate')}</button>
              <button onClick={handleBookNow} className="group px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-semibold hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/25 transition flex items-center gap-2 text-sm">
                {t('home.bookNow')}
                <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── TRUST BAR ──
 * Sits between the booking widget and the stats section. It's the
 * first thing the customer sees after the hero, so it does the heavy
 * lifting on perceived legitimacy. */
function TrustBar() {
  const { t } = useTranslation();
  const items = [
    { icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
      title: t('home.trustVerifiedTitle'),
      desc:  t('home.trustVerifiedDesc') },
    { icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
      title: t('home.trustEscrowTitle'),
      desc:  t('home.trustEscrowDesc') },
    { icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
      title: t('home.trustInsuredTitle'),
      desc:  t('home.trustInsuredDesc') },
    { icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
      title: t('home.trustRegisteredTitle'),
      desc:  t('home.trustRegisteredDesc') },
  ];

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-10">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {items.map(item => (
          <div key={item.title} className="flex items-start gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3 shadow-sm">
            <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 leading-tight">{item.title}</div>
              <div className="text-xs text-gray-500 mt-0.5 leading-snug">{item.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── STATS ── */
function StatsSection() {
  const { t } = useTranslation();
  return (
    <section className="py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {[{ value: '25,000+', label: t('home.statDeliveries') }, { value: '560+', label: t('home.statDrivers') }, { value: '4.8/5', label: t('home.statRating') }, { value: '15+', label: t('home.statCities') }].map(s => (
            <div key={s.label} className="text-center">
              <p className="text-3xl sm:text-4xl font-bold text-emerald-600 mb-1">{s.value}</p>
              <p className="text-sm text-gray-600">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 mt-8 pt-5 flex flex-wrap justify-center gap-6 text-xs text-gray-400">
          {[[t('home.badgeVerifiedDrivers'), 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'],
             [t('home.badgeSecurePay'), 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'],
             [t('home.badgeDispute'), 'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3'],
             [t('home.badgeChatOnly'), 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z']].map(([label, path]) => (
            <span key={label} className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path}/></svg>
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── SERVICES SECTION ── */
function ServicesSection() {
  const { setPage } = useApp();
  const { t } = useTranslation();
  const services = [
    { nameKey: 'serviceMoving',    descKey: 'serviceMovingDesc',    image: 'https://d64gsuwffb70l.cloudfront.net/69b1b470fdd1af7483a60acc_1773254153053_d6599513.jpg', iconPath: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { nameKey: 'serviceFurniture', descKey: 'serviceFurnitureDesc', image: 'https://d64gsuwffb70l.cloudfront.net/69b1b470fdd1af7483a60acc_1773254286622_a82a1d1b.jpg', iconPath: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
    { nameKey: 'serviceOffice',    descKey: 'serviceOfficeDesc',    image: 'https://d64gsuwffb70l.cloudfront.net/69b4405628b40c8fdc7aad59_1773420953628_819790d3.png', iconPath: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
    { nameKey: 'serviceSameDay',   descKey: 'serviceSameDayDesc',   image: 'https://d64gsuwffb70l.cloudfront.net/69b1b470fdd1af7483a60acc_1773254193383_798495ed.jpg', iconPath: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { nameKey: 'serviceStudent',   descKey: 'serviceStudentDesc',   image: 'https://d64gsuwffb70l.cloudfront.net/69b1b470fdd1af7483a60acc_1773254266530_893474f8.jpg', iconPath: 'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z' },
    { nameKey: 'serviceStorage',   descKey: 'serviceStorageDesc',   image: 'https://d64gsuwffb70l.cloudfront.net/69b1b470fdd1af7483a60acc_1773254050705_a292f56d.jpg', iconPath: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  ];

  return (
    <section id="services-section" className="py-20 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4">
        <h2 className="text-3xl font-bold text-center mb-4">{t('services.sectionTitle')}</h2>
        <p className="text-gray-600 max-w-2xl mx-auto text-lg text-center mb-12">{t('services.sectionSubtitle')}</p>
        <div className="grid md:grid-cols-3 gap-6">
          {services.map(service => (
            <div key={service.nameKey} className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:shadow-xl transition-all duration-300 group cursor-pointer" onClick={() => setPage('booking')}>
              <div className="relative h-44 overflow-hidden">
                <img src={service.image} alt={t(`home.${service.nameKey}`)} width={600} height={352} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"/>
                <div className="absolute bottom-3 left-3 w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-md">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={service.iconPath}/></svg>
                </div>
              </div>
              <div className="p-5">
                <h3 className="font-semibold text-lg mb-2">{t(`home.${service.nameKey}`)}</h3>
                <p className="text-gray-600 text-sm">{t(`home.${service.descKey}`)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── HOW IT WORKS ── */
function HowItWorks() {
  const { t } = useTranslation();
  return (
    <section className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">{t('home.howTitle')}</h2>
          <p className="text-lg text-gray-600">{t('home.howSubtitle')}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {HOW_IT_WORKS.map(item => (
            <div key={item.step} className="text-center">
              <div className="w-16 h-16 bg-emerald-600 rounded-2xl flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4 shadow-lg shadow-emerald-600/30">{item.step}</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{t(`home.how${item.step}Title`, item.title)}</h3>
              <p className="text-sm text-gray-600">{t(`home.how${item.step}Desc`, item.description)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── VAN TYPES ── */
function VanTypesSection() {
  const { setPage } = useApp();
  const { t } = useTranslation();
  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">{t('home.vanSectionTitle')}</h2>
          <p className="text-lg text-gray-600">{t('home.vanSectionSub')}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {VAN_TYPES.map(van => (
            <div key={van.id} className="bg-white rounded-xl overflow-hidden border border-gray-100 hover:shadow-xl transition group">
              <div className="aspect-[4/3] overflow-hidden">
                <img src={van.image} alt={van.name} width={600} height={450} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition duration-500"/>
              </div>
              <div className="p-5">
                <h3 className="text-lg font-bold text-gray-900 mb-1">{van.name}</h3>
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                  <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">{van.capacity}</span>
                  <span>{van.payload}</span>
                </div>
                <p className="text-sm text-gray-600 mb-3">{t('home.vanBestFor')}: {van.bestFor.join(', ')}</p>
                <p className="text-sm font-semibold text-gray-900 mb-3">{t('home.vanFrom')} {van.pricePerHour} NOK{t('home.vanPerHour')}</p>
                <button onClick={() => setPage('booking')} className="w-full py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition text-sm">{t('home.vanBook')} {van.name}</button>
              </div>
            </div>
          ))}
        </div>
        <div className="text-center mt-8">
          <button onClick={() => setPage('van-guide')} className="px-6 py-3 border-2 border-emerald-600 text-emerald-600 rounded-xl font-semibold hover:bg-emerald-50 transition">{t('home.vanCalcCta')}</button>
        </div>
      </div>
    </section>
  );
}

/* ── MOVING TOOLS ── */
function MovingToolsSection() {
  const { setPage } = useApp();
  const { t } = useTranslation();
  const tools = [
    { icon: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z', title: t('home.toolCalcTitle'), desc: t('home.toolCalcDesc'), cta: t('home.toolCalcCta'), page: 'van-guide' as const, badge: t('home.toolCalcBadge'), color: 'bg-emerald-600' },
    { icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01', title: t('home.toolCheckTitle'), desc: t('home.toolCheckDesc'), cta: t('home.toolCheckCta'), page: 'checklist' as const, badge: t('home.toolCheckBadge'), color: 'bg-[#1A365D]' },
    { icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', title: t('home.toolGuideTitle'), desc: t('home.toolGuideDesc'), cta: t('home.toolGuideCta'), page: 'van-guide' as const, badge: t('home.toolGuideBadge'), color: 'bg-purple-600' },
  ];
  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">{t('home.toolsBadge')}</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1A365D] mb-4">{t('home.toolsTitle')}</h2>
          <p className="text-gray-600 max-w-2xl mx-auto text-lg">{t('home.toolsSubtitle')}</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-6">
          {tools.map(tool => (
            <div key={tool.title} className="group relative bg-gray-50 rounded-2xl p-7 border border-gray-100 hover:border-emerald-200 hover:shadow-xl transition-all duration-300">
              <div className={`w-12 h-12 ${tool.color} rounded-xl flex items-center justify-center mb-5`}>
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tool.icon}/></svg>
              </div>
              <span className="absolute top-5 right-5 text-xs font-semibold bg-white border border-gray-200 text-gray-500 px-2.5 py-1 rounded-full">{tool.badge}</span>
              <h3 className="text-lg font-bold text-[#1A365D] mb-2">{tool.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed mb-6">{tool.desc}</p>
              <button onClick={() => setPage(tool.page)} className="flex items-center gap-2 text-sm font-semibold text-emerald-600 group-hover:gap-3 transition-all">
                {tool.cta}
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── CITIES ── */
function CitiesSection() {
  const { setPage } = useApp();
  const { t } = useTranslation();
  return (
    <section className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">{t('home.citiesSectionTitle')}</h2>
          <p className="text-lg text-gray-600">{t('home.citiesSectionSub')}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {CITIES.map(city => (
            <button key={city.slug} onClick={() => setPage('booking')} className="relative rounded-xl overflow-hidden group aspect-[4/3]">
              <img src={city.image} alt={city.name} width={600} height={450} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-110 transition duration-700"/>
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"/>
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <h3 className="text-xl font-bold text-white mb-1">{t('home.cityMovingHelp')} {city.name}</h3>
                <div className="flex items-center gap-3 text-sm text-gray-200">
                  <span>{city.drivers} {t('home.cityDrivers')}</span>
                  <span>{city.bookings} {t('home.cityBookings')}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── TESTIMONIALS ── */
function TestimonialsSection() {
  const { t } = useTranslation();
  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">{t('home.testimonialsTitle')}</h2>
          <p className="text-lg text-gray-600">{t('home.testimonialsSub')}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {TESTIMONIALS.map((item, i) => (
            <div key={i} className="bg-white rounded-xl p-6 border border-gray-100">
              <div className="flex gap-1 mb-3">
                {[...Array(5)].map((_, j) => (
                  <svg key={j} className={`w-5 h-5 ${j < item.rating ? 'text-amber-400' : 'text-gray-200'}`} fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                  </svg>
                ))}
              </div>
              <p className="text-sm text-gray-600 mb-4">"{t(`home.testimonial${i}`, item.text)}"</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-700 font-semibold text-sm">{item.name[0]}</div>
                <div><p className="text-sm font-semibold text-gray-900">{item.name}</p><p className="text-xs text-gray-500">{item.city}</p></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── SUBSCRIPTION TEASER ── */
function SubscriptionTeaser() {
  const { setPage, setShowAuthModal, setAuthMode } = useApp();
  const { user, profile } = useAuth();
  const { t } = useTranslation();

  const handlePlanClick = () => {
    if (!user) { setAuthMode('driver-signup'); setShowAuthModal(true); return; }
    if (profile?.role === 'driver') { setPage('subscriptions'); return; }
  };

  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">{t('home.subTeaserBadge')}</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1A365D] mb-4">{t('home.subTeaserTitle')}</h2>
          <p className="text-gray-600 max-w-2xl mx-auto text-lg">{t('home.subTeaserSubtitle')}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-start">
          {SUBSCRIPTION_PLANS.map(plan => (
            <div key={plan.id} className={`relative bg-white rounded-2xl p-5 flex flex-col transition-all ${plan.popular ? 'border-2 border-emerald-500 shadow-xl scale-[1.03] z-10' : 'border border-gray-200 shadow-sm hover:shadow-md'}`}>
              {plan.popular && <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-full tracking-wide whitespace-nowrap">MOST POPULAR</div>}
              <h3 className="text-lg font-bold text-gray-900 mt-1 mb-1">{plan.name}</h3>
              <div className="mb-3"><span className="text-3xl font-bold text-gray-900">{plan.price}</span><span className="text-gray-500 text-sm ml-1">NOK{plan.period}</span></div>
              <div className={`inline-flex self-start px-2.5 py-1 rounded-full text-xs font-medium mb-4 ${plan.priorityLevel >= 4 ? 'bg-purple-50 text-purple-600 border border-purple-200' : plan.priorityLevel >= 3 ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : plan.priorityLevel >= 2 ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-gray-100 text-gray-600'}`}>
                {plan.dispatchPriority} Priority
              </div>
              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <svg className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button onClick={handlePlanClick} className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${plan.popular ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                {!user ? (plan.price === 0 ? t('home.subTeaserRegister') : t('home.subTeaserApply')) : profile?.role === 'driver' ? (plan.price === 0 ? t('home.subTeaserRegister') : t('home.subTeaserApply')) : t('home.subTeaserApply')}
              </button>
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-gray-400 mt-8">{t('home.subTeaserAllPlans')} · {t('home.subTeaserNoFees')} · {t('home.subTeaserCancel')}</p>
      </div>
    </section>
  );
}

/* ── CORPORATE CTA ── */
function CorporateCTA() {
  const { setPage, setShowAuthModal, setAuthMode } = useApp();
  const { t } = useTranslation();
  const features = [
    { icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', titleKey: 'corpBulk', descKey: 'corpBulkDesc' },
    { icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', titleKey: 'corpRecurring', descKey: 'corpRecurringDesc' },
    { icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', titleKey: 'corpAnalytics', descKey: 'corpAnalyticsDesc' },
    { icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z', titleKey: 'corpInvoice', descKey: 'corpInvoiceDesc' },
    { icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4', titleKey: 'corpApi', descKey: 'corpApiDesc' },
    { icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', titleKey: 'corpMultiUser', descKey: 'corpMultiUserDesc' },
  ];
  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-[#1A365D]/10 text-[#1A365D] text-sm font-semibold px-4 py-1.5 rounded-full mb-6">{t('home.corpBadge')}</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#1A365D] mb-4">{t('home.corpTitle')}</h2>
            <p className="text-gray-600 text-lg mb-8 leading-relaxed">{t('home.corpSubtitle')}</p>
            <div className="grid sm:grid-cols-2 gap-4 mb-10">
              {features.map(f => (
                <div key={f.titleKey} className="flex items-start gap-3">
                  <div className="w-9 h-9 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={f.icon}/></svg>
                  </div>
                  <div><div className="text-sm font-semibold text-gray-900">{t(`home.${f.titleKey}`)}</div><div className="text-xs text-gray-500 mt-0.5 leading-relaxed">{t(`home.${f.descKey}`)}</div></div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => { setAuthMode('signup'); setShowAuthModal(true); }} className="px-7 py-3 bg-[#1A365D] text-white rounded-xl font-semibold hover:bg-[#2D4A7A] transition shadow-lg">{t('home.corpCreateAccount')}</button>
              <button onClick={() => setPage('customer-dashboard')} className="px-7 py-3 border-2 border-[#1A365D] text-[#1A365D] rounded-xl font-semibold hover:bg-[#1A365D]/5 transition">{t('home.corpViewDashboard')}</button>
            </div>
          </div>
          <div className="bg-gradient-to-br from-[#1A365D] to-[#2D4A7A] rounded-3xl p-8 text-white">
            <h3 className="text-xl font-bold mb-6">{t('home.corpWhyTitle')}</h3>
            <div className="grid grid-cols-2 gap-6 mb-8">
              {[{ value: '40%', labelKey: 'corpStat1' }, { value: '560+', labelKey: 'corpStat2' }, { value: '< 30s', labelKey: 'corpStat3' }, { value: '99.2%', labelKey: 'corpStat4' }].map(s => (
                <div key={s.labelKey} className="bg-white/10 rounded-2xl p-4">
                  <div className="text-2xl font-bold text-emerald-400 mb-1">{s.value}</div>
                  <div className="text-xs text-white/70 leading-snug">{t(`home.${s.labelKey}`)}</div>
                </div>
              ))}
            </div>
            <div className="border-t border-white/20 pt-6 space-y-3">
              {['corpNoContracts', 'corpAccountMgr', 'corpPriorityDispatch', 'corpRealtime'].map(key => (
                <div key={key} className="flex items-center gap-2.5 text-sm text-white/80">
                  <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                  {t(`home.${key}`)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── DRIVER CTA ── */
function DriverCTA() {
  const { setShowAuthModal, setAuthMode } = useApp();
  const { t } = useTranslation();
  const features = [
    t('home.driverFeature1'),
    t('home.driverFeature2'),
    t('home.driverFeature3'),
    t('home.driverFeature4'),
    t('home.driverFeature5'),
  ];
  return (
    <section className="py-20 bg-gradient-to-r from-emerald-700 to-emerald-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">{t('home.driverCtaTitle')}</h2>
            <p className="text-lg text-emerald-100 mb-6">{t('home.driverCtaSubtitle')}</p>
            <ul className="space-y-3 mb-8">
              {features.map(f => (
                <li key={f} className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-emerald-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button onClick={() => { setAuthMode('driver-signup'); setShowAuthModal(true); }} className="px-8 py-3.5 bg-white text-emerald-700 rounded-xl font-semibold hover:bg-emerald-50 transition shadow-lg">{t('home.applyNow')}</button>
          </div>
          <div>
            <img src="https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766976394_04c23eab.jpg" alt="FlyttGo Driver" width={800} height={800} loading="lazy" decoding="async" className="rounded-2xl shadow-2xl w-full"/>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── HOME PAGE ── */
export default function HomePage() {
  return (
    <div>
      <HeroSlider />
      <BookingWidget />
      <TrustBar />
      <StatsSection />
      <ServicesSection />
      <HowItWorks />
      <VanTypesSection />
      <MovingToolsSection />
      <CitiesSection />
      <TestimonialsSection />
      <SubscriptionTeaser />
      <CorporateCTA />
      <DriverCTA />
    </div>
  );
}
