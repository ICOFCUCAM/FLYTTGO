#!/usr/bin/env bash
# Release rehearsal with representative data (docs/RELEASE_GATES.md →
# Release rehearsal; owner's decision 2026-10-29, DECISIONS.md #44):
#
#   1. the copy of production as it is today: the replica
#      supabase/schema/production-2026-10-29.sql with 00002–00015;
#   2. representative synthetic data written through the platform's own
#      functions (data_before.sql);
#   3. 00016–00026 applied twice with that data in place; the financial
#      records must be exactly as before;
#   4. the data only 00016–00026 allow (data_after.sql), then the checks
#      (checks.sql): RLS and cross-company isolation per table, payment
#      idempotency, financial records immutable;
#   5. rollback 00026 → 00017 with the data in place (after moving the
#      companies off the plans those rollbacks remove, as their notes
#      require); the financial records must be exactly as before; and
#      00016's rollback must refuse while bank imports are recorded,
#      leaving every record as it was (never delete or reverse them).
#
# Called by ../run.sh with its PG* settings. Plain PostgreSQL; never point
# it at a real Supabase project.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB="${FLYTTGO_TEST_DB:-flyttgo_test}_reh"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
q() { "${PSQL[@]}" -d "$DB" -At -c "$1"; }
show() { PGOPTIONS='-c client_min_messages=notice' "${PSQL[@]}" -d "$DB" -f "$1" 2>&1 | grep -E '^(psql:.*)?(NOTICE:  ok|ERROR|FAIL)|passed|written' | sed 's/^psql:[^ ]* //'; }
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "NOTICE:  ok - $*"; }
HASH="SELECT tbl || ' ' || n || ' ' || digest FROM tests.rh_fin_rows() ORDER BY tbl"
WORK=$(mktemp -d)

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\""
"${PSQL[@]}" -d "$DB" -f supabase/tests/supabase-stub.sql 2>&1 | grep -v -e wal_level -e HINT || true
"${PSQL[@]}" -d "$DB" -f supabase/schema/production-2026-10-29.sql
diff <("${PSQL[@]}" -d "$DB" -At -F' ' -f supabase/schema/fingerprint-summary.sql) supabase/schema/production-2026-10-29.fingerprint \
  || fail "the copy's schema differs from production's recorded fingerprint"
# Production today: 00002–00015 applied once (docs/PRODUCTION_DEPLOY_2026-10-29.md).
for f in supabase/migrations/0000[2-9]_*.sql supabase/migrations/0001[0-5]_*.sql; do "${PSQL[@]}" -d "$DB" -f "$f"; done
ok "the copy of production: the replica with 00002–00015, as production runs today"
"${PSQL[@]}" -d "$DB" -f supabase/tests/helpers.sql
"${PSQL[@]}" -d "$DB" -f supabase/tests/rehearsal/hash.sql
show supabase/tests/rehearsal/data_before.sql
q "SELECT 'companies ' || (SELECT count(*) FROM public.organizations) || ', members ' || (SELECT count(*) FROM public.organization_members)
     || ', moves ' || (SELECT count(*) FROM public.bookings) || ', invoices ' || (SELECT count(*) FROM public.invoices)
     || ', payments ' || (SELECT count(*) FROM public.invoice_payments)" | sed 's/^/data before 00016: /'
q "$HASH" > "$WORK/before"

# ── 00016–00026, twice, with the data in place ───────────────────────────
for pass in 1 2; do
  for f in supabase/migrations/0001[6-9]_*.sql supabase/migrations/0002[0-9]_*.sql; do "${PSQL[@]}" -d "$DB" -f "$f"; done
done
ok "00016–00026 applied twice over the data"
diff "$WORK/before" <(q "$HASH" | grep -v '^bank_import') > "$WORK/diff" \
  || { cat "$WORK/diff" >&2; fail "applying 00016–00026 changed financial records"; }
