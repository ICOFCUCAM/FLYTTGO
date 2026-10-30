-- ============================================================================
-- Release rehearsal, part 2: data only 00016–00022 allow, written after the
-- migrations, on top of part 1 (data_before.sql). Synthetic, committed.
--
--   D Bistro Nord  plan Restaurant: tables, reservations booked online and
--                  by phone, seated and completed, no-show invoiced, cancelled
--   E Hotell Vest  plan Hotel (+ Restaurant as an add-on on a quote): stays
--                  booked, checked in and out and invoiced, cancelled late
--                  with a fee, cancelled free
--   F Butikk Sør   plan Online shop: orders paid, refunded, withdrawn from
--                  and refunded, awaiting payment, cancelled
--   C Salong Lys   adds the shop at an approved pilot price (add-on)
--   A Fjord Flytt  API add-on, keys of its owner and admin (the admin's key
--                  is revoked when the admin becomes a viewer); approval
--                  rules: moves waiting, approved, refused
--   G Kunde        API add-on without a plan; a move booked through the API
--   bank files     FlyttGo's series (G's open invoice, the rest of A's) and
--                  B's own series, with matched, unmatched and repeated rows
-- ============================================================================
\set ON_ERROR_STOP 1

CREATE OR REPLACE FUNCTION tests.rh_at(p_days int, p_time time) RETURNS timestamptz LANGUAGE sql STABLE AS
  $$ SELECT (((now() AT TIME ZONE 'Europe/Oslo')::date + p_days) + p_time) AT TIME ZONE 'Europe/Oslo' $$;
CREATE OR REPLACE FUNCTION tests.rh_day(p_days int) RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (now() AT TIME ZONE 'Europe/Oslo')::date + p_days $$;
CREATE OR REPLACE FUNCTION tests.rh_guest(n int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS
  $$ SELECT jsonb_build_object('name', 'Gjest ' || n, 'phone', '+47 900 00 0' || lpad(n::text, 2, '0'), 'email', 'r' || lpad(n::text, 2, '0') || '@example.no') $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;
-- The API keys as shown once to their creators (the database keeps only hashes).
CREATE TABLE tests.rh_keys (name text PRIMARY KEY, key text NOT NULL);
GRANT SELECT ON tests.rh_keys TO anon, authenticated, service_role;

-- ── Plans for D, E and F (company sells), approved by FlyttGo ─────────────
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES ('D', 'restaurant', 'Bistro Nord'), ('E', 'hotel', 'Hotell Vest'), ('F', 'shop', 'Butikk Sor')) AS t(k, plan, display) LOOP
    PERFORM tests.rh_as(tests.rh_id('owner_' || c.k));
    PERFORM public.request_white_label(tests.rh_id('org_' || c.k), c.plan);
    PERFORM public.set_white_label_brand(tests.rh_id('org_' || c.k), c.display, '#224466', '#ffaa00', NULL,
      'post@' || lower(replace(c.display, ' ', '-')) || '.example.no', '+47 22 33 44 66',
      'https://' || lower(replace(c.display, ' ', '-')) || '.example.no/vilkar',
      'https://' || lower(replace(c.display, ' ', '-')) || '.example.no/personvern', 0);
    PERFORM public.accept_white_label_dpa(tests.rh_id('org_' || c.k), '2026-10-draft');
    PERFORM public.set_invoice_settings(tests.rh_id('org_' || c.k), jsonb_build_object('legal_name', c.display || ' AS',
      'address', 'Torget 3', 'postcode_city', '0150 Oslo', 'bank_account', '1506123456' || CASE c.k WHEN 'D' THEN '9' WHEN 'E' THEN '0' ELSE '1' END));
    IF c.k = 'F' THEN
      PERFORM tests.rh_server();
      PERFORM public.set_white_label_stripe_account(tests.rh_id('org_F'), 'acct_1RhButikk', true);
    END IF;
    PERFORM tests.rh_admin();
    PERFORM public.admin_decide_white_label(tests.rh_id('org_' || c.k), true, NULL);
  END LOOP;
  -- Staff: r24 at D (floor), r25 at E (front desk), r26 at F (warehouse).
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
    (tests.rh_id('org_D'), tests.rh_user(24), 'staff'), (tests.rh_id('org_E'), tests.rh_user(25), 'staff'),
    (tests.rh_id('org_F'), tests.rh_user(26), 'staff');
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

