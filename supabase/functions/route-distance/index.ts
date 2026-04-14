// ============================================================================
// FlyttGo — route-distance Edge Function
// ============================================================================
//
// Returns real driving distance + duration between two coordinates using
// OSRM (Open Source Routing Machine). The public demo server is free and
// does not require an API key, but is rate-limited (~1 req/s) and has no
// SLA. For production, point ROUTE_PROVIDER_URL at either a self-hosted
// OSRM instance, OpenRouteService, Mapbox or Google Directions.
//
// DEPLOY:
//   supabase functions deploy route-distance --no-verify-jwt
//
// SECRETS (optional — only needed when switching to OpenRouteService /
// Mapbox; leave unset to use the free public OSRM demo):
//   ROUTE_PROVIDER_URL  — defaults to 'https://router.project-osrm.org'
//   ROUTE_PROVIDER_KEY  — API key passed via ?key=…, unused for OSRM
//
// REQUEST:
//   POST /functions/v1/route-distance
//   { "from": { "lat": 59.91, "lng": 10.75 },
//     "to":   { "lat": 60.39, "lng": 5.32  } }
//
// RESPONSE (200):
//   { "distanceKm": 458.2, "durationMinutes": 408, "provider": "osrm" }
//
// The frontend helper (src/lib/routing.ts) falls back to Haversine if this
// function is unreachable, so the booking flow never stalls.
// ============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';

interface LatLng { lat: number; lng: number }
interface RouteRequest { from: LatLng; to: LatLng }

const PROVIDER_URL = Deno.env.get('ROUTE_PROVIDER_URL') ?? 'https://router.project-osrm.org';
const PROVIDER_KEY = Deno.env.get('ROUTE_PROVIDER_KEY') ?? '';

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

async function osrmRoute(from: LatLng, to: LatLng): Promise<{ distanceKm: number; durationMinutes: number }> {
  /* OSRM URL:  /route/v1/driving/{from_lng},{from_lat};{to_lng},{to_lat}
   * Note the lng-first ordering — this is the OSRM convention. */
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url    = `${PROVIDER_URL}/route/v1/driving/${coords}?overview=false&alternatives=false&steps=false${PROVIDER_KEY ? `&key=${PROVIDER_KEY}` : ''}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'FlyttGo/1.0 (+https://flyttgo.no)' },
  });
  if (!res.ok) throw new Error(`provider ${res.status}`);
  const data = await res.json();

  const route = data?.routes?.[0];
  if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number') {
    throw new Error('provider returned no route');
  }
  return {
    distanceKm:      Math.round((route.distance / 1000) * 10) / 10, // metres → km, 1 dp
    durationMinutes: Math.round(route.duration / 60),
  };
}

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
    const { distanceKm, durationMinutes } = await osrmRoute(body.from, body.to);
    return json({ distanceKm, durationMinutes, provider: 'osrm' });
  } catch (err) {
    /* Let the frontend fall back to Haversine. 502 so it's obvious this
     * was a provider error, not a bad request. */
    return json({ error: 'Upstream routing provider failed', detail: (err as Error).message }, 502);
  }
});
