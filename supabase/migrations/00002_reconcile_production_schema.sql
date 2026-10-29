-- ============================================================================
-- FlyttGo — reconcile the schema with production
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Production ("FlyttGo Norway",
-- qzclatvpzicwhewzdiwf) was built by hand and differs from
-- 00001_complete_schema.sql; supabase/schema/production-2026-10-29.sql is
-- its verified schema replica. This migration makes both shapes agree
-- on the points the application depends on, without deleting any table,
-- column or row. Findings and decisions: docs/PRODUCTION_SCHEMA.md.
--
-- Driver identity (one rule, applied everywhere):
--   * the auth user id for what a person owns before or apart from being
--     an approved driver: applications, documents (and their storage
--     folder), subscriptions, live location, metrics, verification,
--     vehicles — production's own triggers and functions already write
--     the user id into these;
--   * driver_profiles.id for the work of an approved driver: bookings,
--     wallets, wallet transactions, payout requests, dispatch logs.
-- Production's foreign keys pointed several of these at drivers(id) or
-- driver_profiles(id), so the writes failed (approving a driver, every
-- subscription change, every location update). Each key is re-pointed;
-- rows that predate it and don't satisfy it are left in place and the
-- key is left NOT VALID (enforced for new rows) with a NOTICE.
--
-- Subscriptions: plan_id → subscription_plans is the source of truth.
-- The application refers to plans by slug (lower-case name, spaces as
-- underscores: 'Pro Mini' → 'pro_mini'); public.plan_slug() is that rule.
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Plan slugs ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plan_slug(p_name text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT lower(regexp_replace(trim(p_name), '\s+', '_', 'g')); $$;

GRANT EXECUTE ON FUNCTION public.plan_slug(text) TO anon, authenticated, service_role;

-- Every slug must name exactly one plan.
CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_slug_key
  ON public.subscription_plans (public.plan_slug(name));

-- Production's apply_pending_plan_changes() set a `plan` column that does
-- not exist; it now resolves pending_plan (a slug or a name) to plan_id.
DO $$
BEGIN
  IF to_regprocedure('public.apply_pending_plan_changes()') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.apply_pending_plan_changes()
      RETURNS void LANGUAGE plpgsql SET search_path = public AS $b$
      BEGIN
        UPDATE public.driver_subscriptions ds
           SET plan_id = sp.id, pending_plan = NULL
          FROM public.subscription_plans sp
         WHERE ds.pending_plan IS NOT NULL AND ds.end_date < now()
           AND public.plan_slug(sp.name) = public.plan_slug(ds.pending_plan);
      END $b$ $f$;
  END IF;
END $$;


-- ── 2. Columns the application writes ──────────────────────────────────────
-- AdminDashboard records who reviewed an application, when, and why it
-- was rejected; production lacked the columns, so every review failed.
ALTER TABLE public.driver_applications
  ADD COLUMN IF NOT EXISTS reviewed_by      uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 'expired' is what the expiry check in DriverPortal and the
-- auto-downgrade job write; production's CHECK refused it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_subscriptions_subscription_status_check'
              AND conrelid = 'public.driver_subscriptions'::regclass) THEN
    ALTER TABLE public.driver_subscriptions DROP CONSTRAINT driver_subscriptions_subscription_status_check;
    ALTER TABLE public.driver_subscriptions ADD CONSTRAINT driver_subscriptions_subscription_status_check
      CHECK (subscription_status = ANY (ARRAY['active', 'cancelled', 'past_due', 'trialing', 'expired']));
  END IF;
END $$;


-- Driver onboarding uploads 'identity_document' (DriverOnboarding.tsx);
-- production's CHECK allowed 'id_passport' instead, so every application
-- with an ID document failed. Both are accepted.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_documents_document_type_check'
              AND conrelid = 'public.driver_documents'::regclass) THEN
    ALTER TABLE public.driver_documents DROP CONSTRAINT driver_documents_document_type_check;
    ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_document_type_check
      CHECK (document_type = ANY (ARRAY['driver_license', 'vehicle_registration', 'insurance',
                                        'id_passport', 'identity_document', 'profile_photo']));
  END IF;
END $$;


