-- ============================================================================
-- API keys and the booking widget (supabase/migrations/00018_api_keys.sql)
-- Each block runs in its own transaction and rolls back. Uses the fixtures
-- of the earlier suites: tests.acme(), tests.activate(), tests.seller()
-- (cust1 owns Acme, drv1 is its booker, cust2 is outside), tests.jobs_acme()
-- and tests.ap_acme().
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''

-- Acme (transport) active, with invoicing switched on by FlyttGo. Claims kept.
CREATE OR REPLACE FUNCTION tests.api_acme() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid; v_claims text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM tests.seller();
  v_org := tests.acme();
  PERFORM tests.activate(v_org);
  PERFORM tests.login('a0000000-0000-0000-0000-000000000001');
  PERFORM public.admin_set_invoicing(v_org, true, NULL, 'standard');
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN v_org;
END $$;
-- Beta (transport), owned by cust2, active with invoicing. Claims kept.
CREATE OR REPLACE FUNCTION tests.api_beta() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid; v_claims text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM tests.login('c0000000-0000-0000-0000-000000000002');
  SELECT id INTO v_org FROM public.create_organization('Beta AS', 'beta', '974760673', 'post@beta.no');
  PERFORM public.set_organization_industry(v_org, 'transport');
  PERFORM tests.activate(v_org);
  PERFORM tests.login('a0000000-0000-0000-0000-000000000001');
  PERFORM public.admin_set_invoicing(v_org, true, NULL, 'standard');
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN v_org;
END $$;
-- The hash the public-api function sends (hex SHA-256 of the key).
CREATE OR REPLACE FUNCTION tests.key_hash(p_key text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
$$;
-- A move as the API sends it, priced by the server.
CREATE OR REPLACE FUNCTION tests.api_move(p_price numeric DEFAULT 2875) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'pickup',  jsonb_build_object('address', 'Storgata 1, 0155 Oslo', 'postcode', '0155', 'city', 'Oslo', 'lat', 59.91, 'lng', 10.75),
    'dropoff', jsonb_build_object('address', 'Bryggen 2, 5003 Bergen', 'postcode', '5003', 'city', 'Bergen', 'lat', 60.39, 'lng', 5.32),
    'contact', jsonb_build_object('name', 'Ola Lager', 'phone', '+47 900 00 001', 'email', 'lager@acme.no'),
    'van_type', 'medium_van', 'helpers', 1, 'estimated_hours', 2, 'move_type', 'office', 'move_date', current_date + 7,
    'move_time', '09:00', 'additional_services', '[]'::jsonb, 'notes', 'PO-4711', 'price', p_price, 'distance_km', 7.4);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── A key: shown once, stored as its hash, verified by the hash ───────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.api_acme() AS id;
SELECT tests.login(:cust1);
CREATE TEMP TABLE k ON COMMIT DROP AS
  SELECT public.create_api_key((SELECT id FROM o), '  ERP  ', ARRAY['bookings:read', 'quotes', 'quotes']) AS r;
GRANT SELECT ON o, k TO service_role;
SELECT tests.ok((SELECT r ->> 'key' FROM k) ~ '^fgo_[0-9a-f]{64}$', 'a key is fgo_ and 64 random hex characters, returned once');
SELECT tests.ok((SELECT r ->> 'prefix' FROM k) = left((SELECT r ->> 'key' FROM k), 12) AND (SELECT r ->> 'name' FROM k) = 'ERP',
  'its visible prefix is the first 12 characters; the name is trimmed');
SELECT tests.ok((SELECT r -> 'scopes' FROM k) = '["quotes", "bookings:read"]'::jsonb, 'scopes are de-duplicated and kept in order');
SELECT tests.ok((SELECT prefix FROM public.api_keys) = (SELECT r ->> 'prefix' FROM k) AND (SELECT created_by FROM public.api_keys) = :cust1,
  'the owner reads the key in the list (prefix, creator), not the key itself');
