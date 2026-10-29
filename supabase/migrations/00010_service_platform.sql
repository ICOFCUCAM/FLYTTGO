-- ============================================================================
-- FlyttGo — the platform for other industries (core)
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00009. Decided 2026-10-29
-- (docs/SERVICE_PLATFORM.md): FlyttGo also gives companies outside moving
-- and logistics their booking, invoicing and website (trades such as
-- plumbers and electricians, appointment businesses such as salons), on the
-- same platform. Transport launches first; these are built and ready.
--
--   * A company states its industry. Outside transport the company is
--     always the seller: FlyttGo cannot sell a plumber's or an
--     electrician's work in its own name, so Model A (FlyttGo sells) stays
--     for moving and delivery.
--   * What a company can use comes with its plan: white_label_plans.modules
--     ('jobs', 'appointments', 'sales_invoicing'). org_has_module() is the
--     one check, read live from the active plan.
--   * New plans, all with the company as seller: Website and invoicing (any
--     industry), Jobs (trades: work at the customer's address) and
--     Appointments (time slots with staff). Prices are proposals until
--     FlyttGo confirms them.
--   * A company role for its workers: 'staff' (sees and works the jobs and
--     appointments given to them).
--   * Trade authorisations FlyttGo has checked (for example registration
--     in DSB's register of electrical contractors). A service can require
--     one; the Jobs module refuses the booking without it.
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Industry ─────────────────────────────────────────────────────────────
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS industry text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_industry_check') THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_industry_check CHECK (industry IS NULL OR industry IN (
      'transport', 'field_service', 'appointments', 'hospitality', 'retail', 'software_education', 'health', 'nonprofit', 'other'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_organization_industry(p_org uuid, p_industry text)
RETURNS public.organizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org public.organizations%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  UPDATE public.organizations SET industry = p_industry, updated_at = now() WHERE id = p_org RETURNING * INTO v_org;
  PERFORM public.org_event(p_org, 'organization.industry', NULL, jsonb_build_object('industry', p_industry));
  RETURN v_org;
END $$;


-- ── 2. Staff role ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_members_role_check'
               AND pg_get_constraintdef(oid) NOT LIKE '%staff%') THEN
    ALTER TABLE public.organization_members DROP CONSTRAINT organization_members_role_check;
    ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_role_check
      CHECK (role IN ('owner', 'admin', 'booker', 'finance', 'viewer', 'staff'));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_invitations_role_check'
               AND pg_get_constraintdef(oid) NOT LIKE '%staff%') THEN
    ALTER TABLE public.organization_invitations DROP CONSTRAINT organization_invitations_role_check;
    ALTER TABLE public.organization_invitations ADD CONSTRAINT organization_invitations_role_check
      CHECK (role IN ('owner', 'admin', 'booker', 'finance', 'viewer', 'staff'));
  END IF;
END $$;


-- ── 3. Plans carry modules ──────────────────────────────────────────────────
ALTER TABLE public.white_label_plans
  ADD COLUMN IF NOT EXISTS modules         text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS industries      text[]  NOT NULL DEFAULT '{}',   -- empty: any industry
  ADD COLUMN IF NOT EXISTS requires_vat    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_stripe boolean NOT NULL DEFAULT false;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'white_label_plans_modules_check') THEN
    ALTER TABLE public.white_label_plans ADD CONSTRAINT white_label_plans_modules_check CHECK (
          modules <@ ARRAY['jobs', 'appointments', 'sales_invoicing']
      -- FlyttGo sells only moving and delivery.
      AND (seller_model = 'company' OR (cardinality(modules) = 0 AND industries <@ ARRAY['transport'])));
  END IF;
END $$;
-- The transport plans: FlyttGo's moving engine, for transport companies.
UPDATE public.white_label_plans SET industries = ARRAY['transport'] WHERE code IN ('branded', 'branded_domain') AND industries = '{}';
UPDATE public.white_label_plans SET industries = ARRAY['transport'], requires_vat = true, requires_stripe = true
 WHERE code = 'own_seller' AND industries = '{}';

