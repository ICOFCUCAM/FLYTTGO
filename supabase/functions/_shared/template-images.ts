// ============================================================================
// FlyttGo — the images of website templates, as named slots with metadata
// ============================================================================
//
// A template's pages use images as {{ASSET:key}}. Each key is an image slot
// (docs/WHITE_LABEL.md → Website templates, "Images"): the hero, a service,
// the about section, the gallery, the team, a map… Each slot's image has
// metadata (site_template_images, migration 00021): where it came from
// (source), its licence or how it was generated, the template's category,
// what it is meant to show (intended use: the page's alt text), its size
// and its review status. Today every image is Architect-AI's (source
// 'architect-ai', licence unknown until confirmed); a later batch of
// generated, licensed or own photos comes in through an image manifest
// (readManifest(), below) or is replaced slot by slot by an administrator.
//
// No Deno or network imports: used by the importer, the admin panel and the
// Vitest suite.
// ============================================================================

import type { TemplateAsset, TemplatePage } from './site-template.ts';

export const IMAGE_SLOTS = ['hero', 'services', 'about', 'gallery', 'team', 'map', 'product', 'background', 'other'] as const;
export type ImageSlot = (typeof IMAGE_SLOTS)[number];

/** Where an image came from. 'architect-ai': the template as imported (licence to be confirmed). */
export const IMAGE_SOURCES = ['architect-ai', 'ai-generated', 'licensed', 'own'] as const;
export type ImageSource = (typeof IMAGE_SOURCES)[number];
export const SOURCE_LABELS: Record<ImageSource, string> = {
  'architect-ai': 'Architect-AI (as imported)', 'ai-generated': 'AI-generated', licensed: 'Licensed photo', own: "FlyttGo's own photo",
};

export type ReviewStatus = 'unreviewed' | 'approved' | 'rejected';

/** One image slot of a template and what is known about its image. */
export interface TemplateImage {
  template_id: string;
  asset_key: string;
  slot: ImageSlot;
  url: string;
  source: ImageSource;
  /** The licence (name and reference) for a licensed photo; null while unknown. */
  licence: string | null;
  /** How an AI-generated image was made: model, prompt, date. */
  generation: { model: string; prompt?: string; date?: string } | null;
  category: string | null;
  /** What the image is meant to show, from the page (its alt text) or the slot. */
  intended_use: string | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  review_status: ReviewStatus;
}

/** The slot a key's base name stands for (hero.1 → hero, services-grid.3 → services). */
const SLOT_BY_KEY: Record<string, ImageSlot> = {
  hero: 'hero', banner: 'hero', cover: 'hero', services: 'services', 'services-grid': 'services', service: 'services',
  features: 'services', about: 'about', story: 'about', coverage: 'about', gallery: 'gallery', portfolio: 'gallery',
  work: 'gallery', projects: 'gallery', team: 'team', staff: 'team', people: 'team', map: 'map', location: 'map',
  product: 'product', products: 'product', shop: 'product', bg: 'background', background: 'background',
};

/** The slot of an image: what the page says it shows (a map, a portrait), else its key. */
export function slotOf(key: string, use?: string | null): ImageSlot {
  const u = String(use ?? '').toLowerCase();
  if (/\bmap\b|service area|\broutes?\b|\bdistrict\b/.test(u)) return 'map';
  if (/\bportrait\b|\bour team\b|\bstaff\b|\bheadshot\b|\bstylist portrait\b/.test(u)) return 'team';
  const base = key.toLowerCase().replace(/\.\d+$/, '');
  return SLOT_BY_KEY[base] ?? SLOT_BY_KEY[base.split(/[-_]/)[0]] ?? 'other';
}

