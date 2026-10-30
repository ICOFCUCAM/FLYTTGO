-- ============================================================================
-- Roll back 00018_api_keys.sql
-- ============================================================================
-- Run first (before 00015_down.sql and the rollbacks of other migrations
-- numbered below 00018). Tested by run.sh: afterwards the schema is exactly
-- as before 00018.
--
-- DATA LOSS — READ FIRST. Drops the companies' API keys (every key stops
-- working at once), the key log with the record of what was done through
-- each key, the rate counters, the stored idempotent answers and the
-- widget's websites. Export api_events first if anyone used the API.
-- Bookings, jobs and appointments made through the API stay: they are
-- ordinary records of their modules.
-- ============================================================================

DROP FUNCTION IF EXISTS public.widget_origins_public(uuid);
DROP FUNCTION IF EXISTS public.remove_widget_origin(uuid, text);
DROP FUNCTION IF EXISTS public.add_widget_origin(uuid, text);
DROP FUNCTION IF EXISTS public.normalize_widget_origin(text);
DROP FUNCTION IF EXISTS public.api_write(text, text, jsonb, text, text);
DROP FUNCTION IF EXISTS public.api_read(text, text, jsonb);
DROP FUNCTION IF EXISTS public.api_booking_json(public.bookings);
DROP FUNCTION IF EXISTS public.api_key_for(text, text);
DROP FUNCTION IF EXISTS public.api_begin(text, text);
DROP FUNCTION IF EXISTS public.api_refusal_message(text, text);
DROP FUNCTION IF EXISTS public.api_key_refusal(public.api_keys, text);
DROP FUNCTION IF EXISTS public.admin_set_api_key_limit(uuid, integer);
DROP FUNCTION IF EXISTS public.revoke_api_key(uuid, text);
DROP FUNCTION IF EXISTS public.update_api_key(uuid, text, text[]);
DROP FUNCTION IF EXISTS public.create_api_key(uuid, text, text[], timestamptz);
DROP FUNCTION IF EXISTS public.api_event(uuid, uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.api_checked_scopes(uuid, text[]);
DROP FUNCTION IF EXISTS public.api_scopes_available(uuid);
DROP FUNCTION IF EXISTS public.api_scope_available(uuid, text);
DROP TABLE IF EXISTS public.organization_widget_origins;
DROP TABLE IF EXISTS public.api_idempotency;
DROP TABLE IF EXISTS public.api_key_usage;
DROP TABLE IF EXISTS public.api_events;
DROP TABLE IF EXISTS public.api_keys;
DROP FUNCTION IF EXISTS public.is_valid_widget_origin(text);
DROP FUNCTION IF EXISTS public.api_scopes();

-- ============================================================================
-- DONE
-- ============================================================================
