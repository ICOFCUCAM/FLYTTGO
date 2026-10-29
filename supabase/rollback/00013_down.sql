-- ============================================================================
-- Roll back 00013_appointments.sql
-- ============================================================================
-- Run first (before 00012_down.sql). Tested by run.sh: afterwards the
-- schema is exactly as before 00013.
--
-- DATA LOSS — READ FIRST. Drops the companies' appointment services, staff
-- calendars, opening hours, time off, appointments and their logs. Export
-- them to each company first. Invoices made from appointments stay (00011).
-- ============================================================================

DROP FUNCTION IF EXISTS public.mark_appointment_reminded(uuid);
DROP FUNCTION IF EXISTS public.appointments_to_remind();
DROP FUNCTION IF EXISTS public.invoice_appointment(uuid);
DROP FUNCTION IF EXISTS public.close_appointment(uuid, text);
DROP FUNCTION IF EXISTS public.cancel_appointment(uuid, text);
DROP FUNCTION IF EXISTS public.appointment_for(uuid, text[]);
DROP FUNCTION IF EXISTS public.create_appointment(uuid, uuid, uuid, timestamptz, jsonb, text);
DROP FUNCTION IF EXISTS public.book_appointment(uuid, uuid, uuid, timestamptz, jsonb, text);
DROP FUNCTION IF EXISTS public.appointment_insert(uuid, uuid, uuid, timestamptz, uuid, jsonb, text, boolean);
DROP FUNCTION IF EXISTS public.available_slots(uuid, uuid, date, uuid);
DROP FUNCTION IF EXISTS public.remove_appointment_time_off(uuid);
DROP FUNCTION IF EXISTS public.add_appointment_time_off(uuid, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.save_appointment_resource(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.save_appointment_service(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.save_appointment_settings(uuid, jsonb);
DROP FUNCTION IF EXISTS public.appointment_event(uuid, text, jsonb);
DROP TABLE IF EXISTS public.appointment_events;
DROP TABLE IF EXISTS public.appointments;
DROP FUNCTION IF EXISTS public.can_read_appointment(uuid);
DROP TABLE IF EXISTS public.appointment_time_off;
DROP TABLE IF EXISTS public.appointment_hours;
DROP TABLE IF EXISTS public.appointment_resource_services;
DROP TABLE IF EXISTS public.appointment_resources;
DROP TABLE IF EXISTS public.appointment_services;
DROP TABLE IF EXISTS public.appointment_settings;

-- ============================================================================
-- DONE
-- ============================================================================
