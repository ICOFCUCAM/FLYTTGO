-- ============================================================================
-- Reservations (supabase/migrations/00019_reservations.sql)
-- Acme is a restaurant (tests.rs_acme) or a hotel (tests.ht_acme); cust1
-- owns it, drv1 is its booker, e…01 works the floor or the desk (staff),
-- cust2 is a guest, drv2 a stranger.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''
\set drv2    '''d0000000-0000-0000-0000-000000000002'''
\set worker  '''e0000000-0000-0000-0000-000000000001'''

-- Acme on Restaurant: 15-minute steps, a year ahead, 60 minutes' notice,
-- parties up to 8 online, turns of 90 (up to 2), 120 (up to 4) and 150
-- minutes, 2 hours' cancellation notice and 200 kr per guest for a
-- no-show. Tables: T1 (2), T2 and T3 (2 each, combinable, together 3–4)
-- and T4 (4, for 3 or more). Lunch 11:30–14:30 and dinner 17:00–22:00
-- (last seating 21:00) every day. Claims kept.
CREATE OR REPLACE FUNCTION tests.rs_acme() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid; v_t2 uuid; v_t3 uuid; v_claims text := current_setting('request.jwt.claims', true);
BEGIN
  v_org := tests.sp_acme('hospitality', 'restaurant');
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (v_org, 'e0000000-0000-0000-0000-000000000001', 'staff');
  PERFORM tests.login('c0000000-0000-0000-0000-000000000001');
  PERFORM public.save_restaurant_settings(v_org, '{"slot_step_minutes":15,"booking_window_days":365,"lead_time_minutes":60,
    "max_party_online":8,"default_turn_minutes":150,"cancel_hours":2,"no_show_fee":200,"no_show_fee_per":"guest","no_show_vat_rate":25,
    "turn_times":[{"up_to_party":2,"minutes":90},{"up_to_party":4,"minutes":120}]}');
  PERFORM public.set_invoice_settings(v_org, '{"legal_name":"Acme Bistro AS","address":"Torget 1","postcode_city":"0150 Oslo","bank_account":"15061234567"}');
  PERFORM public.save_restaurant_table(v_org, NULL, '{"name":"T1","seats":2,"sort":1}');
  SELECT id INTO v_t2 FROM public.save_restaurant_table(v_org, NULL, '{"name":"T2","seats":2,"combinable":true,"sort":2}');
  SELECT id INTO v_t3 FROM public.save_restaurant_table(v_org, NULL, '{"name":"T3","seats":2,"combinable":true,"sort":3}');
  PERFORM public.save_restaurant_table(v_org, NULL, '{"name":"T4","seats":4,"min_seats":3,"sort":4}');
  PERFORM public.save_restaurant_table_group(v_org, NULL, jsonb_build_object('name', 'T2+T3', 'min_seats', 3, 'table_ids', jsonb_build_array(v_t2, v_t3)));
  PERFORM public.save_restaurant_periods(v_org, (SELECT jsonb_agg(p) FROM generate_series(1, 7) d, LATERAL (VALUES
    (jsonb_build_object('weekday', d, 'name', 'Lunch', 'start', '11:30', 'end', '14:30')),
    (jsonb_build_object('weekday', d, 'name', 'Dinner', 'start', '17:00', 'end', '22:00', 'last_seating', '21:00'))) v(p)));
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN v_org;
END $$;
CREATE OR REPLACE FUNCTION tests.rt(p_name text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.restaurant_tables WHERE name = p_name AND organization_id = (SELECT id FROM public.organizations WHERE slug = 'acme');
$$;
CREATE OR REPLACE FUNCTION tests.tables_of(p_reservation uuid) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER AS $$
  SELECT string_agg(t.name, '+' ORDER BY t.name) FROM public.restaurant_reservation_tables rt
    JOIN public.restaurant_tables t ON t.id = rt.table_id WHERE rt.reservation_id = p_reservation;
$$;
-- An Oslo date and time p_days from today, as an instant.
CREATE OR REPLACE FUNCTION tests.rs_at(p_days int, p_time time) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT (((now() AT TIME ZONE 'Europe/Oslo')::date + p_days) + p_time) AT TIME ZONE 'Europe/Oslo';
$$;
CREATE OR REPLACE FUNCTION tests.rs_day(p_days int) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Europe/Oslo')::date + p_days;
$$;
-- The next day (from the day after tomorrow) on which Oslo changes between
-- summer and winter time: a day that is not 24 hours long.
CREATE OR REPLACE FUNCTION tests.next_dst_day() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT d FROM (SELECT tests.rs_day(n) AS d FROM generate_series(2, 360) n) x
   WHERE ((d + 1 + time '00:00') AT TIME ZONE 'Europe/Oslo') - ((d + time '00:00') AT TIME ZONE 'Europe/Oslo') <> interval '24 hours'
   ORDER BY d LIMIT 1;
$$;
-- Whether this transaction holds the advisory lock for p_key.
CREATE OR REPLACE FUNCTION tests.holds_lock(p_key text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted
                    AND l.objsubid = 1 AND l.classid::bigint = ((hashtext(p_key)::bigint >> 32) & 4294967295)
                    AND l.objid::bigint = (hashtext(p_key)::bigint & 4294967295));
$$;
CREATE OR REPLACE FUNCTION tests.rs_contact() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"name":"Kari","phone":"+47 900 00 000","email":"cust2@test"}'::jsonb; $$;

