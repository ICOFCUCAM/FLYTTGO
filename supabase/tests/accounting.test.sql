-- ============================================================================
-- Accounting: the portable core (00014) with FlyttGo as its host (00015).
-- Uses tests.sp_acme() (service_platform.test.sql): Acme, a plumber, owned
-- by cust1; drv1 is its booker; cust2 is a customer. Here cust2 is also
-- invited as the company's external auditor and drv2 as its accountant.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''
\set drv2    '''d0000000-0000-0000-0000-000000000002'''

-- Commit-time checks fire now (the voucher is checked when its lines are in).
CREATE OR REPLACE FUNCTION tests.commit_checks() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
END $$;
CREATE OR REPLACE FUNCTION tests.ledger() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM accounting.ledgers WHERE tenant_id = (SELECT id FROM public.organizations WHERE name LIKE 'Acme%' ORDER BY created_at DESC LIMIT 1);
$$;
CREATE OR REPLACE FUNCTION tests.house() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM accounting.ledgers WHERE tenant_id IS NULL;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.sp_acme('field_service', 'jobs') AS id;
GRANT SELECT ON o TO service_role;
CREATE TEMP TABLE y ON COMMIT DROP AS SELECT extract(year FROM current_date)::int - 1 AS last;
GRANT SELECT ON y TO service_role, authenticated;

-- ── Asking for the add-on ───────────────────────────────────────────────────
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT accounting.request_ledger((SELECT id FROM o), make_date((SELECT last FROM y), 1, 1))$$, '42501',
  'a booker cannot ask for accounting');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT accounting.request_ledger((SELECT id FROM o), make_date((SELECT last FROM y), 1, 15))$$, '22023',
  'the books start on the first day of a month');
SELECT accounting.request_ledger((SELECT id FROM o), make_date((SELECT last FROM y), 1, 1));
SELECT tests.ok((SELECT status FROM accounting.ledgers WHERE id = tests.ledger()) = 'requested', 'the owner asks for it');
SELECT tests.throws($$SELECT accounting.decide_ledger(tests.ledger(), true, 199, NULL)$$, '42501', 'the company cannot approve itself');
SELECT tests.throws($$SELECT accounting.post_voucher(tests.ledger(), current_date, 'x', '[]')$$, '55000', 'nothing is posted before approval');

-- An invoice issued before the ledger is active is not posted yet.
SELECT public.set_invoice_settings((SELECT id FROM o), '{"legal_name":"Acme Rør AS","address":"Verkstedveien 4","postcode_city":"0277 Oslo","bank_account":"1506.12.34567","terms_days":14}');
CREATE TEMP TABLE i1 ON COMMIT DROP AS SELECT * FROM public.create_sales_invoice((SELECT id FROM o),
  '{"name":"Kari Nordmann","email":"cust2@test"}', NULL,
  '[{"description":"Arbeid","quantity":2,"unit_price":1000,"vat_rate":25}]', NULL, NULL);
GRANT SELECT ON i1 TO service_role;
SELECT public.issue_invoice((SELECT id FROM i1));

SELECT tests.login(:admin);
SET LOCAL ROLE authenticated;
SELECT tests.throws($$SELECT accounting.decide_ledger(tests.ledger(), true, NULL, NULL)$$, '22023', 'approving needs the monthly price');
SELECT accounting.decide_ledger(tests.ledger(), true, 199, 'Velkommen');
SELECT tests.ok((SELECT monthly_fee FROM accounting.ledgers WHERE id = tests.ledger()) = 199
                AND (SELECT status FROM accounting.ledgers WHERE id = tests.ledger()) = 'active',
  'FlyttGo approves it with its monthly price');
SELECT tests.ok((SELECT count(*) FROM accounting.accounts WHERE ledger_id = tests.ledger()) = 0,
  'FlyttGo''s administrators see the ledger row, never the company''s books');

-- ── Automatic posting from the invoice engine ──────────────────────────────
SELECT tests.login(:cust1);
SELECT accounting.set_settings(tests.ledger(), '{"vat_registered":true}');
SELECT tests.ok((SELECT count(*) FROM accounting.accounts WHERE ledger_id = tests.ledger()) > 60, 'the owner sees the NS 4102 chart of accounts');
SELECT tests.ok((SELECT count(*) FROM public.accounting_unposted(tests.ledger())) = 1, 'the invoice issued before approval is listed as not posted');
SELECT tests.ok(public.accounting_post_unposted(tests.ledger()) = 1, 'and posted on request');
SELECT tests.ok((SELECT count(*) FROM public.accounting_unposted(tests.ledger())) = 0, 'nothing is left');

