/**
 * Corporate dashboard → Shop (00020): the company's orders (pack, ship or
 * ready for pickup, delivered or collected; the receipt), returns (the
 * customers' withdrawals, refunds through Stripe with a credit note), the
 * products with pictures, variants and stock, and the delivery options.
 * Owners and admins keep the catalogue, staff count stock and work orders,
 * owners, admins and finance refund. The database checks every step.
 */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import type { Membership } from '../../lib/organizations';
import { formatNok, openInvoiceDocument } from '../../lib/invoicing';
import {
  ORDER_STATUS, WITHDRAWAL_STATUS, handleWithdrawal, imageUrl, loadCatalogue, loadOrders, loadReturns, makeReceipt, nextStatuses,
  refundOrder, saveProduct, saveShopSettings, saveVariant, setOrderStatus, setStock, uploadProductImage, withdrawalDeadline,
  type ShopOrder, type ShopProduct, type ShopRefund, type ShopSettings, type ShopVariant, type ShopWithdrawal,
} from '../../lib/shop';
import { osloDateTime } from '../../lib/services';

const input = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm';
const btn = 'px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50';
type Catalogue = Awaited<ReturnType<typeof loadCatalogue>>;
type Run = (fn: () => Promise<string | null>, ok: string) => Promise<void>;

