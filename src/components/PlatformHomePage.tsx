/**
 * FlyttGo's front page on flyttgo.no (docs/HOMEPAGES.md): the owner's premium
 * design (docs/flyttgo-premium-platform-homepage-stage-20.html, generated into
 * ./platformHome by scripts/platform-home/build.py), looking as designed with
 * its own card structure, and the old site's functions wired in beneath it
 * (owner, 2026-10-30):
 *   - FlyttGo's own menu bar (AppLayout) in place of the design's header,
 *     with the design's items as its Platform dropdown and square corners;
 *   - hero: the old site's pictures as a slideshow;
 *   - between the hero and the first section: the old booking widget in the
 *     design's booking card (BookingCard: address lookup, estimate, Book Now);
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
import { SUBSCRIPTION_PLANS, VAN_TYPES } from '../lib/constants';
import HeroSlides from './platformHome/HeroSlides';
import BookingCard from './platformHome/BookingCard';
import designEn from './platformHome/design.html?raw';
import designNo from './platformHome/design.no.html?raw';
import { initDesign as initEn } from './platformHome/design-scripts';
import { initDesign as initNo } from './platformHome/design-scripts.no';
import './platformHome/design.css';
import './platformHome/app.css';

/* The design in the visitor's language: English, or its Bokmål (scripts/platform-home/no.json). */
const VERSIONS = {
  en: { html: designEn, init: initEn, currency: 'NOK', locale: 'en-GB' },
  no: { html: designNo, init: initNo, currency: 'kr', locale: 'nb-NO' },
} as const;

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

type Places = { root: HTMLElement; hero: { el: HTMLElement; alt: string } | null; booking: HTMLElement | null };

export default function PlatformHomePage() {
  const { setPage, setShowAuthModal, setAuthMode, setBookingData } = useApp();
  const { user, profile } = useAuth();
  const { i18n: { language } } = useTranslation();
  const version = VERSIONS[language === 'no' ? 'no' : 'en'];
  const root = useRef<HTMLDivElement>(null);
  const [places, setPlaces] = useState<Places | null>(null);
  useDesignFonts();

  /* The latest values for the handlers attached once to the design's markup. */
  const live = useRef({ user, profile });
  live.current = { user, profile };

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
    setPlaces({ root: el, hero, booking: el.querySelector('[data-slot="booking"]') });
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

    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey); };
  }, [version, setPage, setShowAuthModal, setAuthMode, setBookingData]);

  return (
    <>
      <div key={language} ref={root} className="fgp" lang={language === 'no' ? 'nb' : 'en'} dangerouslySetInnerHTML={{ __html: version.html }} />
      {places?.hero && createPortal(<HeroSlides alt={places.hero.alt} />, places.hero.el)}
      {places?.booking && createPortal(<BookingCard />, places.booking)}
    </>
  );
}