SELECT tests.throws($$SELECT key_hash FROM public.api_keys$$, '42501', 'the hash is not readable from the browser');
SELECT tests.ok((SELECT action FROM public.api_events) = 'key.created', 'creating the key is in the key log');
SET LOCAL ROLE postgres;
SELECT tests.ok((SELECT key_hash FROM public.api_keys) = tests.key_hash((SELECT r ->> 'key' FROM k))
                AND NOT EXISTS (SELECT 1 FROM public.api_keys WHERE key_hash LIKE '%' || substr((SELECT r ->> 'key' FROM k), 13) || '%'),
  'only the SHA-256 of the key is stored');
SELECT tests.ok(tests.key_hash('fgo_' || repeat('0', 64)) = 'e0412e5c3e245923870fa304e2b239640311ec83c5cb49a88f0bd7e350e1ef17',
  'the hash is hex SHA-256 of the UTF-8 key (the same vector as src/test/public-api.test.ts)');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
CREATE TEMP TABLE c ON COMMIT DROP AS SELECT public.api_begin(tests.key_hash((SELECT r ->> 'key' FROM k)), 'quotes') AS r;
SELECT tests.ok((SELECT (r ->> 'ok')::boolean AND (r ->> 'organization_id')::uuid = (SELECT id FROM o) AND (r ->> 'acting_user')::uuid = :cust1 FROM c),
  'the server finds the key by its hash: the company, and the member it acts as');
SELECT tests.ok((SELECT last_used_at IS NOT NULL FROM public.api_keys), 'its last use is recorded');
SELECT tests.ok((SELECT r ->> 'error' FROM (SELECT public.api_begin(tests.key_hash((SELECT r ->> 'key' FROM k) || 'x'), 'quotes') AS r) x) = 'invalid_key',
  'any other key is not valid');
SELECT tests.ok((SELECT r ->> 'error' = 'scope_missing' AND (r ->> 'status')::int = 403
                   FROM (SELECT public.api_begin(tests.key_hash((SELECT r ->> 'key' FROM k)), 'bookings:write') AS r) x),
  'a scope the key lacks is refused (403)');
SELECT tests.ok((SELECT r ->> 'organization_id' FROM (SELECT public.api_begin(tests.key_hash((SELECT r ->> 'key' FROM k)), NULL) AS r) x) IS NOT NULL,
  'a request without a scope (who am I) only needs a valid key');
ROLLBACK;

-- ── Who creates keys; which scopes ─────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.throws($$SELECT public.create_api_key((SELECT id FROM o), 'ERP', ARRAY['quotes'])$$, '42501',
  'a pending company cannot have keys (is_active_org_member)');
SELECT tests.activate((SELECT id FROM o));
SELECT tests.ok(public.api_scopes_available((SELECT id FROM o)) = ARRAY['quotes', 'bookings:read'],
  'an active transport company without invoicing can use quotes and bookings:read');
SELECT tests.throws($$SELECT public.create_api_key((SELECT id FROM o), 'ERP', ARRAY['bookings:write'])$$, '55000',
  'bookings:write needs invoicing switched on by FlyttGo (API bookings are paid on invoice)');
SELECT tests.throws($$SELECT public.create_api_key((SELECT id FROM o), 'ERP', ARRAY['jobs'])$$, '55000',
  'jobs needs the module in the plan');
SELECT tests.throws($$SELECT public.create_api_key((SELECT id FROM o), 'ERP', ARRAY['bookings:delete'])$$, '22023', 'an unknown scope is refused');
SELECT tests.throws($$SELECT public.create_api_key((SELECT id FROM o), 'ERP', ARRAY[]::text[])$$, '22023', 'a key needs a scope');
SELECT tests.throws($$SELECT public.create_api_key((SELECT id FROM o), ' ', ARRAY['quotes'])$$, '22023', 'a key needs a name');
SELECT tests.throws($$SELECT public.create_api_key((SELECT id FROM o), 'ERP', ARRAY['quotes'], now() - interval '1 day')$$, '22023',
  'an expiry in the past is refused');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.create_api_key((SELECT id FROM o), 'ERP', ARRAY['quotes'])$$, '42501', 'a booker cannot create keys');
