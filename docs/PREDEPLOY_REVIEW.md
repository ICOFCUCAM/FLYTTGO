# Pre-deployment review: P0 security, payments and organisations

Review of branch `claude/vibrant-johnson-awo68u`: commits `1467ec5` and `6cdfab3`, plus the fixes this review made (§3). Done on 2026-10-29.

Production was only read: catalog queries and row counts. Nothing was applied, deployed or deleted, live payments were not enabled, and nothing was merged.

Companion documents:
- [`SECURITY_P0.md`](SECURITY_P0.md): the changes and the deploy order.
- [`PRODUCTION_SCHEMA.md`](PRODUCTION_SCHEMA.md): production as read.
- [`ORGANIZATIONS.md`](ORGANIZATIONS.md): company accounts.
- [`COPY_OF_PRODUCTION_TEST_PLAN.md`](COPY_OF_PRODUCTION_TEST_PLAN.md): the test plan.

## 1. Verified facts

| Fact | How it was verified |
|---|---|
| Production is "FlyttGo Norway" `qzclatvpzicwhewzdiwf`, PostgreSQL 17.6, the only active FlyttGo project. Its migration history is empty (schema built by hand). | Supabase project list; `list_migrations`; `server_version` |
| Production still matches the recorded snapshot. | `fingerprint-summary.sql` run on production today: all hashes identical |
| The snapshot now also covers views, table privileges, replica identity and storage buckets (13 kinds, up from 9). The replica reproduces all 13 hashes. | New kinds computed on production and on the replica; `run.sh` refuses to run if they differ |
| **Production has five views that bypass RLS** (`driver_dispatch_tiers`, `driver_dispatch_eligibility`, `driver_dispatch_scores`, `dispatch_wave_priority`, `match_drivers_for_booking_view`). They have owner rights and no `security_invoker`, and anon has full privileges on them. Neither the app nor any function uses them. | `pg_class.reloptions`, view ACLs, code search |
| All 52 tables carry Supabase's default grants (all privileges to anon, authenticated, service_role). RLS is therefore the only barrier, which is what 00003 adds. | `relacl` on production |
| Organisation access is enforced in the database. RLS is on all four tables, the API roles have no write privileges, and every change goes through a function that checks the company role. Tested: cross-tenant isolation, invitation acceptance (email binding, confirmed address, expiry, single use, replacement), role changes (owner and admin limits), owner retention (functions and raw SQL), and an append-only event log (server role and database owner included). | `organizations.test.sql`, 80 checks, run on both schemas |
| Company membership never reads or writes `profiles.role`, `admin_accounts` or driver subscriptions. | Code reading; tests check the profile role and the driver plan after joining |
| The rollback restores production exactly, now including table privileges and views. | `run.sh`, variant "rollback" |
| **The rollback also succeeds after the new features have written data.** All booking, subscription, document, location, application, escrow and wallet rows are kept. | `run.sh`, new variant "rollback with data" |
| Local results: `typecheck` 0 errors; `lint` 0 errors (25 warnings, the same as `main`); `build` passes; Vitest 38/38; database tests repo 189/189, production replica 212/212, rollback exact, rollback with data passes. | Local runs on PostgreSQL 16 |
| **CI has never run on this branch.** The workflow ran only on pull requests and pushes to `main`. | GitHub Actions: 0 runs for the branch |

## 2. Unresolved assumptions

- **Vercel production uses `qzclatvpzicwhewzdiwf`.** This is not verified: flyttgo.no and Vercel are unreachable from this environment. Check `VITE_SUPABASE_URL` in Vercel → Project → Settings → Environment Variables (Production).
- **The database tests ran on PostgreSQL 16, production runs 17.6.** CI now uses `postgres:17`, but it hasn't run yet (§6).
- **Edge functions have not been through a real `deno check`.** deno.land is blocked here; CI runs it.
- **Real Supabase behaviour is unproven:** Realtime delivery, Storage signed URLs, and the PostgREST/Auth behaviour around the functions. The stub models them; the copy-of-production test proves them.
- **Provider behaviour is unproven:** the Stripe and Vipps calls are tested against fakes only.
- **Production can change after today.** Re-run the fingerprint immediately before applying anything.

## 3. Defects

### Fixed on the branch by this review (not deployed)

