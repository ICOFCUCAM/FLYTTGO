import { describe, expect, it } from 'vitest';
import {
  VAN_HOURLY_RATES,
  bookingChargeNok,
  bookingCoordinates,
  calculateServerPrice,
  computeCommission,
  haversineFallback,
  paidAmountMatches,
  routeDistance,
  subscriptionCharge,
  refundAmountFor,
  pickupAt,
  planSlug,
} from '../../supabase/functions/_shared/pricing.ts';
import { VAN_TYPES, calculatePrice as browserPrice } from '../lib/constants';

describe('server price formula', () => {
  it('matches the browser preview formula for every van', () => {
    for (const van of VAN_TYPES) {
      expect(VAN_HOURLY_RATES[van.id]).toBe(van.pricePerHour);
      const extras = ['cleaning', 'furniture_assembly'];
      const server = calculateServerPrice({ vanType: van.id, hours: 3, distanceKm: 64, helpers: 1, extras });
      const browser = browserPrice(van.id, 3, 64, 1, extras);
      expect(server.total).toBeCloseTo(browser.total, 6);
      expect(server.vat).toBeCloseTo(browser.vat, 6);
    }
  });

  it('applies the 2-hour minimum, 20 included km and 25% MVA', () => {
    const p = calculateServerPrice({ vanType: 'medium_van', hours: 1, distanceKm: 30, helpers: 0, extras: [] });
    expect(p.base_price).toBe(1150 * 2);
    expect(p.distance_charge).toBe(10 * 8);
    expect(p.total).toBe((2300 + 80) * 1.25);
  });
});

describe('booking charge', () => {
  const booking = {
    van_type: 'medium_van', estimated_hours: 2, helpers: 0, additional_services: [],
    pickup_lat: 59.91, pickup_lng: 10.75, dropoff_lat: 59.95, dropoff_lng: 10.8,
  };

  it('charges the VAT-inclusive total once, in whole kroner', () => {
    expect(bookingChargeNok(booking, { distance_km: 10 })).toBe(2875);
  });

  it('ignores unknown extras and negative helpers from the stored row', () => {
    const tampered = { ...booking, helpers: -5, additional_services: ['free_money', 42] };
    expect(bookingChargeNok(tampered, { distance_km: 10 })).toBe(2875);
  });

  it('needs valid coordinates', () => {
    expect(bookingCoordinates(booking)).toEqual([59.91, 10.75, 59.95, 10.8]);
    expect(bookingCoordinates({ ...booking, pickup_lat: null })).toBeNull();
    expect(bookingCoordinates({ ...booking, dropoff_lat: 120 })).toBeNull();
  });

  it('falls back to haversine × 1.4 when routing fails', async () => {
    const failing = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const route = await routeDistance(59.91, 10.75, 60.39, 5.32, failing);
    expect(route).toEqual(haversineFallback(59.91, 10.75, 60.39, 5.32));
    expect(route.provider).toBe('haversine-fallback');
  });

  it('uses the OSRM distance when available', async () => {
    const ok = async () => ({ ok: true, status: 200, json: async () => ({ routes: [{ distance: 463200, duration: 24660 }] }) });
    const route = await routeDistance(59.91, 10.75, 60.39, 5.32, ok);
    expect(route).toEqual({ distance_km: 463.2, duration_minutes: 411, provider: 'OSRM' });
  });
});

describe('driver subscription charge', () => {
  it('prices plans from the server table, VAT included', () => {
    expect(subscriptionCharge('pro', null)?.total).toBe(1500 + 375);
    expect(subscriptionCharge('pro_mini', null)?.total).toBe(149 + 37);
    expect(subscriptionCharge('unlimited', null)?.total).toBe(2449 + 612);
  });

  it('has nothing to charge for free plans or unknown ids', () => {
    expect(subscriptionCharge('free', null)).toBeNull();
    expect(subscriptionCharge('basic', null)).toBeNull();
    expect(subscriptionCharge('platinum', null)).toBeNull();
  });

  it('prorates Pro → Unlimited like the driver portal', () => {
    const now = new Date(2026, 9, 11);          // 11 Oct, 31-day month
    const start = new Date(2026, 9, 1).toISOString();
    const c = subscriptionCharge('unlimited', { plan: 'pro', subscription_status: 'active', start_date: start }, now)!;
    // 10 days used → 21 remaining → credit round(1500/31 × 21) = 1016
    expect(c.prorated).toBe(true);
    expect(c.creditExVat).toBe(1016);
    expect(c.amountExVat).toBe(2449 - 1016);
    expect(c.total).toBe(c.amountExVat + Math.round(c.amountExVat * 0.25));
  });

  it('does not prorate from an expired Pro plan', () => {
    const c = subscriptionCharge('unlimited', { plan: 'pro', subscription_status: 'expired', start_date: new Date().toISOString() })!;
    expect(c.prorated).toBe(false);
    expect(c.amountExVat).toBe(2449);
  });
});

