/**
 * FlyttGo's front page on flyttgo.no (docs/HOMEPAGES.md): the owner's premium
 * design (docs/flyttgo-premium-platform-homepage-stage-20.html, generated into
 * ./platformHome by scripts/platform-home/build.py), looking as designed with
 * its own card structure, and the old site's functions wired in beneath it
 * (owner, 2026-10-30):
 *   - header: the old menus inside the design's header (HeaderExtras);
 *   - hero: the old site's pictures as a slideshow;
 *   - "Looking for a service?": the old booking widget's working parts in
 *     the design's form (Kartverket address lookup, instant price, booking
 *     flow with everything filled in);
 *   - van types and driver plans read the site's live data; every card and
 *     button leads to its real page (WIRES below);
 *   - FlyttGo's own footer (AppLayout); navy, emerald and white; English or
 *     Bokmål with the site's language.
 * The moving and transport front page (HomePage) is kept whole on
 * transport.flyttgo.no and at /transport. The design's styles are scoped
 * under .fgp, so nothing outside the page changes.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useApp, type Page } from '../lib/store';
import { useAuth } from '../lib/auth';
import { transportUrl } from '../lib/hosts';
import { HERO_SLIDES, SUBSCRIPTION_PLANS, VAN_TYPES } from '../lib/constants';
import { getRouteDistance } from '../lib/routing';
import { estimateMovePrice } from '../lib/moveEstimate';
import NorwayAddressAutocomplete, { type NorwegianAddress } from './NorwayAddressAutocomplete';
import HeaderExtras from './platformHome/HeaderExtras';
import designEn from './platformHome/design.html?raw';
import designNo from './platformHome/design.no.html?raw';
import { initDesign as initEn } from './platformHome/design-scripts';
import { initDesign as initNo } from './platformHome/design-scripts.no';
import './platformHome/design.css';
import './platformHome/app.css';

/* The design in the visitor's language: English, or its Bokmål (scripts/platform-home/no.json). */
const VERSIONS = {
  en: { html: designEn, init: initEn, currency: 'NOK', locale: 'en-GB', from: 'Enter your location', to: 'Enter destination',
        noFrom: 'Choose your pick-up address from the list to continue.', noTo: 'Choose the delivery address from the list to continue.',
        pastDate: 'Choose today or a future date.', estimate: (kr: string) => `Estimated from ${kr} incl. MVA. The booking confirms the price.` },
  no: { html: designNo, init: initNo, currency: 'kr', locale: 'nb-NO', from: 'Skriv inn adressen din', to: 'Skriv inn leveringsadresse',
        noFrom: 'Velg henteadressen fra listen for å fortsette.', noTo: 'Velg leveringsadressen fra listen for å fortsette.',
        pastDate: 'Velg i dag eller en senere dato.', estimate: (kr: string) => `Estimert fra ${kr} inkl. MVA. Bestillingen bekrefter prisen.` },
} as const;

/* The design's "I need" choices, in order, and what each does. */
const NEEDS: ({ moveType: string } | { page: Page } | { scroll: string })[] = [
  { moveType: 'apartment' },          // Moving & relocation
  { moveType: 'single-item' },        // Transport & delivery
  { page: 'services' },               // Electrician or plumbing service
  { page: 'services' },               // Home and local services
  { page: 'corporate' },              // Business booking / company logistics
  { scroll: '#business-platform' },   // Explore business tools
];

/* The design's cards and buttons, in the design's order, and the page each opens. */
const WIRES: { selector: string; target: (i: number) => string }[] = [
  { selector: '#moving-services .service-card', target: () => 'booking' },
  { selector: '#van-types .fleet-card', target: i => `van:${VAN_TYPES[i]?.id ?? ''}` },
  { selector: '#driver-plans .plan-card', target: () => 'subscriptions' },
  { selector: '#cities .city-card', target: () => 'booking' },
  { selector: '#moving-tools .tool-card', target: i => ['van-guide', 'checklist', 'van-guide'][i] ?? 'van-guide' },
  { selector: '#how-it-works .step-card', target: i => (i === 3 ? 'tracking' : 'booking') },
  { selector: '#driver-network .btn', target: () => 'driver-onboarding' },
  { selector: '#corporate-benefits .benefit', target: i => ['bulk-booking', 'recurring-deliveries', 'company-dashboard-info', 'invoice-billing', 'corporate-api-access', 'corporate-dashboard'][i] ?? 'corporate' },
];

