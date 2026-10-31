/**
 * One mapping from a booking's status to the tracking timeline (owner, 31 October 2026). The record covers
 * every status the bookings table allows (its CHECK constraint, supabase/schema/production-2026-10-29.sql),
 * so adding a status without a step fails to compile; cancelled is a state of its own, never a step.
 * Times are only ever the booking's own (created, started, finished, cancelled), never invented.
 */
export const BOOKING_STATUSES = ['pending', 'confirmed', 'driver_assigned', 'pickup_arrived', 'loading', 'in_transit', 'completed', 'cancelled'] as const;
export type BookingStatus = typeof BOOKING_STATUSES[number];

export const TRACKING_STEPS = ['booked', 'assigned', 'arrived', 'loading', 'transit', 'delivered'] as const;
export type TrackingStep = typeof TRACKING_STEPS[number];

const STEP_OF: Record<Exclude<BookingStatus, 'cancelled'>, number> = {
  pending: 0,
  confirmed: 0,
  driver_assigned: 1,
  pickup_arrived: 2,
  loading: 3,
  in_transit: 4,
  completed: 5,
};

export interface TrackingState {
  /** Index into TRACKING_STEPS of the step reached; -1 when cancelled or unknown. */
  step: number;
  cancelled: boolean;
  /** A status this version does not know (shown as such, never as step one). */
  unknown: boolean;
  /** The driver is on the way to, or working at, a place we can estimate an arrival for. */
  heading: 'pickup' | 'dropoff' | null;
}

export function trackingState(status: string | null | undefined): TrackingState {
  if (status === 'cancelled') return { step: -1, cancelled: true, unknown: false, heading: null };
  if (status && status in STEP_OF) {
    const step = STEP_OF[status as keyof typeof STEP_OF];
    const heading = status === 'driver_assigned' ? 'pickup' : status === 'in_transit' || status === 'loading' ? 'dropoff' : null;
    return { step, cancelled: false, unknown: false, heading };
  }
  return { step: -1, cancelled: false, unknown: true, heading: null };
}

/** The real time recorded for a step, if the booking has one. */
export function stepTime(step: TrackingStep, b: { created_at?: string | null; start_time?: string | null; end_time?: string | null }): string | null {
  if (step === 'booked') return b.created_at ?? null;
  if (step === 'transit') return b.start_time ?? null;
  if (step === 'delivered') return b.end_time ?? null;
  return null;
}

/** A tracking reference typed by a person, normalised to FG-XXXXXX, or null when it cannot be one. */
export function normaliseRef(input: string): string | null {
  let v = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.startsWith('FG')) v = v.slice(2);
  return /^[2-9A-HJKMNP-Z]{6}$/.test(v) ? `FG-${v}` : null;
}

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
