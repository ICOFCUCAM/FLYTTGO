/**
 * A full-screen dialog's keyboard rules: focus moves into it when it opens
 * (to the element marked `data-autofocus`, else the first control), Tab and
 * Shift+Tab stay inside it, Escape closes it, the page behind does not
 * scroll, and focus returns to where it was when it closes. The listeners
 * sit on the dialog itself, so a dialog opened above another (the preview
 * above the gallery) handles its own keys and Escape closes only the top one.
 */
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])';

export function useDialog(ref: RefObject<HTMLElement>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter(x => x.getClientRects().length > 0 && !x.closest('[inert],[aria-hidden="true"]'));
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0] ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const f = focusable();
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === first || !el.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !el.contains(at))) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (before && document.contains(before)) before.focus();
    };
  }, [ref]);
}
