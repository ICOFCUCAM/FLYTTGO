import React, { useState } from 'react';
import { useApp } from '../lib/store';

const PLANS = [
  { name: 'Starter', price: '0', desc: 'Pay-as-you-go for small teams', features: ['Up to 5 bookings/month', 'Standard dispatch priority', 'Email support', 'Basic reporting'], highlight: false },
  { name: 'Business', price: '1,490', desc: 'For growing companies', features: ['Unlimited bookings', 'Priority dispatch', 'Dedicated account manager', 'Monthly consolidated invoice', 'API access', 'Advanced analytics'], highlight: true },
  { name: 'Enterprise', price: 'Custom', desc: 'For large organisations', features: ['Volume discounts', 'SLA-guaranteed delivery', 'Custom integrations', 'Multi-site management', 'Quarterly business reviews', 'White-label options'], highlight: false },
];

const FEATURES = [
  { icon: '📊', title: 'Company Dashboard', desc: 'Track all bookings, spending, and delivery performance in a single control panel.' },
  { icon: '📄', title: 'Consolidated Invoicing', desc: 'One monthly invoice covering all jobs — compatible with Norwegian accounting systems.' },
  { icon: '🔁', title: 'Recurring Deliveries', desc: 'Schedule daily, weekly, or monthly delivery runs with automatic driver assignment.' },
  { icon: '🔗', title: 'API Integration', desc: 'Connect FlyttGo directly to your ERP, WMS, or e-commerce platform via our REST API.' },
  { icon: '👥', title: 'Multi-User Access', desc: 'Add team members, set permissions, and manage bookings across departments.' },
  { icon: '🛡️', title: 'Verified Carriers', desc: 'Every driver operates under a registered company with mandatory goods-in-transit insurance.' },
];

const INDUSTRIES = ['Furniture Retail', 'E-Commerce', 'Construction', 'Healthcare', 'Events & Exhibitions', 'Hospitality', 'Manufacturing', 'Property Management'];

export default function CorporatePage() {
  const { setPage } = useApp();
  const [contactSent, setContactSent] = useState(false);
  const [form, setForm] = useState({ company: '', name: '', email: '', phone: '', volume: '', message: '' });

  function handleSubmit() {
    if (!form.company || !form.email) return;
    setContactSent(true);
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
                FlyttGo Corporate gives your business access to Norway&apos;s largest network of verified transport providers — with invoicing, API access, and a dedicated account manager.
              </p>
              <div className="flex flex-wrap gap-3 mb-8">
                {['500+ verified carriers', 'Nationwide coverage', 'SLA-backed delivery', 'Norwegian VAT invoicing'].map(b => (
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
                { label: 'Active carriers', value: '500+' },
                { label: 'Cities covered', value: '40+' },
                { label: 'Jobs completed', value: '25k+' },
                { label: 'Avg rating', value: '4.8★' },
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
          <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-3">Industries We Serve</h2>
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
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">Corporate Plans</h2>
        <p className="text-gray-500 text-center mb-12">All prices ex. 25% MVA. Billed monthly.</p>
        <div className="grid md:grid-cols-3 gap-6">
          {PLANS.map(plan => (
            <div key={plan.name} className={`rounded-2xl p-6 border-2 relative ${plan.highlight ? 'border-[#0B2E59] shadow-xl' : 'border-gray-200'}`}>
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#0B2E59] text-white text-xs px-4 py-1 rounded-full font-semibold">Most Popular</span>
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
          <p className="text-white/60 text-center mb-8">We&apos;ll have your account set up within 24 hours.</p>
          {contactSent ? (
            <div className="bg-white/10 rounded-2xl p-8 text-center">
              <div className="text-5xl mb-4">✅</div>
              <h3 className="text-xl font-bold text-white mb-2">Request received!</h3>
              <p className="text-white/70">Your account manager will contact you within 24 hours.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-8 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Company Name *</label>
                  <input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                    placeholder="Acme AS" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none"/>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Contact Name</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Ola Nordmann" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none"/>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Email *</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="ola@company.no" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none"/>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Phone</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
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
                <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  rows={3} placeholder="Describe your logistics requirements..."
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none resize-none"/>
              </div>
              <button onClick={handleSubmit}
                className="w-full py-3.5 bg-[#0B2E59] text-white rounded-xl font-bold hover:bg-[#1a4a8a] transition text-sm">
                Submit Corporate Enquiry
              </button>
              <p className="text-xs text-gray-400 text-center">We respond within 24 hours · No commitment required</p>
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
