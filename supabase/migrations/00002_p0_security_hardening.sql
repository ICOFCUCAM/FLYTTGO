-- ============================================================================
-- FlyttGo — P0 security hardening
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Review together with the Edge Function
-- changes on the same branch. Written against both the repository
-- schema (00001) and the production project "FlyttGo Norway"
-- (qzclatvpzicwhewzdiwf) as read on 2026-10-29, which has 52 public
-- tables and its own escrow triggers (docs/SECURITY_P0.md lists the
-- differences). Deploy order and checks: docs/SECURITY_P0.md.
--
-- Closes, at the database level:
--   1. Customers setting payment_status / prices / the driver's
--      confirmation on their own booking (payment bypass → dispatch).
--   2. Tables reachable with the anon key and no RLS (wallets, escrow,
--      ledger, platform_config, driver locations, admin_accounts …).
--   3. Any signed-in user running dispatch_assign_best_driver or
--      reclaim_stale_dispatches on any booking.
--   4. Self-chosen roles at sign-up and self-edited profiles.role.
--   5. Drivers activating paid plans for themselves (and, in production,
--      anyone changing any driver's plan through change_driver_subscription).
--   6. Escrow release paying the driver more than once (production's
--      settlement trigger + process-payment) or nulling the balance.
-- and adds what the code already calls but the schema lacked
-- (wallet RPCs, escrow columns, manual_refund_percent), plus admin
-- escrow release/refund as single transactions.
--
-- Shape of the protection: Row Level Security decides WHICH rows a
-- user reaches; BEFORE triggers ("guards") decide WHICH COLUMNS a
-- non-privileged user may change on those rows, by allow-list, so a
-- column that exists only in production is protected by default.
-- Privileged = admin (is_admin()), the service role (Edge Functions),
-- or a direct database session (SQL editor, pg_cron, pg_net).
--
-- Every policy on the tables listed in section 6 is dropped and
-- recreated here, including policies that exist only in production;
-- their names are printed as NOTICEs so the reviewer can see them.
--
-- Safe to re-run.
-- ============================================================================


-- ============================================================================
-- 1. COLUMNS THE CODE ALREADY USES
-- ============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS manual_refund_percent numeric,      -- AdminDashboard refund override
  ADD COLUMN IF NOT EXISTS payment_review_reason text;         -- set by webhooks on amount mismatch

ALTER TABLE public.escrow_payments
  ADD COLUMN IF NOT EXISTS amount            numeric,          -- BookingFlow insert
  ADD COLUMN IF NOT EXISTS original_amount   numeric,
  ADD COLUMN IF NOT EXISTS adjusted_amount   numeric,          -- process-payment recalculate_price
  ADD COLUMN IF NOT EXISTS adjustment_reason text,
  ADD COLUMN IF NOT EXISTS released_at       timestamptz,      -- process-payment release_escrow
  ADD COLUMN IF NOT EXISTS commission_amount numeric,
  ADD COLUMN IF NOT EXISTS final_price       numeric;

ALTER TABLE public.driver_subscriptions
  ADD COLUMN IF NOT EXISTS plan text;                          -- DriverPortal, stripe-webhook, dispatch

-- useDriverLocationBeacon upserts ON CONFLICT (driver_id), which needs a
-- unique index. Created only when absent and when no duplicates exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
     WHERE c.oid = 'public.driver_locations'::regclass
       AND i.indisunique AND i.indnatts = 1 AND a.attname = 'driver_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.driver_locations GROUP BY driver_id HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX driver_locations_driver_id_key ON public.driver_locations (driver_id);
  END IF;
END $$;


-- ============================================================================
-- 2. HELPERS
-- ============================================================================

-- True for admins, the service role and direct database sessions.
-- PostgREST and Realtime always set request.jwt.claims; pg_cron, pg_net
-- and the SQL editor do not. Also true inside a trusted function of this
-- migration (change_driver_subscription) after it has checked the
-- caller itself: it sets the transaction-local flyttgo.trusted, which a
-- browser cannot set (PostgREST exposes no set_config).
CREATE OR REPLACE FUNCTION public.is_privileged()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = ''
      OR coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      OR coalesce(current_setting('flyttgo.trusted', true), '') = 'on'
      OR public.is_admin();
$$;

-- driver_profiles.id of the signed-in user (bookings.driver_id,
-- driver_wallets.driver_id and payout_requests.driver_id use it).
CREATE OR REPLACE FUNCTION public.my_driver_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.driver_profiles WHERE user_id = auth.uid() ORDER BY created_at LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_approved_driver()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.driver_profiles WHERE user_id = auth.uid() AND status = 'approved');
$$;

