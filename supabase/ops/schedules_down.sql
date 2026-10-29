-- ============================================================================
-- Undo supabase/ops/schedules.sql
-- ============================================================================
-- Stops the four jobs and removes the caller. Leaves pg_cron, pg_net and
-- the Vault secrets as they are (delete the secrets in Project settings →
-- Vault if they are no longer needed). Nothing else changes: invoices,
-- reminders already sent and subscriptions stay as they are.
-- ============================================================================

DO $$
DECLARE j text;
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    FOREACH j IN ARRAY ARRAY['auto-downgrade-expired-subscriptions', 'flyttgo-invoice-run', 'flyttgo-appointment-reminders',
                             'flyttgo-accounting-cancellations'] LOOP
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN PERFORM cron.unschedule(j); END IF;
    END LOOP;
  END IF;
END $$;

DROP FUNCTION IF EXISTS flyttgo_ops.call_function(text, jsonb, integer);
DROP SCHEMA IF EXISTS flyttgo_ops;
