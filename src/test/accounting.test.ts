import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDoc, DOC_KINDS, openItems, taxLines, type BooksData } from '../accounting/documents/build';
import { bandRange, STRINGS } from '../accounting/i18n';
import { renderDocx } from '../accounting/render/docx';
import { renderPdf } from '../accounting/render/pdf';
import { crc32, zip } from '../accounting/render/zip';
import { buildSaft, partyId } from '../accounting/saft';
import type { Account, MvaCode, VoucherLine, Voucher } from '../accounting/types';

const ledger = {
  id: 'L1', tenant_id: 'T1', status: 'active' as const, legal_name: 'Oslo Rør og Varme AS', org_number: '923609016', vat_registered: true,
  mva_term: 'bimonthly' as const, zero_rate_code: '6' as const, start_date: '2025-01-01', auto_post: true, locked_until: null,
  monthly_fee: null, declared_turnover: null, decided_at: '2025-01-01T10:00:00Z', created_at: '2025-01-01T10:00:00Z', cancel_at: null, cancel_reason: null,
};
const acc = (code: string, name: string, cat: string | null, g: string | null): Account =>
  ({ ledger_id: 'L1', code, name, default_mva_code: null, grouping_category: cat, grouping_code: g, active: true });
const accounts = [
  acc('1500', 'Kundefordringer', 'balanseverdiForOmloepsmiddel', '1500'), acc('1920', 'Bankinnskudd', 'balanseverdiForOmloepsmiddel', '1920'),
  acc('2400', 'Leverandørgjeld', 'kortsiktigGjeld', '2400'), acc('2700', 'Utgående merverdiavgift, høy sats', 'kortsiktigGjeld', '2740'),
  acc('2710', 'Inngående merverdiavgift, høy sats', 'kortsiktigGjeld', '2740'), acc('3000', 'Salgsinntekt, avgiftspliktig, høy sats', 'salgsinntekt', '3000'),
  acc('6810', 'Data/EDB-kostnad', 'annenDriftskostnad', '6995'),
];
const mvaCodes: MvaCode[] = [
  { code: '1', direction: 'input', rate: 25, description: 'Fradrag for inngående mva, høy sats', sort: 10 },
  { code: '3', direction: 'output', rate: 25, description: 'Utgående mva, høy sats', sort: 30 },
];
const v = (id: string, n: number, date: string, d: string, src = 'manual'): Voucher =>
  ({ id, ledger_id: 'L1', year: 2025, number: n, voucher_date: date, description: d, source_type: src, source_id: null, reverses_voucher: null, posted_by: 'u1', posted_at: `${date}T09:00:00Z` });
const l = (voucher: string, no: number, account: string, debit: number, credit: number, mva: string | null = null, role: 'basis' | 'vat' | null = null, party: string | null = null): VoucherLine =>
  ({ id: `${voucher}-${no}`, voucher_id: voucher, line_no: no, account_code: account, debit, credit, mva_code: mva, mva_role: role, description: null, party, ref: null });
