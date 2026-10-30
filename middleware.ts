// ============================================================================
// FlyttGo — Vercel Routing Middleware: who may frame the booking widget
// ============================================================================
//
// Runs on Vercel before the static files, for /embed/<slug> only (the page
// the booking widget, public/widget.js, puts in its frame). It answers with
// the app's page and a Content-Security-Policy frame-ancestors header that
// lists FlyttGo itself and the websites the company registered
// (organization_widget_origins, migration 00018, read through
// white-label-site). Any other website's frame is refused by the browser.
// If the list cannot be read, only FlyttGo may frame the page.
//
// The embed page checks its parent again (src/pages/EmbedPage.tsx), so the
// list still holds where this middleware does not run (vite dev, another
// host): docs/WHITE_LABEL.md → Booking widget.
//
// Needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the Vercel project
// (already set for the app; docs/DEPLOYMENT.md §1).
// ============================================================================
import { embedSlug, frameAncestors } from './supabase/functions/_shared/widget.js';

export const config = { matcher: '/embed/:path*' };

declare const process: { env: Record<string, string | undefined> };

async function registeredOrigins(slug: string): Promise<string[]> {
  const base = (process.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
  if (!base) return [];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  try {
    const res = await fetch(`${base}/functions/v1/white-label-site`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: process.env.VITE_SUPABASE_ANON_KEY ?? '' },
      body: JSON.stringify({ slug, widget: true }),
      signal: ctl.signal,
    });
    if (!res.ok) return [];
    const data = await res.json() as { widget_origins?: unknown };
    return Array.isArray(data.widget_origins) ? data.widget_origins.filter((o): o is string => typeof o === 'string') : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const slug = embedSlug(url.pathname);
  const origins = slug ? await registeredOrigins(slug) : [];
  const shell = await fetch(new URL('/index.html', url));
  const headers = new Headers(shell.headers);
  /* fetch() has already decoded the body. */
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('x-frame-options');
  headers.set('Content-Security-Policy', frameAncestors(origins));
  headers.set('Cache-Control', 'no-store');
  return new Response(shell.body, { status: shell.ok ? 200 : shell.status, headers });
}
