-- ============================================================================
-- Launch decisions (supabase/migrations/00006_launch_decisions.sql)
-- Each block runs in its own transaction and rolls back.
-- Run with supabase/tests/run.sh (both schemas).
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''
\set drv2    '''d0000000-0000-0000-0000-000000000002'''
\set dp1     '''d1000000-0000-0000-0000-000000000001'''
\set dp2     '''d1000000-0000-0000-0000-000000000002'''
\set paid    '''b0000000-0000-0000-0000-000000000002'''
\set other   '''b0000000-0000-0000-0000-000000000003'''
\set cheap   '''b0000000-0000-0000-0000-000000000004'''

-- ── Eligibility: from the subscription, not subscription_active ─────────────
BEGIN;
-- Both drivers online next to the pickup; nobody has subscription_active.
UPDATE public.driver_profiles SET subscription_active = false;
INSERT INTO public.driver_locations (driver_id, lat, lng) VALUES (:drv1, 59.911, 10.751), (:drv2, 59.911, 10.751)
ON CONFLICT (driver_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now();
INSERT INTO public.bookings (id, customer_id, status, payment_status, price_estimate, original_price,
                             estimated_hours, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, van_type)
VALUES (:cheap, :cust2, 'pending', 'paid', 400, 400, 1, 59.91, 10.75, 59.95, 10.80, 'medium_van');
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
SELECT tests.ok((SELECT slug FROM public.driver_current_plan(:drv1)) = 'pro', 'driver 1 works under Pro');
SELECT tests.ok((SELECT slug FROM public.driver_current_plan(:drv2)) = 'free', 'a driver without a subscription works under Free');
SELECT tests.ok((SELECT array_agg(driver_id) FROM public.dispatch_rank_candidates(:paid)) = ARRAY[:dp1::uuid],
  'dispatch finds drivers without subscription_active, and keeps Free drivers off jobs over 500 NOK');
SELECT tests.ok((SELECT count(*) FROM public.dispatch_rank_candidates(:cheap)) = 2, 'both drivers can take a 400 NOK job');
SELECT tests.ok((SELECT driver_id FROM public.dispatch_rank_candidates(:cheap) ORDER BY score DESC LIMIT 1) = :dp1,
  'the higher plan ranks first (dispatch_weight, not the inverted dispatch_priority)');
ROLLBACK;

-- The pool shows a driver only the jobs their plan can take.
BEGIN;
INSERT INTO public.bookings (id, customer_id, status, payment_status, price_estimate, original_price,
                             estimated_hours, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, van_type)
VALUES (:cheap, :cust2, 'pending', 'paid', 400, 400, 1, 59.91, 10.75, 59.95, 10.80, 'medium_van');
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv2);
SELECT tests.ok((SELECT array_agg(id) FROM public.driver_job_pool()) = ARRAY[:cheap::uuid], 'a Free driver''s pool holds only jobs up to 500 NOK');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.driver_job_pool()) = 3, 'a Pro driver sees every open paid job');
SELECT tests.throws($$SELECT * FROM public.driver_current_plan('d0000000-0000-0000-0000-000000000002')$$, '42501',
  'drivers cannot look up other drivers'' plans');
ROLLBACK;

-- ── Grace and expiry ───────────────────────────────────────────────────────
BEGIN;
UPDATE public.driver_subscriptions SET end_date = now() - interval '1 hour' WHERE driver_id = :drv1 AND subscription_status = 'active';
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
SELECT tests.ok((SELECT slug FROM public.driver_current_plan(:drv1)) = 'pro', 'a monthly plan keeps working for 24 hours after its end');
RESET ROLE;
UPDATE public.driver_subscriptions SET end_date = now() - interval '25 hours' WHERE driver_id = :drv1 AND subscription_status = 'active';
SET LOCAL ROLE service_role;
SELECT tests.ok((SELECT slug FROM public.driver_current_plan(:drv1)) = 'free', 'after the grace it counts as Free');
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.expire_lapsed_subscriptions('d0000000-0000-0000-0000-000000000002')$$, '42501', 'a driver cannot expire another driver');
SELECT tests.throws($$SELECT public.expire_lapsed_subscriptions()$$, '42501', 'nor everyone');
SELECT tests.ok(public.expire_lapsed_subscriptions(:drv1) = 1, 'a driver expires their own lapsed plan');
SELECT tests.ok(public.expire_lapsed_subscriptions(:drv1) = 0, 'once');
RESET ROLE;
SELECT tests.ok((SELECT count(*) FROM public.driver_subscriptions WHERE driver_id = :drv1 AND subscription_status = 'expired') = 1
            AND (SELECT public.plan_slug(sp.name) FROM public.driver_subscriptions ds JOIN public.subscription_plans sp ON sp.id = ds.plan_id
                  WHERE ds.driver_id = :drv1 AND ds.subscription_status = 'active') = 'free',
  'the lapsed plan is kept as expired and Free is active');