/** What each asset is meant to show: the alt text of the first image that uses it, or "background" when only CSS does. */
export function intendedUses(pages: readonly TemplatePage[]): Map<string, string> {
  const uses = new Map<string, string>();
  for (const p of pages) {
    for (const m of String(p.html ?? '').matchAll(/<img\b[^>]*>/gi)) {
      const key = /\{\{ASSET:([^}]{1,60})\}\}/.exec(m[0])?.[1];
      const alt = /\salt\s*=\s*"([^"]*)"/i.exec(m[0])?.[1]?.replace(/&amp;/g, '&').trim();
      if (key && alt && !uses.has(key)) uses.set(key, alt);
    }
    for (const m of String(p.html ?? '').matchAll(/url\(\s*['"]?\{\{ASSET:([^}]{1,60})\}\}/gi)) {
      if (!uses.has(m[1])) uses.set(m[1], 'background');
    }
  }
  return uses;
}

/** The image slots of a template as imported: every asset but the thumbnail. */
export function templateImages(t: { id: string; pages: readonly TemplatePage[]; assets: readonly TemplateAsset[] }, category: string | null,
                               sizes: ReadonlyMap<string, { width: number; height: number }> = new Map()): TemplateImage[] {
  const uses = intendedUses(t.pages);
  return t.assets.filter(a => a.key !== 'thumbnail').map(a => {
    const use = uses.get(a.key) ?? uses.get(`${a.key}.1`) ?? uses.get(a.key.replace(/\.\d+$/, '')) ?? null;
    const size = sizes.get(a.url);
    return {
      template_id: t.id, asset_key: a.key, slot: slotOf(a.key, use), url: a.url, source: 'architect-ai', licence: null, generation: null,
      category, intended_use: use, width: size?.width ?? null, height: size?.height ?? null, sha256: null, review_status: 'unreviewed',
    };
  });
}

/**
 * Templates that use the very same set of images (by content hash where
 * known, else by URL): the screenshot review found most templates sharing
 * one photo set.
 */
export function sharedImageSets(images: readonly TemplateImage[]): { templates: string[]; images: number }[] {
  const byTemplate = new Map<string, string[]>();
  for (const i of images) {
    const id = i.sha256 ?? i.url;
    byTemplate.set(i.template_id, [...(byTemplate.get(i.template_id) ?? []), id]);
  }
  const groups = new Map<string, string[]>();
  for (const [t, ids] of byTemplate) {
    const sig = [...new Set(ids)].sort().join('\n');
    if (sig) groups.set(sig, [...(groups.get(sig) ?? []), t]);
  }
  return [...groups.entries()].filter(([, ts]) => ts.length > 1)
    .map(([sig, ts]) => ({ templates: ts.sort(), images: sig.split('\n').length }))
    .sort((a, b) => b.templates.length - a.templates.length);
}

/* ── Checking an image by its bytes ─────────────────────────────────── */

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
export const MAX_TEMPLATE_IMAGE = 5 * 1024 * 1024;
export const EXTENSION: Record<ImageMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * What an image file is, read from its bytes (never from its name or the
 * type it claims): PNG, JPEG or WebP and its size in pixels; null for
 * anything else.
 */
export function imageInfo(b: Uint8Array): { mime: ImageMime; width: number; height: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const le16 = (i: number) => b[i] | (b[i + 1] << 8);
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a
      && b[6] === 0x1a && b[7] === 0x0a && String.fromCharCode(...b.slice(12, 16)) === 'IHDR') {
    return { mime: 'image/png', width: u32(16), height: u32(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = u16(i + 2);
      // Start of frame (baseline, progressive …; not DHT, JPG or DAC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', width: u16(i + 7), height: u16(i + 5) };
      }
      if (marker === 0xda || len < 2) break;
      i += 2 + len;
    }
    return null;
  }
  if (b.length >= 30 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') {
    const kind = String.fromCharCode(...b.slice(12, 16));
    if (kind === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { mime: 'image/webp', width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    }
    if (kind === 'VP8L' && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') {
      return { mime: 'image/webp', width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    }
  }
  return null;
}

/** SHA-256 of bytes, as hex (Web Crypto: browsers, Deno and Node). */
export async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', b as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* ── The image manifest: a later batch of generated, licensed or own photos ── */

/**
 * One image of a batch. Either for one template's slot (template + key) or
 * for every template of a category with that slot (category + slot; several
 * entries for the same category and slot are shared out in turn, so the
 * templates do not all get the same picture).
 */
export interface ManifestEntry {
  template?: string; key?: string;
  category?: string; slot?: ImageSlot;
  /** The image file, relative to the manifest. */
  file: string;
  source: Exclude<ImageSource, 'architect-ai'>;
  licence?: string;
  generation?: { model: string; prompt?: string; date?: string };
  intended_use?: string;
}
export interface ImageManifest { version: 1; images: ManifestEntry[] }

/** Read and check a manifest; throws with every problem listed. */
export function readManifest(data: unknown): ImageManifest {
  const problems: string[] = [];
  const m = data as Partial<ImageManifest> | null;
  if (!m || m.version !== 1 || !Array.isArray(m.images)) throw new Error('image manifest: expected {"version": 1, "images": [...]}');
  m.images.forEach((e, n) => {
    const at = `images[${n}]`;
    if (!e || typeof e !== 'object') { problems.push(`${at}: not an object`); return; }
    const one = typeof e.template === 'string' && typeof e.key === 'string';
    const many = typeof e.category === 'string' && typeof e.slot === 'string';
    if (one === many) problems.push(`${at}: give either template and key, or category and slot`);
    if (many && !IMAGE_SLOTS.includes(e.slot as ImageSlot)) problems.push(`${at}: unknown slot ${e.slot} (${IMAGE_SLOTS.join(', ')})`);
    if (typeof e.file !== 'string' || !e.file || e.file.includes('..') || e.file.startsWith('/')) problems.push(`${at}: file must be a path inside the manifest's folder`);
    if (!['ai-generated', 'licensed', 'own'].includes(e.source)) problems.push(`${at}: source must be ai-generated, licensed or own`);
    if (e.source === 'licensed' && !(typeof e.licence === 'string' && e.licence.trim())) problems.push(`${at}: a licensed photo needs its licence`);
    if (e.source === 'ai-generated' && !(e.generation && typeof e.generation.model === 'string' && e.generation.model.trim())) {
      problems.push(`${at}: an AI-generated image needs generation.model`);
    }
  });
  if (problems.length) throw new Error(`image manifest:\n  ${problems.join('\n  ')}`);
  return m as ImageManifest;
}

/**
 * Which manifest entry each image slot of these templates gets: an entry
 * for the template's own key first, else the category and slot's entries
 * in turn. Returns template id → asset key → entry.
 */
export function planManifest(manifest: ImageManifest, images: readonly TemplateImage[]): Map<string, Map<string, ManifestEntry>> {
  const plan = new Map<string, Map<string, ManifestEntry>>();
  const set = (t: string, k: string, e: ManifestEntry) => { if (!plan.has(t)) plan.set(t, new Map()); plan.get(t)!.set(k, e); };
  const turn = new Map<string, number>();
  for (const i of [...images].sort((a, b) => a.template_id.localeCompare(b.template_id) || a.asset_key.localeCompare(b.asset_key))) {
    const own = manifest.images.find(e => e.template === i.template_id && e.key === i.asset_key);
    if (own) { set(i.template_id, i.asset_key, own); continue; }
    const pool = manifest.images.filter(e => e.category && e.category === i.category && e.slot === i.slot);
    if (!pool.length) continue;
    const k = `${i.category}\u0000${i.slot}`;
    const n = turn.get(k) ?? 0;
    set(i.template_id, i.asset_key, pool[n % pool.length]);
    turn.set(k, n + 1);
  }
  return plan;
}
