-- ============================================================================
-- FlyttGo — Driver onboarding pipeline fix
-- ============================================================================
-- Glues together a driver-facing onboarding + approval + subscription flow
-- using the tables that ALREADY exist (driver_applications, driver_profiles,
-- driver_subscriptions, driver_documents, driver-documents storage bucket).
-- Nothing in this file creates a new table — everything is either a policy,
-- a trigger, a column add, or a storage policy.
--
-- What it fixes:
--
--   1. Drivers couldn't read their own application row → status page had
--      nothing to render. Adds driver_applications_self_select.
--
--   2. Drivers couldn't INSERT a driver_applications row under RLS →
--      submissions silently failed or depended on the admin-only policy.
--      Adds driver_applications_self_insert + _self_update for retries.
--
--   3. Drivers couldn't INSERT a driver_documents row or upload to the
--      driver-documents storage bucket. Adds _self_insert / _self_select
--      on the table, plus storage policies keyed on folder prefix.
--
--   4. profiles.role stayed 'customer' after admin approval because the
--      frontend role UPDATE was best-effort and had no UPDATE policy for
--      drivers. Adds a trigger on driver_profiles that flips the role
--      atomically when a row is inserted / updated into status='approved'.
--
--   5. driver_applications had no columns for capturing who reviewed the
--      application, when, or why it was rejected. Adds reviewed_by,
--      reviewed_at, rejection_reason (all nullable + safe to re-run).
--
-- Safe to re-run — every CREATE uses IF NOT EXISTS / DROP IF EXISTS first.
-- Run in Supabase → SQL Editor as the postgres role.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. driver_applications — columns for the review audit trail
-- ----------------------------------------------------------------------------
-- ADD COLUMN IF NOT EXISTS is idempotent so this is safe even if an earlier
-- migration already added these (we just don't want to fail the whole file).

ALTER TABLE public.driver_applications
  ADD COLUMN IF NOT EXISTS reviewed_by      uuid        REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;


-- ----------------------------------------------------------------------------
-- 2. driver_applications — self-scoped RLS
-- ----------------------------------------------------------------------------
-- admin-rls-policies.sql only grants admin_all on this table, so drivers
-- can neither insert their own row (blocking DriverOnboarding submission)
-- nor read it back afterwards (blocking the status page). These policies
-- let a signed-in user manage exactly their own row.

ALTER TABLE public.driver_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_applications_self_insert ON public.driver_applications;
CREATE POLICY driver_applications_self_insert ON public.driver_applications
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS driver_applications_self_select ON public.driver_applications;
CREATE POLICY driver_applications_self_select ON public.driver_applications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- UPDATE allows drivers to resubmit a rejected application (the status
-- page lets them re-upload and flip status back to 'pending'). They can
-- only update their own row, and admins always retain full control via
-- driver_applications_admin_all.
DROP POLICY IF EXISTS driver_applications_self_update ON public.driver_applications;
CREATE POLICY driver_applications_self_update ON public.driver_applications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 3. driver_documents — self-scoped INSERT + SELECT
-- ----------------------------------------------------------------------------
-- The table already has a self-access policy from admin-rls-policies.sql
-- (driver_documents_self, FOR ALL, driver_id = auth.uid()) — but that
-- file's comment noted it was keyed on driver_id = auth.uid(), which is
-- the pattern we use. Re-create it explicitly to guarantee INSERT + SELECT
-- both work for driver-facing document upload, regardless of whatever
-- earlier state the project is in.

ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_documents_self_insert ON public.driver_documents;
CREATE POLICY driver_documents_self_insert ON public.driver_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_documents_self_select ON public.driver_documents;
CREATE POLICY driver_documents_self_select ON public.driver_documents
  FOR SELECT
  TO authenticated
  USING (driver_id = auth.uid());

-- Drivers can also update / delete their own docs during re-submission.
DROP POLICY IF EXISTS driver_documents_self_update ON public.driver_documents;
CREATE POLICY driver_documents_self_update ON public.driver_documents
  FOR UPDATE
  TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_documents_self_delete ON public.driver_documents;
CREATE POLICY driver_documents_self_delete ON public.driver_documents
  FOR DELETE
  TO authenticated
  USING (driver_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 4. Storage: driver-documents bucket + policies
-- ----------------------------------------------------------------------------
-- The bucket itself must exist before any policy or upload will work.
-- Previously this file assumed AdminDashboard had already created it via
-- the Supabase dashboard UI — but on a fresh project that never happens
-- and DriverOnboarding hits "Bucket not found" on first upload. Create
-- it idempotently here with the right limits + allowed mime types so
-- the entire driver-document flow works on a fresh install.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'driver-documents',
  'driver-documents',
  false,                                         -- private bucket
  10 * 1024 * 1024,                              -- 10 MB limit matching the UI
  ARRAY['image/jpeg','image/png','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
-- Supabase Storage access control lives in storage.objects.
--
-- Convention: we store files at '{user_id}/{document_type}.{ext}' — the
-- path's first folder segment is the uploading user's auth.uid(). That
-- makes the policy trivial: drivers may upload, read, update, or delete
-- any object under their own folder.
--
-- Admins can already read everything through driver_documents_admin_all
-- on the table, but the storage policies below are what gate the actual
-- file bytes in the bucket.

-- Drivers can upload into their own folder.
DROP POLICY IF EXISTS "driver-documents-self-insert" ON storage.objects;
CREATE POLICY "driver-documents-self-insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'driver-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Drivers can read their own uploaded files (used for preview on the
-- status page + re-upload flow).
DROP POLICY IF EXISTS "driver-documents-self-select" ON storage.objects;
CREATE POLICY "driver-documents-self-select" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'driver-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Drivers can overwrite their own files (re-upload on rejection).
DROP POLICY IF EXISTS "driver-documents-self-update" ON storage.objects;
CREATE POLICY "driver-documents-self-update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'driver-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'driver-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Drivers can delete their own files (used during re-upload so the old
-- file is replaced cleanly).
DROP POLICY IF EXISTS "driver-documents-self-delete" ON storage.objects;
CREATE POLICY "driver-documents-self-delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'driver-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admins can read every file in the bucket (needed for the AdminDashboard
-- document viewer panel). We reuse the public.is_admin() helper created
-- by admin-rls-policies.sql.
DROP POLICY IF EXISTS "driver-documents-admin-all" ON storage.objects;
CREATE POLICY "driver-documents-admin-all" ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'driver-documents' AND public.is_admin())
  WITH CHECK (bucket_id = 'driver-documents' AND public.is_admin());


