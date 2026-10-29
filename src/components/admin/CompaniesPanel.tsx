/**
 * Admin → Companies: company onboarding for platform administrators
 * (decided 2026-10-29, docs/DECISIONS.md #12–14). An administrator
 * checks a company in Brønnøysundregistrene (verify-organization) or
 * records a manual check with its evidence, then activates, suspends or
 * closes it, and can restore an owner. They do not act inside the
 * company (no invitations or role changes): the database refuses that.
 */
import { useCallback, useEffect, useState } from 'react';
import { callFunction, supabase } from '../../lib/supabase';
import { ORG_STATUS_LABELS, type Organization, type OrgStatus } from '../../lib/organizations';
import { adminSetInvoicing, callJson, formatNok, recordManualCreditCheck } from '../../lib/invoicing';
import { AUTHORISATION_KINDS, INDUSTRIES, loadAuthorisations, recordAuthorisation, revokeAuthorisation } from '../../lib/services';

interface Verification { id: string; organization_id: string; source: string; passed: boolean; org_number: string | null; findings: any; checked_at: string }

const STATUS_STYLE: Record<OrgStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700', active: 'bg-emerald-100 text-emerald-700',
  suspended: 'bg-orange-100 text-orange-700', closed: 'bg-gray-200 text-gray-600',
};

