/**
 * "Grow your company online" on /become-a-driver (owner, 31 October 2026): after the free plan, the
 * steps a transport company can pay for, in order: its own page (name, logo, colours), the page on
 * its own web address, website and invoicing, accounting, and selling under its own name. Prices
 * are read from the price lists FlyttGo keeps (white_label_plans, accounting_price), shown with
 * their status (proposed, pilot or confirmed; accounting provisional) and never typed here. Only
 * if a list cannot be read does a card fall back to the shipped proposal (migrations 00009, 00010,
 * 00015), labelled as a sample price. The price checker adds them up and says it is an estimate.
 * Presentation (owner, 31 October 2026): the steps as one ruled ladder, the price checker as a planning
 * tool on paper with the totals in forest green; intro: the company lead-in shown beside the heading.
 * Price checker upgrade (owner, 31 October 2026, item 15): sliders, a per month / first year view, and a PDF of
 * the estimate with each price's status, to show a partner or accountant.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import { loadPlans, type PriceStatus } from '../lib/whiteLabel';
import { supabase } from '../lib/supabase';
import { buildPdf, downloadPdf, type PdfLine } from '../lib/simplePdf';

type Code = 'branded' | 'branded_domain' | 'website_invoicing' | 'own_seller';
const CODES: Code[] = ['branded', 'branded_domain', 'website_invoicing', 'own_seller'];

interface Price { setup: number; monthly: number; feePct: number; feeMin: number; status: PriceStatus | 'sample' }
interface Tier { name: string; up_to: number | null; monthly_fee: number | null }

/* The proposals the migrations ship, used only when the price list cannot be read (shown as sample prices). */
const SAMPLE: Record<Code, Price> = {
  branded:           { setup: 2900,  monthly: 1490, feePct: 0, feeMin: 0,  status: 'sample' },
  branded_domain:    { setup: 4900,  monthly: 2490, feePct: 0, feeMin: 0,  status: 'sample' },
  website_invoicing: { setup: 1900,  monthly: 690,  feePct: 0, feeMin: 0,  status: 'sample' },
  own_seller:        { setup: 14900, monthly: 4990, feePct: 4, feeMin: 49, status: 'sample' },
};
const SAMPLE_TIERS: Tier[] = [
  { name: 'Start', up_to: 1000000, monthly_fee: 199 }, { name: 'Small', up_to: 5000000, monthly_fee: 499 },
  { name: 'Medium', up_to: 20000000, monthly_fee: 1290 }, { name: 'Large', up_to: 100000000, monthly_fee: 2990 },
  { name: 'Enterprise', up_to: null, monthly_fee: null },
];

