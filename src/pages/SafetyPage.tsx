import React from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';

/* What FlyttGo actually checks and does today (platform audit
 * 2026-10-30): a driver uploads four documents in the application
 * (DriverOnboarding) and an administrator approves the driver only when
 * they are there (AdminDashboard REQUIRED_DOCS). No background check,
 * interview, BankID or vehicle-register lookup is made, and FlyttGo has no
 * insurance policy of its own to state limits for. */
const VETTING_STEPS = [
  { step: '1', title: 'Identity document', desc: 'The driver uploads a government-issued photo ID or passport.' },
  { step: '2', title: 'Driving licence', desc: 'The driver uploads a valid Norwegian or EU/EEA driving licence.' },
  { step: '3', title: 'Insurance document', desc: 'The driver uploads proof of insurance for the vehicle.' },
  { step: '4', title: 'Vehicle registration', desc: 'The driver uploads the vehicle\u2019s current registration document.' },
  { step: '5', title: 'Review by FlyttGo', desc: 'A FlyttGo administrator reviews the application and its documents before the driver can take jobs.' },
  { step: '6', title: 'Suspension', desc: 'FlyttGo can suspend a driver\u2019s account, after which the driver gets no new jobs.' },
];

const INSURANCE = [
  { title: 'Driver\u2019s insurance',  limit: 'Driver\u2019s policy', desc: 'Each driver has their own insurance, documented when they apply. What it covers depends on the driver\u2019s policy.' },
  { title: 'Damage at the addresses',  limit: 'See Liability', desc: 'Who is responsible for damage at pickup and delivery is set out on the Liability page and in the Terms.' },
  { title: 'Card payment',      limit: 'Through Stripe', desc: 'Card payments are taken at checkout through Stripe. FlyttGo pays the driver after the job is confirmed as done.' },
  { title: 'Cancellation and refunds', limit: 'Terms \u00a76', desc: 'Cancel more than 24 hours before pickup for a full refund; within 24 hours, 50 % is refunded. Refunds go back to the card or Vipps you paid with.' },
];

const CLAIM_STEPS = [
  { title: 'Contact us',                            desc: 'Use the contact form and choose \u201cClaim or complaint\u201d. Give your booking reference and describe what happened and what was damaged.' },
  { title: 'Keep evidence',                         desc: 'Keep photos of the damage and of the items before the move if you have them. We will ask for them when we reply.' },
  { title: 'We look at it with the driver',         desc: 'FlyttGo passes your claim to the driver, who may refer it to their insurance.' },
  { title: 'Resolution',                            desc: 'Responsibility follows the Liability page and the Terms. Refunds of the booking price follow the cancellation rules.' },
];

export default function SafetyPage() {
  const { setPage } = useApp();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-xs font-medium px-4 py-2 rounded-full mb-6">
            🛡️ {t('safety.heroBadge')}
          </div>
          <h1 className="text-5xl font-extrabold mb-5 leading-tight">{t('safety.heroTitle')}</h1>
          <p className="text-white/75 text-lg max-w-2xl mx-auto">
            {t('safety.heroSubtitle')}
          </p>
        </div>
      </section>

      {/* VETTING */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">{t('safety.vettingLabel')}</div>
          <h2 className="text-3xl font-extrabold text-[#0B2E59] mb-3">{t('safety.vettingTitle')}</h2>
          <p className="text-gray-500 max-w-2xl mx-auto">{t('safety.vettingBody')}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {VETTING_STEPS.map(v => (
            <div key={v.step} className="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-xl hover:border-emerald-200 transition">
              <div className="w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center font-bold mb-4">{v.step}</div>
              <h3 className="font-bold text-[#0B2E59] mb-2">{v.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* INSURANCE */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">{t('safety.insuranceLabel')}</div>
            <h2 className="text-3xl font-extrabold text-[#0B2E59] mb-3">{t('safety.insuranceTitle')}</h2>
            <p className="text-gray-500 max-w-2xl mx-auto">{t('safety.insuranceBody')}</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            {INSURANCE.map(c => (
              <div key={c.title} className="bg-white rounded-2xl p-6 border border-gray-100">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <h3 className="font-bold text-[#0B2E59]">{c.title}</h3>
                  <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full whitespace-nowrap">{c.limit}</span>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW CLAIMS WORK */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">{t('safety.claimsTitle')}</h2>
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">{t('safety.claimsBody')}</p>
        <ol className="space-y-4">
          {CLAIM_STEPS.map((s, i) => (
            <li key={s.title} className="flex items-start gap-5 bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
              <div className="w-9 h-9 bg-[#0B2E59] text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">{i + 1}</div>
              <div>
                <h3 className="font-bold text-[#0B2E59] mb-1">{s.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-10 text-center">
          <button onClick={() => setPage('contact')}
            className="px-7 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition shadow-lg">
            {t('safety.claimsCta')}
          </button>
        </div>
      </section>

      {/* SECURITY */}
      <section className="bg-[#0B2E59] text-white py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-extrabold mb-3">{t('safety.securityTitle')}</h2>
          <p className="text-white/70 mb-8 max-w-2xl mx-auto">{t('safety.securityBody')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            {['GDPR', 'Card data only at Stripe', 'HTTPS-only', 'EU-hosted', 'Encrypted at rest'].map(b => (
              <span key={b} className="bg-white/10 text-white/80 text-sm px-4 py-1.5 rounded-full border border-white/10">✓ {b}</span>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
