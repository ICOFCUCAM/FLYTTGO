import { describe, expect, it, vi } from 'vitest';
import { kr, orderConfirmationEmail, shopCheckoutForm, withdrawalDeadline, type ShopOrder, type ShopOrderLine } from '../../supabase/functions/_shared/shop.ts';
import { stripeRefund } from '../../supabase/functions/_shared/refunds.ts';
import { sellerNotice } from '../../supabase/functions/_shared/white-label.ts';

vi.mock('../lib/supabase', () => ({ supabase: {}, callFunction: vi.fn() }));
const lib = await import('../lib/shop');

/* The order the database test pays (supabase/tests/shop.test.sql): 2 mugs,
 * an M T-shirt and a coffee, shipped for 99 kr. */
const order: ShopOrder = {
  id: 'o1', organization_id: 'org1', number: 7, customer: { name: 'Kari <Nordmann>', phone: '+47 900 00 000', email: 'kari@example.no' },
  delivery_method: 'shipping', delivery_address: { address: 'Storgata 5', postcode: '0155', city: 'Oslo' },
  items_total: 806, delivery_price: 99, total: 905, expires_at: '2026-10-29T12:40:00Z', connected_account_id: 'acct_1Acme',
  created_at: '2026-10-29T12:00:00Z',
};
const lines: ShopOrderLine[] = [
  { line_no: 2, name: 'T-shirt (M)', quantity: 1, unit_price: 279, vat_rate: 25, total: 279 },
  { line_no: 1, name: 'Mug', quantity: 2, unit_price: '199', vat_rate: 25, total: 398 },
  { line_no: 3, name: 'Coffee', quantity: 1, unit_price: 129, vat_rate: 15, total: 129 },
];

describe('the Checkout session for a shop order', () => {
  const now = new Date('2026-10-29T12:05:00Z');
  const form = shopCheckoutForm(order, lines, { frontendUrl: 'https://flyttgo.no/', sellerName: 'Acme Butikk AS', customerEmail: 'kari@example.no', now });

  it('lists the lines in order and the delivery, adding up to the total in øre', () => {
    expect(form.get('line_items[0][price_data][product_data][name]')).toBe('Mug');
    expect(form.get('line_items[0][quantity]')).toBe('2');
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('19900');
    expect(form.get('line_items[3][price_data][product_data][name]')).toBe('Frakt');
    let sum = 0;
    for (let i = 0; form.has(`line_items[${i}][quantity]`); i++) {
      sum += Number(form.get(`line_items[${i}][quantity]`)) * Number(form.get(`line_items[${i}][price_data][unit_amount]`));
      expect(form.get(`line_items[${i}][price_data][currency]`)).toBe('nok');
    }
    expect(sum).toBe(90500);
  });

  it('carries what stripe-webhook checks: type, order, amount and the shop\'s account, on the session and the payment', () => {
    for (const prefix of ['metadata', 'payment_intent_data[metadata]']) {
      expect(form.get(`${prefix}[type]`)).toBe('shop_order');
      expect(form.get(`${prefix}[order_id]`)).toBe('o1');
      expect(form.get(`${prefix}[amount_ore]`)).toBe('90500');
      expect(form.get(`${prefix}[connected_account]`)).toBe('acct_1Acme');
    }
    expect(form.get('payment_intent_data[application_fee_amount]')).toBeNull();     // FlyttGo takes no fee
    expect(form.get('success_url')).toBe('https://flyttgo.no/my-services?order=paid');
  });

  it('expires two minutes before the stock is released, and never sooner than Stripe allows', () => {
    expect(Number(form.get('expires_at'))).toBe(Date.parse(order.expires_at) / 1000 - 120);
    const early = shopCheckoutForm({ ...order, expires_at: '2026-10-29T12:10:00Z' }, lines, { frontendUrl: 'x', sellerName: 'A', now });
    expect(Number(early.get('expires_at'))).toBeGreaterThanOrEqual(now.getTime() / 1000 + 30 * 60);
  });

  it('refuses an order whose lines do not add up (never charges another amount)', () => {
    expect(() => shopCheckoutForm({ ...order, total: 900 }, lines, { frontendUrl: 'x', sellerName: 'A' })).toThrow(/90500 øre, the order to 90000/);
  });

  it('has no delivery line for free pickup', () => {
    const f = shopCheckoutForm({ ...order, delivery_method: 'pickup', delivery_price: 0, total: 806 }, lines, { frontendUrl: 'x', sellerName: 'A' });
    expect(f.has('line_items[3][quantity]')).toBe(false);
  });
});

