import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../lib/store';
import DeliveryMap from '../components/DeliveryMap';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

interface Stage { label: string; time: string; done: boolean; icon: string; }

const DEFAULT_STAGES: Stage[] = [
  { label: 'Booking Confirmed',           time: '',  done: false, icon: '✅' },
  { label: 'Driver Assigned',             time: '',  done: false, icon: '👤' },
  { label: 'Driver En Route to Pickup',   time: '',  done: false, icon: '🚗' },
  { label: 'Items Loaded',                time: '',  done: false, icon: '📦' },
  { label: 'In Transit',                  time: '',  done: false, icon: '🚚' },
  { label: 'Delivered',                   time: '',  done: false, icon: '🏠' },
];

const STATUS_TO_STAGE: Record<string, number> = {
  pending: 0, confirmed: 1, driver_assigned: 2,
  in_progress: 4, in_transit: 4, completed: 5, customer_confirmed: 5,
};

function ProgressRing({ pct }: { pct: number }) {
  const r = 54; const c = 2 * Math.PI * r;
  return (
    <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10"/>
      <circle cx="60" cy="60" r={r} fill="none" stroke="#10b981" strokeWidth="10"
        strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}
        strokeLinecap="round" className="transition-all duration-1000"/>
    </svg>
  );
}

export default function TrackingPage() {
  const { setPage } = useApp();
  const { user } = useAuth();
  const [bookingId, setBookingId] = useState('');
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState<any>(null);
  const [eta, setEta] = useState(12);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<{ text: string; from: 'you' | 'driver'; time: string }[]>([]);
  const [stages, setStages] = useState<Stage[]>(DEFAULT_STAGES);
  const chatRef = useRef<HTMLDivElement>(null);

  /* Auto-load user's active booking */
  useEffect(() => {
    if (!user) return;
    supabase.from('bookings').select('*')
      .eq('customer_id', user.id)
      .not('status', 'in', '("completed","cancelled")')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]) { setBooking(data[0]); setSearched(true); applyStages(data[0].status); }
      });
  }, [user]);

  /* ETA countdown */
  useEffect(() => {
    if (!searched) return;
    const t = setInterval(() => setEta(p => Math.max(0, p - 1)), 15000);
    return () => clearInterval(t);
  }, [searched]);

  /* Scroll chat */
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  function applyStages(status: string) {
    const idx = STATUS_TO_STAGE[status] ?? 0;
    setStages(DEFAULT_STAGES.map((s, i) => ({
      ...s,
      done: i <= idx,
      time: i <= idx ? new Date(Date.now() - (idx - i) * 900000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
    })));
  }

  async function handleTrack() {
    if (!bookingId.trim()) return;
    setLoading(true);
    const { data } = await supabase.from('bookings').select('*')
      .or(`id.eq.${bookingId},id.ilike.%${bookingId}%`)
      .limit(1);
    setLoading(false);
    if (data?.[0]) { setBooking(data[0]); applyStages(data[0].status); }
    else setBooking(null);
    setSearched(true);
  }

  function sendMessage() {
    if (!message.trim()) return;
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setMessages(m => [...m, { text: message, from: 'you', time: now }]);
    setMessage('');
    setTimeout(() => setMessages(m => [...m, { text: "Got it, thanks! I'll be there shortly.", from: 'driver', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]), 3000);
  }

  const activeIdx = stages.filter(s => s.done).length - 1;
  const pct = ((activeIdx + 1) / stages.length) * 100;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* HERO / SEARCH */}
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] pt-8 pb-12">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs px-4 py-2 rounded-full mb-5">
            📍 Real-Time Delivery Tracking
          </div>
          <h1 className="text-4xl font-extrabold text-white mb-3">Track Your Delivery</h1>
          <p className="text-white/60 mb-8">Enter your booking ID or sign in to auto-load your active job.</p>
          <div className="flex gap-2 max-w-lg mx-auto">
            <div className="relative flex-1">
              <span className="absolute left-3.5 top-3.5 text-gray-400 text-sm">🔍</span>
              <input
                value={bookingId}
                onChange={e => setBookingId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleTrack()}
                placeholder="Booking ID (e.g. BK-7842)"
                className="w-full pl-9 pr-4 py-3.5 rounded-xl text-sm shadow-lg focus:ring-2 focus:ring-[#F2B705] outline-none"
              />
            </div>
            <button onClick={handleTrack} disabled={loading}
              className="px-6 py-3.5 bg-[#F2B705] text-[#0B2E59] font-bold rounded-xl hover:bg-[#F2B705]/90 transition disabled:opacity-60 whitespace-nowrap">
              {loading ? '...' : 'Track'}
            </button>
          </div>
          {!user && (
            <p className="text-white/40 text-xs mt-3">
              <button onClick={() => setPage('home')} className="underline hover:text-white/70">Sign in</button> to auto-load your active delivery
            </p>
          )}
        </div>
      </section>

      {/* TRUST BAR */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap justify-center gap-6 text-xs text-gray-500 font-medium">
          {['🔒 Escrow Protected', '📍 GPS Verified', '⭐ 4.8/5 Rating', '🛡️ Insured Transport', '📞 24/7 Support'].map(b => (
            <span key={b}>{b}</span>
          ))}
        </div>
      </div>

      {/* NOT FOUND */}
      {searched && !booking && (
        <div className="max-w-lg mx-auto px-4 py-16 text-center">
          <div className="text-5xl mb-4">🔍</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Booking Not Found</h2>
          <p className="text-gray-500 mb-6">We couldn&apos;t find a booking with that ID. Check the ID and try again.</p>
          <button onClick={() => setPage('my-bookings')} className="px-6 py-3 bg-[#0B2E59] text-white rounded-xl font-semibold text-sm">View My Bookings</button>
        </div>
      )}

      {/* TRACKING PANEL */}
      {searched && booking && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid lg:grid-cols-3 gap-6">

            {/* LEFT — Map + Chat */}
            <div className="lg:col-span-2 space-y-4">

              {/* LIVE MAP — DeliveryMap with Leaflet + Supabase geocoding */}
              <DeliveryMap
                pickupAddress={booking.pickup_address || 'Karl Johans gate 1, Oslo'}
                deliveryAddress={booking.dropoff_address || 'Storgata 15, Drammen'}
                status={booking.status || 'in_transit'}
                mode="customer"
                driverLat={booking.driver_lat ?? null}
                driverLng={booking.driver_lng ?? null}
                className="shadow-sm"
              />

              {/* CHAT */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
                  <div className="w-8 h-8 bg-[#0B2E59] rounded-full flex items-center justify-center text-white text-xs font-bold">L</div>
                  <div>
                    <div className="font-semibold text-gray-900 text-sm">Lars Olsen</div>
                    <div className="flex items-center gap-1.5 text-xs text-emerald-500"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"/>Online</div>
                  </div>
                  <a href="tel:+4791234567" className="ml-auto px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-semibold flex items-center gap-1">📞 Call</a>
                </div>
                <div ref={chatRef} className="h-40 overflow-y-auto p-4 space-y-3 bg-gray-50">
                  <div className="flex justify-start">
                    <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm max-w-xs shadow-sm">
                      Hi! I&apos;m on my way. Should be there in about {eta} minutes 🚐
                    </div>
                  </div>
                  {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.from === 'you' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`px-4 py-2.5 rounded-2xl text-sm max-w-xs ${m.from === 'you' ? 'bg-[#0B2E59] text-white rounded-tr-sm' : 'bg-white border border-gray-100 rounded-tl-sm shadow-sm'}`}>
                        {m.text}
                        <div className={`text-xs mt-1 ${m.from === 'you' ? 'text-white/60' : 'text-gray-400'}`}>{m.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 p-3 border-t border-gray-100 bg-white">
                  <input
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendMessage()}
                    placeholder="Message your driver..."
                    className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none"
                  />
                  <button onClick={sendMessage} className="px-4 py-2.5 bg-[#0B2E59] text-white rounded-xl text-sm font-medium">Send</button>
                </div>
              </div>
            </div>

            {/* RIGHT SIDEBAR */}
            <div className="space-y-4">

              {/* Progress ring */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
                <div className="relative inline-flex items-center justify-center">
                  <ProgressRing pct={pct}/>
                  <div className="absolute text-center">
                    <div className="text-2xl font-extrabold text-gray-900">{Math.round(pct)}%</div>
                    <div className="text-xs text-gray-400">Complete</div>
                  </div>
                </div>
                <div className="mt-3 font-semibold text-[#0B2E59]">
                  {stages[Math.max(activeIdx, 0)]?.label || 'Booking Confirmed'}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {eta > 0 ? `Arriving in ~${eta} min` : 'Delivered!'}
                </div>
              </div>

              {/* Timeline */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="font-bold text-[#0B2E59] mb-4 text-sm">Delivery Timeline</h3>
                <div className="space-y-0">
                  {stages.map((stage, i) => (
                    <div key={stage.label} className="flex items-start gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${stage.done ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                          {stage.done ? '✓' : stage.icon}
                        </div>
                        {i < stages.length - 1 && (
                          <div className={`w-0.5 h-6 ${stage.done ? 'bg-emerald-300' : 'bg-gray-200'}`}/>
                        )}
                      </div>
                      <div className="pb-2">
                        <div className={`text-sm font-medium leading-tight ${stage.done ? 'text-[#0B2E59]' : 'text-gray-400'}`}>{stage.label}</div>
                        {stage.time && <div className="text-xs text-gray-400 mt-0.5">{stage.time}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Booking details */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="font-bold text-[#0B2E59] mb-4 text-sm">Booking Details</h3>
                <div className="space-y-2.5">
                  {[
                    { label: 'Booking ID', value: booking.id?.slice(0,8).toUpperCase() || 'BK-7842' },
                    { label: 'Service', value: booking.van_type || 'Large Van' },
                    { label: 'Move Date', value: booking.move_date || 'Today' },
                    { label: 'Total', value: `${Number(booking.final_price || booking.price_estimate || 2450).toFixed(0)} NOK` },
                    { label: 'Payment', value: booking.payment_status === 'escrow' ? '🔒 In Escrow' : booking.payment_status || 'Secured' },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between items-center text-sm">
                      <span className="text-gray-500">{row.label}</span>
                      <span className={`font-semibold ${row.label === 'Total' ? 'text-[#F2B705]' : 'text-gray-900'}`}>{row.value}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => setPage('my-bookings')} className="mt-4 w-full py-2.5 border-2 border-[#0B2E59] text-[#0B2E59] rounded-xl text-sm font-semibold hover:bg-[#0B2E59] hover:text-white transition">
                  View All Bookings
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* EMPTY STATE — not searched yet */}
      {!searched && (
        <section className="max-w-4xl mx-auto px-4 py-16">
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { icon: '📍', title: 'Live GPS Tracking', desc: 'Follow your driver on a real-time map with live position updates.' },
              { icon: '💬', title: 'In-App Messaging', desc: 'Chat directly with your driver without sharing personal numbers.' },
              { icon: '🔒', title: 'Escrow Protected', desc: 'Payment held securely until you confirm successful delivery.' },
            ].map(f => (
              <div key={f.title} className="bg-white rounded-2xl border border-gray-100 p-6 text-center shadow-sm">
                <div className="text-4xl mb-3">{f.icon}</div>
                <h3 className="font-bold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
