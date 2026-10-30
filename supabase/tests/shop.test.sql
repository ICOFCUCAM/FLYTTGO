-- ============================================================================
-- Online shops (supabase/migrations/00020_shop.sql)
-- Acme is a shop on the plan Online shop (tests.sh_acme); cust1 owns it,
-- drv1 is its booker, e…01 works in it (staff). cust2 is a customer; drv2
-- another customer, and the owner of another company where named.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''
\set drv2    '''d0000000-0000-0000-0000-000000000002'''
\set worker  '''e0000000-0000-0000-0000-000000000001'''

-- Acme on Online shop, registered for MVA, its Stripe account connected,
-- invoice settings filled in; pickup in the shop or shipping at 99 kr (free
-- from 1000 kr). Products: Mug 199 kr (2 in stock), T-shirt by size (S 249
-- kr, 1 left; M 279 kr, 5), Coffee 129 kr at 15 % (stock not counted), and
-- an inactive Old mug. Claims kept.
CREATE OR REPLACE FUNCTION tests.sh_acme() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid; v_shirt uuid; v_claims text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM tests.seller();
  v_org := tests.acme();
  PERFORM tests.activate(v_org);
  UPDATE public.organizations SET vat_registered = true WHERE id = v_org;
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (v_org, 'e0000000-0000-0000-0000-000000000001', 'staff');
  PERFORM tests.login('c0000000-0000-0000-0000-000000000001');
  PERFORM public.set_organization_industry(v_org, 'retail');
  PERFORM public.request_white_label(v_org, 'shop');
  PERFORM public.set_white_label_brand(v_org, 'Acme Butikk', '#0055aa', '#ffcc00', NULL,
    'post@acme.no', '+47 22 33 44 55', 'https://acme.no/vilkar', 'https://acme.no/personvern', 0);
  PERFORM public.accept_white_label_dpa(v_org, '2026-10-draft');
  PERFORM tests.as_server();
  PERFORM public.set_white_label_stripe_account(v_org, 'acct_1Acme', true);
  PERFORM tests.login('a0000000-0000-0000-0000-000000000001');
  PERFORM public.admin_decide_white_label(v_org, true, NULL);
  PERFORM tests.login('c0000000-0000-0000-0000-000000000001');
  PERFORM public.set_invoice_settings(v_org, '{"legal_name":"Acme Butikk AS","address":"Torget 1","postcode_city":"0150 Oslo","bank_account":"15061234567"}');
  PERFORM public.save_shop_settings(v_org, '{"pickup_enabled":true,"pickup_address":"Torget 1, 0150 Oslo","shipping_enabled":true,"shipping_price":99,"free_shipping_over":1000}');
  PERFORM public.save_shop_product(v_org, NULL, '{"name":"Mug","price":199,"sku":"MUG-1","track_stock":true,"stock":2,"sort":1}');
  SELECT id INTO v_shirt FROM public.save_shop_product(v_org, NULL, '{"name":"T-shirt","price":249,"variant_label":"Size","track_stock":true,"sort":2}');
  PERFORM public.save_shop_variant(v_shirt, NULL, '{"name":"S","stock":1}');
  PERFORM public.save_shop_variant(v_shirt, NULL, '{"name":"M","price":279,"stock":5}');
  PERFORM public.save_shop_product(v_org, NULL, '{"name":"Coffee","price":129,"vat_rate":15,"sort":3}');
  PERFORM public.save_shop_product(v_org, NULL, '{"name":"Old mug","price":99,"active":false}');
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN v_org;
END $$;
CREATE OR REPLACE FUNCTION tests.sh_product(p_name text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.shop_products WHERE name = p_name; $$;
CREATE OR REPLACE FUNCTION tests.sh_variant(p_name text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.shop_variants WHERE name = p_name; $$;
CREATE OR REPLACE FUNCTION tests.sh_stock(p_product text, p_variant text DEFAULT NULL) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE WHEN p_variant IS NULL THEN (SELECT stock FROM public.shop_products WHERE name = p_product)
              ELSE (SELECT stock FROM public.shop_variants WHERE name = p_variant) END; $$;
CREATE OR REPLACE FUNCTION tests.sh_item(p_product text, p_qty int, p_variant text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object('product_id', tests.sh_product(p_product), 'variant_id', tests.sh_variant(p_variant), 'quantity', p_qty); $$;
CREATE OR REPLACE FUNCTION tests.sh_contact() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"name":"Kari Nordmann","phone":"+47 900 00 000","email":"kari@example.no"}'::jsonb; $$;
CREATE OR REPLACE FUNCTION tests.sh_address() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"address":"Storgata 5","postcode":"0155","city":"Oslo"}'::jsonb; $$;
-- An order, as the database owner: moved past its time.
CREATE OR REPLACE FUNCTION tests.sh_overdue(p_order uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.shop_orders SET expires_at = now() - interval '1 minute' WHERE id = p_order; $$;
CREATE OR REPLACE FUNCTION tests.sh_order(p_order uuid) RETURNS public.shop_orders LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT * FROM public.shop_orders WHERE id = p_order; $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── The plan, the catalogue, the module ────────────────────────────────────
BEGIN;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT modules FROM public.white_label_plans WHERE code = 'shop') = ARRAY['shop', 'sales_invoicing']
                AND (SELECT seller_model FROM public.white_label_plans WHERE code = 'shop') = 'company'
                AND (SELECT price_status FROM public.white_label_plans WHERE code = 'shop') = 'pilot'
                AND (SELECT requires_stripe FROM public.white_label_plans WHERE code = 'shop'),
  'the plan Online shop: the company sells, card payments on its own Stripe account, a pilot price (00022)');
