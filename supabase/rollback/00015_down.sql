-- ============================================================================
-- Roll back 00015_accounting_flyttgo.sql
-- ============================================================================
-- Run first (before 00014_down.sql). Afterwards the core is as 00014 left
-- it: its adapter denies everything again, and invoices are no longer
-- posted. Vouchers already posted stay in the books.
-- ============================================================================

DROP TRIGGER IF EXISTS accounting_on_invoice ON public.invoices;
DROP TRIGGER IF EXISTS accounting_on_payment ON public.invoice_payments;
DROP TRIGGER IF EXISTS accounting_on_reminder ON public.invoice_reminders;
DROP FUNCTION IF EXISTS public.accounting_post_unposted(uuid);
DROP FUNCTION IF EXISTS public.accounting_unposted(uuid);
DROP FUNCTION IF EXISTS public.accounting_on_reminder();
DROP FUNCTION IF EXISTS public.accounting_on_payment();
DROP FUNCTION IF EXISTS public.accounting_on_invoice();
DROP FUNCTION IF EXISTS public.accounting_post_reminder(uuid);
DROP FUNCTION IF EXISTS public.accounting_post_payment(uuid);
DROP FUNCTION IF EXISTS public.accounting_post_invoice(uuid);
DROP FUNCTION IF EXISTS public.create_accounting_invoice(uuid, date);
DROP TABLE IF EXISTS public.accounting_charges;      -- the invoices themselves stay (00008)
DROP FUNCTION IF EXISTS public.accounting_billable(date);
DROP FUNCTION IF EXISTS public.accounting_tier(uuid, date);
DROP FUNCTION IF EXISTS public.accounting_price();
DELETE FROM public.platform_config WHERE config_key IN ('accounting_price_tiers', 'accounting_price_status');

DO $$
BEGIN
  IF to_regnamespace('accounting') IS NOT NULL THEN
    ALTER TABLE accounting.ledgers DROP CONSTRAINT IF EXISTS ledgers_tenant_organization_fk;
    -- The core's deny-all adapter, as 00014 creates it.
    CREATE OR REPLACE FUNCTION accounting.host_can_keep(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
    CREATE OR REPLACE FUNCTION accounting.host_can_manage(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
    CREATE OR REPLACE FUNCTION accounting.host_is_operator() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
    CREATE OR REPLACE FUNCTION accounting.host_is_server() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
    CREATE OR REPLACE FUNCTION accounting.host_tenant(p_tenant uuid) RETURNS jsonb LANGUAGE sql STABLE AS 'SELECT NULL::jsonb';
    CREATE OR REPLACE FUNCTION accounting.host_event(p_tenant uuid, p_action text, p_details jsonb) RETURNS void LANGUAGE sql AS 'SELECT';
    ALTER FUNCTION accounting.host_can_keep(uuid) SECURITY INVOKER RESET search_path;
    ALTER FUNCTION accounting.host_can_manage(uuid) SECURITY INVOKER RESET search_path;
    ALTER FUNCTION accounting.host_is_operator() SECURITY INVOKER RESET search_path;
    ALTER FUNCTION accounting.host_is_server() SECURITY INVOKER RESET search_path;
    ALTER FUNCTION accounting.host_tenant(uuid) SECURITY INVOKER RESET search_path;
    ALTER FUNCTION accounting.host_event(uuid, text, jsonb) SECURITY INVOKER RESET search_path;
  END IF;
END $$;
