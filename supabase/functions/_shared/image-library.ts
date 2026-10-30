// ============================================================================
// FlyttGo — the shared image library for website templates
// ============================================================================
//
// The owner's decision (docs/WHITE_LABEL.md → Image library; migration
// 00023): every image slot of a template ({{ASSET:key}}) draws from, in
// order, the company's own image, the template's approved image with a known
// licence, an approved library image of the template's category in the
// slot's shape, and else a neutral block in the company's colour. The
// database resolves it (site_template_image_map()); this module turns the
// resolved map into what renderTemplatePage() fills in, reads the harvested
// catalogue the importer loads (scripts/import-image-library.ts), and holds
// the rules the admin panel shows (shapes, buckets, size limit).
//
// No Deno or network imports: used by the edge functions, the importer, the
// browser and the Vitest suite.
// ============================================================================

import { TEMPLATE_CATEGORIES, OTHER_CATEGORY, neutralImage, type RenderImage, type RenderImages } from './site-template.ts';
import { sha256Hex } from './template-images.ts';

export const LIBRARY_BUCKET = 'site-image-library';
export const COMPANY_IMAGE_BUCKET = 'organization-site-images';
/** Library and company images: PNG, JPEG or WebP (checked by their bytes), at most 8 MB. */
export const MAX_LIBRARY_IMAGE = 8 * 1024 * 1024;

export const LIBRARY_SHAPES = ['hero', 'wide', 'square', 'portrait'] as const;
export type LibraryShape = (typeof LIBRARY_SHAPES)[number];
export const SHAPE_LABELS: Record<LibraryShape, string> = {
  hero: 'Hero (wide banner)', wide: 'Wide', square: 'Square', portrait: 'Portrait',
};
/** The shape a slot needs: one of the library's, or a map (never a photo). */
export type SlotShape = LibraryShape | 'map';

export const LIBRARY_STATUSES = ['pending', 'approved', 'rejected', 'retired'] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

/** The categories a library image may have: the catalogue's, and "other". */
export const LIBRARY_CATEGORIES: string[] = [...TEMPLATE_CATEGORIES.map(c => c.id), OTHER_CATEGORY.id];

/**
 * The shape of an image from its size, as the database computes it
 * (image_shape_of() in 00023): hero when wide (≥ 1.6 : 1) and at least
 * 1200 px across, wide from 1.2 : 1, square above 0.83 : 1, else portrait.
 */
export function shapeOf(width: number, height: number): LibraryShape | null {
  if (!(width > 0) || !(height > 0)) return null;
  const r = width / height;
  if (r >= 1.6 && width >= 1200) return 'hero';
  if (r >= 1.2) return 'wide';
  if (r > 0.83) return 'square';
  return 'portrait';
}

/** Which shapes may fill a slot, best first (site_image_shapes_for() in 00023). */
export function shapesFor(shape: SlotShape): LibraryShape[] {
  return shape === 'hero' ? ['hero', 'wide'] : shape === 'wide' ? ['wide', 'hero'] : shape === 'map' ? [] : [shape];
}

/** One slot of the resolved map, as site_template_image_map() returns it. */
export interface MapEntry {
  source: 'company' | 'template' | 'library' | 'assets' | 'fallback';
  shape: SlotShape;
  /** A full address (template images and assets). */
  url?: string;
  /** Or a stored file: the library's (public) or the company's (private: signed by the caller). */
  bucket?: string;
  path?: string;
  alt?: string;
  /** The library image's id. */
  id?: string;
  focal_x?: number;
  focal_y?: number;
}
export interface ImageMap {
  template: string;
  category: string | null;
  /** 'assets': the category has no approved library image yet, so the template's own assets are used as before. */
  mode: 'library' | 'assets';
  images: Record<string, MapEntry>;
}

export const SOURCE_LABELS_MAP: Record<MapEntry['source'], string> = {
  company: 'Your image', template: "The template's own image", library: 'From the image library',
  assets: 'As imported (until the library has photos for this category)', fallback: 'Plain colour block (no photo)',
};

/* What the renderer fills in (RenderImage, RenderImages) and the neutral
 * block (neutralImage()) live in site-template.ts, beside the renderer. */
export { neutralImage, type RenderImage, type RenderImages };

