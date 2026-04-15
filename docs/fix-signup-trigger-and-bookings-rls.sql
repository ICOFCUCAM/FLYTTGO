-- ============================================================================
-- FlyttGo — Fix signup profile trigger + customer bookings RLS policies
-- ============================================================================
-- Run this file in Supabase → SQL Editor (the editor runs as `postgres`
-- which is allowed to create triggers on auth.users and manage RLS).
-- Safe to re-run — every CREATE uses DROP IF EXISTS / OR REPLACE / ON CONFLICT.
--
-- Problem 1 — new signups have no profile row
--
--   auth.tsx signUp() used to call supabase.auth.signUp() and then
--   immediately run an INSERT INTO profiles from the browser. With email
--   confirmations ENABLED, signUp doesn't return a session, so that
--   second call runs as the 'anon' role. The profiles_self_insert RLS
--   policy requires user_id = auth.uid(), but auth.uid() is NULL for
--   anon, so the insert silently failed. Result: the new user landed in
--   auth.users with no profile row, fetchProfile() returned null, the
--   Header component treated them as unsigned, and the dashboard was
--   unreachable — even though they were technically authenticated.
--
--   Fix: use a SECURITY DEFINER trigger on auth.users that creates the
--   profile row atomically with the auth user, bypassing RLS. This is
--   the Supabase-recommended pattern for signup.
--
-- Problem 2 — "new row violates row-level security policy for table bookings"
--
--   bookings has RLS enabled (by admin-rls-policies.sql) but only an
--   admin_all policy was added. There were no customer-scoped INSERT /
--   SELECT / UPDATE policies, so an authenticated customer could not
--   create or read their own bookings — even with a valid session.
--
--   Fix: add customer-scoped RLS policies keyed on customer_id.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Auto-create profile row on signup
-- ----------------------------------------------------------------------------

-- Note on conflict handling: we use an IF NOT EXISTS pre-check instead
-- of ON CONFLICT (user_id) because profiles.user_id may not have a
-- UNIQUE constraint in every project, and ON CONFLICT requires one.
-- IF NOT EXISTS is identical in effect (idempotent, no duplicates) but
-- has no constraint prerequisites — it will work regardless of what
-- indexes / constraints are on the profiles table.
--
-- Note on the `id` column: the profiles table has both `id` (its own
-- primary key) AND `user_id` (the FK to auth.users.id). The `id` column
-- is NOT NULL with no default, so we have to supply one explicitly via
-- gen_random_uuid() — otherwise the insert fails with 23502.
-- gen_random_uuid() is built in to Postgres 13+ via pgcrypto which
-- Supabase projects ship with enabled by default.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.id) THEN
    INSERT INTO public.profiles (
      id,
      user_id,
      email,
      first_name,
      last_name,
      role,
      referral_code
    ) VALUES (
      gen_random_uuid(),
      NEW.id,
      NEW.email,
      NULLIF(meta ->> 'first_name', ''),
      NULLIF(meta ->> 'last_name',  ''),
      COALESCE(NULLIF(meta ->> 'role', ''), 'customer'),
      'FLYTTGO-' || UPPER(SUBSTRING(NEW.id::text FROM 1 FOR 8))
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Rebind the trigger so any old version is replaced cleanly.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ----------------------------------------------------------------------------
-- 2. Backfill profile rows for existing auth.users that don't have one
-- ----------------------------------------------------------------------------
-- This rescues any users who signed up before the trigger existed — their
-- auth.users row is there but profiles is empty, which is exactly why the
-- Header shows Sign In buttons even after they sign in.
--
-- We reuse the metadata the frontend sent via options.data (first_name,
-- last_name, role); fall back to blank / 'customer' for older rows where
-- the metadata wasn't populated.

INSERT INTO public.profiles (
  id,
  user_id,
  email,
  first_name,
  last_name,
  role,
  referral_code
)
SELECT
  gen_random_uuid(),
  u.id,
  u.email,
  NULLIF(u.raw_user_meta_data ->> 'first_name', ''),
  NULLIF(u.raw_user_meta_data ->> 'last_name',  ''),
  COALESCE(NULLIF(u.raw_user_meta_data ->> 'role', ''), 'customer'),
  'FLYTTGO-' || UPPER(SUBSTRING(u.id::text FROM 1 FOR 8))
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL;


-- ----------------------------------------------------------------------------
-- 3. Customer-scoped RLS policies for bookings
-- ----------------------------------------------------------------------------
-- The bookings table uses customer_id (a FK to auth.users.id) to identify
-- the booking owner. Policies mirror that.

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Customer can create bookings only for themselves.
DROP POLICY IF EXISTS bookings_customer_insert ON public.bookings;
CREATE POLICY bookings_customer_insert ON public.bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = auth.uid());

-- Customer can read their own bookings.
DROP POLICY IF EXISTS bookings_customer_select ON public.bookings;
CREATE POLICY bookings_customer_select ON public.bookings
  FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

-- Customer can update their own bookings (cancel, confirm delivery, etc.).
DROP POLICY IF EXISTS bookings_customer_update ON public.bookings;
CREATE POLICY bookings_customer_update ON public.bookings
  FOR UPDATE
  TO authenticated
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 4. Customer self-SELECT on profiles
-- ----------------------------------------------------------------------------
-- admin-rls-policies.sql added profiles_admin_all / profiles_self_update /
-- profiles_self_insert but no SELECT policy for non-admins, so fetchProfile()
-- in auth.tsx returned no rows for customers. That left profile = null in
-- the Header component, which rendered Sign In / Sign Up buttons even for
-- signed-in users and hid the Dashboard / My Bookings / Sign Out dropdown.

DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());


-- ============================================================================
-- Verify
-- ============================================================================
--
--   -- 1. Confirm the trigger exists
--   SELECT tgname FROM pg_trigger WHERE tgname = 'on_auth_user_created';
--
--   -- 2. Confirm every auth.users row now has a matching profiles row
--   SELECT COUNT(*) AS orphaned
--   FROM auth.users u
--   LEFT JOIN public.profiles p ON p.user_id = u.id
--   WHERE p.user_id IS NULL;
--   -- Expected: 0
--
--   -- 3. Confirm the customer RLS policies exist
--   SELECT policyname FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'bookings'
--   ORDER BY policyname;
--   -- Expected at least: bookings_admin_all, bookings_customer_insert,
--   --                    bookings_customer_select, bookings_customer_update
--
-- Then try creating a booking from the frontend — it should now succeed.
-- ============================================================================
