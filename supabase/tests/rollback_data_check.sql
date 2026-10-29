-- After rolling back with data (rollback_data.sql): the core rows are all
-- still there, and the report lists what was lost or left NOT VALID.

\set ON_ERROR_STOP 1
\pset tuples_only on
SELECT tests.ok(NOT EXISTS (
  SELECT 1 FROM public.zz_rollback_before b
   WHERE b.n <> (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', b.t), false, true, '')))[1]::text::bigint),
  'rolling back keeps every booking, subscription, document, location, application, escrow and wallet row');
SELECT tests.ok((SELECT payment_intent_id FROM public.bookings WHERE id = 'b0000000-0000-0000-0000-000000000002') = 'pi_rb',
  'the provider reference stays (the column predates 00004)');
SELECT tests.ok((SELECT subscription_status FROM public.driver_subscriptions WHERE driver_id = 'd0000000-0000-0000-0000-000000000002') = 'expired',
  'an expired subscription stays, under a CHECK left NOT VALID');
SELECT tests.ok(to_regclass('public.payment_refunds') IS NULL AND to_regclass('public.organizations') IS NULL,
  'refund records and organisations are dropped (export them first)');

\echo '── left NOT VALID by the rollback (rows written while the migrations were in force):'
SELECT c.relname || '.' || con.conname AS constraint_not_valid
  FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT con.convalidated ORDER BY 1;
\echo 'rollback with data: all checks passed'
