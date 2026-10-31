/**
 * Sections of /become-a-driver added on 31 October 2026 (owner: a premium, iconic driver page):
 *  - PlanPicker: the plans as a selector, with what a job of a chosen price leaves the driver on that plan
 *    (calculateCommission, the same rule the payout uses), labelled an example, not a promise.
 *  - EscrowFlow: how the money moves, drawn as a line that fills in.
 *  - DriverFaq: questions answered from the platform's own rules.
 *  - DayOnFlyttGo (items 5, 6): a job from accept to paid, each step shown in the driver app's own job card
 *    and wallet (PortalCards, the components the portal renders) with one sample job, labelled a sample.
 *  - FleetSection (item 14): how a company with several vans joins, as the platform works today.
 *  - TermsSummary (item 12): the Driver Agreement in plain words, figures from lib/driverTerms.ts.
 * Every figure comes from SUBSCRIPTION_PLANS, the commission rule, the cancellation policy or the agreement.
 */
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SUPPORT_EMAIL, useCompanyIdentity } from '../../lib/companyIdentity';
import { useTranslation } from 'react-i18next';
import { IMAGES, SUBSCRIPTION_PLANS, calculateCommission } from '../../lib/constants';
import { CANCELLATION_POLICY } from '../../../supabase/functions/_shared/pricing';
import { DRIVER_TERMS, TERMS_SUMMARY } from '../../lib/driverTerms';
import { calcCommission, formatDuration } from './PortalCards';

const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24513B]';
const serif = { fontFamily: 'Georgia, "Times New Roman", serif' };
type Plan = (typeof SUBSCRIPTION_PLANS)[number];
const PRIORITY_NO: Record<string, string> = { Standard: 'Standard', Moderate: 'Moderat', High: 'Høy', 'Very High': 'Svært høy', Highest: 'Høyest' };

export function PlanPicker() {
  const { t, i18n } = useTranslation();
  const no = i18n.language === 'no';
  const nok = (n: number) => `${Math.round(n).toLocaleString(no ? 'nb-NO' : 'en-GB')} NOK`;
  const [ix, setIx] = useState(0);
  const [price, setPrice] = useState(450);
  const p: Plan = SUBSCRIPTION_PLANS[ix];
  const upTo = Number(/up to (\d+)/i.exec(p.jobVisibility)?.[1] ?? 0) || null;
  const visible = !upTo || price <= upTo;
  const c = calculateCommission(price, p.id);
  const rates = Object.values(p.commission as Record<string, number>);
  const lo = Math.min(...rates), hi = Math.max(...rates);
  const level = no ? (PRIORITY_NO[p.dispatchPriority] ?? p.dispatchPriority) : p.dispatchPriority;
  const planPrice = p.price === 0 ? nok(0) : `${nok(p.price)} ${p.period === '/day' ? t('driverLanding.perDay') : t('driverLanding.perMonth')}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-0 rounded-[24px] overflow-hidden border border-[#EDE6D6] bg-[#FFFEFA] shadow-[0_40px_80px_-56px_rgba(23,33,46,.45)]">
      <div className="p-6 md:p-9 min-w-0">
        <div role="radiogroup" aria-label={t('driverLanding.picker.label')} className="flex sm:grid sm:grid-cols-5 gap-2 overflow-x-auto [scrollbar-width:none] -mx-1 px-1 sm:mx-0 sm:p-1 sm:rounded-full sm:bg-[#F3EEE2]">
          {SUBSCRIPTION_PLANS.map((pl, i) => (
            <button key={pl.id} type="button" role="radio" aria-checked={i === ix} onClick={() => setIx(i)}
                    className={`flex-shrink-0 whitespace-nowrap min-h-[46px] px-4 sm:px-1 rounded-full text-sm font-bold transition border sm:border-0 border-[#DCD4C2] ${focus} ${i === ix ? 'bg-[#24513B] border-[#24513B] text-white shadow-[0_6px_14px_-8px_rgba(36,81,59,.8)]' : 'bg-white sm:bg-transparent text-[#17212E] hover:bg-white/70'}`}>
              {pl.name}
            </button>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h3 className="text-[40px] md:text-[52px] leading-none font-bold tracking-tight m-0">{p.name}</h3>
          <span className="text-2xl" style={serif}>{planPrice}</span>
          {ix === 0 && <span className="text-[11px] font-bold tracking-[.08em] uppercase text-[#1f4a33] bg-[#E4ECE6] px-2 py-0.5">{t('driverLanding.startHere')}</span>}
        </div>
        <dl className="mt-7 grid sm:grid-cols-3 gap-5 m-0">
          <div><dt className="text-xs font-bold tracking-[.1em] uppercase text-[#4A5260]">{t('driverLanding.colJobs')}</dt>
            <dd className="m-0 mt-1 text-[17px] font-semibold">{upTo ? t('driverLanding.jobsUpTo', { amount: nok(upTo) }) : t('driverLanding.allJobs')}</dd></div>
          <div><dt className="text-xs font-bold tracking-[.1em] uppercase text-[#4A5260]">{t('driverLanding.colCommission')}</dt>
            <dd className="m-0 mt-1 text-[17px] font-semibold">{lo === hi ? `${lo}%` : `${lo}–${hi}%`}</dd></div>
          <div><dt className="text-xs font-bold tracking-[.1em] uppercase text-[#4A5260]">{t('driverLanding.colPriority')}</dt>
            <dd className="m-0 mt-1 text-[17px] font-semibold flex items-center gap-2">
              <span className="inline-flex gap-[3px]" aria-hidden="true">{[1, 2, 3, 4, 5].map(n => <span key={n} className={`w-[6px] h-[14px] ${n <= p.priorityLevel ? 'bg-[#24513B]' : 'bg-[#DCD4C2]'}`} />)}</span>{level}</dd></div>
        </dl>
        <ul className="mt-7 list-none p-0 m-0 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[15px] text-[#4A5260]">
          {p.features.map(f => <li key={f} className="flex gap-2"><span className="text-[#24513B]" aria-hidden="true">✓</span>{t(`driverLanding.feature.${f}`, f)}</li>)}
        </ul>
      </div>

      {/* What a job of this price leaves you on this plan */}
      <div className="p-6 md:p-9 bg-[#1F3A2E] text-[#F3EEE2] flex flex-col">
        <p className="text-xs font-bold tracking-[.16em] uppercase text-[#DCC9A0] m-0 mb-2">{t('driverLanding.picker.calcEyebrow')}</p>
        <label htmlFor="pp-price" className="text-[22px] font-bold text-[#FFFEFA]">{t('driverLanding.picker.calcTitle')}</label>
        <div className="mt-5 flex items-center gap-4">
          <input id="pp-price" type="range" min={200} max={12000} step={100} value={price} onChange={e => setPrice(Number(e.target.value))}
                 className="flex-1 accent-[#C3A66C]" aria-valuetext={nok(price)} />
          <output htmlFor="pp-price" className="text-[22px] tabular-nums min-w-[110px] text-end" style={serif}>{nok(price)}</output>
        </div>
        <div aria-live="polite" className="mt-8 border-t border-white/20 pt-6">
          {visible ? (
            <>
              <p className="m-0 text-sm text-[#BFCBC3]">{t('driverLanding.picker.youKeep')}</p>
              <p className="m-0 text-[52px] leading-none tracking-tight mt-1" style={serif}>{nok(c.earning)}</p>
              <p className="m-0 mt-3 text-sm text-[#D5DDD7]">{t('driverLanding.picker.commission', { rate: Math.max(0, c.rate), amount: nok(c.commission) })}</p>
            </>
          ) : (
            <p className="m-0 text-[17px] text-[#EBDDBA]">{t('driverLanding.picker.notVisible', { plan: p.name, amount: nok(upTo ?? 0) })}</p>
          )}
        </div>
        <span className="flex-1" />
        <p className="m-0 mt-8 text-xs text-[#BFCBC3]">{t('driverLanding.picker.note')}</p>
      </div>
    </div>
  );
}

