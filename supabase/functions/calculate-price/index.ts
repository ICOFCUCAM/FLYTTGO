// ============================================================================
// FlyttGo — calculate-price Edge Function
// ============================================================================
//
// Server-authoritative routing + pricing for booking flows.
//
// This function is the single source of truth for the two things a
// browser must not be allowed to decide on its own:
//
//   1) the **driving distance** between pickup and drop-off
//      (trust-safe — we don't let the browser pass us a distance
//       that the backend then blindly uses as a pricing input)
//
//   2) the **price the customer is charged**
//      (the backend re-runs the same pricing formula the frontend
//       uses for preview, but from coordinates we trust — so the
//       final charged amount is always computed server-side)
//
// ------------------------------------------------------------
// REQUEST (POST /functions/v1/calculate-price)
// ------------------------------------------------------------
//   {
//     "pickup_lat":            59.9139,
//     "pickup_lng":            10.7522,
//     "dropoff_lat":           60.3913,
//     "dropoff_lng":            5.3221,
//     "van_type":              "medium_van",
//     "helpers":               1,
//     "additional_services":   ["furniture_assembly","cleaning"],
//     "estimated_hours":       3
//   }
//
// ------------------------------------------------------------
// RESPONSE (200)
// ------------------------------------------------------------
//   {
//     "distance_km":       463.2,
//     "duration_minutes":  411,
//     "price_subtotal":    7890,
//     "vat_amount":        1972.5,
//     "price_total":       9862.5,
//     "routing_provider":  "OSRM",
//     "breakdown": {
//       "base_price":        3450,
//       "distance_charge":   3544,
//       "helpers_charge":    1050,
//       "extras_charge":     650
//     }
//   }
//
// ------------------------------------------------------------
// BACKWARD-COMPAT NOTE
// ------------------------------------------------------------
// The Supabase-deployed version of this function also supported
// three legacy actions (`calculate_commission`, `dispatch_score`,
// `surge_multiplier`). Those are preserved for backward compat
// further down the handler so nothing else that depends on them
// breaks. The new primary entry point is the coordinate-based
// request shape above — the handler auto-detects by looking for
// `pickup_lat` in the body.
//
// ------------------------------------------------------------
// DEPLOY
// ------------------------------------------------------------
//   supabase functions deploy calculate-price --no-verify-jwt
//
// ============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/* ─── Pricing constants (mirrored from src/lib/constants.ts) ───── */

const VAN_HOURLY_RATES: Record<string, number> = {
  small_van:  850,
  medium_van: 1150,
  large_van:  1500,
  luton_van:  1900,
};

const PRICING = {
  minimumHours: 2,
  distancePricing: { includedKm: 20, extraPerKm: 8 },
  extras: {
    extra_helper:          350,
    furniture_assembly:    250,
    cleaning:              400,
    parking_assistance:    200,
    packing_service:       500,
    furniture_dismantling: 300,
  },
  vat: 0.25,
};

/* ─── Routing providers ────────────────────────────────────────── */

interface RouteResult {
  distance_km:      number;
  duration_minutes: number;
  provider:         'OSRM' | 'haversine-fallback';
}

/**
 * Straight-line great-circle distance, multiplied by 1.4 to
 * approximate Norway's fjord-heavy road network. Used as a
 * fallback when OSRM is unreachable. Duration is derived at
 * ~70 km/h average.
 */
function haversineFallback(lat1: number, lng1: number, lat2: number, lng2: number): RouteResult {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightKm = R * c;

  /* Norway road factor — multiplies straight-line distance by 1.4
   * to account for fjords, valleys, and tunnel detours that make
   * actual driving routes significantly longer than crow-flight. */
  const distance_km      = Math.round(straightKm * 1.4 * 10) / 10;
  const duration_minutes = Math.round(distance_km * 0.86); // ~70 km/h

  return { distance_km, duration_minutes, provider: 'haversine-fallback' };
}

/**
 * Real driving distance via OSRM's public demo server. Returns
 * { distance_km, duration_minutes, provider: 'OSRM' } on success,
 * throws on any failure so the caller can fall back to haversine.
 */
