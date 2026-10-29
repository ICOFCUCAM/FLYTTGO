-- ============================================================================
-- Organisation tests (supabase/migrations/00005_organizations.sql)
-- Each block runs in its own transaction and rolls back.
-- Run with supabase/tests/run.sh.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''
\set drv2    '''d0000000-0000-0000-0000-000000000002'''
\set applic  '''e0000000-0000-0000-0000-000000000001'''

-- Fixture for every block: cust1 owns "Acme" (pending); drv1 is a booker
-- there; cust2 is outside. Built as cust1 through the functions.
CREATE OR REPLACE FUNCTION tests.acme() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_org uuid; v_tok text;
BEGIN
  PERFORM tests.login('c0000000-0000-0000-0000-000000000001');
  SELECT id INTO v_org FROM public.create_organization('Acme AS', 'acme', '923609016', 'Faktura@Acme.no');
  SELECT token INTO v_tok FROM public.invite_member(v_org, 'DRV1@test', 'booker');
  PERFORM tests.login('d0000000-0000-0000-0000-000000000001');
  PERFORM public.accept_invitation(v_tok);
  PERFORM tests.login('c0000000-0000-0000-0000-000000000001');
  RETURN v_org;
END $$;
GRANT EXECUTE ON FUNCTION tests.acme() TO authenticated;

-- ── Validation ─────────────────────────────────────────────────────────────
BEGIN;
SELECT tests.ok(public.is_valid_norwegian_org_number('923609016'), 'a valid organisation number passes MOD11');
SELECT tests.ok(NOT public.is_valid_norwegian_org_number('923609017'), 'a wrong check digit fails');
SELECT tests.ok(NOT public.is_valid_norwegian_org_number('12345678'), 'eight digits fail');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.create_organization('Bad', 'badco', '923609017')$$, '23514', 'an invalid organisation number is refused');
SELECT tests.throws($$SELECT public.create_organization('Admin', 'admin')$$, '23514', 'a reserved slug is refused');
SELECT tests.throws($$SELECT public.create_organization('X', '-x-')$$, '23514', 'a malformed slug is refused');
SELECT tests.acme() IS NOT NULL;
SELECT tests.throws($$SELECT public.create_organization('Acme 2', 'acme')$$, '23505', 'slugs are unique');
SELECT tests.throws($$SELECT public.create_organization('Acme 2', 'acme-two', '923 609 016')$$, '23505', 'organisation numbers are unique');
ROLLBACK;

-- ── Anonymous and direct access ────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
GRANT SELECT ON o TO anon;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.throws($$SELECT count(*) FROM public.organizations$$, '42501', 'anon cannot read organisations');
SELECT tests.throws($$SELECT public.create_organization('Anon', 'anon-co')$$, '42501', 'anon cannot create one');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$INSERT INTO public.organizations (name, slug) VALUES ('Direct', 'direct')$$, '42501', 'no direct insert of organisations');
SELECT tests.throws($$UPDATE public.organizations SET status = 'active'$$, '42501', 'an owner cannot activate their own organisation directly');
SELECT tests.throws($$INSERT INTO public.organization_members (organization_id, user_id, role)
                       SELECT id, 'c0000000-0000-0000-0000-000000000002', 'owner' FROM o$$, '42501', 'no direct insert of members');
SELECT tests.throws($$DELETE FROM public.organization_events$$, '42501', 'the event log cannot be deleted');
SELECT tests.throws($$SELECT public.require_org_role((SELECT id FROM o), ARRAY['owner'])$$, '42501', 'internal helpers are not callable');
ROLLBACK;

-- ── Creating: owner, pending, independent of profile role and driver plan
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.ok((SELECT status FROM public.organizations WHERE id = (SELECT id FROM o)) = 'pending', 'a new organisation is pending');
SELECT tests.ok(public.org_role((SELECT id FROM o)) = 'owner', 'its creator is the owner');
SELECT tests.ok((SELECT billing_email FROM public.organizations) = 'faktura@acme.no', 'billing email is kept in lower case');
SELECT tests.ok((SELECT role FROM public.profiles WHERE user_id = :cust1 LIMIT 1) = 'customer', 'the owner''s profile role is unchanged');
SELECT tests.login(:drv1);
SELECT tests.ok(public.org_role((SELECT id FROM o)) = 'booker', 'a driver can be a company member');
SELECT tests.ok((SELECT role FROM public.profiles WHERE user_id = :drv1 LIMIT 1) IS DISTINCT FROM 'booker', 'membership does not touch the profile role');
SELECT tests.ok((SELECT count(*) FROM public.driver_subscriptions WHERE driver_id = :drv1 AND subscription_status = 'active') = 1
                AND (SELECT public.plan_slug(sp.name) FROM public.driver_subscriptions ds JOIN public.subscription_plans sp ON sp.id = ds.plan_id
                      WHERE ds.driver_id = :drv1 AND ds.subscription_status = 'active') = 'pro',
  'the driver''s plan is untouched by joining');
