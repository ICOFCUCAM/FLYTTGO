import React from 'react';
import { useApp } from '../lib/store';
import { apiBaseUrl } from '../lib/apiKeys';
import { ROUTES, SCOPE_LABELS } from '../../supabase/functions/_shared/public-api';
/* The API's description (OpenAPI 3.1), the same file as docs/api/openapi.yaml. */
import openapiYaml from '../../docs/api/openapi.yaml?raw';

/* What each endpoint does, for the reference table (ROUTES is the router's own list). */
const ROUTE_SUMMARIES: Record<string, string> = {
  'me': 'Your key: company, scopes, limit',
  'quotes.create': 'Price a move (nothing is booked)',
  'bookings.list': 'Your company\'s moves, newest first',
  'bookings.create': 'Book a move on your company\'s invoice',
  'bookings.get': 'One move',
  'jobs.services': 'Your job services',
  'jobs.list': 'Your jobs',
  'jobs.create': 'Record a job for a customer',
  'jobs.get': 'One job',
  'appointments.services': 'Your services and who offers them',
  'appointments.slots': 'Free times on a day',
  'appointments.list': 'Your appointments',
  'appointments.create': 'Book a time for a customer',
  'appointments.get': 'One appointment',
};

function downloadSpec() {
  const url = URL.createObjectURL(new Blob([openapiYaml], { type: 'application/yaml' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'flyttgo-openapi.yaml';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CorporateApiAccessPage() {
  const { setPage, setShowAuthModal, setAuthMode } = useApp();
  const base = apiBaseUrl();
  const curl = `curl -X POST ${base}/quotes \\
  -H "Authorization: Bearer $FLYTTGO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"pickup":{"lat":59.9139,"lng":10.7522},"dropoff":{"lat":59.95,"lng":10.80},
       "van_type":"medium_van","helpers":1,"estimated_hours":3}'`;
  const booking = `curl -X POST ${base}/bookings \\
  -H "Authorization: Bearer $FLYTTGO_API_KEY" \\
  -H "Idempotency-Key: order-4711" \\
  -H "Content-Type: application/json" \\
  -d '{"pickup":{"address":"Storgata 1, 0155 Oslo","lat":59.9139,"lng":10.7522},
       "dropoff":{"address":"Bryggen 2, 5003 Bergen","lat":60.3913,"lng":5.3221},
       "van_type":"large_van","move_date":"2026-11-20","move_time":"09:00",
       "contact":{"name":"Ola Lager","phone":"+47 900 00 001","email":"lager@example.no"}}'`;

  return (
    <div className="min-h-screen bg-white">


      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-4 py-2 rounded-full mb-6">🔗 API · Developer Integration</div>
          <h1 className="text-5xl font-extrabold mb-4 leading-tight">Corporate API Access</h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto mb-8">Connect FlyttGo to your ERP, WMS, web shop or own systems: price moves, book them on your company's invoice and follow them, with a REST API and keys you control. Put your booking page on your own website with the booking widget.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => { setShowAuthModal(true); setAuthMode('signup'); }}
              className="px-10 py-4 bg-[#F2B705] text-[#0B2E59] rounded-xl font-bold text-base hover:bg-[#F2B705]/90 transition shadow-lg">
              Get Started →
            </button>
            <button onClick={() => setPage('corporate-dashboard')}
              className="px-10 py-4 bg-white/10 text-white rounded-xl font-semibold text-base hover:bg-white/20 transition">
              View Dashboard Demo
            </button>
          </div>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">Why Corporate API Access</h2>
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">What the API does today, and what it does not do yet.</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">⚡</div>
            <h3 className="font-bold text-gray-900 mb-2">REST API</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Versioned JSON REST (/v1): price quotes from FlyttGo's own pricing, moves booked on your company's invoice, and your company's moves. Jobs and appointments when your plan includes them.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">🔔</div>
            <h3 className="font-bold text-gray-900 mb-2">Webhooks</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Not available yet. Status changes are not pushed to you; read your moves with GET /v1/bookings to follow them. Webhooks are planned.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">📦</div>
            <h3 className="font-bold text-gray-900 mb-2">Bulk Operations</h3>
            <p className="text-gray-500 text-sm leading-relaxed">One booking per request, as many requests as your key's limit allows (60 a minute unless agreed). An Idempotency-Key makes a retry return the first answer, never a second booking.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">🔐</div>
            <h3 className="font-bold text-gray-900 mb-2">Enterprise Auth</h3>
            <p className="text-gray-500 text-sm leading-relaxed">API keys per company with scopes, an optional expiry, revocation at once, last use and a log. FlyttGo stores only a fingerprint of each key. A key acts as the owner or admin who made it, with their permissions.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">📚</div>
            <h3 className="font-bold text-gray-900 mb-2">Full Documentation</h3>
            <p className="text-gray-500 text-sm leading-relaxed">An OpenAPI 3.1 description to download and the reference below. No SDKs yet: any HTTP client works.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">🛠️</div>
            <h3 className="font-bold text-gray-900 mb-2">Sandbox Environment</h3>
            <p className="text-gray-500 text-sm leading-relaxed">No separate sandbox yet. Quotes and reads book nothing, so build against those first; a booking made through the API is a real move on your invoice.</p>
          </div>
        </div>
      </section>

      {/* WORKFLOW */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-12">How It Works</h2>
          <div className="grid sm:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">1</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Get API Credentials</h3>
              <p className="text-gray-500 text-xs">An owner or admin of your verified company creates a key in the Corporate dashboard → API and widget, and chooses its scopes. The key is shown once.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">2</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Try It Safely</h3>
              <p className="text-gray-500 text-xs">Ask for a quote and read your bookings: nothing is booked.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">3</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Build Integration</h3>
              <p className="text-gray-500 text-xs">Direct REST calls from your server. Keep the key in your secret store, never in a web page or app.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">4</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Go Live</h3>
              <p className="text-gray-500 text-xs">Booking through the API is paid on your company's invoice: FlyttGo switches invoice payment on for your company, with its credit limit.</p>
            </div>
          </div>
        </div>
      </section>

      {/* REFERENCE */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-1">API Reference</h2>
            <p className="text-gray-500 text-sm">Base URL <code className="font-mono text-xs bg-gray-100 rounded px-2 py-0.5 break-all">{base}</code></p>
          </div>
          <button onClick={downloadSpec} className="px-5 py-2.5 rounded-xl border-2 border-[#0B2E59] text-[#0B2E59] text-sm font-semibold hover:bg-[#0B2E59]/5">
            Download OpenAPI 3.1 description
          </button>
        </div>
        <div className="overflow-x-auto border border-gray-100 rounded-2xl">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>{['Endpoint', 'What it does', 'Scope'].map(h => <th key={h} className="text-left py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wide">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ROUTES.map(r => (
                <tr key={`${r.method} ${r.path}`}>
                  <td className="py-2.5 px-4 font-mono text-xs whitespace-nowrap"><span className={r.method === 'GET' ? 'text-emerald-700' : 'text-blue-700'}>{r.method}</span> {r.path}</td>
                  <td className="py-2.5 px-4 text-gray-600">{ROUTE_SUMMARIES[r.name]}</td>
                  <td className="py-2.5 px-4 text-xs text-gray-500">{r.scope ? <><code>{r.scope}</code><div className="text-gray-400">{SCOPE_LABELS[r.scope]}</div></> : 'any key'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid lg:grid-cols-2 gap-6 mt-8">
          <div>
            <h3 className="font-bold text-gray-900 mb-2 text-sm">A quote</h3>
            <pre className="bg-gray-900 text-gray-100 rounded-xl p-4 text-xs overflow-x-auto">{curl}</pre>
          </div>
          <div>
            <h3 className="font-bold text-gray-900 mb-2 text-sm">A move on your invoice</h3>
            <pre className="bg-gray-900 text-gray-100 rounded-xl p-4 text-xs overflow-x-auto">{booking}</pre>
          </div>
        </div>
        <ul className="mt-8 text-sm text-gray-600 space-y-2 list-disc ps-5">
          <li>Errors are JSON: <code className="text-xs">{'{"error": {"code": "scope_missing", "message": "…"}}'}</code>, with 401 for a missing, revoked or expired key, 403 when the key or its creator may not do it, 409 when your terms refuse it (for example the credit limit), 422 for an invalid request and 429 over the limit (with Retry-After).</li>
          <li>A key works only while your company is active, and stops when the owner or admin who created it leaves or loses that role.</li>
          <li>Moves are priced by FlyttGo's server with the formula of the booking page; the price in the answer is what your invoice shows.</li>
          <li>The API answers no browser requests (no CORS): call it from your server. For your website, use the booking widget.</li>
        </ul>
      </section>

      {/* WIDGET */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-5xl mx-auto px-4 grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-3">Booking widget for your website</h2>
            <p className="text-gray-600 text-sm leading-relaxed mb-3">Your FlyttGo booking page, in a frame on your own website: customers get a price and book as on your page. No API key is involved. It shows only on the websites you list, and needs an active booking page (Corporate dashboard → Plan and website).</p>
            <button onClick={() => setPage('corporate-dashboard')} className="text-sm underline text-[#0B2E59]">Set it up in the dashboard → API and widget</button>
          </div>
          <pre className="bg-gray-900 text-gray-100 rounded-xl p-4 text-xs overflow-x-auto whitespace-pre-wrap">{`<div id="flyttgo-booking"></div>
<script src="https://flyttgo.no/widget.js"
        data-company="your-company"
        data-target="#flyttgo-booking" async></script>`}</pre>
        </div>
      </section>

      {/* USE CASES */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-3">Industries & Use Cases</h2>
        <p className="text-gray-500 mb-8">What companies can connect it to.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">E-commerce checkout delivery</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">ERP system integration</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">WMS automation</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Custom logistics platforms</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Marketplace fulfilment</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">IoT and smart logistics</span>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-[#0B2E59] to-[#1a4a8a] py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">Ready to Scale Your Logistics?</h2>
          <p className="text-white/70 mb-8">Register your company, have it verified, and create your first key.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => { setShowAuthModal(true); setAuthMode('signup'); }}
              className="px-10 py-4 bg-[#F2B705] text-[#0B2E59] rounded-xl font-bold text-base hover:bg-[#F2B705]/90 transition shadow-lg">
              Create Corporate Account
            </button>
            <button onClick={() => setPage('corporate')}
              className="px-10 py-4 bg-white/10 text-white rounded-xl font-semibold text-base hover:bg-white/20 transition">
              View All Plans
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
