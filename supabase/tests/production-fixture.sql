-- ============================================================================
-- Production-only database objects that 00002 must work with, copied
-- from the live project "FlyttGo Norway" (qzclatvpzicwhewzdiwf) on
-- 2026-10-29 (pg_get_functiondef). They are NOT in 00001. Loaded between
-- 00001 and 00002 for the second test run so the migration is tested
-- against production's behaviour, not only the repository's.
-- ============================================================================

ALTER TABLE public.escrow_payments ADD COLUMN IF NOT EXISTS driver_id uuid;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid,
  action_type   text,
  resource_type text,
  resource_id   text,
  ip_address    text,
  new_value     jsonb,
  log_timestamp timestamptz DEFAULT now()
);

-- Production has no plan column on driver_subscriptions; plans are
-- plan_id → subscription_plans (rows as in production).
INSERT INTO public.subscription_plans (name, price, billing_period) VALUES
  ('Free', 0, 'none'), ('Basic', 0, 'daily'), ('Pro Mini', 149, 'daily'),
  ('Pro', 1500, 'monthly'), ('Unlimited', 2449, 'monthly');

CREATE OR REPLACE FUNCTION public.calculate_actual_hours_booking()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.start_time IS NOT NULL AND NEW.end_time IS NOT NULL THEN
    NEW.actual_hours := EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 3600;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_booking_commission()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.final_price IS NOT NULL AND NEW.commission_rate IS NOT NULL THEN
    NEW.commission_amount := NEW.final_price * NEW.commission_rate;
    NEW.driver_earning    := NEW.final_price - NEW.commission_amount;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_booking_price()
 RETURNS trigger LANGUAGE plpgsql AS $function$
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

CREATE OR REPLACE FUNCTION public.release_booking_escrow_after_confirmation()
 RETURNS trigger LANGUAGE plpgsql AS $function$
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

CREATE OR REPLACE FUNCTION public.detect_overtime_adjustment()
 RETURNS trigger LANGUAGE plpgsql AS $function$
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

CREATE OR REPLACE FUNCTION public.capture_extra_escrow_after_approval()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.adjustment_required = TRUE AND NEW.adjustment_approved = TRUE THEN
    UPDATE public.escrow_payments
    SET amount = NEW.adjusted_amount
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_driver_wallet_after_release()
 RETURNS trigger LANGUAGE plpgsql AS $function$
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

CREATE OR REPLACE FUNCTION public.change_driver_subscription(p_driver_id uuid, p_new_plan text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$
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
GRANT EXECUTE ON FUNCTION public.change_driver_subscription(uuid, text) TO anon, authenticated;

CREATE TRIGGER trigger_calculate_actual_hours_booking BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.calculate_actual_hours_booking();
CREATE TRIGGER trigger_recalculate_booking_commission BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.recalculate_booking_commission();
CREATE TRIGGER trigger_recalculate_booking_price BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.recalculate_booking_price();
CREATE TRIGGER trigger_detect_overtime_adjustment AFTER UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.detect_overtime_adjustment();
CREATE TRIGGER trigger_release_booking_escrow AFTER UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.release_booking_escrow_after_confirmation();
CREATE TRIGGER trigger_capture_extra_escrow AFTER UPDATE ON public.escrow_payments
  FOR EACH ROW EXECUTE FUNCTION public.capture_extra_escrow_after_approval();
CREATE TRIGGER trigger_wallet_settlement_after_release AFTER UPDATE ON public.escrow_payments
  FOR EACH ROW EXECUTE FUNCTION public.settle_driver_wallet_after_release();

-- Production-only tables with no RLS (one of each kind is enough here).
CREATE TABLE IF NOT EXISTS public.corporate_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_name text, contact_email text,
  billing_address text, api_key text, created_at timestamptz DEFAULT now()
);
INSERT INTO public.corporate_accounts (company_name, api_key) VALUES ('Test AS', 'secret-key');
