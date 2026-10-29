# White label

Companies offer moving and delivery under their own brand, with FlyttGo's drivers doing the moves (owner's decision, 2026-10-29; [`DECISIONS.md`](DECISIONS.md) #22–25). Step 6 of the corporate plan. Migration `supabase/migrations/00009_white_label.sql`, rollback `supabase/rollback/00009_down.sql`.

**Not applied or deployed.** It follows the same procedure as the rest: [`SECURITY_P0.md`](SECURITY_P0.md) §5 and [`COPY_OF_PRODUCTION_TEST_PLAN.md`](COPY_OF_PRODUCTION_TEST_PLAN.md).

## The two seller models

| | Model A: FlyttGo sells (the default) | Model B: the company sells |
|---|---|---|
| Who the customer buys from | FlyttGo AS, on the company's page | The company |
| Price | FlyttGo's price | FlyttGo's price plus the company's markup (never below what FlyttGo takes) |
| Payment | Card or Vipps, to FlyttGo | Card, into the company's own Stripe account (Stripe Connect, Standard account, direct charge) |
| Receipt, terms, consumer rights | FlyttGo | The company |
| Customer service, refunds, complaints | FlyttGo | The company first; FlyttGo carries out the moves |
| Customers' personal data | FlyttGo is the controller; the company sees numbers only | The company is the controller; FlyttGo processes it under the [data processing agreement](../src/pages/WhiteLabelDpaPage.tsx) |
| What FlyttGo earns | Its own sale, plus the plan's monthly fee | Its price for the move and a platform fee per booking (taken from the payment), plus the plan's fees |
| Needs | An active company and a display name | Also: MVA registration, customer service email and phone, its terms and privacy notice, the agreement accepted by an owner, a Stripe account that can take payments, a verified domain |

Model A asks more of FlyttGo (payment, receipts, support, refunds, complaints), so it is the simple choice for the company and the default. Model B suits larger companies with their own customer service and accounting.

## Plans and prices

The price list is the table `white_label_plans`, shown at `/business/white-label` and in the company dashboard. **Shipped prices are proposals** (all excluding MVA) until an administrator confirms them in Admin → White label → Plans and prices; until then every page says so.

| Plan | Model | Set-up | Monthly | Per booking |
|---|---|---|---|---|
| Branded booking page (default) | A | 2 900 | 1 490 | none |
| Branded booking on your domain | A | 4 900 | 2 490 | none |
| Own seller | B | 14 900 | 4 990 | platform fee 4 % of FlyttGo's price excl. MVA, at least 49 NOK (+ MVA) |

**Billing** goes on FlyttGo's own invoices (00008), with the company's payment terms. The invoice run (`invoice-run`, daily) calls `create_white_label_invoice` for each company on a plan:
- the set-up fee, once per plan;
- the monthly fee in advance, each month from approval, with the first month counted from the start day, and nothing after the month a plan ends (suspended plans are still billed);
- for Model B, what FlyttGo kept from each booking finished or cancelled before this month (its price and the fee, or their share after a refund). That part is already collected through Stripe, so `settle_white_label_invoice` records it as paid (`platform_fee`) when the invoice is issued. The company owes only the plan fees.

Price changes apply to charges made after the change; customers' contracts decide notice.

## How a company gets a page

