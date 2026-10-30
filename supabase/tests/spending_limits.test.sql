-- ============================================================================
-- Spending limits and approval (supabase/migrations/00017_spending_limits.sql)
-- Each block runs in its own transaction and rolls back.
-- Uses tests.acme() (organizations.test.sql), tests.activate() and
-- tests.book() (company_bookings.test.sql), tests.seller() and
-- tests.as_server() (invoicing.test.sql): cust1 owns Acme, drv1 books
-- there (1200 NOK bookings), cust2 joins as finance where a block says so.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''
\set drv2    '''d0000000-0000-0000-0000-000000000002'''

-- The server's check, as the payment functions call it: for the
-- booking's customer, at the server's price (p_amount; the booking's
-- stored price when not given).
CREATE OR REPLACE FUNCTION tests.check(p_booking uuid, p_amount numeric DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_claims text := current_setting('request.jwt.claims', true); v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT public.company_booking_check(b.id, b.customer_id, coalesce(p_amount, b.price_estimate)) INTO v
    FROM public.bookings b WHERE b.id = p_booking;
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN v;
END $$;

-- cust2 joins the company as finance; cust1 is signed in again after.
CREATE OR REPLACE FUNCTION tests.finance(p_org uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_tok text;
BEGIN
  PERFORM tests.login('c0000000-0000-0000-0000-000000000001');
  SELECT token INTO v_tok FROM public.invite_member(p_org, 'cust2@test', 'finance');
  PERFORM tests.login('c0000000-0000-0000-0000-000000000002');
  PERFORM public.accept_invitation(v_tok);
  PERFORM tests.login('c0000000-0000-0000-0000-000000000001');
END $$;

-- As the payment webhooks would: mark a booking paid.
CREATE OR REPLACE FUNCTION tests.mark_paid(p_booking uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_claims text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.bookings SET payment_status = 'escrow', payment_provider = 'stripe', paid_at = now() WHERE id = p_booking;
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── Setting limits and rules: who may ──────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
SELECT tests.finance((SELECT id FROM o));
SELECT tests.ok((SELECT per_booking_limit = 1000 AND monthly_limit = 5000
                   FROM public.set_member_spending_limits((SELECT id FROM o), :drv1, 1000, 5000)),
  'the owner sets a booker''s limit per booking and per month');
SELECT tests.throws($$SELECT public.set_member_spending_limits((SELECT id FROM o), 'c0000000-0000-0000-0000-000000000001', 1, 1)$$,
  '42501', 'nobody sets their own limits');
SELECT tests.throws($$SELECT public.set_member_spending_limits((SELECT id FROM o), 'd0000000-0000-0000-0000-000000000001', -1, NULL)$$,
  '23514', 'a limit cannot be negative');
SELECT tests.throws($$SELECT public.set_member_spending_limits((SELECT id FROM o), 'a0000000-0000-0000-0000-000000000001', 1, 1)$$,
  'P0002', 'only members have limits');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT per_booking_limit = 800 FROM public.set_member_spending_limits((SELECT id FROM o), :drv1, 800, NULL)),
  'finance sets a booker''s limits');
SELECT tests.throws($$SELECT public.set_member_spending_limits((SELECT id FROM o), 'c0000000-0000-0000-0000-000000000001', 1, 1)$$,
  '42501', 'finance cannot limit an owner');
SELECT tests.ok((SELECT approval_above = 10000 AND approval_roles = ARRAY['booker']
                   FROM public.set_spending_rules((SELECT id FROM o), 10000, ARRAY['booker'], 48)),
  'finance sets the company''s approval rules');
SELECT tests.throws($$SELECT public.set_spending_rules((SELECT id FROM o), NULL, ARRAY['viewer'], 48)$$, '23514',
  'approval rules name only roles that book');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.set_member_spending_limits((SELECT id FROM o), 'c0000000-0000-0000-0000-000000000002', 1, 1)$$,
  '42501', 'a booker sets no limits');
SELECT tests.throws($$SELECT public.set_spending_rules((SELECT id FROM o), 1, NULL, 48)$$, '42501', 'nor rules');
SELECT tests.ok((SELECT count(*) FROM public.organization_member_limits) = 1
            AND (SELECT count(*) FROM public.organization_spending_rules) = 1,
  'a booker reads their own limits and the rules');
