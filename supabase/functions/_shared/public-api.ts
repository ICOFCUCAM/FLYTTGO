// ============================================================================
// FlyttGo — the public API's rules (docs/API.md, docs/api/openapi.yaml)
// ============================================================================
//
// Key format, routes, request validation, the idempotency hash and error
// codes of the public-api Edge Function. Plain TypeScript (Web Crypto
// only), so the Vitest suite (src/test/public-api.test.ts) exercises the
// same code Deno runs. The database decides who may do what (migration
// 00018: api_begin, api_read, api_write); this module only refuses
// malformed requests early and with clear messages.
// ============================================================================

import { PRICING, VAN_HOURLY_RATES, calculateServerPrice, type RouteResult } from './pricing.ts';

/* ─── Keys ─────────────────────────────────────────────────────── */

/** fgo_ and 64 hex characters (create_api_key in 00018). */
export const API_KEY_PATTERN = /^fgo_[0-9a-f]{64}$/;

export const API_SCOPES = ['quotes', 'bookings:read', 'bookings:write', 'appointments', 'jobs'] as const;
export type ApiScope = typeof API_SCOPES[number];

export const SCOPE_LABELS: Record<ApiScope, string> = {
  'quotes':         'Price quotes for moves',
  'bookings:read':  'Read the company\'s moves',
  'bookings:write': 'Book moves on the company\'s invoice',
  'appointments':   'Free times and appointment booking',
  'jobs':           'Job services and job requests',
};

/** The key from `Authorization: Bearer <key>`, or null. */
export function bearerKey(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec((header ?? '').trim());
  return m ? m[1] : null;
}

export function isApiKey(value: string | null | undefined): boolean {
  return !!value && API_KEY_PATTERN.test(value);
}

/** Hex SHA-256 of the UTF-8 text: how the database stores a key. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/* ─── Routes ───────────────────────────────────────────────────── */

export type RouteName =
  | 'me' | 'quotes.create'
  | 'bookings.list' | 'bookings.get' | 'bookings.create'
  | 'jobs.services' | 'jobs.list' | 'jobs.get' | 'jobs.create'
  | 'appointments.services' | 'appointments.slots' | 'appointments.list' | 'appointments.get' | 'appointments.create';

export interface ApiRoute { method: 'GET' | 'POST'; path: string; name: RouteName; scope: ApiScope | null }

