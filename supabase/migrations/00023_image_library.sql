-- ============================================================================
-- FlyttGo — one shared image library for every website template
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00022. The owner's decision
-- (docs/WHITE_LABEL.md → Image library, docs/DECISIONS.md #45): templates no
-- longer each carry their own fixed photos (almost all of them carry the same
-- shipping-container set). Every image slot ({{ASSET:key}}) draws from, in
-- this order:
--
--   1. the company's own image for that slot (organization_site_images: an
--      upload in its own folder of organization-site-images, or a pick from
--      the approved library), set and reset by its owners and admins only;
--   2. the template's own image for that slot (site_template_images, 00021),
--      when it is approved and its licence is known;
--   3. an approved library image (image_library) of the TEMPLATE's category
--      (site_template_category(), the same lists as TEMPLATE_CATEGORIES in
--      _shared/site-template.ts) in the slot's shape (hero, wide, square,
--      portrait), chosen deterministically by hash(template id, slot key,
--      image) so a template always shows the same photos and the templates of
--      a category differ, and not repeated on a page while the pool allows;
--   4. a neutral block in the company's colour (no photo).
--
-- Never an unapproved image, one whose licence is unknown, or one from
-- another category. While a category has no approved library image at all,
-- step 3 and 4 are replaced by the template's assets as before (backward
-- compatible); from its first approved image on, the shared imported set is
-- no longer used in that category.
--
-- site_template_image_map() returns the resolved map, used by
-- white-label-site (server side) and by the previews and thumbnails.
-- FlyttGo administrators add, edit, approve, reject and retire library images
-- (recorded in each image's history); the importer
-- (scripts/import-image-library.ts) adds harvested images as pending.
--
-- Safe to re-run. Rolled back by supabase/rollback/00023_down.sql.
-- ============================================================================

-- ── 1. The template's category, its slots and their shapes ─────────────────
-- The catalogue category of a template's industries: the first category one
-- of them belongs to, 'other' when none does, NULL for health templates
-- (never imported). Kept equal to TEMPLATE_CATEGORIES and
-- EXCLUDED_INDUSTRIES (src/test/image-library.test.ts compares them).
CREATE OR REPLACE FUNCTION public.site_template_category(p_industry text[])
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM unnest(coalesce(p_industry, '{}'::text[])) i
                  WHERE lower(i) = ANY (ARRAY[
      'health', 'clinic', 'medical', 'dental', 'dentist', 'therapy', 'counseling', 'mental-health', 'psychology', 'optometry',
      'eye-care', 'orthodontics', 'pediatrics', 'primary-care', 'family-medicine', 'womens-health', 'obgyn', 'dermatology',
      'chiropractic', 'physical-therapy', 'medical-spa', 'hospital', 'healthcare'])) THEN NULL
    ELSE coalesce((
      SELECT c.id FROM (VALUES
        (1, 'transport', ARRAY['moving', 'movers', 'relocation', 'removals', 'man-and-van', 'logistics', 'freight', 'courier', 'delivery', 'transport',
          'trucking', 'last-mile', 'warehousing', 'storage', 'parcel', 'shipping', 'import export', 'import-export']),
        (2, 'trades', ARRAY['plumbing', 'plumber', 'emergency-plumbing', 'electrician', 'electrical', 'residential-electric', 'hvac',
          'heating-and-cooling', 'air-conditioning', 'trades', 'home-services', 'cleaning', 'house-cleaning', 'maid-service', 'recurring-cleaning',
          'landscaping', 'lawn-care', 'hardscaping', 'construction', 'contractor', 'general-contractor', 'roofing', 'roofer', 'painting', 'painter',
          'pest-control', 'exterminator', 'termite', 'renovation', 'remodeling', 'kitchen-bath', 'restoration', 'storm-damage', 'solar', 'automotive', 'auto',
          'auto-repair', 'mechanic', 'garage', 'car-care', 'detailing', 'mobile-detailing', 'auto-detailing', 'auto-body', 'body-shop', 'collision-repair',
          'tyres', 'servicing', 'mot']),
        (3, 'appointments', ARRAY['beauty', 'salon', 'hair-salon', 'hair', 'barber', 'barbershop', 'spa', 'day-spa', 'nails', 'nail-salon',
          'personal-care', 'skincare', 'esthetics', 'massage', 'fitness', 'gym', 'personal-training', 'personal-trainer', 'yoga', 'pilates', 'wellness',
          'pet-care', 'pets', 'dog-grooming', 'pet-grooming', 'grooming', 'dog-training', 'tutoring', 'private tutor', 'music lessons', 'driving school',
          'photography']),
        (4, 'professional', ARRAY['consulting', 'coaching', 'accounting', 'bookkeeping', 'law-firm', 'lawyer', 'legal', 'professional-services',
          'financial-advisor', 'finance', 'insurance', 'veterinary', 'vet', 'research', 'security']),
        (5, 'hospitality', ARRAY['hospitality', 'hotel', 'restaurant', 'food', 'cafe', 'bakery', 'catering', 'travel', 'tours', 'tour-operator',
          'events', 'venue']),
        (6, 'retail', ARRAY['ecommerce', 'online-store', 'shop', 'retail']),
        (7, 'technology', ARRAY['saas', 'software', 'b2b-software', 'technology', 'tech', 'hosting']),
        (8, 'community', ARRAY['education', 'e-learning', 'academy', 'nonprofit', 'charity', 'church', 'community']),
        (9, 'industry', ARRAY['real-estate', 'realtor', 'property-management', 'manufacturing', 'agriculture', 'mining', 'energy', 'pharmaceutical']),
        (10, 'entertainment', ARRAY['gaming', 'games', 'esports', 'entertainment'])
      ) AS c(n, id, tags)
       WHERE EXISTS (SELECT 1 FROM unnest(coalesce(p_industry, '{}'::text[])) i WHERE lower(i) = ANY (c.tags))
       ORDER BY c.n LIMIT 1), 'other')
  END;
