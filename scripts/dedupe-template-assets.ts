// ============================================================================
// FlyttGo — keep one stored copy of each template image (storage saving)
// ============================================================================
//
// docs/WHITE_LABEL.md → Image library, "Storage" (owner's decision
// 2026-10-30; migration 00025). The importer stored every template's images
// in its own folder (site-template-assets/<template id>/hero.1.jpg …), and
// almost every imported template carries the same photos, so the bucket
// holds the same picture hundreds of times. This script keeps one copy per
// picture (by SHA-256) at
//
//   site-template-assets/shared/<sha256>.<ext>
//
// points every template's asset and image slot (site_template_images.url)
// at it, and removes the per-template copies no template uses any more.
// Thumbnails are per template and are never shared, moved or removed.
//
// A DRY RUN by default: it reads the templates, their image slots and the
// bucket's listing with the service key (nothing is written) and reports
// what it would do and the storage it would save; --out (default
// template-asset-dedupe/) receives plan.json. A slot's SHA-256 comes from
// site_template_images; a file without one is downloaded and hashed
// (--hash-unknown) or else left as it is.
//
// --apply (needs the owner's approval: it writes to FlyttGo's storage and
// database), in this order, and safe to run again after any interruption
// (each run plans from what FlyttGo holds then):
//   1. copies one file of each picture to shared/<sha256>.<ext> (when not
//      there yet) and downloads every shared copy to check its SHA-256;
//   2. moves every template in one transaction (share_site_template_assets(),
//      00025, server only): assets and image slots point at the shared copy,
//      each move is recorded, and every thumbnail keeps its state (a
//      recorded picture key is recomputed with the new addresses: the
//      gallery never shows other photos than before);
//   3. reads the templates again and checks that every address they use now
//      answers with an image;
//   4. only then removes the earlier copies: files in a template's folder
//      that were moved (recorded in site_template_asset_moves, or moved in
//      this run), that no asset, image slot or slot history uses, and whose
//      shared copy exists. Nothing else in the bucket is touched.
//
// The image library's retired photos (--retired-files): lists the files in
// site-image-library of library images that are retired (their records stay:
// images are never deleted as records); with --apply they are removed from
// storage. Needs 00025 (an image whose file was removed cannot be approved
// again until its file is uploaded again).
//
// Run with Node 22.21 or later (types are stripped). Behind an HTTPS proxy
// Node's own fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set:
//
//   NODE_USE_ENV_PROXY=1 FLYTTGO_SUPABASE_URL=https://<ref>.supabase.co FLYTTGO_SERVICE_ROLE_KEY=... \
//     node scripts/dedupe-template-assets.ts                 # dry run
//   ... node scripts/dedupe-template-assets.ts --apply         # with the owner's approval
//   ... node scripts/dedupe-template-assets.ts --retired-files [--apply]
//
// Options:
//   --apply            perform it (otherwise a dry run: nothing is written)
//   --hash-unknown     download and hash template files whose SHA-256 is not recorded
//   --out <dir>        where the dry run writes plan.json (default template-asset-dedupe)
//   --retired-files    the library's retired photos' files instead
// ============================================================================
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LIBRARY_BUCKET } from '../supabase/functions/_shared/image-library.ts';
import { imageInfo, sha256Hex } from '../supabase/functions/_shared/template-images.ts';
import { bucketPath } from './redraw-thumbnails.ts';

export const TEMPLATE_BUCKET = 'site-template-assets';
export const SHARED_FOLDER = 'shared';

/** A template as site_templates holds it (only what the plan reads). */
export interface TemplateRow { id: string; assets: { key: string; url: string; images?: string }[] }
/** An image slot as site_template_images holds it. */
export interface ImageRow {
  template_id: string; asset_key: string; url: string; sha256: string | null;
  history?: { url?: string }[] | null;
}
/** A stored file of the bucket: its path, size (bytes) and type, as the Storage API lists it. */
export interface StoredObject { path: string; size: number; mimetype?: string | null }
/** A recorded move (site_template_asset_moves, 00025). */
export interface RecordedMove { template_id: string; asset_key: string; from_url: string; to_url: string; sha256: string }
/** One slot to point at its shared copy, as share_site_template_assets() takes it. */
export interface Move { template: string; key: string; from: string; to: string; sha256: string }

