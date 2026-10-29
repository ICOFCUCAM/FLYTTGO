# The disposable Supabase test copy: plan, cost and cleanup

Owner's decision (2026-10-29): the disposable test stage is approved **conditionally**: a separate, access-controlled test environment, a documented cost and cleanup plan, and no real payments, emails or other production side effects. Production migrations stay unapproved (decision #37). This plan is what to approve before anything is created.

## Where it can run (account facts, read 2026-10-29)

The Supabase organisation "ICOFCUCAM's Org" is on the **free plan**. Two projects are active: FlyttGo Norway (production) and Architect-AI. The free plan allows two active projects and has no branching, so one of these is needed:

| Option | What happens | Cost | Notes |
|---|---|---|---|
| **A. Upgrade the organisation to Pro** and create a branch or a separate test project | A test branch (or project) next to production | Pro plan about USD 25 a month, which includes compute credit for one small instance; a branch or extra Micro project is charged by the hour (about USD 0.01 an hour); a test of a few hours costs well under USD 1 on top. Check the current figures at supabase.com/pricing before upgrading. | Also brings daily backups and point-in-time recovery options for production, which the go-live needs anyway. |
| **B. Pause Architect-AI for the test** and create a free test project | A fresh free project | USD 0 | Architect-AI is offline during the test (a few hours); it is restored from the dashboard afterwards (free projects can be restored for 90 days). Needs your explicit approval, as it touches Architect-AI. |
| C. A separate free organisation | A free project in a new organisation | USD 0 if allowed | Supabase may count free projects per owner across organisations; try only if A and B are not wanted. |

**Recommendation: A**, since production will need Pro for backups and recovery before it carries companies' books. **B** if the cost should wait.

## What goes in, and what never does

- **Schema:** the production replica (`supabase/schema/production-2026-10-29.sql`), checked against production's fingerprint before anything is applied (the runner stops otherwise); then migrations 00002–00015.
- **Data:** synthetic, representative data only (`supabase/tests/accounting_controls/data.sql`): two companies, FlyttGo's own books, an accountant. **No production data**, so no customer's personal data is copied into a test environment. (A restored backup would bring real personal data; it is not needed to test the migrations and is not available on the free plan.)
- **Credentials:** the test project's own keys only. **Never** production's service role key, database password, Stripe or Vipps live keys, Resend key, webhook secrets or Vault secrets.
- **Payments:** Stripe in test mode (`sk_test_…`, a test-mode webhook endpoint pointing at the test project, its own `whsec_…`); Vipps test environment keys or none.
- **Email:** a separate Resend API key restricted to a test sending domain with addresses we control, or none (the functions then refuse to send and the test checks that).
- **Webhooks and schedules:** no production URL is registered anywhere for the test project; `supabase/ops/schedules.sql` is run on the test project only if its Vault holds the test project's own URL and key.
- **Access:** the test project's dashboard is in the same organisation (owner only); its database password is generated, kept out of the repository, and used only for the runner.

## Steps

1. Create the test project or branch (option A or B), region eu-central-1 like production. Record its project ref.
2. Run the controls on it (the runner refuses production and Architect-AI and a non-empty database):
   ```bash
   TEST_COPY_DB_URL='postgresql://postgres:<password>@db.<test-ref>.supabase.co:5432/postgres' bash supabase/tests/accounting_controls/run.sh
   ```
   This verifies the fingerprint, applies 00002–00015, loads the data, and runs concurrency, closing against posting, duplicate payments, isolation, invitations and the rollback with books (with Supabase's real `auth`, roles and storage policies instead of the local stand-ins).
3. Expose the `accounting` schema (Project settings → API) and deploy the functions with test secrets: `accounting-invite`, `invoice-run`, `stripe-webhook`, `pay-sales-invoice`, `invoice-send`, `invoice-document`, `appointment-reminders`.
4. Point a Vercel preview at the test project (its URL and anon key) and go through, as real users signed in through Supabase Auth: two companies, their owners, an invited accountant and auditor (invitation email received, link used once, expired and withdrawn links refused), FlyttGo's administrator (approve, no company's books), receipts uploaded and opened (storage policies), documents and SAF-T downloaded.
5. Stripe test mode: pay a company's invoice by card; resend the same webhook event from Stripe's dashboard; confirm one payment and one voucher.
6. `invoice-run` with `{"dryRun": true}`, then for real on the test project: the add-on billed once per month.
7. Record the results in `docs/TEST_COPY_RESULTS.md` (what ran, on which commit, pass or fail, anything changed).

## Cleanup

- Option A: delete the branch or test project (Project settings → General → Delete project); downgrade the plan only if production will not use Pro.
- Option B: delete the test project, then restore Architect-AI from the dashboard and confirm it is healthy.
- Revoke the test Stripe webhook endpoint and the test Resend key; delete the local copy of the test database password.
- Note the deletion (date, by whom) in `TEST_COPY_RESULTS.md`.
