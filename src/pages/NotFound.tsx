import React from 'react';
import { useApp } from '../lib/store';
export default function NotFound() {
  const { setPage } = useApp();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-200 mb-4">404</h1>
        <p className="text-gray-600 mb-6">Page not found</p>
        <button onClick={() => setPage('home')} className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-semibold">Go Home</button>
      </div>
    </div>
  );
}
