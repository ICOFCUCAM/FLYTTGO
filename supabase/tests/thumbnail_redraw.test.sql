-- ============================================================================
-- Gallery thumbnails drawn again with the image library
-- (supabase/migrations/00024_thumbnail_redraw.sql)
-- Each block runs in its own transaction and rolls back.
-- Uses tests.il_template() and tests.il_image() (image_library.test.sql),
-- tests.as_server() (invoicing.test.sql) and the administrator and
-- customers of p0_security.test.sql.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''

-- The state of one template's thumbnail, as the redraw reads it.
CREATE OR REPLACE FUNCTION tests.th_state(p_id text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT state FROM public.site_template_thumbnail_states(false) WHERE template_id = p_id;
$$;
-- A redraw as the script records it: the picture uploaded under its new
-- name, recorded with the images the template shows now.
CREATE OR REPLACE FUNCTION tests.th_redraw(p_id text) RETURNS public.site_templates LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_claims text := current_setting('request.jwt.claims', true); v_images text; r public.site_templates;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  v_images := public.site_template_images_hash(public.site_template_image_map(p_id, NULL));
  INSERT INTO storage.objects (bucket_id, name) VALUES ('site-template-assets', p_id || '/thumbnail-' || left(v_images, 12) || '.jpg')
  ON CONFLICT DO NOTHING;
  r := public.record_site_template_thumbnail(p_id, p_id || '/thumbnail-' || left(v_images, 12) || '.jpg', v_images);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN r;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── The picture key ────────────────────────────────────────────────────────
BEGIN;
SELECT tests.ok(public.site_template_images_key('{"images": {
    "services.1": {"source": "library", "bucket": "site-image-library", "path": "appointments/abc.jpg", "focal_x": 0.4, "focal_y": 0.25, "alt": "A"},
    "hero": {"source": "assets", "url": "https://a.test/hero.jpg"},
    "Team": {"source": "fallback", "shape": "portrait"}}}')
  = E'Team=-||\nhero=https://a.test/hero.jpg||\nservices.1=site-image-library/appointments/abc.jpg|400|250',
  'the picture key: one line per slot in byte order, its address or stored file (or - for the neutral block) and focal point; no alt text');
SELECT tests.ok(public.site_template_images_hash('{"images": {"hero": {"url": "https://a.test/hero.jpg", "alt": "One"}}}')
                = public.site_template_images_hash('{"images": {"hero": {"url": "https://a.test/hero.jpg", "alt": "Other", "source": "template"}}}')
                AND public.site_template_images_hash('{"images": {"hero": {"url": "https://a.test/hero.jpg"}}}')
                    = encode(sha256(convert_to('hero=https://a.test/hero.jpg||', 'UTF8')), 'hex')
                AND public.site_template_images_hash('{"images": {"hero": {"url": "https://a.test/h2.jpg"}}}')
                    <> public.site_template_images_hash('{"images": {"hero": {"url": "https://a.test/hero.jpg"}}}'),
  'its SHA-256 changes with the picture, not with the description or where it comes from');
ROLLBACK;

-- ── Fresh, stale and missing ───────────────────────────────────────────────
BEGIN;
SELECT tests.il_template('salon-a');
SELECT tests.il_template('salon-b');
SELECT tests.il_template('mover-a', ARRAY['moving']);
-- A template without a thumbnail.
SELECT tests.il_template('salon-c');
UPDATE public.site_templates SET assets = (SELECT jsonb_agg(a) FROM jsonb_array_elements(assets) a WHERE a ->> 'key' <> 'thumbnail') WHERE id = 'salon-c';
SELECT tests.ok(tests.th_state('salon-a') = 'fresh' AND tests.th_state('mover-a') = 'fresh',
  'a thumbnail drawn at import (no images recorded) is fresh while its category has no library: it shows the template''s assets');
SELECT tests.ok(tests.th_state('salon-c') = 'missing', 'a template without a thumbnail has a missing one');
-- A pending library image changes nothing; approving one makes the category's templates stale.
CREATE TEMP TABLE lib ON COMMIT DROP AS SELECT tests.il_image('appointments', 'hero', 'salon hero 1', 'pending') AS id;
GRANT SELECT ON lib TO authenticated;
SELECT tests.ok(tests.th_state('salon-a') = 'fresh', 'a pending library image changes no thumbnail');
UPDATE public.image_library SET review_status = 'approved', licence = 'Test licence', licence_evidence = 'https://licences.example/1'
 WHERE id = (SELECT id FROM lib);
