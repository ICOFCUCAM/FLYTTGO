-- ============================================================================
-- Inbound messages from the public forms and FlyttGo's public business
-- details (supabase/migrations/00026_contact_messages.sql)
-- Each block runs in its own transaction and rolls back.
-- Uses the administrator and customers of p0_security.test.sql.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''

-- ── Visitors submit through the function only, and read nothing ──
BEGIN;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok(public.submit_contact_message('contact', '  Kari Nordmann ', ' Kari@Example.NO ', '+47 412 34 567', NULL,
  'Booking a move', 'When can you move a sofa?') IS NOT NULL, 'a visitor sends a contact message through the function');
SELECT tests.ok(public.submit_contact_message('corporate', NULL, 'ola@firma.no', '', 'Firma AS', '10–50 jobs/month', '') IS NOT NULL,
  'a corporate enquiry needs only the company and an email');
SELECT tests.ok(public.submit_contact_message('newsletter', 'ignored', 'news@example.no', NULL, 'ignored', NULL, 'ignored') IS NOT NULL,
  'a newsletter sign-up needs only an email');
SELECT tests.throws($$SELECT count(*) FROM public.contact_messages$$, '42501', 'the visitor cannot read the messages (not even their own)');
SELECT tests.throws($$INSERT INTO public.contact_messages (source, email) VALUES ('contact', 'x@example.no')$$, '42501',
  'a visitor cannot write to the table directly');
SELECT tests.throws($$UPDATE public.contact_messages SET status = 'handled'$$, '42501', 'nor change it');
SELECT tests.throws($$DELETE FROM public.contact_messages$$, '42501', 'nor delete from it');
SELECT tests.throws($$SELECT public.admin_set_contact_message_status(gen_random_uuid(), 'handled')$$, '42501',
  'nor call the administrators'' function');
RESET ROLE;
SELECT tests.ok((SELECT name || '|' || email || '|' || phone || '|' || topic FROM public.contact_messages WHERE source = 'contact')
  = 'Kari Nordmann|kari@example.no|+47 412 34 567|Booking a move', 'the message is stored trimmed, the email in lower case');
SELECT tests.ok((SELECT phone IS NULL AND message IS NULL AND company = 'Firma AS' AND status = 'new' FROM public.contact_messages WHERE source = 'corporate'),
  'empty optional fields are stored as empty (NULL) and a new message is new');
SELECT tests.ok((SELECT name IS NULL AND company IS NULL AND message IS NULL AND topic = 'Newsletter sign-up' FROM public.contact_messages WHERE source = 'newsletter'),
  'a newsletter sign-up keeps only the email');
ROLLBACK;

-- ── A signed-in customer is a visitor too ──
BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok(public.submit_contact_message('contact', 'Cee', 'cust1@test.no', NULL, NULL, NULL, 'Hello') IS NOT NULL,
  'a signed-in customer sends a message');
SELECT tests.ok((SELECT count(*) FROM public.contact_messages) = 0, 'and cannot read it back');
SELECT tests.throws($$SELECT public.admin_set_contact_message_status((SELECT id FROM public.contact_messages LIMIT 1), 'handled')$$, '42501',
  'nor mark messages handled');
ROLLBACK;

