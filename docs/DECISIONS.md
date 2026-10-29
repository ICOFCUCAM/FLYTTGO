# Launch decisions (2026-10-29)

On 2026-10-29 the owner adopted the recommendations in [`PREDEPLOY_REVIEW.md`](PREDEPLOY_REVIEW.md) §4 ("choose your recommendations"). This page records each decision and where it is implemented. Nothing here is applied or deployed yet. It follows the same deploy and rollback procedure as the rest ([`SECURITY_P0.md`](SECURITY_P0.md) §5).

| # | Decision | Implemented in |
|---|---|---|
| 1 | **Dispatch eligibility is derived from the subscription.** A driver works under their newest active plan (by `plan_id`) until its end date plus a grace period, then under Free. `driver_profiles.subscription_active` is no longer read. | `driver_current_plan()`, `dispatch_rank_candidates`, `claim_job`, `driver_job_pool` (00006) |
| 2 | **Grace periods:** 24 h after a monthly plan ends, none for daily plans. Changeable in `platform_config` (`subscription_grace_hours_monthly`, `subscription_grace_hours_daily`). | `subscription_grace()` (00006) |
| 3 | **Job limits come from the plan** (`subscription_plans.max_job_value`): Free 500 NOK, the others unlimited, as production's plan rows already say. The pool shows a driver only the jobs they can take. | 00006 |
| 4 | **Ranking uses the plan's `dispatch_weight`** (Unlimited 5 … Free 1). Production's `dispatch_priority` runs the other way (Free 5) and gave Free drivers the largest boost; it is still reported but no longer scores. | `dispatch_rank_candidates` (00006) |
| 5 | **Renewal is manual at launch** (one-off payments; no stored cards, no dunning). A lapsed plan expires to Free, from the portal or the cron. The cron needs `pg_cron` enabled in Supabase. | `expire_lapsed_subscriptions()` (00006); `docs/subscription-expiry-cron.sql`; `DriverPortal` |
| 6 | **Vipps:** a booking is paid only when Vipps itself reports the reservation AUTHORIZED for the expected amount. The money is **captured on delivery confirmation**, before the driver is paid. Every release of an uncaptured Vipps payment waits as `capture_pending`. | `vipps-webhook`; `process-payment` (`release_escrow` captures first; `capture` for admins); `hold_release_until_capture` trigger, `payment_capture_mark()` (00006); `_shared/vipps-payments.ts` |
| 7 | **Cancelling a Vipps booking before capture** cancels the reservation. A late cancellation captures the 50% fee and cancels the rest. | `vippsRefund(allowCaptureRest)` in `_shared/refunds.ts` |
| 8 | **Cancellation policy = the published Terms §6.1.** FlyttGo or the driver cancels: 100%. Customer more than 24 h before the booked pickup (Oslo time): 100%. Within 24 h: 50%. No-show or work started: a manual decision. The fee stays with FlyttGo; no driver is paid for a job that never started. | `CANCELLATION_POLICY`, `cancellationShare()`, `refundAmountFor()` in `_shared/pricing.ts` |
| 9 | **The database records who cancelled and when** (`cancelled_by`, `cancelled_at`); callers cannot set them. Customers can cancel until the driver arrives (also after a driver is assigned). | `stamp_booking_cancellation` (00006); booking guard (00003) |
| 10 | **Customers cancel through `cancel-booking`,** which refunds automatically through Stripe or Vipps. | `cancel-booking`; `src/lib/cancelBooking.ts`; `MyBookings`, `CustomerDashboard` |
| 11 | **The Terms say prices include MVA,** as the payment page charges. They also explain how the 24 hours are counted and how refunds return. | `TermsPage`, `FaqPage` |
| 12 | **Platform administrators inside a company** can read it, set its status and restore an owner (with a reason, logged). They do not invite, change roles, remove members or edit company details. | `require_org_role` without the admin pass; `admin_transfer_ownership()` (00006) |
| 13 | **The last owner leaving:** transfer ownership or close the company first. Once a company is closed, its last owner's account can be deleted. | `guard_last_owner` (00006) |
| 14 | **Companies are verified before activation.** A passed check of the current organisation number, at most 30 days old, is required: Brønnøysundregistrene for Norwegian companies, or a manual check an administrator records with its evidence. Checks are kept as evidence. VAT registration is taken from the register. | `organization_verifications`, `record_organization_verification()`, `admin_set_organization_status` (00006); `verify-organization`; `_shared/brreg.ts` |
| 15 | **Invitations are emailed by the server** (Resend, 20 per company per hour). The link opens `/business/invite`, which accepts once the invited, confirmed address is signed in. `invite_member()` stays callable, since a token works only for its confirmed invited address. | `send-organization-invitation`; `AcceptInvitationPage` |
| 16 | **Driver identity:** the auth user id is the person and `driver_profiles.id` is the approved driver. `drivers` is legacy and stays until a mapped migration plan is approved. | No change; [`PREDEPLOY_REVIEW.md`](PREDEPLOY_REVIEW.md) §4.4 |
| 17 | **Orphan records are kept** and investigated, not deleted. | No change |

## Invoicing (owner, 2026-10-29)

