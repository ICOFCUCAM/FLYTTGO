import { callFunction } from './supabase';

/** What the customer is told before cancelling (Terms §6.1). */
export const CANCELLATION_NOTICE =
  'Cancel this booking?\n\n' +
  'More than 24 hours before pickup: full refund.\n' +
  'Within 24 hours of pickup: 50% is kept as a cancellation fee.';

/**
 * Cancel through the cancel-booking function, which records the
 * cancellation as the customer's and refunds what the policy gives, back
 * to the card or Vipps. Returns the message to show.
 */
export async function cancelBookingWithRefund(bookingId: string): Promise<string> {
  let res: Response;
  try {
    res = await callFunction('cancel-booking', { bookingId });
  } catch {
    return 'The booking could not be cancelled right now. Please try again.';
  }
  const out = await res.json().catch(() => ({} as Record<string, any>));
  if (!res.ok && res.status !== 202) return out.error ?? 'The booking could not be cancelled.';
  const refund = out.refund as { status?: string; error?: string; refund?: { amount?: number } } | null;
  if (!refund) return out.note ? `Booking cancelled. ${out.note}.` : 'Booking cancelled.';
  const amount = refund.refund?.amount != null ? `${refund.refund.amount} NOK` : 'Your refund';
  switch (refund.status) {
    case 'succeeded': return `Booking cancelled. ${amount} is on its way back to you.`;
    case 'pending':   return `Booking cancelled. ${amount} has been sent back; it can take a few days to show.`;
    case 'requested': return 'Booking cancelled. The refund could not be confirmed yet; we will complete it.';
    case 'failed':    return 'Booking cancelled, but the refund failed. Our support team has been notified and will contact you.';
    default:          return refund.error ? `Booking cancelled. ${refund.error}` : 'Booking cancelled.';
  }
}