export default function ShopPanel({ membership }: { membership: Membership }) {
  const org = membership.organization;
  const role = membership.role;
  const manage = role === 'owner' || role === 'admin';
  const work = manage || role === 'staff';
  const refund = manage || role === 'finance';
  const [view, setView] = useState<'orders' | 'returns' | 'products' | 'delivery'>('orders');
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [returns, setReturns] = useState<{ withdrawals: ShopWithdrawal[]; refunds: ShopRefund[] }>({ withdrawals: [], refunds: [] });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [c, o] = await Promise.all([loadCatalogue(org.id), loadOrders({ orgId: org.id })]);
    setCat(c); setOrders(o);
    setReturns(await loadReturns(o.map(x => x.id)));
  }, [org.id]);
  useEffect(() => { reload(); }, [reload]);

  const run: Run = async (fn, ok) => {
    setBusy(true); setMsg(null);
    const e = await fn();
    setBusy(false);
    setMsg(e ? { ok: false, text: e } : { ok: true, text: ok });
    await reload();
  };
  if (!cat) return <p className="text-sm text-gray-500">Loading…</p>;
  const open = returns.withdrawals.filter(w => w.status === 'requested' || w.status === 'received').length;

  return (
    <div className="space-y-5 max-w-6xl">
      {msg && <div className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
      {!cat.settings && manage && (
        <div className="rounded-xl px-4 py-3 text-sm bg-amber-50 text-amber-800">
          Set the delivery options and fill in the invoice settings (Invoices to customers) before the shop takes orders. Card payments need
          your Stripe account (Plan and website).
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        {(['orders', 'returns', 'products', 'delivery'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-full text-xs font-medium ${view === v ? 'bg-gray-900 text-white' : 'bg-white border'}`}>
            {{ orders: `Orders (${orders.filter(o => !['cancelled', 'refunded'].includes(o.status)).length})`, returns: `Returns (${open})`,
               products: `Products and stock (${cat.products.length})`, delivery: 'Delivery' }[v]}
          </button>
        ))}
      </div>
      {view === 'orders' && <Orders orders={orders} work={work} refund={refund} busy={busy} run={run} />}
      {view === 'returns' && <Returns orders={orders} returns={returns} work={work} refund={refund} busy={busy} run={run} />}
      {view === 'products' && <Products orgId={org.id} cat={cat} manage={manage} work={work} busy={busy} run={run} />}
      {view === 'delivery' && <Delivery orgId={org.id} settings={cat.settings} manage={manage} busy={busy} run={run} />}
    </div>
  );
}

function Orders({ orders, work, refund, busy, run }: { orders: ShopOrder[]; work: boolean; refund: boolean; busy: boolean; run: Run }) {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const shown = orders.filter(o => filter === 'all' || ['paid', 'packed', 'shipped', 'ready_for_pickup'].includes(o.status));
  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-xs">
        <button onClick={() => setFilter('open')} className={`${btn} ${filter === 'open' ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}>To handle</button>
        <button onClick={() => setFilter('all')} className={`${btn} ${filter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}>All</button>
      </div>
      {shown.map(o => (
        <div key={o.id} className="bg-white border rounded-2xl p-4 text-sm space-y-2">
          <div className="flex flex-wrap justify-between gap-2">
            <div><span className="font-semibold">Order {o.number}</span> · {osloDateTime(o.created_at)} · {o.customer.name}, {o.customer.phone}, {o.customer.email}</div>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100">{ORDER_STATUS[o.status]}</span>
          </div>
          <ul className="text-gray-600">
            {(o.shop_order_lines ?? []).map(l => <li key={l.id}>{l.quantity} × {l.name}{l.sku ? ` (${l.sku})` : ''} · {formatNok(l.total)}
              {l.refunded_quantity > 0 ? ` · ${l.refunded_quantity} refunded` : ''}</li>)}
          </ul>
          <div className="text-gray-600">
            {o.delivery_method === 'shipping' ? `Ship to ${o.delivery_address?.address}, ${o.delivery_address?.postcode} ${o.delivery_address?.city}` : 'Pickup'}
            {' · '}delivery {formatNok(o.delivery_price)} · <strong>total {formatNok(o.total)}</strong> incl. MVA
            {o.refunded_amount > 0 && ` · refunded ${formatNok(o.refunded_amount)}`}
            {o.tracking && ` · tracking ${o.tracking}`}
            {o.delivered_at && ` · withdrawal until ${withdrawalDeadline(o.delivered_at)}`}
          </div>
          {o.payment_review && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-xs">Payment to check: {o.payment_review}</div>}
          {o.invoice_error && <div className="rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-xs">The receipt could not be made: {o.invoice_error}</div>}
          <div className="flex flex-wrap gap-2 items-center">
            {work && nextStatuses(o).map(s => (
              s === 'shipped'
                ? <span key={s} className="flex gap-1">
                    <input value={tracking[o.id] ?? ''} onChange={e => setTracking({ ...tracking, [o.id]: e.target.value })} placeholder="Carrier and tracking number"
                      className="border rounded px-2 py-1 text-xs w-56" />
                    <button disabled={busy} onClick={() => run(() => setOrderStatus(o.id, 'shipped', tracking[o.id] ?? ''), 'Marked shipped.')} className={`${btn} bg-gray-900 text-white`}>Shipped</button>
                  </span>
                : <button key={s} disabled={busy} onClick={() => { if (s !== 'returned' || confirm('Mark the goods as returned?')) run(() => setOrderStatus(o.id, s, ''), `Marked ${ORDER_STATUS[s].toLowerCase()}.`); }}
                    className={`${btn} ${s === 'returned' ? 'bg-gray-100' : 'bg-gray-900 text-white'}`}>{ORDER_STATUS[s]}</button>
            ))}
            {o.invoice_id && refund && <button onClick={() => openInvoiceDocument(o.invoice_id!, 'pdf')} className={`${btn} bg-gray-100`}>Receipt PDF</button>}
            {!o.invoice_id && o.paid_at && refund && <button disabled={busy} onClick={() => run(() => makeReceipt(o.id), 'Receipt made.')} className={`${btn} bg-amber-100`}>Make the receipt</button>}
          </div>
        </div>
      ))}
      {shown.length === 0 && <p className="text-sm text-gray-500">No orders{filter === 'open' ? ' to handle' : ''}.</p>}
    </div>
  );
}

function Returns({ orders, returns, work, refund, busy, run }: {
  orders: ShopOrder[]; returns: { withdrawals: ShopWithdrawal[]; refunds: ShopRefund[] }; work: boolean; refund: boolean; busy: boolean; run: Run;
}) {
  const [form, setForm] = useState<{ order: ShopOrder; withdrawal: ShopWithdrawal | null; qty: Record<string, number>; delivery: boolean; restock: boolean; reason: string } | null>(null);
  const order = (id: string) => orders.find(o => o.id === id);
  function startRefund(o: ShopOrder, w: ShopWithdrawal | null) {
    const qty: Record<string, number> = {};
    for (const l of o.shop_order_lines ?? []) {
      const wanted = w ? w.lines.find(x => x.line_id === l.id)?.quantity ?? 0 : l.quantity - l.refunded_quantity;
      if (wanted > 0) qty[l.id] = wanted;
    }
    const all = (o.shop_order_lines ?? []).every(l => (qty[l.id] ?? 0) === l.quantity - l.refunded_quantity);
    setForm({ order: o, withdrawal: w, qty, delivery: all && !o.delivery_refunded, restock: true, reason: w ? 'Right of withdrawal' : '' });
  }
  const amount = form ? (form.order.shop_order_lines ?? []).reduce((s, l) => s + (form.qty[l.id] ?? 0) * l.unit_price, 0)
    + (form.delivery && !form.order.delivery_refunded ? form.order.delivery_price : 0) : 0;
  const refundable = orders.filter(o => o.paid_at && o.refunded_amount < (o.paid_amount ?? 0));
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">A customer may withdraw from a purchase within 14 days of receiving the goods (angrerettloven). The withdrawal is recorded with
        the date; you receive the goods back and refund. Your shop terms state the conditions and any exceptions.</p>
      <div className="space-y-2">
        {returns.withdrawals.map(w => { const o = order(w.order_id); return (
          <div key={w.id} className="bg-white border rounded-2xl p-4 text-sm space-y-1">
            <div className="flex justify-between gap-2"><span className="font-semibold">Order {o?.number} · {o?.customer.name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100">{WITHDRAWAL_STATUS[w.status]}</span></div>
            <div className="text-gray-600">{osloDateTime(w.requested_at)} · {w.within_period ? 'within the 14 days' : <strong className="text-amber-700">after the 14 days</strong>}
              {' · '}{w.lines.map(x => `${x.quantity} × ${o?.shop_order_lines?.find(l => l.id === x.line_id)?.name ?? '?'}`).join(', ')}</div>
            {w.message && <div className="text-gray-600">“{w.message}”</div>}
            {w.note && <div className="text-gray-500 text-xs">Note: {w.note}</div>}
            <div className="flex gap-2">
              {work && w.status === 'requested' && <>
                <button disabled={busy} onClick={() => run(() => handleWithdrawal(w.id, 'received', ''), 'Goods received.')} className={`${btn} bg-gray-900 text-white`}>Goods received back</button>
                <button disabled={busy} onClick={() => { const r = prompt('Why is the withdrawal not accepted? (the customer sees this)'); if (r) run(() => handleWithdrawal(w.id, 'rejected', r), 'Not accepted.'); }} className={`${btn} bg-gray-100`}>Not accepted…</button>
              </>}
              {refund && o && ['requested', 'received'].includes(w.status) && <button disabled={busy} onClick={() => startRefund(o, w)} className={`${btn} bg-emerald-600 text-white`}>Refund…</button>}
            </div>
          </div>); })}
        {returns.withdrawals.length === 0 && <p className="text-sm text-gray-500">No withdrawals.</p>}
      </div>

      {refund && refundable.length > 0 && !form && (
        <div className="text-sm"><span className="text-gray-500">Refund another paid order: </span>
          <select className="border rounded px-2 py-1 text-xs" value="" onChange={e => { const o = order(e.target.value); if (o) startRefund(o, null); }}>
            <option value="">choose…</option>
            {refundable.map(o => <option key={o.id} value={o.id}>Order {o.number} · {o.customer.name} · {formatNok(o.total)}</option>)}
          </select>
        </div>
      )}

      {form && (
        <div className="bg-white border rounded-2xl p-4 space-y-2 text-sm">
          <div className="font-semibold">Refund order {form.order.number} by card</div>
          {(form.order.shop_order_lines ?? []).filter(l => l.quantity > l.refunded_quantity).map(l => (
            <label key={l.id} className="flex items-center gap-2">
              <input type="number" min={0} max={l.quantity - l.refunded_quantity} value={form.qty[l.id] ?? 0} className="border rounded px-2 py-1 w-16"
                onChange={e => setForm({ ...form, qty: { ...form.qty, [l.id]: Math.max(0, Math.min(l.quantity - l.refunded_quantity, Number(e.target.value))) } })} />
              <span>of {l.quantity - l.refunded_quantity} × {l.name} ({formatNok(l.unit_price)})</span>
            </label>
          ))}
          {!form.order.delivery_refunded && form.order.delivery_price > 0 &&
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.delivery} onChange={e => setForm({ ...form, delivery: e.target.checked })} />
              The delivery too ({formatNok(form.order.delivery_price)}; due when the whole order is withdrawn)</label>}
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.restock} onChange={e => setForm({ ...form, restock: e.target.checked })} />
            Put the goods back into stock</label>
          <input className={input} placeholder="Reason (on the credit note)" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
          <div className="flex gap-2 items-center">
            <button disabled={busy || amount <= 0 || !form.reason.trim()} className={`${btn} bg-emerald-600 text-white`} onClick={() => {
              if (!confirm(`Refund ${formatNok(amount)} to the customer's card?`)) return;
              const lines = Object.entries(form.qty).filter(([, q]) => q > 0).map(([line_id, quantity]) => ({ line_id, quantity }));
              run(async () => {
                const r = await refundOrder(form.order.id, { lines, delivery: form.delivery, restock: form.restock, reason: form.reason, withdrawalId: form.withdrawal?.id ?? null });
                if (r.data?.status === 'failed') return `Stripe refused the refund: ${r.data.error}`;
                if (!r.ok && r.data?.error) return r.data.error;
                setForm(null);
                return null;
              }, 'Refund sent to Stripe; the credit note is made when Stripe confirms it.');
            }}>Refund {formatNok(amount)}</button>
            <button onClick={() => setForm(null)} className={`${btn} bg-gray-100`}>Close</button>
          </div>
        </div>
      )}

      {returns.refunds.length > 0 && (
        <div className="bg-white border rounded-2xl divide-y text-sm">
          {returns.refunds.map(r => (
            <div key={r.id} className="px-4 py-2 flex flex-wrap justify-between gap-2">
              <span>Order {order(r.order_id)?.number} · {formatNok(r.amount)} · {r.reason}</span>
              <span className="text-xs text-gray-500">{r.status}{r.error ? ` · ${r.error}` : ''}
                {r.credit_note_id && refund && <button onClick={() => openInvoiceDocument(r.credit_note_id!, 'pdf')} className="underline ml-2">Credit note</button>}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const emptyProduct = { name: '', description: '', price: 0, vat_rate: 25, sku: '', images: [] as string[], variant_label: '', track_stock: false, stock: 0, active: true, sort: 0 };

function Products({ orgId, cat, manage, work, busy, run }: { orgId: string; cat: Catalogue; manage: boolean; work: boolean; busy: boolean; run: Run }) {
  const [edit, setEdit] = useState<{ id: string | null } & typeof emptyProduct | null>(null);
  const [variant, setVariant] = useState<{ productId: string; id: string | null; name: string; sku: string; price: string; stock: number; active: boolean } | null>(null);
  const [stock, setStockDraft] = useState<Record<string, string>>({});
  const variantsOf = (p: ShopProduct) => cat.variants.filter(v => v.product_id === p.id);
  async function upload(files: FileList | null) {
    if (!files || !edit) return;
    const added: string[] = [];
    for (const f of Array.from(files).slice(0, 8 - edit.images.length)) {
      const r = await uploadProductImage(orgId, f);
      if (r.error) { alert(r.error); continue; }
      added.push(r.path!);
    }
    setEdit({ ...edit, images: [...edit.images, ...added] });
  }
  const stockInput = (key: string, current: number, save: (n: number) => Promise<string | null>) => (
    <span className="inline-flex gap-1 items-center">
      <input type="number" min={0} value={stock[key] ?? String(current)} onChange={e => setStockDraft({ ...stock, [key]: e.target.value })}
        className="border rounded px-2 py-0.5 w-20 text-xs" disabled={!work} />
      {work && stock[key] !== undefined && stock[key] !== String(current) &&
        <button disabled={busy} onClick={() => run(() => save(Number(stock[key])), 'Stock saved.').then(() => setStockDraft(s => { const n = { ...s }; delete n[key]; return n; }))}
          className={`${btn} bg-gray-900 text-white`}>Save</button>}
    </span>
  );
  return (
    <div className="space-y-3">
      {manage && !edit && <button onClick={() => setEdit({ id: null, ...emptyProduct })} className={`${btn} bg-gray-900 text-white`}>New product</button>}
      {edit && (
        <div className="bg-white border rounded-2xl p-4 grid md:grid-cols-2 gap-2 text-sm">
          <input className={input} placeholder="Name" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} />
          <input className={input} placeholder="SKU (optional)" value={edit.sku} onChange={e => setEdit({ ...edit, sku: e.target.value })} />
          <textarea className={`${input} md:col-span-2`} rows={3} placeholder="Description" value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} />
          <label className="text-xs text-gray-500">Price incl. MVA (kr)<input type="number" min={0} step="0.01" className={input} value={edit.price} onChange={e => setEdit({ ...edit, price: Number(e.target.value) })} /></label>
          <label className="text-xs text-gray-500">MVA rate<select className={input} value={edit.vat_rate} onChange={e => setEdit({ ...edit, vat_rate: Number(e.target.value) })}>
            {[25, 15, 12, 0].map(r => <option key={r} value={r}>{r} %</option>)}</select></label>
          <label className="text-xs text-gray-500">Variants are called (e.g. Size; empty: none)<input className={input} value={edit.variant_label} onChange={e => setEdit({ ...edit, variant_label: e.target.value })} /></label>
          <label className="text-xs text-gray-500">Order on the page<input type="number" className={input} value={edit.sort} onChange={e => setEdit({ ...edit, sort: Number(e.target.value) })} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={edit.track_stock} onChange={e => setEdit({ ...edit, track_stock: e.target.checked })} /> Track stock</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} /> For sale</label>
          {edit.track_stock && edit.id === null && <label className="text-xs text-gray-500">In stock<input type="number" min={0} className={input} value={edit.stock} onChange={e => setEdit({ ...edit, stock: Number(e.target.value) })} /></label>}
          <div className="md:col-span-2 space-y-1">
            <div className="flex gap-2 flex-wrap">{edit.images.map(p => (
              <span key={p} className="relative"><img src={imageUrl(p)} alt="" className="h-16 w-16 object-cover rounded border" />
                <button onClick={() => setEdit({ ...edit, images: edit.images.filter(x => x !== p) })} className="absolute -top-1 -right-1 bg-white border rounded-full text-xs px-1">×</button></span>))}</div>
            {edit.images.length < 8 && <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => upload(e.target.files)} className="text-xs" />}
          </div>
          <div className="md:col-span-2 flex gap-2">
            <button disabled={busy || !edit.name.trim() || edit.price <= 0} className={`${btn} bg-gray-900 text-white`} onClick={() => {
              const { id, stock: initial, ...p } = edit;
              run(async () => { const e = await saveProduct(orgId, id, id ? p : { ...p, stock: initial }); if (!e) setEdit(null); return e; }, 'Product saved.');
            }}>Save</button>
            <button onClick={() => setEdit(null)} className={`${btn} bg-gray-100`}>Cancel</button>
          </div>
        </div>
      )}
      {cat.products.map(p => { const vs = variantsOf(p); return (
        <div key={p.id} className={`bg-white border rounded-2xl p-4 text-sm ${p.active ? '' : 'opacity-60'}`}>
          <div className="flex gap-3">
            {p.images[0] && <img src={imageUrl(p.images[0])} alt="" className="h-14 w-14 object-cover rounded" />}
            <div className="flex-1">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{p.name}{p.sku ? ` · ${p.sku}` : ''}{p.active ? '' : ' (not for sale)'}</span>
                <span>{formatNok(p.price)} incl. {p.vat_rate} % MVA</span>
              </div>
              <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-3 items-center">
                {!p.track_stock ? 'Stock not tracked' : vs.length === 0 ? <>In stock {stockInput(p.id, p.stock, n => setStock(p.id, null, n))}</> : `${p.variant_label ?? 'Variants'}:`}
                {manage && <button onClick={() => setEdit({ id: p.id, name: p.name, description: p.description ?? '', price: p.price, vat_rate: p.vat_rate, sku: p.sku ?? '',
                  images: p.images, variant_label: p.variant_label ?? '', track_stock: p.track_stock, stock: p.stock, active: p.active, sort: p.sort })} className="underline">Edit</button>}
                {manage && <button onClick={() => setVariant({ productId: p.id, id: null, name: '', sku: '', price: '', stock: 0, active: true })} className="underline">Add variant</button>}
              </div>
              {vs.length > 0 && <ul className="mt-1 text-xs space-y-1">{vs.map((v: ShopVariant) => (
                <li key={v.id} className={`flex flex-wrap gap-3 items-center ${v.active ? '' : 'opacity-60'}`}>
                  <span className="font-medium">{v.name}</span>{v.sku && <span>{v.sku}</span>}<span>{formatNok(v.price ?? p.price)}</span>
                  {p.track_stock && <span>in stock {stockInput(v.id, v.stock, n => setStock(p.id, v.id, n))}</span>}
                  {manage && <button onClick={() => setVariant({ productId: p.id, id: v.id, name: v.name, sku: v.sku ?? '', price: v.price == null ? '' : String(v.price), stock: v.stock, active: v.active })} className="underline">Edit</button>}
                </li>))}</ul>}
              {variant?.productId === p.id && (
                <div className="mt-2 flex flex-wrap gap-2 items-center text-xs">
                  <input className="border rounded px-2 py-1 w-28" placeholder={p.variant_label ?? 'Name'} value={variant.name} onChange={e => setVariant({ ...variant, name: e.target.value })} />
                  <input className="border rounded px-2 py-1 w-28" placeholder="SKU" value={variant.sku} onChange={e => setVariant({ ...variant, sku: e.target.value })} />
                  <input className="border rounded px-2 py-1 w-28" placeholder={`Price (${p.price})`} value={variant.price} onChange={e => setVariant({ ...variant, price: e.target.value })} />
                  {variant.id === null && p.track_stock && <input type="number" min={0} className="border rounded px-2 py-1 w-20" placeholder="Stock" value={variant.stock} onChange={e => setVariant({ ...variant, stock: Number(e.target.value) })} />}
                  <label className="flex items-center gap-1"><input type="checkbox" checked={variant.active} onChange={e => setVariant({ ...variant, active: e.target.checked })} /> for sale</label>
                  <button disabled={busy || !variant.name.trim()} className={`${btn} bg-gray-900 text-white`} onClick={() => run(async () => {
                    const e = await saveVariant(p.id, variant.id, { name: variant.name, sku: variant.sku, price: variant.price === '' ? null : Number(variant.price),
                                                                     active: variant.active, ...(variant.id === null ? { stock: variant.stock } : {}) });
                    if (!e) setVariant(null);
                    return e;
                  }, 'Variant saved.')}>Save</button>
                  <button onClick={() => setVariant(null)} className={`${btn} bg-gray-100`}>Cancel</button>
                </div>
              )}
            </div>
          </div>
        </div>); })}
      {cat.products.length === 0 && <p className="text-sm text-gray-500">No products yet.</p>}
    </div>
  );
}

function Delivery({ orgId, settings, manage, busy, run }: { orgId: string; settings: ShopSettings | null; manage: boolean; busy: boolean; run: Run }) {
  const [s, setS] = useState<Partial<ShopSettings>>(settings ?? { pickup_enabled: true, shipping_enabled: false, shipping_price: 0, shipping_vat_rate: 25,
                                                                   return_cost_customer: true, payment_minutes: 60 });
  const num = (k: keyof ShopSettings) => (e: ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value === '' ? null : Number(e.target.value) });
  return (
    <div className="bg-white border rounded-2xl p-4 grid md:grid-cols-2 gap-3 text-sm max-w-3xl">
      <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" disabled={!manage} checked={!!s.pickup_enabled} onChange={e => setS({ ...s, pickup_enabled: e.target.checked })} /> Pickup (free)</label>
      <input className={input} disabled={!manage} placeholder="Pickup address" value={s.pickup_address ?? ''} onChange={e => setS({ ...s, pickup_address: e.target.value })} />
      <input className={input} disabled={!manage} placeholder="Pickup hours or note" value={s.pickup_note ?? ''} onChange={e => setS({ ...s, pickup_note: e.target.value })} />
      <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" disabled={!manage} checked={!!s.shipping_enabled} onChange={e => setS({ ...s, shipping_enabled: e.target.checked })} /> Shipping at a flat rate</label>
      <label className="text-xs text-gray-500">Shipping price incl. MVA (kr)<input type="number" min={0} disabled={!manage} className={input} value={s.shipping_price ?? 0} onChange={num('shipping_price')} /></label>
      <label className="text-xs text-gray-500">MVA on shipping<select className={input} disabled={!manage} value={s.shipping_vat_rate ?? 25} onChange={e => setS({ ...s, shipping_vat_rate: Number(e.target.value) })}>
        {[25, 15, 12, 0].map(r => <option key={r} value={r}>{r} %</option>)}</select></label>
      <label className="text-xs text-gray-500">Free shipping from (kr, optional)<input type="number" min={0} disabled={!manage} className={input} value={s.free_shipping_over ?? ''} onChange={num('free_shipping_over')} /></label>
      <input className={input} disabled={!manage} placeholder="Carrier and delivery time (shown at checkout)" value={s.shipping_note ?? ''} onChange={e => setS({ ...s, shipping_note: e.target.value })} />
      <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" disabled={!manage} checked={s.return_cost_customer !== false} onChange={e => setS({ ...s, return_cost_customer: e.target.checked })} />
        The customer pays to send withdrawn goods back (stated at checkout and in the confirmation)</label>
      <label className="text-xs text-gray-500">Minutes to pay before the stock is released (30–1440)<input type="number" min={30} max={1440} disabled={!manage} className={input} value={s.payment_minutes ?? 60} onChange={num('payment_minutes')} /></label>
      {manage && <div className="md:col-span-2"><button disabled={busy} onClick={() => run(() => saveShopSettings(orgId, s), 'Delivery saved.')} className={`${btn} bg-gray-900 text-white`}>Save</button></div>}
    </div>
  );
}
