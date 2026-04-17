import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, Page } from '../lib/store';

interface LinkItem { label: string; page: Page; }

export default function Footer() {
  const { setPage } = useApp();
  const { t } = useTranslation();
  const [email, setEmail]         = useState('');
  const [subscribed, setSubscribed] = useState(false);

  function handleSubscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !/.+@.+\..+/.test(email)) return;
    /* Client stub — we don't have an email list wired yet. When we
     * do, POST to /functions/v1/subscribe-newsletter from here. */
    setSubscribed(true);
    setEmail('');
  }

  /* --- Column data ---------------------------------------------- */
  const services: LinkItem[] = [
    { label: t('home.serviceMoving'),    page: 'services' },
    { label: t('home.serviceFurniture'), page: 'services' },
    { label: t('home.serviceOffice'),    page: 'services' },
    { label: t('home.serviceStudent'),   page: 'services' },
    { label: t('home.serviceSameDay'),   page: 'services' },
    { label: t('home.vanSizeGuide'),     page: 'van-guide' },
  ];

  const cities: LinkItem[] = [
    { label: `${t('home.cityMovingHelp')} Oslo`,        page: 'services' },
    { label: `${t('home.cityMovingHelp')} Bergen`,      page: 'services' },
    { label: `${t('home.cityMovingHelp')} Trondheim`,   page: 'services' },
    { label: `${t('home.cityMovingHelp')} Stavanger`,   page: 'services' },
    { label: `${t('home.cityMovingHelp')} Drammen`,     page: 'services' },
    { label: `${t('home.cityMovingHelp')} Fredrikstad`, page: 'services' },
  ];

  const company: LinkItem[] = [
    { label: t('about.ctaBook', 'About FlyttGo'), page: 'about' },
    { label: t('careers.title', 'Careers'),        page: 'careers' },
    { label: t('press.title', 'Press & Media'),    page: 'press' },
    { label: t('sustainability.title', 'Sustainability'), page: 'sustainability' },
    { label: t('driverOnboarding.heroTitle', 'For Drivers'), page: 'driver-onboarding' },
    { label: t('header.movingTools', 'Driver Subscriptions'), page: 'subscriptions' },
  ];

  const resources: LinkItem[] = [
    { label: t('help.title', 'Help Center'),       page: 'help' },
    { label: t('faq.title', 'FAQ'),                 page: 'faq' },
    { label: t('safety.title', 'Safety & Insurance'), page: 'safety' },
    { label: t('booking.checklist', 'Moving Checklist'), page: 'checklist' },
    { label: t('home.vanSizeGuide'),                page: 'van-guide' },
    { label: t('contact.heroTitle', 'Contact Us'),  page: 'contact' },
  ];

  const corporate: LinkItem[] = [
    { label: t('header.corporate', 'FlyttGo for Business'), page: 'corporate' },
    { label: t('booking.bulkBooking', 'Bulk Booking'),       page: 'bulk-booking' },
    { label: t('booking.recurring', 'Recurring Deliveries'), page: 'recurring-deliveries' },
    { label: t('payment.invoice', 'Invoice & Billing'),      page: 'invoice-billing' },
    { label: t('booking.apiAccess', 'API Access'),           page: 'corporate-api-access' },
    { label: t('dashboard.title', 'Corporate Dashboard'),    page: 'corporate-dashboard' },
  ];

  return (
    <footer className="bg-gray-900 text-gray-300">

      {/* NEWSLETTER BAR */}
      <div className="border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div>
              <h3 className="text-white text-xl font-bold mb-1">{t('footer.newsletterTitle')}</h3>
              <p className="text-sm text-gray-400 max-w-md">{t('footer.newsletterDesc')}</p>
            </div>
            {subscribed ? (
              <div className="flex items-center gap-2 text-emerald-300 text-sm font-semibold bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                </svg>
                {t('footer.subscribed')}
              </div>
            ) : (
              <form onSubmit={handleSubscribe} className="flex w-full lg:w-auto gap-2 lg:gap-3 max-w-md">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t('footer.newsletterPlaceholder')}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition"
                  aria-label={t('footer.newsletterPlaceholder')}
                />
                <button type="submit"
                  className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition whitespace-nowrap shadow-lg">
                  {t('footer.subscribe')}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* MAIN LINKS */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-10">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-8">
          {/* Brand col — spans two cells */}
          <div className="col-span-2 lg:col-span-2">
            <button onClick={() => setPage('home')} className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center shadow-sm">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
                </svg>
              </div>
              <span className="text-xl font-bold text-white">Flytt<span className="text-emerald-400">Go</span></span>
            </button>
            <p className="text-sm text-gray-400 mb-5 max-w-xs leading-relaxed">{t('footer.norwayMarketplace')}</p>

            {/* Contact summary */}
            <div className="space-y-2 text-xs mb-5">
              <a href="tel:+447432112438" className="flex items-center gap-2 text-gray-400 hover:text-emerald-400 transition">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                +44 7432 112438
              </a>
              <a href="mailto:support@flyttgo.no" className="flex items-center gap-2 text-gray-400 hover:text-emerald-400 transition">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                support@flyttgo.no
              </a>
              <div className="flex items-start gap-2 text-gray-400">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                <span>Karl Johans gate 1<br/>0154 Oslo, Norway</span>
              </div>
            </div>

            {/* Social */}
            <div className="flex gap-2">
              {[
                { name: 'Twitter',   d: 'M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z' },
                { name: 'Facebook',  d: 'M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z' },
                { name: 'LinkedIn',  d: 'M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z' },
                { name: 'Instagram', d: 'M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37zm1.5-4.87h.01' },
              ].map(s => (
                <a key={s.name} href="#" aria-label={s.name}
                  className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center hover:bg-emerald-600 transition">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={s.d}/></svg>
                </a>
              ))}
            </div>
          </div>

          {/* Services */}
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm">{t('footer.services')}</h4>
            <ul className="space-y-2.5 text-sm">
              {services.map(item => (
                <li key={item.label}>
                  <button onClick={() => setPage(item.page)} className="text-gray-400 hover:text-emerald-400 transition text-left">{item.label}</button>
                </li>
              ))}
            </ul>
          </div>

          {/* Cities */}
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm">{t('footer.cities')}</h4>
            <ul className="space-y-2.5 text-sm">
              {cities.map(item => (
                <li key={item.label}>
                  <button onClick={() => setPage(item.page)} className="text-gray-400 hover:text-emerald-400 transition text-left">{item.label}</button>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm">{t('footer.company')}</h4>
            <ul className="space-y-2.5 text-sm">
              {company.map(item => (
                <li key={item.label}>
                  <button onClick={() => setPage(item.page)} className="text-gray-400 hover:text-emerald-400 transition text-left">{item.label}</button>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm">{t('footer.resources')}</h4>
            <ul className="space-y-2.5 text-sm">
              {resources.map(item => (
                <li key={item.label}>
                  <button onClick={() => setPage(item.page)} className="text-gray-400 hover:text-emerald-400 transition text-left">{item.label}</button>
                </li>
              ))}
            </ul>
          </div>

          {/* Corporate column (spans full row on small screens) */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-6">
            <div className="border-t border-gray-800 pt-8">
              <h4 className="text-white font-semibold mb-4 text-sm">{t('footer.corporateCol')}</h4>
              <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-y-2.5 gap-x-6 text-sm">
                {corporate.map(item => (
                  <li key={item.label}>
                    <button onClick={() => setPage(item.page)} className="text-gray-400 hover:text-emerald-400 transition text-left">{item.label}</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* TRUST BADGES + PAYMENT METHODS */}
        <div className="mt-10 pt-8 border-t border-gray-800 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">{t('footer.paymentsAccepted')}</p>
            <div className="flex flex-wrap gap-2">
              {['Visa', 'Mastercard', 'Amex', 'Vipps', 'Apple Pay', 'Google Pay', 'Invoice'].map(p => (
                <span key={p} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 font-medium">
                  {p}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">{t('footer.appStoreCta')}</p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'App Store', sub: 'iOS' },
                { label: 'Google Play', sub: 'Android' },
              ].map(a => (
                <span key={a.label} className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-xl text-xs text-gray-300 font-medium flex items-center gap-2 opacity-70">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                  </svg>
                  <span>
                    <span className="block text-[9px] text-gray-500 uppercase leading-none">Download</span>
                    <span className="block font-semibold">{a.label}</span>
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* REGULATORY BLOCK */}
        <div className="border-t border-gray-800 mt-10 pt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-6 text-xs text-gray-500">
          <div>
            <div className="text-gray-400 font-semibold uppercase tracking-wide mb-1">{t('footer.companyLabel')}</div>
            <div className="leading-relaxed">
              FlyttGo AS<br/>
              Org. nr. <span className="font-mono">{/* TODO: real Brønnøysund nr */}NO 000 000 000</span>
            </div>
          </div>
          <div>
            <div className="text-gray-400 font-semibold uppercase tracking-wide mb-1">{t('footer.vatLabel')}</div>
            <div className="leading-relaxed">
              {t('footer.mvaRegistered')}<br/>
              <span className="font-mono">{/* TODO: real MVA number */}NO 000 000 000 MVA</span>
            </div>
          </div>
          <div>
            <div className="text-gray-400 font-semibold uppercase tracking-wide mb-1">{t('footer.insuranceLabel')}</div>
            <div className="leading-relaxed">
              {/* TODO: real carrier name (Gjensidige, If, Tryg, …) */}
              {t('footer.insuranceLine1')}<br/>
              {t('footer.insuranceLine2')}
            </div>
          </div>
          <div>
            <div className="text-gray-400 font-semibold uppercase tracking-wide mb-1">{t('footer.supportLabel')}</div>
            <div className="leading-relaxed">
              <a href="mailto:support@flyttgo.no" className="hover:text-gray-300">support@flyttgo.no</a><br/>
              {t('footer.supportHours')}
            </div>
          </div>
        </div>

        {/* BOTTOM STRIP */}
        <div className="border-t border-gray-800 mt-8 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-500 text-center md:text-left">
            {t('footer.rights')} · <span className="text-gray-600">{t('footer.builtIn')}</span>
          </p>
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-gray-500">
            <button onClick={() => setPage('privacy')}   className="hover:text-gray-300 transition">{t('footer.privacy')}</button>
            <button onClick={() => setPage('terms')}     className="hover:text-gray-300 transition">{t('footer.terms')}</button>
            <button onClick={() => setPage('liability')} className="hover:text-gray-300 transition">{t('footer.liability')}</button>
            <button onClick={() => setPage('privacy')}   className="hover:text-gray-300 transition">{t('footer.cookies')}</button>
            <button onClick={() => setPage('safety')}    className="hover:text-gray-300 transition">Safety</button>
            <button onClick={() => setPage('contact')}   className="hover:text-gray-300 transition">Contact</button>
          </div>
        </div>
      </div>

      {/* WhatsApp */}
      <a href="https://wa.me/447432112438" target="_blank" rel="noopener noreferrer"
        className="fixed bottom-6 right-6 w-14 h-14 bg-green-500 rounded-full flex items-center justify-center shadow-lg hover:bg-green-600 transition z-50 group">
        <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
        <span className="absolute -top-10 right-0 bg-gray-900 text-white text-xs px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition whitespace-nowrap">{t('footer.chatWithUs')}</span>
      </a>
    </footer>
  );
}
