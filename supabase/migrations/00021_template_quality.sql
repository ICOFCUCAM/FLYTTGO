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
--   * Images: each template's images as named slots (hero, services,
--     about, gallery…) with their source, licence or generation, category,
--     intended use, size, hash and review status; administrators replace
--     a slot's image (uploaded to the template bucket) and review images.
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

-- The importer stores a template (server only), with its features, checks
-- and image slots. A changed template needs a new review (as in 00009).
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
  -- Its image slots and what is known about each (section 3).
  IF p ? 'images' THEN
    PERFORM public.site_template_store_images(t.id, p -> 'images');
    SELECT * INTO t FROM public.site_templates WHERE id = t.id;
  END IF;
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


-- ── 3. Images as named slots, with what is known about each ─────────────────
-- One row per image slot of a template ({{ASSET:key}}): the slot (hero,
-- services, about, gallery, team, map, product, background, other), the
-- image, where it came from, its licence or how it was generated, the
-- template's category, what it is meant to show, its size and hash, and
-- whether FlyttGo has reviewed it. FlyttGo administrators only.
CREATE TABLE IF NOT EXISTS public.site_template_images (
  template_id   text        NOT NULL REFERENCES public.site_templates (id) ON DELETE CASCADE,
  asset_key     text        NOT NULL CHECK (asset_key ~ '^[A-Za-z0-9._-]{1,60}$' AND asset_key <> 'thumbnail'),
  slot          text        NOT NULL CHECK (slot IN ('hero', 'services', 'about', 'gallery', 'team', 'map', 'product', 'background', 'other')),
  url           text        NOT NULL CHECK (url ~ '^https://'),
  source        text        NOT NULL CHECK (source IN ('architect-ai', 'ai-generated', 'licensed', 'own')),
  licence       text,
  generation    jsonb,
  category      text,
  intended_use  text,
  width         integer     CHECK (width > 0),
  height        integer     CHECK (height > 0),
  sha256        text        CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  review_status text        NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'approved', 'rejected')),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  replaced_by   uuid,
  replaced_at   timestamptz,
  history       jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(history) = 'array'),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, asset_key),
  CHECK (source <> 'licensed' OR nullif(btrim(licence), '') IS NOT NULL),
  CHECK (source <> 'ai-generated' OR nullif(btrim(generation ->> 'model'), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS site_template_images_sha256_idx ON public.site_template_images (sha256);
ALTER TABLE public.site_template_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_template_images_admin ON public.site_template_images;
CREATE POLICY site_template_images_admin ON public.site_template_images FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.site_template_images FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.site_template_images FROM authenticated;

-- FlyttGo administrators upload replacement images into the template
-- bucket (the importer writes there with the service key).
DROP POLICY IF EXISTS site_template_assets_admin_insert ON storage.objects;
CREATE POLICY site_template_assets_admin_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-template-assets' AND public.is_admin());

-- The importer records a template's image slots (called by
-- import_site_template). A slot an administrator replaced keeps its image:
-- the template's asset is pointed back at it.
CREATE OR REPLACE FUNCTION public.site_template_store_images(p_id text, p_images jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE im jsonb; r public.site_template_images%ROWTYPE;
BEGIN
  IF jsonb_typeof(coalesce(p_images, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'templates: images must be a list' USING ERRCODE = '22023';
  END IF;
  FOR im IN SELECT * FROM jsonb_array_elements(coalesce(p_images, '[]'::jsonb)) LOOP
    SELECT * INTO r FROM public.site_template_images WHERE template_id = p_id AND asset_key = im ->> 'asset_key';
    IF FOUND AND r.replaced_at IS NOT NULL THEN CONTINUE; END IF;
    INSERT INTO public.site_template_images (template_id, asset_key, slot, url, source, licence, generation, category,
                                             intended_use, width, height, sha256)
    VALUES (p_id, im ->> 'asset_key', coalesce(im ->> 'slot', 'other'), im ->> 'url', coalesce(im ->> 'source', 'architect-ai'),
            im ->> 'licence', nullif(im -> 'generation', 'null'::jsonb), im ->> 'category', im ->> 'intended_use',
            (im ->> 'width')::int, (im ->> 'height')::int, im ->> 'sha256')
    ON CONFLICT (template_id, asset_key) DO UPDATE SET
      slot = EXCLUDED.slot, url = EXCLUDED.url, source = EXCLUDED.source, licence = EXCLUDED.licence,
      generation = EXCLUDED.generation, category = EXCLUDED.category, intended_use = EXCLUDED.intended_use,
      width = EXCLUDED.width, height = EXCLUDED.height, sha256 = EXCLUDED.sha256,
      review_status = CASE WHEN site_template_images.url IS DISTINCT FROM EXCLUDED.url
                             OR site_template_images.sha256 IS DISTINCT FROM EXCLUDED.sha256
                           THEN 'unreviewed' ELSE site_template_images.review_status END,
      updated_at = now();
  END LOOP;
  -- Replaced slots keep their image in the template's assets.
  UPDATE public.site_templates t SET assets = (
    SELECT coalesce(jsonb_agg(CASE WHEN i.url IS NOT NULL THEN a || jsonb_build_object('url', i.url) ELSE a END ORDER BY n), '[]'::jsonb)
      FROM jsonb_array_elements(t.assets) WITH ORDINALITY AS e(a, n)
      LEFT JOIN public.site_template_images i
        ON i.template_id = t.id AND i.asset_key = a ->> 'key' AND i.replaced_at IS NOT NULL)
   WHERE t.id = p_id AND EXISTS (SELECT 1 FROM public.site_template_images WHERE template_id = p_id AND replaced_at IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.site_template_store_images(text, jsonb) FROM PUBLIC, anon, authenticated;

-- An administrator replaces the image of one slot with one uploaded to
-- site-template-assets/<template>/ (checked by its bytes in the panel:
-- PNG, JPEG or WebP; size and hash sent with it), saying where it comes
-- from. The earlier image is kept in history; an approved template goes
-- back to review, as after a page edit.
CREATE OR REPLACE FUNCTION public.admin_replace_site_template_image(p_template text, p_key text, p_path text, p_meta jsonb)
RETURNS public.site_template_images
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t public.site_templates%ROWTYPE; r public.site_template_images%ROWTYPE; v_url text; v_base text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'templates: platform administrators only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public.site_templates WHERE id = p_template FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'templates: no such template' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.assets) a WHERE a ->> 'key' = p_key) OR p_key = 'thumbnail' THEN
    RAISE EXCEPTION 'templates: the template has no image %', p_key USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(p_path, '') !~ ('^' || p_template || '/[A-Za-z0-9._-]{1,120}\.(png|jpg|webp)$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'site-template-assets' AND name = p_path) THEN
    RAISE EXCEPTION 'templates: upload the image to site-template-assets/%/ first', p_template USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_meta ->> 'mime', '') NOT IN ('image/png', 'image/jpeg', 'image/webp')
     OR coalesce(p_meta ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
     OR coalesce((p_meta ->> 'width')::int, 0) <= 0 OR coalesce((p_meta ->> 'height')::int, 0) <= 0 THEN
    RAISE EXCEPTION 'templates: a PNG, JPEG or WebP image, with its size and SHA-256' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_meta ->> 'source', '') NOT IN ('ai-generated', 'licensed', 'own') THEN
    RAISE EXCEPTION 'templates: say where the image comes from: ai-generated, licensed or own' USING ERRCODE = '22023';
  END IF;
  -- The bucket's public address, from the template's other images.
  SELECT substring(a ->> 'url' FROM '^(https://[^/]+/storage/v1/object/public/site-template-assets/)') INTO v_base
    FROM jsonb_array_elements(t.assets) a WHERE a ->> 'url' ~ '^https://[^/]+/storage/v1/object/public/site-template-assets/' LIMIT 1;
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'templates: the template''s images are not in FlyttGo''s storage yet (import it with --to-flyttgo first)' USING ERRCODE = '55000';
  END IF;
  v_url := v_base || p_path;
  SELECT * INTO r FROM public.site_template_images WHERE template_id = p_template AND asset_key = p_key FOR UPDATE;
  INSERT INTO public.site_template_images AS i (template_id, asset_key, slot, url, source, licence, generation, category, intended_use,
                                                width, height, sha256, replaced_by, replaced_at, history)
  VALUES (p_template, p_key, coalesce(nullif(p_meta ->> 'slot', ''), r.slot, 'other'), v_url, p_meta ->> 'source',
          nullif(btrim(p_meta ->> 'licence'), ''), nullif(p_meta -> 'generation', 'null'::jsonb), r.category,
          coalesce(nullif(btrim(p_meta ->> 'intended_use'), ''), r.intended_use),
          (p_meta ->> 'width')::int, (p_meta ->> 'height')::int, p_meta ->> 'sha256', auth.uid(), now(),
          CASE WHEN r.template_id IS NULL THEN '[]'::jsonb
               ELSE r.history || jsonb_build_array(jsonb_build_object('url', r.url, 'source', r.source, 'licence', r.licence,
                      'sha256', r.sha256, 'review_status', r.review_status, 'until', now())) END)
  ON CONFLICT (template_id, asset_key) DO UPDATE SET
    slot = EXCLUDED.slot, url = EXCLUDED.url, source = EXCLUDED.source, licence = EXCLUDED.licence, generation = EXCLUDED.generation,
    intended_use = EXCLUDED.intended_use, width = EXCLUDED.width, height = EXCLUDED.height, sha256 = EXCLUDED.sha256,
    review_status = 'unreviewed', reviewed_by = NULL, reviewed_at = NULL,
    replaced_by = EXCLUDED.replaced_by, replaced_at = EXCLUDED.replaced_at, history = EXCLUDED.history, updated_at = now()
  RETURNING * INTO r;
  UPDATE public.site_templates SET
    assets = (SELECT jsonb_agg(CASE WHEN a ->> 'key' = p_key THEN a || jsonb_build_object('url', v_url) ELSE a END ORDER BY n)
                FROM jsonb_array_elements(assets) WITH ORDINALITY AS e(a, n)),
    status = CASE WHEN status = 'approved' THEN 'imported' ELSE status END,
    reviewed_by = CASE WHEN status = 'approved' THEN NULL ELSE reviewed_by END,
    reviewed_at = CASE WHEN status = 'approved' THEN NULL ELSE reviewed_at END,
    updated_at = now()
   WHERE id = p_template;
  RETURN r;
END $$;

-- An administrator reviews one image: approves it once its licence (or
-- how it was generated) and its content are right, or rejects it. The
-- licence of an imported image can be recorded here once confirmed.
CREATE OR REPLACE FUNCTION public.admin_review_site_template_image(p_template text, p_key text, p_status text, p_licence text)
RETURNS public.site_template_images
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.site_template_images%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'templates: platform administrators only' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('approved', 'rejected', 'unreviewed') THEN
    RAISE EXCEPTION 'templates: approved, rejected or unreviewed' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.site_template_images WHERE template_id = p_template AND asset_key = p_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'templates: no such image' USING ERRCODE = 'P0002'; END IF;
  r.licence := coalesce(nullif(btrim(coalesce(p_licence, '')), ''), r.licence);
  IF p_status = 'approved' AND r.source IN ('architect-ai', 'licensed') AND r.licence IS NULL THEN
    RAISE EXCEPTION 'templates: record the image''s licence before approving it' USING ERRCODE = '55000';
  END IF;
  UPDATE public.site_template_images SET review_status = p_status, licence = r.licence, reviewed_by = auth.uid(), reviewed_at = now(),
         updated_at = now()
   WHERE template_id = p_template AND asset_key = p_key RETURNING * INTO r;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION
  public.admin_replace_site_template_image(text, text, text, jsonb),
  public.admin_review_site_template_image(text, text, text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.admin_replace_site_template_image(text, text, text, jsonb),
  public.admin_review_site_template_image(text, text, text, text)
TO authenticated, service_role;
