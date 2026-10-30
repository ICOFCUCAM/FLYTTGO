import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  API_KEY_PATTERN, API_SCOPES, ROUTES, apiPath, bearerKey, canonicalJson, dbError, idempotencyKey, isApiKey, matchRoute,
  osloDate, quoteFor, requestHash, sha256Hex, validateAppointment, validateBooking, validateJob, validateListQuery,
  validateQuote, validateSlotsQuery,
} from '../../supabase/functions/_shared/public-api.ts';
import { calculateServerPrice } from '../../supabase/functions/_shared/pricing.ts';

const migration = readFileSync(new URL('../../supabase/migrations/00018_api_keys.sql', import.meta.url), 'utf8');
const openapi = readFileSync(new URL('../../docs/api/openapi.yaml', import.meta.url), 'utf8');
const UUID = '0b6f2c7e-3a51-4c1e-9f0a-2d6c8e4b1a77';

const move = (over: Record<string, unknown> = {}) => ({
  pickup:  { address: 'Storgata 1, 0155 Oslo', postcode: '0155', city: 'Oslo', lat: 59.91, lng: 10.75 },
  dropoff: { address: 'Bryggen 2, 5003 Bergen', city: 'Bergen', lat: 60.39, lng: 5.32 },
  van_type: 'medium_van', helpers: 1, estimated_hours: 3, move_date: '2026-11-10', move_time: '09:00',
  contact: { name: 'Ola Lager', phone: '+47 900 00 001', email: 'lager@acme.no' },
  ...over,
});

