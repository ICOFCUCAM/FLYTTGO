// ============================================================================
// FlyttGo — import website templates from Architect-AI (docs/WHITE_LABEL.md)
// ============================================================================
//
// Reads Architect-AI's site masters, prepares each one for FlyttGo
// (supabase/functions/_shared/site-template.ts: sanitised, the sample
// company turned into placeholders, quote forms sent to the booking page)
// and either writes them to a folder for review (the default, nothing is
// sent anywhere) or stores them in FlyttGo's database with their images.
// Imported templates are 'imported': nobody sees them until a FlyttGo
// administrator has checked the wording and approved each one.
//
// Run with Node 22 (types are stripped):
//
//   # 1. Read: from Architect-AI (read-only, service key) or from an export
//   ARCHITECT_SUPABASE_URL=https://<ref>.supabase.co ARCHITECT_SERVICE_ROLE_KEY=... \
//     node scripts/import-site-templates.ts --from-architect --out site-templates-review
//   node scripts/import-site-templates.ts --from-file site_masters.json --out site-templates-review
//
//   # 2. Store in FlyttGo (needs the owner's approval: it writes to the database
//   #    and to storage). Copies each image into the site-template-assets bucket.
//   FLYTTGO_SUPABASE_URL=https://<ref>.supabase.co FLYTTGO_SERVICE_ROLE_KEY=... \
//     node scripts/import-site-templates.ts --from-file site_masters.json --to-flyttgo
//
// Every template is taken (each in its catalogue category, TEMPLATE_CATEGORIES
// in _shared/site-template.ts; one in no category goes to "other"), except
// health templates (clinics, dentists, therapists…): patient data is outside
// what FlyttGo offers (docs/SERVICE_PLATFORM.md).
//
// Before the scripts are removed, each page is settled in a headless browser
// (scripts/template-snapshot.ts: reduced motion, no network) so what the
// scripts draw (sections that fade in, star ratings, counters) stays; then
// the cleaned page is checked with scripts off, and a page that shows less
// than 90 % of the text is flagged 'hidden' for review. Needs Playwright
// (`npx playwright install chromium` once); without it, a warning.
//
// The same browser draws each template's thumbnail for the catalogue: the
// cleaned home page as its demo, in the template's own name and colours
// (as theme galleries show a demo site; the company's own name and colours
// come in the preview), a desktop window 1440 × 900, saved as a
// 720 × 450 JPEG (images only from the template's asset store). It is
// written to <out>/thumbnails/<id>.jpg and, with --to-flyttgo, stored
// beside the template's images as the asset 'thumbnail'. The importer also
// lists each template's features (pricing, gallery, team, FAQ…:
// templateFeatures()) for the cards.
//
// Options:
//   --category ID        only one catalogue category (transport, trades,
//                        appointments, professional, hospitality, retail,
//                        technology, community, industry, entertainment, other)
//   --industries a,b,c   only templates sharing any of these industries
//   --ids a,b            only these templates
//   --limit N
//   --no-snapshot        skip the browser step (not recommended)
//
// Quality gate (supabase/functions/_shared/template-quality.ts): every
// template's pages are checked automatically (overflow at 320/375/390 px
// with a long company name, broken images, images without alt text,
// booking links that lead elsewhere, what is left of the sample company,
// unsafe HTML, pages that do not render); the results are stored with the
// template and listed in report.md. Approval is refused while one fails
// unless the administrator gives a reason. After an administrator edits a
// page, the browser's checks of it are out of date; run them again with
//   FLYTTGO_SUPABASE_URL=… FLYTTGO_SERVICE_ROLE_KEY=… \
//   node scripts/import-site-templates.ts --recheck [--ids a,b]
// (reads the stored templates, writes only their checks and flags; needs
// the owner's approval like --to-flyttgo).
//
// Images (supabase/functions/_shared/template-images.ts): each template's
// images are recorded as named slots (hero, services, about, gallery,
// team, map…) with their source ('architect-ai'), licence (unknown until
// confirmed), category, intended use (the page's alt text), size and,
// once copied, SHA-256 (site_template_images). report.md lists templates
// that share the very same image set. A batch of generated, licensed or
// own photos comes in with
//   --images <manifest.json>
// (format in docs/WHITE_LABEL.md → "Image manifest"): each file is
// checked by its bytes (PNG, JPEG or WebP, at most 5 MB) and takes the
// slots it names; --out copies it into <out>/images/, --to-flyttgo
// uploads it beside the template's images and draws the thumbnail and
// the browser checks again with it.
// Photos shared by every template of a category go into the image library
// instead (migration 00023): scripts/import-image-library.ts --library
// <catalogue.json> --library-dir <dir> (docs/WHITE_LABEL.md → Image library).
//
// An export file is the JSON array of site_masters rows (id, name,
// industry, style, pages, preview_assets), for example from the SQL editor:
//   select json_agg(m) from (select id, name, industry, style, pages,
//     preview_assets from site_masters) m;
// ============================================================================
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  categoryLabel, hostsOf, prepareTemplate, renderTemplatePage, replaceForms, templateCategory, TEMPLATE_CATEGORIES, OTHER_CATEGORY,
  contentFlags, type Brand, type ContentFlag, type MasterRow, type PreparedTemplate, type TemplateAsset, type TemplatePage,
} from '../supabase/functions/_shared/site-template.ts';
import {
  CHECKS, OVERFLOW_WIDTHS, browserChecks, combine, failingChecks, staticChecks, type CheckResult, type TemplateChecks,
} from '../supabase/functions/_shared/template-quality.ts';
import {
  EXTENSION, MAX_TEMPLATE_IMAGE, imageInfo, planManifest, readManifest, sha256Hex, sharedImageSets, templateImages,
  type ImageManifest, type ManifestEntry, type TemplateImage,
} from '../supabase/functions/_shared/template-images.ts';
import { snapshotter, type Snapshotter } from './template-snapshot.ts';

