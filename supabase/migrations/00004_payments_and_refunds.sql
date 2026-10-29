-- ============================================================================
-- FlyttGo — payment references, provider events and real refunds
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00003.
--
-- 1. A paid booking records who took the money and the provider's
--    reference (Stripe PaymentIntent, Vipps reference) and the amount
--    actually paid, so a refund can be sent back through the provider.
-- 2. payment_events: every provider webhook event processed, once.
-- 3. payment_refunds: a refund is a request to Stripe or Vipps with an
--    idempotency key. The database changes that follow a refund (escrow,
--    driver wallet, booking) are applied only when the provider confirms
--    it, and only once: refund_mark(). Retrying a request reuses the same
--    row and key, so a provider never refunds twice.
--
-- Replaces the dashboard's refund, which only wrote database rows and
-- never returned money. Edge function: supabase/functions/refund-payment.
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. What was paid, and to whom ─────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_provider  text,          -- 'stripe' | 'vipps' (exists in production)
  ADD COLUMN IF NOT EXISTS payment_intent_id text,          -- Stripe PaymentIntent id, or the Vipps reference
  ADD COLUMN IF NOT EXISTS stripe_session_id text,
  ADD COLUMN IF NOT EXISTS paid_amount       numeric,       -- NOK the provider confirmed
  ADD COLUMN IF NOT EXISTS paid_at           timestamptz;

-- The booking guard (00003) already refuses these columns to customers
-- and drivers: they are not on its allow-lists.


