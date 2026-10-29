/**
 * The documents the books produce for the tax office, Brønnøysund and the
 * accountant, from the report rows (pure functions: the same input gives
 * the same document in PDF and Word).
 *
 *   mva          MVA-melding basis for a term, per standard code
 *   income       Resultatregnskap
 *   balance      Balanse
 *   annual       Årsregnskap (draft for the board): both, with notes
 *   tax          Næringsspesifikasjon basis, by Skatteetaten's codes
 *   trial        Saldobalanse
 *   ledger       Hovedbok
 *   journal      Bilagsjournal
 *   receivables  Kundereskontro
 *   payables     Leverandørreskontro
 *   review       Kontrolloppstilling (checks and MVA reconciliation)
 *   calendar     Frister og innleveringer
 */
import { GROUPING_CODES } from '../data/naeringsspesifikasjon';
import { day, money, t, type StringKey } from '../i18n';
import type { Account, CheckRow, Ledger, LedgerRow, MvaRow, StatementRow, TrialRow, Voucher, VoucherLine } from '../types';
import type { Block, Doc, Lang } from './model';

export type DocKind = 'mva' | 'income' | 'balance' | 'annual' | 'tax' | 'trial' | 'ledger' | 'journal'
  | 'receivables' | 'payables' | 'review' | 'calendar';

export const DOC_KINDS: Array<{ kind: DocKind; title: StringKey; sub: StringKey }> = [
  { kind: 'mva', title: 'docMvaTitle', sub: 'docMvaSub' },
  { kind: 'annual', title: 'docAnnualTitle', sub: 'docAnnualSub' },
  { kind: 'tax', title: 'docTaxTitle', sub: 'docTaxSub' },
  { kind: 'income', title: 'docIncomeTitle', sub: 'docIncomeSub' },
  { kind: 'balance', title: 'docBalanceTitle', sub: 'docBalanceSub' },
  { kind: 'trial', title: 'docTrialTitle', sub: 'docTrialSub' },
  { kind: 'ledger', title: 'docLedgerTitle', sub: 'docLedgerSub' },
  { kind: 'journal', title: 'docJournalTitle', sub: 'docJournalSub' },
  { kind: 'receivables', title: 'docReceivablesTitle', sub: 'docReceivablesSub' },
  { kind: 'payables', title: 'docPayablesTitle', sub: 'docPayablesSub' },
  { kind: 'review', title: 'docReviewTitle', sub: 'docReviewSub' },
  { kind: 'calendar', title: 'docCalendarTitle', sub: 'docCalendarSub' },
];

/** Everything the documents read, for one period (a year or a part of one). */
export interface BooksData {
  ledger: Ledger;
  accounts: Account[];
  from: string; to: string;
  trial: TrialRow[];
  ledgerRows: LedgerRow[];
  vouchers: Voucher[];
  lines: VoucherLine[];
  income: StatementRow[];
  balance: StatementRow[];
  checks: CheckRow[];
  /** MVA report per term of the period's year: [term, rows]. */
  mva: Array<[number, MvaRow[]]>;
  receivablesAccount: string;
  payablesAccount: string;
}

const n = (v: unknown) => Number(v ?? 0);

function base(d: BooksData, lang: Lang, kind: DocKind, period: string, extraName = ''): Doc {
  const meta = DOC_KINDS.find(k => k.kind === kind)!;
  const slug = d.ledger.legal_name.toLowerCase().replace(/[^a-z0-9æøå]+/g, '-').replace(/^-|-$/g, '');
  return {
    name: `${slug}-${kind}${extraName}`,
    title: t(lang, meta.title), subtitle: t(lang, meta.sub),
    company: d.ledger.legal_name, orgNumber: d.ledger.org_number ? `${t(lang, 'orgNumber')} ${d.ledger.org_number}${d.ledger.vat_registered ? ' MVA' : ''}` : null,
    period, generated: `${t(lang, 'generated')} ${day(new Date(), lang)}`, lang, blocks: [], footer: t(lang, 'footer'),
  };
}
const periodLabel = (d: BooksData, lang: Lang) => `${t(lang, 'period')} ${day(d.from, lang)} – ${day(d.to, lang)}`;
const yearOf = (d: BooksData) => Number(d.to.slice(0, 4));