-- Acme on Hotel: 12% MVA (the company's setting), a year ahead, 1–14
-- nights, free cancellation until 3 days before arrival, then 50%. Double
-- (2 guests, 1 120 kr a night: rooms 101 and 102) and Family (4 guests,
-- 2 240 kr: room 201). Claims kept.
CREATE OR REPLACE FUNCTION tests.ht_acme(p_vat boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid; v_double uuid; v_family uuid; v_claims text := current_setting('request.jwt.claims', true);
BEGIN
  v_org := tests.sp_acme('hospitality', 'hotel');
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (v_org, 'e0000000-0000-0000-0000-000000000001', 'staff');
  PERFORM tests.login('c0000000-0000-0000-0000-000000000001');
  PERFORM public.save_hotel_settings(v_org, jsonb_build_object('vat_rate', CASE WHEN p_vat THEN 12 END, 'booking_window_days', 365,
    'lead_days', 0, 'min_nights', 1, 'max_nights', 14, 'free_cancel_days', 3, 'late_cancel_fee_pct', 50));
  PERFORM public.set_invoice_settings(v_org, '{"legal_name":"Acme Hotell AS","address":"Torget 1","postcode_city":"0150 Oslo","bank_account":"15061234567"}');
  SELECT id INTO v_double FROM public.save_hotel_room_type(v_org, NULL, '{"name":"Double","capacity":2,"nightly_price":1120,"sort":1}');
  SELECT id INTO v_family FROM public.save_hotel_room_type(v_org, NULL, '{"name":"Family","capacity":4,"nightly_price":2240,"sort":2}');
  PERFORM public.save_hotel_room(v_org, NULL, jsonb_build_object('name', '101', 'room_type_id', v_double, 'sort', 1));
  PERFORM public.save_hotel_room(v_org, NULL, jsonb_build_object('name', '102', 'room_type_id', v_double, 'sort', 2));
  PERFORM public.save_hotel_room(v_org, NULL, jsonb_build_object('name', '201', 'room_type_id', v_family, 'sort', 3));
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN v_org;
END $$;
CREATE OR REPLACE FUNCTION tests.rtype(p_name text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.hotel_room_types WHERE name = p_name;
$$;
CREATE OR REPLACE FUNCTION tests.room(p_name text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.hotel_rooms WHERE name = p_name;
$$;
CREATE OR REPLACE FUNCTION tests.room_of(p_stay uuid) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER AS $$
  SELECT r.name FROM public.hotel_stays s JOIN public.hotel_rooms r ON r.id = s.room_id WHERE s.id = p_stay;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── Plans and modules ──────────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT modules FROM public.white_label_plans WHERE code = 'restaurant') = ARRAY['restaurant_reservations', 'sales_invoicing']
                AND (SELECT modules FROM public.white_label_plans WHERE code = 'hotel') = ARRAY['hotel_reservations', 'sales_invoicing']
                AND (SELECT bool_and(seller_model = 'company' AND industries = ARRAY['hospitality']) FROM public.white_label_plans
                      WHERE code IN ('restaurant', 'hotel')),
  'Restaurant and Hotel are public plans for hospitality, the company selling');
RESET ROLE;
SELECT tests.throws($$UPDATE public.white_label_plans SET modules = ARRAY['hotel_reservations'] WHERE code = 'branded'$$, '23514',
  'a plan where FlyttGo sells cannot carry a reservation module');
ROLLBACK;

-- ── Restaurant: free times, Oslo time and DST, fitting the party ───────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.rs_acme() AS id;
GRANT SELECT ON o TO anon, service_role;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT count(*) FROM public.available_restaurant_times((SELECT id FROM o), tests.rs_day(3), 2)) = 24,
  'visitors see 24 times for two: lunch 11:30–13:00 (a 90-minute turn before 14:30) and dinner 17:00–21:00');
SELECT tests.ok((SELECT min(starts_at) FROM public.available_restaurant_times((SELECT id FROM o), tests.rs_day(3), 2)) = tests.rs_at(3, '11:30'),
  'the times are Oslo clock times');
SELECT tests.ok((SELECT bool_and(ends_at - starts_at = interval '90 minutes') FROM public.available_restaurant_times((SELECT id FROM o), tests.rs_day(3), 2))
                AND (SELECT bool_and(ends_at - starts_at = interval '120 minutes') FROM public.available_restaurant_times((SELECT id FROM o), tests.rs_day(3), 4)),
  'the turn follows the party size');
SELECT tests.ok((SELECT count(*) FROM public.available_restaurant_times((SELECT id FROM o), tests.rs_day(3), 9)) = 0,
  'a party above the online maximum is asked to call');
SELECT tests.ok((SELECT count(*) FROM public.available_restaurant_times((SELECT id FROM o), tests.rs_day(400), 2)) = 0
                AND (SELECT count(*) FROM public.available_restaurant_times((SELECT id FROM o), tests.rs_day(-1), 2)) = 0,
  'nothing beyond the booking window or in the past');
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.available_restaurant_times((SELECT id FROM o), tests.rs_day(0), 2) WHERE starts_at < now() + interval '60 minutes'),
  'nothing within the lead time today');
SELECT tests.ok((SELECT count(*) FROM public.available_restaurant_times((SELECT id FROM o), tests.next_dst_day(), 2)) = 24
                AND (SELECT min(starts_at) AT TIME ZONE 'Europe/Oslo' FROM public.available_restaurant_times((SELECT id FROM o), tests.next_dst_day(), 2))
                    = tests.next_dst_day() + time '11:30'
                AND (SELECT min(starts_at) FROM public.available_restaurant_times((SELECT id FROM o), tests.next_dst_day(), 2))
                  - (SELECT min(starts_at) FROM public.available_restaurant_times((SELECT id FROM o), tests.next_dst_day() - 1, 2)) <> interval '24 hours',
  'on the day the clocks change the times keep their clock times (the UTC instants move by an hour)');