-- ----------------------------------------------------------------------------
-- 5. Auto-sync profiles.role when admin approves a driver
-- ----------------------------------------------------------------------------
-- AdminDashboard creates a driver_profiles row with status='approved' when
-- the admin clicks Approve. That used to be disconnected from profiles.role,
-- so the driver stayed a 'customer' forever — Header dropdown showed the
-- wrong menu, the SubscriptionPlans gate refused subscribe clicks, etc.
--
-- This trigger runs as SECURITY DEFINER so it can bypass the profiles RLS
-- (there's no UPDATE policy for arbitrary role changes, which is the right
-- default) and sync the role atomically whenever a driver_profiles row
-- lands in 'approved' status. It also handles the reverse (suspended ->
-- keep role='driver' since they still need driver UI) and re-approval
-- from a previous suspension.

CREATE OR REPLACE FUNCTION public.sync_profile_role_on_driver_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' THEN
    UPDATE public.profiles
       SET role = 'driver'
     WHERE user_id = NEW.user_id
       AND role <> 'driver'
       AND role <> 'admin';  -- admins stay admins
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_role_on_driver_approval ON public.driver_profiles;
CREATE TRIGGER sync_profile_role_on_driver_approval
  AFTER INSERT OR UPDATE OF status ON public.driver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role_on_driver_approval();


-- ----------------------------------------------------------------------------
-- 6. Backfill: sync role for already-approved drivers
-- ----------------------------------------------------------------------------
-- Catches drivers who were approved before this trigger existed. Same
-- rule as the trigger: only flip customers → driver; leave admins alone.

UPDATE public.profiles p
   SET role = 'driver'
  FROM public.driver_profiles dp
 WHERE dp.user_id = p.user_id
   AND dp.status = 'approved'
   AND p.role <> 'driver'
   AND p.role <> 'admin';


-- ============================================================================
-- Verify
-- ============================================================================
--
--   -- 1. New columns on driver_applications
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='driver_applications'
--      AND column_name IN ('reviewed_by','reviewed_at','rejection_reason');
--   -- Expected: 3 rows
--
--   -- 2. Self-scoped policies
--   SELECT policyname FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('driver_applications','driver_documents')
--    ORDER BY tablename, policyname;
--   -- Expected: driver_applications_self_insert / _select / _update,
--   --           driver_documents_self_insert / _select / _update / _delete,
--   --           plus whatever admin policies already existed.
--
--   -- 3. Storage policies on driver-documents
--   SELECT policyname FROM pg_policies
--    WHERE schemaname='storage' AND tablename='objects'
--      AND policyname LIKE 'driver-documents-%'
--    ORDER BY policyname;
--   -- Expected 5 rows.
--
--   -- 4. Trigger is installed
--   SELECT tgname FROM pg_trigger
--    WHERE tgname='sync_profile_role_on_driver_approval';
--   -- Expected: 1 row
--
--   -- 5. Any approved drivers still flagged as customer?
--   SELECT COUNT(*) AS mismatches
--     FROM public.profiles p
--     JOIN public.driver_profiles dp ON dp.user_id = p.user_id
--    WHERE dp.status='approved' AND p.role='customer';
--   -- Expected: 0
--
-- ============================================================================