SELECT tests.ok((SELECT count(*) FROM public.organization_spending((SELECT id FROM o))) = 1,
  'the team''s spend shows a booker only their own row');
SELECT tests.throws($$INSERT INTO public.organization_member_limits (organization_id, user_id) VALUES ((SELECT id FROM o), 'd0000000-0000-0000-0000-000000000001')$$,
  '42501', 'the tables are not written directly');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM public.organization_spending((SELECT id FROM o))) = 3,
  'the owner sees every member''s limits and spend');
RESET ROLE;
SELECT tests.ok((SELECT count(*) FROM public.organization_events WHERE organization_id = (SELECT id FROM o)
                   AND action IN ('spending.limits', 'spending.rules')) = 3,
  'every change of limits and rules is in the company''s log');
ROLLBACK;

-- ── Limit per booking; the server's price decides ──────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
SELECT public.set_member_spending_limits((SELECT id FROM o), :drv1, 1500, NULL);
SELECT tests.login(:drv1);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id;
CREATE TEMP TABLE b2 ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id;
CREATE TEMP TABLE p ON COMMIT DROP AS SELECT tests.book(NULL) AS id;
SELECT tests.ok(tests.check((SELECT id FROM b)) ->> 'status' = 'not_required', 'a booking within the limit needs no approval');
SELECT tests.ok((SELECT status = 'not_required' FROM public.company_booking_approvals WHERE booking_id = (SELECT id FROM b)),
  'the check is recorded, and the booker reads it');
SELECT tests.ok(tests.check((SELECT id FROM b), 2000) ->> 'status' = 'pending',
  'the same booking at a higher server price waits for approval (the stored 1200 does not count)');
SELECT tests.ok((SELECT reasons = ARRAY['per_booking_limit'] AND amount = 2000
                   FROM public.company_booking_approvals WHERE booking_id = (SELECT id FROM b)),
  'with the reason and the server''s amount');
SELECT tests.ok(tests.check((SELECT id FROM p)) ->> 'status' = 'not_company', 'personal bookings are not checked');
SELECT tests.throws($$SELECT public.company_booking_check((SELECT id FROM b2), 'd0000000-0000-0000-0000-000000000001', 1)$$,
  '42501', 'the browser cannot run the check (the server prices first)');
RESET ROLE;
SELECT tests.throws($$SELECT tests.check((SELECT id FROM b2), 0)$$, '22023', 'the check needs the server price');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT public.remove_member((SELECT id FROM o), :drv1);
SELECT tests.throws($$SELECT tests.check((SELECT id FROM b2))$$, '42501', 'a former member no longer spends for the company');
ROLLBACK;

-- ── Monthly limit (Europe/Oslo month), what counts ─────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
SELECT public.set_member_spending_limits((SELECT id FROM o), :drv1, NULL, 3000);
SELECT tests.login(:drv1);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id, 1 AS n;
INSERT INTO b SELECT tests.book((SELECT id FROM o)), 2;
INSERT INTO b SELECT tests.book((SELECT id FROM o)), 3;
INSERT INTO b SELECT tests.book((SELECT id FROM o)), 4;
INSERT INTO b SELECT tests.book((SELECT id FROM o)), 5;
-- Unchecked, unpaid bookings commit nothing.
SELECT tests.ok(tests.check((SELECT id FROM b WHERE n = 1)) ->> 'status' = 'not_required', 'first booking: 1200 of 3000');
SELECT tests.ok(tests.check((SELECT id FROM b WHERE n = 2)) ->> 'status' = 'not_required', 'second: 2400 of 3000');
SELECT tests.ok(tests.check((SELECT id FROM b WHERE n = 3)) ->> 'status' = 'pending', 'third: over the month, waits');
SELECT tests.ok((SELECT reasons = ARRAY['monthly_limit'] AND month_spend = 2400
                   FROM public.company_booking_approvals WHERE booking_id = (SELECT id FROM b WHERE n = 3)),
  'the request states the month''s spend before it');
