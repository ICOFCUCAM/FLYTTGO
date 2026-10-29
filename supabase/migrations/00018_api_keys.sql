-- ============================================================================
-- FlyttGo — API keys and the booking widget for companies' own websites
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00015 (docs/API.md,
-- docs/WHITE_LABEL.md → Booking widget). Two ways for a company to take
-- FlyttGo's booking onto its own systems and website:
--
--   * API keys for the public API (Edge Function public-api, /v1/...). An
--     owner or admin of an ACTIVE company (is_active_org_member) creates,
--     names, scopes and revokes keys. The key is shown once; only its
--     SHA-256 and a short visible prefix are stored. Scopes: quotes,
--     bookings:read, bookings:write (moves on the company's invoice, so
--     only where FlyttGo has switched invoicing on, 00008), appointments
--     and jobs (only when the company's plan includes the module,
--     org_has_module()).
--   * A key acts as the member who created it. Its writes go through the
--     same database functions as the company's own screens, run with the
--     creator's identity: create_job, create_appointment, and a booking
--     made as the creator then paid with book_on_invoice (the function
--     book-on-invoice uses). Their company role and every existing check
--     apply. A key works only while the company is active and its creator
--     is still an active owner or admin there; revoked or expired keys
--     never work again.
--   * Every request counts against the key's limit per minute
--     (api_key_usage). Writes accept an Idempotency-Key: the same key and
--     request return the first answer, for 24 hours. Key events and every
--     write made through a key go to api_events (append-only).
--   * The widget is an iframe of the company's booking page; no API key is
--     involved. It may be framed only by the websites the company lists
--     (organization_widget_origins), read by the server for the
--     Content-Security-Policy frame-ancestors header and the embed page.
--
-- Safe to re-run. Rollback: supabase/rollback/00018_down.sql.
-- ============================================================================


-- ── 1. Tables ───────────────────────────────────────────────────────────────

-- The scopes a key can carry.
CREATE OR REPLACE FUNCTION public.api_scopes()
RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT ARRAY['quotes', 'bookings:read', 'bookings:write', 'appointments', 'jobs']; $$;

-- A website allowed to show the widget: https://host[:port], lower case, no
-- path; http only for localhost while a company tests.
CREATE OR REPLACE FUNCTION public.is_valid_widget_origin(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT p IS NOT NULL AND char_length(p) <= 255 AND (
         p ~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9](:[0-9]{1,5})?$'
      OR p ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$');
$$;

CREATE TABLE IF NOT EXISTS public.api_keys (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name                  text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  prefix                text        NOT NULL CHECK (prefix ~ '^fgo_[0-9a-f]{8}$'),        -- shown in lists
  key_hash              text        NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'), -- hex SHA-256 of the key
  scopes                text[]      NOT NULL CHECK (cardinality(scopes) > 0 AND scopes <@ public.api_scopes()),
  created_by            uuid        NOT NULL,                     -- the member the key acts as
  rate_limit_per_minute integer     NOT NULL DEFAULT 60 CHECK (rate_limit_per_minute BETWEEN 1 AND 6000),
  last_used_at          timestamptz,
  expires_at            timestamptz,
  revoked_at            timestamptz,
  revoked_by            uuid,
  revoked_reason        text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_keys_org_idx ON public.api_keys (organization_id, created_at DESC);

-- Key events and the writes made through a key. Append-only.
CREATE TABLE IF NOT EXISTS public.api_events (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  api_key_id      uuid        REFERENCES public.api_keys (id) ON DELETE CASCADE,
  actor_id        uuid,                                            -- who; for a request, the key's creator
  action          text        NOT NULL,
  details         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_events_org_idx ON public.api_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_events_key_idx ON public.api_events (api_key_id, created_at DESC) WHERE api_key_id IS NOT NULL;
DROP TRIGGER IF EXISTS guard_api_events ON public.api_events;
CREATE TRIGGER guard_api_events BEFORE UPDATE OR DELETE ON public.api_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();

-- Requests per key and minute (the rate limit). Old minutes are cleared as
-- the key is used.
CREATE TABLE IF NOT EXISTS public.api_key_usage (
  api_key_id   uuid        NOT NULL REFERENCES public.api_keys (id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  requests     integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, window_start)
);

-- Answers to writes sent with an Idempotency-Key, kept 24 hours.
CREATE TABLE IF NOT EXISTS public.api_idempotency (
  api_key_id      uuid        NOT NULL REFERENCES public.api_keys (id) ON DELETE CASCADE,
  idempotency_key text        NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 255),
  request_hash    text        NOT NULL,
  response        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, idempotency_key)
);

-- The websites that may show the company's booking widget.
CREATE TABLE IF NOT EXISTS public.organization_widget_origins (
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  origin          text        NOT NULL CHECK (public.is_valid_widget_origin(origin)),
  added_by        uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, origin)
);


