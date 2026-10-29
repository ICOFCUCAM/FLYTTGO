-- ============================================================================
-- Roll back 00007_company_bookings.sql
-- ============================================================================
-- Run first (before 00006_down.sql). Tested by run.sh: afterwards the
-- schema is exactly as before 00007.
--
-- DATA LOSS: bookings.organization_id is dropped: which company each
-- booking was made for. Export it first if any company booked.
-- ============================================================================

DROP POLICY IF EXISTS bookings_organization_select ON public.bookings;
DROP TRIGGER IF EXISTS guard_booking_organization ON public.bookings;
DROP FUNCTION IF EXISTS public.guard_booking_organization();
DROP INDEX IF EXISTS public.bookings_organization_idx;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_organization_id_fkey;
ALTER TABLE public.bookings DROP COLUMN IF EXISTS organization_id;
