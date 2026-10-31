/**
 * The preview's side of the Design Refinement Studio. Loaded only when /preview/home is framed by
 * the studio on a non-production host (HomeV2Page), never for visitors. It applies trial settings,
 * loads trial typefaces, keeps frames scrolled together, isolates a section, and inspects the
 * rendered page in the browser: overflow, clipped content, readability, contrast, grid collapse,
 * image cropping, button placement, navigation, vertical gaps, tap targets, repetition, rhythm and
 * component consistency. It also clicks every demonstration control to find ones that do nothing.
 * Every finding is about what the browser rendered; nothing is estimated.
 */
import { applyDesign, googleFontsHref, isLabMessage } from '../design.config';

export type Issue = { n: number; kind: string; section: string; text: string; severity: 'high' | 'medium' | 'low' };
export type SectionInfo = { id: string; label: string; top: number; height: number; ground: string; dark: boolean; signature: string; words: number };
export type Report = {
  type: 'flyttgo-report'; width: number; height: number; issues: Issue[]; sections: SectionInfo[];
  buttons: number; eyebrows: number; pageOverflow: boolean;
};

const origin = () => window.location.origin;
const post = (msg: object) => window.parent.postMessage(msg, origin());

const rgb = (c: string) => { const m = c.match(/[\d.]+/g); return m ? m.slice(0, 4).map(Number) : null; };
const lum = (c: number[]) => {
  const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* The solid ground behind an element, or null over a picture or gradient. */
function groundOf(el: Element | null): number[] | null {
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.backgroundImage !== 'none') return null;
    const c = rgb(s.backgroundColor);
    if (c && (c[3] ?? 1) > 0.9) return c;
    if (e.parentElement && [...e.parentElement.children].some(k => k !== e && k.tagName === 'IMG') && s.position === 'absolute') return null;
  }
  return [255, 255, 255];
}

const ownText = (n: Element) => [...n.childNodes].some(c => c.nodeType === 3 && (c.textContent ?? '').trim().length > 1);
const visible = (n: Element) => { const r = n.getBoundingClientRect(); const s = getComputedStyle(n); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; };

function sectionOf(n: Element) {
  const s = n.closest('main > section, main > .v2-booking') as HTMLElement | null;
  return s?.id || (s?.classList.contains('hero') ? 'hero' : s?.className.split(' ')[0]) || 'page';
}
function sectionLabel(s: HTMLElement) {
  return (s.querySelector('h1, h2')?.textContent ?? s.id).replace(/\s+/g, ' ').trim().slice(0, 48);
}

function clippedByScroller(n: Element, vw: number) {
  for (let p = n.parentElement; p && !p.classList.contains('fgv2'); p = p.parentElement) {
    const o = getComputedStyle(p).overflowX;
    if (o !== 'visible' && p.getBoundingClientRect().right <= vw + 1) return true;
  }
  return getComputedStyle(n).position === 'fixed';
}

