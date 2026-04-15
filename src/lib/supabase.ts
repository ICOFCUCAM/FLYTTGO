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
 *   - flowType: 'pkce'    → PKCE code-exchange flow for OAuth and magic
 *                           links — safer than the implicit grant and the
 *                           Supabase-recommended default for SPAs
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
    flowType:           'pkce',
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
