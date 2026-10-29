-- ============================================================================
-- Roll back 00011_company_invoicing.sql
-- ============================================================================
-- Run first (before 00010_down.sql). Tested by run.sh: afterwards the
-- schema is exactly as before 00011.
--
-- DATA LOSS — READ FIRST. Companies' sales invoices are their accounting
-- records (bokføringsloven): the rollback stops while any exists. Export
-- them to the companies and delete only what the law allows first. The
-- companies' invoice settings are dropped.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'issuer_org')
     AND EXISTS (SELECT 1 FROM public.invoices WHERE issuer_org IS NOT NULL) THEN
    RAISE EXCEPTION 'companies'' sales invoices exist: export them first (they are accounting records)';
  END IF;
END $$;

-- The engine's functions as 00008 left them.
CREATE OR REPLACE FUNCTION public.can_read_invoice(p_invoice uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.id = p_invoice AND i.status <> 'draft'
       AND public.is_org_member(i.organization_id, ARRAY['owner', 'admin', 'finance']));
$$;

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

CREATE OR REPLACE FUNCTION public.delete_invoice_draft(p_invoice uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.require_billing_operator();
  DELETE FROM public.invoices WHERE id = p_invoice AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'only a draft can be deleted' USING ERRCODE = '55000'; END IF;
END $$;

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

REVOKE EXECUTE ON FUNCTION public.mark_invoice_sent(uuid, text) FROM authenticated;

DROP FUNCTION IF EXISTS public.create_sales_invoice(uuid, jsonb, uuid, jsonb, text, text);
DROP FUNCTION IF EXISTS public.sales_invoice_draft(uuid, jsonb, uuid, jsonb, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.require_invoice_operator(uuid);
DROP FUNCTION IF EXISTS public.organization_seller(uuid);
DROP FUNCTION IF EXISTS public.set_invoice_settings(uuid, jsonb);
DROP TABLE IF EXISTS public.organization_invoice_settings;
DELETE FROM public.invoice_counters WHERE series LIKE 'org:%';

DROP INDEX IF EXISTS public.invoices_customer_idx;
DROP INDEX IF EXISTS public.invoices_issuer_idx;
DROP INDEX IF EXISTS public.invoices_series_kid_key;
DROP INDEX IF EXISTS public.invoices_series_number_key;
DO $$
BEGIN
  IF to_regclass('public.invoices') IS NOT NULL THEN
    ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_issuer_or_buyer;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_number_key') THEN
      ALTER TABLE public.invoices ADD CONSTRAINT invoices_number_key UNIQUE (number);
    END IF;
    ALTER TABLE public.invoices
      DROP COLUMN IF EXISTS source_id, DROP COLUMN IF EXISTS source_type, DROP COLUMN IF EXISTS terms_days,
      DROP COLUMN IF EXISTS customer_user_id, DROP COLUMN IF EXISTS series, DROP COLUMN IF EXISTS issuer_org;
    ALTER TABLE public.invoices ALTER COLUMN organization_id SET NOT NULL;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_kid_key ON public.invoices (kid) WHERE kid IS NOT NULL;

-- ============================================================================
-- DONE
-- ============================================================================
