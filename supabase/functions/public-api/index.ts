// ============================================================================
// FlyttGo — public-api Edge Function (the companies' REST API)
// ============================================================================
//
// Versioned JSON REST for a company's own systems (docs/API.md; the
// description is docs/api/openapi.yaml). Authenticated by the company's
// API key, never by a user session:
//
//   Authorization: Bearer fgo_<64 hex>
//   https://<project>.supabase.co/functions/v1/public-api/v1/...
//
// Every request starts with api_begin (migration 00018): the key is found
// by its SHA-256, the request is counted against the key's limit per
// minute, and the company must be active, the key not revoked or expired,
// its creator still an owner or admin, the scope on the key and in the
// company's plan. Reads (api_read) return only the key's company's records;
// writes (api_write) run as the key's creator through the functions the
// company's own screens use:
//   POST /v1/quotes        the price calculate-price gives (_shared/pricing.ts)
//   POST /v1/bookings      priced here with the same formula, inserted as the
//                          creator and paid with book_on_invoice, as
//                          book-on-invoice does: one booking engine
//   POST /v1/jobs          create_job
//   POST /v1/appointments  create_appointment
// Writes accept an Idempotency-Key header (24 hours).
//
// The key is a secret for servers: no CORS headers are sent, so browsers
// refuse to call the API from a web page. Websites use the booking widget
// (public/widget.js), which needs no key.
//
// DEPLOY: supabase functions deploy public-api --no-verify-jwt
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { serviceClient } from '../_shared/auth.ts';
import { bookingChargeNok, flooredDistanceKm, routeDistance } from '../_shared/pricing.ts';
import {
  apiPath, bearerKey, dbError, errorBody, idempotencyKey, isApiKey, matchRoute, quoteFor, requestHash, sha256Hex,
  validateAppointment, validateBooking, validateJob, validateListQuery, validateQuote, validateSlotsQuery,
  type FieldError,
} from '../_shared/public-api.ts';

const JOB_STATUSES = ['requested', 'quoted', 'accepted', 'declined', 'scheduled', 'in_progress', 'completed', 'invoiced', 'cancelled'];

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
const invalid = (errors: FieldError[], headers: Record<string, string>) =>
  json(errorBody('invalid_request', 'The request is not valid: ' + errors.map(e => `${e.field} ${e.message}`).join('; '), { fields: errors }), 422, headers);

serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = apiPath(url.pathname);
  const match = matchRoute(req.method, path);
  if (!match.ok) {
    return match.status === 405
      ? json(errorBody('method_not_allowed', `${req.method} is not allowed on ${path}`), 405, { Allow: match.allow.join(', ') })
      : json(errorBody('not_found', `No such endpoint: ${req.method} ${path}. See docs/API.md.`), 404);
  }
  const { route, id } = match;

  const key = bearerKey(req.headers.get('Authorization'));
  if (!key) {
    return json(errorBody('missing_key', 'Send your API key as Authorization: Bearer fgo_…'), 401, { 'WWW-Authenticate': 'Bearer' });
  }
  if (!isApiKey(key)) return json(errorBody('invalid_key', 'The API key is not valid.'), 401, { 'WWW-Authenticate': 'Bearer' });
  const hash = await sha256Hex(key);

  const db = serviceClient();
  const { data: ctx, error: beginErr } = await db.rpc('api_begin', { p_key_hash: hash, p_scope: route.scope });
  if (beginErr || !ctx) return json(errorBody('server_error', 'The request could not be checked. Try again.'), 500);
  const limitHeaders: Record<string, string> = ctx.limit ? {
    'RateLimit-Limit': String(ctx.limit), 'RateLimit-Remaining': String(ctx.remaining ?? 0),
    'RateLimit-Reset': String(Math.max(0, Math.ceil((Date.parse(ctx.reset_at) - Date.now()) / 1000))),
  } : {};
  if (!ctx.ok) {
    const headers: Record<string, string> = { ...limitHeaders };
    if (ctx.status === 429) headers['Retry-After'] = String(ctx.retry_after ?? 60);
    if (ctx.status === 401) headers['WWW-Authenticate'] = 'Bearer error="invalid_token"';
    return json(errorBody(ctx.error, ctx.message), ctx.status, headers);
  }

  let body: unknown = null;
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { return json(errorBody('invalid_json', 'The body must be JSON.'), 400, limitHeaders); }
  }

  const read = async (what: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await db.rpc('api_read', { p_key_hash: hash, p_what: what, p_args: args });
    if (error) { const e = dbError(error.code); return json(errorBody(e.code, error.message.replace(/^API: /, '')), e.status, limitHeaders); }
    return json(data, 200, limitHeaders);
  };
  const write = async (action: string, args: Record<string, unknown>) => {
    const idem = idempotencyKey(req.headers.get('Idempotency-Key'));
    if (!idem.ok) return json(errorBody('invalid_request', idem.error), 422, limitHeaders);
    const { data, error } = await db.rpc('api_write', {
      p_key_hash: hash, p_action: action, p_args: args,
      p_idempotency_key: idem.value, p_request_hash: idem.value ? await requestHash(req.method, path, body) : null,
    });
    if (error) { const e = dbError(error.code); return json(errorBody(e.code, error.message.replace(/^API: /, '')), e.status, limitHeaders); }
    const replayed = data?.replayed === true;
    const headers = { ...limitHeaders, ...(replayed ? { 'Idempotent-Replayed': 'true' } : {}) };
    return json(data, replayed ? 200 : 201, headers);
  };
  const list = (what: string, statuses?: string[]) => {
    const q = validateListQuery(url.searchParams, statuses);
    if (!q.ok) return invalid(q.errors, limitHeaders);
    return read(what, { limit: q.value.limit, before: q.value.before, status: q.value.status });
  };

  switch (route.name) {
    case 'me': {
      const { data: org } = await db.from('organizations').select('id, name, slug, status').eq('id', ctx.organization_id).maybeSingle();
      return json({ object: 'api_key', id: ctx.key_id, scopes: ctx.scopes, rate_limit_per_minute: ctx.limit,
                    organization: org, acting_member: ctx.acting_user }, 200, limitHeaders);
    }
    case 'quotes.create': {
      const v = validateQuote(body);
      if (!v.ok) return invalid(v.errors, limitHeaders);
      const q = v.value;
      const routed = await routeDistance(q.pickup.lat, q.pickup.lng, q.dropoff.lat, q.dropoff.lng);
      const r = { ...routed, distance_km: flooredDistanceKm(routed, [q.pickup.lat, q.pickup.lng, q.dropoff.lat, q.dropoff.lng]) };
      return json(quoteFor(q, r), 200, limitHeaders);
    }
    case 'bookings.list':   return list('bookings.list');
    case 'bookings.get':    return read('bookings.get', { id });
    case 'bookings.create': {
      const v = validateBooking(body);
      if (!v.ok) return invalid(v.errors, limitHeaders);
      const b = v.value;
      /* The server's price, as chargeForBooking computes it for card, Vipps
       * and book-on-invoice: route on the server, the shared formula. */
      const routed = await routeDistance(b.pickup.lat, b.pickup.lng, b.dropoff.lat, b.dropoff.lng);
      const r = { ...routed, distance_km: flooredDistanceKm(routed, [b.pickup.lat, b.pickup.lng, b.dropoff.lat, b.dropoff.lng]) };
      const price = bookingChargeNok({ van_type: b.van_type, estimated_hours: b.estimated_hours, helpers: b.helpers,
                                       additional_services: b.additional_services }, r);
      if (!Number.isFinite(price) || price <= 0) return json(errorBody('invalid_request', 'The move could not be priced.'), 422, limitHeaders);
      return write('booking.create', { ...b, price, distance_km: r.distance_km });
    }
    case 'jobs.services':   return read('jobs.services');
    case 'jobs.list':       return list('jobs.list', JOB_STATUSES);
    case 'jobs.get':        return read('jobs.get', { id });
    case 'jobs.create': {
      const v = validateJob(body);
      if (!v.ok) return invalid(v.errors, limitHeaders);
      return write('job.create', { ...v.value });
    }
    case 'appointments.services': return read('appointments.services');
    case 'appointments.slots': {
      const q = validateSlotsQuery(url.searchParams);
      if (!q.ok) return invalid(q.errors, limitHeaders);
      return read('appointments.slots', { ...q.value });
    }
    case 'appointments.list': return list('appointments.list', ['booked', 'cancelled', 'completed', 'no_show']);
    case 'appointments.get':  return read('appointments.get', { id });
    case 'appointments.create': {
      const v = validateAppointment(body);
      if (!v.ok) return invalid(v.errors, limitHeaders);
      return write('appointment.create', { ...v.value });
    }
  }
  return json(errorBody('not_found', 'No such endpoint.'), 404, limitHeaders);
});
