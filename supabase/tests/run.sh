#!/usr/bin/env bash
# Database tests for the migrations, on a plain PostgreSQL (no Supabase
# project needed). Creates a scratch database twice:
#   repo        stub + 00001 + 00002
#   production  stub + 00001 + production-fixture.sql + 00002
# and runs the matching test files. Uses the usual PG* environment
# variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); needs a role that can
# create databases and roles. Never point it at a real Supabase project.
set -euo pipefail

cd "$(dirname "$0")/../.."
DB="${FLYTTGO_TEST_DB:-flyttgo_test}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

run_variant() {
  local name="$1"; shift
  echo "── $name ──"
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\""
  "${PSQL[@]}" -d "$DB" -f supabase/tests/supabase-stub.sql
  "${PSQL[@]}" -d "$DB" -f supabase/migrations/00001_complete_schema.sql
  for f in "$@"; do
    case "$f" in
      fixture:*) "${PSQL[@]}" -d "$DB" -f "${f#fixture:}" ;;
    esac
  done
  "${PSQL[@]}" -d "$DB" -f supabase/migrations/00002_p0_security_hardening.sql
  # Applying twice must be harmless.
  "${PSQL[@]}" -d "$DB" -f supabase/migrations/00002_p0_security_hardening.sql
  "${PSQL[@]}" -d "$DB" -f supabase/tests/helpers.sql
  for f in "$@"; do
    case "$f" in
      fixture:*) ;;
      *) PGOPTIONS='-c client_min_messages=notice' "${PSQL[@]}" -d "$DB" -f "$f" 2>&1 | grep -E '^(psql:.*)?(NOTICE:  ok|ERROR|FAIL)|passed' | sed 's/^psql:[^ ]* //' ;;
    esac
  done
}

run_variant repo supabase/tests/p0_security.test.sql
run_variant production fixture:supabase/tests/production-fixture.sql \
  supabase/tests/p0_security.test.sql supabase/tests/p0_production.test.sql
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)"
