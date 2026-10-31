# Tracking

Rebuilt on 31 October 2026 (owner: premium tracking, real data only).

## What a customer sees

- **A booking reference** on every booking: `FG-` and six characters without 0/O/1/I/L (`bookings.booking_ref`,
  set by the database, migration 00029). Shown on the payment page, in My Bookings (linking to tracking) and in
  the company bookings list. `/track?ref=FG-XXXXXX` opens it directly.
- **Anyone with the reference** (no sign-in) sees the status, its recorded times, the van and the two towns,
  through `track_booking()`. No names, phone numbers, emails, street addresses, prices or driver details.
- **The booking's own customer** (signed in) also sees the addresses and total, the road route on a map
  (`components/RouteMap.tsx`), the driver's live position while the job is in flight (`lib/driverTracking.ts`)
  and an arrival estimate by road from that position, labelled as an estimate. The status follows the
  database over realtime (bookings joined the realtime publication in 00029), with a refetch every 30 seconds
  as fallback; the page says "Live" only while the subscription is connected.
- **One status mapping** (`lib/trackingStatus.ts`) over every status the table allows; cancelled is shown as
  cancelled; an unknown status is shown as such, never as "Booked". Only the booking's own times are shown.

Nothing on the page is invented: the earlier sample driver, phone number, scripted chat, countdown and step
times are gone.

## The route map

`lib/routeGeometry.ts` asks the public OSRM router for the full road geometry and falls back to the straight
line (marked "approximate line") when it does not answer; never throws; cached per session. `RouteMap` is
lazy-loaded (Leaflet is fetched only when a map is shown) and is used in the booking flow (addresses and
summary steps) and on the tracking page.

## Not done yet

- Status messages by email or text (driver assigned, arriving, delivered).
- Proof of delivery (photo or signature) before escrow releases.
- Three-way consent (necessary / analytics / marketing) and conversion events.
- A rate limit on `track_booking()` (it reveals only status and towns; the reference space is ~887 million).
