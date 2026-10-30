/**
 * Admin → Inbox: what visitors send from the contact page, the corporate
 * quote form and the newsletter sign-up (migration 00026,
 * contact_messages). Only FlyttGo administrators can read them (RLS); an
 * administrator marks a message handled once it is answered (who and when
 * are recorded) or puts it back to new. Answer by email: no email is sent
 * from here yet (docs/CONTACT_INBOX.md).
 */
import { useCallback, useEffect, useState } from 'react';
import { loadContactMessages, setContactMessageStatus, type ContactMessage } from '../../lib/contact';

const SOURCE_LABELS: Record<ContactMessage['source'], string> = {
  contact: 'Contact page', corporate: 'Corporate quote', newsletter: 'Newsletter sign-up',
};

export default function InboxPanel() {
  const [filter, setFilter] = useState<'new' | 'handled' | 'all'>('new');
  const [rows, setRows] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const { rows: r, error } = await loadContactMessages(filter);
    setRows(r);
    setLoading(false);
    if (error) setMessage({ ok: false, text: error });
  }, [filter]);
  useEffect(() => { reload(); }, [reload]);

  async function mark(m: ContactMessage, status: 'new' | 'handled') {
    setBusy(m.id); setMessage(null);
    const err = await setContactMessageStatus(m.id, status);
    setBusy(null);
    setMessage(err ? { ok: false, text: err } : { ok: true, text: status === 'handled' ? 'Marked handled.' : 'Back to new.' });
    await reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Inbox</h1>
          <p className="text-sm text-gray-500">Messages from the contact page, the corporate quote form and newsletter sign-ups. Reply by email, then mark the message handled.</p>
        </div>
        <div className="flex gap-2">
          {(['new', 'handled', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm capitalize ${filter === f ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200'}`}>{f}</button>
          ))}
        </div>
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-2 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{message.text}</div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500 bg-white rounded-lg shadow p-5">No {filter === 'all' ? '' : `${filter} `}messages.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map(m => (
            <li key={m.id} className="bg-white rounded-lg shadow p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-gray-500">
                    {SOURCE_LABELS[m.source]} · {new Date(m.created_at).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' })}
                    {m.status === 'handled' && m.handled_at && <> · handled {new Date(m.handled_at).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' })}</>}
                  </div>
                  <div className="font-semibold text-gray-900 mt-1">{m.topic ?? '(no subject)'}</div>
                  <div className="text-sm text-gray-700 mt-1">
                    {[m.name, m.company].filter(Boolean).join(' · ')}{(m.name || m.company) && ' · '}
                    <a className="text-emerald-700 hover:underline" href={`mailto:${m.email}`}>{m.email}</a>
                    {m.phone && <> · {m.phone}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${m.status === 'new' ? 'bg-yellow-100 text-yellow-700' : 'bg-emerald-100 text-emerald-700'}`}>{m.status}</span>
                  {m.status === 'new' ? (
                    <button disabled={busy === m.id} onClick={() => mark(m, 'handled')}
                      className="px-3 py-1.5 rounded-lg text-sm bg-emerald-600 text-white disabled:opacity-50">Mark handled</button>
                  ) : (
                    <button disabled={busy === m.id} onClick={() => mark(m, 'new')}
                      className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 disabled:opacity-50">Back to new</button>
                  )}
                </div>
              </div>
              {m.message && <p className="text-sm text-gray-700 mt-3 whitespace-pre-wrap break-words">{m.message}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
