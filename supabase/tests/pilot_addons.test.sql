-- ============================================================================
-- Pilot pricing, add-on modules and approval at the moment of decision
-- (supabase/migrations/00022_pilot_addons.sql). Each block runs in its own
-- transaction and rolls back. Uses the fixtures of the earlier suites:
-- tests.acme(), tests.activate(), tests.book() (cust1 owns Acme, drv1 books
-- there), tests.wl_acme() (Model A), tests.ap_acme() (a salon on
-- Appointments), tests.api_addon(), tests.check() and tests.finance().
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''

-- ── Pilot pricing: shown as such, with what the set-up fee includes ───────
BEGIN;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT array_agg(code || ' ' || setup_fee || '/' || monthly_fee ORDER BY code) FROM public.white_label_plans
                  WHERE price_status = 'pilot') = ARRAY['hotel 4900/1490', 'restaurant 2900/990', 'shop 2900/990'],
  'Restaurant, Hotel and Online shop are pilot prices at the proposed amounts (excl. MVA)');
SELECT tests.ok((SELECT bool_and(price_note LIKE 'Pilot pricing%' AND cardinality(setup_fee_includes) = 4
                                 AND setup_fee_includes[1] LIKE 'Branding%' AND setup_fee_includes[2] LIKE 'Configuration%'
                                 AND setup_fee_includes[3] LIKE 'Content preparation%' AND setup_fee_includes[4] LIKE 'Publication%')
                   FROM public.white_label_plans WHERE price_status = 'pilot'),
  'each says it is a pilot price and what the set-up fee includes: branding, configuration, content preparation, publication');
SELECT tests.ok((SELECT bool_and(price_status = 'proposed') FROM public.white_label_plans WHERE code NOT IN ('restaurant', 'hotel', 'shop')),
  'every other plan stays a proposal');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.admin_set_white_label_pilot_price('jobs', 'pilot')$$, '42501', 'only FlyttGo sets a pilot price');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_set_white_label_pilot_price('jobs', '  ')$$, '22023', 'a pilot price needs its note');
SELECT tests.ok((SELECT price_status = 'pilot' AND prices_confirmed_by = :admin AND price_note = 'Pilot pricing for trades'
                   FROM public.admin_set_white_label_pilot_price('jobs', 'Pilot pricing for trades')),
  'an administrator accepts a plan''s prices for the pilot, recorded with who and when');
SELECT tests.ok((SELECT price_status = 'proposed' AND price_note IS NULL AND prices_confirmed_by IS NULL
                   FROM public.admin_update_white_label_plan('jobs', NULL, 1390, NULL, NULL, NULL, false)),
  'changing a pilot price makes it a proposal again and clears its note');
SELECT tests.ok((SELECT price_status = 'confirmed' AND price_note IS NULL
                   FROM public.admin_update_white_label_plan('restaurant', NULL, NULL, NULL, NULL, NULL, true)),
  'confirming a pilot price makes it final');
SELECT tests.ok((SELECT price_status = 'pilot' FROM public.admin_update_white_label_plan('hotel', NULL, NULL, NULL, NULL, true, false)),
  'saving without a price change leaves the pilot price as it is');
RESET ROLE;
SELECT tests.throws($$UPDATE public.white_label_plans SET price_status = 'agreed' WHERE code = 'shop'$$, '23514',
  'a price is proposed, pilot or confirmed, nothing else');
ROLLBACK;

-- ── Add-ons: enabled by FlyttGo, priced by quote or approved pilot price ──
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.ap_acme() AS id;
SELECT tests.login(:cust1);
SELECT tests.ok(public.org_modules((SELECT id FROM o)) = ARRAY['appointments', 'sales_invoicing'] AND NOT public.org_has_module((SELECT id FROM o), 'shop'),
  'a salon on Appointments has its plan''s modules');
SELECT tests.throws($$SELECT public.admin_enable_addon((SELECT id FROM o), 'shop', 'quote', NULL, NULL, 'Q-1', NULL)$$, '42501',
  'a company does not enable its own add-ons');
SELECT tests.throws($$INSERT INTO public.organization_addons (organization_id, module, pricing, quote_reference, enabled_by)
                       VALUES ((SELECT id FROM o), 'shop', 'quote', 'Q-1', 'c0000000-0000-0000-0000-000000000001')$$, '42501',
  'nor writes them directly');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_enable_addon((SELECT id FROM o), 'shop', 'quote', NULL, NULL, ' ', NULL)$$, '22023',
  'a quote needs its reference');
