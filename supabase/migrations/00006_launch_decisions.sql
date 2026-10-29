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
