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

## Website templates (from ArchitectPro)

Architect-AI's `site_masters` (210 generated five-page websites, read 2026-10-29) are brought in as a template library. **None has been imported into FlyttGo yet**: the import writes to FlyttGo's database and storage and needs the owner's approval, and production does not have migration 00009 yet.

- **What is taken:** every template except the 11 health templates (clinics, dentists, therapists: patient data is outside FlyttGo). That is **199 templates in 10 catalogue categories** (`TEMPLATE_CATEGORIES` in `supabase/functions/_shared/site-template.ts`): salons, wellness and bookings 37; food, hospitality and events 36; moving and transport 33; trades, home and car services 22; professional services 15; education, nonprofit and community 14; property, industry and agriculture 13; software and technology 12; shops 9; gaming and entertainment 8. A template whose industries match no category goes to "Other businesses"; none is left out silently.
- **Keeping the design:** the templates style themselves with their own `<style>` (no outside stylesheets or fonts) and use `{{ASSET:key}}` images, which are kept. 106 of them also have a small script that fades sections in (`.reveal` and others: in 82 templates whole sections start invisible), draws star ratings and counts numbers up. Pages are served without scripts, so before cleaning the importer opens each page in a headless browser with reduced motion and no network (`scripts/template-snapshot.ts`; all 106 scripts then show everything in its final state) and keeps the page as it ends up. It then shows the cleaned page with scripts off and flags it **hidden** if it shows less than 90 % of the text. Quote forms become a card in the form's own style with a "Get a price and book" button. The serve step also shows `.reveal` content as a safety net.
- **Import:** `scripts/import-site-templates.ts` reads Architect-AI (service key) or an export file, settles each page as above, draws the thumbnail (above; written to `<out>/thumbnails/<id>.jpg`), prepares it (`prepareTemplate`: strips scripts, event handlers, `javascript:` links, frames, forms, external styles and images and refreshes; turns the sample company's name, also where the page writes `&` as `&amp;` and in image descriptions, its phone and email into placeholders; points quote links at the booking page; lists prices, reviews and claims to check), and writes a review folder with `report.md` (by category). Needs Playwright (`npm i -D playwright && npx playwright install chromium`). With `--to-flyttgo` it copies the images into the `site-template-assets` bucket and stores each template through `import_site_template` (server only). **Running it against FlyttGo needs the owner's approval.**
- **Catalogue:** companies choose in Corporate → White label → Website (`src/components/whiteLabel/TemplateCatalogue.tsx`): category tabs with counts, search (name, style, industry, features), templates in name order (no popularity sorting), and a full preview of every page in the company's own name, colours and contact details (sandboxed, without scripts, as published), labelled "Preview: your name and colours, sample content": at desktop width, as a tablet (768 px) or as a phone (390 px), page by page (page tabs, previous and next), with "Choose this website". The list loads without pages; a template's pages are loaded when it is opened.
- **Cards** (migration 00021): each card shows the template's **thumbnail**, a picture of its cleaned home page drawn by the importer with a neutral sample brand ("Your Company", the template's own colours) at 1280 px wide, the top 1600 px, saved as a 640 × 800 JPEG and stored beside its images as the asset `thumbnail` (`site-template-assets/<id>/thumbnail.jpg`). Cards show it lazily (`loading="lazy"`), all in the same 4 : 3 shape (the top of the page), with a slight zoom on hover that is switched off under reduced motion. A template without a thumbnail shows the live miniature instead (`TemplateThumb.tsx`: the home page drawn in the company's name and colours, scaled down). Under the picture: the template's style, its number of pages (`page_count`, computed from the pages), its **features** (services, prices, menu, gallery, testimonials, team, FAQ, contact; found by the importer in the pages' paths, headings and section names, `templateFeatures()`, stored in `features`) and "Best for …" (its industries in words, `bestFor()`).
- **The company's brand in a template** (`prepareTemplate` at import, `renderTemplatePage` when served): the sample company's full name is replaced, and so are the **short forms** its logo uses (`sampleShortNames()`: the first word(s) of the name where a brand or logo element shows only them, e.g. "Verve" for "Verve Hair Salon"); a short form that is an everyday word, or that the template also writes in lower case, is replaced only in the logo, never in the text ("Fast" of "Fast Man & Van"). Names are also replaced in the title, image descriptions, labels and the page's description for search engines. Each brand or logo element showing the name becomes a **brand slot** (`fg-brand-slot`): the template's own mark, then the company's **logo** when it has one (Invoices → logo; it then takes the mark's place) and its name. A long name is set smaller with less letter spacing and wraps inside the slot instead of pushing the header apart or being clipped (names over 18 and over 40 characters); words too long for the screen break rather than overflow it. The company's colours are given as the template's own variables (`--c-primary`, `--c-accent`) and as `--fg-primary`, `--fg-accent`, `--fg-on-primary`, `--fg-on-accent` (readable text on them). Every company value is escaped and filled in one pass, so nothing the company writes is read as a placeholder; a logo must be an https link on the asset store's host.
- **Contrast:** Corporate → White label → Brand warns when white text on the main or accent colour (as most templates' buttons have it), which is also the colour as text on white, is below WCAG AA (4.5 : 1), and suggests the nearest darker shade that reads (`readableShade()`). The company's colours change only if it presses "Use" and saves; FlyttGo never changes them silently.
- **Quality gate** (`supabase/functions/_shared/template-quality.ts`, migration 00021): the importer checks every page automatically and stores the results with the template (`site_templates.checks`): **unsafe HTML** (the sanitiser's rules), **renders** (draws, with text), **overflow** (nothing wider than the screen at 320, 375 and 390 px, drawn with a long company name; the outermost elements that stick out are named), **broken images** (every `{{ASSET:key}}` has an image and it loads; when no image loads at all the importer could not reach the asset store and the check is "not run"), **image alt texts** (`alt=""` counts as decoration), **booking links** (every link that reads as booking, "Book now", "Reserve", "Get a free quote", "Request an appointment"…, leads to the booking page; the importer rewrites them, the check confirms it) and **sample content** (the content flags for the sample name and its short forms, a US address, town and state, phone, email, price or figure such as "18,000+" or "98%"; reviews and claims stay for the reviewer to judge). `report.md` lists the failing checks per template. **Approval is refused while a check fails or is out of date** unless the administrator gives a reason; the database records who, when, why and which checks in `check_overrides` (`admin_review_site_template(…, p_override_reason)`). Unsafe HTML and prices are never overridden. A template imported without checks counts as not checked. When an administrator saves a page, its results become out of date; the admin panel at once records the checks that need no browser and the page's content flags again from the saved page (`admin_record_site_template_page_checks`); the browser's (renders, overflow) wait for `node scripts/import-site-templates.ts --recheck [--ids …]` (writes only checks and flags; needs the owner's approval like `--to-flyttgo`) or a reason. Admin → White label → Templates shows each template's checks by page (pass, fail, out of date, not run), what failed, the live checks of an unsaved draft and the approvals given despite failing checks.
- **Images** (`supabase/functions/_shared/template-images.ts`, table `site_template_images`, migration 00021): each template's images are **named slots**, one per `{{ASSET:key}}`: hero, services, about, gallery, team, map, product, background or other (`slotOf()`: from what the page's alt text says the image shows, a map or a portrait, else from the key). Each slot records the image's **source** (`architect-ai` as imported; `ai-generated`, `licensed` or `own`), its **licence** (required for a licensed photo; unknown for imported ones until confirmed) or **how it was generated** (model, prompt, date; required for an AI-generated one), the template's **category**, its **intended use** (the page's alt text), its **size** and **SHA-256**, and its **review status** (unreviewed, approved, rejected; an imported or licensed image is approved only once its licence is recorded). FlyttGo administrators only. `report.md` lists the templates that share the very same image set (by SHA-256 where the images were copied, else by address): the screenshot review found 192 of 210 templates using one set of shipping-container photos. **No new photos are sourced yet**: the owner decides between AI-generated, licensed and own photos.
  - **Replacing one slot:** Admin → White label → Templates → a template → Images: approve or reject each image (recording the licence of an imported one), or **Replace…**: the file is checked by its bytes in the browser (PNG, JPEG or WebP, at most 5 MB; never by its name or claimed type), uploaded to `site-template-assets/<template>/<key>-<hash>.<ext>` (administrators may upload there; the bucket accepts only those types) and recorded with where it comes from (`admin_replace_site_template_image`; the earlier image is kept in the slot's history). The template goes back to review, and a later re-import keeps the replaced image. The server does not re-read the bytes (the database cannot); a server-side check would be an Edge Function (not built).
  - **Image manifest** (how a later batch plugs in): `node scripts/import-site-templates.ts … --images batch/manifest.json` with
    ```json
    { "version": 1,
      "images": [
        { "template": "salon-verve01", "key": "hero", "file": "verve-hero.webp", "source": "ai-generated",
          "generation": { "model": "<model>", "prompt": "<prompt>", "date": "2026-11-02" },
          "intended_use": "A stylist at work in a bright salon" },
        { "category": "transport", "slot": "hero", "file": "moving-hero-1.jpg", "source": "licensed",
          "licence": "<licence name and reference>" },
        { "category": "transport", "slot": "hero", "file": "moving-hero-2.jpg", "source": "own" }
      ] }
    ```
    An entry names one template's key, or a category and slot: several entries for the same category and slot are shared out in turn, so the templates of a category do not all get the same picture; a template's own entry comes first. Files are relative to the manifest, checked by their bytes (PNG, JPEG or WebP, at most 5 MB); every problem is listed before anything is done (`readManifest()`). `--out` copies the images into `<out>/images/<template>/` for review (the thumbnails there still show the earlier images); `--to-flyttgo` uploads them beside the template's images under their hash, records their source and licence or generation, and draws the thumbnail and the browser checks again with them.
  - **Later: companies' own content.** Because every image is a named slot with an intended use (and the brand slot is marked), a company could later replace a slot's picture with its own photo on its site, without touching the template (a per-company override of `site_template_images` by slot). Not built: content editing by companies is a later step.
- **Review:** an imported template is not offered. In Admin → White label → Templates (filter by category and by status) an administrator reads each page (sandboxed preview), edits it to remove sample prices, reviews and claims (the database refuses a page with scripts, handlers, frames or forms, and approval while any price remains), confirms the check and approves; a page flagged hidden is fixed first. A re-imported or edited template goes back to review.
- **Serving:** `white-label-site` renders the requested page with the company's brand (`renderTemplatePage`, which sanitises again), and the browser shows it in an iframe **sandboxed without scripts or same-origin access**. Links leave the frame to the site's other pages or the booking page.
- **Before import:** confirm FlyttGo may use Architect-AI's content (same owner) and the licence of its images (stock photos).

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
- **Booking widget and API keys** for companies' own websites: not built yet (the plans don't list them).

## Tests

- `supabase/tests/white_label.test.sql` (PostgreSQL 16 and 17.6, both schemas; the rollback restores the earlier state exactly): the price list and who changes it; choosing Model A; Model B requirements; plan changes; the database deciding the seller; the split by the server only; no invoice for Model B; who sees bookings; the public page; plan billing and Model B settlement; templates (clean import, review, approval, choice, re-import).
- `supabase/tests/template_quality.test.sql` (00021, both schemas; the rollback restores the earlier state exactly): the catalogue's features, page count and thumbnail; the quality gate (checks stored in the importer's form, approval refused while checks fail or are out of date, approval with a reason recorded, edited pages' results out of date, the panel recording only the checks that need no browser, the importer's re-check); image slots (recorded at import, hidden from companies, licence and generation required by source, replacement only of an uploaded image with its type, size and hash, history kept, a re-import keeping a replaced image, approval of an imported image only with its licence).
- `src/test/template-images.test.ts`: images checked by their bytes (PNG, JPEG, WebP; GIF, SVG and PDF refused), slots and intended use, shared image sets, the manifest (every problem listed, a template's own entry first, a category's images shared out in turn).
- `src/test/template-quality.test.ts`: booking links rewritten at import, address and figure flags, each automated check with and without a browser.
- `src/test/white-label.test.ts` (split, seller notice), `src/test/site-template.test.ts` (sanitiser, import, render, features and "best for", short names, brand slots and logos, long names, escaping, contrast), `src/test/refunds.test.ts` (refunds on a connected account).
