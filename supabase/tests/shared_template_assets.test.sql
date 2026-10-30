-- ============================================================================
-- One stored copy of each template image
-- (supabase/migrations/00025_shared_template_assets.sql)
-- Each block runs in its own transaction and rolls back.
-- Uses tests.th_state() and tests.th_redraw() (thumbnail_redraw.test.sql),
-- tests.il_image() (image_library.test.sql), tests.as_server()
-- (invoicing.test.sql) and the administrator and customers of
-- p0_security.test.sql.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''

-- A template as the importer stores it: its own copy of each picture in its
-- folder (the same two pictures in every template), its image slots with
-- their SHA-256, and a thumbnail drawn at import (no images recorded).
CREATE OR REPLACE FUNCTION tests.sa_template(p_id text, p_industry text[] DEFAULT ARRAY['moving']) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_claims text := current_setting('request.jwt.claims', true);
        v_base text := 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/';
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('site-template-assets', p_id || '/hero.jpg'), ('site-template-assets', p_id || '/services.1.jpg'),
         ('site-template-assets', p_id || '/thumbnail.jpg')
  ON CONFLICT DO NOTHING;
  PERFORM public.import_site_template(jsonb_build_object(
    'id', p_id, 'name', 'Template ' || p_id, 'industry', to_jsonb(p_industry), 'style', 'bold', 'source_id', p_id,
    'assets', jsonb_build_array(
      jsonb_build_object('key', 'hero', 'url', v_base || p_id || '/hero.jpg'),
      jsonb_build_object('key', 'services.1', 'url', v_base || p_id || '/services.1.jpg'),
      jsonb_build_object('key', 'thumbnail', 'url', v_base || p_id || '/thumbnail.jpg')),
    'images', jsonb_build_array(
      jsonb_build_object('asset_key', 'hero', 'slot', 'hero', 'url', v_base || p_id || '/hero.jpg', 'sha256', repeat('1', 64),
                         'width', 1920, 'height', 1080),
      jsonb_build_object('asset_key', 'services.1', 'slot', 'services', 'url', v_base || p_id || '/services.1.jpg', 'sha256', repeat('2', 64),
                         'width', 1200, 'height', 800)),
    'pages', jsonb_build_array(jsonb_build_object('path', '/', 'html',
      '<img src="{{ASSET:hero}}" alt="Hero"><img src="{{ASSET:services.1}}" alt="One">'))));
  UPDATE public.site_templates SET status = 'approved' WHERE id = p_id;
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN p_id;
END $$;
-- The moves the script plans for a template: both pictures to their shared copy.
CREATE OR REPLACE FUNCTION tests.sa_moves(p_id text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('template', p_id, 'key', 'hero', 'sha256', repeat('1', 64),
      'from', 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/' || p_id || '/hero.jpg',
      'to', 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/shared/' || repeat('1', 64) || '.jpg'),
    jsonb_build_object('template', p_id, 'key', 'services.1', 'sha256', repeat('2', 64),
      'from', 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/' || p_id || '/services.1.jpg',
      'to', 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/shared/' || repeat('2', 64) || '.jpg'));
$$;
CREATE OR REPLACE FUNCTION tests.sa_url(p_id text, p_key text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT a ->> 'url' FROM public.site_templates t, jsonb_array_elements(t.assets) a WHERE t.id = p_id AND a ->> 'key' = p_key;
$$;
CREATE OR REPLACE FUNCTION tests.sa_shared() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('site-template-assets', 'shared/' || repeat('1', 64) || '.jpg'), ('site-template-assets', 'shared/' || repeat('2', 64) || '.jpg')
  ON CONFLICT DO NOTHING;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── Moving the copies: addresses, record, thumbnails ───────────────────────
BEGIN;
SELECT tests.sa_template('mover-a');
SELECT tests.sa_template('mover-b');
SELECT tests.sa_template('mover-c');
-- mover-b's thumbnail was redrawn (images recorded), mover-c's is stale (drawn with other images).
SELECT tests.th_redraw('mover-b');
UPDATE public.site_templates SET assets = (SELECT jsonb_agg(CASE WHEN a ->> 'key' = 'thumbnail' THEN a || jsonb_build_object('images', repeat('9', 64)) ELSE a END)
                                             FROM jsonb_array_elements(assets) a) WHERE id = 'mover-c';
SELECT tests.ok(tests.th_state('mover-a') = 'fresh' AND tests.th_state('mover-b') = 'fresh' AND tests.th_state('mover-c') = 'stale',
  'before: an imported thumbnail and a redrawn one are fresh, the third is stale');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.throws($$SELECT public.share_site_template_assets(tests.sa_moves('mover-a'))$$, '22023',
  'a template is moved only to a shared copy already uploaded');
SELECT tests.sa_shared();
CREATE TEMP TABLE res ON COMMIT DROP AS
  SELECT public.share_site_template_assets(tests.sa_moves('mover-a') || tests.sa_moves('mover-b') || tests.sa_moves('mover-c')) AS r;
SELECT tests.ok((SELECT r FROM res) = '{"templates": 3, "moved": 6, "already": 0, "thumbnails_rekeyed": 1}'::jsonb,
  'six slots of three templates moved in one call; one recorded thumbnail key recomputed');
SELECT tests.ok(tests.sa_url('mover-a', 'hero') = 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/shared/' || repeat('1', 64) || '.jpg'
                AND tests.sa_url('mover-c', 'services.1') = 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/shared/' || repeat('2', 64) || '.jpg',
  'every template''s asset points at the one shared copy');
SELECT tests.ok((SELECT count(*) FROM public.site_template_images WHERE url ~ '/site-template-assets/shared/') = 6
                AND (SELECT count(*) FROM public.site_template_images WHERE review_status <> 'unreviewed') = 0,
  'and so do the image slots, their review unchanged');
SELECT tests.ok(tests.sa_url('mover-a', 'thumbnail') = 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/mover-a/thumbnail.jpg'
                AND tests.sa_url('mover-b', 'thumbnail') ~ '/site-template-assets/mover-b/thumbnail-[0-9a-f]{12}\.jpg$',
  'thumbnails stay in their template''s folder');
SELECT tests.ok(tests.th_state('mover-a') = 'fresh' AND tests.th_state('mover-b') = 'fresh' AND tests.th_state('mover-c') = 'stale',
  'after: every thumbnail keeps its state (fresh stays fresh, the stale one stays stale)');
SELECT tests.ok((SELECT a ->> 'images' FROM public.site_templates, jsonb_array_elements(assets) a WHERE id = 'mover-b' AND a ->> 'key' = 'thumbnail')
                = public.site_template_images_hash(public.site_template_image_map('mover-b', NULL)),
  'the redrawn thumbnail''s record is the picture key with the new addresses');
SELECT tests.ok((SELECT count(*) FROM public.site_template_asset_moves) = 6
                AND (SELECT from_url FROM public.site_template_asset_moves WHERE template_id = 'mover-a' AND asset_key = 'hero')
                    = 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/mover-a/hero.jpg',
  'each move is recorded with the earlier address');
SELECT tests.ok((SELECT status FROM public.site_templates WHERE id = 'mover-a') = 'approved', 'the template''s review is unchanged');
SELECT tests.ok(public.share_site_template_assets(tests.sa_moves('mover-a')) = '{"templates": 1, "moved": 0, "already": 2, "thumbnails_rekeyed": 0}'::jsonb
                AND (SELECT count(*) FROM public.site_template_asset_moves) = 6,
  'running it again changes nothing');
ROLLBACK;

-- ── A thumbnail in a category with library photos ──────────────────────────
BEGIN;
SELECT tests.sa_template('mover-a');
SELECT tests.il_image('transport', 'hero', 'van hero 1');
SELECT tests.th_redraw('mover-a');
SELECT tests.ok(tests.th_state('mover-a') = 'fresh', 'a thumbnail redrawn with the library''s photos is fresh');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.sa_shared();
SELECT tests.ok((public.share_site_template_assets(tests.sa_moves('mover-a')) ->> 'moved')::int = 2 AND tests.th_state('mover-a') = 'fresh',
  'and stays fresh when its (unused) assets move');
ROLLBACK;

-- ── What is refused ────────────────────────────────────────────────────────
BEGIN;
SELECT tests.sa_template('mover-a');
SELECT tests.sa_template('mover-b');
SELECT tests.sa_shared();
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.share_site_template_assets(tests.sa_moves('mover-a'))$$, '42501', 'administrators do not move images (the script does)');
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.share_site_template_assets(tests.sa_moves('mover-a'))$$, '42501', 'nor do companies');
SELECT tests.ok((SELECT count(*) FROM public.site_template_asset_moves) = 0, 'and nobody but administrators reads the record');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.throws($$SELECT public.share_site_template_assets(jsonb_set(tests.sa_moves('mover-a'), '{0,sha256}', to_jsonb(repeat('3', 64))))$$, '22023',
  'the shared copy is named by the picture''s SHA-256');
SELECT tests.throws($$SELECT public.share_site_template_assets(jsonb_set(tests.sa_moves('mover-a'), '{0,from}',
    '"https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/mover-b/hero.jpg"'))$$, '22023',
  'a move takes a template''s image from its own folder only');
SELECT tests.throws($$SELECT public.share_site_template_assets(jsonb_set(tests.sa_moves('mover-a'), '{0,to}',
    '"https://elsewhere.example/storage/v1/object/public/site-template-assets/shared/1111111111111111111111111111111111111111111111111111111111111111.jpg"'))$$, '22023',
  'to the same bucket');
SELECT tests.throws($$SELECT public.share_site_template_assets(jsonb_set(tests.sa_moves('mover-a'), '{0,key}', '"thumbnail"'))$$, '22023',
  'thumbnails are never shared');
UPDATE public.site_template_images SET sha256 = repeat('4', 64) WHERE template_id = 'mover-b' AND asset_key = 'hero';
SELECT tests.throws($$SELECT public.share_site_template_assets(tests.sa_moves('mover-a') || tests.sa_moves('mover-b'))$$, '40001',
  'a slot whose recorded picture is another is not moved, and nothing else in that call either');
SELECT tests.ok(tests.sa_url('mover-a', 'hero') ~ '/mover-a/hero\.jpg$' AND (SELECT count(*) FROM public.site_template_asset_moves) = 0,
  'all or nothing (the template before it in the call is not moved either)');
UPDATE public.site_templates SET assets = (SELECT jsonb_agg(CASE WHEN a ->> 'key' = 'hero'
         THEN a || '{"url": "https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/mover-a/hero-abc.jpg"}'::jsonb ELSE a END)
         FROM jsonb_array_elements(assets) a) WHERE id = 'mover-a';
SELECT tests.throws($$SELECT public.share_site_template_assets(tests.sa_moves('mover-a'))$$, '40001',
  'an image changed since the plan was made is not moved');
ROLLBACK;

-- ── A retired library image whose file was removed ─────────────────────────
BEGIN;
CREATE TEMP TABLE lib ON COMMIT DROP AS SELECT tests.il_image('transport', 'hero', 'van hero removed') AS id;
GRANT SELECT ON lib TO authenticated;
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT public.admin_review_library_image((SELECT id FROM lib), 'retired', 'replaced by its web-size version');
RESET ROLE;
DELETE FROM storage.objects WHERE bucket_id = 'site-image-library' AND name = (SELECT storage_path FROM public.image_library WHERE id = (SELECT id FROM lib));
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_review_library_image((SELECT id FROM lib), 'approved', NULL)$$, '55000',
  'a retired image whose file was removed is not approved again');
SELECT tests.throws($$SELECT public.admin_review_library_image((SELECT id FROM lib), 'pending', NULL)$$, '55000', 'nor put back to pending');
SELECT tests.ok((SELECT review_status FROM public.image_library WHERE id = (SELECT id FROM lib)) = 'retired', 'its record stays, retired');
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name) SELECT 'site-image-library', storage_path FROM public.image_library WHERE id = (SELECT id FROM lib);
SET LOCAL ROLE authenticated;
SELECT tests.login(:admin);
SELECT tests.ok((public.admin_review_library_image((SELECT id FROM lib), 'approved', NULL)).review_status = 'approved',
  'once its file is uploaded again it can be approved');
ROLLBACK;
\echo 'shared template images: all tests passed'
