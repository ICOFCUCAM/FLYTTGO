# Invoicing

FlyttGo issues invoices itself, with its own invoice system (owner's decision, 2026-10-29). Step 5 of the corporate plan. Migration `supabase/migrations/00008_invoicing.sql`, rollback `supabase/rollback/00008_down.sql`.

**Not applied or deployed.** It follows the same procedure as the rest: [`SECURITY_P0.md`](SECURITY_P0.md) §5 and [`COPY_OF_PRODUCTION_TEST_PLAN.md`](COPY_OF_PRODUCTION_TEST_PLAN.md).

## What it does

| Capability | How |
|---|---|
| **Legal invoices** (bokføringsforskriften § 5-1-1) | Each invoice states: number, invoice date, delivery date or period, seller and buyer with organisation numbers ("MVA" when VAT-registered, "Foretaksregisteret"), lines with quantity, price excl. VAT and VAT rate, VAT per rate, totals, due date, bank account, KID. The seller's details come from the invoice settings; an invoice can't be issued until they're filled in. |
| **Numbering without gaps** | A number is given only when an invoice is issued, from one counter in the database. A discarded draft uses no number. Credit notes share the series. |
| **Issued means final** | No role can change or delete an issued invoice or its lines, the database owner included (trigger). Corrections are **credit notes**, for all or part of an invoice. Payments, reminders and the invoice log are append-only. |
| **Company bookings on invoice** | `book-on-invoice` prices the booking on the server, as for card and Vipps. The database then checks: the company is active, the caller is its owner, admin or booker, FlyttGo has switched invoicing on, the credit limit (open invoices plus booked, not yet invoiced), and the credit check if that setting is on. The booking is then paid on invoice and dispatched like a paid one; no capture is needed. |
| **Invoice run** (daily, or "Run invoicing now") | Invoices completed bookings on invoice, per booking or monthly as each company chose. A monthly invoice covers the previous month (samlefaktura). A late cancellation is invoiced for its fee under the Terms. Each invoice is issued and emailed as PDF with the EHF file. |
| **Payment terms per company** | 14 days, 30 days, any number of days up to 60, or a fixed day (1–28) of the following month. Chosen by the company's owner, admin or finance, along with the invoicing cycle and the reference printed on invoices ("Deres ref."). |
| **KID** | The invoice number in eight digits with a MOD10 check digit. Bank payments are matched by KID: paste the bank's rows (date;amount;KID;reference), and a bank transaction is never counted twice. Payments can also be recorded by hand. Never more than is owed. |
| **Reminders** | An unpaid invoice gets a reminder each time the set number of days passes after its due date, at most two. The fee (`invoice_reminder_fee`) and interest (`invoice_late_interest_pct`, simple interest since the due date) come from the settings, are added to what's owed and are stated on the reminder. After two reminders it's handled by hand (inkasso). |
| **Documents** | PDF (A4, Norwegian labels, `_shared/invoice-pdf.ts`) and **EHF** (Peppol BIS Billing 3.0 / UBL 2.1, `_shared/invoices.ts`) for every invoice and credit note. Members with access download them; they're attached to every email. |
| **Branding on the special plan** | A company on the special price plan gets its registered name and logo at the head of its invoices. The legal seller (FlyttGo) stays stated in the footer ("Utstedt av FlyttGo AS for …"). The logo is a PNG or JPEG of at most 1 MB, in a private bucket under the company's folder. |
| **Credit check (dormant)** | Fully built and off. It applies only when an administrator ticks **Require credit check** in the invoice settings. Then invoicing can't be switched on for a company without a passed check, and bookings on invoice need one no older than `credit_check_max_age_days` (default 365). Results come from a provider adapter (`credit-check`, none connected yet) or an administrator's manual assessment with its evidence. |
| **Export** | CSV for the accountant (semicolons, decimal commas, one row per invoice). |
| **Who sees what** | Invoices, lines, payments and reminders: the company's owners, admins and finance, plus FlyttGo administrators. Bookers and viewers don't see them. Drafts are FlyttGo's only. The invoice log and credit checks: FlyttGo administrators only. |

## Where

| | |
|---|---|
| Company | Corporate dashboard → **Invoices**: outstanding, overdue, paid this year; invoices with PDF and EHF; payment terms and cycle; logo. **Payment page**: "Corporate Invoice" for company bookings. |
| FlyttGo | Admin → **Invoicing**: run, ledger and its actions (issue, delete draft, PDF, EHF, send, payment, reminder, credit note), manual invoices, bank file, CSV, settings and the credit-check switch. Admin → **Companies**: Invoicing… (on/off, credit limit, plan), Credit check. |
| Server | `book-on-invoice`, `invoice-run`, `invoice-document`, `invoice-send`, `credit-check`. Shared: `_shared/invoices.ts`, `invoice-pdf.ts`, `invoice-data.ts`. |

## Before the first real invoice

1. **Invoice settings:** FlyttGo's legal name, organisation number, address, bank account (and IBAN/BIC for foreign payers), invoice email, MVA registration.
2. **Reminder fee and interest:** set them only after checking the current legal limits: the reminder fee under inkassoforskriften, the late-payment interest rate the Ministry of Finance sets (forsinkelsesrente), and compensation for business debtors under forsinkelsesrenteloven. Both are empty or 0 until set.
3. **Accountant:** have them confirm the invoice content, the numbering series, the CSV export and how invoices move into the books. Issued invoices are accounting records and must be kept for 5 years (bokføringsloven). The rollback warns about this.
4. **Schedule `invoice-run` daily:** `supabase/ops/schedules.sql` ([`SCHEDULES.md`](SCHEDULES.md)).
5. **Secrets:** `RESEND_API_KEY`, `FLYTTGO_FROM` (an invoice sender address on a verified domain), `FLYTTGO_REPLY_TO`.

## White-label plans

The invoice run also bills companies' white-label plans (set-up, monthly fee, and for Model B what FlyttGo kept from customer payments, recorded as paid at once). See [`WHITE_LABEL.md`](WHITE_LABEL.md) → Plans and prices.

## Integration points (not connected)

- **Sending EHF through Peppol.** The EHF file is complete, but sending it into a customer's accounting system needs a Peppol access point (a provider agreement). Until then EHF is attached to the email and downloadable.
- **Credit provider.** Add an adapter in `credit-check/index.ts` (for example Creditsafe, Dun & Bradstreet, Experian), set `credit_check_provider` and the secret `CREDIT_CHECK_API_KEY`.
- **Bank.** Payments are matched from pasted bank rows. Automatic import (an OCR file from Nets, or camt.054 via the bank's API) is the next step.

## Tests

- `supabase/tests/invoicing.test.sql`, on both schemas and on PostgreSQL 16 and 17.6:
  - preferences and who sets them;
  - booking on invoice: server only, switches, credit check on and off, credit limit;
  - issuing: legal content, KID, 30-day due date, no gaps after a deleted draft, final for every role;
  - who reads invoices;
  - payments, KID matching and duplicates;
  - part and full credit notes;
  - reminders with fee and interest;
  - the invoice run's selection, per booking and monthly;
  - logo storage.
- `src/test/invoices.test.ts`: KID (matches SQL), due dates, cancellation fees, EHF invoice and credit note, CSV, Norwegian formats, bank rows.
- The PDF layout was rendered and checked by eye.