-- Columns of NEW that differ from OLD, ignoring the allowed ones.
CREATE OR REPLACE FUNCTION public.changed_columns(p_old jsonb, p_new jsonb, p_allowed text[])
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(array_agg(k ORDER BY k), '{}')
    FROM jsonb_object_keys(p_new) AS k
   WHERE NOT (k = ANY (p_allowed))
     AND (p_old -> k) IS DISTINCT FROM (p_new -> k);
$$;

GRANT EXECUTE ON FUNCTION public.is_privileged()      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_driver_id()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_driver() TO authenticated;


-- ============================================================================
-- 3. SIGN-UP ROLE AND PROFILES
-- ============================================================================

-- A sign-up may only ask to be a customer, a driver applicant or a
-- business. 'admin' (or anything else) becomes 'customer'; admin rights
-- come only from admin_accounts.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_role text := lower(COALESCE(NULLIF(meta ->> 'role', ''), 'customer'));
BEGIN
  IF v_role NOT IN ('customer', 'driver', 'business') THEN
    v_role := 'customer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.id) THEN
    INSERT INTO public.profiles (
      id, user_id, email, first_name, last_name, role, referral_code
    ) VALUES (
      gen_random_uuid(),
      NEW.id,
      NEW.email,
      NULLIF(meta ->> 'first_name', ''),
      NULLIF(meta ->> 'last_name',  ''),
      v_role,
      'FLYTTGO-' || UPPER(SUBSTRING(NEW.id::text FROM 1 FOR 8))
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_profile_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_privileged() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.role IS NULL OR NEW.role NOT IN ('customer', 'driver', 'business') THEN
      NEW.role := 'customer';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profiles: role and identity can only be changed by an administrator'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_write ON public.profiles;
CREATE TRIGGER guard_profile_write
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_write();


-- ============================================================================
-- 4. BOOKINGS AND ESCROW GUARDS
-- ============================================================================

-- Customer inserts: everything about payment, assignment and outcome is
-- reset; the price fields are kept as a preview only — the payment
-- functions re-price on the server before charging.
-- Updates by non-privileged users, by allow-list:
--   customer: customer_confirmation (→ true, once the job is completed),
--             status → 'cancelled' (while pending/confirmed), customer_notes
--   driver:   claim an unassigned PAID booking (driver_id, status);
--             on their own booking: status along the job, start/end time,
--             driver_confirmation (→ true, once completed)
CREATE OR REPLACE FUNCTION public.guard_booking_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_driver   uuid;
  v_changed  text[];
  v_allowed  text[];
BEGIN
  IF public.is_privileged() THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status                := 'pending';
    NEW.payment_status        := 'pending';
    NEW.driver_id             := NULL;
    NEW.final_price           := NULL;
    NEW.actual_hours          := NULL;
    NEW.commission_rate       := NULL;
    NEW.commission_amount     := NULL;
    NEW.driver_earning        := NULL;
    NEW.price_adjusted        := NULL;
    NEW.payment_provider      := NULL;
    NEW.payment_intent_id     := NULL;
    NEW.stripe_session_id     := NULL;
    NEW.escrow_activated      := NULL;
    NEW.customer_confirmed    := NULL;
    NEW.admin_confirmed       := NULL;
    NEW.driver_confirmation   := NULL;
    NEW.customer_confirmation := NULL;
    NEW.start_time            := NULL;
    NEW.end_time              := NULL;
    NEW.manual_refund_percent := NULL;
    NEW.payment_review_reason := NULL;
    RETURN NEW;
  END IF;

  v_driver := public.my_driver_id();

  -- Customer of this booking.
  IF OLD.customer_id = v_uid THEN
    v_allowed := ARRAY['customer_confirmation', 'status', 'customer_notes', 'updated_at'];
    v_changed := public.changed_columns(to_jsonb(OLD), to_jsonb(NEW), v_allowed);
    IF cardinality(v_changed) = 0
       AND (NEW.customer_confirmation IS NOT DISTINCT FROM OLD.customer_confirmation
            OR (NEW.customer_confirmation = true AND OLD.status = 'completed'))
       AND (NEW.status IS NOT DISTINCT FROM OLD.status
            OR (NEW.status = 'cancelled' AND OLD.status IN ('pending', 'confirmed')))
    THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Driver claiming an unassigned, paid booking.
  IF v_driver IS NOT NULL AND OLD.driver_id IS NULL AND NEW.driver_id = v_driver THEN
    v_allowed := ARRAY['driver_id', 'status', 'updated_at'];
    v_changed := public.changed_columns(to_jsonb(OLD), to_jsonb(NEW), v_allowed);
    IF cardinality(v_changed) = 0
       AND public.is_approved_driver()
       AND OLD.status IN ('pending', 'confirmed')
       AND OLD.payment_status IN ('paid', 'escrow')
       AND NEW.status = 'driver_assigned'
       AND OLD.customer_id IS DISTINCT FROM v_uid
    THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Driver working their own booking.
  IF v_driver IS NOT NULL AND OLD.driver_id = v_driver THEN
    v_allowed := ARRAY['status', 'start_time', 'end_time', 'driver_confirmation', 'updated_at'];
    v_changed := public.changed_columns(to_jsonb(OLD), to_jsonb(NEW), v_allowed);
    IF cardinality(v_changed) = 0
       AND (NEW.status IS NOT DISTINCT FROM OLD.status
            OR (NEW.status IN ('pickup_arrived', 'loading', 'in_transit', 'completed')
                AND OLD.status NOT IN ('completed', 'cancelled')))
       AND (NEW.driver_confirmation IS NOT DISTINCT FROM OLD.driver_confirmation
            OR (NEW.driver_confirmation = true AND NEW.status = 'completed'))
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'bookings: this change is not allowed for your account (columns: %)',
    array_to_string(public.changed_columns(to_jsonb(OLD), to_jsonb(NEW), ARRAY['updated_at']), ', ')
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS guard_booking_write ON public.bookings;
CREATE TRIGGER guard_booking_write
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_write();

-- Escrow: the customer creates the 'held' row for their own booking
-- (BookingFlow) and may approve a price adjustment; nothing else.
CREATE OR REPLACE FUNCTION public.guard_escrow_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price numeric;
BEGIN
  IF public.is_privileged() THEN RETURN NEW; END IF;
  -- Writes made by another trigger (production's escrow lifecycle
  -- triggers on bookings and escrow_payments, section 8) are server
  -- logic, not the client's request.
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.escrow_payments WHERE booking_id = NEW.booking_id) THEN
      RAISE EXCEPTION 'escrow_payments: booking already has an escrow row' USING ERRCODE = '23505';
    END IF;
    SELECT price_estimate INTO v_price FROM public.bookings WHERE id = NEW.booking_id;
    NEW.status              := 'held';
    NEW.amount              := v_price;
    NEW.original_amount     := v_price;
    NEW.driver_earning      := NULL;
    NEW.refund_amount       := NULL;
    NEW.adjusted_amount     := NULL;
    NEW.adjustment_reason   := NULL;
    NEW.adjustment_required := NULL;
    NEW.adjustment_approved := NULL;
    NEW.released_at         := NULL;
    NEW.commission_amount   := NULL;
    NEW.final_price         := NULL;
    RETURN NEW;
  END IF;

  IF cardinality(public.changed_columns(to_jsonb(OLD), to_jsonb(NEW), ARRAY['adjustment_approved'])) = 0
     AND NEW.adjustment_approved = true
     AND (OLD.adjusted_amount IS NOT NULL OR OLD.adjustment_required = true)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'escrow_payments: only approving a price adjustment is allowed'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS guard_escrow_write ON public.escrow_payments;
