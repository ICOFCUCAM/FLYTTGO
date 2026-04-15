import { createClient } from '@supabase/supabase-js';

// Read from environment variables — never hardcode credentials in source.
// On Vercel, set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the project's
// environment variables (Settings → Environment Variables). Locally, copy
// .env.example to .env.local and fill in the values.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseKey) {
  // Loud warning in the browser console so a mis-configured Vercel deploy is
  // obvious instead of silently producing a broken Supabase client.
  console.error(
    '[FlyttGo] Missing Supabase environment variables.\n' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your deployment ' +
    '(Vercel → Settings → Environment Variables) or in a local .env.local ' +
    'file. See .env.example for the template.'
  );
}

export const SUPABASE_URL = supabaseUrl ?? '';
export const SUPABASE_ANON_KEY = supabaseKey ?? '';

/**
 * Single Supabase browser client for the whole app.
 *
 * The `auth` block is set explicitly (rather than relying on supabase-js v2
 * defaults) so the production behaviour is obvious from the source:
 *
 *   - persistSession      → keep the session in localStorage so a refresh
 *                           keeps the user signed in
 *   - autoRefreshToken    → silently refresh expiring access tokens in the
 *                           background so long sessions don't get bounced
 *   - detectSessionInUrl  → pick up the access_token / refresh_token that
 *                           Supabase appends to the URL hash on email
 *                           confirmation + magic-link / OAuth callbacks
 *                           (this is what makes /auth/callback work)
 *   - flowType: 'implicit' → use the implicit grant so email-confirmation
 *                           tokens are delivered directly in the URL hash
 *                           and no client-side `code_verifier` lookup is
 *                           needed. We'd prefer PKCE for security, but it
 *                           requires the same browser session to complete
 *                           the round-trip — if the user signs up in one
 *                           incognito window, that window closes, and they
 *                           click the confirmation link in a fresh window
 *                           (which is exactly what happens in practice),
 *                           localStorage has no code_verifier and Supabase
 *                           returns otp_expired. Implicit survives that.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
    flowType:           'implicit',
  },
});

/**
 * Build a fully-qualified Supabase Edge Function URL.
 *
 * Using this helper instead of hardcoding the host keeps browser fetches in
 * lockstep with the VITE_SUPABASE_URL that Vercel pushes in at build time, so
 * the deployed bundle always talks to the same project the Supabase client is
 * configured for.
 */
export function supabaseFunctionUrl(name: string): string {
  const base = SUPABASE_URL.replace(/\/$/, '');
  return `${base}/functions/v1/${name}`;
}