INSERT INTO public.white_label_plans (code, name, seller_model, summary, for_whom, setup_fee, monthly_fee, own_domain,
                                      features, flyttgo_does, company_does, requirements, sort, modules, industries)
SELECT * FROM (VALUES
  ('website_invoicing', 'Website and invoicing', 'company',
   'Your website from the template library and invoices in your own name, with KID, EHF and reminders.',
   'Any company that wants a website and simple, legal invoicing without an accounting system of its own.',
   1900::numeric, 690::numeric, false,
   ARRAY['A website from FlyttGo''s template library, in your name and colours',
         'Invoices in your company''s name: your number series, bank account and KID',
         'PDF and EHF, reminders, credit notes, card payment of invoices (with Stripe)',
         'Export for your accountant'],
   ARRAY['Runs the website and the invoicing system',
         'Processes your customers'' data for you under the data processing agreement',
         'Invoices you monthly for the plan'],
   ARRAY['Is the seller of its own services and keeps its own accounts',
         'Customer service and its terms and privacy notice'],
   ARRAY['An active (verified) company', 'Customer service email and phone', 'Your terms and privacy notice (web addresses)',
         'The data processing agreement, accepted by an owner'],
   40, ARRAY['sales_invoicing'], ARRAY[]::text[]),
  ('jobs', 'Jobs: booking for trades', 'company',
   'Customers ask for a job at their address; you quote, schedule, send a worker, write the job report and invoice it.',
   'Trades and home services: plumbers, electricians, cleaners, painters, gardeners, heating and cooling, pest control, car repair.',
   4900::numeric, 1290::numeric, false,
   ARRAY['Booking page for your services: fixed price, hourly or quote',
         'Quotes the customer accepts online',
         'Scheduling, your workers'' jobs and the job report (hours, materials)',
         'Invoice from the job in your name, card or bank payment',
         'Services that need an authorisation (for example electrical work) are offered only once FlyttGo has checked it',
         'A website from the template library'],
   ARRAY['Runs the booking, scheduling and invoicing system',
         'Checks your authorisations in the public registers',
         'Processes your customers'' data for you under the data processing agreement'],
   ARRAY['Is the seller and does the work: quality, safety, guarantees',
         'Customer service, its terms and privacy notice, its own accounts'],
   ARRAY['An active (verified) company in a trade', 'Customer service email and phone', 'Your terms and privacy notice (web addresses)',
         'The data processing agreement, accepted by an owner', 'Authorisations for regulated work, checked by FlyttGo'],
   50, ARRAY['jobs', 'sales_invoicing'], ARRAY['field_service']),
  ('appointments', 'Appointments: online booking', 'company',
   'Customers book a time with you or your staff online; reminders, cancellation rules and invoicing included.',
   'Salons, barbers, fitness, pet care, tutoring, consultants and other businesses that work by appointment.',
   2900::numeric, 990::numeric, false,
   ARRAY['Online booking of your services with your staff''s calendars',
         'Opening hours, time off and buffers; no double bookings',
         'Your cancellation rule and no-show marking; email reminders',
         'Invoice or card payment in your name',
         'A website from the template library'],
   ARRAY['Runs the booking and invoicing system and sends reminders',
         'Processes your customers'' data for you under the data processing agreement'],
   ARRAY['Is the seller of its services',
         'Customer service, its terms and privacy notice, its own accounts'],
   ARRAY['An active (verified) company', 'Customer service email and phone', 'Your terms and privacy notice (web addresses)',
         'The data processing agreement, accepted by an owner'],
   60, ARRAY['appointments', 'sales_invoicing'], ARRAY['appointments'])
) AS v(code, name, seller_model, summary, for_whom, setup_fee, monthly_fee, own_domain, features, flyttgo_does,
       company_does, requirements, sort, modules, industries)
