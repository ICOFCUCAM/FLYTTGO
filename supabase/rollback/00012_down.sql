-- ============================================================================
-- Roll back 00012_jobs.sql
-- ============================================================================
-- Run first (before 00011_down.sql). Tested by run.sh: afterwards the
-- schema is exactly as before 00012.
--
-- DATA LOSS — READ FIRST. Drops the companies' services, jobs, job reports
-- and job logs. Jobs are the companies' records of work done for their
-- customers: export them to each company first. Invoices made from jobs
-- stay (00011).
-- ============================================================================

DROP FUNCTION IF EXISTS public.cancel_job(uuid, text);
DROP FUNCTION IF EXISTS public.invoice_job(uuid);
DROP FUNCTION IF EXISTS public.complete_job(uuid, text);
DROP FUNCTION IF EXISTS public.remove_job_item(uuid);
DROP FUNCTION IF EXISTS public.add_job_item(uuid, text, text, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.start_job(uuid);
DROP FUNCTION IF EXISTS public.schedule_job(uuid, timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.respond_to_quote(uuid, boolean);
DROP FUNCTION IF EXISTS public.quote_job(uuid, numeric, text, integer);
DROP FUNCTION IF EXISTS public.create_job(uuid, uuid, jsonb, jsonb, text, text);
DROP FUNCTION IF EXISTS public.request_job(uuid, uuid, jsonb, jsonb, text, text);
DROP FUNCTION IF EXISTS public.job_insert(uuid, uuid, uuid, jsonb, jsonb, text, text);
DROP FUNCTION IF EXISTS public.save_job_service(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.job_for(uuid, text[]);
DROP FUNCTION IF EXISTS public.job_event(uuid, text, jsonb);
DROP TABLE IF EXISTS public.job_events;
DROP TABLE IF EXISTS public.job_items;
DROP TABLE IF EXISTS public.jobs;
DROP FUNCTION IF EXISTS public.can_read_job(uuid);
DROP TABLE IF EXISTS public.job_services;
DO $$
BEGIN
  IF to_regprocedure('public.org_has_module(uuid, text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.org_has_module(uuid, text) FROM anon;
  END IF;
END $$;

-- ============================================================================
-- DONE
-- ============================================================================
