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
// Options:
//   --group NAME         transport (default), field-service, appointments,
//                        websites (hospitality, shops, software, education,
//                        nonprofits and others: website and invoicing only),
//                        or all (every group above)
//   --industries a,b,c   instead of a group: templates sharing any of these
//                        industries
//   Health templates (clinics, dentists, therapists…) are always left out:
//   patient data is outside what FlyttGo offers (docs/SERVICE_PLATFORM.md).
//   --ids a,b            only these templates
//   --limit N
//
// An export file is the JSON array of site_masters rows (id, name,
// industry, style, pages, preview_assets), for example from the SQL editor:
//   select json_agg(m) from (select id, name, industry, style, pages,
//     preview_assets from site_masters) m;
// ============================================================================
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareTemplate, type MasterRow, type PreparedTemplate, type TemplateAsset } from '../supabase/functions/_shared/site-template.ts';

const MOVING_AND_LOGISTICS = [
  'moving', 'movers', 'relocation', 'removals', 'logistics', 'freight', 'courier', 'delivery', 'transport',
  'trucking', 'last-mile', 'warehousing', 'storage', 'parcel', 'shipping',
];
const GROUPS: Record<string, string[]> = {
  transport: MOVING_AND_LOGISTICS,
  'field-service': ['plumbing', 'plumber', 'emergency-plumbing', 'electrician', 'electrical', 'residential-electric', 'hvac',
    'heating-and-cooling', 'air-conditioning', 'trades', 'home-services', 'cleaning', 'house-cleaning', 'maid-service',
    'recurring-cleaning', 'landscaping', 'lawn-care', 'hardscaping', 'construction', 'contractor', 'general-contractor',
    'roofing', 'roofer', 'painting', 'painter', 'pest-control', 'exterminator', 'termite', 'renovation', 'remodeling',
    'kitchen-bath', 'restoration', 'storm-damage', 'solar', 'auto-repair', 'mechanic', 'garage', 'car-care', 'detailing',
    'mobile-detailing', 'auto-detailing', 'auto-body', 'body-shop', 'collision-repair', 'tyres', 'servicing', 'mot'],
  appointments: ['beauty', 'salon', 'hair-salon', 'hair', 'barber', 'barbershop', 'spa', 'day-spa', 'nails', 'nail-salon',
    'personal-care', 'skincare', 'esthetics', 'massage', 'fitness', 'gym', 'personal-training', 'personal-trainer', 'yoga',
    'pilates', 'wellness', 'pet-care', 'pets', 'dog-grooming', 'pet-grooming', 'grooming', 'dog-training', 'tutoring',
    'private tutor', 'music lessons', 'driving school', 'photography', 'consulting', 'coaching', 'accounting', 'bookkeeping',
    'law-firm', 'lawyer', 'legal', 'professional-services', 'financial-advisor', 'veterinary', 'vet'],
  websites: ['hospitality', 'hotel', 'restaurant', 'food', 'cafe', 'bakery', 'catering', 'travel', 'tours', 'tour-operator',
    'events', 'venue', 'ecommerce', 'online-store', 'shop', 'retail', 'saas', 'software', 'b2b-software', 'education',
    'e-learning', 'academy', 'nonprofit', 'charity', 'church', 'community', 'real-estate', 'realtor', 'property-management',
    'manufacturing', 'agriculture', 'gaming', 'entertainment'],
};
/* Never imported: patient and clinical services. */
const EXCLUDED = ['health', 'clinic', 'medical', 'dental', 'dentist', 'therapy', 'counseling', 'mental-health', 'psychology',
  'optometry', 'eye-care', 'orthodontics', 'pediatrics', 'primary-care', 'family-medicine', 'womens-health', 'obgyn',
  'dermatology', 'chiropractic', 'physical-therapy', 'medical-spa', 'hospital', 'healthcare'];

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
  const group = arg('group') ?? (has('all') ? 'all' : 'transport');
  const industries = arg('industries')?.split(',').map(s => s.trim().toLowerCase())
    ?? (group === 'all' ? Object.values(GROUPS).flat() : GROUPS[group]);
  if (!industries) throw new Error(`unknown group ${group}: ${Object.keys(GROUPS).join(', ')} or all`);
  const tags = (r: MasterRow) => (r.industry ?? []).map(i => String(i).toLowerCase());
  let out = rows.filter(r => (!ids || ids.includes(r.id))
    && !tags(r).some(i => EXCLUDED.includes(i))
    && tags(r).some(i => industries.includes(i)));
  const limit = Number(arg('limit'));
  if (Number.isFinite(limit) && limit > 0) out = out.slice(0, limit);
  return out;
}