/** The public address of a file in a public bucket. */
export function publicUrl(supabaseUrl: string, bucket: string, path: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** The company's own uploads to sign (private bucket), as paths. */
export function pathsToSign(map: ImageMap): string[] {
  return [...new Set(Object.values(map.images).filter(e => e.bucket === COMPANY_IMAGE_BUCKET && e.path).map(e => e.path!))];
}

/**
 * The resolved map as the renderer takes it. Library files get their public
 * address; the company's uploads the signed address given for each path
 * (none: the slot falls to the neutral block rather than to another photo).
 */
export function renderImages(map: ImageMap, supabaseUrl: string, signed: Record<string, string> = {}): RenderImages {
  const byKey: Record<string, RenderImage> = {};
  for (const [key, e] of Object.entries(map.images ?? {})) {
    let url: string | null = null;
    if (e.url) url = e.url;
    else if (e.bucket === LIBRARY_BUCKET && e.path) url = publicUrl(supabaseUrl, LIBRARY_BUCKET, e.path);
    else if (e.bucket === COMPANY_IMAGE_BUCKET && e.path) url = signed[e.path] ?? null;
    const focal = typeof e.focal_x === 'number' || typeof e.focal_y === 'number' ? { x: e.focal_x ?? 0.5, y: e.focal_y ?? 0.5 } : null;
    byKey[key] = { url, alt: e.alt ?? null, source: url ? e.source : 'fallback', focal };
  }
  return { mode: map.mode, byKey };
}

/** The hosts the resolved images load from (for a preview's allowed image hosts). */
export function imageUrls(images: RenderImages | null | undefined): { url: string }[] {
  return Object.values(images?.byKey ?? {}).filter(i => i.url).map(i => ({ url: i.url! }));
}

/* ── The harvested catalogue (scripts/import-image-library.ts) ───────── */

/**
 * One image of a harvested catalogue (docs/WHITE_LABEL.md → Image library,
 * "Catalogue"). The file is relative to --library-dir; its bytes must match
 * the hash and size given.
 */
export interface CatalogueEntry {
  sha256: string;
  file: string;
  width: number;
  height: number;
  category: string;
  /** Optional: computed from the size when left out (shapeOf()). */
  shape?: LibraryShape;
  tags?: string[];
  alt?: string;
  /** Where the image comes from: a site or collection ("unsplash", "pexels", "wikimedia-commons"), "ai-generated", "own" … */
  origin: string;
  /** The licence's name (and version). Required: an image whose licence is unknown never enters the library. */
  licence: string;
  /** Where the licence is shown or recorded (a page address or a note). Required before approval. */
  licence_evidence?: string;
  /** The pages it was found on: addresses, or {url, author, retrieved, …}. */
  sources?: (string | Record<string, unknown>)[];
  focal_x?: number;
  focal_y?: number;
}
export interface Catalogue { version: 1; images: CatalogueEntry[] }

/** Read and check a catalogue: {"version": 1, "images": [...]} or a bare list. Throws with every problem listed. */
export function readCatalogue(data: unknown): Catalogue {
  const list = Array.isArray(data) ? data : (data as { version?: unknown; images?: unknown } | null)?.images;
  if (!Array.isArray(list)) throw new Error('image catalogue: expected {"version": 1, "images": [...]} or a list of images');
  if (!Array.isArray(data) && (data as { version?: unknown }).version !== 1) throw new Error('image catalogue: version must be 1');
  const problems: string[] = [];
  const seen = new Map<string, number>();
  list.forEach((e: Partial<CatalogueEntry> | null, n: number) => {
    const at = `images[${n}]`;
    if (!e || typeof e !== 'object') { problems.push(`${at}: not an object`); return; }
    if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) problems.push(`${at}: sha256 must be 64 lower-case hex characters`);
    else if (seen.has(e.sha256)) problems.push(`${at}: the same image as images[${seen.get(e.sha256)}]`);
    else seen.set(e.sha256, n);
    if (typeof e.file !== 'string' || !e.file || e.file.includes('..') || e.file.startsWith('/')) problems.push(`${at}: file must be a path inside --library-dir`);
    if (!Number.isInteger(e.width) || e.width! <= 0 || !Number.isInteger(e.height) || e.height! <= 0) problems.push(`${at}: width and height in pixels`);
    if (typeof e.category !== 'string' || !LIBRARY_CATEGORIES.includes(e.category)) problems.push(`${at}: category must be one of ${LIBRARY_CATEGORIES.join(', ')}`);
    if (e.shape !== undefined && !LIBRARY_SHAPES.includes(e.shape)) problems.push(`${at}: shape must be one of ${LIBRARY_SHAPES.join(', ')}`);
    if (typeof e.origin !== 'string' || !e.origin.trim() || e.origin.length > 80) problems.push(`${at}: origin (where it comes from) is required`);
    if (typeof e.licence !== 'string' || !e.licence.trim()) problems.push(`${at}: licence is required (an image whose licence is unknown is never added)`);
    if (e.tags !== undefined && !(Array.isArray(e.tags) && e.tags.every(t => typeof t === 'string'))) problems.push(`${at}: tags must be a list of words`);
    if (e.sources !== undefined && !Array.isArray(e.sources)) problems.push(`${at}: sources must be a list`);
    for (const f of ['focal_x', 'focal_y'] as const) {
      if (e[f] !== undefined && !(typeof e[f] === 'number' && e[f]! >= 0 && e[f]! <= 1)) problems.push(`${at}: ${f} between 0 and 1`);
    }
  });
  if (problems.length) throw new Error(`image catalogue:\n  ${problems.join('\n  ')}`);
  return { version: 1, images: list as CatalogueEntry[] };
}