/** A prepared template with its checks, image slots and thumbnail (JPEG bytes; not part of the JSON). */
type Imported = PreparedTemplate & {
  checks?: TemplateChecks; images: TemplateImage[]; thumbnail?: string; thumbnailJpeg?: Uint8Array;
  /** Images from a manifest, by asset key: their bytes, until stored. */
  replacements?: Map<string, { entry: ManifestEntry; bytes: Uint8Array; ext: string; mime: string }>;
};

/**
 * The neutral sample brand thumbnails are drawn with: the template's own
 * colours, a plain name, no real contact details.
 */
const SAMPLE_BRAND: Brand = { name: 'Your Company', tagline: 'Your tagline here', phone: '+47 00 00 00 00',
  email: 'post@example.com', city: 'Your town' };


/** The brand the overflow check draws pages with: a long name, as some companies have. */
const CHECK_BRAND: Brand = { ...SAMPLE_BRAND, name: 'Nordvik Flytting og Transport Aksjeselskap' };

/** A template's own demo identity, for its thumbnail: its name and colours, sample contact details. */
const demoBrand = (t: { name: string }): Brand => ({ ...SAMPLE_BRAND, name: t.name, tagline: null });

/** A page of a template, as a company with this brand would see it. */
function samplePage(t: Pick<PreparedTemplate, 'assets'>, html: string, brand: Brand = SAMPLE_BRAND): string {
  return renderTemplatePage(html, { brand, assets: t.assets, pageUrl: () => '#', bookingUrl: '#', sellerNotice: 'Seller notice',
                                    assetHosts: hostsOf(t.assets) });
}

/**
 * The automated checks (supabase/functions/_shared/template-quality.ts):
 * those without a browser always, the browser's (renders, overflow at
 * 320/375/390 px with a long name, images that fail to load) with one.
 */
async function checkTemplate(t: Pick<PreparedTemplate, 'pages' | 'assets' | 'flags'> & { flag_names?: string[] },
                             snap: Snapshotter | null, sizes = new Map<string, { width: number; height: number }>()): Promise<TemplateChecks> {
  const base = staticChecks(t.pages, t.assets, t.flags);
  const browser: CheckResult[] = [];
  if (snap) {
    for (const p of t.pages) {
      const seen = await snap.inspect(samplePage(t, p.html, CHECK_BRAND), hostsOf(t.assets), OVERFLOW_WIDTHS);
      browser.push(...browserChecks(p.path, seen));
      // Each image's size as the browser loaded it (for the image slots).
      for (const i of seen.images) if (i.loaded) sizes.set(i.src.replace(/&amp;/g, '&'), { width: i.width, height: i.height });
    }
  }
  return { version: 1, ran_at: new Date().toISOString(), sample_names: t.flag_names, results: combine(base, browser) };
}

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE = 5 * 1024 * 1024;

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

