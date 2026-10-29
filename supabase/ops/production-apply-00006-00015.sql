-- ============================================================================
-- FlyttGo: migrations 00006–00015 as one file, for the production SQL editor
-- ============================================================================
-- Owner's decision 2026-10-29: apply to production. 00002–00005 are already
-- applied there. Run this once in Supabase → FlyttGo Norway → SQL Editor.
-- One transaction: everything is applied, or (on any error) nothing is.
-- Generated from supabase/migrations/00006…00015 without changes.
-- ============================================================================
BEGIN;

-- ===== 00006_launch_decisions.sql =====
-- ============================================================================
-- FlyttGo — launch decisions (2026-10-29)
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00005. Implements the decisions in
-- docs/DECISIONS.md (recommendations of docs/PREDEPLOY_REVIEW.md §4):
--
--   1. Dispatch eligibility comes from the driver's current subscription
--      (plan by plan_id, end date plus a grace period), not from
--      driver_profiles.subscription_active, which nothing maintains.
--      Ranking uses the plan's dispatch_weight (Unlimited 5 … Free 1);
--      production's dispatch_priority runs the other way (Free 5) and
--      gave free drivers the largest boost. Job limits come from the
--      plan's max_job_value (Free: 500 NOK).
--   2. Cancellations record who cancelled and when, so the refund
--      follows the published policy (Terms §6.1, _shared/pricing.ts).
--   3. Vipps money is captured on delivery: an escrow release of an
--      uncaptured Vipps payment waits as 'capture_pending' until
--      process-payment has captured it.
--   4. Organisations: platform administrators read, set status and
--      recover ownership, but do not act as members; a closed
--      organisation no longer blocks deleting its owner; a Norwegian
--      company is activated only after a passed verification
--      (Brønnøysundregistrene, or a manual check an administrator records).
--
-- Safe to re-run.
-- ============================================================================


-- The server itself (service role, or a database session without JWT
-- claims), unlike is_privileged() which also admits administrators.
CREATE OR REPLACE FUNCTION public.is_server()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = ''
      OR coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
$$;
REVOKE ALL ON FUNCTION public.is_server() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_server() TO authenticated, service_role;


-- ── 1. Subscriptions and dispatch eligibility ──────────────────────────────

-- Grace after a plan's end date, in hours, per billing period. Absent:
-- monthly 24, everything else 0.
INSERT INTO public.platform_config (config_key, config_value)
SELECT k, v FROM (VALUES ('subscription_grace_hours_monthly', '24'), ('subscription_grace_hours_daily', '0')) AS c(k, v)
 WHERE NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = c.k);

-- Production already has these values; the repository schema seeds no
-- plans, so this changes nothing there either.
UPDATE public.subscription_plans SET max_job_value = 500
 WHERE public.plan_slug(name) = 'free' AND max_job_value IS NULL;

CREATE OR REPLACE FUNCTION public.subscription_grace(p_billing text)
RETURNS interval
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT make_interval(hours => coalesce(
    (SELECT nullif(config_value, '')::int FROM public.platform_config
      WHERE config_key = 'subscription_grace_hours_' || coalesce(p_billing, 'none')),
    CASE WHEN p_billing = 'monthly' THEN 24 ELSE 0 END));
$$;

-- The plan a driver (auth user id) works under now: their newest active
-- subscription that has not run out (end date + grace), else Free.
CREATE OR REPLACE FUNCTION public.driver_current_plan(p_user uuid)
RETURNS TABLE (plan_id uuid, plan_name text, slug text, dispatch_weight integer,
               dispatch_priority integer, max_job_value numeric, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM (
    SELECT sp.id, sp.name, public.plan_slug(sp.name), coalesce(sp.dispatch_weight, 1),
           sp.dispatch_priority, sp.max_job_value::numeric, ds.end_date
      FROM public.driver_subscriptions ds
      JOIN public.subscription_plans sp ON sp.id = ds.plan_id
     WHERE ds.driver_id = p_user AND ds.subscription_status = 'active'
       AND (ds.end_date IS NULL OR ds.end_date + public.subscription_grace(sp.billing_period) > now())
     ORDER BY ds.start_date DESC NULLS LAST, ds.created_at DESC NULLS LAST
     LIMIT 1) cur
  UNION ALL
  SELECT sp.id, sp.name, 'free', coalesce(sp.dispatch_weight, 1), sp.dispatch_priority, sp.max_job_value::numeric, NULL
    FROM public.subscription_plans sp
   WHERE public.plan_slug(sp.name) = 'free'
     AND NOT EXISTS (
       SELECT 1 FROM public.driver_subscriptions ds JOIN public.subscription_plans sp2 ON sp2.id = ds.plan_id
        WHERE ds.driver_id = p_user AND ds.subscription_status = 'active'
          AND (ds.end_date IS NULL OR ds.end_date + public.subscription_grace(sp2.billing_period) > now()))
   LIMIT 1;
$$;

-- Lapsed subscriptions (end date + grace passed) become 'expired' and the
-- driver moves to Free. A driver may run it for themselves (the portal);
-- the server or the cron runs it for everyone (p_driver NULL).
CREATE OR REPLACE FUNCTION public.expire_lapsed_subscriptions(p_driver uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record; n integer := 0;
BEGIN
  IF NOT public.is_privileged() AND (p_driver IS NULL OR p_driver IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'expire_lapsed_subscriptions: only your own' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT ds.id, ds.driver_id FROM public.driver_subscriptions ds
      JOIN public.subscription_plans sp ON sp.id = ds.plan_id
     WHERE ds.subscription_status = 'active' AND ds.end_date IS NOT NULL
       AND ds.end_date + public.subscription_grace(sp.billing_period) <= now()
       AND (p_driver IS NULL OR ds.driver_id = p_driver)
  LOOP
    PERFORM set_config('flyttgo.trusted', 'on', true);
    UPDATE public.driver_subscriptions SET subscription_status = 'expired' WHERE id = r.id;
    PERFORM set_config('flyttgo.trusted', 'off', true);
    PERFORM public.change_driver_subscription(r.driver_id, 'free');
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Dispatch ranking, the same output and scoring as before, except:
-- eligibility from driver_current_plan (no subscription_active), the
-- plan's job limit applied, and the plan's weight (higher plan, higher
-- score) in place of production's inverted dispatch_priority.
CREATE OR REPLACE FUNCTION public.dispatch_rank_candidates(p_booking_id uuid)
RETURNS TABLE (
  driver_id uuid, driver_user_id uuid, full_name text,
  distance_km numeric, score numeric, rating numeric,
  acceptance_rate numeric, cancellation_rate numeric, trust_score numeric,
  plan_name text, dispatch_priority integer, active_jobs integer, same_city boolean
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH booking AS (
    SELECT id, customer_id, pickup_lat, pickup_lng, pickup_city, van_type, price_estimate
      FROM public.bookings WHERE id = p_booking_id
  ),
  candidates AS (
    SELECT dp.id AS driver_id, dp.user_id AS driver_user_id, dp.full_name,
           dp.city AS driver_city, dp.rating, dp.acceptance_rate,
           dp.cancellation_rate, dp.trust_score,
           dp.van_size AS driver_van_size, dp.vehicle_type AS driver_vehicle_type,
           dl.lat AS driver_lat, dl.lng AS driver_lng,
           cp.plan_name, cp.dispatch_priority, cp.dispatch_weight, cp.max_job_value,
           (SELECT COUNT(*) FROM public.bookings b2
             WHERE b2.driver_id = dp.id
               AND b2.status IN ('driver_assigned','pickup_arrived','loading','in_transit'))::int AS active_jobs
      FROM public.driver_profiles dp
      JOIN LATERAL (
        SELECT dl2.lat, dl2.lng FROM public.driver_locations dl2
         WHERE dl2.driver_id = dp.user_id ORDER BY dl2.updated_at DESC LIMIT 1
      ) dl ON true
      JOIN LATERAL public.driver_current_plan(dp.user_id) cp ON true
     WHERE dp.online = true AND dp.status = 'approved'
  )
  SELECT c.driver_id, c.driver_user_id, c.full_name,
    public.haversine_km(c.driver_lat, c.driver_lng, (SELECT pickup_lat FROM booking), (SELECT pickup_lng FROM booking)) AS distance_km,
    ((40 / GREATEST(public.haversine_km(c.driver_lat, c.driver_lng, (SELECT pickup_lat FROM booking), (SELECT pickup_lng FROM booking)), 0.5))
      + (COALESCE(c.rating, 4.5) * 20) + (COALESCE(c.dispatch_weight, 1) * 15)
      + (COALESCE(c.acceptance_rate, 0.9) * 10) + (COALESCE(c.trust_score, 0.5) * 10)
      - (COALESCE(c.cancellation_rate, 0) * 15) - (c.active_jobs * 5)
      + CASE WHEN c.driver_city IS NOT NULL AND (SELECT pickup_city FROM booking) IS NOT NULL
             AND LOWER(c.driver_city) = LOWER((SELECT pickup_city FROM booking)) THEN 8 ELSE 0 END
    )::numeric AS score,
    c.rating, c.acceptance_rate, c.cancellation_rate, c.trust_score,
    c.plan_name, c.dispatch_priority, c.active_jobs,
    (c.driver_city IS NOT NULL AND (SELECT pickup_city FROM booking) IS NOT NULL
      AND LOWER(c.driver_city) = LOWER((SELECT pickup_city FROM booking))) AS same_city
  FROM candidates c
  WHERE public.haversine_km(c.driver_lat, c.driver_lng, (SELECT pickup_lat FROM booking), (SELECT pickup_lng FROM booking)) <= 15
    AND ((SELECT van_type FROM booking) IS NULL OR c.driver_van_size = (SELECT van_type FROM booking)
         OR c.driver_vehicle_type = (SELECT van_type FROM booking) OR c.driver_van_size IS NULL)
    AND (c.max_job_value IS NULL OR coalesce((SELECT price_estimate FROM booking), 0) <= c.max_job_value)
    AND c.driver_user_id IS DISTINCT FROM (SELECT customer_id FROM booking)
  ORDER BY score DESC LIMIT 10;
$$;

-- claim_job: the job limit is the current plan's.
CREATE OR REPLACE FUNCTION public.claim_job(p_booking_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_driver uuid := public.my_driver_id();
  v_limit  numeric;
  v_plan   text;
  v_price  numeric;
BEGIN
  IF v_driver IS NULL OR NOT public.is_approved_driver() THEN
    RAISE EXCEPTION 'claim_job: approved drivers only' USING ERRCODE = '42501';
  END IF;
  SELECT price_estimate INTO v_price FROM public.bookings WHERE id = p_booking_id;
  SELECT max_job_value, plan_name INTO v_limit, v_plan FROM public.driver_current_plan(auth.uid());
  IF v_limit IS NOT NULL AND coalesce(v_price, 0) > v_limit THEN
    RAISE EXCEPTION 'claim_job: the % plan takes jobs up to % NOK', coalesce(v_plan, 'Free'), v_limit USING ERRCODE = '42501';
  END IF;
  UPDATE public.bookings
     SET driver_id = v_driver, status = 'driver_assigned'
   WHERE id = p_booking_id AND driver_id IS NULL
     AND status IN ('pending', 'confirmed') AND payment_status IN ('paid', 'escrow');
  RETURN FOUND;
END;
$$;

-- The pool shows only jobs the driver's plan can take.
CREATE OR REPLACE FUNCTION public.driver_job_pool()
RETURNS TABLE (
  id uuid, status text, pickup_address text, dropoff_address text,
  pickup_city text, dropoff_city text, pickup_postcode text, dropoff_postcode text,
  pickup_lat numeric, pickup_lng numeric, dropoff_lat numeric, dropoff_lng numeric,
  move_date timestamptz, move_time time, move_type text, van_type text, helpers integer,
  items jsonb, additional_services jsonb, distance_km numeric, estimated_hours numeric,
  price_estimate numeric, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT b.id, b.status,
         nullif(concat_ws(' ', b.pickup_postcode, b.pickup_city), ''),
         nullif(concat_ws(' ', b.dropoff_postcode, b.dropoff_city), ''),
         b.pickup_city, b.dropoff_city, b.pickup_postcode, b.dropoff_postcode,
         round(b.pickup_lat, 2), round(b.pickup_lng, 2), round(b.dropoff_lat, 2), round(b.dropoff_lng, 2),
         b.move_date, b.move_time, b.move_type, b.van_type, b.helpers,
         b.items, b.additional_services, b.distance_km, b.estimated_hours,
         b.price_estimate, b.created_at
    FROM public.bookings b
   WHERE public.is_approved_driver()
     AND b.driver_id IS NULL
     AND b.status IN ('pending', 'confirmed')
     AND b.payment_status IN ('paid', 'escrow')
     AND b.customer_id IS DISTINCT FROM auth.uid()
     AND coalesce(b.price_estimate, 0) <= coalesce((SELECT max_job_value FROM public.driver_current_plan(auth.uid())), 'infinity')
   ORDER BY b.move_date NULLS LAST, b.created_at;
$$;

REVOKE ALL ON FUNCTION public.subscription_grace(text), public.driver_current_plan(uuid),
  public.expire_lapsed_subscriptions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.subscription_grace(text), public.driver_current_plan(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_grace(text), public.driver_current_plan(uuid),
  public.expire_lapsed_subscriptions(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_lapsed_subscriptions(uuid) TO authenticated;


-- ── 2. Cancellations: who and when ─────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by        text,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_cancelled_by_check'
                  AND conrelid = 'public.bookings'::regclass) THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_cancelled_by_check
      CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'driver', 'platform'));
  END IF;
END $$;

-- Stamped by the database, never by the caller: the customer of the
-- booking, its driver, or otherwise the platform (an administrator or
-- the server, who may name 'driver' when a driver withdrew).
CREATE OR REPLACE FUNCTION public.stamp_booking_cancellation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    NEW.cancelled_at := now();
    NEW.cancelled_by := CASE
      WHEN auth.uid() IS NOT NULL AND auth.uid() = OLD.customer_id THEN 'customer'
      WHEN OLD.driver_id IS NOT NULL AND OLD.driver_id = public.my_driver_id() THEN 'driver'
      WHEN public.is_privileged() AND NEW.cancelled_by IN ('driver', 'platform') THEN NEW.cancelled_by
      ELSE 'platform' END;
  ELSIF NEW.status IS DISTINCT FROM 'cancelled' THEN
    NEW.cancelled_at := OLD.cancelled_at;
    NEW.cancelled_by := OLD.cancelled_by;
  ELSE
    NEW.cancelled_at := OLD.cancelled_at;                 -- already cancelled: unchanged
    NEW.cancelled_by := OLD.cancelled_by;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stamp_booking_cancellation ON public.bookings;
CREATE TRIGGER stamp_booking_cancellation
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_booking_cancellation();


-- ── 3. Capture before release ──────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS captured_at     timestamptz,
  ADD COLUMN IF NOT EXISTS captured_amount numeric;

-- Stripe Checkout captures at payment; mark what is already paid by card.
UPDATE public.bookings SET captured_at = coalesce(paid_at, now()), captured_amount = paid_amount
 WHERE payment_provider = 'stripe' AND paid_amount IS NOT NULL AND captured_at IS NULL;

-- A release of an uncaptured Vipps payment waits for the capture. Every
-- release path (production's confirmation trigger, process-payment,
-- admin_release_escrow) goes through this. Payments without a provider
-- (made before 00004) are not held: they cannot be captured.
CREATE OR REPLACE FUNCTION public.hold_release_until_capture()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'released' AND OLD.status IS DISTINCT FROM 'released'
     AND EXISTS (SELECT 1 FROM public.bookings b
                  WHERE b.id = NEW.booking_id AND b.payment_provider = 'vipps' AND b.captured_at IS NULL) THEN
    NEW.status      := 'capture_pending';
    NEW.released_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hold_release_until_capture ON public.escrow_payments;
CREATE TRIGGER hold_release_until_capture
  BEFORE UPDATE ON public.escrow_payments
  FOR EACH ROW EXECUTE FUNCTION public.hold_release_until_capture();

-- process-payment records a capture Vipps confirmed. Once; the amount is
-- the provider's.
CREATE OR REPLACE FUNCTION public.payment_capture_mark(p_booking_id uuid, p_amount numeric)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_at timestamptz;
BEGIN
  IF NOT public.is_server() THEN
    RAISE EXCEPTION 'payment_capture_mark: server only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.bookings SET captured_at = coalesce(captured_at, now()), captured_amount = coalesce(captured_amount, p_amount)
   WHERE id = p_booking_id RETURNING captured_at INTO v_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking not found' USING ERRCODE = 'P0002'; END IF;
  RETURN v_at;
END $$;

-- Admin release: as 00003, but a Vipps payment must be captured first
-- (process-payment, action 'capture').
CREATE OR REPLACE FUNCTION public.admin_release_escrow(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_amount  numeric;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_release_escrow: administrators only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF v_booking.driver_id IS NULL THEN RAISE EXCEPTION 'booking has no driver'; END IF;
  IF v_booking.payment_status IN ('released', 'refunded')
     OR EXISTS (SELECT 1 FROM public.escrow_payments WHERE booking_id = p_booking_id
                 AND (status = 'refunded' OR (status = 'released' AND driver_earning IS NOT NULL))) THEN
    RAISE EXCEPTION 'escrow already settled (payment_status %)', v_booking.payment_status;
  END IF;
  IF coalesce(v_booking.payment_status, 'pending') NOT IN ('paid', 'escrow') THEN
    RAISE EXCEPTION 'no captured payment to release (payment_status %)', v_booking.payment_status;
  END IF;
  IF v_booking.payment_provider = 'vipps' AND v_booking.captured_at IS NULL THEN
    RAISE EXCEPTION 'the Vipps payment is reserved, not captured: capture it first' USING ERRCODE = '55000';
  END IF;
  v_amount := coalesce(v_booking.price_estimate, 0);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'booking has no price to release'; END IF;

  UPDATE public.escrow_payments
     SET status = 'released', released_at = now(), driver_earning = v_amount, commission_amount = 0
   WHERE booking_id = p_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking has no escrow row'; END IF;
  UPDATE public.bookings SET payment_status = 'released' WHERE id = p_booking_id;
  RETURN jsonb_build_object('released', v_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.payment_capture_mark(uuid, numeric), public.hold_release_until_capture(),
  public.stamp_booking_cancellation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_capture_mark(uuid, numeric) TO service_role;


-- ── 4. Organisations ───────────────────────────────────────────────────────

-- Company roles only: a platform administrator is not a member.
CREATE OR REPLACE FUNCTION public.require_org_role(p_org uuid, p_roles text[])
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_role text := public.org_role(p_org);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501';
  END IF;
  IF v_role = ANY (p_roles) THEN RETURN v_role; END IF;
  RAISE EXCEPTION 'organisation: requires role %', array_to_string(p_roles, ' or ') USING ERRCODE = '42501';
END $$;

-- A closed organisation no longer needs an owner (so its last owner's
-- account can be deleted).
CREATE OR REPLACE FUNCTION public.guard_last_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'owner' AND OLD.status = 'active'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.status <> 'active')
     AND EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id AND status <> 'closed')
     AND NOT EXISTS (SELECT 1 FROM public.organization_members
                      WHERE organization_id = OLD.organization_id AND user_id <> OLD.user_id
                        AND role = 'owner' AND status = 'active') THEN
    RAISE EXCEPTION 'organisation: the last owner cannot be removed or changed (transfer ownership or close the organisation first)'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- Recovery: a platform administrator makes a person an owner (for
-- example when the only owner has left the company). Recorded.
CREATE OR REPLACE FUNCTION public.admin_transfer_ownership(p_org uuid, p_user uuid, p_reason text)
RETURNS public.organization_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_member public.organization_members%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'organisation ownership: platform administrators only' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'organisation ownership: a reason is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org) THEN
    RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.organization_members (organization_id, user_id, role, invited_by)
  VALUES (p_org, p_user, 'owner', auth.uid())
  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner', status = 'active', updated_at = now()
  RETURNING * INTO v_member;
  PERFORM public.org_event(p_org, 'member.owner_restored', p_user, jsonb_build_object('reason', p_reason));
  RETURN v_member;
END $$;

-- Evidence that a company is who it says it is, kept with the result.
CREATE TABLE IF NOT EXISTS public.organization_verifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  source          text        NOT NULL CHECK (source IN ('brreg', 'manual')),
  org_number      text,
  passed          boolean     NOT NULL,
  findings        jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- what was checked and seen
  checked_by      uuid,
  checked_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_verifications_org_idx
  ON public.organization_verifications (organization_id, checked_at DESC);
ALTER TABLE public.organization_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_verifications_select ON public.organization_verifications;
CREATE POLICY organization_verifications_select ON public.organization_verifications
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, ARRAY['owner', 'admin']) OR public.is_admin());
REVOKE ALL ON public.organization_verifications FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organization_verifications FROM authenticated;
GRANT SELECT ON public.organization_verifications TO authenticated;
GRANT ALL ON public.organization_verifications TO service_role;

-- The verify-organization function records a registry check (server);
-- an administrator records a manual check (for example a signed form
-- for a company outside the registry), with what they saw.
CREATE OR REPLACE FUNCTION public.record_organization_verification(
  p_org uuid, p_source text, p_passed boolean, p_findings jsonb)
RETURNS public.organization_verifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v public.organization_verifications%ROWTYPE; v_number text;
BEGIN
  IF p_source = 'brreg' AND NOT public.is_server() THEN
    RAISE EXCEPTION 'registry checks are recorded by the server' USING ERRCODE = '42501';
  END IF;
  IF p_source = 'manual' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'manual checks are recorded by platform administrators' USING ERRCODE = '42501';
  END IF;
  IF p_source = 'manual' AND coalesce(btrim(p_findings ->> 'evidence'), '') = '' THEN
    RAISE EXCEPTION 'a manual check needs its evidence' USING ERRCODE = '22023';
  END IF;
  SELECT org_number INTO v_number FROM public.organizations WHERE id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.organization_verifications (organization_id, source, org_number, passed, findings, checked_by)
  VALUES (p_org, p_source, v_number, p_passed, coalesce(p_findings, '{}'::jsonb), auth.uid())
  RETURNING * INTO v;
  PERFORM public.org_event(p_org, 'organization.verification', NULL,
                           jsonb_build_object('source', p_source, 'passed', p_passed));
  RETURN v;
END $$;

-- Activation needs a passed check of the current organisation number, at
-- most 30 days old: the registry for a Norwegian company (verify-
-- organization), or a manual check recorded by an administrator.
CREATE OR REPLACE FUNCTION public.admin_set_organization_status(p_org uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS public.organizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org public.organizations%ROWTYPE; v_old text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'organisation status: platform administrators only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_org FROM public.organizations WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'P0002'; END IF;
  v_old := v_org.status;
  IF p_status = 'active' AND v_old <> 'active' AND NOT EXISTS (
       SELECT 1 FROM public.organization_verifications ov
        WHERE ov.organization_id = p_org AND ov.passed
          AND ov.checked_at > now() - interval '30 days'
          AND ov.org_number IS NOT DISTINCT FROM v_org.org_number) THEN
    RAISE EXCEPTION 'organisation: verify the company before activating it' USING ERRCODE = '55000';
  END IF;
  UPDATE public.organizations SET status = p_status, status_reason = p_reason, updated_at = now()
   WHERE id = p_org RETURNING * INTO v_org;
  PERFORM public.org_event(p_org, 'organization.status', NULL,
                           jsonb_build_object('from', v_old, 'to', p_status, 'reason', p_reason));
  RETURN v_org;
END $$;

REVOKE ALL ON FUNCTION public.admin_transfer_ownership(uuid, uuid, text),
  public.record_organization_verification(uuid, text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_transfer_ownership(uuid, uuid, text),
  public.record_organization_verification(uuid, text, boolean, jsonb) TO authenticated, service_role;

-- ============================================================================
-- DONE
-- ============================================================================


-- ===== 00007_company_bookings.sql =====
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


-- ===== 00008_invoicing.sql =====
-- ============================================================================
-- FlyttGo — invoicing (step 5 of the corporate plan)
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00007. Decided 2026-10-29
-- (docs/INVOICING.md): FlyttGo issues the invoices itself, with its own
-- invoice system.
--
--   * Invoices follow bokføringsforskriften:
--       - a sequential number without gaps, given when the invoice is issued;
--       - seller and buyer with organisation numbers, invoice date, delivery
--         date or period, lines with quantity, price and VAT per rate, totals,
--         due date, bank account and KID;
--       - an issued invoice is never changed or deleted; corrections are
--         credit notes.
--   * Company bookings can be paid on invoice ('book-on-invoice'). The
--     price is the server's; the company must be active, have invoicing
--     switched on by FlyttGo, be within its credit limit and, when the
--     admin setting "credit_check_enabled" is on, have a passed credit
--     check.
--   * Each company chooses its payment terms: 14 or 30 days, any number of
--     days up to 60, or a fixed day of the following month. It also chooses
--     to be invoiced per booking or once a month (samlefaktura).
--   * Companies on the special price plan get their registered name and
--     logo on their invoices.
--   * Payments are recorded by hand or matched by KID from a bank file. A
--     reminder (purring) carries the fee and interest set in the admin
--     settings. Every step goes to invoice_events.
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Settings (platform_config, admin only) ───────────────────────────────
-- The seller's legal details are FlyttGo's and must be filled in before
-- the first invoice can be issued (issue_invoice refuses otherwise).
INSERT INTO public.platform_config (config_key, config_value)
SELECT k, v FROM (VALUES
  ('invoice_seller_name', ''), ('invoice_seller_org_number', ''), ('invoice_seller_vat_registered', 'true'),
  ('invoice_seller_address', ''), ('invoice_seller_postcode_city', ''), ('invoice_seller_email', ''),
  ('invoice_seller_phone', ''), ('invoice_seller_bank_account', ''), ('invoice_seller_iban', ''), ('invoice_seller_bic', ''),
  ('invoice_reminder_after_days', '7'), ('invoice_reminder_fee', '0'), ('invoice_late_interest_pct', ''),
  ('credit_check_enabled', 'false'), ('credit_check_max_age_days', '365'), ('credit_check_provider', 'manual')
) AS c(k, v)
WHERE NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = c.k);

CREATE OR REPLACE FUNCTION public.config_text(p_key text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT nullif(btrim(config_value), '') FROM public.platform_config WHERE config_key = p_key; $$;


-- ── 2. Companies: billing terms, invoicing, plan, logo ──────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS payment_terms_type   text    NOT NULL DEFAULT 'days',
  ADD COLUMN IF NOT EXISTS payment_terms_days   integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS payment_terms_day    integer,
  ADD COLUMN IF NOT EXISTS invoice_cycle        text    NOT NULL DEFAULT 'per_booking',
  ADD COLUMN IF NOT EXISTS invoice_reference    text,
  ADD COLUMN IF NOT EXISTS invoicing_enabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_limit         numeric,
  ADD COLUMN IF NOT EXISTS billing_plan         text    NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS logo_path            text,
  ADD COLUMN IF NOT EXISTS customer_number      bigint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_billing_terms_check') THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_billing_terms_check CHECK (
          payment_terms_type IN ('days', 'day_of_month')
      AND payment_terms_days BETWEEN 1 AND 60
      AND (payment_terms_day IS NULL OR payment_terms_day BETWEEN 1 AND 28)
      AND (payment_terms_type <> 'day_of_month' OR payment_terms_day IS NOT NULL)
      AND invoice_cycle IN ('per_booking', 'monthly')
      AND billing_plan IN ('standard', 'special')
      AND (credit_limit IS NULL OR credit_limit >= 0));
  END IF;
END $$;
CREATE SEQUENCE IF NOT EXISTS public.organization_customer_number_seq START 10001;
UPDATE public.organizations SET customer_number = nextval('public.organization_customer_number_seq') WHERE customer_number IS NULL;
ALTER TABLE public.organizations ALTER COLUMN customer_number SET DEFAULT nextval('public.organization_customer_number_seq');
CREATE UNIQUE INDEX IF NOT EXISTS organizations_customer_number_key ON public.organizations (customer_number);

-- The company chooses its terms and cycle (owner, admin, finance).
CREATE OR REPLACE FUNCTION public.set_billing_preferences(
  p_org uuid, p_terms_type text, p_terms_days integer, p_terms_day integer, p_cycle text, p_reference text)
RETURNS public.organizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org public.organizations%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'finance']);
  UPDATE public.organizations SET
    payment_terms_type = p_terms_type,
    payment_terms_days = coalesce(p_terms_days, payment_terms_days),
    payment_terms_day  = CASE WHEN p_terms_type = 'day_of_month' THEN p_terms_day ELSE NULL END,
    invoice_cycle      = p_cycle,
    invoice_reference  = nullif(btrim(coalesce(p_reference, '')), ''),
    updated_at         = now()
   WHERE id = p_org RETURNING * INTO v_org;
  PERFORM public.org_event(p_org, 'billing.preferences', NULL, jsonb_build_object(
    'terms_type', p_terms_type, 'terms_days', p_terms_days, 'terms_day', p_terms_day, 'cycle', p_cycle));
  RETURN v_org;
END $$;

-- FlyttGo switches invoicing on, sets the credit limit and the plan.
CREATE OR REPLACE FUNCTION public.admin_set_invoicing(p_org uuid, p_enabled boolean, p_credit_limit numeric, p_plan text)
RETURNS public.organizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org public.organizations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'invoicing: platform administrators only' USING ERRCODE = '42501';
  END IF;
  IF p_enabled AND public.config_text('credit_check_enabled') = 'true'
     AND NOT public.has_current_credit_check(p_org) THEN
    RAISE EXCEPTION 'invoicing: a passed credit check is required (the admin setting is on)' USING ERRCODE = '55000';
  END IF;
  UPDATE public.organizations SET invoicing_enabled = p_enabled, credit_limit = p_credit_limit,
         billing_plan = coalesce(p_plan, billing_plan), updated_at = now()
   WHERE id = p_org RETURNING * INTO v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.org_event(p_org, 'billing.invoicing', NULL,
    jsonb_build_object('enabled', p_enabled, 'credit_limit', p_credit_limit, 'plan', v_org.billing_plan));
  RETURN v_org;
END $$;

-- Logo: owners and admins upload it; it is used on invoices only on the
-- special plan. PNG or JPEG, under the company's own folder.
CREATE OR REPLACE FUNCTION public.org_folder_member(p_name text, p_roles text[] DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_folder text := split_part(coalesce(p_name, ''), '/', 1);
BEGIN
  IF v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  RETURN public.is_org_member(v_folder::uuid, p_roles);
END $$;
REVOKE ALL ON FUNCTION public.org_folder_member(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_folder_member(text, text[]) TO authenticated, service_role;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'organization-logos', 'organization-logos', false, 1048576, ARRAY['image/png', 'image/jpeg']
 WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'organization-logos');
DROP POLICY IF EXISTS organization_logos_read ON storage.objects;
CREATE POLICY organization_logos_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'organization-logos'
         AND (public.is_admin() OR public.org_folder_member(name)));
DROP POLICY IF EXISTS organization_logos_write ON storage.objects;
CREATE POLICY organization_logos_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'organization-logos'
              AND public.org_folder_member(name, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS organization_logos_update ON storage.objects;
CREATE POLICY organization_logos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'organization-logos'
         AND public.org_folder_member(name, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS organization_logos_delete ON storage.objects;
CREATE POLICY organization_logos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'organization-logos'
         AND public.org_folder_member(name, ARRAY['owner', 'admin']));

CREATE OR REPLACE FUNCTION public.set_organization_logo(p_org uuid, p_path text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  IF p_path IS NOT NULL AND split_part(p_path, '/', 1) <> p_org::text THEN
    RAISE EXCEPTION 'logo must be in the company''s own folder' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organizations SET logo_path = p_path, updated_at = now() WHERE id = p_org;
  PERFORM public.org_event(p_org, 'organization.logo', NULL, jsonb_build_object('path', p_path));
END $$;


-- ── 3. Credit checks (behind the admin setting) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_checks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  provider          text        NOT NULL,               -- 'manual' or a provider's name
  passed            boolean     NOT NULL,
  score             text,
  recommended_limit numeric,
  findings          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  checked_by        uuid,
  checked_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_checks_org_idx ON public.credit_checks (organization_id, checked_at DESC);
ALTER TABLE public.credit_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_checks_admin_select ON public.credit_checks;
CREATE POLICY credit_checks_admin_select ON public.credit_checks FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.credit_checks FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.credit_checks FROM authenticated;
GRANT SELECT ON public.credit_checks TO authenticated;
GRANT ALL ON public.credit_checks TO service_role;

CREATE OR REPLACE FUNCTION public.has_current_credit_check(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.credit_checks
                  WHERE organization_id = p_org AND passed
                    AND checked_at > now() - make_interval(days => coalesce(public.config_text('credit_check_max_age_days')::int, 365)));
$$;

-- A provider's result (the credit-check function, server) or an
-- administrator's manual assessment with its evidence.
CREATE OR REPLACE FUNCTION public.record_credit_check(
  p_org uuid, p_provider text, p_passed boolean, p_score text, p_recommended_limit numeric, p_findings jsonb)
RETURNS public.credit_checks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v public.credit_checks%ROWTYPE;
BEGIN
  IF p_provider = 'manual' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'credit checks: platform administrators only' USING ERRCODE = '42501';
  END IF;
  IF p_provider <> 'manual' AND NOT public.is_server() THEN
    RAISE EXCEPTION 'provider credit checks are recorded by the server' USING ERRCODE = '42501';
  END IF;
  IF p_provider = 'manual' AND coalesce(btrim(p_findings ->> 'evidence'), '') = '' THEN
    RAISE EXCEPTION 'a manual credit check needs its evidence' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.credit_checks (organization_id, provider, passed, score, recommended_limit, findings, checked_by)
  VALUES (p_org, p_provider, p_passed, p_score, p_recommended_limit, coalesce(p_findings, '{}'::jsonb), auth.uid())
  RETURNING * INTO v;
  PERFORM public.org_event(p_org, 'billing.credit_check', NULL, jsonb_build_object('provider', p_provider, 'passed', p_passed));
  RETURN v;
END $$;


-- ── 4. Invoices ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_counters (series text PRIMARY KEY, next_number bigint NOT NULL);
INSERT INTO public.invoice_counters (series, next_number) VALUES ('main', 1) ON CONFLICT DO NOTHING;
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_counters FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.invoices (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text        NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'credit_note')),
  number             bigint      UNIQUE,                  -- given at issue, never reused
  credits_invoice_id uuid        REFERENCES public.invoices (id),
  organization_id    uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  status             text        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'credited')),
  issue_date         date,
  delivery_from      date,
  delivery_to        date,
  due_date           date,
  currency           text        NOT NULL DEFAULT 'NOK',
  kid                text,
  buyer              jsonb,                               -- snapshot at issue
  seller             jsonb,                               -- snapshot at issue
  branding           jsonb,                               -- name + logo on the special plan
  reference          text,                                -- the buyer's reference ("Deres ref.")
  notes              text,
  net_total          numeric     NOT NULL DEFAULT 0,
  vat_total          numeric     NOT NULL DEFAULT 0,
  total              numeric     NOT NULL DEFAULT 0,
  amount_paid        numeric     NOT NULL DEFAULT 0,
  amount_credited    numeric     NOT NULL DEFAULT 0,
  fees_total         numeric     NOT NULL DEFAULT 0,      -- reminder fees and interest
  reminder_level     integer     NOT NULL DEFAULT 0,
  sent_at            timestamptz,
  created_by         uuid,
  issued_by          uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_issued_complete CHECK (status = 'draft' OR (number IS NOT NULL AND issue_date IS NOT NULL
                                             AND due_date IS NOT NULL AND seller IS NOT NULL AND buyer IS NOT NULL)),
  CONSTRAINT invoices_credit_note_link CHECK ((kind = 'credit_note') = (credits_invoice_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS invoices_org_idx ON public.invoices (organization_id, issue_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_kid_key ON public.invoices (kid) WHERE kid IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_lines (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid    NOT NULL REFERENCES public.invoices (id) ON DELETE CASCADE,
  line_no     integer NOT NULL,
  booking_id  uuid    REFERENCES public.bookings (id),
  is_credit   boolean NOT NULL DEFAULT false,
  description text    NOT NULL,
  quantity    numeric NOT NULL DEFAULT 1,
  unit_price  numeric NOT NULL,                 -- excluding VAT
  vat_rate    numeric NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 12, 15, 25)),
  net_amount  numeric NOT NULL,
  vat_amount  numeric NOT NULL,
  total       numeric NOT NULL,
  UNIQUE (invoice_id, line_no)
);
-- A booking is charged on one invoice only.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_lines_booking_once
  ON public.invoice_lines (booking_id) WHERE booking_id IS NOT NULL AND NOT is_credit;

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid        NOT NULL REFERENCES public.invoices (id),
  amount      numeric     NOT NULL CHECK (amount > 0),
  paid_on     date        NOT NULL,
  method      text        NOT NULL CHECK (method IN ('bank', 'card', 'vipps', 'other')),
  reference   text,
  recorded_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- A bank transaction is recorded once.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_bank_reference_once
  ON public.invoice_payments (reference) WHERE method = 'bank' AND reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_reminders (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid        NOT NULL REFERENCES public.invoices (id),
  level      integer     NOT NULL,
  fee        numeric     NOT NULL DEFAULT 0,
  interest   numeric     NOT NULL DEFAULT 0,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, level)
);

CREATE TABLE IF NOT EXISTS public.invoice_events (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id uuid        NOT NULL REFERENCES public.invoices (id),
  actor_id   uuid,
  action     text        NOT NULL,
  details    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_events_invoice_idx ON public.invoice_events (invoice_id, created_at);

-- Who sees invoices: the company's owners, admins and finance, and
-- platform administrators. Nobody writes the tables directly.
ALTER TABLE public.invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_events    ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_read_invoice(p_invoice uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.id = p_invoice AND i.status <> 'draft'
       AND public.is_org_member(i.organization_id, ARRAY['owner', 'admin', 'finance']));
$$;

DROP POLICY IF EXISTS invoices_select ON public.invoices;
CREATE POLICY invoices_select ON public.invoices FOR SELECT TO authenticated USING (public.can_read_invoice(id));
DROP POLICY IF EXISTS invoice_lines_select ON public.invoice_lines;
CREATE POLICY invoice_lines_select ON public.invoice_lines FOR SELECT TO authenticated USING (public.can_read_invoice(invoice_id));
DROP POLICY IF EXISTS invoice_payments_select ON public.invoice_payments;
CREATE POLICY invoice_payments_select ON public.invoice_payments FOR SELECT TO authenticated USING (public.can_read_invoice(invoice_id));
DROP POLICY IF EXISTS invoice_reminders_select ON public.invoice_reminders;
CREATE POLICY invoice_reminders_select ON public.invoice_reminders FOR SELECT TO authenticated USING (public.can_read_invoice(invoice_id));
DROP POLICY IF EXISTS invoice_events_select ON public.invoice_events;
CREATE POLICY invoice_events_select ON public.invoice_events FOR SELECT TO authenticated USING (public.is_admin());

REVOKE ALL ON public.invoices, public.invoice_lines, public.invoice_payments, public.invoice_reminders,
  public.invoice_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.invoices, public.invoice_lines, public.invoice_payments,
  public.invoice_reminders, public.invoice_events FROM authenticated;
GRANT SELECT ON public.invoices, public.invoice_lines, public.invoice_payments, public.invoice_reminders,
  public.invoice_events TO authenticated;
GRANT ALL ON public.invoices, public.invoice_lines, public.invoice_payments, public.invoice_reminders,
  public.invoice_events, public.invoice_counters TO service_role;

-- An issued invoice is final, for every role (the database owner too):
-- only its payment state and dispatch marks move. Lines change only on
-- drafts; issued invoices, their payments and events are never deleted.
CREATE OR REPLACE FUNCTION public.guard_invoice_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_changed text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'an issued invoice is never deleted; issue a credit note' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  v_changed := public.changed_columns(to_jsonb(OLD), to_jsonb(NEW),
    ARRAY['status', 'amount_paid', 'amount_credited', 'fees_total', 'reminder_level', 'sent_at', 'updated_at']);
  IF cardinality(v_changed) > 0 THEN
    RAISE EXCEPTION 'an issued invoice cannot be changed (%); issue a credit note', array_to_string(v_changed, ', ') USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'draft' THEN RAISE EXCEPTION 'an issued invoice cannot go back to draft' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_invoice_write ON public.invoices;
CREATE TRIGGER guard_invoice_write BEFORE UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_write();

CREATE OR REPLACE FUNCTION public.guard_invoice_line_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
BEGIN
  -- Deleting a draft invoice cascades to its lines.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_inv) THEN RETURN OLD; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_inv AND status = 'draft') THEN
    RAISE EXCEPTION 'lines change only on draft invoices' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS guard_invoice_line_write ON public.invoice_lines;
