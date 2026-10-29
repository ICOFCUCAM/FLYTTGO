-- ============================================================================
-- FlyttGo — invoicing (step 5 of the corporate plan)
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00007. Decided 2026-10-29
-- (docs/INVOICING.md): FlyttGo issues the invoices itself, with its own
-- invoice system.
--
--   * Invoices follow bokføringsforskriften:
--       - a sequential number without gaps, given when the invoice is issued;
--       - seller and buyer with organisation numbers, invoice date, delivery
--         date or period, lines with quantity, price and VAT per rate, totals,
--         due date, bank account and KID;
--       - an issued invoice is never changed or deleted; corrections are
--         credit notes.
--   * Company bookings can be paid on invoice ('book-on-invoice'). The
--     price is the server's; the company must be active, have invoicing
--     switched on by FlyttGo, be within its credit limit and, when the
--     admin setting "credit_check_enabled" is on, have a passed credit
--     check.
--   * Each company chooses its payment terms: 14 or 30 days, any number of
--     days up to 60, or a fixed day of the following month. It also chooses
--     to be invoiced per booking or once a month (samlefaktura).
--   * Companies on the special price plan get their registered name and
--     logo on their invoices.
--   * Payments are recorded by hand or matched by KID from a bank file. A
--     reminder (purring) carries the fee and interest set in the admin
--     settings. Every step goes to invoice_events.
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Settings (platform_config, admin only) ───────────────────────────────
-- The seller's legal details are FlyttGo's and must be filled in before
-- the first invoice can be issued (issue_invoice refuses otherwise).
INSERT INTO public.platform_config (config_key, config_value)
SELECT k, v FROM (VALUES
  ('invoice_seller_name', ''), ('invoice_seller_org_number', ''), ('invoice_seller_vat_registered', 'true'),
  ('invoice_seller_address', ''), ('invoice_seller_postcode_city', ''), ('invoice_seller_email', ''),
  ('invoice_seller_phone', ''), ('invoice_seller_bank_account', ''), ('invoice_seller_iban', ''), ('invoice_seller_bic', ''),
  ('invoice_reminder_after_days', '7'), ('invoice_reminder_fee', '0'), ('invoice_late_interest_pct', ''),
  ('credit_check_enabled', 'false'), ('credit_check_max_age_days', '365'), ('credit_check_provider', 'manual')
) AS c(k, v)
WHERE NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = c.k);

CREATE OR REPLACE FUNCTION public.config_text(p_key text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT nullif(btrim(config_value), '') FROM public.platform_config WHERE config_key = p_key; $$;


-- ── 2. Companies: billing terms, invoicing, plan, logo ──────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS payment_terms_type   text    NOT NULL DEFAULT 'days',
  ADD COLUMN IF NOT EXISTS payment_terms_days   integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS payment_terms_day    integer,
  ADD COLUMN IF NOT EXISTS invoice_cycle        text    NOT NULL DEFAULT 'per_booking',
  ADD COLUMN IF NOT EXISTS invoice_reference    text,
  ADD COLUMN IF NOT EXISTS invoicing_enabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_limit         numeric,
  ADD COLUMN IF NOT EXISTS billing_plan         text    NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS logo_path            text,
  ADD COLUMN IF NOT EXISTS customer_number      bigint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_billing_terms_check') THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_billing_terms_check CHECK (
          payment_terms_type IN ('days', 'day_of_month')
      AND payment_terms_days BETWEEN 1 AND 60
      AND (payment_terms_day IS NULL OR payment_terms_day BETWEEN 1 AND 28)
      AND (payment_terms_type <> 'day_of_month' OR payment_terms_day IS NOT NULL)
      AND invoice_cycle IN ('per_booking', 'monthly')
      AND billing_plan IN ('standard', 'special')
      AND (credit_limit IS NULL OR credit_limit >= 0));
  END IF;
END $$;
CREATE SEQUENCE IF NOT EXISTS public.organization_customer_number_seq START 10001;
UPDATE public.organizations SET customer_number = nextval('public.organization_customer_number_seq') WHERE customer_number IS NULL;
ALTER TABLE public.organizations ALTER COLUMN customer_number SET DEFAULT nextval('public.organization_customer_number_seq');
CREATE UNIQUE INDEX IF NOT EXISTS organizations_customer_number_key ON public.organizations (customer_number);

-- The company chooses its terms and cycle (owner, admin, finance).
CREATE OR REPLACE FUNCTION public.set_billing_preferences(
  p_org uuid, p_terms_type text, p_terms_days integer, p_terms_day integer, p_cycle text, p_reference text)
RETURNS public.organizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org public.organizations%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'finance']);
  UPDATE public.organizations SET
    payment_terms_type = p_terms_type,
    payment_terms_days = coalesce(p_terms_days, payment_terms_days),
    payment_terms_day  = CASE WHEN p_terms_type = 'day_of_month' THEN p_terms_day ELSE NULL END,
    invoice_cycle      = p_cycle,
    invoice_reference  = nullif(btrim(coalesce(p_reference, '')), ''),
    updated_at         = now()
   WHERE id = p_org RETURNING * INTO v_org;
  PERFORM public.org_event(p_org, 'billing.preferences', NULL, jsonb_build_object(
    'terms_type', p_terms_type, 'terms_days', p_terms_days, 'terms_day', p_terms_day, 'cycle', p_cycle));
  RETURN v_org;
END $$;

