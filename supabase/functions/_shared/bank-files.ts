// ============================================================================
// FlyttGo — bank files: Nets OCR giro and ISO 20022 camt.054 / camt.053
// ============================================================================
//
// Turns a bank file into the rows the payment matching takes (migration
// 00016, docs/INVOICING.md → Bank import): the same shape as the pasted
// rows of parseBankRows() in invoices.ts (date, amount, KID, reference),
// plus a stable bank reference that identifies the transaction, so that
// the database counts it once, whichever file or path it arrives by.
//
//   parseNetsOcr()    Nets OCR giro: fixed 80-character records 10/20/30/31
//                     (32)/88/89; record layout, counts and sums are checked
//   parseCamt()       camt.054 (credit notification) and camt.053 (statement):
//                     booked credit entries, structured reference (KID)
//   parseBankFile()   either, recognised from the content
//   pastedBankFile()  the pasted rows (date;amount;KID;reference) as a file
//   decodeBankFile()  bytes → text (UTF-8, else ISO-8859-1 as Nets writes)
//   sha256Hex()       the file's SHA-256, recorded with the import
//
// A file that does not follow its format is refused as a whole with the
// line and the reason (BankFileError); nothing in it is used. No Deno or
// network imports, so the browser and the Vitest suite
// (src/test/bank-files.test.ts) use the same code as the bank-import
// function.
// ============================================================================

import { isValidKid, parseBankRows } from './invoices.ts';

export type BankFileFormat = 'nets_ocr' | 'camt054' | 'camt053' | 'rows';

/** One credit as the matching takes it. reference = bank_reference (or, for
 *  pasted rows, what was pasted); kid is digits only, '' when there is none. */
export interface BankFileRow {
  line: number;                 // record line (OCR), entry/transaction position (camt), row (pasted)
  paid_on: string;              // YYYY-MM-DD: settlement (OCR) or booking date (camt)
  amount: number;               // NOK (or currency), positive; a reversal keeps its amount and sets reversal
  kid: string;
  reference: string;
  bank_reference: string;       // '' when the bank gave none: listed, never matched automatically
  currency: string;
  kid_source: 'structured' | 'text' | 'none' | 'pasted';
  reversal: boolean;
  payer: string | null;
  account: string | null;       // the credited account
  info: string | null;          // archive reference, free text, remittance information
}

export interface BankFile {
  format: BankFileFormat;
  rows: BankFileRow[];
  details: Record<string, unknown>;
}

export class BankFileError extends Error {
  constructor(message: string, public line?: number) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = 'BankFileError';
  }
}

const MAX_BYTES = 10 * 1024 * 1024;

/* ── Nets OCR giro ─────────────────────────────────────────────────────────
 * Nets' "OCR giro" system specification. Every record is 80 characters and
 * starts with format code NY; positions below are 1-based, inclusive.
 *
 *  10 start of transmission  3-4 service 00, 5-6 transmission type 00,
 *                            9-16 data sender, 17-23 transmission number,
 *                            24-31 data recipient, 32-80 filler
 *  20 start of assignment    3-4 service 09, 5-6 assignment type 00,
 *                            9-17 agreement ID, 18-24 assignment number,
 *                            25-35 assignment account, 36-80 filler
 *  30 amount item 1          5-6 transaction type, 9-15 transaction number,
 *                            16-21 settlement date DDMMYY, 22-23 centre ID,
 *                            24-25 day code, 26 partial settlement number,
 *                            27-31 serial number, 32 sign, 33-49 amount (øre),
 *                            50-74 KID (right-aligned), 75-76 card issuer,
 *                            77-80 filler
 *  31 amount item 2          9-15 transaction number, 16-25 form number,
 *                            26-34 archive reference, 35-41 filler,
 *                            42-47 order date DDMMYY, 48-58 debit account,
 *                            59-80 filler
 *  32 amount item 3          (types 20 and 21 only) 9-15 transaction number,
 *                            16-55 free text, 56-80 filler
 *  88 end of assignment      9-16 transactions, 17-24 records (with 20 and
 *                            88), 25-41 sum (øre), 42-47 settlement date,
 *                            48-53 first date, 54-59 last date, 60-80 filler
 *  89 end of transmission    9-16 transactions, 17-24 records (all, with 10
 *                            and 89), 25-41 sum (øre), 42-47 settlement
 *                            date, 48-80 filler
 */