SELECT tests.throws($$SELECT * FROM public.restaurant_tables$$, '42501', 'visitors do not see the floor plan');
SELECT tests.throws($$SELECT public.book_restaurant_table((SELECT id FROM o), tests.rs_at(3, '19:00'), 2, tests.rs_contact(), NULL)$$, '42501',
  'visitors sign in to book');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust2);
CREATE TEMP TABLE r1 ON COMMIT DROP AS SELECT * FROM public.book_restaurant_table((SELECT id FROM o), tests.rs_at(3, '19:00'), 2, tests.rs_contact(), 'nut allergy');
GRANT SELECT ON r1 TO service_role;
SELECT tests.ok((SELECT number FROM r1) = 1 AND (SELECT period FROM r1) = 'Dinner' AND (SELECT notes FROM r1) = 'nut allergy'
                AND (SELECT ends_at - starts_at FROM r1) = interval '90 minutes' AND tests.tables_of((SELECT id FROM r1)) = 'T1',
  'the guest books 19:00 for two: the smallest fitting table, the note in their own words');
SELECT tests.ok((SELECT no_show_fee FROM r1) = 400 AND (SELECT no_show_vat_rate FROM r1) = 25,
  'the no-show fee stated before the booking is copied onto it (200 kr a guest)');
SELECT tests.ok(tests.holds_lock('restaurant:' || (SELECT id FROM o)::text), 'booking took the restaurant''s lock');
SELECT tests.ok(tests.tables_of((SELECT id FROM public.book_restaurant_table((SELECT id FROM o), tests.rs_at(3, '19:00'), 2, tests.rs_contact(), NULL))) = 'T2',
  'the next party of two gets T2');
SELECT tests.ok(tests.tables_of((SELECT id FROM public.book_restaurant_table((SELECT id FROM o), tests.rs_at(3, '19:00'), 2, tests.rs_contact(), NULL))) = 'T3',
  'and the one after T3');
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.available_restaurant_times((SELECT id FROM o), tests.rs_day(3), 2) WHERE starts_at = tests.rs_at(3, '19:00')),
  '19:00 is no longer offered for two (T4 is for three or more)');
SELECT tests.throws($$SELECT public.book_restaurant_table((SELECT id FROM o), tests.rs_at(3, '19:00'), 2, tests.rs_contact(), NULL)$$, '55000',
  'and cannot be booked');
SELECT tests.ok(tests.tables_of((SELECT id FROM public.book_restaurant_table((SELECT id FROM o), tests.rs_at(3, '19:00'), 3, tests.rs_contact(), NULL))) = 'T4',
  'a party of three gets T4');
SELECT tests.ok(EXISTS (SELECT 1 FROM public.available_restaurant_times((SELECT id FROM o), tests.rs_day(3), 2) WHERE starts_at = tests.rs_at(3, '20:30')),
  'the tables are free again when the turn ends (20:30)');
SELECT tests.throws($$SELECT public.book_restaurant_table((SELECT id FROM o), tests.rs_at(3, '19:05'), 2, tests.rs_contact(), NULL)$$, '55000',
  'only offered times can be booked');
SELECT tests.throws($$SELECT public.book_restaurant_table((SELECT id FROM o), tests.rs_at(3, '12:00'), 9, tests.rs_contact(), NULL)$$, '55000',
  'nor a party above the online maximum');
-- The combination: two parties of four at lunch.
SELECT tests.ok(tests.tables_of((SELECT id FROM public.book_restaurant_table((SELECT id FROM o), tests.rs_at(4, '12:00'), 4, tests.rs_contact(), NULL))) = 'T4',
  'a party of four gets T4');
SELECT tests.ok(tests.tables_of((SELECT id FROM public.book_restaurant_table((SELECT id FROM o), tests.rs_at(4, '12:00'), 4, tests.rs_contact(), NULL))) = 'T2+T3',
  'a second party of four gets the combination T2+T3');
SELECT tests.throws($$SELECT public.book_restaurant_table((SELECT id FROM o), tests.rs_at(4, '12:00'), 4, tests.rs_contact(), NULL)$$, '55000',
  'a third does not fit');
SELECT tests.ok(tests.tables_of((SELECT id FROM public.book_restaurant_table((SELECT id FROM o), tests.rs_at(4, '12:00'), 1, tests.rs_contact(), NULL))) = 'T1',
  'one guest still gets T1 at that time');
-- The company: phone guests, larger parties, walk-ins, never over a table.
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.create_restaurant_reservation((SELECT id FROM o), tests.rs_at(3, '19:30'), 2, tests.rs_contact(), NULL, 'phone', ARRAY[tests.rt('T1')])$$,
  '55000', 'the company cannot put a phone guest on a taken table');
SELECT tests.ok(tests.tables_of((SELECT id FROM public.create_restaurant_reservation((SELECT id FROM o), tests.rs_at(3, '20:30'), 2, tests.rs_contact(), NULL, 'phone', ARRAY[tests.rt('T1')]))) = 'T1',
  'but books it when the turn before has ended');
SELECT tests.ok((SELECT party_size FROM public.create_restaurant_reservation((SELECT id FROM o), tests.rs_at(5, '15:30'), 10, tests.rs_contact(), 'birthday', 'phone',
                                                                             ARRAY[tests.rt('T2'), tests.rt('T3'), tests.rt('T4')])) = 10,
  'and a party of ten on named tables, outside the periods');
