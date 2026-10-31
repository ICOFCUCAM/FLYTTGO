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
//     credits the driver's wallet. A Vipps payment is only reserved
//     until then: it is captured here first (decided 2026-10-29, capture
//     on delivery), and the release waits if Vipps cannot be reached.
//
//   • AdminDashboard → action='capture' (also the booking's parties):
//     capture a reserved Vipps payment without releasing it, for
//     admin_release_escrow, which requires a captured payment.
//
// DEPLOY:
//   supabase functions deploy process-payment --no-verify-jwt
//
// Uses the service-role key automatically injected by Supabase Edge
// Functions (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), so it bypasses
// RLS and can read/update booking state that the customer/driver
// clients can't. Every call must carry the signed-in user's token:
//   recalculate_price — the booking's assigned driver, or an admin
//   release_escrow    — the booking's customer or assigned driver, or an admin
// and the booking preconditions still hold (both confirmations set for
// release, start/end times for recalculation). The confirmation flags
// themselves can only be set by their own party (database guard in
// supabase/migrations/00003_p0_security_hardening.sql).
//
// ============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
/* Pricing formula and commission brackets: one copy, shared with
 * calculate-price and the payment functions. */
import {
  VAN_HOURLY_RATES,
  PRICING,
  calculateServerPrice,
  computeCommission,
} from '../_shared/pricing.ts';
import { getCaller, driverProfileIdOf } from '../_shared/auth.ts';
import { activePlanSlug } from '../_shared/plans.ts';
import { vippsCapture } from '../_shared/vipps-payments.ts';
import { VIPPS_BASE, vippsApiHeaders, vippsMissingConfig } from '../_shared/vipps.ts';

