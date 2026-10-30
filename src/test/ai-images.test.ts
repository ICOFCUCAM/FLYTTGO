import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { readCatalogue, shapeOf, LIBRARY_SHAPES } from '../../supabase/functions/_shared/image-library.ts';
import { imageInfo, sha256Hex } from '../../supabase/functions/_shared/template-images.ts';
import {
  FORBIDDEN, HERO_CROP, LICENCE, LICENCE_EVIDENCE, ORIGIN, SAFETY, SIZE_FOR_SHAPE, applyPriceOverrides, backoffMs, briefOf,
  catalogueEntry, contactSheetHtml, costGuard, estimate, fileName, generateImage, maskKeys, parseArgs, perShape, priceOf,
  promptFor, readPlan, requestBody, selectBriefs, shortfall, upsert, usageCost, type GenerateDeps, type Plan, type PriceTable,
} from '../../scripts/generate-library-images.ts';

const load = async (name: string) => JSON.parse(await readFile(new URL(`../../scripts/image-prompts/${name}`, import.meta.url), 'utf8'));
const PLANS = ['trades', 'appointments', 'transport'];

const PLAN: Plan = readPlan({
  version: 1, category: 'trades', style: 'Realistic photograph, natural light.',
  briefs: [
    { id: 'h1', shape: 'hero', subject: 'A plumber working under a kitchen sink', tags: ['plumbing'], alt: 'A plumber at a sink' },
    { id: 'h2', shape: 'hero', subject: 'An electrician testing a fuse board', tags: ['electrician'], alt: 'An electrician' },
    { id: 'w1', shape: 'wide', subject: 'A cleaner wiping a kitchen counter', tags: ['cleaning'], alt: 'A cleaner' },
    { id: 'w2', shape: 'wide', subject: 'A mechanic changing a car tyre', tags: ['tyres'], alt: 'A mechanic' },
    { id: 'w3', shape: 'wide', subject: 'A painter rolling paint on a wall', tags: ['painting'], alt: 'A painter' },
    { id: 's1', shape: 'square', subject: 'Plumbing tools laid out on a workbench', tags: ['tools'], alt: 'Tools' },
    { id: 'p1', shape: 'portrait', subject: 'Portrait of a fictional carpenter on site', tags: ['team'], alt: 'A carpenter' },
  ],
});

const TABLE: PriceTable = {
  currency: 'USD',
  per_image: { medium: { '1024x1024': 0.05, '1536x1024': 0.08, '1024x1536': 0.08 }, high: { '1024x1024': 0.2 } },
  per_million_tokens: { text_input: 5, image_input: 10, output: 40 },
};

describe('the checked-in prompt plans', () => {
  it.each(PLANS)('%s: a valid plan of its own category, with every shape, unique ids and alt texts', async (name) => {
    const plan = readPlan(await load(`${name}.json`));
    expect(plan.category).toBe(name);
    const n = perShape(plan.briefs);
    for (const s of LIBRARY_SHAPES) expect(n[s]).toBeGreaterThanOrEqual(3);
    expect(plan.briefs.length).toBeGreaterThanOrEqual(16);
    expect(new Set(plan.briefs.map(b => b.id)).size).toBe(plan.briefs.length);
    for (const b of plan.briefs) {
      expect(b.alt.length).toBeGreaterThan(5);
      expect(b.subject).not.toMatch(FORBIDDEN);
    }
  });
  it('the pilot categories have enough briefs for a pilot of 20', async () => {
    for (const name of ['trades', 'appointments']) expect(readPlan(await load(`${name}.json`)).briefs.length).toBeGreaterThanOrEqual(20);
  });
  it('appointments never shows a clinic or health setting', async () => {
    const plan = readPlan(await load('appointments.json'));
    expect(plan.style).toMatch(/never a clinic/);
    for (const b of plan.briefs) expect(`${b.subject} ${b.tags.join(' ')}`).not.toMatch(/clinic|medical|patient|dermatolog|physio|therap/i);
  });
  it('every prompt carries the safety rules and the category style', async () => {
    const plan = readPlan(await load('trades.json'));
    for (const b of plan.briefs) {
      const p = promptFor(plan, b);
      expect(p).toContain(SAFETY);
      expect(p).toContain(plan.style);
      expect(p.startsWith(b.subject)).toBe(true);
    }
    expect(SAFETY).toMatch(/no text/i);
    expect(SAFETY).toMatch(/logos/);
    expect(SAFETY).toMatch(/watermarks/);
    expect(SAFETY).toMatch(/no children/);
    expect(SAFETY).toMatch(/medical/);
  });
});