-- A cancelled booking no longer counts; one made last month (Oslo) neither.
UPDATE public.bookings SET status = 'cancelled' WHERE id = (SELECT id FROM b WHERE n = 1);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.bookings SET created_at = date_trunc('month', timezone('Europe/Oslo', now())) AT TIME ZONE 'Europe/Oslo' - interval '1 minute'
 WHERE id = (SELECT id FROM b WHERE n = 2);
SELECT tests.ok(public.member_month_spend((SELECT id FROM o), :drv1) = 1200,
  'cancelled and last month''s bookings are left out (the waiting one counts)');
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.ok(tests.check((SELECT id FROM b WHERE n = 4)) ->> 'status' = 'not_required', 'so the next one fits again');
SELECT tests.ok(tests.check((SELECT id FROM b WHERE n = 5)) ->> 'status' = 'pending', 'until the month is full again');
ROLLBACK;

-- ── Company rules: above an amount, every booking by a role ────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
SELECT public.set_spending_rules((SELECT id FROM o), 1000, NULL, 168);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id, 1 AS n;
SELECT tests.ok((tests.check((SELECT id FROM b WHERE n = 1)) -> 'reasons') = '["amount_over"]',
  'a booking above the company''s amount waits, the owner''s included');
SELECT public.set_spending_rules((SELECT id FROM o), NULL, ARRAY['booker'], 168);
SELECT tests.login(:drv1);
INSERT INTO b SELECT tests.book((SELECT id FROM o)), 2;
SELECT tests.ok((tests.check((SELECT id FROM b WHERE n = 2), 50) -> 'reasons') = '["role"]',
  'every booking by a booker waits, however small');
ROLLBACK;

-- ── A waiting booking: not payable, not invoiced, not seen by drivers ──────
BEGIN;
SELECT tests.seller();
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
SELECT tests.login(:admin);
SELECT public.admin_set_invoicing((SELECT id FROM o), true, NULL, 'standard');
SELECT tests.login(:cust1);
SELECT public.set_spending_rules((SELECT id FROM o), 1000, NULL, 168);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id;
GRANT SELECT ON o, b TO service_role;
SELECT tests.ok(tests.check((SELECT id FROM b)) ->> 'status' = 'pending', 'the owner''s 1200 NOK booking waits');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.throws($$SELECT public.book_on_invoice((SELECT id FROM b), 'c0000000-0000-0000-0000-000000000001')$$, '55000',
  'it cannot go on the company''s invoice');
SELECT tests.throws($$SELECT tests.mark_paid((SELECT id FROM b))$$, '55000', 'nor be marked paid, even by the server');
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.driver_job_pool() WHERE id = (SELECT id FROM b)), 'drivers do not see it');
SELECT tests.ok(NOT public.claim_job((SELECT id FROM b)), 'nor take it');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT tests.throws($$UPDATE public.bookings SET driver_id = 'd1000000-0000-0000-0000-000000000001', status = 'driver_assigned' WHERE id = (SELECT id FROM b)$$,
  '55000', 'nor be assigned to a driver, even by the database owner (dispatch included)');
SELECT tests.throws($$UPDATE public.bookings SET status = 'completed' WHERE id = (SELECT id FROM b)$$, '55000',
  'nor be moved along');
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.uninvoiced_bookings() WHERE booking_id = (SELECT id FROM b)),
  'the invoice run does not see it');
SELECT tests.ok((SELECT payment_status = 'pending' AND status = 'pending' AND payment_provider IS NULL
                   FROM public.bookings WHERE id = (SELECT id FROM b)), 'it stays an unpaid booking');
-- Approved: the same booking is paid on invoice and reaches the drivers.
SET LOCAL ROLE authenticated;
SELECT tests.finance((SELECT id FROM o));
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT status = 'approved' AND decided_by = :cust2
                   FROM public.decide_booking_approval((SELECT id FROM b), true, 'project budget')),
  'finance approves the owner''s booking');
