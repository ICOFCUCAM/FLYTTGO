-- ============================================================================
-- Appointments (supabase/migrations/00013_appointments.sql)
-- Acme is a salon on the Appointments plan (tests.sp_acme); cust1 owns it,
-- drv1 is its booker, e…01 a hairdresser (staff), cust2 a customer.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''
\set worker  '''e0000000-0000-0000-0000-000000000001'''

-- Acme on Appointments: settings (24 h notice, 15-minute steps, a no-show
-- fee), invoice settings, a haircut (45 min + 15 buffer, 650 kr) and Eva
-- (the worker) working 09–17 every day. Claims kept.
CREATE OR REPLACE FUNCTION tests.ap_acme() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid; v_svc uuid; v_claims text := current_setting('request.jwt.claims', true);
BEGIN
  v_org := tests.sp_acme('appointments', 'appointments');
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (v_org, 'e0000000-0000-0000-0000-000000000001', 'staff');
  PERFORM tests.login('c0000000-0000-0000-0000-000000000001');
  PERFORM public.save_appointment_settings(v_org, '{"cancel_hours":24,"slot_step_minutes":15,"horizon_days":60,"min_notice_minutes":60,"no_show_fee":300}');
  PERFORM public.set_invoice_settings(v_org, '{"legal_name":"Acme Frisør AS","address":"Torget 1","postcode_city":"0150 Oslo","bank_account":"15061234567"}');
  SELECT id INTO v_svc FROM public.save_appointment_service(v_org, NULL, '{"name":"Haircut","duration_minutes":45,"buffer_minutes":15,"price":650}');
  PERFORM public.save_appointment_resource(v_org, NULL, jsonb_build_object('name', 'Eva', 'user_id', 'e0000000-0000-0000-0000-000000000001',
    'service_ids', jsonb_build_array(v_svc),
    'hours', (SELECT jsonb_agg(jsonb_build_object('weekday', d, 'start', '09:00', 'end', '17:00')) FROM generate_series(1, 7) d)));
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN v_org;
END $$;
CREATE OR REPLACE FUNCTION tests.haircut() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT id FROM public.appointment_services WHERE name = 'Haircut'; $$;
CREATE OR REPLACE FUNCTION tests.eva() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT id FROM public.appointment_resources WHERE name = 'Eva'; $$;
-- 10:00 Oslo time three days from now.
CREATE OR REPLACE FUNCTION tests.at(p_days int, p_time time) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT (((now() AT TIME ZONE 'Europe/Oslo')::date + p_days) + p_time) AT TIME ZONE 'Europe/Oslo';
$$;
CREATE OR REPLACE FUNCTION tests.ap_contact() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"name":"Kari","phone":"+47 900 00 000","email":"cust2@test"}'::jsonb; $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── Free times and booking ─────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.ap_acme() AS id;
GRANT SELECT ON o TO anon, service_role;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT count(*) FROM public.available_slots((SELECT id FROM o), tests.haircut(), ((now() AT TIME ZONE 'Europe/Oslo')::date + 3))) = 30,
  'visitors see 30 free times on a day of 09–17 (45-minute service, 15-minute steps)');
SELECT tests.ok((SELECT count(*) FROM public.appointment_services) = 1 AND (SELECT count(*) FROM public.appointment_hours) = 7,
  'and the services and opening hours');
SELECT tests.throws($$SELECT public.book_appointment((SELECT id FROM o), tests.haircut(), NULL, tests.at(3, '10:00'), tests.ap_contact(), NULL)$$, '42501',
  'visitors sign in to book');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust2);
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.book_appointment((SELECT id FROM o), tests.haircut(), NULL, tests.at(3, '10:00'), tests.ap_contact(), 'short');
GRANT SELECT ON a TO service_role;
SELECT tests.ok((SELECT resource_id FROM a) = tests.eva() AND (SELECT price FROM a) = 650 AND (SELECT number FROM a) = 1
                AND (SELECT ends_at - starts_at FROM a) = interval '45 minutes',
  'the customer books 10:00; any free staff member is chosen');
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.available_slots((SELECT id FROM o), tests.haircut(), ((now() AT TIME ZONE 'Europe/Oslo')::date + 3))
                             WHERE starts_at BETWEEN tests.at(3, '09:15') AND tests.at(3, '10:45')),
  'the time, the 15-minute buffer and overlapping starts are gone');
SELECT tests.throws($$SELECT public.book_appointment((SELECT id FROM o), tests.haircut(), tests.eva(), tests.at(3, '10:30'), tests.ap_contact(), NULL)$$, '55000',
  'nobody can book over it');