export default function DriverGrowth({ intro }: { intro?: { title: string; text: string } } = {}) {
  const { t, i18n } = useTranslation();
  const { setPage } = useApp();
  const no = i18n.language === 'no';
  const fmt = (n: number) => n.toLocaleString(no ? 'nb-NO' : 'en-GB', { maximumFractionDigits: 0 });
  const nok = (n: number) => `${fmt(n)} NOK`;

  const [prices, setPrices] = useState<Record<Code, Price>>(SAMPLE);
  const [tiers, setTiers] = useState<{ list: Tier[]; status: 'provisional' | 'confirmed' | 'sample' }>({ list: SAMPLE_TIERS, status: 'sample' });
  useEffect(() => {
    let live = true;
    loadPlans().then(plans => {
      if (!live) return;
      const next = { ...SAMPLE };
      for (const p of plans) if ((CODES as string[]).includes(p.code) && p.active !== false) {
        next[p.code as Code] = { setup: Number(p.setup_fee), monthly: Number(p.monthly_fee), feePct: Number(p.platform_fee_pct ?? 0),
          feeMin: Number(p.platform_fee_min ?? 0), status: p.price_status };
      }
      setPrices(next);
    }).catch(() => {});
    void Promise.resolve(supabase.rpc('accounting_price')).then(({ data }) => {
      const d = data as { tiers?: Tier[]; price_status?: string } | null;
      if (live && d?.tiers?.length) setTiers({ list: d.tiers, status: d.price_status === 'confirmed' ? 'confirmed' : 'provisional' });
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const statusLabel = (s: Price['status'] | 'provisional') => t(`driverLanding.grow.status.${s}`);
  const lowest = tiers.list.find(x => x.monthly_fee != null)?.monthly_fee ?? null;

  /* The price checker. */
  const [plan, setPlan] = useState<Code | 'free'>('branded');
  const [tierIx, setTierIx] = useState(-1);
  const [bookings, setBookings] = useState(20);
  const [avg, setAvg] = useState(3000);
  const [view, setView] = useState<'month' | 'year'>('year');
  const est = useMemo(() => {
    const p = plan === 'free' ? null : prices[plan];
    const tier = tierIx >= 0 ? tiers.list[tierIx] : null;
    const acct = tier?.monthly_fee ?? 0;
    const fee = p && p.feePct > 0 ? Math.max(avg * p.feePct / 100, p.feeMin) * bookings : 0;
    const monthly = (p?.monthly ?? 0) + acct + fee;
    return { setup: p?.setup ?? 0, monthly, fee, acct, year: (p?.setup ?? 0) + monthly * 12, quote: !!tier && tier.monthly_fee == null };
  }, [plan, tierIx, bookings, avg, prices, tiers]);

  /* The estimate as a PDF: every line the panel shows, each price's status, and that it is an estimate. */
  const planTitle = (c: Code | 'free') => t(`driverLanding.grow.${({ free: 'free', branded: 'page', branded_domain: 'domain', website_invoicing: 'tools', own_seller: 'seller' } as const)[c]}.title`);
  function savePdf() {
    const p = plan === 'free' ? null : prices[plan];
    const tier = tierIx >= 0 ? tiers.list[tierIx] : null;
    const L: PdfLine[] = [
      { text: t('driverLanding.grow.checker.pdfTitle'), size: 20, bold: true, gap: 0 },
      { text: t('driverLanding.grow.checker.pdfMade', { date: new Date().toLocaleDateString(no ? 'nb-NO' : 'en-GB') }), size: 10, gap: 20 },
      { text: t('driverLanding.grow.checker.plan'), bold: true, gap: 34, right: planTitle(plan) },
      ...(p ? [{ text: `  ${statusLabel(p.status)} · ${t('driverLanding.grow.exMva')}`, size: 9, gap: 14 }] : []),
      { text: t('driverLanding.grow.checker.accounting'), bold: true, gap: 22, right: tier ? (tier.monthly_fee == null ? t('driverLanding.grow.byQuote') : `${nok(tier.monthly_fee)} ${t('driverLanding.perMonth')}`) : t('driverLanding.grow.checker.noAccounting') },
      ...(tier ? [{ text: `  ${statusLabel(tiers.status)} · ${t('driverLanding.grow.exMva')}`, size: 9, gap: 14 }] : []),
      ...(p && p.feePct > 0 ? [
        { text: t('driverLanding.grow.checker.bookings'), gap: 22, right: fmt(bookings) },
        { text: t('driverLanding.grow.checker.avg'), right: nok(avg) },
      ] : []),
      { text: t('driverLanding.grow.checker.setupFee'), gap: 30, right: nok(est.setup) },
      { text: t('driverLanding.grow.checker.monthly'), right: nok(est.monthly) },
      ...(est.fee > 0 ? [{ text: `  ${t('driverLanding.grow.checker.ofWhichFee')}`, size: 10, right: nok(est.fee) }] : []),
      ...(est.acct > 0 ? [{ text: `  ${t('driverLanding.grow.checker.ofWhichAccounting')}`, size: 10, right: nok(est.acct) }] : []),
      { text: t('driverLanding.grow.checker.year'), size: 14, bold: true, gap: 30, right: nok(est.year) },
      ...(est.quote ? [{ text: t('driverLanding.grow.checker.quote'), size: 10, gap: 22 }] : []),
      { text: t('driverLanding.grow.checker.disclaimer'), size: 9, gap: 34 },
      { text: 'flyttgo.no/become-a-driver', size: 9, gap: 14 },
    ];
    downloadPdf(buildPdf(L, { title: t('driverLanding.grow.checker.pdfTitle') }), 'flyttgo-price-estimate.pdf');
  }

  /* One rung of the ladder: its step, what it gives, and its price with the price's status. */
  const step = (key: string, code: Code | 'free' | 'accounting') => {
    const price = code === 'free' || code === 'accounting' ? null : prices[code];
    return (
      <li key={key} className={`grid md:grid-cols-[150px_minmax(0,1fr)_230px] gap-x-8 gap-y-2 py-7 px-4 md:px-6 border-b border-[#E1E6E3] ${code === 'free' ? 'bg-[#EEF3EF]' : ''}`}>
        <span className="text-xs font-bold tracking-[.12em] uppercase text-[#24513B] md:pt-1.5">{t(`driverLanding.grow.${key}.tag`)}</span>
        <div className="min-w-0">
          <h3 className="text-[21px] font-bold tracking-tight mb-1.5">{t(`driverLanding.grow.${key}.title`)}</h3>
          <p className="text-[15px] leading-relaxed text-[#4A5260] m-0 max-w-[62ch]">{t(`driverLanding.grow.${key}.text`)}</p>
        </div>
        <div className="md:text-end">
          {code === 'free' && <p className="m-0 text-2xl leading-tight" style={{ fontFamily: 'Georgia, serif' }}>{nok(0)}</p>}
          {price && (
            <>
              <p className="m-0 text-2xl leading-tight" style={{ fontFamily: 'Georgia, serif' }}>{nok(price.monthly)} <span className="text-sm font-semibold text-[#4A5260]" style={{ fontFamily: '"DM Sans", ui-sans-serif, sans-serif' }}>{t('driverLanding.perMonth')}</span></p>
              <p className="m-0 mt-1 text-sm text-[#4A5260]">
                {t('driverLanding.grow.setup', { amount: nok(price.setup) })}
                {price.feePct > 0 && <><br />{t('driverLanding.grow.fee', { pct: fmt(price.feePct), min: nok(price.feeMin) })}</>}
              </p>
            </>
          )}
          {code === 'accounting' && (
            <p className="m-0 text-2xl leading-tight" style={{ fontFamily: 'Georgia, serif' }}>{lowest != null ? t('driverLanding.grow.from', { amount: nok(lowest) }) : t('driverLanding.grow.byQuote')}
              {lowest != null && <span className="text-sm font-semibold text-[#4A5260]" style={{ fontFamily: '"DM Sans", ui-sans-serif, sans-serif' }}> {t('driverLanding.perMonth')}</span>}</p>
          )}
          {code !== 'free' && (
            <p className="m-0 mt-1.5 text-xs font-semibold text-[#24513B]">
              {statusLabel(code === 'accounting' ? tiers.status : price!.status)} · {t('driverLanding.grow.exMva')}
            </p>
          )}
        </div>
      </li>
    );
  };

  const input = `min-h-[48px] w-full border border-[#C8D0CB] bg-white px-3 text-[15px] text-[#17212E] outline-none focus:border-[#24513B] focus:ring-2 focus:ring-[#24513B]/25`;
  return (
    <div aria-labelledby="grow-title" role="region">
      <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] gap-8 lg:gap-16 items-end mb-12">
        <div>
          <p className="text-xs font-bold tracking-[.16em] uppercase text-[#24513B] mb-3">{t('driverLanding.grow.eyebrow')}</p>
          <h2 id="grow-title" className="text-[36px] md:text-[52px] font-bold tracking-[-.04em] leading-[1.02] mb-4">{t('driverLanding.grow.title')}</h2>
          <p className="text-lg text-[#4A5260] leading-relaxed m-0 max-w-[60ch]">{t('driverLanding.grow.lede')}</p>
        </div>
        {intro && (
          <div className="border-s-2 border-[#24513B] ps-6">
            <h3 className="text-[19px] font-bold tracking-tight mb-1.5">{intro.title}</h3>
            <p className="text-[15px] leading-relaxed text-[#4A5260] m-0">{intro.text}</p>
          </div>
        )}
      </div>

      <ol className="list-none p-0 m-0 border-t-2 border-[#17212E]">
        {step('free', 'free')}
        {step('page', 'branded')}
        {step('domain', 'branded_domain')}
        {step('tools', 'website_invoicing')}
        {step('accounting', 'accounting')}
        {step('seller', 'own_seller')}
      </ol>
      <p className="text-[13px] text-[#4A5260] mt-4 max-w-[90ch]">{t('driverLanding.grow.note')}</p>

      <div className="mt-16 grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] border border-[#E1E6E3]">
        <div className="bg-[#F3F6F5] p-7 md:p-10">
          <p className="text-xs font-bold tracking-[.16em] uppercase text-[#24513B] mb-2">{t('driverLanding.grow.checker.eyebrow')}</p>
          <h3 className="text-[28px] md:text-[34px] font-bold tracking-tight leading-tight mb-2">{t('driverLanding.grow.checker.title')}</h3>
          <p className="text-[#4A5260] text-[15px] mb-7 max-w-[52ch]">{t('driverLanding.grow.checker.lede')}</p>
          <div className="grid sm:grid-cols-2 gap-5">
            <label className="block text-sm font-semibold">{t('driverLanding.grow.checker.plan')}
              <select className={`${input} mt-1.5`} value={plan} onChange={e => setPlan(e.target.value as Code | 'free')}>
                <option value="free">{t('driverLanding.grow.free.title')}</option>
                <option value="branded">{t('driverLanding.grow.page.title')}</option>
                <option value="branded_domain">{t('driverLanding.grow.domain.title')}</option>
                <option value="website_invoicing">{t('driverLanding.grow.tools.title')}</option>
                <option value="own_seller">{t('driverLanding.grow.seller.title')}</option>
              </select>
            </label>
            <label className="block text-sm font-semibold">{t('driverLanding.grow.checker.accounting')}
              <select className={`${input} mt-1.5`} value={tierIx} onChange={e => setTierIx(Number(e.target.value))}>
                <option value={-1}>{t('driverLanding.grow.checker.noAccounting')}</option>
                {tiers.list.map((x, i) => {
                  const lower = i === 0 ? 0 : tiers.list[i - 1].up_to ?? 0;
                  const band = x.up_to == null ? t('driverLanding.grow.checker.above', { amount: nok(lower) })
                    : t('driverLanding.grow.checker.under', { amount: nok(x.up_to) });
                  return <option key={x.name} value={i}>{band}</option>;
                })}
              </select>
            </label>
            {plan !== 'free' && prices[plan].feePct > 0 && (
              <>
                <div className="sm:col-span-2">
                  <label htmlFor="gc-bookings" className="flex justify-between text-sm font-semibold"><span>{t('driverLanding.grow.checker.bookings')}</span><output htmlFor="gc-bookings" className="tabular-nums">{fmt(bookings)}</output></label>
                  <input id="gc-bookings" type="range" min={0} max={300} step={5} value={bookings} onChange={e => setBookings(Number(e.target.value))}
                         className="mt-2 w-full accent-[#24513B]" aria-valuetext={fmt(bookings)} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="gc-avg" className="flex justify-between text-sm font-semibold"><span>{t('driverLanding.grow.checker.avg')}</span><output htmlFor="gc-avg" className="tabular-nums">{nok(avg)}</output></label>
                  <input id="gc-avg" type="range" min={500} max={20000} step={100} value={avg} onChange={e => setAvg(Number(e.target.value))}
                         className="mt-2 w-full accent-[#24513B]" aria-valuetext={nok(avg)} />
                </div>
              </>
            )}
          </div>
        </div>
        <div aria-live="polite" className="bg-[#24513B] text-white p-7 md:p-10 flex flex-col">
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2.5 text-[15px]">
            <dt className="text-[#D5E2D8]">{t('driverLanding.grow.checker.setupFee')}</dt><dd className="m-0 font-semibold text-end">{nok(est.setup)}</dd>
            <dt className="text-[#D5E2D8]">{t('driverLanding.grow.checker.monthly')}</dt><dd className="m-0 font-semibold text-end">{nok(est.monthly)}</dd>
            {est.fee > 0 && <><dt className="text-[#D5E2D8] ps-3">{t('driverLanding.grow.checker.ofWhichFee')}</dt><dd className="m-0 text-end text-[#D5E2D8]">{nok(est.fee)}</dd></>}
            {est.acct > 0 && <><dt className="text-[#D5E2D8] ps-3">{t('driverLanding.grow.checker.ofWhichAccounting')}</dt><dd className="m-0 text-end text-[#D5E2D8]">{nok(est.acct)}</dd></>}
          </dl>
          <div role="radiogroup" aria-label={t('driverLanding.grow.checker.viewLabel')} className="mt-6 pt-5 border-t border-white/25 flex gap-0 self-start border-b-0">
            {(['month', 'year'] as const).map(v => (
              <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}
                      className={`min-h-[36px] px-3 text-[13px] font-bold border border-white/40 first:border-e-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${view === v ? 'bg-white text-[#24513B]' : 'text-white hover:bg-white/10'}`}>
                {t(`driverLanding.grow.checker.view.${v}`)}
              </button>
            ))}
          </div>
          <p className="m-0 mt-4 text-sm text-[#D5E2D8]">{view === 'year' ? t('driverLanding.grow.checker.year') : t('driverLanding.grow.checker.monthly')}</p>
          <p className="m-0 text-[44px] leading-none tracking-tight mt-1" style={{ fontFamily: 'Georgia, serif' }}>{nok(view === 'year' ? est.year : est.monthly)}</p>
          {view === 'month' && est.setup > 0 && <p className="m-0 mt-2 text-sm text-[#D5E2D8]">{t('driverLanding.grow.checker.plusSetup', { amount: nok(est.setup) })}</p>}
          {est.quote && <p className="m-0 mt-3 text-sm text-[#E3EFE7]">{t('driverLanding.grow.checker.quote')}</p>}
          <p className="m-0 mt-3 text-xs text-[#D5E2D8]">{t('driverLanding.grow.checker.disclaimer')}</p>
          <span className="flex-1" />
          <button type="button" onClick={savePdf}
                  className="mt-7 self-start min-h-[44px] px-5 border border-white/60 text-white font-bold hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{t('driverLanding.grow.checker.pdf')} ↓</button>
          <button type="button" onClick={() => setPage('white-label')}
                  className="mt-3 self-start min-h-[50px] px-6 bg-white hover:bg-[#E6EEE9] text-[#17212E] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{t('driverLanding.grow.seePlans')} →</button>
        </div>
      </div>
    </div>
  );
}
