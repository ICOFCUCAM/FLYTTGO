// ============================================================================
// FlyttGo — website templates for companies' white-label pages
// ============================================================================
//
// The template library (docs/WHITE_LABEL.md, "Website templates") comes from
// Architect-AI's site masters: a template is up to five complete HTML
// pages written by a generator, with {{ASSET:key}} images, {{BASE}} links
// and its colours in CSS variables (--c-primary, --c-accent).
//
//   prepareTemplate()   at import: sanitise every page, turn the sample
//                       company's name, phone and email into placeholders,
//                       point quote forms and links at the booking page,
//                       and list what a person must still check (prices,
//                       reviews, claims) before FlyttGo approves it.
//   renderTemplatePage() when a page is served: sanitise again, fill in the
//                       company's brand, images and links, add the seller
//                       notice.
//
// Safety: pages are shown in a sandboxed iframe without scripts (see
// WhiteLabelSite.tsx), and every page is stripped of scripts, event
// handlers, javascript: links, frames, forms, external styles and refreshes
// here, at import and again at every render. The database refuses an edited
// page that still has any of them (site_template_html_problems).
//
// No Deno or network imports: used by the edge functions, the importer
// script (scripts/import-site-templates.ts) and the Vitest suite.
// ============================================================================

export interface TemplatePage { path: string; html: string; title?: string | null }
export interface TemplateAsset { key: string; url: string }

export interface MasterRow {
  id: string;
  name: string;
  industry?: string[] | null;
  style?: string | null;
  sections?: string[] | null;
  pages: TemplatePage[] | string;
  preview_assets?: TemplateAsset[] | string | null;
}

export interface SanitiseReport {
  scripts: number; handlers: number; jsUrls: number; frames: number;
  forms: number; links: number; imports: number; refresh: number; externalSrc: number;
}

export interface ContentFlag { kind: 'price' | 'review' | 'claim' | 'phone' | 'email' | 'sample_name' | 'hidden'; page: string; sample: string }

/**
 * Catalogue categories for companies choosing a website. A template is in
 * the first category one of its industries belongs to; one in none of
 * them is in "other" (never left out). Patient and clinical services are
 * never imported.
 */
export const TEMPLATE_CATEGORIES: { id: string; label: string; tags: string[] }[] = [
  { id: 'transport', label: 'Moving and transport', tags: [
    'moving', 'movers', 'relocation', 'removals', 'man-and-van', 'logistics', 'freight', 'courier', 'delivery', 'transport',
    'trucking', 'last-mile', 'warehousing', 'storage', 'parcel', 'shipping', 'import export', 'import-export'] },
  { id: 'trades', label: 'Trades, home and car services', tags: [
    'plumbing', 'plumber', 'emergency-plumbing', 'electrician', 'electrical', 'residential-electric', 'hvac',
    'heating-and-cooling', 'air-conditioning', 'trades', 'home-services', 'cleaning', 'house-cleaning', 'maid-service',
    'recurring-cleaning', 'landscaping', 'lawn-care', 'hardscaping', 'construction', 'contractor', 'general-contractor',
    'roofing', 'roofer', 'painting', 'painter', 'pest-control', 'exterminator', 'termite', 'renovation', 'remodeling',
    'kitchen-bath', 'restoration', 'storm-damage', 'solar', 'automotive', 'auto', 'auto-repair', 'mechanic', 'garage',
    'car-care', 'detailing', 'mobile-detailing', 'auto-detailing', 'auto-body', 'body-shop', 'collision-repair', 'tyres',
    'servicing', 'mot'] },
  { id: 'appointments', label: 'Salons, wellness and bookings', tags: [
    'beauty', 'salon', 'hair-salon', 'hair', 'barber', 'barbershop', 'spa', 'day-spa', 'nails', 'nail-salon',
    'personal-care', 'skincare', 'esthetics', 'massage', 'fitness', 'gym', 'personal-training', 'personal-trainer', 'yoga',
    'pilates', 'wellness', 'pet-care', 'pets', 'dog-grooming', 'pet-grooming', 'grooming', 'dog-training', 'tutoring',
    'private tutor', 'music lessons', 'driving school', 'photography'] },
  { id: 'professional', label: 'Professional services', tags: [
    'consulting', 'coaching', 'accounting', 'bookkeeping', 'law-firm', 'lawyer', 'legal', 'professional-services',
    'financial-advisor', 'finance', 'insurance', 'veterinary', 'vet', 'research', 'security'] },
  { id: 'hospitality', label: 'Food, hospitality and events', tags: [
    'hospitality', 'hotel', 'restaurant', 'food', 'cafe', 'bakery', 'catering', 'travel', 'tours', 'tour-operator',
    'events', 'venue'] },
  { id: 'retail', label: 'Shops and online stores', tags: ['ecommerce', 'online-store', 'shop', 'retail'] },
  { id: 'technology', label: 'Software and technology', tags: ['saas', 'software', 'b2b-software', 'technology', 'tech', 'hosting'] },
  { id: 'community', label: 'Education, nonprofit and community', tags: [
    'education', 'e-learning', 'academy', 'nonprofit', 'charity', 'church', 'community'] },
  { id: 'industry', label: 'Property, industry and agriculture', tags: [
    'real-estate', 'realtor', 'property-management', 'manufacturing', 'agriculture', 'mining', 'energy', 'pharmaceutical'] },
  { id: 'entertainment', label: 'Gaming and entertainment', tags: ['gaming', 'games', 'esports', 'entertainment'] },
];
export const OTHER_CATEGORY = { id: 'other', label: 'Other businesses' };

