/**
 * The full website gallery (docs/WHITE_LABEL.md → Website templates), opened
 * from the Website card's "Browse all": every offered template in a dense
 * grid, with categories, search, what the pages have, style and order
 * (gallery.ts), shown in batches. Each card is the template's thumbnail
 * (its home page as its own demo) or, without one, a plain card with its
 * name and style: no live page is drawn in the grid. Preview and Choose sit
 * over the picture on hover and keyboard focus, and always on touch screens.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { bestFor, featureLabel, templateCategory } from '../../../supabase/functions/_shared/site-template';
import { thumbnailOf, type SiteTemplateSummary } from '../../lib/whiteLabel';
import { BATCH, NO_FILTER, SORTS, cardFacts, facets, filterTemplates, narrowed, styleLabel, type GalleryFilter, type GallerySort } from './gallery';
import { useDialog } from './useDialog';

const btn = 'px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B2E59] focus-visible:ring-offset-2';
const field = 'border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white';
const chip = (on: boolean) => `shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${on ? 'bg-[#0B2E59] text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`;

/** A template without a thumbnail: its name and style on a plain card (never a photo, never a live page). */
export function Placeholder({ name, style }: { name: string; style: string | null }) {
  return (
    <div className="absolute inset-0 flex flex-col bg-gradient-to-b from-slate-50 to-slate-200" data-placeholder>
      <div className="flex items-center gap-1 px-2 h-4 border-b border-slate-200 bg-white/70 shrink-0" aria-hidden="true">
        {[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-slate-300" />)}
      </div>
      <div className="flex-1 min-h-0 flex flex-col justify-center px-[8%]">
        {style && <div className="text-[10px] uppercase tracking-[0.16em] text-slate-600 truncate">{styleLabel(style)}</div>}
        <div className="mt-1 font-bold text-slate-800 leading-tight text-lg line-clamp-2 break-words">{name}</div>
        <div className="mt-3 h-1.5 w-2/5 rounded bg-slate-300" aria-hidden="true" />
        <div className="mt-1.5 h-1.5 w-1/4 rounded bg-slate-300/70" aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * The picture of a template: its thumbnail, lazily, or the plain card. In a
 * category with library photos (00023) the importer's thumbnail still shows
 * the imported photos, so the plain card is shown instead until it is drawn
 * again (`stale`).
 */
export function CardPicture({ t, stale = false }: { t: SiteTemplateSummary; stale?: boolean }) {
  const thumb = stale ? null : thumbnailOf(t);
  return thumb ? (
    <img src={thumb} alt="" loading="lazy" decoding="async" width={720} height={450}
      className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-[1.04] group-focus-within:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100 motion-reduce:group-focus-within:scale-100" />
  ) : <Placeholder name={t.name} style={t.style} />;
}

function Card({ t, chosen, canEdit, opening, onPreview, onChoose, stale }: {
  t: SiteTemplateSummary; chosen: boolean; canEdit: boolean; opening: boolean; onPreview: () => void; onChoose: () => void; stale: boolean;
}) {
  const id = `tpl-${t.id}`;
  return (
    <article aria-labelledby={id} className={`group relative flex flex-col rounded-xl border bg-white overflow-hidden ${chosen ? 'border-[#0B2E59] ring-2 ring-[#0B2E59]' : 'border-gray-200 hover:shadow-lg focus-within:shadow-lg'} transition-shadow motion-reduce:transition-none`}>
      <div className="relative aspect-[16/10] bg-gray-100 overflow-hidden border-b border-gray-100">
        <CardPicture t={t} stale={stale} />
        {chosen && <span className="absolute top-2 left-2 z-10 rounded-full bg-[#0B2E59] text-white text-[11px] font-semibold px-2.5 py-0.5 shadow">✓ Chosen</span>}
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-[#0B2E59]/60 opacity-0 transition-opacity duration-200 motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 [@media(hover:none)]:bg-transparent [@media(hover:none)]:items-end [@media(hover:none)]:justify-end [@media(hover:none)]:p-2">
          <button onClick={onPreview} aria-label={`Preview ${t.name}`} className={`${btn} bg-white text-gray-900 shadow`}>{opening ? 'Opening…' : 'Preview'}</button>
          {!chosen && <button onClick={onChoose} disabled={!canEdit} aria-label={`Choose ${t.name}`} className={`${btn} bg-[#0B2E59] text-white shadow ring-1 ring-white/40`}>Choose</button>}
        </div>
      </div>
      <div className="p-3 min-w-0">
        <h3 id={id} className="font-semibold text-sm text-gray-900 truncate">{t.name}</h3>
        <p className="text-xs text-gray-600 truncate">Best for {bestFor(t.industry)}</p>
        <p className="text-[11px] text-gray-600 truncate mt-1 first-letter:uppercase">{cardFacts(t)}</p>
      </div>
    </article>
  );
}

function Filters({ id, filter, set, f }: { id: string; filter: GalleryFilter; set: (p: Partial<GalleryFilter>) => void; f: ReturnType<typeof facets> }) {
  const styles = f.styles.filter(s => s.count > 0 || s.id === filter.style);
  return (
    <div className="space-y-6">
      <section aria-labelledby={`${id}-what`}>
        <h3 id={`${id}-what`} className="text-xs font-bold uppercase tracking-wide text-gray-700 mb-2">What it has</h3>
        <ul className="space-y-1">
          {f.features.map(x => (
            <li key={x.id}>
              <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-[#0B2E59]" checked={filter.features.includes(x.id)}
                  onChange={e => set({ features: e.target.checked ? [...filter.features, x.id] : filter.features.filter(y => y !== x.id) })} />
                <span className="flex-1">{x.label}</span><span className="text-xs text-gray-600 tabular-nums">{x.count}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wide text-gray-700 mb-2">Style</span>
          <select className={`${field} w-full capitalize`} value={filter.style} onChange={e => set({ style: e.target.value })}>
            <option value="">Any style</option>
            {styles.map(s => <option key={s.id} value={s.id}>{s.label} ({s.count})</option>)}
          </select>
        </label>
      </section>
    </div>
  );
}

export default function TemplateGallery({ templates, selected, canEdit, filter, onFilter, opening, onPreview, onChoose, onClose, libraryCategories = [] }: {
  /** The offered templates, in the catalogue's order. */
  templates: SiteTemplateSummary[];
  selected: string;
  canEdit: boolean;
  filter: GalleryFilter;
  onFilter: (f: GalleryFilter) => void;
  /** The template whose preview is being opened. */
  opening: string | null;
  /** Opens a template's preview, with the gallery's results in their order (for previous and next). */
  onPreview: (id: string, results: string[]) => void;
  onChoose: (id: string) => void;
  onClose: () => void;
  /** Categories with approved library photos: their cards leave out the importer's thumbnail (CardPicture). */
  libraryCategories?: string[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  useDialog(box, onClose);
  const set = (p: Partial<GalleryFilter>) => onFilter({ ...filter, ...p });
  const results = useMemo(() => filterTemplates(templates, filter), [templates, filter]);
  const f = useMemo(() => facets(templates, filter), [templates, filter]);
  const [limit, setLimit] = useState(BATCH);
  const [filtersOpen, setFiltersOpen] = useState(false);
  /* A new choice of filters starts again from the first batch, at the top. */
  useEffect(() => { setLimit(BATCH); scroller.current?.scrollTo?.({ top: 0 }); }, [filter]);
  const shown = results.slice(0, limit);
  const left = results.length - shown.length;
  /* The next batch loads as "Show more" comes near; the button stays for keyboards and old browsers. */
  useEffect(() => {
    const el = more.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setLimit(l => l + BATCH); }, { root: scroller.current, rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [left > 0, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  const ids = results.map(t => t.id);
  const category = f.categories.find(c => c.id === filter.category);
  const active = [
    ...(filter.query.trim() ? [{ key: 'q', label: `“${filter.query.trim()}”`, clear: () => set({ query: '' }) }] : []),
    ...filter.features.map(x => ({ key: x, label: featureLabel(x), clear: () => set({ features: filter.features.filter(y => y !== x) }) })),
    ...(filter.style ? [{ key: 's', label: `Style: ${styleLabel(filter.style)}`, clear: () => set({ style: '' }) }] : []),
  ];
  const clearAll = () => onFilter({ ...NO_FILTER, sort: filter.sort });
  const noTemplateCard = filter.category === 'all' && !narrowed(filter);
  const extra = filter.features.length + (filter.style ? 1 : 0);

  return (
    <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="gallery-title"
      className="fixed inset-0 z-50 bg-gray-50 flex flex-col outline-none">
      <header className="bg-white border-b border-gray-200 shrink-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 lg:px-6 py-3">
          <div className="order-1 min-w-0 flex-1">
            <h2 id="gallery-title" className="text-lg font-bold text-gray-900 leading-tight">{canEdit ? 'Choose your website' : 'Websites'}</h2>
            <p className="text-xs text-gray-600">{templates.length} websites<span className="hidden sm:inline"> · each previewed in your name and colours</span></p>
          </div>
          <div className="order-3 w-full sm:order-2 sm:w-auto flex gap-2">
            <label className="relative flex-1 min-w-0 sm:w-72 lg:w-96">
              <span className="sr-only">Search websites by name, style or what they have</span>
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4 4" strokeLinecap="round" />
              </svg>
              <input data-autofocus type="search" value={filter.query} onChange={e => set({ query: e.target.value })}
                placeholder="Name, style or feature" className={`${field} w-full pl-8`} />
            </label>
            <label className="shrink-0">
              <span className="sr-only">Sort</span>
              <select value={filter.sort} onChange={e => set({ sort: e.target.value as GallerySort })} className={`${field} px-2 sm:px-3`}>
                {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <button onClick={onClose} className={`order-2 sm:order-3 ${btn} bg-gray-100 hover:bg-gray-200`} aria-label="Close the gallery">✕ <span className="hidden sm:inline">Close</span></button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <aside className="hidden lg:block w-64 shrink-0 overflow-y-auto border-r border-gray-200 bg-white px-5 py-5" aria-label="Filters">
          <section aria-labelledby="g-cat" className="mb-6">
            <h3 id="g-cat" className="text-xs font-bold uppercase tracking-wide text-gray-700 mb-2">Categories</h3>
            <ul className="space-y-0.5">
              {[{ id: 'all', label: 'All websites', count: f.all }, ...f.categories].map(c => (
                <li key={c.id}>
                  <button onClick={() => set({ category: c.id })} aria-pressed={filter.category === c.id}
                    className={`w-full flex items-center gap-2 text-left rounded-lg px-2.5 py-1.5 text-sm ${filter.category === c.id ? 'bg-[#0B2E59] text-white font-semibold' : 'text-gray-800 hover:bg-gray-100'}`}>
                    <span className="flex-1">{c.label}</span>
                    <span className={`text-xs tabular-nums ${filter.category === c.id ? 'text-white' : 'text-gray-600'}`}>{c.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <Filters id="side" filter={filter} set={set} f={f} />
          {narrowed(filter) && <button onClick={clearAll} className="mt-6 text-sm font-semibold text-[#0B2E59] hover:underline">Clear filters</button>}
        </aside>

        <main ref={scroller} className="flex-1 min-w-0 overflow-y-auto px-4 lg:px-6 py-4" aria-labelledby="gallery-results">
          {/* Phones and tablets: categories as a row of chips, the other filters behind a button. */}
          <div className="lg:hidden -mx-4 mb-3 border-b border-gray-200">
            <div className="flex gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:thin]" role="group" aria-label="Categories">
              <button onClick={() => set({ category: 'all' })} aria-pressed={filter.category === 'all'} className={chip(filter.category === 'all')}>All ({f.all})</button>
              {f.categories.map(c => (
                <button key={c.id} onClick={() => set({ category: c.id })} aria-pressed={filter.category === c.id} className={chip(filter.category === c.id)}>{c.label} ({c.count})</button>
              ))}
            </div>
            <div className="px-4 pb-3">
              <button onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen} aria-controls="gallery-filters-small"
                className="text-sm font-semibold text-[#0B2E59] underline-offset-2 hover:underline">
                {filtersOpen ? 'Hide filters' : 'Filters'}{extra ? ` (${extra})` : ''}
              </button>
              {filtersOpen && <div id="gallery-filters-small" className="pt-3 pb-2"><Filters id="small" filter={filter} set={set} f={f} /></div>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <p id="gallery-results" className="text-sm text-gray-700 mr-1" aria-live="polite">
              Showing <strong>{shown.length}</strong> of <strong>{results.length}</strong>
              {category ? <> in {category.label}</> : results.length === templates.length ? ' websites' : ' matching websites'}
            </p>
            {active.map(a => (
              <button key={a.key} onClick={a.clear} aria-label={`Remove filter ${a.label}`}
                className="inline-flex items-center gap-1 rounded-full bg-white border border-gray-300 px-2.5 py-0.5 text-xs text-gray-800 hover:bg-gray-100">
                {a.label}<span aria-hidden="true">✕</span>
              </button>
            ))}
            {active.length > 0 && <button onClick={clearAll} className="text-xs font-semibold text-[#0B2E59] hover:underline">Clear all</button>}
          </div>

          {results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
              <h3 className="font-semibold text-gray-900">No website matches</h3>
              <p className="text-sm text-gray-600 mt-1">Try fewer filters, another word or all categories.</p>
              <button onClick={() => onFilter({ ...NO_FILTER, sort: filter.sort })} className={`${btn} bg-[#0B2E59] text-white mt-4`}>Show all websites</button>
            </div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1600px]:grid-cols-5 gap-4 lg:gap-5" aria-label="Websites">
              {noTemplateCard && (
                <li>
                  <article aria-labelledby="tpl-none" className={`relative flex flex-col h-full rounded-xl border bg-white overflow-hidden ${selected === '' ? 'border-[#0B2E59] ring-2 ring-[#0B2E59]' : 'border-gray-200'}`}>
                    <div className="relative aspect-[16/10] bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-sm text-gray-600 border-b border-gray-100">
                      Simple branded front page
                      {selected === '' && <span className="absolute top-2 left-2 rounded-full bg-[#0B2E59] text-white text-[11px] font-semibold px-2.5 py-0.5 shadow">✓ Chosen</span>}
                    </div>
                    <div className="p-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 id="tpl-none" className="font-semibold text-sm text-gray-900">No template</h3>
                        <p className="text-xs text-gray-600">Your name, colours and a booking button</p>
                      </div>
                      {selected !== '' && <button disabled={!canEdit} onClick={() => onChoose('')} className={`${btn} bg-gray-100 shrink-0`}>Choose</button>}
                    </div>
                  </article>
                </li>
              )}
              {shown.map(t => (
                <li key={t.id}>
                  <Card t={t} chosen={selected === t.id} canEdit={canEdit} opening={opening === t.id}
                    stale={libraryCategories.includes(templateCategory(t.industry) ?? '')}
                    onPreview={() => onPreview(t.id, ids)} onChoose={() => onChoose(t.id)} />
                </li>
              ))}
            </ul>
          )}

          {left > 0 && (
            <div className="flex justify-center py-6">
              <button ref={more} onClick={() => setLimit(l => l + BATCH)} className={`${btn} bg-white border border-gray-300 hover:bg-gray-100 px-5 py-2`}>
                Show more ({Math.min(BATCH, left)} of {left} left)
              </button>
            </div>
          )}
          {!canEdit && <p className="text-xs text-gray-600 text-center pb-4">Only the company's owners and admins can choose its website; you can look at every one.</p>}
        </main>
      </div>
    </div>
  );
}