RESET ROLE;
SELECT tests.throws($$UPDATE public.white_label_plans SET modules = ARRAY['shop'] WHERE code = 'branded'$$, '23514',
  'a plan where FlyttGo sells cannot carry the shop');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.sh_acme() AS id;
GRANT SELECT ON o TO anon, service_role;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT count(*) FROM public.shop_products) = 3 AND (SELECT count(*) FROM public.shop_variants) = 2
                AND (SELECT count(*) FROM public.shop_settings) = 1,
  'visitors browse the active products, their variants and the delivery options without signing in');
SELECT tests.ok((public.shop_quote((SELECT id FROM o), jsonb_build_array(tests.sh_item('Mug', 2), tests.sh_item('T-shirt', 1, 'M')), 'shipping') ->> 'total')::numeric = 776,
  'and see the total incl. MVA and delivery: 2 × 199 + 279 + 99');
SELECT tests.ok((public.shop_quote((SELECT id FROM o), jsonb_build_array(tests.sh_item('Coffee', 8)), 'shipping') ->> 'delivery_price')::numeric = 0,
  'shipping is free from 1000 kr');
SELECT tests.throws($$SELECT public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('Mug', 1)), 'pickup', NULL, tests.sh_contact())$$,
  '42501', 'visitors sign in to order');
SELECT tests.throws($$SELECT * FROM public.shop_orders$$, '42501', 'and see no orders');
SET LOCAL ROLE authenticated;
SELECT tests.login(:worker);
SELECT tests.throws($$SELECT public.save_shop_product((SELECT id FROM o), NULL, '{"name":"X","price":10}')$$, '42501',
  'staff do not change the catalogue');
SELECT public.set_shop_stock(tests.sh_product('Mug'), NULL, 3);
SELECT tests.ok(tests.sh_stock('Mug') = 3, 'but count the stock');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.set_shop_stock(tests.sh_product('Mug'), NULL, 9)$$, '42501',
  'FlyttGo administrators do not change a company''s stock');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.save_shop_product((SELECT id FROM o), NULL, '{"name":"X","price":10,"images":["a0000000-0000-0000-0000-000000000001/x.png"]}')$$,
  '42501', 'product pictures come from the company''s own folder');