/** Industries never imported: patient and clinical services. */
export const EXCLUDED_INDUSTRIES = ['health', 'clinic', 'medical', 'dental', 'dentist', 'therapy', 'counseling',
  'mental-health', 'psychology', 'optometry', 'eye-care', 'orthodontics', 'pediatrics', 'primary-care',
  'family-medicine', 'womens-health', 'obgyn', 'dermatology', 'chiropractic', 'physical-therapy', 'medical-spa',
  'hospital', 'healthcare'];

/** The catalogue category of a template; null when it is never imported. */
export function templateCategory(industry: readonly string[] | null | undefined): string | null {
  const tags = (industry ?? []).map(i => String(i).toLowerCase());
  if (tags.some(t => EXCLUDED_INDUSTRIES.includes(t))) return null;
  return TEMPLATE_CATEGORIES.find(c => tags.some(t => c.tags.includes(t)))?.id ?? OTHER_CATEGORY.id;
}

/** The label of a category id. */
export function categoryLabel(id: string): string {
  return TEMPLATE_CATEGORIES.find(c => c.id === id)?.label ?? OTHER_CATEGORY.label;
}

/**
 * What a template's pages have, for the catalogue's cards: found at import
 * from the pages' paths, headings and section names (never guessed from the
 * template's name). In the order shown.
 */
export const TEMPLATE_FEATURES: { id: string; label: string; re: RegExp }[] = [
  { id: 'services', label: 'Services', re: /\b(?:our services|services|what we do|treatments|experiences)\b/i },
  { id: 'pricing', label: 'Prices', re: /\b(?:pric(?:e|es|ing)|rates|packages|plans and|our plans|tariffs?)\b/i },
  { id: 'menu', label: 'Menu', re: /\b(?:menu|the courses|tasting|dishes|wine list)\b/i },
  { id: 'gallery', label: 'Gallery', re: /\b(?:gallery|portfolio|our work|lookbook|projects|recent work)\b/i },
  { id: 'testimonials', label: 'Testimonials', re: /\b(?:testimonials?|reviews?|what (?:our )?(?:clients|customers|guests|people|members) say|critics|kind words|trusted by)\b/i },
  { id: 'team', label: 'Team', re: /\b(?:our team|the team|meet the|our people|our staff|stylists|friendly faces|leadership)\b/i },
  { id: 'faq', label: 'FAQ', re: /\b(?:faqs?|frequently asked|questions|quick answers)\b/i },
  { id: 'contact', label: 'Contact', re: /\b(?:contact|get in touch|find us|visit us|reservations?|request (?:service|an appointment)|opening hours)\b/i },
];