SELECT tests.ok(tests.th_state('salon-a') = 'stale' AND tests.th_state('salon-b') = 'stale',
  'approving a library image makes the thumbnails of its category stale, computed, without flagging anything');
SELECT tests.ok(tests.th_state('mover-a') = 'fresh', 'and no other category''s');
-- The redraw records the images it drew with: fresh again.
CREATE TEMP TABLE r ON COMMIT DROP AS SELECT * FROM tests.th_redraw('salon-a');
SELECT tests.ok(tests.th_state('salon-a') = 'fresh' AND tests.th_state('salon-b') = 'stale',
  'a redrawn thumbnail, recorded with its images, is fresh; the others stay stale');
SELECT tests.ok((SELECT a ->> 'url' ~ '^https://flyttgo\.supabase\.co/storage/v1/object/public/site-template-assets/salon-a/thumbnail-[0-9a-f]{12}\.jpg$'
                        AND a ->> 'images' ~ '^[0-9a-f]{64}$' AND a ? 'drawn_at'
                   FROM r, jsonb_array_elements(r.assets) a WHERE a ->> 'key' = 'thumbnail'),
  'under a new name (so browsers never show the old picture), with the images it was drawn with');
SELECT tests.ok((SELECT count(*) FROM r, jsonb_array_elements(r.assets) a WHERE a ->> 'key' = 'thumbnail') = 1
                AND (SELECT status FROM r) = 'approved',
  'it replaces the thumbnail (one) and leaves the template''s review as it was');