| # | Decision | Implemented in |
|---|---|---|
| 18 | **FlyttGo issues invoices itself**, with its own invoice system at least the equal of Fiken or Tripletex for what FlyttGo needs: legal invoices, numbering without gaps, credit notes, KID, payments and bank matching, reminders, PDF and EHF, export | 00008, [`INVOICING.md`](INVOICING.md) |
| 19 | **Companies on the special price plan** get their registered name and logo on their invoices | 00008 (`billing_plan`, `logo_path`, `branding`), `invoice-pdf.ts` |
| 20 | **Each company chooses its payment terms:** 14 or 30 days, its own number of days (up to 60), or a fixed day of the following month | `set_billing_preferences`, Invoices tab |
| 21 | **Credit check built but off,** active only when the admin setting is ticked | `credit_check_enabled`, `credit-check`, `record_credit_check` |

## White label (owner, 2026-10-29)

| # | Decision | Implemented in |
|---|---|---|
| 22 | **Both seller models are built and each company chooses.** Model A (FlyttGo sells under the company's brand) is the **default**; Model B (the company sells, FlyttGo is its subcontractor) is for larger companies that choose it | 00009 (`white_label_plans`, `organization_white_label`), [`WHITE_LABEL.md`](WHITE_LABEL.md) |
| 23 | **The choices are stated with their plans and prices** on a public page, with who does what and what each plan needs. Prices ship as proposals until FlyttGo confirms them | `/business/white-label`, `admin_update_white_label_plan` |
| 24 | **Model A needs more of FlyttGo** (payment, receipts, customer service, refunds, complaints) and is priced as a monthly fee on top of FlyttGo's own sale; Model B adds a platform fee per booking | Plan seed in 00009 |
| 25 | **ArchitectPro's website templates are brought in** as a FlyttGo template library (moving and logistics first), sanitised, checked by FlyttGo before they are offered, never with scripts | `site_templates`, `_shared/site-template.ts`, `scripts/import-site-templates.ts` |

## Other industries (owner, 2026-10-29)

| # | Decision | Implemented in |
|---|---|---|
| 26 | **FlyttGo also serves companies outside moving** (trades, appointment businesses, and website-and-invoicing for the rest) on one platform. **Transport launches first**; the rest is built and ready | 00010–00013, [`SERVICE_PLATFORM.md`](SERVICE_PLATFORM.md) |
| 27 | **Outside transport the company is always the seller.** Model A (FlyttGo sells) is for moving and delivery only | `white_label_plans_modules_check`, `white_label_missing` (00010) |
| 28 | **Booking modules side by side**, sharing companies, payments, invoicing and websites: Transport (unchanged), Jobs and Appointments | 00012, 00013 |
| 29 | **Invoices in each company's own name** through FlyttGo's invoice engine (own number series, KID, bank account); accounting stays with the company and its accountant | 00011 |
| 30 | **Trade authorisations** (e.g. DSB registration for electrical work) are checked by FlyttGo; a service that needs one is offered only then | `organization_authorisations` (00010), `job_insert` (00012) |
| 31 | **Health is left out** (patient data): no Appointments plan for health, no health templates | plan industries (00010), importer `EXCLUDED` |
| 32 | **Scheduled jobs in the database:** `pg_cron` + `pg_net`, the service role key in Supabase Vault; subscription expiry hourly, invoice run daily, appointment reminders hourly ([`SCHEDULES.md`](SCHEDULES.md)) | `supabase/ops/schedules.sql` |
| 33 | **FlyttGo's own accounting system** (Ledgera's design, built here where the transactions are), offered to companies as an **add-on**; no accounting firm: the software records the transactions and produces the files the company's accountant reviews | 00014, 00015, `src/accounting`, [`ACCOUNTING_CORE.md`](ACCOUNTING_CORE.md) |
| 34 | **The add-on's price follows the company's turnover** (bands from last year's income in the books, or the declared turnover at the start; reassessed each 1 January; Enterprise by agreement); proposed until confirmed | `accounting_price_tiers`, `accounting_tier()` (00015) |
| 35 | **Each company's accounting back office:** its owners and admins invite an accountant, bookkeeper, external auditor (with an end date) or viewer; FlyttGo's administrators never read a company's books | `accounting.invite()` (00014), `accounting-invite` |
| 36 | **Portable:** the core and the office are copied unchanged into Ledgera; each product supplies a small adapter | schema `accounting`, `accounting.host_*` |
| 37 | **Accounting gates (owner, 2026-10-29):** the price bands accepted provisionally for the pilot, half-open; an authorised accountant's review before commercial use; production migrations 00014/00015 not approved until the controls are independently verified on a copy of production; the invitation function tested and reviewed separately; no time-saving claims until pilots substantiate them; the regulatory position confirmed by a Norwegian professional | [`ACCOUNTING_REVIEW.md`](ACCOUNTING_REVIEW.md), `supabase/tests/accounting_controls/` |

## Still to do before real money moves

- **Legal review** of the cancellation terms and the MVA wording (angrerettloven, avtaleloven § 36, prisopplysningsforskriften). The Terms page dates (`LAST_UPDATED`, `EFFECTIVE_DATE`) must be set when the new text is published.
- **Vipps reservation lifetime.** Moves can be booked weeks ahead. Confirm with Vipps how long a reservation stays capturable. If it is shorter than the booking horizon, capture closer to the move or re-authorise.
- **Over-time charges on Vipps.** An approved extra charge above the reservation can't be captured from it. The release then stops with a clear message until the extra is paid separately. This needs a payment flow for the extra.
- **Scheduled jobs:** run `supabase/ops/schedules.sql` after the functions are deployed ([`SCHEDULES.md`](SCHEDULES.md)).
- **Secrets** for the new functions: `RESEND_API_KEY`, `FLYTTGO_FROM`, `FLYTTGO_REPLY_TO`, `FRONTEND_URL` (as for the existing functions).
