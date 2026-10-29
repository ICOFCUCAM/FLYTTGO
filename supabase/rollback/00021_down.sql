-- ============================================================================
-- Roll back 00021_template_quality.sql
-- ============================================================================
-- Run first (before the rollbacks of earlier migrations). Tested by run.sh:
-- afterwards the schema and function bodies are exactly as before 00021.
--
-- DATA LOSS — READ FIRST. Drops each template's features (the importer
-- finds them again on the next import). The templates, their pages and
-- assets (the thumbnails among them) stay.
-- ============================================================================

ALTER TABLE public.site_templates DROP COLUMN IF EXISTS page_count;
ALTER TABLE public.site_templates DROP COLUMN IF EXISTS features;

-- As in 00009.
-- The importer stores a template (server only). A changed template needs
-- a new review.
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
  INSERT INTO public.site_templates (id, name, industry, style, pages, assets, source, source_id, content_flags)
  VALUES (p ->> 'id', p ->> 'name', ARRAY(SELECT jsonb_array_elements_text(coalesce(p -> 'industry', '[]'::jsonb))),
          p ->> 'style', p -> 'pages', coalesce(p -> 'assets', '[]'::jsonb), coalesce(p ->> 'source', 'architect-ai'),
          p ->> 'source_id', coalesce(p -> 'flags', '[]'::jsonb))
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, industry = EXCLUDED.industry, style = EXCLUDED.style, assets = EXCLUDED.assets,
    pages = EXCLUDED.pages, content_flags = EXCLUDED.content_flags, source_id = EXCLUDED.source_id,
    status = CASE WHEN site_templates.pages IS DISTINCT FROM EXCLUDED.pages THEN 'imported' ELSE site_templates.status END,
    reviewed_by = CASE WHEN site_templates.pages IS DISTINCT FROM EXCLUDED.pages THEN NULL ELSE site_templates.reviewed_by END,
    reviewed_at = CASE WHEN site_templates.pages IS DISTINCT FROM EXCLUDED.pages THEN NULL ELSE site_templates.reviewed_at END,
    updated_at = now()
  RETURNING * INTO t;
  RETURN t;
END $$;