// ── MVA ─────────────────────────────────────────────────────────────────────
export function mvaDoc(d: BooksData, lang: Lang, term: number): Doc {
  const rows = d.mva.find(([tm]) => tm === term)?.[1] ?? [];
  const from = rows[0]?.term_from, to = rows[0]?.term_to;
  const label = d.ledger.mva_term === 'yearly' ? `${t(lang, 'year')} ${yearOf(d)}` : `${t(lang, 'term')} ${term} ${yearOf(d)}`;
  const doc = base(d, lang, 'mva', `${label}${from ? ` (${day(from, lang)} – ${day(to, lang)})` : ''}`, `-${yearOf(d)}-${term}`);
  const output = rows.filter(r => r.direction === 'output').reduce((s, r) => s + n(r.mva), 0);
  const input = rows.filter(r => r.direction === 'input').reduce((s, r) => s + n(r.mva), 0);
  doc.blocks.push(
    { kind: 'table', columns: [{ label: t(lang, 'mvaCode'), width: 9 }, { label: t(lang, 'description'), width: 47 }, { label: '%', width: 8, align: 'right' },
                              { label: t(lang, 'basis'), width: 18, align: 'right' }, { label: t(lang, 'mva'), width: 18, align: 'right' }],
      rows: rows.map(r => [r.mva_code, r.description, String(n(r.rate)), money(r.basis, lang), r.direction === 'none' ? '' : money(r.mva, lang)]) },
    { kind: 'facts', items: [
      [t(lang, 'outputMva'), money(output, lang)],
      [t(lang, 'inputMva'), money(input, lang)],
      [output - input >= 0 ? t(lang, 'mvaPayable') : t(lang, 'mvaRefund'), money(Math.abs(output - input), lang)],
    ] },
    { kind: 'text', tone: 'note', text: t(lang, 'mvaNote') },
  );
  if (!d.ledger.vat_registered) doc.blocks.unshift({ kind: 'text', tone: 'warning', text: `${t(lang, 'vatRegistered')}: ${t(lang, 'no')}` });
  return doc;
}

// ── Income statement and balance sheet ─────────────────────────────────────
function incomeBlocks(rows: StatementRow[], lang: Lang): Block[] {
  const sum = (g: string) => rows.filter(r => r.grp.startsWith(g)).reduce((s, r) => s + n(r.amount), 0);
  const tbl = (g: string, title: StringKey): Block => ({
    kind: 'table', columns: [{ label: t(lang, 'account'), width: 12 }, { label: t(lang, title), width: 64 }, { label: t(lang, 'amount'), width: 24, align: 'right' }],
    // Costs are shown as positive amounts; income and financial items with their sign.
    rows: rows.filter(r => r.grp.startsWith(g)).map(r => [r.account_code ?? '', r.account_name, money(g === '2' ? -n(r.amount) : r.amount, lang)]),
    total: ['', t(lang, 'total'), money(g === '2' ? -sum(g) : sum(g), lang)],
  });
  const operating = sum('1') + sum('2');
  return [
    tbl('1', 'revenue'), tbl('2', 'expenses'),
    { kind: 'facts', items: [[t(lang, 'operatingResult'), money(operating, lang)]] },
    tbl('3', 'financial'),
    { kind: 'facts', items: [[t(lang, 'result'), money(operating + sum('3'), lang)]] },
  ];
}
function balanceBlocks(rows: StatementRow[], lang: Lang): Block[] {
  const part = (g: string) => rows.filter(r => r.grp.startsWith(g));
  const sum = (g: string) => part(g).reduce((s, r) => s + n(r.amount), 0);
  const tbl = (g: string, title: StringKey): Block => ({
    kind: 'table', columns: [{ label: t(lang, 'account'), width: 12 }, { label: t(lang, title), width: 64 }, { label: t(lang, 'amount'), width: 24, align: 'right' }],
    rows: part(g).map(r => [r.account_code ?? '', r.account_code ? r.account_name : t(lang, 'unclosedResult'), money(r.amount, lang)]),
    total: ['', t(lang, 'total'), money(sum(g), lang)],
  });
  return [
    tbl('1', 'assets'), { kind: 'facts', items: [[t(lang, 'sumAssets'), money(sum('1'), lang)]] },
    tbl('2', 'equity'), tbl('3', 'liabilities'),
    { kind: 'facts', items: [[t(lang, 'sumEquityLiabilities'), money(sum('2') + sum('3'), lang)]] },
  ];
}
export function incomeDoc(d: BooksData, lang: Lang): Doc {
  const doc = base(d, lang, 'income', periodLabel(d, lang));
  doc.blocks.push(...incomeBlocks(d.income, lang));
  return doc;
}
export function balanceDoc(d: BooksData, lang: Lang): Doc {
  const doc = base(d, lang, 'balance', `${t(lang, 'at')} ${day(d.to, lang)}`);
  doc.blocks.push(...balanceBlocks(d.balance, lang));
  return doc;
}
export function annualDoc(d: BooksData, lang: Lang): Doc {
  const doc = base(d, lang, 'annual', `${t(lang, 'year')} ${yearOf(d)} · ${t(lang, 'draft')}`, `-${yearOf(d)}`);
  doc.blocks.push(
    { kind: 'text', tone: 'note', text: t(lang, 'annualNote') },
    { kind: 'heading', text: t(lang, 'docIncomeTitle') }, ...incomeBlocks(d.income, lang),
    { kind: 'heading', text: `${t(lang, 'docBalanceTitle')} ${day(d.to, lang)}` }, ...balanceBlocks(d.balance, lang),
    { kind: 'heading', text: t(lang, 'notesTitle') },
    { kind: 'text', text: `${t(lang, 'principlesTitle')}\n${t(lang, 'principlesBody')}` },
    { kind: 'text', text: `${t(lang, 'employeesTitle')}\n${t(lang, 'employeesBody')}` },
    { kind: 'text', text: `${t(lang, 'equityTitle')}\n${t(lang, 'equityBody')}` },
    { kind: 'signature', lines: [t(lang, 'placeDate'), t(lang, 'chairSign'), t(lang, 'boardSign'), t(lang, 'ceoSign')] },
  );
  return doc;
}