CREATE TRIGGER guard_escrow_write
  BEFORE INSERT OR UPDATE ON public.escrow_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_escrow_write();


-- ============================================================================
-- 5. DRIVER-SIDE GUARDS
-- ============================================================================

-- driver_profiles: a driver may only toggle `online`.
CREATE OR REPLACE FUNCTION public.guard_driver_profile_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.is_privileged() THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND cardinality(public.changed_columns(to_jsonb(OLD), to_jsonb(NEW), ARRAY['online', 'updated_at'])) = 0 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'driver_profiles: only the online flag can be changed by the driver' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS guard_driver_profile_write ON public.driver_profiles;
CREATE TRIGGER guard_driver_profile_write
  BEFORE INSERT OR UPDATE ON public.driver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_driver_profile_write();

-- driver_applications: applicants submit and edit their details; the
-- review outcome is the administrator's.
CREATE OR REPLACE FUNCTION public.guard_driver_application_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.is_privileged() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status           := 'pending';
    NEW.reviewed_by      := NULL;
    NEW.reviewed_at      := NULL;
    NEW.rejection_reason := NULL;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
     OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'driver_applications: the review outcome is set by an administrator' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_driver_application_write ON public.driver_applications;
CREATE TRIGGER guard_driver_application_write
  BEFORE INSERT OR UPDATE ON public.driver_applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_driver_application_write();

