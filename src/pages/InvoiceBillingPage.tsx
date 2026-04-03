import React from 'react';
import { useApp } from '../lib/store';

export default function InvoiceBillingPage() {
  const { setPage, setShowAuthModal, setAuthMode } = useApp();

  return (
    <div className="min-h-screen bg-white">

      
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-4 py-2 rounded-full mb-6">💳 Finance · Consolidated Billing</div>
          <h1 className="text-5xl font-extrabold mb-4 leading-tight">Invoice & Billing Centre</h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto mb-8">Eliminate invoice chaos. All your FlyttGo deliveries consolidated into one clean monthly invoice — compatible with Norwegian accounting systems.</p>
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
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">Why Invoice & Billing Centre</h2>
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">Enterprise-grade logistics capabilities built for scale.</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">📄</div>
            <h3 className="font-bold text-gray-900 mb-2">Single Monthly Invoice</h3>
            <p className="text-gray-500 text-sm leading-relaxed">All deliveries, all locations, one invoice. Simplify your accounts payable process.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">🇳🇴</div>
            <h3 className="font-bold text-gray-900 mb-2">Norwegian VAT Compliant</h3>
            <p className="text-gray-500 text-sm leading-relaxed">All invoices include correct MVA calculations and organisation number references.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">🔗</div>
            <h3 className="font-bold text-gray-900 mb-2">Accounting Integration</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Direct integration with Tripletex, PowerOffice, Xledger, and other Norwegian systems.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">📊</div>
            <h3 className="font-bold text-gray-900 mb-2">Cost Allocation</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Allocate delivery costs to departments, projects, or cost centres automatically.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">🗂️</div>
            <h3 className="font-bold text-gray-900 mb-2">Invoice Archive</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Unlimited invoice history with searchable, downloadable PDF copies.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">💬</div>
            <h3 className="font-bold text-gray-900 mb-2">Dispute Management</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Raise and resolve invoice disputes directly in the platform — no email chains.</p>
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
              <h3 className="font-bold text-gray-900 text-sm mb-1">Deliveries Complete</h3>
              <p className="text-gray-500 text-xs">All completed deliveries are automatically logged against your account.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">2</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Month End</h3>
              <p className="text-gray-500 text-xs">Consolidated invoice generated on the 1st of each month covering all activity.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">3</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Review & Approve</h3>
              <p className="text-gray-500 text-xs">Finance team reviews line-item detail and approves with one click.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">4</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Export</h3>
              <p className="text-gray-500 text-xs">Push to your accounting system or download as PDF/CSV for manual entry.</p>
            </div>
          </div>
        </div>
      </section>

      {/* USE CASES */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-3">Industries & Use Cases</h2>
        <p className="text-gray-500 mb-8">Trusted by operations teams across Norway.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Corporate procurement</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Multi-branch retailers</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Construction companies</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Property managers</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Franchise operations</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Public sector organisations</span>
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
