# FlyttGo platform audit, 30 October 2026

Read-only audit of everything FlyttGo offers or says it offers. Nothing was changed, deployed or committed except this file.

**Sources checked**

- Repository `/home/user/FLYTTGO`, branch `claude/vibrant-johnson-awo68u` at `87738f1` (PR #18, open, not merged, "do not merge yet"), compared with `origin/main` at `0061802` (PR #19, the website gallery, merged 30 Oct 01:47).
- Production Supabase project `qzclatvpzicwhewzdiwf` (FlyttGo Norway, eu-central-1, Postgres 17). SELECT queries only: `supabase_migrations.schema_migrations`, `pg_class`/`pg_proc`, row counts (counts only), `cron.job`, `cron.job_run_details`, `storage.buckets`/`storage.objects`, `platform_config` (seller fields reported only as set or empty), `list_edge_functions`, the security advisor, and the deployed `config-check` function through `flyttgo_ops.call_function` (it reports set or missing, never values).
- The live site `https://www.flyttgo.no`: its JavaScript bundle (`/assets/index-DJp__eI-.js` and 89 chunks) was downloaded and searched for text markers.
- GitHub REST API for PR #18 and its CI run.
- Locally: `npm run typecheck` (passes) and Vitest on the branch (24 files, 318 tests, all pass). The database tests (`npm run test:db`) were **not run** in this audit.

**Status words used**

| Status | Meaning |
|---|---|
| **Live** | On `main` (the live site runs `main`), its migration applied in production, its edge function deployed. Live does not mean usable: many live features are blocked by missing secrets (see the "Works today?" column). |
| **Built, not live** | On the branch / PR #18 with tests, but its migration is not in production and/or its function is not deployed and/or `main` lacks it. |
| **Partly built** | Some pieces only (UI without backend, backend without UI, stub, sample data). |
| **Promised only** | Marketing copy claims it; no implementation. |
| **Planned** | In docs, not built. |

---

## Summary

### What FlyttGo can sell today

**Nothing can be sold and paid for end to end today.** Every payment path is blocked by configuration, not by code:

- **Card (Stripe):** `STRIPE_SECRET_KEY` in production holds a webhook signing secret (`whsec_…`), not the API key (`config-check`). Every checkout, refund and Connect call fails.
- **Vipps:** all six Vipps secrets missing, but `enable_vipps_payments = true`, so the Vipps button is shown and fails.
- **Invoice:** the company booking flow exists, but there are 0 companies, and FlyttGo's own seller details (`invoice_seller_name`, `_org_number`, `_address`, `_bank_account`, `_iban`, …) are **all empty** in `platform_config`, so a legal invoice cannot be issued.
- **Email:** `RESEND_API_KEY`, `EMAIL_FUNCTION_SECRET`, `FLYTTGO_FROM`, `FLYTTGO_REPLY_TO` and `FRONTEND_URL` missing: no booking confirmation, invitation, invoice or reminder email can be sent.

What does work in production today, as far as could be checked without making a booking: the public pages; sign-up and sign-in (Supabase Auth; email delivery not verified); address search (Kartverket/Geonorge, called from the browser); price calculation (`calculate-price` deployed, route provider secrets set); creating a booking record; driver application with document upload; the driver job pool; company registration with a Brønnøysund check (public register, no secret needed); the admin dashboard; the website template gallery (PR #19).

### What needs which step

| To sell | Steps needed |
|---|---|
| Private moves paid by card | Replace `STRIPE_SECRET_KEY` with `sk_live_…`; verify both Stripe webhooks; add refund events; set `FRONTEND_URL`; test a payment and a refund in test mode. Then fix the misleading marketing claims (below). |
| Private moves paid by Vipps | Vipps agreement and all `VIPPS_*` secrets; resolve the open Vipps reservation-lifetime question (`DECISIONS.md`, "Still to do"). Or switch `enable_vipps_payments` off until then. |
| Any email | `RESEND_API_KEY`, verified sending domain, `FLYTTGO_FROM`, `FLYTTGO_REPLY_TO`, `EMAIL_FUNCTION_SECRET`. |
| Company bookings on invoice | Fill FlyttGo's seller details in `platform_config`; real org. nr. and MVA nr. in the footer; email set up; first company verified. |
| Driver payouts | An admin payout process: drivers can request a payout (`payout_requests`), but there is no admin screen or function that pays one. |
| White label (Models A and B) | Prices are all `proposed`; **0 of 199 templates are approved** (companies see an empty catalogue); Stripe Connect needs the right Stripe key and `STRIPE_CONNECT_WEBHOOK_SECRET`; `WHITE_LABEL_CNAME_TARGET` unset for own domains. |
| Jobs, appointments (other industries) | Live in the database and UI; need email (reminders), Stripe (card payment of the company's own invoices) and approved prices. |
| Accounting add-on | Authorised accountant's review (`ACCOUNTING_REVIEW.md`), not done. Do not sell before. |
| API, widget, spending approvals, bank import, restaurant/hotel, shop, pilot add-ons | Built on PR #18; migrations 00016–00020 and 00022 not applied; four functions not deployed; legal and accountant gates open (`RELEASE_GATES.md`); CI blocked by GitHub billing. |

### Biggest risks (detail in "Gaps and risks")

1. **Unbacked public claims on the live site**: "Norway's #1", "25,000+ jobs completed", "500+ verified carriers", "500+ companies", "4.8/5", "40+ cities", "42 employees", insurance "up to 500 000 NOK" and "up to 10 M NOK", "24/7 Support", carbon offset via Klimafondet, a 34% EV fleet, a 6-step vetting with background check and interview. Production has 5 user accounts, 5 drivers, 17 bookings (all `pending`, March–April 2026) and 0 payments.
2. **Placeholder legal identity**: the footer shows "Org. nr. NO 000 000 000" and "NO 000 000 000 MVA"; contact phone is a UK mobile (+44).
3. **The payment page asks for card number, expiry and CVC** in FlyttGo's own form, then redirects to Stripe Checkout, which asks again. The typed card data is not sent anywhere (`PaymentPage.tsx` sends only `bookingId` and `method`), but collecting it is misleading and widens PCI exposure.
4. **"Escrow" / "Pay only on delivery"**: card payments are captured at checkout into FlyttGo's Stripe account; "escrow" is an internal ledger state, not a third-party escrow. The badge "Pay only on delivery" is not accurate.
5. **Production schema is ahead of `main`**: migrations 00023–00025 (image library, thumbnail redraw, shared assets) are applied in production but exist only on the branch; their admin UI is not live. The docs still say "not yet applied anywhere".
6. **Contact and corporate sales forms are stubs**: they show "sent" and send nothing.

---

## Counts

| Item | Repo (branch) | `main` | Production | Evidence |
|---|---|---|---|---|
| Page components | 35 (`src/pages/*.tsx` + `auth/callback.tsx`) | 33 | live site serves `main` (bundle has no `ShopPage`/`EmbedPage` chunk; has PR #19 gallery text "No website matches") | `src/pages/`, live bundle |
| Page routes (ids in `PAGE_TO_PATH`) | 44 + dynamic `/b/<slug>`, `/b/<slug>/book`, `/b/<slug>/shop`, `/embed/<slug>` | 42 + `/b/<slug>`, `/b/<slug>/book` | — | `src/lib/pageRoutes.ts`; branch adds `shop`, `embed` |
| Edge functions | 28 | 24 | 25 deployed: the 24 on `main` + legacy `release-escrow` (not in repo, unused) | `list_edge_functions` |
| Functions not deployed | `bank-import`, `public-api`, `shop-checkout`, `shop-refund` | — | — | |
| Migrations | 25 (00001–00025) | 16 (00001–00015, 00021) | 17 recorded: 00002–00015, 00021, 00023, 00024, 00025 (00001 not recorded; production predates it and 00002 reconciles) | `supabase_migrations.schema_migrations` |
| Migrations not applied | 00016, 00017, 00018, 00019, 00020, 00022 | | | |
| Tables (production) | — | — | 101: 89 in `public`, 12 in `accounting`; RLS enabled on all | `pg_class` |
| Unit tests (Vitest) | 24 files, 318 tests, pass (run today) | 13 files | — | `src/test/` |
| DB tests | 23 `*.test.sql` + `rehearsal/` + `accounting_controls/` + `shop_concurrency.sh` | 14 `*.test.sql` | not run in this audit | `supabase/tests/` |
| Scheduled jobs | `schedules.sql` on branch adds `flyttgo-shop-expiry`, `flyttgo-approval-expiry` | 4 | 4 active, all runs `succeeded` | `cron.job`, `cron.job_run_details` |
| Storage buckets | — | — | 6 (see Platform) | `storage.buckets` |

**Production data (counts only):** 5 auth users; 13 profiles (6 customer, 5 driver, 1 business, 1 admin, so at least 8 profiles have no auth account: orphans, kept by decision #17); 5 drivers, 4 driver profiles, 3 driver applications, 4 driver documents (but the `driver-documents` bucket holds **0 files**); 17 bookings, all `pending`, created 2026-03-17 to 2026-04-17; 3 escrow rows; 0 payments, 0 payment events, 0 refunds; 0 organizations, 0 invoices, 0 jobs, 0 appointments; 0 reviews, 0 support tickets, 0 chat messages, 0 driver locations; 199 site templates (all `imported`, **none approved**); 2,189 template images; 153 image-library photos (all `pending`); 6 white-label plans (all `price_status = proposed`); 5 driver subscription plans.

---

## 1. Private customers

| Capability | Status | Works today? | Evidence |
|---|---|---|---|
| Booking a move or delivery (wizard: addresses, details, inventory, schedule, summary) | Live | Yes, creates a booking | `src/components/BookingFlow.tsx`; `bookings` table |
| Address search (official Norwegian address register) | Live | Yes (browser calls Geonorge directly) | `NorwayAddressAutocomplete.tsx` → `ws.geonorge.no` |
| Route distance | Live (client side) | Yes, public OSRM demo server (no SLA, rate-limited), fallback straight line × 1.4 | `src/lib/routing.ts` → `router.project-osrm.org`. The deployed `route-distance` (v8, April, `verify_jwt=true`) is not called by the frontend |
| Server price calculation | Live | Yes (`ROUTE_PROVIDER_KEY/URL` set, kind `ors`) | `calculate-price` v13; `src/lib/calculatePrice.ts`; `_shared/pricing.ts` |
| Card payment (Stripe Checkout; Google Pay / Apple Pay through Checkout's wallets) | Live | **No**: wrong `STRIPE_SECRET_KEY` | `create-checkout-session` v12 (sends `payment_method_types=card`; wallets depend on the Stripe dashboard, not verified); `stripe-webhook` v7 |
| Google Pay as separate option | Partly built | No | Separate button on `PaymentPage.tsx` but it calls the same Stripe Checkout |
| Vipps | Live (code) | **No**: all Vipps secrets missing; button still shown (`enable_vipps_payments=true`) | `create-vipps-session`, `vipps-webhook` v1 |
| Card form on FlyttGo's own page | Partly built (cosmetic) | Collected, never sent | `PaymentPage.tsx` lines ~167, 332–372 |
| "Escrow" (money held until delivery confirmed) | Live as internal ledger | Depends on payment | `escrow_payments`, `process-payment` v11 (dual confirmation), wallet settlement trigger (00003). Card is captured at checkout (no manual capture in `create-checkout-session`) |
| Live tracking (driver location, map) | Live | Only once a driver shares GPS; 0 location rows | `DriverPortal.tsx` pushes `driver_locations` ~10 s; `DriverTrackingMap.tsx`, `TrackingPage.tsx` |
| Tracking map geocoding | Partly built | Falls back to city estimates | `DeliveryMap.tsx` calls `geocode-address`, **a function that does not exist** in repo or production |
| Cancellation with automatic refund (24 h rule, 50 %) | Live | **No** for card (Stripe key) and Vipps (secrets) | `cancel-booking` v1; `src/lib/cancelBooking.ts`; 00006 `stamp_booking_cancellation` |
| Admin refunds | Live | No (same reason) | `refund-payment` v1 |
| Booking emails | Live (code) | **No**: `RESEND_API_KEY` missing | `send-booking-email` v1 |
| My bookings, repeat booking, confirm completion | Live | Yes | `MyBookings.tsx`, `CustomerDashboard.tsx` |
| "Loyalty points" on each booking | Partly built | Display only (price/100), nothing stored or redeemable | `MyBookings.tsx` ~line 249; `loyalty_points` table empty, no UI |
| Receipts / invoices for private customers | Partly built | Not verified; no private-customer invoice found | Invoicing (00008) is for companies |
| Profile, language | Live | Yes | `ProfilePage.tsx`, `src/lib/i18n.ts` (en, no) |
| Sign-in with Google / Apple | Live (code) | Not verified (provider config in Supabase not checked) | `src/lib/auth.tsx`; `docs/apple-oauth-setup.md` |
| Reviews / rating drivers | Promised only | No | `reviews` table exists (0 rows), no UI to write a review found; marketing says "live rating system" |
| "File a claim" from My Bookings | Promised only | No such button | `SafetyPage.tsx` CLAIM_STEPS; FAQ |
| In-app chat with driver | Promised only | No UI found | `chat_*` tables (0 rows); claimed in meta description of `tracking` and `PrivacyPage` |
| Help centre / support | Partly built | Static articles; contact form is a stub | `HelpCenterPage.tsx`; `ContactPage.tsx` `submit()` only sets "sent" (comment: "client-stub until the send-contact-message Edge Function is wired up") |
| Jobs and appointments with companies (customer side) | Live | Yes, if a company existed (0 today) | `ServiceBookingPage.tsx`, `MyServicesPage.tsx` |

## 2. Drivers

| Capability | Status | Works today? | Evidence |
|---|---|---|---|
| Application and onboarding (4 documents: licence, vehicle insurance, registration, ID) | Live | Yes (upload path) | `DriverOnboarding.tsx`, `driver_applications`, bucket `driver-documents` |
| Application status page | Live | Yes | `DriverApplicationStatusPage.tsx` |
| Admin approval of applications | Live | Yes | `AdminDashboard.tsx` tab `applications` |
| Background check, interview, BankID, goods-in-transit policy check | Promised only | No | `SafetyPage.tsx` VETTING_STEPS; the onboarding asks only for "Vehicle Insurance… commercial use", not goods-in-transit cover |
| Subscription plans (Free, Basic, Pro Mini 149/day, Pro 1 500/mo, Unlimited 2 449/mo) | Live | Free/Basic yes; paid plans **no** (Stripe/Vipps) | `subscription_plans` (5 rows); `change_driver_subscription` (00003 refuses paid plans without payment); `DriverPortal.tsx` lines ~320–349 |
| Subscription expiry | Live | Yes, hourly job runs | cron `auto-downgrade-expired-subscriptions` |
| Job pool and claiming jobs | Live | Yes | `driver_job_pool`, `claim_job` (00003/00006) |
| "AI dispatch" | Promised only | No AI exists | `platform_config.enable_ai_dispatch = true`, no code reads it as AI |
| Live location | Live | Yes when the portal is open | `DriverPortal.tsx` |
| Wallet and escrow release to wallet | Live | Only after a paid booking (none yet) | `driver_wallets`, `process-payment`, `settle_driver_wallet_after_release` |
| Payouts ("weekly payouts" claimed) | Partly built | Request only; **nobody can pay one out** | `DriverPortal.tsx` line ~399 inserts `payout_requests`; 00003 says "processed by an administrator"; no admin tab or function processes them |
| Driver terms | Live | Text | `DriverTermsPage.tsx` |

## 3. Companies (business customers)

| Capability | Status | Works today? | Evidence |
|---|---|---|---|
| Company registration | Live | Yes (0 companies so far) | `RegisterCompany.tsx`, `create_organization` (00005) |
| Brønnøysund verification before activation | Live | Yes (public register) | `verify-organization` v1, `_shared/brreg.ts`, `organization_verifications` (00006) |
| Team, roles, invitations by email | Live | Roles yes; **invitation email no** (Resend) | `TeamPanel.tsx`, `send-organization-invitation` v1, `AcceptInvitationPage.tsx` |
| Company bookings ("Book for" a company) | Live | Yes | 00007, `CompanyBookings.tsx` |
| Booking on invoice | Live | Blocked: seller details empty, no company, no email | `book-on-invoice` v1, 00008 |
| Credit check | Live, deliberately off | Off (`credit_check_enabled=false`, `CREDIT_CHECK_API_KEY` missing) | `credit-check` v1, decision #21 |
| FlyttGo's invoices to companies (numbering, credit notes, KID, PDF, EHF, reminders, daily run) | Live | Engine yes; issuing blocked by empty seller details; sending blocked by Resend | 00008, `invoice-run` (cron 05:15 UTC), `invoice-document`, `invoice-send`; `docs/INVOICING.md` |
| Bank file import (Nets OCR, camt.053/054, matched by KID) | Built, not live | No | 00016 not applied; `bank-import` not deployed; `BankFileImport.tsx`, `_shared/bank-files.ts`; gate: accountant |
| Spending limits and approvals | Built, not live | No | 00017 + 00022 not applied; cron `flyttgo-approval-expiry` not installed; `_shared/spending.ts`, `CompanyBookings.tsx` |
| API keys and REST API `/v1` | Built, not live | No | 00018 + 00022 not applied; `public-api` not deployed; `docs/API.md`, `docs/api/openapi.yaml`; gate: lawyer (API terms) |
| Booking widget (`/embed/<slug>`) | Built, not live | No | `EmbedPage.tsx`, `_shared/widget.ts`, 00018; route only on branch |
| Bulk booking via CSV / API / ERP | Promised only | No | `CorporateBulkBookingPage.tsx` ("Upload thousands of delivery orders via CSV, API, or direct ERP integration") is a marketing page; no upload |
| Recurring deliveries | Promised only | No | `RecurringDeliveriesPage.tsx` = "Coming soon..."; `CorporatePage.tsx` claims "automatic driver assignment" |
| Corporate plans Starter (0) / Business (1 490 NOK/mo) / Enterprise | Promised only | No | `CorporatePage.tsx` PLANS; no such plans in the database |
| Corporate dashboard (shipments, drivers, analytics, documents, support tabs) | Partly built | Sample figures; labelled "Sample data" for signed-in members, **unlabelled for visitors** ("View Dashboard Demo") | `CorporateDashboard.tsx` `SAMPLE_TABS`, line ~213 |
| Accounting add-on (ledger, vouchers, MVA codes, SAF-T, back office for accountants) | Live (schema and UI) | Do not sell: accountant review open; 0 ledgers | 00014, 00015, `src/accounting/`, `AccountingPage.tsx`, `accounting-invite` v1; `docs/ACCOUNTING_REVIEW.md` |
| White label: plans and prices page | Live | Yes, prices shown as proposals | `WhiteLabelPlansPage.tsx`, `white_label_plans` (6, all `proposed`) |
| White label: seller models A (FlyttGo sells) and B (company sells) | Live (code) | Model B needs Stripe Connect (blocked) | 00009, `stripe-connect` v1, `STRIPE_CONNECT_WEBHOOK_SECRET` missing |
| Own page `/b/<slug>`, subdomain, own domain | Live | Domain check needs `WHITE_LABEL_CNAME_TARGET` (unset) | `white-label-site` v2, `white-label-domain` v1, `BrandSitePage.tsx`, `middleware.ts` |
| Website template catalogue and gallery | Live (PR #19) | Companies see **no template**: 0 of 199 approved | 00021; `TemplateGallery.tsx`, `TemplateCatalogue.tsx`; `site_templates.status` all `imported` |
| Image library (shared, reviewed photos) | Database live, UI and function not live | No: 153 photos all `pending`; admin UI only on branch; deployed `white-label-site` (v2, 30 Oct 00:45 UTC) predates 00023 | 00023 applied; `ImageLibraryAdmin.tsx`, `SiteImages.tsx`, `_shared/image-library.ts` on branch only |
| Company's own photos | Database live, UI not live | No | `organization_site_images` (00023), `set_organization_site_image`; UI `SiteImages.tsx` branch only |
| Thumbnail redraw, one stored copy of template images | Database live, scripts not run | Not run: `site_template_asset_moves` = 0 | 00024, 00025 applied; `scripts/redraw-thumbnails.ts`, `scripts/dedupe-template-assets.ts` |
| AI photo pilot (OpenAI gpt-image-1) | Built (script), not run | No | `scripts/generate-library-images.ts`; gate: owner confirms OpenAI terms |
| Add-on modules and pilot pricing | Built, not live | No | 00022 not applied; `organization_addons`, `admin_set_white_label_pilot_price` |

## 4. Other industries (service platform)

| Capability | Status | Works today? | Evidence |
|---|---|---|---|
| Jobs (trades: quotes, scheduling, items, invoicing; authorisations such as DSB) | Live | Yes in principle; 0 companies | 00010, 00012; `JobsPanel.tsx`; `organization_authorisations` |
| Appointments (services, resources, opening hours, slots, reminders) | Live | Booking yes; reminder email **no** (Resend) | 00013; `AppointmentsPanel.tsx`; `appointment-reminders` (cron hourly :10) |
| Invoices in the company's own name, card payment into its own Stripe | Live | Issuing yes; card payment no (Stripe) | 00011; `SalesInvoicesPanel.tsx`; `pay-sales-invoice` v1 |
| Restaurant table reservations | Built, not live | No | 00019 not applied; `RestaurantPanel.tsx`; gates: lawyer (cancellation/no-show), accountant (MVA on fees) |
| Hotel room reservations | Built, not live | No | 00019; `HotelPanel.tsx`; gate: lawyer on guest register; guest register not built (`SERVICE_PLATFORM.md`) |
| Online shop (catalogue, stock, orders, refunds, "My orders") | Built, not live | No | 00020 not applied; `shop-checkout`, `shop-refund` not deployed; `ShopPage.tsx`, `ShopPanel.tsx`; four lawyer gates, one accountant gate |
| Health businesses | Excluded by decision | — | Decision #31 |
| Hotel channel managers, restaurant POS, deposits, waiting lists | Planned (not built) | — | `SERVICE_PLATFORM.md` lines ~160–161 |

## 5. FlyttGo administration

| Capability | Status | Evidence |
|---|---|---|
| Admin dashboard: overview, fleet map, drivers, bookings, applications, revenue, disputes, companies, invoicing, white label, accounting, settings | Live | `src/components/AdminDashboard.tsx` (tabs at line ~146); `admin/CompaniesPanel.tsx`, `InvoicingPanel.tsx`, `WhiteLabelAdminPanel.tsx`, `AccountingAdminPanel.tsx` |
| CSV export of drivers and bookings | Live | `downloadCsv()` in `AdminDashboard.tsx` |
| Platform settings (price per km, minimum price, auto-approval, escrow, surge …) | Live | `platform_config` (38 keys) |
| Template review and quality checks | Live | 00021; `admin_review_site_template`, `record_site_template_checks` |
| Image library admin, thumbnails admin | Built, not live (UI) | `ImageLibraryAdmin.tsx`, `redraw.ts` branch only; database functions applied |
| Payout processing | Not built | No tab; see Drivers |
| Admin escrow release | Live | `process-payment`; legacy `release-escrow` still deployed, unused |
| Reports | Partly built | Revenue tab reads real tables; corporate analytics are samples |
| FlyttGo administrators cannot read companies' books or change their photos | Live (books), applied (photos) | Decisions #35, #48 |

## 6. Platform and operations

### Secrets (deployed `config-check`, 30 Oct 2026)

| Secret / setting | State | Consequence |
|---|---|---|
| `STRIPE_SECRET_KEY` | **set, but holds a webhook signing secret (`whsec_`)** | every Stripe call fails |
| `STRIPE_WEBHOOK_SECRET` | set (`whsec_`) | — |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | missing | Model B, shop payments not recorded |
| `RESEND_API_KEY`, `EMAIL_FUNCTION_SECRET` | missing | no email |
| `VIPPS_CLIENT_ID`, `_CLIENT_SECRET`, `_SUBSCRIPTION_KEY`, `_MSN`, `_WEBHOOK_SECRET` | missing | no Vipps |
| `CREDIT_CHECK_API_KEY` | missing | credit check off (by decision) |
| `ROUTE_PROVIDER_KEY`, `ROUTE_PROVIDER_URL` | set (kind `ors`) | pricing works |
| `FRONTEND_URL`, `FLYTTGO_FROM`, `FLYTTGO_REPLY_TO`, `WHITE_LABEL_CNAME_TARGET`, `VIPPS_MODE` | not set | redirects after payment, email sender, own domains |

### Other operations

| Item | State | Evidence |
|---|---|---|
| Scheduled jobs | 4 active (`flyttgo-accounting-cancellations` 00:20, `auto-downgrade-expired-subscriptions` hourly, `flyttgo-invoice-run` 05:15, `flyttgo-appointment-reminders` hourly :10); all recorded runs `succeeded` (scheduling level); retained `net._http_response` rows all 200. Branch jobs `flyttgo-shop-expiry`, `flyttgo-approval-expiry` not installed | `cron.job`, `supabase/ops/schedules.sql`, `docs/SCHEDULES.md` |
| Extensions | pg_cron 1.6.4, pg_net 0.20.0 (in schema `public`), vault, pgcrypto | `pg_extension` |
| RLS | Enabled on all 101 tables (P0 hardening, 00003) | `pg_class.relrowsecurity` |
| Security advisor | 0 errors. Warnings: 39 functions with mutable `search_path`; `pg_net` in `public`; 17 SECURITY DEFINER functions executable by `anon` (mostly trigger functions and helpers such as `is_admin()`, `accounting_tier(p_ledger, p_month)`, `available_slots`, `org_has_module`); 128 executable by `authenticated`; tables visible in GraphQL schema (63 anon, 99 authenticated; RLS still applies); **leaked-password protection off**; 2 tables with RLS and no policy (`accounting.counters`, `public.invoice_counters`: closed to the browser, used by definer functions) | `get_advisors` (security) |
| Backups | Schema `backup_20261029` (copy of 52 tables, 103 rows, before 00002–00015). Supabase's own backups/PITR not verified | `docs/PRODUCTION_DEPLOY_2026-10-29.md` |
| Storage | `site-template-assets` (public, 2 388 objects, 588 MB), `site-image-library` (public, 153, 26 MB), `driver-documents`, `ledger-attachments`, `organization-logos`, `organization-site-images` (all private, 0 objects). `DECISIONS.md` #51 says the Free plan's storage is exceeded; the plan itself was not verified | `storage.buckets` |
| CI | Every GitHub Actions job on PR #18 fails in 3–4 s with "recent account payments have failed or your spending limit needs to be increased" | `.github/workflows/ci.yml`; check run 124103862682 |
| Vitest config | Picks up the copies in `.claude/worktrees/` (188 files, 2 273 tests when run from the repo root); the branch's own suite is 24 files / 318 tests | `npx vitest run` |
| Deployment | Vercel builds `main` (verified: live bundle contains PR #19 text, no branch-only pages); edge functions deployed by connector without JWT verification as `docs/DEPLOYMENT.md` requires (except the old `route-distance`, `verify_jwt=true`) | `vercel.json`, `list_edge_functions` |
| Release rehearsal | On the production replica, locally passed per `RELEASE_GATES.md`; disposable test project not done | `supabase/tests/rehearsal/` |

## 7. Marketing and public pages

All claims below were found in the **live** bundle (searched for "#1 Mov", "25,000+", "500 000 NOK", "24/7", "500+", "4.8/5", "+44 7432"). Production reality: 5 user accounts, 5 drivers, 17 pending bookings, 0 payments, 0 companies.

| Page / place | Claim (quoted) | Backed? | Evidence |
|---|---|---|---|
| Home, About, page titles | "Norway's #1 Moving Marketplace · 25,000+ Jobs Completed"; title "FlyttGo — Norway's #1 Moving Marketplace" | **No** | `src/lib/locales/en.ts` line ~476, `pageRoutes.ts` PAGE_TITLES |
| Home | "⭐ 4.8/5 rating"; "Book your move in under 60 seconds" | No (0 reviews) | `HomePage.tsx` ~283; `en.ts` ~162, ~483 |
| About | "500+ verified carriers, 25,000+ jobs delivered", "40+ cities", "4.8★", "launched in Oslo with 12 pre-vetted drivers. First week: 42 completed jobs and a 4.9 average rating", "Average driver match in under 30 seconds" | No | `AboutUsPage.tsx` ~138–141; `en.ts` ~517, ~527, ~531 |
| Press | Founded 2024, 42 employees, 500+ carriers, 40+ cities, 25,000+ jobs; brand-asset downloads | No; downloads are `href="#"` | `PressPage.tsx` lines 18–23, 88 |
| Business pages (5 of them) | "Join 500+ companies using FlyttGo Corporate across Norway" | No (0 companies) | `en.ts` ~1014, 1058, 1102, 1146, 1190 |
| Corporate | "SLA-guaranteed delivery", "Dedicated account manager", plans Starter/Business 1 490/Enterprise, "Recurring Deliveries … automatic driver assignment", industries incl. Healthcare | No | `CorporatePage.tsx` lines 4–20; sales form `handleSubmit()` only sets "sent" |
| API page (`main`, live) | "full CRUD operations on bookings, drivers, and tracking", "Webhooks", "Bulk Operations", "OAuth 2.0, API key rotation, IP whitelisting", "SDKs for Node.js and Python", "Sandbox Environment", "Credentials issued within 24 hours", "monitors your integration for the first 30 days" | **No**: no API is deployed; even the branch's API has no webhooks, OAuth, IP lists, SDKs, sandbox, bulk or driver endpoints (`docs/API.md` "Not built"). The branch rewrites the page honestly ("No SDKs yet", "No separate sandbox yet") | `git show origin/main:src/pages/CorporateApiAccessPage.tsx` |
| Bulk booking page | "Upload thousands of delivery orders via CSV, API, or direct ERP integration" | No | `CorporateBulkBookingPage.tsx` line 52 |
| Recurring deliveries | page says "Coming soon..." while Corporate page sells it | No | `RecurringDeliveriesPage.tsx` |
| Safety | "6 checks": BankID/passport, Brønnøysund, insurance with "Gjensidige, If, Tryg", PKK/SVV vehicle check, background check, interview; "re-verify every 12 months"; "Goods in transit Up to 500,000 NOK"; "Public liability Up to 10 M NOK"; "fewer than 1 in 500 bookings as claims"; "If the driver's insurance denies without cause, FlyttGo covers it" | **No**: onboarding asks for 4 uploads only; no background check, interview, SVV or BankID integration; no insurance policy recorded; the footer has `TODO: real carrier name` | `SafetyPage.tsx` lines 6–25; `Footer.tsx` line ~269 |
| Footer, FAQ | "Goods-in-transit cover up to 500 000 NOK per booking"; "We verify the policy before they can accept jobs" | No | `en.ts` lines 52–53, FAQ ~38–41 |
| Footer | "Org. nr. NO 000 000 000", "NO 000 000 000 MVA" (TODO placeholders); social icons `href="#"` | Placeholder | `Footer.tsx` lines 146, 256, 263 |
| Contact | phone and WhatsApp "+44 7432 112438"; "Support available 7 days a week, 08:00–22:00"; "Typical reply within 2 hours"; form | Phone not verified; form is a stub | `ContactPage.tsx` lines 29–45 |
| Help, trust badges | "24/7 Support"; "We're here seven days a week" | Not backed by any support system (`support_tickets` 0, no UI) | `en.ts` ~853, ~607 |
| Sustainability | "Over 34% of our Oslo fleet is now electric", "−28% empty miles", "1,000+ reusable kits", "100% reusable kit", "1% … via Klimafondet. You get a certificate in your receipt", "tick the EV-only option at checkout" | **No**: no EV field, no EV-only option, no offset, no certificate | `SustainabilityPage.tsx` lines 10–82; `en.ts` sustainability |
| Careers | 4 open roles, "small, profitable", "used by thousands of Norwegians every week", options, 15 000 NOK learning budget | Not verified; usage claim contradicted by data | `CareersPage.tsx` |
| Payment page, Home | "Escrow Protection · Pay only on delivery"; "held safely in escrow" | Misleading: captured at checkout | `en.ts` ~452–466 |
| Payment page | "Invoices are generated on the 1st of each month. 30-day payment terms. Requires active Corporate plan." | Partly wrong: terms are 14/30/custom/fixed day (decision #20); no "Corporate plan" exists | `en.ts` ~440 |
| Services | "registered Norwegian carriers with goods-in-transit insurance", "IKEA compatible", "SLA-backed delivery" | No | `ServicesPage.tsx`, `en.ts` ~1226, ~1250 |
| Corporate dashboard demo (visitors) | "Active Shipments 24", "Monthly Spend 142,400 NOK", "Carbon Footprint 2.4 tCO₂", "On-Time Delivery 96.2%", invoices "INV-2026-04 … 89,200 NOK" | Sample, unlabelled for visitors | `CorporateDashboard.tsx` ~213–231, ~373 |
| Terms, Privacy, Liability, Driver terms, White-label DPA | Legal texts | Need legal review (`DECISIONS.md` "Still to do"; Terms dates `LAST_UPDATED`/`EFFECTIVE_DATE` to be set); DPA version `2026-10-draft` | `TermsPage.tsx`, `WhiteLabelDpaPage.tsx`, `platform_config.white_label_dpa_version` |
| Van guide, moving checklist | Informational | Fine | `VanGuide.tsx`, `MovingChecklist.tsx` |
| White-label plans page | Plans and who does what, prices as proposals | Backed (proposed prices) | `WhiteLabelPlansPage.tsx` |

Public pages on `main` (33 components): Home, Services, Van guide, Checklist, Driver subscriptions, Become a driver, Business, Bulk booking, Recurring deliveries, Dashboard tour, Invoicing, API, White label, White-label DPA, Terms, Privacy, Liability, Driver terms, About, Contact, FAQ, Help, Safety, Careers, Press, Sustainability, 404, plus the signed-in pages (dashboards, payment, tracking, profile, my services, accounting, invitations, brand site, auth callback). The branch adds `/shop`, `/b/<slug>/shop` and `/embed/<slug>`.

---

## What blocks each built-but-not-live feature

| Feature (PR #18) | Migration | Functions | Secrets | Release gates open (`docs/RELEASE_GATES.md`) |
|---|---|---|---|---|
| Bank import | 00016 | `bank-import` | — | accountant: rollback policy, KID matching review |
| Spending limits and approval | 00017, 00022 | changed `book-on-invoice`, `create-checkout-session`, `create-vipps-session`, `send-booking-email` | Resend | cron `flyttgo-approval-expiry`; approval emails tested |
| API and widget | 00018, 00022 | `public-api`, changed `white-label-site` | — | API add-on only with a recorded price; widget `frame-ancestors` checked on Vercel preview; lawyer: API terms |
| Restaurant and hotel | 00019 | changed `white-label-site`, `appointment-reminders` | Resend | lawyer: guest register, cancellation/no-show terms; accountant: MVA on fees |
| Online shop | 00020 | `shop-checkout`, `shop-refund`, changed `stripe-webhook` | correct Stripe key, Connect webhook secret, refund events | lawyer: order button, withdrawal form, return costs, shop terms; accountant: EHF rounding |
| Pilot pricing, add-ons | 00022 | changed `white-label-site` | — | owner approval |
| Image library, thumbnails, shared assets (UI) | applied (00023–00025) | branch `white-label-site` | — | owner: licences of every photo, OpenAI terms for AI images, approve dedupe `--apply`, merge to `main` |
| All of the above | — | — | — | CI green (blocked by GitHub billing); disposable test-project rehearsal; owner approval of production migrations and merge; deployment order |

Note: the branch's `white-label-site` calls `org_modules` (00022) and `widget_origins_public` (00018), which production does not have. It tolerates the missing functions (empty list), but then a company on a Jobs or Appointments plan would get no module (`bookingFor([])`), so deploying it before 00022 could change what non-transport company pages offer. Not tested in this audit; deploy it only in the documented order.

## Gaps and risks

**Misleading to users (live now)**

1. Fabricated scale and reputation figures (section 7) on Home, About, Press, Corporate and every business page. Under Norwegian marketing law (markedsføringsloven) these need evidence or removal.
2. Insurance limits, vetting steps, carbon offset, EV share and "FlyttGo covers it" promises with no policy, process or code behind them.
3. Placeholder org. nr. and MVA nr. in the footer of every page.
4. "Pay only on delivery" while card payments are captured at checkout.
5. Vipps offered while it cannot work; card form that collects data it never uses.
6. Contact and corporate sales forms that say "sent" and send nothing (enquiries are lost).
7. The live API page promises an API that does not exist in production.
8. Visitors' corporate dashboard demo shows invented figures without the "Sample data" label.

**Broken or incomplete flows**

9. No end-to-end payment possible (Stripe key, Vipps, invoice seller details).
10. No email at all (Resend), which also breaks invitations, invoice delivery and appointment reminders.
11. Driver payouts: requests can be made, nobody can process them.
12. `geocode-address` called by the tracking map does not exist (falls back to city estimates).
13. 0 of 199 templates approved and 0 of 153 library photos approved: the white-label catalogue is empty for companies.
14. 4 driver-document rows but 0 files in `driver-documents` (legacy rows; decision #17 keeps orphans), and 8+ profiles without an auth account.
15. `release-escrow` (legacy) is still deployed with `verify_jwt=false`; it is unused by the frontend. Not inspected (its source is not in the repo); consider removing it after review.
16. Booking distance relies on the public OSRM demo server from the browser (no SLA); the authoritative price comes from `calculate-price`.

**Schema and repository drift**

17. Production has 00023–00025 that `main` does not have; `main` must not be redeployed with an older schema expectation in mind, and the docs (`WHITE_LABEL.md` lines ~98, 111, 156; migration headers "NOT YET APPLIED ANYWHERE") are out of date.
18. 00023 was written to run "after 00022" but was applied without it (`supabase/ops/production-apply-00023-00024.sql` states it was tested on that state). Applying 00022 later must be checked against the image-library objects already present (the rehearsal covers 00016–00025 on the replica per the 00025 header; not re-verified here).
19. Every table and function `main`'s frontend calls exists in production (checked: 0 missing of 118 names), so no live page calls a missing table; the only missing backend found is `geocode-address`.

**Security**

20. Leaked-password protection is off in Supabase Auth.
21. 17 SECURITY DEFINER functions are executable by `anon` (advisor). Most are trigger functions (not callable as RPC) or boolean helpers; `accounting_tier(p_ledger, p_month)` and `available_slots` deserve a check that they reveal nothing about another company.
22. 39 functions with mutable `search_path`; `pg_net` in schema `public`.
23. Public buckets `site-template-assets` and `site-image-library` serve photos whose licences are not yet confirmed (all library photos pending; 53 "AI-generated (suspected)", 44 + 1 "origin unknown").
24. CI does not run at all; only local runs exist.

**Legal and accounting**

25. Open lawyer and accountant gates for every PR #18 feature, the accounting add-on (`ACCOUNTING_REVIEW.md`), the cancellation terms and MVA wording (`DECISIONS.md` "Still to do").
26. White-label DPA is a draft (`2026-10-draft`); white-label support email and phone are empty.

## Planned or documented, not built

| Item | Where |
|---|---|
| API webhooks, cancel/change through the API, bulk endpoints, sandbox, SDKs, IP allow-lists, OAuth | `docs/API.md` "Not built" |
| Automatic bank fetching (needs a bank or Nets agreement) | `docs/INVOICING.md`, `RELEASE_GATES.md` (off by requirement) |
| Hotel guest register; hotel channel managers; restaurant POS, deposits, floor plan, waiting lists | `docs/SERVICE_PLATFORM.md` lines ~93, 160–161 |
| Regulated finance industries | `docs/SERVICE_PLATFORM.md` line ~128 |
| Accounting: reverse charge, import MVA, adjustments, mixed use | `docs/ACCOUNTING_REVIEW.md` line ~23 |
| Vipps reservation lifetime and a payment flow for over-time extras | `docs/DECISIONS.md` "Still to do" |
| Contact-form function (`send-contact-message`) | comment in `ContactPage.tsx` |
| Notifications (push/in-app) | `docs/notifications-spec.md`, `notifications` table (0 rows); not verified how much is wired |
| Driver identity cleanup (`drivers` legacy table) | `DECISIONS.md` #16 |

## Not verified in this audit

- Database tests (`npm run test:db`) and the release rehearsal: not run here.
- Supabase Auth settings (email confirmation, SMTP, Google/Apple providers) and Supabase backups/PITR.
- The Supabase plan and storage quota (quoted from `DECISIONS.md` #51).
- Stripe dashboard (wallets, webhooks), Vercel project settings and domains beyond the live bundle check.
- Source of the deployed `release-escrow` and whether the deployed `route-distance` matches the repo.
- Whether FlyttGo AS exists with an org. nr., and any insurance policy.
