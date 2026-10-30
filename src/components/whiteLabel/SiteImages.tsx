/**
 * The pictures of a company's website (docs/WHITE_LABEL.md → Image library),
 * in Corporate → White label → Website, for the template it saved: each
 * image slot of the template with what it shows now and where that comes
 * from (the company's own image, the template's, the library's for the
 * template's kind of business, the imported one, or a plain colour block).
 * Owners and admins replace a slot's picture with their own upload (PNG,
 * JPEG or WebP, at most 8 MB, checked by its bytes) or a pick from the
 * approved library of the template's category, and reset it to the default.
 * The database resolves and checks every step (00023).
 */
import { useCallback, useEffect, useState } from 'react';
import { neutralImage, templateCategory, categoryLabel } from '../../../supabase/functions/_shared/site-template';
import {
  SOURCE_LABELS_MAP, shapesFor, type ImageMap, type RenderImages, type SlotShape,
} from '../../../supabase/functions/_shared/image-library';
import {
  libraryImageUrl, loadImageMap, loadLibrary, renderableImages, resetCompanyImage, setCompanyImageFromLibrary, setCompanyImageUpload,
  type LibraryImage, type SiteTemplateSummary,
} from '../../lib/whiteLabel';

const btn = 'px-2.5 py-1 rounded-lg text-xs font-semibold disabled:opacity-50';
const SHAPE_WORDS: Record<SlotShape, string> = { hero: 'wide banner', wide: 'wide picture', square: 'square picture', portrait: 'portrait', map: 'map' };
const slotName = (key: string) => key.replace(/[-_.]+/g, ' ').replace(/\s(\d+)$/, ' $1').replace(/^./, c => c.toUpperCase());