SELECT tests.throws($$SELECT public.create_restaurant_reservation((SELECT id FROM o), tests.rs_at(3, '22:00'), 2, '{"name":"Ola"}', NULL, 'phone', NULL)$$, '22023',
  'a phone booking needs a phone number');
SELECT tests.throws($$SELECT public.create_restaurant_reservation((SELECT id FROM o), tests.rs_at(3, '22:00'), 2, tests.rs_contact(), NULL, 'online', NULL)$$, '22023',
  'the company books phone guests and walk-ins only');
SELECT tests.login(:worker);
CREATE TEMP TABLE w ON COMMIT DROP AS SELECT * FROM public.create_restaurant_reservation((SELECT id FROM o), NULL, 2, '{"name":"Walk-in"}', NULL, 'walk_in', NULL);
GRANT SELECT ON w TO service_role;
SELECT tests.ok((SELECT status FROM w) = 'seated' AND (SELECT no_show_fee FROM w) IS NULL AND tests.tables_of((SELECT id FROM w)) IS NOT NULL,
  'the floor staff seat a walk-in now, without a fee');
SELECT tests.login(:cust1);
SELECT public.add_restaurant_closed_date((SELECT id FROM o), tests.rs_day(6), 'private event');
SELECT tests.ok((SELECT count(*) FROM public.available_restaurant_times((SELECT id FROM o), tests.rs_day(6), 2)) = 0, 'a closed date removes the day');
ROLLBACK;

-- ── Restaurant: cancelling, seating, no-shows and the fee ──────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.rs_acme() AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.book_restaurant_table((SELECT id FROM o), tests.rs_at(3, '19:00'), 2, tests.rs_contact(), NULL);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT * FROM public.book_restaurant_table((SELECT id FROM o), tests.rs_at(3, '12:00'), 2, tests.rs_contact(), NULL);
CREATE TEMP TABLE c ON COMMIT DROP AS SELECT * FROM public.book_restaurant_table((SELECT id FROM o), tests.rs_at(3, '17:00'), 2, tests.rs_contact(), NULL);
GRANT SELECT ON o, a, b, c TO service_role;
SELECT tests.ok((SELECT cancelled_by FROM public.cancel_restaurant_reservation((SELECT id FROM b), 'plans changed')) = 'customer',
  'the guest cancels three days ahead');
SELECT tests.throws($$SELECT public.close_restaurant_reservation((SELECT id FROM a), 'no_show')$$, '42501', 'the guest does not mark no-shows');
SELECT tests.login(:worker);
SELECT tests.throws($$SELECT public.close_restaurant_reservation((SELECT id FROM a), 'no_show')$$, '55000', 'a no-show is marked after the booked time');
-- Move a and c into the past (as the server).
SET LOCAL ROLE service_role;
SELECT tests.as_server();
UPDATE public.restaurant_reservations SET starts_at = now() - interval '30 minutes', ends_at = now() + interval '60 minutes' WHERE id IN ((SELECT id FROM a), (SELECT id FROM c));
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.cancel_restaurant_reservation((SELECT id FROM a), 'late')$$, '55000', 'the guest cannot cancel after the notice');
SELECT tests.login(:worker);
SELECT tests.ok((SELECT status FROM public.close_restaurant_reservation((SELECT id FROM a), 'no_show')) = 'no_show', 'the floor staff mark a no-show');
SELECT tests.ok((SELECT status FROM public.seat_restaurant_reservation((SELECT id FROM c), NULL)) = 'seated', 'and seat the other party');
SELECT tests.throws($$SELECT public.close_restaurant_reservation((SELECT id FROM c), 'no_show')$$, '55000', 'a seated party is not a no-show');
SELECT tests.ok((SELECT ends_at <= now() FROM public.close_restaurant_reservation((SELECT id FROM c), 'completed')), 'completing frees the table from now');
SELECT tests.throws($$SELECT public.invoice_restaurant_no_show((SELECT id FROM a))$$, '42501', 'staff do not invoice');
SELECT tests.login(:cust1);
CREATE TEMP TABLE inv ON COMMIT DROP AS SELECT * FROM public.invoice_restaurant_no_show((SELECT id FROM a));
SELECT tests.ok((SELECT total FROM inv) = 400 AND (SELECT seller ->> 'name' FROM inv) = 'Acme Bistro AS'
                AND (SELECT customer_user_id FROM inv) = :cust2 AND (SELECT source_type FROM inv) = 'restaurant_reservation',
  'the owner invoices the no-show fee (two guests) in the company''s name');
SELECT tests.throws($$SELECT public.invoice_restaurant_no_show((SELECT id FROM a))$$, '55000', 'once');
SELECT tests.throws($$SELECT public.invoice_restaurant_no_show((SELECT id FROM c))$$, '55000', 'a meal is not invoiced here');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.restaurant_reservation_events WHERE reservation_id = (SELECT id FROM a)) >= 3, 'every step is logged');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.save_restaurant_table((SELECT id FROM o), NULL, '{"name":"X","seats":2}')$$, '42501',
  'FlyttGo administrators do not change a restaurant''s tables');
ROLLBACK;

-- Guests who come early: seated from now, only where the table is free.
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.rs_acme() AS id;
SELECT tests.login(:worker);
SELECT tests.ok(tests.tables_of((SELECT id FROM public.create_restaurant_reservation((SELECT id FROM o), NULL, 2, '{"name":"Walk-in"}', NULL, 'walk_in',
                                                                                     ARRAY[tests.rt('T3')]))) = 'T3', 'a walk-in at T3 now');
