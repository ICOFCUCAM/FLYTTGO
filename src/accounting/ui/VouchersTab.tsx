/** Vouchers: the list for a period, a new manual voucher, receipts, reversal and notes. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { day, money } from '../i18n';
import type { Account, Attachment, DraftLine, MvaCode, Note, Voucher, VoucherLine } from '../types';
import { btn, can, input, today, useOffice, useRunner, yearEnd, yearStart } from './office';
import { Card, Message } from './parts';

export default function VouchersTab() {
  const { api, ledger, role, lang, t } = useOffice();
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(yearStart(year));
  const [to, setTo] = useState(yearEnd(year));
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [lines, setLines] = useState<VoucherLine[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [codes, setCodes] = useState<MvaCode[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const { busy, msg, run } = useRunner();

  const reload = useCallback(async () => {
    const v = await api.vouchers(ledger.id, from, to);
    setVouchers(v.reverse());
    const ids = v.map(x => x.id);
    const [l, a, n] = await Promise.all([api.lines(ids), api.attachments(ids), api.notes(ledger.id)]);
    setLines(l); setFiles(a); setNotes(n);
  }, [api, ledger.id, from, to]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { api.accounts(ledger.id).then(setAccounts); api.mvaCodes().then(setCodes); }, [api, ledger.id]);

  const reversed = useMemo(() => new Set(vouchers.map(v => v.reverses_voucher).filter(Boolean) as string[]), [vouchers]);
  const names = useMemo(() => new Map(accounts.map(a => [a.code, a.name])), [accounts]);

  return (
    <div className="space-y-4">
      <Message msg={msg} />
      <Card title={t('tabVouchers')} actions={can.post(role) && ledger.status === 'active'
        ? <button className={`${btn} bg-gray-900 text-white`} onClick={() => setShowNew(s => !s)}>{showNew ? t('close') : t('newVoucher')}</button> : undefined}>
        {showNew && <NewVoucher accounts={accounts} codes={codes} onDone={async () => { setShowNew(false); await reload(); }} />}
        <div className="flex flex-wrap items-end gap-3 my-3 text-sm">
          <label className="flex flex-col">{t('from')}<input type="date" className={input} value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="flex flex-col">{t('to')}<input type="date" className={input} value={to} onChange={e => setTo(e.target.value)} /></label>
        </div>
        <div className="divide-y">
          {vouchers.map(v => {
            const ls = lines.filter(l => l.voucher_id === v.id);
            const total = ls.reduce((s, l) => s + Number(l.debit), 0);
            const fs = files.filter(f => f.voucher_id === v.id);
            const ns = notes.filter(n => n.voucher_id === v.id);
            return (
              <div key={v.id} className="py-2">
                <button className="w-full flex flex-wrap items-center justify-between gap-2 text-left text-sm" onClick={() => setOpen(open === v.id ? null : v.id)} aria-expanded={open === v.id}>
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-gray-500 w-20 shrink-0">{v.year}-{v.number}</span>
                    <span className="text-gray-500 w-24 shrink-0">{day(v.voucher_date, lang)}</span>
                    <span className="truncate">{v.description}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded-full ${v.source_type === 'manual' ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
                      {v.source_type === 'manual' ? t('manual') : t('automatic')}</span>
                    {reversed.has(v.id) && <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{t('reversed')}</span>}
                    {v.source_type === 'manual' && fs.length === 0 && <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700">{t('noReceipt')}</span>}
                    <span className="tabular-nums font-medium text-sm">{money(total, lang)}</span>
                  </span>
                </button>
                {open === v.id && (
                  <div className="mt-2 ms-2 sm:ms-24 space-y-3">
                    <table className="w-full text-sm">
                      <thead><tr className="text-gray-500 text-left"><th className="py-1">{t('account')}</th><th>{t('description')}</th><th>{t('mvaCode')}</th><th className="text-right">{t('debit')}</th><th className="text-right">{t('credit')}</th></tr></thead>
                      <tbody>{ls.map(l => <tr key={l.id} className="border-t border-gray-100">
                        <td className="py-1">{l.account_code} <span className="text-gray-500">{names.get(l.account_code)}</span></td>
                        <td>{l.description ?? l.party ?? ''}</td><td>{l.mva_code ?? ''}</td>
                        <td className="text-right tabular-nums">{Number(l.debit) ? money(l.debit, lang) : ''}</td>
                        <td className="text-right tabular-nums">{Number(l.credit) ? money(l.credit, lang) : ''}</td></tr>)}</tbody>
                    </table>
                    <div className="flex flex-wrap gap-2 items-center text-sm">
                      {fs.map(f => <button key={f.id} className="underline text-gray-700" onClick={async () => { const u = await api.receiptUrl(f.storage_path); if (u) window.open(u, '_blank', 'noopener'); }}>{f.file_name}</button>)}
                      {can.post(role) && ledger.status === 'active' && (
                        <label className={`${btn} bg-gray-100 cursor-pointer`}>{t('attachReceipt')}
                          <input type="file" className="hidden" accept="application/pdf,image/jpeg,image/png,image/heic,.xml"
                            onChange={e => { const f = e.target.files?.[0]; if (f) run(async () => { const r = await api.attach(ledger.id, v.id, f, f.name); await reload(); return r.error; }, t('done')); }} />
                        </label>)}
                      {can.close(role) && v.source_type === 'manual' && !reversed.has(v.id) && ledger.status === 'active' && (
                        <button disabled={busy} className={`${btn} bg-gray-100`} onClick={() => {
                          const reason = prompt(t('reason'));
                          if (reason) run(async () => { const r = await api.reverse(v.id, today(), reason); await reload(); return r.error; }, t('done'));
                        }}>{t('reverse')}</button>)}
                    </div>
                    <NotesFor voucher={v.id} notes={ns} onAdded={reload} />
                  </div>
                )}
              </div>
            );
          })}
          {vouchers.length === 0 && <p className="text-sm text-gray-500 py-3">—</p>}
        </div>
      </Card>
    </div>
  );
}

function NotesFor({ voucher, notes, onAdded }: { voucher: string | null; notes: Note[]; onAdded: () => Promise<void> }) {
  const { api, ledger, lang, t } = useOffice();
  const [body, setBody] = useState('');
  const { busy, run } = useRunner();
  return (
    <div className="text-sm">
      {notes.map(n => <div key={n.id} className="bg-gray-50 rounded-lg px-3 py-1.5 mb-1"><span className="text-xs text-gray-500">{day(n.created_at, lang)} · {n.role}</span><div>{n.body}</div></div>)}
      <div className="flex gap-2">
        <input className={`${input} flex-1`} value={body} placeholder={t('writeNote')} onChange={e => setBody(e.target.value)} aria-label={t('addNote')} />
        <button disabled={busy || !body.trim()} className={`${btn} bg-gray-100`}
          onClick={() => run(async () => { const r = await api.addNote(ledger.id, voucher, body); if (!r.error) { setBody(''); await onAdded(); } return r.error; })}>{t('addNote')}</button>
      </div>
    </div>
  );
}

function NewVoucher({ accounts, codes, onDone }: { accounts: Account[]; codes: MvaCode[]; onDone: () => Promise<void> }) {
  const { api, ledger, lang, t } = useOffice();
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<DraftLine[]>([{ account: '', amount: 0, mva_code: null, party: '' }, { account: '', amount: 0, mva_code: null, party: '' }]);
  const [file, setFile] = useState<File | null>(null);
  const { busy, msg, run } = useRunner();
  const active = accounts.filter(a => a.active);
  const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const set = (i: number, p: Partial<DraftLine>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <div className="border border-gray-200 rounded-xl p-4 mb-4 bg-gray-50 space-y-3">
      <Message msg={msg} />
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex flex-col">{t('date')}<input type="date" className={input} value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="flex flex-col flex-1 min-w-[240px]">{t('description')}<input className={input} value={description} onChange={e => setDescription(e.target.value)} /></label>
      </div>
      <p className="text-xs text-gray-500">{t('positiveDebit')} {t('grossNote')}</p>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 text-sm">
          <select className={`${input} col-span-12 sm:col-span-4`} value={r.account} aria-label={t('account')}
            onChange={e => { const a = active.find(x => x.code === e.target.value); set(i, { account: e.target.value, mva_code: ledger.vat_registered ? a?.default_mva_code ?? null : null }); }}>
            <option value="">{t('account')}</option>
            {active.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
          </select>
          <input type="number" step="0.01" className={`${input} col-span-4 sm:col-span-2 text-right`} value={r.amount || ''} aria-label={t('amount')}
            onChange={e => set(i, { amount: Number(e.target.value) })} />
          <select className={`${input} col-span-4 sm:col-span-2`} value={r.mva_code ?? ''} aria-label={t('mvaCode')} disabled={!ledger.vat_registered}
            onChange={e => set(i, { mva_code: e.target.value || null })}>
            <option value="">—</option>{codes.map(c => <option key={c.code} value={c.code}>{c.code} ({Number(c.rate)} %)</option>)}
          </select>
          <input className={`${input} col-span-4 sm:col-span-3`} value={r.party ?? ''} placeholder={t('party')} aria-label={t('party')} onChange={e => set(i, { party: e.target.value })} />
          <button className="col-span-12 sm:col-span-1 text-gray-400 hover:text-red-600" aria-label={t('remove')} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button className={`${btn} bg-white border`} onClick={() => setRows(rs => [...rs, { account: '', amount: 0, mva_code: null, party: '' }])}>{t('addLine')}</button>
        <span className={Math.abs(sum) < 0.005 ? 'text-emerald-700' : 'text-red-700'}>{Math.abs(sum) < 0.005 ? t('balanced') : `${t('unbalanced')} ${money(sum, lang)}`}</span>
        <label className="ms-auto">{t('receipt')}: <input type="file" accept="application/pdf,image/jpeg,image/png,image/heic,.xml" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
        <button disabled={busy || Math.abs(sum) >= 0.005 || !description.trim() || rows.some(r => !r.account || !r.amount)} className={`${btn} bg-gray-900 text-white`}
          onClick={() => run(async () => {
            const r = await api.post(ledger.id, date, description, rows.map(x => ({ ...x, party: x.party || null })));
            if (r.error) return r.error;
            if (file) { const a = await api.attach(ledger.id, r.data.id, file, file.name); if (a.error) return a.error; }
            await onDone();
          }, t('done'))}>{t('postVoucher')}</button>
      </div>
    </div>
  );
}