-- ── 2. Who reads what ───────────────────────────────────────────────────────
-- Owners and admins read the company's keys (never their hashes) and the
-- key log; members read the widget's websites; FlyttGo's administrators
-- read all. Nobody writes the tables directly.
ALTER TABLE public.api_keys                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_events                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_key_usage               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_idempotency             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_widget_origins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_keys_select ON public.api_keys;
CREATE POLICY api_keys_select ON public.api_keys FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS api_events_select ON public.api_events;
CREATE POLICY api_events_select ON public.api_events FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS organization_widget_origins_select ON public.organization_widget_origins;
CREATE POLICY organization_widget_origins_select ON public.organization_widget_origins FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));

REVOKE ALL ON public.api_keys, public.api_events, public.api_key_usage, public.api_idempotency,
              public.organization_widget_origins FROM anon, authenticated;
GRANT SELECT (id, organization_id, name, prefix, scopes, created_by, rate_limit_per_minute, last_used_at,
              expires_at, revoked_at, revoked_by, revoked_reason, created_at) ON public.api_keys TO authenticated;
GRANT SELECT ON public.api_events, public.organization_widget_origins TO authenticated;


-- ── 3. Scopes ───────────────────────────────────────────────────────────────
-- Whether the company may use a scope now: it is active; moves on its
-- invoice need invoicing switched on by FlyttGo (00008); appointments and
-- jobs need the module in its active plan.
CREATE OR REPLACE FUNCTION public.api_scope_available(p_org uuid, p_scope text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org AND o.status = 'active')
     AND CASE p_scope
           WHEN 'quotes'         THEN true
           WHEN 'bookings:read'  THEN true
           WHEN 'bookings:write' THEN (SELECT o.invoicing_enabled FROM public.organizations o WHERE o.id = p_org)
           WHEN 'appointments'   THEN public.org_has_module(p_org, 'appointments')
           WHEN 'jobs'           THEN public.org_has_module(p_org, 'jobs')
           ELSE false
         END;
$$;

-- The scopes the company can give a key now (for the dashboard).
CREATE OR REPLACE FUNCTION public.api_scopes_available(p_org uuid)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_org_member(p_org)) THEN
    RAISE EXCEPTION 'API keys: members of the company only' USING ERRCODE = '42501';
  END IF;
  RETURN ARRAY(SELECT s FROM unnest(public.api_scopes()) WITH ORDINALITY AS x(s, n)
                WHERE public.api_scope_available(p_org, s) ORDER BY n);
END $$;

-- Checked scopes, de-duplicated in the order of api_scopes().
CREATE OR REPLACE FUNCTION public.api_checked_scopes(p_org uuid, p_scopes text[])
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s text;
BEGIN
  IF coalesce(cardinality(p_scopes), 0) = 0 THEN
    RAISE EXCEPTION 'API keys: give the key at least one scope' USING ERRCODE = '22023';
  END IF;
  FOREACH s IN ARRAY p_scopes LOOP
    IF s IS NULL OR NOT s = ANY (public.api_scopes()) THEN
      RAISE EXCEPTION 'API keys: unknown scope % (scopes: %)', coalesce(s, 'null'), array_to_string(public.api_scopes(), ', ')
        USING ERRCODE = '22023';
    END IF;
    IF NOT public.api_scope_available(p_org, s) THEN
      RAISE EXCEPTION 'API keys: the scope % is not available to this company (%)', s,
        CASE s WHEN 'bookings:write' THEN 'bookings through the API are paid on invoice: FlyttGo switches invoicing on'
               WHEN 'appointments'   THEN 'the plan does not include appointments'
               WHEN 'jobs'           THEN 'the plan does not include jobs'
               ELSE 'the company must be active' END
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  RETURN ARRAY(SELECT x.s FROM unnest(public.api_scopes()) WITH ORDINALITY AS x(s, n) WHERE x.s = ANY (p_scopes) ORDER BY x.n);
END $$;

