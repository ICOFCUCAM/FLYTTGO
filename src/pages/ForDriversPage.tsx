import React from 'react';
import { useApp } from '../lib/store';

export default function ForDriversPage() {
  const { setPage } = useApp();
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-[#1A365D] to-[#2D4A7A] text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl font-bold mb-4">Drive With FlyttGo</h1>
          <p className="text-white/70 max-w-xl mx-auto">Book your professional moving service across Norway with verified drivers and transparent pricing.</p>
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <div className="text-6xl mb-5">🚐</div>
          <h2 className="text-xl font-bold text-gray-900 mb-3">Full content coming soon</h2>
          <p className="text-gray-500 mb-8 max-w-md mx-auto">We're working on this page. Book your move or explore our services in the meantime.</p>
          <div className="flex flex-wrap justify-center gap-4">
            <button onClick={() => setPage('booking')} className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition">Book a Move</button>
            <button onClick={() => setPage('home')} className="px-6 py-3 border-2 border-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition">Back to Home</button>
          </div>
        </div>
      </div>
    </div>
  );
}
