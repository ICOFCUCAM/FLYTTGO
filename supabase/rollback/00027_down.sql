-- ============================================================================
-- Roll back 00027_reserved_transport_slug.sql
-- ============================================================================
-- Run first (before the rollback of 00026). Puts back the list of reserved
-- slugs as 00005 set it; 'transport', 'moving' and 'flytting' can then be
-- taken by a company again, and transport.flyttgo.no would show that
-- company's page. Tested by run.sh.
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
    'test', 'staging', 'dev', 'demo'
  ]);
$$;
