# Scheduled jobs

Owner's decision (2026-10-29): use the recommendation, which is `pg_cron` and `pg_net` inside the production Supabase project, with the service role key held in Supabase Vault ([`DECISIONS.md`](DECISIONS.md) #32). Script: [`supabase/ops/schedules.sql`](../supabase/ops/schedules.sql); undo: [`schedules_down.sql`](../supabase/ops/schedules_down.sql). Tested on PostgreSQL 16 and 17.6 with stand-ins for pg_cron, pg_net and Vault (`supabase/tests/schedules.test.sql`, run by `run.sh`). **Not applied anywhere yet.**

| Job | When (UTC) | Oslo | What |
|---|---|---|---|
| `auto-downgrade-expired-subscriptions` | every hour, :00 | | `expire_lapsed_subscriptions()` (00006): lapsed driver plans go to Free. Replaces the job of the same name from `docs/subscription-expiry-cron.sql`. |
| `flyttgo-invoice-run` | daily 05:15 | 06:15 winter, 07:15 summer | `invoice-run`: invoices what is due, plan fees, reminders ([`INVOICING.md`](INVOICING.md)) |
| `flyttgo-appointment-reminders` | every hour, :10 | | `appointment-reminders`: emails the day before, once each ([`SERVICE_PLATFORM.md`](SERVICE_PLATFORM.md)) |

pg_cron on Supabase runs in UTC, so the invoice run moves an hour with summer time. That is harmless: it runs once a day either way and each step is done once.

## Why this way

- It runs inside the database FlyttGo already has; no outside scheduler, no extra service or account.
- The key is never in a file, the repository or a job's text: the job reads it from Vault at each run.
- The caller (`flyttgo_ops.call_function`) is in a schema the API does not expose; no client role (anon, authenticated, service_role) can use it, and it takes only a function name, never a path.
- A missing secret makes the job fail visibly and send nothing.
- Each job is replaced on a re-run, never doubled.

## Order (after approval, on the production project)

1. Migrations applied and the functions deployed with their secrets (`RESEND_API_KEY`, `FLYTTGO_FROM`, `FLYTTGO_REPLY_TO`, `FRONTEND_URL`), [`SECURITY_P0.md`](SECURITY_P0.md) §5.
2. Database → Extensions: switch on `pg_cron` and `pg_net`.
3. Store the two secrets once in the SQL editor (values from Project settings → API; never commit them):
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'flyttgo_project_url');
   select vault.create_secret('<service role key>', 'flyttgo_service_role_key');
   ```
4. Try each function once by hand with `{"dryRun": true}` and read what it would do.
5. Run `supabase/ops/schedules.sql`.
6. The next day, check the runs:
   ```sql
   select j.jobname, d.status, d.start_time, d.return_message
     from cron.job_run_details d join cron.job j using (jobid)
    order by d.start_time desc limit 20;
   select id, status_code, left(content::text, 200), created from net._http_response order by created desc limit 10;
   ```

If the service role key is rotated, update the Vault secret (`vault.update_secret`); the jobs pick it up at the next run.
