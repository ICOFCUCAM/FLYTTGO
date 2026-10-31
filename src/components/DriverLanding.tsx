/**
 * The introduction above the driver application on /become-a-driver (owner, 31 October 2026): what
 * drivers and transport companies get, the four steps, every subscription plan read from
 * SUBSCRIPTION_PLANS (the same list as /driver-subscriptions, so the two never disagree), earning
 * without a website of your own, and what FlyttGo checks. The application form follows unchanged.
 * Shown with the new design (lib/siteDesign.ts).
 */
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import { SUBSCRIPTION_PLANS } from '../lib/constants';
import DriverGrowth from './DriverGrowth';

const PHOTO = 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766976394_04c23eab.jpg';
const PRIORITY_NO: Record<string, string> = { Standard: 'Standard', Moderate: 'Moderat', High: 'Høy', 'Very High': 'Svært høy', Highest: 'Høyest' };

type Plan = (typeof SUBSCRIPTION_PLANS)[number];

export default function DriverLanding() {
  const { t, i18n } = useTranslation();
  const { setPage } = useApp();
  const no = i18n.language === 'no';
  const nok = (n: number) => `${n.toLocaleString(no ? 'nb-NO' : 'en-GB')} NOK`;

  const price = (p: Plan) => p.price === 0 ? nok(0)
    : `${nok(p.price)} ${p.period === '/day' ? t('driverLanding.perDay') : t('driverLanding.perMonth')}`;
  const jobs = (p: Plan) => {
    const m = /up to (\d+)/i.exec(p.jobVisibility);
    const scope = m ? t('driverLanding.jobsUpTo', { amount: nok(Number(m[1])) }) : t('driverLanding.allJobs');
    const level = no ? (PRIORITY_NO[p.dispatchPriority] ?? p.dispatchPriority) : p.dispatchPriority;
    return p.priorityLevel <= 2 ? scope : `${scope}, ${t('driverLanding.priority', { level: level.toLowerCase() })}`;
  };
  const commission = (p: Plan) => {
    const rates = Object.values(p.commission as Record<string, number>);
    const lo = Math.min(...rates), hi = Math.max(...rates);
    return t('driverLanding.commission', { range: lo === hi ? `${lo}%` : `${lo}–${hi}%` });
  };
  const toForm = () => document.getElementById('driver-application')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const steps = [1, 2, 3, 4].map(i => [t(`driverLanding.step${i}`), t(`driverLanding.step${i}Desc`)]);

  return (
    <div className="bg-[#FFFEFA] text-[#17212E]">
      <section className="text-white py-20 md:py-24" style={{ background: `linear-gradient(90deg, rgb(32 63 104 / .96), rgb(32 63 104 / .82) 55%, rgb(32 63 104 / .4)), url(${PHOTO}) center / cover` }}>
        <div className="max-w-[1240px] mx-auto px-5 md:px-10">
          <p className="text-xs font-bold tracking-[.16em] uppercase text-[#DCC9A0] mb-3">{t('driverLanding.eyebrow')}</p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.02] max-w-[14ch] mb-4">{t('driverLanding.title')}</h1>
          <p className="text-lg leading-relaxed text-[#e6ebf2] max-w-[52ch] mb-7">{t('driverLanding.lede')}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={toForm} className="min-h-[52px] px-6 bg-[#C3A66C] hover:bg-[#b3955a] text-[#17212E] font-bold">{t('driverLanding.apply')} ↓</button>
            <button type="button" onClick={() => setPage('subscriptions')} className="min-h-[52px] px-6 border border-white/60 text-white font-bold hover:bg-white/10">{t('driverLanding.compare')}</button>
          </div>
        </div>
      </section>

      <div className="max-w-[1240px] mx-auto px-5 md:px-10">
        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-7 gap-y-6 border-t-2 border-[#C3A66C] mt-16 list-none p-0">
          {steps.map(([title, desc], i) => (
            <li key={title} className="pt-5">
              <span className="block text-4xl text-[#203F68]" style={{ fontFamily: 'Georgia, serif' }}>0{i + 1}</span>
              <h3 className="text-lg font-bold mt-2 mb-1">{title}</h3>
              <p className="text-[15px] leading-relaxed text-[#4a5260] m-0">{desc}</p>
            </li>
          ))}
        </ol>

        <h2 className="text-3xl md:text-[44px] font-bold tracking-tight leading-tight mt-20 mb-2">{t('driverLanding.plansTitle')}</h2>
        <p className="text-[#4a5260] mb-6 max-w-[80ch]">{t('driverLanding.plansLede')}</p>
        {/* Phones: one card per plan. */}
        <ul className="sm:hidden list-none p-0 m-0 border-t-2 border-[#17212E]">
          {SUBSCRIPTION_PLANS.map((p, i) => (
            <li key={p.id} className={`py-4 px-3 border-b border-[#e3ddcf] ${i === 0 ? 'bg-[#F5F3EB]' : ''}`}>
              <div className="flex items-baseline justify-between gap-3">
                <b className="text-[17px]">{p.name}{i === 0 && <span className="ml-2 text-[11px] font-bold tracking-[.08em] uppercase text-[#1f4a33]">{t('driverLanding.startHere')}</span>}</b>
                <span className="text-[15px] font-semibold whitespace-nowrap">{price(p)}</span>
              </div>
              <p className="m-0 mt-1 text-[14px] text-[#4a5260]">{jobs(p)} · {commission(p)}</p>
            </li>
          ))}
        </ul>
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[15px]">
            <thead>
              <tr>{['colPlan', 'colPrice', 'colJobs', 'colCommission'].map(k => (
                <th key={k} className="text-left text-xs font-bold tracking-[.12em] uppercase text-[#4a5260] px-3.5 py-3 border-b-2 border-[#17212E]">{t(`driverLanding.${k}`)}</th>))}</tr>
            </thead>
            <tbody>
              {SUBSCRIPTION_PLANS.map((p, i) => (
                <tr key={p.id} className={i === 0 ? 'bg-[#F5F3EB]' : ''}>
                  <td className="px-3.5 py-4 border-b border-[#e3ddcf] text-[17px] font-bold whitespace-nowrap">
                    {p.name}
                    {i === 0 && <span className="ml-2.5 align-middle text-[11px] font-bold tracking-[.08em] uppercase text-[#1f4a33] bg-[#eaf2ec] border border-[#bcd3c4] px-2 py-0.5">{t('driverLanding.startHere')}</span>}
                  </td>
                  <td className="px-3.5 py-4 border-b border-[#e3ddcf] whitespace-nowrap">{price(p)}</td>
                  <td className="px-3.5 py-4 border-b border-[#e3ddcf]">{jobs(p)}</td>
                  <td className="px-3.5 py-4 border-b border-[#e3ddcf] whitespace-nowrap">{commission(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid md:grid-cols-2 gap-10 mt-14 p-8 bg-[#F5F3EB] border-l-[3px] border-[#24513B]">
          <div>
            <h3 className="text-2xl font-bold tracking-tight mb-2">{t('driverLanding.companyTitle')}</h3>
            <p className="text-[#4a5260] leading-relaxed m-0">{t('driverLanding.companyText')}</p>
          </div>
          <div>
            <h3 className="text-2xl font-bold tracking-tight mb-2">{t('driverLanding.checkTitle')}</h3>
            <p className="text-[#4a5260] leading-relaxed m-0">{t('driverLanding.checkText')}</p>
          </div>
        </div>

        <DriverGrowth />

        <div className="flex justify-center pt-14 pb-6">
          <button type="button" onClick={toForm} className="min-h-[54px] px-7 bg-[#203F68] hover:bg-[#18304f] text-white font-bold">{t('driverLanding.apply')} ↓</button>
        </div>
      </div>
    </div>
  );
}