SELECT tests.ok((SELECT count(*) FROM public.api_keys) = 0, 'a booker does not see the company''s keys');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.create_api_key((SELECT id FROM o), 'ERP', ARRAY['quotes'])$$, '42501',
  'a FlyttGo administrator is not a member and creates no keys for a company');
SELECT tests.login(:admin);
SELECT public.admin_set_invoicing((SELECT id FROM o), true, NULL, 'standard');
SELECT tests.login(:cust1);
SELECT tests.ok(public.api_scopes_available((SELECT id FROM o)) = ARRAY['quotes', 'bookings:read', 'bookings:write'],
  'with invoicing on, bookings:write is available');
GRANT SELECT ON o TO anon;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.throws($$SELECT public.create_api_key((SELECT id FROM o), 'ERP', ARRAY['quotes'])$$, '42501', 'visitors cannot call it');
SELECT tests.throws($$SELECT count(*) FROM public.api_keys$$, '42501', 'visitors read no keys');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.api_begin('00', NULL)$$, '42501', 'only the server checks keys (api_begin)');
SELECT tests.throws($$SELECT public.api_write('00', 'job.create', '{}')$$, '42501', 'only the server writes through a key (api_write)');
SELECT tests.throws($$SELECT public.api_read('00', 'bookings.list')$$, '42501', 'only the server reads through a key (api_read)');
ROLLBACK;

-- ── Jobs and appointments: modules of the plan, as the key's creator ──────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.jobs_acme() AS id;
SELECT tests.login(:cust1);
SELECT tests.ok(public.api_scopes_available((SELECT id FROM o)) = ARRAY['quotes', 'bookings:read', 'jobs'],
  'the Jobs plan makes the jobs scope available (not appointments)');
CREATE TEMP TABLE k ON COMMIT DROP AS SELECT public.create_api_key((SELECT id FROM o), 'Website', ARRAY['jobs']) ->> 'key' AS key;
GRANT SELECT ON o, k TO service_role;
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok(jsonb_array_length(public.api_read(tests.key_hash((SELECT key FROM k)), 'jobs.services') -> 'data') = 3,
  'the key lists the company''s services');
CREATE TEMP TABLE j ON COMMIT DROP AS
  SELECT public.api_write(tests.key_hash((SELECT key FROM k)), 'job.create',
    jsonb_build_object('service_id', tests.svc('Replace a tap'), 'contact', tests.contact(), 'place', tests.place(),
                       'description', 'kitchen tap drips'), 'idem-1', 'h1') AS r;
SELECT tests.ok((SELECT r ->> 'status' FROM j) = 'accepted' AND (SELECT (r ->> 'agreed_price')::numeric FROM j) = 1875,
  'a job is created through create_job, at the service''s price');
SELECT tests.ok((SELECT created_by FROM public.jobs) = :cust1 AND (SELECT actor_id FROM public.job_events WHERE action = 'job.requested') = :cust1,
  'the job is made as the key''s creator (the job log names them)');
SELECT tests.ok((SELECT count(*) FROM public.api_events WHERE action = 'job.create' AND actor_id = :cust1) = 1, 'the write is in the key log');
SELECT tests.ok(jsonb_array_length(public.api_read(tests.key_hash((SELECT key FROM k)), 'jobs.list') -> 'data') = 1
                AND jsonb_array_length(public.api_read(tests.key_hash((SELECT key FROM k)), 'jobs.list', '{"status":"cancelled"}') -> 'data') = 0,
  'the key lists the company''s jobs, by status');
SELECT tests.ok(public.api_write(tests.key_hash((SELECT key FROM k)), 'job.create', '{}', 'idem-1', 'h1') ->> 'replayed' = 'true'
                AND (SELECT count(*) FROM public.jobs) = 1,
  'the same Idempotency-Key and request return the first answer, without a second job');
