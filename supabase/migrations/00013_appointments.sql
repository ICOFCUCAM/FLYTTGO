-- ============================================================================
-- FlyttGo — Appointments: online booking of time slots with staff
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00012 (docs/SERVICE_PLATFORM.md).
-- For companies whose plan has the module 'appointments' (salons, barbers,
-- fitness, pet care, tutoring, consultants). The company is the seller.
--
--   * The company lists its services (duration, buffer, price), its staff
--     or rooms ("resources", each offering some services, optionally linked
--     to a member's account), their weekly opening hours and time off, and
--     its rules: cancellation notice, slot step, booking horizon, minimum
--     notice and an optional no-show fee.
--   * available_slots() computes free times (Europe/Oslo) from the hours,
--     minus booked appointments with their buffers and time off; visitors
--     see them before signing in. Booking takes a row lock per resource, so
--     two people never get the same time.
--   * Customers cancel up to the company's notice; after that only the
--     company can. The company marks an appointment completed or no-show
--     and invoices it in its own name (00011): the service, or the no-show
--     fee. Reminders are sent the day before (appointment-reminders).
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.appointment_settings (
  organization_id    uuid        PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  cancel_hours       integer     NOT NULL DEFAULT 24 CHECK (cancel_hours BETWEEN 0 AND 168),
  slot_step_minutes  integer     NOT NULL DEFAULT 15 CHECK (slot_step_minutes IN (5, 10, 15, 20, 30, 60)),
  horizon_days       integer     NOT NULL DEFAULT 60 CHECK (horizon_days BETWEEN 1 AND 365),
  min_notice_minutes integer     NOT NULL DEFAULT 120 CHECK (min_notice_minutes BETWEEN 0 AND 10080),
  no_show_fee        numeric     CHECK (no_show_fee IS NULL OR no_show_fee >= 0),       -- incl. MVA
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.appointment_services (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name             text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  description      text,
  duration_minutes integer     NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  buffer_minutes   integer     NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 120),
  price            numeric     NOT NULL CHECK (price >= 0),                               -- incl. MVA
  vat_rate         numeric     NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 12, 15, 25)),
  active           boolean     NOT NULL DEFAULT true,
  sort             integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointment_services_org_idx ON public.appointment_services (organization_id, sort);

