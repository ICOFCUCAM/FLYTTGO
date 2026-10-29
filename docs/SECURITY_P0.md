# P0 security remediation

Branch `claude/vibrant-johnson-awo68u`. **Nothing here is deployed or applied.** The migration has not been run against any Supabase project, and no edge function has been redeployed. Everything below was tested locally on PostgreSQL 16 (database) and Node (pricing).

Production was inspected **read-only** on 2026-10-29: project "FlyttGo Norway" (`qzclatvpzicwhewzdiwf`, catalog queries and the Supabase security advisor only).

---

## 1. Open in production right now (urgent)

These hold on the live project today, independent of this branch:

| # | Exposure | Why |
|---|---|---|
| 1 | **Anyone with the public anon key can make themselves an administrator.** | `admin_accounts` has RLS **off**; `is_admin()` trusts any row in it. Check that the 2 existing rows are the people you expect. |
| 2 | **Anyone can put any driver on any plan** (e.g. Unlimited, 0% commission, top dispatch priority). | `change_driver_subscription` is SECURITY DEFINER and executable by `anon`. |
| 3 | 47 of 52 public tables have RLS off: wallets, escrow, payments, payouts, platform_config, driver documents and locations, `corporate_accounts.api_key`, audit logs, chat, … | Readable and writable with the anon key. |
| 4 | A customer can mark their own booking paid → a driver is dispatched without payment. | `bookings_customer_update` allows every column; `PaymentPage` did exactly this as a "fallback". |
| 5 | Any signed-in user can run dispatch on any booking, or un-assign every stale job. | `dispatch_assign_best_driver` / `reclaim_stale_dispatches` are granted to `anon` and `authenticated`. |
| 6 | A sign-up can choose `role: admin` in its profile. | `handle_new_user()` copies the role from user metadata (UI only; `is_admin()` is not fooled). |
| 7 | Approving an over-time charge fails. | `capture_extra_escrow_after_approval` re-fires itself until "stack depth limit exceeded". |
| 8 | A driver's wallet can be credited repeatedly, or set to NULL. | `settle_driver_wallet_after_release` credits on every update of a released escrow row (and `balance + NULL`). |

Items 1 and 2 can be closed **in minutes, without this branch**, by this SQL. I have **not** run it:

```sql
-- Emergency, ahead of the full migration. Reversible.
ALTER TABLE public.admin_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_accounts_self_select ON public.admin_accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid());   -- auth.tsx reads its own row
REVOKE EXECUTE ON FUNCTION public.change_driver_subscription(uuid, text) FROM PUBLIC, anon;
```

`is_admin()` is SECURITY DEFINER, so admins keep working. A signed-in user can still call `change_driver_subscription` for anyone until `00002` is applied.

---

## 2. What changed on this branch

### Database: `supabase/migrations/00002_p0_security_hardening.sql`

- **RLS on every table in `public`** (the loop covers production-only tables too). Existing policies are dropped, with each name printed as a NOTICE, and recreated from the repository's own access list. Administrators keep full access. Tables the browser never touches stay admin-only.
- **Column guards** (BEFORE triggers, by allow-list, so unknown production columns are protected by default):
  - **bookings, customer:** may confirm a *completed* job, cancel a *pending* one, and edit notes. Inserts reset payment, assignment and outcome fields.
  - **bookings, driver:** may claim an unassigned *paid* job, move their own job through its statuses with start/end times, and confirm once completed.
  - **escrow:** the customer creates the `held` row (the amount is taken from the booking) and may approve an adjustment.
  - **Other tables:** a driver may toggle `online` only. Applicants cannot set their review outcome. Documents start pending. Drivers may start only free/basic plans and expire a lapsed one. Payouts are capped at the wallet balance.
  - **profiles:** the role cannot be changed by the user. Sign-up roles are limited to customer/driver/business.
- "Privileged" means admin, service role, a direct DB session, or this migration's own trusted function. Writes made by other triggers (production's escrow lifecycle) are not treated as the client's.
- **Dispatch:** production's bodies are kept unchanged and renamed `*_internal`. The public names refuse anyone but admins, the service role and the payment trigger.
- **Money:**
  - `settle_driver_wallet_after_release` is now the single place a wallet is credited: once, for the booking's driver, only when `driver_earning` is set.
  - `admin_release_escrow` / `admin_refund_escrow` replace five separate browser writes with one transaction each, and refuse a second release or refund.
  - The wallet RPCs are service-role only. Production's versions are kept.
