-- ============================================================================
-- Roll back 00022_pilot_addons.sql
-- ============================================================================
-- Run first (before the rollbacks of earlier migrations). Tested by run.sh:
-- afterwards the schema and function bodies are exactly as before 00022.
--
-- DATA LOSS — READ FIRST. Drops the companies' add-on modules: a company
-- keeps only what its plan includes, so a shop, a booking module or API
-- access added on top stops (their records stay: orders, reservations,
-- keys and logs belong to the earlier migrations). Each add-on's enabling
-- and ending, with its price or quote reference, is also in the company's
-- log (organization_events, actions addon.enabled and addon.ended), which
-- stays. Pilot prices go back to proposed, and their note and what the
-- set-up fee includes are dropped. Keys revoked when their creator lost
-- the role stay revoked.
-- ============================================================================

DROP TRIGGER IF EXISTS revoke_api_keys_of_former_admin ON public.organization_members;
DROP FUNCTION IF EXISTS public.revoke_api_keys_of_former_admin();

DROP FUNCTION IF EXISTS public.admin_end_addon(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_enable_addon(uuid, text, text, numeric, numeric, text, text);
DROP FUNCTION IF EXISTS public.admin_set_white_label_pilot_price(text, text);

DROP FUNCTION IF EXISTS public.decide_booking_approval(uuid, boolean, text, numeric);

-- As in 00009.
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
    updated_at       = now()
   WHERE code = p_code RETURNING * INTO p;
  RETURN p;
END $$;

-- As in 00010.
CREATE OR REPLACE FUNCTION public.org_has_module(p_org uuid, p_module text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_white_label w
      JOIN public.white_label_plans p ON p.code = w.plan_code
      JOIN public.organizations o ON o.id = w.organization_id
     WHERE w.organization_id = p_org AND w.status = 'active' AND o.status = 'active' AND p_module = ANY (p.modules));
$$;

-- As in 00018.
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

-- As in 00018.
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

-- As in 00018.
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

-- As in 00018.
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

-- As in 00017.
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
  IF v_found AND v_req.status = 'approved' AND p_amount <= v_req.amount THEN
    RETURN jsonb_build_object('status', 'approved', 'amount', v_req.amount);
  END IF;

  -- New, within the limits before, or approved for less: check now.
  v_eval := public.spending_check_reasons(v_b.organization_id, p_caller, p_booking, p_amount);
  SELECT coalesce(array_agg(r), '{}') INTO v_reasons FROM jsonb_array_elements_text(v_eval -> 'reasons') AS r;
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

-- As in 00017.
CREATE OR REPLACE FUNCTION public.decide_booking_approval(p_booking uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS public.company_booking_approvals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_req      public.company_booking_approvals%ROWTYPE;
  v_customer uuid;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_req FROM public.company_booking_approvals WHERE booking_id = p_booking FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_org_member(v_req.organization_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'approval request not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_active_org_member(v_req.organization_id, ARRAY['owner', 'admin', 'finance']) THEN
    RAISE EXCEPTION 'only an owner, admin or finance member of the active company approves bookings' USING ERRCODE = '42501';
  END IF;
  SELECT customer_id INTO v_customer FROM public.bookings WHERE id = p_booking;
  IF auth.uid() = v_customer OR auth.uid() = v_req.requested_by THEN
    RAISE EXCEPTION 'nobody approves their own booking' USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'this booking is not waiting for approval (it is %)', v_req.status USING ERRCODE = '55000';
  END IF;
  IF v_req.expires_at <= now() THEN
    RAISE EXCEPTION 'the approval request has expired' USING ERRCODE = '55000';
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

-- As in 00017 (the privileges of the approval function above).
REVOKE ALL ON FUNCTION public.decide_booking_approval(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_booking_approval(uuid, boolean, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.org_modules(uuid);
DROP TABLE IF EXISTS public.organization_addons;
DROP FUNCTION IF EXISTS public.addon_modules();

-- Pilot prices become proposals again (before 00022, every price not
-- confirmed was one).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.white_label_plans'::regclass
               AND conname = 'white_label_plans_price_status_check'
               AND pg_get_constraintdef(oid) LIKE '%pilot%') THEN
    ALTER TABLE public.white_label_plans DROP CONSTRAINT white_label_plans_price_status_check;
    UPDATE public.white_label_plans SET price_status = 'proposed', prices_confirmed_by = NULL, prices_confirmed_at = NULL
     WHERE price_status = 'pilot';
    ALTER TABLE public.white_label_plans ADD CONSTRAINT white_label_plans_price_status_check
      CHECK (price_status IN ('proposed', 'confirmed'));
  END IF;
END $$;
ALTER TABLE public.white_label_plans DROP COLUMN IF EXISTS setup_fee_includes;
ALTER TABLE public.white_label_plans DROP COLUMN IF EXISTS price_note;

-- ============================================================================
-- DONE
-- ============================================================================