-- FlyttGo switches invoicing on, sets the credit limit and the plan.
CREATE OR REPLACE FUNCTION public.admin_set_invoicing(p_org uuid, p_enabled boolean, p_credit_limit numeric, p_plan text)
RETURNS public.organizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org public.organizations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'invoicing: platform administrators only' USING ERRCODE = '42501';
  END IF;
  IF p_enabled AND public.config_text('credit_check_enabled') = 'true'
     AND NOT public.has_current_credit_check(p_org) THEN
    RAISE EXCEPTION 'invoicing: a passed credit check is required (the admin setting is on)' USING ERRCODE = '55000';
  END IF;
  UPDATE public.organizations SET invoicing_enabled = p_enabled, credit_limit = p_credit_limit,
         billing_plan = coalesce(p_plan, billing_plan), updated_at = now()
   WHERE id = p_org RETURNING * INTO v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.org_event(p_org, 'billing.invoicing', NULL,
    jsonb_build_object('enabled', p_enabled, 'credit_limit', p_credit_limit, 'plan', v_org.billing_plan));
  RETURN v_org;
END $$;

-- Logo: owners and admins upload it; it is used on invoices only on the
-- special plan. PNG or JPEG, under the company's own folder.
CREATE OR REPLACE FUNCTION public.org_folder_member(p_name text, p_roles text[] DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_folder text := split_part(coalesce(p_name, ''), '/', 1);
BEGIN
  IF v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  RETURN public.is_org_member(v_folder::uuid, p_roles);
END $$;
REVOKE ALL ON FUNCTION public.org_folder_member(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_folder_member(text, text[]) TO authenticated, service_role;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'organization-logos', 'organization-logos', false, 1048576, ARRAY['image/png', 'image/jpeg']
 WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'organization-logos');
DROP POLICY IF EXISTS organization_logos_read ON storage.objects;
CREATE POLICY organization_logos_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'organization-logos'
         AND (public.is_admin() OR public.org_folder_member(name)));
DROP POLICY IF EXISTS organization_logos_write ON storage.objects;
CREATE POLICY organization_logos_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'organization-logos'
              AND public.org_folder_member(name, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS organization_logos_update ON storage.objects;
CREATE POLICY organization_logos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'organization-logos'
         AND public.org_folder_member(name, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS organization_logos_delete ON storage.objects;
CREATE POLICY organization_logos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'organization-logos'
         AND public.org_folder_member(name, ARRAY['owner', 'admin']));

CREATE OR REPLACE FUNCTION public.set_organization_logo(p_org uuid, p_path text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  IF p_path IS NOT NULL AND split_part(p_path, '/', 1) <> p_org::text THEN
    RAISE EXCEPTION 'logo must be in the company''s own folder' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organizations SET logo_path = p_path, updated_at = now() WHERE id = p_org;
  PERFORM public.org_event(p_org, 'organization.logo', NULL, jsonb_build_object('path', p_path));
END $$;


-- ── 3. Credit checks (behind the admin setting) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_checks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  provider          text        NOT NULL,               -- 'manual' or a provider's name
  passed            boolean     NOT NULL,
  score             text,
  recommended_limit numeric,
  findings          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  checked_by        uuid,
  checked_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_checks_org_idx ON public.credit_checks (organization_id, checked_at DESC);
ALTER TABLE public.credit_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_checks_admin_select ON public.credit_checks;
CREATE POLICY credit_checks_admin_select ON public.credit_checks FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.credit_checks FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.credit_checks FROM authenticated;
GRANT SELECT ON public.credit_checks TO authenticated;
GRANT ALL ON public.credit_checks TO service_role;

CREATE OR REPLACE FUNCTION public.has_current_credit_check(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.credit_checks
                  WHERE organization_id = p_org AND passed
                    AND checked_at > now() - make_interval(days => coalesce(public.config_text('credit_check_max_age_days')::int, 365)));
$$;

-- A provider's result (the credit-check function, server) or an
-- administrator's manual assessment with its evidence.
CREATE OR REPLACE FUNCTION public.record_credit_check(
  p_org uuid, p_provider text, p_passed boolean, p_score text, p_recommended_limit numeric, p_findings jsonb)
RETURNS public.credit_checks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v public.credit_checks%ROWTYPE;
BEGIN
  IF p_provider = 'manual' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'credit checks: platform administrators only' USING ERRCODE = '42501';
  END IF;
  IF p_provider <> 'manual' AND NOT public.is_server() THEN
    RAISE EXCEPTION 'provider credit checks are recorded by the server' USING ERRCODE = '42501';
  END IF;
  IF p_provider = 'manual' AND coalesce(btrim(p_findings ->> 'evidence'), '') = '' THEN
    RAISE EXCEPTION 'a manual credit check needs its evidence' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.credit_checks (organization_id, provider, passed, score, recommended_limit, findings, checked_by)
  VALUES (p_org, p_provider, p_passed, p_score, p_recommended_limit, coalesce(p_findings, '{}'::jsonb), auth.uid())
  RETURNING * INTO v;
  PERFORM public.org_event(p_org, 'billing.credit_check', NULL, jsonb_build_object('provider', p_provider, 'passed', p_passed));
  RETURN v;
END $$;


-- ── 4. Invoices ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_counters (series text PRIMARY KEY, next_number bigint NOT NULL);
INSERT INTO public.invoice_counters (series, next_number) VALUES ('main', 1) ON CONFLICT DO NOTHING;
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_counters FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.invoices (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text        NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'credit_note')),
  number             bigint      UNIQUE,                  -- given at issue, never reused
  credits_invoice_id uuid        REFERENCES public.invoices (id),
  organization_id    uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  status             text        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'credited')),
  issue_date         date,
  delivery_from      date,
  delivery_to        date,
  due_date           date,
  currency           text        NOT NULL DEFAULT 'NOK',
  kid                text,
  buyer              jsonb,                               -- snapshot at issue
  seller             jsonb,                               -- snapshot at issue
  branding           jsonb,                               -- name + logo on the special plan
  reference          text,                                -- the buyer's reference ("Deres ref.")
  notes              text,
  net_total          numeric     NOT NULL DEFAULT 0,
  vat_total          numeric     NOT NULL DEFAULT 0,
  total              numeric     NOT NULL DEFAULT 0,
  amount_paid        numeric     NOT NULL DEFAULT 0,
  amount_credited    numeric     NOT NULL DEFAULT 0,
  fees_total         numeric     NOT NULL DEFAULT 0,      -- reminder fees and interest
  reminder_level     integer     NOT NULL DEFAULT 0,
  sent_at            timestamptz,
  created_by         uuid,
  issued_by          uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_issued_complete CHECK (status = 'draft' OR (number IS NOT NULL AND issue_date IS NOT NULL
                                             AND due_date IS NOT NULL AND seller IS NOT NULL AND buyer IS NOT NULL)),
  CONSTRAINT invoices_credit_note_link CHECK ((kind = 'credit_note') = (credits_invoice_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS invoices_org_idx ON public.invoices (organization_id, issue_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_kid_key ON public.invoices (kid) WHERE kid IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_lines (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid    NOT NULL REFERENCES public.invoices (id) ON DELETE CASCADE,
  line_no     integer NOT NULL,
  booking_id  uuid    REFERENCES public.bookings (id),
  is_credit   boolean NOT NULL DEFAULT false,
  description text    NOT NULL,
  quantity    numeric NOT NULL DEFAULT 1,
  unit_price  numeric NOT NULL,                 -- excluding VAT
  vat_rate    numeric NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 12, 15, 25)),
  net_amount  numeric NOT NULL,
  vat_amount  numeric NOT NULL,
  total       numeric NOT NULL,
  UNIQUE (invoice_id, line_no)
);
-- A booking is charged on one invoice only.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_lines_booking_once
  ON public.invoice_lines (booking_id) WHERE booking_id IS NOT NULL AND NOT is_credit;

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid        NOT NULL REFERENCES public.invoices (id),
  amount      numeric     NOT NULL CHECK (amount > 0),
  paid_on     date        NOT NULL,
  method      text        NOT NULL CHECK (method IN ('bank', 'card', 'vipps', 'other')),
  reference   text,
  recorded_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- A bank transaction is recorded once.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_bank_reference_once
  ON public.invoice_payments (reference) WHERE method = 'bank' AND reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_reminders (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid        NOT NULL REFERENCES public.invoices (id),
  level      integer     NOT NULL,
  fee        numeric     NOT NULL DEFAULT 0,
  interest   numeric     NOT NULL DEFAULT 0,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, level)
);

