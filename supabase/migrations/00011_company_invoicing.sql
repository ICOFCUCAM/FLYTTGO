-- ============================================================================
-- FlyttGo — invoices in a company's own name (sales invoicing)
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00010 (docs/SERVICE_PLATFORM.md).
-- A company with the module 'sales_invoicing' (its plan) invoices its own
-- customers through FlyttGo's invoice system (00008), as the seller:
--
--   * issuer_org is the company that sells; FlyttGo's own invoices have
--     none. Each issuer has its own number series ('org:<id>') without
--     gaps, and KIDs are unique per series. organization_id stays the
--     buyer company for FlyttGo's invoices and is empty on a company's
--     sales invoice, whose buyer (a person or a business) is the snapshot
--     in buyer, with customer_user_id when the buyer has an account.
--   * The seller's details (legal name, address, bank account, terms,
--     reminder fee) are the company's invoice settings; an invoice cannot be
--     issued until they are filled in.
--   * The company's owners, admins and finance operate its invoices
--     (issue, payments, reminders, credit notes); FlyttGo administrators
--     read them, and the buyer reads their own. FlyttGo's own invoices stay
--     FlyttGo's administrators' and the server's.
--   * Everything else is the same engine: legal content, final once issued,
--     credit notes, payments never more than owed, PDF and EHF.
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Invoices know who issued them ────────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS issuer_org       uuid REFERENCES public.organizations (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS series           text NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS customer_user_id uuid,
  ADD COLUMN IF NOT EXISTS terms_days       integer CHECK (terms_days IS NULL OR terms_days BETWEEN 0 AND 60),
  ADD COLUMN IF NOT EXISTS source_type      text CHECK (source_type IS NULL OR source_type IN ('job', 'appointment', 'manual')),
  ADD COLUMN IF NOT EXISTS source_id        uuid;
ALTER TABLE public.invoices ALTER COLUMN organization_id DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_issuer_or_buyer') THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_issuer_or_buyer CHECK (
          (issuer_org IS NULL AND organization_id IS NOT NULL AND series = 'main')
       OR (issuer_org IS NOT NULL AND series = 'org:' || issuer_org::text));
  END IF;
  -- Numbers and KIDs are unique per series.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_number_key') THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_number_key;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_series_number_key ON public.invoices (series, number) WHERE number IS NOT NULL;
DROP INDEX IF EXISTS public.invoices_kid_key;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_series_kid_key ON public.invoices (series, kid) WHERE kid IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_issuer_idx ON public.invoices (issuer_org, issue_date DESC) WHERE issuer_org IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_customer_idx ON public.invoices (customer_user_id) WHERE customer_user_id IS NOT NULL;
-- A card or Vipps payment is recorded once: the provider's reference (the
-- payment intent) is unique, so a second webhook delivery for the same
-- payment is refused (23505) and treated as already recorded.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_provider_ref_key ON public.invoice_payments (method, reference)
  WHERE method IN ('card', 'vipps') AND reference IS NOT NULL;


-- ── 2. A company's invoice settings (the seller on its invoices) ────────────
CREATE TABLE IF NOT EXISTS public.organization_invoice_settings (
  organization_id    uuid        PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  legal_name         text,
  address            text,
  postcode_city      text,
  email              text        CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone              text,
  bank_account       text        CHECK (bank_account IS NULL OR regexp_replace(bank_account, '[ .]', '', 'g') ~ '^[0-9]{11}$'),
  iban               text,
  bic                text,
  terms_days         integer     NOT NULL DEFAULT 14 CHECK (terms_days BETWEEN 0 AND 60),
  reminder_fee       numeric     NOT NULL DEFAULT 0 CHECK (reminder_fee >= 0),
  late_interest_pct  numeric     CHECK (late_interest_pct IS NULL OR late_interest_pct BETWEEN 0 AND 30),
  logo_on_invoices   boolean     NOT NULL DEFAULT true,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organization_invoice_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_invoice_settings_select ON public.organization_invoice_settings;
CREATE POLICY organization_invoice_settings_select ON public.organization_invoice_settings FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id, ARRAY['owner', 'admin', 'finance']));
REVOKE ALL ON public.organization_invoice_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organization_invoice_settings FROM authenticated;

