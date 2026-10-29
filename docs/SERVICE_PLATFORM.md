# The platform for other industries

FlyttGo also gives companies outside moving and logistics their booking, invoicing and website, on the same platform (owner's decision, 2026-10-29; [`DECISIONS.md`](DECISIONS.md) #26–31). **Transport launches first; this is built and ready.**

Migrations, all unapplied: `00010_service_platform.sql` (core), `00011_company_invoicing.sql` (invoices in a company's own name), `00012_jobs.sql` (trades), `00013_appointments.sql` (appointments), `00020_shop.sql` (online shops). Each has a rollback in `supabase/rollback/` that restores the state before it exactly (tested). It follows the same procedure as the rest: [`SECURITY_P0.md`](SECURITY_P0.md) §5 and [`COPY_OF_PRODUCTION_TEST_PLAN.md`](COPY_OF_PRODUCTION_TEST_PLAN.md).

## The shape

One core shared by every company: companies, teams and roles, verification, plans, payments (Stripe Connect), invoicing, white-label pages and the website template library. Booking modules sit beside each other, each with its own tables:

| Module | For | Status |
|---|---|---|
| Transport | Moving and delivery (FlyttGo's engine, drivers, dispatch, escrow) | Unchanged; launches first |
| Jobs (`jobs`) | Trades and home services: work at the customer's address | Built |
| Appointments (`appointments`) | Time slots with staff or rooms | Built |
| Shop (`shop`) | Selling goods: catalogue, stock, orders, returns | Built |
| Invoicing in the company's name (`sales_invoicing`) | Every company outside transport | Built |

A company states its **industry**. What it can use comes with its **plan** (`white_label_plans.modules`), checked in one place, `org_has_module()`: the company is active and its active plan includes the module.

**Outside transport the company is always the seller.** FlyttGo cannot sell a plumber's or an electrician's work in its own name, so Model A (FlyttGo sells) is for moving and delivery only; the database refuses anything else (`white_label_plans_modules_check`, `white_label_missing`). FlyttGo's moving engine refuses bookings on non-transport plans (`guard_booking_transport_plan`).

## Plans and prices (proposals until FlyttGo confirms them)

| Plan | For | Set-up | Monthly | Modules |
|---|---|---|---|---|
| Website and invoicing | Any industry | 1 900 | 690 | invoicing |
| Jobs | Trades (`field_service`) | 4 900 | 1 290 | jobs, invoicing |
| Appointments | Appointment businesses | 2 900 | 990 | appointments, invoicing |
| Online shop | Any industry except transport and health | 2 900 | 990 | shop, invoicing |

Excluding MVA. All of them need: an active company, customer service email and phone, the company's terms and privacy notice, and the data processing agreement accepted by an owner. Card payments need the company's own Stripe account (optional; required for Online shop, where card is the only way to pay). A company has one plan, so a salon on Appointments cannot also run a shop today; a combined plan is the owner's to decide. Shown on `/business/white-label` beside the transport plans; FlyttGo confirms or changes prices in Admin → White label. Billed monthly by the invoice run, like the transport plans.

## Invoices in the company's own name (00011)

FlyttGo's invoice engine (00008) issues a company's own sales invoices:

- `issuer_org` is the selling company; FlyttGo's own invoices have none. Each company has its own number series (`org:<id>`) without gaps, and KIDs are unique per series.
- The seller on the invoice comes from the company's **invoice settings** (legal name, address, bank account, terms, reminder fee, interest); the invoice cannot be issued until they are filled in. The buyer is a person or a business, linked to their account when they have one.
- The company's owners, admins and finance operate its invoices (issue, payments, reminders, credit notes, email). The buyer reads their own. FlyttGo administrators read but do not operate a company's books.
- Same rules as FlyttGo's invoices: legal content, final once issued, credit notes, never more paid than owed, PDF and EHF. The PDF is the company's throughout (no "issued by FlyttGo").
- The buyer can pay by card into the company's Stripe account (`pay-sales-invoice`; `stripe-webhook` records it once the account and amount match). FlyttGo takes no fee from these payments.
- Emails go from FlyttGo's sending address with the company's name; replies go to the company.
- **Bookkeeping stays with the company and its accountant.** The invoices are the company's accounting records (keep 5 years). Export to Fiken, Tripletex or PowerOffice is the next integration (below).

## Jobs (00012)

`request → (quote → accept) → schedule → start → complete → invoice`

- **Services:** fixed price, hourly price or "on quote" (prices incl. MVA), optional call-out fee, and the authorisation the work needs.
- **Request:** a signed-in customer asks for a job at an address with what needs doing and when suits them. A fixed or hourly price is agreed by booking; a quote is sent by the company (amount, what it covers, valid days) and accepted or declined by the customer. The company can also record a job taken by phone, without a customer account.
- **Scheduling:** a time window and a worker (role `staff`, or an owner or admin). Staff see only the jobs given to them.
- **Job report:** hours, materials and other lines (excl. MVA); completing adds the agreed price (fixed or quote) and the call-out fee.
- **Invoice:** from the job report, in the company's name, to the customer at the job's address.
- **Cancellation:** the customer online until 24 hours before the window; the company until the job is completed.
- **Authorisations:** a service that needs one (electrical, plumbing, gas, pest control, refrigerants, chimney) is booked only while FlyttGo has a valid authorisation on record (`organization_authorisations`, recorded by an administrator with what was checked; revoked with a reason, kept as evidence). Example: electrical contractors must be registered with DSB (elvirksomhetsregisteret).
- Every step goes to `job_events` (append-only).

## Appointments (00013)

- **Set-up:** services (duration, buffer after, price), staff or rooms ("resources", each offering some services and optionally linked to a member's account), weekly opening hours, time off, and the company's rules: cancellation notice, slot step, booking horizon, minimum notice, optional no-show fee.
- **Free times:** `available_slots()` computes them in Europe/Oslo from the hours, minus booked appointments with their buffers and time off. Visitors see them before signing in.
- **Booking:** a signed-in customer books a free time with a person or "anyone". A lock per resource means two people never get the same time. The company can book a phone customer, also outside the hours, never over another appointment.
- **After:** completed or no-show (by the company or the staff member); invoice of the service, or of the no-show fee when the company has one.
- **Reminders:** `appointment-reminders` (hourly) emails customers the day before, once each.
- **Cancellation:** the customer up to the company's notice; after that only the company.

## Online shops (00020)

`cart → order (stock held) → card payment → receipt → packed → shipped / ready for pickup → delivered / collected`, and `withdrawal → goods back → refund → credit note`.

- **Catalogue:** products with a description, up to 8 pictures (bucket `shop-product-images`, public, written by owners and admins in the company's own folder), price incl. MVA, MVA rate per product (0, 12, 15 or 25; only a company registered for MVA charges it), SKU, for sale or not, and optional variants (size, colour…) with their own price and stock. **Track stock** counts what is free to sell; without it the product is never sold out. Visitors browse without signing in.
- **Delivery:** the company's choices: pickup (free, at its address) and/or shipping at its flat rate (incl. MVA, at the MVA rate it sets), optionally free from an amount, with a note on carrier and delivery time. Nothing about FlyttGo delivery: a shop does not use the transport engine (a later integration).
- **Ordering:** a signed-in customer orders the cart. Prices, delivery and the total come from the database (`shop_quote` shows the same total before ordering). The products and variants in the cart are locked in one order and the stock is taken only while enough is left (`CHECK (stock >= 0)` as the backstop), so competing orders for the last items are refused and stock never goes negative; a test runs 40 orders at once for 20 items. The shop must have its Stripe account and complete invoice settings before it takes an order.
- **Unpaid orders expire:** the stock is held for the company's payment time (30–1440 minutes, default 60; at least 33 minutes once the payment page is opened, since a Stripe payment page lives at least 30). Then the order is cancelled and its stock comes back: by each new order for that shop, when the payment is opened too late, and by the job `flyttgo-shop-expiry` every 5 minutes ([`SCHEDULES.md`](SCHEDULES.md)). A payment that still arrives takes the goods again while they are in stock; what is not is flagged for the company to refund.
- **Payment:** by card into the company's own Stripe account (`shop-checkout` creates the Checkout session on the connected account; `stripe-webhook` calls `record_shop_payment`). Recorded once (the PaymentIntent is unique), only on the order's account for exactly its total; anything else, or a second payment, is held for the company to look at and never marks the order paid. **FlyttGo takes no fee** from shop sales (no application fee), as for sales invoices.
- **Receipt:** every paid order gets a sales invoice in the company's name (00011), issued and paid at once by the card payment: one line per product at its MVA rate, plus the delivery. Prices include MVA, so each line's MVA is taken out of its total (as on a till receipt) and the receipt comes to exactly what was paid. If it cannot be made (invoicing switched off, settings emptied) the payment stays recorded and the company makes it again (**Make the receipt**). The customer is emailed an order confirmation (seller, lines, total incl. MVA and delivery, delivery, the right of withdrawal with the standard form), once, when `RESEND_API_KEY` is set.
- **Statuses:** awaiting payment, paid, packed, shipped (with the carrier's reference) or ready for pickup, delivered or collected, returned, refunded; or cancelled (by the customer or the company while unpaid, or expired). Staff pack and ship; every step goes to `shop_order_events` (append-only).
- **Right of withdrawal (angrerettloven):** the shop page shows the seller (name, organisation number, address, contact), the total incl. MVA and delivery, the 14 days, who pays the return and the shop's terms. On My services the customer withdraws from all or part of a paid order with a form; it is recorded with the date and whether it came within 14 days of delivery or collection (a late one is recorded too, marked, for the company to decide). The company marks the goods received back (the order becomes returned) or refuses with a reason the customer sees.
- **Refunds:** by the company's owners, admins or finance (`shop-refund`): which lines and how many, the delivery price or not, back into stock or not. The amount follows from the order. One refund is live at a time with one idempotency key, so a retry never refunds twice; Stripe's answer is applied once (`shop_refund_mark`, also from `refund.updated` on the Connect endpoint): the order's refunded amount, the stock, the withdrawal, and a **credit note** in the company's name for those lines at their rates. A full refund makes the order refunded.
- **Who:** owners and admins keep the catalogue and delivery; staff count stock and work orders; owners, admins and finance refund and make receipts; FlyttGo's administrators read orders but do not work them; another company sees nothing. A customer sees their own orders.
- **The page:** `white-label-site` says whether the page has a shop; a page with only a shop shows **Shop** where others show booking, a few products on the front page, and template pages' booking links lead to the shop. The seller notice on pages outside transport now names the company as the seller of everything offered there (it used to speak of moves).

## Where

| | |
|---|---|
| Company | Corporate dashboard → **Plan and website** (industry, plan, brand, website, domain, agreement, Stripe), **Jobs**, **Appointments**, **Shop** (orders, returns, products and stock, delivery), **Invoices to customers** (tabs appear with the module). |
| Customer | The company's page `/b/<slug>` (or its domain): **Ask for a job**, **Book a time** or the **Shop** (`/b/<slug>/shop`: catalogue, cart, checkout). **My jobs and appointments** (`/my-services`): quotes, cancellations, invoices, card payment; orders (pay, cancel, receipt, withdraw). |
| FlyttGo | Admin → **Companies** (industry, **Authorisations…**), **White label** (approve plans, prices, templates). |
| Server | `white-label-site` (says which booking the page offers and whether it has a shop), `pay-sales-invoice`, `shop-checkout`, `shop-refund`, `stripe-webhook` (shop payments and refunds, the order confirmation), `appointment-reminders`, `invoice-send` (companies send their own invoices), `invoice-run` (FlyttGo's own reminders only). |

## Website templates

The import tool takes a group: `--group transport` (default), `field-service`, `appointments`, `websites` (hospitality, shops, software, education, nonprofits and others) or `all`. **Health templates are always left out.** Every template goes through the same cleaning and FlyttGo's review before a company can choose it ([`WHITE_LABEL.md`](WHITE_LABEL.md) → Website templates). Running it against FlyttGo needs the owner's approval.

## Left out on purpose

- **Health** (clinics, dentists, therapists…): patient data is a special category; no Appointments plan for health, no health templates. A health business can still take Website and invoicing.
- **Reservations for hotels and restaurants, regulated finance:** not built here; those companies get a website and invoicing. (Online shops are built: 00020.)
- **In a shop:** regulated or age-restricted goods (alcohol, tobacco, medicines, weapons), digital goods, gift cards, discount codes and stock across several warehouses are not handled.

## Before offering it

1. Confirm or change the prices.
2. **Legal:** the data processing agreement covers these plans too (it is a draft); terms between FlyttGo and the companies (FlyttGo as software provider, not seller); consumer information on the booking pages (seller, price, cancellation) is shown, but each company's terms must state its cancellation and no-show rules.
3. **Accountant:** companies' own invoices (numbering per company, content, reminder fees under inkassoforskriften).
4. Schedule `appointment-reminders` hourly: `supabase/ops/schedules.sql` ([`SCHEDULES.md`](SCHEDULES.md)).
5. Stripe Connect as for Model B ([`WHITE_LABEL.md`](WHITE_LABEL.md)), for companies that want card payments.
6. Decide the brand for other industries ("Flytt" means moving): the platform shows "Powered by FlyttGo" today; a neutral umbrella brand (for example the FlyttgoTechGroup site) would replace that wording.
7. **Shops, the owner:** confirm or change the proposed price of Online shop; on the Stripe **Connect** webhook endpoint also select `refund.updated` and `refund.failed` (shop refunds); schedule `flyttgo-shop-expiry`; set `RESEND_API_KEY` for the order confirmations.
8. **Shops, legal:** a lawyer to review what the platform shows and sends against angrerettloven, forbrukerkjøpsloven, e-handelsloven and prisopplysningsforskriften: the seller information, the order button (it reads "Order and pay …"; angrerettloven § 16 asks for an unambiguous wording such as "bestilling med betalingsforpliktelse"), the right-of-withdrawal text and the standard form in the Norwegian confirmation email, the confirmation as the customer's durable copy, the return-cost statement, and refunding the delivery price on a full withdrawal. **Each shop's own terms** (delivery, returns, complaints, exceptions to the right of withdrawal) are the company's; the platform links them and does not write them. The platform records withdrawals and refunds by card; it does not enforce the 14-day refund deadline or deductions for reduced value. Nothing here is a claim of compliance beyond what is built.
9. **Accountant (shops):** the receipts take each line's MVA out of its price incl. MVA; a receipt sent as EHF may then differ by an øre per rate from "net × rate" (Peppol rule BR-CO-17). Shipping carries the MVA rate the company sets; with goods at mixed rates the accountant decides how to split it.

## Integration points (not connected)

- **Shops:** FlyttGo delivery of shop orders (the transport engine is untouched; a later integration), carriers' tracking and labels (Posten, Bring), Vipps for shop payments, discount codes, gift cards; an email to the shop when a customer withdraws (today it shows in the Shop tab).
- **Accounting export** to Fiken, Tripletex and PowerOffice (their APIs), or SAF-T; today the company downloads PDF and EHF.
- **DSB register lookup:** authorisations are checked by hand in the public register; DSB has no open API that has been agreed for this.
- **Bank import for companies** (KID matching from the company's bank file): FlyttGo's own bank file matches only FlyttGo's series; companies record payments by hand or are paid by card.
- **SMS reminders:** email only.
- **Calendar sync** (Google, Outlook) for staff.

## Tests

`supabase/tests/service_platform.test.sql`, `company_invoicing.test.sql`, `jobs.test.sql`, `appointments.test.sql`, `shop.test.sql` and `shop_concurrency.sh` (PostgreSQL 16 and 17.6, the repository schema and the production replica; each rollback restores the earlier state exactly). They cover: plans and the transport-only rule; modules from the active plan; the staff role; authorisations; the company's own number series, seller, permissions and FlyttGo's untouched series; jobs from request to invoice, quotes, cancellations, staff visibility; free times, no double bookings, time off, horizon, cancellation notice, no-show fee and reminders; for shops: the catalogue for visitors, module gating, stock never below zero under competing orders (40 at once, no deadlock), expiry releasing stock, a payment recorded once and only on the shop's account for its total, the receipt at each MVA rate, withdrawal within and after the 14 days, full and part refunds applied once with credit notes, isolation between companies and customers, and the rollback with shop data in place. The shop's function and browser logic: `src/test/shop.test.ts`. (Shops were tested on PostgreSQL 17.6.)
