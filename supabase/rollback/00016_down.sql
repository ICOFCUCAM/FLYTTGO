-- ============================================================================
-- Roll back 00016_bank_import.sql
-- ============================================================================
-- Run first (before 00015_down.sql). Tested by run.sh: afterwards the
-- schema is exactly as before 00016.
--
-- DATA LOSS — READ FIRST. The record of imported bank files and their rows
-- (what matched, what was left open and how it was resolved) is part of the
-- payments' audit trail: the rollback stops while any import exists. The
-- payments themselves are invoice_payments (00008) and stay either way.
-- To roll back anyway, save the records first, for example
--   \copy (SELECT * FROM public.bank_imports) TO 'bank_imports.csv' CSV HEADER
--   \copy (SELECT * FROM public.bank_import_rows) TO 'bank_import_rows.csv' CSV HEADER
-- and then empty them (TRUNCATE public.bank_import_rows, public.bank_imports).
-- The bank import settings are dropped.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.bank_imports') IS NOT NULL AND EXISTS (SELECT 1 FROM public.bank_imports) THEN
    RAISE EXCEPTION 'bank imports are recorded: save them first (see the top of this file); the payments stay';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.resolve_bank_import_row(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.import_bank_file(uuid, text, text, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.preview_bank_import(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.bank_import_check(text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.bank_row_outcome(text, text, jsonb, text[], jsonb);
DROP FUNCTION IF EXISTS public.bank_row_clean(jsonb, integer);
DROP FUNCTION IF EXISTS public.set_bank_import_settings(uuid, jsonb);
DROP TABLE IF EXISTS public.bank_import_rows;
DROP TABLE IF EXISTS public.bank_imports;
DROP TABLE IF EXISTS public.bank_import_settings;
DROP FUNCTION IF EXISTS public.can_read_bank_import(uuid);
DROP FUNCTION IF EXISTS public.require_bank_importer(uuid);
DROP FUNCTION IF EXISTS public.bank_import_series(uuid);
DROP FUNCTION IF EXISTS public.guard_bank_import_row();

-- ============================================================================
-- DONE
-- ============================================================================
