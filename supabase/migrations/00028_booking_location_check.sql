-- ============================================================================
-- FlyttGo — the server's check of a booking's pickup and drop-off points
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00027. The payment functions price a
-- booking by routing between its stored coordinates, which the browser sends.
-- Since 31 October 2026 chargeForBooking() (supabase/functions/_shared/
-- booking-charge.ts, address-check.ts) first looks both addresses up in
-- Kartverket's address register: a point far from its address is replaced by
-- the register's, one that cannot be looked up is used and marked unconfirmed.
-- The result is recorded here so the office can see which bookings were
-- corrected or not confirmed before dispatch:
--
--   location_check  jsonb  { checked_at, source, pickup: { status, precision,
--                            off_km, submitted? }, dropoff: { … } }
--                          status: confirmed | corrected | unconfirmed
--
-- Written only by the payment functions (service role). Customers and drivers
-- cannot change it: the bookings guard (00003) allows only listed columns on
-- update, and on insert it is cleared below for anyone not privileged.
--
-- Safe to re-run. Rolled back by supabase/rollback/00028_down.sql.
-- ============================================================================

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS location_check jsonb;

COMMENT ON COLUMN public.bookings.location_check IS
  'The payment functions'' check of the pickup and drop-off points against the addresses (Kartverket): confirmed, corrected or unconfirmed. Server only.';

CREATE OR REPLACE FUNCTION public.clear_booking_location_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_privileged() THEN
    NEW.location_check := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_booking_location_check() FROM PUBLIC;

DROP TRIGGER IF EXISTS bookings_clear_location_check ON public.bookings;
CREATE TRIGGER bookings_clear_location_check
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.clear_booking_location_check();
