// ============================================================================
// FlyttGo — the AI photo pilot for the image library
// ============================================================================
//
// docs/WHITE_LABEL.md → Image library, "AI pilot" (owner's decision
// 2026-10-30, docs/DECISIONS.md #50). A small, cost-controlled pilot per
// catalogue category: photos generated with the OpenAI Images API (model
// gpt-image-1) from a checked-in prompt plan (scripts/image-prompts/
// <category>.json: subject briefs with shape, tags and alt text, and a style
// shared by the whole category), generated once, reviewed by a person and
// loaded into the library as PENDING by the existing loader
// (scripts/import-image-library.ts). Never generated on page load.
//
// A dry run by default: it prints the plan (the category, how many per
// shape, every prompt and size) and an ESTIMATED cost from a price table
// (scripts/image-prompts/prices.json or --prices, --price-per-image). The
// table's figures are assumptions, not OpenAI's prices: check
// https://openai.com/api/pricing/ before a run. Nothing is sent anywhere.
//
// With --generate (and OPENAI_API_KEY: an API key from platform.openai.com,
// billed separately from a ChatGPT subscription) it calls
// POST https://api.openai.com/v1/images/generations once per image (n = 1),
// one after the other, retrying on 429 and 5xx with backoff, and writes into
// --out (default ai-images/<category>/):
//   <category>-<brief>.<ext>   the images
//   library-catalogue.json     the loader's catalogue (version 1), pending review
//   cost-log.json              per image: the usage the API returned (tokens),
//                              the estimate, and the cost from tokens when
//                              per_million_tokens is set
//   contact-sheet.html/.png    every image with its brief, for review (the
//                              PNG needs Playwright)
// It refuses to start when the estimate is above --max-cost (default 5)
// unless --yes, and stops before an image that would take the running
// estimate above it. A brief already in the catalogue is not generated again
// (--regenerate to do so). The key is sent only in the Authorization header
// and never printed (an error from the API is printed with keys masked).
//
// It never uploads to FlyttGo: review the contact sheet, remove what fails
// review (--drop), then load with the loader (dry run, then --upload with the
// owner's approval) and approve each photo in Admin → White label → Image
// library once the owner has confirmed OpenAI's terms for commercial use.
//
// Run with Node 22 (types are stripped). Behind an HTTPS proxy Node's own
// fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set:
//
//   node scripts/generate-library-images.ts --category trades                 # dry run
//   NODE_USE_ENV_PROXY=1 OPENAI_API_KEY=sk-... \
//     node scripts/generate-library-images.ts --category trades --limit 12 --generate
//   node scripts/generate-library-images.ts --category trades --drop plumber-bathroom-tap --reason "text on the tap"
//   node scripts/import-image-library.ts --library ai-images/trades/library-catalogue.json
//
// Options:
//   --category ID           the category (a plan in scripts/image-prompts/; required)
//   --plan <file>           another plan file
//   --limit N               how many images (default 12); briefs are taken across
//                           shapes in turn, the shapes the category lacks first
//   --ids a,b               these briefs only
//   --coverage <file>       rows of admin_image_library_coverage() as JSON: the
//                           shapes short of what one template needs come first
//   --quality low|medium|high   (default medium)
//   --format jpeg|png|webp  (default jpeg)
//   --prices <file>         the price table (default scripts/image-prompts/prices.json)
//   --price-per-image L     override per size (and quality): 1024x1024=0.05,1536x1024:high=0.3
//   --max-cost N            the most the estimate may be without --yes (default 5)
//   --yes                   allow an estimate above --max-cost (or with unknown prices)
//   --generate              call the API (otherwise a dry run)
//   --out <dir>             where to write (default ai-images/<category>)
//   --regenerate            generate briefs already in the catalogue again
//   --no-crop               keep hero images at 1536 × 1024 (they are then "wide")
//   --retries N             retries per image on 429/5xx/network errors (default 4)
//   --drop a,b [--reason …] take these images out of the catalogue after review
//                           (files moved to rejected/, recorded in review-log.json)
// ============================================================================
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  LIBRARY_CATEGORIES, LIBRARY_SHAPES, readCatalogue, shapeOf, type CatalogueEntry, type LibraryShape,
} from '../supabase/functions/_shared/image-library.ts';
import { imageInfo, sha256Hex } from '../supabase/functions/_shared/template-images.ts';
import { EXCLUDED_INDUSTRIES, categoryLabel } from '../supabase/functions/_shared/site-template.ts';