ROLLBACK;

-- ── Cancellations are stamped by the database ─────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$UPDATE public.bookings SET status = 'cancelled', cancelled_by = 'platform' WHERE id = 'b0000000-0000-0000-0000-000000000002'$$,
  '42501', 'a customer cannot say who cancelled');
UPDATE public.bookings SET status = 'cancelled' WHERE id = :paid;
SELECT tests.ok((SELECT cancelled_by = 'customer' AND cancelled_at > now() - interval '1 minute' FROM public.bookings WHERE id = :paid),
  'a customer''s cancellation is recorded as theirs, with the time');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);       -- the database owner, no JWT
UPDATE public.bookings SET cancelled_by = 'platform', cancelled_at = now() - interval '9 days' WHERE id = :paid;
SELECT tests.ok((SELECT cancelled_by FROM public.bookings WHERE id = :paid) = 'customer', 'the record cannot be rewritten later');
ROLLBACK;

BEGIN;
UPDATE public.bookings SET driver_id = :dp1, status = 'driver_assigned' WHERE id = :paid;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET status = 'cancelled' WHERE id = 'b0000000-0000-0000-0000-000000000002'$$) = 1,
  'a customer can cancel after a driver is assigned (the late fee applies)');
SELECT tests.login(:admin);
UPDATE public.bookings SET status = 'cancelled' WHERE id = :other;
SELECT tests.ok((SELECT cancelled_by FROM public.bookings WHERE id = :other) = 'platform', 'an administrator''s cancellation is the platform''s');
ROLLBACK;

BEGIN;
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
UPDATE public.bookings SET status = 'cancelled', cancelled_by = 'driver' WHERE id = :other;
SELECT tests.ok((SELECT cancelled_by FROM public.bookings WHERE id = :other) = 'driver', 'the server may record that the driver withdrew');
ROLLBACK;

-- ── Vipps: capture before release ──────────────────────────────────────────
BEGIN;
UPDATE public.bookings SET driver_id = :dp1, status = 'completed', payment_provider = 'vipps',
       payment_intent_id = 'booking-cap-1', paid_amount = 2875 WHERE id = :paid;
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
UPDATE public.escrow_payments SET status = 'released', driver_earning = 2300, commission_amount = 575 WHERE booking_id = :paid;
SELECT tests.ok((SELECT status FROM public.escrow_payments WHERE booking_id = :paid) = 'capture_pending',
  'releasing an uncaptured Vipps payment waits for the capture');
SELECT tests.ok((SELECT balance FROM public.driver_wallets WHERE driver_id = :dp1) = 1000, 'and pays the driver nothing yet');
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_release_escrow('b0000000-0000-0000-0000-000000000002')$$, '55000', 'admin release asks for the capture first');
SELECT tests.throws($$SELECT public.payment_capture_mark('b0000000-0000-0000-0000-000000000002', 2875)$$, '42501', 'only the server records a capture');
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
SELECT public.payment_capture_mark(:paid, 2875);
UPDATE public.escrow_payments SET status = 'released' WHERE booking_id = :paid;
SELECT tests.ok((SELECT status FROM public.escrow_payments WHERE booking_id = :paid) = 'released', 'after the capture the release goes through');
SELECT tests.ok((SELECT balance FROM public.driver_wallets WHERE driver_id = :dp1) = 3300, 'and the driver is paid, once');
ROLLBACK;

BEGIN;
UPDATE public.bookings SET driver_id = :dp1, status = 'completed', payment_provider = 'stripe',
       payment_intent_id = 'pi_cap', paid_amount = 2875 WHERE id = :other;
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
UPDATE public.escrow_payments SET status = 'released', driver_earning = 2300 WHERE booking_id = :other;
SELECT tests.ok((SELECT status FROM public.escrow_payments WHERE booking_id = :other) = 'released', 'card payments are captured at checkout: not held');
ROLLBACK;

