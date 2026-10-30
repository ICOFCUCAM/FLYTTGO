/**
 * FlyttGo's front page on flyttgo.no: the owner's premium platform design
 * (docs/flyttgo-premium-platform-homepage-stage-20.html), shown as designed
 * (its markup, styles and scripts, generated into ./platformHome by
 * scripts/platform-home/build.py) with FlyttGo's own footer, and wired to the
 * app (docs/HOMEPAGES.md):
 *   - every link marked data-page opens that page; Sign in / Get started open
 *     the sign-in dialog, or the dashboard once signed in;
 *   - "Looking for a service?" uses the real address lookup and hands the
 *     addresses and date to the booking flow, as the moving page's widget does;
 *   - English or Bokmål follows the site's language (its switch is in the header);
 *   - the moving and transport front page (HomePage) is kept whole on
 *     transport.flyttgo.no and at /transport.
 * The design's styles are scoped under .fgp, so nothing outside the page changes.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp, type Page } from '../lib/store';
import { useAuth } from '../lib/auth';
import { transportUrl } from '../lib/hosts';
import NorwayAddressAutocomplete, { type NorwegianAddress } from './NorwayAddressAutocomplete';
import { useTranslation } from 'react-i18next';
import i18n, { LANG_STORAGE_KEY } from '../lib/i18n';
import designEn from './platformHome/design.html?raw';
import designNo from './platformHome/design.no.html?raw';
import { initDesign as initEn } from './platformHome/design-scripts';
import { initDesign as initNo } from './platformHome/design-scripts.no';
import './platformHome/design.css';
import './platformHome/app.css';

/* The page in the visitor's language: the design's English, or its Bokmål
 * (scripts/platform-home/no.json). */
const VERSIONS = {
  en: { html: designEn, init: initEn, words: {
    signIn: 'Sign in', dashboard: 'Dashboard', from: 'Enter your location', to: 'Enter destination',
    noFrom: 'Choose your pick-up address from the list to continue.', noTo: 'Choose the delivery address from the list to continue.',
    pastDate: 'Choose today or a future date.' } },
  no: { html: designNo, init: initNo, words: {
    signIn: 'Logg inn', dashboard: 'Min side', from: 'Skriv inn adressen din', to: 'Skriv inn leveringsadresse',
    noFrom: 'Velg henteadressen fra listen for å fortsette.', noTo: 'Velg leveringsadressen fra listen for å fortsette.',
    pastDate: 'Velg i dag eller en senere dato.' } },
} as const;

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

/** Replaces one of the design's address inputs with the real address lookup. */
function addressSlot(root: HTMLElement, id: string): HTMLElement | null {
  const input = root.querySelector<HTMLInputElement>(`input#${id}`);
  const field = input?.parentElement;
  if (!input || !field) return null;
  const slot = document.createElement('div');
  slot.className = 'fgp-address';
  field.replaceChild(slot, input);
  return slot;
}

