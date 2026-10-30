/**
 * Online shops (migration 00020, docs/SERVICE_PLATFORM.md): a company's
 * catalogue, its customers' carts and orders, returns and refunds. Reads go
 * through row-level security and changes through the database functions
 * (and shop-checkout, shop-refund), which decide every permission and every
 * price; the browser's cart holds only what and how many.
 */
import { supabase } from './supabase';
import { callJson } from './invoicing';

export type ShopOrderStatus = 'awaiting_payment' | 'paid' | 'packed' | 'shipped' | 'ready_for_pickup' | 'delivered'
  | 'collected' | 'returned' | 'refunded' | 'cancelled';

export interface ShopSettings { organization_id: string; pickup_enabled: boolean; pickup_address: string | null; pickup_note: string | null;
  shipping_enabled: boolean; shipping_price: number; shipping_vat_rate: number; free_shipping_over: number | null;
  shipping_note: string | null; return_cost_customer: boolean; payment_minutes: number }
export interface ShopProduct { id: string; organization_id: string; name: string; description: string | null; price: number;
  vat_rate: number; sku: string | null; images: string[]; variant_label: string | null; track_stock: boolean; stock: number;
  active: boolean; sort: number }
export interface ShopVariant { id: string; product_id: string; name: string; sku: string | null; price: number | null; stock: number;
  active: boolean; sort: number }
export interface ShopOrderLine { id: string; order_id: string; line_no: number; product_id: string; variant_id: string | null; name: string;
  sku: string | null; quantity: number; unit_price: number; vat_rate: number; total: number; refunded_quantity: number }
export interface ShopOrder { id: string; organization_id: string; number: number; customer_user_id: string;
  customer: { name: string; phone: string; email: string }; delivery_method: 'pickup' | 'shipping';
  delivery_address: { address: string; postcode: string; city: string } | null; items_total: number; delivery_price: number;
  total: number; status: ShopOrderStatus; expires_at: string; paid_at: string | null; paid_amount: number | null;
  payment_review: string | null; invoice_id: string | null; invoice_error: string | null; tracking: string | null;
  delivered_at: string | null; refunded_amount: number; delivery_refunded: boolean; cancel_reason: string | null; created_at: string;
  shop_order_lines?: ShopOrderLine[] }
export interface ShopWithdrawal { id: string; order_id: string; lines: { line_id: string; quantity: number }[]; message: string | null;
  within_period: boolean; status: 'requested' | 'received' | 'refunded' | 'rejected'; note: string | null; requested_at: string }
export interface ShopRefund { id: string; order_id: string; withdrawal_id: string | null; amount: number; reason: string;
  status: 'requested' | 'pending' | 'succeeded' | 'failed'; error: string | null; credit_note_id: string | null; created_at: string }
export interface ShopQuote { lines: { product_id: string; variant_id: string | null; name: string; quantity: number; unit_price: number;
  vat_rate: number; total: number }[]; items_total: number; delivery_method: 'pickup' | 'shipping'; delivery_price: number; total: number }

export const ORDER_STATUS: Record<ShopOrderStatus, string> = {
  awaiting_payment: 'Awaiting payment', paid: 'Paid', packed: 'Packed', shipped: 'Shipped', ready_for_pickup: 'Ready for pickup',
  delivered: 'Delivered', collected: 'Collected', returned: 'Returned', refunded: 'Refunded', cancelled: 'Cancelled',
};
export const WITHDRAWAL_STATUS: Record<ShopWithdrawal['status'], string> = {
  requested: 'Withdrawal requested', received: 'Goods received back', refunded: 'Refunded', rejected: 'Not accepted',
};
/** What the company can move a paid order on to, by delivery method (set_shop_order_status). */
export function nextStatuses(o: Pick<ShopOrder, 'status' | 'delivery_method'>): ShopOrderStatus[] {
  const ship = o.delivery_method === 'shipping';
  switch (o.status) {
    case 'paid':             return ['packed', ship ? 'shipped' : 'ready_for_pickup'];
    case 'packed':           return [ship ? 'shipped' : 'ready_for_pickup'];
    case 'shipped':          return ['delivered', 'returned'];
    case 'ready_for_pickup': return ['collected'];
    case 'delivered':
    case 'collected':        return ['returned'];
    default:                 return [];
  }
}
/** The customer may withdraw from a paid order until it is returned or refunded (request_shop_withdrawal). */
export const canWithdraw = (o: Pick<ShopOrder, 'status'>) =>
  ['paid', 'packed', 'shipped', 'ready_for_pickup', 'delivered', 'collected'].includes(o.status);
