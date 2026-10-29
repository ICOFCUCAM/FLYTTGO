// ============================================================================
// FlyttGo — shop-checkout Edge Function
// ============================================================================
//
// The customer pays a shop order (00020) by card, into the company's own
// Stripe account (docs/SERVICE_PLATFORM.md), as pay-sales-invoice does for
// its invoices. shop_checkout_begin checks the order is still waiting and
// keeps its stock held while the payment page is open; the Checkout
// session is created on the company's connected account for the order's
// lines and delivery (_shared/shop.ts). stripe-webhook records the payment
// (metadata.type = 'shop_order') once the account and the amount match.
// FlyttGo takes no fee from it: the company pays for its plan.
//
//   POST /functions/v1/shop-checkout
//   Authorization: Bearer <the customer's access token>
//   { "orderId": "<uuid>" }
//
// DEPLOY: supabase functions deploy shop-checkout --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, FRONTEND_URL.
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient } from '../_shared/auth.ts';
import { shopCheckoutForm, type ShopOrder, type ShopOrderLine } from '../_shared/shop.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const FRONTEND_URL = (Deno.env.get('FRONTEND_URL') ?? 'https://flyttgo.no').replace(/\/$/, '');
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: 'STRIPE_SECRET_KEY not configured' }, 500);
  const db = serviceClient();
  const caller = await getCaller(req, db);
  if (!caller) return json({ error: 'Sign in required' }, 401);
  const body = await req.json().catch(() => ({})) as { orderId?: string };
  if (!body.orderId) return json({ error: 'orderId is required' }, 400);

  const { data: found } = await db.from('shop_orders').select('id, customer_user_id').eq('id', body.orderId).maybeSingle();
  /* Same answer for missing and not yours. */
  if (!found || found.customer_user_id !== caller.id) return json({ error: 'order not found' }, 404);

  const { data: order, error } = await db.rpc('shop_checkout_begin', { p_order: body.orderId });
  if (error) return json({ error: error.message.replace(/^shop: /, '') }, 409);
  const o = order as ShopOrder & { status: string };
  if (o.status !== 'awaiting_payment') return json({ error: 'the order was not paid in time and has been cancelled; order again' }, 409);

  const [{ data: lines }, { data: wl }, { data: seller }] = await Promise.all([
    db.from('shop_order_lines').select('line_no, name, quantity, unit_price, vat_rate, total').eq('order_id', o.id),
    db.from('organization_white_label').select('stripe_account_id, stripe_charges_enabled, display_name').eq('organization_id', o.organization_id).maybeSingle(),
    db.rpc('organization_seller', { p_org: o.organization_id }),
  ]);
  /* The money goes to the account the order was taken for, and only while it can take payments. */
  if (!wl?.stripe_account_id || !wl.stripe_charges_enabled || wl.stripe_account_id !== o.connected_account_id) {
    return json({ error: 'the shop cannot take card payments right now; contact the shop' }, 409);
  }

  let form: URLSearchParams;
  try {
    form = shopCheckoutForm(o, (lines ?? []) as ShopOrderLine[], {
      frontendUrl: FRONTEND_URL, sellerName: seller?.name ?? wl.display_name ?? 'Shop', customerEmail: o.customer?.email ?? caller.email,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded',
               'Stripe-Version': '2024-06-20', 'Stripe-Account': wl.stripe_account_id },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) return json({ error: 'card payment could not be started', detail: data?.error?.message }, 502);
  return json({ url: data.url });
});
