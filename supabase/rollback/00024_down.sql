-- ============================================================================
-- Roll back 00024_thumbnail_redraw.sql
-- ============================================================================
-- Run first (before the rollback of 00023). Tested by run.sh: afterwards
-- the schema and function bodies are exactly as before 00024.
--
-- No table or column is added by 00024, so nothing is dropped but its
-- functions. Redrawn thumbnails stay the templates' thumbnails (their files
-- stay in storage); the record of the images each was drawn with
-- ("images", "drawn_at" in the 'thumbnail' asset) is removed, so the assets
-- are as 00023 knows them.
-- ============================================================================

UPDATE public.site_templates t SET assets = (
  SELECT jsonb_agg(CASE WHEN a ->> 'key' = 'thumbnail' THEN a - 'images' - 'drawn_at' ELSE a END ORDER BY n)
    FROM jsonb_array_elements(t.assets) WITH ORDINALITY AS e(a, n))
 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(t.assets) a WHERE a ->> 'key' = 'thumbnail' AND (a ? 'images' OR a ? 'drawn_at'));

DROP FUNCTION IF EXISTS public.record_site_template_thumbnail(text, text, text);
DROP FUNCTION IF EXISTS public.stale_site_template_thumbnails();
DROP FUNCTION IF EXISTS public.admin_thumbnail_stale_counts();
DROP FUNCTION IF EXISTS public.admin_site_template_thumbnails(text);
DROP FUNCTION IF EXISTS public.site_template_thumbnail_states(boolean);
DROP FUNCTION IF EXISTS public.site_template_assets_map(text);
DROP FUNCTION IF EXISTS public.site_template_images_hash(jsonb);
DROP FUNCTION IF EXISTS public.site_template_images_key(jsonb);