// ── Næringsspesifikasjon basis ─────────────────────────────────────────────
/** The year's amounts per grouping code (income positive, costs positive, balances as signed). */
export function taxLines(d: BooksData): Array<{ category: string; code: string; text: { no: string; en: string }; amount: number; accounts: string[] }> {
  const byAccount = new Map(d.accounts.map(a => [a.code, a]));
  const out = new Map<string, { category: string; code: string; text: { no: string; en: string }; amount: number; accounts: string[] }>();
  for (const r of d.trial) {
    if (r.account_code === '8800') continue;
    const a = byAccount.get(r.account_code);
    const code = a?.grouping_code ?? '—';
    const g = GROUPING_CODES.find(x => x.code === code && (!a?.grouping_category || x.category === a.grouping_category));
    const key = `${a?.grouping_category ?? '?'}:${code}`;
    const isIncomeStatement = r.account_code >= '3';
    // Balance accounts: the closing balance (assets positive, equity and debt negative); income statement: the year's movement.
    const amount = isIncomeStatement ? n(r.debit) - n(r.credit) : n(r.closing);
    const e = out.get(key) ?? { category: a?.grouping_category ?? '?', code, text: { no: g?.no ?? '', en: g?.en ?? '' }, amount: 0, accounts: [] };
    e.amount += amount; e.accounts.push(r.account_code);
    out.set(key, e);
  }
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
}
export function taxDoc(d: BooksData, lang: Lang): Doc {
  const doc = base(d, lang, 'tax', `${t(lang, 'year')} ${yearOf(d)}`, `-${yearOf(d)}`);
  const lines = taxLines(d);
  doc.blocks.push(
    { kind: 'text', tone: 'note', text: t(lang, 'taxNote') },
    { kind: 'table', columns: [{ label: t(lang, 'code'), width: 9 }, { label: t(lang, 'description'), width: 41 }, { label: t(lang, 'category'), width: 22 },
                              { label: t(lang, 'account'), width: 12 }, { label: t(lang, 'amount'), width: 16, align: 'right' }],
      rows: lines.map(l => [l.code, l.code === '—' ? t(lang, 'attention') : l.text[lang], l.category, l.accounts.join(', '), money(l.amount, lang)]) },
  );
  return doc;
}

