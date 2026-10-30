// ============================================================================
// FlyttGo — shrink a harvested image catalogue to web size and pick a balanced set
// ============================================================================
//
// docs/WHITE_LABEL.md → Image library, "Storage" (owner's decision
// 2026-10-30): FlyttGo's Supabase organisation is on the Free plan, so the
// library takes a balanced selection of each harvest at web size, never the
// originals. This script reads a catalogue in the loader's format
// (scripts/import-image-library.ts, readCatalogue()) and its folder, and
// writes to --out:
//
//   <category>/<sha256 16>.webp|.jpg   the chosen images at web size
//   library-catalogue.json             the loader's catalogue of them (version 1)
//   selection.md                       per category and shape: needed, available,
//                                      chosen; total size; what was skipped and why
//   contact-<category>.html / .jpg     contact sheets for review
//   selection.json                     every image considered, chosen or skipped, with the reason
//
// It is LOCAL ONLY: nothing is uploaded. Load the result with the loader
// (dry run, then --upload with the owner's approval).
//
// Picking, per category (selectCategory()):
//   - one image per near-duplicate group (the harvest's near_duplicate_group,
//     else the same Pexels or Unsplash photo id), keeping a JPEG, PNG or WebP
//     over an AVIF (an AVIF is converted only when its group has nothing
//     else), then the documented licence, then the larger original;
//   - a target per category (--per-category, default 40, at most 60), shared
//     out over the shapes in proportion to the slots the category's
//     templates have (read from FlyttGo with the service key, read only,
//     with --needs-from-flyttgo; else from --needs <file>; else defaults),
//     at least as many as one template needs; a shape short of images gives
//     its share to the others (hero and wide fill each other's slots);
//   - within a shape, best first: (1) a documented licence (Pexels or
//     Unsplash licence with its evidence), (2) the owner's own or AI images
//     from the owner's repositories and sites, (3) unknown; then the larger
//     original; then varied subjects (tags and photographers already chosen
//     count against an image);
//   - skipped: files that are missing, marked unusable, smaller than
//     --min-side on their long side (default 800 px), or not an image.
//
// Shrinking (Python Pillow, `python3 -I`; Node has no image library here):
// orientation applied, colours converted to sRGB, at most --max-side px on
// the long side (default 2000, never enlarged), every piece of metadata
// dropped (EXIF, GPS, XMP, ICC, C2PA); WebP quality 80 (--quality), or JPEG
// quality 82 when that is smaller; a result above 450 KB is encoded again
// at a lower quality (72, then 64). Each output's SHA-256, size and pixels
// are computed from its bytes; origin, licence, evidence, sources, alt
// text, tags and focal point are kept, and the original is recorded in
// sources ({"resized_from": {sha256, width, height, bytes}}).
//
// With --compare-flyttgo it also reads the library's rows (read only) and
// writes library-plan.json: for each image already in the library, the
// web-size image that replaces it, or that it is not in the selection; and
// retire-library-originals.sql, which retires the pending originals (for the
// SQL editor, run by the owner once the web-size images are loaded).
//
//   node scripts/prepare-library-images.ts --library harvest/library-catalogue.json --library-dir harvest/images \
//     --full harvest/catalogue.json --out library-web
//   NODE_USE_ENV_PROXY=1 FLYTTGO_SUPABASE_URL=… FLYTTGO_SERVICE_ROLE_KEY=… \
//     node scripts/prepare-library-images.ts … --needs-from-flyttgo --compare-flyttgo
//
// Options:
//   --library <file>        the catalogue (required)
//   --library-dir <dir>     where its files are (default: the catalogue's folder)
//   --full <file>           the harvest's full catalogue (near-duplicate groups, origins, formats, unusable reasons)
//   --out <dir>             where to write (required)
//   --per-category N        images per category (default 40, at most 60)
//   --category ID           only one category
//   --min-side N            smallest long side kept (default 800)
//   --max-side N            long side after shrinking (default 2000)
//   --quality N             WebP quality (default 80)
//   --needs <file>          {category: {hero, wide, square, portrait}} slot counts
//   --needs-from-flyttgo    read the slot counts from FlyttGo's templates (read only)
//   --compare-flyttgo       plan the library's existing images (read only)
//   --no-shrink             pick only (selection.md and selection.json)
// ============================================================================
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  LIBRARY_CATEGORIES, LIBRARY_SHAPES, readCatalogue, shapeOf, type CatalogueEntry, type LibraryShape, type SlotShape,
} from '../supabase/functions/_shared/image-library.ts';
import { imageInfo, sha256Hex, slotOf } from '../supabase/functions/_shared/template-images.ts';
import { categoryLabel, templateCategory } from '../supabase/functions/_shared/site-template.ts';

export const DEFAULT_PER_CATEGORY = 40;
export const MAX_PER_CATEGORY = 60;
/** What a category's templates are assumed to need when FlyttGo's are not read: slots per shape. */
export const DEFAULT_NEEDS: Record<LibraryShape, number> = { hero: 3, wide: 6, square: 1, portrait: 1 };

/* ── Sizes ───────────────────────────────────────────────────────────── */