SELECT tests.throws($$SELECT public.api_write(tests.key_hash((SELECT key FROM k)), 'job.create', '{}', 'idem-1', 'h2')$$, '23505',
  'the same Idempotency-Key with a different request is refused');
SELECT tests.throws($$SELECT public.api_write(tests.key_hash((SELECT key FROM k)), 'job.create',
    jsonb_build_object('service_id', tests.svc('New socket'), 'contact', tests.contact(), 'place', tests.place()))$$, '55000',
  'the module''s own rules still apply (electrical work needs the authorisation)');
SELECT tests.throws($$SELECT public.api_write(tests.key_hash((SELECT key FROM k)), 'appointment.create', '{}')$$, '42501',
  'a key without the appointments scope cannot book appointments');
SELECT tests.ok(public.api_begin(tests.key_hash((SELECT key FROM k)), 'appointments') ->> 'error' = 'scope_missing', 'api_begin says why');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.ap_acme() AS id;
SELECT tests.login(:cust1);
CREATE TEMP TABLE k ON COMMIT DROP AS SELECT public.create_api_key((SELECT id FROM o), 'Website', ARRAY['appointments']) ->> 'key' AS key;
GRANT SELECT ON o, k TO service_role;
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((public.api_read(tests.key_hash((SELECT key FROM k)), 'appointments.services') #>> '{data,0,resources,0,name}') = 'Eva',
  'the key lists the services and who offers them');
CREATE TEMP TABLE s ON COMMIT DROP AS
  SELECT public.api_read(tests.key_hash((SELECT key FROM k)), 'appointments.slots',
    jsonb_build_object('service_id', tests.haircut(), 'date', (tests.at(3, '10:00') AT TIME ZONE 'Europe/Oslo')::date)) AS r;
SELECT tests.ok(EXISTS (SELECT 1 FROM jsonb_array_elements((SELECT r -> 'data' FROM s)) e WHERE (e ->> 'starts_at')::timestamptz = tests.at(3, '10:00')),
  'free times come from available_slots');
CREATE TEMP TABLE a ON COMMIT DROP AS
  SELECT public.api_write(tests.key_hash((SELECT key FROM k)), 'appointment.create',
    jsonb_build_object('service_id', tests.haircut(), 'starts_at', tests.at(3, '10:00'), 'contact', tests.ap_contact())) AS r;
SELECT tests.ok((SELECT (r ->> 'starts_at')::timestamptz FROM a) = tests.at(3, '10:00') AND (SELECT r ->> 'resource_id' FROM a)::uuid = tests.eva(),
  'a free time is booked through create_appointment');
SELECT tests.ok((SELECT created_by FROM public.appointments) = :cust1, 'as the key''s creator');
SELECT tests.throws($$SELECT public.api_write(tests.key_hash((SELECT key FROM k)), 'appointment.create',
    jsonb_build_object('service_id', tests.haircut(), 'starts_at', tests.at(3, '10:00'), 'contact', tests.ap_contact()))$$, '55000',
  'the same time cannot be booked twice');
SELECT tests.ok(public.api_read(tests.key_hash((SELECT key FROM k)), 'appointments.get', jsonb_build_object('id', (SELECT r ->> 'id' FROM a))) ->> 'status' = 'booked',
  'the key reads the appointment back');
ROLLBACK;

-- ── A move on the company's invoice, as the key's creator ─────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.api_acme() AS id;
SELECT tests.login(:cust1);
CREATE TEMP TABLE k ON COMMIT DROP AS
  SELECT public.create_api_key((SELECT id FROM o), 'ERP', ARRAY['quotes', 'bookings:read', 'bookings:write']) ->> 'key' AS key;
GRANT SELECT ON o, k TO service_role;
SET LOCAL ROLE service_role;
SELECT tests.as_server();
CREATE TEMP TABLE b ON COMMIT DROP AS
  SELECT public.api_write(tests.key_hash((SELECT key FROM k)), 'booking.create', tests.api_move(), 'order-77', 'h-77') AS r;
SELECT tests.ok((SELECT r ->> 'payment_provider' = 'invoice' AND r ->> 'payment_status' = 'paid' AND r ->> 'object' = 'booking' FROM b),
  'the booking is paid on the company''s invoice (book_on_invoice) and goes to dispatch');
SELECT tests.ok((SELECT customer_id = :cust1 AND organization_id = (SELECT id FROM o) AND price_estimate = 2875 AND customer_name = 'Ola Lager'
                   FROM public.bookings WHERE id = (SELECT (r ->> 'id')::uuid FROM b)),
  'it is the company''s booking, made as the key''s creator, at the server''s price');
SELECT tests.ok((SELECT status FROM public.escrow_payments WHERE booking_id = (SELECT (r ->> 'id')::uuid FROM b)) = 'escrow',
  'the escrow row is there, as for a booking on invoice from the dashboard');
SELECT tests.ok((SELECT count(*) FROM public.organization_events WHERE action = 'booking.on_invoice') = 1, 'the company''s log records it');
SELECT tests.ok(NOT ((SELECT r FROM b) ?| ARRAY['driver_id', 'payment_intent_id', 'stripe_session_id', 'commission_amount', 'driver_earning']),
  'the answer carries no driver or payment provider fields');
SELECT tests.ok(public.api_write(tests.key_hash((SELECT key FROM k)), 'booking.create', tests.api_move(), 'order-77', 'h-77') ->> 'id'
                = (SELECT r ->> 'id' FROM b)
                AND (SELECT count(*) FROM public.bookings WHERE organization_id = (SELECT id FROM o)) = 1,
  'a retry with the same Idempotency-Key books nothing more');
SELECT tests.ok(jsonb_array_length(public.api_read(tests.key_hash((SELECT key FROM k)), 'bookings.list') -> 'data') = 1, 'the key lists the booking');
SET LOCAL ROLE postgres;
SELECT tests.login(:admin);
SELECT public.admin_set_invoicing((SELECT id FROM o), true, 3000, 'standard');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.throws($$SELECT public.api_write(tests.key_hash((SELECT key FROM k)), 'booking.create', tests.api_move(), 'order-78', 'h-78')$$, '55000',
  'the credit limit applies (book_on_invoice)');
SELECT tests.ok((SELECT count(*) FROM public.bookings WHERE organization_id = (SELECT id FROM o)) = 1
                AND NOT EXISTS (SELECT 1 FROM public.api_idempotency WHERE idempotency_key = 'order-78'),
  'a refused booking leaves nothing behind (no unpaid booking, no stored answer)');
SELECT tests.throws($$SELECT public.api_write(tests.key_hash((SELECT key FROM k)), 'booking.create', tests.api_move() - 'price')$$, '22023',
  'a booking is never made without the server''s price');
ROLLBACK;

-- ── Revoked, expired, inactive company, creator gone ──────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.api_acme() AS id;
SELECT tests.login(:cust1);
SELECT public.change_member_role((SELECT id FROM o), :drv1, 'admin');
CREATE TEMP TABLE k ON COMMIT DROP AS
  SELECT (public.create_api_key((SELECT id FROM o), 'One', ARRAY['quotes']) ->> 'key') AS one,
         (public.create_api_key((SELECT id FROM o), 'Two', ARRAY['quotes']) ->> 'key') AS two;
SELECT tests.login(:drv1);
INSERT INTO k (one, two) SELECT public.create_api_key((SELECT id FROM o), 'Drv', ARRAY['quotes', 'bookings:write']) ->> 'key', NULL;
GRANT SELECT ON o, k TO service_role;
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT revoked_at IS NOT NULL FROM public.revoke_api_key((SELECT id FROM public.api_keys WHERE name = 'One'), 'leaked')),
  'an owner revokes a key');
