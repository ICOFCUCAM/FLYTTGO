import React, { useState } from 'react';
import { useApp } from '../lib/store';
import { CONTACT_LIMITS, sendContactForm } from '../lib/contact';

/* Ways a company can use FlyttGo today. There is no paid corporate plan:
 * the company account is free, jobs are priced per booking, and larger
 * volumes are by written offer (platform audit 2026-10-30). */
const PLANS = [
  { name: 'Pay per job', price: '0', desc: 'Book and pay for each job as you go', features: ['Price shown before you book, MVA included', 'Pay by card or Vipps', 'Tracking during the job', 'Free cancellation until 24 h before pickup'], highlight: false },
  { name: 'Company account', price: '0', desc: 'For teams that book for their company', features: ['Bookers and roles for your team', 'Invoice once FlyttGo switches it on for you', 'Per booking or monthly invoices', 'Spending limits and approvals', 'API access for your own systems'], highlight: true },
  { name: 'Larger volumes', price: 'Custom', desc: 'For regular or large volumes', features: ['Written offer for your volumes', 'Payment terms agreed with you', 'Several locations under one company', 'White-label options'], highlight: false },
];

const FEATURES = [
  { icon: '📊', title: 'Company Dashboard', desc: 'See your company\u2019s bookings, spending and invoices in one place.' },
  { icon: '📄', title: 'Invoicing', desc: 'Invoiced per booking or once a month, with MVA and KID — compatible with Norwegian accounting systems.' },
  { icon: '🔁', title: 'Recurring Deliveries', desc: 'Coming soon: regular runs on a schedule. Until then, book each run from your company account.' },
  { icon: '🔗', title: 'API Integration', desc: 'Connect FlyttGo directly to your ERP, WMS, or e-commerce platform via our REST API.' },
  { icon: '👥', title: 'Multi-User Access', desc: 'Add team members, set permissions, and manage bookings across departments.' },
  { icon: '🛡️', title: 'Approved Drivers', desc: 'Every driver uploads ID, licence, vehicle registration and insurance documents and is approved by FlyttGo before taking jobs.' },
];

const INDUSTRIES = ['Furniture Retail', 'E-Commerce', 'Construction', 'Healthcare', 'Events & Exhibitions', 'Hospitality', 'Manufacturing', 'Property Management'];