CREATE TRIGGER guard_invoice_line_write BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_line_write();

CREATE OR REPLACE FUNCTION public.guard_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS guard_invoice_payments ON public.invoice_payments;
CREATE TRIGGER guard_invoice_payments BEFORE UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
DROP TRIGGER IF EXISTS guard_invoice_events ON public.invoice_events;
CREATE TRIGGER guard_invoice_events BEFORE UPDATE OR DELETE ON public.invoice_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
DROP TRIGGER IF EXISTS guard_invoice_reminders ON public.invoice_reminders;
CREATE TRIGGER guard_invoice_reminders BEFORE UPDATE OR DELETE ON public.invoice_reminders
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();

CREATE OR REPLACE FUNCTION public.invoice_event(p_invoice uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.invoice_events (invoice_id, actor_id, action, details)
  VALUES (p_invoice, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

-- What remains to be paid (fees included; credit notes count as paid).
CREATE OR REPLACE FUNCTION public.invoice_outstanding(i public.invoices)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$ SELECT round(i.total + i.fees_total - i.amount_paid - i.amount_credited, 2); $$;

-- KID: the invoice number, eight digits, with a MOD10 (Luhn) check digit.
CREATE OR REPLACE FUNCTION public.kid_mod10(p_base text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE s int := 0; d int; dbl boolean := true;
BEGIN
  FOR i IN REVERSE length(p_base)..1 LOOP
    d := substr(p_base, i, 1)::int;
    IF dbl THEN d := d * 2; IF d > 9 THEN d := d - 9; END IF; END IF;
    s := s + d; dbl := NOT dbl;
  END LOOP;
  RETURN p_base || ((10 - s % 10) % 10)::text;
END $$;

-- The due date from the company's terms.
CREATE OR REPLACE FUNCTION public.invoice_due_date(p_issue date, p_type text, p_days integer, p_day integer)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN p_type = 'day_of_month'
              THEN (date_trunc('month', p_issue) + interval '1 month')::date + (p_day - 1)
              ELSE p_issue + p_days END;
$$;

CREATE OR REPLACE FUNCTION public.require_billing_operator()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_server()) THEN
    RAISE EXCEPTION 'invoices: FlyttGo administrators and the server only' USING ERRCODE = '42501';
  END IF;
END $$;

-- The charge of a booking on an invoice: what the booking costs (with an
-- approved over-time adjustment), or the fee a late cancellation keeps.
-- Prices include 25% MVA; the line shows them without.
CREATE OR REPLACE FUNCTION public.booking_invoice_amount(p_booking uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT round(coalesce(
           CASE WHEN e.adjustment_approved AND e.adjusted_amount IS NOT NULL THEN e.adjusted_amount END,
           b.final_price, b.price_estimate, 0), 2)
    FROM public.bookings b LEFT JOIN public.escrow_payments e ON e.booking_id = b.id
   WHERE b.id = p_booking;
$$;

-- A draft invoice for a company, with a line per booking given (company
-- bookings paid on invoice, not yet invoiced). p_amounts may override the
-- booking amount per booking (cancellation fees), in the same order.
CREATE OR REPLACE FUNCTION public.create_invoice_draft(p_org uuid, p_bookings uuid[], p_amounts numeric[] DEFAULT NULL,
                                                      p_notes text DEFAULT NULL)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_b   public.bookings%ROWTYPE;
  v_amt numeric;
  v_net numeric;
  n     int := 0;
BEGIN
  PERFORM public.require_billing_operator();
  INSERT INTO public.invoices (organization_id, notes, created_by) VALUES (p_org, p_notes, auth.uid()) RETURNING * INTO v_inv;
  FOR i IN 1..coalesce(array_length(p_bookings, 1), 0) LOOP
    SELECT * INTO v_b FROM public.bookings WHERE id = p_bookings[i];
    IF NOT FOUND OR v_b.organization_id IS DISTINCT FROM p_org THEN
      RAISE EXCEPTION 'booking % is not a booking of this company', p_bookings[i] USING ERRCODE = '22023';
    END IF;
    IF v_b.payment_provider IS DISTINCT FROM 'invoice' THEN
      RAISE EXCEPTION 'booking % was not booked on invoice', p_bookings[i] USING ERRCODE = '22023';
    END IF;
    v_amt := round(coalesce(p_amounts[i], public.booking_invoice_amount(v_b.id)), 2);
    IF v_amt <= 0 THEN CONTINUE; END IF;
    v_net := round(v_amt / 1.25, 2);
    n := n + 1;
    INSERT INTO public.invoice_lines (invoice_id, line_no, booking_id, description, quantity, unit_price, vat_rate,
                                      net_amount, vat_amount, total)
    VALUES (v_inv.id, n, v_b.id,
            CASE WHEN v_b.status = 'cancelled' THEN 'Cancellation fee, booking ' ELSE 'Moving service, booking ' END
              || left(v_b.id::text, 8) || coalesce(', ' || v_b.pickup_city || ' – ' || v_b.dropoff_city, '')
              || coalesce(', ' || to_char(v_b.move_date AT TIME ZONE 'Europe/Oslo', 'DD.MM.YYYY'), ''),
            1, v_net, 25, v_net, v_amt - v_net, v_amt);
  END LOOP;
  UPDATE public.invoices SET
    net_total = coalesce((SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id), 0),
    vat_total = coalesce((SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id), 0),
    total     = coalesce((SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_inv.id), 0),
    delivery_from = (SELECT min((b.move_date AT TIME ZONE 'Europe/Oslo')::date) FROM public.bookings b WHERE b.id = ANY (p_bookings)),
    delivery_to   = (SELECT max((b.move_date AT TIME ZONE 'Europe/Oslo')::date) FROM public.bookings b WHERE b.id = ANY (p_bookings))
   WHERE id = v_inv.id RETURNING * INTO v_inv;
  RETURN v_inv;                     -- the event log starts when the invoice is issued
END $$;

-- A manual line on a draft (for example a service outside a booking).
CREATE OR REPLACE FUNCTION public.add_invoice_line(p_invoice uuid, p_description text, p_quantity numeric,
                                                  p_unit_price numeric, p_vat_rate numeric DEFAULT 25)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv public.invoices%ROWTYPE; v_net numeric; v_vat numeric;
BEGIN
  PERFORM public.require_billing_operator();
  IF coalesce(btrim(p_description), '') = '' OR p_quantity <= 0 OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'a line needs a description, a quantity above 0 and a price' USING ERRCODE = '22023';
  END IF;
  v_net := round(p_quantity * p_unit_price, 2);
  v_vat := round(v_net * p_vat_rate / 100, 2);
  INSERT INTO public.invoice_lines (invoice_id, line_no, description, quantity, unit_price, vat_rate, net_amount, vat_amount, total)
  VALUES (p_invoice, coalesce((SELECT max(line_no) FROM public.invoice_lines WHERE invoice_id = p_invoice), 0) + 1,
          btrim(p_description), p_quantity, p_unit_price, p_vat_rate, v_net, v_vat, v_net + v_vat);
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = p_invoice),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = p_invoice),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = p_invoice),
    updated_at = now()
   WHERE id = p_invoice RETURNING * INTO v_inv;
  RETURN v_inv;
END $$;

-- The seller as invoices state it, from the settings.
CREATE OR REPLACE FUNCTION public.invoice_seller()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'name', public.config_text('invoice_seller_name'),
    'org_number', public.config_text('invoice_seller_org_number'),
    'vat_registered', coalesce(public.config_text('invoice_seller_vat_registered'), 'true') = 'true',
    'address', public.config_text('invoice_seller_address'),
    'postcode_city', public.config_text('invoice_seller_postcode_city'),
    'email', public.config_text('invoice_seller_email'),
    'phone', public.config_text('invoice_seller_phone'),
    'bank_account', public.config_text('invoice_seller_bank_account'),
    'iban', public.config_text('invoice_seller_iban'),
    'bic', public.config_text('invoice_seller_bic'));
$$;

-- Issue: the next number in the series, today's date, the due date from
-- the company's terms, KID, and snapshots of seller, buyer and branding.
-- From here on the invoice is final.
CREATE OR REPLACE FUNCTION public.issue_invoice(p_invoice uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv    public.invoices%ROWTYPE;
  v_org    public.organizations%ROWTYPE;
  v_seller jsonb := public.invoice_seller();
  v_number bigint;
  v_issue  date := (now() AT TIME ZONE 'Europe/Oslo')::date;
BEGIN
  PERFORM public.require_billing_operator();
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found' USING ERRCODE = 'P0002'; END IF;
  IF v_inv.status <> 'draft' THEN RAISE EXCEPTION 'invoice % is already issued', v_inv.number USING ERRCODE = '55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoice_lines WHERE invoice_id = p_invoice) THEN
    RAISE EXCEPTION 'an invoice needs at least one line' USING ERRCODE = '22023';
  END IF;
  IF v_seller ->> 'name' IS NULL OR v_seller ->> 'org_number' IS NULL OR v_seller ->> 'bank_account' IS NULL
     OR v_seller ->> 'address' IS NULL THEN
    RAISE EXCEPTION 'fill in the seller''s name, organisation number, address and bank account in the invoice settings first'
      USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_org FROM public.organizations WHERE id = v_inv.organization_id;

  UPDATE public.invoice_counters SET next_number = next_number + 1 WHERE series = 'main'
  RETURNING next_number - 1 INTO v_number;

  UPDATE public.invoices SET
    number     = v_number,
    status     = 'issued',
    issue_date = v_issue,
    due_date   = CASE WHEN kind = 'credit_note' THEN v_issue
                      ELSE public.invoice_due_date(v_issue, v_org.payment_terms_type, v_org.payment_terms_days, v_org.payment_terms_day) END,
    kid        = CASE WHEN kind = 'invoice' THEN public.kid_mod10(lpad(v_number::text, 8, '0')) END,
    seller     = v_seller,
    buyer      = jsonb_build_object('name', v_org.name, 'org_number', v_org.org_number, 'country', v_org.country,
                                    'address', v_org.billing_address, 'email', v_org.billing_email,
                                    'customer_number', v_org.customer_number, 'vat_registered', v_org.vat_registered),
    branding   = CASE WHEN v_org.billing_plan = 'special'
                      THEN jsonb_build_object('name', v_org.name, 'logo_path', v_org.logo_path) END,
    reference  = coalesce(reference, v_org.invoice_reference),
    issued_by  = auth.uid(),
    updated_at = now()
   WHERE id = p_invoice RETURNING * INTO v_inv;
  PERFORM public.invoice_event(p_invoice, 'invoice.issued', jsonb_build_object('number', v_number, 'total', v_inv.total));

  -- A credit note reduces what its invoice still owes.
  IF v_inv.kind = 'credit_note' THEN
    UPDATE public.invoices o SET amount_credited = o.amount_credited - v_inv.total, updated_at = now()
     WHERE o.id = v_inv.credits_invoice_id;
    PERFORM public.invoice_settle_status(v_inv.credits_invoice_id);
  END IF;
  RETURN v_inv;
END $$;

CREATE OR REPLACE FUNCTION public.invoice_settle_status(p_invoice uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v public.invoices%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.invoices WHERE id = p_invoice;
  IF v.kind <> 'invoice' OR v.status = 'draft' THEN RETURN; END IF;
  UPDATE public.invoices SET status = CASE
      WHEN v.amount_credited >= v.total AND v.amount_paid = 0 THEN 'credited'
      WHEN public.invoice_outstanding(v) <= 0 THEN 'paid'
      WHEN v.amount_paid > 0 OR v.amount_credited > 0 THEN 'partially_paid'
      ELSE 'issued' END,
    updated_at = now()
   WHERE id = p_invoice;
END $$;

-- Drafts that are not wanted are deleted (they have no number).
CREATE OR REPLACE FUNCTION public.delete_invoice_draft(p_invoice uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.require_billing_operator();
  DELETE FROM public.invoices WHERE id = p_invoice AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'only a draft can be deleted' USING ERRCODE = '55000'; END IF;
END $$;

-- A credit note for the whole invoice (p_amount NULL) or part of it
-- (p_amount incl. VAT, split at 25%). Issued at once.
CREATE OR REPLACE FUNCTION public.create_credit_note(p_invoice uuid, p_amount numeric, p_reason text)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_cn  public.invoices%ROWTYPE;
  v_left numeric;
  v_net numeric;
BEGIN
  PERFORM public.require_billing_operator();
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'a credit note needs a reason' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR v_inv.kind <> 'invoice' OR v_inv.status = 'draft' THEN
    RAISE EXCEPTION 'only an issued invoice can be credited' USING ERRCODE = '55000';
  END IF;
  v_left := v_inv.total - v_inv.amount_credited;
  IF p_amount IS NOT NULL AND (p_amount <= 0 OR p_amount > v_left) THEN
    RAISE EXCEPTION 'credit between 0 and % NOK', v_left USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invoices (kind, credits_invoice_id, organization_id, notes, reference, delivery_from, delivery_to, created_by)
  VALUES ('credit_note', p_invoice, v_inv.organization_id,
          'Credit note for invoice ' || v_inv.number || ': ' || btrim(p_reason), v_inv.reference,
          v_inv.delivery_from, v_inv.delivery_to, auth.uid())
  RETURNING * INTO v_cn;

  IF p_amount IS NULL AND v_inv.amount_credited = 0 THEN
    INSERT INTO public.invoice_lines (invoice_id, line_no, booking_id, is_credit, description, quantity, unit_price,
                                      vat_rate, net_amount, vat_amount, total)
    SELECT v_cn.id, line_no, booking_id, true, 'Credit: ' || description, quantity, -unit_price, vat_rate,
           -net_amount, -vat_amount, -total
      FROM public.invoice_lines WHERE invoice_id = p_invoice;
  ELSE
    v_net := round(coalesce(p_amount, v_left) / 1.25, 2);
    INSERT INTO public.invoice_lines (invoice_id, line_no, is_credit, description, quantity, unit_price, vat_rate,
                                      net_amount, vat_amount, total)
    VALUES (v_cn.id, 1, true, 'Credit of invoice ' || v_inv.number || ': ' || btrim(p_reason), 1, -v_net, 25,
            -v_net, -(coalesce(p_amount, v_left) - v_net), -coalesce(p_amount, v_left));
  END IF;
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_cn.id),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_cn.id),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_cn.id)
   WHERE id = v_cn.id;
  PERFORM public.invoice_event(p_invoice, 'invoice.credited', jsonb_build_object('reason', p_reason, 'amount', p_amount));
  RETURN public.issue_invoice(v_cn.id);
END $$;

-- A payment against an invoice. Never more than is owed.
CREATE OR REPLACE FUNCTION public.record_invoice_payment(p_invoice uuid, p_amount numeric, p_paid_on date,
                                                        p_method text, p_reference text)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv public.invoices%ROWTYPE;
BEGIN
  PERFORM public.require_billing_operator();
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR v_inv.kind <> 'invoice' OR v_inv.status = 'draft' THEN
    RAISE EXCEPTION 'payments are recorded against issued invoices' USING ERRCODE = '55000';
  END IF;
  IF p_amount <= 0 OR p_amount > public.invoice_outstanding(v_inv) THEN
    RAISE EXCEPTION 'payment of % NOK is more than the % NOK owed', p_amount, public.invoice_outstanding(v_inv) USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.invoice_payments (invoice_id, amount, paid_on, method, reference, recorded_by)
  VALUES (p_invoice, p_amount, coalesce(p_paid_on, current_date), p_method, nullif(btrim(coalesce(p_reference, '')), ''), auth.uid());
  UPDATE public.invoices SET amount_paid = amount_paid + p_amount, updated_at = now() WHERE id = p_invoice;
  PERFORM public.invoice_settle_status(p_invoice);
  PERFORM public.invoice_event(p_invoice, 'invoice.payment', jsonb_build_object('amount', p_amount, 'method', p_method, 'reference', p_reference));
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice;
  RETURN v_inv;
END $$;

-- A bank transaction matched by KID (bank file import). Returns the
-- invoice, or NULL when the KID matches none (left for manual matching).
-- A transaction already recorded (same bank reference) is not counted again.
CREATE OR REPLACE FUNCTION public.record_payment_by_kid(p_kid text, p_amount numeric, p_paid_on date, p_bank_reference text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.require_billing_operator();
  IF p_bank_reference IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_payments
                                               WHERE method = 'bank' AND reference = p_bank_reference) THEN
    RETURN (SELECT invoice_id FROM public.invoice_payments WHERE method = 'bank' AND reference = p_bank_reference);
  END IF;
  SELECT id INTO v_id FROM public.invoices WHERE kid = regexp_replace(coalesce(p_kid, ''), '\s', '', 'g');
  IF v_id IS NULL THEN RETURN NULL; END IF;
  PERFORM public.record_invoice_payment(v_id, p_amount, p_paid_on, 'bank', p_bank_reference);
  RETURN v_id;
END $$;

-- A reminder for an overdue invoice: the fee and interest come from the
-- settings (none unless set). Recorded once per level.
CREATE OR REPLACE FUNCTION public.record_invoice_reminder(p_invoice uuid)
RETURNS public.invoice_reminders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_rem public.invoice_reminders%ROWTYPE;
  v_fee numeric := coalesce(public.config_text('invoice_reminder_fee')::numeric, 0);
  v_pct numeric := public.config_text('invoice_late_interest_pct')::numeric;
  v_interest numeric := 0;
