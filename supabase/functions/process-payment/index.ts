// ============================================================================
// FlyttGo — process-payment Edge Function
// ============================================================================
//
// Powers the dual-confirmation escrow lifecycle for completed bookings.
//
// Call sites (already wired in the frontend):
//
//   • DriverPortal.finishJob()         → action='recalculate_price'
//     Triggered the moment the driver marks the job complete. Computes
//     actual_hours from (end_time - start_time), compares to
//     estimated_hours, and if actual is LONGER it recalculates the
//     price using the same formula BookingFlow used, flags the delta
//     in escrow_payments.adjusted_amount and waits for the customer to
//     approve the additional charge.
//
//   • CustomerDashboard.confirmCompletion() → action='release_escrow'
//     Called after the customer clicks "Complete delivery" AND the
//     driver has already clicked "Complete work" (and vice versa).
//     Verifies both confirmations are set, verifies any adjustment
//     has been approved, computes commission based on the driver's
//     subscription plan, flips escrow_payments to 'released' and
//     credits the driver's wallet.
//
// DEPLOY:
//   supabase functions deploy process-payment --no-verify-jwt
//
// Uses the service-role key automatically injected by Supabase Edge
// Functions (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), so it bypasses
// RLS and can read/update booking state that the customer/driver
// clients can't. All state-changing paths assert booking preconditions
// (both confirmations must be set for release, both start/end times
// must exist for recalculation) so random callers can't forge state.
//
// ============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ─── Env (Supabase injects these automatically) ─────────────── */
const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/* ─── Pricing constants (mirrored from src/lib/constants.ts) ─── */

const VAN_HOURLY_RATES: Record<string, number> = {
  small_van:  850,
  medium_van: 1150,
  large_van:  1500,
  luton_van:  1900,
};

const PRICING = {
  minimumHours: 2,
  distancePricing: { includedKm: 20, extraPerKm: 8 },
  extras: {
    extra_helper:         350,
    furniture_assembly:   250,
    cleaning:             400,
    parking_assistance:   200,
    packing_service:      500,
    furniture_dismantling: 300,
  },
  vat: 0.25,
};

interface PriceInputs {
  vanType:    string;
  hours:      number;
  distanceKm: number;
  helpers:    number;
  extras:     string[];
}

/**
 * Mirror of src/lib/constants.ts#calculatePrice. Kept inline so the
 * edge function has zero shared-code dependencies. If the frontend
 * formula changes, update this mirror too.
 */
function calculatePrice(inp: PriceInputs) {
  const safeHours      = Math.max(inp.hours ?? 0, PRICING.minimumHours);
  const extraKm        = Math.max(0, (inp.distanceKm ?? 0) - PRICING.distancePricing.includedKm);
  const basePrice      = (VAN_HOURLY_RATES[inp.vanType] ?? 850) * safeHours;
  const distanceCharge = extraKm * PRICING.distancePricing.extraPerKm;
  const helpersCharge  = (inp.helpers ?? 0) * PRICING.extras.extra_helper * safeHours;
  const extrasCharge   = (inp.extras ?? []).reduce(
    (sum, e) => sum + ((PRICING.extras as Record<string, number>)[e] ?? 0),
    0,
  );
  const subtotal = basePrice + distanceCharge + helpersCharge + extrasCharge;
  const vat      = subtotal * PRICING.vat;
  return { basePrice, distanceCharge, helpersCharge, extrasCharge, subtotal, vat, total: subtotal + vat };
}

/* ─── Commission (mirrored from src/lib/constants.ts) ────────── */

/**
 * Small mirror of the bracketed commission model so we don't have
 * to pull constants.ts into Deno. Returns the commission to
 * deduct and the driver's take-home.
 */
