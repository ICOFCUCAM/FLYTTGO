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
| `accept_invitation(token)` | The invited person, signed in with the invited address, before expiry. Single use. |
| `change_member_role(org, user, role)` | Owners; admins only below admin. |
| `remove_member(org, user)` | Owners; admins only below admin; anyone may leave. |

- **An organisation always has an active owner.** A trigger refuses removing or demoting the last one, through any path, SQL included.
- **Invitation tokens** are 64 random hex characters (two `gen_random_uuid()`s, 244 bits). Only the hash is stored. A new invitation for the same address revokes the open one.
- Helpers for later policies on bookings and invoices: `org_role(org)` and `is_org_member(org, roles)`.

## Existing `corporate_accounts` and `corporate_orders`

Production has these two tables (both empty, not defined in this repository, admin-only since 00003). They are left untouched. New company work uses `organizations`. Decide whether to drop them once nothing refers to them.

## Not yet decided or built

- Sending the invitation email (an edge function that calls `invite_member` and mails the link). Until then, the token is returned to the inviter.
- Whether the platform verifies organisation numbers against Brønnøysundregistrene before activation.
- What `pending` may do. Today a pending organisation can invite its team but nothing else exists to use. Bookings will require `active`.
- Per-member spending limits and approval rules (step 4, company bookings).

## Tests

`supabase/tests/organizations.test.sql` runs in `npm run test:db` on both the repository schema and the production replica (65 checks), and the rollback variant includes 00005.
