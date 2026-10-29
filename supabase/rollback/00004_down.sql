-- ============================================================================
-- Roll back 00004_payments_and_refunds.sql (production only)
-- ============================================================================
-- Run the rollbacks newest first: 00004, 00003, 00002 (docs/SECURITY_P0.md
-- §5 has the procedure). Tested: after all three, the schema matches the
-- production fingerprint again (supabase/tests/run.sh, variant rollback).
--
-- DATA LOSS: drops payment_refunds and payment_events (export them first
-- if any refund was made: they are the record of money returned) and
-- the paid_amount / paid_at columns on bookings.
-- ============================================================================

DROP FUNCTION IF EXISTS public.refund_mark(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.refund_request_begin(uuid, numeric, uuid, text);
DROP TABLE IF EXISTS public.payment_refunds;
DROP TABLE IF EXISTS public.payment_events;

-- payment_provider, payment_intent_id and stripe_session_id existed in
-- production before 00004 and stay.
ALTER TABLE public.bookings
  DROP COLUMN IF EXISTS paid_amount,
  DROP COLUMN IF EXISTS paid_at;
