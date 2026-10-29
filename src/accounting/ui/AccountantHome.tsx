/**
 * For accountants, auditors and others invited to companies' books: accept
 * an invitation (the link carries the token) and open each company's office.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AccountingApi } from '../api';
import type { MyLedger } from '../types';
import AccountingOffice from './AccountingOffice';
import type { DocumentsHost } from './DocumentsTab';
import { btn, roleLabel, translator, useLang } from './office';
import { Card, Message } from './parts';

export default function AccountantHome({ api, invitationToken, hostFor, onTokenUsed }: {
  api: AccountingApi;
  invitationToken?: string | null;
  /** The company details documents need, by tenant (null for the house ledger). */
  hostFor: (tenant: string | null) => Promise<DocumentsHost>;
  onTokenUsed?: () => void;
}) {
  const [lang] = useLang('no');
  const t = useMemo(() => translator(lang), [lang]);
  const [ledgers, setLedgers] = useState<MyLedger[] | null>(null);
  const [open, setOpen] = useState<MyLedger | null>(null);
  const [host, setHost] = useState<DocumentsHost | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      if (invitationToken) {
        const r = await api.accept(invitationToken);
        setMsg(r.error ? { ok: false, text: `${t('failed')} ${r.error}` } : { ok: true, text: t('done') });
        onTokenUsed?.();
      }
      const l = await api.myLedgers();
      setLedgers(l.data ?? []);
    })();
  }, [api, invitationToken]); // eslint-disable-line react-hooks/exhaustive-deps

  if (open && host) return (
    <div className="space-y-3">
      <button className={`${btn} bg-gray-100`} onClick={() => { setOpen(null); setHost(null); }}>← {t('office')}</button>
      <AccountingOffice api={api} ledgerId={open.ledger_id} host={host} defaultLang={lang} />
    </div>
  );
  return (
    <div className="space-y-4">
      <Message msg={msg} />
      <Card title={t('office')}>
        {ledgers === null ? <p className="text-sm text-gray-500">{t('loading')}</p> : ledgers.length === 0 ? <p className="text-sm text-gray-500">{t('noLedger')}</p> : (
          <div className="divide-y">{ledgers.map(l => (
            <button key={l.ledger_id} className="w-full text-left py-2.5 flex justify-between items-center"
              onClick={async () => { setHost(await hostFor(l.tenant_id)); setOpen(l); }}>
              <span className="font-medium">{l.legal_name}</span><span className="text-sm text-gray-500">{roleLabel(t, l.role)}{l.status === 'ended' ? ` · ${t('ended')}` : ''}</span>
            </button>))}</div>
        )}
      </Card>
    </div>
  );
}
