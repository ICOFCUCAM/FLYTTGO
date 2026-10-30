/**
 * Corporate dashboard → API and widget (migration 00018, docs/API.md,
 * docs/WHITE_LABEL.md → Booking widget). Owners and admins of an active
 * company create, scope and revoke API keys (the key is shown once), list
 * the websites that may show the booking widget, and copy the widget's
 * snippet with a live preview. The database decides every permission; the
 * panel only hides what the member's role cannot do. The widget is in
 * every plan; API access is the add-on 'api' FlyttGo enables (00022).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../lib/store';
import type { Membership } from '../../lib/organizations';
import { loadSite } from '../../lib/whiteLabel';
import { hasModule } from '../../lib/services';
import {
  API_SCOPES, EVENT_LABELS, SCOPE_LABELS, addWidgetOrigin, apiBaseUrl, availableScopes, canManageKeys, createApiKey,
  loadApiEvents, loadApiKeys, loadWidgetOrigins, removeWidgetOrigin, revokeApiKey, snippetFor, updateApiKey,
  type ApiEvent, type ApiKey, type ApiScope, type NewApiKey,
} from '../../lib/apiKeys';

const input = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm';
const btn = 'px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50';
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' }) : 'never';

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="text-xs text-emerald-700 border border-emerald-200 px-3 py-1 rounded-lg hover:bg-emerald-50"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* no clipboard */ } }}>
      {done ? 'Copied' : label}
    </button>
  );
}

function keyState(k: ApiKey): { label: string; cls: string } {
  if (k.revoked_at) return { label: 'Revoked', cls: 'bg-gray-100 text-gray-500' };
  if (k.expires_at && new Date(k.expires_at) <= new Date()) return { label: 'Expired', cls: 'bg-gray-100 text-gray-500' };
  return { label: 'Active', cls: 'bg-emerald-100 text-emerald-700' };
}

