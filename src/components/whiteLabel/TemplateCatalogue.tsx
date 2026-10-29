/**
 * The website catalogue (docs/WHITE_LABEL.md → Website templates): every
 * approved template, by category, in name order. Each card shows the
 * template's thumbnail (a picture of its home page drawn by the importer;
 * the live miniature, TemplateThumb, where it has none), its style, what
 * its pages have (features found at import), how many pages and what kind
 * of business it suits; and a full preview of each page in the company's
 * own name and colours before it is chosen: at desktop width, as a tablet
 * (768 px) or as a phone (390 px), page by page (tabs, previous and next).
 * Previews are sandboxed without scripts, as the published site is.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  OTHER_CATEGORY, TEMPLATE_CATEGORIES, bestFor, categoryLabel, featureLabel, renderTemplatePage, templateCategory, type Brand,
} from '../../../supabase/functions/_shared/site-template';
import { loadTemplate, thumbnailOf, type SiteTemplate, type SiteTemplateSummary } from '../../lib/whiteLabel';
import TemplateThumb from './TemplateThumb';

const btn = 'px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50';

const hostsOf = (assets: { url: string }[]) =>
  assets.map(a => { try { return new URL(a.url).host; } catch { return ''; } }).filter(Boolean);

/** Every card's picture has the same shape: the top of the home page, 4 : 3. */
const THUMB_BOX = 'aspect-[4/3]';
const tag = 'inline-block rounded-full px-2 py-0.5 text-[11px] font-medium';

/** The preview's screen sizes: a desktop (the full width), a tablet and a phone. */
const DEVICES = [
  { id: 'desktop', label: 'Desktop', width: 0 },
  { id: 'tablet', label: 'Tablet', width: 768 },
  { id: 'phone', label: 'Phone', width: 390 },
] as const;
type Device = (typeof DEVICES)[number]['id'];

