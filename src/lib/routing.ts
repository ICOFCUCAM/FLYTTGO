/**
 * FlyttGo — driving distance helper (client-side).
 *
 * Calls the public OSRM routing server directly from the browser
 * to get real driving distance + duration between two coordinates.
 * Falls back to Haversine × 1.4 (Norway road factor) if OSRM is
 * unreachable so the booking flow is never stranded.
 *
 * ── Why client-side, not via route-distance edge function? ──
 * The route-distance Supabase Edge Function would add one round-trip
 * through our backend and requires the function to be deployed and
 * reachable. Calling OSRM directly from the browser:
 *   - Zero deploy dependency — works the moment the frontend is
 *     served, nothing to set up in Supabase.
 *   - One fewer hop → faster UX.
 *   - No Supabase auth header or anon key required.
 *
 * The trade-off is that OSRM's public demo server has rate limits
 * and no SLA. For a low-traffic marketplace and an immediate
 * distance preview that's fine. The authoritative price
 * computation still goes through calculate-price (see
 * src/lib/calculatePrice.ts) when that function is deployed.
 *
 * ── Why not Haversine alone? ──
 * Haversine is straight-line "as the crow flies" distance.
 * Norwegian routes are 20–40% longer than Haversine because of
 * fjords, valleys, and long E6/E18 stretches. Running OSRM first
 * gives a real road distance; Haversine × 1.4 is only used as a
 * fallback when OSRM is down.
 *
 * ── Caching ──
 * Same-session repeat calls for the same from/to pair return
 * instantly from an in-memory LRU (max 100 entries). The booking
 * flow re-runs distance calculation on every keystroke, so caching
 * matters.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteResult {
  distanceKm:      number;
  durationMinutes: number;
  /** Where the numbers came from — useful for UI labels + debugging. */
  source:          'osrm' | 'haversine';
}

/* ── Straight-line fallback ────────────────────────────────────── */

/**
 * Great-circle distance via the Haversine formula. Exposed as a
 * named export in case any other component needs a cheap
 * straight-line distance between two coordinates.
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
 * Haversine × 1.4 (Norway road factor) + ~70 km/h driving ETA.
 * Used when OSRM is unreachable.
 */
function haversineRoute(from: LatLng, to: LatLng): RouteResult {
  const straightKm      = haversineKm(from, to);
  const distanceKm      = Math.max(1, Math.round(straightKm * 1.4 * 10) / 10);
  const durationMinutes = Math.round(distanceKm * 0.86); // ~70 km/h average
  return { distanceKm, durationMinutes, source: 'haversine' };
}

/* ── In-memory LRU cache ───────────────────────────────────────── */

const CACHE_MAX = 100;
const cache = new Map<string, RouteResult>();

function cacheKey(from: LatLng, to: LatLng): string {
  /* Round to 4 decimals (~11 m precision) so tiny geocode drift
   * doesn't invalidate the cache on every keystroke. */
  const f = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}`;
  const t = `${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
  return `${f}|${t}`;
}

function cacheGet(key: string): RouteResult | undefined {
  const hit = cache.get(key);
  if (hit) {
    /* LRU touch — re-insert so recently-used stays at the back. */
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: RouteResult): void {
  if (cache.size >= CACHE_MAX) {
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
 *   2. Public OSRM demo server (https://router.project-osrm.org)
 *   3. Haversine × 1.4 (Norway road factor)
 *
 * Returns `null` only when inputs are missing or invalid.
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

  /* Public OSRM demo API. Lng-first ordering is the OSRM
   * convention — note this is NOT a typo. */
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=false&alternatives=false&steps=false`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const data = await res.json();

    if (data?.code !== 'Ok' || !data?.routes?.[0]) {
      throw new Error('OSRM returned no route');
    }
    const route = data.routes[0];
    if (typeof route.distance !== 'number' || typeof route.duration !== 'number') {
      throw new Error('OSRM response missing distance/duration');
    }

    const result: RouteResult = {
      distanceKm:      Math.round((route.distance / 1000) * 10) / 10, // metres → km, 1 dp
      durationMinutes: Math.round(route.duration / 60),
      source:          'osrm',
    };
    cacheSet(key, result);
    return result;
  } catch (err) {
    /* Silently fall back to Haversine. Logging once is useful for
     * debugging; we don't throw because the booking flow must always
     * get a number it can render. */
    console.warn('[routing] OSRM failed, using Haversine × 1.4 fallback:', (err as Error).message);
    const fallback = haversineRoute(from, to);
    cacheSet(key, fallback);
    return fallback;
  }
}
