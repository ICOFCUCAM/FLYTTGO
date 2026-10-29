# Copy-of-production test plan

Run this on a **disposable** Supabase project restored from a production backup, with Stripe and Vipps in **test mode**. It proves what the local database tests can't: real Auth, PostgREST, Realtime, Storage, edge functions and provider responses.

Every item must pass before production is touched ([`PREDEPLOY_REVIEW.md`](PREDEPLOY_REVIEW.md) §5). Record each result (pass/fail, who, when, evidence link) in a copy of this file.

## 0. Environment

1. **Backup.**
   - Take a production backup, or `pg_dump --schema-only` plus data for the public, auth and storage schemas.
   - Restore it into a new project, for example "FlyttGo Norway – copy 2026-11".
   - Never use a Supabase branch of production that shares its Auth or Storage.
2. **Fingerprint.** On the copy, before migrating: `supabase/schema/fingerprint-summary.sql` must equal `production-2026-10-29.fingerprint`.
3. **Migrations.** Apply `00002` → `00006` in one session. Save the NOTICE output (policies dropped, keys left NOT VALID, wallets moved).
4. **Secrets on the copy only.**
   - Stripe test keys (`sk_test_…`, webhook signing secret for a test endpoint);
   - Vipps test credentials (`apitest.vipps.no`) and `VIPPS_WEBHOOK_SECRET`;
   - `EMAIL_FUNCTION_SECRET` and `FRONTEND_URL` pointing at a preview deployment.
5. **Deploy.** Deploy the edge functions to the copy. Deploy a Vercel preview with `VITE_SUPABASE_URL` set to the copy.
6. **Test accounts.** Create these (confirmed emails):

   | Account | Role |
   |---|---|
   | `admin1` | platform admin, a row in `admin_accounts` |
   | `cust1`, `cust2` | customers |
   | `drv1` | driver on Pro |
   | `drv2` | driver on Free |
   | `applicant` | someone applying to drive |
   | `ownerA`, `ownerB` | owners of companies A and B |
   | `bookerA`, `viewerA` | members of company A |
   | `outsider` | no company |

7. **API harness.** For every negative test, call PostgREST directly with each user's access token (`curl` with `apikey` and `Authorization: Bearer <token>`), not only through the UI. A UI that hides a button proves nothing.

## 1. Security advisor and grants

- [ ] The security advisor shows no `rls_disabled_in_public` and no `security_definer_view` errors.
- [ ] `select relname, reloptions from pg_class where relkind = 'v' and relnamespace = 'public'::regnamespace` shows `security_invoker=true` on all five views.
- [ ] Anon: `GET /rest/v1/<each table and view>?select=*` returns `[]` or 401/403 for every table except `subscription_plans`.

## 2. Bookings and payments

- [ ] **Booking and Stripe payment.** `cust1` books and pays by Stripe test card. Expect: `payment_status` escrow, `paid_amount` equal to the charged total, the PaymentIntent stored, a `payment_events` row.
- [ ] **Webhook replay.** Resend the same Stripe event from the dashboard. Expect a `duplicate` answer and no second effect.
- [ ] **Self-marking paid (negative).** `cust1` PATCHes their own booking `payment_status=paid`, `final_price=1`, `driver_confirmation=true`. Expect each one refused.
- [ ] **Other customers' bookings (negative).** `cust2` reads, updates or deletes `cust1`'s booking. Expect nothing returned, 0 rows changed.
- [ ] **Dispatch from the browser (negative).** Anon and `cust1` call `rpc/dispatch_assign_best_driver` and `rpc/reclaim_stale_dispatches`. Expect refused.
- [ ] **Wallet credit (negative).** `cust1` and `drv1` insert into `driver_wallet_transactions` or update `driver_wallets`. Expect refused.

## 3. Driver pool, claims and privacy

- [ ] **Pool privacy.** `drv1` calls `rpc/driver_job_pool`. Expect no customer name, phone, email, notes, street address or exact coordinates.
- [ ] **Direct reads (negative).** `drv1` selects `bookings` directly. Only their own jobs come back.
- [ ] **Race to claim.** `drv1` and `drv2` claim the same job at the same moment (two parallel `rpc/claim_job` calls). Exactly one gets `true`.
- [ ] **Plan limit.** `drv2` (Free) claims a job over 500 NOK. Expect refused.
- [ ] **After claiming.** `drv1` sees the customer contact for their claimed job only.

## 4. Live tracking (Realtime, Storage)