-- ── Add-ons (00022) ───────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM tests.rh_server();
  PERFORM public.set_white_label_stripe_account(tests.rh_id('org_C'), 'acct_1RhSalong', true);
  PERFORM tests.rh_admin();
  PERFORM public.admin_enable_addon(tests.rh_id('org_C'), 'shop', 'pilot', NULL, 590, NULL, 'Pilot price for a shop beside Appointments, approved by FlyttGo (rehearsal)');
  PERFORM public.admin_enable_addon(tests.rh_id('org_A'), 'api', 'quote', NULL, NULL, 'Q-RH-001', NULL);
  PERFORM public.admin_enable_addon(tests.rh_id('org_G'), 'api', 'quote', NULL, NULL, 'Q-RH-002', NULL);
  PERFORM public.admin_enable_addon(tests.rh_id('org_E'), 'restaurant_reservations', 'quote', NULL, NULL, 'Q-RH-003', NULL);
  -- B had the API once, ended (the record stays).
  PERFORM public.admin_enable_addon(tests.rh_id('org_B'), 'api', 'quote', NULL, NULL, 'Q-RH-004', NULL);
  PERFORM public.admin_end_addon(tests.rh_id('org_B'), 'api', 'quote not renewed');
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

-- ── D: tables and reservations ────────────────────────────────────────────
DO $$
DECLARE v_t1 uuid; r public.restaurant_reservations; i int;
BEGIN
  PERFORM tests.rh_as(tests.rh_id('owner_D'));
  PERFORM public.save_restaurant_settings(tests.rh_id('org_D'), '{"slot_step_minutes":15,"booking_window_days":120,"lead_time_minutes":60,
    "max_party_online":8,"default_turn_minutes":120,"cancel_hours":2,"no_show_fee":200,"no_show_fee_per":"guest","no_show_vat_rate":25}');
  SELECT id INTO v_t1 FROM public.save_restaurant_table(tests.rh_id('org_D'), NULL, '{"name":"T1","seats":2,"sort":1}');
  PERFORM public.save_restaurant_table(tests.rh_id('org_D'), NULL, '{"name":"T2","seats":4,"sort":2}');
  PERFORM public.save_restaurant_table(tests.rh_id('org_D'), NULL, '{"name":"T3","seats":6,"sort":3}');
  PERFORM public.save_restaurant_periods(tests.rh_id('org_D'), (SELECT jsonb_agg(jsonb_build_object('weekday', d, 'name', 'Dinner',
    'start', '16:00', 'end', '23:00', 'last_seating', '21:00')) FROM generate_series(1, 7) d));
  -- Online bookings by guests r21 and r22; one by phone.
  FOR i IN 1..4 LOOP
    PERFORM tests.rh_as(tests.rh_user(20 + (i % 2) + 1));
    r := public.book_restaurant_table(tests.rh_id('org_D'), tests.rh_at(2 + i, '18:00'), 2, tests.rh_guest(20 + (i % 2) + 1), NULL);
    INSERT INTO tests.rh VALUES ('res_D_' || i, r.id);
  END LOOP;
  PERFORM tests.rh_as(tests.rh_id('owner_D'));
  r := public.create_restaurant_reservation(tests.rh_id('org_D'), tests.rh_at(4, '19:00'), 4, tests.rh_guest(27), 'phone booking', 'phone', NULL);
  INSERT INTO tests.rh VALUES ('res_D_phone', r.id);
  -- 1 cancelled by the guest; 2 seated and completed; 3 a no-show, invoiced.
  PERFORM tests.rh_as(tests.rh_user(22));
  PERFORM public.cancel_restaurant_reservation(tests.rh_id('res_D_1'), 'plans changed');
  PERFORM set_config('request.jwt.claims', '', false);
  UPDATE public.restaurant_reservations SET starts_at = now() - interval '30 minutes', ends_at = now() + interval '60 minutes'
   WHERE id = tests.rh_id('res_D_2');
  UPDATE public.restaurant_reservations SET starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour'
   WHERE id = tests.rh_id('res_D_3');
  PERFORM tests.rh_as(tests.rh_user(24));
  PERFORM public.seat_restaurant_reservation(tests.rh_id('res_D_2'), NULL);
  PERFORM public.close_restaurant_reservation(tests.rh_id('res_D_2'), 'completed');
  PERFORM public.close_restaurant_reservation(tests.rh_id('res_D_3'), 'no_show');
  PERFORM tests.rh_as(tests.rh_id('owner_D'));
  INSERT INTO tests.rh SELECT 'inv_D_noshow', (public.invoice_restaurant_no_show(tests.rh_id('res_D_3'))).id;
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

