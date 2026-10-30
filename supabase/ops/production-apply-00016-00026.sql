-- ============================================================================
-- FlyttGo: migrations 00016-00020, 00022 and 00026 as one file, for the
-- production SQL editor
-- ============================================================================
-- Owner's approval 2026-10-30 ("migrations", then "merge all"). Production
-- already has 00002-00015, 00021 and 00023-00025 (read 2026-10-30). These
-- were rehearsed on the production replica in exactly that order: the
-- replica with 00002-00015, 00021, 00023-00025 and representative data,
-- then these seven twice; financial records unchanged, release-rehearsal
-- checks and all 22 test files passed. Rollbacks: supabase/rollback/.
-- Every new feature stays off until it is enabled (add-ons, plans, API).
-- Run once in Supabase -> FlyttGo Norway -> SQL Editor. One transaction:
-- everything is applied, or (on any error) nothing is. Generated from the
-- migration files without changes, plus their rows in
-- supabase_migrations.schema_migrations.
-- ============================================================================
BEGIN;

-- ===== 00016_bank_import.sql =====
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

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261030160016', '00016_bank_import')
ON CONFLICT (version) DO NOTHING;

-- ===== 00017_spending_limits.sql =====
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

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261030160017', '00017_spending_limits')
ON CONFLICT (version) DO NOTHING;

-- ===== 00018_api_keys.sql =====
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

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261030160018', '00018_api_keys')
ON CONFLICT (version) DO NOTHING;

-- ===== 00019_reservations.sql =====
-- ============================================================================
-- FlyttGo — Reservations: restaurant tables and hotel rooms
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00015 (and 00016–00018); builds on 00010,
-- 00011 and the patterns of 00013 (docs/SERVICE_PLATFORM.md).
-- Two booking modules beside Jobs (00012) and Appointments (00013), each
-- enabled by the company's plan (org_has_module()). The company is always
-- the seller (Model B).
--
-- Restaurant tables ('restaurant_reservations'):
--   * The company lists its tables (seats, the smallest party it seats,
--     whether it can be combined) and the combinations it allows, its
--     service periods per weekday (lunch, dinner), the time a table is kept
--     per party size, its booking window and lead time, closed dates, and
--     an optional no-show fee.
--   * available_restaurant_times() computes free times for a day and party
--     size in Europe/Oslo: a time is offered when a table (or an allowed
--     combination) that fits the party is free for the whole turn.
--     Visitors see them before signing in; booking needs a sign-in. A lock
--     per restaurant (its floor: a reservation may take several tables)
--     means two people never get the same table.
--   * The company books phone guests and walk-ins (also outside the
--     periods, never over another reservation), seats them, and marks them
--     completed or no-show. Notes are the guest's own words (for example
--     allergies); there is no health field.
--   * A no-show fee is charged only when the company had stated one before
--     the booking: the fee is copied onto the reservation when it is made,
--     and invoiced in the company's name (00011).
--
-- Hotel rooms ('hotel_reservations'):
--   * Room types (capacity, nightly price incl. MVA), rooms, closed rooms
--     and dates, and the hotel's rules: the MVA rate for accommodation (a
--     company setting: never assumed here), check-in and check-out times,
--     booking window, lead time, nights, and the cancellation rule (free
--     until N days before arrival, then a fee as a share of the stay).
--   * available_hotel_rooms() lists the free room types for a date range.
--     Every stay is given a room when it is booked, under a lock per room
--     type, so a night is never sold twice.
--   * The company checks guests in (optionally into another room) and out,
--     marks no-shows, cancels; the stay, or the cancellation fee, is
--     invoiced in the company's name (00011).
--   * Only what the booking needs is stored (name, phone, email, number of
--     guests). The guest register Norwegian hotels must keep is not built
--     here: an owner and legal decision (docs/SERVICE_PLATFORM.md).
--
-- Reminders are sent by appointment-reminders (hourly): the day before a
-- table, the day before arrival.
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Plans carry the new modules ──────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'white_label_plans_modules_check'
               AND pg_get_constraintdef(oid) NOT LIKE '%restaurant_reservations%') THEN
    ALTER TABLE public.white_label_plans DROP CONSTRAINT white_label_plans_modules_check;
    ALTER TABLE public.white_label_plans ADD CONSTRAINT white_label_plans_modules_check CHECK (
          modules <@ ARRAY['jobs', 'appointments', 'sales_invoicing', 'restaurant_reservations', 'hotel_reservations']
      -- FlyttGo sells only moving and delivery.
      AND (seller_model = 'company' OR (cardinality(modules) = 0 AND industries <@ ARRAY['transport'])));
  END IF;
  -- A company's invoice can come from a table reservation or a hotel stay.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_source_type_check'
               AND pg_get_constraintdef(oid) NOT LIKE '%hotel_stay%') THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_source_type_check;
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_source_type_check CHECK (
      source_type IS NULL OR source_type IN ('job', 'appointment', 'manual', 'restaurant_reservation', 'hotel_stay'));
  END IF;
END $$;

-- Proposed plans and prices (excl. MVA), until FlyttGo confirms them in
-- Admin → White label. The company sells.
INSERT INTO public.white_label_plans (code, name, seller_model, summary, for_whom, setup_fee, monthly_fee, own_domain,
                                      features, flyttgo_does, company_does, requirements, sort, modules, industries)
SELECT * FROM (VALUES
  ('restaurant', 'Restaurant: table booking', 'company',
   'Guests book a table online for their party; you book phone guests and walk-ins, seat them and see the evening at a glance.',
   'Restaurants, cafés and bars that take table reservations.',
   2900::numeric, 990::numeric, false,
   ARRAY['Online table booking by party size, in your service periods',
         'Your tables and the combinations you allow; no table booked twice',
         'Phone bookings and walk-ins, seating, completed and no-show',
         'Your cancellation rule and an optional no-show fee, invoiced in your name',
         'Email reminders the day before',
         'A website from the template library'],
   ARRAY['Runs the booking and invoicing system and sends reminders',
         'Processes your guests'' data for you under the data processing agreement'],
   ARRAY['Is the seller of its services',
         'Customer service, its terms and privacy notice, its own accounts'],
   ARRAY['An active (verified) company', 'Customer service email and phone', 'Your terms and privacy notice (web addresses)',
         'The data processing agreement, accepted by an owner'],
   70, ARRAY['restaurant_reservations', 'sales_invoicing'], ARRAY['hospitality']),
  ('hotel', 'Hotel: room booking', 'company',
   'Guests book a room type for their dates; you check them in and out and invoice the stay in your own name.',
   'Hotels, guesthouses, B&Bs, cabins and other accommodation.',
   4900::numeric, 1490::numeric, false,
   ARRAY['Online booking of your room types for a date range',
         'Rooms, closed rooms and dates; no night sold twice',
         'Phone bookings, check-in (also to another room), check-out and no-shows',
         'Your cancellation rule: free until a number of days before arrival, then a fee',
         'Invoice of the stay or the fee in your name, card or bank payment',
         'Email reminders the day before arrival',
         'A website from the template library'],
   ARRAY['Runs the booking and invoicing system and sends reminders',
         'Processes your guests'' data for you under the data processing agreement'],
   ARRAY['Is the seller of its accommodation',
         'Its guest register and other duties as an accommodation business',
         'Customer service, its terms and privacy notice, its own accounts'],
   ARRAY['An active (verified) company', 'Customer service email and phone', 'Your terms and privacy notice (web addresses)',
         'The data processing agreement, accepted by an owner'],
   80, ARRAY['hotel_reservations', 'sales_invoicing'], ARRAY['hospitality'])
) AS v(code, name, seller_model, summary, for_whom, setup_fee, monthly_fee, own_domain, features, flyttgo_does,
       company_does, requirements, sort, modules, industries)
WHERE NOT EXISTS (SELECT 1 FROM public.white_label_plans p WHERE p.code = v.code);