CREATE OR REPLACE FUNCTION public.set_invoice_settings(p_org uuid, p jsonb)
RETURNS public.organization_invoice_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE s public.organization_invoice_settings%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'finance']);
  INSERT INTO public.organization_invoice_settings AS t (organization_id, legal_name, address, postcode_city, email, phone,
               bank_account, iban, bic, terms_days, reminder_fee, late_interest_pct, logo_on_invoices)
  VALUES (p_org, nullif(btrim(p ->> 'legal_name'), ''), nullif(btrim(p ->> 'address'), ''), nullif(btrim(p ->> 'postcode_city'), ''),
          lower(nullif(btrim(p ->> 'email'), '')), nullif(btrim(p ->> 'phone'), ''), nullif(btrim(p ->> 'bank_account'), ''),
          nullif(btrim(p ->> 'iban'), ''), nullif(btrim(p ->> 'bic'), ''), coalesce((p ->> 'terms_days')::int, 14),
          coalesce((p ->> 'reminder_fee')::numeric, 0), nullif(p ->> 'late_interest_pct', '')::numeric,
          coalesce((p ->> 'logo_on_invoices')::boolean, true))
  ON CONFLICT (organization_id) DO UPDATE SET
    legal_name = EXCLUDED.legal_name, address = EXCLUDED.address, postcode_city = EXCLUDED.postcode_city,
    email = EXCLUDED.email, phone = EXCLUDED.phone, bank_account = EXCLUDED.bank_account, iban = EXCLUDED.iban,
    bic = EXCLUDED.bic, terms_days = EXCLUDED.terms_days, reminder_fee = EXCLUDED.reminder_fee,
    late_interest_pct = EXCLUDED.late_interest_pct, logo_on_invoices = EXCLUDED.logo_on_invoices, updated_at = now()
  RETURNING * INTO s;
  PERFORM public.org_event(p_org, 'invoicing.settings', NULL, jsonb_build_object('legal_name', s.legal_name, 'terms_days', s.terms_days));
  RETURN s;
END $$;

-- The seller as the company's invoices state it.
CREATE OR REPLACE FUNCTION public.organization_seller(p_org uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'name', coalesce(s.legal_name, o.name), 'org_number', o.org_number, 'vat_registered', o.vat_registered,
    'address', coalesce(s.address, o.billing_address), 'postcode_city', s.postcode_city,
    'email', coalesce(s.email, o.billing_email), 'phone', s.phone,
    'bank_account', s.bank_account, 'iban', s.iban, 'bic', s.bic)
    FROM public.organizations o LEFT JOIN public.organization_invoice_settings s ON s.organization_id = o.id
   WHERE o.id = p_org;
$$;


