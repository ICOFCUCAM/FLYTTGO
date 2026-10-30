/**
 * The live miniature's rules (TemplateThumb.tsx), as pure functions so the
 * tests read the same rules: what to draw, and what the box shows.
 */
import type { RenderImages } from '../../../supabase/functions/_shared/site-template';

/**
 * The page and images to draw, or why not: no home page, or (when the
 * images were asked for) no images; the page is then never drawn with the
 * template's assets instead.
 */
export async function thumbSource(home: Promise<{ html: string } | null>, images: Promise<RenderImages | null>, lazy: boolean)
  : Promise<{ html: string; images: RenderImages | null } | null> {
  const [h, i] = await Promise.all([home.catch(() => null), images.catch(() => null)]);
  return !h || (lazy && !i) ? null : { html: h.html, images: i };
}

/** What the box shows: the page, the fallback asked for, a cover photo (not for asked-for images), or the loading shimmer. */
export function thumbFace(s: { drawn: boolean; failed: boolean; fallback: boolean; cover: boolean; lazy: boolean }): 'page' | 'fallback' | 'cover' | 'loading' {
  if (s.drawn) return 'page';
  if (s.failed && s.fallback) return 'fallback';
  if (s.failed && s.cover && !s.lazy) return 'cover';
  return 'loading';
}
