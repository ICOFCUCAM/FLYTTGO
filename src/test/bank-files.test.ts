// Bank files (supabase/functions/_shared/bank-files.ts). The files under
// fixtures/bank are MADE-UP SAMPLES built for these tests: no bank produced
// them and no account, agreement or person in them is real.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BankFileError, decodeBankFile, parseBankFile, parseCamt, parseNetsOcr, pastedBankFile, rowsForDatabase, sha256Hex,
} from '../../supabase/functions/_shared/bank-files.ts';

const sample = (name: string) => readFileSync(new URL(`./fixtures/bank/${name}`, import.meta.url), 'utf8');
const OCR = sample('made-up-nets-ocr.txt');
const CAMT054 = sample('made-up-camt054.xml');
const CAMT053 = sample('made-up-camt053.xml');

/** The sample's records, to break one field at a time. */
const records = OCR.split('\r\n').filter(Boolean);
const withRecord = (i: number, change: (r: string) => string) => records.map((r, j) => (j === i ? change(r) : r)).join('\n');
const put = (r: string, pos: number, s: string) => r.slice(0, pos - 1) + s + r.slice(pos - 1 + s.length);
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(BankFileError); return (e as Error).message; } throw new Error('accepted'); };

describe('Nets OCR giro', () => {
  const file = parseNetsOcr(OCR);

  it('reads every transaction: settlement date, amount in øre, KID, a stable reference', () => {
    expect(file.format).toBe('nets_ocr');
    expect(file.rows).toHaveLength(5);
    expect(file.rows[0]).toMatchObject({
      line: 3, paid_on: '2026-10-31', amount: 1200, kid: '000000018', currency: 'NOK', kid_source: 'structured',
      reversal: false, account: '12345678903', bank_reference: 'nets:000123456:0001234:0000001',
    });
    expect(file.rows[0].reference).toBe(file.rows[0].bank_reference);
    expect(file.rows[0].info).toContain('archive reference 200104105');
    expect(file.rows[0].info).toContain('ordered 2026-10-29');
    expect(file.rows[1]).toMatchObject({ amount: 500, kid: '000000026' });
    expect(file.rows[2]).toMatchObject({ amount: 750, kid: '123456782' });
  });

  it('keeps the free text of a giro with text (record 32), and marks reversals', () => {
    expect(file.rows[3]).toMatchObject({ amount: 300, kid: '', kid_source: 'none' });
    expect(file.rows[3].info).toContain('Faktura 3 flytting Bergen');
    expect(file.rows[4]).toMatchObject({ amount: 25, kid: '000000018', reversal: true });
  });

  it('records the transmission and assignment', () => {
    expect(file.details).toMatchObject({
      dataSender: '00008080', transmissionNumber: '0170604', transactions: 5, sum: 2725,
      assignments: [{ agreement: '000123456', assignment: '0001234', account: '12345678903', transactions: 5, sum: 2725 }],
    });
  });

  it('refuses a file that does not follow the record layout, with the line and the reason', () => {
    expect(refusal(() => parseNetsOcr(withRecord(2, r => r.slice(0, 79))))).toMatch(/line 3: an OCR record is 80 characters, this one is 79/);
    expect(refusal(() => parseNetsOcr(records.slice(1).join('\n')))).toMatch(/line 1: .*start-of-transmission record \(10\)/);
    expect(refusal(() => parseNetsOcr(records.slice(0, -1).join('\n')))).toMatch(/end-of-transmission record \(89\)/);
    expect(refusal(() => parseNetsOcr(withRecord(2, r => put(r, 16, '310226'))))).toMatch(/line 3: settlement date "310226" is not a date/);
    expect(refusal(() => parseNetsOcr(withRecord(2, r => put(r, 5, '42'))))).toMatch(/unknown transaction type 42/);
    expect(refusal(() => parseNetsOcr(withRecord(2, r => put(r, 32, '+'))))).toMatch(/sign must be 0 or -/);
    expect(refusal(() => parseNetsOcr(withRecord(2, r => put(r, 77, '1234'))))).toMatch(/positions 77–80 must be filler/);
    expect(refusal(() => parseNetsOcr(withRecord(2, r => put(r, 50, 'ABC'))))).toMatch(/KID must be digits/);
    expect(refusal(() => parseNetsOcr(withRecord(3, r => put(r, 9, '0000009'))))).toMatch(/line 4: amount item 2 must have the transaction type and number/);
    expect(refusal(() => parseNetsOcr(records.filter((_, i) => i !== 3).join('\n')))).toMatch(/line 4: amount item 1 \(30\) must be followed by amount item 2/);
    expect(refusal(() => parseNetsOcr(withRecord(1, r => put(r, 3, '00'))))).toMatch(/line 2: record 20 must have service code 09/);
  });

  it('checks the counts and sums of the assignment and the transmission', () => {
    const end88 = records.length - 2;
    expect(refusal(() => parseNetsOcr(withRecord(end88, r => put(r, 9, '00000004'))))).toMatch(/states 4 transactions, it has 5/);
    expect(refusal(() => parseNetsOcr(withRecord(end88, r => put(r, 17, '00000012'))))).toMatch(/states 12 records, it has 13/);
    expect(refusal(() => parseNetsOcr(withRecord(end88, r => put(r, 25, '00000000000272501'))))).toMatch(/assignment states a sum of 272501 øre/);
    expect(refusal(() => parseNetsOcr(withRecord(records.length - 1, r => put(r, 17, '00000016'))))).toMatch(/transmission states 16 records, it has 15/);
    // A record 32 belongs to giros with text only.
    const text32 = records.findIndex(r => r.slice(6, 8) === '32');
    const moved = [...records];
    moved.splice(text32, 1);
    moved.splice(4, 0, put(records[text32], 5, '10').replace(/^(.{8})0000004/, '$10000001'));
    expect(refusal(() => parseNetsOcr(moved.join('\n')))).toMatch(/only for transaction types 20 and 21, not 10/);
  });
});

