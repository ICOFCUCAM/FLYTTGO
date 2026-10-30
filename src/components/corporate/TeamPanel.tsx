/**
 * The Team tab of the corporate dashboard for a real company: members
 * and their roles, open invitations, inviting by email. Every change is
 * a database function that checks the caller's company role (00005);
 * the buttons shown follow the same rules (lib/organizations.ts).
 * Spending limits per member, this month's spend and the company's
 * approval rules come from 00017 (owners, admins and finance set them).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ORG_ROLE_LABELS, assignableRoles, canInvite, canManage, changeMemberRole, inviteByEmail,
  loadInvitations, loadSpending, loadSpendingRules, loadTeam, removeMember, revokeInvitation, setMemberLimits,
  setSpendingRules,
  type Invitation, type MemberSpending, type Membership, type OrgRole, type SpendingRules, type TeamMember,
} from '../../lib/organizations';
import { canManageSpending, canSetLimits, osloMonthLabel, parseLimit } from '../../../supabase/functions/_shared/spending';

const nok = (v: number | null | undefined) => v == null ? 'No limit' : `${Math.round(Number(v)).toLocaleString('nb-NO')} NOK`;

export default function TeamPanel({ membership, userId, onLeft }: { membership: Membership; userId: string; onLeft: () => void }) {
  const org = membership.organization;
  const myRole = membership.role;
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [spending, setSpending] = useState<Record<string, MemberSpending>>({});
  const [rules, setRules] = useState<SpendingRules | null>(null);
  const [editing, setEditing] = useState<{ user: string; perBooking: string; monthly: string } | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('booker');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [t, i, s, r] = await Promise.all([loadTeam(org.id), loadInvitations(org.id), loadSpending(org.id), loadSpendingRules(org.id)]);
    setTeam(t); setInvites(i); setRules(r);
    setSpending(Object.fromEntries(s.map(x => [x.user_id, x])));
  }, [org.id]);
  useEffect(() => { reload(); }, [reload]);

  async function act(run: () => Promise<string | null>, done: string) {
    setBusy(true); setMessage(null);
    const err = await run();
    setBusy(false);
    setMessage(err ? { ok: false, text: err } : { ok: true, text: done });
    if (!err) await reload();
    return err;
  }

  const inviteRoles = assignableRoles(myRole);
  const mayInvite = canInvite(myRole, org.status);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">
          {team.length} team member{team.length === 1 ? '' : 's'}
          {mayInvite ? ` · ${invites.length} pending invite${invites.length === 1 ? '' : 's'}` : ''}
        </p>
      </div>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{message.text}</div>
      )}

      {mayInvite && (
        <form
          onSubmit={async e => {
            e.preventDefault();
            const err = await act(() => inviteByEmail(org.id, email.trim(), role), `Invitation sent to ${email.trim()}.`);
            if (!err) setEmail('');
          }}
          className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col sm:flex-row gap-3"
        >
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="colleague@company.no"
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
          <select value={role} onChange={e => setRole(e.target.value as OrgRole)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-white">
            {inviteRoles.map(r => <option key={r} value={r}>{ORG_ROLE_LABELS[r]}</option>)}
          </select>
          <button disabled={busy} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">+ Invite Member</button>
        </form>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Member', 'Email', 'Role', 'Joined', 'Limit per booking', 'Monthly limit', `Spent ${osloMonthLabel()}`, ''].map(h => <th key={h} className="text-left py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wide">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {team.map(m => {
              const me = m.user_id === userId;
              const manage = !me && canManage(myRole, m.role);
              const spend = spending[m.user_id];
              const mayLimit = canSetLimits(myRole, m.role, me);
              const isEditing = editing?.user === m.user_id;
              return (
                <tr key={m.user_id} className="hover:bg-gray-50">
                  <td className="py-3.5 px-4 font-medium">{[m.first_name, m.last_name].filter(Boolean).join(' ') || '—'}{me ? ' (you)' : ''}</td>
                  <td className="py-3.5 px-4 text-gray-500">{m.email ?? '—'}</td>
                  <td className="py-3.5 px-4">
                    {manage ? (
                      <select value={m.role} disabled={busy}
                        onChange={e => act(() => changeMemberRole(org.id, m.user_id, e.target.value as OrgRole), 'Role changed.')}
                        className="border border-gray-200 rounded px-2 py-1 text-xs bg-white">
                        {inviteRoles.map(r => <option key={r} value={r}>{ORG_ROLE_LABELS[r]}</option>)}
                      </select>
                    ) : <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs">{ORG_ROLE_LABELS[m.role]}</span>}
                  </td>
                  <td className="py-3.5 px-4 text-gray-400">{new Date(m.joined_at).toLocaleDateString('nb-NO')}</td>
                  {isEditing ? (
                    <>
                      <td className="py-3.5 px-4">
                        <input value={editing.perBooking} onChange={e => setEditing({ ...editing, perBooking: e.target.value })} placeholder="No limit"
                          inputMode="numeric" className="w-24 border border-gray-200 rounded px-2 py-1 text-xs" aria-label="Limit per booking (NOK)" />
                      </td>
                      <td className="py-3.5 px-4">
                        <input value={editing.monthly} onChange={e => setEditing({ ...editing, monthly: e.target.value })} placeholder="No limit"
                          inputMode="numeric" className="w-24 border border-gray-200 rounded px-2 py-1 text-xs" aria-label="Monthly limit (NOK)" />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-3.5 px-4 text-gray-600">{spend ? nok(spend.per_booking_limit) : '—'}</td>
                      <td className="py-3.5 px-4 text-gray-600">{spend ? nok(spend.monthly_limit) : '—'}</td>
                    </>
                  )}
                  <td className="py-3.5 px-4 text-gray-600">
                    {spend ? `${Math.round(spend.month_spend).toLocaleString('nb-NO')} NOK` : '—'}
                    {spend?.monthly_limit != null && spend.month_spend > spend.monthly_limit && <span className="ml-1 text-xs text-amber-600">over</span>}
                  </td>
                  <td className="py-3.5 px-4 space-x-3 whitespace-nowrap">
                    {mayLimit && !isEditing && (
                      <button disabled={busy} className="text-xs text-gray-400 hover:text-emerald-600"
                        onClick={() => setEditing({ user: m.user_id, perBooking: spend?.per_booking_limit != null ? String(spend.per_booking_limit) : '',
                                                    monthly: spend?.monthly_limit != null ? String(spend.monthly_limit) : '' })}>
                        Limits
                      </button>
                    )}
                    {isEditing && (
                      <>
                        <button disabled={busy} className="text-xs text-emerald-600 font-semibold"
                          onClick={async () => {
                            const per = parseLimit(editing.perBooking), month = parseLimit(editing.monthly);
                            if (per === 'invalid' || month === 'invalid') { setMessage({ ok: false, text: 'A limit is an amount in NOK, or empty for no limit.' }); return; }
                            const err = await act(() => setMemberLimits(org.id, m.user_id, per, month), 'Limits saved.');
                            if (!err) setEditing(null);
                          }}>Save</button>
                        <button disabled={busy} className="text-xs text-gray-400" onClick={() => setEditing(null)}>Cancel</button>
                      </>
                    )}
                    {manage && (
                      <button disabled={busy} className="text-xs text-gray-400 hover:text-red-500"
                        onClick={() => confirm(`Remove ${m.email ?? 'this member'} from ${org.name}?`) && act(() => removeMember(org.id, m.user_id), 'Member removed.')}>
                        Remove
                      </button>
                    )}
                    {me && (
                      <button disabled={busy} className="text-xs text-gray-400 hover:text-red-500"
                        onClick={async () => {
                          if (!confirm(`Leave ${org.name}?`)) return;
                          const err = await act(() => removeMember(org.id, userId), 'You left the company.');
                          if (!err) onLeft();
                        }}>
                        Leave
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canManageSpending(myRole) && (
        <ApprovalRulesCard rules={rules} busy={busy}
          onSave={(above, roles, hours) => act(() => setSpendingRules(org.id, above, roles, hours), 'Approval rules saved.')} />
      )}

      {mayInvite && invites.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-700 text-sm">Pending invitations</div>
          {invites.map(i => (
            <div key={i.id} className="flex items-center justify-between px-4 py-3 text-sm border-b border-gray-50 last:border-0">
              <span>{i.email} · {ORG_ROLE_LABELS[i.role]} · expires {new Date(i.expires_at).toLocaleDateString('nb-NO')}</span>
              <button disabled={busy} className="text-xs text-gray-400 hover:text-red-500"
                onClick={() => act(() => revokeInvitation(i.id), 'Invitation withdrawn.')}>Withdraw</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* The company's approval rules (00017 set_spending_rules). Going over a
 * member's limit always needs approval; these add to it. */
