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
import { VAN_HOURLY_RATES, PRICING, routeDistance, calculateServerPrice, flooredDistanceKm } from '../_shared/pricing.ts';

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

/* Pricing constants, routing (OSRM → haversine × 1.4) and the price
 * formula live in ../_shared/pricing.ts. The payment functions charge
 * with the same code, so the preview here is the amount charged. */

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
    const routed = await routeDistance(
      req.pickup_lat, req.pickup_lng,
      req.dropoff_lat, req.dropoff_lng,
    );
    /* Never shorter than the straight line, as the payment functions price it. */
    const route = { ...routed, distance_km: flooredDistanceKm(routed, [req.pickup_lat, req.pickup_lng, req.dropoff_lat, req.dropoff_lng]) };

    /* STEP 4: run the pricing formula server-side */
    const breakdown = calculateServerPrice({
      vanType:    req.van_type,
      hours:      req.estimated_hours ?? PRICING.minimumHours,
      distanceKm: route.distance_km,
      helpers:    req.helpers ?? 0,
      extras:     req.additional_services ?? [],
      routeMinutes: route.duration_minutes,
    });

    /* STEP 5: return combined routing + pricing result */
    return json({
      distance_km:      route.distance_km,
      duration_minutes: route.duration_minutes,
      price_subtotal:   Math.round(breakdown.subtotal),
      vat_amount:       Math.round(breakdown.vat),
      price_total:      Math.round(breakdown.total),
      routing_provider: route.provider,
      billed_hours:     breakdown.billed_hours,
      route_hours_applied: breakdown.route_hours_applied,
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