$$;

-- The categories a library image may have.
CREATE OR REPLACE FUNCTION public.site_image_categories()
RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT ARRAY['transport', 'trades', 'appointments', 'professional', 'hospitality', 'retail', 'technology', 'community',
               'industry', 'entertainment', 'other'];
$$;

-- The shape of an image from its size: hero (wide and large enough for a
-- full-width banner), wide, square or portrait. Kept equal to shapeOf() in
-- _shared/image-library.ts.
CREATE OR REPLACE FUNCTION public.image_shape_of(p_width integer, p_height integer)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN coalesce(p_width, 0) <= 0 OR coalesce(p_height, 0) <= 0 THEN NULL
    WHEN p_width::numeric / p_height >= 1.6 AND p_width >= 1200 THEN 'hero'
    WHEN p_width::numeric / p_height >= 1.2 THEN 'wide'
    WHEN p_width::numeric / p_height > 0.83 THEN 'square'
    ELSE 'portrait' END;
$$;

-- The shape a template's slot needs. From what the slot is (its recorded
-- slot, 00021, else its key as slotOf() reads it): a hero or background is
-- a hero, a team member a portrait, a product a square, a map takes no
-- photo ('map': never a library image); services, about and gallery are
-- wide; any other slot takes the shape of the image it had, else wide.
CREATE OR REPLACE FUNCTION public.site_image_slot_shape(p_key text, p_slot text, p_width integer, p_height integer)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  WITH k AS (SELECT lower(regexp_replace(coalesce(p_key, ''), '\.\d+$', '')) AS base),
  s AS (
    SELECT coalesce(nullif(p_slot, 'other'), CASE
      WHEN base IN ('hero', 'banner', 'cover') THEN 'hero'
      WHEN base IN ('bg', 'background') THEN 'background'
      WHEN base IN ('team', 'staff', 'people') THEN 'team'
      WHEN base IN ('map', 'location') THEN 'map'
      WHEN base IN ('product', 'products', 'shop') THEN 'product'
      WHEN base IN ('services', 'services-grid', 'service', 'features') THEN 'services'
      WHEN base IN ('about', 'story', 'coverage') THEN 'about'
      WHEN base IN ('gallery', 'portfolio', 'work', 'projects') THEN 'gallery'
      ELSE CASE split_part(regexp_replace(base, '_', '-', 'g'), '-', 1)
        WHEN 'hero' THEN 'hero' WHEN 'banner' THEN 'hero' WHEN 'cover' THEN 'hero'
        WHEN 'bg' THEN 'background' WHEN 'background' THEN 'background'
        WHEN 'team' THEN 'team' WHEN 'staff' THEN 'team' WHEN 'people' THEN 'team'
        WHEN 'map' THEN 'map' WHEN 'location' THEN 'map'
        WHEN 'product' THEN 'product' WHEN 'products' THEN 'product' WHEN 'shop' THEN 'product'
        WHEN 'services' THEN 'services' WHEN 'service' THEN 'services' WHEN 'features' THEN 'services'
        WHEN 'about' THEN 'about' WHEN 'story' THEN 'about' WHEN 'coverage' THEN 'about'
        WHEN 'gallery' THEN 'gallery' WHEN 'portfolio' THEN 'gallery' WHEN 'work' THEN 'gallery' WHEN 'projects' THEN 'gallery'
        ELSE 'other' END END) AS slot
      FROM k)
  SELECT CASE slot
    WHEN 'hero' THEN 'hero' WHEN 'background' THEN 'hero'
    WHEN 'team' THEN 'portrait'
    WHEN 'product' THEN 'square'
    WHEN 'map' THEN 'map'
    WHEN 'other' THEN coalesce(public.image_shape_of(p_width, p_height), 'wide')
    ELSE 'wide' END
    FROM s;
$$;

-- Which shapes may fill a slot of a shape, best first (a hero photo also
-- serves a wide slot and the other way round; a map takes none).
CREATE OR REPLACE FUNCTION public.site_image_shapes_for(p_shape text)
RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_shape WHEN 'hero' THEN ARRAY['hero', 'wide'] WHEN 'wide' THEN ARRAY['wide', 'hero']
                      WHEN 'square' THEN ARRAY['square'] WHEN 'portrait' THEN ARRAY['portrait'] ELSE '{}'::text[] END;
