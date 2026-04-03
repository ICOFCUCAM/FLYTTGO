import React from 'react';
import { useApp, Page } from '../lib/store';

export default function Footer() {
  const { setPage } = useApp();
  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-8">
          {/* Brand col */}
          <div className="col-span-2 md:col-span-1 lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
              </div>
              <span className="text-xl font-bold text-white">Flytt<span className="text-emerald-400">Go</span></span>
            </div>
            <p className="text-sm text-gray-400 mb-4 max-w-xs">Norway's #1 moving platform. Smart moving and transport services connecting you with verified drivers.</p>
            <div className="flex gap-3">
              {[
                'M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z',
                'M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z',
                'M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z',
              ].map((d, i) => (
                <a key={i} href="#" className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center hover:bg-emerald-600 transition">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} /></svg>
                </a>
              ))}
            </div>
          </div>

          {/* Services */}
          <div>
            <h4 className="text-white font-semibold mb-4">Services</h4>
            <ul className="space-y-2 text-sm">
              {['Moving Services','Furniture Transport','Office Relocation','Student Moving','Same-Day Delivery'].map(s => (
                <li key={s}><button onClick={() => setPage('services')} className="hover:text-emerald-400 transition">{s}</button></li>
              ))}
            </ul>
          </div>

          {/* Cities */}
          <div>
            <h4 className="text-white font-semibold mb-4">Cities</h4>
            <ul className="space-y-2 text-sm">
              {['Oslo','Bergen','Trondheim','Stavanger','Drammen','Fredrikstad'].map(c => (
                <li key={c}><button onClick={() => setPage('home')} className="hover:text-emerald-400 transition">Flyttehjelp {c}</button></li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-white font-semibold mb-4">Company</h4>
            <ul className="space-y-2 text-sm">
              {([
                { label: 'About FlyttGo',   page: 'home' },
                { label: 'For Drivers',     page: 'subscriptions' },
                { label: 'Van Size Guide',  page: 'van-guide' },
                { label: 'Moving Checklist',page: 'checklist' },
                { label: 'Terms',           page: 'terms' },
                { label: 'Privacy Policy',  page: 'privacy' },
              ] as {label:string; page:Page}[]).map(item => (
                <li key={item.label}><button onClick={() => setPage(item.page)} className="hover:text-emerald-400 transition">{item.label}</button></li>
              ))}
            </ul>
          </div>

          {/* Corporate — NEW column */}
          <div>
            <h4 className="text-white font-semibold mb-4">Corporate</h4>
            <ul className="space-y-2 text-sm">
              {([
                { label: 'Corporate Dashboard', page: 'corporate-dashboard' },
                { label: 'Bulk Booking',         page: 'bulk-booking' },
                { label: 'Recurring Deliveries', page: 'recurring-deliveries' },
                { label: 'Invoice & Billing',    page: 'invoice-billing' },
                { label: 'API Access',           page: 'corporate-api-access' },
              ] as {label:string; page:Page}[]).map(item => (
                <li key={item.label}><button onClick={() => setPage(item.page)} className="hover:text-emerald-400 transition">{item.label}</button></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-500">&copy; 2026 FlyttGo. All rights reserved.</p>
          <div className="flex gap-6 text-sm text-gray-500">
            <button onClick={() => setPage('privacy')} className="hover:text-gray-300">Privacy Policy</button>
            <button onClick={() => setPage('terms')} className="hover:text-gray-300">Terms of Service</button>
            <button onClick={() => setPage('terms')} className="hover:text-gray-300">Cookie Policy</button>
          </div>
        </div>
      </div>

      {/* WhatsApp */}
      <a href="https://wa.me/447432112438" target="_blank" rel="noopener noreferrer"
        className="fixed bottom-6 right-6 w-14 h-14 bg-green-500 rounded-full flex items-center justify-center shadow-lg hover:bg-green-600 transition z-50 group">
        <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
        <span className="absolute -top-10 right-0 bg-gray-900 text-white text-xs px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition whitespace-nowrap">Chat with us</span>
      </a>
    </footer>
  );
}
