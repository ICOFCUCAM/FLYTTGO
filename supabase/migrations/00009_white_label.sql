-- ============================================================================
-- FlyttGo — white-label booking for companies (step 6 of the corporate plan)
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00008. Decided 2026-10-29
-- (docs/WHITE_LABEL.md): both seller models are built and each company
-- chooses one, through a plan with a stated price.
--
--   Model A, "FlyttGo sells" (the default): the company's own booking page,
--     name, logo and colours, but the customer buys from FlyttGo. FlyttGo
--     takes the payment (card or Vipps), issues the receipt, runs customer
--     service, cancellations, refunds and complaints under its own terms.
--     The company sees booking numbers, not its customers' details.
--   Model B, "the company sells" (larger companies that choose it): the
--     company is the seller. Its customers pay into its own Stripe account
--     (Stripe Connect), at its own price (FlyttGo's price plus its markup),
--     under its own terms. FlyttGo is its subcontractor: FlyttGo's price
--     for the move and a platform fee are taken from each payment, and
--     FlyttGo processes the customers' data for the company under a data
--     processing agreement. The company sees its customers' bookings and
--     answers its customers first.
--
--   * Plans and their prices are a public list (white_label_plans).
--     Prices are FlyttGo's to set: they ship as proposals and say so until
--     an administrator confirms them.
--   * A company's owner or admin requests a plan and fills in its brand;
--     FlyttGo approves it once every requirement of the plan is met
--     (white_label_missing). Model B needs: MVA registration, a customer
--     service email and phone, its own terms and privacy notice, the data
--     processing agreement accepted by an owner, and a Stripe account that
--     can take payments.
--   * A booking made on a company's page carries the company
--     (white_label_org) and the seller model, decided by the database
--     from the active plan, never by the browser. The split of a Model B
--     payment is written by the server when it prices the booking.
--   * The plan's fees, and for Model B what FlyttGo kept from each
--     payment, are invoiced monthly through FlyttGo's own invoices (00008).
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. Settings ─────────────────────────────────────────────────────────────
INSERT INTO public.platform_config (config_key, config_value)
SELECT k, v FROM (VALUES
  ('white_label_dpa_version', '2026-10-draft'),
  ('white_label_support_email', ''), ('white_label_support_phone', '')
) AS c(k, v)
WHERE NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = c.k);


-- ── 2. Plans and prices (public) ────────────────────────────────────────────
-- Fees exclude MVA. The platform fee (Model B) is a share of FlyttGo's
-- price for the move, at least platform_fee_min, per paid booking.
CREATE TABLE IF NOT EXISTS public.white_label_plans (
  code                text        PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name                text        NOT NULL,
  seller_model        text        NOT NULL CHECK (seller_model IN ('flyttgo', 'company')),
  summary             text        NOT NULL,
  for_whom            text,
  setup_fee           numeric     NOT NULL DEFAULT 0 CHECK (setup_fee >= 0),
  monthly_fee         numeric     NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
  platform_fee_pct    numeric     NOT NULL DEFAULT 0 CHECK (platform_fee_pct BETWEEN 0 AND 50),
  platform_fee_min    numeric     NOT NULL DEFAULT 0 CHECK (platform_fee_min >= 0),
  own_domain          boolean     NOT NULL DEFAULT false,
  features            text[]      NOT NULL DEFAULT '{}',
  flyttgo_does        text[]      NOT NULL DEFAULT '{}',
  company_does        text[]      NOT NULL DEFAULT '{}',
  requirements        text[]      NOT NULL DEFAULT '{}',
  is_default          boolean     NOT NULL DEFAULT false,
  sort                integer     NOT NULL DEFAULT 0,
  active              boolean     NOT NULL DEFAULT true,
  price_status        text        NOT NULL DEFAULT 'proposed' CHECK (price_status IN ('proposed', 'confirmed')),
  prices_confirmed_by uuid,
  prices_confirmed_at timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT white_label_plans_fee_model CHECK (seller_model = 'company' OR (platform_fee_pct = 0 AND platform_fee_min = 0))
);
-- One default plan.
CREATE UNIQUE INDEX IF NOT EXISTS white_label_plans_one_default ON public.white_label_plans (is_default) WHERE is_default;

-- FlyttGo's proposed price list. An administrator confirms or changes it
-- (admin_update_white_label_plan); until then every page says the prices
-- are proposals.
INSERT INTO public.white_label_plans (code, name, seller_model, summary, for_whom, setup_fee, monthly_fee,
                                      platform_fee_pct, platform_fee_min, own_domain, features, flyttgo_does,
                                      company_does, requirements, is_default, sort)
