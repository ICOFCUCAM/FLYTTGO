# Accounting (FlyttGo Regnskap): the portable core

Owner's decisions (2026-10-29): FlyttGo has its own accounting system and offers it to companies as an add-on at its own price; the price follows the company's size (turnover); no accounting firm is involved: the software keeps the books from the company's transactions and produces the files its own accountant reviews; it is built so it can be copied into Ledgera (`ICOFCUCAM/FlyttgoTechGroup`). Assessment and the rules it follows: [`ACCOUNTING.md`](ACCOUNTING.md). Decisions #33–36 in [`DECISIONS.md`](DECISIONS.md).

**Not applied anywhere yet.** Migrations `00014` and `00015` follow the same procedure as the others ([`SECURITY_P0.md`](SECURITY_P0.md) §5).

## The parts

| Part | Where | Portable? |
|---|---|---|
| Database core: ledgers, chart of accounts, vouchers, MVA, reports, back office | `supabase/migrations/00014_accounting_core.sql` (schema `accounting`) | Yes, copied unchanged |
| Host adapter and posting of the host's own events | `supabase/migrations/00015_accounting_flyttgo.sql` | No: each product writes its own |
| API, wording (English/Norwegian), documents, PDF/Word/ZIP writers, SAF-T, screens | `src/accounting/` | Yes, copied unchanged (React + Tailwind + supabase-js; no other dependencies) |
| FlyttGo's wiring | `src/lib/accounting.ts`, `components/corporate/AccountingPanel.tsx`, `components/admin/AccountingAdminPanel.tsx`, `pages/AccountingPage.tsx`, `supabase/functions/accounting-invite` | No |

## What it does

- **Books per company:** a ledger per tenant (a company) and one "house" ledger for the platform's own company. The NS 4102 chart of accounts a small company uses, each account mapped to Skatteetaten's næringsspesifikasjon grouping code (changeable).
- **Every transaction recorded:** the host posts its own events automatically (FlyttGo: issued invoices, credit notes, payments, reminder fees, once each); everything else (purchases, salaries, bank costs) is a voucher with its receipt. With an MVA code the amount is split into net and MVA.
- **Rules of bookkeeping enforced in the database:** vouchers numbered per year without gaps; written once (no change, no delete, not even by the database owner); a voucher balances at commit; corrections are reversals with a reason; closed periods are never reopened; receipts kept with their SHA-256 and never removed; an ended ledger stays readable. A rollback never deletes books.
- **MVA:** standard SAF-T codes, two-monthly or yearly terms, the return per code, the settlement to 2740.
- **Year end:** the result moves to equity.
- **Reports:** saldobalanse, hovedbok, resultat, balanse (balances at any date), MVA per term, the accountant's checks (balanced, no gaps, receipts, MVA accounts agree, every account has a tax-return grouping).
- **Documents, each in PDF and Word, in Norwegian or English:** Mva-melding basis, Årsregnskap (draft for the board, with notes and signature lines), Næringsspesifikasjon basis (by Skatteetaten's codes), Resultatregnskap, Balanse, Saldobalanse, Hovedbok, Bilagsjournal, Kunde- and Leverandørreskontro, Kontrolloppstilling, Frister og innleveringer. Plus **SAF-T Financial 1.30** (validated against Skatteetaten's XSD in the tests) and the **accountant package**: everything for a year in one ZIP.
- **The company's back office:** its owners and admins invite an **accountant** (keeps and closes the books), **bookkeeper** (posts vouchers and receipts), **external auditor** (reads everything and writes notes, for a set period) or **viewer**. Invitations by email, used once, for the invited address only; removed people stay listed with the reason.
- **English / Norwegian** switch in the office; documents in either language.

