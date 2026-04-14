import React, { useState } from 'react';
import { useApp, Page } from '../lib/store';

interface Topic {
  icon: string;
  title: string;
  desc: string;
  articles: { title: string; to?: Page; external?: string }[];
}

const TOPICS: Topic[] = [
  {
    icon: 'M9 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2h-4M9 11V7a3 3 0 016 0v4M9 11h6',
    title: 'Getting started',
    desc:  'Your first booking, how the platform works, and what to expect.',
    articles: [
      { title: 'How to book your first move',   to: 'booking' },
      { title: 'Understanding our pricing',     to: 'services' },
      { title: 'Van size and move type guide',  to: 'van-guide' },
      { title: 'Moving checklist',              to: 'checklist' },
    ],
  },
  {
    icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1',
    title: 'Payment & invoices',
    desc:  'Billing, MVA-compliant receipts, refunds and escrow.',
    articles: [
      { title: 'When am I charged?', to: 'faq' },
      { title: 'Downloading MVA receipts', to: 'my-bookings' },
      { title: 'How refunds work', to: 'faq' },
      { title: 'Corporate invoicing', to: 'invoice-billing' },
    ],
  },
  {
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
    title: 'Booking management',
    desc:  'Rescheduling, cancelling, adding items, tracking your driver.',
    articles: [
      { title: 'View and manage my bookings', to: 'my-bookings' },
      { title: 'Reschedule a booking', to: 'my-bookings' },
      { title: 'Tracking my driver', to: 'my-bookings' },
      { title: 'Cancellation policy', to: 'terms' },
    ],
  },
  {
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    title: 'Safety & insurance',
    desc:  'How drivers are vetted, what\u2019s covered, how to file a claim.',
    articles: [
      { title: 'Driver vetting process',    to: 'safety' },
      { title: 'Insurance coverage',         to: 'safety' },
      { title: 'How to file a damage claim', to: 'safety' },
      { title: 'Liability terms',            to: 'liability' },
    ],
  },
  {
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    title: 'Accounts & profile',
    desc:  'Password reset, email change, deleting your account.',
    articles: [
      { title: 'Reset my password', to: 'home' },
      { title: 'Update my profile', to: 'profile' },
      { title: 'Language preferences',   to: 'home' },
      { title: 'Delete my account',     to: 'contact' },
    ],
  },
  {
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
    title: 'For businesses',
    desc:  'Corporate logistics, bulk bookings, API integration.',
    articles: [
      { title: 'FlyttGo for businesses',   to: 'corporate' },
      { title: 'Bulk booking',             to: 'bulk-booking' },
      { title: 'Recurring deliveries',     to: 'recurring-deliveries' },
      { title: 'API documentation',        to: 'corporate-api-access' },
    ],
  },
];

export default function HelpCenterPage() {
  const { setPage } = useApp();
  const [search, setSearch] = useState('');

  const filtered = search
    ? TOPICS.map(t => ({
        ...t,
        articles: t.articles.filter(a => a.title.toLowerCase().includes(search.toLowerCase())),
      })).filter(t => t.articles.length > 0)
    : TOPICS;

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-4 py-2 rounded-full mb-6">
            📚 Help Center
          </div>
          <h1 className="text-5xl font-extrabold mb-5 leading-tight">How can we help?</h1>
          <p className="text-white/75 text-lg mb-8">Search our knowledge base or browse by topic.</p>
          <div className="relative max-w-xl mx-auto">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search for articles…"
              className="w-full pl-12 pr-4 py-4 rounded-2xl bg-white text-gray-900 placeholder-gray-400 focus:ring-4 focus:ring-emerald-400 outline-none shadow-xl"/>
          </div>
        </div>
      </section>

      {/* TOPICS */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(topic => (
            <div key={topic.title} className="bg-white rounded-2xl p-6 border border-gray-100 hover:border-emerald-200 hover:shadow-xl transition">
              <div className="w-11 h-11 bg-emerald-50 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={topic.icon}/>
                </svg>
              </div>
              <h3 className="font-bold text-[#0B2E59] mb-1.5">{topic.title}</h3>
              <p className="text-xs text-gray-500 mb-4 leading-relaxed">{topic.desc}</p>
              <ul className="space-y-2">
                {topic.articles.map(a => (
                  <li key={a.title}>
                    <button onClick={() => a.to && setPage(a.to)}
                      className="text-sm text-gray-700 hover:text-emerald-700 font-medium flex items-center gap-2 group text-left">
                      <svg className="w-3.5 h-3.5 text-gray-300 group-hover:text-emerald-600 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                      </svg>
                      {a.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* CONTACT CTA */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-2">Still need help?</h2>
          <p className="text-gray-600 mb-6">We&apos;re here seven days a week.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={() => setPage('contact')}
              className="px-7 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition shadow-lg">
              Contact Support
            </button>
            <button onClick={() => setPage('faq')}
              className="px-7 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-semibold hover:border-gray-300 transition">
              Browse FAQ
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}