- [ ] **Location updates.** `drv1` opens the portal with a job in transit and allows the browser's location prompt. Expect a `driver_locations` row updated about every 10 seconds under `drv1`'s user id.
- [ ] **Customer map.** `cust1` (that job's customer) opens the map. The marker moves on each update, delivered over Realtime without reloading.
- [ ] **Other customers (negative).** `cust2` subscribes to `driver_locations` for `drv1` through Realtime and through REST. Expect nothing received.
- [ ] **After completion.** Complete the job. `cust1` stops receiving positions.

## 5. Driver documents

- [ ] **Upload.** `applicant` uploads the licence, insurance, vehicle registration and ID document.
- [ ] **Admin access.** `admin1` opens each one from the dashboard. A signed URL opens it; after 2 minutes the same URL is refused.
- [ ] **Other users (negative).** `drv2` and `cust1` list or download the folder through Storage (`/storage/v1/object/driver-documents/<applicant>/…`). Expect refused. The bucket is not public.
- [ ] **Approval rules.** Approval is refused while any of the four documents isn't approved. The application stays pending.
- [ ] **Approval succeeds.** Approval then creates exactly one `driver_profiles` row. Re-approving creates no second row.

## 6. Subscriptions

- [ ] **Free plan.** `drv2` switches to Free in the portal. It succeeds.
- [ ] **Paid plan from the browser (negative).** `drv2` calls `rpc/change_driver_subscription` with `pro`. Expect "paid plans are activated by payment".
- [ ] **Paid plan by payment.** `drv2` buys Pro with a Stripe test card. The webhook activates Pro by `plan_id` with an end date one month ahead.
- [ ] **Someone else's plan (negative).** `drv1` calls `change_driver_subscription` for `drv2`. Expect refused.
- [ ] **Expiry.** Set an end date in the past on the copy, then run the expiry cron (if `pg_cron` is enabled) or open the portal. Expect the row `expired` and Free active.
- [ ] **Dispatch eligibility.** Record what dispatch does with no `subscription_active` drivers (expected today: no candidates; see the review §3, open item 1).

## 7. Refunds (test mode)

- [ ] **Stripe, full refund.** Refund a paid Stripe booking. Expect: the Stripe dashboard shows the refund, then `payment_refunds` `succeeded`, escrow `refunded`, booking `refunded`.
- [ ] **Stripe, partial refund.** A partial refund leaves the booking status unchanged.
- [ ] **Stripe, retry.** Block outbound calls (wrong key), refund, restore the key, refund again. Expect the same idempotency key in the Stripe logs, and a single refund.
- [ ] **Stripe, refusal.** Refund an already-refunded PaymentIntent. Expect `failed` with Stripe's reason, and no database effect.
- [ ] **Stripe, pending.** With a payment method that refunds asynchronously, expect `pending`, then `succeeded` from `refund.updated`.
- [ ] **Vipps, authorised but not captured.** Refund cancels the reservation. Expect the Vipps test portal to show it cancelled.
- [ ] **Vipps, after capture.** Once capture exists (review §4.2): a captured payment, partially refunded, shows the verified amount.
- [ ] **Released escrow.** A refund after release takes the driver's earning back once.
- [ ] **Callers (negative).** `cust1`, `drv1` and anon call `refund-payment` and `rpc/refund_request_begin`. Expect refused.

## 8. Organisations: tenant isolation (all through the API)

- [ ] **Registration.** `ownerA` and `ownerB` each register a company. Each is `pending`, and each owner is its only owner.
- [ ] **Reading across companies (negative).** `ownerA` selects `organizations`, `organization_members`, `organization_invitations` and `organization_events`. Only company A's rows come back.
- [ ] **Acting across companies (negative).** `ownerA` calls `invite_member`, `update_organization`, `change_member_role`, `remove_member` and `revoke_invitation` with company B's ids. Expect refused (42501).
- [ ] **Direct writes (negative).** `ownerA` INSERTs into `organization_members` for company B, or PATCHes `organizations.status = 'active'`. Expect refused: no table privilege.
- [ ] **Anon (negative).** Anon reads any organisation table or calls any organisation RPC. Expect refused.
- [ ] **Outsider (negative).** `outsider` calls `organization_team(<A>)`. Expect an empty result.

## 9. Organisations: roles, invitations, owner retention

- [ ] **Invite and accept.** `ownerA` invites `bookerA` as booker. `bookerA` accepts with the token and joins as booker. Their `profiles.role` and any driver plan are unchanged.
- [ ] **Wrong address (negative).** `cust1` uses `bookerA`'s token. Expect "invitation is for another email address".
- [ ] **Unconfirmed address (negative).** A new unconfirmed user with the invited address tries to accept. Expect refused.
- [ ] **Replay.** Accept the same token again. Expect refused.
- [ ] **Replaced invitation.** Re-invite the same address. The first token stops working.
- [ ] **Expiry.** Set `expires_at` in the past on the copy, then accept. Expect refused.
- [ ] **Admin limits.** An admin of A can't promote to admin or owner, demote the owner, remove the owner or invite an owner.
- [ ] **Last owner.** The last owner can't leave or step down. With a second owner, they can.
- [ ] **Account deletion.** Deleting the last owner's auth user from the dashboard is refused. Record the behaviour for the GDPR process (review §3, open item 7).
- [ ] **Event log.** `organization_events` has a row for every step above. An UPDATE or DELETE on it with the service key is refused.
- [ ] **Verification gate.** `admin1` activates A, and `is_active_org_member` becomes true for its members. After suspending A it is false, and A can't invite.
- [ ] **Read-only members.** A booker or viewer sees no invitations or events.

## 9a. Launch decisions (00006, [`DECISIONS.md`](DECISIONS.md))

**Dispatch**
- [ ] With `subscription_active` false for everyone, a paid booking is dispatched: Pro and Unlimited drivers outrank Free, and Free drivers never get jobs over 500 NOK.
- [ ] A monthly plan whose end date passed 1 hour ago still dispatches as that plan. After 25 hours, the driver works as Free. The cron (or opening the portal) marks the plan expired and starts Free.

**Cancellations (Stripe test mode)**
- [ ] Book for a pickup 3 days away, pay by Stripe, and cancel from My Bookings. Expect `cancelled_by` customer, a 100% refund in the Stripe dashboard, and `payment_refunds` succeeded.
- [ ] Book for a pickup 12 hours away and cancel. Expect a 50% refund; the booking stays paid with the fee kept.
- [ ] **Negative:** PATCH `cancelled_by` or `cancelled_at` through the API. Expect refused.

**Vipps (test mode)**
- [ ] **Fee, then cancel.** Cancel a Vipps booking within 24 hours. In the Vipps test portal: 50% captured, the rest cancelled. Calling `cancel-booking` again changes nothing.
- [ ] **Confirm before paid.** A forged webhook with the right secret but a reference Vipps doesn't know leaves the booking unpaid, held for review.
- [ ] **Capture on delivery.** Both parties confirm a Vipps booking. The escrow goes to `capture_pending` until `process-payment` captures; then it is released and the driver is paid once. Vipps shows the full amount captured.
- [ ] **Vipps outage.** With Vipps unreachable (wrong key), the release answers "being collected" and nothing is paid. With the key restored, the next call completes it.

**Companies**
- [ ] **Activation needs a check.** Activating a pending company without a check is refused. `verify-organization` against a real organisation number passes, records the evidence and sets the VAT flag; activation then succeeds.
- [ ] **Failed checks.** A wrong name or a bankrupt test number fails, and activation stays refused.
- [ ] **Admins are not members (negative).** As `admin1`, `invite_member`, `change_member_role` and `update_organization` on a company are refused. `admin_transfer_ownership` with a reason works and is logged.
- [ ] **Invitation email.** `send-organization-invitation` emails the invitee (check the Resend log). The link opens `/business/invite`; signing in with the invited, confirmed address joins the company with the invited role. The token disappears from the address bar.
- [ ] **Rate limit.** The 21st invitation within an hour is refused (429).

## 10. Rollback rehearsal (on the copy)

- [ ] **Run the rollback.** After sections 2–9 have written data: export the refund, event and organisation tables, then run `00006_down` → `00002_down`.
- [ ] **Constraints.** Expect it to succeed. Note the NOTICEs: the NOT VALID constraints should match those listed in the review §5.
- [ ] **Old frontend.** Redeploy the previous frontend and functions. Confirm the site loads and an existing booking is visible to its customer.
- [ ] **Re-apply.** Apply 00002 → 00005 again and repeat the smoke items (2, 3, 4, 7: one each). Expect them to pass.

## 11. Sign-off

| Item | Owner | Result | Evidence |
|---|---|---|---|
| Sections 1–10 pass | | | |
| Migration and rollback reviewed | | | |
| CI green on the branch head | | | |
| Production fingerprint re-checked the same day | | | |
