/**
 * SAF-T Financial (Norway) version 1.30: the file Skatteetaten asks a
 * company for (mandatory format for accounting periods from 1 January
 * 2025). Built from the books for a period and checked against
 * Skatteetaten's XSD (src/accounting/data/saft/, tested).
 *
 * Accounts carry their GroupingCategory/GroupingCode from the
 * næringsspesifikasjon list; the MVA codes are the standard tax codes, so
 * TaxCode and StandardTaxCode are the same. Customers and suppliers are the
 * names on the receivables and payables lines (the books keep no separate
 * register of them yet), each with a stable ID derived from the name.
 */
import type { Account, Ledger, LedgerRow, MvaCode, TrialRow, Voucher, VoucherLine } from './types';

export const SAFT_VERSION = '1.30';

export interface SaftInput {
  ledger: Ledger;
  company: { street?: string | null; city?: string | null; postalCode?: string | null; contactFirstName?: string | null; contactLastName?: string | null; email?: string | null; phone?: string | null };
  software: { company: string; id: string; version: string };
  from: string; to: string;
  accounts: Account[];
  trial: TrialRow[];
  vouchers: Voucher[];
  lines: VoucherLine[];
  ledgerRows: LedgerRow[];
  mvaCodes: MvaCode[];
  receivablesAccount: string;
  payablesAccount: string;
  created?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const amt = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);
const el = (name: string, value: string | number | null | undefined, max = 256) =>
  value === null || value === undefined || value === '' ? '' : `<${name}>${esc(cut(String(value), max))}</${name}>`;

/** A stable ID for a party name: the same name gives the same ID in every file. */
export function partyId(prefix: string, name: string): string {
  let h = 2166136261;
  for (const ch of name.trim().toLowerCase()) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619) >>> 0; }
  return `${prefix}${h.toString(36).toUpperCase().padStart(7, '0')}`;
}

function balanceElems(prefix: 'Opening' | 'Closing', v: number): string {
  return v >= 0 ? `<${prefix}DebitBalance>${amt(v)}</${prefix}DebitBalance>` : `<${prefix}CreditBalance>${amt(-v)}</${prefix}CreditBalance>`;
}