$$;

-- A template's image slots: every {{ASSET:key}} its pages use (in the order
-- they first appear; never the thumbnail), with the pages each is on and the
-- shape it needs. An asset no page uses is never shown, so it is no slot.
CREATE OR REPLACE FUNCTION public.site_template_image_slots(p_template text)
RETURNS TABLE (slot_key text, pages integer[], shape text, ord bigint)
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH t AS (SELECT * FROM public.site_templates WHERE id = p_template),
  refs AS (
    SELECT r.m[1] AS k, (e.i - 1)::int AS page, e.i * 1000000 + r.j AS pos
      FROM t CROSS JOIN LATERAL jsonb_array_elements(t.pages) WITH ORDINALITY AS e(pg, i)
      CROSS JOIN LATERAL regexp_matches(coalesce(e.pg ->> 'html', ''), '\{\{ASSET:([A-Za-z0-9._-]{1,60})\}\}', 'g') WITH ORDINALITY AS r(m, j)),
  slots AS (
    SELECT k, array_agg(DISTINCT page ORDER BY page) AS pages, min(pos) AS ord
      FROM refs WHERE k <> 'thumbnail' GROUP BY k)
  SELECT s.k, s.pages, public.site_image_slot_shape(s.k, i.slot, i.width, i.height), s.ord
    FROM slots s LEFT JOIN public.site_template_images i ON i.template_id = p_template AND i.asset_key = s.k
   ORDER BY s.ord, s.k;
$$;

REVOKE ALL ON FUNCTION public.site_template_image_slots(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.site_template_category(text[]), public.site_image_categories(), public.image_shape_of(integer, integer),
  public.site_image_slot_shape(text, text, integer, integer), public.site_image_shapes_for(text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.site_template_category(text[]), public.site_image_categories(), public.image_shape_of(integer, integer),
  public.site_image_slot_shape(text, text, integer, integer), public.site_image_shapes_for(text)
TO authenticated, service_role;


-- ── 2. The library ─────────────────────────────────────────────────────────
-- One row per photo, stored in the public bucket site-image-library at
-- <category>/<sha256>.<ext>. Pending until a FlyttGo administrator approves
-- it, which needs its licence, the evidence of that licence and an alt text.
-- Every change of status is kept in history (who, when, from, to, why).
-- Images are never deleted: they are retired.
CREATE TABLE IF NOT EXISTS public.image_library (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path     text        NOT NULL UNIQUE CHECK (storage_path ~ '^[a-z]+/[0-9a-f]{64}\.(png|jpg|webp)$'),
  category         text        NOT NULL CHECK (category = ANY (public.site_image_categories())),
  shape            text        NOT NULL CHECK (shape IN ('hero', 'wide', 'square', 'portrait')),
  width            integer     NOT NULL CHECK (width > 0),
  height           integer     NOT NULL CHECK (height > 0),
  mime             text        NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes            integer     CHECK (bytes > 0 AND bytes <= 8388608),
  focal_x          numeric     CHECK (focal_x BETWEEN 0 AND 1),
  focal_y          numeric     CHECK (focal_y BETWEEN 0 AND 1),
  tags             text[]      NOT NULL DEFAULT '{}',
  alt_text         text        CHECK (alt_text IS NULL OR char_length(alt_text) <= 300),
  origin           text        NOT NULL CHECK (char_length(btrim(origin)) BETWEEN 1 AND 80),
  licence          text        CHECK (licence IS NULL OR char_length(licence) <= 300),
  licence_evidence text        CHECK (licence_evidence IS NULL OR char_length(licence_evidence) <= 1000),
  sources          jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
  sha256           text        NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  review_status    text        NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected', 'retired')),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  review_reason    text,
  history          jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(history) = 'array'),
  added_by         uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT image_library_approved_known CHECK (review_status <> 'approved' OR (
    nullif(btrim(licence), '') IS NOT NULL AND nullif(btrim(licence_evidence), '') IS NOT NULL AND nullif(btrim(alt_text), '') IS NOT NULL)),
  CONSTRAINT image_library_path_matches CHECK (storage_path LIKE category || '/' || sha256 || '.%')
);
CREATE INDEX IF NOT EXISTS image_library_pool_idx ON public.image_library (category, shape) WHERE review_status = 'approved';
ALTER TABLE public.image_library ENABLE ROW LEVEL SECURITY;
-- Approved images for signed-in users (companies pick from them); every image for FlyttGo's administrators.
DROP POLICY IF EXISTS image_library_select ON public.image_library;
CREATE POLICY image_library_select ON public.image_library FOR SELECT TO authenticated
  USING (review_status = 'approved' OR public.is_admin());
REVOKE ALL ON public.image_library FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.image_library FROM authenticated;

-- The library's files: public (approved ones are shown on companies' public
-- pages), written by FlyttGo's administrators (and the importer with the
-- service key).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'site-image-library', 'site-image-library', true, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'site-image-library');
DROP POLICY IF EXISTS site_image_library_admin_insert ON storage.objects;
CREATE POLICY site_image_library_admin_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-image-library' AND public.is_admin());

