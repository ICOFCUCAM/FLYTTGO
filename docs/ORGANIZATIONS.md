# Organisations (company accounts)

Migration `supabase/migrations/00005_organizations.sql`. **Not applied anywhere.** It runs after 00002–00004 and follows the same deploy and rollback procedure ([`SECURITY_P0.md`](SECURITY_P0.md) §5; rollback `supabase/rollback/00005_down.sql`, run first).

This is step 2 of the corporate portal plan: the tenant foundation only. The corporate dashboard, company bookings, billing and white-label build on it and are not part of this migration. No frontend uses it yet.

## Tables

| Table | Holds |
|---|---|
| `organizations` | Name, slug (future subdomain; reserved names refused), country, organisation number (Norwegian numbers checked with MOD11; unique per country), billing email and address, VAT flag, status (`pending`, `active`, `suspended`, `closed`) and its reason. |
| `organization_members` | One row per person and organisation: company role (`owner`, `admin`, `booker`, `finance`, `viewer`), status, who invited them. |
| `organization_invitations` | Address, role, SHA-256 of the token, `pending` / `accepted` / `revoked`, 7-day expiry, who accepted. |
| `organization_events` | Append-only record of who did what in an organisation. |

## Rules

- **Membership is independent of the global profile role and of any driver plan.** No organisation function reads or writes `profiles.role`, `admin_accounts` or driver subscriptions. A driver can be a company booker and stays on their plan; a company owner remains a customer. Tests check both.
- **Row Level Security from the start**, on all four tables. Members read their organisation and its team. Owners and admins also read its invitations and event log. Platform admins read everything. Anonymous users read nothing.
- **No direct writes.** `anon` and `authenticated` have no INSERT, UPDATE or DELETE on these tables. Every change goes through a function that checks the caller's company role and records an event:

| Function | Who |
|---|---|
| `create_organization(name, slug, org_number, billing_email, country)` | Any signed-in person; they become owner. Starts `pending`. |
| `update_organization(org, changes)` | Owners and admins. Slug and organisation number: owners only. Status cannot be changed here. |
| `admin_set_organization_status(org, status, reason)` | Platform administrators only (company onboarding). |
| `organization_team(org)` | Members: the team with names and email (profiles are otherwise self-only). |
| `invite_member(org, email, role)` | Owners; admins for `booker`, `finance` and `viewer`. Not while suspended or closed. Returns the token once. |
| `revoke_invitation(invitation)` | Owners and admins. |
| `accept_invitation(token)` | The invited person, signed in with the invited address (confirmed), before expiry. Single use. |
| `change_member_role(org, user, role)` | Owners; admins only below admin. |
| `remove_member(org, user)` | Owners; admins only below admin; anyone may leave. |

- **An organisation always has an active owner.** A trigger refuses removing or demoting the last one, through any path, SQL included. This also refuses deleting the last owner's user account: transfer ownership or close the organisation first.
- **Pending companies only set themselves up.** `is_active_org_member(org, roles)` is true only for an active member of an `active` organisation. Bookings, invoices, credit, API keys and white-label must check it, never `is_org_member`.
- **The event log is append-only for every role** (server and database owner included). Its rows go only when the organisation itself is deleted; close organisations rather than delete them.
- **Invitation tokens** are 64 random hex characters (two `gen_random_uuid()`s, 244 bits). Only the hash is stored. A new invitation for the same address revokes the open one.
- Helpers for later policies on bookings and invoices: `org_role(org)` and `is_org_member(org, roles)`.

## Decided 2026-10-29 (migration 00006)

- **Platform administrators are not members.** They read every company, set its status, record verifications and restore an owner with `admin_transfer_ownership(org, user, reason)` (logged). They don't invite, change roles, remove members or edit details: `require_org_role` no longer lets them through.
- **Verification before activation.** `admin_set_organization_status(org, 'active')` requires a passed check of the current organisation number, at most 30 days old.
  - A Norwegian company is checked by `verify-organization`. It looks the company up in Brønnøysundregistrene and checks that it exists, that it isn't bankrupt, being wound up or dissolved, and that its name matches. It also takes the VAT registration from the register.
  - Otherwise an administrator records a manual check with its evidence: `record_organization_verification(org, 'manual', passed, {"evidence": …})`.
  - Checks are kept in `organization_verifications`, which owners and admins of the company can read.
