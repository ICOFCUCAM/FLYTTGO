import React from 'react';
import { useApp } from '../lib/store';

const SERVICES = [
  {
    icon: '🛋️', title: 'Furniture Moving', slug: 'furniture',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b1b470fdd1af7483a60acc_1773254286622_a82a1d1b.jpg',
    tagline: 'Your furniture, handled with care',
    desc: 'Professional furniture movers across Norway. We disassemble, wrap, transport, and reassemble your furniture — from single items to full home contents.',
    features: ['Disassembly & reassembly', 'Protective wrapping', 'Multi-floor buildings', 'Same-day availability'],
    price: 'From 850 NOK/hr', time: '2–6 hours typical',
    color: 'emerald',
  },
  {
    icon: '🏠', title: 'House Moving', slug: 'house',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b1b470fdd1af7483a60acc_1773254153053_d6599513.jpg',
    tagline: 'Full home relocations, stress-free',
    desc: 'Complete house and apartment moving service. Our verified drivers handle everything from packing assistance to final placement in your new home.',
    features: ['Full inventory management', 'Long-distance moves', 'Storage options', 'Insurance covered'],
    price: 'From 1,150 NOK/hr', time: 'Half-day to 2 days',
    color: 'blue',
  },
  {
    icon: '🔌', title: 'Appliance Delivery', slug: 'appliance',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766826645_9815a390.jpg',
    tagline: 'Heavy appliances delivered safely',
    desc: 'White-glove delivery for washing machines, fridges, dishwashers, and large electronics. Includes installation positioning and packaging removal.',
    features: ['Stair carry included', 'Packaging removal', 'Installation positioning', 'Same-day slots'],
    price: 'From 650 NOK', time: '1–2 hours',
    color: 'purple',
  },
  {
    icon: '📦', title: 'Cargo Transport', slug: 'cargo',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b1b470fdd1af7483a60acc_1773254050705_a292f56d.jpg',
    tagline: 'Reliable cargo, any size',
    desc: 'Commercial and personal cargo transport across Norway. From small parcels to full van loads — tracked, insured, on time.',
    features: ['Real-time GPS tracking', 'Commercial freight', 'Pallet capable', 'Proof of delivery'],
    price: 'From 750 NOK/hr', time: 'Flexible scheduling',
    color: 'orange',
  },
  {
    icon: '🏪', title: 'Store Delivery', slug: 'store',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b1b470fdd1af7483a60acc_1773254193383_798495ed.jpg',
    tagline: 'Retail to door, last-mile sorted',
    desc: 'Last-mile delivery for furniture stores, IKEA runs, and online retailers. We collect from any store and deliver to your address.',
    features: ['Store collection', 'IKEA compatible', 'Assembly on request', 'Flexible time slots'],
    price: 'From 550 NOK', time: '2–4 hours',
    color: 'teal',
  },
  {
    icon: '🏢', title: 'Business Logistics', slug: 'business',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b4405628b40c8fdc7aad59_1773420953628_819790d3.png',
    tagline: 'Office moves & B2B freight',
    desc: 'Corporate office relocation, regular B2B freight runs, and warehouse-to-customer delivery. Dedicated account managers for business clients.',
    features: ['Dedicated account manager', 'Recurring bookings', 'Invoicing available', 'Priority dispatch'],
    price: 'Custom pricing', time: 'SLA-backed delivery',
    color: 'slate',
  },
];

