import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXCLUDED_INDUSTRIES, TEMPLATE_CATEGORIES, neutralImage, renderTemplatePage, type RenderContext,
} from '../../supabase/functions/_shared/site-template.ts';
import {
  COMPANY_IMAGE_BUCKET, LIBRARY_BUCKET, LIBRARY_CATEGORIES, imageUrls, libraryPath, pathsToSign, readCatalogue, renderImages,
  shapeOf, shapesFor, type ImageMap,
} from '../../supabase/functions/_shared/image-library.ts';
import { sha256Hex } from '../../supabase/functions/_shared/template-images.ts';
import { addPayload, plan } from '../../scripts/import-image-library.ts';

const SB = 'https://flyttgo.supabase.co';
const HOST = 'flyttgo.supabase.co';
const CONTAINERS = `${SB}/storage/v1/object/public/site-template-assets/shared/containers-1.jpg`;
const PAGE = '<html><head></head><body><img src="{{ASSET:hero}}" alt="Containers on a quay">'
  + '<img class="s" src="{{ASSET:services.1}}" alt="One"><div style="background:url(\'{{ASSET:services.2}}\')"></div>'
  + '<img src="{{ASSET:team.1}}" alt="Our stylist"><img src="{{ASSET:map}}" alt="Map"></body></html>';
const ctx = (extra: Partial<RenderContext> = {}): RenderContext => ({
  brand: { name: 'Acme', primaryColor: '#336699' }, assets: [{ key: 'hero', url: CONTAINERS }, { key: 'services.1', url: CONTAINERS }],
  pageUrl: () => '#', bookingUrl: '#', sellerNotice: 'n', assetHosts: [HOST], ...extra,
});

describe('the template categories in the database', () => {
  it('are the catalogue\'s, in the same order, with the same industries (site_template_category(), 00023)', async () => {
    const sql = await readFile(new URL('../../supabase/migrations/00023_image_library.sql', import.meta.url), 'utf8');
    const fn = sql.slice(sql.indexOf('FUNCTION public.site_template_category'), sql.indexOf('FUNCTION public.site_image_categories'));
    const words = (s: string) => [...s.matchAll(/'([^']+)'/g)].map(m => m[1]);
    const rows = [...fn.matchAll(/\((\d+), '([a-z]+)', ARRAY\[([^\]]+)\]\)/g)].map(m => ({ n: Number(m[1]), id: m[2], tags: words(m[3]) }));
    expect(rows.map(r => r.id)).toEqual(TEMPLATE_CATEGORIES.map(c => c.id));
    expect(rows.map(r => r.n)).toEqual(TEMPLATE_CATEGORIES.map((_c, i) => i + 1));
    for (const r of rows) expect(r.tags).toEqual(TEMPLATE_CATEGORIES.find(c => c.id === r.id)!.tags);
    const excluded = /ARRAY\[([^\]]+)\]\)\) THEN NULL/.exec(fn)?.[1] ?? '';
    expect(words(excluded)).toEqual(EXCLUDED_INDUSTRIES);
    const cats = /site_image_categories\(\)[\s\S]*?ARRAY\[([^\]]+)\]/.exec(sql.slice(sql.indexOf('FUNCTION public.site_image_categories')))?.[1] ?? '';
    expect(words(cats)).toEqual(LIBRARY_CATEGORIES);
  });
});

describe('shapes', () => {
  it('come from the size as the database computes them', () => {
    expect(shapeOf(1920, 1080)).toBe('hero');
    expect(shapeOf(1000, 600)).toBe('wide');                     // wide enough, too small for a banner
    expect(shapeOf(1200, 800)).toBe('wide');
    expect(shapeOf(900, 1000)).toBe('square');
    expect(shapeOf(800, 1200)).toBe('portrait');
    expect(shapeOf(0, 100)).toBeNull();
  });
  it('a hero slot takes hero or wide photos, a map none', () => {
    expect(shapesFor('hero')).toEqual(['hero', 'wide']);
    expect(shapesFor('wide')).toEqual(['wide', 'hero']);
    expect(shapesFor('portrait')).toEqual(['portrait']);
    expect(shapesFor('map')).toEqual([]);
  });
});

