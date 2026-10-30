// ============================================================================
// FlyttGo — load a harvested image catalogue into the image library
// ============================================================================
//
// docs/WHITE_LABEL.md → Image library, "Catalogue". Reads a catalogue
// (JSON, format below and in readCatalogue(), _shared/image-library.ts) and
// the image files beside it, checks every image by its bytes and plans what
// would be added. By default it is a dry run: nothing is sent anywhere.
// With --upload it stores each new image in FlyttGo's storage
// (site-image-library/<category>/<sha256>.<ext>) and records it through
// admin_add_library_image() with the service key, as PENDING: a FlyttGo
// administrator reviews and approves each image in Admin → White label →
// Image library. --upload writes to FlyttGo's storage and database and
// needs the owner's approval, like the template importer's --to-flyttgo.
//
// Run with Node 22 (types are stripped):
//
//   node scripts/import-image-library.ts --library harvest/catalogue.json --library-dir harvest/images
//   FLYTTGO_SUPABASE_URL=https://<ref>.supabase.co FLYTTGO_SERVICE_ROLE_KEY=... \
//     node scripts/import-image-library.ts --library harvest/catalogue.json --library-dir harvest/images --upload
//
// Options:
//   --library <file>      the catalogue (required)
//   --library-dir <dir>   where its files are (default: the catalogue's folder)
//   --category ID         only one category
//   --limit N             only the first N images
//   --upload              store and record them (otherwise a dry run)
//
// Every image is refused, with the reason, when: its file is missing,
// outside the folder or not a PNG, JPEG or WebP by its bytes; it is larger
// than 8 MB; its SHA-256 or its size in pixels differ from the catalogue's;
// its category is unknown; or it has no licence or origin. A refused image
// is never stored. Images already in the library (same SHA-256) are left as
// they are; running it again is harmless.
// ============================================================================
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  LIBRARY_BUCKET, MAX_LIBRARY_IMAGE, libraryPath, readCatalogue, shapeOf, type CatalogueEntry, type LibraryShape,
} from '../supabase/functions/_shared/image-library.ts';
import { imageInfo, sha256Hex, type ImageMime } from '../supabase/functions/_shared/template-images.ts';
import { categoryLabel } from '../supabase/functions/_shared/site-template.ts';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}
const has = (name: string) => process.argv.includes(`--${name}`);
function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v.replace(/\/$/, '');
}

/** One catalogue image, checked: its bytes and what will be recorded, or why it is refused. */
export interface Planned {
  entry: CatalogueEntry;
  ok: boolean;
  problems: string[];
  bytes?: Uint8Array;
  mime?: ImageMime;
  shape?: LibraryShape;
  path?: string;
}

/** Check every image of a catalogue against its file. */
export async function plan(entries: CatalogueEntry[], dir: string): Promise<Planned[]> {
  const root = resolve(dir);
  const out: Planned[] = [];
  for (const e of entries) {
    const problems: string[] = [];
    const file = resolve(root, e.file);
    if (!file.startsWith(root + sep)) { out.push({ entry: e, ok: false, problems: ['the file is outside --library-dir'] }); continue; }
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await readFile(file)); } catch { out.push({ entry: e, ok: false, problems: [`no file ${e.file}`] }); continue; }
    if (bytes.byteLength > MAX_LIBRARY_IMAGE) problems.push(`larger than ${MAX_LIBRARY_IMAGE / 1024 / 1024} MB`);
    const info = imageInfo(bytes);
    if (!info) problems.push('not a PNG, JPEG or WebP image (checked by its bytes)');
    const sha = await sha256Hex(bytes);
    if (sha !== e.sha256) problems.push(`its SHA-256 is ${sha}, not the catalogue's`);
    if (info && (info.width !== e.width || info.height !== e.height)) {
      problems.push(`it is ${info.width} × ${info.height} px, not ${e.width} × ${e.height} as the catalogue says`);
    }
    const shape = e.shape ?? (info ? shapeOf(info.width, info.height) : null) ?? undefined;
    out.push({ entry: e, ok: problems.length === 0, problems, bytes, mime: info?.mime, shape,
               path: info ? libraryPath(e.category, e.sha256, info.mime) : undefined });
  }
  return out;
}

