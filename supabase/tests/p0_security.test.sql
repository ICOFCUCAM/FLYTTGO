-- ============================================================================
-- P0 security tests (supabase/migrations/00003_p0_security_hardening.sql)
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

-- ── Drivers: the pool shows no customer details; claiming ─────────────────
BEGIN;
UPDATE public.bookings SET customer_name = 'Kari Nordmann', customer_phone = '+4712345678',
       customer_email = 'kari@test', customer_notes = 'door code 1234',
       pickup_address = 'Storgata 1, 0155 Oslo', pickup_postcode = '0155', pickup_city = 'Oslo'
 WHERE id = :paid;
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.bookings WHERE id = :paid) = 0,
  'driver cannot read an unassigned job from the bookings table');
SELECT tests.ok((SELECT count(*) FROM public.driver_job_pool() WHERE id = :paid) = 1,
  'driver sees a paid unassigned job in the pool');
SELECT tests.ok((SELECT count(*) FROM public.driver_job_pool() WHERE id = :unpaid) = 0,
  'the pool has no unpaid jobs');
SELECT tests.ok((SELECT pickup_address FROM public.driver_job_pool() WHERE id = :paid) = '0155 Oslo',
  'the pool shows the area, not the street address');
SELECT tests.ok(NOT (SELECT row_to_json(p)::text FROM public.driver_job_pool() p WHERE id = :paid)
                    ~* '(Kari|12345678|kari@test|door code|Storgata)',
  'the pool carries no customer name, phone, email, notes or street');
SELECT tests.ok((SELECT pickup_lat FROM public.driver_job_pool() WHERE id = :paid) = 59.91,
  'pool coordinates are rounded');
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET driver_id = 'd1000000-0000-0000-0000-000000000001', status = 'driver_assigned'
                              WHERE id = 'b0000000-0000-0000-0000-000000000002'$$) = 0,
  'driver cannot claim by writing the table');
SELECT tests.ok(public.claim_job(:paid), 'driver claims the job with claim_job()');
SELECT tests.ok((SELECT customer_phone FROM public.bookings WHERE id = :paid) = '+4712345678',
  'after claiming, the driver sees the customer''s contact details');
SELECT tests.ok(NOT public.claim_job(:paid), 'a claimed job cannot be claimed again');
SELECT tests.ok(NOT public.claim_job(:unpaid), 'claim_job refuses an unpaid job');
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
SELECT tests.ok((SELECT count(*) FROM public.bookings WHERE id = :paid) = 0, 'another driver does not see the claimed job');
SELECT tests.ok((SELECT count(*) FROM public.driver_job_pool() WHERE id = :paid) = 0, 'the claimed job left the pool');
SELECT tests.throws($$SELECT public.claim_job('b0000000-0000-0000-0000-000000000003')$$,
  '42501', 'a driver without a paid plan cannot take a job above 500 NOK');

SELECT tests.login(:cust1);
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET customer_confirmation = true WHERE id = 'b0000000-0000-0000-0000-000000000002'$$) = 1,
  'customer confirms a completed job');
SELECT tests.ok((SELECT count(*) FROM public.driver_job_pool()) = 0, 'customers see no pool');
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

-- ── Driver subscriptions (plan_id), payouts, profile, applications ────────
BEGIN;
SELECT tests.ok((SELECT public.plan_slug(sp.name) FROM public.driver_subscriptions ds
                   JOIN public.subscription_plans sp ON sp.id = ds.plan_id
                  WHERE ds.driver_id = :drv1 AND ds.subscription_status = 'active') = 'pro',
  'fixture: driver 1 is on Pro by plan_id');
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.throws(format($$INSERT INTO public.driver_subscriptions (driver_id, plan_id, subscription_status)
                             VALUES ('d0000000-0000-0000-0000-000000000001', %L, 'active')$$, tests.plan_id('unlimited')),
  '42501', 'driver cannot give themselves a paid plan');
SELECT tests.throws($$SELECT public.change_driver_subscription('d0000000-0000-0000-0000-000000000001', 'unlimited')$$,
  '42501', 'change_driver_subscription refuses a paid plan for the driver');
SELECT tests.throws($$SELECT public.change_driver_subscription('d0000000-0000-0000-0000-000000000002', 'free')$$,
  '42501', 'change_driver_subscription refuses another driver');
SELECT tests.throws($$SELECT public.change_driver_subscription('d0000000-0000-0000-0000-000000000001', 'platinum')$$,
  NULL, 'an unknown plan is refused');
SELECT public.change_driver_subscription(:drv1, 'basic');
SELECT tests.ok((SELECT public.plan_slug(sp.name) FROM public.driver_subscriptions ds
                   JOIN public.subscription_plans sp ON sp.id = ds.plan_id
                  WHERE ds.driver_id = :drv1 AND ds.subscription_status = 'active') = 'basic',
  'driver switches to basic; plan_id points at Basic');