CREATE TEMP TABLE d ON COMMIT DROP AS SELECT * FROM public.create_restaurant_reservation((SELECT id FROM o), date_trunc('minute', now()) + interval '90 minutes', 2,
  tests.rs_contact(), NULL, 'phone', ARRAY[tests.rt('T3')]);
CREATE TEMP TABLE f ON COMMIT DROP AS SELECT * FROM public.create_restaurant_reservation((SELECT id FROM o), tests.rs_at(3, '19:00'), 2,
  tests.rs_contact(), NULL, 'phone', NULL);
GRANT SELECT ON o, d, f TO service_role;
SELECT tests.throws($$SELECT public.create_restaurant_reservation((SELECT id FROM o), NULL, 2, '{"name":"Walk-in"}', NULL, 'walk_in', ARRAY[tests.rt('T3')])$$,
  '55000', 'no walk-in over a table in use');
SELECT tests.throws($$SELECT public.seat_restaurant_reservation((SELECT id FROM f), NULL)$$, '55000', 'a reservation days ahead is not seated now');
SELECT tests.throws($$SELECT public.seat_restaurant_reservation((SELECT id FROM d), NULL)$$, '55000',
  'guests who come early are not seated at their table while it is in use');
SELECT tests.ok((SELECT starts_at <= now() FROM public.seat_restaurant_reservation((SELECT id FROM d), ARRAY[tests.rt('T2')])) AND tests.tables_of((SELECT id FROM d)) = 'T2',
  'but at a free one, held from now');
ROLLBACK;

-- A fee stated after the booking does not apply to it.
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.rs_acme() AS id;
SELECT tests.login(:cust1);
SELECT public.save_restaurant_settings((SELECT id FROM o), '{"booking_window_days":365,"lead_time_minutes":60}');
SELECT tests.login(:cust2);
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.book_restaurant_table((SELECT id FROM o), tests.rs_at(3, '19:00'), 2, tests.rs_contact(), NULL);
GRANT SELECT ON a TO service_role;
SELECT tests.login(:cust1);
SELECT public.save_restaurant_settings((SELECT id FROM o), '{"booking_window_days":365,"no_show_fee":500,"no_show_vat_rate":25}');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
UPDATE public.restaurant_reservations SET starts_at = now() - interval '30 minutes', ends_at = now() + interval '60 minutes' WHERE id = (SELECT id FROM a);
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT public.close_restaurant_reservation((SELECT id FROM a), 'no_show');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.invoice_restaurant_no_show((SELECT id FROM a))$$, '55000',
  'a no-show fee stated after the booking is not charged');
SELECT tests.throws($$SELECT public.save_restaurant_settings((SELECT id FROM o), '{"no_show_fee":100}')$$, '23514',
  'a fee needs its MVA rate (the company''s, not assumed)');
ROLLBACK;

-- ── Hotel: free rooms, no overbooking across ranges ────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.ht_acme() AS id;
GRANT SELECT ON o TO anon, service_role;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT rooms_free FROM public.available_hotel_rooms((SELECT id FROM o), tests.rs_day(10), tests.rs_day(12), 2) WHERE name = 'Double') = 2
                AND (SELECT total FROM public.available_hotel_rooms((SELECT id FROM o), tests.rs_day(10), tests.rs_day(12), 2) WHERE name = 'Double') = 2240
                AND (SELECT nights FROM public.available_hotel_rooms((SELECT id FROM o), tests.rs_day(10), tests.rs_day(12), 2) WHERE name = 'Double') = 2,
  'visitors see two Doubles free for two nights at 2 240 kr');
SELECT tests.ok((SELECT array_agg(name) FROM public.available_hotel_rooms((SELECT id FROM o), tests.rs_day(10), tests.rs_day(12), 3)) = ARRAY['Family'],
  'three guests: only the Family room');
SELECT tests.ok((SELECT count(*) FROM public.available_hotel_rooms((SELECT id FROM o), tests.rs_day(10), tests.rs_day(30), 2)) = 0,
  'not more nights than the hotel allows');
SELECT tests.throws($$SELECT * FROM public.hotel_rooms$$, '42501', 'visitors do not see the rooms');
SELECT tests.throws($$SELECT public.book_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.rs_day(10), tests.rs_day(12), 2, tests.rs_contact(), NULL)$$,
  '42501', 'visitors sign in to book');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust2);
CREATE TEMP TABLE s1 ON COMMIT DROP AS SELECT * FROM public.book_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.rs_day(10), tests.rs_day(12), 2, tests.rs_contact(), NULL);
GRANT SELECT ON s1 TO service_role;
SELECT tests.ok(tests.room_of((SELECT id FROM s1)) = '101' AND (SELECT nights FROM s1) = 2 AND (SELECT total FROM s1) = 2240 AND (SELECT vat_rate FROM s1) = 12
                AND (SELECT free_cancel_until FROM s1) = tests.rs_day(7) AND (SELECT late_cancel_fee FROM s1) = 1120,
  'the guest books two nights: a room is assigned, the price, MVA and cancellation rule copied onto the stay');
SELECT tests.ok(tests.holds_lock('hotel-type:' || tests.rtype('Double')::text), 'booking took the room type''s lock');
SELECT tests.ok(tests.room_of((SELECT id FROM public.book_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.rs_day(11), tests.rs_day(13), 2, tests.rs_contact(), NULL))) = '102',
  'an overlapping stay gets the other Double');
SELECT tests.throws($$SELECT public.book_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.rs_day(11), tests.rs_day(12), 1, tests.rs_contact(), NULL)$$,
  '55000', 'a third Double for a night both hold is refused: no overbooking');
