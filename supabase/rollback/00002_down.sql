-- ============================================================================
-- Roll back 00002_reconcile_production_schema.sql (production only)
-- ============================================================================
-- Puts back production's foreign keys, CHECK constraints and function
-- bodies. Run after 00003_down.sql (which drops the functions that use
-- plan_slug).
--
-- Not reversed: wallets that 00002 moved from a user id to the driver's
-- profile id (it reports them as NOTICEs when it runs); move them back by
-- hand if needed.
--
-- A foreign key whose rows no longer satisfy production's target (rows
-- written while 00002 was in force, keyed by the user id) is restored NOT
-- VALID with a NOTICE, rather than failing the rollback.
--
-- DATA LOSS: driver_applications.reviewed_by, reviewed_at and
-- rejection_reason are dropped.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.restore_fk(
  p_table text, p_column text, p_name text, p_target text, p_on_delete text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
     WHERE con.conrelid = format('public.%I', p_table)::regclass AND con.contype = 'f' AND a.attname = p_column
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', p_table, c.conname);
  END LOOP;
  IF p_target IS NULL THEN RETURN; END IF;
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s%s NOT VALID',
                 p_table, p_name, p_column, p_target, coalesce(' ON DELETE ' || p_on_delete, ''));
  BEGIN
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', p_table, p_name);
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '%.% → %: rows written since 00002 do not satisfy it; restored NOT VALID', p_table, p_column, p_target;
  END;
END $$;

DO $$
BEGIN
  PERFORM pg_temp.restore_fk('driver_subscriptions', 'driver_id', 'driver_subscriptions_driver_id_fkey', 'drivers(id)', 'CASCADE');
  PERFORM pg_temp.restore_fk('driver_locations',     'driver_id', 'driver_locations_driver_id_fkey',     'driver_profiles(id)', 'CASCADE');
  PERFORM pg_temp.restore_fk('driver_documents',     'driver_id', 'driver_documents_driver_id_fkey',     'drivers(id)', 'CASCADE');
  PERFORM pg_temp.restore_fk('dispatch_logs',        'driver_id', 'dispatch_logs_driver_id_fkey',        'drivers(id)', NULL);
  PERFORM pg_temp.restore_fk('bookings',             'driver_id', 'bookings_driver_id_fkey',             NULL, NULL);
  PERFORM pg_temp.restore_fk('driver_metrics',       'driver_id', 'driver_metrics_driver_id_fkey',       'drivers(id)', NULL);
  PERFORM pg_temp.restore_fk('vehicles',             'driver_id', 'vehicles_driver_id_fkey',             'drivers(id)', 'CASCADE');
  PERFORM pg_temp.restore_fk('driver_verification',  'driver_id', 'driver_verification_driver_id_fkey',  'drivers(id)', NULL);
END $$;

ALTER TABLE public.driver_documents DROP CONSTRAINT IF EXISTS driver_documents_document_type_check;
ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_document_type_check
  CHECK ((document_type = ANY (ARRAY['driver_license'::text, 'vehicle_registration'::text, 'insurance'::text, 'id_passport'::text, 'profile_photo'::text]))) NOT VALID;
ALTER TABLE public.driver_subscriptions DROP CONSTRAINT IF EXISTS driver_subscriptions_subscription_status_check;
ALTER TABLE public.driver_subscriptions ADD CONSTRAINT driver_subscriptions_subscription_status_check
  CHECK ((subscription_status = ANY (ARRAY['active'::text, 'cancelled'::text, 'past_due'::text, 'trialing'::text]))) NOT VALID;
-- Validate when the rows allow (identity_document / expired rows written
-- since 00002 keep the constraint NOT VALID).
DO $$
BEGIN
  BEGIN ALTER TABLE public.driver_documents VALIDATE CONSTRAINT driver_documents_document_type_check;
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'driver_documents has identity_document rows; CHECK left NOT VALID'; END;
  BEGIN ALTER TABLE public.driver_subscriptions VALIDATE CONSTRAINT driver_subscriptions_subscription_status_check;
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'driver_subscriptions has expired rows; CHECK left NOT VALID'; END;
END $$;

ALTER TABLE public.driver_applications
  DROP COLUMN IF EXISTS reviewed_by,
  DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS rejection_reason;

CREATE OR REPLACE FUNCTION public.create_driver_wallet()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.driver_wallets (driver_id, balance, total_earned, pending_payout)
  VALUES (NEW.user_id, 0, 0, 0);
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.create_driver_wallet() RESET search_path;

CREATE OR REPLACE FUNCTION public.apply_pending_plan_changes()
 RETURNS void LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.driver_subscriptions
  SET plan = pending_plan, pending_plan = NULL
  WHERE pending_plan IS NOT NULL AND end_date < NOW();
END;
$function$;
ALTER FUNCTION public.apply_pending_plan_changes() RESET search_path;

DROP INDEX IF EXISTS public.subscription_plans_slug_key;
DROP FUNCTION IF EXISTS public.plan_slug(text);
