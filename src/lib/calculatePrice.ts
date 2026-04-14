/**
 * FlyttGo — server-authoritative pricing helper.
 *
 * Thin wrapper around the `calculate-price` Supabase Edge Function.
 * The edge function:
 *   1) runs the real OSRM routing query for driving distance
 *   2) falls back to haversine × 1.4 if OSRM is unreachable
 *   3) runs the FlyttGo pricing formula server-side
 *   4) returns one bundle: { distance_km, duration_minutes,
 *      price_subtotal, vat_amount, price_total, routing_provider }
 *
 * All the frontend has to do is pass coordinates + move choices.
 * Neither the distance nor the final price is computed in the
 * browser, so the customer can't tamper with them before the
 * booking is inserted.
 *
 * Usage:
 *
 *   const price = await fetchServerPrice({
 *     pickupLat:   59.91, pickupLng:   10.75,
 *     dropoffLat:  60.39, dropoffLng:   5.32,
 *     vanType:     'medium_van',
 *     helpers:     1,
 *     additionalServices: ['cleaning'],
 *     estimatedHours: 3,
 *   });
 *   // → { distance_km: 463.2, duration_minutes: 411, price_total: 9863, ... }
 */

import { supabaseFunctionUrl } from './supabase';

export interface ServerPriceInput {
  pickupLat:           number;
  pickupLng:           number;
  dropoffLat:          number;
  dropoffLng:          number;
  vanType:             string;
  helpers:             number;
  additionalServices:  string[];
  estimatedHours:      number;
}

export interface ServerPriceResult {
  distance_km:      number;
  duration_minutes: number;
  price_subtotal:   number;
  vat_amount:       number;
  price_total:      number;
  routing_provider: 'OSRM' | 'haversine-fallback';
  breakdown: {
    base_price:      number;
    distance_charge: number;
    helpers_charge:  number;
    extras_charge:   number;
  };
}

/**
 * Call the calculate-price Edge Function. Throws on network or
 * validation errors — callers should handle failure and fall back
 * to disabling the submit button so a booking is never inserted
 * with an unknown price.
 *
 * Errors are also logged to the DevTools console (with the exact
 * URL and request body) so debugging is possible without touching
 * the code. The thrown message is surfaced to the customer via
 * BookingFlow's pricingError state.
 */
export async function fetchServerPrice(input: ServerPriceInput): Promise<ServerPriceResult> {
  const url  = supabaseFunctionUrl('calculate-price');
  const body = {
    pickup_lat:           input.pickupLat,
    pickup_lng:           input.pickupLng,
    dropoff_lat:          input.dropoffLat,
    dropoff_lng:          input.dropoffLng,
    van_type:             input.vanType,
    helpers:              input.helpers,
    additional_services:  input.additionalServices,
    estimated_hours:      input.estimatedHours,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  } catch (networkErr) {
    /* Total network failure — DNS, CORS, offline, etc. */
    const msg = `Network error calling calculate-price at ${url}: ${(networkErr as Error).message}`;
    console.error('[fetchServerPrice]', msg);
    throw new Error(msg);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { /* ignore */ }
    const base = `calculate-price HTTP ${res.status}${detail ? ` — ${detail}` : ''}`;
    console.error('[fetchServerPrice]', base, 'url:', url, 'body:', body);
    /* The most common failure mode: the calculate-price function
     * isn't deployed, OR was deployed as the legacy multi-action
     * version that doesn't understand the coordinate-based
     * request shape. Make that obvious in the error message. */
    if (res.status === 400 || res.status === 404) {
      throw new Error(
        `${base}. Hint: the calculate-price Edge Function is probably not deployed or is the legacy version. Run:  supabase functions deploy calculate-price --no-verify-jwt`,
      );
    }
    throw new Error(base);
  }

  let data: ServerPriceResult;
  try {
    data = (await res.json()) as ServerPriceResult;
  } catch {
    throw new Error('calculate-price returned non-JSON response');
  }

  if (
    typeof data?.distance_km !== 'number' ||
    typeof data?.price_total !== 'number'
  ) {
    console.error('[fetchServerPrice] Unexpected response shape:', data);
    throw new Error('calculate-price returned an unexpected response shape (check DevTools console)');
  }

  return data;
}
