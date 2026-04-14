import React from 'react';
import { useApp } from '../lib/store';

const INITIATIVES = [
  {
    icon: 'M17 8l4 4m0 0l-4 4m4-4H3',
    title: 'Shared vans, fewer trips',
    desc:  'Our matching algorithm bundles compatible jobs along the same route, cutting empty miles by up to 28% vs. solo bookings.',
    stat:  '−28%',
    statLabel: 'empty miles',
  },
  {
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    title: 'Electric fleet incentives',
    desc:  'Drivers using EV or hybrid vans get a 3% commission discount and priority dispatch. Over 34% of our Oslo fleet is now electric.',
    stat:  '34%',
    statLabel: 'EV fleet share',
  },
  {
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    title: 'Smart timing',
    desc:  'Route optimisation and off-peak incentives keep vans out of rush hour — less idling, less CO\u2082, better for everyone.',
    stat:  '−15%',
    statLabel: 'idle time',
  },
  {
    icon: 'M4 6h16M4 12h16M4 18h7',
    title: 'Paperless by default',
    desc:  'All quotes, receipts, MVA invoices and damage claims are digital. No printed paperwork in the van — ever.',
    stat:  '0',
    statLabel: 'printed receipts',
  },
  {
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    title: 'Reusable blankets & crates',
    desc:  'Every partner driver carries reusable moving blankets, straps and crates — no single-use plastic wrap, no cardboard waste.',
    stat:  '100%',
    statLabel: 'reusable kit',
  },
  {
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    title: 'Carbon offset for every booking',
    desc:  'A fixed percentage of every booking goes to verified Norwegian forest projects via Klimafondet. You get a certificate in your receipt.',
    stat:  '1%',
    statLabel: 'per booking',
  },
];

export default function SustainabilityPage() {
  const { setPage } = useApp();

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
            🌱 Moving, but greener
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold mb-5 leading-tight">A lighter footprint.</h1>
          <p className="text-white/75 text-lg sm:text-xl max-w-2xl mx-auto">
            A logistics platform should leave things in better shape than it found them — the
            streets, the climate, and the driver earning a living on them.
          </p>
        </div>
      </section>

      {/* BY THE NUMBERS */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10 relative z-10 mb-16">
        <div className="bg-white rounded-3xl shadow-xl p-8 sm:p-10 border border-gray-100">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { v: '1,240 t', l: 'CO\u2082 avoided since 2024' },
              { v: '34%',      l: 'EV / hybrid fleet share' },
              { v: '1,000+',   l: 'Reusable moving kits in use' },
              { v: '1%',       l: 'of revenue offset' },
            ].map(s => (
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
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">What we actually do</h2>
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">No greenwashing — here are the six initiatives in place today and the numbers backing them up.</p>
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
          <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-3">Move with a lighter footprint</h2>
          <p className="text-gray-600 mb-6">Every booking on FlyttGo is a little greener by default — and you can tick the
            EV-only option at checkout to make sure your driver arrives in an electric van.</p>
          <button onClick={() => setPage('booking')}
            className="px-8 py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg">
            Book a Greener Move
          </button>
        </div>
      </section>

    </div>
  );
}
