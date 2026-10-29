-- ============================================================================
-- P0 security tests (supabase/migrations/00002_p0_security_hardening.sql)
-- Each block runs in its own transaction and rolls back.
-- Run with supabase/tests/run.sh.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''
\set drv2    '''d0000000-0000-0000-0000-000000000002'''
\set dp1     '''d1000000-0000-0000-0000-000000000001'''
\set dp2     '''d1000000-0000-0000-0000-000000000002'''
\set applic  '''e0000000-0000-0000-0000-000000000001'''
\set unpaid  '''b0000000-0000-0000-0000-000000000001'''
\set paid    '''b0000000-0000-0000-0000-000000000002'''
\set other   '''b0000000-0000-0000-0000-000000000003'''

-- ── Sign-up role and profiles ───────────────────────────────────────────────
BEGIN;
SELECT tests.ok((SELECT role FROM public.profiles WHERE user_id = :cust1) = 'customer',
  'sign-up asking for role admin gets customer');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$UPDATE public.profiles SET role = 'admin' WHERE user_id = 'c0000000-0000-0000-0000-000000000001'$$,
  '42501', 'customer cannot change their own role');
SELECT tests.ok(tests.rows($$UPDATE public.profiles SET first_name = 'New' WHERE user_id = 'c0000000-0000-0000-0000-000000000001'$$) = 1,
  'customer can edit their own name');
SELECT tests.throws($$INSERT INTO public.admin_accounts (user_id) VALUES ('c0000000-0000-0000-0000-000000000001')$$,
  '42501', 'customer cannot make themselves an admin');
ROLLBACK;

-- ── Bookings: customer ─────────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
INSERT INTO public.bookings (id, customer_id, status, payment_status, driver_id, final_price, price_estimate, driver_confirmation)
VALUES ('b0000000-0000-0000-0000-0000000000aa', 'c0000000-0000-0000-0000-000000000001',
        'completed', 'escrow', 'd1000000-0000-0000-0000-000000000001', 1, 2875, true);
SELECT tests.ok((SELECT status = 'pending' AND payment_status = 'pending' AND driver_id IS NULL
                        AND final_price IS NULL AND driver_confirmation IS NULL
                   FROM public.bookings WHERE id = 'b0000000-0000-0000-0000-0000000000aa'),
  'customer insert: status, payment, driver and outcome are reset');
SELECT tests.throws($$UPDATE public.bookings SET payment_status = 'escrow' WHERE id = 'b0000000-0000-0000-0000-000000000001'$$,
  '42501', 'customer cannot mark their booking paid (payment bypass)');
SELECT tests.throws($$UPDATE public.bookings SET final_price = 1 WHERE id = 'b0000000-0000-0000-0000-000000000002'$$,
  '42501', 'customer cannot change the price');
SELECT tests.throws($$UPDATE public.bookings SET driver_confirmation = true WHERE id = 'b0000000-0000-0000-0000-000000000002'$$,
  '42501', 'customer cannot confirm for the driver');
SELECT tests.throws($$UPDATE public.bookings SET customer_confirmation = true WHERE id = 'b0000000-0000-0000-0000-000000000002'$$,
  '42501', 'customer cannot confirm completion before the job is completed');
SELECT tests.ok((SELECT count(*) FROM public.bookings WHERE id = :other) = 0,
  'customer cannot see another customer''s booking');
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET status = 'cancelled' WHERE id = 'b0000000-0000-0000-0000-000000000001'$$) = 1,
  'customer can cancel a pending booking');
ROLLBACK;

-- ── Dispatch and money functions are not for customers ──────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.dispatch_assign_best_driver('b0000000-0000-0000-0000-000000000002')$$,
  '42501', 'customer cannot run dispatch');
SELECT tests.throws($$SELECT public.reclaim_stale_dispatches(5)$$,
  '42501', 'customer cannot reclaim dispatches');
SELECT tests.throws($$SELECT * FROM public.dispatch_rank_candidates('b0000000-0000-0000-0000-000000000002')$$,
  '42501', 'customer cannot rank drivers');
SELECT tests.throws($$SELECT public.dispatch_assign_best_driver_internal('b0000000-0000-0000-0000-000000000002')$$,
  '42501', 'customer cannot call the internal dispatch');
SELECT tests.throws($$SELECT public.increment_driver_wallet('d1000000-0000-0000-0000-000000000001', 1000)$$,
  '42501', 'customer cannot credit a wallet');
SELECT tests.throws($$SELECT public.admin_release_escrow('b0000000-0000-0000-0000-000000000002')$$,
  '42501', 'customer cannot release escrow');
ROLLBACK;

-- ── Tables that had no RLS ─────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT count(*) FROM public.driver_wallets) = 0,   'anon reads no wallets');
SELECT tests.ok((SELECT count(*) FROM public.platform_config) = 0,  'anon reads no platform_config');
SELECT tests.ok((SELECT count(*) FROM public.escrow_payments) = 0,  'anon reads no escrow');
SELECT tests.ok((SELECT count(*) FROM public.profiles) = 0,         'anon reads no profiles');
SELECT tests.ok(tests.rows($$UPDATE public.platform_config SET config_value = '0'$$) = 0, 'anon changes no platform_config row');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM public.driver_wallets) = 0,   'customer reads no wallets');
SELECT tests.ok((SELECT count(*) FROM public.admin_accounts) = 0,   'customer reads no admin accounts');
SELECT tests.ok((SELECT count(*) FROM public.escrow_payments) = 1,  'customer reads only their own escrow');
ROLLBACK;