CREATE TABLE IF NOT EXISTS public.invoice_events (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id uuid        NOT NULL REFERENCES public.invoices (id),
  actor_id   uuid,
  action     text        NOT NULL,
  details    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_events_invoice_idx ON public.invoice_events (invoice_id, created_at);

-- Who sees invoices: the company's owners, admins and finance, and
-- platform administrators. Nobody writes the tables directly.
ALTER TABLE public.invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_events    ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_read_invoice(p_invoice uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.id = p_invoice AND i.status <> 'draft'
       AND public.is_org_member(i.organization_id, ARRAY['owner', 'admin', 'finance']));
$$;

DROP POLICY IF EXISTS invoices_select ON public.invoices;
CREATE POLICY invoices_select ON public.invoices FOR SELECT TO authenticated USING (public.can_read_invoice(id));
DROP POLICY IF EXISTS invoice_lines_select ON public.invoice_lines;
CREATE POLICY invoice_lines_select ON public.invoice_lines FOR SELECT TO authenticated USING (public.can_read_invoice(invoice_id));
DROP POLICY IF EXISTS invoice_payments_select ON public.invoice_payments;
CREATE POLICY invoice_payments_select ON public.invoice_payments FOR SELECT TO authenticated USING (public.can_read_invoice(invoice_id));
DROP POLICY IF EXISTS invoice_reminders_select ON public.invoice_reminders;
CREATE POLICY invoice_reminders_select ON public.invoice_reminders FOR SELECT TO authenticated USING (public.can_read_invoice(invoice_id));
DROP POLICY IF EXISTS invoice_events_select ON public.invoice_events;
CREATE POLICY invoice_events_select ON public.invoice_events FOR SELECT TO authenticated USING (public.is_admin());

REVOKE ALL ON public.invoices, public.invoice_lines, public.invoice_payments, public.invoice_reminders,
  public.invoice_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.invoices, public.invoice_lines, public.invoice_payments,
  public.invoice_reminders, public.invoice_events FROM authenticated;
GRANT SELECT ON public.invoices, public.invoice_lines, public.invoice_payments, public.invoice_reminders,
  public.invoice_events TO authenticated;
GRANT ALL ON public.invoices, public.invoice_lines, public.invoice_payments, public.invoice_reminders,
  public.invoice_events, public.invoice_counters TO service_role;

-- An issued invoice is final, for every role (the database owner too):
-- only its payment state and dispatch marks move. Lines change only on
-- drafts; issued invoices, their payments and events are never deleted.
CREATE OR REPLACE FUNCTION public.guard_invoice_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_changed text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'an issued invoice is never deleted; issue a credit note' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  v_changed := public.changed_columns(to_jsonb(OLD), to_jsonb(NEW),
    ARRAY['status', 'amount_paid', 'amount_credited', 'fees_total', 'reminder_level', 'sent_at', 'updated_at']);
  IF cardinality(v_changed) > 0 THEN
    RAISE EXCEPTION 'an issued invoice cannot be changed (%); issue a credit note', array_to_string(v_changed, ', ') USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'draft' THEN RAISE EXCEPTION 'an issued invoice cannot go back to draft' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_invoice_write ON public.invoices;
CREATE TRIGGER guard_invoice_write BEFORE UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_write();

CREATE OR REPLACE FUNCTION public.guard_invoice_line_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
BEGIN
  -- Deleting a draft invoice cascades to its lines.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_inv) THEN RETURN OLD; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_inv AND status = 'draft') THEN
    RAISE EXCEPTION 'lines change only on draft invoices' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS guard_invoice_line_write ON public.invoice_lines;
