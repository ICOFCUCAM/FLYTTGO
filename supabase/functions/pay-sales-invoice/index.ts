// ============================================================================
// FlyttGo — pay-sales-invoice Edge Function
// ============================================================================
//
// The buyer of a company's own invoice (00011) pays it by card, into the
// company's own Stripe account (docs/SERVICE_PLATFORM.md). A Checkout
// session is created on the company's connected account for what is still
// owed; stripe-webhook records the payment on the invoice when Stripe
// confirms it (metadata.type = 'sales_invoice'). FlyttGo takes no fee from
// it: the company pays for its plan.
//
//   POST /functions/v1/pay-sales-invoice
//   Authorization: Bearer <the buyer's access token>
//   { "invoiceId": "<uuid>" }
//
// DEPLOY: supabase functions deploy pay-sales-invoice --no-verify-jwt
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient } from '../_shared/auth.ts';

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
  const body = await req.json().catch(() => ({})) as { invoiceId?: string };
  if (!body.invoiceId) return json({ error: 'invoiceId is required' }, 400);

  const { data: inv } = await db.from('invoices')
    .select('id, number, kind, status, issuer_org, customer_user_id, total, fees_total, amount_paid, amount_credited, seller')
    .eq('id', body.invoiceId).maybeSingle();
  /* Same answer for missing and not yours. */
  if (!inv || !inv.issuer_org || inv.customer_user_id !== caller.id) return json({ error: 'invoice not found' }, 404);
  if (inv.kind !== 'invoice' || !['issued', 'partially_paid'].includes(inv.status)) return json({ error: `the invoice is ${inv.status}` }, 409);
  const owed = Math.round((Number(inv.total) + Number(inv.fees_total) - Number(inv.amount_paid) - Number(inv.amount_credited)) * 100);
  if (owed <= 0) return json({ error: 'nothing is owed' }, 409);

  const { data: wl } = await db.from('organization_white_label').select('stripe_account_id, stripe_charges_enabled')
    .eq('organization_id', inv.issuer_org).maybeSingle();
  if (!wl?.stripe_account_id || !wl.stripe_charges_enabled) {
    return json({ error: 'the company does not take card payments; pay to the bank account with the KID on the invoice' }, 409);
  }

  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.append('payment_method_types[]', 'card');
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', 'nok');
  p.set('line_items[0][price_data][unit_amount]', String(owed));
  p.set('line_items[0][price_data][product_data][name]', `${inv.seller?.name ?? 'Invoice'}: invoice ${inv.number}`);
  p.set('success_url', `${FRONTEND_URL}/my-services?invoice=paid`);
  p.set('cancel_url', `${FRONTEND_URL}/my-services?invoice=cancelled`);
  if (caller.email) p.set('customer_email', caller.email);
  const meta = { type: 'sales_invoice', invoice_id: inv.id, amount_ore: String(owed), connected_account: wl.stripe_account_id };
  for (const [k, v] of Object.entries(meta)) {
    p.set(`metadata[${k}]`, v);
    p.set(`payment_intent_data[metadata][${k}]`, v);
  }
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded',
               'Stripe-Version': '2024-06-20', 'Stripe-Account': wl.stripe_account_id },
    body: p,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) return json({ error: 'card payment could not be started', detail: data?.error?.message }, 502);
  return json({ url: data.url });
});