SELECT tests.ok((SELECT count(*) FROM public.driver_subscriptions WHERE driver_id = :drv1 AND subscription_status = 'active') = 1,
  'one active subscription');
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
SELECT tests.ok(tests.rows($$INSERT INTO public.driver_documents (driver_id, document_type, file_url, verification_status)
                              VALUES ('e0000000-0000-0000-0000-000000000001', 'identity_document', 'e0000000-0000-0000-0000-000000000001/identity_document.pdf', 'approved')$$) = 1,
  'applicant uploads an identity_document');
SELECT tests.ok((SELECT verification_status FROM public.driver_documents WHERE driver_id = :applic) = 'pending',
  'an uploaded document starts pending');
ROLLBACK;

-- Admins assign any plan by slug; 'pro_mini' resolves to 'Pro Mini'.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT public.change_driver_subscription(:drv2, 'pro_mini');
SELECT tests.ok((SELECT sp.name FROM public.driver_subscriptions ds JOIN public.subscription_plans sp ON sp.id = ds.plan_id
                  WHERE ds.driver_id = :drv2 AND ds.subscription_status = 'active') = 'Pro Mini',
  'admin assigns Pro Mini by slug');
ROLLBACK;

-- ── Live location ──────────────────────────────────────────────────────────
BEGIN;
SELECT tests.ok(EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'driver_locations'),
  'driver_locations is in the realtime publication');
UPDATE public.bookings SET driver_id = :dp1, status = 'in_transit' WHERE id = :paid;
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
INSERT INTO public.driver_locations (driver_id, lat, lng) VALUES (:drv1, 59.92, 10.76)
  ON CONFLICT (driver_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng;
INSERT INTO public.driver_locations (driver_id, lat, lng) VALUES (:drv1, 59.93, 10.77)
  ON CONFLICT (driver_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, updated_at = now();
SELECT tests.ok((SELECT lat FROM public.driver_locations WHERE driver_id = :drv1) = 59.93, 'the beacon''s upsert updates one row');
SELECT tests.throws($$INSERT INTO public.driver_locations (driver_id, lat, lng) VALUES ('d0000000-0000-0000-0000-000000000002', 1, 1)$$,
  '42501', 'a driver cannot write another driver''s location');
SELECT tests.login(:cust1);
SELECT tests.ok(public.booking_driver_user(:paid) = :drv1, 'the customer resolves the driver of their own in-flight booking');
SELECT tests.ok((SELECT count(*) FROM public.driver_locations WHERE driver_id = :drv1) = 1,
  'customer sees the driver of their in-flight booking');
SELECT tests.ok((SELECT count(*) FROM public.driver_profiles) = 0, 'the customer still cannot read driver profiles');
SELECT tests.login(:cust2);
SELECT tests.ok(public.booking_driver_user(:paid) IS NULL, 'another customer cannot resolve that driver');
SELECT tests.ok((SELECT count(*) FROM public.driver_locations) = 0, 'other customers see no driver locations');
ROLLBACK;

BEGIN;
UPDATE public.bookings SET driver_id = :dp1, status = 'completed' WHERE id = :paid;
INSERT INTO public.driver_locations (driver_id, lat, lng) VALUES (:drv1, 59.92, 10.76);
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok(public.booking_driver_user(:paid) IS NULL AND (SELECT count(*) FROM public.driver_locations) = 0,
  'once the job is completed the customer no longer sees the driver''s location');
ROLLBACK;

-- ── Driver documents in storage ────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM storage.objects WHERE bucket_id = 'driver-documents') = 1, 'driver reads their own document');
SELECT tests.login(:drv2);
SELECT tests.ok((SELECT count(*) FROM storage.objects WHERE bucket_id = 'driver-documents') = 0, 'another driver cannot');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM storage.objects WHERE bucket_id = 'driver-documents') = 0, 'a customer cannot');
SELECT tests.login(:admin);
SELECT tests.ok((SELECT count(*) FROM storage.objects WHERE bucket_id = 'driver-documents') = 1, 'an administrator can (signed URL)');
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT count(*) FROM storage.objects WHERE bucket_id = 'driver-documents') = 0, 'anon cannot');
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

-- ── Refunds (00004) ────────────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.refund_request_begin('b0000000-0000-0000-0000-000000000002', 100, NULL, NULL)$$,
  '42501', 'refund functions are not callable from the browser, even by an admin');
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
SELECT tests.throws($$SELECT public.refund_request_begin('b0000000-0000-0000-0000-000000000002', 100, NULL, NULL)$$,
  '22023', 'a booking without a provider reference cannot be refunded automatically');
