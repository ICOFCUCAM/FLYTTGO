# P0 security and payments remediation

Branch `claude/vibrant-johnson-awo68u`. **Nothing here is deployed or applied.** No migration has been run against a Supabase project and no edge function has been redeployed. Production was only read (catalog queries, security advisor). It's described in [`PRODUCTION_SCHEMA.md`](PRODUCTION_SCHEMA.md).

## 1. Status of production today

The emergency fix is in place (seen 2026-10-29): `admin_accounts` has RLS with a self-read policy, and `anon` can no longer run `change_driver_subscription`. Still open in production until the migrations are applied:

- 46 of 52 tables have no RLS: wallets, escrow, payments, payouts, platform_config, driver documents and locations, `corporate_accounts.api_key`, chat, audit logs.
- Five dispatch views run with their owner's rights, so anon can read driver ids, plans, metrics, cities and vehicles through them even once RLS is on. 00003 now sets `security_invoker` and revokes the browser roles.
- A customer can set their own booking to paid, which dispatches a driver without payment.
- Any signed-in user can call `change_driver_subscription` for any driver and any plan.
- Any user (even anon) can run dispatch, or reclaim every assigned job.
- A sign-up can claim the `admin` profile role (UI only).
- Production defects in driver approval, subscriptions, tracking, documents and escrow ([`PRODUCTION_SCHEMA.md`](PRODUCTION_SCHEMA.md), "Defects").

## 2. What the branch contains

### Migrations (apply in order)

| File | Purpose |
|---|---|
| `00002_reconcile_production_schema.sql` | Makes production and `00001` agree on what the app relies on: one driver-identity rule, foreign keys re-pointed (rows that predate a key are kept, and the key is left NOT VALID), `plan_id` as the subscription source with `plan_slug()`, `expired` and `identity_document` allowed, review columns added, production's broken `apply_pending_plan_changes()` and `create_driver_wallet()` fixed. |
| `00003_p0_security_hardening.sql` | RLS on every table. Column guards on bookings, escrow, profiles, driver tables and payouts. The job pool without customer details, plus `claim_job()`. Dispatch and wallet functions restricted. One-time settlement of escrow to the wallet. `change_driver_subscription` checks the caller. Live tracking: `booking_driver_user()`, the location in the realtime publication, replica identity. Admin escrow release as one transaction. Fixes for production's recursive and RLS-blind escrow triggers. |
| `00004_payments_and_refunds.sql` | Provider reference and amount paid on bookings, `payment_events` (each webhook event processed once), `payment_refunds`, `refund_request_begin()` / `refund_mark()`. |
| `00005_organizations.sql` | Not P0: company accounts (organisations, members, invitations) with RLS. Described in [`ORGANIZATIONS.md`](ORGANIZATIONS.md). Can be applied with the others or later. |

Rollback scripts (production only) are in `supabase/rollback/000{5,4,3,2}_down.sql`, run newest first. They are tested to restore production's schema **and function bodies** exactly (§5).

### Edge functions

