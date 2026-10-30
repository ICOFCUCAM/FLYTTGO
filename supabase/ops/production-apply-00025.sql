-- ============================================================================
-- FlyttGo: migration 00025 as one file, for the production SQL editor
-- ============================================================================
-- Owner's decision 2026-10-30 (docs/DECISIONS.md #51): one stored copy of
-- each template image. Needs 00023 and 00024 (production has them: read
-- 2026-10-30). Tested on the production replica with 00016-00025, including
-- its rollback (supabase/rollback/00025_down.sql). Run this once in
-- Supabase -> FlyttGo Norway -> SQL Editor, then (with the owner's approval)
-- node scripts/dedupe-template-assets.ts --apply. One transaction:
-- everything is applied, or (on any error) nothing is. Generated from
-- supabase/migrations/00025 without changes, plus its row in
-- supabase_migrations.schema_migrations.
-- ============================================================================
BEGIN;

-- ===== 00025_shared_template_assets.sql =====
-- ============================================================================
-- FlyttGo — one stored copy of each template image (storage saving)
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00024. The owner's decision of
-- 2026-10-30 (docs/WHITE_LABEL.md → Image library, "Storage"): FlyttGo's
-- Supabase organisation is past its Free plan's file storage, and most of
-- the 199 imported templates carry their own copy of the SAME photos
-- (site-template-assets/<template id>/hero.1.jpg … : 2,189 files, 13
-- different pictures, read 2026-10-30). Each picture is kept once, at
--
--   site-template-assets/shared/<sha256>.<ext>
--
-- and every template's asset and image slot (site_template_images.url)
-- points at it; the per-template copies are then removed from storage by
-- scripts/dedupe-template-assets.ts --apply (after every new address was
-- checked). Thumbnails are per template and are never shared or moved.
--
-- share_site_template_assets(moves) (server only) changes the addresses of
-- many templates in one transaction, and keeps every thumbnail's state
-- (00024) as it was: a thumbnail records the SHA-256 of the picture key it
-- was drawn with, and the key contains the asset addresses. A thumbnail
-- that was fresh stays fresh (its record is recomputed with the new
-- addresses: the picture is byte for byte the same), one drawn with its
-- assets keeps that record under the new addresses, a stale one stays
-- stale, and one with nothing recorded is computed from the assets as
-- before. Each move is recorded (site_template_asset_moves: template, slot,
-- earlier and new address, SHA-256, when), which tells the script which
-- stored files are earlier copies it may remove.
--
-- The image library's files (owner's decision 2026-10-30): a retired
-- library image's file may be removed from storage while its record stays
-- (images are never deleted as records). Such an image cannot be approved
-- or put back to pending until its file is uploaded again to the same path
-- (admin_review_library_image() checks the file; nothing else changes).
--
-- Safe to re-run. Rolled back by supabase/rollback/00025_down.sql.
-- ============================================================================

-- ── 1. What was moved ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_template_asset_moves (
  template_id text        NOT NULL REFERENCES public.site_templates (id) ON DELETE CASCADE,
  asset_key   text        NOT NULL CHECK (asset_key ~ '^[A-Za-z0-9._-]{1,60}$' AND asset_key <> 'thumbnail'),
  from_url    text        NOT NULL CHECK (from_url ~ '^https://'),
  to_url      text        NOT NULL CHECK (to_url ~ '^https://[^/]+/storage/v1/object/public/site-template-assets/shared/[0-9a-f]{64}\.(png|jpg|webp)$'),
  sha256      text        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  moved_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, asset_key, from_url)
);
ALTER TABLE public.site_template_asset_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_template_asset_moves_admin ON public.site_template_asset_moves;
CREATE POLICY site_template_asset_moves_admin ON public.site_template_asset_moves FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.site_template_asset_moves FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.site_template_asset_moves FROM authenticated;


