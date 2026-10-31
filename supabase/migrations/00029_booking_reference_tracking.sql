-- ============================================================================
-- FlyttGo — a short booking reference, a safe public lookup, live status
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00028. Owner, 31 October 2026
-- (premium tracking):
--
--   * bookings.booking_ref: a short reference a person can read aloud and type
--     (FG-7K3M9Q: "FG-" and six characters without 0/O/1/I/L), set by the
--     database on every new booking and backfilled for existing ones. Before,
--     screens showed the first eight characters of the booking id, which the
--     tracking page could not look up. Unique; customers and drivers cannot set
--     or change it (the bookings guard of 00003 allows only listed columns on
--     update; on insert it is always generated here).
--
--   * public.track_booking(ref): the tracking page's lookup by reference, open
--     to visitors who are not signed in. It returns only what is safe to show
--     anyone holding the reference: the status, its times, the van size and the
--     two towns. No names, phone numbers, emails, street addresses, prices or
--     driver details; the booking's own customer gets the booking id as well,
--     to read the full booking under the usual row rules.
--
--   * bookings joins the realtime publication, so a signed-in customer's
--     tracking page follows the status as it changes (row security still
--     decides which rows a subscriber receives).
--
-- Safe to re-run. Rolled back by supabase/rollback/00029_down.sql.
-- ============================================================================

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS booking_ref text;

COMMENT ON COLUMN public.bookings.booking_ref IS
  'Short reference for people (FG-XXXXXX), set by the database on insert; looked up by track_booking().';

-- A new, unused reference: "FG-" and six characters from an alphabet without 0, O, 1, I and L.
CREATE OR REPLACE FUNCTION public.new_booking_ref()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes    bytea;
  v_ref      text;
  i          int;
BEGIN
  LOOP
    v_bytes := uuid_send(gen_random_uuid());
    v_ref := 'FG-';
    FOR i IN 0..5 LOOP
      v_ref := v_ref || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.bookings WHERE booking_ref = v_ref);
  END LOOP;
  RETURN v_ref;
END;
$$;

REVOKE ALL ON FUNCTION public.new_booking_ref() FROM PUBLIC;

-- Every new booking gets one; nobody chooses their own.
CREATE OR REPLACE FUNCTION public.set_booking_ref()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.booking_ref IS NULL OR NOT public.is_privileged() THEN
    NEW.booking_ref := public.new_booking_ref();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_booking_ref() FROM PUBLIC;

DROP TRIGGER IF EXISTS bookings_set_booking_ref ON public.bookings;
CREATE TRIGGER bookings_set_booking_ref
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_booking_ref();

-- Existing bookings, one at a time so each reference is checked against the ones already given.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.bookings WHERE booking_ref IS NULL LOOP
    UPDATE public.bookings SET booking_ref = public.new_booking_ref() WHERE id = r.id;
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_booking_ref_key ON public.bookings (booking_ref);

-- The tracking page's lookup. Accepts the reference with or without "FG-", spaces and case.
CREATE OR REPLACE FUNCTION public.track_booking(p_ref text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref text;
  b     record;
  v_own boolean;
BEGIN
  v_ref := upper(regexp_replace(coalesce(p_ref, ''), '[^A-Za-z0-9]', '', 'g'));
  IF v_ref LIKE 'FG%' THEN v_ref := substr(v_ref, 3); END IF;
  IF v_ref !~ '^[2-9A-HJKMNP-Z]{6}$' THEN RETURN NULL; END IF;
  v_ref := 'FG-' || v_ref;

  SELECT id, customer_id, booking_ref, status, payment_status, created_at, updated_at, move_date, move_time,
         start_time, end_time, cancelled_at, van_type, pickup_city, dropoff_city, driver_id
    INTO b
    FROM public.bookings WHERE booking_ref = v_ref;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_own := auth.uid() IS NOT NULL AND b.customer_id = auth.uid();
  RETURN jsonb_build_object(
    'ref',             b.booking_ref,
    'status',          b.status,
    'paid',            b.payment_status IN ('paid', 'escrow', 'released'),
    'created_at',      b.created_at,
    'updated_at',      b.updated_at,
    'move_date',       b.move_date,
    'move_time',       b.move_time,
    'start_time',      b.start_time,
    'end_time',        b.end_time,
    'cancelled_at',    b.cancelled_at,
    'van_type',        b.van_type,
    'pickup_city',     b.pickup_city,
    'dropoff_city',    b.dropoff_city,
    'driver_assigned', b.driver_id IS NOT NULL,
    'is_owner',        v_own,
    'booking_id',      CASE WHEN v_own THEN b.id END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.track_booking(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_booking(text) TO anon, authenticated;

-- Live status for the booking's own customer (row security decides what a subscriber receives).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bookings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
  END IF;
END;
$$;
