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
MIGRATIONS=(supabase/migrations/0000[2-9]_*.sql)
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
run_tests supabase/tests/p0_security.test.sql supabase/tests/organizations.test.sql

echo "── production ──"
fresh
"${PSQL[@]}" -d "$DB" -f "$REPLICA"
if ! diff <(fingerprint) "$EXPECTED_FP"; then
  echo "FAIL: the replica no longer matches the recorded production fingerprint" >&2; exit 1
fi
echo "replica matches the production fingerprint"
migrate
run_tests supabase/tests/p0_security.test.sql supabase/tests/p0_production.test.sql \
  supabase/tests/organizations.test.sql

echo "── rollback ──"
# Function bodies and settings of a fresh replica, to compare with after
# the rollback (the recorded fingerprint covers structure, not bodies).
BODIES="SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || p.prosecdef || ' '
        || coalesce(array_to_string(p.proconfig, ','), '-') || ' ' || md5(p.prosrc)
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1"
fresh
"${PSQL[@]}" -d "$DB" -f "$REPLICA"
before_bodies=$("${PSQL[@]}" -d "$DB" -At -c "$BODIES")
migrate
for f in $(ls supabase/rollback/*_down.sql | sort -r); do "${PSQL[@]}" -d "$DB" -f "$f"; done
if ! diff <(fingerprint) "$EXPECTED_FP"; then
  echo "FAIL: after rolling back, the schema differs from production" >&2; exit 1
fi
if ! diff <(echo "$before_bodies") <("${PSQL[@]}" -d "$DB" -At -c "$BODIES"); then
  echo "FAIL: after rolling back, function bodies differ from production's" >&2; exit 1
fi
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
