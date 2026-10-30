-- ============================================================================
-- FlyttGo — bank import: payments matched by KID from bank files
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00015 (docs/INVOICING.md → Bank
-- import). Extends the payment matching of 00008/00011 (record_payment_by_kid,
-- record_invoice_payment), which stays as it is:
--
--   * A bank file (Nets OCR giro, camt.054, camt.053; parsed by
--     supabase/functions/_shared/bank-files.ts) or pasted rows are imported
--     as one record (bank_imports: who, when, format, SHA-256, counts) with
--     one row per credit (bank_import_rows) and its outcome: matched to an
--     invoice, already recorded, already imported, unmatched with its reason,
--     or an overpayment (refused, never more than is owed).
--   * A bank transaction is counted once. Its bank reference is the one key:
--     a reference already recorded as a payment (by any file, the paste path
--     or by hand) is not counted again, and the same file is not imported
--     twice. A payment of the same amount on the same day to the same
--     invoice that arrived by another path (another file format, the paste
--     path or by hand) is held as a possible duplicate for a person to
--     decide.
--   * FlyttGo's administrators import for FlyttGo's own invoices (series
--     'main'); a company's owners, admins and finance import for the
--     company's own series only, while the company is active. KIDs are
--     matched within that series alone. The server (service role) may
--     import for either, for the automatic fetch.
--   * Unmatched rows stay open until someone records them against an invoice
--     of the series or sets them aside with a reason (resolve_bank_import_row).
--     Imports and their rows are never changed or deleted otherwise.
--   * bank_import_settings: per series, the provider for an automatic fetch
--     ('manual' until a bank or Nets agreement and its adapter exist).
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Settings: where the files come from ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_import_settings (
  series           text        PRIMARY KEY,
  issuer_org       uuid        UNIQUE REFERENCES public.organizations (id) ON DELETE CASCADE,
  provider         text        NOT NULL DEFAULT 'manual' CHECK (provider IN ('manual', 'nets_sftp', 'bank_api')),
  agreement_id     text,                                -- Nets agreement ID (avtale-ID) or the bank's agreement number
  account          text,                                -- the account the files are for
  fetch_enabled    boolean     NOT NULL DEFAULT false,
  last_fetch_at    timestamptz,
  last_fetch_error text,
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_import_settings_series CHECK ((issuer_org IS NULL AND series = 'main')
                                             OR (issuer_org IS NOT NULL AND series = 'org:' || issuer_org::text)),
  CONSTRAINT bank_import_settings_fetch CHECK (NOT fetch_enabled OR provider <> 'manual')
);


-- ── 2. Imported files and their rows ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_imports (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer_org       uuid        REFERENCES public.organizations (id) ON DELETE RESTRICT,
  series           text        NOT NULL,
  format           text        NOT NULL CHECK (format IN ('nets_ocr', 'camt054', 'camt053', 'rows')),
  source           text        NOT NULL CHECK (source IN ('upload', 'paste', 'fetch')),
  file_name        text,
  sha256           text        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  details          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  rows_total       integer     NOT NULL DEFAULT 0,
  matched          integer     NOT NULL DEFAULT 0,
  already_recorded integer     NOT NULL DEFAULT 0,
  already_imported integer     NOT NULL DEFAULT 0,
  unmatched        integer     NOT NULL DEFAULT 0,
  overpayments     integer     NOT NULL DEFAULT 0,
  amount_matched   numeric     NOT NULL DEFAULT 0,
  imported_by      uuid,
  imported_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_imports_series CHECK ((issuer_org IS NULL AND series = 'main')
                                     OR (issuer_org IS NOT NULL AND series = 'org:' || issuer_org::text))
);
-- The same file is imported once per series.
CREATE UNIQUE INDEX IF NOT EXISTS bank_imports_file_once ON public.bank_imports (series, sha256);
CREATE INDEX IF NOT EXISTS bank_imports_series_idx ON public.bank_imports (series, imported_at DESC);

