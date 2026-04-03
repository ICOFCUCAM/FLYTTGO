import React, { useState } from 'react';
import { useApp } from '../lib/store';

type DashTab = 'overview' | 'shipments' | 'recurring' | 'invoices' | 'drivers' | 'analytics' | 'api' | 'team' | 'documents' | 'support';

function StatCard({ icon, label, value, sub, color = 'emerald' }: { icon: string; label: string; value: string; sub?: string; color?: string }) {
  const colors: Record<string, string> = { emerald: 'bg-emerald-50 text-emerald-600', blue: 'bg-blue-50 text-blue-600', purple: 'bg-purple-50 text-purple-600', orange: 'bg-orange-50 text-orange-600' };
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
      <div className={`w-10 h-10 ${colors[color] || colors.emerald} rounded-xl flex items-center justify-center text-lg mb-3`}>{icon}</div>
      <div className="text-2xl font-extrabold text-gray-900">{value}</div>
      <div className="text-sm text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

const SHIPMENTS = [
  { id: 'SHP-10482', from: 'Oslo Warehouse', to: 'Bergen Distribution', status: 'In Transit', driver: 'Erik Andersen', eta: '14:30', value: '3,420 NOK' },
  { id: 'SHP-10481', from: 'Trondheim Store', to: 'Ålesund Office', status: 'Delivered', driver: 'Maja Larsen', eta: 'Completed', value: '1,850 NOK' },
  { id: 'SHP-10480', from: 'Bergen Hub', to: 'Stavanger Client', status: 'Scheduled', driver: 'Unassigned', eta: '09:00 Tomorrow', value: '2,100 NOK' },
  { id: 'SHP-10479', from: 'Oslo Central', to: 'Drammen Depot', status: 'In Transit', driver: 'Lars Nilsen', eta: '16:45', value: '980 NOK' },
  { id: 'SHP-10478', from: 'Fredrikstad Port', to: 'Oslo Logistics Hub', status: 'Exception', driver: 'Ingrid Berg', eta: 'Delayed', value: '5,200 NOK' },
];

const STATUS_COLORS: Record<string, string> = {
  'In Transit': 'bg-blue-100 text-blue-700',
  'Delivered':  'bg-emerald-100 text-emerald-700',
  'Scheduled':  'bg-gray-100 text-gray-600',
  'Exception':  'bg-red-100 text-red-700',
};

const NAV_ITEMS: { id: DashTab; icon: string; label: string }[] = [
  { id: 'overview',   icon: '📊', label: 'Overview' },
  { id: 'shipments',  icon: '🚚', label: 'Shipments' },
  { id: 'recurring',  icon: '🔁', label: 'Recurring' },
  { id: 'invoices',   icon: '💳', label: 'Invoices' },
  { id: 'drivers',    icon: '👤', label: 'Drivers' },
  { id: 'analytics',  icon: '📈', label: 'Analytics' },
  { id: 'api',        icon: '🔗', label: 'API & Webhooks' },
  { id: 'team',       icon: '👥', label: 'Team' },
  { id: 'documents',  icon: '📄', label: 'Documents' },
  { id: 'support',    icon: '🎧', label: 'Support' },
];

export default function CorporateDashboard() {
  const { setPage, setShowAuthModal, setAuthMode } = useApp();
  const [tab, setTab] = useState<DashTab>('overview');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const filteredShipments = SHIPMENTS.filter(s => {
    const matchSearch = s.id.toLowerCase().includes(search.toLowerCase()) || s.from.toLowerCase().includes(search.toLowerCase()) || s.to.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || s.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div className="min-h-screen bg-gray-50 flex">

      {/* SIDEBAR */}
      <aside className="w-64 bg-[#0B2E59] text-white flex-shrink-0 flex flex-col hidden lg:flex">
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-sm font-bold">F</div>
            <span className="font-bold text-lg">FlyttGo</span>
          </div>
          <div className="text-xs text-white/50">Corporate Dashboard</div>
        </div>

        <nav className="flex-1 py-4">
          {NAV_ITEMS.map(item => (
            <button key={item.id} onClick={() => setTab(item.id)}
              className={`w-full flex items-center gap-3 px-5 py-3 text-sm transition ${tab === item.id ? 'bg-white/10 text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>

        <div className="p-5 border-t border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-xs font-bold">AB</div>
            <div>
              <div className="text-xs font-medium">Acme Logistics AS</div>
              <div className="text-xs text-white/50">Enterprise Plan</div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* TOP BAR */}
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold text-gray-900 capitalize">{NAV_ITEMS.find(n => n.id === tab)?.label || 'Overview'}</h1>
            <p className="text-xs text-gray-400">FlyttGo Corporate · Enterprise Dashboard Preview</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-xs bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full font-medium">⚡ Live Mode</span>
            <button onClick={() => { setShowAuthModal(true); setAuthMode('signup'); }}
              className="px-4 py-2 bg-[#0B2E59] text-white rounded-xl text-sm font-semibold hover:bg-[#1a4a8a] transition">
              Activate Account
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">

          {/* ── OVERVIEW ── */}
          {tab === 'overview' && (
            <div className="space-y-6">
              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard icon="🚚" label="Active Shipments" value="24" sub="↑ 3 from yesterday" color="blue"/>
                <StatCard icon="📅" label="Scheduled Today" value="47" sub="Next: 09:30 Oslo Hub" color="emerald"/>
                <StatCard icon="🏎️" label="Fleet Utilization" value="78%" sub="19 of 24 drivers active" color="purple"/>
                <StatCard icon="💰" label="Monthly Spend" value="142,400 NOK" sub="↓ 8% vs last month" color="orange"/>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <StatCard icon="🌱" label="Carbon Footprint" value="2.4 tCO₂" sub="This month · -12% YoY" color="emerald"/>
                <StatCard icon="⭐" label="Avg Driver Rating" value="4.8 / 5" sub="Based on 312 deliveries" color="blue"/>
                <StatCard icon="✅" label="On-Time Delivery" value="96.2%" sub="Target: 95%" color="purple"/>
              </div>

              {/* Activity timeline */}
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <h3 className="font-bold text-gray-900 mb-4">Live Activity Feed</h3>
                <div className="space-y-3">
                  {[
                    { time: '13:42', msg: '🚚 SHP-10482 departed Oslo Warehouse — ETA Bergen 14:30', color: 'text-blue-600' },
                    { time: '13:15', msg: '✅ SHP-10481 delivered to Ålesund Office · Confirmed by Erik A.', color: 'text-emerald-600' },
                    { time: '12:58', msg: '⚠️ SHP-10478 delayed — traffic incident on E6 · Driver notified', color: 'text-red-600' },
                    { time: '12:30', msg: '📋 Recurring schedule "Bergen Weekly" executed — 3 orders created', color: 'text-gray-600' },
                    { time: '11:45', msg: '💳 Invoice INV-2026-04 generated · 47 deliveries · 89,200 NOK', color: 'text-gray-600' },
                  ].map((item, i) => (
                    <div key={i} className="flex gap-3 items-start text-sm border-b border-gray-50 pb-3 last:border-0">
                      <span className="text-xs text-gray-400 font-mono w-12 flex-shrink-0 pt-0.5">{item.time}</span>
                      <span className={item.color}>{item.msg}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* City performance */}
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <h3 className="font-bold text-gray-900 mb-4">City Performance</h3>
                <div className="space-y-3">
                  {[
                    { city: 'Oslo', jobs: 156, util: 82, spend: '64,200' },
                    { city: 'Bergen', jobs: 89, util: 71, spend: '38,100' },
                    { city: 'Trondheim', jobs: 54, util: 68, spend: '22,800' },
                    { city: 'Stavanger', jobs: 43, util: 75, spend: '17,300' },
                  ].map(r => (
                    <div key={r.city} className="flex items-center gap-4 text-sm">
                      <span className="w-24 font-medium text-gray-700">{r.city}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${r.util}%` }}/>
                      </div>
                      <span className="text-gray-500 w-8">{r.util}%</span>
                      <span className="text-gray-700 font-medium w-28 text-right">{r.spend} NOK</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── SHIPMENTS ── */}
          {tab === 'shipments' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search shipment ID, origin, or destination..."
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"/>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white">
                  <option value="all">All Status</option>
                  <option>In Transit</option>
                  <option>Delivered</option>
                  <option>Scheduled</option>
                  <option>Exception</option>
                </select>
                <button className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition">+ New Shipment</button>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {['Shipment ID','From','To','Status','Driver','ETA','Value',''].map(h => (
                        <th key={h} className="text-left py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredShipments.map(s => (
                      <tr key={s.id} className="hover:bg-gray-50 transition">
                        <td className="py-3.5 px-4 font-mono text-xs text-gray-600">{s.id}</td>
                        <td className="py-3.5 px-4 text-gray-700">{s.from}</td>
                        <td className="py-3.5 px-4 text-gray-700">{s.to}</td>
                        <td className="py-3.5 px-4"><span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[s.status] || 'bg-gray-100 text-gray-600'}`}>{s.status}</span></td>
                        <td className="py-3.5 px-4 text-gray-600">{s.driver}</td>
                        <td className="py-3.5 px-4 text-gray-600">{s.eta}</td>
                        <td className="py-3.5 px-4 font-medium text-gray-900">{s.value}</td>
                        <td className="py-3.5 px-4"><button className="text-xs text-emerald-600 hover:underline">Track →</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredShipments.length === 0 && (
                  <div className="py-12 text-center text-gray-400">No shipments match your search.</div>
                )}
              </div>
            </div>
          )}

          {/* ── RECURRING ── */}
          {tab === 'recurring' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-gray-500 text-sm">3 active schedules · Next run: Today 16:00</p>
                <button className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold">+ New Schedule</button>
              </div>
              {[
                { name: 'Bergen Weekly Supply', freq: 'Every Monday 07:00', route: 'Oslo → Bergen', status: 'Active', nextRun: 'Mon 07:00' },
                { name: 'Daily Stavanger Run', freq: 'Daily 06:30', route: 'Oslo Central → Stavanger Depot', status: 'Active', nextRun: 'Tomorrow 06:30' },
                { name: 'Monthly Archive Pickup', freq: '1st of month 14:00', route: 'Multiple → Oslo Warehouse', status: 'Paused', nextRun: '1 May 14:00' },
              ].map(s => (
                <div key={s.name} className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-gray-900">{s.name}</div>
                    <div className="text-sm text-gray-500 mt-1">{s.route} · {s.freq}</div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-right">
                      <div className="text-gray-400 text-xs">Next run</div>
                      <div className="font-medium text-gray-700">{s.nextRun}</div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${s.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{s.status}</span>
                    <button className="text-emerald-600 text-xs hover:underline">Edit</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── INVOICES ── */}
          {tab === 'invoices' && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-4">
                <StatCard icon="💰" label="Outstanding Balance" value="89,200 NOK" color="orange"/>
                <StatCard icon="✅" label="Paid This Year" value="412,800 NOK" color="emerald"/>
                <StatCard icon="📄" label="Total Invoices" value="18" sub="Since Jan 2026" color="blue"/>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>{['Invoice','Period','Deliveries','Amount','Status',''].map(h => <th key={h} className="text-left py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wide">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[
                      { id: 'INV-2026-04', period: 'Apr 2026', count: 47, amount: '89,200 NOK', status: 'Due 01 May' },
                      { id: 'INV-2026-03', period: 'Mar 2026', count: 52, amount: '97,400 NOK', status: 'Paid' },
                      { id: 'INV-2026-02', period: 'Feb 2026', count: 38, amount: '74,600 NOK', status: 'Paid' },
                      { id: 'INV-2026-01', period: 'Jan 2026', count: 41, amount: '81,200 NOK', status: 'Paid' },
                    ].map(inv => (
                      <tr key={inv.id} className="hover:bg-gray-50">
                        <td className="py-3.5 px-4 font-mono text-xs">{inv.id}</td>
                        <td className="py-3.5 px-4">{inv.period}</td>
                        <td className="py-3.5 px-4">{inv.count} deliveries</td>
                        <td className="py-3.5 px-4 font-medium">{inv.amount}</td>
                        <td className="py-3.5 px-4">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${inv.status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>{inv.status}</span>
                        </td>
                        <td className="py-3.5 px-4 flex gap-3">
                          <button className="text-xs text-emerald-600 hover:underline">PDF</button>
                          <button className="text-xs text-gray-400 hover:underline">CSV</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── API ── */}
          {tab === 'api' && (
            <div className="space-y-6">
              <div className="grid sm:grid-cols-3 gap-4">
                <StatCard icon="⚡" label="API Calls Today" value="12,482" sub="↑ 8% vs yesterday" color="blue"/>
                <StatCard icon="✅" label="Success Rate" value="99.8%" sub="Last 30 days" color="emerald"/>
                <StatCard icon="🔔" label="Webhooks Fired" value="1,247" sub="24 failed (retrying)" color="purple"/>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <h3 className="font-bold text-gray-900 mb-4">API Credentials</h3>
                <div className="space-y-3">
                  {[
                    { label: 'API Key', value: 'fgo_live_••••••••••••••••4f2a', copy: true },
                    { label: 'Webhook Secret', value: 'whsec_••••••••••••••••9b1c', copy: true },
                    { label: 'Base URL', value: 'https://api.flyttgo.com/v1', copy: false },
                    { label: 'Environment', value: 'Production', copy: false },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                      <div>
                        <div className="text-xs text-gray-400 font-medium">{item.label}</div>
                        <div className="font-mono text-sm text-gray-700 mt-0.5">{item.value}</div>
                      </div>
                      {item.copy && <button className="text-xs text-emerald-600 border border-emerald-200 px-3 py-1 rounded-lg hover:bg-emerald-50">Copy</button>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <h3 className="font-bold text-gray-900 mb-4">Webhook Endpoints</h3>
                {[
                  { url: 'https://erp.acme.no/webhooks/flyttgo', events: 'delivery.completed, delivery.failed', status: 'Active' },
                  { url: 'https://wms.acme.no/hooks/inbound', events: 'booking.created, booking.cancelled', status: 'Active' },
                ].map((wh, i) => (
                  <div key={i} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
                    <div>
                      <div className="font-mono text-xs text-gray-700">{wh.url}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{wh.events}</div>
                    </div>
                    <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">{wh.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── TEAM ── */}
          {tab === 'team' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-500">4 team members · 2 pending invites</p>
                <button className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold">+ Invite Member</button>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>{['Member','Role','Department','Status','Last Active',''].map(h => <th key={h} className="text-left py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wide">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[
                      { name: 'Ola Nordmann', role: 'Admin', dept: 'Operations', status: 'Active', last: 'Now' },
                      { name: 'Kari Hansen', role: 'Booker', dept: 'Logistics', status: 'Active', last: '2h ago' },
                      { name: 'Per Eriksen', role: 'Finance', dept: 'Accounts', status: 'Active', last: 'Yesterday' },
                      { name: 'Ingrid Berg', role: 'Viewer', dept: 'Procurement', status: 'Pending', last: 'Never' },
                    ].map(m => (
                      <tr key={m.name} className="hover:bg-gray-50">
                        <td className="py-3.5 px-4 font-medium">{m.name}</td>
                        <td className="py-3.5 px-4"><span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs">{m.role}</span></td>
                        <td className="py-3.5 px-4 text-gray-500">{m.dept}</td>
                        <td className="py-3.5 px-4"><span className={`px-2 py-0.5 rounded text-xs ${m.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'}`}>{m.status}</span></td>
                        <td className="py-3.5 px-4 text-gray-400">{m.last}</td>
                        <td className="py-3.5 px-4"><button className="text-xs text-gray-400 hover:text-red-500">Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── OTHER TABS ── */}
          {['drivers','analytics','documents','support'].includes(tab) && (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
              <div className="text-5xl mb-4">{NAV_ITEMS.find(n => n.id === tab)?.icon}</div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">{NAV_ITEMS.find(n => n.id === tab)?.label}</h3>
              <p className="text-gray-500 mb-6 max-w-sm mx-auto">This module is available on the Enterprise plan. Activate your account to unlock full access.</p>
              <button onClick={() => { setShowAuthModal(true); setAuthMode('signup'); }}
                className="px-8 py-3 bg-[#0B2E59] text-white rounded-xl font-semibold hover:bg-[#1a4a8a] transition">
                Activate Corporate Account
              </button>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
