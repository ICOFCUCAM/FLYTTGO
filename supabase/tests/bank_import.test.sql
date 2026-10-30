-- ============================================================================
-- Bank import (supabase/migrations/00016_bank_import.sql)
-- Each block runs in its own transaction and rolls back. Uses
-- tests.invoice_fixture() and tests.as_server() (invoicing.test.sql) and
-- tests.sp_acme() (service_platform.test.sql): cust1 owns Acme, drv1 books.
-- The rows are as bank-files.ts gives them (made-up references and KIDs).
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''

-- A file's SHA-256 (any text stands for the file).
CREATE OR REPLACE FUNCTION tests.sha(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p, 'UTF8')), 'hex');
$$;
-- One bank row.
CREATE OR REPLACE FUNCTION tests.brow(p_kid text, p_amount numeric, p_ref text, p_currency text DEFAULT 'NOK',
                                      p_reversal boolean DEFAULT false, p_paid_on date DEFAULT current_date)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('paid_on', p_paid_on, 'amount', p_amount, 'currency', p_currency, 'kid', p_kid,
                            'kid_source', 'structured', 'bank_reference', p_ref, 'reversal', p_reversal,
                            'payer', 'Eksempel AS', 'account', '12345678903', 'info', NULL);
$$;
-- The outcome and reason of each row of an import, in order.
CREATE OR REPLACE FUNCTION tests.outcomes(p_import uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(outcome || coalesce(':' || reason, ''), ' ' ORDER BY line_no) FROM public.bank_import_rows WHERE import_id = p_import;
$$;
CREATE OR REPLACE FUNCTION tests.preview_outcomes(p jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg((r ->> 'outcome') || coalesce(':' || (r ->> 'reason'), ''), ' ' ORDER BY n)
    FROM jsonb_array_elements(p -> 'rows') WITH ORDINALITY AS t(r, n);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── FlyttGo's own invoices: preview, import, never twice ───────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.invoice_fixture() AS id;
SELECT tests.login(:admin);
-- Invoice 1 (1200 NOK, KID 000000018) for the booking; invoice 2 (2500 NOK, KID 000000026) by hand.
CREATE TEMP TABLE i1 ON COMMIT DROP AS SELECT * FROM public.issue_invoice((SELECT id FROM public.create_invoice_draft((SELECT id FROM o), ARRAY(SELECT id FROM booking))));
CREATE TEMP TABLE d2 ON COMMIT DROP AS SELECT * FROM public.create_invoice_draft((SELECT id FROM o), '{}');
SELECT public.add_invoice_line((SELECT id FROM d2), 'Packing', 1, 2000);
CREATE TEMP TABLE i2 ON COMMIT DROP AS SELECT * FROM public.issue_invoice((SELECT id FROM d2));
SELECT tests.ok((SELECT kid FROM i1) = '000000018' AND (SELECT kid FROM i2) = '000000026' AND (SELECT total FROM i2) = 2500,
  'two issued invoices with their KIDs');

CREATE TEMP TABLE f ON COMMIT DROP AS SELECT jsonb_build_array(
  tests.brow('000000018', 1200, 'nets:1:1:1'),                    -- 1 pays invoice 1
  tests.brow('000000026', 100, 'nets:1:1:2'),                     -- 2 part of invoice 2
  tests.brow('999999999', 50, 'nets:1:1:3'),                      -- 3 no such invoice
  tests.brow('000000026', 100, 'nets:1:1:4', 'EUR'),              -- 4 euros
  tests.brow('000000026', 25, 'nets:1:1:5', 'NOK', true),         -- 5 a reversal
  tests.brow('', 300, 'nets:1:1:6'),                              -- 6 no KID
  tests.brow('000000026', 100000, 'nets:1:1:7'),                  -- 7 more than owed
  tests.brow('000000018', 10, 'nets:1:1:8'),                      -- 8 invoice 1 is paid by row 1
  tests.brow('000000018', 1200, 'nets:1:1:1'),                    -- 9 row 1 again in the same file
  tests.brow('000000026', 40, NULL)                               -- 10 no bank reference
) AS rows;
GRANT SELECT ON f, o, i1, i2 TO anon, service_role;

CREATE TEMP TABLE pv ON COMMIT DROP AS SELECT public.preview_bank_import(NULL, 'nets_ocr', tests.sha('file A'), (SELECT rows FROM f)) AS p;
SELECT tests.ok(tests.preview_outcomes((SELECT p FROM pv)) =
  'matched matched unmatched:no_invoice unmatched:currency unmatched:reversal unmatched:no_kid overpayment:more_than_owed '
  'overpayment:nothing_owed already_imported:twice_in_file unmatched:no_reference',
  'the preview shows what each row would do (row 8: invoice 1 is already paid by row 1 of the same file)');
SELECT tests.ok((SELECT p -> 'rows' -> 0 ->> 'invoice_number' FROM pv) = '1' AND (SELECT (p -> 'rows' -> 1 ->> 'outstanding')::numeric FROM pv) = 2500
                AND (SELECT p -> 'rows' -> 3 ->> 'invoice_id' FROM pv) = (SELECT id::text FROM i2),
  'with the invoice and what it owes, also for a row that is not matched');
SELECT tests.ok((SELECT count(*) FROM public.invoice_payments) = 0 AND (SELECT count(*) FROM public.bank_imports) = 0,
  'the preview records nothing');

SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.preview_bank_import(NULL, 'nets_ocr', tests.sha('file A'), (SELECT rows FROM f))$$, '42501',
  'a company owner cannot preview FlyttGo''s bank file');
SELECT tests.throws($$SELECT public.import_bank_file(NULL, 'nets_ocr', 'upload', 'a.txt', tests.sha('file A'), (SELECT rows FROM f))$$, '42501',
  'nor import it');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.import_bank_file(NULL, 'nets_ocr', 'upload', 'a.txt', tests.sha('file A'), (SELECT rows FROM f))$$, '42501',
  'nor can a booker');

SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.import_bank_file(NULL, 'nets_ocr', 'fetch', 'a.txt', tests.sha('file A'), (SELECT rows FROM f))$$, '42501',
  'only the server records a fetched file');
SELECT tests.throws($$SELECT public.import_bank_file(NULL, 'mt940', 'upload', 'a.txt', tests.sha('file A'), (SELECT rows FROM f))$$, '22023',
  'an unknown format is refused');
SELECT tests.throws($$SELECT public.import_bank_file(NULL, 'nets_ocr', 'upload', 'a.txt', 'abc', (SELECT rows FROM f))$$, '22023',
  'an import needs the file''s SHA-256');
SELECT tests.throws($$SELECT public.import_bank_file(NULL, 'nets_ocr', 'upload', 'a.txt', tests.sha('x'), '[{"paid_on":"31.10.2026","amount":1}]')$$, '22023',
  'a malformed row stops the whole import');
CREATE TEMP TABLE imp ON COMMIT DROP AS
  SELECT * FROM public.import_bank_file(NULL, 'nets_ocr', 'upload', 'OCR.D311026.txt', tests.sha('file A'), (SELECT rows FROM f), '{"transmissionNumber":"0170604"}');
GRANT SELECT ON imp TO anon, service_role;
SELECT tests.ok((SELECT rows_total = 10 AND matched = 2 AND already_recorded = 0 AND already_imported = 1 AND unmatched = 5
                        AND overpayments = 2 AND amount_matched = 1300 AND imported_by = :admin AND series = 'main' FROM imp),
  'the import is recorded with who, the format, the file''s SHA-256 and its counts');
SELECT tests.ok(tests.outcomes((SELECT id FROM imp)) = tests.preview_outcomes((SELECT p FROM pv)),
  'each row is kept with the outcome the preview showed');
SELECT tests.ok((SELECT status FROM public.invoices WHERE id = (SELECT id FROM i1)) = 'paid'
                AND (SELECT amount_paid FROM public.invoices WHERE id = (SELECT id FROM i2)) = 100,
  'the matched rows are recorded as payments: invoice 1 paid, 100 NOK on invoice 2');
SELECT tests.ok((SELECT count(*) FROM public.invoice_payments p JOIN public.bank_import_rows r ON r.payment_id = p.id
                  WHERE r.import_id = (SELECT id FROM imp) AND p.method = 'bank' AND p.reference IN ('nets:1:1:1', 'nets:1:1:2')) = 2,
  'each with its bank reference, linked from its row');
SELECT tests.ok((SELECT count(*) FROM public.invoice_events WHERE invoice_id = (SELECT id FROM i1) AND action = 'invoice.payment') = 1,
  'and in the invoice log');

-- Never twice: the same file, the same rows in another file, the paste path.
SELECT tests.throws($$SELECT public.import_bank_file(NULL, 'nets_ocr', 'upload', 'again.txt', tests.sha('file A'), (SELECT rows FROM f))$$, '23505',
  'the same file is not imported twice');
