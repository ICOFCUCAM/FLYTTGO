/**
 * The FlyttGo Design Refinement Studio (/preview/lab; owner's 2036 mandates, 30 and 31 October 2026).
 * Private and isolated: it refuses to open on a production host, is linked from nowhere, carries
 * noindex, and changes nothing visitors see. It frames the real /preview/home (?lab=1) and drives
 * it through lab/probe.ts:
 *   Compare     A, B and C at one viewport, same content and assets, scrolled together; each frame has
 *               its own compositions and, when switched on, its own tokens (to test a typeface or a
 *               photograph grade as the only variable); promote a frame to a named version.
 *   Responsive  the active frame at five viewports, each inspected in the browser.
 *   Inspect     the full report for one frame: overflow, clipping, readability, contrast, grid
 *               collapse, cropping, buttons, navigation, gaps, tap targets, rhythm, repetition,
 *               consistency; every finding highlights its element; an interaction check clicks
 *               every demonstration control.
 *   Components  the shared pieces drawn with the trial tokens.
 *   Versions    named versions with notes, the approved one marked, before/after, restore, and the
 *               design specification as JSON or Markdown.
 *   Decisions   the visual decision log: alternatives, scores against six criteria, and reasons.
 * Everything is kept in this browser; nothing here changes design.config.ts, which stays the
 * source of the site's design until a reviewed code change adopts an approved version.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isProductionHost } from '../../../lib/hosts';
import {
  applyDesign, BASELINE_TOKENS, BASELINE_VARIANTS, COLOUR_CONTROLS, DEFAULT_TOKENS, DEFAULT_VARIANTS, FONT_CONTROLS, FONTS,
  googleFontsHref, RANGE_GROUPS, VARIANT_OPTIONS, type DesignTokens, type DesignVariants, type LabMessage,
} from '../design.config';
import { DECISIONS, type Decision } from './decisions';
import type { Issue, Report } from './probe';
import { download, specJson, specMarkdown, type Version } from './spec';
import '../design.v2.css';
import '../homeV2.css';

type Metrics = { width: number; height: number; issues: number; high: number; pageOverflow: boolean };
type FrameId = 'A' | 'B' | 'C';
type Frame = { id: FrameId; variants: DesignVariants; own: Partial<DesignTokens> | null };
type View = 'compare' | 'responsive' | 'inspect' | 'components' | 'versions' | 'decisions';
type Scores = Record<string, Record<string, number>>;
type Saved = { shared: DesignTokens; frames: Frame[]; viewport: number; versions: Version[]; approved: string; history: Decision[]; scores: Scores };

const VIEWPORTS = [{ w: 1680, h: 1000, label: 'Large desktop' }, { w: 1440, h: 900, label: 'Desktop' }, { w: 1280, h: 800, label: 'Laptop' },
                   { w: 820, h: 1180, label: 'Tablet' }, { w: 390, h: 844, label: 'Mobile' }];
const SECTIONS: [string, string][] = [['hero', 'Hero'], ['booking', 'Booking'], ['entry-points', 'Journeys'], ['marketplace', 'Marketplace'],
  ['moving-services', 'Moving'], ['business-workspace', 'Business workspace'], ['financial-administration', 'Financial workspace'],
  ['industry-experiences', 'Industries'], ['unified-platform', 'What connects underneath'], ['how-flyttgo-works', 'How it works'],
  ['business', 'Corporate'], ['driver-network', 'Providers'], ['white-label-builder', 'Marketplace Studio'],
  ['marketplace-network-experience', 'Trust'], ['final-cta', 'Closing']];
const CRITERIA = ['Brand identity', 'Clarity', 'Visual quality', 'Commercial effect', 'Responsiveness', 'Consistency'];
const KEY = 'flyttgo_design_studio';
const BASELINE: Version = { id: 'baseline', name: 'Baseline (#21)', at: '2026-10-31T00:00:00Z', tokens: BASELINE_TOKENS, variants: BASELINE_VARIANTS, note: 'The design merged in #21.' };
const SELECTED: Version = { id: 'selected', name: 'Selected in code (design.config.ts)', at: '2026-10-31T00:00:00Z', tokens: DEFAULT_TOKENS, variants: DEFAULT_VARIANTS, note: 'What /preview/home shows visitors now.' };

function load(): Saved {
  const fresh: Saved = { shared: DEFAULT_TOKENS, frames: [{ id: 'A', variants: DEFAULT_VARIANTS, own: null }], viewport: 1440,
    versions: [BASELINE, SELECTED], approved: 'selected', history: [], scores: {} };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (!s) return fresh;
    const fix = (v: Version): Version => ({ ...v, tokens: { ...DEFAULT_TOKENS, ...v.tokens }, variants: { ...DEFAULT_VARIANTS, ...v.variants } });
    const versions = (s.versions ?? []).filter(v => v.id !== 'baseline' && v.id !== 'selected').map(fix);
    return {
      shared: { ...DEFAULT_TOKENS, ...s.shared },
      frames: (s.frames?.length ? s.frames : fresh.frames).map(f => ({ id: f.id, own: f.own ?? null, variants: { ...DEFAULT_VARIANTS, ...f.variants } })),
      viewport: s.viewport ?? 1440, versions: [BASELINE, SELECTED, ...versions], approved: s.approved ?? 'selected',
      history: s.history ?? [], scores: s.scores ?? {},
    };
  } catch { return fresh; }
}

function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/* Each frame registers its window so the studio can send it commands. */
type Registry = Record<string, Window | null>;