-- ── 2. Provider events, each processed once ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_events (
  provider     text        NOT NULL,                   -- 'stripe' | 'vipps'
  event_id     text        NOT NULL,                   -- Stripe event id / Vipps idempotency id
  kind         text,
  booking_id   uuid,
  result       jsonb,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_events_admin_read ON public.payment_events;
CREATE POLICY payment_events_admin_read ON public.payment_events
  FOR SELECT TO authenticated USING (public.is_admin());


-- ── 3. Refunds ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid        NOT NULL REFERENCES public.bookings(id),
  provider           text        NOT NULL CHECK (provider IN ('stripe', 'vipps')),
  provider_reference text        NOT NULL,             -- PaymentIntent id / Vipps reference
  amount             numeric     NOT NULL CHECK (amount > 0),
  currency           text        NOT NULL DEFAULT 'NOK',
  status             text        NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested', 'pending', 'succeeded', 'failed')),
  idempotency_key    text        NOT NULL UNIQUE,
  provider_refund_id text,
  reason             text,
  error              text,
  requested_by       uuid,
  attempts           integer     NOT NULL DEFAULT 0,
  applied_at         timestamptz,                     -- database effects applied (once)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- At most one live refund per booking (the dashboard refunds once, as
-- before); a failed one can be followed by a new request.
CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_one_live_per_booking
  ON public.payment_refunds (booking_id) WHERE status IN ('requested', 'pending', 'succeeded');

ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_refunds_admin_read ON public.payment_refunds;
CREATE POLICY payment_refunds_admin_read ON public.payment_refunds
  FOR SELECT TO authenticated USING (public.is_admin());
-- Writes only through the functions below (service role).

-- Start a refund, or return the one already in progress for the booking
-- (a retry reuses its idempotency key). Refuses a booking with nothing
-- captured, no provider reference, an amount above what was paid, or a
-- refund that already succeeded.
CREATE OR REPLACE FUNCTION public.refund_request_begin(
  p_booking_id uuid, p_amount numeric, p_requested_by uuid, p_reason text)
RETURNS public.payment_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_refund  public.payment_refunds%ROWTYPE;
  v_paid    numeric;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund: booking not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_refund FROM public.payment_refunds
   WHERE booking_id = p_booking_id AND status IN ('requested', 'pending', 'succeeded');
  IF FOUND THEN
    IF v_refund.status = 'succeeded' THEN
      RAISE EXCEPTION 'refund: booking already refunded (%)', v_refund.id USING ERRCODE = '23505';
    END IF;
    UPDATE public.payment_refunds SET attempts = attempts + 1, updated_at = now()
     WHERE id = v_refund.id RETURNING * INTO v_refund;
    RETURN v_refund;                         -- retry: same row, same key
  END IF;

  IF coalesce(v_booking.payment_status, 'pending') NOT IN ('paid', 'escrow', 'released') THEN
    RAISE EXCEPTION 'refund: nothing was captured (payment_status %)', v_booking.payment_status USING ERRCODE = '22023';
  END IF;
  IF v_booking.payment_provider NOT IN ('stripe', 'vipps') OR v_booking.payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'refund: booking has no provider payment reference; refund it in the provider''s dashboard and record it there'
      USING ERRCODE = '22023';
  END IF;
  v_paid := coalesce(v_booking.paid_amount, v_booking.price_estimate);
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_paid THEN
    RAISE EXCEPTION 'refund: amount must be between 0 and the % NOK paid', v_paid USING ERRCODE = '22023';
  END IF;

  v_refund.id := gen_random_uuid();
  INSERT INTO public.payment_refunds (id, booking_id, provider, provider_reference, amount,
                                      idempotency_key, reason, requested_by, attempts)
  VALUES (v_refund.id, p_booking_id, v_booking.payment_provider, v_booking.payment_intent_id,
          round(p_amount), 'flyttgo-refund-' || v_refund.id, p_reason, p_requested_by, 1)
  RETURNING * INTO v_refund;
  RETURN v_refund;
END;
$$;

-- Record what the provider said. On the first 'succeeded' the database
-- follows the money, once:
--   * escrow → refunded, with the amount;
--   * if the escrow had already paid the driver, the driver's wallet gives
--     back up to what it received (it may go below zero: the provider has
--     already returned the money to the customer);
--   * a full refund marks the booking refunded.
-- Later calls (webhook after the synchronous answer, retries) change
-- nothing. A refund never goes back from succeeded.
CREATE OR REPLACE FUNCTION public.refund_mark(
  p_refund_id uuid, p_status text, p_provider_refund_id text, p_error text)
RETURNS public.payment_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_refund  public.payment_refunds%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_escrow  public.escrow_payments%ROWTYPE;
  v_back    numeric;
BEGIN
  IF p_status NOT IN ('requested', 'pending', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'refund_mark: unknown status %', p_status;
  END IF;
  SELECT * INTO v_refund FROM public.payment_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_mark: refund % not found', p_refund_id; END IF;

  IF v_refund.status = 'succeeded' THEN
    RETURN v_refund;                         -- final; nothing changes again
  END IF;

  UPDATE public.payment_refunds
     SET status             = p_status,
         provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
         error              = CASE WHEN p_status = 'failed' THEN p_error ELSE NULL END,
         updated_at         = now()
   WHERE id = p_refund_id
  RETURNING * INTO v_refund;

  IF p_status = 'succeeded' AND v_refund.applied_at IS NULL THEN
    SELECT * INTO v_booking FROM public.bookings WHERE id = v_refund.booking_id FOR UPDATE;
    SELECT * INTO v_escrow FROM public.escrow_payments WHERE booking_id = v_refund.booking_id FOR UPDATE;

    IF FOUND AND v_escrow.status = 'released' AND v_escrow.driver_earning IS NOT NULL
       AND v_booking.driver_id IS NOT NULL THEN
      v_back := least(v_refund.amount, v_escrow.driver_earning);
      UPDATE public.driver_wallets
         SET balance = coalesce(balance, 0) - v_back
       WHERE driver_id = v_booking.driver_id;
      INSERT INTO public.driver_wallet_transactions (driver_id, booking_id, type, amount, description)
      VALUES (v_booking.driver_id, v_refund.booking_id, 'refund_reversal', v_back,
              'Refund ' || v_refund.id || ' via ' || v_refund.provider);
    END IF;

    -- refund_amount and status only; escrow guard (00003) lets this through
    -- because this function runs as a privileged session.
    UPDATE public.escrow_payments
       SET status = 'refunded', refund_amount = v_refund.amount
     WHERE booking_id = v_refund.booking_id;

    IF v_refund.amount >= coalesce(v_booking.paid_amount, v_booking.price_estimate) THEN
      UPDATE public.bookings SET payment_status = 'refunded' WHERE id = v_refund.booking_id;
    END IF;

    UPDATE public.payment_refunds SET applied_at = now() WHERE id = p_refund_id RETURNING * INTO v_refund;
  END IF;
  RETURN v_refund;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_request_begin(uuid, numeric, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_mark(uuid, text, text, text)            FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_request_begin(uuid, numeric, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_mark(uuid, text, text, text)            TO service_role;

-- ============================================================================
-- DONE
-- ============================================================================
