// ============================================================================
// FlyttGo — shop-refund Edge Function
// ============================================================================
//
// A company refunds a shop order (00020) through Stripe on its own
// connected account, as refund-payment does for FlyttGo's bookings
// (_shared/refunds.ts): shop_refund_begin, as the caller, checks they are
// the company's owner, admin or finance and works out the amount from the
// order (lines, delivery); the refund is asked of Stripe with the row's
// idempotency key, so a retry never refunds twice; shop_refund_mark
// applies it (order, stock, withdrawal, credit note) on the first
// 'succeeded', once. FlyttGo took no fee, so none is given back.
//
//   POST /functions/v1/shop-refund
//   Authorization: Bearer <the company member's access token>
//   { "orderId": "<uuid>", "lines": [{ "line_id", "quantity" }] | null (all),
//     "delivery": true, "restock": true, "reason": "…", "withdrawalId": "<uuid>" | null }
//
// Responses: 200 { status: 'succeeded' | 'pending' | 'failed', refund }
//            202 { status: 'requested', retry: true } — Stripe not
//                reachable; calling again repeats the same request
//
// DEPLOY: supabase functions deploy shop-refund --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY.
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient, userClient } from '../_shared/auth.ts';
import { processRefund, stripeRefund, type RefundRow } from '../_shared/refunds.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

interface ShopRefund { id: string; order_id: string; amount: number | string; idempotency_key: string;
  status: RefundRow['status']; provider_refund_id: string | null }

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);
  const db = serviceClient();
  const caller = await getCaller(req, db);
  if (!caller) return json({ error: 'Sign in required' }, 401);
  const body = await req.json().catch(() => ({})) as {
    orderId?: string; lines?: { line_id: string; quantity: number }[] | null; delivery?: boolean; restock?: boolean;
    reason?: string; withdrawalId?: string | null;
  };
  if (!body.orderId) return json({ error: 'orderId is required' }, 400);

  /* The order's payment, read as the server once the caller has been let in by shop_refund_begin. */
  let order: { payment_intent_id: string | null; connected_account_id: string | null } | null = null;
  try {
    const result = await processRefund({
      begin: async () => {
        const { data, error } = await userClient(req).rpc('shop_refund_begin', {
          p_order: body.orderId, p_lines: body.lines ?? null, p_delivery: !!body.delivery, p_restock: !!body.restock,
          p_reason: body.reason?.slice(0, 500) ?? null, p_withdrawal: body.withdrawalId ?? null,
        });
        if (error) throw Object.assign(new Error(error.message.replace(/^shop: /, '')), { status: error.code === '42501' ? 403 : 409 });
        const r = data as ShopRefund;
        const { data: o } = await db.from('shop_orders').select('payment_intent_id, connected_account_id').eq('id', r.order_id).maybeSingle();
        order = o;
        return { id: r.id, booking_id: r.order_id, provider: 'stripe', provider_reference: o?.payment_intent_id ?? '',
                 amount: r.amount, idempotency_key: r.idempotency_key, status: r.status, provider_refund_id: r.provider_refund_id };
      },
      mark: async (id, status, providerRefundId, error) => {
        const { data, error: markErr } = await db.rpc('shop_refund_mark', {
          p_refund: id, p_status: status, p_provider_refund_id: providerRefundId, p_error: error,
        });
        if (markErr) throw new Error(`shop_refund_mark failed: ${markErr.message}`);
        const r = data as ShopRefund;
        return { id: r.id, booking_id: r.order_id, provider: 'stripe', provider_reference: order?.payment_intent_id ?? '',
                 amount: r.amount, idempotency_key: r.idempotency_key, status: r.status, provider_refund_id: r.provider_refund_id };
      },
      provider: async (row) => {
        if (!STRIPE_SECRET_KEY) return { kind: 'retry', error: 'STRIPE_SECRET_KEY not configured' };
        if (!row.provider_reference || !order?.connected_account_id) return { kind: 'failed', error: 'the order has no card payment to refund' };
        return stripeRefund(fetch, STRIPE_SECRET_KEY, {
          paymentIntentId: row.provider_reference, amountOre: Math.round(Number(row.amount) * 100),
          idempotencyKey: row.idempotency_key, refundId: row.id, bookingId: row.booking_id,
          stripeAccount: order.connected_account_id, refundApplicationFee: false,
          metadata: { type: 'shop_refund', shop_refund_id: row.id, order_id: row.booking_id },
        });
      },
    });
    if (result.outcome === 'retry') {
      console.warn(`shop refund ${result.refund.id} not confirmed: ${result.error}`);
      return json({ status: 'requested', retry: true, error: result.error, refund: result.refund }, 202);
    }
    return json({ status: result.outcome, error: result.error, refund: result.refund });
  } catch (err) {
    return json({ error: (err as Error).message }, (err as { status?: number }).status ?? 500);
  }
});
