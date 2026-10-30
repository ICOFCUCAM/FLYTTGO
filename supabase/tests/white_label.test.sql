-- ============================================================================
-- White label (supabase/migrations/00009_white_label.sql)
-- Each block runs in its own transaction and rolls back.
-- Uses tests.acme() (organizations.test.sql), tests.activate()
-- (company_bookings.test.sql) and tests.seller(), tests.as_server()
-- (invoicing.test.sql): cust1 owns Acme, drv1 is its booker, cust2 is a
-- customer of the company's page.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''

-- Acme active and approved on p_plan with everything the plan needs. The
-- caller's claims are kept.
CREATE OR REPLACE FUNCTION tests.wl_acme(p_plan text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid; v_claims text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM tests.seller();
  v_org := tests.acme();
  PERFORM tests.activate(v_org);
  PERFORM tests.login('c0000000-0000-0000-0000-000000000001');
  PERFORM public.update_organization(v_org, '{"vat_registered": true, "billing_address": "Acmeveien 1, 0150 Oslo"}');
  PERFORM public.request_white_label(v_org, p_plan);
  PERFORM public.set_white_label_brand(v_org, 'Acme Flytt', '#0055aa', '#ffcc00', 'Moving made easy',
    'kundeservice@acme.no', '+47 22 33 44 55', 'https://acme.no/vilkar', 'https://acme.no/personvern',
    CASE WHEN p_plan = 'own_seller' THEN 10 ELSE 0 END);
  IF p_plan <> 'branded' THEN
    PERFORM public.set_white_label_domain(v_org, 'booking.acme.no');
    PERFORM public.accept_white_label_dpa(v_org, '2026-10-draft');
    PERFORM tests.as_server();
    PERFORM public.mark_white_label_domain_verified(v_org, 'booking.acme.no');
    IF p_plan = 'own_seller' THEN PERFORM public.set_white_label_stripe_account(v_org, 'acct_1Acme', true); END IF;
  END IF;
  PERFORM tests.login('a0000000-0000-0000-0000-000000000001');
  PERFORM public.admin_decide_white_label(v_org, true, NULL);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN v_org;
END $$;

-- A booking by the signed-in person on the page of p_org.
CREATE OR REPLACE FUNCTION tests.wl_book(p_org uuid, p_seller text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.bookings (customer_id, white_label_org, seller_model, customer_price, price_estimate, original_price,
                               estimated_hours, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, van_type)
  VALUES (auth.uid(), p_org, p_seller, CASE WHEN p_seller IS NOT NULL THEN 1 END, 1250, 1250, 1, 59.91, 10.75, 59.95, 10.80, 'medium_van')
  RETURNING id;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── The price list is public; only FlyttGo changes it ──────────────────────
BEGIN;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT count(*) FROM public.white_label_plans WHERE code IN ('branded', 'branded_domain', 'own_seller')) = 3,
  'anyone reads the three transport plans');
SELECT tests.ok((SELECT code FROM public.white_label_plans WHERE is_default) = 'branded'
                AND (SELECT seller_model FROM public.white_label_plans WHERE is_default) = 'flyttgo',
  'the default plan is Model A: FlyttGo sells');
SELECT tests.ok((SELECT seller_model FROM public.white_label_plans WHERE code = 'own_seller') = 'company',
  'Own seller is Model B: the company sells');
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.white_label_plans WHERE price_status = 'confirmed')
                AND NOT EXISTS (SELECT 1 FROM public.white_label_plans WHERE price_status = 'pilot' AND code NOT IN ('restaurant', 'hotel', 'shop')),
  'the shipped prices are proposals until FlyttGo confirms them (Restaurant, Hotel and Online shop: pilot prices, 00022)');
SELECT tests.throws($$UPDATE public.white_label_plans SET monthly_fee = 0$$, '42501', 'visitors cannot change prices');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.admin_update_white_label_plan('branded', 0, 0, 0, 0, true, true)$$, '42501',
  'nor can a company');
SELECT tests.login(:admin);
SELECT tests.ok((SELECT price_status FROM public.admin_update_white_label_plan('branded', NULL, 1590, NULL, NULL, NULL, false)) = 'proposed',
  'a changed price stays a proposal');
SELECT tests.ok((SELECT price_status = 'confirmed' AND prices_confirmed_by = :admin AND monthly_fee = 1590
                   FROM public.admin_update_white_label_plan('branded', NULL, NULL, NULL, NULL, NULL, true)),
  'the administrator confirms it, and it records who did');