export function inspect(root: HTMLElement): Report {
  root.querySelectorAll('[data-v2-issue]').forEach(n => n.removeAttribute('data-v2-issue'));
  const vw = document.documentElement.clientWidth, vh = window.innerHeight, mobile = vw <= 820;
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const add = (el: Element, kind: string, text: string, severity: Issue['severity']) => {
    const section = sectionOf(el), key = kind + section + text;
    if (seen.has(key) || issues.filter(i => i.kind === kind && i.section === section).length >= 6) return;
    seen.add(key);
    const n = issues.length + 1;
    (el as HTMLElement).setAttribute('data-v2-issue', String(n));
    issues.push({ n, kind, section, text, severity });
  };
  const all = [...root.querySelectorAll<HTMLElement>('*')].filter(visible);

  for (const el of all) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (r.right > vw + 1 && !clippedByScroller(el, vw)) add(el, 'Overflow', `${el.tagName.toLowerCase()}.${el.classList[0] ?? ''} runs ${Math.round(r.right - vw)}px past the edge`, 'high');
    const textual = ownText(el);
    if ((s.overflow === 'hidden' || s.overflowX === 'hidden' || s.overflowY === 'hidden' || s.textOverflow === 'ellipsis') && textual
        && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 4)) add(el, 'Clipped content', `“${el.textContent!.trim().slice(0, 40)}” is cut off`, 'high');
    if (!textual) continue;
    const own = (el.textContent ?? '').trim();
    const size = parseFloat(s.fontSize), upper = s.textTransform === 'uppercase' || (own.length > 2 && own === own.toUpperCase() && /[A-ZÆØÅ]/.test(own));
    if (size < (upper ? 11 : 12)) add(el, 'Readability', `${size}px text: “${el.textContent!.trim().slice(0, 36)}”`, 'medium');
    if (el.tagName === 'P' && r.width / (size * 0.5) > 90) add(el, 'Readability', `line of about ${Math.round(r.width / (size * 0.5))} characters`, 'low');
    const fg = rgb(s.color), bg = groundOf(el);
    if (fg && bg) {
      const need = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700) ? 3 : 4.5;
      const c = ratio(fg, bg);
      if (c < need) add(el, 'Contrast', `${c.toFixed(2)}:1 for “${el.textContent!.trim().slice(0, 30)}” (needs ${need}:1)`, 'high');
    }
    if (/^(P|H3|H4|LI|SPAN|B|STRONG)$/.test(el.tagName) && r.width < 120 && (el.textContent ?? '').trim().length > 30 && !upper)
      add(el, 'Grid collapse', `text squeezed to ${Math.round(r.width)}px: “${el.textContent!.trim().slice(0, 30)}”`, 'medium');
  }

  root.querySelectorAll<HTMLImageElement>('img').forEach(img => {
    if (!visible(img) || !img.naturalWidth) return;
    const r = img.getBoundingClientRect();
    const crop = (r.width / r.height) / (img.naturalWidth / img.naturalHeight);
    if (crop > 2.2 || crop < 1 / 2.2) add(img, 'Image cropping', `“${img.alt || 'picture'}” shows about ${Math.round(100 / Math.max(crop, 1 / crop))}% of the photograph`, 'medium');
  });

  const btns = [...root.querySelectorAll<HTMLElement>('.btn, button, .v2-trail-go')].filter(visible);
  btns.forEach((b, i) => {
    const r = b.getBoundingClientRect();
    if (r.left < -1 || r.right > vw + 1) add(b, 'Button placement', `“${b.textContent!.trim().slice(0, 30)}” is outside the viewport`, 'high');
    for (const o of btns.slice(i + 1)) {
      const q = o.getBoundingClientRect();
      if (b.contains(o) || o.contains(b)) continue;
      if (r.left < q.right - 2 && q.left < r.right - 2 && r.top < q.bottom - 2 && q.top < r.bottom - 2) { add(b, 'Button placement', `“${b.textContent!.trim().slice(0, 24)}” overlaps “${o.textContent!.trim().slice(0, 24)}”`, 'high'); break; }
    }
  });

  if (mobile) {
    root.querySelectorAll<HTMLElement>('a, button, input, select, [role="link"]').forEach(t => {
      if (!visible(t) || t.closest('p, li, small, .v2-related')) return;
      const r = t.getBoundingClientRect();
      if (r.height < 40 || r.width < 40) add(t, 'Tap target', `“${(t.textContent || t.getAttribute('aria-label') || t.tagName).trim().slice(0, 30)}” is ${Math.round(r.width)}×${Math.round(r.height)}px (40×40 minimum)`, 'medium');
    });
  }

  const header = document.querySelector('header');
  if (header) {
    const h = header.getBoundingClientRect().height;
    const tops = new Set([...header.querySelectorAll('nav a, nav button')].filter(visible).map(n => Math.round(n.getBoundingClientRect().top / 8)));
    if (h > 140) issues.push({ n: issues.length + 1, kind: 'Navigation', section: 'header', text: `header is ${Math.round(h)}px tall`, severity: 'medium' });
    if (tops.size > 2) issues.push({ n: issues.length + 1, kind: 'Navigation', section: 'header', text: 'menu items wrap onto more than one line', severity: 'medium' });
  }

  const sections = [...root.querySelectorAll<HTMLElement>('main > section, main > .v2-booking')];
  const info: SectionInfo[] = sections.map(sec => {
    const r = sec.getBoundingClientRect(), bg = rgb(getComputedStyle(sec).backgroundColor) ?? [255, 255, 255];
    const dark = lum(bg) < 0.2;
    const wrap = sec.querySelector(':scope > .wrap, :scope > div') as HTMLElement | null;
    const blocks = wrap ? [...wrap.children].filter(visible) as HTMLElement[] : [];
    for (let i = 1; i < blocks.length; i++) {
      const gap = blocks[i].getBoundingClientRect().top - blocks[i - 1].getBoundingClientRect().bottom;
      if (gap > Math.max(200, vh * 0.3)) add(blocks[i], 'Vertical gap', `${Math.round(gap)}px of empty space`, 'medium');
    }
    const cols = wrap ? getComputedStyle(blocks.find(b => getComputedStyle(b).display === 'grid') ?? wrap).gridTemplateColumns.split(' ').filter(Boolean).length : 1;
    const hasImg = !!sec.querySelector('img');
    const frame = !!sec.querySelector('.bw-frame, .finance-frame, .ecosystem-frame, .wl-builder, .network-panel, .dashboard, .industry-panel');
    const words = (sec.innerText || '').split(/\s+/).filter(Boolean).length;
    return { id: sec.id || 'hero', label: sectionLabel(sec), top: r.top + scrollY, height: r.height,
      ground: `rgb(${bg.slice(0, 3).join(',')})`, dark, signature: `${dark ? 'dark' : 'light'}-${hasImg ? 'img' : 'noimg'}-${frame ? 'frame' : 'open'}-${cols}`, words };
  });
  for (let i = 2; i < info.length; i++) {
    if (info[i].signature === info[i - 1].signature && info[i].signature === info[i - 2].signature)
      issues.push({ n: issues.length + 1, kind: 'Rhythm', section: info[i].id, text: `three sections in a row with the same composition (${info[i - 2].label} → ${info[i].label})`, severity: 'low' });
  }
  for (let i = 1; i < info.length; i++) if (info[i].dark && info[i - 1].dark)
    issues.push({ n: issues.length + 1, kind: 'Rhythm', section: info[i].id, text: `two dark sections in a row (${info[i - 1].label} → ${info[i].label})`, severity: 'medium' });
  info.forEach(s => { if (s.words > 420) issues.push({ n: issues.length + 1, kind: 'Excessive text', section: s.id, text: `${s.words} words in “${s.label}”`, severity: 'low' }); });

  const heads = [...root.querySelectorAll('h1, h2, .eyebrow')].filter(visible).map(h => h.textContent!.toLowerCase());
  const platform = heads.filter(h => /\bplatform\b/.test(h));
  if (platform.length > 2) issues.push({ n: issues.length + 1, kind: 'Repetition', section: 'page', text: `“platform” appears in ${platform.length} headings and labels`, severity: 'low' });

  const styleKey = (b: Element) => { const s = getComputedStyle(b); return [s.fontSize, s.fontWeight, s.borderRadius, Math.round(b.getBoundingClientRect().height / 4) * 4, s.fontFamily.split(',')[0]].join('|'); };
  const btnStyles = new Set(btns.filter(b => b.classList.contains('btn')).map(styleKey));
  const eyebrowStyles = new Set([...root.querySelectorAll('.eyebrow')].filter(visible).map(styleKey));
  if (btnStyles.size > 4) issues.push({ n: issues.length + 1, kind: 'Consistency', section: 'page', text: `${btnStyles.size} different button styles (4 or fewer expected)`, severity: 'low' });
  if (eyebrowStyles.size > 3) issues.push({ n: issues.length + 1, kind: 'Consistency', section: 'page', text: `${eyebrowStyles.size} different label styles`, severity: 'low' });
  const pads = new Set(sections.filter(s => !s.classList.contains('hero')).map(s => getComputedStyle(s).paddingTop));
  if (pads.size > 3) issues.push({ n: issues.length + 1, kind: 'Consistency', section: 'page', text: `${pads.size} different section spacings`, severity: 'low' });

  return { type: 'flyttgo-report', width: vw, height: root.scrollHeight, issues, sections: info,
    buttons: btnStyles.size, eyebrows: eyebrowStyles.size, pageOverflow: document.documentElement.scrollWidth > vw };
}

