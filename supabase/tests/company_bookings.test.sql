-- ============================================================================
-- Company bookings (supabase/migrations/00007_company_bookings.sql)
-- Each block runs in its own transaction and rolls back.
-- Uses tests.acme() from organizations.test.sql: cust1 owns Acme
-- (pending), drv1 is a booker there, cust2 is outside.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''

-- Activates a company as the platform would (a check, then activation).
CREATE OR REPLACE FUNCTION tests.activate(p_org uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_claims text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM tests.login('a0000000-0000-0000-0000-000000000001');
  PERFORM public.record_organization_verification(p_org, 'manual', true, '{"evidence":"test"}');
  PERFORM public.admin_set_organization_status(p_org, 'active', 'test');
  PERFORM set_config('request.jwt.claims', v_claims, true);
END $$;
GRANT EXECUTE ON FUNCTION tests.activate(uuid) TO authenticated;

-- A booking for p_org (or none) by the signed-in user.
CREATE OR REPLACE FUNCTION tests.book(p_org uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.bookings (customer_id, organization_id, price_estimate, original_price, estimated_hours,
                               pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, van_type, pickup_city, dropoff_city)
  VALUES (auth.uid(), p_org, 1200, 1200, 1, 59.91, 10.75, 59.95, 10.80, 'medium_van', 'Oslo', 'Bergen')
  RETURNING id;
$$;
GRANT EXECUTE ON FUNCTION tests.book(uuid) TO authenticated;

-- ── Only an active company's owner, admin or booker books for it ──────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.throws($$SELECT tests.book((SELECT id FROM o))$$, '42501', 'a pending company cannot book');
SELECT tests.activate((SELECT id FROM o));
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id;
SELECT tests.ok((SELECT organization_id FROM public.bookings WHERE id = (SELECT id FROM b)) = (SELECT id FROM o)
            AND (SELECT customer_id FROM public.bookings WHERE id = (SELECT id FROM b)) = :cust1
            AND (SELECT payment_status FROM public.bookings WHERE id = (SELECT id FROM b)) = 'pending',
  'the owner books for the active company; they are the customer and it starts unpaid');
SELECT tests.login(:drv1);
INSERT INTO b SELECT tests.book((SELECT id FROM o));
SELECT tests.ok((SELECT count(*) FROM b) = 2, 'a booker books for the company');
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT tests.book((SELECT id FROM o))$$, '42501', 'an outsider cannot book for the company');
SELECT tests.throws($$INSERT INTO public.bookings (customer_id, organization_id) SELECT 'c0000000-0000-0000-0000-000000000001', id FROM o$$,
  '42501', 'nor book in a member''s name');
ROLLBACK;

-- ── Finance and viewers read but do not book ───────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id;
SELECT public.change_member_role((SELECT id FROM o), :drv1, 'viewer');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT tests.book((SELECT id FROM o))$$, '42501', 'a viewer cannot book for the company');
SELECT tests.ok((SELECT count(*) FROM public.bookings WHERE organization_id = (SELECT id FROM o)) = 1,
  'a viewer reads the company''s bookings, the owner''s included');
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET customer_notes = 'x' WHERE id = (SELECT id FROM b)$$) = 0,
  'reading is not editing (the update touches nothing)');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT count(*) FROM public.bookings WHERE organization_id = (SELECT id FROM o)) = 0,
  'an outsider sees none of the company''s bookings');
ROLLBACK;

-- ── The company of a booking is fixed ──────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
CREATE TEMP TABLE personal ON COMMIT DROP AS SELECT tests.book(NULL) AS id;
CREATE TEMP TABLE company  ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id;
SELECT tests.throws($$UPDATE public.bookings SET organization_id = (SELECT id FROM o) WHERE id = (SELECT id FROM personal)$$,
  '42501', 'a personal booking cannot be moved to the company afterwards');
SELECT tests.throws($$UPDATE public.bookings SET organization_id = NULL WHERE id = (SELECT id FROM company)$$,
  '42501', 'nor a company booking taken out of it');
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET customer_notes = 'ring the bell' WHERE id = (SELECT id FROM company)$$) = 1,
  'the booker still edits what customers may edit');
ROLLBACK;

-- ── Suspension, leaving and deletion ───────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id;
SELECT tests.login(:admin);
SELECT public.admin_set_organization_status((SELECT id FROM o), 'suspended', 'unpaid invoices');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT tests.book((SELECT id FROM o))$$, '42501', 'a suspended company cannot book');
SELECT tests.ok((SELECT count(*) FROM public.bookings WHERE organization_id = (SELECT id FROM o)) = 1,
  'but keeps reading its bookings');
SELECT tests.login(:drv1);
SELECT public.remove_member((SELECT id FROM o), :drv1);
SELECT tests.ok((SELECT count(*) FROM public.bookings WHERE organization_id = (SELECT id FROM o)) = 0,
  'a former member no longer reads them');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT tests.throws($$DELETE FROM public.organizations WHERE id = (SELECT id FROM o)$$, '23503',
  'a company with bookings is closed, never deleted');
ROLLBACK;

\echo 'company_bookings: all tests passed'