-- A FlyttGo administrator (or the importer, as the server) adds an image
-- already uploaded to site-image-library/<category>/<sha256>.<ext> (checked
-- by its bytes in the panel or the importer: PNG, JPEG or WebP, at most
-- 8 MB). It is pending. The same image (by SHA-256) is never added twice:
-- adding it again returns the row as it is.
CREATE OR REPLACE FUNCTION public.admin_add_library_image(p jsonb)
RETURNS public.image_library
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.image_library%ROWTYPE; v_sha text := lower(coalesce(p ->> 'sha256', '')); v_ext text;
        v_w int; v_h int; v_shape text; v_cat text := p ->> 'category';
BEGIN
  IF NOT (public.is_admin() OR public.is_server()) THEN
    RAISE EXCEPTION 'image library: FlyttGo administrators only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.image_library WHERE sha256 = v_sha;
  IF FOUND THEN RETURN r; END IF;
  IF v_sha !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'image library: the image''s SHA-256 is needed' USING ERRCODE = '22023'; END IF;
  IF v_cat IS NULL OR NOT (v_cat = ANY (public.site_image_categories())) THEN
    RAISE EXCEPTION 'image library: unknown category % (%)', v_cat, array_to_string(public.site_image_categories(), ', ') USING ERRCODE = '22023';
  END IF;
  v_ext := CASE p ->> 'mime' WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/webp' THEN 'webp' END;
  IF v_ext IS NULL THEN RAISE EXCEPTION 'image library: a PNG, JPEG or WebP image' USING ERRCODE = '22023'; END IF;
  IF coalesce(p ->> 'path', '') <> v_cat || '/' || v_sha || '.' || v_ext
     OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'site-image-library' AND name = p ->> 'path') THEN
    RAISE EXCEPTION 'image library: upload the image to site-image-library/%/%.% first', v_cat, v_sha, v_ext USING ERRCODE = '22023';
  END IF;
  v_w := (p ->> 'width')::int; v_h := (p ->> 'height')::int;
  IF coalesce(v_w, 0) <= 0 OR coalesce(v_h, 0) <= 0 THEN RAISE EXCEPTION 'image library: the image''s size in pixels' USING ERRCODE = '22023'; END IF;
  v_shape := coalesce(nullif(p ->> 'shape', ''), public.image_shape_of(v_w, v_h));
  IF nullif(btrim(coalesce(p ->> 'origin', '')), '') IS NULL THEN
    RAISE EXCEPTION 'image library: say where the image comes from (origin)' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p -> 'tags', '[]'::jsonb)) <> 'array' OR jsonb_typeof(coalesce(p -> 'sources', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'image library: tags and sources are lists' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.image_library (storage_path, category, shape, width, height, mime, bytes, focal_x, focal_y, tags, alt_text, origin,
                                    licence, licence_evidence, sources, sha256, added_by, history)
  VALUES (p ->> 'path', v_cat, v_shape, v_w, v_h, p ->> 'mime', (p ->> 'bytes')::int, (p ->> 'focal_x')::numeric, (p ->> 'focal_y')::numeric,
          ARRAY(SELECT lower(btrim(x)) FROM jsonb_array_elements_text(coalesce(p -> 'tags', '[]'::jsonb)) x WHERE btrim(x) <> ''),
          nullif(btrim(p ->> 'alt'), ''), btrim(p ->> 'origin'), nullif(btrim(p ->> 'licence'), ''),
          nullif(btrim(p ->> 'licence_evidence'), ''), coalesce(p -> 'sources', '[]'::jsonb), v_sha, auth.uid(),
          jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(), 'action', 'added', 'to', 'pending')))
  ON CONFLICT (sha256) DO NOTHING
  RETURNING * INTO r;
  IF r.id IS NULL THEN SELECT * INTO r FROM public.image_library WHERE sha256 = v_sha; END IF;
  RETURN r;
END $$;

