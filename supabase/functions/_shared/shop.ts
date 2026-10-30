// ============================================================================
// FlyttGo — online shops: what the functions build (00020, docs/SERVICE_PLATFORM.md)
// ============================================================================
//
// The database holds the catalogue, takes the stock, records payments and
// refunds; this module builds what is sent out from it:
//   shopCheckoutForm()      the Stripe Checkout session on the company's
//                           account: the order's lines and delivery, its
//                           total in øre, no application fee
//   withdrawalDeadline()    the last day of the 14-day right of withdrawal
//   orderConfirmationEmail() the confirmation the customer keeps (seller,
//                           lines, total incl. MVA and delivery, the right
//                           of withdrawal and the standard form)
//
// No Deno or network imports, so the Vitest suite (src/test/shop.test.ts)
// runs them.
// ============================================================================

export interface ShopOrder {
  id: string; organization_id: string; number: number; customer: { name: string; phone?: string; email: string };
  delivery_method: 'pickup' | 'shipping'; delivery_address?: { address: string; postcode: string; city: string } | null;
  items_total: number | string; delivery_price: number | string; total: number | string;
  expires_at: string; connected_account_id: string | null; created_at?: string;
}
export interface ShopOrderLine {
  line_no: number; name: string; sku?: string | null; quantity: number; unit_price: number | string; vat_rate: number | string;
  total: number | string;
}
export interface ShopSeller {
  name: string | null; org_number?: string | null; address?: string | null; postcode_city?: string | null;
  email?: string | null; phone?: string | null;
}
export interface ShopTerms {
  terms_url?: string | null; pickup_address?: string | null; pickup_note?: string | null; shipping_note?: string | null;
  return_cost_customer?: boolean;
}

const ore = (n: number | string) => Math.round(Number(n) * 100);

/**
 * The Checkout session for an order (form fields for POST
 * /v1/checkout/sessions with Stripe-Account: the company's account). The
 * lines add up to exactly the order's total, and metadata.amount_ore is
 * what stripe-webhook checks the payment against. The page expires two
 * minutes before the order's stock is released (shop_checkout_begin keeps
 * it at least 33 minutes ahead; Stripe needs at least 30).
 */
export function shopCheckoutForm(
  order: ShopOrder, lines: ShopOrderLine[],
  opts: { frontendUrl: string; sellerName: string; customerEmail?: string | null; now?: Date },
): URLSearchParams {
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.append('payment_method_types[]', 'card');
  const items = [...lines].sort((a, b) => a.line_no - b.line_no)
    .map(l => ({ name: l.name, quantity: l.quantity, unit: ore(l.unit_price) }));
  if (ore(order.delivery_price) > 0) {
    items.push({ name: order.delivery_method === 'shipping' ? 'Frakt' : 'Henting', quantity: 1, unit: ore(order.delivery_price) });
  }
  const sum = items.reduce((s, i) => s + i.unit * i.quantity, 0);
  if (sum !== ore(order.total)) throw new Error(`order ${order.number}: lines come to ${sum} øre, the order to ${ore(order.total)}`);
  items.forEach((i, n) => {
    p.set(`line_items[${n}][quantity]`, String(i.quantity));
    p.set(`line_items[${n}][price_data][currency]`, 'nok');
    p.set(`line_items[${n}][price_data][unit_amount]`, String(i.unit));
    p.set(`line_items[${n}][price_data][product_data][name]`, i.name.slice(0, 250));
  });
  const base = opts.frontendUrl.replace(/\/$/, '');
  p.set('success_url', `${base}/my-services?order=paid`);
  p.set('cancel_url', `${base}/my-services?order=cancelled`);
  p.set('client_reference_id', order.id);
  if (opts.customerEmail) p.set('customer_email', opts.customerEmail);
  const now = (opts.now ?? new Date()).getTime();
  const expires = Math.floor(new Date(order.expires_at).getTime() / 1000) - 120;
  p.set('expires_at', String(Math.max(expires, Math.ceil(now / 1000) + 30 * 60)));
  const meta = {
    type: 'shop_order', order_id: order.id, amount_ore: String(ore(order.total)),
    connected_account: order.connected_account_id ?? '', seller: opts.sellerName.slice(0, 200),
  };
  for (const [k, v] of Object.entries(meta)) {
    p.set(`metadata[${k}]`, v);
    p.set(`payment_intent_data[metadata][${k}]`, v);
  }
  return p;
}

/** The last day (YYYY-MM-DD, Europe/Oslo) to withdraw: 14 days after the
 *  day the goods were delivered or collected; null before that. */