SELECT tests.ok(NOT public.is_org_member((SELECT id FROM o), ARRAY['owner', 'admin']), 'a booker is not an admin');
ROLLBACK;

-- ── Reading: members only; invitations and events owners/admins only ──────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT public.invite_member((SELECT id FROM o), 'new@test', 'viewer');
SELECT tests.ok((SELECT count(*) FROM public.organization_invitations) = 2, 'the owner sees the invitations');
SELECT tests.ok((SELECT count(*) FROM public.organization_events) >= 3, 'the owner sees the events');
SELECT tests.ok((SELECT token_hash FROM public.organization_invitations WHERE email = 'new@test') ~ '^[0-9a-f]{64}$',
  'only the token''s hash is stored');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.organizations) = 1, 'a member sees the organisation');
SELECT tests.ok((SELECT count(*) FROM public.organization_members) = 2, 'a member sees the team');
SELECT tests.ok((SELECT count(*) FROM public.organization_team((SELECT id FROM o))) = 2, 'a member sees the team with names');
SELECT tests.ok((SELECT count(*) FROM public.organization_invitations) = 0, 'a booker does not see invitations');
SELECT tests.ok((SELECT count(*) FROM public.organization_events) = 0, 'a booker does not see the event log');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT count(*) FROM public.organizations) = 0, 'an outsider sees no organisation');
SELECT tests.ok((SELECT count(*) FROM public.organization_members) = 0, 'an outsider sees no members');
SELECT tests.ok((SELECT count(*) FROM public.organization_team((SELECT id FROM o))) = 0, 'an outsider gets no team');
SELECT tests.login(:admin);
SELECT tests.ok((SELECT count(*) FROM public.organizations) = 1 AND (SELECT count(*) FROM public.organization_invitations) = 2,
  'a platform admin sees organisations and invitations');
ROLLBACK;

-- ── Editing and status ─────────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.ok((SELECT name FROM public.update_organization((SELECT id FROM o), '{"name":"Acme Logistikk AS"}')) = 'Acme Logistikk AS',
  'the owner renames the company');
SELECT tests.throws($$SELECT public.update_organization((SELECT id FROM o), '{"status":"active"}')$$, '42501', 'status is not editable by members');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.update_organization((SELECT id FROM o), '{"name":"Hijack"}')$$, '42501', 'a booker cannot edit the company');
SELECT tests.throws($$SELECT public.admin_set_organization_status((SELECT id FROM o), 'active')$$, '42501', 'members cannot activate');
SELECT tests.login(:admin);
SELECT tests.ok((SELECT status FROM public.admin_set_organization_status((SELECT id FROM o), 'suspended', 'unpaid')) = 'suspended',
  'a platform admin suspends');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.invite_member((SELECT id FROM o), 'x@test', 'viewer')$$, '42501', 'a suspended organisation cannot invite');
SELECT tests.throws($$SELECT public.admin_set_organization_status((SELECT id FROM o), 'unknown')$$, '42501', 'the owner cannot change status');
ROLLBACK;

-- ── Roles: admins manage below admin; owners manage everyone; last owner ──
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
-- cust2 joins as admin.
CREATE TEMP TABLE t ON COMMIT DROP AS SELECT token FROM public.invite_member((SELECT id FROM o), 'cust2@test', 'admin');
SELECT tests.login(:cust2);
SELECT public.accept_invitation((SELECT token FROM t));
SELECT tests.ok(public.change_member_role((SELECT id FROM o), :drv1, 'finance') IS NOT NULL, 'an admin changes a booker to finance');
SELECT tests.throws($$SELECT public.change_member_role((SELECT id FROM o), 'd0000000-0000-0000-0000-000000000001', 'admin')$$,
  '42501', 'an admin cannot make another admin');
