# The companies' API and booking widget

A company connects its own systems to FlyttGo with **API keys** and puts its booking page on its own website with the **booking widget**. Migration `supabase/migrations/00018_api_keys.sql` (rollback `supabase/rollback/00018_down.sql`), Edge Function `public-api`, the widget `public/widget.js` with the embed page `/embed/<slug>` and the Vercel middleware `middleware.ts`. The API's description is [`api/openapi.yaml`](api/openapi.yaml) (OpenAPI 3.1; also downloadable from `/business/api`).

**Not applied or deployed.** It follows the same procedure as the rest: [`SECURITY_P0.md`](SECURITY_P0.md) §5 and [`COPY_OF_PRODUCTION_TEST_PLAN.md`](COPY_OF_PRODUCTION_TEST_PLAN.md).

## API access is an add-on; the widget is in every plan

Owner's decision (2026-10-29, [`DECISIONS.md`](DECISIONS.md) #41, migration 00022): the **booking widget** is included in every plan, for every active company with a plan (its page is the company's booking page, which needs an active plan anyway). **API access** is the add-on `api` (`organization_addons`), which only FlyttGo's administrators enable (Admin → White label → Add-ons), priced by a written quote or an approved pilot price recorded with it. Without it no key is created or changed (`create_api_key`, `update_api_key`: 55000) and **every call is refused** (`api_begin`, `api_read`, `api_write`: `api_not_enabled`, 403). Ending the add-on stops every key at once; the keys are kept and can be revoked. The API add-on also goes on a company that books moves for itself and has no white-label plan, and on a plan where FlyttGo sells (it is the only add-on there). Bookings through the API stay invoice-only, and the limit stays 60 requests a minute per key.

## API keys

- **Who:** an owner or admin of an **active** company (`is_active_org_member`, as [`PREDEPLOY_REVIEW.md`](PREDEPLOY_REVIEW.md) requires) creates, names, scopes and changes keys in Corporate dashboard → **API and widget**. Owners and admins revoke them, also while the company is suspended; FlyttGo's administrators may revoke any key (logged with their name) and set a key's limit. Pending companies have no keys.
- **The key** is `fgo_` and 64 random hex characters (two `gen_random_uuid()`s, as invitations). It is shown once. The database keeps its SHA-256 (`api_keys.key_hash`, not readable from the browser) and its first 12 characters as a visible prefix. At most 20 unrevoked keys per company; an optional expiry.
- **Scopes**, each available only while the company's terms and plan allow it (`api_scope_available`):

| Scope | Allows | Available when |
|---|---|---|
| `quotes` | `POST /v1/quotes` | the company is active |
| `bookings:read` | `GET /v1/bookings`, `GET /v1/bookings/{id}` | the company is active |
| `bookings:write` | `POST /v1/bookings` | FlyttGo has switched invoice payment on for the company (00008): API bookings are paid on invoice |
| `appointments` | services, free times, list, get, `POST /v1/appointments` | the plan includes Appointments (`org_has_module`) |
| `jobs` | services, list, get, `POST /v1/jobs` | the plan includes Jobs (`org_has_module`) |

