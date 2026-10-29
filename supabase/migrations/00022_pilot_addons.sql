-- ============================================================================
-- FlyttGo — pilot pricing, add-on modules, the API add-on, approval checks
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00021. The owner's decisions of
-- 2026-10-29 (docs/DECISIONS.md #39–#44, docs/RELEASE_GATES.md):
--
--   * Pilot pricing. A plan's prices are proposed, confirmed, or now pilot:
--     accepted provisionally by FlyttGo for the pilot (price_status, as in
--     00009, with the note that says so). Restaurant, Hotel and Online shop
--     start as pilot prices if their prices are still the proposed ones.
--     What the set-up fee includes is stated with the plan
--     (setup_fee_includes).
--   * Add-on modules. One primary plan per company (organization_white_label,
--     as before) and optional modules on it (organization_addons), enabled
--     and ended by FlyttGo's administrators only, each priced by a written
--     quote or by a pilot price approved and recorded with it; no price is
--     ever derived. org_has_module() counts an active add-on while the
--     company and its primary plan are active, so every existing check of a
--     module (RLS, the module functions, the dashboard) works unchanged.
--     org_modules() lists them for the company's page.
--   * API access is the add-on 'api'. Without it no key is created or
--     changed, and every call is refused (api_key_refusal: api_not_enabled).
--     The booking widget needs no add-on. A key is revoked at once when its
--     creator leaves the company, is suspended or loses the owner or admin
--     role (trigger on organization_members, logged in api_events); the
--     check at each use stays.
--   * Approval of company bookings (00017): an approval is for exactly the
--     amount approved. When the server's price differs, the booking needs a
--     new request (reason price_changed); approval never changes the
--     amount. The approver may pass the amount they saw: if the request has
--     changed since, the decision is refused. Approving re-reads the
--     approver's membership and the request, under lock, at that moment.
--
-- Safe to re-run. Rolled back by supabase/rollback/00022_down.sql.
-- ============================================================================


-- ── 1. Pilot pricing ────────────────────────────────────────────────────────
ALTER TABLE public.white_label_plans ADD COLUMN IF NOT EXISTS price_note text
  CHECK (price_note IS NULL OR char_length(btrim(price_note)) BETWEEN 1 AND 500);
ALTER TABLE public.white_label_plans ADD COLUMN IF NOT EXISTS setup_fee_includes text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.white_label_plans'::regclass
               AND conname = 'white_label_plans_price_status_check'
               AND pg_get_constraintdef(oid) NOT LIKE '%pilot%') THEN
    ALTER TABLE public.white_label_plans DROP CONSTRAINT white_label_plans_price_status_check;
    ALTER TABLE public.white_label_plans ADD CONSTRAINT white_label_plans_price_status_check
      CHECK (price_status IN ('proposed', 'pilot', 'confirmed'));
  END IF;
END $$;

-- The owner's decision of 2026-10-29: these three, at the prices proposed
-- in 00019 and 00020, are accepted provisionally for the pilot. A price
-- FlyttGo has changed or confirmed since is left as it is.
UPDATE public.white_label_plans p SET
       price_status = 'pilot',
       price_note = 'Pilot pricing: accepted provisionally by FlyttGo for the pilot (owner''s decision 2026-10-29). The price that applies is the one in your agreement.',
       updated_at = now()
  FROM (VALUES ('restaurant', 2900::numeric, 990::numeric), ('hotel', 4900, 1490), ('shop', 2900, 990)) AS v(code, setup_fee, monthly_fee)
 WHERE p.code = v.code AND p.price_status = 'proposed' AND p.setup_fee = v.setup_fee AND p.monthly_fee = v.monthly_fee;
UPDATE public.white_label_plans
   SET setup_fee_includes = ARRAY['Branding: your name, logo and colours on your page and website',
                                  'Configuration of the booking or shop module and your invoice settings',
                                  'Content preparation: your website from the template library with your texts and pictures',
                                  'Publication: your page and website put live once FlyttGo has checked them']
 WHERE code IN ('restaurant', 'hotel', 'shop') AND setup_fee_includes = '{}';

-- FlyttGo sets a plan's prices. Changed prices are proposals until
-- confirmed or accepted as pilot prices (admin_set_white_label_pilot_price);
-- a change or a confirmation clears the pilot note.
CREATE OR REPLACE FUNCTION public.admin_update_white_label_plan(
  p_code text, p_setup_fee numeric, p_monthly_fee numeric, p_platform_fee_pct numeric, p_platform_fee_min numeric,
  p_active boolean, p_confirm boolean)