export interface SharedCopy {
  sha256: string; path: string; url: string; size: number;
  /** Already in the bucket; otherwise copied from `source` first. */
  exists: boolean;
  source: string | null;
  /** How many slots use it after the move. */
  slots: number;
  templates: number;
}
export interface DedupePlan {
  shared: SharedCopy[];
  moves: Move[];
  /** Earlier per-template copies to remove once the moves are checked. */
  remove: { path: string; size: number; sha256: string }[];
  /** Slots that are left as they are, with the reason. */
  left: { template: string; key: string; url: string; reason: string }[];
  totals: {
    bucketFiles: number; bucketBytes: number; thumbnails: number; thumbnailBytes: number;
    removeFiles: number; removeBytes: number; newFiles: number; newBytes: number; savedBytes: number;
    otherFiles: number; otherBytes: number;
  };
}

const EXT_BY_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** A file's extension for its shared copy: from its stored type, else its name (jpeg → jpg); null when not PNG, JPEG or WebP. */
export function sharedExt(path: string, mimetype?: string | null): string | null {
  const byMime = mimetype ? EXT_BY_MIME[mimetype.split(';')[0].trim()] : undefined;
  if (byMime) return byMime;
  const ext = (/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? '').toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ['jpg', 'png', 'webp'].includes(ext) ? ext : null;
}

/** Where a picture's shared copy is stored. */
export const sharedPath = (sha256: string, ext: string) => `${SHARED_FOLDER}/${sha256}.${ext}`;
/** A thumbnail's file (thumbnail.jpg from the importer, thumbnail-<hex>.jpg from a redraw): never shared or removed. */
export const isThumbnailFile = (path: string) => /^[^/]+\/thumbnail(-[0-9a-f]{12,64})?\.jpg$/.test(path);
/** The public address of a file of the template bucket. */
export const bucketUrl = (supabaseUrl: string, path: string) =>
  `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${TEMPLATE_BUCKET}/${path}`;

/**
 * The plan, from what FlyttGo holds: which slots move to which shared copy,
 * which shared copies are made, and which earlier copies may then go.
 * `hashes` are SHA-256s of files whose slot records none (--hash-unknown).
 */
