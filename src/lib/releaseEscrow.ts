import { callFunction } from './supabase';

/**
 * Ask process-payment to release the escrow after both confirmations and
 * say what happened. A Vipps payment is captured first; if Vipps has not
 * confirmed the capture yet (202), nothing is released and the release is
 * repeated on the next try.
 */
export async function releaseEscrow(bookingId: string): Promise<'released' | 'waiting' | 'failed'> {
  try {
    const res = await callFunction('process-payment', { action: 'release_escrow', bookingId });
    if (res.status === 202) return 'waiting';
    return res.ok ? 'released' : 'failed';
  } catch {
    return 'failed';
  }
}
