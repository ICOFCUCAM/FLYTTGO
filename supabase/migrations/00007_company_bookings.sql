-- ============================================================================
-- FlyttGo — company bookings (step 4 of the corporate plan)
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00006. Uses the one booking and
-- dispatch engine: a company booking is an ordinary booking with the
-- company it was made for.
--
--   * bookings.organization_id: set when the booking is made, never
--     changed afterwards by customers or drivers (the booking guard of
--     00003 refuses any column outside its allow-list).
--   * Only an owner, admin or booker of an ACTIVE company may book for
--     it (is_active_org_member, 00006): a pending, suspended or closed
--     company cannot commit spending. The person booking stays the
--     booking's customer (customer_id) and pays as today; invoicing the
--     company is step 5.
--   * Every member of the company reads the company's bookings (finance
--     and viewers included); a former member does not.
--
-- Safe to re-run.
-- ============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS organization_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_organization_id_fkey'
                  AND conrelid = 'public.bookings'::regclass) THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations (id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS bookings_organization_idx
  ON public.bookings (organization_id, created_at DESC) WHERE organization_id IS NOT NULL;

-- Who may put a company on a booking: an owner, admin or booker of an
-- active company, for a booking they make themselves. The server and
-- platform administrators may correct it.
CREATE OR REPLACE FUNCTION public.guard_booking_organization()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL OR public.is_privileged() THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'bookings: the company of a booking cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.customer_id IS DISTINCT FROM auth.uid()
     OR NOT public.is_active_org_member(NEW.organization_id, ARRAY['owner', 'admin', 'booker']) THEN
    RAISE EXCEPTION 'bookings: only an owner, admin or booker of an active company books for it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_booking_organization ON public.bookings;
CREATE TRIGGER guard_booking_organization
  BEFORE INSERT OR UPDATE OF organization_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_organization();
REVOKE ALL ON FUNCTION public.guard_booking_organization() FROM PUBLIC, anon, authenticated;

-- Members read their company's bookings.
DROP POLICY IF EXISTS bookings_organization_select ON public.bookings;
CREATE POLICY bookings_organization_select ON public.bookings
  FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(organization_id));

-- An organisation with bookings is closed, never deleted (the bookings
-- are its record): the foreign key refuses the delete.

-- ============================================================================
-- DONE
-- ============================================================================