/** Marks the design's cards and buttons with the page they open, and makes cards usable by keyboard. */
function wireCards(el: HTMLElement) {
  for (const { selector, target } of WIRES) {
    el.querySelectorAll<HTMLElement>(selector).forEach((card, i) => {
      if (card.dataset.page) return;
      card.dataset.page = target(i);
      if (card.tagName !== 'A' && card.tagName !== 'BUTTON') {
        card.setAttribute('role', 'link');
        card.tabIndex = 0;
        card.style.cursor = 'pointer';
      }
    });
  }
}

/** The design's van prices and driver plan prices, from the site's live data. */
function liveData(el: HTMLElement, currency: string, locale: string) {
  const nf = new Intl.NumberFormat(locale);
  const setLead = (node: Element | null, text: string) => {
    const first = node?.firstChild;
    if (first && first.nodeType === Node.TEXT_NODE) first.textContent = text;
  };
  el.querySelectorAll('#van-types .fleet-card').forEach((card, i) => {
    const van = VAN_TYPES[i];
    if (van) setLead(card.querySelector('.price-from'), `${nf.format(van.pricePerHour)} ${currency} `);
  });
  el.querySelectorAll('#driver-plans .plan-card').forEach((card, i) => {
    const plan = SUBSCRIPTION_PLANS[i];
    if (plan) setLead(card.querySelector('.plan-price'), `${nf.format(plan.price)} `);
  });
}

/* The hero picture is the old site's slideshow; the design's caption and card stay over it. */
function HeroSlides({ alt }: { alt: string }) {
  const [images] = useState(() => [...new Set(HERO_SLIDES.map(s => s.image))]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setI(n => (n + 1) % images.length), 5000);
    return () => window.clearInterval(t);
  }, [images.length]);
  return (
    <>
      <div className="fgp-slides">
        {images.map((src, n) => <img key={src} src={src} alt={n === 0 ? alt : ''} className={n === i ? 'on' : ''} loading={n === 0 ? 'eager' : 'lazy'} />)}
      </div>
      <div className="fgp-dots" role="group" aria-label="Slides">
        {images.map((src, n) => (
          <button key={src} type="button" aria-label={`${n + 1} / ${images.length}`} aria-pressed={n === i}
            className={n === i ? 'on' : ''} onClick={() => setI(n)} />
        ))}
      </div>
    </>
  );
}

const FONTS = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap';

/** The design's typefaces, loaded only while the page is shown. */
function useDesignFonts() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONTS;
    document.head.appendChild(link);
  }, []);
}

/** Replaces one of the design's address inputs with the real address lookup, in the same field. */
function addressSlot(root: HTMLElement, id: string): HTMLElement | null {
  const input = root.querySelector<HTMLInputElement>(`input#${id}`);
  const field = input?.parentElement;
  if (!input || !field) return null;
  const slot = document.createElement('div');
  slot.className = 'fgp-address';
  field.replaceChild(slot, input);
  return slot;
}

type Places = { root: HTMLElement; hero: { el: HTMLElement; alt: string } | null; from: HTMLElement | null; to: HTMLElement | null; header: HTMLElement | null };