export const MODEL = 'gpt-image-1';
export const API_URL = 'https://api.openai.com/v1/images/generations';
export const ORIGIN = 'AI-generated (OpenAI gpt-image-1)';
export const LICENCE = 'OpenAI output — commercial use per OpenAI terms, owner to confirm';
export const LICENCE_EVIDENCE = 'https://openai.com/policies/terms-of-use';
export const PRICING_PAGE = 'https://openai.com/api/pricing/';
export const QUALITIES = ['low', 'medium', 'high'] as const;
export type Quality = (typeof QUALITIES)[number];
export const FORMATS = ['jpeg', 'png', 'webp'] as const;
export type Format = (typeof FORMATS)[number];

/** The size requested per shape (gpt-image-1 sizes). A hero is cropped to HERO_CROP (≥ 1.6 : 1, shapeOf()). */
export const SIZE_FOR_SHAPE: Record<LibraryShape, string> = {
  hero: '1536x1024', wide: '1536x1024', square: '1024x1024', portrait: '1024x1536',
};
export const HERO_CROP = { width: 1536, height: 960 } as const;

/** Said in every prompt, whatever the plan: what an image for a customer's site must never show. */
export const SAFETY = 'Photorealistic, not an illustration. Absolutely no text, letters, numbers, signage, labels, logos, '
  + 'brand names or watermarks anywhere in the image. Only adults; no children. Fictional people only, not resembling any real or famous person. '
  + 'Not a medical, clinical or hospital setting. Nothing staged as an advertisement.';

/** How each shape is framed (a hero keeps its subject in the middle band: the top and bottom are cropped). */
export const FRAMING: Record<LibraryShape, string> = {
  hero: 'Wide landscape banner composition: the subject off-centre, calm open space on one side for a headline, nothing important near the top or bottom edge.',
  wide: 'Landscape composition, the subject clearly in frame.',
  square: 'Square composition, the subject centred.',
  portrait: 'Vertical composition, half-figure, the subject centred, softly blurred background.',
};

/** Words a brief's subject may not use: people the pilot never shows, settings it never shows, things a photo must not carry. */
export const FORBIDDEN = /\b(?:child|children|kid|kids|baby|babies|toddler|teen|teenager|schoolchild|pupil|logo|logos|brand|branded|text|signage|sign|slogan|watermark|clinic|clinical|hospital|patient|doctor|nurse|medical|dentist|dental|therapist|therapy|surgery|celebrity|famous)\b/i;

export interface Brief { id: string; shape: LibraryShape; subject: string; tags: string[]; alt: string }
export interface Plan { version: 1; category: string; style: string; briefs: Brief[] }

/** Read and check a prompt plan. Throws with every problem listed. */
export function readPlan(data: unknown): Plan {
  const d = data as Partial<Plan> | null;
  const problems: string[] = [];
  if (!d || typeof d !== 'object') throw new Error('prompt plan: expected an object');
  if (d.version !== 1) problems.push('version must be 1');
  if (typeof d.category !== 'string' || !LIBRARY_CATEGORIES.includes(d.category)) problems.push(`category must be one of ${LIBRARY_CATEGORIES.join(', ')}`);
  if (typeof d.style !== 'string' || !d.style.trim()) problems.push('style (shared by the category) is required');
  if (!Array.isArray(d.briefs) || !d.briefs.length) problems.push('briefs must be a non-empty list');
  const seen = new Set<string>();
  (Array.isArray(d.briefs) ? d.briefs : []).forEach((b: Partial<Brief> | null, n) => {
    const at = `briefs[${n}]`;
    if (!b || typeof b !== 'object') { problems.push(`${at}: not an object`); return; }
    if (typeof b.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(b.id)) problems.push(`${at}: id of lower-case letters, digits and hyphens`);
    else if (seen.has(b.id)) problems.push(`${at}: id ${b.id} twice`);
    else seen.add(b.id);
    if (!LIBRARY_SHAPES.includes(b.shape as LibraryShape)) problems.push(`${at}: shape must be one of ${LIBRARY_SHAPES.join(', ')}`);
    if (typeof b.subject !== 'string' || b.subject.trim().length < 20) problems.push(`${at}: subject (what the photo shows) is required`);
    else if (FORBIDDEN.test(b.subject)) problems.push(`${at}: the subject says "${FORBIDDEN.exec(b.subject)![0]}", which the pilot never shows`);
    if (typeof b.alt !== 'string' || !b.alt.trim() || b.alt.length > 160) problems.push(`${at}: alt text (at most 160 characters) is required`);
    if (!Array.isArray(b.tags) || !b.tags.every(t => typeof t === 'string' && t)) problems.push(`${at}: tags must be a list of words`);
    else if (b.tags.some(t => EXCLUDED_INDUSTRIES.includes(t.toLowerCase()))) problems.push(`${at}: a health tag (never in the library's templates)`);
  });
  if (problems.length) throw new Error(`prompt plan:\n  ${problems.join('\n  ')}`);
  return d as Plan;
}