describe('webhook amount check', () => {
  it('accepts only the exact amount in NOK', () => {
    expect(paidAmountMatches(287500, 'nok', 2875)).toBe(true);
    expect(paidAmountMatches(287500, 'NOK', 2875)).toBe(true);
    expect(paidAmountMatches(100, 'nok', 2875)).toBe(false);
    expect(paidAmountMatches(287500, 'eur', 2875)).toBe(false);
    expect(paidAmountMatches(null, 'nok', 2875)).toBe(false);
    expect(paidAmountMatches(287500, 'nok', null)).toBe(false);
  });
});

describe('commission', () => {
  it('keeps the bracket model', () => {
    expect(computeCommission(400, 'basic').commission).toBe(0);
    expect(computeCommission(1000, 'basic')).toEqual({ commission: 200, earning: 800, ratePct: 20 });
    expect(computeCommission(3000, 'pro')).toEqual({ commission: 150, earning: 2850, ratePct: 5 });
    expect(computeCommission(9000, 'unlimited').commission).toBe(0);
    expect(computeCommission(1000, 'unknown').ratePct).toBe(20);
  });
});

describe('refund amount (dashboard rule, on what was paid)', () => {
  it('shares by status', () => {
    expect(refundAmountFor({ status: 'pending', price_estimate: 2875 })).toBe(2875);
    expect(refundAmountFor({ status: 'driver_assigned', price_estimate: 2875 })).toBe(2300);
    expect(refundAmountFor({ status: 'in_transit', price_estimate: 2875 })).toBe(1438);
    expect(refundAmountFor({ status: 'completed', price_estimate: 2875 })).toBe(0);
    expect(refundAmountFor({ status: 'cancelled', price_estimate: 2875 })).toBe(0);
  });

  it('uses the amount actually paid and the manual percentage', () => {
    expect(refundAmountFor({ status: 'pending', price_estimate: 9999, paid_amount: 2875 })).toBe(2875);
    expect(refundAmountFor({ status: 'completed', paid_amount: 2000, manual_refund_percent: 50 })).toBe(1000);
    expect(refundAmountFor({ status: 'pending', paid_amount: 2000, manual_refund_percent: 150 })).toBe(2000);
  });
});

describe('cancellation policy (Terms §6.1)', () => {
  const booking = { status: 'cancelled', paid_amount: 2875, move_date: '2026-11-20', move_time: '09:00' };
  // Pickup 2026-11-20 09:00 Oslo (UTC+1) = 08:00Z.

  it('reads the pickup in Oslo time, winter and summer', () => {
    expect(pickupAt('2026-11-20', '09:00')?.toISOString()).toBe('2026-11-20T08:00:00.000Z');
    expect(pickupAt('2026-07-01T00:00:00+00:00', '09:00:00')?.toISOString()).toBe('2026-07-01T07:00:00.000Z');
    expect(pickupAt(null, '09:00')).toBeNull();
  });

  it('refunds in full more than 24 hours before pickup', () => {
    expect(refundAmountFor({ ...booking, cancelled_by: 'customer', cancelled_at: '2026-11-19T07:59:00Z' })).toBe(2875);
  });

  it('keeps 50% within 24 hours', () => {
    expect(refundAmountFor({ ...booking, cancelled_by: 'customer', cancelled_at: '2026-11-19T08:00:00Z' })).toBe(1438);
    expect(refundAmountFor({ ...booking, cancelled_by: 'customer', cancelled_at: '2026-11-20T10:00:00Z' })).toBe(1438);
  });

  it('refunds in full when FlyttGo or the driver cancels', () => {
    expect(refundAmountFor({ ...booking, cancelled_by: 'platform', cancelled_at: '2026-11-20T07:00:00Z' })).toBe(2875);
    expect(refundAmountFor({ ...booking, cancelled_by: 'driver', cancelled_at: '2026-11-20T07:00:00Z' })).toBe(2875);
  });

  it('leaves a cancellation from before the policy to a manual decision', () => {
    expect(refundAmountFor({ ...booking })).toBe(0);
    expect(refundAmountFor({ ...booking, manual_refund_percent: 100 })).toBe(2875);
  });
});

describe('plan slugs', () => {
  it('match SQL plan_slug()', () => {
    expect(planSlug('Pro Mini')).toBe('pro_mini');
    expect(planSlug(' Unlimited ')).toBe('unlimited');
    expect(planSlug(null)).toBeNull();
  });
});