SELECT tests.throws($$SELECT public.revoke_api_key((SELECT id FROM public.api_keys WHERE name = 'One'))$$, '55000', 'once');
SELECT tests.throws($$SELECT public.update_api_key((SELECT id FROM public.api_keys WHERE name = 'One'), 'One', ARRAY['quotes'])$$, '55000',
  'a revoked key cannot be changed back into use');
SELECT tests.ok((SELECT details ->> 'reason' FROM public.api_events WHERE action = 'key.revoked') = 'leaked', 'the revocation and its reason are logged');
SELECT tests.throws($$UPDATE public.api_keys SET revoked_at = NULL$$, '42501', 'nobody un-revokes a key from the browser');
SET LOCAL ROLE postgres;
SELECT tests.throws($$DELETE FROM public.api_events$$, '42501', 'the key log is append-only, also for the database owner');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok(public.api_begin(tests.key_hash((SELECT one FROM k WHERE two IS NOT NULL)), 'quotes') ->> 'error' = 'key_revoked'
                AND (public.api_begin(tests.key_hash((SELECT one FROM k WHERE two IS NOT NULL)), 'quotes') ->> 'status')::int = 401,
  'a revoked key is refused (401)');
SELECT tests.throws($$SELECT public.api_write(tests.key_hash((SELECT one FROM k WHERE two IS NOT NULL)), 'booking.create', tests.api_move())$$, '28000',
  'and cannot write');