- **`change_driver_subscription`:** production's body is kept as `_internal`. The public name checks the caller: own subscription only, and free/basic only, unless admin or service.
- **Production fixes in place:**
  - `capture_extra_escrow_after_approval` no longer recurses.
  - Production's escrow triggers run as owner, so RLS does not silently stop them.
- **Columns the code already used but the schema lacked:** `bookings.manual_refund_percent`, `bookings.payment_review_reason`, the escrow adjustment/release columns, and `driver_subscriptions.plan`.

### Edge functions

| Function | Change |
|---|---|
| `_shared/pricing.ts` (new) | One copy of the price formula, routing fallback, commission and driver-plan prices. `calculate-price` and `process-payment` import it instead of carrying mirrors. |
| `_shared/auth.ts`, `_shared/booking-charge.ts` (new) | Caller from the `Authorization` token; server-side pricing of a booking from its stored inputs and a server route. |
| `create-checkout-session` | Requires a signed-in caller who owns the booking, with the booking still unpaid. **The amount is computed on the server**; the body's `amount` is ignored. Subscriptions: the driver is the caller, and the price (incl. Pro → Unlimited proration) comes from the server. |
| `create-vipps-session` | Same caller and amount rules. Subscriptions are refused (the old code failed on them anyway). |
| `stripe-webhook` | Marks paid only if `amount_total` and currency equal what the server asked for (`metadata.amount_ore`); otherwise `bookings.payment_review_reason` is set and nothing is paid or dispatched. Subscription activation uses the auth user id (it wrote `driver_profiles.id` before, which the portal never read). |
| `vipps-webhook` | Paid amount must equal the server price stored on the booking. |
| `process-payment` | Requires the booking's driver (recalculate) or customer/driver (release), or an admin. Release needs a captured payment, happens once (compare-and-set), and no longer credits the wallet itself (the trigger does). Commission now finds the driver's plan by user id (it was always `basic`). |
| `send-booking-email` | Service-role key or `EMAIL_FUNCTION_SECRET` only (was an open mail relay). Fails closed. |
| `calculate-price` | Uses the shared module; output unchanged. |

### Frontend

- `src/lib/supabase.ts`: `callFunction()` sends the user's access token. Every edge-function call from the app goes through it.
- `PaymentPage`:
  - The "mark escrow paid from the browser" fallback is removed. A failed provider call now shows an error.
  - "Corporate invoice" says it is not available yet instead of treating the booking as paid.
  - The total shown is the booking total (MVA included) instead of total × 1.25.
- `DriverPortal`: sends only the plan id. `AdminDashboard`: release/refund call the new RPCs. `CustomerDashboard`, `MyBookings`: authenticated `process-payment` calls.
- Two existing `tsc` errors fixed (`FleetMap` type predicate; `no.ts` typed as a partial locale, which is how i18next already used it).

### Tests and CI