describe('the right of withdrawal', () => {
  it('runs 14 days from the day of delivery, in Oslo', () => {
    expect(withdrawalDeadline('2026-10-29T10:00:00Z')).toBe('2026-11-12');
    expect(withdrawalDeadline('2026-10-29T23:30:00Z')).toBe('2026-11-13');     // already 30 October in Oslo
    expect(withdrawalDeadline(null)).toBeNull();
    expect(lib.withdrawalDeadline('2026-10-29T23:30:00Z')).toBe('2026-11-13');  // the browser says the same
  });

  it('is open from payment until the goods are returned or refunded', () => {
    expect(lib.canWithdraw({ status: 'awaiting_payment' })).toBe(false);
    expect(lib.canWithdraw({ status: 'paid' })).toBe(true);
    expect(lib.canWithdraw({ status: 'delivered' })).toBe(true);
    expect(lib.canWithdraw({ status: 'refunded' })).toBe(false);
  });

  it('the confirmation states the seller, the total incl. MVA and delivery, the 14 days and the form', () => {
    const m = orderConfirmationEmail(order, lines,
      { name: 'Acme Butikk AS', org_number: '923609016', address: 'Torget 1', postcode_city: '0150 Oslo', email: 'post@acme.no' },
      { terms_url: 'https://acme.no/vilkar', return_cost_customer: true, shipping_note: 'Posten, 2–4 dager' }, { frontendUrl: 'https://flyttgo.no' });
    expect(m.subject).toBe('Ordrebekreftelse 7 fra Acme Butikk AS');
    expect(m.html).toContain('905,00 kr');
    expect(m.html).toContain('Totalt inkl. mva.');
    expect(m.html).toContain('99,00 kr');
    expect(m.html).toContain('innen 14 dager');
    expect(m.html).toContain('Angreskjema');
    expect(m.html).toContain('org.nr. 923609016');
    expect(m.html).toContain('Du betaler selv for å sende varene tilbake');
    expect(m.html).toContain('https://acme.no/vilkar');
    expect(m.html).toContain('Kari &lt;Nordmann&gt;');                          // escaped
    expect(m.html).not.toContain('<Nordmann>');
    expect(orderConfirmationEmail(order, lines, { name: 'A' }, { return_cost_customer: false }, { frontendUrl: 'x' }).html).toContain('A betaler for å sende');
  });

  it('writes amounts the Norwegian way', () => {
    expect(kr(1234.5)).toBe('1 234,50 kr');
    expect(kr('99')).toBe('99,00 kr');
  });
});

describe('refunds of shop orders on the company\'s account', () => {
  it('go to its account with their own metadata and give back no fee (FlyttGo took none)', async () => {
    const calls: { url: string; init: any }[] = [];
    const fetchFn = async (url: string, init?: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 're_1', status: 'succeeded', amount: 77600 }) };
    };
    const out = await stripeRefund(fetchFn, 'sk_test', {
      paymentIntentId: 'pi_1', amountOre: 77600, idempotencyKey: 'flyttgo-shop-refund-r1', refundId: 'r1', bookingId: 'o1',
      stripeAccount: 'acct_1Acme', refundApplicationFee: false, metadata: { type: 'shop_refund', shop_refund_id: 'r1', order_id: 'o1' },
    });
    expect(out).toEqual({ kind: 'succeeded', providerRefundId: 're_1' });
    expect(calls[0].init.headers['Stripe-Account']).toBe('acct_1Acme');
    expect(calls[0].init.headers['Idempotency-Key']).toBe('flyttgo-shop-refund-r1');
    const body = new URLSearchParams(calls[0].init.body);
    expect(body.get('refund_application_fee')).toBeNull();
    expect(body.get('metadata[type]')).toBe('shop_refund');
    expect(body.get('metadata[shop_refund_id]')).toBe('r1');
    expect(body.get('metadata[refund_id]')).toBeNull();                         // never mistaken for a booking's refund
    expect(body.get('metadata[booking_id]')).toBeNull();
  });
});

describe('the seller notice outside transport', () => {
  it('names the company as the seller of what the page offers, not of moves', () => {
    expect(sellerNotice({ seller_model: 'company', display_name: 'Acme Butikk', seller: { name: 'Acme AS', org_number: '987654321' }, modules: ['shop', 'sales_invoicing'] }))
      .toBe('Acme AS (org. nr. 987654321) is the seller of everything offered on this page. FlyttGo AS provides the booking and payment platform.');
    expect(sellerNotice({ seller_model: 'company', display_name: 'Acme Flytt', seller: { name: 'Acme AS' }, modules: [] }))
      .toBe('Acme AS sells the moves booked here. FlyttGo AS carries them out as its subcontractor.');
  });
});

describe('the cart and the company\'s order steps', () => {
  it('adds to a line, caps at 999 and removes at 0', () => {
    let c = lib.addToCart([], { product_id: 'p', variant_id: null, quantity: 2 });
    c = lib.addToCart(c, { product_id: 'p', variant_id: null, quantity: 3 });
    c = lib.addToCart(c, { product_id: 'p', variant_id: 'm', quantity: 1 });
    expect(c).toEqual([{ product_id: 'p', variant_id: null, quantity: 5 }, { product_id: 'p', variant_id: 'm', quantity: 1 }]);
    expect(lib.cartCount(c)).toBe(6);
    expect(lib.setCartQuantity(c, 'p', null, 5000)[0].quantity).toBe(999);
    expect(lib.setCartQuantity(c, 'p', 'm', 0)).toEqual([{ product_id: 'p', variant_id: null, quantity: 5 }]);
  });

  it('offers the next steps the database allows, by delivery', () => {
    expect(lib.nextStatuses({ status: 'paid', delivery_method: 'shipping' })).toEqual(['packed', 'shipped']);
    expect(lib.nextStatuses({ status: 'packed', delivery_method: 'pickup' })).toEqual(['ready_for_pickup']);
    expect(lib.nextStatuses({ status: 'ready_for_pickup', delivery_method: 'pickup' })).toEqual(['collected']);
    expect(lib.nextStatuses({ status: 'shipped', delivery_method: 'shipping' })).toEqual(['delivered', 'returned']);
    expect(lib.nextStatuses({ status: 'awaiting_payment', delivery_method: 'pickup' })).toEqual([]);
    expect(lib.nextStatuses({ status: 'refunded', delivery_method: 'pickup' })).toEqual([]);
  });
});
