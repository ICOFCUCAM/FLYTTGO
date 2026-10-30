/**
 * Admin → White label → Image library (docs/WHITE_LABEL.md → Image library,
 * migration 00023): the shared photos every template slot draws from.
 *
 *   Images    upload (PNG, JPEG or WebP, at most 8 MB, checked by its
 *             bytes; stored at site-image-library/<category>/<sha256>.<ext>)
 *             with its category, shape (computed from its size, editable),
 *             tags, alt text, origin, licence and the evidence of it; filter
 *             by category, shape and status; approve (licence, evidence and
 *             alt text needed), reject or retire with a reason, edit. Every
 *             step is kept in the image's history.
 *   Coverage  per category and shape: approved and pending photos against
 *             what the category's templates need (the most slots of a shape
 *             in one template, so a page need not repeat a photo).
 */
import { useCallback, useEffect, useState } from 'react';
import { categoryLabel } from '../../../supabase/functions/_shared/site-template';
import { imageInfo } from '../../../supabase/functions/_shared/template-images';
import {
  LIBRARY_CATEGORIES, LIBRARY_SHAPES, LIBRARY_STATUSES, MAX_LIBRARY_IMAGE, SHAPE_LABELS, shapeOf, type LibraryShape, type LibraryStatus,
} from '../../../supabase/functions/_shared/image-library';
import {
  addLibraryImage, libraryImageUrl, loadLibrary, loadLibraryCoverage, reviewLibraryImage, updateLibraryImage, type LibraryImage,
} from '../../lib/whiteLabel';

const btn = 'px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50';
const field = 'w-full border rounded px-2 py-1 text-xs';
const STATUS_STYLE: Record<LibraryStatus, string> = {
  approved: 'text-emerald-700', pending: 'text-amber-800', rejected: 'text-red-700', retired: 'text-gray-500',
};
const EMPTY = { file: null as File | null, category: 'transport', shape: 'wide' as LibraryShape, tags: '', alt: '', origin: '', licence: '', evidence: '', size: '' };