function PreviewFrame({ fkey, tokens, variants, viewport, height, registry, onMessage, title }: {
  fkey: string; tokens: DesignTokens; variants: DesignVariants; viewport: number; height: number;
  registry: React.MutableRefObject<Registry>; onMessage: (key: string, data: { type: string } & Record<string, unknown>) => void; title: string;
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
    const msg: LabMessage = { type: 'flyttgo-design', tokens, variants };
    ref.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, [tokens, variants]);

  useEffect(() => {
    const reg = registry.current;
    const listen = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== ref.current?.contentWindow || !e.data?.type) return;
      if (e.data.type === 'flyttgo-ready') { reg[fkey] = ref.current?.contentWindow ?? null; setReady(true); send(); }
      onMessage(fkey, e.data);
    };
    window.addEventListener('message', listen);
    return () => { window.removeEventListener('message', listen); reg[fkey] = null; };
  }, [fkey, send, onMessage, registry]);
  useEffect(() => { if (ready) send(); }, [ready, send]);

  return (
    <div ref={box} className="w-full overflow-hidden border border-slate-300 bg-white" style={{ height: height * scale }}>
      <iframe ref={ref} title={title} src="/preview/home?lab=1" onLoad={() => setReady(false)}
        style={{ width: viewport, height, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0, display: 'block' }} />
    </div>
  );
}

function Badge({ m }: { m?: Metrics }) {
  if (!m) return <span className="text-xs text-slate-500">Rendering…</span>;
  const bad = m.high > 0 || m.pageOverflow;
  return (
    <span className={`inline-flex flex-wrap gap-x-3 text-xs font-semibold ${bad ? 'text-red-700' : m.issues ? 'text-amber-800' : 'text-emerald-800'}`}>
      <span>{bad ? '⚠ Harmed' : m.issues ? '• Findings' : '✓ Clean'}</span>
      <span>{m.high} serious · {m.issues} total</span>
      <span>page {Math.round(m.height).toLocaleString()}px</span>
    </span>
  );
}

