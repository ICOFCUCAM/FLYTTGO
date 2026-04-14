import React from 'react';
import { useApp } from '../lib/store';

const PERKS = [
  { icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    title: 'Fast-moving team', desc: 'We ship weekly. Decisions happen in meetings that end in 30 minutes.' },
  { icon: 'M3 10h18M3 14h18m-9-8l6 10-6-10z',
    title: 'Meaningful work', desc: 'What you build is used by thousands of Norwegians every week.' },
  { icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    title: 'Great people',    desc: 'Small team, high trust, and we actively hire for nice humans.' },
  { icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    title: 'Real equity',     desc: 'All employees get options. When we win, you win.' },
  { icon: 'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z',
    title: 'Learning budget', desc: '15,000 NOK/year for books, courses, conferences and certifications.' },
  { icon: 'M5 13l4 4L19 7',
    title: '5 weeks vacation',desc: 'Plus Norwegian public holidays and a paid week over Christmas.' },
];

const OPENINGS = [
  { title: 'Senior Full-Stack Engineer', team: 'Engineering', location: 'Oslo · Hybrid', type: 'Full-time' },
  { title: 'Product Designer',            team: 'Design',      location: 'Oslo · Hybrid', type: 'Full-time' },
  { title: 'Operations Lead',             team: 'Operations',  location: 'Oslo · On-site', type: 'Full-time' },
  { title: 'Customer Support Specialist', team: 'Support',     location: 'Remote (NO)',    type: 'Full-time' },
  { title: 'Growth Marketer',             team: 'Marketing',   location: 'Oslo · Hybrid', type: 'Full-time' },
  { title: 'Finance & Operations Intern', team: 'Finance',     location: 'Oslo · On-site', type: 'Internship' },
];

export default function CareersPage() {
  const { setPage } = useApp();

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-xs font-medium px-4 py-2 rounded-full mb-6">
            💼 We&apos;re hiring
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold mb-5 leading-tight">Build the future of moving.</h1>
          <p className="text-white/75 text-lg max-w-2xl mx-auto">
            FlyttGo is small, profitable, and growing fast. If you like building things that
            thousands of Norwegians rely on — and you&apos;d rather ship than meet — come join us.
          </p>
        </div>
      </section>

      {/* WHY US */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">Why FlyttGo</div>
          <h2 className="text-3xl font-extrabold text-[#0B2E59] mb-3">The things we&apos;re proud of</h2>
          <p className="text-gray-500 max-w-2xl mx-auto">Our team is the most important thing we&apos;ll ever build. Here&apos;s what we do to take care of it.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {PERKS.map(p => (
            <div key={p.title} className="bg-gray-50 rounded-2xl p-6 hover:bg-emerald-50 transition group">
              <div className="w-11 h-11 bg-white group-hover:bg-emerald-600 rounded-xl flex items-center justify-center mb-4 shadow-sm transition">
                <svg className="w-5 h-5 text-emerald-600 group-hover:text-white transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={p.icon}/>
                </svg>
              </div>
              <h3 className="font-bold text-[#0B2E59] mb-1.5">{p.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* OPENINGS */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">Open roles</h2>
          <p className="text-gray-500 text-center mb-12">Don&apos;t see your role? We&apos;re always open to talented people — send us a note.</p>
          <div className="space-y-3">
            {OPENINGS.map(job => (
              <div key={job.title}
                className="bg-white rounded-2xl p-5 border border-gray-100 hover:border-emerald-200 hover:shadow-xl transition group flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-[#0B2E59] group-hover:text-emerald-700 transition">{job.title}</h3>
                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase tracking-wide">{job.type}</span>
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-3">
                    <span>{job.team}</span>
                    <span>·</span>
                    <span>{job.location}</span>
                  </div>
                </div>
                <button onClick={() => setPage('contact')}
                  className="flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:gap-3 transition-all">
                  Apply
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DRIVER CTA */}
      <section className="bg-white py-20">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">Not an office role?</div>
          <h2 className="text-3xl font-extrabold text-[#0B2E59] mb-4">Join as a driver instead</h2>
          <p className="text-gray-600 mb-8">Have a van and a registered Norwegian business? Drive for FlyttGo — flexible hours,
            weekly payouts, and lower commission the more you drive.</p>
          <button onClick={() => setPage('driver-onboarding')}
            className="px-8 py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg">
            Apply as a Driver
          </button>
        </div>
      </section>

    </div>
  );
}