WHERE NOT EXISTS (SELECT 1 FROM public.white_label_plans p WHERE p.code = v.code);

-- The one check for a module: the company is active and its active plan
-- includes it.
CREATE OR REPLACE FUNCTION public.org_has_module(p_org uuid, p_module text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_white_label w
      JOIN public.white_label_plans p ON p.code = w.plan_code
      JOIN public.organizations o ON o.id = w.organization_id
     WHERE w.organization_id = p_org AND w.status = 'active' AND o.status = 'active' AND p_module = ANY (p.modules));
$$;

-- A plan's requirements, now per plan: industry, MVA, Stripe.
CREATE OR REPLACE FUNCTION public.white_label_missing(p_org uuid, p_plan text DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  w   public.organization_white_label%ROWTYPE;
  o   public.organizations%ROWTYPE;
  p   public.white_label_plans%ROWTYPE;
  m   text[] := '{}';
BEGIN
  IF NOT (public.is_admin() OR public.is_server() OR public.is_org_member(p_org)) THEN
    RAISE EXCEPTION 'white label: members of the company only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.organizations WHERE id = p_org;
  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org;
  SELECT * INTO p FROM public.white_label_plans
   WHERE code = coalesce(p_plan, w.requested_plan_code, w.plan_code,
                         (SELECT code FROM public.white_label_plans WHERE is_default));
  IF NOT FOUND THEN RETURN ARRAY['a plan']; END IF;
  IF NOT p.active THEN m := array_append(m, 'the plan is no longer offered'::text); END IF;
  IF o.status IS DISTINCT FROM 'active' THEN m := array_append(m, 'the company must be active (verified by FlyttGo)'::text); END IF;
  IF cardinality(p.industries) > 0 AND (o.industry IS NULL OR NOT o.industry = ANY (p.industries)) THEN
    m := array_append(m, CASE WHEN o.industry IS NULL THEN 'your industry (company details)'
                              WHEN p.seller_model = 'flyttgo' THEN 'FlyttGo sells only moving and delivery: choose a plan where your company sells'
                              ELSE 'a plan for your industry' END);
  END IF;
  IF w.display_name IS NULL THEN m := array_append(m, 'a display name for the page'::text); END IF;
  IF p.own_domain AND (w.custom_domain IS NULL OR w.domain_verified_at IS NULL) THEN m := array_append(m, 'a verified domain'::text); END IF;
  IF p.seller_model = 'company' THEN
    IF p.requires_vat AND (o.org_number IS NULL OR NOT o.vat_registered) THEN m := array_append(m, 'registration for MVA'::text); END IF;
    IF w.support_email IS NULL OR w.support_phone IS NULL THEN m := array_append(m, 'customer service email and phone'::text); END IF;
    IF w.terms_url IS NULL THEN m := array_append(m, 'your terms (web address)'::text); END IF;
    IF w.privacy_url IS NULL THEN m := array_append(m, 'your privacy notice (web address)'::text); END IF;
    IF w.dpa_version IS DISTINCT FROM public.config_text('white_label_dpa_version') THEN
      m := array_append(m, 'the data processing agreement, accepted by an owner'::text);
    END IF;
    IF p.requires_stripe AND (w.stripe_account_id IS NULL OR NOT w.stripe_charges_enabled) THEN
      m := array_append(m, 'a connected Stripe account that can take payments'::text);
    END IF;
  END IF;
  RETURN m;
END $$;

-- FlyttGo's moving engine takes bookings only on transport plans.
CREATE OR REPLACE FUNCTION public.guard_booking_transport_plan()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.white_label_org IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.organization_white_label w JOIN public.white_label_plans p ON p.code = w.plan_code
        WHERE w.organization_id = NEW.white_label_org AND cardinality(p.industries) > 0 AND NOT 'transport' = ANY (p.industries)) THEN
    RAISE EXCEPTION 'bookings: this company''s page takes its own bookings, not moves' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_booking_transport_plan ON public.bookings;