CREATE OR REPLACE FUNCTION public.api_event(p_org uuid, p_key uuid, p_actor uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.api_events (organization_id, api_key_id, actor_id, action, details)
  VALUES (p_org, p_key, p_actor, p_action, coalesce(p_details, '{}'::jsonb));
$$;


-- ── 4. Creating, changing and revoking keys ─────────────────────────────────
-- Returns the key once: {id, key, prefix, name, scopes, expires_at}.
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

-- Rename a key or change its scopes. It keeps acting as its creator.
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
  IF coalesce(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'API keys: give the key a name' USING ERRCODE = '22023'; END IF;
  v_scopes := public.api_checked_scopes(k.organization_id, p_scopes);
  UPDATE public.api_keys SET name = btrim(p_name), scopes = v_scopes WHERE id = p_key RETURNING * INTO k;
  PERFORM public.api_event(k.organization_id, k.id, auth.uid(), 'key.updated', jsonb_build_object('name', k.name, 'scopes', k.scopes));
  RETURN k;
END $$;

-- Owners and admins revoke their company's keys, also while it is
-- suspended; FlyttGo's administrators may revoke any key (logged).
CREATE OR REPLACE FUNCTION public.revoke_api_key(p_key uuid, p_reason text DEFAULT NULL)
RETURNS public.api_keys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE k public.api_keys%ROWTYPE;
BEGIN
  SELECT * INTO k FROM public.api_keys WHERE id = p_key FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_org_member(k.organization_id, ARRAY['owner', 'admin']) OR public.is_admin()) THEN
    RAISE EXCEPTION 'API keys: only an owner or admin of the key''s company revokes it' USING ERRCODE = '42501';
  END IF;
  IF k.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'API keys: this key is already revoked' USING ERRCODE = '55000'; END IF;
  UPDATE public.api_keys SET revoked_at = now(), revoked_by = auth.uid(), revoked_reason = nullif(btrim(coalesce(p_reason, '')), '')
   WHERE id = p_key RETURNING * INTO k;
  PERFORM public.api_event(k.organization_id, k.id, auth.uid(), 'key.revoked', jsonb_build_object('reason', k.revoked_reason));
  RETURN k;
END $$;

-- FlyttGo sets a key's limit per minute (60 unless changed).
CREATE OR REPLACE FUNCTION public.admin_set_api_key_limit(p_key uuid, p_per_minute integer)
RETURNS public.api_keys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE k public.api_keys%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'API keys: platform administrators only' USING ERRCODE = '42501'; END IF;
  UPDATE public.api_keys SET rate_limit_per_minute = p_per_minute WHERE id = p_key RETURNING * INTO k;
  IF NOT FOUND THEN RAISE EXCEPTION 'API keys: no such key' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.api_event(k.organization_id, k.id, auth.uid(), 'key.limit', jsonb_build_object('per_minute', p_per_minute));
  RETURN k;
END $$;


-- ── 5. Using a key (the public-api function only) ──────────────────────────
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
    WHEN 'creator_not_member'    THEN 'The member who created this key is no longer an owner or admin of the company: create a new key.'
    WHEN 'scope_missing'         THEN 'The API key does not have the scope ' || coalesce(p_scope, '') || '.'
    WHEN 'scope_unavailable'     THEN 'The company''s plan or terms do not include ' || coalesce(p_scope, '') || ' now.'
    WHEN 'rate_limited'          THEN 'Too many requests for this key: wait for the next minute.'
  END;
$$;

-- Every request starts here: finds the key by its hash, counts the request
-- and says whether it may go on. Never raises for a refused key, so the
-- count stays. Returns {ok, error, status, message, ...}.
CREATE OR REPLACE FUNCTION public.api_begin(p_key_hash text, p_scope text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  k        public.api_keys%ROWTYPE;
  v_window timestamptz := date_trunc('minute', now());
  v_count  integer;
  v_code   text;
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'API: server only (public-api function)' USING ERRCODE = '42501'; END IF;
  SELECT * INTO k FROM public.api_keys WHERE key_hash = lower(p_key_hash);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_key', 'status', 401, 'message', public.api_refusal_message('invalid_key', NULL));
  END IF;
  INSERT INTO public.api_key_usage AS u (api_key_id, window_start, requests) VALUES (k.id, v_window, 1)
  ON CONFLICT (api_key_id, window_start) DO UPDATE SET requests = u.requests + 1
  RETURNING requests INTO v_count;
  DELETE FROM public.api_key_usage WHERE api_key_id = k.id AND window_start < v_window - interval '1 hour';
  IF v_count > k.rate_limit_per_minute THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited', 'status', 429, 'message', public.api_refusal_message('rate_limited', NULL),
                              'limit', k.rate_limit_per_minute, 'remaining', 0, 'reset_at', v_window + interval '1 minute',
                              'retry_after', greatest(1, ceil(extract(epoch FROM (v_window + interval '1 minute' - now()))))::int);
  END IF;
  v_code := public.api_key_refusal(k, p_scope);
  IF v_code IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_code, 'message', public.api_refusal_message(v_code, p_scope),
                              'status', CASE WHEN v_code IN ('key_revoked', 'key_expired') THEN 401 ELSE 403 END);
  END IF;
  IF k.last_used_at IS NULL OR k.last_used_at < now() - interval '1 minute' THEN
    UPDATE public.api_keys SET last_used_at = now() WHERE id = k.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'key_id', k.id, 'organization_id', k.organization_id, 'acting_user', k.created_by,
                            'scopes', k.scopes, 'limit', k.rate_limit_per_minute,
                            'remaining', greatest(0, k.rate_limit_per_minute - v_count), 'reset_at', v_window + interval '1 minute');
