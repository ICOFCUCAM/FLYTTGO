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

-- ── Images as named slots ───────────────────────────────────────────────────
BEGIN;
CREATE TEMP TABLE st ON COMMIT DROP AS SELECT 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/'::text AS base;
GRANT SELECT ON st TO authenticated, service_role;
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT public.import_site_template(tests.tq_template(jsonb_build_object(
    'assets', jsonb_build_array(jsonb_build_object('key', 'hero', 'url', (SELECT base FROM st) || 'salon-verve01/hero.jpg'),
                                jsonb_build_object('key', 'services.1', 'url', (SELECT base FROM st) || 'salon-verve01/services-1.jpg'),
                                jsonb_build_object('key', 'thumbnail', 'url', (SELECT base FROM st) || 'salon-verve01/thumbnail.jpg')),
    'images', jsonb_build_array(
      jsonb_build_object('asset_key', 'hero', 'slot', 'hero', 'url', (SELECT base FROM st) || 'salon-verve01/hero.jpg', 'source', 'architect-ai',
                         'category', 'appointments', 'intended_use', 'A stylist at work', 'width', 1600, 'height', 900,
                         'sha256', repeat('a', 64)),
      jsonb_build_object('asset_key', 'services.1', 'slot', 'services', 'url', (SELECT base FROM st) || 'salon-verve01/services-1.jpg',
                         'source', 'architect-ai', 'category', 'appointments', 'sha256', repeat('a', 64))))));
SELECT tests.ok((SELECT count(*) = 2 FROM public.site_template_images WHERE template_id = 'salon-verve01'),
  'the importer records each image slot (not the thumbnail) with what is known about it');
SELECT tests.ok((SELECT slot = 'hero' AND source = 'architect-ai' AND licence IS NULL AND review_status = 'unreviewed'
                        AND width = 1600 AND intended_use = 'A stylist at work'
                   FROM public.site_template_images WHERE template_id = 'salon-verve01' AND asset_key = 'hero'),
  'an imported image: its slot, source, size and use; licence unknown, not reviewed');
SELECT tests.throws($$INSERT INTO public.site_template_images (template_id, asset_key, slot, url, source)
                      VALUES ('salon-verve01', 'x', 'hero', 'https://a/x.jpg', 'licensed')$$, '23514', 'a licensed photo needs its licence');
SELECT tests.throws($$INSERT INTO public.site_template_images (template_id, asset_key, slot, url, source, generation)
                      VALUES ('salon-verve01', 'x', 'hero', 'https://a/x.jpg', 'ai-generated', '{}')$$, '23514',
  'an AI-generated image says how it was made');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.site_template_images), 'companies do not see image metadata');
SELECT tests.throws($$SELECT public.admin_replace_site_template_image('salon-verve01', 'hero', 'salon-verve01/new.jpg', '{}')$$, '42501',
  'nor replace images');
SELECT tests.throws($$INSERT INTO storage.objects (bucket_id, name) VALUES ('site-template-assets', 'salon-verve01/new.jpg')$$, '42501',
  'nor upload into the template bucket');
SELECT tests.login(:admin);
SELECT tests.ok((SELECT count(*) = 2 FROM public.site_template_images), 'FlyttGo administrators see it');
SELECT tests.throws($$SELECT public.admin_replace_site_template_image('salon-verve01', 'hero', 'salon-verve01/new.jpg',
                      '{"mime": "image/webp", "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "width": 1600, "height": 900, "source": "own"}')$$,
  '22023', 'the image must be uploaded first');
INSERT INTO storage.objects (bucket_id, name) VALUES ('site-template-assets', 'salon-verve01/new.webp');
SELECT tests.throws($$SELECT public.admin_replace_site_template_image('salon-verve01', 'hero', 'salon-verve01/new.webp',
                      '{"mime": "image/gif", "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "width": 1600, "height": 900, "source": "own"}')$$,
  '22023', 'only PNG, JPEG or WebP');
SELECT tests.throws($$SELECT public.admin_replace_site_template_image('salon-verve01', 'hero', 'salon-verve01/new.webp',
                      '{"mime": "image/webp", "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "width": 1600, "height": 900}')$$,
  '22023', 'and the administrator says where it comes from');
SELECT tests.throws($$SELECT public.admin_replace_site_template_image('salon-verve01', 'thumbnail', 'salon-verve01/new.webp',
                      '{"mime": "image/webp", "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "width": 1600, "height": 900, "source": "own"}')$$,
  'P0002', 'the thumbnail is not an image slot');
SELECT tests.ok((SELECT source = 'licensed' AND licence = 'Example Stock, licence 123' AND review_status = 'unreviewed'
                        AND url = (SELECT base FROM st) || 'salon-verve01/new.webp' AND replaced_by = :admin
                        AND history -> 0 ->> 'url' = (SELECT base FROM st) || 'salon-verve01/hero.jpg'
                   FROM public.admin_replace_site_template_image('salon-verve01', 'hero', 'salon-verve01/new.webp',
                     '{"mime": "image/webp", "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "width": 1600, "height": 900,
                       "source": "licensed", "licence": "Example Stock, licence 123"}')),
  'an administrator replaces a slot''s image: source and licence recorded, the earlier image kept in history');
SELECT tests.ok((SELECT assets @> jsonb_build_array(jsonb_build_object('key', 'hero', 'url', (SELECT base FROM st) || 'salon-verve01/new.webp'))
                   FROM public.site_templates WHERE id = 'salon-verve01'),
  'the template shows the new image');
SELECT tests.throws($$SELECT public.admin_review_site_template_image('salon-verve01', 'services.1', 'approved', NULL)$$, '55000',
  'an imported image is approved only once its licence is recorded');
SELECT tests.ok((SELECT review_status = 'approved' AND licence = 'Confirmed by the owner, 2026-11-01' AND reviewed_by = :admin
                   FROM public.admin_review_site_template_image('salon-verve01', 'services.1', 'approved', 'Confirmed by the owner, 2026-11-01')),
  'with its licence recorded it is approved, by name');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((SELECT assets @> jsonb_build_array(jsonb_build_object('key', 'hero', 'url', (SELECT base FROM st) || 'salon-verve01/new.webp'))
                   FROM public.import_site_template(tests.tq_template(jsonb_build_object(
                     'assets', jsonb_build_array(jsonb_build_object('key', 'hero', 'url', (SELECT base FROM st) || 'salon-verve01/hero.jpg'),
                                                 jsonb_build_object('key', 'services.1', 'url', (SELECT base FROM st) || 'salon-verve01/services-1.jpg')),
                     'images', jsonb_build_array(jsonb_build_object('asset_key', 'hero', 'slot', 'hero',
                                 'url', (SELECT base FROM st) || 'salon-verve01/hero.jpg', 'source', 'architect-ai')))))),
  'a re-import keeps a replaced image');
SELECT tests.ok((SELECT source = 'licensed' FROM public.site_template_images WHERE template_id = 'salon-verve01' AND asset_key = 'hero'),
  'and its metadata');
ROLLBACK;

\echo 'template quality: all tests passed'
