-- ============================================================================
-- Release rehearsal: a fingerprint of the financial records (invoices of
-- both series, their lines, payments, reminders and log, credit notes,
-- payment events and refunds, bank imports and their rows once 00016 is
-- in), to compare before and after the migrations and the rollback. Every
-- column of every row is in it: nothing may change.
-- ============================================================================
CREATE OR REPLACE FUNCTION tests.rh_fin_rows()
RETURNS TABLE (tbl text, n bigint, digest text) LANGUAGE plpgsql STABLE AS $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices', 'invoice_lines', 'invoice_payments', 'invoice_reminders', 'invoice_events',
                           'payment_events', 'payment_refunds', 'bank_imports', 'bank_import_rows'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    tbl := t;
    EXECUTE format('SELECT count(*), coalesce(md5(string_agg(to_jsonb(x)::text, %L ORDER BY to_jsonb(x)::text)), %L) FROM public.%I x',
                   E'\n', '-', t) INTO n, digest;
    RETURN NEXT;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION tests.rh_fin_rows() TO service_role;
