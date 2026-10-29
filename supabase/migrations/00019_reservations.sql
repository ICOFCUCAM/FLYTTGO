-- ============================================================================
-- FlyttGo — Reservations: restaurant tables and hotel rooms
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00015 (and 00016–00018); builds on 00010,
-- 00011 and the patterns of 00013 (docs/SERVICE_PLATFORM.md).
-- Two booking modules beside Jobs (00012) and Appointments (00013), each
-- enabled by the company's plan (org_has_module()). The company is always
-- the seller (Model B).
--
-- Restaurant tables ('restaurant_reservations'):
--   * The company lists its tables (seats, the smallest party it seats,
--     whether it can be combined) and the combinations it allows, its
--     service periods per weekday (lunch, dinner), the time a table is kept
--     per party size, its booking window and lead time, closed dates, and
--     an optional no-show fee.
--   * available_restaurant_times() computes free times for a day and party
--     size in Europe/Oslo: a time is offered when a table (or an allowed
--     combination) that fits the party is free for the whole turn.
--     Visitors see them before signing in; booking needs a sign-in. A lock
--     per restaurant (its floor: a reservation may take several tables)
--     means two people never get the same table.
--   * The company books phone guests and walk-ins (also outside the
--     periods, never over another reservation), seats them, and marks them
--     completed or no-show. Notes are the guest's own words (for example
--     allergies); there is no health field.
--   * A no-show fee is charged only when the company had stated one before
--     the booking: the fee is copied onto the reservation when it is made,
--     and invoiced in the company's name (00011).
--
-- Hotel rooms ('hotel_reservations'):
--   * Room types (capacity, nightly price incl. MVA), rooms, closed rooms
--     and dates, and the hotel's rules: the MVA rate for accommodation (a
--     company setting: never assumed here), check-in and check-out times,
--     booking window, lead time, nights, and the cancellation rule (free
--     until N days before arrival, then a fee as a share of the stay).
--   * available_hotel_rooms() lists the free room types for a date range.
--     Every stay is given a room when it is booked, under a lock per room
--     type, so a night is never sold twice.
--   * The company checks guests in (optionally into another room) and out,
--     marks no-shows, cancels; the stay, or the cancellation fee, is
--     invoiced in the company's name (00011).
--   * Only what the booking needs is stored (name, phone, email, number of
--     guests). The guest register Norwegian hotels must keep is not built
--     here: an owner and legal decision (docs/SERVICE_PLATFORM.md).
--
-- Reminders are sent by appointment-reminders (hourly): the day before a
-- table, the day before arrival.
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Plans carry the new modules ──────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'white_label_plans_modules_check'
               AND pg_get_constraintdef(oid) NOT LIKE '%restaurant_reservations%') THEN
    ALTER TABLE public.white_label_plans DROP CONSTRAINT white_label_plans_modules_check;
    ALTER TABLE public.white_label_plans ADD CONSTRAINT white_label_plans_modules_check CHECK (
          modules <@ ARRAY['jobs', 'appointments', 'sales_invoicing', 'restaurant_reservations', 'hotel_reservations']
      -- FlyttGo sells only moving and delivery.
      AND (seller_model = 'company' OR (cardinality(modules) = 0 AND industries <@ ARRAY['transport'])));
  END IF;
  -- A company's invoice can come from a table reservation or a hotel stay.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_source_type_check'
               AND pg_get_constraintdef(oid) NOT LIKE '%hotel_stay%') THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_source_type_check;
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_source_type_check CHECK (
      source_type IS NULL OR source_type IN ('job', 'appointment', 'manual', 'restaurant_reservation', 'hotel_stay'));
  END IF;
END $$;

-- Proposed plans and prices (excl. MVA), until FlyttGo confirms them in
-- Admin → White label. The company sells.
INSERT INTO public.white_label_plans (code, name, seller_model, summary, for_whom, setup_fee, monthly_fee, own_domain,
                                      features, flyttgo_does, company_does, requirements, sort, modules, industries)
SELECT * FROM (VALUES
  ('restaurant', 'Restaurant: table booking', 'company',
   'Guests book a table online for their party; you book phone guests and walk-ins, seat them and see the evening at a glance.',
   'Restaurants, cafés and bars that take table reservations.',
   2900::numeric, 990::numeric, false,
   ARRAY['Online table booking by party size, in your service periods',
         'Your tables and the combinations you allow; no table booked twice',
         'Phone bookings and walk-ins, seating, completed and no-show',
         'Your cancellation rule and an optional no-show fee, invoiced in your name',
         'Email reminders the day before',
         'A website from the template library'],
   ARRAY['Runs the booking and invoicing system and sends reminders',
         'Processes your guests'' data for you under the data processing agreement'],
   ARRAY['Is the seller of its services',
         'Customer service, its terms and privacy notice, its own accounts'],
   ARRAY['An active (verified) company', 'Customer service email and phone', 'Your terms and privacy notice (web addresses)',
         'The data processing agreement, accepted by an owner'],
   70, ARRAY['restaurant_reservations', 'sales_invoicing'], ARRAY['hospitality']),
  ('hotel', 'Hotel: room booking', 'company',
   'Guests book a room type for their dates; you check them in and out and invoice the stay in your own name.',
   'Hotels, guesthouses, B&Bs, cabins and other accommodation.',
   4900::numeric, 1490::numeric, false,
   ARRAY['Online booking of your room types for a date range',
         'Rooms, closed rooms and dates; no night sold twice',
         'Phone bookings, check-in (also to another room), check-out and no-shows',
         'Your cancellation rule: free until a number of days before arrival, then a fee',
         'Invoice of the stay or the fee in your name, card or bank payment',
         'Email reminders the day before arrival',
         'A website from the template library'],
   ARRAY['Runs the booking and invoicing system and sends reminders',
         'Processes your guests'' data for you under the data processing agreement'],
   ARRAY['Is the seller of its accommodation',
         'Its guest register and other duties as an accommodation business',
         'Customer service, its terms and privacy notice, its own accounts'],
   ARRAY['An active (verified) company', 'Customer service email and phone', 'Your terms and privacy notice (web addresses)',
         'The data processing agreement, accepted by an owner'],
   80, ARRAY['hotel_reservations', 'sales_invoicing'], ARRAY['hospitality'])
) AS v(code, name, seller_model, summary, for_whom, setup_fee, monthly_fee, own_domain, features, flyttgo_does,
       company_does, requirements, sort, modules, industries)
WHERE NOT EXISTS (SELECT 1 FROM public.white_label_plans p WHERE p.code = v.code);