CREATE TABLE IF NOT EXISTS public.appointment_resources (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  user_id         uuid,                                         -- the member who works it (staff), if any
  active          boolean     NOT NULL DEFAULT true,
  sort            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointment_resources_org_idx ON public.appointment_resources (organization_id, sort);

CREATE TABLE IF NOT EXISTS public.appointment_resource_services (
  resource_id uuid NOT NULL REFERENCES public.appointment_resources (id) ON DELETE CASCADE,
  service_id  uuid NOT NULL REFERENCES public.appointment_services (id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, service_id)
);

CREATE TABLE IF NOT EXISTS public.appointment_hours (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid    NOT NULL REFERENCES public.appointment_resources (id) ON DELETE CASCADE,
  weekday     integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),          -- ISO: 1 Monday … 7 Sunday
  start_time  time    NOT NULL,
  end_time    time    NOT NULL,
  CONSTRAINT appointment_hours_order CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS appointment_hours_resource_idx ON public.appointment_hours (resource_id, weekday);

CREATE TABLE IF NOT EXISTS public.appointment_time_off (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid        NOT NULL REFERENCES public.appointment_resources (id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  reason      text,
  CONSTRAINT appointment_time_off_order CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS appointment_time_off_resource_idx ON public.appointment_time_off (resource_id, starts_at);

CREATE TABLE IF NOT EXISTS public.appointments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  number           integer     NOT NULL,
  service_id       uuid        NOT NULL REFERENCES public.appointment_services (id),
  resource_id      uuid        NOT NULL REFERENCES public.appointment_resources (id),
  customer_user_id uuid,
  customer         jsonb       NOT NULL,                       -- name, phone, email
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,                       -- start + duration
  blocked_until    timestamptz NOT NULL,                       -- end + buffer
  price            numeric     NOT NULL,
  vat_rate         numeric     NOT NULL,
  notes            text,
  status           text        NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled', 'completed', 'no_show')),
  cancelled_at     timestamptz,
  cancelled_by     text        CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'company')),
  cancel_reason    text,
  reminded_at      timestamptz,
  invoice_id       uuid        REFERENCES public.invoices (id),
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  CONSTRAINT appointments_order CHECK (ends_at > starts_at AND blocked_until >= ends_at)
);
CREATE INDEX IF NOT EXISTS appointments_resource_idx ON public.appointments (resource_id, starts_at) WHERE status IN ('booked', 'completed', 'no_show');
CREATE INDEX IF NOT EXISTS appointments_customer_idx ON public.appointments (customer_user_id) WHERE customer_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.appointment_events (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  appointment_id uuid        NOT NULL REFERENCES public.appointments (id) ON DELETE CASCADE,
  actor_id       uuid,
  action         text        NOT NULL,
  details        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointment_events_idx ON public.appointment_events (appointment_id, created_at);
DROP TRIGGER IF EXISTS guard_appointment_events ON public.appointment_events;
CREATE TRIGGER guard_appointment_events BEFORE UPDATE OR DELETE ON public.appointment_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();


-- ── 2. Who reads what ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_read_appointment(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.appointments a JOIN public.appointment_resources r ON r.id = a.resource_id
     WHERE a.id = p_id AND (
          a.customer_user_id = auth.uid()
       OR public.is_org_member(a.organization_id, ARRAY['owner', 'admin', 'booker', 'finance', 'viewer'])
       OR (r.user_id = auth.uid() AND public.is_org_member(a.organization_id, ARRAY['staff']))));
$$;

ALTER TABLE public.appointment_settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_services          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_resources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_resource_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_hours             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_time_off          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_events            ENABLE ROW LEVEL SECURITY;

-- The public parts (services, staff names, hours, rules) for visitors.
DROP POLICY IF EXISTS appointment_settings_public ON public.appointment_settings;
CREATE POLICY appointment_settings_public ON public.appointment_settings FOR SELECT TO anon
  USING (public.org_has_module(organization_id, 'appointments'));
DROP POLICY IF EXISTS appointment_settings_select ON public.appointment_settings;
CREATE POLICY appointment_settings_select ON public.appointment_settings FOR SELECT TO authenticated
  USING (public.org_has_module(organization_id, 'appointments') OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS appointment_services_public ON public.appointment_services;
CREATE POLICY appointment_services_public ON public.appointment_services FOR SELECT TO anon
  USING (active AND public.org_has_module(organization_id, 'appointments'));
DROP POLICY IF EXISTS appointment_services_select ON public.appointment_services;
CREATE POLICY appointment_services_select ON public.appointment_services FOR SELECT TO authenticated
  USING ((active AND public.org_has_module(organization_id, 'appointments')) OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS appointment_resources_public ON public.appointment_resources;
CREATE POLICY appointment_resources_public ON public.appointment_resources FOR SELECT TO anon
  USING (active AND public.org_has_module(organization_id, 'appointments'));
DROP POLICY IF EXISTS appointment_resources_select ON public.appointment_resources;
CREATE POLICY appointment_resources_select ON public.appointment_resources FOR SELECT TO authenticated
  USING ((active AND public.org_has_module(organization_id, 'appointments')) OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS appointment_resource_services_public ON public.appointment_resource_services;
CREATE POLICY appointment_resource_services_public ON public.appointment_resource_services FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.appointment_resources r WHERE r.id = resource_id));
DROP POLICY IF EXISTS appointment_hours_public ON public.appointment_hours;
CREATE POLICY appointment_hours_public ON public.appointment_hours FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.appointment_resources r WHERE r.id = resource_id));
DROP POLICY IF EXISTS appointment_time_off_select ON public.appointment_time_off;
CREATE POLICY appointment_time_off_select ON public.appointment_time_off FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.appointment_resources r WHERE r.id = resource_id
                  AND (public.is_admin() OR public.is_org_member(r.organization_id))));