const pageName = (path: string) => path === '/' ? 'Home' : path.replace(/^\//, '').replace(/[-/]/g, ' ').replace(/^./, c => c.toUpperCase());

export default function TemplateCatalogue({ templates, selected, onSelect, canEdit, brand, sellerNotice }: {
  templates: SiteTemplateSummary[];
  selected: string;
  onSelect: (id: string) => void;
  canEdit: boolean;
  /** The company's name, colours and contact details, as the preview shows them. */
  brand: Brand;
  sellerNotice: string;
}) {
  const offered = useMemo(() => templates.filter(t => t.status === 'approved'), [templates]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of offered) { const c = templateCategory(t.industry) ?? OTHER_CATEGORY.id; m.set(c, (m.get(c) ?? 0) + 1); }
    return m;
  }, [offered]);
  const categories = [...TEMPLATE_CATEGORIES, OTHER_CATEGORY].filter(c => counts.has(c.id));
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<{ t: SiteTemplate; path: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('desktop');

  // Open on the company's current category the first time.
  useEffect(() => {
    const current = offered.find(t => t.id === selected);
    if (current && category === 'all') setCategory(templateCategory(current.industry) ?? 'all');
  }, [offered]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const shown = offered.filter(t => (category === 'all' || (templateCategory(t.industry) ?? OTHER_CATEGORY.id) === category)
    && (!q || `${t.name} ${t.style ?? ''} ${t.industry.join(' ')} ${(t.features ?? []).map(featureLabel).join(' ')}`.toLowerCase().includes(q)));

  const open = async (id: string) => {
    setLoading(id);
    const t = await loadTemplate(id);
    setLoading(null);
    if (t) setPreview({ t, path: t.pages[0]?.path ?? '/' });
  };

  if (offered.length === 0) {
    return <p className="text-sm text-gray-500">No templates are offered yet: FlyttGo checks each one before it's offered. Until then your page is a simple branded front page.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button onClick={() => setCategory('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold ${category === 'all' ? 'bg-[#0B2E59] text-white' : 'bg-gray-100 text-gray-700'}`}>
          All ({offered.length})
        </button>
        {categories.map(c => (
          <button key={c.id} onClick={() => setCategory(c.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold ${category === c.id ? 'bg-[#0B2E59] text-white' : 'bg-gray-100 text-gray-700'}`}>
            {c.label} ({counts.get(c.id)})
          </button>
        ))}
      </div>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, style or what it has"
        className="w-full max-w-xs border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3" />

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className={`rounded-xl border-2 overflow-hidden ${selected === '' ? 'border-[#0B2E59]' : 'border-gray-200'}`}>
          <div className={`bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-sm text-gray-500 ${THUMB_BOX}`}>Simple branded front page</div>
          <div className="p-3 flex items-center justify-between">
            <div><div className="font-semibold text-sm">No template</div><div className="text-xs text-gray-500">Your name, colours and a booking button</div></div>
            {selected === '' ? <span className="text-xs font-semibold text-[#0B2E59]">Chosen</span>
              : <button disabled={!canEdit} onClick={() => onSelect('')} className={`${btn} bg-gray-100`}>Choose</button>}
          </div>
        </div>
        {shown.map(t => {
          const thumb = thumbnailOf(t);
          const pages = t.page_count ?? 0;
          return (
            <div key={t.id} className={`rounded-xl border-2 overflow-hidden flex flex-col ${selected === t.id ? 'border-[#0B2E59]' : 'border-gray-200'}`}>
              <button onClick={() => open(t.id)} className={`group block w-full relative overflow-hidden border-b border-gray-100 bg-gray-100 ${THUMB_BOX}`}
                title={`Preview ${t.name}`} aria-label={`Preview ${t.name}`}>
                {thumb ? (
                  <img src={thumb} alt="" loading="lazy" decoding="async" width={640} height={800}
                    className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-[1.04] group-focus-visible:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100 motion-reduce:group-focus-visible:scale-100" />
                ) : (
                  <TemplateThumb template={t} brand={brand} sellerNotice={sellerNotice} />
                )}
                <span className="absolute bottom-2 left-2 text-[11px] font-semibold bg-white/90 rounded px-2 py-0.5 shadow-sm">
                  {loading === t.id ? 'Opening…' : 'Preview all pages'}
                </span>
              </button>
              <div className="p-3 flex-1 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{t.name}</div>
                    <div className="text-xs text-gray-500">Best for {bestFor(t.industry)}</div>
                  </div>
                  {selected === t.id ? <span className="text-xs font-semibold text-[#0B2E59] shrink-0">Chosen</span>
                    : <button disabled={!canEdit} onClick={() => onSelect(t.id)} className={`${btn} bg-gray-100 shrink-0`}>Choose</button>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.style && <span className={`${tag} bg-[#0B2E59]/10 text-[#0B2E59] capitalize`}>{t.style}</span>}
                  {pages > 0 && <span className={`${tag} bg-gray-100 text-gray-700`}>{pages} {pages === 1 ? 'page' : 'pages'}</span>}
                  {(t.features ?? []).map(f => <span key={f} className={`${tag} border border-gray-200 text-gray-600`}>{featureLabel(f)}</span>)}
                </div>
                <div className="text-[11px] text-gray-400 mt-auto">{categoryLabel(templateCategory(t.industry) ?? OTHER_CATEGORY.id)}</div>
              </div>
            </div>
          );
        })}
      </div>
      {shown.length === 0 && <p className="text-sm text-gray-500 mt-3">No template matches.</p>}

      {preview && (() => {
        const pages = preview.t.pages;
        const at = Math.max(0, pages.findIndex(p => p.path === preview.path));
        const go = (i: number) => setPreview({ ...preview, path: pages[(i + pages.length) % pages.length].path });
        const frame = DEVICES.find(d => d.id === device) ?? DEVICES[0];
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2 sm:p-4" role="dialog" aria-modal="true"
            aria-label={`Preview of ${preview.t.name}`}
            onKeyDown={e => { if (e.key === 'Escape') setPreview(null); }}>
            <div className="bg-white rounded-2xl w-full max-w-7xl h-[94vh] flex flex-col overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 p-3 border-b">
                <div className="font-semibold mr-1">{preview.t.name}</div>
                <span className="text-[11px] font-semibold rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5">
                  Preview: your name and colours, sample content
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                  {selected === preview.t.id ? <span className="text-sm font-semibold text-[#0B2E59] self-center">Chosen</span>
                    : <button disabled={!canEdit} onClick={() => { onSelect(preview.t.id); setPreview(null); }} className={`${btn} bg-[#0B2E59] text-white`}>Choose this website</button>}
                  <button autoFocus onClick={() => setPreview(null)} className={`${btn} bg-gray-100`}>Close</button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-gray-50">
                <button onClick={() => go(at - 1)} disabled={pages.length < 2} className={`${btn} bg-white border border-gray-200`} aria-label="Previous page">‹ Previous</button>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Pages">
                  {pages.map(p => (
                    <button key={p.path} onClick={() => setPreview({ ...preview, path: p.path })} aria-pressed={p.path === preview.path}
                      className={`px-2.5 py-1 rounded text-xs ${p.path === preview.path ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200'}`}>{pageName(p.path)}</button>
                  ))}
                </div>
                <button onClick={() => go(at + 1)} disabled={pages.length < 2} className={`${btn} bg-white border border-gray-200`} aria-label="Next page">Next ›</button>
                <span className="text-xs text-gray-500">Page {at + 1} of {pages.length}</span>
                <div className="ml-auto inline-flex rounded-lg border border-gray-200 bg-white p-0.5" role="group" aria-label="Screen size">
                  {DEVICES.map(d => (
                    <button key={d.id} onClick={() => setDevice(d.id)} aria-pressed={device === d.id} title={d.width ? `${d.width} px wide` : 'Full width'}
                      className={`px-3 py-1 rounded-md text-xs font-semibold ${device === d.id ? 'bg-[#0B2E59] text-white' : 'text-gray-700'}`}>{d.label}</button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-h-0 bg-gray-200 overflow-auto flex justify-center">
                <iframe key={`${preview.t.id}${preview.path}`} title={`${preview.t.name}: ${pageName(preview.path)} (${frame.label.toLowerCase()})`} sandbox=""
                  className={`bg-white ${frame.width ? 'self-stretch shadow-xl sm:my-3 sm:rounded-lg border border-gray-300 shrink-0' : 'w-full h-full'}`}
                  style={frame.width ? { width: frame.width, maxWidth: '100%' } : undefined}
                  srcDoc={renderTemplatePage(pages[at]?.html ?? '', {
                    brand, assets: preview.t.assets, pageUrl: () => '#', bookingUrl: '#', sellerNotice,
                    assetHosts: hostsOf(preview.t.assets),
                  })} />
              </div>
              <p className="text-xs text-gray-500 px-3 py-2 border-t">Shown with your name, colours and contact details; the wording and pictures are the template's samples. On your site every "book" button opens your booking page.</p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
