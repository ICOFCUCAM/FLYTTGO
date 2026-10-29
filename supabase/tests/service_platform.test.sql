-- ============================================================================
-- The platform for other industries (supabase/migrations/00010_service_platform.sql)
-- Each block runs in its own transaction and rolls back. Uses tests.acme(),
-- tests.activate(), tests.seller(), tests.as_server() and tests.wl_acme().
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''

-- Acme as a company outside transport, active, on p_plan with everything
-- a company-sells plan needs, approved. Claims are kept.
CREATE OR REPLACE FUNCTION tests.sp_acme(p_industry text, p_plan text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid; v_claims text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM tests.seller();
  v_org := tests.acme();
  PERFORM tests.activate(v_org);
  PERFORM tests.login('c0000000-0000-0000-0000-000000000001');
  PERFORM public.set_organization_industry(v_org, p_industry);
  PERFORM public.request_white_label(v_org, p_plan);
  PERFORM public.set_white_label_brand(v_org, 'Acme Rør', '#0055aa', '#ffcc00', NULL,
    'post@acme.no', '+47 22 33 44 55', 'https://acme.no/vilkar', 'https://acme.no/personvern', 0);
  PERFORM public.accept_white_label_dpa(v_org, '2026-10-draft');
  PERFORM tests.login('a0000000-0000-0000-0000-000000000001');
  PERFORM public.admin_decide_white_label(v_org, true, NULL);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN v_org;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── Plans for other industries; FlyttGo sells only transport ───────────────
BEGIN;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.ok((SELECT count(*) FROM public.white_label_plans WHERE seller_model = 'company' AND code IN ('website_invoicing', 'jobs', 'appointments')) = 3,
  'the three new plans are public, all with the company as seller');
SELECT tests.ok((SELECT modules FROM public.white_label_plans WHERE code = 'jobs') = ARRAY['jobs', 'sales_invoicing']
                AND (SELECT industries FROM public.white_label_plans WHERE code = 'jobs') = ARRAY['field_service'],
  'Jobs is for trades and brings jobs and invoicing');
RESET ROLE;
SELECT tests.throws($$UPDATE public.white_label_plans SET modules = ARRAY['jobs'] WHERE code = 'branded'$$, '23514',
  'a plan where FlyttGo sells cannot carry another industry''s module');
SELECT tests.throws($$UPDATE public.white_label_plans SET industries = ARRAY['field_service'] WHERE code = 'branded'$$, '23514',
  'nor be offered outside transport');
ROLLBACK;

BEGIN;
SELECT tests.seller();
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.activate((SELECT id FROM o));
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.set_organization_industry((SELECT id FROM o), 'field_service')$$, '42501', 'a booker cannot change the industry');
SELECT tests.login(:cust1);
SELECT public.set_organization_industry((SELECT id FROM o), 'field_service');
SELECT tests.throws($$SELECT public.set_organization_industry((SELECT id FROM o), 'plumbing')$$, '23514', 'industries come from the list');
SELECT public.request_white_label((SELECT id FROM o), 'branded');
SELECT tests.ok('FlyttGo sells only moving and delivery: choose a plan where your company sells' = ANY (public.white_label_missing((SELECT id FROM o))),
  'a plumber cannot have FlyttGo sell for it (Model A is for transport)');
SELECT tests.ok('a plan for your industry' = ANY (public.white_label_missing((SELECT id FROM o), 'appointments')),
  'the Appointments plan is not for a trade');
SELECT public.request_white_label((SELECT id FROM o), 'jobs');
SELECT tests.ok(public.white_label_missing((SELECT id FROM o)) @> ARRAY['customer service email and phone', 'the data processing agreement, accepted by an owner']
                AND NOT ('registration for MVA' = ANY (public.white_label_missing((SELECT id FROM o))))
                AND NOT ('a connected Stripe account that can take payments' = ANY (public.white_label_missing((SELECT id FROM o)))),
  'Jobs needs the seller''s contacts and the agreement, not MVA registration or Stripe');
ROLLBACK;

-- ── Modules come with the active plan ──────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.sp_acme('field_service', 'jobs') AS id;
SELECT tests.login(:cust1);
SELECT tests.ok(public.org_has_module((SELECT id FROM o), 'jobs') AND public.org_has_module((SELECT id FROM o), 'sales_invoicing')
                AND NOT public.org_has_module((SELECT id FROM o), 'appointments'),
  'the Jobs plan switches on jobs and invoicing, not appointments');
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT tests.wl_book((SELECT id FROM o))$$, '42501', 'its page takes no moves (FlyttGo''s moving engine)');
SELECT tests.login(:admin);
SELECT public.admin_set_white_label_status((SELECT id FROM o), 'suspended', 'test');
SELECT tests.ok(NOT public.org_has_module((SELECT id FROM o), 'jobs'), 'a suspended plan switches its modules off');
ROLLBACK;

-- ── Staff role ─────────────────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT public.invite_member((SELECT id FROM o), 'cust2@test', 'staff');
SELECT tests.ok((SELECT role FROM public.organization_invitations WHERE email = 'cust2@test') = 'staff', 'a company invites a worker as staff');
ROLLBACK;

-- ── Trade authorisations ───────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.throws($$SELECT public.record_organization_authorisation((SELECT id FROM o), 'electrical', 'DSB', '123', NULL, '{"checked":"x"}')$$, '42501',
  'a company cannot record its own authorisation');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.record_organization_authorisation((SELECT id FROM o), 'electrical', 'DSB', '123', NULL, '{}')$$, '22023',
  'FlyttGo records what it checked');
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM public.record_organization_authorisation((SELECT id FROM o), 'electrical',
  'DSB elvirksomhetsregisteret', '974760673', current_date + 30, '{"checked":"register search 2026-10-29"}');
SELECT tests.ok(public.has_authorisation((SELECT id FROM o), 'electrical') AND NOT public.has_authorisation((SELECT id FROM o), 'gas'),
  'a valid authorisation counts, for its kind only');
SELECT public.revoke_organization_authorisation((SELECT id FROM a), 'removed from the register');
SELECT tests.ok(NOT public.has_authorisation((SELECT id FROM o), 'electrical'), 'a revoked one does not');
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT count(*) FROM public.organization_authorisations) = 1, 'the company sees its authorisations (kept as evidence)');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT count(*) FROM public.organization_authorisations) = 0, 'outsiders do not');
ROLLBACK;

\echo 'service platform: all tests passed'