- `npm test`: 13 Vitest tests for the shared pricing. They include a check that the browser preview formula and the server formula give the same totals.
- `npm run test:db`: `supabase/tests/run.sh` applies stub + 00001 (+ the production fixture) + 00002 **twice** to a scratch PostgreSQL and runs **144 checks**. `supabase/tests/production-fixture.sql` is production's escrow/subscription functions copied from the live project, so the migration is tested against production behaviour, not only the repository's.
- `.github/workflows/ci.yml`: typecheck, lint, unit tests, build, `deno check` of the functions, database tests.
- Locally: typecheck ✔, lint 0 errors (25 warnings, unchanged), build ✔, Vitest 13/13, DB 144/144. `deno check` could not run here (deno.land is blocked by this session's network policy); a strict `tsc` with stand-in declarations passes. CI runs the real one.

---

## 3. Behaviour changes to approve

1. **Customers pay the booking total once.** Before, PaymentPage charged `price_estimate × 1.25`, but `price_estimate` already includes 25% MVA (it is `calculate-price`'s `price_total`), so MVA was charged twice. Now customers pay what the booking flow showed, which is 20% less than the payment page charged.
2. **The amount charged is re-priced on the server** from the booking's van, hours, helpers, extras and a server-side route. If it differs from the stored price, the booking and escrow are corrected before checkout.
3. **Drivers see and can claim only paid jobs.** Before, the pool showed every `pending` booking.
4. **Corporate invoice is refused** until company accounts and invoice terms exist (P2 in the plan).
5. **Admin "Release" requires a captured payment**, and can be done only once. The amount is unchanged (booking price, no commission).
6. **Commission uses the driver's real plan.** Before, it always defaulted to `basic`.
7. **Webhook amount mismatches are held, not paid.** Stripe sessions created before deploy carry no `metadata.amount_ore` and will be held for review. Deploy when no checkout is in flight, or review `payment_review_reason` afterwards.

---

## 4. Production differs from the repository

- **Schema:**
  - 52 tables vs 20 in `00001`. Production-only tables include `corporate_accounts`, `corporate_orders`, `payments`, `subscriptions`, `audit_logs`, `chat_*`, `vehicles`, `reviews`, `service_cities/zones`, `fraud_flags`, `referrals`.
  - No migrations are recorded (`supabase_migrations` is empty).
- **Data:** 5 auth users, 13 profiles (8 without a user), 17 bookings, 3 escrow rows, 4 drivers, 2 admins, 5 plans, 0 corporate accounts.
- **Subscriptions** use `driver_subscriptions.plan_id` → `subscription_plans.name` (Free, Basic, Pro Mini, Pro, Unlimited). The app and `stripe-webhook` read and write a `plan` column that production does not have (`00002` adds it). Today's paid activation therefore fails in production, and `change_driver_subscription('pro_mini')` cannot find "Pro Mini". **Needs a decision: one model, `plan_id` or `plan`.**
- **Escrow lifecycle** runs largely in production-only triggers on `bookings` and `escrow_payments`: price/commission recalculation, release on both confirmations, overtime detection, adjustment capture, wallet settlement.
- **Edge functions deployed:** `route-distance`, `create-checkout-session`, `process-payment`, `release-escrow` (a commission calculator only, not in the repo), `calculate-price`, `stripe-webhook`. **Not deployed:** `create-vipps-session`, `vipps-webhook`, `send-booking-email`, so Vipps is not live there.
- `pg_cron` is not installed, so `docs/subscription-expiry-cron.sql` is not running.

---

## 5. Deploy order (when approved)

1. Back up the production database.
2. Run the emergency SQL in §1 now if you want items 1–2 closed before review finishes.
3. Apply `00002` to a **Supabase branch or a restored copy** of production first, and run the smoke test from `docs/DEPLOYMENT.md` §7 there. Read the NOTICE list of dropped policies.
4. Set `EMAIL_FUNCTION_SECRET` (and the matching `app.email_function_secret`) before deploying `send-booking-email`.
5. Deploy, together and in this order: the migration, then the edge functions (`create-checkout-session`, `create-vipps-session`, `stripe-webhook`, `vipps-webhook`, `process-payment`, `calculate-price`, `send-booking-email`), then the frontend.
   - The new frontend sends tokens the old functions ignore, so it is safe early.
   - The new functions refuse the old frontend's unauthenticated calls, so don't ship the functions before the frontend.
6. Re-run the Supabase security advisor; it should report no `rls_disabled`.

---

## 6. Not fixed here (follow-ups)

- Drivers in the job pool can read the customer's name, phone and email for every paid unassigned job (unchanged behaviour). A pool view with limited columns is the fix.
- The live tracking map passes `driver_profiles.id` where locations are keyed by the auth user id, so customers never see the driver's dot. The RLS policy is correct; the component needs the user id.
- AdminDashboard opens driver documents with `getPublicUrl` on a private bucket; it needs signed URLs.
- Refunds are recorded only; nothing is refunded in Stripe or Vipps.
- PaymentPage still shows its own card-number fields before redirecting to Stripe Checkout. Nothing is sent, but they should go (PCI scope).
- CORS is `*` on all functions; restrict it to `FRONTEND_URL`.
- The Norwegian translations for the corporate pages are missing (English is shown).
