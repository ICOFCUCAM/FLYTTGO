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

## Not yet built

- Per-member spending limits and approval rules (step 4, company bookings). Bookings, invoices, credit and API keys will require `is_active_org_member()`.

## Tests

`supabase/tests/organizations.test.sql` runs in `npm run test:db` on both the repository schema and the production replica (80 checks: cross-tenant isolation, invitations, roles, owner retention, pending/active, append-only log), and `launch_decisions.test.sql` for the 2026-10-29 changes (admin powers, verification, closing), and the rollback variant includes 00005.