-- Retiring or rejecting the photo makes it stale again; so does another approved photo that wins a slot.
UPDATE public.image_library SET review_status = 'retired', review_reason = 'x' WHERE id = (SELECT id FROM lib);
SELECT tests.ok(tests.th_state('salon-a') = 'stale', 'retiring a photo it shows makes the thumbnail stale');
UPDATE public.image_library SET review_status = 'approved' WHERE id = (SELECT id FROM lib);
SELECT tests.ok(tests.th_state('salon-a') = 'fresh', 'approving it again gives back the very images it was drawn with: fresh');
UPDATE public.image_library SET review_status = 'rejected', review_reason = 'x' WHERE id = (SELECT id FROM lib);
SELECT tests.ok(tests.th_state('salon-a') = 'stale', 'rejecting it: stale');
UPDATE public.image_library SET review_status = 'approved' WHERE id = (SELECT id FROM lib);
UPDATE public.image_library SET focal_x = 0.3 WHERE id = (SELECT id FROM lib);
SELECT tests.ok(tests.th_state('salon-a') = 'stale', 'a new focal point changes the picture: stale');
UPDATE public.image_library SET focal_x = NULL WHERE id = (SELECT id FROM lib);
-- The template's own image changes.
INSERT INTO public.site_template_images (template_id, asset_key, slot, url, source, licence, review_status) VALUES
  ('salon-a', 'hero', 'hero', 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/salon-a/own-hero.jpg', 'licensed', 'Licence 7', 'unreviewed');
SELECT tests.ok(tests.th_state('salon-a') = 'fresh', 'an unreviewed template image changes nothing');
UPDATE public.site_template_images SET review_status = 'approved' WHERE template_id = 'salon-a' AND asset_key = 'hero';
SELECT tests.ok(tests.th_state('salon-a') = 'stale', 'approving the template''s own image makes its thumbnail stale');
SELECT tests.th_redraw('salon-a');
SELECT tests.ok(tests.th_state('salon-a') = 'fresh', 'and the redraw makes it fresh');
-- A re-import draws the thumbnail with the assets and drops the record: stale again in a category with a library.
SELECT tests.il_template('salon-a');
SELECT tests.ok(tests.th_state('salon-a') = 'stale', 'a re-import (thumbnail drawn with the assets) is stale again while the category has library photos');
ROLLBACK;

-- ── Before a library: an image that changes in assets mode ─────────────────
BEGIN;
SELECT tests.il_template('mover-a', ARRAY['moving']);
SELECT tests.th_redraw('mover-a');
SELECT tests.ok(tests.th_state('mover-a') = 'fresh', 'a redrawn template in a category without a library is fresh');
UPDATE public.site_templates SET assets = (
  SELECT jsonb_agg(CASE WHEN a ->> 'key' = 'hero' THEN a || '{"url": "https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/mover-a/hero-2.jpg"}' ELSE a END ORDER BY n)
    FROM jsonb_array_elements(assets) WITH ORDINALITY e(a, n)) WHERE id = 'mover-a';
SELECT tests.ok(tests.th_state('mover-a') = 'stale', 'a replaced asset makes a recorded thumbnail stale too');
ROLLBACK;

-- ── Who sees what ──────────────────────────────────────────────────────────
BEGIN;
SELECT tests.il_template('salon-a');
SELECT tests.il_template('salon-b');
SELECT tests.il_template('salon-d');
UPDATE public.site_templates SET status = 'imported' WHERE id = 'salon-d';
SELECT tests.il_image('appointments', 'hero', 'salon hero 1');
SELECT tests.th_redraw('salon-b');
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.throws($$SELECT public.stale_site_template_thumbnails()$$, '42501', 'visitors cannot ask which thumbnails are stale');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok(public.stale_site_template_thumbnails() = ARRAY['salon-a'],
  'signed-in companies learn which offered templates have a stale thumbnail (by id; not the ones under review)');
SELECT tests.throws($$SELECT * FROM public.admin_site_template_thumbnails()$$, '42501', 'but not the details');
SELECT tests.throws($$SELECT * FROM public.admin_thumbnail_stale_counts()$$, '42501', 'nor the counts');
SELECT tests.throws($$SELECT * FROM public.site_template_thumbnail_states()$$, '42501', 'nor the states directly');
SELECT tests.throws($$SELECT public.record_site_template_thumbnail('salon-a', 'salon-a/thumbnail-' || repeat('a', 12) || '.jpg', repeat('a', 64))$$,
  '42501', 'nor record a thumbnail');
SELECT tests.login(:admin);
SELECT tests.ok((SELECT string_agg(template_id || ':' || state, ' ' ORDER BY template_id) FROM public.admin_site_template_thumbnails('appointments'))
                = 'salon-a:stale salon-b:fresh salon-d:stale',
  'FlyttGo''s administrators see every template''s thumbnail, the ones under review too');
SELECT tests.ok((SELECT templates = 3 AND fresh = 1 AND stale = 2 AND missing = 0 FROM public.admin_thumbnail_stale_counts() WHERE category = 'appointments')
                AND (SELECT count(*) FROM public.admin_thumbnail_stale_counts()) = 11,
  'and the counts per category, every category listed');
SELECT tests.throws($$SELECT public.record_site_template_thumbnail('salon-a', 'salon-a/thumbnail-' || repeat('a', 12) || '.jpg', repeat('a', 64))$$,
  '42501', 'administrators do not record thumbnails either (the redraw does, as the server)');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok((SELECT count(*) FROM public.admin_site_template_thumbnails()) = 3, 'the redraw (server) reads them');
SELECT tests.throws($$SELECT public.record_site_template_thumbnail('salon-a', 'salon-a/thumbnail-' || repeat('a', 12) || '.jpg', repeat('a', 64))$$,
  '22023', 'a thumbnail is recorded only once its picture is uploaded');
SELECT tests.throws($$SELECT public.record_site_template_thumbnail('salon-a', 'salon-b/thumbnail-' || left((SELECT a ->> 'images' FROM public.site_templates, jsonb_array_elements(assets) a WHERE id = 'salon-b' AND a ->> 'key' = 'thumbnail'), 12) || '.jpg', repeat('a', 64))$$,
  '22023', 'and only in the template''s own folder');
SELECT tests.throws($$SELECT public.record_site_template_thumbnail('salon-a', 'salon-a/thumbnail.jpg', 'abc')$$, '22023',
  'with the SHA-256 of the images it was drawn with');
SELECT tests.throws($$SELECT public.record_site_template_thumbnail('nope', 'nope/thumbnail-' || repeat('a', 12) || '.jpg', repeat('a', 64))$$, 'P0002',
  'of a template that exists');
ROLLBACK;
\echo 'thumbnail redraw: all tests passed'