-- ── E: rooms and stays ────────────────────────────────────────────────────
DO $$
DECLARE v_double uuid; v_family uuid; s public.hotel_stays;
BEGIN
  PERFORM tests.rh_as(tests.rh_id('owner_E'));
  PERFORM public.save_hotel_settings(tests.rh_id('org_E'), '{"vat_rate":12,"booking_window_days":365,"lead_days":0,"min_nights":1,
    "max_nights":14,"free_cancel_days":3,"late_cancel_fee_pct":50}');
  SELECT id INTO v_double FROM public.save_hotel_room_type(tests.rh_id('org_E'), NULL, '{"name":"Dobbeltrom","capacity":2,"nightly_price":1120,"sort":1}');
  SELECT id INTO v_family FROM public.save_hotel_room_type(tests.rh_id('org_E'), NULL, '{"name":"Familierom","capacity":4,"nightly_price":2240,"sort":2}');
  PERFORM public.save_hotel_room(tests.rh_id('org_E'), NULL, jsonb_build_object('name', '101', 'room_type_id', v_double, 'sort', 1));
  PERFORM public.save_hotel_room(tests.rh_id('org_E'), NULL, jsonb_build_object('name', '102', 'room_type_id', v_double, 'sort', 2));
  PERFORM public.save_hotel_room(tests.rh_id('org_E'), NULL, jsonb_build_object('name', '201', 'room_type_id', v_family, 'sort', 3));
  PERFORM tests.rh_as(tests.rh_user(23));
  s := public.book_hotel_stay(tests.rh_id('org_E'), v_double, tests.rh_day(20), tests.rh_day(22), 2, tests.rh_guest(23), NULL);
  INSERT INTO tests.rh VALUES ('stay_free', s.id);
  s := public.book_hotel_stay(tests.rh_id('org_E'), v_double, tests.rh_day(2), tests.rh_day(4), 2, tests.rh_guest(23), NULL);
  INSERT INTO tests.rh VALUES ('stay_late', s.id);
  s := public.book_hotel_stay(tests.rh_id('org_E'), v_family, tests.rh_day(1), tests.rh_day(3), 3, tests.rh_guest(23), NULL);
  INSERT INTO tests.rh VALUES ('stay_here', s.id);
  s := public.book_hotel_stay(tests.rh_id('org_E'), v_family, tests.rh_day(30), tests.rh_day(33), 4, tests.rh_guest(23), 'cot please');
  INSERT INTO tests.rh VALUES ('stay_booked', s.id);
  PERFORM public.cancel_hotel_stay(tests.rh_id('stay_free'), 'plans changed', false);
  PERFORM public.cancel_hotel_stay(tests.rh_id('stay_late'), 'ill', false);
  PERFORM set_config('request.jwt.claims', '', false);
  UPDATE public.hotel_stays SET check_in = tests.rh_day(0), check_out = tests.rh_day(2) WHERE id = tests.rh_id('stay_here');
  PERFORM tests.rh_as(tests.rh_user(25));
  PERFORM public.check_in_hotel_stay(tests.rh_id('stay_here'), NULL);
  PERFORM public.check_out_hotel_stay(tests.rh_id('stay_here'));
  PERFORM tests.rh_as(tests.rh_id('owner_E'));
  INSERT INTO tests.rh SELECT 'inv_E_stay', (public.invoice_hotel_stay(tests.rh_id('stay_here'))).id;
  INSERT INTO tests.rh SELECT 'inv_E_fee', (public.invoice_hotel_stay(tests.rh_id('stay_late'))).id;
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