function report(templates: PreparedTemplate[]): string {
  const lines = ['# Website templates to review', '',
    'Each template must be checked before approval (Admin → White label → Templates):',
    '- **price**: remove; prices come from the booking page.',
    '- **review**, **claim**: remove unless true for the company that uses the template.',
    '- **sample_name**, **phone**, **email**: what is left of the sample company.', '',
    '| Template | Industries | Pages | price | review | claim | other | Removed (scripts, forms, handlers) |',
    '|---|---|---|---|---|---|---|---|'];
  for (const t of templates) {
    const n = (k: string) => t.flags.filter(f => f.kind === k).length;
    lines.push(`| ${t.id} (${t.name}) | ${t.industry.join(', ')} | ${t.pages.length} | ${n('price')} | ${n('review')} | ${n('claim')} | `
      + `${n('sample_name') + n('phone') + n('email')} | ${t.removed.scripts}, ${t.removed.forms}, ${t.removed.handlers} |`);
  }
  for (const t of templates) {
    lines.push('', `## ${t.id}`, '');
    for (const f of t.flags.slice(0, 40)) lines.push(`- ${f.kind} (${f.page}): …${f.sample.replace(/\|/g, '/')}…`);
  }
  return lines.join('\n') + '\n';
}

async function copyAsset(a: TemplateAsset, templateId: string, url: string, key: string): Promise<TemplateAsset | null> {
  let res: Response;
  try { res = await fetch(a.url); } catch (e) { console.warn(`  image ${a.key}: ${(e as Error).message}`); return null; }
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const ext = IMAGE_TYPES[type];
  if (!res.ok || !ext) { console.warn(`  image ${a.key}: ${res.status} ${type}, skipped`); return null; }
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength > MAX_IMAGE) { console.warn(`  image ${a.key}: larger than 5 MB, skipped`); return null; }
  const path = `${templateId}/${a.key.replace(/[^a-z0-9.-]+/gi, '-')}.${ext}`;
  const up = await fetch(`${url}/storage/v1/object/site-template-assets/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': type, 'x-upsert': 'true' },
    body,
  });
  if (!up.ok) throw new Error(`upload ${path}: ${up.status} ${await up.text()}`);
  return { key: a.key, url: `${url}/storage/v1/object/public/site-template-assets/${path}` };
}

async function toFlyttgo(templates: PreparedTemplate[]) {
  const url = env('FLYTTGO_SUPABASE_URL');
  const key = env('FLYTTGO_SERVICE_ROLE_KEY');
  for (const t of templates) {
    const assets: TemplateAsset[] = [];
    for (const a of t.assets) {
      const copied = await copyAsset(a, t.id, url, key);
      if (copied) assets.push(copied);
    }
    const res = await fetch(`${url}/rest/v1/rpc/import_site_template`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: { id: t.id, name: t.name, industry: t.industry, style: t.style, pages: t.pages,
                                  assets, source: 'architect-ai', source_id: t.source_id, flags: t.flags } }),
    });
    if (!res.ok) throw new Error(`${t.id}: ${res.status} ${await res.text()}`);
    console.log(`stored ${t.id}: ${t.pages.length} pages, ${assets.length}/${t.assets.length} images, ${t.flags.length} things to check`);
  }
}

async function main() {
  const source = arg('from-file');
  const rows = has('from-architect') ? await fromArchitect() : source ? await fromFile(source) : null;
  if (!rows) throw new Error('say where to read from: --from-architect or --from-file <export.json>');
  const templates = select(rows).map(r => prepareTemplate(r));
  console.log(`${templates.length} of ${rows.length} templates selected`);

  const out = arg('out');
  if (out) {
    await mkdir(out, { recursive: true });
    for (const t of templates) await writeFile(join(out, `${t.id}.json`), JSON.stringify(t, null, 2));
    await writeFile(join(out, 'report.md'), report(templates));
    console.log(`wrote ${templates.length} templates and report.md to ${out}`);
  }
  if (has('to-flyttgo')) await toFlyttgo(templates);
  else if (!out) console.log('nothing written: add --out <folder> to review, or --to-flyttgo to store');
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
