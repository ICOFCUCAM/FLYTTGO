-- ============================================================================
-- Roll back 00008_invoicing.sql
-- ============================================================================
-- Run first (before 00007_down.sql). Tested by run.sh: afterwards the
-- schema is exactly as before 00008.
--
-- DATA LOSS — READ FIRST. This drops the invoice ledger: invoices, credit
-- notes, lines, payments, reminders, the invoice log and credit checks,
-- and the companies' billing terms, invoicing switches, credit limits,
-- plans and customer numbers. Issued invoices are accounting records that
-- must be kept (bokføringsloven: 5 years): EXPORT THEM (Admin → Invoicing
-- → CSV export, and the PDFs) BEFORE running this on a database where
-- any invoice was issued. Bookings paid on invoice keep
-- payment_provider = 'invoice'. Uploaded logos stay in storage; the
-- bucket is removed only when empty.
-- ============================================================================

DROP FUNCTION IF EXISTS public.uninvoiced_bookings(date);
DROP FUNCTION IF EXISTS public.book_on_invoice(uuid, uuid);
DROP FUNCTION IF EXISTS public.company_open_exposure(uuid);
DROP FUNCTION IF EXISTS public.mark_invoice_sent(uuid, text);
DROP FUNCTION IF EXISTS public.record_invoice_reminder(uuid);
DROP FUNCTION IF EXISTS public.record_payment_by_kid(text, numeric, date, text);
DROP FUNCTION IF EXISTS public.record_invoice_payment(uuid, numeric, date, text, text);
DROP FUNCTION IF EXISTS public.create_credit_note(uuid, numeric, text);
DROP FUNCTION IF EXISTS public.delete_invoice_draft(uuid);
DROP FUNCTION IF EXISTS public.invoice_settle_status(uuid);
DROP FUNCTION IF EXISTS public.issue_invoice(uuid);
DROP FUNCTION IF EXISTS public.invoice_seller();
DROP FUNCTION IF EXISTS public.add_invoice_line(uuid, text, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.create_invoice_draft(uuid, uuid[], numeric[], text);
DROP FUNCTION IF EXISTS public.booking_invoice_amount(uuid);
DROP FUNCTION IF EXISTS public.require_billing_operator();
DROP FUNCTION IF EXISTS public.invoice_due_date(date, text, integer, integer);
DROP FUNCTION IF EXISTS public.kid_mod10(text);
DROP FUNCTION IF EXISTS public.invoice_event(uuid, text, jsonb);

DO $$ BEGIN
  IF to_regclass('public.invoices') IS NOT NULL THEN
    DROP FUNCTION IF EXISTS public.invoice_outstanding(public.invoices);
  END IF;
END $$;
DROP TABLE IF EXISTS public.invoice_events;
DROP TABLE IF EXISTS public.invoice_reminders;
DROP TABLE IF EXISTS public.invoice_payments;
DROP TABLE IF EXISTS public.invoice_lines;
DROP TABLE IF EXISTS public.invoices;
DROP FUNCTION IF EXISTS public.can_read_invoice(uuid);
DROP TABLE IF EXISTS public.invoice_counters;
DROP FUNCTION IF EXISTS public.guard_invoice_write();
DROP FUNCTION IF EXISTS public.guard_invoice_line_write();
DROP FUNCTION IF EXISTS public.guard_append_only();

DROP FUNCTION IF EXISTS public.record_credit_check(uuid, text, boolean, text, numeric, jsonb);
DROP FUNCTION IF EXISTS public.has_current_credit_check(uuid);
DROP TABLE IF EXISTS public.credit_checks;

DROP POLICY IF EXISTS organization_logos_read ON storage.objects;
DROP POLICY IF EXISTS organization_logos_write ON storage.objects;
DROP POLICY IF EXISTS organization_logos_update ON storage.objects;
DROP POLICY IF EXISTS organization_logos_delete ON storage.objects;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'organization-logos') THEN
    RAISE NOTICE 'storage bucket organization-logos still holds logos; it is kept';
  ELSE
    DELETE FROM storage.buckets WHERE id = 'organization-logos';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.set_organization_logo(uuid, text);
DROP FUNCTION IF EXISTS public.org_folder_member(text, text[]);
DROP FUNCTION IF EXISTS public.admin_set_invoicing(uuid, boolean, numeric, text);
DROP FUNCTION IF EXISTS public.set_billing_preferences(uuid, text, integer, integer, text, text);

DROP INDEX IF EXISTS public.organizations_customer_number_key;
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_billing_terms_check;
ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS payment_terms_type,
  DROP COLUMN IF EXISTS payment_terms_days,
  DROP COLUMN IF EXISTS payment_terms_day,
  DROP COLUMN IF EXISTS invoice_cycle,
  DROP COLUMN IF EXISTS invoice_reference,
  DROP COLUMN IF EXISTS invoicing_enabled,
  DROP COLUMN IF EXISTS credit_limit,
  DROP COLUMN IF EXISTS billing_plan,
  DROP COLUMN IF EXISTS logo_path,
  DROP COLUMN IF EXISTS customer_number;
DROP SEQUENCE IF EXISTS public.organization_customer_number_seq;
DROP FUNCTION IF EXISTS public.config_text(text);

DELETE FROM public.platform_config WHERE config_key IN (
  'invoice_seller_name', 'invoice_seller_org_number', 'invoice_seller_vat_registered', 'invoice_seller_address',
  'invoice_seller_postcode_city', 'invoice_seller_email', 'invoice_seller_phone', 'invoice_seller_bank_account',
  'invoice_seller_iban', 'invoice_seller_bic', 'invoice_reminder_after_days', 'invoice_reminder_fee',
  'invoice_late_interest_pct', 'credit_check_enabled', 'credit_check_max_age_days', 'credit_check_provider');
