-- ============================================================================
-- FlyttGo — the website template catalogue: thumbnails, features, quality
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00009 (docs/WHITE_LABEL.md →
-- Website templates). Extends the template library in place:
--
--   * Cards: each template's features (pricing, gallery, team…), found by
--     the importer in its pages, and its number of pages (computed). The
--     thumbnail is an asset with the key 'thumbnail' (no new column).
--
-- Safe to re-run. Rolled back by supabase/rollback/00021_down.sql.
-- ============================================================================

-- ── 1. What the cards show ─────────────────────────────────────────────────
ALTER TABLE public.site_templates ADD COLUMN IF NOT EXISTS features text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.site_templates ADD COLUMN IF NOT EXISTS page_count integer
  GENERATED ALWAYS AS (jsonb_array_length(pages)) STORED;

-- The importer stores a template (server only), now with its features. A
-- changed template needs a new review (as in 00009).
CREATE OR REPLACE FUNCTION public.import_site_template(p jsonb)
RETURNS public.site_templates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t public.site_templates%ROWTYPE; pg jsonb; v_problems text[];
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'templates: the importer (server) only' USING ERRCODE = '42501'; END IF;
  FOR pg IN SELECT * FROM jsonb_array_elements(p -> 'pages') LOOP
    v_problems := public.site_template_html_problems(pg ->> 'html');
    IF cardinality(v_problems) > 0 OR coalesce(pg ->> 'path', '') !~ '^/' THEN
      RAISE EXCEPTION 'templates: page % of % is not clean (%)', pg ->> 'path', p ->> 'id', array_to_string(v_problems, ', ')
        USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO public.site_templates (id, name, industry, style, pages, assets, source, source_id, content_flags, features)
  VALUES (p ->> 'id', p ->> 'name', ARRAY(SELECT jsonb_array_elements_text(coalesce(p -> 'industry', '[]'::jsonb))),
          p ->> 'style', p -> 'pages', coalesce(p -> 'assets', '[]'::jsonb), coalesce(p ->> 'source', 'architect-ai'),
          p ->> 'source_id', coalesce(p -> 'flags', '[]'::jsonb),
          ARRAY(SELECT jsonb_array_elements_text(coalesce(p -> 'features', '[]'::jsonb))))
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, industry = EXCLUDED.industry, style = EXCLUDED.style, assets = EXCLUDED.assets,
    pages = EXCLUDED.pages, content_flags = EXCLUDED.content_flags, source_id = EXCLUDED.source_id,
    features = EXCLUDED.features,
    status = CASE WHEN site_templates.pages IS DISTINCT FROM EXCLUDED.pages THEN 'imported' ELSE site_templates.status END,
    reviewed_by = CASE WHEN site_templates.pages IS DISTINCT FROM EXCLUDED.pages THEN NULL ELSE site_templates.reviewed_by END,
    reviewed_at = CASE WHEN site_templates.pages IS DISTINCT FROM EXCLUDED.pages THEN NULL ELSE site_templates.reviewed_at END,
    updated_at = now()
  RETURNING * INTO t;
  RETURN t;
END $$;
