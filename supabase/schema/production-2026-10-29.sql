-- ============================================================================
-- Schema-only replica of the production project "FlyttGo Norway"
-- (qzclatvpzicwhewzdiwf), public schema + storage policies, as read on
-- 2026-10-29 with catalog queries (pg_get_functiondef, pg_get_triggerdef,
-- pg_get_constraintdef, pg_policies, function ACLs). No customer data:
-- only the five subscription_plans rows, which are configuration.
--
-- Production at that time had the emergency fix already applied
-- (admin_accounts RLS + self-select policy; change_driver_subscription no
-- longer executable by anon). No migrations recorded in production.
--
-- Use: tests only (supabase/tests/run.sh, variant "production"), loaded
-- after supabase/tests/supabase-stub.sql INSTEAD OF 00001. Refresh by
-- re-running the queries in docs/PRODUCTION_SCHEMA.md before any live
-- migration; a stale replica proves nothing about production.
-- ============================================================================

SET check_function_bodies = off;

-- ── Tables ──────────────────────────────────────────────────────────────────
CREATE TABLE public.admin_accounts (id uuid NOT NULL, user_id uuid, admin_role text DEFAULT 'admin'::text, permissions jsonb, created_at timestamp without time zone DEFAULT now());
CREATE TABLE public.audit_logs (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid, action_type text, resource_type text, resource_id text, ip_address text, new_value jsonb, log_timestamp timestamp with time zone DEFAULT now());
CREATE TABLE public.booking_items (id uuid DEFAULT gen_random_uuid() NOT NULL, booking_id uuid, item_name text, quantity integer DEFAULT 1, volume numeric, weight numeric, dimensions text);
CREATE TABLE public.booking_metrics (id uuid DEFAULT gen_random_uuid() NOT NULL, metric_date date, total_bookings integer DEFAULT 0, total_revenue numeric DEFAULT 0, average_delivery_time numeric DEFAULT 0);
CREATE TABLE public.booking_stops (id uuid DEFAULT gen_random_uuid() NOT NULL, booking_id uuid, sequence integer, address text, stop_lat numeric, stop_lng numeric, stop_type text DEFAULT 'intermediate'::text);
CREATE TABLE public.booking_updates (id uuid DEFAULT gen_random_uuid() NOT NULL, booking_id uuid, status text, updated_by uuid, update_timestamp timestamp with time zone DEFAULT now());
CREATE TABLE public.bookings (id uuid DEFAULT gen_random_uuid() NOT NULL, customer_id uuid, driver_id uuid, pickup_address text, dropoff_address text, pickup_lat numeric, pickup_lng numeric, dropoff_lat numeric, dropoff_lng numeric, status text DEFAULT 'pending'::text, van_type text, helpers integer DEFAULT 0, price_estimate numeric, final_price numeric, distance_km numeric, duration_hours numeric, move_type text, move_date timestamp with time zone, items jsonb DEFAULT '[]'::jsonb, additional_services jsonb DEFAULT '[]'::jsonb, customer_notes text, customer_confirmed boolean DEFAULT false, admin_confirmed boolean DEFAULT false, payment_status text DEFAULT 'pending'::text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), commission_amount numeric DEFAULT 0, driver_earning numeric DEFAULT 0, estimated_hours numeric(6,2), actual_hours numeric(6,2), hourly_rate numeric(10,2), original_price numeric(10,2), price_adjusted boolean DEFAULT false, start_time timestamp with time zone, end_time timestamp with time zone, driver_confirmation boolean DEFAULT false, customer_confirmation boolean DEFAULT false, commission_rate numeric(6,4), payment_intent_id text, payment_provider text, escrow_activated boolean DEFAULT false, pickup_postcode text, dropoff_postcode text, pickup_city text, dropoff_city text, duration_minutes integer, move_time time without time zone, customer_name text, customer_phone text, customer_email text, stripe_session_id text, name text, phone text, email text);
CREATE TABLE public.chat_messages (id uuid DEFAULT gen_random_uuid() NOT NULL, chat_room_id uuid, sender_id uuid, message text, message_status text DEFAULT 'sent'::text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.chat_moderation_logs (id uuid DEFAULT gen_random_uuid() NOT NULL, message_id uuid, violation_type text, action_taken text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.chat_rooms (id uuid DEFAULT gen_random_uuid() NOT NULL, booking_id uuid, customer_id uuid, driver_id uuid, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.commission_ledger (id uuid DEFAULT gen_random_uuid() NOT NULL, booking_id uuid, driver_id uuid, job_price numeric, base_commission_rate numeric, dynamic_modifier numeric DEFAULT 0, final_commission_rate numeric, commission_amount numeric, driver_earning numeric, platform_revenue numeric, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.corporate_accounts (id uuid DEFAULT gen_random_uuid() NOT NULL, company_name text, contact_email text, billing_address text, api_key text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.corporate_orders (id uuid DEFAULT gen_random_uuid() NOT NULL, corporate_account_id uuid, booking_id uuid, invoice_status text DEFAULT 'pending'::text, billing_cycle text DEFAULT 'monthly'::text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.delivery_proof (id uuid DEFAULT gen_random_uuid() NOT NULL, booking_id uuid, photo_url text, signature_url text, proof_timestamp timestamp with time zone DEFAULT now());
CREATE TABLE public.demand_forecasts (id uuid DEFAULT gen_random_uuid() NOT NULL, city text, zone text, predicted_bookings integer, forecast_date date, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.dispatch_logs (id uuid DEFAULT gen_random_uuid() NOT NULL, booking_id uuid, driver_id uuid, dispatch_score numeric, notification_sent_at timestamp with time zone, response text, response_time integer, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.driver_applications (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid, first_name text, last_name text, email text, phone text, address text, license_number text, license_expiry date, years_experience integer, vehicle_type text, vehicle_model text, vehicle_year integer, vehicle_registration text, cargo_capacity numeric, city text, zone text, status text DEFAULT 'pending'::text, documents jsonb DEFAULT '{}'::jsonb, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.driver_documents (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, document_type text, file_url text, verification_status text DEFAULT 'pending'::text, uploaded_at timestamp with time zone DEFAULT now(), status text DEFAULT 'pending'::text);
CREATE TABLE public.driver_locations (driver_id uuid NOT NULL, lat numeric DEFAULT 0 NOT NULL, lng numeric DEFAULT 0 NOT NULL, heading numeric, speed numeric, updated_at timestamp with time zone DEFAULT now());
CREATE TABLE public.driver_metrics (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, rating numeric DEFAULT 5.0, acceptance_rate numeric DEFAULT 100, cancellation_rate numeric DEFAULT 0, completed_deliveries integer DEFAULT 0, trust_score numeric DEFAULT 50, tier text DEFAULT 'Silver Star'::text, jobs_completed integer DEFAULT 0, earnings numeric DEFAULT 0, online_hours numeric DEFAULT 0, metric_date date);
CREATE TABLE public.driver_payouts (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, amount numeric, payout_method text, status text DEFAULT 'pending'::text, processed_at timestamp with time zone);
CREATE TABLE public.driver_profiles (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid, full_name text, city text, status text DEFAULT 'pending'::text, rating numeric DEFAULT 0, total_jobs integer DEFAULT 0, created_at timestamp without time zone DEFAULT now(), subscription_plan text DEFAULT 'free'::text, subscription_active boolean DEFAULT false, trust_score numeric DEFAULT 5.0, online boolean DEFAULT false, acceptance_rate numeric DEFAULT 100, cancellation_rate numeric DEFAULT 0, completed_deliveries integer DEFAULT 0, tier text DEFAULT 'Silver Star'::text, first_name text, last_name text, phone text, vehicle_type text, vehicle_model text, license_plate text, van_size text, zone text);
CREATE TABLE public.driver_service_cities (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, city text NOT NULL, created_at timestamp without time zone DEFAULT now());
CREATE TABLE public.driver_subscriptions (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, plan_id uuid, payment_method text DEFAULT 'stripe'::text, subscription_status text DEFAULT 'active'::text, start_date timestamp with time zone DEFAULT now(), end_date timestamp with time zone, stripe_subscription_id text, created_at timestamp with time zone DEFAULT now(), pending_plan text, proration_credit numeric DEFAULT 0, amount_paid_nok numeric DEFAULT 0, vat_nok numeric DEFAULT 0);
CREATE TABLE public.driver_transactions (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, booking_id uuid, amount numeric, type text, created_at timestamp without time zone DEFAULT now());
CREATE TABLE public.driver_verification (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, verification_status text DEFAULT 'pending'::text, approved_by uuid, approved_at timestamp with time zone, notes text, license_uploaded boolean DEFAULT false, insurance_uploaded boolean DEFAULT false, vehicle_docs_uploaded boolean DEFAULT false, identity_verified boolean DEFAULT false, approved boolean DEFAULT false);
CREATE TABLE public.driver_waitlist (id uuid DEFAULT gen_random_uuid() NOT NULL, city text, driver_email text, application_date timestamp with time zone DEFAULT now(), status text DEFAULT 'waiting'::text);
CREATE TABLE public.driver_wallet (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, balance numeric DEFAULT 0, pending_balance numeric DEFAULT 0, total_earned numeric DEFAULT 0, currency text DEFAULT 'NOK'::text, updated_at timestamp with time zone DEFAULT now());
CREATE TABLE public.driver_wallet_transactions (id uuid DEFAULT gen_random_uuid() NOT NULL, wallet_id uuid, transaction_type text, amount numeric, reference_id text, description text, created_at timestamp with time zone DEFAULT now(), driver_id uuid, type text, booking_id uuid);
CREATE TABLE public.driver_wallets (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, balance numeric DEFAULT 0, created_at timestamp without time zone DEFAULT now(), pending numeric DEFAULT 0, total_earned numeric DEFAULT 0, total_withdrawn numeric DEFAULT 0, pending_payout numeric DEFAULT 0);
CREATE TABLE public.drivers (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid, status text DEFAULT 'pending'::text, subscription_plan text DEFAULT 'Free'::text, subscription_active boolean DEFAULT false, subscription_start_date timestamp with time zone, rating numeric DEFAULT 5.0, trust_score numeric DEFAULT 50, completed_deliveries integer DEFAULT 0, acceptance_rate numeric DEFAULT 100, cancellation_rate numeric DEFAULT 0, tier text DEFAULT 'Silver Star'::text, city text, zone text, online boolean DEFAULT false, created_at timestamp with time zone DEFAULT now(), default_plan_id uuid);
CREATE TABLE public.escrow_payments (id uuid DEFAULT gen_random_uuid() NOT NULL, booking_id uuid, driver_id uuid, amount numeric, status text DEFAULT 'held'::text, created_at timestamp without time zone DEFAULT now(), commission_amount numeric, driver_earning numeric, refund_amount numeric DEFAULT 0, original_amount numeric(10,2), adjusted_amount numeric(10,2), adjustment_required boolean DEFAULT false, adjustment_approved boolean DEFAULT false, released_at timestamp with time zone);
CREATE TABLE public.fraud_flags (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid, flag_type text, description text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.incident_reports (id uuid DEFAULT gen_random_uuid() NOT NULL, booking_id uuid, reported_by uuid, incident_type text, description text, evidence_url text, status text DEFAULT 'open'::text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.loyalty_points (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid, points integer DEFAULT 0, earned_from_booking uuid, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.notifications (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL, body text, link_page text, link_id uuid, read_at timestamp with time zone, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.payments (id uuid DEFAULT gen_random_uuid() NOT NULL, booking_id uuid, customer_id uuid, amount numeric DEFAULT 0, currency text DEFAULT 'NOK'::text, payment_method text, payment_status text DEFAULT 'pending'::text, transaction_id text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.payout_requests (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, amount numeric NOT NULL, status text DEFAULT 'pending'::text, admin_note text, processed_at timestamp with time zone, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.platform_config (config_key text NOT NULL, config_value text, updated_at timestamp without time zone DEFAULT now());
CREATE TABLE public.platform_features (id uuid DEFAULT gen_random_uuid() NOT NULL, feature_name text, enabled boolean DEFAULT true, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.profiles (id uuid NOT NULL, user_id uuid, first_name text, last_name text, email text, phone text, role text, avatar_url text, language text, country text, referral_code text, created_at timestamp with time zone, updated_at timestamp with time zone);
CREATE TABLE public.referrals (id uuid DEFAULT gen_random_uuid() NOT NULL, referrer_user_id uuid, referred_user_id uuid, referral_code text, reward_status text DEFAULT 'pending'::text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.reviews (id uuid DEFAULT gen_random_uuid() NOT NULL, booking_id uuid, customer_id uuid, driver_id uuid, rating integer, professionalism integer, vehicle_condition integer, punctuality integer, comment text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.service_cities (id uuid DEFAULT gen_random_uuid() NOT NULL, city_name text, country text DEFAULT 'NO'::text, max_drivers integer DEFAULT 100, enabled boolean DEFAULT true, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.service_zones (id uuid DEFAULT gen_random_uuid() NOT NULL, city_id uuid, zone_name text, city text, driver_limit integer DEFAULT 50);
CREATE TABLE public.subscription_payments (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, subscription_id uuid, amount numeric, payment_method text, payment_status text DEFAULT 'pending'::text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.subscription_plans (id uuid DEFAULT gen_random_uuid() NOT NULL, name text NOT NULL, price numeric DEFAULT 0, billing_period text DEFAULT 'monthly'::text, job_visibility text DEFAULT 'all'::text, base_commission jsonb DEFAULT '{}'::jsonb, dispatch_priority integer DEFAULT 1, features jsonb DEFAULT '[]'::jsonb, created_at timestamp with time zone DEFAULT now(), max_job_value integer, dispatch_weight integer DEFAULT 1);
CREATE TABLE public.subscriptions (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, plan text, status text DEFAULT 'active'::text, started_at timestamp without time zone DEFAULT now());
CREATE TABLE public.support_tickets (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid, ticket_status text DEFAULT 'open'::text, subject text, description text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.vehicle_photos (id uuid DEFAULT gen_random_uuid() NOT NULL, vehicle_id uuid, photo_url text, uploaded_at timestamp with time zone DEFAULT now());
CREATE TABLE public.vehicles (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, vehicle_type text, vehicle_model text, vehicle_year integer, van_size text, load_capacity numeric, license_plate text, verification_status text DEFAULT 'pending'::text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.wallet_transactions (id uuid DEFAULT gen_random_uuid() NOT NULL, driver_id uuid, booking_id uuid, type text, amount numeric, status text DEFAULT 'completed'::text, created_at timestamp without time zone DEFAULT now());

-- ── Keys, uniques, checks ──────────────────────────────────────────────────
ALTER TABLE public.admin_accounts ADD CONSTRAINT admin_accounts_pkey PRIMARY KEY (id);
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.booking_items ADD CONSTRAINT booking_items_pkey PRIMARY KEY (id);
ALTER TABLE public.booking_metrics ADD CONSTRAINT booking_metrics_pkey PRIMARY KEY (id);
ALTER TABLE public.booking_stops ADD CONSTRAINT booking_stops_pkey PRIMARY KEY (id);
ALTER TABLE public.booking_updates ADD CONSTRAINT booking_updates_pkey PRIMARY KEY (id);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'escrow'::text, 'released'::text, 'refunded'::text])));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'driver_assigned'::text, 'pickup_arrived'::text, 'loading'::text, 'in_transit'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);
ALTER TABLE public.chat_moderation_logs ADD CONSTRAINT chat_moderation_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.chat_rooms ADD CONSTRAINT chat_rooms_pkey PRIMARY KEY (id);
ALTER TABLE public.commission_ledger ADD CONSTRAINT commission_ledger_pkey PRIMARY KEY (id);
ALTER TABLE public.corporate_accounts ADD CONSTRAINT corporate_accounts_api_key_key UNIQUE (api_key);
ALTER TABLE public.corporate_accounts ADD CONSTRAINT corporate_accounts_pkey PRIMARY KEY (id);
ALTER TABLE public.corporate_orders ADD CONSTRAINT corporate_orders_pkey PRIMARY KEY (id);
ALTER TABLE public.delivery_proof ADD CONSTRAINT delivery_proof_pkey PRIMARY KEY (id);
ALTER TABLE public.demand_forecasts ADD CONSTRAINT demand_forecasts_pkey PRIMARY KEY (id);
ALTER TABLE public.dispatch_logs ADD CONSTRAINT dispatch_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_applications ADD CONSTRAINT driver_applications_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_document_type_check CHECK ((document_type = ANY (ARRAY['driver_license'::text, 'vehicle_registration'::text, 'insurance'::text, 'id_passport'::text, 'profile_photo'::text])));
ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_verification_status_check CHECK ((verification_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE public.driver_locations ADD CONSTRAINT driver_locations_pkey PRIMARY KEY (driver_id);
ALTER TABLE public.driver_metrics ADD CONSTRAINT driver_metrics_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_payouts ADD CONSTRAINT driver_payouts_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_profiles ADD CONSTRAINT driver_profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_service_cities ADD CONSTRAINT driver_service_cities_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_service_cities ADD CONSTRAINT unique_driver_city UNIQUE (driver_id, city);
ALTER TABLE public.driver_subscriptions ADD CONSTRAINT driver_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_subscriptions ADD CONSTRAINT driver_subscriptions_subscription_status_check CHECK ((subscription_status = ANY (ARRAY['active'::text, 'cancelled'::text, 'past_due'::text, 'trialing'::text])));
ALTER TABLE public.driver_transactions ADD CONSTRAINT driver_transactions_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_verification ADD CONSTRAINT driver_verification_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_waitlist ADD CONSTRAINT driver_waitlist_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_wallet_transactions ADD CONSTRAINT driver_wallet_transactions_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_wallet ADD CONSTRAINT driver_wallet_driver_id_key UNIQUE (driver_id);
ALTER TABLE public.driver_wallet ADD CONSTRAINT driver_wallet_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_wallets ADD CONSTRAINT driver_wallets_driver_id_key UNIQUE (driver_id);
ALTER TABLE public.driver_wallets ADD CONSTRAINT driver_wallets_pkey PRIMARY KEY (id);
ALTER TABLE public.drivers ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);
ALTER TABLE public.drivers ADD CONSTRAINT drivers_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'under_review'::text, 'approved'::text, 'rejected'::text, 'suspended'::text])));
ALTER TABLE public.drivers ADD CONSTRAINT drivers_tier_check CHECK ((tier = ANY (ARRAY['Silver Star'::text, 'Golden Star'::text])));
ALTER TABLE public.escrow_payments ADD CONSTRAINT escrow_payments_pkey PRIMARY KEY (id);
ALTER TABLE public.fraud_flags ADD CONSTRAINT fraud_flags_pkey PRIMARY KEY (id);
ALTER TABLE public.incident_reports ADD CONSTRAINT incident_reports_pkey PRIMARY KEY (id);
ALTER TABLE public.loyalty_points ADD CONSTRAINT loyalty_points_pkey PRIMARY KEY (id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.payments ADD CONSTRAINT payments_pkey PRIMARY KEY (id);
ALTER TABLE public.payout_requests ADD CONSTRAINT payout_requests_amount_check CHECK ((amount > (0)::numeric));
ALTER TABLE public.payout_requests ADD CONSTRAINT payout_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.payout_requests ADD CONSTRAINT payout_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'paid'::text])));
ALTER TABLE public.platform_config ADD CONSTRAINT platform_config_pkey PRIMARY KEY (config_key);
ALTER TABLE public.platform_features ADD CONSTRAINT platform_features_feature_name_key UNIQUE (feature_name);
ALTER TABLE public.platform_features ADD CONSTRAINT platform_features_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.referrals ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);
ALTER TABLE public.reviews ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);
ALTER TABLE public.service_cities ADD CONSTRAINT service_cities_pkey PRIMARY KEY (id);
ALTER TABLE public.service_zones ADD CONSTRAINT service_zones_pkey PRIMARY KEY (id);
ALTER TABLE public.subscription_payments ADD CONSTRAINT subscription_payments_pkey PRIMARY KEY (id);
ALTER TABLE public.subscription_plans ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);
ALTER TABLE public.vehicle_photos ADD CONSTRAINT vehicle_photos_pkey PRIMARY KEY (id);
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_vehicle_type_check CHECK (((vehicle_type = ANY (ARRAY['small_van'::text, 'medium_van'::text, 'large_van'::text, 'luton_van'::text])) OR (vehicle_type IS NULL)));
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);

-- ── Foreign keys ───────────────────────────────────────────────────────────
ALTER TABLE public.booking_items ADD CONSTRAINT booking_items_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
ALTER TABLE public.booking_stops ADD CONSTRAINT booking_stops_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
ALTER TABLE public.booking_updates ADD CONSTRAINT booking_updates_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_chat_room_id_fkey FOREIGN KEY (chat_room_id) REFERENCES chat_rooms(id);
ALTER TABLE public.chat_moderation_logs ADD CONSTRAINT chat_moderation_logs_message_id_fkey FOREIGN KEY (message_id) REFERENCES chat_messages(id);
ALTER TABLE public.chat_rooms ADD CONSTRAINT chat_rooms_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
ALTER TABLE public.chat_rooms ADD CONSTRAINT chat_rooms_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id);
ALTER TABLE public.commission_ledger ADD CONSTRAINT commission_ledger_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
ALTER TABLE public.commission_ledger ADD CONSTRAINT commission_ledger_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id);
ALTER TABLE public.corporate_orders ADD CONSTRAINT corporate_orders_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
ALTER TABLE public.corporate_orders ADD CONSTRAINT corporate_orders_corporate_account_id_fkey FOREIGN KEY (corporate_account_id) REFERENCES corporate_accounts(id);
ALTER TABLE public.delivery_proof ADD CONSTRAINT delivery_proof_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
ALTER TABLE public.dispatch_logs ADD CONSTRAINT dispatch_logs_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
ALTER TABLE public.dispatch_logs ADD CONSTRAINT dispatch_logs_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id);
ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
ALTER TABLE public.driver_locations ADD CONSTRAINT driver_locations_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES driver_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.driver_metrics ADD CONSTRAINT driver_metrics_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id);
ALTER TABLE public.driver_payouts ADD CONSTRAINT driver_payouts_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id);
ALTER TABLE public.driver_subscriptions ADD CONSTRAINT driver_subscriptions_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
ALTER TABLE public.driver_subscriptions ADD CONSTRAINT driver_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES subscription_plans(id);
ALTER TABLE public.driver_verification ADD CONSTRAINT driver_verification_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id);
ALTER TABLE public.driver_wallet_transactions ADD CONSTRAINT driver_wallet_transactions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES driver_wallet(id);
ALTER TABLE public.driver_wallet ADD CONSTRAINT driver_wallet_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
ALTER TABLE public.incident_reports ADD CONSTRAINT incident_reports_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.payments ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
ALTER TABLE public.payout_requests ADD CONSTRAINT payout_requests_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES driver_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.referrals ADD CONSTRAINT referrals_referred_user_id_fkey FOREIGN KEY (referred_user_id) REFERENCES referrals(id);
ALTER TABLE public.reviews ADD CONSTRAINT reviews_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
ALTER TABLE public.reviews ADD CONSTRAINT reviews_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id);
ALTER TABLE public.service_zones ADD CONSTRAINT service_zones_city_id_fkey FOREIGN KEY (city_id) REFERENCES service_cities(id);
ALTER TABLE public.subscription_payments ADD CONSTRAINT subscription_payments_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id);
ALTER TABLE public.subscription_payments ADD CONSTRAINT subscription_payments_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES driver_subscriptions(id);
ALTER TABLE public.subscriptions ADD CONSTRAINT fk_driver FOREIGN KEY (driver_id) REFERENCES driver_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.vehicle_photos ADD CONSTRAINT vehicle_photos_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(id);
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES driver_profiles(id);

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX notifications_user_unread_idx ON public.notifications USING btree (user_id, read_at);
CREATE INDEX notifications_user_created_idx ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX idx_subscriptions_driver_id ON public.subscriptions USING btree (driver_id);