CREATE TEMP TABLE imp2 ON COMMIT DROP AS
  SELECT * FROM public.import_bank_file(NULL, 'nets_ocr', 'upload', 'copy.txt', tests.sha('file A, sent again'), (SELECT rows FROM f));
SELECT tests.ok((SELECT matched = 0 AND already_recorded = 2 AND already_imported = 7 AND unmatched = 1 AND overpayments = 0 FROM imp2)
                AND (SELECT amount_paid FROM public.invoices WHERE id = (SELECT id FROM i2)) = 100,
  'the same transactions in another file: recorded ones are not counted again, open ones are not listed twice');
SELECT tests.ok(public.record_payment_by_kid('000000026', 100, current_date, 'nets:1:1:2') = (SELECT id FROM i2)
                AND (SELECT amount_paid FROM public.invoices WHERE id = (SELECT id FROM i2)) = 100,
  'pasting an imported transaction does not count it again');
SELECT tests.ok(public.record_payment_by_kid('000000026', 30, current_date, 'PASTED-1') = (SELECT id FROM i2), 'a payment pasted by the old path');
CREATE TEMP TABLE imp3 ON COMMIT DROP AS
  SELECT * FROM public.import_bank_file(NULL, 'camt054', 'upload', 'camt.xml', tests.sha('file B'),
    jsonb_build_array(tests.brow('000000026', 30, 'PASTED-1'), tests.brow('000000026', 30, 'camt:NO93:REF-9'), tests.brow('000000026', 30, 'camt:NO93:REF-10', 'NOK', false, current_date - 1)));
SELECT tests.ok(tests.outcomes((SELECT id FROM imp3)) = 'already_recorded unmatched:possible_duplicate matched'
                AND (SELECT amount_paid FROM public.invoices WHERE id = (SELECT id FROM i2)) = 160,
  'a file after the paste path: the pasted reference is recorded; the same amount and day by another path waits for a person');
-- The paste path through the import: the old references still count once.
CREATE TEMP TABLE imp4 ON COMMIT DROP AS
  SELECT * FROM public.import_bank_file(NULL, 'rows', 'paste', NULL, tests.sha('pasted text'),
    jsonb_build_array(tests.brow('000000026', 30, 'PASTED-1'), tests.brow('000000026', 20, 'PASTED-2')));
SELECT tests.ok(tests.outcomes((SELECT id FROM imp4)) = 'already_recorded matched'
                AND (SELECT amount_paid FROM public.invoices WHERE id = (SELECT id FROM i2)) = 180,
  'pasted rows imported: what the paste path recorded is not counted again');

-- Open rows: set aside with a reason, or recorded against an invoice of the series.
CREATE TEMP TABLE r ON COMMIT DROP AS SELECT line_no, id, reason FROM public.bank_import_rows WHERE import_id = (SELECT id FROM imp);
GRANT SELECT ON r TO anon, service_role;
SELECT tests.ok((SELECT count(*) FROM public.bank_import_rows WHERE outcome IN ('unmatched', 'overpayment') AND resolution IS NULL) = 9,
  'unmatched rows stay open for manual handling');
SELECT tests.throws($$SELECT public.resolve_bank_import_row((SELECT id FROM r WHERE line_no = 3), NULL, ' ')$$, '22023',
  'setting a row aside needs the reason');
SELECT tests.ok((SELECT resolution = 'dismissed' AND resolved_by = :admin
                   FROM public.resolve_bank_import_row((SELECT id FROM r WHERE line_no = 4), NULL, 'refunded to the payer in EUR')),
  'a payment in euros is set aside with its reason');
SELECT tests.throws($$SELECT public.resolve_bank_import_row((SELECT id FROM r WHERE line_no = 4), NULL, 'again')$$, '55000',
  'a row is resolved once');
SELECT tests.throws($$SELECT public.resolve_bank_import_row((SELECT id FROM r WHERE line_no = 1), NULL, 'x')$$, '55000',
  'a matched row is not resolved');
SELECT tests.throws($$SELECT public.resolve_bank_import_row((SELECT id FROM r WHERE line_no = 5), (SELECT id FROM i2), NULL)$$, '22023',
  'a reversal is not recorded against an invoice');
SELECT tests.ok((SELECT resolution = 'recorded' AND resolved_payment_id IS NOT NULL
                   FROM public.resolve_bank_import_row((SELECT id FROM r WHERE line_no = 3), (SELECT id FROM i2), 'KID mistyped by the payer')),
  'a payment with a mistyped KID is recorded against the right invoice');
