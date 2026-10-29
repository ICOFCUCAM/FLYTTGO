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

| Step | Status | Notes |
|---|---|---|
| 1. Create the project | Done | See above |
| 2. Controls (`accounting_controls/run.sh`) | Not run yet | This cloud session cannot reach the project's database (the session's network allows only HTTPS through its proxy, and denies `*.supabase.co`); the runner needs a direct Postgres connection |
| 3–6. Functions in test mode, UI walk-through, Stripe test webhook, invoice run | Not started | |

## Cleanup

Not yet. When the test is finished: delete `hgfdkppjtydvkahdwxxw` (Project settings → General → Delete project), revoke any test Stripe endpoint and Resend key, and record the date and who deleted it here.