-- driver_documents: uploaded as pending; verification is the administrator's.
CREATE OR REPLACE FUNCTION public.guard_driver_document_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.is_privileged() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.verification_status := 'pending';
    NEW.status              := 'pending';
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'driver_documents: documents are verified by an administrator' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS guard_driver_document_write ON public.driver_documents;
CREATE TRIGGER guard_driver_document_write
  BEFORE INSERT OR UPDATE ON public.driver_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_driver_document_write();

-- driver_subscriptions: a driver may start a free plan (free/basic) and
-- mark their own lapsed subscription expired (DriverPortal's expiry
-- check). Paid plans are activated only by stripe-webhook.
CREATE OR REPLACE FUNCTION public.guard_driver_subscription_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.is_privileged() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.plan, '') NOT IN ('free', 'basic') THEN
      RAISE EXCEPTION 'driver_subscriptions: paid plans are activated by payment' USING ERRCODE = '42501';
    END IF;
    NEW.subscription_status    := 'active';
    NEW.end_date               := NULL;
    NEW.plan_id                := NULL;
    NEW.stripe_subscription_id := NULL;
    NEW.pending_plan           := NULL;
    NEW.proration_credit       := NULL;
    NEW.amount_paid_nok        := NULL;
    NEW.vat_nok                := NULL;
    RETURN NEW;
  END IF;
  IF cardinality(public.changed_columns(to_jsonb(OLD), to_jsonb(NEW), ARRAY['subscription_status'])) = 0
     AND NEW.subscription_status = 'expired'
     AND OLD.subscription_status = 'active'
     AND OLD.end_date IS NOT NULL AND OLD.end_date < now() THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'driver_subscriptions: only marking a lapsed subscription expired is allowed' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS guard_driver_subscription_write ON public.driver_subscriptions;
CREATE TRIGGER guard_driver_subscription_write
  BEFORE INSERT OR UPDATE ON public.driver_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_driver_subscription_write();

-- payout_requests: a driver asks for at most their wallet balance.
CREATE OR REPLACE FUNCTION public.guard_payout_request_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_balance numeric;
BEGIN
  IF public.is_privileged() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT balance INTO v_balance FROM public.driver_wallets WHERE driver_id = NEW.driver_id
      ORDER BY created_at DESC LIMIT 1;
    IF NEW.amount IS NULL OR NEW.amount <= 0 OR NEW.amount > coalesce(v_balance, 0) THEN
      RAISE EXCEPTION 'payout_requests: amount must be positive and at most the wallet balance' USING ERRCODE = '22023';
    END IF;
    NEW.status := 'pending';
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'payout_requests: requests are processed by an administrator' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS guard_payout_request_write ON public.payout_requests;
CREATE TRIGGER guard_payout_request_write
  BEFORE INSERT OR UPDATE ON public.payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_payout_request_write();


-- ============================================================================
-- 6. ROW LEVEL SECURITY ON EVERY TABLE
-- ============================================================================

-- Every table in public, including the ones that exist only in
-- production (corporate_accounts, payments, audit_logs, chat_*, …):
-- RLS on, existing policies dropped, administrators keep full access.
-- Tables the app does not read from the browser stay admin-only.
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      RAISE NOTICE 'dropping policy %.%', t, p.policyname;
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
      t || '_admin_all', t);
  END LOOP;
