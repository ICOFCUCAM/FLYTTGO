// FULL FINAL VERSION — PRODUCTION CONTROL CENTER BUILD
import React, { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

/* Lazy-loaded Leaflet map — ~150 KB bundle is only paid when the
 * admin actually opens the Fleet Map tab. */
const FleetMap = lazy(() => import("./FleetMap"));

type AdminTab =
  | "overview"
  | "fleet-map"
  | "drivers"
  | "bookings"
  | "applications"
  | "revenue"
  | "disputes"
  | "settings";

/* ── CSV export helper ──────────────────────────────────────────
 * Turns an array of rows into a CSV string and triggers a browser
 * download. Quotes cell values and escapes embedded quotes so the
 * resulting file opens cleanly in Excel / Google Sheets / Numbers.
 * Used by the Drivers and Bookings tabs for the Export button. */
function downloadCsv(filename: string, rows: Record<string, any>[]) {
  if (rows.length === 0) {
    alert("No rows to export.");
    return;
  }
  const columns = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r).forEach(k => acc.add(k));
      return acc;
    }, new Set())
  );
  const escape = (v: any): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = columns.join(",");
  const body = rows.map(r => columns.map(c => escape(r[c])).join(",")).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeNumber(value: any): number {
  const n = Number(value ?? 0);
  return isNaN(n) ? 0 : n;
}

function calculateRefundAmount(booking: any) {
  const price = safeNumber(booking.price_estimate);
  if (booking.manual_refund_percent != null) return price * (booking.manual_refund_percent / 100);
  // status values come from the bookings CHECK constraint:
  //   pending | confirmed | driver_assigned | pickup_arrived |
  //   loading | in_transit | completed | cancelled
  switch (booking.status) {
    case "pending":                        return price;
    case "confirmed":                      return price * 0.9;
    case "driver_assigned":                return price * 0.8;
    case "pickup_arrived":
    case "loading":                        return price * 0.7;
    case "in_transit":                     return price * 0.5;
    case "completed":                      return 0;
    case "cancelled":                      return 0;
    default:                               return 0;
  }
}

