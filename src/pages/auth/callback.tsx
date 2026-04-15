/**
 * /auth/callback — the URL Supabase redirects email-confirmation,
 * magic-link, and OAuth (Google / Apple) flows back to.
 *
 * ── How the handoff works ──────────────────────────────────────
 *  1. The user clicks the confirmation link in their inbox.
 *  2. Supabase verifies the token and 302-redirects the browser to
 *     this page with the new access_token / refresh_token appended
 *     to the URL hash (#access_token=…&refresh_token=…).
 *  3. The Supabase browser client picks those tokens out of the
 *     hash automatically because we set `detectSessionInUrl: true`
 *     in `src/lib/supabase.ts`. It then writes the session into
 *     localStorage and fires `onAuthStateChange('SIGNED_IN', …)`.
 *  4. AuthProvider's listener (auth.tsx) catches that event and
 *     pushes the new user into context — which lights up `user`
 *     here via `useAuth()`.
 *  5. We then navigate the SPA to the customer dashboard.
 *
 * ── Why a dedicated callback page? ─────────────────────────────
 * Putting the URL-hash handoff on its own route means:
 *   • Supabase's email template only ever points at one stable
 *     URL we control (https://flyttgo.no/auth/callback).
 *   • The home page doesn't have to mount any auth-callback logic
 *     and stays free of token-flash side effects.
 *   • If the session never arrives (expired link, broken email
 *     template, copy-paste mishap) we can show a clear error UI
 *     with a path forward, instead of dumping the user on a blank
 *     home page that silently doesn't sign them in.
 *
 * Vercel SPA fallback (`vercel.json` → `rewrites: [{ source:
 * '/(.*)', destination: '/' }]`) makes /auth/callback resolve to
 * the SPA bundle on a hard refresh, so the URL-hash handoff still
 * works on a cold load — not just on client-side navigation.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useApp }  from '../../lib/store';

/** Hard ceiling on how long we'll wait for the session before showing
 *  the error fallback. supabase-js usually populates the session in
 *  <100 ms, so 8 s is generous. */
const SESSION_TIMEOUT_MS = 8000;

export default function AuthCallbackPage() {
  const { user, profile, loading } = useAuth();
  const { setPage }                = useApp();
  const [timedOut, setTimedOut]    = useState(false);

  /* Once Supabase lights up `user` (and we've finished fetching the
   * profile so we know the role), bounce the user into the right
   * landing surface for their account type. */
  useEffect(() => {
    if (loading || !user) return;

    /* Drivers and admins have their own home — sending them to the
     * customer dashboard would just feel wrong. */
    if (profile?.role === 'driver') {
      setPage('driver-portal');
    } else if (profile?.role === 'admin') {
      setPage('admin');
    } else {
      setPage('customer-dashboard');
    }
  }, [loading, user, profile, setPage]);

  /* Safety net — if no session ever materialises, surface an error
   * instead of leaving the user spinning forever. */
  useEffect(() => {
    if (user) return;
    const id = window.setTimeout(() => setTimedOut(true), SESSION_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [user]);

  if (timedOut && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-7 h-7 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 5a7 7 0 100 14 7 7 0 000-14z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            We couldn&rsquo;t sign you in
          </h1>
          <p className="text-sm text-gray-600 mb-6">
            The confirmation link may have expired, already been used, or been
            opened on a different device than the one you signed up from. You
            can try signing in again from the home page.
          </p>
          <button
            type="button"
            onClick={() => setPage('home')}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 px-4 rounded-lg transition"
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto mb-4 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-600">Signing you in&hellip;</p>
      </div>
    </div>
  );
}
