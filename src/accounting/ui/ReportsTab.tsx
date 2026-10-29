/** Reports on screen: trial balance, income statement, balance sheet, MVA per term (with settlement) and the checks. */
import { useEffect, useState } from 'react';
import { day, money } from '../i18n';
import type { CheckRow, MvaRow, StatementRow, TrialRow } from '../types';
import { btn, can, input, useOffice, useRunner, yearEnd, yearStart } from './office';
import { Card, Message, Table } from './parts';

type View = 'trial' | 'income' | 'balance' | 'mva' | 'checks';

export default function ReportsTab() {
  const { api, ledger, role, lang, t } = useOffice();
  const [year, setYear] = useState(new Date().getFullYear());
  const [view, setView] = useState<View>('trial');
  const terms = ledger.mva_term === 'yearly' ? [1] : [1, 2, 3, 4, 5, 6];
  const [term, setTerm] = useState(ledger.mva_term === 'yearly' ? 1 : Math.ceil((new Date().getMonth() + 1) / 2));
  const [trial, setTrial] = useState<TrialRow[]>([]);
  const [statement, setStatement] = useState<StatementRow[]>([]);
  const [mva, setMva] = useState<MvaRow[]>([]);
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const { busy, msg, setMsg, run } = useRunner();
  const from = yearStart(year), to = yearEnd(year);

  useEffect(() => {
    setMsg(null);
    const show = <T,>(r: { data: T | null; error: string | null }, set: (v: T) => void) => { if (r.error) setMsg({ ok: false, text: r.error }); else set(r.data as T); };
    if (view === 'trial') api.trialBalance(ledger.id, from, to).then(r => show(r, setTrial));
    if (view === 'income') api.incomeStatement(ledger.id, from, to).then(r => show(r, setStatement));
    if (view === 'balance') api.balanceSheet(ledger.id, to).then(r => show(r, setStatement));
    if (view === 'mva') api.mvaReport(ledger.id, year, term).then(r => show(r, setMva));
    if (view === 'checks') api.checks(ledger.id, from, to).then(r => show(r, setChecks));
  }, [api, ledger.id, view, year, term, from, to, setMsg]);

  const views: Array<[View, string]> = [['trial', t('trialBalance')], ['income', t('incomeStatement')], ['balance', t('balanceSheet')], ['mva', t('mvaReturn')], ['checks', t('checks')]];
  const out = mva.filter(r => r.direction === 'output').reduce((s, r) => s + Number(r.mva), 0);
  const inn = mva.filter(r => r.direction === 'input').reduce((s, r) => s + Number(r.mva), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1" role="tablist">
          {views.map(([k, label]) => <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
            className={`${btn} ${view === k ? 'bg-gray-900 text-white' : 'bg-white border'}`}>{label}</button>)}
        </div>
        <label className="text-sm flex flex-col ms-auto">{t('year')}
          <input type="number" className={`${input} w-24`} value={year} onChange={e => setYear(Number(e.target.value))} /></label>
        {view === 'mva' && <label className="text-sm flex flex-col">{t('term')}
          <select className={input} value={term} onChange={e => setTerm(Number(e.target.value))}>{terms.map(x => <option key={x} value={x}>{x}</option>)}</select></label>}
      </div>
      <Message msg={msg} />
      <Card>
        {view === 'trial' && <Table head={[t('account'), t('accountName'), t('opening'), t('debit'), t('credit'), t('closing')]} right={[2, 3, 4, 5]}
          rows={trial.map(r => [r.account_code, r.account_name, money(r.opening, lang), money(r.debit, lang), money(r.credit, lang), money(r.closing, lang)])}
          foot={['', t('total'), '', money(trial.reduce((s, r) => s + Number(r.debit), 0), lang), money(trial.reduce((s, r) => s + Number(r.credit), 0), lang), '']} />}
        {(view === 'income' || view === 'balance') && <Table head={['', t('account'), t('accountName'), t('amount')]} right={[3]}
          rows={statement.map(r => [r.grp.slice(2), r.account_code ?? '', r.account_code ? r.account_name : t('unclosedResult'),
                                     money(view === 'income' && r.grp.startsWith('2') ? -Number(r.amount) : r.amount, lang)])}
          foot={view === 'income' ? ['', '', t('result'), money(statement.reduce((s, r) => s + Number(r.amount), 0), lang)] : undefined} />}
        {view === 'mva' && <>
          <Table head={[t('mvaCode'), t('description'), '%', t('basis'), t('mva')]} right={[2, 3, 4]}
            rows={mva.map(r => [r.mva_code, r.description, String(Number(r.rate)), money(r.basis, lang), r.direction === 'none' ? '' : money(r.mva, lang)])} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>{out - inn >= 0 ? t('mvaPayable') : t('mvaRefund')}: <strong>{money(Math.abs(out - inn), lang)}</strong>
              {mva[0] && <span className="text-gray-500"> · {day(mva[0].term_from, lang)} – {day(mva[0].term_to, lang)}</span>}</span>
            {can.close(role) && ledger.status === 'active' &&
              <button disabled={busy || mva.length === 0} className={`${btn} bg-gray-900 text-white`}
                onClick={() => { if (confirm(t('confirm'))) run(async () => (await api.settleMva(ledger.id, year, term)).error, t('done')); }}>{t('settleMva')}</button>}
          </div>
        </>}
        {view === 'checks' && <Table head={[t('check'), t('result_'), t('detail')]}
          rows={checks.map(c => [c.check_name, <span key="s" className={c.ok ? 'text-emerald-700' : 'text-amber-700 font-semibold'}>{c.ok ? t('ok') : t('attention')}</span>, c.detail])} />}
      </Card>
    </div>
  );
}