- **A key works only while** it is not revoked or expired, the company is active and has the API add-on, and **the member who created it is still an active owner or admin** there. A scope the plan or terms no longer include is refused at once (`scope_unavailable`).
- **Revoked at once when its creator loses the role** (00022): when the member who created a key leaves or is removed, is suspended, or is given a role other than owner or admin, however the change is made (the Team tab, an administrator in SQL, a deleted account), a trigger on `organization_members` revokes every key they created in that company and logs each revocation in `api_events` (`key.revoked`, `automatic: true`, the cause and who changed the membership). The check at each use (`creator_not_member`) stays behind it.
- **Last use** is recorded (at most once a minute). **The key log** (`api_events`, append-only, read by owners and admins) records creating, changing and revoking keys, every write made through a key, and changes to the widget's websites.
- **Rate limit:** 60 requests a minute per key unless FlyttGo sets another (`admin_set_api_key_limit`), counted per key and minute in `api_key_usage` (every request with a known key counts, also refused ones). Answers carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`; over the limit, 429 with `Retry-After`.

## Who the API acts as (decided here; owner to confirm)

**A key acts as the member who created it.** Writes go through the same database functions as that member's own screens, run inside the database with the creator's identity (`api_write` sets the request's user to the creator for the transaction), so their company role and every existing check apply:

- **Moves:** the edge function prices the move with the formula and routing every payment function uses (`_shared/pricing.ts`, as `chargeForBooking`); the booking is inserted as the creator (the booking guards of 00003, 00007 and 00009 run as for the dashboard: the creator must be an owner, admin or booker of the active company), then paid with `book_on_invoice`, the function `book-on-invoice` uses: invoice payment switched on, the credit limit, a current credit check where FlyttGo asks for one. No second booking engine; the move goes to dispatch like any booking on invoice. A refused booking leaves nothing behind.
- **Jobs:** `create_job` (the company records a job). **Appointments:** `create_appointment` (the company books a time; with a named person it may be outside the opening hours, never over another appointment, as in the dashboard).
- The booking's customer (`customer_id`) is the key's creator, as when they book on invoice in the dashboard; the contact on site is the request's `contact`.
- Reads (`api_read`) return only the key's company's records. A move shows what the company's dashboard shows plus the move's details; **no driver data**, payment provider references or internal fields (`api_booking_json`). Another company's id answers 404, like a missing one.

Why the creator rather than a separate "API user": it needs no new kind of member, the permissions are the ones the company already manages, and a key dies with its creator's role. If a company wants keys that survive a person leaving, a service member per company is the alternative (not built).

## Requests

- `Authorization: Bearer fgo_…` on every request. Base URL `https://<project>.supabase.co/functions/v1/public-api/v1`.
- JSON in and out. Errors: `{"error": {"code": "…", "message": "…"}}` (`fields` for invalid requests). 401 missing, invalid, revoked or expired key; 403 scope, inactive company, no API add-on (`api_not_enabled`), creator no longer owner or admin, or the creator's role; 404 not found; 409 refused by the terms or state (invoice payment off, credit limit, time taken, missing authorisation); 422 invalid request or a reused Idempotency-Key; 429 rate limit.
- **Idempotency-Key** on `POST /v1/bookings`, `/v1/jobs`, `/v1/appointments`: the same key and request (method, path and body with keys sorted, SHA-256) return the first answer for 24 hours (`Idempotent-Replayed: true`, status 200); the same key with another request is refused. Stored in `api_idempotency`, in the same transaction as the write, so two concurrent requests with one key make one booking.
- **No CORS:** the API sends no `Access-Control-Allow-Origin`, so a browser refuses to call it from a web page. Keys belong on servers; websites use the widget.

## The booking widget

See [`WHITE_LABEL.md`](WHITE_LABEL.md) → Booking widget.

## Tests

- `supabase/tests/api_keys.test.sql` (both schemas; the rollback restores the earlier state exactly, also with data): key format, hash and verification; who creates keys; scopes by terms and plan; jobs and appointments through the module functions as the creator; a move on invoice through `book_on_invoice`, the credit limit, idempotent retries; revoked, expired, suspended company, creator demoted; cross-company isolation; the rate limit; the widget's websites.
- `src/test/public-api.test.ts` (key format and hash vector shared with the SQL test, routes and their description in `openapi.yaml`, request validation, idempotency hash, quotes equal to calculate-price, error mapping) and `src/test/widget.test.ts` (origins, frame-ancestors, parent check, `widget.js`).

## Not built

- **Webhooks** (status changes pushed to the company): the page says so; companies read `GET /v1/bookings`.
- **Cancelling or changing** a booking, job or appointment through the API; **bulk** endpoints; a **sandbox**; SDKs.
- IP allow-lists per key; OAuth.
