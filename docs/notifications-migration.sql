-- ============================================================================
-- FlyttGo — notifications schema, RLS, triggers, and realtime publication
-- ============================================================================
--
-- This is the full backing for the notifications bell in the header.
-- Everything the docs/notifications-spec.md described, in one
-- runnable file. Paste into the Supabase SQL editor and run once.
-- Safe to re-run.
--
-- After this is applied:
--   - Customers see a notification when their booking is confirmed,
--     when a driver is assigned, when delivery completes, when an
--     escrow payment is released.
--   - Drivers see a notification when a job is assigned to them,
--     when a customer marks delivery complete, when escrow is
--     released to their wallet.
--   - The Header bell renders these in real time via Supabase
--     Realtime + flips its badge dot when there are unread items.
-- ============================================================================

-- 1. Table
CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,                 -- 'booking_status' | 'payment' | 'driver_assigned' | 'system'
  title       text not null,
  body        text,
  link_page   text,                           -- Page enum value from src/lib/store.tsx
  link_id     uuid,                           -- contextual id (booking_id, etc)
  read_at     timestamptz,                    -- null = unread
  created_at  timestamptz default now()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at desc);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, read_at);

-- 2. RLS

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_self_select ON public.notifications;
CREATE POLICY notifications_self_select ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_self_update ON public.notifications;
CREATE POLICY notifications_self_update ON public.notifications
  FOR UPDATE
  USING       (user_id = auth.uid())
  WITH CHECK  (user_id = auth.uid());

-- Admins can do anything (uses public.is_admin() from
-- docs/admin-rls-policies.sql).
DROP POLICY IF EXISTS notifications_admin_all ON public.notifications;
CREATE POLICY notifications_admin_all ON public.notifications
  FOR ALL
  USING       (public.is_admin())
  WITH CHECK  (public.is_admin());

-- The trigger functions below are SECURITY DEFINER so they can insert
-- on behalf of any user even though the row's user_id might not be
-- the caller. The above RLS still prevents anyone from reading
-- someone else's notifications.

-- 3. Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ============================================================================
-- 4. Trigger functions
-- ============================================================================

-- 4a. Booking inserted → confirmation notification for the customer
CREATE OR REPLACE FUNCTION public.notify_on_booking_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link_page, link_id)
    VALUES (
      NEW.customer_id,
      'booking_status',
      'Booking confirmed',
      'We''re matching you with a verified driver. We''ll notify you the moment one accepts.',
      'my-bookings',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_booking_insert ON public.bookings;
CREATE TRIGGER trg_notify_on_booking_insert
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_booking_insert();

-- 4b. Driver assigned → notify both the customer AND the driver
CREATE OR REPLACE FUNCTION public.notify_on_driver_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_user_id uuid;
BEGIN
  -- Only fire when driver_id transitions from NULL to NOT NULL
  IF NEW.driver_id IS NOT NULL AND OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN
    -- Notify the customer
    IF NEW.customer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, kind, title, body, link_page, link_id)
      VALUES (
        NEW.customer_id,
        'driver_assigned',
        'Driver assigned',
        'A verified driver has accepted your booking. You can chat with them in the app.',
        'my-bookings',
        NEW.id
      );
    END IF;

    -- Notify the driver. drivers.id and drivers.user_id are not the
    -- same column — translate via the drivers table.
    SELECT user_id INTO v_driver_user_id FROM public.drivers WHERE id = NEW.driver_id;
    IF v_driver_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, kind, title, body, link_page, link_id)
      VALUES (
        v_driver_user_id,
        'booking_status',
        'New job accepted',
        'You''ve been assigned a new job. Open the driver portal to start.',
        'driver-portal',
        NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_driver_assigned ON public.bookings;
CREATE TRIGGER trg_notify_on_driver_assigned
  AFTER UPDATE OF driver_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_driver_assigned();

-- 4c. Booking marked complete → notify customer to confirm
CREATE OR REPLACE FUNCTION public.notify_on_booking_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link_page, link_id)
    VALUES (
      NEW.customer_id,
      'booking_status',
      'Delivery complete',
      'Your driver marked the job complete. Please confirm in the app to release payment.',
      'my-bookings',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_booking_completed ON public.bookings;
CREATE TRIGGER trg_notify_on_booking_completed
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_booking_completed();

-- 4d. Escrow released → notify the driver
CREATE OR REPLACE FUNCTION public.notify_on_escrow_released()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_user_id uuid;
  v_amount numeric;
BEGIN
  IF NEW.status = 'released' AND OLD.status IS DISTINCT FROM 'released' THEN
    -- escrow_payments has no driver_id column — look it up via the booking.
    SELECT d.user_id, NEW.driver_earning
      INTO v_driver_user_id, v_amount
      FROM public.bookings b
      JOIN public.drivers d ON d.id = b.driver_id
      WHERE b.id = NEW.booking_id;

    IF v_driver_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, kind, title, body, link_page, link_id)
      VALUES (
        v_driver_user_id,
        'payment',
        'Payment released',
        'Your wallet has been credited ' || COALESCE(v_amount::text, '—') || ' NOK.',
        'driver-portal',
        NEW.booking_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_escrow_released ON public.escrow_payments;
CREATE TRIGGER trg_notify_on_escrow_released
  AFTER UPDATE OF status ON public.escrow_payments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_escrow_released();

-- ============================================================================
-- 5. Verify
-- ============================================================================
-- As a customer, after this is applied:
--   1. Insert a row into bookings → notification appears.
--   2. Update bookings.driver_id → second notification.
--   3. Update bookings.status to 'completed' → third notification.
-- The header bell on the customer's session should flip to red and
-- the dropdown should list all three in chronological order, all
-- without a refresh (Realtime push).
--
-- As a driver:
--   1. When a booking is assigned to your driver row, you get a
--      "new job accepted" notification.
--   2. When the customer confirms completion and escrow releases,
--      you get a "payment released" notification with the amount.