const MAP: ImageMap = {
  template: 'salon-a', category: 'appointments', mode: 'library',
  images: {
    hero: { source: 'company', shape: 'hero', bucket: COMPANY_IMAGE_BUCKET, path: 'org-1/hero-abc.webp', alt: 'Our salon' },
    'services.1': { source: 'library', shape: 'wide', bucket: LIBRARY_BUCKET, path: `appointments/${'a'.repeat(64)}.jpg`, alt: 'A stylist at work', id: 'l1', focal_x: 0.3 },
    'services.2': { source: 'library', shape: 'wide', bucket: LIBRARY_BUCKET, path: `appointments/${'b'.repeat(64)}.jpg`, alt: 'Scissors', id: 'l2' },
    'team.1': { source: 'fallback', shape: 'portrait' },
    map: { source: 'fallback', shape: 'map' },
  },
};

describe('the resolved map, for the renderer', () => {
  it('gives library photos their public address and the company\'s uploads the signed one', () => {
    expect(pathsToSign(MAP)).toEqual(['org-1/hero-abc.webp']);
    const r = renderImages(MAP, SB, { 'org-1/hero-abc.webp': `${SB}/storage/v1/object/sign/organization-site-images/org-1/hero-abc.webp?token=t` });
    expect(r.mode).toBe('library');
    expect(r.byKey.hero).toMatchObject({ source: 'company', url: expect.stringContaining('/object/sign/organization-site-images/') });
    expect(r.byKey['services.1']).toEqual({ source: 'library', alt: 'A stylist at work', focal: { x: 0.3, y: 0.5 },
      url: `${SB}/storage/v1/object/public/site-image-library/appointments/${'a'.repeat(64)}.jpg` });
    expect(r.byKey['team.1']).toMatchObject({ source: 'fallback', url: null });
    expect(imageUrls(r).length).toBe(3);
  });
  it('a company upload that could not be signed is a plain block, never another photo', () => {
    expect(renderImages(MAP, SB, {}).byKey.hero).toMatchObject({ url: null, source: 'fallback' });
  });
});

