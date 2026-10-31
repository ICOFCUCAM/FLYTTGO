/**
 * Sections of /become-a-driver added on 31 October 2026 (owner: a premium, iconic driver page):
 *  - PlanPicker: the plans as a selector, with what a job of a chosen price leaves the driver on that plan
 *    (calculateCommission, the same rule the payout uses), labelled an example, not a promise.
 *  - EscrowFlow: how the money moves, drawn as a line that fills in.
 *  - DriverFaq: questions answered from the platform's own rules.
 * Every figure comes from SUBSCRIPTION_PLANS, the commission rule or the cancellation policy; none is typed here.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SUBSCRIPTION_PLANS, calculateCommission } from '../../lib/constants';
import { CANCELLATION_POLICY } from '../../../supabase/functions/_shared/pricing';

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