export default function ImageLibraryAdmin() {
  const [view, setView] = useState<'images' | 'coverage'>('images');
  const [filter, setFilter] = useState({ category: '', shape: '', status: 'pending' });
  const [rows, setRows] = useState<LibraryImage[]>([]);
  const [coverage, setCoverage] = useState<Awaited<ReturnType<typeof loadLibraryCoverage>>>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<{ id: string; shape: LibraryShape; tags: string; alt: string; origin: string; licence: string; evidence: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [r, c] = await Promise.all([
      loadLibrary({ category: filter.category || undefined, shape: filter.shape || undefined, status: filter.status || undefined }),
      loadLibraryCoverage()]);
    setRows(r); setCoverage(c);
  }, [filter]);
  useEffect(() => { reload(); }, [reload]);

  const run = async (fn: () => Promise<string | null>, ok: string) => {
    setBusy(true); setMsg(null);
    const e = await fn();
    setBusy(false);
    setMsg(e ? { ok: false, text: e } : { ok: true, text: ok });
    if (!e) await reload();
    return !e;
  };
  /* The shape is suggested from the file's size in pixels, read from its bytes. */
  const pick = async (file: File | null) => {
    if (!file) { setForm({ ...form, file: null, size: '' }); return; }
    const info = imageInfo(new Uint8Array(await file.arrayBuffer()));
    if (!info) { setForm({ ...form, file: null, size: '' }); setMsg({ ok: false, text: 'The file is not a PNG, JPEG or WebP image.' }); return; }
    setForm({ ...form, file, shape: shapeOf(info.width, info.height) ?? form.shape, size: `${info.width} × ${info.height} px` });
  };
  const words = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['images', 'coverage'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
            className={`px-3 py-1 rounded-full text-xs font-medium ${view === v ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            {v === 'images' ? 'Images' : 'Coverage by category'}
          </button>
        ))}
      </div>
      {msg && <div className={`rounded-lg px-4 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`} role="status">{msg.text}</div>}

      {view === 'coverage' && (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="text-left p-3 text-gray-600">Approved photos per shape against what the category's templates need: the most slots of that shape in one template (so a page need not repeat a photo), and all their slots. Pending in brackets. A map slot never takes a photo.</caption>
            <thead><tr className="text-left text-gray-500 border-b"><th className="p-2">Category</th><th className="p-2">Templates</th>
              {LIBRARY_SHAPES.map(s => <th key={s} className="p-2">{SHAPE_LABELS[s]}</th>)}</tr></thead>
            <tbody>
              {LIBRARY_CATEGORIES.map(c => {
                const cells = coverage.filter(x => x.category === c);
                return (
                  <tr key={c} className="border-b last:border-0">
                    <td className="p-2 font-medium">{categoryLabel(c)}</td>
                    <td className="p-2">{cells[0]?.templates ?? 0}</td>
                    {LIBRARY_SHAPES.map(s => {
                      const x = cells.find(y => y.shape === s);
                      const short = x && x.approved < x.most_in_a_template;
                      return (
                        <td key={s} className={`p-2 ${short ? 'text-red-700 font-semibold' : ''}`}>
                          {x ? `${x.approved} of ${x.most_in_a_template} needed` : '–'}{x?.pending ? ` (${x.pending})` : ''}
                          {x && x.slots > 0 && <span className="block text-gray-500 font-normal">{x.slots} slot(s) in all</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === 'images' && <>
        <div className="bg-white rounded-lg shadow p-3 text-xs space-y-2" aria-label="Add an image">
          <div className="font-semibold">Add an image</div>
          <div className="grid sm:grid-cols-3 gap-2">
            <label className="sm:col-span-3">File (PNG, JPEG or WebP, at most {MAX_LIBRARY_IMAGE / 1024 / 1024} MB; checked by its bytes)
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => pick(e.target.files?.[0] ?? null)} className="block mt-1" />
              {form.size && <span className="text-gray-500">{form.size}</span>}
            </label>
            <label>Category<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className={field}>
              {LIBRARY_CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}</select></label>
            <label>Shape (from its size; change if needed)<select value={form.shape} onChange={e => setForm({ ...form, shape: e.target.value as LibraryShape })} className={field}>
              {LIBRARY_SHAPES.map(s => <option key={s} value={s}>{SHAPE_LABELS[s]}</option>)}</select></label>
            <label>Tags (comma-separated)<input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} className={field} /></label>
            <label className="sm:col-span-3">Alt text (what it shows)<input value={form.alt} onChange={e => setForm({ ...form, alt: e.target.value })} className={field} /></label>
            <label>Origin (where it comes from)<input value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })} placeholder="unsplash, own, ai-generated…" className={field} /></label>
            <label>Licence<input value={form.licence} onChange={e => setForm({ ...form, licence: e.target.value })} placeholder="Name and version" className={field} /></label>
            <label>Licence evidence<input value={form.evidence} onChange={e => setForm({ ...form, evidence: e.target.value })} placeholder="Address of the licence or where it is recorded" className={field} /></label>
          </div>
          <button disabled={busy || !form.file || !form.origin.trim()} className={`${btn} bg-[#0B2E59] text-white`} onClick={async () => {
            if (await run(() => addLibraryImage(form.file!, { category: form.category, shape: form.shape, tags: words(form.tags), alt: form.alt,
              origin: form.origin, licence: form.licence, licence_evidence: form.evidence }), 'Image added; it is pending until approved.')) setForm({ ...EMPTY, category: form.category });
          }}>Upload and add</button>
        </div>

        <div className="flex flex-wrap gap-2 text-xs" role="group" aria-label="Filter">
          <select aria-label="Category" value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })} className="border rounded px-2 py-1">
            <option value="">All categories</option>{LIBRARY_CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}</select>
          <select aria-label="Shape" value={filter.shape} onChange={e => setFilter({ ...filter, shape: e.target.value })} className="border rounded px-2 py-1">
            <option value="">All shapes</option>{LIBRARY_SHAPES.map(s => <option key={s} value={s}>{SHAPE_LABELS[s]}</option>)}</select>
          <select aria-label="Status" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })} className="border rounded px-2 py-1">
            <option value="">Every status</option>{LIBRARY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <span className="self-center text-gray-500">{rows.length} image(s){rows.length === 500 ? ' (the first 500)' : ''}</span>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {rows.map(r => (
            <div key={r.id} className="bg-white rounded-lg shadow p-2 text-xs space-y-1">
              <img src={libraryImageUrl(r.storage_path)} alt={r.alt_text ?? ''} loading="lazy" className="w-full h-36 object-cover rounded bg-gray-100" />
              <div className="flex justify-between gap-2"><span className="font-medium">{categoryLabel(r.category)} · {SHAPE_LABELS[r.shape]}</span>
                <span className={STATUS_STYLE[r.review_status]}>{r.review_status}</span></div>
              <div className="text-gray-700 truncate" title={r.alt_text ?? ''}>{r.alt_text ?? 'No alt text yet'}</div>
              <div className="text-gray-600">{r.origin} · {r.licence ?? 'licence unknown'}{r.licence_evidence ? '' : ' · no evidence'}</div>
              <div className="text-gray-500">{r.width} × {r.height} px · {r.sha256.slice(0, 10)}…{r.tags.length ? ` · ${r.tags.join(', ')}` : ''}</div>
              {r.review_reason && <div className="text-gray-500">Reason: “{r.review_reason}”</div>}
              <div className="flex flex-wrap gap-1 pt-1">
                {r.review_status !== 'approved' && r.review_status !== 'retired' && (
                  <button disabled={busy} className={`${btn} bg-emerald-50 text-emerald-800`} onClick={() => run(() => reviewLibraryImage(r.id, 'approved'), 'Image approved.')}>Approve</button>
                )}
                {r.review_status === 'pending' && (
                  <button disabled={busy} className={`${btn} bg-red-50 text-red-800`} onClick={() => {
                    const reason = prompt('Why is this image rejected?')?.trim();
                    if (reason) run(() => reviewLibraryImage(r.id, 'rejected', reason), 'Image rejected.');
                  }}>Reject</button>
                )}
                {r.review_status === 'approved' && (
                  <button disabled={busy} className={`${btn} bg-gray-100`} onClick={() => {
                    const reason = prompt('Why is this image retired? Sites using it fall back to another photo or a plain block.')?.trim();
                    if (reason) run(() => reviewLibraryImage(r.id, 'retired', reason), 'Image retired.');
                  }}>Retire</button>
                )}
                {(r.review_status === 'rejected' || r.review_status === 'retired') && (
                  <button disabled={busy} className={`${btn} bg-gray-100`} onClick={() => run(() => reviewLibraryImage(r.id, 'pending'), 'Back to pending.')}>Back to pending</button>
                )}
                <button disabled={busy} className={`${btn} bg-gray-100`} onClick={() => setEditing(editing?.id === r.id ? null : {
                  id: r.id, shape: r.shape, tags: r.tags.join(', '), alt: r.alt_text ?? '', origin: r.origin, licence: r.licence ?? '', evidence: r.licence_evidence ?? '',
                })}>Edit…</button>
              </div>
              {editing?.id === r.id && (
                <div className="border-t pt-1 space-y-1">
                  <select aria-label="Shape" value={editing.shape} onChange={e => setEditing({ ...editing, shape: e.target.value as LibraryShape })} className={field}>
                    {LIBRARY_SHAPES.map(s => <option key={s} value={s}>{SHAPE_LABELS[s]}</option>)}</select>
                  <input aria-label="Tags" value={editing.tags} onChange={e => setEditing({ ...editing, tags: e.target.value })} placeholder="Tags" className={field} />
                  <input aria-label="Alt text" value={editing.alt} onChange={e => setEditing({ ...editing, alt: e.target.value })} placeholder="Alt text" className={field} />
                  <input aria-label="Origin" value={editing.origin} onChange={e => setEditing({ ...editing, origin: e.target.value })} placeholder="Origin" className={field} />
                  <input aria-label="Licence" value={editing.licence} onChange={e => setEditing({ ...editing, licence: e.target.value })} placeholder="Licence" className={field} />
                  <input aria-label="Licence evidence" value={editing.evidence} onChange={e => setEditing({ ...editing, evidence: e.target.value })} placeholder="Licence evidence" className={field} />
                  <button disabled={busy} className={`${btn} bg-[#0B2E59] text-white`} onClick={async () => {
                    if (await run(() => updateLibraryImage(r.id, { shape: editing.shape, tags: words(editing.tags), alt: editing.alt, origin: editing.origin,
                      licence: editing.licence, licence_evidence: editing.evidence }), 'Saved. A changed shape, origin or licence needs a new approval.')) setEditing(null);
                  }}>Save</button>
                  <p className="text-gray-500">The category is part of where the file is stored: add the image again under another category instead.</p>
                </div>
              )}
              {r.history.length > 0 && (
                <details className="text-gray-500"><summary>History ({r.history.length})</summary>
                  <ul>{r.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString('nb-NO')}: {h.action}{h.to ? ` → ${h.to}` : ''}{h.reason ? ` (“${h.reason}”)` : ''}</li>)}</ul>
                </details>
              )}
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}