describe('camt.054 credit notification', () => {
  const file = parseCamt(CAMT054);

  it('takes booked credits only, one row per transaction', () => {
    expect(file.format).toBe('camt054');
    expect(file.rows).toHaveLength(5);
    expect(file.details).toMatchObject({ messageId: 'SAMPLE-054-20261031-0001', accounts: ['NO9312345678903'], entries: 6,
                                         skipped: { debits: 1, notBooked: 1 } });
  });

  it('reads amount, currency, booking date, structured KID and the bank\'s reference', () => {
    expect(file.rows[0]).toMatchObject({
      paid_on: '2026-10-31', amount: 1200, currency: 'NOK', kid: '000000018', kid_source: 'structured', payer: 'Eksempel Bedrift AS',
      bank_reference: 'camt:NO9312345678903:SAMPLE20261031000123-A', reversal: false, account: 'NO9312345678903',
    });
    // No reference of its own: the entry's, with its position in the entry.
    expect(file.rows[1]).toMatchObject({ amount: 500, kid: '000000026', payer: 'Prøve & Sønn AS',
                                         bank_reference: 'camt:NO9312345678903:SAMPLE20261031000123/2' });
  });

  it('finds a KID written in the message only when it is one valid MOD10 number', () => {
    expect(file.rows[2]).toMatchObject({ amount: 300, kid: '000000034', kid_source: 'text' });
    expect(parseCamt(CAMT054.replace('KID 000000034', 'KID 000000034 or 000000026')).rows[2]).toMatchObject({ kid: '', kid_source: 'none' });
    expect(parseCamt(CAMT054.replace('KID 000000034', 'KID 000000035')).rows[2].kid).toBe('');
  });

  it('lists other currencies and reversals with their details', () => {
    expect(file.rows[3]).toMatchObject({ currency: 'EUR', amount: 100, kid: '000000026' });
    expect(file.rows[4]).toMatchObject({ reversal: true, amount: 25, kid: '000000018' });
  });

  it('lists a credit without any bank reference, which the database then never matches on its own', () => {
    const noRef = CAMT054.replace('<AcctSvcrRef>SAMPLE20261031000124</AcctSvcrRef>', '');
    expect(parseCamt(noRef).rows[2].bank_reference).toBe('');
  });

  it('refuses what is not a camt.054 or camt.053, and XML with a DOCTYPE', () => {
    expect(refusal(() => parseCamt('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><Document/>'))).toMatch(/DOCTYPE/);
    expect(refusal(() => parseCamt('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.02"><BkToCstmrAcctRpt/></Document>'))).toMatch(/camt\.052/);
    expect(refusal(() => parseCamt(CAMT054.replace('camt.054.001.02', 'camt.053.001.02')))).toMatch(/does not match/);
    expect(refusal(() => parseCamt(CAMT054.replace('</Ntfctn>', '')))).toMatch(/malformed XML/);
    expect(refusal(() => parseCamt(CAMT054.replace('<Amt Ccy="NOK">300.00</Amt>', '<Amt Ccy="NOK">3,00</Amt>')))).toMatch(/"3,00" is not an amount/);
    expect(refusal(() => parseCamt(CAMT054.replace('<Amt Ccy="NOK">300.00</Amt>', '<Amt>300.00</Amt>')))).toMatch(/no currency/);
  });
});

