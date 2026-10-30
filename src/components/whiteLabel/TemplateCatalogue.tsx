/**
 * The website catalogue (docs/WHITE_LABEL.md → Website templates). In the
 * Website card: the company's current choice (its picture, name, what it
 * suits, Preview and Change) and "Browse all N websites", which opens the
 * full gallery (TemplateGallery: every approved template by category, with
 * search, filters for what the pages have and style, and an order). Any
 * template opens in a full preview of each page in the company's own name
 * and colours before it is chosen (TemplatePreview: desktop, tablet or
 * phone, page by page); opened from the gallery, the preview steps through
 * the gallery's results and the gallery keeps its filters. Previews are
 * sandboxed without scripts, as the published site is.
 *
 * Images (docs/WHITE_LABEL.md → Image library): previews show what the site
 * would show, resolved by the database for the company (its own images, the
 * template's approved ones, the library of the template's category, else a
 * plain colour block). In a category that has library photos the importer's
 * thumbnail (drawn with the imported photos) is not shown: the current choice
 * is drawn live, and gallery cards show the plain card.
 */
import { useEffect, useMemo, useState } from 'react';
import { bestFor, templateCategory, type Brand, type RenderImages } from '../../../supabase/functions/_shared/site-template';
import {
  loadLibraryCategories, loadRenderImages, loadTemplate, thumbnailOf, type SiteTemplate, type SiteTemplateSummary,
} from '../../lib/whiteLabel';
import TemplateGallery from './TemplateGallery';
import TemplatePreview from './TemplatePreview';
import TemplateThumb from './TemplateThumb';
import { NO_FILTER, cardFacts, type GalleryFilter } from './gallery';

const btn = 'px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50';

export default function TemplateCatalogue({ templates, selected, onSelect, canEdit, brand, sellerNotice, orgId }: {
  templates: SiteTemplateSummary[];
  selected: string;
  onSelect: (id: string) => void;
  canEdit: boolean;
  /** The company's name, colours and contact details, as the preview shows them. */
  brand: Brand;
  sellerNotice: string;
  /** The company, for its own images in previews. */
  orgId?: string | null;
}) {
  const offered = useMemo(() => templates.filter(t => t.status === 'approved'), [templates]);
  const [browsing, setBrowsing] = useState(false);
  const [filter, setFilter] = useState<GalleryFilter>(NO_FILTER);
  const [preview, setPreview] = useState<{ t: SiteTemplate; path: string; results?: string[]; images: RenderImages | null } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  /* Categories with approved library photos, and the current choice's images. */
  const [libraryCats, setLibraryCats] = useState<string[]>([]);
  const [currentImages, setCurrentImages] = useState<RenderImages | null>(null);
  useEffect(() => { loadLibraryCategories().then(setLibraryCats).catch(() => setLibraryCats([])); }, []);
  useEffect(() => {
    setCurrentImages(null);
    if (!selected) return;
    let live = true;
    loadRenderImages(selected, orgId).then(i => { if (live) setCurrentImages(i); }).catch(() => {});
    return () => { live = false; };
  }, [selected, orgId]);

  const open = async (id: string, results?: string[]) => {
    setLoading(id);
    const [t, images] = await Promise.all([loadTemplate(id), loadRenderImages(id, orgId).catch(() => null)]);
    setLoading(null);
    if (t) setPreview({ t, path: t.pages[0]?.path ?? '/', results, images });
  };
  const choose = (id: string) => { onSelect(id); setPreview(null); setBrowsing(false); };

  if (offered.length === 0) {
    return <p className="text-sm text-gray-500">No templates are offered yet: FlyttGo checks each one before it's offered. Until then your page is a simple branded front page.</p>;
  }

  /* The company's current choice; a template no longer offered still shows, marked. */
  const current = selected ? templates.find(t => t.id === selected) ?? null : null;
  const inLibrary = (t: { industry: string[] }) => libraryCats.includes(templateCategory(t.industry) ?? '');
  const at = preview?.results ? preview.results.indexOf(preview.t.id) : -1;
  const step = preview?.results && at >= 0 ? {
    at, of: preview.results.length, loading: loading !== null,
    go: (by: -1 | 1) => { const r = preview.results!; open(r[(at + by + r.length) % r.length], r); },
  } : undefined;

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-4 rounded-xl border border-gray-200 p-3">
        <div className="relative sm:w-64 shrink-0 aspect-[16/10] rounded-lg overflow-hidden border border-gray-100 bg-gray-100">
          {!current ? (
            <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-sm text-gray-600">Simple branded front page</div>
          ) : thumbnailOf(current) && !inLibrary(current) ? (
            <img src={thumbnailOf(current)!} alt="" loading="lazy" decoding="async" width={720} height={450} className="absolute inset-0 w-full h-full object-cover object-top" />
          ) : (
            <TemplateThumb template={current} brand={brand} sellerNotice={sellerNotice} images={currentImages} />
          )}
        </div>
        <div className="min-w-0 flex-1 flex flex-col">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">Your website</div>
          <div className="font-semibold text-gray-900 truncate">{current ? current.name : 'No template'}</div>
          <div className="text-xs text-gray-600">
            {current ? <>Best for {bestFor(current.industry)}</> : 'Your name, colours and a booking button'}
          </div>
          {current && <div className="text-[11px] text-gray-600 mt-1 first-letter:uppercase">{cardFacts(current)}</div>}
          {current && current.status !== 'approved' && <div className="text-xs text-amber-800 mt-1">No longer in the catalogue: your site keeps it until you choose another.</div>}
          <div className="flex flex-wrap gap-2 mt-auto pt-3">
            {current && <button onClick={() => open(current.id)} className={`${btn} bg-gray-100`}>{loading === current.id && !browsing ? 'Opening…' : 'Preview all pages'}</button>}
            <button onClick={() => setBrowsing(true)} className={`${btn} bg-gray-100`}>Change</button>
          </div>
        </div>
      </div>
      <button onClick={() => setBrowsing(true)}
        className="mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B2E59] text-white font-semibold px-5 py-3 text-sm shadow-sm hover:bg-[#0B2E59]/90">
        Browse all {offered.length} websites <span aria-hidden="true">→</span>
      </button>

      {browsing && (
        <TemplateGallery templates={offered} selected={selected} canEdit={canEdit} filter={filter} onFilter={setFilter} libraryCategories={libraryCats}
          opening={loading} onPreview={(id, results) => open(id, results)} onChoose={choose} onClose={() => setBrowsing(false)} />
      )}
      {preview && (
        <TemplatePreview template={preview.t} path={preview.path} onPath={path => setPreview({ ...preview, path })}
          selected={selected} canEdit={canEdit} onChoose={() => choose(preview.t.id)} onClose={() => setPreview(null)}
          brand={brand} sellerNotice={sellerNotice} step={step} images={preview.images} />
      )}
    </div>
  );
}
