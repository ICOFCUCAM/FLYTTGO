/**
 * FlyttGo's front page on flyttgo.no (docs/HOMEPAGES.md): the owner's premium
 * platform design (docs/flyttgo-premium-platform-homepage-stage-20.html,
 * generated into ./platformHome by scripts/platform-home/build.py) with
 * everything the former homepage had (owner, 2026-10-30):
 *   - the design's header as designed, with FlyttGo's own menu bar (all its
 *     items, sign-in, language, notifications) wired in directly under it; the
 *     design's Sign in / Get started open the sign-in dialog, or the dashboard
 *     once signed in; FlyttGo's footer in place of the design's;
 *   - the former slideshow in the design's hero picture;
 *   - the design's skeleton kept whole, with the former booking widget
 *     (address lookup, instant price estimate) and sections (trust bar,
 *     stats, services, how it works, van types, moving tools, cities,
 *     testimonials, driver plans, corporate and driver calls to action) each
 *     wired in under the design section it belongs with; the design's own
 *     service form leads to the booking flow;
 *   - the design's other sections as designed, in navy, emerald and white,
 *     in English or Bokmål with the site's language;
 *   - every design link marked data-page opens that FlyttGo page.
 * The moving and transport front page (HomePage) is also kept whole on
 * transport.flyttgo.no and at /transport. The design's styles are scoped
 * under .fgp, so nothing outside the page changes.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useApp, type Page } from '../lib/store';
import { useAuth } from '../lib/auth';
import { transportUrl } from '../lib/hosts';
import { HERO_SLIDES } from '../lib/constants';
import {
  BookingWidget, CitiesSection, CorporateCTA, DriverCTA, HowItWorks, MovingToolsSection, ServicesSection,
  StatsSection, SubscriptionTeaser, TestimonialsSection, TrustBar, VanTypesSection,
} from './HomePage';
import Header from './Header';
import designEn from './platformHome/design.html?raw';
import designNo from './platformHome/design.no.html?raw';
import { initDesign as initEn } from './platformHome/design-scripts';
import { initDesign as initNo } from './platformHome/design-scripts.no';
import './platformHome/design.css';
import './platformHome/app.css';

/* The design in the visitor's language: English, or its Bokmål (scripts/platform-home/no.json). */
const VERSIONS = {
  en: { html: designEn, init: initEn, signIn: 'Sign in', dashboard: 'Dashboard',
        noFrom: 'Enter where you are moving from to continue.', pastDate: 'Choose today or a future date.' },
  no: { html: designNo, init: initNo, signIn: 'Logg inn', dashboard: 'Min side',
        noFrom: 'Skriv inn hvor du flytter fra for å fortsette.', pastDate: 'Velg i dag eller en senere dato.' },
} as const;

/* The former homepage's sections, each in the slot the design keeps for it
 * (SLOTS in scripts/platform-home/build.py). */
const SECTIONS: Record<string, () => React.ReactElement> = {
  menubar: () => <Header />,
  booking: () => <div className="pt-24 pb-4"><BookingWidget /></div>,
  stats: () => <><TrustBar /><StatsSection /></>,
  services: () => <ServicesSection />,
  how: () => <HowItWorks />,
  vans: () => <VanTypesSection />,
  tools: () => <MovingToolsSection />,
  cities: () => <CitiesSection />,
  testimonials: () => <TestimonialsSection />,
  subscriptions: () => <SubscriptionTeaser />,
  corporate: () => <CorporateCTA />,
  driver: () => <DriverCTA />,
};

/* The hero picture is the former homepage's slideshow, with the design's own
 * picture first; the design's caption and card stay over it. */
function HeroSlides({ first, alt }: { first: string; alt: string }) {
  const [images] = useState(() => [first, ...new Set(HERO_SLIDES.map(s => s.image))]);
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

export default function PlatformHomePage() {
  const { setPage, setShowAuthModal, setAuthMode, setBookingData } = useApp();
  const { user, profile } = useAuth();
  const { i18n: { language } } = useTranslation();
  const version = VERSIONS[language === 'no' ? 'no' : 'en'];
  const root = useRef<HTMLDivElement>(null);
  const [sections, setSections] = useState<{ name: string; el: HTMLElement }[]>([]);
  const [hero, setHero] = useState<{ el: HTMLElement; src: string; alt: string } | null>(null);
  useDesignFonts();

  /* The latest values for the handler attached once to the design's markup. */
  const live = useRef({ user, profile });
  live.current = { user, profile };

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    setSections(Array.from(el.querySelectorAll<HTMLElement>('[data-slot]')).map(s => ({ name: s.dataset.slot!, el: s })));
    const picture = el.querySelector<HTMLImageElement>('.hero-visual > img');
    if (picture) {
      const holder = document.createElement('div');
      picture.replaceWith(holder);
      setHero({ el: holder, src: picture.src, alt: picture.alt });
    }
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
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-page]');
      if (!a || !el.contains(a)) return;
      e.preventDefault();
      open(a.dataset.page!);
    };
    /* The design's "Looking for a service?" form, as designed, leads to the
     * real pages: moving and transport to the booking flow with what was
     * typed (the booking widget under it has the address lookup and price). */
    const onSubmit = (e: Event) => {
      if ((e.target as HTMLElement).id !== 'booking-form') return;
      e.preventDefault();
      const value = (id: string) => el.querySelector<HTMLInputElement>(`#${id}`)?.value.trim() ?? '';
      const say = (m: string) => { const st = el.querySelector('#booking-status'); if (st) st.textContent = m; };
      const service = el.querySelector<HTMLSelectElement>('#service')?.selectedIndex ?? 0;
      if (service === 2 || service === 3) { setPage('services'); return; }
      if (service === 4) { setPage('corporate'); return; }
      if (service === 5) { el.querySelector('#business-platform')?.scrollIntoView({ behavior: 'smooth' }); return; }
      const from = value('from'), to = value('to'), date = value('date');
      if (!from) { say(version.noFrom); return; }
      const min = el.querySelector<HTMLInputElement>('#date')?.min ?? '';
      if (date && min && date < min) { say(version.pastDate); return; }
      setBookingData({ pickupAddress: from, dropoffAddress: to, ...(date ? { moveDate: date } : {}) });
      setPage('booking');
    };
    el.addEventListener('click', onClick);
    el.addEventListener('submit', onSubmit);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('submit', onSubmit); };
  }, [version, setPage, setShowAuthModal, setAuthMode, setBookingData]);

  /* Signed in, the design's Sign in link leads to the dashboard. */
  useEffect(() => {
    const signIn = root.current?.querySelector<HTMLElement>('[data-page="auth:signin"]');
    if (signIn) signIn.textContent = user ? version.dashboard : version.signIn;
  }, [user, version]);

  return (
    <>
      <div key={language} ref={root} className="fgp" lang={language === 'no' ? 'nb' : 'en'} dangerouslySetInnerHTML={{ __html: version.html }} />
      {hero && createPortal(<HeroSlides first={hero.src} alt={hero.alt} />, hero.el)}
      {sections.map(({ name, el }) => {
        const Section = SECTIONS[name];
        return Section ? createPortal(<Section />, el, name) : null;
      })}
    </>
  );
}