const RULE_ROLES: OrgRole[] = ['booker', 'admin', 'owner'];

function ApprovalRulesCard({ rules, busy, onSave }: {
  rules: SpendingRules | null; busy: boolean;
  onSave: (above: number | null, roles: OrgRole[], hours: number) => Promise<string | null>;
}) {
  const [above, setAbove] = useState('');
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [hours, setHours] = useState('168');
  const [error, setError] = useState('');
  useEffect(() => {
    setAbove(rules?.approval_above != null ? String(rules.approval_above) : '');
    setRoles(rules?.approval_roles ?? []);
    setHours(String(rules?.approval_expiry_hours ?? 168));
  }, [rules]);

  return (
    <form className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3"
      onSubmit={async e => {
        e.preventDefault();
        const a = parseLimit(above), h = Number(hours);
        if (a === 'invalid' || !Number.isInteger(h) || h < 1 || h > 720) {
          setError('Give an amount in NOK (or leave it empty) and a waiting time of 1 to 720 hours.'); return;
        }
        setError('');
        await onSave(a, roles, h);
      }}>
      <div>
        <div className="font-semibold text-gray-700 text-sm">Approval rules</div>
        <p className="text-xs text-gray-500 mt-1">
          A booking over a member's limit, or matching a rule below, waits until an owner, administrator or finance member
          other than the person who booked approves it. Until then it is not paid, invoiced or sent to drivers.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 text-sm">
        <label className="flex-1">Bookings above (NOK)
          <input value={above} onChange={e => setAbove(e.target.value)} placeholder="No amount rule" inputMode="numeric"
            className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
        </label>
        <label className="flex-1">Requests expire after (hours)
          <input value={hours} onChange={e => setHours(e.target.value)} inputMode="numeric"
            className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
        </label>
      </div>
      <div className="text-sm">
        <span className="text-gray-700">Every booking by:</span>
        {RULE_ROLES.map(r => (
          <label key={r} className="ml-3 inline-flex items-center gap-1">
            <input type="checkbox" checked={roles.includes(r)}
              onChange={e => setRoles(e.target.checked ? [...roles, r] : roles.filter(x => x !== r))} />
            {ORG_ROLE_LABELS[r]}
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button disabled={busy} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">Save rules</button>
    </form>
  );
}