-- ── 2. Pointing templates at the shared copies (the script, server only) ───
-- p_moves: [{template, key, from, to, sha256}, …]. Every move is checked
-- before anything is kept (one transaction: all or nothing):
--   - the shared file exists (site-template-assets/shared/<sha256>.<ext>,
--     uploaded and checked by the script first) and its name is the SHA-256;
--   - from is the template's current address for that slot, in its own
--     folder of the same bucket (an address already moved is counted and
--     left; any other address means the template changed since the plan
--     was made: nothing is changed, make the plan again);
--   - the slot's recorded image (00021), if any, has the same SHA-256.
-- The template's review status, the image's review status and history are
-- not changed: the picture is the same.
CREATE OR REPLACE FUNCTION public.share_site_template_assets(p_moves jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_t text; m jsonb; t public.site_templates%ROWTYPE; ti public.site_template_images%ROWTYPE;
  v_key text; v_from text; v_to text; v_sha text; v_base text; v_cur text; v_rec text; v_new text;
  v_map_before text; v_assets_before text;
  v_moved int := 0; v_already int := 0; v_templates int := 0; v_rekeyed int := 0;
BEGIN
  IF NOT public.is_server() THEN
    RAISE EXCEPTION 'template images: the dedupe script (server) only' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_moves, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'template images: a list of moves' USING ERRCODE = '22023';
  END IF;

  FOR v_t IN SELECT DISTINCT x ->> 'template' FROM jsonb_array_elements(p_moves) x ORDER BY 1 LOOP
    SELECT * INTO t FROM public.site_templates WHERE id = v_t FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'template images: no such template %', coalesce(v_t, '(none)') USING ERRCODE = 'P0002'; END IF;
    v_templates := v_templates + 1;
    -- What the thumbnail can be compared with, before the addresses change.
    v_map_before := public.site_template_images_hash(public.site_template_image_map(v_t, NULL));
    v_assets_before := public.site_template_images_hash(public.site_template_assets_map(v_t));

    FOR m IN SELECT x FROM jsonb_array_elements(p_moves) x WHERE x ->> 'template' = v_t LOOP
      v_key := m ->> 'key'; v_from := m ->> 'from'; v_to := m ->> 'to'; v_sha := m ->> 'sha256';
      IF coalesce(v_key, '') !~ '^[A-Za-z0-9._-]{1,60}$' OR v_key = 'thumbnail' THEN
        RAISE EXCEPTION 'template images: % has no slot % to share (thumbnails stay with their template)', v_t, coalesce(v_key, '(none)')
          USING ERRCODE = '22023';
      END IF;
      IF coalesce(v_sha, '') !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'template images: the SHA-256 of %/%', v_t, v_key USING ERRCODE = '22023';
      END IF;
      v_base := substring(coalesce(v_from, '') FROM '^(https://[^/]+/storage/v1/object/public/site-template-assets/)');
      IF v_base IS NULL OR left(substr(v_from, length(v_base) + 1), length(v_t) + 1) <> v_t || '/' THEN
        RAISE EXCEPTION 'template images: % is not in the template''s own folder of site-template-assets', coalesce(v_from, '(none)')
          USING ERRCODE = '22023';
      END IF;
      IF left(coalesce(v_to, ''), length(v_base)) <> v_base
         OR substr(v_to, length(v_base) + 1) !~ ('^shared/' || v_sha || '\.(png|jpg|webp)$')
         OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'site-template-assets'
                         AND o.name = substr(v_to, length(v_base) + 1)) THEN
        RAISE EXCEPTION 'template images: upload the shared copy to site-template-assets/shared/%.<ext> first', v_sha USING ERRCODE = '22023';
      END IF;
      SELECT a ->> 'url' INTO v_cur FROM jsonb_array_elements(t.assets) a WHERE a ->> 'key' = v_key LIMIT 1;
      IF v_cur IS NULL THEN RAISE EXCEPTION 'template images: % has no image %', v_t, v_key USING ERRCODE = 'P0002'; END IF;
      SELECT * INTO ti FROM public.site_template_images WHERE template_id = v_t AND asset_key = v_key FOR UPDATE;
      IF FOUND AND ((ti.sha256 IS NOT NULL AND ti.sha256 <> v_sha) OR ti.url NOT IN (v_from, v_to)) THEN
        RAISE EXCEPTION 'template images: the recorded image of %/% is not that picture; make the plan again', v_t, v_key USING ERRCODE = '40001';
      END IF;
      IF v_cur = v_to THEN
        v_already := v_already + 1;
      ELSIF v_cur <> v_from THEN
        RAISE EXCEPTION 'template images: %/% changed since the plan was made; make the plan again', v_t, v_key USING ERRCODE = '40001';
      ELSE
        UPDATE public.site_templates SET
          assets = (SELECT jsonb_agg(CASE WHEN a ->> 'key' = v_key AND a ->> 'url' = v_from THEN a || jsonb_build_object('url', v_to) ELSE a END
                                     ORDER BY n)
                      FROM jsonb_array_elements(assets) WITH ORDINALITY AS e(a, n)),
          updated_at = now()
         WHERE id = v_t RETURNING * INTO t;
        INSERT INTO public.site_template_asset_moves (template_id, asset_key, from_url, to_url, sha256)
        VALUES (v_t, v_key, v_from, v_to, v_sha) ON CONFLICT DO NOTHING;
        v_moved := v_moved + 1;
      END IF;
      UPDATE public.site_template_images SET url = v_to, updated_at = now()
       WHERE template_id = v_t AND asset_key = v_key AND url = v_from;
    END LOOP;

    -- The thumbnail keeps its state: a recorded picture key that was the
    -- template's images (or its assets) is recomputed with the new addresses.
    SELECT nullif(a ->> 'images', '') INTO v_rec FROM jsonb_array_elements(t.assets) a WHERE a ->> 'key' = 'thumbnail' LIMIT 1;
    IF v_rec IS NOT NULL THEN
      v_new := CASE WHEN v_rec = v_map_before THEN public.site_template_images_hash(public.site_template_image_map(v_t, NULL))
                    WHEN v_rec = v_assets_before THEN public.site_template_images_hash(public.site_template_assets_map(v_t)) END;
      IF v_new IS NOT NULL AND v_new <> v_rec THEN
        UPDATE public.site_templates SET
          assets = (SELECT jsonb_agg(CASE WHEN a ->> 'key' = 'thumbnail' THEN a || jsonb_build_object('images', v_new) ELSE a END ORDER BY n)
                      FROM jsonb_array_elements(assets) WITH ORDINALITY AS e(a, n))
         WHERE id = v_t;
        v_rekeyed := v_rekeyed + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('templates', v_templates, 'moved', v_moved, 'already', v_already, 'thumbnails_rekeyed', v_rekeyed);
END $$;

REVOKE ALL ON FUNCTION public.share_site_template_assets(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_site_template_assets(jsonb) TO authenticated, service_role;


-- ── 3. A library image whose file was removed ──────────────────────────────
-- As in 00023, and: an image is approved or put back to pending only while
-- its file is in storage (a retired image's file may be removed to save
-- space; its record stays). Upload the file to the same path to restore it.
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
  IF p_status IN ('approved', 'pending')
     AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'site-image-library' AND o.name = r.storage_path) THEN
    RAISE EXCEPTION 'image library: the image''s file was removed from storage; upload it to site-image-library/% again first', r.storage_path
      USING ERRCODE = '55000';
  END IF;
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

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261030120025', '00025_shared_template_assets')
ON CONFLICT (version) DO NOTHING;

COMMIT;
