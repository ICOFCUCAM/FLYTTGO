#!/usr/bin/env bash
# Accounting controls on the copy of production (docs/ACCOUNTING_CORE.md →
# Before offering it): the replica, every migration, representative data;
# then concurrency, duplicate deliveries, isolation, invitations, and a
# rollback with books in place. Called by ../run.sh with its PG* settings.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB="${FLYTTGO_TEST_DB:-flyttgo_test}_ctl"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
q() { "${PSQL[@]}" -d "$DB" -At -c "$1"; }
show() { PGOPTIONS='-c client_min_messages=notice' "${PSQL[@]}" -d "$DB" -f "$1" 2>&1 | grep -E '^(psql:.*)?(NOTICE:  ok|ERROR|FAIL)|passed|data: ' | sed 's/^psql:[^ ]* //'; }
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "NOTICE:  ok - $*"; }

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\""
"${PSQL[@]}" -d "$DB" -f supabase/tests/supabase-stub.sql 2>&1 | grep -v -e wal_level -e HINT || true
"${PSQL[@]}" -d "$DB" -f supabase/schema/production-2026-10-29.sql
for f in supabase/migrations/0000[2-9]_*.sql supabase/migrations/0001[0-9]_*.sql; do "${PSQL[@]}" -d "$DB" -f "$f"; done
"${PSQL[@]}" -d "$DB" -f supabase/tests/helpers.sql
# The fixture functions the other suites define (their own data rolls back).
for f in p0_security organizations launch_decisions company_bookings invoicing white_label service_platform; do
  "${PSQL[@]}" -d "$DB" -f "supabase/tests/$f.test.sql" >/dev/null 2>&1 || fail "fixture suite $f failed"
done
show supabase/tests/accounting_controls/data.sql

LA=$(q "SELECT id FROM tests.ctl WHERE key = 'ledger_a'")
LB=$(q "SELECT id FROM tests.ctl WHERE key = 'ledger_b'")
ORG_A=$(q "SELECT id FROM tests.ctl WHERE key = 'org_a'")
CUST1=c0000000-0000-0000-0000-000000000001; CUST2=c0000000-0000-0000-0000-000000000002; DRV2=d0000000-0000-0000-0000-000000000002

# ── Concurrency: eight sessions post at once, two issue invoices ──────────
as() { echo "BEGIN; SET LOCAL ROLE authenticated; SELECT tests.login('$1');"; }
poster() {  # user, tag, count
  for i in $(seq 1 "$3"); do
    echo "$(as "$1") SELECT accounting.post_voucher('$LA', current_date, 'Samtidig $2-$i', '[{\"account\":\"6800\",\"amount\":125,\"mva_code\":\"1\"},{\"account\":\"1920\",\"amount\":-125}]'); COMMIT;"
  done
}
invoicer() {  # tag, count
  for i in $(seq 1 "$2"); do
    echo "$(as $CUST1) SELECT public.issue_invoice((public.create_sales_invoice('$ORG_A', '{\"name\":\"Samtidig $1\"}', NULL, '[{\"description\":\"Arbeid\",\"quantity\":1,\"unit_price\":1000,\"vat_rate\":25}]', NULL, NULL)).id); COMMIT;"
  done
}
BEFORE=$(q "SELECT count(*) FROM accounting.vouchers WHERE ledger_id = '$LA'")
PIDS=()
for s in 1 2 3 4; do poster $CUST1 "o$s" 15 | "${PSQL[@]}" -d "$DB" >/dev/null & PIDS+=($!); done
for s in 1 2 3 4; do poster $DRV2 "r$s" 15 | "${PSQL[@]}" -d "$DB" >/dev/null & PIDS+=($!); done
for s in 1 2; do invoicer "i$s" 10 | "${PSQL[@]}" -d "$DB" >/dev/null & PIDS+=($!); done
for p in "${PIDS[@]}"; do wait "$p" || fail "a concurrent session failed"; done
AFTER=$(q "SELECT count(*) FROM accounting.vouchers WHERE ledger_id = '$LA'")
[ $((AFTER - BEFORE)) -eq 140 ] || fail "expected 140 new vouchers, got $((AFTER - BEFORE))"
ok "10 sessions at once: 120 manual vouchers and 20 invoices, all 140 posted"
GAPS=$(q "SELECT count(*) FROM (SELECT year FROM accounting.vouchers WHERE ledger_id = '$LA' GROUP BY year HAVING max(number) <> count(*) OR count(DISTINCT number) <> count(*)) s")
[ "$GAPS" = 0 ] || fail "voucher numbers have gaps or duplicates after concurrent posting"
ok "voucher numbers stay unique and without gaps under concurrency"