function Select({ label, value, options, onChange, small }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; small?: boolean }) {
  return (
    <label className={`block ${small ? 'text-[11px]' : 'text-xs'} font-semibold text-slate-700`}>
      {label}
      <select className="mt-1 block w-full border border-slate-300 bg-white px-2 py-1 text-sm font-normal" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function IssueList({ report, onPick }: { report?: Report; onPick: (n: number) => void }) {
  if (!report) return <p className="text-sm text-slate-600">No report yet.</p>;
  if (!report.issues.length) return <p className="text-sm font-semibold text-emerald-800">No findings at {report.width}px.</p>;
  const groups = report.issues.reduce<Record<string, Issue[]>>((g, i) => { (g[i.kind] ??= []).push(i); return g; }, {});
  return (
    <div className="space-y-3">
      {Object.entries(groups).map(([kind, list]) => (
        <div key={kind}>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">{kind} · {list.length}</h4>
          <ul className="mt-1 space-y-1">{list.map(i => (
            <li key={i.n}><button type="button" onClick={() => onPick(i.n)} className="w-full text-left text-sm hover:bg-slate-100">
              <span className={`mr-2 inline-block w-14 text-xs font-bold ${i.severity === 'high' ? 'text-red-700' : i.severity === 'medium' ? 'text-amber-800' : 'text-slate-500'}`}>{i.severity}</span>
              <span className="text-slate-500">{i.section}</span> · {i.text}</button></li>))}</ul>
        </div>
      ))}
    </div>
  );
}

function RhythmMap({ report }: { report?: Report }) {
  if (!report) return null;
  return (
    <div className="flex h-10 w-full overflow-hidden border border-slate-300" aria-label="Page rhythm: each section's ground and height">
      {report.sections.map(s => <div key={s.id} title={`${s.label} · ${s.signature} · ${s.words} words`} style={{ flexGrow: s.height, background: s.ground }}
        className="border-r border-slate-300 last:border-r-0" />)}
    </div>
  );
}

function ComponentLibrary({ tokens }: { tokens: DesignTokens }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    applyDesign(ref.current, tokens, DEFAULT_VARIANTS);
    const href = googleFontsHref([tokens.fontDisplay, tokens.fontBody, tokens.fontAccent]);
    if (href && !document.querySelector(`link[href="${href}"]`)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
  }, [tokens]);
  const grounds: [string, string][] = [['white', tokens.white], ['paper', tokens.paper]];
  const texts: [string, string][] = [['ink', tokens.ink], ['blue', tokens.blue], ['forest', tokens.forest], ['muted', '#4a5260']];
  const box = { padding: 0, border: 0 } as const;
  return (
    <div ref={ref} className="fgv2" style={{ padding: 32 }}>
      <div style={{ display: 'grid', gap: 44 }}>
        <section style={box}>
          <span className="eyebrow">Typography · {tokens.fontDisplay} / {tokens.fontBody} / {tokens.fontAccent}</span>
          <h2 className="display" style={{ margin: '14px 0 10px' }}>Bookings, work and money.<br /><span className="serif">Recorded once.</span></h2>
          <p style={{ fontSize: 'var(--body-size)', lineHeight: 1.75, color: 'var(--muted)', maxWidth: 560 }}>Body text at the intro size. Find a service, run your company and grow a network on one platform.</p>
        </section>
        <section style={box}>
          <span className="eyebrow">Colour and contrast</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, marginTop: 16 }}>
            {grounds.flatMap(([g, gv]) => texts.map(([t, tv]) => {
              const r = contrast(tv, gv);
              return <div key={g + t} style={{ background: gv, color: tv, border: '1px solid var(--line)', padding: 14 }}><b style={{ display: 'block', fontSize: 15 }}>{t} on {g}</b><small style={{ fontSize: 13 }}>{r.toFixed(2)}:1 {r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : 'fails AA'}</small></div>;
            }))}
            <div style={{ background: tokens.blue, color: '#fff', padding: 14 }}><b style={{ display: 'block', fontSize: 15 }}>white on blue</b><small style={{ fontSize: 13 }}>{contrast('#ffffff', tokens.blue).toFixed(2)}:1</small></div>
            <div style={{ background: tokens.evergreen, color: '#fff', padding: 14 }}><b style={{ display: 'block', fontSize: 15 }}>white on evergreen</b><small style={{ fontSize: 13 }}>{contrast('#ffffff', tokens.evergreen).toFixed(2)}:1</small></div>
          </div>
        </section>
        <section style={{ ...box, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <a className="btn btn-primary" href="#lab">Primary action<span className="arrow">↗</span></a>
          <a className="btn btn-light" href="#lab">Secondary action<span className="arrow">↗</span></a>
          <span className="v2-chip v2-chip-ok">Paid</span><span className="v2-chip v2-chip-wait">Awaiting</span>
          <span className="v2-chip v2-chip-due">Overdue</span><span className="v2-chip v2-chip-info">In progress</span>
        </section>
        <section style={box}>
          <span className="eyebrow">Records table</span>
          <table className="v2-records" style={{ marginTop: 14, border: '1px solid var(--line)' }}><thead><tr><th>Time</th><th>Job</th><th>Customer</th><th>Status</th></tr></thead>
            <tbody><tr><td>08:00</td><td>Boiler inspection</td><td>O. Strand</td><td><span className="v2-chip v2-chip-info">In progress</span></td></tr>
              <tr><td>11:30</td><td>Water heater service</td><td>Hansen Eiendom AS</td><td><span className="v2-chip v2-chip-wait">Scheduled</span></td></tr></tbody></table>
        </section>
        <section style={box}>
          <span className="eyebrow">Job trail and transaction explorer</span>
          <div className="v2-trail" style={{ border: '1px solid var(--line)', marginTop: 14 }}>
            <b>Follow one job: leak repair for A. Berg</b>
            <ol>{['Enquiry', 'Booked', 'Completed', 'Invoice 1042'].map(s => <li key={s} className="v2-trail-ok"><span>{s}</span><small>Example</small></li>)}
              <li className="v2-trail-wait"><span>Payment</span><small>Awaiting · KID</small></li></ol>
          </div>
          <div style={{ padding: 24, border: '1px solid var(--line)', marginTop: 14, background: 'var(--white)' }}>
            <nav className="v2-explorer" aria-label="Example steps">{['Work completed', 'Invoice', 'Payment', 'Voucher', 'Financial record', 'Reporting'].map((s, i) =>
              <button key={s} type="button" aria-pressed={i === 3}><i>{i + 1}</i>{s}</button>)}</nav>
            <div className="v2-totals"><div><span>Debit = credit</span><b>NOK 3 412,50</b></div><div className="v2-total-final"><span>Example total</span><b>NOK 3 412,50</b></div></div>
          </div>
        </section>
        <section style={box}><div className="v2-related"><span>Related</span><a href="#lab">Related link →</a><a href="#lab">Another related link →</a></div></section>
      </div>
    </div>
  );
}

export default function DesignLab() {
  const blocked = typeof window !== 'undefined' && isProductionHost(window.location.hostname);
  const initial = useMemo(load, []);
  const [shared, setShared] = useState<DesignTokens>(initial.shared);
  const [frames, setFrames] = useState<Frame[]>(initial.frames);
  const [active, setActive] = useState<FrameId>('A');
  const [viewport, setViewport] = useState(initial.viewport);
  const [versions, setVersions] = useState<Version[]>(initial.versions);
  const [approved, setApproved] = useState(initial.approved);
  const [history, setHistory] = useState<Decision[]>(initial.history);
  const [scores, setScores] = useState<Scores>(initial.scores);
  const [view, setView] = useState<View>('compare');
  const [panel, setPanel] = useState('Colour');
  const [section, setSection] = useState('hero');
  const [sync, setSync] = useState(true);
  const [isolate, setIsolate] = useState(false);
  const [metrics, setMetrics] = useState<Record<string, Metrics>>({});
  const [reports, setReports] = useState<Record<string, Report>>({});
  const [interactions, setInteractions] = useState<{ label: string; section: string; ok: boolean }[] | null>(null);
  const [note, setNote] = useState({ category: 'composition', section: 'hero', chosen: 'A', reason: '' });
  const [vname, setVname] = useState('');
  const registry = useRef<Registry>({});

  useEffect(() => {
    const meta = document.createElement('meta'); meta.name = 'robots'; meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  useEffect(() => {
    const versionsToKeep = versions.filter(v => v.id !== 'baseline' && v.id !== 'selected');
    try { localStorage.setItem(KEY, JSON.stringify({ shared, frames, viewport, versions: versionsToKeep, approved, history, scores })); } catch { /* private mode */ }
  }, [shared, frames, viewport, versions, approved, history, scores]);

  const tokensOf = useCallback((f: Frame): DesignTokens => ({ ...shared, ...(f.own ?? {}) }), [shared]);
  const activeFrame = frames.find(f => f.id === active) ?? frames[0];
  const editing = activeFrame.own ? { ...shared, ...activeFrame.own } : shared;
  const setToken = (k: keyof DesignTokens, v: string | number) => {
    if (activeFrame.own) setFrames(fs => fs.map(f => f.id === activeFrame.id ? { ...f, own: { ...f.own, [k]: v } } : f));
    else setShared(t => ({ ...t, [k]: v }));
  };

  const broadcast = useCallback((msg: object, except?: string, prefix?: string) => {
    Object.entries(registry.current).forEach(([k, w]) => { if (w && k !== except && (!prefix || k.startsWith(prefix))) w.postMessage(msg, window.location.origin); });
  }, []);
  const onFrameMessage = useCallback((key: string, d: { type: string } & Record<string, unknown>) => {
    if (d.type === 'flyttgo-metrics') setMetrics(p => ({ ...p, [key]: d as unknown as Metrics }));
    if (d.type === 'flyttgo-report') setReports(p => ({ ...p, [key]: d as unknown as Report }));
    if (d.type === 'flyttgo-interact') setInteractions(d.results as { label: string; section: string; ok: boolean }[]);
    if (d.type === 'flyttgo-scrolled' && syncRef.current) broadcast({ type: 'flyttgo-scroll', id: d.id, frac: d.frac }, key, key[0] === 'r' ? 'r' : 'f');
  }, [broadcast]);
  const syncRef = useRef(sync); syncRef.current = sync;

  useEffect(() => { broadcast({ type: 'flyttgo-goto', id: section }); }, [section, broadcast, view]);
  useEffect(() => { broadcast({ type: 'flyttgo-isolate', id: isolate ? section : null }); }, [isolate, section, broadcast, view, metrics]);

  if (blocked) {
    return <main className="mx-auto max-w-xl p-12 text-slate-800"><h1 className="text-2xl font-bold">Not available here</h1><p className="mt-3">The design studio opens only on preview and development hosts.</p></main>;
  }

  const vp = VIEWPORTS.find(v => v.w === viewport) ?? VIEWPORTS[1];
  const setVariant = (id: FrameId, key: keyof DesignVariants, value: string) =>
    setFrames(fs => fs.map(f => f.id === id ? { ...f, variants: { ...f.variants, [key]: value } } : f));
  const addFrame = () => frames.length < 3 && setFrames(fs => { const last = fs[fs.length - 1]; return [...fs, { id: (['A', 'B', 'C'] as FrameId[])[fs.length], variants: { ...last.variants }, own: last.own ? { ...last.own } : null }]; });
  const removeFrame = () => { if (frames.length > 1) { setFrames(fs => fs.slice(0, -1)); setActive('A'); } };
  const promote = (f: Frame) => {
    const name = vname.trim() || `Frame ${f.id} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const v: Version = { id: `v${Date.now()}`, name, at: new Date().toISOString(), tokens: tokensOf(f), variants: f.variants, note: `Promoted from frame ${f.id}.`, from: approved };
    setVersions(vs => [...vs, v]); setApproved(v.id); setVname('');
  };
  const loadVersion = (v: Version, into: FrameId) => {
    setFrames(fs => {
      const next = [...fs];
      while (next.length < (['A', 'B', 'C'] as FrameId[]).indexOf(into) + 1) next.push({ id: (['A', 'B', 'C'] as FrameId[])[next.length], variants: v.variants, own: null });
      return next.map(f => f.id === into ? { ...f, variants: v.variants, own: { ...v.tokens } } : f);
    });
  };
  const beforeAfter = () => {
    const appr = versions.find(v => v.id === approved) ?? SELECTED;
    const prev = versions.find(v => v.id === appr.from) ?? BASELINE;
    setFrames([{ id: 'A', variants: prev.variants, own: { ...prev.tokens } }, { id: 'B', variants: appr.variants, own: { ...appr.tokens } }]);
    setView('compare');
  };
  const runReport = (key: string) => registry.current[key]?.postMessage({ type: 'flyttgo-report' }, window.location.origin);
  const record = () => {
    if (!note.reason.trim()) return;
    const key = note.section as keyof DesignVariants;
    const label = (f: Frame) => key in f.variants ? `${f.id}: ${VARIANT_OPTIONS.find(o => o.key === key)?.options.find(x => x.value === f.variants[key])?.label ?? f.variants[key]}` : `Frame ${f.id}`;
    const total = (id: string) => CRITERIA.reduce((n, c) => n + (scores[id]?.[c] ?? 0), 0);
    setHistory(h => [{ date: new Date().toISOString().slice(0, 10), category: note.category, section: note.section,
      compared: frames.map(f => `${label(f)} (score ${total(f.id)}/30)`), chosen: label(frames.find(f => f.id === note.chosen) ?? frames[0]), reason: note.reason.trim() }, ...h]);
    setNote(n => ({ ...n, reason: '' }));
  };
  const approvedVersion = versions.find(v => v.id === approved) ?? SELECTED;
  const allDecisions = [...history, ...DECISIONS];
  const views: [View, string][] = [['compare', 'Compare A/B/C'], ['responsive', 'Responsive'], ['inspect', 'Inspect'], ['components', 'Components'], ['versions', 'Versions'], ['decisions', 'Decisions']];
  const panels = ['Colour', 'Type', ...RANGE_GROUPS.map(g => g.title).filter(t => !t.includes('typography'))];
  const inspectKey = `i${active}`;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-300 bg-white px-5 py-3">
        <h1 className="text-base font-bold">FlyttGo Design Refinement Studio <span className="ml-2 border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">Private · preview only</span></h1>
        <nav className="flex flex-wrap gap-1" aria-label="Studio views">
          {views.map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}
            className={`px-3 py-1.5 text-sm font-semibold ${view === k ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>{l}</button>)}
        </nav>
        <span className="ml-auto text-xs text-slate-600">Approved: <b>{approvedVersion.name}</b></span>
        <a href="/preview/home" className="border border-slate-300 px-3 py-1.5 text-sm">Open preview</a>
      </header>

      <div className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-r border-slate-300 bg-white lg:h-[calc(100vh-57px)] lg:overflow-y-auto" aria-label="Design controls">
          <div className="border-b border-slate-200 p-4">
            <p className="text-xs text-slate-600">Editing <b>{activeFrame.own ? `frame ${activeFrame.id}'s own tokens` : 'tokens shared by every frame'}</b>.</p>
            <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
              <input type="checkbox" checked={!!activeFrame.own} onChange={e => setFrames(fs => fs.map(f => f.id === activeFrame.id ? { ...f, own: e.target.checked ? { ...shared } : null } : f))} />
              Frame {activeFrame.id} has its own tokens (to test one variable)
            </label>
            <div className="mt-3 flex flex-wrap gap-1">{panels.map(p => <button key={p} type="button" aria-pressed={panel === p} onClick={() => setPanel(p)}
              className={`px-2 py-1 text-xs font-semibold ${panel === p ? 'bg-slate-900 text-white' : 'border border-slate-300'}`}>{p}</button>)}</div>
          </div>
          <div className="space-y-3 p-4">
            {panel === 'Colour' && COLOUR_CONTROLS.map(c => (
              <label key={c.key} className="flex items-center gap-3 text-xs">
                <input type="color" value={String(editing[c.key])} onChange={e => setToken(c.key, e.target.value)} className="h-8 w-10 cursor-pointer border border-slate-300" />
                <span><b className="block font-mono">{String(editing[c.key])}</b>{c.label}</span>
              </label>))}
            {panel === 'Colour' && <button type="button" className="text-xs underline" onClick={() => COLOUR_CONTROLS.forEach(c => setToken(c.key, BASELINE_TOKENS[c.key]))}>Restore the approved palette</button>}
            {panel === 'Type' && <>
              {FONT_CONTROLS.map(f => <Select key={f.key} label={f.label} value={String(editing[f.key])} options={f.options.map(x => ({ value: x, label: x }))} onChange={v => setToken(f.key, v)} />)}
              {RANGE_GROUPS.filter(g => g.title.includes('typography')).map(g => <Ranges key={g.title} title={g.title} ranges={g.ranges} tokens={editing} set={setToken} />)}
            </>}
            {RANGE_GROUPS.filter(g => g.title === panel).map(g => <Ranges key={g.title} title={g.title} ranges={g.ranges} tokens={editing} set={setToken} />)}
          </div>
        </aside>

        <main className="min-w-0 p-5">
          {(view === 'compare' || view === 'responsive' || view === 'inspect') && (
            <div className="mb-4 flex flex-wrap items-end gap-3">
              {view !== 'responsive' && <div className="w-48"><Select label="Viewport" value={String(viewport)} options={VIEWPORTS.map(v => ({ value: String(v.w), label: `${v.label} ${v.w} × ${v.h}` }))} onChange={v => setViewport(Number(v))} /></div>}
              <div className="w-56"><Select label="Section" value={section} options={SECTIONS.map(([v, l]) => ({ value: v, label: l }))} onChange={setSection} /></div>
              <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={sync} onChange={e => setSync(e.target.checked)} />Scroll together</label>
              <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={isolate} onChange={e => setIsolate(e.target.checked)} />Isolate section (rest dimmed)</label>
              {view === 'compare' && <>
                <button type="button" onClick={addFrame} disabled={frames.length >= 3} className="border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40">Add frame</button>
                <button type="button" onClick={removeFrame} disabled={frames.length <= 1} className="border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40">Remove frame</button>
                <input value={vname} onChange={e => setVname(e.target.value)} placeholder="Version name" aria-label="Version name" className="w-44 border border-slate-300 px-2 py-1.5 text-sm" />
              </>}
            </div>
          )}

          {view === 'compare' && (
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${frames.length}, minmax(0, 1fr))` }}>
              {frames.map(f => (
                <div key={f.id} className={`min-w-0 space-y-2 p-2 ${active === f.id ? 'outline outline-2 outline-slate-900' : ''}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button type="button" onClick={() => setActive(f.id)} className="text-sm font-bold">Version {f.id}{f.own ? ' · own tokens' : ''}{active === f.id ? ' · editing' : ''}</button>
                    <Badge m={metrics[`f${f.id}`]} />
                  </div>
                  <details className="text-xs" open={frames.length === 1}>
                    <summary className="cursor-pointer font-semibold">Section compositions</summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-3">
                      {VARIANT_OPTIONS.map(o => <Select key={o.key} small label={o.label} value={f.variants[o.key]} options={o.options} onChange={v => { setVariant(f.id, o.key, v); if (o.section) setSection(o.section); }} />)}
                    </div>
                  </details>
                  <PreviewFrame fkey={`f${f.id}`} tokens={tokensOf(f)} variants={f.variants} viewport={vp.w} height={vp.h} registry={registry} onMessage={onFrameMessage} title={`Version ${f.id}`} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => promote(f)} className="bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Promote {f.id} as the approved version</button>
                    <button type="button" onClick={() => { setActive(f.id); setView('inspect'); }} className="border border-slate-300 bg-white px-3 py-1.5 text-xs">Inspect {f.id}</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {view === 'responsive' && (
            <div className="grid gap-4 xl:grid-cols-3 md:grid-cols-2">
              {VIEWPORTS.map(v => (
                <div key={v.w} className="min-w-0 space-y-2">
                  <div className="flex items-center justify-between"><b className="text-sm">{v.label} {v.w}</b><Badge m={metrics[`r${v.w}`]} /></div>
                  <PreviewFrame fkey={`r${v.w}`} tokens={tokensOf(activeFrame)} variants={activeFrame.variants} viewport={v.w} height={v.h} registry={registry} onMessage={onFrameMessage} title={`${v.label} ${v.w}`} />
                  <details className="text-xs" onToggle={e => { if ((e.target as HTMLDetailsElement).open) runReport(`r${v.w}`); }}>
                    <summary className="cursor-pointer font-semibold">Findings at {v.w}px</summary>
                    <div className="mt-2"><IssueList report={reports[`r${v.w}`]} onPick={n => registry.current[`r${v.w}`]?.postMessage({ type: 'flyttgo-highlight', n }, window.location.origin)} /></div>
                  </details>
                </div>
              ))}
            </div>
          )}

          {view === 'inspect' && (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
              <div className="min-w-0 space-y-2">
                <div className="flex items-center justify-between"><b className="text-sm">Version {activeFrame.id} at {vp.w}px</b><Badge m={metrics[inspectKey]} /></div>
                <PreviewFrame fkey={inspectKey} tokens={tokensOf(activeFrame)} variants={activeFrame.variants} viewport={vp.w} height={vp.h} registry={registry} onMessage={onFrameMessage} title="Inspected version" />
              </div>
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => runReport(inspectKey)} className="bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white">Inspect the rendered page</button>
                  <button type="button" onClick={() => { setInteractions(null); registry.current[inspectKey]?.postMessage({ type: 'flyttgo-interact' }, window.location.origin); }} className="border border-slate-300 bg-white px-3 py-1.5 text-sm">Run the interaction check</button>
                </div>
                <section><h3 className="mb-1 text-sm font-bold">Page rhythm</h3><RhythmMap report={reports[inspectKey]} />
                  {reports[inspectKey] && <p className="mt-1 text-xs text-slate-600">{reports[inspectKey].buttons} button styles · {reports[inspectKey].eyebrows} label styles · {reports[inspectKey].sections.length} sections</p>}</section>
                <section><h3 className="mb-1 text-sm font-bold">Findings</h3><IssueList report={reports[inspectKey]} onPick={n => registry.current[inspectKey]?.postMessage({ type: 'flyttgo-highlight', n }, window.location.origin)} /></section>
                {interactions && <section><h3 className="mb-1 text-sm font-bold">Interaction check · {interactions.filter(i => i.ok).length} of {interactions.length} controls respond</h3>
                  <ul className="max-h-72 space-y-0.5 overflow-auto text-xs">{interactions.map((i, n) => <li key={n} className={i.ok ? 'text-slate-600' : 'font-bold text-red-700'}>{i.ok ? '✓' : '✗ does nothing:'} {i.label} <span className="text-slate-400">· {i.section}</span></li>)}</ul></section>}
                <p className="text-xs text-slate-600">Findings come from the browser's rendering of this frame. They do not replace looking at the page, keyboard testing or testing on real devices.</p>
              </div>
            </div>
          )}

          {view === 'components' && <div className="border border-slate-300 bg-white"><ComponentLibrary tokens={editing} /></div>}

          {view === 'versions' && (
            <div className="max-w-5xl space-y-4">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={beforeAfter} className="bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white">Before and after: previous approved vs approved</button>
                <button type="button" onClick={() => download('flyttgo-design-spec.json', JSON.stringify(specJson(approvedVersion, allDecisions), null, 2), 'application/json')} className="border border-slate-300 bg-white px-3 py-1.5 text-sm">Export approved spec (JSON)</button>
                <button type="button" onClick={() => download('flyttgo-design-spec.md', specMarkdown(approvedVersion, allDecisions), 'text/markdown')} className="border border-slate-300 bg-white px-3 py-1.5 text-sm">Export approved spec (Markdown)</button>
              </div>
              <ol className="space-y-2">{[...versions].reverse().map(v => (
                <li key={v.id} className={`border bg-white p-3 text-sm ${v.id === approved ? 'border-emerald-700' : 'border-slate-300'}`}>
                  <div className="flex flex-wrap items-baseline gap-x-3"><b>{v.name}</b>{v.id === approved && <span className="text-xs font-bold text-emerald-800">APPROVED</span>}<span className="text-xs text-slate-500">{v.at.slice(0, 16).replace('T', ' ')}</span></div>
                  <textarea aria-label={`Note for ${v.name}`} value={v.note} disabled={v.id === 'baseline' || v.id === 'selected'} onChange={e => setVersions(vs => vs.map(x => x.id === v.id ? { ...x, note: e.target.value } : x))} rows={2} className="mt-2 w-full border border-slate-200 p-2 text-sm" />
                  <p className="mt-1 text-xs text-slate-600">{FONTS[v.tokens.fontDisplay] ? `${v.tokens.fontDisplay} / ${v.tokens.fontBody} / ${v.tokens.fontAccent}` : ''} · hero {v.variants.hero.toUpperCase()} · headline {v.variants.headline.toUpperCase()} · grounds {v.variants.grounds}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {(['A', 'B', 'C'] as FrameId[]).map(id => <button key={id} type="button" onClick={() => { loadVersion(v, id); setView('compare'); }} className="border border-slate-300 px-2 py-1">Load into {id}</button>)}
                    {v.id !== approved && <button type="button" onClick={() => setApproved(v.id)} className="border border-slate-300 px-2 py-1">Restore as approved</button>}
                  </div>
                </li>))}</ol>
              <p className="text-xs text-slate-600">Versions live in this browser. Promoting or restoring never changes the site; adopting a version is a reviewed change to design.config.ts using the exported specification.</p>
            </div>
          )}

          {view === 'decisions' && (
            <div className="max-w-5xl space-y-6">
              <section className="border border-slate-300 bg-white p-4">
                <h2 className="text-sm font-bold">Score the open versions</h2>
                <table className="mt-2 w-full text-sm"><thead><tr><th className="text-left">Criterion</th>{frames.map(f => <th key={f.id}>Version {f.id}</th>)}</tr></thead>
                  <tbody>{CRITERIA.map(c => <tr key={c}><td className="py-1">{c}</td>{frames.map(f => <td key={f.id} className="text-center">
                    <select aria-label={`${c}, version ${f.id}`} value={scores[f.id]?.[c] ?? 0} onChange={e => setScores(s => ({ ...s, [f.id]: { ...s[f.id], [c]: Number(e.target.value) } }))} className="border border-slate-300 px-1">
                      {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n || '–'}</option>)}</select></td>)}</tr>)}
                    <tr className="font-bold"><td>Total</td>{frames.map(f => <td key={f.id} className="text-center">{CRITERIA.reduce((n, c) => n + (scores[f.id]?.[c] ?? 0), 0)} / 30</td>)}</tr>
                    <tr className="text-xs text-slate-600"><td>Browser findings</td>{frames.map(f => <td key={f.id} className="text-center">{metrics[`f${f.id}`] ? `${metrics[`f${f.id}`].high} serious · ${metrics[`f${f.id}`].issues}` : '–'}</td>)}</tr></tbody></table>
              </section>
              <form className="space-y-3 border border-slate-300 bg-white p-4" onSubmit={e => { e.preventDefault(); record(); }}>
                <h2 className="text-sm font-bold">Record a decision</h2>
                <div className="grid grid-cols-3 gap-3">
                  <Select label="Kind of choice" value={note.category} options={['hero', 'headline', 'typography', 'photograph', 'composition', 'interaction', 'tokens'].map(x => ({ value: x, label: x }))} onChange={v => setNote(n => ({ ...n, category: v }))} />
                  <Select label="Section or setting" value={note.section} options={[...VARIANT_OPTIONS.map(o => ({ value: o.key, label: o.label })), { value: 'fonts', label: 'Typefaces' }, { value: 'tokens', label: 'Tokens' }]} onChange={v => setNote(n => ({ ...n, section: v }))} />
                  <Select label="Chosen version" value={note.chosen} options={frames.map(f => ({ value: f.id, label: `Version ${f.id}` }))} onChange={v => setNote(n => ({ ...n, chosen: v }))} />
                </div>
                <label className="block text-xs font-semibold text-slate-700">Why the chosen version is stronger than the alternatives
                  <textarea required value={note.reason} onChange={e => setNote(n => ({ ...n, reason: e.target.value }))} rows={3} className="mt-1 block w-full border border-slate-300 p-2 text-sm font-normal" /></label>
                <button type="submit" className="bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Record</button>
              </form>
              {([['Recorded in this browser', history], ['Reviewed log (lab/decisions.ts)', DECISIONS]] as [string, Decision[]][]).map(([title, list]) => (
                <section key={title}>
                  <h2 className="mb-2 text-sm font-bold">{title}</h2>
                  {list.length === 0 ? <p className="text-sm text-slate-600">None yet.</p> : (
                    <ol className="space-y-2">{list.map((d, i) => (
                      <li key={i} className="border border-slate-300 bg-white p-3 text-sm">
                        <b>{d.section}</b> · {d.category ?? 'composition'} · {d.date} · chosen <b>{d.chosen}</b>
                        <p className="text-xs text-slate-600">Considered: {d.compared.join(' · ')}</p>
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

function Ranges({ title, ranges, tokens, set }: { title: string; ranges: typeof RANGE_GROUPS[number]['ranges']; tokens: DesignTokens; set: (k: keyof DesignTokens, v: number) => void }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-600">{title}</h3>
      <div className="space-y-3">{ranges.map(r => (
        <label key={r.key} className="block text-xs">
          <span className="flex justify-between font-semibold"><span>{r.label}</span><span className="font-mono">{String(tokens[r.key])}{r.unit ?? ''}</span></span>
          <input type="range" min={r.min} max={r.max} step={r.step} value={Number(tokens[r.key])} className="w-full" onChange={e => set(r.key, Number(e.target.value))} />
        </label>))}</div>
    </div>
  );
}