CREATE TRIGGER guard_invoice_line_write BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_line_write();

CREATE OR REPLACE FUNCTION public.guard_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS guard_invoice_payments ON public.invoice_payments;
CREATE TRIGGER guard_invoice_payments BEFORE UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
DROP TRIGGER IF EXISTS guard_invoice_events ON public.invoice_events;
CREATE TRIGGER guard_invoice_events BEFORE UPDATE OR DELETE ON public.invoice_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
DROP TRIGGER IF EXISTS guard_invoice_reminders ON public.invoice_reminders;
CREATE TRIGGER guard_invoice_reminders BEFORE UPDATE OR DELETE ON public.invoice_reminders
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();

CREATE OR REPLACE FUNCTION public.invoice_event(p_invoice uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.invoice_events (invoice_id, actor_id, action, details)
  VALUES (p_invoice, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

-- What remains to be paid (fees included; credit notes count as paid).
CREATE OR REPLACE FUNCTION public.invoice_outstanding(i public.invoices)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$ SELECT round(i.total + i.fees_total - i.amount_paid - i.amount_credited, 2); $$;

-- KID: the invoice number, eight digits, with a MOD10 (Luhn) check digit.
CREATE OR REPLACE FUNCTION public.kid_mod10(p_base text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE s int := 0; d int; dbl boolean := true;
BEGIN
  FOR i IN REVERSE length(p_base)..1 LOOP
    d := substr(p_base, i, 1)::int;
    IF dbl THEN d := d * 2; IF d > 9 THEN d := d - 9; END IF; END IF;
    s := s + d; dbl := NOT dbl;
  END LOOP;
  RETURN p_base || ((10 - s % 10) % 10)::text;
END $$;

-- The due date from the company's terms.
CREATE OR REPLACE FUNCTION public.invoice_due_date(p_issue date, p_type text, p_days integer, p_day integer)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN p_type = 'day_of_month'
              THEN (date_trunc('month', p_issue) + interval '1 month')::date + (p_day - 1)
              ELSE p_issue + p_days END;
$$;

CREATE OR REPLACE FUNCTION public.require_billing_operator()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_server()) THEN
    RAISE EXCEPTION 'invoices: FlyttGo administrators and the server only' USING ERRCODE = '42501';
  END IF;
END $$;

-- The charge of a booking on an invoice: what the booking costs (with an
-- approved over-time adjustment), or the fee a late cancellation keeps.
-- Prices include 25% MVA; the line shows them without.
CREATE OR REPLACE FUNCTION public.booking_invoice_amount(p_booking uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT round(coalesce(
           CASE WHEN e.adjustment_approved AND e.adjusted_amount IS NOT NULL THEN e.adjusted_amount END,
           b.final_price, b.price_estimate, 0), 2)
    FROM public.bookings b LEFT JOIN public.escrow_payments e ON e.booking_id = b.id
   WHERE b.id = p_booking;
$$;

-- A draft invoice for a company, with a line per booking given (company
-- bookings paid on invoice, not yet invoiced). p_amounts may override the
-- booking amount per booking (cancellation fees), in the same order.
CREATE OR REPLACE FUNCTION public.create_invoice_draft(p_org uuid, p_bookings uuid[], p_amounts numeric[] DEFAULT NULL,
                                                      p_notes text DEFAULT NULL)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_b   public.bookings%ROWTYPE;
  v_amt numeric;
  v_net numeric;
  n     int := 0;
BEGIN
  PERFORM public.require_billing_operator();
  INSERT INTO public.invoices (organization_id, notes, created_by) VALUES (p_org, p_notes, auth.uid()) RETURNING * INTO v_inv;
  FOR i IN 1..coalesce(array_length(p_bookings, 1), 0) LOOP
    SELECT * INTO v_b FROM public.bookings WHERE id = p_bookings[i];
    IF NOT FOUND OR v_b.organization_id IS DISTINCT FROM p_org THEN
      RAISE EXCEPTION 'booking % is not a booking of this company', p_bookings[i] USING ERRCODE = '22023';
    END IF;
    IF v_b.payment_provider IS DISTINCT FROM 'invoice' THEN
      RAISE EXCEPTION 'booking % was not booked on invoice', p_bookings[i] USING ERRCODE = '22023';
    END IF;
    v_amt := round(coalesce(p_amounts[i], public.booking_invoice_amount(v_b.id)), 2);
    IF v_amt <= 0 THEN CONTINUE; END IF;
    v_net := round(v_amt / 1.25, 2);
    n := n + 1;
    INSERT INTO public.invoice_lines (invoice_id, line_no, booking_id, description, quantity, unit_price, vat_rate,
                                      net_amount, vat_amount, total)
    VALUES (v_inv.id, n, v_b.id,
            CASE WHEN v_b.status = 'cancelled' THEN 'Cancellation fee, booking ' ELSE 'Moving service, booking ' END
              || left(v_b.id::text, 8) || coalesce(', ' || v_b.pickup_city || ' – ' || v_b.dropoff_city, '')
              || coalesce(', ' || to_char(v_b.move_date AT TIME ZONE 'Europe/Oslo', 'DD.MM.YYYY'), ''),
            1, v_net, 25, v_net, v_amt - v_net, v_amt);
  END LOOP;
  UPDATE public.invoices SET
    net_total = coalesce((SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id), 0),
    vat_total = coalesce((SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id), 0),
    total     = coalesce((SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_inv.id), 0),
    delivery_from = (SELECT min((b.move_date AT TIME ZONE 'Europe/Oslo')::date) FROM public.bookings b WHERE b.id = ANY (p_bookings)),
    delivery_to   = (SELECT max((b.move_date AT TIME ZONE 'Europe/Oslo')::date) FROM public.bookings b WHERE b.id = ANY (p_bookings))
   WHERE id = v_inv.id RETURNING * INTO v_inv;
  RETURN v_inv;                     -- the event log starts when the invoice is issued
END $$;

-- A manual line on a draft (for example a service outside a booking).
CREATE OR REPLACE FUNCTION public.add_invoice_line(p_invoice uuid, p_description text, p_quantity numeric,
                                                  p_unit_price numeric, p_vat_rate numeric DEFAULT 25)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv public.invoices%ROWTYPE; v_net numeric; v_vat numeric;
BEGIN
  PERFORM public.require_billing_operator();
  IF coalesce(btrim(p_description), '') = '' OR p_quantity <= 0 OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'a line needs a description, a quantity above 0 and a price' USING ERRCODE = '22023';
  END IF;
  v_net := round(p_quantity * p_unit_price, 2);
  v_vat := round(v_net * p_vat_rate / 100, 2);
  INSERT INTO public.invoice_lines (invoice_id, line_no, description, quantity, unit_price, vat_rate, net_amount, vat_amount, total)
  VALUES (p_invoice, coalesce((SELECT max(line_no) FROM public.invoice_lines WHERE invoice_id = p_invoice), 0) + 1,
          btrim(p_description), p_quantity, p_unit_price, p_vat_rate, v_net, v_vat, v_net + v_vat);
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = p_invoice),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = p_invoice),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = p_invoice),
    updated_at = now()
   WHERE id = p_invoice RETURNING * INTO v_inv;
  RETURN v_inv;