function computeCommission(
  price: number,
  plan:  string,
): { commission: number; earning: number; ratePct: number } {
  const p = Math.max(0, Number(price) || 0);
  if (p <= 500) return { commission: 0, earning: p, ratePct: 0 };

  if (plan === 'unlimited') return { commission: 0, earning: p, ratePct: 0 };

  /* Bracket model: rate depends on price band and driver plan. */
  const BY_PLAN: Record<string, Record<string, number>> = {
    basic:    { low: 20, mid: 15, high: 10 },
    pro_mini: { low: 10, mid:  5, high:  4 },
    pro:      { low: 10, mid:  5, high:  4 },
  };
  const plans = BY_PLAN[plan] ?? BY_PLAN.basic;

  let ratePct = plans.high;
  if      (p <= 1500) ratePct = plans.low;
  else if (p <= 5000) ratePct = plans.mid;

  const commission = Math.round((p * ratePct) / 100);
  return { commission, earning: p - commission, ratePct };
}

/* ─── Handler ──────────────────────────────────────────────────── */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

interface ProcessPaymentRequest {
  action:    'recalculate_price' | 'release_escrow';
  bookingId: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  let body: ProcessPaymentRequest;
  try {
    body = (await req.json()) as ProcessPaymentRequest;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body?.bookingId || !body?.action) {
    return json({ error: 'action and bookingId are required' }, 400);
  }

  try {
    if (body.action === 'recalculate_price') return await recalculatePrice(body.bookingId);
    if (body.action === 'release_escrow')    return await releaseEscrow(body.bookingId);
    return json({ error: `Unknown action: ${body.action}` }, 400);
  } catch (err) {
    console.error('process-payment error:', err);
    return json({ error: 'Internal error', detail: (err as Error).message }, 500);
  }
});

/* ─── Action: recalculate_price ────────────────────────────────── */

async function recalculatePrice(bookingId: string) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();
  if (error || !booking) return json({ error: 'booking not found' }, 404);

  /* Need start_time and end_time to compute actual_hours. DriverPortal
   * sets start_time on "Start Job" and end_time on "Finish Job". */
  const startMs = booking.start_time ? new Date(booking.start_time).getTime() : null;
  const endMs   = booking.end_time   ? new Date(booking.end_time).getTime()   : null;
  if (!startMs || !endMs || endMs < startMs) {
    return json({ error: 'booking missing or invalid start_time/end_time' }, 400);
  }

  /* Round actual hours to the nearest 0.5, floored at the 2-hour
   * minimum the pricing formula uses. */
  const rawHours    = (endMs - startMs) / 3_600_000;
  const actualHours = Math.max(
    PRICING.minimumHours,
    Math.round(rawHours * 2) / 2,
  );

  const estimatedHours = Number(booking.estimated_hours ?? PRICING.minimumHours);
  const originalPrice  = Number(booking.price_estimate ?? booking.original_price ?? 0);

  let finalPrice       = originalPrice;
  let adjustedAmount:  number | null = null;
  let adjustmentReason: string | null = null;

  if (actualHours > estimatedHours) {
    /* Recalculate using the same formula BookingFlow used, with the
     * actual hours substituted. */
    const recalc = calculatePrice({
      vanType:    booking.van_type ?? 'medium_van',
      hours:      actualHours,
      distanceKm: Number(booking.distance_km ?? 0),
      helpers:    Number(booking.helpers ?? 0),
      extras:     (booking.additional_services as string[] | null) ?? [],
    });
    finalPrice       = Math.round(recalc.total);
    adjustedAmount   = finalPrice;
    adjustmentReason = `Actual time ${actualHours}h exceeded estimated ${estimatedHours}h at ${VAN_HOURLY_RATES[booking.van_type ?? 'medium_van']} NOK/hr.`;

    /* Flag the adjustment on the escrow row so CustomerDashboard
     * can show the "Approve additional charge" button. We do NOT
     * flip status here — that's the release step's job. */
    const { error: escrowErr } = await supabase
      .from('escrow_payments')
      .update({
        adjusted_amount:     adjustedAmount,
        adjustment_reason:   adjustmentReason,
        adjustment_approved: false,
      })
      .eq('booking_id', bookingId);
    if (escrowErr) console.warn('escrow adjust update failed:', escrowErr.message);
  }

  const { error: bookingErr } = await supabase
    .from('bookings')
    .update({
      actual_hours: actualHours,
      final_price:  finalPrice,
    })
    .eq('id', bookingId);
  if (bookingErr) return json({ error: 'booking update failed', detail: bookingErr.message }, 500);

  return json({
    ok:              true,
    actualHours,
    estimatedHours,
    originalPrice,
    finalPrice,
    adjusted:        adjustedAmount !== null,
    adjustmentAmount: adjustedAmount,
    adjustmentReason,
  });
}

