-- ============================================================================
-- FlyttGo — gallery thumbnails that know which photos they were drawn with
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00023. The owner's decision of
-- 2026-10-30 (docs/DECISIONS.md #47; docs/WHITE_LABEL.md → Image library,
-- "Thumbnails"): the gallery's thumbnails are drawn again with the photos
-- the image library gives each template.
--
-- A thumbnail (the template's asset 'thumbnail', site-template-assets/<id>/…)
-- records the images it was drawn with: "images", the SHA-256 of the
-- picture key of the resolved map without a company
-- (site_template_images_key(): per slot, in key order, the address or
-- stored file it shows and its focal point; thumbnailImagesKey() in
-- _shared/image-library.ts writes the same text). A thumbnail is
--
--   fresh    its recorded images are those the template shows now;
--   stale    they differ: a library image of its category was approved,
--            rejected, retired or edited, or the template's own image
--            changed, since it was drawn (computed at each read from
--            site_template_image_map(); nothing is flagged by hand);
--   missing  the template has no thumbnail.
--
-- A thumbnail drawn before this migration (no "images" recorded) counts as
-- drawn with the template's own assets as they are now (the importer drew
-- them so): it is stale once its category has library photos, or once one of
-- its slots shows another image than its asset.
--
-- The redraw (scripts/redraw-thumbnails.ts, run where a browser is: the
-- database and the Edge Functions cannot draw a page) stores the new picture
-- under a new name (<id>/thumbnail-<12 hex of the images>.jpg, so browsers
-- never show the old one) and records it with record_site_template_thumbnail
-- (server only). A re-import replaces the assets and with them the record.
--
-- Safe to re-run. Rolled back by supabase/rollback/00024_down.sql.
-- ============================================================================

