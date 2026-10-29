-- ============================================================================
-- FlyttGo — spending limits and approval of company bookings
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00015 (docs/ORGANIZATIONS.md,
-- "Spending limits and approval"). Uses the one booking engine: nothing
-- here creates, prices, pays or dispatches a booking.
--
--   * Per member: a limit per booking and a monthly limit (Europe/Oslo
--     calendar month), set by the company's owners, admins and finance.
--     Nobody sets their own.
--   * Per company: approval rules. Bookings above an amount, or every
--     booking by members with given roles, need approval. Going over a
--     member's limit needs approval too.
--   * The server checks a company booking when it is about to be paid
--     (company_booking_check, called by every payment function through
--     _shared/booking-charge.ts with the server's price, never the
--     browser's). Within the limits it is paid as before. Otherwise it
--     waits for approval: the booking stays unpaid ('pending' /
--     'pending', as every booking is until it is paid) and a request is
--     opened in company_booking_approvals.
--   * While a request is open the booking cannot be paid, put on invoice,
--     captured, assigned or moved along (hold_booking_for_approval, for
--     every role, the server's included). Unpaid bookings are already
--     outside the driver pool, dispatch and the invoice run; the hold
--     keeps them there. Only cancelling stays possible.
--   * An owner, admin or finance member approves or refuses with a
--     reason; never the person who booked. Refused and expired requests
--     cancel the booking. It was never paid or invoiced, so there is no
--     fee and nothing to refund.
--   * Every step is written to company_booking_approval_events
--     (append-only); limits and rules go to organization_events.
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Tables ───────────────────────────────────────────────────────────────
-- A member's limits (NULL: no limit). Goes with the membership.
CREATE TABLE IF NOT EXISTS public.organization_member_limits (
  organization_id   uuid        NOT NULL,
  user_id           uuid        NOT NULL,
  per_booking_limit numeric     CHECK (per_booking_limit IS NULL OR per_booking_limit >= 0),   -- NOK incl. MVA
  monthly_limit     numeric     CHECK (monthly_limit IS NULL OR monthly_limit >= 0),           -- NOK incl. MVA
  updated_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES public.organization_members (organization_id, user_id) ON DELETE CASCADE
);

-- The company's approval rules.
CREATE TABLE IF NOT EXISTS public.organization_spending_rules (
  organization_id       uuid        PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  approval_above        numeric     CHECK (approval_above IS NULL OR approval_above >= 0),     -- NOK incl. MVA
  approval_roles        text[]      NOT NULL DEFAULT '{}'
                                    CHECK (approval_roles <@ ARRAY['owner', 'admin', 'booker']::text[]),
  approval_expiry_hours integer     NOT NULL DEFAULT 168 CHECK (approval_expiry_hours BETWEEN 1 AND 720),
  updated_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- One row per company booking the server has checked: within the limits
-- ('not_required'), or a request for approval and how it ended.
CREATE TABLE IF NOT EXISTS public.company_booking_approvals (
  booking_id      uuid        PRIMARY KEY REFERENCES public.bookings (id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  requested_by    uuid        NOT NULL,                     -- the booking's customer, the member who booked
  amount          numeric     NOT NULL CHECK (amount >= 0), -- the server's price, NOK incl. MVA
  reasons         text[]      NOT NULL DEFAULT '{}',        -- per_booking_limit, monthly_limit, amount_over, role
  month_spend     numeric,                                  -- the member's spend this month before this booking
  status          text        NOT NULL CHECK (status IN ('not_required', 'pending', 'approved', 'refused', 'expired', 'withdrawn')),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_reason text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_booking_approvals_refusal_reason CHECK (status <> 'refused' OR length(btrim(coalesce(decision_reason, ''))) > 0),
  CONSTRAINT company_booking_approvals_pending_expiry CHECK (status <> 'pending' OR expires_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS company_booking_approvals_org_idx
  ON public.company_booking_approvals (organization_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS company_booking_approvals_requester_idx
  ON public.company_booking_approvals (requested_by);

-- Append-only, for every role (the server and the database owner
-- included). Its rows go only with the organisation itself.
CREATE TABLE IF NOT EXISTS public.company_booking_approval_events (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  booking_id      uuid        NOT NULL,                     -- no foreign key: the log outlives the booking
  actor_id        uuid,
  action          text        NOT NULL,                     -- within_limits, requested, amount_changed, approved, refused, expired, withdrawn
  details         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_booking_approval_events_idx
  ON public.company_booking_approval_events (organization_id, booking_id, created_at);

CREATE OR REPLACE FUNCTION public.guard_booking_approval_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     OR EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN
    RAISE EXCEPTION 'company_booking_approval_events is append-only' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS guard_booking_approval_events ON public.company_booking_approval_events;
CREATE TRIGGER guard_booking_approval_events
  BEFORE UPDATE OR DELETE ON public.company_booking_approval_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_approval_events();


-- ── 2. Who reads what ───────────────────────────────────────────────────────
-- Owners, admins and finance read the company's limits, requests and
-- log; a member reads their own limits and the requests for bookings they
-- made; every member reads the rules. Platform admins read everything.
-- Nobody writes the tables directly: the functions below do.
ALTER TABLE public.organization_member_limits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_spending_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_booking_approvals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_booking_approval_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_member_limits_select ON public.organization_member_limits;
CREATE POLICY organization_member_limits_select ON public.organization_member_limits
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, ARRAY['owner', 'admin', 'finance'])
         OR user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS organization_spending_rules_select ON public.organization_spending_rules;
CREATE POLICY organization_spending_rules_select ON public.organization_spending_rules
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id) OR public.is_admin());

DROP POLICY IF EXISTS company_booking_approvals_select ON public.company_booking_approvals;
CREATE POLICY company_booking_approvals_select ON public.company_booking_approvals
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, ARRAY['owner', 'admin', 'finance'])
         OR (requested_by = auth.uid() AND public.is_org_member(organization_id))
         OR public.is_admin());

DROP POLICY IF EXISTS company_booking_approval_events_select ON public.company_booking_approval_events;
CREATE POLICY company_booking_approval_events_select ON public.company_booking_approval_events
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, ARRAY['owner', 'admin', 'finance']) OR public.is_admin()
         OR EXISTS (SELECT 1 FROM public.company_booking_approvals a
                     WHERE a.booking_id = company_booking_approval_events.booking_id AND a.requested_by = auth.uid()
                       AND public.is_org_member(a.organization_id)));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organization_member_limits, public.organization_spending_rules,
  public.company_booking_approvals, public.company_booking_approval_events FROM anon, authenticated;
REVOKE ALL ON public.organization_member_limits, public.organization_spending_rules,
  public.company_booking_approvals, public.company_booking_approval_events FROM anon;
GRANT SELECT ON public.organization_member_limits, public.organization_spending_rules,
  public.company_booking_approvals, public.company_booking_approval_events TO authenticated;
GRANT ALL ON public.organization_member_limits, public.organization_spending_rules,
  public.company_booking_approvals, public.company_booking_approval_events TO service_role;


-- ── 3. Spend and limits ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.booking_approval_event(p_org uuid, p_booking uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.company_booking_approval_events (organization_id, booking_id, actor_id, action, details)
  VALUES (p_org, p_booking, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

-- What a member has spent for the company in the Europe/Oslo calendar
-- month of p_at: their company bookings made that month that are not
-- cancelled, and are paid (or on invoice) or have passed the server's
-- check (within the limits, waiting or approved). An unpaid booking the
-- server never checked commits nothing yet.
CREATE OR REPLACE FUNCTION public.member_month_spend(p_org uuid, p_user uuid, p_at timestamptz DEFAULT now(),
                                                     p_exclude uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(sum(coalesce(b.final_price, b.price_estimate, 0)), 0)
    FROM public.bookings b
   WHERE b.organization_id = p_org AND b.customer_id = p_user
     AND b.id IS DISTINCT FROM p_exclude
     AND b.status IS DISTINCT FROM 'cancelled'
     AND date_trunc('month', timezone('Europe/Oslo', b.created_at)) = date_trunc('month', timezone('Europe/Oslo', p_at))
     AND (b.payment_status IN ('paid', 'escrow', 'released')
          OR EXISTS (SELECT 1 FROM public.company_booking_approvals a
                      WHERE a.booking_id = b.id AND a.status IN ('not_required', 'pending', 'approved')));
$$;

-- Why a booking of p_amount by p_user needs approval (empty: it doesn't).
CREATE OR REPLACE FUNCTION public.spending_check_reasons(p_org uuid, p_user uuid, p_booking uuid, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role    text;
  v_limits  public.organization_member_limits%ROWTYPE;
  v_rules   public.organization_spending_rules%ROWTYPE;
  v_spend   numeric := public.member_month_spend(p_org, p_user, now(), p_booking);
  v_reasons text[] := '{}';
BEGIN
  SELECT role INTO v_role FROM public.organization_members WHERE organization_id = p_org AND user_id = p_user;
  SELECT * INTO v_limits FROM public.organization_member_limits WHERE organization_id = p_org AND user_id = p_user;
  SELECT * INTO v_rules FROM public.organization_spending_rules WHERE organization_id = p_org;
  IF v_limits.per_booking_limit IS NOT NULL AND p_amount > v_limits.per_booking_limit THEN
    v_reasons := v_reasons || 'per_booking_limit'::text;
  END IF;
  IF v_limits.monthly_limit IS NOT NULL AND v_spend + p_amount > v_limits.monthly_limit THEN
    v_reasons := v_reasons || 'monthly_limit'::text;
  END IF;
  IF v_rules.approval_above IS NOT NULL AND p_amount > v_rules.approval_above THEN
    v_reasons := v_reasons || 'amount_over'::text;
  END IF;
  IF v_role = ANY (coalesce(v_rules.approval_roles, '{}')) THEN
    v_reasons := v_reasons || 'role'::text;
  END IF;
  RETURN jsonb_build_object('reasons', to_jsonb(v_reasons), 'month_spend', v_spend, 'role', v_role,
    'per_booking_limit', v_limits.per_booking_limit, 'monthly_limit', v_limits.monthly_limit,
    'approval_above', v_rules.approval_above, 'expiry_hours', coalesce(v_rules.approval_expiry_hours, 168));
END $$;


-- ── 4. Setting limits and rules ─────────────────────────────────────────────
-- Owners set anyone's limits; admins those below admin; finance those of
-- bookers, viewers and staff. Nobody sets their own. NULL: no limit.
CREATE OR REPLACE FUNCTION public.set_member_spending_limits(p_org uuid, p_user uuid, p_per_booking numeric, p_monthly numeric)
RETURNS public.organization_member_limits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role   text := public.require_org_role(p_org, ARRAY['owner', 'admin', 'finance']);
  v_target text;
  v_row    public.organization_member_limits%ROWTYPE;
BEGIN
  IF p_user = auth.uid() THEN
    RAISE EXCEPTION 'spending limits: nobody sets their own limits' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_target FROM public.organization_members
   WHERE organization_id = p_org AND user_id = p_user AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'spending limits: not a member of this company' USING ERRCODE = 'P0002'; END IF;
  IF (v_role = 'admin' AND v_target IN ('owner', 'admin'))
     OR (v_role = 'finance' AND v_target IN ('owner', 'admin', 'finance')) THEN
    RAISE EXCEPTION 'spending limits: a % cannot set the limits of a %', v_role, v_target USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.organization_member_limits (organization_id, user_id, per_booking_limit, monthly_limit, updated_by, updated_at)
  VALUES (p_org, p_user, p_per_booking, p_monthly, auth.uid(), now())
  ON CONFLICT (organization_id, user_id) DO UPDATE
     SET per_booking_limit = EXCLUDED.per_booking_limit, monthly_limit = EXCLUDED.monthly_limit,
         updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_row;
  PERFORM public.org_event(p_org, 'spending.limits', p_user,
    jsonb_build_object('per_booking_limit', p_per_booking, 'monthly_limit', p_monthly));
  RETURN v_row;
END $$;

-- Owners, admins and finance set the company's approval rules.
CREATE OR REPLACE FUNCTION public.set_spending_rules(p_org uuid, p_approval_above numeric, p_approval_roles text[],
                                                     p_expiry_hours integer DEFAULT 168)
RETURNS public.organization_spending_rules
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_row public.organization_spending_rules%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'finance']);
  INSERT INTO public.organization_spending_rules (organization_id, approval_above, approval_roles, approval_expiry_hours,
                                                  updated_by, updated_at)
  VALUES (p_org, p_approval_above, coalesce(p_approval_roles, '{}'), coalesce(p_expiry_hours, 168), auth.uid(), now())
  ON CONFLICT (organization_id) DO UPDATE
     SET approval_above = EXCLUDED.approval_above, approval_roles = EXCLUDED.approval_roles,
         approval_expiry_hours = EXCLUDED.approval_expiry_hours, updated_by = EXCLUDED.updated_by,
         updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_row;
  PERFORM public.org_event(p_org, 'spending.rules', NULL, jsonb_build_object(
    'approval_above', p_approval_above, 'approval_roles', to_jsonb(v_row.approval_roles),
    'expiry_hours', v_row.approval_expiry_hours));
  RETURN v_row;
END $$;

-- The team's limits and this month's spend, for the Team tab. Owners,
-- admins and finance see everyone; other members their own row.
CREATE OR REPLACE FUNCTION public.organization_spending(p_org uuid)
RETURNS TABLE (user_id uuid, role text, per_booking_limit numeric, monthly_limit numeric, month_spend numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_org_member(p_org) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'organisation: members only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.user_id, m.role, l.per_booking_limit, l.monthly_limit,
         public.member_month_spend(p_org, m.user_id, now(), NULL)
    FROM public.organization_members m
    LEFT JOIN public.organization_member_limits l ON l.organization_id = m.organization_id AND l.user_id = m.user_id
   WHERE m.organization_id = p_org AND m.status = 'active'
     AND (public.is_org_member(p_org, ARRAY['owner', 'admin', 'finance']) OR public.is_admin() OR m.user_id = auth.uid())
   ORDER BY m.created_at;
END $$;


-- ── 5. The check, the hold and the decision ─────────────────────────────────
-- Ends an open request (refused or expired): the booking is cancelled by
-- the platform with the reason. It was never paid or invoiced: no fee,
-- no refund. Internal.
CREATE OR REPLACE FUNCTION public.end_booking_approval(p_booking uuid, p_status text, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_req public.company_booking_approvals%ROWTYPE;
BEGIN
  IF p_status NOT IN ('refused', 'expired') THEN RAISE EXCEPTION 'end_booking_approval: %', p_status; END IF;
  UPDATE public.company_booking_approvals
     SET status = p_status, decided_by = CASE WHEN p_status = 'refused' THEN auth.uid() END,
         decided_at = now(), decision_reason = p_reason, updated_at = now()
   WHERE booking_id = p_booking AND status = 'pending'
  RETURNING * INTO v_req;
  IF NOT FOUND THEN RETURN; END IF;
  -- Checked by the caller; this write is the function's, not the caller's.
  PERFORM set_config('flyttgo.trusted', 'on', true);
  UPDATE public.bookings
     SET status = 'cancelled', cancelled_by = 'platform',
         cancellation_reason = CASE p_status WHEN 'refused' THEN 'Not approved by the company: ' || p_reason
                                             ELSE 'The company''s approval was not given in time' END
   WHERE id = p_booking AND status IS DISTINCT FROM 'cancelled';
  PERFORM set_config('flyttgo.trusted', 'off', true);
  PERFORM public.booking_approval_event(v_req.organization_id, p_booking, p_status,
    jsonb_build_object('reason', p_reason, 'amount', v_req.amount));
  INSERT INTO public.notifications (user_id, kind, title, body, link_page, link_id)
  VALUES (v_req.requested_by, 'booking_status',
          CASE p_status WHEN 'refused' THEN 'Booking not approved' ELSE 'Approval request expired' END,
          CASE p_status WHEN 'refused' THEN 'Your company did not approve the booking: ' || p_reason || '. It is cancelled without any fee.'
                        ELSE 'No one approved the booking in time. It is cancelled without any fee.' END,
          'my-bookings', p_booking);
END $$;

-- Called by the payment functions (_shared/booking-charge.ts) once they
-- have priced the booking on the server, before any payment is started.
-- p_caller is the signed-in person the function verified; p_amount is the
-- server's price. Returns the outcome:
--   not_company   not a company booking: nothing to check
--   not_required  within the member's limits and the company's rules
--   approved      approved for at least this amount
--   pending       waits for approval ('new' when the request was just made,
--                 with the approvers' addresses for the email)
--   expired       the request ran out (the booking is now cancelled)
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

-- While a request is open the booking stays as it is: not paid, not on
-- invoice, not captured, not assigned to a driver, not moved along. This
-- holds for every role, the server and administrators included, so no
-- payment webhook, invoice booking or manual dispatch can get round it.
-- Cancelling stays possible and withdraws the request.
CREATE OR REPLACE FUNCTION public.hold_booking_for_approval()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_org uuid;
BEGIN
  IF OLD.organization_id IS NULL THEN RETURN NEW; END IF;
  SELECT organization_id INTO v_org FROM public.company_booking_approvals
   WHERE booking_id = OLD.id AND status = 'pending';
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.company_booking_approvals
       SET status = 'withdrawn', decided_by = auth.uid(), decided_at = now(),
           decision_reason = coalesce(NEW.cancellation_reason, 'cancelled'), updated_at = now()
     WHERE booking_id = OLD.id;
    PERFORM public.booking_approval_event(v_org, OLD.id, 'withdrawn', jsonb_build_object('reason', NEW.cancellation_reason));
    RETURN NEW;
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status OR NEW.payment_provider IS DISTINCT FROM OLD.payment_provider
     OR NEW.captured_at IS DISTINCT FROM OLD.captured_at OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'this booking is waiting for the company''s approval: it cannot be paid, invoiced or dispatched yet'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hold_booking_for_approval ON public.bookings;
CREATE TRIGGER hold_booking_for_approval
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.hold_booking_for_approval();

-- An owner, admin or finance member of the (active) company approves or
-- refuses; never the person who booked, whatever their role. A refusal
-- needs a reason and cancels the booking without a fee.
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

-- Ends requests that ran out (the booking is cancelled without a fee).
-- The server runs it for all companies; a member for their own company
-- (the app does before it shows the waiting list).
CREATE OR REPLACE FUNCTION public.expire_booking_approvals(p_org uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r record; n integer := 0;
BEGIN
  IF NOT public.is_server() AND (p_org IS NULL OR NOT public.is_org_member(p_org)) THEN
    RAISE EXCEPTION 'expire_booking_approvals: members of the company only' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT booking_id FROM public.company_booking_approvals
     WHERE status = 'pending' AND expires_at <= now() AND (p_org IS NULL OR organization_id = p_org)
     ORDER BY expires_at FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.end_booking_approval(r.booking_id, 'expired', NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;


-- ── 6. Privileges ──────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.guard_booking_approval_events()', 'public.booking_approval_event(uuid, uuid, text, jsonb)',
    'public.member_month_spend(uuid, uuid, timestamptz, uuid)', 'public.spending_check_reasons(uuid, uuid, uuid, numeric)',
    'public.set_member_spending_limits(uuid, uuid, numeric, numeric)', 'public.set_spending_rules(uuid, numeric, text[], integer)',
    'public.organization_spending(uuid)', 'public.end_booking_approval(uuid, text, text)',
    'public.company_booking_check(uuid, uuid, numeric)', 'public.hold_booking_for_approval()',
    'public.decide_booking_approval(uuid, boolean, text)', 'public.expire_booking_approvals(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.company_booking_check(uuid, uuid, numeric), public.expire_booking_approvals(uuid),
  public.member_month_spend(uuid, uuid, timestamptz, uuid) TO service_role;
-- Callable from the app (each checks its caller).
GRANT EXECUTE ON FUNCTION public.set_member_spending_limits(uuid, uuid, numeric, numeric),
  public.set_spending_rules(uuid, numeric, text[], integer), public.organization_spending(uuid),
  public.decide_booking_approval(uuid, boolean, text), public.expire_booking_approvals(uuid)
  TO authenticated, service_role;

-- ============================================================================
-- DONE
-- ============================================================================