DROP POLICY IF EXISTS appointments_select ON public.appointments;
CREATE POLICY appointments_select ON public.appointments FOR SELECT TO authenticated USING (public.can_read_appointment(id));
DROP POLICY IF EXISTS appointment_events_select ON public.appointment_events;
CREATE POLICY appointment_events_select ON public.appointment_events FOR SELECT TO authenticated
  USING (public.can_read_appointment(appointment_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.appointment_settings, public.appointment_services, public.appointment_resources,
  public.appointment_resource_services, public.appointment_hours, public.appointment_time_off, public.appointments,
  public.appointment_events FROM anon, authenticated;
REVOKE ALL ON public.appointment_time_off, public.appointments, public.appointment_events FROM anon;


-- ── 3. The company's set-up ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.appointment_event(p_id uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.appointment_events (appointment_id, actor_id, action, details)
  VALUES (p_id, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.save_appointment_settings(p_org uuid, p jsonb)
RETURNS public.appointment_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE s public.appointment_settings%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  INSERT INTO public.appointment_settings AS t (organization_id, cancel_hours, slot_step_minutes, horizon_days, min_notice_minutes, no_show_fee)
  VALUES (p_org, coalesce((p ->> 'cancel_hours')::int, 24), coalesce((p ->> 'slot_step_minutes')::int, 15),
          coalesce((p ->> 'horizon_days')::int, 60), coalesce((p ->> 'min_notice_minutes')::int, 120), nullif(p ->> 'no_show_fee', '')::numeric)
  ON CONFLICT (organization_id) DO UPDATE SET cancel_hours = EXCLUDED.cancel_hours, slot_step_minutes = EXCLUDED.slot_step_minutes,
    horizon_days = EXCLUDED.horizon_days, min_notice_minutes = EXCLUDED.min_notice_minutes, no_show_fee = EXCLUDED.no_show_fee,
    updated_at = now()
  RETURNING * INTO s;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.save_appointment_service(p_org uuid, p_id uuid, p jsonb)
RETURNS public.appointment_services
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE s public.appointment_services%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  IF p_id IS NULL THEN
    INSERT INTO public.appointment_services (organization_id, name, description, duration_minutes, buffer_minutes, price, vat_rate, active, sort)
    VALUES (p_org, btrim(p ->> 'name'), p ->> 'description', (p ->> 'duration_minutes')::int, coalesce((p ->> 'buffer_minutes')::int, 0),
            (p ->> 'price')::numeric, coalesce((p ->> 'vat_rate')::numeric, 25), coalesce((p ->> 'active')::boolean, true),
            coalesce((p ->> 'sort')::int, 0))
    RETURNING * INTO s;
  ELSE
    UPDATE public.appointment_services SET name = btrim(p ->> 'name'), description = p ->> 'description',
           duration_minutes = (p ->> 'duration_minutes')::int, buffer_minutes = coalesce((p ->> 'buffer_minutes')::int, 0),
           price = (p ->> 'price')::numeric, vat_rate = coalesce((p ->> 'vat_rate')::numeric, 25),
           active = coalesce((p ->> 'active')::boolean, true), sort = coalesce((p ->> 'sort')::int, 0)
     WHERE id = p_id AND organization_id = p_org RETURNING * INTO s;
    IF NOT FOUND THEN RAISE EXCEPTION 'appointments: no such service' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN s;
END $$;

-- A member of staff or a room: name, the member working it, the services
-- it offers, and its weekly hours [{weekday, start, end}].
CREATE OR REPLACE FUNCTION public.save_appointment_resource(p_org uuid, p_id uuid, p jsonb)
RETURNS public.appointment_resources
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.appointment_resources%ROWTYPE; v_user uuid := nullif(p ->> 'user_id', '')::uuid; h jsonb;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  IF v_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = p_org AND user_id = v_user AND status = 'active') THEN
    RAISE EXCEPTION 'appointments: the person must be a member of the company' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.appointment_resources (organization_id, name, user_id, active, sort)
    VALUES (p_org, btrim(p ->> 'name'), v_user, coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort')::int, 0))
    RETURNING * INTO r;
  ELSE
    UPDATE public.appointment_resources SET name = btrim(p ->> 'name'), user_id = v_user,
           active = coalesce((p ->> 'active')::boolean, true), sort = coalesce((p ->> 'sort')::int, 0)
     WHERE id = p_id AND organization_id = p_org RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'appointments: no such resource' USING ERRCODE = 'P0002'; END IF;
  END IF;
  IF p ? 'service_ids' THEN
    DELETE FROM public.appointment_resource_services WHERE resource_id = r.id;
    INSERT INTO public.appointment_resource_services (resource_id, service_id)
    SELECT r.id, s.id FROM public.appointment_services s
     WHERE s.organization_id = p_org AND s.id IN (SELECT (jsonb_array_elements_text(p -> 'service_ids'))::uuid);
  END IF;
  IF p ? 'hours' THEN
    DELETE FROM public.appointment_hours WHERE resource_id = r.id;
    FOR h IN SELECT * FROM jsonb_array_elements(p -> 'hours') LOOP
      INSERT INTO public.appointment_hours (resource_id, weekday, start_time, end_time)
      VALUES (r.id, (h ->> 'weekday')::int, (h ->> 'start')::time, (h ->> 'end')::time);
    END LOOP;
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.add_appointment_time_off(p_resource uuid, p_from timestamptz, p_to timestamptz, p_reason text)
RETURNS public.appointment_time_off
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.appointment_resources%ROWTYPE; t public.appointment_time_off%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.appointment_resources WHERE id = p_resource;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointments: no such resource' USING ERRCODE = 'P0002'; END IF;
  IF NOT (public.is_org_member(r.organization_id, ARRAY['owner', 'admin', 'booker']) OR r.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'appointments: owners, admins, bookers or the person themselves' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.appointment_time_off (resource_id, starts_at, ends_at, reason) VALUES (p_resource, p_from, p_to, p_reason) RETURNING * INTO t;
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public.remove_appointment_time_off(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.appointment_resources%ROWTYPE;
BEGIN
  SELECT res.* INTO r FROM public.appointment_time_off t JOIN public.appointment_resources res ON res.id = t.resource_id WHERE t.id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointments: no such time off' USING ERRCODE = 'P0002'; END IF;
  IF NOT (public.is_org_member(r.organization_id, ARRAY['owner', 'admin', 'booker']) OR r.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'appointments: owners, admins, bookers or the person themselves' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.appointment_time_off WHERE id = p_id;
END $$;


-- ── 4. Free times ───────────────────────────────────────────────────────────
-- Free starting times on a day (Europe/Oslo) for a service, per resource
-- (or one resource). Respects hours, the slot step, minimum notice, the
-- booking horizon, booked appointments with their buffers, and time off.
CREATE OR REPLACE FUNCTION public.available_slots(p_org uuid, p_service uuid, p_day date, p_resource uuid DEFAULT NULL)
RETURNS TABLE (resource_id uuid, resource_name text, starts_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s   public.appointment_services%ROWTYPE;
  cfg public.appointment_settings%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Europe/Oslo')::date;
BEGIN
  IF NOT public.org_has_module(p_org, 'appointments') THEN RETURN; END IF;
  SELECT * INTO s FROM public.appointment_services WHERE id = p_service AND organization_id = p_org AND active;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO cfg FROM public.appointment_settings WHERE organization_id = p_org;
  cfg.slot_step_minutes  := coalesce(cfg.slot_step_minutes, 15);
  cfg.horizon_days       := coalesce(cfg.horizon_days, 60);
  cfg.min_notice_minutes := coalesce(cfg.min_notice_minutes, 120);
  IF p_day < v_today OR p_day > v_today + cfg.horizon_days THEN RETURN; END IF;
  RETURN QUERY
  SELECT r.id, r.name, slot.t
    FROM public.appointment_resources r
    JOIN public.appointment_resource_services rs ON rs.resource_id = r.id AND rs.service_id = s.id
    JOIN public.appointment_hours h ON h.resource_id = r.id AND h.weekday = extract(isodow FROM p_day)::int
    CROSS JOIN LATERAL generate_series(
      ((p_day + h.start_time) AT TIME ZONE 'Europe/Oslo'),
      ((p_day + h.end_time) AT TIME ZONE 'Europe/Oslo') - make_interval(mins => s.duration_minutes),
      make_interval(mins => cfg.slot_step_minutes)) AS slot(t)
   WHERE r.organization_id = p_org AND r.active AND (p_resource IS NULL OR r.id = p_resource)
     AND slot.t >= now() + make_interval(mins => cfg.min_notice_minutes)
     AND NOT EXISTS (SELECT 1 FROM public.appointments a
                      WHERE a.resource_id = r.id AND a.status IN ('booked', 'completed', 'no_show')
                        AND tstzrange(a.starts_at, a.blocked_until) && tstzrange(slot.t, slot.t + make_interval(mins => s.duration_minutes + s.buffer_minutes)))
     AND NOT EXISTS (SELECT 1 FROM public.appointment_time_off o
                      WHERE o.resource_id = r.id
                        AND tstzrange(o.starts_at, o.ends_at) && tstzrange(slot.t, slot.t + make_interval(mins => s.duration_minutes)))
   ORDER BY slot.t, r.sort, r.name;
END $$;


-- ── 5. Booking ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.appointment_insert(p_org uuid, p_service uuid, p_resource uuid, p_start timestamptz,
                                                     p_customer_user uuid, p_contact jsonb, p_notes text, p_check_slot boolean)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE s public.appointment_services%ROWTYPE; v_res uuid; a public.appointments%ROWTYPE; v_no int;
BEGIN
  SELECT * INTO s FROM public.appointment_services WHERE id = p_service AND organization_id = p_org AND active;
  IF NOT FOUND OR NOT public.org_has_module(p_org, 'appointments') THEN
    RAISE EXCEPTION 'appointments: this service cannot be booked' USING ERRCODE = '55000';
  END IF;
  IF coalesce(btrim(p_contact ->> 'name'), '') = '' OR coalesce(btrim(p_contact ->> 'phone'), '') = '' THEN
    RAISE EXCEPTION 'appointments: a name and a phone number are required' USING ERRCODE = '22023';
  END IF;
  -- The resource: the one asked for, or the first free one at that time.
  SELECT x.resource_id INTO v_res FROM public.available_slots(p_org, p_service, (p_start AT TIME ZONE 'Europe/Oslo')::date, p_resource) x
   WHERE x.starts_at = p_start LIMIT 1;
  IF v_res IS NULL THEN
    IF p_check_slot OR p_resource IS NULL THEN
      RAISE EXCEPTION 'appointments: that time is not available' USING ERRCODE = '55000';
    END IF;
    v_res := p_resource;                                         -- the company books outside the hours
  END IF;
  -- No two appointments on one resource at once, however they are made.
  PERFORM pg_advisory_xact_lock(hashtext('appointments:' || v_res::text));
  IF EXISTS (SELECT 1 FROM public.appointments
              WHERE resource_id = v_res AND status IN ('booked', 'completed', 'no_show')
                AND tstzrange(starts_at, blocked_until) && tstzrange(p_start, p_start + make_interval(mins => s.duration_minutes + s.buffer_minutes))) THEN
    RAISE EXCEPTION 'appointments: that time was just taken' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('appointments-no:' || p_org::text));
  SELECT coalesce(max(number), 0) + 1 INTO v_no FROM public.appointments WHERE organization_id = p_org;
  INSERT INTO public.appointments (organization_id, number, service_id, resource_id, customer_user_id, customer, starts_at, ends_at,
                                   blocked_until, price, vat_rate, notes, created_by)
  VALUES (p_org, v_no, s.id, v_res, p_customer_user,
          jsonb_build_object('name', btrim(p_contact ->> 'name'), 'phone', btrim(p_contact ->> 'phone'),
                             'email', lower(nullif(btrim(p_contact ->> 'email'), ''))),
          p_start, p_start + make_interval(mins => s.duration_minutes),
          p_start + make_interval(mins => s.duration_minutes + s.buffer_minutes), s.price, s.vat_rate, p_notes, auth.uid())
  RETURNING * INTO a;
  PERFORM public.appointment_event(a.id, 'appointment.booked', jsonb_build_object('service', s.name, 'start', p_start));
  RETURN a;
END $$;
REVOKE ALL ON FUNCTION public.appointment_insert(uuid, uuid, uuid, timestamptz, uuid, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;

-- A signed-in customer books a free time.
CREATE OR REPLACE FUNCTION public.book_appointment(p_org uuid, p_service uuid, p_resource uuid, p_start timestamptz,
                                                   p_contact jsonb, p_notes text)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'appointments: sign in to book' USING ERRCODE = '42501'; END IF;
  RETURN public.appointment_insert(p_org, p_service, p_resource, p_start, auth.uid(), p_contact, p_notes, true);
END $$;

-- The company books for a customer (phone or walk-in); it may book a named
-- resource outside its hours, never over another appointment.
CREATE OR REPLACE FUNCTION public.create_appointment(p_org uuid, p_service uuid, p_resource uuid, p_start timestamptz,
                                                     p_contact jsonb, p_notes text)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'booker']);
  RETURN public.appointment_insert(p_org, p_service, p_resource, p_start, NULL, p_contact, p_notes, false);
END $$;

-- The appointment, locked, for the company: owners, admins, bookers (and
-- finance where named), or the staff member working it.
CREATE OR REPLACE FUNCTION public.appointment_for(p_id uuid, p_roles text[])
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE a public.appointments%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.appointments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointments: no such appointment' USING ERRCODE = 'P0002'; END IF;
  IF public.is_server() OR public.is_org_member(a.organization_id, p_roles || ARRAY['owner', 'admin']) THEN RETURN a; END IF;
  IF 'staff' = ANY (p_roles) AND EXISTS (SELECT 1 FROM public.appointment_resources r WHERE r.id = a.resource_id AND r.user_id = auth.uid())
     AND public.is_org_member(a.organization_id, ARRAY['staff']) THEN
    RETURN a;
  END IF;
  RAISE EXCEPTION 'appointments: requires role %', array_to_string(p_roles || ARRAY['owner', 'admin'], ' or ') USING ERRCODE = '42501';
END $$;

-- The customer cancels up to the company's notice; the company until the
-- appointment is completed or marked no-show.
CREATE OR REPLACE FUNCTION public.cancel_appointment(p_id uuid, p_reason text)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE a public.appointments%ROWTYPE; v_hours int; v_by text;
BEGIN
  SELECT * INTO a FROM public.appointments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointments: no such appointment' USING ERRCODE = 'P0002'; END IF;
  IF a.customer_user_id = auth.uid() AND NOT public.is_org_member(a.organization_id, ARRAY['owner', 'admin', 'booker']) THEN
    v_by := 'customer';
    SELECT coalesce(cancel_hours, 24) INTO v_hours FROM public.appointment_settings WHERE organization_id = a.organization_id;
    v_hours := coalesce(v_hours, 24);
    IF a.status <> 'booked' OR a.starts_at < now() + make_interval(hours => v_hours) THEN
      RAISE EXCEPTION 'appointments: it can be cancelled online up to % hours before; contact the company', v_hours USING ERRCODE = '55000';
    END IF;
  ELSE
    a := public.appointment_for(p_id, ARRAY['booker']);
    v_by := 'company';
    IF a.status <> 'booked' THEN RAISE EXCEPTION 'appointments: the appointment is %', a.status USING ERRCODE = '55000'; END IF;
  END IF;
  UPDATE public.appointments SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_by,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   WHERE id = p_id RETURNING * INTO a;
  PERFORM public.appointment_event(p_id, 'appointment.cancelled', jsonb_build_object('by', v_by, 'reason', p_reason));
  RETURN a;
END $$;

-- After the time: completed, or the customer did not come.
CREATE OR REPLACE FUNCTION public.close_appointment(p_id uuid, p_outcome text)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE a public.appointments%ROWTYPE;
BEGIN
  a := public.appointment_for(p_id, ARRAY['booker', 'staff']);
  IF p_outcome NOT IN ('completed', 'no_show') THEN RAISE EXCEPTION 'appointments: completed or no_show' USING ERRCODE = '22023'; END IF;
  IF a.status <> 'booked' THEN RAISE EXCEPTION 'appointments: the appointment is %', a.status USING ERRCODE = '55000'; END IF;
  IF a.starts_at > now() THEN RAISE EXCEPTION 'appointments: the appointment has not started yet' USING ERRCODE = '55000'; END IF;
  UPDATE public.appointments SET status = p_outcome, updated_at = now() WHERE id = p_id RETURNING * INTO a;
  PERFORM public.appointment_event(p_id, 'appointment.' || p_outcome, '{}'::jsonb);
  RETURN a;
END $$;

-- The invoice in the company's name: the service, or the no-show fee.
CREATE OR REPLACE FUNCTION public.invoice_appointment(p_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE a public.appointments%ROWTYPE; s public.appointment_services%ROWTYPE; v_fee numeric; v_inv public.invoices%ROWTYPE;
        v_amount numeric; v_desc text;
BEGIN
  a := public.appointment_for(p_id, ARRAY['finance']);
  IF a.invoice_id IS NOT NULL THEN RAISE EXCEPTION 'appointments: already invoiced' USING ERRCODE = '55000'; END IF;
  SELECT * INTO s FROM public.appointment_services WHERE id = a.service_id;
  IF a.status = 'completed' THEN
    v_amount := a.price; v_desc := s.name || ', ' || to_char(a.starts_at AT TIME ZONE 'Europe/Oslo', 'DD.MM.YYYY HH24:MI');
  ELSIF a.status = 'no_show' THEN
    SELECT no_show_fee INTO v_fee FROM public.appointment_settings WHERE organization_id = a.organization_id;
    IF coalesce(v_fee, 0) <= 0 THEN RAISE EXCEPTION 'appointments: the company has no no-show fee' USING ERRCODE = '55000'; END IF;
    v_amount := v_fee; v_desc := 'Missed appointment (no-show), ' || to_char(a.starts_at AT TIME ZONE 'Europe/Oslo', 'DD.MM.YYYY HH24:MI');
  ELSE
    RAISE EXCEPTION 'appointments: only a completed or missed appointment is invoiced' USING ERRCODE = '55000';
  END IF;
  v_inv := public.sales_invoice_draft(a.organization_id, a.customer, a.customer_user_id,
             jsonb_build_array(jsonb_build_object('description', v_desc, 'quantity', 1,
                                                  'unit_price', round(v_amount / (1 + a.vat_rate / 100), 2), 'vat_rate', a.vat_rate)),
             'Appointment ' || a.number, NULL, 'appointment', a.id);
  v_inv := public.issue_invoice(v_inv.id);
  UPDATE public.appointments SET invoice_id = v_inv.id, updated_at = now() WHERE id = p_id;
  PERFORM public.appointment_event(p_id, 'appointment.invoiced', jsonb_build_object('invoice', v_inv.number, 'total', v_inv.total));
  RETURN v_inv;
END $$;

-- Reminders: appointments starting in the next 20–28 hours not yet
-- reminded (the server sends them and marks each, once).
CREATE OR REPLACE FUNCTION public.appointments_to_remind()
RETURNS SETOF public.appointments
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'appointments: the server only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT * FROM public.appointments
   WHERE status = 'booked' AND reminded_at IS NULL AND customer ->> 'email' IS NOT NULL
     AND starts_at BETWEEN now() + interval '20 hours' AND now() + interval '28 hours';
END $$;

CREATE OR REPLACE FUNCTION public.mark_appointment_reminded(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'appointments: the server only' USING ERRCODE = '42501'; END IF;
  UPDATE public.appointments SET reminded_at = now() WHERE id = p_id AND reminded_at IS NULL;
END $$;


-- ── 6. Who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.appointment_event(uuid, text, jsonb), public.appointment_for(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.can_read_appointment(uuid), public.save_appointment_settings(uuid, jsonb), public.save_appointment_service(uuid, uuid, jsonb),
  public.save_appointment_resource(uuid, uuid, jsonb), public.add_appointment_time_off(uuid, timestamptz, timestamptz, text),
  public.remove_appointment_time_off(uuid), public.available_slots(uuid, uuid, date, uuid),
  public.book_appointment(uuid, uuid, uuid, timestamptz, jsonb, text), public.create_appointment(uuid, uuid, uuid, timestamptz, jsonb, text),
  public.cancel_appointment(uuid, text), public.close_appointment(uuid, text), public.invoice_appointment(uuid),
  public.appointments_to_remind(), public.mark_appointment_reminded(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.can_read_appointment(uuid), public.save_appointment_settings(uuid, jsonb), public.save_appointment_service(uuid, uuid, jsonb),
  public.save_appointment_resource(uuid, uuid, jsonb), public.add_appointment_time_off(uuid, timestamptz, timestamptz, text),
  public.remove_appointment_time_off(uuid), public.available_slots(uuid, uuid, date, uuid),
  public.book_appointment(uuid, uuid, uuid, timestamptz, jsonb, text), public.create_appointment(uuid, uuid, uuid, timestamptz, jsonb, text),
  public.cancel_appointment(uuid, text), public.close_appointment(uuid, text), public.invoice_appointment(uuid),
  public.appointments_to_remind(), public.mark_appointment_reminded(uuid)
TO authenticated, service_role;
-- Visitors see free times before signing in.
GRANT EXECUTE ON FUNCTION public.available_slots(uuid, uuid, date, uuid) TO anon;

-- ============================================================================
-- DONE
-- ============================================================================
