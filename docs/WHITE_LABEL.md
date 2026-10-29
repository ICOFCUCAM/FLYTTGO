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

Architect-AI's `site_masters` (210 generated five-page websites, about 50 for moving and logistics) are brought in as a template library:

- **Import:** `scripts/import-site-templates.ts` reads Architect-AI (service key) or an export file, prepares each template (`prepareTemplate`: strips scripts, event handlers, `javascript:` links, frames, forms, external styles and images and refreshes; turns the sample company's name, phone and email into placeholders; points quote forms and links at the booking page; lists prices, reviews and claims to check), and writes a review folder with `report.md`. With `--to-flyttgo` it copies the images into the `site-template-assets` bucket and stores each template through `import_site_template` (server only). **Running it against FlyttGo needs the owner's approval.**
- **Review:** an imported template is not offered. In Admin → White label → Templates an administrator reads each page (sandboxed preview), edits it to remove sample prices, reviews and claims (the database refuses a page with scripts, handlers, frames or forms, and approval while any price remains), confirms the check and approves. A re-imported or edited template goes back to review.
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
- `src/test/white-label.test.ts` (split, seller notice), `src/test/site-template.test.ts` (sanitiser, import, render), `src/test/refunds.test.ts` (refunds on a connected account).