END $$;

-- The seller as invoices state it, from the settings.
CREATE OR REPLACE FUNCTION public.invoice_seller()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'name', public.config_text('invoice_seller_name'),
    'org_number', public.config_text('invoice_seller_org_number'),
    'vat_registered', coalesce(public.config_text('invoice_seller_vat_registered'), 'true') = 'true',
    'address', public.config_text('invoice_seller_address'),
    'postcode_city', public.config_text('invoice_seller_postcode_city'),
    'email', public.config_text('invoice_seller_email'),
    'phone', public.config_text('invoice_seller_phone'),
    'bank_account', public.config_text('invoice_seller_bank_account'),
    'iban', public.config_text('invoice_seller_iban'),
    'bic', public.config_text('invoice_seller_bic'));
$$;

-- Issue: the next number in the series, today's date, the due date from
-- the company's terms, KID, and snapshots of seller, buyer and branding.
-- From here on the invoice is final.
CREATE OR REPLACE FUNCTION public.issue_invoice(p_invoice uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv    public.invoices%ROWTYPE;
  v_org    public.organizations%ROWTYPE;
  v_seller jsonb := public.invoice_seller();
  v_number bigint;
  v_issue  date := (now() AT TIME ZONE 'Europe/Oslo')::date;
BEGIN
  PERFORM public.require_billing_operator();
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found' USING ERRCODE = 'P0002'; END IF;
  IF v_inv.status <> 'draft' THEN RAISE EXCEPTION 'invoice % is already issued', v_inv.number USING ERRCODE = '55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoice_lines WHERE invoice_id = p_invoice) THEN
    RAISE EXCEPTION 'an invoice needs at least one line' USING ERRCODE = '22023';
  END IF;
  IF v_seller ->> 'name' IS NULL OR v_seller ->> 'org_number' IS NULL OR v_seller ->> 'bank_account' IS NULL
     OR v_seller ->> 'address' IS NULL THEN
    RAISE EXCEPTION 'fill in the seller''s name, organisation number, address and bank account in the invoice settings first'
      USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_org FROM public.organizations WHERE id = v_inv.organization_id;

  UPDATE public.invoice_counters SET next_number = next_number + 1 WHERE series = 'main'
  RETURNING next_number - 1 INTO v_number;

  UPDATE public.invoices SET
    number     = v_number,
    status     = 'issued',
    issue_date = v_issue,
    due_date   = CASE WHEN kind = 'credit_note' THEN v_issue
                      ELSE public.invoice_due_date(v_issue, v_org.payment_terms_type, v_org.payment_terms_days, v_org.payment_terms_day) END,
    kid        = CASE WHEN kind = 'invoice' THEN public.kid_mod10(lpad(v_number::text, 8, '0')) END,
    seller     = v_seller,
    buyer      = jsonb_build_object('name', v_org.name, 'org_number', v_org.org_number, 'country', v_org.country,
                                    'address', v_org.billing_address, 'email', v_org.billing_email,
                                    'customer_number', v_org.customer_number, 'vat_registered', v_org.vat_registered),
    branding   = CASE WHEN v_org.billing_plan = 'special'
                      THEN jsonb_build_object('name', v_org.name, 'logo_path', v_org.logo_path) END,
    reference  = coalesce(reference, v_org.invoice_reference),
    issued_by  = auth.uid(),
    updated_at = now()
   WHERE id = p_invoice RETURNING * INTO v_inv;
  PERFORM public.invoice_event(p_invoice, 'invoice.issued', jsonb_build_object('number', v_number, 'total', v_inv.total));

  -- A credit note reduces what its invoice still owes.
  IF v_inv.kind = 'credit_note' THEN
    UPDATE public.invoices o SET amount_credited = o.amount_credited - v_inv.total, updated_at = now()
     WHERE o.id = v_inv.credits_invoice_id;
    PERFORM public.invoice_settle_status(v_inv.credits_invoice_id);
  END IF;
  RETURN v_inv;
END $$;

CREATE OR REPLACE FUNCTION public.invoice_settle_status(p_invoice uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v public.invoices%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.invoices WHERE id = p_invoice;
  IF v.kind <> 'invoice' OR v.status = 'draft' THEN RETURN; END IF;
  UPDATE public.invoices SET status = CASE
      WHEN v.amount_credited >= v.total AND v.amount_paid = 0 THEN 'credited'
      WHEN public.invoice_outstanding(v) <= 0 THEN 'paid'
      WHEN v.amount_paid > 0 OR v.amount_credited > 0 THEN 'partially_paid'
      ELSE 'issued' END,
    updated_at = now()
   WHERE id = p_invoice;
END $$;

-- Drafts that are not wanted are deleted (they have no number).
CREATE OR REPLACE FUNCTION public.delete_invoice_draft(p_invoice uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.require_billing_operator();
  DELETE FROM public.invoices WHERE id = p_invoice AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'only a draft can be deleted' USING ERRCODE = '55000'; END IF;
END $$;

-- A credit note for the whole invoice (p_amount NULL) or part of it
-- (p_amount incl. VAT, split at 25%). Issued at once.
CREATE OR REPLACE FUNCTION public.create_credit_note(p_invoice uuid, p_amount numeric, p_reason text)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_cn  public.invoices%ROWTYPE;
  v_left numeric;
  v_net numeric;
BEGIN
  PERFORM public.require_billing_operator();
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'a credit note needs a reason' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR v_inv.kind <> 'invoice' OR v_inv.status = 'draft' THEN
    RAISE EXCEPTION 'only an issued invoice can be credited' USING ERRCODE = '55000';
  END IF;
  v_left := v_inv.total - v_inv.amount_credited;
  IF p_amount IS NOT NULL AND (p_amount <= 0 OR p_amount > v_left) THEN
    RAISE EXCEPTION 'credit between 0 and % NOK', v_left USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invoices (kind, credits_invoice_id, organization_id, notes, reference, delivery_from, delivery_to, created_by)
  VALUES ('credit_note', p_invoice, v_inv.organization_id,
          'Credit note for invoice ' || v_inv.number || ': ' || btrim(p_reason), v_inv.reference,
          v_inv.delivery_from, v_inv.delivery_to, auth.uid())
  RETURNING * INTO v_cn;

  IF p_amount IS NULL AND v_inv.amount_credited = 0 THEN
    INSERT INTO public.invoice_lines (invoice_id, line_no, booking_id, is_credit, description, quantity, unit_price,
                                      vat_rate, net_amount, vat_amount, total)
    SELECT v_cn.id, line_no, booking_id, true, 'Credit: ' || description, quantity, -unit_price, vat_rate,
           -net_amount, -vat_amount, -total
      FROM public.invoice_lines WHERE invoice_id = p_invoice;
  ELSE
    v_net := round(coalesce(p_amount, v_left) / 1.25, 2);
    INSERT INTO public.invoice_lines (invoice_id, line_no, is_credit, description, quantity, unit_price, vat_rate,
                                      net_amount, vat_amount, total)
    VALUES (v_cn.id, 1, true, 'Credit of invoice ' || v_inv.number || ': ' || btrim(p_reason), 1, -v_net, 25,
            -v_net, -(coalesce(p_amount, v_left) - v_net), -coalesce(p_amount, v_left));
  END IF;
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_cn.id),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_cn.id),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_cn.id)
   WHERE id = v_cn.id;
  PERFORM public.invoice_event(p_invoice, 'invoice.credited', jsonb_build_object('reason', p_reason, 'amount', p_amount));
  RETURN public.issue_invoice(v_cn.id);
