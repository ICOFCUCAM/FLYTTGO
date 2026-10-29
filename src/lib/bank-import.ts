/**
 * Bank import for the browser (migration 00016, docs/INVOICING.md → Bank
 * import): a Nets OCR file or a camt.054 / camt.053 file is read and
 * checked here with the same parser as the bank-import function
 * (supabase/functions/_shared/bank-files.ts), previewed and imported
 * through the database functions, which decide who may import for which
 * series and count each bank transaction once. orgId null: FlyttGo's own
 * invoices; a company's id: its own invoice series.
 */
import { supabase } from './supabase';
import {
  BankFileError, decodeBankFile, parseBankFile, pastedBankFile, rowsForDatabase, sha256Hex, type BankFile,
} from '../../supabase/functions/_shared/bank-files';

export type BankOutcome = 'matched' | 'already_recorded' | 'already_imported' | 'unmatched' | 'overpayment';

export interface PreviewRow {
  line: number; paid_on: string; amount: number; currency: string; kid: string; kid_source: string | null;
  bank_reference: string | null; reversal: boolean; payer: string | null; info: string | null;
  outcome: BankOutcome; reason: string | null; invoice_id: string | null; invoice_number: number | null; outstanding: number | null;
}
export interface Preview { rows: PreviewRow[]; counts: Partial<Record<BankOutcome, number>>; already_imported_at: string | null }

export interface BankImport {
  id: string; series: string; format: string; source: string; file_name: string | null; sha256: string; rows_total: number;
  matched: number; already_recorded: number; already_imported: number; unmatched: number; overpayments: number;
  amount_matched: number; imported_by: string | null; imported_at: string; details: Record<string, unknown>;
}
export interface BankImportRow {
  id: string; import_id: string; line_no: number; paid_on: string; amount: number; currency: string; kid: string | null;
  bank_reference: string | null; reversal: boolean; payer: string | null; account: string | null; info: string | null;
  outcome: BankOutcome; reason: string | null; invoice_id: string | null; resolution: string | null; resolution_note: string | null;
  resolved_at: string | null; created_at: string;
}
export interface BankImportSettings { series: string; provider: string; agreement_id: string | null; account: string | null;
  fetch_enabled: boolean; last_fetch_at: string | null; last_fetch_error: string | null }

export const FORMAT_LABELS: Record<string, string> = {
  nets_ocr: 'Nets OCR giro', camt054: 'camt.054', camt053: 'camt.053', rows: 'Pasted rows',
};
export const OUTCOME_LABELS: Record<BankOutcome, string> = {
  matched: 'Matched', already_recorded: 'Already recorded', already_imported: 'Already imported',
  unmatched: 'Not matched', overpayment: 'More than owed',
};
export const REASON_LABELS: Record<string, string> = {
  no_invoice: 'no invoice with this KID', no_kid: 'no KID', currency: 'not in NOK', reversal: 'reversal or return',
  no_reference: 'the bank gave no reference', possible_duplicate: 'same amount and day already recorded another way',
  reference_in_use: 'reference recorded in another series', more_than_owed: 'more than the invoice owes',
  nothing_owed: 'the invoice owes nothing', twice_in_file: 'twice in this file', earlier_import: 'in an earlier import',
};

const series = (orgId: string | null) => (orgId ? `org:${orgId}` : 'main');

/** Read and check a chosen file; a file that does not follow its format is refused with the reason. */
export async function readBankFile(file: File): Promise<{ file?: BankFile; sha256?: string; error?: string }> {
  if (file.size > 10 * 1024 * 1024) return { error: 'the file is larger than 10 MB' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return { file: parseBankFile(decodeBankFile(bytes)), sha256: await sha256Hex(bytes) };
  } catch (e) {
    return { error: e instanceof BankFileError ? e.message : 'the file could not be read' };
  }
}

export async function previewBankFile(orgId: string | null, file: BankFile, sha256: string): Promise<{ preview?: Preview; error?: string }> {
  const { data, error } = await supabase.rpc('preview_bank_import', {
    p_org: orgId, p_format: file.format, p_sha256: sha256, p_rows: rowsForDatabase(file),
  });
  return error ? { error: error.message } : { preview: data as Preview };
}

export async function importBankFile(orgId: string | null, file: BankFile, sha256: string, source: 'upload' | 'paste',
                                     fileName: string | null): Promise<{ result?: BankImport; error?: string; missing?: boolean }> {
  const { data, error } = await supabase.rpc('import_bank_file', {
    p_org: orgId, p_format: file.format, p_source: source, p_file_name: fileName, p_sha256: sha256,
    p_rows: rowsForDatabase(file), p_details: file.details,
  });
  // PGRST202 / 42883: the database does not have migration 00016 yet.
  if (error) return { error: error.message, missing: error.code === 'PGRST202' || error.code === '42883' };
  return { result: data as BankImport };
}

/** Pasted rows (date;amount;KID;reference) imported like a file, so their outcomes are kept too. */
export async function importPastedRows(orgId: string | null, text: string) {
  const file = pastedBankFile(text);
  return { file, ...(await importBankFile(orgId, file, await sha256Hex(text.trim()), 'paste', null)) };
}

export async function loadBankImports(orgId: string | null): Promise<BankImport[]> {
  const { data } = await supabase.from('bank_imports').select('*').eq('series', series(orgId))
    .order('imported_at', { ascending: false }).limit(20);
  return (data ?? []) as BankImport[];
}

export async function loadImportRows(importId: string): Promise<BankImportRow[]> {
  const { data } = await supabase.from('bank_import_rows').select('*').eq('import_id', importId).order('line_no');
  return (data ?? []) as BankImportRow[];
}

/** Rows still waiting for a person: not matched or more than owed, not yet resolved. */
export async function loadOpenBankRows(orgId: string | null): Promise<BankImportRow[]> {
  const { data } = await supabase.from('bank_import_rows').select('*').eq('series', series(orgId))
    .in('outcome', ['unmatched', 'overpayment']).is('resolution', null).order('created_at', { ascending: false }).limit(500);
  return (data ?? []) as BankImportRow[];
}

export async function loadBankImportSettings(orgId: string | null): Promise<BankImportSettings | null> {
  const { data } = await supabase.from('bank_import_settings').select('*').eq('series', series(orgId)).maybeSingle();
  return (data ?? null) as BankImportSettings | null;
}

/** Record an open row against an invoice of the series (by its number), or set it aside with a reason (invoiceId null). */
export async function resolveBankRow(rowId: string, invoiceId: string | null, note: string): Promise<string | null> {
  const { error } = await supabase.rpc('resolve_bank_import_row', { p_row: rowId, p_invoice: invoiceId, p_note: note || null });
  return error?.message ?? null;
}

export async function findInvoiceByNumber(orgId: string | null, number: number): Promise<string | null> {
  const { data } = await supabase.from('invoices').select('id').eq('series', series(orgId)).eq('kind', 'invoice')
    .eq('number', number).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export function reasonLabel(r: { outcome: BankOutcome; reason: string | null }): string {
  return r.reason ? `${OUTCOME_LABELS[r.outcome]}: ${REASON_LABELS[r.reason] ?? r.reason}` : OUTCOME_LABELS[r.outcome];
}
