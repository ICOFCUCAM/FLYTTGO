-- ============================================================================
-- The migrations against production's own schema, triggers and functions
-- (the verified replica supabase/schema/production-2026-10-29.sql).
-- Run with supabase/tests/run.sh (variant "production").
-- ============================================================================

\set ON_ERROR_STOP 1
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''
\set dp1     '''d1000000-0000-0000-0000-000000000001'''
\set paid    '''b0000000-0000-0000-0000-000000000002'''

-- Both parties confirm: production's confirmation trigger releases the
-- escrow without failing on the new guards, and pays nothing yet
-- (driver_earning not set) instead of nulling the wallet.
BEGIN;
UPDATE public.bookings SET driver_id = :dp1, status = 'completed', start_time = now() - interval '2 hours',
       end_time = now() WHERE id = :paid;
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET driver_confirmation = true WHERE id = 'b0000000-0000-0000-0000-000000000002'$$) = 1,
  'driver confirms with production triggers in place');
SELECT tests.login(:cust1);
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET customer_confirmation = true WHERE id = 'b0000000-0000-0000-0000-000000000002'$$) = 1,
  'customer confirms with production triggers in place');
RESET ROLE;
SELECT tests.ok((SELECT status FROM public.escrow_payments WHERE booking_id = :paid) = 'released',
  'production confirmation trigger released the escrow');
SELECT tests.ok((SELECT balance FROM public.driver_wallets WHERE driver_id = :dp1) = 1000,
  'wallet untouched and not NULL while driver_earning is unset');
-- process-payment then settles it.
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
UPDATE public.escrow_payments SET driver_earning = 2300, commission_amount = 575
 WHERE booking_id = :paid AND driver_earning IS NULL;
UPDATE public.escrow_payments SET released_at = now() WHERE booking_id = :paid;
RESET ROLE;
SELECT tests.ok((SELECT balance FROM public.driver_wallets WHERE driver_id = :dp1) = 1000 + 2300,
  'settled once, not again on a later update of the released row');
ROLLBACK;

-- Production's change_driver_subscription keeps working behind the guard.
BEGIN;
INSERT INTO public.corporate_accounts (company_name, api_key) VALUES ('Test AS', 'secret-key');
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT public.change_driver_subscription(:drv1, 'free');
SELECT tests.ok((SELECT count(*) FROM public.driver_subscriptions WHERE driver_id = :drv1 AND subscription_status = 'active') = 1,
  'driver switches to free through production''s function');
SELECT tests.throws($$SELECT public.change_driver_subscription('d0000000-0000-0000-0000-000000000001', 'Unlimited')$$,
  '42501', 'production function no longer gives a driver a paid plan');
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.throws($$SELECT public.change_driver_subscription('d0000000-0000-0000-0000-000000000001', 'free')$$,
  '42501', 'anon can no longer change a driver''s plan');
SELECT tests.throws($$SELECT public.change_driver_subscription_internal('d0000000-0000-0000-0000-000000000001', 'Unlimited')$$,
  '42501', 'anon cannot reach the internal function');
SELECT tests.ok((SELECT count(*) FROM public.corporate_accounts) = 0,
  'production-only tables (corporate_accounts.api_key) are closed to anon');
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.corporate_accounts) = 0,
  'and to signed-in users');
ROLLBACK;

-- The customer approving an over-time adjustment still updates escrow.
BEGIN;
UPDATE public.escrow_payments SET adjusted_amount = 3500, adjustment_required = true, adjustment_approved = false
 WHERE booking_id = :paid;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok(tests.rows($$UPDATE public.escrow_payments SET adjustment_approved = true WHERE booking_id = 'b0000000-0000-0000-0000-000000000002'$$) = 1,
  'customer approves an adjustment');
RESET ROLE;
SELECT tests.ok((SELECT amount FROM public.escrow_payments WHERE booking_id = :paid) = 3500,
  'production capture trigger applied the adjusted amount');
ROLLBACK;

-- Approving a driver works (production's driver_profiles triggers wrote
-- the user id into tables keyed to drivers(id); 00002 re-points them).
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('d0000000-0000-0000-0000-000000000009', 'new-driver@test');
SET LOCAL ROLE authenticated;
SELECT tests.login('a0000000-0000-0000-0000-000000000001');
SELECT tests.ok(tests.rows($$INSERT INTO public.driver_profiles (user_id, full_name, status, online)
                              VALUES ('d0000000-0000-0000-0000-000000000009', 'New Driver', 'approved', false)$$) = 1,
  'an administrator approves a driver (driver_profiles insert)');
RESET ROLE;
SELECT tests.ok((SELECT count(*) FROM public.driver_metrics WHERE driver_id = 'd0000000-0000-0000-0000-000000000009') = 1
            AND (SELECT count(*) FROM public.driver_verification WHERE driver_id = 'd0000000-0000-0000-0000-000000000009') = 1
            AND (SELECT count(*) FROM public.vehicles WHERE driver_id = 'd0000000-0000-0000-0000-000000000009') = 1,
  'production''s metrics, verification and vehicle rows are created');
-- (production's create_driver_wallet() is not attached to any trigger;
-- the wallet is created by the first settlement, keyed by profile id.)
SELECT tests.ok((SELECT count(*) FROM public.driver_wallets WHERE driver_id = 'd0000000-0000-0000-0000-000000000009') = 0,
  'no wallet is created under the user id');
ROLLBACK;

-- Expiry and documents as the app writes them.
BEGIN;
UPDATE public.driver_subscriptions SET end_date = now() - interval '1 day'
 WHERE driver_id = 'd0000000-0000-0000-0000-000000000001' AND subscription_status = 'active';
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.ok(tests.rows($$UPDATE public.driver_subscriptions SET subscription_status = 'expired'
                              WHERE driver_id = 'd0000000-0000-0000-0000-000000000001' AND subscription_status = 'active'$$) = 1,
  'a lapsed subscription can be marked expired (production CHECK allows it now)');
SELECT public.change_driver_subscription(:drv1, 'free');
SELECT tests.ok((SELECT public.plan_slug(sp.name) FROM public.driver_subscriptions ds JOIN public.subscription_plans sp ON sp.id = ds.plan_id
                  WHERE ds.driver_id = :drv1 AND ds.subscription_status = 'active') = 'free',
  'the driver drops to the free plan');
ROLLBACK;

\echo 'p0_production: all tests passed'