SELECT tests.ok((SELECT amount_paid FROM public.invoices WHERE id = (SELECT id FROM i2)) = 230, 'and counts on it');
SELECT tests.ok((SELECT reference FROM public.invoice_payments WHERE id = (SELECT resolved_payment_id FROM public.bank_import_rows WHERE id = (SELECT id FROM r WHERE line_no = 3))) = 'nets:1:1:3',
  'with the bank''s reference, so it is counted once');
SELECT public.resolve_bank_import_row((SELECT id FROM r WHERE line_no = 10), (SELECT id FROM i2), NULL);
SELECT tests.ok(EXISTS (SELECT 1 FROM public.invoice_payments WHERE reference = 'bank-import-row:' || (SELECT id FROM r WHERE line_no = 10)::text),
  'a row without a bank reference gets one made for it');
SELECT tests.throws($$SELECT public.resolve_bank_import_row((SELECT id FROM r WHERE line_no = 7), (SELECT id FROM i2), NULL)$$, '22023',
  'an overpayment is never recorded as more than is owed');

-- Kept as imported.
SELECT tests.throws($$UPDATE public.bank_import_rows SET amount = 1$$, '42501', 'members cannot change a row');
RESET ROLE;
SELECT tests.throws($$UPDATE public.bank_imports SET matched = 0$$, '42501', 'an import is kept as it was, even for the database owner');
SELECT tests.throws($$DELETE FROM public.bank_import_rows WHERE import_id = (SELECT id FROM imp)$$, '42501', 'its rows are not deleted');
SELECT tests.throws($$UPDATE public.bank_import_rows SET outcome = 'matched' WHERE resolution IS NOT NULL$$, '42501',
  'a resolved row does not change again');
SET LOCAL ROLE authenticated;

-- Who reads them.
SELECT tests.ok((SELECT count(*) FROM public.bank_imports) = 4, 'FlyttGo administrators read FlyttGo''s imports');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM public.bank_imports) = 0 AND (SELECT count(*) FROM public.bank_import_rows) = 0,
  'a company does not read FlyttGo''s bank file, even for its own invoices');
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.throws($$SELECT count(*) FROM public.bank_import_rows$$, '42501', 'anonymous callers read nothing');
SELECT tests.throws($$SELECT public.preview_bank_import(NULL, 'rows', tests.sha('x'), '[]')$$, '42501', 'nor call the import');
ROLLBACK;

-- ── A company's own series ─────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.sp_acme('field_service', 'jobs') AS id;
GRANT SELECT ON o TO anon, service_role;
SELECT tests.login(:cust1);
SELECT public.set_invoice_settings((SELECT id FROM o), '{"legal_name":"Oslo Rør AS","address":"Verkstedveien 4","postcode_city":"0277 Oslo","bank_account":"1506.12.34567","terms_days":14}');
CREATE TEMP TABLE si ON COMMIT DROP AS SELECT * FROM public.issue_invoice((SELECT id FROM public.create_sales_invoice((SELECT id FROM o),
  '{"name":"Kari Nordmann","email":"cust2@test"}', NULL, '[{"description":"Labour","quantity":2,"unit_price":800,"vat_rate":25}]', NULL, NULL)));
-- FlyttGo's own invoice to the same company has the same KID in FlyttGo's series.
SELECT tests.login(:admin);
CREATE TEMP TABLE d ON COMMIT DROP AS SELECT * FROM public.create_invoice_draft((SELECT id FROM o), '{}');
SELECT public.add_invoice_line((SELECT id FROM d), 'Platform fee', 1, 400);
CREATE TEMP TABLE fi ON COMMIT DROP AS SELECT * FROM public.issue_invoice((SELECT id FROM d));
GRANT SELECT ON si, fi TO anon, service_role;
SELECT tests.ok((SELECT kid FROM si) = '000000018' AND (SELECT kid FROM fi) = '000000018' AND (SELECT total FROM si) = 2000,
  'the company''s invoice 1 and FlyttGo''s invoice 1 share KID 000000018, each in its own series');

SELECT tests.throws($$SELECT public.import_bank_file((SELECT id FROM o), 'camt054', 'upload', 'c.xml', tests.sha('company file'),
  jsonb_build_array(tests.brow('000000018', 500, 'camt:NO15:A1')))$$, '42501',
  'FlyttGo administrators do not import into a company''s books');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.preview_bank_import((SELECT id FROM o), 'camt054', tests.sha('company file'), '[]')$$, '42501',
  'nor does the company''s booker');
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.preview_bank_import((SELECT id FROM o), 'camt054', tests.sha('company file'), '[]')$$, '42501',
  'nor an outsider');

