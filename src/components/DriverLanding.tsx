/**
 * /become-a-driver with the new design (lib/siteDesign.ts), redesigned as one recruitment page (owner,
 * 31 October 2026): a hero with the route to the application, a section bar, how joining works, what a
 * driver gets, the plans compared (SUBSCRIPTION_PLANS, the same list as /driver-subscriptions), what is
 * needed to apply (the application's own vehicle sizes, documents and cities), the company steps and
 * price checker (DriverGrowth) and the application itself (driver/DriverApplicationForm). Nothing here
 * states a figure or promise the platform does not hold.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import { SUBSCRIPTION_PLANS } from '../lib/constants';
import DriverGrowth from './DriverGrowth';
import DriverApplicationForm, { type ApplicationProgress } from './driver/DriverApplicationForm';
import { DayOnFlyttGo, DriverFaq, EscrowFlow, FleetSection, PlanPicker, TermsSummary } from './driver/LandingParts';
import './driver/driverPage.css';
import { APPLICATION_CITIES, DOCUMENT_TYPES, VEHICLE_TYPES } from './driver/applicationData';

const HERO = 'https://d64gsuwffb70l.cloudfront.net/69b48d1c24a3a59014dde38a_1773440407421_d3f9f76f.jpg';
const CREW = 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766976394_04c23eab.jpg';
const PRIORITY_NO: Record<string, string> = { Standard: 'Standard', Moderate: 'Moderat', High: 'Høy', 'Very High': 'Svært høy', Highest: 'Høyest' };
const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24513B]';
const serif = { fontFamily: 'Georgia, "Times New Roman", serif' };

type Plan = (typeof SUBSCRIPTION_PLANS)[number];
const SECTIONS = ['process', 'day', 'benefits', 'plans', 'payments', 'requirements', 'terms', 'faq', 'companies'] as const;

export default function DriverLanding() {
  const { t, i18n } = useTranslation();
  const { setPage } = useApp();
  const no = i18n.language === 'no';
  const nok = (n: number) => `${n.toLocaleString(no ? 'nb-NO' : 'en-GB')} NOK`;

  const price = (p: Plan) => p.price === 0 ? nok(0)
    : `${nok(p.price)} ${p.period === '/day' ? t('driverLanding.perDay') : t('driverLanding.perMonth')}`;
  const jobs = (p: Plan) => {
    const m = /up to (\d+)/i.exec(p.jobVisibility);
    return m ? t('driverLanding.jobsUpTo', { amount: nok(Number(m[1])) }) : t('driverLanding.allJobs');
  };
  const level = (p: Plan) => no ? (PRIORITY_NO[p.dispatchPriority] ?? p.dispatchPriority) : p.dispatchPriority;
  const commission = (p: Plan) => {
    const rates = Object.values(p.commission as Record<string, number>);
    const lo = Math.min(...rates), hi = Math.max(...rates);
    return t('driverLanding.commission', { range: lo === hi ? `${lo}%` : `${lo}–${hi}%` });
  };
  const go = (id: string) => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
  const toForm = () => go('driver-application');

  /* Driver or transport company (item 13): the hero speaks to the one chosen; companies see their section first. */
  const [audience, setAudience] = useState<'driver' | 'company'>('driver');
  const titleA = audience === 'driver' ? t('driverLanding.heroTitleA') : t('driverLanding.audience.companyTitleA');
  const titleB = audience === 'driver' ? t('driverLanding.heroTitleB') : t('driverLanding.audience.companyTitleB');
  /* A city chosen in the ribbon is filled into the application (item 3); the form reports its progress for the sticky bar (item 4). */
  const [presetCity, setPresetCity] = useState<string | null>(null);
  const [progress, setProgress] = useState<ApplicationProgress>({ step: 1, started: false, submitted: false });
  const onProgress = useCallback((p: ApplicationProgress) => setProgress(p), []);
  const applyLabel = progress.submitted ? t('driverLanding.applySent') : progress.started ? t('driverLanding.applyContinue', { n: progress.step }) : t('driverLanding.apply');

  /* Sections come in gently as they reach the screen (item 20); off under reduced motion (driverPage.css). */
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.fg-driver-page .fg-reveal'));
    if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('fg-in')); return; }
    const io = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('fg-in'); io.unobserve(e.target); } }),
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    els.forEach(e => io.observe(e));
    return () => io.disconnect();
  }, [audience]);

  /* The hero's three facts, read from the application and the plan list. */
  const free = SUBSCRIPTION_PLANS[0];
  const freeRate = Math.max(...Object.values(free.commission as Record<string, number>));
  const freeUpTo = /up to (\d+)/i.exec(free.jobVisibility)?.[1];
  const facts: [string, string][] = [
    ['4', t('driverLanding.factStepsLabel')],
    [nok(free.price), t('driverLanding.factFreeLabel', { plan: free.name })],
    ...(freeUpTo ? [[`${freeRate}%`, t('driverLanding.factRateLabel', { plan: free.name, amount: nok(Number(freeUpTo)) })] as [string, string]] : []),
  ];

  /* The section bar marks the section in view. */
  const [active, setActive] = useState<string>('');
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
    }, { rootMargin: '-45% 0px -50% 0px' });
    [...SECTIONS, 'driver-application'].forEach(id => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);

  const meter = (n: number) => (
    <span className="inline-flex gap-[3px] align-middle" aria-hidden="true">
      {[1, 2, 3, 4, 5].map(i => <span key={i} className={`w-[6px] h-[14px] ${i <= n ? 'bg-[#24513B]' : 'bg-[#DCD4C2]'}`} />)}
    </span>
  );

  /* ── For transport companies (first for companies, item 13) ── */
  const companiesSection = (
      <section id="companies" className="fg-reveal scroll-mt-32 py-20 md:py-28">
        <div className="max-w-[1240px] mx-auto px-5 md:px-10">
          <FleetSection onCompany={() => setPage('corporate-dashboard')} />
          <div className="h-20 md:h-28" aria-hidden="true" />
          <DriverGrowth intro={{ title: t('driverLanding.companyTitle'), text: t('driverLanding.companyText') }} />
        </div>
      </section>
  );

  return (
    <div className="fg-driver-page bg-[#FBF8F1] text-[#17212E]">
      {/* ── Hero: full screen, the van on the road, the headline word by word (items 1–2) ── */}
      <section className="relative overflow-hidden min-h-[min(820px,calc(100vh-64px))] flex items-end bg-[#1F3A2E] text-white">
        <img src={HERO} alt={t('driverLanding.heroAlt')} className="fg-hero-photo absolute inset-0 w-full h-full object-cover" fetchPriority="high" decoding="async" />
        <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(90deg,rgba(23,40,32,.94)_0%,rgba(23,40,32,.78)_42%,rgba(23,40,32,.18)_75%,rgba(23,40,32,.05)_100%)]" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[rgba(23,40,32,.7)] to-transparent" />
        <div aria-hidden="true" className="lg:hidden absolute inset-0 bg-[rgba(23,40,32,.55)]" />
        <div className="relative z-10 w-full max-w-[1440px] mx-auto px-5 md:px-10 lg:px-16 xl:px-24 pt-16 pb-14 md:pb-20">
          {/* Who this is for: a driver or a transport company (item 13) */}
          <div role="radiogroup" aria-label={t('driverLanding.audience.label')} className="inline-flex border border-white/30 bg-black/15 backdrop-blur mb-9">
            {(['driver', 'company'] as const).map(a => (
              <button key={a} type="button" role="radio" aria-checked={audience === a} onClick={() => setAudience(a)}
                      className={`min-h-[44px] px-5 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DCC9A0] ${audience === a ? 'bg-[#FFFEFA] text-[#17212E]' : 'text-white hover:bg-white/10'}`}>
                {t(`driverLanding.audience.${a}`)}
              </button>
            ))}
          </div>
          <p className="flex items-center gap-3 text-xs font-bold tracking-[.18em] uppercase text-[#DCC9A0] mb-6">
            <span className="w-8 h-px bg-[#C3A66C]" aria-hidden="true" />{audience === 'driver' ? t('driverLanding.eyebrow') : t('driverLanding.grow.eyebrow')}
          </p>
          <h1 key={audience} className="text-[46px] sm:text-[64px] xl:text-[92px] font-bold tracking-[-.045em] leading-[.95] mb-7 max-w-[12ch] text-[#FFFEFA]" aria-label={titleA + ' ' + titleB}>
            {titleA.split(' ').map((w, i) => <span key={`a${i}`} aria-hidden="true" className="fg-word me-[.25em]" style={{ animationDelay: `${120 + i * 110}ms` }}>{w}</span>)}
            <span aria-hidden="true" className="font-normal italic text-[#DCC9A0]" style={serif}>
              {titleB.split(' ').map((w, i, arr) => <span key={`b${i}`} className={`fg-word ${i < arr.length - 1 ? 'me-[.25em]' : ''}`} style={{ animationDelay: `${120 + (titleA.split(' ').length + i) * 110}ms` }}>{w}</span>)}
            </span>
          </h1>
          <p className="text-lg md:text-xl leading-relaxed text-[#E3E9E5] max-w-[52ch] mb-9">{audience === 'driver' ? t('driverLanding.lede') : t('driverLanding.grow.lede')}</p>
          <div className="flex flex-wrap gap-3 mb-12">
            <button type="button" onClick={toForm} className="min-h-[56px] px-8 bg-[#C3A66C] hover:bg-[#D2B87F] text-[#17212E] font-bold text-[16px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DCC9A0]">{t('driverLanding.apply')} ↓</button>
            <button type="button" onClick={() => go(audience === 'driver' ? 'plans' : 'companies')} className="min-h-[56px] px-7 border border-white/50 text-white font-bold hover:bg-white/10 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DCC9A0]">
              {audience === 'driver' ? t('driverLanding.compare') : t('driverLanding.audience.companyCta')}
            </button>
          </div>
          <dl className="grid grid-cols-3 gap-0 border-t border-white/25 m-0 max-w-[600px]">
            {facts.map(([value, label], i) => (
              <div key={label} className={`flex flex-col-reverse justify-end pt-5 ${i ? 'ps-4 sm:ps-5 border-s border-white/25' : ''} pe-3`}>
                <dt className="text-[13px] leading-snug text-[#D5DDD7]">{label}</dt>
                <dd className="m-0 text-[24px] sm:text-[30px] md:text-[36px] leading-none text-[#FFFEFA] mb-2" style={serif}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Cities open for applications: each one starts the application there (item 3) ── */}
      <div className="bg-[#FFFEFA] border-b border-[#E2DACA]">
        <div className="max-w-[1240px] mx-auto px-5 md:px-10 py-4 flex items-center gap-3 overflow-x-auto [scrollbar-width:none]">
          <span className="flex-shrink-0 text-xs font-bold tracking-[.14em] uppercase text-[#7A6436] me-2">{t('driverLanding.citiesTitle')}</span>
          {APPLICATION_CITIES.map(c => (
            <button key={c} type="button" onClick={() => { setPresetCity(c); toForm(); }}
                    className={`flex-shrink-0 min-h-[40px] px-4 border border-[#DCD4C2] bg-white text-sm font-semibold hover:border-[#24513B] hover:text-[#24513B] transition ${focus}`}
                    aria-label={t('driverLanding.cityApply', { city: c })}>{c}</button>
          ))}
        </div>
      </div>

      {audience === 'company' && companiesSection}

      {/* ── Section bar ────────────────────────────────────────────── */}
      <nav aria-label={t('driverLanding.navLabel')} className="sticky top-16 z-40 bg-[#FBF8F1]/95 backdrop-blur border-y border-[#E2DACA]">
        <div className="max-w-[1240px] mx-auto px-5 md:px-10 flex items-center gap-3">
          <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {SECTIONS.map(id => (
              <a key={id} href={`#${id}`} onClick={e => { e.preventDefault(); go(id); }} aria-current={active === id ? 'true' : undefined}
                 className={`relative whitespace-nowrap px-3 py-4 text-sm font-semibold transition ${focus} ${active === id ? 'text-[#17212E]' : 'text-[#4A5260] hover:text-[#17212E]'}`}>
                {t(`driverLanding.nav.${id}`)}
                <span aria-hidden="true" className={`absolute inset-x-3 bottom-0 h-[2px] ${active === id ? 'bg-[#C3A66C]' : 'bg-transparent'}`} />
              </a>
            ))}
          </div>
          {progress.started && !progress.submitted && <span className="hidden 2xl:inline whitespace-nowrap text-[13px] text-[#4A5260]">{t('driverLanding.applyProgress', { n: progress.step })}</span>}
          <button type="button" onClick={toForm} className={`flex-shrink-0 whitespace-nowrap my-2 min-h-[40px] px-4 bg-[#24513B] hover:bg-[#1C4130] text-white text-sm font-bold ${focus}`}>{applyLabel}</button>
        </div>
      </nav>

      {/* ── How joining works ─────────────────────────────────────── */}
      <section id="process" className="fg-reveal scroll-mt-32 py-20 md:py-28">
        <div className="max-w-[1240px] mx-auto px-5 md:px-10">
          <div className="grid lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] gap-6 lg:gap-16 items-end mb-14">
            <h2 className="text-[36px] md:text-[52px] font-bold tracking-[-.04em] leading-[1.02] m-0">{t('driverLanding.processTitle')}</h2>
            <p className="text-lg text-[#4A5260] leading-relaxed m-0 max-w-[56ch]">{t('driverLanding.processLede')}</p>
          </div>
          <ol className="list-none p-0 m-0 grid sm:grid-cols-2 lg:grid-cols-4 border-t border-[#17212E]">
            {[1, 2, 3, 4].map(i => (
              <li key={i} className={`relative pt-8 pb-2 pe-8 ${i > 1 ? 'lg:ps-8 lg:border-s border-[#E2DACA]' : ''} ${i === 3 ? 'sm:max-lg:pt-12' : ''} ${i === 4 ? 'sm:max-lg:pt-12' : ''}`}>
                <span className="block text-[64px] leading-none text-[#9F8249] mb-5" style={serif}>{i}</span>
                <h3 className="text-xl font-bold tracking-tight mb-2">{t(`driverLanding.step${i}`)}</h3>
                <p className="text-[15px] leading-relaxed text-[#4A5260] m-0">{t(`driverLanding.step${i}Desc`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── A day on FlyttGo, in the driver app's own screens (items 5, 6) ── */}
      <section id="day" className="fg-reveal scroll-mt-32 pb-20 md:pb-28">
        <div className="max-w-[1240px] mx-auto px-5 md:px-10">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 lg:gap-16 items-end mb-10">
            <div>
              <p className="text-xs font-bold tracking-[.16em] uppercase text-[#7A6436] mb-3">{t('driverLanding.day.eyebrow')}</p>
              <h2 className="text-[36px] md:text-[52px] font-bold tracking-[-.04em] leading-[1.02] m-0">{t('driverLanding.day.title')}</h2>
            </div>
            <p className="text-lg text-[#4A5260] leading-relaxed m-0 max-w-[56ch]">{t('driverLanding.day.lede')}</p>
          </div>
          <DayOnFlyttGo />
        </div>
      </section>

      {/* ── What you get ───────────────────────────────────────────── */}
      <section id="benefits" className="fg-reveal scroll-mt-32 bg-[#FFFEFA] py-20 md:py-28 border-y border-[#EDE6D6]">
        <div className="max-w-[1240px] mx-auto px-5 md:px-10 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-12 lg:gap-20 items-center">
          <div className="relative order-2 lg:order-1">
            <div className="absolute -top-5 -start-5 w-2/3 h-2/3 bg-[#E4ECE6]" aria-hidden="true" />
            <img src={CREW} alt={t('driverLanding.crewAlt')} loading="lazy" className="relative w-full aspect-[4/5] sm:aspect-[5/4] lg:aspect-[4/5] object-cover" />
          </div>
          <div className="order-1 lg:order-2">
            <p className="text-xs font-bold tracking-[.16em] uppercase text-[#7A6436] mb-3">{t('driverLanding.benefitsEyebrow')}</p>
            <h2 className="text-[36px] md:text-[48px] font-bold tracking-[-.04em] leading-[1.04] mb-10">{t('driverLanding.benefitsTitle')}</h2>
            <dl className="m-0 divide-y divide-[#E2DACA] border-y border-[#E2DACA]">
              {(['pay', 'customers', 'paid', 'plan'] as const).map(k => (
                <div key={k} className="grid sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)] gap-x-8 gap-y-1 py-6">
                  <dt className="font-bold text-[17px] tracking-tight">{t(`driverLanding.benefit.${k}`)}</dt>
                  <dd className="m-0 text-[15px] leading-relaxed text-[#4A5260]">{t(`driverLanding.benefit.${k}Desc`)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ── Plans compared ─────────────────────────────────────────── */}
      <section id="plans" className="fg-reveal scroll-mt-32 bg-[#F3EEE2] py-20 md:py-28">
        <div className="max-w-[1240px] mx-auto px-5 md:px-10">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_auto] gap-6 items-end mb-10">
            <div>
              <p className="text-xs font-bold tracking-[.16em] uppercase text-[#7A6436] mb-3">{t('driverLanding.plansEyebrow')}</p>
              <h2 className="text-[36px] md:text-[52px] font-bold tracking-[-.04em] leading-[1.02] mb-4">{t('driverLanding.plansTitle')}</h2>
              <p className="text-lg text-[#4A5260] leading-relaxed m-0 max-w-[64ch]">{t('driverLanding.plansLede')}</p>
            </div>
            <button type="button" onClick={() => setPage('subscriptions')} className={`justify-self-start lg:justify-self-end font-bold text-[#24513B] underline underline-offset-4 ${focus}`}>{t('driverLanding.fullPlans')} →</button>
          </div>

          {/* The plans as a selector, with what a job leaves you (items 7–8). */}
          <PlanPicker onFullPlans={() => setPage('subscriptions')} />
          <details className="mt-8 group">
            <summary className={`cursor-pointer list-none inline-flex items-center gap-2 font-bold text-[#24513B] ${focus}`}>
              <span aria-hidden="true" className="transition group-open:rotate-90">›</span>{t('driverLanding.compareAll')}
            </summary>
            <div className="mt-5">
          {/* Phones and tablets: one row per plan. */}
          <ul className="lg:hidden list-none p-0 m-0 border-t-2 border-[#17212E]">
            {SUBSCRIPTION_PLANS.map((p, i) => (
              <li key={p.id} className={`py-5 px-4 border-b border-[#DCD4C2] ${i === 0 ? 'bg-[#FFFEFA]' : ''}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <b className="text-[19px] tracking-tight">{p.name}{i === 0 && <span className="ms-2 align-middle text-[11px] font-bold tracking-[.08em] uppercase text-[#1f4a33] bg-[#E4ECE6] px-2 py-0.5">{t('driverLanding.startHere')}</span>}</b>
                  <span className="text-[15px] font-semibold whitespace-nowrap">{price(p)}</span>
                </div>
                <p className="m-0 mt-1.5 text-[14px] text-[#4A5260]">{jobs(p)} · {commission(p)}</p>
                <p className="m-0 mt-2 text-[13px] text-[#4A5260] flex items-center gap-2">{meter(p.priorityLevel)} {t('driverLanding.priority', { level: level(p).toLowerCase() })}</p>
              </li>
            ))}
          </ul>
          {/* Laptops and wider: the comparison table. */}
          <div className="hidden lg:block">
            <table className="w-full border-collapse text-[15px]">
              <caption className="sr-only">{t('driverLanding.plansTitle')}</caption>
              <thead>
                <tr>{(['colPlan', 'colPrice', 'colJobs', 'colCommission', 'colPriority'] as const).map(k => (
                  <th key={k} scope="col" className="text-start text-xs font-bold tracking-[.12em] uppercase text-[#4A5260] px-4 pb-3 border-b-2 border-[#17212E]">{t(`driverLanding.${k}`)}</th>))}</tr>
              </thead>
              <tbody>
                {SUBSCRIPTION_PLANS.map((p, i) => (
                  <tr key={p.id} className={i === 0 ? 'bg-[#FFFEFA]' : ''}>
                    <th scope="row" className="text-start px-4 py-5 border-b border-[#DCD4C2] text-[19px] font-bold tracking-tight whitespace-nowrap">
                      {p.name}
                      {i === 0 && <span className="ms-2.5 align-middle text-[11px] font-bold tracking-[.08em] uppercase text-[#1f4a33] bg-[#E4ECE6] px-2 py-0.5">{t('driverLanding.startHere')}</span>}
                    </th>
                    <td className="px-4 py-5 border-b border-[#DCD4C2] whitespace-nowrap font-semibold">{price(p)}</td>
                    <td className="px-4 py-5 border-b border-[#DCD4C2]">{jobs(p)}</td>
                    <td className="px-4 py-5 border-b border-[#DCD4C2] whitespace-nowrap">{commission(p)}</td>
                    <td className="px-4 py-5 border-b border-[#DCD4C2] whitespace-nowrap"><span className="inline-flex items-center gap-2.5">{meter(p.priorityLevel)}<span>{level(p)}</span></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            </div>
          </details>
          <p className="text-[13px] text-[#4A5260] mt-5 max-w-[90ch]">{t('driverLanding.plansNote')}</p>
        </div>
      </section>

      {/* ── How you get paid (item 9) ─────────────────────────────── */}
      <section id="payments" className="fg-reveal scroll-mt-32 py-20 md:py-28">
        <div className="max-w-[1240px] mx-auto px-5 md:px-10">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 lg:gap-16 items-end mb-14">
            <div>
              <p className="text-xs font-bold tracking-[.16em] uppercase text-[#7A6436] mb-3">{t('driverLanding.escrow.eyebrow')}</p>
              <h2 className="text-[36px] md:text-[52px] font-bold tracking-[-.04em] leading-[1.02] m-0">{t('driverLanding.escrow.title')}</h2>
            </div>
            <p className="text-lg text-[#4A5260] leading-relaxed m-0 max-w-[56ch]">{t('driverLanding.escrow.lede')}</p>
          </div>
          <EscrowFlow />
        </div>
      </section>

      {/* ── What you need ──────────────────────────────────────────── */}
      <section id="requirements" className="fg-reveal scroll-mt-32 bg-[#1F3A2E] text-[#F3EEE2] py-20 md:py-28">
        <div className="max-w-[1240px] mx-auto px-5 md:px-10">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 lg:gap-16 items-end mb-14">
            <div>
              <p className="text-xs font-bold tracking-[.16em] uppercase text-[#DCC9A0] mb-3">{t('driverLanding.reqEyebrow')}</p>
              <h2 className="text-[36px] md:text-[52px] font-bold tracking-[-.04em] leading-[1.02] m-0 text-[#FFFEFA]">{t('driverLanding.reqTitle')}</h2>
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-[#FFFEFA] mb-1">{t('driverLanding.checkTitle')}</h3>
              <p className="text-[16px] leading-relaxed text-[#D5DDD7] m-0 max-w-[56ch]">{t('driverLanding.checkText')}</p>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-10 md:gap-0">
            <div className="md:pe-10">
              <h3 className="text-xs font-bold !tracking-[.14em] uppercase text-[#DCC9A0] pb-3 mb-4 border-b border-[#F3EEE2]/20">{t('driverLanding.reqVehicle')}</h3>
              <ul className="list-none p-0 m-0 space-y-3">
                {VEHICLE_TYPES.map(v => {
                  const name = t(`driverApplication.vehicles.${v.id}`, v.label.replace(/\s*\(.*\)$/, ''));
                  return <li key={v.id} className="flex items-baseline justify-between gap-4"><span className="text-[16px]">{name}</span><span className="text-[#DCC9A0] whitespace-nowrap" style={serif}>{/\(([^)]+)\)/.exec(v.label)?.[1]}</span></li>;
                })}
              </ul>
            </div>
            <div className="md:px-10 md:border-s border-[#F3EEE2]/20">
              <h3 className="text-xs font-bold !tracking-[.14em] uppercase text-[#DCC9A0] pb-3 mb-4 border-b border-[#F3EEE2]/20">{t('driverLanding.reqDocuments')}</h3>
              <ul className="list-none p-0 m-0 space-y-3.5">
                {DOCUMENT_TYPES.map(d => (
                  <li key={d.key}>
                    <span className="block text-[16px]">{t(`driverApplication.docs.${d.key}.label`, d.label)}</span>
                    <span className="block text-[13px] text-[#BFCBC3]">{t(`driverApplication.docs.${d.key}.desc`, d.desc)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[13px] text-[#BFCBC3] mt-5">{t('driverApplication.formats')}</p>
            </div>
            <div className="md:ps-10 md:border-s border-[#F3EEE2]/20">
              <h3 className="text-xs font-bold !tracking-[.14em] uppercase text-[#DCC9A0] pb-3 mb-4 border-b border-[#F3EEE2]/20">{t('driverLanding.reqWhere')}</h3>
              <ul className="list-none p-0 m-0 grid grid-cols-2 gap-y-3 gap-x-4">
                {APPLICATION_CITIES.map(c => <li key={c} className="text-[16px]">{c}</li>)}
              </ul>
              <button type="button" onClick={toForm} className="mt-10 min-h-[52px] px-6 bg-[#C3A66C] hover:bg-[#D2B87F] text-[#17212E] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DCC9A0]">{t('driverLanding.apply')} ↓</button>
            </div>
          </div>
        </div>
      </section>

      {/* ── The Driver Agreement in plain words (item 12) ── */}
      <section id="terms" className="fg-reveal scroll-mt-32 py-20 md:py-28">
        <div className="max-w-[1240px] mx-auto px-5 md:px-10">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 lg:gap-16 items-end mb-12">
            <div>
              <p className="text-xs font-bold tracking-[.16em] uppercase text-[#7A6436] mb-3">{t('driverLanding.terms.eyebrow')}</p>
              <h2 className="text-[36px] md:text-[52px] font-bold tracking-[-.04em] leading-[1.02] m-0">{t('driverLanding.terms.title')}</h2>
            </div>
            <p className="text-lg text-[#4A5260] leading-relaxed m-0 max-w-[56ch]">{t('driverLanding.terms.lede')}</p>
          </div>
          <TermsSummary />
        </div>
      </section>

      {/* ── Questions (item 11) ───────────────────────────────────── */}
      <section id="faq" className="fg-reveal scroll-mt-32 bg-[#FFFEFA] py-20 md:py-28 border-y border-[#EDE6D6]">
        <div className="max-w-[1040px] mx-auto px-5 md:px-10">
          <p className="text-xs font-bold tracking-[.16em] uppercase text-[#7A6436] mb-3">{t('driverLanding.faq.eyebrow')}</p>
          <h2 className="text-[36px] md:text-[52px] font-bold tracking-[-.04em] leading-[1.02] mb-10">{t('driverLanding.faq.title')}</h2>
          <DriverFaq />
        </div>
      </section>

      {audience === 'driver' && companiesSection}

      {/* ── The application ───────────────────────────────────────── */}
      <DriverApplicationForm presetCity={presetCity} onProgress={onProgress} />
    </div>
  );
}