END $$;

-- A payment against an invoice. Never more than is owed.
CREATE OR REPLACE FUNCTION public.record_invoice_payment(p_invoice uuid, p_amount numeric, p_paid_on date,
                                                        p_method text, p_reference text)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv public.invoices%ROWTYPE;
BEGIN
  PERFORM public.require_billing_operator();
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR v_inv.kind <> 'invoice' OR v_inv.status = 'draft' THEN
    RAISE EXCEPTION 'payments are recorded against issued invoices' USING ERRCODE = '55000';
  END IF;
  IF p_amount <= 0 OR p_amount > public.invoice_outstanding(v_inv) THEN
    RAISE EXCEPTION 'payment of % NOK is more than the % NOK owed', p_amount, public.invoice_outstanding(v_inv) USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.invoice_payments (invoice_id, amount, paid_on, method, reference, recorded_by)
  VALUES (p_invoice, p_amount, coalesce(p_paid_on, current_date), p_method, nullif(btrim(coalesce(p_reference, '')), ''), auth.uid());
  UPDATE public.invoices SET amount_paid = amount_paid + p_amount, updated_at = now() WHERE id = p_invoice;
  PERFORM public.invoice_settle_status(p_invoice);
  PERFORM public.invoice_event(p_invoice, 'invoice.payment', jsonb_build_object('amount', p_amount, 'method', p_method, 'reference', p_reference));
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice;
  RETURN v_inv;