SELECT tests.throws($$SELECT public.change_member_role((SELECT id FROM o), 'c0000000-0000-0000-0000-000000000001', 'viewer')$$,
  '42501', 'an admin cannot demote the owner');
SELECT tests.throws($$SELECT public.remove_member((SELECT id FROM o), 'c0000000-0000-0000-0000-000000000001')$$,
  '42501', 'an admin cannot remove the owner');
SELECT tests.throws($$SELECT public.invite_member((SELECT id FROM o), 'boss@test', 'owner')$$, '42501', 'an admin cannot invite an owner');
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT public.remove_member((SELECT id FROM o), 'c0000000-0000-0000-0000-000000000002')$$,
  '42501', 'finance cannot remove members');
SELECT public.remove_member((SELECT id FROM o), :drv1);
SELECT tests.ok(public.org_role((SELECT id FROM o)) IS NULL, 'a member can leave');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.change_member_role((SELECT id FROM o), 'c0000000-0000-0000-0000-000000000001', 'admin')$$,
  '23514', 'the last owner cannot step down');
SELECT tests.throws($$SELECT public.remove_member((SELECT id FROM o), 'c0000000-0000-0000-0000-000000000001')$$,
  '23514', 'the last owner cannot leave');
SELECT public.change_member_role((SELECT id FROM o), :cust2, 'owner');
SELECT public.change_member_role((SELECT id FROM o), :cust1, 'admin');
SELECT tests.ok(public.org_role((SELECT id FROM o)) = 'admin', 'with a second owner, the first can step down');
ROLLBACK;

-- The guard also holds for the platform's own SQL, and deleting the
-- organisation removes its members.
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
RESET ROLE;
SELECT tests.throws($$DELETE FROM public.organization_members WHERE role = 'owner'$$, '23514', 'the last owner cannot be deleted in SQL either');
DELETE FROM public.organizations WHERE id = (SELECT id FROM o);
SELECT tests.ok((SELECT count(*) FROM public.organization_members) = 0, 'deleting an organisation removes its members');
ROLLBACK;

-- ── Invitations ────────────────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
CREATE TEMP TABLE t1 ON COMMIT DROP AS SELECT * FROM public.invite_member((SELECT id FROM o), ' Cust2@Test ', 'viewer');
SELECT tests.throws($$SELECT public.invite_member((SELECT id FROM o), 'drv1@test', 'viewer')$$, '23505', 'a member is not invited again');
SELECT tests.login(:drv2);
SELECT tests.throws($$SELECT public.accept_invitation((SELECT token FROM t1))$$, '42501', 'another address cannot use the invitation');
SELECT tests.throws($$SELECT public.accept_invitation('not-a-token')$$, 'P0002', 'an unknown token is refused');
SELECT tests.throws($$SELECT public.revoke_invitation((SELECT invitation_id FROM t1))$$, '42501', 'an outsider cannot revoke');
SELECT tests.login(:cust1);
-- Re-inviting replaces the open invitation; the first token stops working.
CREATE TEMP TABLE t2 ON COMMIT DROP AS SELECT * FROM public.invite_member((SELECT id FROM o), 'cust2@test', 'finance');
SELECT tests.ok((SELECT status FROM public.organization_invitations WHERE id = (SELECT invitation_id FROM t1)) = 'revoked',
  're-inviting revokes the earlier invitation');
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.accept_invitation((SELECT token FROM t1))$$, 'P0002', 'a replaced token no longer works');
SELECT tests.ok((SELECT role FROM public.accept_invitation((SELECT token FROM t2))) = 'finance', 'the invited person joins with the invited role');
SELECT tests.throws($$SELECT public.accept_invitation((SELECT token FROM t2))$$, 'P0002', 'an invitation is used once');
SELECT tests.ok((SELECT role FROM public.profiles WHERE user_id = :cust2 LIMIT 1) = 'customer', 'accepting leaves the profile role alone');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
CREATE TEMP TABLE t ON COMMIT DROP AS SELECT * FROM public.invite_member((SELECT id FROM o), 'apply@test', 'viewer');
RESET ROLE;
UPDATE public.organization_invitations SET expires_at = now() - interval '1 minute' WHERE id = (SELECT invitation_id FROM t);
SET LOCAL ROLE authenticated;
SELECT tests.login(:applic);
SELECT tests.throws($$SELECT public.accept_invitation((SELECT token FROM t))$$, 'P0002', 'an expired invitation is refused');
SELECT tests.login(:cust1);
SELECT public.revoke_invitation((SELECT invitation_id FROM t));
SELECT tests.throws($$SELECT public.revoke_invitation((SELECT invitation_id FROM t))$$, NULL, 'a revoked invitation cannot be revoked again');
ROLLBACK;

