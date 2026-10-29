-- ============================================================================
-- Invoices in a company's own name (supabase/migrations/00011_company_invoicing.sql)
-- Uses tests.sp_acme() (service_platform.test.sql): Acme, a plumber on the
-- Jobs plan; cust1 owns it, drv1 is its booker; cust2 is its customer.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''

CREATE OR REPLACE FUNCTION tests.si_lines() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '[{"description":"Labour, kitchen tap","quantity":2.5,"unit_price":850,"vat_rate":25},
           {"description":"Mixer tap","quantity":1,"unit_price":1490,"vat_rate":25}]'::jsonb;
$$;
CREATE OR REPLACE FUNCTION tests.si_customer() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"name":"Kari Nordmann","email":"cust2@test","address":"Bjerkelia 12","postcode_city":"1350 Lommedalen"}'::jsonb;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.sp_acme('field_service', 'jobs') AS id;
GRANT SELECT ON o TO service_role;
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.create_sales_invoice((SELECT id FROM o), tests.si_customer(), NULL, tests.si_lines(), NULL, NULL)$$, '42501',
  'a booker cannot invoice for the company');
SELECT tests.login(:cust1);
CREATE TEMP TABLE i ON COMMIT DROP AS SELECT * FROM public.create_sales_invoice((SELECT id FROM o), tests.si_customer(),
  'c0000000-0000-0000-0000-000000000002', tests.si_lines(), 'Job 31', NULL);
GRANT SELECT ON i TO service_role;
SELECT tests.ok((SELECT total FROM i) = 4518.75 AND (SELECT series FROM i) = 'org:' || (SELECT id FROM o)::text
                AND (SELECT organization_id FROM i) IS NULL,
  'the owner drafts an invoice to a customer: the company''s series, lines with MVA');
SELECT tests.throws($$SELECT public.issue_invoice((SELECT id FROM i))$$, '55000', 'it cannot be issued before the company''s invoice settings are filled in');
SELECT public.set_invoice_settings((SELECT id FROM o), '{"legal_name":"Oslo Rør AS","address":"Verkstedveien 4","postcode_city":"0277 Oslo","bank_account":"1506.12.34567","terms_days":14}');
CREATE TEMP TABLE iss ON COMMIT DROP AS SELECT * FROM public.issue_invoice((SELECT id FROM i));
SELECT tests.ok((SELECT number FROM iss) = 1 AND (SELECT kid FROM iss) = '000000018'
                AND (SELECT seller ->> 'name' FROM iss) = 'Oslo Rør AS' AND (SELECT seller ->> 'bank_account' FROM iss) = '1506.12.34567'
                AND (SELECT due_date - issue_date FROM iss) = 14,
  'issued as number 1 of the company''s own series, its KID, its bank account and terms');
SELECT tests.ok((SELECT seller ->> 'name' FROM iss) <> 'FlyttGo AS', 'the seller is the company, not FlyttGo');

-- FlyttGo's own series is separate: its next number is unaffected.
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((SELECT next_number FROM public.invoice_counters WHERE series = 'main') = 1, 'FlyttGo''s own numbering is untouched');
SET LOCAL ROLE authenticated;

SELECT tests.login(:cust2);
SELECT tests.ok((SELECT count(*) FROM public.invoices WHERE id = (SELECT id FROM i)) = 1, 'the customer reads their invoice');
SELECT tests.throws($$SELECT public.record_invoice_payment((SELECT id FROM i), 100, current_date, 'bank', 'x')$$, '42501',
  'but cannot record a payment');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.invoices WHERE id = (SELECT id FROM i)) = 0, 'a booker of the company does not see its invoices');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.record_invoice_payment((SELECT id FROM i), 100, current_date, 'bank', 'x')$$, '42501',
  'FlyttGo administrators read but do not operate a company''s books');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT status FROM public.record_invoice_payment((SELECT id FROM i), 1000, current_date, 'bank', 'b1')) = 'partially_paid',
  'the company records a payment');
SELECT public.create_credit_note((SELECT id FROM i), 500, 'goodwill');
SELECT tests.ok((SELECT series FROM public.invoices WHERE credits_invoice_id = (SELECT id FROM i)) = 'org:' || (SELECT id FROM o)::text
                AND (SELECT number FROM public.invoices WHERE credits_invoice_id = (SELECT id FROM i)) = 2,
  'a credit note in the same series, numbered next');
SELECT tests.throws($$UPDATE public.invoices SET total = 1 WHERE id = (SELECT id FROM i)$$, NULL, 'an issued invoice is final');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok(public.record_payment_by_kid('000000018', 1, current_date, 'bank-x') IS NULL,
  'FlyttGo''s bank file does not match a company''s KID');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
SELECT tests.throws($$SELECT public.create_sales_invoice((SELECT id FROM o), tests.si_customer(), NULL, tests.si_lines(), NULL, NULL)$$, '55000',
  'a company whose plan has no invoicing cannot issue invoices');
ROLLBACK;

\echo 'company invoicing: all tests passed'
