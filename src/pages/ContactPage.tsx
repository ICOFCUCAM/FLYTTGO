import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';

/* Channel icon paths kept here since they never change. Labels and
 * sublines are looked up from the translation bundle at render time. */
const CHANNEL_ICONS = {
  phone:    'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  email:    'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  whatsapp: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  office:   'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z',
};

export default function ContactPage() {
  const { setPage } = useApp();
  const { t } = useTranslation();

  const reasons = [
    t('contact.reasonGeneral'),
    t('contact.reasonBooking'),
    t('contact.reasonDriver'),
    t('contact.reasonBusiness'),
    t('contact.reasonClaim'),
    t('contact.reasonPress'),
    t('contact.reasonPartner'),
  ];

  const channels = [
    { icon: CHANNEL_ICONS.phone,    title: t('contact.phoneTitle'),    line1: '+44 7432 112438', line2: t('contact.phoneLine2'),    href: 'tel:+447432112438' },
    { icon: CHANNEL_ICONS.email,    title: t('contact.emailTitle'),    line1: 'support@flyttgo.no', line2: t('contact.emailLine2'),    href: 'mailto:support@flyttgo.no' },
    { icon: CHANNEL_ICONS.whatsapp, title: t('contact.whatsappTitle'), line1: '+44 7432 112438', line2: t('contact.whatsappLine2'), href: 'https://wa.me/447432112438' },
    { icon: CHANNEL_ICONS.office,   title: t('contact.officeTitle'),   line1: t('contact.officeLine1'), line2: t('contact.officeLine2'), href: 'https://www.google.com/maps?q=Karl+Johans+gate+1+Oslo' },
  ];

  const [form, setForm] = useState({
    name: '', email: '', phone: '', reason: reasons[0], subject: '', message: '',
  });
  const [sent, setSent] = useState(false);

  function submit() {
    if (!form.name || !form.email || !form.message) return;
    /* This is a client-stub until the send-contact-message Edge
     * Function is wired up. For now we pretend it went out and
     * let ops triage from the inbox at support@flyttgo.no. */
    setSent(true);
  }

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-4 py-2 rounded-full mb-6">
            💬 {t('contact.heroBadge')}
          </div>
          <h1 className="text-5xl font-extrabold mb-5 leading-tight">{t('contact.heroTitle')}</h1>
          <p className="text-white/75 text-lg max-w-xl mx-auto">
            {t('contact.heroSubtitle')}
          </p>
        </div>
      </section>

      {/* CHANNELS */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10 relative z-10">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {channels.map(c => (
            <a
              key={c.title}
              href={c.href}
              target={c.href.startsWith('http') ? '_blank' : undefined}
              rel="noopener noreferrer"
              className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-xl hover:border-emerald-200 transition group"
            >
              <div className="w-11 h-11 bg-emerald-50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-emerald-600 transition">
                <svg className="w-5 h-5 text-emerald-600 group-hover:text-white transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={c.icon}/>
                </svg>
              </div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">{c.title}</div>
              <div className="text-sm font-semibold text-[#0B2E59]">{c.line1}</div>
              <div className="text-xs text-gray-500 mt-1">{c.line2}</div>
            </a>
          ))}
        </div>
      </section>

      {/* FORM */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid lg:grid-cols-5 gap-10">
          <div className="lg:col-span-2">
            <h2 className="text-3xl font-extrabold text-[#0B2E59] mb-4">{t('contact.formTitle')}</h2>
            <p className="text-gray-600 leading-relaxed mb-6">
              {t('contact.formBody')}
            </p>
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5">
              <div className="text-sm font-bold text-emerald-700 mb-2">{t('contact.bookingTitle')}</div>
              <p className="text-xs text-gray-600 mb-3">{t('contact.bookingBody')}</p>
              <button onClick={() => setPage('my-bookings')} className="text-sm font-semibold text-emerald-700 hover:underline">
                {t('contact.bookingCta')}
              </button>
            </div>
          </div>

          <div className="lg:col-span-3">
            {sent ? (
              <div className="bg-white border border-emerald-100 rounded-2xl p-8 text-center shadow-xl">
                <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-[#0B2E59] mb-2">{t('contact.sentTitle')}</h3>
                <p className="text-sm text-gray-500">{t('contact.sentBody1')} <strong>{form.email}</strong> {t('contact.sentBody2')}</p>
                <button onClick={() => { setSent(false); setForm({ name: '', email: '', phone: '', reason: reasons[0], subject: '', message: '' }); }}
                  className="mt-6 text-sm font-semibold text-emerald-700 hover:underline">
                  {t('contact.sendAnother')}
                </button>
              </div>
            ) : (
              <div className="bg-white border border-gray-100 rounded-2xl p-7 shadow-xl space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">{t('contact.fieldName')} *</label>
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"/>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">{t('contact.fieldEmail')} *</label>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"/>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">{t('contact.fieldPhone')}</label>
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="+47 XXX XX XXX"
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"/>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">{t('contact.fieldReason')}</label>
                    <select value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white">
                      {reasons.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">{t('contact.fieldSubject')}</label>
                  <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"/>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">{t('contact.fieldMessage')} *</label>
                  <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                    rows={5} placeholder={t('contact.messagePlaceholder')}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none resize-none"/>
                </div>
                <button onClick={submit}
                  className="w-full py-3.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg text-sm">
                  {t('contact.sendBtn')}
                </button>
                <p className="text-[11px] text-gray-400 text-center">
                  {t('contact.privacyNote1')} <button onClick={() => setPage('privacy')} className="underline hover:text-gray-600">{t('contact.privacyNote2')}</button>.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

    </div>
  );
}