SELECT tests.throws($$SELECT public.admin_enable_addon((SELECT id FROM o), 'shop', 'pilot', 2900, NULL, NULL, 'pilot')$$, '22023',
  'a pilot price needs the approved monthly fee');
SELECT tests.throws($$SELECT public.admin_enable_addon((SELECT id FROM o), 'shop', 'pilot', NULL, 590, NULL, NULL)$$, '22023',
  'and a note saying it is approved');
SELECT tests.throws($$SELECT public.admin_enable_addon((SELECT id FROM o), 'shop', 'list', NULL, NULL, NULL, NULL)$$, '22023',
  'there is no other way to price one (no derived combined price)');
SELECT tests.throws($$SELECT public.admin_enable_addon((SELECT id FROM o), 'fleet', 'quote', NULL, NULL, 'Q-1', NULL)$$, '22023',
  'only known modules');
SELECT tests.throws($$SELECT public.admin_enable_addon((SELECT id FROM o), 'appointments', 'quote', NULL, NULL, 'Q-1', NULL)$$, '55000',
  'not a module the plan already has');
SELECT tests.throws($$SELECT public.admin_enable_addon((SELECT id FROM o), 'shop', 'quote', NULL, NULL, 'Q-1', NULL)$$, '55000',
  'a shop needs the company''s own Stripe account first');
SET LOCAL ROLE postgres;
SELECT tests.as_server();
SELECT public.set_white_label_stripe_account((SELECT id FROM o), 'acct_1Salon', true);
UPDATE public.organizations SET vat_registered = true WHERE id = (SELECT id FROM o);
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT public.save_shop_settings((SELECT id FROM o), '{"pickup_enabled":true,"pickup_address":"Torget 1, 0150 Oslo"}');
SELECT public.save_shop_product((SELECT id FROM o), NULL, '{"name":"Shampoo","price":249,"track_stock":true,"stock":5}');
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.place_shop_order((SELECT id FROM o), jsonb_build_array(jsonb_build_object('product_id',
    (SELECT id FROM public.shop_products WHERE name = 'Shampoo'), 'quantity', 1)), 'pickup', NULL, '{"name":"Kari","phone":"+47 900 00 000","email":"kari@example.no"}')$$,
  '55000', 'without the add-on the salon''s shop is closed');
SELECT tests.login(:admin);
SELECT tests.ok((SELECT module = 'shop' AND pricing = 'pilot' AND monthly_fee = 590 AND setup_fee IS NULL AND enabled_by = :admin
                   FROM public.admin_enable_addon((SELECT id FROM o), 'shop', 'pilot', NULL, 590, NULL, 'Pilot price for a shop on Appointments, approved by FlyttGo 2026-10-29')),
  'FlyttGo adds the shop at a pilot price it approves, recorded with the add-on (no set-up fee stated: none is invented)');
SELECT tests.throws($$SELECT public.admin_enable_addon((SELECT id FROM o), 'shop', 'quote', NULL, NULL, 'Q-2', NULL)$$, '23505', 'once');
SELECT tests.ok(public.org_modules((SELECT id FROM o)) = ARRAY['appointments', 'sales_invoicing', 'shop']
                AND public.org_has_module((SELECT id FROM o), 'shop') AND public.org_has_module((SELECT id FROM o), 'appointments'),
  'the plan''s modules and the add-on side by side (org_has_module counts it)');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT status FROM public.place_shop_order((SELECT id FROM o), jsonb_build_array(jsonb_build_object('product_id',
    (SELECT id FROM public.shop_products WHERE name = 'Shampoo'), 'quantity', 1)), 'pickup', NULL, '{"name":"Kari","phone":"+47 900 00 000","email":"kari@example.no"}'))
                = 'awaiting_payment',
  'the shop takes orders: every existing module check works unchanged');
SELECT tests.ok(EXISTS (SELECT 1 FROM public.shop_products WHERE name = 'Shampoo'), 'and its catalogue is public');
SELECT tests.ok(EXISTS (SELECT 1 FROM public.available_slots((SELECT id FROM o), tests.haircut(), (tests.at(3, '10:00') AT TIME ZONE 'Europe/Oslo')::date)),
  'appointments go on as before beside it');
SELECT tests.ok((SELECT count(*) FROM public.organization_addons) = 0, 'other people do not see a company''s add-ons');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM public.organization_addons) = 1, 'its members do');
RESET ROLE;
SELECT tests.ok((SELECT details ->> 'module' = 'shop' AND details ->> 'monthly_fee' = '590' AND actor_id = :admin
                   FROM public.organization_events WHERE action = 'addon.enabled' AND organization_id = (SELECT id FROM o)),
  'enabling is in the company''s log, with the price');
