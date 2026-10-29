-- ============================================================================
-- FlyttGo — organisations, memberships and invitations
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00004. Step 2 of the corporate
-- portal plan: the tenant foundation. Bookings, the corporate dashboard,
-- billing and white-label come later and build on these tables.
--
-- Rules:
--   * A company is an organisation; people belong to it through
--     organization_members with a company role (owner, admin, booker,
--     finance, viewer). Membership is independent of the person's global
--     profile role (profiles.role) and of any driver subscription: none of
--     these functions reads or changes either.
--   * Row Level Security from the start. Members read their own
--     organisation, its team and (owners/admins) its invitations and
--     events. Nobody writes the tables directly: every change goes
--     through a function below that checks the caller's company role and
--     records an organization_events row.
--   * A new organisation starts 'pending'; a platform administrator
--     activates, suspends or closes it (company onboarding). Until it is
--     active it may only set itself up (details, team, invitations);
--     later features check is_active_org_member(). Suspended and closed
--     organisations cannot invite.
--   * An organisation always keeps at least one active owner.
--   * Invitations carry a random token shown once to the inviter (for the
--     invitation email); only its SHA-256 is stored. Accepting needs the
--     signed-in user's confirmed email to match the invited one, within
--     7 days, once.
--   * The event log is append-only for every role.
--
-- Production already has corporate_accounts and corporate_orders (empty,
-- not in this repository, admin-only since 00003). They are left as they
-- are; organisations replace them for new work (docs/ORGANIZATIONS.md).
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Tables ───────────────────────────────────────────────────────────────

-- Norwegian organisation number: 9 digits, MOD11 check digit
-- (weights 3 2 7 6 5 4 3 2), as Brønnøysundregistrene issues them.
CREATE OR REPLACE FUNCTION public.is_valid_norwegian_org_number(p text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  w int[] := ARRAY[3, 2, 7, 6, 5, 4, 3, 2];
  s int := 0;
  r int;
BEGIN
  IF p IS NULL OR p !~ '^[0-9]{9}$' THEN RETURN false; END IF;
  FOR i IN 1..8 LOOP s := s + substr(p, i, 1)::int * w[i]; END LOOP;
  r := 11 - (s % 11);
  IF r = 11 THEN r := 0; END IF;
  RETURN r <> 10 AND r = substr(p, 9, 1)::int;
END $$;

-- Slugs become subdomains (company.flyttgo.no) in a later step.
CREATE OR REPLACE FUNCTION public.is_reserved_org_slug(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT lower(p) = ANY (ARRAY[
    'www', 'api', 'app', 'admin', 'administrator', 'auth', 'login', 'signin', 'signup',
    'mail', 'email', 'smtp', 'ftp', 'cdn', 'static', 'assets', 'media', 'img',
    'flyttgo', 'support', 'help', 'status', 'docs', 'blog', 'news', 'press',
    'business', 'corporate', 'dashboard', 'driver', 'drivers', 'book', 'booking',
    'track', 'tracking', 'payment', 'payments', 'billing', 'invoice', 'invoices',
    'test', 'staging', 'dev', 'demo'
  ]);
$$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 200),
  slug            text        NOT NULL UNIQUE
                  CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' AND char_length(slug) >= 3
                         AND NOT public.is_reserved_org_slug(slug)),
  country         text        NOT NULL DEFAULT 'NO' CHECK (country ~ '^[A-Z]{2}$'),
  org_number      text,
  vat_registered  boolean     NOT NULL DEFAULT false,
  billing_email   text        CHECK (billing_email IS NULL OR billing_email ~* '^[^@\s]+@[^@\s]+$'),
  billing_address text,
  status          text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  status_reason   text,
  created_by      uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_org_number_valid
    CHECK (org_number IS NULL OR country <> 'NO' OR public.is_valid_norwegian_org_number(org_number))
);
CREATE UNIQUE INDEX IF NOT EXISTS organizations_country_org_number_key
  ON public.organizations (country, org_number) WHERE org_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('owner', 'admin', 'booker', 'finance', 'viewer')),
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  invited_by      uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON public.organization_members (user_id);

CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  email           text        NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+$'),
  role            text        NOT NULL CHECK (role IN ('owner', 'admin', 'booker', 'finance', 'viewer')),
  token_hash      text        NOT NULL UNIQUE,          -- hex SHA-256 of the token
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by      uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_by     uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  accepted_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- One open invitation per address and organisation.
CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_one_pending
  ON public.organization_invitations (organization_id, email) WHERE status = 'pending';

