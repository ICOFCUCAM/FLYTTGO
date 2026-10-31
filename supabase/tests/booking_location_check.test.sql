-- ============================================================================
-- The server's check of a booking's points is the server's alone
-- (supabase/migrations/00028_booking_location_check.sql)
-- Each block runs in its own transaction and rolls back.
-- Uses the customer and bookings of p0_security.test.sql.
-- ============================================================================

\set ON_ERROR_STOP 1
\set cust1   '''c0000000-0000-0000-0000-000000000001'''

BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
INSERT INTO public.bookings (id, customer_id, price_estimate, location_check)
VALUES ('b0000000-0000-0000-0000-0000000000ab', 'c0000000-0000-0000-0000-000000000001', 1000,
        '{"pickup":{"status":"confirmed"},"dropoff":{"status":"confirmed"}}');
SELECT tests.ok((SELECT location_check IS NULL FROM public.bookings WHERE id = 'b0000000-0000-0000-0000-0000000000ab'),
  'a customer''s insert cannot set the location check');
SELECT tests.throws($$UPDATE public.bookings SET location_check = '{"pickup":{"status":"confirmed"}}' WHERE id = 'b0000000-0000-0000-0000-000000000001'$$,
  '42501', 'nor can a customer change it on their booking');
ROLLBACK;

BEGIN;
-- The service role (the payment functions) writes it.
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
SELECT tests.ok(tests.rows($$UPDATE public.bookings SET location_check = '{"pickup":{"status":"corrected","off_km":42.1}}' WHERE id = 'b0000000-0000-0000-0000-000000000001'$$) = 1,
  'the payment functions record the check');
RESET ROLE;
SELECT tests.ok((SELECT location_check -> 'pickup' ->> 'status' = 'corrected' FROM public.bookings WHERE id = 'b0000000-0000-0000-0000-000000000001'),
  'the check is kept on the booking');
ROLLBACK;

-- ── Rollback: the column and its trigger go ──
BEGIN;
\i supabase/rollback/00028_down.sql
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'location_check'),
  'the rollback drops the column');
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bookings_clear_location_check'), 'and its trigger');
ROLLBACK;