describe('reading a plan', () => {
  it('lists every problem: category, shape, ids twice, words the pilot never shows, health tags', () => {
    let msg = '';
    try {
      readPlan({ version: 1, category: 'nope', style: 'x', briefs: [
        { id: 'a', shape: 'round', subject: 'A happy family with their children in a kitchen', tags: [], alt: 'x' },
        { id: 'a', shape: 'wide', subject: 'A shop front with the company logo above the door', tags: [], alt: 'x' },
        { id: 'c', shape: 'wide', subject: 'A receptionist at the front desk of a small studio', tags: ['clinic'], alt: '' },
      ] });
    } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/category must be one of/);
    expect(msg).toMatch(/briefs\[0\]: shape/);
    expect(msg).toMatch(/"children"/);
    expect(msg).toMatch(/id a twice/);
    expect(msg).toMatch(/"logo"/);
    expect(msg).toMatch(/briefs\[2\]: alt text/);
    expect(msg).toMatch(/health tag/);
  });
});

describe('shapes and sizes', () => {
  it('asks gpt-image-1 for its sizes, and each gives the shape it is for (a hero after its crop)', () => {
    const size = (s: string) => s.split('x').map(Number) as [number, number];
    expect(SIZE_FOR_SHAPE).toEqual({ hero: '1536x1024', wide: '1536x1024', square: '1024x1024', portrait: '1024x1536' });
    expect(shapeOf(...size(SIZE_FOR_SHAPE.wide))).toBe('wide');
    expect(shapeOf(...size(SIZE_FOR_SHAPE.square))).toBe('square');
    expect(shapeOf(...size(SIZE_FOR_SHAPE.portrait))).toBe('portrait');
    // 1536 × 1024 is 1.5 : 1, below a hero's 1.6 : 1: the crop makes it one.
    expect(shapeOf(...size(SIZE_FOR_SHAPE.hero))).toBe('wide');
    expect(shapeOf(HERO_CROP.width, HERO_CROP.height)).toBe('hero');
  });
  it('the request: the model, n = 1, the size for the shape, the quality, the format', () => {
    expect(requestBody('p', 'portrait', 'medium', 'jpeg')).toEqual({
      model: 'gpt-image-1', prompt: 'p', n: 1, size: '1024x1536', quality: 'medium', output_format: 'jpeg', output_compression: 90,
    });
    expect(requestBody('p', 'square', 'low', 'png')).not.toHaveProperty('output_compression');
  });
});

describe('which briefs a run takes', () => {
  it('across shapes in turn, each in plan order, up to --limit', () => {
    expect(selectBriefs(PLAN, { limit: 5 }).map(b => b.id)).toEqual(['h1', 'w1', 's1', 'p1', 'h2']);
    expect(selectBriefs(PLAN, { limit: 100 }).length).toBe(PLAN.briefs.length);
  });
  it('the shapes the category is short of first (coverage), never one already generated', () => {
    const need = shortfall([
      { category: 'trades', shape: 'wide', approved: 0, pending: 1, most_in_a_template: 4 },
      { category: 'trades', shape: 'hero', approved: 2, pending: 0, most_in_a_template: 1 },
      { category: 'appointments', shape: 'square', approved: 0, pending: 0, most_in_a_template: 9 },
    ], 'trades');
    expect(need).toEqual({ hero: 0, wide: 3, square: 0, portrait: 0 });
    expect(selectBriefs(PLAN, { limit: 4, need }).map(b => b.id)).toEqual(['w1', 'w2', 'w3', 'h1']);
    expect(selectBriefs(PLAN, { limit: 3, done: new Set(['h1', 'w1']) }).map(b => b.id)).toEqual(['h2', 'w2', 's1']);
  });
  it('--ids takes those, and an unknown one is refused', () => {
    expect(selectBriefs(PLAN, { limit: 1, ids: ['p1', 's1'] }).map(b => b.id)).toEqual(['s1', 'p1']);
    expect(() => selectBriefs(PLAN, { limit: 1, ids: ['zz'] })).toThrow(/no brief zz/);
  });
});

