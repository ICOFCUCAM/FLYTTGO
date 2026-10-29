import { describe, expect, it, vi } from 'vitest';
import { bookingFor, pageHasShop, sellerNotice } from '../../supabase/functions/_shared/white-label.ts';
import { APPROVAL_REASON_LABELS, approvalNotice, interpretCheck, type CheckDecision } from '../../supabase/functions/_shared/spending';

vi.mock('../lib/supabase', () => ({ supabase: {}, callFunction: vi.fn() }));
const { ADDON_LABELS, PRICE_STATUS_LABELS, addonPrice } = await import('../lib/whiteLabel');

const nok = (n: number) => `${n} kr`;

describe('a company page with its plan and add-ons (00022)', () => {
  it('a booking module and a shop: the page books, and shows the shop beside it', () => {
    const modules = ['appointments', 'sales_invoicing', 'shop'];
    expect(bookingFor(modules)).toBe('appointments');
    expect(pageHasShop(modules)).toBe(true);
  });

  it('a shop alone stays a shop page; no shop, no shop link', () => {
    expect(bookingFor(['sales_invoicing', 'shop'])).toBe('none');
    expect(pageHasShop(['sales_invoicing', 'shop'])).toBe(true);
    expect(pageHasShop(['jobs', 'sales_invoicing'])).toBe(false);
    expect(pageHasShop(null)).toBe(false);
  });

  it('the API add-on is not on the page: a transport page still books moves', () => {
    expect(bookingFor(['api'])).toBe('moves');
    expect(bookingFor(['api', 'jobs', 'sales_invoicing'])).toBe('jobs');
    const site = { seller_model: 'flyttgo' as const, display_name: 'Acme Flytt', seller: { name: 'FlyttGo AS', org_number: '923609016' } };
    expect(sellerNotice({ ...site, modules: ['api'] })).toContain('Moves booked here are sold and carried out by FlyttGo AS');
  });
});

describe('prices: pilot, proposals and add-ons', () => {
  it('names each price status', () => {
    expect(PRICE_STATUS_LABELS.pilot).toBe('Pilot pricing');
    expect(PRICE_STATUS_LABELS.proposed).toBe('Proposed price');
    expect(PRICE_STATUS_LABELS.confirmed).toBe('Confirmed price');
  });

  it('an add-on is priced by its written quote or its approved pilot price, nothing derived', () => {
    expect(addonPrice({ pricing: 'quote', setup_fee: null, monthly_fee: null, quote_reference: 'Q-2026-14', price_note: null }, nok))
      .toBe('By written quote Q-2026-14');
    expect(addonPrice({ pricing: 'pilot', setup_fee: null, monthly_fee: 590, quote_reference: null, price_note: 'approved' }, nok))
      .toBe('Pilot price: 590 kr / month (excl. MVA)');
    expect(addonPrice({ pricing: 'pilot', setup_fee: 900, monthly_fee: 590, quote_reference: null, price_note: 'approved' }, nok))
      .toBe('Pilot price: 590 kr / month, 900 kr set-up (excl. MVA)');
    expect(ADDON_LABELS.api).toBe('API access');
    expect(ADDON_LABELS.shop).toBe('Online shop');
  });
});

describe('an approval is for its amount (00022)', () => {
  it('a different price after approval asks again, and says why', () => {
    const d = interpretCheck({ status: 'pending', new: true, amount: 1750, reasons: ['role', 'price_changed'] }) as Extract<CheckDecision, { proceed: false }>;
    expect(d.proceed).toBe(false);
    expect(d.approval?.reasons).toEqual(['role', 'price_changed']);
    expect(d.error).toContain(APPROVAL_REASON_LABELS.price_changed);
    expect(approvalNotice(['price_changed'])).toBe(
      'This booking is at a different price from the one approved. It waits for your company\'s approval and is not paid or dispatched until then.');
  });
});