BEGIN
  PERFORM public.require_billing_operator();
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR v_inv.kind <> 'invoice' OR v_inv.status NOT IN ('issued', 'partially_paid') THEN
    RAISE EXCEPTION 'only an unpaid issued invoice gets a reminder' USING ERRCODE = '55000';
  END IF;
  IF v_inv.due_date >= (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'invoice % is not overdue', v_inv.number USING ERRCODE = '55000';
  END IF;
  IF v_pct IS NOT NULL THEN
    -- Simple interest on what is owed (without earlier fees) since the due date.
    v_interest := round((v_inv.total - v_inv.amount_paid - v_inv.amount_credited) * v_pct / 100
                        * ((now() AT TIME ZONE 'Europe/Oslo')::date - v_inv.due_date) / 365.0, 2);
  END IF;
  INSERT INTO public.invoice_reminders (invoice_id, level, fee, interest)
  VALUES (p_invoice, v_inv.reminder_level + 1, v_fee, v_interest) RETURNING * INTO v_rem;
  UPDATE public.invoices SET reminder_level = v_rem.level, fees_total = fees_total + v_fee + v_interest, updated_at = now()
   WHERE id = p_invoice;
  PERFORM public.invoice_event(p_invoice, 'invoice.reminder', jsonb_build_object('level', v_rem.level, 'fee', v_fee, 'interest', v_interest));
  RETURN v_rem;
END $$;

CREATE OR REPLACE FUNCTION public.mark_invoice_sent(p_invoice uuid, p_channel text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.require_billing_operator();
  UPDATE public.invoices SET sent_at = now(), updated_at = now() WHERE id = p_invoice AND status <> 'draft';
  PERFORM public.invoice_event(p_invoice, 'invoice.sent', jsonb_build_object('channel', p_channel));
END $$;


-- ── 5. Booking on invoice ──────────────────────────────────────────────────
-- Called by the book-on-invoice function after it has priced the booking
-- on the server (as the card and Vipps flows do). p_caller is the signed-
-- in person the function verified.
CREATE OR REPLACE FUNCTION public.company_open_exposure(p_org uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce((SELECT sum(public.invoice_outstanding(i)) FROM public.invoices i
                    WHERE i.organization_id = p_org AND i.kind = 'invoice' AND i.status IN ('issued', 'partially_paid')), 0)
       + coalesce((SELECT sum(public.booking_invoice_amount(b.id)) FROM public.bookings b
                    WHERE b.organization_id = p_org AND b.payment_provider = 'invoice' AND b.status <> 'cancelled'
                      AND NOT EXISTS (SELECT 1 FROM public.invoice_lines l WHERE l.booking_id = b.id AND NOT l.is_credit)), 0);
$$;

CREATE OR REPLACE FUNCTION public.book_on_invoice(p_booking uuid, p_caller uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_b   public.bookings%ROWTYPE;
  v_org public.organizations%ROWTYPE;
  v_exposure numeric;
BEGIN
  IF NOT public.is_server() THEN
    RAISE EXCEPTION 'book_on_invoice: server only (book-on-invoice function)' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND OR v_b.customer_id IS DISTINCT FROM p_caller THEN
    RAISE EXCEPTION 'booking not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.organization_id IS NULL THEN
    RAISE EXCEPTION 'only company bookings can be paid on invoice' USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_b.payment_status, 'pending') <> 'pending' OR v_b.status = 'cancelled' THEN
    RAISE EXCEPTION 'booking is not awaiting payment' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_org FROM public.organizations WHERE id = v_b.organization_id;
  IF v_org.status <> 'active' OR NOT EXISTS (
       SELECT 1 FROM public.organization_members WHERE organization_id = v_org.id AND user_id = p_caller
          AND status = 'active' AND role IN ('owner', 'admin', 'booker')) THEN
    RAISE EXCEPTION 'only an owner, admin or booker of an active company books on its invoice' USING ERRCODE = '42501';
  END IF;
  IF NOT v_org.invoicing_enabled THEN
    RAISE EXCEPTION 'invoice payment is not switched on for this company; contact FlyttGo' USING ERRCODE = '55000';
  END IF;
  IF public.config_text('credit_check_enabled') = 'true' AND NOT public.has_current_credit_check(v_org.id) THEN
    RAISE EXCEPTION 'invoice payment needs a current credit check; contact FlyttGo' USING ERRCODE = '55000';
  END IF;
  v_exposure := public.company_open_exposure(v_org.id);
  IF v_org.credit_limit IS NOT NULL AND v_exposure + public.booking_invoice_amount(v_b.id) > v_org.credit_limit THEN
    RAISE EXCEPTION 'this booking would take the company over its credit limit of % NOK', v_org.credit_limit USING ERRCODE = '55000';
  END IF;

  -- Payment is secured by the invoice: no capture, dispatch as paid.
  UPDATE public.bookings SET payment_provider = 'invoice', payment_status = 'paid', captured_at = now()
   WHERE id = p_booking;
  UPDATE public.escrow_payments SET status = 'escrow' WHERE booking_id = p_booking AND status = 'held';
  PERFORM public.org_event(v_org.id, 'booking.on_invoice', p_caller, jsonb_build_object('booking', p_booking));
  RETURN jsonb_build_object('booking', p_booking, 'organization', v_org.id, 'cycle', v_org.invoice_cycle);
END $$;

-- What the invoice run should invoice now: per company, the bookings on
-- invoice that are completed (or cancelled with a fee) and not invoiced.
-- Per-booking companies: each such booking; monthly companies: those of
-- previous months, once the month is over.
CREATE OR REPLACE FUNCTION public.uninvoiced_bookings(p_today date DEFAULT NULL)
RETURNS TABLE (organization_id uuid, booking_id uuid, cycle text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT b.organization_id, b.id, o.invoice_cycle
    FROM public.bookings b JOIN public.organizations o ON o.id = b.organization_id
   WHERE b.payment_provider = 'invoice'
     AND b.status IN ('completed', 'cancelled')
     AND NOT EXISTS (SELECT 1 FROM public.invoice_lines l WHERE l.booking_id = b.id AND NOT l.is_credit)
     AND (o.invoice_cycle = 'per_booking'
          OR coalesce(b.end_time, b.cancelled_at, b.updated_at, b.created_at) < date_trunc('month', coalesce(p_today, current_date)))
   ORDER BY b.organization_id, b.created_at;
$$;


-- ── 6. Privileges ──────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.config_text(text)', 'public.set_billing_preferences(uuid, text, integer, integer, text, text)',
    'public.admin_set_invoicing(uuid, boolean, numeric, text)', 'public.set_organization_logo(uuid, text)',
    'public.has_current_credit_check(uuid)', 'public.record_credit_check(uuid, text, boolean, text, numeric, jsonb)',
    'public.can_read_invoice(uuid)', 'public.guard_invoice_write()', 'public.guard_invoice_line_write()',
    'public.guard_append_only()', 'public.invoice_event(uuid, text, jsonb)', 'public.invoice_outstanding(public.invoices)',
    'public.kid_mod10(text)', 'public.invoice_due_date(date, text, integer, integer)', 'public.require_billing_operator()',
    'public.booking_invoice_amount(uuid)', 'public.create_invoice_draft(uuid, uuid[], numeric[], text)',
    'public.add_invoice_line(uuid, text, numeric, numeric, numeric)', 'public.invoice_seller()',
    'public.issue_invoice(uuid)', 'public.invoice_settle_status(uuid)', 'public.delete_invoice_draft(uuid)',
    'public.create_credit_note(uuid, numeric, text)', 'public.record_invoice_payment(uuid, numeric, date, text, text)',
    'public.record_payment_by_kid(text, numeric, date, text)', 'public.record_invoice_reminder(uuid)',
    'public.mark_invoice_sent(uuid, text)', 'public.company_open_exposure(uuid)', 'public.book_on_invoice(uuid, uuid)',
    'public.uninvoiced_bookings(date)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
-- Callable from the app (each checks its caller): company billing
-- preferences and logo; administrators' invoicing operations.
GRANT EXECUTE ON FUNCTION public.set_billing_preferences(uuid, text, integer, integer, text, text),
  public.set_organization_logo(uuid, text), public.admin_set_invoicing(uuid, boolean, numeric, text),
  public.record_credit_check(uuid, text, boolean, text, numeric, jsonb),
  public.create_invoice_draft(uuid, uuid[], numeric[], text), public.add_invoice_line(uuid, text, numeric, numeric, numeric),
  public.issue_invoice(uuid), public.delete_invoice_draft(uuid), public.create_credit_note(uuid, numeric, text),
  public.record_invoice_payment(uuid, numeric, date, text, text), public.record_payment_by_kid(text, numeric, date, text),
  public.record_invoice_reminder(uuid), public.invoice_outstanding(public.invoices), public.company_open_exposure(uuid)
  TO authenticated;
-- RLS helpers run inside policies as the caller.
GRANT EXECUTE ON FUNCTION public.can_read_invoice(uuid) TO authenticated;

-- ============================================================================
-- DONE
-- ============================================================================


-- ===== 00009_white_label.sql =====
-- ============================================================================
-- FlyttGo — white-label booking for companies (step 6 of the corporate plan)
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00008. Decided 2026-10-29
-- (docs/WHITE_LABEL.md): both seller models are built and each company
-- chooses one, through a plan with a stated price.
--
--   Model A, "FlyttGo sells" (the default): the company's own booking page,
--     name, logo and colours, but the customer buys from FlyttGo. FlyttGo
--     takes the payment (card or Vipps), issues the receipt, runs customer
--     service, cancellations, refunds and complaints under its own terms.
--     The company sees booking numbers, not its customers' details.
--   Model B, "the company sells" (larger companies that choose it): the
--     company is the seller. Its customers pay into its own Stripe account
--     (Stripe Connect), at its own price (FlyttGo's price plus its markup),
--     under its own terms. FlyttGo is its subcontractor: FlyttGo's price
--     for the move and a platform fee are taken from each payment, and
--     FlyttGo processes the customers' data for the company under a data
--     processing agreement. The company sees its customers' bookings and
--     answers its customers first.
--
--   * Plans and their prices are a public list (white_label_plans).
--     Prices are FlyttGo's to set: they ship as proposals and say so until
--     an administrator confirms them.
--   * A company's owner or admin requests a plan and fills in its brand;
--     FlyttGo approves it once every requirement of the plan is met
--     (white_label_missing). Model B needs: MVA registration, a customer
--     service email and phone, its own terms and privacy notice, the data
--     processing agreement accepted by an owner, and a Stripe account that
--     can take payments.
--   * A booking made on a company's page carries the company
--     (white_label_org) and the seller model, decided by the database
--     from the active plan, never by the browser. The split of a Model B
--     payment is written by the server when it prices the booking.
--   * The plan's fees, and for Model B what FlyttGo kept from each
--     payment, are invoiced monthly through FlyttGo's own invoices (00008).
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Settings ─────────────────────────────────────────────────────────────
INSERT INTO public.platform_config (config_key, config_value)
SELECT k, v FROM (VALUES
  ('white_label_dpa_version', '2026-10-draft'),
  ('white_label_support_email', ''), ('white_label_support_phone', '')
) AS c(k, v)
WHERE NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = c.k);


-- ── 2. Plans and prices (public) ────────────────────────────────────────────
-- Fees exclude MVA. The platform fee (Model B) is a share of FlyttGo's
-- price for the move, at least platform_fee_min, per paid booking.
CREATE TABLE IF NOT EXISTS public.white_label_plans (
  code                text        PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name                text        NOT NULL,
  seller_model        text        NOT NULL CHECK (seller_model IN ('flyttgo', 'company')),
  summary             text        NOT NULL,
  for_whom            text,
  setup_fee           numeric     NOT NULL DEFAULT 0 CHECK (setup_fee >= 0),
  monthly_fee         numeric     NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
  platform_fee_pct    numeric     NOT NULL DEFAULT 0 CHECK (platform_fee_pct BETWEEN 0 AND 50),
  platform_fee_min    numeric     NOT NULL DEFAULT 0 CHECK (platform_fee_min >= 0),
  own_domain          boolean     NOT NULL DEFAULT false,
  features            text[]      NOT NULL DEFAULT '{}',
  flyttgo_does        text[]      NOT NULL DEFAULT '{}',
  company_does        text[]      NOT NULL DEFAULT '{}',
  requirements        text[]      NOT NULL DEFAULT '{}',
  is_default          boolean     NOT NULL DEFAULT false,
  sort                integer     NOT NULL DEFAULT 0,
  active              boolean     NOT NULL DEFAULT true,
  price_status        text        NOT NULL DEFAULT 'proposed' CHECK (price_status IN ('proposed', 'confirmed')),
  prices_confirmed_by uuid,
  prices_confirmed_at timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT white_label_plans_fee_model CHECK (seller_model = 'company' OR (platform_fee_pct = 0 AND platform_fee_min = 0))
);
-- One default plan.
CREATE UNIQUE INDEX IF NOT EXISTS white_label_plans_one_default ON public.white_label_plans (is_default) WHERE is_default;

-- FlyttGo's proposed price list. An administrator confirms or changes it
-- (admin_update_white_label_plan); until then every page says the prices
-- are proposals.
INSERT INTO public.white_label_plans (code, name, seller_model, summary, for_whom, setup_fee, monthly_fee,
                                      platform_fee_pct, platform_fee_min, own_domain, features, flyttgo_does,
                                      company_does, requirements, is_default, sort)
SELECT * FROM (VALUES
  ('branded', 'Branded booking page', 'flyttgo',
   'Your own booking page with your name, logo and colours. FlyttGo is the seller and does the rest.',
   'Companies that want to offer moving and delivery under their brand without running it.',
   2900::numeric, 1490::numeric, 0::numeric, 0::numeric, false,
   ARRAY['Booking page at flyttgo.no/b/your-name and your-name.flyttgo.no',
         'Your name, logo and colours on the booking page',
         'FlyttGo''s prices and payment (card, Vipps)',
         'A website from FlyttGo''s template library, in your name and colours',
         'Monthly booking numbers for your page'],
   ARRAY['Is the seller: the customer buys from FlyttGo AS',
         'Takes the payment and issues the receipt',
         'Customer service, cancellations, refunds and complaints',
         'Terms, consumer rights and privacy (FlyttGo is the data controller)'],
   ARRAY['Brings customers to the page'],
   ARRAY['An active (verified) company', 'A display name for the page'],
   true, 10),
  ('branded_domain', 'Branded booking on your domain', 'flyttgo',
   'As Branded booking page, on your own web address. FlyttGo is still the seller.',
   'Companies that want the booking page on their own website address.',
   4900::numeric, 2490::numeric, 0::numeric, 0::numeric, true,
   ARRAY['Everything in Branded booking page',
         'Your own address, for example booking.yourcompany.no',
         'FlyttGo connects and maintains the address'],
   ARRAY['Is the seller: the customer buys from FlyttGo AS',
         'Takes the payment and issues the receipt',
         'Customer service, cancellations, refunds and complaints',
         'Terms, consumer rights and privacy (FlyttGo is the data controller)',
         'Connects your domain'],
   ARRAY['Brings customers to the page', 'Adds two DNS records for the domain'],
   ARRAY['An active (verified) company', 'A display name for the page', 'A verified domain'],
   false, 20),
  ('own_seller', 'Own seller', 'company',
   'Your company is the seller: your prices, your terms, payments into your own Stripe account. FlyttGo carries out the moves as your subcontractor.',
   'Larger companies with their own customer service and accounting that want to sell moving under their own name.',
   14900::numeric, 4990::numeric, 4::numeric, 49::numeric, true,
   ARRAY['Everything in Branded booking on your domain',
         'Your own prices: FlyttGo''s price plus your markup',
         'Payments go straight into your own Stripe account (card)',
         'Receipts in your company''s name, under your terms',
         'Your customers'' bookings in your dashboard'],
   ARRAY['Carries out the moves (drivers, dispatch, tracking)',
         'Processes your customers'' data for you under the data processing agreement',
         'Invoices you monthly for the plan, with what was kept from each payment'],
   ARRAY['Is the seller: consumer rights, MVA on your sales, your own bookkeeping',
         'First-line customer service, complaints and refunds',
         'Your terms and privacy notice (you are the data controller)'],
   ARRAY['An active (verified) company registered for MVA',
         'Customer service email and phone',
         'Your own terms and privacy notice (web addresses)',
         'The data processing agreement, accepted by an owner',
         'A Stripe account connected through FlyttGo that can take payments',
         'A verified domain'],
   false, 30)
) AS v(code, name, seller_model, summary, for_whom, setup_fee, monthly_fee, platform_fee_pct, platform_fee_min,
       own_domain, features, flyttgo_does, company_does, requirements, is_default, sort)
WHERE NOT EXISTS (SELECT 1 FROM public.white_label_plans p WHERE p.code = v.code);

ALTER TABLE public.white_label_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS white_label_plans_select ON public.white_label_plans;
CREATE POLICY white_label_plans_select ON public.white_label_plans FOR SELECT TO anon, authenticated
  USING (active OR public.is_admin());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.white_label_plans FROM anon, authenticated;


-- ── 2b. Website templates (the template library) ───────────────────────────
-- Complete websites a company can choose for its page, imported from
-- Architect-AI's site masters by scripts/import-site-templates.ts (server
-- only), sanitised and with the sample company turned into placeholders.
-- A template is offered only after a FlyttGo administrator has checked
-- its wording (no invented prices, reviews or claims) and approved it.
CREATE TABLE IF NOT EXISTS public.site_templates (
  id            text        PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  name          text        NOT NULL,
  industry      text[]      NOT NULL DEFAULT '{}',
  style         text,
  pages         jsonb       NOT NULL CHECK (jsonb_typeof(pages) = 'array' AND jsonb_array_length(pages) BETWEEN 1 AND 12),
  assets        jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(assets) = 'array'),
  source        text        NOT NULL DEFAULT 'architect-ai',
  source_id     text,
  content_flags jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status        text        NOT NULL DEFAULT 'imported' CHECK (status IN ('imported', 'approved', 'retired')),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  review_note   text,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_templates_industry_idx ON public.site_templates USING gin (industry);
ALTER TABLE public.site_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_templates_select ON public.site_templates;
CREATE POLICY site_templates_select ON public.site_templates FOR SELECT TO authenticated
  USING (status = 'approved' OR public.is_admin());
REVOKE ALL ON public.site_templates FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.site_templates FROM authenticated;

-- Template images, copied into FlyttGo's own storage by the importer.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'site-template-assets', 'site-template-assets', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'site-template-assets');

-- What a stored page may never contain (the renderer removes it too).
CREATE OR REPLACE FUNCTION public.site_template_html_problems(p_html text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN p_html ~* '<script' THEN 'script' END,
    CASE WHEN p_html ~* '\son[a-z]+\s*=' THEN 'event handler' END,
    CASE WHEN p_html ~* '(javascript|vbscript)\s*:' THEN 'javascript: link' END,
    CASE WHEN p_html ~* '<(iframe|frame|object|embed|applet|portal)\M' THEN 'frame or embed' END,
    CASE WHEN p_html ~* '<form\M' THEN 'form' END,
    CASE WHEN p_html ~* '<(link|base)\M' THEN 'link or base tag' END,
    CASE WHEN p_html ~* 'http-equiv\s*=\s*["'']?refresh' THEN 'refresh' END], NULL);
$$;

-- Prices in a page's visible text (a template must not carry any: the
-- company's prices are FlyttGo's or its own, shown by the booking page).
CREATE OR REPLACE FUNCTION public.site_template_price_hits(p_html text)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
  SELECT count(*)::int FROM regexp_matches(
    regexp_replace(regexp_replace(coalesce(p_html, ''), '<style[^>]*>.*?</style>', ' ', 'gi'), '<[^>]+>', ' ', 'g'),
    '([$€£]\s?[0-9]|[0-9][0-9 .,]*\s?(kr|NOK|USD|EUR|GBP)\M|[0-9]+\s?/\s?(hr|hour|time)\M|per (hour|mover|move)\M)', 'gi');
$$;

-- The importer stores a template (server only). A changed template needs
-- a new review.
CREATE OR REPLACE FUNCTION public.import_site_template(p jsonb)
RETURNS public.site_templates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t public.site_templates%ROWTYPE; pg jsonb; v_problems text[];
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'templates: the importer (server) only' USING ERRCODE = '42501'; END IF;
  FOR pg IN SELECT * FROM jsonb_array_elements(p -> 'pages') LOOP
    v_problems := public.site_template_html_problems(pg ->> 'html');
    IF cardinality(v_problems) > 0 OR coalesce(pg ->> 'path', '') !~ '^/' THEN
      RAISE EXCEPTION 'templates: page % of % is not clean (%)', pg ->> 'path', p ->> 'id', array_to_string(v_problems, ', ')
        USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO public.site_templates (id, name, industry, style, pages, assets, source, source_id, content_flags)
  VALUES (p ->> 'id', p ->> 'name', ARRAY(SELECT jsonb_array_elements_text(coalesce(p -> 'industry', '[]'::jsonb))),
          p ->> 'style', p -> 'pages', coalesce(p -> 'assets', '[]'::jsonb), coalesce(p ->> 'source', 'architect-ai'),
          p ->> 'source_id', coalesce(p -> 'flags', '[]'::jsonb))
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, industry = EXCLUDED.industry, style = EXCLUDED.style, assets = EXCLUDED.assets,
    pages = EXCLUDED.pages, content_flags = EXCLUDED.content_flags, source_id = EXCLUDED.source_id,
    status = CASE WHEN site_templates.pages IS DISTINCT FROM EXCLUDED.pages THEN 'imported' ELSE site_templates.status END,
    reviewed_by = CASE WHEN site_templates.pages IS DISTINCT FROM EXCLUDED.pages THEN NULL ELSE site_templates.reviewed_by END,
    reviewed_at = CASE WHEN site_templates.pages IS DISTINCT FROM EXCLUDED.pages THEN NULL ELSE site_templates.reviewed_at END,
    updated_at = now()
  RETURNING * INTO t;
  RETURN t;
END $$;

-- An administrator corrects a page's wording (replacing sample prices,
-- reviews and claims). The page must stay clean; an approved template
-- goes back to review.
CREATE OR REPLACE FUNCTION public.admin_update_site_template_page(p_id text, p_path text, p_html text)
RETURNS public.site_templates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t public.site_templates%ROWTYPE; v_problems text[] := public.site_template_html_problems(p_html); v_i int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'templates: platform administrators only' USING ERRCODE = '42501'; END IF;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'templates: the page may not contain: %', array_to_string(v_problems, ', ') USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.site_templates WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'templates: no such template' USING ERRCODE = 'P0002'; END IF;
  SELECT i - 1 INTO v_i FROM jsonb_array_elements(t.pages) WITH ORDINALITY AS e(pg, i) WHERE pg ->> 'path' = p_path;
  IF v_i IS NULL THEN RAISE EXCEPTION 'templates: the template has no page %', p_path USING ERRCODE = 'P0002'; END IF;
  UPDATE public.site_templates SET pages = jsonb_set(pages, ARRAY[v_i::text, 'html'], to_jsonb(p_html)),
         status = CASE WHEN status = 'approved' THEN 'imported' ELSE status END,
         reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
   WHERE id = p_id RETURNING * INTO t;
  RETURN t;
END $$;

-- An administrator approves a template after checking its wording, or
-- retires it. Approval is refused while any page has a price or anything
-- unclean, and needs the administrator to confirm the check.
CREATE OR REPLACE FUNCTION public.admin_review_site_template(p_id text, p_approve boolean, p_content_checked boolean, p_note text)
RETURNS public.site_templates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t public.site_templates%ROWTYPE; v_prices int; v_bad int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'templates: platform administrators only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public.site_templates WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'templates: no such template' USING ERRCODE = 'P0002'; END IF;
  IF p_approve THEN
    SELECT coalesce(sum(public.site_template_price_hits(pg ->> 'html')), 0),
           count(*) FILTER (WHERE cardinality(public.site_template_html_problems(pg ->> 'html')) > 0)
      INTO v_prices, v_bad FROM jsonb_array_elements(t.pages) pg;
    IF v_bad > 0 THEN RAISE EXCEPTION 'templates: a page is not clean' USING ERRCODE = '55000'; END IF;
    IF v_prices > 0 THEN
      RAISE EXCEPTION 'templates: remove the % sample price(s) first: prices come from the booking page', v_prices USING ERRCODE = '55000';
    END IF;
    IF p_content_checked IS NOT TRUE THEN
      RAISE EXCEPTION 'templates: confirm that sample reviews, figures and claims were removed or made true' USING ERRCODE = '55000';
    END IF;
  END IF;
  UPDATE public.site_templates SET status = CASE WHEN p_approve THEN 'approved' ELSE 'retired' END,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
   WHERE id = p_id RETURNING * INTO t;
  RETURN t;
END $$;


