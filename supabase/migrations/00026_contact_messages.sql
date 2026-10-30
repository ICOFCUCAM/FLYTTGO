-- ============================================================================
-- FlyttGo — inbound messages from the public forms, and FlyttGo's public
-- business details
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00025. The owner's decision of
-- 2026-10-30 on the platform audit (docs/PLATFORM_AUDIT_2026-10-30.md,
-- "Contact and corporate sales forms are stubs"; "Placeholder legal
-- identity"):
--
-- 1. contact_messages: what visitors send from the contact page, the
--    corporate quote form and the newsletter sign-up in the footer. Until
--    now those forms said "sent" and sent nothing. Visitors (signed in or
--    not) write only through submit_contact_message(), which checks every
--    field, limits lengths and refuses more than 5 messages from one email
--    address in an hour (and more than 300 from everyone in 10 minutes, so
--    random addresses cannot flood the table). Nobody writes to the table
--    directly. FlyttGo administrators (is_admin()) read the messages under
--    Admin → Inbox and mark them handled or new again
--    (admin_set_contact_message_status()); nobody else can read them.
--    No email is sent yet: that waits for Resend (docs/CONTACT_INBOX.md).
--
-- 2. flyttgo_public_identity(): the public business fields of the seller
--    the invoices state (00008: invoice_seller_* in platform_config, set
--    under Admin → Invoicing → Invoice settings): legal name, organisation
--    number, MVA status, address, email and phone. Never the bank account,
--    IBAN or BIC, and no other setting. The footer, header and contact page
--    show each line only once it is filled in.
--
-- Safe to re-run. Rolled back by supabase/rollback/00026_down.sql.
-- ============================================================================

-- ── 1. Inbound messages ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text        NOT NULL CHECK (source IN ('contact', 'corporate', 'newsletter')),
  topic       text        CHECK (char_length(topic) <= 200),
  name        text        CHECK (char_length(name) <= 120),
  email       text        NOT NULL CHECK (char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone       text        CHECK (char_length(phone) <= 40),
  company     text        CHECK (char_length(company) <= 200),
  message     text        CHECK (char_length(message) <= 5000),
  status      text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled')),
  handled_by  uuid,
  handled_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'handled') = (handled_by IS NOT NULL AND handled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS contact_messages_email_recent ON public.contact_messages (lower(email), created_at);
CREATE INDEX IF NOT EXISTS contact_messages_status ON public.contact_messages (status, created_at DESC);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_messages_admin_read ON public.contact_messages;
CREATE POLICY contact_messages_admin_read ON public.contact_messages FOR SELECT TO authenticated USING (public.is_admin());
-- No direct writes for anyone: submitting and marking go through the
-- functions below.
REVOKE ALL ON public.contact_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contact_messages TO authenticated;
GRANT ALL ON public.contact_messages TO service_role;


-- ── 2. Submitting a message (anyone) ────────────────────────────────────────
-- contact:    name, email and message required
-- corporate:  company and email required
-- newsletter: email only (name, company and message ignored)
-- Returns the new message's id. Text is trimmed; empty optional fields are
-- stored as NULL.
CREATE OR REPLACE FUNCTION public.submit_contact_message(
  p_source text, p_name text, p_email text, p_phone text, p_company text, p_topic text, p_message text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_source  text := lower(btrim(coalesce(p_source, '')));
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_phone   text := nullif(btrim(coalesce(p_phone, '')), '');
  v_company text := nullif(btrim(coalesce(p_company, '')), '');
  v_topic   text := nullif(btrim(coalesce(p_topic, '')), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_id      uuid;
BEGIN
  IF v_source NOT IN ('contact', 'corporate', 'newsletter') THEN
    RAISE EXCEPTION 'contact: unknown form' USING ERRCODE = '22023';
  END IF;
  IF v_email = '' OR char_length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'contact: enter a valid email address' USING ERRCODE = '22023';
  END IF;
  IF v_source = 'newsletter' THEN
    v_name := NULL; v_company := NULL; v_phone := NULL;
    v_topic := 'Newsletter sign-up'; v_message := NULL;
  END IF;
  IF v_source = 'contact' AND (v_name IS NULL OR v_message IS NULL) THEN
    RAISE EXCEPTION 'contact: name, email and message are required' USING ERRCODE = '22023';
  END IF;
  IF v_source = 'corporate' AND v_company IS NULL THEN
    RAISE EXCEPTION 'contact: company name and email are required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) > 120 THEN RAISE EXCEPTION 'contact: the name is too long (120 characters at most)' USING ERRCODE = '22023'; END IF;
  IF char_length(v_company) > 200 THEN RAISE EXCEPTION 'contact: the company name is too long (200 characters at most)' USING ERRCODE = '22023'; END IF;
  IF char_length(v_topic) > 200 THEN RAISE EXCEPTION 'contact: the subject is too long (200 characters at most)' USING ERRCODE = '22023'; END IF;
  IF char_length(v_message) > 5000 THEN RAISE EXCEPTION 'contact: the message is too long (5000 characters at most)' USING ERRCODE = '22023'; END IF;
  IF char_length(v_phone) > 40 OR v_phone !~ '^[0-9+() .-]+$' THEN
    RAISE EXCEPTION 'contact: enter a valid phone number, or leave it empty' USING ERRCODE = '22023';
  END IF;

  -- Rate limits. The lock makes concurrent submissions count each other.
  PERFORM pg_advisory_xact_lock(hashtext('flyttgo.contact_messages'));
  IF (SELECT count(*) FROM public.contact_messages
       WHERE lower(email) = v_email AND created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'contact: too many messages from this email address; please try again in an hour' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.contact_messages WHERE created_at > now() - interval '10 minutes') >= 300 THEN
    RAISE EXCEPTION 'contact: too many messages right now; please try again later' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.contact_messages (source, topic, name, email, phone, company, message)
  VALUES (v_source, v_topic, v_name, v_email, v_phone, v_company, v_message)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;


-- ── 3. Marking a message handled (administrators) ───────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_contact_message_status(p_id uuid, p_status text)
RETURNS public.contact_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.contact_messages%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'contact: FlyttGo administrators only' USING ERRCODE = '42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('new', 'handled') THEN
    RAISE EXCEPTION 'contact: new or handled' USING ERRCODE = '22023';
  END IF;
  UPDATE public.contact_messages
     SET status = p_status,
         handled_by = CASE WHEN p_status = 'handled' THEN auth.uid() END,
         handled_at = CASE WHEN p_status = 'handled' THEN now() END
   WHERE id = p_id
  RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact: no such message' USING ERRCODE = 'P0002'; END IF;
  RETURN r;
END $$;


-- ── 4. FlyttGo's public business details ────────────────────────────────────
-- Only these fields of the invoice seller (00008), each NULL while empty.
CREATE OR REPLACE FUNCTION public.flyttgo_public_identity()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'name',           public.config_text('invoice_seller_name'),
    'org_number',     public.config_text('invoice_seller_org_number'),
    'vat_registered', coalesce(public.config_text('invoice_seller_vat_registered'), 'true') = 'true',
    'address',        public.config_text('invoice_seller_address'),
    'postcode_city',  public.config_text('invoice_seller_postcode_city'),
    'email',          public.config_text('invoice_seller_email'),
    'phone',          public.config_text('invoice_seller_phone'));
$$;


-- ── 5. Who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.submit_contact_message(text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_contact_message_status(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.flyttgo_public_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_contact_message(text, text, text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_contact_message_status(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.flyttgo_public_identity() TO anon, authenticated, service_role;