export default function SiteImages({ orgId, template, canEdit, colour }: {
  orgId: string;
  /** The template the company saved for its site. */
  template: SiteTemplateSummary;
  canEdit: boolean;
  /** The company's main colour (the plain block). */
  colour: string | null;
}) {
  const [map, setMap] = useState<ImageMap | null>(null);
  const [images, setImages] = useState<RenderImages | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<{ key: string; mode: 'upload' | 'library' } | null>(null);
  const [library, setLibrary] = useState<LibraryImage[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const category = templateCategory(template.industry);

  const reload = useCallback(async () => {
    const m = await loadImageMap(template.id, orgId);
    if (!m) { setFailed(true); return; }
    setFailed(false);
    setMap(m);
    setImages(await renderableImages(m));
  }, [template.id, orgId]);
  useEffect(() => { reload(); }, [reload]);

  const act = async (fn: () => Promise<string | null>, ok: string) => {
    setBusy(true); setMsg(null);
    const e = await fn();
    setBusy(false);
    setMsg(e ? { ok: false, text: e } : { ok: true, text: ok });
    if (!e) { setOpen(null); setFile(null); setAlt(''); await reload(); }
  };
  const choose = async (key: string, mode: 'upload' | 'library') => {
    setMsg(null); setFile(null); setAlt('');
    if (open?.key === key && open.mode === mode) { setOpen(null); return; }
    setOpen({ key, mode });
    if (mode === 'library' && category) {
      setLibrary(await loadLibrary({ category, status: 'approved', shapes: shapesFor(map?.images[key]?.shape ?? 'wide') }));
    }
  };

  if (failed) return <p className="text-xs text-gray-500 mt-3">The website's pictures cannot be shown right now.</p>;
  if (!map || !images) return <p className="text-xs text-gray-500 mt-3">Loading the website's pictures…</p>;
  const keys = Object.keys(map.images);
  if (keys.length === 0) return null;

  return (
    <section className="mt-5 border-t pt-4" aria-labelledby="site-images-title">
      <h4 id="site-images-title" className="font-semibold text-gray-900">Pictures on your website</h4>
      <p className="text-xs text-gray-600 mb-3">
        Each picture of {template.name}. Use your own photo, or one of FlyttGo's approved photos for {category ? categoryLabel(category).toLowerCase() : 'this kind of business'}.
        {map.mode === 'assets' ? ' Until FlyttGo has photos for this kind of business, the template shows the pictures it came with.' : ''}
      </p>
      {msg && <p className={`text-xs mb-2 ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`} role="status">{msg.text}</p>}
      <ul className="grid sm:grid-cols-2 gap-3">
        {keys.map(key => {
          const e = map.images[key];
          const shown = images.byKey[key];
          const own = e.source === 'company';
          return (
            <li key={key} className="border border-gray-200 rounded-lg p-2 flex gap-3">
              <img src={shown?.url ?? neutralImage(colour)} alt={shown?.url ? (shown.alt ?? '') : ''} loading="lazy"
                className="w-28 h-20 object-cover rounded bg-gray-100 shrink-0" />
              <div className="min-w-0 flex-1 text-xs space-y-1">
                <div className="font-semibold text-gray-900 truncate">{slotName(key)} <span className="font-normal text-gray-500">· {SHAPE_WORDS[e.shape] ?? e.shape}</span></div>
                <div className="text-gray-600">{SOURCE_LABELS_MAP[shown?.source ?? e.source]}</div>
                {canEdit && e.shape !== 'map' && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    <button disabled={busy} onClick={() => choose(key, 'upload')} className={`${btn} bg-gray-100`} aria-expanded={open?.key === key && open.mode === 'upload'}>Upload your own…</button>
                    {category && <button disabled={busy} onClick={() => choose(key, 'library')} className={`${btn} bg-gray-100`} aria-expanded={open?.key === key && open.mode === 'library'}>Choose from library…</button>}
                    {own && <button disabled={busy} onClick={() => act(() => resetCompanyImage(orgId, key), 'Back to the default picture.')} className={`${btn} bg-white border border-gray-200`}>Reset to default</button>}
                  </div>
                )}
                {canEdit && e.shape === 'map' && own && (
                  <button disabled={busy} onClick={() => act(() => resetCompanyImage(orgId, key), 'Back to the default picture.')} className={`${btn} bg-white border border-gray-200`}>Reset to default</button>
                )}
                {open?.key === key && open.mode === 'upload' && (
                  <div className="space-y-1 border-t pt-2">
                    <input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`Your picture for ${slotName(key)}`}
                      onChange={ev => setFile(ev.target.files?.[0] ?? null)} />
                    <input value={alt} onChange={ev => setAlt(ev.target.value)} placeholder="What it shows (for screen readers)"
                      className="w-full border rounded px-2 py-1" aria-label="What it shows" />
                    <button disabled={busy || !file} onClick={() => file && act(() => setCompanyImageUpload(orgId, key, file, alt), 'Your picture is on your website.')}
                      className={`${btn} bg-[#0B2E59] text-white`}>Upload and use</button>
                    <p className="text-gray-500">PNG, JPEG or WebP, at most 8 MB. Use only photos you may publish.</p>
                  </div>
                )}
                {open?.key === key && open.mode === 'library' && (
                  <div className="border-t pt-2">
                    {library.length === 0 ? <p className="text-gray-500">No approved photos of this shape for {category ? categoryLabel(category).toLowerCase() : 'this category'} yet.</p> : (
                      <div className="grid grid-cols-3 gap-1" role="list" aria-label="Library photos">
                        {library.map(l => (
                          <button key={l.id} role="listitem" disabled={busy} onClick={() => act(() => setCompanyImageFromLibrary(orgId, key, l.id), 'Picture chosen.')}
                            className="rounded overflow-hidden border border-gray-200 hover:ring-2 hover:ring-[#0B2E59] focus-visible:ring-2 focus-visible:ring-[#0B2E59]"
                            aria-label={`Use: ${l.alt_text ?? 'library photo'}`}>
                            <img src={libraryImageUrl(l.storage_path)} alt="" loading="lazy" className="w-full h-14 object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
