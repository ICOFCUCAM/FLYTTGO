/**
 * The booking widget's side inside the frame (docs/WHITE_LABEL.md →
 * Booking widget). public/widget.js frames /embed/<slug>; EmbedPage checks
 * which website framed it and, if the company listed it, records the
 * embedded visit here for the tab. While embedded the app drops its header
 * and footer, tells the parent its height, and opens payment in a new tab
 * (payment providers refuse to run inside frames).
 */
import { useEffect } from 'react';
import { WIDGET_RESIZE_MESSAGE } from '../../supabase/functions/_shared/widget';

const KEY = 'flyttgo.embed';
interface EmbedVisit { slug: string; parent: string }
let memory: EmbedVisit | null = null;

const framed = () => typeof window !== 'undefined' && window.self !== window.top;

/** Called by EmbedPage once the parent website is known to be allowed. */
export function startEmbed(visit: EmbedVisit): void {
  memory = visit;
  try { sessionStorage.setItem(KEY, JSON.stringify(visit)); } catch { /* storage blocked in the frame */ }
  document.documentElement.classList.add('flyttgo-embedded');
}

export function embedVisit(): EmbedVisit | null {
  if (!framed()) return null;
  if (memory) return memory;
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as EmbedVisit | null;
    if (v && typeof v.slug === 'string' && typeof v.parent === 'string') { memory = v; return v; }
  } catch { /* none */ }
  return null;
}

/** True inside the widget's frame on an allowed website. */
export function isEmbedded(): boolean {
  return embedVisit() !== null;
}

/** Keeps the parent's frame as tall as the page (only to the allowed parent). */
export function useEmbedResize(active: boolean): void {
  useEffect(() => {
    const visit = active ? embedVisit() : null;
    if (!visit) return;
    document.documentElement.classList.add('flyttgo-embedded');
    let last = 0;
    const send = () => {
      const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
      if (h === last) return;
      last = h;
      window.parent.postMessage({ type: WIDGET_RESIZE_MESSAGE, height: h }, visit.parent);
    };
    send();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(send) : null;
    ro?.observe(document.body);
    const t = window.setInterval(send, 1000);           // images and fonts that load late
    return () => { ro?.disconnect(); window.clearInterval(t); };
  }, [active]);
}