/** The prompt sent for a brief: subject, framing for its shape, the category's style, the safety rules. */
export function promptFor(plan: Pick<Plan, 'style'>, brief: Pick<Brief, 'subject' | 'shape'>): string {
  return `${brief.subject.trim().replace(/\.$/, '')}. ${FRAMING[brief.shape]} ${plan.style.trim()} ${SAFETY}`;
}

/** One row of admin_image_library_coverage() (00023). */
export interface CoverageRow { category: string; shape: string; approved: number; pending: number; templates?: number; most_in_a_template: number; slots?: number }

/** Per shape, how many more photos the category needs so one template need not repeat one (the most in a template less approved and pending). */
export function shortfall(rows: readonly CoverageRow[], category: string): Record<LibraryShape, number> {
  const out = Object.fromEntries(LIBRARY_SHAPES.map(s => [s, 0])) as Record<LibraryShape, number>;
  for (const r of rows) {
    if (r.category !== category || !LIBRARY_SHAPES.includes(r.shape as LibraryShape)) continue;
    out[r.shape as LibraryShape] = Math.max(0, (r.most_in_a_template ?? 0) - (r.approved ?? 0) - (r.pending ?? 0));
  }
  return out;
}

/** How many briefs the plan has per shape. */
export function perShape(briefs: readonly Pick<Brief, 'shape'>[]): Record<LibraryShape, number> {
  const out = Object.fromEntries(LIBRARY_SHAPES.map(s => [s, 0])) as Record<LibraryShape, number>;
  for (const b of briefs) out[b.shape]++;
  return out;
}

/**
 * The briefs a run takes: --ids, else up to `limit` taken across shapes in
 * turn (the shape most short of what the category needs first, then the one
 * with the fewest taken; ties in LIBRARY_SHAPES order), each shape's briefs
 * in plan order. Briefs already generated (`done`) are left out.
 */
export function selectBriefs(plan: Plan, o: { limit: number; ids?: string[] | null; need?: Partial<Record<LibraryShape, number>>; done?: ReadonlySet<string> }): Brief[] {
  const open = plan.briefs.filter(b => !o.done?.has(b.id));
  if (o.ids?.length) {
    const unknown = o.ids.filter(id => !plan.briefs.some(b => b.id === id));
    if (unknown.length) throw new Error(`no brief ${unknown.join(', ')} in the ${plan.category} plan`);
    return open.filter(b => o.ids!.includes(b.id));
  }
  const queues = new Map(LIBRARY_SHAPES.map(s => [s, open.filter(b => b.shape === s)]));
  const taken = Object.fromEntries(LIBRARY_SHAPES.map(s => [s, 0])) as Record<LibraryShape, number>;
  const out: Brief[] = [];
  while (out.length < o.limit) {
    let best: LibraryShape | null = null;
    let score = -Infinity;
    for (const s of LIBRARY_SHAPES) {
      if (!queues.get(s)!.length) continue;
      const v = (o.need?.[s] ?? 0) - taken[s];
      if (v > score) { score = v; best = s; }
    }
    if (!best) break;
    out.push(queues.get(best)!.shift()!);
    taken[best]++;
  }
  return out;
}

/* ── Cost: an estimate from a price table, never a claim of OpenAI's prices ── */

export interface PriceTable {
  currency: string;
  /** per quality, per size (e.g. medium → 1024x1024 → 0.05). */
  per_image: Partial<Record<Quality, Record<string, number>>>;
  /** USD (or the table's currency) per million tokens; null: the cost log records the tokens only. */
  per_million_tokens?: { text_input: number | null; image_input: number | null; output: number | null } | null;
}

/** --price-per-image "1024x1024=0.05,1536x1024:high=0.3": entries without a quality apply to the run's quality. */
export function applyPriceOverrides(table: PriceTable, spec: string | null, quality: Quality): PriceTable {
  if (!spec) return table;
  const out: PriceTable = { ...table, per_image: Object.fromEntries(Object.entries(table.per_image).map(([q, v]) => [q, { ...v }])) };
  for (const part of spec.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d+x\d+)(?::(low|medium|high))?=(\d+(?:\.\d+)?)$/.exec(part);
    if (!m) throw new Error(`--price-per-image: "${part}" is not <size>[:<quality>]=<amount>, e.g. 1024x1024=0.05`);
    const q = (m[2] as Quality | undefined) ?? quality;
    (out.per_image[q] ??= {})[m[1]] = Number(m[3]);
  }
  return out;
}