SELECT tests.ok((SELECT price_status FROM public.admin_update_white_label_plan('branded', NULL, 1490, NULL, NULL, NULL, false)) = 'proposed',
  'changing a confirmed price makes it a proposal again');
SELECT tests.throws($$SELECT public.admin_update_white_label_plan('branded', NULL, NULL, NULL, NULL, false, false)$$, '55000',
  'the default plan stays offered');
SELECT tests.throws($$UPDATE public.white_label_plans SET platform_fee_pct = 5 WHERE code = 'branded'$$, NULL,
  'a Model A plan has no platform fee (FlyttGo already sells the move)');
ROLLBACK;

-- ── Choosing Model A (the default) ──────────────────────────────────────────
BEGIN;
SELECT tests.seller();
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.request_white_label((SELECT id FROM o))$$, '42501', 'a booker cannot choose a plan');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT plan_code = 'branded' AND status = 'requested' AND display_name = 'Acme AS'
                   FROM public.request_white_label((SELECT id FROM o))),
  'the owner requests a plan; without naming one it is the default (Model A), named after the company');
SELECT tests.ok(public.white_label_missing((SELECT id FROM o)) = ARRAY['the company must be active (verified by FlyttGo)'],
  'the plan waits for the company to be verified');
SELECT tests.throws($$SELECT public.set_white_label_brand((SELECT id FROM o), 'Acme', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 15)$$, '22023',
  'only the seller (Model B) sets its own prices');
SELECT tests.throws($$SELECT public.set_white_label_brand((SELECT id FROM o), 'Acme', 'blue', NULL, NULL, NULL, NULL, NULL, NULL, 0)$$, '23514',
  'colours are hex codes');
SELECT tests.throws($$SELECT public.set_white_label_brand((SELECT id FROM o), 'Acme', NULL, NULL, NULL, NULL, NULL, 'http://acme.no', NULL, 0)$$, '23514',
  'links are https');
SELECT tests.throws($$SELECT public.admin_decide_white_label((SELECT id FROM o), true)$$, '42501', 'the company cannot approve itself');
SELECT tests.activate((SELECT id FROM o));
SELECT tests.ok(cardinality(public.white_label_missing((SELECT id FROM o))) = 0, 'once active, Model A needs nothing more');
SELECT tests.login(:admin);
SELECT tests.ok((SELECT status = 'active' AND started_at IS NOT NULL AND decided_by = :admin
                   FROM public.admin_decide_white_label((SELECT id FROM o), true)),
  'FlyttGo approves; billing starts');
SELECT tests.login(:cust2);
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.organization_white_label), 'outsiders do not see the set-up');
SELECT tests.throws($$SELECT public.white_label_missing((SELECT id FROM o))$$, '42501', 'nor what it lacks');
SELECT tests.ok((SELECT count(*) FROM public.organization_events WHERE action LIKE 'white_label.%') = 0, 'nor its log');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM public.organization_events WHERE action LIKE 'white_label.%') >= 2,
  'every step is in the company log');
ROLLBACK;

-- ── Model B needs the seller's obligations met before approval ─────────────
BEGIN;
SELECT tests.seller();
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
GRANT SELECT ON o TO service_role;
SELECT tests.activate((SELECT id FROM o));
SELECT public.request_white_label((SELECT id FROM o), 'own_seller');
SELECT tests.ok(public.white_label_missing((SELECT id FROM o)) @> ARRAY['registration for MVA', 'customer service email and phone',
                  'your terms (web address)', 'your privacy notice (web address)',
                  'the data processing agreement, accepted by an owner',
                  'a connected Stripe account that can take payments', 'a verified domain'],
  'Model B lists the seller''s requirements');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_decide_white_label((SELECT id FROM o), true)$$, '55000', 'FlyttGo cannot approve it yet');
SELECT tests.login(:cust1);
SELECT public.update_organization((SELECT id FROM o), '{"vat_registered": true}');
SELECT tests.ok((SELECT price_markup_pct FROM public.set_white_label_brand((SELECT id FROM o), 'Acme Flytt', NULL, NULL, NULL,
                   'kundeservice@acme.no', '+47 22 33 44 55', 'https://acme.no/vilkar', 'https://acme.no/personvern', 12.5)) = 12.5,
  'the seller sets its contacts, terms and markup');
