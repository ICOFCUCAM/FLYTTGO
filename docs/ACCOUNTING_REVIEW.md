# Accounting: review by an authorised accountant

Owner's decision (2026-10-29): an authorised accountant (registrert/statsautorisert revisor or autorisert regnskapsfører) reviews the accounting system before any pilot company relies on its reports or filings. Production migrations wait for this review and the controls below. This is the reviewer's checklist; each item names where to look and what the tests already show. **Schema validation and passing tests show structure and consistency; they do not by themselves show that the figures and tax classifications are correct. That is what this review is for.**

How to look: a test installation with the representative data (`supabase/tests/accounting_controls/data.sql`), the office (Regnskap) and the documents it produces in PDF, Word and SAF-T. System description: [`ACCOUNTING_CORE.md`](ACCOUNTING_CORE.md).

Record each item as **accepted**, **accepted with change** (say which) or **rejected**, with the reviewer's name, authorisation and date at the end.

## 1. Chart of accounts and tax-return grouping

- [ ] The standard chart (NS 4102 subset, 70 accounts) in `accounting.seed()` (`00014_accounting_core.sql`): names, which accounts are missing for the pilot companies' trades.
- [ ] Each account's næringsspesifikasjon grouping (category and code, Skatteetaten's 2025–2026 list). Judgement calls to confirm: 1230 Biler → 1205 (vans would be 1238); 1940/1941 payment providers → 1920 bank; 1700 prepaid expenses → 1570; 2900 → 2990; 6810 EDB → 6995; 7770 bank fees → 7700.
- [ ] Default MVA codes on expense accounts (1 on most purchases; none on insurance, representation, travel).

## 2. MVA

- [ ] **0 % sales: code 5 or code 6.** The setting `zero_rate_code` (default 6) decides how invoice lines at 0 % are reported. A zero-rated supply (fritatt, code 5), an exempt supply (unntatt) and a transaction outside the MVA Act (code 6) are not interchangeable; decide per pilot company and transaction type, and whether one setting per company is enough.
- [ ] Output MVA from invoices: one line per rate (3, 31, 33), net on 3000/3001/3002, MVA on 2700/2701/2702; credit notes reduce them (`accounting_post_invoice`, 00015).
- [ ] Input MVA on manual vouchers: the amount entered includes MVA and is split (`post_voucher`); rounding to øre per line.
- [ ] The MVA return per term and code: basis and MVA signed so credit notes reduce them (`mva_report`); two-monthly terms 1–6, yearly term on application only.
- [ ] Settlement to 2740 per term (`settle_mva`), and that a term is settled once.
- [ ] Reminder fees posted outside MVA (3900, code 6), late interest on 8050 without MVA.
- [ ] Not built yet, confirm acceptable for the pilot: reverse charge (codes 81, 86 …), import MVA, adjustments (justering), mixed use.

## 3. Bookkeeping rules (bokføringsloven, bokføringsforskriften)

- [ ] Voucher numbering: one gap-free series per ledger and year (`accounting.counters`); tested under 10 concurrent sessions.
- [ ] Postings cannot be changed or deleted, even by the database owner (triggers on vouchers, lines, receipts, events); a voucher must balance at commit and have two lines or more.
- [ ] Corrections: manual vouchers by reversal with a reason (`reverse_voucher`), invoices by credit note only.
- [ ] Period close (`lock_period`): nothing posted on or before the date afterwards, never reopened; a host event in a closed period is posted on the first open day; tested against concurrent posting.
- [ ] Year end (`close_year`): result to 2050 via 8800 on 31 December.
- [ ] Receipts (bilag): stored with SHA-256, never removed; manual vouchers without a receipt are flagged.
- [ ] Storage for 5 years; a rollback sets books aside instead of deleting them (tested).
- [ ] Audit trail: every action in `accounting.events` (append-only) with who and when.
- [ ] System documentation (§ 2-1) and whether `ACCOUNTING_CORE.md` with the migrations suffices as its basis.

## 4. Reports and documents

- [ ] Saldobalanse, hovedbok, bilagsjournal reconcile with each other (the trial balance totals equal; receivables equal the open invoices: tested).
- [ ] Resultatregnskap and Balanse: grouping, signs, the undisposed result line before year end.
- [ ] Årsregnskap draft: suitable as a basis for small enterprises (regnskapsloven), notes 1–3 and what more is required.
- [ ] Næringsspesifikasjon basis: amounts per code and sign convention; what the accountant adds (permanent and temporary differences).
- [ ] Kunde- and leverandørreskontro from the party names on 1500/2400 (no customer register yet: name changes split a party).
- [ ] Kontrolloppstilling: the checks are the right first look.
- [ ] Frister og innleveringer: the usual deadlines listed.

## 5. SAF-T Financial 1.30

- [ ] The file validates against Skatteetaten's XSD (tested), **and** its content represents the books: opening and closing balances per account, all transactions in the period, TaxInformation on basis lines (base and MVA amount), StandardTaxCode, customers and suppliers with stable IDs derived from names.
- [ ] Missing company details become "-" (address); acceptable or required before export.

## 6. Access

- [ ] The company grants access (accountant, bookkeeper, external auditor with an end date, viewer); removal kept with a reason; FlyttGo's administrators see no company's books (tested).

## 7. Regulatory position

- [ ] Confirm with a Norwegian professional that FlyttGo provides software in which each company keeps its own books (no authorisation needed), not bookkeeping services for others (regnskapsførerloven), for the exact service as sold; and which reporting obligations remain with the company.

## Sign-off

| | |
|---|---|
| Reviewer, authorisation | |
| Date | |
| Result | accepted / accepted with changes / rejected |
| Changes required | |
