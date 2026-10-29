-- ============================================================================
-- Roll back 00009_white_label.sql
-- ============================================================================
-- Run first (before 00008_down.sql). Tested by run.sh: afterwards the
-- schema is exactly as before 00009.
--
-- DATA LOSS — READ FIRST. This drops the website template library (the
-- importer can load it again), the white-label plans and prices,
-- every company's set-up (brand, domain, Stripe account link, accepted
-- data processing agreement) and the record of which plan fees and
-- bookings were charged. Export them first. Invoices already issued for
-- plans stay (they are FlyttGo's accounting records); payments recorded
-- as 'platform_fee' are kept as 'other', with the method in the
-- reference. Bookings made on company pages lose the page and seller;
-- for Model B the company's customers paid the company, so keep
-- a list of those bookings (seller_model = 'company') before running this.
-- ============================================================================

DROP FUNCTION IF EXISTS public.settle_white_label_invoice(uuid);
DROP FUNCTION IF EXISTS public.create_white_label_invoice(uuid, date);
DROP FUNCTION IF EXISTS public.white_label_line(uuid, text, numeric, uuid);
DROP TABLE IF EXISTS public.white_label_charges;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_payments_method_check'
               AND pg_get_constraintdef(oid) LIKE '%platform_fee%') THEN
    ALTER TABLE public.invoice_payments DISABLE TRIGGER guard_invoice_payments;
    UPDATE public.invoice_payments SET method = 'other', reference = 'platform_fee: ' || coalesce(reference, '')
     WHERE method = 'platform_fee';
    ALTER TABLE public.invoice_payments ENABLE TRIGGER guard_invoice_payments;
    ALTER TABLE public.invoice_payments DROP CONSTRAINT invoice_payments_method_check;
    ALTER TABLE public.invoice_payments ADD CONSTRAINT invoice_payments_method_check
      CHECK (method IN ('bank', 'card', 'vipps', 'other'));
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.white_label_stats(uuid);
DROP FUNCTION IF EXISTS public.white_label_public(text, text);
DROP FUNCTION IF EXISTS public.admin_update_white_label_plan(text, numeric, numeric, numeric, numeric, boolean, boolean);
DROP FUNCTION IF EXISTS public.admin_set_white_label_status(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_decide_white_label(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.end_white_label(uuid, text);
DROP FUNCTION IF EXISTS public.set_white_label_stripe_account(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.accept_white_label_dpa(uuid, text);
DROP FUNCTION IF EXISTS public.mark_white_label_domain_verified(uuid, text);
DROP FUNCTION IF EXISTS public.set_white_label_site(uuid, text, text);
DROP FUNCTION IF EXISTS public.set_white_label_domain(uuid, text);
DROP FUNCTION IF EXISTS public.set_white_label_brand(uuid, text, text, text, text, text, text, text, text, numeric);
DROP FUNCTION IF EXISTS public.request_white_label(uuid, text);
DROP FUNCTION IF EXISTS public.white_label_missing(uuid, text);
DROP FUNCTION IF EXISTS public.white_label_event(uuid, text, jsonb);

DROP POLICY IF EXISTS bookings_white_label_select ON public.bookings;
DROP TRIGGER IF EXISTS guard_booking_white_label ON public.bookings;
DROP FUNCTION IF EXISTS public.guard_booking_white_label();
ALTER TABLE public.bookings
  DROP COLUMN IF EXISTS connected_account_id,
  DROP COLUMN IF EXISTS platform_fee,
  DROP COLUMN IF EXISTS customer_price,
  DROP COLUMN IF EXISTS seller_model,
  DROP COLUMN IF EXISTS white_label_org;

DROP TABLE IF EXISTS public.organization_white_label;
DROP TABLE IF EXISTS public.white_label_plans;

DROP FUNCTION IF EXISTS public.admin_review_site_template(text, boolean, boolean, text);
DROP FUNCTION IF EXISTS public.admin_update_site_template_page(text, text, text);
DROP FUNCTION IF EXISTS public.import_site_template(jsonb);
DROP FUNCTION IF EXISTS public.site_template_price_hits(text);
DROP FUNCTION IF EXISTS public.site_template_html_problems(text);
DROP TABLE IF EXISTS public.site_templates;
-- Template images stay in storage; the bucket is removed only when empty.
DELETE FROM storage.buckets b WHERE b.id = 'site-template-assets'
   AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = b.id);

DELETE FROM public.platform_config
 WHERE config_key IN ('white_label_dpa_version', 'white_label_support_email', 'white_label_support_phone');

-- ============================================================================
-- DONE
-- ============================================================================
