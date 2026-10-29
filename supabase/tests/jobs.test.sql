-- ============================================================================
-- Jobs (supabase/migrations/00012_jobs.sql)
-- Acme is a plumber on the Jobs plan (tests.sp_acme); cust1 owns it, drv1
-- is its booker, cust2 its customer; e…01 (applicant) becomes its worker.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''
\set worker  '''e0000000-0000-0000-0000-000000000001'''

-- Acme on Jobs, with invoice settings, a worker and two services (fixed;
-- quote) and an electrical service. Claims kept.
CREATE OR REPLACE FUNCTION tests.jobs_acme() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid; v_claims text := current_setting('request.jwt.claims', true);
BEGIN
  v_org := tests.sp_acme('field_service', 'jobs');
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (v_org, 'e0000000-0000-0000-0000-000000000001', 'staff');
  PERFORM tests.login('c0000000-0000-0000-0000-000000000001');
  PERFORM public.set_invoice_settings(v_org, '{"legal_name":"Acme Rør AS","address":"Verkstedveien 4","postcode_city":"0277 Oslo","bank_account":"15061234567"}');
  PERFORM public.save_job_service(v_org, NULL, '{"name":"Replace a tap","price_type":"fixed","price":1875,"call_out_fee":562.5,"sort":1}');
  PERFORM public.save_job_service(v_org, NULL, '{"name":"Bathroom renovation","price_type":"quote","sort":2}');
  PERFORM public.save_job_service(v_org, NULL, '{"name":"New socket","price_type":"hourly","price":1062.5,"requires_authorisation":"electrical","sort":3}');
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN v_org;
END $$;
CREATE OR REPLACE FUNCTION tests.svc(p_name text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.job_services WHERE name = p_name;
$$;
CREATE OR REPLACE FUNCTION tests.place() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"address":"Bjerkelia 12","postcode":"1350","city":"Lommedalen"}'::jsonb;
$$;
CREATE OR REPLACE FUNCTION tests.contact() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"name":"Kari Nordmann","phone":"+47 900 00 000","email":"cust2@test"}'::jsonb;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── Services are public; regulated work needs the authorisation ───────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.jobs_acme() AS id;
GRANT SELECT ON o TO anon;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT count(*) FROM public.job_services WHERE organization_id = (SELECT id FROM o)) = 3, 'visitors see the company''s services');
SELECT tests.throws($$SELECT public.request_job((SELECT id FROM o), tests.svc('Replace a tap'), tests.contact(), tests.place(), 'drips', NULL)$$, '42501',
  'visitors sign in to ask for a job');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.request_job((SELECT id FROM o), tests.svc('New socket'), tests.contact(), tests.place(), NULL, NULL)$$, '55000',
  'electrical work is refused while FlyttGo has no electrical authorisation on record');
SELECT tests.login(:admin);
SELECT public.record_organization_authorisation((SELECT id FROM o), 'electrical', 'DSB elvirksomhetsregisteret', '974760673', NULL, '{"checked":"register"}');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT status FROM public.request_job((SELECT id FROM o), tests.svc('New socket'), tests.contact(), tests.place(), NULL, NULL)) = 'accepted',
  'with it on record, the customer books it at the hourly price');
SELECT tests.throws($$SELECT public.request_job((SELECT id FROM o), tests.svc('Replace a tap'), tests.contact(), '{"address":""}', NULL, NULL)$$, '22023',
  'an address is required');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.save_job_service((SELECT id FROM o), NULL, '{"name":"X","price_type":"fixed"}')$$, '23514',
  'a fixed-price service needs its price');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.save_job_service((SELECT id FROM o), NULL, '{"name":"X","price_type":"quote"}')$$, '42501',
  'a booker cannot change the services');
ROLLBACK;

-- ── Fixed price: request → schedule → work → complete → invoice ───────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.jobs_acme() AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE j ON COMMIT DROP AS SELECT * FROM public.request_job((SELECT id FROM o), tests.svc('Replace a tap'), tests.contact(), tests.place(), 'kitchen tap drips', 'mornings');
GRANT SELECT ON o, j TO service_role;
SELECT tests.ok((SELECT number FROM j) = 1 AND (SELECT status FROM j) = 'accepted' AND (SELECT agreed_price FROM j) = 1875,
  'a fixed-price job is agreed by booking, numbered per company');
SELECT tests.throws($$SELECT public.schedule_job((SELECT id FROM j), now() + interval '2 days', now() + interval '2 days 2 hours', NULL)$$, '42501',
  'the customer cannot schedule it');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.schedule_job((SELECT id FROM j), now() + interval '2 days', now() + interval '2 days 2 hours', 'c0000000-0000-0000-0000-000000000002')$$, '22023',
  'only the company''s workers get jobs');
SELECT tests.ok((SELECT status FROM public.schedule_job((SELECT id FROM j), now() + interval '2 days', now() + interval '2 days 2 hours',
                   'e0000000-0000-0000-0000-000000000001')) = 'scheduled', 'the booker schedules it and gives it to a worker');