/** What admin_add_library_image() receives for a checked image. */
export function addPayload(p: Planned): Record<string, unknown> {
  const e = p.entry;
  return {
    path: p.path, sha256: e.sha256, mime: p.mime, width: e.width, height: e.height, bytes: p.bytes?.byteLength,
    category: e.category, shape: p.shape, tags: e.tags ?? [], alt: e.alt ?? null, origin: e.origin, licence: e.licence,
    licence_evidence: e.licence_evidence ?? null, sources: e.sources ?? [], focal_x: e.focal_x ?? null, focal_y: e.focal_y ?? null,
  };
}

/** Counts per category and shape, for the summary. */
export function summary(planned: Planned[]): string[] {
  const by = new Map<string, number>();
  for (const p of planned.filter(x => x.ok)) by.set(`${p.entry.category}\u0000${p.shape}`, (by.get(`${p.entry.category}\u0000${p.shape}`) ?? 0) + 1);
  return [...by.entries()].sort().map(([k, n]) => { const [c, s] = k.split('\u0000'); return `  ${categoryLabel(c)} · ${s}: ${n}`; });
}

async function upload(planned: Planned[]) {
  const url = env('FLYTTGO_SUPABASE_URL');
  const key = env('FLYTTGO_SERVICE_ROLE_KEY');
  const ok = planned.filter(x => x.ok);
  // Which are in the library already (by SHA-256): left as they are.
  const known = new Set<string>();
  for (let i = 0; i < ok.length; i += 100) {
    const shas = ok.slice(i, i + 100).map(p => p.entry.sha256).join(',');
    const res = await fetch(`${url}/rest/v1/image_library?select=sha256&sha256=in.(${shas})`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`FlyttGo: ${res.status} ${await res.text()}`);
    for (const r of await res.json() as { sha256: string }[]) known.add(r.sha256);
  }
  let added = 0;
  for (const p of ok.filter(x => !known.has(x.entry.sha256))) {
    const up = await fetch(`${url}/storage/v1/object/${LIBRARY_BUCKET}/${p.path}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': p.mime!, 'x-upsert': 'false' },
      body: p.bytes as unknown as BodyInit,
    });
    // Already there (same path: the same hash): fine, the file is the same.
    if (!up.ok && up.status !== 409 && !/exists|duplicate/i.test(await up.clone().text())) {
      throw new Error(`upload ${p.path}: ${up.status} ${await up.text()}`);
    }
    const res = await fetch(`${url}/rest/v1/rpc/admin_add_library_image`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: addPayload(p) }),
    });
    if (!res.ok) throw new Error(`${p.entry.file}: ${res.status} ${await res.text()}`);
    const row = await res.json() as { review_status: string };
    added++;
    console.log(`  ${p.path}: ${row.review_status}`);
  }
  console.log(`added ${added} image(s) as pending; ${known.size} were already in the library and are left as they are`);
}

async function main() {
  const file = arg('library');
  if (!file) throw new Error('say which catalogue: --library <catalogue.json> [--library-dir <dir>]');
  const dir = arg('library-dir') || dirname(resolve(file));
  let entries = readCatalogue(JSON.parse(await readFile(file, 'utf8'))).images;
  const category = arg('category');
  if (category) entries = entries.filter(e => e.category === category);
  const limit = Number(arg('limit'));
  if (Number.isFinite(limit) && limit > 0) entries = entries.slice(0, limit);
  const planned = await plan(entries, dir);
  const refused = planned.filter(p => !p.ok);
  console.log(`${planned.length - refused.length} of ${planned.length} image(s) can be added (as pending):`);
  for (const line of summary(planned)) console.log(line);
  if (refused.length) {
    console.log(`${refused.length} refused:`);
    for (const p of refused) console.log(`  ${p.entry.file}: ${p.problems.join('; ')}`);
  }
  if (has('upload')) await upload(planned);
  else console.log('dry run: nothing was sent. Add --upload (with the owner\'s approval) to store them in FlyttGo.');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