-- Who did what in an organisation. Append-only (guard_organization_events).
CREATE TABLE IF NOT EXISTS public.organization_events (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  actor_id        uuid,
  action          text        NOT NULL,
  subject_user_id uuid,
  details         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_events_org_idx ON public.organization_events (organization_id, created_at DESC);


-- ── 2. Who is what in an organisation ──────────────────────────────────────

-- The caller's active company role in an organisation, or NULL.
CREATE OR REPLACE FUNCTION public.org_role(p_org uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.organization_members
   WHERE organization_id = p_org AND user_id = auth.uid() AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(p_org uuid, p_roles text[] DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
     WHERE organization_id = p_org AND user_id = auth.uid() AND status = 'active'
       AND (p_roles IS NULL OR role = ANY (p_roles)));
$$;

-- As is_org_member, and the organisation is active (verified and
-- activated by the platform). Anything that commits the company or
-- shows its business data (bookings, invoices, credit, API keys) checks
-- this, never is_org_member: a pending, suspended or closed company may
-- only set itself up (details, team, invitations).
CREATE OR REPLACE FUNCTION public.is_active_org_member(p_org uuid, p_roles text[] DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_org_member(p_org, p_roles)
     AND EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org AND status = 'active');
$$;

-- Raise unless the caller has one of the roles (platform admins pass).
CREATE OR REPLACE FUNCTION public.require_org_role(p_org uuid, p_roles text[])
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_role text := public.org_role(p_org);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501';
  END IF;
  IF v_role = ANY (p_roles) THEN RETURN v_role; END IF;
  IF public.is_admin() THEN RETURN 'platform_admin'; END IF;
  RAISE EXCEPTION 'organisation: requires role %', array_to_string(p_roles, ' or ') USING ERRCODE = '42501';
END $$;

CREATE OR REPLACE FUNCTION public.org_event(p_org uuid, p_action text, p_subject uuid, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.organization_events (organization_id, actor_id, action, subject_user_id, details)
  VALUES (p_org, auth.uid(), p_action, p_subject, coalesce(p_details, '{}'::jsonb));
$$;

-- An organisation keeps at least one active owner, however the change
-- is made (functions below, or an administrator in SQL).
CREATE OR REPLACE FUNCTION public.guard_last_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'owner' AND OLD.status = 'active'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.status <> 'active')
     AND EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id)
     AND NOT EXISTS (SELECT 1 FROM public.organization_members
                      WHERE organization_id = OLD.organization_id AND user_id <> OLD.user_id
                        AND role = 'owner' AND status = 'active') THEN
    RAISE EXCEPTION 'organisation: the last owner cannot be removed or changed' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS guard_last_owner ON public.organization_members;
CREATE TRIGGER guard_last_owner
  BEFORE UPDATE OR DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_owner();

-- The event log is never edited, and rows go only with their
-- organisation (deleting an organisation, rather than closing it, takes
-- its log along). Holds for every role, the server's included.
CREATE OR REPLACE FUNCTION public.guard_organization_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     OR EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN
    RAISE EXCEPTION 'organisation events are append-only' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS guard_organization_events ON public.organization_events;
CREATE TRIGGER guard_organization_events
  BEFORE UPDATE OR DELETE ON public.organization_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_organization_events();


-- ── 3. Row Level Security (reads only; writes through the functions) ──────
ALTER TABLE public.organizations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_events      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_member_select ON public.organizations;
CREATE POLICY organizations_member_select ON public.organizations
  FOR SELECT TO authenticated USING (public.is_org_member(id) OR public.is_admin());

DROP POLICY IF EXISTS organization_members_select ON public.organization_members;
CREATE POLICY organization_members_select ON public.organization_members
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id) OR public.is_admin());

DROP POLICY IF EXISTS organization_invitations_select ON public.organization_invitations;
CREATE POLICY organization_invitations_select ON public.organization_invitations
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, ARRAY['owner', 'admin']) OR public.is_admin());

DROP POLICY IF EXISTS organization_events_select ON public.organization_events;
CREATE POLICY organization_events_select ON public.organization_events
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, ARRAY['owner', 'admin']) OR public.is_admin());

