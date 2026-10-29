-- ============================================================================
-- Roll back 00017_spending_limits.sql
-- ============================================================================
-- Run first (before the rollbacks of earlier migrations). Tested by run.sh:
-- afterwards the schema is exactly as before 00017.
--
-- DATA LOSS — READ FIRST. Drops the members' spending limits, the
-- companies' approval rules, the approval requests and their log. Export
-- them to each company first. Limit and rule changes stay in
-- organization_events (00005).
--
-- Bookings still waiting for approval are cancelled first (by the
-- platform, with the reason), as a refused request would be: without the
-- hold they would become payable without anyone's approval. They were
-- never paid or invoiced, so there is no fee and nothing to refund. The
-- people who booked can book again.
-- ============================================================================

DO $$
DECLARE n integer;
BEGIN
  IF to_regclass('public.company_booking_approvals') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS hold_booking_for_approval ON public.bookings;
    PERFORM set_config('flyttgo.trusted', 'on', true);
    UPDATE public.bookings b
       SET status = 'cancelled', cancelled_by = 'platform',
           cancellation_reason = 'Approval of company bookings was withdrawn; please book again'
      FROM public.company_booking_approvals a
     WHERE a.booking_id = b.id AND a.status = 'pending' AND b.status IS DISTINCT FROM 'cancelled';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('flyttgo.trusted', 'off', true);
    IF n > 0 THEN
      RAISE NOTICE '00017 rollback: % booking(s) waiting for approval cancelled without a fee', n;
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.expire_booking_approvals(uuid);
DROP FUNCTION IF EXISTS public.decide_booking_approval(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.hold_booking_for_approval();
DROP FUNCTION IF EXISTS public.company_booking_check(uuid, uuid, numeric);
DROP FUNCTION IF EXISTS public.end_booking_approval(uuid, text, text);
DROP FUNCTION IF EXISTS public.organization_spending(uuid);
DROP FUNCTION IF EXISTS public.set_spending_rules(uuid, numeric, text[], integer);
DROP FUNCTION IF EXISTS public.set_member_spending_limits(uuid, uuid, numeric, numeric);
DROP FUNCTION IF EXISTS public.spending_check_reasons(uuid, uuid, uuid, numeric);
DROP FUNCTION IF EXISTS public.member_month_spend(uuid, uuid, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.booking_approval_event(uuid, uuid, text, jsonb);
DROP TABLE IF EXISTS public.company_booking_approval_events;
DROP FUNCTION IF EXISTS public.guard_booking_approval_events();
DROP TABLE IF EXISTS public.company_booking_approvals;
DROP TABLE IF EXISTS public.organization_spending_rules;
DROP TABLE IF EXISTS public.organization_member_limits;

-- ============================================================================
-- DONE
-- ============================================================================