export default function CorporatePage() {
  const { setPage } = useApp();
  const [contactSent, setContactSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ company: '', name: '', email: '', phone: '', volume: '', message: '' });

  /* Sent to the Inbox under Admin (submit_contact_message, migration
   * 00026). "Request received" is shown only when it was stored. */
  async function handleSubmit() {
    setError('');
    setSending(true);
    const res = await sendContactForm({
      source: 'corporate', company: form.company, name: form.name, email: form.email, phone: form.phone,
      topic: form.volume ? `Estimated monthly volume: ${form.volume}` : 'Corporate enquiry', message: form.message,
    }, ['company', 'email'], 'Please enter your company name and email.');
    setSending(false);
    if (res.ok) setContactSent(true); else setError(res.error);
  }

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="bg-gradient-to-br from-[#0B2E59] via-[#0B2E59] to-[#1a4a8a] text-white py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-10 left-10 w-96 h-96 bg-white rounded-full blur-3xl"/>
          <div className="absolute bottom-10 right-10 w-64 h-64 bg-[#F2B705] rounded-full blur-3xl"/>
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-4 py-2 rounded-full mb-6">
                🏢 Corporate Logistics Platform
              </div>
              <h1 className="text-5xl font-extrabold mb-5 leading-tight">
                Move Your Business<br/><span className="text-[#F2B705]">Faster</span>
              </h1>
              <p className="text-white/75 text-lg mb-8 leading-relaxed">
                FlyttGo Corporate gives your business approved transport providers across Norway — with a company account for your team, invoicing and API access.
              </p>
              <div className="flex flex-wrap gap-3 mb-8">
                {['Approved drivers', 'Bookings across Norway', 'Tracking for every job', 'Norwegian VAT invoicing'].map(b => (
                  <span key={b} className="bg-white/10 text-white/80 text-sm px-4 py-1.5 rounded-full">✓ {b}</span>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { document.getElementById('contact-form')?.scrollIntoView({ behavior: 'smooth' }); }}
                  className="px-8 py-4 bg-[#F2B705] text-[#0B2E59] rounded-xl font-bold text-base hover:bg-[#F2B705]/90 transition shadow-lg">
                  Get a Corporate Quote
                </button>
                <button onClick={() => setPage('booking')}
                  className="px-8 py-4 bg-white/10 text-white rounded-xl font-semibold text-base hover:bg-white/20 transition">
                  Book a Job Now
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Company account', value: 'Free' },
                { label: 'Included in every price', value: 'MVA' },
                { label: 'Once switched on for you', value: 'Invoice' },
                { label: 'For your own systems', value: 'API' },
              ].map(stat => (
                <div key={stat.label} className="bg-white/10 rounded-2xl p-5 backdrop-blur-sm text-center">
                  <div className="text-3xl font-extrabold text-[#F2B705] mb-1">{stat.value}</div>
                  <div className="text-xs text-white/60 uppercase tracking-wide">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">Built for Business</h2>
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">Everything you need to manage logistics at scale — from one-off deliveries to enterprise freight programmes.</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map(f => (
            <div key={f.title} className="bg-gray-50 rounded-2xl p-6 hover:shadow-md transition">
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="font-bold text-gray-900 mb-2">{f.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* INDUSTRIES */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-3">Industries FlyttGo Can Serve</h2>
          <p className="text-gray-500 mb-8">From retail to construction — FlyttGo Corporate fits any sector.</p>
          <div className="flex flex-wrap justify-center gap-3">
            {INDUSTRIES.map(ind => (
              <span key={ind} className="px-4 py-2 bg-white border border-gray-200 rounded-full text-sm font-medium text-gray-700 shadow-sm">{ind}</span>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">Ways to Use FlyttGo</h2>
        <p className="text-gray-500 text-center mb-12">Job prices include 25% MVA. The company account is free; larger volumes by written offer.</p>
        <div className="grid md:grid-cols-3 gap-6">
          {PLANS.map(plan => (
            <div key={plan.name} className={`rounded-2xl p-6 border-2 relative ${plan.highlight ? 'border-[#0B2E59] shadow-xl' : 'border-gray-200'}`}>
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#0B2E59] text-white text-xs px-4 py-1 rounded-full font-semibold">For teams</span>
              )}
              <h3 className="font-extrabold text-xl text-gray-900 mb-1">{plan.name}</h3>
              <p className="text-gray-500 text-xs mb-3">{plan.desc}</p>
              <div className="text-3xl font-extrabold text-[#0B2E59] mb-1">
                {plan.price === 'Custom' ? 'Custom' : `${plan.price} NOK`}
                {plan.price !== 'Custom' && plan.price !== '0' && <span className="text-sm font-normal text-gray-400">/mo</span>}
              </div>
              <ul className="space-y-2 my-5">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="text-emerald-500 font-bold">✓</span>{f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => plan.price === '0' ? setPage('booking') : document.getElementById('contact-form')?.scrollIntoView({ behavior: 'smooth' })}
                className={`w-full py-3 rounded-xl font-bold text-sm transition ${plan.highlight ? 'bg-[#0B2E59] text-white hover:bg-[#1a4a8a]' : 'border-2 border-[#0B2E59] text-[#0B2E59] hover:bg-[#0B2E59] hover:text-white'}`}>
                {plan.price === '0' ? 'Start Free' : plan.price === 'Custom' ? 'Contact Sales' : 'Get Started'}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* CONTACT FORM */}
      <section id="contact-form" className="bg-[#0B2E59] py-16">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-3xl font-extrabold text-white text-center mb-2">Get a Corporate Quote</h2>
          <p className="text-white/60 text-center mb-8">Tell us what you need and the FlyttGo team will reply by email.</p>
          {contactSent ? (
            <div className="bg-white/10 rounded-2xl p-8 text-center">
              <div className="text-5xl mb-4">✅</div>
              <h3 className="text-xl font-bold text-white mb-2">Request received</h3>
              <p className="text-white/70">Thank you. The FlyttGo team has your enquiry and will reply to <strong>{form.email}</strong>.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-8 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Company Name *</label>
                  <input aria-label="Company Name" maxLength={CONTACT_LIMITS.company} value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                    placeholder="Acme AS" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none"/>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Contact Name</label>
                  <input aria-label="Contact Name" maxLength={CONTACT_LIMITS.name} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Ola Nordmann" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none"/>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Email *</label>
                  <input type="email" aria-label="Email" maxLength={CONTACT_LIMITS.email} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="ola@company.no" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none"/>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Phone</label>
                  <input aria-label="Phone" maxLength={CONTACT_LIMITS.phone} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+47 XXX XX XXX" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none"/>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Estimated Monthly Volume</label>
                <select value={form.volume} onChange={e => setForm(f => ({ ...f, volume: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none bg-white">
                  <option value="">Select range</option>
                  <option>1–10 jobs/month</option>
                  <option>10–50 jobs/month</option>
                  <option>50–200 jobs/month</option>
                  <option>200+ jobs/month</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Tell us about your needs</label>
                <textarea aria-label="Tell us about your needs" maxLength={CONTACT_LIMITS.message} value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  rows={3} placeholder="Describe your logistics requirements..."
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none resize-none"/>
              </div>
              {error && (
                <div role="alert" className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>
              )}
              <button onClick={handleSubmit} disabled={sending}
                className="w-full py-3.5 bg-[#0B2E59] text-white rounded-xl font-bold hover:bg-[#1a4a8a] transition text-sm disabled:opacity-60">
                {sending ? 'Sending\u2026' : 'Submit Corporate Enquiry'}
              </button>
              <p className="text-xs text-gray-400 text-center">We reply by email · No commitment required</p>
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