-- No table privileges for writes either (defence in depth: RLS has no
-- write policy, and the API roles cannot write even if one is added).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organizations, public.organization_members,
  public.organization_invitations, public.organization_events FROM anon, authenticated;
REVOKE ALL ON public.organizations, public.organization_members,
  public.organization_invitations, public.organization_events FROM anon;
GRANT SELECT ON public.organizations, public.organization_members,
  public.organization_invitations, public.organization_events TO authenticated;
GRANT ALL ON public.organizations, public.organization_members,
  public.organization_invitations, public.organization_events TO service_role;


-- ── 4. Organisations ───────────────────────────────────────────────────────

-- Any signed-in person may register a company; they become its owner.
-- It starts 'pending' until a platform administrator activates it.
CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text, p_slug text, p_org_number text DEFAULT NULL,
  p_billing_email text DEFAULT NULL, p_country text DEFAULT 'NO')
RETURNS public.organizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org public.organizations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.organizations (name, slug, org_number, billing_email, country, created_by)
  VALUES (btrim(p_name), lower(btrim(p_slug)), nullif(regexp_replace(coalesce(p_org_number, ''), '\s', '', 'g'), ''),
          nullif(lower(btrim(coalesce(p_billing_email, ''))), ''), upper(coalesce(p_country, 'NO')), auth.uid())
  RETURNING * INTO v_org;
  INSERT INTO public.organization_members (organization_id, user_id, role, invited_by)
  VALUES (v_org.id, auth.uid(), 'owner', NULL);
  PERFORM public.org_event(v_org.id, 'organization.created', auth.uid(),
                           jsonb_build_object('name', v_org.name, 'slug', v_org.slug));
  RETURN v_org;
END $$;

-- Owners and admins edit the company details; only owners change the
-- slug (it will be the subdomain) and the organisation number. Status
-- is the platform's (admin_set_organization_status).
CREATE OR REPLACE FUNCTION public.update_organization(p_org uuid, p_changes jsonb)
RETURNS public.organizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role text := public.require_org_role(p_org, ARRAY['owner', 'admin']);
  v_org  public.organizations%ROWTYPE;
  k      text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) LOOP
    IF k NOT IN ('name', 'billing_email', 'billing_address', 'vat_registered', 'slug', 'org_number') THEN
      RAISE EXCEPTION 'organisation: % cannot be changed here', k USING ERRCODE = '42501';
    END IF;
    IF k IN ('slug', 'org_number') AND v_role NOT IN ('owner', 'platform_admin') THEN
      RAISE EXCEPTION 'organisation: only an owner changes %', k USING ERRCODE = '42501';
    END IF;
  END LOOP;
  UPDATE public.organizations o SET
    name            = coalesce(btrim(p_changes ->> 'name'), o.name),
    billing_email   = CASE WHEN p_changes ? 'billing_email' THEN nullif(lower(btrim(p_changes ->> 'billing_email')), '') ELSE o.billing_email END,
    billing_address = CASE WHEN p_changes ? 'billing_address' THEN p_changes ->> 'billing_address' ELSE o.billing_address END,
    vat_registered  = coalesce((p_changes ->> 'vat_registered')::boolean, o.vat_registered),
    slug            = coalesce(lower(btrim(p_changes ->> 'slug')), o.slug),
    org_number      = CASE WHEN p_changes ? 'org_number' THEN nullif(regexp_replace(p_changes ->> 'org_number', '\s', '', 'g'), '') ELSE o.org_number END,
    updated_at      = now()
   WHERE o.id = p_org
  RETURNING * INTO v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.org_event(p_org, 'organization.updated', NULL, p_changes);
  RETURN v_org;
END $$;