CREATE TEMP TABLE i2 ON COMMIT DROP AS SELECT * FROM public.create_sales_invoice((SELECT id FROM o),
  '{"name":"Ola Hansen","email":"ola@test"}', NULL,
  '[{"description":"Rørlegging","quantity":1,"unit_price":800,"vat_rate":25},{"description":"Matkasse","quantity":1,"unit_price":100,"vat_rate":15}]', NULL, NULL);
GRANT SELECT ON i2 TO service_role;
SELECT public.issue_invoice((SELECT id FROM i2));
SELECT tests.commit_checks();
SELECT tests.ok((SELECT count(*) FROM accounting.vouchers WHERE ledger_id = tests.ledger() AND source_type = 'invoice' AND source_id = (SELECT id FROM i2)) = 1,
  'an issued invoice is posted by itself');
SELECT tests.ok((SELECT string_agg(account_code || ':' || debit || '/' || credit || ':' || coalesce(mva_code, '-'), ' ' ORDER BY line_no)
                   FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
                  WHERE v.source_id = (SELECT id FROM i2) AND v.source_type = 'invoice')
                = '1500:1115.00/0.00:- 3000:0.00/800.00:3 2700:0.00/200.00:3 3001:0.00/100.00:31 2701:0.00/15.00:31',
  'receivables 1 115, sales and MVA per rate with codes 3 and 31');
SELECT public.record_invoice_payment((SELECT id FROM i2), 1115, current_date, 'bank', 'bank-1');
SELECT tests.ok((SELECT count(*) FROM accounting.vouchers WHERE ledger_id = tests.ledger() AND source_type = 'payment') = 1,
  'a payment is posted: bank against receivables');
SELECT public.create_credit_note((SELECT id FROM i1), NULL, 'Feil pris');
SELECT tests.ok((SELECT count(*) FROM accounting.vouchers WHERE ledger_id = tests.ledger() AND source_type = 'credit_note') = 1,
  'a credit note is posted');
SELECT tests.ok((SELECT closing FROM accounting.trial_balance(tests.ledger(), make_date((SELECT last FROM y), 1, 1), current_date) WHERE account_code = '1500') = 0,
  'receivables are 0 once the one invoice is paid and the other credited');

-- ── Manual vouchers ─────────────────────────────────────────────────────────
SELECT tests.throws($$SELECT accounting.post_voucher(tests.ledger(), make_date((SELECT last FROM y), 3, 10), '', '[{"account":"6810","amount":100},{"account":"1920","amount":-100}]')$$,
  '22023', 'a voucher needs a description');
SELECT tests.throws($$SELECT accounting.post_voucher(tests.ledger(), make_date((SELECT last - 1 FROM y), 12, 31), 'x', '[{"account":"6810","amount":100},{"account":"1920","amount":-100}]')$$,
  '22023', 'nothing is dated before the books start');
DO $$
BEGIN
  PERFORM accounting.post_voucher(tests.ledger(), make_date((SELECT last FROM y), 3, 10), 'Ubalansert',
    '[{"account":"6810","amount":100},{"account":"1920","amount":-90}]');
  PERFORM tests.commit_checks();
  RAISE EXCEPTION 'FAIL: an unbalanced voucher was accepted';
EXCEPTION WHEN SQLSTATE '23514' THEN RAISE NOTICE 'ok - a voucher that does not balance is refused';
END $$;
CREATE TEMP TABLE m1 ON COMMIT DROP AS SELECT * FROM accounting.post_voucher(tests.ledger(), make_date((SELECT last FROM y), 3, 10),
  'Programvare, faktura 4471 fra Leverandør AS', '[{"account":"6810","amount":1250,"mva_code":"1","party":"Leverandør AS"},{"account":"2400","amount":-1250,"party":"Leverandør AS"}]');
GRANT SELECT ON m1 TO service_role, authenticated;
SELECT tests.commit_checks();
SELECT tests.ok((SELECT string_agg(account_code || ':' || debit || '/' || credit, ' ' ORDER BY line_no) FROM accounting.voucher_lines WHERE voucher_id = (SELECT id FROM m1))
                = '6810:1000.00/0.00 2710:250.00/0.00 2400:0.00/1250.00',
  'an amount with MVA code 1 is split into 1 000 and 250 input MVA');
