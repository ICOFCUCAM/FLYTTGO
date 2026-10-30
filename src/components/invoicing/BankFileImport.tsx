/**
 * Bank file import (migration 00016, docs/INVOICING.md → Bank import), used
 * in Admin → Invoicing (orgId null: FlyttGo's own invoices) and in the
 * company's Invoices to customers (its own series). Choose a Nets OCR or
 * camt.054 / camt.053 file, see what each row will do, confirm, then see
 * the result. Rows that were not matched stay listed until someone records
 * them against an invoice or sets them aside with a reason. The database
 * decides who may import and counts each bank transaction once.
 */
import { useCallback, useEffect, useState } from 'react';
import { formatNok } from '../../lib/invoicing';
import {
  FORMAT_LABELS, OUTCOME_LABELS, findInvoiceByNumber, importBankFile, loadBankImportSettings, loadBankImports, loadImportRows,
  loadOpenBankRows, previewBankFile, readBankFile, reasonLabel, resolveBankRow,
  type BankImport, type BankImportRow, type BankImportSettings, type Preview,
} from '../../lib/bank-import';
import type { BankFile } from '../../../supabase/functions/_shared/bank-files';

const btn = 'px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50';
const TONE: Record<string, string> = {
  matched: 'text-emerald-700', already_recorded: 'text-gray-500', already_imported: 'text-gray-500',
  unmatched: 'text-orange-700', overpayment: 'text-red-700',
};