async function fromArchitect(): Promise<MasterRow[]> {
  const url = env('ARCHITECT_SUPABASE_URL');
  const key = env('ARCHITECT_SERVICE_ROLE_KEY');
  const rows: MasterRow[] = [];
  for (let from = 0; ; from += 20) {
    const res = await fetch(`${url}/rest/v1/site_masters?select=id,name,industry,style,sections,pages,preview_assets&order=id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 19}` },
    });
    if (!res.ok && res.status !== 206) throw new Error(`Architect-AI: ${res.status} ${await res.text()}`);
    const page = await res.json() as MasterRow[];
    rows.push(...page);
    if (page.length < 20) break;
  }
  return rows;
}

async function fromFile(path: string): Promise<MasterRow[]> {
  const data = JSON.parse(await readFile(path, 'utf8'));
  const rows = Array.isArray(data) ? data : Array.isArray(data?.[0]?.json_agg) ? data[0].json_agg : data?.json_agg;
  if (!Array.isArray(rows)) throw new Error(`${path}: expected a JSON array of site_masters rows`);
  return rows as MasterRow[];
}

function select(rows: MasterRow[]): MasterRow[] {
  const ids = arg('ids')?.split(',').map(s => s.trim()).filter(Boolean);
  const category = arg('category');
  if (category && category !== OTHER_CATEGORY.id && !TEMPLATE_CATEGORIES.some(c => c.id === category)) {
    throw new Error(`unknown category ${category}: ${[...TEMPLATE_CATEGORIES.map(c => c.id), OTHER_CATEGORY.id].join(', ')}`);
  }
  const industries = arg('industries')?.split(',').map(s => s.trim().toLowerCase());
  const tags = (r: MasterRow) => (r.industry ?? []).map(i => String(i).toLowerCase());
  let out = rows.filter(r => {
    const c = templateCategory(r.industry);
    return c !== null && (!ids || ids.includes(r.id)) && (!category || c === category)
      && (!industries || tags(r).some(i => industries.includes(i)));
  });
  const limit = Number(arg('limit'));
  if (Number.isFinite(limit) && limit > 0) out = out.slice(0, limit);
  return out;
}

/** Settle each page with its scripts, prepare the template, then check it with scripts off. */
async function prepare(row: MasterRow, snap: Snapshotter | null): Promise<Imported> {
  const pages = (typeof row.pages === 'string' ? JSON.parse(row.pages) : row.pages) as TemplatePage[];
  const settled: TemplatePage[] = [];
  for (const p of pages) {
    settled.push(snap && /<script\b/i.test(p.html) ? { ...p, html: await snap.settle(p.html) } : p);
  }
  const t: Imported = { ...prepareTemplate({ ...row, pages: settled }), images: [] };
  if (snap) {
    for (const p of t.pages) {
      const before = settled.find(s => (s.path || '/') === p.path) ?? settled[0];
      const shown = await snap.visibleChars(replaceForms(before.html), true);
      const after = await snap.visibleChars(p.html, false);
      if (shown > 0 && after < shown * 0.9) {
        t.flags.push({ kind: 'hidden', page: p.path, sample: `${Math.round(100 - (after / shown) * 100)} % of the text is not visible without scripts` });
      }
    }
    // The catalogue's thumbnail: the cleaned home page as the template's own demo.
    const home = t.pages.find(p => p.path === '/') ?? t.pages[0];
    if (home) t.thumbnailJpeg = await snap.thumbnail(samplePage(t, home.html, demoBrand(t)), hostsOf(t.assets));
  }
  const sizes = new Map<string, { width: number; height: number }>();
  t.checks = await checkTemplate(t, snap, sizes);
  t.images = templateImages(t, templateCategory(t.industry), sizes);
  return t;
}

