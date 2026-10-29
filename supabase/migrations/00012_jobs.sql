-- ============================================================================
-- FlyttGo — Jobs: booking for trades (work at the customer's address)
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00011 (docs/SERVICE_PLATFORM.md).
-- For companies whose plan has the module 'jobs' (plumbers, electricians,
-- cleaners, painters, gardeners, heating and cooling, pest control, car
-- repair). The company is the seller and does the work.
--
--   request → (quote → accept) → schedule → start → complete → invoice
--
--   * The company lists its services: fixed price, hourly price or "on
--     quote", an optional call-out fee, and the authorisation the work
--     needs (for example 'electrical'). A service that needs one is booked
--     only while FlyttGo has a valid authorisation on record.
--   * A signed-in customer asks for a job at an address. A fixed or hourly
--     price is agreed by booking; a quote is sent by the company and
--     accepted (or declined) by the customer.
--   * The company schedules it in a time window and gives it to a worker
--     (role 'staff', or an owner or admin). The worker records hours,
--     materials and the report; the job is completed and invoiced in the
--     company's own name (00011).
--   * Customers cancel up to 24 hours before the window; the company can
--     cancel until the job is completed. Every step is in job_events.
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_services (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name                   text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  description            text,
  price_type             text        NOT NULL CHECK (price_type IN ('fixed', 'hourly', 'quote')),
  price                  numeric     CHECK (price IS NULL OR price >= 0),          -- incl. MVA
  vat_rate               numeric     NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 12, 15, 25)),
  call_out_fee           numeric     CHECK (call_out_fee IS NULL OR call_out_fee >= 0),  -- incl. MVA
  requires_authorisation text        CHECK (requires_authorisation IS NULL OR requires_authorisation IN
                                            ('electrical', 'plumbing', 'gas', 'pest_control', 'refrigerant', 'chimney', 'other')),
  active                 boolean     NOT NULL DEFAULT true,
  sort                   integer     NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_services_price CHECK (price_type = 'quote' OR price IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS job_services_org_idx ON public.job_services (organization_id, sort);

CREATE TABLE IF NOT EXISTS public.jobs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  number            integer     NOT NULL,
  service_id        uuid        REFERENCES public.job_services (id),
  customer_user_id  uuid,
  customer          jsonb       NOT NULL,                     -- name, phone, email
  address           text        NOT NULL,
  postcode          text,
  city              text,
  lat               double precision,
  lng               double precision,
  description       text,
  preferred_time    text,
  status            text        NOT NULL DEFAULT 'requested' CHECK (status IN
                    ('requested', 'quoted', 'accepted', 'declined', 'scheduled', 'in_progress', 'completed', 'invoiced', 'cancelled')),
  price_type        text        NOT NULL CHECK (price_type IN ('fixed', 'hourly', 'quote')),
  agreed_price      numeric,                                  -- incl. MVA: the service's price or the accepted quote
  quote_amount      numeric,
  quote_note        text,
  quote_valid_until date,
  quoted_at         timestamptz,
  accepted_at       timestamptz,
  window_start      timestamptz,
  window_end        timestamptz,
  assigned_to       uuid,
  started_at        timestamptz,
  completed_at      timestamptz,
  report            text,
  invoice_id        uuid        REFERENCES public.invoices (id),
  cancelled_at      timestamptz,
  cancelled_by      text        CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'company')),
  cancel_reason     text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  CONSTRAINT jobs_window CHECK (window_end IS NULL OR window_start IS NULL OR window_end > window_start)
);
CREATE INDEX IF NOT EXISTS jobs_org_idx ON public.jobs (organization_id, status, window_start);
CREATE INDEX IF NOT EXISTS jobs_customer_idx ON public.jobs (customer_user_id) WHERE customer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_assigned_idx ON public.jobs (assigned_to, window_start) WHERE assigned_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.job_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid        NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('labour', 'material', 'call_out', 'fixed', 'other')),
  description text        NOT NULL,
  quantity    numeric     NOT NULL CHECK (quantity > 0),
  unit_price  numeric     NOT NULL CHECK (unit_price >= 0),     -- excl. MVA
  vat_rate    numeric     NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 12, 15, 25)),
  added_by    uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_items_job_idx ON public.job_items (job_id);