-- ── 2. Restaurant tables ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.restaurant_settings (
  organization_id      uuid        PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  slot_step_minutes    integer     NOT NULL DEFAULT 15 CHECK (slot_step_minutes IN (10, 15, 20, 30, 60)),
  booking_window_days  integer     NOT NULL DEFAULT 60 CHECK (booking_window_days BETWEEN 1 AND 365),
  lead_time_minutes    integer     NOT NULL DEFAULT 60 CHECK (lead_time_minutes BETWEEN 0 AND 10080),
  max_party_online     integer     NOT NULL DEFAULT 8 CHECK (max_party_online BETWEEN 1 AND 100),  -- larger parties call
  default_turn_minutes integer     NOT NULL DEFAULT 120 CHECK (default_turn_minutes BETWEEN 15 AND 480),
  cancel_hours         integer     NOT NULL DEFAULT 2 CHECK (cancel_hours BETWEEN 0 AND 168),
  no_show_fee          numeric     CHECK (no_show_fee IS NULL OR no_show_fee > 0),               -- incl. MVA
  no_show_fee_per      text        NOT NULL DEFAULT 'guest' CHECK (no_show_fee_per IN ('guest', 'booking')),
  no_show_vat_rate     numeric     CHECK (no_show_vat_rate IS NULL OR no_show_vat_rate IN (0, 12, 15, 25)),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_settings_fee_vat CHECK (no_show_fee IS NULL OR no_show_vat_rate IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.restaurant_tables (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  area            text,                                          -- e.g. window, terrace
  seats           integer     NOT NULL CHECK (seats BETWEEN 1 AND 50),
  min_seats       integer     NOT NULL DEFAULT 1,                -- the smallest party given this table online
  combinable      boolean     NOT NULL DEFAULT false,
  active          boolean     NOT NULL DEFAULT true,
  sort            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  CONSTRAINT restaurant_tables_seats CHECK (min_seats BETWEEN 1 AND seats)
);

-- The combinations the company allows (tables pushed together), of
-- combinable tables only.
CREATE TABLE IF NOT EXISTS public.restaurant_table_groups (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  min_seats       integer     NOT NULL DEFAULT 1 CHECK (min_seats BETWEEN 1 AND 100),
  active          boolean     NOT NULL DEFAULT true,
  sort            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.restaurant_table_group_members (
  group_id uuid NOT NULL REFERENCES public.restaurant_table_groups (id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.restaurant_tables (id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, table_id)
);

-- Service periods per weekday (ISO: 1 Monday … 7 Sunday), in local time.
-- The last seating is when the last table is given; without one it is the
-- end minus the party's turn.
CREATE TABLE IF NOT EXISTS public.restaurant_service_periods (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid    NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  weekday         integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  name            text    NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  start_time      time    NOT NULL,
  end_time        time    NOT NULL,
  last_seating    time,
  CONSTRAINT restaurant_service_periods_order CHECK (end_time > start_time
    AND (last_seating IS NULL OR last_seating BETWEEN start_time AND end_time))
);
CREATE INDEX IF NOT EXISTS restaurant_service_periods_org_idx ON public.restaurant_service_periods (organization_id, weekday);

-- How long a table is kept, by party size: the first row whose up_to_party
-- covers the party; beyond the last row, the default turn.
CREATE TABLE IF NOT EXISTS public.restaurant_turn_times (
  organization_id uuid    NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  up_to_party     integer NOT NULL CHECK (up_to_party BETWEEN 1 AND 100),
  minutes         integer NOT NULL CHECK (minutes BETWEEN 15 AND 480),
  PRIMARY KEY (organization_id, up_to_party)
);

CREATE TABLE IF NOT EXISTS public.restaurant_closed_dates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  day             date        NOT NULL,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, day)
);

CREATE TABLE IF NOT EXISTS public.restaurant_reservations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  number           integer     NOT NULL,
  customer_user_id uuid,
  customer         jsonb       NOT NULL,                       -- name, phone, email
  party_size       integer     NOT NULL CHECK (party_size BETWEEN 1 AND 100),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,                       -- start + turn (earlier once completed)
  period           text,                                       -- the service period's name, when booked in one
  notes            text,                                       -- the guest's own words (e.g. allergies)
  source           text        NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'phone', 'walk_in')),
  status           text        NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'seated', 'completed', 'no_show', 'cancelled')),
  no_show_fee      numeric     CHECK (no_show_fee IS NULL OR no_show_fee > 0),   -- stated before the booking (incl. MVA)
  no_show_vat_rate numeric,
  seated_at        timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  cancelled_by     text        CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'company')),
  cancel_reason    text,
  reminded_at      timestamptz,
  invoice_id       uuid        REFERENCES public.invoices (id),
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  CONSTRAINT restaurant_reservations_order CHECK (ends_at > starts_at),
  CONSTRAINT restaurant_reservations_fee_vat CHECK (no_show_fee IS NULL OR no_show_vat_rate IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS restaurant_reservations_org_idx ON public.restaurant_reservations (organization_id, starts_at);
CREATE INDEX IF NOT EXISTS restaurant_reservations_customer_idx ON public.restaurant_reservations (customer_user_id) WHERE customer_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.restaurant_reservation_tables (
  reservation_id uuid NOT NULL REFERENCES public.restaurant_reservations (id) ON DELETE CASCADE,
  table_id       uuid NOT NULL REFERENCES public.restaurant_tables (id),
  PRIMARY KEY (reservation_id, table_id)
);
CREATE INDEX IF NOT EXISTS restaurant_reservation_tables_table_idx ON public.restaurant_reservation_tables (table_id);

CREATE TABLE IF NOT EXISTS public.restaurant_reservation_events (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id uuid        NOT NULL REFERENCES public.restaurant_reservations (id) ON DELETE CASCADE,
  actor_id       uuid,
  action         text        NOT NULL,
  details        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurant_reservation_events_idx ON public.restaurant_reservation_events (reservation_id, created_at);
DROP TRIGGER IF EXISTS guard_restaurant_reservation_events ON public.restaurant_reservation_events;
CREATE TRIGGER guard_restaurant_reservation_events BEFORE UPDATE OR DELETE ON public.restaurant_reservation_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();


-- ── 3. Hotel rooms ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hotel_settings (
  organization_id     uuid        PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  vat_rate            numeric     CHECK (vat_rate IS NULL OR vat_rate IN (0, 12, 15, 25)),  -- the company's rate for accommodation
  check_in_from       time        NOT NULL DEFAULT '15:00',
  check_out_by        time        NOT NULL DEFAULT '11:00',
  booking_window_days integer     NOT NULL DEFAULT 365 CHECK (booking_window_days BETWEEN 1 AND 730),
  lead_days           integer     NOT NULL DEFAULT 0 CHECK (lead_days BETWEEN 0 AND 60),
  min_nights          integer     NOT NULL DEFAULT 1 CHECK (min_nights BETWEEN 1 AND 60),
  max_nights          integer     NOT NULL DEFAULT 30 CHECK (max_nights BETWEEN 1 AND 365),
  free_cancel_days    integer     NOT NULL DEFAULT 1 CHECK (free_cancel_days BETWEEN 0 AND 90),
  late_cancel_fee_pct numeric     CHECK (late_cancel_fee_pct IS NULL OR late_cancel_fee_pct BETWEEN 1 AND 100),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_settings_nights CHECK (min_nights <= max_nights)
);

CREATE TABLE IF NOT EXISTS public.hotel_room_types (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  description     text,
  capacity        integer     NOT NULL CHECK (capacity BETWEEN 1 AND 20),
  nightly_price   numeric     NOT NULL CHECK (nightly_price >= 0),                       -- incl. MVA
  active          boolean     NOT NULL DEFAULT true,
  sort            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hotel_room_types_org_idx ON public.hotel_room_types (organization_id, sort);

CREATE TABLE IF NOT EXISTS public.hotel_rooms (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  room_type_id    uuid        NOT NULL REFERENCES public.hotel_room_types (id),
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),   -- e.g. 214
  active          boolean     NOT NULL DEFAULT true,
  sort            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS hotel_rooms_type_idx ON public.hotel_rooms (room_type_id);

-- A room closed for some nights (from_date up to, not including, to_date);
-- without a room, the whole hotel.
CREATE TABLE IF NOT EXISTS public.hotel_closures (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  room_id         uuid        REFERENCES public.hotel_rooms (id) ON DELETE CASCADE,
  from_date       date        NOT NULL,
  to_date         date        NOT NULL,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_closures_order CHECK (to_date > from_date)
);
CREATE INDEX IF NOT EXISTS hotel_closures_org_idx ON public.hotel_closures (organization_id, from_date);

CREATE TABLE IF NOT EXISTS public.hotel_stays (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  number           integer     NOT NULL,
  room_type_id     uuid        NOT NULL REFERENCES public.hotel_room_types (id),
  room_id          uuid        NOT NULL REFERENCES public.hotel_rooms (id),
  customer_user_id uuid,
  customer         jsonb       NOT NULL,                       -- name, phone, email
  guests           integer     NOT NULL CHECK (guests BETWEEN 1 AND 20),
  check_in         date        NOT NULL,
  check_out        date        NOT NULL,
  nights           integer     GENERATED ALWAYS AS (check_out - check_in) STORED,
  nightly_price    numeric     NOT NULL,                       -- incl. MVA, as booked
  total            numeric     NOT NULL,
  vat_rate         numeric     NOT NULL,
  free_cancel_until date,                                      -- the last day to cancel without a fee
  late_cancel_fee  numeric,                                    -- as stated before the booking (incl. MVA)
  cancel_fee       numeric,                                    -- charged on a late cancellation or no-show
  notes            text,
  status           text        NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'checked_in', 'checked_out', 'no_show', 'cancelled')),
  checked_in_at    timestamptz,
  checked_out_at   timestamptz,
  cancelled_at     timestamptz,
  cancelled_by     text        CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'company')),
  cancel_reason    text,
  reminded_at      timestamptz,
  invoice_id       uuid        REFERENCES public.invoices (id),
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  CONSTRAINT hotel_stays_order CHECK (check_out > check_in)
);
CREATE INDEX IF NOT EXISTS hotel_stays_room_idx ON public.hotel_stays (room_id, check_in) WHERE status IN ('booked', 'checked_in');
CREATE INDEX IF NOT EXISTS hotel_stays_org_idx ON public.hotel_stays (organization_id, check_in);
CREATE INDEX IF NOT EXISTS hotel_stays_customer_idx ON public.hotel_stays (customer_user_id) WHERE customer_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.hotel_stay_events (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stay_id    uuid        NOT NULL REFERENCES public.hotel_stays (id) ON DELETE CASCADE,
  actor_id   uuid,
  action     text        NOT NULL,
  details    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hotel_stay_events_idx ON public.hotel_stay_events (stay_id, created_at);
DROP TRIGGER IF EXISTS guard_hotel_stay_events ON public.hotel_stay_events;
CREATE TRIGGER guard_hotel_stay_events BEFORE UPDATE OR DELETE ON public.hotel_stay_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();


-- ── 4. Who reads what ───────────────────────────────────────────────────────
-- The guest, and the company's members (staff work the floor and the desk).
CREATE OR REPLACE FUNCTION public.can_read_restaurant_reservation(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.restaurant_reservations r
     WHERE r.id = p_id AND (r.customer_user_id = auth.uid()
        OR public.is_org_member(r.organization_id, ARRAY['owner', 'admin', 'booker', 'finance', 'viewer', 'staff'])));
$$;

CREATE OR REPLACE FUNCTION public.can_read_hotel_stay(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.hotel_stays s
     WHERE s.id = p_id AND (s.customer_user_id = auth.uid()
        OR public.is_org_member(s.organization_id, ARRAY['owner', 'admin', 'booker', 'finance', 'viewer', 'staff'])));
$$;

ALTER TABLE public.restaurant_settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_tables              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_table_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_table_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_service_periods     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_turn_times          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_closed_dates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_reservations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_reservation_tables  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_reservation_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_settings                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_room_types               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_rooms                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_closures                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_stays                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_stay_events              ENABLE ROW LEVEL SECURITY;

-- The public parts (rules, service periods, room types) for visitors; the
-- floor plan, rooms and closures for the company.
DROP POLICY IF EXISTS restaurant_settings_public ON public.restaurant_settings;
CREATE POLICY restaurant_settings_public ON public.restaurant_settings FOR SELECT TO anon
  USING (public.org_has_module(organization_id, 'restaurant_reservations'));
DROP POLICY IF EXISTS restaurant_settings_select ON public.restaurant_settings;
CREATE POLICY restaurant_settings_select ON public.restaurant_settings FOR SELECT TO authenticated
  USING (public.org_has_module(organization_id, 'restaurant_reservations') OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS restaurant_service_periods_public ON public.restaurant_service_periods;
CREATE POLICY restaurant_service_periods_public ON public.restaurant_service_periods FOR SELECT TO anon
  USING (public.org_has_module(organization_id, 'restaurant_reservations'));
DROP POLICY IF EXISTS restaurant_service_periods_select ON public.restaurant_service_periods;
CREATE POLICY restaurant_service_periods_select ON public.restaurant_service_periods FOR SELECT TO authenticated
  USING (public.org_has_module(organization_id, 'restaurant_reservations') OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS restaurant_tables_select ON public.restaurant_tables;
CREATE POLICY restaurant_tables_select ON public.restaurant_tables FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS restaurant_table_groups_select ON public.restaurant_table_groups;
CREATE POLICY restaurant_table_groups_select ON public.restaurant_table_groups FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS restaurant_table_group_members_select ON public.restaurant_table_group_members;
CREATE POLICY restaurant_table_group_members_select ON public.restaurant_table_group_members FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.restaurant_table_groups g WHERE g.id = group_id));
DROP POLICY IF EXISTS restaurant_turn_times_select ON public.restaurant_turn_times;
CREATE POLICY restaurant_turn_times_select ON public.restaurant_turn_times FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS restaurant_closed_dates_select ON public.restaurant_closed_dates;
CREATE POLICY restaurant_closed_dates_select ON public.restaurant_closed_dates FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS restaurant_reservations_select ON public.restaurant_reservations;
CREATE POLICY restaurant_reservations_select ON public.restaurant_reservations FOR SELECT TO authenticated
  USING (public.can_read_restaurant_reservation(id));
DROP POLICY IF EXISTS restaurant_reservation_tables_select ON public.restaurant_reservation_tables;
CREATE POLICY restaurant_reservation_tables_select ON public.restaurant_reservation_tables FOR SELECT TO authenticated
  USING (public.can_read_restaurant_reservation(reservation_id));
DROP POLICY IF EXISTS restaurant_reservation_events_select ON public.restaurant_reservation_events;
CREATE POLICY restaurant_reservation_events_select ON public.restaurant_reservation_events FOR SELECT TO authenticated
  USING (public.can_read_restaurant_reservation(reservation_id));

DROP POLICY IF EXISTS hotel_settings_public ON public.hotel_settings;
CREATE POLICY hotel_settings_public ON public.hotel_settings FOR SELECT TO anon
  USING (public.org_has_module(organization_id, 'hotel_reservations'));
DROP POLICY IF EXISTS hotel_settings_select ON public.hotel_settings;
CREATE POLICY hotel_settings_select ON public.hotel_settings FOR SELECT TO authenticated
  USING (public.org_has_module(organization_id, 'hotel_reservations') OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS hotel_room_types_public ON public.hotel_room_types;
CREATE POLICY hotel_room_types_public ON public.hotel_room_types FOR SELECT TO anon
  USING (active AND public.org_has_module(organization_id, 'hotel_reservations'));
DROP POLICY IF EXISTS hotel_room_types_select ON public.hotel_room_types;
CREATE POLICY hotel_room_types_select ON public.hotel_room_types FOR SELECT TO authenticated
  USING ((active AND public.org_has_module(organization_id, 'hotel_reservations')) OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS hotel_rooms_select ON public.hotel_rooms;
CREATE POLICY hotel_rooms_select ON public.hotel_rooms FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS hotel_closures_select ON public.hotel_closures;
CREATE POLICY hotel_closures_select ON public.hotel_closures FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS hotel_stays_select ON public.hotel_stays;
CREATE POLICY hotel_stays_select ON public.hotel_stays FOR SELECT TO authenticated USING (public.can_read_hotel_stay(id));
DROP POLICY IF EXISTS hotel_stay_events_select ON public.hotel_stay_events;
CREATE POLICY hotel_stay_events_select ON public.hotel_stay_events FOR SELECT TO authenticated
  USING (public.can_read_hotel_stay(stay_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.restaurant_settings, public.restaurant_tables, public.restaurant_table_groups,
  public.restaurant_table_group_members, public.restaurant_service_periods, public.restaurant_turn_times,
  public.restaurant_closed_dates, public.restaurant_reservations, public.restaurant_reservation_tables,
  public.restaurant_reservation_events, public.hotel_settings, public.hotel_room_types, public.hotel_rooms,
  public.hotel_closures, public.hotel_stays, public.hotel_stay_events FROM anon, authenticated;
REVOKE ALL ON public.restaurant_tables, public.restaurant_table_groups, public.restaurant_table_group_members,
  public.restaurant_turn_times, public.restaurant_closed_dates, public.restaurant_reservations,
  public.restaurant_reservation_tables, public.restaurant_reservation_events, public.hotel_rooms,
  public.hotel_closures, public.hotel_stays, public.hotel_stay_events FROM anon;


-- ── 5. The restaurant's set-up ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restaurant_event(p_id uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.restaurant_reservation_events (reservation_id, actor_id, action, details)
  VALUES (p_id, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

-- Rules, and the turn times by party size [{up_to_party, minutes}].
CREATE OR REPLACE FUNCTION public.save_restaurant_settings(p_org uuid, p jsonb)
RETURNS public.restaurant_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.restaurant_settings%ROWTYPE; t jsonb;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  INSERT INTO public.restaurant_settings AS x (organization_id, slot_step_minutes, booking_window_days, lead_time_minutes,
                                               max_party_online, default_turn_minutes, cancel_hours, no_show_fee,
                                               no_show_fee_per, no_show_vat_rate)
  VALUES (p_org, coalesce((p ->> 'slot_step_minutes')::int, 15), coalesce((p ->> 'booking_window_days')::int, 60),
          coalesce((p ->> 'lead_time_minutes')::int, 60), coalesce((p ->> 'max_party_online')::int, 8),
          coalesce((p ->> 'default_turn_minutes')::int, 120), coalesce((p ->> 'cancel_hours')::int, 2),
          nullif(p ->> 'no_show_fee', '')::numeric, coalesce(nullif(p ->> 'no_show_fee_per', ''), 'guest'),
          nullif(p ->> 'no_show_vat_rate', '')::numeric)
  ON CONFLICT (organization_id) DO UPDATE SET slot_step_minutes = EXCLUDED.slot_step_minutes,
    booking_window_days = EXCLUDED.booking_window_days, lead_time_minutes = EXCLUDED.lead_time_minutes,
    max_party_online = EXCLUDED.max_party_online, default_turn_minutes = EXCLUDED.default_turn_minutes,
    cancel_hours = EXCLUDED.cancel_hours, no_show_fee = EXCLUDED.no_show_fee, no_show_fee_per = EXCLUDED.no_show_fee_per,
    no_show_vat_rate = EXCLUDED.no_show_vat_rate, updated_at = now()
  RETURNING * INTO s;
  IF p ? 'turn_times' THEN
    DELETE FROM public.restaurant_turn_times WHERE organization_id = p_org;
    FOR t IN SELECT * FROM jsonb_array_elements(p -> 'turn_times') LOOP
      INSERT INTO public.restaurant_turn_times (organization_id, up_to_party, minutes)
      VALUES (p_org, (t ->> 'up_to_party')::int, (t ->> 'minutes')::int);
    END LOOP;
  END IF;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.save_restaurant_table(p_org uuid, p_id uuid, p jsonb)
RETURNS public.restaurant_tables
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE t public.restaurant_tables%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  IF p_id IS NULL THEN
    INSERT INTO public.restaurant_tables (organization_id, name, area, seats, min_seats, combinable, active, sort)
    VALUES (p_org, btrim(p ->> 'name'), nullif(btrim(coalesce(p ->> 'area', '')), ''), (p ->> 'seats')::int,
            coalesce((p ->> 'min_seats')::int, 1), coalesce((p ->> 'combinable')::boolean, false),
            coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort')::int, 0))
    RETURNING * INTO t;
  ELSE
    UPDATE public.restaurant_tables SET name = btrim(p ->> 'name'), area = nullif(btrim(coalesce(p ->> 'area', '')), ''),
           seats = (p ->> 'seats')::int, min_seats = coalesce((p ->> 'min_seats')::int, 1),
           combinable = coalesce((p ->> 'combinable')::boolean, false), active = coalesce((p ->> 'active')::boolean, true),
           sort = coalesce((p ->> 'sort')::int, 0)
     WHERE id = p_id AND organization_id = p_org RETURNING * INTO t;
    IF NOT FOUND THEN RAISE EXCEPTION 'restaurant: no such table' USING ERRCODE = 'P0002'; END IF;
    IF NOT t.combinable AND EXISTS (SELECT 1 FROM public.restaurant_table_group_members WHERE table_id = t.id) THEN
      RAISE EXCEPTION 'restaurant: the table is in a combination; remove it there first' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN t;
END $$;

-- A combination of two or more combinable tables {name, min_seats, table_ids, active}.
CREATE OR REPLACE FUNCTION public.save_restaurant_table_group(p_org uuid, p_id uuid, p jsonb)
RETURNS public.restaurant_table_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE g public.restaurant_table_groups%ROWTYPE; v_ids uuid[];
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  SELECT array_agg(DISTINCT x::uuid) INTO v_ids FROM jsonb_array_elements_text(coalesce(p -> 'table_ids', '[]'::jsonb)) x;
  IF coalesce(cardinality(v_ids), 0) < 2 THEN
    RAISE EXCEPTION 'restaurant: a combination has at least two tables' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.restaurant_tables WHERE id = ANY (v_ids) AND organization_id = p_org AND combinable) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'restaurant: only the company''s combinable tables can be combined' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.restaurant_table_groups (organization_id, name, min_seats, active, sort)
    VALUES (p_org, btrim(p ->> 'name'), coalesce((p ->> 'min_seats')::int, 1), coalesce((p ->> 'active')::boolean, true),
            coalesce((p ->> 'sort')::int, 0))
    RETURNING * INTO g;
  ELSE
    UPDATE public.restaurant_table_groups SET name = btrim(p ->> 'name'), min_seats = coalesce((p ->> 'min_seats')::int, 1),
           active = coalesce((p ->> 'active')::boolean, true), sort = coalesce((p ->> 'sort')::int, 0)
     WHERE id = p_id AND organization_id = p_org RETURNING * INTO g;
    IF NOT FOUND THEN RAISE EXCEPTION 'restaurant: no such combination' USING ERRCODE = 'P0002'; END IF;
    DELETE FROM public.restaurant_table_group_members WHERE group_id = g.id;
  END IF;
  INSERT INTO public.restaurant_table_group_members (group_id, table_id) SELECT g.id, unnest(v_ids);
  RETURN g;
END $$;

-- The week's service periods [{weekday, name, start, end, last_seating}],
-- replacing the earlier ones.
CREATE OR REPLACE FUNCTION public.save_restaurant_periods(p_org uuid, p_periods jsonb)
RETURNS SETOF public.restaurant_service_periods
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE h jsonb;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  DELETE FROM public.restaurant_service_periods WHERE organization_id = p_org;
  FOR h IN SELECT * FROM jsonb_array_elements(coalesce(p_periods, '[]'::jsonb)) LOOP
    INSERT INTO public.restaurant_service_periods (organization_id, weekday, name, start_time, end_time, last_seating)
    VALUES (p_org, (h ->> 'weekday')::int, btrim(coalesce(h ->> 'name', 'Open')), (h ->> 'start')::time, (h ->> 'end')::time,
            nullif(h ->> 'last_seating', '')::time);
  END LOOP;
  RETURN QUERY SELECT * FROM public.restaurant_service_periods WHERE organization_id = p_org ORDER BY weekday, start_time;
END $$;

CREATE OR REPLACE FUNCTION public.add_restaurant_closed_date(p_org uuid, p_day date, p_reason text)
RETURNS public.restaurant_closed_dates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE c public.restaurant_closed_dates%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'booker']);
  INSERT INTO public.restaurant_closed_dates (organization_id, day, reason)
  VALUES (p_org, p_day, nullif(btrim(coalesce(p_reason, '')), ''))
  ON CONFLICT (organization_id, day) DO UPDATE SET reason = EXCLUDED.reason
  RETURNING * INTO c;
  RETURN c;
END $$;

CREATE OR REPLACE FUNCTION public.remove_restaurant_closed_date(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.restaurant_closed_dates WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant: no such closed date' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.require_org_role(v_org, ARRAY['owner', 'admin', 'booker']);
  DELETE FROM public.restaurant_closed_dates WHERE id = p_id;
END $$;


-- ── 6. Free tables and times ────────────────────────────────────────────────
-- How long a party keeps its table.
CREATE OR REPLACE FUNCTION public.restaurant_turn_minutes(p_org uuid, p_party integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT minutes FROM public.restaurant_turn_times WHERE organization_id = p_org AND up_to_party >= p_party ORDER BY up_to_party LIMIT 1),
    (SELECT default_turn_minutes FROM public.restaurant_settings WHERE organization_id = p_org),
    120);
$$;

-- Whether any of the tables is held by another reservation in the time.
-- A no-show or cancelled reservation frees its tables; a completed one
-- holds them until it was completed.
CREATE OR REPLACE FUNCTION public.restaurant_tables_taken(p_tables uuid[], p_start timestamptz, p_end timestamptz, p_exclude uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_reservation_tables rt
      JOIN public.restaurant_reservations r ON r.id = rt.reservation_id
     WHERE rt.table_id = ANY (p_tables) AND r.status IN ('booked', 'seated', 'completed')
       AND r.id IS DISTINCT FROM p_exclude
       AND tstzrange(r.starts_at, r.ends_at) && tstzrange(p_start, p_end));
$$;

-- The best free fit for a party from p_start to p_end: the smallest table
-- that seats it, else the smallest allowed combination; NULL when none.
-- p_exclude: a reservation being moved (its own tables count as free).
CREATE OR REPLACE FUNCTION public.restaurant_fit(p_org uuid, p_start timestamptz, p_end timestamptz, p_party integer, p_exclude uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH cand AS (
    SELECT ARRAY[t.id] AS tables, t.seats, 0 AS kind, t.sort
      FROM public.restaurant_tables t
     WHERE t.organization_id = p_org AND t.active AND p_party BETWEEN t.min_seats AND t.seats
    UNION ALL
    SELECT array_agg(t.id ORDER BY t.id), sum(t.seats)::int, 1, g.sort
      FROM public.restaurant_table_groups g
      JOIN public.restaurant_table_group_members m ON m.group_id = g.id
      JOIN public.restaurant_tables t ON t.id = m.table_id
     WHERE g.organization_id = p_org AND g.active AND g.min_seats <= p_party
     GROUP BY g.id, g.sort
    HAVING bool_and(t.active AND t.combinable) AND sum(t.seats) >= p_party
  )
  SELECT c.tables FROM cand c
   WHERE NOT public.restaurant_tables_taken(c.tables, p_start, p_end, p_exclude)
   ORDER BY c.seats, c.kind, c.sort
   LIMIT 1;
$$;

-- Free starting times on a day (Europe/Oslo) for a party: in the day's
-- service periods (stepped in local time, so a DST day keeps its clock
-- times), not on a closed date, within the booking window and after the
-- lead time, where a fitting table is free for the whole turn. Parties
-- above the online maximum are asked to call.
CREATE OR REPLACE FUNCTION public.available_restaurant_times(p_org uuid, p_day date, p_party integer)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz, period text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  cfg     public.restaurant_settings%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Europe/Oslo')::date;
  v_turn  integer;
BEGIN
  IF NOT public.org_has_module(p_org, 'restaurant_reservations') OR p_party IS NULL OR p_party < 1 THEN RETURN; END IF;
  SELECT * INTO cfg FROM public.restaurant_settings WHERE organization_id = p_org;
  IF NOT FOUND OR p_party > cfg.max_party_online THEN RETURN; END IF;
  IF p_day < v_today OR p_day > v_today + cfg.booking_window_days THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.restaurant_closed_dates WHERE organization_id = p_org AND day = p_day) THEN RETURN; END IF;
  v_turn := public.restaurant_turn_minutes(p_org, p_party);
  RETURN QUERY
  SELECT x.s, x.s + make_interval(mins => v_turn), x.name
    FROM (SELECT (local.t AT TIME ZONE 'Europe/Oslo') AS s, p.name, p.start_time
            FROM public.restaurant_service_periods p
           CROSS JOIN LATERAL generate_series(
             p_day + p.start_time,
             CASE WHEN p.last_seating IS NOT NULL THEN p_day + p.last_seating
                  ELSE (p_day + p.end_time) - make_interval(mins => v_turn) END,
             make_interval(mins => cfg.slot_step_minutes)) AS local(t)
           WHERE p.organization_id = p_org AND p.weekday = extract(isodow FROM p_day)::int) x
   WHERE x.s >= now() + make_interval(mins => cfg.lead_time_minutes)
     AND public.restaurant_fit(p_org, x.s, x.s + make_interval(mins => v_turn), p_party, NULL) IS NOT NULL
   ORDER BY x.s;
END $$;


-- ── 7. Table reservations ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restaurant_reservation_insert(
  p_org uuid, p_start timestamptz, p_party integer, p_customer_user uuid, p_contact jsonb, p_notes text,
  p_source text, p_tables uuid[], p_check boolean)
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  cfg      public.restaurant_settings%ROWTYPE;
  r        public.restaurant_reservations%ROWTYPE;
  v_turn   integer;
  v_end    timestamptz;
  v_tables uuid[];
  v_period text;
  v_no     integer;
BEGIN
  SELECT * INTO cfg FROM public.restaurant_settings WHERE organization_id = p_org;
  IF NOT FOUND OR NOT public.org_has_module(p_org, 'restaurant_reservations') THEN
    RAISE EXCEPTION 'restaurant: this restaurant does not take reservations' USING ERRCODE = '55000';
  END IF;
  IF coalesce(btrim(p_contact ->> 'name'), '') = '' OR (p_source <> 'walk_in' AND coalesce(btrim(p_contact ->> 'phone'), '') = '') THEN
    RAISE EXCEPTION 'restaurant: a name and a phone number are required' USING ERRCODE = '22023';
  END IF;
  IF p_party IS NULL OR p_party NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'restaurant: the party is 1 to 100 guests' USING ERRCODE = '22023';
  END IF;
  v_turn := public.restaurant_turn_minutes(p_org, p_party);
  v_end := p_start + make_interval(mins => v_turn);
  IF p_check THEN
    SELECT a.period INTO v_period FROM public.available_restaurant_times(p_org, (p_start AT TIME ZONE 'Europe/Oslo')::date, p_party) a
     WHERE a.starts_at = p_start;
    IF NOT FOUND THEN RAISE EXCEPTION 'restaurant: that time is not available' USING ERRCODE = '55000'; END IF;
  END IF;
  -- One lock per restaurant: a reservation may take several tables, so the
  -- whole floor is the resource. Two people never get the same table.
  PERFORM pg_advisory_xact_lock(hashtext('restaurant:' || p_org::text));
  IF p_tables IS NOT NULL AND cardinality(p_tables) > 0 THEN
    SELECT array_agg(DISTINCT t ORDER BY t) INTO v_tables FROM unnest(p_tables) t;
    IF (SELECT count(*) FROM public.restaurant_tables WHERE id = ANY (v_tables) AND organization_id = p_org AND active) <> cardinality(v_tables) THEN
      RAISE EXCEPTION 'restaurant: no such table' USING ERRCODE = '22023';
    END IF;
    IF public.restaurant_tables_taken(v_tables, p_start, v_end, NULL) THEN
      RAISE EXCEPTION 'restaurant: that table is taken at that time' USING ERRCODE = '55000';
    END IF;
  ELSE
    v_tables := public.restaurant_fit(p_org, p_start, v_end, p_party, NULL);
    IF v_tables IS NULL THEN RAISE EXCEPTION 'restaurant: no table for % is free at that time', p_party USING ERRCODE = '55000'; END IF;
  END IF;
  SELECT coalesce(max(number), 0) + 1 INTO v_no FROM public.restaurant_reservations WHERE organization_id = p_org;
  INSERT INTO public.restaurant_reservations (organization_id, number, customer_user_id, customer, party_size, starts_at, ends_at,
                                              period, notes, source, status, seated_at, no_show_fee, no_show_vat_rate, created_by)
  VALUES (p_org, v_no, p_customer_user,
          jsonb_build_object('name', btrim(p_contact ->> 'name'), 'phone', nullif(btrim(coalesce(p_contact ->> 'phone', '')), ''),
                             'email', lower(nullif(btrim(coalesce(p_contact ->> 'email', '')), ''))),
          p_party, p_start, v_end, v_period, nullif(btrim(coalesce(p_notes, '')), ''), p_source,
          CASE WHEN p_source = 'walk_in' THEN 'seated' ELSE 'booked' END,
          CASE WHEN p_source = 'walk_in' THEN now() END,
          -- The fee the company stated before this booking, if any.
          CASE WHEN p_source <> 'walk_in' AND cfg.no_show_fee IS NOT NULL
               THEN cfg.no_show_fee * CASE WHEN cfg.no_show_fee_per = 'guest' THEN p_party ELSE 1 END END,
          CASE WHEN p_source <> 'walk_in' AND cfg.no_show_fee IS NOT NULL THEN cfg.no_show_vat_rate END,
          auth.uid())
  RETURNING * INTO r;
  INSERT INTO public.restaurant_reservation_tables (reservation_id, table_id) SELECT r.id, unnest(v_tables);
  PERFORM public.restaurant_event(r.id, 'reservation.booked',
    jsonb_build_object('source', p_source, 'party', p_party, 'start', p_start, 'tables', to_jsonb(v_tables)));
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.restaurant_reservation_insert(uuid, timestamptz, integer, uuid, jsonb, text, text, uuid[], boolean)
  FROM PUBLIC, anon, authenticated;

-- A signed-in guest books an offered time.
CREATE OR REPLACE FUNCTION public.book_restaurant_table(p_org uuid, p_start timestamptz, p_party integer, p_contact jsonb, p_notes text)
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'restaurant: sign in to book' USING ERRCODE = '42501'; END IF;
  RETURN public.restaurant_reservation_insert(p_org, p_start, p_party, auth.uid(), p_contact, p_notes, 'online', NULL, true);
END $$;

-- The company books a phone guest or seats a walk-in (p_start NULL: now).
-- It may book outside the periods, larger parties and named tables, never
-- over another reservation.
CREATE OR REPLACE FUNCTION public.create_restaurant_reservation(p_org uuid, p_start timestamptz, p_party integer, p_contact jsonb,
                                                                p_notes text, p_source text, p_tables uuid[])
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'booker', 'staff']);
  IF coalesce(p_source, '') NOT IN ('phone', 'walk_in') THEN
    RAISE EXCEPTION 'restaurant: phone or walk_in' USING ERRCODE = '22023';
  END IF;
  RETURN public.restaurant_reservation_insert(p_org, coalesce(p_start, date_trunc('minute', now())), p_party, NULL, p_contact,
                                              p_notes, p_source, p_tables, false);
END $$;

-- The reservation, locked, for the company's members with the roles.
CREATE OR REPLACE FUNCTION public.restaurant_reservation_for(p_id uuid, p_roles text[])
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.restaurant_reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.restaurant_reservations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant: no such reservation' USING ERRCODE = 'P0002'; END IF;
  IF public.is_server() OR public.is_org_member(r.organization_id, p_roles || ARRAY['owner', 'admin']) THEN RETURN r; END IF;
  RAISE EXCEPTION 'restaurant: requires role %', array_to_string(p_roles || ARRAY['owner', 'admin'], ' or ') USING ERRCODE = '42501';
END $$;

-- The guests arrive: seated, at the booked tables or others the company
-- chooses. The table is held from now if they come early (at most one turn
-- before the booked time), and for a whole turn from now if they come after
-- their turn has ended; the tables must be free for that time.
CREATE OR REPLACE FUNCTION public.seat_restaurant_reservation(p_id uuid, p_tables uuid[])
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.restaurant_reservations%ROWTYPE; v_tables uuid[]; v_start timestamptz; v_end timestamptz;
BEGIN
  r := public.restaurant_reservation_for(p_id, ARRAY['booker', 'staff']);
  IF r.status <> 'booked' THEN RAISE EXCEPTION 'restaurant: the reservation is %', r.status USING ERRCODE = '55000'; END IF;
  IF now() < r.starts_at - (r.ends_at - r.starts_at) THEN
    RAISE EXCEPTION 'restaurant: the reservation is not until %; seat the guests as a walk-in',
      to_char(r.starts_at AT TIME ZONE 'Europe/Oslo', 'DD.MM.YYYY HH24:MI') USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('restaurant:' || r.organization_id::text));
  v_start := least(r.starts_at, now());
  v_end := CASE WHEN now() >= r.ends_at THEN now() + (r.ends_at - r.starts_at) ELSE r.ends_at END;
  IF p_tables IS NOT NULL AND cardinality(p_tables) > 0 THEN
    SELECT array_agg(DISTINCT t ORDER BY t) INTO v_tables FROM unnest(p_tables) t;
    IF (SELECT count(*) FROM public.restaurant_tables WHERE id = ANY (v_tables) AND organization_id = r.organization_id AND active)
       <> cardinality(v_tables) THEN
      RAISE EXCEPTION 'restaurant: no such table' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT array_agg(table_id ORDER BY table_id) INTO v_tables FROM public.restaurant_reservation_tables WHERE reservation_id = r.id;
  END IF;
  IF public.restaurant_tables_taken(v_tables, greatest(v_start, now()), v_end, r.id) THEN
    RAISE EXCEPTION 'restaurant: that table is taken; choose another' USING ERRCODE = '55000';
  END IF;
  IF p_tables IS NOT NULL AND cardinality(p_tables) > 0 THEN
    DELETE FROM public.restaurant_reservation_tables WHERE reservation_id = r.id;
    INSERT INTO public.restaurant_reservation_tables (reservation_id, table_id) SELECT r.id, unnest(v_tables);
  END IF;
  UPDATE public.restaurant_reservations SET status = 'seated', seated_at = now(), starts_at = v_start, ends_at = v_end, updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.restaurant_event(p_id, 'reservation.seated', jsonb_build_object('tables', to_jsonb(v_tables)));
  RETURN r;
END $$;

-- Completed (the table is free from now), or the guests did not come
-- (after the booked time; the tables are freed).
CREATE OR REPLACE FUNCTION public.close_restaurant_reservation(p_id uuid, p_outcome text)
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.restaurant_reservations%ROWTYPE;
BEGIN
  r := public.restaurant_reservation_for(p_id, ARRAY['booker', 'staff']);
  IF p_outcome = 'completed' THEN
    IF r.status <> 'seated' THEN RAISE EXCEPTION 'restaurant: only seated guests are completed' USING ERRCODE = '55000'; END IF;
    UPDATE public.restaurant_reservations SET status = 'completed', completed_at = now(), updated_at = now(),
           ends_at = CASE WHEN now() > starts_at AND now() < ends_at THEN now() ELSE ends_at END
     WHERE id = p_id RETURNING * INTO r;
  ELSIF p_outcome = 'no_show' THEN
    IF r.status <> 'booked' THEN RAISE EXCEPTION 'restaurant: the reservation is %', r.status USING ERRCODE = '55000'; END IF;
    IF r.starts_at > now() THEN RAISE EXCEPTION 'restaurant: the reservation has not started yet' USING ERRCODE = '55000'; END IF;
    UPDATE public.restaurant_reservations SET status = 'no_show', updated_at = now() WHERE id = p_id RETURNING * INTO r;
  ELSE
    RAISE EXCEPTION 'restaurant: completed or no_show' USING ERRCODE = '22023';
  END IF;
  PERFORM public.restaurant_event(p_id, 'reservation.' || p_outcome, '{}'::jsonb);
  RETURN r;
END $$;

-- The guest cancels online up to the restaurant's notice; the company
-- while the reservation is booked.
CREATE OR REPLACE FUNCTION public.cancel_restaurant_reservation(p_id uuid, p_reason text)
RETURNS public.restaurant_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.restaurant_reservations%ROWTYPE; v_hours integer; v_by text;
BEGIN
  SELECT * INTO r FROM public.restaurant_reservations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant: no such reservation' USING ERRCODE = 'P0002'; END IF;
  IF r.customer_user_id = auth.uid() AND NOT public.is_org_member(r.organization_id, ARRAY['owner', 'admin', 'booker']) THEN
    v_by := 'customer';
    SELECT cancel_hours INTO v_hours FROM public.restaurant_settings WHERE organization_id = r.organization_id;
    v_hours := coalesce(v_hours, 2);
    IF r.status <> 'booked' OR r.starts_at < now() + make_interval(hours => v_hours) THEN
      RAISE EXCEPTION 'restaurant: it can be cancelled online up to % hours before; contact the restaurant', v_hours USING ERRCODE = '55000';
    END IF;
  ELSE
    r := public.restaurant_reservation_for(p_id, ARRAY['booker']);
    v_by := 'company';
    IF r.status <> 'booked' THEN RAISE EXCEPTION 'restaurant: the reservation is %', r.status USING ERRCODE = '55000'; END IF;
  END IF;
  UPDATE public.restaurant_reservations SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_by,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.restaurant_event(p_id, 'reservation.cancelled', jsonb_build_object('by', v_by, 'reason', p_reason));
  RETURN r;
END $$;

-- The no-show fee, in the company's name: only the fee stated before the
-- booking (copied onto it), once.
CREATE OR REPLACE FUNCTION public.invoice_restaurant_no_show(p_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.restaurant_reservations%ROWTYPE; v_inv public.invoices%ROWTYPE;
BEGIN
  r := public.restaurant_reservation_for(p_id, ARRAY['finance']);
  IF r.invoice_id IS NOT NULL THEN RAISE EXCEPTION 'restaurant: already invoiced' USING ERRCODE = '55000'; END IF;
  IF r.status <> 'no_show' THEN RAISE EXCEPTION 'restaurant: only a no-show is invoiced here' USING ERRCODE = '55000'; END IF;
  IF coalesce(r.no_show_fee, 0) <= 0 THEN
    RAISE EXCEPTION 'restaurant: no no-show fee was stated before this booking' USING ERRCODE = '55000';
  END IF;
  v_inv := public.sales_invoice_draft(r.organization_id, r.customer, r.customer_user_id,
             jsonb_build_array(jsonb_build_object(
               'description', 'Table reservation not kept (no-show), ' || r.party_size || ' guests, '
                              || to_char(r.starts_at AT TIME ZONE 'Europe/Oslo', 'DD.MM.YYYY HH24:MI'),
               'quantity', 1, 'unit_price', round(r.no_show_fee / (1 + r.no_show_vat_rate / 100), 2), 'vat_rate', r.no_show_vat_rate)),
             'Reservation ' || r.number, NULL, 'restaurant_reservation', r.id);
  v_inv := public.issue_invoice(v_inv.id);
  UPDATE public.restaurant_reservations SET invoice_id = v_inv.id, updated_at = now() WHERE id = p_id;
  PERFORM public.restaurant_event(p_id, 'reservation.invoiced', jsonb_build_object('invoice', v_inv.number, 'total', v_inv.total));
  RETURN v_inv;
END $$;

-- Reminders: tables in the next 20–28 hours not yet reminded (the server
-- sends them and marks each, once).
CREATE OR REPLACE FUNCTION public.restaurant_reservations_to_remind()
RETURNS SETOF public.restaurant_reservations
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'restaurant: the server only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT * FROM public.restaurant_reservations
   WHERE status = 'booked' AND reminded_at IS NULL AND customer ->> 'email' IS NOT NULL
     AND starts_at BETWEEN now() + interval '20 hours' AND now() + interval '28 hours';
END $$;

CREATE OR REPLACE FUNCTION public.mark_restaurant_reservation_reminded(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'restaurant: the server only' USING ERRCODE = '42501'; END IF;
  UPDATE public.restaurant_reservations SET reminded_at = now() WHERE id = p_id AND reminded_at IS NULL;
END $$;


-- ── 8. The hotel's set-up ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hotel_event(p_id uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.hotel_stay_events (stay_id, actor_id, action, details)
  VALUES (p_id, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.save_hotel_settings(p_org uuid, p jsonb)
RETURNS public.hotel_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_settings%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  INSERT INTO public.hotel_settings AS x (organization_id, vat_rate, check_in_from, check_out_by, booking_window_days, lead_days,
                                          min_nights, max_nights, free_cancel_days, late_cancel_fee_pct)
  VALUES (p_org, nullif(p ->> 'vat_rate', '')::numeric, coalesce(nullif(p ->> 'check_in_from', '')::time, '15:00'),
          coalesce(nullif(p ->> 'check_out_by', '')::time, '11:00'), coalesce((p ->> 'booking_window_days')::int, 365),
          coalesce((p ->> 'lead_days')::int, 0), coalesce((p ->> 'min_nights')::int, 1), coalesce((p ->> 'max_nights')::int, 30),
          coalesce((p ->> 'free_cancel_days')::int, 1), nullif(p ->> 'late_cancel_fee_pct', '')::numeric)
  ON CONFLICT (organization_id) DO UPDATE SET vat_rate = EXCLUDED.vat_rate, check_in_from = EXCLUDED.check_in_from,
    check_out_by = EXCLUDED.check_out_by, booking_window_days = EXCLUDED.booking_window_days, lead_days = EXCLUDED.lead_days,
    min_nights = EXCLUDED.min_nights, max_nights = EXCLUDED.max_nights, free_cancel_days = EXCLUDED.free_cancel_days,
    late_cancel_fee_pct = EXCLUDED.late_cancel_fee_pct, updated_at = now()
  RETURNING * INTO s;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.save_hotel_room_type(p_org uuid, p_id uuid, p jsonb)
RETURNS public.hotel_room_types
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE t public.hotel_room_types%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  IF p_id IS NULL THEN
    INSERT INTO public.hotel_room_types (organization_id, name, description, capacity, nightly_price, active, sort)
    VALUES (p_org, btrim(p ->> 'name'), p ->> 'description', (p ->> 'capacity')::int, (p ->> 'nightly_price')::numeric,
            coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort')::int, 0))
    RETURNING * INTO t;
  ELSE
    UPDATE public.hotel_room_types SET name = btrim(p ->> 'name'), description = p ->> 'description',
           capacity = (p ->> 'capacity')::int, nightly_price = (p ->> 'nightly_price')::numeric,
           active = coalesce((p ->> 'active')::boolean, true), sort = coalesce((p ->> 'sort')::int, 0)
     WHERE id = p_id AND organization_id = p_org RETURNING * INTO t;
    IF NOT FOUND THEN RAISE EXCEPTION 'hotel: no such room type' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN t;
END $$;

-- A room {name, room_type_id, active, sort}. A room moves to another type
-- only while it has no stays to come.
CREATE OR REPLACE FUNCTION public.save_hotel_room(p_org uuid, p_id uuid, p jsonb)
RETURNS public.hotel_rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.hotel_rooms%ROWTYPE; v_type uuid := (p ->> 'room_type_id')::uuid;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  IF NOT EXISTS (SELECT 1 FROM public.hotel_room_types WHERE id = v_type AND organization_id = p_org) THEN
    RAISE EXCEPTION 'hotel: no such room type' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.hotel_rooms (organization_id, room_type_id, name, active, sort)
    VALUES (p_org, v_type, btrim(p ->> 'name'), coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort')::int, 0))
    RETURNING * INTO r;
  ELSE
    SELECT * INTO r FROM public.hotel_rooms WHERE id = p_id AND organization_id = p_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'hotel: no such room' USING ERRCODE = 'P0002'; END IF;
    IF r.room_type_id <> v_type AND EXISTS (SELECT 1 FROM public.hotel_stays WHERE room_id = p_id AND status IN ('booked', 'checked_in')) THEN
      RAISE EXCEPTION 'hotel: the room has stays to come; move them first' USING ERRCODE = '55000';
    END IF;
    UPDATE public.hotel_rooms SET room_type_id = v_type, name = btrim(p ->> 'name'), active = coalesce((p ->> 'active')::boolean, true),
           sort = coalesce((p ->> 'sort')::int, 0)
     WHERE id = p_id RETURNING * INTO r;
  END IF;
  RETURN r;
END $$;

-- Close a room (or, without one, the hotel) for nights from p_from up to,
-- not including, p_to. Stays already booked stay; the company moves them.
CREATE OR REPLACE FUNCTION public.add_hotel_closure(p_org uuid, p_room uuid, p_from date, p_to date, p_reason text)
RETURNS public.hotel_closures
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE c public.hotel_closures%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'booker']);
  IF p_room IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.hotel_rooms WHERE id = p_room AND organization_id = p_org) THEN
    RAISE EXCEPTION 'hotel: no such room' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.hotel_closures (organization_id, room_id, from_date, to_date, reason)
  VALUES (p_org, p_room, p_from, p_to, nullif(btrim(coalesce(p_reason, '')), ''))
  RETURNING * INTO c;
  RETURN c;
END $$;

CREATE OR REPLACE FUNCTION public.remove_hotel_closure(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.hotel_closures WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'hotel: no such closure' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.require_org_role(v_org, ARRAY['owner', 'admin', 'booker']);
  DELETE FROM public.hotel_closures WHERE id = p_id;
END $$;


-- ── 9. Free rooms ───────────────────────────────────────────────────────────
-- Whether a room is free every night from p_in up to p_out: active, not
-- closed (itself or the hotel), no other stay booked or in the house.
CREATE OR REPLACE FUNCTION public.hotel_room_free(p_room uuid, p_in date, p_out date, p_exclude uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.hotel_rooms r WHERE r.id = p_room AND r.active)
     AND NOT EXISTS (SELECT 1 FROM public.hotel_rooms r JOIN public.hotel_closures c ON c.organization_id = r.organization_id
                      WHERE r.id = p_room AND (c.room_id IS NULL OR c.room_id = r.id)
                        AND daterange(c.from_date, c.to_date) && daterange(p_in, p_out))
     AND NOT EXISTS (SELECT 1 FROM public.hotel_stays s
                      WHERE s.room_id = p_room AND s.status IN ('booked', 'checked_in') AND s.id IS DISTINCT FROM p_exclude
                        AND daterange(s.check_in, s.check_out) && daterange(p_in, p_out));
$$;

-- The room types free for the dates and number of guests, with the price
-- and how many rooms are left. Respects the window, lead time and nights.
CREATE OR REPLACE FUNCTION public.available_hotel_rooms(p_org uuid, p_check_in date, p_check_out date, p_guests integer)
RETURNS TABLE (room_type_id uuid, name text, description text, capacity integer, nightly_price numeric, nights integer,
               total numeric, rooms_free integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE cfg public.hotel_settings%ROWTYPE; v_today date := (now() AT TIME ZONE 'Europe/Oslo')::date; v_nights integer;
BEGIN
  IF NOT public.org_has_module(p_org, 'hotel_reservations') OR p_check_in IS NULL OR p_check_out IS NULL THEN RETURN; END IF;
  SELECT * INTO cfg FROM public.hotel_settings WHERE organization_id = p_org;
  IF NOT FOUND OR cfg.vat_rate IS NULL THEN RETURN; END IF;
  v_nights := p_check_out - p_check_in;
  IF v_nights < cfg.min_nights OR v_nights > cfg.max_nights THEN RETURN; END IF;
  IF p_check_in < v_today + cfg.lead_days OR p_check_in > v_today + cfg.booking_window_days THEN RETURN; END IF;
  RETURN QUERY
  SELECT t.id, t.name, t.description, t.capacity, t.nightly_price, v_nights, t.nightly_price * v_nights,
         (SELECT count(*)::int FROM public.hotel_rooms r WHERE r.room_type_id = t.id AND public.hotel_room_free(r.id, p_check_in, p_check_out, NULL))
    FROM public.hotel_room_types t
   WHERE t.organization_id = p_org AND t.active AND t.capacity >= coalesce(p_guests, 1)
     AND EXISTS (SELECT 1 FROM public.hotel_rooms r WHERE r.room_type_id = t.id AND public.hotel_room_free(r.id, p_check_in, p_check_out, NULL))
   ORDER BY t.sort, t.nightly_price;
END $$;


-- ── 10. Stays ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hotel_stay_insert(
  p_org uuid, p_type uuid, p_room uuid, p_in date, p_out date, p_guests integer, p_customer_user uuid,
  p_contact jsonb, p_notes text, p_check boolean)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  cfg    public.hotel_settings%ROWTYPE;
  t      public.hotel_room_types%ROWTYPE;
  s      public.hotel_stays%ROWTYPE;
  v_room uuid;
  v_no   integer;
  v_total numeric;
BEGIN
  SELECT * INTO cfg FROM public.hotel_settings WHERE organization_id = p_org;
  IF NOT FOUND OR NOT public.org_has_module(p_org, 'hotel_reservations') THEN
    RAISE EXCEPTION 'hotel: this hotel does not take bookings' USING ERRCODE = '55000';
  END IF;
  IF cfg.vat_rate IS NULL THEN
    RAISE EXCEPTION 'hotel: the hotel''s MVA rate for accommodation is not set' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO t FROM public.hotel_room_types WHERE id = p_type AND organization_id = p_org;
  IF NOT FOUND OR (p_check AND NOT t.active) THEN RAISE EXCEPTION 'hotel: this room type cannot be booked' USING ERRCODE = '55000'; END IF;
  IF coalesce(btrim(p_contact ->> 'name'), '') = '' OR coalesce(btrim(p_contact ->> 'phone'), '') = '' THEN
    RAISE EXCEPTION 'hotel: a name and a phone number are required' USING ERRCODE = '22023';
  END IF;
  IF p_in IS NULL OR p_out IS NULL OR p_out <= p_in THEN
    RAISE EXCEPTION 'hotel: check-out is after check-in' USING ERRCODE = '22023';
  END IF;
  IF p_guests IS NULL OR p_guests < 1 OR p_guests > t.capacity THEN
    RAISE EXCEPTION 'hotel: % takes up to % guests', t.name, t.capacity USING ERRCODE = '22023';
  END IF;
  IF p_check AND NOT EXISTS (SELECT 1 FROM public.available_hotel_rooms(p_org, p_in, p_out, p_guests) a WHERE a.room_type_id = p_type) THEN
    RAISE EXCEPTION 'hotel: no room of that type is free for those dates' USING ERRCODE = '55000';
  END IF;
  IF NOT p_check AND p_out < (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'hotel: the stay is in the past' USING ERRCODE = '22023';
  END IF;
  -- A lock per room type: a night is never sold twice.
  PERFORM pg_advisory_xact_lock(hashtext('hotel-type:' || p_type::text));
  IF p_room IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.hotel_rooms WHERE id = p_room AND room_type_id = p_type AND organization_id = p_org) THEN
      RAISE EXCEPTION 'hotel: the room is not of that type' USING ERRCODE = '22023';
    END IF;
    IF NOT public.hotel_room_free(p_room, p_in, p_out, NULL) THEN
      RAISE EXCEPTION 'hotel: that room is not free for those dates' USING ERRCODE = '55000';
    END IF;
    v_room := p_room;
  ELSE
    SELECT r.id INTO v_room FROM public.hotel_rooms r
     WHERE r.room_type_id = p_type AND public.hotel_room_free(r.id, p_in, p_out, NULL)
     ORDER BY r.sort, r.name LIMIT 1;
    IF v_room IS NULL THEN RAISE EXCEPTION 'hotel: no room of that type is free for those dates' USING ERRCODE = '55000'; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('hotel-no:' || p_org::text));
  SELECT coalesce(max(number), 0) + 1 INTO v_no FROM public.hotel_stays WHERE organization_id = p_org;
  v_total := t.nightly_price * (p_out - p_in);
  INSERT INTO public.hotel_stays (organization_id, number, room_type_id, room_id, customer_user_id, customer, guests, check_in, check_out,
                                  nightly_price, total, vat_rate, free_cancel_until, late_cancel_fee, notes, created_by)
  VALUES (p_org, v_no, p_type, v_room, p_customer_user,
          jsonb_build_object('name', btrim(p_contact ->> 'name'), 'phone', btrim(p_contact ->> 'phone'),
                             'email', lower(nullif(btrim(coalesce(p_contact ->> 'email', '')), ''))),
          p_guests, p_in, p_out, t.nightly_price, v_total, cfg.vat_rate,
          -- The cancellation rule the hotel stated before this booking.
          CASE WHEN cfg.late_cancel_fee_pct IS NOT NULL THEN p_in - cfg.free_cancel_days END,
          CASE WHEN cfg.late_cancel_fee_pct IS NOT NULL THEN round(v_total * cfg.late_cancel_fee_pct / 100, 2) END,
          nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  RETURNING * INTO s;
  PERFORM public.hotel_event(s.id, 'stay.booked', jsonb_build_object('room_type', t.name, 'check_in', p_in, 'check_out', p_out,
                                                                    'guests', p_guests, 'total', v_total));
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public.hotel_stay_insert(uuid, uuid, uuid, date, date, integer, uuid, jsonb, text, boolean)
  FROM PUBLIC, anon, authenticated;

-- A signed-in guest books a free room type for the dates.
CREATE OR REPLACE FUNCTION public.book_hotel_stay(p_org uuid, p_room_type uuid, p_check_in date, p_check_out date, p_guests integer,
                                                  p_contact jsonb, p_notes text)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'hotel: sign in to book' USING ERRCODE = '42501'; END IF;
  RETURN public.hotel_stay_insert(p_org, p_room_type, NULL, p_check_in, p_check_out, p_guests, auth.uid(), p_contact, p_notes, true);
END $$;

-- The company books a guest (phone, email, at the desk), optionally in a
-- named room; outside the window and lead time, never over another stay or
-- a closure.
CREATE OR REPLACE FUNCTION public.create_hotel_stay(p_org uuid, p_room_type uuid, p_room uuid, p_check_in date, p_check_out date,
                                                    p_guests integer, p_contact jsonb, p_notes text)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin', 'booker', 'staff']);
  RETURN public.hotel_stay_insert(p_org, p_room_type, p_room, p_check_in, p_check_out, p_guests, NULL, p_contact, p_notes, false);
END $$;

CREATE OR REPLACE FUNCTION public.hotel_stay_for(p_id uuid, p_roles text[])
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_stays%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.hotel_stays WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'hotel: no such stay' USING ERRCODE = 'P0002'; END IF;
  IF public.is_server() OR public.is_org_member(s.organization_id, p_roles || ARRAY['owner', 'admin']) THEN RETURN s; END IF;
  RAISE EXCEPTION 'hotel: requires role %', array_to_string(p_roles || ARRAY['owner', 'admin'], ' or ') USING ERRCODE = '42501';
END $$;

-- The guest arrives (on or after the check-in date): checked in, in the
-- booked room or another free one (an upgrade keeps the booked price).
CREATE OR REPLACE FUNCTION public.check_in_hotel_stay(p_id uuid, p_room uuid)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_stays%ROWTYPE; r public.hotel_rooms%ROWTYPE; v_cap integer; v_today date := (now() AT TIME ZONE 'Europe/Oslo')::date;
BEGIN
  s := public.hotel_stay_for(p_id, ARRAY['booker', 'staff']);
  IF s.status <> 'booked' THEN RAISE EXCEPTION 'hotel: the stay is %', s.status USING ERRCODE = '55000'; END IF;
  IF v_today < s.check_in OR v_today >= s.check_out THEN
    RAISE EXCEPTION 'hotel: check-in is from % until the day before check-out', s.check_in USING ERRCODE = '55000';
  END IF;
  IF p_room IS NOT NULL AND p_room <> s.room_id THEN
    SELECT * INTO r FROM public.hotel_rooms WHERE id = p_room AND organization_id = s.organization_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'hotel: no such room' USING ERRCODE = '22023'; END IF;
    -- Both room types, in a fixed order.
    PERFORM pg_advisory_xact_lock(hashtext('hotel-type:' || x)) FROM unnest(ARRAY[s.room_type_id::text, r.room_type_id::text]) x
      GROUP BY x ORDER BY x;
    SELECT capacity INTO v_cap FROM public.hotel_room_types WHERE id = r.room_type_id;
    IF v_cap < s.guests THEN RAISE EXCEPTION 'hotel: that room takes up to % guests', v_cap USING ERRCODE = '22023'; END IF;
    IF NOT public.hotel_room_free(p_room, v_today, s.check_out, s.id) THEN
      RAISE EXCEPTION 'hotel: that room is not free for the stay' USING ERRCODE = '55000';
    END IF;
    UPDATE public.hotel_stays SET room_id = p_room, room_type_id = r.room_type_id WHERE id = p_id;
  END IF;
  UPDATE public.hotel_stays SET status = 'checked_in', checked_in_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO s;
  PERFORM public.hotel_event(p_id, 'stay.checked_in', jsonb_build_object('room', s.room_id));
  RETURN s;
END $$;

-- The guest leaves: the room is free from now.
CREATE OR REPLACE FUNCTION public.check_out_hotel_stay(p_id uuid)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_stays%ROWTYPE;
BEGIN
  s := public.hotel_stay_for(p_id, ARRAY['booker', 'staff']);
  IF s.status <> 'checked_in' THEN RAISE EXCEPTION 'hotel: the stay is %', s.status USING ERRCODE = '55000'; END IF;
  UPDATE public.hotel_stays SET status = 'checked_out', checked_out_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO s;
  PERFORM public.hotel_event(p_id, 'stay.checked_out', '{}'::jsonb);
  RETURN s;
END $$;

-- The guest did not arrive (from the check-in date): the late fee the hotel
-- stated before the booking applies, if any.
CREATE OR REPLACE FUNCTION public.mark_hotel_no_show(p_id uuid)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_stays%ROWTYPE;
BEGIN
  s := public.hotel_stay_for(p_id, ARRAY['booker']);
  IF s.status <> 'booked' THEN RAISE EXCEPTION 'hotel: the stay is %', s.status USING ERRCODE = '55000'; END IF;
  IF (now() AT TIME ZONE 'Europe/Oslo')::date < s.check_in THEN
    RAISE EXCEPTION 'hotel: the guest is not due yet' USING ERRCODE = '55000';
  END IF;
  UPDATE public.hotel_stays SET status = 'no_show', cancel_fee = late_cancel_fee, updated_at = now() WHERE id = p_id RETURNING * INTO s;
  PERFORM public.hotel_event(p_id, 'stay.no_show', jsonb_build_object('fee', s.cancel_fee));
  RETURN s;
END $$;

-- The guest cancels online until the check-in date: free until the last
-- free day, then the fee stated before the booking. The company cancels
-- while the stay is booked and charges that fee only when it chooses to
-- (p_charge_fee) and the cancellation is late.
CREATE OR REPLACE FUNCTION public.cancel_hotel_stay(p_id uuid, p_reason text, p_charge_fee boolean DEFAULT false)
RETURNS public.hotel_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_stays%ROWTYPE; v_by text; v_today date := (now() AT TIME ZONE 'Europe/Oslo')::date; v_late boolean; v_fee numeric;
BEGIN
  SELECT * INTO s FROM public.hotel_stays WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'hotel: no such stay' USING ERRCODE = 'P0002'; END IF;
  v_late := s.free_cancel_until IS NOT NULL AND v_today > s.free_cancel_until;
  IF s.customer_user_id = auth.uid() AND NOT public.is_org_member(s.organization_id, ARRAY['owner', 'admin', 'booker']) THEN
    v_by := 'customer';
    IF s.status <> 'booked' OR v_today >= s.check_in THEN
      RAISE EXCEPTION 'hotel: it can be cancelled online until the day before arrival; contact the hotel' USING ERRCODE = '55000';
    END IF;
    v_fee := CASE WHEN v_late THEN s.late_cancel_fee END;
  ELSE
    s := public.hotel_stay_for(p_id, ARRAY['booker']);
    v_by := 'company';
    IF s.status <> 'booked' THEN RAISE EXCEPTION 'hotel: the stay is %', s.status USING ERRCODE = '55000'; END IF;
    v_fee := CASE WHEN v_late AND coalesce(p_charge_fee, false) THEN s.late_cancel_fee END;
  END IF;
  UPDATE public.hotel_stays SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_by, cancel_fee = v_fee,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   WHERE id = p_id RETURNING * INTO s;
  PERFORM public.hotel_event(p_id, 'stay.cancelled', jsonb_build_object('by', v_by, 'reason', p_reason, 'fee', v_fee));
  RETURN s;
END $$;

-- The invoice in the company's name: the stay (checked in or out), or the
-- cancellation fee (late cancellation or no-show), once.
CREATE OR REPLACE FUNCTION public.invoice_hotel_stay(p_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.hotel_stays%ROWTYPE; v_type text; v_line jsonb; v_inv public.invoices%ROWTYPE; v_dates text;
BEGIN
  s := public.hotel_stay_for(p_id, ARRAY['finance']);
  IF s.invoice_id IS NOT NULL THEN RAISE EXCEPTION 'hotel: already invoiced' USING ERRCODE = '55000'; END IF;
  SELECT name INTO v_type FROM public.hotel_room_types WHERE id = s.room_type_id;
  v_dates := to_char(s.check_in, 'DD.MM.YYYY') || '–' || to_char(s.check_out, 'DD.MM.YYYY');
  IF s.status IN ('checked_in', 'checked_out') THEN
    v_line := jsonb_build_object('description', 'Accommodation, ' || v_type || ', ' || s.nights || ' night' || CASE WHEN s.nights = 1 THEN '' ELSE 's' END
                                                || ', ' || v_dates,
                                 'quantity', s.nights, 'unit_price', round(s.nightly_price / (1 + s.vat_rate / 100), 2), 'vat_rate', s.vat_rate);
  ELSIF s.status IN ('cancelled', 'no_show') AND coalesce(s.cancel_fee, 0) > 0 THEN
    v_line := jsonb_build_object('description', CASE WHEN s.status = 'no_show' THEN 'No-show' ELSE 'Late cancellation' END
                                                || ' fee, ' || v_type || ', ' || v_dates,
                                 'quantity', 1, 'unit_price', round(s.cancel_fee / (1 + s.vat_rate / 100), 2), 'vat_rate', s.vat_rate);
  ELSE
    RAISE EXCEPTION 'hotel: only a stay, or a cancellation with a fee, is invoiced' USING ERRCODE = '55000';
  END IF;
  v_inv := public.sales_invoice_draft(s.organization_id, s.customer, s.customer_user_id, jsonb_build_array(v_line),
                                      'Stay ' || s.number, NULL, 'hotel_stay', s.id);
  v_inv := public.issue_invoice(v_inv.id);
  UPDATE public.hotel_stays SET invoice_id = v_inv.id, updated_at = now() WHERE id = p_id;
  PERFORM public.hotel_event(p_id, 'stay.invoiced', jsonb_build_object('invoice', v_inv.number, 'total', v_inv.total));
  RETURN v_inv;
END $$;

-- Reminders: arrivals tomorrow (Europe/Oslo) not yet reminded.
CREATE OR REPLACE FUNCTION public.hotel_stays_to_remind()
RETURNS SETOF public.hotel_stays
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'hotel: the server only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT * FROM public.hotel_stays
   WHERE status = 'booked' AND reminded_at IS NULL AND customer ->> 'email' IS NOT NULL
     AND check_in = (now() AT TIME ZONE 'Europe/Oslo')::date + 1;
END $$;

CREATE OR REPLACE FUNCTION public.mark_hotel_stay_reminded(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'hotel: the server only' USING ERRCODE = '42501'; END IF;
  UPDATE public.hotel_stays SET reminded_at = now() WHERE id = p_id AND reminded_at IS NULL;
END $$;


-- ── 11. Who may call what ───────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.restaurant_event(uuid, text, jsonb), public.restaurant_reservation_for(uuid, text[]),
  public.restaurant_fit(uuid, timestamptz, timestamptz, integer, uuid),
  public.restaurant_tables_taken(uuid[], timestamptz, timestamptz, uuid), public.restaurant_turn_minutes(uuid, integer),
  public.hotel_event(uuid, text, jsonb), public.hotel_stay_for(uuid, text[]), public.hotel_room_free(uuid, date, date, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.can_read_restaurant_reservation(uuid), public.can_read_hotel_stay(uuid),
  public.save_restaurant_settings(uuid, jsonb), public.save_restaurant_table(uuid, uuid, jsonb),
  public.save_restaurant_table_group(uuid, uuid, jsonb), public.save_restaurant_periods(uuid, jsonb),
  public.add_restaurant_closed_date(uuid, date, text), public.remove_restaurant_closed_date(uuid),
  public.available_restaurant_times(uuid, date, integer),
  public.book_restaurant_table(uuid, timestamptz, integer, jsonb, text),
  public.create_restaurant_reservation(uuid, timestamptz, integer, jsonb, text, text, uuid[]),
  public.seat_restaurant_reservation(uuid, uuid[]), public.close_restaurant_reservation(uuid, text),
  public.cancel_restaurant_reservation(uuid, text), public.invoice_restaurant_no_show(uuid),
  public.restaurant_reservations_to_remind(), public.mark_restaurant_reservation_reminded(uuid),
  public.save_hotel_settings(uuid, jsonb), public.save_hotel_room_type(uuid, uuid, jsonb), public.save_hotel_room(uuid, uuid, jsonb),
  public.add_hotel_closure(uuid, uuid, date, date, text), public.remove_hotel_closure(uuid),
  public.available_hotel_rooms(uuid, date, date, integer),
  public.book_hotel_stay(uuid, uuid, date, date, integer, jsonb, text),
  public.create_hotel_stay(uuid, uuid, uuid, date, date, integer, jsonb, text),
  public.check_in_hotel_stay(uuid, uuid), public.check_out_hotel_stay(uuid), public.mark_hotel_no_show(uuid),
  public.cancel_hotel_stay(uuid, text, boolean), public.invoice_hotel_stay(uuid),
  public.hotel_stays_to_remind(), public.mark_hotel_stay_reminded(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.can_read_restaurant_reservation(uuid), public.can_read_hotel_stay(uuid),
  public.save_restaurant_settings(uuid, jsonb), public.save_restaurant_table(uuid, uuid, jsonb),
  public.save_restaurant_table_group(uuid, uuid, jsonb), public.save_restaurant_periods(uuid, jsonb),
  public.add_restaurant_closed_date(uuid, date, text), public.remove_restaurant_closed_date(uuid),
  public.available_restaurant_times(uuid, date, integer),
  public.book_restaurant_table(uuid, timestamptz, integer, jsonb, text),
  public.create_restaurant_reservation(uuid, timestamptz, integer, jsonb, text, text, uuid[]),
  public.seat_restaurant_reservation(uuid, uuid[]), public.close_restaurant_reservation(uuid, text),
  public.cancel_restaurant_reservation(uuid, text), public.invoice_restaurant_no_show(uuid),
  public.restaurant_reservations_to_remind(), public.mark_restaurant_reservation_reminded(uuid),
  public.save_hotel_settings(uuid, jsonb), public.save_hotel_room_type(uuid, uuid, jsonb), public.save_hotel_room(uuid, uuid, jsonb),
  public.add_hotel_closure(uuid, uuid, date, date, text), public.remove_hotel_closure(uuid),
  public.available_hotel_rooms(uuid, date, date, integer),
  public.book_hotel_stay(uuid, uuid, date, date, integer, jsonb, text),
  public.create_hotel_stay(uuid, uuid, uuid, date, date, integer, jsonb, text),
  public.check_in_hotel_stay(uuid, uuid), public.check_out_hotel_stay(uuid), public.mark_hotel_no_show(uuid),
  public.cancel_hotel_stay(uuid, text, boolean), public.invoice_hotel_stay(uuid),
  public.hotel_stays_to_remind(), public.mark_hotel_stay_reminded(uuid)
TO authenticated, service_role;
-- Visitors see free times and rooms before signing in.
GRANT EXECUTE ON FUNCTION public.available_restaurant_times(uuid, date, integer), public.available_hotel_rooms(uuid, date, date, integer) TO anon;

-- ============================================================================
-- DONE
-- ============================================================================

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261030160019', '00019_reservations')
ON CONFLICT (version) DO NOTHING;

-- ===== 00020_shop.sql =====
-- ============================================================================
-- FlyttGo — Online shops: a company sells goods from its own page
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00015 (docs/SERVICE_PLATFORM.md).
-- For companies whose plan has the module 'shop'. The company is the
-- seller (Model B, as everywhere outside transport): the customer pays by
-- card into the company's own Stripe account, and FlyttGo takes no fee
-- from the sale (the company pays for its plan).
--
--   * Catalogue: products (name, description, images in storage, price
--     incl. MVA, the MVA rate, SKU, active), optional simple variants
--     (size, colour…), and stock counted when "track stock" is on.
--     Visitors browse without signing in.
--   * Orders: a signed-in customer orders from the cart with the delivery
--     the company offers (pickup, or shipping at its flat rate). The
--     products are locked in one order and stock is taken atomically, so
--     it never goes below zero; an order not paid in time expires and its
--     stock comes back. Paid by card (shop-checkout, stripe-webhook):
--     recorded once, only when the account and the amount match. Each
--     paid order gets a receipt in the company's name (00011).
--   * Consumers (angrerettloven): the seller, the total incl. MVA and
--     delivery and the 14-day right of withdrawal are shown; the customer
--     withdraws with a form that is recorded; the company refunds through
--     Stripe on its own account (shop-refund) and the receipt is credited.
--   * Statuses: awaiting payment, paid, packed, shipped or ready for
--     pickup, delivered or collected, returned, refunded; or cancelled.
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. The module ───────────────────────────────────────────────────────────
-- Plans may carry 'shop', and a sales invoice may come from a shop order.
-- The lists are extended where they are (whatever an earlier migration has
-- added to them), so the rollback can take back exactly this.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.white_label_plans'::regclass AND conname = 'white_label_plans_modules_check';
  IF v_def IS NULL OR strpos(v_def, 'modules <@ ARRAY[') = 0 THEN
    RAISE EXCEPTION 'shop: white_label_plans_modules_check (00010) not found';
  END IF;
  IF v_def NOT LIKE '%''shop''::text%' THEN
    ALTER TABLE public.white_label_plans DROP CONSTRAINT white_label_plans_modules_check;
    EXECUTE 'ALTER TABLE public.white_label_plans ADD CONSTRAINT white_label_plans_modules_check '
         || replace(v_def, 'modules <@ ARRAY[', 'modules <@ ARRAY[''shop''::text, ');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.invoices'::regclass AND conname = 'invoices_source_type_check';
  IF v_def IS NULL OR strpos(v_def, 'source_type = ANY (ARRAY[') = 0 THEN
    RAISE EXCEPTION 'shop: invoices_source_type_check (00011) not found';
  END IF;
  IF v_def NOT LIKE '%''shop_order''::text%' THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_source_type_check;
    EXECUTE 'ALTER TABLE public.invoices ADD CONSTRAINT invoices_source_type_check '
         || replace(v_def, 'source_type = ANY (ARRAY[', 'source_type = ANY (ARRAY[''shop_order''::text, ');
  END IF;
END $$;

-- The plan. The price is a proposal until FlyttGo confirms it (Admin →
-- White label), as for the plans of 00010. Card payments are the only way
-- to pay, so the company's own Stripe account is required.
INSERT INTO public.white_label_plans (code, name, seller_model, summary, for_whom, setup_fee, monthly_fee, own_domain,
                                      features, flyttgo_does, company_does, requirements, sort, modules, industries,
                                      requires_stripe)
SELECT * FROM (VALUES
  ('shop', 'Online shop', 'company',
   'Sell your products from your own page: catalogue, stock, card payment into your Stripe account, receipts and returns.',
   'Shops and other companies that sell goods: clothes, gifts, food and drink, equipment, their own products.',
   2900::numeric, 990::numeric, false,
   ARRAY['A catalogue with pictures, variants (size, colour) and stock',
         'Cart and checkout for signed-in customers, pickup or shipping at your price',
         'Card payment into your own Stripe account; no fee to FlyttGo per sale',
         'A receipt in your name for every order, credit notes for returns',
         'The 14-day right of withdrawal: the customer''s form, your returns and refunds',
         'A website from the template library'],
   ARRAY['Runs the shop, the payments page and the invoicing system',
         'Processes your customers'' data for you under the data processing agreement',
         'Invoices you monthly for the plan'],
   ARRAY['Is the seller: the goods, delivery, returns, complaints and guarantees',
         'Its shop terms (with the right of withdrawal), privacy notice and its own accounts'],
   ARRAY['An active (verified) company', 'Customer service email and phone', 'Your shop terms and privacy notice (web addresses)',
         'The data processing agreement, accepted by an owner', 'A connected Stripe account that can take payments',
         'Your invoice settings (the seller on the receipts)'],
   70, ARRAY['shop', 'sales_invoicing'],
   ARRAY['retail', 'hospitality', 'field_service', 'appointments', 'software_education', 'nonprofit', 'other'],
   true)
) AS v(code, name, seller_model, summary, for_whom, setup_fee, monthly_fee, own_domain, features, flyttgo_does,
       company_does, requirements, sort, modules, industries, requires_stripe)
WHERE NOT EXISTS (SELECT 1 FROM public.white_label_plans p WHERE p.code = v.code);


-- ── 2. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shop_settings (
  organization_id      uuid        PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  pickup_enabled       boolean     NOT NULL DEFAULT true,
  pickup_address       text        CHECK (pickup_address IS NULL OR char_length(btrim(pickup_address)) BETWEEN 3 AND 200),
  pickup_note          text        CHECK (pickup_note IS NULL OR char_length(pickup_note) <= 300),     -- opening hours
  shipping_enabled     boolean     NOT NULL DEFAULT false,
  shipping_price       numeric     NOT NULL DEFAULT 0 CHECK (shipping_price >= 0 AND shipping_price < 100000),   -- incl. MVA
  shipping_vat_rate    numeric     NOT NULL DEFAULT 25 CHECK (shipping_vat_rate IN (0, 12, 15, 25)),
  free_shipping_over   numeric     CHECK (free_shipping_over IS NULL OR free_shipping_over > 0),   -- items incl. MVA
  shipping_note        text        CHECK (shipping_note IS NULL OR char_length(shipping_note) <= 300), -- carrier, delivery time
  return_cost_customer boolean     NOT NULL DEFAULT true,       -- the customer pays to send withdrawn goods back (stated at checkout)
  payment_minutes      integer     NOT NULL DEFAULT 60 CHECK (payment_minutes BETWEEN 30 AND 1440),   -- stock is held this long
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_settings_delivery CHECK (pickup_enabled OR shipping_enabled),
  CONSTRAINT shop_settings_pickup_address CHECK (NOT pickup_enabled OR pickup_address IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.shop_products (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  description     text        CHECK (description IS NULL OR char_length(description) <= 5000),
  price           numeric     NOT NULL CHECK (price > 0 AND price < 10000000 AND price = round(price, 2)),   -- incl. MVA
  vat_rate        numeric     NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 12, 15, 25)),
  sku             text        CHECK (sku IS NULL OR sku ~ '^[A-Za-z0-9._/-]{1,40}$'),
  images          text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(images) <= 8),      -- paths in shop-product-images
  variant_label   text        CHECK (variant_label IS NULL OR char_length(btrim(variant_label)) BETWEEN 1 AND 40),   -- "Size"
  track_stock     boolean     NOT NULL DEFAULT false,
  stock           integer     NOT NULL DEFAULT 0 CHECK (stock >= 0),      -- free to sell: held orders are already taken off
  active          boolean     NOT NULL DEFAULT true,
  sort            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_products_org_idx ON public.shop_products (organization_id, sort);
CREATE UNIQUE INDEX IF NOT EXISTS shop_products_sku_key ON public.shop_products (organization_id, sku) WHERE sku IS NOT NULL;

-- A product with active variants is ordered as one of them; each has its
-- own stock (when the product tracks stock) and may have its own price.
CREATE TABLE IF NOT EXISTS public.shop_variants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid        NOT NULL REFERENCES public.shop_products (id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  sku             text        CHECK (sku IS NULL OR sku ~ '^[A-Za-z0-9._/-]{1,40}$'),
  price           numeric     CHECK (price IS NULL OR (price > 0 AND price < 10000000 AND price = round(price, 2))),   -- else the product's
  stock           integer     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active          boolean     NOT NULL DEFAULT true,
  sort            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, name)
);
CREATE INDEX IF NOT EXISTS shop_variants_product_idx ON public.shop_variants (product_id, sort);

CREATE TABLE IF NOT EXISTS public.shop_orders (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  number               integer     NOT NULL,
  customer_user_id     uuid        NOT NULL,
  customer             jsonb       NOT NULL,                     -- name, phone, email
  delivery_method      text        NOT NULL CHECK (delivery_method IN ('pickup', 'shipping')),
  delivery_address     jsonb,                                    -- shipping: address, postcode, city
  items_total          numeric     NOT NULL,                     -- incl. MVA
  delivery_price       numeric     NOT NULL DEFAULT 0,           -- incl. MVA
  delivery_vat_rate    numeric     NOT NULL DEFAULT 25,
  total                numeric     NOT NULL CHECK (total > 0),   -- incl. MVA and delivery: what is paid
  status               text        NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
                         'awaiting_payment', 'paid', 'packed', 'shipped', 'ready_for_pickup', 'delivered', 'collected',
                         'returned', 'refunded', 'cancelled')),
  expires_at           timestamptz NOT NULL,                     -- unpaid by then: cancelled, stock back
  checkout_count       integer     NOT NULL DEFAULT 0,
  connected_account_id text,                                     -- the company's Stripe account, when ordered
  stripe_session_id    text,
  payment_intent_id    text,
  paid_amount          numeric,
  paid_at              timestamptz,
  payment_review       text,                                     -- a payment the company must look at (and refund)
  invoice_id           uuid        REFERENCES public.invoices (id),
  invoice_error        text,
  confirmation_sent_at timestamptz,
  tracking             text,                                     -- carrier and reference, when shipped
  delivered_at         timestamptz,                              -- delivered or collected: the 14 days start
  refunded_amount      numeric     NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  delivery_refunded    boolean     NOT NULL DEFAULT false,
  cancelled_at         timestamptz,
  cancelled_by         text        CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'company', 'expired')),
  cancel_reason        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  CONSTRAINT shop_orders_address CHECK (delivery_method = 'pickup' OR delivery_address IS NOT NULL),
  CONSTRAINT shop_orders_refund CHECK (refunded_amount <= coalesce(paid_amount, 0))
);
CREATE INDEX IF NOT EXISTS shop_orders_org_idx ON public.shop_orders (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_orders_customer_idx ON public.shop_orders (customer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_orders_expiry_idx ON public.shop_orders (expires_at) WHERE status = 'awaiting_payment';
-- One payment pays one order.
CREATE UNIQUE INDEX IF NOT EXISTS shop_orders_payment_key ON public.shop_orders (payment_intent_id) WHERE payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.shop_order_lines (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid    NOT NULL REFERENCES public.shop_orders (id) ON DELETE CASCADE,
  line_no           integer NOT NULL,
  product_id        uuid    NOT NULL REFERENCES public.shop_products (id),
  variant_id        uuid    REFERENCES public.shop_variants (id),
  name              text    NOT NULL,                            -- as sold, with the variant
  sku               text,
  quantity          integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  unit_price        numeric NOT NULL,                            -- incl. MVA
  vat_rate          numeric NOT NULL,
  total             numeric NOT NULL,
  stock_reserved    boolean NOT NULL DEFAULT false,              -- taken from a tracked stock
  refunded_quantity integer NOT NULL DEFAULT 0,
  UNIQUE (order_id, line_no),
  CONSTRAINT shop_order_lines_refunded CHECK (refunded_quantity BETWEEN 0 AND quantity)
);
CREATE INDEX IF NOT EXISTS shop_order_lines_product_idx ON public.shop_order_lines (product_id);

CREATE TABLE IF NOT EXISTS public.shop_order_events (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   uuid        NOT NULL REFERENCES public.shop_orders (id) ON DELETE CASCADE,
  actor_id   uuid,
  action     text        NOT NULL,
  details    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_order_events_idx ON public.shop_order_events (order_id, created_at);
DROP TRIGGER IF EXISTS guard_shop_order_events ON public.shop_order_events;
CREATE TRIGGER guard_shop_order_events BEFORE UPDATE OR DELETE ON public.shop_order_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();

-- The customer's notice that they withdraw from the purchase
-- (angrerettloven § 20), as they sent it, with whether it was within 14
-- days of receiving the goods.
CREATE TABLE IF NOT EXISTS public.shop_withdrawals (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid        NOT NULL REFERENCES public.shop_orders (id) ON DELETE CASCADE,
  organization_id  uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  customer_user_id uuid        NOT NULL,
  lines            jsonb       NOT NULL,                         -- [{line_id, quantity}]
  message          text        CHECK (message IS NULL OR char_length(message) <= 2000),
  within_period    boolean     NOT NULL,
  status           text        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'received', 'refunded', 'rejected')),
  handled_by       uuid,
  handled_at       timestamptz,
  note             text,
  requested_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_withdrawals_order_idx ON public.shop_withdrawals (order_id);

-- Refunds through Stripe on the company's account: one live per order, the
-- same idempotency key on every retry, effects once Stripe confirms.
CREATE TABLE IF NOT EXISTS public.shop_refunds (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid        NOT NULL REFERENCES public.shop_orders (id) ON DELETE CASCADE,
  withdrawal_id      uuid        REFERENCES public.shop_withdrawals (id),
  amount             numeric     NOT NULL CHECK (amount > 0),
  lines              jsonb       NOT NULL,                       -- [{line_id, quantity}]
  delivery           boolean     NOT NULL DEFAULT false,         -- the delivery price refunded too
  restock            boolean     NOT NULL DEFAULT false,         -- the goods go back into stock
  reason             text        NOT NULL,
  status             text        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'pending', 'succeeded', 'failed')),
  idempotency_key    text        NOT NULL UNIQUE,
  provider_refund_id text,
  error              text,
  credit_note_id     uuid        REFERENCES public.invoices (id),
  requested_by       uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shop_refunds_live ON public.shop_refunds (order_id) WHERE status IN ('requested', 'pending');

-- Product pictures: public (the catalogue is), written by the company's
-- owners and admins in its own folder (<organization id>/…), as logos.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'shop-product-images', 'shop-product-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'shop-product-images');
DROP POLICY IF EXISTS shop_product_images_read ON storage.objects;
CREATE POLICY shop_product_images_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'shop-product-images' AND public.org_folder_member(name));
DROP POLICY IF EXISTS shop_product_images_write ON storage.objects;
CREATE POLICY shop_product_images_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'shop-product-images' AND public.org_folder_member(name, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS shop_product_images_update ON storage.objects;
CREATE POLICY shop_product_images_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'shop-product-images' AND public.org_folder_member(name, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS shop_product_images_delete ON storage.objects;
CREATE POLICY shop_product_images_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'shop-product-images' AND public.org_folder_member(name, ARRAY['owner', 'admin']));


-- ── 3. Who reads what ───────────────────────────────────────────────────────
-- An order: its customer, the company's members (any role: staff pack and
-- ship), FlyttGo's administrators.
CREATE OR REPLACE FUNCTION public.can_read_shop_order(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.shop_orders o
     WHERE o.id = p_id AND (o.customer_user_id = auth.uid() OR public.is_org_member(o.organization_id)));
$$;

ALTER TABLE public.shop_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_products     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_variants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_order_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_withdrawals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_refunds      ENABLE ROW LEVEL SECURITY;

-- The catalogue and the delivery options, for visitors.
DROP POLICY IF EXISTS shop_settings_public ON public.shop_settings;
CREATE POLICY shop_settings_public ON public.shop_settings FOR SELECT TO anon
  USING (public.org_has_module(organization_id, 'shop'));
DROP POLICY IF EXISTS shop_settings_select ON public.shop_settings;
CREATE POLICY shop_settings_select ON public.shop_settings FOR SELECT TO authenticated
  USING (public.org_has_module(organization_id, 'shop') OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS shop_products_public ON public.shop_products;
CREATE POLICY shop_products_public ON public.shop_products FOR SELECT TO anon
  USING (active AND public.org_has_module(organization_id, 'shop'));
DROP POLICY IF EXISTS shop_products_select ON public.shop_products;
CREATE POLICY shop_products_select ON public.shop_products FOR SELECT TO authenticated
  USING ((active AND public.org_has_module(organization_id, 'shop')) OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS shop_variants_public ON public.shop_variants;
CREATE POLICY shop_variants_public ON public.shop_variants FOR SELECT TO anon
  USING (active AND EXISTS (SELECT 1 FROM public.shop_products p WHERE p.id = product_id));
DROP POLICY IF EXISTS shop_variants_select ON public.shop_variants;
CREATE POLICY shop_variants_select ON public.shop_variants FOR SELECT TO authenticated
  USING ((active AND EXISTS (SELECT 1 FROM public.shop_products p WHERE p.id = product_id))
         OR public.is_admin() OR public.is_org_member(organization_id));

DROP POLICY IF EXISTS shop_orders_select ON public.shop_orders;
CREATE POLICY shop_orders_select ON public.shop_orders FOR SELECT TO authenticated USING (public.can_read_shop_order(id));
DROP POLICY IF EXISTS shop_order_lines_select ON public.shop_order_lines;
CREATE POLICY shop_order_lines_select ON public.shop_order_lines FOR SELECT TO authenticated USING (public.can_read_shop_order(order_id));
DROP POLICY IF EXISTS shop_order_events_select ON public.shop_order_events;
CREATE POLICY shop_order_events_select ON public.shop_order_events FOR SELECT TO authenticated USING (public.can_read_shop_order(order_id));
DROP POLICY IF EXISTS shop_withdrawals_select ON public.shop_withdrawals;
CREATE POLICY shop_withdrawals_select ON public.shop_withdrawals FOR SELECT TO authenticated USING (public.can_read_shop_order(order_id));
DROP POLICY IF EXISTS shop_refunds_select ON public.shop_refunds;
CREATE POLICY shop_refunds_select ON public.shop_refunds FOR SELECT TO authenticated USING (public.can_read_shop_order(order_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.shop_settings, public.shop_products, public.shop_variants, public.shop_orders,
  public.shop_order_lines, public.shop_order_events, public.shop_withdrawals, public.shop_refunds FROM anon, authenticated;
REVOKE ALL ON public.shop_orders, public.shop_order_lines, public.shop_order_events, public.shop_withdrawals, public.shop_refunds FROM anon;


-- ── 4. The company's catalogue ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.shop_event(p_order uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.shop_order_events (order_id, actor_id, action, details)
  VALUES (p_order, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.save_shop_settings(p_org uuid, p jsonb)
RETURNS public.shop_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.shop_settings%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  INSERT INTO public.shop_settings AS t (organization_id, pickup_enabled, pickup_address, pickup_note, shipping_enabled, shipping_price,
                                         shipping_vat_rate, free_shipping_over, shipping_note, return_cost_customer, payment_minutes)
  VALUES (p_org, coalesce((p ->> 'pickup_enabled')::boolean, true), nullif(btrim(p ->> 'pickup_address'), ''),
          nullif(btrim(p ->> 'pickup_note'), ''), coalesce((p ->> 'shipping_enabled')::boolean, false),
          coalesce(nullif(p ->> 'shipping_price', '')::numeric, 0), coalesce(nullif(p ->> 'shipping_vat_rate', '')::numeric, 25),
          nullif(p ->> 'free_shipping_over', '')::numeric, nullif(btrim(p ->> 'shipping_note'), ''),
          coalesce((p ->> 'return_cost_customer')::boolean, true), coalesce(nullif(p ->> 'payment_minutes', '')::int, 60))
  ON CONFLICT (organization_id) DO UPDATE SET
    pickup_enabled = EXCLUDED.pickup_enabled, pickup_address = EXCLUDED.pickup_address, pickup_note = EXCLUDED.pickup_note,
    shipping_enabled = EXCLUDED.shipping_enabled, shipping_price = EXCLUDED.shipping_price,
    shipping_vat_rate = EXCLUDED.shipping_vat_rate, free_shipping_over = EXCLUDED.free_shipping_over,
    shipping_note = EXCLUDED.shipping_note, return_cost_customer = EXCLUDED.return_cost_customer,
    payment_minutes = EXCLUDED.payment_minutes, updated_at = now()
  RETURNING * INTO s;
  RETURN s;
END $$;

-- A company registered for MVA charges it at the product's rate; one that
-- is not charges none (rate 0).
CREATE OR REPLACE FUNCTION public.shop_check_vat(p_org uuid, p_rate numeric)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(p_rate, 25) <> 0 AND NOT coalesce((SELECT vat_registered FROM public.organizations WHERE id = p_org), false) THEN
    RAISE EXCEPTION 'shop: only a company registered for MVA charges MVA; set the rate to 0' USING ERRCODE = '22023';
  END IF;
END $$;

-- A product: p = {name, description, price (incl. MVA), vat_rate, sku,
-- images: [paths in the company's folder], variant_label, track_stock,
-- stock, active, sort}.
CREATE OR REPLACE FUNCTION public.save_shop_product(p_org uuid, p_id uuid, p jsonb)
RETURNS public.shop_products
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.shop_products%ROWTYPE; v_images text[]; v_rate numeric := coalesce(nullif(p ->> 'vat_rate', '')::numeric, 25);
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  PERFORM public.shop_check_vat(p_org, v_rate);
  v_images := coalesce(ARRAY(SELECT jsonb_array_elements_text(p -> 'images')), '{}');
  IF EXISTS (SELECT 1 FROM unnest(v_images) i WHERE split_part(i, '/', 1) <> p_org::text) THEN
    RAISE EXCEPTION 'shop: pictures must be in the company''s own folder' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.shop_products (organization_id, name, description, price, vat_rate, sku, images, variant_label, track_stock,
                                      stock, active, sort)
    VALUES (p_org, btrim(p ->> 'name'), nullif(btrim(p ->> 'description'), ''), (p ->> 'price')::numeric, v_rate,
            nullif(btrim(p ->> 'sku'), ''), v_images, nullif(btrim(p ->> 'variant_label'), ''),
            coalesce((p ->> 'track_stock')::boolean, false), coalesce(nullif(p ->> 'stock', '')::int, 0),
            coalesce((p ->> 'active')::boolean, true), coalesce(nullif(p ->> 'sort', '')::int, 0))
    RETURNING * INTO r;
  ELSE
    UPDATE public.shop_products SET name = btrim(p ->> 'name'), description = nullif(btrim(p ->> 'description'), ''),
           price = (p ->> 'price')::numeric, vat_rate = v_rate, sku = nullif(btrim(p ->> 'sku'), ''), images = v_images,
           variant_label = nullif(btrim(p ->> 'variant_label'), ''), track_stock = coalesce((p ->> 'track_stock')::boolean, false),
           stock = coalesce(nullif(p ->> 'stock', '')::int, stock), active = coalesce((p ->> 'active')::boolean, true),
           sort = coalesce(nullif(p ->> 'sort', '')::int, 0), updated_at = now()
     WHERE id = p_id AND organization_id = p_org RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such product' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN r;
END $$;

-- A variant of a product: p = {name, sku, price (empty: the product's),
-- stock, active, sort}.
CREATE OR REPLACE FUNCTION public.save_shop_variant(p_product uuid, p_id uuid, p jsonb)
RETURNS public.shop_variants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_org uuid; r public.shop_variants%ROWTYPE;
BEGIN
  SELECT organization_id INTO v_org FROM public.shop_products WHERE id = p_product;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such product' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.require_org_role(v_org, ARRAY['owner', 'admin']);
  IF p_id IS NULL THEN
    INSERT INTO public.shop_variants (product_id, organization_id, name, sku, price, stock, active, sort)
    VALUES (p_product, v_org, btrim(p ->> 'name'), nullif(btrim(p ->> 'sku'), ''), nullif(p ->> 'price', '')::numeric,
            coalesce(nullif(p ->> 'stock', '')::int, 0), coalesce((p ->> 'active')::boolean, true), coalesce(nullif(p ->> 'sort', '')::int, 0))
    RETURNING * INTO r;
  ELSE
    UPDATE public.shop_variants SET name = btrim(p ->> 'name'), sku = nullif(btrim(p ->> 'sku'), ''),
           price = nullif(p ->> 'price', '')::numeric, stock = coalesce(nullif(p ->> 'stock', '')::int, stock),
           active = coalesce((p ->> 'active')::boolean, true), sort = coalesce(nullif(p ->> 'sort', '')::int, 0)
     WHERE id = p_id AND product_id = p_product RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such variant' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN r;
END $$;

-- The stock free to sell, after counting (owners, admins, staff).
CREATE OR REPLACE FUNCTION public.set_shop_stock(p_product uuid, p_variant uuid, p_stock integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.shop_products WHERE id = p_product;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such product' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.require_org_role(v_org, ARRAY['owner', 'admin', 'staff']);
  IF p_stock IS NULL OR p_stock < 0 THEN RAISE EXCEPTION 'shop: stock is 0 or more' USING ERRCODE = '22023'; END IF;
  IF p_variant IS NULL THEN
    UPDATE public.shop_products SET stock = p_stock, updated_at = now() WHERE id = p_product;
  ELSE
    UPDATE public.shop_variants SET stock = p_stock WHERE id = p_variant AND product_id = p_product;
    IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such variant' USING ERRCODE = 'P0002'; END IF;
  END IF;
END $$;


-- ── 5. Prices, stock and the order ──────────────────────────────────────────
-- Locks the products and then the variants, each in id order, so orders,
-- expiries and refunds touching the same stock queue instead of
-- deadlocking.
CREATE OR REPLACE FUNCTION public.shop_lock_items(p_products uuid[], p_variants uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.shop_products WHERE id = ANY (p_products) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.shop_variants WHERE id = ANY (coalesce(p_variants, '{}')) ORDER BY id FOR UPDATE;
END $$;

-- What a cart costs, from the catalogue (never the browser's prices):
-- p_items [{product_id, variant_id, quantity}], p_delivery 'pickup' or
-- 'shipping'. Prices incl. MVA; the total is what is paid.
CREATE OR REPLACE FUNCTION public.shop_compute(p_org uuid, p_items jsonb, p_delivery text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  cfg public.shop_settings%ROWTYPE;
  pr  public.shop_products%ROWTYPE;
  va  public.shop_variants%ROWTYPE;
  it  record;
  v_lines jsonb := '[]'::jsonb;
  v_items numeric := 0;
  v_price numeric;
  v_delivery numeric := 0;
BEGIN
  IF NOT public.org_has_module(p_org, 'shop') THEN RAISE EXCEPTION 'shop: this shop is not open' USING ERRCODE = '55000'; END IF;
  SELECT * INTO cfg FROM public.shop_settings WHERE organization_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: this shop is not open' USING ERRCODE = '55000'; END IF;
  IF p_delivery IS NULL OR p_delivery NOT IN ('pickup', 'shipping')
     OR (p_delivery = 'pickup' AND NOT cfg.pickup_enabled) OR (p_delivery = 'shipping' AND NOT cfg.shipping_enabled) THEN
    RAISE EXCEPTION 'shop: choose a delivery the shop offers' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'shop: the cart is empty' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN RAISE EXCEPTION 'shop: at most 100 lines in one order' USING ERRCODE = '22023'; END IF;
  FOR it IN SELECT (e ->> 'product_id')::uuid AS product_id, nullif(e ->> 'variant_id', '')::uuid AS variant_id,
                   sum((e ->> 'quantity')::int) AS quantity
              FROM jsonb_array_elements(p_items) e GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    SELECT * INTO pr FROM public.shop_products WHERE id = it.product_id AND organization_id = p_org AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'shop: a product in the cart is no longer sold' USING ERRCODE = '55000'; END IF;
    IF it.quantity IS NULL OR it.quantity < 1 OR it.quantity > 999 THEN
      RAISE EXCEPTION 'shop: a quantity from 1 to 999' USING ERRCODE = '22023';
    END IF;
    va := NULL;
    IF it.variant_id IS NOT NULL THEN
      SELECT * INTO va FROM public.shop_variants WHERE id = it.variant_id AND product_id = pr.id AND active;
      IF NOT FOUND THEN RAISE EXCEPTION 'shop: % is no longer sold in that variant', pr.name USING ERRCODE = '55000'; END IF;
    ELSIF EXISTS (SELECT 1 FROM public.shop_variants WHERE product_id = pr.id AND active) THEN
      RAISE EXCEPTION 'shop: choose % for %', lower(coalesce(pr.variant_label, 'a variant')), pr.name USING ERRCODE = '22023';
    END IF;
    IF pr.track_stock AND it.quantity > coalesce(va.stock, pr.stock) THEN
      RAISE EXCEPTION 'shop: only % of % left', coalesce(va.stock, pr.stock), pr.name || coalesce(' (' || va.name || ')', '')
        USING ERRCODE = '55000';
    END IF;
    v_price := coalesce(va.price, pr.price);
    v_items := v_items + v_price * it.quantity;
    v_lines := v_lines || jsonb_build_object(
      'product_id', pr.id, 'variant_id', va.id, 'name', pr.name || coalesce(' (' || va.name || ')', ''),
      'sku', coalesce(va.sku, pr.sku), 'quantity', it.quantity, 'unit_price', v_price, 'vat_rate', pr.vat_rate,
      'total', v_price * it.quantity, 'track', pr.track_stock);
  END LOOP;
  IF p_delivery = 'shipping' THEN
    v_delivery := CASE WHEN cfg.free_shipping_over IS NOT NULL AND v_items >= cfg.free_shipping_over THEN 0 ELSE cfg.shipping_price END;
  END IF;
  RETURN jsonb_build_object('lines', v_lines, 'items_total', v_items, 'delivery_method', p_delivery,
                            'delivery_price', v_delivery, 'delivery_vat_rate', cfg.shipping_vat_rate,
                            'total', v_items + v_delivery, 'payment_minutes', cfg.payment_minutes);
END $$;

-- The price of a cart before ordering (visitors too): the same
-- computation the order uses.
CREATE OR REPLACE FUNCTION public.shop_quote(p_org uuid, p_items jsonb, p_delivery text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.shop_compute(p_org, p_items, p_delivery); $$;

-- Puts the stock of an order's held lines back (expired, cancelled).
CREATE OR REPLACE FUNCTION public.shop_release_stock(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l record;
BEGIN
  PERFORM public.shop_lock_items(ARRAY(SELECT product_id FROM public.shop_order_lines WHERE order_id = p_order AND stock_reserved),
                                 ARRAY(SELECT variant_id FROM public.shop_order_lines WHERE order_id = p_order AND stock_reserved AND variant_id IS NOT NULL));
  FOR l IN SELECT * FROM public.shop_order_lines WHERE order_id = p_order AND stock_reserved LOOP
    IF l.variant_id IS NOT NULL THEN
      UPDATE public.shop_variants SET stock = stock + l.quantity WHERE id = l.variant_id;
    ELSE
      UPDATE public.shop_products SET stock = stock + l.quantity, updated_at = now() WHERE id = l.product_id;
    END IF;
  END LOOP;
  UPDATE public.shop_order_lines SET stock_reserved = false WHERE order_id = p_order AND stock_reserved;
END $$;

-- Unpaid orders past their time: cancelled, stock back. One company's
-- (before it takes an order, with the cart's items: everything is locked
-- in one go, in order) or all (the scheduled job).
CREATE OR REPLACE FUNCTION public.shop_expire(p_org uuid, p_products uuid[] DEFAULT '{}', p_variants uuid[] DEFAULT '{}')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_ids uuid[]; v_id uuid;
BEGIN
  v_ids := ARRAY(SELECT id FROM public.shop_orders
                  WHERE status = 'awaiting_payment' AND expires_at < now() AND (p_org IS NULL OR organization_id = p_org)
                  ORDER BY id FOR UPDATE SKIP LOCKED);
  PERFORM public.shop_lock_items(
    coalesce(p_products, '{}') || ARRAY(SELECT product_id FROM public.shop_order_lines WHERE order_id = ANY (v_ids) AND stock_reserved),
    coalesce(p_variants, '{}') || ARRAY(SELECT variant_id FROM public.shop_order_lines
                                         WHERE order_id = ANY (v_ids) AND stock_reserved AND variant_id IS NOT NULL));
  FOREACH v_id IN ARRAY v_ids LOOP
    UPDATE public.shop_orders SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'expired',
           cancel_reason = 'not paid in time', updated_at = now()
     WHERE id = v_id;
    PERFORM public.shop_release_stock(v_id);
    PERFORM public.shop_event(v_id, 'order.expired', '{}'::jsonb);
  END LOOP;
  RETURN cardinality(v_ids);
END $$;

CREATE OR REPLACE FUNCTION public.expire_shop_orders()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'shop: the server only' USING ERRCODE = '42501'; END IF;
  RETURN public.shop_expire(NULL);
END $$;

-- A signed-in customer orders the cart. p_contact {name, phone, email};
-- p_address {address, postcode, city} for shipping. The stock is taken
-- now and held until the order is paid or expires.
CREATE OR REPLACE FUNCTION public.place_shop_order(p_org uuid, p_items jsonb, p_delivery text, p_address jsonb, p_contact jsonb)
RETURNS public.shop_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v jsonb; l jsonb; o public.shop_orders%ROWTYPE; v_no int; n int := 0;
  v_account text; v_ready boolean; v_seller jsonb; v_addr jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'shop: sign in to order' USING ERRCODE = '42501'; END IF;
  IF NOT public.org_has_module(p_org, 'shop') THEN RAISE EXCEPTION 'shop: this shop is not open' USING ERRCODE = '55000'; END IF;
  SELECT stripe_account_id, stripe_charges_enabled INTO v_account, v_ready
    FROM public.organization_white_label WHERE organization_id = p_org;
  IF v_account IS NULL OR NOT coalesce(v_ready, false) THEN
    RAISE EXCEPTION 'shop: the shop does not take card payments yet' USING ERRCODE = '55000';
  END IF;
  -- Every paid order gets a receipt in the company's name, so the seller's
  -- details must be complete before an order is taken (00011).
  v_seller := public.organization_seller(p_org);
  IF v_seller ->> 'name' IS NULL OR v_seller ->> 'org_number' IS NULL OR v_seller ->> 'bank_account' IS NULL OR v_seller ->> 'address' IS NULL THEN
    RAISE EXCEPTION 'shop: the shop cannot take orders until its invoice settings are complete' USING ERRCODE = '55000';
  END IF;
  IF coalesce(btrim(p_contact ->> 'name'), '') = '' OR coalesce(btrim(p_contact ->> 'phone'), '') = ''
     OR coalesce(btrim(p_contact ->> 'email'), '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'shop: a name, a phone number and an email address are required' USING ERRCODE = '22023';
  END IF;
  IF p_delivery = 'shipping' THEN
    IF coalesce(btrim(p_address ->> 'address'), '') = '' OR coalesce(btrim(p_address ->> 'postcode'), '') !~ '^[0-9]{4}$'
       OR coalesce(btrim(p_address ->> 'city'), '') = '' THEN
      RAISE EXCEPTION 'shop: the delivery address (street, four-digit postcode, place)' USING ERRCODE = '22023';
    END IF;
    v_addr := jsonb_build_object('address', btrim(p_address ->> 'address'), 'postcode', btrim(p_address ->> 'postcode'),
                                 'city', btrim(p_address ->> 'city'));
  END IF;

  -- The products and variants in the cart, locked: competing orders for the
  -- last items queue here, and each sees the stock the one before left.
  -- Orders nobody paid give their stock back first.
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'shop: the cart is empty' USING ERRCODE = '22023'; END IF;
  PERFORM public.shop_expire(p_org,
    ARRAY(SELECT DISTINCT (e ->> 'product_id')::uuid FROM jsonb_array_elements(p_items) e),
    ARRAY(SELECT DISTINCT nullif(e ->> 'variant_id', '')::uuid FROM jsonb_array_elements(p_items) e WHERE nullif(e ->> 'variant_id', '') IS NOT NULL));
  v := public.shop_compute(p_org, p_items, p_delivery);
  IF (v ->> 'total')::numeric < 3 THEN RAISE EXCEPTION 'shop: the smallest card payment is 3 kr' USING ERRCODE = '22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('shop-orders-no:' || p_org::text));
  SELECT coalesce(max(number), 0) + 1 INTO v_no FROM public.shop_orders WHERE organization_id = p_org;
  INSERT INTO public.shop_orders (organization_id, number, customer_user_id, customer, delivery_method, delivery_address,
                                  items_total, delivery_price, delivery_vat_rate, total, expires_at, connected_account_id)
  VALUES (p_org, v_no, auth.uid(),
          jsonb_build_object('name', btrim(p_contact ->> 'name'), 'phone', btrim(p_contact ->> 'phone'),
                             'email', lower(btrim(p_contact ->> 'email'))),
          p_delivery, v_addr, (v ->> 'items_total')::numeric, (v ->> 'delivery_price')::numeric,
          (v ->> 'delivery_vat_rate')::numeric, (v ->> 'total')::numeric,
          now() + make_interval(mins => (v ->> 'payment_minutes')::int), v_account)
  RETURNING * INTO o;
  FOR l IN SELECT * FROM jsonb_array_elements(v -> 'lines') LOOP
    n := n + 1;
    -- The stock is taken only while enough is left; the CHECK (stock >= 0)
    -- holds it whatever else happens.
    IF (l ->> 'track')::boolean THEN
      IF l ->> 'variant_id' IS NOT NULL THEN
        UPDATE public.shop_variants SET stock = stock - (l ->> 'quantity')::int
         WHERE id = (l ->> 'variant_id')::uuid AND stock >= (l ->> 'quantity')::int;
      ELSE
        UPDATE public.shop_products SET stock = stock - (l ->> 'quantity')::int, updated_at = now()
         WHERE id = (l ->> 'product_id')::uuid AND stock >= (l ->> 'quantity')::int;
      END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'shop: % is sold out', l ->> 'name' USING ERRCODE = '55000'; END IF;
    END IF;
    INSERT INTO public.shop_order_lines (order_id, line_no, product_id, variant_id, name, sku, quantity, unit_price, vat_rate, total, stock_reserved)
    VALUES (o.id, n, (l ->> 'product_id')::uuid, nullif(l ->> 'variant_id', '')::uuid, l ->> 'name', l ->> 'sku',
            (l ->> 'quantity')::int, (l ->> 'unit_price')::numeric, (l ->> 'vat_rate')::numeric, (l ->> 'total')::numeric,
            (l ->> 'track')::boolean);
  END LOOP;
  PERFORM public.shop_event(o.id, 'order.placed', jsonb_build_object('total', o.total, 'delivery', p_delivery));
  RETURN o;
END $$;

-- The order, locked, for the company: its owners, admins and the roles
-- named. Nobody else, not FlyttGo's administrators either (it is the
-- company's business).
CREATE OR REPLACE FUNCTION public.shop_order_for(p_id uuid, p_roles text[])
RETURNS public.shop_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such order' USING ERRCODE = 'P0002'; END IF;
  IF public.is_server() OR public.is_org_member(o.organization_id, p_roles || ARRAY['owner', 'admin']) THEN RETURN o; END IF;
  RAISE EXCEPTION 'shop: requires role %', array_to_string(p_roles || ARRAY['owner', 'admin'], ' or ') USING ERRCODE = '42501';
END $$;

-- An unpaid order is cancelled by the customer or the company and its
-- stock comes back. A paid order is refunded instead.
CREATE OR REPLACE FUNCTION public.cancel_shop_order(p_order uuid, p_reason text)
RETURNS public.shop_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE; v_by text;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such order' USING ERRCODE = 'P0002'; END IF;
  IF o.customer_user_id = auth.uid() AND NOT public.is_org_member(o.organization_id, ARRAY['owner', 'admin', 'staff']) THEN
    v_by := 'customer';
  ELSE
    o := public.shop_order_for(p_order, ARRAY['staff']);
    v_by := 'company';
  END IF;
  IF o.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'shop: the order is %; a paid order is refunded by the shop', replace(o.status, '_', ' ') USING ERRCODE = '55000';
  END IF;
  UPDATE public.shop_orders SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_by,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   WHERE id = p_order RETURNING * INTO o;
  PERFORM public.shop_release_stock(p_order);
  PERFORM public.shop_event(p_order, 'order.cancelled', jsonb_build_object('by', v_by, 'reason', p_reason));
  RETURN o;
END $$;

-- Before a card payment page is opened (shop-checkout, as the server, or
-- the customer): the order must still be waiting (an order past its time
-- comes back cancelled), and its stock is held
-- for at least 33 minutes more, since a Stripe payment page lives at
-- least 30. At most five payment pages per order.
CREATE OR REPLACE FUNCTION public.shop_checkout_begin(p_order uuid)
RETURNS public.shop_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_server() OR o.customer_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'shop: no such order' USING ERRCODE = 'P0002';
  END IF;
  -- Past its time: expired now and returned cancelled (the caller says so;
  -- raising would undo the expiry).
  IF o.status = 'awaiting_payment' AND o.expires_at < now() THEN
    PERFORM public.shop_expire(o.organization_id);
    SELECT * INTO o FROM public.shop_orders WHERE id = p_order;
    RETURN o;
  END IF;
  IF o.status <> 'awaiting_payment' THEN RAISE EXCEPTION 'shop: the order is %', replace(o.status, '_', ' ') USING ERRCODE = '55000'; END IF;
  IF o.checkout_count >= 5 THEN RAISE EXCEPTION 'shop: too many payment attempts; order again' USING ERRCODE = '55000'; END IF;
  UPDATE public.shop_orders SET checkout_count = checkout_count + 1, expires_at = greatest(expires_at, now() + interval '33 minutes'),
         updated_at = now()
   WHERE id = p_order RETURNING * INTO o;
  RETURN o;
END $$;


-- ── 6. Payment and the receipt ──────────────────────────────────────────────
-- The receipt: a sales invoice in the company's name (00011), issued and
-- paid at once. Prices include MVA, so each line's MVA is taken out of its
-- total (as on a till receipt) and the receipt comes to exactly what was
-- paid.
CREATE OR REPLACE FUNCTION public.shop_invoice(p_order uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE; v_inv public.invoices%ROWTYPE; v_lines jsonb;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order FOR UPDATE;
  IF o.invoice_id IS NOT NULL THEN SELECT * INTO v_inv FROM public.invoices WHERE id = o.invoice_id; RETURN v_inv; END IF;
  IF o.paid_at IS NULL THEN RAISE EXCEPTION 'shop: the order is not paid' USING ERRCODE = '55000'; END IF;
  SELECT jsonb_agg(x ORDER BY ord) INTO v_lines FROM (
    SELECT l.line_no AS ord, jsonb_build_object('description', l.name || coalesce(', ' || l.sku, ''), 'quantity', l.quantity,
             'unit_price', round(l.unit_price / (1 + l.vat_rate / 100), 2), 'vat_rate', l.vat_rate, 'gross', l.total) AS x
      FROM public.shop_order_lines l WHERE l.order_id = o.id
    UNION ALL
    SELECT 100000, jsonb_build_object('description', CASE o.delivery_method WHEN 'shipping' THEN 'Delivery' ELSE 'Pickup' END,
             'quantity', 1, 'unit_price', round(o.delivery_price / (1 + o.delivery_vat_rate / 100), 2),
             'vat_rate', o.delivery_vat_rate, 'gross', o.delivery_price)
     WHERE o.delivery_price > 0) s;
  v_inv := public.sales_invoice_draft(o.organization_id,
             o.customer || jsonb_build_object('address', o.delivery_address ->> 'address',
                                              'postcode_city', nullif(btrim(coalesce(o.delivery_address ->> 'postcode', '') || ' ' || coalesce(o.delivery_address ->> 'city', '')), '')),
             o.customer_user_id, v_lines, 'Order ' || o.number, 'Paid by card', 'shop_order', o.id);
  UPDATE public.invoice_lines il SET
    total      = g.gross,
    net_amount = round(g.gross / (1 + il.vat_rate / 100), 2),
    vat_amount = g.gross - round(g.gross / (1 + il.vat_rate / 100), 2),
    unit_price = round(round(g.gross / (1 + il.vat_rate / 100), 2) / il.quantity, 4)
    FROM (SELECT x.n AS line_no, (x.elem ->> 'gross')::numeric AS gross FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS x (elem, n)) g
   WHERE il.invoice_id = v_inv.id AND il.line_no = g.line_no;
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    delivery_from = (o.paid_at AT TIME ZONE 'Europe/Oslo')::date, delivery_to = (o.paid_at AT TIME ZONE 'Europe/Oslo')::date
   WHERE id = v_inv.id;
  v_inv := public.issue_invoice(v_inv.id);
  v_inv := public.record_invoice_payment(v_inv.id, o.paid_amount, (o.paid_at AT TIME ZONE 'Europe/Oslo')::date, 'card', o.payment_intent_id);
  UPDATE public.shop_orders SET invoice_id = v_inv.id, invoice_error = NULL, updated_at = now() WHERE id = o.id;
  PERFORM public.shop_event(o.id, 'order.receipt', jsonb_build_object('invoice', v_inv.number, 'total', v_inv.total));
  RETURN v_inv;
END $$;

-- The company makes the receipt again when it could not be made at
-- payment (invoice_error): owners, admins, finance.
CREATE OR REPLACE FUNCTION public.invoice_shop_order(p_order uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.shop_order_for(p_order, ARRAY['finance']);
  RETURN public.shop_invoice(p_order);
END $$;

-- A card payment Stripe confirmed (stripe-webhook, the server). Recorded
-- once (the payment's reference), only when it was made on the order's
-- account for exactly its total; anything else is held for the company to
-- look at and is never marked paid. Returns what was done.
CREATE OR REPLACE FUNCTION public.record_shop_payment(p_order uuid, p_amount numeric, p_account text, p_reference text, p_session text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE; l record; v_short text[] := '{}';
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'shop: the server only' USING ERRCODE = '42501'; END IF;
  IF coalesce(p_reference, '') = '' THEN RAISE EXCEPTION 'shop: the payment''s reference is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such order' USING ERRCODE = 'P0002'; END IF;
  IF o.payment_intent_id = p_reference THEN RETURN 'already recorded'; END IF;
  IF p_account IS DISTINCT FROM o.connected_account_id OR p_amount IS DISTINCT FROM o.total OR o.paid_at IS NOT NULL THEN
    UPDATE public.shop_orders SET payment_review = left(concat_ws('; ', payment_review,
             format('payment %s of %s kr on %s not recorded: %s', p_reference, p_amount, coalesce(p_account, 'FlyttGo'),
                    CASE WHEN o.paid_at IS NOT NULL THEN 'the order was already paid (refund it in Stripe)'
                         WHEN p_account IS DISTINCT FROM o.connected_account_id THEN 'not the shop''s account'
                         ELSE format('the order''s total is %s kr', o.total) END)), 2000),
           updated_at = now()
     WHERE id = p_order;
    PERFORM public.shop_event(p_order, 'order.payment_held', jsonb_build_object('reference', p_reference, 'amount', p_amount, 'account', p_account));
    RETURN 'held for review';
  END IF;
  -- Paid after the order expired or was cancelled: the goods are taken
  -- again where they are still in stock; what is not is for the company
  -- to refund or restock.
  IF o.status = 'cancelled' THEN
    PERFORM public.shop_lock_items(ARRAY(SELECT product_id FROM public.shop_order_lines WHERE order_id = p_order),
                                   ARRAY(SELECT variant_id FROM public.shop_order_lines WHERE order_id = p_order AND variant_id IS NOT NULL));
    FOR l IN SELECT ol.*, p.track_stock FROM public.shop_order_lines ol JOIN public.shop_products p ON p.id = ol.product_id
              WHERE ol.order_id = p_order AND NOT ol.stock_reserved AND p.track_stock LOOP
      IF l.variant_id IS NOT NULL THEN
        UPDATE public.shop_variants SET stock = stock - l.quantity WHERE id = l.variant_id AND stock >= l.quantity;
      ELSE
        UPDATE public.shop_products SET stock = stock - l.quantity, updated_at = now() WHERE id = l.product_id AND stock >= l.quantity;
      END IF;
      IF FOUND THEN UPDATE public.shop_order_lines SET stock_reserved = true WHERE id = l.id;
      ELSE v_short := v_short || l.name; END IF;
    END LOOP;
    IF cardinality(v_short) > 0 THEN
      UPDATE public.shop_orders SET payment_review = left(concat_ws('; ', payment_review,
               'paid after the order was cancelled; no longer in stock: ' || array_to_string(v_short, ', ')), 2000)
       WHERE id = p_order;
    END IF;
  END IF;
  UPDATE public.shop_orders SET status = 'paid', paid_at = now(), paid_amount = p_amount, payment_intent_id = p_reference,
         stripe_session_id = p_session, cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL, updated_at = now()
   WHERE id = p_order;
  PERFORM public.shop_event(p_order, 'order.paid', jsonb_build_object('amount', p_amount, 'reference', p_reference));
  -- The receipt. Should it fail (the company's invoicing switched off, its
  -- settings emptied), the payment stays recorded and the company makes it
  -- again (invoice_shop_order).
  BEGIN
    PERFORM public.shop_invoice(p_order);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.shop_orders SET invoice_error = left(SQLERRM, 500) WHERE id = p_order;
  END;
  RETURN 'recorded';
END $$;

CREATE OR REPLACE FUNCTION public.mark_shop_confirmation_sent(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'shop: the server only' USING ERRCODE = '42501'; END IF;
  UPDATE public.shop_orders SET confirmation_sent_at = now() WHERE id = p_order AND confirmation_sent_at IS NULL;
END $$;


-- ── 7. Packing, delivery ────────────────────────────────────────────────────
-- The company moves a paid order on: packed, then shipped (with the
-- carrier's reference in p_note) or ready for pickup, then delivered or
-- collected (the 14 days of the right of withdrawal start), or returned.
CREATE OR REPLACE FUNCTION public.set_shop_order_status(p_order uuid, p_status text, p_note text)
RETURNS public.shop_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE; v_ok boolean;
BEGIN
  o := public.shop_order_for(p_order, ARRAY['staff']);
  v_ok := CASE p_status
    WHEN 'packed'           THEN o.status = 'paid'
    WHEN 'shipped'          THEN o.status IN ('paid', 'packed') AND o.delivery_method = 'shipping'
    WHEN 'ready_for_pickup' THEN o.status IN ('paid', 'packed') AND o.delivery_method = 'pickup'
    WHEN 'delivered'        THEN o.status = 'shipped'
    WHEN 'collected'        THEN o.status = 'ready_for_pickup'
    WHEN 'returned'         THEN o.status IN ('shipped', 'delivered', 'collected')
    ELSE false END;
  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'shop: an order that is % cannot become %', replace(o.status, '_', ' '), replace(coalesce(p_status, '?'), '_', ' ')
      USING ERRCODE = '55000';
  END IF;
  UPDATE public.shop_orders SET status = p_status,
         tracking = CASE WHEN p_status = 'shipped' THEN nullif(btrim(coalesce(p_note, '')), '') ELSE tracking END,
         delivered_at = CASE WHEN p_status IN ('delivered', 'collected') THEN now() ELSE delivered_at END,
         updated_at = now()
   WHERE id = p_order RETURNING * INTO o;
  PERFORM public.shop_event(p_order, 'order.' || p_status, jsonb_build_object('note', p_note));
  RETURN o;
END $$;


-- ── 8. Withdrawal, returns and refunds ──────────────────────────────────────
-- The lines asked for ([{line_id, quantity}]; empty: everything not yet
-- refunded), checked against the order.
CREATE OR REPLACE FUNCTION public.shop_pick_lines(p_order uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v jsonb;
BEGIN
  IF coalesce(jsonb_typeof(p_lines), 'null') <> 'array' OR coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines END), 0) = 0 THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('line_id', id, 'quantity', quantity - refunded_quantity) ORDER BY line_no), '[]'::jsonb)
      INTO v FROM public.shop_order_lines WHERE order_id = p_order AND quantity > refunded_quantity;
    RETURN v;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) e
               LEFT JOIN public.shop_order_lines l ON l.id = (e ->> 'line_id')::uuid AND l.order_id = p_order
              WHERE l.id IS NULL OR coalesce((e ->> 'quantity')::int, 0) < 1
                 OR (e ->> 'quantity')::int > l.quantity - l.refunded_quantity) THEN
    RAISE EXCEPTION 'shop: each line must be on the order, with a quantity not yet refunded' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('line_id', (e ->> 'line_id')::uuid, 'quantity', (e ->> 'quantity')::int)) INTO v
    FROM jsonb_array_elements(p_lines) e;
  RETURN v;
END $$;

-- The customer withdraws from the purchase (angrerettloven): from receipt
-- of the paid goods (or before) the form is recorded, with whether it came
-- within 14 days of delivery or collection. The company then handles it;
-- the right itself and its exceptions are the company's terms to state.
CREATE OR REPLACE FUNCTION public.request_shop_withdrawal(p_order uuid, p_lines jsonb, p_message text)
RETURNS public.shop_withdrawals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE; w public.shop_withdrawals%ROWTYPE; v_lines jsonb;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR o.customer_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'shop: no such order' USING ERRCODE = 'P0002'; END IF;
  IF o.status NOT IN ('paid', 'packed', 'shipped', 'ready_for_pickup', 'delivered', 'collected') THEN
    RAISE EXCEPTION 'shop: the order is %', replace(o.status, '_', ' ') USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shop_withdrawals WHERE order_id = p_order AND status IN ('requested', 'received')) THEN
    RAISE EXCEPTION 'shop: the shop is already handling a withdrawal for this order' USING ERRCODE = '55000';
  END IF;
  v_lines := public.shop_pick_lines(p_order, p_lines);
  IF jsonb_array_length(v_lines) = 0 THEN RAISE EXCEPTION 'shop: everything on the order is refunded' USING ERRCODE = '55000'; END IF;
  INSERT INTO public.shop_withdrawals (order_id, organization_id, customer_user_id, lines, message, within_period)
  VALUES (p_order, o.organization_id, o.customer_user_id, v_lines, nullif(btrim(coalesce(p_message, '')), ''),
          o.delivered_at IS NULL
          OR (now() AT TIME ZONE 'Europe/Oslo')::date <= (o.delivered_at AT TIME ZONE 'Europe/Oslo')::date + 14)
  RETURNING * INTO w;
  PERFORM public.shop_event(p_order, 'order.withdrawal', jsonb_build_object('lines', v_lines, 'within_period', w.within_period));
  RETURN w;
END $$;

-- The company: the goods came back ('received'), or the withdrawal is
-- refused with the reason ('rejected'). The refund is shop_refund_begin.
CREATE OR REPLACE FUNCTION public.handle_shop_withdrawal(p_id uuid, p_decision text, p_note text)
RETURNS public.shop_withdrawals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE w public.shop_withdrawals%ROWTYPE; o public.shop_orders%ROWTYPE;
BEGIN
  SELECT * INTO w FROM public.shop_withdrawals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such withdrawal' USING ERRCODE = 'P0002'; END IF;
  o := public.shop_order_for(w.order_id, ARRAY['staff']);
  IF p_decision NOT IN ('received', 'rejected') OR w.status <> 'requested' THEN
    RAISE EXCEPTION 'shop: a requested withdrawal is received or rejected' USING ERRCODE = '55000';
  END IF;
  IF p_decision = 'rejected' AND coalesce(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'shop: give the customer the reason' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_withdrawals SET status = p_decision, handled_by = auth.uid(), handled_at = now(),
         note = nullif(btrim(coalesce(p_note, '')), '')
   WHERE id = p_id RETURNING * INTO w;
  -- Everything not yet refunded has come back: the order is returned.
  IF p_decision = 'received' AND o.status IN ('shipped', 'delivered', 'collected')
     AND (SELECT sum((e ->> 'quantity')::int) FROM jsonb_array_elements(w.lines) e)
         >= (SELECT sum(quantity - refunded_quantity) FROM public.shop_order_lines WHERE order_id = o.id) THEN
    UPDATE public.shop_orders SET status = 'returned', updated_at = now() WHERE id = o.id;
  END IF;
  PERFORM public.shop_event(o.id, 'withdrawal.' || p_decision, jsonb_build_object('note', p_note));
  RETURN w;
END $$;

-- A refund by the company (owners, admins, finance): the lines and how
-- many, the delivery price too or not, whether the goods go back into
-- stock. The amount follows from the order, never from the browser. One
-- refund is live at a time; asking again while it is returns it, so the
-- retry uses the same idempotency key (shop-refund).
CREATE OR REPLACE FUNCTION public.shop_refund_begin(p_order uuid, p_lines jsonb, p_delivery boolean, p_restock boolean,
                                                    p_reason text, p_withdrawal uuid)
RETURNS public.shop_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE; r public.shop_refunds%ROWTYPE; v_lines jsonb; v_amount numeric; v_id uuid := gen_random_uuid();
BEGIN
  o := public.shop_order_for(p_order, ARRAY['finance']);
  SELECT * INTO r FROM public.shop_refunds WHERE order_id = p_order AND status IN ('requested', 'pending');
  IF FOUND THEN RETURN r; END IF;
  IF o.paid_at IS NULL OR o.payment_intent_id IS NULL THEN RAISE EXCEPTION 'shop: only a paid order is refunded' USING ERRCODE = '55000'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'shop: a refund needs a reason' USING ERRCODE = '22023'; END IF;
  IF p_withdrawal IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.shop_withdrawals WHERE id = p_withdrawal AND order_id = p_order) THEN
    RAISE EXCEPTION 'shop: the withdrawal is not for this order' USING ERRCODE = '22023';
  END IF;
  -- No lines given: everything not yet refunded; an empty list: none (the
  -- delivery price alone).
  v_lines := public.shop_pick_lines(p_order, p_lines);
  IF jsonb_typeof(p_lines) = 'array' THEN
    IF jsonb_array_length(p_lines) = 0 THEN v_lines := '[]'::jsonb; END IF;
  END IF;
  SELECT coalesce(sum(l.unit_price * (e ->> 'quantity')::int), 0) INTO v_amount
    FROM jsonb_array_elements(v_lines) e JOIN public.shop_order_lines l ON l.id = (e ->> 'line_id')::uuid;
  IF coalesce(p_delivery, false) AND NOT o.delivery_refunded THEN v_amount := v_amount + o.delivery_price; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'shop: nothing to refund' USING ERRCODE = '22023'; END IF;
  IF v_amount > o.paid_amount - o.refunded_amount THEN
    RAISE EXCEPTION 'shop: % kr is more than the % kr still paid', v_amount, o.paid_amount - o.refunded_amount USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shop_refunds (id, order_id, withdrawal_id, amount, lines, delivery, restock, reason, idempotency_key, requested_by)
  VALUES (v_id, p_order, p_withdrawal, v_amount, v_lines, coalesce(p_delivery, false) AND NOT o.delivery_refunded,
          coalesce(p_restock, false), btrim(p_reason), 'flyttgo-shop-refund-' || v_id, auth.uid())
  RETURNING * INTO r;
  PERFORM public.shop_event(p_order, 'refund.requested', jsonb_build_object('amount', v_amount, 'reason', p_reason));
  RETURN r;
END $$;

-- The credit note for a refund, line by line at each line's MVA rate, in
-- the receipt's series and to the same buyer (as create_credit_note, 00011).
CREATE OR REPLACE FUNCTION public.shop_credit_note(p_refund uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.shop_refunds%ROWTYPE; o public.shop_orders%ROWTYPE; v_inv public.invoices%ROWTYPE; v_cn public.invoices%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.shop_refunds WHERE id = p_refund;
  SELECT * INTO o FROM public.shop_orders WHERE id = r.order_id;
  SELECT * INTO v_inv FROM public.invoices WHERE id = o.invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: the order has no receipt to credit' USING ERRCODE = '55000'; END IF;
  INSERT INTO public.invoices (kind, credits_invoice_id, organization_id, issuer_org, series, customer_user_id, buyer,
                               notes, reference, delivery_from, delivery_to, source_type, source_id, created_by)
  VALUES ('credit_note', v_inv.id, v_inv.organization_id, v_inv.issuer_org, v_inv.series, v_inv.customer_user_id, v_inv.buyer,
          'Credit note for invoice ' || v_inv.number || ': ' || r.reason, v_inv.reference, v_inv.delivery_from, v_inv.delivery_to,
          'shop_order', o.id, auth.uid())
  RETURNING * INTO v_cn;
  INSERT INTO public.invoice_lines (invoice_id, line_no, is_credit, description, quantity, unit_price, vat_rate, net_amount, vat_amount, total)
  SELECT v_cn.id, row_number() OVER (ORDER BY x.ord), true, x.description, x.quantity,
         -round(round(x.gross / (1 + x.rate / 100), 2) / x.quantity, 4), x.rate,
         -round(x.gross / (1 + x.rate / 100), 2), -(x.gross - round(x.gross / (1 + x.rate / 100), 2)), -x.gross
    FROM (SELECT l.line_no AS ord, 'Return: ' || l.name AS description, (e ->> 'quantity')::int AS quantity,
                 l.unit_price * (e ->> 'quantity')::int AS gross, l.vat_rate AS rate
            FROM jsonb_array_elements(r.lines) e JOIN public.shop_order_lines l ON l.id = (e ->> 'line_id')::uuid
          UNION ALL
          SELECT 100000, CASE o.delivery_method WHEN 'shipping' THEN 'Return: delivery' ELSE 'Return: pickup' END, 1,
                 o.delivery_price, o.delivery_vat_rate
           WHERE r.delivery AND o.delivery_price > 0) x;
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_cn.id),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_cn.id),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_cn.id)
   WHERE id = v_cn.id;
  PERFORM public.invoice_event(v_inv.id, 'invoice.credited', jsonb_build_object('reason', r.reason, 'amount', r.amount, 'shop_refund', r.id));
  RETURN public.issue_invoice(v_cn.id);
END $$;

-- What Stripe reported for a refund (shop-refund, stripe-webhook; the
-- server). On the first 'succeeded', once: the lines and the order are
-- marked refunded, the goods go back into stock when asked, the
-- withdrawal is closed and the receipt credited. 'succeeded' and 'failed'
-- are final.
CREATE OR REPLACE FUNCTION public.shop_refund_mark(p_refund uuid, p_status text, p_provider_refund_id text, p_error text)
RETURNS public.shop_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.shop_refunds%ROWTYPE; o public.shop_orders%ROWTYPE; e jsonb; l public.shop_order_lines%ROWTYPE;
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'shop: the server only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.shop_refunds WHERE id = p_refund FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such refund' USING ERRCODE = 'P0002'; END IF;
  IF r.status IN ('succeeded', 'failed') OR p_status NOT IN ('requested', 'pending', 'succeeded', 'failed') THEN RETURN r; END IF;
  IF p_status IN ('requested', 'pending') THEN
    UPDATE public.shop_refunds SET status = p_status, provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
           error = p_error, updated_at = now()
     WHERE id = p_refund RETURNING * INTO r;
    RETURN r;
  END IF;
  IF p_status = 'failed' THEN
    UPDATE public.shop_refunds SET status = 'failed', provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
           error = left(coalesce(p_error, 'failed'), 500), updated_at = now()
     WHERE id = p_refund RETURNING * INTO r;
    PERFORM public.shop_event(r.order_id, 'refund.failed', jsonb_build_object('amount', r.amount, 'error', p_error));
    RETURN r;
  END IF;

  SELECT * INTO o FROM public.shop_orders WHERE id = r.order_id FOR UPDATE;
  FOR e IN SELECT * FROM jsonb_array_elements(r.lines) LOOP
    UPDATE public.shop_order_lines SET refunded_quantity = refunded_quantity + (e ->> 'quantity')::int
     WHERE id = (e ->> 'line_id')::uuid RETURNING * INTO l;
  END LOOP;
  IF r.restock THEN
    PERFORM public.shop_lock_items(
      ARRAY(SELECT ol.product_id FROM jsonb_array_elements(r.lines) x JOIN public.shop_order_lines ol ON ol.id = (x ->> 'line_id')::uuid),
      ARRAY(SELECT ol.variant_id FROM jsonb_array_elements(r.lines) x JOIN public.shop_order_lines ol ON ol.id = (x ->> 'line_id')::uuid
             WHERE ol.variant_id IS NOT NULL));
    FOR e IN SELECT * FROM jsonb_array_elements(r.lines) LOOP
      SELECT * INTO l FROM public.shop_order_lines WHERE id = (e ->> 'line_id')::uuid;
      IF l.variant_id IS NOT NULL THEN
        UPDATE public.shop_variants v SET stock = v.stock + (e ->> 'quantity')::int
          FROM public.shop_products p WHERE v.id = l.variant_id AND p.id = v.product_id AND p.track_stock;
      ELSE
        UPDATE public.shop_products SET stock = stock + (e ->> 'quantity')::int, updated_at = now() WHERE id = l.product_id AND track_stock;
      END IF;
    END LOOP;
  END IF;
  UPDATE public.shop_orders SET refunded_amount = refunded_amount + r.amount, delivery_refunded = delivery_refunded OR r.delivery,
         status = CASE WHEN refunded_amount + r.amount >= paid_amount THEN 'refunded' ELSE status END, updated_at = now()
   WHERE id = o.id;
  UPDATE public.shop_withdrawals SET status = 'refunded', handled_at = coalesce(handled_at, now()) WHERE id = r.withdrawal_id;
  UPDATE public.shop_refunds SET status = 'succeeded', provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
         error = NULL, updated_at = now()
   WHERE id = p_refund RETURNING * INTO r;
  PERFORM public.shop_event(o.id, 'refund.succeeded', jsonb_build_object('amount', r.amount, 'provider_refund_id', r.provider_refund_id));
  -- The credit note. Without a receipt (or should it fail) the refund
  -- stands and the error is kept; the company credits it by hand.
  BEGIN
    UPDATE public.shop_refunds SET credit_note_id = (public.shop_credit_note(p_refund)).id WHERE id = p_refund RETURNING * INTO r;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.shop_refunds SET error = left('credit note: ' || SQLERRM, 500) WHERE id = p_refund RETURNING * INTO r;
  END;
  RETURN r;
END $$;


-- ── 9. Who may call what ────────────────────────────────────────────────────
-- Internal: called only by the functions above.
REVOKE ALL ON FUNCTION
  public.shop_event(uuid, text, jsonb), public.shop_check_vat(uuid, numeric), public.shop_lock_items(uuid[], uuid[]),
  public.shop_compute(uuid, jsonb, text), public.shop_release_stock(uuid), public.shop_expire(uuid, uuid[], uuid[]),
  public.shop_order_for(uuid, text[]), public.shop_invoice(uuid), public.shop_pick_lines(uuid, jsonb),
  public.shop_credit_note(uuid)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.can_read_shop_order(uuid), public.save_shop_settings(uuid, jsonb), public.save_shop_product(uuid, uuid, jsonb),
  public.save_shop_variant(uuid, uuid, jsonb), public.set_shop_stock(uuid, uuid, integer), public.shop_quote(uuid, jsonb, text),
  public.place_shop_order(uuid, jsonb, text, jsonb, jsonb), public.cancel_shop_order(uuid, text),
  public.shop_checkout_begin(uuid), public.invoice_shop_order(uuid), public.set_shop_order_status(uuid, text, text),
  public.request_shop_withdrawal(uuid, jsonb, text), public.handle_shop_withdrawal(uuid, text, text),
  public.shop_refund_begin(uuid, jsonb, boolean, boolean, text, uuid),
  public.expire_shop_orders(), public.record_shop_payment(uuid, numeric, text, text, text),
  public.mark_shop_confirmation_sent(uuid), public.shop_refund_mark(uuid, text, text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.can_read_shop_order(uuid), public.save_shop_settings(uuid, jsonb), public.save_shop_product(uuid, uuid, jsonb),
  public.save_shop_variant(uuid, uuid, jsonb), public.set_shop_stock(uuid, uuid, integer), public.shop_quote(uuid, jsonb, text),
  public.place_shop_order(uuid, jsonb, text, jsonb, jsonb), public.cancel_shop_order(uuid, text),
  public.shop_checkout_begin(uuid), public.invoice_shop_order(uuid), public.set_shop_order_status(uuid, text, text),
  public.request_shop_withdrawal(uuid, jsonb, text), public.handle_shop_withdrawal(uuid, text, text),
  public.shop_refund_begin(uuid, jsonb, boolean, boolean, text, uuid)
TO authenticated, service_role;
-- The server's: payments, refunds' outcomes, expiry, confirmations.
REVOKE ALL ON FUNCTION public.expire_shop_orders(), public.record_shop_payment(uuid, numeric, text, text, text),
  public.mark_shop_confirmation_sent(uuid), public.shop_refund_mark(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_shop_orders(), public.record_shop_payment(uuid, numeric, text, text, text),
  public.mark_shop_confirmation_sent(uuid), public.shop_refund_mark(uuid, text, text, text) TO service_role;
-- Visitors see what a cart costs before signing in.
GRANT EXECUTE ON FUNCTION public.shop_quote(uuid, jsonb, text) TO anon;

-- ============================================================================
-- DONE
-- ============================================================================

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261030160020', '00020_shop')
ON CONFLICT (version) DO NOTHING;

-- ===== 00022_pilot_addons.sql =====
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

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261030160022', '00022_pilot_addons')
ON CONFLICT (version) DO NOTHING;

-- ===== 00026_contact_messages.sql =====
-- ============================================================================
-- FlyttGo — inbound messages from the public forms, and FlyttGo's public
-- business details
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00025. The owner's decision of
-- 2026-10-30 on the platform audit (docs/PLATFORM_AUDIT_2026-10-30.md,
-- "Contact and corporate sales forms are stubs"; "Placeholder legal
-- identity"):
--
-- 1. contact_messages: what visitors send from the contact page, the
--    corporate quote form and the newsletter sign-up in the footer. Until
--    now those forms said "sent" and sent nothing. Visitors (signed in or
--    not) write only through submit_contact_message(), which checks every
--    field, limits lengths and refuses more than 5 messages from one email
--    address in an hour (and more than 300 from everyone in 10 minutes, so
--    random addresses cannot flood the table). Nobody writes to the table
--    directly. FlyttGo administrators (is_admin()) read the messages under
--    Admin → Inbox and mark them handled or new again
--    (admin_set_contact_message_status()); nobody else can read them.
--    No email is sent yet: that waits for Resend (docs/CONTACT_INBOX.md).
--
-- 2. flyttgo_public_identity(): the public business fields of the seller
--    the invoices state (00008: invoice_seller_* in platform_config, set
--    under Admin → Invoicing → Invoice settings): legal name, organisation
--    number, MVA status, address, email and phone. Never the bank account,
--    IBAN or BIC, and no other setting. The footer, header and contact page
--    show each line only once it is filled in.
--
-- Safe to re-run. Rolled back by supabase/rollback/00026_down.sql.
-- ============================================================================

-- ── 1. Inbound messages ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text        NOT NULL CHECK (source IN ('contact', 'corporate', 'newsletter')),
  topic       text        CHECK (char_length(topic) <= 200),
  name        text        CHECK (char_length(name) <= 120),
  email       text        NOT NULL CHECK (char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone       text        CHECK (char_length(phone) <= 40),
  company     text        CHECK (char_length(company) <= 200),
  message     text        CHECK (char_length(message) <= 5000),
  status      text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled')),
  handled_by  uuid,
  handled_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'handled') = (handled_by IS NOT NULL AND handled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS contact_messages_email_recent ON public.contact_messages (lower(email), created_at);
CREATE INDEX IF NOT EXISTS contact_messages_status ON public.contact_messages (status, created_at DESC);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_messages_admin_read ON public.contact_messages;
CREATE POLICY contact_messages_admin_read ON public.contact_messages FOR SELECT TO authenticated USING (public.is_admin());
-- No direct writes for anyone: submitting and marking go through the
-- functions below.
REVOKE ALL ON public.contact_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contact_messages TO authenticated;
GRANT ALL ON public.contact_messages TO service_role;


-- ── 2. Submitting a message (anyone) ────────────────────────────────────────
-- contact:    name, email and message required
-- corporate:  company and email required
-- newsletter: email only (name, company and message ignored)
-- Returns the new message's id. Text is trimmed; empty optional fields are
-- stored as NULL.
CREATE OR REPLACE FUNCTION public.submit_contact_message(
  p_source text, p_name text, p_email text, p_phone text, p_company text, p_topic text, p_message text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_source  text := lower(btrim(coalesce(p_source, '')));
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_phone   text := nullif(btrim(coalesce(p_phone, '')), '');
  v_company text := nullif(btrim(coalesce(p_company, '')), '');
  v_topic   text := nullif(btrim(coalesce(p_topic, '')), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_id      uuid;
BEGIN
  IF v_source NOT IN ('contact', 'corporate', 'newsletter') THEN
    RAISE EXCEPTION 'contact: unknown form' USING ERRCODE = '22023';
  END IF;
  IF v_email = '' OR char_length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'contact: enter a valid email address' USING ERRCODE = '22023';
  END IF;
  IF v_source = 'newsletter' THEN
    v_name := NULL; v_company := NULL; v_phone := NULL;
    v_topic := 'Newsletter sign-up'; v_message := NULL;
  END IF;
  IF v_source = 'contact' AND (v_name IS NULL OR v_message IS NULL) THEN
    RAISE EXCEPTION 'contact: name, email and message are required' USING ERRCODE = '22023';
  END IF;
  IF v_source = 'corporate' AND v_company IS NULL THEN
    RAISE EXCEPTION 'contact: company name and email are required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) > 120 THEN RAISE EXCEPTION 'contact: the name is too long (120 characters at most)' USING ERRCODE = '22023'; END IF;
  IF char_length(v_company) > 200 THEN RAISE EXCEPTION 'contact: the company name is too long (200 characters at most)' USING ERRCODE = '22023'; END IF;
  IF char_length(v_topic) > 200 THEN RAISE EXCEPTION 'contact: the subject is too long (200 characters at most)' USING ERRCODE = '22023'; END IF;
  IF char_length(v_message) > 5000 THEN RAISE EXCEPTION 'contact: the message is too long (5000 characters at most)' USING ERRCODE = '22023'; END IF;
  IF char_length(v_phone) > 40 OR v_phone !~ '^[0-9+() .-]+$' THEN
    RAISE EXCEPTION 'contact: enter a valid phone number, or leave it empty' USING ERRCODE = '22023';
  END IF;

  -- Rate limits. The lock makes concurrent submissions count each other.
  PERFORM pg_advisory_xact_lock(hashtext('flyttgo.contact_messages'));
  IF (SELECT count(*) FROM public.contact_messages
       WHERE lower(email) = v_email AND created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'contact: too many messages from this email address; please try again in an hour' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.contact_messages WHERE created_at > now() - interval '10 minutes') >= 300 THEN
    RAISE EXCEPTION 'contact: too many messages right now; please try again later' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.contact_messages (source, topic, name, email, phone, company, message)
  VALUES (v_source, v_topic, v_name, v_email, v_phone, v_company, v_message)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;


-- ── 3. Marking a message handled (administrators) ───────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_contact_message_status(p_id uuid, p_status text)
RETURNS public.contact_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.contact_messages%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'contact: FlyttGo administrators only' USING ERRCODE = '42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('new', 'handled') THEN
    RAISE EXCEPTION 'contact: new or handled' USING ERRCODE = '22023';
  END IF;
  UPDATE public.contact_messages
     SET status = p_status,
         handled_by = CASE WHEN p_status = 'handled' THEN auth.uid() END,
         handled_at = CASE WHEN p_status = 'handled' THEN now() END
   WHERE id = p_id
  RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact: no such message' USING ERRCODE = 'P0002'; END IF;
  RETURN r;
END $$;


-- ── 4. FlyttGo's public business details ────────────────────────────────────
-- Only these fields of the invoice seller (00008), each NULL while empty.
CREATE OR REPLACE FUNCTION public.flyttgo_public_identity()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'name',           public.config_text('invoice_seller_name'),
    'org_number',     public.config_text('invoice_seller_org_number'),
    'vat_registered', coalesce(public.config_text('invoice_seller_vat_registered'), 'true') = 'true',
    'address',        public.config_text('invoice_seller_address'),
    'postcode_city',  public.config_text('invoice_seller_postcode_city'),
    'email',          public.config_text('invoice_seller_email'),
    'phone',          public.config_text('invoice_seller_phone'));
$$;


-- ── 5. Who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.submit_contact_message(text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_contact_message_status(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.flyttgo_public_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_contact_message(text, text, text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_contact_message_status(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.flyttgo_public_identity() TO anon, authenticated, service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261030160026', '00026_contact_messages')
ON CONFLICT (version) DO NOTHING;


-- ===== The two jobs these migrations need (as supabase/ops/schedules.sql) =====
-- Production has pg_cron with the other four jobs; scheduling by name
-- replaces a job of the same name, never doubles it.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron is not enabled: run supabase/ops/schedules.sql once it is';
    RETURN;
  END IF;
  PERFORM cron.schedule('flyttgo-shop-expiry', '*/5 * * * *', $j$ SELECT public.expire_shop_orders() $j$);
  PERFORM cron.schedule('flyttgo-approval-expiry', '*/15 * * * *', $j$ SELECT public.expire_booking_approvals(NULL) $j$);
END $$;

COMMIT;