-- ── 3. A company's white-label set-up ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organization_white_label (
  organization_id        uuid        PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  plan_code              text        NOT NULL REFERENCES public.white_label_plans (code),
  status                 text        NOT NULL DEFAULT 'requested'
                         CHECK (status IN ('requested', 'active', 'suspended', 'ended', 'declined')),
  requested_plan_code    text        REFERENCES public.white_label_plans (code),   -- a change waiting for FlyttGo
  requested_by           uuid,
  requested_at           timestamptz NOT NULL DEFAULT now(),
  decided_by             uuid,
  decided_at             timestamptz,
  decision_reason        text,
  started_at             timestamptz,                      -- first approval: billing starts
  ended_at               timestamptz,
  display_name           text        CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 2 AND 80),
  tagline                text        CHECK (tagline IS NULL OR char_length(tagline) <= 140),
  primary_color          text        CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9a-f]{6}$'),
  accent_color           text        CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-f]{6}$'),
  support_email          text        CHECK (support_email IS NULL OR support_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  support_phone          text        CHECK (support_phone IS NULL OR support_phone ~ '^\+?[0-9 ]{8,20}$'),
  terms_url              text        CHECK (terms_url IS NULL OR terms_url ~ '^https://[^\s]+$'),
  privacy_url            text        CHECK (privacy_url IS NULL OR privacy_url ~ '^https://[^\s]+$'),
  price_markup_pct       numeric     NOT NULL DEFAULT 0 CHECK (price_markup_pct BETWEEN 0 AND 100),
  template_id            text        REFERENCES public.site_templates (id),     -- the company's website, from the library
  city                   text        CHECK (city IS NULL OR char_length(btrim(city)) BETWEEN 2 AND 80),
  custom_domain          text        UNIQUE,
  domain_token           text,
  domain_verified_at     timestamptz,
  stripe_account_id      text        UNIQUE CHECK (stripe_account_id IS NULL OR stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  stripe_charges_enabled boolean     NOT NULL DEFAULT false,
  stripe_checked_at      timestamptz,
  dpa_version            text,
  dpa_accepted_by        uuid,
  dpa_accepted_at        timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_white_label_domain_valid CHECK (custom_domain IS NULL OR (
        custom_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    AND custom_domain !~ '(^|\.)flyttgo\.no$'))
);

ALTER TABLE public.organization_white_label ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_white_label_select ON public.organization_white_label;
CREATE POLICY organization_white_label_select ON public.organization_white_label FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organization_white_label FROM anon, authenticated;
REVOKE ALL ON public.organization_white_label FROM anon;


-- ── 4. Bookings made on a company's page ────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS white_label_org      uuid,
  ADD COLUMN IF NOT EXISTS seller_model         text,
  ADD COLUMN IF NOT EXISTS customer_price       numeric,     -- Model B: what the customer pays the company (incl. MVA)
  ADD COLUMN IF NOT EXISTS platform_fee         numeric,     -- Model B: FlyttGo's platform fee (incl. MVA)
  ADD COLUMN IF NOT EXISTS connected_account_id text;        -- Model B: the company's Stripe account
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_white_label_org_fkey') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_white_label_org_fkey
      FOREIGN KEY (white_label_org) REFERENCES public.organizations (id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_seller_model_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_seller_model_check CHECK (
          (white_label_org IS NULL AND seller_model IS NULL)
       OR (white_label_org IS NOT NULL AND seller_model IN ('flyttgo', 'company')));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS bookings_white_label_idx
  ON public.bookings (white_label_org, created_at DESC) WHERE white_label_org IS NOT NULL;

-- The page's company and its seller model come from the active plan; the
-- payment split only from the server. A booking the company sells is paid
-- into the company's account, never on FlyttGo's invoice.
CREATE OR REPLACE FUNCTION public.guard_booking_white_label()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_model text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_server() THEN
      NEW.customer_price := NULL; NEW.platform_fee := NULL; NEW.connected_account_id := NULL;
    END IF;
    IF NEW.white_label_org IS NULL THEN
      NEW.seller_model := NULL;
      RETURN NEW;
    END IF;
    SELECT p.seller_model INTO v_model
      FROM public.organization_white_label w
      JOIN public.white_label_plans p ON p.code = w.plan_code
      JOIN public.organizations o ON o.id = w.organization_id
     WHERE w.organization_id = NEW.white_label_org AND w.status = 'active' AND o.status = 'active';
    IF v_model IS NULL THEN
      RAISE EXCEPTION 'bookings: this company''s booking page is not active' USING ERRCODE = '42501';
    END IF;
    NEW.seller_model := v_model;
    RETURN NEW;
  END IF;

  IF NEW.white_label_org IS DISTINCT FROM OLD.white_label_org OR NEW.seller_model IS DISTINCT FROM OLD.seller_model THEN
    RAISE EXCEPTION 'bookings: the booking page and seller of a booking cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_server()
     AND (NEW.customer_price IS DISTINCT FROM OLD.customer_price OR NEW.platform_fee IS DISTINCT FROM OLD.platform_fee
          OR NEW.connected_account_id IS DISTINCT FROM OLD.connected_account_id) THEN
    RAISE EXCEPTION 'bookings: the payment split is set by the server only' USING ERRCODE = '42501';
  END IF;
  IF NEW.seller_model = 'company' AND NEW.payment_provider = 'invoice'
     AND NEW.payment_provider IS DISTINCT FROM OLD.payment_provider THEN
    RAISE EXCEPTION 'bookings: the company sells this booking, so its customer pays the company, not on FlyttGo''s invoice'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_booking_white_label ON public.bookings;
CREATE TRIGGER guard_booking_white_label
  BEFORE INSERT OR UPDATE OF white_label_org, seller_model, customer_price, platform_fee, connected_account_id, payment_provider
  ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.guard_booking_white_label();
REVOKE ALL ON FUNCTION public.guard_booking_white_label() FROM PUBLIC, anon, authenticated;

-- Model B: the seller company's members read their customers' bookings.
-- Model A: the customers are FlyttGo's; the company sees numbers only
-- (white_label_stats).
DROP POLICY IF EXISTS bookings_white_label_select ON public.bookings;
CREATE POLICY bookings_white_label_select ON public.bookings
  FOR SELECT TO authenticated
  USING (seller_model = 'company' AND white_label_org IS NOT NULL AND public.is_org_member(white_label_org));


-- ── 5. Choosing a plan and setting it up ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.white_label_event(p_org uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT public.org_event(p_org, p_action, NULL, p_details); $$;

-- What a plan still needs before FlyttGo can approve it (empty: ready).
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

-- An owner or admin requests a plan (the default when none is named). A
-- company already on a plan requests a change, which waits for FlyttGo.
CREATE OR REPLACE FUNCTION public.request_white_label(p_org uuid, p_plan text DEFAULT NULL)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  w      public.organization_white_label%ROWTYPE;
  v_plan text;
  v_org  public.organizations%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  SELECT * INTO v_org FROM public.organizations WHERE id = p_org;
  IF v_org.status IN ('suspended', 'closed') THEN
    RAISE EXCEPTION 'white label: a % company cannot request a plan', v_org.status USING ERRCODE = '55000';
  END IF;
  SELECT code INTO v_plan FROM public.white_label_plans
   WHERE active AND code = coalesce(p_plan, (SELECT code FROM public.white_label_plans WHERE is_default));
  IF v_plan IS NULL THEN RAISE EXCEPTION 'white label: no such plan' USING ERRCODE = '22023'; END IF;

  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.organization_white_label (organization_id, plan_code, requested_by, display_name)
    VALUES (p_org, v_plan, auth.uid(), left(v_org.name, 80)) RETURNING * INTO w;
  ELSIF w.status IN ('active', 'suspended') THEN
    IF v_plan = w.plan_code THEN
      UPDATE public.organization_white_label SET requested_plan_code = NULL, updated_at = now()
       WHERE organization_id = p_org RETURNING * INTO w;
    ELSE
      UPDATE public.organization_white_label SET requested_plan_code = v_plan, requested_by = auth.uid(),
             requested_at = now(), updated_at = now()
       WHERE organization_id = p_org RETURNING * INTO w;
    END IF;
  ELSE
    UPDATE public.organization_white_label SET plan_code = v_plan, status = 'requested', requested_plan_code = NULL,
           requested_by = auth.uid(), requested_at = now(), decision_reason = NULL, ended_at = NULL, updated_at = now()
     WHERE organization_id = p_org RETURNING * INTO w;
  END IF;
  -- Only the seller sets its own prices.
  IF (SELECT seller_model FROM public.white_label_plans WHERE code = coalesce(w.requested_plan_code, w.plan_code)) <> 'company'
     AND w.status NOT IN ('active', 'suspended') THEN
    UPDATE public.organization_white_label SET price_markup_pct = 0 WHERE organization_id = p_org RETURNING * INTO w;
  END IF;
  PERFORM public.white_label_event(p_org, 'white_label.requested', jsonb_build_object('plan', v_plan));
  RETURN w;
END $$;

-- The page's brand and, for the seller, its customer contacts, terms and
-- markup. Owners and admins.
CREATE OR REPLACE FUNCTION public.set_white_label_brand(
  p_org uuid, p_display_name text, p_primary_color text, p_accent_color text, p_tagline text,
  p_support_email text, p_support_phone text, p_terms_url text, p_privacy_url text, p_markup_pct numeric DEFAULT 0)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE; v_model text;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: choose a plan first' USING ERRCODE = 'P0002'; END IF;
  SELECT seller_model INTO v_model FROM public.white_label_plans WHERE code = coalesce(w.requested_plan_code, w.plan_code);
  IF coalesce(p_markup_pct, 0) <> 0 AND v_model <> 'company' AND w.price_markup_pct IS DISTINCT FROM p_markup_pct THEN
    RAISE EXCEPTION 'white label: only a company that is the seller sets its own prices (plan Own seller)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.organization_white_label SET
    display_name     = nullif(btrim(coalesce(p_display_name, '')), ''),
    primary_color    = lower(nullif(btrim(coalesce(p_primary_color, '')), '')),
    accent_color     = lower(nullif(btrim(coalesce(p_accent_color, '')), '')),
    tagline          = nullif(btrim(coalesce(p_tagline, '')), ''),
    support_email    = lower(nullif(btrim(coalesce(p_support_email, '')), '')),
    support_phone    = nullif(btrim(coalesce(p_support_phone, '')), ''),
    terms_url        = nullif(btrim(coalesce(p_terms_url, '')), ''),
    privacy_url      = nullif(btrim(coalesce(p_privacy_url, '')), ''),
    price_markup_pct = coalesce(p_markup_pct, 0),
    updated_at       = now()
   WHERE organization_id = p_org RETURNING * INTO w;
  PERFORM public.white_label_event(p_org, 'white_label.brand', jsonb_build_object(
    'display_name', w.display_name, 'markup_pct', w.price_markup_pct, 'terms_url', w.terms_url));
  RETURN w;
END $$;

-- The company's own address for the page. A new token is shown for the
-- DNS record; the domain counts only once the server has seen it.
CREATE OR REPLACE FUNCTION public.set_white_label_domain(p_org uuid, p_domain text)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE; v_domain text := lower(btrim(coalesce(p_domain, '')));
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  v_domain := regexp_replace(regexp_replace(v_domain, '^https?://', ''), '/.*$', '');
  UPDATE public.organization_white_label SET
    custom_domain = nullif(v_domain, ''),
    domain_token  = CASE WHEN v_domain = '' THEN NULL ELSE replace(gen_random_uuid()::text, '-', '') END,
    domain_verified_at = NULL,
    updated_at    = now()
   WHERE organization_id = p_org RETURNING * INTO w;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: choose a plan first' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.white_label_event(p_org, 'white_label.domain', jsonb_build_object('domain', w.custom_domain));
  RETURN w;
END $$;

-- The company's website: a template from the library (approved ones
-- only) and the town it names. Owners and admins.
CREATE OR REPLACE FUNCTION public.set_white_label_site(p_org uuid, p_template text, p_city text)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  IF p_template IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.site_templates WHERE id = p_template AND status = 'approved') THEN
    RAISE EXCEPTION 'white label: that template is not offered' USING ERRCODE = '22023';
  END IF;
  UPDATE public.organization_white_label SET template_id = p_template, city = nullif(btrim(coalesce(p_city, '')), ''),
         updated_at = now()
   WHERE organization_id = p_org RETURNING * INTO w;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: choose a plan first' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.white_label_event(p_org, 'white_label.site', jsonb_build_object('template', p_template, 'city', w.city));
  RETURN w;
END $$;

-- The server found the token in the domain's DNS.
CREATE OR REPLACE FUNCTION public.mark_white_label_domain_verified(p_org uuid, p_domain text)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE;
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'white label: the server only' USING ERRCODE = '42501'; END IF;
  UPDATE public.organization_white_label SET domain_verified_at = now(), updated_at = now()
   WHERE organization_id = p_org AND custom_domain = lower(p_domain) RETURNING * INTO w;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: that is not the company''s domain' USING ERRCODE = '22023'; END IF;
  PERFORM public.white_label_event(p_org, 'white_label.domain_verified', jsonb_build_object('domain', w.custom_domain));
  RETURN w;
END $$;

-- An owner accepts the data processing agreement (the version in force).
CREATE OR REPLACE FUNCTION public.accept_white_label_dpa(p_org uuid, p_version text)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner']);
  IF p_version IS DISTINCT FROM public.config_text('white_label_dpa_version') THEN
    RAISE EXCEPTION 'white label: the data processing agreement in force is version %', public.config_text('white_label_dpa_version')
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.organization_white_label SET dpa_version = p_version, dpa_accepted_by = auth.uid(),
         dpa_accepted_at = now(), updated_at = now()
   WHERE organization_id = p_org RETURNING * INTO w;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: choose a plan first' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.white_label_event(p_org, 'white_label.dpa_accepted', jsonb_build_object('version', p_version));
  RETURN w;
END $$;

-- The server records the company's Stripe account and whether it can
-- take payments (stripe-connect). One company per account.
CREATE OR REPLACE FUNCTION public.set_white_label_stripe_account(p_org uuid, p_account text, p_charges_enabled boolean)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE;
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'white label: the server only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: choose a plan first' USING ERRCODE = 'P0002'; END IF;
  IF w.stripe_account_id IS NOT NULL AND w.stripe_account_id <> p_account THEN
    RAISE EXCEPTION 'white label: the company already has Stripe account %', w.stripe_account_id USING ERRCODE = '55000';
  END IF;
  UPDATE public.organization_white_label SET stripe_account_id = p_account, stripe_charges_enabled = coalesce(p_charges_enabled, false),
         stripe_checked_at = now(), updated_at = now()
   WHERE organization_id = p_org RETURNING * INTO w;
  PERFORM public.white_label_event(p_org, 'white_label.stripe', jsonb_build_object('account', p_account, 'charges_enabled', p_charges_enabled));
  RETURN w;
END $$;

-- The company stops its plan (owner). Billing stops after this month.
CREATE OR REPLACE FUNCTION public.end_white_label(p_org uuid, p_reason text)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner']);
  UPDATE public.organization_white_label SET
    status = CASE WHEN status IN ('active', 'suspended') THEN 'ended' ELSE 'declined' END,
    ended_at = CASE WHEN status IN ('active', 'suspended') THEN now() END,
    requested_plan_code = NULL, decision_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   WHERE organization_id = p_org AND status IN ('requested', 'active', 'suspended') RETURNING * INTO w;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: there is no plan to end' USING ERRCODE = '55000'; END IF;
  PERFORM public.white_label_event(p_org, 'white_label.ended_by_company', jsonb_build_object('reason', p_reason));
  RETURN w;
END $$;

-- FlyttGo approves or declines a request (a new plan or a change). It
-- approves only when every requirement of the plan is met.
CREATE OR REPLACE FUNCTION public.admin_decide_white_label(p_org uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE; v_missing text[]; v_plan text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'white label: platform administrators only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: no request' USING ERRCODE = 'P0002'; END IF;
  IF w.status <> 'requested' AND w.requested_plan_code IS NULL THEN
    RAISE EXCEPTION 'white label: nothing is waiting for a decision' USING ERRCODE = '55000';
  END IF;
  v_plan := CASE WHEN w.status = 'requested' THEN w.plan_code ELSE w.requested_plan_code END;
  IF NOT p_approve THEN
    IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'white label: give the reason' USING ERRCODE = '22023'; END IF;
    UPDATE public.organization_white_label SET
      status = CASE WHEN status = 'requested' THEN 'declined' ELSE status END,
      requested_plan_code = NULL, decided_by = auth.uid(), decided_at = now(), decision_reason = btrim(p_reason), updated_at = now()
     WHERE organization_id = p_org RETURNING * INTO w;
    PERFORM public.white_label_event(p_org, 'white_label.declined', jsonb_build_object('plan', v_plan, 'reason', p_reason));
    RETURN w;
  END IF;
  v_missing := public.white_label_missing(p_org, v_plan);
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'white label: still missing: %', array_to_string(v_missing, '; ') USING ERRCODE = '55000';
  END IF;
  UPDATE public.organization_white_label SET
    plan_code = v_plan, status = CASE WHEN status = 'requested' THEN 'active' ELSE status END,
    requested_plan_code = NULL, decided_by = auth.uid(), decided_at = now(), decision_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    started_at = coalesce(started_at, now()), ended_at = NULL,
    price_markup_pct = CASE WHEN (SELECT seller_model FROM public.white_label_plans WHERE code = v_plan) = 'company'
                            THEN price_markup_pct ELSE 0 END,
    updated_at = now()
   WHERE organization_id = p_org RETURNING * INTO w;
  PERFORM public.white_label_event(p_org, 'white_label.approved', jsonb_build_object('plan', v_plan));
  RETURN w;
END $$;

-- FlyttGo suspends, ends or reactivates a plan, with the reason.
CREATE OR REPLACE FUNCTION public.admin_set_white_label_status(p_org uuid, p_status text, p_reason text)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE; v_missing text[];
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'white label: platform administrators only' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('active', 'suspended', 'ended') THEN RAISE EXCEPTION 'white label: status active, suspended or ended' USING ERRCODE = '22023'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'white label: give the reason' USING ERRCODE = '22023'; END IF;
  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org FOR UPDATE;
  IF NOT FOUND OR w.started_at IS NULL OR w.status NOT IN ('active', 'suspended', 'ended') THEN
    RAISE EXCEPTION 'white label: only an approved plan changes status (decide the request first)' USING ERRCODE = '55000';
  END IF;
  IF p_status = 'active' THEN
    v_missing := public.white_label_missing(p_org, w.plan_code);
    IF cardinality(v_missing) > 0 THEN
      RAISE EXCEPTION 'white label: still missing: %', array_to_string(v_missing, '; ') USING ERRCODE = '55000';
    END IF;
  END IF;
  UPDATE public.organization_white_label SET status = p_status, decision_reason = btrim(p_reason),
         decided_by = auth.uid(), decided_at = now(),
         ended_at = CASE WHEN p_status = 'ended' THEN now() END, updated_at = now()
   WHERE organization_id = p_org RETURNING * INTO w;
  PERFORM public.white_label_event(p_org, 'white_label.status', jsonb_build_object('status', p_status, 'reason', p_reason));
  RETURN w;
END $$;

-- FlyttGo sets a plan's prices. Changed prices are proposals until
-- confirmed; confirming records who did it.
CREATE OR REPLACE FUNCTION public.admin_update_white_label_plan(
  p_code text, p_setup_fee numeric, p_monthly_fee numeric, p_platform_fee_pct numeric, p_platform_fee_min numeric,
  p_active boolean, p_confirm boolean)
RETURNS public.white_label_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p public.white_label_plans%ROWTYPE; v_changed boolean;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'white label: platform administrators only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.white_label_plans WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: no such plan' USING ERRCODE = 'P0002'; END IF;
  IF p.is_default AND p_active IS FALSE THEN
    RAISE EXCEPTION 'white label: the default plan stays offered' USING ERRCODE = '55000';
  END IF;
  v_changed := (p.setup_fee, p.monthly_fee, p.platform_fee_pct, p.platform_fee_min)
               IS DISTINCT FROM (coalesce(p_setup_fee, p.setup_fee), coalesce(p_monthly_fee, p.monthly_fee),
                                 coalesce(p_platform_fee_pct, p.platform_fee_pct), coalesce(p_platform_fee_min, p.platform_fee_min));
  UPDATE public.white_label_plans SET
    setup_fee        = coalesce(p_setup_fee, setup_fee),
    monthly_fee      = coalesce(p_monthly_fee, monthly_fee),
    platform_fee_pct = coalesce(p_platform_fee_pct, platform_fee_pct),
    platform_fee_min = coalesce(p_platform_fee_min, platform_fee_min),
    active           = coalesce(p_active, active),
    price_status     = CASE WHEN p_confirm THEN 'confirmed' WHEN v_changed THEN 'proposed' ELSE price_status END,
    prices_confirmed_by = CASE WHEN p_confirm THEN auth.uid() WHEN v_changed THEN NULL ELSE prices_confirmed_by END,
    prices_confirmed_at = CASE WHEN p_confirm THEN now() WHEN v_changed THEN NULL ELSE prices_confirmed_at END,
    updated_at       = now()
   WHERE code = p_code RETURNING * INTO p;
  RETURN p;
END $$;

-- What the booking page shows, for the server to publish (white-label-
-- site). Only an active plan of an active company; the domain only once
-- verified. FlyttGo's bank details never leave the invoice.
CREATE OR REPLACE FUNCTION public.white_label_public(p_slug text, p_host text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  w public.organization_white_label%ROWTYPE;
  o public.organizations%ROWTYPE;
  p public.white_label_plans%ROWTYPE;
  v_host text := lower(btrim(coalesce(p_host, '')));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  s jsonb := public.invoice_seller() - 'bank_account' - 'iban' - 'bic';
BEGIN
  IF v_slug = '' AND v_host ~ '^[a-z0-9-]+\.flyttgo\.no$' THEN v_slug := split_part(v_host, '.', 1); END IF;
  SELECT w2.* INTO w FROM public.organization_white_label w2 JOIN public.organizations o2 ON o2.id = w2.organization_id
   WHERE w2.status = 'active' AND o2.status = 'active'
     AND ((v_slug <> '' AND o2.slug = v_slug)
          OR (v_slug = '' AND v_host <> '' AND w2.custom_domain = v_host AND w2.domain_verified_at IS NOT NULL));
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.organizations WHERE id = w.organization_id;
  SELECT * INTO p FROM public.white_label_plans WHERE code = w.plan_code;
  RETURN jsonb_build_object(
    'organization_id', o.id, 'slug', o.slug, 'display_name', w.display_name, 'tagline', w.tagline,
    'primary_color', w.primary_color, 'accent_color', w.accent_color, 'logo_path', o.logo_path,
    'plan', p.code, 'seller_model', p.seller_model, 'city', w.city,
    'template_id', (SELECT t.id FROM public.site_templates t WHERE t.id = w.template_id AND t.status = 'approved'),
    'domain', CASE WHEN w.domain_verified_at IS NOT NULL THEN w.custom_domain END,
    'pricing', CASE WHEN p.seller_model = 'company' THEN jsonb_build_object(
                 'markup_pct', w.price_markup_pct, 'platform_fee_pct', p.platform_fee_pct, 'platform_fee_min', p.platform_fee_min) END,
    'payments_ready', p.seller_model = 'flyttgo' OR (w.stripe_account_id IS NOT NULL AND w.stripe_charges_enabled),
    'seller', CASE WHEN p.seller_model = 'company'
                   THEN jsonb_build_object('name', o.name, 'org_number', o.org_number, 'vat_registered', o.vat_registered,
                                           'address', o.billing_address, 'email', w.support_email, 'phone', w.support_phone)
                   ELSE s END,
    'support', CASE WHEN p.seller_model = 'company'
                    THEN jsonb_build_object('email', w.support_email, 'phone', w.support_phone)
                    ELSE jsonb_build_object('email', coalesce(public.config_text('white_label_support_email'), s ->> 'email'),
                                            'phone', coalesce(public.config_text('white_label_support_phone'), s ->> 'phone')) END,
    'terms_url', CASE WHEN p.seller_model = 'company' THEN w.terms_url END,
    'privacy_url', CASE WHEN p.seller_model = 'company' THEN w.privacy_url END);
END $$;

-- Monthly numbers for the company's page. The seller (Model B) also sees
-- what its customers paid; Model A's sales are FlyttGo's.
CREATE OR REPLACE FUNCTION public.white_label_stats(p_org uuid)
RETURNS TABLE (month date, bookings bigint, completed bigint, cancelled bigint, customer_revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_org_member(p_org)) THEN
    RAISE EXCEPTION 'white label: members of the company only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT date_trunc('month', b.created_at AT TIME ZONE 'Europe/Oslo')::date,
         count(*) FILTER (WHERE b.payment_status IS DISTINCT FROM 'pending'),
         count(*) FILTER (WHERE b.status = 'completed'),
         count(*) FILTER (WHERE b.status = 'cancelled'),
         CASE WHEN bool_and(b.seller_model = 'company')
              THEN coalesce(sum(b.paid_amount) FILTER (WHERE b.payment_status IS DISTINCT FROM 'pending'), 0) END
    FROM public.bookings b
   WHERE b.white_label_org = p_org
   GROUP BY 1 ORDER BY 1 DESC LIMIT 24;
END $$;


-- ── 6. Billing the plan (FlyttGo's invoices, 00008) ─────────────────────────
-- What has been charged, so nothing is charged twice: the set-up fee once
-- per plan, the monthly fee once per month, and for Model B each booking
-- once (what FlyttGo kept from its payment, already collected through
-- Stripe).
CREATE TABLE IF NOT EXISTS public.white_label_charges (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES public.organizations (id),
  invoice_id         uuid        NOT NULL REFERENCES public.invoices (id) ON DELETE CASCADE,
  kind               text        NOT NULL CHECK (kind IN ('setup', 'monthly', 'booking')),
  plan_code          text        REFERENCES public.white_label_plans (code),
  period             date,
  booking_id         uuid        REFERENCES public.bookings (id),
  total              numeric     NOT NULL,                     -- incl. MVA
  collected          numeric     NOT NULL DEFAULT 0,           -- already taken from the customer's payment
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT white_label_charges_shape CHECK (
       (kind = 'setup'   AND plan_code IS NOT NULL AND booking_id IS NULL)
    OR (kind = 'monthly' AND plan_code IS NOT NULL AND period IS NOT NULL AND booking_id IS NULL)
    OR (kind = 'booking' AND booking_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS white_label_charges_setup_once   ON public.white_label_charges (organization_id, plan_code) WHERE kind = 'setup';
CREATE UNIQUE INDEX IF NOT EXISTS white_label_charges_monthly_once ON public.white_label_charges (organization_id, period)    WHERE kind = 'monthly';
CREATE UNIQUE INDEX IF NOT EXISTS white_label_charges_booking_once ON public.white_label_charges (booking_id)                 WHERE kind = 'booking';
ALTER TABLE public.white_label_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS white_label_charges_select ON public.white_label_charges;
CREATE POLICY white_label_charges_select ON public.white_label_charges FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id, ARRAY['owner', 'admin', 'finance']));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.white_label_charges FROM anon, authenticated;

-- Taken from a customer's payment and kept by FlyttGo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_payments_method_check'
               AND pg_get_constraintdef(oid) NOT LIKE '%platform_fee%') THEN
    ALTER TABLE public.invoice_payments DROP CONSTRAINT invoice_payments_method_check;
    ALTER TABLE public.invoice_payments ADD CONSTRAINT invoice_payments_method_check
      CHECK (method IN ('bank', 'card', 'vipps', 'other', 'platform_fee'));
  END IF;
END $$;

-- A line from an amount including MVA at 25%.
CREATE OR REPLACE FUNCTION public.white_label_line(p_invoice uuid, p_description text, p_net numeric, p_booking uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_net numeric := round(p_net, 2); v_vat numeric := round(p_net * 0.25, 2);
BEGIN
  INSERT INTO public.invoice_lines (invoice_id, line_no, booking_id, description, quantity, unit_price, vat_rate,
                                    net_amount, vat_amount, total)
  VALUES (p_invoice, coalesce((SELECT max(line_no) FROM public.invoice_lines WHERE invoice_id = p_invoice), 0) + 1,
          p_booking, p_description, 1, v_net, 25, v_net, v_vat, v_net + v_vat);
  RETURN v_net + v_vat;
END $$;
REVOKE ALL ON FUNCTION public.white_label_line(uuid, text, numeric, uuid) FROM PUBLIC, anon, authenticated;

-- The month's invoice for a company's plan, as a draft (NULL when there is
-- nothing to charge):
--   * the set-up fee, once per plan;
--   * the monthly fee, in advance, for each month from approval to the
--     current one not yet charged (the first month by the day, nothing
--     after the month a plan ended);
--   * Model B: per booking finished or cancelled before this month, what
--     FlyttGo kept from the customer's payment (its price for the move
--     and the platform fee, or their share after a refund). That part was
--     collected through Stripe and is recorded as paid when the invoice is
--     issued (settle_white_label_invoice).
CREATE OR REPLACE FUNCTION public.create_white_label_invoice(p_org uuid, p_today date DEFAULT NULL)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := coalesce(p_today, (now() AT TIME ZONE 'Europe/Oslo')::date);
  v_month date := date_trunc('month', coalesce(p_today, (now() AT TIME ZONE 'Europe/Oslo')::date))::date;
  w     public.organization_white_label%ROWTYPE;
  p     public.white_label_plans%ROWTYPE;
  v_inv public.invoices%ROWTYPE;
  v_m   date;
  v_end date;
  v_start date;
  v_days int;
  v_fee numeric;
  v_amt numeric;
  b     record;
  v_paid numeric;
  v_refunded numeric;
  v_keep numeric;
BEGIN
  PERFORM public.require_billing_operator();
  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org FOR UPDATE;
  IF NOT FOUND OR w.started_at IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.white_label_plans WHERE code = w.plan_code;
  INSERT INTO public.invoices (organization_id, notes, created_by)
  VALUES (p_org, 'White label: ' || p.name, auth.uid()) RETURNING * INTO v_inv;

  -- Set-up fee.
  IF p.setup_fee > 0 AND NOT EXISTS (SELECT 1 FROM public.white_label_charges
                                      WHERE organization_id = p_org AND kind = 'setup' AND plan_code = p.code) THEN
    v_amt := public.white_label_line(v_inv.id, 'Set-up, ' || p.name, p.setup_fee);
    INSERT INTO public.white_label_charges (organization_id, invoice_id, kind, plan_code, total)
    VALUES (p_org, v_inv.id, 'setup', p.code, v_amt);
  END IF;

  -- Monthly fees, in advance.
  v_start := (w.started_at AT TIME ZONE 'Europe/Oslo')::date;
  v_end   := CASE WHEN w.status = 'ended' AND w.ended_at IS NOT NULL
                  THEN least(v_month, date_trunc('month', w.ended_at AT TIME ZONE 'Europe/Oslo')::date) ELSE v_month END;
  v_m := date_trunc('month', v_start)::date;
  WHILE v_m <= v_end LOOP
    IF p.monthly_fee > 0 AND NOT EXISTS (SELECT 1 FROM public.white_label_charges
                                          WHERE organization_id = p_org AND kind = 'monthly' AND period = v_m) THEN
      v_days := ((v_m + interval '1 month')::date - v_m);
      v_fee := CASE WHEN v_m = date_trunc('month', v_start)::date
                    THEN round(p.monthly_fee * (v_days - extract(day FROM v_start)::int + 1) / v_days, 2)
                    ELSE p.monthly_fee END;
      v_amt := public.white_label_line(v_inv.id, p.name || ', ' || to_char(v_m, 'MM.YYYY')
                 || CASE WHEN v_fee <> p.monthly_fee THEN ' (from ' || to_char(v_start, 'DD.MM.YYYY') || ')' ELSE '' END, v_fee);
      INSERT INTO public.white_label_charges (organization_id, invoice_id, kind, plan_code, period, total)
      VALUES (p_org, v_inv.id, 'monthly', p.code, v_m, v_amt);
    END IF;
    v_m := (v_m + interval '1 month')::date;
  END LOOP;

  -- Model B: what FlyttGo kept from each payment.
  FOR b IN
    SELECT bk.* FROM public.bookings bk
     WHERE bk.white_label_org = p_org AND bk.seller_model = 'company'
       AND bk.payment_provider = 'stripe' AND coalesce(bk.paid_amount, 0) > 0
       AND bk.platform_fee IS NOT NULL
       AND bk.status IN ('completed', 'cancelled')
       AND coalesce(bk.end_time, bk.cancelled_at, bk.updated_at) < (v_month::timestamp AT TIME ZONE 'Europe/Oslo')
       AND NOT EXISTS (SELECT 1 FROM public.white_label_charges c WHERE c.booking_id = bk.id AND c.kind = 'booking')
     ORDER BY bk.created_at
  LOOP
    v_paid := b.paid_amount;
    v_refunded := coalesce((SELECT sum(r.amount) FROM public.payment_refunds r
                             WHERE r.booking_id = b.id AND r.status = 'succeeded'), 0);
    v_keep := round((b.price_estimate + b.platform_fee) * greatest(v_paid - v_refunded, 0) / v_paid, 2);
    IF v_keep <= 0 THEN CONTINUE; END IF;
    IF v_refunded = 0 THEN
      v_amt := public.white_label_line(v_inv.id, 'Moving service (subcontract), booking ' || left(b.id::text, 8)
                 || coalesce(', ' || to_char(b.move_date AT TIME ZONE 'Europe/Oslo', 'DD.MM.YYYY'), ''),
                 round(b.price_estimate / 1.25, 2), b.id)
             + public.white_label_line(v_inv.id, 'Platform fee, booking ' || left(b.id::text, 8), round(b.platform_fee / 1.25, 2));
    ELSE
      v_amt := public.white_label_line(v_inv.id, 'Moving service and platform fee kept after refund, booking ' || left(b.id::text, 8),
                 round(v_keep / 1.25, 2), b.id);
    END IF;
    INSERT INTO public.white_label_charges (organization_id, invoice_id, kind, plan_code, booking_id, total, collected)
    VALUES (p_org, v_inv.id, 'booking', p.code, b.id, v_amt, v_amt);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.invoice_lines WHERE invoice_id = v_inv.id) THEN
    DELETE FROM public.invoices WHERE id = v_inv.id;
    RETURN NULL;
  END IF;
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    delivery_from = least(v_today, (SELECT min(period) FROM public.white_label_charges WHERE invoice_id = v_inv.id)),
    delivery_to   = greatest(v_today, (SELECT max((period + interval '1 month' - interval '1 day')::date)
                                         FROM public.white_label_charges WHERE invoice_id = v_inv.id))
   WHERE id = v_inv.id RETURNING * INTO v_inv;
  RETURN v_inv;
END $$;

-- After issue: the part already collected through Stripe is recorded as
-- paid, once.
CREATE OR REPLACE FUNCTION public.settle_white_label_invoice(p_invoice uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv public.invoices%ROWTYPE; v_collected numeric;
BEGIN
  PERFORM public.require_billing_operator();
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice;
  v_collected := coalesce((SELECT sum(collected) FROM public.white_label_charges WHERE invoice_id = p_invoice), 0);
  IF v_collected > 0 AND v_inv.status <> 'draft'
     AND NOT EXISTS (SELECT 1 FROM public.invoice_payments WHERE invoice_id = p_invoice AND method = 'platform_fee') THEN
    v_inv := public.record_invoice_payment(p_invoice, least(v_collected, public.invoice_outstanding(v_inv)),
                                           v_inv.issue_date, 'platform_fee', 'Kept from customer payments (Stripe Connect)');
  END IF;
  RETURN v_inv;
END $$;


-- ── 7. Who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.white_label_event(uuid, text, jsonb),
  public.white_label_missing(uuid, text),
  public.request_white_label(uuid, text),
  public.set_white_label_brand(uuid, text, text, text, text, text, text, text, text, numeric),
  public.set_white_label_domain(uuid, text),
  public.set_white_label_site(uuid, text, text),
  public.import_site_template(jsonb),
  public.admin_update_site_template_page(text, text, text),
  public.admin_review_site_template(text, boolean, boolean, text),
  public.mark_white_label_domain_verified(uuid, text),
  public.accept_white_label_dpa(uuid, text),
  public.set_white_label_stripe_account(uuid, text, boolean),
  public.end_white_label(uuid, text),
  public.admin_decide_white_label(uuid, boolean, text),
  public.admin_set_white_label_status(uuid, text, text),
  public.admin_update_white_label_plan(text, numeric, numeric, numeric, numeric, boolean, boolean),
  public.white_label_public(text, text),
  public.white_label_stats(uuid),
  public.create_white_label_invoice(uuid, date),
  public.settle_white_label_invoice(uuid)
FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.white_label_event(uuid, text, jsonb), public.white_label_public(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION
  public.set_white_label_site(uuid, text, text),
  public.import_site_template(jsonb),
  public.admin_update_site_template_page(text, text, text),
  public.admin_review_site_template(text, boolean, boolean, text),
  public.white_label_missing(uuid, text),
  public.request_white_label(uuid, text),
  public.set_white_label_brand(uuid, text, text, text, text, text, text, text, text, numeric),
  public.set_white_label_domain(uuid, text),
  public.accept_white_label_dpa(uuid, text),
  public.end_white_label(uuid, text),
  public.admin_decide_white_label(uuid, boolean, text),
  public.admin_set_white_label_status(uuid, text, text),
  public.admin_update_white_label_plan(text, numeric, numeric, numeric, numeric, boolean, boolean),
  public.white_label_stats(uuid),
  public.create_white_label_invoice(uuid, date),
  public.settle_white_label_invoice(uuid),
  public.mark_white_label_domain_verified(uuid, text),
  public.set_white_label_stripe_account(uuid, text, boolean)
TO authenticated, service_role;
-- The public page reads through the server (it adds a signed logo link).
GRANT EXECUTE ON FUNCTION public.white_label_public(text, text) TO service_role;

-- ============================================================================
-- DONE
-- ============================================================================


-- ===== 00010_service_platform.sql =====
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


-- ===== 00011_company_invoicing.sql =====
-- ============================================================================
-- FlyttGo — invoices in a company's own name (sales invoicing)
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00010 (docs/SERVICE_PLATFORM.md).
-- A company with the module 'sales_invoicing' (its plan) invoices its own
-- customers through FlyttGo's invoice system (00008), as the seller:
--
--   * issuer_org is the company that sells; FlyttGo's own invoices have
--     none. Each issuer has its own number series ('org:<id>') without
--     gaps, and KIDs are unique per series. organization_id stays the
--     buyer company for FlyttGo's invoices and is empty on a company's
--     sales invoice, whose buyer (a person or a business) is the snapshot
--     in buyer, with customer_user_id when the buyer has an account.
--   * The seller's details (legal name, address, bank account, terms,
--     reminder fee) are the company's invoice settings; an invoice cannot be
--     issued until they are filled in.
--   * The company's owners, admins and finance operate its invoices
--     (issue, payments, reminders, credit notes); FlyttGo administrators
--     read them, and the buyer reads their own. FlyttGo's own invoices stay
--     FlyttGo's administrators' and the server's.
--   * Everything else is the same engine: legal content, final once issued,
--     credit notes, payments never more than owed, PDF and EHF.
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Invoices know who issued them ────────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS issuer_org       uuid REFERENCES public.organizations (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS series           text NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS customer_user_id uuid,
  ADD COLUMN IF NOT EXISTS terms_days       integer CHECK (terms_days IS NULL OR terms_days BETWEEN 0 AND 60),
  ADD COLUMN IF NOT EXISTS source_type      text CHECK (source_type IS NULL OR source_type IN ('job', 'appointment', 'manual')),
  ADD COLUMN IF NOT EXISTS source_id        uuid;
ALTER TABLE public.invoices ALTER COLUMN organization_id DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_issuer_or_buyer') THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_issuer_or_buyer CHECK (
          (issuer_org IS NULL AND organization_id IS NOT NULL AND series = 'main')
       OR (issuer_org IS NOT NULL AND series = 'org:' || issuer_org::text));
  END IF;
  -- Numbers and KIDs are unique per series.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_number_key') THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_number_key;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_series_number_key ON public.invoices (series, number) WHERE number IS NOT NULL;
DROP INDEX IF EXISTS public.invoices_kid_key;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_series_kid_key ON public.invoices (series, kid) WHERE kid IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_issuer_idx ON public.invoices (issuer_org, issue_date DESC) WHERE issuer_org IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_customer_idx ON public.invoices (customer_user_id) WHERE customer_user_id IS NOT NULL;
-- A card or Vipps payment is recorded once: the provider's reference (the
-- payment intent) is unique, so a second webhook delivery for the same
-- payment is refused (23505) and treated as already recorded.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_provider_ref_key ON public.invoice_payments (method, reference)
  WHERE method IN ('card', 'vipps') AND reference IS NOT NULL;


-- ── 2. A company's invoice settings (the seller on its invoices) ────────────
CREATE TABLE IF NOT EXISTS public.organization_invoice_settings (
  organization_id    uuid        PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  legal_name         text,
  address            text,
  postcode_city      text,
  email              text        CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone              text,
  bank_account       text        CHECK (bank_account IS NULL OR regexp_replace(bank_account, '[ .]', '', 'g') ~ '^[0-9]{11}$'),
  iban               text,
  bic                text,
  terms_days         integer     NOT NULL DEFAULT 14 CHECK (terms_days BETWEEN 0 AND 60),
  reminder_fee       numeric     NOT NULL DEFAULT 0 CHECK (reminder_fee >= 0),
  late_interest_pct  numeric     CHECK (late_interest_pct IS NULL OR late_interest_pct BETWEEN 0 AND 30),
  logo_on_invoices   boolean     NOT NULL DEFAULT true,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organization_invoice_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_invoice_settings_select ON public.organization_invoice_settings;
CREATE POLICY organization_invoice_settings_select ON public.organization_invoice_settings FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id, ARRAY['owner', 'admin', 'finance']));
REVOKE ALL ON public.organization_invoice_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organization_invoice_settings FROM authenticated;

CREATE OR REPLACE FUNCTION public.set_invoice_settings(p_org uuid, p jsonb)
RETURNS public.organization_invoice_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE s public.organization_invoice_settings%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'finance']);
  INSERT INTO public.organization_invoice_settings AS t (organization_id, legal_name, address, postcode_city, email, phone,
               bank_account, iban, bic, terms_days, reminder_fee, late_interest_pct, logo_on_invoices)
  VALUES (p_org, nullif(btrim(p ->> 'legal_name'), ''), nullif(btrim(p ->> 'address'), ''), nullif(btrim(p ->> 'postcode_city'), ''),
          lower(nullif(btrim(p ->> 'email'), '')), nullif(btrim(p ->> 'phone'), ''), nullif(btrim(p ->> 'bank_account'), ''),
          nullif(btrim(p ->> 'iban'), ''), nullif(btrim(p ->> 'bic'), ''), coalesce((p ->> 'terms_days')::int, 14),
          coalesce((p ->> 'reminder_fee')::numeric, 0), nullif(p ->> 'late_interest_pct', '')::numeric,
          coalesce((p ->> 'logo_on_invoices')::boolean, true))
  ON CONFLICT (organization_id) DO UPDATE SET
    legal_name = EXCLUDED.legal_name, address = EXCLUDED.address, postcode_city = EXCLUDED.postcode_city,
    email = EXCLUDED.email, phone = EXCLUDED.phone, bank_account = EXCLUDED.bank_account, iban = EXCLUDED.iban,
    bic = EXCLUDED.bic, terms_days = EXCLUDED.terms_days, reminder_fee = EXCLUDED.reminder_fee,
    late_interest_pct = EXCLUDED.late_interest_pct, logo_on_invoices = EXCLUDED.logo_on_invoices, updated_at = now()
  RETURNING * INTO s;
  PERFORM public.org_event(p_org, 'invoicing.settings', NULL, jsonb_build_object('legal_name', s.legal_name, 'terms_days', s.terms_days));
  RETURN s;