SELECT tests.ok((SELECT domain_token IS NOT NULL AND domain_verified_at IS NULL AND custom_domain = 'booking.acme.no'
                   FROM public.set_white_label_domain((SELECT id FROM o), 'https://Booking.Acme.no/')),
  'the domain is normalised and gets a token for its DNS record');
SELECT tests.throws($$SELECT public.set_white_label_domain((SELECT id FROM o), 'acme.flyttgo.no')$$, '23514',
  'a FlyttGo address is not a company domain');
SELECT tests.throws($$SELECT public.mark_white_label_domain_verified((SELECT id FROM o), 'booking.acme.no')$$, '42501',
  'only the server marks the domain verified (after the DNS check)');
SELECT tests.throws($$SELECT public.set_white_label_stripe_account((SELECT id FROM o), 'acct_1Acme', true)$$, '42501',
  'only the server links the Stripe account');
SELECT tests.throws($$SELECT public.accept_white_label_dpa((SELECT id FROM o), '2025-01')$$, '22023',
  'the agreement accepted must be the one in force');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.accept_white_label_dpa((SELECT id FROM o), '2026-10-draft')$$, '42501',
  'only an owner accepts the data processing agreement');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT dpa_accepted_by = :cust1 FROM public.accept_white_label_dpa((SELECT id FROM o), '2026-10-draft')),
  'the owner accepts it, recorded by name');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT public.mark_white_label_domain_verified((SELECT id FROM o), 'booking.acme.no');
SELECT public.set_white_label_stripe_account((SELECT id FROM o), 'acct_1Acme', false);
SELECT tests.ok(public.white_label_missing((SELECT id FROM o)) = ARRAY['a connected Stripe account that can take payments'],
  'a Stripe account that cannot take payments yet is not enough');
SELECT public.set_white_label_stripe_account((SELECT id FROM o), 'acct_1Acme', true);
SELECT tests.throws($$SELECT public.set_white_label_stripe_account((SELECT id FROM o), 'acct_2Other', true)$$, '55000',
  'the account is not swapped silently');
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT tests.ok((SELECT status = 'active' AND price_markup_pct = 12.5 FROM public.admin_decide_white_label((SELECT id FROM o), true)),
  'with everything in place FlyttGo approves Model B');
SELECT tests.ok((SELECT status FROM public.admin_set_white_label_status((SELECT id FROM o), 'suspended', 'unpaid invoice')) = 'suspended',
  'FlyttGo can suspend it, with a reason');
SELECT tests.throws($$SELECT public.admin_set_white_label_status((SELECT id FROM o), 'active', '')$$, '22023', 'and needs a reason to change it');
ROLLBACK;

-- ── Changing plan waits for FlyttGo; the old plan stays in force ───────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.wl_acme('branded') AS id;
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT plan_code = 'branded' AND requested_plan_code = 'own_seller' AND status = 'active'
                   FROM public.request_white_label((SELECT id FROM o), 'own_seller')),
  'a change to Model B is requested; Model A stays in force meanwhile');
SELECT tests.ok('a connected Stripe account that can take payments' = ANY (public.white_label_missing((SELECT id FROM o))),
  'and the change lists what Model B still needs');
SELECT tests.login(:admin);
SELECT tests.ok((SELECT plan_code = 'branded' AND requested_plan_code IS NULL
                   FROM public.admin_decide_white_label((SELECT id FROM o), false, 'not before the agreement is signed')),
  'FlyttGo declines the change with a reason; the company keeps its plan');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT status FROM public.end_white_label((SELECT id FROM o), 'no longer needed')) = 'ended',
  'the owner ends the plan');
ROLLBACK;

-- ── Bookings on the page: the database decides the seller ──────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT tests.wl_acme('branded') AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE ba ON COMMIT DROP AS SELECT tests.wl_book((SELECT id FROM a), 'company') AS id;
GRANT SELECT ON a, ba TO service_role;
SELECT tests.ok((SELECT seller_model = 'flyttgo' AND customer_price IS NULL FROM public.bookings WHERE id = (SELECT id FROM ba)),
  'a booking on a Model A page is sold by FlyttGo, whatever the browser says, and carries no split');
SELECT tests.throws($$UPDATE public.bookings SET white_label_org = NULL WHERE id = (SELECT id FROM ba)$$, '42501',
  'the customer cannot move the booking off the page');
