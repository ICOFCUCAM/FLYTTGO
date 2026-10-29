-- ============================================================================
-- Roll back 00006_launch_decisions.sql
-- ============================================================================
-- Run first (before 00005_down.sql). Puts back the functions as 00003 and
-- 00005 left them, and production's own dispatch_rank_candidates (copied
-- from the verified replica). Tested: run.sh checks that rolling back
-- each migration returns the schema and function bodies to the state
-- before it.
--
-- DATA LOSS: bookings.cancelled_at / cancelled_by / cancellation_reason,
-- captured_at / captured_amount, and organization_verifications are
-- dropped. Export them first. An escrow row waiting as 'capture_pending'
-- stays so: release it (or refund) before rolling back.
-- ============================================================================

DROP TRIGGER IF EXISTS stamp_booking_cancellation ON public.bookings;
DROP TRIGGER IF EXISTS hold_release_until_capture ON public.escrow_payments;
DROP FUNCTION IF EXISTS public.stamp_booking_cancellation();
DROP FUNCTION IF EXISTS public.hold_release_until_capture();
DROP FUNCTION IF EXISTS public.payment_capture_mark(uuid, numeric);
DROP FUNCTION IF EXISTS public.admin_transfer_ownership(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.record_organization_verification(uuid, text, boolean, jsonb);
DROP TABLE IF EXISTS public.organization_verifications;

-- ── Functions as before 00006 ──
CREATE OR REPLACE FUNCTION public.dispatch_rank_candidates(p_booking_id uuid)
 RETURNS TABLE(driver_id uuid, driver_user_id uuid, full_name text, distance_km numeric, score numeric, rating numeric, acceptance_rate numeric, cancellation_rate numeric, trust_score numeric, plan_name text, dispatch_priority integer, active_jobs integer, same_city boolean)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH booking AS (
    SELECT b.id, b.customer_id, b.pickup_lat, b.pickup_lng, b.pickup_city, b.van_type
    FROM public.bookings b
    WHERE b.id = p_booking_id
  ),
  candidates AS (
    SELECT
      dp.id AS driver_id, dp.user_id AS driver_user_id, dp.full_name, dp.city AS driver_city,
      dp.rating, dp.acceptance_rate, dp.cancellation_rate, dp.trust_score,
      dp.van_size AS driver_van_size, dp.vehicle_type AS driver_vehicle_type,
      dl.lat AS driver_lat, dl.lng AS driver_lng,
      COALESCE(sp.name, dp.subscription_plan, 'free') AS plan_name,
      COALESCE(sp.dispatch_priority, 1) AS dispatch_priority,
      (SELECT COUNT(*) FROM public.bookings b2
        WHERE b2.driver_id = dp.id
          AND b2.status IN ('driver_assigned','pickup_arrived','loading','in_transit'))::int AS active_jobs
    FROM public.driver_profiles dp
    JOIN LATERAL (
      SELECT dl2.lat, dl2.lng, dl2.updated_at
        FROM public.driver_locations dl2
       WHERE dl2.driver_id = dp.user_id
       ORDER BY dl2.updated_at DESC
       LIMIT 1
    ) dl ON true
    LEFT JOIN public.driver_subscriptions ds
           ON ds.driver_id = dp.user_id
          AND ds.subscription_status = 'active'
    LEFT JOIN public.subscription_plans sp
           ON sp.id = ds.plan_id
    WHERE dp.online = true
      AND dp.status = 'approved'
      AND COALESCE(dp.subscription_active, false) = true
  )
  SELECT
    c.driver_id, c.driver_user_id, c.full_name,
    public.haversine_km(c.driver_lat, c.driver_lng, (SELECT pickup_lat FROM booking), (SELECT pickup_lng FROM booking)) AS distance_km,
    (
        (40 / GREATEST(public.haversine_km(c.driver_lat, c.driver_lng, (SELECT pickup_lat FROM booking), (SELECT pickup_lng FROM booking)), 0.5))
      + (COALESCE(c.rating, 4.5)            * 20)
      + (COALESCE(c.dispatch_priority, 1)   * 15)
      + (COALESCE(c.acceptance_rate, 0.9)   * 10)
      + (COALESCE(c.trust_score, 0.5)       * 10)
      - (COALESCE(c.cancellation_rate, 0)   * 15)
      - (c.active_jobs                      *  5)
      + CASE
          WHEN c.driver_city IS NOT NULL
           AND (SELECT pickup_city FROM booking) IS NOT NULL
           AND LOWER(c.driver_city) = LOWER((SELECT pickup_city FROM booking))
          THEN 8 ELSE 0
        END
    )::numeric AS score,
    c.rating, c.acceptance_rate, c.cancellation_rate, c.trust_score,
    c.plan_name, c.dispatch_priority, c.active_jobs,
    (c.driver_city IS NOT NULL
      AND (SELECT pickup_city FROM booking) IS NOT NULL
      AND LOWER(c.driver_city) = LOWER((SELECT pickup_city FROM booking))) AS same_city
  FROM candidates c
  WHERE
    public.haversine_km(c.driver_lat, c.driver_lng, (SELECT pickup_lat FROM booking), (SELECT pickup_lng FROM booking)) <= 15
    AND (
      (SELECT van_type FROM booking) IS NULL
      OR c.driver_van_size = (SELECT van_type FROM booking)
      OR c.driver_vehicle_type = (SELECT van_type FROM booking)
      OR c.driver_van_size IS NULL
    )
    AND c.driver_user_id IS DISTINCT FROM (SELECT customer_id FROM booking)
  ORDER BY score DESC
  LIMIT 10;
$function$;

CREATE OR REPLACE FUNCTION public.claim_job(p_booking_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_driver uuid := public.my_driver_id();
  v_plan   text;
  v_price  numeric;
BEGIN
  IF v_driver IS NULL OR NOT public.is_approved_driver() THEN
    RAISE EXCEPTION 'claim_job: approved drivers only' USING ERRCODE = '42501';
  END IF;
  SELECT price_estimate INTO v_price FROM public.bookings WHERE id = p_booking_id;
  SELECT public.plan_slug(sp.name) INTO v_plan
    FROM public.driver_subscriptions ds JOIN public.subscription_plans sp ON sp.id = ds.plan_id
   WHERE ds.driver_id = auth.uid() AND ds.subscription_status = 'active'
   ORDER BY ds.created_at DESC LIMIT 1;
  IF coalesce(v_plan, 'free') = 'free' AND coalesce(v_price, 0) > 500 THEN
    RAISE EXCEPTION 'claim_job: the free plan takes jobs up to 500 NOK' USING ERRCODE = '42501';
  END IF;
  UPDATE public.bookings
     SET driver_id = v_driver, status = 'driver_assigned'
   WHERE id = p_booking_id AND driver_id IS NULL
     AND status IN ('pending', 'confirmed') AND payment_status IN ('paid', 'escrow');
  RETURN FOUND;
END;
$$;

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
   ORDER BY b.move_date NULLS LAST, b.created_at;
$$;

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
  IF public.is_admin() THEN RETURN 'platform_admin'; END IF;
  RAISE EXCEPTION 'organisation: requires role %', array_to_string(p_roles, ' or ') USING ERRCODE = '42501';
END $$;

CREATE OR REPLACE FUNCTION public.guard_last_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'owner' AND OLD.status = 'active'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.status <> 'active')
     AND EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id)
     AND NOT EXISTS (SELECT 1 FROM public.organization_members
                      WHERE organization_id = OLD.organization_id AND user_id <> OLD.user_id
                        AND role = 'owner' AND status = 'active') THEN
    RAISE EXCEPTION 'organisation: the last owner cannot be removed or changed' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_organization_status(p_org uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS public.organizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org public.organizations%ROWTYPE; v_old text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'organisation status: platform administrators only' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_old FROM public.organizations WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.organizations SET status = p_status, status_reason = p_reason, updated_at = now()
   WHERE id = p_org RETURNING * INTO v_org;
  PERFORM public.org_event(p_org, 'organization.status', NULL,
                           jsonb_build_object('from', v_old, 'to', p_status, 'reason', p_reason));
  RETURN v_org;
END $$;

DROP FUNCTION IF EXISTS public.expire_lapsed_subscriptions(uuid);
DROP FUNCTION IF EXISTS public.driver_current_plan(uuid);
DROP FUNCTION IF EXISTS public.subscription_grace(text);
DROP FUNCTION IF EXISTS public.is_server();

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_cancelled_by_check;
ALTER TABLE public.bookings
  DROP COLUMN IF EXISTS cancelled_at,
  DROP COLUMN IF EXISTS cancelled_by,
  DROP COLUMN IF EXISTS cancellation_reason,
  DROP COLUMN IF EXISTS captured_at,
  DROP COLUMN IF EXISTS captured_amount;

DELETE FROM public.platform_config
 WHERE config_key IN ('subscription_grace_hours_monthly', 'subscription_grace_hours_daily');
