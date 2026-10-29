-- ============================================================================
-- FlyttGo — scheduled jobs (pg_cron + pg_net)
-- ============================================================================
--
-- Not a migration: run once in the Supabase SQL editor of the production
-- project, after the migrations are applied and the functions deployed
-- (docs/SCHEDULES.md, owner's decision 2026-10-29). Safe to re-run; each job
-- is replaced, never doubled. Undo: supabase/ops/schedules_down.sql.
--
--   job                              when (UTC)           what
--   auto-downgrade-expired-subscriptions  every hour :00  expire_lapsed_subscriptions() (00006)
--   flyttgo-invoice-run              daily 05:15          invoice-run (06:15 Oslo winter, 07:15 summer)
--   flyttgo-appointment-reminders    every hour :10       appointment-reminders (00013, 00019)
--   flyttgo-accounting-cancellations daily 00:20          accounting.apply_cancellations() (00014): ledgers past their last day end
--
-- The two functions are called with the service role key, read at each run
-- from Supabase Vault. Nothing secret is in this file. Before running it,
-- store the two secrets once (SQL editor, values from Project settings → API):
--
--   select vault.create_secret('https://<project-ref>.supabase.co', 'flyttgo_project_url');
--   select vault.create_secret('<service role key>',                 'flyttgo_service_role_key');
--
-- If a secret is missing, the job fails (visible in cron.job_run_details)
-- and calls nothing.
-- ============================================================================

-- 1) Extensions. On Supabase they can also be switched on under
--    Database → Extensions; this does nothing when they already are.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  END IF;
  IF to_regnamespace('cron') IS NULL OR to_regnamespace('net') IS NULL THEN
    RAISE EXCEPTION 'schedules: pg_cron and pg_net must be enabled first (Database → Extensions)';
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'schedules: Supabase Vault is not available';
  END IF;
END $$;

-- 2) The caller. In its own schema, which the API does not expose and no
--    client role may use.
CREATE SCHEMA IF NOT EXISTS flyttgo_ops;
REVOKE ALL ON SCHEMA flyttgo_ops FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION flyttgo_ops.call_function(p_function text, p_body jsonb DEFAULT '{}'::jsonb,
                                                     p_timeout_ms integer DEFAULT 60000)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_url text; v_key text;
BEGIN
  IF p_function IS NULL OR p_function !~ '^[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'call_function: not a function name: %', p_function;
  END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'flyttgo_project_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'flyttgo_service_role_key';
  IF coalesce(v_url, '') = '' OR coalesce(v_key, '') = '' THEN
    RAISE EXCEPTION 'call_function: the Vault secrets flyttgo_project_url and flyttgo_service_role_key are needed; % was not called', p_function;
  END IF;
  -- pg_net sends the request after this transaction commits; the answer is
  -- kept for a while in net._http_response under the returned id.
  RETURN net.http_post(
    url                  := rtrim(v_url, '/') || '/functions/v1/' || p_function,
    body                 := coalesce(p_body, '{}'::jsonb),
    headers              := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := p_timeout_ms);
END $$;
REVOKE ALL ON FUNCTION flyttgo_ops.call_function(text, jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;

-- 3) The jobs. Unschedule first so a re-run replaces them.
DO $$
DECLARE j text;
BEGIN
  FOREACH j IN ARRAY ARRAY['auto-downgrade-expired-subscriptions', 'flyttgo-invoice-run', 'flyttgo-appointment-reminders',
                           'flyttgo-accounting-cancellations'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN PERFORM cron.unschedule(j); END IF;
  END LOOP;
END $$;

-- Before the invoice run, so a cancelled ledger is ended before billing.
SELECT cron.schedule('flyttgo-accounting-cancellations', '20 0 * * *',
  $$ SELECT accounting.apply_cancellations() $$);
SELECT cron.schedule('auto-downgrade-expired-subscriptions', '0 * * * *',
  $$ SELECT public.expire_lapsed_subscriptions(NULL) $$);
-- invoice-run issues, emails and reminds; it can take a while.
SELECT cron.schedule('flyttgo-invoice-run', '15 5 * * *',
  $$ SELECT flyttgo_ops.call_function('invoice-run', '{}'::jsonb, 150000) $$);
SELECT cron.schedule('flyttgo-appointment-reminders', '10 * * * *',
  $$ SELECT flyttgo_ops.call_function('appointment-reminders', '{}'::jsonb, 60000) $$);
