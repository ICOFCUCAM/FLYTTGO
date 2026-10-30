import React from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';

/* What a customer can do today and what FlyttGo does not do yet: no
 * figures, fleet shares or offsets it cannot back (platform audit
 * 2026-10-30). */
const INITIATIVES = [
  {
    icon: 'M17 8l4 4m0 0l-4 4m4-4H3',
    title: 'The right van size',
    desc:  'The van size guide and calculator help you book the smallest van that fits your things, so you do not move empty space.',
    stat:  'Guide',
    statLabel: 'van size calculator',
  },
  {
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    title: 'Electric vans',
    desc:  'FlyttGo does not yet record which drivers use electric vans and has no EV-only option. When it does, it will say so here.',
    stat:  '\u2014',
    statLabel: 'not recorded yet',
  },
  {
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    title: 'Your choice of time',
    desc:  'You choose when the move starts. A time outside rush hour usually means less time in traffic.',
    stat:  'You',
    statLabel: 'choose the time',
  },
  {
    icon: 'M4 6h16M4 12h16M4 18h7',
    title: 'Digital paperwork',
    desc:  'Prices, receipts and MVA invoices are sent digitally.',
    stat:  'Digital',
    statLabel: 'receipts and invoices',
  },
  {
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    title: 'Reusable blankets & crates',
    desc:  'Ask for reusable blankets and straps instead of single-use plastic wrap: write it in the special instructions when you book.',
    stat:  'Ask',
    statLabel: 'in your booking notes',
  },
  {
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    title: 'Carbon offset',
    desc:  'FlyttGo does not offset emissions today and issues no certificates. It will only say so here once a real scheme is in place.',
    stat:  '\u2014',
    statLabel: 'no scheme yet',
  },
];

export default function SustainabilityPage() {
  const { setPage } = useApp();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="relative bg-gradient-to-br from-emerald-700 via-emerald-800 to-[#0B2E59] text-white py-24 overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-96 h-96 bg-emerald-300 rounded-full blur-3xl"/>
          <div className="absolute bottom-10 right-10 w-64 h-64 bg-white rounded-full blur-3xl"/>
        </div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-xs font-medium px-4 py-2 rounded-full mb-6">
            🌱 {t('sustainability.heroBadge')}
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold mb-5 leading-tight">{t('sustainability.heroTitle')}</h1>
          <p className="text-white/75 text-lg sm:text-xl max-w-2xl mx-auto">
            {t('sustainability.heroSubtitle')}
          </p>
        </div>
      </section>

      {/* BY THE NUMBERS */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10 relative z-10 mb-16">
        <div className="bg-white rounded-3xl shadow-xl p-8 sm:p-10 border border-gray-100">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[1, 2, 3, 4].map(n => ({ v: t(`sustainability.stat${n}Value`), l: t(`sustainability.stat${n}Label`) })).map(s => (
              <div key={s.l}>
                <div className="text-3xl sm:text-4xl font-extrabold text-emerald-600 mb-1">{s.v}</div>
                <div className="text-xs text-gray-500 leading-snug">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* INITIATIVES */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">{t('sustainability.initiativesTitle')}</h2>
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">{t('sustainability.initiativesBody')}</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {INITIATIVES.map(i => (
            <div key={i.title} className="bg-gray-50 rounded-2xl p-6 hover:shadow-xl hover:bg-white hover:border-emerald-200 border border-transparent transition">
              <div className="flex items-start justify-between mb-4">
                <div className="w-11 h-11 bg-emerald-600 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={i.icon}/>
                  </svg>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold text-emerald-600 leading-none">{i.stat}</div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-1">{i.statLabel}</div>
                </div>
              </div>
              <h3 className="font-bold text-[#0B2E59] mb-2">{i.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{i.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-emerald-50 py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-3">{t('sustainability.ctaTitle')}</h2>
          <p className="text-gray-600 mb-6">{t('sustainability.ctaBody')}</p>
          <button onClick={() => setPage('booking')}
            className="px-8 py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg">
            {t('sustainability.ctaBtn')}
          </button>
        </div>
      </section>

    </div>
  );
}
