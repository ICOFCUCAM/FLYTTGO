/**
 * The Design Refinement Lab for the restructured homepage (/preview/lab; owner's 2036 mandate,
 * 30 October 2026). Private and isolated: it refuses to open on a production host, is not linked
 * from any page, carries noindex, and changes nothing a visitor sees. It frames the real
 * /preview/home (?lab=1) one to three times at an identical viewport, sends each frame trial
 * tokens and section variants (design.config.ts), and shows what each frame measured back:
 * anything wider than the viewport and the smallest text. Settings are kept in this browser only
 * and can be exported as JSON; the reviewed decisions live in decisions.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isProductionHost } from '../../../lib/hosts';
import {
  applyDesign, COLOUR_CONTROLS, DEFAULT_TOKENS, DEFAULT_VARIANTS, RANGE_CONTROLS, VARIANT_OPTIONS,
  type DesignTokens, type DesignVariants, type LabMessage,
} from '../design.config';
import { DECISIONS, type Decision } from './decisions';
import '../design.v2.css';
import '../homeV2.css';

type Metrics = { overflow: number; minFont: number; height: number; width: number; pageOverflow: boolean };
type Frame = { id: string; variants: DesignVariants };
type Tab = 'compare' | 'responsive' | 'components' | 'decisions';
type Saved = { tokens: DesignTokens; frames: Frame[]; viewport: number; history: Decision[] };

const VIEWPORTS = [{ w: 1440, h: 900, label: 'Desktop 1440' }, { w: 1280, h: 800, label: 'Laptop 1280' },
                   { w: 820, h: 1180, label: 'Tablet 820' }, { w: 390, h: 844, label: 'Mobile 390' }];
const SECTIONS = [['', 'Top of page'], ['booking', 'Booking'], ['entry-points', 'Journeys'], ['marketplace', 'Marketplace'],
  ['moving-services', 'Moving'], ['business-workspace', 'Business workspace'], ['financial-administration', 'Financial workspace'],
  ['industry-experiences', 'Industries'], ['unified-platform', 'Connected platform'], ['business', 'Corporate'],
  ['driver-network', 'Providers'], ['white-label-builder', 'Marketplace Studio'], ['marketplace-network-experience', 'Network'],
  ['final-cta', 'Closing']] as const;
const KEY = 'flyttgo_design_lab';
const LETTERS = ['A', 'B', 'C'];

function load(): Saved {
  const fallback: Saved = { tokens: DEFAULT_TOKENS, frames: [{ id: 'A', variants: DEFAULT_VARIANTS }], viewport: 1440, history: [] };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (!s) return fallback;
    return {
      tokens: { ...DEFAULT_TOKENS, ...s.tokens },
      frames: (s.frames?.length ? s.frames : fallback.frames).map(f => ({ id: f.id, variants: { ...DEFAULT_VARIANTS, ...f.variants } })),
      viewport: s.viewport ?? 1440, history: s.history ?? [],
    };
  } catch { return fallback; }
}

/* WCAG relative luminance contrast, for the colour swatches. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/* One framed copy of the real preview page, at a fixed viewport, scaled to its column. */
function PreviewFrame({ frame, tokens, viewport, height, section, onMetrics, title }: {
  frame: Frame; tokens: DesignTokens; viewport: number; height: number; section: string;
  onMetrics: (m: Metrics) => void; title: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / viewport)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewport]);

  const send = useCallback(() => {
    const win = ref.current?.contentWindow; if (!win) return;
    const msg: LabMessage = { type: 'flyttgo-design', tokens, variants: frame.variants };
    win.postMessage(msg, window.location.origin);
  }, [tokens, frame.variants]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== ref.current?.contentWindow) return;
      if (e.data?.type === 'flyttgo-ready') { setReady(true); send(); }
      if (e.data?.type === 'flyttgo-metrics') onMetrics(e.data as Metrics);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [send, onMetrics]);

  useEffect(() => { if (ready) send(); }, [ready, send]);
  useEffect(() => {
    const doc = ref.current?.contentDocument; if (!ready || !doc) return;
    const target = section ? doc.getElementById(section) ?? doc.querySelector(`.${section}`) : null;
    if (target) target.scrollIntoView({ block: 'start' }); else ref.current?.contentWindow?.scrollTo(0, 0);
  }, [ready, section, frame.variants]);

  return (
    <div ref={box} className="w-full overflow-hidden border border-slate-300 bg-white" style={{ height: height * scale }}>
      <iframe ref={ref} title={title} src="/preview/home?lab=1" onLoad={() => setReady(false)}
        style={{ width: viewport, height, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0, display: 'block' }} />
    </div>
  );
}