const colorMap: Record<string, { bg: string; badge: string; btn: string; icon: string }> = {
  emerald: { bg: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-700', btn: 'bg-emerald-600 hover:bg-emerald-700', icon: 'text-emerald-600' },
  blue:    { bg: 'bg-blue-50',    badge: 'bg-blue-100 text-blue-700',       btn: 'bg-blue-600 hover:bg-blue-700',       icon: 'text-blue-600' },
  purple:  { bg: 'bg-purple-50',  badge: 'bg-purple-100 text-purple-700',   btn: 'bg-purple-600 hover:bg-purple-700',   icon: 'text-purple-600' },
  orange:  { bg: 'bg-orange-50',  badge: 'bg-orange-100 text-orange-700',   btn: 'bg-orange-600 hover:bg-orange-700',   icon: 'text-orange-600' },
  teal:    { bg: 'bg-teal-50',    badge: 'bg-teal-100 text-teal-700',       btn: 'bg-teal-600 hover:bg-teal-700',       icon: 'text-teal-600' },
  slate:   { bg: 'bg-slate-50',   badge: 'bg-slate-100 text-slate-700',     btn: 'bg-slate-700 hover:bg-slate-800',     icon: 'text-slate-700' },
};

export default function ServicesPage() {
  const { setPage } = useApp();

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-4 py-2 rounded-full mb-6">
            🚐 Norway&apos;s #1 Moving Marketplace · 25,000+ Jobs Completed
          </div>
          <h1 className="text-5xl font-extrabold mb-4 leading-tight">
            Every Moving Service<br/><span className="text-[#F2B705]">Across Norway</span>
          </h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto mb-8">
            Book verified, insured transport providers for any move. Transparent pricing, real-time tracking, and secure escrow payment.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mb-8">
            {['✅ Verified companies only', '🔒 Escrow payment', '📍 GPS tracking', '⭐ 4.8/5 rating'].map(b => (
              <span key={b} className="bg-white/10 text-white/80 text-sm px-4 py-2 rounded-full">{b}</span>
            ))}
          </div>
          <button onClick={() => setPage('booking')}
            className="px-10 py-4 bg-[#F2B705] text-[#0B2E59] rounded-xl font-bold text-lg hover:bg-[#F2B705]/90 transition shadow-lg">
            Get Instant Prices →
          </button>
        </div>
      </section>

      {/* SERVICES GRID */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">Our Services</h2>
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">All services delivered by registered Norwegian companies with mandatory goods-in-transit insurance.</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {SERVICES.map(svc => {
            const c = colorMap[svc.color];
            return (
              <div key={svc.slug} className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-xl transition group flex flex-col">
                <div className="relative h-48 overflow-hidden">
                  <img src={svc.image} alt={svc.title} width={600} height={384} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  <div className="absolute top-3 left-3 w-11 h-11 bg-white/95 backdrop-blur rounded-xl flex items-center justify-center shadow-md text-2xl">
                    {svc.icon}
                  </div>
                </div>
                <div className={`${c.bg} p-6 flex-1 flex flex-col`}>
                  <h3 className="text-xl font-bold text-gray-900 mb-1">{svc.title}</h3>
                  <p className={`text-xs font-semibold mb-3 ${c.icon}`}>{svc.tagline}</p>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">{svc.desc}</p>
                  <ul className="space-y-1.5 mb-5">
                    {svc.features.map(f => (
                      <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-xs ${c.btn.split(' ')[0]}`}>✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="font-bold text-gray-900 text-sm">{svc.price}</div>
                        <div className="text-xs text-gray-400">{svc.time}</div>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.badge}`}>Available now</span>
                    </div>
                    <button onClick={() => setPage('booking')}
                      className={`w-full py-2.5 ${c.btn} text-white rounded-xl text-sm font-semibold transition`}>
                      Book {svc.title} →
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-extrabold text-[#0B2E59] mb-10">How It Works</h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              { step: '1', title: 'Book Online', desc: 'Enter your addresses, choose a service, pick a time. Takes under 3 minutes.' },
              { step: '2', title: 'Get Matched', desc: 'A verified, insured driver near you accepts your job and confirms details.' },
              { step: '3', title: 'Move Safely', desc: 'Track in real time. Payment held in escrow — only released on delivery confirmation.' },
            ].map(item => (
              <div key={item.step} className="text-center">
                <div className="w-12 h-12 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">{item.step}</div>
                <h3 className="font-bold text-gray-900 mb-2">{item.title}</h3>
                <p className="text-gray-500 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-[#0B2E59] to-[#1a4a8a] py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">Ready to Move?</h2>
          <p className="text-white/70 mb-8">Book any service in under 3 minutes. Verified drivers, secure payment.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => setPage('booking')} className="px-10 py-4 bg-[#F2B705] text-[#0B2E59] rounded-xl font-bold text-base hover:bg-[#F2B705]/90 transition shadow-lg">Book Now — Instant Prices</button>
            <button onClick={() => setPage('van-guide')} className="px-10 py-4 bg-white/10 text-white rounded-xl font-semibold text-base hover:bg-white/20 transition">Which Van Do I Need?</button>
          </div>
        </div>
      </section>
    </div>
  );
}
