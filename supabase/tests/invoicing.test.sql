-- ============================================================================
-- Invoicing (supabase/migrations/00008_invoicing.sql)
-- Each block runs in its own transaction and rolls back.
-- Uses tests.acme() (organizations.test.sql), tests.activate() and
-- tests.book() (company_bookings.test.sql): cust1 owns Acme, drv1 books.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''

-- FlyttGo's seller details, as an administrator fills them in.
CREATE OR REPLACE FUNCTION tests.seller() RETURNS void LANGUAGE sql AS $$
  UPDATE public.platform_config SET config_value = v.v
    FROM (VALUES ('invoice_seller_name', 'FlyttGo AS'), ('invoice_seller_org_number', '923609016'),
                 ('invoice_seller_address', 'Storgata 1'), ('invoice_seller_postcode_city', '0155 Oslo'),
                 ('invoice_seller_bank_account', '1234.56.78903')) AS v(k, v)
   WHERE config_key = v.k;
$$;

-- Acme active with invoicing on, 30-day terms; a completed booking on
-- invoice by cust1. Returns the company id; the booking is tests.booking.
CREATE OR REPLACE FUNCTION tests.invoice_fixture() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid; v_b uuid; v_claims text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM tests.seller();
  v_org := tests.acme();
  PERFORM tests.activate(v_org);
  PERFORM public.set_billing_preferences(v_org, 'days', 30, NULL, 'per_booking', 'PO-77');
  PERFORM tests.login('a0000000-0000-0000-0000-000000000001');
  PERFORM public.admin_set_invoicing(v_org, true, NULL, 'standard');
  PERFORM tests.login('c0000000-0000-0000-0000-000000000001');
  v_b := tests.book(v_org);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM public.book_on_invoice(v_b, 'c0000000-0000-0000-0000-000000000001');
  UPDATE public.bookings SET status = 'completed', end_time = now() WHERE id = v_b;
  CREATE TEMP TABLE IF NOT EXISTS booking (id uuid) ON COMMIT DROP;
  INSERT INTO booking VALUES (v_b);
  GRANT SELECT ON booking TO authenticated, service_role;
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN v_org;
END $$;

-- As the server (the invoice run and the book-on-invoice function).
CREATE OR REPLACE FUNCTION tests.as_server() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── Billing preferences: the company chooses ───────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.ok((SELECT payment_terms_days FROM public.set_billing_preferences((SELECT id FROM o), 'days', 30, NULL, 'monthly', 'PO-1')) = 30,
  'the owner chooses 30-day terms and monthly invoicing');
SELECT tests.ok((SELECT payment_terms_day FROM public.set_billing_preferences((SELECT id FROM o), 'day_of_month', 14, 20, 'per_booking', NULL)) = 20,
  'or a fixed day of the following month');
SELECT tests.throws($$SELECT public.set_billing_preferences((SELECT id FROM o), 'days', 61, NULL, 'per_booking', NULL)$$, '23514',
  'terms longer than 60 days are refused');
SELECT tests.throws($$SELECT public.set_billing_preferences((SELECT id FROM o), 'day_of_month', 14, NULL, 'per_booking', NULL)$$, '23514',
  'a fixed day needs the day');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.set_billing_preferences((SELECT id FROM o), 'days', 14, NULL, 'per_booking', NULL)$$, '42501',
  'a booker cannot change the terms');
SELECT tests.throws($$SELECT public.admin_set_invoicing((SELECT id FROM o), true, NULL, 'special')$$, '42501',
  'members cannot switch invoicing on or change the plan');
SELECT tests.ok(tests.rows($$UPDATE public.platform_config SET config_value = 'false' WHERE config_key = 'credit_check_enabled'$$) = 0,
  'members cannot change the invoice settings (they do not even see them)');
ROLLBACK;

-- ── Booking on invoice: the server, the company's terms, the switches ──────
BEGIN;
SELECT tests.seller();
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id;
CREATE TEMP TABLE p ON COMMIT DROP AS SELECT tests.book(NULL) AS id;
GRANT SELECT ON o, b, p TO service_role;
SELECT tests.throws($$SELECT public.book_on_invoice((SELECT id FROM b), 'c0000000-0000-0000-0000-000000000001')$$, '42501',
  'the browser cannot book on invoice directly (the function prices it first)');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.throws($$SELECT public.book_on_invoice((SELECT id FROM b), 'c0000000-0000-0000-0000-000000000001')$$, '55000',
  'refused while FlyttGo has not switched invoicing on');
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
RESET ROLE;
UPDATE public.platform_config SET config_value = 'true' WHERE config_key = 'credit_check_enabled';
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_set_invoicing((SELECT id FROM o), true, 2000, 'standard')$$, '55000',
  'with the credit-check setting on, invoicing needs a passed credit check');
