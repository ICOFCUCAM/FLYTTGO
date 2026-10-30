-- ============================================================================
-- Roll back 00023_image_library.sql
-- ============================================================================
-- Run first (before the rollbacks of earlier migrations). Tested by run.sh:
-- afterwards the schema and function bodies are exactly as before 00023.
--
-- DATA LOSS — READ FIRST. Drops the image library's records (image_library:
-- category, shape, tags, alt texts, origins, licences and their evidence,
-- sources, reviews and their history; export the table first) and the
-- companies' own images per slot (organization_site_images; export it
-- first). Companies' sites go back to their template's images. The files
-- stay in storage: the two buckets are removed only when they are empty.
-- The company log (organization_events, action white_label.site_image)
-- stays. Nothing earlier is changed by 00023, so nothing is restored.
-- ============================================================================

DROP FUNCTION IF EXISTS public.site_template_image_map(text, uuid);
DROP FUNCTION IF EXISTS public.reset_organization_site_image(uuid, text);
DROP FUNCTION IF EXISTS public.set_organization_site_image(uuid, text, jsonb);
DROP POLICY IF EXISTS organization_site_images_read ON storage.objects;
DROP POLICY IF EXISTS organization_site_images_write ON storage.objects;
DROP POLICY IF EXISTS organization_site_images_update ON storage.objects;
DROP POLICY IF EXISTS organization_site_images_delete ON storage.objects;
DELETE FROM storage.buckets b WHERE b.id = 'organization-site-images'
   AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = b.id);
DROP TABLE IF EXISTS public.organization_site_images;

DROP FUNCTION IF EXISTS public.admin_image_library_coverage();
DROP FUNCTION IF EXISTS public.image_library_categories();
DROP FUNCTION IF EXISTS public.admin_review_library_image(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_update_library_image(uuid, jsonb);
DROP FUNCTION IF EXISTS public.admin_add_library_image(jsonb);
DROP POLICY IF EXISTS site_image_library_admin_insert ON storage.objects;
DELETE FROM storage.buckets b WHERE b.id = 'site-image-library'
   AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = b.id);
DROP TABLE IF EXISTS public.image_library;

DROP FUNCTION IF EXISTS public.site_template_image_slots(text);
DROP FUNCTION IF EXISTS public.site_image_shapes_for(text);
DROP FUNCTION IF EXISTS public.site_image_slot_shape(text, text, integer, integer);
DROP FUNCTION IF EXISTS public.image_shape_of(integer, integer);
DROP FUNCTION IF EXISTS public.site_image_categories();
DROP FUNCTION IF EXISTS public.site_template_category(text[]);
