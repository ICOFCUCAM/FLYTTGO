/**
 * The accounting office: one company's books, for its owners and the
 * people in its back office. Switches between English and Norwegian.
 * Portable: it receives the API (createAccountingApi) and what the host
 * knows about the company, and imports nothing from the host.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountingApi } from '../api';
import { bandRange, money } from '../i18n';
import type { CheckRow, Ledger, PriceTier, Role, TierInfo, Unposted } from '../types';
import DocumentsTab, { type DocumentsHost } from './DocumentsTab';
import { btn, input, Office, roleLabel, translator, useLang, useOffice, useRunner, yearStart, today } from './office';
import { Card, Message } from './parts';
import PeopleTab from './PeopleTab';
import ReportsTab from './ReportsTab';
import SettingsTab from './SettingsTab';
import VouchersTab from './VouchersTab';

type Tab = 'overview' | 'vouchers' | 'reports' | 'documents' | 'people' | 'settings';

export interface AccountingOfficeProps {
  api: AccountingApi;
  /** The ledger to open, or the tenant whose ledger to open (or offer). */
  ledgerId?: string;
  tenantId?: string;
  host: DocumentsHost;
  defaultLang?: 'en' | 'no';
}

export default function AccountingOffice({ api, ledgerId, tenantId, host, defaultLang = 'no' }: AccountingOfficeProps) {
  const [lang, setLang] = useLang(defaultLang);
  const t = useMemo(() => translator(lang), [lang]);
  const [ledger, setLedger] = useState<Ledger | null | undefined>(undefined);
  const [role, setRole] = useState<Role | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

  const reloadLedger = useCallback(async () => {
    const l = ledgerId ? await api.ledger(ledgerId) : tenantId ? await api.ledgerForTenant(tenantId) : null;
    setLedger(l);
    if (l) {
      const [r, m] = await Promise.all([api.roleOf(l.id), api.canManage(l.id)]);
      setRole((r.data as Role | null) ?? null); setCanManage(!!m.data);
    }
  }, [api, ledgerId, tenantId]);
  useEffect(() => { reloadLedger(); }, [reloadLedger]);

  const switcher = (
    <div className="flex items-center gap-1 text-sm" role="group" aria-label={t('language')}>
      {(['no', 'en'] as const).map(l => <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
        className={`px-2.5 py-1 rounded-lg ${lang === l ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}>{l === 'no' ? 'Norsk' : 'English'}</button>)}
    </div>
  );

  if (ledger === undefined) return <p className="text-sm text-gray-500">{t('loading')}</p>;
  if (!ledger || ledger.status === 'requested' || ledger.status === 'declined' || !role) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center"><h2 className="text-xl font-bold">{t('office')}</h2>{switcher}</div>
        {tenantId ? <Offer api={api} tenantId={tenantId} ledger={ledger} t={t} lang={lang} onDone={reloadLedger} /> : <p className="text-sm text-gray-500">{t('noLedger')}</p>}
      </div>
    );
  }

  const tabs: Array<[Tab, string]> = [['overview', t('tabOverview')], ['vouchers', t('tabVouchers')], ['reports', t('tabReports')],
    ['documents', t('tabDocuments')], ['people', t('tabPeople')], ['settings', t('tabSettings')]];
  return (
    <Office.Provider value={{ api, ledger, role, canManage, lang, t, reloadLedger }}>
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h2 className="text-xl font-bold">{t('office')} · {ledger.legal_name}</h2>
            <p className="text-xs text-gray-500">{t('role')}: {roleLabel(t, role)}{ledger.status === 'ended' ? ` · ${t('ended')}` : ''}</p>
          </div>
          {switcher}
        </div>
        <div className="flex flex-wrap gap-1 border-b" role="tablist">
          {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === k ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'}`}>{label}</button>)}
        </div>
        {tab === 'overview' && <Overview />}
        {tab === 'vouchers' && <VouchersTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'documents' && <DocumentsTab host={host} />}
        {tab === 'people' && <PeopleTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </Office.Provider>
  );
}

function Overview() {
  const { api, ledger, role, lang, t } = useOffice();
  const [tier, setTier] = useState<TierInfo | null>(null);
  const [unposted, setUnposted] = useState<Unposted[] | null>(null);
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const { busy, msg, run } = useRunner();
  const load = useCallback(async () => {
    const year = new Date().getFullYear();
    api.checks(ledger.id, yearStart(year), today()).then(r => setChecks(r.data ?? []));
    if (api.host.tier) setTier(await api.host.tier(ledger.id));
    if (api.host.unposted) setUnposted(await api.host.unposted(ledger.id));
  }, [api, ledger.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="md:col-span-2"><Message msg={msg} /></div>
      <Card title={t('checks')}>
        <ul className="text-sm space-y-1">{checks.map(c => <li key={c.check_name} className="flex justify-between gap-3">
          <span>{c.check_name}</span><span className={c.ok ? 'text-emerald-700' : 'text-amber-700 font-semibold'}>{c.ok ? t('ok') : `${t('attention')}: ${c.detail}`}</span></li>)}</ul>
      </Card>
      {unposted && (
        <Card title={t('unposted')}>
          {unposted.length === 0 ? <p className="text-sm text-gray-500">{t('nothingUnposted')}</p> : <>
            <ul className="text-sm mb-3">{unposted.slice(0, 8).map(u => <li key={u.source_id} className="flex justify-between"><span>{u.description}</span><span className="tabular-nums">{money(u.amount, lang)}</span></li>)}</ul>
            {(role === 'owner' || role === 'accountant') && api.host.postUnposted && ledger.status === 'active' &&
              <button disabled={busy} className={`${btn} bg-gray-900 text-white`} onClick={() => run(async () => { await api.host.postUnposted!(ledger.id); await load(); }, t('done'))}>{t('postUnposted')}</button>}
          </>}
        </Card>
      )}
      {tier && (
        <Card title={t('price')}>
          <p className="text-sm">{tier.tier ?? '—'}{tier.monthly_fee !== null ? `: ${money(tier.monthly_fee, lang)} ${t('perMonth')} ${t('exclVat')}` : ''}</p>
          <p className="text-xs text-gray-500 mt-1">{money(tier.turnover, lang)} · {tier.basis}</p>
        </Card>
      )}
    </div>
  );
}

function Offer({ api, tenantId, ledger, t, lang, onDone }: {
  api: AccountingApi; tenantId: string; ledger: Ledger | null; t: (k: Parameters<ReturnType<typeof translator>>[0]) => string; lang: 'en' | 'no'; onDone: () => Promise<void>;
}) {
  const [list, setList] = useState<{ tiers: PriceTier[]; price_status: string } | null>(null);
  const first = new Date(); first.setDate(1);
  const [start, setStart] = useState(`${first.getFullYear()}-01-01`);
  const [turnover, setTurnover] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { api.host.priceList?.().then(setList); }, [api]);
  if (ledger?.status === 'requested') return <Card><p className="text-sm">{t('requested')}</p></Card>;
  let lower = 0;
  return (
    <Card title={t('offerTitle')}>
      <p className="text-sm text-gray-600 mb-3">{t('offerBody')}</p>
      {ledger?.status === 'declined' && <p className="text-sm text-red-700 mb-2">{t('declined')}</p>}
      {list && (
        <div className="mb-4">
          <p className="text-sm font-medium mb-1">{t('offerPrice')}</p>
          <table className="text-sm"><tbody>{list.tiers.map(tier => {
            const row = <tr key={tier.name}><td className="pe-4">{tier.name}</td>
              <td className="pe-4 text-gray-500">NOK {bandRange(lower, tier.up_to, lang)}</td>
              <td className="font-medium">{tier.monthly_fee === null ? t('offerAgreed') : `${money(tier.monthly_fee, lang)} ${t('perMonth')} ${t('exclVat')}`}</td></tr>;
            lower = tier.up_to ?? lower;
            return row;
          })}</tbody></table>
          {list.price_status !== 'confirmed' && <p className="text-xs text-amber-700 mt-1">{t('offerProposed')}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col">{t('startDate')}<input type="date" className={input} value={start} onChange={e => setStart(e.target.value)} /></label>
        <label className="flex flex-col">{t('declaredTurnover')}<input type="number" min="0" className={input} value={turnover} onChange={e => setTurnover(e.target.value)} /></label>
        <button disabled={busy} className={`${btn} bg-gray-900 text-white`} onClick={async () => {
          setBusy(true); setMsg(null);
          const r = await api.request(tenantId, start.slice(0, 8) + '01', 'bimonthly', turnover ? Number(turnover) : null);
          setBusy(false);
          if (r.error) setMsg({ ok: false, text: `${t('failed')} ${r.error}` }); else await onDone();
        }}>{t('ask')}</button>
      </div>
      <div className="mt-3"><Message msg={msg} /></div>
    </Card>
  );
}
