-- ============================================================================
-- FlyttGo — Online shops: a company sells goods from its own page
-- ============================================================================
--
-- NOT YET APPLIED ANYWHERE. Runs after 00015 (docs/SERVICE_PLATFORM.md).
-- For companies whose plan has the module 'shop'. The company is the
-- seller (Model B, as everywhere outside transport): the customer pays by
-- card into the company's own Stripe account, and FlyttGo takes no fee
-- from the sale (the company pays for its plan).
--
--   * Catalogue: products (name, description, images in storage, price
--     incl. MVA, the MVA rate, SKU, active), optional simple variants
--     (size, colour…), and stock counted when "track stock" is on.
--     Visitors browse without signing in.
--   * Orders: a signed-in customer orders from the cart with the delivery
--     the company offers (pickup, or shipping at its flat rate). The
--     products are locked in one order and stock is taken atomically, so
--     it never goes below zero; an order not paid in time expires and its
--     stock comes back. Paid by card (shop-checkout, stripe-webhook):
--     recorded once, only when the account and the amount match. Each
--     paid order gets a receipt in the company's name (00011).
--   * Consumers (angrerettloven): the seller, the total incl. MVA and
--     delivery and the 14-day right of withdrawal are shown; the customer
--     withdraws with a form that is recorded; the company refunds through
--     Stripe on its own account (shop-refund) and the receipt is credited.
--   * Statuses: awaiting payment, paid, packed, shipped or ready for
--     pickup, delivered or collected, returned, refunded; or cancelled.
--
-- Safe to re-run.
-- ============================================================================


-- ── 1. The module ───────────────────────────────────────────────────────────
-- Plans may carry 'shop', and a sales invoice may come from a shop order.
-- The lists are extended where they are (whatever an earlier migration has
-- added to them), so the rollback can take back exactly this.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.white_label_plans'::regclass AND conname = 'white_label_plans_modules_check';
  IF v_def IS NULL OR strpos(v_def, 'modules <@ ARRAY[') = 0 THEN
    RAISE EXCEPTION 'shop: white_label_plans_modules_check (00010) not found';
  END IF;
  IF v_def NOT LIKE '%''shop''::text%' THEN
    ALTER TABLE public.white_label_plans DROP CONSTRAINT white_label_plans_modules_check;
    EXECUTE 'ALTER TABLE public.white_label_plans ADD CONSTRAINT white_label_plans_modules_check '
         || replace(v_def, 'modules <@ ARRAY[', 'modules <@ ARRAY[''shop''::text, ');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.invoices'::regclass AND conname = 'invoices_source_type_check';
  IF v_def IS NULL OR strpos(v_def, 'source_type = ANY (ARRAY[') = 0 THEN
    RAISE EXCEPTION 'shop: invoices_source_type_check (00011) not found';
  END IF;
  IF v_def NOT LIKE '%''shop_order''::text%' THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_source_type_check;
    EXECUTE 'ALTER TABLE public.invoices ADD CONSTRAINT invoices_source_type_check '
         || replace(v_def, 'source_type = ANY (ARRAY[', 'source_type = ANY (ARRAY[''shop_order''::text, ');
  END IF;
END $$;

-- The plan. The price is a proposal until FlyttGo confirms it (Admin →
-- White label), as for the plans of 00010. Card payments are the only way
-- to pay, so the company's own Stripe account is required.
INSERT INTO public.white_label_plans (code, name, seller_model, summary, for_whom, setup_fee, monthly_fee, own_domain,
                                      features, flyttgo_does, company_does, requirements, sort, modules, industries,
                                      requires_stripe)
SELECT * FROM (VALUES
  ('shop', 'Online shop', 'company',
   'Sell your products from your own page: catalogue, stock, card payment into your Stripe account, receipts and returns.',
   'Shops and other companies that sell goods: clothes, gifts, food and drink, equipment, their own products.',
   2900::numeric, 990::numeric, false,
   ARRAY['A catalogue with pictures, variants (size, colour) and stock',
         'Cart and checkout for signed-in customers, pickup or shipping at your price',
         'Card payment into your own Stripe account; no fee to FlyttGo per sale',
         'A receipt in your name for every order, credit notes for returns',
         'The 14-day right of withdrawal: the customer''s form, your returns and refunds',
         'A website from the template library'],
   ARRAY['Runs the shop, the payments page and the invoicing system',
         'Processes your customers'' data for you under the data processing agreement',
         'Invoices you monthly for the plan'],
   ARRAY['Is the seller: the goods, delivery, returns, complaints and guarantees',
         'Its shop terms (with the right of withdrawal), privacy notice and its own accounts'],
   ARRAY['An active (verified) company', 'Customer service email and phone', 'Your shop terms and privacy notice (web addresses)',
         'The data processing agreement, accepted by an owner', 'A connected Stripe account that can take payments',
         'Your invoice settings (the seller on the receipts)'],
   70, ARRAY['shop', 'sales_invoicing'],
   ARRAY['retail', 'hospitality', 'field_service', 'appointments', 'software_education', 'nonprofit', 'other'],
   true)
) AS v(code, name, seller_model, summary, for_whom, setup_fee, monthly_fee, own_domain, features, flyttgo_does,
       company_does, requirements, sort, modules, industries, requires_stripe)
WHERE NOT EXISTS (SELECT 1 FROM public.white_label_plans p WHERE p.code = v.code);


-- ── 2. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shop_settings (
  organization_id      uuid        PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  pickup_enabled       boolean     NOT NULL DEFAULT true,
  pickup_address       text        CHECK (pickup_address IS NULL OR char_length(btrim(pickup_address)) BETWEEN 3 AND 200),
  pickup_note          text        CHECK (pickup_note IS NULL OR char_length(pickup_note) <= 300),     -- opening hours
  shipping_enabled     boolean     NOT NULL DEFAULT false,
  shipping_price       numeric     NOT NULL DEFAULT 0 CHECK (shipping_price >= 0 AND shipping_price < 100000),   -- incl. MVA
  shipping_vat_rate    numeric     NOT NULL DEFAULT 25 CHECK (shipping_vat_rate IN (0, 12, 15, 25)),
  free_shipping_over   numeric     CHECK (free_shipping_over IS NULL OR free_shipping_over > 0),   -- items incl. MVA
  shipping_note        text        CHECK (shipping_note IS NULL OR char_length(shipping_note) <= 300), -- carrier, delivery time
  return_cost_customer boolean     NOT NULL DEFAULT true,       -- the customer pays to send withdrawn goods back (stated at checkout)
  payment_minutes      integer     NOT NULL DEFAULT 60 CHECK (payment_minutes BETWEEN 30 AND 1440),   -- stock is held this long
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_settings_delivery CHECK (pickup_enabled OR shipping_enabled),
  CONSTRAINT shop_settings_pickup_address CHECK (NOT pickup_enabled OR pickup_address IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.shop_products (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  description     text        CHECK (description IS NULL OR char_length(description) <= 5000),
  price           numeric     NOT NULL CHECK (price > 0 AND price < 10000000 AND price = round(price, 2)),   -- incl. MVA
  vat_rate        numeric     NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 12, 15, 25)),
  sku             text        CHECK (sku IS NULL OR sku ~ '^[A-Za-z0-9._/-]{1,40}$'),
  images          text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(images) <= 8),      -- paths in shop-product-images
  variant_label   text        CHECK (variant_label IS NULL OR char_length(btrim(variant_label)) BETWEEN 1 AND 40),   -- "Size"
  track_stock     boolean     NOT NULL DEFAULT false,
  stock           integer     NOT NULL DEFAULT 0 CHECK (stock >= 0),      -- free to sell: held orders are already taken off
  active          boolean     NOT NULL DEFAULT true,
  sort            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_products_org_idx ON public.shop_products (organization_id, sort);
CREATE UNIQUE INDEX IF NOT EXISTS shop_products_sku_key ON public.shop_products (organization_id, sku) WHERE sku IS NOT NULL;

-- A product with active variants is ordered as one of them; each has its
-- own stock (when the product tracks stock) and may have its own price.
CREATE TABLE IF NOT EXISTS public.shop_variants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid        NOT NULL REFERENCES public.shop_products (id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  sku             text        CHECK (sku IS NULL OR sku ~ '^[A-Za-z0-9._/-]{1,40}$'),
  price           numeric     CHECK (price IS NULL OR (price > 0 AND price < 10000000 AND price = round(price, 2))),   -- else the product's
  stock           integer     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active          boolean     NOT NULL DEFAULT true,
  sort            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, name)
);
CREATE INDEX IF NOT EXISTS shop_variants_product_idx ON public.shop_variants (product_id, sort);