-- ── F (and C): the shop, orders paid, refunded, withdrawn, open, cancelled ─
DO $$
DECLARE o public.shop_orders; w public.shop_withdrawals; f public.shop_refunds; v_mug uuid; v_tee uuid; v_m uuid; k text;
BEGIN
  PERFORM tests.rh_as(tests.rh_id('owner_F'));
  PERFORM public.save_shop_settings(tests.rh_id('org_F'), '{"pickup_enabled":true,"pickup_address":"Torget 3, 0150 Oslo","shipping_enabled":true,"shipping_price":99,"free_shipping_over":1000}');
  SELECT id INTO v_mug FROM public.save_shop_product(tests.rh_id('org_F'), NULL, '{"name":"Kopp","price":199,"track_stock":true,"stock":40,"sort":1}');
  SELECT id INTO v_tee FROM public.save_shop_product(tests.rh_id('org_F'), NULL, '{"name":"T-skjorte","price":249,"variant_label":"Størrelse","track_stock":true,"sort":2}');
  SELECT id INTO v_m FROM public.save_shop_variant(v_tee, NULL, '{"name":"M","stock":20}');
  PERFORM public.save_shop_product(tests.rh_id('org_F'), NULL, '{"name":"Kaffe","price":129,"vat_rate":15,"sort":3}');
  -- Five orders by r28.
  FOREACH k IN ARRAY ARRAY['paid', 'refunded', 'withdrawn', 'open', 'cancelled'] LOOP
    PERFORM tests.rh_as(tests.rh_user(28));
    o := public.place_shop_order(tests.rh_id('org_F'), jsonb_build_array(
           jsonb_build_object('product_id', v_mug, 'quantity', 2),
           jsonb_build_object('product_id', v_tee, 'variant_id', v_m, 'quantity', 1)), 'shipping',
           '{"address":"Storgata 5","postcode":"0155","city":"Oslo"}', tests.rh_guest(28));
    INSERT INTO tests.rh VALUES ('order_' || k, o.id);
    IF k IN ('paid', 'refunded', 'withdrawn') THEN
      PERFORM tests.rh_server();
      PERFORM public.record_shop_payment(o.id, o.total, 'acct_1RhButikk', 'pi_rh_shop_' || k, 'cs_rh_shop_' || k);
      INSERT INTO public.payment_events (provider, event_id, kind) VALUES ('stripe', 'evt_rh_shop_' || k, 'checkout.session.completed');
    ELSIF k = 'cancelled' THEN
      PERFORM public.cancel_shop_order(o.id, 'changed my mind');
    END IF;
  END LOOP;
  -- Refunded by the owner, before shipping.
  PERFORM tests.rh_as(tests.rh_id('owner_F'));
  f := public.shop_refund_begin(tests.rh_id('order_refunded'), NULL, true, true, 'out of stock at the supplier', NULL);
  PERFORM tests.rh_server();
  PERFORM public.shop_refund_mark(f.id, 'succeeded', 're_rh_shop_1', NULL);
  -- Withdrawn from after delivery: the form, the goods back, the refund.
  PERFORM tests.rh_as(tests.rh_user(26));
  PERFORM public.set_shop_order_status(tests.rh_id('order_withdrawn'), 'packed', NULL);
  PERFORM public.set_shop_order_status(tests.rh_id('order_withdrawn'), 'shipped', 'Posten 370000000001');
  PERFORM public.set_shop_order_status(tests.rh_id('order_withdrawn'), 'delivered', NULL);
  PERFORM tests.rh_as(tests.rh_user(28));
  w := public.request_shop_withdrawal(tests.rh_id('order_withdrawn'), NULL, 'Jeg angrer kjøpet');
  INSERT INTO tests.rh VALUES ('withdrawal', w.id);
  PERFORM tests.rh_as(tests.rh_user(26));
  PERFORM public.handle_shop_withdrawal(w.id, 'received', 'all back');
  PERFORM tests.rh_as(tests.rh_id('owner_F'));
  f := public.shop_refund_begin(tests.rh_id('order_withdrawn'), NULL, true, true, 'withdrawal', w.id);
  PERFORM tests.rh_server();
  PERFORM public.shop_refund_mark(f.id, 'succeeded', 're_rh_shop_2', NULL);
  -- C's shop beside its appointments (the add-on).
  PERFORM tests.rh_as(tests.rh_id('owner_C'));
  PERFORM public.save_shop_settings(tests.rh_id('org_C'), '{"pickup_enabled":true,"pickup_address":"Torget 2, 0150 Oslo"}');
  SELECT id INTO v_mug FROM public.save_shop_product(tests.rh_id('org_C'), NULL, '{"name":"Sjampo","price":249,"track_stock":true,"stock":10}');
  PERFORM tests.rh_as(tests.rh_user(29));
  o := public.place_shop_order(tests.rh_id('org_C'), jsonb_build_array(jsonb_build_object('product_id', v_mug, 'quantity', 1)), 'pickup', NULL, tests.rh_guest(29));
  PERFORM tests.rh_server();
  PERFORM public.record_shop_payment(o.id, o.total, 'acct_1RhSalong', 'pi_rh_salong_1', 'cs_rh_salong_1');
  INSERT INTO tests.rh VALUES ('order_C', o.id);
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

