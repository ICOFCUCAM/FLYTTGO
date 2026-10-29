-- ============================================================================
-- Isolation: each company's books are its own. Owners, accountants and
-- FlyttGo's administrators each see exactly what they should, in every
-- table, report, function and the receipts bucket.
-- ============================================================================
\set ON_ERROR_STOP 1
\set admin '''a0000000-0000-0000-0000-000000000001'''
\set cust1 '''c0000000-0000-0000-0000-000000000001'''
\set cust2 '''c0000000-0000-0000-0000-000000000002'''
\set drv1  '''d0000000-0000-0000-0000-000000000001'''
\set drv2  '''d0000000-0000-0000-0000-000000000002'''

CREATE OR REPLACE FUNCTION tests.l(k text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT id FROM tests.ctl WHERE key = k $$;
CREATE OR REPLACE FUNCTION tests.visible(p_ledger uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT (SELECT count(*) FROM accounting.accounts WHERE ledger_id = p_ledger) || '/'
      || (SELECT count(*) FROM accounting.vouchers WHERE ledger_id = p_ledger) || '/'
      || (SELECT count(*) FROM accounting.voucher_lines WHERE ledger_id = p_ledger) || '/'
      || (SELECT count(*) FROM accounting.attachments a JOIN accounting.vouchers v ON v.id = a.voucher_id WHERE v.ledger_id = p_ledger) || '/'
      || (SELECT count(*) FROM accounting.events WHERE ledger_id = p_ledger) || '/'
      || (SELECT count(*) FROM accounting.notes WHERE ledger_id = p_ledger) || '/'
      || (SELECT count(*) FROM accounting.posting_accounts WHERE ledger_id = p_ledger);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO authenticated, anon, service_role;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok(tests.visible(tests.l('ledger_a')) NOT LIKE '0/%' AND split_part(tests.visible(tests.l('ledger_a')), '/', 2)::int >= 100,
  'A''s owner reads A''s books');
SELECT tests.ok(tests.visible(tests.l('ledger_b')) = '0/0/0/0/0/0/0' AND tests.visible(tests.l('ledger_house')) = '0/0/0/0/0/0/0',
  'A''s owner sees nothing of B''s books or FlyttGo''s');
SELECT tests.ok((SELECT count(*) FROM accounting.ledgers WHERE id IN (tests.l('ledger_b'), tests.l('ledger_house'))) = 0, 'not even the other ledgers'' rows');
SELECT tests.throws($$SELECT accounting.trial_balance(tests.l('ledger_b'), '2000-01-01', current_date)$$, '42501', 'A''s owner cannot run B''s reports');
SELECT tests.throws($$SELECT accounting.post_voucher(tests.l('ledger_b'), current_date, 'x', '[{"account":"6800","amount":1},{"account":"1920","amount":-1}]')$$, '42501',
  'nor post in B''s books');
SELECT tests.throws($$SELECT accounting.invite(tests.l('ledger_b'), 'x@test', 'viewer')$$, '42501', 'nor invite anyone to B');
SELECT tests.throws($$SELECT accounting.add_note(tests.l('ledger_b'), NULL, 'x')$$, '42501', 'nor write notes there');
SELECT tests.throws($$SELECT public.accounting_unposted(tests.l('ledger_b'))$$, '42501', 'nor list B''s unposted invoices');
SELECT tests.ok(NOT accounting.path_access(tests.l('ledger_b') || '/x.pdf', false) AND accounting.path_access(tests.l('ledger_a') || '/x.pdf', false),
  'receipts: A''s owner reaches A''s folder only');

SELECT tests.login(:drv2);
SELECT tests.ok(accounting.role_of(tests.l('ledger_a')) = 'accountant' AND split_part(tests.visible(tests.l('ledger_a')), '/', 2)::int >= 100,
  'A''s accountant reads A''s books');
SELECT tests.ok(tests.visible(tests.l('ledger_b')) = '0/0/0/0/0/0/0', 'and nothing of B''s');
SELECT tests.ok((SELECT count(*) FROM public.organizations WHERE id = (SELECT id FROM tests.ctl WHERE key = 'org_a')) = 0,
  'access to the books gives no access to the company''s other records');
SELECT tests.throws($$SELECT accounting.remove_member(tests.l('ledger_a'), 'd0000000-0000-0000-0000-000000000002', 'x')$$, '42501',
  'the accountant does not manage the back office');

SELECT tests.login(:drv1);
SELECT tests.ok(tests.visible(tests.l('ledger_a')) = '0/0/0/0/0/0/0', 'a booker of A sees nothing of A''s books');

SELECT tests.login(:admin);
SELECT tests.ok(tests.visible(tests.l('ledger_a')) = '0/0/0/0/0/0/0' AND tests.visible(tests.l('ledger_b')) = '0/0/0/0/0/0/0',
  'FlyttGo''s administrators see no company''s books');
SELECT tests.ok((SELECT count(*) FROM accounting.ledgers WHERE id IN (tests.l('ledger_a'), tests.l('ledger_b'))) = 2,
  'only the ledger rows they approve');
SELECT tests.ok(split_part(tests.visible(tests.l('ledger_house')), '/', 2)::int >= 6, 'and FlyttGo''s own books');
SELECT tests.throws($$SELECT accounting.trial_balance(tests.l('ledger_a'), '2000-01-01', current_date)$$, '42501', 'reports on a company are refused to them');
SELECT tests.ok(NOT accounting.path_access(tests.l('ledger_a') || '/x.pdf', false), 'and its receipts');

SELECT tests.login(:cust2);
SELECT tests.ok(split_part(tests.visible(tests.l('ledger_b')), '/', 2)::int = 30 AND tests.visible(tests.l('ledger_a')) = '0/0/0/0/0/0/0',
  'B''s owner reads B''s 30 vouchers and nothing of A''s');
SELECT tests.ok((SELECT count(*) FROM accounting.members WHERE ledger_id = tests.l('ledger_a')) = 0
                AND (SELECT count(*) FROM accounting.invitations WHERE ledger_id = tests.l('ledger_a')) = 0,
  'nor who works on A''s books');

SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.throws($$SELECT count(*) FROM accounting.vouchers$$, '42501', 'anonymous visitors reach nothing');
ROLLBACK;

-- Each ledger's own numbers, and every voucher balanced.
SELECT tests.ok((SELECT bool_and(n_max = n_count) FROM (SELECT ledger_id, year, max(number) n_max, count(*) n_count FROM accounting.vouchers GROUP BY 1, 2) s),
  'every ledger numbers its vouchers per year without gaps');
SELECT tests.ok((SELECT count(*) FROM (SELECT voucher_id FROM accounting.voucher_lines GROUP BY 1 HAVING sum(debit) <> sum(credit) OR count(*) < 2) s) = 0,
  'every voucher in every ledger balances');
SELECT tests.ok((SELECT count(*) FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id WHERE vl.ledger_id <> v.ledger_id) = 0,
  'no line sits in another ledger than its voucher');
SELECT tests.ok((SELECT count(*) FROM public.invoices i WHERE i.status <> 'draft' AND i.total <> 0 AND i.issuer_org = (SELECT id FROM tests.ctl WHERE key = 'org_a'))
                = (SELECT count(*) FROM accounting.vouchers WHERE ledger_id = tests.l('ledger_a') AND source_type IN ('invoice', 'credit_note')),
  'every issued invoice and credit note of A is in A''s books, once');
SELECT tests.ok((SELECT count(*) FROM accounting.vouchers WHERE ledger_id = tests.l('ledger_house') AND source_type = 'invoice')
                = (SELECT count(*) FROM public.invoices WHERE issuer_org IS NULL AND status <> 'draft' AND total <> 0 AND issue_date >= make_date(extract(year FROM current_date)::int - 1, 1, 1)),
  'every invoice FlyttGo issued is in FlyttGo''s books, none in a company''s');
SELECT tests.ok((SELECT closing FROM accounting.trial_balance(tests.l('ledger_a'), make_date(extract(year FROM current_date)::int - 1, 1, 1), current_date) WHERE account_code = '1500')
                = (SELECT sum(total - amount_paid) FROM public.invoices WHERE issuer_org = (SELECT id FROM tests.ctl WHERE key = 'org_a') AND status <> 'draft'),
  'A''s receivables in the books equal what its invoices say is outstanding');

\echo 'accounting isolation: all tests passed'
