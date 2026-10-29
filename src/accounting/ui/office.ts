/** The accounting office's shared state and helpers (no components here). */
import { createContext, useContext, useState } from 'react';
import type { AccountingApi } from '../api';
import type { Lang } from '../documents/model';
import { t as tr, type StringKey } from '../i18n';
import type { Ledger, Role } from '../types';
export interface OfficeContext {
  api: AccountingApi;
  ledger: Ledger;
  role: Role;
  canManage: boolean;
  lang: Lang;
  t: (k: StringKey) => string;
  reloadLedger: () => Promise<void>;
}
export const Office = createContext<OfficeContext | null>(null);
export const useOffice = () => {
  const o = useContext(Office);
  if (!o) throw new Error('outside the accounting office');
  return o;
};

const LANG_KEY = 'accounting-lang';
export function useLang(initial: Lang = 'no'): [Lang, (l: Lang) => void] {
  const [lang, set] = useState<Lang>(() => {
    try { const v = localStorage.getItem(LANG_KEY); return v === 'en' || v === 'no' ? v : initial; } catch { return initial; }
  });
  return [lang, (l: Lang) => { set(l); try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ } }];
}
export const translator = (lang: Lang) => (k: StringKey) => tr(lang, k);

export const can = {
  post: (r: Role) => r === 'owner' || r === 'accountant' || r === 'bookkeeper',
  close: (r: Role) => r === 'owner' || r === 'accountant',
};

export const btn = 'px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50';
export const input = 'border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white';

export function useRunner() {
  const { t } = useOffice();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(fn: () => Promise<string | null | void>, ok?: string) {
    setBusy(true); setMsg(null);
    try {
      const e = await fn();
      setMsg(e ? { ok: false, text: `${t('failed')} ${e}` } : ok ? { ok: true, text: ok } : null);
    } catch (e) {
      setMsg({ ok: false, text: `${t('failed')} ${(e as Error).message}` });
    } finally { setBusy(false); }
  }
  return { busy, msg, setMsg, run };
}

export const today = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Oslo' })).toISOString().slice(0, 10);
export const yearStart = (y: number) => `${y}-01-01`;
export const yearEnd = (y: number) => `${y}-12-31`;
export function roleLabel(t: (k: StringKey) => string, r: Role | string): string {
  return ({ owner: t('roleOwner'), accountant: t('roleAccountant'), bookkeeper: t('roleBookkeeper'), auditor: t('roleAuditor'), viewer: t('roleViewer') } as Record<string, string>)[r] ?? r;
}