export default function CompaniesPanel() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [checks, setChecks] = useState<Record<string, Verification>>({});
  const [members, setMembers] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<'all' | OrgStatus>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [{ data: o }, { data: v }, { data: m }] = await Promise.all([
      supabase.from('organizations').select('*').order('created_at', { ascending: false }),
      supabase.from('organization_verifications').select('*').order('checked_at', { ascending: false }),
      supabase.from('organization_members').select('organization_id').eq('status', 'active'),
    ]);
    setOrgs((o ?? []) as Organization[]);
    const latest: Record<string, Verification> = {};
    for (const row of (v ?? []) as Verification[]) latest[row.organization_id] ??= row;
    setChecks(latest);
    const counts: Record<string, number> = {};
    for (const row of m ?? []) counts[row.organization_id] = (counts[row.organization_id] ?? 0) + 1;
    setMembers(counts);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function run(id: string, fn: () => Promise<string | null>, ok: string) {
    setBusy(id); setMessage(null);
    const err = await fn();
    setBusy(null);
    setMessage(err ? { ok: false, text: err } : { ok: true, text: ok });
    await reload();
  }

  const registryCheck = (o: Organization) => run(o.id, async () => {
    const res = await callFunction('verify-organization', { organizationId: o.id });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return out.error ?? `check failed (${res.status})`;
    return out.passed ? null : `Not passed: ${(out.findings?.reasons ?? []).join('; ')}`;
  }, `${o.name} passed the Brønnøysund check.`);

  const manualCheck = (o: Organization) => {
    const evidence = prompt(`Manual check of ${o.name}: what did you verify (document, signatory, source)?`);
    if (!evidence?.trim()) return;
    run(o.id, async () => {
      const { error } = await supabase.rpc('record_organization_verification',
        { p_org: o.id, p_source: 'manual', p_passed: true, p_findings: { evidence: evidence.trim() } });
      return error?.message ?? null;
    }, 'Manual check recorded.');
  };

  const setStatus = (o: Organization, status: OrgStatus) => {
    const reason = status === 'active' ? 'verified' : prompt(`Reason for setting ${o.name} to ${ORG_STATUS_LABELS[status].toLowerCase()}:`);
    if (reason === null || (status !== 'active' && !reason.trim())) return;
    run(o.id, async () => {
      const { error } = await supabase.rpc('admin_set_organization_status', { p_org: o.id, p_status: status, p_reason: reason.trim() });
      return error?.message ?? null;
    }, `${o.name}: ${ORG_STATUS_LABELS[status]}.`);
  };

  const restoreOwner = (o: Organization) => {
    const email = prompt(`Make which person (email of their FlyttGo account) an owner of ${o.name}?`);
    if (!email?.trim()) return;
    const reason = prompt('Reason (recorded in the company log):');
    if (!reason?.trim()) return;
    run(o.id, async () => {
      const { data: p } = await supabase.from('profiles').select('user_id').ilike('email', email.trim()).limit(1);
      const userId = p?.[0]?.user_id;
      if (!userId) return `No account with the email ${email.trim()}.`;
      const { error } = await supabase.rpc('admin_transfer_ownership', { p_org: o.id, p_user: userId, p_reason: reason.trim() });
      return error?.message ?? null;
    }, 'Owner restored.');
  };

  const setInvoicing = (o: Organization & Record<string, any>) => {
    const on = confirm(`Allow ${o.name} to pay on invoice? (Cancel = switch invoicing off)`);
    const limit = on ? prompt('Credit limit in NOK (empty = no limit):', o.credit_limit != null ? String(o.credit_limit) : '') : '';
    if (on && limit === null) return;
    const plan = on ? (confirm('Special price plan (the company\'s name and logo on its invoices)? OK = special, Cancel = standard') ? 'special' : 'standard')
                    : (o.billing_plan ?? 'standard');
    run(o.id, () => adminSetInvoicing(o.id, on, limit && limit.trim() ? Number(limit.replace(',', '.')) : null, plan as 'standard' | 'special'),
        on ? `Invoicing on for ${o.name}.` : `Invoicing off for ${o.name}.`);
  };

  const creditCheck = (o: Organization) => run(o.id, async () => {
    const r = await callJson('credit-check', { organizationId: o.id });
    if (r.ok) return r.data.check?.passed ? null : 'The credit check did not pass.';
    if (!r.data.manual) return r.data.error ?? 'credit check failed';
    const evidence = prompt(`${r.data.error}\n\nManual assessment of ${o.name}: what did you check (accounts, rating, payment history)?`);
    if (!evidence?.trim()) return 'No credit check recorded.';
    const passed = confirm('Did the company pass? OK = passed, Cancel = not passed');
    const lim = prompt('Recommended credit limit in NOK (optional):') ?? '';
    return recordManualCreditCheck(o.id, passed, '', lim.trim() ? Number(lim) : null, evidence.trim());
  }, `Credit check recorded for ${o.name}.`);

  /* Trade authorisations (00010): checked in the public register, recorded
   * with what was checked; a service that needs one is offered only then. */
  const authorisations = (o: Organization) => run(o.id, async () => {
    const list = await loadAuthorisations(o.id);
    const valid = list.filter(a => a.status === 'valid');
    const action = prompt(`${o.name}: authorisations on record\n${valid.map((a, i) => `${i + 1}. ${AUTHORISATION_KINDS[a.kind]} · ${a.register} ${a.reference ?? ''}${a.valid_until ? ` until ${a.valid_until}` : ''}`).join('\n') || '(none)'}\n\nType "add" to record one, or a number to revoke it:`);
    if (!action) return 'Nothing changed.';
    if (action.trim().toLowerCase() === 'add') {
      const kinds = Object.keys(AUTHORISATION_KINDS);
      const k = prompt(`Kind (number):\n${kinds.map((x, i) => `${i + 1}. ${AUTHORISATION_KINDS[x]}`).join('\n')}`, '1');
      const kind = kinds[Number(k) - 1]; if (!kind) return 'No kind chosen.';
      const register = prompt('Register checked (e.g. DSB elvirksomhetsregisteret)', kind === 'electrical' ? 'DSB elvirksomhetsregisteret' : '') ?? '';
      const reference = prompt('Registration number') ?? '';
      const until = prompt('Valid until (YYYY-MM-DD, empty if open-ended)') ?? '';
      const checked = prompt('What you checked (search date, document)') ?? '';
      return recordAuthorisation(o.id, kind, register, reference, until.trim() || null, checked);
    }
    const a = valid[Number(action) - 1]; if (!a) return 'No such authorisation.';
    const why = prompt(`Reason for revoking ${AUTHORISATION_KINDS[a.kind]}`); if (!why) return 'Nothing changed.';
    return revokeAuthorisation(a.id, why);
  }, `Authorisations updated for ${o.name}.`);

  const shown = orgs.filter(o => filter === 'all' || o.status === filter);
  const btn = 'px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Companies</h1>
      <p className="text-sm text-gray-500 mb-6">
        Check a company before activating it: Brønnøysundregistrene for Norwegian companies, or a manual check with its evidence.
        Activation needs a passed check of the current organisation number from the last 30 days.
      </p>
      <div className="flex gap-2 mb-4">
        {(['pending', 'active', 'suspended', 'closed', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${filter === f ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            {f === 'all' ? 'All' : ORG_STATUS_LABELS[f]} ({f === 'all' ? orgs.length : orgs.filter(o => o.status === f).length})
          </button>
        ))}
      </div>
      {message && <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{message.text}</div>}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>{['Company', 'Org. number', 'Members', 'Status', 'Last check', ''].map(h => <th key={h} className="text-left p-3 text-xs uppercase text-gray-500">{h}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map(o => {
              const c = checks[o.id];
              const current = c && c.passed && c.org_number === o.org_number && Date.now() - new Date(c.checked_at).getTime() < 30 * 86_400_000;
              return (
                <tr key={o.id} className="border-t align-top">
                  <td className="p-3"><div className="font-medium">{o.name}</div><div className="text-xs text-gray-400">{o.slug} · {o.billing_email ?? 'no billing email'}</div>
                    {o.industry && <div className="text-xs text-gray-500">{INDUSTRIES.find(i => i.id === o.industry)?.label ?? o.industry}</div>}</td>
                  <td className="p-3 font-mono text-xs">{o.org_number ?? '—'}{o.vat_registered ? ' · MVA' : ''}</td>
                  <td className="p-3">{members[o.id] ?? 0}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLE[o.status]}`}>{ORG_STATUS_LABELS[o.status]}</span>
                    {(o as any).invoicing_enabled && (
                      <div className="text-xs text-indigo-700 mt-1">
                        Invoice{(o as any).credit_limit != null ? `, limit ${formatNok((o as any).credit_limit)}` : ''}{(o as any).billing_plan === 'special' ? ', special plan' : ''}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-xs">
                    {c ? (
                      <span className={c.passed ? 'text-emerald-700' : 'text-red-700'}>
                        {c.passed ? 'Passed' : 'Failed'} ({c.source === 'brreg' ? 'Brønnøysund' : 'manual'}), {new Date(c.checked_at).toLocaleDateString('nb-NO')}
                        {!c.passed && c.findings?.reasons?.length ? <div className="text-gray-500">{c.findings.reasons.join('; ')}</div> : null}
                        {c.passed && !current ? <div className="text-gray-500">out of date</div> : null}
                      </span>
                    ) : <span className="text-gray-400">none</span>}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {o.country === 'NO' && o.org_number && (
                        <button disabled={busy === o.id} onClick={() => registryCheck(o)} className={`${btn} bg-blue-600 text-white`}>Check Brønnøysund</button>
                      )}
                      <button disabled={busy === o.id} onClick={() => manualCheck(o)} className={`${btn} bg-gray-100 text-gray-700`}>Manual check</button>
                      {o.status !== 'active' && o.status !== 'closed' && (
                        <button disabled={busy === o.id || !current} title={current ? '' : 'Needs a passed check from the last 30 days'}
                          onClick={() => setStatus(o, 'active')} className={`${btn} bg-emerald-600 text-white`}>Activate</button>
                      )}
                      {o.status === 'active' && <button disabled={busy === o.id} onClick={() => setStatus(o, 'suspended')} className={`${btn} bg-orange-500 text-white`}>Suspend</button>}
                      {o.status !== 'closed' && <button disabled={busy === o.id} onClick={() => setStatus(o, 'closed')} className={`${btn} bg-gray-200 text-gray-700`}>Close</button>}
                      <button disabled={busy === o.id} onClick={() => restoreOwner(o)} className={`${btn} bg-gray-100 text-gray-700`}>Restore owner</button>
                      <button disabled={busy === o.id} onClick={() => setInvoicing(o as any)} className={`${btn} bg-indigo-600 text-white`}>Invoicing…</button>
                      <button disabled={busy === o.id} onClick={() => creditCheck(o)} className={`${btn} bg-gray-100 text-gray-700`}>Credit check</button>
                      {o.industry && o.industry !== 'transport' && <button disabled={busy === o.id} onClick={() => authorisations(o)} className={`${btn} bg-gray-100 text-gray-700`}>Authorisations…</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-400">No companies.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