export function planDedupe(input: {
  supabaseUrl: string; templates: readonly TemplateRow[]; images: readonly ImageRow[]; objects: readonly StoredObject[];
  moved?: readonly RecordedMove[]; hashes?: ReadonlyMap<string, string>;
}): DedupePlan {
  const { supabaseUrl, templates, images, objects } = input;
  const byPath = new Map(objects.map(o => [o.path, o]));
  const imageOf = new Map(images.map(i => [`${i.template_id}\u0000${i.asset_key}`, i]));
  const moves: Move[] = [];
  const left: DedupePlan['left'] = [];
  const shared = new Map<string, SharedCopy>();
  const fromSha = new Map<string, string>();
  const slotsOf = new Map<string, Set<string>>();

  const copyOf = (sha: string, ext: string): SharedCopy => {
    // One copy per picture: the first extension seen is kept for every slot.
    let c = shared.get(sha);
    if (!c) {
      const existing = objects.find(o => o.path.startsWith(`${SHARED_FOLDER}/${sha}.`));
      const path = existing?.path ?? sharedPath(sha, ext);
      c = { sha256: sha, path, url: bucketUrl(supabaseUrl, path), size: existing?.size ?? 0, exists: !!existing, source: null, slots: 0, templates: 0 };
      shared.set(sha, c);
    }
    return c;
  };

  for (const t of templates) {
    for (const a of t.assets ?? []) {
      if (a.key === 'thumbnail') continue;
      const path = bucketPath(a.url, TEMPLATE_BUCKET);
      if (!path) { left.push({ template: t.id, key: a.key, url: a.url, reason: 'not in the template bucket' }); continue; }
      const image = imageOf.get(`${t.id}\u0000${a.key}`);
      if (path.startsWith(`${SHARED_FOLDER}/`)) {
        const sha = /^shared\/([0-9a-f]{64})\./.exec(path)?.[1];
        if (sha) { const c = copyOf(sha, sharedExt(path) ?? 'jpg'); c.slots++; slotsOf.set(sha, (slotsOf.get(sha) ?? new Set()).add(t.id)); }
        continue;
      }
      if (!path.startsWith(`${t.id}/`)) { left.push({ template: t.id, key: a.key, url: a.url, reason: "not in the template's own folder" }); continue; }
      if (image && image.url !== a.url) { left.push({ template: t.id, key: a.key, url: a.url, reason: 'its recorded image has another address' }); continue; }
      const obj = byPath.get(path);
      if (!obj) { left.push({ template: t.id, key: a.key, url: a.url, reason: 'its file is not in storage' }); continue; }
      const sha = image?.sha256 ?? input.hashes?.get(path) ?? null;
      if (!sha) { left.push({ template: t.id, key: a.key, url: a.url, reason: 'no SHA-256 recorded (run with --hash-unknown)' }); continue; }
      const ext = sharedExt(path, obj.mimetype);
      if (!ext) { left.push({ template: t.id, key: a.key, url: a.url, reason: 'not a PNG, JPEG or WebP file' }); continue; }
      const c = copyOf(sha, ext);
      if (!c.exists && !c.source) { c.source = path; c.size = obj.size; }
      c.slots++;
      slotsOf.set(sha, (slotsOf.get(sha) ?? new Set()).add(t.id));
      moves.push({ template: t.id, key: a.key, from: a.url, to: c.url, sha256: sha });
      fromSha.set(path, sha);
    }
  }
  for (const [sha, ts] of slotsOf) shared.get(sha)!.templates = ts.size;

  // What is still used once the moves are made: every asset (thumbnails
  // too), every image slot and every address in a slot's history.
  const movedTo = new Map(moves.map(m => [m.from, m.to]));
  const used = new Set<string>();
  for (const t of templates) for (const a of t.assets ?? []) {
    const p = bucketPath(movedTo.get(a.url) ?? a.url, TEMPLATE_BUCKET);
    if (p) used.add(p);
  }
  for (const i of images) {
    for (const u of [movedTo.get(i.url) ?? i.url, ...(i.history ?? []).map(h => h?.url)]) {
      const p = bucketPath(u, TEMPLATE_BUCKET);
      if (p) used.add(p);
    }
  }
  // Earlier copies: moved now, or recorded as moved by an earlier run.
  for (const m of input.moved ?? []) {
    const p = bucketPath(m.from_url, TEMPLATE_BUCKET);
    if (p && !fromSha.has(p)) fromSha.set(p, m.sha256);
  }
  const remove: DedupePlan['remove'] = [];
  for (const [path, sha] of fromSha) {
    const obj = byPath.get(path);
    if (!obj || used.has(path) || isThumbnailFile(path) || path.startsWith(`${SHARED_FOLDER}/`)) continue;
    const c = shared.get(sha);
    if (!c || !(c.exists || c.source)) continue;
    remove.push({ path, size: obj.size, sha256: sha });
  }
  remove.sort((a, b) => a.path.localeCompare(b.path));

  const sum = (xs: readonly { size: number }[]) => xs.reduce((s, x) => s + (x.size || 0), 0);
  const thumbs = objects.filter(o => isThumbnailFile(o.path));
  const fresh = [...shared.values()].filter(c => !c.exists && c.source);
  const removing = new Set(remove.map(r => r.path));
  const others = objects.filter(o => !isThumbnailFile(o.path) && !removing.has(o.path));
  return {
    shared: [...shared.values()].sort((a, b) => b.slots - a.slots || a.sha256.localeCompare(b.sha256)),
    moves, remove, left,
    totals: {
      bucketFiles: objects.length, bucketBytes: sum(objects), thumbnails: thumbs.length, thumbnailBytes: sum(thumbs),
      removeFiles: remove.length, removeBytes: sum(remove), newFiles: fresh.length, newBytes: sum(fresh),
      savedBytes: sum(remove) - sum(fresh), otherFiles: others.length, otherBytes: sum(others),
    },
  };
}