describe('camt.053 statement', () => {
  it('reads prefixed elements, an account by BBAN and a booking time', () => {
    const file = parseCamt(CAMT053);
    expect(file.format).toBe('camt053');
    expect(file.rows).toEqual([expect.objectContaining({
      paid_on: '2026-10-31', amount: 1200, kid: '000000018', payer: 'Eksempel Bedrift AS', account: '12345678903',
      bank_reference: 'camt:12345678903:SAMPLE-STMT-REF-1',
    })]);
    expect(file.details).toMatchObject({ skipped: { debits: 1, notBooked: 0 } });
  });
});

describe('recognising, decoding and fingerprinting a file', () => {
  it('tells the formats apart and refuses anything else', () => {
    expect(parseBankFile(OCR).format).toBe('nets_ocr');
    expect(parseBankFile('\uFEFF' + CAMT054).format).toBe('camt054');
    expect(parseBankFile(CAMT053).format).toBe('camt053');
    expect(refusal(() => parseBankFile('29.10.2026;1200,00;000000018;NETS-1'))).toMatch(/not a Nets OCR file/);
  });

  it('gives pasted rows the same shape, their reference kept as pasted', () => {
    const file = pastedBankFile('Dato;Beløp;KID;Referanse\n29.10.2026;1 200,00;000000018;NETS-1');
    expect(file.rows).toEqual([{ line: 1, paid_on: '2026-10-29', amount: 1200, kid: '000000018', reference: 'NETS-1',
      bank_reference: 'NETS-1', currency: 'NOK', kid_source: 'pasted', reversal: false, payer: null, account: null, info: null }]);
  });

  it('prepares the rows for the database without empty references', () => {
    const db = rowsForDatabase(parseCamt(CAMT054.replace('<AcctSvcrRef>SAMPLE20261031000124</AcctSvcrRef>', '')));
    expect(db[2].bank_reference).toBeNull();
    expect(Object.keys(db[0]).sort()).toEqual(['account', 'amount', 'bank_reference', 'currency', 'info', 'kid', 'kid_source',
                                               'line', 'paid_on', 'payer', 'reversal']);
  });

  it('reads ISO-8859-1 text as Nets writes it, and hashes with SHA-256', async () => {
    expect(decodeBankFile(new Uint8Array([0x46, 0x6c, 0x79, 0x74, 0x74, 0x69, 0x6e, 0x67, 0x20, 0xe6, 0xf8, 0xe5]))).toBe('Flytting æøå');
    expect(decodeBankFile(new TextEncoder().encode('Flytting æøå'))).toBe('Flytting æøå');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
