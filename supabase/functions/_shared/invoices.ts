// ============================================================================
// FlyttGo — invoices: shared rules and formats (docs/INVOICING.md)
// ============================================================================
//
// The database (migration 00008) numbers, issues and settles invoices;
// this module holds what the functions and the app compute from them:
//   kidMod10()      KID check digit, the same as SQL kid_mod10()
//   dueDate()       due date from a company's terms, as SQL invoice_due_date()
//   cancellationFeeLines()  what a cancelled booking on invoice is charged
//   ehfXml()        EHF / Peppol BIS Billing 3.0 (UBL 2.1) invoice or credit note
//   invoicesCsv()   export for the accountant
//
// No Deno or network imports, so the Vitest suite (src/test/invoices.test.ts)
// runs them.
// ============================================================================

import { cancellationShare } from './pricing.ts';

export interface Party {
  name: string | null; org_number: string | null; address?: string | null; postcode_city?: string | null;
  email?: string | null; phone?: string | null; country?: string | null; vat_registered?: boolean;
  bank_account?: string | null; iban?: string | null; bic?: string | null; customer_number?: number | null;
}
export interface InvoiceLine {
  line_no: number; description: string; quantity: number; unit_price: number; vat_rate: number;
  net_amount: number; vat_amount: number; total: number;
}
export interface Invoice {
  id: string; kind: 'invoice' | 'credit_note'; number: number; credits_number?: number | null;
  issue_date: string; due_date: string; delivery_from?: string | null; delivery_to?: string | null;
  currency: string; kid: string | null; reference?: string | null; notes?: string | null;
  seller: Party; buyer: Party; branding?: { name?: string; logo_path?: string | null } | null;
  net_total: number; vat_total: number; total: number;
  amount_paid?: number; amount_credited?: number; fees_total?: number; status?: string; reminder_level?: number;
}