SELECT tests.throws($$SELECT public.save_shop_settings((SELECT id FROM o), '{"pickup_enabled":false,"shipping_enabled":false}')$$, '23514',
  'a shop offers pickup or shipping');
RESET ROLE;
UPDATE public.organizations SET vat_registered = false WHERE id = (SELECT id FROM o);
SET LOCAL ROLE authenticated;
SELECT tests.throws($$SELECT public.save_shop_product((SELECT id FROM o), NULL, '{"name":"Tea","price":50,"vat_rate":15}')$$, '22023',
  'a company not registered for MVA charges none');
SELECT tests.ok((SELECT vat_rate FROM public.save_shop_product((SELECT id FROM o), NULL, '{"name":"Tea","price":50,"vat_rate":0}')) = 0, 'rate 0 is fine');
SELECT tests.login(:admin);
SELECT public.admin_set_white_label_status((SELECT id FROM o), 'suspended', 'test');
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT count(*) FROM public.shop_products) = 0, 'a suspended plan closes the shop to visitors');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('Mug', 1)), 'pickup', NULL, tests.sh_contact())$$,
  '55000', 'and takes no orders');
ROLLBACK;

-- ── Orders hold stock; it never goes below zero; unpaid orders expire ──────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.sh_acme() AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.place_shop_order((SELECT id FROM o),
  jsonb_build_array(tests.sh_item('Mug', 1), tests.sh_item('T-shirt', 1, 'M'), tests.sh_item('Mug', 1)), 'shipping', tests.sh_address(), tests.sh_contact());
GRANT SELECT ON o, a TO anon, service_role;
SELECT tests.ok((SELECT status FROM a) = 'awaiting_payment' AND (SELECT total FROM a) = 776 AND (SELECT number FROM a) = 1
                AND (SELECT count(*) FROM public.shop_order_lines WHERE order_id = (SELECT id FROM a)) = 2,
  'the customer orders: prices from the catalogue, the same product on one line, total 776');
SELECT tests.ok(tests.sh_stock('Mug') = 0 AND tests.sh_stock('T-shirt', 'M') = 4, 'the stock is taken at once');
SELECT tests.login(:drv2);
SELECT tests.throws($$SELECT public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('Mug', 1)), 'pickup', NULL, tests.sh_contact())$$,
  '55000', 'a competing order for the last mug is refused');
SELECT tests.throws($$SELECT public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('T-shirt', 2, 'S')), 'pickup', NULL, tests.sh_contact())$$,
  '55000', 'as is more than is left of a size');
SELECT tests.throws($$SELECT public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('T-shirt', 1)), 'pickup', NULL, tests.sh_contact())$$,
  '22023', 'a product with sizes is ordered in one of them');
SELECT tests.throws($$SELECT public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('Old mug', 1)), 'pickup', NULL, tests.sh_contact())$$,
  '55000', 'an inactive product cannot be ordered');
SELECT tests.throws($$SELECT public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('Coffee', 1)), 'shipping', '{"address":"x"}', tests.sh_contact())$$,
  '22023', 'shipping needs the address');
SELECT tests.throws($$SELECT public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('Coffee', 1000)), 'pickup', NULL, tests.sh_contact())$$,
  '22023', 'at most 999 of one item');
SELECT tests.ok(tests.sh_stock('Mug') = 0 AND tests.sh_stock('T-shirt', 'S') = 1, 'refused orders take nothing');
RESET ROLE;
SELECT tests.throws($$UPDATE public.shop_products SET stock = stock - 1 WHERE name = 'Mug'$$, '23514',
  'the stock cannot go below zero, however it is written');
SET LOCAL ROLE authenticated;
-- Not paid in time: the scheduled job cancels it and the stock comes back.
SELECT tests.sh_overdue((SELECT id FROM a));
SELECT tests.throws($$SELECT public.expire_shop_orders()$$, '42501', 'only the server expires orders');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok(public.expire_shop_orders() = 1, 'the server expires the unpaid order');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT status = 'cancelled' AND cancelled_by = 'expired' FROM public.shop_orders WHERE id = (SELECT id FROM a))
                AND tests.sh_stock('Mug') = 2 AND tests.sh_stock('T-shirt', 'M') = 5,
  'it is cancelled and its stock is back');
