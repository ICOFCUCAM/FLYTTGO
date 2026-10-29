// ============================================================================
// FlyttGo — shared server-side pricing
// ============================================================================
//
// The one copy of the pricing formula, routing fallback, commission
// brackets and driver-plan prices that the Edge Functions use. Before
// this module each function carried its own mirror; calculate-price,
// process-payment, create-checkout-session and create-vipps-session now
// import from here so the amount a customer is charged and the amount
// a driver is credited come from the same code.
//
// No Deno or network imports at module level: the module is plain
// TypeScript so the Vitest suite (src/test/server-pricing.test.ts) can
// exercise it under Node. The browser preview formula in
// src/lib/constants.ts must stay in step with PRICING below.
// ============================================================================

export const VAN_HOURLY_RATES: Record<string, number> = {
  small_van:  850,
  medium_van: 1150,
  large_van:  1500,
  luton_van:  1900,
};

export const PRICING = {
  minimumHours: 2,
  distancePricing: { includedKm: 20, extraPerKm: 8 },
  extras: {
    extra_helper:          350,
    furniture_assembly:    250,
    cleaning:              400,
    parking_assistance:    200,
    packing_service:       500,
    furniture_dismantling: 300,
  } as Record<string, number>,
  vat: 0.25,
};

/* ─── Routing ──────────────────────────────────────────────────── */

export interface RouteResult {
  distance_km:      number;
  duration_minutes: number;
  provider:         'OSRM' | 'haversine-fallback';
}

/**
 * Straight-line great-circle distance × 1.4 (Norway road factor),
 * ~70 km/h. Used when OSRM is unreachable.
 */
export function haversineFallback(lat1: number, lng1: number, lat2: number, lng2: number): RouteResult {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const straightKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance_km      = Math.round(straightKm * 1.4 * 10) / 10;
  const duration_minutes = Math.round(distance_km * 0.86);
  return { distance_km, duration_minutes, provider: 'haversine-fallback' };
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean; status: number; json: () => Promise<any>;
}>;

