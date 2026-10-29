# Production schema: what is there, and how this repository reconciles with it

Production is the Supabase project **"FlyttGo Norway" (`qzclatvpzicwhewzdiwf`, eu-central-1)**. It was the only active FlyttGo project on 2026-10-29, and its deployed edge functions are built from this repository's paths. **Confirm it before any live migration:** Vercel's production `VITE_SUPABASE_URL` must be `https://qzclatvpzicwhewzdiwf.supabase.co`. This could not be checked from here, because the network policy blocks flyttgo.no.

Everything below was read with catalog queries only. Nothing in production was changed.

## The replica, and why to trust it

- `supabase/schema/production-2026-10-29.sql` is a schema-only replica of production's `public` schema and storage policies: 52 tables, 34 functions, 21 triggers, 22 policies, function privileges and the realtime publication. It holds no customer data, only the five `subscription_plans` rows.
- `supabase/schema/fingerprint.sql` lists every column, constraint, index, RLS flag, trigger, policy, function signature and security mode, function grant, published table, view (definition and options), table and view privilege, replica identity and storage bucket. `fingerprint-summary.sql` hashes that list per kind (13 kinds; views, privileges, replica identity and buckets were added on 2026-10-29 after the review found the views).
- `supabase/schema/production-2026-10-29.fingerprint` is the summary as computed **on production** (PostgreSQL 17.6; the MAINTAIN privilege, new in 17, is left out so 16 and 17 compare). The replica produces the identical 13 hashes, and `supabase/tests/run.sh` refuses to run the production tests if it stops doing so.
- Function bodies aren't part of the fingerprint, because production's carry Windows line endings and comments. They were copied with `pg_get_functiondef`.

**A replica proves nothing about production on a later day.** Before applying a migration live:

1. Run `supabase/schema/fingerprint-summary.sql` on production (read-only) and compare it with the recorded fingerprint.
2. If any hash differs, production has changed. Re-snapshot it (the queries are in the replica's header and the summary), update the replica, and re-run `npm run test:db`.

## What production looked like (2026-10-29)

| | |
|---|---|
| Data | 5 auth users; 13 profiles (8 without a user); 17 bookings, none with a driver or a Stripe/Vipps reference; 3 escrow rows (all `held`); 4 driver profiles, **three for users that no longer exist and one with no user**; 4 driver documents for missing users, with **no files in storage**; 5 `drivers` rows; 1 wallet; 0 subscriptions, locations and dispatch logs; 2 admins. In effect, test data. |
| RLS | On for 6 of 52 tables. `admin_accounts` RLS and `change_driver_subscription` without anon were **added by the emergency fix** before this snapshot. |
| Migrations | None recorded. The schema was built by hand. |
| Edge functions | `route-distance`, `create-checkout-session`, `process-payment`, `release-escrow` (a commission calculator only), `calculate-price`, `stripe-webhook`. Not deployed: `create-vipps-session`, `vipps-webhook`, `send-booking-email`, `refund-payment`. |
| Extensions | No `pg_cron`, so no scheduled subscription expiry runs. |
| Views | Five dispatch views (`driver_dispatch_tiers`, `driver_dispatch_eligibility`, `driver_dispatch_scores`, `dispatch_wave_priority`, `match_drivers_for_booking_view`), owner rights, all privileges to anon. Unused by the app. |
| Privileges | Every table has Supabase's default grants (all privileges for anon, authenticated, service_role); RLS is the only barrier. |
| Other | Also present and empty: `subscriptions` (→ `driver_profiles`) and `driver_wallet` (→ `drivers`), beside the `driver_subscriptions` and `driver_wallets` the app uses. One `driver_profiles` row has no `user_id`. |

## Defects found in production, and where each is fixed

| Production behaviour | Cause | Fixed in |
|---|---|---|
| Approving a driver fails | Its `driver_profiles` triggers insert the user id into `driver_metrics`, `vehicles` and `driver_verification`, whose foreign keys point at `drivers(id)` | 00002 (keys → `auth.users`) |
| Every subscription change fails | `driver_subscriptions.driver_id` → `drivers(id)`, while its own `change_driver_subscription` writes the user id | 00002 |
| Paid plan activation and the expiry check fail | The app writes a `plan` column that doesn't exist; production uses `plan_id` | App + webhook now use `plan_id` (00002/00003) |
| Marking a lapsed plan `expired` fails | The CHECK constraint lacks `expired` | 00002 |
| `change_driver_subscription('pro_mini')` fails | Production looks plans up by `lower(name)`, and the name is 'Pro Mini' | 00003 resolves slugs (`plan_slug()`) |
| `apply_pending_plan_changes()` fails | It sets a `plan` column that doesn't exist | 00002 |
| Live location can't be written | `driver_locations.driver_id` → `driver_profiles(id)`, while the beacon, dispatch and RLS use the user id | 00002 |
| Driver applications with an ID document fail | The CHECK allows `id_passport`; the app uploads `identity_document` | 00002 |
| Reviewing an application fails | `reviewed_by`, `reviewed_at`, `rejection_reason` are missing | 00002 |
| Dispatch logging fails for some drivers | `dispatch_logs.driver_id` → `drivers(id)`, while dispatch writes `driver_profiles.id` | 00002 |
| New wallets would be keyed by user id | `create_driver_wallet()` used `NEW.user_id`; no trigger calls it today | 00002 |
| Approving an over-time charge fails | `capture_extra_escrow_after_approval` re-fires itself endlessly | 00003 |
| A released escrow can pay the driver repeatedly, or set the balance to NULL | `settle_driver_wallet_after_release` fires on every update | 00003 |
| Production triggers on escrow stop working once RLS is on | They ran as the calling user | 00003 (run as owner) |
| Five views bypass RLS (owner rights) and are readable by anon | 00003 (`security_invoker`, browser roles revoked) |
| `admin_accounts.id` has no default | Admin rows must be inserted with an explicit id | Documented. Insert with `gen_random_uuid()`. |

## Identity rule (decision to confirm)

00002 applies one rule:

- **The auth user id** for what a person owns before or apart from being an approved driver: applications, documents (and their storage folder), subscriptions, live location, metrics, verification, vehicles. Production's own functions already write the user id into these.
- **`driver_profiles.id`** for the work of an approved driver: bookings, wallets, wallet transactions, payout requests, dispatch logs.

The `drivers` table is kept but the app doesn't use it. Its 5 rows, and the foreign keys still pointing at it (`chat_rooms`, `commission_ledger`, `driver_payouts`, `driver_wallet`, `reviews`, `subscription_payments`), are untouched. Whether `drivers` should be retired or become canonical is open.

Rows that predate a re-pointed key and don't satisfy it (the 4 orphan driver documents) are kept, and the key is left `NOT VALID`: enforced for new rows, reported as a NOTICE.

## Open data decisions

- 4 driver profiles, 4 driver documents and 8 profiles belong to users that no longer exist. Clean them up, or keep them as test data?
- Bookings with `payment_status = 'released'` but escrow `held` and no provider reference. These are test data, but they can't be refunded through a provider.