-- ── 3. Who operates an invoice ──────────────────────────────────────────────
-- FlyttGo's invoices: its administrators and the server. A company's sales
-- invoices: its owners, admins and finance, and the server.
CREATE OR REPLACE FUNCTION public.require_invoice_operator(p_invoice uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_issuer uuid;
BEGIN
  SELECT issuer_org INTO v_issuer FROM public.invoices WHERE id = p_invoice;
  IF v_issuer IS NULL THEN PERFORM public.require_billing_operator(); RETURN; END IF;
  IF public.is_server() OR public.is_org_member(v_issuer, ARRAY['owner', 'admin', 'finance']) THEN RETURN; END IF;
  RAISE EXCEPTION 'invoices: the company''s owners, admins and finance only' USING ERRCODE = '42501';
END $$;

CREATE OR REPLACE FUNCTION public.can_read_invoice(p_invoice uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.id = p_invoice AND (
           (i.issuer_org IS NULL AND i.status <> 'draft'
            AND public.is_org_member(i.organization_id, ARRAY['owner', 'admin', 'finance']))
        OR (i.issuer_org IS NOT NULL AND public.is_org_member(i.issuer_org, ARRAY['owner', 'admin', 'finance']))
        OR (i.issuer_org IS NOT NULL AND i.status <> 'draft' AND i.customer_user_id = auth.uid())));
$$;


-- ── 4. A sales invoice: draft, lines ────────────────────────────────────────
-- p_lines: [{description, quantity, unit_price (excl. MVA), vat_rate}].
-- Called by the company's finance (create_sales_invoice) and by the Jobs
-- and Appointments modules after their own checks (internal).
CREATE OR REPLACE FUNCTION public.sales_invoice_draft(
  p_org uuid, p_customer jsonb, p_customer_user uuid, p_lines jsonb, p_reference text, p_notes text,
  p_source_type text, p_source_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv public.invoices%ROWTYPE; l jsonb; n int := 0; v_net numeric; v_vat numeric; v_rate numeric;
BEGIN
  IF NOT public.org_has_module(p_org, 'sales_invoicing') THEN
    RAISE EXCEPTION 'invoices: the company''s plan does not include invoicing' USING ERRCODE = '55000';
  END IF;
  IF coalesce(btrim(p_customer ->> 'name'), '') = '' THEN
    RAISE EXCEPTION 'invoices: the customer''s name is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'invoices: an invoice needs at least one line' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.invoices (issuer_org, series, organization_id, customer_user_id, buyer, reference, notes,
                               source_type, source_id, created_by)
  VALUES (p_org, 'org:' || p_org::text, NULL, p_customer_user,
          jsonb_build_object('name', btrim(p_customer ->> 'name'), 'email', lower(nullif(btrim(p_customer ->> 'email'), '')),
                             'address', p_customer ->> 'address', 'postcode_city', p_customer ->> 'postcode_city',
                             'org_number', nullif(btrim(p_customer ->> 'org_number'), ''),
                             'vat_registered', coalesce((p_customer ->> 'vat_registered')::boolean, false)),
          nullif(btrim(coalesce(p_reference, '')), ''), p_notes, p_source_type, p_source_id, auth.uid())
  RETURNING * INTO v_inv;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_rate := coalesce((l ->> 'vat_rate')::numeric, 25);
    IF coalesce(btrim(l ->> 'description'), '') = '' OR coalesce((l ->> 'quantity')::numeric, 0) <= 0
       OR coalesce((l ->> 'unit_price')::numeric, -1) < 0 THEN
      RAISE EXCEPTION 'invoices: each line needs a description, a quantity above 0 and a price' USING ERRCODE = '22023';
    END IF;
    v_net := round((l ->> 'quantity')::numeric * (l ->> 'unit_price')::numeric, 2);
    v_vat := round(v_net * v_rate / 100, 2);
    n := n + 1;
    INSERT INTO public.invoice_lines (invoice_id, line_no, description, quantity, unit_price, vat_rate, net_amount, vat_amount, total)
    VALUES (v_inv.id, n, btrim(l ->> 'description'), (l ->> 'quantity')::numeric, (l ->> 'unit_price')::numeric, v_rate,
            v_net, v_vat, v_net + v_vat);
  END LOOP;
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    delivery_from = (now() AT TIME ZONE 'Europe/Oslo')::date, delivery_to = (now() AT TIME ZONE 'Europe/Oslo')::date
   WHERE id = v_inv.id RETURNING * INTO v_inv;
  RETURN v_inv;
END $$;
REVOKE ALL ON FUNCTION public.sales_invoice_draft(uuid, jsonb, uuid, jsonb, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_sales_invoice(
  p_org uuid, p_customer jsonb, p_customer_user uuid, p_lines jsonb, p_reference text, p_notes text)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_server() THEN PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'finance']); END IF;
  RETURN public.sales_invoice_draft(p_org, p_customer, p_customer_user, p_lines, p_reference, p_notes, 'manual', NULL);
END $$;


-- ── 5. The engine's functions, for both kinds of issuer ─────────────────────
CREATE OR REPLACE FUNCTION public.add_invoice_line(p_invoice uuid, p_description text, p_quantity numeric,
                                                  p_unit_price numeric, p_vat_rate numeric DEFAULT 25)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv public.invoices%ROWTYPE; v_net numeric; v_vat numeric;
