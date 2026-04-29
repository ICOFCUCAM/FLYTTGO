-- ============================================================================
-- FlyttGo — Complete Supabase Schema Migration
-- ============================================================================
-- Run this on a FRESH Supabase project to create the entire FlyttGo database.
-- Safe to re-run on existing projects (uses IF NOT EXISTS / OR REPLACE).
--
-- Sections:
--   1. Core tables (profiles, bookings, escrow, etc.)
--   2. Driver system tables
--   3. Platform tables (config, notifications, dispatch)
--   4. Indexes
--   5. Functions (auth helpers, dispatch engine, triggers)
--   6. Triggers
--   7. RLS policies
--   8. Storage buckets
--   9. Realtime publication
-- ============================================================================


-- ============================================================================
-- 1. CORE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id              uuid PRIMARY KEY,
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name      text,
  last_name       text,
  email           text,
  phone           text,
  role            text,         -- 'customer' | 'driver' | 'business' | 'admin'
  avatar_url      text,
  language        text,
  country         text,
  referral_code   text,
  created_at      timestamptz,
  updated_at      timestamptz
);

CREATE TABLE IF NOT EXISTS public.admin_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id),
  admin_role      text DEFAULT 'admin',
  permissions     jsonb,
  created_at      timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bookings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           uuid REFERENCES auth.users(id),
  driver_id             uuid,       -- references driver_profiles.id
  pickup_address        text,
  dropoff_address       text,
  pickup_lat            numeric,
  pickup_lng            numeric,
  dropoff_lat           numeric,
  dropoff_lng           numeric,
  pickup_postcode       text,
  dropoff_postcode      text,
  pickup_city           text,
  dropoff_city          text,
  status                text DEFAULT 'pending',
    -- CHECK: pending|confirmed|driver_assigned|pickup_arrived|loading|in_transit|completed|cancelled
  van_type              text,
  helpers               integer,
  move_type             text,
  move_date             timestamptz,
  move_time             time,
  items                 jsonb,
  additional_services   jsonb,
  customer_notes        text,
  customer_name         text,
  customer_phone        text,
  customer_email        text,
  name                  text,
  phone                 text,
  email                 text,
  -- Pricing
  price_estimate        numeric,
  original_price        numeric,
  final_price           numeric,
  distance_km           numeric,
  duration_hours        numeric,
  duration_minutes      integer,
  estimated_hours       numeric,
  actual_hours          numeric,
  hourly_rate           numeric,
  commission_rate       numeric,
  commission_amount     numeric,
  driver_earning        numeric,
  price_adjusted        boolean,
  -- Payment
  payment_status        text DEFAULT 'pending',  -- pending|escrow|released|refunded
  payment_provider      text,       -- stripe|vipps|invoice
  payment_intent_id     text,
  stripe_session_id     text,
  escrow_activated      boolean,
  -- Confirmation
  customer_confirmed    boolean,
  admin_confirmed       boolean,
  driver_confirmation   boolean,
  customer_confirmation boolean,
  -- Timestamps
  start_time            timestamptz,
  end_time              timestamptz,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz
);

CREATE TABLE IF NOT EXISTS public.escrow_payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid REFERENCES bookings(id),
  status                text DEFAULT 'pending',  -- pending|held|escrow|released|refunded
  driver_earning        numeric,
  refund_amount         numeric,
  adjustment_required   boolean,
  adjustment_approved   boolean,
  created_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_updates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid REFERENCES bookings(id),
  status                text,
  created_at            timestamptz DEFAULT now()
);