/* Clicks every demonstration control and reports those that change nothing on the page. */
async function interact(root: HTMLElement) {
  const controls = [...root.querySelectorAll<HTMLElement>('button, select, [role="tab"]')]
    .filter(c => visible(c) && !c.closest('[data-slot="booking"], header') && !c.dataset.page && (c as HTMLButtonElement).type !== 'submit');
  const results: { label: string; section: string; ok: boolean }[] = [];
  const fingerprint = (c: HTMLElement) => `${c.tagName}|${c.className}|${(c.textContent ?? '').trim()}|${c.id}`;
  for (const original of controls) {
    /* A control a previous click re-rendered is clicked in its current form, found by its fingerprint. */
    const key = fingerprint(original);
    const c = original.isConnected ? original
      : [...root.querySelectorAll<HTMLElement>(original.tagName)].find(n => fingerprint(n) === key);
    if (!c) continue;
    let changes = 0;
    const scope = root;  /* a control may change another section (“See it in finance”) */
    const mo = new MutationObserver(m => { changes += m.length; });
    mo.observe(scope, { subtree: true, childList: true, attributes: true, characterData: true });
    const y = scrollY;
    if (c instanceof HTMLSelectElement) {
      const was = c.selectedIndex;
      c.selectedIndex = (was + 1) % c.options.length; c.dispatchEvent(new Event('change', { bubbles: true })); c.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 80));
      c.selectedIndex = was; c.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      c.click();
    }
    await new Promise(r => setTimeout(r, 80));
    mo.disconnect();
    scrollTo(0, y);
    const label = (c.getAttribute('aria-label') || c.textContent || c.id || c.tagName).replace(/\s+/g, ' ').trim().slice(0, 40);
    results.push({ label, section: sectionOf(c), ok: changes > 0 });
  }
  return results;
}