SELECT tests.throws($$SELECT public.book_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.rs_day(5), tests.rs_day(14), 2, tests.rs_contact(), NULL)$$,
  '55000', 'nor a longer range that covers those nights');
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.available_hotel_rooms((SELECT id FROM o), tests.rs_day(11), tests.rs_day(12), 2) WHERE name = 'Double'),
  'the Double is not offered for that night');
SELECT tests.ok(tests.room_of((SELECT id FROM public.book_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.rs_day(12), tests.rs_day(14), 2, tests.rs_contact(), NULL))) = '101',
  'the check-out day is free for the next arrival');
SELECT tests.ok((SELECT nights FROM public.book_hotel_stay((SELECT id FROM o), tests.rtype('Family'), tests.next_dst_day() - 1, tests.next_dst_day() + 1, 2, tests.rs_contact(), NULL)) = 2,
  'nights are dates: a stay over the night the clocks change is two nights');
SELECT tests.throws($$SELECT public.book_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.rs_day(20), tests.rs_day(21), 3, tests.rs_contact(), NULL)$$,
  '22023', 'not more guests than the room type takes');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.create_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.room('101'), tests.rs_day(11), tests.rs_day(12), 2, tests.rs_contact(), NULL)$$,
  '55000', 'the company cannot book a taken room either');
SELECT tests.throws($$SELECT public.create_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.room('201'), tests.rs_day(20), tests.rs_day(21), 2, tests.rs_contact(), NULL)$$,
  '22023', 'nor a room of another type');
SELECT tests.ok(tests.room_of((SELECT id FROM public.create_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.room('102'), tests.rs_day(500), tests.rs_day(502), 2, tests.rs_contact(), 'phone'))) = '102',
  'but books a phone guest in a named room, also beyond the online window');
SELECT tests.login(:cust1);
SELECT public.add_hotel_closure((SELECT id FROM o), tests.room('201'), tests.rs_day(30), tests.rs_day(32), 'renovation');
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.available_hotel_rooms((SELECT id FROM o), tests.rs_day(31), tests.rs_day(33), 2) WHERE name = 'Family')
                AND EXISTS (SELECT 1 FROM public.available_hotel_rooms((SELECT id FROM o), tests.rs_day(32), tests.rs_day(33), 2) WHERE name = 'Family'),
  'a closed room is not offered for its nights');
SELECT public.add_hotel_closure((SELECT id FROM o), NULL, tests.rs_day(40), tests.rs_day(41), 'closed');
SELECT tests.ok((SELECT count(*) FROM public.available_hotel_rooms((SELECT id FROM o), tests.rs_day(40), tests.rs_day(42), 1)) = 0, 'nor any room while the hotel is closed');
ROLLBACK;

-- ── Hotel: cancellations, fees, check-in and out, invoices ─────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.ht_acme() AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE free ON COMMIT DROP AS SELECT * FROM public.book_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.rs_day(10), tests.rs_day(12), 2, tests.rs_contact(), NULL);
CREATE TEMP TABLE late ON COMMIT DROP AS SELECT * FROM public.book_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.rs_day(2), tests.rs_day(4), 2, tests.rs_contact(), NULL);
CREATE TEMP TABLE here ON COMMIT DROP AS SELECT * FROM public.book_hotel_stay((SELECT id FROM o), tests.rtype('Family'), tests.rs_day(1), tests.rs_day(3), 2, tests.rs_contact(), NULL);
GRANT SELECT ON o, free, late, here TO service_role;
SELECT tests.ok((SELECT cancel_fee FROM public.cancel_hotel_stay((SELECT id FROM free), 'plans changed', false)) IS NULL,
  'the guest cancels before the last free day: no fee');
SELECT tests.ok((SELECT cancel_fee FROM public.cancel_hotel_stay((SELECT id FROM late), 'ill', false)) = 1120,
  'two days before arrival the fee stated before the booking applies (50%)');
-- The Family stay arrives today (as the server).
SET LOCAL ROLE service_role;
SELECT tests.as_server();
UPDATE public.hotel_stays SET check_in = tests.rs_day(0), check_out = tests.rs_day(2) WHERE id = (SELECT id FROM here);
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.cancel_hotel_stay((SELECT id FROM here), 'late', false)$$, '55000', 'not online on the day of arrival');
SELECT tests.login(:worker);
SELECT tests.throws($$SELECT public.invoice_hotel_stay((SELECT id FROM late))$$, '42501', 'the desk staff do not invoice');
SELECT tests.ok((SELECT status FROM public.check_in_hotel_stay((SELECT id FROM here), NULL)) = 'checked_in', 'the desk checks the guest in');
SELECT tests.ok((SELECT status FROM public.check_out_hotel_stay((SELECT id FROM here))) = 'checked_out', 'and out');
SELECT tests.login(:cust1);
CREATE TEMP TABLE inv ON COMMIT DROP AS SELECT * FROM public.invoice_hotel_stay((SELECT id FROM here));
SELECT tests.ok((SELECT total FROM inv) = 4480 AND (SELECT vat_total FROM inv) = 480 AND (SELECT seller ->> 'name' FROM inv) = 'Acme Hotell AS'
                AND (SELECT customer_user_id FROM inv) = :cust2 AND (SELECT source_type FROM inv) = 'hotel_stay',
  'the stay is invoiced in the company''s name at its MVA rate (12%: 480 of 4 480)');