SELECT tests.throws($$SELECT public.record_credit_check((SELECT id FROM o), 'manual', true, NULL, NULL, '{}')$$, '22023',
  'a manual credit check needs its evidence');
SELECT tests.throws($$SELECT public.record_credit_check((SELECT id FROM o), 'creditsafe', true, 'A', 50000, '{}')$$, '42501',
  'an administrator cannot pose as a credit provider');
SELECT public.record_credit_check((SELECT id FROM o), 'manual', true, 'A', 50000, '{"evidence":"annual accounts 2025"}');
SELECT public.admin_set_invoicing((SELECT id FROM o), true, 2000, 'standard');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.throws($$SELECT public.book_on_invoice((SELECT id FROM p), 'c0000000-0000-0000-0000-000000000001')$$, '22023',
  'a personal booking cannot go on a company invoice');
SELECT tests.throws($$SELECT public.book_on_invoice((SELECT id FROM b), 'c0000000-0000-0000-0000-000000000002')$$, 'P0002',
  'nobody books on invoice for someone else''s booking');
SELECT public.book_on_invoice((SELECT id FROM b), :cust1);
SELECT tests.ok((SELECT payment_provider = 'invoice' AND payment_status = 'paid' AND captured_at IS NOT NULL
                   FROM public.bookings WHERE id = (SELECT id FROM b)),
  'the booking is paid on invoice and goes to dispatch like a paid one');
SELECT tests.ok(public.company_open_exposure((SELECT id FROM o)) = 1200, 'the open exposure counts the uninvoiced booking');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
INSERT INTO b SELECT tests.book((SELECT id FROM o));
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.throws($$SELECT public.book_on_invoice((SELECT id FROM b OFFSET 1), 'c0000000-0000-0000-0000-000000000001')$$, '55000',
  'a booking over the credit limit (2000 NOK) is refused');
ROLLBACK;

-- With the setting off (the default), no credit check is asked for.
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.invoice_fixture() AS id;
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT payment_provider FROM public.bookings WHERE id = (SELECT id FROM booking)) = 'invoice',
  'with the credit-check setting off, invoicing works without a credit check');
ROLLBACK;

-- ── Issuing: legal content, numbers without gaps, final once issued ────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.invoice_fixture() AS id;
SELECT tests.login(:admin);
CREATE TEMP TABLE d ON COMMIT DROP AS SELECT id FROM public.create_invoice_draft((SELECT id FROM o), ARRAY(SELECT id FROM booking));
SELECT tests.ok((SELECT total = 1200 AND net_total = 960 AND vat_total = 240 FROM public.invoices WHERE id = (SELECT id FROM d)),
  'a 1200 NOK booking is 960 NOK + 25% MVA 240 NOK');
SELECT tests.throws($$SELECT public.create_invoice_draft((SELECT id FROM o), ARRAY(SELECT id FROM booking))$$, '23505',
  'a booking is charged on one invoice only');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM public.invoices) = 0, 'members do not see drafts');
SELECT tests.throws($$SELECT public.issue_invoice((SELECT id FROM d))$$, '42501', 'members cannot issue invoices');
SELECT tests.login(:admin);
CREATE TEMP TABLE i ON COMMIT DROP AS SELECT * FROM public.issue_invoice((SELECT id FROM d));
SELECT tests.ok((SELECT number = 1 AND status = 'issued' AND issue_date = (now() AT TIME ZONE 'Europe/Oslo')::date
                        AND due_date = issue_date + 30 FROM i), 'issued as number 1, due in the company''s 30 days');
SELECT tests.ok((SELECT kid = '000000018' FROM i), 'with a KID: the number in eight digits and a MOD10 check digit');
SELECT tests.ok((SELECT seller ->> 'name' = 'FlyttGo AS' AND seller ->> 'bank_account' = '1234.56.78903'
                        AND buyer ->> 'name' = 'Acme AS' AND buyer ->> 'org_number' = '923609016'
                        AND reference = 'PO-77' AND branding IS NULL FROM i),
  'seller, buyer, the company''s reference; no branding on the standard plan');
SELECT tests.throws($$SELECT public.issue_invoice((SELECT id FROM d))$$, '55000', 'an invoice is issued once');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT tests.throws($$UPDATE public.invoices SET total = 1 WHERE id = (SELECT id FROM d)$$, '42501',
  'an issued invoice cannot be changed, not even by the database owner');
