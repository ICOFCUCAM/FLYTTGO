# FlyttGo's company details on the website

Owner's decision, 2026-10-30 (platform audit, "Placeholder legal identity"; `DECISIONS.md` #56).

The footer, the top bar of the header and the contact page used to show placeholders: "Org. nr. NO 000 000 000", "NO 000 000 000 MVA", a UK phone number (+44) and an office address nobody had confirmed. They now show FlyttGo's real details, taken from the same settings the invoices use, and nothing invented while a setting is empty.

## Where the owner fills them in

**Admin → Invoicing → Invoice settings** (the seller's details, migration 00008). Save, and the website shows them on the next page load.

| Setting (`platform_config`) | Shown on the website | While empty |
|---|---|---|
| Legal name (`invoice_seller_name`) | Footer → Company; the © line | The Company block is hidden (unless the organisation number is set); the © line says "FlyttGo" |
| Organisation number (`invoice_seller_org_number`) | Footer → Company ("Org. nr. 123 456 789") | Hidden |
| "FlyttGo is registered for MVA" (`invoice_seller_vat_registered`) | Footer → MVA: "MVA registered · NO 123 456 789 MVA", or "Not registered for MVA" | The MVA block is hidden until the organisation number is set |
| Street address, postcode and city (`invoice_seller_address`, `invoice_seller_postcode_city`) | Footer contact lines; the Office card on the contact page (with a map link) | Hidden (no Office card) |
| Invoice email (`invoice_seller_email`) | Footer contact and Support lines; the Email card on the contact page | `support@flyttgo.no` (FlyttGo's own domain) |
| Phone (`invoice_seller_phone`) | Header top bar, footer, the Phone and WhatsApp cards on the contact page (as `tel:` and `wa.me` links), the WhatsApp button | **+47 000 00 000** as plain text, never a link; the contact cards say "Number to be published" and the WhatsApp button opens the contact page (owner, 2026-10-30) |

The bank account, IBAN and BIC are never shown: the website reads the details through `flyttgo_public_identity()` (migration 00026), which returns only the fields above. Nothing else of `platform_config` is readable without an administrator account.

The same settings must be filled in before the first invoice can be issued anyway (`issue_invoice` refuses without name, organisation number, address and bank account), so filling them in once serves both.

## Code

- `supabase/migrations/00026_contact_messages.sql`: `flyttgo_public_identity()` (anyone may call it); rolled back by `supabase/rollback/00026_down.sql`.
- `src/lib/companyIdentity.ts`: loads the details once per page view; `displayPhone()` (placeholder or real number), `mvaNumber()`, `formatOrgNumber()`.
- `src/components/Footer.tsx`, `src/components/Header.tsx`, `src/pages/ContactPage.tsx`.
- Tests: `supabase/tests/contact_messages.test.sql` (empty settings give empty fields; never the bank details), `src/test/audit-fixes.test.tsx` (footer hides empty lines and shows set ones).

## Not changed here

- The structured data in `index.html` no longer states a telephone, street address, opening hours or rating; add the real address and phone there by hand once they are set (it is static HTML, not read from the settings).
- The Terms' contact section (§13) reads the legal name, organisation number and phone from the same settings (the +44 number is gone). Otherwise the legal pages (Terms, Privacy, Liability, Driver terms) were not edited: they still name `support@flyttgo.com` / `legal@flyttgo.com` and wait for the lawyer's review (`DECISIONS.md` → Still to do).
