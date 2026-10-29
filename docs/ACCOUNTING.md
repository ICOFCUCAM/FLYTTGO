# Accounting for FlyttGo and the companies on it: assessment and advice

Written 2026-10-29 at the owner's request: FlyttGo is to offer companies a built-in accountant at a special price, which records every transaction and produces the Norwegian tax and accounting documents. Two existing systems were read (read-only); nothing was changed in either.

> **Decided the same day (owner):** FlyttGo builds its own accounting system (Ledgera's design, built where the transactions are) and offers it as an add-on priced by the company's turnover; no accounting firm: the software records the transactions and produces the files the company's own accountant reviews; built so it can be copied into Ledgera. Built: [`ACCOUNTING_CORE.md`](ACCOUNTING_CORE.md). That replaces advice 2–4 below (connect to Fiken/Tripletex/PowerOffice; a partner firm; Ledgera later). The assessment and the Norwegian rules still apply: software in which each company keeps its own books needs no authorisation; doing the books for others would.

## What exists

| | Fast Man & Van (`ICOFCUCAM/VanMan-UK`, back office → Accountant) | Ledgera (`ICOFCUCAM/FlyttgoTechGroup`, `/accounting`) | FlyttGo (this repository) |
|---|---|---|---|
| Kind | Report screens over bookings | Double-entry bookkeeping | Invoice engine (sub-ledger) |
| Ledger | None: sums of bookings | Chart of accounts (NS 4102 subset), journal entries and lines, debits = credits checked in the database | Invoices, credit notes, payments, reminders, one number series per issuer (00008, 00011) |
| Where figures come from | Bookings; input VAT = 3 % of sales, purchases = 15 % of sales, fixed ratios | Typed in by hand only; no import from invoices, Stripe or bank | Bookings, plans, jobs and appointments, automatically |
| Tax output | UK: 9-box VAT return, corporation tax estimate (HMRC, three different formulas); "submitted" is only a status | Norway: SAF-T labelled 1.30 (would not pass the XSD), MVA summary as CSV/PDF (not the mva-melding format, sign errors on credit notes) | None (PDF and EHF invoices, CSV) |
| Filing | Nothing to HMRC | Nothing to Skatteetaten, Altinn or Brønnøysund | — |
| Security | Accountant role checked in the browser only; the bookings policy does not let an accountant read bookings; four finance tables are not in the repository | RLS per organisation; append-only audit log, but it never records before/after (`tg_op` compared in lower case); posted entries can be reopened through "reversed" | RLS, append-only events, tested |
| Verdict | **Mock-up.** UK-specific; exports on the accountant page are broken; company name hardcoded as "Golden Recruit LMT" | **Prototype with a sound skeleton.** Not yet usable as a company's books under bokføringsloven | Production-ready sub-ledger, not a general ledger |

Ledgera also lacks: a gap-free voucher series per company, period close and year-end close (its balance sheet does not balance without a manual closing entry), protection of vouchers (bilag) from deletion, retention, customer and supplier ledgers, bank reconciliation, årsregnskap, næringsspesifikasjon, aksjonærregisteroppgave, A-melding and the system documentation (systemdokumentasjon) bokføringsforskriften requires. It sits on its own Supabase project, so nothing in FlyttGo reaches it today.

## Norwegian rules that shape the product

- **MVA terms:** six two-month terms a year (due 10 April, 10 June, 31 August, 10 October, 10 December, 10 February). A yearly term only for turnover under NOK 1 million, on application. There is no six-month term.
- **Yearly:** aksjonærregisteroppgave (31 January), skattemelding for næring with næringsspesifikasjon (31 May), årsregnskap to Regnskapsregisteret (31 July, for AS). Monthly A-melding when there are employees.
- **Bookkeeping:** records kept 5 years; vouchers numbered and kept unaltered; SAF-T Financial on request from Skatteetaten (format 1.30); documentation of the system.
- **Doing the books for other companies is a regulated profession.** Under regnskapsførerloven, keeping accounts for others needs authorisation from Finanstilsynet. Selling software in which each company keeps its own books does not. So "an accountant included" can be offered in two lawful ways only: software the company (or its own accountant) uses, or the service of an authorised accounting firm FlyttGo partners with.
- **Filing for a company** is signed by the company or by its authorised accountant (ID-porten, Maskinporten, Altinn roles), not by FlyttGo.

## Advice

1. **Don't promise "tax documents ready every 6 months" yet.** Neither system produces documents a company can file, and the terms are two-monthly and yearly.
2. **At launch (transport first): connect, don't build.** FlyttGo's invoices, payments, credit notes, Stripe fees and payouts go automatically into an approved Norwegian accounting system the company already uses or chooses (Fiken, Tripletex or PowerOffice: their APIs; or SAF-T import). This is the "Accounting export" already listed as the next integration in [`SERVICE_PLATFORM.md`](SERVICE_PLATFORM.md). It gives companies complete books from day one and leaves MVA-melding and the yearly filings to tools that already file them.
3. **"Accountant at a special price":** partner with an authorised accounting firm (or several) that works in that system, and sell it as a bundle on the plan: FlyttGo's software plus the firm's fixed monthly fee. FlyttGo invoices its own part; the firm contracts with the company. That is lawful and quick, and the firm signs the filings.
4. **Ledgera as FlyttGo's own product: later, as its own project.** It is worth keeping and it has the right skeleton, but it needs, in order:
   - **unchangeable books:** close the reopen paths, add a reversal flow, number vouchers per company without gaps, add period and year-end close, and protect vouchers;
   - **automatic posting:** from FlyttGo's invoice engine and Stripe, over a signed API between the two projects;
   - **correct filing data:** a SAF-T 1.30 file that passes the XSD, and an MVA-melding on the standard codes with its signs right;
   - **filing:** submission through Skatteetaten's API with ID-porten or Maskinporten;
   - **yearly reports:** the annual accounts and the næringsspesifikasjon;
   - **paperwork and an independent check:** the system documentation, and an authorised accountant's review before any company relies on it.

   That is months of work, not a launch item.
5. **Fast Man & Van:** treat its accountant page as a design sketch only. If that business needs real books in the UK, the same advice holds: connect to an MTD-recognised system (Xero, QuickBooks, FreeAgent) rather than file from the page.

## What "legal review" and "accountant review" mean in the other documents

People, not software agents: a Norwegian lawyer for the terms and the data processing agreement, and an authorised accountant (regnskapsfører or revisor) for the invoices, numbering and how they reach the books. An AI agent can prepare checklists and drafts for them, but cannot take the professional responsibility those reviews exist for.