const vouchers = [v('a', 1, '2025-03-10', 'Faktura 1 · Kari Nordmann', 'invoice'), v('b', 2, '2025-03-12', 'Programvare fra Leverandør AS'), v('c', 3, '2025-03-20', 'Innbetaling faktura 1', 'payment')];
const lines = [
  l('a', 1, '1500', 1250, 0, null, null, 'Kari Nordmann'), l('a', 2, '3000', 0, 1000, '3', 'basis', 'Kari Nordmann'), l('a', 3, '2700', 0, 250, '3', 'vat', 'Kari Nordmann'),
  l('b', 1, '6810', 800, 0, '1', 'basis', 'Leverandør AS'), l('b', 2, '2710', 200, 0, '1', 'vat', 'Leverandør AS'), l('b', 3, '2400', 0, 1000, null, null, 'Leverandør AS'),
  l('c', 1, '1920', 1000, 0), l('c', 2, '1500', 0, 1000, null, null, 'Kari Nordmann'),
];
const ledgerRows = lines.map(x => {
  const vv = vouchers.find(y => y.id === x.voucher_id)!;
  return { voucher_id: vv.id, voucher_no: `${vv.year}-${vv.number}`, voucher_date: vv.voucher_date, description: vv.description, account_code: x.account_code,
           debit: x.debit, credit: x.credit, mva_code: x.mva_code, line_description: null, party: x.party };
});
const sums = (code: string) => lines.filter(x => x.account_code === code).reduce((s, x) => ({ d: s.d + x.debit, c: s.c + x.credit }), { d: 0, c: 0 });
const trial = accounts.map(a => { const s = sums(a.code); return { account_code: a.code, account_name: a.name, opening: 0, debit: s.d, credit: s.c, closing: s.d - s.c }; });
const data: BooksData = {
  ledger, accounts, from: '2025-01-01', to: '2025-12-31', trial, ledgerRows, vouchers, lines,
  income: [{ grp: '1 Driftsinntekter', account_code: '3000', account_name: 'Salgsinntekt', amount: 1000 }, { grp: '2 Driftskostnader', account_code: '6810', account_name: 'Data/EDB-kostnad', amount: -800 }],
  balance: [{ grp: '1 Eiendeler', account_code: '1500', account_name: 'Kundefordringer', amount: 250 }, { grp: '1 Eiendeler', account_code: '1920', account_name: 'Bankinnskudd', amount: 1000 },
            { grp: '2 Egenkapital', account_code: null, account_name: 'Resultat som ikke er disponert', amount: 200 },
            { grp: '3 Gjeld', account_code: '2400', account_name: 'Leverandørgjeld', amount: 1000 }, { grp: '3 Gjeld', account_code: '2700', account_name: 'Utg. mva', amount: 250 },
            { grp: '3 Gjeld', account_code: '2710', account_name: 'Inng. mva', amount: -200 }],
  checks: [{ check_name: 'Every voucher balances', ok: true, detail: '0 unbalanced' }],
  mva: [[2, [{ mva_code: '1', description: 'Fradrag for inngående mva, høy sats', direction: 'input', rate: 25, basis: 800, mva: 200, term_from: '2025-03-01', term_to: '2025-04-30' },
             { mva_code: '3', description: 'Utgående mva, høy sats', direction: 'output', rate: 25, basis: 1000, mva: 250, term_from: '2025-03-01', term_to: '2025-04-30' }]]],
  receivablesAccount: '1500', payablesAccount: '2400',
};
const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

