-- ============================================================================
-- Roll back 00014_accounting_core.sql
-- ============================================================================
-- Run after 00015_down.sql.
--
-- THE BOOKS ARE NEVER DELETED. Vouchers, receipts and their logs are
-- accounting records that must be kept for 5 years (bokføringsloven § 13).
-- If any ledger exists, the schema is set aside as
-- accounting_retained_<time>, closed to every client role, with all its
-- data; export each company's books from it (SAF-T, PDF) before deciding
-- anything else. Only an empty schema is dropped. Receipt files stay in
-- the bucket; the bucket is removed only when empty.
-- ============================================================================

DROP POLICY IF EXISTS accounting_attachments_read ON storage.objects;
DROP POLICY IF EXISTS accounting_attachments_upload ON storage.objects;
DELETE FROM storage.buckets b WHERE b.id = 'ledger-attachments'
   AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = b.id);

DO $$
DECLARE v_name text := 'accounting_retained_' || to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS');
BEGIN
  IF to_regnamespace('accounting') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting.ledgers) THEN
    EXECUTE format('ALTER SCHEMA accounting RENAME TO %I', v_name);
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC, anon, authenticated', v_name);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC, anon, authenticated', v_name);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC, anon, authenticated', v_name);
    RAISE NOTICE 'accounting: the books were kept in schema %, closed to clients', v_name;
  ELSE
    DROP SCHEMA accounting CASCADE;
  END IF;
END $$;