-- ── Validation ──
BEGIN;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.throws($$SELECT public.submit_contact_message('other', 'A', 'a@example.no', NULL, NULL, NULL, 'Hi')$$, '22023', 'an unknown form is refused');
SELECT tests.throws($$SELECT public.submit_contact_message('contact', 'A', 'not-an-email', NULL, NULL, NULL, 'Hi')$$, '22023', 'an invalid email is refused');
SELECT tests.throws($$SELECT public.submit_contact_message('contact', 'A', '', NULL, NULL, NULL, 'Hi')$$, '22023', 'an empty email is refused');
SELECT tests.throws($$SELECT public.submit_contact_message('newsletter', NULL, 'a b@example.no', NULL, NULL, NULL, NULL)$$, '22023', 'an email with a space is refused');
SELECT tests.throws($$SELECT public.submit_contact_message('contact', '  ', 'a@example.no', NULL, NULL, NULL, 'Hi')$$, '22023', 'a contact message needs a name');
SELECT tests.throws($$SELECT public.submit_contact_message('contact', 'A', 'a@example.no', NULL, NULL, NULL, '   ')$$, '22023', 'and a message');
SELECT tests.throws($$SELECT public.submit_contact_message('corporate', 'A', 'a@example.no', NULL, '', NULL, 'Hi')$$, '22023', 'a corporate enquiry needs a company');
SELECT tests.throws($$SELECT public.submit_contact_message('contact', repeat('n', 121), 'a@example.no', NULL, NULL, NULL, 'Hi')$$, '22023', 'a name over 120 characters is refused');
SELECT tests.throws($$SELECT public.submit_contact_message('corporate', NULL, 'a@example.no', NULL, repeat('c', 201), NULL, NULL)$$, '22023', 'a company over 200 characters is refused');
SELECT tests.throws($$SELECT public.submit_contact_message('contact', 'A', 'a@example.no', NULL, NULL, repeat('s', 201), 'Hi')$$, '22023', 'a subject over 200 characters is refused');
SELECT tests.throws($$SELECT public.submit_contact_message('contact', 'A', 'a@example.no', NULL, NULL, NULL, repeat('m', 5001))$$, '22023', 'a message over 5000 characters is refused');
SELECT tests.throws($$SELECT public.submit_contact_message('contact', 'A', repeat('e', 250) || '@x.no', NULL, NULL, NULL, 'Hi')$$, '22023', 'an email over 254 characters is refused');
SELECT tests.throws($$SELECT public.submit_contact_message('contact', 'A', 'a@example.no', 'call me', NULL, NULL, 'Hi')$$, '22023', 'a phone number with letters is refused');
SELECT tests.throws($$SELECT public.submit_contact_message('contact', 'A', 'a@example.no', repeat('1', 41), NULL, NULL, 'Hi')$$, '22023', 'a phone number over 40 characters is refused');
SELECT tests.ok(public.submit_contact_message('contact', repeat('n', 120), 'a@example.no', NULL, NULL, repeat('s', 200), repeat('m', 5000)) IS NOT NULL,
  'the longest allowed name, subject and message are accepted');
ROLLBACK;

-- ── Rate limit: 5 an hour per email address ──
BEGIN;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT public.submit_contact_message('contact', 'Spam', 'busy@example.no', NULL, NULL, NULL, 'Message ' || n) FROM generate_series(1, 5) n;
SELECT tests.throws($$SELECT public.submit_contact_message('contact', 'Spam', 'BUSY@example.no', NULL, NULL, NULL, 'Sixth')$$, 'P0001',
  'a sixth message from the same email within the hour is refused (whatever its case)');
SELECT tests.throws($$SELECT public.submit_contact_message('newsletter', NULL, 'busy@example.no', NULL, NULL, NULL, NULL)$$, 'P0001',
  'from any of the forms');
SELECT tests.ok(public.submit_contact_message('contact', 'Other', 'other@example.no', NULL, NULL, NULL, 'Hi') IS NOT NULL,
  'another email address can still send');
RESET ROLE;
UPDATE public.contact_messages SET created_at = now() - interval '61 minutes' WHERE email = 'busy@example.no';
SET LOCAL ROLE anon;
SELECT tests.ok(public.submit_contact_message('contact', 'Spam', 'busy@example.no', NULL, NULL, NULL, 'Later') IS NOT NULL,
  'after an hour the same address can send again');
ROLLBACK;

-- ── Rate limit: 300 from everyone in 10 minutes ──
BEGIN;
INSERT INTO public.contact_messages (source, email, name, message)
SELECT 'contact', 'flood' || n || '@example.no', 'F', 'x' FROM generate_series(1, 300) n;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.throws($$SELECT public.submit_contact_message('contact', 'New', 'fresh@example.no', NULL, NULL, NULL, 'Hi')$$, 'P0001',
  'after 300 messages in 10 minutes from anyone, new ones wait');
ROLLBACK;

-- ── Administrators read and mark handled ──
BEGIN;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT public.submit_contact_message('contact', 'Kari', 'kari@example.no', NULL, NULL, 'Claim or complaint', 'A scratched table');
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT tests.ok((SELECT count(*) FROM public.contact_messages) = 1, 'an administrator reads the message');
SELECT tests.throws($$UPDATE public.contact_messages SET status = 'handled'$$, '42501', 'an administrator does not write to the table directly');
SELECT tests.ok((SELECT (r).status = 'handled' AND (r).handled_by = :admin::uuid AND (r).handled_at IS NOT NULL
                   FROM (SELECT public.admin_set_contact_message_status((SELECT id FROM public.contact_messages), 'handled') AS r) x),
  'an administrator marks it handled; who and when are recorded');