ok "every invoice (both series), line, payment, reminder, credit note, payment event and refund is exactly as before the migrations"

show supabase/tests/rehearsal/data_after.sql
q "SELECT 'add-ons ' || (SELECT count(*) FROM public.organization_addons) || ', API keys ' || (SELECT count(*) FROM public.api_keys)
     || ', reservations ' || (SELECT count(*) FROM public.restaurant_reservations) || ', stays ' || (SELECT count(*) FROM public.hotel_stays)
     || ', shop orders ' || (SELECT count(*) FROM public.shop_orders) || ', bank imports ' || (SELECT count(*) FROM public.bank_imports)
     || ', invoices ' || (SELECT count(*) FROM public.invoices) || ', contact messages ' || (SELECT count(*) FROM public.contact_messages)" | sed 's/^/data after 00026: /'
show supabase/tests/rehearsal/checks.sql
q "$HASH" > "$WORK/after"

# ── Rollback 00026 → 00017 with the data in place ─────────────────────────
# The rollbacks of 00019 and 00020 stop while a company is on a plan they
# remove; their notes say to move such companies to another plan first
# (and to export the records each company keeps). Done here as an
# administrator would, to Website and invoicing.
q "UPDATE public.organization_white_label SET plan_code = 'website_invoicing', requested_plan_code = NULL
    WHERE plan_code IN ('restaurant', 'hotel', 'shop') OR requested_plan_code IN ('restaurant', 'hotel', 'shop')" >/dev/null
for n in 00026 00025 00024 00023 00022 00021 00020 00019 00018 00017; do
  PGOPTIONS='-c client_min_messages=notice' "${PSQL[@]}" -d "$DB" -f "supabase/rollback/${n}_down.sql" 2>&1 \
    | grep -E 'NOTICE|ERROR' | sed 's/^psql:[^ ]* //' || true
  [ "$(q "SELECT to_regclass('public.bank_imports') IS NOT NULL")" = t ] || fail "rolling back $n removed the bank imports"
done
[ "$(q "SELECT to_regclass('public.company_booking_approvals') IS NULL AND to_regclass('public.organization_addons') IS NULL AND to_regclass('public.image_library') IS NULL AND to_regclass('public.contact_messages') IS NULL")" = t ] \
  || fail "the rollbacks of 00017–00026 did not complete"
ok "00026, 00025, 00024, 00023, 00022, 00021, 00020, 00019, 00018 and 00017 roll back with the data in place"
diff "$WORK/after" <(q "$HASH") > "$WORK/diff" || { cat "$WORK/diff" >&2; fail "rolling back changed financial records"; }
ok "every invoice, line, payment, credit note (shop and stay receipts included), payment event, refund, bank import and row survives unchanged"
[ "$(q "SELECT count(*) FROM public.bookings WHERE id IN (SELECT id FROM tests.rh WHERE key LIKE 'move_%' OR key LIKE 'approval_%')")" \
  = "$(q "SELECT count(*) FROM tests.rh WHERE key LIKE 'move_%' OR key LIKE 'approval_%'")" ] || fail "a move was lost in the rollback"
ok "every move survives (the one still waiting for approval is cancelled, unpaid, by 00017's rollback)"

# ── 00016: the protective refusal ─────────────────────────────────────────
if "${PSQL[@]}" -d "$DB" -f supabase/rollback/00016_down.sql > "$WORK/out" 2>&1; then
  fail "00016's rollback ran although bank imports are recorded"
fi
grep -q "bank imports are recorded" "$WORK/out" || { cat "$WORK/out" >&2; fail "00016's rollback failed for another reason"; }
ok "00016's rollback refuses while bank imports are recorded (they are never deleted or reversed)"
diff "$WORK/after" <(q "$HASH") > "$WORK/diff" || { cat "$WORK/diff" >&2; fail "the refused rollback changed financial records"; }
ok "and leaves every financial record as it was"

rm -rf "$WORK"
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)"
echo "release rehearsal: all passed"
