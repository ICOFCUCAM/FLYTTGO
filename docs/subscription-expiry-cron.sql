-- ============================================================================
-- FlyttGo — auto-downgrade expired driver subscriptions
-- Superseded by supabase/ops/schedules.sql (docs/SCHEDULES.md), which schedules
-- the same job under the same name together with the other jobs. Kept for reference.
-- ============================================================================
--
-- Runs inside Supabase as a pg_cron job. Finds every `driver_subscriptions`
-- row that is currently `active` but whose `end_date` has passed, marks it
-- `expired`, and inserts a fresh `free` + `active` row for the same driver
-- so the driver still has a subscription record — just without paid perks.
--
-- Why server-side, not client-side?
-- ----------------------------------
-- The previous implementation ran inside DriverPortal.enforceSubscriptionExpiry()
-- which only fires when the driver opens their portal. If a driver never
-- visits, their paid plan stays active forever. And the old path also
-- suspended the driver profile (status='suspended') which blocks them
-- from accepting any jobs at all — too aggressive. The spec says
-- "downgrade to free", not "suspend".
--
-- Running this as a pg_cron job means expiration is enforced the same
-- way whether the driver is logged in or not, and can't be bypassed by a
-- tampered client. Supabase has pg_cron available out of the box on the
-- Pro / Team / Enterprise plans — see
--   https://supabase.com/docs/guides/database/extensions/pg_cron
--
-- USAGE
-- -----
-- Run this file ONCE in the Supabase SQL editor. It:
--   1) Makes sure pg_cron is installed (safe to re-run)
--   2) Creates/replaces the auto_downgrade_expired_subscriptions() function
--   3) Schedules (or re-schedules) the hourly cron job
--
-- Re-running the file is idempotent — the CREATE OR REPLACE takes care of
-- the function and the unschedule-then-schedule pattern for the cron.
--
-- ROLLBACK
-- --------
--   SELECT cron.unschedule('auto-downgrade-expired-subscriptions');
--   DROP FUNCTION IF EXISTS public.auto_downgrade_expired_subscriptions();
--
-- ============================================================================

-- 1) pg_cron extension (safe to re-run).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2) The worker function. SECURITY DEFINER so it runs with table-owner
--    rights regardless of who the cron user is under the hood.
CREATE OR REPLACE FUNCTION public.auto_downgrade_expired_subscriptions()
RETURNS TABLE (downgraded_count int) AS $$
BEGIN
  /* One rule for the cron and the driver portal: a plan lapses when its
   * end date plus the grace period has passed (24 h for monthly plans,
   * platform_config subscription_grace_hours_*), and the driver moves to
   * Free (supabase/migrations/00006, expire_lapsed_subscriptions). */
  downgraded_count := public.expire_lapsed_subscriptions(NULL);
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.auto_downgrade_expired_subscriptions() TO service_role;

-- 3) Schedule the cron job. We unschedule first so re-running the file
--    doesn't stack duplicate jobs on top of each other.
DO $$
BEGIN
  PERFORM cron.unschedule('auto-downgrade-expired-subscriptions');
EXCEPTION WHEN OTHERS THEN
  /* ignore if the job doesn't exist yet */ NULL;
END $$;

SELECT cron.schedule(
  'auto-downgrade-expired-subscriptions',
  '0 * * * *',   -- every hour on the hour
  $$ SELECT public.auto_downgrade_expired_subscriptions(); $$
);

-- 4) Smoke test — run the function manually once so you can see the
--    count of subscriptions that were downgraded in this run. Safe to
--    run any time — idempotent.
SELECT * FROM public.auto_downgrade_expired_subscriptions();