SELECT tests.throws($$DELETE FROM public.invoices WHERE id = (SELECT id FROM d)$$, '42501', 'nor deleted');
SELECT tests.throws($$UPDATE public.invoice_lines SET total = 1 WHERE invoice_id = (SELECT id FROM d)$$, '42501', 'nor its lines');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM public.invoices) = 1 AND (SELECT count(*) FROM public.invoice_lines) = 1,
  'the owner reads the issued invoice and its lines');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.invoices) = 0, 'a booker does not read invoices');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT count(*) FROM public.invoices) = 0, 'an outsider does not');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.invoice_fixture() AS id;
SELECT tests.login(:admin);
RESET ROLE;
UPDATE public.organizations SET billing_plan = 'special', logo_path = (SELECT id FROM o)::text || '/logo.png';
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
-- A draft that is thrown away uses no number.
CREATE TEMP TABLE x ON COMMIT DROP AS SELECT id FROM public.create_invoice_draft((SELECT id FROM o), '{}', NULL, 'scrap');
SELECT public.add_invoice_line((SELECT id FROM x), 'Packing boxes', 10, 40);
SELECT public.delete_invoice_draft((SELECT id FROM x));
CREATE TEMP TABLE d ON COMMIT DROP AS SELECT id FROM public.create_invoice_draft((SELECT id FROM o), ARRAY(SELECT id FROM booking));
SELECT public.add_invoice_line((SELECT id FROM d), 'Packing boxes', 10, 40);
CREATE TEMP TABLE i ON COMMIT DROP AS SELECT * FROM public.issue_invoice((SELECT id FROM d));
SELECT tests.ok((SELECT number FROM i) = 1, 'a deleted draft leaves no gap in the numbers');
SELECT tests.ok((SELECT total FROM i) = 1700, 'a manual line adds 400 NOK + 25% MVA');
SELECT tests.ok((SELECT branding ->> 'name' = 'Acme AS' AND branding ->> 'logo_path' LIKE '%/logo.png' FROM i),
  'the special plan carries the company''s name and logo');
ROLLBACK;

-- ── Payments, KID matching, credit notes ───────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.invoice_fixture() AS id;
SELECT tests.login(:admin);
CREATE TEMP TABLE i ON COMMIT DROP AS SELECT * FROM public.issue_invoice((SELECT id FROM public.create_invoice_draft((SELECT id FROM o), ARRAY(SELECT id FROM booking))));
SELECT tests.ok((SELECT status FROM public.record_invoice_payment((SELECT id FROM i), 200, current_date, 'bank', 'TX-1')) = 'partially_paid',
  'a part payment');
SELECT tests.throws($$SELECT public.record_invoice_payment((SELECT id FROM i), 1001, current_date, 'bank', 'TX-2')$$, '22023',
  'never more than is owed');
SELECT tests.ok(public.record_payment_by_kid('0000 00018', 400, current_date, 'TX-3') = (SELECT id FROM i), 'a bank payment matched by KID');
SELECT tests.ok(public.record_payment_by_kid('000000018', 400, current_date, 'TX-3') = (SELECT id FROM i)
            AND (SELECT amount_paid FROM public.invoices WHERE id = (SELECT id FROM i)) = 600,
  'the same bank transaction is counted once');
SELECT tests.ok(public.record_payment_by_kid('999999999', 10, current_date, 'TX-4') IS NULL, 'an unknown KID is left for manual matching');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.record_invoice_payment((SELECT id FROM i), 600, current_date, 'bank', 'X')$$, '42501',
  'a company cannot mark its own invoice paid');
SELECT tests.login(:admin);
CREATE TEMP TABLE cn ON COMMIT DROP AS SELECT * FROM public.create_credit_note((SELECT id FROM i), 100, 'one box short');
SELECT tests.ok((SELECT kind = 'credit_note' AND number = 2 AND total = -100 AND net_total = -80 FROM cn),
  'a credit note is numbered in the same series, with VAT split');
SELECT tests.ok(public.invoice_outstanding((SELECT x FROM public.invoices x WHERE id = (SELECT id FROM i))) = 500,
  'and reduces what is owed');