-- The plan suspended: the add-on stops with it; ended: kept as a record.
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT public.admin_set_white_label_status((SELECT id FROM o), 'suspended', 'test');
SELECT tests.ok(NOT public.org_has_module((SELECT id FROM o), 'shop') AND NOT public.org_has_module((SELECT id FROM o), 'appointments'),
  'an add-on works only while the primary plan is active');
SELECT public.admin_set_white_label_status((SELECT id FROM o), 'active', 'test');
SELECT tests.throws($$SELECT public.admin_end_addon((SELECT id FROM o), 'shop', NULL)$$, '22023', 'ending one needs a reason');
SELECT tests.ok((SELECT status = 'ended' AND end_reason = 'pilot over' FROM public.admin_end_addon((SELECT id FROM o), 'shop', 'pilot over')),
  'FlyttGo ends it, with the reason');
SELECT tests.ok(NOT public.org_has_module((SELECT id FROM o), 'shop') AND public.org_has_module((SELECT id FROM o), 'appointments'),
  'the shop closes; the plan''s modules stay');
SELECT tests.ok((SELECT count(*) FROM public.organization_addons WHERE organization_id = (SELECT id FROM o)) = 1, 'the record stays');
SELECT tests.ok((SELECT pricing = 'quote' AND quote_reference = 'Q-2026-17'
                   FROM public.admin_enable_addon((SELECT id FROM o), 'shop', 'quote', NULL, NULL, 'Q-2026-17', NULL)),
  'and it can be enabled again, on a written quote');
ROLLBACK;

-- ── Where FlyttGo sells (Model A), the only add-on is the API ─────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.wl_acme('branded') AS id;
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_enable_addon((SELECT id FROM o), 'shop', 'quote', NULL, NULL, 'Q-1', NULL)$$, '55000',
  'no shop on a plan where FlyttGo is the seller');
SELECT tests.ok((SELECT module FROM public.admin_enable_addon((SELECT id FROM o), 'api', 'quote', NULL, NULL, 'Q-1', NULL)) = 'api',
  'the API add-on goes on any plan');
-- A company without a plan: only the API.
SELECT tests.login(:cust2);
CREATE TEMP TABLE o2 ON COMMIT DROP AS SELECT id FROM public.create_organization('Kunde AS', 'kunde-as');
SELECT tests.activate((SELECT id FROM o2));
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_enable_addon((SELECT id FROM o2), 'jobs', 'quote', NULL, NULL, 'Q-1', NULL)$$, '55000',
  'a module needs a primary plan to go on');
SELECT public.admin_enable_addon((SELECT id FROM o2), 'api', 'quote', NULL, NULL, 'Q-3', NULL);
SELECT tests.ok(public.org_modules((SELECT id FROM o2)) = ARRAY['api'], 'the API works for a company that books moves for itself');
SELECT public.admin_set_organization_status((SELECT id FROM o2), 'suspended', 'test');
SELECT tests.ok(NOT public.org_has_module((SELECT id FROM o2), 'api'), 'while the company is active');
SELECT tests.throws($$SELECT public.admin_enable_addon((SELECT id FROM o2), 'sales_invoicing', 'quote', NULL, NULL, 'Q-1', NULL)$$, '55000',
  'and nothing is enabled for an inactive company');
ROLLBACK;

-- ── Approval: the approver's permissions and the request, at that moment ──
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
SELECT tests.finance((SELECT id FROM o));
SELECT public.set_spending_rules((SELECT id FROM o), NULL, ARRAY['booker'], 168);
SELECT tests.login(:drv1);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id, 1 AS n;
INSERT INTO b SELECT tests.book((SELECT id FROM o)), 2;
INSERT INTO b SELECT tests.book((SELECT id FROM o)), 3;
SELECT tests.check((SELECT id FROM b WHERE n = 1));
SELECT tests.check((SELECT id FROM b WHERE n = 2));
SELECT tests.check((SELECT id FROM b WHERE n = 3));
-- Finance loses the role before deciding: refused.
SELECT tests.login(:cust1);
SELECT public.change_member_role((SELECT id FROM o), :cust2, 'viewer');
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b WHERE n = 1), true, NULL)$$, '42501',
  'an approver who has lost the role since the request cannot approve');
