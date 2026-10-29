/**
 * The Team tab of the corporate dashboard for a real company: members
 * and their roles, open invitations, inviting by email. Every change is
 * a database function that checks the caller's company role (00005);
 * the buttons shown follow the same rules (lib/organizations.ts).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ORG_ROLE_LABELS, assignableRoles, canInvite, canManage, changeMemberRole, inviteByEmail,
  loadInvitations, loadTeam, removeMember, revokeInvitation,
  type Invitation, type Membership, type OrgRole, type TeamMember,
} from '../../lib/organizations';

export default function TeamPanel({ membership, userId, onLeft }: { membership: Membership; userId: string; onLeft: () => void }) {
  const org = membership.organization;
  const myRole = membership.role;
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('booker');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [t, i] = await Promise.all([loadTeam(org.id), loadInvitations(org.id)]);
    setTeam(t); setInvites(i);
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
            <tr>{['Member', 'Email', 'Role', 'Joined', ''].map(h => <th key={h} className="text-left py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wide">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {team.map(m => {
              const me = m.user_id === userId;
              const manage = !me && canManage(myRole, m.role);
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
                  <td className="py-3.5 px-4">
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