export default function BankFileImport({ orgId, onChanged }: { orgId: string | null; onChanged?: () => void }) {
  const [chosen, setChosen] = useState<{ name: string; file: BankFile; sha256: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ imp: BankImport; rows: BankImportRow[] } | null>(null);
  const [open, setOpen] = useState<BankImportRow[]>([]);
  const [imports, setImports] = useState<BankImport[]>([]);
  const [settings, setSettings] = useState<BankImportSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const reload = useCallback(async () => {
    const [o, i, s] = await Promise.all([loadOpenBankRows(orgId), loadBankImports(orgId), loadBankImportSettings(orgId)]);
    setOpen(o); setImports(i); setSettings(s);
  }, [orgId]);
  useEffect(() => { reload(); }, [reload]);

  async function choose(f: File | undefined) {
    setPreview(null); setResult(null); setMsg(null); setChosen(null);
    if (!f) return;
    setBusy(true);
    const r = await readBankFile(f);
    if (!r.file || !r.sha256) { setBusy(false); setMsg({ ok: false, text: `${f.name}: ${r.error}` }); return; }
    const p = await previewBankFile(orgId, r.file, r.sha256);
    setBusy(false);
    if (!p.preview) { setMsg({ ok: false, text: p.error ?? 'the preview failed' }); return; }
    setChosen({ name: f.name, file: r.file, sha256: r.sha256 });
    setPreview(p.preview);
  }

  async function confirmImport() {
    if (!chosen) return;
    setBusy(true); setMsg(null);
    const r = await importBankFile(orgId, chosen.file, chosen.sha256, 'upload', chosen.name);
    if (!r.result) { setBusy(false); setMsg({ ok: false, text: r.error ?? 'the import failed' }); return; }
    const rows = await loadImportRows(r.result.id);
    setBusy(false);
    setResult({ imp: r.result, rows }); setChosen(null); setPreview(null); setInputKey(k => k + 1);
    setMsg({ ok: true, text: `Imported: ${r.result.matched} matched (${formatNok(r.result.amount_matched)}), ${r.result.unmatched + r.result.overpayments} to handle by hand.` });
    await reload(); onChanged?.();
  }

  async function resolve(row: BankImportRow, record: boolean) {
    let invoiceId: string | null = null;
    let note = '';
    if (record) {
      const n = prompt(`Record ${formatNok(row.amount)} against invoice number:`);
      if (!n?.trim()) return;
      invoiceId = await findInvoiceByNumber(orgId, Number(n.trim()));
      if (!invoiceId) { setMsg({ ok: false, text: `No invoice number ${n.trim()} in this series.` }); return; }
      note = prompt('Note (optional, e.g. "KID mistyped by the payer"):') ?? '';
    } else {
      note = prompt('Why is this row set aside? (e.g. refunded to the payer, not ours)') ?? '';
      if (!note.trim()) return;
    }
    setBusy(true); setMsg(null);
    const err = await resolveBankRow(row.id, invoiceId, note.trim());
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: record ? 'Payment recorded.' : 'Row set aside.' });
    await reload(); onChanged?.();
  }

  const counts = preview?.counts ?? {};
  return (
    <div className="space-y-4">
      {msg && <div className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
      <div>
        <p className="text-xs text-gray-500 mb-2">
          A Nets OCR giro file or an ISO 20022 camt.054 (or camt.053) file from the bank. Payments are matched by KID{orgId ? ' to your own invoices' : ' to FlyttGo\'s invoices'};
          a bank transaction is never counted twice, and nothing is recorded until you confirm.
        </p>
        <input key={inputKey} type="file" accept=".txt,.ocr,.dat,.xml,text/plain,application/xml,text/xml" disabled={busy}
          onChange={e => choose(e.target.files?.[0])} className="text-sm" />
        <p className="text-[11px] text-gray-400 mt-1">
          Automatic fetch: {settings && settings.provider !== 'manual'
            ? `${settings.provider}${settings.fetch_enabled ? '' : ' (off)'}${settings.last_fetch_error ? ` · last attempt: ${settings.last_fetch_error}` : ''}`
            : 'not connected (needs an agreement with the bank or Nets)'}.
        </p>
      </div>

      {preview && chosen && (
        <div className="border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="text-sm">
            <strong>{chosen.name}</strong> · {FORMAT_LABELS[chosen.file.format]} · {preview.rows.length} credit{preview.rows.length === 1 ? '' : 's'}:{' '}
            {(Object.keys(OUTCOME_LABELS) as Array<keyof typeof OUTCOME_LABELS>).filter(k => counts[k]).map(k => `${counts[k]} ${OUTCOME_LABELS[k].toLowerCase()}`).join(', ') || 'nothing to record'}
          </div>
          {preview.already_imported_at && (
            <div className="text-xs text-red-700">This file was already imported on {new Date(preview.already_imported_at).toLocaleString('nb-NO')}; it cannot be imported again.</div>
          )}
          <PreviewTable rows={preview.rows} />
          <div className="flex gap-2">
            <button disabled={busy || !!preview.already_imported_at} className={`${btn} bg-gray-900 text-white`} onClick={confirmImport}>
              Confirm import{counts.matched ? ` (record ${counts.matched} payment${counts.matched === 1 ? '' : 's'})` : ''}
            </button>
            <button disabled={busy} className={`${btn} bg-gray-100 text-gray-700`} onClick={() => { setChosen(null); setPreview(null); setInputKey(k => k + 1); }}>Cancel</button>
          </div>
        </div>
      )}

      {result && (
        <div className="border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="text-sm font-medium">Result of {result.imp.file_name ?? 'the import'}</div>
          <ImportCounts imp={result.imp} />
          {result.rows.some(r => r.outcome === 'unmatched' || r.outcome === 'overpayment') && (
            <PreviewTable rows={result.rows.filter(r => r.outcome === 'unmatched' || r.outcome === 'overpayment')
              .map(r => ({ ...r, line: r.line_no, kid: r.kid ?? '', invoice_number: null, outstanding: null }))} />
          )}
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold mb-1">To handle by hand ({open.length})</h4>
        {open.length === 0 ? <p className="text-xs text-gray-400">Nothing waiting.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-500">{['Date', 'Amount', 'KID', 'From / text', 'Why', ''].map(h => <th key={h} className="py-1 pe-2">{h}</th>)}</tr></thead>
              <tbody>
                {open.map(r => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-1 pe-2 whitespace-nowrap">{r.paid_on}</td>
                    <td className="py-1 pe-2 whitespace-nowrap">{r.currency === 'NOK' ? formatNok(r.amount) : `${r.amount} ${r.currency}`}</td>
                    <td className="py-1 pe-2 font-mono">{r.kid ?? '—'}</td>
                    <td className="py-1 pe-2">{[r.payer, r.info].filter(Boolean).join(' · ') || '—'}</td>
                    <td className={`py-1 pe-2 ${TONE[r.outcome]}`}>{reasonLabel(r)}</td>
                    <td className="py-1 whitespace-nowrap">
                      {!r.reversal && r.currency === 'NOK' && (
                        <button disabled={busy} className={`${btn} bg-emerald-50 text-emerald-700 me-1`} onClick={() => resolve(r, true)}>Record…</button>
                      )}
                      <button disabled={busy} className={`${btn} bg-gray-100 text-gray-700`} onClick={() => resolve(r, false)}>Set aside…</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {imports.length > 0 && (
        <details>
          <summary className="text-xs text-gray-500 cursor-pointer">Earlier imports ({imports.length})</summary>
          <ul className="mt-1 space-y-1 text-xs text-gray-600">
            {imports.map(i => (
              <li key={i.id}>
                {new Date(i.imported_at).toLocaleString('nb-NO')} · {FORMAT_LABELS[i.format] ?? i.format} · {i.file_name ?? i.source}
                {' · '}<ImportCounts imp={i} inline />
                <span className="text-gray-400 font-mono"> · SHA-256 {i.sha256.slice(0, 12)}…</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ImportCounts({ imp, inline }: { imp: BankImport; inline?: boolean }) {
  const parts = [
    `${imp.matched} matched (${formatNok(imp.amount_matched)})`,
    imp.already_recorded + imp.already_imported ? `${imp.already_recorded + imp.already_imported} already handled` : '',
    imp.unmatched ? `${imp.unmatched} not matched` : '',
    imp.overpayments ? `${imp.overpayments} more than owed` : '',
  ].filter(Boolean).join(', ');
  return inline ? <span>{parts}</span> : <div className="text-xs text-gray-600">{imp.rows_total} credits: {parts}.</div>;
}

type Shown = { line: number; paid_on: string; amount: number; currency: string; kid: string; payer: string | null; info: string | null;
  outcome: keyof typeof OUTCOME_LABELS; reason: string | null; invoice_number: number | null; outstanding: number | null };

function PreviewTable({ rows }: { rows: Shown[] }) {
  return (
    <div className="overflow-x-auto max-h-80 overflow-y-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-gray-500">{['Line', 'Date', 'Amount', 'KID', 'From / text', 'Outcome'].map(h => <th key={h} className="py-1 pe-2">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t align-top">
              <td className="py-1 pe-2 text-gray-400">{r.line}</td>
              <td className="py-1 pe-2 whitespace-nowrap">{r.paid_on}</td>
              <td className="py-1 pe-2 whitespace-nowrap">{r.currency === 'NOK' ? formatNok(r.amount) : `${r.amount} ${r.currency}`}</td>
              <td className="py-1 pe-2 font-mono">{r.kid || '—'}</td>
              <td className="py-1 pe-2">{[r.payer, r.info].filter(Boolean).join(' · ') || '—'}</td>
              <td className={`py-1 pe-2 ${TONE[r.outcome]}`}>
                {reasonLabel(r)}
                {r.invoice_number ? ` · invoice ${r.invoice_number}${r.outstanding != null ? ` (owes ${formatNok(r.outstanding)})` : ''}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
