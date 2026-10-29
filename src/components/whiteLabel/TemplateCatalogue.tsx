/**
 * The website catalogue (docs/WHITE_LABEL.md → Website templates): every
 * approved template, by category, with its picture, and a full preview of
 * each page in the company's own name and colours before it is chosen.
 * Previews are sandboxed without scripts, as the published site is.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  OTHER_CATEGORY, TEMPLATE_CATEGORIES, categoryLabel, renderTemplatePage, templateCategory, type Brand,
} from '../../../supabase/functions/_shared/site-template';
import { loadTemplate, type SiteTemplate, type SiteTemplateSummary } from '../../lib/whiteLabel';

const btn = 'px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50';

const hostsOf = (assets: { url: string }[]) =>
  assets.map(a => { try { return new URL(a.url).host; } catch { return ''; } }).filter(Boolean);

/** The template's main picture: its hero image, else its first one. */
function coverOf(t: SiteTemplateSummary): string | null {
  const a = t.assets.find(x => x.key === 'hero') ?? t.assets.find(x => x.key.startsWith('hero')) ?? t.assets[0];
  return a?.url ?? null;
}

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

  // Open on the company's current category the first time.
  useEffect(() => {
    const current = offered.find(t => t.id === selected);
    if (current && category === 'all') setCategory(templateCategory(current.industry) ?? 'all');
  }, [offered]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const shown = offered.filter(t => (category === 'all' || (templateCategory(t.industry) ?? OTHER_CATEGORY.id) === category)
    && (!q || `${t.name} ${t.style ?? ''} ${t.industry.join(' ')}`.toLowerCase().includes(q)));

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
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or style"
        className="w-full max-w-xs border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3" />

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className={`rounded-xl border-2 overflow-hidden ${selected === '' ? 'border-[#0B2E59]' : 'border-gray-200'}`}>
          <div className="h-36 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-sm text-gray-500">Simple branded front page</div>
          <div className="p-3 flex items-center justify-between">
            <div><div className="font-semibold text-sm">No template</div><div className="text-xs text-gray-500">Your name, colours and a booking button</div></div>
            {selected === '' ? <span className="text-xs font-semibold text-[#0B2E59]">Chosen</span>
              : <button disabled={!canEdit} onClick={() => onSelect('')} className={`${btn} bg-gray-100`}>Choose</button>}
          </div>
        </div>
        {shown.map(t => {
          const cover = coverOf(t);
          return (
            <div key={t.id} className={`rounded-xl border-2 overflow-hidden ${selected === t.id ? 'border-[#0B2E59]' : 'border-gray-200'}`}>
              <button onClick={() => open(t.id)} className="block w-full h-36 bg-gray-100 relative" title={`Preview ${t.name}`}>
                {cover && <img src={cover} alt="" loading="lazy" className="w-full h-full object-cover" />}
                <span className="absolute bottom-2 left-2 text-[11px] font-semibold bg-white/90 rounded px-2 py-0.5">
                  {loading === t.id ? 'Opening…' : 'Preview'}
                </span>
              </button>
              <div className="p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{t.name}</div>
                  <div className="text-xs text-gray-500 truncate">{categoryLabel(templateCategory(t.industry) ?? OTHER_CATEGORY.id)}{t.style ? ` · ${t.style}` : ''}</div>
                </div>
                {selected === t.id ? <span className="text-xs font-semibold text-[#0B2E59] shrink-0">Chosen</span>
                  : <button disabled={!canEdit} onClick={() => onSelect(t.id)} className={`${btn} bg-gray-100 shrink-0`}>Choose</button>}
              </div>
            </div>
          );
        })}
      </div>
      {shown.length === 0 && <p className="text-sm text-gray-500 mt-3">No template matches.</p>}

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Preview of ${preview.t.name}`}>
          <div className="bg-white rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 p-3 border-b">
              <div className="font-semibold mr-2">{preview.t.name}</div>
              {preview.t.pages.map(p => (
                <button key={p.path} onClick={() => setPreview({ ...preview, path: p.path })}
                  className={`px-2.5 py-1 rounded text-xs ${p.path === preview.path ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}>{pageName(p.path)}</button>
              ))}
              <div className="ml-auto flex gap-2">
                {selected === preview.t.id ? <span className="text-sm font-semibold text-[#0B2E59] self-center">Chosen</span>
                  : <button disabled={!canEdit} onClick={() => { onSelect(preview.t.id); setPreview(null); }} className={`${btn} bg-[#0B2E59] text-white`}>Choose this website</button>}
                <button onClick={() => setPreview(null)} className={`${btn} bg-gray-100`}>Close</button>
              </div>
            </div>
            <iframe title={`${preview.t.name}: ${pageName(preview.path)}`} sandbox="" className="flex-1 w-full bg-white"
              srcDoc={renderTemplatePage(preview.t.pages.find(p => p.path === preview.path)?.html ?? '', {
                brand, assets: preview.t.assets, pageUrl: () => '#', bookingUrl: '#', sellerNotice,
                assetHosts: hostsOf(preview.t.assets),
              })} />
            <p className="text-xs text-gray-500 px-3 py-2 border-t">Shown with your name, colours and contact details. On your site every "book" button opens your booking page.</p>
          </div>
        </div>
      )}
    </div>
  );
}