export function withdrawalDeadline(deliveredAt: string | null | undefined): string | null {
  if (!deliveredAt) return null;
  const day = new Date(deliveredAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 14);
  return d.toISOString().slice(0, 10);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** "1 234,50 kr" */
export function kr(n: number | string): string {
  const [i, d] = (Math.round(Number(n) * 100) / 100).toFixed(2).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${d} kr`;
}

/**
 * The order confirmation, in Norwegian, as the customer's copy on a
 * durable medium: who sells, what was bought, the total incl. MVA and
 * delivery, how it is delivered, and the right of withdrawal with the
 * standard form. Its wording is for the company's lawyer to confirm
 * (docs/SERVICE_PLATFORM.md); it states only what the platform does.
 */
export function orderConfirmationEmail(
  order: ShopOrder, lines: ShopOrderLine[], seller: ShopSeller, terms: ShopTerms, opts: { frontendUrl: string },
): { subject: string; html: string } {
  const sellerName = seller.name ?? 'Butikken';
  const rows = [...lines].sort((a, b) => a.line_no - b.line_no).map(l =>
    `<tr><td>${esc(l.quantity)} × ${esc(l.name)}</td><td style="text-align:right">${esc(kr(l.total))}</td></tr>`).join('');
  const delivery = order.delivery_method === 'shipping'
    ? `Sendes til ${esc(order.delivery_address?.address)}, ${esc(order.delivery_address?.postcode)} ${esc(order.delivery_address?.city)}.${terms.shipping_note ? ` ${esc(terms.shipping_note)}` : ''}`
    : `Hentes hos ${esc(sellerName)}${terms.pickup_address ? `, ${esc(terms.pickup_address)}` : ''}.${terms.pickup_note ? ` ${esc(terms.pickup_note)}` : ''} Du får beskjed når ordren er klar.`;
  const sellerLine = [sellerName, seller.org_number ? `org.nr. ${seller.org_number}` : null, seller.address, seller.postcode_city,
                      seller.email, seller.phone].filter(Boolean).map(esc).join(', ');
  const base = opts.frontendUrl.replace(/\/$/, '');
  const html = `<p>Hei ${esc(order.customer.name)},</p>
<p>Takk for bestillingen hos <strong>${esc(sellerName)}</strong>. Betalingen er mottatt.</p>
<p><strong>Ordre ${esc(order.number)}</strong></p>
<table cellpadding="4" style="border-collapse:collapse">${rows}
<tr><td>${order.delivery_method === 'shipping' ? 'Frakt' : 'Henting'}</td><td style="text-align:right">${esc(kr(order.delivery_price))}</td></tr>
<tr><td><strong>Totalt inkl. mva.</strong></td><td style="text-align:right"><strong>${esc(kr(order.total))}</strong></td></tr></table>
<p>${delivery}</p>
<p>Kvitteringen finner du under <a href="${base}/my-services">Mine tjenester</a>.</p>
<h3>Angrerett</h3>
<p>Du kan gå fra kjøpet uten å oppgi grunn innen 14 dager etter at du har mottatt varene. Gi beskjed til ${esc(sellerName)}
før fristen er ute, med knappen «Angre kjøpet» under <a href="${base}/my-services">Mine tjenester</a>, eller med skjemaet under.
${terms.return_cost_customer === false ? `${esc(sellerName)} betaler for å sende varene tilbake.` : 'Du betaler selv for å sende varene tilbake.'}
Når du har gått fra kjøpet, får du pengene tilbake til kortet du betalte med.${terms.terms_url ? ` Salgsvilkårene finner du på <a href="${esc(terms.terms_url)}">${esc(terms.terms_url)}</a>.` : ''}</p>
<p><strong>Angreskjema</strong> (fyll ut og returner dette skjemaet dersom du ønsker å gå fra avtalen)<br>
Til: ${sellerLine}<br>
Jeg underretter herved om at jeg ønsker å gå fra min avtale om kjøp av følgende varer: …<br>
Bestilt den: ${esc(order.created_at ? new Date(order.created_at).toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo' }) : '…')} (ordre ${esc(order.number)}) / mottatt den: …<br>
Forbrukerens navn: …<br>Forbrukerens adresse: …<br>Dato: …<br>Forbrukerens underskrift (kun dersom skjemaet sendes på papir): …</p>
<p>Selger: ${sellerLine}.</p>`;
  return { subject: `Ordrebekreftelse ${order.number} fra ${sellerName}`, html };
}