// ── Trial balance, ledger, journal ─────────────────────────────────────────
export function trialDoc(d: BooksData, lang: Lang): Doc {
  const doc = base(d, lang, 'trial', periodLabel(d, lang));
  const sum = (k: keyof TrialRow) => d.trial.reduce((s, r) => s + n(r[k]), 0);
  doc.blocks.push({ kind: 'table',
    columns: [{ label: t(lang, 'account'), width: 9 }, { label: t(lang, 'accountName'), width: 35 }, { label: t(lang, 'opening'), width: 14, align: 'right' },
              { label: t(lang, 'debit'), width: 14, align: 'right' }, { label: t(lang, 'credit'), width: 14, align: 'right' }, { label: t(lang, 'closing'), width: 14, align: 'right' }],
    rows: d.trial.map(r => [r.account_code, r.account_name, money(r.opening, lang), money(r.debit, lang), money(r.credit, lang), money(r.closing, lang)]),
    total: ['', t(lang, 'total'), money(sum('opening'), lang), money(sum('debit'), lang), money(sum('credit'), lang), money(sum('closing'), lang)] });
  return doc;
}
export function ledgerDoc(d: BooksData, lang: Lang): Doc {
  const doc = base(d, lang, 'ledger', periodLabel(d, lang));
  const names = new Map(d.accounts.map(a => [a.code, a.name]));
  const accounts = [...new Set(d.ledgerRows.map(r => r.account_code))];
  for (const code of accounts) {
    const rows = d.ledgerRows.filter(r => r.account_code === code);
    const opening = n(d.trial.find(r => r.account_code === code)?.opening);
    let bal = opening;
    doc.blocks.push({ kind: 'heading', text: `${code} ${names.get(code) ?? ''}` }, { kind: 'table',
      columns: [{ label: t(lang, 'date'), width: 11 }, { label: t(lang, 'voucher'), width: 10 }, { label: t(lang, 'description'), width: 37 },
                { label: t(lang, 'debit'), width: 14, align: 'right' }, { label: t(lang, 'credit'), width: 14, align: 'right' }, { label: t(lang, 'balance'), width: 14, align: 'right' }],
      rows: [['', '', t(lang, 'opening'), '', '', money(opening, lang)],
             ...rows.map(r => { bal += n(r.debit) - n(r.credit); return [day(r.voucher_date, lang), r.voucher_no, r.line_description ?? r.description, n(r.debit) ? money(r.debit, lang) : '', n(r.credit) ? money(r.credit, lang) : '', money(bal, lang)]; })],
      total: ['', '', t(lang, 'total'), money(rows.reduce((s, r) => s + n(r.debit), 0), lang), money(rows.reduce((s, r) => s + n(r.credit), 0), lang), money(bal, lang)] });
  }
  return doc;
}
export function journalDoc(d: BooksData, lang: Lang): Doc {
  const doc = base(d, lang, 'journal', periodLabel(d, lang));
  const rows: string[][] = []; const emphasis: number[] = [];
  for (const v of d.vouchers) {
    emphasis.push(rows.length);
    rows.push([`${v.year}-${v.number}`, day(v.voucher_date, lang), v.description, v.source_type === 'manual' ? t(lang, 'manual') : t(lang, 'automatic'), '', '']);
    for (const l of d.lines.filter(x => x.voucher_id === v.id))
      rows.push(['', l.account_code, l.description ?? l.party ?? '', l.mva_code ? `${t(lang, 'mvaCode')} ${l.mva_code}` : '',
                 n(l.debit) ? money(l.debit, lang) : '', n(l.credit) ? money(l.credit, lang) : '']);
  }
  doc.blocks.push({ kind: 'table', emphasis,
    columns: [{ label: t(lang, 'number'), width: 10 }, { label: t(lang, 'date'), width: 11 }, { label: t(lang, 'description'), width: 39 },
              { label: '', width: 12 }, { label: t(lang, 'debit'), width: 14, align: 'right' }, { label: t(lang, 'credit'), width: 14, align: 'right' }],
    rows });
  return doc;
}

// ── Customer and supplier balances ─────────────────────────────────────────
export function openItems(d: BooksData, account: string): Array<{ party: string; balance: number }> {
  const m = new Map<string, number>();
  for (const r of d.ledgerRows.filter(x => x.account_code === account))
    m.set(r.party ?? '', (m.get(r.party ?? '') ?? 0) + n(r.debit) - n(r.credit));
  return [...m.entries()].filter(([, b]) => Math.abs(b) >= 0.005).map(([party, balance]) => ({ party, balance }))
    .sort((a, b) => a.party.localeCompare(b.party));
}
function partyDoc(d: BooksData, lang: Lang, kind: 'receivables' | 'payables'): Doc {
  const doc = base(d, lang, kind, `${t(lang, 'at')} ${day(d.to, lang)}`);
  const items = openItems(d, kind === 'receivables' ? d.receivablesAccount : d.payablesAccount);
  const sign = kind === 'receivables' ? 1 : -1;
  doc.blocks.push({ kind: 'table',
    columns: [{ label: t(lang, kind === 'receivables' ? 'customer' : 'supplier'), width: 70 }, { label: t(lang, 'open'), width: 30, align: 'right' }],
    rows: items.map(i => [i.party || t(lang, 'unknownParty'), money(sign * i.balance, lang)]),
    total: [t(lang, 'total'), money(sign * items.reduce((s, i) => s + i.balance, 0), lang)] });
  return doc;
}
export const receivablesDoc = (d: BooksData, lang: Lang) => partyDoc(d, lang, 'receivables');
export const payablesDoc = (d: BooksData, lang: Lang) => partyDoc(d, lang, 'payables');

