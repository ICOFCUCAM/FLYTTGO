import React from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';

const VALUE_ICONS = [
  'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  'M13 10V3L4 14h7v7l9-11h-7z',
  'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
];

const PRESS = [
  'E24',
  'Dagens Næringsliv',
  'Tek.no',
  'Shifter',
  'NRK',
];

export default function AboutUsPage() {
  const { setPage } = useApp();
  const { t } = useTranslation();

  const values = [
    { icon: VALUE_ICONS[0], title: t('about.value1Title'), desc: t('about.value1Desc') },
    { icon: VALUE_ICONS[1], title: t('about.value2Title'), desc: t('about.value2Desc') },
    { icon: VALUE_ICONS[2], title: t('about.value3Title'), desc: t('about.value3Desc') },
    { icon: VALUE_ICONS[3], title: t('about.value4Title'), desc: t('about.value4Desc') },
  ];

  const timeline = [
    { year: '2023', title: t('about.timeline2023Title'), desc: t('about.timeline2023Desc') },
    { year: '2024', title: t('about.timeline2024Title'), desc: t('about.timeline2024Desc') },
    { year: '2025', title: t('about.timeline2025Title'), desc: t('about.timeline2025Desc') },
    { year: '2026', title: t('about.timeline2026Title'), desc: t('about.timeline2026Desc') },
  ];

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="relative bg-gradient-to-br from-[#0B2E59] via-[#0B2E59] to-[#1a4a8a] text-white py-24 overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-96 h-96 bg-white rounded-full blur-3xl"/>
          <div className="absolute bottom-10 right-10 w-64 h-64 bg-emerald-400 rounded-full blur-3xl"/>
        </div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-4 py-2 rounded-full mb-6">
            🇳🇴 {t('about.heroBadge')}
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold mb-6 leading-tight">
            {t('about.heroTitle1')} <span className="text-emerald-400">{t('about.heroTitle2')}</span> {t('about.heroTitle3')}
          </h1>
          <p className="text-white/75 text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed">
            {t('about.heroSubtitle')}
          </p>
        </div>
      </section>

      {/* MISSION */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">{t('about.missionLabel')}</div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[#0B2E59] mb-4">{t('about.missionTitle')}</h2>
          <p className="text-gray-600 text-lg leading-relaxed">
            {t('about.missionBody')}
          </p>
        </div>
      </section>

      {/* VALUES */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">{t('about.valuesTitle')}</h2>
          <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">{t('about.valuesSubtitle')}</p>
          <div className="grid sm:grid-cols-2 gap-6">
            {values.map(v => (
              <div key={v.title} className="bg-white rounded-2xl p-7 border border-gray-100 hover:shadow-xl transition">
                <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center mb-5">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={v.icon}/>
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-[#0B2E59] mb-2">{v.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TIMELINE */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">{t('about.timelineTitle')}</h2>
        <p className="text-gray-500 text-center mb-12">{t('about.timelineSubtitle')}</p>
        <div className="relative">
          <div className="absolute left-4 sm:left-1/2 -translate-x-0 sm:-translate-x-1/2 top-0 bottom-0 w-0.5 bg-gradient-to-b from-emerald-400 to-[#0B2E59]"/>
          <div className="space-y-10">
            {timeline.map((item, i) => (
              <div key={item.year} className={`relative flex items-start gap-6 sm:items-center ${i % 2 === 0 ? 'sm:flex-row' : 'sm:flex-row-reverse'}`}>
                <div className="flex-shrink-0 w-8 sm:w-1/2 flex justify-start sm:justify-end sm:pr-8">
                  <div className={`${i % 2 === 0 ? 'sm:text-right' : 'sm:text-left sm:pl-8 sm:pr-0'} w-full`}>
                    {i % 2 === 0 && (
                      <div className="hidden sm:block">
                        <div className="text-sm font-bold text-emerald-600">{item.year}</div>
                        <h3 className="text-lg font-bold text-[#0B2E59] mt-1">{item.title}</h3>
                        <p className="text-gray-500 text-sm mt-1">{item.desc}</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="absolute left-4 sm:left-1/2 -translate-x-1/2 w-4 h-4 bg-emerald-500 rounded-full ring-4 ring-white z-10"/>
                <div className="flex-1 pl-4 sm:w-1/2 sm:pl-8">
                  {i % 2 !== 0 ? (
                    <div className="hidden sm:block">
                      <div className="text-sm font-bold text-emerald-600">{item.year}</div>
                      <h3 className="text-lg font-bold text-[#0B2E59] mt-1">{item.title}</h3>
                      <p className="text-gray-500 text-sm mt-1">{item.desc}</p>
                    </div>
                  ) : null}
                  <div className="sm:hidden">
                    <div className="text-sm font-bold text-emerald-600">{item.year}</div>
                    <h3 className="text-lg font-bold text-[#0B2E59] mt-1">{item.title}</h3>
                    <p className="text-gray-500 text-sm mt-1">{item.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BY THE NUMBERS */}
      <section className="bg-gradient-to-r from-[#0B2E59] to-[#1a4a8a] py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { v: '25,000+', l: t('about.statDeliveries') },
              { v: '500+',    l: t('about.statCarriers') },
              { v: '40+',     l: t('about.statCities') },
              { v: '4.8★',    l: t('about.statRating') },
            ].map(s => (
              <div key={s.l} className="text-center">
                <div className="text-4xl sm:text-5xl font-extrabold text-emerald-400 mb-1">{s.v}</div>
                <div className="text-sm text-white/60">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRESS */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">{t('about.pressTitle')}</p>
        <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-4">
          {PRESS.map(p => (
            <span key={p} className="text-xl font-bold text-gray-300">{p}</span>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-extrabold text-[#0B2E59] mb-4">{t('about.ctaTitle')}</h2>
          <p className="text-gray-600 text-lg mb-8">{t('about.ctaBody')}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={() => setPage('booking')}
              className="px-8 py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg">
              {t('about.ctaBook')}
            </button>
            <button onClick={() => setPage('contact')}
              className="px-8 py-4 bg-white border-2 border-[#0B2E59] text-[#0B2E59] rounded-xl font-bold hover:bg-[#0B2E59] hover:text-white transition">
              {t('about.ctaContact')}
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}
