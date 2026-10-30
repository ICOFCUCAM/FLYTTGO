-- ============================================================================
-- Release rehearsal, part 3: checks on the copy of production with the
-- representative data in place and 00016–00022 applied (run.sh). Each block
-- rolls back, except the webhook deliveries, which stay for the rollback.
-- ============================================================================
\set ON_ERROR_STOP 1

-- The rows of a table that belong to none of p_orgs (by its company
-- columns), as the current role and user see them; NULL when the role may
-- not read the table at all.
CREATE OR REPLACE FUNCTION tests.rh_foreign(p_table text, p_orgs uuid[])
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_pred text; v_n bigint;
BEGIN
  SELECT string_agg(format('%I = ANY ($1)', a.attname), ' OR ') INTO v_pred
    FROM pg_attribute a WHERE a.attrelid = ('public.' || quote_ident(p_table))::regclass
     AND a.attname IN ('organization_id', 'issuer_org') AND NOT a.attisdropped;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE NOT coalesce(%s, false)', p_table, v_pred) INTO v_n USING p_orgs;
  RETURN v_n;
EXCEPTION WHEN insufficient_privilege THEN RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION tests.rh_count(p_table text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I', p_table) INTO n; RETURN n;
EXCEPTION WHEN insufficient_privilege THEN RETURN NULL;
END $$;
-- What a delivery of a Stripe event does in the database, step by step as
-- stripe-webhook does it: an event already in payment_events is a
-- duplicate; otherwise the payment is recorded (once: by its provider
-- reference) and the event is logged.
CREATE OR REPLACE FUNCTION tests.rh_webhook(p_event text, p_kind text, p_target uuid, p_amount numeric, p_account text, p_ref text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text; b record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.payment_events WHERE provider = 'stripe' AND event_id = p_event) THEN RETURN 'duplicate'; END IF;
  CASE p_kind
    WHEN 'sales_invoice' THEN
      IF EXISTS (SELECT 1 FROM public.invoice_payments WHERE invoice_id = p_target AND method = 'card' AND reference = p_ref) THEN
        v := 'idempotent';
      ELSE
        BEGIN
          PERFORM public.record_invoice_payment(p_target, p_amount, current_date, 'card', p_ref);
          v := 'recorded';
        EXCEPTION WHEN unique_violation THEN v := 'idempotent';
        END;
      END IF;
    WHEN 'shop_order' THEN
      v := public.record_shop_payment(p_target, p_amount, p_account, p_ref, 'cs_' || p_ref);
    WHEN 'booking' THEN
      SELECT payment_status INTO b FROM public.bookings WHERE id = p_target;
      IF b.payment_status IN ('paid', 'escrow', 'released', 'refunded') THEN
        v := 'idempotent';
      ELSE
        UPDATE public.bookings SET payment_status = 'paid', payment_provider = 'stripe', payment_intent_id = p_ref,
               stripe_session_id = 'cs_' || p_ref, paid_amount = p_amount, paid_at = now(), captured_at = now(), captured_amount = p_amount
         WHERE id = p_target;
        UPDATE public.escrow_payments SET status = 'escrow' WHERE booking_id = p_target;
        v := 'paid';
      END IF;
  END CASE;
  INSERT INTO public.payment_events (provider, event_id, kind, booking_id, result)
  VALUES ('stripe', p_event, 'checkout.session.completed', CASE WHEN p_kind = 'booking' THEN p_target END, jsonb_build_object('outcome', v))
  ON CONFLICT DO NOTHING;
  RETURN v;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── RLS on every table with company data ──────────────────────────────────
DO $$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN SELECT DISTINCT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             JOIN pg_attribute a ON a.attrelid = c.oid
            WHERE ns.nspname = 'public' AND c.relkind = 'r' AND a.attname IN ('organization_id', 'issuer_org') AND NOT a.attisdropped LOOP
    IF NOT t.relrowsecurity THEN RAISE EXCEPTION 'FAIL: % holds company data without row-level security', t.relname; END IF;
    n := n + 1;
  END LOOP;
  PERFORM tests.ok(n >= 40, format('row-level security is on for every one of the %s tables with a company column', n));
END $$;

-- ── Cross-company isolation, per table, for every member in every role ───
-- What another company may see is its public booking page and catalogue:
-- the hotel's room types and rules, the restaurant's service periods and
-- rules, the shop's products, variants and delivery options, the trade's
-- services and the salon's services, staff names and hours (each only
-- while the module is on). Nothing else of another company is visible to
-- anyone, in any role.
CREATE TEMP TABLE rh_public (tbl text PRIMARY KEY);
INSERT INTO rh_public VALUES ('hotel_room_types'), ('hotel_settings'), ('restaurant_service_periods'), ('restaurant_settings'),
  ('shop_products'), ('shop_variants'), ('shop_settings'), ('job_services'), ('appointment_services'), ('appointment_resources'),
  ('appointment_resource_services'), ('appointment_hours'), ('appointment_settings');