CREATE TRIGGER guard_booking_transport_plan BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_transport_plan();
REVOKE ALL ON FUNCTION public.guard_booking_transport_plan() FROM PUBLIC, anon, authenticated;


-- ── 4. Trade authorisations ─────────────────────────────────────────────────
-- Checked by a FlyttGo administrator in the public register (or from a
-- document), with the evidence. Kept, never deleted; revoked with a reason.
CREATE TABLE IF NOT EXISTS public.organization_authorisations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  kind            text        NOT NULL CHECK (kind IN ('electrical', 'plumbing', 'gas', 'pest_control', 'refrigerant', 'chimney', 'other')),
  register        text        NOT NULL,                        -- e.g. DSB elvirksomhetsregisteret
  reference       text,                                        -- registration number
  valid_until     date,
  evidence        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status          text        NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'revoked')),
  revoked_reason  text,
  recorded_by     uuid,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_authorisations_org_idx ON public.organization_authorisations (organization_id, kind);
ALTER TABLE public.organization_authorisations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_authorisations_select ON public.organization_authorisations;
CREATE POLICY organization_authorisations_select ON public.organization_authorisations FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organization_authorisations FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.has_authorisation(p_org uuid, p_kind text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_authorisations
                  WHERE organization_id = p_org AND kind = p_kind AND status = 'valid'
                    AND (valid_until IS NULL OR valid_until >= (now() AT TIME ZONE 'Europe/Oslo')::date));
$$;

CREATE OR REPLACE FUNCTION public.record_organization_authorisation(
  p_org uuid, p_kind text, p_register text, p_reference text, p_valid_until date, p_evidence jsonb)
RETURNS public.organization_authorisations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE a public.organization_authorisations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'authorisations: platform administrators only' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_register), '') = '' OR coalesce(p_evidence, '{}'::jsonb) = '{}'::jsonb THEN
    RAISE EXCEPTION 'authorisations: name the register and record what you checked' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.organization_authorisations (organization_id, kind, register, reference, valid_until, evidence, recorded_by)
  VALUES (p_org, p_kind, btrim(p_register), nullif(btrim(coalesce(p_reference, '')), ''), p_valid_until, p_evidence, auth.uid())
  RETURNING * INTO a;
  PERFORM public.org_event(p_org, 'authorisation.recorded', NULL, jsonb_build_object('kind', p_kind, 'register', p_register, 'reference', p_reference));
  RETURN a;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_organization_authorisation(p_id uuid, p_reason text)
RETURNS public.organization_authorisations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE a public.organization_authorisations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'authorisations: platform administrators only' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'authorisations: give the reason' USING ERRCODE = '22023'; END IF;
  UPDATE public.organization_authorisations SET status = 'revoked', revoked_reason = btrim(p_reason)
   WHERE id = p_id AND status = 'valid' RETURNING * INTO a;
  IF NOT FOUND THEN RAISE EXCEPTION 'authorisations: no valid authorisation with that id' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.org_event(a.organization_id, 'authorisation.revoked', NULL, jsonb_build_object('kind', a.kind, 'reason', p_reason));
  RETURN a;
END $$;


-- ── 5. Who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.set_organization_industry(uuid, text), public.org_has_module(uuid, text),
  public.has_authorisation(uuid, text),
  public.record_organization_authorisation(uuid, text, text, text, date, jsonb),
  public.revoke_organization_authorisation(uuid, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.set_organization_industry(uuid, text), public.org_has_module(uuid, text),
  public.has_authorisation(uuid, text),
  public.record_organization_authorisation(uuid, text, text, text, date, jsonb),
  public.revoke_organization_authorisation(uuid, text)
TO authenticated, service_role;

-- ============================================================================
-- DONE
-- ============================================================================