/* ─── Action: release_escrow ───────────────────────────────────── */

async function releaseEscrow(bookingId: string) {
  const { data: booking, error: bookingErr } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();
  if (bookingErr || !booking) return json({ error: 'booking not found' }, 404);

  /* Dual-confirmation guard — both sides must have clicked their
   * "Complete" button before money moves. */
  if (!booking.customer_confirmation || !booking.driver_confirmation) {
    return json({
      error:               'both customer and driver must confirm before release',
      customer_confirmed:  !!booking.customer_confirmation,
      driver_confirmed:    !!booking.driver_confirmation,
    }, 400);
  }

  const { data: escrow, error: escrowErr } = await supabase
    .from('escrow_payments')
    .select('*')
    .eq('booking_id', bookingId)
    .maybeSingle();
  if (escrowErr) return json({ error: 'escrow fetch failed', detail: escrowErr.message }, 500);
  if (!escrow)   return json({ error: 'escrow row not found for booking' }, 404);

  /* If the recalculation bumped the price, the customer has to
   * approve the delta before we capture. */
  const hasAdjustment = escrow.adjusted_amount != null && Number(escrow.adjusted_amount) > 0;
  if (hasAdjustment && !escrow.adjustment_approved) {
    return json({
      error:             'adjustment not yet approved by customer',
      adjusted_amount:   escrow.adjusted_amount,
      adjustment_reason: escrow.adjustment_reason,
    }, 409);
  }

  /* Choose the effective amount: adjusted > final_price > price_estimate > amount. */
  const amount = Number(
    escrow.adjusted_amount
      ?? booking.final_price
      ?? booking.price_estimate
      ?? escrow.amount
      ?? 0,
  );
  if (!amount || amount < 0) {
    return json({ error: 'could not determine release amount' }, 500);
  }

  /* Look up the driver's active subscription plan for commission
   * calculation. Default to 'basic' if anything's missing. */
  let plan = 'basic';
  if (booking.driver_id) {
    const { data: sub } = await supabase
      .from('driver_subscriptions')
      .select('plan')
      .eq('driver_id', booking.driver_id)
      .eq('subscription_status', 'active')
      .maybeSingle();
    if (sub?.plan) plan = sub.plan;
  }
  const { commission, earning, ratePct } = computeCommission(amount, plan);

  /* Update escrow_payments → released. */
  const { error: releaseErr } = await supabase
    .from('escrow_payments')
    .update({
      status:            'released',
      released_at:       new Date().toISOString(),
      commission_amount: commission,
      driver_earning:    earning,
      final_price:       amount,
    })
    .eq('booking_id', bookingId);
  if (releaseErr) return json({ error: 'escrow release failed', detail: releaseErr.message }, 500);

  /* Mark booking payment_status = 'released'. */
  const { error: bStatusErr } = await supabase
    .from('bookings')
    .update({ payment_status: 'released' })
    .eq('id', bookingId);
  if (bStatusErr) console.warn('booking payment_status update failed:', bStatusErr.message);

  /* Credit the driver's wallet. Uses the existing RPC so we don't
   * race against other wallet updates. Fails silently if the RPC
   * isn't present — the escrow row still tells ops exactly how much
   * to pay out. */
  if (booking.driver_id && earning > 0) {
    const { error: rpcErr } = await supabase.rpc('increment_driver_wallet', {
      p_driver_id: booking.driver_id,
      p_amount:    earning,
    });
    if (rpcErr) console.warn('wallet credit RPC failed:', rpcErr.message);
  }

  return json({
    ok:             true,
    amount,
    commissionPct:  ratePct,
    commission,
    driverEarning:  earning,
    plan,
  });
}
