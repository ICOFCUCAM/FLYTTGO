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

-- ── The quality gate ───────────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.throws($$SELECT public.import_site_template(tests.tq_template('{"checks": {"results": [{"id": "made-up", "page": "/", "status": "pass"}]}}'))$$,
  '22023', 'checks must be in the importer''s form');
SELECT tests.ok((SELECT public.site_template_failing_checks(checks) = ARRAY['not_checked'] FROM public.import_site_template(tests.tq_template())),
  'a template imported without checks counts as not checked');
SELECT tests.ok((SELECT public.site_template_failing_checks(checks) = ARRAY['booking_links', 'overflow']
                   FROM public.import_site_template(tests.tq_template(jsonb_build_object('checks', jsonb_build_object(
                     'version', 1, 'ran_at', '2026-10-29T12:00:00Z', 'results', jsonb_build_array(
                       jsonb_build_object('id', 'overflow', 'page', '/', 'status', 'fail', 'detail', 'Wider than the screen at 320 px (328 px).'),
                       jsonb_build_object('id', 'overflow', 'page', '/contact', 'status', 'pass', 'detail', 'Fits.'),
                       jsonb_build_object('id', 'booking_links', 'page', '/', 'status', 'fail', 'detail', '1 booking link leads elsewhere.'),
                       jsonb_build_object('id', 'renders', 'page', '/', 'status', 'pass', 'detail', 'Renders.'),
                       jsonb_build_object('id', 'image_alt', 'page', '/contact', 'status', 'not_run', 'detail', '-'))))))),
  'the importer stores its checks; failed ones are listed');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.record_site_template_checks('salon-verve01', '{"results": []}', NULL)$$, '42501',
  'only the importer records a re-check');
SELECT tests.throws($$SELECT public.admin_review_site_template('salon-verve01', true, true, NULL, 'looks fine')$$, '42501',
  'only FlyttGo approves');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_review_site_template('salon-verve01', true, true, 'ok')$$, '55000',
  'approval is refused while automated checks fail');
SELECT tests.throws($$SELECT public.admin_review_site_template('salon-verve01', true, true, 'ok', '   ')$$, '55000',
  'and a blank reason is no reason');
SELECT tests.ok((SELECT status = 'approved' AND jsonb_array_length(check_overrides) = 1
                        AND check_overrides -> 0 ->> 'reason' = 'Header fixed by hand; overflow re-checked in the preview'
                        AND check_overrides -> 0 -> 'checks' = '["booking_links", "overflow"]'
                        AND check_overrides -> 0 ->> 'by' = :admin
                   FROM public.admin_review_site_template('salon-verve01', true, true, 'ok', 'Header fixed by hand; overflow re-checked in the preview')),
  'with a reason it is approved, and who, when, why and which checks are kept');
SELECT tests.ok((SELECT status FROM public.admin_review_site_template('salon-verve01', false, false, 'retire')) = 'retired',
  'retiring needs no reason');

-- An edited page: its results are stale; the panel records the checks that need no browser.
SELECT tests.ok((SELECT (SELECT array_agg(r ->> 'status' ORDER BY r ->> 'id') FROM jsonb_array_elements(checks -> 'results') r WHERE r ->> 'page' = '/')
                        = ARRAY['stale', 'stale', 'stale']
                        AND (SELECT r ->> 'status' FROM jsonb_array_elements(checks -> 'results') r WHERE r ->> 'page' = '/contact' AND r ->> 'id' = 'image_alt') = 'not_run'
                   FROM public.admin_update_site_template_page('salon-verve01', '/',
                     '<html><body><a class="brand fg-brand-slot">{{brand.name}}</a><a href="{{BOOKING_URL}}">Book now</a></body></html>')),
  'editing a page makes its results stale, and leaves the other pages'' alone');
SELECT tests.throws($$SELECT public.admin_record_site_template_page_checks('salon-verve01', '/', '[{"id": "overflow", "page": "/", "status": "pass", "detail": "x"}]', '[]')$$,
  '22023', 'the panel cannot pass the browser''s checks');
SELECT tests.throws($$SELECT public.admin_record_site_template_page_checks('salon-verve01', '/', '[{"id": "image_alt", "page": "/contact", "status": "pass", "detail": "x"}]', '[]')$$,
  '22023', 'nor another page''s');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((SELECT jsonb_array_length(content_flags) = 2 FROM public.record_site_template_checks('salon-verve01',
                   (SELECT checks FROM public.site_templates WHERE id = 'salon-verve01'),
                   '[{"kind": "price", "page": "/contact", "sample": "$5"}, {"kind": "price", "page": "/", "sample": "$9"}]')),
  'a re-check by the importer records results and flags');
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT tests.ok((SELECT public.site_template_failing_checks(checks) = ARRAY['overflow', 'renders']
                        AND content_flags = '[{"kind": "price", "page": "/contact", "sample": "$5"}, {"kind": "statistic", "page": "/", "sample": "500+"}]'
                   FROM public.admin_record_site_template_page_checks('salon-verve01', '/',
                     '[{"id": "booking_links", "page": "/", "status": "pass", "detail": "ok"}]',
                     '[{"kind": "statistic", "page": "/", "sample": "500+"}]')),
  'the checks that need no browser are recorded again; the browser''s stay stale; the page''s flags are replaced');
SELECT tests.throws($$SELECT public.admin_review_site_template('salon-verve01', true, true, NULL)$$, '55000',
  'stale checks stop approval too');
ROLLBACK;

\echo 'template quality: all tests passed'
