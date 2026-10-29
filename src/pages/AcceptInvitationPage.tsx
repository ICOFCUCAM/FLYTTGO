/**
 * /business/invite?token=… — the link in a company invitation email
 * (send-organization-invitation). The invited person signs in with the
 * invited, confirmed email address and joins the company with the role
 * they were invited to (accept_invitation, migration 00005). Their own
 * account role and any driver plan are not touched.
 *
 * The token is moved out of the address bar into session storage as
 * soon as the page opens, so it does not stay in the browser history,
 * and is dropped once used.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useApp } from '../lib/store';
import { supabase } from '../lib/supabase';

const KEY = 'flyttgo.invitationToken';

function takeToken(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('token');
    if (fromUrl) {
      sessionStorage.setItem(KEY, fromUrl);
      params.delete('token');
      const rest = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
      return fromUrl;
    }
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

type State =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'joined'; role: string }
  | { kind: 'error'; message: string };

export default function AcceptInvitationPage() {
  const { user, loading } = useAuth();
  const { setPage, setShowAuthModal, setAuthMode } = useApp();
  const [token] = useState<string | null>(() => takeToken());
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(() => {
    if (loading || !user || !token || state.kind !== 'idle') return;
    setState({ kind: 'working' });
    supabase.rpc('accept_invitation', { p_token: token }).then(({ data, error }) => {
      if (error) {
        setState({ kind: 'error', message: error.message });
        return;
      }
      try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
      setState({ kind: 'joined', role: (data as { role?: string } | null)?.role ?? 'member' });
    });
  }, [loading, user, token, state.kind]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <h1 className="text-2xl font-bold text-[#0B2E59] mb-4">Company invitation</h1>

        {!token && (
          <p className="text-gray-600">This invitation link is incomplete. Open the link from the email again.</p>
        )}

        {token && !loading && !user && (
          <>
            <p className="text-gray-600 mb-6">
              Sign in with the email address the invitation was sent to. If you don't have an account yet,
              create one with that address and confirm it first.
            </p>
            <button
              onClick={() => { setAuthMode('signin'); setShowAuthModal(true); }}
              className="px-6 py-3 rounded-xl bg-[#0B2E59] text-white font-semibold"
            >
              Sign in to accept
            </button>
          </>
        )}

        {(loading || state.kind === 'working') && token && user && <p className="text-gray-600">Accepting the invitation…</p>}

        {state.kind === 'joined' && (
          <>
            <p className="text-gray-700 mb-6">You have joined the company as <strong>{state.role}</strong>.</p>
            <button onClick={() => setPage('corporate-dashboard')} className="px-6 py-3 rounded-xl bg-[#0B2E59] text-white font-semibold">
              Go to the company dashboard
            </button>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <p className="text-red-700 mb-2">The invitation could not be accepted.</p>
            <p className="text-gray-600 text-sm mb-6">{state.message}</p>
            <p className="text-gray-500 text-sm">
              Invitations last 7 days and work once, for the invited address. Ask the company to send a new one if needed.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