END $$;

-- ── profiles ──
CREATE POLICY profiles_self_select ON public.profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY profiles_self_insert ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── admin_accounts: read your own row (auth.tsx); written only by SQL ──
CREATE POLICY admin_accounts_self_select ON public.admin_accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ── bookings ──
CREATE POLICY bookings_customer_insert ON public.bookings
  FOR INSERT TO authenticated WITH CHECK (customer_id = auth.uid());
CREATE POLICY bookings_customer_select ON public.bookings
  FOR SELECT TO authenticated USING (customer_id = auth.uid());
CREATE POLICY bookings_customer_update ON public.bookings
  FOR UPDATE TO authenticated USING (customer_id = auth.uid()) WITH CHECK (customer_id = auth.uid());
-- Drivers see their own jobs and the pool of PAID unassigned jobs.
CREATE POLICY bookings_driver_select ON public.bookings
  FOR SELECT TO authenticated USING (
    driver_id = public.my_driver_id()
    OR (driver_id IS NULL AND status IN ('pending', 'confirmed')
        AND payment_status IN ('paid', 'escrow') AND public.is_approved_driver())
  );
CREATE POLICY bookings_driver_update ON public.bookings
  FOR UPDATE TO authenticated
  USING (
    driver_id = public.my_driver_id()
    OR (driver_id IS NULL AND status IN ('pending', 'confirmed')
        AND payment_status IN ('paid', 'escrow') AND public.is_approved_driver())
  )
  WITH CHECK (driver_id = public.my_driver_id());

-- ── escrow_payments ──
CREATE POLICY escrow_customer_select ON public.escrow_payments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.customer_id = auth.uid()));
CREATE POLICY escrow_customer_insert ON public.escrow_payments
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.customer_id = auth.uid()));
CREATE POLICY escrow_customer_update ON public.escrow_payments
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.customer_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.customer_id = auth.uid()));

-- ── driver_profiles ──
CREATE POLICY driver_profiles_self_select ON public.driver_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY driver_profiles_self_update ON public.driver_profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── driver_applications ──
CREATE POLICY driver_applications_self_insert ON public.driver_applications
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY driver_applications_self_select ON public.driver_applications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY driver_applications_self_update ON public.driver_applications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── driver_documents (driver_id is the auth user id) ──
CREATE POLICY driver_documents_self_insert ON public.driver_documents
  FOR INSERT TO authenticated WITH CHECK (driver_id = auth.uid());
CREATE POLICY driver_documents_self_select ON public.driver_documents
  FOR SELECT TO authenticated USING (driver_id = auth.uid());

-- ── driver_locations (driver_id is the auth user id) ──
CREATE POLICY driver_locations_self_all ON public.driver_locations
  FOR ALL TO authenticated USING (driver_id = auth.uid()) WITH CHECK (driver_id = auth.uid());
-- The customer of an in-flight booking sees the assigned driver.
-- bookings.driver_id is driver_profiles.id, so the check joins through
-- driver_profiles, which the customer cannot read: hence a definer helper.
CREATE OR REPLACE FUNCTION public.is_my_active_driver(p_driver_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
      JOIN public.driver_profiles dp ON dp.id = b.driver_id
     WHERE dp.user_id = p_driver_user
       AND b.customer_id = auth.uid()
       AND b.status IN ('driver_assigned', 'pickup_arrived', 'loading', 'in_transit')
  );
$$;
REVOKE ALL ON FUNCTION public.is_my_active_driver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_my_active_driver(uuid) TO authenticated;

CREATE POLICY driver_locations_customer_select ON public.driver_locations
  FOR SELECT TO authenticated USING (public.is_my_active_driver(driver_id));

-- ── driver money: read your own; written only by functions ──
CREATE POLICY driver_wallets_self_select ON public.driver_wallets
  FOR SELECT TO authenticated USING (driver_id = public.my_driver_id());
CREATE POLICY driver_wallet_transactions_self_select ON public.driver_wallet_transactions
  FOR SELECT TO authenticated USING (driver_id = public.my_driver_id());
CREATE POLICY payout_requests_self_select ON public.payout_requests
  FOR SELECT TO authenticated USING (driver_id = public.my_driver_id());