SELECT tests.login(:cust1);
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = (SELECT id FROM ba)),
  'Model A: the company does not see FlyttGo''s customers');
SELECT tests.ok((SELECT bookings FROM public.white_label_stats((SELECT id FROM a)) LIMIT 1) = 0
                AND (SELECT customer_revenue FROM public.white_label_stats((SELECT id FROM a)) LIMIT 1) IS NULL,
  'it sees numbers only (unpaid bookings not counted, no revenue)');
SELECT tests.login(:admin);
SELECT public.admin_set_white_label_status((SELECT id FROM a), 'suspended', 'test');
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT tests.wl_book((SELECT id FROM a))$$, '42501', 'a suspended page takes no bookings');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.wl_acme('own_seller') AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.wl_book((SELECT id FROM o)) AS id;
GRANT SELECT ON o, b TO service_role;
SELECT tests.ok((SELECT seller_model FROM public.bookings WHERE id = (SELECT id FROM b)) = 'company', 'a Model B page: the company sells');
SELECT tests.throws($$UPDATE public.bookings SET customer_price = 1 WHERE id = (SELECT id FROM b)$$, '42501',
  'the customer cannot set the price the company charges');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
UPDATE public.bookings SET customer_price = 1375, platform_fee = 61.25, connected_account_id = 'acct_1Acme' WHERE id = (SELECT id FROM b);
SELECT tests.ok((SELECT platform_fee FROM public.bookings WHERE id = (SELECT id FROM b)) = 61.25, 'the server writes the split');
SELECT tests.throws($$UPDATE public.bookings SET payment_provider = 'invoice', payment_status = 'paid' WHERE id = (SELECT id FROM b)$$, '55000',
  'a booking the company sells is never put on FlyttGo''s invoice');
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.ok(EXISTS (SELECT 1 FROM public.bookings WHERE id = (SELECT id FROM b)),
  'Model B: the seller''s team sees its customer''s booking');
ROLLBACK;

-- ── What the public page shows ─────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.wl_acme('own_seller') AS id;
GRANT SELECT ON o TO service_role;
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.white_label_public('acme')$$, '42501', 'the browser reads the page through the server');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((SELECT public.white_label_public('acme') ->> 'seller_model') = 'company'
                AND (SELECT public.white_label_public('acme') -> 'seller' ->> 'name') = 'Acme AS'
                AND (SELECT public.white_label_public('acme') ->> 'terms_url') = 'https://acme.no/vilkar'
                AND (SELECT (public.white_label_public('acme') -> 'pricing' ->> 'markup_pct')::numeric) = 10,
  'Model B: the page names the company as seller, its terms and its markup');
SELECT tests.ok((SELECT public.white_label_public(NULL, 'booking.acme.no') ->> 'organization_id')::uuid = (SELECT id FROM o)
                AND (SELECT public.white_label_public(NULL, 'acme.flyttgo.no') ->> 'slug') = 'acme',
  'found by its verified domain and by its FlyttGo subdomain');
SELECT tests.ok(public.white_label_public('nobody') IS NULL AND public.white_label_public(NULL, 'evil.example') IS NULL,
  'unknown pages and domains show nothing');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.wl_acme('branded') AS id;
GRANT SELECT ON o TO service_role;
SELECT tests.login(:cust1);
SELECT public.set_white_label_domain((SELECT id FROM o), 'booking.acme.no');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((SELECT public.white_label_public('acme') -> 'seller' ->> 'name') = 'FlyttGo AS'
                AND NOT (SELECT public.white_label_public('acme') -> 'seller' ? 'bank_account')
                AND (SELECT public.white_label_public('acme') -> 'pricing') = 'null'::jsonb,
  'Model A: FlyttGo is named as seller (without its bank details) and its prices apply');
SELECT tests.ok(public.white_label_public(NULL, 'booking.acme.no') IS NULL, 'a domain not yet verified shows nothing');
ROLLBACK;