SELECT tests.login(:cust1);
CREATE TEMP TABLE ci ON COMMIT DROP AS SELECT * FROM public.import_bank_file((SELECT id FROM o), 'camt054', 'upload', 'c.xml', tests.sha('company file'),
  jsonb_build_array(tests.brow('000000018', 500, 'camt:NO15:A1'), tests.brow('000000026', 100, 'camt:NO15:A2')));
GRANT SELECT ON ci TO anon, service_role;
SELECT tests.ok(tests.outcomes((SELECT id FROM ci)) = 'matched unmatched:no_invoice' AND (SELECT series FROM ci) = 'org:' || (SELECT id FROM o)::text,
  'the owner imports the company''s bank file into its own series');
SELECT tests.ok((SELECT amount_paid FROM public.invoices WHERE id = (SELECT id FROM si)) = 500
                AND (SELECT amount_paid FROM public.invoices WHERE id = (SELECT id FROM fi)) = 0,
  'the KID matches the company''s invoice, never FlyttGo''s with the same KID');
SELECT tests.ok(EXISTS (SELECT 1 FROM public.organization_events WHERE organization_id = (SELECT id FROM o) AND action = 'invoicing.bank_import'),
  'the import is in the company''s log');
SELECT tests.ok((SELECT count(*) FROM public.bank_imports) = 1, 'the owner reads the company''s imports');

-- The same file, imported by FlyttGo for its own series, matches FlyttGo's invoice.
SELECT tests.login(:admin);
SELECT tests.ok((SELECT count(*) FROM public.bank_imports) = 1, 'FlyttGo administrators read a company''s imports');
CREATE TEMP TABLE fa ON COMMIT DROP AS SELECT * FROM public.import_bank_file(NULL, 'camt054', 'upload', 'f.xml', tests.sha('company file'),
  jsonb_build_array(tests.brow('000000018', 500, 'camt:NO93:B1'), tests.brow('000000018', 100, 'camt:NO15:A1')));
SELECT tests.ok(tests.outcomes((SELECT id FROM fa)) = 'matched unmatched:reference_in_use'
                AND (SELECT amount_paid FROM public.invoices WHERE id = (SELECT id FROM fi)) = 500,
  'FlyttGo''s import matches its own invoice; a reference another series recorded is not counted');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM public.bank_imports) = 1 AND (SELECT count(*) FROM public.bank_import_rows) = 2,
  'the company still sees only its own');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.bank_import_rows) = 0, 'a booker sees no bank rows');

-- The server imports a fetched file for the company.
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((SELECT matched FROM public.import_bank_file((SELECT id FROM o), 'nets_ocr', 'fetch', 'OCR.txt', tests.sha('fetched'),
  jsonb_build_array(tests.brow('000000018', 100, 'nets:9:9:1')))) = 1, 'the server records a fetched file');
SET LOCAL ROLE authenticated;

-- Settings: an automatic fetch needs a provider.
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT provider = 'manual' AND series = 'org:' || (SELECT id FROM o)::text
                   FROM public.set_bank_import_settings((SELECT id FROM o), '{"agreement_id":"000123456","account":"15061234567"}')),
  'the owner records the agreement and account; the provider stays manual');
SELECT tests.throws($$SELECT public.set_bank_import_settings((SELECT id FROM o), '{"fetch_enabled":true}')$$, '23514',
  'an automatic fetch cannot be switched on without a provider');
SELECT tests.throws($$SELECT public.set_bank_import_settings((SELECT id FROM o), '{"provider":"ftp"}')$$, '23514', 'nor an unknown provider');
SELECT tests.throws($$SELECT public.set_bank_import_settings(NULL, '{}')$$, '42501', 'nor FlyttGo''s settings');

-- A suspended company imports nothing.
SELECT tests.login(:admin);
SELECT public.admin_set_organization_status((SELECT id FROM o), 'suspended', 'test');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.import_bank_file((SELECT id FROM o), 'camt054', 'upload', 'c2.xml', tests.sha('second company file'), '[]')$$, '42501',
  'a suspended company cannot import');
SELECT tests.ok((SELECT count(*) FROM public.bank_imports) = 0, 'nor read its imports while suspended');
ROLLBACK;

\echo 'bank import: all tests passed'