SELECT tests.throws($$SELECT public.shop_checkout_begin((SELECT id FROM a))$$, '55000', 'and it can no longer be paid');
-- Without the job: opening the payment late, or the next order, expires
-- what holds the stock first.
CREATE TEMP TABLE b0 ON COMMIT DROP AS SELECT * FROM public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('Coffee', 1)), 'pickup', NULL, tests.sh_contact());
SELECT tests.sh_overdue((SELECT id FROM b0));
SELECT tests.ok((SELECT status FROM public.shop_checkout_begin((SELECT id FROM b0))) = 'cancelled', 'a payment opened too late finds the order cancelled');
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT * FROM public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('Mug', 2)), 'pickup', NULL, tests.sh_contact());
SELECT tests.sh_overdue((SELECT id FROM b));
SELECT tests.login(:drv2);
SELECT tests.ok((SELECT status FROM public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('Mug', 1)), 'pickup', NULL, tests.sh_contact())) = 'awaiting_payment',
  'a new order takes the stock of an order that was not paid in time');
SELECT tests.ok((tests.sh_order((SELECT id FROM b))).status = 'cancelled' AND tests.sh_stock('Mug') = 1, 'which is cancelled');
SELECT tests.login(:cust2);
CREATE TEMP TABLE c ON COMMIT DROP AS SELECT * FROM public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('T-shirt', 1, 'S')), 'pickup', NULL, tests.sh_contact());
SELECT tests.ok(tests.sh_stock('T-shirt', 'S') = 0 AND (SELECT cancelled_by FROM public.cancel_shop_order((SELECT id FROM c), 'changed my mind')) = 'customer',
  'the customer cancels an unpaid order');
SELECT tests.ok(tests.sh_stock('T-shirt', 'S') = 1, 'and the size is back');
SELECT tests.throws($$SELECT public.cancel_shop_order((SELECT id FROM c), NULL)$$, '55000', 'once');
ROLLBACK;

-- ── Payment: once, on the shop's account, for the exact total; the receipt ─
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.sh_acme() AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.place_shop_order((SELECT id FROM o),
  jsonb_build_array(tests.sh_item('Mug', 2), tests.sh_item('T-shirt', 1, 'M'), tests.sh_item('Coffee', 1)), 'shipping', tests.sh_address(), tests.sh_contact());
GRANT SELECT ON o, a TO service_role;
SELECT tests.ok((SELECT checkout_count FROM public.shop_checkout_begin((SELECT id FROM a))) = 1, 'the customer opens the card payment');
SELECT tests.login(:drv2);
SELECT tests.throws($$SELECT public.shop_checkout_begin((SELECT id FROM a))$$, 'P0002', 'nobody else can');
SELECT tests.throws($$SELECT public.record_shop_payment((SELECT id FROM a), 905, 'acct_1Acme', 'pi_1', 'cs_1')$$, '42501',
  'only the server records a payment');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok(public.record_shop_payment((SELECT id FROM a), 905, 'acct_1Other', 'pi_x', 'cs_x') = 'held for review'
                AND public.record_shop_payment((SELECT id FROM a), 900, 'acct_1Acme', 'pi_y', 'cs_y') = 'held for review'
                AND public.record_shop_payment((SELECT id FROM a), 905, NULL, 'pi_z', 'cs_z') = 'held for review',
  'a payment on another account, for another amount or to FlyttGo is not recorded');
SELECT tests.ok((tests.sh_order((SELECT id FROM a))).status = 'awaiting_payment' AND (tests.sh_order((SELECT id FROM a))).payment_review LIKE '%pi_x%',
  'the order stays unpaid and the company is told');
