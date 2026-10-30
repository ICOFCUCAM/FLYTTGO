-- ============================================================================
-- The image library (supabase/migrations/00023_image_library.sql)
-- Each block runs in its own transaction and rolls back.
-- Uses tests.as_server() (invoicing.test.sql), tests.wl_acme()
-- (white_label.test.sql: cust1 owns Acme, drv1 is its booker) and the
-- administrator and customers of p0_security.test.sql.
-- ============================================================================

\set ON_ERROR_STOP 1
\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set cust1   '''c0000000-0000-0000-0000-000000000001'''
\set cust2   '''c0000000-0000-0000-0000-000000000002'''
\set drv1    '''d0000000-0000-0000-0000-000000000001'''

-- A template as the importer stores it, approved, with the shared imported
-- (container) photos as its assets. Its home page uses a hero, three
-- services pictures and a map; its team page a portrait and the hero again.
CREATE OR REPLACE FUNCTION tests.il_template(p_id text, p_industry text[] DEFAULT ARRAY['hair-salon']) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_claims text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.import_site_template(jsonb_build_object(
    'id', p_id, 'name', 'Template ' || p_id, 'industry', to_jsonb(p_industry), 'style', 'chic', 'source_id', p_id,
    'assets', jsonb_build_array(
      jsonb_build_object('key', 'hero', 'url', 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/shared/containers-1.jpg'),
      jsonb_build_object('key', 'services.1', 'url', 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/shared/containers-2.jpg'),
      jsonb_build_object('key', 'thumbnail', 'url', 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/' || p_id || '/thumbnail.jpg')),
    'pages', jsonb_build_array(
      jsonb_build_object('path', '/', 'html', '<img src="{{ASSET:hero}}" alt="Hero"><img src="{{ASSET:services.1}}" alt="One">'
        || '<img src="{{ASSET:services.2}}" alt="Two"><div style="background:url({{ASSET:services.3}})"></div><img src="{{ASSET:map}}" alt="Map">'),
      jsonb_build_object('path', '/team', 'html', '<img src="{{ASSET:team.1}}" alt="Our stylist"><img src="{{ASSET:hero}}" alt="Hero">'))));
  UPDATE public.site_templates SET status = 'approved' WHERE id = p_id;
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  RETURN p_id;
END $$;

-- A library image as if added and reviewed (straight into the table; the
-- functions are tested on their own below). Its hash is that of the label.
CREATE OR REPLACE FUNCTION tests.il_image(p_cat text, p_shape text, p_label text, p_status text DEFAULT 'approved') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sha text := encode(sha256(convert_to(p_label, 'UTF8')), 'hex'); v_id uuid;
BEGIN
  INSERT INTO storage.objects (bucket_id, name) VALUES ('site-image-library', p_cat || '/' || v_sha || '.jpg');
  INSERT INTO public.image_library (storage_path, category, shape, width, height, mime, origin, licence, licence_evidence, alt_text,
                                    sha256, review_status)
  VALUES (p_cat || '/' || v_sha || '.jpg', p_cat, p_shape,
          CASE p_shape WHEN 'hero' THEN 1920 WHEN 'wide' THEN 1200 WHEN 'square' THEN 800 ELSE 800 END,
          CASE p_shape WHEN 'hero' THEN 1080 WHEN 'wide' THEN 800 WHEN 'square' THEN 800 ELSE 1200 END,
          'image/jpeg', 'test', CASE WHEN p_status = 'approved' THEN 'Test licence' END,
          CASE WHEN p_status = 'approved' THEN 'https://licences.example/' || p_label END, p_label, v_sha, p_status)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- The source of each slot, "key=source", in key order.
CREATE OR REPLACE FUNCTION tests.il_sources(p_map jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(k || '=' || (p_map -> 'images' -> k ->> 'source'), ' ' ORDER BY k) FROM jsonb_object_keys(p_map -> 'images') k;
$$;
-- The library image (its alt text, the test label) of a slot.
CREATE OR REPLACE FUNCTION tests.il_pick(p_map jsonb, p_key text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT alt_text FROM public.image_library WHERE id = (p_map -> 'images' -> p_key ->> 'id')::uuid;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated, service_role;

-- ── Categories, shapes and slots ───────────────────────────────────────────
BEGIN;
SELECT tests.ok(public.site_template_category(ARRAY['Hair-Salon']) = 'appointments'
                AND public.site_template_category(ARRAY['made-up', 'moving']) = 'transport'
                AND public.site_template_category(ARRAY['made-up']) = 'other'
                AND public.site_template_category(ARRAY['gym', 'dental']) IS NULL,
  'a template''s category comes from its industries as the catalogue reads them (health: none)');
SELECT tests.ok(public.image_shape_of(1920, 1080) = 'hero' AND public.image_shape_of(1000, 600) = 'wide'
                AND public.image_shape_of(1200, 800) = 'wide' AND public.image_shape_of(900, 1000) = 'square'
                AND public.image_shape_of(800, 1200) = 'portrait' AND public.image_shape_of(0, 10) IS NULL,
  'an image''s shape comes from its size');
SELECT tests.il_template('salon-a');
SELECT tests.ok((SELECT string_agg(slot_key || ':' || shape || ':' || array_to_string(pages, ','), ' ' ORDER BY ord)
                   FROM public.site_template_image_slots('salon-a'))
                = 'hero:hero:0,1 services.1:wide:0 services.2:wide:0 services.3:wide:0 map:map:0 team.1:portrait:1',
  'a template''s slots are its pages'' images in order, with their pages and shapes (the thumbnail is not one)');
ROLLBACK;

-- ── FlyttGo's administrators keep the library ──────────────────────────────
BEGIN;
INSERT INTO storage.objects (bucket_id, name) VALUES ('site-image-library', 'appointments/' || repeat('b', 64) || '.jpg');
CREATE TEMP TABLE img ON COMMIT DROP AS SELECT jsonb_build_object(
  'path', 'appointments/' || repeat('b', 64) || '.jpg', 'sha256', repeat('b', 64), 'mime', 'image/jpeg', 'width', 1920, 'height', 1080,
  'category', 'appointments', 'tags', jsonb_build_array('Salon', ' hair '), 'origin', 'unsplash',
  'sources', jsonb_build_array(jsonb_build_object('url', 'https://unsplash.example/photo'))) AS p;
GRANT SELECT ON img TO authenticated, anon;
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.throws($$SELECT public.admin_add_library_image((SELECT p FROM img))$$, '42501', 'visitors cannot add images');
SELECT tests.throws($$SELECT public.site_template_image_map('salon-a', NULL)$$, '42501', 'nor read the resolved map');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.throws($$SELECT public.admin_add_library_image((SELECT p FROM img))$$, '42501', 'companies cannot add images');
SELECT tests.throws($$SELECT * FROM public.admin_image_library_coverage()$$, '42501', 'nor see the coverage');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.admin_add_library_image((SELECT p FROM img) || '{"path": "appointments/other.jpg"}')$$, '22023',
  'the image must be uploaded where its hash says');
SELECT tests.throws($$SELECT public.admin_add_library_image((SELECT p FROM img) || '{"category": "health"}')$$, '22023',
  'an unknown category is refused');
SELECT tests.throws($$SELECT public.admin_add_library_image((SELECT p FROM img) - 'origin')$$, '22023', 'where it comes from is required');
CREATE TEMP TABLE li ON COMMIT DROP AS SELECT * FROM public.admin_add_library_image((SELECT p FROM img));
GRANT SELECT ON li TO authenticated;
SELECT tests.ok((SELECT review_status = 'pending' AND shape = 'hero' AND tags = ARRAY['salon', 'hair'] AND added_by = :admin
                        AND history -> 0 ->> 'action' = 'added' FROM li),
  'an added image is pending, its shape computed from its size, its tags tidied, who added it recorded');
SELECT tests.ok((SELECT id FROM public.admin_add_library_image((SELECT p FROM img) || '{"origin": "else"}')) = (SELECT id FROM li),
  'the same image (by SHA-256) is never added twice');
SELECT tests.throws($$SELECT public.admin_review_library_image((SELECT id FROM li), 'approved', NULL)$$, '55000',
  'approval needs the licence and its evidence');
SELECT public.admin_update_library_image((SELECT id FROM li), '{"licence": "Unsplash Licence", "licence_evidence": "https://unsplash.example/licence"}');
SELECT tests.throws($$SELECT public.admin_review_library_image((SELECT id FROM li), 'approved', NULL)$$, '55000',
  'and an alt text');
SELECT public.admin_update_library_image((SELECT id FROM li), '{"alt": "A stylist cutting hair", "focal_x": 0.4}');
SELECT tests.throws($$SELECT public.admin_update_library_image((SELECT id FROM li), '{"category": "trades"}')$$, '22023',
  'the category is not changed in place (it is part of where the file is)');
SELECT tests.ok((SELECT review_status = 'approved' AND reviewed_by = :admin FROM public.admin_review_library_image((SELECT id FROM li), 'approved', NULL)),
  'then it is approved, by name');
SELECT tests.ok((SELECT review_status = 'pending' AND history -> -1 ->> 'to' = 'pending'
                   FROM public.admin_update_library_image((SELECT id FROM li), '{"licence": "Another licence"}')),
  'a changed licence sends an approved image back to review');
SELECT tests.ok((SELECT review_status = 'approved' FROM public.admin_update_library_image((SELECT id FROM li), '{"tags": ["salon"]}')) IS FALSE
                AND (SELECT review_status FROM public.admin_review_library_image((SELECT id FROM li), 'approved', NULL)) = 'approved'
                AND (SELECT review_status = 'approved' FROM public.admin_update_library_image((SELECT id FROM li), '{"tags": ["salon", "hair"]}')),
  'tags and alt text change without a new review');
SELECT tests.throws($$SELECT public.admin_review_library_image((SELECT id FROM li), 'rejected', ' ')$$, '22023',
  'rejecting needs a reason');
SELECT tests.ok((SELECT review_status = 'retired' AND review_reason = 'Looks staged'
                        AND jsonb_array_length(history) = 9 AND history -> -1 ->> 'from' = 'approved'
                   FROM public.admin_review_library_image((SELECT id FROM li), 'retired', 'Looks staged')),
  'an image is retired with a reason, never deleted; every step is in its history');
SELECT tests.throws($$DELETE FROM public.image_library$$, '42501', 'nobody deletes library images directly');
SELECT tests.throws($$UPDATE public.image_library SET review_status = 'approved'$$, '42501', 'nor approves them around the functions');
SELECT tests.ok((SELECT count(*) FROM public.admin_image_library_coverage()) = 44, 'the coverage lists every category and shape');
ROLLBACK;

BEGIN;
SELECT tests.il_image('appointments', 'hero', 'approved hero');
SELECT tests.il_image('appointments', 'wide', 'pending wide', 'pending');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok((SELECT string_agg(alt_text, ',') FROM public.image_library) = 'approved hero',
  'companies see approved library images only');
SELECT tests.ok(public.image_library_categories() = ARRAY['appointments'], 'and which categories have a library');
SELECT tests.throws($$SELECT public.admin_review_library_image((SELECT id FROM public.image_library LIMIT 1), 'retired', 'x')$$, '42501',
  'companies cannot review them');
SELECT tests.login(:admin);
SELECT tests.ok((SELECT count(*) FROM public.image_library) = 2, 'FlyttGo''s administrators see every image');
ROLLBACK;

-- ── Resolution order ───────────────────────────────────────────────────────
BEGIN;
SELECT tests.il_template('salon-a');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
CREATE TEMP TABLE m0 ON COMMIT DROP AS SELECT public.site_template_image_map('salon-a', NULL) AS m;
SELECT tests.ok((SELECT m ->> 'mode' = 'assets' AND m ->> 'category' = 'appointments' FROM m0),
  'while the category has no approved library image, the template''s assets are used as before');
SELECT tests.ok((SELECT tests.il_sources(m) FROM m0) = 'hero=assets map=fallback services.1=assets services.2=fallback services.3=fallback team.1=fallback',
  'each slot takes its asset, looked up as the renderer always did (key, key without its number, key.1); a slot with none is a neutral block');
SELECT tests.ok((SELECT m -> 'images' -> 'hero' ->> 'url' LIKE '%/shared/containers-1.jpg' FROM m0), 'with the asset''s address');
RESET ROLE;
-- Approved library images, but of another category, and unapproved ones of this category.
SELECT tests.il_image('transport', 'hero', 'moving hero');
SELECT tests.il_image('appointments', 'hero', 'pending hero', 'pending');
SELECT tests.il_image('appointments', 'wide', 'rejected wide', 'rejected');
SELECT tests.il_image('appointments', 'portrait', 'retired portrait', 'retired');
SET LOCAL ROLE service_role;
SELECT tests.ok(public.site_template_image_map('salon-a', NULL) ->> 'mode' = 'assets',
  'another category''s images, and pending, rejected or retired ones, never start the library');
RESET ROLE;
SELECT tests.il_image('appointments', 'hero', 'salon hero 1');
SELECT tests.il_image('appointments', 'wide', 'salon wide 1');
SET LOCAL ROLE service_role;
CREATE TEMP TABLE m1 ON COMMIT DROP AS SELECT public.site_template_image_map('salon-a', NULL) AS m;
SELECT tests.ok((SELECT m ->> 'mode' FROM m1) = 'library'
                AND (SELECT tests.il_sources(m) FROM m1) = 'hero=library map=fallback services.1=library services.2=library services.3=library team.1=fallback',
  'from the category''s first approved image on, the shared assets are no longer used: library images or the neutral block');
SELECT tests.ok((SELECT tests.il_pick(m, 'hero') = 'salon hero 1' FROM m1),
  'the hero takes the category''s hero image (never the other category''s, never an unapproved one)');
SELECT tests.ok((SELECT bool_and(tests.il_pick(m, k) IN ('salon hero 1', 'salon wide 1')) FROM m1, unnest(ARRAY['services.1', 'services.2', 'services.3']) k),
  'wide slots take wide images, or hero ones when the wide ones are used');
SELECT tests.ok((SELECT m -> 'images' -> 'hero' ->> 'bucket' = 'site-image-library' AND m -> 'images' -> 'hero' ->> 'path' ~ '^appointments/[0-9a-f]{64}\.jpg$'
                        AND m -> 'images' -> 'hero' ->> 'alt' = 'salon hero 1' AND NOT (m -> 'images' -> 'hero' ? 'url') FROM m1),
  'a library image comes as its bucket and path, with its alt text');
SELECT tests.ok((SELECT m -> 'images' -> 'map' = '{"source": "fallback", "shape": "map"}' AND m -> 'images' -> 'team.1' = '{"source": "fallback", "shape": "portrait"}' FROM m1),
  'a map never takes a photo, and a portrait slot without a portrait image is a neutral block');
RESET ROLE;
-- The template's own images: approved with a known licence, approved with an unknown one, unreviewed.
INSERT INTO public.site_template_images (template_id, asset_key, slot, url, source, licence, review_status) VALUES
  ('salon-a', 'hero', 'hero', 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/salon-a/own-hero.jpg', 'licensed', 'Licence 7', 'approved'),
  ('salon-a', 'services.1', 'services', 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/shared/containers-2.jpg', 'architect-ai', NULL, 'approved'),
  ('salon-a', 'map', 'map', 'https://flyttgo.supabase.co/storage/v1/object/public/site-template-assets/salon-a/map.jpg', 'own', NULL, 'unreviewed');
SET LOCAL ROLE service_role;
CREATE TEMP TABLE m2 ON COMMIT DROP AS SELECT public.site_template_image_map('salon-a', NULL) AS m;
SELECT tests.ok((SELECT m -> 'images' -> 'hero' ->> 'source' = 'template' AND m -> 'images' -> 'hero' ->> 'url' LIKE '%/salon-a/own-hero.jpg' FROM m2),
  'an approved template image with a known licence comes before the library');
SELECT tests.ok((SELECT m -> 'images' -> 'services.1' ->> 'source' = 'library' AND m -> 'images' -> 'map' ->> 'source' = 'fallback' FROM m2),
  'an imported image whose licence is unknown counts as not approved, even marked approved; an unreviewed one is not used');
RESET ROLE;
UPDATE public.site_templates SET status = 'imported' WHERE id = 'salon-a';
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT public.site_template_image_map('salon-a', NULL)$$, 'P0002', 'a template not offered has no map for companies');
SELECT tests.login(:admin);
SELECT tests.ok(public.site_template_image_map('salon-a', NULL) ->> 'mode' = 'library', 'FlyttGo''s administrators see it while reviewing');
ROLLBACK;

-- ── The choice is deterministic, varies by template, avoids repeats ───────
BEGIN;
SELECT tests.il_template('salon-' || n) FROM generate_series(1, 8) n;
SELECT tests.il_image('appointments', 'hero', 'hero ' || n) FROM generate_series(1, 3) n;
SELECT tests.il_image('appointments', 'wide', 'wide ' || n) FROM generate_series(1, 4) n;
SET LOCAL ROLE service_role;
SELECT tests.as_server();
CREATE TEMP TABLE maps ON COMMIT DROP AS
  SELECT 'salon-' || n AS id, public.site_template_image_map('salon-' || n, NULL) AS m FROM generate_series(1, 8) n;
SELECT tests.ok((SELECT bool_and(m = public.site_template_image_map(id, NULL)) FROM maps),
  'the same template always gets the same photos');
SELECT tests.ok((SELECT count(DISTINCT tests.il_pick(m, 'hero')) >= 2 FROM maps),
  'different templates of a category get different photos');
SELECT tests.ok((SELECT bool_and(cardinality(ARRAY(SELECT DISTINCT tests.il_pick(m, k) FROM unnest(ARRAY['hero', 'services.1', 'services.2', 'services.3']) k)) = 4) FROM maps),
  'no photo repeats on a page while the pool allows (hero and three services pictures, all different)');
RESET ROLE;
-- A new image moves only the slots it wins.
SELECT tests.il_image('appointments', 'wide', 'wide 5');
SET LOCAL ROLE service_role;
SELECT tests.ok((SELECT count(*) FILTER (WHERE tests.il_pick(m, 'hero') = tests.il_pick(public.site_template_image_map(id, NULL), 'hero')) >= 6 FROM maps),
  'adding an image to the pool keeps most templates'' photos');
RESET ROLE;
-- A small pool: repeats only when there is no other way, every slot still filled.
UPDATE public.image_library SET review_status = 'retired' WHERE alt_text NOT IN ('hero 1', 'wide 1');
SET LOCAL ROLE service_role;
CREATE TEMP TABLE small ON COMMIT DROP AS SELECT public.site_template_image_map('salon-1', NULL) AS m;
SELECT tests.ok((SELECT cardinality(ARRAY(SELECT DISTINCT tests.il_pick(m, k) FROM unnest(ARRAY['hero', 'services.1', 'services.2', 'services.3']) k)) = 2
                        AND tests.il_sources(m) = 'hero=library map=fallback services.1=library services.2=library services.3=library team.1=fallback'
                   FROM small),
  'with two photos for four slots, both are used and every slot still has one');
ROLLBACK;

-- ── A company's own images ─────────────────────────────────────────────────
BEGIN;
SELECT tests.il_template('salon-a');
SELECT tests.il_template('moving-a', ARRAY['moving']);
CREATE TEMP TABLE lib ON COMMIT DROP AS SELECT tests.il_image('appointments', 'hero', 'salon hero') AS salon,
                                              tests.il_image('appointments', 'portrait', 'salon portrait') AS portrait,
                                              tests.il_image('transport', 'hero', 'moving hero') AS moving,
                                              tests.il_image('appointments', 'wide', 'pending wide', 'pending') AS pending;
GRANT SELECT ON lib TO authenticated, service_role;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE o ON COMMIT DROP AS SELECT tests.wl_acme('branded') AS id;
GRANT SELECT ON o TO service_role;
SELECT tests.login(:cust1);
SELECT public.set_white_label_site((SELECT id FROM o), 'salon-a', 'Oslo');
-- The owner uploads into the company's own folder.
INSERT INTO storage.objects (bucket_id, name) SELECT 'organization-site-images', id || '/hero-' || repeat('c', 12) || '.webp' FROM o;
SELECT tests.throws($$INSERT INTO storage.objects (bucket_id, name) VALUES ('organization-site-images', 'c0000000-0000-0000-0000-000000000099/hero.webp')$$,
  '42501', 'nobody uploads into another company''s folder');
SELECT tests.throws($$SELECT public.set_organization_site_image((SELECT id FROM o), 'hero', jsonb_build_object('path', (SELECT id FROM o) || '/missing.webp',
                       'mime', 'image/webp', 'sha256', repeat('c', 64), 'width', 1600, 'height', 900))$$, '22023', 'the upload must be there');
SELECT tests.ok((SELECT storage_path IS NOT NULL AND uploaded_by = :cust1 AND alt_text = 'Our salon on Grünerløkka'
                   FROM public.set_organization_site_image((SELECT id FROM o), 'hero', jsonb_build_object(
                     'path', (SELECT id FROM o) || '/hero-' || repeat('c', 12) || '.webp', 'mime', 'image/webp', 'sha256', repeat('c', 64),
                     'width', 1600, 'height', 900, 'alt', 'Our salon on Grünerløkka'))),
  'the owner sets the hero to the company''s own photo, recorded by name');
SELECT tests.throws($$SELECT public.set_organization_site_image((SELECT id FROM o), 'team.1', jsonb_build_object('library_image_id', (SELECT moving FROM lib)))$$,
  '22023', 'a library pick must be of the website''s category');
SELECT tests.throws($$SELECT public.set_organization_site_image((SELECT id FROM o), 'team.1', jsonb_build_object('library_image_id', (SELECT pending FROM lib)))$$,
  '22023', 'and approved');
SELECT tests.ok((SELECT library_image_id = (SELECT portrait FROM lib) FROM public.set_organization_site_image((SELECT id FROM o), 'team.1',
                   jsonb_build_object('library_image_id', (SELECT portrait FROM lib)))),
  'the owner picks an approved library image of the category for the team picture');
SELECT tests.ok((SELECT count(*) = 2 FROM public.organization_events WHERE organization_id = (SELECT id FROM o) AND action = 'white_label.site_image'),
  'each change is in the company''s log');
CREATE TEMP TABLE cm ON COMMIT DROP AS SELECT public.site_template_image_map('salon-a', (SELECT id FROM o)) AS m;
GRANT SELECT ON cm TO service_role;
SELECT tests.ok((SELECT m -> 'images' -> 'hero' ->> 'source' = 'company' AND m -> 'images' -> 'hero' ->> 'bucket' = 'organization-site-images'
                        AND m -> 'images' -> 'hero' ->> 'alt' = 'Our salon on Grünerløkka'
                        AND m -> 'images' -> 'team.1' ->> 'source' = 'company' AND tests.il_pick(m, 'team.1') = 'salon portrait' FROM cm),
  'the company''s own images come first, in its map');
SELECT tests.ok((SELECT tests.il_pick(m, 'services.1') = 'salon hero' FROM cm),
  'and the library fills the rest');
SELECT tests.ok(public.site_template_image_map('salon-a', NULL) -> 'images' -> 'hero' ->> 'source' = 'library',
  'without the company, the template shows the library''s image');
-- Members read, the booker cannot change, other people see nothing.
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM public.organization_site_images) = 2, 'the company''s members see its images');
SELECT tests.ok(public.site_template_image_map('salon-a', (SELECT id FROM o)) -> 'images' -> 'hero' ->> 'source' = 'company',
  'and its map, for the preview');
SELECT tests.throws($$SELECT public.reset_organization_site_image((SELECT id FROM o), 'hero')$$, '42501', 'a booker cannot change them');
SELECT tests.throws($$INSERT INTO storage.objects (bucket_id, name) SELECT 'organization-site-images', id || '/x.png' FROM o$$, '42501',
  'nor upload');
SELECT tests.login(:cust2);
SELECT tests.ok((SELECT count(*) FROM public.organization_site_images) = 0, 'another person sees none of them');
SELECT tests.ok((SELECT count(*) FROM storage.objects WHERE bucket_id = 'organization-site-images') = 0, 'nor their files');
SELECT tests.throws($$SELECT public.site_template_image_map('salon-a', (SELECT id FROM o))$$, '42501', 'nor the company''s map');
SELECT tests.throws($$SELECT public.set_organization_site_image((SELECT id FROM o), 'hero', jsonb_build_object('library_image_id', (SELECT salon FROM lib)))$$,
  '42501', 'and cannot change them');
SELECT tests.throws($$INSERT INTO public.organization_site_images (organization_id, slot_key, library_image_id) SELECT id, 'hero', (SELECT salon FROM lib) FROM o$$,
  '42501', 'not even straight into the table');
SELECT tests.login(:admin);
SELECT tests.throws($$SELECT public.set_organization_site_image((SELECT id FROM o), 'hero', jsonb_build_object('library_image_id', (SELECT salon FROM lib)))$$,
  '42501', 'FlyttGo''s administrators do not change a company''s images either');
-- A picked library image that is retired no longer shows; the company's choice falls back.
SELECT public.admin_review_library_image((SELECT portrait FROM lib), 'retired', 'Licence withdrawn');
SET LOCAL ROLE service_role;
SELECT tests.as_server();
SELECT tests.ok(public.site_template_image_map('salon-a', (SELECT id FROM o)) -> 'images' -> 'team.1' ->> 'source' = 'fallback',
  'a picked image retired later is no longer shown');
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust1);
SELECT tests.ok(public.reset_organization_site_image((SELECT id FROM o), 'hero'), 'the owner resets the hero');
SELECT tests.ok(public.site_template_image_map('salon-a', (SELECT id FROM o)) -> 'images' -> 'hero' ->> 'source' = 'library',
  'and it is the default again');
SELECT tests.ok(NOT public.reset_organization_site_image((SELECT id FROM o), 'hero'), 'resetting twice changes nothing');
-- Another template outside the category: the library of the TEMPLATE's category.
SELECT public.set_white_label_site((SELECT id FROM o), 'moving-a', 'Oslo');
SELECT tests.ok((SELECT tests.il_pick(m, 'hero') = 'moving hero' FROM (SELECT public.site_template_image_map('moving-a', (SELECT id FROM o)) AS m) x),
  'a company on a template of another category gets that template''s category''s photos');
ROLLBACK;
\echo 'image library: all tests passed'
