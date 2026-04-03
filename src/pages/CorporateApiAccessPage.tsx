import React from 'react';
import { useApp } from '../lib/store';

export default function CorporateApiAccessPage() {
  const { setPage, setShowAuthModal, setAuthMode } = useApp();

  return (
    <div className="min-h-screen bg-white">

      
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-4 py-2 rounded-full mb-6">🔗 API · Developer Integration</div>
          <h1 className="text-5xl font-extrabold mb-4 leading-tight">Corporate API Access</h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto mb-8">Connect FlyttGo directly to your ERP, WMS, e-commerce platform, or custom systems via our enterprise REST API.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => { setShowAuthModal(true); setAuthMode('signup'); }}
              className="px-10 py-4 bg-[#F2B705] text-[#0B2E59] rounded-xl font-bold text-base hover:bg-[#F2B705]/90 transition shadow-lg">
              Get Started Free →
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
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">Enterprise-grade logistics capabilities built for scale.</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">⚡</div>
            <h3 className="font-bold text-gray-900 mb-2">REST API</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Industry-standard JSON REST API with full CRUD operations on bookings, drivers, and tracking.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">🔔</div>
            <h3 className="font-bold text-gray-900 mb-2">Webhooks</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Real-time event webhooks for booking status changes, delivery confirmations, and exceptions.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">📦</div>
            <h3 className="font-bold text-gray-900 mb-2">Bulk Operations</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Create, update, and query thousands of bookings in single API calls.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">🔐</div>
            <h3 className="font-bold text-gray-900 mb-2">Enterprise Auth</h3>
            <p className="text-gray-500 text-sm leading-relaxed">OAuth 2.0, API key rotation, IP whitelisting, and rate limit management.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">📚</div>
            <h3 className="font-bold text-gray-900 mb-2">Full Documentation</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Interactive API docs, SDKs for Node.js and Python, and integration guides.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">🛠️</div>
            <h3 className="font-bold text-gray-900 mb-2">Sandbox Environment</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Full-featured sandbox for development and testing without live operations.</p>
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
              <p className="text-gray-500 text-xs">Request enterprise API access from your account manager. Credentials issued within 24 hours.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">2</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Explore Sandbox</h3>
              <p className="text-gray-500 text-xs">Test your integration in our sandbox environment without affecting live operations.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">3</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Build Integration</h3>
              <p className="text-gray-500 text-xs">Use our SDK or direct REST calls. Webhook endpoints receive real-time events.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">4</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Go Live</h3>
              <p className="text-gray-500 text-xs">Switch to production credentials. Our team monitors your integration for the first 30 days.</p>
            </div>
          </div>
        </div>
      </section>

      {/* USE CASES */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-3">Industries & Use Cases</h2>
        <p className="text-gray-500 mb-8">Trusted by operations teams across Norway.</p>
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
          <p className="text-white/70 mb-8">Join 500+ companies using FlyttGo Corporate across Norway.</p>
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
