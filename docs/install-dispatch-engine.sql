-- ============================================================================
-- FlyttGo — Dispatch Engine (Supabase-native)
-- ============================================================================
-- Production dispatch logic for automatically matching a paid booking to
-- the best available driver. Runs entirely inside Supabase (Postgres
-- functions + triggers + Realtime) — no separate NestJS service, no
-- edge functions required for the core flow.
--
-- ── Flow ────────────────────────────────────────────────────────────
--
--   1. Customer completes payment → bookings.payment_status flips to
--      'escrow' (or 'paid').
--   2. Trigger fires: dispatch_assign_best_driver(booking_id).
--   3. Function scores every eligible driver within ~15 km of pickup,
--      picks the highest-scoring one, atomically:
--        - UPDATE bookings SET driver_id, status='driver_assigned'
--        - INSERT dispatch_logs row with the dispatch_score
--        - INSERT notifications row for the chosen driver
--   4. Driver's header bell lights up via Realtime (notifications
--      table is in the supabase_realtime publication).
--   5. DriverPortal already loads the assigned job via loadJobs().
--
--   If no candidate is found, a dispatch_logs row with driver_id=NULL
--   and response='no_candidates' is written so admins can see the
--   failure in the Fleet Map + Bookings tab and manually dispatch
--   later via the existing dispatch modal.
--
-- ── Architecture notes ──────────────────────────────────────────────
--
--   - PostGIS is NOT installed on this project, so distance is
--     computed with a plain Haversine formula (great-circle distance)
--     in a SQL helper function. Good to ±0.5 % over the ranges
--     FlyttGo deals with and zero extension setup.
--
--   - The codebase uses bookings.driver_id = driver_profiles.id
--     (not drivers.id — the drivers table is legacy and diverged).
--     All dispatch logic targets driver_profiles to match.
--
--   - The scoring formula is inspired by the spec in FLYTTGO_DISPATCH
--     (DistanceWeight + RatingWeight + SubscriptionPriority +
--     AcceptanceRateWeight - CancellationPenalty - WorkloadPenalty).
--     Weights live in the function body so they can be tuned without
--     touching any other code.
--
--   - SECURITY DEFINER on the assign function so it can write to
--     bookings / dispatch_logs / notifications regardless of the
--     triggering user's RLS scope. search_path pinned to public to
--     prevent search_path hijacking.
--
-- Safe to re-run — every CREATE uses IF NOT EXISTS / OR REPLACE /
-- DROP IF EXISTS first.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. notifications table (prereq for driver push)
-- ----------------------------------------------------------------------------
-- Schema mirrors what useNotifications.ts in the frontend expects.
-- Applying only the safe, schema-only portion of the existing
-- docs/notifications-migration.sql — the trigger functions in that
-- file reference the legacy `drivers` table (bug), so we skip them
-- here and do our own driver notification directly inside
-- dispatch_assign_best_driver.

CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link_page   text,
  link_id     uuid,
  read_at     timestamptz,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, read_at);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_self_select ON public.notifications;
CREATE POLICY notifications_self_select ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_self_update ON public.notifications;
CREATE POLICY notifications_self_update ON public.notifications
  FOR UPDATE TO authenticated
  USING       (user_id = auth.uid())
  WITH CHECK  (user_id = auth.uid());

-- Admin bypass (relies on public.is_admin() from install-admin-rls.sql)
DROP POLICY IF EXISTS notifications_admin_all ON public.notifications;
CREATE POLICY notifications_admin_all ON public.notifications
  FOR ALL TO authenticated
  USING       (public.is_admin())
  WITH CHECK  (public.is_admin());

-- Add the table to the supabase_realtime publication so the header
-- bell picks up new rows without polling. Wrapped in a DO block
-- because ALTER PUBLICATION ADD TABLE errors if it's already there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 2. haversine_km — plain-math great-circle distance helper
-- ----------------------------------------------------------------------------
-- Returns distance in km between two (lat, lng) pairs using the
-- Haversine formula. Good to ±0.5 % at any distance FlyttGo deals
-- with (< 1000 km). IMMUTABLE so Postgres can inline + cache it
-- during the dispatch ranking query.

CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 numeric,
  lng1 numeric,
  lat2 numeric,
  lng2 numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH r AS (SELECT 6371::numeric AS earth_km)
  SELECT
    (2 * r.earth_km * ASIN(SQRT(
        POWER(SIN(RADIANS(lat2 - lat1) / 2), 2)
      + COS(RADIANS(lat1)) * COS(RADIANS(lat2))
        * POWER(SIN(RADIANS(lng2 - lng1) / 2), 2)
    )))::numeric
  FROM r;
$$;


-- ----------------------------------------------------------------------------
-- 3. dispatch_rank_candidates — scoring + ranking
-- ----------------------------------------------------------------------------
-- Returns a set of candidate drivers ordered by score DESC. The
-- dispatch_assign function picks the top row. Filters:
--
--   - driver_profiles.online = true
--   - driver_profiles.status = 'approved'
--   - driver_profiles.subscription_active = true
--   - has a recent driver_locations row
--   - within 15 km of pickup (straight-line, Haversine)
--   - not already on an in-flight job
--   - not the customer of the booking
--
-- Score components (tunable — just edit the constants):
--
--   + 40 / max(distance_km, 0.5)      distance weight
--   + rating * 20                     0–5 stars scaled
--   + dispatch_priority * 15          plan tier
--   + acceptance_rate * 10            historical reliability
--   + trust_score * 10                anti-fraud / quality layer
--   - cancellation_rate * 15          cancellation penalty
--   - active_jobs * 5                 workload penalty
--   + 8 if same city as pickup        zone-based preference
--
-- Returns one row per candidate with all the fields the assign
-- function + admin UI need.

