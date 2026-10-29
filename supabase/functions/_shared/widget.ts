// ============================================================================
// FlyttGo — the booking widget's websites (docs/WHITE_LABEL.md → Booking widget)
// ============================================================================
//
// A company lists the websites that may show its booking widget
// (organization_widget_origins, migration 00018). The same rules are used
// in three places, so they live here as plain TypeScript (no Deno or
// browser imports; tested in src/test/widget.test.ts):
//   - the database's is_valid_widget_origin() (the pattern below);
//   - the Vercel middleware (middleware.ts), which sends the list as
//     Content-Security-Policy: frame-ancestors on /embed/<slug>;
//   - the embed page (src/pages/EmbedPage.tsx), which checks again which
//     website framed it before showing the booking flow.
// ============================================================================

/** https://host[:port] (no path), or http://localhost / 127.0.0.1 for testing. */
const HTTPS_ORIGIN = /^https:\/\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9](:[0-9]{1,5})?$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$/;

/** As the database stores it: trimmed, lower case, without trailing slashes. */
export function normalizeOrigin(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\/+$/, '');
}

/** A website the widget may be shown on (the rule of is_valid_widget_origin()). */
export function isValidWidgetOrigin(value: string | null | undefined): boolean {
  const o = value ?? '';
  return o.length > 0 && o.length <= 255 && (HTTPS_ORIGIN.test(o) || LOCAL_ORIGIN.test(o));
}

/** The company slug of an embed path: /embed/<slug>. */
export function embedSlug(pathname: string): string | null {
  const m = /^\/embed\/([a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9]))\/?$/.exec(pathname);
  return m ? m[1] : null;
}

/**
 * The frame-ancestors directive for a company's embed page: FlyttGo itself
 * ('self', for the dashboard's preview) and the company's websites. With no
 * valid website only FlyttGo may frame it.
 */
export function frameAncestors(origins: readonly string[]): string {
  const valid = [...new Set(origins.map(normalizeOrigin).filter(isValidWidgetOrigin))].sort();
  return ["frame-ancestors 'self'", ...valid].join(' ');
}

/**
 * The website that framed the embed page, as far as the browser tells:
 * location.ancestorOrigins (Chrome, Safari) is the parent itself; otherwise
 * the referrer's origin; otherwise the origin the widget script passed
 * (?origin=, which any page could set: the frame-ancestors header is what
 * really enforces the list).
 */
export function parentOrigin(input: {
  ancestorOrigins?: ArrayLike<string> | null;
  referrer?: string | null;
  claimed?: string | null;
}): string | null {
  const first = input.ancestorOrigins && input.ancestorOrigins.length > 0 ? input.ancestorOrigins[0] : null;
  if (first) return normalizeOrigin(first);
  if (input.referrer) {
    try { return normalizeOrigin(new URL(input.referrer).origin); } catch { /* not a URL */ }
  }
  return input.claimed ? normalizeOrigin(input.claimed) : null;
}

/** May the embed page show the booking flow inside this parent? */
export function isAllowedParent(parent: string | null, allowed: readonly string[], selfOrigin: string): boolean {
  if (!parent) return false;
  const p = normalizeOrigin(parent);
  if (p === normalizeOrigin(selfOrigin)) return true;                   // FlyttGo's own preview
  return isValidWidgetOrigin(p) && allowed.map(normalizeOrigin).includes(p);
}

/** The snippet a company pastes on its website. */
export function widgetSnippet(appBase: string, slug: string): string {
  const base = appBase.replace(/\/+$/, '');
  return `<div id="flyttgo-booking"></div>\n<script src="${base}/widget.js" data-company="${slug}" data-target="#flyttgo-booking" async></script>`;
}

/** Messages between the embed page and widget.js (public/widget.js). */
export const WIDGET_RESIZE_MESSAGE = 'flyttgo:resize';