-- ── Billing the plan on FlyttGo's invoices ─────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.wl_acme('branded') AS id;
GRANT SELECT ON o TO service_role;
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.create_white_label_invoice((SELECT id FROM o))$$, '42501', 'the company cannot bill itself');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
-- Approved on the 10th of a 30-day month.
UPDATE public.organization_white_label SET started_at = '2026-11-10 12:00+01' WHERE organization_id = (SELECT id FROM o);
CREATE TEMP TABLE i ON COMMIT DROP AS SELECT * FROM public.create_white_label_invoice((SELECT id FROM o), '2026-11-10');
SELECT tests.ok((SELECT count(*) FROM public.invoice_lines WHERE invoice_id = (SELECT id FROM i)) = 2
                AND (SELECT net_total FROM i) = 2900 + round(1490 * 21 / 30.0, 2)
                AND (SELECT total FROM i) = round((2900 + round(1490 * 21 / 30.0, 2)) * 1.25, 2),
  'the first invoice: the set-up fee and the month from the start day, plus 25% MVA');
SELECT tests.ok(public.create_white_label_invoice((SELECT id FROM o), '2026-11-20') IS NULL, 'nothing is charged twice');
SELECT tests.ok((SELECT net_total FROM public.create_white_label_invoice((SELECT id FROM o), '2026-12-01')) = 1490,
  'next month: the monthly fee, in advance');
SELECT tests.ok((SELECT status FROM public.issue_invoice((SELECT id FROM i))) = 'issued', 'issued like any FlyttGo invoice');
UPDATE public.organization_white_label SET status = 'ended', ended_at = '2026-12-15 12:00+01' WHERE organization_id = (SELECT id FROM o);
SELECT tests.ok(public.create_white_label_invoice((SELECT id FROM o), '2027-02-01') IS NULL, 'no fees after the month a plan ended');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.wl_acme('own_seller') AS id;
SELECT tests.login(:cust2);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.wl_book((SELECT id FROM o)) AS id;
INSERT INTO b SELECT tests.wl_book((SELECT id FROM o));
GRANT SELECT ON o, b TO service_role;
SET LOCAL ROLE service_role;
SELECT tests.as_server();
UPDATE public.organization_white_label SET started_at = '2026-11-01 00:00+01' WHERE organization_id = (SELECT id FROM o);
-- Both paid into the company's account: 1375 by the customer, of which
-- FlyttGo keeps its price 1250 and the platform fee 61.25. One completed,
-- one cancelled with half refunded.
UPDATE public.bookings SET payment_status = 'paid', payment_provider = 'stripe', paid_amount = 1375, customer_price = 1375,
       platform_fee = 61.25, connected_account_id = 'acct_1Acme' WHERE id IN (SELECT id FROM b);
UPDATE public.bookings SET status = 'completed', end_time = '2026-11-20 12:00+01' WHERE id = (SELECT min(id::text)::uuid FROM b);
UPDATE public.bookings SET status = 'cancelled', cancelled_by = 'customer', cancelled_at = '2026-11-21 12:00+01'
 WHERE id = (SELECT max(id::text)::uuid FROM b);
INSERT INTO public.payment_refunds (booking_id, provider, provider_reference, amount, status, idempotency_key)
SELECT max(id::text)::uuid, 'stripe', 'pi_x', 687.5, 'succeeded', 'k1' FROM b;
CREATE TEMP TABLE i ON COMMIT DROP AS SELECT * FROM public.create_white_label_invoice((SELECT id FROM o), '2026-12-01');
SELECT tests.ok((SELECT count(*) FROM public.white_label_charges WHERE invoice_id = (SELECT id FROM i) AND kind = 'booking') = 2,
  'last month''s finished bookings are settled once each');
SELECT tests.ok((SELECT sum(collected) FROM public.white_label_charges WHERE invoice_id = (SELECT id FROM i))
                = 1250 + 61.25 + 655.63,
  'what FlyttGo kept: its price and fee, and half of them after a half refund');
SELECT public.issue_invoice((SELECT id FROM i));
SELECT tests.ok((SELECT amount_paid FROM public.settle_white_label_invoice((SELECT id FROM i)))
                = (SELECT sum(collected) FROM public.white_label_charges WHERE invoice_id = (SELECT id FROM i)),
  'on issue, what was taken from the payments is recorded as paid');
SELECT tests.ok((SELECT public.invoice_outstanding(x) FROM public.invoices x WHERE id = (SELECT id FROM i))
                = round((14900 + 4990 * 2) * 1.25, 2),
  'and the company owes only the plan''s fees (set-up, November and December)');