SELECT tests.ok((SELECT year || '-' || number FROM m1) = (SELECT last FROM y) || '-1', 'the first voucher of the year is number 1');
SELECT tests.throws($$UPDATE accounting.vouchers SET description = 'x' WHERE id = (SELECT id FROM m1)$$, '42501', 'a voucher cannot be changed');
RESET ROLE;
SELECT tests.throws($$UPDATE accounting.voucher_lines SET debit = 1 WHERE voucher_id = (SELECT id FROM m1)$$, '42501', 'not even by the database owner: lines are written once');
SELECT tests.throws($$DELETE FROM accounting.vouchers WHERE id = (SELECT id FROM m1)$$, '42501', 'and vouchers are never deleted');
SET LOCAL ROLE authenticated;
SELECT tests.throws($$INSERT INTO accounting.voucher_lines (voucher_id, ledger_id, line_no, account_code, debit) VALUES ((SELECT id FROM m1), tests.ledger(), 9, '1920', 1)$$,
  '42501', 'nobody writes lines directly');
SELECT accounting.reverse_voucher((SELECT id FROM m1), make_date((SELECT last FROM y), 3, 11), 'Feil konto');
SELECT tests.throws($$SELECT accounting.reverse_voucher((SELECT id FROM m1), NULL, 'igjen')$$, '55000', 'a voucher is reversed once');
SELECT tests.throws($$SELECT accounting.reverse_voucher((SELECT id FROM accounting.vouchers WHERE source_type = 'invoice' AND ledger_id = tests.ledger() LIMIT 1), NULL, 'x')$$,
  '55000', 'an invoice''s voucher is corrected with a credit note, not reversed');
SELECT accounting.post_voucher(tests.ledger(), make_date((SELECT last FROM y), 3, 12), 'Programvare, faktura 4471 fra Leverandør AS (rettet)',
  '[{"account":"6800","amount":1250,"mva_code":"1","party":"Leverandør AS"},{"account":"2400","amount":-1250,"party":"Leverandør AS"}]');
SELECT accounting.post_voucher(tests.ledger(), make_date((SELECT last FROM y), 4, 2), 'Kontantsalg',
  '[{"account":"1920","amount":500},{"account":"3000","amount":-500,"mva_code":"3"}]');
SELECT tests.commit_checks();

-- ── Reports ─────────────────────────────────────────────────────────────────
SELECT tests.ok((SELECT sum(debit) = sum(credit) FROM accounting.trial_balance(tests.ledger(), make_date((SELECT last FROM y), 1, 1), current_date)),
  'the trial balance balances');
SELECT tests.ok((SELECT sum(CASE WHEN grp = '1 Eiendeler' THEN amount ELSE -amount END) FROM accounting.balance_sheet(tests.ledger(), current_date)) = 0,
  'the balance sheet balances, with the result not yet closed under equity');
SELECT tests.ok((SELECT string_agg(mva_code || ':' || basis || '/' || mva, ' ') FROM accounting.mva_report(tests.ledger(), (SELECT last FROM y), 2))
                = '1:1000.00/250.00 3:400.00/100.00',
  'MVA term 2: input 250 on 1 000 (the reversed voucher nets out), output 100 on 400');
SELECT tests.throws($$SELECT accounting.mva_report(tests.ledger(), 2025, 7)$$, '22023', 'there is no seventh two-month term');
CREATE TEMP TABLE s ON COMMIT DROP AS SELECT * FROM accounting.settle_mva(tests.ledger(), (SELECT last FROM y), 2);
GRANT SELECT ON s TO service_role;
SELECT tests.ok((SELECT debit FROM accounting.voucher_lines WHERE voucher_id = (SELECT id FROM s) AND account_code = '2740') = 150,
  'settling term 2 moves output 100 less input 250 to 2740: 150 to be refunded');
SELECT tests.throws($$SELECT accounting.settle_mva(tests.ledger(), (SELECT last FROM y), 2)$$, '55000', 'a term is settled once');
SELECT tests.ok((SELECT bool_and(ok) FILTER (WHERE check_name <> 'Manual vouchers have a receipt')
                   FROM accounting.review_checks(tests.ledger(), make_date((SELECT last FROM y), 1, 1), current_date)),
  'the review checks pass: balanced, no gaps, MVA accounts agree');