SELECT tests.ok((SELECT quantity FROM public.invoice_lines WHERE invoice_id = (SELECT id FROM inv)) = 2, 'two nights');
SELECT tests.throws($$SELECT public.invoice_hotel_stay((SELECT id FROM here))$$, '55000', 'once');
SELECT tests.ok((SELECT total FROM public.invoice_hotel_stay((SELECT id FROM late))) = 1120, 'the late cancellation fee is invoiced');
SELECT tests.throws($$SELECT public.invoice_hotel_stay((SELECT id FROM free))$$, '55000', 'a free cancellation has nothing to invoice');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.hotel_stay_events WHERE stay_id = (SELECT id FROM here)) >= 4, 'every step is logged');
ROLLBACK;

-- The company: late cancellations without a fee unless it charges one;
-- no-shows; check-in into another room; not before arrival.
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.ht_acme() AS id;
SELECT tests.login(:drv1);
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.create_hotel_stay((SELECT id FROM o), tests.rtype('Double'), NULL, tests.rs_day(1), tests.rs_day(2), 2, tests.rs_contact(), NULL);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT * FROM public.create_hotel_stay((SELECT id FROM o), tests.rtype('Double'), NULL, tests.rs_day(0), tests.rs_day(2), 2, tests.rs_contact(), NULL);
CREATE TEMP TABLE c ON COMMIT DROP AS SELECT * FROM public.create_hotel_stay((SELECT id FROM o), tests.rtype('Family'), NULL, tests.rs_day(0), tests.rs_day(1), 2, tests.rs_contact(), NULL);
GRANT SELECT ON o, a, b, c TO service_role;
SELECT tests.ok((SELECT cancel_fee FROM public.cancel_hotel_stay((SELECT id FROM a), 'guest called', false)) IS NULL,
  'a late cancellation by the company has no fee unless it charges it');
SELECT tests.throws($$SELECT public.check_in_hotel_stay((SELECT id FROM a), NULL)$$, '55000', 'a cancelled stay is not checked in');
SELECT tests.login(:worker);
SELECT tests.throws($$SELECT public.mark_hotel_no_show((SELECT id FROM c))$$, '42501', 'desk staff do not mark no-shows');
SELECT tests.throws($$SELECT public.check_in_hotel_stay((SELECT id FROM b), tests.room('201'))$$, '55000', 'nor check a guest into a taken room');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT cancel_fee FROM public.mark_hotel_no_show((SELECT id FROM c))) = 1120, 'a no-show carries the late fee (50% of one night)');
SELECT tests.login(:worker);
SELECT tests.ok(tests.room_of((SELECT id FROM public.check_in_hotel_stay((SELECT id FROM b), tests.room('201')))) = '201',
  'the desk checks a guest into a free room of another type (an upgrade)');
SELECT tests.ok((SELECT total FROM public.book_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.rs_day(5), tests.rs_day(6), 1, tests.rs_contact(), NULL)) = 1120,
  'members can also book for themselves');
ROLLBACK;

-- ── The MVA rate is the hotel's setting ────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.ht_acme(false) AS id;
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT count(*) FROM public.available_hotel_rooms((SELECT id FROM o), tests.rs_day(10), tests.rs_day(12), 2)) = 0,
  'without the hotel''s MVA rate nothing is offered');
SELECT tests.throws($$SELECT public.book_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.rs_day(10), tests.rs_day(12), 2, tests.rs_contact(), NULL)$$,
  '55000', 'nor booked');
ROLLBACK;

-- ── Module gating and isolation between companies ──────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
-- Acme on Appointments: set up as a restaurant and a hotel, without the modules.
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.sp_acme('appointments', 'appointments') AS id;
GRANT SELECT ON o TO service_role;
SELECT tests.login(:cust1);
SELECT public.save_restaurant_settings((SELECT id FROM o), '{}');
SELECT public.save_restaurant_table((SELECT id FROM o), NULL, '{"name":"T1","seats":4}');
SELECT public.save_restaurant_periods((SELECT id FROM o), '[{"weekday":1,"start":"11:00","end":"23:00"},{"weekday":2,"start":"11:00","end":"23:00"},
  {"weekday":3,"start":"11:00","end":"23:00"},{"weekday":4,"start":"11:00","end":"23:00"},{"weekday":5,"start":"11:00","end":"23:00"},
  {"weekday":6,"start":"11:00","end":"23:00"},{"weekday":7,"start":"11:00","end":"23:00"}]');
SELECT public.save_hotel_settings((SELECT id FROM o), '{"vat_rate":12}');
SELECT public.save_hotel_room((SELECT id FROM o), NULL, jsonb_build_object('name', '1', 'room_type_id',
  (SELECT id FROM public.save_hotel_room_type((SELECT id FROM o), NULL, '{"name":"Single","capacity":1,"nightly_price":900}'))));
SELECT tests.ok((SELECT count(*) FROM public.available_restaurant_times((SELECT id FROM o), tests.rs_day(3), 2)) = 0
                AND (SELECT count(*) FROM public.available_hotel_rooms((SELECT id FROM o), tests.rs_day(3), tests.rs_day(4), 1)) = 0,
  'without the modules in its plan a company offers no tables or rooms');
SELECT tests.throws($$SELECT public.create_restaurant_reservation((SELECT id FROM o), tests.rs_at(3, '12:00'), 2, tests.rs_contact(), NULL, 'phone', NULL)$$, '55000',
  'and cannot take a reservation');
SELECT tests.throws($$SELECT public.create_hotel_stay((SELECT id FROM o), tests.rtype('Single'), NULL, tests.rs_day(3), tests.rs_day(4), 1, tests.rs_contact(), NULL)$$, '55000',
  'or a stay');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.rs_acme() AS id;