-- Company onboarding by the platform.
CREATE OR REPLACE FUNCTION public.admin_set_organization_status(p_org uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS public.organizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org public.organizations%ROWTYPE; v_old text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'organisation status: platform administrators only' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_old FROM public.organizations WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.organizations SET status = p_status, status_reason = p_reason, updated_at = now()
   WHERE id = p_org RETURNING * INTO v_org;
  PERFORM public.org_event(p_org, 'organization.status', NULL,
                           jsonb_build_object('from', v_old, 'to', p_status, 'reason', p_reason));
  RETURN v_org;
END $$;


-- ── 5. Team ────────────────────────────────────────────────────────────────

-- The team as members see it: names and email from the profiles, which a
-- member could not read directly (profiles are self-only).
CREATE OR REPLACE FUNCTION public.organization_team(p_org uuid)
RETURNS TABLE (user_id uuid, role text, status text, first_name text, last_name text, email text, joined_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.user_id, m.role, m.status, p.first_name, p.last_name, coalesce(p.email, u.email), m.created_at
    FROM public.organization_members m
    LEFT JOIN auth.users u ON u.id = m.user_id
    -- Production's profiles has no unique user_id: take the newest.
    LEFT JOIN LATERAL (SELECT pr.first_name, pr.last_name, pr.email FROM public.profiles pr
                        WHERE pr.user_id = m.user_id ORDER BY pr.created_at DESC NULLS LAST LIMIT 1) p ON true
   WHERE m.organization_id = p_org
     AND (public.is_org_member(p_org) OR public.is_admin())
   ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at;
$$;

-- Owners may set any role; admins may manage bookers, finance and
-- viewers but not owners or other admins.
CREATE OR REPLACE FUNCTION public.change_member_role(p_org uuid, p_user uuid, p_role text)
RETURNS public.organization_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role text := public.require_org_role(p_org, ARRAY['owner', 'admin']);
  v_old  public.organization_members%ROWTYPE;
  v_new  public.organization_members%ROWTYPE;
BEGIN
  SELECT * INTO v_old FROM public.organization_members WHERE organization_id = p_org AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organisation: not a member' USING ERRCODE = 'P0002'; END IF;
  IF v_role = 'admin' AND (v_old.role IN ('owner', 'admin') OR p_role IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'organisation: only an owner manages owners and admins' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organization_members SET role = p_role, updated_at = now()
   WHERE organization_id = p_org AND user_id = p_user RETURNING * INTO v_new;
  PERFORM public.org_event(p_org, 'member.role', p_user, jsonb_build_object('from', v_old.role, 'to', p_role));
  RETURN v_new;
END $$;

-- Owners/admins remove members (admins only below admin); anyone may
-- leave. The last owner cannot go (guard_last_owner).
CREATE OR REPLACE FUNCTION public.remove_member(p_org uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_target text; v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_target FROM public.organization_members WHERE organization_id = p_org AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'organisation: not a member' USING ERRCODE = 'P0002'; END IF;
  IF p_user <> auth.uid() THEN
    v_role := public.require_org_role(p_org, ARRAY['owner', 'admin']);
    IF v_role = 'admin' AND v_target IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'organisation: only an owner removes owners and admins' USING ERRCODE = '42501';
    END IF;
  END IF;
  DELETE FROM public.organization_members WHERE organization_id = p_org AND user_id = p_user;
  PERFORM public.org_event(p_org, CASE WHEN p_user = auth.uid() THEN 'member.left' ELSE 'member.removed' END,
                           p_user, jsonb_build_object('role', v_target));
END $$;


-- ── 6. Invitations ─────────────────────────────────────────────────────────

-- Returns the invitation and its token. The token is shown once, here,
-- for the invitation link; only its hash is kept.
CREATE OR REPLACE FUNCTION public.invite_member(p_org uuid, p_email text, p_role text)
RETURNS TABLE (invitation_id uuid, token text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role   text := public.require_org_role(p_org, ARRAY['owner', 'admin']);
  v_status text;
  v_email  text := lower(btrim(p_email));
  v_token  text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_inv    public.organization_invitations%ROWTYPE;
BEGIN
  SELECT status INTO v_status FROM public.organizations WHERE id = p_org;
  IF v_status NOT IN ('pending', 'active') THEN
    RAISE EXCEPTION 'organisation is %; it cannot invite', v_status USING ERRCODE = '42501';
  END IF;
  IF v_role = 'admin' AND p_role IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'organisation: only an owner invites owners and admins' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_members m JOIN auth.users u ON u.id = m.user_id
              WHERE m.organization_id = p_org AND lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'organisation: % is already a member', v_email USING ERRCODE = '23505';
  END IF;
  -- A new invitation for the same address replaces the open one.
  UPDATE public.organization_invitations SET status = 'revoked'
   WHERE organization_id = p_org AND email = v_email AND status = 'pending';
  INSERT INTO public.organization_invitations (organization_id, email, role, token_hash, invited_by)
  VALUES (p_org, v_email, p_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid())
  RETURNING * INTO v_inv;
  PERFORM public.org_event(p_org, 'invitation.created', NULL, jsonb_build_object('email', v_email, 'role', p_role));
  RETURN QUERY SELECT v_inv.id, v_token, v_inv.expires_at;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_invitation(p_invitation uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv public.organization_invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM public.organization_invitations WHERE id = p_invitation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.require_org_role(v_inv.organization_id, ARRAY['owner', 'admin']);
  IF v_inv.status <> 'pending' THEN RAISE EXCEPTION 'invitation is already %', v_inv.status; END IF;
  UPDATE public.organization_invitations SET status = 'revoked' WHERE id = p_invitation;
  PERFORM public.org_event(v_inv.organization_id, 'invitation.revoked', NULL, jsonb_build_object('email', v_inv.email));
END $$;

-- The invited person, signed in with the invited address, joins with the
-- invited role. Their global role and any driver plan are untouched.
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text)
RETURNS public.organization_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv    public.organization_invitations%ROWTYPE;
  v_email  text;
  v_member public.organization_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_inv FROM public.organization_invitations
   WHERE token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') FOR UPDATE;
  IF NOT FOUND OR v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'invitation not found or no longer valid' USING ERRCODE = 'P0002';
  END IF;
  IF v_inv.expires_at < now() THEN
    RAISE EXCEPTION 'invitation has expired' USING ERRCODE = 'P0002';
  END IF;
  -- Only a confirmed address counts: otherwise anyone could sign up with
  -- the invited address (if email confirmation is off) and take the seat.
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'confirm your email address before accepting an invitation' USING ERRCODE = '42501';
  END IF;
  IF v_email IS DISTINCT FROM v_inv.email THEN
    RAISE EXCEPTION 'invitation is for another email address' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_inv.organization_id AND status IN ('pending', 'active')) THEN
    RAISE EXCEPTION 'organisation cannot accept members now' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.organization_members (organization_id, user_id, role, invited_by)
  VALUES (v_inv.organization_id, auth.uid(), v_inv.role, v_inv.invited_by)
  ON CONFLICT (organization_id, user_id) DO NOTHING
  RETURNING * INTO v_member;
  IF NOT FOUND THEN RAISE EXCEPTION 'already a member of this organisation' USING ERRCODE = '23505'; END IF;
  UPDATE public.organization_invitations SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
   WHERE id = v_inv.id;
  PERFORM public.org_event(v_inv.organization_id, 'invitation.accepted', auth.uid(), jsonb_build_object('role', v_inv.role));
  RETURN v_member;
END $$;


-- ── 7. Privileges ──────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.org_role(uuid)', 'public.is_org_member(uuid, text[])', 'public.require_org_role(uuid, text[])',
    'public.org_event(uuid, text, uuid, jsonb)', 'public.guard_last_owner()', 'public.guard_organization_events()',
    'public.is_active_org_member(uuid, text[])',
    'public.create_organization(text, text, text, text, text)', 'public.update_organization(uuid, jsonb)',
    'public.admin_set_organization_status(uuid, text, text)', 'public.organization_team(uuid)',
    'public.change_member_role(uuid, uuid, text)', 'public.remove_member(uuid, uuid)',
    'public.invite_member(uuid, text, text)', 'public.revoke_invitation(uuid)', 'public.accept_invitation(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.org_role(uuid), public.is_org_member(uuid, text[]), public.is_active_org_member(uuid, text[]),
  public.create_organization(text, text, text, text, text), public.update_organization(uuid, jsonb),
  public.admin_set_organization_status(uuid, text, text), public.organization_team(uuid),
  public.change_member_role(uuid, uuid, text), public.remove_member(uuid, uuid),
  public.invite_member(uuid, text, text), public.revoke_invitation(uuid), public.accept_invitation(text)
  TO authenticated, service_role;
-- Internal helpers: not API endpoints.
REVOKE ALL ON FUNCTION public.require_org_role(uuid, text[]), public.org_event(uuid, text, uuid, jsonb),
  public.guard_last_owner(), public.guard_organization_events() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_norwegian_org_number(text), public.is_reserved_org_slug(text)
  TO anon, authenticated, service_role;

-- ============================================================================
-- DONE
-- ============================================================================