CREATE TEMP TABLE rh_members AS
  SELECT m.user_id, m.role, o.slug, array_agg(m.organization_id) OVER (PARTITION BY m.user_id) AS orgs
    FROM public.organization_members m JOIN public.organizations o ON o.id = m.organization_id
   WHERE m.user_id IN (SELECT tests.rh_user(n) FROM generate_series(1, 30) n);
CREATE TEMP TABLE rh_seen (tbl text, who text, n bigint);
GRANT SELECT ON rh_public, rh_members TO authenticated, anon;
GRANT ALL ON rh_seen TO authenticated, anon;
DO $$
DECLARE u record; t record;
BEGIN
  FOR u IN SELECT DISTINCT user_id, orgs, string_agg(slug || ':' || role, ',') OVER (PARTITION BY user_id) AS who FROM rh_members LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    FOR t IN SELECT DISTINCT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
              WHERE ns.nspname = 'public' AND c.relkind = 'r' AND a.attname IN ('organization_id', 'issuer_org') AND NOT a.attisdropped LOOP
      INSERT INTO rh_seen VALUES (t.relname, u.who, tests.rh_foreign(t.relname, u.orgs));
    END LOOP;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  FOR t IN SELECT DISTINCT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
            WHERE ns.nspname = 'public' AND c.relkind = 'r' AND a.attname IN ('organization_id', 'issuer_org') AND NOT a.attisdropped LOOP
    INSERT INTO rh_seen VALUES (t.relname, 'anon', tests.rh_foreign(t.relname, '{}'));
  END LOOP;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tbl, bool_or(coalesce(n, 0) > 0) AS leaks, sum(coalesce(n, 0)) AS rows,
                  count(DISTINCT who) FILTER (WHERE who <> 'anon') AS members
             FROM rh_seen GROUP BY tbl ORDER BY tbl LOOP
    IF t.leaks AND NOT EXISTS (SELECT 1 FROM rh_public WHERE tbl = t.tbl) THEN
      RAISE EXCEPTION 'FAIL: %: another company''s rows are visible to %', t.tbl,
        (SELECT string_agg(who || ' (' || n || ')', ', ') FROM rh_seen WHERE tbl = t.tbl AND n > 0);
    END IF;
    RAISE NOTICE 'ok - %: %', t.tbl, CASE WHEN t.leaks THEN 'public booking page or catalogue only'
                                         ELSE format('no row of another company, for %s members in every role and visitors', t.members) END;
  END LOOP;
END $$;
SELECT tests.ok((SELECT count(DISTINCT role) FROM rh_members) = 6 AND (SELECT count(DISTINCT slug) FROM rh_members) = 7,
  'checked for members in all six roles of seven companies');