| Defect | Fix |
|---|---|
| The five production views let anon read driver ids, plans, metrics, cities and vehicles despite RLS | 00003 sets `security_invoker` on every view and revokes anon/authenticated (server keeps access); `00003_down` restores them. Tested. |
| The snapshot didn't cover views, table privileges, replica identity or bucket settings, so the rollback test couldn't see them | Fingerprint extended to 13 kinds; replica gained the views and the bucket's 10 MB / JPEG-PNG-PDF limits |
| An invitation could be accepted with an unconfirmed address (if Supabase's email confirmation is off) | `accept_invitation` requires `email_confirmed_at`. Tested. |
| The organisation event log was append-only for browser roles only | Trigger refuses UPDATE and DELETE for every role; rows go only with their organisation. Tested. |
| Nothing distinguished a verified company from a pending one for later features | `is_active_org_member()`: active organisation and active member. Bookings, invoices, credit and API keys must use it. Tested (pending, active, suspended). |
| Approving a driver marked the application approved before checking documents, so a refused activation left it "approved" with no driver | Documents are checked first (`AdminDashboard.tsx`) |
| Re-approving a driver inserted another `driver_profiles` row, which breaks the portal's single-row read | Approval reuses the existing profile; the portal reads the oldest row, as `my_driver_id()` does |
| Free-plan switches in the driver portal reported success even if the server refused | The error is shown |
| The "credit covers the upgrade" path called a function the server now refuses and wrote wallet credit from the browser, while showing success | It now says to contact support. It can't occur at today's prices (Pro credit is always below the Unlimited price). |
| CI database ran PostgreSQL 16, and CI couldn't run on a branch | `postgres:17`; `workflow_dispatch` trigger added |

### Open: need a fix or a decision before launch

> **Update 2026-10-29:** the owner adopted the recommendations in §4. Items 1, 4, 5, 6 and 7 are built on the branch (migration 00006 and the functions listed in [`DECISIONS.md`](DECISIONS.md)). Item 2 needs `pg_cron` enabled. Item 3 is reduced: eligibility reads only `driver_subscriptions`. Item 8 is unchanged by decision. Remaining for legal review and Vipps: see `DECISIONS.md`, "Still to do".

1. **Dispatch finds no drivers.** `dispatch_rank_candidates` requires `driver_profiles.subscription_active = true`. Nothing sets it, and it is false on all production rows. The tests set it by hand, which hides the gap. See §4.1 for the replacement.
2. **Subscriptions never expire on their own.** Production has no `pg_cron`. Expiry runs only when the driver opens the portal. The cron in `docs/subscription-expiry-cron.sql` needs `pg_cron` enabled.
3. **There are four sources of truth for a driver's plan.** `driver_subscriptions` (canonical), plus `driver_profiles.subscription_plan`, `drivers.subscription_plan` and `drivers.default_plan_id`. A second, empty `subscriptions` table also points at `driver_profiles`.
4. **Vipps money is never collected.** Vipps payments are reserved, never captured. The webhook comments call the money "captured", which is wrong. The webhook also trusts the callback body's `sessionState` and amount, authenticated only by the bearer secret (compared with `===`). It should confirm the state with Vipps before marking a booking paid. See §4.2.
5. **The published Terms and the refund code disagree.**
   - Terms §6.1: full refund more than 24 hours before pickup; 50% fee within 24 hours; full refund when the driver cancels.
   - Code: refund share by booking status; 0 for a cancelled booking.
   - Terms §6 also says prices are shown **excluding** MVA. The payment page now charges the price that includes MVA, and Norwegian consumer pricing generally requires prices shown to consumers to include VAT.
   - See §4.3.
6. **A customer cancelling doesn't record who cancelled or when**, and triggers no refund. The policy in §4.3 needs both.
7. **The last owner of an organisation blocks deleting their user account.** The trigger refuses removing the last owner. Decide whether to transfer ownership or close the organisation first (recommended), and document it for GDPR deletion requests.
8. **Driver identity is split across `drivers` and `driver_profiles`.** See §4.4.
9. The follow-ups from `SECURITY_P0.md` §7 remain:
   - card fields on PaymentPage (PCI scope);
   - CORS `*` on the edge functions;
   - the location beacon runs only while the driver portal is open;
   - Norwegian translations for the corporate pages.

## 4. Recommended designs and business decisions

### 4.1 Subscription lifecycle and dispatch eligibility

**How it works today (traced in code):**

| Step | What happens |
|---|---|
| Activation | Stripe Checkout `mode=payment` (a one-off payment, not a Stripe Subscription). `stripe-webhook` (`checkout.session.completed`, amount checked) calls `change_driver_subscription(user_id, slug)` as the server. That updates or inserts the active `driver_subscriptions` row: `plan_id` set, end date one day or one month ahead by `billing_period`. Free and Basic can be chosen by the driver; the server refuses paid plans from the browser. |
| Renewal | None. The driver pays again by hand. No card is kept on file. |
| Failed payment | Not applicable today: there is no recurring charge. A failed Checkout simply never activates. |
| Cancellation | The admin dashboard sets `subscription_status = 'cancelled'`. Nothing else does. |
| Expiry | The portal (when the driver visits) or the cron (not installed) marks the row `expired` and starts Free through `change_driver_subscription`. |
| Eligibility | `subscription_active` is unused by the subscription code and is never set. |

**Recommended:**
- Replace the boolean with a derived check: a driver is eligible when they have an active subscription row whose plan resolves through `plan_id` and whose `end_date` is null (Free) or later than `now()` minus a grace period. Put it in one SQL function used by `dispatch_rank_candidates`, `claim_job` and the pool; then retire `subscription_active` (keep the column, stop reading it).
- Only the server writes subscriptions: webhook, admin RPC and cron. This is already enforced.
- Enable `pg_cron` and schedule the expiry job, so expiry doesn't depend on the portal.
- **Decide:** the grace period after `end_date` (suggested 0 for daily plans, 24 hours for monthly); whether Free and Basic drivers are dispatchable (the pool already lets them claim jobs ≤ 500 NOK); and whether to move to Stripe Subscriptions for auto-renewal. If so, add `invoice.paid`, `invoice.payment_failed` and `customer.subscription.deleted` handling and a dunning rule (for example 3 retries over 7 days, then Free).

### 4.2 Vipps lifecycle (do not enable live Vipps until this is done)

| Stage | State today | Needed |
|---|---|---|
| Reserve (authorise) | Checkout v3 session; webhook on `PaymentSuccessful` marks the booking paid and escrowed | Before marking paid, call `GET /epayment/v1/payments/{reference}` to confirm `AUTHORIZED` and the amount, rather than trusting the callback body. Use a constant-time secret comparison. |
| Capture | **Missing** | Capture at the agreed milestone, with an `Idempotency-Key` and a `payment_events` record. Recommended: on delivery confirmation (the escrow release point), matching the escrow model. Vipps' rule is to reserve, then capture when the service is delivered. Check how long Vipps keeps a reservation open, because moves can be booked weeks ahead. |
| Cancel | Done via the refund function (cancels an uncaptured reservation in full) | Also cancel automatically when a booking is cancelled before capture |
| Refund | Done (ePayment refund, verified amount, idempotent) | Test mode verification |
| Expiry | Not handled | Handle `SessionExpired` and expired reservations by setting the booking back to unpaid |

### 4.3 Cancellation and refunds

**Recommended:** one published policy, held in `platform_config` and applied by `refundAmountFor()`, computed from who cancelled, when (against the scheduled pickup) and what work was done. Not from the booking status alone. This requires `cancelled_by` and `cancelled_at` on bookings.

A starting point that matches today's Terms:

| Situation | Customer gets back |
|---|---|
| FlyttGo or the driver cancels | 100% |
| Customer cancels more than 24 hours before pickup | 100% |
| Customer cancels within 24 hours | 50% |
| No-show, or work started | Per a disputes decision; manual percentage |

**For legal review (Norway):**
- Whether the angrerettloven exception for transport of goods on a specific date applies, so there is no 14-day withdrawal right. That would make the cancellation terms contractual.
- Whether the fees are reasonable under avtaleloven § 36.
- Showing prices to consumers including MVA (prisopplysningsforskriften). The Terms text "excluding 25% MVA" should change.
- The "liability limited to the platform commission" clause, as applied to consumers.
- Business customers (organisations) can get different terms by contract.

### 4.4 Driver identity (no records deleted or merged)

What production holds:
- `drivers`: 5 rows, none linked to an existing user. Ten foreign keys point at it.
- `driver_profiles`: 4 rows, one with no `user_id`, the rest for deleted users.
- 4 users have both a `drivers` and a `driver_profiles` row.

**Recommended canonical model:**
- The auth user id is the person.
- `driver_profiles.id` is the approved driver (one per user; add a unique index on `user_id` once the null and orphan rows are resolved).
- `drivers` is legacy: read-only, not written by the app, kept until its ten dependants (`chat_rooms`, `commission_ledger`, `driver_payouts`, `driver_wallet`, `reviews`, `subscription_payments`, plus the four that 00002 re-points) have a mapped plan.

**Migration plan (each step approved separately):**
1. Map every `drivers` row to its user and profile, in a report table.
2. Point new features only at `driver_profiles`.
3. Re-point the remaining foreign keys with NOT VALID keys, as 00002 does.
4. Only then decide whether `drivers` is archived.

The orphan rows stay as they are (your decision): investigate them, don't delete them.

### 4.5 Organisation verification lifecycle

| Status | May do | May not do |
|---|---|---|
| `pending` (on registration) | Edit details, invite and manage the team | Bookings, invoices, credit, API keys, white-label (all gated by `is_active_org_member()`) |
| `active` | Everything its plan allows | — |
| `suspended` | Read its data | Invite; anything `is_active_org_member()` gates |
| `closed` | Read its data | Everything else; reopen only by platform admin |

**Verification before activation (admin, `admin_set_organization_status`):**
1. The organisation number passes MOD11 (in the database).
2. A server function looks it up in Brønnøysundregistrene (Enhetsregisteret open API, `data.brreg.no/enhetsregisteret/api/enheter/{orgnr}`) and stores the answer as evidence: name match, not bankrupt (`konkurs`), not being wound up (`underAvvikling`), not deleted, and VAT registration (`registrertIMvaregisteret`).
3. The applicant is authorised for the company: a role in Brønnøysund, or a signed form.
4. For credit or invoice terms: a credit check (separate decision).

**Invitation emails:**
- A new edge function `send-organization-invitation` calls `invite_member` with the caller's token and emails the link `https://flyttgo.no/invite?token=…` through the existing email path.
- The token never appears in the browser of the person who invited.
- Rate limits per organisation are needed.

**Decide:**
- Whether platform admins keep full company powers inside a tenant (today yes, logged as the admin), or get read-only plus status.
- Whether to require Brønnøysund verification for every Norwegian company.

## 5. Exact pre-deployment and rollback steps

**Before anything (read-only):**
1. Vercel: confirm the Production `VITE_SUPABASE_URL` is `https://qzclatvpzicwhewzdiwf.supabase.co`.
2. Run `supabase/schema/fingerprint-summary.sql` in the production SQL editor and compare with `supabase/schema/production-2026-10-29.fingerprint`. All 13 lines must match, or production changed: re-snapshot and re-test.
3. Check the migration history is still empty: `select * from supabase_migrations.schema_migrations;`.
4. Run CI on the branch and get it green (§6).
5. Review the diff (`git diff main...claude/vibrant-johnson-awo68u`), the migrations and rollbacks, and approve them.

**On a disposable copy:** follow [`COPY_OF_PRODUCTION_TEST_PLAN.md`](COPY_OF_PRODUCTION_TEST_PLAN.md). Every item must pass.

**Production (one maintenance window, only after approval):**
1. Take a backup (Supabase dashboard → Database → Backups, plus `pg_dump`).
2. Apply `00002` → `00007` in one session. Keep the NOTICE output.
3. Set the secrets and the Stripe webhook events (`SECURITY_P0.md` §5).
4. Deploy the new functions, then the frontend, then the changed functions (`SECURITY_P0.md` §5 lists them).
5. Run the security advisor (expect no `rls_disabled` or `security_definer_view` errors).
6. Watch the function logs and `payment_events` for the first payments.

**Rollback:**
1. Redeploy the previous frontend and functions.
2. Export `payment_refunds`, `payment_events` and the four organisation tables if they hold data.
3. Run `00007_down`, `00006_down`, `00005_down`, `00004_down`, `00003_down` and `00002_down`, in that order. Each returns exactly to the state before its migration (tested).

What the rollback does **not** reverse, tested in "rollback with data":
- Rows written while the migrations were in force are kept. Their foreign keys and CHECK constraints come back **NOT VALID**: the eight constraints are listed by the test and printed as NOTICEs. Production's old code then works as badly as before.
- Wallets moved by 00002 stay on the profile id.
- Dropped data: refund records, webhook event records, organisations with their members, invitations and log, `paid_amount`/`paid_at`, the review columns on applications, and the manual refund and review columns.
- Bookings already refunded stay `refunded`.
- The rollback re-opens every P0 hole.

## 6. CI

The workflow now runs on `workflow_dispatch`, so it can run on this branch before a PR (Actions → CI → Run workflow → branch `claude/vibrant-johnson-awo68u`). It runs three jobs.

**Typecheck, lint, unit tests, build:**
```bash
npm ci && npm run typecheck && npm run lint && npm test && npm run build
```

**Edge Functions (deno check), Deno 2.1:**
```bash
deno check supabase/functions/*/index.ts
```

**Database security tests**, on PostgreSQL 17, never against a real project:
```bash
docker run -d --name flyttgo-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
```
```bash
PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres bash supabase/tests/run.sh
```
