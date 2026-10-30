// ============================================================================
// FlyttGo — draw the gallery's thumbnails again with the image library
// ============================================================================
//
// docs/WHITE_LABEL.md → Image library, "Thumbnails" (owner's decision
// 2026-10-30, docs/DECISIONS.md #47; migration 00024). A template's thumbnail
// records the images it was drawn with; once its category's library photos
// are approved, rejected or retired, or its own image changes, it is stale
// (admin_site_template_thumbnails(), computed by the database). This script
// draws the stale ones again: for each template it reads the stored pages
// and the resolved image map (site_template_image_map(template), without a
// company) from FlyttGo with the service key, renders the home page as the
// template's own demo (demoBrand(): its name and colours, sample contact
// details) with those images, and takes the picture exactly as the importer
// does (scripts/template-snapshot.ts: a desktop window of 1440 × 900, saved as
// a 720 × 450 JPEG, images only from the hosts the page uses).
//
// A dry run by default: the pictures go to a local folder (--out, default
// thumbnail-redraw/) with plan.json, and nothing is written to FlyttGo.
// With --upload each picture is stored at
//   site-template-assets/<id>/thumbnail-<first 12 hex of the images>.jpg
// (a new name for new images, so no browser shows the old picture from its
// cache; the earlier file stays) and recorded with
// record_site_template_thumbnail() (server only) with the SHA-256 of the
// images it was drawn with. --upload writes to FlyttGo's storage and
// database and needs the owner's approval, like the importer's --to-flyttgo.
//
// It runs where a browser is (Playwright with a Chromium: `npm i -D
// playwright && npx playwright install chromium`): the database and the Edge
// Functions cannot draw a page. Run with Node 22.21 or later (types are
// stripped). Behind an HTTPS proxy Node's own fetch ignores HTTPS_PROXY
// unless NODE_USE_ENV_PROXY=1 is set (the browser takes the proxy from
// HTTPS_PROXY by itself):
//
//   NODE_USE_ENV_PROXY=1 FLYTTGO_SUPABASE_URL=https://<ref>.supabase.co FLYTTGO_SERVICE_ROLE_KEY=... \
//     node scripts/redraw-thumbnails.ts                      # stale ones, dry run
//   ... node scripts/redraw-thumbnails.ts --category appointments --upload
//
// Options:
//   (none)               the stale thumbnails
//   --missing            also the templates without a thumbnail
//   --category ID        only one catalogue category
//   --ids a,b            these templates, whatever their state
//   --all                every template (not retired), whatever its state
//   --limit N            only the first N
//   --out <dir>          where the dry run writes (default thumbnail-redraw)
//   --upload             store and record them in FlyttGo (otherwise a dry run)
// ============================================================================
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  demoBrand, hostsOf, renderTemplatePage, type TemplateAsset, type TemplatePage,
} from '../supabase/functions/_shared/site-template.ts';
import {
  imageUrls, renderImages, thumbnailImagesHash, thumbnailPath, type ImageMap,
} from '../supabase/functions/_shared/image-library.ts';
import { snapshotter } from './template-snapshot.ts';

/** One template's thumbnail as admin_site_template_thumbnails() (00024) lists it. */
export interface ThumbnailRow {
  template_id: string; name: string; category: string | null; status: string; mode: 'library' | 'assets';
  thumbnail_url: string | null; drawn_with: string | null; images: string; state: 'fresh' | 'stale' | 'missing';
}

export interface RedrawOptions {
  ids: string[] | null; category: string | null; all: boolean; missing: boolean; limit: number | null;
  out: string; upload: boolean;
}

/** The command line, read. */
export function parseArgs(argv: readonly string[]): RedrawOptions {
  const arg = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return null;
    const v = argv[i + 1];
    return v && !v.startsWith('--') ? v : '';
  };
  const ids = arg('ids')?.split(',').map(s => s.trim()).filter(Boolean) ?? null;
  const limit = Number(arg('limit'));
  return {
    ids: ids?.length ? ids : null, category: arg('category') || null, all: argv.includes('--all'), missing: argv.includes('--missing'),
    limit: Number.isFinite(limit) && limit > 0 ? limit : null, out: arg('out') || 'thumbnail-redraw', upload: argv.includes('--upload'),
  };
}

/**
 * Which templates to draw: the stale ones (and the missing ones with
 * --missing), or every one named with --ids, or all with --all; in one
 * category with --category; the first N with --limit.
 */
export function selectTemplates(rows: readonly ThumbnailRow[], o: Pick<RedrawOptions, 'ids' | 'category' | 'all' | 'missing' | 'limit'>): ThumbnailRow[] {
  let out = rows.filter(r => (!o.category || r.category === o.category)
    && (o.ids ? o.ids.includes(r.template_id) : o.all || r.state === 'stale' || (o.missing && r.state === 'missing')));
  if (o.limit) out = out.slice(0, o.limit);
  return out;
}

