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
import { DEFAULT_SUPPORT_EMAIL, useCompanyIdentity } from '../../lib/companyIdentity';
import { useTranslation } from 'react-i18next';
import { SUBSCRIPTION_PLANS, calculateCommission } from '../../lib/constants';
import { CANCELLATION_POLICY } from '../../../supabase/functions/_shared/pricing';
import { DRIVER_TERMS, TERMS_SUMMARY } from '../../lib/driverTerms';
import { JobCard, calcCommission } from './PortalCards';

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
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-0 border border-[#DCD4C2] bg-[#FFFEFA]">
      <div className="p-6 md:p-9 min-w-0">
        <div role="radiogroup" aria-label={t('driverLanding.picker.label')} className="flex sm:grid sm:grid-cols-5 gap-2 sm:gap-0 overflow-x-auto [scrollbar-width:none] -mx-1 px-1 sm:mx-0 sm:px-0 sm:border sm:border-[#DCD4C2]">
          {SUBSCRIPTION_PLANS.map((pl, i) => (
            <button key={pl.id} type="button" role="radio" aria-checked={i === ix} onClick={() => setIx(i)}
                    className={`flex-shrink-0 whitespace-nowrap min-h-[48px] sm:min-h-[52px] px-4 sm:px-1 text-sm font-bold transition border sm:border-0 sm:border-s sm:first:border-s-0 border-[#DCD4C2] ${focus} ${i === ix ? 'bg-[#24513B] border-[#24513B] text-white' : 'bg-white sm:bg-transparent text-[#17212E] hover:bg-[#F3EEE2]'}`}>
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

export function DayOnFlyttGo() {
  const { t, i18n } = useTranslation();
  const no = i18n.language === 'no';
  const nok = (n: number) => `${Math.round(n).toLocaleString(no ? 'nb-NO' : 'en-GB')} NOK`;
  const [ix, setIx] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const stage = STAGES[ix];
  const c = calcCommission(SAMPLE_PRICE, SAMPLE_PLAN);
  const planName = SUBSCRIPTION_PLANS.find(p => p.id === SAMPLE_PLAN)?.name ?? SAMPLE_PLAN;
  const started = new Date(Date.now() - 74 * 60_000).toISOString();
  const ended = new Date(Date.now() - 2 * 60_000).toISOString();
  const job = {
    id: 'sample', status: stage.status, pickup_address: 'Storgata 12, 0184 Oslo', dropoff_address: 'Bogstadveien 40, 0366 Oslo',
    price_estimate: SAMPLE_PRICE, estimated_hours: 3, helpers: 1, additional_services: ['furniture_assembly'],
    move_date: new Date().toISOString().slice(0, 10), driver_id: 'sample-driver',
    customer_notes: ix > 0 ? t('driverLanding.day.sampleNote') : null,
    ...(ix >= 2 ? { start_time: started } : {}), ...(ix === 3 ? { end_time: ended, actual_hours: 1.2 } : {}),
  };
  const go = (n: number) => { const i = (n + STAGES.length) % STAGES.length; setIx(i); tabs.current[i]?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(ix + (document.dir === 'rtl' ? -1 : 1)); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(ix - (document.dir === 'rtl' ? -1 : 1)); }
    if (e.key === 'Home') { e.preventDefault(); go(0); }
    if (e.key === 'End') { e.preventDefault(); go(STAGES.length - 1); }
  };
  const benefits = ['jobs', 'earnings', 'workflow', 'payment'] as const;

  return (
    <div className="grid gap-x-10 gap-y-8 xl:gap-x-14 md:pt-4 [grid-template-areas:'intro'_'steps'_'phone'_'panel'] md:grid-cols-[auto_minmax(0,1fr)] md:[grid-template-areas:'intro_intro'_'phone_steps'_'phone_panel'] xl:grid-cols-[minmax(0,.72fr)_auto_minmax(0,1.28fr)] xl:[grid-template-areas:'intro_phone_steps'_'intro_phone_panel'] md:grid-rows-[auto_auto_1fr] xl:grid-rows-[auto_1fr]">
      {/* The story in one line, and what the demonstration shows */}
      <div className="[grid-area:intro] xl:self-center">
        <p className="text-xs font-bold tracking-[.16em] uppercase text-[#7A6436] mb-3">{t('driverLanding.day.eyebrow')}</p>
        <h2 className="text-[36px] md:text-[44px] !font-normal !tracking-[-.01em] leading-[1.06] m-0 mb-5" style={serif}>{t('driverLanding.day.title')}</h2>
        <p className="text-[17px] text-[#4A5260] leading-relaxed m-0 mb-8 max-w-[44ch]">{t('driverLanding.day.lede')}</p>
        <ul className="list-none p-0 m-0 space-y-5">
          {benefits.map((k, i) => (
            <li key={k} className="grid grid-cols-[36px_minmax(0,1fr)] gap-3">
              <span aria-hidden="true" className="w-9 h-9 flex items-center justify-center border border-[#DCC9A0] bg-[#FFFEFA] text-[#9F8249] text-[15px]" style={serif}>{i + 1}</span>
              <span><b className="block text-[16px] tracking-tight">{t(`driverLanding.day.b.${k}`)}</b><span className="block text-[14px] text-[#4A5260] leading-snug">{t(`driverLanding.day.b.${k}Desc`)}</span></span>
            </li>
          ))}
        </ul>
      </div>

      {/* One phone: the driver portal's own job card for the chosen stage */}
      <figure className="[grid-area:phone] m-0 justify-self-center self-start xl:self-center">
        {/* A 6.1-inch phone drawn to its proportions (71.6 × 147.6 mm): aluminium edge, thin even bezel,
          * Dynamic Island, the buttons where they sit (Action and volume left; side button and Camera Control
          * right), status bar and home indicator. Drawn in CSS: no product photograph. */}
        <div aria-hidden="true" className="fg-phone relative w-[300px] sm:w-[320px] aspect-[71.6/147.6]">
          {/* buttons */}
          <span className="fg-phone-btn absolute -start-[3.5px] top-[17%] h-[4.6%] w-[3px] rounded-s-[2px]" />
          <span className="fg-phone-btn absolute -start-[3.5px] top-[25%] h-[8.4%] w-[3px] rounded-s-[2px]" />
          <span className="fg-phone-btn absolute -start-[3.5px] top-[35.4%] h-[8.4%] w-[3px] rounded-s-[2px]" />
          <span className="fg-phone-btn absolute -end-[3.5px] top-[27%] h-[13%] w-[3px] rounded-e-[2px]" />
          <span className="fg-phone-btn absolute -end-[3px] top-[56%] h-[7.6%] w-[2.5px] rounded-e-[2px] opacity-80" />
          {/* aluminium edge, black bezel, screen */}
          <div className="fg-phone-edge absolute inset-0 rounded-[54px] p-[3px]">
            <div className="h-full rounded-[51px] bg-black p-[9px]">
              <div className="relative h-full rounded-[43px] overflow-hidden bg-gray-50">
                <span className="absolute top-[11px] left-1/2 -translate-x-1/2 w-[33%] h-[31px] rounded-full bg-black z-10">
                  <span className="absolute right-[12px] top-1/2 -translate-y-1/2 w-[9px] h-[9px] rounded-full bg-[#14161c] ring-1 ring-[#23262e]" />
                </span>
                <div className="flex items-center justify-between h-[52px] ps-8 pe-7 text-[14px] font-semibold text-gray-900 tracking-tight">
                  <span>9:41</span>
                  <span className="flex items-center gap-[5px]">
                    <svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="7" width="3" height="4" rx=".8" fill="currentColor"/><rect x="4.6" y="5" width="3" height="6" rx=".8" fill="currentColor"/><rect x="9.2" y="2.6" width="3" height="8.4" rx=".8" fill="currentColor"/><rect x="13.8" y="0" width="3" height="11" rx=".8" fill="currentColor"/></svg>
                    <svg width="15" height="11" viewBox="0 0 15 11"><path d="M7.5 2.2c2 0 3.9.8 5.3 2.1l1.1-1.1A9 9 0 0 0 7.5.6 9 9 0 0 0 1.1 3.2l1.1 1.1A7.5 7.5 0 0 1 7.5 2.2Zm0 3.2c1.2 0 2.3.4 3.1 1.2l1.1-1.1a6 6 0 0 0-8.4 0l1.1 1.1c.8-.8 1.9-1.2 3.1-1.2Zm0 3.1c-.5 0-.9.2-1.2.5L7.5 10.2 8.7 9a1.7 1.7 0 0 0-1.2-.5Z" fill="currentColor"/></svg>
                    <svg width="26" height="12" viewBox="0 0 26 12"><rect x=".5" y=".5" width="22" height="11" rx="3.4" fill="none" stroke="currentColor" opacity=".38"/><rect x="2" y="2" width="16.5" height="8" rx="2" fill="currentColor"/><path d="M24 4v4c.8-.3 1.3-1.1 1.3-2S24.8 4.3 24 4Z" fill="currentColor" opacity=".45"/></svg>
                  </span>
                </div>
            <div className="flex items-center justify-between px-4 mt-3 mb-2">
              <span className="text-[14px] font-bold text-gray-900">FlyttGo Driver</span>
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">{t('driverPortal.online')}</span>
            </div>
            <div className="flex gap-1.5 px-4 pb-3 overflow-hidden">
              {PORTAL_TABS.map(tab => (
                <span key={tab} className={`flex-shrink-0 px-2.5 py-1 rounded text-[11px] font-medium ${tab === 'jobs' ? 'bg-black text-white' : 'bg-gray-200 text-gray-700'}`}>{t(`driverPortal.${tab}`)}</span>
              ))}
            </div>
            <div key={ix} className="fg-stage px-3">
              {/* The Jobs tab's map card, as the portal shows it above the list (the map itself opens on tap). */}
              <div className="origin-top-left scale-[.9] w-[111.2%] mb-[-4px]">
                <div className="bg-white rounded-xl border p-4 flex items-center justify-between">
                  <div><p className="font-bold text-gray-900 text-sm m-0">📍 {t('driverPortal.mapView')}</p><p className="text-xs text-gray-500 m-0">Tap a pin to see job details and accept.</p></div>
                  <span className="flex-shrink-0 ms-3 whitespace-nowrap text-xs font-semibold text-emerald-600">{t('driverPortal.showMap')}</span>
                </div>
              </div>
              <div className="origin-top-left scale-[.9] w-[111.2%]">
                <JobCard preview job={job} plan={SAMPLE_PLAN} driverId="sample-driver" />
              </div>
            </div>
                <span className="absolute bottom-[8px] left-1/2 -translate-x-1/2 w-[36%] h-[5px] rounded-full bg-black/85" />
              </div>
            </div>
          </div>
        </div>
        <figcaption className="mt-4 text-center text-[12px] font-semibold text-[#7A6436]">{t('driverLanding.day.sample', { plan: planName })}</figcaption>
      </figure>

      {/* The four stages and what the chosen one means */}
      <div role="tablist" aria-label={t('driverLanding.day.stagesLabel')} onKeyDown={onKey} className="[grid-area:steps] self-end relative grid grid-cols-4 min-w-0">
          <span aria-hidden="true" className="absolute top-[19px] start-[12.5%] end-[12.5%] h-px bg-[#DCD4C2]" />
          <span aria-hidden="true" className="absolute top-[19px] start-[12.5%] h-px bg-[#24513B] transition-all duration-500" style={{ width: `${(ix / 3) * 75}%` }} />
          {STAGES.map((st, i) => (
            <button key={st.key} ref={el => { tabs.current[i] = el; }} type="button" role="tab" id={`day-tab-${st.key}`} aria-selected={i === ix} aria-controls="day-panel" tabIndex={i === ix ? 0 : -1}
                    onClick={() => setIx(i)} className={`relative flex flex-col items-center gap-2 ${focus}`}>
              <span className={`w-10 h-10 rounded-full flex items-center justify-center text-[15px] border-2 transition ${i < ix ? 'bg-[#24513B] border-[#24513B] text-white' : i === ix ? 'bg-[#24513B] border-[#24513B] text-white ring-4 ring-[#24513B]/15' : 'bg-[#FFFEFA] border-[#CFC7B5] text-[#4A5260]'}`} style={serif}>{i < ix ? '✓' : i + 1}</span>
              <span className={`text-[13px] sm:text-[14px] font-bold text-center leading-tight ${i === ix ? 'text-[#17212E]' : 'text-[#4A5260]'}`}>{t(`driverLanding.day.stages.${st.key}.label`)}</span>
            </button>
          ))}
        </div>

      <div className="[grid-area:panel] min-w-0 self-start">
        <div id="day-panel" role="tabpanel" aria-labelledby={`day-tab-${stage.key}`} className="bg-[#FFFEFA] border border-[#E2DACA] shadow-[0_24px_48px_-36px_rgba(23,33,46,.35)]">
          <div key={ix} className="fg-stage">
            <div className="p-6 md:p-8">
              <p className="inline-block m-0 mb-4 px-3 py-1 text-[11px] font-bold tracking-[.12em] uppercase text-[#7A6436] bg-[#F3EEE2]">{t('driverLanding.day.stepOf', { n: ix + 1, total: STAGES.length })}</p>
              <h3 className="text-[30px] md:text-[34px] !font-normal !tracking-[-.01em] leading-[1.1] m-0 mb-3" style={serif}>{t(`driverLanding.day.stages.${stage.key}.title`)}</h3>
              <p className="text-[15px] leading-relaxed text-[#4A5260] m-0 mb-5">{t(`driverLanding.day.stages.${stage.key}.text`)}</p>
              <ul className="list-none p-0 m-0 space-y-2.5">
                {(['p1', 'p2', 'p3'] as const).map(pk => (
                  <li key={pk} className="flex gap-2.5 text-[14px] leading-snug">
                    <span aria-hidden="true" className="flex-shrink-0 w-5 h-5 rounded-full bg-[#24513B] text-white text-[11px] flex items-center justify-center mt-px">✓</span>
                    {t(`driverLanding.day.stages.${stage.key}.${pk}`)}
                  </li>
                ))}
              </ul>
            </div>
            <dl className="m-0 px-6 md:px-8 py-5 border-t border-[#E2DACA] grid grid-cols-2 2xl:grid-cols-3 gap-4 text-[13px]">
              <div className="flex flex-col-reverse gap-1"><dt className="text-[#4A5260]">{t('driverLanding.day.total')}</dt><dd className="m-0 text-[17px] sm:text-[20px] whitespace-nowrap" style={serif}>{nok(SAMPLE_PRICE)}</dd></div>
              <div className="flex flex-col-reverse gap-1"><dt className="text-[#4A5260]">{t('driverLanding.day.commission', { rate: Math.round(c.rate * 100) })}</dt><dd className="m-0 text-[17px] sm:text-[20px] whitespace-nowrap" style={serif}>{nok(c.commission)}</dd></div>
              <div className="col-span-2 2xl:col-span-1 flex flex-col-reverse gap-1 bg-[#EEF3EF] 2xl:-my-2 px-3 py-2"><dt className="font-semibold text-[#1f4a33]">{t('driverLanding.day.earnings')}</dt><dd className="m-0 text-[18px] sm:text-[22px] text-[#1f4a33] whitespace-nowrap" style={serif}>{nok(c.earning)}</dd></div>
              <p className="col-span-2 2xl:col-span-3 m-0 text-[12px] text-[#4A5260]">{t('driverLanding.day.moneyNote')}</p>
            </dl>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-5">
          <button type="button" onClick={() => setIx((ix + 3) % 4)} aria-label={t('driverLanding.day.prev')} className={`w-11 h-11 rounded-full border border-[#CFC7B5] bg-[#FFFEFA] hover:bg-[#F3EEE2] ${focus}`}>←</button>
          <span className="flex gap-2" aria-hidden="true">{STAGES.map((st, i) => <span key={st.key} className={`h-2 rounded-full transition-all ${i === ix ? 'w-6 bg-[#24513B]' : 'w-2 bg-[#CFC7B5]'}`} />)}</span>
          <button type="button" onClick={() => setIx((ix + 1) % 4)} aria-label={t('driverLanding.day.next')} className={`w-11 h-11 rounded-full bg-[#24513B] hover:bg-[#1C4130] text-white ${focus}`}>→</button>
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