1. **Choose a plan** (owner or admin): Corporate dashboard → White label. Without a choice it is the default plan. A company already on a plan can request another; the old plan stays until FlyttGo approves the change.
2. **Brand:** display name, tagline, colours. The logo is the company's logo from Invoices. For Model B, also customer service contacts, terms and privacy links, and the markup, with a worked example of the split.
3. **Website** (optional): a template from the library (below) and the town it names.
4. **Domain** (plans with a domain): the company gives one, adds a TXT record `_flyttgo.<domain>` = `flyttgo-verify=<token>` and a CNAME to the hosting target, then presses **Check DNS** (`white-label-domain`, DNS over HTTPS). **FlyttGo then adds the domain to the Vercel project** (manual, see the checklist below).
5. **Model B:** an owner accepts the data processing agreement (version recorded) and connects Stripe (`stripe-connect`: creates a Standard account and returns Stripe's onboarding link; `account.updated` keeps the "can take payments" flag current).
6. **FlyttGo approves** in Admin → White label. The database refuses approval while anything is missing (`white_label_missing`). Administrators can also decline (with a reason), suspend, end and reactivate.

The page is at `flyttgo.no/b/<slug>`, at `<slug>.flyttgo.no` (once the wildcard is set up), and at the company's verified domain. It wears the company's header and footer; the footer always names the seller (FlyttGo or the company) with its organisation number.

## Bookings on a company's page

- The booking flow and payment page are FlyttGo's own (no second booking engine). The page's company goes on the booking (`white_label_org`); **the database decides the seller model from the active plan**, never the browser (`guard_booking_white_label`).
- Model B: `booking-charge` computes the split (`_shared/white-label.ts`, the same function the browser uses to show the price) and writes `customer_price`, `platform_fee` and `connected_account_id` (server only). `create-checkout-session` creates the Checkout session **on the company's account** with `application_fee_amount` = FlyttGo's price + fee. Vipps and invoice are refused for these bookings (Vipps would need the company's own Vipps agreement; the invoice is FlyttGo's).
- `stripe-webhook` accepts events from the Connect endpoint and marks a booking paid only when the event's account is the one the booking was charged on.
- Refunds of Model B bookings go through the company's account with `refund_application_fee`, so FlyttGo gives back its share in proportion. The cancellation policy is FlyttGo's (the company's terms must not promise less).
- Drivers, dispatch, escrow and payouts are unchanged: the escrow holds FlyttGo's price.
- Who sees the bookings: Model B, the selling company's members (`bookings_white_label_select`); Model A, nobody at the company (they see `white_label_stats`, monthly numbers only).
- On a plan outside transport the page books the company's own module instead (`bookingFor()` in `_shared/white-label.ts`, read by `white-label-site`): jobs, appointments, restaurant tables or hotel rooms ([`SERVICE_PLATFORM.md`](SERVICE_PLATFORM.md)), and a plan with the Shop module also shows the company's shop at `/b/<slug>/shop` (the page's only offer when it has no booking module); its seller notice then names the company as the seller of everything offered on the page and FlyttGo as the booking and payment platform.

## Website templates (from ArchitectPro)

Architect-AI's `site_masters` (210 generated five-page websites, read 2026-10-29) are brought in as a template library. **None has been imported into FlyttGo yet**: the import writes to FlyttGo's database and storage and needs the owner's approval, and production does not have migration 00009 yet.

- **What is taken:** every template except the 11 health templates (clinics, dentists, therapists: patient data is outside FlyttGo). That is **199 templates in 10 catalogue categories** (`TEMPLATE_CATEGORIES` in `supabase/functions/_shared/site-template.ts`): salons, wellness and bookings 37; food, hospitality and events 36; moving and transport 33; trades, home and car services 22; professional services 15; education, nonprofit and community 14; property, industry and agriculture 13; software and technology 12; shops 9; gaming and entertainment 8. A template whose industries match no category goes to "Other businesses"; none is left out silently.
- **Keeping the design:** the templates style themselves with their own `<style>` (no outside stylesheets or fonts) and use `{{ASSET:key}}` images, which are kept. 106 of them also have a small script that fades sections in (`.reveal` and others: in 82 templates whole sections start invisible), draws star ratings and counts numbers up. Pages are served without scripts, so before cleaning the importer opens each page in a headless browser with reduced motion and no network (`scripts/template-snapshot.ts`; all 106 scripts then show everything in its final state) and keeps the page as it ends up. It then shows the cleaned page with scripts off and flags it **hidden** if it shows less than 90 % of the text. Quote forms become a card in the form's own style with a "Get a price and book" button. The serve step also shows `.reveal` content as a safety net.
- **Import:** `scripts/import-site-templates.ts` reads Architect-AI (service key) or an export file, settles each page as above, draws the thumbnail (above; written to `<out>/thumbnails/<id>.jpg`), prepares it (`prepareTemplate`: strips scripts, event handlers, `javascript:` links, frames, forms, external styles and images and refreshes; turns the sample company's name, also where the page writes `&` as `&amp;` and in image descriptions, its phone and email into placeholders; points quote links at the booking page; lists prices, reviews and claims to check), and writes a review folder with `report.md` (by category). Needs Playwright (`npm i -D playwright && npx playwright install chromium`). With `--to-flyttgo` it copies the images into the `site-template-assets` bucket and stores each template through `import_site_template` (server only). **Running it against FlyttGo needs the owner's approval.**
- **Catalogue:** companies choose in Corporate → White label → Website (`src/components/whiteLabel/TemplateCatalogue.tsx`): category tabs with counts, search (name, style, industry, features), templates in name order (no popularity sorting), and a full preview of every page in the company's own name, colours and contact details (sandboxed, without scripts, as published). The list loads without pages; a template's pages are loaded when it is opened.
- **Cards** (migration 00021): each card shows the template's **thumbnail**, a picture of its cleaned home page drawn by the importer with a neutral sample brand ("Your Company", the template's own colours) at 1280 px wide, the top 1600 px, saved as a 640 × 800 JPEG and stored beside its images as the asset `thumbnail` (`site-template-assets/<id>/thumbnail.jpg`). Cards show it lazily (`loading="lazy"`), all in the same 4 : 3 shape (the top of the page), with a slight zoom on hover that is switched off under reduced motion. A template without a thumbnail shows the live miniature instead (`TemplateThumb.tsx`: the home page drawn in the company's name and colours, scaled down). Under the picture: the template's style, its number of pages (`page_count`, computed from the pages), its **features** (services, prices, menu, gallery, testimonials, team, FAQ, contact; found by the importer in the pages' paths, headings and section names, `templateFeatures()`, stored in `features`) and "Best for …" (its industries in words, `bestFor()`).
- **Review:** an imported template is not offered. In Admin → White label → Templates (filter by category and by status) an administrator reads each page (sandboxed preview), edits it to remove sample prices, reviews and claims (the database refuses a page with scripts, handlers, frames or forms, and approval while any price remains), confirms the check and approves; a page flagged hidden is fixed first. A re-imported or edited template goes back to review.
- **Serving:** `white-label-site` renders the requested page with the company's brand (`renderTemplatePage`, which sanitises again), and the browser shows it in an iframe **sandboxed without scripts or same-origin access**. Links leave the frame to the site's other pages or the booking page.
- **Before import:** confirm FlyttGo may use Architect-AI's content (same owner) and the licence of its images (stock photos).

## Booking widget

A company puts its booking page on its own website (migration 00018; the API keys of the same migration are in [`API.md`](API.md)). **No API key is involved:** customers book through the company's FlyttGo page, as on `/b/<slug>`.

- **The snippet** (Corporate dashboard → **API and widget**, with a copy button and a live preview):
  ```html
  <div id="flyttgo-booking"></div>
  <script src="https://flyttgo.no/widget.js" data-company="<slug>" data-target="#flyttgo-booking" async></script>
  ```
  `public/widget.js` (no dependencies) inserts an iframe of `/embed/<slug>` and sets its height from the page's `flyttgo:resize` messages, accepted only from its own frame and FlyttGo's origin. The frame is sandboxed: scripts, forms and new tabs for FlyttGo's page; it never navigates the company's page without the visitor's click.
- **The embed page** (`src/pages/EmbedPage.tsx`) shows the same booking flow as the company's page, compact and without FlyttGo's header and footer: FlyttGo's moves (`BookingFlow`) for transport plans, the company's jobs or appointments (`ServiceBookingPage`) for the others. It needs the company's page to be active. Card and Vipps payment open in a new tab (payment providers refuse to run inside frames; the confirmation page there may ask the customer to sign in again, as browsers keep a frame's sign-in apart from the site's); sign-in works inside the frame with email and password (Google or Apple sign-in may not, as they refuse frames).
- **Where it may be shown:** the websites the company lists (owners and admins; `https://host[:port]` without a path, or `http://localhost` for testing; at most 20), in `organization_widget_origins`. Enforced twice:
  1. **The browser**, by `Content-Security-Policy: frame-ancestors 'self' <the websites>` on `/embed/<slug>`. `vercel.json` only rewrites to the app, so the header comes from the Vercel Routing Middleware `middleware.ts`, which reads the list through `white-label-site` (`"widget": true`). If the list cannot be read only FlyttGo may frame the page.
  2. **The embed page**, which checks the website that framed it (`location.ancestorOrigins`, else the referrer, else the origin the script passed) against the list from `white-label-site` and shows the flow only there or inside FlyttGo itself (the dashboard's preview). Elsewhere it shows a link to the company's page. This also covers hosts where the middleware does not run (local development).
- **Before going live:** check on a Vercel preview that `/embed/<slug>` carries the header (the middleware is not tested on Vercel yet; [`DEPLOYMENT.md`](DEPLOYMENT.md) §3).

## Who may do what

| | Owner | Admin | Finance, booker, viewer | FlyttGo administrator | Server |
|---|---|---|---|---|---|
| Choose or change a plan, brand, website, domain | ✓ | ✓ | see | (not inside the company) | |
| Accept the data processing agreement, connect Stripe, end the plan | ✓ | | see | | |
| Approve, decline, suspend, end, reactivate; prices; templates | | | | ✓ | |
| Mark a domain verified, link a Stripe account, import templates, write a payment split | | | | | ✓ |

## Before going live: checklist

1. Confirm or change the prices (Admin → White label → Plans and prices).
2. **Legal:** have a lawyer review the data processing agreement (it is marked as a draft) and the Model B terms (subcontracting, liability, consumer rights split), and the receipts each model issues.
3. **Accountant:** the plan invoices and the Model B settlement lines (transport resale and platform fee, MVA).
4. **Stripe Connect** on FlyttGo's Stripe account (Standard accounts), a Connect webhook endpoint to `stripe-webhook` with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `refund.*` and `account.updated`, and the secret `STRIPE_CONNECT_WEBHOOK_SECRET`.
5. **Hosting:** a wildcard domain `*.flyttgo.no` on the Vercel project for subdomains; each verified company domain added to the project (Vercel → Domains). `WHITE_LABEL_CNAME_TARGET` if the target is not `cname.vercel-dns.com`.
6. Settings `white_label_support_email` / `white_label_support_phone` (Model A pages' customer service; otherwise the invoice seller's).
7. Import and review the templates (above).

## Integration points (not connected)

- **Vercel domains API:** adding a verified domain to the project is manual. It could be automated with a Vercel token.
- **Vipps for Model B:** would need each company's own Vipps MobilePay agreement (or Vipps' partner API).
- **Booking widget and API keys:** built (migration 00018, above and [`API.md`](API.md)). The plans don't list them yet: decide whether they are part of every plan or priced.
- **Webhooks** for the API (status changes pushed to the company): not built.

## Tests

- `supabase/tests/white_label.test.sql` (PostgreSQL 16 and 17.6, both schemas; the rollback restores the earlier state exactly): the price list and who changes it; choosing Model A; Model B requirements; plan changes; the database deciding the seller; the split by the server only; no invoice for Model B; who sees bookings; the public page; plan billing and Model B settlement; templates (clean import, review, approval, choice, re-import).
- `supabase/tests/template_quality.test.sql` (00021, both schemas; the rollback restores the earlier state exactly): the catalogue's features, page count and thumbnail.
- `src/test/white-label.test.ts` (split, seller notice), `src/test/reservations.test.ts` (which booking a page offers, the notice outside transport), `src/test/site-template.test.ts` (sanitiser, import, render, features and "best for"), `src/test/refunds.test.ts` (refunds on a connected account).