export function buildSaft(x: SaftInput): string {
  const year = Number(x.to.slice(0, 4));
  const fromMonth = Number(x.from.slice(5, 7)), toMonth = Number(x.to.slice(5, 7));
  const fromYear = Number(x.from.slice(0, 4));
  const created = x.created ?? new Date().toISOString().slice(0, 10);
  const trial = new Map(x.trial.map(r => [r.account_code, r]));
  const orgNr = (x.ledger.org_number ?? '').replace(/\D/g, '');

  // Parties on the receivables and payables lines.
  const parties = (account: string, prefix: string) => {
    const m = new Map<string, { id: string; name: string; opening: number; closing: number }>();
    for (const r of x.ledgerRows.filter(l => l.account_code === account && l.party)) {
      const p = m.get(r.party!) ?? { id: partyId(prefix, r.party!), name: r.party!, opening: 0, closing: 0 };
      p.closing += Number(r.debit) - Number(r.credit);
      m.set(r.party!, p);
    }
    return [...m.values()];
  };
  const customers = parties(x.receivablesAccount, 'K');
  const suppliers = parties(x.payablesAccount, 'L');
  const customerId = new Map(customers.map(c => [c.name, c.id]));
  const supplierId = new Map(suppliers.map(s => [s.name, s.id]));

  const address = `<Address>${el('StreetName', x.company.street || '-', 70)}${el('City', x.company.city || '-', 35)}`
    + `${el('PostalCode', x.company.postalCode || '-', 9)}<Country>NO</Country></Address>`;
  const contact = `<Contact><ContactPerson>${el('FirstName', x.company.contactFirstName || '-', 35)}${el('LastName', x.company.contactLastName || '-', 35)}</ContactPerson>`
    + `${el('Telephone', x.company.phone, 18)}${el('Email', x.company.email, 70)}</Contact>`;

  const header = '<Header>'
    + `<AuditFileVersion>${SAFT_VERSION}</AuditFileVersion><AuditFileCountry>NO</AuditFileCountry><AuditFileDateCreated>${created}</AuditFileDateCreated>`
    + el('SoftwareCompanyName', x.software.company, 70) + el('SoftwareID', x.software.id, 70) + el('SoftwareVersion', x.software.version, 18)
    + `<Company>${el('RegistrationNumber', orgNr || '000000000', 35)}${el('Name', x.ledger.legal_name, 70)}${address}${contact}`
    + (x.ledger.vat_registered && orgNr ? `<TaxRegistration><TaxRegistrationNumber>${orgNr}MVA</TaxRegistrationNumber><TaxAuthority>Skatteetaten</TaxAuthority></TaxRegistration>` : '')
    + '</Company>'
    + '<DefaultCurrencyCode>NOK</DefaultCurrencyCode>'
    + `<SelectionCriteria><PeriodStart>${fromMonth}</PeriodStart><PeriodStartYear>${fromYear}</PeriodStartYear><PeriodEnd>${toMonth}</PeriodEnd><PeriodEndYear>${year}</PeriodEndYear></SelectionCriteria>`
    + '<TaxAccountingBasis>A</TaxAccountingBasis>'
    + '</Header>';

  const accounts = x.accounts.filter(a => trial.has(a.code) || a.active).map(a => {
    const r = trial.get(a.code);
    const opening = Number(r?.opening ?? 0), closing = Number(r?.closing ?? 0);
    return `<Account>${el('AccountID', a.code, 70)}${el('AccountDescription', a.name, 256)}`
      + `${el('GroupingCategory', a.grouping_category ?? 'mangler', 256)}${el('GroupingCode', a.grouping_code ?? '0', 70)}`
      + `<AccountType>GL</AccountType>${balanceElems('Opening', opening)}${balanceElems('Closing', closing)}</Account>`;
  }).join('');

  const party = (tag: 'Customer' | 'Supplier', p: { id: string; name: string; opening: number; closing: number }, account: string) =>
    `<${tag}>${el('Name', p.name, 70)}<Address><City>-</City><Country>NO</Country></Address>`
    + `${el(tag + 'ID', p.id, 35)}<BalanceAccount>${el('AccountID', account, 70)}${balanceElems('Opening', p.opening)}${balanceElems('Closing', p.closing)}</BalanceAccount></${tag}>`;

  const usedCodes = new Set(x.lines.map(l => l.mva_code).filter(Boolean) as string[]);
  const taxTable = '<TaxTable><TaxTableEntry><TaxType>MVA</TaxType><Description>Merverdiavgift</Description>'
    + x.mvaCodes.filter(c => usedCodes.has(c.code)).map(c =>
      `<TaxCodeDetails>${el('TaxCode', c.code, 9)}${el('Description', c.description, 256)}<TaxPercentage>${amt(Number(c.rate))}</TaxPercentage>`
      + `<Country>NO</Country>${el('StandardTaxCode', c.code, 9)}<BaseRate>100</BaseRate></TaxCodeDetails>`).join('')
    + '</TaxTableEntry></TaxTable>';

  const masterFiles = `<MasterFiles><GeneralLedgerAccounts>${accounts}</GeneralLedgerAccounts>`
    + (customers.length ? `<Customers>${customers.map(c => party('Customer', c, x.receivablesAccount)).join('')}</Customers>` : '')
    + (suppliers.length ? `<Suppliers>${suppliers.map(s => party('Supplier', s, x.payablesAccount)).join('')}</Suppliers>` : '')
    + (usedCodes.size ? taxTable : '') + '</MasterFiles>';

  const codes = new Map(x.mvaCodes.map(c => [c.code, c]));
  const vouchers = x.vouchers.filter(v => v.voucher_date >= x.from && v.voucher_date <= x.to);
  let totalDebit = 0, totalCredit = 0;
  const transactions = vouchers.map(v => {
    const lines = x.lines.filter(l => l.voucher_id === v.id);
    // The MVA line carries the amount; its basis line carries the base.
    const vatOf = (l: VoucherLine) => lines.find(o => o.mva_role === 'vat' && o.mva_code === l.mva_code && o.line_no === l.line_no + 1);
    const out = lines.map(l => {
      const debit = Number(l.debit), credit = Number(l.credit);
      totalDebit += debit; totalCredit += credit;
      const c = l.mva_code ? codes.get(l.mva_code) : undefined;
      let tax = '';
      if (c && l.mva_role === 'basis') {
        const vat = vatOf(l);
        const vatAmt = vat ? Number(vat.debit) + Number(vat.credit) : 0;
        const side = (vat ? Number(vat.debit) > 0 : debit > 0) ? 'Debit' : 'Credit';
        tax = `<TaxInformation><TaxType>MVA</TaxType>${el('TaxCode', c.code, 9)}<TaxPercentage>${amt(Number(c.rate))}</TaxPercentage>`
          + `<TaxBase>${amt(debit + credit)}</TaxBase><${side}TaxAmount><Amount>${amt(vatAmt)}</Amount></${side}TaxAmount></TaxInformation>`;
      }
      const cust = l.account_code === x.receivablesAccount && l.party ? el('CustomerID', customerId.get(l.party), 35) : '';
      const supp = l.account_code === x.payablesAccount && l.party ? el('SupplierID', supplierId.get(l.party), 35) : '';
      return `<Line>${el('RecordID', String(l.line_no), 35)}${el('AccountID', l.account_code, 70)}${el('ValueDate', v.voucher_date)}`
        + `${cust}${supp}${el('Description', l.description || v.description, 256)}`
        + (debit > 0 ? `<DebitAmount><Amount>${amt(debit)}</Amount></DebitAmount>` : `<CreditAmount><Amount>${amt(credit)}</Amount></CreditAmount>`)
        + tax + '</Line>';
    }).join('');
    return `<Transaction>${el('TransactionID', `${v.year}-${v.number}`, 70)}<Period>${Number(v.voucher_date.slice(5, 7))}</Period><PeriodYear>${v.year}</PeriodYear>`
      + `<TransactionDate>${v.voucher_date}</TransactionDate>${el('SourceID', v.posted_by ?? 'system', 35)}`
      + `<TransactionType>${v.source_type === 'year_end' ? 'Year-end' : 'Normal'}</TransactionType>`
      + `${el('Description', v.description, 256)}<SystemEntryDate>${v.posted_at.slice(0, 10)}</SystemEntryDate><GLPostingDate>${v.voucher_date}</GLPostingDate>`
      + out + '</Transaction>';
  }).join('');

  const entries = `<GeneralLedgerEntries><NumberOfEntries>${vouchers.length}</NumberOfEntries><TotalDebit>${amt(totalDebit)}</TotalDebit><TotalCredit>${amt(totalCredit)}</TotalCredit>`
    + (vouchers.length ? `<Journal><JournalID>GL</JournalID><Description>Hovedbok</Description><Type>GL</Type>${transactions}</Journal>` : '')
    + '</GeneralLedgerEntries>';

  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<AuditFile xmlns="urn:StandardAuditFile-Taxation-Financial:NO" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + header + masterFiles + entries + '</AuditFile>\n';
}

/** Skatteetaten's file name: SAF-T Financial_<org.nr>_<yyyyMMddHHmmss>.xml */
export function saftFileName(orgNumber: string | null, at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `SAF-T Financial_${(orgNumber ?? '').replace(/\D/g, '') || '000000000'}_${ts}.xml`;
}