SELECT tests.login(:worker);
SELECT tests.ok((SELECT count(*) FROM public.jobs) = 1, 'the worker sees the job given to them');
SELECT tests.ok((SELECT status FROM public.start_job((SELECT id FROM j))) = 'in_progress', 'and starts it');
SELECT public.add_job_item((SELECT id FROM j), 'material', 'Mixer tap', 1, 1490, 25);
SELECT tests.ok((SELECT status FROM public.complete_job((SELECT id FROM j), 'Replaced tap and stop valve')) = 'completed', 'completes it with the report');
SELECT tests.ok((SELECT count(*) FROM public.job_items WHERE job_id = (SELECT id FROM j)) = 3,
  'the agreed price and the call-out fee are added to the materials');
SELECT tests.throws($$SELECT public.invoice_job((SELECT id FROM j))$$, '42501', 'a worker does not invoice');
SELECT tests.login(:cust1);
CREATE TEMP TABLE inv ON COMMIT DROP AS SELECT * FROM public.invoice_job((SELECT id FROM j));
SELECT tests.ok((SELECT total FROM inv) = 1875 + 1862.5 + 562.5 AND (SELECT seller ->> 'name' FROM inv) = 'Acme Rør AS'
                AND (SELECT customer_user_id FROM inv) = :cust2 AND (SELECT buyer ->> 'address' FROM inv) = 'Bjerkelia 12',
  'the owner invoices it in the company''s name: agreed price, materials and call-out, to the customer at the job''s address');
SELECT tests.ok((SELECT status FROM public.jobs WHERE id = (SELECT id FROM j)) = 'invoiced', 'the job is invoiced');
SELECT tests.throws($$SELECT public.add_job_item((SELECT id FROM j), 'labour', 'more', 1, 100, 25)$$, '55000', 'an invoiced job is closed');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT count(*) FROM public.invoices WHERE id = (SELECT id FROM inv)) = 1, 'the customer reads the invoice');
SELECT tests.ok((SELECT count(*) FROM public.job_events WHERE job_id = (SELECT id FROM j)) >= 6, 'and the job''s log');
ROLLBACK;

-- ── Quote: the customer accepts or declines; cancellations ─────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.jobs_acme() AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE j ON COMMIT DROP AS SELECT * FROM public.request_job((SELECT id FROM o), tests.svc('Bathroom renovation'), tests.contact(), tests.place(), 'new bathroom', NULL);
SELECT tests.ok((SELECT status FROM j) = 'requested' AND (SELECT agreed_price FROM j) IS NULL, 'a job on quote waits for the quote');
SELECT tests.throws($$SELECT public.respond_to_quote((SELECT id FROM j), true)$$, '55000', 'nothing to accept yet');
SELECT tests.login(:cust1);
SELECT public.quote_job((SELECT id FROM j), 85000, 'Tiles, membrane, fittings', 30);
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.respond_to_quote((SELECT id FROM j), true)$$, 'P0002', 'only the customer answers the quote');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT agreed_price FROM public.respond_to_quote((SELECT id FROM j), true)) = 85000, 'the customer accepts it; that is the agreed price');
SELECT tests.login(:cust1);
SELECT public.schedule_job((SELECT id FROM j), now() + interval '10 hours', now() + interval '18 hours', NULL);
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.cancel_job((SELECT id FROM j), 'changed my mind')$$, '55000', 'the customer cannot cancel online less than 24 hours before');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT cancelled_by FROM public.cancel_job((SELECT id FROM j), 'customer called')) = 'company', 'the company can');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.jobs_acme() AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE j ON COMMIT DROP AS SELECT * FROM public.request_job((SELECT id FROM o), tests.svc('Replace a tap'), tests.contact(), tests.place(), NULL, NULL);
SELECT tests.ok((SELECT cancelled_by FROM public.cancel_job((SELECT id FROM j), NULL)) = 'customer', 'the customer cancels before it is scheduled');
SELECT tests.login(:worker);
SELECT tests.ok((SELECT count(*) FROM public.jobs) = 0, 'a worker does not see jobs not given to them');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM public.jobs WHERE customer_user_id IS NULL) = 0
                AND (SELECT customer_user_id FROM public.create_job((SELECT id FROM o), tests.svc('Replace a tap'), tests.contact(), tests.place(), 'by phone', NULL)) IS NULL,
  'the company records a job taken by phone, without a customer account');
SELECT tests.login(:admin);
SELECT public.admin_set_white_label_status((SELECT id FROM o), 'suspended', 'test');
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.request_job((SELECT id FROM o), tests.svc('Replace a tap'), tests.contact(), tests.place(), NULL, NULL)$$, '55000',
  'a suspended plan takes no jobs');
ROLLBACK;

\echo 'jobs: all tests passed'
