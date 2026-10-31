// ============================================================================
// FlyttGo — vehicle-lookup Edge Function
// ============================================================================
//
// Fills make, model and year in the driver application from the number plate
// (_shared/vehicle-register.ts; docs/VEHICLE_REGISTER.md).
//
//   POST /functions/v1/vehicle-lookup
//   Authorization: Bearer <signed-in user's access token>
//   { "probe": true }            → 200 { available: boolean }   (no sign-in needed)
//   { "plate": "AB 12345" }      → 200 { found: true, vehicle: { plate, make, model, year } }
//                                  200 { found: false }
//                                  400 not a plate · 401 sign in · 429 too many · 503 off or unreachable
//
// Off until the secret SVV_API_KEY is set (the form then does not offer the lookup).
// A signed-in user may look up at most LIMIT plates an hour (per running instance).
//
// DEPLOY:
//   supabase functions deploy vehicle-lookup --no-verify-jwt
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient } from '../_shared/auth.ts';
import { lookupPlate } from '../_shared/vehicle-register.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const LIMIT = 20;
const recent = new Map<string, number[]>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  const key = Deno.env.get('SVV_API_KEY') ?? '';
  let body: { probe?: boolean; plate?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (body?.probe) return json({ available: !!key });
  if (!key) return json({ error: 'The vehicle register lookup is not connected' }, 503);

  const caller = await getCaller(req, serviceClient());
  if (!caller) return json({ error: 'Sign in required' }, 401);

  const now = Date.now();
  const hits = (recent.get(caller.id) ?? []).filter(t => now - t < 3_600_000);
  if (hits.length >= LIMIT) return json({ error: 'Too many lookups; type the details in' }, 429);
  recent.set(caller.id, [...hits, now]);

  const r = await lookupPlate(String(body?.plate ?? ''), {
    key, url: Deno.env.get('SVV_API_URL') ?? undefined, header: Deno.env.get('SVV_AUTH_HEADER') ?? undefined,
    fetch: (u, init) => fetch(u, init),
  });
  if (r.kind === 'invalid')     return json({ error: 'Not a Norwegian number plate' }, 400);
  if (r.kind === 'not_found')   return json({ found: false });
  if (r.kind === 'unavailable') return json({ error: 'The vehicle register could not be reached', status: r.status ?? null }, 503);
  return json({ found: true, vehicle: r.vehicle });
});