SELECT tests.ok((SELECT (r).status = 'new' AND (r).handled_by IS NULL AND (r).handled_at IS NULL
                   FROM (SELECT public.admin_set_contact_message_status((SELECT id FROM public.contact_messages), 'new') AS r) x),
  'and can put it back to new');
SELECT tests.throws($$SELECT public.admin_set_contact_message_status((SELECT id FROM public.contact_messages), 'deleted')$$, '22023',
  'only new or handled');
SELECT tests.throws($$SELECT public.admin_set_contact_message_status(gen_random_uuid(), 'handled')$$, 'P0002', 'an unknown message is reported');
RESET ROLE;
SELECT tests.throws($$UPDATE public.contact_messages SET status = 'handled', handled_by = NULL$$, '23514',
  'a handled message always records who handled it and when');
ROLLBACK;

-- ── FlyttGo's public business details ──
BEGIN;
UPDATE public.platform_config SET config_value = '' WHERE config_key LIKE 'invoice_seller_%' AND config_key <> 'invoice_seller_vat_registered';
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT public.flyttgo_public_identity() = jsonb_build_object('name', NULL, 'org_number', NULL, 'vat_registered', true,
  'address', NULL, 'postcode_city', NULL, 'email', NULL, 'phone', NULL)), 'while the settings are empty, every field is empty (nothing invented)');
RESET ROLE;
UPDATE public.platform_config SET config_value = CASE config_key
  WHEN 'invoice_seller_name' THEN 'FlyttGo AS' WHEN 'invoice_seller_org_number' THEN '123456789'
  WHEN 'invoice_seller_address' THEN 'Gate 1' WHEN 'invoice_seller_postcode_city' THEN '0150 Oslo'
  WHEN 'invoice_seller_email' THEN 'post@flyttgo.no' WHEN 'invoice_seller_phone' THEN '+47 22 00 00 00'
  WHEN 'invoice_seller_bank_account' THEN '12345678903' WHEN 'invoice_seller_iban' THEN 'NO9386011117947'
  WHEN 'invoice_seller_bic' THEN 'DNBANOKK' WHEN 'invoice_seller_vat_registered' THEN 'false' ELSE config_value END
 WHERE config_key LIKE 'invoice_seller_%';
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT public.flyttgo_public_identity() = jsonb_build_object('name', 'FlyttGo AS', 'org_number', '123456789', 'vat_registered', false,
  'address', 'Gate 1', 'postcode_city', '0150 Oslo', 'email', 'post@flyttgo.no', 'phone', '+47 22 00 00 00')),
  'a visitor reads the filled-in public fields');
SELECT tests.ok((SELECT NOT (public.flyttgo_public_identity() ?| ARRAY['bank_account', 'iban', 'bic'])), 'never the bank account, IBAN or BIC');
SELECT tests.ok((SELECT count(*) FROM public.platform_config) = 0, 'and still reads nothing else of platform_config');
SELECT tests.throws($$SELECT public.config_text('invoice_seller_bank_account')$$, '42501', 'nor any other setting through config_text');
ROLLBACK;

-- ── Rollback (supabase/rollback/00026_down.sql) ──
BEGIN;
INSERT INTO public.contact_messages (source, email, name, message) VALUES ('contact', 'keep@example.no', 'K', 'x');
\i supabase/rollback/00026_down.sql
SELECT tests.ok(to_regclass('public.contact_messages') IS NULL, 'the rollback drops the messages table');
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('submit_contact_message', 'admin_set_contact_message_status', 'flyttgo_public_identity')),
  'and the three functions');
SELECT tests.ok(to_regprocedure('public.invoice_seller()') IS NOT NULL AND (SELECT count(*) FROM public.platform_config WHERE config_key LIKE 'invoice_seller_%') = 10,
  'and leaves the invoicing settings as they were');
ROLLBACK;
\echo 'contact messages: all tests passed'
