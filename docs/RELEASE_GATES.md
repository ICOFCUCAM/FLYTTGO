# Release gates

Owner's decision (2026-10-29, [`DECISIONS.md`](DECISIONS.md) #43): before a feature built in migrations 00016–00022 is switched on in production, every gate listed for it below is met and recorded here (who, when, where the evidence is). **Nothing on this page is met yet.** The production migrations 00016–00022 and the merge to `main` are **not approved**; this page is what has to be true before they are.

A gate is met only by the person named for it: a lawyer's item by a Norwegian lawyer, an accountant's item by an authorised accountant (autorisert regnskapsfører or registrert/statsautorisert revisor), an integration item by checking the real service in test mode. Passing tests show that the software does what it says; they do not meet a legal or accounting gate. No disclaimer, notice or term on a page replaces a legal duty.

## Gates shared by every feature

| Gate | Who | State |
|---|---|---|
| **CI green.** The GitHub checks run and pass on the branch to be merged (typecheck, lint, Vitest, build, `npm run test:db`). Currently blocked: GitHub Actions do not run because of GitHub billing; the checks have only been run locally. | Owner (billing), then CI | open |
| **Release rehearsal passed** on the copy of production with representative data: `supabase/tests/rehearsal/` (run by `npm run test:db`; [what it checks](#release-rehearsal)). Repeat on a disposable Supabase test project ([`TEST_COPY_PLAN.md`](TEST_COPY_PLAN.md)) before production. | Developer | locally passed; test project open |
| **Deployment order** (below), each step checked before the next. | Owner | open |
| **Production migrations and merge to `main` approved** by the owner. | Owner | not approved |

### Deployment order

1. **Migrations 00016 → 00022**, in order, one at a time, each checked (schema fingerprint, `supabase/schema/`) before the next. Each has its rollback in `supabase/rollback/` (tested with data; see the bank import and shop notes below for what a rollback refuses).
2. **Edge Functions** that use them: `bank-import`, `book-on-invoice`, `create-checkout-session`, `create-vipps-session`, `send-booking-email`, `public-api`, `white-label-site`, `appointment-reminders`, `invoice-run`, `shop-checkout`, `shop-refund`, `stripe-webhook`, `invoice-document`, `invoice-send` (as changed since the last deploy), with their secrets.
3. **Scheduled jobs:** run `supabase/ops/schedules.sql` again (adds `flyttgo-shop-expiry` and `flyttgo-approval-expiry`; [`SCHEDULES.md`](SCHEDULES.md)).
4. **Merge to `main`** (the frontend; Vercel builds `main`).
5. **Feature enablement**, one feature at a time, only once its gates below are met: plans offered, add-ons enabled, settings switched on.

## Integration prerequisites

| Gate | Needed for | State |
|---|---|---|
| **`STRIPE_SECRET_KEY` in production holds the webhook signing secret** and must be replaced with Stripe's **API secret key** (`sk_live_…`). Until then no payment, refund or Connect call can work. | every card payment, refund, Connect, shop | open |
| **Both Stripe webhooks verified independently:** the platform endpoint (`STRIPE_WEBHOOK_SECRET`) and the Connect endpoint (`STRIPE_CONNECT_WEBHOOK_SECRET`), each with its own secret, each receiving a test event and answering 2xx. | card payments (platform), Model B and shop payments (Connect) | open |
| **Refund events added to both webhooks:** `refund.created`, `refund.updated` and `refund.failed` (the refund events `stripe-webhook` handles), besides `checkout.session.completed`, `checkout.session.async_payment_succeeded` and, on the Connect endpoint, `account.updated`, so a refund's final state is recorded whichever account it is on. | refunds, cancellations, shop returns | open |
| **Refunds and retries tested in Stripe test mode:** a full and a part refund, a failed refund, the same webhook delivered twice and late (each recorded once). | refunds, shop | open |
| **`RESEND_API_KEY` set and the sending domain verified** in Resend (`FLYTTGO_FROM` on that domain, `FLYTTGO_REPLY_TO`). | every email | open |
| **Emails tested end to end:** booking confirmation, invoice (PDF attached), invitation to a company, approval requested and decided. | bookings, invoicing, teams, spending limits | open |
| **Automatic bank fetching stays off** until there is a bank or Nets agreement and its credentials are verified ([`INVOICING.md`](INVOICING.md) → Automatic fetch). Bank files are imported by hand until then. | bank import | off (as required) |

## Per feature

### Bank import (00016)

| Gate | Who | State |
|---|---|---|
| **Rollback policy:** keep the protective refusal. `00016_down.sql` stops while any import is recorded; imported financial records (imports, their rows, the payments they recorded) are **never deleted or reversed** to make a rollback pass. A mistaken payment is corrected by the accounting route (credit note or an opposite entry with its reason), not by removing the import. | Accountant | proposed; to be confirmed |
| Matching by KID within the company's own series, the handling of open and duplicate rows, and the audit trail reviewed. | Accountant | open |
| Automatic fetch off (above). | Owner | off |

### Spending limits and approval (00017, 00022)

| Gate | Who | State |
|---|---|---|
| Scheduled job `flyttgo-approval-expiry` installed (deployment step 3) and its first runs checked in `cron.job_run_details`. | Owner | open |
| Approval email (approval requested, decided) tested end to end (above). | Developer | open |
| Built and tested: approval re-reads the approver's permissions and the request at that moment; a request past its deadline is never approved; approval never changes the amount; a different price needs a new request; nobody approves their own booking in any role. | Developer | done (`pilot_addons.test.sql`, `spending_limits.test.sql`) |

### API and booking widget (00018, 00022)

| Gate | Who | State |
|---|---|---|
| The `api` add-on is enabled only for companies with a written quote or an approved pilot price recorded with it. | Owner | open |
| Built and tested: tenant isolation, revocation at once on role loss and removal, the add-on gate, 60 requests a minute per key, invoice-only bookings. | Developer | done (`api_keys.test.sql`) |
| The widget's frame header checked on a Vercel preview (`/embed/<slug>` carries `frame-ancestors`; [`WHITE_LABEL.md`](WHITE_LABEL.md) → Booking widget). | Developer | open |
| The API terms (who the key acts as, invoice-only bookings, limits) in the company's agreement. | Lawyer | open |

### Reservations: restaurant tables and hotel rooms (00019)

| Gate | Who | State |
|---|---|---|
| **The hotel guest register is out of scope until reviewed.** FlyttGo does not keep the accommodation business's guest register, and the platform must not be presented as doing so. A lawyer reviews the hotel's duties (guest register and any other duty of an accommodation business) and what FlyttGo may and may not take on before Hotel is offered. No disclaimer replaces the legal duty. | Lawyer | open |
| **Cancellation and no-show terms** for restaurants and hotels (free cancellation period, fees, how they are shown before booking, consumer law) reviewed. | Lawyer | open |
| **MVA on cancellation and no-show fees** (whether a fee is consideration for a supply and at which rate: restaurant 25 %, accommodation 12 %, or outside the scope) decided. | Accountant | open |
| Pilot pricing shown as such (done: #39). | Developer | done |

### Online shop (00020)

| Gate | Who | State |
|---|---|---|
| **The order button's wording** (the button that commits the consumer to pay, under the consumer purchase and right of withdrawal rules) reviewed. | Lawyer | open |
| **The withdrawal form** (standard form, how it is offered and received) reviewed. | Lawyer | open |
| **Return costs** (who pays, and how the shop says so before the order) reviewed. | Lawyer | open |
| **The shop terms** each company publishes (a template or the requirements FlyttGo checks before approval) reviewed. | Lawyer | open |
| **EHF rounding:** a receipt sent as EHF may differ by one øre per MVA rate from "net × rate" (Peppol rule BR-CO-17), because each line's MVA is taken out of its price incl. MVA. Accepted or changed. Shipping at mixed rates: how to split it. | Accountant | open |
| Stripe refunds, retries and both webhooks (integration prerequisites above). | Developer | open |
| Rollback: `00020_down.sql` stops while a company is on the plan Online shop; orders are exported to each company before any rollback. | Owner | noted |

### Website template photos (00009, 00021, 00023, 00024)

| Gate | Who | State |
|---|---|---|
| **Image library (00023):** migration 00023 after 00022 (rollback `00023_down.sql`, tested with data), then `white-label-site` deployed. Each library photo is approved in Admin → White label → Image library only with its licence and the evidence of it checked by a person (the importer adds harvested photos as pending; running it with `--upload` writes to FlyttGo's storage and database and needs the owner's approval). Companies' own uploads are checked by their bytes in the browser; the bucket limits type and size (the server does not read the bytes again). | Owner / FlyttGo | open |
| **Thumbnail redraw (00024):** migration 00024 after 00023 (rollback `00024_down.sql`, tested with data and in the release rehearsal). Redrawing stale thumbnails with `scripts/redraw-thumbnails.ts --upload` writes to FlyttGo's storage and database and needs the owner's approval; review a dry run's pictures first. Until 00024 is applied the gallery shows thumbnails in categories with library photos live. | Owner / Developer | open |
| Every photo in an offered template has a licence that allows FlyttGo and the companies to use it on their pages (source and licence recorded with the template), or is replaced. | Owner / Developer | open |
| Each template is checked by FlyttGo before it is offered (no sample prices, reviews, figures or claims), as the template review already requires ([`WHITE_LABEL.md`](WHITE_LABEL.md) → Website templates). | FlyttGo | per template |

## Release rehearsal

`supabase/tests/rehearsal/run.sh`, run by `npm run test:db` (variant "release rehearsal"). It builds the copy of production (the replica `supabase/schema/production-2026-10-29.sql` with 00002–00015, as production is today), writes a **representative synthetic dataset** (no real personal data: invented names, `example.no` addresses, test organisation numbers), applies **00016–00022** twice with that data in place, writes the data only the new schema allows, and checks:

- **RLS and cross-company isolation, per table:** for every public table with a company column, each company's owner sees only their own company's rows, and the members in every role only what their role allows;
- **payment idempotency:** a Stripe webhook delivered again records the payment once (`payment_events`, invoice payments, shop payments);
- **financial records preserved and immutable:** invoices of both series, payments, bank imports and their rows, credit notes and their lines are unchanged by the migrations (hashes before and after), cannot be changed or deleted afterwards, and survive the rollback;
- **rollback 00022 → 00016 with data:** 00022 to 00017 roll back with the data in place (after the steps their notes require: companies moved off the plans they remove), and 00016 refuses while bank imports are recorded, leaving every financial record as it was.