/** Every route of version 1. docs/api/openapi.yaml describes each (checked by the tests). */
export const ROUTES: readonly ApiRoute[] = [
  { method: 'GET',  path: '/v1/me',                    name: 'me',                    scope: null },
  { method: 'POST', path: '/v1/quotes',                name: 'quotes.create',         scope: 'quotes' },
  { method: 'GET',  path: '/v1/bookings',              name: 'bookings.list',         scope: 'bookings:read' },
  { method: 'POST', path: '/v1/bookings',              name: 'bookings.create',       scope: 'bookings:write' },
  { method: 'GET',  path: '/v1/bookings/{id}',         name: 'bookings.get',          scope: 'bookings:read' },
  { method: 'GET',  path: '/v1/jobs/services',         name: 'jobs.services',         scope: 'jobs' },
  { method: 'GET',  path: '/v1/jobs',                  name: 'jobs.list',             scope: 'jobs' },
  { method: 'POST', path: '/v1/jobs',                  name: 'jobs.create',           scope: 'jobs' },
  { method: 'GET',  path: '/v1/jobs/{id}',             name: 'jobs.get',              scope: 'jobs' },
  { method: 'GET',  path: '/v1/appointments/services', name: 'appointments.services', scope: 'appointments' },
  { method: 'GET',  path: '/v1/appointments/slots',    name: 'appointments.slots',    scope: 'appointments' },
  { method: 'GET',  path: '/v1/appointments',          name: 'appointments.list',     scope: 'appointments' },
  { method: 'POST', path: '/v1/appointments',          name: 'appointments.create',   scope: 'appointments' },
  { method: 'GET',  path: '/v1/appointments/{id}',     name: 'appointments.get',      scope: 'appointments' },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The API path of a request URL: what follows the function's name
 * (/functions/v1/public-api/v1/bookings → /v1/bookings), without a
 * trailing slash.
 */
export function apiPath(pathname: string): string {
  const i = pathname.indexOf('/public-api');
  const rest = i >= 0 ? pathname.slice(i + '/public-api'.length) : pathname;
  return rest.replace(/\/+$/, '') || '/';
}

export type RouteMatch =
  | { ok: true; route: ApiRoute; id: string | null }
  | { ok: false; status: 404 | 405; allow: string[] };

export function matchRoute(method: string, path: string): RouteMatch {
  const allow: string[] = [];
  for (const r of ROUTES) {
    let id: string | null = null;
    if (r.path.endsWith('/{id}')) {
      const base = r.path.slice(0, -'/{id}'.length);
      if (!path.startsWith(base + '/')) continue;
      const tail = path.slice(base.length + 1);
      if (!UUID.test(tail)) continue;
      id = tail.toLowerCase();
    } else if (r.path !== path) {
      continue;
    }
    if (r.method === method.toUpperCase()) return { ok: true, route: r, id };
    allow.push(r.method);
  }
  return allow.length ? { ok: false, status: 405, allow } : { ok: false, status: 404, allow };
}

/* ─── Validation ───────────────────────────────────────────────── */

export interface FieldError { field: string; message: string }
export type Valid<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

class Checker {
  errors: FieldError[] = [];
  fail(field: string, message: string) { this.errors.push({ field, message }); return undefined; }

  num(o: Obj, field: string, path: string, min: number, max: number, required = true): number | undefined {
    const v = o[field];
    if (v === undefined || v === null) return required ? this.fail(path, 'is required') : undefined;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return this.fail(path, `must be a number from ${min} to ${max}`);
    return v;
  }
  int(o: Obj, field: string, path: string, min: number, max: number, required = true): number | undefined {
    const v = this.num(o, field, path, min, max, required);
    if (v !== undefined && !Number.isInteger(v)) return this.fail(path, 'must be a whole number');
    return v;
  }
  str(o: Obj, field: string, path: string, max: number, required = true): string | undefined {
    const v = o[field];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return required ? this.fail(path, 'is required') : undefined;
    if (typeof v !== 'string') return this.fail(path, 'must be a string');
    if (v.trim().length > max) return this.fail(path, `must be at most ${max} characters`);
    return v.trim();
  }
  uuid(o: Obj, field: string, path: string, required = true): string | undefined {
    const v = this.str(o, field, path, 36, required);
    if (v !== undefined && !UUID.test(v)) return this.fail(path, 'must be a UUID');
    return v?.toLowerCase();
  }
  obj(o: Obj, field: string, path: string, required = true): Obj | undefined {
    const v = o[field];
    if (v === undefined || v === null) return required ? this.fail(path, 'is required') : undefined;
    if (!isObj(v)) return this.fail(path, 'must be an object');
    return v;
  }
}

export interface QuoteInput {
  pickup:  { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  van_type: string;
  helpers: number;
  estimated_hours: number;
  additional_services: string[];
}

function moveInput(c: Checker, b: Obj, withAddresses: boolean) {
  const place = (name: 'pickup' | 'dropoff') => {
    const p = c.obj(b, name, name);
    if (!p) return undefined;
    const lat = c.num(p, 'lat', `${name}.lat`, -90, 90);
    const lng = c.num(p, 'lng', `${name}.lng`, -180, 180);
    if (!withAddresses) return lat === undefined || lng === undefined ? undefined : { lat, lng };
    const address = c.str(p, 'address', `${name}.address`, 300);
    const postcode = c.str(p, 'postcode', `${name}.postcode`, 10, false);
    const city = c.str(p, 'city', `${name}.city`, 100, false);
    return lat === undefined || lng === undefined || address === undefined ? undefined
      : { lat, lng, address, postcode: postcode ?? null, city: city ?? null };
  };
  const pickup = place('pickup');
  const dropoff = place('dropoff');
  let van_type: string | undefined;
  if (typeof b.van_type !== 'string' || !VAN_HOURLY_RATES[b.van_type]) {
    c.fail('van_type', `must be one of: ${Object.keys(VAN_HOURLY_RATES).join(', ')}`);
  } else van_type = b.van_type;
  const helpers = c.int(b, 'helpers', 'helpers', 0, 6, false) ?? 0;
  const estimated_hours = c.num(b, 'estimated_hours', 'estimated_hours', 1, 24, false) ?? PRICING.minimumHours;
  let additional_services: string[] = [];
  if (b.additional_services !== undefined && b.additional_services !== null) {
    const extras = b.additional_services;
    const known = Object.keys(PRICING.extras);
    if (!Array.isArray(extras) || extras.some(e => typeof e !== 'string' || !known.includes(e))) {
      c.fail('additional_services', `must be a list of: ${known.join(', ')}`);
    } else additional_services = [...new Set(extras as string[])];
  }
  return { pickup, dropoff, van_type, helpers, estimated_hours, additional_services };
}

export function validateQuote(body: unknown): Valid<QuoteInput> {
  if (!isObj(body)) return { ok: false, errors: [{ field: 'body', message: 'must be a JSON object' }] };
  const c = new Checker();
  const m = moveInput(c, body, false);
  if (c.errors.length) return { ok: false, errors: c.errors };
  return { ok: true, value: m as QuoteInput };
}

export interface Contact { name: string; phone: string; email: string | null }

function contactInput(c: Checker, b: Obj, emailRequired: boolean): Contact | undefined {
  const o = c.obj(b, 'contact', 'contact');
  if (!o) return undefined;
  const name = c.str(o, 'name', 'contact.name', 200);
  const phone = c.str(o, 'phone', 'contact.phone', 40);
  const email = c.str(o, 'email', 'contact.email', 254, emailRequired);
  if (email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) c.fail('contact.email', 'must be an email address');
  return name === undefined || phone === undefined ? undefined : { name, phone, email: email ?? null };
}

export interface BookingInput extends QuoteInput {
  pickup:  { lat: number; lng: number; address: string; postcode: string | null; city: string | null };
  dropoff: { lat: number; lng: number; address: string; postcode: string | null; city: string | null };
  move_type: string;
  move_date: string;
  move_time: string | null;
  contact: Contact;
  notes: string | null;
}

/** Oslo's calendar date of an instant, YYYY-MM-DD. */
export function osloDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function validateBooking(body: unknown, now: Date = new Date()): Valid<BookingInput> {
  if (!isObj(body)) return { ok: false, errors: [{ field: 'body', message: 'must be a JSON object' }] };
  const c = new Checker();
  const m = moveInput(c, body, true);
  const move_type = c.str(body, 'move_type', 'move_type', 40, false) ?? 'office';
  const move_date = c.str(body, 'move_date', 'move_date', 10);
  if (move_date !== undefined) {
    if (!isCalendarDate(move_date)) c.fail('move_date', 'must be a date, YYYY-MM-DD');
    else if (move_date < osloDate(now)) c.fail('move_date', 'must be today or later');
  }
  const move_time = c.str(body, 'move_time', 'move_time', 5, false);
  if (move_time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(move_time)) c.fail('move_time', 'must be a time, HH:MM');
  const contact = contactInput(c, body, true);
  const notes = c.str(body, 'notes', 'notes', 2000, false);
  if (c.errors.length) return { ok: false, errors: c.errors };
  return { ok: true, value: { ...(m as QuoteInput), pickup: m.pickup as BookingInput['pickup'], dropoff: m.dropoff as BookingInput['dropoff'],
                              move_type, move_date: move_date!, move_time: move_time ?? null, contact: contact!, notes: notes ?? null } };
}

export interface JobInput {
  service_id: string;
  contact: Contact;
  place: { address: string; postcode: string | null; city: string | null; lat: number | null; lng: number | null };
  description: string | null;
  preferred_time: string | null;
}

export function validateJob(body: unknown): Valid<JobInput> {
  if (!isObj(body)) return { ok: false, errors: [{ field: 'body', message: 'must be a JSON object' }] };
  const c = new Checker();
  const service_id = c.uuid(body, 'service_id', 'service_id');
  const contact = contactInput(c, body, false);
  const p = c.obj(body, 'place', 'place');
  let place: JobInput['place'] | undefined;
  if (p) {
    const address = c.str(p, 'address', 'place.address', 300);
    const postcode = c.str(p, 'postcode', 'place.postcode', 10, false) ?? null;
    const city = c.str(p, 'city', 'place.city', 100, false) ?? null;
    const lat = c.num(p, 'lat', 'place.lat', -90, 90, false) ?? null;
    const lng = c.num(p, 'lng', 'place.lng', -180, 180, false) ?? null;
    if (address !== undefined) place = { address, postcode, city, lat, lng };
  }
  const description = c.str(body, 'description', 'description', 4000, false) ?? null;
  const preferred_time = c.str(body, 'preferred_time', 'preferred_time', 200, false) ?? null;
  if (c.errors.length) return { ok: false, errors: c.errors };
  return { ok: true, value: { service_id: service_id!, contact: contact!, place: place!, description, preferred_time } };
}

export interface AppointmentInput {
  service_id: string;
  resource_id: string | null;
  starts_at: string;
  contact: Contact;
  notes: string | null;
}

/** An instant with its offset: 2026-11-02T10:00:00+01:00 or …Z. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

export function validateAppointment(body: unknown): Valid<AppointmentInput> {
  if (!isObj(body)) return { ok: false, errors: [{ field: 'body', message: 'must be a JSON object' }] };
  const c = new Checker();
  const service_id = c.uuid(body, 'service_id', 'service_id');
  const resource_id = c.uuid(body, 'resource_id', 'resource_id', false) ?? null;
  const starts_at = c.str(body, 'starts_at', 'starts_at', 40);
  if (starts_at !== undefined && (!INSTANT.test(starts_at) || Number.isNaN(Date.parse(starts_at)))) {
    c.fail('starts_at', 'must be a date and time with its offset, e.g. 2026-11-02T10:00:00+01:00');
  }
  const contact = contactInput(c, body, false);
  const notes = c.str(body, 'notes', 'notes', 2000, false) ?? null;
  if (c.errors.length) return { ok: false, errors: c.errors };
  return { ok: true, value: { service_id: service_id!, resource_id, starts_at: starts_at!, contact: contact!, notes } };
}

export interface ListQuery { limit: number; before: string | null; status: string | null }

const BOOKING_STATUSES = ['pending', 'confirmed', 'driver_assigned', 'pickup_arrived', 'loading', 'in_transit', 'completed', 'cancelled'];

export function validateListQuery(q: URLSearchParams, statuses: readonly string[] = BOOKING_STATUSES): Valid<ListQuery> {
  const errors: FieldError[] = [];
  let limit = 25;
  const l = q.get('limit');
  if (l !== null) {
    if (!/^\d+$/.test(l) || Number(l) < 1 || Number(l) > 100) errors.push({ field: 'limit', message: 'must be a whole number from 1 to 100' });
    else limit = Number(l);
  }
  const before = q.get('before');
  if (before !== null && (!INSTANT.test(before) || Number.isNaN(Date.parse(before)))) {
    errors.push({ field: 'before', message: 'must be a date and time with its offset (the created_at of the last item you have)' });
  }
  const status = q.get('status');
  if (status !== null && !statuses.includes(status)) errors.push({ field: 'status', message: `must be one of: ${statuses.join(', ')}` });
  return errors.length ? { ok: false, errors } : { ok: true, value: { limit, before, status } };
}

export function validateSlotsQuery(q: URLSearchParams): Valid<{ service_id: string; date: string; resource_id: string | null }> {
  const errors: FieldError[] = [];
  const service_id = q.get('service_id') ?? '';
  if (!UUID.test(service_id)) errors.push({ field: 'service_id', message: 'is required (a UUID from /v1/appointments/services)' });
  const date = q.get('date') ?? '';
  if (!isCalendarDate(date)) errors.push({ field: 'date', message: 'is required, YYYY-MM-DD' });
  const resource_id = q.get('resource_id');
  if (resource_id !== null && !UUID.test(resource_id)) errors.push({ field: 'resource_id', message: 'must be a UUID' });
  return errors.length ? { ok: false, errors }
    : { ok: true, value: { service_id: service_id.toLowerCase(), date, resource_id: resource_id?.toLowerCase() ?? null } };
}

/* ─── Idempotency ──────────────────────────────────────────────── */

/** The Idempotency-Key header: 1–255 visible ASCII characters, or none. */
export function idempotencyKey(header: string | null): { ok: true; value: string | null } | { ok: false; error: string } {
  if (header === null) return { ok: true, value: null };
  if (!/^[\x21-\x7e]{1,255}$/.test(header)) return { ok: false, error: 'Idempotency-Key must be 1 to 255 visible ASCII characters' };
  return { ok: true, value: header };
}

/** JSON with object keys sorted, so equal requests hash equally. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** What makes two writes "the same request" for an Idempotency-Key. */
export function requestHash(method: string, path: string, body: unknown): Promise<string> {
  return sha256Hex(`${method.toUpperCase()} ${path}\n${canonicalJson(body)}`);
}

/* ─── Prices ───────────────────────────────────────────────────── */

/** The quote calculate-price gives (same formula and rounding). */
export function quoteFor(input: Pick<QuoteInput, 'van_type' | 'helpers' | 'estimated_hours' | 'additional_services'>,
                         route: RouteResult) {
  const b = calculateServerPrice({
    vanType: input.van_type, hours: input.estimated_hours, distanceKm: route.distance_km,
    helpers: input.helpers, extras: input.additional_services,
  });
  return {
    object: 'quote', currency: 'NOK',
    distance_km: route.distance_km, duration_minutes: route.duration_minutes, routing_provider: route.provider,
    price_subtotal: Math.round(b.subtotal), vat_amount: Math.round(b.vat), price_total: Math.round(b.total),
    breakdown: {
      base_price: Math.round(b.base_price), distance_charge: Math.round(b.distance_charge),
      helpers_charge: Math.round(b.helpers_charge), extras_charge: Math.round(b.extras_charge),
    },
  };
}

/* ─── Errors ───────────────────────────────────────────────────── */

/** HTTP status and error code for a database error's SQLSTATE. */
export function dbError(sqlstate: string | undefined): { status: number; code: string } {
  switch (sqlstate) {
    case '28000': return { status: 401, code: 'invalid_key' };
    case '42501': return { status: 403, code: 'forbidden' };
    case 'P0002': return { status: 404, code: 'not_found' };
    case '23505': return { status: 422, code: 'idempotency_key_reused' };
    case '22023': case '23514': case '22P02': case '22007': case '22008': case '23502':
      return { status: 422, code: 'invalid_request' };
    case '55000': return { status: 409, code: 'conflict' };
    default:      return { status: 500, code: 'server_error' };
  }
}

export function errorBody(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message, ...extra } };
}
