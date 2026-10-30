-- ============================================================================
-- The moving and transport front page's subdomain is reserved
-- (supabase/migrations/00027_reserved_transport_slug.sql)
-- Each block runs in its own transaction and rolls back.
-- Uses the customer of p0_security.test.sql.
-- ============================================================================

\set ON_ERROR_STOP 1
\set cust1   '''c0000000-0000-0000-0000-000000000001'''

BEGIN;
SELECT tests.ok(public.is_reserved_org_slug('transport') AND public.is_reserved_org_slug('Transport')
  AND public.is_reserved_org_slug('moving') AND public.is_reserved_org_slug('flytting'),
  'transport, moving and flytting are reserved, in any case');
SELECT tests.ok(public.is_reserved_org_slug('www') AND public.is_reserved_org_slug('admin') AND public.is_reserved_org_slug('demo'),
  'the earlier reserved slugs stay reserved');
SELECT tests.ok(NOT public.is_reserved_org_slug('transportfirma') AND NOT public.is_reserved_org_slug('acme-moving'),
  'a slug that only contains the words is not reserved');
SELECT tests.ok((SELECT provolatile FROM pg_proc WHERE oid = 'public.is_reserved_org_slug(text)'::regprocedure) = 'i',
  'the function stays IMMUTABLE (the organizations check uses it)');
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.organizations WHERE public.is_reserved_org_slug(slug)),
  'no existing company has a reserved slug');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.create_organization('Transport AS', 'transport')$$, '23514',
  'a company cannot take the slug transport (transport.flyttgo.no)');
SELECT tests.throws($$SELECT public.create_organization('Flytting AS', 'flytting')$$, '23514', 'nor flytting');
SELECT tests.throws($$SELECT public.create_organization('Moving AS', 'moving')$$, '23514', 'nor moving');
SELECT tests.ok((SELECT id FROM public.create_organization('Transportfirma AS', 'transportfirma')) IS NOT NULL,
  'a slug that only starts with the word is still allowed');
ROLLBACK;

-- ── Rollback: the list is as 00005 set it ──
BEGIN;
\i supabase/rollback/00027_down.sql
SELECT tests.ok(NOT public.is_reserved_org_slug('transport') AND public.is_reserved_org_slug('www'),
  'the rollback puts back the earlier list');
ROLLBACK;
\echo 'reserved transport slug: all tests passed'
