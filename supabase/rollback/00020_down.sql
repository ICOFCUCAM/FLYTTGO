-- ============================================================================
-- Roll back 00020_shop.sql
-- ============================================================================
-- Run first (before the rollbacks of earlier migrations). Tested by run.sh:
-- afterwards the schema is exactly as before 00020.
--
-- DATA LOSS — READ FIRST. Drops the companies' catalogues, stock, orders,
-- withdrawals, refunds and their logs. Orders are the companies' records
-- of sales to consumers (and the evidence of a withdrawal): export them to
-- each company first. A company on the plan Online shop must be moved to
-- another plan first (the rollback stops otherwise). Receipts and credit
-- notes made from orders stay (00011); their source is then no longer an
-- allowed value, so the check is put back NOT VALID while any exists.
-- Product pictures stay in storage; the bucket is removed only when empty.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.organization_white_label') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.organization_white_label WHERE plan_code = 'shop' OR requested_plan_code = 'shop') THEN
    RAISE EXCEPTION 'companies are on the plan this rollback removes (Online shop): move them to another plan first';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.shop_refund_mark(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.shop_credit_note(uuid);
DROP FUNCTION IF EXISTS public.shop_refund_begin(uuid, jsonb, boolean, boolean, text, uuid);
DROP FUNCTION IF EXISTS public.handle_shop_withdrawal(uuid, text, text);
DROP FUNCTION IF EXISTS public.request_shop_withdrawal(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.shop_pick_lines(uuid, jsonb);
DROP FUNCTION IF EXISTS public.set_shop_order_status(uuid, text, text);
DROP FUNCTION IF EXISTS public.mark_shop_confirmation_sent(uuid);
DROP FUNCTION IF EXISTS public.record_shop_payment(uuid, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.invoice_shop_order(uuid);
DROP FUNCTION IF EXISTS public.shop_invoice(uuid);
DROP FUNCTION IF EXISTS public.shop_checkout_begin(uuid);
DROP FUNCTION IF EXISTS public.cancel_shop_order(uuid, text);
DROP FUNCTION IF EXISTS public.shop_order_for(uuid, text[]);
DROP FUNCTION IF EXISTS public.place_shop_order(uuid, jsonb, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.expire_shop_orders();
DROP FUNCTION IF EXISTS public.shop_expire(uuid, uuid[], uuid[]);
DROP FUNCTION IF EXISTS public.shop_release_stock(uuid);
DROP FUNCTION IF EXISTS public.shop_quote(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.shop_compute(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.shop_lock_items(uuid[], uuid[]);
DROP FUNCTION IF EXISTS public.set_shop_stock(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.save_shop_variant(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.save_shop_product(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.shop_check_vat(uuid, numeric);
DROP FUNCTION IF EXISTS public.save_shop_settings(uuid, jsonb);
DROP FUNCTION IF EXISTS public.shop_event(uuid, text, jsonb);
DROP TABLE IF EXISTS public.shop_refunds;
DROP TABLE IF EXISTS public.shop_withdrawals;
DROP TABLE IF EXISTS public.shop_order_events;
DROP TABLE IF EXISTS public.shop_order_lines;
DROP TABLE IF EXISTS public.shop_orders;
DROP FUNCTION IF EXISTS public.can_read_shop_order(uuid);
DROP TABLE IF EXISTS public.shop_variants;
DROP TABLE IF EXISTS public.shop_products;
DROP TABLE IF EXISTS public.shop_settings;

DROP POLICY IF EXISTS shop_product_images_read ON storage.objects;
DROP POLICY IF EXISTS shop_product_images_write ON storage.objects;
DROP POLICY IF EXISTS shop_product_images_update ON storage.objects;
DROP POLICY IF EXISTS shop_product_images_delete ON storage.objects;
DELETE FROM storage.buckets b WHERE b.id = 'shop-product-images'
   AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = b.id);

DELETE FROM public.white_label_plans WHERE code = 'shop';

-- The two lists as they were before 00020 (only 'shop' and 'shop_order'
-- are taken out; whatever else is in them stays).
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.white_label_plans'::regclass AND conname = 'white_label_plans_modules_check';
  IF v_def LIKE '%''shop''::text, %' THEN
    UPDATE public.white_label_plans SET modules = array_remove(modules, 'shop') WHERE 'shop' = ANY (modules);
    ALTER TABLE public.white_label_plans DROP CONSTRAINT white_label_plans_modules_check;
    EXECUTE 'ALTER TABLE public.white_label_plans ADD CONSTRAINT white_label_plans_modules_check '
         || replace(v_def, '''shop''::text, ', '');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.invoices'::regclass AND conname = 'invoices_source_type_check';
  IF v_def LIKE '%''shop_order''::text, %' THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_source_type_check;
    IF EXISTS (SELECT 1 FROM public.invoices WHERE source_type = 'shop_order') THEN
      RAISE NOTICE 'receipts and credit notes from shop orders are kept; invoices_source_type_check is put back NOT VALID';
      EXECUTE 'ALTER TABLE public.invoices ADD CONSTRAINT invoices_source_type_check '
           || replace(v_def, '''shop_order''::text, ', '') || ' NOT VALID';
    ELSE
      EXECUTE 'ALTER TABLE public.invoices ADD CONSTRAINT invoices_source_type_check '
           || replace(v_def, '''shop_order''::text, ', '');
    END IF;
  END IF;
END $$;

-- ============================================================================
-- DONE
-- ============================================================================
