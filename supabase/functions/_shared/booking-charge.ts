// ============================================================================
// FlyttGo — server-side booking charge for the payment functions
// ============================================================================
//
// create-checkout-session (Stripe) and create-vipps-session both call
// chargeForBooking(): it checks the caller owns the booking, that the
// booking still awaits payment, re-routes pickup → drop-off on the
// server and prices it with the shared formula. When the server price
// differs from what the browser stored at booking time, the booking and
// its escrow row are corrected so every screen shows what is charged.
//
// A booking made on a company's page under Model B (the company sells,
// docs/WHITE_LABEL.md) is paid by card into the company's Stripe account:
// the result carries the account and FlyttGo's application fee, and the
// split is written on the booking. Other payment methods are refused for
// it (opts.allowConnect is set only by the card checkout).
//
// A company booking is then checked against the member's spending limits
// and the company's approval rules (company_booking_check, migration
// 00017) at the server's price. When it needs approval nothing is
// charged: the result is 409 with the request, the approvers are told
// (in the app, and by email through send-booking-email), and the booking
// waits unpaid. Once approved, the same call goes ahead.
// ============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { bookingChargeNok, bookingCoordinates, routeDistance } from './pricing.ts';
import { sellerSplit } from './white-label.ts';
import { interpretCheck, type ApprovalHold, type CheckResult } from './spending.ts';

export interface ConnectCharge {
  account: string;
  applicationFeeOre: number;
  flyttgoPrice: number;
  platformFee: number;
  sellerName: string;
  siteBase: string | null;               // https://<verified domain>, to return the customer to
}

export type ChargeResult =
  | { ok: true; bookingId: string; amountNok: number; priceChanged: boolean; customerEmail: string | null; connect: ConnectCharge | null }
  | { ok: false; status: number; error: string; approval?: ApprovalHold };

/** The response body for a charge that cannot go ahead (or waits for approval). */
export function chargeRefusal(r: { error: string; approval?: ApprovalHold }) {
  return r.approval ? { awaitingApproval: true, error: r.error, approval: r.approval } : { error: r.error };
}