/** The last day of the 14-day right of withdrawal (Europe/Oslo), once delivered or collected. */
export function withdrawalDeadline(deliveredAt: string | null | undefined): string | null {
  if (!deliveredAt) return null;
  const day = new Date(deliveredAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 14);
  return d.toISOString().slice(0, 10);
}

/* ── The cart (this browser, per shop) ─────────────────────────────── */
export interface CartItem { product_id: string; variant_id: string | null; quantity: number }

export function addToCart(cart: CartItem[], item: CartItem): CartItem[] {
  const i = cart.findIndex(c => c.product_id === item.product_id && c.variant_id === item.variant_id);
  if (i < 0) return [...cart, { ...item, quantity: Math.min(999, Math.max(1, item.quantity)) }];
  return cart.map((c, n) => n === i ? { ...c, quantity: Math.min(999, c.quantity + item.quantity) } : c);
}
export function setCartQuantity(cart: CartItem[], product: string, variant: string | null, quantity: number): CartItem[] {
  return quantity <= 0
    ? cart.filter(c => !(c.product_id === product && c.variant_id === variant))
    : cart.map(c => c.product_id === product && c.variant_id === variant ? { ...c, quantity: Math.min(999, Math.floor(quantity)) } : c);
}
export const cartCount = (cart: CartItem[]) => cart.reduce((s, c) => s + c.quantity, 0);

const cartKey = (orgId: string) => `flyttgo.cart.${orgId}`;
export function loadCart(orgId: string): CartItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(cartKey(orgId)) ?? '[]');
    return Array.isArray(v) ? v.filter(c => typeof c?.product_id === 'string' && Number(c?.quantity) > 0) : [];
  } catch { return []; }
}
export function saveCart(orgId: string, cart: CartItem[]) {
  try {
    if (cart.length) localStorage.setItem(cartKey(orgId), JSON.stringify(cart)); else localStorage.removeItem(cartKey(orgId));
  } catch { /* private mode */ }
}

/** The public URL of a product picture (bucket shop-product-images is public). */
export function imageUrl(path: string): string {
  return supabase.storage.from('shop-product-images').getPublicUrl(path).data.publicUrl;
}

const err = (e: { message: string } | null) => e?.message?.replace(/^shop: /, '') ?? null;
const rpc = async (fn: string, args: Record<string, unknown>) => err((await supabase.rpc(fn, args)).error);

/* ── Catalogue ─────────────────────────────────────────────────────── */
export async function loadCatalogue(orgId: string) {
  const [{ data: products }, { data: settings }] = await Promise.all([
    supabase.from('shop_products').select('*').eq('organization_id', orgId).order('sort').order('name'),
    supabase.from('shop_settings').select('*').eq('organization_id', orgId).maybeSingle(),
  ]);
  const ids = (products ?? []).map((p: ShopProduct) => p.id);
  const { data: variants } = ids.length
    ? await supabase.from('shop_variants').select('*').in('product_id', ids).order('sort').order('name')
    : { data: [] };
  return { products: (products ?? []) as ShopProduct[], variants: (variants ?? []) as ShopVariant[], settings: (settings ?? null) as ShopSettings | null };
}
export const saveShopSettings = (orgId: string, s: Partial<ShopSettings>) => rpc('save_shop_settings', { p_org: orgId, p: s });
export const saveProduct = (orgId: string, id: string | null, p: Partial<ShopProduct>) => rpc('save_shop_product', { p_org: orgId, p_id: id, p });
export const saveVariant = (productId: string, id: string | null, v: Partial<ShopVariant>) =>
  rpc('save_shop_variant', { p_product: productId, p_id: id, p: v });
