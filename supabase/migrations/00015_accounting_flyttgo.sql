-- ============================================================================
-- 00015 — Accounting in FlyttGo: the host adapter for the accounting core
-- (00014) and automatic posting from FlyttGo's invoice engine
-- ============================================================================
--
-- FlyttGo-specific; the core stays portable (docs/ACCOUNTING_CORE.md).
--
--   * Tenants are organisations. Their owners, admins and finance keep the
--     books; owners and admins manage the back office. FlyttGo's
--     administrators keep FlyttGo's own (house) books and approve the
--     add-on, and never read a company's books.
--   * Accounting is an add-on at its own monthly price (owner's decision
--     2026-10-29): a company asks, FlyttGo approves with the price; the
--     invoice run bills it monthly. Proposed price until FlyttGo confirms.
--   * Every issued invoice or credit note, payment and reminder fee of the
--     engine (00008, 00011) becomes a voucher in the seller's ledger, once:
--     FlyttGo's own invoices in the house ledger, a company's sales invoices
--     in its ledger.
--
-- Safe to re-run. Rollback: supabase/rollback/00015_down.sql.
-- ============================================================================


-- ── 1. The adapter ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accounting.host_can_keep(p_tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN p_tenant IS NULL THEN public.is_admin()
              ELSE public.is_org_member(p_tenant, ARRAY['owner', 'admin', 'finance']) END;
$$;

CREATE OR REPLACE FUNCTION accounting.host_can_manage(p_tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT p_tenant IS NOT NULL AND public.is_org_member(p_tenant, ARRAY['owner', 'admin']) $$;

CREATE OR REPLACE FUNCTION accounting.host_is_operator()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.is_admin() $$;

CREATE OR REPLACE FUNCTION accounting.host_is_server()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.is_server() $$;

CREATE OR REPLACE FUNCTION accounting.host_tenant(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'legal_name', coalesce((SELECT s.legal_name FROM public.organization_invoice_settings s WHERE s.organization_id = o.id), o.name),
    'org_number', o.org_number, 'vat_registered', coalesce(o.vat_registered, false), 'active', o.status = 'active')
    FROM public.organizations o WHERE o.id = p_tenant;
$$;

CREATE OR REPLACE FUNCTION accounting.host_event(p_tenant uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_tenant IS NOT NULL THEN PERFORM public.org_event(p_tenant, p_action, NULL, p_details); END IF;
END $$;

REVOKE ALL ON FUNCTION accounting.host_is_server(), accounting.host_tenant(uuid), accounting.host_event(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.host_can_keep(uuid), accounting.host_can_manage(uuid), accounting.host_is_operator() TO authenticated;

-- A tenant is an organisation; a ledger outlives nothing it belongs to.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledgers_tenant_organization_fk') THEN
    ALTER TABLE accounting.ledgers ADD CONSTRAINT ledgers_tenant_organization_fk
      FOREIGN KEY (tenant_id) REFERENCES public.organizations (id) ON DELETE RESTRICT;
  END IF;
END $$;


-- ── 2. The add-on's price (excl. MVA), by the company's turnover ──────────
-- Owner's decision 2026-10-29: the price follows the company's size. The
-- band is read from the books: last calendar year's income (accounts 3xxx)
-- once the books hold that whole year, before that the turnover the
-- company declared when it asked. Reassessed each 1 January, never in the
-- middle of a year. Above the last band the price is agreed (the ledger's
-- monthly_fee); an agreed price always wins. Bands are half-open: a band
-- covers turnover from its lower limit up to, not including, its up_to.
-- Status 'provisional' (owner, 2026-10-29: accepted for the pilot) until
-- set to 'confirmed'.
INSERT INTO public.platform_config (config_key, config_value)
SELECT 'accounting_price_tiers', '[{"name":"Start","up_to":1000000,"monthly_fee":199},{"name":"Small","up_to":5000000,"monthly_fee":499},{"name":"Medium","up_to":20000000,"monthly_fee":1290},{"name":"Large","up_to":100000000,"monthly_fee":2990},{"name":"Enterprise","up_to":null,"monthly_fee":null}]'
 WHERE NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'accounting_price_tiers');
INSERT INTO public.platform_config (config_key, config_value)
SELECT 'accounting_price_status', 'provisional'
 WHERE NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'accounting_price_status');

-- The price list as the public page shows it.
CREATE OR REPLACE FUNCTION public.accounting_price()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object('tiers', coalesce(public.config_text('accounting_price_tiers'), '[]')::jsonb,
                            'price_status', coalesce(public.config_text('accounting_price_status'), 'provisional'));
$$;
GRANT EXECUTE ON FUNCTION public.accounting_price() TO anon, authenticated;

-- The band and price of a ledger for a month: the turnover it is based on
-- and where that came from.
CREATE OR REPLACE FUNCTION public.accounting_tier(p_ledger uuid, p_month date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE l accounting.ledgers%ROWTYPE; v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
        v_year integer := extract(year FROM v_month)::int - 1; v_turnover numeric; v_basis text; t jsonb;
BEGIN
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT (public.is_admin() OR public.is_server() OR accounting.can_read(p_ledger) OR accounting.can_manage(p_ledger)) THEN
    RAISE EXCEPTION 'accounting: not your ledger' USING ERRCODE = '42501';
  END IF;
  IF l.start_date <= make_date(v_year, 1, 1) THEN
    v_turnover := accounting.turnover(p_ledger, make_date(v_year, 1, 1), make_date(v_year, 12, 31)); v_basis := 'books ' || v_year;
  ELSE
    v_turnover := coalesce(l.declared_turnover, 0); v_basis := 'declared';
  END IF;
  SELECT x INTO t FROM jsonb_array_elements(coalesce(public.config_text('accounting_price_tiers'), '[]')::jsonb) x
   WHERE x ->> 'up_to' IS NULL OR v_turnover < (x ->> 'up_to')::numeric
   ORDER BY coalesce((x ->> 'up_to')::numeric, 'Infinity'::numeric) LIMIT 1;
  RETURN jsonb_build_object('tier', t ->> 'name', 'turnover', v_turnover, 'basis', v_basis,
                            'list_fee', (t ->> 'monthly_fee')::numeric, 'agreed_fee', l.monthly_fee,
                            'monthly_fee', coalesce(l.monthly_fee, (t ->> 'monthly_fee')::numeric));
END $$;
GRANT EXECUTE ON FUNCTION public.accounting_tier(uuid, date) TO authenticated, service_role;

-- What the invoice run bills for the add-on: each active company ledger,
-- monthly in advance from the month it was approved. A ledger in the
-- Enterprise band without an agreed price is listed with no fee, for
-- FlyttGo to agree one; nothing is billed for it until then.
CREATE OR REPLACE FUNCTION public.accounting_billable(p_month date)
RETURNS TABLE (organization_id uuid, ledger_id uuid, tier text, turnover numeric, monthly_fee numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'accounting: the server only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT l.tenant_id, l.id, t ->> 'tier', (t ->> 'turnover')::numeric, (t ->> 'monthly_fee')::numeric
    FROM accounting.ledgers l CROSS JOIN LATERAL public.accounting_tier(l.id, p_month) t
   WHERE l.tenant_id IS NOT NULL AND l.status = 'active'
     AND date_trunc('month', l.decided_at AT TIME ZONE 'Europe/Oslo')::date <= date_trunc('month', p_month)::date;
END $$;
REVOKE ALL ON FUNCTION public.accounting_billable(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_billable(date) TO service_role;


-- Each month billed once (the draft's deletion takes its charges with it).
CREATE TABLE IF NOT EXISTS public.accounting_charges (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id),
  ledger_id       uuid        NOT NULL REFERENCES accounting.ledgers (id),
  invoice_id      uuid        NOT NULL REFERENCES public.invoices (id) ON DELETE CASCADE,
  period          date        NOT NULL CHECK (extract(day FROM period) = 1),
  tier            text,
  turnover        numeric,
  total           numeric     NOT NULL,              -- incl. MVA
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ledger_id, period)
);
ALTER TABLE public.accounting_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_charges_select ON public.accounting_charges;
CREATE POLICY accounting_charges_select ON public.accounting_charges FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id, ARRAY['owner', 'admin', 'finance']));
REVOKE ALL ON public.accounting_charges FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.accounting_charges FROM authenticated;

-- The add-on's invoice for a company, as a draft on FlyttGo's invoice (NULL
-- when nothing is due): each month from approval to the current one not
-- yet billed, at the month's band price; nothing after the month it ended;
-- a month without a price (Enterprise, not yet agreed) waits.
CREATE OR REPLACE FUNCTION public.create_accounting_invoice(p_org uuid, p_today date DEFAULT NULL)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_month date := date_trunc('month', coalesce(p_today, (now() AT TIME ZONE 'Europe/Oslo')::date))::date;
  l accounting.ledgers%ROWTYPE; v_inv public.invoices%ROWTYPE; v_m date; v_end date; t jsonb; v_amt numeric; n integer := 0;
BEGIN
  PERFORM public.require_billing_operator();
  SELECT * INTO l FROM accounting.ledgers WHERE tenant_id = p_org AND status IN ('active', 'ended') AND decided_at IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.invoices (organization_id, notes, created_by) VALUES (p_org, 'Regnskap (FlyttGo)', auth.uid()) RETURNING * INTO v_inv;
  -- A cancelled ledger is billed up to and including the month of its last day.
  v_end := CASE WHEN l.cancel_at IS NOT NULL THEN least(v_month, date_trunc('month', l.cancel_at)::date)
                WHEN l.status = 'ended' THEN least(v_month, date_trunc('month', l.ended_at AT TIME ZONE 'Europe/Oslo')::date)
                ELSE v_month END;
  v_m := date_trunc('month', l.decided_at AT TIME ZONE 'Europe/Oslo')::date;
  WHILE v_m <= v_end LOOP
    IF NOT EXISTS (SELECT 1 FROM public.accounting_charges WHERE ledger_id = l.id AND period = v_m) THEN
      t := public.accounting_tier(l.id, v_m);
      IF coalesce((t ->> 'monthly_fee')::numeric, 0) > 0 THEN
        v_amt := public.white_label_line(v_inv.id, 'Regnskap ' || coalesce(t ->> 'tier', '') || ', ' || to_char(v_m, 'MM.YYYY'),
                                         (t ->> 'monthly_fee')::numeric);
        INSERT INTO public.accounting_charges (organization_id, ledger_id, invoice_id, period, tier, turnover, total)
        VALUES (p_org, l.id, v_inv.id, v_m, t ->> 'tier', (t ->> 'turnover')::numeric, v_amt);
        n := n + 1;
      END IF;
    END IF;
    v_m := (v_m + interval '1 month')::date;
  END LOOP;
  IF n = 0 THEN DELETE FROM public.invoices WHERE id = v_inv.id; RETURN NULL; END IF;
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_inv.id)
   WHERE id = v_inv.id RETURNING * INTO v_inv;
  RETURN v_inv;
END $$;
REVOKE ALL ON FUNCTION public.create_accounting_invoice(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_accounting_invoice(uuid, date) TO authenticated, service_role;


-- ── 3. Posting the invoice engine ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accounting_post_invoice(p_invoice uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  i public.invoices%ROWTYPE; l accounting.ledgers%ROWTYPE; v accounting.vouchers%ROWTYPE;
  r record; lines jsonb := '[]'::jsonb; v_code text; v_type text; v_party text;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id = p_invoice;
  IF NOT FOUND OR i.status = 'draft' OR i.total = 0 THEN RETURN NULL; END IF;
  l := accounting.ledger_for(i.issuer_org);
  IF l.id IS NULL THEN RETURN NULL; END IF;
  v_type := CASE WHEN i.kind = 'credit_note' THEN 'credit_note' ELSE 'invoice' END;
  v_party := nullif(i.buyer ->> 'name', '');
  -- Sales and MVA per rate on the credit side (a credit note's negative
  -- amounts land on the debit side), the total on receivables.
  FOR r IN SELECT vat_rate, sum(net_amount) AS net, sum(vat_amount) AS vat FROM public.invoice_lines
            WHERE invoice_id = p_invoice GROUP BY vat_rate ORDER BY vat_rate DESC LOOP
    v_code := CASE WHEN NOT l.vat_registered THEN NULL
                   WHEN r.vat_rate = 25 THEN '3' WHEN r.vat_rate = 15 THEN '31' WHEN r.vat_rate = 12 THEN '33'
                   ELSE l.zero_rate_code END;
    IF r.net <> 0 THEN
      lines := lines || accounting.line(accounting.account_for(l.id, 'sales_' || r.vat_rate::int), -r.net, v_code, 'basis', NULL, v_party, p_invoice);
    END IF;
    IF r.vat <> 0 THEN
      lines := lines || accounting.line(accounting.account_for(l.id, 'output_vat_' || r.vat_rate::int), -r.vat, v_code, 'vat', NULL, v_party, p_invoice);
    END IF;
  END LOOP;
  lines := accounting.line(accounting.account_for(l.id, 'receivables'), i.total, NULL, NULL, NULL, v_party, p_invoice) || lines;
  v := accounting.post_entry(l.id, i.issue_date,
         CASE WHEN i.kind = 'credit_note' THEN 'Kreditnota ' ELSE 'Faktura ' END || i.number || coalesce(' · ' || v_party, ''),
         v_type, p_invoice, lines);
  RETURN v.id;
END $$;

CREATE OR REPLACE FUNCTION public.accounting_post_payment(p_payment uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p public.invoice_payments%ROWTYPE; i public.invoices%ROWTYPE; l accounting.ledgers%ROWTYPE; v accounting.vouchers%ROWTYPE;
        v_party text;
BEGIN
  SELECT * INTO p FROM public.invoice_payments WHERE id = p_payment;
  SELECT * INTO i FROM public.invoices WHERE id = p.invoice_id;
  l := accounting.ledger_for(i.issuer_org);
  IF l.id IS NULL THEN RETURN NULL; END IF;
  v_party := nullif(i.buyer ->> 'name', '');
  v := accounting.post_entry(l.id, p.paid_on, 'Innbetaling faktura ' || i.number || coalesce(' · ' || p.reference, ''), 'payment', p_payment,
         jsonb_build_array(accounting.line(accounting.account_for(l.id, p.method), p.amount, NULL, NULL, NULL, v_party, i.id),
                           accounting.line(accounting.account_for(l.id, 'receivables'), -p.amount, NULL, NULL, NULL, v_party, i.id)));
  RETURN v.id;
END $$;

CREATE OR REPLACE FUNCTION public.accounting_post_reminder(p_reminder uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.invoice_reminders%ROWTYPE; i public.invoices%ROWTYPE; l accounting.ledgers%ROWTYPE; v accounting.vouchers%ROWTYPE;
        lines jsonb; v_party text;
BEGIN
  SELECT * INTO r FROM public.invoice_reminders WHERE id = p_reminder;
  IF r.fee + r.interest = 0 THEN RETURN NULL; END IF;
  SELECT * INTO i FROM public.invoices WHERE id = r.invoice_id;
  l := accounting.ledger_for(i.issuer_org);
  IF l.id IS NULL THEN RETURN NULL; END IF;
  v_party := nullif(i.buyer ->> 'name', '');
  lines := jsonb_build_array(accounting.line(accounting.account_for(l.id, 'receivables'), r.fee + r.interest, NULL, NULL, NULL, v_party, i.id));
  IF r.fee > 0 THEN
    lines := lines || accounting.line(accounting.account_for(l.id, 'reminder_fee'), -r.fee, CASE WHEN l.vat_registered THEN '6' END,
                                      'basis', 'Purregebyr', v_party, i.id);
  END IF;
  IF r.interest > 0 THEN
    lines := lines || accounting.line(accounting.account_for(l.id, 'late_interest'), -r.interest, NULL, NULL, 'Forsinkelsesrente', v_party, i.id);
  END IF;
  v := accounting.post_entry(l.id, (r.sent_at AT TIME ZONE 'Europe/Oslo')::date, 'Purring ' || r.level || ' faktura ' || i.number,
                             'reminder', p_reminder, lines);
  RETURN v.id;
END $$;

CREATE OR REPLACE FUNCTION public.accounting_on_invoice()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status <> 'draft' THEN PERFORM public.accounting_post_invoice(NEW.id); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS accounting_on_invoice ON public.invoices;
CREATE TRIGGER accounting_on_invoice AFTER UPDATE OF status ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.accounting_on_invoice();

CREATE OR REPLACE FUNCTION public.accounting_on_payment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN PERFORM public.accounting_post_payment(NEW.id); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS accounting_on_payment ON public.invoice_payments;
CREATE TRIGGER accounting_on_payment AFTER INSERT ON public.invoice_payments FOR EACH ROW EXECUTE FUNCTION public.accounting_on_payment();

CREATE OR REPLACE FUNCTION public.accounting_on_reminder()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN PERFORM public.accounting_post_reminder(NEW.id); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS accounting_on_reminder ON public.invoice_reminders;
CREATE TRIGGER accounting_on_reminder AFTER INSERT ON public.invoice_reminders FOR EACH ROW EXECUTE FUNCTION public.accounting_on_reminder();

-- What the engine issued since the books started and is not yet in them
-- (issued before the ledger opened, or while automatic posting was off).
CREATE OR REPLACE FUNCTION public.accounting_unposted(p_ledger uuid)
RETURNS TABLE (source_type text, source_id uuid, source_date date, description text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE l accounting.ledgers%ROWTYPE;
BEGIN
  IF NOT (accounting.can_read(p_ledger) OR public.is_server()) THEN
    RAISE EXCEPTION 'accounting: only those who work on these books' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger;
  RETURN QUERY
  SELECT CASE WHEN i.kind = 'credit_note' THEN 'credit_note' ELSE 'invoice' END, i.id, i.issue_date,
         CASE WHEN i.kind = 'credit_note' THEN 'Kreditnota ' ELSE 'Faktura ' END || i.number, i.total
    FROM public.invoices i
   WHERE i.issuer_org IS NOT DISTINCT FROM l.tenant_id AND i.status <> 'draft' AND i.issue_date >= l.start_date AND i.total <> 0
     AND NOT EXISTS (SELECT 1 FROM accounting.vouchers v WHERE v.ledger_id = l.id AND v.source_id = i.id AND v.source_type IN ('invoice', 'credit_note'))
  UNION ALL
  SELECT 'payment', p.id, p.paid_on, 'Innbetaling faktura ' || i.number, p.amount
    FROM public.invoice_payments p JOIN public.invoices i ON i.id = p.invoice_id
   WHERE i.issuer_org IS NOT DISTINCT FROM l.tenant_id AND p.paid_on >= l.start_date
     AND NOT EXISTS (SELECT 1 FROM accounting.vouchers v WHERE v.ledger_id = l.id AND v.source_id = p.id AND v.source_type = 'payment')
  UNION ALL
  SELECT 'reminder', r.id, (r.sent_at AT TIME ZONE 'Europe/Oslo')::date, 'Purring ' || r.level || ' faktura ' || i.number, r.fee + r.interest
    FROM public.invoice_reminders r JOIN public.invoices i ON i.id = r.invoice_id
   WHERE i.issuer_org IS NOT DISTINCT FROM l.tenant_id AND (r.sent_at AT TIME ZONE 'Europe/Oslo')::date >= l.start_date
     AND r.fee + r.interest > 0
     AND NOT EXISTS (SELECT 1 FROM accounting.vouchers v WHERE v.ledger_id = l.id AND v.source_id = r.id AND v.source_type = 'reminder')
  ORDER BY 3, 1;
END $$;

-- Post them: invoices first, then payments and reminders, each on its own
-- date (or the first open day after a closed period).
CREATE OR REPLACE FUNCTION public.accounting_post_unposted(p_ledger uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE l accounting.ledgers%ROWTYPE := accounting.require_role(p_ledger, ARRAY['owner', 'accountant']); r record; n integer := 0;
BEGIN
  IF NOT l.auto_post THEN RAISE EXCEPTION 'accounting: switch on automatic posting first' USING ERRCODE = '55000'; END IF;
  FOR r IN SELECT * FROM public.accounting_unposted(p_ledger)
            ORDER BY CASE WHEN source_type IN ('invoice', 'credit_note') THEN 0 ELSE 1 END, source_date LOOP
    IF r.source_type IN ('invoice', 'credit_note') THEN PERFORM public.accounting_post_invoice(r.source_id);
    ELSIF r.source_type = 'payment' THEN PERFORM public.accounting_post_payment(r.source_id);
    ELSE PERFORM public.accounting_post_reminder(r.source_id);
    END IF;
    n := n + 1;
  END LOOP;
  PERFORM accounting.log(p_ledger, 'ledger.posted_unposted', jsonb_build_object('count', n));
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.accounting_post_invoice(uuid), public.accounting_post_payment(uuid), public.accounting_post_reminder(uuid),
  public.accounting_on_invoice(), public.accounting_on_payment(), public.accounting_on_reminder() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_unposted(uuid), public.accounting_post_unposted(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accounting_unposted(uuid), public.accounting_post_unposted(uuid) TO authenticated, service_role;