UPDATE public.bookings SET payment_provider = 'stripe', payment_intent_id = 'pi_test_1', paid_amount = 2875 WHERE id = :paid;
SELECT tests.throws($$SELECT public.refund_request_begin('b0000000-0000-0000-0000-000000000002', 3000, NULL, NULL)$$,
  '22023', 'a refund above what was paid is refused');
SELECT tests.throws($$SELECT public.refund_request_begin('b0000000-0000-0000-0000-000000000001', 100, NULL, NULL)$$,
  '22023', 'an unpaid booking cannot be refunded');
CREATE TEMP TABLE r1 AS SELECT * FROM public.refund_request_begin(:paid, 2875, :admin, 'test');
CREATE TEMP TABLE r2 AS SELECT * FROM public.refund_request_begin(:paid, 2875, :admin, 'retry');
SELECT tests.ok((SELECT id FROM r1) = (SELECT id FROM r2) AND (SELECT idempotency_key FROM r1) = (SELECT idempotency_key FROM r2),
  'a retry reuses the same refund and idempotency key');
SELECT tests.ok((SELECT attempts FROM public.payment_refunds WHERE id = (SELECT id FROM r1)) = 2, 'attempts are counted');
SELECT tests.ok((SELECT status FROM public.escrow_payments WHERE booking_id = :paid) = 'escrow',
  'nothing changes before the provider confirms');
SELECT public.refund_mark((SELECT id FROM r1), 'pending', 're_1', NULL);
SELECT tests.ok((SELECT status FROM public.escrow_payments WHERE booking_id = :paid) = 'escrow',
  'a pending refund changes nothing yet');
SELECT public.refund_mark((SELECT id FROM r1), 'succeeded', 're_1', NULL);
SELECT tests.ok((SELECT status = 'refunded' AND refund_amount = 2875 FROM public.escrow_payments WHERE booking_id = :paid),
  'on success the escrow is refunded');
SELECT tests.ok((SELECT payment_status FROM public.bookings WHERE id = :paid) = 'refunded', 'a full refund marks the booking refunded');
SELECT public.refund_mark((SELECT id FROM r1), 'succeeded', 're_1', NULL);
SELECT public.refund_mark((SELECT id FROM r1), 'failed', 're_1', 'late webhook');
SELECT tests.ok((SELECT status FROM public.payment_refunds WHERE id = (SELECT id FROM r1)) = 'succeeded',
  'a succeeded refund never moves back');
SELECT tests.throws($$SELECT public.refund_request_begin('b0000000-0000-0000-0000-000000000002', 100, NULL, NULL)$$,
  '23505', 'a refunded booking cannot be refunded again');
ROLLBACK;

-- A refund after the driver was paid takes the driver's earning back, once.
BEGIN;
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
UPDATE public.bookings SET driver_id = :dp1, status = 'completed', payment_provider = 'vipps',
       payment_intent_id = 'booking-test-1', paid_amount = 2875 WHERE id = :paid;
UPDATE public.escrow_payments SET status = 'released', driver_earning = 2300, commission_amount = 575 WHERE booking_id = :paid;
SELECT tests.ok((SELECT balance FROM public.driver_wallets WHERE driver_id = :dp1) = 3300, 'driver was paid 2300');
CREATE TEMP TABLE r3 AS SELECT * FROM public.refund_request_begin(:paid, 1000, NULL, 'partial');
SELECT public.refund_mark((SELECT id FROM r3), 'succeeded', 'psp-1', NULL);
SELECT public.refund_mark((SELECT id FROM r3), 'succeeded', 'psp-1', NULL);
SELECT tests.ok((SELECT balance FROM public.driver_wallets WHERE driver_id = :dp1) = 2300, 'the refund comes back from the driver once');
SELECT tests.ok((SELECT payment_status FROM public.bookings WHERE id = :paid) <> 'refunded', 'a partial refund leaves the booking as it was');
-- A failed refund frees the booking for a new request with a new key.
ROLLBACK;

BEGIN;
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
UPDATE public.bookings SET payment_provider = 'stripe', payment_intent_id = 'pi_test_2', paid_amount = 2875 WHERE id = :paid;
CREATE TEMP TABLE f1 AS SELECT * FROM public.refund_request_begin(:paid, 2875, NULL, NULL);
SELECT public.refund_mark((SELECT id FROM f1), 'failed', NULL, 'card closed');
CREATE TEMP TABLE f2 AS SELECT * FROM public.refund_request_begin(:paid, 2875, NULL, NULL);
SELECT tests.ok((SELECT id FROM f1) <> (SELECT id FROM f2) AND (SELECT idempotency_key FROM f1) <> (SELECT idempotency_key FROM f2),
  'after a failed refund a new request gets a new key');
SELECT tests.ok((SELECT status FROM public.escrow_payments WHERE booking_id = :paid) = 'escrow', 'a failed refund changes nothing');
ROLLBACK;

\echo 'p0_security: all tests passed'