/** The size after shrinking: the long side at most maxSide, never enlarged, the shape kept. */
export function targetSize(width: number, height: number, maxSide = 2000): { width: number; height: number } {
  const long = Math.max(width, height);
  if (!(long > maxSide)) return { width, height };
  const k = maxSide / long;
  return width >= height ? { width: maxSide, height: Math.max(1, Math.round(height * k)) }
                         : { width: Math.max(1, Math.round(width * k)), height: maxSide };
}

/* ── What a template slot needs (as the database reads it, 00023) ────── */

/**
 * The shape a template slot needs, as site_image_slot_shape() in 00023: the
 * recorded slot (else the key read as slotOf() reads it): a hero or
 * background is a hero, a team member a portrait, a product a square, a map
 * takes no photo; services, about and gallery are wide; any other slot the
 * shape of the image it had, else wide.
 */
export function slotShape(key: string, slot: string | null | undefined, width?: number | null, height?: number | null): SlotShape {
  const s = slot && slot !== 'other' ? slot : slotOf(key);
  switch (s) {
    case 'hero': case 'background': return 'hero';
    case 'team': return 'portrait';
    case 'product': return 'square';
    case 'map': return 'map';
    case 'other': return shapeOf(width ?? 0, height ?? 0) ?? 'wide';
    default: return 'wide';
  }
}

export interface ShapeNeeds { slots: Record<LibraryShape, number>; mostInATemplate: Record<LibraryShape, number>; templates: number }
const zero = (): Record<LibraryShape, number> => ({ hero: 0, wide: 0, square: 0, portrait: 0 });

/** Per category: the slots of each shape in all its templates (not retired) and the most one template has. */
export function categoryNeeds(
  templates: readonly { id: string; industry: string[] | null; status: string; pages: { html: string }[] }[],
  images: readonly { template_id: string; asset_key: string; slot: string | null; width: number | null; height: number | null }[],
): Record<string, ShapeNeeds> {
  const rec = new Map(images.map(i => [`${i.template_id}\u0000${i.asset_key}`, i]));
  const out: Record<string, ShapeNeeds> = {};
  for (const t of templates) {
    if (t.status === 'retired') continue;
    const cat = templateCategory(t.industry);
    if (!cat) continue;
    const keys = new Set<string>();
    for (const p of t.pages ?? []) for (const m of (p.html ?? '').matchAll(/\{\{ASSET:([A-Za-z0-9._-]{1,60})\}\}/g)) if (m[1] !== 'thumbnail') keys.add(m[1]);
    const mine = zero();
    for (const k of keys) {
      const i = rec.get(`${t.id}\u0000${k}`);
      const s = slotShape(k, i?.slot, i?.width, i?.height);
      if (s !== 'map') mine[s]++;
    }
    const n = (out[cat] ??= { slots: zero(), mostInATemplate: zero(), templates: 0 });
    n.templates++;
    for (const s of LIBRARY_SHAPES) { n.slots[s] += mine[s]; n.mostInATemplate[s] = Math.max(n.mostInATemplate[s], mine[s]); }
  }
  return out;
}

/* ── Picking ─────────────────────────────────────────────────────────── */

export interface Candidate {
  sha256: string; file: string; category: string; shape: LibraryShape; width: number; height: number; bytes: number;
  format: string; tier: 1 | 2 | 3; group: string; tags: string[]; author: string | null; entry: CatalogueEntry;
}

/** The licence tier: 1 documented (Pexels or Unsplash licence with its evidence), 2 the owner's own or AI, 3 unknown. */
export function licenceTier(e: Pick<CatalogueEntry, 'licence' | 'licence_evidence' | 'origin'>, fullOrigin?: string | null): 1 | 2 | 3 {
  if (/^(pexels|unsplash) licen[cs]e/i.test(e.licence ?? '') && (e.licence_evidence ?? '').trim()) return 1;
  const origin = `${e.origin ?? ''} ${fullOrigin ?? ''}`;
  if (/AI-generated|C2PA|trainedAlgorithmicMedia|owner repo|owner site|\(owner sites\)|FlyttGo\/owner/i.test(origin)) return 2;
  return 3;
}

/** The near-duplicate group of an image: the harvest's group, else the Pexels or Unsplash photo it is, else itself. */
export function groupOf(e: { sha256: string; sources?: unknown[]; licence_evidence?: string }, nearDuplicateGroup?: number | string | null): string {
  if (nearDuplicateGroup !== undefined && nearDuplicateGroup !== null && nearDuplicateGroup !== '') return `group:${nearDuplicateGroup}`;
  const text = [e.licence_evidence ?? '', ...(e.sources ?? []).map(s => typeof s === 'string' ? s : String((s as { url?: unknown })?.url ?? ''))].join(' ');
  const pexels = /pexels\.com\/(?:photos\/|photo\/[^\s/]*-)(\d{3,})/.exec(text);
  if (pexels) return `pexels:${pexels[1]}`;
  const unsplash = /images\.unsplash\.com\/photo-([0-9]+-[0-9a-f]+)/.exec(text);
  if (unsplash) return `unsplash:${unsplash[1]}`;
  return `sha:${e.sha256}`;
}

