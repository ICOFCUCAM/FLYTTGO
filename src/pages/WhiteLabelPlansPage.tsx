/**
 * Public page: white-label plans and prices (docs/WHITE_LABEL.md).
 * The two seller models side by side, who does what, what each plan
 * needs, and the prices from the database. Prices FlyttGo has not yet
 * confirmed are shown as proposals.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import { loadPlans, type WhiteLabelPlan } from '../lib/whiteLabel';
import { formatNok } from '../lib/invoicing';
import { supabase } from '../lib/supabase';
import type { PriceTier } from '../accounting/types';

function Check({ children }: { children: React.ReactNode }) {
  return <li className="flex gap-2"><span className="text-emerald-600 font-bold">✓</span><span>{children}</span></li>;
}

export default function WhiteLabelPlansPage() {
  const { setPage } = useApp();
  const [plans, setPlans] = useState<WhiteLabelPlan[] | null>(null);
  useEffect(() => { loadPlans().then(setPlans); }, []);
  const [accounting, setAccounting] = useState<{ tiers: PriceTier[]; price_status: string } | null>(null);
  useEffect(() => { supabase.rpc('accounting_price').then(({ data }) => setAccounting(data ?? null)); }, []);
  const proposed = (plans ?? []).some(p => p.price_status !== 'confirmed');

  return (
    <div className="bg-gray-50 min-h-screen">
      <section className="bg-[#0B2E59] text-white py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <p className="text-emerald-300 text-sm font-semibold mb-2">FlyttGo Business · White label</p>
          <h1 className="text-3xl md:text-4xl font-extrabold mb-4">Moving and delivery under your own brand</h1>
          <p className="text-white/80 max-w-3xl">
            Your customers book on your page, with your name, logo and colours. FlyttGo's drivers carry out the moves.
            You choose who sells: FlyttGo, which takes care of everything, or your own company, with your prices and terms.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 py-10">
        <div className="mb-8 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-sm text-indigo-900">
          <strong>Not a moving company?</strong> Plumbers, electricians, cleaners, salons, fitness studios, consultants and others use the
          same platform with their own booking (jobs or appointments), invoices in their own name and a website. Your company is the seller;
          see the plans Jobs, Appointments and Website and invoicing below.
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Two ways to sell (moving and delivery)</h2>
        <div className="grid md:grid-cols-2 gap-4 mb-10">
          <div className="bg-white rounded-2xl border-2 border-emerald-500 p-6">
            <div className="text-xs font-semibold text-emerald-700 mb-1">MODEL A · THE DEFAULT</div>
            <h3 className="text-lg font-bold mb-2">FlyttGo sells, under your brand</h3>
            <p className="text-sm text-gray-600 mb-3">
              The customer buys from FlyttGo AS on your page. FlyttGo takes the payment (card or Vipps), sends the receipt,
              and handles customer service, cancellations, refunds and complaints under FlyttGo's terms.
              You don't need a payment provider, a data processing agreement or your own customer service.
            </p>
            <p className="text-xs text-gray-500">You see monthly booking numbers. The customers' details stay with FlyttGo, which is responsible for them.</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="text-xs font-semibold text-indigo-700 mb-1">MODEL B · FOR LARGER COMPANIES</div>
            <h3 className="text-lg font-bold mb-2">Your company sells, FlyttGo delivers</h3>
            <p className="text-sm text-gray-600 mb-3">
              Your company is the seller: your prices (FlyttGo's price plus your markup), your terms, and payments straight into
              your own Stripe account. FlyttGo carries out the moves as your subcontractor and takes its price and a platform
              fee from each payment.
            </p>
            <p className="text-xs text-gray-500">
              You answer your customers first, handle MVA on your sales, and are responsible for their data. FlyttGo processes it
              for you under a data processing agreement.
            </p>
          </div>
        </div>

        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Plans and prices</h2>
          <span className="text-xs text-gray-500">Prices exclude 25% MVA</span>
        </div>
        {proposed && (
          <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            Proposed prices: FlyttGo has not confirmed this price list yet. The price that applies is the one in your agreement.
          </div>
        )}
        {plans === null ? <p className="text-sm text-gray-500">Loading plans…</p> : plans.length === 0 ? (
          <p className="text-sm text-gray-500">The price list can't be shown right now. Contact FlyttGo for prices.</p>
        ) : (
          <div className="grid md:grid-cols-3 gap-4">
            {plans.map(p => (
              <div key={p.code} className={`bg-white rounded-2xl p-6 flex flex-col ${p.is_default ? 'border-2 border-emerald-500' : 'border border-gray-200'}`}>
                <div className="text-xs font-semibold mb-1 text-gray-500">
                  {p.seller_model === 'flyttgo' ? 'Model A · FlyttGo sells' : 'Model B · you sell'}{p.is_default ? ' · default' : ''}
                </div>
                <h3 className="text-lg font-bold text-gray-900">{p.name}</h3>
                <p className="text-sm text-gray-600 mt-1 mb-4">{p.summary}</p>
                <div className="mb-1"><span className="text-3xl font-extrabold">{formatNok(p.monthly_fee)}</span><span className="text-sm text-gray-500"> / month</span></div>
                <div className="text-sm text-gray-600">{p.setup_fee > 0 ? `${formatNok(p.setup_fee)} set-up, once` : 'No set-up fee'}</div>
                {p.seller_model === 'company' && (
                  <div className="text-sm text-gray-600">
                    + platform fee {String(p.platform_fee_pct).replace('.', ',')} % of FlyttGo's price per booking, at least {formatNok(p.platform_fee_min)}
                  </div>
                )}
                {p.price_status !== 'confirmed' && <div className="text-xs text-yellow-700 mt-1">Proposed price</div>}
                {p.for_whom && <p className="text-xs text-gray-500 mt-3">{p.for_whom}</p>}
                <ul className="text-sm text-gray-700 space-y-1.5 mt-4">{p.features.map(f => <Check key={f}>{f}</Check>)}</ul>
                <div className="mt-4 text-xs">
                  <div className="font-semibold text-gray-700 mb-1">FlyttGo</div>
                  <ul className="list-disc ms-4 text-gray-600 space-y-0.5">{p.flyttgo_does.map(f => <li key={f}>{f}</li>)}</ul>
                  <div className="font-semibold text-gray-700 mt-2 mb-1">Your company</div>
                  <ul className="list-disc ms-4 text-gray-600 space-y-0.5">{p.company_does.map(f => <li key={f}>{f}</li>)}</ul>
                  <div className="font-semibold text-gray-700 mt-2 mb-1">Needs</div>
                  <ul className="list-disc ms-4 text-gray-600 space-y-0.5">{p.requirements.map(f => <li key={f}>{f}</li>)}</ul>
                </div>
                <div className="flex-1" />
                <button onClick={() => setPage('corporate-dashboard')}
                  className="mt-5 w-full py-2.5 rounded-xl text-sm font-semibold bg-[#0B2E59] text-white hover:bg-[#1a4a8a]">
                  Choose in your company dashboard
                </button>
              </div>
            ))}
          </div>
        )}

        {accounting && accounting.tiers.length > 0 && (
          <div className="mt-10 bg-white rounded-2xl border border-gray-200 p-6">
            <div className="text-xs font-semibold text-gray-500 mb-1">ADD-ON · ANY PLAN, ANY INDUSTRY</div>
            <h3 className="text-lg font-bold text-gray-900">Accounting (FlyttGo Regnskap)</h3>
            <p className="text-sm text-gray-600 mt-1 mb-4 max-w-3xl">
              Your invoices, credit notes and payments on FlyttGo are posted for you; add purchases and other costs with the receipt.
              The MVA return basis, the annual accounts draft, the basis for the tax return and SAF-T are ready when they are due, in PDF and Word,
              for your own accountant to review. Invite your accountant, bookkeeper or auditor to your company's back office. In Norwegian or English.
            </p>
            <table className="text-sm"><tbody>{(() => { let lower = 0; return accounting.tiers.map(t => {
              const row = <tr key={t.name}><td className="pe-6 py-0.5 font-medium">{t.name}</td>
                <td className="pe-6 text-gray-500">{t.up_to === null ? `turnover from ${formatNok(lower)}` : `turnover ${formatNok(lower)} – ${formatNok(t.up_to)}`}</td>
                <td>{t.monthly_fee === null ? 'price by agreement' : `${formatNok(t.monthly_fee)} / month`}</td></tr>;
              lower = t.up_to ?? lower; return row; }); })()}</tbody></table>
            <p className="text-xs text-gray-500 mt-3">Excl. MVA. The band follows last year's turnover in your books (or what you state when you start) and is reassessed each 1 January.
              {accounting.price_status !== 'confirmed' && ' Proposed prices: FlyttGo has not confirmed them yet.'}</p>
          </div>
        )}

        <div className="mt-10 grid md:grid-cols-3 gap-4 text-sm text-gray-600">
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-bold text-gray-900 mb-1">How billing works</h3>
            The set-up fee is invoiced when FlyttGo approves your plan, and the monthly fee each month in advance (the first month from the day it starts),
            on FlyttGo's invoice with your payment terms. Under Own seller, what FlyttGo kept from each payment is listed on the same invoice, already paid.
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-bold text-gray-900 mb-1">Your website</h3>
            Choose a ready website from FlyttGo's template library (moving and logistics designs) in your name and colours.
            Every "book" button leads to your booking page. Templates are checked by FlyttGo before they're offered.
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-bold text-gray-900 mb-1">Changing or ending</h3>
            You can ask to change plan at any time; your current plan stays until FlyttGo approves the change. Ending a plan stops the monthly fee after the current month.
            {' '}<button onClick={() => setPage('white-label-dpa')} className="text-[#0B2E59] underline">Data processing agreement (Own seller)</button>
          </div>
        </div>
      </section>
    </div>
  );
}