describe('accounting: files', () => {
  it('crc32 matches the reference value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('zip has local headers, a central directory and the end record', () => {
    const z = zip([{ name: 'a.txt', data: 'hello' }, { name: 'mappe/ø.txt', data: 'å' }]);
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(dv.getUint16(z.length - 22 + 10, true)).toBe(2);
  });
  it('a PDF in both languages, with Norwegian letters in WinAnsi', () => {
    for (const lang of ['en', 'no'] as const) {
      const pdf = text(renderPdf(buildDoc('annual', data, lang)));
      expect(pdf.startsWith('%PDF-1.4')).toBe(true);
      expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
      expect(pdf).toContain('/Encoding /WinAnsiEncoding');
      expect(pdf).toContain('\\305rsregnskap');   // Å as WinAnsi 0xC5
    }
  });
  it('the xref offsets point at their objects', () => {
    const pdf = text(renderPdf(buildDoc('journal', data, 'no')));
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    const offsets = pdf.slice(xref).split('\n').slice(3).filter(r => / n $/.test(r)).map(r => Number(r.slice(0, 10)));
    offsets.forEach((o, i) => expect(pdf.slice(o, o + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });
  it('negative numbers survive in the PDF (the Norwegian minus sign is written as a hyphen)', () => {
    const pdf = text(renderPdf(buildDoc('balance', data, 'no')));
    expect(pdf).toContain('-200,00');
    expect(pdf).not.toContain('?200,00');
  });
  it('a Word file is a ZIP with the document, its styles and footer', () => {
    const docx = text(renderDocx(buildDoc('trial', data, 'no')));
    for (const part of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/footer1.xml', 'docProps/core.xml']) expect(docx).toContain(part);
    expect(docx).toContain('<w:tblHeader/>');
  });
  it('every document builds in both languages', () => {
    for (const k of DOC_KINDS) for (const lang of ['en', 'no'] as const) {
      const d = buildDoc(k.kind, data, lang, 2);
      expect(d.title.length).toBeGreaterThan(0);
      expect(renderPdf(d).length).toBeGreaterThan(500);
      expect(renderDocx(d).length).toBeGreaterThan(500);
    }
  });
});

describe('accounting: price bands', () => {
  it('ranges read as half-open bands', () => {
    expect(bandRange(0, 1_000_000, 'en')).toBe('under 1,000,000');
    expect(bandRange(1_000_000, 5_000_000, 'en')).toBe('1,000,000 to under 5,000,000');
    expect(bandRange(100_000_000, null, 'en')).toBe('100,000,000 and above');
    expect(bandRange(5_000_000, 20_000_000, 'no').replace(/\s/g, ' ')).toBe('5 000 000 til under 20 000 000');
  });
});

describe('accounting: wording', () => {
  it('English and Norwegian have the same keys, none empty', () => {
    expect(Object.keys(STRINGS.no).sort()).toEqual(Object.keys(STRINGS.en).sort());
    for (const lang of ['en', 'no'] as const) for (const [k, s] of Object.entries(STRINGS[lang])) expect(s, `${lang}.${k}`).not.toBe('');
  });
});

describe('accounting: documents', () => {
  it('the MVA basis sums output less input', () => {
    const d = buildDoc('mva', data, 'en', 2);
    const facts = d.blocks.find(b => b.kind === 'facts');
    expect(facts && facts.kind === 'facts' && facts.items.map(i => i[1])).toEqual(['250.00', '200.00', '50.00']);
  });
  it('customer and supplier balances come from the receivables and payables lines', () => {
    expect(openItems(data, '1500')).toEqual([{ party: 'Kari Nordmann', balance: 250 }]);
    expect(openItems(data, '2400')).toEqual([{ party: 'Leverandør AS', balance: -1000 }]);
  });
  it('the næringsspesifikasjon basis groups accounts by Skatteetaten code', () => {
    const t = taxLines(data);
    expect(t.find(x => x.code === '2740')?.accounts.sort()).toEqual(['2700', '2710']);
    expect(t.find(x => x.code === '3000')?.amount).toBe(-1000);
    expect(t.find(x => x.code === '6995')?.text.no).toContain('Kontorrekvisita');
  });
});

describe('accounting: SAF-T 1.30', () => {
  const xml = buildSaft({
    ledger, company: { street: 'Verkstedveien 4', city: 'Oslo', postalCode: '0277', contactFirstName: 'Ola', contactLastName: 'Nordmann', email: 'post@oslorr.no' },
    software: { company: 'FlyttGo AS', id: 'FlyttGo Regnskap', version: '1.0' }, from: '2025-01-01', to: '2025-12-31',
    accounts, trial, vouchers, lines, ledgerRows, mvaCodes, receivablesAccount: '1500', payablesAccount: '2400', created: '2026-01-15',
  });
  it('totals balance and parties have stable IDs', () => {
    expect(xml).toContain('<TotalDebit>3250.00</TotalDebit><TotalCredit>3250.00</TotalCredit>');
    expect(partyId('K', 'Kari Nordmann')).toBe(partyId('K', ' kari nordmann '));
    expect(xml).toContain(`<CustomerID>${partyId('K', 'Kari Nordmann')}</CustomerID>`);
  });
  it('MVA lines carry the tax base and amount', () => {
    expect(xml).toContain('<TaxCode>3</TaxCode><TaxPercentage>25.00</TaxPercentage><TaxBase>1000.00</TaxBase><CreditTaxAmount><Amount>250.00</Amount></CreditTaxAmount>');
    expect(xml).toContain('<TaxCode>1</TaxCode><TaxPercentage>25.00</TaxPercentage><TaxBase>800.00</TaxBase><DebitTaxAmount><Amount>200.00</Amount></DebitTaxAmount>');
  });
  const xsd = join(__dirname, '../accounting/data/saft/Norwegian_SAF-T_Financial_Schema_v_1.30.xsd');
  const hasXmllint = (() => { try { execFileSync('xmllint', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  it.skipIf(!hasXmllint || !existsSync(xsd))('validates against Skatteetaten\'s XSD', () => {
    const dir = mkdtempSync(join(tmpdir(), 'saft-'));
    const file = join(dir, 'saft.xml');
    writeFileSync(file, xml);
    expect(() => execFileSync('xmllint', ['--noout', '--schema', xsd, file], { stdio: 'pipe' })).not.toThrow();
  });
});