export async function chargeForBooking(
  db:        SupabaseClient,
  bookingId: string,
  callerId:  string,
  opts:      { allowConnect?: boolean } = {},
): Promise<ChargeResult> {
  const { data: booking, error } = await db
    .from('bookings')
    .select('id, customer_id, customer_email, payment_status, status, van_type, estimated_hours, helpers, additional_services, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, price_estimate, white_label_org, seller_model, organization_id, move_date, pickup_address, dropoff_address')
    .eq('id', bookingId)
    .maybeSingle();

  if (error)    return { ok: false, status: 500, error: 'booking read failed' };
  /* Same answer for "missing" and "not yours", so ids can't be probed. */
  if (!booking || booking.customer_id !== callerId) return { ok: false, status: 404, error: 'booking not found' };
  if (booking.status === 'cancelled') return { ok: false, status: 409, error: 'booking is cancelled' };
  if ((booking.payment_status ?? 'pending') !== 'pending') {
    return { ok: false, status: 409, error: `booking payment_status is ${booking.payment_status}` };
  }

  /* Model B: the company's account must be able to take the payment. */
  let seller: { account: string; pricing: { markup_pct: number; platform_fee_pct: number; platform_fee_min: number };
                name: string; domain: string | null } | null = null;
  if (booking.seller_model === 'company') {
    if (!opts.allowConnect) {
      return { ok: false, status: 409, error: 'this booking is sold by the company on its own page: pay by card' };
    }
    const { data: w } = await db.from('organization_white_label')
      .select('status, plan_code, stripe_account_id, stripe_charges_enabled, price_markup_pct, custom_domain, domain_verified_at')
      .eq('organization_id', booking.white_label_org).maybeSingle();
    const { data: org } = await db.from('organizations').select('name, status').eq('id', booking.white_label_org).maybeSingle();
    const { data: plan } = w
      ? await db.from('white_label_plans').select('seller_model, platform_fee_pct, platform_fee_min').eq('code', w.plan_code).maybeSingle()
      : { data: null };
    if (!w || w.status !== 'active' || org?.status !== 'active' || plan?.seller_model !== 'company') {
      return { ok: false, status: 409, error: 'the company\'s booking page is not active' };
    }
    if (!w.stripe_account_id || !w.stripe_charges_enabled) {
      return { ok: false, status: 409, error: 'the company cannot take payments yet' };
    }
    seller = {
      account: w.stripe_account_id, name: org?.name ?? 'the company',
      domain: w.domain_verified_at ? w.custom_domain : null,
      pricing: { markup_pct: Number(w.price_markup_pct), platform_fee_pct: Number(plan.platform_fee_pct), platform_fee_min: Number(plan.platform_fee_min) },
    };
  }

  const coords = bookingCoordinates(booking);
  if (!coords) return { ok: false, status: 422, error: 'booking has no valid pickup/drop-off coordinates' };

  const route     = await routeDistance(...coords);
  const amountNok = bookingChargeNok(booking, route);
  if (!Number.isFinite(amountNok) || amountNok <= 0) {
    return { ok: false, status: 422, error: 'could not price booking' };
  }

  const stored       = Number(booking.price_estimate);
  const priceChanged = !Number.isFinite(stored) || Math.round(stored) !== amountNok;
  if (priceChanged) {
    console.warn(`booking ${bookingId}: stored price ${booking.price_estimate} → server price ${amountNok}`);
    const { error: updErr } = await db
      .from('bookings')
      .update({ price_estimate: amountNok, original_price: amountNok, distance_km: route.distance_km })
      .eq('id', bookingId);
    if (updErr) return { ok: false, status: 500, error: 'booking price update failed' };
    await db.from('escrow_payments')
      .update({ amount: amountNok, original_amount: amountNok })
      .eq('booking_id', bookingId);
  }

  let connect: ConnectCharge | null = null;
  let charged = amountNok;
  if (seller) {
    const split = sellerSplit(amountNok, seller.pricing);
    const { error: splitErr } = await db.from('bookings')
      .update({ customer_price: split.customerPrice, platform_fee: split.platformFee, connected_account_id: seller.account })
      .eq('id', bookingId);
    if (splitErr) return { ok: false, status: 500, error: 'booking split update failed' };
    charged = split.customerPrice;
    connect = { account: seller.account, applicationFeeOre: split.applicationFeeOre, flyttgoPrice: split.flyttgoPrice,
                platformFee: split.platformFee, sellerName: seller.name, siteBase: seller.domain ? `https://${seller.domain}` : null };
  }

  /* Company booking: the member's limits and the company's rules, at the
   * price that would be charged. */
  if (booking.organization_id) {
    const { data: check, error: checkErr } = await db.rpc('company_booking_check',
      { p_booking: bookingId, p_caller: callerId, p_amount: charged });
    if (checkErr) {
      return { ok: false, status: checkErr.code === '42501' ? 403 : checkErr.code === 'P0002' ? 404 : 409, error: checkErr.message };
    }
    const decision = interpretCheck(check as CheckResult);
    if (!decision.proceed) {
      if ((check as CheckResult).new) await emailApprovers(check as CheckResult, booking);
      return { ok: false, status: decision.status, error: decision.error, approval: decision.approval };
    }
  }

  return { ok: true, bookingId, amountNok: charged, priceChanged, customerEmail: booking.customer_email ?? null, connect };
}

/* Best effort: the request is recorded and the approvers already have it
 * in the app; a failed email changes nothing. */
async function emailApprovers(check: CheckResult, booking: { id: string; pickup_address?: string | null;
                              dropoff_address?: string | null; move_date?: string | null }) {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return;
  for (const to of check.approvers ?? []) {
    try {
      await fetch(`${url.replace(/\/$/, '')}/functions/v1/send-booking-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: 'approval_requested', to, bookingId: booking.id, data: {
          company: check.organization ?? null, amount: check.amount, reasons: check.reasons ?? [],
          expiresAt: check.expires_at ?? null, pickupAddress: booking.pickup_address ?? null,
          dropoffAddress: booking.dropoff_address ?? null, moveDate: booking.move_date ?? null } }),
      });
    } catch (e) {
      console.warn(`approval email for booking ${booking.id} not sent: ${(e as Error).message}`);
    }
  }
}
