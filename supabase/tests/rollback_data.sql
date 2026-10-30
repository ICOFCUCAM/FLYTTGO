-- Data that only the migrated schema allows, written before a rollback
-- (supabase/tests/run.sh, variant "rollback with data"). Loaded after
-- helpers.sql, as the database owner. The rollback must still succeed;
-- rollback_data_check.sql then records what survived.

\set ON_ERROR_STOP 1

-- 00002: an expired subscription and an ID document keyed by the user id,
-- a reviewed application, a location keyed by the user id.
INSERT INTO public.driver_subscriptions (driver_id, plan_id, subscription_status, start_date, end_date)
VALUES ('d0000000-0000-0000-0000-000000000002', tests.plan_id('pro'), 'expired', now() - interval '40 days', now() - interval '10 days');
INSERT INTO public.driver_documents (driver_id, document_type, file_url)
VALUES ('d0000000-0000-0000-0000-000000000001', 'identity_document', 'd0000000-0000-0000-0000-000000000001/id.pdf');
UPDATE public.driver_applications SET status = 'rejected', reviewed_by = 'a0000000-0000-0000-0000-000000000001',
       reviewed_at = now(), rejection_reason = 'unreadable licence'
 WHERE id = 'e1000000-0000-0000-0000-000000000001';
INSERT INTO public.driver_locations (driver_id, lat, lng)
VALUES ('d0000000-0000-0000-0000-000000000001', 59.91, 10.75)
ON CONFLICT (driver_id) DO UPDATE SET lat = EXCLUDED.lat;

-- 00003: review reason and manual refund share on a booking; final price on escrow.
UPDATE public.bookings SET payment_review_reason = 'amount mismatch', manual_refund_percent = 50
 WHERE id = 'b0000000-0000-0000-0000-000000000003';
UPDATE public.escrow_payments SET final_price = 2875, adjustment_reason = 'none'
 WHERE booking_id = 'b0000000-0000-0000-0000-000000000003';

-- 00004: a paid booking, a processed webhook event, a completed refund.
UPDATE public.bookings SET payment_provider = 'stripe', payment_intent_id = 'pi_rb', paid_amount = 2875, paid_at = now()
 WHERE id = 'b0000000-0000-0000-0000-000000000002';
INSERT INTO public.payment_events (provider, event_id, kind) VALUES ('stripe', 'evt_rb', 'checkout.session.completed');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT public.refund_mark((SELECT id FROM public.refund_request_begin('b0000000-0000-0000-0000-000000000002', 1000, NULL, 'rollback test')),
                          'succeeded', 're_rb', NULL);
SELECT set_config('request.jwt.claims', '', false);

-- 00005: an organisation with a member and an open invitation.
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', false);
SELECT public.create_organization('Rollback AS', 'rollback-as');
SELECT public.invite_member((SELECT id FROM public.organizations WHERE slug = 'rollback-as'), 'cust2@test', 'viewer');
SELECT set_config('request.jwt.claims', '', false);

-- 00006: a cancellation stamped by the database, a captured payment,
-- a company verification.
UPDATE public.bookings SET status = 'cancelled' WHERE id = 'b0000000-0000-0000-0000-000000000001';
UPDATE public.bookings SET captured_at = now(), captured_amount = 2875 WHERE id = 'b0000000-0000-0000-0000-000000000002';
SELECT public.record_organization_verification((SELECT id FROM public.organizations WHERE slug = 'rollback-as'),
                                               'brreg', true, '{"navn":"ROLLBACK AS"}');

-- 00017: the company is activated, has an approval rule and a member
-- limit, and a booking waits for approval (the rollback cancels it).
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', false);
SELECT public.admin_set_organization_status((SELECT id FROM public.organizations WHERE slug = 'rollback-as'), 'active', 'rollback test');
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', false);
SELECT public.set_spending_rules((SELECT id FROM public.organizations WHERE slug = 'rollback-as'), 1000, ARRAY['owner'], 168);
INSERT INTO public.bookings (id, customer_id, organization_id, price_estimate, original_price, estimated_hours,
                             pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, van_type)
