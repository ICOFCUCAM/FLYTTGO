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

## Still to do before real money moves

- **Legal review** of the cancellation terms and the MVA wording (angrerettloven, avtaleloven § 36, prisopplysningsforskriften). The Terms page dates (`LAST_UPDATED`, `EFFECTIVE_DATE`) must be set when the new text is published.
- **Vipps reservation lifetime.** Moves can be booked weeks ahead. Confirm with Vipps how long a reservation stays capturable. If it is shorter than the booking horizon, capture closer to the move or re-authorise.
- **Over-time charges on Vipps.** An approved extra charge above the reservation can't be captured from it. The release then stops with a clear message until the extra is paid separately. This needs a payment flow for the extra.
- **`pg_cron`:** enable it and schedule `docs/subscription-expiry-cron.sql`.
- **Secrets** for the new functions: `RESEND_API_KEY`, `FLYTTGO_FROM`, `FLYTTGO_REPLY_TO`, `FRONTEND_URL` (as for the existing functions).
