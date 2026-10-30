/**
 * The website gallery's choices (docs/WHITE_LABEL.md → Website templates):
 * which templates a company sees for a category, a search, the features it
 * ticks and a style, and in which order. Pure functions over the catalogue's
 * summaries, so the gallery and its tests read the same rules.
 */
import {
  OTHER_CATEGORY, TEMPLATE_CATEGORIES, TEMPLATE_FEATURES, categoryLabel, featureLabel, templateCategory,
} from '../../../supabase/functions/_shared/site-template';
import type { SiteTemplateSummary } from '../../lib/whiteLabel';

type Summary = Pick<SiteTemplateSummary, 'id' | 'name' | 'industry' | 'style' | 'features'>;

/** How many cards the gallery shows at first and adds each time ("Show more"). */
export const BATCH = 24;

/**
 * The features a company can filter by. "Services" is left out: nearly
 * every template has a services section, so it would not narrow anything.
 */
export const GALLERY_FEATURES = TEMPLATE_FEATURES.filter(f => f.id !== 'services').map(f => ({ id: f.id, label: f.label }));

export type GallerySort = 'recommended' | 'name';
/** Recommended is the catalogue's own order (no popularity is recorded, so none is invented). */
export const SORTS: { id: GallerySort; label: string }[] = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'name', label: 'Name A–Z' },
];

export interface GalleryFilter {
  category: string;          // 'all' or a category id
  query: string;
  features: string[];        // every one ticked must be there
  style: string;             // '' for any
  sort: GallerySort;
}
export const NO_FILTER: GalleryFilter = { category: 'all', query: '', features: [], style: '', sort: 'recommended' };

/** The catalogue category a template is shown in. */
export const categoryOf = (t: Pick<Summary, 'industry'>) => templateCategory(t.industry) ?? OTHER_CATEGORY.id;

/** A style id in words ("bold-portfolio" → "bold portfolio"). */
export const styleLabel = (style: string) => style.replace(/[-_]+/g, ' ');

/** What a search looks through: name, style, industries, features and category. */
const searchText = (t: Summary) => [
  t.name, t.style ? `${t.style} ${styleLabel(t.style)}` : '', t.industry.join(' '), t.industry.join(' ').replace(/-/g, ' '),
  (t.features ?? []).map(featureLabel).join(' '), categoryLabel(categoryOf(t)),
].join(' ').toLowerCase();

/** Whether a template passes the filter; `skip` leaves one part out (for that part's counts). */
function passes(t: Summary, f: GalleryFilter, skip?: 'category' | 'features' | 'style'): boolean {
  if (skip !== 'category' && f.category !== 'all' && categoryOf(t) !== f.category) return false;
  if (skip !== 'style' && f.style && t.style !== f.style) return false;
  if (skip !== 'features' && f.features.some(x => !(t.features ?? []).includes(x))) return false;
  const words = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) { const text = searchText(t); if (!words.every(w => text.includes(w))) return false; }
  return true;
}

/** The templates shown for a filter, in its order (Recommended keeps the catalogue's order). */
export function filterTemplates<T extends Summary>(templates: readonly T[], f: GalleryFilter): T[] {
  const shown = templates.filter(t => passes(t, f));
  return f.sort === 'name' ? [...shown].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id)) : shown;
}

/**
 * The counts the gallery's filters show: each category, feature and style
 * counted with the other choices applied (so a count says what choosing it
 * would show), the categories in the catalogue's order and only those with
 * templates, the styles most common first.
 */
export function facets(templates: readonly Summary[], f: GalleryFilter) {
  const count = (skip: 'category' | 'features' | 'style', key: (t: Summary) => string[]) => {
    const m = new Map<string, number>();
    for (const t of templates) if (passes(t, f, skip)) for (const k of key(t)) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  const byCategory = count('category', t => [categoryOf(t)]);
  const present = new Set(templates.map(categoryOf));
  const categories = [...TEMPLATE_CATEGORIES, OTHER_CATEGORY].filter(c => present.has(c.id))
    .map(c => ({ id: c.id, label: c.label, count: byCategory.get(c.id) ?? 0 }));
  const all = templates.filter(t => passes(t, f, 'category')).length;
  const byFeature = count('features', t => t.features ?? []);
  /* A feature every template has narrows nothing (every master has a pricing and a contact page): left out unless chosen. */
  const everywhere = (id: string) => templates.length > 0 && templates.every(t => (t.features ?? []).includes(id));
  const features = GALLERY_FEATURES.filter(x => !everywhere(x.id) || f.features.includes(x.id))
    .map(x => ({ ...x, count: byFeature.get(x.id) ?? 0 }));
  const byStyle = count('style', t => t.style ? [t.style] : []);
  const styles = [...new Set(templates.map(t => t.style).filter((s): s is string => !!s))]
    .map(id => ({ id, label: styleLabel(id), count: byStyle.get(id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'en'));
  return { all, categories, features, styles };
}

/** Whether anything beyond the category narrows the gallery. */
export const narrowed = (f: GalleryFilter) => !!f.query.trim() || f.features.length > 0 || !!f.style;

/** "chic · 5 pages · Prices, Team, FAQ" */
export const cardFacts = (t: Pick<SiteTemplateSummary, 'style' | 'page_count' | 'features'>) => [
  t.style ? styleLabel(t.style) : '',
  t.page_count ? `${t.page_count} ${t.page_count === 1 ? 'page' : 'pages'}` : '',
  (t.features ?? []).map(featureLabel).join(', '),
].filter(Boolean).join(' · ');

/**
 * What a gallery card shows (docs/WHITE_LABEL.md → Image library,
 * "Thumbnails"): the template's thumbnail while it is up to date; a live
 * miniature of its home page with the library's photos while the thumbnail
 * is stale (drawn with other photos than the template shows now, 00024),
 * until it is drawn again; a plain card when it has no thumbnail. `stale`:
 * the templates whose thumbnail the database finds stale; when it cannot say
 * (00024 not applied, or not loaded yet), a thumbnail in a category with
 * library photos counts as stale (it was drawn with the imported photos).
 */
export type CardPictureKind = 'thumbnail' | 'live' | 'plain';
export function cardPicture(t: Pick<SiteTemplateSummary, 'id' | 'industry' | 'assets'>,
                            stale: readonly string[] | null | undefined, libraryCategories: readonly string[] = []): CardPictureKind {
  if (!t.assets.some(a => a.key === 'thumbnail')) return 'plain';
  const out = stale ? stale.includes(t.id) : libraryCategories.includes(templateCategory(t.industry) ?? '');
  return out ? 'live' : 'thumbnail';
}