SELECT tests.ok((public.api_begin(tests.key_hash((SELECT two FROM k WHERE two IS NOT NULL)), 'quotes') ->> 'ok')::boolean, 'the other key still works');
-- drv1 made a key as admin; demoted to booker, their key stops.
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT public.change_member_role((SELECT id FROM o), :drv1, 'booker');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok(public.api_begin(tests.key_hash((SELECT one FROM k WHERE two IS NULL)), 'quotes') ->> 'error' = 'creator_not_member',
  'a key stops when its creator is no longer an owner or admin');
-- The company suspended: every key stops; reactivated, they work again.
SET LOCAL ROLE postgres;
SELECT tests.login(:admin);
SELECT public.admin_set_organization_status((SELECT id FROM o), 'suspended', 'unpaid invoices');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok(public.api_begin(tests.key_hash((SELECT two FROM k WHERE two IS NOT NULL)), 'quotes') ->> 'error' = 'organization_inactive',
  'keys of a suspended company are refused');
SELECT tests.throws($$SELECT public.api_read(tests.key_hash((SELECT two FROM k WHERE two IS NOT NULL)), 'bookings.list')$$, '42501',
  'and read nothing');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.create_api_key((SELECT id FROM o), 'Three', ARRAY['quotes'])$$, '42501', 'a suspended company creates no keys');
SELECT tests.ok((SELECT revoked_at IS NOT NULL FROM public.revoke_api_key((SELECT id FROM public.api_keys WHERE name = 'Two'))),
  'but its owner can still revoke them');
SET LOCAL ROLE postgres;
SELECT tests.login(:admin);
SELECT tests.ok((SELECT revoked_by FROM public.revoke_api_key((SELECT id FROM public.api_keys WHERE name = 'Drv'), 'abuse')) = :admin,
  'FlyttGo''s administrators can revoke a key (logged with their name)');
-- An expired key.
UPDATE public.api_keys SET expires_at = now() - interval '1 second', revoked_at = NULL WHERE name = 'Two';
SELECT public.admin_set_organization_status((SELECT id FROM o), 'active', 'paid');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok(public.api_begin(tests.key_hash((SELECT two FROM k WHERE two IS NOT NULL)), 'quotes') ->> 'error' = 'key_expired',
  'an expired key is refused');
ROLLBACK;

-- ── Companies never see each other's keys or records ──────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.api_acme() AS acme, tests.api_beta() AS beta;
SELECT tests.login(:cust1);
CREATE TEMP TABLE k ON COMMIT DROP AS
  SELECT public.create_api_key((SELECT acme FROM o), 'Acme', ARRAY['bookings:read', 'bookings:write']) ->> 'key' AS acme, NULL::text AS beta;