describe('the cost estimate and the --max-cost guard', () => {
  it('estimates per image from the table, for the run\'s quality', () => {
    const e = estimate(selectBriefs(PLAN, { limit: 4 }), TABLE, 'medium');
    expect(e.perImage.map(p => p.price)).toEqual([0.08, 0.08, 0.05, 0.08]);
    expect(e.total).toBe(0.29);
    const high = estimate(selectBriefs(PLAN, { limit: 4 }), TABLE, 'high');
    expect(high.total).toBeNull();
    expect(high.unknown).toEqual(['1536x1024', '1024x1536']);
  });
  it('overrides from --price-per-image, with or without a quality', () => {
    const t = applyPriceOverrides(TABLE, '1536x1024=0.1,1024x1536:high=0.3', 'medium');
    expect(priceOf(t, '1536x1024', 'medium')).toBe(0.1);
    expect(priceOf(t, '1024x1536', 'high')).toBe(0.3);
    expect(priceOf(TABLE, '1536x1024', 'medium')).toBe(0.08);
    expect(() => applyPriceOverrides(TABLE, 'hero=1', 'medium')).toThrow(/is not <size>/);
  });
  it('refuses above --max-cost or with an unknown price, unless --yes', () => {
    expect(costGuard({ total: 4.9, unknown: [] }, 5, false).ok).toBe(true);
    expect(costGuard({ total: 5.1, unknown: [] }, 5, false)).toMatchObject({ ok: false });
    expect(costGuard({ total: 5.1, unknown: [] }, 5, true).ok).toBe(true);
    expect(costGuard({ total: null, unknown: ['1536x1024'] }, 5, false)).toMatchObject({ ok: false });
    expect(costGuard({ total: null, unknown: ['1536x1024'] }, 5, true).ok).toBe(true);
  });
  it('the checked-in table says its figures are assumptions and points to OpenAI\'s pricing page', async () => {
    const t = await load('prices.json');
    expect(t.note).toMatch(/NOT OpenAI's prices/);
    expect(t.note).toContain('https://openai.com/api/pricing/');
    expect(costGuard(estimate(selectBriefs(PLAN, { limit: 12 }), t, 'medium'), 5, false).ok).toBe(true);
  });
  it('the actual cost from the usage only when token prices are set', () => {
    const usage = { total_tokens: 1300, input_tokens: 100, output_tokens: 1200, input_tokens_details: { text_tokens: 100, image_tokens: 0 } };
    expect(usageCost(usage, TABLE)).toBe((100 * 5 + 1200 * 40) / 1e6);
    expect(usageCost(usage, { ...TABLE, per_million_tokens: { text_input: null, image_input: null, output: null } })).toBeNull();
    expect(usageCost(null, TABLE)).toBeNull();
  });
});

/** A 1 × 1 PNG (as the API would return a picture, smaller). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const response = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300, status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

describe('calling the API (mocked: no network)', () => {
  const ok = response(200, { created: 1793000000, data: [{ b64_json: PNG.toString('base64') }],
    usage: { total_tokens: 1290, input_tokens: 90, output_tokens: 1200, input_tokens_details: { text_tokens: 90, image_tokens: 0 } } });

  it('posts one image with the key only in the header, and returns its bytes and usage', async () => {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    const deps: GenerateDeps = { key: 'sk-test-secret-123456', sleep: async () => {}, fetch: async (url, init) => { calls.push({ url, init }); return ok; } };
    const g = await generateImage(requestBody('a prompt', 'square', 'medium', 'png'), deps);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk-test-secret-123456');
    expect(calls[0].init.body).not.toContain('sk-test');
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ model: 'gpt-image-1', n: 1, size: '1024x1024' });
    expect(imageInfo(g.bytes)).toEqual({ mime: 'image/png', width: 1, height: 1 });
    expect(g.usage?.total_tokens).toBe(1290);
    expect(g.attempts).toBe(1);
  });
  it('retries on 429 (honouring Retry-After) and 5xx with backoff, then succeeds', async () => {
    const answers = [response(429, 'rate limited', { 'retry-after': '3' }), response(503, 'busy'), ok];
    const waits: number[] = [];
    const g = await generateImage({}, { key: 'k', sleep: async ms => { waits.push(ms); }, fetch: async () => answers.shift()! });
    expect(g.attempts).toBe(3);
    expect(waits).toEqual([3000, 4000]);
    expect(backoffMs(1, null)).toBe(2000);
    expect(backoffMs(9, null)).toBe(60000);
  });
  it('stops at once on another error, and gives up after --retries; keys are masked in the message', async () => {
    const bad = response(401, '{"error":{"message":"Incorrect API key provided: sk-proj-abcdef123456"}}');
    await expect(generateImage({}, { key: 'sk-proj-abcdef123456', sleep: async () => {}, fetch: async () => bad })).rejects.toThrow(/401/);
    await generateImage({}, { key: 'sk-proj-abcdef123456', sleep: async () => {}, fetch: async () => bad }).catch(e => {
      expect((e as Error).message).not.toContain('abcdef123456');
    });
    let n = 0;
    await expect(generateImage({}, { key: 'k', sleep: async () => {}, fetch: async () => { n++; return response(500, 'down'); } }, 2)).rejects.toThrow(/gave up after 3/);
    expect(n).toBe(3);
    expect(maskKeys('key sk-abc123def456 and mysecret', 'mysecret')).toBe('key sk-… and sk-…');
  });
});

describe('the catalogue the loader reads', () => {
  it('an entry per image: pending-ready, origin and licence as the owner set them, shape from the actual size, alt from the brief', async () => {
    const brief = PLAN.briefs[0];
    const sha256 = await sha256Hex(new Uint8Array(PNG));
    const file = fileName('trades', brief.id, 'image/jpeg');
    expect(file).toBe('trades-h1.jpg');
    const e = catalogueEntry(PLAN, brief, file, { sha256, width: 1536, height: 960 }, {
      prompt: promptFor(PLAN, brief), quality: 'medium', size: '1536x1024', created: 1793000000, revisedPrompt: null,
      generated: '2026-10-30', planFile: 'scripts/image-prompts/trades.json', croppedTo: '1536x960',
    });
    expect(e).toMatchObject({
      sha256, file, width: 1536, height: 960, category: 'trades', shape: 'hero', alt: 'A plumber at a sink',
      origin: ORIGIN, licence: LICENCE, licence_evidence: LICENCE_EVIDENCE, focal_x: 0.5, focal_y: 0.5,
    });
    expect(ORIGIN).toBe('AI-generated (OpenAI gpt-image-1)');
    expect(LICENCE).toMatch(/owner to confirm/);
    expect(LICENCE_EVIDENCE).toMatch(/^https:\/\/openai\.com\//);
    expect(e.tags).toEqual(['plumbing', 'ai-generated']);
    expect(e.sources?.[0]).toMatchObject({ model: 'gpt-image-1', prompt: promptFor(PLAN, brief), brief: 'h1', cropped_to: '1536x960' });
    expect(briefOf(e)).toBe('h1');
    // A 1536 × 1024 hero (no crop) is recorded as what it is: wide.
    expect(catalogueEntry(PLAN, brief, file, { sha256, width: 1536, height: 1024 }, {
      prompt: 'p', quality: 'medium', size: '1536x1024', created: null, revisedPrompt: null, generated: '2026-10-30', planFile: 'x',
    }).shape).toBe('wide');
    // The loader's own check accepts it.
    expect(readCatalogue({ version: 1, images: [e] }).images).toHaveLength(1);
  });
  it('generating a brief again replaces its entry; the contact sheet lists every image with what to check', async () => {
    const mk = (id: string, sha: string) => catalogueEntry(PLAN, PLAN.briefs.find(b => b.id === id)!, `trades-${id}.jpg`, { sha256: sha, width: 1024, height: 1024 }, {
      prompt: 'p', quality: 'medium', size: '1024x1024', created: null, revisedPrompt: null, generated: '2026-10-30', planFile: 'x',
    });
    const a = mk('s1', 'a'.repeat(64)), b = mk('p1', 'b'.repeat(64)), a2 = mk('s1', 'c'.repeat(64));
    expect(upsert(upsert([a], b), a2).map(e => e.sha256)).toEqual(['b'.repeat(64), 'c'.repeat(64)]);
    const html = contactSheetHtml('trades', [a, b]);
    expect(html).toContain('src="trades-s1.jpg"');
    expect(html).toContain('2 AI-generated image(s), pending review');
    expect(html).toMatch(/text, letters or numbers; logos, brand marks or watermarks/);
    expect(html).toMatch(/misleading depiction/);
  });
});

describe('the command line', () => {
  it('a dry run by default, quality medium, 12 images, max cost 5, never --upload by itself', () => {
    expect(parseArgs(['--category', 'trades'])).toMatchObject({
      category: 'trades', limit: 12, quality: 'medium', format: 'jpeg', maxCost: 5, yes: false, generate: false, crop: true, retries: 4, upload: false,
    });
    expect(parseArgs(['--category', 'trades', '--limit', '20', '--quality', 'high', '--max-cost', '2', '--generate', '--yes', '--no-crop']))
      .toMatchObject({ limit: 20, quality: 'high', maxCost: 2, generate: true, yes: true, crop: false });
    expect(() => parseArgs(['--quality', 'ultra'])).toThrow(/--quality/);
  });
});
