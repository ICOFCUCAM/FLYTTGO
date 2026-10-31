-- ============================================================================
-- Roll back 00028_booking_location_check.sql
-- ============================================================================
-- Run first (before the rollback of 00027). Drops the check's trigger,
-- function and column. The payment functions then fail to write
-- location_check, so roll back their code (booking-charge.ts) first.
-- Tested by run.sh.
-- ============================================================================

DROP TRIGGER IF EXISTS bookings_clear_location_check ON public.bookings;
DROP FUNCTION IF EXISTS public.clear_booking_location_check();
ALTER TABLE public.bookings DROP COLUMN IF EXISTS location_check;
