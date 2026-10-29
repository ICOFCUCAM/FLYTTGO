import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { hasActiveJob, locationRow } from '../lib/driverTracking';

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
 * Identity: jobs are matched on the driver's profile id
 * (bookings.driver_id = driver_profiles.id) and the location is written
 * under the driver's auth user id (driver_locations.driver_id, primary
 * key, references auth.users — supabase/migrations/00002). Before this,
 * jobs were compared with the user id, which never matched, so the
 * beacon never started. Realtime publication and RLS: 00003.
 */

const MIN_INTERVAL_MS = 10_000;

interface ActiveJob {
  id: string;
  status: string | null;
  driver_id?: string | null;
}

interface Options {
  /** The driver's auth user id: the key the location is written under. */
  userId: string | null | undefined;
  /** driver_profiles.id: what bookings.driver_id holds. */
  driverProfileId: string | null | undefined;
  jobs: ActiveJob[] | null | undefined;
}

export function useDriverLocationBeacon({ userId, driverProfileId, jobs }: Options) {
  const lastPushAt = useRef(0);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!userId || typeof navigator === 'undefined' || !navigator.geolocation) return;

    if (!hasActiveJob(jobs, driverProfileId)) {
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
        const { error } = await supabase.from('driver_locations').upsert(
          locationRow(userId, pos),
          { onConflict: 'driver_id' }
        );
        if (error) console.warn('[driver-beacon] upsert refused:', error.message);
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
  }, [userId, driverProfileId, jobs]);
}
