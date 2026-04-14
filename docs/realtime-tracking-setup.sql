-- ============================================================================
-- FlyttGo — enable realtime + RLS for live driver tracking
-- ============================================================================
--
-- The DriverTrackingMap component (src/components/DriverTrackingMap.tsx)
-- subscribes to driver_locations via Supabase Realtime. The
-- useDriverLocationBeacon hook (src/hooks/useDriverLocationBeacon.ts)
-- pushes the driver's GPS position every ~10s while a job is in flight.
--
-- For the live marker on the customer's MyBookings page to actually
-- update, two things have to be true on the database side:
--
--   1. driver_locations is in the supabase_realtime publication (so
--      INSERT/UPDATE events get streamed to subscribers).
--
--   2. RLS policies allow the customer of an active booking to SELECT
--      the row for that booking's driver, AND allow the driver to
--      upsert their own row.
--
-- Run this entire file once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

-- 1. Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;

-- 2. RLS — the table already exists in the schema dump but RLS isn't
--    set up.

ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;

-- The driver writing their own row.
DROP POLICY IF EXISTS driver_locations_self_upsert ON public.driver_locations;
CREATE POLICY driver_locations_self_upsert ON public.driver_locations
  FOR ALL
  USING       (driver_id = auth.uid())
  WITH CHECK  (driver_id = auth.uid());

-- The customer of an active booking can read the assigned driver's
-- live position. This is the join the map relies on.
DROP POLICY IF EXISTS driver_locations_customer_read ON public.driver_locations;
CREATE POLICY driver_locations_customer_read ON public.driver_locations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.driver_id   = public.driver_locations.driver_id
        AND b.customer_id = auth.uid()
        AND b.status IN ('driver_assigned', 'pickup_arrived', 'loading', 'in_transit')
    )
  );

-- Admins can see every driver's location (depends on public.is_admin()
-- from docs/admin-rls-policies.sql).
DROP POLICY IF EXISTS driver_locations_admin_read ON public.driver_locations;
CREATE POLICY driver_locations_admin_read ON public.driver_locations
  FOR SELECT
  USING (public.is_admin());

-- ============================================================================
-- Verify
-- ============================================================================
-- After running this:
--   1. Open https://supabase.com/dashboard/project/<your-ref>/database/replication
--      and confirm "driver_locations" is checked under supabase_realtime.
--   2. Sign in as a driver, open the DriverPortal, accept a job and
--      mark it in_transit. The browser should prompt for location
--      permission and start posting to driver_locations every ~10s.
--   3. In a different browser/incognito, sign in as the customer for
--      that booking, open MyBookings, and the green dot should appear
--      on the map and move in real time.