SELECT tests.throws($$SELECT public.book_appointment((SELECT id FROM o), tests.haircut(), NULL, tests.at(3, '10:05'), tests.ap_contact(), NULL)$$, '55000',
  'only offered times can be booked');
SELECT tests.throws($$SELECT public.book_appointment((SELECT id FROM o), tests.haircut(), NULL, tests.at(90, '10:00'), tests.ap_contact(), NULL)$$, '55000',
  'nor beyond the booking horizon');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.create_appointment((SELECT id FROM o), tests.haircut(), tests.eva(), tests.at(3, '10:15'), tests.ap_contact(), NULL)$$, '55000',
  'the company cannot double-book either');
SELECT tests.ok((SELECT starts_at FROM public.create_appointment((SELECT id FROM o), tests.haircut(), tests.eva(), tests.at(3, '18:00'), tests.ap_contact(), 'after hours'))
                = tests.at(3, '18:00'), 'but may book a phone customer outside the hours');
SELECT tests.login(:cust1);
SELECT public.add_appointment_time_off(tests.eva(), tests.at(4, '00:00'), tests.at(5, '00:00'), 'holiday');
SELECT tests.ok((SELECT count(*) FROM public.available_slots((SELECT id FROM o), tests.haircut(), ((now() AT TIME ZONE 'Europe/Oslo')::date + 4))) = 0,
  'time off removes the day');
ROLLBACK;

-- ── Cancelling, closing, invoicing; who sees what ──────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.ap_acme() AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.book_appointment((SELECT id FROM o), tests.haircut(), NULL, tests.at(3, '10:00'), tests.ap_contact(), NULL);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT * FROM public.book_appointment((SELECT id FROM o), tests.haircut(), NULL, tests.at(3, '12:00'), tests.ap_contact(), NULL);
GRANT SELECT ON o, a, b TO service_role;
SELECT tests.ok((SELECT cancelled_by FROM public.cancel_appointment((SELECT id FROM b), 'ill')) = 'customer', 'the customer cancels three days ahead');
SELECT tests.login(:worker);
SELECT tests.ok((SELECT count(*) FROM public.appointments) = 2, 'the hairdresser sees the appointments in their calendar');
SELECT tests.throws($$SELECT public.close_appointment((SELECT id FROM a), 'completed')$$, '55000', 'an appointment is closed after it starts');
-- Move it into the past (as the server) to close it.
SET LOCAL ROLE service_role;
SELECT tests.as_server();
UPDATE public.appointments SET starts_at = now() - interval '2 hours', ends_at = now() - interval '75 minutes', blocked_until = now() - interval '1 hour'
 WHERE id = (SELECT id FROM a);
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.cancel_appointment((SELECT id FROM a), 'late')$$, '55000', 'the customer cannot cancel after the notice');
SELECT tests.login(:worker);
SELECT tests.ok((SELECT status FROM public.close_appointment((SELECT id FROM a), 'no_show')) = 'no_show', 'the hairdresser marks a no-show');
SELECT tests.throws($$SELECT public.invoice_appointment((SELECT id FROM a))$$, '42501', 'staff do not invoice');
SELECT tests.login(:cust1);
CREATE TEMP TABLE inv ON COMMIT DROP AS SELECT * FROM public.invoice_appointment((SELECT id FROM a));
SELECT tests.ok((SELECT total FROM inv) = 300 AND (SELECT seller ->> 'name' FROM inv) = 'Acme Frisør AS'
                AND (SELECT customer_user_id FROM inv) = :cust2,
  'the owner invoices the no-show fee in the company''s name');
SELECT tests.throws($$SELECT public.invoice_appointment((SELECT id FROM a))$$, '55000', 'once');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.appointment_events WHERE appointment_id = (SELECT id FROM a)) >= 3, 'every step is logged');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.save_appointment_service((SELECT id FROM o), NULL, '{"name":"X","duration_minutes":30,"price":1}')$$, '42501',
  'FlyttGo administrators do not change a company''s services');
ROLLBACK;

-- ── Reminders (server) ─────────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.ap_acme() AS id;
SELECT tests.login(:drv1);
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.create_appointment((SELECT id FROM o), tests.haircut(), tests.eva(),
  date_trunc('minute', now() + interval '24 hours'), tests.ap_contact(), NULL);
GRANT SELECT ON a TO service_role;
SELECT tests.throws($$SELECT * FROM public.appointments_to_remind()$$, '42501', 'only the server lists reminders');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((SELECT count(*) FROM public.appointments_to_remind()) = 1, 'an appointment tomorrow is due a reminder');
SELECT public.mark_appointment_reminded((SELECT id FROM a));
SELECT tests.ok((SELECT count(*) FROM public.appointments_to_remind()) = 0, 'once');
ROLLBACK;

\echo 'appointments: all tests passed'