-- ── Drivers: pool, claim and the job ───────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.bookings WHERE id = :paid) = 1,   'driver sees a paid unassigned job');
SELECT tests.ok((SELECT count(*) FROM public.bookings WHERE id = :unpaid) = 0, 'driver does not see an unpaid job');
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET driver_id = 'd1000000-0000-0000-0000-000000000001', status = 'driver_assigned'
                              WHERE id = 'b0000000-0000-0000-0000-000000000001' AND driver_id IS NULL$$) = 0,
  'driver cannot claim an unpaid job');
SELECT tests.throws($$UPDATE public.bookings SET driver_id = 'd1000000-0000-0000-0000-000000000002', status = 'driver_assigned'
                      WHERE id = 'b0000000-0000-0000-0000-000000000002'$$,
  NULL, 'driver cannot assign a job to someone else');
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET driver_id = 'd1000000-0000-0000-0000-000000000001', status = 'driver_assigned'
                              WHERE id = 'b0000000-0000-0000-0000-000000000002' AND driver_id IS NULL$$) = 1,
  'driver claims a paid job');
SELECT tests.throws($$UPDATE public.bookings SET price_estimate = 99999 WHERE id = 'b0000000-0000-0000-0000-000000000002'$$,
  '42501', 'driver cannot change the price');
SELECT tests.throws($$UPDATE public.bookings SET payment_status = 'released' WHERE id = 'b0000000-0000-0000-0000-000000000002'$$,
  '42501', 'driver cannot release payment');
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET status = 'in_transit', start_time = now() WHERE id = 'b0000000-0000-0000-0000-000000000002'$$) = 1,
  'driver starts the job');
SELECT tests.throws($$UPDATE public.bookings SET driver_confirmation = true WHERE id = 'b0000000-0000-0000-0000-000000000002'$$,
  '42501', 'driver cannot confirm before completing');
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET status = 'completed', end_time = now() WHERE id = 'b0000000-0000-0000-0000-000000000002'$$) = 1,
  'driver completes the job');
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET driver_confirmation = true WHERE id = 'b0000000-0000-0000-0000-000000000002'$$) = 1,
  'driver confirms completion');

SELECT tests.login(:drv2);
SELECT tests.ok((SELECT count(*) FROM public.bookings WHERE id = :paid) = 0, 'another driver no longer sees the claimed job');

SELECT tests.login(:cust1);
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET customer_confirmation = true WHERE id = 'b0000000-0000-0000-0000-000000000002'$$) = 1,
  'customer confirms a completed job');
ROLLBACK;

-- ── Escrow rows ────────────────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
INSERT INTO public.escrow_payments (booking_id, status, amount, driver_earning)
VALUES ('b0000000-0000-0000-0000-000000000001', 'released', 1, 99999);
SELECT tests.ok((SELECT status = 'held' AND amount = 2875 AND driver_earning IS NULL
                   FROM public.escrow_payments WHERE booking_id = :unpaid),
  'customer escrow insert: held, amount from the booking, no earning');
SELECT tests.throws($$INSERT INTO public.escrow_payments (booking_id, status) VALUES ('b0000000-0000-0000-0000-000000000001', 'held')$$,
  '23505', 'only one escrow row per booking');
SELECT tests.throws($$UPDATE public.escrow_payments SET status = 'escrow' WHERE booking_id = 'b0000000-0000-0000-0000-000000000001'$$,
  '42501', 'customer cannot change escrow status');
ROLLBACK;

-- ── Driver subscriptions, payouts, profile, applications ──────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.throws($$INSERT INTO public.driver_subscriptions (driver_id, plan, subscription_status) VALUES ('d0000000-0000-0000-0000-000000000001', 'unlimited', 'active')$$,
  '42501', 'driver cannot give themselves a paid plan');
SELECT tests.ok(tests.rows($$INSERT INTO public.driver_subscriptions (driver_id, plan, subscription_status) VALUES ('d0000000-0000-0000-0000-000000000001', 'free', 'active')$$) = 1,
  'driver can start the free plan');
SELECT tests.throws($$SELECT public.change_driver_subscription('d0000000-0000-0000-0000-000000000001', 'unlimited')$$,
  '42501', 'change_driver_subscription refuses a paid plan for the driver');
SELECT tests.throws($$SELECT public.change_driver_subscription('d0000000-0000-0000-0000-000000000002', 'free')$$,
  '42501', 'change_driver_subscription refuses another driver');
SELECT public.change_driver_subscription(:drv1, 'basic');
SELECT tests.ok((SELECT count(*) FROM public.driver_subscriptions WHERE driver_id = :drv1 AND subscription_status = 'active') = 1,
  'driver switches to basic');