SELECT * FROM (VALUES
  ('branded', 'Branded booking page', 'flyttgo',
   'Your own booking page with your name, logo and colours. FlyttGo is the seller and does the rest.',
   'Companies that want to offer moving and delivery under their brand without running it.',
   2900::numeric, 1490::numeric, 0::numeric, 0::numeric, false,
   ARRAY['Booking page at flyttgo.no/b/your-name and your-name.flyttgo.no',
         'Your name, logo and colours on the booking page',
         'FlyttGo''s prices and payment (card, Vipps)',
         'Monthly booking numbers for your page'],
   ARRAY['Is the seller: the customer buys from FlyttGo AS',
         'Takes the payment and issues the receipt',
         'Customer service, cancellations, refunds and complaints',
         'Terms, consumer rights and privacy (FlyttGo is the data controller)'],
   ARRAY['Brings customers to the page'],
   ARRAY['An active (verified) company', 'A display name for the page'],
   true, 10),
  ('branded_domain', 'Branded booking on your domain', 'flyttgo',
   'As Branded booking page, on your own web address. FlyttGo is still the seller.',
   'Companies that want the booking page on their own website address.',
   4900::numeric, 2490::numeric, 0::numeric, 0::numeric, true,
   ARRAY['Everything in Branded booking page',
         'Your own address, for example booking.yourcompany.no',
         'FlyttGo connects and maintains the address'],
   ARRAY['Is the seller: the customer buys from FlyttGo AS',
         'Takes the payment and issues the receipt',
         'Customer service, cancellations, refunds and complaints',
         'Terms, consumer rights and privacy (FlyttGo is the data controller)',
         'Connects your domain'],
   ARRAY['Brings customers to the page', 'Adds two DNS records for the domain'],
   ARRAY['An active (verified) company', 'A display name for the page', 'A verified domain'],
   false, 20),
  ('own_seller', 'Own seller', 'company',
   'Your company is the seller: your prices, your terms, payments into your own Stripe account. FlyttGo carries out the moves as your subcontractor.',
   'Larger companies with their own customer service and accounting that want to sell moving under their own name.',
   14900::numeric, 4990::numeric, 4::numeric, 49::numeric, true,
   ARRAY['Everything in Branded booking on your domain',
         'Your own prices: FlyttGo''s price plus your markup',
         'Payments go straight into your own Stripe account (card)',
         'Receipts in your company''s name, under your terms',
         'Your customers'' bookings in your dashboard'],
   ARRAY['Carries out the moves (drivers, dispatch, tracking)',
         'Processes your customers'' data for you under the data processing agreement',
         'Invoices you monthly for the plan, with what was kept from each payment'],
   ARRAY['Is the seller: consumer rights, MVA on your sales, your own bookkeeping',
         'First-line customer service, complaints and refunds',
         'Your terms and privacy notice (you are the data controller)'],
   ARRAY['An active (verified) company registered for MVA',
         'Customer service email and phone',
         'Your own terms and privacy notice (web addresses)',
         'The data processing agreement, accepted by an owner',
         'A Stripe account connected through FlyttGo that can take payments',
         'A verified domain'],
   false, 30)
) AS v(code, name, seller_model, summary, for_whom, setup_fee, monthly_fee, platform_fee_pct, platform_fee_min,
       own_domain, features, flyttgo_does, company_does, requirements, is_default, sort)
WHERE NOT EXISTS (SELECT 1 FROM public.white_label_plans p WHERE p.code = v.code);

ALTER TABLE public.white_label_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS white_label_plans_select ON public.white_label_plans;
CREATE POLICY white_label_plans_select ON public.white_label_plans FOR SELECT TO anon, authenticated
  USING (active OR public.is_admin());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.white_label_plans FROM anon, authenticated;