END $$;

-- A bank transaction matched by KID (bank file import). Returns the
-- invoice, or NULL when the KID matches none (left for manual matching).
-- A transaction already recorded (same bank reference) is not counted again.
CREATE OR REPLACE FUNCTION public.record_payment_by_kid(p_kid text, p_amount numeric, p_paid_on date, p_bank_reference text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.require_billing_operator();
  IF p_bank_reference IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_payments
                                               WHERE method = 'bank' AND reference = p_bank_reference) THEN
    RETURN (SELECT invoice_id FROM public.invoice_payments WHERE method = 'bank' AND reference = p_bank_reference);
  END IF;
  SELECT id INTO v_id FROM public.invoices WHERE kid = regexp_replace(coalesce(p_kid, ''), '\s', '', 'g');
  IF v_id IS NULL THEN RETURN NULL; END IF;
  PERFORM public.record_invoice_payment(v_id, p_amount, p_paid_on, 'bank', p_bank_reference);
  RETURN v_id;
END $$;

-- A reminder for an overdue invoice: the fee and interest come from the
-- settings (none unless set). Recorded once per level.
CREATE OR REPLACE FUNCTION public.record_invoice_reminder(p_invoice uuid)
RETURNS public.invoice_reminders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_rem public.invoice_reminders%ROWTYPE;
  v_fee numeric := coalesce(public.config_text('invoice_reminder_fee')::numeric, 0);
  v_pct numeric := public.config_text('invoice_late_interest_pct')::numeric;
  v_interest numeric := 0;