/** The storage path of a library image: <category>/<sha256>.<ext>. */
export function libraryPath(category: string, sha256: string, mime: 'image/png' | 'image/jpeg' | 'image/webp'): string {
  return `${category}/${sha256}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`;
}

/* ── Thumbnails drawn with the resolved images (00024) ───────────────── */

/** A map's slots as site_template_images_key() reads them (the template and mode are not needed). */
export type ThumbnailMap = { images: Record<string, Partial<MapEntry>> };

/**
 * What a thumbnail shows, as text (site_template_images_key() in 00024 writes
 * the same): one line per slot in key order, `<key>=<picture>|<focal x ×
 * 1000>|<focal y × 1000>`, the picture being the address, the stored file as
 * `<bucket>/<path>`, or `-` for the neutral block. Alt texts and sources are
 * left out: they do not change the picture.
 */
export function thumbnailImagesKey(map: ThumbnailMap): string {
  const focal = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 1000)) : '');
  // Keys are [A-Za-z0-9._-]: the default sort is the database's byte order.
  return Object.keys(map.images ?? {}).sort().map(k => {
    const e = map.images[k] ?? {};
    const picture = e.url ? e.url : e.path ? `${e.bucket ?? ''}/${e.path}` : '-';
    return `${k}=${picture}|${focal(e.focal_x)}|${focal(e.focal_y)}`;
  }).join('\n');
}

/** Its SHA-256 (hex): what a thumbnail records as the images it was drawn with. */
export async function thumbnailImagesHash(map: ThumbnailMap): Promise<string> {
  return sha256Hex(new TextEncoder().encode(thumbnailImagesKey(map)));
}

/**
 * The map a template's own assets give, as the importer draws its thumbnail
 * (site_template_assets_map() in 00024): every {{ASSET:key}} its pages use
 * but the thumbnail, each with its asset (the key, the key without its
 * number, or the key with .1), else none.
 */
export function assetsImageMap(pages: readonly { html: string }[], assets: readonly { key: string; url: string }[]): ThumbnailMap {
  const byKey = new Map(assets.map(a => [a.key, a.url]));
  const images: ThumbnailMap['images'] = {};
  for (const p of pages) {
    for (const m of (p.html ?? '').matchAll(/\{\{ASSET:([A-Za-z0-9._-]{1,60})\}\}/g)) {
      const k = m[1];
      if (k === 'thumbnail' || k in images) continue;
      const url = byKey.get(k) ?? byKey.get(k.replace(/\.\d+$/, '')) ?? byKey.get(`${k}.1`);
      images[k] = url ? { url } : {};
    }
  }
  return { images };
}

/** Where a redrawn thumbnail is stored: a new name per set of images, so a browser never shows the old picture. */
export const thumbnailPath = (templateId: string, imagesHash: string) => `${templateId}/thumbnail-${imagesHash.slice(0, 12)}.jpg`;