-- ── 1. What a thumbnail shows: the picture key of a resolved map ───────────
-- One line per slot, in key order (byte order; keys are [A-Za-z0-9._-]):
--   <key>=<picture>|<focal x × 1000>|<focal y × 1000>
-- where the picture is the address (template images and assets), the stored
-- file as <bucket>/<path> (library and company images) or '-' (the neutral
-- block). Alt texts and sources are left out: they do not change the picture.
CREATE OR REPLACE FUNCTION public.site_template_images_key(p_map jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT coalesce(string_agg(
           e.key || '=' || CASE WHEN nullif(e.value ->> 'url', '') IS NOT NULL THEN e.value ->> 'url'
                                WHEN nullif(e.value ->> 'path', '') IS NOT NULL THEN coalesce(e.value ->> 'bucket', '') || '/' || (e.value ->> 'path')
                                ELSE '-' END
           || '|' || coalesce(round((e.value ->> 'focal_x')::numeric * 1000)::int::text, '')
           || '|' || coalesce(round((e.value ->> 'focal_y')::numeric * 1000)::int::text, ''),
           E'\n' ORDER BY e.key COLLATE "C"), '')
    FROM jsonb_each(CASE WHEN jsonb_typeof(p_map -> 'images') = 'object' THEN p_map -> 'images' ELSE '{}'::jsonb END) e;
$$;

-- Its SHA-256, as recorded with a thumbnail.
CREATE OR REPLACE FUNCTION public.site_template_images_hash(p_map jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT encode(sha256(convert_to(public.site_template_images_key(p_map), 'UTF8')), 'hex');
$$;

-- The map a template's own assets give (what the importer draws with):
-- each slot's asset, looked up as the renderer does (the key, the key
-- without its number, the key with .1), else nothing.
CREATE OR REPLACE FUNCTION public.site_template_assets_map(p_template text)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('images', coalesce(jsonb_object_agg(s.slot_key,
           CASE WHEN u.url IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('url', u.url) END), '{}'::jsonb))
    FROM public.site_template_image_slots(p_template) s
    LEFT JOIN LATERAL (
      SELECT a ->> 'url' AS url
        FROM public.site_templates t CROSS JOIN LATERAL jsonb_array_elements(t.assets) WITH ORDINALITY AS e(a, n)
       WHERE t.id = p_template AND a ->> 'key' IN (s.slot_key, regexp_replace(s.slot_key, '\.\d+$', ''), s.slot_key || '.1')
       ORDER BY CASE a ->> 'key' WHEN s.slot_key THEN 0 WHEN regexp_replace(s.slot_key, '\.\d+$', '') THEN 1 ELSE 2 END, n
       LIMIT 1) u ON true;
$$;

REVOKE ALL ON FUNCTION public.site_template_assets_map(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.site_template_images_key(jsonb), public.site_template_images_hash(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.site_template_images_key(jsonb), public.site_template_images_hash(jsonb) TO authenticated, service_role;


-- ── 2. Each template's thumbnail: fresh, stale or missing ──────────────────
-- Every template that is not retired (and has a category: health templates
-- are never imported), or only the approved ones. Computed at each call.
-- Not callable by users: through the two functions below.
CREATE OR REPLACE FUNCTION public.site_template_thumbnail_states(p_approved_only boolean DEFAULT false)
RETURNS TABLE (template_id text, name text, category text, status text, mode text, thumbnail_url text,
               drawn_with text, images text, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT t.id, t.name, public.site_template_category(t.industry), t.status, m.map ->> 'mode', th.a ->> 'url',
         th.a ->> 'images', public.site_template_images_hash(m.map),
         CASE WHEN th.a IS NULL THEN 'missing'
              WHEN coalesce(nullif(th.a ->> 'images', ''), public.site_template_images_hash(public.site_template_assets_map(t.id)))
                   = public.site_template_images_hash(m.map) THEN 'fresh'
              ELSE 'stale' END
    FROM public.site_templates t
    CROSS JOIN LATERAL (SELECT public.site_template_image_map(t.id, NULL) AS map) m
    LEFT JOIN LATERAL (SELECT a FROM jsonb_array_elements(t.assets) a WHERE a ->> 'key' = 'thumbnail' LIMIT 1) th ON true
   WHERE t.status <> 'retired' AND public.site_template_category(t.industry) IS NOT NULL
     AND (NOT p_approved_only OR t.status = 'approved')
   ORDER BY t.id;
$$;
REVOKE ALL ON FUNCTION public.site_template_thumbnail_states(boolean) FROM PUBLIC, anon, authenticated;

-- FlyttGo's administrators and the redraw (server): every template's
-- thumbnail with its state, the images it was drawn with and the images it
-- shows now; optionally one category.
CREATE OR REPLACE FUNCTION public.admin_site_template_thumbnails(p_category text DEFAULT NULL)
RETURNS TABLE (template_id text, name text, category text, status text, mode text, thumbnail_url text,
               drawn_with text, images text, state text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_server()) THEN
    RAISE EXCEPTION 'thumbnails: FlyttGo administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.site_template_thumbnail_states(false) s WHERE p_category IS NULL OR s.category = p_category;
END $$;

-- The same, counted per category (Admin → White label → Image library →
-- Thumbnails): templates, and how many thumbnails are fresh, stale, missing.
CREATE OR REPLACE FUNCTION public.admin_thumbnail_stale_counts()
RETURNS TABLE (category text, templates integer, fresh integer, stale integer, missing integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_server()) THEN
    RAISE EXCEPTION 'thumbnails: FlyttGo administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH s AS (SELECT * FROM public.site_template_thumbnail_states(false))
  SELECT c, (SELECT count(*)::int FROM s WHERE s.category = c),
         (SELECT count(*)::int FROM s WHERE s.category = c AND s.state = 'fresh'),
         (SELECT count(*)::int FROM s WHERE s.category = c AND s.state = 'stale'),
         (SELECT count(*)::int FROM s WHERE s.category = c AND s.state = 'missing')
    FROM unnest(public.site_image_categories()) WITH ORDINALITY AS u(c, n) ORDER BY n;
END $$;

-- Signed-in users (the gallery): the approved templates whose thumbnail is
-- stale, by id only. Their cards are drawn live with the resolved images
-- until the thumbnail is drawn again.
CREATE OR REPLACE FUNCTION public.stale_site_template_thumbnails()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(array_agg(s.template_id ORDER BY s.template_id), '{}'::text[])
    FROM public.site_template_thumbnail_states(true) s WHERE s.state = 'stale';
$$;


-- ── 3. Recording a redrawn thumbnail (the redraw, server only) ─────────────
-- The new picture, already uploaded to site-template-assets/<id>/
-- thumbnail-<hex>.jpg, becomes the template's thumbnail with the images it
-- was drawn with. The template's review status does not change (the
-- thumbnail is a picture of the page, not its content); the earlier file
-- stays in storage.
CREATE OR REPLACE FUNCTION public.record_site_template_thumbnail(p_template text, p_path text, p_images text)
RETURNS public.site_templates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE t public.site_templates%ROWTYPE; v_base text; v_entry jsonb;
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'thumbnails: the redraw (server) only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public.site_templates WHERE id = p_template FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'thumbnails: no such template' USING ERRCODE = 'P0002'; END IF;
  IF coalesce(p_images, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'thumbnails: the SHA-256 of the images it was drawn with' USING ERRCODE = '22023';
  END IF;
  IF left(coalesce(p_path, ''), length(p_template) + 1) <> p_template || '/'
     OR substr(p_path, length(p_template) + 2) !~ '^thumbnail-[0-9a-f]{12,64}\.jpg$'
     OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'site-template-assets' AND name = p_path) THEN
    RAISE EXCEPTION 'thumbnails: upload the picture to site-template-assets/%/thumbnail-<hex>.jpg first', p_template USING ERRCODE = '22023';
  END IF;
  -- The bucket's public address, from the template's other images.
  SELECT substring(a ->> 'url' FROM '^(https://[^/]+/storage/v1/object/public/site-template-assets/)') INTO v_base
    FROM jsonb_array_elements(t.assets) a WHERE a ->> 'url' ~ '^https://[^/]+/storage/v1/object/public/site-template-assets/' LIMIT 1;
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'thumbnails: the template''s images are not in FlyttGo''s storage yet (import it with --to-flyttgo first)' USING ERRCODE = '55000';
  END IF;
  v_entry := jsonb_build_object('key', 'thumbnail', 'url', v_base || p_path, 'images', p_images, 'drawn_at', now());
  UPDATE public.site_templates SET
    assets = CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(assets) a WHERE a ->> 'key' = 'thumbnail')
                  THEN (SELECT jsonb_agg(CASE WHEN a ->> 'key' = 'thumbnail' THEN v_entry ELSE a END ORDER BY n)
                          FROM jsonb_array_elements(assets) WITH ORDINALITY AS e(a, n))
                  ELSE assets || jsonb_build_array(v_entry) END,
    updated_at = now()
   WHERE id = p_template RETURNING * INTO t;
  RETURN t;
END $$;

REVOKE ALL ON FUNCTION
  public.admin_site_template_thumbnails(text), public.admin_thumbnail_stale_counts(),
  public.stale_site_template_thumbnails(), public.record_site_template_thumbnail(text, text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.admin_site_template_thumbnails(text), public.admin_thumbnail_stale_counts(),
  public.stale_site_template_thumbnails(), public.record_site_template_thumbnail(text, text, text)
TO authenticated, service_role;