END $$;

-- The seller as the company's invoices state it.
CREATE OR REPLACE FUNCTION public.organization_seller(p_org uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'name', coalesce(s.legal_name, o.name), 'org_number', o.org_number, 'vat_registered', o.vat_registered,
    'address', coalesce(s.address, o.billing_address), 'postcode_city', s.postcode_city,
    'email', coalesce(s.email, o.billing_email), 'phone', s.phone,
    'bank_account', s.bank_account, 'iban', s.iban, 'bic', s.bic)
    FROM public.organizations o LEFT JOIN public.organization_invoice_settings s ON s.organization_id = o.id
   WHERE o.id = p_org;
$$;


-- ── 3. Who operates an invoice ──────────────────────────────────────────────
-- FlyttGo's invoices: its administrators and the server. A company's sales
-- invoices: its owners, admins and finance, and the server.
CREATE OR REPLACE FUNCTION public.require_invoice_operator(p_invoice uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_issuer uuid;
BEGIN
  SELECT issuer_org INTO v_issuer FROM public.invoices WHERE id = p_invoice;
  IF v_issuer IS NULL THEN PERFORM public.require_billing_operator(); RETURN; END IF;
  IF public.is_server() OR public.is_org_member(v_issuer, ARRAY['owner', 'admin', 'finance']) THEN RETURN; END IF;
  RAISE EXCEPTION 'invoices: the company''s owners, admins and finance only' USING ERRCODE = '42501';
END $$;

CREATE OR REPLACE FUNCTION public.can_read_invoice(p_invoice uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.id = p_invoice AND (
           (i.issuer_org IS NULL AND i.status <> 'draft'
            AND public.is_org_member(i.organization_id, ARRAY['owner', 'admin', 'finance']))
        OR (i.issuer_org IS NOT NULL AND public.is_org_member(i.issuer_org, ARRAY['owner', 'admin', 'finance']))
        OR (i.issuer_org IS NOT NULL AND i.status <> 'draft' AND i.customer_user_id = auth.uid())));
$$;


-- ── 4. A sales invoice: draft, lines ────────────────────────────────────────
-- p_lines: [{description, quantity, unit_price (excl. MVA), vat_rate}].
-- Called by the company's finance (create_sales_invoice) and by the Jobs
-- and Appointments modules after their own checks (internal).
CREATE OR REPLACE FUNCTION public.sales_invoice_draft(
  p_org uuid, p_customer jsonb, p_customer_user uuid, p_lines jsonb, p_reference text, p_notes text,
  p_source_type text, p_source_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv public.invoices%ROWTYPE; l jsonb; n int := 0; v_net numeric; v_vat numeric; v_rate numeric;
BEGIN
  IF NOT public.org_has_module(p_org, 'sales_invoicing') THEN
    RAISE EXCEPTION 'invoices: the company''s plan does not include invoicing' USING ERRCODE = '55000';
  END IF;
  IF coalesce(btrim(p_customer ->> 'name'), '') = '' THEN
    RAISE EXCEPTION 'invoices: the customer''s name is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'invoices: an invoice needs at least one line' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.invoices (issuer_org, series, organization_id, customer_user_id, buyer, reference, notes,
                               source_type, source_id, created_by)
  VALUES (p_org, 'org:' || p_org::text, NULL, p_customer_user,
          jsonb_build_object('name', btrim(p_customer ->> 'name'), 'email', lower(nullif(btrim(p_customer ->> 'email'), '')),
                             'address', p_customer ->> 'address', 'postcode_city', p_customer ->> 'postcode_city',
                             'org_number', nullif(btrim(p_customer ->> 'org_number'), ''),
                             'vat_registered', coalesce((p_customer ->> 'vat_registered')::boolean, false)),
          nullif(btrim(coalesce(p_reference, '')), ''), p_notes, p_source_type, p_source_id, auth.uid())
  RETURNING * INTO v_inv;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_rate := coalesce((l ->> 'vat_rate')::numeric, 25);
    IF coalesce(btrim(l ->> 'description'), '') = '' OR coalesce((l ->> 'quantity')::numeric, 0) <= 0
       OR coalesce((l ->> 'unit_price')::numeric, -1) < 0 THEN
      RAISE EXCEPTION 'invoices: each line needs a description, a quantity above 0 and a price' USING ERRCODE = '22023';
    END IF;
    v_net := round((l ->> 'quantity')::numeric * (l ->> 'unit_price')::numeric, 2);
    v_vat := round(v_net * v_rate / 100, 2);
    n := n + 1;
    INSERT INTO public.invoice_lines (invoice_id, line_no, description, quantity, unit_price, vat_rate, net_amount, vat_amount, total)
    VALUES (v_inv.id, n, btrim(l ->> 'description'), (l ->> 'quantity')::numeric, (l ->> 'unit_price')::numeric, v_rate,
            v_net, v_vat, v_net + v_vat);
  END LOOP;
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    delivery_from = (now() AT TIME ZONE 'Europe/Oslo')::date, delivery_to = (now() AT TIME ZONE 'Europe/Oslo')::date
   WHERE id = v_inv.id RETURNING * INTO v_inv;
  RETURN v_inv;
END $$;
REVOKE ALL ON FUNCTION public.sales_invoice_draft(uuid, jsonb, uuid, jsonb, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_sales_invoice(
  p_org uuid, p_customer jsonb, p_customer_user uuid, p_lines jsonb, p_reference text, p_notes text)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_server() THEN PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'finance']); END IF;
  RETURN public.sales_invoice_draft(p_org, p_customer, p_customer_user, p_lines, p_reference, p_notes, 'manual', NULL);
END $$;


-- ── 5. The engine's functions, for both kinds of issuer ─────────────────────
CREATE OR REPLACE FUNCTION public.add_invoice_line(p_invoice uuid, p_description text, p_quantity numeric,
                                                  p_unit_price numeric, p_vat_rate numeric DEFAULT 25)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv public.invoices%ROWTYPE; v_net numeric; v_vat numeric;
BEGIN
  PERFORM public.require_invoice_operator(p_invoice);
  IF coalesce(btrim(p_description), '') = '' OR p_quantity <= 0 OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'a line needs a description, a quantity above 0 and a price' USING ERRCODE = '22023';
  END IF;
  v_net := round(p_quantity * p_unit_price, 2);
  v_vat := round(v_net * p_vat_rate / 100, 2);
  INSERT INTO public.invoice_lines (invoice_id, line_no, description, quantity, unit_price, vat_rate, net_amount, vat_amount, total)
  VALUES (p_invoice, coalesce((SELECT max(line_no) FROM public.invoice_lines WHERE invoice_id = p_invoice), 0) + 1,
          btrim(p_description), p_quantity, p_unit_price, p_vat_rate, v_net, v_vat, v_net + v_vat);
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = p_invoice),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = p_invoice),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = p_invoice),
    updated_at = now()
   WHERE id = p_invoice RETURNING * INTO v_inv;
  RETURN v_inv;
END $$;

CREATE OR REPLACE FUNCTION public.delete_invoice_draft(p_invoice uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.require_invoice_operator(p_invoice);
  DELETE FROM public.invoices WHERE id = p_invoice AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'only a draft can be deleted' USING ERRCODE = '55000'; END IF;
END $$;

-- Issue: the next number in the issuer's series, today's date, the due
-- date (FlyttGo: the buyer company's terms; a company: its settings or the
-- invoice's own terms), KID, and snapshots of seller, buyer and branding.
CREATE OR REPLACE FUNCTION public.issue_invoice(p_invoice uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv    public.invoices%ROWTYPE;
  v_org    public.organizations%ROWTYPE;
  v_set    public.organization_invoice_settings%ROWTYPE;
  v_seller jsonb;
  v_number bigint;
  v_issue  date := (now() AT TIME ZONE 'Europe/Oslo')::date;
BEGIN
  PERFORM public.require_invoice_operator(p_invoice);
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found' USING ERRCODE = 'P0002'; END IF;
  IF v_inv.status <> 'draft' THEN RAISE EXCEPTION 'invoice % is already issued', v_inv.number USING ERRCODE = '55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoice_lines WHERE invoice_id = p_invoice) THEN
    RAISE EXCEPTION 'an invoice needs at least one line' USING ERRCODE = '22023';
  END IF;
  v_seller := CASE WHEN v_inv.issuer_org IS NULL THEN public.invoice_seller() ELSE public.organization_seller(v_inv.issuer_org) END;
  IF v_seller ->> 'name' IS NULL OR v_seller ->> 'org_number' IS NULL OR v_seller ->> 'bank_account' IS NULL
     OR v_seller ->> 'address' IS NULL THEN
    RAISE EXCEPTION 'fill in the seller''s name, organisation number, address and bank account in the invoice settings first'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.invoice_counters (series, next_number) VALUES (v_inv.series, 1) ON CONFLICT (series) DO NOTHING;
  UPDATE public.invoice_counters SET next_number = next_number + 1 WHERE series = v_inv.series
  RETURNING next_number - 1 INTO v_number;

  IF v_inv.issuer_org IS NULL THEN
    SELECT * INTO v_org FROM public.organizations WHERE id = v_inv.organization_id;
    UPDATE public.invoices SET
      number     = v_number,
      status     = 'issued',
      issue_date = v_issue,
      due_date   = CASE WHEN kind = 'credit_note' THEN v_issue
                        ELSE public.invoice_due_date(v_issue, v_org.payment_terms_type, v_org.payment_terms_days, v_org.payment_terms_day) END,
      kid        = CASE WHEN kind = 'invoice' THEN public.kid_mod10(lpad(v_number::text, 8, '0')) END,
      seller     = v_seller,
      buyer      = jsonb_build_object('name', v_org.name, 'org_number', v_org.org_number, 'country', v_org.country,
                                      'address', v_org.billing_address, 'email', v_org.billing_email,
                                      'customer_number', v_org.customer_number, 'vat_registered', v_org.vat_registered),
      branding   = CASE WHEN v_org.billing_plan = 'special'
                        THEN jsonb_build_object('name', v_org.name, 'logo_path', v_org.logo_path) END,
      reference  = coalesce(reference, v_org.invoice_reference),
      issued_by  = auth.uid(),
      updated_at = now()
     WHERE id = p_invoice RETURNING * INTO v_inv;
  ELSE
    SELECT * INTO v_org FROM public.organizations WHERE id = v_inv.issuer_org;
    SELECT * INTO v_set FROM public.organization_invoice_settings WHERE organization_id = v_inv.issuer_org;
    UPDATE public.invoices SET
      number     = v_number,
      status     = 'issued',
      issue_date = v_issue,
      due_date   = CASE WHEN kind = 'credit_note' THEN v_issue ELSE v_issue + coalesce(terms_days, v_set.terms_days, 14) END,
      kid        = CASE WHEN kind = 'invoice' THEN public.kid_mod10(lpad(v_number::text, 8, '0')) END,
      seller     = v_seller,
      -- The company's own invoice: its name and logo head it; the seller
      -- is the company itself (no "issued by FlyttGo" footer).
      branding   = CASE WHEN coalesce(v_set.logo_on_invoices, true) AND v_org.logo_path IS NOT NULL
                        THEN jsonb_build_object('name', v_seller ->> 'name', 'logo_path', v_org.logo_path, 'own', true) END,
      issued_by  = auth.uid(),
      updated_at = now()
     WHERE id = p_invoice RETURNING * INTO v_inv;
  END IF;
  PERFORM public.invoice_event(p_invoice, 'invoice.issued', jsonb_build_object('number', v_number, 'series', v_inv.series, 'total', v_inv.total));

  -- A credit note reduces what its invoice still owes.
  IF v_inv.kind = 'credit_note' THEN
    UPDATE public.invoices o SET amount_credited = o.amount_credited - v_inv.total, updated_at = now()
     WHERE o.id = v_inv.credits_invoice_id;
    PERFORM public.invoice_settle_status(v_inv.credits_invoice_id);
  END IF;
  RETURN v_inv;
END $$;

-- A credit note for the whole invoice (p_amount NULL) or part of it, in the
-- same series and to the same buyer. Issued at once.
CREATE OR REPLACE FUNCTION public.create_credit_note(p_invoice uuid, p_amount numeric, p_reason text)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_cn  public.invoices%ROWTYPE;
  v_left numeric;
  v_net numeric;
BEGIN
  PERFORM public.require_invoice_operator(p_invoice);
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'a credit note needs a reason' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR v_inv.kind <> 'invoice' OR v_inv.status = 'draft' THEN
    RAISE EXCEPTION 'only an issued invoice can be credited' USING ERRCODE = '55000';
  END IF;
  v_left := v_inv.total - v_inv.amount_credited;
  IF p_amount IS NOT NULL AND (p_amount <= 0 OR p_amount > v_left) THEN
    RAISE EXCEPTION 'credit between 0 and % NOK', v_left USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invoices (kind, credits_invoice_id, organization_id, issuer_org, series, customer_user_id, buyer,
                               notes, reference, delivery_from, delivery_to, created_by)
  VALUES ('credit_note', p_invoice, v_inv.organization_id, v_inv.issuer_org, v_inv.series, v_inv.customer_user_id,
          CASE WHEN v_inv.issuer_org IS NOT NULL THEN v_inv.buyer END,
          'Credit note for invoice ' || v_inv.number || ': ' || btrim(p_reason), v_inv.reference,
          v_inv.delivery_from, v_inv.delivery_to, auth.uid())
  RETURNING * INTO v_cn;

  IF p_amount IS NULL AND v_inv.amount_credited = 0 THEN
    INSERT INTO public.invoice_lines (invoice_id, line_no, booking_id, is_credit, description, quantity, unit_price,
                                      vat_rate, net_amount, vat_amount, total)
    SELECT v_cn.id, line_no, booking_id, true, 'Credit: ' || description, quantity, -unit_price, vat_rate,
           -net_amount, -vat_amount, -total
      FROM public.invoice_lines WHERE invoice_id = p_invoice;
  ELSE
    v_net := round(coalesce(p_amount, v_left) / 1.25, 2);
    INSERT INTO public.invoice_lines (invoice_id, line_no, is_credit, description, quantity, unit_price, vat_rate,
                                      net_amount, vat_amount, total)
    VALUES (v_cn.id, 1, true, 'Credit of invoice ' || v_inv.number || ': ' || btrim(p_reason), 1, -v_net, 25,
            -v_net, -(coalesce(p_amount, v_left) - v_net), -coalesce(p_amount, v_left));
  END IF;
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_cn.id),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_cn.id),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_cn.id)
   WHERE id = v_cn.id;
  PERFORM public.invoice_event(p_invoice, 'invoice.credited', jsonb_build_object('reason', p_reason, 'amount', p_amount));
  RETURN public.issue_invoice(v_cn.id);
END $$;

-- A payment against an invoice. Never more than is owed.
CREATE OR REPLACE FUNCTION public.record_invoice_payment(p_invoice uuid, p_amount numeric, p_paid_on date,
                                                        p_method text, p_reference text)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv public.invoices%ROWTYPE;
BEGIN
  PERFORM public.require_invoice_operator(p_invoice);
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR v_inv.kind <> 'invoice' OR v_inv.status = 'draft' THEN
    RAISE EXCEPTION 'payments are recorded against issued invoices' USING ERRCODE = '55000';
  END IF;
  IF p_amount <= 0 OR p_amount > public.invoice_outstanding(v_inv) THEN
    RAISE EXCEPTION 'payment of % NOK is more than the % NOK owed', p_amount, public.invoice_outstanding(v_inv) USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.invoice_payments (invoice_id, amount, paid_on, method, reference, recorded_by)
  VALUES (p_invoice, p_amount, coalesce(p_paid_on, current_date), p_method, nullif(btrim(coalesce(p_reference, '')), ''), auth.uid());
  UPDATE public.invoices SET amount_paid = amount_paid + p_amount, updated_at = now() WHERE id = p_invoice;
  PERFORM public.invoice_settle_status(p_invoice);
  PERFORM public.invoice_event(p_invoice, 'invoice.payment', jsonb_build_object('amount', p_amount, 'method', p_method, 'reference', p_reference));
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice;
  RETURN v_inv;
END $$;

-- FlyttGo's bank file: its own series only.
CREATE OR REPLACE FUNCTION public.record_payment_by_kid(p_kid text, p_amount numeric, p_paid_on date, p_bank_reference text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.require_billing_operator();
  IF p_bank_reference IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_payments
                                               WHERE method = 'bank' AND reference = p_bank_reference) THEN
    RETURN (SELECT invoice_id FROM public.invoice_payments WHERE method = 'bank' AND reference = p_bank_reference);
  END IF;
  SELECT id INTO v_id FROM public.invoices WHERE series = 'main' AND kid = regexp_replace(coalesce(p_kid, ''), '\s', '', 'g');
  IF v_id IS NULL THEN RETURN NULL; END IF;
  PERFORM public.record_invoice_payment(v_id, p_amount, p_paid_on, 'bank', p_bank_reference);
  RETURN v_id;
END $$;

-- A reminder: the fee and interest from FlyttGo's settings for its own
-- invoices, from the company's for its sales invoices.
CREATE OR REPLACE FUNCTION public.record_invoice_reminder(p_invoice uuid)
RETURNS public.invoice_reminders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_rem public.invoice_reminders%ROWTYPE;
  v_fee numeric;
  v_pct numeric;
  v_interest numeric := 0;
