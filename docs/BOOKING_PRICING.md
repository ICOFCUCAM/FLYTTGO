# How a booking is priced and charged

The browser shows a price as soon as a customer has chosen addresses, van and hours (the `calculate-price`
function, or the same formula in `src/lib/constants.ts` while it answers). That figure is a preview. What
the customer pays is computed again on the server by `chargeForBooking()`
(`supabase/functions/_shared/booking-charge.ts`) before every card, Vipps or invoice charge, from the
booking's own fields. Nothing the browser sends about money is used.

## The rules (31 October 2026)

1. **The points are checked against the addresses.** The booking stores the pickup and drop-off addresses
   and their coordinates, both sent by the browser. The server looks both addresses up in Kartverket's
   address register (`address-check.ts`; the same service the address field uses), retrying on the postcode
   when the full address is not found:
   - near its address (1.5 km; 30 km when only the postcode was found) → **confirmed**;
   - far from it → **corrected**: the booking is priced, and its coordinates stored, at the register's point;
   - not found, or the register does not answer → **unconfirmed**: the stored point is used.
   A lookup that fails never blocks a payment. The result is kept on the booking (`location_check`,
   migration 00028; written only by the server) so the office can see what to confirm before dispatch.
2. **The distance is never shorter than the straight line** between the two points
   (`flooredDistanceKm()`), whatever the router answers.
3. **The hours billed** are the hours the customer chose, or the time the drive alone takes when that is
   longer (rounded up to the half hour), never below the 2-hour minimum (`billedHours()`, the same rule in
   the browser). The breakdown says so when the drive time applies. Helpers are billed for the same hours.
4. **The server's figures are always written** to the booking: distance, the points priced on and the
   check; the price and the escrow row when they differ from the preview. The overtime check after a job
   (`process-payment`, `recalculate_price`) reads that distance, and asks the customer to approve an extra
   charge only when the price for the actual hours is higher than what was charged.

The browser and server formulas are tested against each other over every combination of van, hours,
distance, drive time, helpers and extras (`src/test/booking-money.test.ts`).

## Not covered yet

- A booking whose address cannot be found at all still cannot be priced in the browser (no manual distance).
- Tolls and ferries are not assessed.
- One booking has one pickup and one drop-off.