/** The ids asked for with --ids that FlyttGo does not have (or that are retired). */
export const unknownIds = (rows: readonly ThumbnailRow[], ids: readonly string[] | null) =>
  (ids ?? []).filter(id => !rows.some(r => r.template_id === id));

/**
 * The home page as the thumbnail shows it: the template's own demo
 * (demoBrand()) with the resolved images (library ones by their public
 * address; a map without a company has no private uploads), and the hosts
 * the browser may load images from.
 */
export function thumbnailPage(t: { name: string; pages: TemplatePage[]; assets: TemplateAsset[] }, map: ImageMap, supabaseUrl: string): { html: string; hosts: string[] } | null {
  const home = t.pages.find(p => p.path === '/') ?? t.pages[0];
  if (!home) return null;
  const images = renderImages(map, supabaseUrl);
  const hosts = hostsOf([...t.assets, ...imageUrls(images)]);
  const html = renderTemplatePage(home.html, {
    brand: demoBrand(t), assets: t.assets, pageUrl: () => '#', bookingUrl: '#', sellerNotice: 'Seller notice', images, assetHosts: hosts,
  });
  return { html, hosts };
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v.replace(/\/$/, '');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const url = env('FLYTTGO_SUPABASE_URL');
  const key = env('FLYTTGO_SERVICE_ROLE_KEY');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async <T>(name: string, body: unknown): Promise<T> => {
    const res = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
    return await res.json() as T;
  };

  const rows = await rpc<ThumbnailRow[]>('admin_site_template_thumbnails', { p_category: o.category });
  const counts = (s: ThumbnailRow['state']) => rows.filter(r => r.state === s).length;
  console.log(`${rows.length} template(s)${o.category ? ` in ${o.category}` : ''}: ${counts('stale')} stale, ${counts('missing')} without a thumbnail, ${counts('fresh')} fresh`);
  const missingIds = unknownIds(rows, o.ids);
  if (missingIds.length) console.warn(`not found (or retired): ${missingIds.join(', ')}`);
  const chosen = selectTemplates(rows, o);
  if (!chosen.length) { console.log('nothing to draw'); return; }

  const snap = await snapshotter();
  if (!snap) throw new Error('Playwright is not available: npm i -D playwright && npx playwright install chromium');
  const plan: { id: string; state: string; images: string; path: string; file?: string; uploaded?: boolean; note?: string }[] = [];
  try {
    if (!o.upload) await mkdir(o.out, { recursive: true });
    for (const r of chosen) {
      const res = await fetch(`${url}/rest/v1/site_templates?select=id,name,pages,assets&id=eq.${encodeURIComponent(r.template_id)}`, { headers });
      if (!res.ok) throw new Error(`${r.template_id}: ${res.status} ${await res.text()}`);
      const [t] = await res.json() as { id: string; name: string; pages: TemplatePage[]; assets: TemplateAsset[] }[];
      const map = await rpc<ImageMap>('site_template_image_map', { p_template: r.template_id, p_org: null });
      const page = t ? thumbnailPage(t, map, url) : null;
      if (!page) { console.warn(`${r.template_id}: no home page, skipped`); continue; }
      const images = await thumbnailImagesHash(map);
      // Recorded with the images it was drawn with, even if they changed since the list was read (then it is stale again).
      const note = images === r.images ? undefined : 'the images changed while the list was read; this picture shows the newer ones';
      const jpeg = await snap.thumbnail(page.html, page.hosts);
      const path = thumbnailPath(r.template_id, images);
      if (!o.upload) {
        const file = join(o.out, `${r.template_id}.jpg`);
        await writeFile(file, jpeg);
        plan.push({ id: r.template_id, state: r.state, images, path, file, note });
        console.log(`drew ${r.template_id} (${r.state}, ${map.mode}): ${file}${note ? ` (${note})` : ''}`);
        continue;
      }
      const up = await fetch(`${url}/storage/v1/object/site-template-assets/${path}`, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
        body: jpeg as unknown as BodyInit,
      });
      if (!up.ok) throw new Error(`upload ${path}: ${up.status} ${await up.text()}`);
      await rpc('record_site_template_thumbnail', { p_template: r.template_id, p_path: path, p_images: images });
      plan.push({ id: r.template_id, state: r.state, images, path, uploaded: true, note });
      console.log(`stored ${r.template_id} (${r.state}, ${map.mode}): site-template-assets/${path}${note ? ` (${note})` : ''}`);
    }
  } finally {
    await snap.close();
  }
  if (!o.upload) {
    await writeFile(join(o.out, 'plan.json'), JSON.stringify({ drawn_at: new Date().toISOString(), thumbnails: plan }, null, 2));
    console.log(`dry run: ${plan.length} picture(s) in ${o.out}; nothing was sent. Add --upload (with the owner's approval) to store them in FlyttGo.`);
  } else {
    console.log(`stored ${plan.length} thumbnail(s)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