SELECT tests.login(:cust1);
SELECT public.change_member_role((SELECT id FROM o), :cust2, 'finance');
SELECT public.remove_member((SELECT id FROM o), :cust2);
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b WHERE n = 1), true, NULL)$$, 'P0002',
  'nor one who has left the company');
-- The company suspended: nobody approves.
SELECT tests.login(:admin);
SELECT public.admin_set_organization_status((SELECT id FROM o), 'suspended', 'test');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b WHERE n = 1), true, NULL)$$, '42501',
  'nor anyone while the company is suspended');
SELECT tests.login(:admin);
SELECT public.admin_set_organization_status((SELECT id FROM o), 'active', 'test');
-- The amount the approver saw.
SELECT tests.login(:drv1);
SELECT tests.check((SELECT id FROM b WHERE n = 1), 1800);
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b WHERE n = 1), true, NULL, 1200)$$, '55000',
  'an approval for the amount the approver saw is refused when the request has changed since');
SELECT tests.ok((SELECT status = 'approved' AND amount = 1800 FROM public.decide_booking_approval((SELECT id FROM b WHERE n = 1), true, NULL, 1800)),
  'approving the amount shown');
RESET ROLE;
SELECT tests.ok((SELECT price_estimate = 1200 AND payment_status = 'pending' FROM public.bookings WHERE id = (SELECT id FROM b WHERE n = 1)),
  'approval never changes the booking or its amount');
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.ok(tests.check((SELECT id FROM b WHERE n = 1), 1800) ->> 'status' = 'approved', 'the server''s price of 1800 is paid on it');
SELECT tests.ok((SELECT r ->> 'status' = 'pending' AND (r -> 'reasons') ? 'price_changed'
                   FROM (SELECT tests.check((SELECT id FROM b WHERE n = 1), 1750) AS r) x),
  'any other price is a new request, never paid on the old approval');
RESET ROLE;
SELECT tests.ok((SELECT array_agg(action ORDER BY id) FROM public.company_booking_approval_events WHERE booking_id = (SELECT id FROM b WHERE n = 1))
                = ARRAY['requested', 'amount_changed', 'approved', 'price_changed', 'requested'],
  'the log shows the change of price and the new request');
-- Expired by its deadline, before the job has run.
UPDATE public.company_booking_approvals SET expires_at = now() - interval '1 second' WHERE booking_id = (SELECT id FROM b WHERE n = 2);
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b WHERE n = 2), true, NULL)$$, '55000',
  'a request past its deadline cannot be approved, even before the expiry job has run');
SELECT tests.ok((SELECT status FROM public.company_booking_approvals WHERE booking_id = (SELECT id FROM b WHERE n = 2)) = 'pending',
  '(the job ends it)');
-- A cancelled booking: the request is withdrawn and cannot be approved.
SELECT tests.login(:drv1);
UPDATE public.bookings SET status = 'cancelled' WHERE id = (SELECT id FROM b WHERE n = 3);
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b WHERE n = 3), true, NULL)$$, '55000',
  'nor a request whose booking was cancelled');
ROLLBACK;

-- ── Nobody approves their own booking, in whatever role ───────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
SELECT tests.finance((SELECT id FROM o));
SELECT public.set_spending_rules((SELECT id FROM o), NULL, ARRAY['booker', 'admin'], 168);
SELECT tests.login(:drv1);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id;
SELECT tests.check((SELECT id FROM b));
-- The booker becomes finance, then admin: never their own booking.
SELECT tests.login(:cust1);
SELECT public.change_member_role((SELECT id FROM o), :drv1, 'finance');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b), true, NULL)$$, '42501',
  'a booker who became finance cannot approve the booking they made');
SELECT tests.login(:cust1);
SELECT public.change_member_role((SELECT id FROM o), :drv1, 'admin');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b), false, 'no')$$, '42501',
  'nor, as admin, refuse it');
-- A FlyttGo administrator who is also an admin of the company and booked.
SET LOCAL ROLE postgres;
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES ((SELECT id FROM o), :admin, 'admin');
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
CREATE TEMP TABLE b2 ON COMMIT DROP AS SELECT tests.book((SELECT id FROM o)) AS id;
SELECT tests.check((SELECT id FROM b2));
SELECT tests.throws($$SELECT public.decide_booking_approval((SELECT id FROM b2), true, NULL)$$, '42501',
  'a member who is also a FlyttGo administrator cannot approve their own booking either');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT status = 'approved' FROM public.decide_booking_approval((SELECT id FROM b), true, NULL)),
  'another finance member approves it');
ROLLBACK;

\echo 'pilot pricing, add-ons and approval: all tests passed'
