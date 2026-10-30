-- ============================================================================
-- Roll back 00019_reservations.sql
-- ============================================================================
-- Run newest first (before 00018_down.sql and the earlier ones). Tested by
-- run.sh: afterwards the schema is exactly as before 00019.
--
-- DATA LOSS — READ FIRST. Drops the companies' tables, service periods,
-- rooms, closures, table reservations, hotel stays and their logs. Export
-- them to each company first. Invoices made from them stay (00011); their
-- source type is outside the earlier list, so that CHECK is restored NOT
-- VALID while such invoices exist. The plans Restaurant and Hotel are
-- removed: a company on one of them must be moved to another plan first
-- (the rollback stops otherwise).
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.organization_white_label') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.organization_white_label
        WHERE plan_code IN ('restaurant', 'hotel') OR requested_plan_code IN ('restaurant', 'hotel')) THEN
    RAISE EXCEPTION 'companies are on the plans this rollback removes: move them to another plan first';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.mark_hotel_stay_reminded(uuid);
DROP FUNCTION IF EXISTS public.hotel_stays_to_remind();
DROP FUNCTION IF EXISTS public.invoice_hotel_stay(uuid);
DROP FUNCTION IF EXISTS public.cancel_hotel_stay(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.mark_hotel_no_show(uuid);
DROP FUNCTION IF EXISTS public.check_out_hotel_stay(uuid);
DROP FUNCTION IF EXISTS public.check_in_hotel_stay(uuid, uuid);
DROP FUNCTION IF EXISTS public.hotel_stay_for(uuid, text[]);
DROP FUNCTION IF EXISTS public.create_hotel_stay(uuid, uuid, uuid, date, date, integer, jsonb, text);
DROP FUNCTION IF EXISTS public.book_hotel_stay(uuid, uuid, date, date, integer, jsonb, text);
DROP FUNCTION IF EXISTS public.hotel_stay_insert(uuid, uuid, uuid, date, date, integer, uuid, jsonb, text, boolean);
DROP FUNCTION IF EXISTS public.available_hotel_rooms(uuid, date, date, integer);
DROP FUNCTION IF EXISTS public.hotel_room_free(uuid, date, date, uuid);
DROP FUNCTION IF EXISTS public.remove_hotel_closure(uuid);
DROP FUNCTION IF EXISTS public.add_hotel_closure(uuid, uuid, date, date, text);
DROP FUNCTION IF EXISTS public.save_hotel_room(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.save_hotel_room_type(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.save_hotel_settings(uuid, jsonb);
DROP FUNCTION IF EXISTS public.hotel_event(uuid, text, jsonb);

DROP FUNCTION IF EXISTS public.mark_restaurant_reservation_reminded(uuid);
DROP FUNCTION IF EXISTS public.restaurant_reservations_to_remind();
DROP FUNCTION IF EXISTS public.invoice_restaurant_no_show(uuid);
DROP FUNCTION IF EXISTS public.cancel_restaurant_reservation(uuid, text);
DROP FUNCTION IF EXISTS public.close_restaurant_reservation(uuid, text);
DROP FUNCTION IF EXISTS public.seat_restaurant_reservation(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.restaurant_reservation_for(uuid, text[]);
DROP FUNCTION IF EXISTS public.create_restaurant_reservation(uuid, timestamptz, integer, jsonb, text, text, uuid[]);
DROP FUNCTION IF EXISTS public.book_restaurant_table(uuid, timestamptz, integer, jsonb, text);
DROP FUNCTION IF EXISTS public.restaurant_reservation_insert(uuid, timestamptz, integer, uuid, jsonb, text, text, uuid[], boolean);
DROP FUNCTION IF EXISTS public.available_restaurant_times(uuid, date, integer);
DROP FUNCTION IF EXISTS public.restaurant_fit(uuid, timestamptz, timestamptz, integer, uuid);
DROP FUNCTION IF EXISTS public.restaurant_tables_taken(uuid[], timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.restaurant_turn_minutes(uuid, integer);
DROP FUNCTION IF EXISTS public.remove_restaurant_closed_date(uuid);
DROP FUNCTION IF EXISTS public.add_restaurant_closed_date(uuid, date, text);
DROP FUNCTION IF EXISTS public.save_restaurant_periods(uuid, jsonb);
DROP FUNCTION IF EXISTS public.save_restaurant_table_group(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.save_restaurant_table(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.save_restaurant_settings(uuid, jsonb);
DROP FUNCTION IF EXISTS public.restaurant_event(uuid, text, jsonb);

DROP TABLE IF EXISTS public.hotel_stay_events;
DROP TABLE IF EXISTS public.hotel_stays;
DROP FUNCTION IF EXISTS public.can_read_hotel_stay(uuid);
DROP TABLE IF EXISTS public.hotel_closures;
DROP TABLE IF EXISTS public.hotel_rooms;
DROP TABLE IF EXISTS public.hotel_room_types;
DROP TABLE IF EXISTS public.hotel_settings;

DROP TABLE IF EXISTS public.restaurant_reservation_events;
DROP TABLE IF EXISTS public.restaurant_reservation_tables;
DROP TABLE IF EXISTS public.restaurant_reservations;
DROP FUNCTION IF EXISTS public.can_read_restaurant_reservation(uuid);
DROP TABLE IF EXISTS public.restaurant_closed_dates;
DROP TABLE IF EXISTS public.restaurant_turn_times;
DROP TABLE IF EXISTS public.restaurant_service_periods;
DROP TABLE IF EXISTS public.restaurant_table_group_members;
DROP TABLE IF EXISTS public.restaurant_table_groups;
DROP TABLE IF EXISTS public.restaurant_tables;
DROP TABLE IF EXISTS public.restaurant_settings;

-- The plans, and the module and source lists as 00010 and 00011 left them.
DELETE FROM public.white_label_plans WHERE code IN ('restaurant', 'hotel');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'white_label_plans_modules_check'
               AND pg_get_constraintdef(oid) LIKE '%restaurant_reservations%') THEN
    ALTER TABLE public.white_label_plans DROP CONSTRAINT white_label_plans_modules_check;
    ALTER TABLE public.white_label_plans ADD CONSTRAINT white_label_plans_modules_check CHECK (
          modules <@ ARRAY['jobs', 'appointments', 'sales_invoicing']
      -- FlyttGo sells only moving and delivery.
      AND (seller_model = 'company' OR (cardinality(modules) = 0 AND industries <@ ARRAY['transport'])));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_source_type_check'
               AND pg_get_constraintdef(oid) LIKE '%hotel_stay%') THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_source_type_check;
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_source_type_check CHECK (
      source_type IS NULL OR source_type IN ('job', 'appointment', 'manual')) NOT VALID;
    BEGIN
      ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_source_type_check;
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'invoices has reservation or stay invoices; invoices_source_type_check left NOT VALID';
    END;
  END IF;
END $$;

-- ============================================================================
-- DONE
-- ============================================================================