# ── Closing a period while someone posts ─────────────────────────────────
D2=$(q "SELECT current_date - 2"); D1=$(q "SELECT current_date - 1")
# 1. A voucher being posted holds back the close until it is committed.
( echo "$(as $CUST1) SELECT accounting.post_voucher('$LA', '$D2', 'Før lukking', '[{\"account\":\"6800\",\"amount\":10},{\"account\":\"1920\",\"amount\":-10}]'); SELECT pg_sleep(2); COMMIT;" \
  | "${PSQL[@]}" -d "$DB" >/dev/null ) & P=$!
sleep 0.7
T0=$(date +%s.%N)
echo "$(as $CUST1) SELECT accounting.lock_period('$LA', '$D1'); COMMIT;" | "${PSQL[@]}" -d "$DB" >/dev/null
T1=$(date +%s.%N); wait $P
awk "BEGIN { exit !($T1 - $T0 > 0.8) }" || fail "closing did not wait for the voucher being posted"
[ "$(q "SELECT count(*) FROM accounting.vouchers WHERE ledger_id = '$LA' AND description = 'Før lukking'")" = 1 ] || fail "the voucher posted before the close is missing"
ok "a close waits for a voucher being posted, then closes the period"
# 2. A close in progress makes a posting into that period wait, then fail.
( echo "$(as $CUST2) SELECT accounting.lock_period('$LB', '$D1'); SELECT pg_sleep(2); COMMIT;" | "${PSQL[@]}" -d "$DB" >/dev/null ) & P=$!
sleep 0.7
if echo "$(as $CUST2) SELECT accounting.post_voucher('$LB', '$D1', 'For sent', '[{\"account\":\"6800\",\"amount\":10},{\"account\":\"1920\",\"amount\":-10}]'); COMMIT;" \
   | "${PSQL[@]}" -d "$DB" >/dev/null 2>"$DB.err"; then fail "a voucher got into a period being closed"; fi
wait $P
grep -q "is closed" "$DB.err" || fail "the late voucher failed for another reason: $(cat "$DB.err")"
rm -f "$DB.err"
ok "a voucher dated in a period being closed waits, then is refused"

# ── The same payment delivered twice at once (Stripe webhook retries) ────
INV=$(q "SELECT id FROM public.invoices WHERE issuer_org = '$ORG_A' AND status = 'issued' AND kind = 'invoice' ORDER BY number LIMIT 1")
TOTAL=$(q "SELECT total FROM public.invoices WHERE id = '$INV'")
pay() { echo "BEGIN; SET LOCAL ROLE service_role; SELECT tests.login(NULL, 'service_role'); SELECT public.record_invoice_payment('$INV', $TOTAL, current_date, 'card', 'pi_dup'); SELECT pg_sleep(1); COMMIT;"; }
( pay | "${PSQL[@]}" -d "$DB" >/dev/null 2>&1 || true ) & P1=$!
( pay | "${PSQL[@]}" -d "$DB" >/dev/null 2>&1 || true ) & P2=$!
wait $P1; wait $P2
[ "$(q "SELECT count(*) FROM public.invoice_payments WHERE invoice_id = '$INV'")" = 1 ] || fail "the payment was recorded twice"
[ "$(q "SELECT count(*) FROM accounting.vouchers v JOIN public.invoice_payments p ON p.id = v.source_id WHERE p.invoice_id = '$INV' AND v.source_type = 'payment'")" = 1 ] \
  || fail "the payment was posted twice"
