/**
 * FlyttGo's front page on flyttgo.no (docs/HOMEPAGES.md): the owner's premium
 * platform design (docs/flyttgo-premium-platform-homepage-stage-20.html,
 * generated into ./platformHome by scripts/platform-home/build.py) with
 * everything the former homepage had (owner, 2026-10-30):
 *   - FlyttGo's own menu bar and footer (AppLayout), in place of the design's;
 *   - the former slideshow in the design's hero picture;
 *   - the former booking widget (address lookup, instant price estimate)
 *     and its sections (trust bar, stats, services, how it works, van types,
 *     moving tools, cities, testimonials, driver plans, corporate and driver
 *     calls to action), each in the slot the design keeps for it;
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
import designEn from './platformHome/design.html?raw';
import designNo from './platformHome/design.no.html?raw';
import { initDesign as initEn } from './platformHome/design-scripts';
import { initDesign as initNo } from './platformHome/design-scripts.no';
import './platformHome/design.css';
import './platformHome/app.css';

/* The design in the visitor's language: English, or its Bokmål (scripts/platform-home/no.json). */
const VERSIONS = { en: { html: designEn, init: initEn }, no: { html: designNo, init: initNo } } as const;

/* The former homepage's sections, each in the slot the design keeps for it
 * (SLOTS in scripts/platform-home/build.py). */
const SECTIONS: Record<string, () => React.ReactElement> = {
  booking: () => <div className="pt-24"><BookingWidget /></div>,
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
  const { setPage, setShowAuthModal, setAuthMode } = useApp();
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
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [version, setPage, setShowAuthModal, setAuthMode]);

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
