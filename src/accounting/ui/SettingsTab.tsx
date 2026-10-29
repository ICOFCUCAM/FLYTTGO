/** Settings: MVA, automatic posting, closing periods and the year, and the chart of accounts with its tax-return grouping. */
import { useEffect, useState } from 'react';
import { GROUPING_CODES } from '../data/naeringsspesifikasjon';
import { day } from '../i18n';
import type { Account, MvaCode } from '../types';
import { btn, can, input, today, useOffice, useRunner } from './office';
import { Card, Message } from './parts';

export default function SettingsTab() {
  const { api, ledger, role, canManage, lang, t, reloadLedger } = useOffice();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [codes, setCodes] = useState<MvaCode[]>([]);
  const [lockDate, setLockDate] = useState('');
  const [newAcc, setNewAcc] = useState({ code: '', name: '', mva: '', grouping: '' });
  const { busy, msg, run } = useRunner();
  const editable = can.close(role) && ledger.status === 'active';
  const reload = () => api.accounts(ledger.id).then(setAccounts);
  useEffect(() => { reload(); api.mvaCodes().then(setCodes); }, [ledger.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setting = (s: Parameters<typeof api.setSettings>[1]) => run(async () => { const r = await api.setSettings(ledger.id, s); await reloadLedger(); return r.error; }, t('done'));
  const grouping = (code: string) => GROUPING_CODES.find(g => g.code === code);

  return (
    <div className="space-y-4">
      <Message msg={msg} />
      <Card title={t('settings')}>
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!editable} checked={ledger.vat_registered}
            onChange={e => setting({ vat_registered: e.target.checked })} /> {t('vatRegistered')}</label>
          <label className="flex flex-wrap items-center gap-2">{t('mvaTerm')}
            <select className={input} disabled={!editable} value={ledger.mva_term} onChange={e => setting({ mva_term: e.target.value as 'bimonthly' | 'yearly' })}>
              <option value="bimonthly">{t('bimonthly')}</option><option value="yearly">{t('yearly')}</option></select></label>
          <label className="flex flex-wrap items-center gap-2">{t('zeroRate')}
            <select className={input} disabled={!editable} value={ledger.zero_rate_code} onChange={e => setting({ zero_rate_code: e.target.value as '5' | '6' })}>
              <option value="6">{t('zeroRate6')}</option><option value="5">{t('zeroRate5')}</option></select></label>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!editable} checked={ledger.auto_post}
            onChange={e => setting({ auto_post: e.target.checked })} /> {t('autoPost')}</label>
        </div>
      </Card>
      {canManage && ledger.tenant_id && ledger.status === 'active' && (
        <Card title={t('cancelTitle')}>
          {ledger.cancel_at ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>{t('cancelledUntil')} <strong>{day(ledger.cancel_at, lang)}</strong></span>
              <button disabled={busy} className={`${btn} bg-gray-100`} onClick={() =>
                run(async () => { const r = await api.resume(ledger.id); await reloadLedger(); return r.error; }, t('done'))}>{t('withdraw')}</button>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-3">{t('cancelBody')}</p>
              <button disabled={busy} className={`${btn} bg-gray-100 text-red-700`} onClick={() => {
                const reason = prompt(t('reason'));
                if (reason !== null && confirm(t('confirm'))) run(async () => { const r = await api.end(ledger.id, reason); await reloadLedger(); return r.error; }, t('done'));
              }}>{t('cancelButton')}</button>
            </>
          )}
        </Card>
      )}
      {editable && (
        <Card title={`${t('lockPeriod')} · ${t('closeYear')}`}>
          <p className="text-sm text-gray-600 mb-2">{ledger.locked_until ? `${t('lockedUntil')} ${day(ledger.locked_until, lang)}` : '—'}</p>
          <div className="flex flex-wrap gap-2 items-center text-sm">
            <input type="date" className={input} max={today()} value={lockDate} onChange={e => setLockDate(e.target.value)} aria-label={t('lockPeriod')} />
            <button disabled={busy || !lockDate} className={`${btn} bg-gray-900 text-white`} onClick={() => {
              if (confirm(t('confirm'))) run(async () => { const r = await api.lock(ledger.id, lockDate); await reloadLedger(); return r.error; }, t('done'));
            }}>{t('lockPeriod')}</button>
            <button disabled={busy} className={`${btn} bg-gray-100 ms-auto`} onClick={() => {
              const y = new Date().getFullYear() - 1;
              if (confirm(`${t('closeYear')} ${y}? ${t('confirm')}`)) run(async () => (await api.closeYear(ledger.id, y)).error, t('done'));
            }}>{t('closeYear')} {new Date().getFullYear() - 1}</button>
          </div>
        </Card>
      )}
      <Card title={t('chart')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b"><th className="py-1">{t('account')}</th><th>{t('accountName')}</th><th>{t('mvaCode')}</th><th>{t('grouping')}</th></tr></thead>
            <tbody>{accounts.map(a => (
              <tr key={a.code} className={`border-b border-gray-100 ${a.active ? '' : 'text-gray-400'}`}>
                <td className="py-1 font-mono">{a.code}</td><td>{a.name}</td><td>{a.default_mva_code ?? ''}</td>
                <td>
                  {editable ? (
                    <select className={`${input} max-w-[16rem]`} value={a.grouping_code ?? ''} aria-label={`${t('grouping')} ${a.code}`}
                      onChange={e => { const g = grouping(e.target.value); run(async () => { const r = await api.saveAccount(ledger.id, { code: a.code, name: a.name, mva: a.default_mva_code, active: a.active, groupingCategory: g?.category ?? null, groupingCode: g?.code ?? null }); await reload(); return r.error; }); }}>
                      <option value="">—</option>
                      {GROUPING_CODES.map(g => <option key={`${g.category}:${g.code}`} value={g.code}>{g.code} {lang === 'no' ? g.no : g.en}</option>)}
                    </select>
                  ) : <span>{a.grouping_code} {a.grouping_code ? (lang === 'no' ? grouping(a.grouping_code)?.no : grouping(a.grouping_code)?.en) : ''}</span>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {editable && (
          <div className="grid sm:grid-cols-5 gap-2 mt-3 text-sm">
            <input className={input} placeholder="6420" aria-label={t('account')} value={newAcc.code} onChange={e => setNewAcc({ ...newAcc, code: e.target.value })} />
            <input className={`${input} sm:col-span-2`} placeholder={t('accountName')} aria-label={t('accountName')} value={newAcc.name} onChange={e => setNewAcc({ ...newAcc, name: e.target.value })} />
            <select className={input} aria-label={t('mvaCode')} value={newAcc.mva} onChange={e => setNewAcc({ ...newAcc, mva: e.target.value })}>
              <option value="">—</option>{codes.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}</select>
            <button disabled={busy || !/^[1-8]\d{3}$/.test(newAcc.code) || !newAcc.name} className={`${btn} bg-gray-900 text-white`} onClick={() => run(async () => {
              const r = await api.saveAccount(ledger.id, { code: newAcc.code, name: newAcc.name, mva: newAcc.mva || null, active: true });
              if (!r.error) setNewAcc({ code: '', name: '', mva: '', grouping: '' });
              await reload(); return r.error;
            }, t('done'))}>{t('add')}</button>
          </div>
        )}
      </Card>
    </div>
  );
}