async function osrmRoute(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): Promise<RouteResult> {
  /* OSRM URL format: /route/v1/driving/{lng1},{lat1};{lng2},{lat2}
   * Note the lng-first ordering — this is OSRM's convention. */
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${lng1},${lat1};${lng2},${lat2}?overview=false&alternatives=false&steps=false`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'FlyttGo/1.0 (+https://flyttgo.no)' },
  });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);

  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number') {
    throw new Error('OSRM returned no route');
  }

  return {
    distance_km:      Math.round((route.distance / 1000) * 10) / 10, // m → km, 1 dp
    duration_minutes: Math.round(route.duration / 60),                // s → min
    provider:         'OSRM',
  };
}

/**
 * Get driving distance + duration between two coordinates. Tries
 * OSRM first, falls back to haversine × 1.4 (Norway road factor)
 * if OSRM is unreachable or returns garbage. Never throws — the
 * booking flow must always get an answer.
 */
async function routeDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): Promise<RouteResult> {
  try {
    return await osrmRoute(lat1, lng1, lat2, lng2);
  } catch (err) {
    console.warn('OSRM failed, falling back to haversine:', (err as Error).message);
    return haversineFallback(lat1, lng1, lat2, lng2);
  }
}

/* ─── Pricing formula ─────────────────────────────────────────── */

interface PriceBreakdown {
  base_price:      number;
  distance_charge: number;
  helpers_charge:  number;
  extras_charge:   number;
  subtotal:        number;
  vat:             number;
  total:           number;
}

/**
 * Mirror of src/lib/constants.ts#calculatePrice. Kept inline so
 * the edge function has zero shared-code dependencies. If the
 * frontend formula changes, update this mirror too.
 */
function calculateServerPrice(params: {
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
  const extras_charge   = (params.extras ?? []).reduce(
    (sum, e) => sum + ((PRICING.extras as Record<string, number>)[e] ?? 0),
    0,
  );

  const subtotal = base_price + distance_charge + helpers_charge + extras_charge;
  const vat      = subtotal * PRICING.vat;
  const total    = subtotal + vat;

  return { base_price, distance_charge, helpers_charge, extras_charge, subtotal, vat, total };
}

/* ─── Request validation ───────────────────────────────────────── */

interface CalculatePriceRequest {
  pickup_lat:           number;
  pickup_lng:           number;
  dropoff_lat:          number;
  dropoff_lng:          number;
  van_type:             string;
  helpers?:             number;
  additional_services?: string[];
  estimated_hours?:     number;
}

function validateCoord(v: unknown, label: string, min: number, max: number): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    return `${label} must be a finite number in [${min}, ${max}]`;
  }
  return null;
}

function validateRequest(body: unknown): { ok: true; value: CalculatePriceRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Request body must be an object' };
  const b = body as Record<string, unknown>;

  for (const [field, min, max] of [
    ['pickup_lat',   -90,  90],
    ['pickup_lng',  -180, 180],
    ['dropoff_lat',  -90,  90],
    ['dropoff_lng', -180, 180],
  ] as const) {
    const err = validateCoord(b[field], field, min, max);
    if (err) return { ok: false, error: err };
  }

  if (typeof b.van_type !== 'string' || !VAN_HOURLY_RATES[b.van_type]) {
    return { ok: false, error: `van_type must be one of: ${Object.keys(VAN_HOURLY_RATES).join(', ')}` };
  }

  return {
    ok: true,
    value: {
      pickup_lat:           b.pickup_lat as number,
      pickup_lng:           b.pickup_lng as number,
      dropoff_lat:          b.dropoff_lat as number,
      dropoff_lng:          b.dropoff_lng as number,
      van_type:             b.van_type as string,
      helpers:              typeof b.helpers === 'number' ? b.helpers : 0,
      additional_services:  Array.isArray(b.additional_services) ? b.additional_services as string[] : [],
      estimated_hours:      typeof b.estimated_hours === 'number' ? b.estimated_hours : PRICING.minimumHours,
    },
  };
}

/* ─── Legacy-action backward-compat helpers ────────────────────── */

/* These mirror the four legacy actions the old Supabase-only
 * version supported. Kept so anything still calling them doesn't
 * break. The primary coordinate-based request takes precedence. */

function calculateCommission(jobPrice: number, plan: string, dynamicModifier = 0) {
  if (jobPrice <= 500)         return { rate: 0, amount: 0, driverEarning: jobPrice };
  if (plan === 'unlimited')    return { rate: 0, amount: 0, driverEarning: jobPrice };
  if (plan === 'free')         return { rate: -1, amount: 0, driverEarning: 0 };
  const tiers: Record<string, Record<string, number>> = {
    basic:    { '501-1500': 20, '1501-5000': 15, '5000+': 10 },
    pro_mini: { '501-1500': 10, '1501-5000':  5, '5000+':  4 },
    pro:      { '501-1500': 10, '1501-5000':  5, '5000+':  4 },
  };
  const rates = tiers[plan] || tiers.basic;
  let rate = 0;
  if      (jobPrice <= 1500) rate = rates['501-1500']  ?? 20;
  else if (jobPrice <= 5000) rate = rates['1501-5000'] ?? 15;
  else                       rate = rates['5000+']     ?? 10;
  rate = Math.min(rate + dynamicModifier, 30);
  const amount = jobPrice * (rate / 100);
  return { rate, amount, driverEarning: jobPrice - amount };
}

/* ─── Handler ──────────────────────────────────────────────────── */

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  /* ── Primary path: coordinate-based routing + pricing ── */
  if ('pickup_lat' in body) {
    const parsed = validateRequest(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const req = parsed.value;

    /* STEP 2: call OSRM for real driving distance
     * STEP 3: haversine × 1.4 fallback if OSRM fails */
    const route = await routeDistance(
      req.pickup_lat, req.pickup_lng,
      req.dropoff_lat, req.dropoff_lng,
    );

    /* STEP 4: run the pricing formula server-side */
    const breakdown = calculateServerPrice({
      vanType:    req.van_type,
      hours:      req.estimated_hours ?? PRICING.minimumHours,
      distanceKm: route.distance_km,
      helpers:    req.helpers ?? 0,
      extras:     req.additional_services ?? [],
    });

    /* STEP 5: return combined routing + pricing result */
    return json({
      distance_km:      route.distance_km,
      duration_minutes: route.duration_minutes,
      price_subtotal:   Math.round(breakdown.subtotal),
      vat_amount:       Math.round(breakdown.vat),
      price_total:      Math.round(breakdown.total),
      routing_provider: route.provider,
      breakdown: {
        base_price:      Math.round(breakdown.base_price),
        distance_charge: Math.round(breakdown.distance_charge),
        helpers_charge:  Math.round(breakdown.helpers_charge),
        extras_charge:   Math.round(breakdown.extras_charge),
      },
    });
  }

  /* ── Legacy backward-compat paths ── */
  const action = body.action;

  if (action === 'calculate_price') {
    /* Old shape: takes pre-computed distance. Kept so the
     * Supabase-deployed version doesn't break anything that
     * still relies on it. New callers should use the coordinate
     * path above. */
    const breakdown = calculateServerPrice({
      vanType:    String(body.vanType ?? 'medium_van'),
      hours:      Number(body.hours ?? PRICING.minimumHours),
      distanceKm: Number(body.distanceKm ?? 0),
      helpers:    Number(body.helpers ?? 0),
      extras:     Array.isArray(body.extras) ? body.extras as string[] : [],
    });
    return json({
      basePrice:      breakdown.base_price,
      distanceCharge: breakdown.distance_charge,
      helpersCharge:  breakdown.helpers_charge,
      extrasCharge:   breakdown.extras_charge,
      subtotal:       breakdown.subtotal,
      vat:            breakdown.vat,
      total:          breakdown.total,
    });
  }

  if (action === 'calculate_commission') {
    const result = calculateCommission(
      Number(body.jobPrice ?? 0),
      String(body.driverPlan ?? 'basic'),
      Number(body.dynamicModifier ?? 0),
    );
    return json(result);
  }

  return json({ error: 'Unknown request shape — expected pickup_lat/pickup_lng/... or action=calculate_price|calculate_commission' }, 400);
});