-- ── Within a company, by role ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tests.rh_sees(p_user int, p_table text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tests.rh_user(p_user), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  n := tests.rh_count(p_table);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION tests.rh_sees(int, text) TO authenticated;
SELECT tests.ok(tests.rh_sees(1, 'api_keys') = 2 AND tests.rh_sees(4, 'api_keys') = 0 AND tests.rh_sees(3, 'api_keys') = 0
                AND tests.rh_sees(5, 'api_keys') = 0 AND tests.rh_sees(2, 'api_keys') = 0 AND tests.rh_sees(18, 'api_keys') = 1,
  'API keys: owners and admins of their own company only (A''s former admin, now a viewer, none)');
SELECT tests.ok(tests.rh_sees(1, 'company_booking_approvals') = 3 AND tests.rh_sees(4, 'company_booking_approvals') = 3
                AND tests.rh_sees(3, 'company_booking_approvals') = 3 AND tests.rh_sees(5, 'company_booking_approvals') = 0
                AND tests.rh_sees(19, 'company_booking_approvals') = 0,
  'approval requests: owner and finance all, the booker their own, a viewer none, another company none');
SELECT tests.ok(tests.rh_sees(6, 'bank_imports') = 1 AND tests.rh_sees(7, 'bank_imports') = 1 AND tests.rh_sees(8, 'bank_imports') = 1
                AND tests.rh_sees(9, 'bank_imports') = 0 AND tests.rh_sees(10, 'bank_imports') = 0 AND tests.rh_sees(11, 'bank_imports') = 0
                AND tests.rh_sees(1, 'bank_imports') = 0 AND tests.rh_sees(18, 'bank_imports') = 0
                AND tests.rh_sees(8, 'bank_import_rows') = 2 AND tests.rh_sees(9, 'bank_import_rows') = 0,
  'bank imports: the company''s owner, admin and finance see its own; booker, viewer and staff none; FlyttGo''s file no company');
SELECT tests.ok(tests.rh_sees(6, 'invoices') = 8 AND tests.rh_sees(8, 'invoices') = 8 AND tests.rh_sees(9, 'invoices') = 0
                AND tests.rh_sees(10, 'invoices') = 0 AND tests.rh_sees(11, 'invoices') = 0
                AND tests.rh_sees(1, 'invoices') = 4 AND tests.rh_sees(4, 'invoices') = 4 AND tests.rh_sees(3, 'invoices') = 0,
  'invoices of both series: the issuing company''s (B) or the buying company''s (A, from FlyttGo) owners, admins and finance; nobody else in them');
SELECT tests.ok(tests.rh_sees(24, 'restaurant_reservations') = 5 AND tests.rh_sees(25, 'hotel_stays') = 4 AND tests.rh_sees(26, 'shop_orders') = 5
                AND tests.rh_sees(13, 'appointments') = 1 AND tests.rh_sees(24, 'hotel_stays') = 0 AND tests.rh_sees(26, 'invoices') = 0,
  'staff see their own company''s floor, desk, warehouse or calendar, not its invoices');
SELECT tests.ok(tests.rh_sees(28, 'shop_orders') = 5 AND tests.rh_sees(29, 'shop_orders') = 1 AND tests.rh_sees(23, 'hotel_stays') = 4
                AND tests.rh_sees(21, 'restaurant_reservations') = 2 AND tests.rh_sees(20, 'bookings') = 8 AND tests.rh_sees(27, 'restaurant_reservations') = 0
                AND tests.rh_sees(28, 'invoices') = 5 AND tests.rh_sees(20, 'invoices') = 0,
  'customers see their own orders, stays, reservations, moves and receipts, and nobody else''s');
SELECT tests.ok(tests.rh_sees(15, 'organization_addons') = 0 AND tests.rh_sees(12, 'organization_addons') = 1 AND tests.rh_sees(6, 'organization_addons') = 1,
  'add-ons: each company its own (an ended one included)');

-- ── Payment idempotency: a webhook delivered again records once ──────────
DO $$
DECLARE v_inv uuid := tests.rh_id('inv_C_1'); v_order uuid := tests.rh_id('order_open'); v_move uuid := tests.rh_id('move_P_pending');
        v_total numeric; v_order_total numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT total INTO v_total FROM public.invoices WHERE id = v_inv;
  SELECT total INTO v_order_total FROM public.shop_orders WHERE id = v_order;
  PERFORM tests.ok(tests.rh_webhook('evt_rh_w1', 'sales_invoice', v_inv, v_total, 'acct_1RhSalong', 'pi_rh_w1') = 'recorded'
                   AND tests.rh_webhook('evt_rh_w1', 'sales_invoice', v_inv, v_total, 'acct_1RhSalong', 'pi_rh_w1') = 'duplicate'
                   AND tests.rh_webhook('evt_rh_w2', 'sales_invoice', v_inv, v_total, 'acct_1RhSalong', 'pi_rh_w1') = 'idempotent',
    'an invoice paid by card: the same event again is a duplicate, another event for the same payment changes nothing');
  PERFORM tests.ok((SELECT count(*) FROM public.invoice_payments WHERE invoice_id = v_inv) = 1
                   AND (SELECT status FROM public.invoices WHERE id = v_inv) = 'paid', 'the payment is recorded once');
  PERFORM tests.ok(tests.rh_webhook('evt_rh_w3', 'shop_order', v_order, v_order_total, 'acct_1RhButikk', 'pi_rh_w3') = 'recorded'
                   AND tests.rh_webhook('evt_rh_w3', 'shop_order', v_order, v_order_total, 'acct_1RhButikk', 'pi_rh_w3') = 'duplicate'
                   AND tests.rh_webhook('evt_rh_w4', 'shop_order', v_order, v_order_total, 'acct_1RhButikk', 'pi_rh_w3') = 'already recorded',
    'a shop order: the same delivery again, or another event for it, records nothing more');
  PERFORM tests.ok((SELECT count(*) FROM public.invoice_payments p JOIN public.shop_orders o ON o.invoice_id = p.invoice_id WHERE o.id = v_order) = 1
                   AND (SELECT status FROM public.shop_orders WHERE id = v_order) = 'paid', 'one receipt, paid once');
  PERFORM tests.ok(tests.rh_webhook('evt_rh_w5', 'booking', v_move, 2100, NULL, 'pi_rh_w5') = 'paid'
                   AND tests.rh_webhook('evt_rh_w5', 'booking', v_move, 2100, NULL, 'pi_rh_w5') = 'duplicate'
                   AND tests.rh_webhook('evt_rh_w6', 'booking', v_move, 2100, NULL, 'pi_rh_w5') = 'idempotent',
    'a move paid by card: marked paid once');
  PERFORM tests.ok((SELECT count(*) FROM public.payment_events WHERE event_id LIKE 'evt_rh_w%') = 6, 'each event is logged once');
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
-- Two deliveries at once both past the duplicate check: the database still records once.
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT tests.throws($$SELECT public.record_invoice_payment(tests.rh_id('inv_B_2'), 1, current_date, 'card', 'pi_rh_w1')$$, '23505',
  'the same card payment recorded again, on an invoice that still owes, is refused by its provider reference');
SELECT tests.throws($$SELECT public.record_invoice_payment(tests.rh_id('inv_B_2'), 400, current_date, 'bank', 'rh-bank-b-2')$$, '23505',
  'and so is a bank payment delivered twice');
SELECT tests.throws($$INSERT INTO public.payment_events (provider, event_id, kind) VALUES ('stripe', 'evt_rh_w1', 'checkout.session.completed')$$, '23505',
  'an event is logged once');
SELECT tests.ok(public.record_shop_payment(tests.rh_id('order_paid'), (SELECT total FROM public.shop_orders WHERE id = tests.rh_id('order_paid')),
                                           'acct_1RhButikk', 'pi_rh_shop_paid', 'cs_rh_shop_paid') = 'already recorded',
  'a shop payment recorded again is already recorded');
SELECT public.shop_refund_mark((SELECT id FROM public.shop_refunds WHERE provider_refund_id = 're_rh_shop_1'), 'succeeded', 're_rh_shop_1', NULL);
SELECT tests.ok((SELECT count(*) FROM public.invoices WHERE kind = 'credit_note' AND source_type = 'shop_order') = 2
                AND (SELECT refunded_amount = total FROM public.shop_orders WHERE id = tests.rh_id('order_refunded')),
  'a refund''s success delivered again makes no second credit note');
ROLLBACK;

-- ── Financial records cannot be changed or deleted, by anyone ─────────────
BEGIN;
SELECT set_config('request.jwt.claims', '', true);
SELECT tests.throws($$UPDATE public.invoices SET total = total + 1 WHERE id = tests.rh_id('inv_F_paid')$$, '42501',
  'an issued invoice of FlyttGo''s series cannot be changed, also by the database owner');
SELECT tests.throws($$UPDATE public.invoices SET notes = 'x' WHERE id = tests.rh_id('inv_B_1')$$, '42501',
  'nor one of a company''s own series');
SELECT tests.throws($$DELETE FROM public.invoices WHERE id = tests.rh_id('inv_B_2')$$, '42501', 'an issued invoice is never deleted');
SELECT tests.throws($$UPDATE public.invoices SET total = 0 WHERE kind = 'credit_note' AND issuer_org = tests.rh_id('org_B')$$, '42501',
  'nor a credit note changed');
SELECT tests.throws($$DELETE FROM public.invoice_lines WHERE invoice_id = tests.rh_id('inv_E_stay')$$, '42501', 'nor an issued invoice''s lines');
SELECT tests.throws($$UPDATE public.invoice_payments SET amount = 0$$, '42501', 'payments are append-only');
SELECT tests.throws($$DELETE FROM public.invoice_payments$$, '42501', 'and never deleted');
SELECT tests.throws($$DELETE FROM public.invoice_events$$, '42501', 'nor the invoice log');
SELECT tests.throws($$UPDATE public.bank_imports SET matched = 0$$, '42501', 'a bank import is kept as imported');
SELECT tests.throws($$DELETE FROM public.bank_imports$$, '42501', 'and never deleted');
SELECT tests.throws($$UPDATE public.bank_import_rows SET amount = 1$$, '42501', 'nor its rows changed');
SELECT tests.throws($$DELETE FROM public.bank_import_rows$$, '42501', 'or deleted');
SET LOCAL ROLE authenticated;
SELECT tests.login(tests.rh_id('owner_B'));
SELECT tests.throws($$UPDATE public.invoices SET status = 'draft' WHERE issuer_org = tests.rh_id('org_B')$$, '42501',
  'a company''s owner cannot change its invoices directly');
SELECT tests.throws($$DELETE FROM public.bank_import_rows$$, '42501', 'nor its bank imports');
ROLLBACK;

\echo 'release rehearsal checks: all passed'
