/**
 * The road between two points, for drawing on a map (owner, 31 October 2026: the booking and tracking maps
 * show the real road, not a straight line). Asks the public OSRM router for the full geometry; when it does
 * not answer, returns the straight line between the points, marked as such, so a map always has something
 * honest to draw. Never throws. Results are cached for the session, keyed to 4 decimals (~11 m).
 */
import { haversineKm, type LatLng } from './routing';

export interface RouteGeometry {
  /** [lat, lng] pairs along the road, or just the two ends when the road is unknown. */
  points: [number, number][];
  distanceKm: number;
  durationMinutes: number;
  source: 'road' | 'straight';
}

const cache = new Map<string, RouteGeometry>();
const key = (a: LatLng, b: LatLng) => `${a.lat.toFixed(4)},${a.lng.toFixed(4)}|${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;

/** The straight line, with the same road factor and speed as the routing fallback (×1.4, ~70 km/h). */
export function straightGeometry(a: LatLng, b: LatLng): RouteGeometry {
  const km = Math.round(haversineKm(a, b) * 1.4 * 10) / 10;
  return { points: [[a.lat, a.lng], [b.lat, b.lng]], distanceKm: km, durationMinutes: Math.round(km * 0.86), source: 'straight' };
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<any> }>;

export async function routeGeometry(a: LatLng, b: LatLng, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<RouteGeometry> {
  const k = key(a, b);
  const hit = cache.get(k);
  if (hit) return hit;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    const res = await fetchFn(url, { signal: ctrl?.signal });
    if (!res.ok) throw new Error('route');
    const data = await res.json();
    const r = data?.routes?.[0];
    const coords: unknown = r?.geometry?.coordinates;
    if (!r || !Array.isArray(coords) || coords.length < 2) throw new Error('no route');
    const out: RouteGeometry = {
      points: (coords as [number, number][]).map(([lng, lat]) => [lat, lng]),
      distanceKm: Math.round((r.distance / 1000) * 10) / 10,
      durationMinutes: Math.round(r.duration / 60),
      source: 'road',
    };
    if (cache.size > 100) cache.delete(cache.keys().next().value as string);
    cache.set(k, out);
    return out;
  } catch {
    return straightGeometry(a, b);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** "7 h 46 min", "45 min" — for map captions and estimates. */
export function formatDuration(minutes: number, lang: 'en' | 'no' = 'en'): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60), r = m % 60;
  const hu = lang === 'no' ? 't' : 'h';
  return h ? (r ? `${h} ${hu} ${r} min` : `${h} ${hu}`) : `${r} min`;
}