-- ── Cross-tenant: an owner of one company has no power over another ──────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;      -- cust1 owns Acme
SELECT tests.login(:cust2);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT id FROM public.create_organization('Beta AS', 'beta');
CREATE TEMP TABLE bi ON COMMIT DROP AS SELECT * FROM public.invite_member((SELECT id FROM b), 'apply@test', 'viewer');
SELECT tests.ok((SELECT count(*) FROM public.organizations) = 1 AND (SELECT slug FROM public.organizations) = 'beta',
  'each owner sees only their own company');
SELECT tests.ok((SELECT count(*) FROM public.organization_invitations) = 1, 'and only their own invitations');
SELECT tests.throws($$SELECT public.invite_member((SELECT id FROM o), 'x@test', 'owner')$$, '42501', 'cannot invite into another company');
SELECT tests.throws($$SELECT public.update_organization((SELECT id FROM o), '{"name":"Taken"}')$$, '42501', 'cannot edit another company');
SELECT tests.throws($$SELECT public.change_member_role((SELECT id FROM o), 'd0000000-0000-0000-0000-000000000001', 'owner')$$,
  '42501', 'cannot change roles in another company');
SELECT tests.throws($$SELECT public.remove_member((SELECT id FROM o), 'd0000000-0000-0000-0000-000000000001')$$,
  '42501', 'cannot remove members of another company');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.revoke_invitation((SELECT invitation_id FROM bi))$$, '42501', 'cannot revoke another company''s invitation');
SELECT tests.ok(NOT public.is_org_member((SELECT id FROM b)), 'membership of one company says nothing about another');
ROLLBACK;

-- ── Pending companies may only set themselves up ──────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
SELECT tests.ok(public.is_org_member((SELECT id FROM o)) AND NOT public.is_active_org_member((SELECT id FROM o)),
  'a pending company''s owner is a member but not an active one');
SELECT tests.login(:admin);
SELECT public.admin_set_organization_status((SELECT id FROM o), 'active', 'verified in Brønnøysund');
SELECT tests.login(:cust1);
SELECT tests.ok(public.is_active_org_member((SELECT id FROM o), ARRAY['owner']), 'after activation the owner is an active member');
SELECT tests.login(:admin);
SELECT public.admin_set_organization_status((SELECT id FROM o), 'suspended', 'test');
SELECT tests.login(:cust1);
SELECT tests.ok(NOT public.is_active_org_member((SELECT id FROM o)), 'suspension ends active membership at once');
ROLLBACK;

-- ── Unconfirmed addresses cannot accept ────────────────────────────────────
BEGIN;
UPDATE auth.users SET email_confirmed_at = NULL WHERE id = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
CREATE TEMP TABLE t ON COMMIT DROP AS SELECT * FROM public.invite_member((SELECT id FROM o), 'apply@test', 'admin');
SELECT tests.login(:applic);
SELECT tests.throws($$SELECT public.accept_invitation((SELECT token FROM t))$$, '42501', 'an unconfirmed address cannot accept');
ROLLBACK;

-- ── The event log is append-only, for the server too ──────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.acme() AS id;
GRANT SELECT ON o TO service_role;
SET LOCAL ROLE service_role;
SELECT tests.login(NULL, 'service_role');
SELECT tests.throws($$UPDATE public.organization_events SET action = 'x'$$, '42501', 'the server cannot edit events');
SELECT tests.throws($$DELETE FROM public.organization_events$$, '42501', 'the server cannot delete events');
RESET ROLE;
SELECT tests.throws($$UPDATE public.organization_events SET actor_id = NULL$$, '42501', 'nor can the database owner');
ROLLBACK;

\echo 'organizations: all tests passed'