/* ─── Env (Supabase injects these automatically) ─────────────── */
const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function calculatePrice(inp: { vanType: string; hours: number; distanceKm: number; helpers: number; extras: string[] }) {
  return calculateServerPrice(inp);
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
  action:    'recalculate_price' | 'release_escrow' | 'capture';
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

  const caller = await getCaller(req, supabase);
  if (!caller) return json({ error: 'Sign in required' }, 401);

  try {
    const { data: party } = await supabase
      .from('bookings')
      .select('customer_id, driver_id')
      .eq('id', body.bookingId)
      .maybeSingle();
    if (!party) return json({ error: 'booking not found' }, 404);
    const callerDriverId = await driverProfileIdOf(supabase, caller.id);
    const isDriver   = !!callerDriverId && party.driver_id === callerDriverId;
    const isCustomer = party.customer_id === caller.id;
    const allowed = caller.isAdmin || (body.action === 'recalculate_price' ? isDriver : (isDriver || isCustomer));
    if (!allowed) return json({ error: 'booking not found' }, 404);

    if (body.action === 'recalculate_price') return await recalculatePrice(body.bookingId);
    if (body.action === 'release_escrow')    return await releaseEscrow(body.bookingId);
    if (body.action === 'capture')           return await captureOnly(body.bookingId);
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

  /* Recalculate using the same formula, with the actual hours substituted. The distance is the server's
   * (chargeForBooking always writes it). Since 31 October 2026 the charge may already bill the drive time
   * beyond the hours chosen, so there is an extra charge only when the recalculated price is higher than
   * what was charged. */
  const recalc = actualHours > estimatedHours ? calculatePrice({
    vanType:    booking.van_type ?? 'medium_van',
    hours:      actualHours,
    distanceKm: Number(booking.distance_km ?? 0),
    helpers:    Number(booking.helpers ?? 0),
    extras:     (booking.additional_services as string[] | null) ?? [],
  }) : null;

  if (recalc && Math.round(recalc.total) > originalPrice) {
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

/* ─── Capture (Vipps) ──────────────────────────────────────────── */

/**
 * Capture a reserved Vipps payment, once: the idempotency key is the
 * booking's, and vippsCapture asks nothing if Vipps already shows it
 * captured. Returns a Response when the caller must stop (Vipps not
 * reachable: try again; refused: needs attention), else null with the
 * booking's captured amount recorded (payment_capture_mark).
 */
async function captureIfNeeded(booking: any): Promise<{ stop: Response } | { capturedNok: number | null }> {
  if (booking.payment_provider !== 'vipps') {
    return { capturedNok: booking.captured_amount != null ? Number(booking.captured_amount) : null };
  }
  if (booking.captured_at) return { capturedNok: Number(booking.captured_amount ?? booking.paid_amount) };
  if (!booking.payment_intent_id) {
    return { stop: json({ error: 'the Vipps payment has no reference; capture it in the Vipps portal' }, 409) };
  }
  const missing = vippsMissingConfig();
  if (missing.length) return { stop: json({ error: `Vipps not configured: ${missing.join(', ')}`, retry: true }, 503) };

  const amountOre = Math.round(Number(booking.paid_amount ?? booking.price_estimate) * 100);
  const out = await vippsCapture(fetch, { base: VIPPS_BASE, headers: await vippsApiHeaders() }, {
    reference: booking.payment_intent_id, amountOre, idempotencyKey: `flyttgo-capture-${booking.id}`,
  });
  await supabase.from('payment_events').upsert({
    provider: 'vipps', event_id: `capture-${booking.id}-${out.kind}`, kind: 'capture', booking_id: booking.id, result: out,
  }, { onConflict: 'provider,event_id', ignoreDuplicates: true });

  if (out.kind === 'retry') {
    console.warn(`capture of ${booking.id} not confirmed: ${out.error}`);
    return { stop: json({ status: 'capture_pending', retry: true, error: out.error }, 202) };
  }
  if (out.kind === 'failed') {
    console.error(`capture of ${booking.id} refused: ${out.error}`);
    return { stop: json({ status: 'capture_failed', error: out.error }, 502) };
  }
  const capturedNok = out.capturedOre / 100;
  const { error } = await supabase.rpc('payment_capture_mark', { p_booking_id: booking.id, p_amount: capturedNok });
  if (error) throw new Error(`payment_capture_mark failed: ${error.message}`);
  return { capturedNok };
}

/* ─── Action: capture ──────────────────────────────────────────── */

async function captureOnly(bookingId: string) {
  const { data: booking } = await supabase.from('bookings').select('*').eq('id', bookingId).maybeSingle();
  if (!booking) return json({ error: 'booking not found' }, 404);
  if (!['paid', 'escrow'].includes(String(booking.payment_status))) {
    return json({ error: `booking payment_status is ${booking.payment_status}; nothing to capture` }, 409);
  }
  const cap = await captureIfNeeded(booking);
  if ('stop' in cap) return cap.stop;
  return json({ ok: true, status: 'captured', capturedNok: cap.capturedNok });
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

  /* Already settled: both parties confirm and both call this, so the
   * second call must not pay the driver again. (Production's
   * release_booking_escrow_after_confirmation trigger may already have
   * set status='released' without a driver_earning; that row is not
   * settled yet and is completed here.) */
  if (escrow.status === 'refunded' || booking.payment_status === 'released'
      || (escrow.status === 'released' && escrow.driver_earning != null)) {
    return json({ ok: true, idempotent: true, status: escrow.status });
  }
  /* Money must have been captured by a provider webhook first. */
  if (!['paid', 'escrow'].includes(String(booking.payment_status))) {
    return json({ error: `booking payment_status is ${booking.payment_status}; nothing captured to release` }, 409);
  }

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

  /* A Vipps reservation is captured now, before any money moves to the
   * driver; the driver is never paid more than was collected. An extra
   * charge above the reservation (an approved over-time adjustment) has
   * to be paid separately first. */
  const cap = await captureIfNeeded(booking);
  if ('stop' in cap) return cap.stop;
  if (booking.payment_provider === 'vipps' && cap.capturedNok != null && amount > cap.capturedNok + 0.005) {
    return json({
      error: `the release (${amount} NOK) is more than Vipps collected (${cap.capturedNok} NOK); the extra charge must be paid first`,
    }, 409);
  }

  /* Look up the driver's active subscription plan for commission
   * calculation. Default to 'basic' if anything's missing. */
  let plan = 'basic';
  if (booking.driver_id) {
    /* bookings.driver_id is driver_profiles.id; driver_subscriptions
     * is keyed by the driver's auth user id, its plan by plan_id. */
    const { data: dp } = await supabase
      .from('driver_profiles')
      .select('user_id')
      .eq('id', booking.driver_id)
      .maybeSingle();
    if (dp?.user_id) {
      plan = (await activePlanSlug(supabase, dp.user_id)) ?? plan;
    }
  }
  const { commission, earning, ratePct } = computeCommission(amount, plan);

  /* Update escrow_payments → released with the driver's earning. The
   * wallet is credited by the settle_driver_wallet_after_release
   * trigger (supabase/migrations/00003), once, when driver_earning is
   * first set on a released row. Compare-and-set on driver_earning so
   * two simultaneous calls settle once. */
  const { data: released, error: releaseErr } = await supabase
    .from('escrow_payments')
    .update({
      status:            'released',
      released_at:       new Date().toISOString(),
      commission_amount: commission,
      driver_earning:    earning,
      final_price:       amount,
    })
    .eq('booking_id', bookingId)
    .is('driver_earning', null)
    .select('id');
  if (releaseErr) return json({ error: 'escrow release failed', detail: releaseErr.message }, 500);
  if (!released || released.length === 0) {
    return json({ ok: true, idempotent: true, status: 'released' });
  }

  /* Mark booking payment_status = 'released'. */
  const { error: bStatusErr } = await supabase
    .from('bookings')
    .update({ payment_status: 'released' })
    .eq('id', bookingId);
  if (bStatusErr) console.warn('booking payment_status update failed:', bStatusErr.message);

  return json({
    ok:             true,
    amount,
    commissionPct:  ratePct,
    commission,
    driverEarning:  earning,
    plan,
  });
}