export default function PlatformHomePage() {
  const { setPage, setShowAuthModal, setAuthMode, setBookingData } = useApp();
  const { user, profile } = useAuth();
  const { i18n: { language } } = useTranslation();
  const version = VERSIONS[language === 'no' ? 'no' : 'en'];
  const root = useRef<HTMLDivElement>(null);
  const [places, setPlaces] = useState<Places | null>(null);
  const [pickup, setPickup] = useState<NorwegianAddress | null>(null);
  const [dropoff, setDropoff] = useState<NorwegianAddress | null>(null);
  const [route, setRoute] = useState<{ distanceKm: number; durationMinutes: number } | null>(null);
  useDesignFonts();

  /* The latest values for the handlers attached once to the design's markup. */
  const live = useRef({ user, profile, pickup, dropoff, route, version });
  live.current = { user, profile, pickup, dropoff, route, version };

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const picture = el.querySelector<HTMLImageElement>('.hero-visual > img');
    let hero: Places['hero'] = null;
    if (picture) {
      const holder = document.createElement('div');
      picture.replaceWith(holder);
      hero = { el: holder, alt: picture.alt };
    }
    setPlaces({ root: el, hero, from: addressSlot(el, 'from'), to: addressSlot(el, 'to'), header: el.querySelector('[data-slot="header"]') });
    version.init();
    wireCards(el);
    liveData(el, version.currency, version.locale);

    const dashboard = (): Page => {
      const role = live.current.profile?.role;
      return role === 'admin' ? 'admin' : role === 'driver' ? 'driver-portal' : 'customer-dashboard';
    };
    const open = (target: string) => {
      if (target === 'auth:signin' || target === 'auth:signup') {
        if (live.current.user) { setPage(target === 'auth:signup' ? 'booking' : dashboard()); return; }
        setAuthMode(target === 'auth:signin' ? 'signin' : 'signup');
        setShowAuthModal(true);
        return;
      }
      if (target.startsWith('van:')) { setBookingData({ vanType: target.slice(4) }); setPage('booking'); return; }
      if (target === 'transport-home') {
        const url = transportUrl();
        if (!url.startsWith('/')) { window.location.href = url; return; }
      }
      setPage(target as Page);
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-page]');
      if (!a || !el.contains(a)) return;
      e.preventDefault();
      open(a.dataset.page!);
    };
    const onKey = (e: KeyboardEvent) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[role="link"][data-page]');
      if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(card.dataset.page!); }
    };

    /* "Looking for a service?": the old booking widget's hand-off, from the design's form. */
    const onSubmit = (e: Event) => {
      if ((e.target as HTMLElement).id !== 'booking-form') return;
      e.preventDefault();
      const { pickup: from, dropoff: to, route: r, version: v } = live.current;
      const say = (m: string) => { const st = el.querySelector('#booking-status'); if (st) st.textContent = m; };
      const need = NEEDS[el.querySelector<HTMLSelectElement>('#service')?.selectedIndex ?? 0] ?? NEEDS[0];
      if ('page' in need) { setPage(need.page); return; }
      if ('scroll' in need) { el.querySelector(need.scroll)?.scrollIntoView({ behavior: 'smooth' }); return; }
      if (!from) { say(v.noFrom); return; }
      if (!to) { say(v.noTo); return; }
      const dateInput = el.querySelector<HTMLInputElement>('#date');
      const date = dateInput?.value ?? '';
      if (date && dateInput?.min && date < dateInput.min) { say(v.pastDate); return; }
      setBookingData({
        pickupAddress: from.formatted, pickupLat: from.lat ?? null, pickupLng: from.lng ?? null,
        pickupPostcode: from.postcode, pickupCity: from.city, pickupAddressData: from,
        dropoffAddress: to.formatted, dropoffLat: to.lat ?? null, dropoffLng: to.lng ?? null,
        dropoffPostcode: to.postcode, dropoffCity: to.city, dropoffAddressData: to,
        distanceKm: r?.distanceKm ?? null, durationMinutes: r?.durationMinutes ?? null,
        moveType: need.moveType, moveDate: date, step: 2,
      });
      setPage('booking');
    };
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    el.addEventListener('submit', onSubmit);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey); el.removeEventListener('submit', onSubmit); };
  }, [version, setPage, setShowAuthModal, setAuthMode, setBookingData]);

  /* The driving distance, as the old booking widget gets it (route-distance, with a straight-line fallback). */
  useEffect(() => {
    let cancelled = false;
    setRoute(null);
    if (pickup?.lat == null || pickup.lng == null || dropoff?.lat == null || dropoff.lng == null) return;
    void getRouteDistance({ lat: pickup.lat, lng: pickup.lng }, { lat: dropoff.lat, lng: dropoff.lng })
      .then(r => { if (!cancelled && r) setRoute({ distanceKm: r.distanceKm, durationMinutes: r.durationMinutes }); });
    return () => { cancelled = true; };
  }, [pickup, dropoff]);

  /* The instant price on the design's status line, once both addresses are chosen. */
  useEffect(() => {
    const el = places?.root;
    const status = el?.querySelector('#booking-status');
    if (!el || !status) return;
    if (!pickup || !dropoff) { status.textContent = ''; return; }
    const need = NEEDS[el.querySelector<HTMLSelectElement>('#service')?.selectedIndex ?? 0];
    const moveType = need && 'moveType' in need ? need.moveType : 'apartment';
    const kr = new Intl.NumberFormat(version.locale).format(estimateMovePrice(moveType, route?.distanceKm));
    status.textContent = version.estimate(`${kr} ${version.currency}`);
  }, [places, pickup, dropoff, route, version]);

  return (
    <>
      <div key={language} ref={root} className="fgp" lang={language === 'no' ? 'nb' : 'en'} dangerouslySetInnerHTML={{ __html: version.html }} />
      {places?.hero && createPortal(<HeroSlides alt={places.hero.alt} />, places.hero.el)}
      {places?.header && createPortal(<HeaderExtras root={places.root} />, places.header)}
      {places?.from && createPortal(
        <NorwayAddressAutocomplete id="from" value={pickup?.formatted ?? ''} onSelect={setPickup} placeholder={version.from} required />,
        places.from)}
      {places?.to && createPortal(
        <NorwayAddressAutocomplete id="to" value={dropoff?.formatted ?? ''} onSelect={setDropoff} placeholder={version.to} />,
        places.to)}
    </>
  );
}
