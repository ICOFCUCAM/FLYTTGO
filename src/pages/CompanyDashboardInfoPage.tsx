import React from 'react';
import { useApp } from '../lib/store';

export default function CompanyDashboardInfoPage() {
  const { setPage, setShowAuthModal, setAuthMode } = useApp();

  return (
    <div className="min-h-screen bg-white">

      
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-4 py-2 rounded-full mb-6">📊 Analytics · Control Center</div>
          <h1 className="text-5xl font-extrabold mb-4 leading-tight">Company Logistics Dashboard</h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto mb-8">A single command center for your entire logistics operation. Track spend, performance, and fleet utilization with enterprise-grade analytics.</p>
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
        <h2 className="text-3xl font-extrabold text-[#0B2E59] text-center mb-3">Why Company Logistics Dashboard</h2>
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">Enterprise-grade logistics capabilities built for scale.</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">📊</div>
            <h3 className="font-bold text-gray-900 mb-2">Unified Analytics</h3>
            <p className="text-gray-500 text-sm leading-relaxed">All delivery data, costs, and performance metrics in one real-time dashboard.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">👥</div>
            <h3 className="font-bold text-gray-900 mb-2">Team Management</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Add team members, assign roles, and control access permissions by department.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">💳</div>
            <h3 className="font-bold text-gray-900 mb-2">Spend Control</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Set budget limits, approve spend, and track logistics costs by department or project.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">📍</div>
            <h3 className="font-bold text-gray-900 mb-2">Live Tracking</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Monitor every active delivery on a live map with ETA updates and driver locations.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">📄</div>
            <h3 className="font-bold text-gray-900 mb-2">Automated Reports</h3>
            <p className="text-gray-500 text-sm leading-relaxed">Scheduled weekly and monthly reports delivered to your inbox automatically.</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md transition">
            <div className="text-3xl mb-3">🔒</div>
            <h3 className="font-bold text-gray-900 mb-2">Enterprise Security</h3>
            <p className="text-gray-500 text-sm leading-relaxed">SOC 2 compatible data handling with role-based access control and audit logs.</p>
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
              <h3 className="font-bold text-gray-900 text-sm mb-1">Onboard Team</h3>
              <p className="text-gray-500 text-xs">Add users, set roles, and configure department-level access in minutes.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">2</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Set Budgets</h3>
              <p className="text-gray-500 text-xs">Define monthly spend limits per department. Approvals triggered automatically.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">3</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Monitor</h3>
              <p className="text-gray-500 text-xs">Live dashboard shows all active deliveries, spend, and performance in real time.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-3">4</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">Report</h3>
              <p className="text-gray-500 text-xs">Export data to your BI tools or receive automated reports on your schedule.</p>
            </div>
          </div>
        </div>
      </section>

      {/* USE CASES */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-3">Industries & Use Cases</h2>
        <p className="text-gray-500 mb-8">Trusted by operations teams across Norway.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Multi-site retail operations</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Enterprise procurement teams</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Property management companies</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Construction project management</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Healthcare networks</span>
          <span className="px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">Government logistics departments</span>
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