/** KID with a MOD10 (Luhn) check digit, as Norwegian banks verify it. */
export function kidMod10(base: string): string {
  if (!/^\d+$/.test(base)) throw new Error('KID base must be digits');
  let sum = 0;
  let double = true;
  for (let i = base.length - 1; i >= 0; i--) {
    let d = Number(base[i]);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return base + String((10 - (sum % 10)) % 10);
}

export function isValidKid(kid: string): boolean {
  return /^\d{2,25}$/.test(kid) && kidMod10(kid.slice(0, -1)) === kid;
}

/** Due date (YYYY-MM-DD) from the issue date and the company's terms. */
export function dueDate(issue: string, terms: { type: 'days' | 'day_of_month'; days: number; day?: number | null }): string {
  const [y, m, d] = issue.split('-').map(Number);
  const date = terms.type === 'day_of_month'
    ? new Date(Date.UTC(y, m, terms.day ?? 1))            // next month, given day (m is 0-based next month)
    : new Date(Date.UTC(y, m - 1, d + terms.days));
  return date.toISOString().slice(0, 10);
}

/**
 * What a cancelled booking on invoice is charged: the part of the price
 * the cancellation policy keeps (Terms §6.1: nothing more than 24 hours
 * before pickup, 50% within 24 hours, nothing when FlyttGo or the driver
 * cancelled). Whole øre.
 */
export function cancellationFee(b: {
  price: number; cancelled_by?: string | null; cancelled_at?: string | null; move_date?: string | null; move_time?: string | null;
}): number {
  const keep = 1 - cancellationShare(b);
  return Math.round(b.price * keep * 100) / 100;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const orgNo = (n: string | null | undefined) => String(n ?? '').replace(/\D/g, '');

function party(tag: 'AccountingSupplierParty' | 'AccountingCustomerParty', p: Party): string {
  const no = orgNo(p.org_number);
  const country = p.country || 'NO';
  const [postcode, ...city] = String(p.postcode_city ?? '').trim().split(/\s+/);
  return `<cac:${tag}><cac:Party>
<cbc:EndpointID schemeID="0192">${esc(no)}</cbc:EndpointID>
<cac:PartyName><cbc:Name>${esc(p.name)}</cbc:Name></cac:PartyName>
<cac:PostalAddress>${p.address ? `<cbc:StreetName>${esc(p.address)}</cbc:StreetName>` : ''}${
    city.length ? `<cbc:CityName>${esc(city.join(' '))}</cbc:CityName>` : ''}${
    postcode && city.length ? `<cbc:PostalZone>${esc(postcode)}</cbc:PostalZone>` : ''}<cac:Country><cbc:IdentificationCode>${esc(country)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
${p.vat_registered ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(country)}${esc(no)}MVA</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
<cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName><cbc:CompanyID schemeID="0192">${esc(no)}</cbc:CompanyID></cac:PartyLegalEntity>
${p.email ? `<cac:Contact><cbc:ElectronicMail>${esc(p.email)}</cbc:ElectronicMail></cac:Contact>` : ''}
</cac:Party></cac:${tag}>`;
}

/**
 * EHF invoice or credit note (Peppol BIS Billing 3.0, UBL 2.1), the
 * format Norwegian businesses and the public sector receive electronic
 * invoices in. Sending it needs a Peppol access point (an integration
 * point, docs/INVOICING.md); the file itself is complete.
 */
export function ehfXml(inv: Invoice, lines: InvoiceLine[]): string {
  const credit = inv.kind === 'credit_note';
  const root = credit ? 'CreditNote' : 'Invoice';
  const sign = credit ? -1 : 1;                           // UBL credit notes carry positive amounts
  const byRate = new Map<number, { net: number; vat: number }>();
  for (const l of lines) {
    const r = byRate.get(l.vat_rate) ?? { net: 0, vat: 0 };
    r.net += sign * l.net_amount; r.vat += sign * l.vat_amount;
    byRate.set(l.vat_rate, r);
  }
  const taxCategory = (rate: number) => rate > 0 ? 'S' : 'Z';
  const lineTag = credit ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyTag = credit ? 'CreditedQuantity' : 'InvoicedQuantity';
  const ns = credit ? 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2' : 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="${ns}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
<cbc:ID>${inv.number}</cbc:ID>
<cbc:IssueDate>${inv.issue_date}</cbc:IssueDate>
${credit ? '' : `<cbc:DueDate>${inv.due_date}</cbc:DueDate>`}
<cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>${credit ? 381 : 380}</cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>
${inv.notes ? `<cbc:Note>${esc(inv.notes)}</cbc:Note>` : ''}
<cbc:DocumentCurrencyCode>${esc(inv.currency)}</cbc:DocumentCurrencyCode>
<cbc:BuyerReference>${esc(inv.reference || inv.buyer.customer_number || 'n/a')}</cbc:BuyerReference>
${inv.delivery_from ? `<cac:InvoicePeriod><cbc:StartDate>${inv.delivery_from}</cbc:StartDate><cbc:EndDate>${inv.delivery_to ?? inv.delivery_from}</cbc:EndDate></cac:InvoicePeriod>` : ''}
${credit && inv.credits_number ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${inv.credits_number}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>` : ''}
${party('AccountingSupplierParty', inv.seller)}
${party('AccountingCustomerParty', inv.buyer)}
${credit ? '' : `<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>${inv.kid ? `<cbc:PaymentID>${esc(inv.kid)}</cbc:PaymentID>` : ''}<cac:PayeeFinancialAccount><cbc:ID>${esc(inv.seller.iban || orgNo(inv.seller.bank_account))}</cbc:ID>${inv.seller.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${esc(inv.seller.bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}</cac:PayeeFinancialAccount></cac:PaymentMeans>`}
<cac:TaxTotal><cbc:TaxAmount currencyID="${esc(inv.currency)}">${amt(sign * inv.vat_total)}</cbc:TaxAmount>
${[...byRate.entries()].map(([rate, r]) => `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${esc(inv.currency)}">${amt(r.net)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${esc(inv.currency)}">${amt(r.vat)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${taxCategory(rate)}</cbc:ID><cbc:Percent>${rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`).join('\n')}
</cac:TaxTotal>
<cac:LegalMonetaryTotal>
<cbc:LineExtensionAmount currencyID="${esc(inv.currency)}">${amt(sign * inv.net_total)}</cbc:LineExtensionAmount>
<cbc:TaxExclusiveAmount currencyID="${esc(inv.currency)}">${amt(sign * inv.net_total)}</cbc:TaxExclusiveAmount>
<cbc:TaxInclusiveAmount currencyID="${esc(inv.currency)}">${amt(sign * inv.total)}</cbc:TaxInclusiveAmount>
${credit ? '' : `<cbc:PrepaidAmount currencyID="${esc(inv.currency)}">${amt(inv.amount_paid ?? 0)}</cbc:PrepaidAmount>`}
<cbc:PayableAmount currencyID="${esc(inv.currency)}">${amt(sign * inv.total - (credit ? 0 : inv.amount_paid ?? 0))}</cbc:PayableAmount>
</cac:LegalMonetaryTotal>
${lines.map(l => `<cac:${lineTag}><cbc:ID>${l.line_no}</cbc:ID><cbc:${qtyTag} unitCode="EA">${l.quantity}</cbc:${qtyTag}><cbc:LineExtensionAmount currencyID="${esc(inv.currency)}">${amt(sign * l.net_amount)}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${esc(l.description)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${taxCategory(l.vat_rate)}</cbc:ID><cbc:Percent>${l.vat_rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="${esc(inv.currency)}">${amt(sign * l.unit_price)}</cbc:PriceAmount></cac:Price></cac:${lineTag}>`).join('\n')}
</${root}>
`;
}

/** Semicolon-separated (as Norwegian Excel expects), decimal comma, one row per invoice. */
export function invoicesCsv(rows: Array<Invoice & { organization_name?: string }>): string {
  const n = (v: number | undefined) => amt(v ?? 0).replace('.', ',');
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Number', 'Type', 'Issue date', 'Due date', 'Customer', 'Org. number', 'Net', 'VAT', 'Total', 'Paid', 'Credited', 'Fees', 'KID', 'Status'];
  return [head.join(';'), ...rows.map(r => [
    r.number, r.kind === 'credit_note' ? 'Credit note' : 'Invoice', r.issue_date, r.due_date,
    q(r.buyer?.name ?? r.organization_name), q(r.buyer?.org_number), n(r.net_total), n(r.vat_total), n(r.total),
    n(r.amount_paid), n(r.amount_credited), n(r.fees_total), r.kid ?? '', r.status ?? '',
  ].join(';'))].join('\r\n') + '\r\n';
}

/** "1 234,50 kr" */
export function nok(n: number): string {
  const s = (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
  const [i, d] = s.split(',');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${d} kr`;
}

/** Bank account as written in Norway: 1234.56.78903 */
export function formatBankAccount(a: string | null | undefined): string {
  const d = String(a ?? '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : String(a ?? '');
}

/** Bank file rows (date;amount;KID;reference), as exported from a Norwegian bank, semicolon or comma separated. */
export function parseBankRows(text: string): Array<{ paid_on: string; amount: number; kid: string; reference: string }> {
  const out: Array<{ paid_on: string; amount: number; kid: string; reference: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^date|^dato/i.test(line)) continue;
    const parts = line.split(';').length >= 3 ? line.split(';') : line.split(',');
    if (parts.length < 3) continue;
    const [d, a, kid, ref] = parts.map(p => p.trim().replace(/^"|"$/g, ''));
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d);
    const paid_on = m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    const amount = Number(a.replace(/\s/g, '').replace(',', '.'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paid_on) || !Number.isFinite(amount) || amount <= 0) continue;
    out.push({ paid_on, amount, kid: kid.replace(/\s/g, ''), reference: ref || `${paid_on}-${kid}-${amount}` });
  }
  return out;
}
