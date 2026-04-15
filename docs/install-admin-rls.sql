-- ============================================================================
-- FlyttGo — Install is_admin() + admin_all RLS policies
-- ============================================================================
-- This migration installs the helper function and admin-scoped RLS policies
-- that were missing from the project. It's a trimmed-down, production-safe
-- version of the relevant portions of admin-rls-policies.sql, kept separate
-- so projects that already ran that full file don't need to re-run this.
--
-- Why it exists:
--   AdminDashboard renders the right UI when profile.role === 'admin' (which
--   auth.tsx computes by checking admin_accounts), BUT every admin-level
--   query still goes through Supabase RLS. Without admin-scoped policies on
--   the tables that have RLS enabled (bookings, driver_applications,
--   profiles), admins would only see their OWN rows — not the whole
--   platform — and the dashboard would render empty even for valid admins.
--
-- This file:
--   1. Creates public.is_admin() — SECURITY DEFINER helper that returns
--      true when the current jwt.sub has a row in public.admin_accounts.
--   2. Grants EXECUTE to anon + authenticated so policy expressions can
--      call it.
--   3. Adds FOR ALL admin_all policies on bookings, driver_applications,
--      and profiles. These are additive to any existing customer-scoped
--      policies: non-admins keep seeing only their own rows; admins see
--      everything.
--
-- Safe to re-run — every CREATE uses OR REPLACE / DROP IF EXISTS first.
-- Run in Supabase SQL Editor as the postgres role.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Helper: public.is_admin()
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER so it can read admin_accounts regardless of any RLS on
-- that table. search_path pinned to public to prevent search_path hijacking.
-- STABLE so the planner can cache the result within a single statement.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_accounts
     WHERE user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. bookings_admin_all
-- ----------------------------------------------------------------------------
-- Additive to bookings_customer_insert / _select / _update. Customers keep
-- seeing only bookings where customer_id = auth.uid(); admins match the
-- admin_all policy and see every row.

DROP POLICY IF EXISTS bookings_admin_all ON public.bookings;
CREATE POLICY bookings_admin_all ON public.bookings
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ----------------------------------------------------------------------------
-- 3. driver_applications_admin_all
-- ----------------------------------------------------------------------------
-- Needed for admin approval flow: AdminDashboard reads every row
-- (.select('*')) and writes status / rejection_reason / reviewed_by /
-- reviewed_at via handleApplication(). Additive to the existing
-- driver_apps_select_own / _insert_own self-scoped policies.

DROP POLICY IF EXISTS driver_applications_admin_all ON public.driver_applications;
CREATE POLICY driver_applications_admin_all ON public.driver_applications
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ----------------------------------------------------------------------------
-- 4. profiles_admin_all
-- ----------------------------------------------------------------------------
-- AdminDashboard reads profiles to show the customer count card, and may
-- need to update user-facing fields as the app grows. Additive to
-- profiles_self_select so customers keep seeing only their own row.

DROP POLICY IF EXISTS profiles_admin_all ON public.profiles;
CREATE POLICY profiles_admin_all ON public.profiles
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================================
-- Verify
-- ============================================================================
--
--   -- 1. Function exists + SECURITY DEFINER
--   SELECT proname, prosecdef, provolatile
--     FROM pg_proc
--    WHERE proname = 'is_admin' AND pronamespace = 'public'::regnamespace;
--
--   -- 2. Policies installed
--   SELECT tablename, policyname
--     FROM pg_policies
--    WHERE schemaname = 'public' AND policyname LIKE '%admin_all%'
--    ORDER BY tablename;
--   -- Expected: bookings_admin_all, driver_applications_admin_all,
--   --           profiles_admin_all
--
--   -- 3. Impersonate an admin and count visible rows
--   SELECT set_config(
--     'request.jwt.claims',
--     json_build_object('sub','<admin_user_id>','role','authenticated')::text,
--     true
--   );
--   SELECT COUNT(*) FROM public.bookings;             -- expect full count
--   SELECT COUNT(*) FROM public.driver_applications;  -- expect full count
--   SELECT COUNT(*) FROM public.profiles;             -- expect full count
--
-- ============================================================================