function report(templates: Imported[]): string {
  const lines = ['# Website templates to review', '',
    'Each template must be checked before approval (Admin → White label → Templates):',
    '- **price**: remove; prices come from the booking page.',
    '- **review**, **claim**: remove unless true for the company that uses the template.',
    '- **sample_name**, **phone**, **email**: what is left of the sample company.', '',
    '- **hidden**: part of the page only shows with scripts; fix the page before approval.',
    '- **address**, **statistic**: a sample address (US town and state, street) or figure ("18,000+", "98%").', '',
    'Automated checks (approval is refused while one fails, unless the administrator gives a reason): '
      + CHECKS.map(c => `**${c.id}** ${c.label.toLowerCase()}`).join('; ') + '.', '',
    '| Category | Templates |', '|---|---|'];
  const byCat = new Map<string, number>();
  for (const t of templates) { const c = templateCategory(t.industry) ?? 'other'; byCat.set(c, (byCat.get(c) ?? 0) + 1); }
  for (const [c, n] of [...byCat].sort((a, b) => b[1] - a[1])) lines.push(`| ${categoryLabel(c)} | ${n} |`);
  lines.push('', '| Template | Category | Industries | Pages | Features | Checks failing | price | review | claim | other | hidden | Removed (scripts, forms, handlers) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const t of templates) {
    const n = (k: string) => t.flags.filter(f => f.kind === k).length;
    lines.push(`| ${t.id} (${t.name}) | ${categoryLabel(templateCategory(t.industry) ?? 'other')} | ${t.industry.join(', ')} | ${t.pages.length} | ${t.features.join(', ')} | ${[...new Set(failingChecks(t.checks).map(r => r.id))].join(', ') || '–'} | `
      + `${n('price')} | ${n('review')} | ${n('claim')} | ${n('sample_name') + n('phone') + n('email') + n('address') + n('statistic')} | ${n('hidden')} | `
      + `${t.removed.scripts}, ${t.removed.forms}, ${t.removed.handlers} |`);
  }
  const shared = sharedImageSets(templates.flatMap(t => t.images));
  lines.push('', '## Templates sharing the same images', '');
  if (!shared.length) lines.push('None: every template has its own set of images.');
  else {
    lines.push(`${shared.reduce((n, g) => n + g.templates.length, 0)} of ${templates.length} templates share an image set with another `
      + '(compared by SHA-256 where the images were copied, else by address).', '', '| Templates | Images in the set | Which |', '|---|---|---|');
    for (const g of shared) lines.push(`| ${g.templates.length} | ${g.images} | ${g.templates.join(', ')} |`);
  }
  for (const t of templates) {
    lines.push('', `## ${t.id}`, '');
    for (const r of failingChecks(t.checks)) {
      lines.push(`- **check ${r.id}** (${r.page}): ${r.detail}${r.items?.length ? ` ${r.items.slice(0, 5).join('; ').replace(/\|/g, '/')}` : ''}`);
    }
    for (const [k, r] of t.replacements ?? []) lines.push(`- image ${k}: from the manifest, ${r.entry.file} (${r.entry.source})`);
    for (const f of t.flags.slice(0, 40)) lines.push(`- ${f.kind} (${f.page}): …${f.sample.replace(/\|/g, '/')}…`);
  }
  return lines.join('\n') + '\n';
}

