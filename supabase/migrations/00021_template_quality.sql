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
--   * Quality gate: the importer's automated checks are stored with the
--     template; approval is refused while one fails or is stale (a page
--     edited since), unless the administrator gives a reason, which is
--     kept. A re-imported or edited template still needs a new review.
--
-- Safe to re-run. Rolled back by supabase/rollback/00021_down.sql.
-- ============================================================================

-- ── 1. What the cards show ─────────────────────────────────────────────────
ALTER TABLE public.site_templates ADD COLUMN IF NOT EXISTS features text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.site_templates ADD COLUMN IF NOT EXISTS page_count integer
  GENERATED ALWAYS AS (jsonb_array_length(pages)) STORED;

-- ── 2. The quality gate ─────────────────────────────────────────────────────
-- The importer's automated checks (supabase/functions/_shared/
-- template-quality.ts): {"version": 1, "ran_at": …, "results": [{"id",
-- "page", "status": pass | fail | not_run | stale, "detail", "items"}]}.
-- Approval is refused while a check fails or is stale, unless the
-- administrator gives a reason; each such approval is kept in
-- check_overrides (who, when, why, which checks).
ALTER TABLE public.site_templates ADD COLUMN IF NOT EXISTS checks jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.site_templates ADD COLUMN IF NOT EXISTS check_overrides jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_templates_checks_shape') THEN
    ALTER TABLE public.site_templates ADD CONSTRAINT site_templates_checks_shape
      CHECK (jsonb_typeof(checks) = 'object' AND jsonb_typeof(check_overrides) = 'array');
  END IF;
END $$;

-- The checks that stop approval: failed or stale ('not_checked' when the
-- template was never checked).
CREATE OR REPLACE FUNCTION public.site_template_failing_checks(p_checks jsonb)
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN jsonb_typeof(p_checks -> 'results') IS DISTINCT FROM 'array' THEN ARRAY['not_checked']
         ELSE ARRAY(SELECT DISTINCT r ->> 'id' FROM jsonb_array_elements(p_checks -> 'results') r
                     WHERE r ->> 'status' IN ('fail', 'stale') ORDER BY 1) END;
$$;

-- Results must look like the importer's.
CREATE OR REPLACE FUNCTION public.site_template_checks_valid(p_results jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_typeof(p_results) = 'array' AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_results) r
     WHERE jsonb_typeof(r) <> 'object'
        OR coalesce(r ->> 'id', '') NOT IN ('unsafe_html', 'renders', 'overflow', 'broken_images', 'image_alt', 'booking_links', 'sample_content')
        OR coalesce(r ->> 'status', '') NOT IN ('pass', 'fail', 'not_run', 'stale')
        OR coalesce(r ->> 'page', '') !~ '^/');
$$;

-- The importer stores a template (server only), with its features and
-- checks. A changed template needs a new review (as in 00009).
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
  IF p ? 'checks' AND NOT public.site_template_checks_valid(coalesce(p -> 'checks' -> 'results', '[]'::jsonb)) THEN
    RAISE EXCEPTION 'templates: the checks of % are not in the expected form', p ->> 'id' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.site_templates (id, name, industry, style, pages, assets, source, source_id, content_flags, features, checks)
  VALUES (p ->> 'id', p ->> 'name', ARRAY(SELECT jsonb_array_elements_text(coalesce(p -> 'industry', '[]'::jsonb))),
          p ->> 'style', p -> 'pages', coalesce(p -> 'assets', '[]'::jsonb), coalesce(p ->> 'source', 'architect-ai'),
          p ->> 'source_id', coalesce(p -> 'flags', '[]'::jsonb),
          ARRAY(SELECT jsonb_array_elements_text(coalesce(p -> 'features', '[]'::jsonb))), coalesce(p -> 'checks', '{}'::jsonb))
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, industry = EXCLUDED.industry, style = EXCLUDED.style, assets = EXCLUDED.assets,
    pages = EXCLUDED.pages, content_flags = EXCLUDED.content_flags, source_id = EXCLUDED.source_id,
    features = EXCLUDED.features, checks = EXCLUDED.checks,
    status = CASE WHEN site_templates.pages IS DISTINCT FROM EXCLUDED.pages THEN 'imported' ELSE site_templates.status END,
    reviewed_by = CASE WHEN site_templates.pages IS DISTINCT FROM EXCLUDED.pages THEN NULL ELSE site_templates.reviewed_by END,
    reviewed_at = CASE WHEN site_templates.pages IS DISTINCT FROM EXCLUDED.pages THEN NULL ELSE site_templates.reviewed_at END,
    updated_at = now()
  RETURNING * INTO t;
  RETURN t;
END $$;

-- The importer's re-check of a stored template (--recheck, server only):
-- new results, and the content flags found again.
CREATE OR REPLACE FUNCTION public.record_site_template_checks(p_id text, p_checks jsonb, p_flags jsonb)
RETURNS public.site_templates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t public.site_templates%ROWTYPE;
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'templates: the importer (server) only' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_checks) IS DISTINCT FROM 'object' OR NOT public.site_template_checks_valid(coalesce(p_checks -> 'results', 'null'::jsonb)) THEN
    RAISE EXCEPTION 'templates: the checks are not in the expected form' USING ERRCODE = '22023';
  END IF;
  UPDATE public.site_templates SET checks = p_checks, content_flags = coalesce(p_flags, content_flags), updated_at = now()
   WHERE id = p_id RETURNING * INTO t;
  IF NOT FOUND THEN RAISE EXCEPTION 'templates: no such template' USING ERRCODE = 'P0002'; END IF;
  RETURN t;
