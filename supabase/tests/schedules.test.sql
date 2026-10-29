-- ============================================================================
-- supabase/ops/schedules.sql on a plain PostgreSQL: pg_cron, pg_net and
-- Vault are replaced by small stand-ins with the same names and arguments
-- (cron.job, cron.schedule, cron.unschedule, net.http_post,
-- vault.decrypted_secrets). Run by run.sh in its own database.
-- ============================================================================
\set ON_ERROR_STOP 1

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'could not find valid entry for job ''%''', job_name; END IF;
  RETURN true;
END $$;
CREATE SCHEMA net;
CREATE TABLE net.sent (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, timeout_milliseconds integer);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}',
                              timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO net.sent (url, body, headers, timeout_milliseconds) VALUES (url, body, headers, timeout_milliseconds) RETURNING id $$;
CREATE SCHEMA vault;
CREATE TABLE vault.secrets_stub (name text PRIMARY KEY, decrypted_secret text);
CREATE VIEW vault.decrypted_secrets AS SELECT name, decrypted_secret FROM vault.secrets_stub;

-- An old copy of docs/subscription-expiry-cron.sql's job, to be replaced.
SELECT cron.schedule('auto-downgrade-expired-subscriptions', '0 * * * *', 'SELECT 1');

\i supabase/ops/schedules.sql
\i supabase/ops/schedules.sql

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM cron.job;
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL: % jobs after two runs, expected 4', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flyttgo-accounting-cancellations' AND schedule = '20 0 * * *'
                 AND command LIKE '%accounting.apply_cancellations()%') THEN RAISE EXCEPTION 'FAIL: accounting cancellations job'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-downgrade-expired-subscriptions' AND schedule = '0 * * * *'
                 AND command LIKE '%expire_lapsed_subscriptions(NULL)%') THEN RAISE EXCEPTION 'FAIL: expiry job'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flyttgo-invoice-run' AND schedule = '15 5 * * *') THEN RAISE EXCEPTION 'FAIL: invoice job'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flyttgo-appointment-reminders' AND schedule = '10 * * * *') THEN RAISE EXCEPTION 'FAIL: reminder job'; END IF;
  RAISE NOTICE 'ok: four jobs, a re-run replaces them and the old expiry job';
END $$;

-- Without the Vault secrets a job fails and sends nothing.
DO $$
BEGIN
  BEGIN
    PERFORM flyttgo_ops.call_function('invoice-run');
    RAISE EXCEPTION 'FAIL: called without secrets';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM net.sent) THEN RAISE EXCEPTION 'FAIL: a request went out without secrets'; END IF;
  RAISE NOTICE 'ok: missing secrets fail the job, nothing is sent';
END $$;

INSERT INTO vault.secrets_stub VALUES ('flyttgo_project_url', 'https://example.supabase.co/'), ('flyttgo_service_role_key', 'test-key');

-- Each job's command runs as written.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT command FROM cron.job WHERE jobname NOT IN ('auto-downgrade-expired-subscriptions', 'flyttgo-accounting-cancellations') ORDER BY jobname LOOP EXECUTE c; END LOOP;
  IF NOT EXISTS (SELECT 1 FROM net.sent WHERE url = 'https://example.supabase.co/functions/v1/invoice-run'
                 AND headers ->> 'Authorization' = 'Bearer test-key' AND timeout_milliseconds = 150000) THEN RAISE EXCEPTION 'FAIL: invoice-run request'; END IF;
  IF NOT EXISTS (SELECT 1 FROM net.sent WHERE url = 'https://example.supabase.co/functions/v1/appointment-reminders') THEN RAISE EXCEPTION 'FAIL: reminder request'; END IF;
  EXECUTE (SELECT command FROM cron.job WHERE jobname = 'auto-downgrade-expired-subscriptions');
  RAISE NOTICE 'ok: each job runs; the functions get the key from Vault';
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM flyttgo_ops.call_function('../rest/v1/bookings');
    RAISE EXCEPTION 'FAIL: path accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok: only a function name is accepted';
END $$;

-- No client role may call it.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(r, 'flyttgo_ops.call_function(text, jsonb, integer)', 'EXECUTE')
       OR has_schema_privilege(r, 'flyttgo_ops', 'USAGE') THEN RAISE EXCEPTION 'FAIL: % can use the caller', r; END IF;
  END LOOP;
  RAISE NOTICE 'ok: anon, authenticated and service_role cannot use the caller';
END $$;

\i supabase/ops/schedules_down.sql
\i supabase/ops/schedules_down.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job) THEN RAISE EXCEPTION 'FAIL: jobs left after undo'; END IF;
  IF to_regnamespace('flyttgo_ops') IS NOT NULL THEN RAISE EXCEPTION 'FAIL: flyttgo_ops left after undo'; END IF;
  RAISE NOTICE 'ok: undo removes the jobs and the caller, and can be re-run';
END $$;

SELECT 'schedules: all passed' AS passed;
