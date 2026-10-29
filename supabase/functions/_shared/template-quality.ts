// ============================================================================
// FlyttGo — automated quality checks of a website template
// ============================================================================
//
// Before a FlyttGo administrator approves a template (docs/WHITE_LABEL.md →
// Website templates, "Quality gate"), the importer checks every page:
//
//   unsafe_html     no script, event handler, javascript: link, frame, form,
//                   outside stylesheet or refresh (the sanitiser's rules;
//                   the database refuses such a page in any case)
//   renders         the page draws, with text, in a browser
//   overflow        nothing is wider than the screen at 320, 375 and 390 px
//                   (drawn with a long company name)
//   broken_images   every {{ASSET:key}} has an image, and it loads
//   image_alt       every image has an alt text (alt="" for decoration)
//   booking_links   every link that reads as booking leads to the booking page
//   sample_content  nothing left of the sample company: its name, address,
//                   phone, email, prices or figures (the content flags)
//
// staticChecks() runs without a browser (here, in the admin panel on a
// draft, and in the importer); the importer adds the browser's results
// (renders, overflow, images that fail to load). The results are stored
// with the template (site_templates.checks, migration 00021); approval is
// refused while one fails unless the administrator gives a reason, which is
// recorded (admin_review_site_template).
//
// No Deno or network imports: used by the importer, the admin panel and the
// Vitest suite.
// ============================================================================

import { htmlProblems, pageLinks, strayBookingLink, type ContentFlag, type TemplateAsset, type TemplatePage } from './site-template.ts';

export type CheckId = 'unsafe_html' | 'renders' | 'overflow' | 'broken_images' | 'image_alt' | 'booking_links' | 'sample_content';
/** pass; fail; not_run (could not be checked here, e.g. without a browser); stale (the page changed since). */
export type CheckStatus = 'pass' | 'fail' | 'not_run' | 'stale';

export interface CheckResult { id: CheckId; page: string; status: CheckStatus; detail: string; items?: string[] }
export interface TemplateChecks {
  version: 1;
  ran_at: string;
  /** The sample company's name and short forms (for a later re-check of the sample content). */
  sample_names?: string[];
  results: CheckResult[];
}

export const CHECKS: { id: CheckId; label: string; browser: boolean; overridable: boolean }[] = [
  { id: 'unsafe_html', label: 'No scripts, handlers or unsafe HTML', browser: false, overridable: false },
  { id: 'renders', label: 'The page renders', browser: true, overridable: true },
  { id: 'overflow', label: 'Fits a phone (320, 375, 390 px)', browser: true, overridable: true },
  { id: 'broken_images', label: 'No broken images', browser: false, overridable: true },
  { id: 'image_alt', label: 'Every image has an alt text', browser: false, overridable: true },
  { id: 'booking_links', label: 'Booking links lead to the booking page', browser: false, overridable: true },
  { id: 'sample_content', label: 'Nothing left of the sample company', browser: false, overridable: true },
];

/** The phone widths the overflow check draws each page at. */
export const OVERFLOW_WIDTHS = [320, 375, 390] as const;

/** The flag kinds that fail sample_content (reviews and claims are for the reviewer to judge). */
export const SAMPLE_FLAG_KINDS: ContentFlag['kind'][] = ['sample_name', 'address', 'phone', 'email', 'price', 'statistic'];

export const checkLabel = (id: string) => CHECKS.find(c => c.id === id)?.label ?? id;

const ASSET_RE = /\{\{ASSET:([^}]{1,60})\}\}/g;

/** The image an {{ASSET:key}} stands for, as the renderer finds it (also key.1, or key without .n). */
export function assetFor(assets: readonly TemplateAsset[], key: string): TemplateAsset | undefined {
  const m = new Map(assets.map(a => [a.key, a]));
  return m.get(key) ?? m.get(key.replace(/\.\d+$/, '')) ?? m.get(`${key}.1`);
}