BEGIN
  PERFORM public.require_invoice_operator(p_invoice);
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR v_inv.kind <> 'invoice' OR v_inv.status NOT IN ('issued', 'partially_paid') THEN
    RAISE EXCEPTION 'only an unpaid issued invoice gets a reminder' USING ERRCODE = '55000';
  END IF;
  IF v_inv.due_date >= (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'invoice % is not overdue', v_inv.number USING ERRCODE = '55000';
  END IF;
  IF v_inv.issuer_org IS NULL THEN
    v_fee := coalesce(public.config_text('invoice_reminder_fee')::numeric, 0);
    v_pct := public.config_text('invoice_late_interest_pct')::numeric;
  ELSE
    SELECT coalesce(reminder_fee, 0), late_interest_pct INTO v_fee, v_pct
      FROM public.organization_invoice_settings WHERE organization_id = v_inv.issuer_org;
    v_fee := coalesce(v_fee, 0);
  END IF;
  IF v_pct IS NOT NULL THEN
    -- Simple interest on what is owed (without earlier fees) since the due date.
    v_interest := round((v_inv.total - v_inv.amount_paid - v_inv.amount_credited) * v_pct / 100
                        * ((now() AT TIME ZONE 'Europe/Oslo')::date - v_inv.due_date) / 365.0, 2);
  END IF;
  INSERT INTO public.invoice_reminders (invoice_id, level, fee, interest)
  VALUES (p_invoice, v_inv.reminder_level + 1, v_fee, v_interest) RETURNING * INTO v_rem;
  UPDATE public.invoices SET reminder_level = v_rem.level, fees_total = fees_total + v_fee + v_interest, updated_at = now()
   WHERE id = p_invoice;
  PERFORM public.invoice_event(p_invoice, 'invoice.reminder', jsonb_build_object('level', v_rem.level, 'fee', v_fee, 'interest', v_interest));
  RETURN v_rem;
END $$;

CREATE OR REPLACE FUNCTION public.mark_invoice_sent(p_invoice uuid, p_channel text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.require_invoice_operator(p_invoice);
  UPDATE public.invoices SET sent_at = now(), updated_at = now() WHERE id = p_invoice AND status <> 'draft';
  PERFORM public.invoice_event(p_invoice, 'invoice.sent', jsonb_build_object('channel', p_channel));
END $$;


-- ── 6. Who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.set_invoice_settings(uuid, jsonb), public.organization_seller(uuid),
  public.require_invoice_operator(uuid), public.create_sales_invoice(uuid, jsonb, uuid, jsonb, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organization_seller(uuid), public.require_invoice_operator(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_invoice_settings(uuid, jsonb), public.create_sales_invoice(uuid, jsonb, uuid, jsonb, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.organization_seller(uuid), public.require_invoice_operator(uuid),
  public.sales_invoice_draft(uuid, jsonb, uuid, jsonb, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_invoice_sent(uuid, text) TO authenticated;

-- ============================================================================
-- DONE
-- ============================================================================


-- ===== 00012_jobs.sql =====
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


-- ===== 00013_appointments.sql =====
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


-- ===== 00014_accounting_core.sql =====
-- ============================================================================
-- 00014 — Accounting core: double-entry books on Norwegian rules
-- ============================================================================
--
-- PORTABLE. This file knows nothing about FlyttGo. It is copied unchanged
-- into another Supabase project (Ledgera, ICOFCUCAM/FlyttgoTechGroup); the
-- host then supplies its adapter, the accounting.host_* functions below
-- (FlyttGo's: 00015_accounting_flyttgo.sql). Contract: docs/ACCOUNTING_CORE.md.
--
--   * Everything is in the schema `accounting` (expose it to the API).
--   * A ledger per tenant (a company of the host), and one "house" ledger
--     for the host itself (tenant null). A tenant asks for it; the host's
--     operator approves it with its monthly price.
--   * Vouchers (bilag) are numbered per ledger and year without gaps, and
--     are never changed or deleted. A mistake is corrected by a reversing
--     voucher. Lines are written only with their voucher, and a voucher
--     balances (checked at commit). Receipts are kept with their SHA-256 and
--     never removed. Closed periods are never opened again.
--   * MVA on the standard SAF-T codes; terms two-monthly or yearly.
--   * Reports: trial balance, general ledger, income statement, balance
--     sheet, MVA per term. The accountant package and SAF-T are built from
--     them (docs/ACCOUNTING_CORE.md).
--   * The host posts its own events (its invoices, payments …) through
--     accounting.post_entry(), once per source.
--   * The company's back office: its owners and admins (the host says who)
--     invite the people who work on the books: accountant (keeps and closes
--     them), bookkeeper (posts vouchers), external auditor (reads everything
--     and writes notes, for a set time) and viewer (reads). Removed people
--     are kept in the list with a reason; nothing is deleted.
--
-- Safe to re-run. Rollback: drop the schema after the host's adapter
-- (FlyttGo: supabase/rollback/00014_down.sql).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS accounting;
GRANT USAGE ON SCHEMA accounting TO authenticated, service_role;
REVOKE ALL ON SCHEMA accounting FROM anon;


-- ── 0. The host adapter (deny-all until the host replaces it) ──────────────
-- The host defines, with CREATE OR REPLACE:
--   host_can_keep(tenant)    the caller reads and keeps that tenant's books
--                            (tenant null: the house books)
--   host_can_manage(tenant)  the caller asks for or ends the tenant's ledger
--   host_is_operator()       the caller runs the platform (approves ledgers)
--   host_is_server()         the request comes from the host's server
--   host_tenant(tenant)      {legal_name, org_number, vat_registered, active}
--   host_event(tenant, action, details)  the host's own log (may do nothing)
DO $$
BEGIN
  IF to_regprocedure('accounting.host_can_keep(uuid)') IS NULL THEN
    CREATE FUNCTION accounting.host_can_keep(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
  END IF;
  IF to_regprocedure('accounting.host_can_manage(uuid)') IS NULL THEN
    CREATE FUNCTION accounting.host_can_manage(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
  END IF;
  IF to_regprocedure('accounting.host_is_operator()') IS NULL THEN
    CREATE FUNCTION accounting.host_is_operator() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
  END IF;
  IF to_regprocedure('accounting.host_is_server()') IS NULL THEN
    CREATE FUNCTION accounting.host_is_server() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
  END IF;
  IF to_regprocedure('accounting.host_tenant(uuid)') IS NULL THEN
    CREATE FUNCTION accounting.host_tenant(p_tenant uuid) RETURNS jsonb LANGUAGE sql STABLE AS 'SELECT NULL::jsonb';
  END IF;
  IF to_regprocedure('accounting.host_event(uuid,text,jsonb)') IS NULL THEN
    CREATE FUNCTION accounting.host_event(p_tenant uuid, p_action text, p_details jsonb) RETURNS void LANGUAGE sql AS 'SELECT';
  END IF;
END $$;


-- ── 1. MVA codes (SAF-T standard tax codes) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting.mva_codes (
  code        text    PRIMARY KEY,
  direction   text    NOT NULL CHECK (direction IN ('output', 'input', 'none')),
  rate        numeric NOT NULL CHECK (rate IN (0, 12, 15, 25)),
  description text    NOT NULL,
  sort        integer NOT NULL
);
INSERT INTO accounting.mva_codes (code, direction, rate, description, sort) VALUES
  ('0',  'none',   0,  'Ingen mva-behandling', 0),
  ('1',  'input',  25, 'Fradrag for inngående mva, høy sats', 10),
  ('11', 'input',  15, 'Fradrag for inngående mva, middels sats', 11),
  ('13', 'input',  12, 'Fradrag for inngående mva, lav sats', 13),
  ('3',  'output', 25, 'Utgående mva, høy sats', 30),
  ('31', 'output', 15, 'Utgående mva, middels sats', 31),
  ('33', 'output', 12, 'Utgående mva, lav sats', 33),
  ('5',  'output', 0,  'Innenlands omsetning fritatt for mva (nullsats)', 50),
  ('6',  'none',   0,  'Omsetning utenfor merverdiavgiftsloven', 60)
ON CONFLICT (code) DO NOTHING;


-- ── 2. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting.ledgers (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        UNIQUE,                     -- null: the house ledger
  status         text        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'active', 'declined', 'ended')),
  legal_name     text        NOT NULL,
  org_number     text,
  vat_registered boolean     NOT NULL DEFAULT false,
  mva_term       text        NOT NULL DEFAULT 'bimonthly' CHECK (mva_term IN ('bimonthly', 'yearly')),
  zero_rate_code text        NOT NULL DEFAULT '6' CHECK (zero_rate_code IN ('5', '6')),
  start_date     date        NOT NULL CHECK (extract(day FROM start_date) = 1),
  auto_post      boolean     NOT NULL DEFAULT true,
  locked_until   date,
  monthly_fee    numeric     CHECK (monthly_fee IS NULL OR monthly_fee >= 0),   -- agreed price; null: the host's price list
  declared_turnover numeric  CHECK (declared_turnover IS NULL OR declared_turnover >= 0),  -- a year's income, as the company states it at the start
  requested_by   uuid,
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  ended_at       timestamptz,
  cancel_at      date,                       -- the last day of service after a cancellation (end of the paid month)
  cancel_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledgers_lock_after_start CHECK (locked_until IS NULL OR locked_until >= start_date - 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS ledgers_one_house ON accounting.ledgers ((true)) WHERE tenant_id IS NULL;
ALTER TABLE accounting.ledgers ADD COLUMN IF NOT EXISTS cancel_at date, ADD COLUMN IF NOT EXISTS cancel_reason text;

CREATE TABLE IF NOT EXISTS accounting.accounts (
  ledger_id        uuid    NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  code             text    NOT NULL CHECK (code ~ '^[1-8][0-9]{3}$'),
  name             text    NOT NULL CHECK (btrim(name) <> ''),
  default_mva_code text    REFERENCES accounting.mva_codes (code),
  -- SAF-T 1.30 grouping (Skatteetaten's næringsspesifikasjon code list):
  -- what the account is in the business tax return.
  grouping_category text,
  grouping_code     text,
  active           boolean NOT NULL DEFAULT true,
  PRIMARY KEY (ledger_id, code),
  CONSTRAINT accounts_grouping CHECK ((grouping_category IS NULL) = (grouping_code IS NULL))
);
ALTER TABLE accounting.accounts ADD COLUMN IF NOT EXISTS grouping_category text, ADD COLUMN IF NOT EXISTS grouping_code text;

-- Which account each kind of posting uses (the host's postings and MVA).
CREATE TABLE IF NOT EXISTS accounting.posting_accounts (
  ledger_id    uuid NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  key          text NOT NULL CHECK (key ~ '^[a-z0-9_]+$'),
  account_code text NOT NULL,
  PRIMARY KEY (ledger_id, key),
  FOREIGN KEY (ledger_id, account_code) REFERENCES accounting.accounts (ledger_id, code)
);

CREATE TABLE IF NOT EXISTS accounting.counters (
  ledger_id   uuid    NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  year        integer NOT NULL,
  next_number integer NOT NULL,
  PRIMARY KEY (ledger_id, year)
);

CREATE TABLE IF NOT EXISTS accounting.vouchers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id        uuid        NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  year             integer     NOT NULL,
  number           integer     NOT NULL,
  voucher_date     date        NOT NULL,
  description      text        NOT NULL CHECK (btrim(description) <> ''),
  source_type      text        NOT NULL CHECK (source_type ~ '^[a-z_]+$'),   -- manual, reversal, or the host's
  source_id        uuid,
  reverses_voucher uuid        REFERENCES accounting.vouchers (id),
  posted_by        uuid,
  posted_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ledger_id, year, number),
  CONSTRAINT vouchers_year CHECK (year = extract(year FROM voucher_date)::int),
  CONSTRAINT vouchers_reversal CHECK ((source_type = 'reversal') = (reverses_voucher IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_source_key ON accounting.vouchers (ledger_id, source_type, source_id) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_reversed_once ON accounting.vouchers (reverses_voucher) WHERE reverses_voucher IS NOT NULL;
CREATE INDEX IF NOT EXISTS vouchers_ledger_date_idx ON accounting.vouchers (ledger_id, voucher_date);

CREATE TABLE IF NOT EXISTS accounting.voucher_lines (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id   uuid    NOT NULL REFERENCES accounting.vouchers (id) ON DELETE RESTRICT,
  ledger_id    uuid    NOT NULL,
  line_no      integer NOT NULL,
  account_code text    NOT NULL,
  debit        numeric NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit       numeric NOT NULL DEFAULT 0 CHECK (credit >= 0),
  mva_code     text    REFERENCES accounting.mva_codes (code),
  mva_role     text    CHECK (mva_role IN ('basis', 'vat')),
  description  text,
  party        text,                 -- customer or supplier, as on the document
  ref          uuid,                 -- the host's document (e.g. an invoice)
  UNIQUE (voucher_id, line_no),
  FOREIGN KEY (ledger_id, account_code) REFERENCES accounting.accounts (ledger_id, code),
  CONSTRAINT voucher_lines_one_side CHECK ((debit > 0) <> (credit > 0) AND debit = round(debit, 2) AND credit = round(credit, 2)),
  CONSTRAINT voucher_lines_mva CHECK ((mva_code IS NULL) = (mva_role IS NULL))
);
CREATE INDEX IF NOT EXISTS voucher_lines_account_idx ON accounting.voucher_lines (ledger_id, account_code);

CREATE TABLE IF NOT EXISTS accounting.attachments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id   uuid        NOT NULL REFERENCES accounting.vouchers (id) ON DELETE RESTRICT,
  storage_path text        NOT NULL UNIQUE,
  file_name    text        NOT NULL,
  sha256       text        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes   bigint      NOT NULL CHECK (size_bytes > 0),
  uploaded_by  uuid,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounting.events (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ledger_id  uuid        NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  actor_id   uuid,
  action     text        NOT NULL,
  details    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_ledger_idx ON accounting.events (ledger_id, created_at);

-- The people who work on a company's books besides its owners and admins.
CREATE TABLE IF NOT EXISTS accounting.members (
  ledger_id      uuid        NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  user_id        uuid        NOT NULL,
  role           text        NOT NULL CHECK (role IN ('accountant', 'bookkeeper', 'auditor', 'viewer')),
  name           text,
  email          text,
  firm           text,                       -- the accounting or audit firm, when there is one
  valid_until    date,                       -- access ends after this day (an auditor's engagement)
  status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  added_by       uuid,
  added_at       timestamptz NOT NULL DEFAULT now(),
  removed_by     uuid,
  removed_at     timestamptz,
  removed_reason text,
  PRIMARY KEY (ledger_id, user_id)
);

CREATE TABLE IF NOT EXISTS accounting.invitations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id   uuid        NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  email       text        NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+$'),
  role        text        NOT NULL CHECK (role IN ('accountant', 'bookkeeper', 'auditor', 'viewer')),
  name        text,
  firm        text,
  valid_until date,
  token_hash  text        NOT NULL UNIQUE,          -- hex SHA-256 of the token, which is shown once
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_by uuid,
  accepted_at timestamptz
);
CREATE INDEX IF NOT EXISTS invitations_ledger_idx ON accounting.invitations (ledger_id, status);

-- Notes on the books (an auditor's remarks, an accountant's questions), on
-- the ledger or one voucher. Written once.
CREATE TABLE IF NOT EXISTS accounting.notes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id  uuid        NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  voucher_id uuid        REFERENCES accounting.vouchers (id) ON DELETE RESTRICT,
  author_id  uuid,
  role       text        NOT NULL,
  body       text        NOT NULL CHECK (btrim(body) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_ledger_idx ON accounting.notes (ledger_id, created_at);


-- ── 3. The books can't be changed ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION accounting.guard_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'accounting: % is written once and never changed', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS guard_vouchers ON accounting.vouchers;
CREATE TRIGGER guard_vouchers BEFORE UPDATE OR DELETE ON accounting.vouchers FOR EACH ROW EXECUTE FUNCTION accounting.guard_append_only();
DROP TRIGGER IF EXISTS guard_voucher_lines ON accounting.voucher_lines;
CREATE TRIGGER guard_voucher_lines BEFORE UPDATE OR DELETE ON accounting.voucher_lines FOR EACH ROW EXECUTE FUNCTION accounting.guard_append_only();
DROP TRIGGER IF EXISTS guard_attachments ON accounting.attachments;
CREATE TRIGGER guard_attachments BEFORE UPDATE OR DELETE ON accounting.attachments FOR EACH ROW EXECUTE FUNCTION accounting.guard_append_only();
DROP TRIGGER IF EXISTS guard_events ON accounting.events;
CREATE TRIGGER guard_events BEFORE UPDATE OR DELETE ON accounting.events FOR EACH ROW EXECUTE FUNCTION accounting.guard_append_only();
DROP TRIGGER IF EXISTS guard_notes ON accounting.notes;
CREATE TRIGGER guard_notes BEFORE UPDATE OR DELETE ON accounting.notes FOR EACH ROW EXECUTE FUNCTION accounting.guard_append_only();

CREATE OR REPLACE FUNCTION accounting.guard_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'accounting: a ledger is never deleted' USING ERRCODE = '42501'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR (NEW.start_date <> OLD.start_date AND EXISTS (SELECT 1 FROM accounting.vouchers WHERE ledger_id = OLD.id)) THEN
    RAISE EXCEPTION 'accounting: the ledger''s tenant and, once it has vouchers, its start date are fixed' USING ERRCODE = '42501';
  END IF;
  IF OLD.locked_until IS NOT NULL AND (NEW.locked_until IS NULL OR NEW.locked_until < OLD.locked_until) THEN
    RAISE EXCEPTION 'accounting: a closed period is never opened again' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'ended' AND NEW.status <> 'ended' THEN
    RAISE EXCEPTION 'accounting: an ended ledger stays ended' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_ledgers ON accounting.ledgers;
CREATE TRIGGER guard_ledgers BEFORE UPDATE OR DELETE ON accounting.ledgers FOR EACH ROW EXECUTE FUNCTION accounting.guard_ledger();

CREATE OR REPLACE FUNCTION accounting.guard_account_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'accounting: accounts are never deleted; make them inactive' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS guard_accounts ON accounting.accounts;
CREATE TRIGGER guard_accounts BEFORE DELETE ON accounting.accounts FOR EACH ROW EXECUTE FUNCTION accounting.guard_account_delete();

-- Lines are written with their voucher (in the same transaction) and in
-- its ledger; every voucher has two lines or more and balances at commit.
-- The checks see every line, whoever commits.
CREATE OR REPLACE FUNCTION accounting.check_line()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v accounting.vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v FROM accounting.vouchers WHERE id = NEW.voucher_id;
  IF v.posted_at <> now() THEN
    RAISE EXCEPTION 'accounting: lines are added only when their voucher is posted' USING ERRCODE = '42501';
  END IF;
  IF NEW.ledger_id <> v.ledger_id THEN RAISE EXCEPTION 'accounting: a line belongs to its voucher''s ledger' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS check_line ON accounting.voucher_lines;
CREATE TRIGGER check_line BEFORE INSERT ON accounting.voucher_lines FOR EACH ROW EXECUTE FUNCTION accounting.check_line();

CREATE OR REPLACE FUNCTION accounting.check_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid; n integer; d numeric; c numeric;
BEGIN
  IF TG_TABLE_NAME = 'vouchers' THEN v_id := NEW.id; ELSE v_id := (to_jsonb(NEW) ->> 'voucher_id')::uuid; END IF;
  SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO n, d, c FROM accounting.voucher_lines WHERE voucher_id = v_id;
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'accounting: voucher does not balance: debit % and credit % on % lines', d, c, n USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS check_balance ON accounting.vouchers;
CREATE CONSTRAINT TRIGGER check_balance AFTER INSERT ON accounting.vouchers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accounting.check_balance();
DROP TRIGGER IF EXISTS check_lines_balance ON accounting.voucher_lines;
CREATE CONSTRAINT TRIGGER check_lines_balance AFTER INSERT ON accounting.voucher_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accounting.check_balance();


-- ── 4. Who reads and keeps the books ────────────────────────────────────────
-- The caller's role in a ledger: 'owner' (the company's owners and admins,
-- or for the house ledger the host's keepers, as the host says), or the role
-- they were given in the back office while it lasts; null otherwise.
CREATE OR REPLACE FUNCTION accounting.role_of(p_ledger uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN accounting.host_can_keep(l.tenant_id) THEN 'owner'
              ELSE (SELECT m.role FROM accounting.members m
                     WHERE m.ledger_id = l.id AND m.user_id = auth.uid() AND m.status = 'active'
                       AND (m.valid_until IS NULL OR m.valid_until >= (now() AT TIME ZONE 'Europe/Oslo')::date)) END
    FROM accounting.ledgers l WHERE l.id = p_ledger;
$$;

CREATE OR REPLACE FUNCTION accounting.can_read(p_ledger uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT accounting.role_of(p_ledger) IS NOT NULL $$;

-- Who manages the back office: the company's owners and admins (the host's
-- operator for the house ledger).
CREATE OR REPLACE FUNCTION accounting.can_manage(p_ledger uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM accounting.ledgers l WHERE l.id = p_ledger
     AND CASE WHEN l.tenant_id IS NULL THEN accounting.host_is_operator() AND accounting.host_can_keep(NULL)
              ELSE accounting.host_can_manage(l.tenant_id) END);
$$;

CREATE OR REPLACE FUNCTION accounting.require_reader(p_ledger uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (accounting.can_read(p_ledger) OR accounting.host_is_server()) THEN
    RAISE EXCEPTION 'accounting: only those who keep these books' USING ERRCODE = '42501';
  END IF;
END $$;

-- An active ledger and a caller in one of the roles. Posting: owner,
-- accountant, bookkeeper. Closing (periods, MVA terms, the year), settings
-- and the chart of accounts: owner, accountant.
CREATE OR REPLACE FUNCTION accounting.require_role(p_ledger uuid, p_roles text[])
RETURNS accounting.ledgers
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE; r text;
BEGIN
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no such ledger' USING ERRCODE = '42704'; END IF;
  r := accounting.role_of(p_ledger);
  IF auth.uid() IS NULL OR r IS NULL OR NOT r = ANY (p_roles) THEN
    RAISE EXCEPTION 'accounting: requires role %', array_to_string(p_roles, ' or ') USING ERRCODE = '42501';
  END IF;
  IF l.status <> 'active' THEN RAISE EXCEPTION 'accounting: the ledger is %', l.status USING ERRCODE = '55000'; END IF;
  RETURN l;
END $$;

CREATE OR REPLACE FUNCTION accounting.log(p_ledger uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO accounting.events (ledger_id, actor_id, action, details) VALUES (p_ledger, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

ALTER TABLE accounting.mva_codes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.ledgers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.accounts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.posting_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.counters         ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.vouchers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.voucher_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.attachments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.events           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mva_codes_read ON accounting.mva_codes;
CREATE POLICY mva_codes_read ON accounting.mva_codes FOR SELECT TO authenticated USING (true);
-- The ledger row: its keepers, and the host's operator (who approves it and
-- sets its price) sees the row, never the books.
DROP POLICY IF EXISTS ledgers_read ON accounting.ledgers;
CREATE POLICY ledgers_read ON accounting.ledgers FOR SELECT TO authenticated
  USING (accounting.host_is_operator() OR accounting.can_read(id) OR accounting.can_manage(id));
DROP POLICY IF EXISTS accounts_read ON accounting.accounts;
CREATE POLICY accounts_read ON accounting.accounts FOR SELECT TO authenticated USING (accounting.can_read(ledger_id));
DROP POLICY IF EXISTS posting_accounts_read ON accounting.posting_accounts;
CREATE POLICY posting_accounts_read ON accounting.posting_accounts FOR SELECT TO authenticated USING (accounting.can_read(ledger_id));
DROP POLICY IF EXISTS vouchers_read ON accounting.vouchers;
CREATE POLICY vouchers_read ON accounting.vouchers FOR SELECT TO authenticated USING (accounting.can_read(ledger_id));
DROP POLICY IF EXISTS voucher_lines_read ON accounting.voucher_lines;
CREATE POLICY voucher_lines_read ON accounting.voucher_lines FOR SELECT TO authenticated USING (accounting.can_read(ledger_id));
DROP POLICY IF EXISTS attachments_read ON accounting.attachments;
CREATE POLICY attachments_read ON accounting.attachments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM accounting.vouchers v WHERE v.id = voucher_id AND accounting.can_read(v.ledger_id)));
DROP POLICY IF EXISTS events_read ON accounting.events;
CREATE POLICY events_read ON accounting.events FOR SELECT TO authenticated USING (accounting.can_read(ledger_id));
ALTER TABLE accounting.members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.notes       ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_read ON accounting.members;
CREATE POLICY members_read ON accounting.members FOR SELECT TO authenticated
  USING (accounting.can_read(ledger_id) OR accounting.can_manage(ledger_id) OR user_id = auth.uid());
DROP POLICY IF EXISTS invitations_read ON accounting.invitations;
CREATE POLICY invitations_read ON accounting.invitations FOR SELECT TO authenticated USING (accounting.can_manage(ledger_id));
DROP POLICY IF EXISTS notes_read ON accounting.notes;
CREATE POLICY notes_read ON accounting.notes FOR SELECT TO authenticated USING (accounting.can_read(ledger_id));

REVOKE ALL ON ALL TABLES IN SCHEMA accounting FROM anon, authenticated;
GRANT SELECT ON accounting.mva_codes, accounting.ledgers, accounting.accounts, accounting.posting_accounts,
                accounting.vouchers, accounting.voucher_lines, accounting.attachments, accounting.events,
                accounting.members, accounting.invitations, accounting.notes TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA accounting TO service_role;


-- ── 5. Chart of accounts (NS 4102: what a small company uses) ───────────────
CREATE OR REPLACE FUNCTION accounting.seed(p_ledger uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO accounting.accounts (ledger_id, code, name, default_mva_code)
  SELECT p_ledger, a.code, a.name, a.mva FROM (VALUES
    ('1200', 'Maskiner og anlegg', NULL), ('1230', 'Biler', NULL), ('1250', 'Inventar', NULL),
    ('1280', 'Kontormaskiner', NULL), ('1500', 'Kundefordringer', NULL), ('1570', 'Andre kortsiktige fordringer', NULL),
    ('1700', 'Forskuddsbetalte kostnader', NULL), ('1900', 'Kontanter', NULL), ('1920', 'Bankinnskudd', NULL),
    ('1940', 'Betalingsformidler (kort)', NULL), ('1941', 'Betalingsformidler (Vipps)', NULL),
    ('1950', 'Bankinnskudd for skattetrekk', NULL),
    ('2000', 'Aksjekapital', NULL), ('2050', 'Annen egenkapital', NULL), ('2080', 'Udekket tap', NULL),
    ('2400', 'Leverandørgjeld', NULL), ('2500', 'Betalbar skatt', NULL), ('2600', 'Forskuddstrekk', NULL),
    ('2700', 'Utgående merverdiavgift, høy sats', NULL), ('2701', 'Utgående merverdiavgift, middels sats', NULL),
    ('2702', 'Utgående merverdiavgift, lav sats', NULL), ('2710', 'Inngående merverdiavgift, høy sats', NULL),
    ('2711', 'Inngående merverdiavgift, middels sats', NULL), ('2712', 'Inngående merverdiavgift, lav sats', NULL),
    ('2740', 'Oppgjørskonto merverdiavgift', NULL), ('2770', 'Skyldig arbeidsgiveravgift', NULL),
    ('2780', 'Påløpt arbeidsgiveravgift på påløpt lønn', NULL), ('2900', 'Annen kortsiktig gjeld', NULL),
    ('2910', 'Gjeld til ansatte og eiere', NULL), ('2940', 'Skyldige feriepenger', NULL),
    ('3000', 'Salgsinntekt, avgiftspliktig, høy sats', '3'), ('3001', 'Salgsinntekt, avgiftspliktig, middels sats', '31'),
    ('3002', 'Salgsinntekt, avgiftspliktig, lav sats', '33'), ('3100', 'Salgsinntekt, avgiftsfri', NULL),
    ('3900', 'Annen driftsrelatert inntekt', '6'),
    ('4000', 'Innkjøp av varer', '1'), ('4300', 'Innkjøp av varer for videresalg', '1'), ('4500', 'Fremmedytelser og underentreprise', '1'),
    ('5000', 'Lønn til ansatte', NULL), ('5180', 'Feriepenger', NULL), ('5400', 'Arbeidsgiveravgift', NULL),
    ('6000', 'Avskrivning på varige driftsmidler', NULL), ('6300', 'Leie lokale', NULL), ('6340', 'Lys, varme', '1'),
    ('6540', 'Inventar', '1'), ('6550', 'Driftsmateriale', '1'), ('6600', 'Reparasjon og vedlikehold bygninger', '1'),
    ('6700', 'Revisjonshonorar', '1'), ('6705', 'Regnskapshonorar', '1'), ('6800', 'Kontorrekvisita', '1'),
    ('6810', 'Data/EDB-kostnad', '1'), ('6900', 'Telefon', '1'), ('6940', 'Porto', NULL),
    ('7000', 'Drivstoff', '1'), ('7020', 'Vedlikehold transportmidler', '1'), ('7040', 'Forsikring transportmidler', NULL),
    ('7100', 'Bilgodtgjørelse', NULL), ('7140', 'Reisekostnad', NULL), ('7320', 'Reklamekostnad', '1'),
    ('7350', 'Representasjon', NULL), ('7500', 'Forsikringspremie', NULL), ('7770', 'Bank- og kortgebyrer', NULL),
    ('7790', 'Annen kostnad', NULL),
    ('8050', 'Annen renteinntekt', NULL), ('8150', 'Annen rentekostnad', NULL), ('8300', 'Betalbar skatt', NULL),
    ('8800', 'Årsresultat', NULL)
  ) AS a(code, name, mva)
  ON CONFLICT (ledger_id, code) DO NOTHING;
  -- Their grouping in the næringsspesifikasjon (Skatteetaten's 2025–2026
  -- list). Judgement calls the accountant may change: vans are 1238 rather
  -- than 1205; payment-provider balances are treated as bank.
  UPDATE accounting.accounts a SET grouping_category = g.cat, grouping_code = g.code
    FROM (VALUES
    ('1200', 'balanseverdiForAnleggsmiddel', '1205'),
    ('1230', 'balanseverdiForAnleggsmiddel', '1205'),
    ('1250', 'balanseverdiForAnleggsmiddel', '1205'),
    ('1280', 'balanseverdiForAnleggsmiddel', '1280'),
    ('1500', 'balanseverdiForOmloepsmiddel', '1500'),
    ('1570', 'balanseverdiForOmloepsmiddel', '1570'),
    ('1700', 'balanseverdiForOmloepsmiddel', '1570'),
    ('1900', 'balanseverdiForOmloepsmiddel', '1900'),
    ('1920', 'balanseverdiForOmloepsmiddel', '1920'),
    ('1940', 'balanseverdiForOmloepsmiddel', '1920'),
    ('1941', 'balanseverdiForOmloepsmiddel', '1920'),
    ('1950', 'balanseverdiForOmloepsmiddel', '1950'),
    ('2000', 'egenkapital', '2000'),
    ('2050', 'egenkapital', '2050'),
    ('2080', 'egenkapital', '2080'),
    ('2400', 'kortsiktigGjeld', '2400'),
    ('2500', 'kortsiktigGjeld', '2500'),
    ('2600', 'kortsiktigGjeld', '2600'),
    ('2700', 'kortsiktigGjeld', '2740'),
    ('2701', 'kortsiktigGjeld', '2740'),
    ('2702', 'kortsiktigGjeld', '2740'),
    ('2710', 'kortsiktigGjeld', '2740'),
    ('2711', 'kortsiktigGjeld', '2740'),
    ('2712', 'kortsiktigGjeld', '2740'),
    ('2740', 'kortsiktigGjeld', '2740'),
    ('2770', 'kortsiktigGjeld', '2770'),
    ('2780', 'kortsiktigGjeld', '2770'),
    ('2900', 'kortsiktigGjeld', '2990'),
    ('2910', 'kortsiktigGjeld', '2910'),
    ('2940', 'kortsiktigGjeld', '2949'),
    ('3000', 'salgsinntekt', '3000'),
    ('3001', 'salgsinntekt', '3000'),
    ('3002', 'salgsinntekt', '3000'),
    ('3100', 'salgsinntekt', '3100'),
    ('3900', 'annenDriftsinntekt', '3900'),
    ('4000', 'varekostnad', '4005'),
    ('4300', 'varekostnad', '4005'),
    ('4500', 'varekostnad', '4500'),
    ('5000', 'loennskostnad', '5000'),
    ('5180', 'loennskostnad', '5000'),
    ('5400', 'loennskostnad', '5400'),
    ('6000', 'annenDriftskostnad', '6000'),
    ('6300', 'annenDriftskostnad', '6300'),
    ('6340', 'annenDriftskostnad', '6340'),
    ('6540', 'annenDriftskostnad', '6500'),
    ('6550', 'annenDriftskostnad', '6500'),
    ('6600', 'annenDriftskostnad', '6600'),
    ('6700', 'annenDriftskostnad', '6700'),
    ('6705', 'annenDriftskostnad', '6700'),
    ('6800', 'annenDriftskostnad', '6995'),
    ('6810', 'annenDriftskostnad', '6995'),
    ('6900', 'annenDriftskostnad', '6995'),
    ('6940', 'annenDriftskostnad', '6995'),
    ('7000', 'annenDriftskostnad', '7000'),
    ('7020', 'annenDriftskostnad', '7020'),
    ('7040', 'annenDriftskostnad', '7040'),
    ('7100', 'annenDriftskostnad', '7155'),
    ('7140', 'annenDriftskostnad', '7165'),
    ('7320', 'annenDriftskostnad', '7330'),
    ('7350', 'annenDriftskostnad', '7350'),
    ('7500', 'annenDriftskostnad', '7500'),
    ('7770', 'annenDriftskostnad', '7700'),
    ('7790', 'annenDriftskostnad', '7700'),
    ('8050', 'finansinntekt', '8050'),
    ('8150', 'finanskostnad', '8150'),
    ('8300', 'skattekostnad', '8300'),
    ('8800', 'resultatDisponeringForSAF-T', '8800')
    ) AS g(account, cat, code)
   WHERE a.ledger_id = p_ledger AND a.code = g.account AND a.grouping_code IS NULL;
  INSERT INTO accounting.posting_accounts (ledger_id, key, account_code)
  SELECT p_ledger, k.key, k.code FROM (VALUES
    ('receivables', '1500'), ('payables', '2400'), ('sales_25', '3000'), ('sales_15', '3001'), ('sales_12', '3002'), ('sales_0', '3100'),
    ('output_vat_25', '2700'), ('output_vat_15', '2701'), ('output_vat_12', '2702'),
    ('input_vat_25', '2710'), ('input_vat_15', '2711'), ('input_vat_12', '2712'), ('vat_settlement', '2740'),
    ('bank', '1920'), ('card', '1940'), ('vipps', '1941'), ('other', '1920'), ('platform_fee', '1940'),
    ('reminder_fee', '3900'), ('late_interest', '8050'), ('year_result', '8800'), ('equity', '2050')
  ) AS k(key, code)
  ON CONFLICT (ledger_id, key) DO NOTHING;
END $$;


-- ── 6. Opening and running a ledger ─────────────────────────────────────────
DROP FUNCTION IF EXISTS accounting.request_ledger(uuid, date, text);
CREATE OR REPLACE FUNCTION accounting.request_ledger(p_tenant uuid, p_start date, p_mva_term text DEFAULT 'bimonthly',
                                                    p_declared_turnover numeric DEFAULT NULL)
RETURNS accounting.ledgers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE t jsonb; l accounting.ledgers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_tenant IS NULL OR NOT accounting.host_can_manage(p_tenant) THEN
    RAISE EXCEPTION 'accounting: the company''s owners and admins ask for it' USING ERRCODE = '42501';
  END IF;
  t := accounting.host_tenant(p_tenant);
  IF t IS NULL OR NOT coalesce((t ->> 'active')::boolean, false) THEN
    RAISE EXCEPTION 'accounting: the company must be verified and active first' USING ERRCODE = '55000';
  END IF;
  IF p_start IS NULL OR extract(day FROM p_start) <> 1 THEN
    RAISE EXCEPTION 'accounting: the books start on the first day of a month' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO l FROM accounting.ledgers WHERE tenant_id = p_tenant;
  IF FOUND AND l.status IN ('active', 'ended') THEN
    RAISE EXCEPTION 'accounting: the company''s ledger is already %', l.status USING ERRCODE = '55000';
  END IF;
  IF p_declared_turnover IS NOT NULL AND p_declared_turnover < 0 THEN
    RAISE EXCEPTION 'accounting: the turnover cannot be negative' USING ERRCODE = '22023';
  END IF;
  INSERT INTO accounting.ledgers AS x (tenant_id, status, legal_name, org_number, vat_registered, mva_term, start_date,
                                       declared_turnover, requested_by)
  VALUES (p_tenant, 'requested', t ->> 'legal_name', t ->> 'org_number', coalesce((t ->> 'vat_registered')::boolean, false),
          coalesce(p_mva_term, 'bimonthly'), p_start, p_declared_turnover, auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET status = 'requested', legal_name = EXCLUDED.legal_name, org_number = EXCLUDED.org_number,
    vat_registered = EXCLUDED.vat_registered, start_date = EXCLUDED.start_date, mva_term = EXCLUDED.mva_term,
    declared_turnover = EXCLUDED.declared_turnover,
    requested_by = EXCLUDED.requested_by, decided_by = NULL, decided_at = NULL, decision_note = NULL
  RETURNING * INTO l;
  PERFORM accounting.log(l.id, 'ledger.requested', jsonb_build_object('start_date', p_start, 'mva_term', l.mva_term));
  PERFORM accounting.host_event(p_tenant, 'accounting.requested', jsonb_build_object('start_date', p_start));
  RETURN l;
END $$;

CREATE OR REPLACE FUNCTION accounting.decide_ledger(p_ledger uuid, p_approve boolean, p_monthly_fee numeric, p_note text)
RETURNS accounting.ledgers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE;
BEGIN
  IF NOT accounting.host_is_operator() THEN RAISE EXCEPTION 'accounting: the platform''s administrators decide' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger FOR UPDATE;
  IF NOT FOUND OR l.status <> 'requested' THEN RAISE EXCEPTION 'accounting: nothing to decide' USING ERRCODE = '55000'; END IF;
  UPDATE accounting.ledgers SET status = CASE WHEN p_approve THEN 'active' ELSE 'declined' END,
         monthly_fee = CASE WHEN p_approve THEN p_monthly_fee END,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   WHERE id = p_ledger RETURNING * INTO l;
  IF p_approve THEN PERFORM accounting.seed(p_ledger); END IF;
  PERFORM accounting.log(p_ledger, CASE WHEN p_approve THEN 'ledger.approved' ELSE 'ledger.declined' END,
                         jsonb_build_object('monthly_fee', l.monthly_fee, 'note', p_note));
  PERFORM accounting.host_event(l.tenant_id, CASE WHEN p_approve THEN 'accounting.approved' ELSE 'accounting.declined' END,
                                jsonb_build_object('monthly_fee', l.monthly_fee));
  RETURN l;
END $$;

-- The host's own books.
CREATE OR REPLACE FUNCTION accounting.open_house_ledger(p_legal_name text, p_org_number text, p_start date, p_mva_term text DEFAULT 'bimonthly')
RETURNS accounting.ledgers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE;
BEGIN
  IF NOT (accounting.host_is_operator() AND accounting.host_can_keep(NULL)) THEN
    RAISE EXCEPTION 'accounting: the platform''s administrators only' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_legal_name), '') = '' THEN RAISE EXCEPTION 'accounting: the legal name is needed' USING ERRCODE = '22023'; END IF;
  IF p_start IS NULL OR extract(day FROM p_start) <> 1 THEN
    RAISE EXCEPTION 'accounting: the books start on the first day of a month' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting.ledgers WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'accounting: the house ledger is already open' USING ERRCODE = '55000';
  END IF;
  INSERT INTO accounting.ledgers (tenant_id, status, legal_name, org_number, vat_registered, mva_term, start_date, requested_by, decided_by, decided_at)
  VALUES (NULL, 'active', btrim(p_legal_name), nullif(btrim(coalesce(p_org_number, '')), ''), true,
          coalesce(p_mva_term, 'bimonthly'), p_start, auth.uid(), auth.uid(), now())
  RETURNING * INTO l;
  PERFORM accounting.seed(l.id);
  PERFORM accounting.log(l.id, 'ledger.opened', jsonb_build_object('start_date', p_start));
  RETURN l;
END $$;

CREATE OR REPLACE FUNCTION accounting.set_settings(p_ledger uuid, p jsonb)
RETURNS accounting.ledgers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE;
BEGIN
  PERFORM accounting.require_role(p_ledger, ARRAY['owner', 'accountant']);
  UPDATE accounting.ledgers SET
    vat_registered = coalesce((p ->> 'vat_registered')::boolean, vat_registered),
    mva_term       = coalesce(p ->> 'mva_term', mva_term),
    zero_rate_code = coalesce(p ->> 'zero_rate_code', zero_rate_code),
    auto_post      = coalesce((p ->> 'auto_post')::boolean, auto_post),
    legal_name     = coalesce(nullif(btrim(p ->> 'legal_name'), ''), legal_name),
    org_number     = coalesce(nullif(btrim(p ->> 'org_number'), ''), org_number)
   WHERE id = p_ledger RETURNING * INTO l;
  PERFORM accounting.log(p_ledger, 'ledger.settings', p);
  RETURN l;
END $$;

DROP FUNCTION IF EXISTS accounting.save_account(uuid, text, text, text, boolean);
CREATE OR REPLACE FUNCTION accounting.save_account(p_ledger uuid, p_code text, p_name text, p_mva_code text, p_active boolean,
                                                  p_grouping_category text DEFAULT NULL, p_grouping_code text DEFAULT NULL)
RETURNS accounting.accounts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE a accounting.accounts%ROWTYPE;
BEGIN
  PERFORM accounting.require_role(p_ledger, ARRAY['owner', 'accountant']);
  IF NOT coalesce(p_active, true) AND EXISTS (SELECT 1 FROM accounting.posting_accounts WHERE ledger_id = p_ledger AND account_code = p_code) THEN
    RAISE EXCEPTION 'accounting: account % is used for automatic posting; choose another account there first', p_code USING ERRCODE = '55000';
  END IF;
  INSERT INTO accounting.accounts AS x (ledger_id, code, name, default_mva_code, active, grouping_category, grouping_code)
  VALUES (p_ledger, p_code, btrim(p_name), nullif(p_mva_code, ''), coalesce(p_active, true),
          nullif(btrim(coalesce(p_grouping_category, '')), ''), nullif(btrim(coalesce(p_grouping_code, '')), ''))
  ON CONFLICT (ledger_id, code) DO UPDATE SET name = EXCLUDED.name, default_mva_code = EXCLUDED.default_mva_code, active = EXCLUDED.active,
    grouping_category = coalesce(EXCLUDED.grouping_category, x.grouping_category), grouping_code = coalesce(EXCLUDED.grouping_code, x.grouping_code)
  RETURNING * INTO a;
  PERFORM accounting.log(p_ledger, 'ledger.account', jsonb_build_object('code', p_code, 'name', a.name, 'active', a.active));
  RETURN a;
END $$;

CREATE OR REPLACE FUNCTION accounting.set_posting_account(p_ledger uuid, p_key text, p_code text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM accounting.require_role(p_ledger, ARRAY['owner', 'accountant']);
  IF NOT EXISTS (SELECT 1 FROM accounting.accounts WHERE ledger_id = p_ledger AND code = p_code AND active) THEN
    RAISE EXCEPTION 'accounting: no active account %', p_code USING ERRCODE = '22023';
  END IF;
  UPDATE accounting.posting_accounts SET account_code = p_code WHERE ledger_id = p_ledger AND key = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no posting key %', p_key USING ERRCODE = '22023'; END IF;
  PERFORM accounting.log(p_ledger, 'ledger.posting_account', jsonb_build_object('key', p_key, 'code', p_code));
END $$;

-- Cancelling the service (owner's decision 2026-10-29: monthly, effective
-- at the end of the paid month): everything works until the last day of
-- the current month; from the day after, no new vouchers and the books stay
-- readable (keep them 5 years, bokføringsloven § 13). Withdrawn before
-- then with resume_ledger().
CREATE OR REPLACE FUNCTION accounting.end_ledger(p_ledger uuid, p_reason text)
RETURNS accounting.ledgers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE; v_today date := (now() AT TIME ZONE 'Europe/Oslo')::date;
BEGIN
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger FOR UPDATE;
  IF l.tenant_id IS NULL OR NOT accounting.host_can_manage(l.tenant_id) THEN
    RAISE EXCEPTION 'accounting: the company''s owners and admins end it' USING ERRCODE = '42501';
  END IF;
  IF l.status <> 'active' THEN RAISE EXCEPTION 'accounting: the ledger is %', l.status USING ERRCODE = '55000'; END IF;
  IF l.cancel_at IS NOT NULL THEN RAISE EXCEPTION 'accounting: already cancelled from %', l.cancel_at + 1 USING ERRCODE = '55000'; END IF;
  UPDATE accounting.ledgers SET cancel_at = (date_trunc('month', v_today) + interval '1 month' - interval '1 day')::date,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
   WHERE id = p_ledger RETURNING * INTO l;
  PERFORM accounting.log(p_ledger, 'ledger.cancelled', jsonb_build_object('last_day', l.cancel_at, 'reason', p_reason));
  PERFORM accounting.host_event(l.tenant_id, 'accounting.cancelled', jsonb_build_object('last_day', l.cancel_at, 'reason', p_reason));
  RETURN l;
END $$;

CREATE OR REPLACE FUNCTION accounting.resume_ledger(p_ledger uuid)
RETURNS accounting.ledgers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE;
BEGIN
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger FOR UPDATE;
  IF l.tenant_id IS NULL OR NOT accounting.host_can_manage(l.tenant_id) THEN
    RAISE EXCEPTION 'accounting: the company''s owners and admins decide this' USING ERRCODE = '42501';
  END IF;
  IF l.status <> 'active' OR l.cancel_at IS NULL OR l.cancel_at < (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'accounting: there is no cancellation to withdraw' USING ERRCODE = '55000';
  END IF;
  UPDATE accounting.ledgers SET cancel_at = NULL, cancel_reason = NULL WHERE id = p_ledger RETURNING * INTO l;
  PERFORM accounting.log(p_ledger, 'ledger.cancellation_withdrawn', '{}'::jsonb);
  PERFORM accounting.host_event(l.tenant_id, 'accounting.cancellation_withdrawn', '{}'::jsonb);
  RETURN l;
END $$;

-- Ends the ledgers whose last day has passed (the host runs it daily; a
-- voucher after the last day is refused even before it runs).
CREATE OR REPLACE FUNCTION accounting.apply_cancellations()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r record; n integer := 0;
BEGIN
  IF NOT accounting.host_is_server() THEN RAISE EXCEPTION 'accounting: the server only' USING ERRCODE = '42501'; END IF;
  FOR r IN SELECT id, tenant_id, cancel_at FROM accounting.ledgers
            WHERE status = 'active' AND cancel_at < (now() AT TIME ZONE 'Europe/Oslo')::date FOR UPDATE LOOP
    UPDATE accounting.ledgers SET status = 'ended', ended_at = now() WHERE id = r.id;
    PERFORM accounting.log(r.id, 'ledger.ended', jsonb_build_object('last_day', r.cancel_at));
    PERFORM accounting.host_event(r.tenant_id, 'accounting.ended', jsonb_build_object('last_day', r.cancel_at));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;


-- ── 6b. The back office: people and notes ──────────────────────────────────
-- Invite someone by email. Returns the token once (for the link the host
-- emails); only its hash is kept.
CREATE OR REPLACE FUNCTION accounting.invite(p_ledger uuid, p_email text, p_role text, p_name text DEFAULT NULL,
                                             p_firm text DEFAULT NULL, p_valid_until date DEFAULT NULL)
RETURNS TABLE (invitation_id uuid, token text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
        v_email text := lower(btrim(coalesce(p_email, ''))); i accounting.invitations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT accounting.can_manage(p_ledger) THEN
    RAISE EXCEPTION 'accounting: the company''s owners and admins manage the back office' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounting.ledgers WHERE id = p_ledger AND status = 'active'
                  AND (cancel_at IS NULL OR cancel_at >= (now() AT TIME ZONE 'Europe/Oslo')::date)) THEN
    RAISE EXCEPTION 'accounting: the ledger is not active' USING ERRCODE = '55000';
  END IF;
  IF p_role = 'auditor' AND p_valid_until IS NULL THEN
    RAISE EXCEPTION 'accounting: an external auditor''s access needs an end date' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting.members m JOIN auth.users u ON u.id = m.user_id
              WHERE m.ledger_id = p_ledger AND m.status = 'active' AND lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'accounting: % already has access', v_email USING ERRCODE = '23505';
  END IF;
  UPDATE accounting.invitations SET status = 'revoked' WHERE ledger_id = p_ledger AND email = v_email AND status = 'pending';
  INSERT INTO accounting.invitations (ledger_id, email, role, name, firm, valid_until, token_hash, invited_by)
  VALUES (p_ledger, v_email, p_role, nullif(btrim(coalesce(p_name, '')), ''), nullif(btrim(coalesce(p_firm, '')), ''),
          p_valid_until, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid())
  RETURNING * INTO i;
  PERFORM accounting.log(p_ledger, 'member.invited', jsonb_build_object('email', v_email, 'role', p_role, 'valid_until', p_valid_until));
  RETURN QUERY SELECT i.id, v_token, i.expires_at;
END $$;

-- The invited person, signed in with the invited email address, accepts.
CREATE OR REPLACE FUNCTION accounting.accept_invitation(p_token text)
RETURNS accounting.members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE i accounting.invitations%ROWTYPE; m accounting.members%ROWTYPE; v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'accounting: sign in first' USING ERRCODE = '42501'; END IF;
  SELECT * INTO i FROM accounting.invitations WHERE token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') FOR UPDATE;
  IF NOT FOUND OR i.status <> 'pending' OR i.expires_at < now() THEN
    RAISE EXCEPTION 'accounting: the invitation is not valid (used, withdrawn or expired)' USING ERRCODE = '22023';
  END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS DISTINCT FROM i.email THEN
    RAISE EXCEPTION 'accounting: sign in with % to accept', i.email USING ERRCODE = '42501';
  END IF;
  INSERT INTO accounting.members AS x (ledger_id, user_id, role, name, email, firm, valid_until, added_by)
  VALUES (i.ledger_id, auth.uid(), i.role, i.name, i.email, i.firm, i.valid_until, i.invited_by)
  ON CONFLICT (ledger_id, user_id) DO UPDATE SET role = EXCLUDED.role, name = EXCLUDED.name, email = EXCLUDED.email,
    firm = EXCLUDED.firm, valid_until = EXCLUDED.valid_until, status = 'active', added_by = EXCLUDED.added_by, added_at = now(),
    removed_by = NULL, removed_at = NULL, removed_reason = NULL
  RETURNING * INTO m;
  UPDATE accounting.invitations SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now() WHERE id = i.id;
  PERFORM accounting.log(i.ledger_id, 'member.joined', jsonb_build_object('email', i.email, 'role', i.role));
  RETURN m;
END $$;

CREATE OR REPLACE FUNCTION accounting.revoke_invitation(p_invitation uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE i accounting.invitations%ROWTYPE;
BEGIN
  SELECT * INTO i FROM accounting.invitations WHERE id = p_invitation;
  IF NOT FOUND OR NOT accounting.can_manage(i.ledger_id) THEN
    RAISE EXCEPTION 'accounting: the company''s owners and admins manage the back office' USING ERRCODE = '42501';
  END IF;
  UPDATE accounting.invitations SET status = 'revoked' WHERE id = p_invitation AND status = 'pending';
  PERFORM accounting.log(i.ledger_id, 'member.invitation_revoked', jsonb_build_object('email', i.email));
END $$;

-- Change someone's role or end date, or remove them (kept, with the reason).
CREATE OR REPLACE FUNCTION accounting.update_member(p_ledger uuid, p_user uuid, p_role text, p_valid_until date)
RETURNS accounting.members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m accounting.members%ROWTYPE;
BEGIN
  IF NOT accounting.can_manage(p_ledger) THEN
    RAISE EXCEPTION 'accounting: the company''s owners and admins manage the back office' USING ERRCODE = '42501';
  END IF;
  IF p_role = 'auditor' AND p_valid_until IS NULL THEN
    RAISE EXCEPTION 'accounting: an external auditor''s access needs an end date' USING ERRCODE = '22023';
  END IF;
  UPDATE accounting.members SET role = p_role, valid_until = p_valid_until
   WHERE ledger_id = p_ledger AND user_id = p_user AND status = 'active' RETURNING * INTO m;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no such person in the back office' USING ERRCODE = '42704'; END IF;
  PERFORM accounting.log(p_ledger, 'member.changed', jsonb_build_object('user', p_user, 'role', p_role, 'valid_until', p_valid_until));
  RETURN m;
END $$;

CREATE OR REPLACE FUNCTION accounting.remove_member(p_ledger uuid, p_user uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT accounting.can_manage(p_ledger) THEN
    RAISE EXCEPTION 'accounting: the company''s owners and admins manage the back office' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'accounting: removing someone needs a reason' USING ERRCODE = '22023'; END IF;
  UPDATE accounting.members SET status = 'removed', removed_by = auth.uid(), removed_at = now(), removed_reason = btrim(p_reason)
   WHERE ledger_id = p_ledger AND user_id = p_user AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no such person in the back office' USING ERRCODE = '42704'; END IF;
  PERFORM accounting.log(p_ledger, 'member.removed', jsonb_build_object('user', p_user, 'reason', p_reason));
END $$;

-- A note by anyone who reads the books (the auditor's remarks among them).
CREATE OR REPLACE FUNCTION accounting.add_note(p_ledger uuid, p_voucher uuid, p_body text)
RETURNS accounting.notes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r text := accounting.role_of(p_ledger); n accounting.notes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR r IS NULL THEN RAISE EXCEPTION 'accounting: only those who work on these books' USING ERRCODE = '42501'; END IF;
  IF p_voucher IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounting.vouchers WHERE id = p_voucher AND ledger_id = p_ledger) THEN
    RAISE EXCEPTION 'accounting: no such voucher in this ledger' USING ERRCODE = '42704';
  END IF;
  INSERT INTO accounting.notes (ledger_id, voucher_id, author_id, role, body) VALUES (p_ledger, p_voucher, auth.uid(), r, btrim(p_body))
  RETURNING * INTO n;
  RETURN n;
END $$;

-- The ledgers the caller works on (as owner or in the back office), for
-- the office's ledger picker.
CREATE OR REPLACE FUNCTION accounting.my_ledgers()
RETURNS TABLE (ledger_id uuid, legal_name text, status text, role text, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT l.id, l.legal_name, l.status, accounting.role_of(l.id), l.tenant_id FROM accounting.ledgers l
   WHERE l.status IN ('active', 'ended') AND accounting.role_of(l.id) IS NOT NULL
   ORDER BY l.legal_name;
$$;


-- ── 7. Posting ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accounting.account_for(p_ledger uuid, p_key text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE c text;
BEGIN
  SELECT account_code INTO c FROM accounting.posting_accounts WHERE ledger_id = p_ledger AND key = p_key;
  IF c IS NULL THEN RAISE EXCEPTION 'accounting: no account chosen for %', p_key USING ERRCODE = '22023'; END IF;
  RETURN c;
END $$;

-- A signed amount as a line: positive on the debit side, negative on the credit side.
CREATE OR REPLACE FUNCTION accounting.line(p_account text, p_amount numeric, p_mva_code text DEFAULT NULL, p_mva_role text DEFAULT NULL,
                                           p_description text DEFAULT NULL, p_party text DEFAULT NULL, p_ref uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('account', p_account,
    'debit', CASE WHEN p_amount > 0 THEN p_amount END, 'credit', CASE WHEN p_amount < 0 THEN -p_amount END,
    'mva_code', p_mva_code, 'mva_role', CASE WHEN p_mva_code IS NOT NULL THEN coalesce(p_mva_role, 'basis') END,
    'description', p_description, 'party', p_party, 'ref', p_ref));
$$;

-- The one place a voucher is written. p_lines: [{account, debit | credit,
-- mva_code, mva_role, description, party, ref}], already split into net and
-- MVA. Numbers follow in order per ledger and year.
CREATE OR REPLACE FUNCTION accounting.insert_voucher(p_ledger uuid, p_date date, p_description text, p_source_type text,
                                                     p_source_id uuid, p_lines jsonb, p_reverses uuid DEFAULT NULL)
RETURNS accounting.vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  l accounting.ledgers%ROWTYPE; v accounting.vouchers%ROWTYPE; x jsonb; n integer := 0;
  v_year integer := extract(year FROM p_date)::int; v_number integer;
BEGIN
  -- FOR SHARE: a period being closed (or the ledger ended) at the same moment
  -- waits for this voucher, or this voucher sees the new lock date.
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger FOR SHARE;
  IF NOT FOUND OR l.status <> 'active' THEN RAISE EXCEPTION 'accounting: the ledger is not active' USING ERRCODE = '55000'; END IF;
  IF p_date IS NULL OR p_date < l.start_date THEN
    RAISE EXCEPTION 'accounting: % is before the books start (%)', p_date, l.start_date USING ERRCODE = '22023';
  END IF;
  IF l.locked_until IS NOT NULL AND p_date <= l.locked_until THEN
    RAISE EXCEPTION 'accounting: the period up to % is closed', l.locked_until USING ERRCODE = '55000';
  END IF;
  IF l.cancel_at IS NOT NULL AND l.cancel_at < (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'accounting: the service ended on %', l.cancel_at USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'accounting: a voucher needs at least two lines' USING ERRCODE = '22023';
  END IF;

  INSERT INTO accounting.counters AS c (ledger_id, year, next_number) VALUES (p_ledger, v_year, 2)
  ON CONFLICT (ledger_id, year) DO UPDATE SET next_number = c.next_number + 1
  RETURNING next_number - 1 INTO v_number;

  INSERT INTO accounting.vouchers (ledger_id, year, number, voucher_date, description, source_type, source_id, reverses_voucher, posted_by)
  VALUES (p_ledger, v_year, v_number, p_date, btrim(p_description), p_source_type, p_source_id, p_reverses, auth.uid())
  RETURNING * INTO v;

  FOR x IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF NOT EXISTS (SELECT 1 FROM accounting.accounts WHERE ledger_id = p_ledger AND code = x ->> 'account' AND active) THEN
      RAISE EXCEPTION 'accounting: no active account %', x ->> 'account' USING ERRCODE = '22023';
    END IF;
    n := n + 1;
    INSERT INTO accounting.voucher_lines (voucher_id, ledger_id, line_no, account_code, debit, credit, mva_code, mva_role,
                                          description, party, ref)
    VALUES (v.id, p_ledger, n, x ->> 'account', round(coalesce((x ->> 'debit')::numeric, 0), 2),
            round(coalesce((x ->> 'credit')::numeric, 0), 2), nullif(x ->> 'mva_code', ''), nullif(x ->> 'mva_role', ''),
            nullif(btrim(coalesce(x ->> 'description', '')), ''), nullif(btrim(coalesce(x ->> 'party', '')), ''),
            nullif(x ->> 'ref', '')::uuid);
  END LOOP;
  RETURN v;
END $$;

-- The ledger the host posts a tenant's events into: active, posting
-- automatically. Null when there is none.
CREATE OR REPLACE FUNCTION accounting.ledger_for(p_tenant uuid)
RETURNS accounting.ledgers
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT * FROM accounting.ledgers
   WHERE (tenant_id = p_tenant OR (p_tenant IS NULL AND tenant_id IS NULL)) AND status = 'active' AND auto_post;
$$;

-- For the host: post one of its events (an invoice, a payment …) once.
-- Before the books start: nothing. In a closed period: on the first open
-- day. Returns the voucher (the existing one when already posted).
CREATE OR REPLACE FUNCTION accounting.post_entry(p_ledger uuid, p_date date, p_description text, p_source_type text,
                                                 p_source_id uuid, p_lines jsonb)
RETURNS accounting.vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE; v accounting.vouchers%ROWTYPE;
BEGIN
  IF p_source_type IN ('manual', 'reversal') OR p_source_id IS NULL THEN
    RAISE EXCEPTION 'accounting: an entry names its source' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger;
  IF NOT FOUND OR p_date < l.start_date THEN RETURN NULL; END IF;
  SELECT * INTO v FROM accounting.vouchers WHERE ledger_id = p_ledger AND source_type = p_source_type AND source_id = p_source_id;
  IF FOUND THEN RETURN v; END IF;
  RETURN accounting.insert_voucher(p_ledger,
           CASE WHEN l.locked_until IS NOT NULL AND p_date <= l.locked_until THEN l.locked_until + 1 ELSE p_date END,
           p_description, p_source_type, p_source_id, p_lines);
END $$;

-- A manual voucher (purchases, salaries, bank costs …). Each line:
-- {account, amount (positive debit, negative credit), mva_code, description,
-- party}. With an MVA code above 0 % the amount includes MVA and is split
-- into the net amount and the MVA line.
CREATE OR REPLACE FUNCTION accounting.post_voucher(p_ledger uuid, p_date date, p_description text, p_lines jsonb)
RETURNS accounting.vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  l accounting.ledgers%ROWTYPE := accounting.require_role(p_ledger, ARRAY['owner', 'accountant', 'bookkeeper']);
  x jsonb; m accounting.mva_codes%ROWTYPE; out jsonb := '[]'::jsonb; v_amount numeric; v_vat numeric;
  v accounting.vouchers%ROWTYPE;
BEGIN
  IF coalesce(btrim(p_description), '') = '' THEN RAISE EXCEPTION 'accounting: a voucher needs a description' USING ERRCODE = '22023'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
    v_amount := round((x ->> 'amount')::numeric, 2);
    IF v_amount IS NULL OR v_amount = 0 THEN RAISE EXCEPTION 'accounting: every line needs an amount' USING ERRCODE = '22023'; END IF;
    m := NULL;
    IF nullif(x ->> 'mva_code', '') IS NOT NULL THEN
      SELECT * INTO m FROM accounting.mva_codes WHERE code = x ->> 'mva_code';
      IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no MVA code %', x ->> 'mva_code' USING ERRCODE = '22023'; END IF;
      IF NOT l.vat_registered AND m.direction <> 'none' THEN
        RAISE EXCEPTION 'accounting: the company is not registered for MVA' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF m.code IS NOT NULL AND m.rate > 0 THEN
      v_vat := round(v_amount * m.rate / (100 + m.rate), 2);
      out := out || accounting.line(x ->> 'account', v_amount - v_vat, m.code, 'basis', x ->> 'description', x ->> 'party')
                 || accounting.line(accounting.account_for(p_ledger, m.direction || '_vat_' || m.rate::int), v_vat, m.code, 'vat',
                                    x ->> 'description', x ->> 'party');
    ELSE
      out := out || accounting.line(x ->> 'account', v_amount, m.code, 'basis', x ->> 'description', x ->> 'party');
    END IF;
  END LOOP;
  v := accounting.insert_voucher(p_ledger, p_date, p_description, 'manual', NULL, out);
  PERFORM accounting.log(p_ledger, 'voucher.posted', jsonb_build_object('voucher', v.id, 'number', v.year || '-' || v.number));
  RETURN v;
END $$;

-- A correction of a manual voucher: the same lines on the opposite side,
-- with a reason. The host's entries are corrected at their source (a
-- credit note), which posts its own voucher.
CREATE OR REPLACE FUNCTION accounting.reverse_voucher(p_voucher uuid, p_date date, p_reason text)
RETURNS accounting.vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o accounting.vouchers%ROWTYPE; v accounting.vouchers%ROWTYPE; lines jsonb;
BEGIN
  SELECT * INTO o FROM accounting.vouchers WHERE id = p_voucher;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no such voucher' USING ERRCODE = '42704'; END IF;
  PERFORM accounting.require_role(o.ledger_id, ARRAY['owner', 'accountant']);
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'accounting: a reversal needs a reason' USING ERRCODE = '22023'; END IF;
  IF o.source_type <> 'manual' THEN
    RAISE EXCEPTION 'accounting: correct this at its source (for an invoice: a credit note)' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting.vouchers WHERE reverses_voucher = p_voucher) THEN
    RAISE EXCEPTION 'accounting: already reversed' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('account', account_code,
           'debit', CASE WHEN credit > 0 THEN credit END, 'credit', CASE WHEN debit > 0 THEN debit END,
           'mva_code', mva_code, 'mva_role', mva_role, 'description', description, 'party', party, 'ref', ref)) ORDER BY line_no)
    INTO lines FROM accounting.voucher_lines WHERE voucher_id = p_voucher;
  v := accounting.insert_voucher(o.ledger_id, coalesce(p_date, (now() AT TIME ZONE 'Europe/Oslo')::date),
         'Reversal of ' || o.year || '-' || o.number || ': ' || btrim(p_reason), 'reversal', NULL, lines, p_voucher);
  PERFORM accounting.log(o.ledger_id, 'voucher.reversed', jsonb_build_object('voucher', p_voucher, 'by', v.id, 'reason', p_reason));
  RETURN v;
END $$;

-- Closing a period: nothing is posted on or before the date afterwards.
CREATE OR REPLACE FUNCTION accounting.lock_period(p_ledger uuid, p_until date)
RETURNS accounting.ledgers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE := accounting.require_role(p_ledger, ARRAY['owner', 'accountant']);
BEGIN
  IF p_until IS NULL OR p_until >= (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'accounting: only a period that has ended can be closed' USING ERRCODE = '22023';
  END IF;
  IF l.locked_until IS NOT NULL AND p_until <= l.locked_until THEN
    RAISE EXCEPTION 'accounting: already closed up to %', l.locked_until USING ERRCODE = '55000';
  END IF;
  UPDATE accounting.ledgers SET locked_until = p_until WHERE id = p_ledger RETURNING * INTO l;
  PERFORM accounting.log(p_ledger, 'ledger.locked', jsonb_build_object('until', p_until));
  RETURN l;
END $$;

-- Year end: the year's result moves from the income statement to equity
-- (debit 8800, credit 2050, or the reverse for a loss), dated 31 December.
CREATE OR REPLACE FUNCTION accounting.close_year(p_ledger uuid, p_year integer)
RETURNS accounting.vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE := accounting.require_role(p_ledger, ARRAY['owner', 'accountant']); v_result numeric; v_out accounting.vouchers%ROWTYPE;
BEGIN
  IF make_date(p_year, 12, 31) >= (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'accounting: the year has not ended' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting.vouchers WHERE ledger_id = p_ledger AND source_type = 'year_end' AND year = p_year) THEN
    RAISE EXCEPTION 'accounting: % is already closed', p_year USING ERRCODE = '55000';
  END IF;
  SELECT coalesce(sum(vl.credit - vl.debit), 0) INTO v_result
    FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
   WHERE vl.ledger_id = p_ledger AND vl.account_code >= '3' AND v.year = p_year;
  IF v_result = 0 THEN RAISE EXCEPTION 'accounting: no result to close for %', p_year USING ERRCODE = '55000'; END IF;
  v_out := accounting.insert_voucher(p_ledger, make_date(p_year, 12, 31), 'Årsavslutning ' || p_year, 'year_end', NULL,
         jsonb_build_array(accounting.line(accounting.account_for(p_ledger, 'year_result'), v_result, NULL, NULL, 'Årsresultat'),
                           accounting.line(accounting.account_for(p_ledger, 'equity'), -v_result, NULL, NULL, 'Overført annen egenkapital')));
  PERFORM accounting.log(p_ledger, 'ledger.year_closed', jsonb_build_object('year', p_year, 'result', v_result));
  RETURN v_out;
END $$;

-- A receipt for a voucher: the file is in the private bucket under the
-- ledger's folder; its hash is kept with it.
CREATE OR REPLACE FUNCTION accounting.add_attachment(p_voucher uuid, p_path text, p_file_name text, p_sha256 text, p_size bigint)
RETURNS accounting.attachments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o accounting.vouchers%ROWTYPE; a accounting.attachments%ROWTYPE;
BEGIN
  SELECT * INTO o FROM accounting.vouchers WHERE id = p_voucher;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no such voucher' USING ERRCODE = '42704'; END IF;
  PERFORM accounting.require_role(o.ledger_id, ARRAY['owner', 'accountant', 'bookkeeper']);
  IF p_path IS NULL OR split_part(p_path, '/', 1) <> o.ledger_id::text OR p_path LIKE '%..%' THEN
    RAISE EXCEPTION 'accounting: the file belongs in the ledger''s folder' USING ERRCODE = '22023';
  END IF;
  INSERT INTO accounting.attachments (voucher_id, storage_path, file_name, sha256, size_bytes, uploaded_by)
  VALUES (p_voucher, p_path, btrim(p_file_name), lower(p_sha256), p_size, auth.uid()) RETURNING * INTO a;
  PERFORM accounting.log(o.ledger_id, 'voucher.attachment', jsonb_build_object('voucher', p_voucher, 'file', p_file_name, 'sha256', a.sha256));
  RETURN a;
END $$;


-- The income in a period (accounts 3xxx, without the year-end transfer):
-- what a price by turnover reads.
CREATE OR REPLACE FUNCTION accounting.turnover(p_ledger uuid, p_from date, p_to date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(sum(vl.credit - vl.debit), 0)
    FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
   WHERE vl.ledger_id = p_ledger AND vl.account_code LIKE '3%' AND v.voucher_date BETWEEN p_from AND p_to;
$$;

-- ── 8. Reports ──────────────────────────────────────────────────────────────
-- Saldobalanse: per account, the balance before the period, its debits and
-- credits, and the balance after. Income statement accounts (3–8) start
-- each calendar year at zero.
CREATE OR REPLACE FUNCTION accounting.trial_balance(p_ledger uuid, p_from date, p_to date)
RETURNS TABLE (account_code text, account_name text, opening numeric, debit numeric, credit numeric, closing numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM accounting.require_reader(p_ledger);
  RETURN QUERY
  WITH m AS (
    SELECT vl.account_code AS code,
           sum(CASE WHEN v.voucher_date < p_from AND (vl.account_code < '3' OR v.voucher_date >= date_trunc('year', p_from)::date)
                    THEN vl.debit - vl.credit ELSE 0 END) AS opening,
           sum(CASE WHEN v.voucher_date >= p_from THEN vl.debit ELSE 0 END) AS debit,
           sum(CASE WHEN v.voucher_date >= p_from THEN vl.credit ELSE 0 END) AS credit
      FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
     WHERE vl.ledger_id = p_ledger AND v.voucher_date <= p_to
     GROUP BY vl.account_code)
  SELECT m.code, a.name, m.opening, m.debit, m.credit, m.opening + m.debit - m.credit
    FROM m JOIN accounting.accounts a ON a.ledger_id = p_ledger AND a.code = m.code
   WHERE m.opening <> 0 OR m.debit <> 0 OR m.credit <> 0
   ORDER BY m.code;
END $$;

-- Hovedbok: every line in the period, by account.
CREATE OR REPLACE FUNCTION accounting.general_ledger(p_ledger uuid, p_from date, p_to date, p_account text DEFAULT NULL)
RETURNS TABLE (voucher_id uuid, voucher_no text, voucher_date date, description text, account_code text,
               debit numeric, credit numeric, mva_code text, line_description text, party text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM accounting.require_reader(p_ledger);
  RETURN QUERY
  SELECT v.id, v.year || '-' || v.number, v.voucher_date, v.description, vl.account_code, vl.debit, vl.credit, vl.mva_code,
         vl.description, vl.party
    FROM accounting.vouchers v JOIN accounting.voucher_lines vl ON vl.voucher_id = v.id
   WHERE v.ledger_id = p_ledger AND v.voucher_date BETWEEN p_from AND p_to AND (p_account IS NULL OR vl.account_code = p_account)
   ORDER BY vl.account_code, v.voucher_date, v.year, v.number, vl.line_no;
END $$;

-- Resultatregnskap for a period (income positive), without the year-end
-- transfer.
CREATE OR REPLACE FUNCTION accounting.income_statement(p_ledger uuid, p_from date, p_to date)
RETURNS TABLE (grp text, account_code text, account_name text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM accounting.require_reader(p_ledger);
  RETURN QUERY
  SELECT CASE WHEN tb.account_code < '4' THEN '1 Driftsinntekter' WHEN tb.account_code < '8' THEN '2 Driftskostnader'
              ELSE '3 Finansposter og skatt' END,
         tb.account_code, tb.account_name, tb.credit - tb.debit
    FROM accounting.trial_balance(p_ledger, p_from, p_to) tb
   WHERE tb.account_code >= '3' AND tb.account_code < '8800' AND tb.debit + tb.credit > 0
   ORDER BY tb.account_code;
END $$;

-- Balanse on a date. A result not yet closed into equity is its own line
-- under equity, so the balance sheet balances at any date.
CREATE OR REPLACE FUNCTION accounting.balance_sheet(p_ledger uuid, p_at date)
RETURNS TABLE (grp text, account_code text, account_name text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_result numeric;
BEGIN
  PERFORM accounting.require_reader(p_ledger);
  SELECT coalesce(sum(vl.credit - vl.debit), 0) INTO v_result
    FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
   WHERE vl.ledger_id = p_ledger AND vl.account_code >= '3' AND v.voucher_date <= p_at;
  RETURN QUERY
  SELECT CASE WHEN x.code < '2' THEN '1 Eiendeler' WHEN x.code < '21' THEN '2 Egenkapital' ELSE '3 Gjeld' END,
         x.code, a.name, CASE WHEN x.code < '2' THEN x.bal ELSE -x.bal END
    FROM (SELECT vl.account_code AS code, sum(vl.debit - vl.credit) AS bal
            FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
           WHERE vl.ledger_id = p_ledger AND vl.account_code < '3' AND v.voucher_date <= p_at
           GROUP BY vl.account_code HAVING sum(vl.debit - vl.credit) <> 0) x
    JOIN accounting.accounts a ON a.ledger_id = p_ledger AND a.code = x.code
  UNION ALL
  SELECT '2 Egenkapital', NULL, 'Resultat som ikke er disponert', v_result WHERE v_result <> 0
  ORDER BY 1, 2 NULLS LAST;
END $$;

-- The dates of an MVA term: 1–6 (two months each) or 1 (the year).
CREATE OR REPLACE FUNCTION accounting.mva_term_dates(p_term_kind text, p_year integer, p_term integer)
RETURNS TABLE (term_from date, term_to date)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN p_term_kind = 'yearly' THEN make_date(p_year, 1, 1) ELSE make_date(p_year, p_term * 2 - 1, 1) END,
         CASE WHEN p_term_kind = 'yearly' THEN make_date(p_year, 12, 31)
              ELSE (make_date(p_year, p_term * 2 - 1, 1) + interval '2 months' - interval '1 day')::date END;
$$;

-- The MVA return for a term, per standard code: the basis and the MVA, each
-- signed so credit notes reduce them (output: credit − debit; input:
-- debit − credit).
CREATE OR REPLACE FUNCTION accounting.mva_report(p_ledger uuid, p_year integer, p_term integer)
RETURNS TABLE (mva_code text, description text, direction text, rate numeric, basis numeric, mva numeric, term_from date, term_to date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE; d record;
BEGIN
  PERFORM accounting.require_reader(p_ledger);
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger;
  IF (l.mva_term = 'yearly' AND p_term <> 1) OR (l.mva_term = 'bimonthly' AND p_term NOT BETWEEN 1 AND 6) THEN
    RAISE EXCEPTION 'accounting: term % does not exist for a % return', p_term, l.mva_term USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM accounting.mva_term_dates(l.mva_term, p_year, p_term);
  RETURN QUERY
  SELECT c.code, c.description, c.direction, c.rate,
         coalesce(sum(CASE WHEN vl.mva_role = 'basis' THEN CASE WHEN c.direction = 'input' THEN vl.debit - vl.credit ELSE vl.credit - vl.debit END END), 0),
         coalesce(sum(CASE WHEN vl.mva_role = 'vat'   THEN CASE WHEN c.direction = 'input' THEN vl.debit - vl.credit ELSE vl.credit - vl.debit END END), 0),
         d.term_from, d.term_to
    FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id JOIN accounting.mva_codes c ON c.code = vl.mva_code
   WHERE vl.ledger_id = p_ledger AND v.voucher_date BETWEEN d.term_from AND d.term_to
   GROUP BY c.code, c.description, c.direction, c.rate, c.sort
   ORDER BY c.sort;
END $$;

-- The MVA settlement for a term: the term's MVA moves from the MVA
-- accounts to the settlement account (2740), whose balance is then what is
-- paid to, or refunded by, Skatteetaten. Once per term.
CREATE OR REPLACE FUNCTION accounting.settle_mva(p_ledger uuid, p_year integer, p_term integer)
RETURNS accounting.vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE := accounting.require_role(p_ledger, ARRAY['owner', 'accountant']); d record; r record;
        lines jsonb := '[]'::jsonb; total numeric := 0; v_source uuid; v_out accounting.vouchers%ROWTYPE;
BEGIN
  IF (l.mva_term = 'yearly' AND p_term <> 1) OR (l.mva_term = 'bimonthly' AND p_term NOT BETWEEN 1 AND 6) THEN
    RAISE EXCEPTION 'accounting: term % does not exist for a % return', p_term, l.mva_term USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM accounting.mva_term_dates(l.mva_term, p_year, p_term);
  IF d.term_to >= (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'accounting: the term has not ended' USING ERRCODE = '22023';
  END IF;
  v_source := md5(p_ledger::text || ':mva:' || p_year || ':' || p_term)::uuid;
  IF EXISTS (SELECT 1 FROM accounting.vouchers WHERE ledger_id = p_ledger AND source_type = 'mva_settlement' AND source_id = v_source) THEN
    RAISE EXCEPTION 'accounting: the term is already settled' USING ERRCODE = '55000';
  END IF;
  FOR r IN SELECT vl.account_code, sum(vl.credit - vl.debit) AS bal
             FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
            WHERE vl.ledger_id = p_ledger AND vl.mva_role = 'vat' AND v.voucher_date BETWEEN d.term_from AND d.term_to
            GROUP BY vl.account_code HAVING sum(vl.credit - vl.debit) <> 0 ORDER BY vl.account_code LOOP
    lines := lines || accounting.line(r.account_code, r.bal, NULL, NULL, 'Mva-oppgjør');
    total := total + r.bal;
  END LOOP;
  IF jsonb_array_length(lines) = 0 THEN RAISE EXCEPTION 'accounting: no MVA in the term' USING ERRCODE = '55000'; END IF;
  lines := lines || accounting.line(accounting.account_for(p_ledger, 'vat_settlement'), -total, NULL, NULL,
                                    CASE WHEN total >= 0 THEN 'Skyldig mva' ELSE 'Mva til gode' END);
  v_out := accounting.insert_voucher(p_ledger, d.term_to,
         'Mva-oppgjør ' || p_year || CASE WHEN l.mva_term = 'yearly' THEN ' (år)' ELSE ' termin ' || p_term END,
         'mva_settlement', v_source, lines);
  PERFORM accounting.log(p_ledger, 'mva.settled', jsonb_build_object('year', p_year, 'term', p_term, 'payable', total));
  RETURN v_out;
END $$;

-- Checks the accountant looks at first, for a period: every voucher
-- balances, numbers have no gaps, vouchers without a receipt (manual ones),
-- and the MVA accounts agree with the MVA report.
CREATE OR REPLACE FUNCTION accounting.review_checks(p_ledger uuid, p_from date, p_to date)
RETURNS TABLE (check_name text, ok boolean, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE n bigint; g text; vat_lines numeric; vat_accounts numeric;
BEGIN
  PERFORM accounting.require_reader(p_ledger);
  SELECT count(*) INTO n FROM accounting.vouchers v
   WHERE v.ledger_id = p_ledger AND v.voucher_date BETWEEN p_from AND p_to
     AND (SELECT sum(debit) - sum(credit) FROM accounting.voucher_lines WHERE voucher_id = v.id) <> 0;
  RETURN QUERY SELECT 'Every voucher balances', n = 0, n || ' unbalanced';

  SELECT string_agg(year || ': ' || (max_n - n_count) || ' missing', '; ') INTO g FROM (
    SELECT year, max(number) AS max_n, count(*) AS n_count
      FROM accounting.vouchers WHERE ledger_id = p_ledger GROUP BY year) s WHERE max_n <> n_count;
  RETURN QUERY SELECT 'Voucher numbers have no gaps', g IS NULL, coalesce(g, 'none missing');

  SELECT count(*) INTO n FROM accounting.vouchers v
   WHERE v.ledger_id = p_ledger AND v.voucher_date BETWEEN p_from AND p_to AND v.source_type = 'manual'
     AND NOT EXISTS (SELECT 1 FROM accounting.attachments a WHERE a.voucher_id = v.id);
  RETURN QUERY SELECT 'Manual vouchers have a receipt', n = 0, n || ' without a receipt';

  SELECT coalesce(sum(vl.credit - vl.debit), 0) INTO vat_lines
    FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
   WHERE vl.ledger_id = p_ledger AND vl.mva_role = 'vat' AND v.voucher_date BETWEEN p_from AND p_to;
  SELECT coalesce(sum(vl.credit - vl.debit), 0) INTO vat_accounts
    FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
   WHERE vl.ledger_id = p_ledger AND v.voucher_date BETWEEN p_from AND p_to AND v.source_type <> 'mva_settlement'
     AND vl.account_code IN (SELECT account_code FROM accounting.posting_accounts
                              WHERE ledger_id = p_ledger AND key ~ '^(output|input)_vat_');
  RETURN QUERY SELECT 'MVA accounts agree with the MVA lines', vat_lines = vat_accounts,
                      'MVA lines ' || vat_lines || ', MVA accounts ' || vat_accounts;

  SELECT string_agg(DISTINCT a.code, ', ') INTO g FROM accounting.accounts a
   WHERE a.ledger_id = p_ledger AND a.grouping_code IS NULL
     AND EXISTS (SELECT 1 FROM accounting.voucher_lines vl WHERE vl.ledger_id = p_ledger AND vl.account_code = a.code);
  RETURN QUERY SELECT 'Accounts in use have a tax-return grouping (SAF-T)', g IS NULL, coalesce('missing: ' || g, 'all mapped');
END $$;


-- ── 9. Receipts bucket (private; files are never replaced or removed) ──────
CREATE OR REPLACE FUNCTION accounting.path_access(p_name text, p_upload boolean)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_folder text := split_part(coalesce(p_name, ''), '/', 1);
BEGIN
  IF v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  RETURN accounting.can_read(v_folder::uuid)
     AND (NOT p_upload OR EXISTS (SELECT 1 FROM accounting.ledgers WHERE id = v_folder::uuid AND status = 'active'));
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'ledger-attachments', 'ledger-attachments', false, 10485760,
       ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'application/xml', 'text/xml']
 WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'ledger-attachments');
DROP POLICY IF EXISTS accounting_attachments_read ON storage.objects;
CREATE POLICY accounting_attachments_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ledger-attachments' AND accounting.path_access(name, false));
DROP POLICY IF EXISTS accounting_attachments_upload ON storage.objects;
CREATE POLICY accounting_attachments_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ledger-attachments' AND accounting.path_access(name, true));


-- ── 10. What clients may call ───────────────────────────────────────────────
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA accounting FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  accounting.can_read(uuid), accounting.role_of(uuid), accounting.can_manage(uuid), accounting.path_access(text, boolean),
  accounting.invite(uuid, text, text, text, text, date), accounting.accept_invitation(text), accounting.revoke_invitation(uuid),
  accounting.update_member(uuid, uuid, text, date), accounting.remove_member(uuid, uuid, text),
  accounting.add_note(uuid, uuid, text), accounting.my_ledgers(),
  accounting.request_ledger(uuid, date, text, numeric), accounting.decide_ledger(uuid, boolean, numeric, text),
  accounting.open_house_ledger(text, text, date, text), accounting.set_settings(uuid, jsonb),
  accounting.save_account(uuid, text, text, text, boolean, text, text), accounting.set_posting_account(uuid, text, text),
  accounting.end_ledger(uuid, text), accounting.resume_ledger(uuid), accounting.post_voucher(uuid, date, text, jsonb),
  accounting.reverse_voucher(uuid, date, text), accounting.lock_period(uuid, date), accounting.close_year(uuid, integer),
  accounting.add_attachment(uuid, text, text, text, bigint), accounting.trial_balance(uuid, date, date),
  accounting.general_ledger(uuid, date, date, text), accounting.income_statement(uuid, date, date),
  accounting.balance_sheet(uuid, date), accounting.mva_term_dates(text, integer, integer),
  accounting.mva_report(uuid, integer, integer), accounting.settle_mva(uuid, integer, integer),
  accounting.review_checks(uuid, date, date),
  -- The adapter is called inside policies, as the caller.
  accounting.host_can_keep(uuid), accounting.host_can_manage(uuid), accounting.host_is_operator()
  TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA accounting TO service_role;


-- ===== 00015_accounting_flyttgo.sql =====
-- ============================================================================
-- 00015 — Accounting in FlyttGo: the host adapter for the accounting core
-- (00014) and automatic posting from FlyttGo's invoice engine
-- ============================================================================
--
-- FlyttGo-specific; the core stays portable (docs/ACCOUNTING_CORE.md).
--
--   * Tenants are organisations. Their owners, admins and finance keep the
--     books; owners and admins manage the back office. FlyttGo's
--     administrators keep FlyttGo's own (house) books and approve the
--     add-on, and never read a company's books.
--   * Accounting is an add-on at its own monthly price (owner's decision
--     2026-10-29): a company asks, FlyttGo approves with the price; the
--     invoice run bills it monthly. Proposed price until FlyttGo confirms.
--   * Every issued invoice or credit note, payment and reminder fee of the
--     engine (00008, 00011) becomes a voucher in the seller's ledger, once:
--     FlyttGo's own invoices in the house ledger, a company's sales invoices
--     in its ledger.
--
-- Safe to re-run. Rollback: supabase/rollback/00015_down.sql.
-- ============================================================================


-- ── 1. The adapter ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accounting.host_can_keep(p_tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN p_tenant IS NULL THEN public.is_admin()
              ELSE public.is_org_member(p_tenant, ARRAY['owner', 'admin', 'finance']) END;
$$;

CREATE OR REPLACE FUNCTION accounting.host_can_manage(p_tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT p_tenant IS NOT NULL AND public.is_org_member(p_tenant, ARRAY['owner', 'admin']) $$;

CREATE OR REPLACE FUNCTION accounting.host_is_operator()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.is_admin() $$;

CREATE OR REPLACE FUNCTION accounting.host_is_server()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.is_server() $$;

CREATE OR REPLACE FUNCTION accounting.host_tenant(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'legal_name', coalesce((SELECT s.legal_name FROM public.organization_invoice_settings s WHERE s.organization_id = o.id), o.name),
    'org_number', o.org_number, 'vat_registered', coalesce(o.vat_registered, false), 'active', o.status = 'active')
    FROM public.organizations o WHERE o.id = p_tenant;
$$;

CREATE OR REPLACE FUNCTION accounting.host_event(p_tenant uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_tenant IS NOT NULL THEN PERFORM public.org_event(p_tenant, p_action, NULL, p_details); END IF;
END $$;

REVOKE ALL ON FUNCTION accounting.host_is_server(), accounting.host_tenant(uuid), accounting.host_event(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.host_can_keep(uuid), accounting.host_can_manage(uuid), accounting.host_is_operator() TO authenticated;

-- A tenant is an organisation; a ledger outlives nothing it belongs to.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledgers_tenant_organization_fk') THEN
    ALTER TABLE accounting.ledgers ADD CONSTRAINT ledgers_tenant_organization_fk
      FOREIGN KEY (tenant_id) REFERENCES public.organizations (id) ON DELETE RESTRICT;
  END IF;
END $$;


-- ── 2. The add-on's price (excl. MVA), by the company's turnover ──────────
-- Owner's decision 2026-10-29: the price follows the company's size. The
-- band is read from the books: last calendar year's income (accounts 3xxx)
-- once the books hold that whole year, before that the turnover the
-- company declared when it asked. Reassessed each 1 January, never in the
-- middle of a year. Above the last band the price is agreed (the ledger's
-- monthly_fee); an agreed price always wins. Bands are half-open: a band
-- covers turnover from its lower limit up to, not including, its up_to.
-- Status 'provisional' (owner, 2026-10-29: accepted for the pilot) until
-- set to 'confirmed'.
INSERT INTO public.platform_config (config_key, config_value)
SELECT 'accounting_price_tiers', '[{"name":"Start","up_to":1000000,"monthly_fee":199},{"name":"Small","up_to":5000000,"monthly_fee":499},{"name":"Medium","up_to":20000000,"monthly_fee":1290},{"name":"Large","up_to":100000000,"monthly_fee":2990},{"name":"Enterprise","up_to":null,"monthly_fee":null}]'
 WHERE NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'accounting_price_tiers');
INSERT INTO public.platform_config (config_key, config_value)
SELECT 'accounting_price_status', 'provisional'
 WHERE NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'accounting_price_status');

-- The price list as the public page shows it.
CREATE OR REPLACE FUNCTION public.accounting_price()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object('tiers', coalesce(public.config_text('accounting_price_tiers'), '[]')::jsonb,
                            'price_status', coalesce(public.config_text('accounting_price_status'), 'provisional'));
$$;
GRANT EXECUTE ON FUNCTION public.accounting_price() TO anon, authenticated;

-- The band and price of a ledger for a month: the turnover it is based on
-- and where that came from.
CREATE OR REPLACE FUNCTION public.accounting_tier(p_ledger uuid, p_month date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE l accounting.ledgers%ROWTYPE; v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
        v_year integer := extract(year FROM v_month)::int - 1; v_turnover numeric; v_basis text; t jsonb;
BEGIN
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT (public.is_admin() OR public.is_server() OR accounting.can_read(p_ledger) OR accounting.can_manage(p_ledger)) THEN
    RAISE EXCEPTION 'accounting: not your ledger' USING ERRCODE = '42501';
  END IF;
  IF l.start_date <= make_date(v_year, 1, 1) THEN
    v_turnover := accounting.turnover(p_ledger, make_date(v_year, 1, 1), make_date(v_year, 12, 31)); v_basis := 'books ' || v_year;
  ELSE
    v_turnover := coalesce(l.declared_turnover, 0); v_basis := 'declared';
  END IF;
  SELECT x INTO t FROM jsonb_array_elements(coalesce(public.config_text('accounting_price_tiers'), '[]')::jsonb) x
   WHERE x ->> 'up_to' IS NULL OR v_turnover < (x ->> 'up_to')::numeric
   ORDER BY coalesce((x ->> 'up_to')::numeric, 'Infinity'::numeric) LIMIT 1;
  RETURN jsonb_build_object('tier', t ->> 'name', 'turnover', v_turnover, 'basis', v_basis,
                            'list_fee', (t ->> 'monthly_fee')::numeric, 'agreed_fee', l.monthly_fee,
                            'monthly_fee', coalesce(l.monthly_fee, (t ->> 'monthly_fee')::numeric));
END $$;
GRANT EXECUTE ON FUNCTION public.accounting_tier(uuid, date) TO authenticated, service_role;

-- What the invoice run bills for the add-on: each active company ledger,
-- monthly in advance from the month it was approved. A ledger in the
-- Enterprise band without an agreed price is listed with no fee, for
-- FlyttGo to agree one; nothing is billed for it until then.
CREATE OR REPLACE FUNCTION public.accounting_billable(p_month date)
RETURNS TABLE (organization_id uuid, ledger_id uuid, tier text, turnover numeric, monthly_fee numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'accounting: the server only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT l.tenant_id, l.id, t ->> 'tier', (t ->> 'turnover')::numeric, (t ->> 'monthly_fee')::numeric
    FROM accounting.ledgers l CROSS JOIN LATERAL public.accounting_tier(l.id, p_month) t
   WHERE l.tenant_id IS NOT NULL AND l.status = 'active'
     AND date_trunc('month', l.decided_at AT TIME ZONE 'Europe/Oslo')::date <= date_trunc('month', p_month)::date;
END $$;
REVOKE ALL ON FUNCTION public.accounting_billable(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_billable(date) TO service_role;


-- Each month billed once (the draft's deletion takes its charges with it).
CREATE TABLE IF NOT EXISTS public.accounting_charges (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id),
  ledger_id       uuid        NOT NULL REFERENCES accounting.ledgers (id),
  invoice_id      uuid        NOT NULL REFERENCES public.invoices (id) ON DELETE CASCADE,
  period          date        NOT NULL CHECK (extract(day FROM period) = 1),
  tier            text,
  turnover        numeric,
  total           numeric     NOT NULL,              -- incl. MVA
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ledger_id, period)
);
ALTER TABLE public.accounting_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_charges_select ON public.accounting_charges;
CREATE POLICY accounting_charges_select ON public.accounting_charges FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id, ARRAY['owner', 'admin', 'finance']));
REVOKE ALL ON public.accounting_charges FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.accounting_charges FROM authenticated;

-- The add-on's invoice for a company, as a draft on FlyttGo's invoice (NULL
-- when nothing is due): each month from approval to the current one not
-- yet billed, at the month's band price; nothing after the month it ended;
-- a month without a price (Enterprise, not yet agreed) waits.
CREATE OR REPLACE FUNCTION public.create_accounting_invoice(p_org uuid, p_today date DEFAULT NULL)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_month date := date_trunc('month', coalesce(p_today, (now() AT TIME ZONE 'Europe/Oslo')::date))::date;
  l accounting.ledgers%ROWTYPE; v_inv public.invoices%ROWTYPE; v_m date; v_end date; t jsonb; v_amt numeric; n integer := 0;
BEGIN
  PERFORM public.require_billing_operator();
  SELECT * INTO l FROM accounting.ledgers WHERE tenant_id = p_org AND status IN ('active', 'ended') AND decided_at IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.invoices (organization_id, notes, created_by) VALUES (p_org, 'Regnskap (FlyttGo)', auth.uid()) RETURNING * INTO v_inv;
  -- A cancelled ledger is billed up to and including the month of its last day.
  v_end := CASE WHEN l.cancel_at IS NOT NULL THEN least(v_month, date_trunc('month', l.cancel_at)::date)
                WHEN l.status = 'ended' THEN least(v_month, date_trunc('month', l.ended_at AT TIME ZONE 'Europe/Oslo')::date)
                ELSE v_month END;
  v_m := date_trunc('month', l.decided_at AT TIME ZONE 'Europe/Oslo')::date;
  WHILE v_m <= v_end LOOP
    IF NOT EXISTS (SELECT 1 FROM public.accounting_charges WHERE ledger_id = l.id AND period = v_m) THEN
      t := public.accounting_tier(l.id, v_m);
      IF coalesce((t ->> 'monthly_fee')::numeric, 0) > 0 THEN
        v_amt := public.white_label_line(v_inv.id, 'Regnskap ' || coalesce(t ->> 'tier', '') || ', ' || to_char(v_m, 'MM.YYYY'),
                                         (t ->> 'monthly_fee')::numeric);
        INSERT INTO public.accounting_charges (organization_id, ledger_id, invoice_id, period, tier, turnover, total)
        VALUES (p_org, l.id, v_inv.id, v_m, t ->> 'tier', (t ->> 'turnover')::numeric, v_amt);
        n := n + 1;
      END IF;
    END IF;
    v_m := (v_m + interval '1 month')::date;
  END LOOP;
  IF n = 0 THEN DELETE FROM public.invoices WHERE id = v_inv.id; RETURN NULL; END IF;
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_inv.id)
   WHERE id = v_inv.id RETURNING * INTO v_inv;
  RETURN v_inv;
END $$;
REVOKE ALL ON FUNCTION public.create_accounting_invoice(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_accounting_invoice(uuid, date) TO authenticated, service_role;


-- ── 3. Posting the invoice engine ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accounting_post_invoice(p_invoice uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  i public.invoices%ROWTYPE; l accounting.ledgers%ROWTYPE; v accounting.vouchers%ROWTYPE;
  r record; lines jsonb := '[]'::jsonb; v_code text; v_type text; v_party text;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id = p_invoice;
  IF NOT FOUND OR i.status = 'draft' OR i.total = 0 THEN RETURN NULL; END IF;
  l := accounting.ledger_for(i.issuer_org);
  IF l.id IS NULL THEN RETURN NULL; END IF;
  v_type := CASE WHEN i.kind = 'credit_note' THEN 'credit_note' ELSE 'invoice' END;
  v_party := nullif(i.buyer ->> 'name', '');
  -- Sales and MVA per rate on the credit side (a credit note's negative
  -- amounts land on the debit side), the total on receivables.
  FOR r IN SELECT vat_rate, sum(net_amount) AS net, sum(vat_amount) AS vat FROM public.invoice_lines
            WHERE invoice_id = p_invoice GROUP BY vat_rate ORDER BY vat_rate DESC LOOP
    v_code := CASE WHEN NOT l.vat_registered THEN NULL
                   WHEN r.vat_rate = 25 THEN '3' WHEN r.vat_rate = 15 THEN '31' WHEN r.vat_rate = 12 THEN '33'
                   ELSE l.zero_rate_code END;
    IF r.net <> 0 THEN
      lines := lines || accounting.line(accounting.account_for(l.id, 'sales_' || r.vat_rate::int), -r.net, v_code, 'basis', NULL, v_party, p_invoice);
    END IF;
    IF r.vat <> 0 THEN
      lines := lines || accounting.line(accounting.account_for(l.id, 'output_vat_' || r.vat_rate::int), -r.vat, v_code, 'vat', NULL, v_party, p_invoice);
    END IF;
  END LOOP;
  lines := accounting.line(accounting.account_for(l.id, 'receivables'), i.total, NULL, NULL, NULL, v_party, p_invoice) || lines;
  v := accounting.post_entry(l.id, i.issue_date,
         CASE WHEN i.kind = 'credit_note' THEN 'Kreditnota ' ELSE 'Faktura ' END || i.number || coalesce(' · ' || v_party, ''),
         v_type, p_invoice, lines);
  RETURN v.id;
END $$;

CREATE OR REPLACE FUNCTION public.accounting_post_payment(p_payment uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p public.invoice_payments%ROWTYPE; i public.invoices%ROWTYPE; l accounting.ledgers%ROWTYPE; v accounting.vouchers%ROWTYPE;
        v_party text;
BEGIN
  SELECT * INTO p FROM public.invoice_payments WHERE id = p_payment;
  SELECT * INTO i FROM public.invoices WHERE id = p.invoice_id;
  l := accounting.ledger_for(i.issuer_org);
  IF l.id IS NULL THEN RETURN NULL; END IF;
  v_party := nullif(i.buyer ->> 'name', '');
  v := accounting.post_entry(l.id, p.paid_on, 'Innbetaling faktura ' || i.number || coalesce(' · ' || p.reference, ''), 'payment', p_payment,
         jsonb_build_array(accounting.line(accounting.account_for(l.id, p.method), p.amount, NULL, NULL, NULL, v_party, i.id),
                           accounting.line(accounting.account_for(l.id, 'receivables'), -p.amount, NULL, NULL, NULL, v_party, i.id)));
  RETURN v.id;
END $$;

CREATE OR REPLACE FUNCTION public.accounting_post_reminder(p_reminder uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.invoice_reminders%ROWTYPE; i public.invoices%ROWTYPE; l accounting.ledgers%ROWTYPE; v accounting.vouchers%ROWTYPE;
        lines jsonb; v_party text;
BEGIN
  SELECT * INTO r FROM public.invoice_reminders WHERE id = p_reminder;
  IF r.fee + r.interest = 0 THEN RETURN NULL; END IF;
  SELECT * INTO i FROM public.invoices WHERE id = r.invoice_id;
  l := accounting.ledger_for(i.issuer_org);
  IF l.id IS NULL THEN RETURN NULL; END IF;
  v_party := nullif(i.buyer ->> 'name', '');
  lines := jsonb_build_array(accounting.line(accounting.account_for(l.id, 'receivables'), r.fee + r.interest, NULL, NULL, NULL, v_party, i.id));
  IF r.fee > 0 THEN
    lines := lines || accounting.line(accounting.account_for(l.id, 'reminder_fee'), -r.fee, CASE WHEN l.vat_registered THEN '6' END,
                                      'basis', 'Purregebyr', v_party, i.id);
  END IF;
  IF r.interest > 0 THEN
    lines := lines || accounting.line(accounting.account_for(l.id, 'late_interest'), -r.interest, NULL, NULL, 'Forsinkelsesrente', v_party, i.id);
  END IF;
  v := accounting.post_entry(l.id, (r.sent_at AT TIME ZONE 'Europe/Oslo')::date, 'Purring ' || r.level || ' faktura ' || i.number,
                             'reminder', p_reminder, lines);
  RETURN v.id;
END $$;

CREATE OR REPLACE FUNCTION public.accounting_on_invoice()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status <> 'draft' THEN PERFORM public.accounting_post_invoice(NEW.id); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS accounting_on_invoice ON public.invoices;
CREATE TRIGGER accounting_on_invoice AFTER UPDATE OF status ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.accounting_on_invoice();

CREATE OR REPLACE FUNCTION public.accounting_on_payment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN PERFORM public.accounting_post_payment(NEW.id); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS accounting_on_payment ON public.invoice_payments;
CREATE TRIGGER accounting_on_payment AFTER INSERT ON public.invoice_payments FOR EACH ROW EXECUTE FUNCTION public.accounting_on_payment();

CREATE OR REPLACE FUNCTION public.accounting_on_reminder()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN PERFORM public.accounting_post_reminder(NEW.id); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS accounting_on_reminder ON public.invoice_reminders;
CREATE TRIGGER accounting_on_reminder AFTER INSERT ON public.invoice_reminders FOR EACH ROW EXECUTE FUNCTION public.accounting_on_reminder();

-- What the engine issued since the books started and is not yet in them
-- (issued before the ledger opened, or while automatic posting was off).
CREATE OR REPLACE FUNCTION public.accounting_unposted(p_ledger uuid)
RETURNS TABLE (source_type text, source_id uuid, source_date date, description text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE l accounting.ledgers%ROWTYPE;
BEGIN
  IF NOT (accounting.can_read(p_ledger) OR public.is_server()) THEN
    RAISE EXCEPTION 'accounting: only those who work on these books' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger;
  RETURN QUERY
  SELECT CASE WHEN i.kind = 'credit_note' THEN 'credit_note' ELSE 'invoice' END, i.id, i.issue_date,
         CASE WHEN i.kind = 'credit_note' THEN 'Kreditnota ' ELSE 'Faktura ' END || i.number, i.total
    FROM public.invoices i
   WHERE i.issuer_org IS NOT DISTINCT FROM l.tenant_id AND i.status <> 'draft' AND i.issue_date >= l.start_date AND i.total <> 0
     AND NOT EXISTS (SELECT 1 FROM accounting.vouchers v WHERE v.ledger_id = l.id AND v.source_id = i.id AND v.source_type IN ('invoice', 'credit_note'))
  UNION ALL
  SELECT 'payment', p.id, p.paid_on, 'Innbetaling faktura ' || i.number, p.amount
    FROM public.invoice_payments p JOIN public.invoices i ON i.id = p.invoice_id
   WHERE i.issuer_org IS NOT DISTINCT FROM l.tenant_id AND p.paid_on >= l.start_date
     AND NOT EXISTS (SELECT 1 FROM accounting.vouchers v WHERE v.ledger_id = l.id AND v.source_id = p.id AND v.source_type = 'payment')
  UNION ALL
  SELECT 'reminder', r.id, (r.sent_at AT TIME ZONE 'Europe/Oslo')::date, 'Purring ' || r.level || ' faktura ' || i.number, r.fee + r.interest
    FROM public.invoice_reminders r JOIN public.invoices i ON i.id = r.invoice_id
   WHERE i.issuer_org IS NOT DISTINCT FROM l.tenant_id AND (r.sent_at AT TIME ZONE 'Europe/Oslo')::date >= l.start_date
     AND r.fee + r.interest > 0
     AND NOT EXISTS (SELECT 1 FROM accounting.vouchers v WHERE v.ledger_id = l.id AND v.source_id = r.id AND v.source_type = 'reminder')
  ORDER BY 3, 1;
END $$;

-- Post them: invoices first, then payments and reminders, each on its own
-- date (or the first open day after a closed period).
CREATE OR REPLACE FUNCTION public.accounting_post_unposted(p_ledger uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE l accounting.ledgers%ROWTYPE := accounting.require_role(p_ledger, ARRAY['owner', 'accountant']); r record; n integer := 0;
BEGIN
  IF NOT l.auto_post THEN RAISE EXCEPTION 'accounting: switch on automatic posting first' USING ERRCODE = '55000'; END IF;
  FOR r IN SELECT * FROM public.accounting_unposted(p_ledger)
            ORDER BY CASE WHEN source_type IN ('invoice', 'credit_note') THEN 0 ELSE 1 END, source_date LOOP
    IF r.source_type IN ('invoice', 'credit_note') THEN PERFORM public.accounting_post_invoice(r.source_id);
    ELSIF r.source_type = 'payment' THEN PERFORM public.accounting_post_payment(r.source_id);
    ELSE PERFORM public.accounting_post_reminder(r.source_id);
    END IF;
    n := n + 1;
  END LOOP;
  PERFORM accounting.log(p_ledger, 'ledger.posted_unposted', jsonb_build_object('count', n));
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.accounting_post_invoice(uuid), public.accounting_post_payment(uuid), public.accounting_post_reminder(uuid),
  public.accounting_on_invoice(), public.accounting_on_payment(), public.accounting_on_reminder() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_unposted(uuid), public.accounting_post_unposted(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accounting_unposted(uuid), public.accounting_post_unposted(uuid) TO authenticated, service_role;

COMMIT;