export default function PlatformHomePage() {
  const { setPage, setBookingData, setShowAuthModal, setAuthMode } = useApp();
  const { user, profile } = useAuth();
  const { i18n: { language } } = useTranslation();
  const version = VERSIONS[language === 'no' ? 'no' : 'en'];
  const root = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<{ from: HTMLElement | null; to: HTMLElement | null }>({ from: null, to: null });
  const [pickup, setPickup] = useState<NorwegianAddress | null>(null);
  const [dropoff, setDropoff] = useState<NorwegianAddress | null>(null);
  useDesignFonts();

  /* The latest values for the handlers attached once to the design's markup. */
  const live = useRef({ user, profile, pickup, dropoff, words: version.words });
  live.current = { user, profile, pickup, dropoff, words: version.words };

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    setSlots({ from: addressSlot(el, 'from'), to: addressSlot(el, 'to') });
    version.init();

    const dashboard = (): Page => {
      const role = live.current.profile?.role;
      return role === 'admin' ? 'admin' : role === 'driver' ? 'driver-portal' : 'customer-dashboard';
    };
    const open = (target: string) => {
      if (target === 'auth:signin' || target === 'auth:signup') {
        if (live.current.user) { setPage(dashboard()); return; }
        setAuthMode(target === 'auth:signin' ? 'signin' : 'signup');
        setShowAuthModal(true);
        return;
      }
      if (target === 'transport-home') {
        const url = transportUrl();
        if (!url.startsWith('/')) { window.location.href = url; return; }
      }
      setPage(target as Page);
    };
    const onClick = (e: MouseEvent) => {
      /* The language switch, as FlyttGo's header does it. */
      const lang = (e.target as HTMLElement).closest<HTMLElement>('[data-lang]');
      if (lang && el.contains(lang)) {
        const l = lang.dataset.lang === 'no' ? 'no' : 'en';
        void i18n.changeLanguage(l);
        try { window.localStorage.setItem(LANG_STORAGE_KEY, l); } catch { /* private mode */ }
        return;
      }
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-page]');
      if (!a || !el.contains(a)) return;
      e.preventDefault();
      open(a.dataset.page!);
    };

    /* "Looking for a service?": moving and transport go to the booking flow
     * with the addresses and date, as the moving page's widget does; the
     * other choices open the page that serves them. */
    const onSubmit = (e: Event) => {
      if ((e.target as HTMLElement).id !== 'booking-form') return;
      e.preventDefault();
      const status = el.querySelector<HTMLElement>('#booking-status');
      const service = el.querySelector<HTMLSelectElement>('#service')?.selectedIndex ?? 0;
      const date = el.querySelector<HTMLInputElement>('#date')?.value ?? '';
      const say = (m: string) => { if (status) status.textContent = m; };
      if (service === 2 || service === 3) { setPage('services'); return; }
      if (service === 4) { setPage('corporate'); return; }
      if (service === 5) { el.querySelector('#business-platform')?.scrollIntoView({ behavior: 'smooth' }); return; }
      const { pickup: from, dropoff: to } = live.current;
      const w = live.current.words;
      if (!from) { say(w.noFrom); return; }
      if (!to) { say(w.noTo); return; }
      const min = el.querySelector<HTMLInputElement>('#date')?.min ?? '';
      if (date && min && date < min) { say(live.current.words.pastDate); return; }
      setBookingData({
        pickupAddress: from.formatted, pickupLat: from.lat ?? null, pickupLng: from.lng ?? null,
        pickupPostcode: from.postcode, pickupCity: from.city, pickupAddressData: from,
        dropoffAddress: to.formatted, dropoffLat: to.lat ?? null, dropoffLng: to.lng ?? null,
        dropoffPostcode: to.postcode, dropoffCity: to.city, dropoffAddressData: to,
        ...(date ? { moveDate: date } : {}),
      });
      setPage('booking');
    };
    el.addEventListener('click', onClick);
    el.addEventListener('submit', onSubmit);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('submit', onSubmit); };
  }, [version, setPage, setBookingData, setShowAuthModal, setAuthMode]);

  /* Signed in, the design's Sign in link leads to the dashboard. */
  useEffect(() => {
    const signIn = root.current?.querySelector<HTMLElement>('[data-page="auth:signin"]');
    if (signIn) signIn.textContent = user ? version.words.dashboard : version.words.signIn;
  }, [user, version]);

  return (
    <>
      <div key={language} ref={root} className="fgp" lang={language === 'no' ? 'nb' : 'en'} dangerouslySetInnerHTML={{ __html: version.html }} />
      {slots.from && createPortal(
        <NorwayAddressAutocomplete id="from" value={pickup?.formatted ?? ''} onSelect={setPickup} placeholder={version.words.from} required />,
        slots.from)}
      {slots.to && createPortal(
        <NorwayAddressAutocomplete id="to" value={dropoff?.formatted ?? ''} onSelect={setDropoff} placeholder={version.words.to} />,
        slots.to)}
    </>
  );
}
