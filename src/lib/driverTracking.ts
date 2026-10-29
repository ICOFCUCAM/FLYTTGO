/**
 * Live driver tracking — the pieces shared by the driver's beacon and
 * the customer's map, kept free of React and Leaflet so they can be
 * tested (src/test/driver-tracking.test.ts).
 *
 * Identity (supabase/migrations/00002): driver_locations.driver_id is the
 * driver's auth user id; bookings.driver_id is driver_profiles.id. The
 * customer cannot read driver_profiles, so the map asks the database for
 * the driver of *its own* in-flight booking (booking_driver_user RPC) and
 * then reads and subscribes to that driver's location, which RLS allows
 * only while the booking is in flight.
 */

export const ACTIVE_STATUSES = ['driver_assigned', 'pickup_arrived', 'loading', 'in_transit'];

export interface Coords { lat: number; lng: number }

/** True when one of the driver's own jobs is in flight. */
export function hasActiveJob(
  jobs: { driver_id?: string | null; status?: string | null }[] | null | undefined,
  driverProfileId: string | null | undefined,
): boolean {
  if (!driverProfileId) return false;
  return (jobs ?? []).some(j => j.driver_id === driverProfileId && !!j.status && ACTIVE_STATUSES.includes(j.status));
}

/** The row the beacon writes, keyed by the driver's auth user id. */
export function locationRow(userId: string, pos: { coords: { latitude: number; longitude: number; heading?: number | null; speed?: number | null } }, now = new Date()) {
  return {
    driver_id:  userId,
    lat:        pos.coords.latitude,
    lng:        pos.coords.longitude,
    heading:    pos.coords.heading ?? null,
    speed:      pos.coords.speed ?? null,
    updated_at: now.toISOString(),
  };
}

function toCoords(row: { lat?: unknown; lng?: unknown } | null | undefined): Coords | null {
  if (!row) return null;
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/* The slice of the Supabase client used here (structural, so a fake
 * client can stand in for it in tests). */
export interface TrackingClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
  from: (table: string) => any;
  channel: (name: string) => any;
  removeChannel: (channel: any) => unknown;
}

/**
 * Follow the driver of a booking: resolve the driver, read the last
 * known position, then follow updates over Realtime. Calls onPosition
 * for every position; returns a function that stops following.
 */
export function followBookingDriver(
  client: TrackingClient,
  bookingId: string,
  onPosition: (pos: Coords) => void,
): () => void {
  let stopped = false;
  let channel: any = null;

  (async () => {
    const { data: driverUserId, error } = await client.rpc('booking_driver_user', { p_booking_id: bookingId });
    if (stopped || error || !driverUserId) return;

    const { data: last } = await client
      .from('driver_locations')
      .select('lat,lng,updated_at')
      .eq('driver_id', driverUserId)
      .maybeSingle();
    const first = toCoords(last);
    if (!stopped && first) onPosition(first);
    if (stopped) return;

    channel = client
      .channel(`driver-loc-${bookingId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_locations', filter: `driver_id=eq.${driverUserId}` },
        (payload: { new?: any; old?: any }) => {
          const pos = toCoords(payload.new ?? payload.old);
          if (!stopped && pos) onPosition(pos);
        },
      )
      .subscribe();
  })();

  return () => {
    stopped = true;
    if (channel) client.removeChannel(channel);
  };
}