CREATE TABLE IF NOT EXISTS public.bank_import_rows (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id           uuid        NOT NULL REFERENCES public.bank_imports (id) ON DELETE RESTRICT,
  issuer_org          uuid,
  series              text        NOT NULL,
  line_no             integer     NOT NULL,
  paid_on             date        NOT NULL,
  amount              numeric     NOT NULL,
  currency            text        NOT NULL,
  kid                 text,
  kid_source          text,
  bank_reference      text,
  reversal            boolean     NOT NULL DEFAULT false,
  payer               text,
  account             text,
  info                text,
  outcome             text        NOT NULL
                      CHECK (outcome IN ('matched', 'already_recorded', 'already_imported', 'unmatched', 'overpayment')),
  reason              text,
  invoice_id          uuid        REFERENCES public.invoices (id),
  payment_id          uuid        REFERENCES public.invoice_payments (id),
  resolution          text        CHECK (resolution IS NULL OR resolution IN ('recorded', 'dismissed')),
  resolution_note     text,
  resolved_payment_id uuid        REFERENCES public.invoice_payments (id),
  resolved_by         uuid,
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_import_rows_resolved CHECK ((resolution IS NULL) = (resolved_at IS NULL)),
  CONSTRAINT bank_import_rows_matched CHECK ((outcome = 'matched') = (payment_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS bank_import_rows_import_idx ON public.bank_import_rows (import_id, line_no);
CREATE INDEX IF NOT EXISTS bank_import_rows_reference_idx ON public.bank_import_rows (series, bank_reference) WHERE bank_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS bank_import_rows_open_idx ON public.bank_import_rows (series, created_at)
  WHERE outcome IN ('unmatched', 'overpayment') AND resolution IS NULL;
-- A payment comes from one row.
CREATE UNIQUE INDEX IF NOT EXISTS bank_import_rows_payment_once ON public.bank_import_rows (payment_id) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bank_import_rows_resolved_payment_once ON public.bank_import_rows (resolved_payment_id)
  WHERE resolved_payment_id IS NOT NULL;

-- An import is kept as it was; a row changes once, when an open row is
-- resolved, and only in its resolution.
DROP TRIGGER IF EXISTS guard_bank_imports ON public.bank_imports;
CREATE TRIGGER guard_bank_imports BEFORE UPDATE OR DELETE ON public.bank_imports
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();

CREATE OR REPLACE FUNCTION public.guard_bank_import_row()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_resolution text[] := ARRAY['resolution', 'resolution_note', 'resolved_payment_id', 'resolved_by', 'resolved_at'];
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.resolution IS NULL AND NEW.resolution IS NOT NULL
     AND (to_jsonb(NEW) - v_resolution) = (to_jsonb(OLD) - v_resolution) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'bank import rows are kept as imported; an open row is resolved once' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS guard_bank_import_rows ON public.bank_import_rows;
CREATE TRIGGER guard_bank_import_rows BEFORE UPDATE OR DELETE ON public.bank_import_rows
  FOR EACH ROW EXECUTE FUNCTION public.guard_bank_import_row();


-- ── 3. Who imports, who reads ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bank_import_series(p_org uuid)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT CASE WHEN p_org IS NULL THEN 'main' ELSE 'org:' || p_org::text END; $$;

-- FlyttGo's series: its administrators and the server. A company's series:
-- its owners, admins and finance while the company is active, and the server.
CREATE OR REPLACE FUNCTION public.require_bank_importer(p_org uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_org IS NULL THEN PERFORM public.require_billing_operator(); RETURN; END IF;
  IF public.is_server() OR public.is_active_org_member(p_org, ARRAY['owner', 'admin', 'finance']) THEN RETURN; END IF;
  RAISE EXCEPTION 'bank import: the company''s owners, admins and finance only, while the company is active' USING ERRCODE = '42501';
END $$;

CREATE OR REPLACE FUNCTION public.can_read_bank_import(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_admin()
      OR (p_org IS NOT NULL AND public.is_active_org_member(p_org, ARRAY['owner', 'admin', 'finance']));
$$;

ALTER TABLE public.bank_import_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_imports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_import_rows     ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_import_settings_select ON public.bank_import_settings;
CREATE POLICY bank_import_settings_select ON public.bank_import_settings FOR SELECT TO authenticated
  USING (public.can_read_bank_import(issuer_org));
DROP POLICY IF EXISTS bank_imports_select ON public.bank_imports;
CREATE POLICY bank_imports_select ON public.bank_imports FOR SELECT TO authenticated
  USING (public.can_read_bank_import(issuer_org));
DROP POLICY IF EXISTS bank_import_rows_select ON public.bank_import_rows;
CREATE POLICY bank_import_rows_select ON public.bank_import_rows FOR SELECT TO authenticated
  USING (public.can_read_bank_import(issuer_org));
-- Nobody writes the tables directly; the functions below do.
REVOKE ALL ON public.bank_import_settings, public.bank_imports, public.bank_import_rows FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.bank_import_settings, public.bank_imports, public.bank_import_rows FROM authenticated;
GRANT SELECT ON public.bank_import_settings, public.bank_imports, public.bank_import_rows TO authenticated;


-- ── 4. Settings ─────────────────────────────────────────────────────────────
-- p: {provider, agreement_id, account, fetch_enabled}. An automatic fetch
-- needs a provider other than 'manual' (and, to work, its adapter in the
-- bank-import function).
CREATE OR REPLACE FUNCTION public.set_bank_import_settings(p_org uuid, p jsonb)
RETURNS public.bank_import_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.bank_import_settings%ROWTYPE;
BEGIN
  PERFORM public.require_bank_importer(p_org);
  INSERT INTO public.bank_import_settings AS t (series, issuer_org, provider, agreement_id, account, fetch_enabled, updated_by)
  VALUES (public.bank_import_series(p_org), p_org, coalesce(nullif(btrim(p ->> 'provider'), ''), 'manual'),
          nullif(btrim(p ->> 'agreement_id'), ''), nullif(btrim(p ->> 'account'), ''),
          coalesce((p ->> 'fetch_enabled')::boolean, false), auth.uid())
  ON CONFLICT (series) DO UPDATE SET
    provider = EXCLUDED.provider, agreement_id = EXCLUDED.agreement_id, account = EXCLUDED.account,
    fetch_enabled = EXCLUDED.fetch_enabled, updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING * INTO s;
  IF p_org IS NOT NULL THEN
    PERFORM public.org_event(p_org, 'invoicing.bank_import_settings', NULL,
                             jsonb_build_object('provider', s.provider, 'fetch_enabled', s.fetch_enabled));
  END IF;
  RETURN s;
END $$;


-- ── 5. What a row would do ──────────────────────────────────────────────────
-- A row as the parser gives it (bank-files.ts rowsForDatabase), checked and
-- normalised; a malformed row stops the whole import.
CREATE OR REPLACE FUNCTION public.bank_row_clean(p_row jsonb, p_n integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v_date text := btrim(coalesce(p_row ->> 'paid_on', ''));
  v_amount text := btrim(coalesce(p_row ->> 'amount', ''));
  v_ccy text := upper(btrim(coalesce(p_row ->> 'currency', 'NOK')));
  v_kid text := regexp_replace(coalesce(p_row ->> 'kid', ''), '\s', '', 'g');
BEGIN
  IF jsonb_typeof(p_row) <> 'object' OR v_date !~ '^\d{4}-\d{2}-\d{2}$' OR v_amount !~ '^-?\d{1,13}(\.\d+)?$'
     OR v_ccy !~ '^[A-Z]{3}$' OR v_kid !~ '^[0-9-]{0,25}$' THEN
    RAISE EXCEPTION 'bank import: row % is not a bank row (date, amount, currency, KID)', p_n USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'line', coalesce(nullif(p_row ->> 'line', '')::integer, p_n), 'paid_on', v_date::date, 'amount', round(v_amount::numeric, 2),
    'currency', v_ccy, 'kid', v_kid, 'kid_source', left(p_row ->> 'kid_source', 20),
    'bank_reference', left(nullif(btrim(coalesce(p_row ->> 'bank_reference', '')), ''), 200),
    'reversal', coalesce((p_row ->> 'reversal')::boolean, false), 'payer', left(p_row ->> 'payer', 200),
    'account', left(p_row ->> 'account', 64), 'info', left(p_row ->> 'info', 500));
END $$;

-- The outcome of one row in a series. p_seen: references earlier in the
-- same file; p_pending: what earlier rows of the file pay per invoice and
-- is not yet recorded (the preview).
CREATE OR REPLACE FUNCTION public.bank_row_outcome(p_series text, p_format text, p_row jsonb, p_seen text[], p_pending jsonb,
                                                   OUT outcome text, OUT reason text, OUT invoice_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_ref     text    := p_row ->> 'bank_reference';
  v_kid     text    := p_row ->> 'kid';
  v_amount  numeric := (p_row ->> 'amount')::numeric;
  v_paid_on date    := (p_row ->> 'paid_on')::date;
  v_inv     public.invoices%ROWTYPE;
  v_paid    uuid;
  v_owed    numeric;
BEGIN
  IF v_ref IS NOT NULL THEN
    IF v_ref = ANY (p_seen) THEN
      outcome := 'already_imported'; reason := 'twice_in_file'; RETURN;
    END IF;
    SELECT p.invoice_id INTO v_paid FROM public.invoice_payments p WHERE p.method = 'bank' AND p.reference = v_ref;
    IF FOUND THEN
      IF (SELECT i.series FROM public.invoices i WHERE i.id = v_paid) = p_series THEN
        outcome := 'already_recorded'; invoice_id := v_paid;
      ELSE
        outcome := 'unmatched'; reason := 'reference_in_use';
      END IF;
      RETURN;
    END IF;
    SELECT r.invoice_id INTO invoice_id FROM public.bank_import_rows r
     WHERE r.series = p_series AND r.bank_reference = v_ref ORDER BY r.created_at LIMIT 1;
    IF FOUND THEN outcome := 'already_imported'; reason := 'earlier_import'; RETURN; END IF;
  END IF;

  IF v_kid <> '' THEN
    SELECT * INTO v_inv FROM public.invoices i WHERE i.series = p_series AND i.kind = 'invoice' AND i.kid = v_kid;
    invoice_id := v_inv.id;
  END IF;
  outcome := 'unmatched';
  IF v_ref IS NULL THEN reason := 'no_reference'; RETURN; END IF;
  IF (p_row ->> 'reversal')::boolean OR v_amount <= 0 THEN reason := 'reversal'; RETURN; END IF;
  IF p_row ->> 'currency' <> 'NOK' THEN reason := 'currency'; RETURN; END IF;
  IF v_kid = '' THEN reason := 'no_kid'; RETURN; END IF;
  IF v_inv.id IS NULL OR v_inv.status = 'draft' THEN reason := 'no_invoice'; invoice_id := NULL; RETURN; END IF;

  v_owed := public.invoice_outstanding(v_inv) - coalesce((p_pending ->> v_inv.id::text)::numeric, 0);
  IF v_amount > v_owed THEN
    outcome := 'overpayment'; reason := CASE WHEN v_owed <= 0 THEN 'nothing_owed' ELSE 'more_than_owed' END; RETURN;
  END IF;
  -- The same payment may have come by another path with another reference.
  IF EXISTS (SELECT 1 FROM public.invoice_payments p
              WHERE p.invoice_id = v_inv.id AND p.method = 'bank' AND p.amount = v_amount AND p.paid_on = v_paid_on
                AND NOT EXISTS (SELECT 1 FROM public.bank_import_rows r JOIN public.bank_imports b ON b.id = r.import_id
                                 WHERE p.id IN (r.payment_id, r.resolved_payment_id) AND b.format = p_format)) THEN
    reason := 'possible_duplicate'; RETURN;
  END IF;
  outcome := 'matched';
END $$;

CREATE OR REPLACE FUNCTION public.bank_import_check(p_format text, p_source text, p_sha256 text, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
BEGIN
  IF p_format IS NULL OR p_format NOT IN ('nets_ocr', 'camt054', 'camt053', 'rows') THEN
    RAISE EXCEPTION 'bank import: unknown format %', p_format USING ERRCODE = '22023';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('upload', 'paste', 'fetch') THEN
    RAISE EXCEPTION 'bank import: unknown source %', p_source USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'bank import: the file''s SHA-256 (64 hex digits) is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'bank import: the rows must be a list of at most 5000' USING ERRCODE = '22023';
  END IF;
END $$;


-- ── 6. Preview, import, resolve ─────────────────────────────────────────────
-- What the file would do, without recording anything.
CREATE OR REPLACE FUNCTION public.preview_bank_import(p_org uuid, p_format text, p_sha256 text, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_series  text := public.bank_import_series(p_org);
  v_prev    public.bank_imports%ROWTYPE;
  v_row     jsonb;
  v_n       integer := 0;
  v_seen    text[] := '{}';
  v_pending jsonb := '{}';
  v_out     jsonb := '[]';
  v_count   jsonb := '{}';
  o         record;
  v_inv     public.invoices%ROWTYPE;
BEGIN
  PERFORM public.require_bank_importer(p_org);
  PERFORM public.bank_import_check(p_format, 'upload', lower(p_sha256), p_rows);
  SELECT * INTO v_prev FROM public.bank_imports WHERE series = v_series AND sha256 = lower(p_sha256);
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_n := v_n + 1;
    v_row := public.bank_row_clean(v_row, v_n);
    SELECT * INTO o FROM public.bank_row_outcome(v_series, p_format, v_row, v_seen, v_pending);
    IF v_row ->> 'bank_reference' IS NOT NULL THEN v_seen := v_seen || (v_row ->> 'bank_reference'); END IF;
    v_inv := NULL;
    IF o.invoice_id IS NOT NULL THEN SELECT * INTO v_inv FROM public.invoices WHERE id = o.invoice_id; END IF;
    IF o.outcome = 'matched' THEN
      v_pending := v_pending || jsonb_build_object(o.invoice_id::text,
                     coalesce((v_pending ->> o.invoice_id::text)::numeric, 0) + (v_row ->> 'amount')::numeric);
    END IF;
    v_count := v_count || jsonb_build_object(o.outcome, coalesce((v_count ->> o.outcome)::integer, 0) + 1);
    v_out := v_out || jsonb_build_array(v_row || jsonb_build_object(
               'outcome', o.outcome, 'reason', o.reason, 'invoice_id', o.invoice_id, 'invoice_number', v_inv.number,
               'outstanding', CASE WHEN v_inv.id IS NOT NULL THEN public.invoice_outstanding(v_inv) END));
  END LOOP;
  RETURN jsonb_build_object('series', v_series, 'format', p_format, 'rows', v_out, 'counts', v_count,
                            'already_imported_at', v_prev.imported_at);
END $$;

-- Import a file: each row's outcome, the matched ones recorded as bank
-- payments (record_invoice_payment: never more than is owed). One import
-- at a time per series. Returns the import with its counts.
CREATE OR REPLACE FUNCTION public.import_bank_file(p_org uuid, p_format text, p_source text, p_file_name text,
                                                   p_sha256 text, p_rows jsonb, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS public.bank_imports
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_series  text := public.bank_import_series(p_org);
  v_sha     text := lower(p_sha256);
  v_imp     public.bank_imports%ROWTYPE;
  v_row     jsonb;
  v_n       integer := 0;
  v_seen    text[] := '{}';
  v_rows    jsonb := '[]';
  v_payment uuid;
  v_amount  numeric;
  v_matched integer := 0; v_recorded integer := 0; v_imported integer := 0; v_unmatched integer := 0; v_over integer := 0;
  v_sum     numeric := 0;
  o         record;
  v_outcome text; v_reason text;
BEGIN
  PERFORM public.require_bank_importer(p_org);
  PERFORM public.bank_import_check(p_format, p_source, v_sha, p_rows);
  IF p_source = 'fetch' AND NOT public.is_server() THEN
    RAISE EXCEPTION 'bank import: only the server records a fetched file' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bank_import:' || v_series, 0));
  SELECT * INTO v_imp FROM public.bank_imports WHERE series = v_series AND sha256 = v_sha;
  IF FOUND THEN
    RAISE EXCEPTION 'bank import: this file was already imported on %', to_char(v_imp.imported_at AT TIME ZONE 'Europe/Oslo', 'YYYY-MM-DD HH24:MI')
      USING ERRCODE = '23505';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_n := v_n + 1;
    v_row := public.bank_row_clean(v_row, v_n);
    SELECT * INTO o FROM public.bank_row_outcome(v_series, p_format, v_row, v_seen, '{}'::jsonb);
    v_outcome := o.outcome; v_reason := o.reason; v_payment := NULL;
    v_amount := (v_row ->> 'amount')::numeric;
    IF v_row ->> 'bank_reference' IS NOT NULL THEN v_seen := v_seen || (v_row ->> 'bank_reference'); END IF;
    IF v_outcome = 'matched' THEN
      BEGIN
        PERFORM public.record_invoice_payment(o.invoice_id, v_amount, (v_row ->> 'paid_on')::date, 'bank', v_row ->> 'bank_reference');
        SELECT id INTO v_payment FROM public.invoice_payments WHERE method = 'bank' AND reference = v_row ->> 'bank_reference';
      EXCEPTION
        WHEN unique_violation THEN v_outcome := 'already_recorded';          -- recorded meanwhile by another path
        WHEN invalid_parameter_value THEN v_outcome := 'overpayment'; v_reason := 'more_than_owed';
      END;
    END IF;
    CASE v_outcome
      WHEN 'matched' THEN v_matched := v_matched + 1; v_sum := v_sum + v_amount;
      WHEN 'already_recorded' THEN v_recorded := v_recorded + 1;
      WHEN 'already_imported' THEN v_imported := v_imported + 1;
      WHEN 'overpayment' THEN v_over := v_over + 1;
      ELSE v_unmatched := v_unmatched + 1;
    END CASE;
    v_rows := v_rows || jsonb_build_array(v_row || jsonb_build_object('outcome', v_outcome, 'reason', v_reason,
                                                                      'invoice_id', o.invoice_id, 'payment_id', v_payment));
  END LOOP;

  INSERT INTO public.bank_imports (issuer_org, series, format, source, file_name, sha256, details, rows_total, matched,
                                   already_recorded, already_imported, unmatched, overpayments, amount_matched, imported_by)
  VALUES (p_org, v_series, p_format, p_source, left(nullif(btrim(coalesce(p_file_name, '')), ''), 200), v_sha,
          coalesce(p_details, '{}'::jsonb), v_n, v_matched, v_recorded, v_imported, v_unmatched, v_over, v_sum, auth.uid())
  RETURNING * INTO v_imp;
  INSERT INTO public.bank_import_rows (import_id, issuer_org, series, line_no, paid_on, amount, currency, kid, kid_source,
                                       bank_reference, reversal, payer, account, info, outcome, reason, invoice_id, payment_id)
  SELECT v_imp.id, p_org, v_series, x.line, x.paid_on, x.amount, x.currency, nullif(x.kid, ''), x.kid_source,
         x.bank_reference, x.reversal, x.payer, x.account, x.info, x.outcome, x.reason, x.invoice_id, x.payment_id
    FROM jsonb_to_recordset(v_rows) AS x(line integer, paid_on date, amount numeric, currency text, kid text, kid_source text,
                                         bank_reference text, reversal boolean, payer text, account text, info text,
                                         outcome text, reason text, invoice_id uuid, payment_id uuid);
  IF p_org IS NOT NULL THEN
    PERFORM public.org_event(p_org, 'invoicing.bank_import', NULL,
                             jsonb_build_object('import', v_imp.id, 'format', p_format, 'rows', v_n, 'matched', v_matched,
                                                'unmatched', v_unmatched + v_over));
  END IF;
  RETURN v_imp;
END $$;

-- An open row (unmatched or overpayment): record it against an invoice of
-- the same series (the amount as the bank credited it, never more than is
-- owed), or set it aside with the reason (refunded, not ours, …).
CREATE OR REPLACE FUNCTION public.resolve_bank_import_row(p_row uuid, p_invoice uuid, p_note text)
RETURNS public.bank_import_rows
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row public.bank_import_rows%ROWTYPE;
  v_inv public.invoices%ROWTYPE;
  v_ref text;
  v_pay uuid;
BEGIN
  SELECT * INTO v_row FROM public.bank_import_rows WHERE id = p_row FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank import: row not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.require_bank_importer(v_row.issuer_org);
  IF v_row.outcome NOT IN ('unmatched', 'overpayment') OR v_row.resolution IS NOT NULL THEN
    RAISE EXCEPTION 'bank import: only an open unmatched row is resolved, once' USING ERRCODE = '55000';
  END IF;

  IF p_invoice IS NULL THEN
    IF coalesce(btrim(p_note), '') = '' THEN
      RAISE EXCEPTION 'bank import: say why the row is set aside (for example: refunded to the payer)' USING ERRCODE = '22023';
    END IF;
    UPDATE public.bank_import_rows SET resolution = 'dismissed', resolution_note = btrim(p_note), resolved_by = auth.uid(),
           resolved_at = now()
     WHERE id = p_row RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  IF v_row.reversal OR v_row.amount <= 0 OR v_row.currency <> 'NOK' THEN
    RAISE EXCEPTION 'bank import: a reversal or a payment in another currency is handled by hand, not recorded against an invoice'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice;
  IF NOT FOUND OR v_inv.series <> v_row.series THEN
    RAISE EXCEPTION 'bank import: the invoice is not one of this series'' invoices' USING ERRCODE = '42501';
  END IF;
  -- The bank's reference, or one made for this row: either way the
  -- transaction is recorded once.
  v_ref := coalesce(v_row.bank_reference, 'bank-import-row:' || v_row.id::text);
  IF EXISTS (SELECT 1 FROM public.invoice_payments WHERE method = 'bank' AND reference = v_ref) THEN
    RAISE EXCEPTION 'bank import: this bank transaction is already recorded' USING ERRCODE = '23505';
  END IF;
  PERFORM public.record_invoice_payment(p_invoice, v_row.amount, v_row.paid_on, 'bank', v_ref);
  SELECT id INTO v_pay FROM public.invoice_payments WHERE method = 'bank' AND reference = v_ref;
  UPDATE public.bank_import_rows SET resolution = 'recorded', resolved_payment_id = v_pay,
         resolution_note = nullif(btrim(coalesce(p_note, '')), ''), resolved_by = auth.uid(), resolved_at = now()
   WHERE id = p_row RETURNING * INTO v_row;
  RETURN v_row;
END $$;


-- ── 7. Who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.guard_bank_import_row(), public.bank_import_series(uuid), public.require_bank_importer(uuid),
  public.can_read_bank_import(uuid), public.set_bank_import_settings(uuid, jsonb), public.bank_row_clean(jsonb, integer),
  public.bank_row_outcome(text, text, jsonb, text[], jsonb), public.bank_import_check(text, text, text, jsonb),
  public.preview_bank_import(uuid, text, text, jsonb), public.import_bank_file(uuid, text, text, text, text, jsonb, jsonb),
  public.resolve_bank_import_row(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
-- Callable from the app (each checks its caller) and by the server.
GRANT EXECUTE ON FUNCTION public.set_bank_import_settings(uuid, jsonb), public.preview_bank_import(uuid, text, text, jsonb),
  public.import_bank_file(uuid, text, text, text, text, jsonb, jsonb), public.resolve_bank_import_row(uuid, uuid, text)
  TO authenticated, service_role;
-- RLS helper, run inside the policies as the caller.
GRANT EXECUTE ON FUNCTION public.can_read_bank_import(uuid) TO authenticated, service_role;

-- ============================================================================
-- DONE
-- ============================================================================