export default function ApiWidgetPanel({ membership, onOpenPlan }: { membership: Membership; onOpenPlan?: () => void }) {
  const { setPage } = useApp();
  const org = membership.organization;
  const [apiEnabled, setApiEnabled] = useState<boolean | null>(null);
  const manage = canManageKeys(membership) && apiEnabled === true;
  const editOrigins = membership.role === 'owner' || membership.role === 'admin';
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [scopesOk, setScopesOk] = useState<ApiScope[]>([]);
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [origins, setOrigins] = useState<string[]>([]);
  const [pageActive, setPageActive] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [expires, setExpires] = useState('');
  const [created, setCreated] = useState<NewApiKey | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; scopes: ApiScope[] } | null>(null);
  const [origin, setOrigin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [k, s, e, o, a] = await Promise.all([
      editOrigins ? loadApiKeys(org.id) : Promise.resolve([]),
      availableScopes(org.id),
      editOrigins ? loadApiEvents(org.id) : Promise.resolve([]),
      loadWidgetOrigins(org.id),
      hasModule(org.id, 'api'),
    ]);
    setKeys(k); setScopesOk(s); setEvents(e); setOrigins(o); setApiEnabled(a);
  }, [org.id, editOrigins]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { loadSite({ slug: org.slug }).then(s => setPageActive(!!s)); }, [org.slug]);

  const run = async (fn: () => Promise<string | null>, ok: string) => {
    setBusy(true); setMsg(null);
    const err = await fn();
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: ok });
    if (!err) await reload();
    return !err;
  };

  const create = async () => {
    setBusy(true); setMsg(null); setCreated(null);
    const r = await createApiKey(org.id, name, scopes, expires ? new Date(`${expires}T23:59:59`).toISOString() : null);
    setBusy(false);
    if (r.error || !r.key) { setMsg({ ok: false, text: r.error ?? 'The key could not be created.' }); return; }
    setCreated(r.key); setName(''); setScopes([]); setExpires('');
    await reload();
  };

  const snippet = useMemo(() => snippetFor(org.slug), [org.slug]);
  const keyName = (id: string | null) => keys.find(k => k.id === id)?.name ?? '';

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 p-6 text-sm text-gray-600 space-y-3">
        <p>
          Connect your own systems to FlyttGo with an API key, and put your booking page on your own website with the widget.
          A key acts as the owner or admin who created it: what it may do is what they may do, within the scopes you give it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-gray-400">Base URL</span>
          <code className="font-mono text-xs bg-gray-50 rounded-lg px-3 py-1.5 break-all">{apiBaseUrl()}</code>
          <CopyButton text={apiBaseUrl()} />
          <button className="underline text-[#0B2E59] text-sm" onClick={() => setPage('corporate-api-access')}>API reference</button>
        </div>
      </div>

      {msg && <div className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}

      {/* ── KEYS ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="font-bold text-gray-900 mb-1">API keys</h3>
        {!manage && (
          <p className="text-sm text-gray-500 mb-2">
            {org.status !== 'active' ? 'Keys can be created once FlyttGo has verified and activated your company.'
              : apiEnabled === false ? 'API access is an add-on FlyttGo enables for your company, priced by a written quote. Ask FlyttGo for it. The booking widget below is included in your plan.'
              : 'Only owners and admins create and revoke keys.'}
          </p>
        )}
        {created && (
          <div className="my-4 rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm">
            <div className="font-semibold text-yellow-900 mb-1">Copy the key now: it is shown only once.</div>
            <p className="text-yellow-800 text-xs mb-2">FlyttGo keeps only its fingerprint. Store it in your server's secret store, never in a web page or app.</p>
            <div className="flex items-center gap-3">
              <code className="font-mono text-xs bg-white rounded-lg px-3 py-2 break-all flex-1">{created.key}</code>
              <CopyButton text={created.key} />
            </div>
            <button className="mt-2 text-xs underline text-yellow-900" onClick={() => setCreated(null)}>I have stored it</button>
          </div>
        )}
        {keys.length > 0 ? (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Name', 'Key', 'Scopes', 'Last used', 'Created', 'Status', ''].map(h =>
                  <th key={h} className="text-left py-2 px-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {keys.map(k => {
                  const st = keyState(k);
                  const isEditing = editing?.id === k.id;
                  return (
                    <tr key={k.id} className="align-top">
                      <td className="py-2.5 px-3 font-medium">
                        {isEditing ? <input className={input} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /> : k.name}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-gray-500">{k.prefix}…</td>
                      <td className="py-2.5 px-3 text-xs">
                        {isEditing ? API_SCOPES.map(s => (
                          <label key={s} className={`flex items-center gap-1.5 ${scopesOk.includes(s) ? '' : 'opacity-40'}`}>
                            <input type="checkbox" disabled={!scopesOk.includes(s)} checked={editing.scopes.includes(s)}
                              onChange={e => setEditing({ ...editing, scopes: e.target.checked ? [...editing.scopes, s] : editing.scopes.filter(x => x !== s) })} />
                            {s}
                          </label>
                        )) : k.scopes.join(', ')}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-gray-500">{when(k.last_used_at)}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500">{when(k.created_at)}{k.expires_at ? <div>expires {when(k.expires_at)}</div> : null}</td>
                      <td className="py-2.5 px-3"><span className={`px-2 py-0.5 rounded text-xs ${st.cls}`}>{st.label}</span>
                        {k.revoked_reason && <div className="text-xs text-gray-400 mt-1">{k.revoked_reason}</div>}</td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {manage && !k.revoked_at && (isEditing ? (
                          <>
                            <button disabled={busy} className="text-xs text-emerald-700 mr-3"
                              onClick={async () => { if (await run(() => updateApiKey(k.id, editing.name, editing.scopes), 'Key changed.')) setEditing(null); }}>Save</button>
                            <button className="text-xs text-gray-500" onClick={() => setEditing(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className="text-xs text-gray-600 mr-3" onClick={() => setEditing({ id: k.id, name: k.name, scopes: k.scopes })}>Edit</button>
                            <button disabled={busy} className="text-xs text-red-600"
                              onClick={() => {
                                const reason = window.prompt(`Revoke "${k.name}"? Systems using it stop at once. Reason (optional):`);
                                if (reason !== null) run(() => revokeApiKey(k.id, reason), 'Key revoked.');
                              }}>Revoke</button>
                          </>
                        ))}
                        {editOrigins && !manage && !k.revoked_at && (
                          <button disabled={busy} className="text-xs text-red-600"
                            onClick={() => { const reason = window.prompt(`Revoke "${k.name}"? Reason (optional):`); if (reason !== null) run(() => revokeApiKey(k.id, reason), 'Key revoked.'); }}>Revoke</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (manage && <p className="text-sm text-gray-500 mt-2">No keys yet.</p>)}

        {manage && (
          <div className="mt-6 border-t border-gray-100 pt-5 grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="font-semibold text-gray-900 text-sm">New key</h4>
              <input className={input} placeholder="Name, e.g. ERP production" value={name} onChange={e => setName(e.target.value)} maxLength={80} />
              <label className="block text-xs text-gray-500">Expires (optional)
                <input type="date" className={input} value={expires} onChange={e => setExpires(e.target.value)} />
              </label>
              <button disabled={busy || !name.trim() || scopes.length === 0} onClick={create} className={`${btn} bg-[#0B2E59] text-white`}>Create key</button>
            </div>
            <div className="space-y-1.5">
              <h4 className="font-semibold text-gray-900 text-sm mb-1">Scopes</h4>
              {API_SCOPES.map(s => {
                const ok = scopesOk.includes(s);
                return (
                  <label key={s} className={`flex items-start gap-2 text-sm ${ok ? '' : 'opacity-50'}`}>
                    <input type="checkbox" className="mt-1" disabled={!ok} checked={scopes.includes(s)}
                      onChange={e => setScopes(e.target.checked ? [...scopes, s] : scopes.filter(x => x !== s))} />
                    <span><code className="text-xs">{s}</code> · {SCOPE_LABELS[s]}
                      {!ok && <span className="block text-xs text-gray-400">
                        {s === 'bookings:write' ? 'Needs invoice payment, switched on by FlyttGo.' : 'Not in your plan.'}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-4">
          Each key allows 60 requests a minute unless FlyttGo agrees another limit. A key stops working when it is revoked or expires,
          while the company is not active or has no API add-on, and when the member who created it is no longer an owner or admin
          (the key is then revoked at once).
        </p>
      </div>

      {/* ── WIDGET ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <div>
          <h3 className="font-bold text-gray-900 mb-1">Booking widget for your website <span className="text-xs font-normal text-emerald-700">· included in your plan</span></h3>
          <p className="text-sm text-gray-500">
            Your booking page in a frame on your own website. Customers book as on your FlyttGo page; no API key is used.
            It shows only on the websites listed here.
          </p>
        </div>
        {pageActive === false && (
          <div className="rounded-xl bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
            The widget shows your booking page, which is not active yet.{' '}
            {onOpenPlan ? <button className="underline" onClick={onOpenPlan}>Plan and website</button> : 'Plan and website'} sets it up.
          </div>
        )}
        <div>
          <h4 className="font-semibold text-gray-900 text-sm mb-2">Websites that may show it</h4>
          {origins.length === 0 && <p className="text-sm text-gray-400 mb-2">None yet: the widget shows nowhere.</p>}
          <ul className="space-y-1 mb-3">
            {origins.map(o => (
              <li key={o} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <code className="text-xs">{o}</code>
                {editOrigins && <button disabled={busy} className="text-xs text-red-600"
                  onClick={() => run(() => removeWidgetOrigin(org.id, o), 'Website removed.')}>Remove</button>}
              </li>
            ))}
          </ul>
          {editOrigins && (
            <div className="flex gap-2">
              <input className={input} placeholder="https://www.example.no" value={origin} onChange={e => setOrigin(e.target.value)} />
              <button disabled={busy || !origin.trim()} className={`${btn} bg-gray-900 text-white whitespace-nowrap`}
                onClick={async () => { if (await run(() => addWidgetOrigin(org.id, origin), 'Website added.')) setOrigin(''); }}>Add website</button>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-2">The address of the site only (https://, no path). Use http://localhost while you test.</p>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-gray-900 text-sm">Paste this on your website</h4>
            <CopyButton text={snippet} />
          </div>
          <pre className="bg-gray-900 text-gray-100 rounded-xl p-4 text-xs overflow-x-auto whitespace-pre-wrap break-all">{snippet}</pre>
        </div>
        {pageActive && (
          <div>
            <h4 className="font-semibold text-gray-900 text-sm mb-2">Preview</h4>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <iframe title="Widget preview" src={`/embed/${org.slug}`} className="w-full block border-0" style={{ height: 640 }} />
            </div>
          </div>
        )}
      </div>

      {/* ── LOG ── */}
      {events.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="font-bold text-gray-900 mb-3">Key log</h3>
          <ul className="divide-y divide-gray-50 text-sm">
            {events.map(e => (
              <li key={e.id} className="py-2 flex justify-between gap-4">
                <span>{EVENT_LABELS[e.action] ?? e.action}{e.api_key_id ? <span className="text-gray-400"> · {keyName(e.api_key_id)}</span> : null}
                  {typeof e.details?.origin === 'string' ? <span className="text-gray-400"> · {String(e.details.origin)}</span> : null}</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">{when(e.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
