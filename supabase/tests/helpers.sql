-- Test helpers: act as a user the way PostgREST does (role + JWT claims)
-- and assert outcomes. Loaded after the migrations.

CREATE SCHEMA IF NOT EXISTS tests;
GRANT USAGE ON SCHEMA tests TO anon, authenticated, service_role;

-- Set the JWT claims for the rest of the transaction. Pair with
-- `SET LOCAL ROLE authenticated` (or anon / service_role).
CREATE OR REPLACE FUNCTION tests.login(p_user uuid, p_role text DEFAULT 'authenticated')
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', p_role)::text, true);
$$;

CREATE OR REPLACE FUNCTION tests.ok(p_cond boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'ok - %', p_label;
END $$;

-- Runs p_sql and expects it to fail (with p_code when given).
CREATE OR REPLACE FUNCTION tests.throws(p_sql text, p_code text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF p_code IS NOT NULL AND SQLSTATE <> p_code THEN
      RAISE EXCEPTION 'FAIL: % — expected SQLSTATE %, got % (%)', p_label, p_code, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'ok - % (refused: %)', p_label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % — statement succeeded', p_label;
END $$;

-- Number of rows an UPDATE touched, as the current user.
CREATE OR REPLACE FUNCTION tests.rows(p_sql text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── Fixture: people and records, created as the database owner ──
--   a…01 admin          c…01 customer (signed up asking for 'admin')
--   c…02 other customer d…01 driver 1     d…02 driver 2
--   e…01 applicant

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@test',   '{"role":"customer"}'),
  ('c0000000-0000-0000-0000-000000000001', 'cust1@test',   '{"role":"admin","first_name":"Cee"}'),
  ('c0000000-0000-0000-0000-000000000002', 'cust2@test',   '{"role":"customer"}'),
  ('d0000000-0000-0000-0000-000000000001', 'drv1@test',    '{"role":"driver"}'),
  ('d0000000-0000-0000-0000-000000000002', 'drv2@test',    '{"role":"driver"}'),
  ('e0000000-0000-0000-0000-000000000001', 'apply@test',   '{"role":"driver"}');

INSERT INTO public.admin_accounts (user_id) VALUES ('a0000000-0000-0000-0000-000000000001');

INSERT INTO public.driver_profiles (id, user_id, full_name, status, online, city) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Driver One', 'approved', true, 'Oslo'),
  ('d1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'Driver Two', 'approved', true, 'Oslo');

INSERT INTO public.driver_wallets (driver_id, balance, total_earned) VALUES
  ('d1000000-0000-0000-0000-000000000001', 1000, 1000);

INSERT INTO public.driver_applications (id, user_id, first_name, status) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'App', 'pending');

-- b…01 C1 unpaid · b…02 C1 paid · b…03 C2 paid
INSERT INTO public.bookings (id, customer_id, status, payment_status, price_estimate, original_price,
                             estimated_hours, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, van_type) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'pending', 'pending', 2875, 2875, 2, 59.91, 10.75, 59.95, 10.80, 'medium_van'),
  ('b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'pending', 'paid',    2875, 2875, 2, 59.91, 10.75, 59.95, 10.80, 'medium_van'),
  ('b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 'pending', 'paid',    2875, 2875, 2, 59.91, 10.75, 59.95, 10.80, 'medium_van');

INSERT INTO public.escrow_payments (booking_id, status, amount, original_amount) VALUES
  ('b0000000-0000-0000-0000-000000000002', 'escrow', 2875, 2875),
  ('b0000000-0000-0000-0000-000000000003', 'escrow', 2875, 2875);

INSERT INTO public.platform_config (config_key, config_value) VALUES ('commission_default', '20');
