import React from 'react';
import { useApp } from '../lib/store';

export default function CorporateBulkBookingPage() {
  const { setPage, setShowAuthModal, setAuthMode } = useApp();

  return (
    <div className="min-h-screen bg-white">

      
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-4 py-2 rounded-full mb-6">📦 Enterprise · Bulk Logistics</div>
          <h1 className="text-5xl font-extrabold mb-4 leading-tight">Bulk Booking Management</h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto mb-8">Manage thousands of deliveries across multiple locations from a single dashboard. Built for logistics managers and operations directors.</p>
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
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">Why Bulk Booking Management</h2>
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">Enterprise-grade logistics capabilities built for scale.</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">🗺️</div>
            <h3 className="font-bold text-gray-900 mb-2">Multi-Location Dispatch</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Book and manage deliveries across unlimited locations simultaneously from one control panel.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">⚡</div>
            <h3 className="font-bold text-gray-900 mb-2">Instant Fleet Allocation</h3>
            <p className="text-gray-500 text-sm leading-relaxed">AI-powered driver matching fills your orders in minutes, not hours.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">📊</div>
            <h3 className="font-bold text-gray-900 mb-2">Real-Time Visibility</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Live dashboards track every shipment, driver, and delivery status in real time.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">🔄</div>
            <h3 className="font-bold text-gray-900 mb-2">Batch Import</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Upload thousands of delivery orders via CSV, API, or direct ERP integration.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">💰</div>
            <h3 className="font-bold text-gray-900 mb-2">Volume Pricing</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Automated volume discounts applied instantly based on your monthly throughput.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">🛡️</div>
            <h3 className="font-bold text-gray-900 mb-2">Compliance Built In</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Every carrier is verified, insured, and compliant with Norwegian transport law.</p>
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
              <h3 className="font-bold text-gray-900 text-sm mb-1">Upload Orders</h3>
              <p className="text-gray-500 text-xs">Import delivery orders via CSV, API, or manual entry. Batch processing handles thousands at once.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">2</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Auto-Allocate</h3>
              <p className="text-gray-500 text-xs">Our system matches orders to available verified drivers by proximity, capacity, and scheduling.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">3</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Monitor Live</h3>
              <p className="text-gray-500 text-xs">Track all deliveries on a live map with real-time status updates and exception alerts.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">4</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Auto-Invoice</h3>
              <p className="text-gray-500 text-xs">Monthly consolidated invoices generated automatically with full delivery audit trail.</p>
            </div>
          </div>
        </div>
      </section>

      {/* USE CASES */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-3">Industries & Use Cases</h2>
        <p className="text-gray-500 mb-8">Trusted by operations teams across Norway.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Furniture retail chains</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">E-commerce fulfilment</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Construction material supply</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Hospitality procurement</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Healthcare equipment delivery</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Distribution networks</span>
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