SELECT tests.throws($$INSERT INTO public.payout_requests (driver_id, amount) VALUES ('d1000000-0000-0000-0000-000000000001', 5000)$$,
  '22023', 'payout above the wallet balance is refused');
SELECT tests.ok(tests.rows($$INSERT INTO public.payout_requests (driver_id, amount, status) VALUES ('d1000000-0000-0000-0000-000000000001', 500, 'paid')$$) = 1,
  'payout within the balance is accepted');
SELECT tests.ok((SELECT status FROM public.payout_requests WHERE driver_id = :dp1) = 'pending', 'payout starts pending');
SELECT tests.throws($$UPDATE public.driver_profiles SET status = 'approved', rating = 5 WHERE user_id = 'd0000000-0000-0000-0000-000000000001'$$,
  '42501', 'driver cannot edit their rating or status');
SELECT tests.ok(tests.rows($$UPDATE public.driver_profiles SET online = false WHERE user_id = 'd0000000-0000-0000-0000-000000000001'$$) = 1,
  'driver toggles online');
SELECT tests.ok((SELECT count(*) FROM public.driver_wallets) = 1, 'driver reads their own wallet');
SELECT tests.login(:applic);
SELECT tests.throws($$UPDATE public.driver_applications SET status = 'approved' WHERE user_id = 'e0000000-0000-0000-0000-000000000001'$$,
  '42501', 'applicant cannot approve their own application');
ROLLBACK;

-- ── Live location ──────────────────────────────────────────────────────────
BEGIN;
UPDATE public.bookings SET driver_id = :dp1, status = 'in_transit' WHERE id = :paid;
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
INSERT INTO public.driver_locations (driver_id, lat, lng) VALUES (:drv1, 59.92, 10.76);
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM public.driver_locations WHERE driver_id = :drv1) = 1,
  'customer sees the driver of their in-flight booking');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT count(*) FROM public.driver_locations) = 0,
  'other customers see no driver locations');
ROLLBACK;

-- ── Admin and service role ─────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT tests.ok((public.dispatch_assign_best_driver(:other)) ? 'success', 'admin runs dispatch');
SELECT tests.ok(public.reclaim_stale_dispatches(5) >= 0, 'admin reclaims stale dispatches');
UPDATE public.bookings SET driver_id = :dp1, status = 'completed' WHERE id = :paid;
SELECT public.admin_release_escrow(:paid);
SELECT tests.ok((SELECT balance FROM public.driver_wallets WHERE driver_id = :dp1) = 1000 + 2875,
  'admin release credits the booking price once');
SELECT tests.throws($$SELECT public.admin_release_escrow('b0000000-0000-0000-0000-000000000002')$$,
  NULL, 'second release is refused');
SELECT tests.ok((SELECT balance FROM public.driver_wallets WHERE driver_id = :dp1) = 1000 + 2875,
  'wallet unchanged after the refused second release');
SELECT tests.ok((SELECT count(*) FROM public.driver_wallet_transactions WHERE booking_id = :paid) = 1,
  'one ledger row for the release');
SELECT tests.throws($$SELECT public.admin_release_escrow('b0000000-0000-0000-0000-000000000001')$$,
  NULL, 'release without a captured payment is refused');
ROLLBACK;

BEGIN;
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
UPDATE public.bookings SET payment_status = 'pending' WHERE id = :other;
UPDATE public.bookings SET payment_status = 'paid' WHERE id = :other;
SELECT tests.ok((SELECT count(*) FROM public.dispatch_logs WHERE booking_id = :other) >= 1,
  'payment capture by the service role still triggers dispatch');
-- process-payment's release: status + driver_earning → credited once.
UPDATE public.bookings SET driver_id = :dp1 WHERE id = :paid;
UPDATE public.escrow_payments SET status = 'released', released_at = now(), driver_earning = 2300, commission_amount = 575
 WHERE booking_id = :paid AND driver_earning IS NULL;
UPDATE public.escrow_payments SET refund_amount = 0 WHERE booking_id = :paid;
SELECT tests.ok((SELECT balance FROM public.driver_wallets WHERE driver_id = :dp1) = 1000 + 2300,
  'settlement credits the wallet once, not on later updates');
ROLLBACK;

-- A released row without earning (production's confirmation trigger) is
-- not paid until process-payment sets the earning, and never nulls the balance.
BEGIN;
UPDATE public.bookings SET driver_id = :dp1 WHERE id = :paid;
UPDATE public.escrow_payments SET status = 'released' WHERE booking_id = :paid;
SELECT tests.ok((SELECT balance FROM public.driver_wallets WHERE driver_id = :dp1) = 1000,
  'release without earning credits nothing and keeps the balance');
UPDATE public.escrow_payments SET driver_earning = 2300 WHERE booking_id = :paid AND driver_earning IS NULL;
SELECT tests.ok((SELECT balance FROM public.driver_wallets WHERE driver_id = :dp1) = 1000 + 2300,
  'earning set later credits once');
ROLLBACK;

\echo 'p0_security: all tests passed'
