import React from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';

/* Real coverage only, each with its link. None is listed yet (the
 * articles shown here before could not be backed; platform audit
 * 2026-10-30). */
const COVERAGE: { outlet: string; title: string; date: string; url: string }[] = [];

export default function PressPage() {
  const { setPage } = useApp();
  const { t } = useTranslation();

  /* What FlyttGo is and how it works; no figures it cannot back. */
  const facts = [1, 2, 3, 4, 5, 6].map(n => ({ label: t(`press.fact${n}Label`), value: t(`press.fact${n}Value`) }));

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-4 py-2 rounded-full mb-6">
            📰 {t('press.heroBadge')}
          </div>
          <h1 className="text-5xl font-extrabold mb-5 leading-tight">{t('press.heroTitle')}</h1>
          <p className="text-white/75 text-lg max-w-2xl mx-auto">
            {t('press.heroSubtitle')}
          </p>
        </div>
      </section>

      {/* QUICK FACTS */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10 relative z-10">
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-600 mb-5">{t('press.factsTitle')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            {facts.map(f => (
              <div key={f.label}>
                <div className="text-2xl font-extrabold text-[#0B2E59]">{f.value}</div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">{f.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* IN THE NEWS */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">{t('press.coverageTitle')}</h2>
        <p className="text-gray-500 text-center mb-12">{t('press.coverageBody')}</p>
        <div className="space-y-3">
          {COVERAGE.length === 0 && (
            <p className="text-center text-sm text-gray-500 bg-gray-50 rounded-2xl p-5">{t('press.coverageNone')}</p>
          )}
          {COVERAGE.map(c => (
            <a key={c.title} href={c.url}
              className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 bg-white border border-gray-100 rounded-2xl p-5 hover:shadow-xl hover:border-emerald-200 transition group">
              <div className="w-28 flex-shrink-0">
                <span className="text-xs font-bold uppercase tracking-wide text-emerald-600">{c.outlet}</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-[#0B2E59] group-hover:text-emerald-700 transition">{c.title}</h3>
              </div>
              <div className="text-xs text-gray-400 flex-shrink-0">{c.date}</div>
            </a>
          ))}
        </div>
      </section>

      {/* BRAND ASSETS */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">{t('press.assetsTitle')}</h2>
          <p className="text-gray-500 text-center mb-10">{t('press.assetsBody')}</p>
          <div className="grid sm:grid-cols-3 gap-4">
            {/* Sent on request (there are no files to download yet). */}
            {['Logo (SVG + PNG)', 'Brand guidelines', 'Product screenshots'].map(title => ({ title })).map(a => (
              <button key={a.title} type="button" onClick={() => setPage('contact')}
                className="text-left bg-white border border-gray-100 rounded-2xl p-5 hover:shadow-xl hover:border-emerald-200 transition flex items-start gap-4">
                <div className="w-11 h-11 bg-emerald-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                  </svg>
                </div>
                <div>
                  <div className="font-semibold text-[#0B2E59] text-sm">{a.title}</div>
                  <div className="text-xs text-gray-500 mt-1">{t('press.assetsOnRequest')}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-2">{t('press.enquiriesTitle')}</h2>
        <p className="text-gray-600 mb-2">{t('press.enquiriesBody1')}</p>
        <a href="mailto:press@flyttgo.no" className="text-lg font-bold text-emerald-700 hover:underline">press@flyttgo.no</a>
        <div className="mt-8">
          <button onClick={() => setPage('contact')}
            className="px-7 py-3 bg-[#0B2E59] text-white rounded-xl font-semibold hover:bg-[#1a4a8a] transition shadow-lg">
            {t('press.contactForm')}
          </button>
        </div>
      </section>

    </div>
  );
}