SELECT tests.ok(NOT (SELECT ok FROM accounting.review_checks(tests.ledger(), make_date((SELECT last FROM y), 1, 1), current_date)
                     WHERE check_name = 'Manual vouchers have a receipt'),
  'manual vouchers without a receipt are pointed out');

-- Receipts
SELECT tests.throws($$SELECT accounting.add_attachment((SELECT id FROM m1), 'other/receipt.pdf', 'r.pdf', repeat('a', 64), 100)$$, '22023',
  'a receipt belongs in the ledger''s folder');
SELECT accounting.add_attachment((SELECT id FROM m1), tests.ledger() || '/' || (SELECT id FROM m1) || '/receipt.pdf', 'faktura-4471.pdf', repeat('ab', 32), 2048);
SELECT tests.ok(accounting.path_access(tests.ledger() || '/x.pdf', true) AND NOT accounting.path_access('not-a-ledger/x.pdf', false),
  'the owner may upload to the ledger''s folder; other paths are refused');

-- Closing
SELECT accounting.lock_period(tests.ledger(), make_date((SELECT last FROM y), 6, 30));
SELECT tests.throws($$SELECT accounting.post_voucher(tests.ledger(), make_date((SELECT last FROM y), 6, 1), 'Sent', '[{"account":"6810","amount":10},{"account":"1920","amount":-10}]')$$,
  '55000', 'nothing is posted in a closed period');
SELECT tests.throws($$SELECT accounting.lock_period(tests.ledger(), make_date((SELECT last FROM y), 3, 31))$$, '55000', 'a closed period is never opened again');
SELECT accounting.close_year(tests.ledger(), (SELECT last FROM y));
SELECT tests.commit_checks();
SELECT tests.ok((SELECT coalesce(sum(amount), 0) FROM accounting.balance_sheet(tests.ledger(), make_date((SELECT last FROM y), 12, 31)) WHERE account_code IS NULL) = 0,
  'after year end the result is in equity (2050)');
SELECT tests.throws($$SELECT accounting.close_year(tests.ledger(), (SELECT last FROM y))$$, '55000', 'a year is closed once');

-- ── The back office ─────────────────────────────────────────────────────────
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT accounting.invite(tests.ledger(), 'drv2@test', 'accountant')$$, '42501', 'a booker cannot invite');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT accounting.invite(tests.ledger(), 'cust2@test', 'auditor')$$, '22023', 'an external auditor''s access needs an end date');
CREATE TEMP TABLE inv_a ON COMMIT DROP AS SELECT * FROM accounting.invite(tests.ledger(), 'cust2@test', 'auditor', 'Revisor Revisjon', 'Revisjon AS', current_date + 60);
CREATE TEMP TABLE inv_b ON COMMIT DROP AS SELECT * FROM accounting.invite(tests.ledger(), 'DRV2@test', 'accountant', 'Regnskap Regnskapsen', 'Regnskap AS');
GRANT SELECT ON inv_a, inv_b TO authenticated, service_role;
SELECT tests.ok((SELECT count(*) FROM accounting.invitations WHERE ledger_id = tests.ledger() AND status = 'pending') = 2
                AND (SELECT count(*) FROM accounting.invitations WHERE token_hash = (SELECT token FROM inv_a)) = 0,
  'two invitations; only the token''s hash is kept');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT accounting.accept_invitation((SELECT token FROM inv_a))$$, '42501', 'only the invited address can accept');
SELECT tests.login(:cust2);
SELECT accounting.accept_invitation((SELECT token FROM inv_a));
SELECT tests.throws($$SELECT accounting.accept_invitation((SELECT token FROM inv_a))$$, '22023', 'an invitation is used once');
SELECT tests.ok(accounting.role_of(tests.ledger()) = 'auditor' AND (SELECT count(*) FROM accounting.vouchers WHERE ledger_id = tests.ledger()) > 5,
  'the external auditor reads the books');
SELECT tests.throws($$SELECT accounting.post_voucher(tests.ledger(), current_date, 'x', '[{"account":"6810","amount":10},{"account":"1920","amount":-10}]')$$,
  '42501', 'but posts nothing');
