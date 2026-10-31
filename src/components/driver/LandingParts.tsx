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
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SUBSCRIPTION_PLANS, calculateCommission } from '../../lib/constants';
import { CANCELLATION_POLICY } from '../../../supabase/functions/_shared/pricing';
import { DRIVER_TERMS, TERMS_SUMMARY } from '../../lib/driverTerms';
import { JobCard, WalletPanel, calcCommission } from './PortalCards';

const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24513B]';
const serif = { fontFamily: 'Georgia, "Times New Roman", serif' };
type Plan = (typeof SUBSCRIPTION_PLANS)[number];
const PRIORITY_NO: Record<string, string> = { Standard: 'Standard', Moderate: 'Moderat', High: 'Høy', 'Very High': 'Svært høy', Highest: 'Høyest' };

export function PlanPicker({ onFullPlans }: { onFullPlans: () => void }) {
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
    <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-0 border border-[#DCD4C2] bg-[#FFFEFA]">
      <div className="p-6 md:p-9">
        <div role="radiogroup" aria-label={t('driverLanding.picker.label')} className="grid grid-cols-5 border border-[#DCD4C2]">
          {SUBSCRIPTION_PLANS.map((pl, i) => (
            <button key={pl.id} type="button" role="radio" aria-checked={i === ix} onClick={() => setIx(i)}
                    className={`min-h-[52px] px-1 text-[13px] sm:text-sm font-bold transition border-s first:border-s-0 border-[#DCD4C2] ${focus} ${i === ix ? 'bg-[#24513B] text-white' : 'text-[#17212E] hover:bg-[#F3EEE2]'}`}>
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
        <button type="button" onClick={onFullPlans} className={`mt-7 font-bold text-[#24513B] underline underline-offset-4 ${focus}`}>{t('driverLanding.fullPlans')} →</button>
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
  const steps = ['book', 'held', 'work', 'confirm', 'wallet'] as const;
  return (
    <ol className="fg-escrow list-none p-0 m-0 grid sm:grid-cols-5 gap-6 sm:gap-0 relative">
      <span aria-hidden="true" className="fg-escrow-line hidden sm:block absolute top-[22px] start-[10%] end-[10%] h-[2px] bg-[#DCD4C2]"><span className="block h-full bg-[#24513B]" /></span>
      {steps.map((k, i) => (
        <li key={k} className="relative sm:text-center sm:px-3 flex sm:block gap-4">
          <span className="relative z-10 flex-shrink-0 sm:mx-auto flex items-center justify-center w-11 h-11 rounded-full bg-[#FFFEFA] border-2 border-[#24513B] text-[#24513B] font-bold" style={serif}>{i + 1}</span>
          <div>
            <h3 className="text-[17px] font-bold tracking-tight mt-0 sm:mt-4 mb-1">{t(`driverLanding.escrow.${k}`)}</h3>
            <p className="text-[14px] leading-relaxed text-[#4A5260] m-0">{t(`driverLanding.escrow.${k}Desc`)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function DriverFaq() {
  const { t, i18n } = useTranslation();
  const no = i18n.language === 'no';
  const nok = (n: number) => `${n.toLocaleString(no ? 'nb-NO' : 'en-GB')} NOK`;
  const free = SUBSCRIPTION_PLANS[0];
  const freeUpTo = Number(/up to (\d+)/i.exec(free.jobVisibility)?.[1] ?? 500);
  const vars: Record<string, Record<string, string | number>> = {
    cost: { plan: free.name, amount: nok(freeUpTo) },
    commission: { amount: nok(500) },
    payout: { amount: nok(500) },
    cancel: { hours: CANCELLATION_POLICY.freeUntilHoursBefore, share: Math.round(CANCELLATION_POLICY.lateCustomerShare * 100) },
  };
  const items = ['cost', 'commission', 'payout', 'paid', 'cancel', 'after', 'vehicle', 'insurance', 'company', 'switch'] as const;
  return (
    <div className="divide-y divide-[#E2DACA] border-y border-[#E2DACA]">
      {items.map(k => (
        <details key={k} className="group py-1">
          <summary className={`flex items-center justify-between gap-6 py-5 cursor-pointer list-none text-[18px] font-bold tracking-tight ${focus}`}>
            {t(`driverLanding.faq.${k}Q`)}
            <span aria-hidden="true" className="flex-shrink-0 w-8 h-8 rounded-full border border-[#CFC7B5] flex items-center justify-center text-[#24513B] transition group-open:rotate-45">+</span>
          </summary>
          <p className="m-0 pb-6 pe-12 text-[16px] leading-relaxed text-[#4A5260] max-w-[75ch]">{t(`driverLanding.faq.${k}A`, vars[k] ?? {})}</p>
        </details>
      ))}
    </div>
  );
}

/* ── A day on FlyttGo (items 5 and 6) ─────────────────────────────────────────────────────────── */
const SAMPLE_PLAN = 'pro_mini';
const SAMPLE_PRICE = 2500;
function sampleJob(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'sample', status, pickup_address: 'Storgata 12, 0184 Oslo', dropoff_address: 'Bogstadveien 40, 0366 Oslo',
    price_estimate: SAMPLE_PRICE, estimated_hours: 3, helpers: 1, additional_services: ['furniture_assembly'],
    move_date: new Date().toISOString().slice(0, 10), driver_id: 'sample-driver',
    customer_notes: status === 'awaiting_driver' ? null : '', ...extra,
  };
}

export function DayOnFlyttGo() {
  const { t } = useTranslation();
  const track = useRef<HTMLOListElement>(null);
  const started = new Date(Date.now() - 74 * 60_000).toISOString();
  const ended = new Date(Date.now() - 2 * 60_000).toISOString();
  const earning = Math.round(calcCommission(SAMPLE_PRICE, SAMPLE_PLAN).earning);
  const screens: { key: string; tab: string; screen: JSX.Element }[] = [
    { key: 'accept', tab: 'jobs', screen: <JobCard preview job={sampleJob('awaiting_driver')} plan={SAMPLE_PLAN} /> },
    { key: 'drive', tab: 'jobs', screen: <JobCard preview job={sampleJob('driver_assigned')} plan={SAMPLE_PLAN} /> },
    { key: 'work', tab: 'jobs', screen: <JobCard preview job={sampleJob('in_transit', { start_time: started })} plan={SAMPLE_PLAN} /> },
    { key: 'confirm', tab: 'jobs', screen: <JobCard preview job={sampleJob('completed', { start_time: started, end_time: ended, actual_hours: 1.2 })} plan={SAMPLE_PLAN} /> },
    { key: 'paid', tab: 'wallet', screen: <WalletPanel preview wallet={{ balance: earning, pending: 0, total_earned: earning }}
                                                     transactions={[{ id: 's', description: t('driverLanding.day.sampleTx'), amount: earning }]} /> },
  ];
  const scrollBy = (dir: number) => {
    const el = track.current; if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * Math.min(el.clientWidth, 360) * (document.dir === 'rtl' ? -1 : 1), behavior: reduce ? 'auto' : 'smooth' });
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        <p className="m-0 text-[13px] font-semibold text-[#7A6436]">{t('driverLanding.day.sample', { plan: SUBSCRIPTION_PLANS.find(p => p.id === SAMPLE_PLAN)?.name ?? SAMPLE_PLAN })}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => scrollBy(-1)} aria-label={t('driverLanding.day.prev')} className={`w-11 h-11 border border-[#CFC7B5] bg-white hover:bg-[#F3EEE2] ${focus}`}>←</button>
          <button type="button" onClick={() => scrollBy(1)} aria-label={t('driverLanding.day.next')} className={`w-11 h-11 border border-[#CFC7B5] bg-white hover:bg-[#F3EEE2] ${focus}`}>→</button>
        </div>
      </div>
      <ol ref={track} className="list-none p-0 m-0 flex gap-8 overflow-x-auto snap-x snap-mandatory pb-6 [scrollbar-width:thin]">
        {screens.map((s, i) => (
          <li key={s.key} className="snap-start flex-shrink-0 w-[300px] sm:w-[320px]">
            <div aria-hidden="true" className="relative h-[470px] rounded-[38px] border-[10px] border-[#17212E] bg-gray-50 overflow-hidden shadow-[0_24px_48px_-24px_rgba(23,33,46,.45)]">
              <div className="absolute top-0 inset-x-0 h-6 flex justify-center"><span className="mt-1.5 w-20 h-4 rounded-full bg-[#17212E]" /></div>
              <div className="pt-9 px-3 pb-3 h-full overflow-hidden">
                <div className="flex items-center justify-between px-1 mb-3">
                  <span className="text-[13px] font-bold text-gray-900">FlyttGo Driver</span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-black text-white capitalize">{t(`driverPortal.${s.tab}`)}</span>
                </div>
                <div className="origin-top-left scale-[.92] w-[108.7%]">{s.screen}</div>
              </div>
            </div>
            <p className="mt-6 mb-1 text-[13px] font-bold tracking-[.12em] uppercase text-[#9F8249]">{t('driverLanding.day.stepN', { n: i + 1 })}</p>
            <h3 className="text-[19px] font-bold tracking-tight m-0 mb-1.5">{t(`driverLanding.day.${s.key}`)}</h3>
            <p className="text-[14px] leading-relaxed text-[#4A5260] m-0">{t(`driverLanding.day.${s.key}Desc`)}</p>
          </li>
        ))}
      </ol>
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
  const no = i18n.language === 'no';
  const nok = (n: number) => `${n.toLocaleString(no ? 'nb-NO' : 'en-GB')} NOK`;
  const vars = {
    goods: nok(DRIVER_TERMS.goodsInTransitMinNok), liability: nok(DRIVER_TERMS.publicLiabilityMinNok),
    days: DRIVER_TERMS.commissionDisputeDays,
  };
  return (
    <div>
      <ul className={`list-none p-0 m-0 grid ${compact ? 'gap-3' : 'md:grid-cols-3 gap-x-10 gap-y-8'}`}>
        {TERMS_SUMMARY.map(({ key, section }) => (
          <li key={key} className={compact ? 'text-[14px] leading-relaxed' : ''}>
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
      <p className={`${compact ? 'mt-4 text-[13px]' : 'mt-10 text-[14px]'} text-[#4A5260]`}>
        {t('driverLanding.terms.note', { date: DRIVER_TERMS.lastUpdated })}{' '}
        <a href="/driver-terms" target="_blank" rel="noopener noreferrer" className={`font-bold text-[#24513B] underline underline-offset-4 ${focus}`}>{t('driverLanding.terms.full')}</a>
      </p>
    </div>
  );
}