SELECT tests.login(:cust2);
UPDATE k SET beta = public.create_api_key((SELECT beta FROM o), 'Beta', ARRAY['bookings:read', 'bookings:write']) ->> 'key';
SELECT tests.ok((SELECT count(*) FROM public.api_keys) = 1 AND (SELECT name FROM public.api_keys) = 'Beta', 'each owner sees only their company''s keys');
SELECT tests.throws($$SELECT public.revoke_api_key('00000000-0000-0000-0000-000000000000')$$, '42501',
  'a key that does not exist is refused like another company''s');
SET LOCAL ROLE postgres;
CREATE TEMP TABLE acme_key ON COMMIT DROP AS SELECT id FROM public.api_keys WHERE name = 'Acme';
GRANT SELECT ON acme_key, o, k TO authenticated, service_role;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.revoke_api_key((SELECT id FROM acme_key))$$, '42501', 'Beta''s owner cannot revoke Acme''s key');
SELECT tests.throws($$SELECT public.update_api_key((SELECT id FROM acme_key), 'Mine', ARRAY['bookings:read'])$$, '42501', 'nor change it');
SELECT tests.throws($$SELECT public.create_api_key((SELECT acme FROM o), 'Mine', ARRAY['quotes'])$$, '42501', 'nor create one for Acme');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
CREATE TEMP TABLE b ON COMMIT DROP AS
  SELECT public.api_write(tests.key_hash((SELECT acme FROM k)), 'booking.create', tests.api_move()) ->> 'id' AS acme,
         public.api_write(tests.key_hash((SELECT beta FROM k)), 'booking.create', tests.api_move()) ->> 'id' AS beta;
SELECT tests.ok((SELECT organization_id FROM public.bookings WHERE id = (SELECT beta::uuid FROM b)) = (SELECT beta FROM o)
                AND (SELECT customer_id FROM public.bookings WHERE id = (SELECT beta::uuid FROM b)) = :cust2,
  'each key books for its own company, as its own creator');
SELECT tests.ok((SELECT jsonb_agg(e ->> 'id') FROM jsonb_array_elements(public.api_read(tests.key_hash((SELECT acme FROM k)), 'bookings.list') -> 'data') e)
                = jsonb_build_array((SELECT acme FROM b)),
  'Acme''s key lists only Acme''s bookings');
SELECT tests.throws($$SELECT public.api_read(tests.key_hash((SELECT acme FROM k)), 'bookings.get', jsonb_build_object('id', (SELECT beta FROM b)))$$, 'P0002',
  'and cannot read Beta''s booking by its id (not found, like a missing one)');
SELECT tests.ok(public.api_read(tests.key_hash((SELECT beta FROM k)), 'bookings.get', jsonb_build_object('id', (SELECT beta FROM b))) ->> 'id' = (SELECT beta FROM b),
  'Beta''s key reads it');
ROLLBACK;

-- ── Rate limit per key ─────────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.api_acme() AS id;
SELECT tests.login(:cust1);
CREATE TEMP TABLE k ON COMMIT DROP AS SELECT public.create_api_key((SELECT id FROM o), 'ERP', ARRAY['quotes']) ->> 'key' AS key,
                                            public.create_api_key((SELECT id FROM o), 'Other', ARRAY['quotes']) ->> 'key' AS other;
GRANT SELECT ON o, k TO service_role;
SELECT tests.throws($$SELECT public.admin_set_api_key_limit((SELECT id FROM public.api_keys WHERE name = 'ERP'), 1000)$$, '42501',
  'a company cannot raise its own limit');