-- ── A and G: API keys; A's approval rules ─────────────────────────────────
DO $$
DECLARE k jsonb; v uuid; b record; n int := 0;
BEGIN
  PERFORM tests.rh_as(tests.rh_id('owner_A'));
  k := public.create_api_key(tests.rh_id('org_A'), 'ERP (owner)', ARRAY['quotes', 'bookings:read', 'bookings:write']);
  INSERT INTO tests.rh VALUES ('key_A_owner', (k ->> 'id')::uuid);
  INSERT INTO tests.rh_keys VALUES ('A_owner', k ->> 'key');
  PERFORM tests.rh_as(tests.rh_user(2));
  k := public.create_api_key(tests.rh_id('org_A'), 'Integration (admin)', ARRAY['quotes', 'bookings:read']);
  INSERT INTO tests.rh VALUES ('key_A_admin', (k ->> 'id')::uuid);
  INSERT INTO tests.rh_keys VALUES ('A_admin', k ->> 'key');
  PERFORM tests.rh_as(tests.rh_id('owner_G'));
  k := public.create_api_key(tests.rh_id('org_G'), 'Lager', ARRAY['quotes', 'bookings:read', 'bookings:write']);
  INSERT INTO tests.rh VALUES ('key_G', (k ->> 'id')::uuid);
  INSERT INTO tests.rh_keys VALUES ('G', k ->> 'key');
  -- G books a move through the API (on invoice), with an Idempotency-Key.
  PERFORM tests.rh_server();
  PERFORM public.api_begin(encode(sha256(convert_to(k ->> 'key', 'UTF8')), 'hex'), 'bookings:write');
  INSERT INTO tests.rh SELECT 'move_G_api', (public.api_write(encode(sha256(convert_to(k ->> 'key', 'UTF8')), 'hex'), 'booking.create',
    jsonb_build_object('pickup', jsonb_build_object('address', 'Lagerveien 1', 'postcode', '0580', 'city', 'Oslo', 'lat', 59.92, 'lng', 10.80),
                       'dropoff', jsonb_build_object('address', 'Kaia 2', 'postcode', '5003', 'city', 'Bergen', 'lat', 60.39, 'lng', 5.32),
                       'contact', jsonb_build_object('name', 'Lager G', 'phone', '+47 900 00 018', 'email', 'r18@example.no'),
                       'van_type', 'medium_van', 'helpers', 1, 'estimated_hours', 2, 'move_type', 'office', 'move_date', current_date + 12,
                       'move_time', '09:00', 'price', 2875, 'distance_km', 7.4), 'rh-order-1', 'rh-hash-1') ->> 'id')::uuid;
  -- A's admin becomes a viewer: their key is revoked at once.
  PERFORM tests.rh_as(tests.rh_id('owner_A'));
  PERFORM public.change_member_role(tests.rh_id('org_A'), tests.rh_user(2), 'viewer');
  -- Approval: every booking by a booker; one waits, one is approved, one refused.
  PERFORM public.set_spending_rules(tests.rh_id('org_A'), 5000, ARRAY['booker'], 168);
  FOREACH v IN ARRAY ARRAY[NULL::uuid, NULL, NULL] LOOP
    n := n + 1;
    PERFORM tests.rh_as(tests.rh_user(3));
    INSERT INTO public.bookings (customer_id, organization_id, price_estimate, original_price, estimated_hours,
                                 pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, van_type, pickup_city, dropoff_city, move_date)
    VALUES (tests.rh_user(3), tests.rh_id('org_A'), 1500 + n, 1500 + n, 2, 59.91, 10.75, 59.95, 10.80, 'medium_van', 'Oslo', 'Oslo', current_date + 20)
    RETURNING id INTO v;
    INSERT INTO public.escrow_payments (booking_id, amount, original_amount, status) VALUES (v, 1500 + n, 1500 + n, 'held');
    PERFORM tests.rh_server();
    PERFORM public.company_booking_check(v, tests.rh_user(3), 1500 + n);
    INSERT INTO tests.rh VALUES ('approval_' || n, v);
  END LOOP;
  PERFORM tests.rh_as(tests.rh_user(4));          -- A's finance member
  PERFORM public.decide_booking_approval(tests.rh_id('approval_2'), true, 'project budget', 1502);
  PERFORM public.decide_booking_approval(tests.rh_id('approval_3'), false, 'not in budget', 1503);
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