-- ── 3. A company's white-label set-up ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organization_white_label (
  organization_id        uuid        PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  plan_code              text        NOT NULL REFERENCES public.white_label_plans (code),
  status                 text        NOT NULL DEFAULT 'requested'
                         CHECK (status IN ('requested', 'active', 'suspended', 'ended', 'declined')),
  requested_plan_code    text        REFERENCES public.white_label_plans (code),   -- a change waiting for FlyttGo
  requested_by           uuid,
  requested_at           timestamptz NOT NULL DEFAULT now(),
  decided_by             uuid,
  decided_at             timestamptz,
  decision_reason        text,
  started_at             timestamptz,                      -- first approval: billing starts
  ended_at               timestamptz,
  display_name           text        CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 2 AND 80),
  tagline                text        CHECK (tagline IS NULL OR char_length(tagline) <= 140),
  primary_color          text        CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9a-f]{6}$'),
  accent_color           text        CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-f]{6}$'),
  support_email          text        CHECK (support_email IS NULL OR support_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  support_phone          text        CHECK (support_phone IS NULL OR support_phone ~ '^\+?[0-9 ]{8,20}$'),
  terms_url              text        CHECK (terms_url IS NULL OR terms_url ~ '^https://[^\s]+$'),
  privacy_url            text        CHECK (privacy_url IS NULL OR privacy_url ~ '^https://[^\s]+$'),
  price_markup_pct       numeric     NOT NULL DEFAULT 0 CHECK (price_markup_pct BETWEEN 0 AND 100),
  custom_domain          text        UNIQUE,
  domain_token           text,
  domain_verified_at     timestamptz,
  stripe_account_id      text        UNIQUE CHECK (stripe_account_id IS NULL OR stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  stripe_charges_enabled boolean     NOT NULL DEFAULT false,
  stripe_checked_at      timestamptz,
  dpa_version            text,
  dpa_accepted_by        uuid,
  dpa_accepted_at        timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_white_label_domain_valid CHECK (custom_domain IS NULL OR (
        custom_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    AND custom_domain !~ '(^|\.)flyttgo\.no$'))
);

ALTER TABLE public.organization_white_label ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_white_label_select ON public.organization_white_label;
CREATE POLICY organization_white_label_select ON public.organization_white_label FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organization_white_label FROM anon, authenticated;
REVOKE ALL ON public.organization_white_label FROM anon;


-- ── 4. Bookings made on a company's page ────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS white_label_org      uuid,
  ADD COLUMN IF NOT EXISTS seller_model         text,
  ADD COLUMN IF NOT EXISTS customer_price       numeric,     -- Model B: what the customer pays the company (incl. MVA)
  ADD COLUMN IF NOT EXISTS platform_fee         numeric,     -- Model B: FlyttGo's platform fee (incl. MVA)
  ADD COLUMN IF NOT EXISTS connected_account_id text;        -- Model B: the company's Stripe account
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_white_label_org_fkey') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_white_label_org_fkey
      FOREIGN KEY (white_label_org) REFERENCES public.organizations (id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_seller_model_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_seller_model_check CHECK (
          (white_label_org IS NULL AND seller_model IS NULL)
       OR (white_label_org IS NOT NULL AND seller_model IN ('flyttgo', 'company')));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS bookings_white_label_idx
  ON public.bookings (white_label_org, created_at DESC) WHERE white_label_org IS NOT NULL;

-- The page's company and its seller model come from the active plan; the
-- payment split only from the server. A booking the company sells is paid
-- into the company's account, never on FlyttGo's invoice.
CREATE OR REPLACE FUNCTION public.guard_booking_white_label()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_model text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_server() THEN
      NEW.customer_price := NULL; NEW.platform_fee := NULL; NEW.connected_account_id := NULL;
    END IF;
    IF NEW.white_label_org IS NULL THEN
      NEW.seller_model := NULL;
      RETURN NEW;
    END IF;
    SELECT p.seller_model INTO v_model
      FROM public.organization_white_label w
      JOIN public.white_label_plans p ON p.code = w.plan_code
      JOIN public.organizations o ON o.id = w.organization_id
     WHERE w.organization_id = NEW.white_label_org AND w.status = 'active' AND o.status = 'active';
    IF v_model IS NULL THEN
      RAISE EXCEPTION 'bookings: this company''s booking page is not active' USING ERRCODE = '42501';
    END IF;
    NEW.seller_model := v_model;
    RETURN NEW;
  END IF;

  IF NEW.white_label_org IS DISTINCT FROM OLD.white_label_org OR NEW.seller_model IS DISTINCT FROM OLD.seller_model THEN
    RAISE EXCEPTION 'bookings: the booking page and seller of a booking cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_server()
     AND (NEW.customer_price IS DISTINCT FROM OLD.customer_price OR NEW.platform_fee IS DISTINCT FROM OLD.platform_fee
          OR NEW.connected_account_id IS DISTINCT FROM OLD.connected_account_id) THEN
    RAISE EXCEPTION 'bookings: the payment split is set by the server only' USING ERRCODE = '42501';
  END IF;
  IF NEW.seller_model = 'company' AND NEW.payment_provider = 'invoice'
     AND NEW.payment_provider IS DISTINCT FROM OLD.payment_provider THEN
    RAISE EXCEPTION 'bookings: the company sells this booking, so its customer pays the company, not on FlyttGo''s invoice'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_booking_white_label ON public.bookings;
CREATE TRIGGER guard_booking_white_label
  BEFORE INSERT OR UPDATE OF white_label_org, seller_model, customer_price, platform_fee, connected_account_id, payment_provider
  ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.guard_booking_white_label();
REVOKE ALL ON FUNCTION public.guard_booking_white_label() FROM PUBLIC, anon, authenticated;

-- Model B: the seller company's members read their customers' bookings.
-- Model A: the customers are FlyttGo's; the company sees numbers only
-- (white_label_stats).
DROP POLICY IF EXISTS bookings_white_label_select ON public.bookings;
CREATE POLICY bookings_white_label_select ON public.bookings
  FOR SELECT TO authenticated
  USING (seller_model = 'company' AND white_label_org IS NOT NULL AND public.is_org_member(white_label_org));


-- ── 5. Choosing a plan and setting it up ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.white_label_event(p_org uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT public.org_event(p_org, p_action, NULL, p_details); $$;

-- What a plan still needs before FlyttGo can approve it (empty: ready).
CREATE OR REPLACE FUNCTION public.white_label_missing(p_org uuid, p_plan text DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  w   public.organization_white_label%ROWTYPE;
  o   public.organizations%ROWTYPE;
  p   public.white_label_plans%ROWTYPE;
  m   text[] := '{}';
BEGIN
  IF NOT (public.is_admin() OR public.is_server() OR public.is_org_member(p_org)) THEN
    RAISE EXCEPTION 'white label: members of the company only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.organizations WHERE id = p_org;
  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org;
  SELECT * INTO p FROM public.white_label_plans
   WHERE code = coalesce(p_plan, w.requested_plan_code, w.plan_code,
                         (SELECT code FROM public.white_label_plans WHERE is_default));
  IF NOT FOUND THEN RETURN ARRAY['a plan']; END IF;
  IF NOT p.active THEN m := array_append(m, 'the plan is no longer offered'::text); END IF;
  IF o.status IS DISTINCT FROM 'active' THEN m := array_append(m, 'the company must be active (verified by FlyttGo)'::text); END IF;
  IF w.display_name IS NULL THEN m := array_append(m, 'a display name for the page'::text); END IF;
  IF p.own_domain AND (w.custom_domain IS NULL OR w.domain_verified_at IS NULL) THEN m := array_append(m, 'a verified domain'::text); END IF;
  IF p.seller_model = 'company' THEN
    IF o.org_number IS NULL OR NOT o.vat_registered THEN m := array_append(m, 'registration for MVA'::text); END IF;
    IF w.support_email IS NULL OR w.support_phone IS NULL THEN m := array_append(m, 'customer service email and phone'::text); END IF;
    IF w.terms_url IS NULL THEN m := array_append(m, 'your terms (web address)'::text); END IF;
    IF w.privacy_url IS NULL THEN m := array_append(m, 'your privacy notice (web address)'::text); END IF;
    IF w.dpa_version IS DISTINCT FROM public.config_text('white_label_dpa_version') THEN
      m := array_append(m, 'the data processing agreement, accepted by an owner'::text);
    END IF;
    IF w.stripe_account_id IS NULL OR NOT w.stripe_charges_enabled THEN m := array_append(m, 'a connected Stripe account that can take payments'::text); END IF;
  END IF;
  RETURN m;
END $$;

-- An owner or admin requests a plan (the default when none is named). A
-- company already on a plan requests a change, which waits for FlyttGo.
CREATE OR REPLACE FUNCTION public.request_white_label(p_org uuid, p_plan text DEFAULT NULL)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  w      public.organization_white_label%ROWTYPE;
  v_plan text;
  v_org  public.organizations%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  SELECT * INTO v_org FROM public.organizations WHERE id = p_org;
  IF v_org.status IN ('suspended', 'closed') THEN
    RAISE EXCEPTION 'white label: a % company cannot request a plan', v_org.status USING ERRCODE = '55000';
  END IF;
  SELECT code INTO v_plan FROM public.white_label_plans
   WHERE active AND code = coalesce(p_plan, (SELECT code FROM public.white_label_plans WHERE is_default));
  IF v_plan IS NULL THEN RAISE EXCEPTION 'white label: no such plan' USING ERRCODE = '22023'; END IF;

  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.organization_white_label (organization_id, plan_code, requested_by, display_name)
    VALUES (p_org, v_plan, auth.uid(), left(v_org.name, 80)) RETURNING * INTO w;
  ELSIF w.status IN ('active', 'suspended') THEN
    IF v_plan = w.plan_code THEN
      UPDATE public.organization_white_label SET requested_plan_code = NULL, updated_at = now()
       WHERE organization_id = p_org RETURNING * INTO w;
    ELSE
      UPDATE public.organization_white_label SET requested_plan_code = v_plan, requested_by = auth.uid(),
             requested_at = now(), updated_at = now()
       WHERE organization_id = p_org RETURNING * INTO w;
    END IF;
  ELSE
    UPDATE public.organization_white_label SET plan_code = v_plan, status = 'requested', requested_plan_code = NULL,
           requested_by = auth.uid(), requested_at = now(), decision_reason = NULL, ended_at = NULL, updated_at = now()
     WHERE organization_id = p_org RETURNING * INTO w;
  END IF;
  -- Only the seller sets its own prices.
  IF (SELECT seller_model FROM public.white_label_plans WHERE code = coalesce(w.requested_plan_code, w.plan_code)) <> 'company'
     AND w.status NOT IN ('active', 'suspended') THEN
    UPDATE public.organization_white_label SET price_markup_pct = 0 WHERE organization_id = p_org RETURNING * INTO w;
  END IF;
  PERFORM public.white_label_event(p_org, 'white_label.requested', jsonb_build_object('plan', v_plan));
  RETURN w;
END $$;

-- The page's brand and, for the seller, its customer contacts, terms and
-- markup. Owners and admins.
CREATE OR REPLACE FUNCTION public.set_white_label_brand(
  p_org uuid, p_display_name text, p_primary_color text, p_accent_color text, p_tagline text,
  p_support_email text, p_support_phone text, p_terms_url text, p_privacy_url text, p_markup_pct numeric DEFAULT 0)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE; v_model text;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: choose a plan first' USING ERRCODE = 'P0002'; END IF;
  SELECT seller_model INTO v_model FROM public.white_label_plans WHERE code = coalesce(w.requested_plan_code, w.plan_code);
  IF coalesce(p_markup_pct, 0) <> 0 AND v_model <> 'company' AND w.price_markup_pct IS DISTINCT FROM p_markup_pct THEN
    RAISE EXCEPTION 'white label: only a company that is the seller sets its own prices (plan Own seller)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.organization_white_label SET
    display_name     = nullif(btrim(coalesce(p_display_name, '')), ''),
    primary_color    = lower(nullif(btrim(coalesce(p_primary_color, '')), '')),
    accent_color     = lower(nullif(btrim(coalesce(p_accent_color, '')), '')),
    tagline          = nullif(btrim(coalesce(p_tagline, '')), ''),
    support_email    = lower(nullif(btrim(coalesce(p_support_email, '')), '')),
    support_phone    = nullif(btrim(coalesce(p_support_phone, '')), ''),
    terms_url        = nullif(btrim(coalesce(p_terms_url, '')), ''),
    privacy_url      = nullif(btrim(coalesce(p_privacy_url, '')), ''),
    price_markup_pct = coalesce(p_markup_pct, 0),
    updated_at       = now()
   WHERE organization_id = p_org RETURNING * INTO w;
  PERFORM public.white_label_event(p_org, 'white_label.brand', jsonb_build_object(
    'display_name', w.display_name, 'markup_pct', w.price_markup_pct, 'terms_url', w.terms_url));
  RETURN w;
END $$;

-- The company's own address for the page. A new token is shown for the
-- DNS record; the domain counts only once the server has seen it.
CREATE OR REPLACE FUNCTION public.set_white_label_domain(p_org uuid, p_domain text)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE; v_domain text := lower(btrim(coalesce(p_domain, '')));
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  v_domain := regexp_replace(regexp_replace(v_domain, '^https?://', ''), '/.*$', '');
  UPDATE public.organization_white_label SET
    custom_domain = nullif(v_domain, ''),
    domain_token  = CASE WHEN v_domain = '' THEN NULL ELSE replace(gen_random_uuid()::text, '-', '') END,
    domain_verified_at = NULL,
    updated_at    = now()
   WHERE organization_id = p_org RETURNING * INTO w;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: choose a plan first' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.white_label_event(p_org, 'white_label.domain', jsonb_build_object('domain', w.custom_domain));
  RETURN w;
END $$;

-- The server found the token in the domain's DNS.
CREATE OR REPLACE FUNCTION public.mark_white_label_domain_verified(p_org uuid, p_domain text)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE;
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'white label: the server only' USING ERRCODE = '42501'; END IF;
  UPDATE public.organization_white_label SET domain_verified_at = now(), updated_at = now()
   WHERE organization_id = p_org AND custom_domain = lower(p_domain) RETURNING * INTO w;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: that is not the company''s domain' USING ERRCODE = '22023'; END IF;
  PERFORM public.white_label_event(p_org, 'white_label.domain_verified', jsonb_build_object('domain', w.custom_domain));
  RETURN w;
END $$;

-- An owner accepts the data processing agreement (the version in force).
CREATE OR REPLACE FUNCTION public.accept_white_label_dpa(p_org uuid, p_version text)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner']);
  IF p_version IS DISTINCT FROM public.config_text('white_label_dpa_version') THEN
    RAISE EXCEPTION 'white label: the data processing agreement in force is version %', public.config_text('white_label_dpa_version')
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.organization_white_label SET dpa_version = p_version, dpa_accepted_by = auth.uid(),
         dpa_accepted_at = now(), updated_at = now()
   WHERE organization_id = p_org RETURNING * INTO w;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: choose a plan first' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.white_label_event(p_org, 'white_label.dpa_accepted', jsonb_build_object('version', p_version));
  RETURN w;
END $$;

-- The server records the company's Stripe account and whether it can
-- take payments (stripe-connect). One company per account.
CREATE OR REPLACE FUNCTION public.set_white_label_stripe_account(p_org uuid, p_account text, p_charges_enabled boolean)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE;
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'white label: the server only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: choose a plan first' USING ERRCODE = 'P0002'; END IF;
  IF w.stripe_account_id IS NOT NULL AND w.stripe_account_id <> p_account THEN
    RAISE EXCEPTION 'white label: the company already has Stripe account %', w.stripe_account_id USING ERRCODE = '55000';
  END IF;
  UPDATE public.organization_white_label SET stripe_account_id = p_account, stripe_charges_enabled = coalesce(p_charges_enabled, false),
         stripe_checked_at = now(), updated_at = now()
   WHERE organization_id = p_org RETURNING * INTO w;
  PERFORM public.white_label_event(p_org, 'white_label.stripe', jsonb_build_object('account', p_account, 'charges_enabled', p_charges_enabled));
  RETURN w;
END $$;

-- The company stops its plan (owner). Billing stops after this month.
CREATE OR REPLACE FUNCTION public.end_white_label(p_org uuid, p_reason text)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner']);
  UPDATE public.organization_white_label SET
    status = CASE WHEN status IN ('active', 'suspended') THEN 'ended' ELSE 'declined' END,
    ended_at = CASE WHEN status IN ('active', 'suspended') THEN now() END,
    requested_plan_code = NULL, decision_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   WHERE organization_id = p_org AND status IN ('requested', 'active', 'suspended') RETURNING * INTO w;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: there is no plan to end' USING ERRCODE = '55000'; END IF;
  PERFORM public.white_label_event(p_org, 'white_label.ended_by_company', jsonb_build_object('reason', p_reason));
  RETURN w;
END $$;

-- FlyttGo approves or declines a request (a new plan or a change). It
-- approves only when every requirement of the plan is met.
CREATE OR REPLACE FUNCTION public.admin_decide_white_label(p_org uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE; v_missing text[]; v_plan text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'white label: platform administrators only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: no request' USING ERRCODE = 'P0002'; END IF;
  IF w.status <> 'requested' AND w.requested_plan_code IS NULL THEN
    RAISE EXCEPTION 'white label: nothing is waiting for a decision' USING ERRCODE = '55000';
  END IF;
  v_plan := CASE WHEN w.status = 'requested' THEN w.plan_code ELSE w.requested_plan_code END;
  IF NOT p_approve THEN
    IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'white label: give the reason' USING ERRCODE = '22023'; END IF;
    UPDATE public.organization_white_label SET
      status = CASE WHEN status = 'requested' THEN 'declined' ELSE status END,
      requested_plan_code = NULL, decided_by = auth.uid(), decided_at = now(), decision_reason = btrim(p_reason), updated_at = now()
     WHERE organization_id = p_org RETURNING * INTO w;
    PERFORM public.white_label_event(p_org, 'white_label.declined', jsonb_build_object('plan', v_plan, 'reason', p_reason));
    RETURN w;
  END IF;
  v_missing := public.white_label_missing(p_org, v_plan);
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'white label: still missing: %', array_to_string(v_missing, '; ') USING ERRCODE = '55000';
  END IF;
  UPDATE public.organization_white_label SET
    plan_code = v_plan, status = CASE WHEN status = 'requested' THEN 'active' ELSE status END,
    requested_plan_code = NULL, decided_by = auth.uid(), decided_at = now(), decision_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    started_at = coalesce(started_at, now()), ended_at = NULL,
    price_markup_pct = CASE WHEN (SELECT seller_model FROM public.white_label_plans WHERE code = v_plan) = 'company'
                            THEN price_markup_pct ELSE 0 END,
    updated_at = now()
   WHERE organization_id = p_org RETURNING * INTO w;
  PERFORM public.white_label_event(p_org, 'white_label.approved', jsonb_build_object('plan', v_plan));
  RETURN w;
END $$;

-- FlyttGo suspends, ends or reactivates a plan, with the reason.
CREATE OR REPLACE FUNCTION public.admin_set_white_label_status(p_org uuid, p_status text, p_reason text)
RETURNS public.organization_white_label
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.organization_white_label%ROWTYPE; v_missing text[];
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'white label: platform administrators only' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('active', 'suspended', 'ended') THEN RAISE EXCEPTION 'white label: status active, suspended or ended' USING ERRCODE = '22023'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'white label: give the reason' USING ERRCODE = '22023'; END IF;
  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org FOR UPDATE;
  IF NOT FOUND OR w.started_at IS NULL OR w.status NOT IN ('active', 'suspended', 'ended') THEN
    RAISE EXCEPTION 'white label: only an approved plan changes status (decide the request first)' USING ERRCODE = '55000';
  END IF;
  IF p_status = 'active' THEN
    v_missing := public.white_label_missing(p_org, w.plan_code);
    IF cardinality(v_missing) > 0 THEN
      RAISE EXCEPTION 'white label: still missing: %', array_to_string(v_missing, '; ') USING ERRCODE = '55000';
    END IF;
  END IF;
  UPDATE public.organization_white_label SET status = p_status, decision_reason = btrim(p_reason),
         decided_by = auth.uid(), decided_at = now(),
         ended_at = CASE WHEN p_status = 'ended' THEN now() END, updated_at = now()
   WHERE organization_id = p_org RETURNING * INTO w;
  PERFORM public.white_label_event(p_org, 'white_label.status', jsonb_build_object('status', p_status, 'reason', p_reason));
  RETURN w;
END $$;

-- FlyttGo sets a plan's prices. Changed prices are proposals until
-- confirmed; confirming records who did it.
CREATE OR REPLACE FUNCTION public.admin_update_white_label_plan(
  p_code text, p_setup_fee numeric, p_monthly_fee numeric, p_platform_fee_pct numeric, p_platform_fee_min numeric,
  p_active boolean, p_confirm boolean)
RETURNS public.white_label_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p public.white_label_plans%ROWTYPE; v_changed boolean;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'white label: platform administrators only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.white_label_plans WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'white label: no such plan' USING ERRCODE = 'P0002'; END IF;
  IF p.is_default AND p_active IS FALSE THEN
    RAISE EXCEPTION 'white label: the default plan stays offered' USING ERRCODE = '55000';
  END IF;
  v_changed := (p.setup_fee, p.monthly_fee, p.platform_fee_pct, p.platform_fee_min)
               IS DISTINCT FROM (coalesce(p_setup_fee, p.setup_fee), coalesce(p_monthly_fee, p.monthly_fee),
                                 coalesce(p_platform_fee_pct, p.platform_fee_pct), coalesce(p_platform_fee_min, p.platform_fee_min));
  UPDATE public.white_label_plans SET
    setup_fee        = coalesce(p_setup_fee, setup_fee),
    monthly_fee      = coalesce(p_monthly_fee, monthly_fee),
    platform_fee_pct = coalesce(p_platform_fee_pct, platform_fee_pct),
    platform_fee_min = coalesce(p_platform_fee_min, platform_fee_min),
    active           = coalesce(p_active, active),
    price_status     = CASE WHEN p_confirm THEN 'confirmed' WHEN v_changed THEN 'proposed' ELSE price_status END,
    prices_confirmed_by = CASE WHEN p_confirm THEN auth.uid() WHEN v_changed THEN NULL ELSE prices_confirmed_by END,
    prices_confirmed_at = CASE WHEN p_confirm THEN now() WHEN v_changed THEN NULL ELSE prices_confirmed_at END,
    updated_at       = now()
   WHERE code = p_code RETURNING * INTO p;
  RETURN p;
END $$;

-- What the booking page shows, for the server to publish (white-label-
-- site). Only an active plan of an active company; the domain only once
-- verified. FlyttGo's bank details never leave the invoice.
CREATE OR REPLACE FUNCTION public.white_label_public(p_slug text, p_host text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  w public.organization_white_label%ROWTYPE;
  o public.organizations%ROWTYPE;
  p public.white_label_plans%ROWTYPE;
  v_host text := lower(btrim(coalesce(p_host, '')));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  s jsonb := public.invoice_seller() - 'bank_account' - 'iban' - 'bic';
BEGIN
  IF v_slug = '' AND v_host ~ '^[a-z0-9-]+\.flyttgo\.no$' THEN v_slug := split_part(v_host, '.', 1); END IF;
  SELECT w2.* INTO w FROM public.organization_white_label w2 JOIN public.organizations o2 ON o2.id = w2.organization_id
   WHERE w2.status = 'active' AND o2.status = 'active'
     AND ((v_slug <> '' AND o2.slug = v_slug)
          OR (v_slug = '' AND v_host <> '' AND w2.custom_domain = v_host AND w2.domain_verified_at IS NOT NULL));
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.organizations WHERE id = w.organization_id;
  SELECT * INTO p FROM public.white_label_plans WHERE code = w.plan_code;
  RETURN jsonb_build_object(
    'organization_id', o.id, 'slug', o.slug, 'display_name', w.display_name, 'tagline', w.tagline,
    'primary_color', w.primary_color, 'accent_color', w.accent_color, 'logo_path', o.logo_path,
    'plan', p.code, 'seller_model', p.seller_model,
    'domain', CASE WHEN w.domain_verified_at IS NOT NULL THEN w.custom_domain END,
    'pricing', CASE WHEN p.seller_model = 'company' THEN jsonb_build_object(
                 'markup_pct', w.price_markup_pct, 'platform_fee_pct', p.platform_fee_pct, 'platform_fee_min', p.platform_fee_min) END,
    'payments_ready', p.seller_model = 'flyttgo' OR (w.stripe_account_id IS NOT NULL AND w.stripe_charges_enabled),
    'seller', CASE WHEN p.seller_model = 'company'
                   THEN jsonb_build_object('name', o.name, 'org_number', o.org_number, 'vat_registered', o.vat_registered,
                                           'address', o.billing_address, 'email', w.support_email, 'phone', w.support_phone)
                   ELSE s END,
    'support', CASE WHEN p.seller_model = 'company'
                    THEN jsonb_build_object('email', w.support_email, 'phone', w.support_phone)
                    ELSE jsonb_build_object('email', coalesce(public.config_text('white_label_support_email'), s ->> 'email'),
                                            'phone', coalesce(public.config_text('white_label_support_phone'), s ->> 'phone')) END,
    'terms_url', CASE WHEN p.seller_model = 'company' THEN w.terms_url END,
    'privacy_url', CASE WHEN p.seller_model = 'company' THEN w.privacy_url END);
END $$;

-- Monthly numbers for the company's page. The seller (Model B) also sees
-- what its customers paid; Model A's sales are FlyttGo's.
CREATE OR REPLACE FUNCTION public.white_label_stats(p_org uuid)
RETURNS TABLE (month date, bookings bigint, completed bigint, cancelled bigint, customer_revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_org_member(p_org)) THEN
    RAISE EXCEPTION 'white label: members of the company only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT date_trunc('month', b.created_at AT TIME ZONE 'Europe/Oslo')::date,
         count(*) FILTER (WHERE b.payment_status IS DISTINCT FROM 'pending'),
         count(*) FILTER (WHERE b.status = 'completed'),
         count(*) FILTER (WHERE b.status = 'cancelled'),
         CASE WHEN bool_and(b.seller_model = 'company')
              THEN coalesce(sum(b.paid_amount) FILTER (WHERE b.payment_status IS DISTINCT FROM 'pending'), 0) END
    FROM public.bookings b
   WHERE b.white_label_org = p_org
   GROUP BY 1 ORDER BY 1 DESC LIMIT 24;
END $$;


-- ── 6. Billing the plan (FlyttGo's invoices, 00008) ─────────────────────────
-- What has been charged, so nothing is charged twice: the set-up fee once
-- per plan, the monthly fee once per month, and for Model B each booking
-- once (what FlyttGo kept from its payment, already collected through
-- Stripe).
CREATE TABLE IF NOT EXISTS public.white_label_charges (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES public.organizations (id),
  invoice_id         uuid        NOT NULL REFERENCES public.invoices (id) ON DELETE CASCADE,
  kind               text        NOT NULL CHECK (kind IN ('setup', 'monthly', 'booking')),
  plan_code          text        REFERENCES public.white_label_plans (code),
  period             date,
  booking_id         uuid        REFERENCES public.bookings (id),
  total              numeric     NOT NULL,                     -- incl. MVA
  collected          numeric     NOT NULL DEFAULT 0,           -- already taken from the customer's payment
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT white_label_charges_shape CHECK (
       (kind = 'setup'   AND plan_code IS NOT NULL AND booking_id IS NULL)
    OR (kind = 'monthly' AND plan_code IS NOT NULL AND period IS NOT NULL AND booking_id IS NULL)
    OR (kind = 'booking' AND booking_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS white_label_charges_setup_once   ON public.white_label_charges (organization_id, plan_code) WHERE kind = 'setup';
CREATE UNIQUE INDEX IF NOT EXISTS white_label_charges_monthly_once ON public.white_label_charges (organization_id, period)    WHERE kind = 'monthly';
CREATE UNIQUE INDEX IF NOT EXISTS white_label_charges_booking_once ON public.white_label_charges (booking_id)                 WHERE kind = 'booking';
ALTER TABLE public.white_label_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS white_label_charges_select ON public.white_label_charges;
CREATE POLICY white_label_charges_select ON public.white_label_charges FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_org_member(organization_id, ARRAY['owner', 'admin', 'finance']));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.white_label_charges FROM anon, authenticated;

-- Taken from a customer's payment and kept by FlyttGo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_payments_method_check'
               AND pg_get_constraintdef(oid) NOT LIKE '%platform_fee%') THEN
    ALTER TABLE public.invoice_payments DROP CONSTRAINT invoice_payments_method_check;
    ALTER TABLE public.invoice_payments ADD CONSTRAINT invoice_payments_method_check
      CHECK (method IN ('bank', 'card', 'vipps', 'other', 'platform_fee'));
  END IF;
END $$;

-- A line from an amount including MVA at 25%.
CREATE OR REPLACE FUNCTION public.white_label_line(p_invoice uuid, p_description text, p_net numeric, p_booking uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_net numeric := round(p_net, 2); v_vat numeric := round(p_net * 0.25, 2);
BEGIN
  INSERT INTO public.invoice_lines (invoice_id, line_no, booking_id, description, quantity, unit_price, vat_rate,
                                    net_amount, vat_amount, total)
  VALUES (p_invoice, coalesce((SELECT max(line_no) FROM public.invoice_lines WHERE invoice_id = p_invoice), 0) + 1,
          p_booking, p_description, 1, v_net, 25, v_net, v_vat, v_net + v_vat);
  RETURN v_net + v_vat;
END $$;
REVOKE ALL ON FUNCTION public.white_label_line(uuid, text, numeric, uuid) FROM PUBLIC, anon, authenticated;

-- The month's invoice for a company's plan, as a draft (NULL when there is
-- nothing to charge):
--   * the set-up fee, once per plan;
--   * the monthly fee, in advance, for each month from approval to the
--     current one not yet charged (the first month by the day, nothing
--     after the month a plan ended);
--   * Model B: per booking finished or cancelled before this month, what
--     FlyttGo kept from the customer's payment (its price for the move
--     and the platform fee, or their share after a refund). That part was
--     collected through Stripe and is recorded as paid when the invoice is
--     issued (settle_white_label_invoice).
CREATE OR REPLACE FUNCTION public.create_white_label_invoice(p_org uuid, p_today date DEFAULT NULL)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := coalesce(p_today, (now() AT TIME ZONE 'Europe/Oslo')::date);
  v_month date := date_trunc('month', coalesce(p_today, (now() AT TIME ZONE 'Europe/Oslo')::date))::date;
  w     public.organization_white_label%ROWTYPE;
  p     public.white_label_plans%ROWTYPE;
  v_inv public.invoices%ROWTYPE;
  v_m   date;
  v_end date;
  v_start date;
  v_days int;
  v_fee numeric;
  v_amt numeric;
  b     record;
  v_paid numeric;
  v_refunded numeric;
  v_keep numeric;
BEGIN
  PERFORM public.require_billing_operator();
  SELECT * INTO w FROM public.organization_white_label WHERE organization_id = p_org FOR UPDATE;
  IF NOT FOUND OR w.started_at IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.white_label_plans WHERE code = w.plan_code;
  INSERT INTO public.invoices (organization_id, notes, created_by)
  VALUES (p_org, 'White label: ' || p.name, auth.uid()) RETURNING * INTO v_inv;

  -- Set-up fee.
  IF p.setup_fee > 0 AND NOT EXISTS (SELECT 1 FROM public.white_label_charges
                                      WHERE organization_id = p_org AND kind = 'setup' AND plan_code = p.code) THEN
    v_amt := public.white_label_line(v_inv.id, 'Set-up, ' || p.name, p.setup_fee);
    INSERT INTO public.white_label_charges (organization_id, invoice_id, kind, plan_code, total)
    VALUES (p_org, v_inv.id, 'setup', p.code, v_amt);
  END IF;

  -- Monthly fees, in advance.
  v_start := (w.started_at AT TIME ZONE 'Europe/Oslo')::date;
  v_end   := CASE WHEN w.status = 'ended' AND w.ended_at IS NOT NULL
                  THEN least(v_month, date_trunc('month', w.ended_at AT TIME ZONE 'Europe/Oslo')::date) ELSE v_month END;
  v_m := date_trunc('month', v_start)::date;
  WHILE v_m <= v_end LOOP
    IF p.monthly_fee > 0 AND NOT EXISTS (SELECT 1 FROM public.white_label_charges
                                          WHERE organization_id = p_org AND kind = 'monthly' AND period = v_m) THEN
      v_days := ((v_m + interval '1 month')::date - v_m);
      v_fee := CASE WHEN v_m = date_trunc('month', v_start)::date
                    THEN round(p.monthly_fee * (v_days - extract(day FROM v_start)::int + 1) / v_days, 2)
                    ELSE p.monthly_fee END;
      v_amt := public.white_label_line(v_inv.id, p.name || ', ' || to_char(v_m, 'MM.YYYY')
                 || CASE WHEN v_fee <> p.monthly_fee THEN ' (from ' || to_char(v_start, 'DD.MM.YYYY') || ')' ELSE '' END, v_fee);
      INSERT INTO public.white_label_charges (organization_id, invoice_id, kind, plan_code, period, total)
      VALUES (p_org, v_inv.id, 'monthly', p.code, v_m, v_amt);
    END IF;
    v_m := (v_m + interval '1 month')::date;
  END LOOP;

  -- Model B: what FlyttGo kept from each payment.
  FOR b IN
    SELECT bk.* FROM public.bookings bk
     WHERE bk.white_label_org = p_org AND bk.seller_model = 'company'
       AND bk.payment_provider = 'stripe' AND coalesce(bk.paid_amount, 0) > 0
       AND bk.platform_fee IS NOT NULL
       AND bk.status IN ('completed', 'cancelled')
       AND coalesce(bk.end_time, bk.cancelled_at, bk.updated_at) < (v_month::timestamp AT TIME ZONE 'Europe/Oslo')
       AND NOT EXISTS (SELECT 1 FROM public.white_label_charges c WHERE c.booking_id = bk.id AND c.kind = 'booking')
     ORDER BY bk.created_at
  LOOP
    v_paid := b.paid_amount;
    v_refunded := coalesce((SELECT sum(r.amount) FROM public.payment_refunds r
                             WHERE r.booking_id = b.id AND r.status = 'succeeded'), 0);
    v_keep := round((b.price_estimate + b.platform_fee) * greatest(v_paid - v_refunded, 0) / v_paid, 2);
    IF v_keep <= 0 THEN CONTINUE; END IF;
    IF v_refunded = 0 THEN
      v_amt := public.white_label_line(v_inv.id, 'Moving service (subcontract), booking ' || left(b.id::text, 8)
                 || coalesce(', ' || to_char(b.move_date AT TIME ZONE 'Europe/Oslo', 'DD.MM.YYYY'), ''),
                 round(b.price_estimate / 1.25, 2), b.id)
             + public.white_label_line(v_inv.id, 'Platform fee, booking ' || left(b.id::text, 8), round(b.platform_fee / 1.25, 2));
    ELSE
      v_amt := public.white_label_line(v_inv.id, 'Moving service and platform fee kept after refund, booking ' || left(b.id::text, 8),
                 round(v_keep / 1.25, 2), b.id);
    END IF;
    INSERT INTO public.white_label_charges (organization_id, invoice_id, kind, plan_code, booking_id, total, collected)
    VALUES (p_org, v_inv.id, 'booking', p.code, b.id, v_amt, v_amt);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.invoice_lines WHERE invoice_id = v_inv.id) THEN
    DELETE FROM public.invoices WHERE id = v_inv.id;
    RETURN NULL;
  END IF;
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    delivery_from = least(v_today, (SELECT min(period) FROM public.white_label_charges WHERE invoice_id = v_inv.id)),
    delivery_to   = greatest(v_today, (SELECT max((period + interval '1 month' - interval '1 day')::date)
                                         FROM public.white_label_charges WHERE invoice_id = v_inv.id))
   WHERE id = v_inv.id RETURNING * INTO v_inv;
  RETURN v_inv;
END $$;

-- After issue: the part already collected through Stripe is recorded as
-- paid, once.
CREATE OR REPLACE FUNCTION public.settle_white_label_invoice(p_invoice uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inv public.invoices%ROWTYPE; v_collected numeric;
BEGIN
  PERFORM public.require_billing_operator();
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice;
  v_collected := coalesce((SELECT sum(collected) FROM public.white_label_charges WHERE invoice_id = p_invoice), 0);
  IF v_collected > 0 AND v_inv.status <> 'draft'
     AND NOT EXISTS (SELECT 1 FROM public.invoice_payments WHERE invoice_id = p_invoice AND method = 'platform_fee') THEN
    v_inv := public.record_invoice_payment(p_invoice, least(v_collected, public.invoice_outstanding(v_inv)),
                                           v_inv.issue_date, 'platform_fee', 'Kept from customer payments (Stripe Connect)');
  END IF;
  RETURN v_inv;
END $$;


-- ── 7. Who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.white_label_event(uuid, text, jsonb),
  public.white_label_missing(uuid, text),
  public.request_white_label(uuid, text),
  public.set_white_label_brand(uuid, text, text, text, text, text, text, text, text, numeric),
  public.set_white_label_domain(uuid, text),
  public.mark_white_label_domain_verified(uuid, text),
  public.accept_white_label_dpa(uuid, text),
  public.set_white_label_stripe_account(uuid, text, boolean),
  public.end_white_label(uuid, text),
  public.admin_decide_white_label(uuid, boolean, text),
  public.admin_set_white_label_status(uuid, text, text),
  public.admin_update_white_label_plan(text, numeric, numeric, numeric, numeric, boolean, boolean),
  public.white_label_public(text, text),
  public.white_label_stats(uuid),
  public.create_white_label_invoice(uuid, date),
  public.settle_white_label_invoice(uuid)
FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.white_label_event(uuid, text, jsonb), public.white_label_public(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION
  public.white_label_missing(uuid, text),
  public.request_white_label(uuid, text),
  public.set_white_label_brand(uuid, text, text, text, text, text, text, text, text, numeric),
  public.set_white_label_domain(uuid, text),
  public.accept_white_label_dpa(uuid, text),
  public.end_white_label(uuid, text),
  public.admin_decide_white_label(uuid, boolean, text),
  public.admin_set_white_label_status(uuid, text, text),
  public.admin_update_white_label_plan(text, numeric, numeric, numeric, numeric, boolean, boolean),
  public.white_label_stats(uuid),
  public.create_white_label_invoice(uuid, date),
  public.settle_white_label_invoice(uuid),
  public.mark_white_label_domain_verified(uuid, text),
  public.set_white_label_stripe_account(uuid, text, boolean)
TO authenticated, service_role;
-- The public page reads through the server (it adds a signed logo link).
GRANT EXECUTE ON FUNCTION public.white_label_public(text, text) TO service_role;

-- ============================================================================
-- DONE
-- ============================================================================
