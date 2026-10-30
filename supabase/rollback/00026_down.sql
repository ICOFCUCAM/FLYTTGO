-- ============================================================================
-- Roll back 00026_contact_messages.sql
-- ============================================================================
-- Run first (before the rollback of 00025). Tested by run.sh: afterwards
-- the schema and function bodies are exactly as before 00026.
--
-- The messages visitors sent are dropped with the table: export them first
-- (Admin → Inbox, or SELECT * FROM public.contact_messages as the service
-- role) if any are still to be answered. The contact, corporate and
-- newsletter forms then show an error instead of "sent", and the footer,
-- header and contact page show no company details (the settings
-- themselves stay in platform_config).
-- ============================================================================

DROP FUNCTION IF EXISTS public.flyttgo_public_identity();
DROP FUNCTION IF EXISTS public.admin_set_contact_message_status(uuid, text);
DROP FUNCTION IF EXISTS public.submit_contact_message(text, text, text, text, text, text, text);
DROP TABLE IF EXISTS public.contact_messages;