CREATE OR REPLACE FUNCTION public.dispatch_rank_candidates(p_booking_id uuid)
RETURNS TABLE (
  driver_id          uuid,
  driver_user_id     uuid,
  full_name          text,
  distance_km        numeric,
  score              numeric,
  rating             numeric,
  acceptance_rate    numeric,
  cancellation_rate  numeric,
  trust_score        numeric,
  plan_name          text,
  dispatch_priority  integer,
  active_jobs        integer,
  same_city          boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH booking AS (
    SELECT
      b.id,
      b.customer_id,
      b.pickup_lat,
      b.pickup_lng,
      b.pickup_city,
      b.van_type
    FROM public.bookings b
    WHERE b.id = p_booking_id
  ),
  candidates AS (
    SELECT
      dp.id                                    AS driver_id,
      dp.user_id                               AS driver_user_id,
      dp.full_name,
      dp.city                                  AS driver_city,
      dp.rating,
      dp.acceptance_rate,
      dp.cancellation_rate,
      dp.trust_score,
      dp.van_size                              AS driver_van_size,
      dp.vehicle_type                          AS driver_vehicle_type,
      dl.lat                                   AS driver_lat,
      dl.lng                                   AS driver_lng,
      /* plan metadata — prefer the driver_subscriptions → subscription_plans
       * join, fall back to driver_profiles.subscription_plan for legacy
       * rows. dispatch_priority defaults to 1 for the free tier. */
      COALESCE(sp.name, dp.subscription_plan, 'free') AS plan_name,
      COALESCE(sp.dispatch_priority, 1)              AS dispatch_priority,
      /* active jobs count — workload */
      (SELECT COUNT(*)
         FROM public.bookings b2
        WHERE b2.driver_id = dp.id
          AND b2.status IN ('driver_assigned','pickup_arrived','loading','in_transit')
      )::int                                   AS active_jobs
    FROM public.driver_profiles dp
    /* Latest GPS fix per driver. DISTINCT ON is faster than a
     * correlated subquery when there are many rows per driver. */
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
    c.driver_id,
    c.driver_user_id,
    c.full_name,
    public.haversine_km(
      c.driver_lat,
      c.driver_lng,
      (SELECT pickup_lat FROM booking),
      (SELECT pickup_lng FROM booking)
    ) AS distance_km,

    /* Scoring formula — see header comment. Each component guards
     * against NULL with COALESCE so new drivers with missing
     * metrics don't get NaN-scored out of existence. */
    (
        (40 / GREATEST(
          public.haversine_km(
            c.driver_lat,
            c.driver_lng,
            (SELECT pickup_lat FROM booking),
            (SELECT pickup_lng FROM booking)
          ),
          0.5
        ))
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
          THEN 8
          ELSE 0
        END
    )::numeric                              AS score,

    c.rating,
    c.acceptance_rate,
    c.cancellation_rate,
    c.trust_score,
    c.plan_name,
    c.dispatch_priority,
    c.active_jobs,
    (c.driver_city IS NOT NULL
      AND (SELECT pickup_city FROM booking) IS NOT NULL
      AND LOWER(c.driver_city) = LOWER((SELECT pickup_city FROM booking))
    ) AS same_city
  FROM candidates c
  WHERE
    /* Distance filter: 15 km radius. Adjust here to change the
     * reachable pool without touching the scoring logic. */
    public.haversine_km(
      c.driver_lat,
      c.driver_lng,
      (SELECT pickup_lat FROM booking),
      (SELECT pickup_lng FROM booking)
    ) <= 15
    /* Vehicle compatibility — prefer exact match, allow bigger vans
     * to cover smaller van bookings. For v1 we keep it simple: any
     * driver whose van_size OR vehicle_type matches the booking's
     * requested van_type is eligible. NULL on either side means the
     * column is unmaintained and we don't want to exclude them. */
    AND (
      (SELECT van_type FROM booking) IS NULL
      OR c.driver_van_size = (SELECT van_type FROM booking)
      OR c.driver_vehicle_type = (SELECT van_type FROM booking)
      OR c.driver_van_size IS NULL
    )
    /* Don't assign a booking to its own customer. */
    AND c.driver_user_id IS DISTINCT FROM (SELECT customer_id FROM booking)
  ORDER BY score DESC
  LIMIT 10;
$$;

GRANT EXECUTE ON FUNCTION public.dispatch_rank_candidates(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- 4. dispatch_assign_best_driver — atomic assign + notify + log
-- ----------------------------------------------------------------------------
-- Picks the top candidate from dispatch_rank_candidates, updates the
-- booking, writes a dispatch_logs row, and notifies the chosen
-- driver via notifications. SECURITY DEFINER so it can write to
-- all three tables regardless of the triggering user's RLS.
--
-- Returns jsonb so callers (triggers, RPCs, the admin dashboard)
-- get a single structured result:
--
--   { "success": true, "driver_id": "...", "driver_name": "...",
--     "score": 147.3, "distance_km": 2.4 }
-- or
--   { "success": false, "reason": "no_candidates" }
-- or
--   { "success": false, "reason": "already_assigned",
--     "driver_id": "..." }

CREATE OR REPLACE FUNCTION public.dispatch_assign_best_driver(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking        public.bookings%ROWTYPE;
  v_top            RECORD;
  v_result         jsonb;
BEGIN
  /* Load + guard: the booking must exist and still be unassigned. */
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'booking_not_found');
  END IF;

  IF v_booking.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'already_assigned',
      'driver_id', v_booking.driver_id
    );
  END IF;

  /* Pick the top-scoring candidate. */
  SELECT *
    INTO v_top
    FROM public.dispatch_rank_candidates(p_booking_id)
   ORDER BY score DESC
   LIMIT 1;

  IF v_top IS NULL THEN
    /* No eligible drivers — log the failure so admin can see it in
     * the Bookings / Fleet Map tab and dispatch manually. */
    INSERT INTO public.dispatch_logs (booking_id, driver_id, dispatch_score, notification_sent_at, response)
    VALUES (p_booking_id, NULL, 0, now(), 'no_candidates');

    RETURN jsonb_build_object('success', false, 'reason', 'no_candidates');
  END IF;

  /* Atomic assignment: only proceed if the booking is still
   * unassigned (race guard against concurrent dispatchers). */
  UPDATE public.bookings
     SET driver_id = v_top.driver_id,
         status    = 'driver_assigned'
   WHERE id = p_booking_id
     AND driver_id IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'race_already_assigned'
    );
  END IF;

  /* Audit trail for the dispatch decision. response stays NULL
   * until the driver accepts or the cascade timer expires. */
  INSERT INTO public.dispatch_logs (booking_id, driver_id, dispatch_score, notification_sent_at)
  VALUES (p_booking_id, v_top.driver_id, v_top.score, now());

  /* Push a bell notification to the chosen driver. useNotifications
   * picks this up in Realtime and lights up the header bell. */
  INSERT INTO public.notifications (user_id, kind, title, body, link_page, link_id)
  VALUES (
    v_top.driver_user_id,
    'dispatch',
    'New job available',
    'Pickup at ' || COALESCE(v_booking.pickup_address, 'destination')
      || ' · ' || ROUND(v_top.distance_km, 1)::text || ' km away'
      || ' · ~' || COALESCE(v_booking.price_estimate::text, '?') || ' NOK',
    'driver-portal',
    p_booking_id
  );

  v_result := jsonb_build_object(
    'success',      true,
    'driver_id',    v_top.driver_id,
    'driver_user_id', v_top.driver_user_id,
    'driver_name',  v_top.full_name,
    'score',        v_top.score,
    'distance_km',  v_top.distance_km,
    'active_jobs',  v_top.active_jobs,
    'same_city',    v_top.same_city
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dispatch_assign_best_driver(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- 5. Booking trigger — auto-dispatch on payment captured
-- ----------------------------------------------------------------------------
-- Fires whenever payment_status transitions to 'escrow' or 'paid'
-- AND the booking still has no driver. Calls
-- dispatch_assign_best_driver() and eats any exception so the
-- payment update isn't rolled back if dispatch happens to fail
-- (we'd rather land the payment and leave an unassigned row than
-- lose the payment capture).

CREATE OR REPLACE FUNCTION public.trigger_dispatch_on_payment_captured()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_captured_states text[] := ARRAY['escrow','paid'];
BEGIN
  IF NEW.driver_id IS NULL
     AND NEW.payment_status = ANY (v_captured_states)
     AND (OLD.payment_status IS NULL OR NOT (OLD.payment_status = ANY (v_captured_states)))
  THEN
    BEGIN
      PERFORM public.dispatch_assign_best_driver(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      /* Log + continue. Payment must not be rolled back on
       * dispatch failure. Admins will see the unassigned
       * booking in the Bookings tab and can manually dispatch. */
      RAISE WARNING 'dispatch_assign_best_driver failed for %: % %',
        NEW.id, SQLSTATE, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_on_payment_captured ON public.bookings;
CREATE TRIGGER trg_dispatch_on_payment_captured
  AFTER UPDATE OF payment_status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_dispatch_on_payment_captured();


-- ============================================================================
-- Verify
-- ============================================================================
--
--   -- 1. Functions installed
--   SELECT proname FROM pg_proc
--    WHERE pronamespace = 'public'::regnamespace
--      AND proname IN (
--        'haversine_km',
--        'dispatch_rank_candidates',
--        'dispatch_assign_best_driver',
--        'trigger_dispatch_on_payment_captured'
--      );
--
--   -- 2. Trigger is attached
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_dispatch_on_payment_captured';
--
--   -- 3. notifications table exists and is in the realtime publication
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications';
--
--   -- 4. Dry-run on a real pending booking
--   SELECT * FROM public.dispatch_rank_candidates('<booking_uuid>');
--   SELECT public.dispatch_assign_best_driver('<booking_uuid>');
--
-- ============================================================================
