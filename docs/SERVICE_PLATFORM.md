# The platform for other industries

FlyttGo also gives companies outside moving and logistics their booking, invoicing and website, on the same platform (owner's decision, 2026-10-29; [`DECISIONS.md`](DECISIONS.md) #26–31). **Transport launches first; this is built and ready.**

Migrations, all unapplied: `00010_service_platform.sql` (core), `00011_company_invoicing.sql` (invoices in a company's own name), `00012_jobs.sql` (trades), `00013_appointments.sql` (appointments), `00019_reservations.sql` (restaurant tables and hotel rooms), `00020_shop.sql` (online shops). Each has a rollback in `supabase/rollback/` that restores the state before it exactly (tested). It follows the same procedure as the rest: [`SECURITY_P0.md`](SECURITY_P0.md) §5 and [`COPY_OF_PRODUCTION_TEST_PLAN.md`](COPY_OF_PRODUCTION_TEST_PLAN.md).

## The shape

One core shared by every company: companies, teams and roles, verification, plans, payments (Stripe Connect), invoicing, white-label pages and the website template library. Booking modules sit beside each other, each with its own tables:

| Module | For | Status |
|---|---|---|
| Transport | Moving and delivery (FlyttGo's engine, drivers, dispatch, escrow) | Unchanged; launches first |
| Jobs (`jobs`) | Trades and home services: work at the customer's address | Built |
| Appointments (`appointments`) | Time slots with staff or rooms | Built |
| Restaurant tables (`restaurant_reservations`) | Restaurants, cafés and bars: a table for a party at a time | Built |
| Hotel rooms (`hotel_reservations`) | Hotels, guesthouses, B&Bs, cabins: a room type for a range of nights | Built |
| Shop (`shop`) | Selling goods: catalogue, stock, orders, returns | Built |
| Invoicing in the company's name (`sales_invoicing`) | Every company outside transport | Built |

A company states its **industry**. What it can use comes with its **plan** (`white_label_plans.modules`), checked in one place, `org_has_module()`: the company is active and its active plan includes the module.

**Outside transport the company is always the seller.** FlyttGo cannot sell a plumber's or an electrician's work in its own name, so Model A (FlyttGo sells) is for moving and delivery only; the database refuses anything else (`white_label_plans_modules_check`, `white_label_missing`). FlyttGo's moving engine refuses bookings on non-transport plans (`guard_booking_transport_plan`).

## Plans and prices (proposals or pilot prices until FlyttGo confirms them)

| Plan | For | Set-up | Monthly | Modules |
|---|---|---|---|---|
| Website and invoicing | Any industry | 1 900 | 690 | invoicing |
| Jobs | Trades (`field_service`) | 4 900 | 1 290 | jobs, invoicing |
| Appointments | Appointment businesses | 2 900 | 990 | appointments, invoicing |
| Restaurant: table booking | Hospitality (`hospitality`) | 2 900 | 990 | restaurant_reservations, invoicing |
| Hotel: room booking | Hospitality (`hospitality`) | 4 900 | 1 490 | hotel_reservations, invoicing |
| Online shop | Any industry except transport and health | 2 900 | 990 | shop, invoicing |

Excluding MVA. **Pilot pricing** (owner's decision 2026-10-29, [`DECISIONS.md`](DECISIONS.md) #39, migration 00022): the Restaurant, Hotel and Online shop prices above are accepted provisionally for the pilot (`price_status = 'pilot'`, with a note shown beside them); the others stay proposals. The set-up fee of those three states what it includes (`setup_fee_includes`): branding, configuration, content preparation and publication. The plans page, the company's plan panel and Admin → White label say "Pilot pricing" wherever they show these prices.

**Combined plans are add-on modules** (#40, 00022): a company has **one primary plan** and FlyttGo's administrators may enable **add-on modules** on it (`organization_addons`): for example a salon on Appointments adds `shop`, a hotel adds `restaurant_reservations`. The company, its brand, members and booking set-up are shared; each module keeps its own settings, tables and permissions, as before. An add-on is priced by a **written quote** (its reference recorded) or an **explicitly approved pilot price** recorded with it (monthly fee, optional set-up fee, and a note); no combined price is derived or shown. `org_has_module()` counts an active add-on while the company and its primary plan are active, so every module check (RLS, the module functions, the dashboard's tabs) works unchanged; `org_modules()` lists them for the company's page, where a booking module and a shop both show (the booking button and a Shop link in the header, both ways in on the front page; the shop at `/b/<slug>/shop`). On a plan where FlyttGo sells, only the API can be added. Add-on fees are not billed by the invoice run: they are invoiced from the quote by hand (FlyttGo's invoice lines) until billing is built. All of them need: an active company, customer service email and phone, the company's terms and privacy notice, and the data processing agreement accepted by an owner. Card payments need the company's own Stripe account (optional; required for Online shop, where card is the only way to pay). Shown on `/business/white-label` beside the transport plans; FlyttGo confirms or changes prices in Admin → White label. Billed monthly by the invoice run, like the transport plans.

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

## Restaurant tables (00019)

- **Set-up:** tables (name, area, seats, the smallest party given the table online, whether it can be combined), the combinations the restaurant allows (two or more combinable tables, from a party size), service periods per weekday in local time (for example lunch 11:30–14:30, dinner 17:00–22:00 with a last seating), how long a table is kept by party size (turn times, with a default for larger parties), closed dates, and the rules: slot step, booking window, minimum notice, the largest party online, cancellation notice and an optional no-show fee (per guest or per booking, with the company's MVA rate on it).
- **Free times:** `available_restaurant_times()` computes them for a day and party size in Europe/Oslo. Times are stepped in local clock time, so on the days the clocks change the restaurant still opens at 17:00. A time is offered when a table that fits the party (or, failing that, an allowed combination) is free for the whole turn; the smallest fit is chosen. Visitors see the times before signing in; the floor plan stays with the company.
- **Booking:** a signed-in guest books an offered time with a name, phone, email and notes in their own words (for example allergies; there is no health field). One lock per restaurant (its floor: a reservation can take several tables) means two people never get the same table. The company books phone guests (at any time, larger parties, on named tables) and seats walk-ins, never over another reservation.
- **On the evening:** seated (at the booked tables or others; guests who come early, at most one turn ahead, hold the table from then, and late ones a whole turn from then, only where the tables are free), completed (the table is free from then), no-show (after the booked time; the tables are freed), cancelled. Floor staff (role `staff`) seat guests and take walk-ins; owners, admins and bookers cancel.
- **No-show fee:** charged only when the company had stated one before the booking: the fee in force is copied onto the reservation when it is made, and a fee added later does not apply. Invoiced in the company's name (00011). The meal itself is not invoiced here (restaurants use their till).
- **Cancellation:** the guest online up to the restaurant's notice (hours); after that only the restaurant.
- **Reminders:** `appointment-reminders` (hourly) also emails guests the day before, once each.

## Hotel rooms (00019)

- **Set-up:** room types (capacity, nightly price incl. MVA, description), rooms of each type, closed rooms or a closed hotel for some nights, and the rules: **the MVA rate for accommodation is the company's setting** (nothing is offered or booked until it is set; the platform does not assume a rate), check-in and check-out times, booking window, days' notice, fewest and most nights, and the cancellation rule (free until a number of days before arrival, then a share of the stay).
- **Free rooms:** `available_hotel_rooms()` lists the room types free every night of a date range (nights are dates, so summer time does not change them), with the price and how many rooms are left. Visitors see them before signing in.
- **Booking:** every stay is given a room when it is booked, under a lock per room type, so a night is never sold twice, also for overlapping ranges. The price, MVA rate and cancellation rule in force are copied onto the stay. The company books phone guests (also in a named room, beyond the online window), never over another stay or a closure.
- **At the desk:** check-in from the arrival date (also into another free room, for example an upgrade at the booked price), check-out, no-show (from the arrival date). Desk staff (role `staff`) check guests in and out.
- **Cancellation:** the guest online until the day before arrival: free until the last free day, then the fee stated before the booking. The company cancels while the stay is booked and charges that fee only when it chooses to and the cancellation is late. A no-show carries the late fee.
- **Invoice:** the stay (nights × nightly price at the stay's MVA rate) or the cancellation fee, in the company's name.
- **What is stored:** the booker's name, phone, email and the number of guests; nothing else about the guests.
- **Guest register (overnattingsregister):** Norwegian accommodation businesses must keep a register of their guests. **It is not built here and FlyttGo makes no claim that these modules meet that duty.** What the register must contain, who keeps it and whether FlyttGo should offer it is an owner and legal decision (below); until then each hotel keeps its register itself.
- **Reminders:** `appointment-reminders` (hourly) emails guests the day before arrival, once each.

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
| Company | Corporate dashboard → **Plan and website** (industry, plan, brand, website, domain, agreement, Stripe), **Jobs**, **Appointments**, **Restaurant** (reservations, tables, opening, rules), **Hotel** (front desk, rooms, closures, rules), **Shop** (orders, returns, products and stock, delivery), **Invoices to customers** (tabs appear with the module). |
| Customer | The company's page `/b/<slug>` (or its domain): **Ask for a job**, **Book a time**, **Book a table**, **Book a room** or the **Shop** (`/b/<slug>/shop`: catalogue, cart, checkout). **My jobs and appointments** (`/my-services`): quotes, cancellations, table reservations, hotel stays, invoices, card payment; orders (pay, cancel, receipt, withdraw). |
| FlyttGo | Admin → **Companies** (industry, **Authorisations…**), **White label** (approve plans, prices, templates). |
| Server | `white-label-site` (says which booking the page offers, `bookingFor()` in `_shared/white-label.ts`, and whether it has a shop), `pay-sales-invoice`, `shop-checkout`, `shop-refund`, `stripe-webhook` (shop payments and refunds, the order confirmation), `appointment-reminders` (appointments, tables and hotel arrivals), `invoice-send` (companies send their own invoices), `invoice-run` (FlyttGo's own reminders only). |

## Website templates

The import tool takes a group: `--group transport` (default), `field-service`, `appointments`, `websites` (hospitality, shops, software, education, nonprofits and others) or `all`. **Health templates are always left out.** Every template goes through the same cleaning and FlyttGo's review before a company can choose it ([`WHITE_LABEL.md`](WHITE_LABEL.md) → Website templates). Running it against FlyttGo needs the owner's approval.

## Left out on purpose

- **Health** (clinics, dentists, therapists…): patient data is a special category; no Appointments plan for health, no health templates. A health business can still take Website and invoicing.
- **Regulated finance:** not built here; those companies get a website and invoicing. (Restaurant and hotel reservations are built: 00019; online shops are built: 00020; both above.)
- **In a shop:** regulated or age-restricted goods (alcohol, tobacco, medicines, weapons), digital goods, gift cards, discount codes and stock across several warehouses are not handled.

## Before offering it

1. Confirm or change the prices.
2. **Legal:** the data processing agreement covers these plans too (it is a draft); terms between FlyttGo and the companies (FlyttGo as software provider, not seller); consumer information on the booking pages (seller, price, cancellation) is shown, but each company's terms must state its cancellation and no-show rules.
3. **Accountant:** companies' own invoices (numbering per company, content, reminder fees under inkassoforskriften).
4. Schedule `appointment-reminders` hourly: `supabase/ops/schedules.sql` ([`SCHEDULES.md`](SCHEDULES.md)).
5. Stripe Connect as for Model B ([`WHITE_LABEL.md`](WHITE_LABEL.md)), for companies that want card payments.
6. Decide the brand for other industries ("Flytt" means moving): the platform shows "Powered by FlyttGo" today; a neutral umbrella brand (for example the FlyttgoTechGroup site) would replace that wording.
7. **Restaurants and hotels (00019), owner and legal decisions:**
   - Confirm or change the proposed Restaurant (2 900 / 990) and Hotel (4 900 / 1 490) prices, and whether to offer a combined plan.
   - **Guest register (overnattingsregister):** decide with a lawyer what Norwegian law requires the hotel to record, whether FlyttGo offers it (as the hotel's processor, with its own retention and access rules) or leaves it with each hotel, and what the data processing agreement then says. Until decided, nothing beyond the booking is stored and nothing claims to meet the duty.
   - **MVA:** the accommodation rate and the rate on a no-show or cancellation fee are each company's settings; the platform assumes none. Whether a no-show or cancellation fee carries MVA is a question for each company's accountant; the platform lists 0, 12, 15 and 25 %.
   - **Fees and consumer rules:** no-show and late-cancellation fees, and the cancellation deadlines, must be in each company's terms before guests book (the booking pages show them); have a lawyer review the wording (for example avtaleloven § 36 and whether angrerettloven gives a right of withdrawal for these bookings).
   - **Allergies:** the notes field is the guest's own words. Decide whether the booking pages should say not to write health information there.
8. The hourly `appointment-reminders` job (item 4) also sends the table and arrival reminders; nothing else to schedule for them (shops have their own job, item 9).
9. **Shops, the owner:** confirm or change the proposed price of Online shop; on the Stripe **Connect** webhook endpoint also select `refund.updated` and `refund.failed` (shop refunds); schedule `flyttgo-shop-expiry`; set `RESEND_API_KEY` for the order confirmations.
10. **Shops, legal:** a lawyer to review what the platform shows and sends against angrerettloven, forbrukerkjøpsloven, e-handelsloven and prisopplysningsforskriften: the seller information, the order button (it reads "Order and pay …"; angrerettloven § 16 asks for an unambiguous wording such as "bestilling med betalingsforpliktelse"), the right-of-withdrawal text and the standard form in the Norwegian confirmation email, the confirmation as the customer's durable copy, the return-cost statement, and refunding the delivery price on a full withdrawal. **Each shop's own terms** (delivery, returns, complaints, exceptions to the right of withdrawal) are the company's; the platform links them and does not write them. The platform records withdrawals and refunds by card; it does not enforce the 14-day refund deadline or deductions for reduced value. Nothing here is a claim of compliance beyond what is built.
11. **Accountant (shops):** the receipts take each line's MVA out of its price incl. MVA; a receipt sent as EHF may then differ by an øre per rate from "net × rate" (Peppol rule BR-CO-17). Shipping carries the MVA rate the company sets; with goods at mixed rates the accountant decides how to split it.

The seller notice on a company's page outside transport (jobs, appointments, tables, rooms or a shop) names the company as the seller of everything offered on the page and FlyttGo as the booking and payment platform (`sellerNotice()` with the page's booking); for transport it is unchanged.

## Integration points (not connected)

- **Shops:** FlyttGo delivery of shop orders (the transport engine is untouched; a later integration), carriers' tracking and labels (Posten, Bring), Vipps for shop payments, discount codes, gift cards; an email to the shop when a customer withdraws (today it shows in the Shop tab).
- **Accounting export** to Fiken, Tripletex and PowerOffice (their APIs), or SAF-T; today the company downloads PDF and EHF.
- **DSB register lookup:** authorisations are checked by hand in the public register; DSB has no open API that has been agreed for this.
- **Bank import for companies:** built (00016, [`INVOICING.md`](INVOICING.md) → Bank import): the company's owners, admins and finance upload its Nets OCR or camt.054 file and payments are matched by KID within its own series. The automatic fetch from the company's bank needs the company's own bank or Nets agreement; none is connected.
- **SMS reminders:** email only.
- **Calendar sync** (Google, Outlook) for staff.
- **Hotels:** channel managers and online travel agencies (Booking.com, Expedia and others) would have to share the same rooms through the lock per room type; prices per season or day, prepayment or deposits by card, and a guest register (above) are not built.
- **Restaurants:** till (POS) systems for the bill, deposits for large parties, a floor-plan drawing and waiting lists are not built.

## Tests

`supabase/tests/service_platform.test.sql`, `company_invoicing.test.sql`, `jobs.test.sql`, `appointments.test.sql`, `reservations.test.sql`, `shop.test.sql` and `shop_concurrency.sh` (PostgreSQL 16 and 17.6, the repository schema and the production replica; `reservations.test.sql` and the shop tests have so far run on 17.6 only; each rollback restores the earlier state exactly). They cover: plans and the transport-only rule; modules from the active plan; the staff role; authorisations; the company's own number series, seller, permissions and FlyttGo's untouched series; jobs from request to invoice, quotes, cancellations, staff visibility; free times, no double bookings, time off, horizon, cancellation notice, no-show fee and reminders.

For reservations: free times in Oslo clock time also on the day the clocks change, turn times by party size, the smallest fitting table and combinations, the restaurant's and the room type's locks, no table or night given twice (also across overlapping ranges, by the company too), closed dates and rooms, the window and lead time, the fee stated before the booking (and not one stated after), cancellations and late fees, check-in and out, invoices at the company's MVA rate, module gating, isolation between companies and reminders. `src/test/reservations.test.ts` checks the same rules in the browser (nights, cancellation rule, no-show fee, which booking a page offers). Two sessions booking the last table or the last room at the same moment were also tried by hand on PostgreSQL 17.6: one booked, the other was refused.

For shops: the catalogue for visitors, module gating, stock never below zero under competing orders (40 at once, no deadlock), expiry releasing stock, a payment recorded once and only on the shop's account for its total, the receipt at each MVA rate, withdrawal within and after the 14 days, full and part refunds applied once with credit notes, isolation between companies and customers, and the rollback with shop data in place. The shop's function and browser logic: `src/test/shop.test.ts`.

For pilot pricing and add-on modules (00022): `supabase/tests/pilot_addons.test.sql` (the three pilot prices with what the set-up fee includes, accepting and changing pilot prices, add-ons enabled and ended only by FlyttGo, a quote reference or an approved pilot price required, no shop where FlyttGo sells, a shop beside Appointments working through the unchanged module checks, add-ons stopping with the primary plan, isolation), `api_keys.test.sql` (the API add-on) and `src/test/addons.test.ts` (a page with a booking module and a shop; add-on prices in words). The release rehearsal (`supabase/tests/rehearsal/`, [`RELEASE_GATES.md`](RELEASE_GATES.md)) runs every module on the copy of production with representative data.