export const setStock = (productId: string, variantId: string | null, stock: number) =>
  rpc('set_shop_stock', { p_product: productId, p_variant: variantId, p_stock: stock });
export async function uploadProductImage(orgId: string, file: File): Promise<{ path?: string; error: string | null }> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return { error: 'JPEG, PNG or WebP' };
  if (file.size > 5 * 1024 * 1024) return { error: 'at most 5 MB' };
  const path = `${orgId}/products/${crypto.randomUUID()}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`;
  const { error } = await supabase.storage.from('shop-product-images').upload(path, file, { contentType: file.type });
  return error ? { error: error.message } : { path, error: null };
}

/* ── Cart and checkout ─────────────────────────────────────────────── */
export async function quote(orgId: string, cart: CartItem[], delivery: 'pickup' | 'shipping'): Promise<{ quote: ShopQuote | null; error: string | null }> {
  const { data, error } = await supabase.rpc('shop_quote', { p_org: orgId, p_items: cart, p_delivery: delivery });
  return { quote: (data ?? null) as ShopQuote | null, error: err(error) };
}
export async function placeOrder(orgId: string, cart: CartItem[], delivery: 'pickup' | 'shipping',
  address: { address: string; postcode: string; city: string } | null, contact: { name: string; phone: string; email: string }) {
  const { data, error } = await supabase.rpc('place_shop_order', { p_org: orgId, p_items: cart, p_delivery: delivery,
                                                                    p_address: address, p_contact: contact });
  return { order: (data ?? null) as ShopOrder | null, error: err(error) };
}
export const payOrder = (orderId: string) => callJson('shop-checkout', { orderId });
export const cancelOrder = (orderId: string, reason: string) => rpc('cancel_shop_order', { p_order: orderId, p_reason: reason });

/* ── Orders ────────────────────────────────────────────────────────── */
export async function loadOrders(filter: { orgId?: string; customer?: string }): Promise<ShopOrder[]> {
  let q = supabase.from('shop_orders').select('*, shop_order_lines(*)').order('created_at', { ascending: false }).limit(300);
  if (filter.orgId) q = q.eq('organization_id', filter.orgId);
  if (filter.customer) q = q.eq('customer_user_id', filter.customer);
  const { data } = await q;
  return ((data ?? []) as ShopOrder[]).map(o => ({ ...o, shop_order_lines: [...(o.shop_order_lines ?? [])].sort((a, b) => a.line_no - b.line_no) }));
}
export async function loadReturns(orderIds: string[]) {
  if (!orderIds.length) return { withdrawals: [] as ShopWithdrawal[], refunds: [] as ShopRefund[] };
  const [{ data: w }, { data: r }] = await Promise.all([
    supabase.from('shop_withdrawals').select('*').in('order_id', orderIds).order('requested_at', { ascending: false }),
    supabase.from('shop_refunds').select('*').in('order_id', orderIds).order('created_at', { ascending: false }),
  ]);
  return { withdrawals: (w ?? []) as ShopWithdrawal[], refunds: (r ?? []) as ShopRefund[] };
}
export const setOrderStatus = (orderId: string, status: ShopOrderStatus, note: string) =>
  rpc('set_shop_order_status', { p_order: orderId, p_status: status, p_note: note });
export const makeReceipt = (orderId: string) => rpc('invoice_shop_order', { p_order: orderId });
export const requestWithdrawal = (orderId: string, lines: { line_id: string; quantity: number }[] | null, message: string) =>
  rpc('request_shop_withdrawal', { p_order: orderId, p_lines: lines, p_message: message });
export const handleWithdrawal = (id: string, decision: 'received' | 'rejected', note: string) =>
  rpc('handle_shop_withdrawal', { p_id: id, p_decision: decision, p_note: note });
export const refundOrder = (orderId: string, r: { lines: { line_id: string; quantity: number }[] | null; delivery: boolean;
  restock: boolean; reason: string; withdrawalId: string | null }) => callJson('shop-refund', { orderId, ...r });