/** The features of a template's pages (TEMPLATE_FEATURES ids). */
export function templateFeatures(pages: readonly TemplatePage[]): string[] {
  const found = new Set<string>();
  for (const p of pages) {
    const html = String(p?.html ?? '');
    const where = [
      String(p?.path ?? '').replace(/[/-]+/g, ' '),
      ...[...html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]\s*>/gi)].map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')),
      ...[...html.matchAll(/<(?:section|div|nav)\b[^>]*\s(?:id|class)\s*=\s*("|')([^"']*)\1/gi)].map(m => m[2].replace(/[-_]+/g, ' ')),
    ].map(w => w.replace(/\s+/g, ' ')).join(' \n ');
    for (const f of TEMPLATE_FEATURES) if (f.re.test(where)) found.add(f.id);
  }
  return TEMPLATE_FEATURES.map(f => f.id).filter(id => found.has(id));
}

/** The label of a feature id. */
export const featureLabel = (id: string) => TEMPLATE_FEATURES.find(f => f.id === id)?.label ?? id;

/** "Best for …": the template's industries in words, at most three (none: its category). */
export function bestFor(industry: readonly string[] | null | undefined): string {
  const words: string[] = [];
  for (const i of industry ?? []) {
    const w = String(i).toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (w && !words.some(x => x.includes(w) || w.includes(x) || (x.length >= 5 && w.startsWith(x.slice(0, 5))))) words.push(w);
    if (words.length === 3) break;
  }
  if (!words.length) return categoryLabel(templateCategory(industry) ?? OTHER_CATEGORY.id).toLowerCase();
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export interface PreparedTemplate {
  id: string;
  name: string;
  industry: string[];
  style: string | null;
  pages: TemplatePage[];
  assets: TemplateAsset[];
  source_id: string;
  flags: ContentFlag[];
  removed: SanitiseReport;
  /** What the pages have (pricing, gallery, team…), for the catalogue's cards (templateFeatures()). */
  features: string[];
}

export interface Brand {
  name: string;
  tagline?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
}

export interface RenderContext {
  brand: Brand;
  assets: TemplateAsset[];
  /** URL of another page of the site, e.g. (p) => `/b/acme?page=${p}`. */
  pageUrl: (path: string) => string;
  /** The company's booking page. */
  bookingUrl: string;
  /** Shown at the foot of every page: who sells the moves. */
  sellerNotice: string;
  /** Hosts images may come from (the asset store). */
  assetHosts?: string[];
}

const BOOK_LABEL = 'Get a price and book';

/** Escape text for HTML. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function count(re: RegExp, s: string): number {
  return (s.match(re) ?? []).length;
}

/**
 * Forms become a card with a link to the booking page. The card keeps the
 * form's classes (and so the template's look); what the form asked for is
 * asked on the booking page instead.
 */
export function replaceForms(html: string): string {
  return String(html ?? '').replace(/<form\b([^>]*)>[\s\S]*?<\/form\s*>/gi, (_m, attrs: string) => {
    const cls = /\sclass\s*=\s*("|')([^"']*)\1/i.exec(attrs)?.[2]?.replace(/[^\w\s-]/g, '') ?? '';
    return `<div class="${cls ? `${cls} ` : ''}fg-book-card"><p class="fg-book"><a href="{{BOOKING_URL}}">${BOOK_LABEL}</a></p></div>`;
  }).replace(/<\/?form\b[^>]*>/gi, '');
}

/**
 * Remove everything that runs code, loads from elsewhere or sends data:
 * scripts, event handlers, javascript: URLs, frames and embeds, <base>,
 * meta refresh, <link> tags, CSS @import, and forms (replaced by a link to
 * the booking page). Images from hosts outside `assetHosts` are dropped.
 */
export function sanitiseHtml(html: string, assetHosts: string[] = []): { html: string; removed: SanitiseReport } {
  let h = String(html ?? '');
  const removed: SanitiseReport = { scripts: 0, handlers: 0, jsUrls: 0, frames: 0, forms: 0, links: 0, imports: 0, refresh: 0, externalSrc: 0 };

  removed.scripts = count(/<script\b/gi, h);
  h = h.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[^>]*>/gi, '').replace(/<\/script\s*>/gi, '');

  const frameRe = /<(iframe|frame|frameset|object|embed|applet|portal)\b[\s\S]*?(<\/\1\s*>|\/?>)/gi;
  removed.frames = count(/<(iframe|frame|frameset|object|embed|applet|portal)\b/gi, h);
  h = h.replace(frameRe, '');

  removed.forms = count(/<form\b/gi, h);
  h = replaceForms(h);
  // Inputs left outside a form submit nothing; drop them with buttons that
  // would.
  h = h.replace(/<(input|select|textarea)\b[^>]*>/gi, '').replace(/<\/(select|textarea)\s*>/gi, '');

  removed.handlers = count(/\son[a-z]+\s*=/gi, h);
  h = h.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  removed.jsUrls = count(/(?:javascript|vbscript|data:text\/html)\s*:/gi, h);
  h = h.replace(/(\s(?:href|src|action|formaction|xlink:href)\s*=\s*)("|')\s*(?:javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1$2#$2');

  removed.links = count(/<link\b/gi, h) + count(/<base\b/gi, h);
  h = h.replace(/<link\b[^>]*>/gi, '').replace(/<base\b[^>]*>/gi, '');

  removed.refresh = count(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/gi, h);
  h = h.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '');

  removed.imports = count(/@import\b/gi, h);
  h = h.replace(/@import\b[^;]*;?/gi, '');
  // url() in CSS may only point at the asset store or be a placeholder.
  h = h.replace(/url\(\s*(['"]?)(https?:)?\/\/([^/'")\s]+)([^)]*)\)/gi, (m, _q, _p, host) =>
    assetHosts.includes(String(host).toLowerCase()) ? m : 'none');

  h = h.replace(/(<(?:img|source|video|audio|track)\b[^>]*?)\s(src|srcset|poster)\s*=\s*("|')\s*(?:https?:)?\/\/([^/"']+)[^"']*\3/gi,
    (m, start, _attr, _q, host) => {
      if (assetHosts.includes(String(host).toLowerCase())) return m;
      removed.externalSrc++;
      return start;
    });
  return { html: h, removed };
}

const PRICE_RE = /(?:[$€£]\s?\d[\d,.]*|\b\d[\d .,]*\s?(?:kr|NOK|USD|EUR|GBP|,-)\b|\b\d+\s?\/\s?(?:hr|hour|time|t)\b|\bper (?:hour|mover|move)\b)/gi;
const REVIEW_RE = /(?:★|&#9733;|\btestimonial|\breviews?\b|\brated\s+\d|\b\d(?:\.\d)?\s?(?:\/\s?5|stars?|out of 5)\b|google reviews|trustpilot)/gi;
const CLAIM_RE = /(?:\bsince\s+(?:19|20)\d\d\b|\b\d[\d,.]*\+?\s?(?:moves|customers|clients|years|trucks|deliveries|shipments|countries|cities)\b|\b(?:licensed|insured|bonded|award[- ]winning|#1|number one|guaranteed)\b)/gi;
const PHONE_RE = /(?:\+?1[ .-]?)?\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b|\+\d{2}[ \d]{8,14}\d/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

function visibleText(html: string): string {
  return html.replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
}

/** What a person must still check on a page before approval. */
export function contentFlags(html: string, page: string, sampleName?: string): ContentFlag[] {
  const text = visibleText(html);
  const out: ContentFlag[] = [];
  const add = (kind: ContentFlag['kind'], re: RegExp) => {
    for (const m of text.matchAll(re)) {
      const i = m.index ?? 0;
      out.push({ kind, page, sample: text.slice(Math.max(0, i - 30), i + m[0].length + 30).trim() });
      if (out.filter(f => f.kind === kind && f.page === page).length >= 20) break;
    }
  };
  add('price', PRICE_RE);
  add('review', REVIEW_RE);
  add('claim', CLAIM_RE);
  add('phone', PHONE_RE);
  add('email', EMAIL_RE);
  if (sampleName && sampleName.length >= 3) {
    add('sample_name', new RegExp(`\\b${sampleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'));
  }
  return out;
}

function parseJson<T>(v: T | string | null | undefined, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

/** The template id in FlyttGo: lower case, a-z 0-9 and dashes. */
export function templateId(sourceId: string): string {
  return String(sourceId).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'template';
}

/**
 * Import step. Sanitises each page, replaces the sample company's name,
 * phones and emails with placeholders, sends quote links and forms to the
 * booking page, and lists what is left for review.
 */
export function prepareTemplate(row: MasterRow, assetHosts: string[] = []): PreparedTemplate {
  const pages = parseJson<TemplatePage[]>(row.pages, []);
  const assets = parseJson<TemplateAsset[]>(row.preview_assets ?? null, []);
  const removed: SanitiseReport = { scripts: 0, handlers: 0, jsUrls: 0, frames: 0, forms: 0, links: 0, imports: 0, refresh: 0, externalSrc: 0 };
  const name = String(row.name ?? '').trim();
  // The name as written in the page's text, where "&" is "&amp;".
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRe = name.length >= 3
    ? new RegExp(`\\b(?:${[...new Set([name, escapeHtml(name)])].map(esc).join('|')})(?![\\w])`, 'g') : null;
  const out: TemplatePage[] = [];
  const flags: ContentFlag[] = [];
  for (const p of pages) {
    if (!p || typeof p.html !== 'string') continue;
    const path = typeof p.path === 'string' && p.path.startsWith('/') ? p.path : '/';
    const s = sanitiseHtml(p.html, assetHosts);
    for (const k of Object.keys(removed) as (keyof SanitiseReport)[]) removed[k] += s.removed[k];
    let h = s.html;
    h = h.replace(/href\s*=\s*("|')\s*(?:tel|sms):[^"']*\1/gi, 'href=$1tel:{{brand.phone_tel}}$1');
    h = h.replace(/href\s*=\s*("|')\s*mailto:[^"']*\1/gi, 'href=$1mailto:{{brand.email}}$1');
    h = h.replace(/href\s*=\s*("|')#(?:quote|estimate|booking|book|get-quote)[\w-]*\1/gi, 'href=$1{{BOOKING_URL}}$1');
    // Text only (not inside tags): the sample company's name, phones, emails.
    h = h.replace(/>([^<]+)</g, (_m, text: string) => {
      let t = text;
      if (nameRe) t = t.replace(nameRe, '{{brand.name}}');
      t = t.replace(EMAIL_RE, '{{brand.email}}').replace(PHONE_RE, '{{brand.phone}}');
      return `>${t}<`;
    });
    if (nameRe) h = h.replace(/(<title>[^<]*)/i, (m) => m.replace(nameRe, '{{brand.name}}'));
    // …and in what screen readers read out: image descriptions and labels.
    if (nameRe) h = h.replace(/(\s(?:alt|title|aria-label)\s*=\s*")([^"]*)"/gi, (_m, a: string, v: string) => `${a}${v.replace(nameRe, '{{brand.name}}')}"`);
    flags.push(...contentFlags(h, path, name));
    out.push({ path, html: h, title: p.title ?? null });
  }
  return {
    id: templateId(row.id), name, industry: (row.industry ?? []).map(String), style: row.style ?? null,
    pages: out, assets: assets.filter(a => a && typeof a.key === 'string' && typeof a.url === 'string'),
    source_id: String(row.id), flags, removed, features: templateFeatures(out),
  };
}

/** The problems the database also refuses in a stored page. */
export function htmlProblems(html: string): string[] {
  const p: string[] = [];
  if (/<script\b/i.test(html)) p.push('script');
  if (/\son[a-z]+\s*=/i.test(html)) p.push('event handler');
  if (/(?:javascript|vbscript)\s*:/i.test(html)) p.push('javascript: link');
  if (/<(iframe|frame|object|embed|applet|portal)\b/i.test(html)) p.push('frame or embed');
  if (/<form\b/i.test(html)) p.push('form');
  if (/<(link|base)\b/i.test(html)) p.push('link or base tag');
  if (/http-equiv\s*=\s*["']?refresh/i.test(html)) p.push('refresh');
  return p;
}

function telOf(phone: string | null | undefined): string {
  return String(phone ?? '').replace(/[^\d+]/g, '');
}

/**
 * Serve step: one page of a company's site. Sanitised again, then the
 * company's brand, images and links filled in, with the seller notice at
 * the foot of the page.
 */
export function renderTemplatePage(html: string, ctx: RenderContext): string {
  const hosts = (ctx.assetHosts ?? []).map(h => h.toLowerCase());
  let h = sanitiseHtml(html, hosts).html;
  const b = ctx.brand;
  const assets = new Map(ctx.assets.map(a => [a.key, a.url]));
  h = h.replace(/\{\{ASSET:([^}]{1,60})\}\}/g, (_m, key: string) => {
    const url = assets.get(key) ?? assets.get(key.replace(/\.\d+$/, '')) ?? assets.get(`${key}.1`) ?? '';
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && hosts.includes(u.host.toLowerCase()) ? escapeHtml(url) : '';
    } catch { return ''; }
  });
  // Links between the site's pages, and to the booking page, leave the frame.
  h = h.replace(/href\s*=\s*("|')\{\{BASE\}\}(\/[^"']*)?\1/g, (_m, q: string, path: string) =>
    `href=${q}${escapeHtml(ctx.pageUrl(path && path !== '' ? path : '/'))}${q} target="_top"`);
  h = h.replace(/\{\{BASE\}\}/g, '');
  h = h.replace(/href\s*=\s*("|')\{\{BOOKING_URL\}\}\1/g, (_m, q: string) => `href=${q}${escapeHtml(ctx.bookingUrl)}${q} target="_top"`);
  h = h.replace(/\{\{BOOKING_URL\}\}/g, escapeHtml(ctx.bookingUrl));
  const values: Record<string, string> = {
    'brand.name': b.name, 'brand.tagline': b.tagline ?? '', 'brand.phone': b.phone ?? '',
    'brand.phone_tel': telOf(b.phone), 'brand.email': b.email ?? '', 'brand.city': b.city ?? '',
  };
  h = h.replace(/\{\{(brand\.[a-z_]+)\}\}/g, (_m, k: string) => escapeHtml(values[k] ?? ''));
  // Any other placeholder is left out rather than shown.
  h = h.replace(/\{\{[A-Za-z_.:-]{1,60}\}\}/g, '');

  const colours: string[] = [];
  if (b.primaryColor && /^#[0-9a-f]{6}$/i.test(b.primaryColor)) colours.push(`--c-primary:${b.primaryColor}`);
  if (b.accentColor && /^#[0-9a-f]{6}$/i.test(b.accentColor)) colours.push(`--c-accent:${b.accentColor}`);
  const style = `<style>${colours.length ? `:root{${colours.join(';')}}` : ''}`
    + '.fg-book{margin:1.5rem 0}.fg-book a{display:inline-block;padding:.8rem 1.4rem;border-radius:.5rem;'
    + 'background:var(--c-primary,#0b2e59);color:#fff;font-weight:700;text-decoration:none}'
    + '.fg-book-card{display:flex;align-items:center;justify-content:center;min-height:8rem}.fg-book-card .fg-book{margin:0}'
    + '.fg-book-card .fg-book a{background:var(--c-accent,var(--c-primary,#0b2e59));padding:1rem 1.8rem;font-size:1rem}'
    // Pages are shown without scripts: content a script would have faded in
    // is shown as it ends up (the importer's snapshot already does this).
    + '.reveal{opacity:1!important;transform:none!important}'
    + '.fg-seller{font:13px/1.5 system-ui,sans-serif;background:#f3f4f6;color:#374151;padding:12px 16px;text-align:center}'
    + '</style>';
  h = /<\/head>/i.test(h) ? h.replace(/<\/head>/i, `${style}</head>`) : style + h;
  const notice = `<div class="fg-seller">${escapeHtml(ctx.sellerNotice)}</div>`;
  h = /<\/body>/i.test(h) ? h.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${notice}</body>`) : h + notice;
  return h;
}

/** The page of a template for a path ('/' when none matches). */
export function pageFor(pages: TemplatePage[], path: string | null | undefined): TemplatePage | null {
  const want = String(path ?? '/').replace(/\/+$/, '') || '/';
  return pages.find(p => (p.path.replace(/\/+$/, '') || '/') === want) ?? pages.find(p => p.path === '/') ?? pages[0] ?? null;
}