/** The estimated price of one image (null when the table has none for its size and quality). */
export function priceOf(table: PriceTable, size: string, quality: Quality): number | null {
  const v = table.per_image[quality]?.[size];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

export interface Estimate { total: number | null; perImage: { id: string; size: string; price: number | null }[]; unknown: string[] }

/** The estimate for a run: per image and in all (null while any price is unknown). */
export function estimate(briefs: readonly Brief[], table: PriceTable, quality: Quality): Estimate {
  const perImage = briefs.map(b => ({ id: b.id, size: SIZE_FOR_SHAPE[b.shape], price: priceOf(table, SIZE_FOR_SHAPE[b.shape], quality) }));
  const unknown = [...new Set(perImage.filter(p => p.price === null).map(p => p.size))];
  const total = unknown.length ? null : Math.round(perImage.reduce((s, p) => s + p.price!, 0) * 10000) / 10000;
  return { total, perImage, unknown };
}

/** Whether a run may spend: within --max-cost, or --yes. */
export function costGuard(est: Pick<Estimate, 'total' | 'unknown'>, maxCost: number, yes: boolean): { ok: boolean; reason: string } {
  if (est.total === null) {
    return yes ? { ok: true, reason: `no price for ${est.unknown.join(', ')}; going ahead because of --yes` }
      : { ok: false, reason: `no price for ${est.unknown.join(', ')} at this quality: set it (--price-per-image or --prices) or add --yes` };
  }
  if (est.total > maxCost && !yes) return { ok: false, reason: `the estimate ${est.total} is above --max-cost ${maxCost}: lower --limit, raise --max-cost or add --yes` };
  return { ok: true, reason: est.total > maxCost ? `the estimate ${est.total} is above --max-cost ${maxCost}; going ahead because of --yes` : `the estimate ${est.total} is within --max-cost ${maxCost}` };
}

/** The usage the Images API returns for gpt-image-1. */
export interface ImageUsage {
  total_tokens?: number; input_tokens?: number; output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
}

/** The cost of one image from its usage, when the table has token prices (else null: the log keeps the tokens). */
export function usageCost(usage: ImageUsage | null | undefined, table: PriceTable): number | null {
  const t = table.per_million_tokens;
  if (!usage || !t || t.text_input == null || t.output == null) return null;
  const text = usage.input_tokens_details?.text_tokens ?? usage.input_tokens ?? 0;
  const image = usage.input_tokens_details?.image_tokens ?? 0;
  if (image && t.image_input == null) return null;
  const v = (text * t.text_input + image * (t.image_input ?? 0) + (usage.output_tokens ?? 0) * t.output) / 1e6;
  return Math.round(v * 1e6) / 1e6;
}

/* ── The API, with retry and backoff ─────────────────────────────────────── */

/** Anything that looks like an API key, masked (for error messages from the API). */
export function maskKeys(s: string, key?: string | null): string {
  let out = s.replace(/sk-[A-Za-z0-9_*-]{6,}/g, 'sk-…');
  if (key) out = out.split(key).join('sk-…');
  return out;
}

export interface GenerateDeps {
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
    ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string>;
  }>;
  sleep: (ms: number) => Promise<void>;
  key: string;
}
export interface Generated { bytes: Uint8Array; usage: ImageUsage | null; created: number | null; revisedPrompt: string | null; attempts: number }

/** The request body for one image. */
export function requestBody(prompt: string, shape: LibraryShape, quality: Quality, format: Format): Record<string, unknown> {
  return {
    model: MODEL, prompt, n: 1, size: SIZE_FOR_SHAPE[shape], quality, output_format: format,
    ...(format === 'png' ? {} : { output_compression: 90 }),
  };
}

/** How long to wait before attempt `n` (1-based retry): Retry-After when given (at most a minute), else 2, 4, 8 … s. */
export function backoffMs(retry: number, retryAfter: string | null): number {
  const s = Number(retryAfter);
  if (retryAfter && Number.isFinite(s) && s >= 0) return Math.min(60_000, s * 1000);
  return Math.min(60_000, 1000 * 2 ** retry);
}