What it does not do (yet): file anything with Skatteetaten, Altinn or Brønnøysund (the company or its accountant files, from these files); payroll and A-melding; the shareholder register return; bank statement import; a register of customers and suppliers beyond the names on the documents. See [Next](#next).

## The host adapter (what another product writes)

The core calls these, and the host replaces them after the core is created (until then they deny everything):

| Function | Returns |
|---|---|
| `accounting.host_can_keep(tenant uuid)` | the caller keeps that tenant's books as "owner" (tenant null: the house books) |
| `accounting.host_can_manage(tenant uuid)` | the caller asks for, ends and staffs the tenant's ledger |
| `accounting.host_is_operator()` | the caller runs the platform (approves ledgers) |
| `accounting.host_is_server()` | the request is from the host's server |
| `accounting.host_tenant(tenant uuid)` | `{legal_name, org_number, vat_registered, active}` |
| `accounting.host_event(tenant, action, details)` | the host's own log (may do nothing) |

The host posts its events with `accounting.post_entry(ledger, date, description, source_type, source_id, lines)`, once per source (lines from `accounting.line(account, signed amount, mva_code, 'basis'|'vat', description, party, ref)`; accounts from `accounting.account_for(ledger, key)`; the ledger from `accounting.ledger_for(tenant)`).

In the browser the host passes `createAccountingApi(supabaseClient, host)` its optional `HostApi`: `unposted`, `postUnposted`, `tier`, `priceList`, `invite` (server-side email, so the token stays out of the browser), `acceptUrl`.

## Copying it into Ledgera

1. Copy `supabase/migrations/00014_accounting_core.sql` unchanged as Ledgera's next migration. It lives in its own schema, so it does not touch Ledgera's existing `journal_entries` and other tables.
2. Write Ledgera's adapter migration: `host_can_keep` from its `users_roles`/`jwt_org_id()`, `host_is_operator` for its super admins, `host_tenant` from its organisation profile; a foreign key from `accounting.ledgers.tenant_id` to its organisations.
3. Project settings → API → Exposed schemas: add `accounting`.
4. Copy `src/accounting/` unchanged (it needs React, Tailwind and `@supabase/supabase-js`, which Ledgera has); in a Next.js app render `AccountingOffice` and `AccountantHome` from client components (`'use client'`).
5. Ledgera's existing manual journals can be moved in as manual vouchers (one import script), after which its own exports can point at the core's (`src/accounting/saft.ts`, documents).
6. Run Ledgera's tests plus this repository's `supabase/tests/accounting.test.sql` adapted to Ledgera's fixtures.

## Prices (add-on; proposed until FlyttGo confirms)

By the company's yearly turnover (income, accounts 3xxx): last calendar year's from the books once they hold it, before that the turnover the company declared. Reassessed each 1 January. Excl. MVA, per month:

| Band | Turnover (NOK) | Price |
|---|---|---|
| Start | under 1 million | 199 |
| Small | 1–5 million | 499 |
| Medium | 5–20 million | 1 290 |
| Large | 20–100 million | 2 990 |
| Enterprise | 100 million and above | agreed |

An agreed price on the ledger always wins. Billed monthly on FlyttGo's invoice by `invoice-run` (each month once). Changed in `platform_config.accounting_price_tiers` (and `accounting_price_status` to `confirmed`).

## FlyttGo specifics (00015)

- Tenants are organisations; their owners, admins and finance are "owners" of the books; owners and admins manage the back office.
- FlyttGo's administrators approve the add-on and keep FlyttGo's own books; they never read a company's books.
- FlyttGo's own invoices post into the house ledger; a company's sales invoices into its ledger.

## Before offering it

1. Apply 00014 and 00015 with the rest; expose the `accounting` schema to the API; deploy `accounting-invite` (secrets as `send-organization-invitation`).
2. Confirm the prices.
3. **System documentation** (bokføringsforskriften § 2-1): this document, the migrations and the tests are its basis; a written version for companies and their accountants is needed.
4. Have an authorised accountant review the chart, the grouping codes, the MVA treatment (in particular 0 % sales: code 5 or 6) and the documents before companies rely on them.
5. Storage: the books must be kept 5 years after the year end; the database and the receipts bucket are backed up (Supabase PITR) and nothing in the system deletes them.

## Next

- MVA-melding submission through Skatteetaten's API (Maskinporten/ID-porten): the return's figures already exist per code.
- Bank statement import (camt.053) and matching.
- Stripe fees and payouts posted automatically (Stripe balance transactions).
- Customers and suppliers register; reverse charge (codes 81, 86 …); fixed assets and depreciation; payroll and A-melding.
- SAF-T 1.40 (mandatory from periods starting 1 January 2027; backward compatible).