/** The retired library images whose files are still stored (--retired-files). */
export function retiredFiles(rows: readonly { storage_path: string; review_status: string; bytes?: number | null }[],
                             objects: readonly StoredObject[]): StoredObject[] {
  const byPath = new Map(objects.map(o => [o.path, o]));
  const keep = new Set(rows.filter(r => r.review_status !== 'retired').map(r => r.storage_path));
  return rows.filter(r => r.review_status === 'retired' && !keep.has(r.storage_path) && byPath.has(r.storage_path))
    .map(r => byPath.get(r.storage_path)!).sort((a, b) => a.path.localeCompare(b.path));
}

export const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** The plan in words, for the console. */
export function describePlan(p: DedupePlan): string[] {
  const t = p.totals;
  const lines = [
    `bucket ${TEMPLATE_BUCKET}: ${t.bucketFiles} files, ${mb(t.bucketBytes)} (thumbnails ${t.thumbnails}, ${mb(t.thumbnailBytes)}: kept as they are)`,
    `${p.moves.length} slot(s) of ${new Set(p.moves.map(m => m.template)).size} template(s) move to ${p.shared.length} shared picture(s)` +
      ` (${t.newFiles} to copy, ${mb(t.newBytes)}; ${p.shared.filter(c => c.exists).length} already there)`,
    `${t.removeFiles} earlier copies to remove afterwards: ${mb(t.removeBytes)}`,
    `storage saved: ${mb(t.savedBytes)}; the bucket afterwards: ${t.bucketFiles - t.removeFiles + t.newFiles} files, ${mb(t.bucketBytes - t.savedBytes)}`,
  ];
  for (const c of p.shared) lines.push(`  ${c.path}: ${c.slots} slot(s) in ${c.templates} template(s), ${mb(c.size)}${c.exists ? ' (there)' : ''}`);
  if (p.left.length) {
    lines.push(`${p.left.length} slot(s) left as they are:`);
    const by = new Map<string, number>();
    for (const l of p.left) by.set(l.reason, (by.get(l.reason) ?? 0) + 1);
    for (const [r, n] of by) lines.push(`  ${n}: ${r}`);
  }
  return lines;
}

/* ── FlyttGo (service key) ──────────────────────────────────────────── */

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v.replace(/\/$/, '');
}

interface Api {
  url: string;
  rows<T>(path: string): Promise<T[]>;
  table<T>(path: string): Promise<T[] | null>;
  list(bucket: string, prefix: string): Promise<{ name: string; id: string | null; metadata: { size?: number; mimetype?: string } | null }[]>;
  rpc<T>(name: string, body: unknown): Promise<T>;
  send(method: string, path: string, body: unknown): Promise<Response>;
}

function api(): Api {
  const url = env('FLYTTGO_SUPABASE_URL');
  const key = env('FLYTTGO_SERVICE_ROLE_KEY');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rows = async <T>(path: string): Promise<T[]> => {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const res = await fetch(`${url}/rest/v1/${path}`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
      if (!res.ok) throw new Error(`${path.split('?')[0]}: ${res.status} ${await res.text()}`);
      const page = await res.json() as T[];
      out.push(...page);
      if (page.length < 1000) return out;
    }
  };
  return {
    url, rows,
    // A table that may not exist yet (before 00025): null.
    async table<T>(path: string) {
      try { return await rows<T>(path); } catch (e) { if (/\b404\b|PGRST205|42P01/.test(String((e as Error).message))) return null; throw e; }
    },
    async list(bucket, prefix) {
      const out: Awaited<ReturnType<Api['list']>> = [];
      for (let offset = 0; ; offset += 1000) {
        const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
          method: 'POST', headers, body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
        });
        if (!res.ok) throw new Error(`list ${bucket}/${prefix}: ${res.status} ${await res.text()}`);
        const page = await res.json() as Awaited<ReturnType<Api['list']>>;
        out.push(...page);
        if (page.length < 1000) return out;
      }
    },
    async rpc<T>(name: string, body: unknown) {
      const res = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
      return await res.json() as T;
    },
    send: (method, path, body) => fetch(`${url}${path}`, { method, headers, body: JSON.stringify(body) }),
  };
}