CREATE TABLE IF NOT EXISTS public.shop_orders (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  number               integer     NOT NULL,
  customer_user_id     uuid        NOT NULL,
  customer             jsonb       NOT NULL,                     -- name, phone, email
  delivery_method      text        NOT NULL CHECK (delivery_method IN ('pickup', 'shipping')),
  delivery_address     jsonb,                                    -- shipping: address, postcode, city
  items_total          numeric     NOT NULL,                     -- incl. MVA
  delivery_price       numeric     NOT NULL DEFAULT 0,           -- incl. MVA
  delivery_vat_rate    numeric     NOT NULL DEFAULT 25,
  total                numeric     NOT NULL CHECK (total > 0),   -- incl. MVA and delivery: what is paid
  status               text        NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
                         'awaiting_payment', 'paid', 'packed', 'shipped', 'ready_for_pickup', 'delivered', 'collected',
                         'returned', 'refunded', 'cancelled')),
  expires_at           timestamptz NOT NULL,                     -- unpaid by then: cancelled, stock back
  checkout_count       integer     NOT NULL DEFAULT 0,
  connected_account_id text,                                     -- the company's Stripe account, when ordered
  stripe_session_id    text,
  payment_intent_id    text,
  paid_amount          numeric,
  paid_at              timestamptz,
  payment_review       text,                                     -- a payment the company must look at (and refund)
  invoice_id           uuid        REFERENCES public.invoices (id),
  invoice_error        text,
  confirmation_sent_at timestamptz,
  tracking             text,                                     -- carrier and reference, when shipped
  delivered_at         timestamptz,                              -- delivered or collected: the 14 days start
  refunded_amount      numeric     NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  delivery_refunded    boolean     NOT NULL DEFAULT false,
  cancelled_at         timestamptz,
  cancelled_by         text        CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'company', 'expired')),
  cancel_reason        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  CONSTRAINT shop_orders_address CHECK (delivery_method = 'pickup' OR delivery_address IS NOT NULL),
  CONSTRAINT shop_orders_refund CHECK (refunded_amount <= coalesce(paid_amount, 0))
);
CREATE INDEX IF NOT EXISTS shop_orders_org_idx ON public.shop_orders (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_orders_customer_idx ON public.shop_orders (customer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_orders_expiry_idx ON public.shop_orders (expires_at) WHERE status = 'awaiting_payment';
-- One payment pays one order.
CREATE UNIQUE INDEX IF NOT EXISTS shop_orders_payment_key ON public.shop_orders (payment_intent_id) WHERE payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.shop_order_lines (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid    NOT NULL REFERENCES public.shop_orders (id) ON DELETE CASCADE,
  line_no           integer NOT NULL,
  product_id        uuid    NOT NULL REFERENCES public.shop_products (id),
  variant_id        uuid    REFERENCES public.shop_variants (id),
  name              text    NOT NULL,                            -- as sold, with the variant
  sku               text,
  quantity          integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  unit_price        numeric NOT NULL,                            -- incl. MVA
  vat_rate          numeric NOT NULL,
  total             numeric NOT NULL,
  stock_reserved    boolean NOT NULL DEFAULT false,              -- taken from a tracked stock
  refunded_quantity integer NOT NULL DEFAULT 0,
  UNIQUE (order_id, line_no),
  CONSTRAINT shop_order_lines_refunded CHECK (refunded_quantity BETWEEN 0 AND quantity)
);
CREATE INDEX IF NOT EXISTS shop_order_lines_product_idx ON public.shop_order_lines (product_id);

CREATE TABLE IF NOT EXISTS public.shop_order_events (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   uuid        NOT NULL REFERENCES public.shop_orders (id) ON DELETE CASCADE,
  actor_id   uuid,
  action     text        NOT NULL,
  details    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_order_events_idx ON public.shop_order_events (order_id, created_at);
DROP TRIGGER IF EXISTS guard_shop_order_events ON public.shop_order_events;
CREATE TRIGGER guard_shop_order_events BEFORE UPDATE OR DELETE ON public.shop_order_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();

-- The customer's notice that they withdraw from the purchase
-- (angrerettloven § 20), as they sent it, with whether it was within 14
-- days of receiving the goods.
CREATE TABLE IF NOT EXISTS public.shop_withdrawals (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid        NOT NULL REFERENCES public.shop_orders (id) ON DELETE CASCADE,
  organization_id  uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  customer_user_id uuid        NOT NULL,
  lines            jsonb       NOT NULL,                         -- [{line_id, quantity}]
  message          text        CHECK (message IS NULL OR char_length(message) <= 2000),
  within_period    boolean     NOT NULL,
  status           text        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'received', 'refunded', 'rejected')),
  handled_by       uuid,
  handled_at       timestamptz,
  note             text,
  requested_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_withdrawals_order_idx ON public.shop_withdrawals (order_id);

-- Refunds through Stripe on the company's account: one live per order, the
-- same idempotency key on every retry, effects once Stripe confirms.
CREATE TABLE IF NOT EXISTS public.shop_refunds (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid        NOT NULL REFERENCES public.shop_orders (id) ON DELETE CASCADE,
  withdrawal_id      uuid        REFERENCES public.shop_withdrawals (id),
  amount             numeric     NOT NULL CHECK (amount > 0),
  lines              jsonb       NOT NULL,                       -- [{line_id, quantity}]
  delivery           boolean     NOT NULL DEFAULT false,         -- the delivery price refunded too
  restock            boolean     NOT NULL DEFAULT false,         -- the goods go back into stock
  reason             text        NOT NULL,
  status             text        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'pending', 'succeeded', 'failed')),
  idempotency_key    text        NOT NULL UNIQUE,
  provider_refund_id text,
  error              text,
  credit_note_id     uuid        REFERENCES public.invoices (id),
  requested_by       uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shop_refunds_live ON public.shop_refunds (order_id) WHERE status IN ('requested', 'pending');

-- Product pictures: public (the catalogue is), written by the company's
-- owners and admins in its own folder (<organization id>/…), as logos.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'shop-product-images', 'shop-product-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'shop-product-images');
DROP POLICY IF EXISTS shop_product_images_read ON storage.objects;
CREATE POLICY shop_product_images_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'shop-product-images' AND public.org_folder_member(name));
DROP POLICY IF EXISTS shop_product_images_write ON storage.objects;
CREATE POLICY shop_product_images_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'shop-product-images' AND public.org_folder_member(name, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS shop_product_images_update ON storage.objects;
CREATE POLICY shop_product_images_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'shop-product-images' AND public.org_folder_member(name, ARRAY['owner', 'admin']));
DROP POLICY IF EXISTS shop_product_images_delete ON storage.objects;
CREATE POLICY shop_product_images_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'shop-product-images' AND public.org_folder_member(name, ARRAY['owner', 'admin']));


-- ── 3. Who reads what ───────────────────────────────────────────────────────
-- An order: its customer, the company's members (any role: staff pack and
-- ship), FlyttGo's administrators.
CREATE OR REPLACE FUNCTION public.can_read_shop_order(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.shop_orders o
     WHERE o.id = p_id AND (o.customer_user_id = auth.uid() OR public.is_org_member(o.organization_id)));
$$;

ALTER TABLE public.shop_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_products     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_variants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_order_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_withdrawals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_refunds      ENABLE ROW LEVEL SECURITY;

-- The catalogue and the delivery options, for visitors.
DROP POLICY IF EXISTS shop_settings_public ON public.shop_settings;
CREATE POLICY shop_settings_public ON public.shop_settings FOR SELECT TO anon
  USING (public.org_has_module(organization_id, 'shop'));