ok "the same card payment delivered twice at once is recorded and posted once"
INV2=$(q "SELECT id FROM public.invoices WHERE issuer_org = '$ORG_A' AND status = 'issued' AND kind = 'invoice' ORDER BY number LIMIT 1")
q "BEGIN; SET LOCAL ROLE service_role; SELECT tests.login(NULL, 'service_role'); SELECT public.record_invoice_payment('$INV2', 100, current_date, 'card', 'pi_part'); COMMIT;" >/dev/null
if q "BEGIN; SET LOCAL ROLE service_role; SELECT tests.login(NULL, 'service_role'); SELECT public.record_invoice_payment('$INV2', 100, current_date, 'card', 'pi_part'); COMMIT;" >/dev/null 2>"$DB.err"; then
  fail "a second delivery of a part payment was recorded"; fi
grep -q "invoice_payments_provider_ref_key" "$DB.err" || fail "a repeated part payment failed for another reason: $(cat "$DB.err")"
rm -f "$DB.err"
ok "a repeated delivery of a part payment is refused by its provider reference (23505)"
PID=$(q "SELECT id FROM public.invoice_payments WHERE invoice_id = '$INV2'")
[ "$(q "SELECT public.accounting_post_payment('$PID') = public.accounting_post_payment('$PID')")" = t ] || fail "posting a payment again made a new voucher"
ok "posting the same payment again returns the voucher it already has"

# ── Isolation and invitations (as SQL) ───────────────────────────────────
show supabase/tests/accounting_controls/isolation.test.sql
show supabase/tests/accounting_controls/invitations.test.sql
show <(echo "\\set ON_ERROR_STOP 1"; echo "SELECT tests.ok(bool_and(ok) FILTER (WHERE check_name <> 'Manual vouchers have a receipt'), 'review checks on A after it all: balanced, no gaps, MVA accounts agree, every account mapped') FROM accounting.review_checks('$LA', make_date(extract(year FROM current_date)::int - 1, 1, 1), current_date);")

# ── Rollback with books in place ─────────────────────────────────────────
HASH="SELECT md5(string_agg(x, ',' ORDER BY x)) FROM (
  SELECT 'v' || id || ledger_id || year || '-' || number || voucher_date || description AS x FROM SCHEMA.vouchers
  UNION ALL SELECT 'l' || voucher_id || line_no || account_code || debit || credit || coalesce(mva_code, '-') FROM SCHEMA.voucher_lines
  UNION ALL SELECT 'e' || id || ledger_id || action FROM SCHEMA.events
  UNION ALL SELECT 'c' || ledger_id || year || next_number FROM SCHEMA.counters
  UNION ALL SELECT 'a' || id || sha256 FROM SCHEMA.attachments) s"
H1=$(q "${HASH//SCHEMA/accounting}"); N1=$(q "SELECT count(*) FROM accounting.vouchers")
"${PSQL[@]}" -d "$DB" -f supabase/rollback/00015_down.sql
"${PSQL[@]}" -d "$DB" -f supabase/rollback/00014_down.sql 2>/dev/null
KEPT=$(q "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'accounting_retained_%'")
[ -n "$KEPT" ] && [ "$(q "SELECT to_regnamespace('accounting') IS NULL")" = t ] || fail "the rollback did not set the books aside"
[ "$(q "${HASH//SCHEMA/$KEPT}")" = "$H1" ] || fail "the books set aside differ from the books before the rollback"
ok "rolling back keeps every voucher, line, number, receipt and log entry ($N1 vouchers), set aside as $KEPT"
[ "$(q "SELECT has_schema_privilege('authenticated', '$KEPT', 'USAGE') OR has_schema_privilege('anon', '$KEPT', 'USAGE')")" = f ] || fail "the set-aside books are reachable by clients"
ok "the books set aside are closed to every client role"
[ "$(q "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname IN ('invoices', 'invoice_payments', 'invoice_reminders') AND t.tgname LIKE 'accounting_%'")" = 0 ] \
  || fail "posting triggers are left on the invoice tables"
ok "invoicing keeps working without accounting (no posting triggers left)"
"${PSQL[@]}" -d "$DB" -f supabase/migrations/00014_accounting_core.sql
"${PSQL[@]}" -d "$DB" -f supabase/migrations/00015_accounting_flyttgo.sql
[ "$(q "SELECT count(*) FROM accounting.ledgers")" = 0 ] && [ "$(q "${HASH//SCHEMA/$KEPT}")" = "$H1" ] || fail "re-applying touched the books set aside"
ok "applying the migrations again starts a fresh schema and leaves the books set aside untouched"

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)"
echo "accounting controls: all passed"
