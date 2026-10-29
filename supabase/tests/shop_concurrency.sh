#!/usr/bin/env bash
# Online shops under load (00020): many sessions order the last items of
# the same products at once, with the items in different orders in the
# cart. Exactly the stock is sold, it never goes below zero, and nobody
# deadlocks. Called by run.sh on the repository database after the suites
# (it needs their fixtures); its data is committed and dropped with that
# database.
set -euo pipefail
DB="$1"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
q() { "${PSQL[@]}" -d "$DB" -At -c "$1"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
CUST1=c0000000-0000-0000-0000-000000000001; CUST2=c0000000-0000-0000-0000-000000000002
OUT=$(mktemp)

ORG=$(q "BEGIN; SET LOCAL ROLE authenticated; SELECT tests.sh_acme(); COMMIT;" | tail -1)
q "BEGIN; SET LOCAL ROLE authenticated; SELECT tests.login('$CUST1');
   SELECT public.set_shop_stock(tests.sh_product('Mug'), NULL, 20);
   SELECT public.set_shop_stock(tests.sh_product('T-shirt'), tests.sh_variant('S'), 5); COMMIT;" >/dev/null

orders() {  # session, count
  for i in $(seq 1 "$2"); do
    if [ $(( ($1 + i) % 2 )) = 0 ]; then items="tests.sh_item('Mug', 1), tests.sh_item('T-shirt', 1, 'S')"
    else items="tests.sh_item('T-shirt', 1, 'S'), tests.sh_item('Mug', 1)"; fi
    # Every other order also wants the last size; when it is gone the whole order is refused.
    [ $(( i % 2 )) = 0 ] && items="tests.sh_item('Mug', 1)"
    echo "BEGIN; SET LOCAL ROLE authenticated; SELECT tests.login('$CUST2');
          SELECT public.place_shop_order('$ORG', jsonb_build_array($items), 'pickup', NULL, tests.sh_contact()); COMMIT;"
  done
}
PIDS=()
for s in 1 2 3 4 5 6 7 8; do (orders $s 5 | psql -X -q -d "$DB" >/dev/null 2>>"$OUT") & PIDS+=($!); done
for p in "${PIDS[@]}"; do wait "$p" || fail "a concurrent session failed"; done

! grep -qi deadlock "$OUT" || fail "competing orders deadlocked: $(grep -i deadlock "$OUT" | head -3)"
OTHER=$(grep ERROR "$OUT" | grep -vE 'sold out|only [0-9]+ of' | head -3 || true)
[ -z "$OTHER" ] || fail "an order failed for another reason: $OTHER"
# Mugs are wanted 40 times for 20, so they always sell out; size S goes
# only with a mug, so how many sell depends on who comes first, but never
# more than the 5 there were.
[ "$(q "SELECT stock FROM public.shop_products WHERE name = 'Mug'")" = 0 ] || fail "mugs left after 40 orders for 20"
SOLD=$(q "SELECT coalesce(sum(l.quantity) FILTER (WHERE l.name = 'Mug'), 0) || ' ' || coalesce(sum(l.quantity) FILTER (WHERE l.name = 'T-shirt (S)'), 0)
                 || ' ' || (SELECT stock FROM public.shop_variants WHERE name = 'S')
            FROM public.shop_order_lines l JOIN public.shop_orders o ON o.id = l.order_id WHERE o.organization_id = '$ORG'")
read -r MUGS SHIRTS LEFT <<< "$SOLD"
[ "$MUGS" = 20 ] || fail "$MUGS mugs sold, 20 were in stock"
[ $((SHIRTS + LEFT)) = 5 ] && [ "$SHIRTS" -ge 1 ] || fail "$SHIRTS size S sold and $LEFT left, 5 were in stock"
echo "NOTICE:  ok - 8 sessions, 40 orders at once: exactly the 20 mugs in stock are sold, size S never oversold ($SHIRTS sold, $LEFT left), no deadlock"
rm -f "$OUT"
