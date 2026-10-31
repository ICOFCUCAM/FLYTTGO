-- ============================================================================
-- Short booking reference and the public tracking lookup
-- (supabase/migrations/00029_booking_reference_tracking.sql)
-- Each block runs in its own transaction and rolls back.
-- Uses the customers and bookings of p0_security.test.sql / helpers.sql.
-- ============================================================================

\set ON_ERROR_STOP 1
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set unpaid  '''b0000000-0000-0000-0000-000000000001'''

-- ── Every booking has one, in the right shape, unique ──
BEGIN;
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.bookings WHERE booking_ref IS NULL), 'existing bookings were given a reference');
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.bookings WHERE booking_ref !~ '^FG-[2-9A-HJKMNP-Z]{6}$'),
  'references read FG- and six characters without 0, O, 1, I or L');
SELECT tests.ok((SELECT count(*) = count(DISTINCT booking_ref) FROM public.bookings), 'references are unique');
SELECT tests.ok((SELECT count(DISTINCT public.new_booking_ref()) FROM generate_series(1, 200)) = 200, 'new references do not repeat');
ROLLBACK;

-- ── A customer cannot choose or change it ──
BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
INSERT INTO public.bookings (id, customer_id, price_estimate, booking_ref)
VALUES ('b0000000-0000-0000-0000-0000000000ac', 'c0000000-0000-0000-0000-000000000001', 1000, 'FG-AAAAAA');
SELECT tests.ok((SELECT booking_ref <> 'FG-AAAAAA' AND booking_ref ~ '^FG-' FROM public.bookings WHERE id = 'b0000000-0000-0000-0000-0000000000ac'),
  'a customer''s insert gets a generated reference, not the one it sent');
SELECT tests.throws($$UPDATE public.bookings SET booking_ref = 'FG-BBBBBB' WHERE id = 'b0000000-0000-0000-0000-000000000001'$$,
  '42501', 'nor can a customer change it');
ROLLBACK;

-- ── The public lookup shows status and towns only, to anyone holding the reference ──
BEGIN;
UPDATE public.bookings SET pickup_city = 'Oslo', dropoff_city = 'Bergen', pickup_address = 'Storgata 1, 0155 Oslo',
       customer_phone = '+47 400 00 000' WHERE id = :unpaid;
CREATE TEMP TABLE t_ref ON COMMIT DROP AS SELECT booking_ref AS ref FROM public.bookings WHERE id = :unpaid;
GRANT SELECT ON t_ref TO anon, authenticated;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT public.track_booking(ref) ->> 'pickup_city' FROM t_ref) = 'Oslo', 'a visitor finds the booking by its reference');
SELECT tests.ok((SELECT public.track_booking(lower(replace(ref, 'FG-', ' fg '))) IS NOT NULL FROM t_ref),
  'with or without FG-, spaces and in any case');
SELECT tests.ok((SELECT NOT (public.track_booking(ref) ?| ARRAY['pickup_address','customer_phone','customer_email','customer_name','price_estimate','driver_id'])
                    AND (public.track_booking(ref) ->> 'booking_id') IS NULL
                    AND (public.track_booking(ref) ->> 'is_owner')::boolean = false FROM t_ref),
  'and sees no address, contact, price, driver or booking id');
SELECT tests.ok(public.track_booking('FG-ZZZZZZ') IS NULL AND public.track_booking('nonsense') IS NULL AND public.track_booking(NULL) IS NULL,
  'an unknown or malformed reference finds nothing');
SELECT tests.ok((SELECT count(*) FROM public.bookings) = 0, 'the visitor still reads no bookings directly');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT (public.track_booking(ref) ->> 'is_owner')::boolean AND (public.track_booking(ref) ->> 'booking_id')::uuid = :unpaid FROM t_ref),
  'the booking''s own customer also gets the booking id');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT NOT (public.track_booking(ref) ->> 'is_owner')::boolean AND (public.track_booking(ref) ->> 'booking_id') IS NULL FROM t_ref),
  'another customer does not');
ROLLBACK;

-- ── Rollback ──
BEGIN;
\i supabase/rollback/00029_down.sql
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'booking_ref')
  AND to_regprocedure('public.track_booking(text)') IS NULL, 'the rollback removes the reference and the lookup');
ROLLBACK;
