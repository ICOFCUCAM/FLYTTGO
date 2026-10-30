-- ============================================================================
-- FlyttGo — reserve the moving and transport front page's subdomain
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00026. The owner's decision of
-- 2026-10-30 (docs/HOMEPAGES.md): flyttgo.no shows the platform's front
-- page, and the moving and transport front page moves to its own address,
-- transport.flyttgo.no. Every company's page is also served at
-- <slug>.flyttgo.no (docs/WHITE_LABEL.md), so a company with the slug
-- "transport" would take that address. 'transport' is reserved, with
-- 'moving' and 'flytting' for the same front page in other words. No company
-- had any of the three (read 2026-10-30), so no existing slug becomes
-- invalid; the organizations check (00005) refuses them from now on.
--
-- Only the list changes: the function keeps its name, arguments and
-- IMMUTABLE. Safe to re-run. Rolled back by supabase/rollback/00027_down.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_reserved_org_slug(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT lower(p) = ANY (ARRAY[
    'www', 'api', 'app', 'admin', 'administrator', 'auth', 'login', 'signin', 'signup',
    'mail', 'email', 'smtp', 'ftp', 'cdn', 'static', 'assets', 'media', 'img',
    'flyttgo', 'support', 'help', 'status', 'docs', 'blog', 'news', 'press',
    'business', 'corporate', 'dashboard', 'driver', 'drivers', 'book', 'booking',
    'track', 'tracking', 'payment', 'payments', 'billing', 'invoice', 'invoices',
    'test', 'staging', 'dev', 'demo',
    'transport', 'moving', 'flytting'
  ]);
$$;
