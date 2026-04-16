import React, { useState, useEffect, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { useApp } from "../lib/store";
import { supabase, supabaseFunctionUrl } from "../lib/supabase";

/* Lazy-load Leaflet so the ~150 KB map bundle is only fetched when
 * there's actually an in-flight booking to render. MyBookings uses
 * the same pattern. */
const DriverTrackingMap = lazy(() => import("./DriverTrackingMap"));

/** Booking status values where a driver is en route and a live map
 *  is useful. Pending / confirmed / cancelled / completed don't get
 *  one — either there's no driver assigned yet or the trip is over. */
const IN_FLIGHT_STATUSES = new Set([
  "driver_assigned",
  "pickup_arrived",
  "loading",
  "in_transit",
]);

/**
 * SessionStorage key used to hand off a specific booking id to
 * PaymentPage. When the user clicks "Complete Payment" on a row in
 * the dashboard / my-bookings, we stash the id here so PaymentPage
 * can load exactly that booking instead of falling back to the
 * most-recent pending one (which would be wrong if the user has
 * multiple unfinished drafts).
 *
 * PaymentPage reads this on mount and clears it once loaded.
 */
const PAYMENT_HANDOFF_KEY = "flyttgo:payment-booking-id";

function fmt(value: any): string {
  const n = Number(value ?? 0);
  return String(Math.floor(isNaN(n) ? 0 : n));
}

export default function CustomerDashboard() {
  const { profile, user } = useAuth();
  const { setPage } = useApp();
  const { t } = useTranslation();
  const [stats, setStats] = useState({ total: 0, active: 0, completed: 0, spent: 0 });
  const [recentBookings, setRecentBookings] = useState<any[]>([]);
  const [activeBooking, setActiveBooking] = useState<any>(null);
  const [escrowAdjustment, setEscrowAdjustment] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    loadData();
  }, [user]);

  async function loadData() {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data } = await supabase.from("bookings").select("*").eq("customer_id", user.id).order("created_at", { ascending: false });
      const bookings = data || [];
      setRecentBookings(bookings.slice(0, 5));
      const active = bookings.find((b: any) => !["completed", "cancelled"].includes(b.status));
      setActiveBooking(active || null);
      setStats({
        total: bookings.length,
        active: bookings.filter((b: any) => !["completed", "cancelled"].includes(b.status)).length,
        completed: bookings.filter((b: any) => b.status === "completed").length,
        spent: bookings.reduce((s: number, b: any) => { const val = Number(b.final_price ?? b.original_price ?? b.price_estimate ?? 0); return s + (isNaN(val) ? 0 : val); }, 0)
      });
      if (active) {
        const { data: escrow } = await supabase.from("escrow_payments").select("*").eq("booking_id", active.id).maybeSingle();
        setEscrowAdjustment(escrow || null);
      }
    } catch (err) { console.error("Dashboard error:", err); }
    setLoading(false);
  }

  async function confirmCompletion(bookingId: string) {
    // Only toggle the confirmation flag — the bookings.status CHECK
    // constraint doesn't have a 'customer_confirmed' value. The dual-
    // confirmation logic lives in the customer_confirmation /
    // driver_confirmation booleans, which a trigger uses to release escrow.
    await supabase.from("bookings").update({ customer_confirmation: true }).eq("id", bookingId);
    const { data: booking } = await supabase.from("bookings").select("driver_confirmation").eq("id", bookingId).single();
    if (booking?.driver_confirmation === true) {
      await fetch(supabaseFunctionUrl("process-payment"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release_escrow", bookingId }) });
      alert("Job complete! Payment released to driver.");
    } else { alert("Confirmed! Waiting for driver confirmation."); }
    loadData();
  }

  async function approveAdjustment(escrowId: string) {
    await supabase.from("escrow_payments").update({ adjustment_approved: true }).eq("id", escrowId);
    alert("Additional time charge approved"); loadData();
  }

  async function cancelBooking(bookingId: string) {
    await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);
    alert("Booking cancelled"); loadData();
  }

  /** Hand the user off to the payment page with this booking preselected.
   *  We stash the id in sessionStorage so PaymentPage can load exactly
   *  this booking instead of falling back to its most-recent-pending
   *  query, which would be wrong when multiple drafts exist. */
  function goToPayment(bookingId: string) {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(PAYMENT_HANDOFF_KEY, bookingId);
    }
    setPage("payment");
  }

  if (!user) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-700 font-semibold mb-2">Please sign in to view your dashboard</p>
        <button onClick={() => setPage("home")} className="mt-4 px-6 py-2 bg-emerald-600 text-white rounded-xl">Go to Home</button>
      </div>
    </div>
  );

  if (loading) return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-5xl mx-auto px-4 animate-pulse">
        {/* Title skeleton */}
        <div className="h-7 w-56 bg-gray-200 rounded-md mb-2" />
        <div className="h-4 w-72 bg-gray-200 rounded-md mb-8" />
        {/* Stat cards row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="h-3 w-20 bg-gray-200 rounded mb-3" />
              <div className="h-7 w-16 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
        {/* Recent bookings skeleton */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
          {[0, 1, 2].map(i => (
            <div key={i} className="border-b border-gray-100 last:border-0 py-4">
              <div className="h-4 w-1/2 bg-gray-200 rounded mb-2" />
              <div className="h-3 w-1/3 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{t('dashboard.welcome', { name: profile?.first_name || 'Customer' })}</h1>
          <p className="text-gray-600 mt-1">{t('dashboard.trackMove')}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[{ label: t('dashboard.totalBookings'), value: stats.total }, { label: t('dashboard.active'), value: stats.active }, { label: t('dashboard.completed'), value: stats.completed }, { label: t('dashboard.totalSpent'), value: `${fmt(stats.spent)} NOK` }].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-5 border">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className="text-2xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>
        {activeBooking && (
          <div className="bg-white rounded-xl border p-6 mb-8">
            <h2 className="text-lg font-bold mb-4">{t('dashboard.activeBooking')}</h2>
            {/* Payment-required banner — shown whenever the active
             * booking still has payment_status = 'pending'. Booking
             * rows are inserted in this state by BookingFlow and
             * only transition to 'escrow' / 'paid' once PaymentPage
             * captures the money, so a pending booking is literally
             * a half-finished draft that needs the user to go back
             * and complete checkout. */}
            {activeBooking.payment_status === "pending" && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4 flex items-start gap-3">
                <span className="text-yellow-500 text-xl flex-shrink-0">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-yellow-800">{t('dashboard.paymentRequired')}</p>
                  <p className="text-sm text-yellow-700 mt-0.5">
                    {t('dashboard.paymentRequiredDesc')}
                  </p>
                  <button
                    onClick={() => goToPayment(activeBooking.id)}
                    className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition"
                  >
                    {t('dashboard.completePayment')}
                  </button>
                </div>
              </div>
            )}
            <p className="font-medium">{activeBooking.pickup_address} → {activeBooking.dropoff_address}</p>
            <p className="text-sm text-gray-500 mt-2">{t('dashboard.status')}: <strong>{activeBooking.status?.replace(/_/g, " ")}</strong></p>
            <p className="text-sm text-gray-500">{t('dashboard.estimatedHours')}: <strong>{activeBooking.estimated_hours ?? "-"}</strong></p>
            <p className="text-sm text-gray-500">{t('dashboard.actualHours')}: <strong>{activeBooking.actual_hours ?? t('dashboard.running')}</strong></p>
            <p className="text-sm text-gray-500">
              {activeBooking.payment_status === "pending"
                ? t('dashboard.escrowNotFunded')
                : t('dashboard.escrowProtected')}
            </p>
            <p className="text-lg font-bold mt-2">{fmt(activeBooking.final_price ?? activeBooking.original_price ?? activeBooking.price_estimate)} NOK</p>

            {/* LIVE MAP — only once a driver is actually en route. We
             * don't show this for pending / confirmed bookings where
             * no driver is assigned yet (the map would just be two
             * static pins, not worth the 150 KB Leaflet load) and we
             * also skip it for unpaid bookings since those are really
             * drafts. Requires valid pickup + dropoff coordinates. */}
            {IN_FLIGHT_STATUSES.has(activeBooking.status) &&
              activeBooking.payment_status !== "pending" &&
              activeBooking.pickup_lat && activeBooking.pickup_lng &&
              activeBooking.dropoff_lat && activeBooking.dropoff_lng && (
                <div className="mt-5">
                  <Suspense fallback={<div className="h-72 rounded-xl bg-gray-100 animate-pulse" />}>
                    <DriverTrackingMap
                      pickup={{ lat: Number(activeBooking.pickup_lat), lng: Number(activeBooking.pickup_lng) }}
                      dropoff={{ lat: Number(activeBooking.dropoff_lat), lng: Number(activeBooking.dropoff_lng) }}
                      driverId={activeBooking.driver_id}
                    />
                  </Suspense>
                </div>
              )}

            {/* Action row */}
            <div className="flex flex-wrap gap-3 mt-5">
              {/* Track Delivery — the primary action for any booking
               * that's past the draft stage. Links into the dedicated
               * TrackingPage which has the progress ring, timeline,
               * chat, and ETA countdown. We hide it for unpaid
               * drafts since there's nothing to track yet. */}
              {activeBooking.payment_status !== "pending" &&
                activeBooking.status !== "cancelled" &&
                activeBooking.status !== "completed" && (
                  <button
                    onClick={() => setPage("tracking")}
                    className="bg-[#0B2E59] hover:bg-[#1a4a8a] text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition flex items-center gap-2"
                  >
                    <span>📍</span>
                    {t('dashboard.trackDelivery')}
                  </button>
                )}

              {activeBooking.price_adjusted && (
                <div className="bg-orange-50 border border-orange-200 p-4 rounded w-full">
                  <p className="text-orange-700 font-semibold">Extra time detected</p>
                  <p className="text-sm text-orange-600">Final price updated automatically</p>
                </div>
              )}
              {escrowAdjustment?.adjustment_required && !escrowAdjustment.adjustment_approved && (
                <button onClick={() => approveAdjustment(escrowAdjustment.id)} className="bg-orange-600 text-white px-4 py-2 rounded text-sm font-semibold">Approve additional time charge</button>
              )}
              {activeBooking.status === "completed_by_driver" && (
                <button onClick={() => confirmCompletion(activeBooking.id)} className="bg-emerald-600 text-white px-4 py-2 rounded text-sm font-semibold">Confirm Completion</button>
              )}
              {activeBooking.status === "awaiting_driver" && (
                <button onClick={() => cancelBooking(activeBooking.id)} className="bg-red-600 text-white px-4 py-2 rounded text-sm font-semibold">Cancel Booking</button>
              )}
            </div>
          </div>
        )}
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          <button onClick={() => setPage("booking")} className="bg-emerald-600 text-white rounded-xl p-5 font-semibold">{t('dashboard.newBooking')}</button>
          <button onClick={() => setPage("my-bookings")} className="bg-white rounded-xl p-5 border font-semibold">{t('dashboard.myBookings')}</button>
          <button onClick={() => setPage("van-guide")} className="bg-white rounded-xl p-5 border font-semibold">{t('dashboard.vanCalculator')}</button>
        </div>
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="p-5 border-b"><h2 className="text-lg font-bold">{t('dashboard.recentBookings')}</h2></div>
          {recentBookings.length === 0 ? (<div className="p-8 text-center text-gray-500">{t('dashboard.noBookings')}</div>) : (
            <div className="divide-y">
              {recentBookings.map(b => (
                <div key={b.id} className="p-5 flex justify-between items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{b.pickup_address} → {b.dropoff_address}</p>
                    <p className="text-xs text-gray-500">{b.created_at ? new Date(b.created_at).toLocaleDateString() : "-"}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold">{fmt(b.final_price ?? b.original_price ?? b.price_estimate)} NOK</p>
                    <span className={`text-xs px-2 py-1 rounded ${b.status === "completed" ? "bg-emerald-100 text-emerald-700" : b.status === "cancelled" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>{b.status?.replace(/_/g, " ")}</span>
                    {b.payment_status === "pending" && b.status !== "cancelled" && (
                      <button
                        onClick={() => goToPayment(b.id)}
                        className="block mt-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
                      >
                        Complete Payment →
                      </button>
                    )}
                    {IN_FLIGHT_STATUSES.has(b.status) && (
                      <button
                        onClick={() => setPage("tracking")}
                        className="block mt-2 text-xs font-semibold text-[#0B2E59] hover:text-[#1a4a8a] hover:underline"
                      >
                        📍 Track →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