END $$;

-- The key for a read or write already begun with api_begin: checked again
-- (not counted again). Raises when it may not be used.
CREATE OR REPLACE FUNCTION public.api_key_for(p_key_hash text, p_scope text)
RETURNS public.api_keys
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE k public.api_keys%ROWTYPE; v_code text;
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'API: server only (public-api function)' USING ERRCODE = '42501'; END IF;
  SELECT * INTO k FROM public.api_keys WHERE key_hash = lower(p_key_hash);
  v_code := public.api_key_refusal(k, p_scope);
  IF v_code IS NOT NULL THEN
    RAISE EXCEPTION 'API: %', public.api_refusal_message(v_code, p_scope)
      USING ERRCODE = CASE WHEN v_code IN ('invalid_key', 'key_revoked', 'key_expired') THEN '28000' ELSE '42501' END;
  END IF;
  RETURN k;
END $$;

-- What the company sees of a booking: no driver, payment provider
-- references or internal fields (the dashboard's columns and the move).
CREATE OR REPLACE FUNCTION public.api_booking_json(b public.bookings)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_object_agg(e.key, e.value) || jsonb_build_object('object', 'booking')
    FROM jsonb_each(to_jsonb(b)) e
   WHERE e.key = ANY (ARRAY['id', 'status', 'payment_status', 'payment_provider', 'pickup_address', 'pickup_postcode', 'pickup_city',
                            'dropoff_address', 'dropoff_postcode', 'dropoff_city', 'move_type', 'move_date', 'move_time', 'van_type',
                            'helpers', 'additional_services', 'estimated_hours', 'distance_km', 'price_estimate', 'customer_name',
                            'customer_phone', 'customer_email', 'customer_notes', 'cancelled_at', 'created_at']);
$$;

-- Reads for a key: the company's bookings, and its jobs and appointments
-- (services, free times, the records). Only the key's company, always.
CREATE OR REPLACE FUNCTION public.api_read(p_key_hash text, p_what text, p_args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_scope  text := CASE split_part(p_what, '.', 1) WHEN 'bookings' THEN 'bookings:read' WHEN 'jobs' THEN 'jobs'
                                                   WHEN 'appointments' THEN 'appointments' END;
  k        public.api_keys%ROWTYPE;
  v_org    uuid;
  v_limit  integer := least(greatest(coalesce((p_args ->> 'limit')::int, 25), 1), 100);
  v_before timestamptz := (p_args ->> 'before')::timestamptz;
  v_id     uuid := (p_args ->> 'id')::uuid;
  v_rows   jsonb;
BEGIN
  IF v_scope IS NULL THEN RAISE EXCEPTION 'API: unknown read %', p_what USING ERRCODE = '22023'; END IF;
  k := public.api_key_for(p_key_hash, v_scope);
  v_org := k.organization_id;
  CASE p_what
    WHEN 'bookings.list' THEN
      SELECT coalesce(jsonb_agg(public.api_booking_json(b) ORDER BY b.created_at DESC), '[]'::jsonb) INTO v_rows
        FROM (SELECT * FROM public.bookings x
               WHERE x.organization_id = v_org AND (v_before IS NULL OR x.created_at < v_before)
                 AND (p_args ->> 'status' IS NULL OR x.status = p_args ->> 'status')
               ORDER BY x.created_at DESC LIMIT v_limit + 1) b;
      RETURN jsonb_build_object('object', 'list', 'data', (SELECT coalesce(jsonb_agg(t.e ORDER BY t.n), '[]'::jsonb)
                                  FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(e, n) WHERE t.n <= v_limit),
                                'has_more', jsonb_array_length(v_rows) > v_limit);
    WHEN 'bookings.get' THEN
      SELECT public.api_booking_json(b) INTO v_rows FROM public.bookings b WHERE b.id = v_id AND b.organization_id = v_org;
      IF v_rows IS NULL THEN RAISE EXCEPTION 'API: no such booking' USING ERRCODE = 'P0002'; END IF;
      RETURN v_rows;
    WHEN 'jobs.services' THEN
      RETURN jsonb_build_object('object', 'list', 'has_more', false, 'data', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('object', 'job_service', 'id', s.id, 'name', s.name, 'description', s.description,
                                   'price_type', s.price_type, 'price', s.price, 'vat_rate', s.vat_rate, 'call_out_fee', s.call_out_fee,
                                   'requires_authorisation', s.requires_authorisation) ORDER BY s.sort, s.name), '[]'::jsonb)
          FROM public.job_services s WHERE s.organization_id = v_org AND s.active));
    WHEN 'jobs.list', 'jobs.get' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('object', 'job', 'id', j.id, 'number', j.number, 'status', j.status,
                                 'service_id', j.service_id, 'customer', j.customer, 'address', j.address, 'postcode', j.postcode,
                                 'city', j.city, 'description', j.description, 'preferred_time', j.preferred_time,
                                 'price_type', j.price_type, 'agreed_price', j.agreed_price, 'quote_amount', j.quote_amount,
                                 'quote_valid_until', j.quote_valid_until, 'window_start', j.window_start, 'window_end', j.window_end,
                                 'completed_at', j.completed_at, 'cancelled_at', j.cancelled_at, 'created_at', j.created_at)
                               ORDER BY j.created_at DESC), '[]'::jsonb) INTO v_rows
        FROM (SELECT * FROM public.jobs x
               WHERE x.organization_id = v_org AND (v_id IS NULL OR x.id = v_id)
                 AND (p_args ->> 'status' IS NULL OR x.status = p_args ->> 'status')
                 AND (v_before IS NULL OR x.created_at < v_before)
               ORDER BY x.created_at DESC LIMIT CASE WHEN p_what = 'jobs.get' THEN 1 ELSE v_limit + 1 END) j;
      IF p_what = 'jobs.get' THEN
        IF jsonb_array_length(v_rows) = 0 OR v_id IS NULL THEN RAISE EXCEPTION 'API: no such job' USING ERRCODE = 'P0002'; END IF;
        RETURN v_rows -> 0;
      END IF;
      RETURN jsonb_build_object('object', 'list', 'has_more', jsonb_array_length(v_rows) > v_limit,
                                'data', (SELECT coalesce(jsonb_agg(t.e ORDER BY t.n), '[]'::jsonb)
                                           FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(e, n) WHERE t.n <= v_limit));
    WHEN 'appointments.services' THEN
      RETURN jsonb_build_object('object', 'list', 'has_more', false, 'data', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('object', 'appointment_service', 'id', s.id, 'name', s.name,
                                   'description', s.description, 'duration_minutes', s.duration_minutes, 'price', s.price,
                                   'vat_rate', s.vat_rate,
                                   'resources', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) ORDER BY r.sort, r.name), '[]'::jsonb)
                                                   FROM public.appointment_resources r
                                                   JOIN public.appointment_resource_services rs ON rs.resource_id = r.id
                                                  WHERE rs.service_id = s.id AND r.active)) ORDER BY s.sort, s.name), '[]'::jsonb)
          FROM public.appointment_services s WHERE s.organization_id = v_org AND s.active));
    WHEN 'appointments.slots' THEN
      RETURN jsonb_build_object('object', 'list', 'has_more', false, 'data', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('resource_id', x.resource_id, 'resource_name', x.resource_name, 'starts_at', x.starts_at)
                                  ORDER BY x.starts_at, x.resource_name), '[]'::jsonb)
          FROM public.available_slots(v_org, (p_args ->> 'service_id')::uuid, (p_args ->> 'date')::date,
                                      (p_args ->> 'resource_id')::uuid) x));
    WHEN 'appointments.list', 'appointments.get' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('object', 'appointment', 'id', a.id, 'number', a.number, 'status', a.status,
                                 'service_id', a.service_id, 'resource_id', a.resource_id, 'customer', a.customer,
                                 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'price', a.price, 'notes', a.notes,
                                 'cancelled_at', a.cancelled_at, 'created_at', a.created_at) ORDER BY a.starts_at DESC), '[]'::jsonb) INTO v_rows
        FROM (SELECT * FROM public.appointments x
               WHERE x.organization_id = v_org AND (v_id IS NULL OR x.id = v_id)
                 AND (p_args ->> 'status' IS NULL OR x.status = p_args ->> 'status')
                 AND (v_before IS NULL OR x.starts_at < v_before)
               ORDER BY x.starts_at DESC LIMIT CASE WHEN p_what = 'appointments.get' THEN 1 ELSE v_limit + 1 END) a;
      IF p_what = 'appointments.get' THEN
        IF jsonb_array_length(v_rows) = 0 OR v_id IS NULL THEN RAISE EXCEPTION 'API: no such appointment' USING ERRCODE = 'P0002'; END IF;
        RETURN v_rows -> 0;
      END IF;
      RETURN jsonb_build_object('object', 'list', 'has_more', jsonb_array_length(v_rows) > v_limit,
                                'data', (SELECT coalesce(jsonb_agg(t.e ORDER BY t.n), '[]'::jsonb)
                                           FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(e, n) WHERE t.n <= v_limit));
    ELSE
      RAISE EXCEPTION 'API: unknown read %', p_what USING ERRCODE = '22023';
  END CASE;