-- ── Bank files: FlyttGo's series and B's own ──────────────────────────────
DO $$
DECLARE r jsonb;
BEGIN
  SELECT jsonb_build_array(
    jsonb_build_object('paid_on', current_date, 'amount', i.total, 'currency', 'NOK', 'kid', i.kid, 'kid_source', 'structured',
                       'bank_reference', 'rh-nets:1:1:1', 'reversal', false, 'payer', 'Kunde Bedrift AS', 'account', '12345678903', 'info', NULL),
    jsonb_build_object('paid_on', current_date, 'amount', p.total - p.amount_paid, 'currency', 'NOK', 'kid', p.kid, 'kid_source', 'structured',
                       'bank_reference', 'rh-nets:1:1:2', 'reversal', false, 'payer', 'Fjord Flytt AS', 'account', '12345678903', 'info', NULL),
    jsonb_build_object('paid_on', current_date, 'amount', 50, 'currency', 'NOK', 'kid', '999999999', 'kid_source', 'structured',
                       'bank_reference', 'rh-nets:1:1:3', 'reversal', false, 'payer', 'Ukjent', 'account', '12345678903', 'info', NULL)) INTO r
    FROM public.invoices i, public.invoices p WHERE i.id = tests.rh_id('inv_F_open') AND p.id = tests.rh_id('inv_F_part');
  PERFORM tests.rh_admin();
  INSERT INTO tests.rh SELECT 'import_F', (public.import_bank_file(NULL, 'nets_ocr', 'upload', 'OCR.RH1.txt',
    encode(sha256(convert_to('rehearsal flyttgo file', 'UTF8')), 'hex'), r)).id;
  SELECT jsonb_build_array(
    jsonb_build_object('paid_on', current_date, 'amount', i.total, 'currency', 'NOK', 'kid', i.kid, 'kid_source', 'structured',
                       'bank_reference', 'rh-camt:B:1', 'reversal', false, 'payer', 'Kunde 5', 'account', '15061234567', 'info', NULL),
    jsonb_build_object('paid_on', current_date, 'amount', 10, 'currency', 'EUR', 'kid', i.kid, 'kid_source', 'structured',
                       'bank_reference', 'rh-camt:B:2', 'reversal', false, 'payer', 'Kunde 5', 'account', '15061234567', 'info', NULL)) INTO r
    FROM public.invoices i WHERE i.id = tests.rh_id('inv_B_5');
  PERFORM tests.rh_as(tests.rh_user(8));        -- B's finance member
  INSERT INTO tests.rh SELECT 'import_B', (public.import_bank_file(tests.rh_id('org_B'), 'camt054', 'upload', 'camt.RH1.xml',
    encode(sha256(convert_to('rehearsal company file', 'UTF8')), 'hex'), r)).id;
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

\echo 'rehearsal data after 00022: written'
