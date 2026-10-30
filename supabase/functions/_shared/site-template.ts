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

export interface ContentFlag {
  kind: 'price' | 'review' | 'claim' | 'phone' | 'email' | 'sample_name' | 'hidden' | 'address' | 'statistic';
  page: string; sample: string;
}

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
  /** The sample company's name and the short forms its logo uses (sampleShortNames()). */
  sample_names: string[];
  /** Of those, the ones looked for in the text (the name, and short forms that are not everyday words). */
  flag_names: string[];
}

export interface Brand {
  name: string;
  tagline?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  /** The company's logo (https, on an asset host); shown in the template's brand slots. */
  logoUrl?: string | null;
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
  /**
   * The resolved images (site_template_image_map(), 00023, through
   * renderImages() in _shared/image-library.ts): the company's own, the
   * template's approved ones, the library's or a neutral block, per slot.
   * Without it the page uses `assets` as before.
   */
  images?: RenderImages | null;
}

/** What the renderer fills in for one image slot: an address, or none (the neutral block). */
export interface RenderImage {
  url: string | null;
  alt?: string | null;
  source: 'company' | 'template' | 'library' | 'assets' | 'fallback';
  focal?: { x: number; y: number } | null;
}
/** The resolved images of a page; 'assets' mode: slots not in the map use the template's assets as before. */
export interface RenderImages { mode: 'library' | 'assets'; byKey: Record<string, RenderImage> }

/**
 * The neutral block: a plain rectangle in the company's colour, no photo, as
 * an SVG data address (it stretches to the slot; safe inside src="" and
 * CSS url() because nothing in it needs quoting).
 */
