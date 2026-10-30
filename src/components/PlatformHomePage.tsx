/**
 * FlyttGo's front page on flyttgo.no: the business and marketplace platform
 * (the owner's "Stage 20" design, wired into the app; docs/HOMEPAGES.md).
 * The moving and transport front page (HomePage) is kept whole on
 * transport.flyttgo.no and at /transport. Every button leads to a page that
 * exists; the copy describes only what the platform does today. Colours are
 * the site's own: emerald, grey and the navy of the business pages.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, type Page } from '../lib/store';
import { transportUrl } from '../lib/hosts';

const NAVY = 'bg-[#1A365D]';

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Kicker({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return <div className={`text-[11px] font-extrabold uppercase tracking-[0.16em] ${light ? 'text-emerald-300' : 'text-emerald-700'}`}>{children}</div>;
}

function Head({ kicker, title, text, light }: { kicker: string; title: React.ReactNode; text: string; light?: boolean }) {
  return (
    <div className="text-center max-w-3xl mx-auto mb-10">
      <Kicker light={light}>{kicker}</Kicker>
      <h2 className={`mt-3 mb-3 text-3xl md:text-4xl font-extrabold tracking-tight leading-tight ${light ? 'text-white' : 'text-gray-900'}`}>{title}</h2>
      <p className={light ? 'text-gray-200' : 'text-gray-600'}>{text}</p>
    </div>
  );
}

export default function PlatformHomePage() {
  const { t } = useTranslation();
  const { setPage } = useApp();
  const go = (page: Page) => setPage(page);
  const transport = transportUrl();
  const toTransport = () => { if (transport.startsWith('/')) setPage('transport-home'); else window.location.href = transport; };
  const lines = (key: string) => t(key).split('\n').map((l, i, all) => <React.Fragment key={i}>{l}{i < all.length - 1 && <br />}</React.Fragment>);

  const btn = 'inline-flex items-center gap-1.5 rounded-full px-5 py-3 text-sm font-bold transition';
  const primary = `${btn} bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm`;
  const outline = `${btn} bg-white text-emerald-700 border border-gray-200 hover:border-emerald-300`;
  const card = 'bg-white border border-gray-200 rounded-2xl p-6';
  const num = 'text-[11px] font-extrabold tracking-[0.13em] text-emerald-600';

  const doors: { n: string; title: string; text: string; cta: string; onClick: () => void; tone: string }[] = [
    { n: t('platformHome.door1Num'), title: t('platformHome.door1Title'), text: t('platformHome.door1Text'), cta: t('platformHome.door1Cta'), onClick: () => go('services'), tone: 'dark' },
    { n: t('platformHome.door2Num'), title: t('platformHome.door2Title'), text: t('platformHome.door2Text'), cta: t('platformHome.door2Cta'), onClick: () => scrollToId('business'), tone: 'light' },
    { n: t('platformHome.door3Num'), title: t('platformHome.door3Title'), text: t('platformHome.door3Text'), cta: t('platformHome.door3Cta'), onClick: () => go('white-label'), tone: 'tint' },
  ];
  const pillars = [1, 2, 3, 4].map(i => ({ title: t(`platformHome.pillar${i}Title`), text: t(`platformHome.pillar${i}Text`) }));
  const tools = [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ title: t(`platformHome.tool${i}Title`), text: t(`platformHome.tool${i}Text`) }));
  const steps = [1, 2, 3, 4, 5].map(i => ({ title: t(`platformHome.step${i}Title`), text: t(`platformHome.step${i}Text`) }));
  const tags = t('platformHome.industryTags').split('|');
  const industries = [1, 2, 3, 4, 5, 6].map(i => ({ n: t(`platformHome.ind${i}Num`), title: t(`platformHome.ind${i}Title`), text: t(`platformHome.ind${i}Text`) }));
  const market = [1, 2, 3].map(i => ({ n: t(`platformHome.market${i}Num`), title: t(`platformHome.market${i}Title`), text: t(`platformHome.market${i}Text`) }));
  const shared = [1, 2, 3].map(i => ({ n: t(`platformHome.shared${i}Num`), title: t(`platformHome.shared${i}Title`), text: t(`platformHome.shared${i}Text`) }));
  const moving = [1, 2, 3, 4].map(i => ({ title: t(`platformHome.moving${i}Title`), text: t(`platformHome.moving${i}Text`) }));

  return (
    <main className="bg-white text-gray-800">
      <div className="bg-gray-900 text-gray-100 text-center px-4 py-2 text-[11px] tracking-[0.13em] uppercase">
        {t('platformHome.topBar')}
      </div>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-20 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <Kicker>{t('platformHome.heroKicker')}</Kicker>
          <h1 className="mt-4 mb-5 text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.04] text-gray-900">
            {t('platformHome.heroTitle1')}<br />
            <em className="font-serif font-normal not-italic md:italic text-emerald-700">{t('platformHome.heroTitle2')}</em>
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed max-w-xl">{t('platformHome.heroLead')}</p>
          <div className="flex flex-wrap gap-3 mt-7 mb-4">
            <button className={primary} onClick={() => scrollToId('start')}>{t('platformHome.heroCta1')} ↗</button>
            <button className={outline} onClick={() => scrollToId('platform')}>{t('platformHome.heroCta2')}</button>
          </div>
          <p className="text-xs text-gray-500">{t('platformHome.heroNote')}</p>
        </div>
        <div className="relative h-[300px] sm:h-[400px] md:h-[460px] rounded-3xl overflow-hidden shadow-xl bg-gradient-to-br from-emerald-100 via-emerald-50 to-gray-100">
          <div className="absolute inset-0 bg-[linear-gradient(125deg,transparent_15%,rgba(26,54,93,0.10)_15%_35%,transparent_35%),linear-gradient(25deg,rgba(5,150,105,0.14)_0_22%,transparent_22%_70%,rgba(5,150,105,0.22)_70%)]" />
          <div className="absolute inset-x-0 bottom-0 top-[45%] bg-gradient-to-b from-transparent to-gray-900/60" />
          <div className="absolute top-5 left-6 text-[11px] font-bold tracking-[0.15em] text-[#1A365D]">{t('platformHome.visualLabel')}</div>
          <div className="absolute bottom-6 left-6 max-w-xs text-white">
            <div className="text-[11px] tracking-[0.13em]">{t('platformHome.visualKicker')}</div>
            <div className="font-serif text-2xl md:text-3xl leading-tight mt-2">{t('platformHome.visualTitle')}</div>
          </div>
          <div className="hidden sm:block absolute right-5 top-16 bg-white rounded-2xl px-5 py-4 shadow-lg text-[11px] text-gray-600">
            {t('platformHome.floatKicker')}
            <b className="block text-emerald-700 text-sm">{t('platformHome.floatTitle')}</b>
            {t('platformHome.floatText')}
          </div>
        </div>
      </section>

      {/* Three ways in */}
      <section id="start" className="bg-emerald-50/60 py-16 md:py-20 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-5">
          <Head kicker={t('platformHome.startKicker')} title={t('platformHome.startTitle')} text={t('platformHome.startText')} />
          <div className="grid md:grid-cols-3 gap-4">
            {doors.map(d => (
              <article key={d.n} className={`rounded-2xl p-6 border flex flex-col ${d.tone === 'dark' ? 'bg-gray-900 border-gray-900 text-white' : d.tone === 'tint' ? 'bg-emerald-100 border-emerald-200' : 'bg-white border-gray-200'}`}>
                <div className={d.tone === 'dark' ? 'text-[11px] font-extrabold tracking-[0.13em] text-emerald-300' : num}>{d.n}</div>
                <h3 className={`mt-2 mb-2 text-xl font-bold ${d.tone === 'dark' ? 'text-white' : 'text-gray-900'}`}>{d.title}</h3>
                <p className={`text-sm mb-5 flex-1 ${d.tone === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>{d.text}</p>
                <button onClick={d.onClick} className={`text-left text-sm font-bold ${d.tone === 'dark' ? 'text-emerald-300 hover:text-white' : 'text-emerald-700 hover:text-emerald-900'}`}>{d.cta} ↗</button>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* The platform */}
      <section id="platform" className="py-16 md:py-20 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-5">
          <Head kicker={t('platformHome.platformKicker')} title={lines('platformHome.platformTitle')} text={t('platformHome.platformText')} />
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {pillars.map((p, i) => (
              <div key={p.title} className="p-6 border border-gray-200 rounded-2xl bg-white">
                <small className="font-bold text-emerald-600">0{i + 1}</small>
                <h3 className="mt-1 mb-2 text-lg font-bold text-gray-900">{p.title}</h3>
                <p className="text-sm text-gray-600">{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For business */}
      <section id="business" className="bg-emerald-50/60 py-16 md:py-20 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-5 grid lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-14 items-start">
          <div>
            <Kicker>{t('platformHome.businessKicker')}</Kicker>
            <h2 className="mt-3 mb-4 text-3xl md:text-4xl font-extrabold tracking-tight leading-tight text-gray-900">{t('platformHome.businessTitle')}</h2>
            <p className="text-gray-600 mb-6">{t('platformHome.businessText')}</p>
            <div className="flex flex-wrap gap-3">
              <button className={primary} onClick={() => go('white-label')}>{t('platformHome.businessCta1')} ↗</button>
              <button className={outline} onClick={() => go('accounting')}>{t('platformHome.businessCta2')}</button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {tools.map(x => (
              <div key={x.title} className="bg-white border border-gray-200 rounded-xl p-5">
                <b className="block text-sm text-emerald-700">{x.title}</b>
                <span className="text-sm text-gray-600">{x.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The commercial lifecycle */}
      <section id="finance" className={`${NAVY} text-white py-16 md:py-20 scroll-mt-16`}>
        <div className="max-w-6xl mx-auto px-5">
          <Head light kicker={t('platformHome.financeKicker')} title={lines('platformHome.financeTitle')} text={t('platformHome.financeText')} />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {steps.map((s, i) => (
              <div key={s.title} className="bg-white text-gray-800 rounded-xl p-4">
                <small className="font-bold text-emerald-600">0{i + 1}</small>
                <b className="block mt-2 mb-1">{s.title}</b>
                <span className="text-xs text-gray-600">{s.text}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-200 mt-6 text-center max-w-3xl mx-auto">{t('platformHome.financeNote')}</p>
        </div>
      </section>

      {/* Industries */}
      <section id="industries" className="py-16 md:py-20 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-5">
          <Head kicker={t('platformHome.industriesKicker')} title={t('platformHome.industriesTitle')} text={t('platformHome.industriesText')} />
          <div className="flex flex-wrap justify-center gap-2 mb-8">
            {tags.map(tag => <span key={tag} className="px-4 py-2 rounded-full bg-white border border-gray-200 text-sm font-bold text-emerald-700">{tag}</span>)}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {industries.map(c => (
              <div key={c.title} className={card}>
                <div className={num}>{c.n}</div>
                <h3 className="mt-2 mb-2 text-lg font-bold text-gray-900">{c.title}</h3>
                <p className="text-sm text-gray-600">{c.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Marketplace */}
      <section id="marketplace" className="bg-emerald-50/60 py-16 md:py-20 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-5">
          <Head kicker={t('platformHome.marketKicker')} title={t('platformHome.marketTitle')} text={t('platformHome.marketText')} />
          <div className="grid md:grid-cols-3 gap-4">
            {market.map(c => (
              <div key={c.title} className={card}>
                <div className={num}>{c.n}</div>
                <h3 className="mt-2 mb-2 text-lg font-bold text-gray-900">{c.title}</h3>
                <p className="text-sm text-gray-600">{c.text}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-8 flex flex-wrap justify-center gap-3">
            <button className={primary} onClick={() => go('services')}>{t('platformHome.marketCta1')} ↗</button>
            <button className={outline} onClick={() => go('booking')}>{t('platformHome.marketCta2')}</button>
          </div>
        </div>
      </section>

      {/* White label */}
      <section id="white-label" className="bg-gray-900 text-white py-16 md:py-20 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-5">
          <Head light kicker={t('platformHome.wlKicker')} title={t('platformHome.wlTitle')} text={t('platformHome.wlText')} />
          <div className="bg-white rounded-3xl p-7 grid md:grid-cols-2 gap-6 items-center text-gray-800">
            <div>
              <Kicker>{t('platformHome.wlCardKicker')}</Kicker>
              <h2 className="mt-3 mb-3 text-2xl md:text-3xl font-extrabold tracking-tight text-gray-900">{t('platformHome.wlCardTitle')}</h2>
              <p className="text-gray-600 mb-5">{t('platformHome.wlCardText')}</p>
              <button className={primary} onClick={() => go('white-label')}>{t('platformHome.wlCta')} ↗</button>
            </div>
            <div className="relative h-52 rounded-2xl overflow-hidden bg-gradient-to-br from-emerald-50 to-slate-200">
              <span className="absolute left-5 bottom-5 text-2xl font-bold text-[#1A365D]">{t('platformHome.wlSwatch')}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Shared foundation */}
      <section className="bg-emerald-50/60 py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-5">
          <Head kicker={t('platformHome.sharedKicker')} title={t('platformHome.sharedTitle')} text={t('platformHome.sharedText')} />
          <div className="grid md:grid-cols-3 gap-4">
            {shared.map(c => (
              <div key={c.title} className={card}>
                <div className={num}>{c.n}</div>
                <h3 className="mt-2 mb-2 text-lg font-bold text-gray-900">{c.title}</h3>
                <p className="text-sm text-gray-600">{c.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Moving and transport: the full front page is transport.flyttgo.no */}
      <section id="moving" className="py-16 md:py-20 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-5 grid lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-14 items-start">
          <div>
            <Kicker>{t('platformHome.movingKicker')}</Kicker>
            <h2 className="mt-3 mb-4 text-3xl md:text-4xl font-extrabold tracking-tight leading-tight text-gray-900">{t('platformHome.movingTitle')}</h2>
            <p className="text-gray-600 mb-6">{t('platformHome.movingText')}</p>
            <div className="flex flex-wrap gap-3">
              <button className={primary} onClick={toTransport}>{t('platformHome.movingCta1')} ↗</button>
              <button className={outline} onClick={() => go('booking')}>{t('platformHome.movingCta2')}</button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {moving.map(x => (
              <div key={x.title} className="bg-white border border-gray-200 rounded-xl p-5">
                <b className="block text-sm text-emerald-700">{x.title}</b>
                <span className="text-sm text-gray-600">{x.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Next step */}
      <section className="bg-emerald-50/60 py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-5">
          <div className="rounded-3xl bg-gray-900 text-white text-center p-8 md:p-10">
            <Kicker light>{t('platformHome.ctaKicker')}</Kicker>
            <h2 className="mt-3 mb-3 text-3xl md:text-4xl font-extrabold tracking-tight">{t('platformHome.ctaTitle')}</h2>
            <p className="text-gray-300 max-w-2xl mx-auto mb-6">{t('platformHome.ctaText')}</p>
            <button className={`${btn} bg-emerald-500 text-gray-900 hover:bg-emerald-400`} onClick={() => go('contact')}>{t('platformHome.ctaButton')} ↗</button>
          </div>
        </div>
      </section>
    </main>
  );
}