/** Every file of a bucket, one folder deep (folders are listed by name, files with an id). */
async function listBucket(a: Api, bucket: string): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  for (const top of await a.list(bucket, '')) {
    if (top.id) { out.push({ path: top.name, size: top.metadata?.size ?? 0, mimetype: top.metadata?.mimetype ?? null }); continue; }
    for (const f of await a.list(bucket, `${top.name}/`)) {
      if (f.id) out.push({ path: `${top.name}/${f.name}`, size: f.metadata?.size ?? 0, mimetype: f.metadata?.mimetype ?? null });
    }
  }
  return out;
}

async function download(url: string): Promise<{ ok: boolean; bytes?: Uint8Array; type?: string; status: number }> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), type: (res.headers.get('content-type') ?? '').split(';')[0] };
}

async function readState(a: Api, hashUnknown: boolean) {
  const templates = await a.rows<TemplateRow>('site_templates?select=id,assets&order=id');
  const images = await a.rows<ImageRow>('site_template_images?select=template_id,asset_key,url,sha256,history&order=template_id,asset_key');
  const moved = await a.table<RecordedMove>('site_template_asset_moves?select=template_id,asset_key,from_url,to_url,sha256');
  const objects = await listBucket(a, TEMPLATE_BUCKET);
  const hashes = new Map<string, string>();
  if (hashUnknown) {
    const known = new Set(images.filter(i => i.sha256).map(i => bucketPath(i.url, TEMPLATE_BUCKET)));
    const assetPaths = new Set(templates.flatMap(t => t.assets.filter(x => x.key !== 'thumbnail').map(x => bucketPath(x.url, TEMPLATE_BUCKET))));
    for (const o of objects.filter(x => assetPaths.has(x.path) && !known.has(x.path))) {
      const d = await download(bucketUrl(a.url, o.path));
      if (d.ok && d.bytes) hashes.set(o.path, await sha256Hex(d.bytes));
    }
  }
  return { templates, images, moved, objects, hashes };
}