RETURNS public.white_label_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p public.white_label_plans%ROWTYPE; v_changed boolean;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'white label: platform administrators only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.white_label_plans WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: no such plan' USING ERRCODE = 'P0002'; END IF;
  IF p.is_default AND p_active IS FALSE THEN
    RAISE EXCEPTION 'white label: the default plan stays offered' USING ERRCODE = '55000';
  END IF;
  v_changed := (p.setup_fee, p.monthly_fee, p.platform_fee_pct, p.platform_fee_min)
               IS DISTINCT FROM (coalesce(p_setup_fee, p.setup_fee), coalesce(p_monthly_fee, p.monthly_fee),
                                 coalesce(p_platform_fee_pct, p.platform_fee_pct), coalesce(p_platform_fee_min, p.platform_fee_min));
  UPDATE public.white_label_plans SET
    setup_fee        = coalesce(p_setup_fee, setup_fee),
    monthly_fee      = coalesce(p_monthly_fee, monthly_fee),
    platform_fee_pct = coalesce(p_platform_fee_pct, platform_fee_pct),
    platform_fee_min = coalesce(p_platform_fee_min, platform_fee_min),
    active           = coalesce(p_active, active),
    price_status     = CASE WHEN p_confirm THEN 'confirmed' WHEN v_changed THEN 'proposed' ELSE price_status END,
    prices_confirmed_by = CASE WHEN p_confirm THEN auth.uid() WHEN v_changed THEN NULL ELSE prices_confirmed_by END,
    prices_confirmed_at = CASE WHEN p_confirm THEN now() WHEN v_changed THEN NULL ELSE prices_confirmed_at END,
    price_note       = CASE WHEN p_confirm OR v_changed THEN NULL ELSE price_note END,
    updated_at       = now()
   WHERE code = p_code RETURNING * INTO p;
  RETURN p;
END $$;

-- FlyttGo accepts a plan's current prices provisionally for the pilot,
-- with a note shown beside them (who and when are recorded as for a
-- confirmation).
CREATE OR REPLACE FUNCTION public.admin_set_white_label_pilot_price(p_code text, p_note text)
RETURNS public.white_label_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p public.white_label_plans%ROWTYPE; v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'white label: platform administrators only' USING ERRCODE = '42501'; END IF;
  IF v_note IS NULL THEN RAISE EXCEPTION 'white label: say what the pilot price is (shown beside it)' USING ERRCODE = '22023'; END IF;
  UPDATE public.white_label_plans
     SET price_status = 'pilot', price_note = v_note, prices_confirmed_by = auth.uid(), prices_confirmed_at = now(), updated_at = now()
   WHERE code = p_code RETURNING * INTO p;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: no such plan' USING ERRCODE = 'P0002'; END IF;
  RETURN p;
END $$;


-- ── 2. Add-on modules ───────────────────────────────────────────────────────
-- The modules a company can add to its primary plan.
CREATE OR REPLACE FUNCTION public.addon_modules()
RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT ARRAY['jobs', 'appointments', 'restaurant_reservations', 'hotel_reservations', 'shop', 'sales_invoicing', 'api']; $$;

CREATE TABLE IF NOT EXISTS public.organization_addons (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  module          text        NOT NULL CHECK (module = ANY (public.addon_modules())),
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  -- How it is priced: by a written quote (its reference), or at a pilot
  -- price FlyttGo approved for this company (recorded here). Never derived
  -- from the plans' prices. Fees exclude MVA.
  pricing         text        NOT NULL CHECK (pricing IN ('quote', 'pilot')),
  setup_fee       numeric     CHECK (setup_fee IS NULL OR setup_fee >= 0),
  monthly_fee     numeric     CHECK (monthly_fee IS NULL OR monthly_fee >= 0),
  quote_reference text        CHECK (quote_reference IS NULL OR char_length(btrim(quote_reference)) BETWEEN 1 AND 120),
  price_note      text        CHECK (price_note IS NULL OR char_length(btrim(price_note)) BETWEEN 1 AND 500),
  enabled_by      uuid        NOT NULL,
  enabled_at      timestamptz NOT NULL DEFAULT now(),
  ended_by        uuid,
  ended_at        timestamptz,
  end_reason      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_addons_quote CHECK (pricing <> 'quote' OR quote_reference IS NOT NULL),
  CONSTRAINT organization_addons_pilot CHECK (pricing <> 'pilot' OR (monthly_fee IS NOT NULL AND price_note IS NOT NULL)),
  CONSTRAINT organization_addons_ended CHECK ((status = 'ended') = (ended_at IS NOT NULL))
);
-- One active add-on per module and company; ended ones are kept.
CREATE UNIQUE INDEX IF NOT EXISTS organization_addons_active_idx
  ON public.organization_addons (organization_id, module) WHERE status = 'active';