SELECT public.record_invoice_payment((SELECT id FROM i), 500, current_date, 'bank', 'TX-5');
SELECT tests.ok((SELECT status FROM public.invoices WHERE id = (SELECT id FROM i)) = 'paid', 'paid in full');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.invoice_fixture() AS id;
SELECT tests.login(:admin);
CREATE TEMP TABLE i ON COMMIT DROP AS SELECT * FROM public.issue_invoice((SELECT id FROM public.create_invoice_draft((SELECT id FROM o), ARRAY(SELECT id FROM booking))));
CREATE TEMP TABLE cn ON COMMIT DROP AS SELECT * FROM public.create_credit_note((SELECT id FROM i), NULL, 'move cancelled by FlyttGo');
SELECT tests.ok((SELECT status FROM public.invoices WHERE id = (SELECT id FROM i)) = 'credited'
            AND (SELECT count(*) FROM public.invoice_lines WHERE invoice_id = (SELECT id FROM cn) AND booking_id IS NOT NULL) = 1,
  'a full credit note reverses every line and credits the invoice');
SELECT tests.throws($$SELECT public.create_credit_note((SELECT id FROM i), 1, 'again')$$, '22023', 'nothing is left to credit');
ROLLBACK;

-- ── Reminders ──────────────────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.invoice_fixture() AS id;
SELECT tests.login(:admin);
CREATE TEMP TABLE i ON COMMIT DROP AS SELECT * FROM public.issue_invoice((SELECT id FROM public.create_invoice_draft((SELECT id FROM o), ARRAY(SELECT id FROM booking))));
SELECT tests.throws($$SELECT public.record_invoice_reminder((SELECT id FROM i))$$, '55000', 'no reminder before the due date');
-- Make it overdue (only possible by switching the guard off as the owner).
RESET ROLE;
ALTER TABLE public.invoices DISABLE TRIGGER guard_invoice_write;
UPDATE public.invoices SET due_date = (now() AT TIME ZONE 'Europe/Oslo')::date - 20 WHERE id = (SELECT id FROM i);
ALTER TABLE public.invoices ENABLE TRIGGER guard_invoice_write;
UPDATE public.platform_config SET config_value = '35' WHERE config_key = 'invoice_reminder_fee';
UPDATE public.platform_config SET config_value = '12.25' WHERE config_key = 'invoice_late_interest_pct';
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
CREATE TEMP TABLE r ON COMMIT DROP AS SELECT * FROM public.record_invoice_reminder((SELECT id FROM i));
SELECT tests.ok((SELECT level = 1 AND fee = 35 AND interest = round(1200 * 0.1225 * 20 / 365.0, 2) FROM r),
  'the first reminder carries the fee and interest from the settings');
SELECT tests.ok(public.invoice_outstanding((SELECT x FROM public.invoices x WHERE id = (SELECT id FROM i))) = 1200 + 35 + (SELECT interest FROM r),
  'and they are added to what is owed');
ROLLBACK;

-- ── What the invoice run picks up ──────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.invoice_fixture() AS id;
GRANT SELECT ON o TO service_role;
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((SELECT array_agg(booking_id) FROM public.uninvoiced_bookings()) = ARRAY(SELECT id FROM booking),
  'a completed per-booking booking is due for invoicing');
SELECT public.issue_invoice((SELECT id FROM public.create_invoice_draft((SELECT id FROM o), ARRAY(SELECT id FROM booking))));
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.uninvoiced_bookings()), 'once invoiced it is not picked up again');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.invoice_fixture() AS id;
GRANT SELECT ON o TO service_role;
SELECT tests.login(:cust1);
SELECT public.set_billing_preferences((SELECT id FROM o), 'days', 14, NULL, 'monthly', NULL);
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.uninvoiced_bookings()), 'a monthly company waits until the month is over');
SELECT tests.ok(EXISTS (SELECT 1 FROM public.uninvoiced_bookings((date_trunc('month', current_date) + interval '1 month')::date)),
  'and is invoiced in the next month');
ROLLBACK;

-- ── Logos stay in the company's own folder ─────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.ok(tests.rows(format($$INSERT INTO storage.objects (bucket_id, name) VALUES ('organization-logos', '%s/logo.png')$$, (SELECT id FROM o))) = 1,
  'the owner uploads the logo into the company''s folder');
SELECT public.set_organization_logo((SELECT id FROM o), (SELECT id FROM o)::text || '/logo.png');
SELECT tests.throws($$SELECT public.set_organization_logo((SELECT id FROM o), 'someone-else/logo.png')$$, '42501',
  'the logo must be in the company''s own folder');
SELECT tests.login(:cust2);
SELECT tests.throws(format($$INSERT INTO storage.objects (bucket_id, name) VALUES ('organization-logos', '%s/x.png')$$, (SELECT id FROM o)), '42501',
  'an outsider cannot upload into the company''s folder');
SELECT tests.ok((SELECT count(*) FROM storage.objects WHERE bucket_id = 'organization-logos') = 0, 'nor see its logo');
ROLLBACK;

\echo 'invoicing: all tests passed'