function Badge({ m, viewport }: { m?: Metrics; viewport: number }) {
  if (!m) return <span className="text-xs text-slate-500">Measuring…</span>;
  const harmed = m.overflow > 0 || m.pageOverflow || m.minFont < 11 || m.width !== viewport && Math.abs(m.width - viewport) > 20;
  return (
    <span className={`inline-flex flex-wrap gap-x-3 text-xs font-semibold ${harmed ? 'text-red-700' : 'text-emerald-800'}`}>
      <span>{harmed ? '⚠ Viewport harmed' : '✓ Fits'}</span>
      <span>{m.overflow} past edge</span>
      <span>smallest text {m.minFont}px</span>
      <span>page {Math.round(m.height).toLocaleString()}px</span>
    </span>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs font-semibold text-slate-700">
      {label}
      <select className="mt-1 block w-full border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/* The reusable pieces of the page, drawn with the same stylesheets and the trial tokens. */
function ComponentLibrary({ tokens }: { tokens: DesignTokens }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) applyDesign(ref.current, tokens, DEFAULT_VARIANTS); }, [tokens]);
  const grounds: [string, string][] = [['white', tokens.white], ['paper', tokens.paper]];
  const texts: [string, string][] = [['ink', tokens.ink], ['blue', tokens.blue], ['forest', tokens.forest], ['muted', '#4a5260']];
  return (
    <div ref={ref} className="fgv2" style={{ padding: 32 }}>
      <div style={{ display: 'grid', gap: 40 }}>
        <section style={{ padding: 0, border: 0 }}>
          <span className="eyebrow">Colour and contrast</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginTop: 16 }}>
            {grounds.flatMap(([g, gv]) => texts.map(([t, tv]) => {
              const r = contrast(tv, gv);
              return (
                <div key={g + t} style={{ background: gv, color: tv, border: '1px solid var(--line)', padding: 16 }}>
                  <b style={{ display: 'block', fontSize: 15 }}>{t} on {g}</b>
                  <small style={{ fontSize: 13 }}>{r.toFixed(2)}:1 {r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : 'fails AA'}</small>
                </div>
              );
            }))}
            <div style={{ background: tokens.blue, color: '#fff', padding: 16 }}><b style={{ display: 'block', fontSize: 15 }}>white on blue</b><small style={{ fontSize: 13 }}>{contrast('#ffffff', tokens.blue).toFixed(2)}:1</small></div>
            <div style={{ background: tokens.blue, color: '#DCC9A0', padding: 16 }}><b style={{ display: 'block', fontSize: 15 }}>gold text on blue</b><small style={{ fontSize: 13 }}>{contrast('#DCC9A0', tokens.blue).toFixed(2)}:1</small></div>
          </div>
        </section>
        <section style={{ padding: 0, border: 0 }}>
          <span className="eyebrow">Type</span>
          <h2 className="display" style={{ margin: '14px 0 10px' }}>Section heading</h2>
          <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--muted)', maxWidth: 560 }}>Body text under a heading, at the size every section uses. One connected platform for services, business operations and growth.</p>
        </section>
        <section style={{ padding: 0, border: 0, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <a className="btn btn-primary" href="#lab">Primary action<span className="arrow">↗</span></a>
          <a className="btn btn-light" href="#lab">Secondary action<span className="arrow">↗</span></a>
          <span className="v2-chip v2-chip-ok">Paid</span><span className="v2-chip v2-chip-wait">Awaiting</span>
          <span className="v2-chip v2-chip-due">Overdue</span><span className="v2-chip v2-chip-info">In progress</span>
          <span className="v2-chip v2-chip-wait">In development</span>
        </section>
        <section style={{ padding: 0, border: 0 }}>
          <span className="eyebrow">Job trail</span>
          <div className="v2-trail" style={{ border: '1px solid var(--line)', marginTop: 14 }}>
            <b>Follow one job: leak repair for A. Berg</b>
            <ol>{['Enquiry', 'Booked', 'Completed', 'Invoice 1042'].map(s => <li key={s} className="v2-trail-ok"><span>{s}</span><small>Example</small></li>)}
              <li className="v2-trail-wait"><span>Payment</span><small>Awaiting · KID</small></li></ol>
            <button type="button" className="v2-trail-go">See it in finance →</button>
          </div>
        </section>
        <section style={{ padding: 0, border: 0 }}>
          <span className="eyebrow">Transaction explorer</span>
          <div style={{ padding: 24, border: '1px solid var(--line)', marginTop: 14, background: 'var(--white)' }}>
            <nav className="v2-explorer" aria-label="Example steps">{['Work completed', 'Invoice', 'Payment', 'Voucher', 'Financial record', 'Reporting'].map((s, i) =>
              <button key={s} type="button" aria-pressed={i === 3}><i>{i + 1}</i>{s}</button>)}</nav>
            <div className="v2-totals"><div><span>Debit = credit</span><b>NOK 3 412,50</b></div><div className="v2-total-final"><span>Example total</span><b>NOK 3 412,50</b></div></div>
          </div>
        </section>
        <section style={{ padding: 0, border: 0 }}>
          <div className="v2-related"><span>Related</span><a href="#lab">Related link →</a><a href="#lab">Another related link →</a></div>
        </section>
      </div>
    </div>
  );
}