-- ============================================================================
-- 2. DRIVER SYSTEM TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.drivers (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid REFERENCES auth.users(id),
  status                  text DEFAULT 'pending',  -- pending|active|suspended
  subscription_plan       text,
  subscription_active     boolean,
  subscription_start_date timestamptz,
  rating                  numeric,
  trust_score             numeric,
  completed_deliveries    integer,
  acceptance_rate         numeric,
  cancellation_rate       numeric,
  tier                    text,
  city                    text,
  zone                    text,
  online                  boolean DEFAULT false,
  default_plan_id         uuid,
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES auth.users(id),
  full_name             text,
  first_name            text,
  last_name             text,
  phone                 text,
  city                  text,
  zone                  text,
  status                text DEFAULT 'pending',  -- pending|approved|suspended
  rating                numeric,
  trust_score           numeric,
  total_jobs            integer,
  completed_deliveries  integer,
  acceptance_rate       numeric,
  cancellation_rate     numeric,
  tier                  text,
  online                boolean DEFAULT false,
  vehicle_type          text,
  vehicle_model         text,
  license_plate         text,
  van_size              text,
  subscription_plan     text,
  subscription_active   boolean,
  created_at            timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_applications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES auth.users(id),
  first_name            text,
  last_name             text,
  email                 text,
  phone                 text,
  address               text,
  license_number        text,
  license_expiry        date,
  years_experience      integer,
  vehicle_type          text,
  vehicle_model         text,
  vehicle_year          integer,
  vehicle_registration  text,
  cargo_capacity        numeric,
  city                  text,
  zone                  text,
  status                text DEFAULT 'pending',  -- pending|approved|rejected
  documents             jsonb DEFAULT '{}'::jsonb,
  reviewed_by           uuid REFERENCES auth.users(id),
  reviewed_at           timestamptz,
  rejection_reason      text,
  created_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_documents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id             uuid,       -- auth.users.id (not driver_profiles.id)
  document_type         text,       -- driver_license|insurance|vehicle_registration|identity_document|profile_photo
  file_url              text,
  verification_status   text DEFAULT 'pending',  -- pending|approved|rejected
  status                text DEFAULT 'pending',
  uploaded_at           timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_locations (
  driver_id             uuid,       -- auth.users.id
  lat                   numeric,
  lng                   numeric,
  heading               numeric,
  speed                 numeric,
  updated_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_wallets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id             uuid,       -- driver_profiles.id
  balance               numeric DEFAULT 0,
  pending               numeric DEFAULT 0,
  total_earned          numeric DEFAULT 0,
  total_withdrawn       numeric DEFAULT 0,
  pending_payout        numeric DEFAULT 0,
  created_at            timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_wallet_transactions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id             uuid,
  booking_id            uuid,
  type                  text,       -- escrow_release|refund_reversal|subscription_credit|payout
  amount                numeric,
  description           text,
  created_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text,
  price                 numeric,
  billing_period        text,
  job_visibility        text,
  base_commission       jsonb,
  dispatch_priority     integer,
  dispatch_weight       integer,
  features              jsonb,
  max_job_value         integer,
  created_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_subscriptions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id               uuid,     -- auth.users.id
  plan_id                 uuid REFERENCES subscription_plans(id),
  payment_method          text,
  subscription_status     text DEFAULT 'active',  -- active|expired|cancelled
  start_date              timestamptz,
  end_date                timestamptz,
  stripe_subscription_id  text,
  pending_plan            text,
  proration_credit        numeric,
  amount_paid_nok         numeric,
  vat_nok                 numeric,
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id             uuid,
  amount                numeric,
  created_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payout_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id             uuid,
  amount                numeric,
  status                text DEFAULT 'pending',
  created_at            timestamptz DEFAULT now()
);


-- ============================================================================
-- 3. PLATFORM TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.platform_config (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key            text UNIQUE,
  config_value          text,
  created_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commission_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid,
  commission_amount     numeric,
  created_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dispatch_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid,
  driver_id             uuid,
  dispatch_score        numeric,
  notification_sent_at  timestamptz,
  response              text,       -- accepted|rejected|no_candidates|stale_reclaimed
  response_time         integer,    -- seconds
  created_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind                  text NOT NULL,  -- booking_status|payment|driver_assigned|dispatch|system
  title                 text NOT NULL,
  body                  text,
  link_page             text,       -- Page enum value
  link_id               uuid,
  read_at               timestamptz,
  created_at            timestamptz DEFAULT now()
);


-- ============================================================================
-- 4. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, read_at);


-- ============================================================================
-- 5. FUNCTIONS
-- ============================================================================

