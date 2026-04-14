import React from 'react';
import { useApp } from '../lib/store';

const VETTING_STEPS = [
  { step: '1', title: 'Identity check', desc: 'Valid BankID or passport matched to a Norwegian driver license.' },
  { step: '2', title: 'Business check', desc: 'Active Brønnøysund registration number, VAT status and company address verified.' },
  { step: '3', title: 'Insurance check', desc: 'Goods-in-transit policy confirmed with the carrier (Gjensidige, If, Tryg, etc.).' },
  { step: '4', title: 'Vehicle check', desc: 'Registration, EU-control (PKK) and road-worthiness verified against SVV records.' },
  { step: '5', title: 'Background check', desc: 'Driving-history report. No serious convictions in the last five years.' },
  { step: '6', title: 'Interview',      desc: 'Personal interview with our ops team. Unsatisfactory answers = no activation.' },
];

const INSURANCE = [
  { title: 'Goods in transit',  limit: 'Up to 500,000 NOK', desc: 'Every booking is covered from pickup to delivery by the driver\u2019s carrier policy.' },
  { title: 'Public liability',  limit: 'Up to 10 M NOK',    desc: 'Covers damage to property at pickup and drop-off addresses (walls, floors, lifts).' },
  { title: 'Escrow protection', limit: 'Full booking cost', desc: 'Payment is held by FlyttGo until you confirm the delivery. No confirm = no charge.' },
  { title: 'Dispute resolution',limit: '7-day window',      desc: 'Our ops team mediates any dispute and can reverse the escrow payment if justified.' },
];

const CLAIM_STEPS = [
  { title: 'Open the booking in your dashboard',   desc: 'Go to My Bookings, select the relevant job and click "File a claim".' },
  { title: 'Describe the issue',                    desc: 'Upload photos (before/after if possible), describe what happened, and list the damaged items.' },
  { title: 'We contact the driver\u2019s insurance', desc: 'FlyttGo routes the claim to the carrier\u2019s policy and tracks progress on your behalf.' },
  { title: 'Resolution',                            desc: 'Most claims are settled within 14 days. If the driver\u2019s insurance denies without cause, FlyttGo covers it.' },
];

export default function SafetyPage() {
  const { setPage } = useApp();

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-xs font-medium px-4 py-2 rounded-full mb-6">
            🛡️ Trust & Safety
          </div>
          <h1 className="text-5xl font-extrabold mb-5 leading-tight">Your move, fully covered.</h1>
          <p className="text-white/75 text-lg max-w-2xl mx-auto">
            Every driver on FlyttGo is vetted, insured, and held accountable by a live rating
            system. Here&apos;s exactly how we keep you and your belongings safe.
          </p>
        </div>
      </section>

      {/* VETTING */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">Driver Vetting</div>
          <h2 className="text-3xl font-extrabold text-[#0B2E59] mb-3">6 checks before a driver takes a single booking</h2>
          <p className="text-gray-500 max-w-2xl mx-auto">No one gets on the platform by filling a form. Every driver goes through the full
            vetting pipeline, and we re-verify insurance and business status every 12 months.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {VETTING_STEPS.map(v => (
            <div key={v.step} className="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-xl hover:border-emerald-200 transition">
              <div className="w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center font-bold mb-4">{v.step}</div>
              <h3 className="font-bold text-[#0B2E59] mb-2">{v.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* INSURANCE */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">Insurance Coverage</div>
            <h2 className="text-3xl font-extrabold text-[#0B2E59] mb-3">Four layers of protection</h2>
            <p className="text-gray-500 max-w-2xl mx-auto">You&apos;re never dealing with one uninsured guy and a van. Every FlyttGo move sits
              inside this protection stack by default.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            {INSURANCE.map(c => (
              <div key={c.title} className="bg-white rounded-2xl p-6 border border-gray-100">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <h3 className="font-bold text-[#0B2E59]">{c.title}</h3>
                  <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full whitespace-nowrap">{c.limit}</span>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW CLAIMS WORK */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">If something goes wrong</h2>
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">We deal with fewer than 1 in 500 bookings as claims — but when it happens, here&apos;s
          exactly what to do.</p>
        <ol className="space-y-4">
          {CLAIM_STEPS.map((s, i) => (
            <li key={s.title} className="flex items-start gap-5 bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
              <div className="w-9 h-9 bg-[#0B2E59] text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">{i + 1}</div>
              <div>
                <h3 className="font-bold text-[#0B2E59] mb-1">{s.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-10 text-center">
          <button onClick={() => setPage('contact')}
            className="px-7 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition shadow-lg">
            Need help with a claim? Contact us
          </button>
        </div>
      </section>

      {/* SECURITY */}
      <section className="bg-[#0B2E59] text-white py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-extrabold mb-3">Data security</h2>
          <p className="text-white/70 mb-8 max-w-2xl mx-auto">Personal data is processed under GDPR and hosted in EU data centres (Frankfurt).
            Payment details are never stored on our servers — they go directly to our PCI-compliant
            processor. All traffic is HTTPS-only.</p>
          <div className="flex flex-wrap justify-center gap-3">
            {['GDPR', 'PCI-DSS', 'HTTPS-only', 'EU-hosted', 'Encrypted at rest'].map(b => (
              <span key={b} className="bg-white/10 text-white/80 text-sm px-4 py-1.5 rounded-full border border-white/10">✓ {b}</span>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
