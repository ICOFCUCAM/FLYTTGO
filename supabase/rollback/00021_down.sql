-- ============================================================================
-- Roll back 00021_template_quality.sql
-- ============================================================================
-- Run first (before the rollbacks of earlier migrations). Tested by run.sh:
-- afterwards the schema and function bodies are exactly as before 00021.
--
-- DATA LOSS — READ FIRST. Drops each template's features and automated
-- check results (the importer finds them again on the next import), the
-- record of approvals given despite failing checks (export
-- site_templates.check_overrides first if it is needed) and the image
-- metadata (site_template_images: sources, licences, generation, review;
-- export it first). The templates, their pages, assets (the thumbnails
-- and replaced images among them) and review status stay; uploaded images
-- stay in storage.
-- ============================================================================

DROP FUNCTION IF EXISTS public.admin_review_site_template_image(text, text, text, text);
DROP FUNCTION IF EXISTS public.admin_replace_site_template_image(text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.site_template_store_images(text, jsonb);
DROP POLICY IF EXISTS site_template_assets_admin_insert ON storage.objects;
DROP TABLE IF EXISTS public.site_template_images;
DROP FUNCTION IF EXISTS public.admin_review_site_template(text, boolean, boolean, text, text);
DROP FUNCTION IF EXISTS public.admin_record_site_template_page_checks(text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.record_site_template_checks(text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.site_template_checks_valid(jsonb);
DROP FUNCTION IF EXISTS public.site_template_failing_checks(jsonb);
ALTER TABLE public.site_templates DROP CONSTRAINT IF EXISTS site_templates_checks_shape;
ALTER TABLE public.site_templates DROP COLUMN IF EXISTS check_overrides;
ALTER TABLE public.site_templates DROP COLUMN IF EXISTS checks;
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

-- An administrator corrects a page's wording (replacing sample prices,
-- reviews and claims). The page must stay clean; an approved template
-- goes back to review.
CREATE OR REPLACE FUNCTION public.admin_update_site_template_page(p_id text, p_path text, p_html text)
RETURNS public.site_templates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t public.site_templates%ROWTYPE; v_problems text[] := public.site_template_html_problems(p_html); v_i int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'templates: platform administrators only' USING ERRCODE = '42501'; END IF;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'templates: the page may not contain: %', array_to_string(v_problems, ', ') USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.site_templates WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'templates: no such template' USING ERRCODE = 'P0002'; END IF;
  SELECT i - 1 INTO v_i FROM jsonb_array_elements(t.pages) WITH ORDINALITY AS e(pg, i) WHERE pg ->> 'path' = p_path;
  IF v_i IS NULL THEN RAISE EXCEPTION 'templates: the template has no page %', p_path USING ERRCODE = 'P0002'; END IF;
  UPDATE public.site_templates SET pages = jsonb_set(pages, ARRAY[v_i::text, 'html'], to_jsonb(p_html)),
         status = CASE WHEN status = 'approved' THEN 'imported' ELSE status END,
         reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
   WHERE id = p_id RETURNING * INTO t;
  RETURN t;
END $$;

-- An administrator approves a template after checking its wording, or
-- retires it. Approval is refused while any page has a price or anything
-- unclean, and needs the administrator to confirm the check.
CREATE OR REPLACE FUNCTION public.admin_review_site_template(p_id text, p_approve boolean, p_content_checked boolean, p_note text)
RETURNS public.site_templates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t public.site_templates%ROWTYPE; v_prices int; v_bad int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'templates: platform administrators only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public.site_templates WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'templates: no such template' USING ERRCODE = 'P0002'; END IF;
  IF p_approve THEN
    SELECT coalesce(sum(public.site_template_price_hits(pg ->> 'html')), 0),
           count(*) FILTER (WHERE cardinality(public.site_template_html_problems(pg ->> 'html')) > 0)
      INTO v_prices, v_bad FROM jsonb_array_elements(t.pages) pg;
    IF v_bad > 0 THEN RAISE EXCEPTION 'templates: a page is not clean' USING ERRCODE = '55000'; END IF;
    IF v_prices > 0 THEN
      RAISE EXCEPTION 'templates: remove the % sample price(s) first: prices come from the booking page', v_prices USING ERRCODE = '55000';
    END IF;
    IF p_content_checked IS NOT TRUE THEN
      RAISE EXCEPTION 'templates: confirm that sample reviews, figures and claims were removed or made true' USING ERRCODE = '55000';
    END IF;
  END IF;
  UPDATE public.site_templates SET status = CASE WHEN p_approve THEN 'approved' ELSE 'retired' END,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
   WHERE id = p_id RETURNING * INTO t;
  RETURN t;
END $$;