-- 5a. Admin helper
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_accounts
    WHERE user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- 5b. Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.id) THEN
    INSERT INTO public.profiles (
      id, user_id, email, first_name, last_name, role, referral_code
    ) VALUES (
      gen_random_uuid(),
      NEW.id,
      NEW.email,
      NULLIF(meta ->> 'first_name', ''),
      NULLIF(meta ->> 'last_name',  ''),
      COALESCE(NULLIF(meta ->> 'role', ''), 'customer'),
      'FLYTTGO-' || UPPER(SUBSTRING(NEW.id::text FROM 1 FOR 8))
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5c. Sync profile role on driver approval
CREATE OR REPLACE FUNCTION public.sync_profile_role_on_driver_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' THEN
    UPDATE public.profiles
       SET role = 'driver'
     WHERE user_id = NEW.user_id
       AND role <> 'driver'
       AND role <> 'admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_role_on_driver_approval ON public.driver_profiles;
CREATE TRIGGER sync_profile_role_on_driver_approval
  AFTER INSERT OR UPDATE OF status ON public.driver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role_on_driver_approval();

-- 5d. Haversine distance (dispatch engine)
CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  WITH r AS (SELECT 6371::numeric AS earth_km)
  SELECT (2 * r.earth_km * ASIN(SQRT(
      POWER(SIN(RADIANS(lat2 - lat1) / 2), 2)
    + COS(RADIANS(lat1)) * COS(RADIANS(lat2))
      * POWER(SIN(RADIANS(lng2 - lng1) / 2), 2)
  )))::numeric FROM r;
$$;

-- 5e. Dispatch ranking
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
    SELECT id, customer_id, pickup_lat, pickup_lng, pickup_city, van_type
      FROM public.bookings WHERE id = p_booking_id
  ),
  candidates AS (
    SELECT dp.id AS driver_id, dp.user_id AS driver_user_id, dp.full_name,
           dp.city AS driver_city, dp.rating, dp.acceptance_rate,
           dp.cancellation_rate, dp.trust_score,
           dp.van_size AS driver_van_size, dp.vehicle_type AS driver_vehicle_type,
           dl.lat AS driver_lat, dl.lng AS driver_lng,
           COALESCE(sp.name, dp.subscription_plan, 'free') AS plan_name,
           COALESCE(sp.dispatch_priority, 1) AS dispatch_priority,
           (SELECT COUNT(*) FROM public.bookings b2
             WHERE b2.driver_id = dp.id
               AND b2.status IN ('driver_assigned','pickup_arrived','loading','in_transit'))::int AS active_jobs
      FROM public.driver_profiles dp
      JOIN LATERAL (
        SELECT dl2.lat, dl2.lng FROM public.driver_locations dl2
         WHERE dl2.driver_id = dp.user_id ORDER BY dl2.updated_at DESC LIMIT 1
      ) dl ON true
      LEFT JOIN public.driver_subscriptions ds
             ON ds.driver_id = dp.user_id AND ds.subscription_status = 'active'
      LEFT JOIN public.subscription_plans sp ON sp.id = ds.plan_id
     WHERE dp.online = true AND dp.status = 'approved'
       AND COALESCE(dp.subscription_active, false) = true
  )
  SELECT c.driver_id, c.driver_user_id, c.full_name,
    public.haversine_km(c.driver_lat, c.driver_lng, (SELECT pickup_lat FROM booking), (SELECT pickup_lng FROM booking)) AS distance_km,
    ((40 / GREATEST(public.haversine_km(c.driver_lat, c.driver_lng, (SELECT pickup_lat FROM booking), (SELECT pickup_lng FROM booking)), 0.5))
      + (COALESCE(c.rating, 4.5) * 20) + (COALESCE(c.dispatch_priority, 1) * 15)
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
    AND c.driver_user_id IS DISTINCT FROM (SELECT customer_id FROM booking)
  ORDER BY score DESC LIMIT 10;
$$;

GRANT EXECUTE ON FUNCTION public.dispatch_rank_candidates(uuid) TO authenticated;

-- 5f. Stale dispatch reclaim
CREATE OR REPLACE FUNCTION public.reclaim_stale_dispatches(p_timeout_minutes integer DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_reclaimed integer := 0;
  v_cutoff timestamptz := now() - (p_timeout_minutes || ' minutes')::interval;
BEGIN
  WITH stale AS (
    SELECT b.id FROM public.bookings b
    JOIN LATERAL (SELECT notification_sent_at FROM public.dispatch_logs
      WHERE booking_id = b.id AND driver_id IS NOT NULL
      ORDER BY notification_sent_at DESC LIMIT 1) last_log ON true
    WHERE b.status = 'driver_assigned' AND b.start_time IS NULL
      AND b.driver_id IS NOT NULL AND last_log.notification_sent_at < v_cutoff
  ),
  reverted AS (
    UPDATE public.bookings b SET driver_id = NULL, status = 'pending'
      FROM stale s WHERE b.id = s.id RETURNING b.id, b.driver_id
  )
  INSERT INTO public.dispatch_logs (booking_id, driver_id, dispatch_score, notification_sent_at, response)
  SELECT id, driver_id, 0, now(), 'stale_reclaimed' FROM reverted;
  GET DIAGNOSTICS v_reclaimed = ROW_COUNT;
  RETURN v_reclaimed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reclaim_stale_dispatches(integer) TO authenticated;

-- 5g. Dispatch assign best driver
CREATE OR REPLACE FUNCTION public.dispatch_assign_best_driver(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_top RECORD;
BEGIN
  PERFORM public.reclaim_stale_dispatches(5);
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'reason', 'booking_not_found'); END IF;
  IF v_booking.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_assigned', 'driver_id', v_booking.driver_id);
  END IF;
  SELECT * INTO v_top FROM public.dispatch_rank_candidates(p_booking_id) ORDER BY score DESC LIMIT 1;
  IF v_top IS NULL THEN
    INSERT INTO public.dispatch_logs (booking_id, driver_id, dispatch_score, notification_sent_at, response)
    VALUES (p_booking_id, NULL, 0, now(), 'no_candidates');
    RETURN jsonb_build_object('success', false, 'reason', 'no_candidates');
  END IF;
  UPDATE public.bookings SET driver_id = v_top.driver_id, status = 'driver_assigned'
   WHERE id = p_booking_id AND driver_id IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'reason', 'race_already_assigned'); END IF;
  INSERT INTO public.dispatch_logs (booking_id, driver_id, dispatch_score, notification_sent_at)
  VALUES (p_booking_id, v_top.driver_id, v_top.score, now());
  INSERT INTO public.notifications (user_id, kind, title, body, link_page, link_id)
  VALUES (v_top.driver_user_id, 'dispatch', 'New job available',
    'Pickup at ' || COALESCE(v_booking.pickup_address, 'destination')
    || ' · ' || ROUND(v_top.distance_km, 1)::text || ' km away'
    || ' · ~' || COALESCE(v_booking.price_estimate::text, '?') || ' NOK',
    'driver-portal', p_booking_id);
  RETURN jsonb_build_object('success', true, 'driver_id', v_top.driver_id,
    'driver_user_id', v_top.driver_user_id, 'driver_name', v_top.full_name,
    'score', v_top.score, 'distance_km', v_top.distance_km,
    'active_jobs', v_top.active_jobs, 'same_city', v_top.same_city);
END;
$$;

GRANT EXECUTE ON FUNCTION public.dispatch_assign_best_driver(uuid) TO authenticated;

-- 5h. Auto-dispatch trigger function
CREATE OR REPLACE FUNCTION public.trigger_dispatch_on_payment_captured()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_captured_states text[] := ARRAY['escrow','paid'];
BEGIN
  IF NEW.driver_id IS NULL
     AND NEW.payment_status = ANY (v_captured_states)
     AND (OLD.payment_status IS NULL OR NOT (OLD.payment_status = ANY (v_captured_states)))
  THEN
    BEGIN
      PERFORM public.dispatch_assign_best_driver(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'dispatch failed for %: % %', NEW.id, SQLSTATE, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_on_payment_captured ON public.bookings;
CREATE TRIGGER trg_dispatch_on_payment_captured
  AFTER UPDATE OF payment_status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trigger_dispatch_on_payment_captured();


-- ============================================================================
-- 6. ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications       ENABLE ROW LEVEL SECURITY;
-- These tables are RLS-off by design (admin reads via is_admin() on key tables):
-- driver_profiles, driver_documents, driver_subscriptions, driver_wallets,
-- driver_wallet_transactions, escrow_payments, commission_ledger,
-- subscription_payments, platform_config, driver_locations


-- ============================================================================
-- 7. RLS POLICIES
-- ============================================================================

-- ── profiles ──
DROP POLICY IF EXISTS profiles_admin_all ON public.profiles;
CREATE POLICY profiles_admin_all ON public.profiles
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
CREATE POLICY profiles_self_insert ON public.profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ── bookings ──
DROP POLICY IF EXISTS bookings_admin_all ON public.bookings;
CREATE POLICY bookings_admin_all ON public.bookings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS bookings_customer_insert ON public.bookings;
CREATE POLICY bookings_customer_insert ON public.bookings
  FOR INSERT TO authenticated WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS bookings_customer_select ON public.bookings;
CREATE POLICY bookings_customer_select ON public.bookings
  FOR SELECT TO authenticated USING (customer_id = auth.uid());

DROP POLICY IF EXISTS bookings_customer_update ON public.bookings;
CREATE POLICY bookings_customer_update ON public.bookings
  FOR UPDATE TO authenticated
  USING (customer_id = auth.uid()) WITH CHECK (customer_id = auth.uid());

-- ── driver_applications ──
DROP POLICY IF EXISTS driver_applications_admin_all ON public.driver_applications;
CREATE POLICY driver_applications_admin_all ON public.driver_applications
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS driver_apps_insert_own ON public.driver_applications;
CREATE POLICY driver_apps_insert_own ON public.driver_applications
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS driver_apps_select_own ON public.driver_applications;
CREATE POLICY driver_apps_select_own ON public.driver_applications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS driver_apps_update_own ON public.driver_applications;
CREATE POLICY driver_apps_update_own ON public.driver_applications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── notifications ──
DROP POLICY IF EXISTS notifications_self_select ON public.notifications;
CREATE POLICY notifications_self_select ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_self_update ON public.notifications;
CREATE POLICY notifications_self_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_admin_all ON public.notifications;
CREATE POLICY notifications_admin_all ON public.notifications
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());


-- ============================================================================
-- 8. STORAGE BUCKETS
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'driver-documents', 'driver-documents', false,
  10 * 1024 * 1024,
  ARRAY['image/jpeg','image/png','application/pdf']
) ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS: drivers CRUD their own folder, admins see everything
DROP POLICY IF EXISTS "driver-documents-self-insert" ON storage.objects;
CREATE POLICY "driver-documents-self-insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "driver-documents-self-select" ON storage.objects;
CREATE POLICY "driver-documents-self-select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "driver-documents-self-update" ON storage.objects;
CREATE POLICY "driver-documents-self-update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "driver-documents-self-delete" ON storage.objects;
CREATE POLICY "driver-documents-self-delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "driver-documents-admin-all" ON storage.objects;
CREATE POLICY "driver-documents-admin-all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'driver-documents' AND public.is_admin())
  WITH CHECK (bucket_id = 'driver-documents' AND public.is_admin());


-- ============================================================================
-- 9. REALTIME PUBLICATION
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications; END IF;
END $$;


-- ============================================================================
-- DONE
-- ============================================================================
-- This migration creates the complete FlyttGo schema from scratch.
-- After running, you still need to:
--   1. Set up auth providers (Google, Apple) in the Supabase dashboard
--   2. Configure Site URL + Redirect URLs under Authentication → URL Configuration
--   3. Set Edge Function secrets (STRIPE_SECRET_KEY, VIPPS_*, FRONTEND_URL)
--   4. Deploy Edge Functions (create-checkout-session, process-payment, etc.)
--   5. Insert subscription_plans rows with your pricing data
--   6. Create an admin account: INSERT INTO admin_accounts (id, user_id) ...
-- ============================================================================
