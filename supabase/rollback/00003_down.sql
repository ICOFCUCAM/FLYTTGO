-- ============================================================================
-- Roll back 00003_p0_security_hardening.sql (production only)
-- ============================================================================
-- Restores production as it was on 2026-10-29 (with the emergency fix:
-- admin_accounts RLS + self-select, change_driver_subscription not
-- executable by anon). Function bodies are production's own, from the
-- verified replica supabase/schema/production-2026-10-29.sql.
--
-- WARNING: this re-opens every hole 00003 closed (tables without RLS,
-- self-service payment status, dispatch for anyone). Use it only to get
-- back to a known state, and re-apply a fixed 00003 promptly.
--
-- DATA LOSS: bookings.manual_refund_percent and payment_review_reason,
-- escrow_payments.adjustment_reason and final_price are dropped.
-- ============================================================================

-- ── Policies and RLS: back to production's six tables and their policies ──
DO $$
DECLARE t text; p record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    IF t IN ('admin_accounts', 'bookings', 'driver_applications', 'drivers', 'notifications', 'profiles') THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    ELSE
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

CREATE POLICY admin_accounts_self_select ON public.admin_accounts AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY bookings_admin_all ON public.bookings AS PERMISSIVE FOR ALL TO public USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY bookings_customer_insert ON public.bookings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((customer_id = auth.uid()));
CREATE POLICY bookings_customer_select ON public.bookings AS PERMISSIVE FOR SELECT TO authenticated USING ((customer_id = auth.uid()));
CREATE POLICY bookings_customer_update ON public.bookings AS PERMISSIVE FOR UPDATE TO authenticated USING ((customer_id = auth.uid())) WITH CHECK ((customer_id = auth.uid()));
CREATE POLICY driver_applications_admin_all ON public.driver_applications AS PERMISSIVE FOR ALL TO public USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY driver_apps_insert_own ON public.driver_applications AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY driver_apps_select_own ON public.driver_applications AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY driver_apps_update_own ON public.driver_applications AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY drivers_insert_own ON public.drivers AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY drivers_select_own ON public.drivers AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY drivers_update_own ON public.drivers AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY notifications_admin_all ON public.notifications AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY notifications_self_select ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY notifications_self_update ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY profiles_admin_all ON public.profiles AS PERMISSIVE FOR ALL TO public USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY profiles_self_select ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));

-- ── Guards ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS guard_profile_write             ON public.profiles;
DROP TRIGGER IF EXISTS guard_booking_write             ON public.bookings;
DROP TRIGGER IF EXISTS guard_escrow_write              ON public.escrow_payments;
DROP TRIGGER IF EXISTS guard_driver_profile_write      ON public.driver_profiles;
DROP TRIGGER IF EXISTS guard_driver_application_write  ON public.driver_applications;
DROP TRIGGER IF EXISTS guard_driver_document_write     ON public.driver_documents;
DROP TRIGGER IF EXISTS guard_driver_subscription_write ON public.driver_subscriptions;
DROP TRIGGER IF EXISTS guard_payout_request_write      ON public.payout_requests;
DROP FUNCTION IF EXISTS public.guard_profile_write();
DROP FUNCTION IF EXISTS public.guard_booking_write();
DROP FUNCTION IF EXISTS public.guard_escrow_write();
DROP FUNCTION IF EXISTS public.guard_driver_profile_write();
DROP FUNCTION IF EXISTS public.guard_driver_application_write();
DROP FUNCTION IF EXISTS public.guard_driver_document_write();
DROP FUNCTION IF EXISTS public.guard_driver_subscription_write();
DROP FUNCTION IF EXISTS public.guard_payout_request_write();

-- ── Functions 00003 added ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.driver_job_pool();
DROP FUNCTION IF EXISTS public.claim_job(uuid);
DROP FUNCTION IF EXISTS public.booking_driver_user(uuid);
DROP FUNCTION IF EXISTS public.is_my_active_driver(uuid);
DROP FUNCTION IF EXISTS public.admin_release_escrow(uuid);

