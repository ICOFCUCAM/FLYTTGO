// ============================================================================
// FlyttGo — route-distance Edge Function
// ============================================================================
//
// Returns real driving distance + duration between two coordinates.
//
// Supports two providers out of the box, selectable via env vars:
//
//   • OSRM (default)             — free, no API key, OpenStreetMap data.
//                                  Public demo is rate-limited and has no
//                                  SLA; for production point
//                                  ROUTE_PROVIDER_URL at a self-hosted
//                                  OSRM instance.
//
//   • OpenRouteService (ORS)     — free 2 000 req/day, paid tiers. Needs
//                                  an API key. Set
//                                  ROUTE_PROVIDER_KIND=ors
//                                  ROUTE_PROVIDER_URL=https://api.openrouteservice.org
//                                  ROUTE_PROVIDER_KEY=<your-key>
//
// You can add Mapbox, GraphHopper or Google by extending the switch in
// routeFor() and writing a small parser for their response shape — the
// public API to the FlyttGo frontend stays the same.
//
// DEPLOY:
//   supabase functions deploy route-distance --no-verify-jwt
//
// SET SECRETS (never commit the key!):
//   supabase secrets set ROUTE_PROVIDER_KIND=ors
//   supabase secrets set ROUTE_PROVIDER_URL=https://api.openrouteservice.org
//   supabase secrets set ROUTE_PROVIDER_KEY=<your-fresh-ORS-key>
//
// REQUEST:
//   POST /functions/v1/route-distance
//   { "from": { "lat": 59.91, "lng": 10.75 },
//     "to":   { "lat": 60.39, "lng":  5.32 } }
//
// RESPONSE (200):
//   { "distanceKm": 458.2, "durationMinutes": 408, "provider": "ors" }
//
// The frontend helper (src/lib/routing.ts) falls back to Haversine if
// this function is unreachable, so the booking flow never stalls.
// ============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';

interface LatLng { lat: number; lng: number }
interface RouteRequest { from: LatLng; to: LatLng }
type ProviderKind = 'osrm' | 'ors';

const PROVIDER_KIND = ((Deno.env.get('ROUTE_PROVIDER_KIND') ?? 'osrm').toLowerCase() as ProviderKind);
const PROVIDER_URL  = Deno.env.get('ROUTE_PROVIDER_URL') ?? 'https://router.project-osrm.org';
const PROVIDER_KEY  = Deno.env.get('ROUTE_PROVIDER_KEY') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function isValidCoord(p: unknown): p is LatLng {
  if (!p || typeof p !== 'object') return false;
  const { lat, lng } = p as Record<string, unknown>;
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90  && lat <= 90  &&
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
  );
}

/* ── Providers ─────────────────────────────────────────────────── */

/**
 * OSRM URL:  /route/v1/driving/{from_lng},{from_lat};{to_lng},{to_lat}
 * Note the lng-first ordering — this is the OSRM convention.
 */
async function osrmRoute(from: LatLng, to: LatLng): Promise<{ distanceKm: number; durationMinutes: number }> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const base   = PROVIDER_URL.replace(/\/$/, '');
  const url    = `${base}/route/v1/driving/${coords}?overview=false&alternatives=false&steps=false${PROVIDER_KEY ? `&key=${encodeURIComponent(PROVIDER_KEY)}` : ''}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'FlyttGo/1.0 (+https://flyttgo.no)' },
  });
  if (!res.ok) throw new Error(`osrm ${res.status}`);
  const data = await res.json();

  const route = data?.routes?.[0];
  if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number') {
    throw new Error('osrm returned no route');
  }
  return {
    distanceKm:      Math.round((route.distance / 1000) * 10) / 10, // metres → km, 1 dp
    durationMinutes: Math.round(route.duration / 60),
  };
}

/**
 * OpenRouteService URL:  POST /v2/directions/driving-car
 * Body is coordinates lng-first (same as OSRM), units metres.
 * Requires Authorization: <api_key> header.
 */
async function orsRoute(from: LatLng, to: LatLng): Promise<{ distanceKm: number; durationMinutes: number }> {
  if (!PROVIDER_KEY) throw new Error('ORS key missing — set ROUTE_PROVIDER_KEY');
  const base = PROVIDER_URL.replace(/\/$/, '');
  const url  = `${base}/v2/directions/driving-car`;

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': PROVIDER_KEY,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'User-Agent':    'FlyttGo/1.0 (+https://flyttgo.no)',
    },
    body: JSON.stringify({
      coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
      units:       'm',
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ors ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const data = await res.json();

  /* ORS /v2/directions/driving-car (JSON) returns
   * { routes: [ { summary: { distance, duration } }, ... ] }
   * distance in metres, duration in seconds. */
  const summary = data?.routes?.[0]?.summary;
  if (!summary || typeof summary.distance !== 'number' || typeof summary.duration !== 'number') {
    throw new Error('ors returned no route summary');
  }
  return {
    distanceKm:      Math.round((summary.distance / 1000) * 10) / 10,
    durationMinutes: Math.round(summary.duration / 60),
  };
}

async function routeFor(kind: ProviderKind, from: LatLng, to: LatLng) {
  switch (kind) {
    case 'ors':  return await orsRoute(from, to);
    case 'osrm':
    default:     return await osrmRoute(from, to);
  }
}

/* ── Handler ───────────────────────────────────────────────────── */

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  let body: RouteRequest;
  try {
    body = await req.json() as RouteRequest;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!isValidCoord(body?.from) || !isValidCoord(body?.to)) {
    return json({ error: 'from and to must be { lat, lng } objects with valid coordinates' }, 400);
  }

  try {
    const { distanceKm, durationMinutes } = await routeFor(PROVIDER_KIND, body.from, body.to);
    return json({ distanceKm, durationMinutes, provider: PROVIDER_KIND });
  } catch (err) {
    /* Let the frontend fall back to Haversine. 502 so it's obvious this
     * was a provider error, not a bad request. */
    return json({ error: 'Upstream routing provider failed', detail: (err as Error).message }, 502);
  }
});