export function EscrowFlow() {
  const { t } = useTranslation();
  const steps = [['book', I.calendar], ['held', I.shield], ['work', I.truck], ['confirm', I.check], ['wallet', I.wallet]] as const;
  return (
    <ol className="fg-escrow list-none p-0 m-0 grid sm:grid-cols-5 gap-6 sm:gap-2 relative rounded-[24px] bg-[#FFFEFA] border border-[#EDE6D6] shadow-[0_40px_80px_-56px_rgba(23,33,46,.45)] px-6 py-8 sm:px-6 sm:py-10">
      <span aria-hidden="true" className="fg-escrow-line hidden sm:block absolute top-[68px] start-[12%] end-[12%] h-[2px] bg-[#E2DACA]"><span className="block h-full bg-[#24513B]" /></span>
      {steps.map(([k, icon], i) => (
        <li key={k} className="relative sm:text-center sm:px-2 flex sm:block gap-4">
          <span className="relative z-10 flex-shrink-0 sm:mx-auto flex items-center justify-center w-14 h-14 rounded-2xl bg-[#FFFEFA] border border-[#EDE6D6] shadow-[0_10px_22px_-14px_rgba(122,100,54,.55)] text-[#9F8249]">
            <Ico d={icon} className="w-6 h-6" />
            <span className="absolute -top-2 -end-2 w-6 h-6 rounded-full bg-[#24513B] text-white text-[12px] flex items-center justify-center" style={serif}>{i + 1}</span>
          </span>
          <div>
            <h3 className="text-[17px] font-bold tracking-tight mt-0 sm:mt-5 mb-1">{t(`driverLanding.escrow.${k}`)}</h3>
            <p className="text-[14px] leading-relaxed text-[#4A5260] m-0">{t(`driverLanding.escrow.${k}Desc`)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* Questions (owner, 31 October 2026, second pass): grouped, one open at a time, with a way to ask beside them. */
const FAQ_GROUPS = [
  { key: 'money', items: ['cost', 'commission', 'payout', 'paid', 'cancel'] },
  { key: 'joining', items: ['after', 'vehicle', 'insurance'] },
  { key: 'companies', items: ['company', 'switch'] },
] as const;

export function DriverFaq({ onApply, onContact }: { onApply: () => void; onContact: () => void }) {
  const { t, i18n } = useTranslation();
  const no = i18n.language === 'no';
  const identity = useCompanyIdentity();
  const email = identity.email ?? DEFAULT_SUPPORT_EMAIL;
  const nok = (n: number) => `${n.toLocaleString(no ? 'nb-NO' : 'en-GB')} NOK`;
  const free = SUBSCRIPTION_PLANS[0];
  const freeUpTo = Number(/up to (\d+)/i.exec(free.jobVisibility)?.[1] ?? 500);
  const vars: Record<string, Record<string, string | number>> = {
    cost: { plan: free.name, amount: nok(freeUpTo) },
    commission: { amount: nok(500) },
    payout: { amount: nok(500) },
    cancel: { hours: CANCELLATION_POLICY.freeUntilHoursBefore, share: Math.round(CANCELLATION_POLICY.lateCustomerShare * 100) },
  };
  const [open, setOpen] = useState<string | null>('cost');
  return (
    <div className="grid lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] gap-10 lg:gap-20">
      <div className="lg:sticky lg:top-40 self-start">
        <p className="text-xs font-bold tracking-[.16em] uppercase text-[#7A6436] mb-3">{t('driverLanding.faq.eyebrow')}</p>
        <h2 className="text-[36px] md:text-[52px] font-bold tracking-[-.04em] leading-[1.02] mb-5">{t('driverLanding.faq.title')}</h2>
        <p className="text-lg text-[#4A5260] leading-relaxed m-0 mb-8 max-w-[44ch]">{t('driverLanding.faq.lede')}</p>
        <div className="border border-[#E2DACA] bg-[#FBF8F1] p-6">
          <h3 className="text-[17px] font-bold tracking-tight m-0 mb-1.5">{t('driverLanding.faq.askTitle')}</h3>
          <p className="text-[15px] leading-relaxed text-[#4A5260] m-0 mb-5">{t('driverLanding.faq.askText')}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onApply} className={`min-h-[48px] px-5 bg-[#24513B] hover:bg-[#1C4130] text-white font-bold ${focus}`}>{t('driverLanding.apply')} ↓</button>
            <button type="button" onClick={onContact} className={`min-h-[48px] px-5 border border-[#CFC7B5] bg-white font-semibold hover:bg-[#F3EEE2] ${focus}`}>{t('driverLanding.faq.contact')}</button>
          </div>
          <p className="text-[14px] text-[#4A5260] mt-4 mb-0">{t('driverLanding.faq.or')} <a href={`mailto:${email}`} className={`font-semibold text-[#24513B] underline underline-offset-4 ${focus}`}>{email}</a></p>
        </div>
      </div>
      <div className="space-y-12">
        {FAQ_GROUPS.map(g => (
          <section key={g.key} aria-labelledby={`faq-${g.key}`}>
            <h3 id={`faq-${g.key}`} className="text-xs font-bold !tracking-[.16em] uppercase text-[#7A6436] m-0 pb-3 border-b-2 border-[#17212E]">{t(`driverLanding.faq.groups.${g.key}`)}</h3>
            <ul className="list-none p-0 m-0">
              {g.items.map(k => {
                const isOpen = open === k;
                return (
                  <li key={k} className={`border-b border-[#E2DACA] transition-colors ${isOpen ? 'bg-[#FFFEFA] border-s-2 border-s-[#C3A66C]' : 'border-s-2 border-s-transparent'}`}>
                    <h4 className="m-0">
                      <button type="button" aria-expanded={isOpen} aria-controls={`faq-a-${k}`} id={`faq-q-${k}`} onClick={() => setOpen(isOpen ? null : k)}
                              className={`w-full flex items-center justify-between gap-6 py-5 ps-4 pe-2 text-start text-[17px] font-bold tracking-tight ${focus}`}>
                        {t(`driverLanding.faq.${k}Q`)}
                        <span aria-hidden="true" className={`flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center transition ${isOpen ? 'rotate-45 bg-[#24513B] border-[#24513B] text-white' : 'border-[#CFC7B5] text-[#24513B]'}`}>+</span>
                      </button>
                    </h4>
                    <div id={`faq-a-${k}`} role="region" aria-labelledby={`faq-q-${k}`} hidden={!isOpen}>
                      <p className="m-0 pb-6 ps-4 pe-12 text-[16px] leading-relaxed text-[#4A5260] max-w-[70ch]">{t(`driverLanding.faq.${k}A`, vars[k] ?? {})}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ── A day on FlyttGo (items 5 and 6; redesigned 31 October 2026) ─────────────────────────────
 * One phone and the four actions a driver takes in the portal (Accept, Start, Finish, Confirm). Choosing a
 * stage puts the same sample job into that state in the portal's own job card (PortalCards), so the screen is
 * the real component, never a drawing. The job is labelled a sample; the figures are the commission rule's. */
const SAMPLE_PLAN = 'pro_mini';
const SAMPLE_PRICE = 2500;
const STAGES = [
  { key: 'accept', status: 'awaiting_driver' },
  { key: 'start', status: 'driver_assigned' },
  { key: 'finish', status: 'in_transit' },
  { key: 'confirm', status: 'completed' },
] as const;
const PORTAL_TABS = ['overview', 'jobs', 'earnings', 'wallet', 'subscription'] as const;
const TAB_ICON: Record<(typeof PORTAL_TABS)[number], JSX.Element> = {
  overview: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  jobs: <><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  earnings: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M16 12.5h2M3 9h15" /></>,
  subscription: <><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" /></>,
};

/* Small line icons, drawn for this section (24px grid, currentColor). */
const Ico = ({ d, className = 'w-5 h-5' }: { d: JSX.Element; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{d}</svg>
);
const I = {
  pin: <><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  truck: <><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  people: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.8a3 3 0 0 1 0 5.4M17.5 19a5.5 5.5 0 0 0-2.4-4.5" /></>,
  timer: <><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4.2l2.5 1.5M9.5 2.5h5" /></>,
  coins: <><ellipse cx="12" cy="6.5" rx="6.5" ry="2.8" /><path d="M5.5 6.5v5c0 1.6 2.9 2.8 6.5 2.8s6.5-1.2 6.5-2.8v-5M5.5 11.5v5c0 1.6 2.9 2.8 6.5 2.8s6.5-1.2 6.5-2.8v-5" /></>,
  percent: <><path d="M19 5 5 19" /><circle cx="7" cy="7" r="2.3" /><circle cx="17" cy="17" r="2.3" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M16 12.5h2M3 9.5h15" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  note: <><path d="M5 4h14v16H5z" /><path d="M8.5 9h7M8.5 13h7M8.5 17h4" /></>,
  route: <><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" /></>,
  shield: <><path d="M12 3.5 19 6v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
  tasks: <><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M8 3v3M16 3v3M8 13l2.5 2.5L16 10" /></>,
};
const ACTION_KEY = { accept: 'acceptJob', start: 'startJob', finish: 'finishJob', confirm: 'confirmCompletion' } as const;

export function DayOnFlyttGo() {
  const { t, i18n } = useTranslation();
  const no = i18n.language === 'no';
  const nok = (n: number) => `${Math.round(n).toLocaleString(no ? 'nb-NO' : 'en-GB')} NOK`;
  const [ix, setIx] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const stage = STAGES[ix];
  /* Autoplay (owner, 31 October 2026): the steps advance every few seconds while the section is on screen,
   * pause while the pointer is over it, and stop for good once someone chooses a step. Never under reduced motion. */
  const AUTO_MS = 5200;
  const root = useRef<HTMLDivElement>(null);
  const [auto, setAuto] = useState(true);
  const [hover, setHover] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setAuto(false); return; }
    const el = root.current; if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.35 });
    io.observe(el); return () => io.disconnect();
  }, []);
  const playing = auto && seen && !hover;
  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => setIx(i => (i + 1) % STAGES.length), AUTO_MS);
    return () => window.clearTimeout(id);
  }, [playing, ix]);
  const choose = (i: number) => { setAuto(false); setIx(i); };
  const touchX = useRef<number | null>(null);
  /* On Finish the timer runs, counted from the sample start time. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ix !== 2) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ix]);
  const c = calcCommission(SAMPLE_PRICE, SAMPLE_PLAN);
  const planName = SUBSCRIPTION_PLANS.find(p => p.id === SAMPLE_PLAN)?.name ?? SAMPLE_PLAN;
  const [startedAt] = useState(() => Date.now() - 74 * 60_000 - 12_000);
  const started = new Date(startedAt).toISOString();
  const ended = new Date(startedAt + 72 * 60_000).toISOString();
  const liveTimer = (() => { const sec = Math.max(0, Math.floor((now - startedAt) / 1000)); return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m ${String(sec % 60).padStart(2, '0')}s`; })();
  const PILL: Record<string, string> = { awaiting_driver: 'bg-amber-100 text-amber-800', driver_assigned: 'bg-blue-100 text-blue-800', in_transit: 'bg-purple-100 text-purple-800', completed: 'bg-green-100 text-green-800' };
  const moveDate = new Date().toISOString().slice(0, 10);
  const go = (n: number) => { const i = (n + STAGES.length) % STAGES.length; choose(i); tabs.current[i]?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(ix + (document.dir === 'rtl' ? -1 : 1)); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(ix - (document.dir === 'rtl' ? -1 : 1)); }
    if (e.key === 'Home') { e.preventDefault(); go(0); }
    if (e.key === 'End') { e.preventDefault(); go(STAGES.length - 1); }
  };
  const benefits = [['jobs', I.tasks], ['earnings', I.coins], ['workflow', I.route], ['payment', I.shield]] as const;
  const statusLabel = stage.status.replace(/_/g, ' ');
  const row = (icon: JSX.Element, text: string, strong = false) => (
    <div className="flex items-center gap-3 py-2 border-t border-gray-100">
      <span className="text-[#24513B]"><Ico d={icon} className="w-[22px] h-[22px]" /></span>
      <span className={`text-[15px] ${strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{text}</span>
    </div>
  );

  return (
    <div ref={root} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="grid gap-x-10 gap-y-8 xl:gap-x-14 [grid-template-areas:'intro'_'steps'_'phone'_'panel'] md:grid-cols-[auto_minmax(0,1fr)] md:[grid-template-areas:'intro_intro'_'phone_steps'_'phone_panel'] xl:grid-cols-[minmax(0,.78fr)_auto_minmax(0,1.32fr)] xl:[grid-template-areas:'intro_phone_steps'_'intro_phone_panel'] md:grid-rows-[auto_auto_1fr] xl:grid-rows-[auto_1fr] xl:items-center">
      {/* The story and four facts, each with its icon tile */}
      <div className="[grid-area:intro] xl:self-center xl:row-span-2">
        <p className="text-xs font-bold tracking-[.18em] uppercase text-[#7A6436] mb-4">{t('driverLanding.day.eyebrow')}</p>
        <h2 className="text-[36px] md:text-[44px] !font-normal !tracking-[-.015em] leading-[1.06] m-0 mb-5 text-[#17212E]" style={serif}>{t('driverLanding.day.title')}</h2>
        <p className="text-[17px] text-[#4A5260] leading-relaxed m-0 mb-9 max-w-[42ch]">{t('driverLanding.day.lede')}</p>
        <ul className="list-none p-0 m-0 grid md:grid-cols-2 xl:grid-cols-1 gap-5">
          {benefits.map(([k, icon]) => (
            <li key={k} className="flex items-start gap-4">
              <span className="flex-shrink-0 w-12 h-12 rounded-2xl bg-[#FFFEFA] border border-[#EDE6D6] shadow-[0_8px_18px_-12px_rgba(122,100,54,.45)] flex items-center justify-center text-[#9F8249]"><Ico d={icon} className="w-6 h-6" /></span>
              <span className="pt-0.5"><b className="block text-[16px] tracking-tight text-[#17212E]">{t(`driverLanding.day.b.${k}`)}</b><span className="block text-[14px] text-[#4A5260] leading-snug mt-0.5">{t(`driverLanding.day.b.${k}Desc`)}</span></span>
            </li>
          ))}
        </ul>
      </div>

      {/* One phone, upright */}
      <figure className="[grid-area:phone] relative m-0 justify-self-center self-start xl:self-center xl:row-span-2"
              onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
              onTouchEnd={e => { const dx = e.changedTouches[0].clientX - (touchX.current ?? e.changedTouches[0].clientX); touchX.current = null;
                if (Math.abs(dx) > 40) choose((ix + (dx < 0 ? 1 : 3)) % 4); }}>
        {/* A scene behind the device: a champagne glow and the FlyttGo van, soft and far away */}
        <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] max-w-[130vw] rounded-full bg-[radial-gradient(closest-side,rgba(220,201,160,.55),rgba(220,201,160,.18)_55%,transparent)]" />
        <img aria-hidden="true" alt="" src={IMAGES.vans.large} loading="lazy" decoding="async"
             className="pointer-events-none absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 w-[460px] max-w-[120vw] h-[300px] object-cover opacity-[.22] blur-[18px] saturate-[.7] rounded-[50%] [mask-image:radial-gradient(closest-side,#000,transparent)]" />
        <div aria-hidden="true" className="fg-phone relative z-10 w-[300px] aspect-[71.6/147.6] [--s:0.7205]">
          <span className="fg-phone-btn absolute -start-[3px] top-[17.5%] h-[4.4%] w-[3px] rounded-s-[1.5px]" />
          <span className="fg-phone-btn absolute -start-[3px] top-[25.5%] h-[8%] w-[3px] rounded-s-[1.5px]" />
          <span className="fg-phone-btn absolute -start-[3px] top-[35.5%] h-[8%] w-[3px] rounded-s-[1.5px]" />
          <span className="fg-phone-btn absolute -end-[3px] top-[27%] h-[12.5%] w-[3px] rounded-e-[1.5px]" />
          <span className="fg-phone-btn absolute -end-[2px] top-[57%] h-[7%] w-[2px] rounded-e-[1px]" />
          <div className="fg-phone-edge absolute inset-0 rounded-[50px] p-[2.5px]">
            <div className="h-full rounded-[47.5px] bg-black p-[7px]">
              <div className="relative h-full rounded-[40.5px] overflow-hidden bg-[#F2F4F3]">
                <div className="absolute top-0 left-0 origin-top-left flex flex-col" style={{ width: 390, height: 'calc(100% / var(--s))', transform: 'scale(var(--s))', fontFamily: '"DM Sans", ui-sans-serif, system-ui, sans-serif' }}>
                  <div className="bg-[#1F3A2E] text-white">
                    <div className="relative flex items-center justify-between h-[54px] ps-[42px] pe-[30px] text-[17px] font-semibold" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif', letterSpacing: '-.02em' }}>
                      <span className="mt-[6px]">9:41</span>
                      <span className="absolute top-[11px] left-1/2 -translate-x-1/2 w-[126px] h-[37px] rounded-full bg-black">
                        <span className="absolute right-[14px] top-1/2 -translate-y-1/2 w-[11px] h-[11px] rounded-full bg-[radial-gradient(circle_at_35%_35%,#2b3242,#0b0d12_70%)]" />
                      </span>
                      <span className="flex items-center gap-[6px] mt-[6px]">
                        <svg width="19" height="12" viewBox="0 0 17 11"><rect x="0" y="7" width="3" height="4" rx=".8" fill="currentColor"/><rect x="4.6" y="5" width="3" height="6" rx=".8" fill="currentColor"/><rect x="9.2" y="2.6" width="3" height="8.4" rx=".8" fill="currentColor"/><rect x="13.8" y="0" width="3" height="11" rx=".8" fill="currentColor"/></svg>
                        <svg width="17" height="12" viewBox="0 0 15 11"><path d="M7.5 2.2c2 0 3.9.8 5.3 2.1l1.1-1.1A9 9 0 0 0 7.5.6 9 9 0 0 0 1.1 3.2l1.1 1.1A7.5 7.5 0 0 1 7.5 2.2Zm0 3.2c1.2 0 2.3.4 3.1 1.2l1.1-1.1a6 6 0 0 0-8.4 0l1.1 1.1c.8-.8 1.9-1.2 3.1-1.2Zm0 3.1c-.5 0-.9.2-1.2.5L7.5 10.2 8.7 9a1.7 1.7 0 0 0-1.2-.5Z" fill="currentColor"/></svg>
                        <svg width="27" height="13" viewBox="0 0 26 12"><rect x=".5" y=".5" width="22" height="11" rx="3.4" fill="none" stroke="currentColor" opacity=".45"/><rect x="2" y="2" width="16.5" height="8" rx="2" fill="currentColor"/><path d="M24 4v4c.8-.3 1.3-1.1 1.3-2S24.8 4.3 24 4Z" fill="currentColor" opacity=".5"/></svg>
                      </span>
                    </div>
                    <div className="px-5 pt-2 pb-4 flex justify-between items-center">
                      <span className="text-[21px] font-bold">{t('driverPortal.title')}</span>
                      <span className="px-4 py-2 rounded-full font-semibold text-sm bg-green-100 text-green-700">{t('driverPortal.online')}</span>
                    </div>
                  </div>

                  {/* The sample job in the chosen state */}
                  <div className="flex-1 min-h-0 overflow-hidden p-4 flex flex-col gap-3">
                    {/* The Jobs tab's map, as a preview of the sample route (the portal opens the live map on tap) */}
                    <div className="flex-1 min-h-[92px] bg-white rounded-[22px] border border-gray-100 shadow-[0_10px_30px_-22px_rgba(23,33,46,.35)] overflow-hidden flex flex-col">
                      <div className="flex items-center justify-between px-4 pt-3 pb-2">
                        <span className="text-[15px] font-bold text-gray-900">📍 {t('driverPortal.mapView')}</span>
                        <span className="text-[13px] font-semibold text-emerald-600">{t('driverPortal.showMap')}</span>
                      </div>
                      <div className="relative flex-1 min-h-[44px] mx-3 mb-3 rounded-2xl overflow-hidden bg-[#E9EFE9]">
                        <svg viewBox="0 0 340 160" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
                          <rect width="340" height="160" fill="#E8EEE7" />
                          <path d="M-10 128C60 112 96 140 170 120S290 70 350 82" fill="none" stroke="#CFE0EA" strokeWidth="26" />
                          <path d="M0 40h340M0 92h340M60 0v160M150 0v160M250 0v160M20 0l90 160M210 0l-60 160" stroke="#FFFFFF" strokeWidth="6" />
                          <path d="M0 66h340M110 0v160M300 0v160" stroke="#F6F3EA" strokeWidth="3" />
                          <path d="M72 48C110 50 120 92 160 94S238 70 262 112" fill="none" stroke="#24513B" strokeWidth="4.5" strokeLinecap="round" strokeDasharray={ix >= 2 ? '0' : '1 9'} />
                          <circle cx="72" cy="48" r="8" fill="#24513B" stroke="#fff" strokeWidth="3" />
                          <path d="M262 98c-6 0-11 5-11 11 0 8 11 17 11 17s11-9 11-17c0-6-5-11-11-11Z" fill="#C3A66C" stroke="#fff" strokeWidth="2.5" />
                          {ix === 2 && <circle cx="160" cy="94" r="7" fill="#1F7AE0" stroke="#fff" strokeWidth="3" />}
                        </svg>
                        <span className="absolute left-3 top-2 text-[11px] font-semibold text-[#24513B] bg-white/85 rounded-full px-2 py-0.5">Storgata</span>
                        <span className="absolute right-3 bottom-2 text-[11px] font-semibold text-[#7A6436] bg-white/85 rounded-full px-2 py-0.5">Bogstadveien</span>
                      </div>
                    </div>
                    <div key={ix} className="fg-stage flex-shrink-0 bg-white rounded-[22px] shadow-[0_10px_30px_-18px_rgba(23,33,46,.35)] border border-gray-100 p-5">
                      <span className={`inline-block mb-3 px-3 py-1 rounded-full text-[13px] font-semibold capitalize transition-colors ${PILL[stage.status]}`}>{statusLabel}</span>
                      <div className="flex gap-3 mb-3">
                        <span className="text-[#C3A66C] mt-0.5"><Ico d={I.pin} className="w-6 h-6" /></span>
                        <div><p className="m-0 text-[19px] font-bold text-gray-900 leading-tight">Storgata 12, 0184 Oslo</p><p className="m-0 text-[14px] text-gray-500 mt-0.5">Bogstadveien 40, 0366 Oslo</p></div>
                      </div>
                      <div className="flex items-center gap-3 rounded-2xl bg-[#FBF8F1] px-4 py-2.5 mb-1.5">
                        <span className="text-[#24513B]"><Ico d={I.truck} className="w-6 h-6" /></span>
                        <span className="text-[15px] font-semibold text-gray-900 first-letter:uppercase">{t('driverPortal.extra.furniture_assembly')} · {t('driverPortal.helpersLabel', { count: 1 })}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 py-2">
                        <span className="flex items-center gap-2.5 text-[15px] text-gray-700"><span className="text-[#24513B]"><Ico d={I.clock} className="w-[22px] h-[22px]" /></span>{t('driverLanding.day.card.estimated', { n: 3 })}</span>
                        <span className="flex items-center gap-2.5 text-[15px] text-gray-700"><span className="text-[#24513B]"><Ico d={I.calendar} className="w-[22px] h-[22px]" /></span>{moveDate}</span>
                      </div>
                      {ix >= 2 && row(I.timer, t('driverLanding.day.card.timer', { time: ix === 2 ? liveTimer : formatDuration(started, ended) }), true)}
                      {ix >= 1 && (
                        <div className="mt-1.5 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-2.5 flex gap-3">
                          <span className="text-amber-700"><Ico d={I.note} className="w-5 h-5" /></span>
                          <div><p className="m-0 text-[13px] font-semibold text-amber-900">{t('driverPortal.customerNotes')}</p><p className="m-0 text-[14px] text-amber-900">{t('driverLanding.day.sampleNote')}</p></div>
                        </div>
                      )}
                      <div className="flex items-end justify-between mt-3 mb-3">
                        <div><p className="m-0 text-[12px] font-semibold uppercase tracking-wide text-gray-500">{t('driverLanding.day.earnings')}</p><p className="m-0 text-[28px] font-bold text-[#1f7a46] leading-none mt-1">{nok(c.earning)}</p></div>
                        <p className="m-0 text-[13px] text-gray-500 text-end">{t('driverLanding.day.card.total', { amount: nok(SAMPLE_PRICE) })}<br />{t('driverLanding.day.card.commission', { rate: Math.round(c.rate * 100), amount: nok(c.commission) })}</p>
                      </div>
                      <span className="fg-press flex items-center justify-center gap-2 h-[52px] rounded-2xl bg-[#24513B] text-white text-[17px] font-semibold">
                        <Ico d={I.check} className="w-5 h-5" />{t(`driverPortal.${ACTION_KEY[stage.key]}`)}
                      </span>
                    </div>
                  </div>

                  <nav className="bg-white border-t border-gray-200 grid grid-cols-5 pt-2 pb-[30px]">
                    {PORTAL_TABS.map(tab => (
                      <span key={tab} className={`flex flex-col items-center gap-1 text-[10px] tracking-tight font-medium ${tab === 'jobs' ? 'text-[#24513B]' : 'text-gray-500'}`}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={tab === 'jobs' ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round">{TAB_ICON[tab]}</svg>
                        {t(`driverPortal.${tab}`)}
                      </span>
                    ))}
                  </nav>
                </div>
                <span className="pointer-events-none absolute inset-0 z-30 rounded-[40.5px] bg-[linear-gradient(118deg,rgba(255,255,255,.14)_0%,rgba(255,255,255,.04)_28%,rgba(255,255,255,0)_42%)]" />
                <span className="absolute z-30 bottom-[7px] left-1/2 -translate-x-1/2 w-[35%] h-[4.5px] rounded-full bg-black" />
              </div>
            </div>
          </div>
        </div>
        <figcaption className="relative z-10 mt-5 text-center text-[12px] font-semibold text-[#7A6436]">{t('driverLanding.day.sample', { plan: planName })}</figcaption>
      </figure>

      {/* Four steps; the active one in a pill */}
      <div className="[grid-area:steps] self-end min-w-0 max-md:sticky max-md:top-[121px] max-md:z-20 max-md:-mx-5 max-md:px-5 max-md:py-3 max-md:bg-[#FBF8F1]/95 max-md:backdrop-blur max-md:border-b max-md:border-[#EDE6D6]">
      <div role="tablist" aria-label={t('driverLanding.day.stagesLabel')} onKeyDown={onKey} className="relative grid grid-cols-4 min-w-0">
        <span aria-hidden="true" className="absolute top-[21px] start-[12.5%] end-[12.5%] h-[2px] bg-[#E2DACA]" />
        <span aria-hidden="true" className="absolute top-[21px] start-[12.5%] h-[2px] bg-[#24513B] transition-all duration-500" style={{ width: `${(ix / 3) * 75}%` }} />
        {STAGES.map((st, i) => (
          <button key={st.key} ref={el => { tabs.current[i] = el; }} type="button" role="tab" id={`day-tab-${st.key}`} aria-selected={i === ix} aria-controls="day-panel" tabIndex={i === ix ? 0 : -1}
                  onClick={() => choose(i)} className={`relative flex flex-col items-center gap-2.5 ${focus}`}>
            <span className={`w-11 h-11 rounded-full flex items-center justify-center text-[16px] border-2 transition ${i <= ix ? 'bg-[#24513B] border-[#24513B] text-white' : 'bg-[#FFFEFA] border-[#CFC7B5] text-[#4A5260]'} ${i === ix ? 'ring-[5px] ring-[#24513B]/15' : ''}`} style={serif}>{i < ix ? '✓' : i + 1}</span>
            <span className={`relative overflow-hidden text-[13px] sm:text-[14px] font-bold text-center leading-tight px-3 py-1.5 rounded-full transition ${i === ix ? 'bg-[#24513B] text-white' : 'text-[#4A5260]'}`}>
              {t(`driverLanding.day.stages.${st.key}.label`)}
              {i === ix && playing && <span key={`p${ix}`} aria-hidden="true" className="fg-step-progress absolute left-0 bottom-0 h-[2px] bg-[#DCC9A0]" style={{ animationDuration: `${AUTO_MS}ms` }} />}
            </span>
          </button>
        ))}
      </div>
      </div>

      {/* What the chosen step means */}
      <div className="[grid-area:panel] min-w-0 self-start">
        <div id="day-panel" role="tabpanel" aria-labelledby={`day-tab-${stage.key}`} className="rounded-[24px] bg-[#FFFEFA] border border-[#EDE6D6] shadow-[0_40px_80px_-50px_rgba(23,33,46,.45)] overflow-hidden">
          <div key={ix} className="fg-stage min-[1360px]:grid min-[1360px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="p-7 md:p-9">
              <p className="inline-block m-0 mb-4 px-3.5 py-1.5 rounded-full text-[11px] font-bold tracking-[.12em] uppercase text-[#7A6436] bg-[#F3EEE2]">{t('driverLanding.day.stepOf', { n: ix + 1, total: STAGES.length })}</p>
              <h3 className="text-[32px] md:text-[40px] !font-normal !tracking-[-.015em] leading-[1.05] m-0 mb-3 text-[#17212E]" style={serif}>{t(`driverLanding.day.stages.${stage.key}.title`)}</h3>
              <p className="text-[15px] leading-relaxed text-[#4A5260] m-0 mb-6">{t(`driverLanding.day.stages.${stage.key}.text`)}</p>
              <ul className="list-none p-0 m-0 space-y-3">
                {(['p1', 'p2', 'p3'] as const).map(pk => (
                  <li key={pk} className="flex gap-3 text-[14.5px] leading-snug text-[#17212E]">
                    <span aria-hidden="true" className="flex-shrink-0 w-[22px] h-[22px] rounded-full bg-[#24513B] text-white flex items-center justify-center"><Ico d={I.check} className="w-3.5 h-3.5" /></span>
                    {t(`driverLanding.day.stages.${stage.key}.${pk}`)}
                  </li>
                ))}
              </ul>
            </div>
            <dl className="m-0 p-7 md:p-8 border-t min-[1360px]:border-t-0 min-[1360px]:border-s border-[#EDE6D6] bg-[#FBF8F1]/60 flex flex-col justify-center gap-4 text-[14px]">
              <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#EDE6D6]"><dt className="flex items-center gap-2.5 text-[#4A5260] whitespace-nowrap"><span className="text-[#9F8249]"><Ico d={I.coins} /></span>{t('driverLanding.day.total')}</dt><dd className="m-0 text-[18px] whitespace-nowrap" style={serif}>{nok(SAMPLE_PRICE)}</dd></div>
              <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#EDE6D6]"><dt className="flex items-center gap-2.5 text-[#4A5260] whitespace-nowrap"><span className="text-[#9F8249]"><Ico d={I.percent} /></span>{t('driverLanding.day.commission', { rate: Math.round(c.rate * 100) })}</dt><dd className="m-0 text-[18px] whitespace-nowrap" style={serif}>{nok(c.commission)}</dd></div>
              <div className="flex items-center justify-between gap-4 rounded-2xl bg-[#E8F0EA] px-4 py-3.5"><dt className="flex items-center gap-2.5 font-semibold text-[#1f4a33] whitespace-nowrap"><span><Ico d={I.wallet} /></span>{t('driverLanding.day.earnings')}</dt><dd className="m-0 text-[21px] text-[#1f4a33] whitespace-nowrap" style={serif}>{nok(c.earning)}</dd></div>
              <p className="m-0 text-[12px] text-[#4A5260] leading-relaxed">{t('driverLanding.day.moneyNote')}</p>
            </dl>
          </div>
          {/* The panel's foot: where you are, and the way on */}
          <div className="flex items-center justify-between gap-4 px-7 md:px-9 py-4 border-t border-[#EDE6D6] bg-[#FFFEFA]">
            <span className="flex gap-2" aria-hidden="true">{STAGES.map((st, i) => <span key={st.key} className={`h-2 rounded-full transition-all ${i === ix ? 'w-7 bg-[#24513B]' : 'w-2 bg-[#CFC7B5]'}`} />)}</span>
            <span className="flex items-center gap-3">
              <button type="button" onClick={() => choose((ix + 3) % 4)} aria-label={t('driverLanding.day.prev')} className={`w-11 h-11 rounded-full border border-[#CFC7B5] bg-[#FFFEFA] hover:bg-[#F3EEE2] ${focus}`}>←</button>
              <button type="button" onClick={() => choose((ix + 1) % 4)} aria-label={t('driverLanding.day.next')} className={`w-11 h-11 rounded-full bg-[#24513B] hover:bg-[#1C4130] text-white ${focus}`}>→</button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── For a company with several vans (item 14) ────────────────────────────────────────────────── */
export function FleetSection({ onCompany }: { onCompany: () => void }) {
  const { t } = useTranslation();
  const steps = ['register', 'team', 'drivers', 'grow'] as const;
  return (
    <div className="grid lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)] gap-10 lg:gap-16">
      <div>
        <p className="text-xs font-bold tracking-[.16em] uppercase text-[#7A6436] mb-3">{t('driverLanding.fleet.eyebrow')}</p>
        <h2 className="text-[36px] md:text-[48px] font-bold tracking-[-.04em] leading-[1.04] mb-5">{t('driverLanding.fleet.title')}</h2>
        <p className="text-lg text-[#4A5260] leading-relaxed m-0 mb-8 max-w-[52ch]">{t('driverLanding.fleet.lede')}</p>
        <button type="button" onClick={onCompany} className={`min-h-[52px] px-6 bg-[#24513B] hover:bg-[#1C4130] text-white font-bold ${focus}`}>{t('driverLanding.fleet.cta')} →</button>
        <p className="mt-8 text-[14px] leading-relaxed text-[#4A5260] border-s-2 border-[#C3A66C] ps-4 max-w-[52ch]">{t('driverLanding.fleet.notYet')}</p>
      </div>
      <ol className="list-none p-0 m-0 border-t-2 border-[#17212E]">
        {steps.map((k, i) => (
          <li key={k} className="grid grid-cols-[56px_minmax(0,1fr)] gap-4 py-6 border-b border-[#E2DACA]">
            <span className="text-[40px] leading-none text-[#9F8249]" style={serif}>{i + 1}</span>
            <div>
              <h3 className="text-[19px] font-bold tracking-tight m-0 mb-1.5">{t(`driverLanding.fleet.${k}`)}</h3>
              <p className="text-[15px] leading-relaxed text-[#4A5260] m-0">{t(`driverLanding.fleet.${k}Desc`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ── The Driver Agreement in plain words (item 12) ────────────────────────────────────────────── */
export function TermsSummary({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const [all, setAll] = useState(false);
  const no = i18n.language === 'no';
  const nok = (n: number) => `${n.toLocaleString(no ? 'nb-NO' : 'en-GB')} NOK`;
  const vars = {
    goods: nok(DRIVER_TERMS.goodsInTransitMinNok), liability: nok(DRIVER_TERMS.publicLiabilityMinNok),
    days: DRIVER_TERMS.commissionDisputeDays,
  };
  return (
    <div>
      <ul className={`list-none p-0 m-0 grid ${compact ? 'gap-3' : 'md:grid-cols-3 gap-x-10 gap-y-8'}`}>
        {TERMS_SUMMARY.map(({ key, section }, i) => (
          <li key={key} className={compact ? 'text-[14px] leading-relaxed' : (i >= 3 && !all ? 'hidden md:block' : '')}>
            {compact ? <><b>{t(`driverLanding.terms.${key}`)}.</b> {t(`driverLanding.terms.${key}Desc`, vars)}</> : (
              <>
                <p className="m-0 mb-1 text-xs font-bold tracking-[.12em] uppercase text-[#7A6436]">{t('driverLanding.terms.section', { n: section })}</p>
                <h3 className="text-[18px] font-bold tracking-tight m-0 mb-1.5">{t(`driverLanding.terms.${key}`)}</h3>
                <p className="text-[15px] leading-relaxed text-[#4A5260] m-0">{t(`driverLanding.terms.${key}Desc`, vars)}</p>
              </>
            )}
          </li>
        ))}
      </ul>
      {!compact && (
        <button type="button" onClick={() => setAll(v => !v)} aria-expanded={all}
                className={`md:hidden mt-6 min-h-[44px] px-5 border border-[#CFC7B5] bg-white font-semibold text-[15px] ${focus}`}>
          {all ? t('driverLanding.terms.showFewer') : t('driverLanding.terms.showAll', { n: TERMS_SUMMARY.length })}
        </button>
      )}
      <p className={`${compact ? 'mt-4 text-[13px]' : 'mt-10 text-[14px]'} text-[#4A5260]`}>
        {t('driverLanding.terms.note', { date: DRIVER_TERMS.lastUpdated })}{' '}
        <a href="/driver-terms" target="_blank" rel="noopener noreferrer" className={`font-bold text-[#24513B] underline underline-offset-4 ${focus}`}>{t('driverLanding.terms.full')}</a>
      </p>
    </div>
  );
}