function Card({ title, value, isCurrency = true }: { title: string; value: number; isCurrency?: boolean }) {
  return (
    <div className="bg-white p-4 rounded shadow">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-xl font-bold text-emerald-600">
        {isCurrency ? `${safeNumber(value).toFixed(0)} NOK` : safeNumber(value)}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { profile, loading, user } = useAuth();
  const [tab, setTab] = useState<AdminTab>("overview");
  const [drivers, setDrivers] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);
  const [manualRefundPercent, setManualRefundPercent] = useState<number>(0);
  const [selectedApplication, setSelectedApplication] = useState<any | null>(null);
  const [appDocuments, setAppDocuments] = useState<any[]>([]);
  const [applicationDocStatus, setApplicationDocStatus] = useState<Record<string, string[]>>({});
  const [driverSubExpiry, setDriverSubExpiry] = useState<Record<string, string | null>>({});
  const [platformSettings, setPlatformSettings] = useState<Record<string, string>>({});
  const [customerCount, setCustomerCount] = useState(0);
  const [activeDrivers, setActiveDrivers] = useState(0);
  const [activeBookings, setActiveBookings] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [fleetCapacity, setFleetCapacity] = useState<"HIGH" | "MEDIUM" | "LOW">("HIGH");
  const [delayedBookingsCount, setDelayedBookingsCount] = useState(0);
  const [highValueBookingsCount, setHighValueBookingsCount] = useState(0);
  const [dispatchOverload, setDispatchOverload] = useState(false);
  const [assignmentSpeed, setAssignmentSpeed] = useState<number | null>(null);
  const [driverUtilization, setDriverUtilization] = useState<number | null>(null);
  const [cancellationRisk, setCancellationRisk] = useState<number | null>(null);
  const [demandLevel, setDemandLevel] = useState<string | null>(null);
  const [cityLiquidity, setCityLiquidity] = useState<Record<string, string>>({});
  const [fraudToday, setFraudToday] = useState(0);
  const [incidentToday, setIncidentToday] = useState(0);
  const [moderationFlagsToday, setModerationFlagsToday] = useState(0);
  const [riskLevel, setRiskLevel] = useState<"LOW" | "MEDIUM" | "HIGH">("LOW");
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [bookingPipeline, setBookingPipeline] = useState({ pending: 0, confirmed: 0, assigned: 0, inTransit: 0, completedToday: 0, cancelledToday: 0 });
  const [driverStatusStats, setDriverStatusStats] = useState({ online: 0, busy: 0, pending: 0, suspended: 0 });
  const [revenueStats, setRevenueStats] = useState({ today: 0, week: 0, month: 0, totalCommission: 0, pendingEscrow: 0, releasedToDrivers: 0 });

  const DOCUMENT_TYPE_LABELS: Record<string, string> = {
    driver_license: "Driver License", insurance: "Insurance Document",
    vehicle_registration: "Vehicle Registration", profile_photo: "Profile Photo",
    background_check: "Background Check",
  };
  const REQUIRED_DOCS = ["driver_license", "insurance", "vehicle_registration", "profile_photo"];
  const tabs: AdminTab[] = [
    "overview",
    "fleet-map",
    "drivers",
    "bookings",
    "applications",
    "revenue",
    "disputes",
    "settings",
  ];

  /* ── Drivers tab filter/search state ──────────────────────── */
  const [driverSearch, setDriverSearch] = useState("");
  const [driverFilterStatus, setDriverFilterStatus] = useState<"all" | "approved" | "pending" | "suspended">("all");
  const [driverFilterOnline, setDriverFilterOnline] = useState<"all" | "online" | "offline">("all");

  /* ── Manual booking dispatch modal state ──────────────────── */
  const [dispatchBooking, setDispatchBooking] = useState<any | null>(null);
  const [dispatchDriverId, setDispatchDriverId] = useState<string>("");

  useEffect(() => {
    if (loading || !profile || profile.role !== "admin") return;
    loadData();
    const channels = ["bookings", "driver_profiles", "driver_applications", "escrow_payments", "driver_wallet_transactions", "driver_subscriptions"].map(table =>
      supabase.channel(`admin-${table}`).on("postgres_changes", { event: "*", schema: "public", table }, () => {
        if (!(globalThis as any).__adminReloadTimer) {
          (globalThis as any).__adminReloadTimer = setTimeout(() => { loadData(); (globalThis as any).__adminReloadTimer = null; }, 800);
        }
      }).subscribe()
    );
    return () => channels.forEach(c => supabase.removeChannel(c));
  }, [profile, loading]);

  async function enforceSubscriptionExpiry() {
    // driver_subscriptions table column is `subscription_status`, not `status`.
    const { data } = await supabase
      .from("driver_subscriptions")
      .select("driver_id, end_date")
      .eq("subscription_status", "active");
    if (!data) return;
    for (const sub of data) {
      if (sub.end_date && new Date(sub.end_date) < new Date()) {
        await supabase
          .from("driver_subscriptions")
          .update({ subscription_status: "cancelled" })
          .eq("driver_id", sub.driver_id);
        await supabase
          .from("driver_profiles")
          .update({ status: "suspended" })
          .eq("user_id", sub.driver_id);
      }
    }
  }

  async function loadData() {
    try {
      await enforceSubscriptionExpiry();
      let confirmedCount = 0;

      const { data: drv } = await supabase.from("driver_profiles").select("*, driver_subscriptions(plan)");
      if (drv) {
        setDrivers(drv);
        let online = 0, busy = 0, pending = 0, suspended = 0;
        drv.forEach((d: any) => {
          if (d.online === true) online++;
          if (d.availability_status === "busy" || d.is_busy === true || (d.online === true && d.status === "active")) busy++;
          if (d.status === "pending") pending++;
          if (d.status === "suspended") suspended++;
        });
        setDriverStatusStats({ online, busy, pending, suspended });
      }

      const { data: bks } = await supabase.from("bookings").select("*").order("created_at", { ascending: false });
      if (bks) {
        setBookings(bks);
        let pending = 0, confirmed = 0, assigned = 0, inTransit = 0, completedToday = 0, cancelledToday = 0, delayed = 0, highValue = 0;
        const today = new Date().toDateString(); const now = new Date();
        bks.forEach((b: any) => {
          const created = new Date(b.created_at); const age = (now.getTime() - created.getTime()) / 60000; const price = safeNumber(b.price_estimate);
          if (b.status === "pending") pending++;
          if (b.status === "confirmed") { confirmed++; if (age > 10) delayed++; }
          if (b.status === "driver_assigned") assigned++;
          if (b.status === "in_transit") inTransit++;
          if (b.status === "completed" && created.toDateString() === today) completedToday++;
          if (b.status === "cancelled" && created.toDateString() === today) cancelledToday++;
          if (price >= 3000 && (b.status === "pending" || b.status === "confirmed")) highValue++;
        });
        setBookingPipeline({ pending, confirmed, assigned, inTransit, completedToday, cancelledToday });
        setDelayedBookingsCount(delayed); setHighValueBookingsCount(highValue); confirmedCount = confirmed;
      }

      const { data: apps } = await supabase.from("driver_applications").select("*");
      if (apps) {
        setApplications(apps);
        const docMap: Record<string, string[]> = {};
        for (const app of apps) {
          const { data: docs } = await supabase.from("driver_documents").select("document_type, verification_status").eq("driver_id", app.user_id);
          docMap[app.id] = (docs ?? []).filter((d: any) => d.verification_status === "approved").map((d: any) => d.document_type);
        }
        setApplicationDocStatus(docMap);
      }

      const { data: subs } = await supabase
        .from("driver_subscriptions")
        .select("driver_id, end_date, plan_id, subscription_status")
        .eq("subscription_status", "active");
      if (subs) {
        const expiryMap: Record<string, string | null> = {};
        subs.forEach((s: any) => { expiryMap[s.driver_id] = s.end_date ?? null; });
        setDriverSubExpiry(expiryMap);
      }

      const { count: customers } = await supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "customer");
      setCustomerCount(customers || 0);

      const { count: driversOnline } = await supabase.from("driver_profiles").select("*", { count: "exact", head: true }).eq("online", true);
      setActiveDrivers(driversOnline || 0);
      setDispatchOverload(confirmedCount > (driversOnline || 0));

      const { count: activeJobs } = await supabase.from("bookings").select("*", { count: "exact", head: true }).in("status", ["pending", "confirmed", "driver_assigned", "in_transit"]);
      setActiveBookings(activeJobs || 0);

      const online = driversOnline || 0; const jobs = activeJobs || 0;
      if (online >= jobs) setFleetCapacity("HIGH"); else if (online >= jobs * 0.5) setFleetCapacity("MEDIUM"); else setFleetCapacity("LOW");

      // commission_ledger column is `commission_amount`, not `amount`.
      const { data: commissionRows } = await supabase.from("commission_ledger").select("commission_amount");
      const { data: subscriptionPaymentRows } = await supabase.from("subscription_payments").select("amount");
      let revenueSum = 0;
      commissionRows?.forEach((r: any) => { revenueSum += safeNumber(r.commission_amount); });
      subscriptionPaymentRows?.forEach((r: any) => { revenueSum += safeNumber(r.amount); });
      setTotalRevenue(revenueSum);

      let activityFeed: any[] = [];
      const { data: latestBookings } = await supabase.from("bookings").select("id, status, driver_id, created_at").order("created_at", { ascending: false }).limit(3);
      latestBookings?.forEach((b: any) => {
        const msgs: Record<string, string> = { pending: "🕓 New booking requested", confirmed: "✅ Booking confirmed", driver_assigned: "🚚 Driver assigned", in_transit: "📦 Delivery in progress", completed: "🎉 Booking completed", cancelled: "❌ Booking cancelled" };
        activityFeed.push({ id: `booking-${b.id}`, message: msgs[b.status] || `Booking: ${b.status}`, created_at: b.created_at });
      });
      activityFeed.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setRecentActivity(activityFeed.slice(0, 8));

      await loadRevenueStats();
      await loadPlatformSettings();
    } catch (err) { console.log("Admin load error:", err); }
  }

  async function loadRevenueStats() {
    const { data: ledgerData } = await supabase.from("commission_ledger").select("commission_amount, created_at");
    const { data: subPayData } = await supabase.from("subscription_payments").select("amount, created_at");
    const { data: escrowData } = await supabase.from("escrow_payments").select("status, driver_earning, created_at");
    const today = new Date();
    const sameMonthYear = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
    let todayRevenue = 0, weekRevenue = 0, monthRevenue = 0, commission = 0, pending = 0, released = 0;
    ledgerData?.forEach((p: any) => {
      const created = new Date(p.created_at); const amt = safeNumber(p.commission_amount);
      if (created.toDateString() === today.toDateString()) todayRevenue += amt;
      if (today.getTime() - created.getTime() < 7 * 86400000) weekRevenue += amt;
      if (sameMonthYear(created, today)) monthRevenue += amt;
      commission += amt;
    });
    subPayData?.forEach((p: any) => {
      const created = new Date(p.created_at); const amt = safeNumber(p.amount);
      if (created.toDateString() === today.toDateString()) todayRevenue += amt;
      if (today.getTime() - created.getTime() < 7 * 86400000) weekRevenue += amt;
      if (sameMonthYear(created, today)) monthRevenue += amt;
    });
    escrowData?.forEach((p: any) => {
      if (p.status === "escrow") pending += safeNumber(p.driver_earning);
      if (p.status === "released") released += safeNumber(p.driver_earning);
    });
    setRevenueStats({ today: todayRevenue, week: weekRevenue, month: monthRevenue, totalCommission: commission, pendingEscrow: pending, releasedToDrivers: released });
  }

  async function loadBookingTimeline(bookingId: string) {
    let events: any[] = [];
    const { data: bookingUpdates } = await supabase.from("booking_updates").select("status, created_at").eq("booking_id", bookingId);
    bookingUpdates?.forEach((u: any) => events.push({ time: u.created_at, message: `📋 Booking status → ${u.status}` }));
    // dispatch_logs schema has `response` (driver's response), not `event_type`.
    const { data: dispatchEvents } = await supabase.from("dispatch_logs").select("response, created_at").eq("booking_id", bookingId);
    dispatchEvents?.forEach((d: any) => events.push({ time: d.created_at, message: `🚚 Dispatch: ${d.response ?? "notified"}` }));
    const { data: escrowEvents } = await supabase.from("escrow_payments").select("status, created_at").eq("booking_id", bookingId);
    escrowEvents?.forEach((e: any) => events.push({ time: e.created_at, message: `🔐 Escrow: ${e.status}` }));
    events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    setTimelineEvents(events);
  }

  async function loadPlatformSettings() {
    const { data } = await supabase.from("platform_config").select("*");
    if (!data) return;
    const map: Record<string, string> = {};
    data.forEach((row: any) => { map[row.config_key] = row.config_value; });
    setPlatformSettings(map);
  }

  async function updateSetting(key: string, value: string) {
    await supabase.from("platform_config").update({ config_value: value }).eq("config_key", key);
    setPlatformSettings(prev => ({ ...prev, [key]: value }));
  }

  async function updateDriverStatus(id: string, status: string) {
    await supabase.from("driver_profiles").update({ status }).eq("id", id);
    loadData();
  }

  async function assignPlan(driverId: string, plan: string) {
    await supabase.from("driver_subscriptions").insert({ driver_id: driverId, plan });
    loadData();
  }

  async function releasePayment(booking: any) {
    const driverId = booking.driver_id; const driverEarning = safeNumber(booking.price_estimate);
    // RPC parameter names per schema: p_driver_id, p_amount.
    const { error: rpcErr } = await supabase.rpc("increment_driver_wallet", { p_driver_id: driverId, p_amount: driverEarning });
    if (rpcErr) { alert("Release failed: " + rpcErr.message); return; }
    await supabase.from("driver_wallet_transactions").insert({ driver_id: driverId, booking_id: booking.id, type: "escrow_release", amount: driverEarning });
    await supabase.from("escrow_payments").update({ status: "released" }).eq("booking_id", booking.id);
    await supabase.from("bookings").update({ payment_status: "released" }).eq("id", booking.id);
    alert("Driver wallet credited"); loadData();
  }

  async function refundPayment(booking: any) {
    const refundAmount = calculateRefundAmount(booking); const driverId = booking.driver_id;
    if (refundAmount === 0) { alert("Refund not allowed"); return; }
    const { error: rpcErr } = await supabase.rpc("decrement_driver_wallet", { p_driver_id: driverId, p_amount: refundAmount });
    if (rpcErr) { alert("Refund failed: " + rpcErr.message); return; }
    await supabase.from("driver_wallet_transactions").insert({ driver_id: driverId, booking_id: booking.id, type: "refund_reversal", amount: refundAmount });
    await supabase.from("escrow_payments").update({ status: "refunded", refund_amount: refundAmount }).eq("booking_id", booking.id);
    alert("Refund processed safely"); loadData();
  }

  async function applyManualRefund() {
    if (!selectedBooking) return;
    await supabase.from("bookings").update({ manual_refund_percent: manualRefundPercent }).eq("id", selectedBooking.id);
    alert("Manual refund override applied"); setSelectedBooking(null); loadData();
  }

  /* ── Filter helpers for the Drivers tab ──────────────────── */
  const filteredDrivers = useMemo(() => {
    const q = driverSearch.trim().toLowerCase();
    return drivers.filter((d: any) => {
      if (driverFilterStatus !== "all" && d.status !== driverFilterStatus) return false;
      if (driverFilterOnline === "online"  && d.online !== true) return false;
      if (driverFilterOnline === "offline" && d.online === true) return false;
      if (q) {
        const hay = `${d.full_name ?? ""} ${d.phone ?? ""} ${d.user_id ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [drivers, driverSearch, driverFilterStatus, driverFilterOnline]);

  /* ── CSV export handlers ──────────────────────────────────── */
  function exportDriversCsv() {
    const rows = filteredDrivers.map((d: any) => ({
      id:                 d.id,
      user_id:            d.user_id,
      full_name:          d.full_name,
      phone:              d.phone,
      status:             d.status,
      online:             d.online,
      subscription_plan:  d.driver_subscriptions?.[0]?.plan ?? null,
      expiry:             driverSubExpiry[d.user_id ?? d.id] ?? null,
    }));
    downloadCsv(`flyttgo-drivers-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  function exportBookingsCsv() {
    const rows = bookings.map((b: any) => ({
      id:               b.id,
      created_at:       b.created_at,
      customer_id:      b.customer_id,
      driver_id:        b.driver_id,
      pickup_address:   b.pickup_address,
      dropoff_address:  b.dropoff_address,
      van_type:         b.van_type,
      status:           b.status,
      payment_status:   b.payment_status,
      price_estimate:   b.price_estimate,
      final_price:      b.final_price,
      estimated_hours:  b.estimated_hours,
      distance_km:      b.distance_km,
    }));
    downloadCsv(`flyttgo-bookings-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  /* ── Manual booking dispatch ──────────────────────────────
   * Admin picks a driver from a dropdown and force-assigns a
   * pending booking to them. Sets bookings.driver_id and flips
   * status to 'driver_assigned'. Skips the usual dispatch_logs
   * flow because this is an admin override — the audit trail
   * lives in bookings.updated_at / driver_id change. */
  async function dispatchBookingToDriver() {
    if (!dispatchBooking || !dispatchDriverId) return;
    const { error } = await supabase
      .from("bookings")
      .update({ driver_id: dispatchDriverId, status: "driver_assigned" })
      .eq("id", dispatchBooking.id);
    if (error) {
      alert("Dispatch failed: " + error.message);
      return;
    }
    alert("Booking dispatched to driver.");
    setDispatchBooking(null);
    setDispatchDriverId("");
    loadData();
  }

  async function handleApplication(applicationId: string, action: string) {
    /* reviewed_by is a FK to auth.users(id), so we need a real
     * admin user id before we can write the review. If the session
     * has silently dropped, bail early — the admin panel will show
     * the "access required" screen on next render anyway. */
    if (!user) return;
    const { data: app } = await supabase.from("driver_applications").select("*").eq("id", applicationId).single();
    if (!app) return;

    /* Rejections must capture a reason so the driver's status page
     * can tell them what to fix. We prompt via window.prompt() for
     * speed — a full modal would be nicer but this lands the feature
     * in one line. Cancel / empty string aborts the rejection. */
    let rejectionReason: string | null = null;
    if (action === "rejected") {
      const entered = window.prompt(
        "Reason for rejection (visible to the driver on their status page):",
        ""
      );
      if (entered === null) return;                 // cancel
      if (entered.trim().length === 0) {
        alert("Please enter a rejection reason so the driver knows what to fix.");
        return;
      }
      rejectionReason = entered.trim();
    }

    /* Capture the audit trail: who reviewed + when. reviewed_by
     * references auth.users; reviewed_at is a timestamptz. Both
     * columns are added by docs/fix-driver-onboarding-pipeline.sql.
     * user.id is guaranteed non-null here because of the guard
     * at the top of this function. */
    const reviewPayload: Record<string, any> = {
      status:      action,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    };
    if (action === "rejected") {
      reviewPayload.rejection_reason = rejectionReason;
    } else {
      /* Clear any previous rejection reason on re-approval. */
      reviewPayload.rejection_reason = null;
    }

    await supabase.from("driver_applications").update(reviewPayload).eq("id", applicationId);
    if (action !== "approved") { loadData(); return; }
    const { data: docs } = await supabase.from("driver_documents").select("document_type, verification_status").eq("driver_id", app.user_id);
    const approvedDocs = (docs ?? []).filter((d: any) => d.verification_status === "approved").map((d: any) => d.document_type);
    const missingDocs = REQUIRED_DOCS.filter(doc => !approvedDocs.includes(doc));
    if (missingDocs.length > 0) { alert("Driver cannot be activated.\nMissing approvals for:\n" + missingDocs.map(d => DOCUMENT_TYPE_LABELS[d] ?? d).join(", ")); return; }
    await supabase.from("driver_profiles").insert({ user_id: app.user_id, full_name: `${app.first_name} ${app.last_name}`, phone: app.phone, status: "approved", online: false });
    /* sync_profile_role_on_driver_approval trigger auto-flips
     * profiles.role from 'customer' to 'driver' here. */
    alert("✅ Driver activated successfully."); loadData();
  }

  async function loadApplicationDocuments(applicationId: string) {
    // driver_documents is keyed by driver_id (the auth user's id), not application_id.
    const app = applications.find((a: any) => a.id === applicationId);
    if (!app?.user_id) { setAppDocuments([]); return; }
    const { data, error } = await supabase
      .from("driver_documents")
      .select("id, document_type, file_url, verification_status, uploaded_at")
      .eq("driver_id", app.user_id)
      .order("uploaded_at", { ascending: true });
    setAppDocuments(error || !data ? [] : data);
  }

  function getDocumentUrl(storagePath: string): string {
    return supabase.storage.from("driver-documents").getPublicUrl(storagePath).data.publicUrl;
  }

  if (loading || !profile || profile.role !== "admin") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Admin Access Required</h2>
          <p className="text-gray-500">You need admin credentials to access this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-64 bg-gray-900 text-white flex-shrink-0">
        <div className="p-6 font-bold text-lg">FlyttGo Admin</div>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`block w-full text-left px-6 py-3 capitalize ${tab === t ? "bg-emerald-600" : "hover:bg-gray-800"}`}>{t}</button>
        ))}
      </aside>

      <main className="flex-1 p-6 overflow-auto">

        {tab === "overview" && (
          <div>
            <h1 className="text-2xl font-bold mb-6">FlyttGo Operations Control Center</h1>
            {fleetCapacity === "LOW" && <div className="mb-4 bg-red-50 border border-red-300 text-red-700 px-6 py-4 rounded-lg"><strong>⚠️ Driver shortage detected</strong></div>}
            {delayedBookingsCount > 0 && <div className="mb-4 bg-yellow-50 border border-yellow-300 text-yellow-800 px-6 py-4 rounded-lg">⚠️ <strong>{delayedBookingsCount} delayed bookings</strong> waiting assignment for over 10 minutes</div>}
            {highValueBookingsCount > 0 && <div className="mb-4 bg-purple-50 border border-purple-300 text-purple-800 px-6 py-4 rounded-lg">💎 <strong>{highValueBookingsCount} high-value bookings</strong> (3000+ NOK) waiting drivers</div>}
            {dispatchOverload && <div className="mb-4 bg-orange-50 border border-orange-300 text-orange-800 px-6 py-4 rounded-lg">🚨 <strong>Dispatch overload:</strong> More confirmed bookings than online drivers</div>}

            <h2 className="mt-6 font-bold text-gray-700">Driver Status Monitor</h2>
            <div className="grid grid-cols-4 gap-4 mt-2">
              <Card title="Online Drivers" value={driverStatusStats.online} isCurrency={false}/>
              <Card title="Busy Drivers" value={driverStatusStats.busy} isCurrency={false}/>
              <Card title="Pending Approval" value={driverStatusStats.pending} isCurrency={false}/>
              <Card title="Suspended Drivers" value={driverStatusStats.suspended} isCurrency={false}/>
            </div>

            <h2 className="mt-8 font-bold text-gray-700">Fleet Capacity</h2>
            <div className="bg-white rounded p-6 flex items-center justify-between mt-2">
              <p className="text-2xl font-bold">{fleetCapacity === "HIGH" ? "🟢 HIGH CAPACITY" : fleetCapacity === "MEDIUM" ? "🟡 MEDIUM CAPACITY" : "🔴 LOW CAPACITY"}</p>
              <div className="text-sm text-gray-400">Based on online drivers vs active bookings</div>
            </div>

            <h2 className="mt-8 font-bold text-gray-700">Platform Metrics</h2>
            <div className="grid grid-cols-4 gap-4 mt-2">
              <Card title="Drivers" value={drivers.length} isCurrency={false}/>
              <Card title="Bookings" value={bookings.length} isCurrency={false}/>
              <Card title="Applications" value={applications.length} isCurrency={false}/>
              <Card title="Customers" value={customerCount} isCurrency={false}/>
              <Card title="Active Drivers" value={activeDrivers} isCurrency={false}/>
              <Card title="Active Bookings" value={activeBookings} isCurrency={false}/>
              <Card title="Total Revenue" value={totalRevenue}/>
            </div>

            <h2 className="mt-8 font-bold text-gray-700">Booking Pipeline</h2>
            <div className="grid grid-cols-3 gap-4 mt-2">
              <Card title="Pending" value={bookingPipeline.pending} isCurrency={false}/>
              <Card title="Confirmed" value={bookingPipeline.confirmed} isCurrency={false}/>
              <Card title="Driver Assigned" value={bookingPipeline.assigned} isCurrency={false}/>
              <Card title="In Transit" value={bookingPipeline.inTransit} isCurrency={false}/>
              <Card title="Completed Today" value={bookingPipeline.completedToday} isCurrency={false}/>
              <Card title="Cancelled Today" value={bookingPipeline.cancelledToday} isCurrency={false}/>
            </div>

            <h2 className="mt-8 font-bold text-gray-700">Revenue Dashboard</h2>
            <div className="grid grid-cols-3 gap-4 mt-2">
              <Card title="Today" value={revenueStats.today}/>
              <Card title="Week" value={revenueStats.week}/>
              <Card title="Month" value={revenueStats.month}/>
              <Card title="Commission" value={revenueStats.totalCommission}/>
              <Card title="Escrow Pending" value={revenueStats.pendingEscrow}/>
              <Card title="Released" value={revenueStats.releasedToDrivers}/>
            </div>

            <h2 className="mt-8 font-bold text-gray-700">Recent Activity</h2>
            <div className="bg-white rounded p-4 mt-2">
              {recentActivity.length === 0 ? <div className="text-gray-500 text-sm">No recent activity yet</div> : recentActivity.map((item: any) => (
                <div key={item.id} className="border-b py-2 text-sm">{item.message}</div>
              ))}
            </div>
          </div>
        )}

        {tab === "fleet-map" && (
          <div>
            <Suspense fallback={
              <div className="bg-gray-100 rounded-xl h-[600px] animate-pulse flex items-center justify-center text-gray-400 text-sm">
                Loading fleet map…
              </div>
            }>
              <FleetMap
                onSuspendDriver={(id) => {
                  if (confirm("Suspend this driver?")) updateDriverStatus(id, "suspended");
                }}
              />
            </Suspense>
          </div>
        )}

        {tab === "drivers" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-xl font-bold">Drivers ({filteredDrivers.length})</h1>
              <button
                onClick={exportDriversCsv}
                className="bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded text-xs font-semibold"
              >
                Export CSV
              </button>
            </div>

            {/* Search + filters */}
            <div className="bg-white rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
                <input
                  type="text"
                  value={driverSearch}
                  onChange={e => setDriverSearch(e.target.value)}
                  placeholder="Name, phone, or id"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <select
                  value={driverFilterStatus}
                  onChange={e => setDriverFilterStatus(e.target.value as any)}
                  className="border border-gray-200 rounded px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Online</label>
                <select
                  value={driverFilterOnline}
                  onChange={e => setDriverFilterOnline(e.target.value as any)}
                  className="border border-gray-200 rounded px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                </select>
              </div>
              {(driverSearch || driverFilterStatus !== "all" || driverFilterOnline !== "all") && (
                <button
                  onClick={() => { setDriverSearch(""); setDriverFilterStatus("all"); setDriverFilterOnline("all"); }}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Clear filters
                </button>
              )}
            </div>

            <table className="w-full bg-white rounded shadow">
              <thead className="bg-gray-100"><tr><th className="p-3 text-left">Name</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Online</th><th className="p-3 text-left">Plan / Expiry</th><th className="p-3 text-left">Actions</th></tr></thead>
              <tbody>
                {filteredDrivers.map((d: any) => {
                  const endDate = driverSubExpiry[d.user_id ?? d.id] ?? null;
                  const daysLeft = endDate ? Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000) : null;
                  return (
                    <tr key={d.id} className="border-t">
                      <td className="p-3">{d.full_name || d.id}</td>
                      <td className="p-3">{d.status}</td>
                      <td className="p-3">{d.online ? "🟢 Yes" : "⚫ No"}</td>
                      <td className="p-3">
                        <div>{d.driver_subscriptions?.[0]?.plan || "—"}</div>
                        {daysLeft !== null && <div className={`text-xs mt-0.5 ${daysLeft <= 3 ? "text-red-500 font-semibold" : daysLeft <= 7 ? "text-orange-500" : "text-gray-400"}`}>{daysLeft > 0 ? `Expires in ${daysLeft}d` : "⚠️ Expired"}</div>}
                      </td>
                      <td className="p-3 flex gap-2 flex-wrap">
                        <button onClick={() => updateDriverStatus(d.id, "approved")} className="bg-emerald-600 text-white px-2 py-1 text-xs rounded">Approve</button>
                        <button onClick={() => updateDriverStatus(d.id, "suspended")} className="bg-red-600 text-white px-2 py-1 text-xs rounded">Suspend</button>
                        <button onClick={() => assignPlan(d.id, "premium")} className="bg-blue-600 text-white px-2 py-1 text-xs rounded">Assign Premium</button>
                      </td>
                    </tr>
                  );
                })}
                {filteredDrivers.length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-sm text-gray-500">No drivers match your filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "bookings" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-xl font-bold">Bookings ({bookings.length})</h1>
              <button
                onClick={exportBookingsCsv}
                className="bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded text-xs font-semibold"
              >
                Export CSV
              </button>
            </div>
            <table className="w-full bg-white rounded shadow">
              <thead className="bg-gray-100"><tr><th className="p-3 text-left">Route</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Price</th><th className="p-3 text-left">Payment</th><th className="p-3 text-left">Actions</th></tr></thead>
              <tbody>
                {bookings.map((b: any) => (
                  <tr key={b.id} className={`border-t relative ${b.payment_status === "released" ? "bg-green-50" : b.payment_status === "refunded" ? "bg-red-50" : b.payment_status === "escrow" ? "bg-yellow-50" : ""}`}>
                    <td className="p-3">{b.pickup_address} → {b.dropoff_address}</td>
                    <td className="p-3">{b.status}</td>
                    <td className="p-3">{safeNumber(b.price_estimate).toFixed(0)} NOK</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${b.payment_status === "released" ? "bg-green-100 text-green-700" : b.payment_status === "escrow" ? "bg-yellow-100 text-yellow-700" : b.payment_status === "refunded" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                        {b.payment_status || "pending"}
                      </span>
                    </td>
                    <td className="p-3 flex gap-2 flex-wrap">
                      {/* Manual dispatch — only shown for unassigned,
                       * non-cancelled bookings. Opens a modal where
                       * the admin picks a driver to force-assign. */}
                      {!b.driver_id && b.status !== "cancelled" && b.status !== "completed" && (
                        <button
                          onClick={() => { setDispatchBooking(b); setDispatchDriverId(""); }}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 text-xs rounded"
                        >
                          Dispatch
                        </button>
                      )}
                      <button disabled={b.payment_status === "released"} onClick={() => releasePayment(b)} className={`px-2 py-1 text-xs rounded text-white ${b.payment_status === "released" ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"}`}>{b.payment_status === "released" ? "Released ✅" : "Release"}</button>
                      <button onClick={() => refundPayment(b)} className="bg-red-600 text-white px-2 py-1 text-xs rounded">Refund</button>
                      <button onClick={() => { setSelectedBooking(b); setManualRefundPercent(0); }} className="bg-blue-600 text-white px-2 py-1 text-xs rounded">Dispute</button>
                      <button onClick={() => loadBookingTimeline(b.id)} className="bg-gray-700 text-white px-2 py-1 text-xs rounded">Timeline</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "applications" && (
          <div>
            <h1 className="text-xl font-bold mb-4">Driver Applications</h1>
            <table className="w-full bg-white rounded shadow">
              <thead className="bg-gray-100"><tr><th className="p-3 text-left">ID</th><th className="p-3 text-left">Status / Docs</th><th className="p-3 text-left">Applied</th><th className="p-3 text-left">Actions</th></tr></thead>
              <tbody>
                {applications.map((app: any) => (
                  <tr key={app.id} className="border-t">
                    <td className="p-3 text-xs text-gray-500">{app.id}</td>
                    <td className="p-3">
                      <div className="text-xs font-medium text-gray-700 mb-1">{app.status}</div>
                      <div className="flex flex-wrap gap-1">
                        {REQUIRED_DOCS.map(doc => {
                          const approved = applicationDocStatus[app.id]?.includes(doc);
                          return <span key={doc} className={`px-2 py-0.5 text-xs rounded font-medium ${approved ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{doc.replace(/_/g, " ")}{approved ? " ✔" : ""}</span>;
                        })}
                      </div>
                    </td>
                    <td className="p-3 text-sm">{new Date(app.created_at).toLocaleDateString()}</td>
                    <td className="p-3 flex gap-2 flex-wrap">
                      <button onClick={() => handleApplication(app.id, "approved")} className="bg-emerald-600 text-white px-2 py-1 text-xs rounded hover:bg-emerald-700">Approve</button>
                      <button onClick={() => handleApplication(app.id, "rejected")} className="bg-red-600 text-white px-2 py-1 text-xs rounded">Reject</button>
                      <button onClick={async () => { setSelectedApplication(app); await loadApplicationDocuments(app.id); }} className="bg-gray-700 text-white px-2 py-1 text-xs rounded">View Docs</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "revenue" && (
          <div>
            <h1 className="text-xl font-bold mb-4">Revenue</h1>
            <div className="grid grid-cols-3 gap-4">
              <Card title="Today" value={revenueStats.today}/><Card title="This Week" value={revenueStats.week}/><Card title="This Month" value={revenueStats.month}/>
              <Card title="Total Commission" value={revenueStats.totalCommission}/><Card title="Pending Escrow" value={revenueStats.pendingEscrow}/><Card title="Released to Drivers" value={revenueStats.releasedToDrivers}/>
            </div>
          </div>
        )}

        {tab === "disputes" && (
          <div>
            <h1 className="text-xl font-bold mb-4">Disputes</h1>
            <table className="w-full bg-white rounded shadow">
              <thead className="bg-gray-100"><tr><th className="p-3 text-left">Route</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Price</th><th className="p-3 text-left">Actions</th></tr></thead>
              <tbody>
                {bookings.map((b: any) => (
                  <tr key={b.id} className="border-t">
                    <td className="p-3">{b.pickup_address} → {b.dropoff_address}</td>
                    <td className="p-3">{b.status}</td>
                    <td className="p-3">{safeNumber(b.price_estimate).toFixed(0)} NOK</td>
                    <td className="p-3"><button onClick={() => { setSelectedBooking(b); setManualRefundPercent(0); setTab("disputes"); }} className="bg-blue-600 text-white px-2 py-1 text-xs rounded">Open Dispute</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "settings" && (
          <div>
            <h1 className="text-xl font-bold mb-6">Platform Settings</h1>
            <div className="bg-white rounded-lg shadow p-6 space-y-8">
              <div>
                <h2 className="text-lg font-bold text-gray-800 mb-4">Platform Pricing</h2>
                <div className="grid grid-cols-2 gap-4">
                  {[{ key: "base_price_per_km", label: "Price per KM (NOK)", placeholder: "e.g. 12.50" }, { key: "minimum_booking_price", label: "Minimum Booking Price (NOK)", placeholder: "e.g. 299" }, { key: "commission_rate", label: "Commission Rate (%)", placeholder: "e.g. 15" }].map(field => (
                    <div key={field.key}>
                      <label className="block text-sm font-medium text-gray-600 mb-1">{field.label}</label>
                      <input value={platformSettings[field.key] || ""} onChange={e => updateSetting(field.key, e.target.value)} placeholder={field.placeholder} className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 outline-none text-sm"/>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-800 mb-4">Marketplace Controls</h2>
                <div className="space-y-3">
                  {[{ key: "driver_auto_approval", label: "Auto-approve drivers" }, { key: "escrow_enabled", label: "Escrow enabled" }, { key: "surge_enabled", label: "Surge pricing enabled" }, { key: "wallet_enabled", label: "Driver wallet enabled" }, { key: "subscriptions_enabled", label: "Subscriptions enabled" }].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-3 cursor-pointer select-none">
                      <input type="checkbox" checked={platformSettings[key] === "true"} onChange={e => updateSetting(key, String(e.target.checked))} className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"/>
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Document Viewer Panel */}
      {selectedApplication && (
        <div className="fixed bottom-6 right-6 bg-white shadow-2xl rounded-lg p-6 z-50 w-96">
          <h3 className="font-bold text-gray-800 mb-1">📄 Application Documents</h3>
          <p className="text-xs text-gray-500 mb-4">Application ID: {selectedApplication.id}</p>
          {appDocuments.length === 0 ? <p className="text-sm text-gray-500 mb-4">No documents uploaded yet.</p> : (
            <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
              {appDocuments.map((doc: any) => (
                <div key={doc.id} className="p-3 border border-gray-100 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-700">{DOCUMENT_TYPE_LABELS[doc.document_type] ?? doc.document_type}</div>
                      <div className="text-xs text-gray-400">{new Date(doc.created_at).toLocaleDateString()}</div>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded font-medium ${doc.verification_status === "approved" ? "bg-green-100 text-green-700" : doc.verification_status === "rejected" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>{doc.verification_status ?? "pending"}</span>
                  </div>
                  <div className="flex gap-2">
                    <a href={getDocumentUrl(doc.file_url)} target="_blank" rel="noopener noreferrer" className="bg-emerald-600 text-white px-3 py-1 text-xs rounded hover:bg-emerald-700 transition">View</a>
                    <button onClick={async () => { await supabase.from("driver_documents").update({ verification_status: "approved" }).eq("id", doc.id); loadApplicationDocuments(selectedApplication.id); }} className="bg-green-600 text-white px-2 py-1 text-xs rounded">Approve</button>
                    <button onClick={async () => { await supabase.from("driver_documents").update({ verification_status: "rejected" }).eq("id", doc.id); loadApplicationDocuments(selectedApplication.id); }} className="bg-red-600 text-white px-2 py-1 text-xs rounded">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => { setSelectedApplication(null); setAppDocuments([]); }} className="w-full bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm">Close</button>
        </div>
      )}

      {/* Dispute Panel */}
      {selectedBooking && (
        <div className="fixed bottom-6 right-6 bg-white shadow-2xl rounded-lg p-6 z-50 w-80">
          <h3 className="font-bold text-gray-800 mb-1">Manual Refund Override</h3>
          <p className="text-xs text-gray-500 mb-3">Booking: {selectedBooking.pickup_address} → {selectedBooking.dropoff_address}</p>
          <p className="text-xs text-gray-500 mb-3">Price: {safeNumber(selectedBooking.price_estimate).toFixed(0)} NOK</p>
          <label className="block text-sm font-medium mb-1">Refund %</label>
          <input type="number" min={0} max={100} value={manualRefundPercent} onChange={e => setManualRefundPercent(Number(e.target.value))} className="border rounded w-full px-3 py-2 mb-3"/>
          <p className="text-sm text-gray-600 mb-3">Refund amount: <strong>{(safeNumber(selectedBooking.price_estimate) * (manualRefundPercent / 100)).toFixed(0)} NOK</strong></p>
          <div className="flex gap-2">
            <button onClick={applyManualRefund} className="flex-1 bg-emerald-600 text-white px-3 py-2 rounded text-sm">Apply</button>
            <button onClick={() => setSelectedBooking(null)} className="flex-1 bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Timeline Panel */}
      {timelineEvents.length > 0 && (
        <div className="fixed bottom-6 left-6 bg-white shadow-2xl rounded-lg p-6 z-50 w-96">
          <h3 className="font-bold text-gray-800 mb-3">🎬 Booking Timeline Replay</h3>
          <div className="max-h-80 overflow-y-auto text-sm">
            {timelineEvents.map((e, i) => (
              <div key={i} className="border-b py-2">
                <div className="text-gray-400 text-xs">{new Date(e.time).toLocaleString()}</div>
                <div className="text-gray-800">{e.message}</div>
              </div>
            ))}
          </div>
          <button onClick={() => setTimelineEvents([])} className="mt-3 w-full bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm">Close</button>
        </div>
      )}

      {/* Manual Dispatch Modal — full-screen centred */}
      {dispatchBooking && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
          onClick={() => { setDispatchBooking(null); setDispatchDriverId(""); }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-gray-900 text-lg mb-1">Manual Dispatch</h3>
            <p className="text-xs text-gray-500 mb-4">
              Force-assign this booking to a driver. This bypasses the normal dispatch flow — use when a booking has been waiting too long or you need to move a job to a specific driver.
            </p>
            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs">
              <div className="font-semibold text-gray-800 mb-1 truncate">
                {dispatchBooking.pickup_address} → {dispatchBooking.dropoff_address}
              </div>
              <div className="text-gray-500">
                {safeNumber(dispatchBooking.price_estimate).toFixed(0)} NOK · {dispatchBooking.van_type ?? "any van"}
              </div>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select driver</label>
            <select
              value={dispatchDriverId}
              onChange={e => setDispatchDriverId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm mb-4 focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">— pick a driver —</option>
              {drivers
                .filter((d: any) => d.status === "approved")
                .sort((a: any, b: any) => {
                  /* Online drivers first, then by name. */
                  if (a.online && !b.online) return -1;
                  if (!a.online && b.online) return 1;
                  return (a.full_name ?? "").localeCompare(b.full_name ?? "");
                })
                .map((d: any) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name || d.id.slice(0, 8)} {d.online ? "🟢" : "⚫"}
                    {d.driver_subscriptions?.[0]?.plan ? ` · ${d.driver_subscriptions[0].plan}` : ""}
                  </option>
                ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={dispatchBookingToDriver}
                disabled={!dispatchDriverId}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg text-sm font-semibold"
              >
                Dispatch now
              </button>
              <button
                onClick={() => { setDispatchBooking(null); setDispatchDriverId(""); }}
                className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