SELECT 'b0000000-0000-0000-0000-000000000017', 'c0000000-0000-0000-0000-000000000001', id, 1200, 1200, 1,
       59.91, 10.75, 59.95, 10.80, 'medium_van'
  FROM public.organizations WHERE slug = 'rollback-as';
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT public.company_booking_check('b0000000-0000-0000-0000-000000000017', 'c0000000-0000-0000-0000-000000000001', 1200);
-- 00022: FlyttGo enables the API add-on (needed for keys since 00022) and
-- accepts a plan's prices as pilot pricing.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', false);
SELECT public.admin_enable_addon((SELECT id FROM public.organizations WHERE slug = 'rollback-as'), 'api', 'quote', NULL, NULL, 'Q-ROLLBACK', NULL);
SELECT public.admin_set_white_label_pilot_price('jobs', 'Pilot pricing (rollback test)');
-- 00018: an API key with its log and a counted request, a widget
-- website (the company was activated above).
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', false);
SELECT public.create_api_key((SELECT id FROM public.organizations WHERE slug = 'rollback-as'), 'Rollback', ARRAY['quotes', 'bookings:read']);
SELECT public.add_widget_origin((SELECT id FROM public.organizations WHERE slug = 'rollback-as'), 'https://rollback.example');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT public.api_begin((SELECT key_hash FROM public.api_keys LIMIT 1), 'quotes');
SELECT set_config('request.jwt.claims', '', false);
-- 00019: a restaurant's table, a reservation on it with its log, a hotel's
-- room type, room and stay with its log (the company is on no plan).
INSERT INTO public.restaurant_settings (organization_id) SELECT id FROM public.organizations WHERE slug = 'rollback-as';
INSERT INTO public.restaurant_tables (organization_id, name, seats) SELECT id, 'T1', 2 FROM public.organizations WHERE slug = 'rollback-as';
INSERT INTO public.restaurant_reservations (organization_id, number, customer, party_size, starts_at, ends_at)
SELECT id, 1, '{"name":"Kari","phone":"+47 900 00 000"}', 2, now() + interval '1 day', now() + interval '1 day 2 hours'
  FROM public.organizations WHERE slug = 'rollback-as';
INSERT INTO public.restaurant_reservation_tables (reservation_id, table_id)
SELECT r.id, t.id FROM public.restaurant_reservations r JOIN public.restaurant_tables t ON t.organization_id = r.organization_id;
INSERT INTO public.restaurant_reservation_events (reservation_id, action) SELECT id, 'reservation.booked' FROM public.restaurant_reservations;
INSERT INTO public.hotel_settings (organization_id, vat_rate) SELECT id, 12 FROM public.organizations WHERE slug = 'rollback-as';
INSERT INTO public.hotel_room_types (organization_id, name, capacity, nightly_price) SELECT id, 'Double', 2, 1120 FROM public.organizations WHERE slug = 'rollback-as';
INSERT INTO public.hotel_rooms (organization_id, room_type_id, name) SELECT organization_id, id, '101' FROM public.hotel_room_types;
INSERT INTO public.hotel_stays (organization_id, number, room_type_id, room_id, customer, guests, check_in, check_out, nightly_price, total, vat_rate)
SELECT organization_id, 1, room_type_id, id, '{"name":"Kari","phone":"+47 900 00 000"}', 2, current_date + 1, current_date + 3, 1120, 2240, 12
  FROM public.hotel_rooms;
INSERT INTO public.hotel_stay_events (stay_id, action) SELECT id, 'stay.booked' FROM public.hotel_stays;
-- 00020: a shop's delivery options, a product with a size and an unpaid
-- order holding it.
INSERT INTO public.shop_settings (organization_id, pickup_address)
SELECT id, 'Torget 1, 0150 Oslo' FROM public.organizations WHERE slug = 'rollback-as';
INSERT INTO public.shop_products (id, organization_id, name, price, track_stock, variant_label)
SELECT '5a000000-0000-0000-0000-000000000001', id, 'Mug', 199, true, 'Size' FROM public.organizations WHERE slug = 'rollback-as';
INSERT INTO public.shop_variants (id, product_id, organization_id, name, stock)
SELECT '5b000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', id, 'L', 2 FROM public.organizations WHERE slug = 'rollback-as';
INSERT INTO public.shop_orders (id, organization_id, number, customer_user_id, customer, delivery_method, items_total, total, expires_at)
SELECT '5c000000-0000-0000-0000-000000000001', id, 1, 'c0000000-0000-0000-0000-000000000002', '{"name":"Kari"}', 'pickup', 199, 199, now() + interval '1 hour'
  FROM public.organizations WHERE slug = 'rollback-as';
INSERT INTO public.shop_order_lines (order_id, line_no, product_id, variant_id, name, quantity, unit_price, vat_rate, total, stock_reserved)
VALUES ('5c000000-0000-0000-0000-000000000001', 1, '5a000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001',
        'Mug (L)', 1, 199, 25, 199, true);

-- What exists before the rollback, for the comparison afterwards.
CREATE TABLE public.zz_rollback_before AS
SELECT 'bookings' t, count(*) n FROM public.bookings
UNION ALL SELECT 'driver_subscriptions', count(*) FROM public.driver_subscriptions
UNION ALL SELECT 'driver_documents', count(*) FROM public.driver_documents
UNION ALL SELECT 'driver_locations', count(*) FROM public.driver_locations
UNION ALL SELECT 'driver_applications', count(*) FROM public.driver_applications
UNION ALL SELECT 'escrow_payments', count(*) FROM public.escrow_payments
UNION ALL SELECT 'driver_wallets', count(*) FROM public.driver_wallets;