CREATE POLICY payout_requests_self_insert ON public.payout_requests
  FOR INSERT TO authenticated WITH CHECK (driver_id = public.my_driver_id());

-- ── driver_subscriptions (driver_id is the auth user id) ──
CREATE POLICY driver_subscriptions_self_select ON public.driver_subscriptions
  FOR SELECT TO authenticated USING (driver_id = auth.uid());
CREATE POLICY driver_subscriptions_self_insert ON public.driver_subscriptions
  FOR INSERT TO authenticated WITH CHECK (driver_id = auth.uid());
CREATE POLICY driver_subscriptions_self_update ON public.driver_subscriptions
  FOR UPDATE TO authenticated USING (driver_id = auth.uid()) WITH CHECK (driver_id = auth.uid());

-- ── subscription_plans: a public price list ──
CREATE POLICY subscription_plans_read ON public.subscription_plans
  FOR SELECT TO anon, authenticated USING (true);

-- ── notifications ──
CREATE POLICY notifications_self_select ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY notifications_self_update ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Every other table (booking_updates, drivers, subscription_payments,
-- platform_config, commission_ledger, dispatch_logs and the
-- production-only tables): administrators only (above).


-- ============================================================================
-- 7. DISPATCH: ADMINS, THE SERVICE ROLE AND THE PAYMENT TRIGGER ONLY
-- ============================================================================
--
-- The existing bodies are kept exactly as deployed: they are renamed to
-- *_internal and the public names become guarded wrappers. The payment
-- trigger and the internal stale reclaim call the public names, which
-- pass because only privileged sessions can change payment_status.

