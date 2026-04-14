import React from 'react';
import { useApp } from '../lib/store';

const VALUES = [
  {
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    title: 'Trust by design',
    desc:
      'Every driver is a registered Norwegian business with mandatory goods-in-transit insurance. Payment is held in escrow until the customer confirms delivery.',
  },
  {
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    title: 'Speed with substance',
    desc:
      'Average driver match in under 30 seconds. You still get a verified carrier — not the first van that happened to be idle.',
  },
  {
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
    title: 'Built around people',
    desc:
      'Customers, drivers and businesses share the same platform. We win when everyone on it wins — fair dispatch, transparent pricing, honest ratings.',
  },
  {
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    title: 'Proudly Norwegian',
    desc:
      "FlyttGo AS is incorporated in Norway, registered with Brønnøysund, and operates under Norwegian consumer, VAT and employment law. We're local, not outsourced.",
  },
];

const TIMELINE = [
  { year: '2023', title: 'The problem', desc: 'Three co-founders, three bad moving experiences in six months. Opaque pricing, no tracking, and a driver who disappeared with a couch.' },
  { year: '2024', title: 'First booking',  desc: 'FlyttGo launched in Oslo with 12 pre-vetted drivers. First week: 42 completed jobs and a 4.9 average rating.' },
  { year: '2025', title: 'Nationwide',     desc: 'Expanded to Bergen, Trondheim, Stavanger, Drammen and Fredrikstad. Crossed 10,000 completed jobs.' },
  { year: '2026', title: 'Today',          desc: '500+ verified carriers, 25,000+ jobs delivered, corporate logistics portal live, real-time GPS tracking across the whole fleet.' },
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
            🇳🇴 Built in Norway for Norwegians
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold mb-6 leading-tight">
            Moving, but <span className="text-emerald-400">finally</span> done right.
          </h1>
          <p className="text-white/75 text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed">
            FlyttGo is the marketplace that connects Norwegian households and businesses with
            verified, insured transport providers — transparent prices, real-time tracking, and
            payment held in escrow until the job is actually done.
          </p>
        </div>
      </section>

      {/* MISSION */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">Our Mission</div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[#0B2E59] mb-4">Make moving as easy as hailing a ride.</h2>
          <p className="text-gray-600 text-lg leading-relaxed">
            Most Norwegians move once every seven years. It&apos;s expensive, stressful, and the
            market is built around the assumption that you&apos;ll never book a mover again. We want to
            change that — by building an honest, insured, app-first marketplace where prices are
            upfront, drivers are vetted, and the whole move takes less than three minutes to book.
          </p>
        </div>
      </section>

      {/* VALUES */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">What we believe</h2>
          <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">Four principles that decide every product call we make.</p>
          <div className="grid sm:grid-cols-2 gap-6">
            {VALUES.map(v => (
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
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">Our journey</h2>
        <p className="text-gray-500 text-center mb-12">From three frustrated customers to Norway&apos;s fastest-growing moving marketplace.</p>
        <div className="relative">
          <div className="absolute left-4 sm:left-1/2 -translate-x-0 sm:-translate-x-1/2 top-0 bottom-0 w-0.5 bg-gradient-to-b from-emerald-400 to-[#0B2E59]"/>
          <div className="space-y-10">
            {TIMELINE.map((item, i) => (
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
              { v: '25,000+', l: 'Deliveries completed' },
              { v: '500+',    l: 'Verified carriers' },
              { v: '40+',     l: 'Norwegian cities' },
              { v: '4.8★',    l: 'Average rating' },
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
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">As featured in</p>
        <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-4">
          {PRESS.map(p => (
            <span key={p} className="text-xl font-bold text-gray-300">{p}</span>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-extrabold text-[#0B2E59] mb-4">Ready to move?</h2>
          <p className="text-gray-600 text-lg mb-8">Book a verified driver in under three minutes — or get in touch if you&apos;d like to learn more about what we do.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={() => setPage('booking')}
              className="px-8 py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg">
              Book a Move
            </button>
            <button onClick={() => setPage('contact')}
              className="px-8 py-4 bg-white border-2 border-[#0B2E59] text-[#0B2E59] rounded-xl font-bold hover:bg-[#0B2E59] hover:text-white transition">
              Contact Us
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}
