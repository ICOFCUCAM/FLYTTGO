import React, { useState, useEffect } from "react";
import { supabase, supabaseFunctionUrl } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useApp } from "../lib/store";

function safeNumber(value: any): number {
  const n = Number(value ?? 0);
  return isNaN(n) ? 0 : n;
}

function formatDuration(start?: string | null, end?: string | null) {
  if (!start) return "Not started";
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const diff = Math.floor((endTime - startTime) / 1000);
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

interface Booking {
  id: string; pickup_address: string | null; dropoff_address: string | null;
  van_type: string | null; status: string | null; payment_status: string | null;
  price_estimate: number | null; original_price?: number | null; final_price?: number | null;
  estimated_hours?: number | null; actual_hours?: number | null;
  start_time?: string | null; end_time?: string | null;
  price_adjusted?: boolean | null; move_date: string | null; created_at: string | null;
  customer_confirmation?: boolean | null; driver_confirmation?: boolean | null;
}

export default function MyBookings() {
  const { user } = useAuth();
  const { setPage, setBookingData } = useApp();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [escrowMap, setEscrowMap] = useState<any>({});

  useEffect(() => { if (!user) return; fetchBookings(); }, [user]);

  if (!user) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">Please sign in to view your bookings.</p></div>;

  async function fetchBookings() {
    setLoading(true);
    const { data } = await supabase.from("bookings").select("*").eq("customer_id", user?.id).order("created_at", { ascending: false });
    const rows = (data as Booking[]) || [];
    setBookings(rows);
    const ids = rows.map(r => r.id);
    if (ids.length > 0) {
      const { data: escrow } = await supabase.from("escrow_payments").select("*").in("booking_id", ids);
      const map: any = {};
      escrow?.forEach(e => { map[e.booking_id] = e; });
      setEscrowMap(map);
    }
    setLoading(false);
  }

  async function cancelBooking(id: string) {
    if (!confirm("Cancel this booking?")) return;
    await supabase.from("bookings").update({ status: "cancelled" }).eq("id", id);
    fetchBookings();
  }

  async function confirmCompletion(bookingId: string) {
    await supabase.from("bookings").update({ customer_confirmation: true, status: "customer_confirmed" }).eq("id", bookingId);
    const { data: booking } = await supabase.from("bookings").select("driver_confirmation").eq("id", bookingId).single();
    if (booking?.driver_confirmation === true) {
      await fetch(supabaseFunctionUrl("process-payment"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release_escrow", bookingId }) });
      alert("Job complete! Payment released to driver.");
    } else { alert("Confirmed! Waiting for driver confirmation to release payment."); }
    fetchBookings();
  }

  async function approveAdjustment(escrowId: string) {
    await supabase.from("escrow_payments").update({ adjustment_approved: true }).eq("id", escrowId);
    fetchBookings();
  }

  function repeatBooking(booking: Booking) {
    setBookingData({ pickupAddress: booking.pickup_address, dropoffAddress: booking.dropoff_address, vanType: booking.van_type, step: 2 });
    setPage("booking");
  }

  const filtered = filter === "all" ? bookings : bookings.filter(b => b.status === filter);

  const statusColors: Record<string, string> = {
    awaiting_payment: "bg-gray-100 text-gray-600", awaiting_driver: "bg-yellow-100 text-yellow-700",
    driver_assigned: "bg-indigo-100 text-indigo-700", in_progress: "bg-purple-100 text-purple-700",
    completed_by_driver: "bg-orange-100 text-orange-700", customer_confirmed: "bg-blue-100 text-blue-700",
    completed: "bg-emerald-100 text-emerald-700", cancelled: "bg-red-100 text-red-700",
  };
  const paymentColors: Record<string, string> = {
    pending: "bg-gray-100 text-gray-600", escrow: "bg-blue-100 text-blue-700",
    released: "bg-emerald-100 text-emerald-700", refunded: "bg-red-100 text-red-700",
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">My Bookings</h1>
        <div className="flex flex-wrap gap-2 mb-6">
          {["all","awaiting_payment","awaiting_driver","in_progress","completed_by_driver","completed","cancelled"].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-4 py-2 rounded text-sm ${filter === f ? "bg-emerald-600 text-white" : "bg-white border"}`}>{f.replace(/_/g, " ")}</button>
          ))}
        </div>
        {loading ? <div className="text-center py-12 text-gray-500">Loading bookings...</div>
        : filtered.length === 0 ? <div className="text-center py-12 text-gray-500">No bookings found</div>
        : filtered.map(booking => {
          const escrow = escrowMap[booking.id];
          const rawPrice = booking.final_price ?? booking.original_price ?? booking.price_estimate;
          const price = (rawPrice === null || rawPrice === undefined || isNaN(Number(rawPrice))) ? 0 : Number(rawPrice);
          return (
            <div key={booking.id} className="bg-white p-6 rounded-xl border mb-4">
              <div className="flex gap-3 mb-3 flex-wrap">
                <span className={`px-3 py-1 rounded text-xs font-medium ${statusColors[booking.status || ""] || "bg-gray-100 text-gray-600"}`}>{booking.status?.replace(/_/g, " ")}</span>
                <span className={`px-3 py-1 rounded text-xs font-medium ${paymentColors[booking.payment_status || ""] || "bg-gray-100 text-gray-600"}`}>{booking.payment_status}</span>
              </div>
              <div className="mb-3">
                <p className="text-sm text-gray-500">Pickup</p><p className="font-medium">{booking.pickup_address}</p>
                <p className="text-sm text-gray-500 mt-1">Delivery</p><p className="font-medium">{booking.dropoff_address}</p>
              </div>
              {booking.move_date && <p className="text-sm text-gray-500 mb-2">Move date: <span className="font-medium">{booking.move_date}</span></p>}
              <div className="text-sm text-gray-600 mb-1">Timer: {formatDuration(booking.start_time, booking.end_time)}</div>
              <div className="text-sm text-gray-600 mb-3">Estimated: {booking.estimated_hours ?? "-"} hrs | Actual: {booking.actual_hours ?? "Running"}</div>
              <div className="text-xl font-bold text-emerald-600 mb-2">{safeNumber(price).toFixed(0)} NOK</div>
              {booking.price_adjusted && <div className="bg-orange-50 border border-orange-200 rounded p-3 mb-3"><p className="text-orange-700 text-sm font-semibold">Extra time added — price updated</p></div>}
              {escrow?.adjustment_required && !escrow.adjustment_approved && <button onClick={() => approveAdjustment(escrow.id)} className="mb-3 bg-orange-600 text-white px-4 py-2 rounded text-sm">Approve additional charge</button>}
              <div className="flex gap-3 flex-wrap">
                {booking.status === "awaiting_driver" && <button onClick={() => cancelBooking(booking.id)} className="px-4 py-2 border rounded text-sm hover:bg-gray-50">Cancel</button>}
                {booking.status === "completed_by_driver" && !booking.customer_confirmation && <button onClick={() => confirmCompletion(booking.id)} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm">Confirm Completion</button>}
                <button onClick={() => repeatBooking(booking)} className="px-4 py-2 border rounded text-sm hover:bg-gray-50">Repeat Booking</button>
              </div>
              <div className="text-xs text-gray-400 mt-3">Loyalty points earned: {Math.floor(Number(price || 0) / 100)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