describe('rendering a page with the resolved images', () => {
  const images = renderImages(MAP, SB, { 'org-1/hero-abc.webp': `${SB}/storage/v1/object/sign/organization-site-images/org-1/hero-abc.webp?token=t` });
  const html = renderTemplatePage(PAGE, ctx({ images }));

  it('puts each slot\'s own image in, and never the shared imported photos', () => {
    expect(html).not.toContain('containers-1.jpg');
    expect(html).toContain('/object/sign/organization-site-images/org-1/hero-abc.webp?token=t');
    expect(html).toContain(`/site-image-library/appointments/${'a'.repeat(64)}.jpg`);
    expect(html).toContain(`url('${SB}/storage/v1/object/public/site-image-library/appointments/${'b'.repeat(64)}.jpg')`);
  });
  it('the description follows the picture; the plain block is decoration', () => {
    expect(html).toContain('alt="Our salon"');
    expect(html).not.toContain('Containers on a quay');
    expect(html).toMatch(/<img style="object-position:30% 50%" class="s" src="[^"]+" alt="A stylist at work">/);
    expect(html).toMatch(/<img src="data:image\/svg\+xml,[^"]+" alt="">/);
    expect(html).not.toContain('Our stylist');
  });
  it('a slot without an image is a plain block in the company\'s colour, safe in src and CSS', () => {
    const block = neutralImage('#336699');
    expect(block).toMatch(/^data:image\/svg\+xml,/);
    expect(block).not.toMatch(/['"() ]/);
    expect(decodeURIComponent(block)).toContain('fill="#336699"');
    expect(html.split(block.replace(/&/g, '&amp;')).length - 1).toBe(2);   // the team picture and the map
    expect(neutralImage('red')).toContain(encodeURIComponent('#0b2e59'));  // a colour that is not #rrggbb: FlyttGo's
  });
  it('a key the map does not have is a plain block in library mode, the asset in assets mode', () => {
    const page = '<img src="{{ASSET:hero}}" alt="x"><img src="{{ASSET:gallery.4}}" alt="y">';
    const lib = renderTemplatePage(page, ctx({ images: { mode: 'library', byKey: {} } }));
    expect(lib).not.toContain('containers-1.jpg');
    const assets = renderTemplatePage(page, ctx({ images: { mode: 'assets', byKey: {} } }));
    expect(assets).toContain('containers-1.jpg');
    expect(assets).toContain(neutralImage('#336699'));                 // gallery.4: no asset either
  });
  it('an address on another host is never shown', () => {
    const out = renderTemplatePage(PAGE, ctx({ images: { mode: 'library', byKey: { hero: { url: 'https://elsewhere.example/a.jpg', source: 'library', alt: 'x' } } } }));
    expect(out).not.toContain('elsewhere.example');
  });
  it('without a resolved map the page renders exactly as before (the template\'s assets)', () => {
    const out = renderTemplatePage(PAGE, ctx());
    expect(out).toContain(`src="${CONTAINERS}" alt="Containers on a quay"`);
    expect(out).toContain('src="" alt="Our stylist"');                   // no asset: empty, as before
    expect(out).not.toContain('data:image/svg+xml');
    expect(renderTemplatePage(PAGE, ctx({ images: null }))).toBe(out);
  });
});

describe('the harvested catalogue', () => {
  const entry = { sha256: 'c'.repeat(64), file: 'salon/1.jpg', width: 1920, height: 1080, category: 'appointments', origin: 'unsplash',
                  licence: 'Unsplash Licence', licence_evidence: 'https://unsplash.com/license', tags: ['salon'], sources: ['https://unsplash.com/photos/x'] };
  it('reads {"version": 1, "images": [...]} or a bare list', () => {
    expect(readCatalogue({ version: 1, images: [entry] }).images).toHaveLength(1);
    expect(readCatalogue([entry]).images[0].category).toBe('appointments');
  });
  it('lists every problem: no licence, a bad hash, a repeated image, an unknown category, a path outside the folder', () => {
    expect(() => readCatalogue({ version: 1, images: [
      { ...entry, licence: '' }, { ...entry, sha256: 'XYZ' }, entry, entry, { ...entry, sha256: 'd'.repeat(64), category: 'health' },
      { ...entry, sha256: 'e'.repeat(64), file: '../x.jpg' }, { ...entry, sha256: 'f'.repeat(64), shape: 'round' },
    ] })).toThrowError(/licence is required[\s\S]*sha256 must be[\s\S]*images\[3\]: the same image as images\[0\][\s\S]*category must be[\s\S]*inside --library-dir[\s\S]*shape must be/);
    expect(() => readCatalogue({ version: 2, images: [] })).toThrow(/version/);
    expect(() => readCatalogue({})).toThrow(/expected/);
  });
  it('stores an image under its category and hash', () => {
    expect(libraryPath('appointments', 'a'.repeat(64), 'image/webp')).toBe(`appointments/${'a'.repeat(64)}.webp`);
  });
});

describe('the library importer (dry run)', () => {
  const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const png = (w: number, h: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 2, 0, 0, 0]);

  it('checks each file by its bytes, hash and size, and plans it as pending under its category and hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'library-'));
    await mkdir(join(dir, 'a'));
    const good = png(1920, 1080), small = png(800, 1200);
    await writeFile(join(dir, 'a', 'good.png'), good);
    await writeFile(join(dir, 'a', 'small.png'), small);
    await writeFile(join(dir, 'a', 'fake.png'), new TextEncoder().encode('<svg></svg>'));
    const sha = await sha256Hex(good);
    const base = { category: 'appointments', origin: 'unsplash', licence: 'Unsplash Licence' };
    const planned = await plan([
      { ...base, sha256: sha, file: 'a/good.png', width: 1920, height: 1080, tags: ['salon'], alt: 'A salon' },
      { ...base, sha256: 'b'.repeat(64), file: 'a/small.png', width: 800, height: 1200 },
      { ...base, sha256: await sha256Hex(small), file: 'a/small.png', width: 801, height: 1200 },
      { ...base, sha256: 'c'.repeat(64), file: 'a/fake.png', width: 1, height: 1 },
      { ...base, sha256: 'd'.repeat(64), file: 'a/missing.png', width: 1, height: 1 },
    ], dir);
    expect(planned.map(p => p.ok)).toEqual([true, false, false, false, false]);
    expect(planned[0]).toMatchObject({ shape: 'hero', mime: 'image/png', path: `appointments/${sha}.png` });
    expect(planned[1].problems.join()).toMatch(/SHA-256/);
    expect(planned[2].problems.join()).toMatch(/800 × 1200 px, not 801/);
    expect(planned[3].problems.join()).toMatch(/not a PNG, JPEG or WebP/);
    expect(planned[4].problems.join()).toMatch(/no file/);
    expect(addPayload(planned[0])).toMatchObject({ path: `appointments/${sha}.png`, sha256: sha, mime: 'image/png', category: 'appointments',
      shape: 'hero', tags: ['salon'], alt: 'A salon', origin: 'unsplash', licence: 'Unsplash Licence', licence_evidence: null });
  });
});