export function neutralImage(colour: string | null | undefined): string {
  const c = /^#[0-9a-f]{6}$/i.test(colour ?? '') ? colour! : '#0b2e59';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9" preserveAspectRatio="none"><rect width="16" height="9" fill="${c}"/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
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
const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
/** A sample street address, US town and state ("Nashville, TN", "Cedar Grove OH 43004") or suite. */
const ADDRESS_RE = new RegExp(`\\b\\d{1,5}\\s+(?:[A-Z][a-z]+\\.?\\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy)\\b\\.?`
  + `|\\b[A-Z][a-z]+(?:\\s[A-Z][a-z]+)?,?\\s(?:${US_STATES})\\b(?:\\s\\d{5}(?:-\\d{4})?)?|\\b(?:Suite|Ste\\.)\\s\\d+\\b`, 'g');
/** A sample figure: "18,000+", "500+", "98%", "12k+". */
const STATISTIC_RE = /\b\d{1,3}(?:,\d{3})+\s?\+?|\b\d+(?:\.\d+)?\s?(?:%|k\+|\+)(?![\d\w])/g;

function visibleText(html: string): string {
  return html.replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
}

/** What a person must still check on a page before approval. */
export function contentFlags(html: string, page: string, sampleName?: string, shortNames: string[] = []): ContentFlag[] {
  // What a visitor reads, and the description search engines show.
  const meta = [...html.matchAll(/<meta\b[^>]*\sname\s*=\s*"description"[^>]*\scontent\s*=\s*"([^"]*)"/gi)].map(m => m[1]).join(' ');
  const text = `${visibleText(html)} ${meta}`.trim();
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
  add('address', ADDRESS_RE);
  add('statistic', STATISTIC_RE);
  if (sampleName && sampleName.length >= 3) {
    add('sample_name', new RegExp(`\\b${sampleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'));
  }
  for (const n of shortNames) {                   // a short form left over, as written in the logo
    add('sample_name', new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu'));
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

/* ── The brand slot: where a template writes its company's name as a logo ── */

/** A class that marks a brand or logo element (brand, logo, nav-brand, site-name…). */
const BRAND_CLASS = /(?:^|-)(?:brand|logo|wordmark)(?:-|$)|^site-(?:name|title)$/i;
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function decodeText(html: string): string {
  return html.replace(/<br\b[^>]*>|<\/?(?:div|p|h[1-6]|li|ul|ol|section|header|footer|nav)\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

/** Where the element opened at `start` (tag `tag`, opening tag ending at `openEnd`) ends: [inner end, outer end]. */
function closeOf(html: string, tag: string, openEnd: number): [number, number] | null {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = openEnd;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1]) { depth--; if (depth === 0) return [m.index, m.index + m[0].length]; }
    else if (!m[0].endsWith('/>')) depth++;
  }
  return null;
}

/** The top-level parts of an element's content: elements (with their content) and text. */
function topLevel(inner: string): { html: string; element: boolean }[] {
  const out: { html: string; element: boolean }[] = [];
  let i = 0;
  while (i < inner.length) {
    if (inner.startsWith('<!--', i)) { const e = inner.indexOf('-->', i); i = e < 0 ? inner.length : e + 3; continue; }
    const m = /^<([a-z][a-z0-9-]*)\b[^>]*>/i.exec(inner.slice(i));
    if (m) {
      const tag = m[1].toLowerCase();
      const openEnd = i + m[0].length;
      const close = VOID_TAGS.has(tag) || m[0].endsWith('/>') ? null : closeOf(inner, tag, openEnd);
      const end = close ? close[1] : openEnd;
      out.push({ html: inner.slice(i, end), element: true });
      i = end;
      continue;
    }
    const next = inner.indexOf('<', i + 1);
    const end = next < 0 ? inner.length : next;
    out.push({ html: inner.slice(i, end), element: false });
    i = end;
  }
  return out;
}

/** Each brand or logo element of a page: its opening tag, content and where they are. */
function brandSlots(html: string): { start: number; openEnd: number; innerEnd: number; end: number; open: string; inner: string; text: string }[] {
  const slots: ReturnType<typeof brandSlots> = [];
  const re = /<([a-z][a-z0-9]*)\b([^>]*\sclass\s*=\s*("|')([^"']*)\3[^>]*)>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const tag = m[1].toLowerCase();
    if (VOID_TAGS.has(tag) || !m[4].split(/\s+/).some(c => BRAND_CLASS.test(c))) continue;
    const openEnd = m.index + m[0].length;
    const close = closeOf(html, tag, openEnd);
    if (!close) continue;
    const inner = html.slice(openEnd, close[0]);
    slots.push({ start: m.index, openEnd, innerEnd: close[0], end: close[1], open: m[0], inner, text: decodeText(inner) });
    re.lastIndex = close[1];                       // a slot inside a slot is the same slot
  }
  return slots;
}

/**
 * Words that start many company names and are also everyday words: a short
 * form of the sample name that is one of them ("Fast" of "Fast Man & Van")
 * is replaced only in the brand slot, never in the page's text.
 */
const COMMON_WORDS = new Set(('the a an our your my fast swift quick rapid express prime first best top pro premier elite royal grand '
  + 'golden gold silver iron steel stone rock red blue green black white bright clear clean fresh true pure smart simple easy happy '
  + 'good great big little old new modern urban city metro north south east west central coastal harbor harbour river lake ocean sea '
  + 'sun star moon sky peak summit oak pine maple cedar willow rose home house family local united national global total all one '
  + 'care plus max safe sure kind wise bold calm still open free just real fine nice warm cool hot light dark main high low').split(' '));

/**
 * The short forms of a template's sample name: the first word(s) of the
 * name where a page writes only them as its logo (a brand slot reading
 * "Verve" for "Verve Hair Salon").
 */
export function sampleShortNames(name: string, pages: readonly TemplatePage[]): string[] {
  const words = name.trim().split(/\s+/);
  const prefixes = words.slice(0, -1).map((_w, i) => words.slice(0, i + 1).join(' ')).filter(p => p.replace(/[^\p{L}\p{N}]/gu, '').length >= 3);
  const found = new Set<string>();
  for (const p of pages) for (const slot of brandSlots(String(p?.html ?? ''))) {
    const hit = prefixes.find(x => x.toLowerCase() === slot.text.toLowerCase());
    if (hit) found.add(slot.text);
  }
  return [...found];
}

/** A short form that may be replaced in the page's text too (not an everyday word, never written in lower case there). */
function distinctive(short: string, text: string): boolean {
  const lower = short.toLowerCase();
  if (!short.includes(' ') && COMMON_WORDS.has(lower)) return false;
  return !new RegExp(`(?:^|[^\\p{L}\\p{N}])${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

/**
 * The brand slots of a page that show the sample name (in full, as a short
 * form, or already as {{brand.name}}) become the company's: its logo (when
 * it has one) and name, after the slot's decorative marks.
 */
function fillBrandSlots(html: string, names: string[]): string {
  const wanted = new Set(['{{brand.name}}', ...names].map(n => n.toLowerCase()));
  let out = '';
  let at = 0;
  for (const slot of brandSlots(html)) {
    if (!wanted.has(slot.text.toLowerCase())) continue;
    const marks = topLevel(slot.inner).filter(n => n.element && decodeText(n.html) === '').map(n => n.html).join('');
    const open = /\sclass\s*=\s*("|')/i.test(slot.open)
      ? slot.open.replace(/(\sclass\s*=\s*)("|')([^"']*)\2/i, (_m, a: string, q: string, c: string) => `${a}${q}${c} fg-brand-slot${q}`)
      : slot.open;
    out += html.slice(at, slot.start) + open + marks + '{{brand.logo}}<span class="fg-brand-name">{{brand.name}}</span>'
      + html.slice(slot.innerEnd, slot.end);
    at = slot.end;
  }
  return out + html.slice(at);
}

/** A link a visitor follows to book: "Book now", "Reserve", "Get a free quote", "Request an appointment"… */
export const BOOKING_TEXT = /^(?:book(?:\s|$)|book(?:ing)? (?:now|online|a|an|your|today)|reserve|request (?:a |an |your )?(?:quote|estimate|appointment|reservation|booking|service|table|callback|visit|seating)|get (?:a |an |your )?(?:free |instant |fast )?(?:quote|estimate|price)|free (?:quote|estimate)|schedule (?:a |an |your )?(?:visit|service|appointment|consultation|pickup|move|call)|make (?:a |an )?(?:booking|reservation|appointment)|claim (?:offer|your (?:discount|offer)))/i;

/** The visible text of each link of a page, with its href. */
export function pageLinks(html: string): { href: string; text: string; start: number; end: number; open: string }[] {
  const out: ReturnType<typeof pageLinks> = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const href = /\shref\s*=\s*("|')([^"']*)\1/i.exec(m[1])?.[2] ?? '';
    out.push({ href, text: decodeText(m[2]).replace(/^[^\p{L}\p{N}]+/u, ''), start: m.index, end: m.index + m[0].length, open: `<a${m[1]}>` });
  }
  return out;
}

/** A booking link that does not lead to the booking page (tel: and mailto: links are calls and emails, not bookings). */
export const strayBookingLink = (l: { href: string; text: string }) =>
  BOOKING_TEXT.test(l.text) && l.href !== '{{BOOKING_URL}}' && !/^(?:tel|sms|mailto):/i.test(l.href);

/** Every link that reads as booking leads to the booking page. */
function bookingLinksToBooking(html: string): string {
  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (m, attrs: string, inner: string) => {
    const href = /\shref\s*=\s*("|')([^"']*)\1/i.exec(attrs)?.[2] ?? '';
    if (!strayBookingLink({ href, text: decodeText(inner).replace(/^[^\p{L}\p{N}]+/u, '') })) return m;
    const a = /\shref\s*=/i.test(attrs) ? attrs.replace(/\shref\s*=\s*("|')[^"']*\1/i, ' href="{{BOOKING_URL}}"') : `${attrs} href="{{BOOKING_URL}}"`;
    return `<a${a}>${inner}</a>`;
  });
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
  const clean = pages.filter(p => p && typeof p.html === 'string').map(p => {
    const s = sanitiseHtml(p.html, assetHosts);
    for (const k of Object.keys(removed) as (keyof SanitiseReport)[]) removed[k] += s.removed[k];
    return { ...p, html: s.html };
  });
  // The sample name's short forms (the logo reading "Verve" for "Verve Hair
  // Salon"): always replaced in brand slots; in the text too when they are
  // not everyday words.
  const shortNames = name.length >= 3 ? sampleShortNames(name, clean) : [];
  const allText = clean.map(p => visibleText(p.html)).join(' ');
  const textShort = shortNames.filter(n => distinctive(n, allText));
  const shortRe = textShort.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${textShort.flatMap(n => [n, escapeHtml(n)]).map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'gu') : null;
  for (const p of clean) {
    const path = typeof p.path === 'string' && p.path.startsWith('/') ? p.path : '/';
    let h = p.html;
    h = h.replace(/href\s*=\s*("|')\s*(?:tel|sms):[^"']*\1/gi, 'href=$1tel:{{brand.phone_tel}}$1');
    h = h.replace(/href\s*=\s*("|')\s*mailto:[^"']*\1/gi, 'href=$1mailto:{{brand.email}}$1');
    h = h.replace(/href\s*=\s*("|')#(?:quote|estimate|booking|book|get-quote)[\w-]*\1/gi, 'href=$1{{BOOKING_URL}}$1');
    // …and so does every other link that reads as booking ("Book now" pointing at the contact page).
    h = bookingLinksToBooking(h);
    // Text only (not inside tags): the sample company's name, phones, emails.
    h = h.replace(/>([^<]+)</g, (_m, text: string) => {
      let t = text;
      if (nameRe) t = t.replace(nameRe, '{{brand.name}}');
      if (shortRe) t = t.replace(shortRe, '{{brand.name}}');
      t = t.replace(EMAIL_RE, '{{brand.email}}').replace(PHONE_RE, '{{brand.phone}}');
      return `>${t}<`;
    });
    for (const re of [nameRe, shortRe]) {
      if (!re) continue;
      h = h.replace(/(<title>[^<]*)/i, (m) => m.replace(re, '{{brand.name}}'));
      // …and in what screen readers read out: image descriptions and labels.
      h = h.replace(/(\s(?:alt|title|aria-label)\s*=\s*")([^"]*)"/gi, (_m, a: string, v: string) => `${a}${v.replace(re, '{{brand.name}}')}"`);
    }
    // …and in the description search engines show: name, phones and emails.
    h = h.replace(/(<meta\b[^>]*\sname\s*=\s*"(?:description|og:title|og:description|twitter:title|twitter:description)"[^>]*\scontent\s*=\s*")([^"]*)"/gi,
      (_m, a: string, v: string) => {
        let t = v;
        for (const re of [nameRe, shortRe]) if (re) t = t.replace(re, '{{brand.name}}');
        return `${a}${t.replace(EMAIL_RE, '{{brand.email}}').replace(PHONE_RE, '{{brand.phone}}')}"`;
      });
    // The logo: the company's name (and its logo, when it has one).
    h = fillBrandSlots(h, [name, escapeHtml(name), ...shortNames]);
    flags.push(...contentFlags(h, path, name, textShort));
    out.push({ path, html: h, title: p.title ?? null });
  }
  return {
    id: templateId(row.id), name, industry: (row.industry ?? []).map(String), style: row.style ?? null,
    pages: out, assets: assets.filter(a => a && typeof a.key === 'string' && typeof a.url === 'string'),
    source_id: String(row.id), flags, removed, features: templateFeatures(out), sample_names: [name, ...shortNames],
    flag_names: [name, ...textShort],
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

/** The hosts of a template's assets (and of other URLs, e.g. a logo): what a preview lets images load from. */
export function hostsOf(assets: readonly { url: string }[], ...urls: (string | null | undefined)[]): string[] {
  const hosts = [...assets.map(a => a.url), ...urls].map(u => { try { return new URL(String(u ?? '')).host.toLowerCase(); } catch { return ''; } });
  return [...new Set(hosts.filter(Boolean))];
}

/** An https URL on one of the asset hosts, else null. */
function safeAssetUrl(url: string | null | undefined, hosts: string[]): string | null {
  try {
    const u = new URL(String(url ?? ''));
    return u.protocol === 'https:' && hosts.includes(u.host.toLowerCase()) ? u.href : null;
  } catch { return null; }
}

/**
 * The brand slot (fillBrandSlots()) whatever the company's name: it may
 * shrink and wrap instead of pushing the header apart or being clipped,
 * and a long name is set smaller, with less letter spacing (templates
 * often write the name in spaced capitals). Words that cannot fit break
 * anywhere on the page rather than overflow it. With a logo, the logo
 * takes the place of the template's own mark.
 */
function brandCss(name: string, logo: boolean): string {
  const n = Array.from(String(name ?? '')).length;
  let css = 'html{overflow-wrap:break-word}'
    + '.fg-brand-slot{min-width:0;max-width:100%;flex-shrink:1;flex-wrap:nowrap}'
    + '.fg-brand-name{min-width:0;overflow-wrap:anywhere;white-space:normal}'
    + '.fg-logo{display:inline-block;height:1.6em;max-height:48px;width:auto;max-width:180px;object-fit:contain;flex:none;vertical-align:middle}';
  if (n > 40) css += '.fg-brand-name{font-size:.62em;letter-spacing:0;line-height:1.15;display:inline-block;max-width:18em}';
  else if (n > 18) css += '.fg-brand-name{font-size:.8em;letter-spacing:.02em;line-height:1.15;display:inline-block;max-width:16em}';
  if (logo) css += '.fg-brand-slot>:not(.fg-logo):not(.fg-brand-name){display:none!important}';
  return css;
}

/* ── Contrast (WCAG 2.x) ─────────────────────────────────────────────── */

function channels(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/** Relative luminance of a #rrggbb colour (WCAG 2.x). */
export function luminance(hex: string): number {
  const c = channels(hex);
  if (!c) return 1;
  const [r, g, b] = c.map(x => x / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of two #rrggbb colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** White or near-black text, whichever reads better on a colour. */
export function readableOn(hex: string): string {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#111827') ? '#ffffff' : '#111827';
}

/** WCAG AA for normal text. */
export const AA_CONTRAST = 4.5;

/**
 * The same colour, darkened (or lightened) only as much as needed for
 * `target` contrast against `against`; the colour itself when it already
 * has it. A suggestion for the company, never applied on its own.
 */
export function readableShade(hex: string, against = '#ffffff', target = AA_CONTRAST): string {
  const c = channels(hex);
  if (!c || contrastRatio(hex, against) >= target) return hex;
  const darker = luminance(against) > 0.18;
  const toHex = (v: number[]) => '#' + v.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
  for (let k = 0.02; k <= 1.0001; k += 0.02) {
    const v = c.map(x => darker ? x * (1 - k) : x + (255 - x) * k);
    const out = toHex(v);
    if (contrastRatio(out, against) >= target) return out;
  }
  return darker ? '#000000' : '#ffffff';
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
  const onHost = (url: string) => {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && hosts.includes(u.host.toLowerCase());
    } catch { return false; }
  };
  const assetFor = (key: string) => assets.get(key) ?? assets.get(key.replace(/\.\d+$/, '')) ?? assets.get(`${key}.1`) ?? '';
  const resolved = ctx.images ?? null;
  if (resolved) {
    // The resolved images (00023): each slot's own image, or the neutral
    // block in the company's colour; never a photo from elsewhere.
    const block = neutralImage(b.primaryColor);
    const pick = (key: string): RenderImage | null =>
      resolved.byKey[key] ?? resolved.byKey[key.replace(/\.\d+$/, '')] ?? resolved.byKey[`${key}.1`] ?? null;
    const urlFor = (key: string): string => {
      const e = pick(key);
      if (e?.url && onHost(e.url)) return e.url;
      if (!e && resolved.mode === 'assets' && onHost(assetFor(key))) return assetFor(key);
      return block;
    };
    // An image's description follows the picture: the company's or the
    // library's alt text, none for the neutral block (it is decoration).
    h = h.replace(/<img\b[^>]*>/gi, (tag) => {
      const key = /\{\{ASSET:([^}]{1,60})\}\}/.exec(tag)?.[1];
      if (!key) return tag;
      const e = pick(key);
      const url = urlFor(key);
      const alt = url === block ? '' : e && (e.source === 'company' || e.source === 'library') && e.alt ? e.alt : null;
      let out = tag;
      if (alt !== null) {
        out = /\salt\s*=\s*("[^"]*"|'[^']*')/i.test(out) ? out.replace(/\salt\s*=\s*("[^"]*"|'[^']*')/i, ` alt="${escapeHtml(alt)}"`)
          : out.replace(/^<img\b/i, `<img alt="${escapeHtml(alt)}"`);
      }
      if (url !== block && e?.focal && !/\sstyle\s*=/i.test(out)) {
        const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
        out = out.replace(/^<img\b/i, `<img style="object-position:${pct(e.focal.x)} ${pct(e.focal.y)}"`);
      }
      return out;
    });
    h = h.replace(/\{\{ASSET:([^}]{1,60})\}\}/g, (_m, key: string) => escapeHtml(urlFor(key)));
  } else {
    h = h.replace(/\{\{ASSET:([^}]{1,60})\}\}/g, (_m, key: string) => onHost(assetFor(key)) ? escapeHtml(assetFor(key)) : '');
  }
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
  const logo = safeAssetUrl(b.logoUrl, hosts);
  // One pass: the company's values (escaped) go in, any other placeholder is
  // left out rather than shown, and nothing the company wrote is read again.
  h = h.replace(/\{\{([A-Za-z_.:-]{1,60})\}\}/g, (_m, k: string) => {
    if (k === 'brand.logo') return logo ? `<img class="fg-logo" src="${escapeHtml(logo)}" alt="">` : '';
    return k in values ? escapeHtml(values[k]) : '';
  });

  // The company's colours, as the template's own variables and as FlyttGo's.
  const primary = b.primaryColor && /^#[0-9a-f]{6}$/i.test(b.primaryColor) ? b.primaryColor : null;
  const accent = b.accentColor && /^#[0-9a-f]{6}$/i.test(b.accentColor) ? b.accentColor : null;
  const vars = [
    ...(primary ? [`--c-primary:${primary}`] : []), ...(accent ? [`--c-accent:${accent}`] : []),
    `--fg-primary:var(--c-primary,#0b2e59)`, `--fg-accent:var(--c-accent,var(--fg-primary))`,
    `--fg-on-primary:${primary ? readableOn(primary) : '#ffffff'}`, `--fg-on-accent:${(accent ?? primary) ? readableOn((accent ?? primary)!) : '#ffffff'}`,
  ];
  const style = `<style>:root{${vars.join(';')}}`
    + '.fg-book{margin:1.5rem 0}.fg-book a{display:inline-block;padding:.8rem 1.4rem;border-radius:.5rem;'
    + 'background:var(--fg-primary);color:var(--fg-on-primary);font-weight:700;text-decoration:none}'
    + '.fg-book-card{display:flex;align-items:center;justify-content:center;min-height:8rem}.fg-book-card .fg-book{margin:0}'
    + '.fg-book-card .fg-book a{background:var(--fg-accent);color:var(--fg-on-accent);padding:1rem 1.8rem;font-size:1rem}'
    // Pages are shown without scripts: content a script would have faded in
    // is shown as it ends up (the importer's snapshot already does this).
    + '.reveal{opacity:1!important;transform:none!important}'
    + brandCss(b.name, !!logo)
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