- **Closing releases the last owner.** In a closed company the last owner can leave or delete their account.
- **Invitation emails:** `send-organization-invitation` creates the invitation as the inviter and emails the link `/business/invite?token=…`. The page `AcceptInvitationPage` accepts it after sign-in.

## Existing `corporate_accounts` and `corporate_orders`

Production has these two tables (both empty, not defined in this repository, admin-only since 00003). They are left untouched. New company work uses `organizations`. Decide whether to drop them once nothing refers to them.

## In the app (step 3, connect dashboard)

- **Corporate dashboard** (`/business/dashboard`, `CorporateDashboard.tsx`). Visitors still see the preview with sample figures.
  - A signed-in member sees their company (a switcher if they belong to several), its status and a notice while it awaits verification.
  - The **Team** tab is real (`components/corporate/TeamPanel.tsx`): members, roles, removing, leaving, invitations by email and withdrawing them. Only the buttons the member's role allows are shown; the database still decides.
  - A signed-in person without a company gets **Register your company** (`RegisterCompany.tsx`).
  - Modules not connected yet (overview figures, shipments, recurring, invoices, API) keep their preview, marked as sample data.
- **Admin → Companies** (`components/admin/CompaniesPanel.tsx`): filter by status, check in Brønnøysund, record a manual check, activate (only with a current passed check), suspend, close, and restore an owner.

## Company bookings (migration 00007, step 4)

- **Same engine.** A company booking is an ordinary booking with `organization_id` set: the same booking flow, payment, dispatch and refunds.
- **Who may book.** Only an owner, admin or booker of an **active** company, for a booking they make themselves. Pending, suspended and closed companies cannot book. The person booking is the booking's customer and pays as today; invoicing the company is step 5.
- **Fixed.** The company of a booking can't be changed afterwards, except by the server or a platform admin.
- **Who reads.** Every current member reads the company's bookings, finance and viewers included. Former members don't.
- **Closing, not deleting.** A company with bookings is closed, never deleted; the foreign key refuses the delete.
- **In the app.** The booking flow offers "Book for: Myself / ⟨company⟩" to those who may book. The dashboard's Shipments tab lists the company's real bookings.
- **Tests:** `company_bookings.test.sql`, on both schemas.

## Invoicing (migration 00008, step 5)

FlyttGo's own invoicing, payment terms per company, branding on the special plan and the dormant credit check: see [`INVOICING.md`](INVOICING.md).

## Spending limits and approval (migration 00017)

Migration `supabase/migrations/00017_spending_limits.sql`, rollback `supabase/rollback/00017_down.sql`. **Not applied anywhere.** It uses the one booking, payment and dispatch engine; nothing here creates, prices, pays or dispatches a booking.

