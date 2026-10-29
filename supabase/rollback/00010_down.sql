-- ============================================================================
-- Roll back 00010_service_platform.sql
-- ============================================================================
-- Run first (before 00009_down.sql). Tested by run.sh: afterwards the
-- schema is exactly as before 00010.
--
-- DATA LOSS — READ FIRST. Drops the companies' industries, the trade
-- authorisations FlyttGo recorded (export them first: they are evidence),
-- and the plans Website and invoicing, Jobs and Appointments (a company
-- on one of them must be moved to another plan first: the rollback stops
-- otherwise). Members with the role 'staff' become 'viewer'.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.organization_white_label') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.organization_white_label
        WHERE plan_code IN ('website_invoicing', 'jobs', 'appointments')
           OR requested_plan_code IN ('website_invoicing', 'jobs', 'appointments')) THEN
    RAISE EXCEPTION 'companies are on the plans this rollback removes: move them to another plan first';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.revoke_organization_authorisation(uuid, text);
DROP FUNCTION IF EXISTS public.record_organization_authorisation(uuid, text, text, text, date, jsonb);
DROP FUNCTION IF EXISTS public.has_authorisation(uuid, text);
DROP TABLE IF EXISTS public.organization_authorisations;

DROP TRIGGER IF EXISTS guard_booking_transport_plan ON public.bookings;
DROP FUNCTION IF EXISTS public.guard_booking_transport_plan();
DROP FUNCTION IF EXISTS public.org_has_module(uuid, text);

-- white_label_missing as 00009 left it.
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
  IF w.display_name IS NULL THEN m := array_append(m, 'a display name for the page'::text); END IF;
  IF p.own_domain AND (w.custom_domain IS NULL OR w.domain_verified_at IS NULL) THEN m := array_append(m, 'a verified domain'::text); END IF;
  IF p.seller_model = 'company' THEN
    IF o.org_number IS NULL OR NOT o.vat_registered THEN m := array_append(m, 'registration for MVA'::text); END IF;
    IF w.support_email IS NULL OR w.support_phone IS NULL THEN m := array_append(m, 'customer service email and phone'::text); END IF;
    IF w.terms_url IS NULL THEN m := array_append(m, 'your terms (web address)'::text); END IF;
    IF w.privacy_url IS NULL THEN m := array_append(m, 'your privacy notice (web address)'::text); END IF;
    IF w.dpa_version IS DISTINCT FROM public.config_text('white_label_dpa_version') THEN
      m := array_append(m, 'the data processing agreement, accepted by an owner'::text);
    END IF;
    IF w.stripe_account_id IS NULL OR NOT w.stripe_charges_enabled THEN m := array_append(m, 'a connected Stripe account that can take payments'::text); END IF;
  END IF;
  RETURN m;
END $$;

DELETE FROM public.white_label_plans WHERE code IN ('website_invoicing', 'jobs', 'appointments');
ALTER TABLE public.white_label_plans DROP CONSTRAINT IF EXISTS white_label_plans_modules_check;
ALTER TABLE public.white_label_plans
  DROP COLUMN IF EXISTS requires_stripe,
  DROP COLUMN IF EXISTS requires_vat,
  DROP COLUMN IF EXISTS industries,
  DROP COLUMN IF EXISTS modules;

UPDATE public.organization_members SET role = 'viewer' WHERE role = 'staff';
UPDATE public.organization_invitations SET role = 'viewer' WHERE role = 'staff';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_members_role_check'
               AND pg_get_constraintdef(oid) LIKE '%staff%') THEN
    ALTER TABLE public.organization_members DROP CONSTRAINT organization_members_role_check;
    ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_role_check
      CHECK (role IN ('owner', 'admin', 'booker', 'finance', 'viewer'));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_invitations_role_check'
               AND pg_get_constraintdef(oid) LIKE '%staff%') THEN
    ALTER TABLE public.organization_invitations DROP CONSTRAINT organization_invitations_role_check;
    ALTER TABLE public.organization_invitations ADD CONSTRAINT organization_invitations_role_check
      CHECK (role IN ('owner', 'admin', 'booker', 'finance', 'viewer'));
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.set_organization_industry(uuid, text);
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_industry_check;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS industry;

-- ============================================================================
-- DONE
-- ============================================================================
