/**
 * Loading a period's books once, and the accountant package: every
 * document in PDF and Word, SAF-T, the general ledger and the receipts as
 * CSV, in one ZIP, so the accountant reviews instead of collecting.
 */
import type { AccountingApi } from './api';
import { buildDoc, DOC_KINDS, type BooksData } from './documents/build';
import type { Lang } from './documents/model';
import { renderDocx } from './render/docx';
import { renderPdf } from './render/pdf';
import { zip, type ZipEntry } from './render/zip';
import { buildSaft, saftFileName, type SaftInput } from './saft';
import type { Attachment, MvaRow } from './types';

const must = <T>(r: { data: T | null; error: string | null }): T => {
  if (r.error) throw new Error(r.error);
  return r.data as T;
};

export async function loadBooks(api: AccountingApi, ledgerId: string, from: string, to: string): Promise<BooksData> {
  const ledger = await api.ledger(ledgerId);
  if (!ledger) throw new Error('no such ledger');
  const year = Number(to.slice(0, 4));
  const terms = ledger.mva_term === 'yearly' ? [1] : [1, 2, 3, 4, 5, 6];
  const [accounts, posting, trial, ledgerRows, vouchers, income, balance, checks, ...mva] = await Promise.all([
    api.accounts(ledgerId), api.postingAccounts(ledgerId),
    api.trialBalance(ledgerId, from, to).then(must), api.generalLedger(ledgerId, from, to).then(must),
    api.vouchers(ledgerId, from, to), api.incomeStatement(ledgerId, from, to).then(must), api.balanceSheet(ledgerId, to).then(must),
    api.checks(ledgerId, from, to).then(must),
    ...terms.map(term => api.mvaReport(ledgerId, year, term).then(must)),
  ]);
  const lines = await api.lines(vouchers.map(v => v.id));
  const key = (k: string, fallback: string) => posting.find(p => p.key === k)?.account_code ?? fallback;
  return {
    ledger, accounts, from, to, trial, ledgerRows, vouchers, lines, income, balance, checks,
    mva: terms.map((term, i) => [term, mva[i] as MvaRow[]] as [number, MvaRow[]]),
    receivablesAccount: key('receivables', '1500'), payablesAccount: key('payables', '2400'),
  };
}

const csv = (rows: Array<Array<string | number | null>>) =>
  '﻿' + rows.map(r => r.map(v => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\r\n') + '\r\n';

export interface PackageOptions {
  lang: Lang;
  software: SaftInput['software'];
  company: SaftInput['company'];
  mvaCodes: SaftInput['mvaCodes'];
  attachments?: Attachment[];
}

export function saftFor(d: BooksData, o: Pick<PackageOptions, 'software' | 'company' | 'mvaCodes'>): { name: string; xml: string } {
  return {
    name: saftFileName(d.ledger.org_number),
    xml: buildSaft({ ledger: d.ledger, company: o.company, software: o.software, from: d.from, to: d.to, accounts: d.accounts, trial: d.trial,
                     vouchers: d.vouchers, lines: d.lines, ledgerRows: d.ledgerRows, mvaCodes: o.mvaCodes,
                     receivablesAccount: d.receivablesAccount, payablesAccount: d.payablesAccount }),
  };
}

export function accountantPackage(d: BooksData, o: PackageOptions): { name: string; bytes: Uint8Array } {
  const entries: ZipEntry[] = [];
  // Folder names that every system accepts (no ':' and the like, which Windows refuses).
  const folder = (n: number, s: string) => `${String(n).padStart(2, '0')} ${s.replace(/[:\\/*?"<>|]+/g, ' -').replace(/\s+/g, ' ').trim()}`;
  let i = 0;
  for (const k of DOC_KINDS) {
    if (k.kind === 'mva') {
      for (const [term] of d.mva) {
        const doc = buildDoc('mva', d, o.lang, term);
        i++;
        entries.push({ name: `${folder(i, doc.title)}/${doc.name}.pdf`, data: renderPdf(doc) }, { name: `${folder(i, doc.title)}/${doc.name}.docx`, data: renderDocx(doc) });
      }
      continue;
    }
    const doc = buildDoc(k.kind, d, o.lang);
    i++;
    entries.push({ name: `${folder(i, doc.title)}/${doc.name}.pdf`, data: renderPdf(doc) }, { name: `${folder(i, doc.title)}/${doc.name}.docx`, data: renderDocx(doc) });
  }
  const saft = saftFor(d, o);
  entries.push({ name: `SAF-T/${saft.name}`, data: saft.xml });
  entries.push({ name: 'CSV/hovedbok.csv', data: csv([
    ['Bilag', 'Dato', 'Konto', 'Beskrivelse', 'Debet', 'Kredit', 'Mva-kode', 'Kunde/leverandør'],
    ...d.ledgerRows.map(r => [r.voucher_no, r.voucher_date, r.account_code, r.line_description ?? r.description, r.debit, r.credit, r.mva_code, r.party]),
  ]) });
  entries.push({ name: 'CSV/saldobalanse.csv', data: csv([
    ['Konto', 'Navn', 'IB', 'Debet', 'Kredit', 'UB'], ...d.trial.map(r => [r.account_code, r.account_name, r.opening, r.debit, r.credit, r.closing]),
  ]) });
  if (o.attachments) {
    const byVoucher = new Map(d.vouchers.map(v => [v.id, `${v.year}-${v.number}`]));
    entries.push({ name: 'CSV/kvitteringer.csv', data: csv([
      ['Bilag', 'Fil', 'SHA-256', 'Bytes', 'Lastet opp'],
      ...o.attachments.map(a => [byVoucher.get(a.voucher_id) ?? '', a.file_name, a.sha256, a.size_bytes, a.uploaded_at]),
    ]) });
  }
  const readme = o.lang === 'no'
    ? `Regnskapspakke for ${d.ledger.legal_name} (${d.ledger.org_number ?? ''}), ${d.from} – ${d.to}.\r\n\r\nLaget fra regnskapet i FlyttGo Regnskap. Mappene inneholder hvert dokument i PDF og Word, SAF-T Financial ${'1.30'} for Skatteetaten, og hovedbok, saldobalanse og kvitteringsliste som CSV (semikolon, UTF-8). Kontrolloppstillingen viser avstemmingen som bør gjennomgås først.\r\n`
    : `Accountant package for ${d.ledger.legal_name} (${d.ledger.org_number ?? ''}), ${d.from} – ${d.to}.\r\n\r\nMade from the books in FlyttGo Regnskap. The folders hold each document in PDF and Word, SAF-T Financial 1.30 for Skatteetaten, and the general ledger, trial balance and receipts list as CSV (semicolon, UTF-8). The reconciliation (Kontrolloppstilling) is what to review first.\r\n`;
  entries.unshift({ name: o.lang === 'no' ? 'LES MEG.txt' : 'README.txt', data: readme });
  const slug = d.ledger.legal_name.toLowerCase().replace(/[^a-z0-9æøå]+/g, '-').replace(/^-|-$/g, '');
  return { name: `${slug}-${o.lang === 'no' ? 'regnskapspakke' : 'accountant-package'}-${d.from}-${d.to}.zip`, bytes: zip(entries) };
}

export function download(name: string, bytes: Uint8Array | string, type: string) {
  const blob = new Blob([typeof bytes === 'string' ? bytes : bytes.slice().buffer], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