CREATE TABLE IF NOT EXISTS public.job_events (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id     uuid        NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  actor_id   uuid,
  action     text        NOT NULL,
  details    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_events_job_idx ON public.job_events (job_id, created_at);
DROP TRIGGER IF EXISTS guard_job_events ON public.job_events;
CREATE TRIGGER guard_job_events BEFORE UPDATE OR DELETE ON public.job_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();


-- ── 2. Who reads what ───────────────────────────────────────────────────────
-- The customer reads their jobs; the company's owners, admins, bookers,
-- finance and viewers read all its jobs; staff the jobs given to them.
CREATE OR REPLACE FUNCTION public.can_read_job(p_job uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.jobs j WHERE j.id = p_job AND (
         j.customer_user_id = auth.uid()
      OR public.is_org_member(j.organization_id, ARRAY['owner', 'admin', 'booker', 'finance', 'viewer'])
      OR (j.assigned_to = auth.uid() AND public.is_org_member(j.organization_id, ARRAY['staff']))));
$$;

ALTER TABLE public.job_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_events   ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_services_public ON public.job_services;
CREATE POLICY job_services_public ON public.job_services FOR SELECT TO anon
  USING (active AND public.org_has_module(organization_id, 'jobs'));
DROP POLICY IF EXISTS job_services_select ON public.job_services;
CREATE POLICY job_services_select ON public.job_services FOR SELECT TO authenticated
  USING ((active AND public.org_has_module(organization_id, 'jobs')) OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS jobs_select ON public.jobs;
CREATE POLICY jobs_select ON public.jobs FOR SELECT TO authenticated USING (public.can_read_job(id));
DROP POLICY IF EXISTS job_items_select ON public.job_items;
CREATE POLICY job_items_select ON public.job_items FOR SELECT TO authenticated USING (public.can_read_job(job_id));
DROP POLICY IF EXISTS job_events_select ON public.job_events;
CREATE POLICY job_events_select ON public.job_events FOR SELECT TO authenticated USING (public.can_read_job(job_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.job_services, public.jobs, public.job_items, public.job_events FROM anon, authenticated;
REVOKE ALL ON public.jobs, public.job_items, public.job_events FROM anon;


-- ── 3. Helpers ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.job_event(p_job uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.job_events (job_id, actor_id, action, details) VALUES (p_job, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

-- The job, locked, after checking the caller has one of the company roles
-- (owners and admins always; staff only on a job given to them).
CREATE OR REPLACE FUNCTION public.job_for(p_job uuid, p_roles text[])
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs: no such job' USING ERRCODE = 'P0002'; END IF;
  IF public.is_server() THEN RETURN j; END IF;
  IF public.is_org_member(j.organization_id, p_roles || ARRAY['owner', 'admin'])
     AND ('staff' <> ALL (p_roles) OR NOT public.is_org_member(j.organization_id, ARRAY['staff']) OR j.assigned_to = auth.uid()) THEN
    RETURN j;
  END IF;
  RAISE EXCEPTION 'jobs: requires role %', array_to_string(p_roles || ARRAY['owner', 'admin'], ' or ') USING ERRCODE = '42501';
END $$;


-- ── 4. The company's services ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_job_service(p_org uuid, p_id uuid, p jsonb)
RETURNS public.job_services
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE s public.job_services%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  IF p_id IS NULL THEN
    INSERT INTO public.job_services (organization_id, name, description, price_type, price, vat_rate, call_out_fee,
                                     requires_authorisation, active, sort)
    VALUES (p_org, btrim(p ->> 'name'), p ->> 'description', p ->> 'price_type', nullif(p ->> 'price', '')::numeric,
            coalesce((p ->> 'vat_rate')::numeric, 25), nullif(p ->> 'call_out_fee', '')::numeric,
            nullif(p ->> 'requires_authorisation', ''), coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort')::int, 0))
    RETURNING * INTO s;
  ELSE
    UPDATE public.job_services SET
      name = btrim(p ->> 'name'), description = p ->> 'description', price_type = p ->> 'price_type',
      price = nullif(p ->> 'price', '')::numeric, vat_rate = coalesce((p ->> 'vat_rate')::numeric, 25),
      call_out_fee = nullif(p ->> 'call_out_fee', '')::numeric, requires_authorisation = nullif(p ->> 'requires_authorisation', ''),
      active = coalesce((p ->> 'active')::boolean, true), sort = coalesce((p ->> 'sort')::int, 0), updated_at = now()
     WHERE id = p_id AND organization_id = p_org RETURNING * INTO s;
    IF NOT FOUND THEN RAISE EXCEPTION 'jobs: no such service' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN s;
END $$;


-- ── 5. Requesting and quoting ───────────────────────────────────────────────
-- p_place: {address, postcode, city, lat, lng}; p_contact: {name, phone, email}.
CREATE OR REPLACE FUNCTION public.job_insert(p_org uuid, p_service uuid, p_customer_user uuid, p_contact jsonb,
                                             p_place jsonb, p_description text, p_preferred text)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE s public.job_services%ROWTYPE; j public.jobs%ROWTYPE; v_no int;
BEGIN
  IF NOT public.org_has_module(p_org, 'jobs') THEN
    RAISE EXCEPTION 'jobs: this company does not take jobs online' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO s FROM public.job_services WHERE id = p_service AND organization_id = p_org AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs: no such service' USING ERRCODE = 'P0002'; END IF;
  IF s.requires_authorisation IS NOT NULL AND NOT public.has_authorisation(p_org, s.requires_authorisation) THEN
    RAISE EXCEPTION 'jobs: this service needs an authorisation (%) the company does not have on record', s.requires_authorisation
      USING ERRCODE = '55000';
  END IF;
  IF coalesce(btrim(p_place ->> 'address'), '') = '' OR coalesce(btrim(p_contact ->> 'name'), '') = ''
     OR coalesce(btrim(p_contact ->> 'phone'), '') = '' THEN
    RAISE EXCEPTION 'jobs: an address, a name and a phone number are required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('jobs:' || p_org::text));
  SELECT coalesce(max(number), 0) + 1 INTO v_no FROM public.jobs WHERE organization_id = p_org;
  INSERT INTO public.jobs (organization_id, number, service_id, customer_user_id, customer, address, postcode, city, lat, lng,
                           description, preferred_time, status, price_type, agreed_price, accepted_at, created_by)
  VALUES (p_org, v_no, s.id, p_customer_user,
          jsonb_build_object('name', btrim(p_contact ->> 'name'), 'phone', btrim(p_contact ->> 'phone'),
                             'email', lower(nullif(btrim(p_contact ->> 'email'), ''))),
          btrim(p_place ->> 'address'), p_place ->> 'postcode', p_place ->> 'city',
          nullif(p_place ->> 'lat', '')::double precision, nullif(p_place ->> 'lng', '')::double precision,
          p_description, p_preferred,
          CASE WHEN s.price_type = 'quote' THEN 'requested' ELSE 'accepted' END, s.price_type,
          CASE WHEN s.price_type = 'quote' THEN NULL ELSE s.price END,
          CASE WHEN s.price_type = 'quote' THEN NULL ELSE now() END, auth.uid())
  RETURNING * INTO j;
  PERFORM public.job_event(j.id, 'job.requested', jsonb_build_object('service', s.name, 'price_type', s.price_type));
  RETURN j;
END $$;
REVOKE ALL ON FUNCTION public.job_insert(uuid, uuid, uuid, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;

-- A signed-in customer asks for a job.
CREATE OR REPLACE FUNCTION public.request_job(p_org uuid, p_service uuid, p_contact jsonb, p_place jsonb,
                                              p_description text, p_preferred text)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'jobs: sign in to request a job' USING ERRCODE = '42501'; END IF;
  RETURN public.job_insert(p_org, p_service, auth.uid(), p_contact, p_place, p_description, p_preferred);
END $$;

-- The company records a job it took by phone (no customer account needed).
CREATE OR REPLACE FUNCTION public.create_job(p_org uuid, p_service uuid, p_contact jsonb, p_place jsonb,
                                             p_description text, p_preferred text)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'booker']);
  RETURN public.job_insert(p_org, p_service, NULL, p_contact, p_place, p_description, p_preferred);
END $$;

CREATE OR REPLACE FUNCTION public.quote_job(p_job uuid, p_amount numeric, p_note text, p_valid_days integer DEFAULT 14)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
  j := public.job_for(p_job, ARRAY['booker']);
  IF j.status NOT IN ('requested', 'quoted') THEN RAISE EXCEPTION 'jobs: a quote is given for a requested job' USING ERRCODE = '55000'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'jobs: the quote needs an amount' USING ERRCODE = '22023'; END IF;
  UPDATE public.jobs SET status = 'quoted', quote_amount = round(p_amount, 2), quote_note = p_note, quoted_at = now(),
         quote_valid_until = (now() AT TIME ZONE 'Europe/Oslo')::date + greatest(1, coalesce(p_valid_days, 14)), updated_at = now()
   WHERE id = p_job RETURNING * INTO j;
  PERFORM public.job_event(p_job, 'job.quoted', jsonb_build_object('amount', j.quote_amount, 'valid_until', j.quote_valid_until));
  RETURN j;
END $$;

-- The customer accepts or declines the quote (while it is valid).
CREATE OR REPLACE FUNCTION public.respond_to_quote(p_job uuid, p_accept boolean)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND OR j.customer_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'jobs: no such job' USING ERRCODE = 'P0002'; END IF;
  IF j.status <> 'quoted' THEN RAISE EXCEPTION 'jobs: there is no quote to answer' USING ERRCODE = '55000'; END IF;
  IF p_accept AND j.quote_valid_until < (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'jobs: the quote expired on %; ask for a new one', j.quote_valid_until USING ERRCODE = '55000';
  END IF;
  UPDATE public.jobs SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         agreed_price = CASE WHEN p_accept THEN quote_amount END, accepted_at = CASE WHEN p_accept THEN now() END, updated_at = now()
   WHERE id = p_job RETURNING * INTO j;
  PERFORM public.job_event(p_job, CASE WHEN p_accept THEN 'job.quote_accepted' ELSE 'job.quote_declined' END, '{}'::jsonb);
  RETURN j;
END $$;


-- ── 6. Doing the job ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.schedule_job(p_job uuid, p_start timestamptz, p_end timestamptz, p_assignee uuid)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
  j := public.job_for(p_job, ARRAY['booker']);
  IF j.status NOT IN ('accepted', 'scheduled') THEN
    RAISE EXCEPTION 'jobs: only an accepted job is scheduled (status %)', j.status USING ERRCODE = '55000';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN RAISE EXCEPTION 'jobs: give a time window' USING ERRCODE = '22023'; END IF;
  IF p_assignee IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = j.organization_id
                                             AND user_id = p_assignee AND status = 'active' AND role IN ('staff', 'owner', 'admin')) THEN
    RAISE EXCEPTION 'jobs: the worker must be a staff member, owner or admin of the company' USING ERRCODE = '22023';
  END IF;
  UPDATE public.jobs SET status = 'scheduled', window_start = p_start, window_end = p_end, assigned_to = p_assignee, updated_at = now()
   WHERE id = p_job RETURNING * INTO j;
  PERFORM public.job_event(p_job, 'job.scheduled', jsonb_build_object('start', p_start, 'end', p_end, 'assigned_to', p_assignee));
  RETURN j;
END $$;

CREATE OR REPLACE FUNCTION public.start_job(p_job uuid)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
  j := public.job_for(p_job, ARRAY['staff']);
  IF j.status <> 'scheduled' THEN RAISE EXCEPTION 'jobs: only a scheduled job is started' USING ERRCODE = '55000'; END IF;
  UPDATE public.jobs SET status = 'in_progress', started_at = now(), updated_at = now() WHERE id = p_job RETURNING * INTO j;
  PERFORM public.job_event(p_job, 'job.started', '{}'::jsonb);
  RETURN j;
END $$;

-- Hours, materials and other lines of the job report (prices excl. MVA).
CREATE OR REPLACE FUNCTION public.add_job_item(p_job uuid, p_kind text, p_description text, p_quantity numeric,
                                               p_unit_price numeric, p_vat_rate numeric DEFAULT 25)
RETURNS public.job_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.jobs%ROWTYPE; i public.job_items%ROWTYPE;
BEGIN
  j := public.job_for(p_job, ARRAY['staff', 'booker']);
  IF j.status IN ('invoiced', 'cancelled', 'declined') THEN RAISE EXCEPTION 'jobs: the job is %', j.status USING ERRCODE = '55000'; END IF;
  IF coalesce(btrim(p_description), '') = '' THEN RAISE EXCEPTION 'jobs: describe the line' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.job_items (job_id, kind, description, quantity, unit_price, vat_rate, added_by)
  VALUES (p_job, p_kind, btrim(p_description), p_quantity, p_unit_price, coalesce(p_vat_rate, 25), auth.uid()) RETURNING * INTO i;
  PERFORM public.job_event(p_job, 'job.item_added', jsonb_build_object('kind', p_kind, 'description', p_description, 'quantity', p_quantity));
  RETURN i;
END $$;

CREATE OR REPLACE FUNCTION public.remove_job_item(p_item uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.jobs%ROWTYPE; v_job uuid;
BEGIN
  SELECT job_id INTO v_job FROM public.job_items WHERE id = p_item;
  IF v_job IS NULL THEN RAISE EXCEPTION 'jobs: no such line' USING ERRCODE = 'P0002'; END IF;
  j := public.job_for(v_job, ARRAY['staff', 'booker']);
  IF j.status IN ('invoiced', 'cancelled', 'declined') THEN RAISE EXCEPTION 'jobs: the job is %', j.status USING ERRCODE = '55000'; END IF;
  DELETE FROM public.job_items WHERE id = p_item;
  PERFORM public.job_event(v_job, 'job.item_removed', jsonb_build_object('item', p_item));
END $$;

-- Completing adds the agreed price as a line when the job has none (a
-- fixed price or an accepted quote), and the call-out fee once.
CREATE OR REPLACE FUNCTION public.complete_job(p_job uuid, p_report text)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.jobs%ROWTYPE; s public.job_services%ROWTYPE;
BEGIN
  j := public.job_for(p_job, ARRAY['staff']);
  IF j.status NOT IN ('scheduled', 'in_progress') THEN RAISE EXCEPTION 'jobs: only a scheduled or started job is completed' USING ERRCODE = '55000'; END IF;
  SELECT * INTO s FROM public.job_services WHERE id = j.service_id;
  IF j.price_type IN ('fixed', 'quote') AND j.agreed_price IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.job_items WHERE job_id = p_job AND kind IN ('fixed', 'labour')) THEN
    INSERT INTO public.job_items (job_id, kind, description, quantity, unit_price, vat_rate, added_by)
    VALUES (p_job, 'fixed', coalesce(s.name, 'Agreed price') || CASE WHEN j.price_type = 'quote' THEN ' (accepted quote)' ELSE '' END, 1,
            round(j.agreed_price / (1 + coalesce(s.vat_rate, 25) / 100), 2), coalesce(s.vat_rate, 25), auth.uid());
  END IF;
  IF s.call_out_fee IS NOT NULL AND s.call_out_fee > 0 AND NOT EXISTS (SELECT 1 FROM public.job_items WHERE job_id = p_job AND kind = 'call_out') THEN
    INSERT INTO public.job_items (job_id, kind, description, quantity, unit_price, vat_rate, added_by)
    VALUES (p_job, 'call_out', 'Call-out', 1, round(s.call_out_fee / (1 + s.vat_rate / 100), 2), s.vat_rate, auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_items WHERE job_id = p_job) THEN
    RAISE EXCEPTION 'jobs: record the hours and materials before completing' USING ERRCODE = '55000';
  END IF;
  UPDATE public.jobs SET status = 'completed', completed_at = now(), started_at = coalesce(started_at, now()),
         report = nullif(btrim(coalesce(p_report, '')), ''), updated_at = now()
   WHERE id = p_job RETURNING * INTO j;
  PERFORM public.job_event(p_job, 'job.completed', jsonb_build_object('report', j.report));
  RETURN j;
END $$;

-- The invoice, in the company's own name, from the job report.
CREATE OR REPLACE FUNCTION public.invoice_job(p_job uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.jobs%ROWTYPE; v_inv public.invoices%ROWTYPE; v_lines jsonb;
BEGIN
  j := public.job_for(p_job, ARRAY['finance']);
  IF j.status <> 'completed' THEN RAISE EXCEPTION 'jobs: only a completed job is invoiced' USING ERRCODE = '55000'; END IF;
  SELECT jsonb_agg(jsonb_build_object('description', description || ' (job ' || j.number || ')', 'quantity', quantity,
                                      'unit_price', unit_price, 'vat_rate', vat_rate) ORDER BY created_at)
    INTO v_lines FROM public.job_items WHERE job_id = p_job;
  v_inv := public.sales_invoice_draft(j.organization_id,
             j.customer || jsonb_build_object('address', j.address, 'postcode_city', concat_ws(' ', j.postcode, j.city)),
             j.customer_user_id, v_lines, 'Job ' || j.number, j.report, 'job', j.id);
  UPDATE public.invoices SET delivery_from = coalesce((j.started_at AT TIME ZONE 'Europe/Oslo')::date, delivery_from),
         delivery_to = coalesce((j.completed_at AT TIME ZONE 'Europe/Oslo')::date, delivery_to)
   WHERE id = v_inv.id;
  v_inv := public.issue_invoice(v_inv.id);
  UPDATE public.jobs SET status = 'invoiced', invoice_id = v_inv.id, updated_at = now() WHERE id = p_job;
  PERFORM public.job_event(p_job, 'job.invoiced', jsonb_build_object('invoice', v_inv.number, 'total', v_inv.total));
  RETURN v_inv;
END $$;

-- The customer cancels until 24 hours before the window; the company until
-- the job is completed.
CREATE OR REPLACE FUNCTION public.cancel_job(p_job uuid, p_reason text)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.jobs%ROWTYPE; v_by text;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs: no such job' USING ERRCODE = 'P0002'; END IF;
  IF j.customer_user_id = auth.uid() AND NOT public.is_org_member(j.organization_id, ARRAY['owner', 'admin', 'booker']) THEN
    v_by := 'customer';
    IF j.status NOT IN ('requested', 'quoted', 'accepted', 'scheduled')
       OR (j.status = 'scheduled' AND j.window_start < now() + interval '24 hours') THEN
      RAISE EXCEPTION 'jobs: it is too late to cancel online; contact the company' USING ERRCODE = '55000';
    END IF;
  ELSE
    j := public.job_for(p_job, ARRAY['booker']);
    v_by := 'company';
    IF j.status IN ('completed', 'invoiced', 'cancelled') THEN RAISE EXCEPTION 'jobs: the job is %', j.status USING ERRCODE = '55000'; END IF;
  END IF;
  UPDATE public.jobs SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_by,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   WHERE id = p_job RETURNING * INTO j;
  PERFORM public.job_event(p_job, 'job.cancelled', jsonb_build_object('by', v_by, 'reason', p_reason));
  RETURN j;
END $$;


-- ── 7. Who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.job_event(uuid, text, jsonb), public.job_for(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.can_read_job(uuid), public.save_job_service(uuid, uuid, jsonb),
  public.request_job(uuid, uuid, jsonb, jsonb, text, text), public.create_job(uuid, uuid, jsonb, jsonb, text, text),
  public.quote_job(uuid, numeric, text, integer), public.respond_to_quote(uuid, boolean),
  public.schedule_job(uuid, timestamptz, timestamptz, uuid), public.start_job(uuid),
  public.add_job_item(uuid, text, text, numeric, numeric, numeric), public.remove_job_item(uuid),
  public.complete_job(uuid, text), public.invoice_job(uuid), public.cancel_job(uuid, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.can_read_job(uuid), public.save_job_service(uuid, uuid, jsonb),
  public.request_job(uuid, uuid, jsonb, jsonb, text, text), public.create_job(uuid, uuid, jsonb, jsonb, text, text),
  public.quote_job(uuid, numeric, text, integer), public.respond_to_quote(uuid, boolean),
  public.schedule_job(uuid, timestamptz, timestamptz, uuid), public.start_job(uuid),
  public.add_job_item(uuid, text, text, numeric, numeric, numeric), public.remove_job_item(uuid),
  public.complete_job(uuid, text), public.invoice_job(uuid), public.cancel_job(uuid, text)
TO authenticated, service_role;
-- Visitors browse a company's services before signing in (the policy
-- calls org_has_module).
GRANT EXECUTE ON FUNCTION public.org_has_module(uuid, text) TO anon;

-- ============================================================================
-- DONE
-- ============================================================================
