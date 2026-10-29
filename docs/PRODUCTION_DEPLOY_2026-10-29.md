# Production database change, 2026-10-29

Owner's decision (2026-10-29): apply migrations 00002–00015 to production now, skipping the earlier conditions (accountant sign-off, a complete real-Supabase test, green GitHub checks). Project: FlyttGo Norway (`qzclatvpzicwhewzdiwf`).

## What was done

1. **Checked before:** production's schema fingerprint equalled `supabase/schema/production-2026-10-29.fingerprint` (all 13 hashes), so the migrations met the schema they were tested on.
2. **Safety copy:** every public table copied into schema `backup_20261029` (52 tables, 103 rows), closed to anon, authenticated and service_role.
3. **Applied:** 00002 through the Supabase connector; 00003, 00004 and 00005 by the owner in the SQL editor, one file at a time; 00006–00015 by the owner as one transaction (`supabase/ops/production-apply-00006-00015.sql`). The connector could not apply 00003 onwards: it asks for confirmation of statements it considers destructive, and the question did not reach the owner.
4. **Recorded:** 00003–00015 added to `supabase_migrations.schema_migrations` (00002 was recorded by the connector).
5. **Checked after:** production's fingerprint equals the one the test suite expects after all migrations for 12 of 13 kinds. Constraints differ as intended: `driver_documents_driver_id_fkey` and `driver_metrics_driver_id_fkey` are NOT VALID because the existing rows (4 of 4 driver documents, 5 of 5 driver metrics) hold ids that are not user accounts. 00002 leaves such keys unvalidated (enforced for new rows) and the rows are kept (no orphan records deleted, owner's instruction).

## Not done yet

- The app on Vercel production still runs the code before this branch; the new security rules (00003) expect the new code (for example the driver job pool through `driver_job_pool()`). Merge and deploy the branch soon, or roll back.
- Edge functions of this branch are not deployed; their secrets are not set.
- Scheduled jobs (`supabase/ops/schedules.sql`) are not installed.
- Website templates are not imported (needs network access to `*.supabase.co` and the two service keys; `docs/WHITE_LABEL.md`).
- Accountant review of the accounting module (`docs/ACCOUNTING_REVIEW.md`) is still open; the accounting add-on should not be sold before it.

## Rollback

`supabase/rollback/00015_down.sql` … `00002_down.sql` in reverse order (tested with data; accounting books are set aside, never deleted). The data as it was before is in `backup_20261029`.