BEGIN
  PERFORM public.require_invoice_operator(p_invoice);
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

CREATE OR REPLACE FUNCTION public.delete_invoice_draft(p_invoice uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.require_invoice_operator(p_invoice);
  DELETE FROM public.invoices WHERE id = p_invoice AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'only a draft can be deleted' USING ERRCODE = '55000'; END IF;
END $$;

-- Issue: the next number in the issuer's series, today's date, the due
-- date (FlyttGo: the buyer company's terms; a company: its settings or the
-- invoice's own terms), KID, and snapshots of seller, buyer and branding.
CREATE OR REPLACE FUNCTION public.issue_invoice(p_invoice uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv    public.invoices%ROWTYPE;
  v_org    public.organizations%ROWTYPE;
  v_set    public.organization_invoice_settings%ROWTYPE;
  v_seller jsonb;
  v_number bigint;
  v_issue  date := (now() AT TIME ZONE 'Europe/Oslo')::date;
BEGIN
  PERFORM public.require_invoice_operator(p_invoice);
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found' USING ERRCODE = 'P0002'; END IF;
  IF v_inv.status <> 'draft' THEN RAISE EXCEPTION 'invoice % is already issued', v_inv.number USING ERRCODE = '55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoice_lines WHERE invoice_id = p_invoice) THEN
    RAISE EXCEPTION 'an invoice needs at least one line' USING ERRCODE = '22023';
  END IF;
  v_seller := CASE WHEN v_inv.issuer_org IS NULL THEN public.invoice_seller() ELSE public.organization_seller(v_inv.issuer_org) END;
  IF v_seller ->> 'name' IS NULL OR v_seller ->> 'org_number' IS NULL OR v_seller ->> 'bank_account' IS NULL
     OR v_seller ->> 'address' IS NULL THEN
    RAISE EXCEPTION 'fill in the seller''s name, organisation number, address and bank account in the invoice settings first'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.invoice_counters (series, next_number) VALUES (v_inv.series, 1) ON CONFLICT (series) DO NOTHING;
  UPDATE public.invoice_counters SET next_number = next_number + 1 WHERE series = v_inv.series
  RETURNING next_number - 1 INTO v_number;

  IF v_inv.issuer_org IS NULL THEN
    SELECT * INTO v_org FROM public.organizations WHERE id = v_inv.organization_id;
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
  ELSE
    SELECT * INTO v_org FROM public.organizations WHERE id = v_inv.issuer_org;
    SELECT * INTO v_set FROM public.organization_invoice_settings WHERE organization_id = v_inv.issuer_org;
    UPDATE public.invoices SET
      number     = v_number,
      status     = 'issued',
      issue_date = v_issue,
      due_date   = CASE WHEN kind = 'credit_note' THEN v_issue ELSE v_issue + coalesce(terms_days, v_set.terms_days, 14) END,
      kid        = CASE WHEN kind = 'invoice' THEN public.kid_mod10(lpad(v_number::text, 8, '0')) END,
      seller     = v_seller,
      -- The company's own invoice: its name and logo head it; the seller
      -- is the company itself (no "issued by FlyttGo" footer).
      branding   = CASE WHEN coalesce(v_set.logo_on_invoices, true) AND v_org.logo_path IS NOT NULL
                        THEN jsonb_build_object('name', v_seller ->> 'name', 'logo_path', v_org.logo_path, 'own', true) END,
      issued_by  = auth.uid(),
      updated_at = now()
     WHERE id = p_invoice RETURNING * INTO v_inv;
  END IF;
  PERFORM public.invoice_event(p_invoice, 'invoice.issued', jsonb_build_object('number', v_number, 'series', v_inv.series, 'total', v_inv.total));

  -- A credit note reduces what its invoice still owes.
  IF v_inv.kind = 'credit_note' THEN
    UPDATE public.invoices o SET amount_credited = o.amount_credited - v_inv.total, updated_at = now()
     WHERE o.id = v_inv.credits_invoice_id;
    PERFORM public.invoice_settle_status(v_inv.credits_invoice_id);
  END IF;
  RETURN v_inv;
END $$;

-- A credit note for the whole invoice (p_amount NULL) or part of it, in the
-- same series and to the same buyer. Issued at once.
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
  PERFORM public.require_invoice_operator(p_invoice);
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'a credit note needs a reason' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR v_inv.kind <> 'invoice' OR v_inv.status = 'draft' THEN
    RAISE EXCEPTION 'only an issued invoice can be credited' USING ERRCODE = '55000';
  END IF;
  v_left := v_inv.total - v_inv.amount_credited;
  IF p_amount IS NOT NULL AND (p_amount <= 0 OR p_amount > v_left) THEN
    RAISE EXCEPTION 'credit between 0 and % NOK', v_left USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invoices (kind, credits_invoice_id, organization_id, issuer_org, series, customer_user_id, buyer,
                               notes, reference, delivery_from, delivery_to, created_by)
  VALUES ('credit_note', p_invoice, v_inv.organization_id, v_inv.issuer_org, v_inv.series, v_inv.customer_user_id,
          CASE WHEN v_inv.issuer_org IS NOT NULL THEN v_inv.buyer END,
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
  PERFORM public.require_invoice_operator(p_invoice);
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

-- FlyttGo's bank file: its own series only.
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
  SELECT id INTO v_id FROM public.invoices WHERE series = 'main' AND kid = regexp_replace(coalesce(p_kid, ''), '\s', '', 'g');
  IF v_id IS NULL THEN RETURN NULL; END IF;
  PERFORM public.record_invoice_payment(v_id, p_amount, p_paid_on, 'bank', p_bank_reference);
  RETURN v_id;
END $$;

-- A reminder: the fee and interest from FlyttGo's settings for its own
-- invoices, from the company's for its sales invoices.
CREATE OR REPLACE FUNCTION public.record_invoice_reminder(p_invoice uuid)
RETURNS public.invoice_reminders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_rem public.invoice_reminders%ROWTYPE;
  v_fee numeric;
  v_pct numeric;
  v_interest numeric := 0;
BEGIN
  PERFORM public.require_invoice_operator(p_invoice);
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR v_inv.kind <> 'invoice' OR v_inv.status NOT IN ('issued', 'partially_paid') THEN
    RAISE EXCEPTION 'only an unpaid issued invoice gets a reminder' USING ERRCODE = '55000';
  END IF;
  IF v_inv.due_date >= (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'invoice % is not overdue', v_inv.number USING ERRCODE = '55000';
  END IF;
  IF v_inv.issuer_org IS NULL THEN
    v_fee := coalesce(public.config_text('invoice_reminder_fee')::numeric, 0);
    v_pct := public.config_text('invoice_late_interest_pct')::numeric;
  ELSE
    SELECT coalesce(reminder_fee, 0), late_interest_pct INTO v_fee, v_pct
      FROM public.organization_invoice_settings WHERE organization_id = v_inv.issuer_org;
    v_fee := coalesce(v_fee, 0);
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
  PERFORM public.require_invoice_operator(p_invoice);
  UPDATE public.invoices SET sent_at = now(), updated_at = now() WHERE id = p_invoice AND status <> 'draft';
  PERFORM public.invoice_event(p_invoice, 'invoice.sent', jsonb_build_object('channel', p_channel));
END $$;


-- ── 6. Who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.set_invoice_settings(uuid, jsonb), public.organization_seller(uuid),
  public.require_invoice_operator(uuid), public.create_sales_invoice(uuid, jsonb, uuid, jsonb, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organization_seller(uuid), public.require_invoice_operator(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_invoice_settings(uuid, jsonb), public.create_sales_invoice(uuid, jsonb, uuid, jsonb, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.organization_seller(uuid), public.require_invoice_operator(uuid),
  public.sales_invoice_draft(uuid, jsonb, uuid, jsonb, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_invoice_sent(uuid, text) TO authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
