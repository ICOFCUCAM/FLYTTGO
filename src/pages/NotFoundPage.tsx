import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, Page } from '../lib/store';

/**
 * 404 page. Mounted by AppLayout as the fallback when pathToPage()
 * returns 'not-found' — i.e. when the browser hit a URL that doesn't
 * map to any Page id in pageRoutes.
 *
 * Also sets `noindex` on the document so Google doesn't index the
 * 404 and count it against the site's quality score.
 */

interface LinkCard { label: string; desc: string; page: Page; icon: string; }

export default function NotFoundPage() {
  const { setPage } = useApp();
  const { t } = useTranslation();

  /* Ask search engines not to index the 404. Cleaned up on unmount
   * so the rest of the site stays indexable. */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const existing = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previous = existing?.content ?? null;
    if (existing) existing.content = 'noindex, nofollow';
    return () => {
      if (existing && previous !== null) existing.content = previous;
    };
  }, []);

  const popular: LinkCard[] = [
    { label: 'Book a Move',       desc: 'Get an instant quote and a verified driver',      page: 'booking',   icon: '🚚' },
    { label: 'Services',          desc: 'Full house, office, furniture, same-day and more', page: 'services',  icon: '📦' },
    { label: 'Track Your Move',   desc: 'Live map + ETA for your active delivery',         page: 'tracking',  icon: '📍' },
    { label: 'Become a Driver',   desc: 'Earn on your own schedule',                        page: 'driver-onboarding', icon: '👤' },
    { label: 'FlyttGo for Business', desc: 'Bulk booking, recurring deliveries, API',      page: 'corporate', icon: '🏢' },
    { label: 'Help Center',       desc: 'FAQ, safety, claims, contact',                    page: 'help',      icon: '❓' },
  ];

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="bg-gradient-to-br from-[#0B2E59] via-[#0B2E59] to-[#1a4a8a] text-white py-20 relative overflow-hidden">
        {/* Soft blob backdrops to match the premium feel of the other hero sections */}
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="absolute top-10 left-10 w-96 h-96 bg-white rounded-full blur-3xl"/>
          <div className="absolute bottom-10 right-10 w-64 h-64 bg-emerald-400 rounded-full blur-3xl"/>
        </div>

        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Oversized 404 that fades into the background so it doesn't
           * dominate the focal CTAs. */}
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/60 text-xs font-medium px-4 py-2 rounded-full mb-6">
            🚐 {t('notFound.code')}
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold mb-5 leading-tight">
            {t('notFound.title')}
          </h1>
          <p className="text-white/70 text-lg max-w-xl mx-auto mb-8 leading-relaxed">
            {t('notFound.subtitle')}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => setPage('home')}
              className="px-8 py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg"
            >
              ← {t('notFound.backHome')}
            </button>
            <button
              onClick={() => setPage('services')}
              className="px-8 py-4 bg-white/10 border border-white/20 text-white rounded-xl font-semibold hover:bg-white/20 transition"
            >
              {t('notFound.browseServices')}
            </button>
          </div>
        </div>
      </section>

      {/* POPULAR PAGES */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-2">{t('notFound.popularTitle')}</h2>
          <p className="text-gray-500 text-sm">{t('notFound.searchHint')}</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {popular.map(card => (
            <button
              key={card.page}
              onClick={() => setPage(card.page)}
              className="text-left bg-white rounded-2xl p-5 border border-gray-100 hover:border-emerald-200 hover:shadow-xl transition group"
            >
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 bg-emerald-50 rounded-xl flex items-center justify-center flex-shrink-0 text-xl group-hover:bg-emerald-600 group-hover:text-white transition">
                  {card.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-[#0B2E59] group-hover:text-emerald-700 transition">{card.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5 leading-snug">{card.desc}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

    </div>
  );
}
