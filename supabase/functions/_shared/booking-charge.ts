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
// ============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { bookingChargeNok, bookingCoordinates, routeDistance } from './pricing.ts';

export type ChargeResult =
  | { ok: true; bookingId: string; amountNok: number; priceChanged: boolean; customerEmail: string | null }
  | { ok: false; status: number; error: string };

export async function chargeForBooking(
  db:        SupabaseClient,
  bookingId: string,
  callerId:  string,
): Promise<ChargeResult> {
  const { data: booking, error } = await db
    .from('bookings')
    .select('id, customer_id, customer_email, payment_status, status, van_type, estimated_hours, helpers, additional_services, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, price_estimate')
    .eq('id', bookingId)
    .maybeSingle();

  if (error)    return { ok: false, status: 500, error: 'booking read failed' };
  /* Same answer for "missing" and "not yours", so ids can't be probed. */
  if (!booking || booking.customer_id !== callerId) return { ok: false, status: 404, error: 'booking not found' };
  if (booking.status === 'cancelled') return { ok: false, status: 409, error: 'booking is cancelled' };
  if ((booking.payment_status ?? 'pending') !== 'pending') {
    return { ok: false, status: 409, error: `booking payment_status is ${booking.payment_status}` };
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

  return { ok: true, bookingId, amountNok, priceChanged, customerEmail: booking.customer_email ?? null };
}
