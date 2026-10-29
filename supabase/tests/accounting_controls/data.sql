-- ============================================================================
-- Representative data on the copy of production (committed, not rolled
-- back): company A (Acme, a plumber; owner cust1, its accountant drv2),
-- company B (Bergen Elektro; owner cust2), FlyttGo's own books (admin).
-- Volumes are small but cover every path: sales at 25, 15, 12 and 0 %,
-- payments, credit notes, reminders, purchases with input MVA and receipts.
-- ============================================================================
\set ON_ERROR_STOP 1
\set admin '''a0000000-0000-0000-0000-000000000001'''
\set cust1 '''c0000000-0000-0000-0000-000000000001'''
\set cust2 '''c0000000-0000-0000-0000-000000000002'''
\set drv2  '''d0000000-0000-0000-0000-000000000002'''

CREATE TABLE tests.ctl (key text PRIMARY KEY, id uuid);
GRANT SELECT ON tests.ctl TO authenticated, service_role;
INSERT INTO tests.ctl SELECT 'org_a', tests.sp_acme('field_service', 'jobs');
INSERT INTO public.organizations (id, name, slug, org_number, vat_registered, status)
VALUES ('b0000000-0000-0000-0000-00000000000b', 'Bergen Elektro AS', 'bergen-elektro', '974760673', true, 'active');
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('b0000000-0000-0000-0000-00000000000b', :cust2, 'owner', 'active');
INSERT INTO tests.ctl VALUES ('org_b', 'b0000000-0000-0000-0000-00000000000b');

CREATE OR REPLACE FUNCTION tests.as_user(p uuid) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false) $$;

DO $$
DECLARE a uuid := (SELECT id FROM tests.ctl WHERE key = 'org_a'); b uuid := (SELECT id FROM tests.ctl WHERE key = 'org_b');
        y int := extract(year FROM current_date)::int - 1; la uuid; lb uuid; lh uuid; i int; inv public.invoices; t record;
BEGIN
  PERFORM tests.as_user('c0000000-0000-0000-0000-000000000001');
  PERFORM public.set_invoice_settings(a, '{"legal_name":"Acme Rør AS","address":"Verkstedveien 4","postcode_city":"0277 Oslo","bank_account":"1506.12.34567","terms_days":14,"reminder_fee":35}');
  la := (accounting.request_ledger(a, make_date(y, 1, 1), 'bimonthly', 3500000)).id;
  PERFORM tests.as_user('c0000000-0000-0000-0000-000000000002');
  lb := (accounting.request_ledger(b, make_date(y, 1, 1), 'bimonthly', 800000)).id;
  PERFORM tests.as_user('a0000000-0000-0000-0000-000000000001');
  PERFORM accounting.decide_ledger(la, true, NULL, 'pilot');
  PERFORM accounting.decide_ledger(lb, true, NULL, 'pilot');
  lh := (accounting.open_house_ledger('FlyttGo AS', '923609016', make_date(y, 1, 1))).id;
  INSERT INTO tests.ctl VALUES ('ledger_a', la), ('ledger_b', lb), ('ledger_house', lh);

  -- A: purchases last year, every one with a receipt.
  PERFORM tests.as_user('c0000000-0000-0000-0000-000000000001');
  PERFORM accounting.set_settings(la, '{"vat_registered":true}');
  FOR i IN 1..60 LOOP
    t := NULL;
    SELECT * INTO t FROM accounting.post_voucher(la, make_date(y, 1 + (i % 12), 1 + (i % 27)), 'Innkjøp ' || i,
      jsonb_build_array(jsonb_build_object('account', CASE i % 3 WHEN 0 THEN '6810' WHEN 1 THEN '7000' ELSE '4000' END,
                                           'amount', 125 * (1 + i % 9), 'mva_code', '1', 'party', 'Leverandør ' || (i % 5)),
                        jsonb_build_object('account', '2400', 'amount', -125 * (1 + i % 9), 'party', 'Leverandør ' || (i % 5))));
    PERFORM accounting.add_attachment(t.id, la || '/' || t.id || '/kvittering.pdf', 'kvittering-' || i || '.pdf', md5(i::text) || md5(i::text), 1000 + i);
  END LOOP;
  -- A: sales invoices at every rate; half paid, some credited, one reminded.
  FOR i IN 1..40 LOOP
    inv := public.create_sales_invoice(a, jsonb_build_object('name', 'Kunde ' || (i % 7), 'email', 'kunde' || i || '@test'), NULL,
      jsonb_build_array(jsonb_build_object('description', 'Arbeid', 'quantity', 1 + i % 3, 'unit_price', 850,
                                           'vat_rate', (ARRAY[25, 15, 12, 0])[1 + i % 4])), NULL, NULL);
    inv := public.issue_invoice(inv.id);
    IF i % 2 = 0 THEN PERFORM public.record_invoice_payment(inv.id, inv.total, current_date, 'bank', 'bank-a-' || i); END IF;
    IF i % 10 = 5 THEN PERFORM public.create_credit_note(inv.id, NULL, 'Reklamasjon'); END IF;
  END LOOP;

  -- B: its own purchases and cash sales.
  PERFORM tests.as_user('c0000000-0000-0000-0000-000000000002');
  PERFORM accounting.set_settings(lb, '{"vat_registered":true}');
  FOR i IN 1..30 LOOP
    PERFORM accounting.post_voucher(lb, make_date(y, 1 + (i % 12), 2), CASE WHEN i % 2 = 0 THEN 'Kontantsalg ' ELSE 'Materiell ' END || i,
      CASE WHEN i % 2 = 0
        THEN jsonb_build_array(jsonb_build_object('account', '1920', 'amount', 500 * i), jsonb_build_object('account', '3000', 'amount', -500 * i, 'mva_code', '3'))
        ELSE jsonb_build_array(jsonb_build_object('account', '4000', 'amount', 200 * i, 'mva_code', '1'), jsonb_build_object('account', '1920', 'amount', -200 * i)) END);
  END LOOP;

  -- FlyttGo's own invoices to A, posted in the house ledger.
  PERFORM tests.as_user('a0000000-0000-0000-0000-000000000001');
  FOR i IN 1..6 LOOP
    inv := public.create_invoice_draft(a, '{}'::uuid[]);
    PERFORM public.add_invoice_line(inv.id, 'Plan Jobs ' || i, 1, 1290, 25);
    PERFORM public.issue_invoice(inv.id);
  END LOOP;
END $$;

-- A's accountant: drv2, invited by the owner and accepted.
DO $$
DECLARE tok text;
BEGIN
  PERFORM tests.as_user('c0000000-0000-0000-0000-000000000001');
  SELECT token INTO tok FROM accounting.invite((SELECT id FROM tests.ctl WHERE key = 'ledger_a'), 'drv2@test', 'accountant', 'Regnskap', 'Regnskap AS');
  PERFORM tests.as_user('d0000000-0000-0000-0000-000000000002');
  PERFORM accounting.accept_invitation(tok);
END $$;
SELECT set_config('request.jwt.claims', '', false);

SELECT 'data: ' || (SELECT count(*) FROM accounting.vouchers) || ' vouchers in ' || (SELECT count(*) FROM accounting.ledgers) || ' ledgers' AS loaded;