const OCR_TYPES: Record<string, string> = {
  '10': 'Giro debited account', '11': 'Standing order', '12': 'Direct remittance', '13': 'Business terminal giro',
  '14': 'Counter giro', '15': 'AvtaleGiro', '16': 'Telegiro', '17': 'Giro paid in cash',
  '18': 'Reversal with KID', '19': 'Purchase with KID', '20': 'Reversal with text', '21': 'Purchase with text',
};
const OCR_REVERSALS = new Set(['18', '20']);

const f = (rec: string, from: number, to: number) => rec.slice(from - 1, to);

function ocrDate(s: string, line: number, what: string, optional = false): string | null {
  if (optional && /^0{6}$/.test(s)) return null;
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(s);
  const iso = m ? `20${m[3]}-${m[2]}-${m[1]}` : '';
  const d = m ? new Date(`${iso}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw new BankFileError(`${what} "${s}" is not a date (DDMMYY)`, line);
  }
  return iso;
}

function digits(s: string, line: number, what: string): string {
  if (!/^\d+$/.test(s)) throw new BankFileError(`${what} must be digits, found "${s}"`, line);
  return s;
}

function filler(s: string, line: number, from: number) {
  if (!/^[0 ]*$/.test(s)) throw new BankFileError(`positions ${from}–${from + s.length - 1} must be filler (zeros), found "${s.trim()}"`, line);
}

export function parseNetsOcr(text: string): BankFile {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (!lines.length) throw new BankFileError('the file is empty');
  lines.forEach((l, i) => {
    if (l.length !== 80) throw new BankFileError(`an OCR record is 80 characters, this one is ${l.length}`, i + 1);
    if (!l.startsWith('NY')) throw new BankFileError('an OCR record starts with the format code NY', i + 1);
  });
  const type = (l: string) => f(l, 7, 8);
  const expectService = (l: string, n: number, service: string) => {
    if (f(l, 3, 4) !== service) throw new BankFileError(`record ${type(l)} must have service code ${service}, found ${f(l, 3, 4)}`, n);
  };

  const first = lines[0];
  if (type(first) !== '10') throw new BankFileError('the file must start with a start-of-transmission record (10)', 1);
  expectService(first, 1, '00');
  if (f(first, 5, 6) !== '00') throw new BankFileError('transmission type must be 00', 1);
  filler(f(first, 32, 80), 1, 32);
  const last = lines[lines.length - 1];
  if (type(last) !== '89') throw new BankFileError('the file must end with an end-of-transmission record (89)', lines.length);

  const details: Record<string, unknown> = {
    dataSender: digits(f(first, 9, 16), 1, 'data sender'),
    transmissionNumber: digits(f(first, 17, 23), 1, 'transmission number'),
    dataRecipient: digits(f(first, 24, 31), 1, 'data recipient'),
    assignments: [] as unknown[],
  };
  const rows: BankFileRow[] = [];
  let totalTx = 0;
  let totalSigned = 0n;
  let totalAbs = 0n;
  let i = 1;
  while (i < lines.length - 1) {
    const start = lines[i];
    const startLine = i + 1;
    if (type(start) !== '20') throw new BankFileError(`expected a start-of-assignment record (20), found ${type(start)}`, startLine);
    expectService(start, startLine, '09');
    if (f(start, 5, 6) !== '00') throw new BankFileError('assignment type must be 00', startLine);
    filler(f(start, 36, 80), startLine, 36);
    const agreement = digits(f(start, 9, 17), startLine, 'agreement ID');
    const assignment = digits(f(start, 18, 24), startLine, 'assignment number');
    const account = digits(f(start, 25, 35), startLine, 'assignment account');
    let records = 1;
    let tx = 0;
    let signed = 0n;
    let abs = 0n;
    i++;
    while (i < lines.length - 1 && type(lines[i]) !== '88') {
      const r30 = lines[i];
      const n30 = i + 1;
      if (type(r30) !== '30') throw new BankFileError(`expected amount item 1 (30), found record ${type(r30)}`, n30);
      expectService(r30, n30, '09');
      const tt = f(r30, 5, 6);
      if (!OCR_TYPES[tt]) throw new BankFileError(`unknown transaction type ${tt}`, n30);
      const txNo = digits(f(r30, 9, 15), n30, 'transaction number');
      const settled = ocrDate(f(r30, 16, 21), n30, 'settlement date')!;
      digits(f(r30, 22, 31), n30, 'centre ID, day code, partial settlement and serial number');
      const sign = f(r30, 32, 32);
      if (sign !== '0' && sign !== '-') throw new BankFileError(`sign must be 0 or -, found "${sign}"`, n30);
      const ore = BigInt(digits(f(r30, 33, 49), n30, 'amount'));
      const kidField = f(r30, 50, 74);
      if (!/^ *[0-9-]* *$/.test(kidField)) throw new BankFileError(`KID must be digits, found "${kidField.trim()}"`, n30);
      const kid = kidField.replace(/\s/g, '');
      filler(f(r30, 77, 80), n30, 77);

      const r31 = lines[i + 1];
      const n31 = i + 2;
      if (!r31 || type(r31) !== '31') throw new BankFileError('amount item 1 (30) must be followed by amount item 2 (31)', n31);
      expectService(r31, n31, '09');
      if (f(r31, 5, 6) !== tt || f(r31, 9, 15) !== txNo) {
        throw new BankFileError(`amount item 2 must have the transaction type and number of the record before it (${tt}, ${txNo})`, n31);
      }
      const form = f(r31, 16, 25);
      const archive = f(r31, 26, 34);
      filler(f(r31, 35, 41), n31, 35);
      const ordered = ocrDate(f(r31, 42, 47), n31, 'order date', true);
      const debit = f(r31, 48, 58);
      if (!/^\d{11}$|^0{11}$|^ {11}$/.test(debit)) throw new BankFileError(`debit account must be 11 digits, found "${debit.trim()}"`, n31);
      filler(f(r31, 59, 80), n31, 59);
      i += 2;
      records += 2;

      let text: string | null = null;
      if (i < lines.length - 1 && type(lines[i]) === '32') {
        const r32 = lines[i];
        const n32 = i + 1;
        if (tt !== '20' && tt !== '21') throw new BankFileError(`amount item 3 (32) is only for transaction types 20 and 21, not ${tt}`, n32);
        if (f(r32, 9, 15) !== txNo) throw new BankFileError(`amount item 3 must have transaction number ${txNo}`, n32);
        text = f(r32, 16, 55).trim() || null;
        i++;
        records++;
      }

      const reversal = OCR_REVERSALS.has(tt) || sign === '-';
      tx++;
      signed += sign === '-' ? -ore : ore;
      abs += ore;
      const bank_reference = `nets:${agreement}:${assignment}:${txNo}`;
      rows.push({
        line: n30, paid_on: settled, amount: Number(ore) / 100, kid, reference: bank_reference, bank_reference,
        currency: 'NOK', kid_source: kid ? 'structured' : 'none', reversal, payer: null, account,
        info: [OCR_TYPES[tt], /^\d*[1-9]\d*$/.test(archive) ? `archive reference ${archive}` : '',
               /^\d*[1-9]\d*$/.test(form) ? `form ${form}` : '', ordered ? `ordered ${ordered}` : '',
               /^\d*[1-9]\d*$/.test(debit) ? `from account ${debit}` : '', text ?? ''].filter(Boolean).join(' · '),
      });
    }
    const end = lines[i];
    const endLine = i + 1;
    if (!end || type(end) !== '88') throw new BankFileError('the assignment has no end-of-assignment record (88)', endLine);
    expectService(end, endLine, '09');
    records++;
    const nTx = Number(digits(f(end, 9, 16), endLine, 'number of transactions'));
    const nRec = Number(digits(f(end, 17, 24), endLine, 'number of records'));
    const sum = BigInt(digits(f(end, 25, 41), endLine, 'sum'));
    ocrDate(f(end, 42, 47), endLine, 'settlement date');
    filler(f(end, 60, 80), endLine, 60);
    if (nTx !== tx) throw new BankFileError(`the assignment states ${nTx} transactions, it has ${tx}`, endLine);
    if (nRec !== records) throw new BankFileError(`the assignment states ${nRec} records, it has ${records}`, endLine);
    if (sum !== signed && sum !== abs) throw new BankFileError(`the assignment states a sum of ${sum} øre, its amounts add up to ${signed}`, endLine);
    (details.assignments as unknown[]).push({ agreement, assignment, account, transactions: tx, sum: Number(sum) / 100 });
    totalTx += tx;
    totalSigned += signed;
    totalAbs += abs;
    i++;
  }
  const n = lines.length;
  expectService(last, n, '00');
  if (f(last, 5, 6) !== '00') throw new BankFileError('transmission type must be 00', n);
  const nTx = Number(digits(f(last, 9, 16), n, 'number of transactions'));
  const nRec = Number(digits(f(last, 17, 24), n, 'number of records'));
  const sum = BigInt(digits(f(last, 25, 41), n, 'sum'));
  ocrDate(f(last, 42, 47), n, 'settlement date');
  filler(f(last, 48, 80), n, 48);
  if (nTx !== totalTx) throw new BankFileError(`the transmission states ${nTx} transactions, it has ${totalTx}`, n);
  if (nRec !== lines.length) throw new BankFileError(`the transmission states ${nRec} records, it has ${lines.length}`, n);
  if (sum !== totalSigned && sum !== totalAbs) throw new BankFileError(`the transmission states a sum of ${sum} øre, its amounts add up to ${totalSigned}`, n);
  if (!(details.assignments as unknown[]).length) throw new BankFileError('the transmission has no assignment');
  details.transactions = totalTx;
  details.sum = Number(sum) / 100;
  return { format: 'nets_ocr', rows, details };
}

/* ── A small XML reader (elements, attributes, text) ───────────────────────
 * Enough for camt: no DTD and no entity definitions (refused, so nothing
 * can expand or fetch), namespace prefixes dropped. */
interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; text: string }

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : ENTITIES[e] ?? (() => { throw new BankFileError(`unknown XML entity ${m}`); })());
}
const local = (n: string) => n.slice(n.indexOf(':') + 1);

function parseXml(src: string): XNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(src)) throw new BankFileError('XML with a DOCTYPE or entity definitions is not accepted');
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let at = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index !== at) break;
    at = re.lastIndex;
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      const open = stack.pop();
      if (!open || open === root || open.name !== local(m[2])) throw new BankFileError(`malformed XML: unexpected </${m[2]}>`);
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescapeXml(a[2] ?? a[3] ?? '');
      const node: XNode = { name: local(m[3]), attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += unescapeXml(m[6]);
  }
  if (at !== src.length) throw new BankFileError(`malformed XML near character ${at}`);
  if (stack.length !== 1) throw new BankFileError(`malformed XML: <${stack[stack.length - 1].name}> is not closed`);
  return root;
}

const kids = (n: XNode | undefined, name: string) => (n?.children ?? []).filter(c => c.name === name);
function child(n: XNode | undefined, ...path: string[]): XNode | undefined {
  let cur = n;
  for (const p of path) cur = cur?.children.find(c => c.name === p);
  return cur;
}
const txt = (n: XNode | undefined, ...path: string[]) => (child(n, ...path)?.text ?? '').trim();

/* ── camt.054 / camt.053 ─────────────────────────────────────────────────── */
const AMOUNT = /^\d{1,13}(\.\d{1,5})?$/;
const usable = (s: string) => (s && s.toUpperCase() !== 'NOTPROVIDED' ? s : '');

/** A KID written in the free text: one MOD10-valid number of 6–25 digits, else none. */
function kidInText(text: string): string {
  const found = [...new Set((text.match(/\b\d{6,25}\b/g) ?? []).filter(isValidKid))];
  return found.length === 1 ? found[0] : '';
}

export function parseCamt(xml: string): BankFile {
  const root = parseXml(xml.replace(/^\uFEFF/, ''));
  const doc = kids(root, 'Document')[0];
  if (!doc) throw new BankFileError('not an ISO 20022 document (no <Document>)');
  const ns = Object.values(doc.attrs).find(v => /iso:20022:tech:xsd:camt\./.test(v)) ?? '';
  const n054 = child(doc, 'BkToCstmrDbtCdtNtfctn');
  const n053 = child(doc, 'BkToCstmrStmt');
  if (!n054 && !n053) {
    throw new BankFileError(child(doc, 'BkToCstmrAcctRpt')
      ? 'a camt.052 account report is not accepted; use the camt.054 notification or the camt.053 statement'
      : 'not a camt.054 notification or camt.053 statement');
  }
  const format: BankFileFormat = n054 ? 'camt054' : 'camt053';
  if (ns && !new RegExp(`camt\\.${format === 'camt054' ? '054' : '053'}\\.001\\.\\d+`).test(ns)) {
    throw new BankFileError(`the namespace ${ns} does not match the ${format === 'camt054' ? 'camt.054' : 'camt.053'} message`);
  }
  const msg = (n054 ?? n053)!;
  const containers = kids(msg, format === 'camt054' ? 'Ntfctn' : 'Stmt');
  if (!containers.length) throw new BankFileError(`the message has no ${format === 'camt054' ? 'notification (Ntfctn)' : 'statement (Stmt)'}`);

  const rows: BankFileRow[] = [];
  const skipped = { debits: 0, notBooked: 0 };
  const accounts: string[] = [];
  let position = 0;
  for (const c of containers) {
    const account = txt(c, 'Acct', 'Id', 'IBAN') || txt(c, 'Acct', 'Id', 'Othr', 'Id') || null;
    if (account && !accounts.includes(account)) accounts.push(account);
    for (const e of kids(c, 'Ntry')) {
      position++;
      const where = `entry ${position}`;
      const cdi = txt(e, 'CdtDbtInd');
      if (cdi !== 'CRDT' && cdi !== 'DBIT') throw new BankFileError(`${where}: CdtDbtInd must be CRDT or DBIT`);
      if (cdi === 'DBIT') { skipped.debits++; continue; }
      const status = txt(e, 'Sts', 'Cd') || txt(e, 'Sts');
      if (status !== 'BOOK') { skipped.notBooked++; continue; }
      const booked = (txt(e, 'BookgDt', 'Dt') || txt(e, 'BookgDt', 'DtTm') || txt(e, 'ValDt', 'Dt') || txt(e, 'ValDt', 'DtTm')).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(booked)) throw new BankFileError(`${where}: a booked entry needs its booking date`);
      const entryAmt = child(e, 'Amt');
      const entryRef = usable(txt(e, 'AcctSvcrRef')) || usable(txt(e, 'NtryRef'));
      const reversal = txt(e, 'RvslInd') === 'true';
      const txs = kids(e, 'NtryDtls').flatMap(d => kids(d, 'TxDtls'));
      const items = txs.length ? txs : [undefined];
      items.forEach((tx, n) => {
        if (tx && txt(tx, 'CdtDbtInd') === 'DBIT') { skipped.debits++; return; }
        const amtNode = (tx && (child(tx, 'Amt') ?? child(tx, 'AmtDtls', 'TxAmt', 'Amt'))) ?? (items.length === 1 ? entryAmt : undefined);
        if (!amtNode) throw new BankFileError(`${where}: transaction ${n + 1} has no amount`);
        const a = amtNode.text.trim();
        if (!AMOUNT.test(a)) throw new BankFileError(`${where}: "${a}" is not an amount`);
        const currency = (amtNode.attrs.Ccy ?? '').toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) throw new BankFileError(`${where}: the amount has no currency (Ccy)`);
        const ref = usable(txt(tx, 'Refs', 'AcctSvcrRef')) || (entryRef ? (items.length > 1 ? `${entryRef}/${n + 1}` : entryRef) : '');
        const strd = kids(child(tx, 'RmtInf'), 'Strd');
        const structured = strd.map(s => txt(s, 'CdtrRefInf', 'Ref')).find(Boolean)?.replace(/\s/g, '') ?? '';
        const ustrd = kids(child(tx, 'RmtInf'), 'Ustrd').map(u => u.text.trim()).filter(Boolean);
        const free = [...ustrd, txt(tx, 'AddtlTxInf'), txt(e, 'AddtlNtryInf')].filter(Boolean).join(' · ');
        const fromText = structured ? '' : kidInText(ustrd.join(' '));
        const kid = /^\d+$/.test(structured) ? structured : fromText;
        const bank_reference = ref ? `camt:${account ?? '-'}:${ref}` : '';
        rows.push({
          line: position, paid_on: booked, amount: Number(a), kid, reference: bank_reference || `${booked}-${kid}-${a}`,
          bank_reference, currency, kid_source: structured && kid ? 'structured' : fromText ? 'text' : 'none', reversal,
          payer: txt(tx, 'RltdPties', 'Dbtr', 'Nm') || txt(tx, 'RltdPties', 'Dbtr', 'Pty', 'Nm') || null,
          account, info: [structured && !kid ? `reference ${structured}` : '', free].filter(Boolean).join(' · ') || null,
        });
      });
    }
  }
  return {
    format, rows,
    details: { namespace: ns || null, messageId: txt(msg, 'GrpHdr', 'MsgId') || null, created: txt(msg, 'GrpHdr', 'CreDtTm') || null,
               accounts, entries: position, skipped },
  };
}

/** A Nets OCR file or a camt.054 / camt.053 file, recognised from its content. */
export function parseBankFile(text: string): BankFile {
  if (text.length > MAX_BYTES) throw new BankFileError('the file is larger than 10 MB');
  const t = text.replace(/^\uFEFF/, '').trimStart();
  if (t.startsWith('<')) return parseCamt(t);
  if (t.startsWith('NY')) return parseNetsOcr(text);
  throw new BankFileError('not a Nets OCR file (records starting NY) or an ISO 20022 camt.054 / camt.053 file (XML)');
}

/** The pasted rows (parseBankRows) in the same shape; their reference is kept as pasted,
 *  so a row pasted again matches what the paste path recorded before. */
export function pastedBankFile(text: string): BankFile {
  return {
    format: 'rows',
    rows: parseBankRows(text).map((r, i) => ({
      line: i + 1, ...r, bank_reference: r.reference, currency: 'NOK', kid_source: 'pasted', reversal: false,
      payer: null, account: null, info: null,
    })),
    details: {},
  };
}

/** Bank files are UTF-8, or ISO-8859-1 / Windows-1252 (Nets). */
export function decodeBankFile(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The rows as the database functions take them (import_bank_file, preview_bank_import). */
export function rowsForDatabase(file: BankFile) {
  return file.rows.map(r => ({
    line: r.line, paid_on: r.paid_on, amount: r.amount, currency: r.currency, kid: r.kid, kid_source: r.kid_source,
    bank_reference: r.bank_reference || null, reversal: r.reversal, payer: r.payer, account: r.account, info: r.info,
  }));
}