| Function | Change |
|---|---|
| `_shared/pricing.ts` | One copy of the price formula, routing fallback, commission, plan prices and slugs, and the refund-amount rule |
| `_shared/auth.ts`, `booking-charge.ts`, `plans.ts`, `vipps.ts`, `refunds.ts` | Caller identity; server-side booking price; current plan by `plan_id`; Vipps access; provider refunds with idempotency |
| `create-checkout-session`, `create-vipps-session` | Signed-in owner only; amount computed on the server; the driver's plan read by `plan_id` |
| `stripe-webhook` | Checks the paid amount. Records provider, PaymentIntent and amount paid. Activates plans through `change_driver_subscription`. Records every event in `payment_events` and skips repeats. Handles `refund.*` events. |
| `vipps-webhook` | Checks the paid amount; records the Vipps reference and amount paid |
| `process-payment` | Caller checked; release requires a captured payment and happens once; commission from the driver's real plan; the wallet is credited by the settlement trigger only |
| `refund-payment` (new) | Admin-only refund through Stripe (`/v1/refunds`) or Vipps (ePayment refund, or cancelling an uncaptured reservation). Each refund has an idempotency key that every retry reuses. The database changes only once the provider confirms. Answers: `succeeded`, `pending` (finished by webhook), `failed` (with the provider's reason) or `202 requested` (provider unreachable; calling again repeats the same request). |
| `send-booking-email` | Service-role key or `EMAIL_FUNCTION_SECRET` only |
| `calculate-price` | Shared module; output unchanged |

### Frontend

| Area | Change |
|---|---|
| Payment | No browser-side "mark paid". Corporate invoice is refused until it exists. MVA is charged once. Token-authenticated function calls. |
| Driver portal | The pool comes from `driver_job_pool()` (area, not address; no customer details); jobs are taken with `claim_job()`. Plans are read by `plan_id`; expiry calls `change_driver_subscription`. The location beacon now starts: it matched jobs on the wrong id, so it never ran. |
| Customer map | Follows the driver of the customer's own booking (`src/lib/driverTracking.ts`). Before, it passed the profile id, where locations are keyed by user id, so it never showed the driver. |
| Admin dashboard | Plans are read without the broken embed. "Assign plan" offers the real plans; it previously assigned a non-existent "premium". Release goes through `admin_release_escrow`. Refund goes through `refund-payment`. Driver documents open via 2-minute signed URLs; the old public URLs on a private bucket never worked. Required documents match what onboarding collects. |
| Fleet map | Plans are read by `plan_id` |

## 3. Behaviour changes to approve

1. **Customers pay the booking total once.** The payment page used to add 25% MVA to a price that already included it.
2. **Drivers see paid jobs only, and without customer details**, until they claim one.
3. **Free-plan drivers (and drivers with no plan) can take jobs up to 500 NOK**, now enforced on the server as the portal already stated.
4. **Corporate invoice is refused** until company accounts and invoice terms exist.
5. **Admin release needs a captured payment** and works once; the amount is unchanged.
6. **Commission uses the driver's real plan** (it was always Basic).
7. **Refunds move money.** The amount follows the old dashboard rule: share by status, or the manual percentage, applied to what was actually paid. Note that the rule gives **0 for a cancelled booking**: a customer who cancels after paying is refunded only through the manual percentage. Please confirm that's intended.
8. **Driver approval requires** driver's licence, insurance, vehicle registration and **ID document**, the four documents onboarding asks for. Before, it required a profile photo nobody uploads, so no driver could be approved. Confirm, or add a profile-photo step to onboarding.
9. **Paid bookings from before deployment** have no provider reference, so they can't be refunded automatically. The function says so; refund them in the provider's dashboard.
10. **Stripe sessions created before deployment** carry no server amount and are held for review (`payment_review_reason`), not marked paid.

## 4. Decisions still open

- **Production project.** Confirm "FlyttGo Norway" (`qzclatvpzicwhewzdiwf`) is the one Vercel production uses.
- **Driver identity.** Confirm the rule in [`PRODUCTION_SCHEMA.md`](PRODUCTION_SCHEMA.md), and decide whether to retire the `drivers` table.
- **Orphan test data** in production: profiles, driver profiles and documents for deleted users.
- **Vipps capture.** Vipps payments are reserved and never captured, so the money isn't actually collected. Refunds handle that by cancelling the reservation. **Capture on delivery** (matching the escrow model) is needed before Vipps is used for real.
- **Dispatch eligibility.** `dispatch_rank_candidates` requires `driver_profiles.subscription_active = true`, which nothing sets. Who sets it, and when?
- Also open: refunds from a cancelled booking (§3.7), the profile photo (§3.8).

## 5. Deploy order and rollback (when approved)

**Before anything:**
1. Confirm the production project (§4).
2. Re-check that production still matches the replica. Run `supabase/schema/fingerprint-summary.sql` there and compare with `supabase/schema/production-2026-10-29.fingerprint` (13 kinds, including views and table privileges). Any difference means re-snapshot and re-test first.
3. Back up the database (Supabase backup, or `pg_dump`).

**On a copy first.** Restore the backup into a Supabase branch or a separate project. Apply 00002 → 00004 and read the NOTICE output (dropped policies, keys left NOT VALID, wallets moved). Run the smoke test in `docs/DEPLOYMENT.md` §7, plus:
- a driver applies with an ID document, an admin approves them;
- a free-plan switch;
- a paid booking, then dispatch, live tracking on the customer's map, both confirmations and release;
- a refund in Stripe test mode, and in Vipps test mode.

**Production, in one maintenance window:**
1. Apply `00002`, `00003`, `00004` in one session (and `00005`, if organisations go live at the same time).
2. Set the secrets: `EMAIL_FUNCTION_SECRET` and `app.email_function_secret`, plus the Vipps and Stripe secrets if not set. Add `refund.created`, `refund.updated` and `refund.failed` to the Stripe webhook's events.
3. Deploy the frontend. It works with both old and new functions.
4. Deploy the edge functions: `create-checkout-session`, `create-vipps-session`, `stripe-webhook`, `vipps-webhook`, `process-payment`, `calculate-price`, `send-booking-email`, `refund-payment`. Functions before the frontend would refuse the old frontend's calls.
5. Re-run the security advisor. Expect no `rls_disabled` findings.

**Rollback:**
1. Redeploy the previous frontend and functions (Vercel and Supabase keep earlier versions).
2. Run `supabase/rollback/00005_down.sql` (if 00005 was applied), `00004_down.sql`, `00003_down.sql`, `00002_down.sql` in that order.
   - Each file states the columns and tables it drops. Export `payment_refunds` first if any refund was made.
   - Wallets moved by 00002 are not moved back.
3. The rollback re-opens the holes in §1. Use it only to return to a known state.

## 6. Tests (local run, 2026-10-29, PostgreSQL 16; CI runs 17 like production)

The pre-deployment review and its fixes: [`PREDEPLOY_REVIEW.md`](PREDEPLOY_REVIEW.md). The copy-of-production test plan: [`COPY_OF_PRODUCTION_TEST_PLAN.md`](COPY_OF_PRODUCTION_TEST_PLAN.md).

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors; warnings identical to `main` |
| `npm run build` | passes |
| `npm test` (Vitest) | **38 / 38**: pricing and browser/server formula parity, refunds against fake Stripe/Vipps (success, pending, refusal, retry, idempotency key reuse, uncaptured cancel, no double call), tracking (beacon id, customer map follow/stop) |
| `npm run test:db` | **repo schema 189 / 189; production replica 212 / 212** (P0 109 and 132, organisations 80 on each); **rollback restores production exactly**; **rollback with data** succeeds and keeps every core row |
| Edge functions | Strict TypeScript with stand-in Deno/URL types passes. Real `deno check` runs in CI (deno.land is blocked here). |

`npm run test:db` checks, on each schema:
- Customers can't mark bookings paid, change prices, confirm for the driver, see others' bookings, run dispatch, credit wallets or become admin.
- Anon reads nothing.
- The pool carries no customer name, phone, email, notes or street address; claims are single and plan-limited.
- Plans are by `plan_id`, and slugs resolve.
- Tracking: the beacon upsert works, only the customer of the in-flight booking sees the location, the table is in the publication, and access stops after completion.
- Driver documents in storage: owner and admins only.
- Release and settlement credit the wallet exactly once.
- Refunds: browser callers refused, no provider reference refused, over-refund refused, retries reuse the key, effects apply once and only on success, a failed refund allows a new key.
- On the production replica additionally: driver approval, expiry to free, production's confirmation and adjustment triggers.

What these tests don't prove: Realtime delivery and Storage signed URLs on a real Supabase stack, the browser's geolocation permission prompt, and real provider responses. Those need the copy-of-production smoke test above, with Stripe and Vipps in test mode.

## 7. Follow-ups not in this branch

- Vipps capture on delivery (§4).
- PaymentPage still shows its own card-number fields before redirecting to Stripe. Nothing is sent, but they should go (PCI scope).
- CORS is `*` on all functions; restrict it to `FRONTEND_URL`.
- The location beacon runs only while the driver portal is open in a browser.
- Norwegian translations for the corporate pages are missing.
