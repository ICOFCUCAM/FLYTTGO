import React from 'react';
import { useApp } from '../lib/store';

const COVERAGE = [
  { outlet: 'E24',            title: 'FlyttGo hits 25,000 completed jobs across Norway',             date: 'Mar 2026', url: '#' },
  { outlet: 'Dagens Næringsliv', title: 'How a three-person startup reinvented Norwegian moving',    date: 'Jan 2026', url: '#' },
  { outlet: 'Shifter',         title: 'FlyttGo raises seed round to scale verified driver network',  date: 'Nov 2025', url: '#' },
  { outlet: 'Tek.no',          title: 'Real-time GPS tracking comes to Norwegian moving industry',   date: 'Sep 2025', url: '#' },
  { outlet: 'NRK',             title: 'Gig-economy drivers earn more with transparent pricing',      date: 'Jun 2025', url: '#' },
];

const FACTS = [
  { label: 'Founded',              value: '2024' },
  { label: 'Headquarters',         value: 'Oslo, Norway' },
  { label: 'Employees',            value: '42' },
  { label: 'Verified carriers',    value: '500+' },
  { label: 'Cities served',        value: '40+' },
  { label: 'Completed jobs',       value: '25,000+' },
];

export default function PressPage() {
  const { setPage } = useApp();

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-4 py-2 rounded-full mb-6">
            📰 Press & Media
          </div>
          <h1 className="text-5xl font-extrabold mb-5 leading-tight">Press room</h1>
          <p className="text-white/75 text-lg max-w-2xl mx-auto">
            Everything you need to write about FlyttGo — company facts, logos, executive bios and
            a direct line to our press team.
          </p>
        </div>
      </section>

      {/* QUICK FACTS */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10 relative z-10">
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-600 mb-5">Quick facts</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            {FACTS.map(f => (
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
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">In the news</h2>
        <p className="text-gray-500 text-center mb-12">Recent coverage of FlyttGo from Norwegian and international press.</p>
        <div className="space-y-3">
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
          <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">Brand assets</h2>
          <p className="text-gray-500 text-center mb-10">Our logo in every format, brand colours and typography guidelines.</p>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { title: 'Logo (SVG + PNG)',   size: '1.2 MB' },
              { title: 'Brand guidelines',    size: '3.4 MB' },
              { title: 'Product screenshots', size: '12 MB' },
            ].map(a => (
              <a key={a.title} href="#"
                className="bg-white border border-gray-100 rounded-2xl p-5 hover:shadow-xl hover:border-emerald-200 transition flex items-start gap-4">
                <div className="w-11 h-11 bg-emerald-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                  </svg>
                </div>
                <div>
                  <div className="font-semibold text-[#0B2E59] text-sm">{a.title}</div>
                  <div className="text-xs text-gray-500 mt-1">Download · {a.size}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-2">Press enquiries</h2>
        <p className="text-gray-600 mb-2">For interviews, executive commentary or background briefings:</p>
        <a href="mailto:press@flyttgo.no" className="text-lg font-bold text-emerald-700 hover:underline">press@flyttgo.no</a>
        <div className="mt-8">
          <button onClick={() => setPage('contact')}
            className="px-7 py-3 bg-[#0B2E59] text-white rounded-xl font-semibold hover:bg-[#1a4a8a] transition shadow-lg">
            Contact Form
          </button>
        </div>
      </section>

    </div>
  );
}
