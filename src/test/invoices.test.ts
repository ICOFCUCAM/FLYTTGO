import { describe, expect, it } from 'vitest';
import {
  cancellationFee, dueDate, ehfXml, formatBankAccount, invoicesCsv, isValidKid, kidMod10, nok, parseBankRows,
  type Invoice, type InvoiceLine,
} from '../../supabase/functions/_shared/invoices.ts';

describe('KID', () => {
  it('matches the database (kid_mod10) and the banks\' MOD10', () => {
    expect(kidMod10('00000001')).toBe('000000018');            // invoice 1, as SQL issues it
    expect(kidMod10('1234567')).toBe('12345674');
    expect(isValidKid('000000018')).toBe(true);
    expect(isValidKid('000000019')).toBe(false);
  });
});

describe('due dates from the company\'s terms', () => {
  it('counts days, or takes a fixed day of the following month', () => {
    expect(dueDate('2026-10-29', { type: 'days', days: 14 })).toBe('2026-11-12');
    expect(dueDate('2026-10-29', { type: 'days', days: 30 })).toBe('2026-11-28');
    expect(dueDate('2026-12-20', { type: 'days', days: 30 })).toBe('2027-01-19');
    expect(dueDate('2026-10-29', { type: 'day_of_month', days: 14, day: 20 })).toBe('2026-11-20');
    expect(dueDate('2026-12-05', { type: 'day_of_month', days: 14, day: 1 })).toBe('2027-01-01');
  });
});

describe('cancellation fee on invoice (Terms §6.1)', () => {
  const b = { price: 2000, move_date: '2026-11-20', move_time: '09:00' };
  it('charges nothing early, half late, nothing when FlyttGo or the driver cancels', () => {
    expect(cancellationFee({ ...b, cancelled_by: 'customer', cancelled_at: '2026-11-18T08:00:00Z' })).toBe(0);
    expect(cancellationFee({ ...b, cancelled_by: 'customer', cancelled_at: '2026-11-20T07:00:00Z' })).toBe(1000);
    expect(cancellationFee({ ...b, cancelled_by: 'platform', cancelled_at: '2026-11-20T07:00:00Z' })).toBe(0);
  });
});

const seller = { name: 'FlyttGo AS', org_number: '923609016', address: 'Storgata 1', postcode_city: '0155 Oslo',
                 vat_registered: true, bank_account: '12345678903', email: 'faktura@flyttgo.no' };
const buyer = { name: 'Acme & Co AS', org_number: '974760673', address: 'Kaigata 2', postcode_city: '5016 Bergen',
                vat_registered: true, customer_number: 10001 };
const inv: Invoice = {
  id: 'i1', kind: 'invoice', number: 1, issue_date: '2026-10-29', due_date: '2026-11-28', currency: 'NOK', kid: '000000018',
  reference: 'PO-77', seller, buyer, net_total: 960, vat_total: 240, total: 1200, amount_paid: 0,
  delivery_from: '2026-10-28', delivery_to: '2026-10-28',
};
const lines: InvoiceLine[] = [{ line_no: 1, description: 'Moving service, booking 1a2b3c4d', quantity: 1, unit_price: 960,
                                vat_rate: 25, net_amount: 960, vat_amount: 240, total: 1200 }];

describe('EHF (Peppol BIS Billing 3.0)', () => {
  it('writes a complete invoice: parties with org numbers, KID, account, VAT per rate, totals', () => {
    const x = ehfXml(inv, lines);
    expect(x).toContain('<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>');
    expect(x).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
    expect(x).toContain('<cbc:EndpointID schemeID="0192">923609016</cbc:EndpointID>');
    expect(x).toContain('<cbc:CompanyID>NO974760673MVA</cbc:CompanyID>');
    expect(x).toContain('<cbc:Name>Acme &amp; Co AS</cbc:Name>');                 // escaped
    expect(x).toContain('<cbc:PaymentID>000000018</cbc:PaymentID>');
    expect(x).toContain('<cac:PayeeFinancialAccount><cbc:ID>12345678903</cbc:ID>');
    expect(x).toContain('<cbc:TaxableAmount currencyID="NOK">960.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="NOK">240.00</cbc:TaxAmount>');
    expect(x).toContain('<cbc:PayableAmount currencyID="NOK">1200.00</cbc:PayableAmount>');
    expect(x).toContain('<cbc:BuyerReference>PO-77</cbc:BuyerReference>');
  });

  it('writes a credit note with positive amounts and the invoice it credits', () => {
    const cn = ehfXml({ ...inv, kind: 'credit_note', number: 2, credits_number: 1, kid: null, net_total: -80, vat_total: -20, total: -100 },
                      [{ ...lines[0], unit_price: -80, net_amount: -80, vat_amount: -20, total: -100 }]);
    expect(cn).toContain('<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"');
    expect(cn).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(cn).toContain('<cac:InvoiceDocumentReference><cbc:ID>1</cbc:ID>');
    expect(cn).toContain('<cbc:PayableAmount currencyID="NOK">100.00</cbc:PayableAmount>');
    expect(cn).not.toContain('PaymentMeans');
  });
});

describe('exports and formats', () => {
  it('CSV for the accountant, semicolons and decimal commas', () => {
    const csv = invoicesCsv([{ ...inv, status: 'issued' }]);
    expect(csv.split('\r\n')[1]).toBe('1;Invoice;2026-10-29;2026-11-28;"Acme & Co AS";"974760673";960,00;240,00;1200,00;0,00;0,00;0,00;000000018;issued');
  });

  it('amounts and bank accounts as Norwegians write them', () => {
    expect(nok(1234.5)).toBe('1 234,50 kr');
    expect(formatBankAccount('12345678903')).toBe('1234.56.78903');
  });

  it('reads bank rows (Norwegian dates, decimal commas), skipping headers and junk', () => {
    expect(parseBankRows('Dato;Beløp;KID;Referanse\n29.10.2026;1 200,00;000000018;NETS-1\nnonsense\n2026-10-30,50.5,000000026,')).toEqual([
      { paid_on: '2026-10-29', amount: 1200, kid: '000000018', reference: 'NETS-1' },
      { paid_on: '2026-10-30', amount: 50.5, kid: '000000026', reference: '2026-10-30-000000026-50.5' },
    ]);
  });
});