-- An administrator corrects what is recorded about an image. A change to
-- its category, shape, origin, licence or evidence sends an approved image
-- back to review.
CREATE OR REPLACE FUNCTION public.admin_update_library_image(p_id uuid, p jsonb)
RETURNS public.image_library
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.image_library%ROWTYPE; n public.image_library%ROWTYPE; v_back boolean;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'image library: FlyttGo administrators only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.image_library WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'image library: no such image' USING ERRCODE = 'P0002'; END IF;
  n := r;
  IF p ? 'category' THEN n.category := p ->> 'category'; END IF;
  IF p ? 'shape' THEN n.shape := p ->> 'shape'; END IF;
  IF p ? 'origin' THEN n.origin := btrim(p ->> 'origin'); END IF;
  IF p ? 'licence' THEN n.licence := nullif(btrim(p ->> 'licence'), ''); END IF;
  IF p ? 'licence_evidence' THEN n.licence_evidence := nullif(btrim(p ->> 'licence_evidence'), ''); END IF;
  IF p ? 'alt' THEN n.alt_text := nullif(btrim(p ->> 'alt'), ''); END IF;
  IF p ? 'tags' THEN n.tags := ARRAY(SELECT lower(btrim(x)) FROM jsonb_array_elements_text(p -> 'tags') x WHERE btrim(x) <> ''); END IF;
  IF p ? 'focal_x' THEN n.focal_x := (p ->> 'focal_x')::numeric; END IF;
  IF p ? 'focal_y' THEN n.focal_y := (p ->> 'focal_y')::numeric; END IF;
  IF n.category IS DISTINCT FROM r.category THEN
    RAISE EXCEPTION 'image library: the category is part of where the image is stored; add it again under the other category'
      USING ERRCODE = '22023';
  END IF;
  v_back := r.review_status = 'approved'
            AND (n.shape, n.origin, n.licence, n.licence_evidence) IS DISTINCT FROM (r.shape, r.origin, r.licence, r.licence_evidence);
  UPDATE public.image_library SET shape = n.shape, origin = n.origin, licence = n.licence, licence_evidence = n.licence_evidence,
         alt_text = n.alt_text, tags = n.tags, focal_x = n.focal_x, focal_y = n.focal_y,
         review_status = CASE WHEN v_back THEN 'pending' ELSE review_status END,
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(), 'action', 'edited',
                     'from', r.review_status, 'to', CASE WHEN v_back THEN 'pending' ELSE r.review_status END)),
         updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  RETURN r;
END $$;

-- An administrator approves an image (its licence, the evidence of it and an
-- alt text recorded), rejects or retires it (with a reason), or puts it back
-- to pending. Each is kept in its history.
CREATE OR REPLACE FUNCTION public.admin_review_library_image(p_id uuid, p_status text, p_reason text)
RETURNS public.image_library
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.image_library%ROWTYPE; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'image library: FlyttGo administrators only' USING ERRCODE = '42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('approved', 'rejected', 'retired', 'pending') THEN
    RAISE EXCEPTION 'image library: approved, rejected, retired or pending' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.image_library WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'image library: no such image' USING ERRCODE = 'P0002'; END IF;
  IF p_status = 'approved' AND (nullif(btrim(r.licence), '') IS NULL OR nullif(btrim(r.licence_evidence), '') IS NULL) THEN
    RAISE EXCEPTION 'image library: record the image''s licence and the evidence of it before approving it' USING ERRCODE = '55000';
  END IF;
  IF p_status = 'approved' AND nullif(btrim(r.alt_text), '') IS NULL THEN
    RAISE EXCEPTION 'image library: describe the image (alt text) before approving it' USING ERRCODE = '55000';
  END IF;
  IF p_status IN ('rejected', 'retired') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'image library: give a reason' USING ERRCODE = '22023';
  END IF;
  UPDATE public.image_library SET review_status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), review_reason = v_reason,
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(), 'action', 'reviewed',
                     'from', r.review_status, 'to', p_status, 'reason', v_reason)),
         updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  RETURN r;
END $$;

