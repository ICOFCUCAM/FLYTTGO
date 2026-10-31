import { describe, expect, it } from 'vitest';
import {
  billedHours, bookingChargeNok, calculateServerPrice, flooredDistanceKm, straightLineKm, PRICING,
} from '../../supabase/functions/_shared/pricing.ts';
import { checkBookingLocations, geocodeNorway, judgePoint, postcodeOf, TOLERANCE_KM } from '../../supabase/functions/_shared/address-check.ts';
import { VAN_TYPES, billedHours as browserBilledHours, calculatePrice as browserPrice } from '../lib/constants';

/* The three money fixes of 31 October 2026 (booking-charge.ts): the stored points are checked against the
 * addresses, the distance is never shorter than the straight line, and the drive time is billed when it is
 * longer than the hours chosen. */

const OSLO = { lat: 59.9139, lng: 10.7522 };
const BERGEN = { lat: 60.3913, lng: 5.3221 };

describe('billed hours', () => {
  it('bills the hours chosen, or the drive time when longer, never below the minimum', () => {
    expect(billedHours(1, 30)).toBe(PRICING.minimumHours);
    expect(billedHours(3, 60)).toBe(3);
    expect(billedHours(2, 411)).toBe(7);          // 6 h 51 min of driving → 7 h
    expect(billedHours(2, 390)).toBe(6.5);
    expect(billedHours(8, 411)).toBe(8);
    expect(billedHours(2, null)).toBe(2);
  });

  it('a long drive booked as 2 hours is billed for the drive', () => {
    const p = calculateServerPrice({ vanType: 'large_van', hours: 2, distanceKm: 463, helpers: 1, extras: [], routeMinutes: 411 });
    expect(p.billed_hours).toBe(7);
    expect(p.route_hours_applied).toBe(true);
    expect(p.base_price).toBe(1500 * 7);
    expect(p.helpers_charge).toBe(350 * 7);
    const short = calculateServerPrice({ vanType: 'large_van', hours: 3, distanceKm: 12, helpers: 0, extras: [], routeMinutes: 20 });
    expect(short.route_hours_applied).toBe(false);
    expect(short.base_price).toBe(1500 * 3);
  });

  it('the payment charge uses the route\'s duration', () => {
    const b = { van_type: 'medium_van', estimated_hours: 2, helpers: 0, additional_services: [] };
    expect(bookingChargeNok(b, { distance_km: 463, duration_minutes: 411 }))
      .toBe(Math.round((1150 * 7 + (463 - 20) * 8) * 1.25));
    expect(bookingChargeNok(b, { distance_km: 10 })).toBe(Math.round(1150 * 2 * 1.25));
  });
});

describe('browser and server price the same (parity over every combination)', () => {
  it('agree on every van, hours, distance, drive time, helpers and extras, reduced to one fingerprint', () => {
    const extrasSets = [[], ['cleaning'], ['packing_service', 'furniture_assembly', 'parking_assistance']];
    let count = 0, total = 0, weighted = 0, mismatches = 0;
    for (const van of VAN_TYPES) for (const hours of [1, 2, 3.5, 6]) for (const km of [0, 20, 21, 64, 463])
      for (const minutes of [null, 15, 200, 411]) for (const helpers of [0, 1, 3]) for (const extras of extrasSets) {
        const s = calculateServerPrice({ vanType: van.id, hours, distanceKm: km, helpers, extras, routeMinutes: minutes });
        const c = browserPrice(van.id, hours, km, helpers, extras, minutes);
        if (Math.round(s.total) !== Math.round(c.total) || s.billed_hours !== c.billedHours) mismatches++;
        count++;
        total += Math.round(s.total);
        weighted += Math.round(s.total) * count;          // positional, so offsetting errors cannot cancel
        expect(browserBilledHours(hours, minutes)).toBe(billedHours(hours, minutes));
      }
    expect(mismatches).toBe(0);
    expect(count).toBe(4 * 4 * 5 * 4 * 3 * 3);
    expect(total).toBeGreaterThan(0);
    expect(weighted).toBeGreaterThan(total);
  });
});

describe('distance floor', () => {
  it('a route is never shorter than the straight line between the points', () => {
    const coords: [number, number, number, number] = [OSLO.lat, OSLO.lng, BERGEN.lat, BERGEN.lng];
    const crow = straightLineKm(...coords);
    expect(crow).toBeGreaterThan(300);
    expect(flooredDistanceKm({ distance_km: 5 }, coords)).toBeCloseTo(Math.round(crow * 10) / 10, 5);
    expect(flooredDistanceKm({ distance_km: 463 }, coords)).toBe(463);
  });
});

