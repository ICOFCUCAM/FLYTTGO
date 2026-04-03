import React, { useEffect } from 'react';
import { useApp } from '../lib/store';
import {
  SEO_CITIES,
  SEO_SERVICES,
  SeoCity,
  SeoService,
  generateFAQSchema,
  generateLocalBusinessSchema,
  getRelatedServiceLinks,
} from '../lib/seoData';
import formatNorwegianAddress from '../utils/formatNorwegianAddress';

/* ─────────────────────────────────────────────
   TYPES
───────────────────────────────────────────── */

interface SEOPageProps {
  serviceSlug: string;
  citySlug: string;
}

/* ─────────────────────────────────────────────
   INJECT SCHEMA INTO HEAD
───────────────────────────────────────────── */

function SchemaInjector({ schema }: { schema: object }) {
  useEffect(() => {
    const id = `schema-${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
    return () => {
      const el = document.getElementById(id);
      if (el) el.remove();
    };
  }, []);
  return null;
}

/* ─────────────────────────────────────────────
   SEO PAGE TEMPLATE
───────────────────────────────────────────── */

export default function SEOServiceCityPage({ serviceSlug, citySlug }: SEOPageProps) {
  const { setPage } = useApp();

  const city = SEO_CITIES.find(c => c.slug === citySlug);
  const service = SEO_SERVICES.find(s => s.slug === serviceSlug);

  /* 404 fallback */
  if (!city || !service) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Page not found</h1>
          <p className="text-gray-500 mb-6">This service/city combination doesn't exist yet.</p>
          <button onClick={() => setPage('home')} className="px-6 py-3 bg-[#0B2E59] text-white rounded-xl font-semibold">
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  const relatedLinks = getRelatedServiceLinks(service, city);
  const pageTitle = `${service.name} ${city.name} — From ${service.priceFrom} NOK/h`;
  const metaDescription = `Book ${service.name.toLowerCase()} in ${city.name} from ${service.priceFrom} NOK/hour. ${city.drivers} verified drivers. Instant booking, secure payment. ${city.bookings} completed jobs.`;

  /* Update document title */
  useEffect(() => {
    document.title = `${pageTitle} | FlyttGo`;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', metaDescription);
  }, [pageTitle, metaDescription]);

  return (
    <div className="min-h-screen bg-white">
      {/* Schema injection */}
      <SchemaInjector schema={generateFAQSchema(service, city)} />
      <SchemaInjector schema={generateLocalBusinessSchema(city)} />

      {/* ── HERO ── */}
      <section
        className="relative bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20"
        style={{
          backgroundImage: `linear-gradient(to bottom right, rgba(11,46,89,0.92), rgba(11,46,89,0.85)), url(${city.image})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-white/50 text-xs mb-8">
            <button onClick={() => setPage('home')} className="hover:text-white transition">FlyttGo</button>
            <span>/</span>
            <span>{city.name}</span>
            <span>/</span>
            <span className="text-white/80">{service.name}</span>
          </nav>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-3 py-1.5 rounded-full mb-4">
                {service.icon} {city.name} · {city.drivers} Verified Drivers
              </div>
              <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 leading-tight">
                {service.name}<br />
                <span className="text-[#F2B705]">{city.name}</span>
              </h1>
              <p className="text-white/75 text-lg mb-6 leading-relaxed max-w-xl">
                {service.longDescription} Available across {city.coverage.slice(0, 4).join(', ')} and more.
              </p>
              <div className="flex flex-wrap gap-3 mb-8">
                {[
                  `From ${service.priceFrom} NOK/hr`,
                  `${city.bookings} completed jobs`,
                  '25% VAT included',
                  'Secure escrow payment',
                ].map(badge => (
                  <span key={badge} className="bg-white/10 text-white/80 text-xs px-3 py-1.5 rounded-full">
                    ✓ {badge}
                  </span>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setPage('booking')}
                  className="px-8 py-4 bg-[#F2B705] text-[#0B2E59] rounded-xl font-bold text-base hover:bg-[#F2B705]/90 transition shadow-lg"
                >
                  Book {service.name} Now →
                </button>
                <a href={`tel:${city.phone}`}
                  className="px-8 py-4 bg-white/10 text-white rounded-xl font-semibold text-base hover:bg-white/20 transition text-center">
                  📞 {city.phone}
                </a>
              </div>
            </div>

            {/* Stats cards */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Drivers available', value: city.drivers.toString(), sub: `in ${city.name}` },
                { label: 'Jobs completed', value: city.bookings, sub: 'and counting' },
                { label: 'Starting from', value: `${service.priceFrom} NOK`, sub: 'per hour + VAT' },
                { label: 'Rating', value: '4.8 / 5', sub: 'verified reviews' },
              ].map(stat => (
                <div key={stat.label} className="bg-white/10 rounded-2xl p-5 backdrop-blur-sm">
                  <div className="text-2xl font-extrabold text-white mb-0.5">{stat.value}</div>
                  <div className="text-xs text-white/50 uppercase tracking-wide">{stat.label}</div>
                  <div className="text-xs text-white/30 mt-0.5">{stat.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST INDICATORS ── */}
      <section className="bg-gray-50 border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-gray-600">
            {[
              '✅ Verified Norwegian companies only',
              '🔒 Secure escrow payment',
              '🏛️ Kartverket GPS address verification',
              '📋 Marketplace only — ZERO FlyttGo liability',
              '⭐ 4.8/5 across 25,000+ bookings',
            ].map(item => (
              <span key={item} className="font-medium">{item}</span>
            ))}
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid lg:grid-cols-3 gap-12">
          {/* ── MAIN CONTENT ── */}
          <main className="lg:col-span-2 space-y-16">

            {/* City Introduction */}
            <section>
              <h2 className="text-2xl font-bold text-[#0B2E59] mb-4">
                {service.name} in {city.name} — Local Expert Service
              </h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                {city.description} FlyttGo connects you with {city.drivers} verified, insured transport providers operating in {city.name} and the surrounding {city.county} region.
              </p>
              <p className="text-gray-700 leading-relaxed">
                Every {service.name.toLowerCase()} booking in {city.name} includes real-time GPS tracking, secure escrow payment, and direct communication with your driver. {city.bookings} jobs have been completed through FlyttGo in {city.name}.
              </p>
            </section>

            {/* Pricing Section */}
            <section>
              <h2 className="text-2xl font-bold text-[#0B2E59] mb-6">
                {service.name} Prices in {city.name}
              </h2>
              <div className="grid sm:grid-cols-2 gap-4 mb-6">
                {[
                  { van: 'Small Van', price: '850–950', desc: '3–4 m³ · 1–2 rooms', icon: '🚐' },
                  { van: 'Medium Van', price: '1,150–1,300', desc: '6–9 m³ · 2–3 rooms', icon: '🚌', popular: true },
                  { van: 'Large Van', price: '1,500–1,900', desc: '11–15 m³ · 3–4 rooms', icon: '🚛' },
                  { van: 'Luton Van', price: '1,900+', desc: '18–20 m³ · Full house', icon: '🏭' },
                ].map(item => (
                  <div key={item.van} className={`border-2 rounded-xl p-5 relative ${item.popular ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200'}`}>
                    {item.popular && (
                      <span className="absolute -top-3 left-4 bg-emerald-500 text-white text-xs px-3 py-0.5 rounded-full font-semibold">Most Popular</span>
                    )}
                    <div className="text-2xl mb-2">{item.icon}</div>
                    <div className="font-bold text-gray-900 mb-1">{item.van}</div>
                    <div className="text-lg font-extrabold text-[#0B2E59]">{item.price} NOK/hr</div>
                    <div className="text-xs text-gray-500 mt-1">{item.desc}</div>
                    <div className="text-xs text-gray-400 mt-1">+ 25% MVA</div>
                  </div>
                ))}
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
                <strong>Note:</strong> Prices start from {service.priceFrom} NOK/hour. Final price includes distance charges after first 20 km. All prices include 25% Norwegian VAT (MVA). Helpers available from 350 NOK/hour.
              </div>
            </section>

            {/* Local Tips */}
            <section>
              <h2 className="text-2xl font-bold text-[#0B2E59] mb-4">
                Local Moving Tips for {city.name}
              </h2>
              <div className="space-y-3">
                {city.localTips.map((tip, i) => (
                  <div key={i} className="flex gap-3 bg-gray-50 rounded-xl p-4">
                    <div className="w-6 h-6 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                      {i + 1}
                    </div>
                    <p className="text-gray-700 text-sm leading-relaxed">{tip}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Coverage areas */}
            <section>
              <h2 className="text-2xl font-bold text-[#0B2E59] mb-4">
                Areas We Cover in {city.name}
              </h2>
              <div className="flex flex-wrap gap-2">
                {city.coverage.map(area => (
                  <span key={area} className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-full text-sm font-medium">
                    📍 {area}
                  </span>
                ))}
              </div>
            </section>

            {/* Testimonials */}
            <section>
              <h2 className="text-2xl font-bold text-[#0B2E59] mb-6">
                Customer Reviews — {service.name} {city.name}
              </h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {city.testimonials.map((review, i) => (
                  <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-1 mb-2">
                      {Array.from({ length: review.rating }).map((_, j) => (
                        <span key={j} className="text-yellow-400 text-sm">★</span>
                      ))}
                    </div>
                    <p className="text-gray-700 text-sm leading-relaxed mb-3">"{review.text}"</p>
                    <p className="text-gray-500 text-xs font-medium">— {review.name}, {city.name}</p>
                  </div>
                ))}
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-2xl font-extrabold text-[#0B2E59]">4.8/5</div>
                    <div className="text-xs text-gray-500 mt-1">Average rating in {city.name}</div>
                    <div className="text-xs text-gray-400">{city.bookings} completed jobs</div>
                  </div>
                </div>
              </div>
            </section>

            {/* FAQ with Schema */}
            <section>
              <h2 className="text-2xl font-bold text-[#0B2E59] mb-6">
                Frequently Asked Questions — {service.name} {city.name}
              </h2>
              <div className="space-y-4">
                {[
                  {
                    q: `How much does ${service.name} cost in ${city.name}?`,
                    a: `${service.name} in ${city.name} starts from ${service.priceFrom} NOK per hour (ex VAT). Prices depend on van size, distance, duration, and number of helpers. Use our instant calculator for an exact quote.`,
                  },
                  {
                    q: `How quickly can I book ${service.name.toLowerCase()} in ${city.name}?`,
                    a: `Booking takes under 3 minutes. Enter your ${city.name} pickup and delivery addresses using our official Kartverket address lookup, choose your van, and confirm. Available drivers in ${city.name} are notified immediately.`,
                  },
                  {
                    q: `Are drivers insured for ${service.name.toLowerCase()} in ${city.name}?`,
                    a: `All FlyttGo drivers in ${city.name} are required to operate under a registered Norwegian company with valid goods-in-transit insurance (min. 500,000 NOK) and public liability insurance (min. 5,000,000 NOK). FlyttGo is a marketplace — transport liability rests with the driver's company.`,
                  },
                  {
                    q: `What van size do I need for my ${city.name} move?`,
                    a: `For a studio or 1-bedroom apartment, a small or medium van (3–9 m³) is usually sufficient. For a 2–3 bedroom home, a large van or Luton van (11–20 m³) is recommended. Use our Van Size Calculator for a precise recommendation.`,
                  },
                  {
                    q: `Can I cancel my ${city.name} ${service.name.toLowerCase()} booking?`,
                    a: `Yes. Free cancellation up to 24 hours before your scheduled time. Cancellations within 24 hours incur a 50% charge. Payment is held in secure escrow and released only after confirmed delivery.`,
                  },
                ].map((faq, i) => (
                  <details key={i} className="border border-gray-200 rounded-xl group">
                    <summary className="flex items-center justify-between px-5 py-4 cursor-pointer font-medium text-gray-800 hover:bg-gray-50 rounded-xl">
                      {faq.q}
                      <svg className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </summary>
                    <div className="px-5 pb-4 text-gray-600 text-sm leading-relaxed">{faq.a}</div>
                  </details>
                ))}
              </div>
            </section>

          </main>

          {/* ── SIDEBAR ── */}
          <aside className="space-y-6">
            {/* Book CTA sticky */}
            <div className="bg-[#0B2E59] text-white rounded-2xl p-6 sticky top-24">
              <h3 className="font-bold text-lg mb-2">Book {service.name} in {city.name}</h3>
              <p className="text-white/70 text-sm mb-4">Instant prices · Verified drivers · Secure payment</p>
              <div className="text-3xl font-extrabold text-[#F2B705] mb-1">
                From {service.priceFrom} NOK/hr
              </div>
              <p className="text-white/50 text-xs mb-5">+ 25% MVA · Min 2 hours</p>
              <button
                onClick={() => setPage('booking')}
                className="w-full py-3.5 bg-[#F2B705] text-[#0B2E59] rounded-xl font-bold hover:bg-[#F2B705]/90 transition"
              >
                Get Instant Price →
              </button>
              <div className="mt-3 space-y-1 text-xs text-white/50">
                <p>✓ Free cancellation 24h before</p>
                <p>✓ Real-time driver tracking</p>
                <p>✓ Escrow payment protection</p>
              </div>
            </div>

            {/* Related services in same city */}
            <div className="border border-gray-200 rounded-2xl p-5">
              <h3 className="font-bold text-gray-800 mb-3 text-sm">More Services in {city.name}</h3>
              <div className="space-y-2">
                {relatedLinks.sameCity.map(link => (
                  <button key={link.path} className="block w-full text-left text-xs text-gray-600 hover:text-[#0B2E59] py-1.5 border-b border-gray-100 last:border-0">
                    → {link.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Same service, other cities */}
            <div className="border border-gray-200 rounded-2xl p-5">
              <h3 className="font-bold text-gray-800 mb-3 text-sm">{service.name} in Other Cities</h3>
              <div className="space-y-2">
                {relatedLinks.sameService.map(link => (
                  <button key={link.path} className="block w-full text-left text-xs text-gray-600 hover:text-[#0B2E59] py-1.5 border-b border-gray-100 last:border-0">
                    → {link.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Platform tools */}
            <div className="bg-gray-50 rounded-2xl p-5">
              <h3 className="font-bold text-gray-800 mb-3 text-sm">Helpful Tools</h3>
              <div className="space-y-2">
                {relatedLinks.core.map(link => (
                  <button key={link.path} onClick={() => setPage(link.path.replace('/', '') as any)}
                    className="block w-full text-left text-xs text-[#0B2E59] hover:underline py-1">
                    → {link.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Local phone */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center">
              <p className="text-emerald-800 text-xs font-semibold mb-1">Local {city.name} Support</p>
              <a href={`tel:${city.phone}`} className="text-lg font-bold text-emerald-700 hover:underline">
                {city.phone}
              </a>
              <p className="text-emerald-600 text-xs mt-1">Mon–Fri 08:00–20:00</p>
            </div>
          </aside>
        </div>
      </div>

      {/* ── CTA FOOTER BAND ── */}
      <section className="bg-gradient-to-r from-[#0B2E59] to-[#1a4a8a] py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">
            Ready to Book {service.name} in {city.name}?
          </h2>
          <p className="text-white/70 mb-8 text-lg">
            Join {city.bookings} customers who have already moved with FlyttGo in {city.name}.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => setPage('booking')}
              className="px-10 py-4 bg-[#F2B705] text-[#0B2E59] rounded-xl font-bold text-base hover:bg-[#F2B705]/90 transition shadow-lg"
            >
              Book Now — Instant Prices
            </button>
            <button
              onClick={() => setPage('van-guide')}
              className="px-10 py-4 bg-white/10 text-white rounded-xl font-semibold text-base hover:bg-white/20 transition"
            >
              Which Van Do I Need?
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