SELECT tests.ok(tests.check((SELECT id FROM b), 1500) ->> 'status' = 'pending', 'a higher server price than approved asks again');
SELECT public.decide_booking_approval((SELECT id FROM b), true, NULL);
SELECT tests.ok(tests.check((SELECT id FROM b), 1500) ->> 'status' = 'approved', 'the approved amount passes the check');
SELECT tests.ok((tests.check((SELECT id FROM b)) -> 'reasons') ? 'price_changed',
  'a lower price than approved asks again too: an approval is for its amount (00022)');
SELECT public.decide_booking_approval((SELECT id FROM b), true, NULL, 1200);
SELECT tests.ok(tests.check((SELECT id FROM b)) ->> 'status' = 'approved', 'approved again for 1200, the check passes it');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT public.book_on_invoice((SELECT id FROM b), :cust1);
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.ok(EXISTS (SELECT 1 FROM public.driver_job_pool() WHERE id = (SELECT id FROM b)), 'once on invoice, drivers see it');
SELECT tests.throws($$SELECT tests.check((SELECT id FROM b), 5000)$$, '55000', 'a paid booking is not checked again');
ROLLBACK;

-- ── Who approves: another role, never the person who booked ────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
SELECT tests.finance((SELECT id FROM o));
SELECT public.set_spending_rules((SELECT id FROM o), NULL, ARRAY['owner', 'booker'], 168);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id, 'owner' AS who;
SELECT tests.check((SELECT id FROM b WHERE who = 'owner'));
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b WHERE who = 'owner'), true, NULL)$$, '42501',
  'the owner cannot approve their own booking');
SELECT tests.login(:drv1);
INSERT INTO b SELECT tests.book((SELECT id FROM o)), 'booker';
SELECT tests.check((SELECT id FROM b WHERE who = 'booker'));
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b WHERE who = 'booker'), true, NULL)$$, '42501',
  'a booker approves nothing, their own booking included');
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b WHERE who = 'owner'), true, NULL)$$, '42501',
  'nor anyone else''s');
-- The booker becomes an admin: still not their own booking.
SELECT tests.login(:cust1);
SELECT public.change_member_role((SELECT id FROM o), :drv1, 'admin');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b WHERE who = 'booker'), true, NULL)$$, '42501',
  'nor after becoming an admin');
SELECT tests.ok((SELECT status = 'approved' FROM public.decide_booking_approval((SELECT id FROM b WHERE who = 'owner'), true, NULL)),
  'an admin approves the owner''s booking');
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b WHERE who = 'owner'), false, 'changed my mind')$$, '55000',
  'a decision is made once');
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b WHERE who = 'booker'), false, '  ')$$, '22023',
  'a refusal needs a reason');
SELECT tests.ok((SELECT status = 'refused' AND decision_reason = 'not in budget'
                   FROM public.decide_booking_approval((SELECT id FROM b WHERE who = 'booker'), false, 'not in budget')),
  'finance refuses with a reason');
SELECT tests.ok((SELECT status = 'cancelled' AND cancelled_by = 'platform' AND cancellation_reason LIKE '%not in budget%'
                        AND payment_status = 'pending' AND payment_provider IS NULL
                   FROM public.bookings WHERE id = (SELECT id FROM b WHERE who = 'booker')),
  'the refused booking is cancelled, never paid or invoiced: no fee');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT decision_reason FROM public.company_booking_approvals WHERE booking_id = (SELECT id FROM b WHERE who = 'booker'))
                = 'not in budget', 'the booker reads the decision and its reason');
SELECT tests.ok(EXISTS (SELECT 1 FROM public.notifications WHERE user_id = :drv1 AND link_id = (SELECT id FROM b WHERE who = 'booker')
                         AND title = 'Booking not approved'), 'and is told');
SELECT tests.throws($$SELECT tests.check((SELECT id FROM b WHERE who = 'booker'))$$, '55000', 'a refused booking stays unpayable');
RESET ROLE;
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.uninvoiced_bookings() WHERE booking_id = (SELECT id FROM b WHERE who = 'booker')),
  'and is not invoiced as a cancellation');
SELECT tests.ok((SELECT array_agg(action ORDER BY id) FROM public.company_booking_approval_events
                  WHERE booking_id = (SELECT id FROM b WHERE who = 'booker')) = ARRAY['requested', 'refused'],
  'every step is logged');