| | |
|---|---|
| **Limits per member** | A limit per booking and a monthly limit (NOK incl. MVA; empty: no limit). The month is the Europe/Oslo calendar month the booking was made in. Set in the Team tab. Owners set anyone's limits but their own; admins those below admin (booker, finance, viewer, staff); finance those of bookers, viewers and staff. Nobody sets their own. The limits go with the membership: a member who leaves and rejoins starts without limits. |
| **What counts towards the month** | The member's company bookings made that month that are not cancelled and are either paid (or on invoice) or have passed the server's check (within limits, waiting or approved). An unpaid booking the server never checked commits nothing yet. Cancelling a booking, refused and expired ones included, takes it out. |
| **Approval rules** | Per company, set by owners, admins and finance: bookings above an amount, and every booking by members with given roles (owner, admin, booker). Going over a member's limit always needs approval. Requests expire after a set number of hours (default 168, at most 720), or at the move date if that comes first. |
| **Where it is enforced** | On the server, when a company booking is about to be paid: `chargeForBooking()` (`_shared/booking-charge.ts`), used by `book-on-invoice`, `create-checkout-session` and `create-vipps-session`, prices the booking and calls `company_booking_check(booking, caller, amount)` with the server's price, never the browser's. Within the limits and rules it goes ahead as before. Otherwise nothing is charged: the function answers `409 { awaitingApproval: true, approval }`, the approvers are told in the app (notifications) and by email (`send-booking-email`, template `approval_requested`), and the booker sees "Sent for approval". |
| **The waiting booking** | It stays an ordinary unpaid booking (`status` and `payment_status` both `pending`), which already keeps it out of the driver pool, dispatch and the invoice run. While the request is open, the trigger `hold_booking_for_approval` refuses paying it, putting it on invoice, capturing it, assigning a driver or moving its status, for every role, the server and administrators included (so no webhook or manual dispatch can get round it). Only cancelling works; it withdraws the request. No second booking state, engine or status value. |
| **Approving** | `decide_booking_approval(booking, approve, reason, amount)`: an owner, admin or finance member of the active company, never the person who booked, whatever role they hold then or now (a booker promoted to finance or admin, or a FlyttGo administrator who is also a member, included). Everything is read at the moment of the decision, under lock (the booking, then the request, the order the payment check uses): the approver's current membership and role and the company's status, the request's state and deadline, the booking's state. The Shipments list passes the amount the approver saw; if the request has changed since, the decision is refused and the list reloads. A refusal needs a reason. After approval the booker completes the booking as usual (My bookings → Complete payment; card, Vipps or invoice). **An approval is for exactly the amount approved (00022):** approval never changes the booking or its amount, and when the server's price differs from the approved amount, higher or lower, the next check opens a new request (reason `price_changed`, logged as `price_changed` then `requested`). |
| **Refused or expired** | The booking is cancelled by the platform with the reason. It was never paid or invoiced: no fee, nothing to refund, and the invoice run does not bill it as a cancellation. A request past its deadline cannot be approved, even before it is marked expired. `expire_booking_approvals(org)` ends overdue requests; the app runs it before showing the list, and the scheduled job `flyttgo-approval-expiry` runs it for all companies every 15 minutes ([`SCHEDULES.md`](SCHEDULES.md)). |
| **Log** | Every check and decision (`within_limits`, `requested`, `amount_changed`, `approved`, `price_changed`, `refused`, `expired`, `withdrawn`) is in `company_booking_approval_events`, append-only for every role. Changes of limits and rules go to `organization_events` (`spending.limits`, `spending.rules`). |
| **Who reads** | Owners, admins and finance: the company's limits, requests and log, everyone's spend this month (`organization_spending(org)`). A member: their own limits and spend, the rules, and the requests for their own bookings with the decision and reason. Other companies and anonymous visitors: nothing. Nobody writes the tables directly. |

In the app: the **Team** tab shows each member's limits and this month's spend, with **Limits** to change them and the **Approval rules** card; **Shipments** lists "Waiting for approval" with Approve and Refuse… and an Approval column; **My bookings** and the payment page show the booker the status and the reason.

**Deploying** needs the migration first, then the changed functions `book-on-invoice`, `create-checkout-session`, `create-vipps-session` (all through `_shared/booking-charge.ts`) and `send-booking-email`, and the frontend (the earlier payment page shows the waiting message as an error). Without the migration the changed functions refuse company bookings (the check function is missing).

**Rolling back** cancels the bookings still waiting for approval first (by the platform, without a fee; a notice says how many), since without the hold they would become payable unapproved, then drops the four tables and their functions.

**Tests:** `supabase/tests/spending_limits.test.sql` (75 checks, on both schemas: limits per booking and per month, the Oslo month, rules by amount and role, approval by another role, self-approval refused, waiting bookings not payable, not on invoice, not seen or taken by drivers, not invoiced, refusal and expiry without a fee, the append-only log, isolation between companies); the rollback-with-data pass leaves a booking waiting; `src/test/spending.test.ts` for the shared rules (`_shared/spending.ts`).

Approval at the moment of decision, the price rule and the expiry job (00022, owner's decision 2026-10-29): `supabase/tests/pilot_addons.test.sql` and `schedules.test.sql`.

## Not yet built

- API keys (migration 00018, [`API.md`](API.md)) are built and require `is_active_org_member()` and the API add-on (00022) to create; a key works only while the company is active and has the add-on, and is revoked at once when its creator stops being an owner or admin.

## Tests

`supabase/tests/organizations.test.sql` runs in `npm run test:db` on both the repository schema and the production replica (80 checks: cross-tenant isolation, invitations, roles, owner retention, pending/active, append-only log), and `launch_decisions.test.sql` for the 2026-10-29 changes (admin powers, verification, closing), and the rollback variant includes 00005.
