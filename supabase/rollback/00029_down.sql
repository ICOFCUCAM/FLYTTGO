-- ============================================================================
-- Roll back 00029_booking_reference_tracking.sql
-- ============================================================================
-- Run first (before the rollback of 00028). Removes the public lookup, the
-- reference (its trigger, functions, index and column) and bookings from the
-- realtime publication. References already given to customers stop working:
-- roll back the tracking page and confirmation screens first. Tested by run.sh.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bookings') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.bookings;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.track_booking(text);
DROP TRIGGER IF EXISTS bookings_set_booking_ref ON public.bookings;
DROP FUNCTION IF EXISTS public.set_booking_ref();
DROP FUNCTION IF EXISTS public.new_booking_ref();
DROP INDEX IF EXISTS public.bookings_booking_ref_key;
ALTER TABLE public.bookings DROP COLUMN IF EXISTS booking_ref;