-- ── Organisations: platform admins are not members ─────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.invite_member((SELECT id FROM o), 'x@test', 'owner')$$, '42501', 'a platform admin cannot invite');
SELECT tests.throws($$SELECT public.change_member_role((SELECT id FROM o), 'd0000000-0000-0000-0000-000000000001', 'owner')$$,
  '42501', 'or change roles');
SELECT tests.throws($$SELECT public.update_organization((SELECT id FROM o), '{"name":"X"}')$$, '42501', 'or edit the company');
SELECT tests.ok((SELECT count(*) FROM public.organization_members) = 2, 'but reads it');
SELECT tests.throws($$SELECT public.admin_transfer_ownership((SELECT id FROM o), 'd0000000-0000-0000-0000-000000000001', ' ')$$,
  '22023', 'recovering ownership needs a reason');
SELECT tests.ok((SELECT role FROM public.admin_transfer_ownership((SELECT id FROM o), :drv1, 'owner left the company')) = 'owner',
  'a platform admin restores an owner, with a reason');
SELECT tests.ok(EXISTS (SELECT 1 FROM public.organization_events WHERE action = 'member.owner_restored'
                          AND actor_id = :admin AND subject_user_id = :drv1), 'and it is in the log');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.admin_transfer_ownership((SELECT id FROM o), 'c0000000-0000-0000-0000-000000000002', 'me')$$,
  '42501', 'owners cannot use the recovery path');
ROLLBACK;

-- ── Verification before activation ─────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
GRANT SELECT ON o TO service_role;
SELECT tests.throws($$SELECT public.record_organization_verification((SELECT id FROM o), 'manual', true, '{"evidence":"me"}')$$,
  '42501', 'an owner cannot verify their own company');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_set_organization_status((SELECT id FROM o), 'active')$$, '55000', 'no activation without a check');
SELECT tests.throws($$SELECT public.record_organization_verification((SELECT id FROM o), 'brreg', true, '{}')$$,
  '42501', 'an administrator cannot pose as the registry check');
SELECT tests.throws($$SELECT public.record_organization_verification((SELECT id FROM o), 'manual', true, '{}')$$,
  '22023', 'a manual check needs its evidence');
SELECT public.record_organization_verification((SELECT id FROM o), 'manual', false, '{"evidence":"name does not match"}');
SELECT tests.throws($$SELECT public.admin_set_organization_status((SELECT id FROM o), 'active')$$, '55000', 'a failed check does not count');
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
SELECT public.record_organization_verification((SELECT id FROM o), 'brreg', true, '{"navn":"ACME AS"}');
RESET ROLE;
UPDATE public.organization_verifications SET checked_at = now() - interval '31 days';
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_set_organization_status((SELECT id FROM o), 'active')$$, '55000', 'a check older than 30 days does not count');
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
SELECT public.record_organization_verification((SELECT id FROM o), 'brreg', true, '{"navn":"ACME AS"}');
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT tests.ok((SELECT status FROM public.admin_set_organization_status((SELECT id FROM o), 'active')) = 'active',
  'a recent passed registry check allows activation');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM public.organization_verifications) = 3, 'the owner sees the checks (one failed, two registry)');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.organization_verifications) = 0, 'a booker does not');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
GRANT SELECT ON o TO service_role;
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
SELECT public.record_organization_verification((SELECT id FROM o), 'brreg', true, '{}');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT public.update_organization((SELECT id FROM o), '{"org_number":"974760673"}');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_set_organization_status((SELECT id FROM o), 'active')$$, '55000',
  'a check of an earlier organisation number does not count');
ROLLBACK;

-- ── A closed organisation lets its last owner go ───────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.login(:admin);
SELECT public.admin_set_organization_status((SELECT id FROM o), 'closed', 'company dissolved');
RESET ROLE;
-- What deleting the account does to the membership (ON DELETE CASCADE).
DELETE FROM public.organization_members WHERE user_id = :cust1;
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = :cust1),
  'the last owner of a closed organisation can delete their account');
ROLLBACK;

\echo 'launch_decisions: all tests passed'