-- ── 2. Restaurant tables ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.restaurant_settings (
  organization_id      uuid        PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  slot_step_minutes    integer     NOT NULL DEFAULT 15 CHECK (slot_step_minutes IN (10, 15, 20, 30, 60)),
  booking_window_days  integer     NOT NULL DEFAULT 60 CHECK (booking_window_days BETWEEN 1 AND 365),
  lead_time_minutes    integer     NOT NULL DEFAULT 60 CHECK (lead_time_minutes BETWEEN 0 AND 10080),
  max_party_online     integer     NOT NULL DEFAULT 8 CHECK (max_party_online BETWEEN 1 AND 100),  -- larger parties call
  default_turn_minutes integer     NOT NULL DEFAULT 120 CHECK (default_turn_minutes BETWEEN 15 AND 480),
  cancel_hours         integer     NOT NULL DEFAULT 2 CHECK (cancel_hours BETWEEN 0 AND 168),
  no_show_fee          numeric     CHECK (no_show_fee IS NULL OR no_show_fee > 0),               -- incl. MVA
  no_show_fee_per      text        NOT NULL DEFAULT 'guest' CHECK (no_show_fee_per IN ('guest', 'booking')),
  no_show_vat_rate     numeric     CHECK (no_show_vat_rate IS NULL OR no_show_vat_rate IN (0, 12, 15, 25)),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_settings_fee_vat CHECK (no_show_fee IS NULL OR no_show_vat_rate IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.restaurant_tables (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  area            text,                                          -- e.g. window, terrace
  seats           integer     NOT NULL CHECK (seats BETWEEN 1 AND 50),
  min_seats       integer     NOT NULL DEFAULT 1,                -- the smallest party given this table online
  combinable      boolean     NOT NULL DEFAULT false,
  active          boolean     NOT NULL DEFAULT true,
  sort            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  CONSTRAINT restaurant_tables_seats CHECK (min_seats BETWEEN 1 AND seats)
);

-- The combinations the company allows (tables pushed together), of
-- combinable tables only.
CREATE TABLE IF NOT EXISTS public.restaurant_table_groups (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  min_seats       integer     NOT NULL DEFAULT 1 CHECK (min_seats BETWEEN 1 AND 100),
  active          boolean     NOT NULL DEFAULT true,
  sort            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.restaurant_table_group_members (
  group_id uuid NOT NULL REFERENCES public.restaurant_table_groups (id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.restaurant_tables (id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, table_id)
);

-- Service periods per weekday (ISO: 1 Monday … 7 Sunday), in local time.
-- The last seating is when the last table is given; without one it is the
-- end minus the party's turn.
CREATE TABLE IF NOT EXISTS public.restaurant_service_periods (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid    NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  weekday         integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  name            text    NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  start_time      time    NOT NULL,
  end_time        time    NOT NULL,
  last_seating    time,
  CONSTRAINT restaurant_service_periods_order CHECK (end_time > start_time
    AND (last_seating IS NULL OR last_seating BETWEEN start_time AND end_time))
);
CREATE INDEX IF NOT EXISTS restaurant_service_periods_org_idx ON public.restaurant_service_periods (organization_id, weekday);

-- How long a table is kept, by party size: the first row whose up_to_party
-- covers the party; beyond the last row, the default turn.
CREATE TABLE IF NOT EXISTS public.restaurant_turn_times (
  organization_id uuid    NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  up_to_party     integer NOT NULL CHECK (up_to_party BETWEEN 1 AND 100),
  minutes         integer NOT NULL CHECK (minutes BETWEEN 15 AND 480),
  PRIMARY KEY (organization_id, up_to_party)
);

CREATE TABLE IF NOT EXISTS public.restaurant_closed_dates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  day             date        NOT NULL,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, day)
);

CREATE TABLE IF NOT EXISTS public.restaurant_reservations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  number           integer     NOT NULL,
  customer_user_id uuid,
  customer         jsonb       NOT NULL,                       -- name, phone, email
  party_size       integer     NOT NULL CHECK (party_size BETWEEN 1 AND 100),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,                       -- start + turn (earlier once completed)
  period           text,                                       -- the service period's name, when booked in one
  notes            text,                                       -- the guest's own words (e.g. allergies)
  source           text        NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'phone', 'walk_in')),
  status           text        NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'seated', 'completed', 'no_show', 'cancelled')),
  no_show_fee      numeric     CHECK (no_show_fee IS NULL OR no_show_fee > 0),   -- stated before the booking (incl. MVA)
  no_show_vat_rate numeric,
  seated_at        timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  cancelled_by     text        CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'company')),
  cancel_reason    text,
  reminded_at      timestamptz,
  invoice_id       uuid        REFERENCES public.invoices (id),
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  CONSTRAINT restaurant_reservations_order CHECK (ends_at > starts_at),
  CONSTRAINT restaurant_reservations_fee_vat CHECK (no_show_fee IS NULL OR no_show_vat_rate IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS restaurant_reservations_org_idx ON public.restaurant_reservations (organization_id, starts_at);
CREATE INDEX IF NOT EXISTS restaurant_reservations_customer_idx ON public.restaurant_reservations (customer_user_id) WHERE customer_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.restaurant_reservation_tables (
  reservation_id uuid NOT NULL REFERENCES public.restaurant_reservations (id) ON DELETE CASCADE,
  table_id       uuid NOT NULL REFERENCES public.restaurant_tables (id),
  PRIMARY KEY (reservation_id, table_id)
);
CREATE INDEX IF NOT EXISTS restaurant_reservation_tables_table_idx ON public.restaurant_reservation_tables (table_id);

CREATE TABLE IF NOT EXISTS public.restaurant_reservation_events (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id uuid        NOT NULL REFERENCES public.restaurant_reservations (id) ON DELETE CASCADE,
  actor_id       uuid,
  action         text        NOT NULL,
  details        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurant_reservation_events_idx ON public.restaurant_reservation_events (reservation_id, created_at);
DROP TRIGGER IF EXISTS guard_restaurant_reservation_events ON public.restaurant_reservation_events;
CREATE TRIGGER guard_restaurant_reservation_events BEFORE UPDATE OR DELETE ON public.restaurant_reservation_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();


-- ── 3. Hotel rooms ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hotel_settings (
  organization_id     uuid        PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  vat_rate            numeric     CHECK (vat_rate IS NULL OR vat_rate IN (0, 12, 15, 25)),  -- the company's rate for accommodation
  check_in_from       time        NOT NULL DEFAULT '15:00',
  check_out_by        time        NOT NULL DEFAULT '11:00',
  booking_window_days integer     NOT NULL DEFAULT 365 CHECK (booking_window_days BETWEEN 1 AND 730),
  lead_days           integer     NOT NULL DEFAULT 0 CHECK (lead_days BETWEEN 0 AND 60),
  min_nights          integer     NOT NULL DEFAULT 1 CHECK (min_nights BETWEEN 1 AND 60),
  max_nights          integer     NOT NULL DEFAULT 30 CHECK (max_nights BETWEEN 1 AND 365),
  free_cancel_days    integer     NOT NULL DEFAULT 1 CHECK (free_cancel_days BETWEEN 0 AND 90),
  late_cancel_fee_pct numeric     CHECK (late_cancel_fee_pct IS NULL OR late_cancel_fee_pct BETWEEN 1 AND 100),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_settings_nights CHECK (min_nights <= max_nights)
);

CREATE TABLE IF NOT EXISTS public.hotel_room_types (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  description     text,
  capacity        integer     NOT NULL CHECK (capacity BETWEEN 1 AND 20),
  nightly_price   numeric     NOT NULL CHECK (nightly_price >= 0),                       -- incl. MVA
  active          boolean     NOT NULL DEFAULT true,
  sort            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hotel_room_types_org_idx ON public.hotel_room_types (organization_id, sort);

CREATE TABLE IF NOT EXISTS public.hotel_rooms (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  room_type_id    uuid        NOT NULL REFERENCES public.hotel_room_types (id),
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),   -- e.g. 214
  active          boolean     NOT NULL DEFAULT true,
  sort            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS hotel_rooms_type_idx ON public.hotel_rooms (room_type_id);

-- A room closed for some nights (from_date up to, not including, to_date);
-- without a room, the whole hotel.
CREATE TABLE IF NOT EXISTS public.hotel_closures (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  room_id         uuid        REFERENCES public.hotel_rooms (id) ON DELETE CASCADE,
  from_date       date        NOT NULL,
  to_date         date        NOT NULL,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_closures_order CHECK (to_date > from_date)
);
CREATE INDEX IF NOT EXISTS hotel_closures_org_idx ON public.hotel_closures (organization_id, from_date);

CREATE TABLE IF NOT EXISTS public.hotel_stays (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  number           integer     NOT NULL,
  room_type_id     uuid        NOT NULL REFERENCES public.hotel_room_types (id),
  room_id          uuid        NOT NULL REFERENCES public.hotel_rooms (id),
  customer_user_id uuid,
  customer         jsonb       NOT NULL,                       -- name, phone, email
  guests           integer     NOT NULL CHECK (guests BETWEEN 1 AND 20),
  check_in         date        NOT NULL,
  check_out        date        NOT NULL,
  nights           integer     GENERATED ALWAYS AS (check_out - check_in) STORED,
  nightly_price    numeric     NOT NULL,                       -- incl. MVA, as booked
  total            numeric     NOT NULL,
  vat_rate         numeric     NOT NULL,
  free_cancel_until date,                                      -- the last day to cancel without a fee
  late_cancel_fee  numeric,                                    -- as stated before the booking (incl. MVA)
  cancel_fee       numeric,                                    -- charged on a late cancellation or no-show
  notes            text,
  status           text        NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'checked_in', 'checked_out', 'no_show', 'cancelled')),
  checked_in_at    timestamptz,
  checked_out_at   timestamptz,
  cancelled_at     timestamptz,
  cancelled_by     text        CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'company')),
  cancel_reason    text,
  reminded_at      timestamptz,
  invoice_id       uuid        REFERENCES public.invoices (id),
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  CONSTRAINT hotel_stays_order CHECK (check_out > check_in)
);
CREATE INDEX IF NOT EXISTS hotel_stays_room_idx ON public.hotel_stays (room_id, check_in) WHERE status IN ('booked', 'checked_in');
CREATE INDEX IF NOT EXISTS hotel_stays_org_idx ON public.hotel_stays (organization_id, check_in);
CREATE INDEX IF NOT EXISTS hotel_stays_customer_idx ON public.hotel_stays (customer_user_id) WHERE customer_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.hotel_stay_events (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stay_id    uuid        NOT NULL REFERENCES public.hotel_stays (id) ON DELETE CASCADE,
  actor_id   uuid,
  action     text        NOT NULL,
  details    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hotel_stay_events_idx ON public.hotel_stay_events (stay_id, created_at);
DROP TRIGGER IF EXISTS guard_hotel_stay_events ON public.hotel_stay_events;
CREATE TRIGGER guard_hotel_stay_events BEFORE UPDATE OR DELETE ON public.hotel_stay_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();


-- ── 4. Who reads what ───────────────────────────────────────────────────────
-- The guest, and the company's members (staff work the floor and the desk).
CREATE OR REPLACE FUNCTION public.can_read_restaurant_reservation(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.restaurant_reservations r
     WHERE r.id = p_id AND (r.customer_user_id = auth.uid()
        OR public.is_org_member(r.organization_id, ARRAY['owner', 'admin', 'booker', 'finance', 'viewer', 'staff'])));
$$;

CREATE OR REPLACE FUNCTION public.can_read_hotel_stay(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.hotel_stays s
     WHERE s.id = p_id AND (s.customer_user_id = auth.uid()
        OR public.is_org_member(s.organization_id, ARRAY['owner', 'admin', 'booker', 'finance', 'viewer', 'staff'])));
$$;

ALTER TABLE public.restaurant_settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_tables              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_table_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_table_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_service_periods     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_turn_times          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_closed_dates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_reservations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_reservation_tables  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_reservation_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_settings                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_room_types               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_rooms                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_closures                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_stays                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_stay_events              ENABLE ROW LEVEL SECURITY;

-- The public parts (rules, service periods, room types) for visitors; the
-- floor plan, rooms and closures for the company.
DROP POLICY IF EXISTS restaurant_settings_public ON public.restaurant_settings;
CREATE POLICY restaurant_settings_public ON public.restaurant_settings FOR SELECT TO anon
  USING (public.org_has_module(organization_id, 'restaurant_reservations'));
DROP POLICY IF EXISTS restaurant_settings_select ON public.restaurant_settings;
CREATE POLICY restaurant_settings_select ON public.restaurant_settings FOR SELECT TO authenticated
  USING (public.org_has_module(organization_id, 'restaurant_reservations') OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS restaurant_service_periods_public ON public.restaurant_service_periods;
CREATE POLICY restaurant_service_periods_public ON public.restaurant_service_periods FOR SELECT TO anon
  USING (public.org_has_module(organization_id, 'restaurant_reservations'));
DROP POLICY IF EXISTS restaurant_service_periods_select ON public.restaurant_service_periods;
CREATE POLICY restaurant_service_periods_select ON public.restaurant_service_periods FOR SELECT TO authenticated
  USING (public.org_has_module(organization_id, 'restaurant_reservations') OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS restaurant_tables_select ON public.restaurant_tables;
CREATE POLICY restaurant_tables_select ON public.restaurant_tables FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS restaurant_table_groups_select ON public.restaurant_table_groups;
CREATE POLICY restaurant_table_groups_select ON public.restaurant_table_groups FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS restaurant_table_group_members_select ON public.restaurant_table_group_members;
CREATE POLICY restaurant_table_group_members_select ON public.restaurant_table_group_members FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.restaurant_table_groups g WHERE g.id = group_id));
DROP POLICY IF EXISTS restaurant_turn_times_select ON public.restaurant_turn_times;
CREATE POLICY restaurant_turn_times_select ON public.restaurant_turn_times FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS restaurant_closed_dates_select ON public.restaurant_closed_dates;
CREATE POLICY restaurant_closed_dates_select ON public.restaurant_closed_dates FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS restaurant_reservations_select ON public.restaurant_reservations;
CREATE POLICY restaurant_reservations_select ON public.restaurant_reservations FOR SELECT TO authenticated
  USING (public.can_read_restaurant_reservation(id));
DROP POLICY IF EXISTS restaurant_reservation_tables_select ON public.restaurant_reservation_tables;
CREATE POLICY restaurant_reservation_tables_select ON public.restaurant_reservation_tables FOR SELECT TO authenticated
  USING (public.can_read_restaurant_reservation(reservation_id));
DROP POLICY IF EXISTS restaurant_reservation_events_select ON public.restaurant_reservation_events;
CREATE POLICY restaurant_reservation_events_select ON public.restaurant_reservation_events FOR SELECT TO authenticated
  USING (public.can_read_restaurant_reservation(reservation_id));

DROP POLICY IF EXISTS hotel_settings_public ON public.hotel_settings;
CREATE POLICY hotel_settings_public ON public.hotel_settings FOR SELECT TO anon
  USING (public.org_has_module(organization_id, 'hotel_reservations'));
DROP POLICY IF EXISTS hotel_settings_select ON public.hotel_settings;
CREATE POLICY hotel_settings_select ON public.hotel_settings FOR SELECT TO authenticated
  USING (public.org_has_module(organization_id, 'hotel_reservations') OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS hotel_room_types_public ON public.hotel_room_types;
CREATE POLICY hotel_room_types_public ON public.hotel_room_types FOR SELECT TO anon
  USING (active AND public.org_has_module(organization_id, 'hotel_reservations'));
DROP POLICY IF EXISTS hotel_room_types_select ON public.hotel_room_types;
CREATE POLICY hotel_room_types_select ON public.hotel_room_types FOR SELECT TO authenticated
  USING ((active AND public.org_has_module(organization_id, 'hotel_reservations')) OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS hotel_rooms_select ON public.hotel_rooms;
CREATE POLICY hotel_rooms_select ON public.hotel_rooms FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS hotel_closures_select ON public.hotel_closures;
CREATE POLICY hotel_closures_select ON public.hotel_closures FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS hotel_stays_select ON public.hotel_stays;
CREATE POLICY hotel_stays_select ON public.hotel_stays FOR SELECT TO authenticated USING (public.can_read_hotel_stay(id));
DROP POLICY IF EXISTS hotel_stay_events_select ON public.hotel_stay_events;
CREATE POLICY hotel_stay_events_select ON public.hotel_stay_events FOR SELECT TO authenticated
  USING (public.can_read_hotel_stay(stay_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.restaurant_settings, public.restaurant_tables, public.restaurant_table_groups,
  public.restaurant_table_group_members, public.restaurant_service_periods, public.restaurant_turn_times,
  public.restaurant_closed_dates, public.restaurant_reservations, public.restaurant_reservation_tables,
  public.restaurant_reservation_events, public.hotel_settings, public.hotel_room_types, public.hotel_rooms,
  public.hotel_closures, public.hotel_stays, public.hotel_stay_events FROM anon, authenticated;
REVOKE ALL ON public.restaurant_tables, public.restaurant_table_groups, public.restaurant_table_group_members,
  public.restaurant_turn_times, public.restaurant_closed_dates, public.restaurant_reservations,
  public.restaurant_reservation_tables, public.restaurant_reservation_events, public.hotel_rooms,
  public.hotel_closures, public.hotel_stays, public.hotel_stay_events FROM anon;


-- ── 5. The restaurant's set-up ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restaurant_event(p_id uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.restaurant_reservation_events (reservation_id, actor_id, action, details)
  VALUES (p_id, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

-- Rules, and the turn times by party size [{up_to_party, minutes}].
CREATE OR REPLACE FUNCTION public.save_restaurant_settings(p_org uuid, p jsonb)
RETURNS public.restaurant_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.restaurant_settings%ROWTYPE; t jsonb;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  INSERT INTO public.restaurant_settings AS x (organization_id, slot_step_minutes, booking_window_days, lead_time_minutes,
                                               max_party_online, default_turn_minutes, cancel_hours, no_show_fee,
                                               no_show_fee_per, no_show_vat_rate)
  VALUES (p_org, coalesce((p ->> 'slot_step_minutes')::int, 15), coalesce((p ->> 'booking_window_days')::int, 60),
          coalesce((p ->> 'lead_time_minutes')::int, 60), coalesce((p ->> 'max_party_online')::int, 8),
          coalesce((p ->> 'default_turn_minutes')::int, 120), coalesce((p ->> 'cancel_hours')::int, 2),
          nullif(p ->> 'no_show_fee', '')::numeric, coalesce(nullif(p ->> 'no_show_fee_per', ''), 'guest'),
          nullif(p ->> 'no_show_vat_rate', '')::numeric)
  ON CONFLICT (organization_id) DO UPDATE SET slot_step_minutes = EXCLUDED.slot_step_minutes,
    booking_window_days = EXCLUDED.booking_window_days, lead_time_minutes = EXCLUDED.lead_time_minutes,
    max_party_online = EXCLUDED.max_party_online, default_turn_minutes = EXCLUDED.default_turn_minutes,
    cancel_hours = EXCLUDED.cancel_hours, no_show_fee = EXCLUDED.no_show_fee, no_show_fee_per = EXCLUDED.no_show_fee_per,
    no_show_vat_rate = EXCLUDED.no_show_vat_rate, updated_at = now()
  RETURNING * INTO s;
  IF p ? 'turn_times' THEN
    DELETE FROM public.restaurant_turn_times WHERE organization_id = p_org;
    FOR t IN SELECT * FROM jsonb_array_elements(p -> 'turn_times') LOOP
      INSERT INTO public.restaurant_turn_times (organization_id, up_to_party, minutes)
      VALUES (p_org, (t ->> 'up_to_party')::int, (t ->> 'minutes')::int);
    END LOOP;
  END IF;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.save_restaurant_table(p_org uuid, p_id uuid, p jsonb)
RETURNS public.restaurant_tables
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE t public.restaurant_tables%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  IF p_id IS NULL THEN
    INSERT INTO public.restaurant_tables (organization_id, name, area, seats, min_seats, combinable, active, sort)
    VALUES (p_org, btrim(p ->> 'name'), nullif(btrim(coalesce(p ->> 'area', '')), ''), (p ->> 'seats')::int,
            coalesce((p ->> 'min_seats')::int, 1), coalesce((p ->> 'combinable')::boolean, false),
            coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort')::int, 0))
    RETURNING * INTO t;
  ELSE
    UPDATE public.restaurant_tables SET name = btrim(p ->> 'name'), area = nullif(btrim(coalesce(p ->> 'area', '')), ''),
           seats = (p ->> 'seats')::int, min_seats = coalesce((p ->> 'min_seats')::int, 1),
           combinable = coalesce((p ->> 'combinable')::boolean, false), active = coalesce((p ->> 'active')::boolean, true),
           sort = coalesce((p ->> 'sort')::int, 0)
     WHERE id = p_id AND organization_id = p_org RETURNING * INTO t;
    IF NOT FOUND THEN RAISE EXCEPTION 'restaurant: no such table' USING ERRCODE = 'P0002'; END IF;
    IF NOT t.combinable AND EXISTS (SELECT 1 FROM public.restaurant_table_group_members WHERE table_id = t.id) THEN
      RAISE EXCEPTION 'restaurant: the table is in a combination; remove it there first' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN t;
END $$;

-- A combination of two or more combinable tables {name, min_seats, table_ids, active}.
CREATE OR REPLACE FUNCTION public.save_restaurant_table_group(p_org uuid, p_id uuid, p jsonb)
RETURNS public.restaurant_table_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE g public.restaurant_table_groups%ROWTYPE; v_ids uuid[];
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  SELECT array_agg(DISTINCT x::uuid) INTO v_ids FROM jsonb_array_elements_text(coalesce(p -> 'table_ids', '[]'::jsonb)) x;
  IF coalesce(cardinality(v_ids), 0) < 2 THEN
    RAISE EXCEPTION 'restaurant: a combination has at least two tables' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.restaurant_tables WHERE id = ANY (v_ids) AND organization_id = p_org AND combinable) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'restaurant: only the company''s combinable tables can be combined' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.restaurant_table_groups (organization_id, name, min_seats, active, sort)
    VALUES (p_org, btrim(p ->> 'name'), coalesce((p ->> 'min_seats')::int, 1), coalesce((p ->> 'active')::boolean, true),
            coalesce((p ->> 'sort')::int, 0))
    RETURNING * INTO g;
  ELSE
    UPDATE public.restaurant_table_groups SET name = btrim(p ->> 'name'), min_seats = coalesce((p ->> 'min_seats')::int, 1),
           active = coalesce((p ->> 'active')::boolean, true), sort = coalesce((p ->> 'sort')::int, 0)
     WHERE id = p_id AND organization_id = p_org RETURNING * INTO g;
    IF NOT FOUND THEN RAISE EXCEPTION 'restaurant: no such combination' USING ERRCODE = 'P0002'; END IF;
    DELETE FROM public.restaurant_table_group_members WHERE group_id = g.id;
  END IF;
  INSERT INTO public.restaurant_table_group_members (group_id, table_id) SELECT g.id, unnest(v_ids);
  RETURN g;
END $$;

-- The week's service periods [{weekday, name, start, end, last_seating}],
-- replacing the earlier ones.
CREATE OR REPLACE FUNCTION public.save_restaurant_periods(p_org uuid, p_periods jsonb)
RETURNS SETOF public.restaurant_service_periods
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE h jsonb;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  DELETE FROM public.restaurant_service_periods WHERE organization_id = p_org;
  FOR h IN SELECT * FROM jsonb_array_elements(coalesce(p_periods, '[]'::jsonb)) LOOP
    INSERT INTO public.restaurant_service_periods (organization_id, weekday, name, start_time, end_time, last_seating)
    VALUES (p_org, (h ->> 'weekday')::int, btrim(coalesce(h ->> 'name', 'Open')), (h ->> 'start')::time, (h ->> 'end')::time,
            nullif(h ->> 'last_seating', '')::time);
  END LOOP;
  RETURN QUERY SELECT * FROM public.restaurant_service_periods WHERE organization_id = p_org ORDER BY weekday, start_time;
END $$;

CREATE OR REPLACE FUNCTION public.add_restaurant_closed_date(p_org uuid, p_day date, p_reason text)
RETURNS public.restaurant_closed_dates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE c public.restaurant_closed_dates%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'booker']);
  INSERT INTO public.restaurant_closed_dates (organization_id, day, reason)
  VALUES (p_org, p_day, nullif(btrim(coalesce(p_reason, '')), ''))
  ON CONFLICT (organization_id, day) DO UPDATE SET reason = EXCLUDED.reason
  RETURNING * INTO c;
  RETURN c;
END $$;

CREATE OR REPLACE FUNCTION public.remove_restaurant_closed_date(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.restaurant_closed_dates WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant: no such closed date' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.require_org_role(v_org, ARRAY['owner', 'admin', 'booker']);
  DELETE FROM public.restaurant_closed_dates WHERE id = p_id;
END $$;


-- ── 6. Free tables and times ────────────────────────────────────────────────
-- How long a party keeps its table.
CREATE OR REPLACE FUNCTION public.restaurant_turn_minutes(p_org uuid, p_party integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT minutes FROM public.restaurant_turn_times WHERE organization_id = p_org AND up_to_party >= p_party ORDER BY up_to_party LIMIT 1),
    (SELECT default_turn_minutes FROM public.restaurant_settings WHERE organization_id = p_org),
    120);
$$;

-- Whether any of the tables is held by another reservation in the time.
-- A no-show or cancelled reservation frees its tables; a completed one
-- holds them until it was completed.
CREATE OR REPLACE FUNCTION public.restaurant_tables_taken(p_tables uuid[], p_start timestamptz, p_end timestamptz, p_exclude uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_reservation_tables rt
      JOIN public.restaurant_reservations r ON r.id = rt.reservation_id
     WHERE rt.table_id = ANY (p_tables) AND r.status IN ('booked', 'seated', 'completed')
       AND r.id IS DISTINCT FROM p_exclude
       AND tstzrange(r.starts_at, r.ends_at) && tstzrange(p_start, p_end));
$$;

-- The best free fit for a party from p_start to p_end: the smallest table
-- that seats it, else the smallest allowed combination; NULL when none.
-- p_exclude: a reservation being moved (its own tables count as free).
CREATE OR REPLACE FUNCTION public.restaurant_fit(p_org uuid, p_start timestamptz, p_end timestamptz, p_party integer, p_exclude uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH cand AS (
    SELECT ARRAY[t.id] AS tables, t.seats, 0 AS kind, t.sort
      FROM public.restaurant_tables t
     WHERE t.organization_id = p_org AND t.active AND p_party BETWEEN t.min_seats AND t.seats
    UNION ALL
    SELECT array_agg(t.id ORDER BY t.id), sum(t.seats)::int, 1, g.sort
      FROM public.restaurant_table_groups g
      JOIN public.restaurant_table_group_members m ON m.group_id = g.id
      JOIN public.restaurant_tables t ON t.id = m.table_id
     WHERE g.organization_id = p_org AND g.active AND g.min_seats <= p_party
     GROUP BY g.id, g.sort
    HAVING bool_and(t.active AND t.combinable) AND sum(t.seats) >= p_party
  )
  SELECT c.tables FROM cand c
   WHERE NOT public.restaurant_tables_taken(c.tables, p_start, p_end, p_exclude)
   ORDER BY c.seats, c.kind, c.sort
   LIMIT 1;
$$;

-- Free starting times on a day (Europe/Oslo) for a party: in the day's
-- service periods (stepped in local time, so a DST day keeps its clock
-- times), not on a closed date, within the booking window and after the
-- lead time, where a fitting table is free for the whole turn. Parties
-- above the online maximum are asked to call.
CREATE OR REPLACE FUNCTION public.available_restaurant_times(p_org uuid, p_day date, p_party integer)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz, period text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  cfg     public.restaurant_settings%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Europe/Oslo')::date;
  v_turn  integer;
BEGIN
  IF NOT public.org_has_module(p_org, 'restaurant_reservations') OR p_party IS NULL OR p_party < 1 THEN RETURN; END IF;
  SELECT * INTO cfg FROM public.restaurant_settings WHERE organization_id = p_org;
  IF NOT FOUND OR p_party > cfg.max_party_online THEN RETURN; END IF;
  IF p_day < v_today OR p_day > v_today + cfg.booking_window_days THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.restaurant_closed_dates WHERE organization_id = p_org AND day = p_day) THEN RETURN; END IF;
  v_turn := public.restaurant_turn_minutes(p_org, p_party);
  RETURN QUERY
  SELECT x.s, x.s + make_interval(mins => v_turn), x.name
    FROM (SELECT (local.t AT TIME ZONE 'Europe/Oslo') AS s, p.name, p.start_time
            FROM public.restaurant_service_periods p
           CROSS JOIN LATERAL generate_series(
             p_day + p.start_time,
             CASE WHEN p.last_seating IS NOT NULL THEN p_day + p.last_seating
                  ELSE (p_day + p.end_time) - make_interval(mins => v_turn) END,
             make_interval(mins => cfg.slot_step_minutes)) AS local(t)
           WHERE p.organization_id = p_org AND p.weekday = extract(isodow FROM p_day)::int) x
   WHERE x.s >= now() + make_interval(mins => cfg.lead_time_minutes)
     AND public.restaurant_fit(p_org, x.s, x.s + make_interval(mins => v_turn), p_party, NULL) IS NOT NULL
   ORDER BY x.s;
END $$;


-- ── 7. Table reservations ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restaurant_reservation_insert(
  p_org uuid, p_start timestamptz, p_party integer, p_customer_user uuid, p_contact jsonb, p_notes text,
  p_source text, p_tables uuid[], p_check boolean)
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  cfg      public.restaurant_settings%ROWTYPE;
  r        public.restaurant_reservations%ROWTYPE;
  v_turn   integer;
  v_end    timestamptz;
  v_tables uuid[];
  v_period text;
  v_no     integer;
BEGIN
  SELECT * INTO cfg FROM public.restaurant_settings WHERE organization_id = p_org;
  IF NOT FOUND OR NOT public.org_has_module(p_org, 'restaurant_reservations') THEN
    RAISE EXCEPTION 'restaurant: this restaurant does not take reservations' USING ERRCODE = '55000';
  END IF;
  IF coalesce(btrim(p_contact ->> 'name'), '') = '' OR (p_source <> 'walk_in' AND coalesce(btrim(p_contact ->> 'phone'), '') = '') THEN
    RAISE EXCEPTION 'restaurant: a name and a phone number are required' USING ERRCODE = '22023';
  END IF;
  IF p_party IS NULL OR p_party NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'restaurant: the party is 1 to 100 guests' USING ERRCODE = '22023';
  END IF;
  v_turn := public.restaurant_turn_minutes(p_org, p_party);
  v_end := p_start + make_interval(mins => v_turn);
  IF p_check THEN
    SELECT a.period INTO v_period FROM public.available_restaurant_times(p_org, (p_start AT TIME ZONE 'Europe/Oslo')::date, p_party) a
     WHERE a.starts_at = p_start;
    IF NOT FOUND THEN RAISE EXCEPTION 'restaurant: that time is not available' USING ERRCODE = '55000'; END IF;
  END IF;
  -- One lock per restaurant: a reservation may take several tables, so the
  -- whole floor is the resource. Two people never get the same table.
  PERFORM pg_advisory_xact_lock(hashtext('restaurant:' || p_org::text));
  IF p_tables IS NOT NULL AND cardinality(p_tables) > 0 THEN
    SELECT array_agg(DISTINCT t ORDER BY t) INTO v_tables FROM unnest(p_tables) t;
    IF (SELECT count(*) FROM public.restaurant_tables WHERE id = ANY (v_tables) AND organization_id = p_org AND active) <> cardinality(v_tables) THEN
      RAISE EXCEPTION 'restaurant: no such table' USING ERRCODE = '22023';
    END IF;
    IF public.restaurant_tables_taken(v_tables, p_start, v_end, NULL) THEN
      RAISE EXCEPTION 'restaurant: that table is taken at that time' USING ERRCODE = '55000';
    END IF;
  ELSE
    v_tables := public.restaurant_fit(p_org, p_start, v_end, p_party, NULL);
    IF v_tables IS NULL THEN RAISE EXCEPTION 'restaurant: no table for % is free at that time', p_party USING ERRCODE = '55000'; END IF;
  END IF;
  SELECT coalesce(max(number), 0) + 1 INTO v_no FROM public.restaurant_reservations WHERE organization_id = p_org;
  INSERT INTO public.restaurant_reservations (organization_id, number, customer_user_id, customer, party_size, starts_at, ends_at,
                                              period, notes, source, status, seated_at, no_show_fee, no_show_vat_rate, created_by)
  VALUES (p_org, v_no, p_customer_user,
          jsonb_build_object('name', btrim(p_contact ->> 'name'), 'phone', nullif(btrim(coalesce(p_contact ->> 'phone', '')), ''),
                             'email', lower(nullif(btrim(coalesce(p_contact ->> 'email', '')), ''))),
          p_party, p_start, v_end, v_period, nullif(btrim(coalesce(p_notes, '')), ''), p_source,
          CASE WHEN p_source = 'walk_in' THEN 'seated' ELSE 'booked' END,
          CASE WHEN p_source = 'walk_in' THEN now() END,
          -- The fee the company stated before this booking, if any.
          CASE WHEN p_source <> 'walk_in' AND cfg.no_show_fee IS NOT NULL
               THEN cfg.no_show_fee * CASE WHEN cfg.no_show_fee_per = 'guest' THEN p_party ELSE 1 END END,
          CASE WHEN p_source <> 'walk_in' AND cfg.no_show_fee IS NOT NULL THEN cfg.no_show_vat_rate END,
          auth.uid())
  RETURNING * INTO r;
  INSERT INTO public.restaurant_reservation_tables (reservation_id, table_id) SELECT r.id, unnest(v_tables);
  PERFORM public.restaurant_event(r.id, 'reservation.booked',
    jsonb_build_object('source', p_source, 'party', p_party, 'start', p_start, 'tables', to_jsonb(v_tables)));
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.restaurant_reservation_insert(uuid, timestamptz, integer, uuid, jsonb, text, text, uuid[], boolean)
  FROM PUBLIC, anon, authenticated;

-- A signed-in guest books an offered time.
CREATE OR REPLACE FUNCTION public.book_restaurant_table(p_org uuid, p_start timestamptz, p_party integer, p_contact jsonb, p_notes text)
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'restaurant: sign in to book' USING ERRCODE = '42501'; END IF;
  RETURN public.restaurant_reservation_insert(p_org, p_start, p_party, auth.uid(), p_contact, p_notes, 'online', NULL, true);
END $$;

-- The company books a phone guest or seats a walk-in (p_start NULL: now).
-- It may book outside the periods, larger parties and named tables, never
-- over another reservation.
CREATE OR REPLACE FUNCTION public.create_restaurant_reservation(p_org uuid, p_start timestamptz, p_party integer, p_contact jsonb,
                                                                p_notes text, p_source text, p_tables uuid[])
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'booker', 'staff']);
  IF coalesce(p_source, '') NOT IN ('phone', 'walk_in') THEN
    RAISE EXCEPTION 'restaurant: phone or walk_in' USING ERRCODE = '22023';
  END IF;
  RETURN public.restaurant_reservation_insert(p_org, coalesce(p_start, date_trunc('minute', now())), p_party, NULL, p_contact,
                                              p_notes, p_source, p_tables, false);
END $$;

-- The reservation, locked, for the company's members with the roles.
CREATE OR REPLACE FUNCTION public.restaurant_reservation_for(p_id uuid, p_roles text[])
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.restaurant_reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.restaurant_reservations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant: no such reservation' USING ERRCODE = 'P0002'; END IF;
  IF public.is_server() OR public.is_org_member(r.organization_id, p_roles || ARRAY['owner', 'admin']) THEN RETURN r; END IF;
  RAISE EXCEPTION 'restaurant: requires role %', array_to_string(p_roles || ARRAY['owner', 'admin'], ' or ') USING ERRCODE = '42501';
END $$;

-- The guests arrive: seated, at the booked tables or others the company
-- chooses. The table is held from now if they come early (at most one turn
-- before the booked time), and for a whole turn from now if they come after
-- their turn has ended; the tables must be free for that time.
CREATE OR REPLACE FUNCTION public.seat_restaurant_reservation(p_id uuid, p_tables uuid[])
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.restaurant_reservations%ROWTYPE; v_tables uuid[]; v_start timestamptz; v_end timestamptz;
BEGIN
  r := public.restaurant_reservation_for(p_id, ARRAY['booker', 'staff']);
  IF r.status <> 'booked' THEN RAISE EXCEPTION 'restaurant: the reservation is %', r.status USING ERRCODE = '55000'; END IF;
  IF now() < r.starts_at - (r.ends_at - r.starts_at) THEN
    RAISE EXCEPTION 'restaurant: the reservation is not until %; seat the guests as a walk-in',
      to_char(r.starts_at AT TIME ZONE 'Europe/Oslo', 'DD.MM.YYYY HH24:MI') USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('restaurant:' || r.organization_id::text));
  v_start := least(r.starts_at, now());
  v_end := CASE WHEN now() >= r.ends_at THEN now() + (r.ends_at - r.starts_at) ELSE r.ends_at END;
  IF p_tables IS NOT NULL AND cardinality(p_tables) > 0 THEN
    SELECT array_agg(DISTINCT t ORDER BY t) INTO v_tables FROM unnest(p_tables) t;
    IF (SELECT count(*) FROM public.restaurant_tables WHERE id = ANY (v_tables) AND organization_id = r.organization_id AND active)
       <> cardinality(v_tables) THEN
      RAISE EXCEPTION 'restaurant: no such table' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT array_agg(table_id ORDER BY table_id) INTO v_tables FROM public.restaurant_reservation_tables WHERE reservation_id = r.id;
  END IF;
  IF public.restaurant_tables_taken(v_tables, greatest(v_start, now()), v_end, r.id) THEN
    RAISE EXCEPTION 'restaurant: that table is taken; choose another' USING ERRCODE = '55000';
  END IF;
  IF p_tables IS NOT NULL AND cardinality(p_tables) > 0 THEN
    DELETE FROM public.restaurant_reservation_tables WHERE reservation_id = r.id;
    INSERT INTO public.restaurant_reservation_tables (reservation_id, table_id) SELECT r.id, unnest(v_tables);
  END IF;
  UPDATE public.restaurant_reservations SET status = 'seated', seated_at = now(), starts_at = v_start, ends_at = v_end, updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.restaurant_event(p_id, 'reservation.seated', jsonb_build_object('tables', to_jsonb(v_tables)));
  RETURN r;
END $$;

-- Completed (the table is free from now), or the guests did not come
-- (after the booked time; the tables are freed).
CREATE OR REPLACE FUNCTION public.close_restaurant_reservation(p_id uuid, p_outcome text)
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.restaurant_reservations%ROWTYPE;
BEGIN
  r := public.restaurant_reservation_for(p_id, ARRAY['booker', 'staff']);
  IF p_outcome = 'completed' THEN
    IF r.status <> 'seated' THEN RAISE EXCEPTION 'restaurant: only seated guests are completed' USING ERRCODE = '55000'; END IF;
    UPDATE public.restaurant_reservations SET status = 'completed', completed_at = now(), updated_at = now(),
           ends_at = CASE WHEN now() > starts_at AND now() < ends_at THEN now() ELSE ends_at END
     WHERE id = p_id RETURNING * INTO r;
  ELSIF p_outcome = 'no_show' THEN
    IF r.status <> 'booked' THEN RAISE EXCEPTION 'restaurant: the reservation is %', r.status USING ERRCODE = '55000'; END IF;
    IF r.starts_at > now() THEN RAISE EXCEPTION 'restaurant: the reservation has not started yet' USING ERRCODE = '55000'; END IF;
    UPDATE public.restaurant_reservations SET status = 'no_show', updated_at = now() WHERE id = p_id RETURNING * INTO r;
  ELSE
    RAISE EXCEPTION 'restaurant: completed or no_show' USING ERRCODE = '22023';
  END IF;
  PERFORM public.restaurant_event(p_id, 'reservation.' || p_outcome, '{}'::jsonb);
  RETURN r;
END $$;

-- The guest cancels online up to the restaurant's notice; the company
-- while the reservation is booked.
CREATE OR REPLACE FUNCTION public.cancel_restaurant_reservation(p_id uuid, p_reason text)
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.restaurant_reservations%ROWTYPE; v_hours integer; v_by text;
BEGIN
  SELECT * INTO r FROM public.restaurant_reservations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant: no such reservation' USING ERRCODE = 'P0002'; END IF;
  IF r.customer_user_id = auth.uid() AND NOT public.is_org_member(r.organization_id, ARRAY['owner', 'admin', 'booker']) THEN
    v_by := 'customer';
    SELECT cancel_hours INTO v_hours FROM public.restaurant_settings WHERE organization_id = r.organization_id;
    v_hours := coalesce(v_hours, 2);
    IF r.status <> 'booked' OR r.starts_at < now() + make_interval(hours => v_hours) THEN
      RAISE EXCEPTION 'restaurant: it can be cancelled online up to % hours before; contact the restaurant', v_hours USING ERRCODE = '55000';
    END IF;
  ELSE
    r := public.restaurant_reservation_for(p_id, ARRAY['booker']);
    v_by := 'company';
    IF r.status <> 'booked' THEN RAISE EXCEPTION 'restaurant: the reservation is %', r.status USING ERRCODE = '55000'; END IF;
  END IF;
  UPDATE public.restaurant_reservations SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_by,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.restaurant_event(p_id, 'reservation.cancelled', jsonb_build_object('by', v_by, 'reason', p_reason));
  RETURN r;
END $$;

-- The no-show fee, in the company's name: only the fee stated before the
-- booking (copied onto it), once.
CREATE OR REPLACE FUNCTION public.invoice_restaurant_no_show(p_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.restaurant_reservations%ROWTYPE; v_inv public.invoices%ROWTYPE;
BEGIN
  r := public.restaurant_reservation_for(p_id, ARRAY['finance']);
  IF r.invoice_id IS NOT NULL THEN RAISE EXCEPTION 'restaurant: already invoiced' USING ERRCODE = '55000'; END IF;
  IF r.status <> 'no_show' THEN RAISE EXCEPTION 'restaurant: only a no-show is invoiced here' USING ERRCODE = '55000'; END IF;
  IF coalesce(r.no_show_fee, 0) <= 0 THEN
    RAISE EXCEPTION 'restaurant: no no-show fee was stated before this booking' USING ERRCODE = '55000';
  END IF;
  v_inv := public.sales_invoice_draft(r.organization_id, r.customer, r.customer_user_id,
             jsonb_build_array(jsonb_build_object(
               'description', 'Table reservation not kept (no-show), ' || r.party_size || ' guests, '
                              || to_char(r.starts_at AT TIME ZONE 'Europe/Oslo', 'DD.MM.YYYY HH24:MI'),
               'quantity', 1, 'unit_price', round(r.no_show_fee / (1 + r.no_show_vat_rate / 100), 2), 'vat_rate', r.no_show_vat_rate)),
             'Reservation ' || r.number, NULL, 'restaurant_reservation', r.id);
  v_inv := public.issue_invoice(v_inv.id);
  UPDATE public.restaurant_reservations SET invoice_id = v_inv.id, updated_at = now() WHERE id = p_id;
  PERFORM public.restaurant_event(p_id, 'reservation.invoiced', jsonb_build_object('invoice', v_inv.number, 'total', v_inv.total));
  RETURN v_inv;
END $$;

-- Reminders: tables in the next 20–28 hours not yet reminded (the server
-- sends them and marks each, once).
CREATE OR REPLACE FUNCTION public.restaurant_reservations_to_remind()
RETURNS SETOF public.restaurant_reservations
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'restaurant: the server only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT * FROM public.restaurant_reservations
   WHERE status = 'booked' AND reminded_at IS NULL AND customer ->> 'email' IS NOT NULL
     AND starts_at BETWEEN now() + interval '20 hours' AND now() + interval '28 hours';
END $$;

CREATE OR REPLACE FUNCTION public.mark_restaurant_reservation_reminded(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'restaurant: the server only' USING ERRCODE = '42501'; END IF;
  UPDATE public.restaurant_reservations SET reminded_at = now() WHERE id = p_id AND reminded_at IS NULL;
END $$;


-- ── 8. The hotel's set-up ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hotel_event(p_id uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.hotel_stay_events (stay_id, actor_id, action, details)
  VALUES (p_id, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.save_hotel_settings(p_org uuid, p jsonb)
RETURNS public.hotel_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_settings%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  INSERT INTO public.hotel_settings AS x (organization_id, vat_rate, check_in_from, check_out_by, booking_window_days, lead_days,
                                          min_nights, max_nights, free_cancel_days, late_cancel_fee_pct)
  VALUES (p_org, nullif(p ->> 'vat_rate', '')::numeric, coalesce(nullif(p ->> 'check_in_from', '')::time, '15:00'),
          coalesce(nullif(p ->> 'check_out_by', '')::time, '11:00'), coalesce((p ->> 'booking_window_days')::int, 365),
          coalesce((p ->> 'lead_days')::int, 0), coalesce((p ->> 'min_nights')::int, 1), coalesce((p ->> 'max_nights')::int, 30),
          coalesce((p ->> 'free_cancel_days')::int, 1), nullif(p ->> 'late_cancel_fee_pct', '')::numeric)
  ON CONFLICT (organization_id) DO UPDATE SET vat_rate = EXCLUDED.vat_rate, check_in_from = EXCLUDED.check_in_from,
    check_out_by = EXCLUDED.check_out_by, booking_window_days = EXCLUDED.booking_window_days, lead_days = EXCLUDED.lead_days,
    min_nights = EXCLUDED.min_nights, max_nights = EXCLUDED.max_nights, free_cancel_days = EXCLUDED.free_cancel_days,
    late_cancel_fee_pct = EXCLUDED.late_cancel_fee_pct, updated_at = now()
  RETURNING * INTO s;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.save_hotel_room_type(p_org uuid, p_id uuid, p jsonb)
RETURNS public.hotel_room_types
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE t public.hotel_room_types%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  IF p_id IS NULL THEN
    INSERT INTO public.hotel_room_types (organization_id, name, description, capacity, nightly_price, active, sort)
    VALUES (p_org, btrim(p ->> 'name'), p ->> 'description', (p ->> 'capacity')::int, (p ->> 'nightly_price')::numeric,
            coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort')::int, 0))
    RETURNING * INTO t;
  ELSE
    UPDATE public.hotel_room_types SET name = btrim(p ->> 'name'), description = p ->> 'description',
           capacity = (p ->> 'capacity')::int, nightly_price = (p ->> 'nightly_price')::numeric,
           active = coalesce((p ->> 'active')::boolean, true), sort = coalesce((p ->> 'sort')::int, 0)
     WHERE id = p_id AND organization_id = p_org RETURNING * INTO t;
    IF NOT FOUND THEN RAISE EXCEPTION 'hotel: no such room type' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN t;
END $$;

-- A room {name, room_type_id, active, sort}. A room moves to another type
-- only while it has no stays to come.
CREATE OR REPLACE FUNCTION public.save_hotel_room(p_org uuid, p_id uuid, p jsonb)
RETURNS public.hotel_rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.hotel_rooms%ROWTYPE; v_type uuid := (p ->> 'room_type_id')::uuid;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  IF NOT EXISTS (SELECT 1 FROM public.hotel_room_types WHERE id = v_type AND organization_id = p_org) THEN
    RAISE EXCEPTION 'hotel: no such room type' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.hotel_rooms (organization_id, room_type_id, name, active, sort)
    VALUES (p_org, v_type, btrim(p ->> 'name'), coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort')::int, 0))
    RETURNING * INTO r;
  ELSE
    SELECT * INTO r FROM public.hotel_rooms WHERE id = p_id AND organization_id = p_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'hotel: no such room' USING ERRCODE = 'P0002'; END IF;
    IF r.room_type_id <> v_type AND EXISTS (SELECT 1 FROM public.hotel_stays WHERE room_id = p_id AND status IN ('booked', 'checked_in')) THEN
      RAISE EXCEPTION 'hotel: the room has stays to come; move them first' USING ERRCODE = '55000';
    END IF;
    UPDATE public.hotel_rooms SET room_type_id = v_type, name = btrim(p ->> 'name'), active = coalesce((p ->> 'active')::boolean, true),
           sort = coalesce((p ->> 'sort')::int, 0)
     WHERE id = p_id RETURNING * INTO r;
  END IF;
  RETURN r;
END $$;

-- Close a room (or, without one, the hotel) for nights from p_from up to,
-- not including, p_to. Stays already booked stay; the company moves them.
CREATE OR REPLACE FUNCTION public.add_hotel_closure(p_org uuid, p_room uuid, p_from date, p_to date, p_reason text)
RETURNS public.hotel_closures
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE c public.hotel_closures%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'booker']);
  IF p_room IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.hotel_rooms WHERE id = p_room AND organization_id = p_org) THEN
    RAISE EXCEPTION 'hotel: no such room' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.hotel_closures (organization_id, room_id, from_date, to_date, reason)
  VALUES (p_org, p_room, p_from, p_to, nullif(btrim(coalesce(p_reason, '')), ''))
  RETURNING * INTO c;
  RETURN c;
END $$;

CREATE OR REPLACE FUNCTION public.remove_hotel_closure(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.hotel_closures WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'hotel: no such closure' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.require_org_role(v_org, ARRAY['owner', 'admin', 'booker']);
  DELETE FROM public.hotel_closures WHERE id = p_id;
END $$;


-- ── 9. Free rooms ───────────────────────────────────────────────────────────
-- Whether a room is free every night from p_in up to p_out: active, not
-- closed (itself or the hotel), no other stay booked or in the house.
CREATE OR REPLACE FUNCTION public.hotel_room_free(p_room uuid, p_in date, p_out date, p_exclude uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.hotel_rooms r WHERE r.id = p_room AND r.active)
     AND NOT EXISTS (SELECT 1 FROM public.hotel_rooms r JOIN public.hotel_closures c ON c.organization_id = r.organization_id
                      WHERE r.id = p_room AND (c.room_id IS NULL OR c.room_id = r.id)
                        AND daterange(c.from_date, c.to_date) && daterange(p_in, p_out))
     AND NOT EXISTS (SELECT 1 FROM public.hotel_stays s
                      WHERE s.room_id = p_room AND s.status IN ('booked', 'checked_in') AND s.id IS DISTINCT FROM p_exclude
                        AND daterange(s.check_in, s.check_out) && daterange(p_in, p_out));
$$;

-- The room types free for the dates and number of guests, with the price
-- and how many rooms are left. Respects the window, lead time and nights.
CREATE OR REPLACE FUNCTION public.available_hotel_rooms(p_org uuid, p_check_in date, p_check_out date, p_guests integer)
RETURNS TABLE (room_type_id uuid, name text, description text, capacity integer, nightly_price numeric, nights integer,
               total numeric, rooms_free integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE cfg public.hotel_settings%ROWTYPE; v_today date := (now() AT TIME ZONE 'Europe/Oslo')::date; v_nights integer;
BEGIN
  IF NOT public.org_has_module(p_org, 'hotel_reservations') OR p_check_in IS NULL OR p_check_out IS NULL THEN RETURN; END IF;
  SELECT * INTO cfg FROM public.hotel_settings WHERE organization_id = p_org;
  IF NOT FOUND OR cfg.vat_rate IS NULL THEN RETURN; END IF;
  v_nights := p_check_out - p_check_in;
  IF v_nights < cfg.min_nights OR v_nights > cfg.max_nights THEN RETURN; END IF;
  IF p_check_in < v_today + cfg.lead_days OR p_check_in > v_today + cfg.booking_window_days THEN RETURN; END IF;
  RETURN QUERY
  SELECT t.id, t.name, t.description, t.capacity, t.nightly_price, v_nights, t.nightly_price * v_nights,
         (SELECT count(*)::int FROM public.hotel_rooms r WHERE r.room_type_id = t.id AND public.hotel_room_free(r.id, p_check_in, p_check_out, NULL))
    FROM public.hotel_room_types t
   WHERE t.organization_id = p_org AND t.active AND t.capacity >= coalesce(p_guests, 1)
     AND EXISTS (SELECT 1 FROM public.hotel_rooms r WHERE r.room_type_id = t.id AND public.hotel_room_free(r.id, p_check_in, p_check_out, NULL))
   ORDER BY t.sort, t.nightly_price;
END $$;


-- ── 10. Stays ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hotel_stay_insert(
  p_org uuid, p_type uuid, p_room uuid, p_in date, p_out date, p_guests integer, p_customer_user uuid,
  p_contact jsonb, p_notes text, p_check boolean)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  cfg    public.hotel_settings%ROWTYPE;
  t      public.hotel_room_types%ROWTYPE;
  s      public.hotel_stays%ROWTYPE;
  v_room uuid;
  v_no   integer;
  v_total numeric;
BEGIN
  SELECT * INTO cfg FROM public.hotel_settings WHERE organization_id = p_org;
  IF NOT FOUND OR NOT public.org_has_module(p_org, 'hotel_reservations') THEN
    RAISE EXCEPTION 'hotel: this hotel does not take bookings' USING ERRCODE = '55000';
  END IF;
  IF cfg.vat_rate IS NULL THEN
    RAISE EXCEPTION 'hotel: the hotel''s MVA rate for accommodation is not set' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO t FROM public.hotel_room_types WHERE id = p_type AND organization_id = p_org;
  IF NOT FOUND OR (p_check AND NOT t.active) THEN RAISE EXCEPTION 'hotel: this room type cannot be booked' USING ERRCODE = '55000'; END IF;
  IF coalesce(btrim(p_contact ->> 'name'), '') = '' OR coalesce(btrim(p_contact ->> 'phone'), '') = '' THEN
    RAISE EXCEPTION 'hotel: a name and a phone number are required' USING ERRCODE = '22023';
  END IF;
  IF p_in IS NULL OR p_out IS NULL OR p_out <= p_in THEN
    RAISE EXCEPTION 'hotel: check-out is after check-in' USING ERRCODE = '22023';
  END IF;
  IF p_guests IS NULL OR p_guests < 1 OR p_guests > t.capacity THEN
    RAISE EXCEPTION 'hotel: % takes up to % guests', t.name, t.capacity USING ERRCODE = '22023';
  END IF;
  IF p_check AND NOT EXISTS (SELECT 1 FROM public.available_hotel_rooms(p_org, p_in, p_out, p_guests) a WHERE a.room_type_id = p_type) THEN
    RAISE EXCEPTION 'hotel: no room of that type is free for those dates' USING ERRCODE = '55000';
  END IF;
  IF NOT p_check AND p_out < (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'hotel: the stay is in the past' USING ERRCODE = '22023';
  END IF;
  -- A lock per room type: a night is never sold twice.
  PERFORM pg_advisory_xact_lock(hashtext('hotel-type:' || p_type::text));
  IF p_room IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.hotel_rooms WHERE id = p_room AND room_type_id = p_type AND organization_id = p_org) THEN
      RAISE EXCEPTION 'hotel: the room is not of that type' USING ERRCODE = '22023';
    END IF;
    IF NOT public.hotel_room_free(p_room, p_in, p_out, NULL) THEN
      RAISE EXCEPTION 'hotel: that room is not free for those dates' USING ERRCODE = '55000';
    END IF;
    v_room := p_room;
  ELSE
    SELECT r.id INTO v_room FROM public.hotel_rooms r
     WHERE r.room_type_id = p_type AND public.hotel_room_free(r.id, p_in, p_out, NULL)
     ORDER BY r.sort, r.name LIMIT 1;
    IF v_room IS NULL THEN RAISE EXCEPTION 'hotel: no room of that type is free for those dates' USING ERRCODE = '55000'; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('hotel-no:' || p_org::text));
  SELECT coalesce(max(number), 0) + 1 INTO v_no FROM public.hotel_stays WHERE organization_id = p_org;
  v_total := t.nightly_price * (p_out - p_in);
  INSERT INTO public.hotel_stays (organization_id, number, room_type_id, room_id, customer_user_id, customer, guests, check_in, check_out,
                                  nightly_price, total, vat_rate, free_cancel_until, late_cancel_fee, notes, created_by)
  VALUES (p_org, v_no, p_type, v_room, p_customer_user,
          jsonb_build_object('name', btrim(p_contact ->> 'name'), 'phone', btrim(p_contact ->> 'phone'),
                             'email', lower(nullif(btrim(coalesce(p_contact ->> 'email', '')), ''))),
          p_guests, p_in, p_out, t.nightly_price, v_total, cfg.vat_rate,
          -- The cancellation rule the hotel stated before this booking.
          CASE WHEN cfg.late_cancel_fee_pct IS NOT NULL THEN p_in - cfg.free_cancel_days END,
          CASE WHEN cfg.late_cancel_fee_pct IS NOT NULL THEN round(v_total * cfg.late_cancel_fee_pct / 100, 2) END,
          nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  RETURNING * INTO s;
  PERFORM public.hotel_event(s.id, 'stay.booked', jsonb_build_object('room_type', t.name, 'check_in', p_in, 'check_out', p_out,
                                                                    'guests', p_guests, 'total', v_total));
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public.hotel_stay_insert(uuid, uuid, uuid, date, date, integer, uuid, jsonb, text, boolean)
  FROM PUBLIC, anon, authenticated;

-- A signed-in guest books a free room type for the dates.
CREATE OR REPLACE FUNCTION public.book_hotel_stay(p_org uuid, p_room_type uuid, p_check_in date, p_check_out date, p_guests integer,
                                                  p_contact jsonb, p_notes text)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'hotel: sign in to book' USING ERRCODE = '42501'; END IF;
  RETURN public.hotel_stay_insert(p_org, p_room_type, NULL, p_check_in, p_check_out, p_guests, auth.uid(), p_contact, p_notes, true);
END $$;

-- The company books a guest (phone, email, at the desk), optionally in a
-- named room; outside the window and lead time, never over another stay or
-- a closure.
CREATE OR REPLACE FUNCTION public.create_hotel_stay(p_org uuid, p_room_type uuid, p_room uuid, p_check_in date, p_check_out date,
                                                    p_guests integer, p_contact jsonb, p_notes text)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'booker', 'staff']);
  RETURN public.hotel_stay_insert(p_org, p_room_type, p_room, p_check_in, p_check_out, p_guests, NULL, p_contact, p_notes, false);
END $$;

CREATE OR REPLACE FUNCTION public.hotel_stay_for(p_id uuid, p_roles text[])
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_stays%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.hotel_stays WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'hotel: no such stay' USING ERRCODE = 'P0002'; END IF;
  IF public.is_server() OR public.is_org_member(s.organization_id, p_roles || ARRAY['owner', 'admin']) THEN RETURN s; END IF;
  RAISE EXCEPTION 'hotel: requires role %', array_to_string(p_roles || ARRAY['owner', 'admin'], ' or ') USING ERRCODE = '42501';
END $$;

-- The guest arrives (on or after the check-in date): checked in, in the
-- booked room or another free one (an upgrade keeps the booked price).
CREATE OR REPLACE FUNCTION public.check_in_hotel_stay(p_id uuid, p_room uuid)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_stays%ROWTYPE; r public.hotel_rooms%ROWTYPE; v_cap integer; v_today date := (now() AT TIME ZONE 'Europe/Oslo')::date;
BEGIN
  s := public.hotel_stay_for(p_id, ARRAY['booker', 'staff']);
  IF s.status <> 'booked' THEN RAISE EXCEPTION 'hotel: the stay is %', s.status USING ERRCODE = '55000'; END IF;
  IF v_today < s.check_in OR v_today >= s.check_out THEN
    RAISE EXCEPTION 'hotel: check-in is from % until the day before check-out', s.check_in USING ERRCODE = '55000';
  END IF;
  IF p_room IS NOT NULL AND p_room <> s.room_id THEN
    SELECT * INTO r FROM public.hotel_rooms WHERE id = p_room AND organization_id = s.organization_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'hotel: no such room' USING ERRCODE = '22023'; END IF;
    -- Both room types, in a fixed order.
    PERFORM pg_advisory_xact_lock(hashtext('hotel-type:' || x)) FROM unnest(ARRAY[s.room_type_id::text, r.room_type_id::text]) x
      GROUP BY x ORDER BY x;
    SELECT capacity INTO v_cap FROM public.hotel_room_types WHERE id = r.room_type_id;
    IF v_cap < s.guests THEN RAISE EXCEPTION 'hotel: that room takes up to % guests', v_cap USING ERRCODE = '22023'; END IF;
    IF NOT public.hotel_room_free(p_room, v_today, s.check_out, s.id) THEN
      RAISE EXCEPTION 'hotel: that room is not free for the stay' USING ERRCODE = '55000';
    END IF;
    UPDATE public.hotel_stays SET room_id = p_room, room_type_id = r.room_type_id WHERE id = p_id;
  END IF;
  UPDATE public.hotel_stays SET status = 'checked_in', checked_in_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO s;
  PERFORM public.hotel_event(p_id, 'stay.checked_in', jsonb_build_object('room', s.room_id));
  RETURN s;
END $$;

-- The guest leaves: the room is free from now.
CREATE OR REPLACE FUNCTION public.check_out_hotel_stay(p_id uuid)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_stays%ROWTYPE;
BEGIN
  s := public.hotel_stay_for(p_id, ARRAY['booker', 'staff']);
  IF s.status <> 'checked_in' THEN RAISE EXCEPTION 'hotel: the stay is %', s.status USING ERRCODE = '55000'; END IF;
  UPDATE public.hotel_stays SET status = 'checked_out', checked_out_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO s;
  PERFORM public.hotel_event(p_id, 'stay.checked_out', '{}'::jsonb);
  RETURN s;
END $$;

-- The guest did not arrive (from the check-in date): the late fee the hotel
-- stated before the booking applies, if any.
CREATE OR REPLACE FUNCTION public.mark_hotel_no_show(p_id uuid)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_stays%ROWTYPE;
BEGIN
  s := public.hotel_stay_for(p_id, ARRAY['booker']);
  IF s.status <> 'booked' THEN RAISE EXCEPTION 'hotel: the stay is %', s.status USING ERRCODE = '55000'; END IF;
  IF (now() AT TIME ZONE 'Europe/Oslo')::date < s.check_in THEN
    RAISE EXCEPTION 'hotel: the guest is not due yet' USING ERRCODE = '55000';
  END IF;
  UPDATE public.hotel_stays SET status = 'no_show', cancel_fee = late_cancel_fee, updated_at = now() WHERE id = p_id RETURNING * INTO s;
  PERFORM public.hotel_event(p_id, 'stay.no_show', jsonb_build_object('fee', s.cancel_fee));
  RETURN s;
END $$;

-- The guest cancels online until the check-in date: free until the last
-- free day, then the fee stated before the booking. The company cancels
-- while the stay is booked and charges that fee only when it chooses to
-- (p_charge_fee) and the cancellation is late.
CREATE OR REPLACE FUNCTION public.cancel_hotel_stay(p_id uuid, p_reason text, p_charge_fee boolean DEFAULT false)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_stays%ROWTYPE; v_by text; v_today date := (now() AT TIME ZONE 'Europe/Oslo')::date; v_late boolean; v_fee numeric;
BEGIN
  SELECT * INTO s FROM public.hotel_stays WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'hotel: no such stay' USING ERRCODE = 'P0002'; END IF;
  v_late := s.free_cancel_until IS NOT NULL AND v_today > s.free_cancel_until;
  IF s.customer_user_id = auth.uid() AND NOT public.is_org_member(s.organization_id, ARRAY['owner', 'admin', 'booker']) THEN
    v_by := 'customer';
    IF s.status <> 'booked' OR v_today >= s.check_in THEN
      RAISE EXCEPTION 'hotel: it can be cancelled online until the day before arrival; contact the hotel' USING ERRCODE = '55000';
    END IF;
    v_fee := CASE WHEN v_late THEN s.late_cancel_fee END;
  ELSE
    s := public.hotel_stay_for(p_id, ARRAY['booker']);
    v_by := 'company';
    IF s.status <> 'booked' THEN RAISE EXCEPTION 'hotel: the stay is %', s.status USING ERRCODE = '55000'; END IF;
    v_fee := CASE WHEN v_late AND coalesce(p_charge_fee, false) THEN s.late_cancel_fee END;
  END IF;
  UPDATE public.hotel_stays SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_by, cancel_fee = v_fee,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   WHERE id = p_id RETURNING * INTO s;
  PERFORM public.hotel_event(p_id, 'stay.cancelled', jsonb_build_object('by', v_by, 'reason', p_reason, 'fee', v_fee));
  RETURN s;
END $$;

-- The invoice in the company's name: the stay (checked in or out), or the
-- cancellation fee (late cancellation or no-show), once.
CREATE OR REPLACE FUNCTION public.invoice_hotel_stay(p_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_stays%ROWTYPE; v_type text; v_line jsonb; v_inv public.invoices%ROWTYPE; v_dates text;
BEGIN
  s := public.hotel_stay_for(p_id, ARRAY['finance']);
  IF s.invoice_id IS NOT NULL THEN RAISE EXCEPTION 'hotel: already invoiced' USING ERRCODE = '55000'; END IF;
  SELECT name INTO v_type FROM public.hotel_room_types WHERE id = s.room_type_id;
  v_dates := to_char(s.check_in, 'DD.MM.YYYY') || '–' || to_char(s.check_out, 'DD.MM.YYYY');
  IF s.status IN ('checked_in', 'checked_out') THEN
    v_line := jsonb_build_object('description', 'Accommodation, ' || v_type || ', ' || s.nights || ' night' || CASE WHEN s.nights = 1 THEN '' ELSE 's' END
                                                || ', ' || v_dates,
                                 'quantity', s.nights, 'unit_price', round(s.nightly_price / (1 + s.vat_rate / 100), 2), 'vat_rate', s.vat_rate);
  ELSIF s.status IN ('cancelled', 'no_show') AND coalesce(s.cancel_fee, 0) > 0 THEN
    v_line := jsonb_build_object('description', CASE WHEN s.status = 'no_show' THEN 'No-show' ELSE 'Late cancellation' END
                                                || ' fee, ' || v_type || ', ' || v_dates,
                                 'quantity', 1, 'unit_price', round(s.cancel_fee / (1 + s.vat_rate / 100), 2), 'vat_rate', s.vat_rate);
  ELSE
    RAISE EXCEPTION 'hotel: only a stay, or a cancellation with a fee, is invoiced' USING ERRCODE = '55000';
  END IF;
  v_inv := public.sales_invoice_draft(s.organization_id, s.customer, s.customer_user_id, jsonb_build_array(v_line),
                                      'Stay ' || s.number, NULL, 'hotel_stay', s.id);
  v_inv := public.issue_invoice(v_inv.id);
  UPDATE public.hotel_stays SET invoice_id = v_inv.id, updated_at = now() WHERE id = p_id;
  PERFORM public.hotel_event(p_id, 'stay.invoiced', jsonb_build_object('invoice', v_inv.number, 'total', v_inv.total));
  RETURN v_inv;
END $$;

-- Reminders: arrivals tomorrow (Europe/Oslo) not yet reminded.
CREATE OR REPLACE FUNCTION public.hotel_stays_to_remind()
RETURNS SETOF public.hotel_stays
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'hotel: the server only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT * FROM public.hotel_stays
   WHERE status = 'booked' AND reminded_at IS NULL AND customer ->> 'email' IS NOT NULL
     AND check_in = (now() AT TIME ZONE 'Europe/Oslo')::date + 1;
END $$;

CREATE OR REPLACE FUNCTION public.mark_hotel_stay_reminded(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'hotel: the server only' USING ERRCODE = '42501'; END IF;
  UPDATE public.hotel_stays SET reminded_at = now() WHERE id = p_id AND reminded_at IS NULL;
END $$;


-- ── 11. Who may call what ───────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.restaurant_event(uuid, text, jsonb), public.restaurant_reservation_for(uuid, text[]),
  public.restaurant_fit(uuid, timestamptz, timestamptz, integer, uuid),
  public.restaurant_tables_taken(uuid[], timestamptz, timestamptz, uuid), public.restaurant_turn_minutes(uuid, integer),
  public.hotel_event(uuid, text, jsonb), public.hotel_stay_for(uuid, text[]), public.hotel_room_free(uuid, date, date, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.can_read_restaurant_reservation(uuid), public.can_read_hotel_stay(uuid),
  public.save_restaurant_settings(uuid, jsonb), public.save_restaurant_table(uuid, uuid, jsonb),
  public.save_restaurant_table_group(uuid, uuid, jsonb), public.save_restaurant_periods(uuid, jsonb),
  public.add_restaurant_closed_date(uuid, date, text), public.remove_restaurant_closed_date(uuid),
  public.available_restaurant_times(uuid, date, integer),
  public.book_restaurant_table(uuid, timestamptz, integer, jsonb, text),
  public.create_restaurant_reservation(uuid, timestamptz, integer, jsonb, text, text, uuid[]),
  public.seat_restaurant_reservation(uuid, uuid[]), public.close_restaurant_reservation(uuid, text),
  public.cancel_restaurant_reservation(uuid, text), public.invoice_restaurant_no_show(uuid),
  public.restaurant_reservations_to_remind(), public.mark_restaurant_reservation_reminded(uuid),
  public.save_hotel_settings(uuid, jsonb), public.save_hotel_room_type(uuid, uuid, jsonb), public.save_hotel_room(uuid, uuid, jsonb),
  public.add_hotel_closure(uuid, uuid, date, date, text), public.remove_hotel_closure(uuid),
  public.available_hotel_rooms(uuid, date, date, integer),
  public.book_hotel_stay(uuid, uuid, date, date, integer, jsonb, text),
  public.create_hotel_stay(uuid, uuid, uuid, date, date, integer, jsonb, text),
  public.check_in_hotel_stay(uuid, uuid), public.check_out_hotel_stay(uuid), public.mark_hotel_no_show(uuid),
  public.cancel_hotel_stay(uuid, text, boolean), public.invoice_hotel_stay(uuid),
  public.hotel_stays_to_remind(), public.mark_hotel_stay_reminded(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.can_read_restaurant_reservation(uuid), public.can_read_hotel_stay(uuid),
  public.save_restaurant_settings(uuid, jsonb), public.save_restaurant_table(uuid, uuid, jsonb),
  public.save_restaurant_table_group(uuid, uuid, jsonb), public.save_restaurant_periods(uuid, jsonb),
  public.add_restaurant_closed_date(uuid, date, text), public.remove_restaurant_closed_date(uuid),
  public.available_restaurant_times(uuid, date, integer),
  public.book_restaurant_table(uuid, timestamptz, integer, jsonb, text),
  public.create_restaurant_reservation(uuid, timestamptz, integer, jsonb, text, text, uuid[]),
  public.seat_restaurant_reservation(uuid, uuid[]), public.close_restaurant_reservation(uuid, text),
  public.cancel_restaurant_reservation(uuid, text), public.invoice_restaurant_no_show(uuid),
  public.restaurant_reservations_to_remind(), public.mark_restaurant_reservation_reminded(uuid),
  public.save_hotel_settings(uuid, jsonb), public.save_hotel_room_type(uuid, uuid, jsonb), public.save_hotel_room(uuid, uuid, jsonb),
  public.add_hotel_closure(uuid, uuid, date, date, text), public.remove_hotel_closure(uuid),
  public.available_hotel_rooms(uuid, date, date, integer),
  public.book_hotel_stay(uuid, uuid, date, date, integer, jsonb, text),
  public.create_hotel_stay(uuid, uuid, uuid, date, date, integer, jsonb, text),
  public.check_in_hotel_stay(uuid, uuid), public.check_out_hotel_stay(uuid), public.mark_hotel_no_show(uuid),
  public.cancel_hotel_stay(uuid, text, boolean), public.invoice_hotel_stay(uuid),
  public.hotel_stays_to_remind(), public.mark_hotel_stay_reminded(uuid)
TO authenticated, service_role;
-- Visitors see free times and rooms before signing in.
GRANT EXECUTE ON FUNCTION public.available_restaurant_times(uuid, date, integer), public.available_hotel_rooms(uuid, date, date, integer) TO anon;

-- ============================================================================
-- DONE
-- ============================================================================
