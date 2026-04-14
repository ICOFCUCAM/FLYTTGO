import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * useDriverLocationBeacon
 *
 * While the driver has an active job (`driver_assigned`,
 * `pickup_arrived`, `loading`, or `in_transit`), this hook:
 *   1. Asks the browser for permission to read GPS via
 *      navigator.geolocation.watchPosition.
 *   2. Throttles position updates to one every ~10 seconds so we
 *      don't hammer Supabase.
 *   3. Upserts each update into the `driver_locations` table so
 *      DriverTrackingMap on the customer side can render the live
 *      position.
 *
 * When no job is active (or the driver isn't logged in), the watch
 * is torn down so the device stops draining battery.
 *
 * Schema requirement:
 *   public.driver_locations (
 *     driver_id uuid primary key references auth.users(id),
 *     lat        numeric,
 *     lng        numeric,
 *     heading    numeric,
 *     speed      numeric,
 *     updated_at timestamptz default now()
 *   );
 *   alter publication supabase_realtime add table public.driver_locations;
 *
 * (The driver_locations table already exists in your schema dump —
 * see docs/realtime-tracking-setup.sql for the publication step.)
 */

const ACTIVE_STATUSES = ['driver_assigned', 'pickup_arrived', 'loading', 'in_transit'];
const MIN_INTERVAL_MS = 10_000;

interface ActiveJob {
  id: string;
  status: string | null;
  driver_id?: string | null;
}

interface Options {
  driverId: string | null | undefined;
  jobs: ActiveJob[] | null | undefined;
}

export function useDriverLocationBeacon({ driverId, jobs }: Options) {
  const lastPushAt = useRef(0);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!driverId || typeof navigator === 'undefined' || !navigator.geolocation) return;

    const hasActiveJob = (jobs ?? []).some(
      j => j.driver_id === driverId && j.status && ACTIVE_STATUSES.includes(j.status)
    );

    if (!hasActiveJob) {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      return;
    }

    /* Already watching — let the existing watch keep running. */
    if (watchId.current != null) return;

    const handleSuccess = async (pos: GeolocationPosition) => {
      const now = Date.now();
      if (now - lastPushAt.current < MIN_INTERVAL_MS) return;
      lastPushAt.current = now;

      try {
        await supabase.from('driver_locations').upsert(
          {
            driver_id: driverId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading ?? null,
            speed: pos.coords.speed ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'driver_id' }
        );
      } catch (err) {
        /* Never let a beacon failure crash the driver portal. */
        // eslint-disable-next-line no-console
        console.warn('[driver-beacon] upsert failed:', err);
      }
    };

    const handleError = (err: GeolocationPositionError) => {
      // eslint-disable-next-line no-console
      console.warn('[driver-beacon] geolocation error:', err.message);
    };

    watchId.current = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      maximumAge: 5_000,
      timeout: 30_000,
    });

    return () => {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, [driverId, jobs]);
}