-- ── Row level security (only these six have it on) ────────────────────────
ALTER TABLE public.admin_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ── Functions ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_primary_service_city()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.driver_service_cities (driver_id, city)
  VALUES (NEW.user_id, COALESCE(NEW.city, 'Oslo'))
  ON CONFLICT (driver_id, city) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_pending_plan_changes()
 RETURNS void LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.driver_subscriptions
  SET plan = pending_plan, pending_plan = NULL
  WHERE pending_plan IS NOT NULL AND end_date < NOW();
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_default_city()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  UPDATE public.driver_profiles
  SET city = COALESCE(NEW.city, 'Oslo')
  WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_zone_from_city()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE zone_value text;
BEGIN
  SELECT zone_name INTO zone_value
  FROM public.service_zones
  WHERE city = NEW.city
  LIMIT 1;

  UPDATE public.driver_profiles SET zone = zone_value WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_assign_driver_city()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.driver_service_cities (driver_id, city)
  VALUES (NEW.user_id, NEW.city)
  ON CONFLICT (driver_id, city) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_actual_hours_booking()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.start_time IS NOT NULL AND NEW.end_time IS NOT NULL THEN
    NEW.actual_hours := EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 3600;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.capture_extra_escrow_after_approval()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.adjustment_required = TRUE AND NEW.adjustment_approved = TRUE THEN
    UPDATE public.escrow_payments
    SET amount = NEW.adjusted_amount
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.change_driver_subscription(p_driver_id uuid, p_new_plan text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_plan_id  UUID;
  v_billing  TEXT;
  v_end_date TIMESTAMPTZ;
BEGIN
  SELECT id, billing_period INTO v_plan_id, v_billing
  FROM public.subscription_plans
  WHERE LOWER(name) = LOWER(p_new_plan)
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Plan "%" not found in subscription_plans', p_new_plan;
  END IF;

  v_end_date := CASE
    WHEN v_billing = 'monthly' THEN NOW() + INTERVAL '1 month'
    WHEN v_billing = 'daily'   THEN NOW() + INTERVAL '1 day'
    ELSE NULL
  END;

  UPDATE public.driver_subscriptions
  SET plan_id             = v_plan_id,
      subscription_status = 'active',
      start_date          = NOW(),
      end_date            = v_end_date,
      pending_plan        = NULL
  WHERE driver_id = p_driver_id AND subscription_status = 'active';

  IF NOT FOUND THEN
    INSERT INTO public.driver_subscriptions
      (driver_id, plan_id, subscription_status, start_date, end_date, payment_method)
    VALUES
      (p_driver_id, v_plan_id, 'active', NOW(), v_end_date, 'stripe');
  END IF;

  UPDATE public.driver_profiles
  SET subscription_plan = p_new_plan
  WHERE user_id = p_driver_id;

  INSERT INTO public.audit_logs (user_id, action_type, resource_type, new_value)
  VALUES (
    p_driver_id,
    'subscription_change',
    'driver_subscriptions',
    jsonb_build_object('plan', p_new_plan, 'plan_id', v_plan_id, 'changed_at', NOW())
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_driver_profile()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.driver_profiles (
    user_id, full_name, city, status,
    subscription_plan, subscription_active,
    rating, trust_score, completed_deliveries,
    acceptance_rate, cancellation_rate, tier, online
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Driver'),
    'Oslo', 'pending',
    'Free', false,
    5.0, 50, 0, 100, 0, 'Silver Star', false
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_driver_subscription()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.subscriptions (driver_id, plan)
  VALUES (NEW.user_id, 'Free');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_driver_verification_checklist()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.driver_verification (
    driver_id, license_uploaded, insurance_uploaded,
    vehicle_docs_uploaded, identity_verified, approved
  ) VALUES (NEW.user_id, false, false, false, false, false);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_driver_wallet()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.driver_wallets (driver_id, balance, total_earned, pending_payout)
  VALUES (NEW.user_id, 0, 0, 0);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_vehicle_placeholder()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.vehicles (driver_id, verification_status, created_at)
  VALUES (NEW.user_id, 'pending', NOW());
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decrement_driver_wallet(p_driver_id uuid, p_amount numeric)
 RETURNS void LANGUAGE plpgsql
AS $function$
DECLARE current_balance numeric;
BEGIN
  SELECT balance INTO current_balance
  FROM public.driver_wallets WHERE driver_id = p_driver_id;

  IF current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  UPDATE public.driver_wallets
  SET balance         = balance - p_amount,
      total_withdrawn = total_withdrawn + p_amount
  WHERE driver_id = p_driver_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_overtime_adjustment()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.final_price > NEW.original_price THEN
    UPDATE public.escrow_payments
    SET adjusted_amount     = NEW.final_price,
        adjustment_required = TRUE
    WHERE booking_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_assign_best_driver(p_booking_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_top     RECORD;
  v_result  jsonb;
BEGIN
  PERFORM public.reclaim_stale_dispatches(5);

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'booking_not_found');
  END IF;

  IF v_booking.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_assigned', 'driver_id', v_booking.driver_id);
  END IF;

  SELECT * INTO v_top FROM public.dispatch_rank_candidates(p_booking_id) ORDER BY score DESC LIMIT 1;

  IF v_top IS NULL THEN
    INSERT INTO public.dispatch_logs (booking_id, driver_id, dispatch_score, notification_sent_at, response)
    VALUES (p_booking_id, NULL, 0, now(), 'no_candidates');
    RETURN jsonb_build_object('success', false, 'reason', 'no_candidates');
  END IF;

  UPDATE public.bookings
     SET driver_id = v_top.driver_id,
         status    = 'driver_assigned'
   WHERE id = p_booking_id
     AND driver_id IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'race_already_assigned');
  END IF;

  INSERT INTO public.dispatch_logs (booking_id, driver_id, dispatch_score, notification_sent_at)
  VALUES (p_booking_id, v_top.driver_id, v_top.score, now());

  INSERT INTO public.notifications (user_id, kind, title, body, link_page, link_id)
  VALUES (
    v_top.driver_user_id, 'dispatch', 'New job available',
    'Pickup at ' || COALESCE(v_booking.pickup_address, 'destination')
      || ' · ' || ROUND(v_top.distance_km, 1)::text || ' km away'
      || ' · ~' || COALESCE(v_booking.price_estimate::text, '?') || ' NOK',
    'driver-portal', p_booking_id
  );

  v_result := jsonb_build_object(
    'success', true, 'driver_id', v_top.driver_id, 'driver_user_id', v_top.driver_user_id,
    'driver_name', v_top.full_name, 'score', v_top.score, 'distance_km', v_top.distance_km,
    'active_jobs', v_top.active_jobs, 'same_city', v_top.same_city
  );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_rank_candidates(p_booking_id uuid)
 RETURNS TABLE(driver_id uuid, driver_user_id uuid, full_name text, distance_km numeric, score numeric, rating numeric, acceptance_rate numeric, cancellation_rate numeric, trust_score numeric, plan_name text, dispatch_priority integer, active_jobs integer, same_city boolean)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH booking AS (
    SELECT b.id, b.customer_id, b.pickup_lat, b.pickup_lng, b.pickup_city, b.van_type
    FROM public.bookings b
    WHERE b.id = p_booking_id
  ),
  candidates AS (
    SELECT
      dp.id AS driver_id, dp.user_id AS driver_user_id, dp.full_name, dp.city AS driver_city,
      dp.rating, dp.acceptance_rate, dp.cancellation_rate, dp.trust_score,
      dp.van_size AS driver_van_size, dp.vehicle_type AS driver_vehicle_type,
      dl.lat AS driver_lat, dl.lng AS driver_lng,
      COALESCE(sp.name, dp.subscription_plan, 'free') AS plan_name,
      COALESCE(sp.dispatch_priority, 1) AS dispatch_priority,
      (SELECT COUNT(*) FROM public.bookings b2
        WHERE b2.driver_id = dp.id
          AND b2.status IN ('driver_assigned','pickup_arrived','loading','in_transit'))::int AS active_jobs
    FROM public.driver_profiles dp
    JOIN LATERAL (
      SELECT dl2.lat, dl2.lng, dl2.updated_at
        FROM public.driver_locations dl2
       WHERE dl2.driver_id = dp.user_id
       ORDER BY dl2.updated_at DESC
       LIMIT 1
    ) dl ON true
    LEFT JOIN public.driver_subscriptions ds
           ON ds.driver_id = dp.user_id
          AND ds.subscription_status = 'active'
    LEFT JOIN public.subscription_plans sp
           ON sp.id = ds.plan_id
    WHERE dp.online = true
      AND dp.status = 'approved'
      AND COALESCE(dp.subscription_active, false) = true
  )
  SELECT
    c.driver_id, c.driver_user_id, c.full_name,
    public.haversine_km(c.driver_lat, c.driver_lng, (SELECT pickup_lat FROM booking), (SELECT pickup_lng FROM booking)) AS distance_km,
    (
        (40 / GREATEST(public.haversine_km(c.driver_lat, c.driver_lng, (SELECT pickup_lat FROM booking), (SELECT pickup_lng FROM booking)), 0.5))
      + (COALESCE(c.rating, 4.5)            * 20)
      + (COALESCE(c.dispatch_priority, 1)   * 15)
      + (COALESCE(c.acceptance_rate, 0.9)   * 10)
      + (COALESCE(c.trust_score, 0.5)       * 10)
      - (COALESCE(c.cancellation_rate, 0)   * 15)
      - (c.active_jobs                      *  5)
      + CASE
          WHEN c.driver_city IS NOT NULL
           AND (SELECT pickup_city FROM booking) IS NOT NULL
           AND LOWER(c.driver_city) = LOWER((SELECT pickup_city FROM booking))
          THEN 8 ELSE 0
        END
    )::numeric AS score,
    c.rating, c.acceptance_rate, c.cancellation_rate, c.trust_score,
    c.plan_name, c.dispatch_priority, c.active_jobs,
    (c.driver_city IS NOT NULL
      AND (SELECT pickup_city FROM booking) IS NOT NULL
      AND LOWER(c.driver_city) = LOWER((SELECT pickup_city FROM booking))) AS same_city
  FROM candidates c
  WHERE
    public.haversine_km(c.driver_lat, c.driver_lng, (SELECT pickup_lat FROM booking), (SELECT pickup_lng FROM booking)) <= 15
    AND (
      (SELECT van_type FROM booking) IS NULL
      OR c.driver_van_size = (SELECT van_type FROM booking)
      OR c.driver_vehicle_type = (SELECT van_type FROM booking)
      OR c.driver_van_size IS NULL
    )
    AND c.driver_user_id IS DISTINCT FROM (SELECT customer_id FROM booking)
  ORDER BY score DESC
  LIMIT 10;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.id) THEN
    INSERT INTO public.profiles (id, user_id, email, first_name, last_name, role, referral_code)
    VALUES (
      gen_random_uuid(), NEW.id, NEW.email,
      NULLIF(meta ->> 'first_name', ''), NULLIF(meta ->> 'last_name',  ''),
      COALESCE(NULLIF(meta ->> 'role', ''), 'customer'),
      'FLYTTGO-' || UPPER(SUBSTRING(NEW.id::text FROM 1 FOR 8))
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.haversine_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
 RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  WITH r AS (SELECT 6371::numeric AS earth_km)
  SELECT
    (2 * r.earth_km * ASIN(SQRT(
        POWER(SIN(RADIANS(lat2 - lat1) / 2), 2)
      + COS(RADIANS(lat1)) * COS(RADIANS(lat2))
        * POWER(SIN(RADIANS(lng2 - lng1) / 2), 2)
    )))::numeric
  FROM r;
$function$;

CREATE OR REPLACE FUNCTION public.increment_driver_wallet(p_driver_id uuid, p_amount numeric)
 RETURNS void LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.driver_wallets (driver_id)
  VALUES (p_driver_id)
  ON CONFLICT (driver_id) DO NOTHING;

  UPDATE public.driver_wallets
  SET balance     = balance + p_amount,
      total_earned = total_earned + p_amount
  WHERE driver_id = p_driver_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.initialize_driver_metrics()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.driver_metrics (
    driver_id, rating, acceptance_rate, cancellation_rate,
    completed_deliveries, trust_score, tier
  ) VALUES (NEW.user_id, 5.0, 100, 0, 0, 50, 'Silver Star');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.admin_accounts WHERE user_id = auth.uid());
$function$;

-- The six realtime_notify_* functions are identical apart from the channel.
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookings','driver_applications','driver_profiles','driver_subscriptions','driver_wallet_transactions','escrow_payments'] LOOP
    EXECUTE format($f$
      CREATE OR REPLACE FUNCTION public.%1$I()
       RETURNS trigger LANGUAGE plpgsql
      AS $b$
      DECLARE payload jsonb; payload_text text;
      BEGIN
        payload := jsonb_build_object(
          'type', TG_OP, 'schema', 'public', 'table', TG_TABLE_NAME,
          'record',     CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN row_to_json(NEW)::jsonb ELSE NULL END,
          'old_record', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN row_to_json(OLD)::jsonb ELSE NULL END,
          'commit_timestamp', now()::text
        );
        payload_text := payload::text;
        IF length(payload_text) > 7500 THEN
          payload := jsonb_build_object(
            'type', TG_OP, 'schema', 'public', 'table', TG_TABLE_NAME,
            'record',     CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN jsonb_build_object('id', NEW.id) ELSE NULL END,
            'old_record', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN jsonb_build_object('id', OLD.id) ELSE NULL END,
            'commit_timestamp', now()::text, 'truncated', true
          );
          payload_text := payload::text;
        END IF;
        BEGIN PERFORM pg_notify(%2$L, payload_text);
        EXCEPTION WHEN OTHERS THEN NULL; END;
        RETURN COALESCE(NEW, OLD);
      END;
      $b$ $f$, 'realtime_notify_' || t, 'realtime:public:' || t);
  END LOOP;
END $do$;

CREATE OR REPLACE FUNCTION public.recalculate_booking_commission()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.final_price IS NOT NULL AND NEW.commission_rate IS NOT NULL THEN
    NEW.commission_amount := NEW.final_price * NEW.commission_rate;
    NEW.driver_earning    := NEW.final_price - NEW.commission_amount;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_booking_price()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
DECLARE
  extra_hours NUMERIC;
  extra_cost  NUMERIC;
BEGIN
  IF NEW.actual_hours > NEW.estimated_hours THEN
    extra_hours    := NEW.actual_hours - NEW.estimated_hours;
    extra_cost     := extra_hours * NEW.hourly_rate;
    NEW.final_price  := NEW.original_price + extra_cost;
    NEW.price_adjusted := TRUE;
  ELSE
    NEW.final_price    := NEW.original_price;
    NEW.price_adjusted := FALSE;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reclaim_stale_dispatches(p_timeout_minutes integer DEFAULT 5)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_reclaimed integer := 0;
  v_cutoff    timestamptz := now() - (p_timeout_minutes || ' minutes')::interval;
BEGIN
  WITH stale AS (
    SELECT b.id
      FROM public.bookings b
      JOIN LATERAL (
        SELECT notification_sent_at
          FROM public.dispatch_logs
         WHERE booking_id = b.id
           AND driver_id IS NOT NULL
         ORDER BY notification_sent_at DESC
         LIMIT 1
      ) last_log ON true
     WHERE b.status = 'driver_assigned'
       AND b.start_time IS NULL
       AND b.driver_id IS NOT NULL
       AND last_log.notification_sent_at < v_cutoff
  ),
  reverted AS (
    UPDATE public.bookings b
       SET driver_id = NULL,
           status    = 'pending'
      FROM stale s
     WHERE b.id = s.id
    RETURNING b.id, b.driver_id
  )
  INSERT INTO public.dispatch_logs (booking_id, driver_id, dispatch_score, notification_sent_at, response)
  SELECT id, driver_id, 0, now(), 'stale_reclaimed' FROM reverted;

  GET DIAGNOSTICS v_reclaimed = ROW_COUNT;
  RETURN v_reclaimed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_booking_escrow_after_confirmation()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.driver_confirmation = TRUE AND NEW.customer_confirmation = TRUE THEN
    UPDATE public.escrow_payments
    SET status      = 'released',
        released_at = NOW()
    WHERE booking_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_driver_wallet_after_release()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'released' THEN
    UPDATE public.driver_wallets
    SET balance = balance + NEW.driver_earning
    WHERE driver_id = NEW.driver_id;

    INSERT INTO public.commission_ledger (booking_id, commission_amount, created_at)
    VALUES (NEW.booking_id, NEW.commission_amount, NOW());
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_dispatch_on_payment_captured()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_captured_states text[] := ARRAY['escrow','paid'];
BEGIN
  IF NEW.driver_id IS NULL
     AND NEW.payment_status = ANY (v_captured_states)
     AND (OLD.payment_status IS NULL OR NOT (OLD.payment_status = ANY (v_captured_states)))
  THEN
    BEGIN
      PERFORM public.dispatch_assign_best_driver(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'dispatch_assign_best_driver failed for %: % %', NEW.id, SQLSTATE, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Triggers ───────────────────────────────────────────────────────────────
CREATE TRIGGER realtime_trigger_bookings AFTER INSERT OR DELETE OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION realtime_notify_bookings();
CREATE TRIGGER trg_dispatch_on_payment_captured AFTER UPDATE OF payment_status ON public.bookings FOR EACH ROW EXECUTE FUNCTION trigger_dispatch_on_payment_captured();
CREATE TRIGGER trigger_calculate_actual_hours_booking BEFORE UPDATE OF end_time ON public.bookings FOR EACH ROW EXECUTE FUNCTION calculate_actual_hours_booking();
CREATE TRIGGER trigger_detect_overtime_adjustment AFTER UPDATE OF final_price ON public.bookings FOR EACH ROW EXECUTE FUNCTION detect_overtime_adjustment();
CREATE TRIGGER trigger_recalculate_booking_commission BEFORE UPDATE OF final_price ON public.bookings FOR EACH ROW EXECUTE FUNCTION recalculate_booking_commission();
CREATE TRIGGER trigger_recalculate_booking_price BEFORE UPDATE OF actual_hours ON public.bookings FOR EACH ROW EXECUTE FUNCTION recalculate_booking_price();
CREATE TRIGGER trigger_release_booking_escrow AFTER UPDATE OF driver_confirmation, customer_confirmation ON public.bookings FOR EACH ROW EXECUTE FUNCTION release_booking_escrow_after_confirmation();
CREATE TRIGGER realtime_trigger_driver_applications AFTER INSERT OR DELETE OR UPDATE ON public.driver_applications FOR EACH ROW EXECUTE FUNCTION realtime_notify_driver_applications();
CREATE TRIGGER auto_assign_city_trigger AFTER INSERT ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION assign_default_city();
CREATE TRIGGER auto_assign_zone_trigger AFTER INSERT ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION assign_zone_from_city();
CREATE TRIGGER driver_metrics_init_trigger AFTER INSERT ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION initialize_driver_metrics();
CREATE TRIGGER insert_primary_service_city_trigger AFTER INSERT ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION add_primary_service_city();
CREATE TRIGGER realtime_trigger_driver_profiles AFTER INSERT OR DELETE OR UPDATE ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION realtime_notify_driver_profiles();
CREATE TRIGGER vehicle_placeholder_trigger AFTER INSERT ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION create_vehicle_placeholder();
CREATE TRIGGER verification_checklist_trigger AFTER INSERT ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION create_driver_verification_checklist();
CREATE TRIGGER realtime_trigger_driver_subscriptions AFTER INSERT OR DELETE OR UPDATE ON public.driver_subscriptions FOR EACH ROW EXECUTE FUNCTION realtime_notify_driver_subscriptions();
CREATE TRIGGER realtime_trigger_driver_wallet_transactions AFTER INSERT OR DELETE OR UPDATE ON public.driver_wallet_transactions FOR EACH ROW EXECUTE FUNCTION realtime_notify_driver_wallet_transactions();
CREATE TRIGGER realtime_trigger_escrow_payments AFTER INSERT OR DELETE OR UPDATE ON public.escrow_payments FOR EACH ROW EXECUTE FUNCTION realtime_notify_escrow_payments();
CREATE TRIGGER trigger_capture_extra_escrow AFTER UPDATE OF adjustment_approved ON public.escrow_payments FOR EACH ROW EXECUTE FUNCTION capture_extra_escrow_after_approval();
CREATE TRIGGER trigger_wallet_settlement_after_release AFTER UPDATE OF status ON public.escrow_payments FOR EACH ROW EXECUTE FUNCTION settle_driver_wallet_after_release();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── Policies ───────────────────────────────────────────────────────────────
CREATE POLICY admin_accounts_self_select ON public.admin_accounts AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY bookings_admin_all ON public.bookings AS PERMISSIVE FOR ALL TO public USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY bookings_customer_insert ON public.bookings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((customer_id = auth.uid()));
CREATE POLICY bookings_customer_select ON public.bookings AS PERMISSIVE FOR SELECT TO authenticated USING ((customer_id = auth.uid()));
CREATE POLICY bookings_customer_update ON public.bookings AS PERMISSIVE FOR UPDATE TO authenticated USING ((customer_id = auth.uid())) WITH CHECK ((customer_id = auth.uid()));
CREATE POLICY driver_applications_admin_all ON public.driver_applications AS PERMISSIVE FOR ALL TO public USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY driver_apps_insert_own ON public.driver_applications AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY driver_apps_select_own ON public.driver_applications AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY driver_apps_update_own ON public.driver_applications AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY drivers_insert_own ON public.drivers AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY drivers_select_own ON public.drivers AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY drivers_update_own ON public.drivers AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY notifications_admin_all ON public.notifications AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY notifications_self_select ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY notifications_self_update ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY profiles_admin_all ON public.profiles AS PERMISSIVE FOR ALL TO public USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY profiles_self_select ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "driver-documents-admin-all" ON storage.objects AS PERMISSIVE FOR ALL TO authenticated USING (((bucket_id = 'driver-documents'::text) AND is_admin())) WITH CHECK (((bucket_id = 'driver-documents'::text) AND is_admin()));
CREATE POLICY "driver-documents-self-delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'driver-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY "driver-documents-self-insert" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'driver-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY "driver-documents-self-select" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'driver-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY "driver-documents-self-update" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'driver-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))) WITH CHECK (((bucket_id = 'driver-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

-- ── Function privileges (as in production) ───────────────────────────────
-- Every public function is executable by anon, authenticated and
-- service_role, except change_driver_subscription (anon revoked by the
-- emergency fix).
DO $do$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', f);
  END LOOP;
END $do$;
REVOKE ALL ON FUNCTION public.change_driver_subscription(uuid, text) FROM PUBLIC, anon;

-- ── Realtime, storage, configuration rows ──────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
INSERT INTO storage.buckets (id, name, public) VALUES ('driver-documents', 'driver-documents', false);
INSERT INTO public.subscription_plans (name, price, billing_period) VALUES
  ('Basic', 0, 'daily'), ('Free', 0, 'none'), ('Pro', 1500, 'monthly'),
  ('Pro Mini', 149, 'daily'), ('Unlimited', 2449, 'monthly');

RESET check_function_bodies;
