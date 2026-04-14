/**
 * FlyttGo — driving distance helper.
 *
 * Replaces the old Haversine-only distance calculation with a real
 * driving distance + duration from a routing provider (OSRM by
 * default, swappable via the route-distance Edge Function). Falls
 * back to Haversine if the edge function is unreachable so the
 * booking flow never stalls.
 *
 * ── Why not just call Haversine? ──
 * Haversine gives "as the crow flies" distance between two points.
 * On Norwegian routes — full of fjords, valleys, tunnels and long
 * E6/E18 stretches — that underestimates real driving distance by
 * 20–40 %. Pricing that off Haversine means customers are quoted
 * too low and drivers lose money on long legs.
 *
 * ── Caching ──
 * Same-session repeat calls for the same from/to return instantly
 * from an in-memory LRU (max 100 entries). The booking flow and the
 * homepage widget both re-run distance calculation on every keystroke,
 * so caching matters.
 */

import { supabaseFunctionUrl } from './supabase';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteResult {
  distanceKm:      number;
  durationMinutes: number;
  /** Where the numbers came from — useful for debugging. */
  source:          'osrm' | 'haversine';
}

/* ── Straight-line fallback ────────────────────────────────────── */

/**
 * Great-circle distance via the Haversine formula. Still a useful
 * fallback when the routing provider is down — better to quote an
 * under-estimate than block the customer.
 */
export function haversineKm(from: LatLng, to: LatLng): number {
  const R = 6371; // Earth radius in km
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lng - from.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((from.lat * Math.PI) / 180) *
      Math.cos((to.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Haversine distance + a rough 70 km/h driving ETA. Used when the
 * routing provider is unreachable.
 */
function haversineRoute(from: LatLng, to: LatLng): RouteResult {
  const distanceKm      = Math.round(haversineKm(from, to) * 10) / 10;
  const durationMinutes = Math.round(distanceKm * 0.86); // ~70 km/h average
  return { distanceKm, durationMinutes, source: 'haversine' };
}

/* ── In-memory LRU cache ───────────────────────────────────────── */

const CACHE_MAX = 100;
const cache = new Map<string, RouteResult>();

function cacheKey(from: LatLng, to: LatLng): string {
  /* Round to 4 decimals (~11 m) so tiny geocode drift doesn't
   * invalidate the cache on every keystroke. */
  const f = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}`;
  const t = `${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
  return `${f}|${t}`;
}

function cacheGet(key: string): RouteResult | undefined {
  const hit = cache.get(key);
  if (hit) {
    /* LRU: re-insert so recently-used stays at the back. */
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: RouteResult): void {
  if (cache.size >= CACHE_MAX) {
    /* Evict the oldest entry (first key in insertion order). */
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, value);
}

/* ── Main entry point ──────────────────────────────────────────── */

/**
 * Get driving distance + duration between two coordinates. Always
 * resolves — never throws. Order of preference:
 *
 *   1. In-memory cache (if called with the same pair recently)
 *   2. Supabase `route-distance` Edge Function (OSRM by default)
 *   3. Haversine + 70 km/h approximation
 */
export async function getRouteDistance(
  from: LatLng | null | undefined,
  to:   LatLng | null | undefined,
): Promise<RouteResult | null> {
  if (!from || !to) return null;
  if (
    !Number.isFinite(from.lat) || !Number.isFinite(from.lng) ||
    !Number.isFinite(to.lat)   || !Number.isFinite(to.lng)
  ) return null;

  const key    = cacheKey(from, to);
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const res = await fetch(supabaseFunctionUrl('route-distance'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from, to }),
    });

    if (res.ok) {
      const data = await res.json();
      if (
        typeof data?.distanceKm === 'number' &&
        typeof data?.durationMinutes === 'number'
      ) {
        const result: RouteResult = {
          distanceKm:      data.distanceKm,
          durationMinutes: data.durationMinutes,
          source:          'osrm',
        };
        cacheSet(key, result);
        return result;
      }
    }
  } catch {
    /* Swallow — fall through to Haversine. */
  }

  const fallback = haversineRoute(from, to);
  cacheSet(key, fallback);
  return fallback;
}