-- The categories that have approved library images (the catalogue shows
-- their templates with the library's photos, not their imported thumbnail).
CREATE OR REPLACE FUNCTION public.image_library_categories()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(array_agg(DISTINCT category ORDER BY category), '{}'::text[]) FROM public.image_library WHERE review_status = 'approved';
$$;

-- Coverage, per category and shape: approved and pending images against
-- what the category's templates (not retired) need: the most slots of that
-- shape one template has, and the slots of that shape in all of them.
CREATE OR REPLACE FUNCTION public.admin_image_library_coverage()
RETURNS TABLE (category text, shape text, approved integer, pending integer, templates integer, most_in_a_template integer, slots integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'image library: FlyttGo administrators only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH tpl AS (
    SELECT t.id, public.site_template_category(t.industry) AS cat FROM public.site_templates t WHERE t.status <> 'retired'),
  need AS (
    SELECT tpl.cat, s.shape, tpl.id, count(*)::int AS n
      FROM tpl CROSS JOIN LATERAL public.site_template_image_slots(tpl.id) s
     WHERE tpl.cat IS NOT NULL AND s.shape <> 'map' GROUP BY 1, 2, 3),
  cs AS (SELECT c AS cat, sh FROM unnest(public.site_image_categories()) c CROSS JOIN unnest(ARRAY['hero', 'wide', 'square', 'portrait']) sh)
  SELECT cs.cat, cs.sh,
         (SELECT count(*)::int FROM public.image_library l WHERE l.category = cs.cat AND l.shape = cs.sh AND l.review_status = 'approved'),
         (SELECT count(*)::int FROM public.image_library l WHERE l.category = cs.cat AND l.shape = cs.sh AND l.review_status = 'pending'),
         (SELECT count(*)::int FROM tpl WHERE tpl.cat = cs.cat),
         coalesce((SELECT max(need.n) FROM need WHERE need.cat = cs.cat AND need.shape = cs.sh), 0)::int,
         coalesce((SELECT sum(need.n) FROM need WHERE need.cat = cs.cat AND need.shape = cs.sh), 0)::int
    FROM cs ORDER BY array_position(public.site_image_categories(), cs.cat), array_position(ARRAY['hero', 'wide', 'square', 'portrait'], cs.sh);
END $$;

REVOKE ALL ON FUNCTION
  public.admin_add_library_image(jsonb), public.admin_update_library_image(uuid, jsonb),
  public.admin_review_library_image(uuid, text, text), public.image_library_categories(), public.admin_image_library_coverage()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.admin_add_library_image(jsonb), public.admin_update_library_image(uuid, jsonb),
  public.admin_review_library_image(uuid, text, text), public.image_library_categories(), public.admin_image_library_coverage()
TO authenticated, service_role;


-- ── 3. A company's own images ──────────────────────────────────────────────
-- Per slot key of its site (hero, services.1 …): its own upload, in its own
-- folder of the private bucket organization-site-images
-- (<organization id>/<key>-<hash>.<ext>), or an approved library image it
-- picked. Its members see them; its owners and admins set and reset them
-- (through the functions below); nobody else reads them: the published site
-- gets only the resolved map, from the server (white-label-site).
CREATE TABLE IF NOT EXISTS public.organization_site_images (
  organization_id  uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  slot_key         text        NOT NULL CHECK (slot_key ~ '^[A-Za-z0-9._-]{1,60}$' AND slot_key <> 'thumbnail'),
  storage_path     text,
  library_image_id uuid        REFERENCES public.image_library (id),
  sha256           text        CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  mime             text        CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  width            integer     CHECK (width > 0),
  height           integer     CHECK (height > 0),
  alt_text         text        CHECK (alt_text IS NULL OR char_length(alt_text) <= 300),
  uploaded_by      uuid,
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, slot_key),
  CONSTRAINT organization_site_images_one_source CHECK ((storage_path IS NULL) <> (library_image_id IS NULL)),
  CONSTRAINT organization_site_images_own_folder CHECK (storage_path IS NULL OR (
    storage_path ~ ('^' || organization_id::text || '/[A-Za-z0-9._-]{1,120}\.(png|jpg|webp)$') AND sha256 IS NOT NULL AND mime IS NOT NULL))
);
ALTER TABLE public.organization_site_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_site_images_select ON public.organization_site_images;
CREATE POLICY organization_site_images_select ON public.organization_site_images FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id) OR public.is_admin());
REVOKE ALL ON public.organization_site_images FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organization_site_images FROM authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'organization-site-images', 'organization-site-images', false, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'organization-site-images');
DROP POLICY IF EXISTS organization_site_images_read ON storage.objects;
CREATE POLICY organization_site_images_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'organization-site-images' AND (public.is_admin() OR public.org_folder_member(name)));
DROP POLICY IF EXISTS organization_site_images_write ON storage.objects;
CREATE POLICY organization_site_images_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'organization-site-images' AND public.org_folder_member(name, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS organization_site_images_update ON storage.objects;
CREATE POLICY organization_site_images_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'organization-site-images' AND public.org_folder_member(name, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS organization_site_images_delete ON storage.objects;
CREATE POLICY organization_site_images_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'organization-site-images' AND public.org_folder_member(name, ARRAY['owner', 'admin']));

-- The company's owner or admin sets a slot's image: its own upload (already
-- in its folder, checked by its bytes in the browser: PNG, JPEG or WebP, at
-- most 8 MB; type, size and hash sent with it) or an approved library image
-- of its template's category. Logged in the company's log.
CREATE OR REPLACE FUNCTION public.set_organization_site_image(p_org uuid, p_key text, p jsonb)
RETURNS public.organization_site_images
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.organization_site_images%ROWTYPE; l public.image_library%ROWTYPE; v_template text; v_cat text;
        v_lib uuid := nullif(p ->> 'library_image_id', '')::uuid;
BEGIN
  IF NOT public.is_org_member(p_org, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'website images: the company''s owners and admins only' USING ERRCODE = '42501';
  END IF;
  SELECT w.template_id INTO v_template FROM public.organization_white_label w WHERE w.organization_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'website images: choose a plan first' USING ERRCODE = 'P0002'; END IF;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9._-]{1,60}$' OR p_key = 'thumbnail' THEN
    RAISE EXCEPTION 'website images: no such image slot' USING ERRCODE = '22023';
  END IF;
  IF v_lib IS NOT NULL THEN
    SELECT * INTO l FROM public.image_library WHERE id = v_lib;
    IF NOT FOUND OR l.review_status <> 'approved' THEN
      RAISE EXCEPTION 'website images: that image is not in the library' USING ERRCODE = '22023';
    END IF;
    SELECT public.site_template_category(t.industry) INTO v_cat FROM public.site_templates t WHERE t.id = v_template;
    IF v_cat IS NULL OR l.category <> v_cat THEN
      RAISE EXCEPTION 'website images: choose from the images for your website''s category' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.organization_site_images AS o (organization_id, slot_key, library_image_id, alt_text, uploaded_by, uploaded_at)
    VALUES (p_org, p_key, v_lib, nullif(btrim(p ->> 'alt'), ''), auth.uid(), now())
    ON CONFLICT (organization_id, slot_key) DO UPDATE SET
      storage_path = NULL, library_image_id = EXCLUDED.library_image_id, sha256 = NULL, mime = NULL, width = NULL, height = NULL,
      alt_text = EXCLUDED.alt_text, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = EXCLUDED.uploaded_at
    RETURNING * INTO r;
  ELSE
    IF coalesce(p ->> 'path', '') !~ ('^' || p_org::text || '/[A-Za-z0-9._-]{1,120}\.(png|jpg|webp)$')
       OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'organization-site-images' AND name = p ->> 'path') THEN
      RAISE EXCEPTION 'website images: upload the image to your folder first' USING ERRCODE = '22023';
    END IF;
    IF coalesce(p ->> 'mime', '') NOT IN ('image/png', 'image/jpeg', 'image/webp') OR coalesce(p ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
       OR coalesce((p ->> 'width')::int, 0) <= 0 OR coalesce((p ->> 'height')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'website images: a PNG, JPEG or WebP image, with its size and SHA-256' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.organization_site_images AS o (organization_id, slot_key, storage_path, sha256, mime, width, height, alt_text,
                                                      uploaded_by, uploaded_at)
    VALUES (p_org, p_key, p ->> 'path', p ->> 'sha256', p ->> 'mime', (p ->> 'width')::int, (p ->> 'height')::int,
            nullif(btrim(p ->> 'alt'), ''), auth.uid(), now())
    ON CONFLICT (organization_id, slot_key) DO UPDATE SET
      storage_path = EXCLUDED.storage_path, library_image_id = NULL, sha256 = EXCLUDED.sha256, mime = EXCLUDED.mime,
      width = EXCLUDED.width, height = EXCLUDED.height, alt_text = EXCLUDED.alt_text,
      uploaded_by = EXCLUDED.uploaded_by, uploaded_at = EXCLUDED.uploaded_at
    RETURNING * INTO r;
  END IF;
  PERFORM public.white_label_event(p_org, 'white_label.site_image', jsonb_build_object(
    'key', p_key, 'kind', CASE WHEN v_lib IS NULL THEN 'upload' ELSE 'library' END, 'library_image_id', v_lib, 'sha256', r.sha256));
  RETURN r;
END $$;

-- Back to the default for that slot (the uploaded file stays in the
-- company's folder).
CREATE OR REPLACE FUNCTION public.reset_organization_site_image(p_org uuid, p_key text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_org_member(p_org, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'website images: the company''s owners and admins only' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.organization_site_images WHERE organization_id = p_org AND slot_key = p_key;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.white_label_event(p_org, 'white_label.site_image', jsonb_build_object('key', p_key, 'kind', 'reset'));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.set_organization_site_image(uuid, text, jsonb), public.reset_organization_site_image(uuid, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_organization_site_image(uuid, text, jsonb), public.reset_organization_site_image(uuid, text)
TO authenticated, service_role;


-- ── 4. The resolved map ─────────────────────────────────────────────────────
-- What each image slot of a template shows, for a company (p_org) or none:
--   {"template", "category", "mode": "library" | "assets",
--    "images": {<key>: {"source": "company" | "template" | "library" | "assets" | "fallback",
--                       "shape", "bucket" + "path" (stored here) or "url", "alt", "id", "focal_x", "focal_y"}}}
-- "assets" mode: the category has no approved library image, so a slot
-- without a company or approved template image keeps the template's asset as
-- before. "library" mode: such a slot takes a library image, else the
-- neutral block ("fallback", no address).
--
-- The library pick: among the approved images of the template's category in
-- a shape the slot takes, the one that is (1) not yet on a page the slot is
-- on, (2) least used in the template, (3) of the slot's own shape, (4) first
-- by md5(template id / slot key / image hash): the same template always gets
-- the same photos, and an image added to the pool moves only the slots it
-- wins. Slots are chosen in the order they first appear in the pages.
--
-- Who: the server (white-label-site), FlyttGo's administrators, and a
-- company's members for their own company; anyone signed in for an offered
-- template without a company.
CREATE OR REPLACE FUNCTION public.site_template_image_map(p_template text, p_org uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  t public.site_templates%ROWTYPE; v_cat text; v_library boolean; v_staff boolean := public.is_server() OR public.is_admin();
  s record; o record; ti public.site_template_images%ROWTYPE; l record; v_url text;
  v_out jsonb := '{}'::jsonb; v_pages jsonb := '{}'::jsonb; v_count jsonb := '{}'::jsonb; v_entry jsonb;
BEGIN
  IF p_org IS NOT NULL AND NOT (v_staff OR public.is_org_member(p_org)) THEN
    RAISE EXCEPTION 'website images: members of the company only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.site_templates WHERE id = p_template;
  IF NOT FOUND OR (t.status <> 'approved' AND NOT v_staff AND NOT EXISTS (
       SELECT 1 FROM public.organization_white_label w WHERE w.organization_id = p_org AND w.template_id = p_template)) THEN
    RAISE EXCEPTION 'website images: no such template' USING ERRCODE = 'P0002';
  END IF;
  v_cat := public.site_template_category(t.industry);
  v_library := v_cat IS NOT NULL AND EXISTS (SELECT 1 FROM public.image_library WHERE category = v_cat AND review_status = 'approved');

  FOR s IN SELECT * FROM public.site_template_image_slots(p_template) LOOP
    v_entry := NULL;
    -- 1. The company's own image.
    IF p_org IS NOT NULL THEN
      SELECT os.storage_path, os.alt_text, os.library_image_id, li.storage_path AS lib_path, li.alt_text AS lib_alt,
             li.review_status AS lib_status, li.focal_x, li.focal_y
        INTO o
        FROM public.organization_site_images os LEFT JOIN public.image_library li ON li.id = os.library_image_id
       WHERE os.organization_id = p_org AND os.slot_key = s.slot_key;
      IF FOUND THEN
        IF o.storage_path IS NOT NULL THEN
          v_entry := jsonb_build_object('source', 'company', 'bucket', 'organization-site-images', 'path', o.storage_path, 'alt', o.alt_text);
        ELSIF o.lib_status = 'approved' THEN
          -- A picked library image counts only while it stays approved.
          v_entry := jsonb_build_object('source', 'company', 'bucket', 'site-image-library', 'path', o.lib_path,
                                        'alt', coalesce(o.alt_text, o.lib_alt), 'id', o.library_image_id, 'focal_x', o.focal_x, 'focal_y', o.focal_y);
        END IF;
      END IF;
    END IF;
    -- 2. The template's own image, approved with its licence known.
    IF v_entry IS NULL THEN
      SELECT * INTO ti FROM public.site_template_images WHERE template_id = p_template AND asset_key = s.slot_key;
      IF FOUND AND ti.review_status = 'approved'
         AND (nullif(btrim(ti.licence), '') IS NOT NULL OR ti.source = 'own'
              OR (ti.source = 'ai-generated' AND nullif(btrim(ti.generation ->> 'model'), '') IS NOT NULL)) THEN
        v_entry := jsonb_build_object('source', 'template', 'url', ti.url, 'alt', ti.intended_use);
      END IF;
    END IF;
    -- 3. A library image of the template's category, in the slot's shape.
    IF v_entry IS NULL AND v_library THEN
      SELECT li.id, li.storage_path, li.alt_text, li.focal_x, li.focal_y INTO l
        FROM public.image_library li
       WHERE li.review_status = 'approved' AND li.category = v_cat AND li.shape = ANY (public.site_image_shapes_for(s.shape))
       ORDER BY EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(v_pages -> (li.id::text), '[]'::jsonb)) pg
                         WHERE pg::int = ANY (s.pages)),
                coalesce((v_count ->> (li.id::text))::int, 0),
                array_position(public.site_image_shapes_for(s.shape), li.shape),
                md5(p_template || '/' || s.slot_key || '/' || li.sha256)
       LIMIT 1;
      IF FOUND THEN
        v_entry := jsonb_build_object('source', 'library', 'bucket', 'site-image-library', 'path', l.storage_path, 'alt', l.alt_text,
                                      'id', l.id, 'focal_x', l.focal_x, 'focal_y', l.focal_y);
      END IF;
    END IF;
    -- Before the category has a library: the template's asset, as before.
    IF v_entry IS NULL AND NOT v_library THEN
      SELECT a ->> 'url' INTO v_url FROM jsonb_array_elements(t.assets) WITH ORDINALITY AS e(a, n)
       WHERE a ->> 'key' IN (s.slot_key, regexp_replace(s.slot_key, '\.\d+$', ''), s.slot_key || '.1')
       ORDER BY CASE a ->> 'key' WHEN s.slot_key THEN 0 WHEN regexp_replace(s.slot_key, '\.\d+$', '') THEN 1 ELSE 2 END, n LIMIT 1;
      IF v_url IS NOT NULL THEN v_entry := jsonb_build_object('source', 'assets', 'url', v_url); END IF;
    END IF;
    -- 4. The neutral block.
    v_entry := coalesce(v_entry, jsonb_build_object('source', 'fallback'));
    -- What is used where, for the next slots' picks.
    IF v_entry ? 'id' THEN
      v_pages := jsonb_set(v_pages, ARRAY[v_entry ->> 'id'], coalesce(v_pages -> (v_entry ->> 'id'), '[]'::jsonb) || to_jsonb(s.pages));
      v_count := jsonb_set(v_count, ARRAY[v_entry ->> 'id'], to_jsonb(coalesce((v_count ->> (v_entry ->> 'id'))::int, 0) + 1));
    END IF;
    v_out := v_out || jsonb_build_object(s.slot_key, jsonb_strip_nulls(v_entry || jsonb_build_object('shape', s.shape)));
  END LOOP;

  RETURN jsonb_build_object('template', p_template, 'category', v_cat, 'mode', CASE WHEN v_library THEN 'library' ELSE 'assets' END,
                            'images', v_out);
END $$;

REVOKE ALL ON FUNCTION public.site_template_image_map(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.site_template_image_map(text, uuid) TO authenticated, service_role;