// ── Checks and the calendar ────────────────────────────────────────────────
export function reviewDoc(d: BooksData, lang: Lang): Doc {
  const doc = base(d, lang, 'review', periodLabel(d, lang));
  doc.blocks.push(
    { kind: 'text', tone: 'note', text: t(lang, 'reviewNote') },
    { kind: 'table', columns: [{ label: t(lang, 'check'), width: 46 }, { label: t(lang, 'result_'), width: 14 }, { label: t(lang, 'detail'), width: 40 }],
      rows: d.checks.map(c => [c.check_name, c.ok ? t(lang, 'ok') : t(lang, 'attention'), c.detail]) },
    { kind: 'heading', text: t(lang, 'mvaReturn') },
    { kind: 'table', columns: [{ label: t(lang, 'term'), width: 20 }, { label: t(lang, 'outputMva'), width: 27, align: 'right' },
                              { label: t(lang, 'inputMva'), width: 27, align: 'right' }, { label: t(lang, 'balance'), width: 26, align: 'right' }],
      rows: d.mva.map(([term, rows]) => {
        const o = rows.filter(r => r.direction === 'output').reduce((s, r) => s + n(r.mva), 0);
        const i = rows.filter(r => r.direction === 'input').reduce((s, r) => s + n(r.mva), 0);
        return [d.ledger.mva_term === 'yearly' ? String(yearOf(d)) : `${term}`, money(o, lang), money(i, lang), money(o - i, lang)];
      }) },
  );
  return doc;
}
export function calendarDoc(d: BooksData, lang: Lang): Doc {
  const y = yearOf(d);
  const doc = base(d, lang, 'calendar', `${t(lang, 'year')} ${y}`, `-${y}`);
  const rows: string[][] = [];
  if (d.ledger.vat_registered) {
    if (d.ledger.mva_term === 'yearly') rows.push([day(`${y + 1}-03-10`, lang), t(lang, 'calMvaYear'), t(lang, 'docMvaTitle')]);
    else [[1, `${y}-04-10`], [2, `${y}-06-10`], [3, `${y}-08-31`], [4, `${y}-10-10`], [5, `${y}-12-10`], [6, `${y + 1}-02-10`]]
      .forEach(([term, date]) => rows.push([day(String(date), lang), `${t(lang, 'calMva')} ${term}`, t(lang, 'docMvaTitle')]));
  }
  rows.push([day(`${y + 1}-01-31`, lang), t(lang, 'calShareholders'), t(lang, 'notFromBooks')]);
  rows.push([day(`${y + 1}-05-31`, lang), t(lang, 'calTax'), `${t(lang, 'docTaxTitle')}, SAF-T`]);
  rows.push([day(`${y + 1}-07-31`, lang), t(lang, 'calAnnual'), t(lang, 'docAnnualTitle')]);
  rows.push(['', t(lang, 'calAmelding'), t(lang, 'notFromBooks')]);
  doc.blocks.push(
    { kind: 'table', columns: [{ label: t(lang, 'deadline'), width: 16 }, { label: t(lang, 'filing'), width: 50 }, { label: t(lang, 'ready'), width: 34 }], rows },
    { kind: 'text', tone: 'note', text: t(lang, 'calendarNote') },
  );
  return doc;
}

export function buildDoc(kind: DocKind, d: BooksData, lang: Lang, term = 1): Doc {
  switch (kind) {
    case 'mva': return mvaDoc(d, lang, term);
    case 'income': return incomeDoc(d, lang);
    case 'balance': return balanceDoc(d, lang);
    case 'annual': return annualDoc(d, lang);
    case 'tax': return taxDoc(d, lang);
    case 'trial': return trialDoc(d, lang);
    case 'ledger': return ledgerDoc(d, lang);
    case 'journal': return journalDoc(d, lang);
    case 'receivables': return receivablesDoc(d, lang);
    case 'payables': return payablesDoc(d, lang);
    case 'review': return reviewDoc(d, lang);
    case 'calendar': return calendarDoc(d, lang);
  }
}
