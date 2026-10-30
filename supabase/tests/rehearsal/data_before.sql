-- ============================================================================
-- Release rehearsal, part 1: representative data as production holds it
-- today (the replica with 00002–00015), before 00016–00022 are applied.
-- Synthetic only: invented people and companies, example.no addresses,
-- organisation numbers that pass MOD11 but belong to nobody here. Written
-- through the platform's own functions wherever one exists, committed.
--
--   A  Fjord Flytt AS      transport, Model A plan Branded booking page;
--                          a member in every role; moves in every status,
--                          paid by card, on invoice, refunded; FlyttGo's
--                          invoices to it, paid, part paid and credited
--   B  Bergen Rør AS       trades, plan Jobs: invoices in its own name
--                          (its own series), paid, part paid, credited
--   C  Salong Lys AS       appointments, plan Appointments; staff
--   D  Bistro Nord AS      restaurant (its plan comes with 00019)
--   E  Hotell Vest AS      hotel (00019)
--   F  Butikk Sør AS       shop (00020)
--   G  Kunde Bedrift AS    a business customer booking moves, no plan
-- ============================================================================
\set ON_ERROR_STOP 1

-- People: r…01–r…30 (rNN@example.no). FlyttGo's administrator and the
-- other test users come from helpers.sql.
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT ('10000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'r' || lpad(n::text, 2, '0') || '@example.no',
       jsonb_build_object('role', 'customer', 'first_name', (ARRAY['Kari','Ola','Ingrid','Lars','Nora','Emil','Sofie','Jonas','Maja','Henrik'])[1 + n % 10],
                          'last_name', 'Testesen ' || n)
  FROM generate_series(1, 30) n;

CREATE TABLE tests.rh (key text PRIMARY KEY, id uuid);
GRANT SELECT ON tests.rh TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION tests.rh_user(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('10000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION tests.rh_id(k text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT id FROM tests.rh WHERE key = k $$;
-- Act as a person (claims kept for the session, as PostgREST would for a request).
CREATE OR REPLACE FUNCTION tests.rh_as(p uuid) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false) $$;
CREATE OR REPLACE FUNCTION tests.rh_server() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
CREATE OR REPLACE FUNCTION tests.rh_admin() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', false) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- FlyttGo's seller details (as an administrator fills them in).
UPDATE public.platform_config SET config_value = v.v
  FROM (VALUES ('invoice_seller_name', 'FlyttGo AS'), ('invoice_seller_org_number', '923609016'),
               ('invoice_seller_address', 'Storgata 1'), ('invoice_seller_postcode_city', '0155 Oslo'),
               ('invoice_seller_bank_account', '1234.56.78903')) AS v(k, v)
 WHERE config_key = v.k;

-- ── The companies, created by their owners and activated by FlyttGo ───────
DO $$
DECLARE
  c record; v_org uuid;
BEGIN
  FOR c IN SELECT * FROM (VALUES
      ('A', 'Fjord Flytt AS',    'fjord-flytt',    '910000004', 'transport',     1),
      ('B', 'Bergen Rør AS',     'bergen-ror',     '910000012', 'field_service', 6),
      ('C', 'Salong Lys AS',     'salong-lys',     '910000020', 'appointments',  12),
      ('D', 'Bistro Nord AS',    'bistro-nord',    '910000039', 'hospitality',   15),
      ('E', 'Hotell Vest AS',    'hotell-vest',    '910000047', 'hospitality',   16),
      ('F', 'Butikk Sør AS',     'butikk-sor',     '910000055', 'retail',        17),
      ('G', 'Kunde Bedrift AS',  'kunde-bedrift',  '910000063', 'transport',     18)) AS t(k, name, slug, orgnr, industry, owner)
  LOOP
    PERFORM tests.rh_as(tests.rh_user(c.owner));
    SELECT id INTO v_org FROM public.create_organization(c.name, c.slug, c.orgnr, 'faktura@' || c.slug || '.example.no');
    PERFORM public.set_organization_industry(v_org, c.industry);
    PERFORM public.update_organization(v_org, jsonb_build_object('vat_registered', true,
      'billing_address', 'Testveien ' || c.owner || ', 0150 Oslo'));
    PERFORM tests.rh_admin();
    PERFORM public.record_organization_verification(v_org, 'manual', true, jsonb_build_object('evidence', 'rehearsal: synthetic company'));
    PERFORM public.admin_set_organization_status(v_org, 'active', 'rehearsal');
    INSERT INTO tests.rh VALUES ('org_' || c.k, v_org), ('owner_' || c.k, tests.rh_user(c.owner));
  END LOOP;
END $$;

-- Members in every role (as the database owner; the invitation flow has
-- its own suite). A: admin r02, booker r03, finance r04, viewer r05.
-- B: admin r07, finance r08, booker r09, viewer r10, staff r11.
-- C: staff r13, booker r14. G: booker r19.
INSERT INTO public.organization_members (organization_id, user_id, role)
SELECT tests.rh_id('org_' || k), tests.rh_user(n), role FROM (VALUES
  ('A', 2, 'admin'), ('A', 3, 'booker'), ('A', 4, 'finance'), ('A', 5, 'viewer'),
  ('B', 7, 'admin'), ('B', 8, 'finance'), ('B', 9, 'booker'), ('B', 10, 'viewer'), ('B', 11, 'staff'),
  ('C', 13, 'staff'), ('C', 14, 'booker'), ('G', 19, 'booker')) AS m(k, n, role);

-- ── Plans: A on Branded (Model A), B on Jobs, C on Appointments ───────────
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES ('A', 'branded', 'Fjord Flytt'), ('B', 'jobs', 'Bergen Rør'), ('C', 'appointments', 'Salong Lys')) AS t(k, plan, display) LOOP
    PERFORM tests.rh_as(tests.rh_id('owner_' || c.k));
    PERFORM public.request_white_label(tests.rh_id('org_' || c.k), c.plan);
    PERFORM public.set_white_label_brand(tests.rh_id('org_' || c.k), c.display, '#0055aa', '#ffcc00', NULL,
      'post@' || lower(replace(c.display, ' ', '-')) || '.example.no', '+47 22 33 44 55',
      'https://' || lower(replace(replace(c.display, ' ', '-'), 'ø', 'o')) || '.example.no/vilkar',
      'https://' || lower(replace(replace(c.display, ' ', '-'), 'ø', 'o')) || '.example.no/personvern', 0);
    IF c.plan <> 'branded' THEN PERFORM public.accept_white_label_dpa(tests.rh_id('org_' || c.k), '2026-10-draft'); END IF;
    PERFORM tests.rh_admin();
    PERFORM public.admin_decide_white_label(tests.rh_id('org_' || c.k), true, NULL);
  END LOOP;
  -- FlyttGo switches invoicing on for A and G (bookings on the company's invoice).
  PERFORM public.admin_set_invoicing(tests.rh_id('org_A'), true, NULL, 'standard');
  PERFORM public.admin_set_invoicing(tests.rh_id('org_G'), true, NULL, 'standard');
END $$;

-- ── Moves in every status: A's booker, and a private customer (r20) ───────
DO $$
DECLARE s text; v uuid; i int := 0;
BEGIN
  FOREACH s IN ARRAY ARRAY['pending', 'confirmed', 'driver_assigned', 'pickup_arrived', 'loading', 'in_transit', 'completed', 'cancelled'] LOOP
    i := i + 1;
    -- A company move by A's booker, paid on A's invoice (book_on_invoice, as the server does).
    PERFORM tests.rh_as(tests.rh_user(3));
    INSERT INTO public.bookings (customer_id, organization_id, price_estimate, original_price, estimated_hours,
                                 pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, van_type, pickup_city, dropoff_city,
                                 customer_name, customer_email, move_date)
    VALUES (tests.rh_user(3), tests.rh_id('org_A'), 1000 + 100 * i, 1000 + 100 * i, 2, 59.91, 10.75, 60.39, 5.32, 'medium_van',
            'Oslo', 'Bergen', 'Ingrid Testesen', 'r03@example.no', current_date + i)
    RETURNING id INTO v;
    INSERT INTO public.escrow_payments (booking_id, amount, original_amount, status) VALUES (v, 1000 + 100 * i, 1000 + 100 * i, 'held');
    PERFORM tests.rh_server();
    PERFORM public.book_on_invoice(v, tests.rh_user(3));
    PERFORM set_config('request.jwt.claims', '', false);
    UPDATE public.bookings SET status = s,
           driver_id = CASE WHEN s NOT IN ('pending', 'confirmed', 'cancelled') THEN 'd1000000-0000-0000-0000-000000000001'::uuid END,
           end_time = CASE WHEN s = 'completed' THEN now() END
     WHERE id = v;
    INSERT INTO tests.rh VALUES ('move_A_' || s, v);
    -- A private move by r20, paid by card (the webhook's update and its event).
    PERFORM tests.rh_as(tests.rh_user(20));
    INSERT INTO public.bookings (customer_id, price_estimate, original_price, estimated_hours,
                                 pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, van_type, pickup_city, dropoff_city, move_date)
    VALUES (tests.rh_user(20), 2000 + 100 * i, 2000 + 100 * i, 3, 59.91, 10.75, 59.95, 10.80, 'large_van', 'Oslo', 'Oslo', current_date + i)
    RETURNING id INTO v;
    INSERT INTO public.escrow_payments (booking_id, amount, original_amount, status) VALUES (v, 2000 + 100 * i, 2000 + 100 * i, 'held');
    PERFORM set_config('request.jwt.claims', '', false);
    IF s <> 'pending' THEN
      UPDATE public.bookings SET payment_status = 'paid', payment_provider = 'stripe', payment_intent_id = 'pi_rh_' || i,
             stripe_session_id = 'cs_rh_' || i, paid_amount = 2000 + 100 * i, paid_at = now(), captured_at = now(),
             captured_amount = 2000 + 100 * i
       WHERE id = v;
      UPDATE public.escrow_payments SET status = 'escrow' WHERE booking_id = v;
      INSERT INTO public.payment_events (provider, event_id, kind, booking_id) VALUES ('stripe', 'evt_rh_' || i, 'checkout.session.completed', v);
    END IF;
    UPDATE public.bookings SET status = s,
           driver_id = CASE WHEN s NOT IN ('pending', 'confirmed', 'cancelled') THEN 'd1000000-0000-0000-0000-000000000002'::uuid END,
           end_time = CASE WHEN s = 'completed' THEN now() END
     WHERE id = v;
    INSERT INTO tests.rh VALUES ('move_P_' || s, v);
  END LOOP;
  -- The cancelled private move was refunded in full (refund recorded once, by the server).
  PERFORM tests.rh_server();
  PERFORM public.refund_mark((SELECT id FROM public.refund_request_begin(tests.rh_id('move_P_cancelled'), 2800, NULL, 'cancelled more than 24 h ahead')),
                             'succeeded', 're_rh_1', NULL);
  -- G's booker books a move on G's invoice.
  PERFORM tests.rh_as(tests.rh_user(19));
  INSERT INTO public.bookings (customer_id, organization_id, price_estimate, original_price, estimated_hours,
                               pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, van_type, pickup_city, dropoff_city, move_date)
  VALUES (tests.rh_user(19), tests.rh_id('org_G'), 3100, 3100, 2, 59.91, 10.75, 63.43, 10.39, 'large_van', 'Oslo', 'Trondheim', current_date + 9)
  RETURNING id INTO v;
  INSERT INTO public.escrow_payments (booking_id, amount, original_amount, status) VALUES (v, 3100, 3100, 'held');
  PERFORM tests.rh_server();
  PERFORM public.book_on_invoice(v, tests.rh_user(19));
  INSERT INTO tests.rh VALUES ('move_G', v);
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

-- ── FlyttGo's invoices (its own series) to A and G ────────────────────────
DO $$
DECLARE d public.invoices; i public.invoices;
BEGIN
  PERFORM tests.rh_admin();
  -- A: the completed move on invoice, paid by bank.
  d := public.create_invoice_draft(tests.rh_id('org_A'), ARRAY[tests.rh_id('move_A_completed')]);
  i := public.issue_invoice(d.id);
  PERFORM public.record_invoice_payment(i.id, i.total, current_date, 'bank', 'rh-bank-flyttgo-1');
  INSERT INTO tests.rh VALUES ('inv_F_paid', i.id);
  -- A: the plan fee by hand, part paid.
  d := public.create_invoice_draft(tests.rh_id('org_A'), '{}');
  PERFORM public.add_invoice_line(d.id, 'Plan Branded booking page, monthly', 1, 1490, 25);
  i := public.issue_invoice(d.id);
  PERFORM public.record_invoice_payment(i.id, 500, current_date, 'bank', 'rh-bank-flyttgo-2');
  INSERT INTO tests.rh VALUES ('inv_F_part', i.id);
  -- A: an invoice credited in full.
  d := public.create_invoice_draft(tests.rh_id('org_A'), '{}');
  PERFORM public.add_invoice_line(d.id, 'Packing material', 2, 400, 25);
  i := public.issue_invoice(d.id);
  PERFORM public.create_credit_note(i.id, NULL, 'Charged twice');
  INSERT INTO tests.rh VALUES ('inv_F_credited', i.id);
  -- G: open, to be paid through a bank file after 00016.
  d := public.create_invoice_draft(tests.rh_id('org_G'), ARRAY[tests.rh_id('move_G')]);
  i := public.issue_invoice(d.id);
  INSERT INTO tests.rh VALUES ('inv_F_open', i.id);
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

-- ── Invoices in B's own name (the company's series) ───────────────────────
DO $$
DECLARE i public.invoices; n int;
BEGIN
  PERFORM tests.rh_as(tests.rh_id('owner_B'));
  PERFORM public.set_invoice_settings(tests.rh_id('org_B'),
    '{"legal_name":"Bergen Rør AS","address":"Verkstedveien 4","postcode_city":"5003 Bergen","bank_account":"15061234567","terms_days":14,"reminder_fee":35}');
  FOR n IN 1..6 LOOP
    i := public.create_sales_invoice(tests.rh_id('org_B'),
      jsonb_build_object('name', 'Kunde ' || n, 'email', 'kunde' || n || '@example.no', 'address', 'Kundeveien ' || n, 'postcode_city', '5003 Bergen'),
      NULL, jsonb_build_array(jsonb_build_object('description', 'Rørleggerarbeid', 'quantity', n, 'unit_price', 850, 'vat_rate', 25),
                              jsonb_build_object('description', 'Materiell', 'quantity', 1, 'unit_price', 300, 'vat_rate', 25)), NULL, NULL);
    i := public.issue_invoice(i.id);
    INSERT INTO tests.rh VALUES ('inv_B_' || n, i.id);
  END LOOP;
  PERFORM public.record_invoice_payment(tests.rh_id('inv_B_1'), (SELECT total FROM public.invoices WHERE id = tests.rh_id('inv_B_1')), current_date, 'bank', 'rh-bank-b-1');
  PERFORM public.record_invoice_payment(tests.rh_id('inv_B_2'), 400, current_date, 'bank', 'rh-bank-b-2');
  PERFORM public.create_credit_note(tests.rh_id('inv_B_3'), NULL, 'Reklamasjon');
  PERFORM public.create_credit_note(tests.rh_id('inv_B_4'), 200, 'Prisavslag');
  -- C's own invoice settings, and one invoice.
  PERFORM tests.rh_as(tests.rh_id('owner_C'));
  PERFORM public.set_invoice_settings(tests.rh_id('org_C'),
    '{"legal_name":"Salong Lys AS","address":"Torget 2","postcode_city":"0150 Oslo","bank_account":"15061234568"}');
  i := public.create_sales_invoice(tests.rh_id('org_C'), '{"name":"Kunde Salong"}', NULL,
    '[{"description":"Klipp","quantity":1,"unit_price":650,"vat_rate":25}]', NULL, NULL);
  i := public.issue_invoice(i.id);
  INSERT INTO tests.rh VALUES ('inv_C_1', i.id);
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

-- ── B's job services and a job; C's services, staff hours and appointments ─
DO $$
DECLARE v_svc uuid; j public.jobs; a public.appointments;
BEGIN
  PERFORM tests.rh_as(tests.rh_id('owner_B'));
  SELECT id INTO v_svc FROM public.save_job_service(tests.rh_id('org_B'), NULL, '{"name":"Bytte blandebatteri","price_type":"fixed","price":1875,"sort":1}');
  PERFORM public.save_job_service(tests.rh_id('org_B'), NULL, '{"name":"Baderom","price_type":"quote","sort":2}');
  j := public.create_job(tests.rh_id('org_B'), v_svc, '{"name":"Kunde Jobb","phone":"+47 900 00 030","email":"r30@example.no"}',
                         '{"address":"Bjerkelia 12","postcode":"1350","city":"Lommedalen"}', 'drypper', NULL);
  INSERT INTO tests.rh VALUES ('job_B', j.id);
  PERFORM tests.rh_as(tests.rh_id('owner_C'));
  PERFORM public.save_appointment_settings(tests.rh_id('org_C'), '{"cancel_hours":24,"slot_step_minutes":15,"horizon_days":60,"min_notice_minutes":60,"no_show_fee":300}');
  SELECT id INTO v_svc FROM public.save_appointment_service(tests.rh_id('org_C'), NULL, '{"name":"Klipp","duration_minutes":45,"buffer_minutes":15,"price":650}');
  PERFORM public.save_appointment_resource(tests.rh_id('org_C'), NULL, jsonb_build_object('name', 'Frisør Maja', 'user_id', tests.rh_user(13),
    'service_ids', jsonb_build_array(v_svc),
    'hours', (SELECT jsonb_agg(jsonb_build_object('weekday', d, 'start', '09:00', 'end', '17:00')) FROM generate_series(1, 7) d)));
  a := public.create_appointment(tests.rh_id('org_C'), v_svc, NULL,
         (((now() AT TIME ZONE 'Europe/Oslo')::date + 3) + time '10:00') AT TIME ZONE 'Europe/Oslo',
         '{"name":"Kunde Salong","phone":"+47 900 00 029","email":"r29@example.no"}', NULL);
  INSERT INTO tests.rh VALUES ('appointment_C', a.id);
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

\echo 'rehearsal data before 00016: written'
