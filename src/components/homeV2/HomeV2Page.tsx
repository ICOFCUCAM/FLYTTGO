/**
 * The restructured FlyttGo homepage, under review at /preview/home
 * (docs/HOMEPAGE_RESTRUCTURE.md). Built from the owner's own design, upgraded,
 * not replaced: scripts/platform-home/build.py takes the strongest section of
 * each topic from docs/flyttgo-premium-platform-homepage-stage-20.html, in the
 * twelve-section order, corrects wording the code does not support, and writes
 * design.v2(.no).html and design.v2.css here. This page renders it with the
 * design's own scripts, wires its cards and buttons to real pages, plays the
 * former homepage's slideshow in the hero picture, adds the real booking
 * widget between the hero and the first section, and fills the business and
 * financial workspaces with one example company's records (demoRecords.ts). FlyttGo's menu bar and footer
 * come from AppLayout. It replaces nothing until the owner approves it.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useApp, type Page } from '../../lib/store';
import { useAuth } from '../../lib/auth';
import { isProductionHost, transportUrl } from '../../lib/hosts';
import BookingCard from '../platformHome/BookingCard';
import HeroSlides from '../platformHome/HeroSlides';
import designEn from './design.v2.html?raw';
import designNo from './design.v2.no.html?raw';
import { initDesign as initEn } from '../platformHome/design-scripts';
import { initDesign as initNo } from '../platformHome/design-scripts.no';
import { installDemoRecords } from './demoRecords';
import { installStudio } from './studioPreview';
import { applyDesign, DEFAULT_TOKENS, DEFAULT_VARIANTS, googleFontsHref } from './design.config';
import './design.v2.css';
import './homeV2.css';

const VERSIONS = { en: { html: designEn, init: initEn }, no: { html: designNo, init: initNo } } as const;


/* The design's cards and buttons, in the design's order, and the page each opens. */
const WIRES: { selector: string; target: (i: number) => string }[] = [
  { selector: '#moving-services .service-card', target: () => 'booking' },
  { selector: '#van-types .fleet-card', target: () => 'van-guide' },          // the rates live there
  { selector: '#how-it-works .step-card', target: i => (i === 3 ? 'tracking' : 'booking') },
  { selector: '#driver-network .btn', target: () => 'driver-onboarding' },
];

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

/* The design lab (/preview/lab) frames this page with ?lab=1 and sends trial settings; never on a production host. */
const labFrame = () => typeof window !== 'undefined' && window.parent !== window
  && new URLSearchParams(window.location.search).get('lab') === '1' && !isProductionHost(window.location.hostname);

/* Section entrances: added once, only when motion is on and the visitor has not asked for less. */
function installMotion(el: HTMLElement) {
  if (!('IntersectionObserver' in window)) return () => {};
  const targets = el.querySelectorAll<HTMLElement>('main > section:not(.hero)');
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('v2-in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
  targets.forEach(t => { t.classList.add('v2-reveal'); io.observe(t); });
  return () => io.disconnect();
}

/* The selected typefaces (design.config.ts). */
const FONTS = googleFontsHref([DEFAULT_TOKENS.fontDisplay, DEFAULT_TOKENS.fontBody, DEFAULT_TOKENS.fontAccent]);

export default function HomeV2Page() {
  const { setPage, setShowAuthModal, setAuthMode } = useApp();
  const { user, profile } = useAuth();
  const { i18n: { language } } = useTranslation();
  const version = VERSIONS[language === 'no' ? 'no' : 'en'];
  const root = useRef<HTMLDivElement>(null);
  const [booking, setBooking] = useState<HTMLElement | null>(null);
  const [hero, setHero] = useState<{ el: HTMLElement; alt: string } | null>(null);
  const live = useRef({ user, profile });
  live.current = { user, profile };

  /* A page under review: not for search engines. The design's typefaces. */
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const before = meta?.content ?? null;
    if (!meta) { meta = document.createElement('meta'); meta.name = 'robots'; document.head.appendChild(meta); }
    meta.content = 'noindex, nofollow';
    if (!document.querySelector(`link[href="${FONTS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = FONTS;
      document.head.appendChild(link);
    }
    return () => { if (before === null) meta?.remove(); else if (meta) meta.content = before; };
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    setBooking(el.querySelector<HTMLElement>('[data-slot="booking"]'));
    /* The hero picture becomes the former homepage's slideshow, as on the platform page. */
    const picture = el.querySelector<HTMLImageElement>('.hero-visual > img');
    if (picture) {
      const holder = document.createElement('div');
      holder.className = 'hero-photo';
      picture.replaceWith(holder);
      setHero({ el: holder, alt: picture.alt });
    }
    applyDesign(el, DEFAULT_TOKENS, DEFAULT_VARIANTS);
    version.init();
    const lang = language === 'no' ? 'no' : 'en';
    const removeRecords = installDemoRecords(el, lang);
    const removeStudio = installStudio(el, lang);
    const removeMotion = installMotion(el);
    wireCards(el);

    /* Framed by the Design Refinement Studio: its probe (lab/probe.ts) is loaded only then. */
    let removeProbe = () => {};
    let mounted = true;
    if (labFrame()) void import('./lab/probe').then(m => { if (mounted) removeProbe = m.installProbe(el); });

    const open = (target: string) => {
      if (target === 'auth:signin' || target === 'auth:signup') {
        const role = live.current.profile?.role;
        if (live.current.user) { setPage(role === 'admin' ? 'admin' : role === 'driver' ? 'driver-portal' : 'customer-dashboard'); return; }
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
    const onKey = (e: KeyboardEvent) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[role="link"][data-page]');
      if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(card.dataset.page!); }
    };
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey); removeRecords(); removeStudio(); removeMotion(); mounted = false; removeProbe(); };
  }, [version, language, setPage, setShowAuthModal, setAuthMode]);

  return (
    <>
      <div key={language} ref={root} className="fgv2" lang={language === 'no' ? 'nb' : 'en'} dangerouslySetInnerHTML={{ __html: version.html }} />
      {hero && createPortal(<HeroSlides alt={hero.alt} />, hero.el)}
      {booking && createPortal(<BookingCard />, booking)}
    </>
  );
}
