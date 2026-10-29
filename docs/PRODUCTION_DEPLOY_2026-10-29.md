# Production database change, 2026-10-29

Owner's decision (2026-10-29): apply migrations 00002–00015 to production now, skipping the earlier conditions (accountant sign-off, a complete real-Supabase test, green GitHub checks). Project: FlyttGo Norway (`qzclatvpzicwhewzdiwf`).

## What was done

1. **Checked before:** production's schema fingerprint equalled `supabase/schema/production-2026-10-29.fingerprint` (all 13 hashes), so the migrations met the schema they were tested on.
2. **Safety copy:** every public table copied into schema `backup_20261029` (52 tables, 103 rows), closed to anon, authenticated and service_role.
3. **Applied:** 00002 through the Supabase connector; 00003, 00004 and 00005 by the owner in the SQL editor, one file at a time; 00006–00015 by the owner as one transaction (`supabase/ops/production-apply-00006-00015.sql`). The connector could not apply 00003 onwards: it asks for confirmation of statements it considers destructive, and the question did not reach the owner.
4. **Recorded:** 00003–00015 added to `supabase_migrations.schema_migrations` (00002 was recorded by the connector).
5. **Checked after:** production's fingerprint equals the one the test suite expects after all migrations for 12 of 13 kinds. Constraints differ as intended: `driver_documents_driver_id_fkey` and `driver_metrics_driver_id_fkey` are NOT VALID because the existing rows (4 of 4 driver documents, 5 of 5 driver metrics) hold ids that are not user accounts. 00002 leaves such keys unvalidated (enforced for new rows) and the rows are kept (no orphan records deleted, owner's instruction).

6. **Branch merged** (ICOFCUCAM/FLYTTGO#16) into `main`; Vercel builds `main`.
7. **Edge functions deployed** through the Supabase connector, all without JWT verification as `docs/DEPLOYMENT.md` sets: calculate-price (v13), create-checkout-session (v12), process-payment (v11), stripe-webhook (v7), and new: vipps-webhook, create-vipps-session, cancel-booking, refund-payment, send-booking-email, accounting-invite, appointment-reminders, credit-check, pay-sales-invoice, send-organization-invitation, stripe-connect, white-label-domain, verify-organization, book-on-invoice, white-label-site, invoice-document, invoice-send, invoice-run. route-distance was unchanged and left as it was; the old release-escrow function is left in place, unused.
8. **Scheduled jobs installed** (`supabase/ops/schedules.sql`; pg_cron and pg_net switched on): flyttgo-accounting-cancellations (00:20 UTC), auto-downgrade-expired-subscriptions (hourly), flyttgo-invoice-run (05:15 UTC), flyttgo-appointment-reminders (hourly :10). Vault holds `flyttgo_project_url`; `flyttgo_service_role_key` is not stored, so the two function-calling jobs fail at each run without calling anything until it is.

## Not done yet

- Confirm the live site runs `main` after the Vercel build; the new security rules (00003) expect the new code.
- Function secrets are not set (Project settings → Edge Functions → Secrets). Until they are, each function refuses the part that needs them: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET, FRONTEND_URL, RESEND_API_KEY, FLYTTGO_FROM, FLYTTGO_REPLY_TO, EMAIL_FUNCTION_SECRET, VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET, VIPPS_SUBSCRIPTION_KEY, VIPPS_MSN, VIPPS_MODE, VIPPS_WEBHOOK_SECRET, WHITE_LABEL_CNAME_TARGET, CREDIT_CHECK_API_KEY, ROUTE_PROVIDER_*.
- Vault secret for the schedules, in the SQL editor: `select vault.create_secret('<service role key>', 'flyttgo_service_role_key');`
- Website templates are not imported (needs network access to `*.supabase.co` and the two service keys; `docs/WHITE_LABEL.md`).
- Accountant review of the accounting module (`docs/ACCOUNTING_REVIEW.md`) is still open; the accounting add-on should not be sold before it.

## Rollback

`supabase/rollback/00015_down.sql` … `00002_down.sql` in reverse order (tested with data; accounting books are set aside, never deleted). The data as it was before is in `backup_20261029`.
