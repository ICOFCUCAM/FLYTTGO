-- ============================================================================
-- Roll back 00025_shared_template_assets.sql
-- ============================================================================
-- Run first (before the rollback of 00024). Tested by run.sh: afterwards
-- the schema and function bodies are exactly as before 00025.
--
-- The templates keep the addresses they have: an asset moved to
-- site-template-assets/shared/<sha256>.<ext> keeps pointing there (the
-- shared files stay in storage and show the same picture). The record of
-- the moves (site_template_asset_moves: each template's earlier address) is
-- dropped: export it first if the earlier addresses are wanted (their files
-- are removed by scripts/dedupe-template-assets.ts --apply once the moves
-- are checked). The library's review goes back to 00023's, which does not
-- check that an image's file is in storage: upload the files of retired
-- images removed with --retired-files again before approving any of them.
-- ============================================================================

DROP FUNCTION IF EXISTS public.share_site_template_assets(jsonb);
DROP TABLE IF EXISTS public.site_template_asset_moves;

-- 00023's admin_review_library_image(), exactly.
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
