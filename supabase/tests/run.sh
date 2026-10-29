#!/usr/bin/env bash
# Database tests for the migrations, on a plain PostgreSQL (no Supabase
# project needed). Builds a scratch database per variant:
#
#   repo        stub + 00001 + migrations
#   production  stub + supabase/schema/production-2026-10-29.sql (the
#               verified replica of the production schema) + migrations
#   rollback    stub + replica; migrations up, then supabase/rollback
#               down; the schema must match production again
#   rollback with data
#               as rollback, after writing data only the migrated schema
#               allows; the rollback must succeed and keep the core rows
#
# Every migration is applied twice (re-running must be harmless). Uses
# the usual PG* variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); needs a
# role that can create databases and roles. Never point it at a real
# Supabase project.
set -euo pipefail

cd "$(dirname "$0")/../.."
DB="${FLYTTGO_TEST_DB:-flyttgo_test}"
REPLICA=supabase/schema/production-2026-10-29.sql
EXPECTED_FP=supabase/schema/production-2026-10-29.fingerprint
MIGRATIONS=(supabase/migrations/0000[2-9]_*.sql supabase/migrations/0001[0-9]_*.sql)
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

fresh() {
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\""
  "${PSQL[@]}" -d "$DB" -f supabase/tests/supabase-stub.sql 2>&1 | grep -v -e wal_level -e HINT || true
}

migrate() {
  for pass in 1 2; do
    for f in "${MIGRATIONS[@]}"; do "${PSQL[@]}" -d "$DB" -f "$f"; done
  done
}

fingerprint() {
  "${PSQL[@]}" -d "$DB" -At -F' ' -f supabase/schema/fingerprint-summary.sql
}

run_tests() {
  "${PSQL[@]}" -d "$DB" -f supabase/tests/helpers.sql
  for f in "$@"; do
    PGOPTIONS='-c client_min_messages=notice' "${PSQL[@]}" -d "$DB" -f "$f" 2>&1 \
      | grep -E '^(psql:.*)?(NOTICE:  ok|ERROR|FAIL)|passed' | sed 's/^psql:[^ ]* //'
    # grep exits 0 only when it printed something; a FAIL raises ON_ERROR_STOP above.
  done
}

echo "── repo ──"
fresh
"${PSQL[@]}" -d "$DB" -f supabase/migrations/00001_complete_schema.sql
migrate
run_tests supabase/tests/p0_security.test.sql supabase/tests/organizations.test.sql supabase/tests/launch_decisions.test.sql supabase/tests/company_bookings.test.sql supabase/tests/invoicing.test.sql supabase/tests/white_label.test.sql supabase/tests/service_platform.test.sql supabase/tests/company_invoicing.test.sql supabase/tests/jobs.test.sql supabase/tests/appointments.test.sql supabase/tests/accounting.test.sql supabase/tests/template_quality.test.sql

# The scheduled jobs (supabase/ops/schedules.sql), with stand-ins for
# pg_cron, pg_net and Vault.
PGOPTIONS='-c client_min_messages=notice' "${PSQL[@]}" -d "$DB" -f supabase/tests/schedules.test.sql 2>&1 \
  | grep -E '^(psql:.*)?(NOTICE:  ok|ERROR|FAIL)|passed' | sed 's/^psql:[^ ]* //'

echo "── production ──"
fresh
"${PSQL[@]}" -d "$DB" -f "$REPLICA"
if ! diff <(fingerprint) "$EXPECTED_FP"; then
  echo "FAIL: the replica no longer matches the recorded production fingerprint" >&2; exit 1
fi
echo "replica matches the production fingerprint"
migrate
run_tests supabase/tests/p0_security.test.sql supabase/tests/p0_production.test.sql \
  supabase/tests/organizations.test.sql supabase/tests/launch_decisions.test.sql supabase/tests/company_bookings.test.sql supabase/tests/invoicing.test.sql supabase/tests/white_label.test.sql supabase/tests/service_platform.test.sql supabase/tests/company_invoicing.test.sql supabase/tests/jobs.test.sql supabase/tests/appointments.test.sql supabase/tests/accounting.test.sql supabase/tests/template_quality.test.sql

echo "── rollback ──"
# Function bodies and settings (the fingerprint covers structure, not
# bodies). Each migration is applied in turn and the state before it
# recorded; rolling back newest first must return to each recorded state,
# and in the end to production's.
BODIES="SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || p.prosecdef || ' '
        || coalesce(array_to_string(p.proconfig, ','), '-') || ' ' || md5(p.prosrc)
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1"
state() {
  "${PSQL[@]}" -d "$DB" -At -F' ' -f supabase/schema/fingerprint.sql
  "${PSQL[@]}" -d "$DB" -At -c "$BODIES"
}
STATES=$(mktemp -d)
fresh
"${PSQL[@]}" -d "$DB" -f "$REPLICA"
for f in "${MIGRATIONS[@]}"; do
  n=$(basename "$f" | cut -c1-5)
  state > "$STATES/before-$n"
  "${PSQL[@]}" -d "$DB" -f "$f"; "${PSQL[@]}" -d "$DB" -f "$f"
done
for f in $(ls supabase/rollback/*_down.sql | sort -r); do
  n=$(basename "$f" | cut -c1-5)
  "${PSQL[@]}" -d "$DB" -f "$f"
  if ! diff "$STATES/before-$n" <(state) > "$STATES/diff-$n"; then
    echo "FAIL: rolling back $n does not restore the state before it:" >&2; head -20 "$STATES/diff-$n" >&2; exit 1
  fi
  echo "rollback of $n restores the state before it"
done
if ! diff <(fingerprint) "$EXPECTED_FP"; then
  echo "FAIL: after rolling back, the schema differs from production" >&2; exit 1
fi
if [ "$("${PSQL[@]}" -d "$DB" -At -c "SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'accounting%'")" != 0 ]; then
  echo "FAIL: rolling back leaves an accounting schema" >&2; exit 1
fi
rm -rf "$STATES"
echo "rollback restores the production schema and function bodies exactly"

echo "── rollback with data ──"
fresh
"${PSQL[@]}" -d "$DB" -f "$REPLICA"
migrate
"${PSQL[@]}" -d "$DB" -f supabase/tests/helpers.sql
"${PSQL[@]}" -d "$DB" -f supabase/tests/rollback_data.sql >/dev/null
for f in $(ls supabase/rollback/*_down.sql | sort -r); do
  PGOPTIONS='-c client_min_messages=notice' "${PSQL[@]}" -d "$DB" -f "$f" 2>&1 | grep -E 'NOTICE' | sed 's/^psql:[^ ]* //' || true
done
PGOPTIONS='-c client_min_messages=notice' "${PSQL[@]}" -d "$DB" -f supabase/tests/rollback_data_check.sql 2>&1 \
  | grep -vE '^\s*$|^-+$|^\([0-9]+ rows?\)$' | sed 's/^psql:[^ ]* //'

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)"

echo "── accounting controls (copy of production, concurrency, isolation, rollback with books) ──"
bash supabase/tests/accounting_controls/run.sh