/* The section at the top of the viewport and how far into it, so frames of different heights align. */
function position(root: HTMLElement) {
  const secs = [...root.querySelectorAll<HTMLElement>('main > section, main > .v2-booking')];
  const top = secs.find(s => s.getBoundingClientRect().bottom > 80) ?? secs[0];
  const r = top.getBoundingClientRect();
  return { id: top.id || 'hero', frac: Math.min(1, Math.max(0, (80 - r.top) / r.height)) };
}
function scrollToPosition(root: HTMLElement, id: string, frac: number) {
  const sec = id === 'hero' ? root.querySelector<HTMLElement>('main > section.hero') : root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  if (sec) scrollTo(0, sec.getBoundingClientRect().top + scrollY - 80 + sec.offsetHeight * frac);
}

export function installProbe(root: HTMLElement) {
  const style = document.createElement('style');
  style.textContent = `.v2-isolate main > :not(.v2-isolated){opacity:.16;filter:grayscale(1);transition:opacity .3s}
  [data-v2-flash]{outline:3px solid #c0392b!important;outline-offset:2px;box-shadow:0 0 0 9999px rgb(0 0 0 / .18)!important}`;
  document.head.appendChild(style);
  let remote = false, raf = 0;
  const fonts = new Set<string>();

  const onMessage = async (e: MessageEvent) => {
    if (e.origin !== origin() || e.source !== window.parent) return;
    const d = e.data;
    if (isLabMessage(d)) {
      const href = googleFontsHref([d.tokens.fontDisplay, d.tokens.fontBody, d.tokens.fontAccent]);
      if (href && !fonts.has(href)) {
        fonts.add(href);
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
      }
      applyDesign(root, d.tokens, d.variants);
      if (d.variants.motion === 'off') root.querySelectorAll('.v2-reveal').forEach(n => n.classList.add('v2-in'));
      await document.fonts?.ready;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const r = inspect(root);
        post({ type: 'flyttgo-metrics', width: r.width, height: r.height, issues: r.issues.length, high: r.issues.filter(i => i.severity === 'high').length, pageOverflow: r.pageOverflow });
      }));
    } else if (d?.type === 'flyttgo-scroll') {
      remote = true; scrollToPosition(root, d.id, d.frac); setTimeout(() => { remote = false; }, 120);
    } else if (d?.type === 'flyttgo-goto') {
      remote = true; scrollToPosition(root, d.id || 'hero', 0); setTimeout(() => { remote = false; }, 120);
    } else if (d?.type === 'flyttgo-isolate') {
      root.classList.toggle('v2-isolate', !!d.id);
      root.querySelectorAll('.v2-isolated').forEach(n => n.classList.remove('v2-isolated'));
      if (d.id) {
        const sec = d.id === 'hero' ? root.querySelector('main > section.hero') : root.querySelector(`#${CSS.escape(d.id)}`);
        sec?.classList.add('v2-isolated');
        root.querySelectorAll('.v2-reveal').forEach(n => n.classList.add('v2-in'));
      }
    } else if (d?.type === 'flyttgo-report') {
      root.querySelectorAll('.v2-reveal').forEach(n => n.classList.add('v2-in'));
      post(inspect(root));
    } else if (d?.type === 'flyttgo-highlight') {
      root.querySelectorAll('[data-v2-flash]').forEach(n => n.removeAttribute('data-v2-flash'));
      const el = root.querySelector<HTMLElement>(`[data-v2-issue="${d.n}"]`);
      if (el) { el.setAttribute('data-v2-flash', ''); el.scrollIntoView({ block: 'center' }); setTimeout(() => el.removeAttribute('data-v2-flash'), 2400); }
    } else if (d?.type === 'flyttgo-interact') {
      post({ type: 'flyttgo-interact', results: await interact(root) });
    }
  };
  const onScroll = () => {
    if (remote) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => post({ type: 'flyttgo-scrolled', ...position(root) }));
  };
  window.addEventListener('message', onMessage);
  window.addEventListener('scroll', onScroll, { passive: true });
  post({ type: 'flyttgo-ready' });
  return () => { window.removeEventListener('message', onMessage); window.removeEventListener('scroll', onScroll); style.remove(); };
}
