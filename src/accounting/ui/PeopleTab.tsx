/** The company's back office: who works on the books, invitations, and notes on the books. */
import { useCallback, useEffect, useState } from 'react';
import { day } from '../i18n';
import type { Invitation, Member, Note } from '../types';
import { btn, input, roleLabel, useOffice, useRunner } from './office';
import { Card, Message } from './parts';

const ROLES = ['accountant', 'bookkeeper', 'auditor', 'viewer'] as const;

export default function PeopleTab() {
  const { api, ledger, canManage, lang, t } = useOffice();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [form, setForm] = useState({ email: '', role: 'accountant', name: '', firm: '', validUntil: '' });
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const { busy, msg, run } = useRunner();

  const reload = useCallback(async () => {
    const [m, n] = await Promise.all([api.members(ledger.id), api.notes(ledger.id)]);
    setMembers(m); setNotes(n.filter(x => !x.voucher_id));
    if (canManage) setInvites(await api.invitations(ledger.id));
  }, [api, ledger.id, canManage]);
  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="space-y-4">
      <Message msg={msg} />
      {canManage && ledger.status === 'active' && (
        <Card title={t('invite')}>
          <div className="grid sm:grid-cols-6 gap-2 text-sm">
            <input className={`${input} sm:col-span-2`} type="email" placeholder={t('email')} aria-label={t('email')} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            <select className={input} aria-label={t('role')} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              {ROLES.map(r => <option key={r} value={r}>{roleLabel(t, r)}</option>)}</select>
            <input className={input} placeholder={t('name')} aria-label={t('name')} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className={input} placeholder={t('firm')} aria-label={t('firm')} value={form.firm} onChange={e => setForm({ ...form, firm: e.target.value })} />
            <label className="flex flex-col text-xs text-gray-600 -mt-4">{t('validUntil')}
              <input className={`${input} w-full min-w-0`} type="date" value={form.validUntil} onChange={e => setForm({ ...form, validUntil: e.target.value })} /></label>
          </div>
          {form.role === 'auditor' && !form.validUntil && <p className="text-xs text-amber-700 mt-2">{t('auditorNeedsEnd')}</p>}
          <button disabled={busy || !form.email || (form.role === 'auditor' && !form.validUntil)} className={`${btn} bg-gray-900 text-white mt-3`}
            onClick={() => run(async () => {
              const input = { ...form, validUntil: form.validUntil || null };
              if (api.host.invite) {
                const e = await api.host.invite(ledger.id, input, lang);
                if (e) return e;
              } else {
                const r = await api.invite(ledger.id, input);
                if (r.error) return r.error;
                const token = r.data[0].token;
                setLink(api.host.acceptUrl ? api.host.acceptUrl(token) : token);
              }
              setForm({ email: '', role: 'accountant', name: '', firm: '', validUntil: '' });
              await reload();
            }, api.host.invite ? `${t('invite')}: ${form.email}` : undefined)}>{t('invite')}</button>
          {link && <div className="mt-3 text-sm bg-gray-50 rounded-lg p-3 break-all">{t('inviteSent')} <span className="font-mono">{link}</span>
            <button className="ms-2 underline" onClick={() => navigator.clipboard?.writeText(link)}>{t('copyLink')}</button></div>}
        </Card>
      )}
      <Card title={t('people')}>
        <div className="divide-y text-sm">
          {members.map(m => (
            <div key={m.user_id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{m.name ?? m.email} {m.firm && <span className="text-gray-500">· {m.firm}</span>}</div>
                <div className="text-xs text-gray-500">{roleLabel(t, m.role)} · {m.email}{m.valid_until ? ` · ${t('validUntil')} ${day(m.valid_until, lang)}` : ''}
                  {m.status === 'removed' ? ` · ${t('removed')} ${day(m.removed_at, lang)}: ${m.removed_reason}` : ''}</div>
              </div>
              {canManage && m.status === 'active' && (
                <div className="flex gap-2">
                  <button disabled={busy} className={`${btn} bg-gray-100`} onClick={() => {
                    const until = prompt(`${t('validUntil')} (YYYY-MM-DD)`, m.valid_until ?? '');
                    if (until !== null) run(async () => { const r = await api.updateMember(ledger.id, m.user_id, m.role, until || null); await reload(); return r.error; }, t('done'));
                  }}>{t('change')}</button>
                  <button disabled={busy} className={`${btn} bg-gray-100 text-red-700`} onClick={() => {
                    const reason = prompt(t('reason'));
                    if (reason) run(async () => { const r = await api.removeMember(ledger.id, m.user_id, reason); await reload(); return r.error; }, t('done'));
                  }}>{t('remove')}</button>
                </div>
              )}
            </div>
          ))}
          {members.length === 0 && <p className="py-2 text-gray-500">—</p>}
        </div>
        {canManage && invites.length > 0 && <>
          <h4 className="font-semibold text-sm mt-4 mb-1">{t('invitations')}</h4>
          {invites.map(i => <div key={i.id} className="text-sm flex justify-between py-1">
            <span>{i.email} · {roleLabel(t, i.role)} · {day(i.expires_at, lang)}</span>
            <button className="underline" onClick={() => run(async () => { const r = await api.revokeInvitation(i.id); await reload(); return r.error; })}>{t('revoke')}</button></div>)}
        </>}
      </Card>
      <Card title={t('notes')}>
        {notes.map(n => <div key={n.id} className="bg-gray-50 rounded-lg px-3 py-2 mb-2 text-sm"><div className="text-xs text-gray-500">{day(n.created_at, lang)} · {roleLabel(t, n.role)}</div>{n.body}</div>)}
        <div className="flex gap-2">
          <input className={`${input} flex-1`} value={note} placeholder={t('writeNote')} aria-label={t('addNote')} onChange={e => setNote(e.target.value)} />
          <button disabled={busy || !note.trim()} className={`${btn} bg-gray-100`} onClick={() => run(async () => {
            const r = await api.addNote(ledger.id, null, note); if (!r.error) { setNote(''); await reload(); } return r.error;
          })}>{t('addNote')}</button>
        </div>
      </Card>
    </div>
  );
}