SELECT tests.ok(public.record_shop_payment((SELECT id FROM a), 905, 'acct_1Acme', 'pi_1', 'cs_1') = 'recorded', 'the right payment is recorded');
SELECT tests.ok(public.record_shop_payment((SELECT id FROM a), 905, 'acct_1Acme', 'pi_1', 'cs_1') = 'already recorded', 'once');
SELECT tests.ok(public.record_shop_payment((SELECT id FROM a), 905, 'acct_1Acme', 'pi_2', 'cs_2') = 'held for review',
  'a second payment for a paid order is held for a refund, never recorded');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
CREATE TEMP TABLE inv ON COMMIT DROP AS SELECT i.* FROM public.invoices i JOIN public.shop_orders s ON s.invoice_id = i.id WHERE s.id = (SELECT id FROM a);
SELECT tests.ok((SELECT status FROM public.shop_orders WHERE id = (SELECT id FROM a)) = 'paid' AND (SELECT paid_amount FROM public.shop_orders WHERE id = (SELECT id FROM a)) = 905,
  'the order is paid');
SELECT tests.ok((SELECT total FROM inv) = 905 AND (SELECT status FROM inv) = 'paid' AND (SELECT seller ->> 'name' FROM inv) = 'Acme Butikk AS'
                AND (SELECT source_type FROM inv) = 'shop_order' AND (SELECT customer_user_id FROM inv) = :cust2
                AND (SELECT count(*) FROM public.invoice_payments WHERE invoice_id = (SELECT id FROM inv)) = 1,
  'a receipt in the company''s name for exactly what was paid, paid by the one card payment');
SELECT tests.ok((SELECT vat_total FROM inv) = round(398 - 398 / 1.25, 2) + round(279 - 279 / 1.25, 2) + round(129 - 129 / 1.15, 2) + round(99 - 99 / 1.25, 2)
                AND (SELECT count(DISTINCT vat_rate) FROM public.invoice_lines WHERE invoice_id = (SELECT id FROM inv)) = 2
                AND (SELECT count(*) FROM public.invoice_lines WHERE invoice_id = (SELECT id FROM inv) AND description = 'Delivery') = 1,
  'with the MVA of each line at its own rate, and the delivery');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT count(*) FROM public.invoices WHERE id = (SELECT id FROM inv)) = 1, 'the customer reads the receipt');
-- Paid after it had expired: the goods are taken again while there.
SELECT tests.login(:drv2);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT * FROM public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('T-shirt', 1, 'S')), 'pickup', NULL, tests.sh_contact());
GRANT SELECT ON b TO service_role;
SELECT tests.sh_overdue((SELECT id FROM b));
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT public.expire_shop_orders();
SELECT tests.ok(public.record_shop_payment((SELECT id FROM b), 249, 'acct_1Acme', 'pi_late', 'cs_late') = 'recorded',
  'a payment that arrives after the order expired is recorded');
SELECT tests.ok((tests.sh_order((SELECT id FROM b))).status = 'paid' AND (tests.sh_order((SELECT id FROM b))).payment_review IS NULL
                AND tests.sh_stock('T-shirt', 'S') = 0,
  'and takes the goods again while they are in stock');
ROLLBACK;

-- ── Packing and delivery; the right of withdrawal; refunds ─────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.sh_acme() AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.place_shop_order((SELECT id FROM o),
  jsonb_build_array(tests.sh_item('Mug', 2), tests.sh_item('T-shirt', 1, 'M')), 'shipping', tests.sh_address(), tests.sh_contact());
GRANT SELECT ON o, a TO service_role;
SELECT tests.throws($$SELECT public.request_shop_withdrawal((SELECT id FROM a), NULL, NULL)$$, '55000', 'an unpaid order is cancelled, not withdrawn from');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT public.record_shop_payment((SELECT id FROM a), 776, 'acct_1Acme', 'pi_1', 'cs_1');
SET LOCAL ROLE authenticated;
SELECT tests.login(:worker);
SELECT tests.throws($$SELECT public.set_shop_order_status((SELECT id FROM a), 'ready_for_pickup', NULL)$$, '55000', 'a shipped order is not picked up');
SELECT tests.ok((SELECT status FROM public.set_shop_order_status((SELECT id FROM a), 'packed', NULL)) = 'packed', 'staff pack it');
SELECT tests.ok((SELECT tracking FROM public.set_shop_order_status((SELECT id FROM a), 'shipped', 'Posten 370000000000')) = 'Posten 370000000000',
  'and ship it with the tracking reference');
