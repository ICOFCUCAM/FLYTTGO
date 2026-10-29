# The platform for other industries

FlyttGo also gives companies outside moving and logistics their booking, invoicing and website, on the same platform (owner's decision, 2026-10-29; [`DECISIONS.md`](DECISIONS.md) #26–31). **Transport launches first; this is built and ready.**

Migrations, all unapplied: `00010_service_platform.sql` (core), `00011_company_invoicing.sql` (invoices in a company's own name), `00012_jobs.sql` (trades), `00013_appointments.sql` (appointments). Each has a rollback in `supabase/rollback/` that restores the state before it exactly (tested). It follows the same procedure as the rest: [`SECURITY_P0.md`](SECURITY_P0.md) §5 and [`COPY_OF_PRODUCTION_TEST_PLAN.md`](COPY_OF_PRODUCTION_TEST_PLAN.md).

## The shape

One core shared by every company: companies, teams and roles, verification, plans, payments (Stripe Connect), invoicing, white-label pages and the website template library. Booking modules sit beside each other, each with its own tables:

| Module | For | Status |
|---|---|---|
| Transport | Moving and delivery (FlyttGo's engine, drivers, dispatch, escrow) | Unchanged; launches first |
| Jobs (`jobs`) | Trades and home services: work at the customer's address | Built |
| Appointments (`appointments`) | Time slots with staff or rooms | Built |
| Invoicing in the company's name (`sales_invoicing`) | Every company outside transport | Built |

A company states its **industry**. What it can use comes with its **plan** (`white_label_plans.modules`), checked in one place, `org_has_module()`: the company is active and its active plan includes the module.

**Outside transport the company is always the seller.** FlyttGo cannot sell a plumber's or an electrician's work in its own name, so Model A (FlyttGo sells) is for moving and delivery only; the database refuses anything else (`white_label_plans_modules_check`, `white_label_missing`). FlyttGo's moving engine refuses bookings on non-transport plans (`guard_booking_transport_plan`).

## Plans and prices (proposals until FlyttGo confirms them)

| Plan | For | Set-up | Monthly | Modules |
|---|---|---|---|---|
| Website and invoicing | Any industry | 1 900 | 690 | invoicing |
| Jobs | Trades (`field_service`) | 4 900 | 1 290 | jobs, invoicing |
| Appointments | Appointment businesses | 2 900 | 990 | appointments, invoicing |

Excluding MVA. All three need: an active company, customer service email and phone, the company's terms and privacy notice, and the data processing agreement accepted by an owner. Card payments need the company's own Stripe account (optional). Shown on `/business/white-label` beside the transport plans; FlyttGo confirms or changes prices in Admin → White label. Billed monthly by the invoice run, like the transport plans.

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

## Where

| | |
|---|---|
| Company | Corporate dashboard → **Plan and website** (industry, plan, brand, website, domain, agreement, Stripe), **Jobs**, **Appointments**, **Invoices to customers** (tabs appear with the module). |
| Customer | The company's page `/b/<slug>` (or its domain): **Ask for a job** or **Book a time**. **My jobs and appointments** (`/my-services`): quotes, cancellations, invoices, card payment. |
| FlyttGo | Admin → **Companies** (industry, **Authorisations…**), **White label** (approve plans, prices, templates). |
| Server | `white-label-site` (says which booking the page offers), `pay-sales-invoice`, `appointment-reminders`, `invoice-send` (companies send their own invoices), `invoice-run` (FlyttGo's own reminders only). |

## Website templates

The import tool takes a group: `--group transport` (default), `field-service`, `appointments`, `websites` (hospitality, shops, software, education, nonprofits and others) or `all`. **Health templates are always left out.** Every template goes through the same cleaning and FlyttGo's review before a company can choose it ([`WHITE_LABEL.md`](WHITE_LABEL.md) → Website templates). Running it against FlyttGo needs the owner's approval.

## Left out on purpose

- **Health** (clinics, dentists, therapists…): patient data is a special category; no Appointments plan for health, no health templates. A health business can still take Website and invoicing.
- **Reservations for hotels and restaurants, online shops, regulated finance:** not built; those companies get a website and invoicing.

## Before offering it

1. Confirm or change the prices.
2. **Legal:** the data processing agreement covers these plans too (it is a draft); terms between FlyttGo and the companies (FlyttGo as software provider, not seller); consumer information on the booking pages (seller, price, cancellation) is shown, but each company's terms must state its cancellation and no-show rules.
3. **Accountant:** companies' own invoices (numbering per company, content, reminder fees under inkassoforskriften).
4. Schedule `appointment-reminders` hourly: `supabase/ops/schedules.sql` ([`SCHEDULES.md`](SCHEDULES.md)).
5. Stripe Connect as for Model B ([`WHITE_LABEL.md`](WHITE_LABEL.md)), for companies that want card payments.
6. Decide the brand for other industries ("Flytt" means moving): the platform shows "Powered by FlyttGo" today; a neutral umbrella brand (for example the FlyttgoTechGroup site) would replace that wording.

## Integration points (not connected)

- **Accounting export** to Fiken, Tripletex and PowerOffice (their APIs), or SAF-T; today the company downloads PDF and EHF.
- **DSB register lookup:** authorisations are checked by hand in the public register; DSB has no open API that has been agreed for this.
- **Bank import for companies:** built (00016, [`INVOICING.md`](INVOICING.md) → Bank import): the company's owners, admins and finance upload its Nets OCR or camt.054 file and payments are matched by KID within its own series. The automatic fetch from the company's bank needs the company's own bank or Nets agreement; none is connected.
- **SMS reminders:** email only.
- **Calendar sync** (Google, Outlook) for staff.

## Tests

`supabase/tests/service_platform.test.sql`, `company_invoicing.test.sql`, `jobs.test.sql`, `appointments.test.sql` (PostgreSQL 16 and 17.6, the repository schema and the production replica; each rollback restores the earlier state exactly). They cover: plans and the transport-only rule; modules from the active plan; the staff role; authorisations; the company's own number series, seller, permissions and FlyttGo's untouched series; jobs from request to invoice, quotes, cancellations, staff visibility; free times, no double bookings, time off, horizon, cancellation notice, no-show fee and reminders.