-- ── 3. Driver identity: foreign keys ───────────────────────────────────────
-- repoint_fk(table, column, constraint, target, on_delete): replace the
-- column's foreign key (whatever it pointed at) with one to target, then
-- validate it if the existing rows allow.
CREATE OR REPLACE FUNCTION pg_temp.repoint_fk(
  p_table text, p_column text, p_name text, p_target text, p_on_delete text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
     WHERE con.conrelid = format('public.%I', p_table)::regclass
       AND con.contype = 'f' AND a.attname = p_column
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', p_table, c.conname);
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s ON DELETE %s NOT VALID',
                 p_table, p_name, p_column, p_target, p_on_delete);
  BEGIN
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', p_table, p_name);
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '%.% → %: existing rows do not satisfy the key; left NOT VALID (enforced for new rows)',
      p_table, p_column, p_target;
  END;
END $$;

DO $$
BEGIN
  PERFORM pg_temp.repoint_fk('driver_subscriptions', 'driver_id', 'driver_subscriptions_driver_id_fkey', 'auth.users(id)', 'CASCADE');
  PERFORM pg_temp.repoint_fk('driver_locations',     'driver_id', 'driver_locations_driver_id_fkey',     'auth.users(id)', 'CASCADE');
  PERFORM pg_temp.repoint_fk('driver_documents',     'driver_id', 'driver_documents_driver_id_fkey',     'auth.users(id)', 'CASCADE');
  PERFORM pg_temp.repoint_fk('dispatch_logs',        'driver_id', 'dispatch_logs_driver_id_fkey',        'public.driver_profiles(id)', 'SET NULL');
  PERFORM pg_temp.repoint_fk('bookings',             'driver_id', 'bookings_driver_id_fkey',             'public.driver_profiles(id)', 'SET NULL');
END $$;

-- Production-only tables filled by its driver_profiles triggers with the
-- user id (this is what made approving a driver fail).
DO $$
BEGIN
  IF to_regclass('public.driver_metrics') IS NOT NULL THEN
    PERFORM pg_temp.repoint_fk('driver_metrics', 'driver_id', 'driver_metrics_driver_id_fkey', 'auth.users(id)', 'CASCADE');
  END IF;
  IF to_regclass('public.vehicles') IS NOT NULL THEN
    PERFORM pg_temp.repoint_fk('vehicles', 'driver_id', 'vehicles_driver_id_fkey', 'auth.users(id)', 'CASCADE');
  END IF;
  IF to_regclass('public.driver_verification') IS NOT NULL THEN
    PERFORM pg_temp.repoint_fk('driver_verification', 'driver_id', 'driver_verification_driver_id_fkey', 'auth.users(id)', 'CASCADE');
  END IF;
END $$;


-- ── 4. Wallets belong to the driver profile ────────────────────────────────
-- Production's create_driver_wallet() keyed new wallets by the user id;
-- the app, process-payment and the settlement trigger read them by
-- driver_profiles.id. Same function, profile id.
DO $$
BEGIN
  IF to_regprocedure('public.create_driver_wallet()') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.create_driver_wallet()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $b$
      BEGIN
        INSERT INTO public.driver_wallets (driver_id, balance, total_earned, pending_payout)
        VALUES (NEW.id, 0, 0, 0)
        ON CONFLICT (driver_id) DO NOTHING;
        RETURN NEW;
      END $b$ $f$;
  END IF;
END $$;

-- Wallets already keyed by a user id move to that user's driver profile,
-- unless the profile already has one (then both are kept and reported).
DO $$
DECLARE n integer;
BEGIN
  UPDATE public.driver_wallets w
     SET driver_id = dp.id
    FROM public.driver_profiles dp
   WHERE w.driver_id = dp.user_id
     AND NOT EXISTS (SELECT 1 FROM public.driver_wallets w2 WHERE w2.driver_id = dp.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'driver_wallets: % wallet(s) moved from user id to driver profile id', n; END IF;
  IF EXISTS (SELECT 1 FROM public.driver_wallets w JOIN public.driver_profiles dp ON dp.user_id = w.driver_id) THEN
    RAISE NOTICE 'driver_wallets: some drivers have a wallet under both ids; reconcile by hand';
  END IF;
END $$;

-- ============================================================================
-- DONE
-- ============================================================================