END $$;

-- An administrator corrects a page's wording (as in 00009). The page's
-- check results become stale: the admin panel records the checks that need
-- no browser again at once (admin_record_site_template_page_checks); the
-- browser's wait for a re-check or an override.
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
         reviewed_by = NULL, reviewed_at = NULL, updated_at = now(),
         checks = CASE WHEN jsonb_typeof(checks -> 'results') = 'array' THEN jsonb_set(checks, '{results}', (
                    SELECT coalesce(jsonb_agg(CASE WHEN r ->> 'page' = p_path AND r ->> 'status' IN ('pass', 'fail')
                                                   THEN r || jsonb_build_object('status', 'stale', 'detail', 'The page was edited after this check.')
                                                   ELSE r END), '[]'::jsonb)
                      FROM jsonb_array_elements(checks -> 'results') r)) ELSE checks END
   WHERE id = p_id RETURNING * INTO t;
  RETURN t;
END $$;

-- The admin panel records an edited page's checks that need no browser
-- (unsafe HTML, images, alt texts, booking links, sample content) and the
-- page's content flags, found again in the browser from the saved page.
-- The browser's checks (renders, overflow) stay as they are.
CREATE OR REPLACE FUNCTION public.admin_record_site_template_page_checks(p_id text, p_path text, p_results jsonb, p_flags jsonb)
RETURNS public.site_templates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t public.site_templates%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'templates: platform administrators only' USING ERRCODE = '42501'; END IF;
  IF NOT public.site_template_checks_valid(p_results) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_results) r
        WHERE r ->> 'page' <> p_path OR r ->> 'id' IN ('renders', 'overflow') OR r ->> 'status' NOT IN ('pass', 'fail')) THEN
    RAISE EXCEPTION 'templates: only this page''s checks that need no browser, as pass or fail' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_flags, '[]'::jsonb)) <> 'array' OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(p_flags, '[]'::jsonb)) f WHERE f ->> 'page' <> p_path) THEN
    RAISE EXCEPTION 'templates: only this page''s flags' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.site_templates WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'templates: no such template' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.pages) pg WHERE pg ->> 'path' = p_path) THEN
    RAISE EXCEPTION 'templates: the template has no page %', p_path USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.site_templates SET
    checks = jsonb_build_object('version', 1, 'ran_at', now())
             || (checks - 'results')
             || jsonb_build_object('results', coalesce((
                  SELECT jsonb_agg(r) FROM jsonb_array_elements(coalesce(checks -> 'results', '[]'::jsonb)) r
                   WHERE NOT (r ->> 'page' = p_path AND (r ->> 'id') IN (SELECT n ->> 'id' FROM jsonb_array_elements(p_results) n))), '[]'::jsonb)
                  || p_results),
    content_flags = coalesce((SELECT jsonb_agg(f) FROM jsonb_array_elements(content_flags) f
                               WHERE f ->> 'page' <> p_path OR f ->> 'kind' = 'hidden'), '[]'::jsonb) || coalesce(p_flags, '[]'::jsonb),
    updated_at = now()
   WHERE id = p_id RETURNING * INTO t;
  RETURN t;
END $$;

-- Approval with the gate: as in 00009 (no price, nothing unclean, the
-- reviewer confirms the wording), and no automated check failing or stale
-- unless the administrator gives a reason, which is kept. Unsafe HTML is
-- never overridden (the page is refused above).
CREATE OR REPLACE FUNCTION public.admin_review_site_template(p_id text, p_approve boolean, p_content_checked boolean, p_note text,
                                                             p_override_reason text)
RETURNS public.site_templates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t public.site_templates%ROWTYPE; v_prices int; v_bad int; v_failing text[];
        v_reason text := nullif(btrim(coalesce(p_override_reason, '')), '');
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
    v_failing := public.site_template_failing_checks(t.checks);
    IF cardinality(v_failing) > 0 THEN
      IF v_reason IS NULL THEN
        RAISE EXCEPTION 'templates: automated checks fail (%): fix the pages and check again, or give a reason to approve anyway',
          array_to_string(v_failing, ', ') USING ERRCODE = '55000';
      END IF;
      t.check_overrides := t.check_overrides || jsonb_build_array(jsonb_build_object(
        'at', now(), 'by', auth.uid(), 'reason', v_reason, 'checks', to_jsonb(v_failing), 'checked_at', t.checks -> 'ran_at'));
    END IF;
  END IF;
  UPDATE public.site_templates SET status = CASE WHEN p_approve THEN 'approved' ELSE 'retired' END,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), ''),
         check_overrides = t.check_overrides, updated_at = now()
   WHERE id = p_id RETURNING * INTO t;
  RETURN t;
END $$;

-- The earlier call, without a reason: the same gate.
CREATE OR REPLACE FUNCTION public.admin_review_site_template(p_id text, p_approve boolean, p_content_checked boolean, p_note text)
RETURNS public.site_templates
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.admin_review_site_template(p_id, p_approve, p_content_checked, p_note, NULL::text);
$$;

REVOKE ALL ON FUNCTION
  public.record_site_template_checks(text, jsonb, jsonb),
  public.admin_record_site_template_page_checks(text, text, jsonb, jsonb),
  public.admin_review_site_template(text, boolean, boolean, text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.record_site_template_checks(text, jsonb, jsonb),
  public.admin_record_site_template_page_checks(text, text, jsonb, jsonb),
  public.admin_review_site_template(text, boolean, boolean, text, text)
TO authenticated, service_role;
