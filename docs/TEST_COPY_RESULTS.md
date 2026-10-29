# The disposable Supabase test copy: results

Plan: `docs/TEST_COPY_PLAN.md`. Production migrations stay unapproved (decision #37).

## Environment

| | |
|---|---|
| Option | B (owner's choice, 2026-10-29): a free test project instead of upgrading to Pro |
| Architect-AI | Already paused (status INACTIVE) when the project was created; not touched, nothing to restore for this test |
| Test project | `flyttgo-accounting-test`, ref `hgfdkppjtydvkahdwxxw`, eu-central-1, organisation "ICOFCUCAM's Org", Postgres 17.11 |
| Created | 2026-10-29, by Claude through the Supabase connector, at the owner's request |
| State at creation | Empty: no table in `public`, no user in `auth.users` |
| Credentials | Its own only. No production key, password, Stripe or Vipps live key, Resend key, webhook secret or Vault secret has been set on it |
| Cost | USD 0 (free plan) |

## Runs

The session could not reach the project's database directly (its network allows only HTTPS, and `*.supabase.co` is denied), so the runner's steps were sent through the Supabase connector instead, in chunks, as `postgres`. The same chunks were first run end to end on a local PostgreSQL 17 with the Supabase stand-ins: everything passed there (fingerprint, 00002–00015, data, ten concurrent sessions through dblink, closing against posting, duplicate payments, isolation, invitations, review checks, rollback with books kept, re-apply).

| Step | On the test project | Result |
|---|---|---|
| Empty project check | `public` had no table, `auth.users` no user | Pass |
| Connector behaviour | A `BEGIN … ROLLBACK` inside a call leaves nothing behind; dblink available; `postgres` can create a test login role and has admin on `authenticated`; statement timeout 2 min | Checked |
| Production replica (`supabase/schema/production-2026-10-29.sql`) | Loaded in three parts | Pass |
| Schema fingerprint | All 13 hashes equal `production-2026-10-29.fingerprint` (bucket, column 459, constraint 104, function 34, grant 101, index 60, policy 22, realtime 1, replica identity 52, RLS 52, table grants 1197, trigger 21, view 5) | **Pass: the copy is production's schema on real Supabase** |
| Migration 00002 | Applied | Pass |
| Migration 00003 onwards | First part of 00003 (it drops and recreates every RLS policy) made the connector ask the owner for confirmation; twice no answer came within 60 s, so it was not applied (checked afterwards: `is_privileged()` absent) | **Not run** |
| Data, controls, rollback | Not reached | **Not run** |

**Open:** migrations 00003–00015 and the accounting controls have run on PostgreSQL 16 and 17 locally (1,223 checks) but not yet on a real Supabase project. That remains a condition before any production decision. The quickest way to close it is the one command in `docs/TEST_COPY_PLAN.md` step 2, run from a computer with `psql` against a fresh test project.

## Cleanup

- 2026-10-29: the owner chose to stop at this point. The test project `hgfdkppjtydvkahdwxxw` was **paused** by Claude through the connector (the connector cannot delete projects). It holds only the schema and no data, no users and no secrets. **To finish the cleanup, delete it in the dashboard:** Supabase → `flyttgo-accounting-test` → Project settings → General → Delete project; then note the date here.
- No Stripe endpoint, Resend key, Vault secret or webhook was ever set up for it, so nothing else needs revoking.
- Production (`qzclatvpzicwhewzdiwf`) and Architect-AI were not touched.
