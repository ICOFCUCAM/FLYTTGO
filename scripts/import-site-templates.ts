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
// cleaned home page with a neutral sample brand ("Your Company", the
// template's own colours), 1280 px wide, the top 1600 px, saved as a
// 640 × 800 JPEG (images only from the template's asset store). It is
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
// An export file is the JSON array of site_masters rows (id, name,
// industry, style, pages, preview_assets), for example from the SQL editor:
//   select json_agg(m) from (select id, name, industry, style, pages,
//     preview_assets from site_masters) m;
// ============================================================================
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  categoryLabel, hostsOf, prepareTemplate, renderTemplatePage, replaceForms, templateCategory, TEMPLATE_CATEGORIES, OTHER_CATEGORY,
  type Brand, type MasterRow, type PreparedTemplate, type TemplateAsset, type TemplatePage,
} from '../supabase/functions/_shared/site-template.ts';
import { snapshotter, type Snapshotter } from './template-snapshot.ts';

/** A prepared template with its thumbnail (JPEG bytes; not part of the JSON). */
type Imported = PreparedTemplate & { thumbnail?: string; thumbnailJpeg?: Uint8Array };

/**
 * The neutral sample brand thumbnails are drawn with: the template's own
 * colours, a plain name, no real contact details.
 */
const SAMPLE_BRAND: Brand = { name: 'Your Company', tagline: 'Your tagline here', phone: '+47 00 00 00 00',
  email: 'post@example.com', city: 'Your town' };


/** The rendered home page of a template, as a company with the sample brand would see it. */
function samplePage(t: PreparedTemplate, html: string): string {
  return renderTemplatePage(html, { brand: SAMPLE_BRAND, assets: t.assets, pageUrl: () => '#', bookingUrl: '#', sellerNotice: '',
                                    assetHosts: hostsOf(t.assets) });
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
  const t: Imported = prepareTemplate({ ...row, pages: settled });
  if (snap) {
    for (const p of t.pages) {
      const before = settled.find(s => (s.path || '/') === p.path) ?? settled[0];
      const shown = await snap.visibleChars(replaceForms(before.html), true);
      const after = await snap.visibleChars(p.html, false);
      if (shown > 0 && after < shown * 0.9) {
        t.flags.push({ kind: 'hidden', page: p.path, sample: `${Math.round(100 - (after / shown) * 100)} % of the text is not visible without scripts` });
      }
    }
    // The catalogue's thumbnail: the cleaned home page with the sample brand.
    const home = t.pages.find(p => p.path === '/') ?? t.pages[0];
    if (home) t.thumbnailJpeg = await snap.thumbnail(samplePage(t, home.html), hostsOf(t.assets));
  }
  return t;
}

function report(templates: Imported[]): string {
  const lines = ['# Website templates to review', '',
    'Each template must be checked before approval (Admin → White label → Templates):',
    '- **price**: remove; prices come from the booking page.',
    '- **review**, **claim**: remove unless true for the company that uses the template.',
    '- **sample_name**, **phone**, **email**: what is left of the sample company.', '',
    '- **hidden**: part of the page only shows with scripts; fix the page before approval.', '',
    '| Category | Templates |', '|---|---|'];
  const byCat = new Map<string, number>();
  for (const t of templates) { const c = templateCategory(t.industry) ?? 'other'; byCat.set(c, (byCat.get(c) ?? 0) + 1); }
  for (const [c, n] of [...byCat].sort((a, b) => b[1] - a[1])) lines.push(`| ${categoryLabel(c)} | ${n} |`);
  lines.push('', '| Template | Category | Industries | Pages | Features | price | review | claim | other | hidden | Removed (scripts, forms, handlers) |',
    '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const t of templates) {
    const n = (k: string) => t.flags.filter(f => f.kind === k).length;
    lines.push(`| ${t.id} (${t.name}) | ${categoryLabel(templateCategory(t.industry) ?? 'other')} | ${t.industry.join(', ')} | ${t.pages.length} | ${t.features.join(', ')} | `
      + `${n('price')} | ${n('review')} | ${n('claim')} | ${n('sample_name') + n('phone') + n('email')} | ${n('hidden')} | `
      + `${t.removed.scripts}, ${t.removed.forms}, ${t.removed.handlers} |`);
  }
  for (const t of templates) {
    lines.push('', `## ${t.id}`, '');
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

async function copyAsset(a: TemplateAsset, templateId: string, url: string, key: string): Promise<TemplateAsset | null> {
  let res: Response;
  try { res = await fetch(a.url); } catch (e) { console.warn(`  image ${a.key}: ${(e as Error).message}`); return null; }
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const ext = IMAGE_TYPES[type];
  if (!res.ok || !ext) { console.warn(`  image ${a.key}: ${res.status} ${type}, skipped`); return null; }
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength > MAX_IMAGE) { console.warn(`  image ${a.key}: larger than 5 MB, skipped`); return null; }
  return { key: a.key, url: await storeAsset(templateId, a.key, ext, type, body, url, key) };
}

async function toFlyttgo(templates: Imported[]) {
  const url = env('FLYTTGO_SUPABASE_URL');
  const key = env('FLYTTGO_SERVICE_ROLE_KEY');
  for (const t of templates) {
    const assets: TemplateAsset[] = [];
    for (const a of t.assets) {
      const copied = await copyAsset(a, t.id, url, key);
      if (copied) assets.push(copied);
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
                                  features: t.features } }),
    });
    if (!res.ok) throw new Error(`${t.id}: ${res.status} ${await res.text()}`);
    console.log(`stored ${t.id}: ${t.pages.length} pages, ${assets.length}/${t.assets.length} images, ${t.flags.length} things to check`);
  }
}

async function main() {
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
  } finally {
    await snap?.close();
  }

  const out = arg('out');
  if (out) {
    await mkdir(join(out, 'thumbnails'), { recursive: true });
    for (const t of templates) {
      const { thumbnailJpeg, ...json } = t;
      if (thumbnailJpeg) {
        json.thumbnail = `thumbnails/${t.id}.jpg`;
        await writeFile(join(out, json.thumbnail), thumbnailJpeg);
      }
      await writeFile(join(out, `${t.id}.json`), JSON.stringify(json, null, 2));
    }
    await writeFile(join(out, 'report.md'), report(templates));
    console.log(`wrote ${templates.length} templates and report.md to ${out}`);
  }
  if (has('to-flyttgo')) await toFlyttgo(templates);
  else if (!out) console.log('nothing written: add --out <folder> to review, or --to-flyttgo to store');
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
