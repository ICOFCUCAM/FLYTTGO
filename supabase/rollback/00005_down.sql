-- ============================================================================
-- Roll back 00005_organizations.sql
-- ============================================================================
-- Run before 00004_down.sql. Tested with the others (supabase/tests/run.sh,
-- variant rollback): afterwards the schema matches production again.
--
-- DATA LOSS: drops every organisation, membership, invitation and the
-- organisation event log. Export them first if any company was set up.
-- Nothing else refers to these tables yet.
-- ============================================================================

DROP FUNCTION IF EXISTS public.accept_invitation(text);
DROP FUNCTION IF EXISTS public.revoke_invitation(uuid);
DROP FUNCTION IF EXISTS public.invite_member(uuid, text, text);
DROP FUNCTION IF EXISTS public.remove_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.change_member_role(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.organization_team(uuid);
DROP FUNCTION IF EXISTS public.admin_set_organization_status(uuid, text, text);
DROP FUNCTION IF EXISTS public.update_organization(uuid, jsonb);
DROP FUNCTION IF EXISTS public.create_organization(text, text, text, text, text);

DROP TABLE IF EXISTS public.organization_events;
DROP TABLE IF EXISTS public.organization_invitations;
DROP TABLE IF EXISTS public.organization_members;
DROP TABLE IF EXISTS public.organizations;

DROP FUNCTION IF EXISTS public.guard_organization_events();
DROP FUNCTION IF EXISTS public.guard_last_owner();
DROP FUNCTION IF EXISTS public.org_event(uuid, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.require_org_role(uuid, text[]);
DROP FUNCTION IF EXISTS public.is_active_org_member(uuid, text[]);
DROP FUNCTION IF EXISTS public.is_org_member(uuid, text[]);
DROP FUNCTION IF EXISTS public.org_role(uuid);
DROP FUNCTION IF EXISTS public.is_reserved_org_slug(text);
DROP FUNCTION IF EXISTS public.is_valid_norwegian_org_number(text);