/** Store bytes in the asset bucket at <template>/<key>.<ext>; returns the public URL. */
async function storeAsset(templateId: string, assetKey: string, ext: string, type: string, body: Uint8Array, url: string, key: string): Promise<string> {
  const path = `${templateId}/${assetKey.replace(/[^a-z0-9.-]+/gi, '-')}.${ext}`;
  const up = await fetch(`${url}/storage/v1/object/site-template-assets/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': type, 'x-upsert': 'true' },
    body,
  });
  if (!up.ok) throw new Error(`upload ${path}: ${up.status} ${await up.text()}`);
  return `${url}/storage/v1/object/public/site-template-assets/${path}`;
}

async function copyAsset(a: TemplateAsset, templateId: string, url: string, key: string): Promise<(TemplateAsset & { sha256: string; width: number; height: number }) | null> {
  let res: Response;
  try { res = await fetch(a.url); } catch (e) { console.warn(`  image ${a.key}: ${(e as Error).message}`); return null; }
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const ext = IMAGE_TYPES[type];
  if (!res.ok || !ext) { console.warn(`  image ${a.key}: ${res.status} ${type}, skipped`); return null; }
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength > MAX_IMAGE) { console.warn(`  image ${a.key}: larger than 5 MB, skipped`); return null; }
  // What the bytes are, not what the server says they are.
  const info = imageInfo(body);
  if (!info || info.mime !== type) { console.warn(`  image ${a.key}: not a ${type} image by its bytes, skipped`); return null; }
  return { key: a.key, url: await storeAsset(templateId, a.key, ext, type, body, url, key), sha256: await sha256Hex(body),
           width: info.width, height: info.height };
}

async function toFlyttgo(templates: Imported[], snap: Snapshotter | null) {
  const url = env('FLYTTGO_SUPABASE_URL');
  const key = env('FLYTTGO_SERVICE_ROLE_KEY');
  for (const t of templates) {
    const assets: TemplateAsset[] = [];
    const images: TemplateImage[] = [];
    for (const a of t.assets) {
      const r = t.replacements?.get(a.key);
      const image = t.images.find(i => i.asset_key === a.key);
      if (r) {
        // An image from the manifest: stored under its hash, with what the manifest says about it.
        const sha = await sha256Hex(r.bytes);
        const info = imageInfo(r.bytes)!;
        const stored = await storeAsset(t.id, `${a.key}-${sha.slice(0, 12)}`, r.ext, r.mime, r.bytes, url, key);
        assets.push({ key: a.key, url: stored });
        if (image) images.push({ ...image, url: stored, source: r.entry.source, licence: r.entry.licence ?? null, generation: r.entry.generation ?? null,
                                 intended_use: r.entry.intended_use ?? image.intended_use, width: info.width, height: info.height, sha256: sha });
        continue;
      }
      const copied = await copyAsset(a, t.id, url, key);
      if (!copied) continue;
      assets.push({ key: copied.key, url: copied.url });
      if (image) images.push({ ...image, url: copied.url, sha256: copied.sha256, width: copied.width, height: copied.height });
    }
    // With images from a manifest, the thumbnail and the browser's checks are drawn again with them.
    if (t.replacements?.size && snap) {
      const home = t.pages.find(p => p.path === '/') ?? t.pages[0];
      if (home) t.thumbnailJpeg = await snap.thumbnail(samplePage({ assets }, home.html, demoBrand(t)), hostsOf(assets));
      t.checks = await checkTemplate({ ...t, assets }, snap);
    }
    // The thumbnail, beside the template's images (asset key 'thumbnail').
    if (t.thumbnailJpeg) {
      assets.push({ key: 'thumbnail', url: await storeAsset(t.id, 'thumbnail', 'jpg', 'image/jpeg', t.thumbnailJpeg, url, key) });
    }
    const res = await fetch(`${url}/rest/v1/rpc/import_site_template`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: { id: t.id, name: t.name, industry: t.industry, style: t.style, pages: t.pages,
                                  assets, source: 'architect-ai', source_id: t.source_id, flags: t.flags,
                                  features: t.features, checks: t.checks, images } }),
    });
    if (!res.ok) throw new Error(`${t.id}: ${res.status} ${await res.text()}`);
    console.log(`stored ${t.id}: ${t.pages.length} pages, ${assets.length}/${t.assets.length} images, ${t.flags.length} things to check`);
  }
}

/**
 * --images <manifest.json>: the slots each image of a batch takes
 * (planManifest()), each file checked by its bytes. The template's image
 * slots carry the manifest's source, licence or generation; the bytes are
 * stored by --to-flyttgo, or copied into <out>/images/ for review.
 */
async function applyManifest(path: string, templates: Imported[]) {
  const manifest: ImageManifest = readManifest(JSON.parse(await readFile(path, 'utf8')));
  const folder = dirname(resolve(path));
  const plan = planManifest(manifest, templates.flatMap(t => t.images));
  const files = new Map<string, { bytes: Uint8Array; ext: string; mime: string }>();
  for (const e of manifest.images) {
    if (files.has(e.file)) continue;
    const bytes = new Uint8Array(await readFile(join(folder, e.file)));
    const info = imageInfo(bytes);
    if (!info) throw new Error(`image manifest: ${e.file} is not a PNG, JPEG or WebP image (checked by its bytes)`);
    if (bytes.byteLength > MAX_TEMPLATE_IMAGE) throw new Error(`image manifest: ${e.file} is larger than 5 MB`);
    files.set(e.file, { bytes, ext: EXTENSION[info.mime], mime: info.mime });
  }
  let n = 0;
  for (const t of templates) {
    const mine = plan.get(t.id);
    if (!mine) continue;
    t.replacements = new Map();
    for (const [k, entry] of mine) {
      const f = files.get(entry.file)!;
      t.replacements.set(k, { entry, ...f });
      const info = imageInfo(f.bytes)!;
      t.images = t.images.map(i => i.asset_key !== k ? i : {
        ...i, source: entry.source, licence: entry.licence ?? null, generation: entry.generation ?? null,
        intended_use: entry.intended_use ?? i.intended_use, width: info.width, height: info.height, sha256: null, review_status: 'unreviewed',
      });
      n++;
    }
  }
  for (const t of templates) for (const i of t.images) {
    const r = t.replacements?.get(i.asset_key);
    if (r) i.sha256 = await sha256Hex(r.bytes);
  }
  console.log(`image manifest: ${n} image slot(s) of ${plan.size} template(s) take an image from ${path}`);
}

/** --recheck: check the templates stored in FlyttGo again (after administrators edited pages) and store the results. */
async function recheck(snap: Snapshotter | null) {
  const url = env('FLYTTGO_SUPABASE_URL');
  const key = env('FLYTTGO_SERVICE_ROLE_KEY');
  const ids = arg('ids')?.split(',').map(x => x.trim()).filter(Boolean);
  const filter = ids?.length ? `&id=in.(${ids.map(encodeURIComponent).join(',')})` : '';
  const res = await fetch(`${url}/rest/v1/site_templates?select=id,name,pages,assets,content_flags,checks&order=id${filter}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`FlyttGo: ${res.status} ${await res.text()}`);
  const rows = await res.json() as { id: string; name: string; pages: TemplatePage[]; assets: TemplateAsset[];
                                      content_flags: ContentFlag[]; checks: { sample_names?: string[] } }[];
  for (const r of rows) {
    const names = r.checks?.sample_names ?? [r.name];
    // The flags found again in the pages as they are now; 'hidden' (found at import, with scripts) is kept.
    const flags = [...r.content_flags.filter(f => f.kind === 'hidden'),
                   ...r.pages.flatMap(p => contentFlags(p.html, p.path, names[0], names.slice(1)))];
    const checks = await checkTemplate({ pages: r.pages, assets: r.assets, flags, flag_names: names }, snap);
    const up = await fetch(`${url}/rest/v1/rpc/record_site_template_checks`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: r.id, p_checks: checks, p_flags: flags }),
    });
    if (!up.ok) throw new Error(`${r.id}: ${up.status} ${await up.text()}`);
    const failing = [...new Set(failingChecks(checks).map(x => x.id))];
    console.log(`checked ${r.id}: ${failing.length ? `failing ${failing.join(', ')}` : 'all checks pass'}`);
  }
}