SELECT tests.ok((SELECT delivered_at FROM public.set_shop_order_status((SELECT id FROM a), 'delivered', NULL)) IS NOT NULL,
  'delivered: the 14 days start');
SELECT tests.throws($$SELECT public.set_shop_order_status((SELECT id FROM a), 'packed', NULL)$$, '55000', 'statuses only move forward');
SELECT tests.login(:drv2);
SELECT tests.throws($$SELECT public.request_shop_withdrawal((SELECT id FROM a), NULL, NULL)$$, 'P0002', 'only the customer withdraws');
SELECT tests.login(:cust2);
CREATE TEMP TABLE w ON COMMIT DROP AS SELECT * FROM public.request_shop_withdrawal((SELECT id FROM a), NULL, 'Jeg angrer kjøpet');
GRANT SELECT ON w TO service_role;
SELECT tests.ok((SELECT within_period FROM w) AND (SELECT status FROM w) = 'requested' AND jsonb_array_length((SELECT lines FROM w)) = 2,
  'the customer''s withdrawal is recorded, within 14 days, for everything on the order');
SELECT tests.throws($$SELECT public.request_shop_withdrawal((SELECT id FROM a), NULL, NULL)$$, '55000', 'one at a time');
SELECT tests.login(:worker);
SELECT tests.ok((SELECT status FROM public.handle_shop_withdrawal((SELECT id FROM w), 'received', 'all back')) = 'received', 'the goods come back');
SELECT tests.ok((SELECT status FROM public.shop_orders WHERE id = (SELECT id FROM a)) = 'returned', 'the order is returned');
SELECT tests.throws($$SELECT public.shop_refund_begin((SELECT id FROM a), NULL, true, true, 'withdrawal', (SELECT id FROM w))$$, '42501',
  'staff do not refund');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.shop_refund_begin((SELECT id FROM a), NULL, true, true, 'withdrawal', (SELECT id FROM w))$$, '42501',
  'nor do bookers');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.shop_refund_begin((SELECT id FROM a), NULL, true, true, 'withdrawal', (SELECT id FROM w))$$, '42501',
  'nor FlyttGo''s administrators');
SELECT tests.login(:cust1);
CREATE TEMP TABLE r ON COMMIT DROP AS SELECT * FROM public.shop_refund_begin((SELECT id FROM a), NULL, true, true, 'withdrawal', (SELECT id FROM w));
GRANT SELECT ON r TO service_role;
SELECT tests.ok((SELECT amount FROM r) = 776 AND (SELECT idempotency_key FROM r) = 'flyttgo-shop-refund-' || (SELECT id FROM r)::text,
  'the owner refunds everything with the delivery: 776, with an idempotency key');
SELECT tests.ok((SELECT id FROM public.shop_refund_begin((SELECT id FROM a), NULL, true, true, 'again', NULL)) = (SELECT id FROM r),
  'asking again while it is live returns the same refund (the same key)');
SELECT tests.throws($$SELECT public.shop_refund_mark((SELECT id FROM r), 'succeeded', 're_1', NULL)$$, '42501', 'only the server records Stripe''s answer');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT public.shop_refund_mark((SELECT id FROM r), 'pending', 're_1', NULL);
SELECT public.shop_refund_mark((SELECT id FROM r), 'succeeded', 're_1', NULL);
SELECT public.shop_refund_mark((SELECT id FROM r), 'succeeded', 're_1', NULL);
SELECT public.shop_refund_mark((SELECT id FROM r), 'failed', 're_1', 'late');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT status FROM public.shop_orders WHERE id = (SELECT id FROM a)) = 'refunded'
                AND (SELECT refunded_amount FROM public.shop_orders WHERE id = (SELECT id FROM a)) = 776
                AND (SELECT status FROM public.shop_refunds WHERE id = (SELECT id FROM r)) = 'succeeded'
                AND (SELECT status FROM public.shop_withdrawals WHERE id = (SELECT id FROM w)) = 'refunded',
  'Stripe''s success is applied once: the order and the withdrawal are refunded; a later answer changes nothing');
