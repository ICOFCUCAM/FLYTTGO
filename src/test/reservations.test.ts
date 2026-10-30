import { describe, expect, it, vi } from 'vitest';
import { bookingFor, sellerNotice } from '../../supabase/functions/_shared/white-label.ts';

vi.mock('../lib/supabase', () => ({ supabase: {}, callFunction: vi.fn() }));
const { nightsBetween, noShowFeeFor, stayCancellation, stayCancellationRule, timesByPeriod } = await import('../lib/reservations');
const { bookingLabel, ownBooking } = await import('../lib/whiteLabel');

describe('which booking a company page offers', () => {
  it('follows the plan\'s modules, as white-label-site does', () => {
    expect(bookingFor([])).toBe('moves');
    expect(bookingFor(null)).toBe('moves');
    expect(bookingFor(['jobs', 'sales_invoicing'])).toBe('jobs');
    expect(bookingFor(['appointments', 'sales_invoicing'])).toBe('appointments');
    expect(bookingFor(['restaurant_reservations', 'sales_invoicing'])).toBe('restaurant');
    expect(bookingFor(['hotel_reservations', 'sales_invoicing'])).toBe('hotel');
    expect(bookingFor(['hotel_reservations', 'restaurant_reservations', 'sales_invoicing'])).toBe('hotel');
    expect(bookingFor(['sales_invoicing'])).toBe('none');
  });

  it('labels the button and books the company\'s own services outside moving', () => {
    expect(bookingLabel('restaurant')).toBe('Book a table');
    expect(bookingLabel('hotel')).toBe('Book a room');
    expect(bookingLabel('moves')).toBe('Book a move');
    expect(bookingLabel('none', 'Get a price and book')).toBe('Get a price and book');
    expect(ownBooking('restaurant') && ownBooking('hotel') && ownBooking('jobs') && ownBooking('appointments')).toBe(true);
    expect(ownBooking('moves') || ownBooking('none') || ownBooking(undefined)).toBe(false);
  });

  it('names the company as the seller and FlyttGo as the booking and payment platform outside moving', () => {
    const site = { seller_model: 'company' as const, display_name: 'Acme Bistro', seller: { name: 'Acme Bistro AS', org_number: '987654321' } };
    expect(sellerNotice({ ...site, booking: 'restaurant' }))
      .toBe('Acme Bistro AS (org. nr. 987654321) is the seller of everything offered on this page. FlyttGo AS provides the booking and payment platform.');
    expect(sellerNotice({ ...site, booking: 'moves' })).toContain('sells the moves booked here');
    expect(sellerNotice(site)).toContain('sells the moves booked here');
  });
});

describe('hotel nights and cancellation, as the database computes them', () => {
  it('counts nights by date, also over a change to or from summer time', () => {
    expect(nightsBetween('2027-03-27', '2027-03-29')).toBe(2);
    expect(nightsBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(nightsBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(nightsBetween('2026-11-02', '2026-11-02')).toBe(0);
    expect(nightsBetween('', '2026-11-02')).toBe(0);
  });

  it('copies the rule stated before the booking: free until N days before, then a share', () => {
    expect(stayCancellationRule({ free_cancel_days: 3, late_cancel_fee_pct: 50 }, '2026-11-10', 2240)).toEqual({ freeUntil: '2026-11-07', fee: 1120 });
    expect(stayCancellationRule({ free_cancel_days: 0, late_cancel_fee_pct: 33 }, '2026-11-01', 1000)).toEqual({ freeUntil: '2026-11-01', fee: 330 });
    expect(stayCancellationRule({ free_cancel_days: 2, late_cancel_fee_pct: null }, '2026-11-10', 2240)).toEqual({ freeUntil: null, fee: null });
    expect(stayCancellationRule(null, '2026-11-10', 2240)).toEqual({ freeUntil: null, fee: null });
  });

  it('lets the guest cancel online until the day before arrival, with the fee after the last free day', () => {
    const stay = { status: 'booked' as const, check_in: '2026-11-10', free_cancel_until: '2026-11-07', late_cancel_fee: 1120 };
    expect(stayCancellation(stay, '2026-11-07')).toEqual({ online: true, fee: null });
    expect(stayCancellation(stay, '2026-11-08')).toEqual({ online: true, fee: 1120 });
    expect(stayCancellation(stay, '2026-11-10')).toEqual({ online: false, fee: null });
    expect(stayCancellation({ ...stay, status: 'cancelled' }, '2026-11-01').online).toBe(false);
    expect(stayCancellation({ ...stay, free_cancel_until: null, late_cancel_fee: null }, '2026-11-09')).toEqual({ online: true, fee: null });
  });
});

describe('restaurant', () => {
  it('shows the no-show fee a booking made now would carry', () => {
    expect(noShowFeeFor({ no_show_fee: 200, no_show_fee_per: 'guest' }, 2)).toBe(400);
    expect(noShowFeeFor({ no_show_fee: 300, no_show_fee_per: 'booking' }, 6)).toBe(300);
    expect(noShowFeeFor({ no_show_fee: null, no_show_fee_per: 'guest' }, 2)).toBeNull();
    expect(noShowFeeFor(null, 2)).toBeNull();
  });

  it('groups free times by service period in order', () => {
    const t = (h: string, period: string | null) => ({ starts_at: h, ends_at: h, period });
    expect(timesByPeriod([t('11:30', 'Lunch'), t('11:45', 'Lunch'), t('17:00', 'Dinner')]).map(g => [g.period, g.times.length]))
      .toEqual([['Lunch', 2], ['Dinner', 1]]);
    expect(timesByPeriod([])).toEqual([]);
  });
});