-- ── Dispatch and change_driver_subscription: wrappers out, originals back ──
DO $$
BEGIN
  IF to_regprocedure('public.dispatch_assign_best_driver_internal(uuid)') IS NOT NULL THEN
    DROP FUNCTION IF EXISTS public.dispatch_assign_best_driver(uuid);
    ALTER FUNCTION public.dispatch_assign_best_driver_internal(uuid) RENAME TO dispatch_assign_best_driver;
  END IF;
  IF to_regprocedure('public.reclaim_stale_dispatches_internal(integer)') IS NOT NULL THEN
    DROP FUNCTION IF EXISTS public.reclaim_stale_dispatches(integer);
    ALTER FUNCTION public.reclaim_stale_dispatches_internal(integer) RENAME TO reclaim_stale_dispatches;
  END IF;
  IF to_regprocedure('public.change_driver_subscription_internal(uuid, text)') IS NOT NULL THEN
    DROP FUNCTION IF EXISTS public.change_driver_subscription(uuid, text);
    ALTER FUNCTION public.change_driver_subscription_internal(uuid, text) RENAME TO change_driver_subscription;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.changed_columns(jsonb, jsonb, text[]);
DROP FUNCTION IF EXISTS public.my_driver_id();
DROP FUNCTION IF EXISTS public.is_approved_driver();
DROP FUNCTION IF EXISTS public.is_privileged();

-- ── Production's own bodies, as they were ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_driver_wallet_after_release()
 RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
AS $function$
BEGIN
  IF NEW.status = 'released' THEN
    UPDATE public.driver_wallets
    SET balance = balance + NEW.driver_earning
    WHERE driver_id = NEW.driver_id;

    INSERT INTO public.commission_ledger (booking_id, commission_amount, created_at)
    VALUES (NEW.booking_id, NEW.commission_amount, NOW());
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.settle_driver_wallet_after_release() RESET search_path;
DROP TRIGGER IF EXISTS trigger_wallet_settlement_after_release ON public.escrow_payments;
CREATE TRIGGER trigger_wallet_settlement_after_release AFTER UPDATE OF status ON public.escrow_payments
  FOR EACH ROW EXECUTE FUNCTION settle_driver_wallet_after_release();

CREATE OR REPLACE FUNCTION public.capture_extra_escrow_after_approval()
 RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
AS $function$
BEGIN
  IF NEW.adjustment_required = TRUE AND NEW.adjustment_approved = TRUE THEN
    UPDATE public.escrow_payments
    SET amount = NEW.adjusted_amount
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.capture_extra_escrow_after_approval() RESET search_path;

ALTER FUNCTION public.release_booking_escrow_after_confirmation() SECURITY INVOKER;
ALTER FUNCTION public.release_booking_escrow_after_confirmation() RESET search_path;
ALTER FUNCTION public.detect_overtime_adjustment() SECURITY INVOKER;
ALTER FUNCTION public.detect_overtime_adjustment() RESET search_path;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.id) THEN
    INSERT INTO public.profiles (id, user_id, email, first_name, last_name, role, referral_code)
    VALUES (
      gen_random_uuid(), NEW.id, NEW.email,
      NULLIF(meta ->> 'first_name', ''), NULLIF(meta ->> 'last_name',  ''),
      COALESCE(NULLIF(meta ->> 'role', ''), 'customer'),
      'FLYTTGO-' || UPPER(SUBSTRING(NEW.id::text FROM 1 FOR 8))
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Columns 00003 added ───────────────────────────────────────────────────
ALTER TABLE public.bookings
  DROP COLUMN IF EXISTS manual_refund_percent,
  DROP COLUMN IF EXISTS payment_review_reason;
ALTER TABLE public.escrow_payments
  DROP COLUMN IF EXISTS adjustment_reason,
  DROP COLUMN IF EXISTS final_price;

-- ── Realtime ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public' AND tablename = 'driver_locations') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.driver_locations;
  END IF;
END $$;

-- ── Function privileges as in production ──────────────────────────────────
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.change_driver_subscription(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_driver_subscription(uuid, text) TO authenticated, service_role;