export default function DesignLab() {
  const blocked = typeof window !== 'undefined' && isProductionHost(window.location.hostname);
  const initial = useMemo(load, []);
  const [tokens, setTokens] = useState<DesignTokens>(initial.tokens);
  const [frames, setFrames] = useState<Frame[]>(initial.frames);
  const [viewport, setViewport] = useState(initial.viewport);
  const [history, setHistory] = useState<Decision[]>(initial.history);
  const [tab, setTab] = useState<Tab>('compare');
  const [section, setSection] = useState('');
  const [metrics, setMetrics] = useState<Record<string, Metrics>>({});
  const [note, setNote] = useState({ section: 'hero', chosen: 'A', reason: '' });

  useEffect(() => {
    const meta = document.createElement('meta'); meta.name = 'robots'; meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ tokens, frames, viewport, history })); } catch { /* private mode */ }
  }, [tokens, frames, viewport, history]);

  const metric = useCallback((key: string) => (m: Metrics) => setMetrics(p => ({ ...p, [key]: m })), []);
  const metricFns = useMemo(() => {
    const fns: Record<string, (m: Metrics) => void> = {};
    frames.forEach(f => { fns[f.id] = metric(f.id); VIEWPORTS.forEach(v => { fns[`r${v.w}`] = metric(`r${v.w}`); }); });
    return fns;
  }, [frames, metric]);

  if (blocked) {
    return <main className="mx-auto max-w-xl p-12 text-slate-800"><h1 className="text-2xl font-bold">Not available here</h1><p className="mt-3">The design lab opens only on preview and development hosts.</p></main>;
  }

  const vp = VIEWPORTS.find(v => v.w === viewport) ?? VIEWPORTS[0];
  const setVariant = (id: string, key: keyof DesignVariants, value: string) =>
    setFrames(fs => fs.map(f => f.id === id ? { ...f, variants: { ...f.variants, [key]: value } } : f));
  const addFrame = () => frames.length < 3 && setFrames(fs => [...fs, { id: LETTERS[fs.length], variants: { ...fs[fs.length - 1].variants } }]);
  const removeFrame = () => frames.length > 1 && setFrames(fs => fs.slice(0, -1));
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ tokens, frames, history, decisions: DECISIONS }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'flyttgo-design-lab.json'; a.click();
    URL.revokeObjectURL(a.href);
  };
  const record = () => {
    if (!note.reason.trim()) return;
    const f = frames.find(x => x.id === note.chosen);
    const compared = frames.map(x => `${x.id}: ${x.variants[note.section as keyof DesignVariants]}`);
    setHistory(h => [{ date: new Date().toISOString().slice(0, 10), section: note.section, compared,
      chosen: `${note.chosen}: ${f?.variants[note.section as keyof DesignVariants] ?? ''}`, reason: note.reason.trim() }, ...h]);
    setNote(n => ({ ...n, reason: '' }));
  };
  const cols = tab === 'responsive' ? 'repeat(2, minmax(0, 1fr))' : `repeat(${frames.length}, minmax(0, 1fr))`;
  const tabs: [Tab, string][] = [['compare', 'Compare'], ['responsive', 'Responsive check'], ['components', 'Components'], ['decisions', 'Decisions']];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-300 bg-white px-5 py-3">
        <h1 className="text-base font-bold">FlyttGo design lab <span className="ml-2 border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">Private · preview only</span></h1>
        <nav className="flex gap-1" aria-label="Lab views">
          {tabs.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-sm font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>{l}</button>)}
        </nav>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => { setTokens(DEFAULT_TOKENS); setFrames([{ id: 'A', variants: DEFAULT_VARIANTS }]); }} className="border border-slate-300 px-3 py-1.5 text-sm">Reset to selected design</button>
          <button type="button" onClick={exportJson} className="border border-slate-300 px-3 py-1.5 text-sm">Export JSON</button>
          <a href="/preview/home" className="border border-slate-300 px-3 py-1.5 text-sm">Open preview</a>
        </div>
      </header>

      <div className="grid gap-0 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-5 border-r border-slate-300 bg-white p-5 lg:h-[calc(100vh-57px)] lg:overflow-y-auto" aria-label="Global controls">
          <div>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-600">Colours</h2>
            <div className="space-y-2">{COLOUR_CONTROLS.map(c => (
              <label key={c.key} className="flex items-center gap-3 text-xs">
                <input type="color" value={String(tokens[c.key])} onChange={e => setTokens(t => ({ ...t, [c.key]: e.target.value }))} className="h-8 w-10 cursor-pointer border border-slate-300" />
                <span><b className="block font-mono">{String(tokens[c.key])}</b>{c.label}</span>
              </label>))}</div>
          </div>
          <div>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-600">Type, space, surfaces, pictures</h2>
            <div className="space-y-3">{RANGE_CONTROLS.map(r => (
              <label key={r.key} className="block text-xs">
                <span className="flex justify-between font-semibold"><span>{r.label}</span><span className="font-mono">{String(tokens[r.key])}{r.unit ?? ''}</span></span>
                <input type="range" min={r.min} max={r.max} step={r.step} value={Number(tokens[r.key])} className="w-full"
                  onChange={e => setTokens(t => ({ ...t, [r.key]: Number(e.target.value) }))} />
              </label>))}</div>
          </div>
          <p className="text-xs leading-relaxed text-slate-600">Every frame receives these settings. Changes stay in this browser until exported; the page visitors see uses design.config.ts.</p>
        </aside>

        <main className="min-w-0 p-5">
          {(tab === 'compare' || tab === 'responsive') && (
            <div className="mb-4 flex flex-wrap items-end gap-3">
              {tab === 'compare' && <>
                <div className="w-44"><Select label="Viewport" value={String(viewport)} options={VIEWPORTS.map(v => ({ value: String(v.w), label: `${v.label} × ${v.h}` }))} onChange={v => setViewport(Number(v))} /></div>
                <button type="button" onClick={addFrame} disabled={frames.length >= 3} className="border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40">Add frame</button>
                <button type="button" onClick={removeFrame} disabled={frames.length <= 1} className="border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40">Remove frame</button>
              </>}
              <div className="w-52"><Select label="Show section" value={section} options={SECTIONS.map(([v, l]) => ({ value: v, label: l }))} onChange={setSection} /></div>
              {tab === 'responsive' && <p className="text-xs text-slate-600">Frame A's settings at all four viewports. A red line marks a viewport that is harmed.</p>}
            </div>
          )}

          {tab === 'compare' && (
            <div className="grid gap-4" style={{ gridTemplateColumns: cols }}>
              {frames.map(f => (
                <div key={f.id} className="min-w-0 space-y-2">
                  <div className="flex items-center justify-between"><b className="text-sm">Frame {f.id}</b><Badge m={metrics[f.id]} viewport={vp.w} /></div>
                  <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                    {VARIANT_OPTIONS.map(o => <Select key={o.key} label={o.label} value={f.variants[o.key]} options={o.options} onChange={v => setVariant(f.id, o.key, v)} />)}
                  </div>
                  <PreviewFrame frame={f} tokens={tokens} viewport={vp.w} height={vp.h} section={section} onMetrics={metricFns[f.id]} title={`Preview frame ${f.id}`} />
                </div>
              ))}
            </div>
          )}

          {tab === 'responsive' && (
            <div className="grid gap-4" style={{ gridTemplateColumns: cols }}>
              {VIEWPORTS.map(v => (
                <div key={v.w} className="min-w-0 space-y-2">
                  <div className="flex items-center justify-between"><b className="text-sm">{v.label}</b><Badge m={metrics[`r${v.w}`]} viewport={v.w} /></div>
                  <PreviewFrame frame={frames[0]} tokens={tokens} viewport={v.w} height={v.h} section={section} onMetrics={metricFns[`r${v.w}`]} title={`Responsive frame ${v.label}`} />
                </div>
              ))}
            </div>
          )}

          {tab === 'components' && <div className="border border-slate-300 bg-white"><ComponentLibrary tokens={tokens} /></div>}

          {tab === 'decisions' && (
            <div className="max-w-4xl space-y-6">
              <form className="space-y-3 border border-slate-300 bg-white p-4" onSubmit={e => { e.preventDefault(); record(); }}>
                <h2 className="text-sm font-bold">Record a decision from the frames now open</h2>
                <div className="grid grid-cols-2 gap-3">
                  <Select label="Section" value={note.section} options={VARIANT_OPTIONS.map(o => ({ value: o.key, label: o.label }))} onChange={v => setNote(n => ({ ...n, section: v }))} />
                  <Select label="Chosen frame" value={note.chosen} options={frames.map(f => ({ value: f.id, label: `Frame ${f.id}` }))} onChange={v => setNote(n => ({ ...n, chosen: v }))} />
                </div>
                <label className="block text-xs font-semibold text-slate-700">Reason
                  <textarea required value={note.reason} onChange={e => setNote(n => ({ ...n, reason: e.target.value }))} rows={3} className="mt-1 block w-full border border-slate-300 p-2 text-sm font-normal" /></label>
                <button type="submit" className="bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Record</button>
              </form>
              {[['Recorded in this browser', history], ['Reviewed record (decisions.ts)', DECISIONS]].map(([title, list]) => (
                <section key={title as string}>
                  <h2 className="mb-2 text-sm font-bold">{title as string}</h2>
                  {(list as Decision[]).length === 0 ? <p className="text-sm text-slate-600">None yet.</p> : (
                    <ol className="space-y-2">{(list as Decision[]).map((d, i) => (
                      <li key={i} className="border border-slate-300 bg-white p-3 text-sm">
                        <b>{d.section}</b> · {d.date} · chosen <b>{d.chosen}</b> <span className="text-slate-600">(compared {d.compared.join(', ')})</span>
                        <p className="mt-1 text-slate-700">{d.reason}</p>
                      </li>))}</ol>)}
                </section>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