SELECT accounting.add_note(tests.ledger(), (SELECT id FROM m1), 'Kvittering mangler signatur.');
SELECT tests.ok((SELECT role FROM accounting.notes WHERE ledger_id = tests.ledger()) = 'auditor', 'and writes notes, marked as the auditor''s');
SELECT tests.ok((SELECT count(*) FROM accounting.my_ledgers()) = 1, 'the auditor finds the ledger in their list');
SELECT tests.login(:drv2);
SELECT accounting.accept_invitation((SELECT token FROM inv_b));
SELECT tests.ok(accounting.role_of(tests.ledger()) = 'accountant', 'the accountant joins (the address is matched without case)');
SELECT accounting.post_voucher(tests.ledger(), current_date, 'Bankgebyr', '[{"account":"7770","amount":45},{"account":"1920","amount":-45}]');
SELECT tests.ok((SELECT count(*) FROM accounting.vouchers WHERE ledger_id = tests.ledger() AND description = 'Bankgebyr') = 1, 'and posts');
SELECT tests.throws($$SELECT accounting.invite(tests.ledger(), 'x@test', 'viewer')$$, '42501', 'but does not manage the back office');
SELECT tests.login(:cust1);
SELECT accounting.update_member(tests.ledger(), :cust2, 'auditor', current_date - 1);
SELECT tests.login(:cust2);
SELECT tests.ok(accounting.role_of(tests.ledger()) IS NULL AND (SELECT count(*) FROM accounting.vouchers WHERE ledger_id = tests.ledger()) = 0,
  'an auditor''s access ends after its end date');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT accounting.remove_member(tests.ledger(), 'd0000000-0000-0000-0000-000000000002', '')$$, '22023', 'removing someone needs a reason');
SELECT accounting.remove_member(tests.ledger(), :drv2, 'Bytter regnskapsfører');
SELECT tests.ok((SELECT status || ':' || removed_reason FROM accounting.members WHERE ledger_id = tests.ledger() AND user_id = :drv2) = 'removed:Bytter regnskapsfører',
  'a removed person stays in the list with the reason');
SELECT tests.login(:drv2);
SELECT tests.ok((SELECT count(*) FROM accounting.vouchers WHERE ledger_id = tests.ledger()) = 0, 'and no longer reads the books');

-- ── FlyttGo's own books ─────────────────────────────────────────────────────
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT accounting.open_house_ledger('FlyttGo AS', '923609016', make_date((SELECT last FROM y), 1, 1))$$, '42501',
  'a company cannot open FlyttGo''s books');
SELECT tests.login(:admin);
SELECT accounting.open_house_ledger('FlyttGo AS', '923609016', make_date((SELECT last FROM y), 1, 1));
CREATE TEMP TABLE fi ON COMMIT DROP AS SELECT * FROM public.create_invoice_draft((SELECT id FROM o), '{}'::uuid[]);
GRANT SELECT ON fi TO service_role;
SELECT public.add_invoice_line((SELECT id FROM fi), 'Plan Jobs, november', 1, 1290, 25);
SELECT public.issue_invoice((SELECT id FROM fi));
SELECT tests.commit_checks();
SELECT tests.ok((SELECT count(*) FROM accounting.vouchers WHERE ledger_id = tests.house() AND source_id = (SELECT id FROM fi)) = 1
                AND (SELECT count(*) FROM accounting.vouchers WHERE ledger_id = tests.ledger() AND source_id = (SELECT id FROM fi)) = 0,
  'FlyttGo''s own invoice goes into FlyttGo''s books, not the company''s');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM accounting.vouchers WHERE ledger_id = tests.house()) = 0, 'and a company never reads FlyttGo''s books');

-- Billing the add-on
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
SELECT tests.ok((SELECT monthly_fee FROM public.accounting_billable(current_date) WHERE ledger_id = tests.ledger()) = 199,
  'the invoice run bills the add-on at its approved price');
SET LOCAL ROLE authenticated;

-- Ending
SELECT tests.login(:cust1);
SELECT accounting.end_ledger(tests.ledger(), 'Bytter system');
SELECT tests.throws($$SELECT accounting.post_voucher(tests.ledger(), current_date, 'x', '[{"account":"6810","amount":10},{"account":"1920","amount":-10}]')$$,
  '55000', 'an ended ledger takes no new vouchers');
SELECT tests.ok((SELECT count(*) FROM accounting.vouchers WHERE ledger_id = tests.ledger()) > 5, 'but its books stay readable');
SELECT tests.throws($$SELECT accounting.request_ledger((SELECT id FROM o), make_date((SELECT last FROM y), 1, 1))$$, '55000',
  'and it is not reopened');
ROLLBACK;

\echo 'accounting: all tests passed'