BEGIN
  PERFORM public.require_billing_operator();
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR v_inv.kind <> 'invoice' OR v_inv.status NOT IN ('issued', 'partially_paid') THEN
    RAISE EXCEPTION 'only an unpaid issued invoice gets a reminder' USING ERRCODE = '55000';
  END IF;
  IF v_inv.due_date >= (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'invoice % is not overdue', v_inv.number USING ERRCODE = '55000';
  END IF;
  IF v_pct IS NOT NULL THEN
    -- Simple interest on what is owed (without earlier fees) since the due date.
    v_interest := round((v_inv.total - v_inv.amount_paid - v_inv.amount_credited) * v_pct / 100
                        * ((now() AT TIME ZONE 'Europe/Oslo')::date - v_inv.due_date) / 365.0, 2);
  END IF;
  INSERT INTO public.invoice_reminders (invoice_id, level, fee, interest)
  VALUES (p_invoice, v_inv.reminder_level + 1, v_fee, v_interest) RETURNING * INTO v_rem;
  UPDATE public.invoices SET reminder_level = v_rem.level, fees_total = fees_total + v_fee + v_interest, updated_at = now()
   WHERE id = p_invoice;
  PERFORM public.invoice_event(p_invoice, 'invoice.reminder', jsonb_build_object('level', v_rem.level, 'fee', v_fee, 'interest', v_interest));
  RETURN v_rem;
END $$;

CREATE OR REPLACE FUNCTION public.mark_invoice_sent(p_invoice uuid, p_channel text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.require_billing_operator();
  UPDATE public.invoices SET sent_at = now(), updated_at = now() WHERE id = p_invoice AND status <> 'draft';
  PERFORM public.invoice_event(p_invoice, 'invoice.sent', jsonb_build_object('channel', p_channel));
END $$;


-- ── 5. Booking on invoice ──────────────────────────────────────────────────
-- Called by the book-on-invoice function after it has priced the booking
-- on the server (as the card and Vipps flows do). p_caller is the signed-
-- in person the function verified.
CREATE OR REPLACE FUNCTION public.company_open_exposure(p_org uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce((SELECT sum(public.invoice_outstanding(i)) FROM public.invoices i
                    WHERE i.organization_id = p_org AND i.kind = 'invoice' AND i.status IN ('issued', 'partially_paid')), 0)
       + coalesce((SELECT sum(public.booking_invoice_amount(b.id)) FROM public.bookings b
                    WHERE b.organization_id = p_org AND b.payment_provider = 'invoice' AND b.status <> 'cancelled'
                      AND NOT EXISTS (SELECT 1 FROM public.invoice_lines l WHERE l.booking_id = b.id AND NOT l.is_credit)), 0);
$$;

CREATE OR REPLACE FUNCTION public.book_on_invoice(p_booking uuid, p_caller uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_b   public.bookings%ROWTYPE;
  v_org public.organizations%ROWTYPE;
  v_exposure numeric;
BEGIN
  IF NOT public.is_server() THEN
    RAISE EXCEPTION 'book_on_invoice: server only (book-on-invoice function)' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND OR v_b.customer_id IS DISTINCT FROM p_caller THEN
    RAISE EXCEPTION 'booking not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.organization_id IS NULL THEN
    RAISE EXCEPTION 'only company bookings can be paid on invoice' USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_b.payment_status, 'pending') <> 'pending' OR v_b.status = 'cancelled' THEN
    RAISE EXCEPTION 'booking is not awaiting payment' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_org FROM public.organizations WHERE id = v_b.organization_id;
  IF v_org.status <> 'active' OR NOT EXISTS (
       SELECT 1 FROM public.organization_members WHERE organization_id = v_org.id AND user_id = p_caller
          AND status = 'active' AND role IN ('owner', 'admin', 'booker')) THEN
    RAISE EXCEPTION 'only an owner, admin or booker of an active company books on its invoice' USING ERRCODE = '42501';
  END IF;
  IF NOT v_org.invoicing_enabled THEN
    RAISE EXCEPTION 'invoice payment is not switched on for this company; contact FlyttGo' USING ERRCODE = '55000';
  END IF;
  IF public.config_text('credit_check_enabled') = 'true' AND NOT public.has_current_credit_check(v_org.id) THEN
    RAISE EXCEPTION 'invoice payment needs a current credit check; contact FlyttGo' USING ERRCODE = '55000';
  END IF;
  v_exposure := public.company_open_exposure(v_org.id);
  IF v_org.credit_limit IS NOT NULL AND v_exposure + public.booking_invoice_amount(v_b.id) > v_org.credit_limit THEN
    RAISE EXCEPTION 'this booking would take the company over its credit limit of % NOK', v_org.credit_limit USING ERRCODE = '55000';
  END IF;

  -- Payment is secured by the invoice: no capture, dispatch as paid.
  UPDATE public.bookings SET payment_provider = 'invoice', payment_status = 'paid', captured_at = now()
   WHERE id = p_booking;
  UPDATE public.escrow_payments SET status = 'escrow' WHERE booking_id = p_booking AND status = 'held';
  PERFORM public.org_event(v_org.id, 'booking.on_invoice', p_caller, jsonb_build_object('booking', p_booking));
  RETURN jsonb_build_object('booking', p_booking, 'organization', v_org.id, 'cycle', v_org.invoice_cycle);
END $$;

-- What the invoice run should invoice now: per company, the bookings on
-- invoice that are completed (or cancelled with a fee) and not invoiced.
-- Per-booking companies: each such booking; monthly companies: those of
-- previous months, once the month is over.
CREATE OR REPLACE FUNCTION public.uninvoiced_bookings(p_today date DEFAULT NULL)
RETURNS TABLE (organization_id uuid, booking_id uuid, cycle text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT b.organization_id, b.id, o.invoice_cycle
    FROM public.bookings b JOIN public.organizations o ON o.id = b.organization_id
   WHERE b.payment_provider = 'invoice'
     AND b.status IN ('completed', 'cancelled')
     AND NOT EXISTS (SELECT 1 FROM public.invoice_lines l WHERE l.booking_id = b.id AND NOT l.is_credit)
     AND (o.invoice_cycle = 'per_booking'
          OR coalesce(b.end_time, b.cancelled_at, b.updated_at, b.created_at) < date_trunc('month', coalesce(p_today, current_date)))
   ORDER BY b.organization_id, b.created_at;
$$;


-- ── 6. Privileges ──────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.config_text(text)', 'public.set_billing_preferences(uuid, text, integer, integer, text, text)',
    'public.admin_set_invoicing(uuid, boolean, numeric, text)', 'public.set_organization_logo(uuid, text)',
    'public.has_current_credit_check(uuid)', 'public.record_credit_check(uuid, text, boolean, text, numeric, jsonb)',
    'public.can_read_invoice(uuid)', 'public.guard_invoice_write()', 'public.guard_invoice_line_write()',
    'public.guard_append_only()', 'public.invoice_event(uuid, text, jsonb)', 'public.invoice_outstanding(public.invoices)',
    'public.kid_mod10(text)', 'public.invoice_due_date(date, text, integer, integer)', 'public.require_billing_operator()',
    'public.booking_invoice_amount(uuid)', 'public.create_invoice_draft(uuid, uuid[], numeric[], text)',
    'public.add_invoice_line(uuid, text, numeric, numeric, numeric)', 'public.invoice_seller()',
    'public.issue_invoice(uuid)', 'public.invoice_settle_status(uuid)', 'public.delete_invoice_draft(uuid)',
    'public.create_credit_note(uuid, numeric, text)', 'public.record_invoice_payment(uuid, numeric, date, text, text)',
    'public.record_payment_by_kid(text, numeric, date, text)', 'public.record_invoice_reminder(uuid)',
    'public.mark_invoice_sent(uuid, text)', 'public.company_open_exposure(uuid)', 'public.book_on_invoice(uuid, uuid)',
    'public.uninvoiced_bookings(date)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
-- Callable from the app (each checks its caller): company billing
-- preferences and logo; administrators' invoicing operations.
GRANT EXECUTE ON FUNCTION public.set_billing_preferences(uuid, text, integer, integer, text, text),
  public.set_organization_logo(uuid, text), public.admin_set_invoicing(uuid, boolean, numeric, text),
  public.record_credit_check(uuid, text, boolean, text, numeric, jsonb),
  public.create_invoice_draft(uuid, uuid[], numeric[], text), public.add_invoice_line(uuid, text, numeric, numeric, numeric),
  public.issue_invoice(uuid), public.delete_invoice_draft(uuid), public.create_credit_note(uuid, numeric, text),
  public.record_invoice_payment(uuid, numeric, date, text, text), public.record_payment_by_kid(text, numeric, date, text),
  public.record_invoice_reminder(uuid), public.invoice_outstanding(public.invoices), public.company_open_exposure(uuid)
  TO authenticated;
-- RLS helpers run inside policies as the caller.
GRANT EXECUTE ON FUNCTION public.can_read_invoice(uuid) TO authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
