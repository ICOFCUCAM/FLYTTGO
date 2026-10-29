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

-- What exists before the rollback, for the comparison afterwards.
CREATE TABLE public.zz_rollback_before AS
SELECT 'bookings' t, count(*) n FROM public.bookings
UNION ALL SELECT 'driver_subscriptions', count(*) FROM public.driver_subscriptions
UNION ALL SELECT 'driver_documents', count(*) FROM public.driver_documents
UNION ALL SELECT 'driver_locations', count(*) FROM public.driver_locations
UNION ALL SELECT 'driver_applications', count(*) FROM public.driver_applications
UNION ALL SELECT 'escrow_payments', count(*) FROM public.escrow_payments
UNION ALL SELECT 'driver_wallets', count(*) FROM public.driver_wallets;