SELECT tests.ok(tests.sh_stock('Mug') = 2 AND tests.sh_stock('T-shirt', 'M') = 5, 'the goods are back in stock, once');
SELECT tests.ok((SELECT i.total FROM public.invoices i JOIN public.shop_refunds f ON f.credit_note_id = i.id WHERE f.id = (SELECT id FROM r)) = -776
                AND (SELECT i.kind FROM public.invoices i JOIN public.shop_refunds f ON f.credit_note_id = i.id WHERE f.id = (SELECT id FROM r)) = 'credit_note'
                AND (SELECT amount_credited FROM public.invoices WHERE id = (SELECT invoice_id FROM public.shop_orders WHERE id = (SELECT id FROM a))) = 776,
  'a credit note in the company''s name credits the receipt');
SELECT tests.throws($$SELECT public.shop_refund_begin((SELECT id FROM a), NULL, true, false, 'more', NULL)$$, '22023', 'nothing more can be refunded');
ROLLBACK;

-- ── A part refund, a failed refund, the 14 days ────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.sh_acme() AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.place_shop_order((SELECT id FROM o),
  jsonb_build_array(tests.sh_item('Mug', 2), tests.sh_item('Coffee', 1)), 'pickup', NULL, tests.sh_contact());
GRANT SELECT ON o, a TO service_role;
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT public.record_shop_payment((SELECT id FROM a), 527, 'acct_1Acme', 'pi_1', 'cs_1');
SET LOCAL ROLE authenticated;
SELECT tests.login(:worker);
SELECT public.set_shop_order_status((SELECT id FROM a), 'ready_for_pickup', NULL);
SELECT public.set_shop_order_status((SELECT id FROM a), 'collected', NULL);
RESET ROLE;
UPDATE public.shop_orders SET delivered_at = now() - interval '20 days' WHERE id = (SELECT id FROM a);
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT within_period FROM public.request_shop_withdrawal((SELECT id FROM a),
                   jsonb_build_array(jsonb_build_object('line_id', (SELECT id FROM public.shop_order_lines WHERE order_id = (SELECT id FROM a) AND name = 'Mug'), 'quantity', 1)),
                   NULL)) = false,
  'a withdrawal 20 days after collection is recorded, marked outside the 14 days, for the company to decide');
SELECT tests.login(:cust1);
CREATE TEMP TABLE r ON COMMIT DROP AS SELECT * FROM public.shop_refund_begin((SELECT id FROM a),
  jsonb_build_array(jsonb_build_object('line_id', (SELECT id FROM public.shop_order_lines WHERE order_id = (SELECT id FROM a) AND name = 'Mug'), 'quantity', 1)),
  false, false, 'goodwill', NULL);
GRANT SELECT ON r TO service_role;
SELECT tests.ok((SELECT amount FROM r) = 199, 'a part refund of one mug: 199');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT public.shop_refund_mark((SELECT id FROM r), 'failed', NULL, 'card expired');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT refunded_amount FROM public.shop_orders WHERE id = (SELECT id FROM a)) = 0, 'a failed refund changes nothing');
CREATE TEMP TABLE r2 ON COMMIT DROP AS SELECT * FROM public.shop_refund_begin((SELECT id FROM a),
  jsonb_build_array(jsonb_build_object('line_id', (SELECT id FROM public.shop_order_lines WHERE order_id = (SELECT id FROM a) AND name = 'Mug'), 'quantity', 1)),
  false, false, 'goodwill', NULL);