SELECT public.settle_white_label_invoice((SELECT id FROM i));
SELECT tests.ok((SELECT count(*) FROM public.invoice_payments WHERE invoice_id = (SELECT id FROM i)) = 1, 'settled once');
SELECT tests.ok(public.create_white_label_invoice((SELECT id FROM o), '2026-12-15') IS NULL, 'and nothing is charged twice');
ROLLBACK;

-- ── Website templates: imported clean, approved by FlyttGo, chosen by the company ──
BEGIN;
CREATE TEMP TABLE tpl ON COMMIT DROP AS SELECT jsonb_build_object(
  'id', 'moving-swiftmv01', 'name', 'Swiftmove', 'industry', jsonb_build_array('moving', 'movers'), 'style', 'bold',
  'source_id', 'moving-swiftmv01',
  -- The importer's automated checks (00021): here one that passes.
  'checks', jsonb_build_object('version', 1, 'ran_at', '2026-10-29T12:00:00Z', 'results',
    jsonb_build_array(jsonb_build_object('id', 'image_alt', 'page', '/', 'status', 'pass', 'detail', 'ok'))),
  'pages', jsonb_build_array(
    jsonb_build_object('path', '/', 'html', '<html><head><style>.p{color:red}</style></head><body><h1>{{brand.name}}</h1><p>Crews from $129/hr</p><a href="{{BOOKING_URL}}">Book</a></body></html>'),
    jsonb_build_object('path', '/contact', 'html', '<p>Call {{brand.phone}}</p>'))) AS p;
GRANT SELECT ON tpl TO authenticated, service_role;
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.import_site_template((SELECT p FROM tpl))$$, '42501', 'only the importer (server) stores templates');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.throws($$SELECT public.import_site_template(jsonb_set((SELECT p FROM tpl), '{pages,1,html}', '"<script>x</script>"'))$$, '22023',
  'a page with a script is refused at import');
SELECT tests.ok((SELECT status FROM public.import_site_template((SELECT p FROM tpl))) = 'imported', 'a clean template is imported, unreviewed');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.wl_acme('branded') AS id;
SELECT tests.login(:cust1);
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.site_templates), 'companies do not see unreviewed templates');
SELECT tests.throws($$SELECT public.set_white_label_site((SELECT id FROM o), 'moving-swiftmv01', 'Oslo')$$, '22023',
  'nor can they choose one');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_review_site_template('moving-swiftmv01', true, true, NULL)$$, '55000',
  'FlyttGo cannot approve a template that still shows a sample price');
SELECT tests.throws($$SELECT public.admin_update_site_template_page('moving-swiftmv01', '/', '<p onmouseover="x()">hi</p>')$$, '22023',
  'an edited page must stay clean');
SELECT public.admin_update_site_template_page('moving-swiftmv01', '/',
  '<html><body><h1>{{brand.name}}</h1><p>See your price when you book.</p><a href="{{BOOKING_URL}}">Book</a></body></html>');
-- The admin panel records the edited page's checks again (00021).
SELECT public.admin_record_site_template_page_checks('moving-swiftmv01', '/',
  '[{"id": "image_alt", "page": "/", "status": "pass", "detail": "ok"}]', '[]');
SELECT tests.throws($$SELECT public.admin_review_site_template('moving-swiftmv01', true, false, NULL)$$, '55000',
  'and the reviewer must confirm sample reviews and claims were dealt with');
SELECT tests.ok((SELECT status = 'approved' AND reviewed_by = :admin
                   FROM public.admin_review_site_template('moving-swiftmv01', true, true, 'prices removed')),
  'then FlyttGo approves it, by name');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT template_id = 'moving-swiftmv01' AND city = 'Oslo'
                   FROM public.set_white_label_site((SELECT id FROM o), 'moving-swiftmv01', 'Oslo')),
  'the company chooses the approved template for its site');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.set_white_label_site((SELECT id FROM o), NULL, NULL)$$, '42501', 'a booker cannot change the site');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((public.white_label_public('acme') ->> 'template_id') = 'moving-swiftmv01', 'the public page uses it');
SELECT tests.ok((SELECT status FROM public.import_site_template(jsonb_set((SELECT p FROM tpl), '{pages,1,html}', '"<p>new</p>"'))) = 'imported',
  'a re-imported template that changed goes back to review');
SELECT tests.ok((public.white_label_public('acme') ->> 'template_id') IS NULL, 'and is not shown meanwhile');
ROLLBACK;

\echo 'white label: all tests passed'
