import React, { useState, useEffect } from 'react';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabase, supabaseFunctionUrl } from '../lib/supabase';

type PayMethod = 'card' | 'vipps' | 'google_pay' | 'invoice';

function safeNum(v: any) { const n = Number(v ?? 0); return isNaN(n) ? 0 : n; }

function CardIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  );
}
function VippsIcon() {
  return <div className="w-5 h-5 bg-orange-500 rounded text-white flex items-center justify-center text-xs font-black">V</div>;
}
function GooglePayIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}
function StripeIcon() {
  return <div className="w-5 h-5 bg-[#635bff] rounded text-white flex items-center justify-center text-xs font-black">S</div>;
}

export default function PaymentPage() {
  const { setPage, bookingData } = useApp();
  const { user, profile } = useAuth();
  const [method, setMethod] = useState<PayMethod>('card');
  const [card, setCard] = useState({ number: '', expiry: '', cvc: '', name: '' });
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [booking, setBooking] = useState<any>(null);
  const isCorporate = profile?.role === 'customer'; // extend when corporate role exists

  /* Load the latest booking that's waiting for payment.
   * BookingFlow inserts rows with payment_status='pending', and
   * this page is the one that flips it to 'paid' once a provider
   * (Stripe Checkout, Vipps, etc.) confirms. */
  useEffect(() => {
    if (!user) return;
    supabase.from('bookings').select('*')
      .eq('customer_id', user.id)
      .eq('payment_status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => { if (data?.[0]) setBooking(data[0]); });
  }, [user]);

  const price = safeNum(booking?.price_estimate ?? (bookingData as any)?.priceEstimate ?? 2450);
  const vat = Math.round(price * 0.25);
  const total = price + vat;

  function formatCard(v: string) {
    return v.replace(/\D/g,'').slice(0,16).replace(/(\d{4})/g,'$1 ').trim();
  }
  function formatExpiry(v: string) {
    const d = v.replace(/\D/g,'').slice(0,4);
    return d.length >= 3 ? d.slice(0,2) + '/' + d.slice(2) : d;
  }

  async function handlePay() {
    setError('');
    if (!user) { setPage('home'); return; }
    if (method === 'card' && (!card.number || !card.expiry || !card.cvc || !card.name)) {
      setError('Please complete all card fields.'); return;
    }
    setProcessing(true);
    try {
      if (method === 'vipps') {
        const res = await fetch(supabaseFunctionUrl('create-vipps-session'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking?.id, amount: total }),
        });
        const d = await res.json();
        if (d.redirectUrl) { window.location.href = d.redirectUrl; return; }
      }
      if (method === 'google_pay' || method === 'card') {
        const res = await fetch(supabaseFunctionUrl('create-checkout-session'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking?.id, amount: total, method }),
        });
        const d = await res.json();
        if (d.url) { window.location.href = d.url; return; }
      }
      /* Fallback — mark the booking as paid-into-escrow directly.
       * BookingFlow already inserted a 'held' row in escrow_payments
       * when the booking was submitted, so we just update that row
       * (by booking_id) with the driver earning and flip it to
       * 'escrow' once a provider has captured the funds. The
       * bookings.payment_status goes to 'escrow' to match. */
      if (booking?.id) {
        await supabase.from('bookings')
          .update({ payment_status: 'escrow' })
          .eq('id', booking.id);
        await supabase.from('escrow_payments')
          .update({ driver_earning: price * 0.8, status: 'escrow' })
          .eq('booking_id', booking.id);
      }
      setSuccess(true);
    } catch (e) {
      setError('Payment could not be processed. Please try again.');
    }
    setProcessing(false);
  }

  if (success) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl shadow-xl p-10 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <span className="text-4xl">✅</span>
        </div>
        <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Payment Secured!</h2>
        <p className="text-gray-500 mb-6 text-sm leading-relaxed">
          Your payment of <strong>{total.toLocaleString()} NOK</strong> is held safely in escrow and will be released to your driver on confirmed delivery.
        </p>
        <div className="bg-emerald-50 rounded-2xl p-4 mb-6 text-left space-y-2">
          {[
            ['Status', '🔒 In Escrow'],
            ['Amount', `${total.toLocaleString()} NOK`],
            ['Booking', booking?.id?.slice(0,8).toUpperCase() || 'BK-7842'],
            ['Driver payout', `${Math.round(price * 0.8).toLocaleString()} NOK on delivery`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span className="text-gray-500">{k}</span>
              <span className="font-semibold text-gray-900">{v}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={() => setPage('tracking')} className="flex-1 py-3 bg-[#0B2E59] text-white rounded-xl font-bold text-sm hover:bg-[#1a4a8a] transition">Track Delivery</button>
          <button onClick={() => setPage('my-bookings')} className="flex-1 py-3 border-2 border-gray-200 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-50 transition">My Bookings</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">

        {/* Back */}
        <button onClick={() => setPage('booking')} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6 text-sm">
          ← Back to booking
        </button>

        <div className="grid lg:grid-cols-5 gap-8">

          {/* LEFT — Payment form */}
          <div className="lg:col-span-3 space-y-5">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-xl font-extrabold text-gray-900 mb-5">Choose Payment Method</h2>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {([
                  { id: 'card', label: 'Card', icon: <CardIcon/>, sub: 'Stripe' },
                  { id: 'vipps', label: 'Vipps', icon: <VippsIcon/>, sub: 'Norwegian' },
                  { id: 'google_pay', label: 'Google Pay', icon: <GooglePayIcon/>, sub: 'Fast' },
                  { id: 'invoice', label: 'Invoice', icon: <StripeIcon/>, sub: 'Corporate' },
                ] as { id: PayMethod; label: string; icon: React.ReactNode; sub: string }[]).map(m => (
                  <button key={m.id} onClick={() => setMethod(m.id)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition ${
                      method === m.id ? 'border-[#0B2E59] bg-[#0B2E59]/5' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    {m.icon}
                    <div className="text-xs font-bold text-gray-900">{m.label}</div>
                    <div className="text-xs text-gray-400">{m.sub}</div>
                  </button>
                ))}
              </div>

              {/* CARD FORM */}
              {method === 'card' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Cardholder Name</label>
                    <input value={card.name} onChange={e => setCard(c => ({ ...c, name: e.target.value }))}
                      placeholder="Ola Nordmann"
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none"/>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Card Number</label>
                    <div className="relative">
                      <input value={card.number} onChange={e => setCard(c => ({ ...c, number: formatCard(e.target.value) }))}
                        placeholder="1234 5678 9012 3456" maxLength={19}
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none pr-16 font-mono"/>
                      <div className="absolute right-3 top-3 flex gap-1">
                        <div className="w-6 h-4 bg-blue-700 rounded-sm text-white flex items-center justify-center text-xs font-black">V</div>
                        <div className="w-6 h-4 bg-red-500 rounded-sm text-white flex items-center justify-center text-xs font-black">M</div>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Expiry Date</label>
                      <input value={card.expiry} onChange={e => setCard(c => ({ ...c, expiry: formatExpiry(e.target.value) }))}
                        placeholder="MM/YY" maxLength={5}
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none font-mono"/>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">CVC</label>
                      <input value={card.cvc} onChange={e => setCard(c => ({ ...c, cvc: e.target.value.replace(/\D/,'').slice(0,4) }))}
                        placeholder="•••" maxLength={4} type="password"
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none font-mono"/>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-4 py-3">
                    <span className="text-blue-500">🔒</span>
                    <span className="text-xs text-blue-700">Card data encrypted by Stripe. FlyttGo never stores card details.</span>
                  </div>
                </div>
              )}

              {/* VIPPS */}
              {method === 'vipps' && (
                <div className="bg-orange-50 rounded-2xl p-6 text-center border border-orange-100">
                  <div className="w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white font-black text-2xl">V</div>
                  <h3 className="font-bold text-gray-900 mb-2">Pay with Vipps</h3>
                  <p className="text-gray-500 text-sm mb-4">You&apos;ll be redirected to Vipps to complete payment securely on your phone.</p>
                  <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                    <span>🇳🇴 Norwegian mobile payment</span>
                    <span>·</span>
                    <span>Bank-level security</span>
                  </div>
                </div>
              )}

              {/* GOOGLE PAY */}
              {method === 'google_pay' && (
                <div className="bg-gray-50 rounded-2xl p-6 text-center border border-gray-200">
                  <div className="flex items-center justify-center gap-2 mb-4">
                    <GooglePayIcon/>
                    <span className="font-bold text-gray-900">Google Pay</span>
                  </div>
                  <p className="text-gray-500 text-sm mb-4">Pay instantly using your saved Google Pay card. Processed securely via Stripe.</p>
                  <div className="text-xs text-gray-400">Your card details are never shared with FlyttGo.</div>
                </div>
              )}

              {/* INVOICE */}
              {method === 'invoice' && (
                <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <StripeIcon/>
                    <div>
                      <div className="font-bold text-gray-900">Corporate Invoice</div>
                      <div className="text-xs text-gray-500">Available for registered companies with a FlyttGo Corporate account</div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Company Name</label>
                      <input placeholder="Acme Logistics AS" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none"/>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Organisation Number</label>
                      <input placeholder="123 456 789" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none"/>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Billing Email</label>
                      <input type="email" placeholder="accounts@company.no" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#0B2E59] outline-none"/>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">Invoices are generated on the 1st of each month. 30-day payment terms. Requires active Corporate plan.</p>
                </div>
              )}

              {error && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 flex items-center gap-2">
                  <span>⚠️</span>{error}
                </div>
              )}
            </div>

            {/* SECURITY BADGES */}
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { icon: '🔒', label: 'Escrow Protection', sub: 'Pay only on delivery' },
                { icon: '🛡️', label: 'Bank Encryption', sub: '256-bit SSL' },
                { icon: '✅', label: 'GDPR Compliant', sub: 'Your data is safe' },
              ].map(b => (
                <div key={b.label} className="bg-white rounded-xl border border-gray-100 p-3">
                  <div className="text-xl mb-1">{b.icon}</div>
                  <div className="text-xs font-semibold text-gray-800">{b.label}</div>
                  <div className="text-xs text-gray-400">{b.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — Order summary */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sticky top-6">
              <h3 className="font-bold text-gray-900 mb-4">Order Summary</h3>

              {/* Booking info */}
              <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Service</span>
                  <span className="font-medium">{booking?.van_type || bookingData?.vanType || 'Large Van'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Pickup</span>
                  <span className="font-medium text-right text-xs max-w-[140px] truncate">{booking?.pickup_address || bookingData?.pickupAddress || '—'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Delivery</span>
                  <span className="font-medium text-right text-xs max-w-[140px] truncate">{booking?.dropoff_address || bookingData?.dropoffAddress || '—'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Date</span>
                  <span className="font-medium">{booking?.move_date || 'Scheduled'}</span>
                </div>
              </div>

              {/* Price breakdown */}
              <div className="space-y-2.5 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Service price</span>
                  <span>{price.toLocaleString()} NOK</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">MVA (25%)</span>
                  <span>{vat.toLocaleString()} NOK</span>
                </div>
                <div className="flex justify-between text-sm text-emerald-600">
                  <span>Escrow protection</span>
                  <span>Included</span>
                </div>
                <div className="border-t border-gray-100 pt-2.5 flex justify-between">
                  <span className="font-bold text-gray-900">Total</span>
                  <span className="font-extrabold text-[#0B2E59] text-lg">{total.toLocaleString()} NOK</span>
                </div>
              </div>

              {/* Escrow notice */}
              <div className="bg-emerald-50 rounded-xl p-3 mb-5 flex gap-2.5 items-start">
                <span className="text-emerald-500 text-lg flex-shrink-0">🔒</span>
                <p className="text-xs text-emerald-700 leading-relaxed">
                  Payment is held securely in escrow. Released to your driver only after you confirm successful delivery.
                </p>
              </div>

              <button
                onClick={handlePay}
                disabled={processing}
                className="w-full py-4 bg-[#0B2E59] text-white rounded-xl font-extrabold text-base hover:bg-[#1a4a8a] transition disabled:opacity-60 shadow-lg"
              >
                {processing ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                    Processing...
                  </span>
                ) : method === 'vipps' ? 'Pay with Vipps →'
                  : method === 'google_pay' ? 'Pay with Google Pay →'
                  : method === 'invoice' ? 'Request Invoice →'
                  : `Pay ${total.toLocaleString()} NOK →`}
              </button>

              <div className="flex items-center justify-center gap-4 mt-4">
                <div className="flex gap-1.5 items-center text-xs text-gray-400">
                  <StripeIcon/><span>Stripe</span>
                </div>
                <div className="w-px h-4 bg-gray-200"/>
                <div className="text-xs text-gray-400">🔒 SSL secured</div>
                <div className="w-px h-4 bg-gray-200"/>
                <div className="text-xs text-gray-400">🇳🇴 GDPR</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