SELECT tests.throws($$UPDATE public.company_booking_approval_events SET action = 'approved'$$, '42501',
  'the log cannot be changed, not even by the database owner');
SELECT tests.throws($$DELETE FROM public.company_booking_approval_events$$, '42501', 'nor emptied');
ROLLBACK;

-- ── Expiry and withdrawal ──────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
SELECT public.set_spending_rules((SELECT id FROM o), NULL, ARRAY['booker'], 24);
SELECT tests.login(:drv1);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id, 1 AS n;
INSERT INTO b SELECT tests.book((SELECT id FROM o)), 2;
SELECT tests.check((SELECT id FROM b WHERE n = 1));
SELECT tests.check((SELECT id FROM b WHERE n = 2));
SELECT tests.ok((SELECT expires_at BETWEEN now() + interval '23 hours' AND now() + interval '25 hours'
                   FROM public.company_booking_approvals WHERE booking_id = (SELECT id FROM b WHERE n = 1)),
  'a request runs for the hours the company chose');
RESET ROLE;
UPDATE public.company_booking_approvals SET expires_at = now() - interval '1 minute' WHERE booking_id = (SELECT id FROM b WHERE n = 1);
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b WHERE n = 1), true, NULL)$$, '55000',
  'an expired request cannot be approved');
SELECT tests.ok(public.expire_booking_approvals((SELECT id FROM o)) = 1, 'the company''s expired requests are ended');
SELECT tests.ok((SELECT a.status = 'expired' AND b.status = 'cancelled' AND b.payment_status = 'pending'
                   FROM public.company_booking_approvals a JOIN public.bookings b ON b.id = a.booking_id
                  WHERE a.booking_id = (SELECT id FROM b WHERE n = 1)),
  'the expired request cancels its booking, unpaid and without a fee');
SELECT tests.login(:drv1);
UPDATE public.bookings SET status = 'cancelled' WHERE id = (SELECT id FROM b WHERE n = 2);
SELECT tests.ok((SELECT status FROM public.company_booking_approvals WHERE booking_id = (SELECT id FROM b WHERE n = 2)) = 'withdrawn',
  'the booker cancelling withdraws the request');
ROLLBACK;

-- ── Companies are kept apart ───────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
SELECT public.set_member_spending_limits((SELECT id FROM o), :drv1, 100, 100);
SELECT public.set_spending_rules((SELECT id FROM o), 100, NULL, 168);
SELECT tests.login(:drv1);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id;
SELECT tests.check((SELECT id FROM b));
-- cust2 runs another company and is its owner.
SELECT tests.login(:cust2);
CREATE TEMP TABLE o2 ON COMMIT DROP AS SELECT id FROM public.create_organization('Beta AS', 'beta-as');
SELECT tests.activate((SELECT id FROM o2));
SELECT tests.ok((SELECT count(*) FROM public.company_booking_approvals) = 0
            AND (SELECT count(*) FROM public.company_booking_approval_events) = 0
            AND (SELECT count(*) FROM public.organization_member_limits) = 0
            AND (SELECT count(*) FROM public.organization_spending_rules) = 0,
  'another company''s owner reads none of Acme''s limits, rules, requests or log');
SELECT tests.throws($$SELECT public.organization_spending((SELECT id FROM o))$$, '42501', 'nor its spend');
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b), true, NULL)$$, 'P0002', 'nor approves its bookings');
SELECT tests.throws($$SELECT public.set_member_spending_limits((SELECT id FROM o), 'd0000000-0000-0000-0000-000000000001', NULL, NULL)$$,
  '42501', 'nor lifts its limits');
SELECT tests.throws($$SELECT public.set_spending_rules((SELECT id FROM o), NULL, NULL, 168)$$, '42501', 'nor its rules');
SELECT tests.throws($$SELECT public.expire_booking_approvals((SELECT id FROM o))$$, '42501', 'nor ends its requests');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.organization_spending((SELECT id FROM o2))$$, '42501', 'and the other way round');
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT tests.throws($$SELECT count(*) FROM public.company_booking_approvals$$, '42501', 'anonymous visitors read nothing');
ROLLBACK;

\echo 'spending_limits: all tests passed'