describe('address check', () => {
  type Hit = { lat: number; lon: number; postnummer: string };
  const register = (answers: Record<string, Hit | null>, calls: string[] = []) => async (url: string) => {
    calls.push(url);
    const key = Object.keys(answers).find(k => url.includes(k));
    const hit = key ? answers[key] : null;
    return { ok: true, status: 200, json: async () => ({ adresser: hit ? [{ representasjonspunkt: { lat: hit.lat, lon: hit.lon }, postnummer: hit.postnummer }] : [] }) };
  };

  it('reads the postcode from an address line', () => {
    expect(postcodeOf('Storgata 1, 0155 Oslo')).toBe('0155');
    expect(postcodeOf('Bryggen 5, 5003 Bergen')).toBe('5003');
    expect(postcodeOf('Somewhere without one')).toBeNull();
  });

  it('finds the address, retries on the postcode, and never throws', async () => {
    const calls: string[] = [];
    const f = register({ 'sok=Storgata': { lat: OSLO.lat, lon: OSLO.lng, postnummer: '0155' }, 'postnummer=5003': { lat: BERGEN.lat, lon: BERGEN.lng, postnummer: '5003' } }, calls);
    expect(await geocodeNorway('Storgata 1, 0155 Oslo', f)).toMatchObject({ precision: 'address' });
    expect(await geocodeNorway('Ukjent vei 99, 5003 Bergen', f)).toMatchObject({ precision: 'postcode' });
    expect(calls.some(u => u.includes('postnummer=5003'))).toBe(true);
    const broken = async () => { throw new Error('down'); };
    expect(await geocodeNorway('Storgata 1, 0155 Oslo', broken)).toBeNull();
    expect(await geocodeNorway('', f)).toBeNull();
  });

  it('a similar street in another postcode is not taken as the address', async () => {
    const f = register({ 'sok=': { lat: 63.43, lon: 10.39, postnummer: '7011' } });
    expect(await geocodeNorway('Storgata 1, 0155 Oslo', f)).toBeNull();
  });

  it('keeps a point near its address, replaces one far from it, and marks one it cannot check', () => {
    expect(judgePoint(OSLO, { lat: OSLO.lat + 0.005, lng: OSLO.lng, precision: 'address' }).status).toBe('confirmed');
    expect(judgePoint(OSLO, { ...BERGEN, precision: 'address' })).toMatchObject({ status: 'corrected', point: BERGEN });
    expect(judgePoint(OSLO, { lat: OSLO.lat + 0.15, lng: OSLO.lng, precision: 'postcode' }).status).toBe('confirmed');   // ~17 km, inside a postcode's tolerance
    expect(TOLERANCE_KM.postcode).toBeGreaterThan(TOLERANCE_KM.address);
    expect(judgePoint(OSLO, null)).toMatchObject({ status: 'unconfirmed', point: OSLO });
  });

  it('an Oslo→Bergen booking sent with two Oslo points is priced to Bergen', async () => {
    const f = register({ 'sok=Storgata': { lat: OSLO.lat, lon: OSLO.lng, postnummer: '0155' }, 'sok=Bryggen': { lat: BERGEN.lat, lon: BERGEN.lng, postnummer: '5003' } });
    const spoofed: [number, number, number, number] = [OSLO.lat, OSLO.lng, OSLO.lat + 0.01, OSLO.lng + 0.01];
    const check = await checkBookingLocations({ pickup_address: 'Storgata 1, 0155 Oslo', dropoff_address: 'Bryggen 5, 5003 Bergen' }, spoofed, f);
    expect(check.pickup).toBe('confirmed');
    expect(check.dropoff).toBe('corrected');
    expect(check.corrected).toBe(true);
    expect(check.coords).toEqual([OSLO.lat, OSLO.lng, BERGEN.lat, BERGEN.lng]);
    expect((check.record.dropoff as { submitted: number[] }).submitted).toEqual([spoofed[2], spoofed[3]]);
    expect(flooredDistanceKm({ distance_km: 2 }, check.coords)).toBeGreaterThan(300);
  });

  it('when the register is down the booking goes ahead on its own points, marked unconfirmed', async () => {
    const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const pts: [number, number, number, number] = [OSLO.lat, OSLO.lng, BERGEN.lat, BERGEN.lng];
    const check = await checkBookingLocations({ pickup_address: 'Storgata 1, 0155 Oslo', dropoff_address: 'Bryggen 5, 5003 Bergen' }, pts, down);
    expect(check).toMatchObject({ pickup: 'unconfirmed', dropoff: 'unconfirmed', corrected: false, coords: pts });
  });
});