GRANT SELECT ON r2 TO service_role;
SELECT tests.ok((SELECT id FROM r2) <> (SELECT id FROM r), 'and can be asked for again, with a new key');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT public.shop_refund_mark((SELECT id FROM r2), 'succeeded', 're_2', NULL);
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT status FROM public.shop_orders WHERE id = (SELECT id FROM a)) = 'collected'
                AND (SELECT refunded_amount FROM public.shop_orders WHERE id = (SELECT id FROM a)) = 199
                AND tests.sh_stock('Mug') = 0
                AND (SELECT i.total FROM public.invoices i JOIN public.shop_refunds f ON f.credit_note_id = i.id WHERE f.id = (SELECT id FROM r2)) = -199,
  'the part refund: the order stays collected, nothing restocked when not asked, a credit note of 199');
SELECT tests.throws($$SELECT public.shop_refund_begin((SELECT id FROM a),
  jsonb_build_array(jsonb_build_object('line_id', (SELECT id FROM public.shop_order_lines WHERE order_id = (SELECT id FROM a) AND name = 'Mug'), 'quantity', 2)),
  false, false, 'too many', NULL)$$, '22023', 'never more than is left to refund');
ROLLBACK;

-- ── One company's shop is not another's; customers see their own ──────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.sh_acme() AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.place_shop_order((SELECT id FROM o), jsonb_build_array(tests.sh_item('Mug', 1)), 'pickup', NULL, tests.sh_contact());
GRANT SELECT ON o, a TO service_role;
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT public.record_shop_payment((SELECT id FROM a), 199, 'acct_1Acme', 'pi_1', 'cs_1');
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv2);
SELECT public.create_organization('Beta AS', 'beta-shop');
SELECT tests.ok((SELECT count(*) FROM public.shop_orders) = 0 AND (SELECT count(*) FROM public.shop_order_lines) = 0
                AND (SELECT count(*) FROM public.shop_order_events) = 0,
  'another customer, owner of another company, sees none of Acme''s orders');
SELECT tests.ok((SELECT count(*) FROM public.shop_products WHERE name = 'Old mug') = 0, 'nor its inactive products');
SELECT tests.throws($$SELECT public.set_shop_order_status((SELECT id FROM a), 'ready_for_pickup', NULL)$$, '42501', 'and cannot work its orders');
SELECT tests.throws($$SELECT public.save_shop_product((SELECT id FROM o), NULL, '{"name":"X","price":10}')$$, '42501', 'or its catalogue');
SELECT tests.throws($$SELECT public.shop_refund_begin((SELECT id FROM a), NULL, false, false, 'x', NULL)$$, '42501', 'or refund it');
SELECT tests.throws($$SELECT public.cancel_shop_order((SELECT id FROM a), NULL)$$, '42501', 'or cancel it');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT count(*) FROM public.shop_orders) = 1 AND (SELECT count(*) FROM public.shop_order_lines) = 1,
  'the customer sees their own order');
SELECT tests.ok((SELECT count(*) FROM public.shop_products WHERE name = 'Old mug') = 0, 'and only the active catalogue');
SELECT tests.login(:worker);
SELECT tests.ok((SELECT count(*) FROM public.shop_orders) = 1 AND (SELECT count(*) FROM public.shop_products) = 4,
  'the company''s staff see its orders and its whole catalogue');
SELECT tests.login(:admin);
SELECT tests.ok((SELECT count(*) FROM public.shop_orders) = 1, 'FlyttGo''s administrators read them');
SELECT tests.throws($$SELECT public.set_shop_order_status((SELECT id FROM a), 'ready_for_pickup', NULL)$$, '42501', 'but do not work them');
SELECT tests.throws($$UPDATE public.shop_orders SET status = 'refunded'$$, '42501', 'nobody writes an order directly');
SELECT tests.throws($$UPDATE public.shop_products SET stock = 100$$, '42501', 'or the stock');
ROLLBACK;

\echo 'shop: all tests passed'