/** The photographer, from "pexels — Name" origins, for variety. */
export const authorOf = (origin: string): string | null => /—\s*(.+)$/.exec(origin)?.[1]?.trim() || null;

const longSide = (c: { width: number; height: number }) => Math.max(c.width, c.height);

/** One image per group: a JPEG, PNG or WebP before an AVIF, then the better licence, then the larger original. */
export function onePerGroup(cands: readonly Candidate[]): { kept: Candidate[]; dropped: { c: Candidate; reason: string }[] } {
  const by = new Map<string, Candidate[]>();
  for (const c of cands) by.set(c.group, [...(by.get(c.group) ?? []), c]);
  const kept: Candidate[] = []; const dropped: { c: Candidate; reason: string }[] = [];
  for (const list of by.values()) {
    const sorted = [...list].sort((a, b) => Number(a.format === 'avif') - Number(b.format === 'avif') || a.tier - b.tier
      || longSide(b) - longSide(a) || b.bytes - a.bytes || a.sha256.localeCompare(b.sha256));
    kept.push(sorted[0]);
    for (const c of sorted.slice(1)) {
      dropped.push({ c, reason: c.format === 'avif' && sorted[0].format !== 'avif' ? 'an AVIF whose group has a JPEG, PNG or WebP version'
                                                                                 : 'a near-duplicate of a chosen image' });
    }
  }
  return { kept, dropped };
}

/**
 * How many of each shape: the target shared out by the slots the
 * category's templates have (at least the most one template has), never more
 * than are available; a shape short of images gives its share to the others
 * by the same weights, and hero and wide (which fill each other's slots)
 * take the rest when the needed shapes run out.
 */
export function shapeQuotas(target: number, needs: ShapeNeeds | null, available: Record<LibraryShape, number>): Record<LibraryShape, number> {
  const w = needs ? needs.slots : DEFAULT_NEEDS;
  const floor = needs ? needs.mostInATemplate : zero();
  const q = zero();
  const total = () => LIBRARY_SHAPES.reduce((s, x) => s + q[x], 0);
  // At least what one template needs (as far as there are images): a shape
  // whose share by weight is below that gets exactly that, and the others
  // share the rest by weight.
  const fixed = new Set<LibraryShape>();
  for (let changed = true; changed;) {
    changed = false;
    const rest = LIBRARY_SHAPES.filter(s => w[s] > 0 && !fixed.has(s));
    const left = target - [...fixed].reduce((n, s) => n + q[s], 0);
    const sumW = rest.reduce((n, s) => n + w[s], 0);
    for (const s of rest) {
      if (Math.min(floor[s], available[s]) > left * w[s] / sumW) { q[s] = Math.min(floor[s], available[s]); fixed.add(s); changed = true; }
    }
  }
  const fill = (weights: Record<LibraryShape, number>) => {
    for (let guard = 0; guard < 100 && total() < target; guard++) {
      const open = LIBRARY_SHAPES.filter(s => weights[s] > 0 && q[s] < available[s]);
      if (!open.length) return;
      const left = target - total();
      const sumW = open.reduce((s, x) => s + weights[x], 0);
      // Largest remainder, at least one to the heaviest so it always moves.
      const share = open.map(s => ({ s, exact: left * weights[s] / sumW }));
      let given = 0;
      for (const x of share) { const n = Math.min(Math.floor(x.exact), available[x.s] - q[x.s]); q[x.s] += n; given += n; }
      if (given === 0) {
        const best = share.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || weights[b.s] - weights[a.s])[0];
        q[best.s]++;
      }
    }
  };
  fill(Object.fromEntries(LIBRARY_SHAPES.map(s => [s, fixed.has(s) ? 0 : w[s]])) as Record<LibraryShape, number>);
  fill(w);
  // Hero and wide fill each other's slots: the one not asked for takes the rest.
  if (total() < target && (w.hero > 0 || w.wide > 0)) fill({ hero: 1, wide: 1, square: 0, portrait: 0 });
  return q;
}

export interface Picked { chosen: Candidate[]; skipped: { c: Candidate; reason: string }[] }

/**
 * The images of one category: one per group, then per shape best first
 * (licence tier, larger original), each pick counting against images with
 * the same tags or photographer, so the subjects vary.
 */