DROP POLICY IF EXISTS shop_settings_select ON public.shop_settings;
CREATE POLICY shop_settings_select ON public.shop_settings FOR SELECT TO authenticated
  USING (public.org_has_module(organization_id, 'shop') OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS shop_products_public ON public.shop_products;
CREATE POLICY shop_products_public ON public.shop_products FOR SELECT TO anon
  USING (active AND public.org_has_module(organization_id, 'shop'));
DROP POLICY IF EXISTS shop_products_select ON public.shop_products;
CREATE POLICY shop_products_select ON public.shop_products FOR SELECT TO authenticated
  USING ((active AND public.org_has_module(organization_id, 'shop')) OR public.is_admin() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS shop_variants_public ON public.shop_variants;
CREATE POLICY shop_variants_public ON public.shop_variants FOR SELECT TO anon
  USING (active AND EXISTS (SELECT 1 FROM public.shop_products p WHERE p.id = product_id));
DROP POLICY IF EXISTS shop_variants_select ON public.shop_variants;
CREATE POLICY shop_variants_select ON public.shop_variants FOR SELECT TO authenticated
  USING ((active AND EXISTS (SELECT 1 FROM public.shop_products p WHERE p.id = product_id))
         OR public.is_admin() OR public.is_org_member(organization_id));

DROP POLICY IF EXISTS shop_orders_select ON public.shop_orders;
CREATE POLICY shop_orders_select ON public.shop_orders FOR SELECT TO authenticated USING (public.can_read_shop_order(id));
DROP POLICY IF EXISTS shop_order_lines_select ON public.shop_order_lines;
CREATE POLICY shop_order_lines_select ON public.shop_order_lines FOR SELECT TO authenticated USING (public.can_read_shop_order(order_id));
DROP POLICY IF EXISTS shop_order_events_select ON public.shop_order_events;
CREATE POLICY shop_order_events_select ON public.shop_order_events FOR SELECT TO authenticated USING (public.can_read_shop_order(order_id));
DROP POLICY IF EXISTS shop_withdrawals_select ON public.shop_withdrawals;
CREATE POLICY shop_withdrawals_select ON public.shop_withdrawals FOR SELECT TO authenticated USING (public.can_read_shop_order(order_id));
DROP POLICY IF EXISTS shop_refunds_select ON public.shop_refunds;
CREATE POLICY shop_refunds_select ON public.shop_refunds FOR SELECT TO authenticated USING (public.can_read_shop_order(order_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.shop_settings, public.shop_products, public.shop_variants, public.shop_orders,
  public.shop_order_lines, public.shop_order_events, public.shop_withdrawals, public.shop_refunds FROM anon, authenticated;
REVOKE ALL ON public.shop_orders, public.shop_order_lines, public.shop_order_events, public.shop_withdrawals, public.shop_refunds FROM anon;


-- ── 4. The company's catalogue ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.shop_event(p_order uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.shop_order_events (order_id, actor_id, action, details)
  VALUES (p_order, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.save_shop_settings(p_org uuid, p jsonb)
RETURNS public.shop_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.shop_settings%ROWTYPE;
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  INSERT INTO public.shop_settings AS t (organization_id, pickup_enabled, pickup_address, pickup_note, shipping_enabled, shipping_price,
                                         shipping_vat_rate, free_shipping_over, shipping_note, return_cost_customer, payment_minutes)
  VALUES (p_org, coalesce((p ->> 'pickup_enabled')::boolean, true), nullif(btrim(p ->> 'pickup_address'), ''),
          nullif(btrim(p ->> 'pickup_note'), ''), coalesce((p ->> 'shipping_enabled')::boolean, false),
          coalesce(nullif(p ->> 'shipping_price', '')::numeric, 0), coalesce(nullif(p ->> 'shipping_vat_rate', '')::numeric, 25),
          nullif(p ->> 'free_shipping_over', '')::numeric, nullif(btrim(p ->> 'shipping_note'), ''),
          coalesce((p ->> 'return_cost_customer')::boolean, true), coalesce(nullif(p ->> 'payment_minutes', '')::int, 60))
  ON CONFLICT (organization_id) DO UPDATE SET
    pickup_enabled = EXCLUDED.pickup_enabled, pickup_address = EXCLUDED.pickup_address, pickup_note = EXCLUDED.pickup_note,
    shipping_enabled = EXCLUDED.shipping_enabled, shipping_price = EXCLUDED.shipping_price,
    shipping_vat_rate = EXCLUDED.shipping_vat_rate, free_shipping_over = EXCLUDED.free_shipping_over,
    shipping_note = EXCLUDED.shipping_note, return_cost_customer = EXCLUDED.return_cost_customer,
    payment_minutes = EXCLUDED.payment_minutes, updated_at = now()
  RETURNING * INTO s;
  RETURN s;
END $$;

-- A company registered for MVA charges it at the product's rate; one that
-- is not charges none (rate 0).
CREATE OR REPLACE FUNCTION public.shop_check_vat(p_org uuid, p_rate numeric)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(p_rate, 25) <> 0 AND NOT coalesce((SELECT vat_registered FROM public.organizations WHERE id = p_org), false) THEN
    RAISE EXCEPTION 'shop: only a company registered for MVA charges MVA; set the rate to 0' USING ERRCODE = '22023';
  END IF;
END $$;

-- A product: p = {name, description, price (incl. MVA), vat_rate, sku,
-- images: [paths in the company's folder], variant_label, track_stock,
-- stock, active, sort}.
CREATE OR REPLACE FUNCTION public.save_shop_product(p_org uuid, p_id uuid, p jsonb)
RETURNS public.shop_products
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.shop_products%ROWTYPE; v_images text[]; v_rate numeric := coalesce(nullif(p ->> 'vat_rate', '')::numeric, 25);
BEGIN
  PERFORM public.require_org_role(p_org, ARRAY['owner', 'admin']);
  PERFORM public.shop_check_vat(p_org, v_rate);
  v_images := coalesce(ARRAY(SELECT jsonb_array_elements_text(p -> 'images')), '{}');
  IF EXISTS (SELECT 1 FROM unnest(v_images) i WHERE split_part(i, '/', 1) <> p_org::text) THEN
    RAISE EXCEPTION 'shop: pictures must be in the company''s own folder' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.shop_products (organization_id, name, description, price, vat_rate, sku, images, variant_label, track_stock,
                                      stock, active, sort)
    VALUES (p_org, btrim(p ->> 'name'), nullif(btrim(p ->> 'description'), ''), (p ->> 'price')::numeric, v_rate,
            nullif(btrim(p ->> 'sku'), ''), v_images, nullif(btrim(p ->> 'variant_label'), ''),
            coalesce((p ->> 'track_stock')::boolean, false), coalesce(nullif(p ->> 'stock', '')::int, 0),
            coalesce((p ->> 'active')::boolean, true), coalesce(nullif(p ->> 'sort', '')::int, 0))
    RETURNING * INTO r;
  ELSE
    UPDATE public.shop_products SET name = btrim(p ->> 'name'), description = nullif(btrim(p ->> 'description'), ''),
           price = (p ->> 'price')::numeric, vat_rate = v_rate, sku = nullif(btrim(p ->> 'sku'), ''), images = v_images,
           variant_label = nullif(btrim(p ->> 'variant_label'), ''), track_stock = coalesce((p ->> 'track_stock')::boolean, false),
           stock = coalesce(nullif(p ->> 'stock', '')::int, stock), active = coalesce((p ->> 'active')::boolean, true),
           sort = coalesce(nullif(p ->> 'sort', '')::int, 0), updated_at = now()
     WHERE id = p_id AND organization_id = p_org RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such product' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN r;
END $$;

-- A variant of a product: p = {name, sku, price (empty: the product's),
-- stock, active, sort}.
CREATE OR REPLACE FUNCTION public.save_shop_variant(p_product uuid, p_id uuid, p jsonb)
RETURNS public.shop_variants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_org uuid; r public.shop_variants%ROWTYPE;
BEGIN
  SELECT organization_id INTO v_org FROM public.shop_products WHERE id = p_product;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such product' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.require_org_role(v_org, ARRAY['owner', 'admin']);
  IF p_id IS NULL THEN
    INSERT INTO public.shop_variants (product_id, organization_id, name, sku, price, stock, active, sort)
    VALUES (p_product, v_org, btrim(p ->> 'name'), nullif(btrim(p ->> 'sku'), ''), nullif(p ->> 'price', '')::numeric,
            coalesce(nullif(p ->> 'stock', '')::int, 0), coalesce((p ->> 'active')::boolean, true), coalesce(nullif(p ->> 'sort', '')::int, 0))
    RETURNING * INTO r;
  ELSE
    UPDATE public.shop_variants SET name = btrim(p ->> 'name'), sku = nullif(btrim(p ->> 'sku'), ''),
           price = nullif(p ->> 'price', '')::numeric, stock = coalesce(nullif(p ->> 'stock', '')::int, stock),
           active = coalesce((p ->> 'active')::boolean, true), sort = coalesce(nullif(p ->> 'sort', '')::int, 0)
     WHERE id = p_id AND product_id = p_product RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such variant' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN r;
END $$;

-- The stock free to sell, after counting (owners, admins, staff).
CREATE OR REPLACE FUNCTION public.set_shop_stock(p_product uuid, p_variant uuid, p_stock integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.shop_products WHERE id = p_product;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such product' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.require_org_role(v_org, ARRAY['owner', 'admin', 'staff']);
  IF p_stock IS NULL OR p_stock < 0 THEN RAISE EXCEPTION 'shop: stock is 0 or more' USING ERRCODE = '22023'; END IF;
  IF p_variant IS NULL THEN
    UPDATE public.shop_products SET stock = p_stock, updated_at = now() WHERE id = p_product;
  ELSE
    UPDATE public.shop_variants SET stock = p_stock WHERE id = p_variant AND product_id = p_product;
    IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such variant' USING ERRCODE = 'P0002'; END IF;
  END IF;
END $$;


-- ── 5. Prices, stock and the order ──────────────────────────────────────────
-- Locks the products and then the variants, each in id order, so orders,
-- expiries and refunds touching the same stock queue instead of
-- deadlocking.
CREATE OR REPLACE FUNCTION public.shop_lock_items(p_products uuid[], p_variants uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.shop_products WHERE id = ANY (p_products) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.shop_variants WHERE id = ANY (coalesce(p_variants, '{}')) ORDER BY id FOR UPDATE;
END $$;

-- What a cart costs, from the catalogue (never the browser's prices):
-- p_items [{product_id, variant_id, quantity}], p_delivery 'pickup' or
-- 'shipping'. Prices incl. MVA; the total is what is paid.
CREATE OR REPLACE FUNCTION public.shop_compute(p_org uuid, p_items jsonb, p_delivery text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  cfg public.shop_settings%ROWTYPE;
  pr  public.shop_products%ROWTYPE;
  va  public.shop_variants%ROWTYPE;
  it  record;
  v_lines jsonb := '[]'::jsonb;
  v_items numeric := 0;
  v_price numeric;
  v_delivery numeric := 0;
BEGIN
  IF NOT public.org_has_module(p_org, 'shop') THEN RAISE EXCEPTION 'shop: this shop is not open' USING ERRCODE = '55000'; END IF;
  SELECT * INTO cfg FROM public.shop_settings WHERE organization_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: this shop is not open' USING ERRCODE = '55000'; END IF;
  IF p_delivery IS NULL OR p_delivery NOT IN ('pickup', 'shipping')
     OR (p_delivery = 'pickup' AND NOT cfg.pickup_enabled) OR (p_delivery = 'shipping' AND NOT cfg.shipping_enabled) THEN
    RAISE EXCEPTION 'shop: choose a delivery the shop offers' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'shop: the cart is empty' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN RAISE EXCEPTION 'shop: at most 100 lines in one order' USING ERRCODE = '22023'; END IF;
  FOR it IN SELECT (e ->> 'product_id')::uuid AS product_id, nullif(e ->> 'variant_id', '')::uuid AS variant_id,
                   sum((e ->> 'quantity')::int) AS quantity
              FROM jsonb_array_elements(p_items) e GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    SELECT * INTO pr FROM public.shop_products WHERE id = it.product_id AND organization_id = p_org AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'shop: a product in the cart is no longer sold' USING ERRCODE = '55000'; END IF;
    IF it.quantity IS NULL OR it.quantity < 1 OR it.quantity > 999 THEN
      RAISE EXCEPTION 'shop: a quantity from 1 to 999' USING ERRCODE = '22023';
    END IF;
    va := NULL;
    IF it.variant_id IS NOT NULL THEN
      SELECT * INTO va FROM public.shop_variants WHERE id = it.variant_id AND product_id = pr.id AND active;
      IF NOT FOUND THEN RAISE EXCEPTION 'shop: % is no longer sold in that variant', pr.name USING ERRCODE = '55000'; END IF;
    ELSIF EXISTS (SELECT 1 FROM public.shop_variants WHERE product_id = pr.id AND active) THEN
      RAISE EXCEPTION 'shop: choose % for %', lower(coalesce(pr.variant_label, 'a variant')), pr.name USING ERRCODE = '22023';
    END IF;
    IF pr.track_stock AND it.quantity > coalesce(va.stock, pr.stock) THEN
      RAISE EXCEPTION 'shop: only % of % left', coalesce(va.stock, pr.stock), pr.name || coalesce(' (' || va.name || ')', '')
        USING ERRCODE = '55000';
    END IF;
    v_price := coalesce(va.price, pr.price);
    v_items := v_items + v_price * it.quantity;
    v_lines := v_lines || jsonb_build_object(
      'product_id', pr.id, 'variant_id', va.id, 'name', pr.name || coalesce(' (' || va.name || ')', ''),
      'sku', coalesce(va.sku, pr.sku), 'quantity', it.quantity, 'unit_price', v_price, 'vat_rate', pr.vat_rate,
      'total', v_price * it.quantity, 'track', pr.track_stock);
  END LOOP;
  IF p_delivery = 'shipping' THEN
    v_delivery := CASE WHEN cfg.free_shipping_over IS NOT NULL AND v_items >= cfg.free_shipping_over THEN 0 ELSE cfg.shipping_price END;
  END IF;
  RETURN jsonb_build_object('lines', v_lines, 'items_total', v_items, 'delivery_method', p_delivery,
                            'delivery_price', v_delivery, 'delivery_vat_rate', cfg.shipping_vat_rate,
                            'total', v_items + v_delivery, 'payment_minutes', cfg.payment_minutes);
END $$;

-- The price of a cart before ordering (visitors too): the same
-- computation the order uses.
CREATE OR REPLACE FUNCTION public.shop_quote(p_org uuid, p_items jsonb, p_delivery text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.shop_compute(p_org, p_items, p_delivery); $$;

-- Puts the stock of an order's held lines back (expired, cancelled).
CREATE OR REPLACE FUNCTION public.shop_release_stock(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l record;
BEGIN
  PERFORM public.shop_lock_items(ARRAY(SELECT product_id FROM public.shop_order_lines WHERE order_id = p_order AND stock_reserved),
                                 ARRAY(SELECT variant_id FROM public.shop_order_lines WHERE order_id = p_order AND stock_reserved AND variant_id IS NOT NULL));
  FOR l IN SELECT * FROM public.shop_order_lines WHERE order_id = p_order AND stock_reserved LOOP
    IF l.variant_id IS NOT NULL THEN
      UPDATE public.shop_variants SET stock = stock + l.quantity WHERE id = l.variant_id;
    ELSE
      UPDATE public.shop_products SET stock = stock + l.quantity, updated_at = now() WHERE id = l.product_id;
    END IF;
  END LOOP;
  UPDATE public.shop_order_lines SET stock_reserved = false WHERE order_id = p_order AND stock_reserved;
END $$;

-- Unpaid orders past their time: cancelled, stock back. One company's
-- (before it takes an order, with the cart's items: everything is locked
-- in one go, in order) or all (the scheduled job).
CREATE OR REPLACE FUNCTION public.shop_expire(p_org uuid, p_products uuid[] DEFAULT '{}', p_variants uuid[] DEFAULT '{}')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_ids uuid[]; v_id uuid;
BEGIN
  v_ids := ARRAY(SELECT id FROM public.shop_orders
                  WHERE status = 'awaiting_payment' AND expires_at < now() AND (p_org IS NULL OR organization_id = p_org)
                  ORDER BY id FOR UPDATE SKIP LOCKED);
  PERFORM public.shop_lock_items(
    coalesce(p_products, '{}') || ARRAY(SELECT product_id FROM public.shop_order_lines WHERE order_id = ANY (v_ids) AND stock_reserved),
    coalesce(p_variants, '{}') || ARRAY(SELECT variant_id FROM public.shop_order_lines
                                         WHERE order_id = ANY (v_ids) AND stock_reserved AND variant_id IS NOT NULL));
  FOREACH v_id IN ARRAY v_ids LOOP
    UPDATE public.shop_orders SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'expired',
           cancel_reason = 'not paid in time', updated_at = now()
     WHERE id = v_id;
    PERFORM public.shop_release_stock(v_id);
    PERFORM public.shop_event(v_id, 'order.expired', '{}'::jsonb);
  END LOOP;
  RETURN cardinality(v_ids);
END $$;

CREATE OR REPLACE FUNCTION public.expire_shop_orders()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'shop: the server only' USING ERRCODE = '42501'; END IF;
  RETURN public.shop_expire(NULL);
END $$;

-- A signed-in customer orders the cart. p_contact {name, phone, email};
-- p_address {address, postcode, city} for shipping. The stock is taken
-- now and held until the order is paid or expires.
CREATE OR REPLACE FUNCTION public.place_shop_order(p_org uuid, p_items jsonb, p_delivery text, p_address jsonb, p_contact jsonb)
RETURNS public.shop_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v jsonb; l jsonb; o public.shop_orders%ROWTYPE; v_no int; n int := 0;
  v_account text; v_ready boolean; v_seller jsonb; v_addr jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'shop: sign in to order' USING ERRCODE = '42501'; END IF;
  IF NOT public.org_has_module(p_org, 'shop') THEN RAISE EXCEPTION 'shop: this shop is not open' USING ERRCODE = '55000'; END IF;
  SELECT stripe_account_id, stripe_charges_enabled INTO v_account, v_ready
    FROM public.organization_white_label WHERE organization_id = p_org;
  IF v_account IS NULL OR NOT coalesce(v_ready, false) THEN
    RAISE EXCEPTION 'shop: the shop does not take card payments yet' USING ERRCODE = '55000';
  END IF;
  -- Every paid order gets a receipt in the company's name, so the seller's
  -- details must be complete before an order is taken (00011).
  v_seller := public.organization_seller(p_org);
  IF v_seller ->> 'name' IS NULL OR v_seller ->> 'org_number' IS NULL OR v_seller ->> 'bank_account' IS NULL OR v_seller ->> 'address' IS NULL THEN
    RAISE EXCEPTION 'shop: the shop cannot take orders until its invoice settings are complete' USING ERRCODE = '55000';
  END IF;
  IF coalesce(btrim(p_contact ->> 'name'), '') = '' OR coalesce(btrim(p_contact ->> 'phone'), '') = ''
     OR coalesce(btrim(p_contact ->> 'email'), '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'shop: a name, a phone number and an email address are required' USING ERRCODE = '22023';
  END IF;
  IF p_delivery = 'shipping' THEN
    IF coalesce(btrim(p_address ->> 'address'), '') = '' OR coalesce(btrim(p_address ->> 'postcode'), '') !~ '^[0-9]{4}$'
       OR coalesce(btrim(p_address ->> 'city'), '') = '' THEN
      RAISE EXCEPTION 'shop: the delivery address (street, four-digit postcode, place)' USING ERRCODE = '22023';
    END IF;
    v_addr := jsonb_build_object('address', btrim(p_address ->> 'address'), 'postcode', btrim(p_address ->> 'postcode'),
                                 'city', btrim(p_address ->> 'city'));
  END IF;

  -- The products and variants in the cart, locked: competing orders for the
  -- last items queue here, and each sees the stock the one before left.
  -- Orders nobody paid give their stock back first.
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'shop: the cart is empty' USING ERRCODE = '22023'; END IF;
  PERFORM public.shop_expire(p_org,
    ARRAY(SELECT DISTINCT (e ->> 'product_id')::uuid FROM jsonb_array_elements(p_items) e),
    ARRAY(SELECT DISTINCT nullif(e ->> 'variant_id', '')::uuid FROM jsonb_array_elements(p_items) e WHERE nullif(e ->> 'variant_id', '') IS NOT NULL));
  v := public.shop_compute(p_org, p_items, p_delivery);
  IF (v ->> 'total')::numeric < 3 THEN RAISE EXCEPTION 'shop: the smallest card payment is 3 kr' USING ERRCODE = '22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('shop-orders-no:' || p_org::text));
  SELECT coalesce(max(number), 0) + 1 INTO v_no FROM public.shop_orders WHERE organization_id = p_org;
  INSERT INTO public.shop_orders (organization_id, number, customer_user_id, customer, delivery_method, delivery_address,
                                  items_total, delivery_price, delivery_vat_rate, total, expires_at, connected_account_id)
  VALUES (p_org, v_no, auth.uid(),
          jsonb_build_object('name', btrim(p_contact ->> 'name'), 'phone', btrim(p_contact ->> 'phone'),
                             'email', lower(btrim(p_contact ->> 'email'))),
          p_delivery, v_addr, (v ->> 'items_total')::numeric, (v ->> 'delivery_price')::numeric,
          (v ->> 'delivery_vat_rate')::numeric, (v ->> 'total')::numeric,
          now() + make_interval(mins => (v ->> 'payment_minutes')::int), v_account)
  RETURNING * INTO o;
  FOR l IN SELECT * FROM jsonb_array_elements(v -> 'lines') LOOP
    n := n + 1;
    -- The stock is taken only while enough is left; the CHECK (stock >= 0)
    -- holds it whatever else happens.
    IF (l ->> 'track')::boolean THEN
      IF l ->> 'variant_id' IS NOT NULL THEN
        UPDATE public.shop_variants SET stock = stock - (l ->> 'quantity')::int
         WHERE id = (l ->> 'variant_id')::uuid AND stock >= (l ->> 'quantity')::int;
      ELSE
        UPDATE public.shop_products SET stock = stock - (l ->> 'quantity')::int, updated_at = now()
         WHERE id = (l ->> 'product_id')::uuid AND stock >= (l ->> 'quantity')::int;
      END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'shop: % is sold out', l ->> 'name' USING ERRCODE = '55000'; END IF;
    END IF;
    INSERT INTO public.shop_order_lines (order_id, line_no, product_id, variant_id, name, sku, quantity, unit_price, vat_rate, total, stock_reserved)
    VALUES (o.id, n, (l ->> 'product_id')::uuid, nullif(l ->> 'variant_id', '')::uuid, l ->> 'name', l ->> 'sku',
            (l ->> 'quantity')::int, (l ->> 'unit_price')::numeric, (l ->> 'vat_rate')::numeric, (l ->> 'total')::numeric,
            (l ->> 'track')::boolean);
  END LOOP;
  PERFORM public.shop_event(o.id, 'order.placed', jsonb_build_object('total', o.total, 'delivery', p_delivery));
  RETURN o;
END $$;

-- The order, locked, for the company: its owners, admins and the roles
-- named. Nobody else, not FlyttGo's administrators either (it is the
-- company's business).
CREATE OR REPLACE FUNCTION public.shop_order_for(p_id uuid, p_roles text[])
RETURNS public.shop_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such order' USING ERRCODE = 'P0002'; END IF;
  IF public.is_server() OR public.is_org_member(o.organization_id, p_roles || ARRAY['owner', 'admin']) THEN RETURN o; END IF;
  RAISE EXCEPTION 'shop: requires role %', array_to_string(p_roles || ARRAY['owner', 'admin'], ' or ') USING ERRCODE = '42501';
END $$;

-- An unpaid order is cancelled by the customer or the company and its
-- stock comes back. A paid order is refunded instead.
CREATE OR REPLACE FUNCTION public.cancel_shop_order(p_order uuid, p_reason text)
RETURNS public.shop_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE; v_by text;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such order' USING ERRCODE = 'P0002'; END IF;
  IF o.customer_user_id = auth.uid() AND NOT public.is_org_member(o.organization_id, ARRAY['owner', 'admin', 'staff']) THEN
    v_by := 'customer';
  ELSE
    o := public.shop_order_for(p_order, ARRAY['staff']);
    v_by := 'company';
  END IF;
  IF o.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'shop: the order is %; a paid order is refunded by the shop', replace(o.status, '_', ' ') USING ERRCODE = '55000';
  END IF;
  UPDATE public.shop_orders SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_by,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   WHERE id = p_order RETURNING * INTO o;
  PERFORM public.shop_release_stock(p_order);
  PERFORM public.shop_event(p_order, 'order.cancelled', jsonb_build_object('by', v_by, 'reason', p_reason));
  RETURN o;
END $$;

-- Before a card payment page is opened (shop-checkout, as the server, or
-- the customer): the order must still be waiting (an order past its time
-- comes back cancelled), and its stock is held
-- for at least 33 minutes more, since a Stripe payment page lives at
-- least 30. At most five payment pages per order.
CREATE OR REPLACE FUNCTION public.shop_checkout_begin(p_order uuid)
RETURNS public.shop_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_server() OR o.customer_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'shop: no such order' USING ERRCODE = 'P0002';
  END IF;
  -- Past its time: expired now and returned cancelled (the caller says so;
  -- raising would undo the expiry).
  IF o.status = 'awaiting_payment' AND o.expires_at < now() THEN
    PERFORM public.shop_expire(o.organization_id);
    SELECT * INTO o FROM public.shop_orders WHERE id = p_order;
    RETURN o;
  END IF;
  IF o.status <> 'awaiting_payment' THEN RAISE EXCEPTION 'shop: the order is %', replace(o.status, '_', ' ') USING ERRCODE = '55000'; END IF;
  IF o.checkout_count >= 5 THEN RAISE EXCEPTION 'shop: too many payment attempts; order again' USING ERRCODE = '55000'; END IF;
  UPDATE public.shop_orders SET checkout_count = checkout_count + 1, expires_at = greatest(expires_at, now() + interval '33 minutes'),
         updated_at = now()
   WHERE id = p_order RETURNING * INTO o;
  RETURN o;
END $$;


-- ── 6. Payment and the receipt ──────────────────────────────────────────────
-- The receipt: a sales invoice in the company's name (00011), issued and
-- paid at once. Prices include MVA, so each line's MVA is taken out of its
-- total (as on a till receipt) and the receipt comes to exactly what was
-- paid.
CREATE OR REPLACE FUNCTION public.shop_invoice(p_order uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE; v_inv public.invoices%ROWTYPE; v_lines jsonb;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order FOR UPDATE;
  IF o.invoice_id IS NOT NULL THEN SELECT * INTO v_inv FROM public.invoices WHERE id = o.invoice_id; RETURN v_inv; END IF;
  IF o.paid_at IS NULL THEN RAISE EXCEPTION 'shop: the order is not paid' USING ERRCODE = '55000'; END IF;
  SELECT jsonb_agg(x ORDER BY ord) INTO v_lines FROM (
    SELECT l.line_no AS ord, jsonb_build_object('description', l.name || coalesce(', ' || l.sku, ''), 'quantity', l.quantity,
             'unit_price', round(l.unit_price / (1 + l.vat_rate / 100), 2), 'vat_rate', l.vat_rate, 'gross', l.total) AS x
      FROM public.shop_order_lines l WHERE l.order_id = o.id
    UNION ALL
    SELECT 100000, jsonb_build_object('description', CASE o.delivery_method WHEN 'shipping' THEN 'Delivery' ELSE 'Pickup' END,
             'quantity', 1, 'unit_price', round(o.delivery_price / (1 + o.delivery_vat_rate / 100), 2),
             'vat_rate', o.delivery_vat_rate, 'gross', o.delivery_price)
     WHERE o.delivery_price > 0) s;
  v_inv := public.sales_invoice_draft(o.organization_id,
             o.customer || jsonb_build_object('address', o.delivery_address ->> 'address',
                                              'postcode_city', nullif(btrim(coalesce(o.delivery_address ->> 'postcode', '') || ' ' || coalesce(o.delivery_address ->> 'city', '')), '')),
             o.customer_user_id, v_lines, 'Order ' || o.number, 'Paid by card', 'shop_order', o.id);
  UPDATE public.invoice_lines il SET
    total      = g.gross,
    net_amount = round(g.gross / (1 + il.vat_rate / 100), 2),
    vat_amount = g.gross - round(g.gross / (1 + il.vat_rate / 100), 2),
    unit_price = round(round(g.gross / (1 + il.vat_rate / 100), 2) / il.quantity, 4)
    FROM (SELECT x.n AS line_no, (x.elem ->> 'gross')::numeric AS gross FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS x (elem, n)) g
   WHERE il.invoice_id = v_inv.id AND il.line_no = g.line_no;
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_inv.id),
    delivery_from = (o.paid_at AT TIME ZONE 'Europe/Oslo')::date, delivery_to = (o.paid_at AT TIME ZONE 'Europe/Oslo')::date
   WHERE id = v_inv.id;
  v_inv := public.issue_invoice(v_inv.id);
  v_inv := public.record_invoice_payment(v_inv.id, o.paid_amount, (o.paid_at AT TIME ZONE 'Europe/Oslo')::date, 'card', o.payment_intent_id);
  UPDATE public.shop_orders SET invoice_id = v_inv.id, invoice_error = NULL, updated_at = now() WHERE id = o.id;
  PERFORM public.shop_event(o.id, 'order.receipt', jsonb_build_object('invoice', v_inv.number, 'total', v_inv.total));
  RETURN v_inv;
END $$;

-- The company makes the receipt again when it could not be made at
-- payment (invoice_error): owners, admins, finance.
CREATE OR REPLACE FUNCTION public.invoice_shop_order(p_order uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.shop_order_for(p_order, ARRAY['finance']);
  RETURN public.shop_invoice(p_order);
END $$;

-- A card payment Stripe confirmed (stripe-webhook, the server). Recorded
-- once (the payment's reference), only when it was made on the order's
-- account for exactly its total; anything else is held for the company to
-- look at and is never marked paid. Returns what was done.
CREATE OR REPLACE FUNCTION public.record_shop_payment(p_order uuid, p_amount numeric, p_account text, p_reference text, p_session text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE; l record; v_short text[] := '{}';
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'shop: the server only' USING ERRCODE = '42501'; END IF;
  IF coalesce(p_reference, '') = '' THEN RAISE EXCEPTION 'shop: the payment''s reference is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such order' USING ERRCODE = 'P0002'; END IF;
  IF o.payment_intent_id = p_reference THEN RETURN 'already recorded'; END IF;
  IF p_account IS DISTINCT FROM o.connected_account_id OR p_amount IS DISTINCT FROM o.total OR o.paid_at IS NOT NULL THEN
    UPDATE public.shop_orders SET payment_review = left(concat_ws('; ', payment_review,
             format('payment %s of %s kr on %s not recorded: %s', p_reference, p_amount, coalesce(p_account, 'FlyttGo'),
                    CASE WHEN o.paid_at IS NOT NULL THEN 'the order was already paid (refund it in Stripe)'
                         WHEN p_account IS DISTINCT FROM o.connected_account_id THEN 'not the shop''s account'
                         ELSE format('the order''s total is %s kr', o.total) END)), 2000),
           updated_at = now()
     WHERE id = p_order;
    PERFORM public.shop_event(p_order, 'order.payment_held', jsonb_build_object('reference', p_reference, 'amount', p_amount, 'account', p_account));
    RETURN 'held for review';
  END IF;
  -- Paid after the order expired or was cancelled: the goods are taken
  -- again where they are still in stock; what is not is for the company
  -- to refund or restock.
  IF o.status = 'cancelled' THEN
    PERFORM public.shop_lock_items(ARRAY(SELECT product_id FROM public.shop_order_lines WHERE order_id = p_order),
                                   ARRAY(SELECT variant_id FROM public.shop_order_lines WHERE order_id = p_order AND variant_id IS NOT NULL));
    FOR l IN SELECT ol.*, p.track_stock FROM public.shop_order_lines ol JOIN public.shop_products p ON p.id = ol.product_id
              WHERE ol.order_id = p_order AND NOT ol.stock_reserved AND p.track_stock LOOP
      IF l.variant_id IS NOT NULL THEN
        UPDATE public.shop_variants SET stock = stock - l.quantity WHERE id = l.variant_id AND stock >= l.quantity;
      ELSE
        UPDATE public.shop_products SET stock = stock - l.quantity, updated_at = now() WHERE id = l.product_id AND stock >= l.quantity;
      END IF;
      IF FOUND THEN UPDATE public.shop_order_lines SET stock_reserved = true WHERE id = l.id;
      ELSE v_short := v_short || l.name; END IF;
    END LOOP;
    IF cardinality(v_short) > 0 THEN
      UPDATE public.shop_orders SET payment_review = left(concat_ws('; ', payment_review,
               'paid after the order was cancelled; no longer in stock: ' || array_to_string(v_short, ', ')), 2000)
       WHERE id = p_order;
    END IF;
  END IF;
  UPDATE public.shop_orders SET status = 'paid', paid_at = now(), paid_amount = p_amount, payment_intent_id = p_reference,
         stripe_session_id = p_session, cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL, updated_at = now()
   WHERE id = p_order;
  PERFORM public.shop_event(p_order, 'order.paid', jsonb_build_object('amount', p_amount, 'reference', p_reference));
  -- The receipt. Should it fail (the company's invoicing switched off, its
  -- settings emptied), the payment stays recorded and the company makes it
  -- again (invoice_shop_order).
  BEGIN
    PERFORM public.shop_invoice(p_order);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.shop_orders SET invoice_error = left(SQLERRM, 500) WHERE id = p_order;
  END;
  RETURN 'recorded';
END $$;

CREATE OR REPLACE FUNCTION public.mark_shop_confirmation_sent(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'shop: the server only' USING ERRCODE = '42501'; END IF;
  UPDATE public.shop_orders SET confirmation_sent_at = now() WHERE id = p_order AND confirmation_sent_at IS NULL;
END $$;


-- ── 7. Packing, delivery ────────────────────────────────────────────────────
-- The company moves a paid order on: packed, then shipped (with the
-- carrier's reference in p_note) or ready for pickup, then delivered or
-- collected (the 14 days of the right of withdrawal start), or returned.
CREATE OR REPLACE FUNCTION public.set_shop_order_status(p_order uuid, p_status text, p_note text)
RETURNS public.shop_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE; v_ok boolean;
BEGIN
  o := public.shop_order_for(p_order, ARRAY['staff']);
  v_ok := CASE p_status
    WHEN 'packed'           THEN o.status = 'paid'
    WHEN 'shipped'          THEN o.status IN ('paid', 'packed') AND o.delivery_method = 'shipping'
    WHEN 'ready_for_pickup' THEN o.status IN ('paid', 'packed') AND o.delivery_method = 'pickup'
    WHEN 'delivered'        THEN o.status = 'shipped'
    WHEN 'collected'        THEN o.status = 'ready_for_pickup'
    WHEN 'returned'         THEN o.status IN ('shipped', 'delivered', 'collected')
    ELSE false END;
  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'shop: an order that is % cannot become %', replace(o.status, '_', ' '), replace(coalesce(p_status, '?'), '_', ' ')
      USING ERRCODE = '55000';
  END IF;
  UPDATE public.shop_orders SET status = p_status,
         tracking = CASE WHEN p_status = 'shipped' THEN nullif(btrim(coalesce(p_note, '')), '') ELSE tracking END,
         delivered_at = CASE WHEN p_status IN ('delivered', 'collected') THEN now() ELSE delivered_at END,
         updated_at = now()
   WHERE id = p_order RETURNING * INTO o;
  PERFORM public.shop_event(p_order, 'order.' || p_status, jsonb_build_object('note', p_note));
  RETURN o;
END $$;


-- ── 8. Withdrawal, returns and refunds ──────────────────────────────────────
-- The lines asked for ([{line_id, quantity}]; empty: everything not yet
-- refunded), checked against the order.
CREATE OR REPLACE FUNCTION public.shop_pick_lines(p_order uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v jsonb;
BEGIN
  IF coalesce(jsonb_typeof(p_lines), 'null') <> 'array' OR coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines END), 0) = 0 THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('line_id', id, 'quantity', quantity - refunded_quantity) ORDER BY line_no), '[]'::jsonb)
      INTO v FROM public.shop_order_lines WHERE order_id = p_order AND quantity > refunded_quantity;
    RETURN v;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) e
               LEFT JOIN public.shop_order_lines l ON l.id = (e ->> 'line_id')::uuid AND l.order_id = p_order
              WHERE l.id IS NULL OR coalesce((e ->> 'quantity')::int, 0) < 1
                 OR (e ->> 'quantity')::int > l.quantity - l.refunded_quantity) THEN
    RAISE EXCEPTION 'shop: each line must be on the order, with a quantity not yet refunded' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('line_id', (e ->> 'line_id')::uuid, 'quantity', (e ->> 'quantity')::int)) INTO v
    FROM jsonb_array_elements(p_lines) e;
  RETURN v;
END $$;

-- The customer withdraws from the purchase (angrerettloven): from receipt
-- of the paid goods (or before) the form is recorded, with whether it came
-- within 14 days of delivery or collection. The company then handles it;
-- the right itself and its exceptions are the company's terms to state.
CREATE OR REPLACE FUNCTION public.request_shop_withdrawal(p_order uuid, p_lines jsonb, p_message text)
RETURNS public.shop_withdrawals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE; w public.shop_withdrawals%ROWTYPE; v_lines jsonb;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR o.customer_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'shop: no such order' USING ERRCODE = 'P0002'; END IF;
  IF o.status NOT IN ('paid', 'packed', 'shipped', 'ready_for_pickup', 'delivered', 'collected') THEN
    RAISE EXCEPTION 'shop: the order is %', replace(o.status, '_', ' ') USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shop_withdrawals WHERE order_id = p_order AND status IN ('requested', 'received')) THEN
    RAISE EXCEPTION 'shop: the shop is already handling a withdrawal for this order' USING ERRCODE = '55000';
  END IF;
  v_lines := public.shop_pick_lines(p_order, p_lines);
  IF jsonb_array_length(v_lines) = 0 THEN RAISE EXCEPTION 'shop: everything on the order is refunded' USING ERRCODE = '55000'; END IF;
  INSERT INTO public.shop_withdrawals (order_id, organization_id, customer_user_id, lines, message, within_period)
  VALUES (p_order, o.organization_id, o.customer_user_id, v_lines, nullif(btrim(coalesce(p_message, '')), ''),
          o.delivered_at IS NULL
          OR (now() AT TIME ZONE 'Europe/Oslo')::date <= (o.delivered_at AT TIME ZONE 'Europe/Oslo')::date + 14)
  RETURNING * INTO w;
  PERFORM public.shop_event(p_order, 'order.withdrawal', jsonb_build_object('lines', v_lines, 'within_period', w.within_period));
  RETURN w;
END $$;

-- The company: the goods came back ('received'), or the withdrawal is
-- refused with the reason ('rejected'). The refund is shop_refund_begin.
CREATE OR REPLACE FUNCTION public.handle_shop_withdrawal(p_id uuid, p_decision text, p_note text)
RETURNS public.shop_withdrawals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE w public.shop_withdrawals%ROWTYPE; o public.shop_orders%ROWTYPE;
BEGIN
  SELECT * INTO w FROM public.shop_withdrawals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such withdrawal' USING ERRCODE = 'P0002'; END IF;
  o := public.shop_order_for(w.order_id, ARRAY['staff']);
  IF p_decision NOT IN ('received', 'rejected') OR w.status <> 'requested' THEN
    RAISE EXCEPTION 'shop: a requested withdrawal is received or rejected' USING ERRCODE = '55000';
  END IF;
  IF p_decision = 'rejected' AND coalesce(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'shop: give the customer the reason' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_withdrawals SET status = p_decision, handled_by = auth.uid(), handled_at = now(),
         note = nullif(btrim(coalesce(p_note, '')), '')
   WHERE id = p_id RETURNING * INTO w;
  -- Everything not yet refunded has come back: the order is returned.
  IF p_decision = 'received' AND o.status IN ('shipped', 'delivered', 'collected')
     AND (SELECT sum((e ->> 'quantity')::int) FROM jsonb_array_elements(w.lines) e)
         >= (SELECT sum(quantity - refunded_quantity) FROM public.shop_order_lines WHERE order_id = o.id) THEN
    UPDATE public.shop_orders SET status = 'returned', updated_at = now() WHERE id = o.id;
  END IF;
  PERFORM public.shop_event(o.id, 'withdrawal.' || p_decision, jsonb_build_object('note', p_note));
  RETURN w;
END $$;

-- A refund by the company (owners, admins, finance): the lines and how
-- many, the delivery price too or not, whether the goods go back into
-- stock. The amount follows from the order, never from the browser. One
-- refund is live at a time; asking again while it is returns it, so the
-- retry uses the same idempotency key (shop-refund).
CREATE OR REPLACE FUNCTION public.shop_refund_begin(p_order uuid, p_lines jsonb, p_delivery boolean, p_restock boolean,
                                                    p_reason text, p_withdrawal uuid)
RETURNS public.shop_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.shop_orders%ROWTYPE; r public.shop_refunds%ROWTYPE; v_lines jsonb; v_amount numeric; v_id uuid := gen_random_uuid();
BEGIN
  o := public.shop_order_for(p_order, ARRAY['finance']);
  SELECT * INTO r FROM public.shop_refunds WHERE order_id = p_order AND status IN ('requested', 'pending');
  IF FOUND THEN RETURN r; END IF;
  IF o.paid_at IS NULL OR o.payment_intent_id IS NULL THEN RAISE EXCEPTION 'shop: only a paid order is refunded' USING ERRCODE = '55000'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'shop: a refund needs a reason' USING ERRCODE = '22023'; END IF;
  IF p_withdrawal IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.shop_withdrawals WHERE id = p_withdrawal AND order_id = p_order) THEN
    RAISE EXCEPTION 'shop: the withdrawal is not for this order' USING ERRCODE = '22023';
  END IF;
  -- No lines given: everything not yet refunded; an empty list: none (the
  -- delivery price alone).
  v_lines := public.shop_pick_lines(p_order, p_lines);
  IF jsonb_typeof(p_lines) = 'array' THEN
    IF jsonb_array_length(p_lines) = 0 THEN v_lines := '[]'::jsonb; END IF;
  END IF;
  SELECT coalesce(sum(l.unit_price * (e ->> 'quantity')::int), 0) INTO v_amount
    FROM jsonb_array_elements(v_lines) e JOIN public.shop_order_lines l ON l.id = (e ->> 'line_id')::uuid;
  IF coalesce(p_delivery, false) AND NOT o.delivery_refunded THEN v_amount := v_amount + o.delivery_price; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'shop: nothing to refund' USING ERRCODE = '22023'; END IF;
  IF v_amount > o.paid_amount - o.refunded_amount THEN
    RAISE EXCEPTION 'shop: % kr is more than the % kr still paid', v_amount, o.paid_amount - o.refunded_amount USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shop_refunds (id, order_id, withdrawal_id, amount, lines, delivery, restock, reason, idempotency_key, requested_by)
  VALUES (v_id, p_order, p_withdrawal, v_amount, v_lines, coalesce(p_delivery, false) AND NOT o.delivery_refunded,
          coalesce(p_restock, false), btrim(p_reason), 'flyttgo-shop-refund-' || v_id, auth.uid())
  RETURNING * INTO r;
  PERFORM public.shop_event(p_order, 'refund.requested', jsonb_build_object('amount', v_amount, 'reason', p_reason));
  RETURN r;
END $$;

-- The credit note for a refund, line by line at each line's MVA rate, in
-- the receipt's series and to the same buyer (as create_credit_note, 00011).
CREATE OR REPLACE FUNCTION public.shop_credit_note(p_refund uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.shop_refunds%ROWTYPE; o public.shop_orders%ROWTYPE; v_inv public.invoices%ROWTYPE; v_cn public.invoices%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.shop_refunds WHERE id = p_refund;
  SELECT * INTO o FROM public.shop_orders WHERE id = r.order_id;
  SELECT * INTO v_inv FROM public.invoices WHERE id = o.invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: the order has no receipt to credit' USING ERRCODE = '55000'; END IF;
  INSERT INTO public.invoices (kind, credits_invoice_id, organization_id, issuer_org, series, customer_user_id, buyer,
                               notes, reference, delivery_from, delivery_to, source_type, source_id, created_by)
  VALUES ('credit_note', v_inv.id, v_inv.organization_id, v_inv.issuer_org, v_inv.series, v_inv.customer_user_id, v_inv.buyer,
          'Credit note for invoice ' || v_inv.number || ': ' || r.reason, v_inv.reference, v_inv.delivery_from, v_inv.delivery_to,
          'shop_order', o.id, auth.uid())
  RETURNING * INTO v_cn;
  INSERT INTO public.invoice_lines (invoice_id, line_no, is_credit, description, quantity, unit_price, vat_rate, net_amount, vat_amount, total)
  SELECT v_cn.id, row_number() OVER (ORDER BY x.ord), true, x.description, x.quantity,
         -round(round(x.gross / (1 + x.rate / 100), 2) / x.quantity, 4), x.rate,
         -round(x.gross / (1 + x.rate / 100), 2), -(x.gross - round(x.gross / (1 + x.rate / 100), 2)), -x.gross
    FROM (SELECT l.line_no AS ord, 'Return: ' || l.name AS description, (e ->> 'quantity')::int AS quantity,
                 l.unit_price * (e ->> 'quantity')::int AS gross, l.vat_rate AS rate
            FROM jsonb_array_elements(r.lines) e JOIN public.shop_order_lines l ON l.id = (e ->> 'line_id')::uuid
          UNION ALL
          SELECT 100000, CASE o.delivery_method WHEN 'shipping' THEN 'Return: delivery' ELSE 'Return: pickup' END, 1,
                 o.delivery_price, o.delivery_vat_rate
           WHERE r.delivery AND o.delivery_price > 0) x;
  UPDATE public.invoices SET
    net_total = (SELECT sum(net_amount) FROM public.invoice_lines WHERE invoice_id = v_cn.id),
    vat_total = (SELECT sum(vat_amount) FROM public.invoice_lines WHERE invoice_id = v_cn.id),
    total     = (SELECT sum(total)      FROM public.invoice_lines WHERE invoice_id = v_cn.id)
   WHERE id = v_cn.id;
  PERFORM public.invoice_event(v_inv.id, 'invoice.credited', jsonb_build_object('reason', r.reason, 'amount', r.amount, 'shop_refund', r.id));
  RETURN public.issue_invoice(v_cn.id);
END $$;

-- What Stripe reported for a refund (shop-refund, stripe-webhook; the
-- server). On the first 'succeeded', once: the lines and the order are
-- marked refunded, the goods go back into stock when asked, the
-- withdrawal is closed and the receipt credited. 'succeeded' and 'failed'
-- are final.
CREATE OR REPLACE FUNCTION public.shop_refund_mark(p_refund uuid, p_status text, p_provider_refund_id text, p_error text)
RETURNS public.shop_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.shop_refunds%ROWTYPE; o public.shop_orders%ROWTYPE; e jsonb; l public.shop_order_lines%ROWTYPE;
BEGIN
  IF NOT public.is_server() THEN RAISE EXCEPTION 'shop: the server only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.shop_refunds WHERE id = p_refund FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop: no such refund' USING ERRCODE = 'P0002'; END IF;
  IF r.status IN ('succeeded', 'failed') OR p_status NOT IN ('requested', 'pending', 'succeeded', 'failed') THEN RETURN r; END IF;
  IF p_status IN ('requested', 'pending') THEN
    UPDATE public.shop_refunds SET status = p_status, provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
           error = p_error, updated_at = now()
     WHERE id = p_refund RETURNING * INTO r;
    RETURN r;
  END IF;
  IF p_status = 'failed' THEN
    UPDATE public.shop_refunds SET status = 'failed', provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
           error = left(coalesce(p_error, 'failed'), 500), updated_at = now()
     WHERE id = p_refund RETURNING * INTO r;
    PERFORM public.shop_event(r.order_id, 'refund.failed', jsonb_build_object('amount', r.amount, 'error', p_error));
    RETURN r;
  END IF;

  SELECT * INTO o FROM public.shop_orders WHERE id = r.order_id FOR UPDATE;
  FOR e IN SELECT * FROM jsonb_array_elements(r.lines) LOOP
    UPDATE public.shop_order_lines SET refunded_quantity = refunded_quantity + (e ->> 'quantity')::int
     WHERE id = (e ->> 'line_id')::uuid RETURNING * INTO l;
  END LOOP;
  IF r.restock THEN
    PERFORM public.shop_lock_items(
      ARRAY(SELECT ol.product_id FROM jsonb_array_elements(r.lines) x JOIN public.shop_order_lines ol ON ol.id = (x ->> 'line_id')::uuid),
      ARRAY(SELECT ol.variant_id FROM jsonb_array_elements(r.lines) x JOIN public.shop_order_lines ol ON ol.id = (x ->> 'line_id')::uuid
             WHERE ol.variant_id IS NOT NULL));
    FOR e IN SELECT * FROM jsonb_array_elements(r.lines) LOOP
      SELECT * INTO l FROM public.shop_order_lines WHERE id = (e ->> 'line_id')::uuid;
      IF l.variant_id IS NOT NULL THEN
        UPDATE public.shop_variants v SET stock = v.stock + (e ->> 'quantity')::int
          FROM public.shop_products p WHERE v.id = l.variant_id AND p.id = v.product_id AND p.track_stock;
      ELSE
        UPDATE public.shop_products SET stock = stock + (e ->> 'quantity')::int, updated_at = now() WHERE id = l.product_id AND track_stock;
      END IF;
    END LOOP;
  END IF;
  UPDATE public.shop_orders SET refunded_amount = refunded_amount + r.amount, delivery_refunded = delivery_refunded OR r.delivery,
         status = CASE WHEN refunded_amount + r.amount >= paid_amount THEN 'refunded' ELSE status END, updated_at = now()
   WHERE id = o.id;
  UPDATE public.shop_withdrawals SET status = 'refunded', handled_at = coalesce(handled_at, now()) WHERE id = r.withdrawal_id;
  UPDATE public.shop_refunds SET status = 'succeeded', provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
         error = NULL, updated_at = now()
   WHERE id = p_refund RETURNING * INTO r;
  PERFORM public.shop_event(o.id, 'refund.succeeded', jsonb_build_object('amount', r.amount, 'provider_refund_id', r.provider_refund_id));
  -- The credit note. Without a receipt (or should it fail) the refund
  -- stands and the error is kept; the company credits it by hand.
  BEGIN
    UPDATE public.shop_refunds SET credit_note_id = (public.shop_credit_note(p_refund)).id WHERE id = p_refund RETURNING * INTO r;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.shop_refunds SET error = left('credit note: ' || SQLERRM, 500) WHERE id = p_refund RETURNING * INTO r;
  END;
  RETURN r;
END $$;


-- ── 9. Who may call what ────────────────────────────────────────────────────
-- Internal: called only by the functions above.
REVOKE ALL ON FUNCTION
  public.shop_event(uuid, text, jsonb), public.shop_check_vat(uuid, numeric), public.shop_lock_items(uuid[], uuid[]),
  public.shop_compute(uuid, jsonb, text), public.shop_release_stock(uuid), public.shop_expire(uuid, uuid[], uuid[]),
  public.shop_order_for(uuid, text[]), public.shop_invoice(uuid), public.shop_pick_lines(uuid, jsonb),
  public.shop_credit_note(uuid)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.can_read_shop_order(uuid), public.save_shop_settings(uuid, jsonb), public.save_shop_product(uuid, uuid, jsonb),
  public.save_shop_variant(uuid, uuid, jsonb), public.set_shop_stock(uuid, uuid, integer), public.shop_quote(uuid, jsonb, text),
  public.place_shop_order(uuid, jsonb, text, jsonb, jsonb), public.cancel_shop_order(uuid, text),
  public.shop_checkout_begin(uuid), public.invoice_shop_order(uuid), public.set_shop_order_status(uuid, text, text),
  public.request_shop_withdrawal(uuid, jsonb, text), public.handle_shop_withdrawal(uuid, text, text),
  public.shop_refund_begin(uuid, jsonb, boolean, boolean, text, uuid),
  public.expire_shop_orders(), public.record_shop_payment(uuid, numeric, text, text, text),
  public.mark_shop_confirmation_sent(uuid), public.shop_refund_mark(uuid, text, text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.can_read_shop_order(uuid), public.save_shop_settings(uuid, jsonb), public.save_shop_product(uuid, uuid, jsonb),
  public.save_shop_variant(uuid, uuid, jsonb), public.set_shop_stock(uuid, uuid, integer), public.shop_quote(uuid, jsonb, text),
  public.place_shop_order(uuid, jsonb, text, jsonb, jsonb), public.cancel_shop_order(uuid, text),
  public.shop_checkout_begin(uuid), public.invoice_shop_order(uuid), public.set_shop_order_status(uuid, text, text),
  public.request_shop_withdrawal(uuid, jsonb, text), public.handle_shop_withdrawal(uuid, text, text),
  public.shop_refund_begin(uuid, jsonb, boolean, boolean, text, uuid)
TO authenticated, service_role;
-- The server's: payments, refunds' outcomes, expiry, confirmations.
REVOKE ALL ON FUNCTION public.expire_shop_orders(), public.record_shop_payment(uuid, numeric, text, text, text),
  public.mark_shop_confirmation_sent(uuid), public.shop_refund_mark(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_shop_orders(), public.record_shop_payment(uuid, numeric, text, text, text),
  public.mark_shop_confirmation_sent(uuid), public.shop_refund_mark(uuid, text, text, text) TO service_role;
-- Visitors see what a cart costs before signing in.
GRANT EXECUTE ON FUNCTION public.shop_quote(uuid, jsonb, text) TO anon;

-- ============================================================================
-- DONE
-- ============================================================================