async function apply(a: Api, plan: DedupePlan) {
  // 1. The shared copies: copied once, each checked by its SHA-256.
  for (const c of plan.shared) {
    if (!c.exists) {
      if (!c.source) throw new Error(`${c.path}: no file to copy it from`);
      const res = await a.send('POST', '/storage/v1/object/copy', { bucketId: TEMPLATE_BUCKET, sourceKey: c.source, destinationKey: c.path });
      if (!res.ok && res.status !== 409 && !/exists|duplicate/i.test(await res.clone().text())) {
        throw new Error(`copy ${c.source} → ${c.path}: ${res.status} ${await res.text()}`);
      }
    }
    const d = await download(c.url);
    if (!d.ok || !d.bytes) throw new Error(`${c.path} does not answer (${d.status}); nothing was moved`);
    const sha = await sha256Hex(d.bytes);
    if (sha !== c.sha256 || !imageInfo(d.bytes)) {
      throw new Error(`${c.path} is not the picture it is named after (SHA-256 ${sha}); nothing was moved. Remove it and run again.`);
    }
    console.log(`  shared ${c.path}: checked`);
  }
  // 2. Every template in one transaction.
  if (plan.moves.length) {
    const r = await a.rpc<Record<string, number>>('share_site_template_assets', { p_moves: plan.moves });
    console.log(`moved ${r.moved} slot(s) of ${r.templates} template(s) (${r.already} already moved); ${r.thumbnails_rekeyed} thumbnail record(s) recomputed`);
  }
  // 3. Read again and check every address the templates use now.
  const after = await readState(a, false);
  const urls = new Set<string>();
  for (const t of after.templates) for (const x of t.assets) if (x.key !== 'thumbnail') urls.add(x.url);
  for (const i of after.images) urls.add(i.url);
  const moving = new Set(plan.remove.map(r => r.path));
  for (const u of urls) {
    const p = bucketPath(u, TEMPLATE_BUCKET);
    if (p && moving.has(p)) throw new Error(`${u} is still used; nothing was removed`);
  }
  for (const u of [...urls].filter(x => bucketPath(x, TEMPLATE_BUCKET)?.startsWith(`${SHARED_FOLDER}/`))) {
    const d = await download(u);
    if (!d.ok || !d.bytes || !imageInfo(d.bytes)) throw new Error(`${u} does not answer with an image (${d.status}); nothing was removed`);
  }
  console.log(`checked: every shared address answers with its picture`);
  // 4. Only then the earlier copies, from what FlyttGo holds now.
  const now = planDedupe({ supabaseUrl: a.url, ...after });
  if (now.moves.length) throw new Error(`${now.moves.length} slot(s) are not moved yet; nothing was removed. Run again.`);
  for (let i = 0; i < now.remove.length; i += 100) {
    const batch = now.remove.slice(i, i + 100).map(r => r.path);
    const res = await a.send('DELETE', `/storage/v1/object/${TEMPLATE_BUCKET}`, { prefixes: batch });
    if (!res.ok) throw new Error(`remove: ${res.status} ${await res.text()}`);
  }
  console.log(`removed ${now.remove.length} earlier copies (${mb(now.totals.removeBytes)})`);
}

async function retired(a: Api, doApply: boolean) {
  const rows = await a.rows<{ storage_path: string; review_status: string; bytes: number | null }>('image_library?select=storage_path,review_status,bytes');
  const files = retiredFiles(rows, await listBucket(a, LIBRARY_BUCKET));
  const total = files.reduce((s, f) => s + f.size, 0);
  console.log(`${rows.filter(r => r.review_status === 'retired').length} retired library image(s); ${files.length} with a stored file (${mb(total)})`);
  if (!doApply) {
    for (const f of files) console.log(`  would remove ${LIBRARY_BUCKET}/${f.path} (${mb(f.size)})`);
    console.log('dry run: nothing was removed. Add --apply (with the owner\'s approval); the records stay.');
    return;
  }
  if (await a.table('site_template_asset_moves?select=template_id&limit=1') === null) {
    throw new Error('apply migration 00025 first: it keeps an image whose file was removed from being approved again');
  }
  for (let i = 0; i < files.length; i += 100) {
    const res = await a.send('DELETE', `/storage/v1/object/${LIBRARY_BUCKET}`, { prefixes: files.slice(i, i + 100).map(f => f.path) });
    if (!res.ok) throw new Error(`remove: ${res.status} ${await res.text()}`);
  }
  console.log(`removed ${files.length} file(s) of retired library images (${mb(total)}); their records stay`);
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (n: string) => argv.includes(`--${n}`);
  const i = argv.indexOf('--out');
  const out = i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'template-asset-dedupe';
  const a = api();
  if (has('retired-files')) return retired(a, has('apply'));

  const state = await readState(a, has('hash-unknown'));
  if (state.moved === null) console.log('(migration 00025 is not applied yet: no moves are recorded; --apply needs it)');
  const plan = planDedupe({ supabaseUrl: a.url, templates: state.templates, images: state.images, objects: state.objects,
                            moved: state.moved ?? [], hashes: state.hashes });
  for (const line of describePlan(plan)) console.log(line);
  if (!has('apply')) {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'plan.json'), JSON.stringify({ planned_at: new Date().toISOString(), ...plan }, null, 2));
    console.log(`dry run: nothing was written to FlyttGo; the plan is in ${join(out, 'plan.json')}. Add --apply (with the owner's approval).`);
    return;
  }
  if (state.moved === null) throw new Error('apply migration 00025 first (share_site_template_assets)');
  await apply(a, plan);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