ALTER TABLE public.organization_addons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_addons_select ON public.organization_addons;
CREATE POLICY organization_addons_select ON public.organization_addons FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
REVOKE ALL ON public.organization_addons FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organization_addons FROM authenticated;
GRANT SELECT ON public.organization_addons TO authenticated;
GRANT ALL ON public.organization_addons TO service_role;

-- What a company can use now: the modules of its active plan and its
-- active add-ons, while the company and the plan are active. The API
-- add-on needs no plan: a company that books moves for itself (00007) can
-- connect its own systems too.
CREATE OR REPLACE FUNCTION public.org_modules(p_org uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(array_agg(DISTINCT m ORDER BY m), '{}'::text[]) FROM (
    SELECT unnest(p.modules) AS m
      FROM public.organization_white_label w
      JOIN public.white_label_plans p ON p.code = w.plan_code
      JOIN public.organizations o ON o.id = w.organization_id
     WHERE w.organization_id = p_org AND w.status = 'active' AND o.status = 'active'
    UNION
    SELECT a.module
      FROM public.organization_addons a
      JOIN public.organizations o ON o.id = a.organization_id
     WHERE a.organization_id = p_org AND a.status = 'active' AND o.status = 'active'
       AND (a.module = 'api' OR EXISTS (SELECT 1 FROM public.organization_white_label w
                                          WHERE w.organization_id = a.organization_id AND w.status = 'active'))) s;
$$;

-- The one check for a module: the company is active and its active plan,
-- or an active add-on on it, includes it.
CREATE OR REPLACE FUNCTION public.org_has_module(p_org uuid, p_module text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_module = ANY (public.org_modules(p_org));
$$;

-- FlyttGo enables an add-on on a company's active plan (the API also for
-- an active company without one), priced by a written quote
-- (p_quote_reference) or a pilot price it approves now (p_monthly_fee and
-- a note). Logged in the company's log.
CREATE OR REPLACE FUNCTION public.admin_enable_addon(p_org uuid, p_module text, p_pricing text, p_setup_fee numeric,
                                                     p_monthly_fee numeric, p_quote_reference text, p_price_note text)
RETURNS public.organization_addons
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  w public.organization_white_label%ROWTYPE;
  p public.white_label_plans%ROWTYPE;
  o public.organizations%ROWTYPE;
  a public.organization_addons%ROWTYPE;
  v_quote text := nullif(btrim(coalesce(p_quote_reference, '')), '');
  v_note  text := nullif(btrim(coalesce(p_price_note, '')), '');
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'add-ons: FlyttGo''s administrators enable them' USING ERRCODE = '42501'; END IF;
  IF p_module IS NULL OR NOT p_module = ANY (public.addon_modules()) THEN
    RAISE EXCEPTION 'add-ons: unknown module % (modules: %)', coalesce(p_module, 'null'), array_to_string(public.addon_modules(), ', ')
      USING ERRCODE = '22023';
  END IF;
  IF p_pricing IS NULL OR p_pricing NOT IN ('quote', 'pilot') THEN
    RAISE EXCEPTION 'add-ons: priced by a written quote or an approved pilot price' USING ERRCODE = '22023';
  END IF;
  IF p_pricing = 'quote' AND v_quote IS NULL THEN
    RAISE EXCEPTION 'add-ons: give the written quote''s reference' USING ERRCODE = '22023';
  END IF;
  IF p_pricing = 'pilot' AND (p_monthly_fee IS NULL OR v_note IS NULL) THEN
    RAISE EXCEPTION 'add-ons: a pilot price needs the monthly fee approved and a note saying so' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.organizations WHERE id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'add-ons: no such company' USING ERRCODE = 'P0002'; END IF;
  IF o.status <> 'active' THEN RAISE EXCEPTION 'add-ons: the company must be active' USING ERRCODE = '55000'; END IF;
  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org FOR UPDATE;
  IF (NOT FOUND OR w.status <> 'active') AND p_module <> 'api' THEN
    RAISE EXCEPTION 'add-ons: an add-on goes on the company''s active plan, and it has none' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO p FROM public.white_label_plans WHERE code = w.plan_code AND w.status = 'active';
  IF p_module = ANY (coalesce(p.modules, '{}')) THEN
    RAISE EXCEPTION 'add-ons: the plan % already includes %', p.name, p_module USING ERRCODE = '55000';
  END IF;
  -- FlyttGo sells only moving and delivery (00010): on a plan where it is
  -- the seller, the only add-on is the API.
  IF p.seller_model IS DISTINCT FROM 'company' AND p_module <> 'api' THEN
    RAISE EXCEPTION 'add-ons: on % FlyttGo is the seller, so it carries no other industry''s module; choose a plan where the company sells', p.name
      USING ERRCODE = '55000';
  END IF;
  IF p_module = 'appointments' AND o.industry = 'health' THEN
    RAISE EXCEPTION 'add-ons: no Appointments for health (patient data)' USING ERRCODE = '55000';
  END IF;
  IF p_module = 'shop' AND NOT (w.stripe_account_id IS NOT NULL AND w.stripe_charges_enabled) THEN
    RAISE EXCEPTION 'add-ons: a shop takes card payments into the company''s own Stripe account; connect it first' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_addons WHERE organization_id = p_org AND module = p_module AND status = 'active') THEN
    RAISE EXCEPTION 'add-ons: % is already enabled for this company', p_module USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.organization_addons (organization_id, module, pricing, setup_fee, monthly_fee, quote_reference, price_note, enabled_by)
  VALUES (p_org, p_module, p_pricing, p_setup_fee, p_monthly_fee, v_quote, v_note, auth.uid())
  RETURNING * INTO a;
  PERFORM public.org_event(p_org, 'addon.enabled', NULL, jsonb_build_object('module', p_module, 'pricing', p_pricing,
    'setup_fee', p_setup_fee, 'monthly_fee', p_monthly_fee, 'quote_reference', v_quote, 'price_note', v_note));
  RETURN a;