END $$;

-- Writes for a key, as the key's creator, through the module functions:
--   booking.create      a move for the company, paid on its invoice. The
--                       server prices it first (p_args.price, distance_km:
--                       the formula of _shared/pricing.ts), the booking is
--                       inserted as the creator (the booking guards apply
--                       as for the dashboard), then book_on_invoice checks
--                       the company's terms and credit limit.
--   job.create          create_job (the company records a job).
--   appointment.create  create_appointment (the company books a time).
-- With an Idempotency-Key, the same request returns the first answer
-- ("replayed": true); another request with that key is refused.
CREATE OR REPLACE FUNCTION public.api_write(p_key_hash text, p_action text, p_args jsonb,
                                            p_idempotency_key text DEFAULT NULL, p_request_hash text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_scope  text := CASE p_action WHEN 'booking.create' THEN 'bookings:write' WHEN 'job.create' THEN 'jobs'
                                 WHEN 'appointment.create' THEN 'appointments' END;
  k        public.api_keys%ROWTYPE;
  v_prev   public.api_idempotency%ROWTYPE;
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_sub    text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_role   text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_price  numeric := (p_args ->> 'price')::numeric;
  v_id     uuid;
  v_inv    jsonb;
  j        public.jobs%ROWTYPE;
  a        public.appointments%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_scope IS NULL THEN RAISE EXCEPTION 'API: unknown write %', p_action USING ERRCODE = '22023'; END IF;
  k := public.api_key_for(p_key_hash, v_scope);

  IF p_idempotency_key IS NOT NULL THEN
    DELETE FROM public.api_idempotency WHERE api_key_id = k.id AND created_at < now() - interval '24 hours';
    INSERT INTO public.api_idempotency (api_key_id, idempotency_key, request_hash)
    VALUES (k.id, p_idempotency_key, coalesce(p_request_hash, ''))
    ON CONFLICT (api_key_id, idempotency_key) DO NOTHING;
    IF NOT FOUND THEN                  -- an earlier request with this key (waited for, if still running)
      SELECT * INTO v_prev FROM public.api_idempotency WHERE api_key_id = k.id AND idempotency_key = p_idempotency_key;
      IF v_prev.request_hash IS DISTINCT FROM coalesce(p_request_hash, '') THEN
        RAISE EXCEPTION 'API: this Idempotency-Key was used for a different request' USING ERRCODE = '23505';
      END IF;
      RETURN v_prev.response || jsonb_build_object('replayed', true);
    END IF;
  END IF;

  -- Act as the key's creator for the rest of this transaction.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', k.created_by, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', k.created_by::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  CASE p_action
    WHEN 'booking.create' THEN
      IF v_price IS NULL OR v_price <= 0 THEN
        RAISE EXCEPTION 'API: the booking must be priced by the server' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.bookings (customer_id, organization_id, customer_name, customer_phone, customer_email,
                                   pickup_address, pickup_postcode, pickup_city, pickup_lat, pickup_lng,
                                   dropoff_address, dropoff_postcode, dropoff_city, dropoff_lat, dropoff_lng,
                                   move_type, van_type, helpers, additional_services, items, move_date, move_time, customer_notes,
                                   distance_km, estimated_hours, price_estimate, original_price, status, payment_status)
      VALUES (k.created_by, k.organization_id, p_args #>> '{contact,name}', p_args #>> '{contact,phone}', p_args #>> '{contact,email}',
              p_args #>> '{pickup,address}', p_args #>> '{pickup,postcode}', p_args #>> '{pickup,city}',
              (p_args #>> '{pickup,lat}')::numeric, (p_args #>> '{pickup,lng}')::numeric,
              p_args #>> '{dropoff,address}', p_args #>> '{dropoff,postcode}', p_args #>> '{dropoff,city}',
              (p_args #>> '{dropoff,lat}')::numeric, (p_args #>> '{dropoff,lng}')::numeric,
              p_args ->> 'move_type', p_args ->> 'van_type', coalesce((p_args ->> 'helpers')::int, 0),
              coalesce(p_args -> 'additional_services', '[]'::jsonb), coalesce(p_args -> 'items', '{}'::jsonb),
              (p_args ->> 'move_date')::date, (p_args ->> 'move_time')::time, p_args ->> 'notes',
              (p_args ->> 'distance_km')::numeric, (p_args ->> 'estimated_hours')::numeric, v_price, v_price, 'pending', 'pending')
      RETURNING id INTO v_id;
      INSERT INTO public.escrow_payments (booking_id, amount, original_amount, status) VALUES (v_id, v_price, v_price, 'held');
      -- book_on_invoice is the server's step, as in book-on-invoice.
      PERFORM set_config('request.jwt.claims', v_claims, true);
      PERFORM set_config('request.jwt.claim.sub', v_sub, true);
      PERFORM set_config('request.jwt.claim.role', v_role, true);
      v_inv := public.book_on_invoice(v_id, k.created_by);
      SELECT public.api_booking_json(b) || jsonb_build_object('invoice_cycle', v_inv ->> 'cycle') INTO v_result
        FROM public.bookings b WHERE b.id = v_id;
    WHEN 'job.create' THEN
      j := public.create_job(k.organization_id, (p_args ->> 'service_id')::uuid, p_args -> 'contact', p_args -> 'place',
                             p_args ->> 'description', p_args ->> 'preferred_time');
      v_id := j.id;
      v_result := jsonb_build_object('object', 'job', 'id', j.id, 'number', j.number, 'status', j.status, 'service_id', j.service_id,
                                     'price_type', j.price_type, 'agreed_price', j.agreed_price, 'customer', j.customer,
                                     'address', j.address, 'created_at', j.created_at);
    WHEN 'appointment.create' THEN
      a := public.create_appointment(k.organization_id, (p_args ->> 'service_id')::uuid, (p_args ->> 'resource_id')::uuid,
                                     (p_args ->> 'starts_at')::timestamptz, p_args -> 'contact', p_args ->> 'notes');
      v_id := a.id;
      v_result := jsonb_build_object('object', 'appointment', 'id', a.id, 'number', a.number, 'status', a.status,
                                     'service_id', a.service_id, 'resource_id', a.resource_id, 'customer', a.customer,
                                     'starts_at', a.starts_at, 'ends_at', a.ends_at, 'price', a.price, 'created_at', a.created_at);
  END CASE;

  PERFORM set_config('request.jwt.claims', v_claims, true);
  PERFORM set_config('request.jwt.claim.sub', v_sub, true);
  PERFORM set_config('request.jwt.claim.role', v_role, true);
  PERFORM public.api_event(k.organization_id, k.id, k.created_by, p_action,
    jsonb_build_object('id', v_id, 'idempotency_key', p_idempotency_key));
  IF p_idempotency_key IS NOT NULL THEN
    UPDATE public.api_idempotency SET response = v_result WHERE api_key_id = k.id AND idempotency_key = p_idempotency_key;
  END IF;
  RETURN v_result;
END $$;


-- ── 6. The widget's websites ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_widget_origin(p text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT regexp_replace(lower(btrim(coalesce(p, ''))), '/+$', ''); $$;

CREATE OR REPLACE FUNCTION public.add_widget_origin(p_org uuid, p_origin text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_origin text := public.normalize_widget_origin(p_origin);
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  IF NOT public.is_valid_widget_origin(v_origin) THEN
    RAISE EXCEPTION 'widget: give the website as https://example.no (no path), or http://localhost for testing' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_widget_origins WHERE organization_id = p_org AND origin = v_origin) THEN
    RETURN v_origin;
  END IF;
  IF (SELECT count(*) FROM public.organization_widget_origins WHERE organization_id = p_org) >= 20 THEN
    RAISE EXCEPTION 'widget: at most 20 websites per company' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.organization_widget_origins (organization_id, origin, added_by) VALUES (p_org, v_origin, auth.uid());
  PERFORM public.api_event(p_org, NULL, auth.uid(), 'widget.origin_added', jsonb_build_object('origin', v_origin));
  RETURN v_origin;
END $$;

CREATE OR REPLACE FUNCTION public.remove_widget_origin(p_org uuid, p_origin text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_origin text := public.normalize_widget_origin(p_origin);
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  DELETE FROM public.organization_widget_origins WHERE organization_id = p_org AND origin = v_origin;
  IF FOUND THEN
    PERFORM public.api_event(p_org, NULL, auth.uid(), 'widget.origin_removed', jsonb_build_object('origin', v_origin));
  END IF;
END $$;

-- The websites that may frame the company's page (white-label-site adds
-- them to the public page; they are no secret: the browser sees them in
-- the frame-ancestors header).
CREATE OR REPLACE FUNCTION public.widget_origins_public(p_org uuid)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'widget: server only (white-label-site)' USING ERRCODE = '42501'; END IF;
  RETURN ARRAY(SELECT origin FROM public.organization_widget_origins WHERE organization_id = p_org ORDER BY origin);
END $$;


-- ── 7. Who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.api_scope_available(uuid, text), public.api_checked_scopes(uuid, text[]),
  public.api_event(uuid, uuid, uuid, text, jsonb), public.api_key_refusal(public.api_keys, text),
  public.api_key_for(text, text), public.api_booking_json(public.bookings)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.api_scopes_available(uuid), public.create_api_key(uuid, text, text[], timestamptz),
  public.update_api_key(uuid, text, text[]), public.revoke_api_key(uuid, text), public.admin_set_api_key_limit(uuid, integer),
  public.api_begin(text, text), public.api_read(text, text, jsonb), public.api_write(text, text, jsonb, text, text),
  public.add_widget_origin(uuid, text), public.remove_widget_origin(uuid, text), public.widget_origins_public(uuid)
FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.api_begin(text, text), public.api_read(text, text, jsonb),
  public.api_write(text, text, jsonb, text, text), public.widget_origins_public(uuid) FROM authenticated;
-- Owners and admins in the dashboard (each function checks its caller).
GRANT EXECUTE ON FUNCTION
  public.api_scopes_available(uuid), public.create_api_key(uuid, text, text[], timestamptz),
  public.update_api_key(uuid, text, text[]), public.revoke_api_key(uuid, text), public.admin_set_api_key_limit(uuid, integer),
  public.add_widget_origin(uuid, text), public.remove_widget_origin(uuid, text)
TO authenticated, service_role;
-- The public-api and white-label-site functions.
GRANT EXECUTE ON FUNCTION public.api_begin(text, text), public.api_read(text, text, jsonb),
  public.api_write(text, text, jsonb, text, text), public.widget_origins_public(uuid)
TO service_role;

-- ============================================================================
-- DONE
-- ============================================================================