async function main() {
  if (has('recheck')) {
    env('FLYTTGO_SUPABASE_URL'); env('FLYTTGO_SERVICE_ROLE_KEY');
    const snap = await snapshotter();
    if (!snap) console.warn('Playwright is not available: only the checks that need no browser are run.');
    try { await recheck(snap); } finally { await snap?.close(); }
    return;
  }
  const source = arg('from-file');
  const rows = has('from-architect') ? await fromArchitect() : source ? await fromFile(source) : null;
  if (!rows) throw new Error('say where to read from: --from-architect or --from-file <export.json>');
  const chosen = select(rows);
  console.log(`${chosen.length} of ${rows.length} templates selected (health templates are never imported)`);
  const snap = has('no-snapshot') ? null : await snapshotter();
  if (!snap && !has('no-snapshot')) {
    console.warn('Playwright is not available: pages are imported without the browser step, so what their scripts '
      + 'draw (fade-ins, stars, counters) may be missing. Install it: npm i -D playwright && npx playwright install chromium');
  }
  const templates: Imported[] = [];
  try {
    for (const r of chosen) {
      const t = await prepare(r, snap);
      templates.push(t);
      const hidden = t.flags.filter(f => f.kind === 'hidden').length;
      console.log(`prepared ${t.id} (${categoryLabel(templateCategory(t.industry) ?? 'other')}): ${t.pages.length} pages`
        + (hidden ? `, ${hidden} page(s) flagged hidden` : ''));
    }
    const manifest = arg('images');
    if (manifest) await applyManifest(manifest, templates);

    const out = arg('out');
    if (out) {
      await mkdir(join(out, 'thumbnails'), { recursive: true });
      for (const t of templates) {
        const { thumbnailJpeg, replacements, ...json } = t;
        if (thumbnailJpeg) {
          json.thumbnail = `thumbnails/${t.id}.jpg`;
          await writeFile(join(out, json.thumbnail), thumbnailJpeg);
        }
        // Images from a manifest, for review (the thumbnail still shows the earlier ones).
        for (const [k, r] of replacements ?? []) {
          await mkdir(join(out, 'images', t.id), { recursive: true });
          const file = `images/${t.id}/${k}.${r.ext}`;
          await writeFile(join(out, file), r.bytes);
          json.images = json.images.map(i => i.asset_key === k ? { ...i, url: file } : i);
        }
        await writeFile(join(out, `${t.id}.json`), JSON.stringify(json, null, 2));
      }
      await writeFile(join(out, 'report.md'), report(templates));
      console.log(`wrote ${templates.length} templates and report.md to ${out}`);
    }
    if (has('to-flyttgo')) await toFlyttgo(templates, snap);
    else if (!out) console.log('nothing written: add --out <folder> to review, or --to-flyttgo to store');
  } finally {
    await snap?.close();
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