describe('API keys', () => {
  it('have the format create_api_key makes: fgo_ and 64 hex characters', () => {
    expect(isApiKey('fgo_' + 'a1'.repeat(32))).toBe(true);
    expect(isApiKey('fgo_' + 'A1'.repeat(32))).toBe(false);
    expect(isApiKey('fgo_' + 'a'.repeat(63))).toBe(false);
    expect(isApiKey('sk_live_' + 'a'.repeat(64))).toBe(false);
    expect(isApiKey(null)).toBe(false);
    expect(migration).toContain(`v_key := 'fgo_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')`);
    expect(migration).toContain(`prefix ~ '^fgo_[0-9a-f]{8}$'`);
    expect(API_KEY_PATTERN.source).toBe('^fgo_[0-9a-f]{64}$');
  });

  it('are hashed as the database hashes them (hex SHA-256 of the UTF-8 key)', async () => {
    /* The same vector is checked in supabase/tests/api_keys.test.sql. */
    expect(await sha256Hex('fgo_' + '0'.repeat(64))).toBe('e0412e5c3e245923870fa304e2b239640311ec83c5cb49a88f0bd7e350e1ef17');
    expect(migration).toContain(`encode(sha256(convert_to(v_key, 'UTF8')), 'hex')`);
  });

  it('come only from Authorization: Bearer', () => {
    expect(bearerKey('Bearer fgo_abc')).toBe('fgo_abc');
    expect(bearerKey('bearer   fgo_abc  ')).toBe('fgo_abc');
    expect(bearerKey('Basic Zm9vOmJhcg==')).toBeNull();
    expect(bearerKey('Bearer a b')).toBeNull();
    expect(bearerKey(null)).toBeNull();
  });

  it('have the scopes the database knows, in its order', () => {
    const m = /SELECT ARRAY\[([^\]]+)\]/.exec(migration.slice(migration.indexOf('FUNCTION public.api_scopes()')));
    expect(m?.[1].split(',').map(s => s.trim().replace(/'/g, ''))).toEqual([...API_SCOPES]);
  });
});

describe('routes', () => {
  it('take the path after the function name', () => {
    expect(apiPath('/functions/v1/public-api/v1/bookings')).toBe('/v1/bookings');
    expect(apiPath('/public-api/v1/bookings/')).toBe('/v1/bookings');
    expect(apiPath('/public-api')).toBe('/');
  });

  it('match method and path, ids only as UUIDs', () => {
    const get = matchRoute('GET', `/v1/bookings/${UUID.toUpperCase()}`);
    expect(get.ok && get.route.name === 'bookings.get' && get.id === UUID).toBe(true);
    const services = matchRoute('GET', '/v1/jobs/services');
    expect(services.ok && services.route.name).toBe('jobs.services');
    expect(matchRoute('GET', '/v1/bookings/123')).toEqual({ ok: false, status: 404, allow: [] });
    expect(matchRoute('DELETE', '/v1/bookings')).toEqual({ ok: false, status: 405, allow: ['GET', 'POST'] });
    expect(matchRoute('GET', '/v2/bookings')).toMatchObject({ ok: false, status: 404 });
  });

  it('need the scope of what they do; who-am-I needs none', () => {
    const scope = (m: string, p: string) => { const r = matchRoute(m, p); return r.ok ? r.route.scope : 'none'; };
    expect(scope('GET', '/v1/me')).toBeNull();
    expect(scope('POST', '/v1/quotes')).toBe('quotes');
    expect(scope('GET', '/v1/bookings')).toBe('bookings:read');
    expect(scope('POST', '/v1/bookings')).toBe('bookings:write');
    expect(scope('GET', '/v1/appointments/slots')).toBe('appointments');
    expect(scope('POST', '/v1/jobs')).toBe('jobs');
  });

  it('are all described in docs/api/openapi.yaml, and nothing else is', () => {
    const paths = openapi.split('\npaths:\n')[1].split('\ncomponents:\n')[0];
    const described: string[] = [];
    let current = '';
    for (const line of paths.split('\n')) {
      const p = /^ {2}(\/\S+):$/.exec(line);
      if (p) { current = p[1]; continue; }
      const m = /^ {4}(get|post|put|patch|delete):$/.exec(line);
      if (m) described.push(`${m[1].toUpperCase()} ${current}`);
    }
    expect(described.sort()).toEqual(ROUTES.map(r => `${r.method} ${r.path}`).sort());
    for (const r of ROUTES.filter(x => x.scope)) {
      const section = '\n' + paths.split(`\n  ${r.path}:\n`)[1].split(/\n {2}\/v1/)[0];
      const op = section.split(`\n    ${r.method.toLowerCase()}:\n`)[1].split(/\n {4}(get|post):\n/)[0];
      expect(op, `${r.method} ${r.path}`).toMatch(new RegExp(`- apiKey: \\[("?)${r.scope}\\1\\]`));
    }
  });
});

describe('request validation', () => {
  it('accepts a quote and refuses what calculate-price could not price', () => {
    const ok = validateQuote({ pickup: { lat: 59.91, lng: 10.75 }, dropoff: { lat: 59.95, lng: 10.8 }, van_type: 'large_van' });
    expect(ok).toEqual({ ok: true, value: { pickup: { lat: 59.91, lng: 10.75 }, dropoff: { lat: 59.95, lng: 10.8 }, van_type: 'large_van',
                                            helpers: 0, estimated_hours: 2, additional_services: [] } });
    const bad = validateQuote({ pickup: { lat: 91, lng: 10 }, van_type: 'bus', helpers: 1.5, additional_services: ['piano'] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect((bad as { errors: { field: string }[] }).errors.map(e => e.field)).toEqual(['pickup.lat', 'dropoff', 'van_type', 'helpers', 'additional_services']);
    expect(validateQuote('[]')).toMatchObject({ ok: false });
  });

  it('takes a booking with addresses, a date from today in Oslo and a contact', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    const v = validateBooking(move(), now);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.move_type).toBe('office');
      expect(v.value.dropoff.postcode).toBeNull();
      expect(v.value.contact).toEqual({ name: 'Ola Lager', phone: '+47 900 00 001', email: 'lager@acme.no' });
    }
    const errs = (b: unknown) => { const r = validateBooking(b, now) as { ok: boolean; errors?: { field: string }[] }; return r.ok ? [] : r.errors!.map(e => e.field); };
    expect(errs(move({ move_date: '2026-10-31' }))).toEqual(['move_date']);
    expect(errs(move({ move_date: '2026-02-30' }))).toEqual(['move_date']);
    expect(errs(move({ move_time: '25:00' }))).toEqual(['move_time']);
    expect(errs(move({ contact: { name: 'Ola', phone: '1' } }))).toEqual(['contact.email']);
    expect(errs(move({ contact: { name: 'Ola', phone: '1', email: 'not-an-address' } }))).toEqual(['contact.email']);
    expect(errs(move({ pickup: { lat: 59.9, lng: 10.7 } }))).toEqual(['pickup.address']);
    /* The Oslo date, not UTC: 23:30 UTC on 31 October is already 1 November in Oslo. */
    expect(osloDate(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
  });

  it('takes a job request and an appointment as the module functions expect them', () => {
    expect(validateJob({ service_id: UUID, contact: { name: 'Kari', phone: '+47 1' }, place: { address: 'Bjerkelia 12' } }))
      .toEqual({ ok: true, value: { service_id: UUID, contact: { name: 'Kari', phone: '+47 1', email: null },
                                    place: { address: 'Bjerkelia 12', postcode: null, city: null, lat: null, lng: null },
                                    description: null, preferred_time: null } });
    expect(validateJob({ service_id: 'tap', contact: {}, place: {} })).toMatchObject({ ok: false });
    expect(validateAppointment({ service_id: UUID, starts_at: '2026-11-02T10:00:00+01:00', contact: { name: 'K', phone: '1' } }).ok).toBe(true);
    expect(validateAppointment({ service_id: UUID, starts_at: '2026-11-02 10:00', contact: { name: 'K', phone: '1' } }).ok).toBe(false);
    expect(validateAppointment({ service_id: UUID, resource_id: 'eva', starts_at: '2026-11-02T09:00:00Z', contact: { name: 'K', phone: '1' } }).ok).toBe(false);
  });

  it('checks list and free-time queries', () => {
    expect(validateListQuery(new URLSearchParams(''))).toEqual({ ok: true, value: { limit: 25, before: null, status: null } });
    expect(validateListQuery(new URLSearchParams('limit=100&status=completed&before=2026-11-01T00:00:00Z')).ok).toBe(true);
    expect(validateListQuery(new URLSearchParams('limit=101')).ok).toBe(false);
    expect(validateListQuery(new URLSearchParams('status=lost')).ok).toBe(false);
    expect(validateListQuery(new URLSearchParams('status=booked'), ['booked']).ok).toBe(true);
    expect(validateSlotsQuery(new URLSearchParams(`service_id=${UUID}&date=2026-11-02`)).ok).toBe(true);
    expect(validateSlotsQuery(new URLSearchParams(`service_id=${UUID}&date=2.11.2026`)).ok).toBe(false);
  });
});

describe('idempotency', () => {
  it('takes 1 to 255 visible ASCII characters', () => {
    expect(idempotencyKey(null)).toEqual({ ok: true, value: null });
    expect(idempotencyKey('order-4711')).toEqual({ ok: true, value: 'order-4711' });
    expect(idempotencyKey('').ok).toBe(false);
    expect(idempotencyKey('with space').ok).toBe(false);
    expect(idempotencyKey('x'.repeat(256)).ok).toBe(false);
  });

  it('hashes the same request equally, whatever the key order', async () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: null }] })).toBe('{"a":[{"c":null,"d":2}],"b":1}');
    const a = await requestHash('POST', '/v1/bookings', { van_type: 'small_van', helpers: 1 });
    expect(await requestHash('post', '/v1/bookings', { helpers: 1, van_type: 'small_van' })).toBe(a);
    expect(await requestHash('POST', '/v1/bookings', { helpers: 2, van_type: 'small_van' })).not.toBe(a);
    expect(await requestHash('POST', '/v1/jobs', { van_type: 'small_van', helpers: 1 })).not.toBe(a);
  });
});

describe('quotes and errors', () => {
  it('price as calculate-price does', () => {
    const route = { distance_km: 64, duration_minutes: 55, provider: 'OSRM' as const };
    const q = quoteFor({ van_type: 'medium_van', helpers: 1, estimated_hours: 3, additional_services: ['cleaning'] }, route);
    const b = calculateServerPrice({ vanType: 'medium_van', hours: 3, distanceKm: 64, helpers: 1, extras: ['cleaning'] });
    expect(q).toMatchObject({ object: 'quote', currency: 'NOK', distance_km: 64, price_total: Math.round(b.total),
                              vat_amount: Math.round(b.vat), price_subtotal: Math.round(b.subtotal) });
  });

  it('map database refusals to HTTP', () => {
    expect(dbError('28000')).toEqual({ status: 401, code: 'invalid_key' });
    expect(dbError('42501').status).toBe(403);
    expect(dbError('P0002').status).toBe(404);
    expect(dbError('55000')).toEqual({ status: 409, code: 'conflict' });
    expect(dbError('23505')).toEqual({ status: 422, code: 'idempotency_key_reused' });
    expect(dbError('22023').status).toBe(422);
    expect(dbError('XX000').status).toBe(500);
  });
});