/** The checks of one page that need no browser. */
export function pageStaticChecks(page: TemplatePage, assets: readonly TemplateAsset[], flags: readonly ContentFlag[] = []): CheckResult[] {
  const html = String(page.html ?? '');
  const path = page.path;
  const out: CheckResult[] = [];
  const res = (id: CheckId, items: string[], ok: string, bad: string) =>
    out.push({ id, page: path, status: items.length ? 'fail' : 'pass', detail: items.length ? bad.replace('{n}', String(items.length)) : ok,
               ...(items.length ? { items: items.slice(0, 20) } : {}) });

  res('unsafe_html', htmlProblems(html), 'Clean.', '{n} kind(s) of unsafe HTML.');

  const missing = [...new Set([...html.matchAll(ASSET_RE)].map(m => m[1]).filter(k => !assetFor(assets, k)))];
  res('broken_images', missing.map(k => `{{ASSET:${k}}} has no image`), 'Every image placeholder has an image.', '{n} image(s) without a picture.');

  const noAlt = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]).filter(tag => !/\salt\s*=/i.test(tag))
    .map(tag => /\ssrc\s*=\s*("|')([^"']*)\1/i.exec(tag)?.[2] || tag.slice(0, 80));
  res('image_alt', noAlt, 'Every image has an alt text.', '{n} image(s) without an alt text.');

  const stray = pageLinks(html).filter(strayBookingLink).map(l => `"${l.text.slice(0, 40)}" → ${l.href || '(no link)'}`);
  res('booking_links', stray, 'Every booking link leads to the booking page.', '{n} booking link(s) lead elsewhere.');

  const left = flags.filter(f => f.page === path && SAMPLE_FLAG_KINDS.includes(f.kind)).map(f => `${f.kind}: …${f.sample}…`);
  res('sample_content', left, 'Nothing left of the sample company.', '{n} thing(s) left of the sample company.');
  return out;
}

/** The checks of every page that need no browser; the browser's are not_run until the importer adds them. */
export function staticChecks(pages: readonly TemplatePage[], assets: readonly TemplateAsset[], flags: readonly ContentFlag[] = []): CheckResult[] {
  return pages.flatMap(p => [
    ...pageStaticChecks(p, assets, flags),
    ...CHECKS.filter(c => c.browser).map(c => ({ id: c.id, page: p.path, status: 'not_run' as const, detail: 'Needs a browser (the importer with Playwright).' })),
  ]);
}

/** Merge results: a later result for the same check and page replaces the earlier one. */
export function mergeResults(base: readonly CheckResult[], more: readonly CheckResult[]): CheckResult[] {
  const key = (r: CheckResult) => `${r.id}\u0000${r.page}`;
  const m = new Map(base.map(r => [key(r), r]));
  for (const r of more) m.set(key(r), r);
  const order = (id: string) => CHECKS.findIndex(c => c.id === id);
  return [...m.values()].sort((a, b) => a.page.localeCompare(b.page) || order(a.id) - order(b.id));
}

/** Checks that stop approval: failed, or stale since the page changed. The database decides the same way. */
export function failingChecks(checks: Pick<TemplateChecks, 'results'> | null | undefined): CheckResult[] {
  return (checks?.results ?? []).filter(r => r.status === 'fail' || r.status === 'stale');
}

/** What the browser found on one page, as the importer measures it (scripts/template-snapshot.ts). */
export interface PageInspection {
  rendered: boolean;
  textChars: number;
  /** Per width: how wide the page is, and what sticks out. */
  overflow: { width: number; scrollWidth: number; culprits: string[] }[];
  images: { src: string; loaded: boolean; width: number; height: number }[];
}

/** The browser's checks of one page from its inspection. */
export function browserChecks(path: string, i: PageInspection): CheckResult[] {
  const out: CheckResult[] = [];
  out.push(i.rendered && i.textChars > 0
    ? { id: 'renders', page: path, status: 'pass', detail: `Renders (${i.textChars} characters of text).` }
    : { id: 'renders', page: path, status: 'fail', detail: i.rendered ? 'Renders without any text.' : 'Does not render.' });
  const wide = i.overflow.filter(o => o.scrollWidth > o.width + 1);
  out.push(wide.length
    ? { id: 'overflow', page: path, status: 'fail', detail: `Wider than the screen at ${wide.map(o => `${o.width} px (${o.scrollWidth} px)`).join(', ')}.`,
        items: [...new Set(wide.flatMap(o => o.culprits))].slice(0, 10) }
    : { id: 'overflow', page: path, status: 'pass', detail: `Fits at ${i.overflow.map(o => o.width).join(', ')} px.` });
  const broken = i.images.filter(m => !m.loaded);
  if (i.images.length && broken.length === i.images.length) {
    out.push({ id: 'broken_images', page: path, status: 'not_run', detail: 'No image loaded at all: the asset store could not be reached from the importer.' });
  } else if (broken.length) {
    out.push({ id: 'broken_images', page: path, status: 'fail', detail: `${broken.length} image(s) do not load.`, items: broken.map(b => b.src).slice(0, 20) });
  }
  return out;
}

/** Combine static and browser results: a browser failure of broken_images joins the static one. */
export function combine(staticResults: readonly CheckResult[], browser: readonly CheckResult[]): CheckResult[] {
  const extra = browser.map(b => {
    if (b.id !== 'broken_images') return b;
    const s = staticResults.find(r => r.id === 'broken_images' && r.page === b.page);
    if (!s) return b;
    if (s.status === 'fail') {
      return { ...s, items: [...(s.items ?? []), ...(b.status === 'fail' ? b.items ?? [] : [])], detail: `${s.detail}${b.status === 'fail' ? ` ${b.detail}` : ''}` };
    }
    return b.status === 'not_run' ? { ...b, detail: `${s.detail} ${b.detail}` } : b;
  });
  return mergeResults(staticResults, extra);
}