/** Real driving distance via OSRM. Throws on any failure. */
export async function osrmRoute(
  lat1: number, lng1: number, lat2: number, lng2: number,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<RouteResult> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${lng1},${lat1};${lng2},${lat2}?overview=false&alternatives=false&steps=false`;
  const res = await fetchFn(url, { headers: { 'User-Agent': 'FlyttGo/1.0 (+https://flyttgo.no)' } });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number') {
    throw new Error('OSRM returned no route');
  }
  return {
    distance_km:      Math.round((route.distance / 1000) * 10) / 10,
    duration_minutes: Math.round(route.duration / 60),
    provider:         'OSRM',
  };
}

/** OSRM first, haversine × 1.4 if it fails. Never throws. */
export async function routeDistance(
  lat1: number, lng1: number, lat2: number, lng2: number,
  fetchFn?: FetchLike,
): Promise<RouteResult> {
  try {
    return await osrmRoute(lat1, lng1, lat2, lng2, fetchFn);
  } catch (err) {
    console.warn('OSRM failed, falling back to haversine:', (err as Error).message);
    return haversineFallback(lat1, lng1, lat2, lng2);
  }
}

/* ─── Price formula ────────────────────────────────────────────── */

export interface PriceBreakdown {
  base_price:      number;
  distance_charge: number;
  helpers_charge:  number;
  extras_charge:   number;
  subtotal:        number;
  vat:             number;
  total:           number;
}

export function calculateServerPrice(params: {
  vanType:    string;
  hours:      number;
  distanceKm: number;
  helpers:    number;
  extras:     string[];
}): PriceBreakdown {
  const safeHours = Math.max(params.hours ?? 0, PRICING.minimumHours);
  const extraKm   = Math.max(0, (params.distanceKm ?? 0) - PRICING.distancePricing.includedKm);

  const base_price      = (VAN_HOURLY_RATES[params.vanType] ?? 850) * safeHours;
  const distance_charge = extraKm * PRICING.distancePricing.extraPerKm;
  const helpers_charge  = (params.helpers ?? 0) * PRICING.extras.extra_helper * safeHours;
  const extras_charge   = (params.extras ?? []).reduce((sum, e) => sum + (PRICING.extras[e] ?? 0), 0);

  const subtotal = base_price + distance_charge + helpers_charge + extras_charge;
  const vat      = subtotal * PRICING.vat;
  return { base_price, distance_charge, helpers_charge, extras_charge, subtotal, vat, total: subtotal + vat };
}

/* ─── Booking charge (what the customer pays) ──────────────────── */

export interface BookingPricingRow {
  van_type?:            string | null;
  estimated_hours?:     number | string | null;
  helpers?:             number | string | null;
  additional_services?: unknown;
  pickup_lat?:          number | string | null;
  pickup_lng?:          number | string | null;
  dropoff_lat?:         number | string | null;
  dropoff_lng?:         number | string | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Coordinates of a booking, or null when any is missing or out of range. */
export function bookingCoordinates(b: BookingPricingRow): [number, number, number, number] | null {
  const c = [num(b.pickup_lat), num(b.pickup_lng), num(b.dropoff_lat), num(b.dropoff_lng)];
  if (c.some(v => v === null)) return null;
  const [plat, plng, dlat, dlng] = c as number[];
  if (Math.abs(plat) > 90 || Math.abs(dlat) > 90 || Math.abs(plng) > 180 || Math.abs(dlng) > 180) return null;
  return [plat, plng, dlat, dlng];
}

function extrasOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string') : [];
}

/**
 * The total (NOK, VAT included, whole kroner) a booking costs, computed
 * from its stored inputs and a server-side route. This is the amount
 * the payment functions charge; nothing the browser sends changes it.
 */
export function bookingChargeNok(b: BookingPricingRow, route: Pick<RouteResult, 'distance_km'>): number {
  const breakdown = calculateServerPrice({
    vanType:    b.van_type ?? 'medium_van',
    hours:      num(b.estimated_hours) ?? PRICING.minimumHours,
    distanceKm: route.distance_km,
    helpers:    Math.max(0, num(b.helpers) ?? 0),
    extras:     extrasOf(b.additional_services),
  });
  return Math.round(breakdown.total);
}

/* ─── Commission (driver payout) ───────────────────────────────── */

export function computeCommission(
  price: number,
  plan:  string,
): { commission: number; earning: number; ratePct: number } {
  const p = Math.max(0, Number(price) || 0);
  if (p <= 500) return { commission: 0, earning: p, ratePct: 0 };
  if (plan === 'unlimited') return { commission: 0, earning: p, ratePct: 0 };

  const BY_PLAN: Record<string, Record<string, number>> = {
    basic:    { low: 20, mid: 15, high: 10 },
    pro_mini: { low: 10, mid:  5, high:  4 },
    pro:      { low: 10, mid:  5, high:  4 },
  };
  const plans = BY_PLAN[plan] ?? BY_PLAN.basic;

  let ratePct = plans.high;
  if      (p <= 1500) ratePct = plans.low;
  else if (p <= 5000) ratePct = plans.mid;

  const commission = Math.round((p * ratePct) / 100);
  return { commission, earning: p - commission, ratePct };
}

/* ─── Driver subscription plans ────────────────────────────────── */

/**
 * Prices ex. VAT, matching PLAN_OPTIONS in src/components/DriverPortal.tsx.
 * The server charges from this table, never from the request body.
 */
export const DRIVER_PLAN_PRICES_EX_VAT: Record<string, number> = {
  free:      0,
  basic:     0,
  pro_mini:  149,
  pro:       1500,
  unlimited: 2449,
};

export const DRIVER_PLAN_LABELS: Record<string, string> = {
  free: 'Free', basic: 'Basic', pro_mini: 'Pro Mini', pro: 'Pro', unlimited: 'Unlimited',
};

export interface CurrentSubscription {
  plan?:                string | null;
  subscription_status?: string | null;
  start_date?:          string | null;
}

export interface SubscriptionCharge {
  planId:      string;
  amountExVat: number;
  vatAmount:   number;
  total:       number;
  prorated:    boolean;
  creditExVat: number;
}

/**
 * What a driver pays to move to `planId`, VAT included. Mirrors
 * DriverPortal.calculateProration: only Pro → Unlimited is prorated,
 * crediting the unused days of the current month on Pro.
 * Returns null for unknown or free plans (nothing to charge).
 */
export function subscriptionCharge(
  planId:  string,
  current: CurrentSubscription | null,
  now:     Date = new Date(),
): SubscriptionCharge | null {
  const price = DRIVER_PLAN_PRICES_EX_VAT[planId];
  if (price === undefined || price <= 0) return null;

  let amountExVat = price;
  let creditExVat = 0;
  let prorated    = false;

  if (planId === 'unlimited' && current?.plan === 'pro' && current?.subscription_status === 'active' && current?.start_date) {
    const start         = new Date(current.start_date);
    const daysInMonth   = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    const daysUsed      = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400000));
    const daysRemaining = Math.max(0, daysInMonth - daysUsed);
    creditExVat = Math.round((DRIVER_PLAN_PRICES_EX_VAT.pro / daysInMonth) * daysRemaining);
    amountExVat = Math.max(0, price - creditExVat);
    prorated    = true;
  }

  const vatAmount = Math.round(amountExVat * PRICING.vat);
  return { planId, amountExVat, vatAmount, total: amountExVat + vatAmount, prorated, creditExVat };
}

/* ─── Webhook amount check ─────────────────────────────────────── */

/**
 * True when a provider-reported payment matches what we asked for:
 * same currency (NOK) and the exact amount in øre.
 */
export function paidAmountMatches(
  paidOre:     number | null | undefined,
  currency:    string | null | undefined,
  expectedNok: number | null | undefined,
): boolean {
  if (paidOre == null || expectedNok == null) return false;
  if (!Number.isFinite(Number(paidOre)) || !Number.isFinite(Number(expectedNok))) return false;
  if ((currency ?? '').toLowerCase() !== 'nok') return false;
  return Math.round(Number(paidOre)) === Math.round(Number(expectedNok) * 100);
}