DO $$
BEGIN
  IF to_regprocedure('public.dispatch_assign_best_driver_internal(uuid)') IS NULL THEN
    ALTER FUNCTION public.dispatch_assign_best_driver(uuid) RENAME TO dispatch_assign_best_driver_internal;
  END IF;
  IF to_regprocedure('public.reclaim_stale_dispatches_internal(integer)') IS NULL THEN
    ALTER FUNCTION public.reclaim_stale_dispatches(integer) RENAME TO reclaim_stale_dispatches_internal;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.dispatch_assign_best_driver(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_privileged() THEN
    RAISE EXCEPTION 'dispatch: administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN public.dispatch_assign_best_driver_internal(p_booking_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reclaim_stale_dispatches(p_timeout_minutes integer DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_privileged() THEN
    RAISE EXCEPTION 'dispatch: administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN public.reclaim_stale_dispatches_internal(p_timeout_minutes);
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_assign_best_driver_internal(uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reclaim_stale_dispatches_internal(integer)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dispatch_rank_candidates(uuid)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_dispatch_on_payment_captured()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dispatch_assign_best_driver(uuid)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reclaim_stale_dispatches(integer)           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_assign_best_driver(uuid)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reclaim_stale_dispatches(integer)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_assign_best_driver_internal(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reclaim_stale_dispatches_internal(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_rank_candidates(uuid)             TO service_role;


-- ============================================================================
-- 8. WALLET AND ESCROW FUNCTIONS
-- ============================================================================

-- Wallet helpers. Production has its own versions (increment upserts on
-- driver_wallets.driver_id; decrement refuses an insufficient balance);
-- they are kept as they are. These are created only where missing.
DO $$
BEGIN
  IF to_regprocedure('public.increment_driver_wallet(uuid, numeric)') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.increment_driver_wallet(p_driver_id uuid, p_amount numeric)
      RETURNS void LANGUAGE plpgsql SET search_path = public AS $b$
      BEGIN
        UPDATE public.driver_wallets
           SET balance      = coalesce(balance, 0) + p_amount,
               total_earned = coalesce(total_earned, 0) + p_amount
         WHERE driver_id = p_driver_id;
        IF NOT FOUND THEN
          INSERT INTO public.driver_wallets (driver_id, balance, total_earned)
          VALUES (p_driver_id, p_amount, p_amount);
        END IF;
      END $b$ $f$;
  END IF;
  IF to_regprocedure('public.decrement_driver_wallet(uuid, numeric)') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.decrement_driver_wallet(p_driver_id uuid, p_amount numeric)
      RETURNS void LANGUAGE plpgsql SET search_path = public AS $b$
      DECLARE current_balance numeric;
      BEGIN
        SELECT balance INTO current_balance FROM public.driver_wallets WHERE driver_id = p_driver_id;
        IF coalesce(current_balance, 0) < p_amount THEN
          RAISE EXCEPTION 'Insufficient wallet balance';
        END IF;
        UPDATE public.driver_wallets
           SET balance         = balance - p_amount,
               total_withdrawn = coalesce(total_withdrawn, 0) + p_amount
         WHERE driver_id = p_driver_id;
      END $b$ $f$;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.increment_driver_wallet(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decrement_driver_wallet(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_driver_wallet(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrement_driver_wallet(uuid, numeric) TO service_role;

-- ── The one place a released escrow pays the driver ──
--
-- Production's settle_driver_wallet_after_release added driver_earning
-- to the wallet on EVERY update of a released escrow row (repeat
-- credits), used escrow_payments.driver_id (not set by the app) and,
-- when driver_earning was still NULL, set the balance to NULL. And
-- process-payment credited the wallet a second time. Now: the wallet is
-- credited here, once, when the row has a driver_earning and becomes
-- released (or a released row first gets its driver_earning), for the
-- booking's driver. process-payment and admin_release_escrow only set
-- driver_earning + status.
CREATE OR REPLACE FUNCTION public.settle_driver_wallet_after_release()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_driver uuid;
BEGIN
  IF NEW.status = 'released'
     AND NEW.driver_earning IS NOT NULL AND NEW.driver_earning > 0
     AND (OLD.status IS DISTINCT FROM 'released' OR OLD.driver_earning IS NULL)
  THEN
    SELECT driver_id INTO v_driver FROM public.bookings WHERE id = NEW.booking_id;
    IF v_driver IS NULL THEN
      RAISE WARNING 'escrow % released without a booking driver; wallet not credited', NEW.id;
      RETURN NEW;
    END IF;
    UPDATE public.driver_wallets
       SET balance      = coalesce(balance, 0) + NEW.driver_earning,
           total_earned = coalesce(total_earned, 0) + NEW.driver_earning
     WHERE driver_id = v_driver;
    IF NOT FOUND THEN
      INSERT INTO public.driver_wallets (driver_id, balance, total_earned)
      VALUES (v_driver, NEW.driver_earning, NEW.driver_earning);
    END IF;
    INSERT INTO public.driver_wallet_transactions (driver_id, booking_id, type, amount)
    VALUES (v_driver, NEW.booking_id, 'escrow_release', NEW.driver_earning);
    INSERT INTO public.commission_ledger (booking_id, commission_amount)
    VALUES (NEW.booking_id, coalesce(NEW.commission_amount, 0));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_wallet_settlement_after_release ON public.escrow_payments;
CREATE TRIGGER trigger_wallet_settlement_after_release
  AFTER UPDATE ON public.escrow_payments
  FOR EACH ROW EXECUTE FUNCTION public.settle_driver_wallet_after_release();

-- Production's other escrow lifecycle triggers write escrow_payments for
-- whoever changed the booking (customer approving an adjustment, driver
-- finishing over time, both confirming). With RLS on they would silently
-- stop; run them as the owner. Their logic is unchanged.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.release_booking_escrow_after_confirmation()',
    'public.detect_overtime_adjustment()',
    'public.capture_extra_escrow_after_approval()'
  ] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER SET search_path = public', f);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    END IF;
  END LOOP;
END $$;

-- Production's capture_extra_escrow_after_approval updates the row that
-- fired it, so it fired again without end: approving an over-time
-- charge failed with "stack depth limit exceeded". Same logic, stopping
-- once the amount already equals the adjusted amount. Replaced only
-- where it exists.
DO $$
BEGIN
  IF to_regprocedure('public.capture_extra_escrow_after_approval()') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.capture_extra_escrow_after_approval()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $b$
      BEGIN
        IF NEW.adjustment_required = TRUE AND NEW.adjustment_approved = TRUE
           AND NEW.adjusted_amount IS NOT NULL
           AND NEW.amount IS DISTINCT FROM NEW.adjusted_amount THEN
          UPDATE public.escrow_payments
          SET amount = NEW.adjusted_amount
          WHERE id = NEW.id;
        END IF;
        RETURN NEW;
      END $b$ $f$;
  END IF;
END $$;

-- AdminDashboard "Release": pays the driver the booking price (as the
-- dashboard always did, no commission) by marking the escrow released
-- with that driver_earning — the settlement trigger above credits the
-- wallet. One transaction, once, and only after a provider captured
-- the payment.
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

-- AdminDashboard "Refund": the amount comes from calculateRefundAmount()
-- and must lie between 0 and the booking price. Once per booking.
-- Records the refund only; the money is returned in Stripe/Vipps.
CREATE OR REPLACE FUNCTION public.admin_refund_escrow(p_booking_id uuid, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_refund_escrow: administrators only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > coalesce(v_booking.price_estimate, 0) THEN
    RAISE EXCEPTION 'refund must be between 0 and the booking price';
  END IF;
  IF EXISTS (SELECT 1 FROM public.escrow_payments WHERE booking_id = p_booking_id AND status = 'refunded') THEN
    RAISE EXCEPTION 'escrow already refunded';
  END IF;

  IF v_booking.driver_id IS NOT NULL THEN
    PERFORM public.decrement_driver_wallet(v_booking.driver_id, p_amount);
    INSERT INTO public.driver_wallet_transactions (driver_id, booking_id, type, amount)
    VALUES (v_booking.driver_id, p_booking_id, 'refund_reversal', p_amount);
  END IF;
  UPDATE public.escrow_payments SET status = 'refunded', refund_amount = p_amount WHERE booking_id = p_booking_id;
  RETURN jsonb_build_object('refunded', p_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_release_escrow(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_refund_escrow(uuid, numeric)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_release_escrow(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_escrow(uuid, numeric) TO authenticated;

-- change_driver_subscription: production's version (plan looked up by
-- name in subscription_plans, end date from its billing period, audit
-- log) is kept as change_driver_subscription_internal; the public name
-- checks the caller first. It was SECURITY DEFINER and executable by
-- anon, so anyone could put any driver on any plan. Now a driver may
-- move only themselves, and only to free or basic; paid plans come from
-- stripe-webhook; admins may set any plan.
DO $$
BEGIN
  -- Rename production's function once; never this migration's own
  -- wrapper (recognised by the trusted flag it sets) on a re-run.
  IF to_regprocedure('public.change_driver_subscription(uuid, text)') IS NOT NULL
     AND to_regprocedure('public.change_driver_subscription_internal(uuid, text)') IS NULL
     AND (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.change_driver_subscription(uuid, text)'))
         NOT LIKE '%flyttgo.trusted%' THEN
    ALTER FUNCTION public.change_driver_subscription(uuid, text) RENAME TO change_driver_subscription_internal;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.change_driver_subscription(p_driver_id uuid, p_new_plan text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_privileged() THEN
    IF p_driver_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'change_driver_subscription: only your own subscription' USING ERRCODE = '42501';
    END IF;
    IF lower(coalesce(p_new_plan, '')) NOT IN ('free', 'basic') THEN
      RAISE EXCEPTION 'change_driver_subscription: paid plans are activated by payment' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Checked above; the writes below are this function's, not the caller's.
  PERFORM set_config('flyttgo.trusted', 'on', true);
  IF to_regprocedure('public.change_driver_subscription_internal(uuid, text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.change_driver_subscription_internal($1, $2)' USING p_driver_id, p_new_plan;
  ELSE
    -- Schema without the production function (00001 only).
    UPDATE public.driver_subscriptions
       SET subscription_status = 'expired'
     WHERE driver_id = p_driver_id AND subscription_status = 'active';
    INSERT INTO public.driver_subscriptions (driver_id, plan, subscription_status, start_date, end_date)
    VALUES (p_driver_id, p_new_plan, 'active', now(), NULL);
  END IF;
  PERFORM set_config('flyttgo.trusted', 'off', true);
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.change_driver_subscription_internal(uuid, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.change_driver_subscription_internal(uuid, text) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.change_driver_subscription(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_driver_subscription(uuid, text) TO authenticated, service_role;

-- Trigger and guard functions are not API endpoints.
REVOKE ALL ON FUNCTION public.guard_profile_write()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_booking_write()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_escrow_write()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_driver_profile_write()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_driver_application_write()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_driver_document_write()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_driver_subscription_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_payout_request_write()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_driver_wallet_after_release() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