SELECT tests.ok((SELECT rate_limit_per_minute FROM public.api_keys WHERE name = 'ERP') = 60, 'a key allows 60 requests a minute unless FlyttGo changes it');
SET LOCAL ROLE postgres;
SELECT tests.login(:admin);
SELECT public.admin_set_api_key_limit((SELECT id FROM public.api_keys WHERE name = 'ERP'), 3);
SET LOCAL ROLE service_role;
SELECT tests.as_server();
CREATE TEMP TABLE r ON COMMIT DROP AS
  SELECT n, public.api_begin(tests.key_hash((SELECT key FROM k)), 'quotes') AS r FROM generate_series(1, 4) n;
SELECT tests.ok((SELECT array_agg((r ->> 'remaining')::int ORDER BY n) FROM r WHERE n <= 3) = ARRAY[2, 1, 0], 'each request counts');
SELECT tests.ok((SELECT r ->> 'error' = 'rate_limited' AND (r ->> 'status')::int = 429 AND (r ->> 'retry_after')::int BETWEEN 1 AND 60 FROM r WHERE n = 4),
  'the fourth request in the minute is refused (429, with when to retry)');
SELECT tests.ok((public.api_begin(tests.key_hash((SELECT other FROM k)), 'quotes') ->> 'ok')::boolean, 'other keys have their own count');
SET LOCAL ROLE postgres;
UPDATE public.api_key_usage SET window_start = window_start - interval '1 minute';
SET LOCAL ROLE service_role;
SELECT tests.ok((public.api_begin(tests.key_hash((SELECT key FROM k)), 'quotes') ->> 'ok')::boolean, 'the next minute starts a new count');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$INSERT INTO public.api_key_usage VALUES ((SELECT id FROM public.api_keys LIMIT 1), now(), 0)$$, '42501',
  'the counters are not written from the browser');
ROLLBACK;

-- ── The widget's websites ──────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
GRANT SELECT ON o TO service_role;
SELECT tests.ok(public.add_widget_origin((SELECT id FROM o), ' HTTPS://www.Acme.no/ ') = 'https://www.acme.no',
  'an owner adds a website; it is kept as its origin, lower case');
SELECT tests.ok(public.add_widget_origin((SELECT id FROM o), 'https://www.acme.no') = 'https://www.acme.no'
                AND (SELECT count(*) FROM public.organization_widget_origins) = 1, 'adding it again changes nothing');
SELECT public.add_widget_origin((SELECT id FROM o), 'http://localhost:5173');
SELECT tests.throws($$SELECT public.add_widget_origin((SELECT id FROM o), 'http://acme.no')$$, '22023', 'plain http is refused, except localhost');
SELECT tests.throws($$SELECT public.add_widget_origin((SELECT id FROM o), 'https://acme.no/booking')$$, '22023', 'a path is refused');
SELECT tests.throws($$SELECT public.add_widget_origin((SELECT id FROM o), 'https://*.acme.no')$$, '22023', 'wildcards are refused');
SELECT tests.throws($$SELECT public.add_widget_origin((SELECT id FROM o), 'javascript:alert(1)')$$, '22023', 'anything else is refused');
SELECT tests.ok((SELECT action FROM public.api_events ORDER BY id LIMIT 1) = 'widget.origin_added', 'changes are logged');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.organization_widget_origins) = 2, 'members see the websites');
SELECT tests.throws($$SELECT public.add_widget_origin((SELECT id FROM o), 'https://evil.example')$$, '42501', 'a booker cannot add one');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT count(*) FROM public.organization_widget_origins) = 0, 'other people see none');
SELECT tests.throws($$SELECT public.widget_origins_public((SELECT id FROM o))$$, '42501', 'the list for the frame header is read by the server');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok(public.widget_origins_public((SELECT id FROM o)) = ARRAY['http://localhost:5173', 'https://www.acme.no'], 'the server reads the list');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT public.remove_widget_origin((SELECT id FROM o), 'https://www.acme.no/');
SELECT tests.ok((SELECT array_agg(origin) FROM public.organization_widget_origins) = ARRAY['http://localhost:5173'], 'an owner removes a website');
ROLLBACK;

\echo 'api keys: all checks passed'
