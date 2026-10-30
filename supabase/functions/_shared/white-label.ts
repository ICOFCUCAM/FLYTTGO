// ============================================================================
// FlyttGo — white-label seller models (docs/WHITE_LABEL.md)
// ============================================================================
//
// Model A (FlyttGo sells): nothing changes in the payment. The customer
// pays FlyttGo's price to FlyttGo, by card or Vipps.
//
// Model B (the company sells): the customer pays the company's price into
// the company's own Stripe account (a direct charge on a connected
// account). FlyttGo takes, as Stripe's application fee:
//   its price for the move (what it would charge the customer itself),
//   plus the platform fee: platform_fee_pct of that price without MVA, at
//   least platform_fee_min, plus 25% MVA.
// The company's price is FlyttGo's price plus its markup, and never less
// than what FlyttGo takes, so a booking never costs the seller money.
//
// No Deno or network imports: the Vitest suite runs these
// (src/test/white-label.test.ts), and the browser shows the same price
// before payment.
// ============================================================================

export interface SellerPricing {
  markup_pct: number | string | null | undefined;
  platform_fee_pct: number | string | null | undefined;
  platform_fee_min: number | string | null | undefined;
}

export interface SellerSplit {
  /** What the customer pays the company (NOK incl. MVA, whole kroner). */
  customerPrice: number;
  /** FlyttGo's platform fee (NOK incl. MVA). */
  platformFee: number;
  /** FlyttGo's price for the move (NOK incl. MVA). */
  flyttgoPrice: number;
  /** Taken by FlyttGo from the payment, in øre: its price plus the fee. */
  applicationFeeOre: number;
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function sellerSplit(flyttgoPrice: number, pricing: SellerPricing): SellerSplit {
  const price = Math.round(n(flyttgoPrice) * 100) / 100;
  const feeExVat = Math.max(n(pricing.platform_fee_min), (price / 1.25) * n(pricing.platform_fee_pct) / 100);
  const platformFee = Math.round(feeExVat * 1.25 * 100) / 100;
  const markedUp = Math.round(price * (1 + Math.min(100, Math.max(0, n(pricing.markup_pct))) / 100));
  const customerPrice = Math.max(markedUp, Math.ceil(price + platformFee));
  return {
    customerPrice,
    platformFee,
    flyttgoPrice: price,
    applicationFeeOre: Math.round((price + platformFee) * 100),
  };
}

/** What a company's page books (docs/SERVICE_PLATFORM.md): FlyttGo's moves
 * on a transport plan, otherwise the company's own module from its plan or
 * an add-on on it ('none' when it only has others, e.g. a shop, 00020).
 * The API add-on (00022) is not on the page and changes nothing here. */
export type PageBooking = 'moves' | 'jobs' | 'appointments' | 'restaurant' | 'hotel' | 'none';

/** Modules a company can have that are not part of its page. */
const NOT_ON_PAGE: readonly string[] = ['api'];

/** Whether the page shows a shop beside (or instead of) its booking: in the
 * header and its navigation, and at /b/<slug>/shop. */
export function pageHasShop(modules: readonly string[] | null | undefined): boolean {
  return (modules ?? []).includes('shop');
}

export function bookingFor(modules: readonly string[] | null | undefined): PageBooking {
  const m = (modules ?? []).filter(x => !NOT_ON_PAGE.includes(x));
  if (m.includes('jobs')) return 'jobs';
  if (m.includes('appointments')) return 'appointments';
  if (m.includes('hotel_reservations')) return 'hotel';
  if (m.includes('restaurant_reservations')) return 'restaurant';
  return m.length === 0 ? 'moves' : 'none';
}

/** The public page's seller notice, shown on every page and at payment.
 * A page outside transport (its plan has modules: jobs, appointments,
 * tables, rooms, a shop) sells the company's own work and goods, not moves;
 * FlyttGo only provides the booking and payment platform. Outside transport
 * is read from the page's booking, or from its modules when no booking is
 * given. */
export function sellerNotice(site: {
  seller_model: 'flyttgo' | 'company';
  display_name?: string | null;
  seller?: { name?: string | null; org_number?: string | null } | null;
  booking?: PageBooking;
  modules?: readonly string[] | null;
}): string {
  const s = site.seller ?? {};
  const org = s.org_number ? ` (org. nr. ${s.org_number})` : '';
  const outsideTransport = site.booking ? site.booking !== 'moves' : bookingFor(site.modules) !== 'moves';
  if (outsideTransport) {
    return `${s.name ?? site.display_name ?? 'The company'}${org} is the seller of everything offered on this page. FlyttGo AS provides the booking and payment platform.`;
  }
  return site.seller_model === 'company'
    ? `${s.name ?? site.display_name ?? 'The company'}${org} sells the moves booked here. FlyttGo AS carries them out as its subcontractor.`
    : `Moves booked here are sold and carried out by ${s.name ?? 'FlyttGo AS'}${org}, for ${site.display_name ?? 'this company'}.`;
}