/** One image: n = 1, retried on 429, 5xx and network errors; any other answer stops with its message (keys masked). */
export async function generateImage(body: Record<string, unknown>, deps: GenerateDeps, retries = 4): Promise<Generated> {
  for (let attempt = 1; ; attempt++) {
    let res: Awaited<ReturnType<GenerateDeps['fetch']>> | null = null;
    let failure = '';
    try {
      res = await deps.fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${deps.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      failure = `network: ${maskKeys(String((e as Error)?.message ?? e), deps.key)}`;
    }
    if (res?.ok) {
      const json = JSON.parse(await res.text()) as { created?: number; data?: { b64_json?: string; revised_prompt?: string }[]; usage?: ImageUsage };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new Error('the API answered without an image (data[0].b64_json)');
      return {
        bytes: new Uint8Array(Buffer.from(b64, 'base64')), usage: json.usage ?? null, created: json.created ?? null,
        revisedPrompt: json.data?.[0]?.revised_prompt ?? null, attempts: attempt,
      };
    }
    if (res) {
      const text = maskKeys((await res.text()).slice(0, 600), deps.key);
      failure = `${res.status} ${text}`;
      if (res.status !== 429 && res.status < 500) throw new Error(`OpenAI: ${failure}`);
    }
    if (attempt > retries) throw new Error(`OpenAI: gave up after ${attempt} attempts: ${failure}`);
    const wait = backoffMs(attempt, res?.headers.get('retry-after') ?? null);
    console.log(`  ${failure.split('\n')[0].slice(0, 120)}; retrying in ${Math.round(wait / 1000)} s`);
    await deps.sleep(wait);
  }
}

/* ── The catalogue the loader reads ──────────────────────────────────────── */

export const fileName = (category: string, briefId: string, mime: string) =>
  `${category}-${briefId}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`;

/** The loader's entry for a generated image: shape from its actual size, alt from the brief, origin and licence as the owner set them. */
export function catalogueEntry(plan: Plan, brief: Brief, file: string, bytes: { sha256: string; width: number; height: number }, meta: {
  prompt: string; quality: Quality; size: string; created: number | null; revisedPrompt: string | null; generated: string; planFile: string;
  croppedTo?: string | null;
}): CatalogueEntry {
  const shape = shapeOf(bytes.width, bytes.height) ?? undefined;
  return {
    sha256: bytes.sha256, file, width: bytes.width, height: bytes.height, category: plan.category, shape,
    tags: [...new Set([...brief.tags, 'ai-generated'])], alt: brief.alt, origin: ORIGIN, licence: LICENCE, licence_evidence: LICENCE_EVIDENCE,
    sources: [{
      model: MODEL, api: API_URL, prompt: meta.prompt, ...(meta.revisedPrompt ? { revised_prompt: meta.revisedPrompt } : {}),
      quality: meta.quality, size: meta.size, ...(meta.croppedTo ? { cropped_to: meta.croppedTo } : {}),
      brief: brief.id, plan: meta.planFile, generated: meta.generated,
      ...(meta.created ? { created: new Date(meta.created * 1000).toISOString() } : {}),
      terms: LICENCE_EVIDENCE,
    }],
    focal_x: 0.5, focal_y: 0.5,
  };
}

/** The brief an entry was generated from (its sources). */
export const briefOf = (e: CatalogueEntry): string | null => {
  const s = (e.sources ?? []).find(x => typeof x === 'object' && x && 'brief' in x) as { brief?: string } | undefined;
  return s?.brief ?? null;
};

/** The catalogue with an entry added or replaced (same brief or same file). */
export function upsert(images: readonly CatalogueEntry[], e: CatalogueEntry): CatalogueEntry[] {
  const b = briefOf(e);
  return [...images.filter(x => x.file !== e.file && (b === null || briefOf(x) !== b) && x.sha256 !== e.sha256), e];
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The contact sheet for review: every image with its brief, shape, size and alt text, and what to check. */
export function contactSheetHtml(category: string, images: readonly CatalogueEntry[]): string {
  const tiles = images.map(e => `<figure><div class="pic"><img src="${esc(e.file)}" alt=""></div><figcaption>
<b>${esc(briefOf(e) ?? e.file)}</b> · ${esc(e.shape ?? '')} · ${e.width} × ${e.height}<br>${esc(e.alt ?? '')}</figcaption></figure>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(categoryLabel(category))}: AI pilot for review</title>
<style>body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#111;background:#fff}h1{font-size:20px;margin:0 0 4px}
p{margin:0 0 16px;color:#333}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}figure{margin:0}
.pic{background:#eee;height:240px;display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:240px}
figcaption{margin-top:6px;font-size:12px;color:#222}</style></head><body>
<h1>${esc(categoryLabel(category))} (${esc(category)}): ${images.length} AI-generated image(s), pending review</h1>
<p>Check each image for: quality (hands, faces, tools, perspective); a misleading depiction (work done unsafely or wrongly, a setting the category's companies would not have); any text, letters or numbers; logos, brand marks or watermarks; children; a medical or clinical setting; anyone resembling a real person. Drop a failing one with <code>--drop &lt;brief&gt; --reason "…"</code> before loading.</p>
<div class="grid">
${tiles}
</div></body></html>`;
}

/* ── The command line ────────────────────────────────────────────────────── */

export interface Options {
  category: string | null; plan: string | null; limit: number; ids: string[] | null; coverage: string | null;
  quality: Quality; format: Format; prices: string | null; pricePerImage: string | null; maxCost: number; yes: boolean;
  generate: boolean; out: string | null; regenerate: boolean; crop: boolean; retries: number;
  drop: string[] | null; reason: string | null; upload: boolean;
}

export function parseArgs(argv: readonly string[]): Options {
  const arg = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return null;
    const v = argv[i + 1];
    return v && !v.startsWith('--') ? v : '';
  };
  const list = (name: string) => { const v = arg(name)?.split(',').map(s => s.trim()).filter(Boolean); return v?.length ? v : null; };
  const num = (name: string, dflt: number, min: number) => { const v = Number(arg(name)); return arg(name) && Number.isFinite(v) && v >= min ? v : dflt; };
  const quality = (arg('quality') || 'medium') as Quality;
  if (!QUALITIES.includes(quality)) throw new Error(`--quality must be ${QUALITIES.join(', ')}`);
  const format = (arg('format') || 'jpeg') as Format;
  if (!FORMATS.includes(format)) throw new Error(`--format must be ${FORMATS.join(', ')}`);
  return {
    category: arg('category') || null, plan: arg('plan') || null, limit: Math.floor(num('limit', 12, 1)), ids: list('ids'),
    coverage: arg('coverage') || null, quality, format, prices: arg('prices') || null, pricePerImage: arg('price-per-image') || null,
    maxCost: num('max-cost', 5, 0), yes: argv.includes('--yes'), generate: argv.includes('--generate'), out: arg('out') || null,
    regenerate: argv.includes('--regenerate'), crop: !argv.includes('--no-crop'), retries: Math.floor(num('retries', 4, 0)),
    drop: list('drop'), reason: arg('reason') || null, upload: argv.includes('--upload'),
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));

type Img = { setContent(html: string, o?: Record<string, unknown>): Promise<void>; goto(url: string, o?: Record<string, unknown>): Promise<unknown>;
  screenshot(o: Record<string, unknown>): Promise<Uint8Array>; close(): Promise<void> };
type Pw = { newPage(o: Record<string, unknown>): Promise<Img>; close(): Promise<void> };

/** A local browser (Playwright, optional) for the hero crop and the contact sheet; nothing is fetched from the network. */
export async function browser(): Promise<Pw | null> {
  try {
    const { chromium } = await import('playwright') as unknown as { chromium: { launch(): Promise<Pw> } };
    return await chromium.launch();
  } catch {
    return null;
  }
}

/** A hero cropped to HERO_CROP from the middle of a 1536 × 1024 image, drawn 1 : 1 (PNG stays PNG, else JPEG at 92). */
export async function cropHero(pw: Pw, bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const page = await pw.newPage({ viewport: HERO_CROP, deviceScaleFactor: 1 });
  try {
    const info = imageInfo(bytes)!;
    const top = Math.round((info.height * (HERO_CROP.width / info.width) - HERO_CROP.height) / 2);
    await page.setContent(`<html><body style="margin:0;overflow:hidden"><img style="display:block;width:${HERO_CROP.width}px;margin-top:-${top}px" src="data:${mime};base64,${Buffer.from(bytes).toString('base64')}"></body></html>`, { waitUntil: 'load' });
    return await page.screenshot(mime === 'image/jpeg' ? { type: 'jpeg', quality: 92 } : { type: 'png' });
  } finally {
    await page.close();
  }
}

async function readJson<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }

async function loadCatalogue(file: string): Promise<CatalogueEntry[]> {
  return existsSync(file) ? readCatalogue(await readJson(file)).images : [];
}

async function writeContactSheet(out: string, category: string, images: CatalogueEntry[], pw: Pw | null) {
  const html = join(out, 'contact-sheet.html');
  await writeFile(html, contactSheetHtml(category, images));
  if (!pw) { console.log(`contact sheet: ${html} (no PNG: Playwright is not installed)`); return; }
  const page = await pw.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(pathToFileURL(resolve(html)).href, { waitUntil: 'load' });
    await writeFile(join(out, 'contact-sheet.png'), await page.screenshot({ type: 'png', fullPage: true }));
    console.log(`contact sheet: ${html} and contact-sheet.png`);
  } finally {
    await page.close();
  }
}

