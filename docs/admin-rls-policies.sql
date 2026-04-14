-- ============================================================================
-- FlyttGo — Admin RLS policies
-- ============================================================================
-- Problem: the current RLS policies on bookings / drivers / driver_applications
-- only let a user see or modify their OWN rows (user_id = auth.uid()).
-- That means the AdminDashboard queries silently return the admin's own rows
-- instead of the whole platform — and admin writes are rejected.
--
-- Fix: add a helper that checks the admin_accounts table, then grant
-- full read/write access to admins on every table the dashboard touches.
-- Run this file in the Supabase SQL Editor (the editor runs as `postgres`
-- which is allowed to create policies).
--
-- Safe to re-run — every CREATE uses IF NOT EXISTS / OR REPLACE.
-- ============================================================================

-- Helper function: is the current JWT user an admin?
-- SECURITY DEFINER so it can read admin_accounts even if RLS is on that
-- table. search_path is pinned to 'public' to avoid search_path hijacking.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_accounts
    WHERE user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- ============================================================================
-- bookings
-- ============================================================================
DROP POLICY IF EXISTS bookings_admin_all ON public.bookings;
CREATE POLICY bookings_admin_all ON public.bookings
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- drivers
-- ============================================================================
DROP POLICY IF EXISTS drivers_admin_all ON public.drivers;
CREATE POLICY drivers_admin_all ON public.drivers
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- driver_applications
-- ============================================================================
DROP POLICY IF EXISTS driver_applications_admin_all ON public.driver_applications;
CREATE POLICY driver_applications_admin_all ON public.driver_applications
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- profiles
-- ============================================================================
-- The app also needs admins to be able to update any profile (for role changes).
-- profiles already has RLS enabled but only a SELECT policy; we add a full one
-- for admins.
DROP POLICY IF EXISTS profiles_admin_all ON public.profiles;
CREATE POLICY profiles_admin_all ON public.profiles
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Self-update for non-admin users (so the /profile page can save changes).
-- Right now there's NO UPDATE policy at all, which means the Profile page
-- save button silently fails under RLS.
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Self-insert (profile rows are created by the signup flow).
DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
CREATE POLICY profiles_self_insert ON public.profiles
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- Tables that currently have no RLS at all — enable RLS + grant admin full +
-- grant minimal owner-scoped policies for non-admin users.
-- ============================================================================

-- driver_profiles
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_profiles_admin_all ON public.driver_profiles;
CREATE POLICY driver_profiles_admin_all ON public.driver_profiles
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS driver_profiles_self_select ON public.driver_profiles;
CREATE POLICY driver_profiles_self_select ON public.driver_profiles
  FOR SELECT
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS driver_profiles_self_update ON public.driver_profiles;
CREATE POLICY driver_profiles_self_update ON public.driver_profiles
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- driver_documents (keyed by driver_id which maps to auth.uid())
ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_documents_admin_all ON public.driver_documents;
CREATE POLICY driver_documents_admin_all ON public.driver_documents
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS driver_documents_self ON public.driver_documents;
CREATE POLICY driver_documents_self ON public.driver_documents
  FOR ALL
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

-- driver_subscriptions
ALTER TABLE public.driver_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_subscriptions_admin_all ON public.driver_subscriptions;
CREATE POLICY driver_subscriptions_admin_all ON public.driver_subscriptions
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS driver_subscriptions_self_select ON public.driver_subscriptions;
CREATE POLICY driver_subscriptions_self_select ON public.driver_subscriptions
  FOR SELECT
  USING (
    driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  );

-- escrow_payments (keyed by booking_id -> bookings.customer_id)
ALTER TABLE public.escrow_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS escrow_payments_admin_all ON public.escrow_payments;
CREATE POLICY escrow_payments_admin_all ON public.escrow_payments
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS escrow_payments_customer_select ON public.escrow_payments;
CREATE POLICY escrow_payments_customer_select ON public.escrow_payments
  FOR SELECT
  USING (
    booking_id IN (SELECT id FROM public.bookings WHERE customer_id = auth.uid())
  );

-- commission_ledger (platform revenue — admin only)
ALTER TABLE public.commission_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commission_ledger_admin_all ON public.commission_ledger;
CREATE POLICY commission_ledger_admin_all ON public.commission_ledger
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- subscription_payments
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_payments_admin_all ON public.subscription_payments;
CREATE POLICY subscription_payments_admin_all ON public.subscription_payments
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- driver_wallet_transactions
ALTER TABLE public.driver_wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_wallet_transactions_admin_all ON public.driver_wallet_transactions;
CREATE POLICY driver_wallet_transactions_admin_all ON public.driver_wallet_transactions
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS driver_wallet_transactions_self_select ON public.driver_wallet_transactions;
CREATE POLICY driver_wallet_transactions_self_select ON public.driver_wallet_transactions
  FOR SELECT
  USING (driver_id = auth.uid());

-- booking_updates / dispatch_logs — admin read only
ALTER TABLE public.booking_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_updates_admin_all ON public.booking_updates;
CREATE POLICY booking_updates_admin_all ON public.booking_updates
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.dispatch_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dispatch_logs_admin_all ON public.dispatch_logs;
CREATE POLICY dispatch_logs_admin_all ON public.dispatch_logs
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- platform_config (admin only)
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_config_admin_all ON public.platform_config;
CREATE POLICY platform_config_admin_all ON public.platform_config
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
-- Anyone can read public config values (it's used for pricing etc).
DROP POLICY IF EXISTS platform_config_read_all ON public.platform_config;
CREATE POLICY platform_config_read_all ON public.platform_config
  FOR SELECT USING (true);

-- ============================================================================
-- Verify
-- ============================================================================
-- As an admin, you should now be able to:
--   select count(*) from public.bookings;            -- all rows
--   select count(*) from public.drivers;             -- all rows
--   select count(*) from public.driver_applications; -- all rows
-- As a non-admin customer, the same query should return only your own rows.
