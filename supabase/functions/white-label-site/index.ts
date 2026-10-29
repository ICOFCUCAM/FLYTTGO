// ============================================================================
// FlyttGo — white-label-site Edge Function (public)
// ============================================================================
//
// What a company's page shows (docs/WHITE_LABEL.md): found by its slug
// (flyttgo.no/b/<slug>), its FlyttGo subdomain (<slug>.flyttgo.no) or its
// verified domain. Only an active plan of an active company is shown; the
// database decides that (white_label_public).
//
// Returns the brand, the seller (FlyttGo under Model A, the company under
// Model B), the seller notice, a short-lived link to the logo and, when the
// company chose a website template, the requested page rendered with its
// brand (_shared/site-template.ts: sanitised again here; the browser shows
// it in a sandboxed iframe without scripts).
//
//   POST /functions/v1/white-label-site
//   { "slug": "acme" } | { "host": "booking.acme.no" }, optional "page": "/services"
//
// Also the websites that may show the company's booking widget
// (widget_origins, migration 00018): the embed page checks its parent
// against them. With "widget": true only those are returned, for the
// frame-ancestors header (middleware.ts).
//
// DEPLOY: supabase functions deploy white-label-site --no-verify-jwt
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { serviceClient } from '../_shared/auth.ts';
import { pageFor, renderTemplatePage, type TemplateAsset, type TemplatePage } from '../_shared/site-template.ts';
import { bookingFor, sellerNotice } from '../_shared/white-label.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);
  const body = await req.json().catch(() => ({})) as { slug?: string; host?: string; page?: string; widget?: boolean };
  const slug = typeof body.slug === 'string' ? body.slug.slice(0, 63) : null;
  const host = typeof body.host === 'string' ? body.host.slice(0, 253) : null;
  if (!slug && !host) return json({ error: 'slug or host is required' }, 400);

  const db = serviceClient();
  const { data: site, error } = await db.rpc('white_label_public', { p_slug: slug, p_host: host });
  if (error) return json({ error: 'site lookup failed' }, 500);
  if (!site) return json({ error: 'not found' }, 404);
  const { data: origins } = await db.rpc('widget_origins_public', { p_org: site.organization_id });
  const widgetOrigins: string[] = Array.isArray(origins) ? origins : [];
  if (body.widget === true) return json({ slug: site.slug, widget_origins: widgetOrigins });

  let logoUrl: string | null = null;
  if (site.logo_path) {
    const { data } = await db.storage.from('organization-logos').createSignedUrl(site.logo_path, 3600);
    logoUrl = data?.signedUrl ?? null;
  }
  /* Which booking the page offers: FlyttGo's moves (transport plans), or the
   * company's own Jobs, Appointments, Restaurant or Hotel module
   * (docs/SERVICE_PLATFORM.md). */
  const { data: plan } = await db.from('white_label_plans').select('modules').eq('code', site.plan).maybeSingle();
  const modules: string[] = plan?.modules ?? [];
  const booking = bookingFor(modules);
  const notice = sellerNotice({ ...site, booking });

  let page: { path: string; html: string } | null = null;
  let pages: string[] = [];
  if (site.template_id) {
    const { data: t } = await db.from('site_templates').select('pages, assets').eq('id', site.template_id).eq('status', 'approved').maybeSingle();
    if (t) {
      const all = (t.pages ?? []) as TemplatePage[];
      pages = all.map(p => p.path);
      const p = pageFor(all, body.page ?? '/');
      const base = site.domain && host === site.domain ? '' : `/b/${site.slug}`;
      if (p) {
        page = {
          path: p.path,
          html: renderTemplatePage(p.html, {
            brand: { name: site.display_name, tagline: site.tagline, phone: site.support?.phone, email: site.support?.email,
                     city: site.city, primaryColor: site.primary_color, accentColor: site.accent_color },
            assets: (t.assets ?? []) as TemplateAsset[],
            pageUrl: (path) => path === '/' ? (base || '/') : `${base || '/'}?page=${encodeURIComponent(path)}`,
            bookingUrl: `${base}/book`,
            sellerNotice: notice,
            assetHosts: [new URL(Deno.env.get('SUPABASE_URL')!).host],
          }),
        };
      }
    }
  }

  return json({ ...site, logo_path: undefined, logo_url: logoUrl, seller_notice: notice, modules, booking, pages, page,
                widget_origins: widgetOrigins });
});