export function selectCategory(cands: readonly Candidate[], target: number, needs: ShapeNeeds | null): Picked & { quotas: Record<LibraryShape, number> } {
  const { kept, dropped } = onePerGroup(cands);
  const skipped = [...dropped];
  const available = zero();
  for (const c of kept) available[c.shape]++;
  const quotas = shapeQuotas(Math.min(target, MAX_PER_CATEGORY), needs, available);
  const chosen: Candidate[] = [];
  const tagCount = new Map<string, number>();
  const authorCount = new Map<string, number>();
  const base = (c: Candidate) => (4 - c.tier) * 1000 + Math.min(longSide(c), 2000) / 20 - (c.format === 'avif' ? 30 : 0);
  for (const s of LIBRARY_SHAPES) {
    const pool = kept.filter(c => c.shape === s);
    const take: Candidate[] = [];
    while (take.length < quotas[s] && pool.length) {
      let best = 0; let bestScore = -Infinity;
      pool.forEach((c, i) => {
        const overlap = c.tags.reduce((n, t) => n + (tagCount.get(t) ?? 0), 0);
        const score = base(c) - overlap * 15 - (c.author ? (authorCount.get(c.author) ?? 0) * 10 : 0);
        if (score > bestScore || (score === bestScore && c.sha256 < pool[best].sha256)) { best = i; bestScore = score; }
      });
      const [c] = pool.splice(best, 1);
      take.push(c);
      for (const t of c.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
      if (c.author) authorCount.set(c.author, (authorCount.get(c.author) ?? 0) + 1);
    }
    chosen.push(...take);
    const why = quotas[s] === 0 ? `the category's templates have no ${s} slot` : `beyond the ${quotas[s]} ${s} image(s) for this category`;
    for (const c of pool) skipped.push({ c, reason: why });
  }
  return { chosen, skipped, quotas };
}

/** Tags in lower case, words of the alt text added when there are few, for variety. */
export function tagsOf(e: CatalogueEntry): string[] {
  const t = (e.tags ?? []).map(x => x.toLowerCase().trim()).filter(Boolean);
  return [...new Set(t.flatMap(x => [x, ...x.split(/\s+/).filter(w => w.length > 3)]))];
}

/* ── The output catalogue ────────────────────────────────────────────── */

/** The loader's entry for a shrunk image: the new bytes' facts, everything else kept, the original recorded. */
export function webEntry(e: CatalogueEntry, out: { file: string; sha256: string; width: number; height: number; bytes: number },
                         original: { bytes: number }): CatalogueEntry {
  const shape = shapeOf(out.width, out.height) ?? e.shape;
  return {
    sha256: out.sha256, file: out.file, width: out.width, height: out.height, category: e.category, shape,
    tags: e.tags ?? [], alt: e.alt, origin: e.origin, licence: e.licence,
    ...(e.licence_evidence ? { licence_evidence: e.licence_evidence } : {}),
    sources: [...(e.sources ?? []), { resized_from: { sha256: e.sha256, width: e.width, height: e.height, bytes: original.bytes } }],
    ...(e.focal_x !== undefined ? { focal_x: e.focal_x } : {}), ...(e.focal_y !== undefined ? { focal_y: e.focal_y } : {}),
  };
}

const TIER_LABEL = { 1: 'documented licence', 2: "owner's own / AI", 3: 'unknown' } as const;
export const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** selection.md: per category and shape what is needed, available and chosen; size; what was skipped and why. */
export function selectionReport(r: {
  categories: { id: string; needs: ShapeNeeds | null; available: Record<LibraryShape, number>; quotas: Record<LibraryShape, number>;
                chosen: (Candidate & { outBytes?: number })[]; skipped: { c: Candidate; reason: string }[] }[];
  refused: { file: string; category: string; reason: string }[];
  needsSource: string; total: { files: number; bytes: number; originalBytes: number }; shrunk: boolean; generated: string;
  library?: { replaced: number; retire: number; rows: number } | null;
}): string {
  const L: string[] = [];
  L.push('# Image library: web-size selection', '');
  L.push(`Made ${r.generated} by \`scripts/prepare-library-images.ts\`. Local only: nothing was uploaded.`, '');
  L.push(`- Chosen: **${r.total.files} images**, ${r.shrunk ? `**${mb(r.total.bytes)}** at web size (the originals: ${mb(r.total.originalBytes)})` : `originals ${mb(r.total.originalBytes)} (not shrunk: --no-shrink)`}.`);
  L.push(`- Shapes needed: ${r.needsSource}.`);
  if (r.library) L.push(`- Already in the library: ${r.library.rows} image(s): ${r.library.replaced} have a web-size replacement in this selection, ${r.library.retire} are not in it (library-plan.json).`);
  L.push('', '## Per category and shape (chosen / available after one per group · slots in the templates)', '');
  L.push('| category | templates | hero | wide | square | portrait | chosen | size | documented / owner·AI / unknown |', '|---|---|---|---|---|---|---|---|---|');
  for (const c of r.categories) {
    const cell = (s: LibraryShape) => `${c.chosen.filter(x => x.shape === s).length} / ${c.available[s]}${c.needs ? ` · ${c.needs.slots[s]}` : ''}`;
    const tiers = [1, 2, 3].map(t => c.chosen.filter(x => x.tier === t).length).join(' / ');
    const size = c.chosen.reduce((s, x) => s + (x.outBytes ?? x.bytes), 0);
    L.push(`| ${categoryLabel(c.id)} (${c.id}) | ${c.needs?.templates ?? '–'} | ${cell('hero')} | ${cell('wide')} | ${cell('square')} | ${cell('portrait')} | ${c.chosen.length} | ${mb(size)} | ${tiers} |`);
  }
  const all = r.categories.flatMap(c => c.chosen);
  L.push(`| **all** | | ${LIBRARY_SHAPES.map(s => all.filter(x => x.shape === s).length).join(' | ')} | **${all.length}** | **${mb(r.shrunk ? r.total.bytes : r.total.originalBytes)}** | ${[1, 2, 3].map(t => all.filter(x => x.tier === t).length).join(' / ')} |`);
  L.push('', 'Shapes are those of the originals (the loader records the shape of the web-size file, which is the same). Licence tiers: ' +
    Object.entries(TIER_LABEL).map(([k, v]) => `${k} ${v}`).join(', ') + '. An image whose licence is "unknown — owner to confirm" cannot be approved until the owner records its licence and evidence.');
  L.push('', '## Skipped', '');
  const reasons = new Map<string, number>();
  const general = (reason: string) => reason.replace(/the \d+ (hero|wide|square|portrait)/, 'the $1');
  for (const c of r.categories) for (const s of c.skipped) reasons.set(general(s.reason), (reasons.get(general(s.reason)) ?? 0) + 1);
  for (const x of r.refused) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1);
  L.push('| reason | images |', '|---|---|');
  for (const [k, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${n} |`);
  L.push('', 'Per category:', '');
  for (const c of r.categories) {
    const by = new Map<string, number>();
    for (const s of c.skipped) by.set(s.reason, (by.get(s.reason) ?? 0) + 1);
    for (const x of r.refused.filter(y => y.category === c.id)) by.set(x.reason, (by.get(x.reason) ?? 0) + 1);
    if (by.size) L.push(`- ${categoryLabel(c.id)}: ${[...by.entries()].map(([k, n]) => `${n} ${k}`).join('; ')}`);
  }
  L.push('', 'Every image considered, with what happened to it, is in `selection.json`.', '');
  return L.join('\n');
}

/**
 * The SQL that retires the library's full-size photos (for the SQL editor,
 * run by the owner after the web-size ones are loaded): each row retired
 * with its reason, recorded in its history as admin_review_library_image()
 * records a review. Rows that were reviewed meanwhile (no longer pending) are
 * left as they are.
 */
export function retireSql(rows: readonly { id: string; review_status: string; reason: string }[]): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const lines = [
    '-- Retire the image library\'s full-size originals (docs/WHITE_LABEL.md → Image library, "Storage").',
    '-- Generated by scripts/prepare-library-images.ts --compare-flyttgo. One transaction; only rows still pending change.',
    'BEGIN;',
    ...rows.map(r => `UPDATE public.image_library SET review_status = 'retired', reviewed_at = now(), review_reason = ${q(r.reason)},
  history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', NULL, 'action', 'reviewed', 'from', review_status, 'to', 'retired', 'reason', ${q(r.reason)})),
  updated_at = now()
 WHERE id = ${q(r.id)} AND review_status = 'pending';`),
    'COMMIT;', '',
  ];
  return lines.join('\n');
}

/* ── Shrinking (Python Pillow) ───────────────────────────────────────── */

/** The Pillow program: shrink each job (JSON list in argv[1]) and write results (argv[2]); contact sheets with argv[3]. */
export const PILLOW = String.raw`
import io, json, sys
from multiprocessing import Pool
from PIL import Image, ImageOps, ImageCms, ImageDraw
LIMIT = 450 * 1024
def to_srgb(im):
    icc = im.info.get('icc_profile')
    if not icc:
        return im
    try:
        src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        mode = 'RGBA' if im.mode in ('RGBA', 'LA', 'PA') else 'RGB'
        if im.mode not in ('RGB', 'RGBA', 'CMYK', 'L'):
            im = im.convert(mode)
        return ImageCms.profileToProfile(im, src, ImageCms.createProfile('sRGB'), outputMode=mode)
    except Exception:
        return im
def encode(im, fmt, q):
    b = io.BytesIO()
    if fmt == 'webp':
        im.save(b, 'WEBP', quality=q, method=6)
    else:
        im.save(b, 'JPEG', quality=q, optimize=True, progressive=True, subsampling='4:2:0')
    return b.getvalue()
def job(j):
    try:
        im = Image.open(j['src'])
        im.load()
        im = ImageOps.exif_transpose(im)
        im = to_srgb(im)
        alpha = im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info)
        im = im.convert('RGBA' if alpha else 'RGB')
        if alpha and im.getchannel('A').getextrema()[0] == 255:
            im = im.convert('RGB'); alpha = False
        if (im.width, im.height) != (j['width'], j['height']):
            im = im.resize((j['width'], j['height']), Image.LANCZOS)
        best = None
        for q in (j['quality'], 72, 64):
            if q > j['quality']:
                continue
            # WebP at the quality asked; JPEG (2 higher, 82 for 80) when smaller; no JPEG with transparency.
            tries = [('webp', q, encode(im, 'webp', q))]
            if not alpha:
                tries.append(('jpg', q + 2, encode(im, 'jpg', q + 2)))
            best = min(tries, key=lambda t: len(t[2]))
            if len(best[2]) <= LIMIT:
                break
        fmt, qq, data = best
        out = j['out'] + '.' + fmt
        with open(out, 'wb') as f:
            f.write(data)
        return {'sha256': j['sha256'], 'file': out, 'format': fmt, 'quality': qq, 'width': im.width, 'height': im.height, 'bytes': len(data)}
    except Exception as e:
        return {'sha256': j['sha256'], 'error': str(e)}
def sheet(s):
    W, H, PAD, COLS = 260, 180, 8, 6
    rows = (len(s['tiles']) + COLS - 1) // COLS
    out = Image.new('RGB', (COLS * (W + PAD) + PAD, rows * (H + 34 + PAD) + PAD + 30), 'white')
    d = ImageDraw.Draw(out)
    d.text((PAD, 8), s['title'], fill='black')
    for i, t in enumerate(s['tiles']):
        x = PAD + (i % COLS) * (W + PAD); y = 30 + PAD + (i // COLS) * (H + 34 + PAD)
        try:
            im = Image.open(t['file']); im.draft('RGB', (W * 2, H * 2)); im = im.convert('RGB'); im.thumbnail((W, H))
            out.paste(im, (x + (W - im.width) // 2, y + (H - im.height) // 2))
        except Exception:
            d.rectangle((x, y, x + W, y + H), outline='red')
        d.text((x, y + H + 2), t['label'][:44], fill='black')
        d.text((x, y + H + 16), t['label2'][:44], fill='#444444')
    out.save(s['out'], 'JPEG', quality=80)
    return s['out']
if __name__ == '__main__':
    jobs = json.load(open(sys.argv[1]))
    with Pool(4) as p:
        if len(sys.argv) > 3:
            res = p.map(sheet, jobs)
        else:
            res = p.map(job, jobs, chunksize=2)
    json.dump(res, open(sys.argv[2], 'w'))
`;

const run = promisify(execFile);

async function pillow(dir: string, jobs: unknown[], sheets = false): Promise<unknown[]> {
  const prog = join(dir, '.pillow-shrink.py');
  const jobsFile = join(dir, '.pillow-jobs.json');
  const resFile = join(dir, '.pillow-results.json');
  await writeFile(prog, PILLOW);
  await writeFile(jobsFile, JSON.stringify(jobs));
  await run('python3', ['-I', prog, jobsFile, resFile, ...(sheets ? ['sheets'] : [])], { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(await readFile(resFile, 'utf8'));
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** A category's contact sheet as a page: every chosen image with its shape, size, licence tier, origin and alt text. */
export function contactSheet(category: string, entries: readonly (CatalogueEntry & { tier: 1 | 2 | 3; bytes: number })[]): string {
  const tiles = entries.map((e, i) => `<figure><div class="pic"><img src="${esc(e.file)}" alt="" loading="lazy"></div><figcaption>
<b>${i + 1}. ${esc(e.shape ?? '')}</b> · ${e.width} × ${e.height} · ${Math.round(e.bytes / 1024)} KB · ${esc(TIER_LABEL[e.tier])}<br>
${esc(e.origin)} · ${esc(e.licence)}<br>${esc(e.alt ?? '')}</figcaption></figure>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(categoryLabel(category))}: web-size selection</title>
<style>body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#111;background:#fff}h1{font-size:20px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}figure{margin:0}
.pic{background:#eee;height:180px;display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:180px}
figcaption{margin-top:6px;font-size:12px;color:#222}</style></head><body>
<h1>${esc(categoryLabel(category))} (${esc(category)}): ${entries.length} image(s) for review</h1>
<div class="grid">
${tiles}
</div></body></html>`;
}

/* ── The command line ────────────────────────────────────────────────── */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}
const has = (name: string) => process.argv.includes(`--${name}`);
const num = (name: string, dflt: number) => { const v = Number(arg(name)); return arg(name) && Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt; };

async function flyttgo<T>(path: string): Promise<T[]> {
  const url = (process.env.FLYTTGO_SUPABASE_URL ?? '').replace(/\/$/, '');
  const key = process.env.FLYTTGO_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) throw new Error('FLYTTGO_SUPABASE_URL and FLYTTGO_SERVICE_ROLE_KEY are needed for --needs-from-flyttgo and --compare-flyttgo');
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` } });
    if (!res.ok) throw new Error(`FlyttGo ${path.split('?')[0]}: ${res.status} ${await res.text()}`);
    const page = await res.json() as T[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

interface FullEntry { sha256: string; bytes?: number; format?: string; origin?: string; near_duplicate_group?: number | null; unusable_reason?: string }

async function main() {
  const file = arg('library');
  const outDir = arg('out');
  if (!file || !outDir) throw new Error('say which catalogue and where to write: --library <catalogue.json> --out <dir> [--library-dir <dir>] [--full <catalogue.json>]');
  const dir = resolve(arg('library-dir') || dirname(resolve(file)));
  const out = resolve(outDir);
  const perCategory = num('per-category', DEFAULT_PER_CATEGORY);
  if (perCategory > MAX_PER_CATEGORY) throw new Error(`--per-category: at most ${MAX_PER_CATEGORY}`);
  const minSide = num('min-side', 800);
  const maxSide = num('max-side', 2000);
  const quality = Math.min(num('quality', 80), 95);
  const only = arg('category') || null;

  let entries = readCatalogue(JSON.parse(await readFile(file, 'utf8'))).images;
  if (only) entries = entries.filter(e => e.category === only);
  const full = new Map<string, FullEntry>();
  if (arg('full')) for (const f of JSON.parse(await readFile(arg('full')!, 'utf8')) as FullEntry[]) full.set(f.sha256, f);

  // What the templates need.
  let needs: Record<string, ShapeNeeds> | null = null;
  let needsSource = `defaults (${LIBRARY_SHAPES.map(s => `${s} ${DEFAULT_NEEDS[s]}`).join(', ')})`;
  if (has('needs-from-flyttgo')) {
    const templates = await flyttgo<{ id: string; industry: string[]; status: string; pages: { html: string }[] }>('site_templates?select=id,industry,status,pages&order=id');
    const images = await flyttgo<{ template_id: string; asset_key: string; slot: string | null; width: number | null; height: number | null }>(
      'site_template_images?select=template_id,asset_key,slot,width,height');
    needs = categoryNeeds(templates, images);
    needsSource = `the slots of FlyttGo's ${templates.filter(t => t.status !== 'retired').length} templates (read ${new Date().toISOString().slice(0, 10)})`;
  } else if (arg('needs')) {
    const raw = JSON.parse(await readFile(arg('needs')!, 'utf8')) as Record<string, Record<LibraryShape, number>>;
    needs = Object.fromEntries(Object.entries(raw).map(([c, s]) => [c, { slots: { ...zero(), ...s }, mostInATemplate: zero(), templates: 0 }]));
    needsSource = `--needs ${arg('needs')}`;
  }

  // Candidates, and what is refused before picking.
  const refused: { file: string; category: string; reason: string }[] = [];
  const byCategory = new Map<string, Candidate[]>();
  for (const e of entries) {
    const f = full.get(e.sha256);
    const path = resolve(dir, e.file);
    if (!path.startsWith(dir + sep)) { refused.push({ file: e.file, category: e.category, reason: 'outside --library-dir' }); continue; }
    let size: number;
    try { size = (await stat(path)).size; } catch { refused.push({ file: e.file, category: e.category, reason: 'its file is not in the folder' }); continue; }
    if (f?.unusable_reason) { refused.push({ file: e.file, category: e.category, reason: `marked unusable in the harvest` }); continue; }
    if (Math.max(e.width, e.height) < minSide) { refused.push({ file: e.file, category: e.category, reason: `smaller than ${minSide} px on its long side` }); continue; }
    const shape = e.shape ?? shapeOf(e.width, e.height);
    if (!shape) { refused.push({ file: e.file, category: e.category, reason: 'no size' }); continue; }
    const format = (f?.format ?? e.file.split('.').pop() ?? '').toLowerCase().replace('jpeg', 'jpg');
    const c: Candidate = {
      sha256: e.sha256, file: path, category: e.category, shape, width: e.width, height: e.height, bytes: f?.bytes ?? size, format,
      tier: licenceTier(e, f?.origin), group: groupOf(e, f?.near_duplicate_group), tags: tagsOf(e), author: authorOf(e.origin), entry: e,
    };
    byCategory.set(e.category, [...(byCategory.get(e.category) ?? []), c]);
  }

  const categories = LIBRARY_CATEGORIES.filter(c => (!only || c === only) && (byCategory.has(c) || needs?.[c]));
  const picked = categories.map(id => {
    const cands = byCategory.get(id) ?? [];
    const r = selectCategory(cands, perCategory, needs ? (needs[id] ?? null) : null);
    const available = zero();
    for (const c of onePerGroup(cands).kept) available[c.shape]++;
    return { id, needs: needs ? (needs[id] ?? null) : null, available, ...r };
  });

  await mkdir(out, { recursive: true });
  const chosen = picked.flatMap(p => p.chosen);
  const results = new Map<string, { file: string; sha256: string; width: number; height: number; bytes: number; format: string; quality: number }>();
  const shrink = !has('no-shrink');
  if (shrink) {
    for (const id of new Set(chosen.map(c => c.category))) await mkdir(join(out, id), { recursive: true });
    const jobs = chosen.map(c => ({ src: c.file, sha256: c.sha256, out: join(out, c.category, c.sha256.slice(0, 16)), quality,
                                     ...targetSize(c.width, c.height, maxSide) }));
    console.log(`shrinking ${jobs.length} image(s) with Pillow …`);
    for (const r of await pillow(out, jobs) as ({ sha256: string; error?: string; file: string; width: number; height: number; format: string; quality: number })[]) {
      if (r.error) { console.warn(`  ${r.sha256.slice(0, 16)}: ${r.error}`); continue; }
      // Facts from the bytes, never from the converter.
      const bytes = new Uint8Array(await readFile(r.file));
      const info = imageInfo(bytes);
      if (!info) { console.warn(`  ${r.file}: not readable as PNG, JPEG or WebP`); continue; }
      results.set(r.sha256, { file: relative(out, r.file), sha256: await sha256Hex(bytes), width: info.width, height: info.height,
                              bytes: bytes.byteLength, format: r.format, quality: r.quality });
    }
  }

  // The loader's catalogue.
  const webEntries: (CatalogueEntry & { tier: 1 | 2 | 3; bytes: number })[] = [];
  for (const c of chosen) {
    const r = results.get(c.sha256);
    if (!r) continue;
    webEntries.push({ ...webEntry(c.entry, r, { bytes: c.bytes }), tier: c.tier, bytes: r.bytes });
  }
  if (shrink) {
    const catalogue = { version: 1, images: webEntries.map(({ tier, bytes, ...e }) => e) };
    readCatalogue(catalogue); // the loader's own checks
    await writeFile(join(out, 'library-catalogue.json'), JSON.stringify(catalogue, null, 1));
  }
  const outBytes = (c: Candidate) => results.get(c.sha256)?.bytes;

  // The library's images already uploaded (read only): replaced or retired.
  let library: { replaced: number; retire: number; rows: number } | null = null;
  if (has('compare-flyttgo')) {
    const rows = await flyttgo<{ id: string; sha256: string; storage_path: string; category: string; shape: string; bytes: number; review_status: string }>(
      'image_library?select=id,sha256,storage_path,category,shape,bytes,review_status');
    const plan = rows.map(r => {
      const c = chosen.find(x => x.sha256 === r.sha256);
      const w = c ? results.get(c.sha256) : undefined;
      return w ? { ...r, action: 'replace', by_sha256: w.sha256, by_bytes: w.bytes, reason: `replaced by its web-size version (${w.sha256.slice(0, 12)})` }
               : { ...r, action: 'retire', reason: 'not in the web-size selection (storage: owner\'s decision 2026-10-30)' };
    });
    await writeFile(join(out, 'library-plan.json'), JSON.stringify({ made: new Date().toISOString(), images: plan }, null, 2));
    await writeFile(join(out, 'retire-library-originals.sql'), retireSql(plan.filter(p => p.review_status !== 'retired')));
    library = { rows: rows.length, replaced: plan.filter(p => p.action === 'replace').length, retire: plan.filter(p => p.action === 'retire').length };
    const kept = plan.filter(p => p.action === 'replace').reduce((s, p) => s + (p as { by_bytes: number }).by_bytes, 0);
    console.log(`library: ${rows.length} image(s) (${mb(rows.reduce((s, r) => s + (r.bytes ?? 0), 0))}); ${library.replaced} replaced by web-size versions (${mb(kept)}), ${library.retire} to retire`);
  }

  // Contact sheets.
  if (shrink) {
    const sheets = [];
    for (const id of new Set(webEntries.map(e => e.category))) {
      const list = webEntries.filter(e => e.category === id);
      await writeFile(join(out, `contact-${id}.html`), contactSheet(id, list));
      sheets.push({ title: `${categoryLabel(id)} (${id}): ${list.length} images, web size`, out: join(out, `contact-${id}.jpg`),
                    tiles: list.map((e, i) => ({ file: join(out, e.file), label: `${i + 1}. ${e.shape} ${e.width}x${e.height} ${Math.round(e.bytes / 1024)}KB`,
                                                 label2: `${TIER_LABEL[e.tier]} · ${e.origin}`.replace(/[^\x20-\x7e·]/g, '-') })) });
    }
    if (sheets.length) await pillow(out, sheets, true);
  }

  const total = { files: shrink ? webEntries.length : chosen.length, bytes: webEntries.reduce((s, e) => s + e.bytes, 0),
                  originalBytes: chosen.reduce((s, c) => s + c.bytes, 0) };
  const generated = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  await writeFile(join(out, 'selection.md'), selectionReport({
    categories: picked.map(p => ({ ...p, chosen: p.chosen.map(c => ({ ...c, outBytes: outBytes(c) })) })),
    refused, needsSource, total, shrunk: shrink, generated, library,
  }));
  await writeFile(join(out, 'selection.json'), JSON.stringify({
    made: generated, per_category: perCategory, min_side: minSide, max_side: maxSide, quality, needs: needsSource,
    categories: picked.map(p => ({ id: p.id, needs: p.needs, available: p.available, quotas: p.quotas })),
    chosen: chosen.map(c => ({ sha256: c.sha256, category: c.category, shape: c.shape, tier: c.tier, group: c.group, original_bytes: c.bytes,
                              web: results.get(c.sha256) ?? null })),
    skipped: [...picked.flatMap(p => p.skipped.map(s => ({ sha256: s.c.sha256, category: s.c.category, shape: s.c.shape, reason: s.reason }))),
              ...refused],
  }, null, 1));
  console.log(`chosen ${total.files} image(s)${shrink ? `, ${mb(total.bytes)} at web size (originals ${mb(total.originalBytes)})` : ''}; see ${join(out, 'selection.md')}`);
  for (const p of picked) console.log(`  ${p.id}: ${LIBRARY_SHAPES.map(s => `${s} ${p.chosen.filter(c => c.shape === s).length}`).join(', ')}`);
  console.log('local only: nothing was uploaded. Load with: node scripts/import-image-library.ts --library ' + join(outDir, 'library-catalogue.json'));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