-- Another company, owned by drv2, with a table of its own.
SELECT tests.login(:drv2);
CREATE TEMP TABLE other ON COMMIT DROP AS SELECT id FROM public.create_organization('Annen Kafé AS', 'annen-kafe');
GRANT SELECT ON o, other TO service_role;
SELECT public.save_restaurant_table((SELECT id FROM other), NULL, '{"name":"X1","seats":4}');
SELECT tests.login(:cust2);
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.book_restaurant_table((SELECT id FROM o), tests.rs_at(3, '19:00'), 2, tests.rs_contact(), NULL);
GRANT SELECT ON a TO service_role;
SELECT tests.ok((SELECT count(*) FROM public.restaurant_reservations) = 1, 'the guest sees their own reservation');
SELECT tests.ok((SELECT count(*) FROM public.restaurant_tables) = 0, 'but not the restaurant''s tables');
SELECT tests.login(:drv2);
SELECT tests.ok((SELECT count(*) FROM public.restaurant_reservations) = 0 AND (SELECT count(*) FROM public.restaurant_tables) = 1,
  'another company sees neither Acme''s reservations nor its tables, only its own');
SELECT tests.throws($$SELECT public.cancel_restaurant_reservation((SELECT id FROM a), 'mine now')$$, '42501', 'nor cancels them');
SELECT tests.throws($$SELECT public.save_restaurant_table((SELECT id FROM o), NULL, '{"name":"Y","seats":2}')$$, '42501', 'nor changes Acme''s floor');
SELECT tests.throws($$SELECT public.create_restaurant_reservation((SELECT id FROM o), tests.rs_at(3, '21:00'), 2, tests.rs_contact(), NULL, 'phone', NULL)$$, '42501',
  'nor books at Acme');
SELECT tests.login(:drv1);
SELECT tests.throws(format($$SELECT public.create_restaurant_reservation(%L, tests.rs_at(3, '21:00'), 2, tests.rs_contact(), NULL, 'phone', ARRAY[%L::uuid])$$,
                           (SELECT id FROM o), (SELECT id FROM public.restaurant_tables WHERE organization_id = (SELECT id FROM other))),
  '22023', 'Acme cannot book another company''s table');
SELECT tests.throws($$SELECT public.save_restaurant_table_group((SELECT id FROM o), NULL, jsonb_build_object('name','G','table_ids', jsonb_build_array(tests.rt('T2'), tests.rt('T3'))))$$, '42501',
  'a booker does not change the floor plan');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.save_restaurant_table_group((SELECT id FROM o), NULL, jsonb_build_object('name','G','table_ids', jsonb_build_array(tests.rt('T1'), tests.rt('T2'))))$$,
  '22023', 'only combinable tables are combined');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.ht_acme() AS id;
GRANT SELECT ON o TO service_role;
SELECT tests.login(:cust2);
CREATE TEMP TABLE s ON COMMIT DROP AS SELECT * FROM public.book_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.rs_day(10), tests.rs_day(12), 2, tests.rs_contact(), NULL);
GRANT SELECT ON s TO service_role;
SELECT tests.ok((SELECT count(*) FROM public.hotel_stays) = 1 AND (SELECT count(*) FROM public.hotel_rooms) = 0,
  'the guest sees their stay, not the rooms');
SELECT tests.login(:drv2);
SELECT tests.ok((SELECT count(*) FROM public.hotel_stays) = 0 AND (SELECT count(*) FROM public.hotel_stay_events) = 0,
  'a stranger sees no stays');
SELECT tests.throws($$SELECT public.check_in_hotel_stay((SELECT id FROM s), NULL)$$, '42501', 'nor checks one in');
SELECT tests.login(:worker);
SELECT tests.ok((SELECT count(*) FROM public.hotel_stays) = 1 AND (SELECT count(*) FROM public.hotel_rooms) = 3, 'the desk staff see the stays and rooms');
ROLLBACK;

-- ── Reminders (server) ─────────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.rs_acme() AS id;
SELECT tests.login(:drv1);
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.create_restaurant_reservation((SELECT id FROM o), date_trunc('minute', now() + interval '24 hours'), 2,
  tests.rs_contact(), NULL, 'phone', NULL);
GRANT SELECT ON a TO service_role;
SELECT tests.throws($$SELECT * FROM public.restaurant_reservations_to_remind()$$, '42501', 'only the server lists reminders');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((SELECT count(*) FROM public.restaurant_reservations_to_remind()) = 1, 'a table tomorrow is due a reminder');
SELECT public.mark_restaurant_reservation_reminded((SELECT id FROM a));
SELECT tests.ok((SELECT count(*) FROM public.restaurant_reservations_to_remind()) = 0, 'once');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.ht_acme() AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE s ON COMMIT DROP AS SELECT * FROM public.book_hotel_stay((SELECT id FROM o), tests.rtype('Double'), tests.rs_day(1), tests.rs_day(2), 2, tests.rs_contact(), NULL);
GRANT SELECT ON s TO service_role;
SELECT tests.throws($$SELECT * FROM public.hotel_stays_to_remind()$$, '42501', 'only the server lists arrivals to remind');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((SELECT count(*) FROM public.hotel_stays_to_remind()) = 1, 'an arrival tomorrow is due a reminder');
SELECT public.mark_hotel_stay_reminded((SELECT id FROM s));
SELECT tests.ok((SELECT count(*) FROM public.hotel_stays_to_remind()) = 0, 'once');
ROLLBACK;

\echo 'reservations: all tests passed'
