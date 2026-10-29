# Invoicing

FlyttGo issues invoices itself, with its own invoice system (owner's decision, 2026-10-29). Step 5 of the corporate plan. Migration `supabase/migrations/00008_invoicing.sql`, rollback `supabase/rollback/00008_down.sql`.

**Not applied or deployed.** It follows the same procedure as the rest: [`SECURITY_P0.md`](SECURITY_P0.md) §5 and [`COPY_OF_PRODUCTION_TEST_PLAN.md`](COPY_OF_PRODUCTION_TEST_PLAN.md).

Bank import ([below](#bank-import)) is migration `00016_bank_import.sql`, rollback `supabase/rollback/00016_down.sql`, and the `bank-import` function. **Not applied or deployed.**

## What it does

| Capability | How |
|---|---|
| **Legal invoices** (bokføringsforskriften § 5-1-1) | Each invoice states: number, invoice date, delivery date or period, seller and buyer with organisation numbers ("MVA" when VAT-registered, "Foretaksregisteret"), lines with quantity, price excl. VAT and VAT rate, VAT per rate, totals, due date, bank account, KID. The seller's details come from the invoice settings; an invoice can't be issued until they're filled in. |
| **Numbering without gaps** | A number is given only when an invoice is issued, from one counter in the database. A discarded draft uses no number. Credit notes share the series. |
| **Issued means final** | No role can change or delete an issued invoice or its lines, the database owner included (trigger). Corrections are **credit notes**, for all or part of an invoice. Payments, reminders and the invoice log are append-only. |
| **Company bookings on invoice** | `book-on-invoice` prices the booking on the server, as for card and Vipps. The database then checks: the company is active, the caller is its owner, admin or booker, FlyttGo has switched invoicing on, the credit limit (open invoices plus booked, not yet invoiced), and the credit check if that setting is on. The booking is then paid on invoice and dispatched like a paid one; no capture is needed. |
| **Invoice run** (daily, or "Run invoicing now") | Invoices completed bookings on invoice, per booking or monthly as each company chose. A monthly invoice covers the previous month (samlefaktura). A late cancellation is invoiced for its fee under the Terms. Each invoice is issued and emailed as PDF with the EHF file. |
| **Payment terms per company** | 14 days, 30 days, any number of days up to 60, or a fixed day (1–28) of the following month. Chosen by the company's owner, admin or finance, along with the invoicing cycle and the reference printed on invoices ("Deres ref."). |
| **KID** | The invoice number in eight digits with a MOD10 check digit. Bank payments are matched by KID: import the bank's file (Nets OCR giro, camt.054 or camt.053; [Bank import](#bank-import)) or paste the bank's rows (date;amount;KID;reference), and a bank transaction is never counted twice. Payments can also be recorded by hand. Never more than is owed. |
| **Reminders** | An unpaid invoice gets a reminder each time the set number of days passes after its due date, at most two. The fee (`invoice_reminder_fee`) and interest (`invoice_late_interest_pct`, simple interest since the due date) come from the settings, are added to what's owed and are stated on the reminder. After two reminders it's handled by hand (inkasso). |
| **Documents** | PDF (A4, Norwegian labels, `_shared/invoice-pdf.ts`) and **EHF** (Peppol BIS Billing 3.0 / UBL 2.1, `_shared/invoices.ts`) for every invoice and credit note. Members with access download them; they're attached to every email. |
| **Branding on the special plan** | A company on the special price plan gets its registered name and logo at the head of its invoices. The legal seller (FlyttGo) stays stated in the footer ("Utstedt av FlyttGo AS for …"). The logo is a PNG or JPEG of at most 1 MB, in a private bucket under the company's folder. |
| **Credit check (dormant)** | Fully built and off. It applies only when an administrator ticks **Require credit check** in the invoice settings. Then invoicing can't be switched on for a company without a passed check, and bookings on invoice need one no older than `credit_check_max_age_days` (default 365). Results come from a provider adapter (`credit-check`, none connected yet) or an administrator's manual assessment with its evidence. |
| **Export** | CSV for the accountant (semicolons, decimal commas, one row per invoice). |
| **Who sees what** | Invoices, lines, payments and reminders: the company's owners, admins and finance, plus FlyttGo administrators. Bookers and viewers don't see them. Drafts are FlyttGo's only. The invoice log and credit checks: FlyttGo administrators only. |

## Where

| | |
|---|---|
| Company | Corporate dashboard → **Invoices**: outstanding, overdue, paid this year; invoices with PDF and EHF; payment terms and cycle; logo. **Payment page**: "Corporate Invoice" for company bookings. **Invoices to customers → Bank file**: the company's own bank file for its own invoices. |
| FlyttGo | Admin → **Invoicing**: run, ledger and its actions (issue, delete draft, PDF, EHF, send, payment, reminder, credit note), manual invoices, pasted bank rows, bank file (Nets OCR, camt.054), CSV, settings and the credit-check switch. Admin → **Companies**: Invoicing… (on/off, credit limit, plan), Credit check. |
| Server | `book-on-invoice`, `invoice-run`, `invoice-document`, `invoice-send`, `credit-check`, `bank-import`. Shared: `_shared/invoices.ts`, `invoice-pdf.ts`, `invoice-data.ts`, `bank-files.ts`. |

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
- **Bank.** Bank files are imported by hand today (upload, or pasted rows). The automatic fetch is built up to the adapter: there is no bank or Nets agreement, so none is connected ([Bank import → Automatic fetch](#automatic-fetch-what-an-agreement-must-provide)).

## Bank import

Migration `00016_bank_import.sql`; parsers in `supabase/functions/_shared/bank-files.ts` (the browser and the `bank-import` function use the same code); upload in Admin → Invoicing → **Bank file** and in the company's **Invoices to customers → Bank file** (`src/components/invoicing/BankFileImport.tsx`).

| | |
|---|---|
| **Formats** | **Nets OCR giro**: fixed 80-character records, start and end of transmission (10/89) and of each assignment (20/88), transactions as amount items 1 and 2 (30/31), and 3 (32, the free text of types 20 and 21). Every record is checked against the layout (length, format code NY, service codes, digits, dates, filler), each 30 must be followed by its 31 with the same type and number, and the counts and sums of every assignment and of the transmission must agree; otherwise the whole file is refused with the line and the reason. **ISO 20022 camt.054** (credit notification) and **camt.053** (statement), any `.001.xx` version: booked credits (`CRDT`, `BOOK`) with amount, currency, booking date, the structured creditor reference (KID) or the remittance text, the payer's name and the bank's reference. Debits and entries not yet booked are skipped and counted; a camt.052 report, XML with a DOCTYPE, and malformed XML are refused. Files up to 10 MB, UTF-8 or ISO-8859-1. |
| **Rows** | The same shape as the pasted rows (date, amount, KID, reference) plus a stable bank reference: `nets:<agreement>:<assignment>:<transaction>` for OCR, `camt:<account>:<the bank's AcctSvcrRef>` for camt (the entry's reference with the transaction's position when a batch entry has several). Pasted rows keep the reference as pasted. A KID found only in the free text is used when it is the one MOD10-valid number there. |
| **Preview, then confirm** | Choosing a file shows what each row will do before anything is recorded: matched to invoice *n* (and what it owes), already recorded, already imported, not matched (and why), or more than owed. Confirming imports it and shows the result and the rows left open. |
| **Never counted twice** | The bank reference is the key. A reference already recorded as a payment, by any file, the paste path or by hand, is not counted again; a reference already imported (open or set aside) is not listed again; the same file (SHA-256) is not imported twice into a series. A payment of the same amount on the same day to the same invoice that arrived another way (another file format, the paste path or by hand) is held as a *possible duplicate* for a person to decide. Imports in one series run one at a time. |
| **Never more than is owed** | A row for more than the invoice still owes, or for a paid invoice, is refused as an overpayment and left open: refund the payer, or record it against another invoice. |
| **Who** | FlyttGo's administrators import for FlyttGo's own invoices only. A company's owners, admins and finance import for the company's own series only, while the company is active; a KID is matched only within that series, so FlyttGo's invoice 1 and a company's invoice 1 never match each other's payments. FlyttGo's administrators read a company's imports but do not import into its books. Bookers, viewers and other companies see nothing. The server (service role) imports for either. |
| **Records** | `bank_imports`: who, when, format, source (upload, paste, fetch), file name, SHA-256, the file's own details (transmission number, message id, accounts) and the counts. `bank_import_rows`: each credit with its outcome, reason, invoice and payment. Both are kept as imported: no role changes or deletes them, the database owner included. |
| **Open rows** | Rows not matched or more than owed stay under *To handle by hand* until someone records the row against an invoice of the series (by number, with a note; the bank's reference goes with it, so it is still counted once) or sets it aside with a reason (refunded, not ours). Reversals and payments in other currencies are handled by hand, never recorded against an invoice. |
| **Paste path** | Kept. Pasted rows are imported like a file (format "Pasted rows"), so their outcomes are kept and the same rules apply; on a database without 00016 the paste path records row by row as before (`record_payment_by_kid`). |
| **Rollback** | `00016_down.sql` stops while any import is recorded (the record of what matched is part of the payments' audit trail); the payments themselves stay. It says how to save the records first. |

### Automatic fetch: what an agreement must provide

The structure is in place and connected to nothing: `bank_import_settings` holds, per series, the provider (`manual`, `nets_sftp`, `bank_api`), the agreement ID, the account and whether the fetch is on (it cannot be on with `manual`). The `bank-import` function takes a file from a signed-in administrator or company finance user, or from the service role key (for example from a relay that collects files from the bank), and with `{"action":"fetch"}` asks each provider's adapter for new files and imports them. No adapter exists, so a fetch only records "not connected". No bank endpoint is invented here. No scheduled job is added; when an adapter exists, add a `flyttgo-bank-import` job to `supabase/ops/schedules.sql` (with its test in `supabase/tests/schedules.test.sql`) calling `bank-import` with `{"action":"fetch"}`.

**Nets OCR giro** (through FlyttGo's bank, or each company's):

- An OCR giro agreement for the account receiving payments, with its agreement ID (avtale-ID, record 20) and the customer unit ID the files are addressed to.
- KID control: MOD10, fixed length 9 (the invoice number in eight digits plus the check digit, as issued today).
- Delivery: which channel (Nets' SFTP file transfer, or download in the bank's online bank), how often (each settlement, daily), file naming, how long files stay available, and whether a file can be delivered again.
- For SFTP: the host, port and host key, the user name, and FlyttGo's public SSH key registered with Nets. Supabase Edge Functions have no SFTP client of their own; the adapter needs one that runs in Deno, or a small relay outside Supabase that downloads the files and posts them to `bank-import` with the service role key.
- A test environment or sample files from Nets for the agreement, to check the parser against real files before the first import.

**camt.054 through the bank's API** (or host-to-host):

- A corporate API or file agreement for the account, the camt version (for example `camt.054.001.02` or `.001.08`), and whether it is pushed or fetched.
- Credentials: the OAuth client or certificates (often mutual TLS with an enterprise certificate), stored as function secrets (`BANK_IMPORT_API_KEY` or the like), never in the database.
- That OCR batch credits are itemised: one transaction (TxDtls) per payment with the KID in `CdtrRefInf/Ref`; a batch credited as one amount without itemisation cannot be matched by KID.
- Which reference is unique and stable per transaction (`AcctSvcrRef` is used; the entry's reference with the position otherwise).
- A test environment with sample notifications.

Choose one source per account: the same payments arriving by OCR and by camt.054 have different references, and the second would be held as possible duplicates.

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
- `supabase/tests/bank_import.test.sql`: preview and import, each outcome, never twice (same file, same rows in another file, the old paste path both ways, possible duplicates), never more than owed, open rows recorded or set aside, kept as imported, who imports and reads in FlyttGo's and a company's series, the server's fetch, the settings.
- `src/test/bank-files.test.ts`: the Nets OCR, camt.054 and camt.053 parsers on made-up sample files (`src/test/fixtures/bank/`, labelled as made up), and every refusal (record length, layout, dates, counts and sums, malformed XML, DOCTYPE, camt.052).
- The PDF layout was rendered and checked by eye.