async function drop(o: Options, out: string, category: string) {
  const file = join(out, 'library-catalogue.json');
  const images = await loadCatalogue(file);
  if (!o.reason) throw new Error('--drop needs --reason "what failed review"');
  const gone = images.filter(e => o.drop!.includes(briefOf(e) ?? '') || o.drop!.includes(e.file));
  const missing = o.drop!.filter(d => !gone.some(e => briefOf(e) === d || e.file === d));
  if (missing.length) throw new Error(`not in the catalogue: ${missing.join(', ')}`);
  await mkdir(join(out, 'rejected'), { recursive: true });
  for (const e of gone) if (existsSync(join(out, e.file))) await rename(join(out, e.file), join(out, 'rejected', e.file));
  const kept = images.filter(e => !gone.includes(e));
  await writeFile(file, JSON.stringify({ version: 1, images: kept }, null, 2) + '\n');
  const logFile = join(out, 'review-log.json');
  const log = existsSync(logFile) ? await readJson<unknown[]>(logFile) : [];
  for (const e of gone) log.push({ brief: briefOf(e), file: e.file, sha256: e.sha256, dropped: new Date().toISOString(), reason: o.reason });
  await writeFile(logFile, JSON.stringify(log, null, 2) + '\n');
  console.log(`dropped ${gone.length} image(s) (moved to ${join(out, 'rejected')}); ${kept.length} left in the catalogue`);
  const pw = await browser();
  try { await writeContactSheet(out, category, kept, pw); } finally { await pw?.close(); }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.upload) {
    throw new Error('this script never uploads to FlyttGo. Review the images, then load them as pending with '
      + 'node scripts/import-image-library.ts --library <out>/library-catalogue.json (dry run; --upload needs the owner\'s approval)');
  }
  if (!o.category && !o.plan) throw new Error(`say which category: --category <${LIBRARY_CATEGORIES.join('|')}> (a plan in scripts/image-prompts/)`);
  const planFile = o.plan ?? join(HERE, 'image-prompts', `${o.category}.json`);
  if (!existsSync(planFile)) throw new Error(`no prompt plan ${planFile}`);
  const plan = readPlan(await readJson(planFile));
  if (o.category && plan.category !== o.category) throw new Error(`${planFile} is the ${plan.category} plan, not ${o.category}`);
  const out = o.out ?? join('ai-images', plan.category);
  if (o.drop) return drop(o, out, plan.category);

  const catalogueFile = join(out, 'library-catalogue.json');
  const existing = await loadCatalogue(catalogueFile);
  const done = new Set(o.regenerate ? [] : existing.map(briefOf).filter((b): b is string => !!b));
  const coverage = o.coverage ? await readJson<CoverageRow[] | { rows: CoverageRow[] }>(o.coverage) : null;
  const need = coverage ? shortfall(Array.isArray(coverage) ? coverage : coverage.rows, plan.category) : undefined;
  const briefs = selectBriefs(plan, { limit: o.limit, ids: o.ids, need, done });
  const table = applyPriceOverrides(await readJson<PriceTable>(o.prices ?? join(HERE, 'image-prompts', 'prices.json')), o.pricePerImage, o.quality);
  const est = estimate(briefs, table, o.quality);
  const guard = costGuard(est, o.maxCost, o.yes);
  const planRel = planFile.startsWith(resolve(HERE, '..')) ? planFile.slice(resolve(HERE, '..').length + 1) : planFile;

  const all = perShape(plan.briefs);
  const picked = perShape(briefs);
  console.log(`${categoryLabel(plan.category)} (${plan.category}): ${plan.briefs.length} brief(s) in ${planRel}; ${done.size} already generated in ${catalogueFile}`);
  for (const s of LIBRARY_SHAPES) {
    console.log(`  ${s.padEnd(8)} ${String(picked[s]).padStart(2)} this run of ${all[s]} briefs, ${SIZE_FOR_SHAPE[s]}${s === 'hero' && o.crop ? ` cropped to ${HERO_CROP.width}x${HERO_CROP.height}` : ''}`
      + (need ? `; the category is ${need[s]} short of what one template needs` : ''));
  }
  if (!need) console.log('  (add --coverage <rows of admin_image_library_coverage() as JSON> to take the shapes the category lacks first)');
  console.log(`\n${briefs.length} image(s) with ${MODEL}, quality ${o.quality}, ${o.format}, n = 1 each:`);
  for (const b of briefs) {
    const p = est.perImage.find(x => x.id === b.id)!;
    console.log(`\n- ${b.id} (${b.shape}, ${p.size}; estimate ${p.price ?? 'unknown'} ${table.currency})\n  alt: ${b.alt}\n  prompt: ${promptFor(plan, b)}`);
  }
  console.log(`\nEstimated cost: ${est.total ?? 'unknown'} ${table.currency} (--max-cost ${o.maxCost}).`);
  console.log(`The prices are the table's assumptions, not OpenAI's: check ${PRICING_PAGE} and set them in ${o.prices ?? 'scripts/image-prompts/prices.json'} or with --price-per-image.`);
  console.log(guard.reason);
  if (!o.generate) { console.log('dry run: nothing was sent. Add --generate (with OPENAI_API_KEY) to make the images.'); return; }
  if (!guard.ok) throw new Error(`not generating: ${guard.reason}`);
  if (!briefs.length) { console.log('nothing to generate'); return; }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set (an API key from platform.openai.com; a ChatGPT subscription does not include API use)');
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== '1') {
    console.log('warning: HTTPS_PROXY is set but NODE_USE_ENV_PROXY is not 1: Node\'s fetch will not use the proxy');
  }

  await mkdir(out, { recursive: true });
  const costFile = join(out, 'cost-log.json');
  const costLog = existsSync(costFile) ? await readJson<unknown[]>(costFile) : [];
  let images = existing;
  let spent = 0;
  const pw = await browser();
  if (!pw && o.crop && briefs.some(b => b.shape === 'hero')) console.log('warning: Playwright is not installed: hero images stay 1536 × 1024 and count as "wide"');
  const deps: GenerateDeps = { fetch: (u, i) => fetch(u, i), sleep: ms => new Promise(r => setTimeout(r, ms)), key };
  try {
    for (const [n, b] of briefs.entries()) {
      const price = est.perImage[n].price ?? 0;
      if (!o.yes && spent + price > o.maxCost) { console.log(`stopping: the next image would take the estimate above --max-cost ${o.maxCost}`); break; }
      const prompt = promptFor(plan, b);
      console.log(`[${n + 1}/${briefs.length}] ${b.id} (${b.shape}, ${SIZE_FOR_SHAPE[b.shape]})`);
      const g = await generateImage(requestBody(prompt, b.shape, o.quality, o.format), deps, o.retries);
      let bytes = g.bytes;
      const info0 = imageInfo(bytes);
      if (!info0) throw new Error(`${b.id}: the API returned something that is not a PNG, JPEG or WebP image`);
      let croppedTo: string | null = null;
      if (b.shape === 'hero' && o.crop && pw && shapeOf(info0.width, info0.height) !== 'hero') {
        bytes = await cropHero(pw, bytes, info0.mime);
        croppedTo = `${HERO_CROP.width}x${HERO_CROP.height}`;
      }
      const info = imageInfo(bytes)!;
      const file = fileName(plan.category, b.id, info.mime);
      await writeFile(join(out, file), bytes);
      const sha256 = await sha256Hex(bytes);
      const entry = catalogueEntry(plan, b, file, { sha256, width: info.width, height: info.height }, {
        prompt, quality: o.quality, size: SIZE_FOR_SHAPE[b.shape], created: g.created, revisedPrompt: g.revisedPrompt,
        generated: new Date().toISOString().slice(0, 10), planFile: planRel, croppedTo,
      });
      images = upsert(images, entry);
      // Written after every image: an interrupted run keeps what it made.
      await writeFile(catalogueFile, JSON.stringify({ version: 1, images }, null, 2) + '\n');
      spent += price;
      costLog.push({ brief: b.id, file, sha256, model: MODEL, size: SIZE_FOR_SHAPE[b.shape], quality: o.quality, attempts: g.attempts,
        usage: g.usage, estimate: est.perImage[n].price, cost_from_usage: usageCost(g.usage, table), currency: table.currency, at: new Date().toISOString() });
      await writeFile(costFile, JSON.stringify(costLog, null, 2) + '\n');
      console.log(`  ${file}: ${info.width} × ${info.height}, ${entry.shape}; tokens ${g.usage?.total_tokens ?? 'not reported'}`);
    }
    await writeContactSheet(out, plan.category, images, pw);
  } finally {
    await pw?.close();
  }
  console.log(`\n${images.length} image(s) in ${catalogueFile}; cost log ${costFile} (estimate so far ${Math.round(spent * 10000) / 10000} ${table.currency}).`);
  console.log('Next: review the contact sheet (--drop <brief> --reason "…" for any that fail), then');
  console.log(`  node scripts/import-image-library.ts --library ${catalogueFile}          # dry run`);
  console.log('  … --upload with the owner\'s approval: the images enter the library as pending; approve each in Admin → White label → Image library');
  console.log('  once the owner has confirmed OpenAI\'s terms for commercial use on customers\' sites.');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(maskKeys(String(e?.message ?? e), process.env.OPENAI_API_KEY)); process.exit(1); });
