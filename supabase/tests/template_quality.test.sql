-- ============================================================================
-- The template catalogue (supabase/migrations/00021_template_quality.sql)
-- Each block runs in its own transaction and rolls back.
-- Uses tests.as_server() (invoicing.test.sql) and the administrator and
-- customers of p0_security.test.sql.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''

-- A clean template as the importer stores it (approved later in the tests).
CREATE OR REPLACE FUNCTION tests.tq_template(p_extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'id', 'salon-verve01', 'name', 'Verve Hair Salon', 'industry', jsonb_build_array('beauty', 'hair-salon'), 'style', 'chic',
    'source_id', 'salon-verve01', 'features', jsonb_build_array('services', 'team', 'contact'),
    'assets', jsonb_build_array(jsonb_build_object('key', 'hero', 'url', 'https://assets.example/salon-verve01/hero.jpg'),
                                jsonb_build_object('key', 'thumbnail', 'url', 'https://assets.example/salon-verve01/thumbnail.jpg')),
    'pages', jsonb_build_array(
      jsonb_build_object('path', '/', 'html', '<html><body><a class="brand fg-brand-slot">{{brand.name}}</a><h2>Our services</h2><img src="{{ASSET:hero}}" alt="A stylist at work"><a href="{{BOOKING_URL}}">Book</a></body></html>'),
      jsonb_build_object('path', '/contact', 'html', '<h1>Contact</h1><p>Call {{brand.phone}}</p>'))) || p_extra;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── Cards: features, page count, thumbnail ─────────────────────────────────
BEGIN;
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((SELECT features = ARRAY['services', 'team', 'contact'] AND page_count = 2 FROM public.import_site_template(tests.tq_template())),
  'the importer stores what the pages have, and the number of pages is counted');
SELECT tests.ok((SELECT features = '{}' FROM public.import_site_template(tests.tq_template('{"features": []}'))),
  'a re-import replaces the features');
SELECT tests.ok((SELECT assets @> '[{"key": "thumbnail"}]' FROM public.site_templates WHERE id = 'salon-verve01'),
  'the thumbnail is an asset beside the images');
SELECT tests.throws($$UPDATE public.site_templates SET page_count = 9$$, NULL, 'the page count is computed, never written');
ROLLBACK;

\echo 'template quality: all tests passed'