END $$;

-- FlyttGo ends an add-on, with a reason. The record stays.
CREATE OR REPLACE FUNCTION public.admin_end_addon(p_org uuid, p_module text, p_reason text)
RETURNS public.organization_addons
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE a public.organization_addons%ROWTYPE; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'add-ons: FlyttGo''s administrators end them' USING ERRCODE = '42501'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'add-ons: give a reason' USING ERRCODE = '22023'; END IF;
  UPDATE public.organization_addons
     SET status = 'ended', ended_by = auth.uid(), ended_at = now(), end_reason = v_reason, updated_at = now()
   WHERE organization_id = p_org AND module = p_module AND status = 'active'
  RETURNING * INTO a;
  IF NOT FOUND THEN RAISE EXCEPTION 'add-ons: % is not enabled for this company', p_module USING ERRCODE = 'P0002'; END IF;
  PERFORM public.org_event(p_org, 'addon.ended', NULL, jsonb_build_object('module', p_module, 'reason', v_reason));
  RETURN a;
END $$;


-- ── 3. API access: the 'api' add-on ─────────────────────────────────────────
-- Why a key may not be used for a scope now, or NULL when it may.
CREATE OR REPLACE FUNCTION public.api_key_refusal(k public.api_keys, p_scope text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE
    WHEN k.id IS NULL THEN 'invalid_key'
    WHEN k.revoked_at IS NOT NULL THEN 'key_revoked'
    WHEN k.expires_at IS NOT NULL AND k.expires_at <= now() THEN 'key_expired'
    WHEN NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = k.organization_id AND o.status = 'active') THEN 'organization_inactive'
    WHEN NOT public.org_has_module(k.organization_id, 'api') THEN 'api_not_enabled'
    WHEN NOT EXISTS (SELECT 1 FROM public.organization_members m
                      WHERE m.organization_id = k.organization_id AND m.user_id = k.created_by
                        AND m.status = 'active' AND m.role IN ('owner', 'admin')) THEN 'creator_not_member'
    WHEN p_scope IS NOT NULL AND NOT p_scope = ANY (k.scopes) THEN 'scope_missing'
    WHEN p_scope IS NOT NULL AND NOT public.api_scope_available(k.organization_id, p_scope) THEN 'scope_unavailable'
  END;
$$;

