/**
 * A company's shop on its own page (/b/<slug>/shop, 00020,
 * docs/SERVICE_PLATFORM.md): the catalogue (visitors browse without
 * signing in), the cart (kept in this browser), and checkout for a
 * signed-in customer: pickup or shipping as the company offers it, the
 * seller, the total incl. MVA and delivery from the database (shop_quote,
 * the same computation the order uses), the 14-day right of withdrawal,
 * then card payment into the company's own Stripe account (shop-checkout).
 * The company is the seller; the page says so.
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { useWhiteLabel } from '../lib/whiteLabelContext';
import { textOn } from '../lib/whiteLabel';
import { formatNok } from '../lib/invoicing';
import {
  addToCart, cartCount, imageUrl, loadCart, loadCatalogue, payOrder, placeOrder, quote, saveCart, setCartQuantity,
  type CartItem, type ShopOrder, type ShopProduct, type ShopQuote, type ShopSettings, type ShopVariant,
} from '../lib/shop';
import { useContact } from '../hooks/useContact';

const input = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm';

export default function ShopPage() {
  const { site } = useWhiteLabel();
  const { user } = useAuth();
  const { setPage, setShowAuthModal, setAuthMode } = useApp();
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [variants, setVariants] = useState<ShopVariant[]>([]);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [delivery, setDelivery] = useState<'pickup' | 'shipping'>('pickup');
  const [address, setAddress] = useState({ address: '', postcode: '', city: '' });
  const [contact, setContact] = useContact();
  const [q, setQ] = useState<ShopQuote | null>(null);
  const [qError, setQError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [placed, setPlaced] = useState<ShopOrder | null>(null);

  const orgId = site?.organization_id ?? null;
  useEffect(() => {
    if (!orgId) return;
    setCart(loadCart(orgId));
    loadCatalogue(orgId).then(c => {
      setProducts(c.products.filter(p => p.active)); setVariants(c.variants.filter(v => v.active)); setSettings(c.settings); setLoaded(true);
      if (c.settings && !c.settings.pickup_enabled) setDelivery('shipping');
    });
  }, [orgId]);
  useEffect(() => { if (orgId) saveCart(orgId, cart); }, [orgId, cart]);
  useEffect(() => {
    if (!orgId || cart.length === 0 || !settings) { setQ(null); setQError(''); return; }
    let live = true;
    const t = setTimeout(() => quote(orgId, cart, delivery).then(r => { if (live) { setQ(r.quote); setQError(r.error ?? ''); } }), 250);
    return () => { live = false; clearTimeout(t); };
  }, [orgId, cart, delivery, settings]);

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  if (!site) return <div className="min-h-[50vh] flex items-center justify-center text-gray-500">This shop isn't available.</div>;
  const accent = site.accent_color ?? '#10b981';
  const s = site.seller;
  const lineName = (c: CartItem) => {
    const p = byId.get(c.product_id); const v = variants.find(x => x.id === c.variant_id);
    return p ? `${p.name}${v ? ` (${v.name})` : ''}` : 'No longer sold';
  };

  async function checkout() {
    if (!orgId) return;
    setBusy(true); setError('');
    let order = placed;
    if (!order) {
      const r = await placeOrder(orgId, cart, delivery, delivery === 'shipping' ? address : null, contact);
      if (r.error || !r.order) { setBusy(false); setError(r.error ?? 'the order could not be placed'); return; }
      order = r.order; setPlaced(order); setCart([]);
    }
    const pay = await payOrder(order.id);
    setBusy(false);
    if (pay.ok && pay.data?.url) { window.location.href = pay.data.url; return; }
    setError(`Order ${order.number} is placed and its goods are held for you, but the card payment could not be opened: ${pay.data?.error ?? 'try again'}. You can pay it under My services.`);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-extrabold text-gray-900 mb-1">Shop</h1>
      <p className="text-gray-500 mb-6">{site.display_name}</p>
      {!site.shop && <p>This page has no shop.</p>}
      {site.shop && (
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 grid sm:grid-cols-2 gap-4 content-start">
            {products.map(p => <ProductCard key={p.id} p={p} variants={variants.filter(v => v.product_id === p.id)} accent={accent}
              onAdd={(variantId, quantity) => setCart(c => addToCart(c, { product_id: p.id, variant_id: variantId, quantity }))} />)}
            {loaded && products.length === 0 && <p className="text-sm text-gray-500">Nothing for sale yet.</p>}
            {!loaded && <p className="text-sm text-gray-400">Loading…</p>}
          </div>

          <aside className="bg-white border rounded-2xl p-5 h-fit space-y-4 lg:sticky lg:top-20">
            <h2 className="font-bold text-lg">Cart ({cartCount(cart)})</h2>
            {placed && <div className="rounded-xl bg-amber-50 text-amber-800 text-sm px-3 py-2">Order {placed.number} is waiting for payment ({formatNok(placed.total)}).</div>}
            {cart.length === 0 && !placed && <p className="text-sm text-gray-500">The cart is empty.</p>}
            {cart.map(c => (
              <div key={`${c.product_id}:${c.variant_id}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex-1">{lineName(c)}</span>
                <input type="number" min={0} max={999} value={c.quantity} aria-label="Quantity" className="border rounded-lg px-2 py-1 w-16"
                  onChange={e => setCart(cs => setCartQuantity(cs, c.product_id, c.variant_id, Number(e.target.value)))} />
                <button onClick={() => setCart(cs => setCartQuantity(cs, c.product_id, c.variant_id, 0))} className="text-gray-400" aria-label="Remove">×</button>
              </div>
            ))}

            {cart.length > 0 && settings && (
              <>
                <fieldset className="space-y-2 text-sm">
                  <legend className="font-semibold mb-1">Delivery</legend>
                  {settings.pickup_enabled && <label className="flex gap-2"><input type="radio" checked={delivery === 'pickup'} onChange={() => setDelivery('pickup')} />
                    <span>Pickup, free{settings.pickup_address ? ` · ${settings.pickup_address}` : ''}{settings.pickup_note ? ` · ${settings.pickup_note}` : ''}</span></label>}
                  {settings.shipping_enabled && <label className="flex gap-2"><input type="radio" checked={delivery === 'shipping'} onChange={() => setDelivery('shipping')} />
                    <span>Shipping {formatNok(settings.shipping_price)}{settings.free_shipping_over ? `, free from ${formatNok(settings.free_shipping_over)}` : ''}
                      {settings.shipping_note ? ` · ${settings.shipping_note}` : ''}</span></label>}
                </fieldset>
                {delivery === 'shipping' && (
                  <div className="grid grid-cols-3 gap-2">
                    <label className="col-span-3 text-sm">Address<input className={input} value={address.address} onChange={e => setAddress({ ...address, address: e.target.value })} /></label>
                    <label className="text-sm">Postcode<input className={input} inputMode="numeric" value={address.postcode} onChange={e => setAddress({ ...address, postcode: e.target.value })} /></label>
                    <label className="col-span-2 text-sm">Town<input className={input} value={address.city} onChange={e => setAddress({ ...address, city: e.target.value })} /></label>
                  </div>
                )}
                <div className="grid gap-2">
                  <label className="text-sm">Name<input className={input} value={contact.name} onChange={e => setContact({ ...contact, name: e.target.value })} /></label>
                  <label className="text-sm">Phone<input className={input} value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} /></label>
                  <label className="text-sm">Email (order confirmation)<input className={input} value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} /></label>
                </div>
                {q && (
                  <div className="text-sm space-y-1 border-t pt-3">
                    {q.lines.map(l => <div key={`${l.product_id}:${l.variant_id}`} className="flex justify-between"><span>{l.quantity} × {l.name}</span><span>{formatNok(l.total)}</span></div>)}
                    <div className="flex justify-between"><span>{q.delivery_method === 'shipping' ? 'Shipping' : 'Pickup'}</span><span>{formatNok(q.delivery_price)}</span></div>
                    <div className="flex justify-between font-bold text-base"><span>Total incl. MVA</span><span>{formatNok(q.total)}</span></div>
                  </div>
                )}
                {qError && <p className="text-sm text-red-600">{qError}</p>}
              </>
            )}

            {(cart.length > 0 || placed) && (
              <div className="text-xs text-gray-600 space-y-2 border-t pt-3">
                <p><strong>Seller:</strong> {s.name}{s.org_number ? `, org. nr. ${s.org_number}${s.vat_registered ? ' MVA' : ''}` : ''}{s.address ? `, ${s.address}` : ''}
                  {site.support.email ? `, ${site.support.email}` : ''}{site.support.phone ? `, ${site.support.phone}` : ''}.</p>
                <p><strong>Right of withdrawal:</strong> you may withdraw from the purchase without giving a reason within 14 days of receiving the goods,
                  with the button under My services or the form in the order confirmation.
                  {settings?.return_cost_customer === false ? ` ${site.display_name} pays to send the goods back.` : ' You pay to send the goods back.'}
                  {' '}The money goes back to the card you paid with.</p>
                {site.terms_url && <p>The shop's terms: <a className="underline" href={site.terms_url} target="_blank" rel="noopener noreferrer">{site.terms_url}</a>
                  {site.privacy_url && <> · <a className="underline" href={site.privacy_url} target="_blank" rel="noopener noreferrer">privacy</a></>}</p>}
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {(cart.length > 0 || placed) && (!user ? (
              <button onClick={() => { setAuthMode('signin'); setShowAuthModal(true); }} className="w-full py-3 rounded-xl bg-gray-900 text-white font-semibold">Sign in to order</button>
            ) : (
              <button disabled={busy || (!placed && (!q || !!qError))} onClick={checkout} style={{ background: accent, color: textOn(accent) }}
                className="w-full py-3 rounded-xl font-semibold disabled:opacity-50">
                {placed ? `Pay ${formatNok(placed.total)} by card` : `Order and pay ${q ? formatNok(q.total) : ''}`}
              </button>
            ))}
            {placed && <button onClick={() => setPage('my-services')} className="w-full text-sm underline">My services</button>}
          </aside>
        </div>
      )}
      <p className="text-xs text-gray-500 mt-8">{site.seller_notice}</p>
    </div>
  );
}

function ProductCard({ p, variants, accent, onAdd }: { p: ShopProduct; variants: ShopVariant[]; accent: string;
  onAdd: (variantId: string | null, quantity: number) => void }) {
  const [variant, setVariant] = useState<string>(variants[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const [img, setImg] = useState(0);
  const v = variants.find(x => x.id === variant);
  const price = v?.price ?? p.price;
  const left = p.track_stock ? (variants.length ? v?.stock ?? 0 : p.stock) : null;
  return (
    <div className="bg-white border rounded-2xl overflow-hidden flex flex-col">
      {p.images.length > 0 && (
        <button onClick={() => setImg((img + 1) % p.images.length)} className="block aspect-square bg-gray-50" aria-label="Next picture">
          <img src={imageUrl(p.images[img])} alt={p.name} className="w-full h-full object-cover" />
        </button>
      )}
      <div className="p-4 flex-1 flex flex-col gap-2">
        <div className="flex justify-between gap-2"><h3 className="font-semibold">{p.name}</h3><span className="font-semibold whitespace-nowrap">{formatNok(price)}</span></div>
        <div className="text-xs text-gray-500">incl. {p.vat_rate} % MVA</div>
        {p.description && <p className="text-sm text-gray-600 whitespace-pre-line">{p.description}</p>}
        {variants.length > 0 && (
          <label className="text-sm">{p.variant_label ?? 'Variant'}
            <select className="w-full border rounded-lg px-2 py-1.5 mt-1" value={variant} onChange={e => setVariant(e.target.value)}>
              {variants.map(x => <option key={x.id} value={x.id}>{x.name}{x.price ? ` · ${formatNok(x.price)}` : ''}{p.track_stock && x.stock === 0 ? ' · sold out' : ''}</option>)}
            </select></label>
        )}
        {left !== null && <div className={`text-xs ${left === 0 ? 'text-red-600' : 'text-gray-500'}`}>{left === 0 ? 'Sold out' : left <= 5 ? `Only ${left} left` : 'In stock'}</div>}
        <div className="flex gap-2 mt-auto">
          <input type="number" min={1} max={999} value={qty} onChange={e => setQty(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
            aria-label="Quantity" className="border rounded-lg px-2 py-1.5 w-16 text-sm" />
          <button disabled={left === 0} onClick={() => onAdd(variants.length ? variant : null, qty)} style={{ background: accent, color: textOn(accent) }}
            className="flex-1 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">Add to cart</button>
        </div>
      </div>
    </div>
  );
}