CREATE OR REPLACE FUNCTION public.api_refusal_message(p_code text, p_scope text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_code
    WHEN 'invalid_key'           THEN 'The API key is not valid.'
    WHEN 'key_revoked'           THEN 'The API key has been revoked.'
    WHEN 'key_expired'           THEN 'The API key has expired.'
    WHEN 'organization_inactive' THEN 'The company is not active on FlyttGo, so its keys do not work.'
    WHEN 'api_not_enabled'       THEN 'API access is an add-on FlyttGo enables for the company, and it is not enabled.'
    WHEN 'creator_not_member'    THEN 'The member who created this key is no longer an owner or admin of the company: create a new key.'
    WHEN 'scope_missing'         THEN 'The API key does not have the scope ' || coalesce(p_scope, '') || '.'
    WHEN 'scope_unavailable'     THEN 'The company''s plan or terms do not include ' || coalesce(p_scope, '') || ' now.'
    WHEN 'rate_limited'          THEN 'Too many requests for this key: wait for the next minute.'
  END;
$$;

-- Returns the key once: {id, key, prefix, name, scopes, expires_at}.
-- Only with the API add-on.
CREATE OR REPLACE FUNCTION public.create_api_key(p_org uuid, p_name text, p_scopes text[], p_expires_at timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_scopes text[];
  v_key    text;
  k        public.api_keys%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_active_org_member(p_org, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'API keys: only an owner or admin of an active company creates keys' USING ERRCODE = '42501';
  END IF;
  IF NOT public.org_has_module(p_org, 'api') THEN
    RAISE EXCEPTION 'API keys: API access is an add-on FlyttGo enables for the company; ask FlyttGo for it' USING ERRCODE = '55000';
  END IF;
  IF coalesce(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'API keys: give the key a name' USING ERRCODE = '22023'; END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'API keys: the expiry must be in the future' USING ERRCODE = '22023';
  END IF;
  v_scopes := public.api_checked_scopes(p_org, p_scopes);
  PERFORM pg_advisory_xact_lock(hashtext('api_keys:' || p_org::text));
  IF (SELECT count(*) FROM public.api_keys WHERE organization_id = p_org AND revoked_at IS NULL) >= 20 THEN
    RAISE EXCEPTION 'API keys: at most 20 keys per company; revoke one first' USING ERRCODE = '55000';
  END IF;
  -- 64 random hex characters (two gen_random_uuid()s, 244 bits), as for invitations.
  v_key := 'fgo_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.api_keys (organization_id, name, prefix, key_hash, scopes, created_by, expires_at)
  VALUES (p_org, btrim(p_name), left(v_key, 12), encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), v_scopes, auth.uid(), p_expires_at)
  RETURNING * INTO k;
  PERFORM public.api_event(p_org, k.id, auth.uid(), 'key.created',
    jsonb_build_object('name', k.name, 'prefix', k.prefix, 'scopes', k.scopes, 'expires_at', k.expires_at));
  RETURN jsonb_build_object('id', k.id, 'key', v_key, 'prefix', k.prefix, 'name', k.name, 'scopes', k.scopes,
                            'expires_at', k.expires_at, 'rate_limit_per_minute', k.rate_limit_per_minute);
END $$;

-- Rename a key or change its scopes (with the API add-on). It keeps
-- acting as its creator.
CREATE OR REPLACE FUNCTION public.update_api_key(p_key uuid, p_name text, p_scopes text[])
RETURNS public.api_keys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE k public.api_keys%ROWTYPE; v_scopes text[];
BEGIN
  SELECT * INTO k FROM public.api_keys WHERE id = p_key FOR UPDATE;
  IF NOT FOUND OR NOT public.is_active_org_member(k.organization_id, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'API keys: only an owner or admin of the key''s active company changes it' USING ERRCODE = '42501';
  END IF;
  IF k.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'API keys: this key is revoked' USING ERRCODE = '55000'; END IF;
  IF NOT public.org_has_module(k.organization_id, 'api') THEN
    RAISE EXCEPTION 'API keys: API access is an add-on FlyttGo enables for the company; ask FlyttGo for it' USING ERRCODE = '55000';
  END IF;
  IF coalesce(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'API keys: give the key a name' USING ERRCODE = '22023'; END IF;
  v_scopes := public.api_checked_scopes(k.organization_id, p_scopes);
  UPDATE public.api_keys SET name = btrim(p_name), scopes = v_scopes WHERE id = p_key RETURNING * INTO k;
  PERFORM public.api_event(k.organization_id, k.id, auth.uid(), 'key.updated', jsonb_build_object('name', k.name, 'scopes', k.scopes));
  RETURN k;
END $$;

-- A key acts as its creator, so it is revoked the moment the creator is
-- no longer an active owner or admin of its company: removed, left,
-- suspended or given another role, however that happens (the functions,
-- an administrator in SQL, a deleted account). Logged in api_events.
CREATE OR REPLACE FUNCTION public.revoke_api_keys_of_former_admin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE k record; v_why text;
BEGIN
  IF NOT (OLD.status = 'active' AND OLD.role IN ('owner', 'admin')) THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'active' AND NEW.role IN ('owner', 'admin') THEN RETURN NULL; END IF;
  -- The whole company is being deleted: its keys go with it.
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN RETURN NULL; END IF;
  v_why := CASE WHEN TG_OP = 'DELETE' THEN 'creator_removed'
                WHEN NEW.status <> 'active' THEN 'creator_suspended'
                ELSE 'creator_role_changed' END;
  FOR k IN
    UPDATE public.api_keys
       SET revoked_at = now(), revoked_by = auth.uid(),
           revoked_reason = CASE v_why WHEN 'creator_removed' THEN 'Revoked automatically: its creator is no longer a member of the company'
                                       WHEN 'creator_suspended' THEN 'Revoked automatically: its creator''s membership was suspended'
                                       ELSE 'Revoked automatically: its creator is no longer an owner or admin' END
     WHERE organization_id = OLD.organization_id AND created_by = OLD.user_id AND revoked_at IS NULL
    RETURNING id, revoked_reason
  LOOP
    PERFORM public.api_event(OLD.organization_id, k.id, auth.uid(), 'key.revoked',
      jsonb_build_object('reason', k.revoked_reason, 'automatic', true, 'cause', v_why,
                         'creator', OLD.user_id, 'role', CASE WHEN TG_OP = 'UPDATE' THEN NEW.role END));
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS revoke_api_keys_of_former_admin ON public.organization_members;
CREATE TRIGGER revoke_api_keys_of_former_admin
  AFTER UPDATE OR DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.revoke_api_keys_of_former_admin();


-- ── 4. Approval of company bookings: for exactly the amount approved ────────
CREATE OR REPLACE FUNCTION public.company_booking_check(p_booking uuid, p_caller uuid, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_b       record;
  v_req     public.company_booking_approvals%ROWTYPE;
  v_found   boolean;
  v_eval    jsonb;
  v_reasons text[];
  v_expires timestamptz;
  v_mails   jsonb;
BEGIN
  IF NOT public.is_server() THEN
    RAISE EXCEPTION 'company_booking_check: server only (payment functions)' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'company_booking_check: the server price is required' USING ERRCODE = '22023';
  END IF;
  SELECT id, customer_id, organization_id, status, payment_status, move_date INTO v_b
    FROM public.bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND OR v_b.customer_id IS DISTINCT FROM p_caller THEN
    RAISE EXCEPTION 'booking not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.organization_id IS NULL THEN RETURN jsonb_build_object('status', 'not_company'); END IF;
  IF v_b.status = 'cancelled' THEN RAISE EXCEPTION 'booking is cancelled' USING ERRCODE = '55000'; END IF;
  IF coalesce(v_b.payment_status, 'pending') <> 'pending' THEN
    RAISE EXCEPTION 'booking is not awaiting payment' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members m JOIN public.organizations o ON o.id = m.organization_id
                  WHERE m.organization_id = v_b.organization_id AND m.user_id = p_caller AND m.status = 'active'
                    AND m.role IN ('owner', 'admin', 'booker') AND o.status = 'active') THEN
    RAISE EXCEPTION 'only an owner, admin or booker of an active company spends for it' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.company_booking_approvals WHERE booking_id = p_booking FOR UPDATE;
  v_found := FOUND;
  IF v_found AND v_req.status = 'pending' THEN
    IF v_req.expires_at <= now() THEN
      PERFORM public.end_booking_approval(p_booking, 'expired', NULL);
      RETURN jsonb_build_object('status', 'expired');
    END IF;
    IF v_req.amount <> p_amount THEN
      UPDATE public.company_booking_approvals SET amount = p_amount, updated_at = now() WHERE booking_id = p_booking;
      PERFORM public.booking_approval_event(v_req.organization_id, p_booking, 'amount_changed',
        jsonb_build_object('from', v_req.amount, 'to', p_amount));
    END IF;
    RETURN jsonb_build_object('status', 'pending', 'new', false, 'amount', p_amount,
      'reasons', to_jsonb(v_req.reasons), 'expires_at', v_req.expires_at);
  END IF;
  IF v_found AND v_req.status IN ('refused', 'expired', 'withdrawn') THEN
    RETURN jsonb_build_object('status', v_req.status, 'reason', v_req.decision_reason);
  END IF;
  -- An approval is for exactly the amount approved.
  IF v_found AND v_req.status = 'approved' AND p_amount = v_req.amount THEN
    RETURN jsonb_build_object('status', 'approved', 'amount', v_req.amount);
  END IF;

  -- New, within the limits before, or approved for another amount: check now.
  v_eval := public.spending_check_reasons(v_b.organization_id, p_caller, p_booking, p_amount);
  SELECT coalesce(array_agg(r), '{}') INTO v_reasons FROM jsonb_array_elements_text(v_eval -> 'reasons') AS r;
  IF v_found AND v_req.status = 'approved' THEN
    -- The price differs from what was approved: never paid on the old
    -- approval, always a new request.
    v_reasons := v_reasons || 'price_changed'::text;
    PERFORM public.booking_approval_event(v_b.organization_id, p_booking, 'price_changed',
      jsonb_build_object('approved', v_req.amount, 'now', p_amount));
  END IF;
  IF cardinality(v_reasons) = 0 THEN
    INSERT INTO public.company_booking_approvals (booking_id, organization_id, requested_by, amount, reasons, month_spend, status)
    VALUES (p_booking, v_b.organization_id, p_caller, p_amount, '{}', (v_eval ->> 'month_spend')::numeric, 'not_required')
    ON CONFLICT (booking_id) DO UPDATE
       SET amount = EXCLUDED.amount, reasons = '{}', month_spend = EXCLUDED.month_spend, status = 'not_required',
           expires_at = NULL, decided_by = NULL, decided_at = NULL, decision_reason = NULL, updated_at = now();
    PERFORM public.booking_approval_event(v_b.organization_id, p_booking, 'within_limits', v_eval || jsonb_build_object('amount', p_amount));
    RETURN jsonb_build_object('status', 'not_required', 'amount', p_amount);
  END IF;

  -- Waits for approval: until the expiry the company chose, or the move
  -- day if that comes first.
  v_expires := now() + make_interval(hours => (v_eval ->> 'expiry_hours')::integer);
  IF v_b.move_date IS NOT NULL AND v_b.move_date > now() AND v_b.move_date < v_expires THEN
    v_expires := v_b.move_date;
  END IF;
  INSERT INTO public.company_booking_approvals (booking_id, organization_id, requested_by, amount, reasons, month_spend,
                                                status, requested_at, expires_at)
  VALUES (p_booking, v_b.organization_id, p_caller, p_amount, v_reasons, (v_eval ->> 'month_spend')::numeric,
          'pending', now(), v_expires)
  ON CONFLICT (booking_id) DO UPDATE
     SET amount = EXCLUDED.amount, reasons = EXCLUDED.reasons, month_spend = EXCLUDED.month_spend, status = 'pending',
         requested_at = now(), expires_at = EXCLUDED.expires_at, decided_by = NULL, decided_at = NULL,
         decision_reason = NULL, updated_at = now();
  PERFORM public.booking_approval_event(v_b.organization_id, p_booking, 'requested', v_eval || jsonb_build_object('amount', p_amount));

  -- Tell the approvers: in the app, and their addresses for the email.
  INSERT INTO public.notifications (user_id, kind, title, body, link_page, link_id)
  SELECT m.user_id, 'booking_status', 'A booking is waiting for your approval',
         round(p_amount)::text || ' NOK, booked for the company. Approve or refuse it under Shipments.',
         'corporate-dashboard', p_booking
    FROM public.organization_members m
   WHERE m.organization_id = v_b.organization_id AND m.status = 'active'
     AND m.role IN ('owner', 'admin', 'finance') AND m.user_id <> p_caller;
  SELECT coalesce(jsonb_agg(u.email), '[]'::jsonb) INTO v_mails
    FROM public.organization_members m JOIN auth.users u ON u.id = m.user_id
   WHERE m.organization_id = v_b.organization_id AND m.status = 'active'
     AND m.role IN ('owner', 'admin', 'finance') AND m.user_id <> p_caller AND u.email IS NOT NULL;
  RETURN jsonb_build_object('status', 'pending', 'new', true, 'amount', p_amount, 'reasons', to_jsonb(v_reasons),
    'expires_at', v_expires, 'approvers', v_mails,
    'organization', (SELECT name FROM public.organizations WHERE id = v_b.organization_id));
END $$;

-- An owner, admin or finance member of the (active) company approves or
-- refuses; never the person who booked, whatever their role, then or now.
-- Everything is read at the moment of the decision, under lock: the
-- approver's membership, the request and its deadline, the booking. With
-- p_amount (the amount the approver saw), a request whose amount has
-- changed since is refused. A refusal needs a reason and cancels the
-- booking without a fee. Never changes the amount.
DROP FUNCTION IF EXISTS public.decide_booking_approval(uuid, boolean, text);
CREATE OR REPLACE FUNCTION public.decide_booking_approval(p_booking uuid, p_approve boolean, p_reason text DEFAULT NULL,
                                                          p_amount numeric DEFAULT NULL)
RETURNS public.company_booking_approvals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_req      public.company_booking_approvals%ROWTYPE;
  v_b        record;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  -- The booking first, then the request: the order company_booking_check
  -- locks them in, so the two never wait for each other.
  SELECT customer_id, status, payment_status, organization_id INTO v_b FROM public.bookings WHERE id = p_booking FOR UPDATE;
  SELECT * INTO v_req FROM public.company_booking_approvals WHERE booking_id = p_booking FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_org_member(v_req.organization_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'approval request not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_active_org_member(v_req.organization_id, ARRAY['owner', 'admin', 'finance']) THEN
    RAISE EXCEPTION 'only an owner, admin or finance member of the active company approves bookings' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() = v_b.customer_id OR auth.uid() = v_req.requested_by THEN
    RAISE EXCEPTION 'nobody approves their own booking' USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'this booking is not waiting for approval (it is %)', v_req.status USING ERRCODE = '55000';
  END IF;
  IF v_req.expires_at <= now() THEN
    RAISE EXCEPTION 'the approval request has expired' USING ERRCODE = '55000';
  END IF;
  IF v_b.status IS NOT DISTINCT FROM 'cancelled' OR coalesce(v_b.payment_status, 'pending') <> 'pending'
     OR v_b.organization_id IS DISTINCT FROM v_req.organization_id THEN
    RAISE EXCEPTION 'this booking is no longer waiting for approval' USING ERRCODE = '55000';
  END IF;
  IF p_amount IS NOT NULL AND p_amount <> v_req.amount THEN
    RAISE EXCEPTION 'the amount has changed to % NOK since you looked: review it again', v_req.amount USING ERRCODE = '55000';
  END IF;

  IF p_approve THEN
    UPDATE public.company_booking_approvals
       SET status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason, updated_at = now()
     WHERE booking_id = p_booking RETURNING * INTO v_req;
    PERFORM public.booking_approval_event(v_req.organization_id, p_booking, 'approved',
      jsonb_build_object('reason', v_reason, 'amount', v_req.amount));
    INSERT INTO public.notifications (user_id, kind, title, body, link_page, link_id)
    VALUES (v_req.requested_by, 'booking_status', 'Booking approved',
            'Your company approved the booking' || coalesce(': ' || v_reason, '') || '. Complete it under My bookings.',
            'my-bookings', p_booking);
  ELSE
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'give a reason for refusing' USING ERRCODE = '22023';
    END IF;
    PERFORM public.end_booking_approval(p_booking, 'refused', v_reason);
    SELECT * INTO v_req FROM public.company_booking_approvals WHERE booking_id = p_booking;
  END IF;
  RETURN v_req;
END $$;


-- ── 5. Privileges ──────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.addon_modules(), public.org_modules(uuid),
  public.admin_enable_addon(uuid, text, text, numeric, numeric, text, text), public.admin_end_addon(uuid, text, text),
  public.admin_set_white_label_pilot_price(text, text), public.revoke_api_keys_of_former_admin(),
  public.decide_booking_approval(uuid, boolean, text, numeric)
FROM PUBLIC, anon, authenticated;
-- The company's page and the dashboard read what a company has (as
-- org_has_module, also for visitors: 00012).
GRANT EXECUTE ON FUNCTION public.addon_modules(), public.org_modules(uuid) TO anon, authenticated, service_role;
-- FlyttGo's administrators (each function checks its caller).
GRANT EXECUTE ON FUNCTION public.admin_enable_addon(uuid, text, text, numeric, numeric, text, text),
  public.admin_end_addon(uuid, text, text), public.admin_set_white_label_pilot_price(text, text)
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_booking_approval(uuid, boolean, text, numeric) TO authenticated, service_role;

-- ============================================================================
-- DONE
-- ============================================================================
