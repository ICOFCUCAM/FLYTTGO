import { describe, expect, it } from 'vitest';
import {
  imageInfo, intendedUses, planManifest, readManifest, sha256Hex, sharedImageSets, slotOf, templateImages, type TemplateImage,
} from '../../supabase/functions/_shared/template-images.ts';

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap(p => typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

describe('checking an image by its bytes', () => {
  it('reads PNG, JPEG and WebP and their size', () => {
    expect(imageInfo(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(1600), be32(900), [8, 2, 0, 0, 0])))
      .toEqual({ mime: 'image/png', width: 1600, height: 900 });
    const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF', [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
      [0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x84, 0x06, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    expect(imageInfo(jpeg)).toEqual({ mime: 'image/jpeg', width: 1600, height: 900 });
    const vp8x = bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [0, 0, 0, 0], le24(1599), le24(899));
    expect(imageInfo(vp8x)).toEqual({ mime: 'image/webp', width: 1600, height: 900 });
    const w = 1599, h = 899, bits = w | (h << 14);
    const vp8l = bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8L', [5, 0, 0, 0], [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255], [0, 0, 0, 0, 0]);
    expect(imageInfo(vp8l)).toEqual({ mime: 'image/webp', width: 1600, height: 900 });
  });
  it('refuses anything else, whatever it is called', () => {
    for (const b of [bytes('GIF89a', [0, 0, 0, 0, 0, 0]), bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), bytes('%PDF-1.7'), new Uint8Array()]) {
      expect(imageInfo(b)).toBeNull();
    }
  });
  it('hashes with SHA-256', async () => {
    expect(await sha256Hex(bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('image slots', () => {
  const pages = [{ path: '/', html: '<img src="{{ASSET:hero}}" alt="A stylist at work &amp; smiling"><img src="{{ASSET:services.2}}" alt="Stylist portrait">'
    + '<img src="{{ASSET:coverage.1}}" alt="Map to the salon in the Rosewood district"><div style="background:url({{ASSET:bg}})"></div>' }];
  const assets = ['hero', 'services.2', 'coverage.1', 'coverage.2', 'bg', 'gallery-3', 'thumbnail'].map(k => ({ key: k, url: `https://a.test/${k}.jpg` }));

  it('name each image by what the page says it shows, else by its key', () => {
    expect(slotOf('hero.1')).toBe('hero');
    expect(slotOf('services-grid.3')).toBe('services');
    expect(slotOf('services.2', 'Stylist portrait')).toBe('team');
    expect(slotOf('coverage.1', 'Map to the salon')).toBe('map');
    expect(slotOf('coverage.2')).toBe('about');
    expect(slotOf('gallery-3')).toBe('gallery');
    expect(slotOf('zzz')).toBe('other');
  });
  it('take what an image is meant to show from the page', () => {
    const u = intendedUses(pages);
    expect(u.get('hero')).toBe('A stylist at work & smiling');
    expect(u.get('bg')).toBe('background');
  });
  it('record every image but the thumbnail, as imported, licence unknown', () => {
    const im = templateImages({ id: 'salon-verve01', pages, assets }, 'appointments', new Map([['https://a.test/hero.jpg', { width: 1600, height: 900 }]]));
    expect(im.map(i => `${i.asset_key}:${i.slot}`)).toEqual(['hero:hero', 'services.2:team', 'coverage.1:map', 'coverage.2:about', 'bg:background', 'gallery-3:gallery']);
    expect(im[0]).toMatchObject({ source: 'architect-ai', licence: null, review_status: 'unreviewed', width: 1600, height: 900, category: 'appointments' });
  });
  it('find templates that share the very same images', () => {
    const img = (t: string, k: string, url: string, sha: string | null = null) => ({ template_id: t, asset_key: k, url, sha256: sha }) as TemplateImage;
    const groups = sharedImageSets([
      img('a', 'hero', 'https://x/1.jpg'), img('a', 'svc', 'https://x/2.jpg'),
      img('b', 'hero', 'https://x/1.jpg'), img('b', 'svc', 'https://x/2.jpg'),
      img('c', 'hero', 'https://y/1.jpg', 'h1'), img('d', 'hero', 'https://z/9.jpg', 'h1'),
      img('e', 'hero', 'https://x/1.jpg'),
    ]);
    expect(groups).toEqual([{ templates: ['a', 'b'], images: 2 }, { templates: ['c', 'd'], images: 1 }]);
  });
});

describe('the image manifest', () => {
  it('lists every problem at once', () => {
    expect(() => readManifest({ version: 1, images: [
      { template: 'x', key: 'hero', category: 'transport', slot: 'hero', file: 'a.jpg', source: 'own' },
      { category: 'transport', slot: 'roof', file: '../a.jpg', source: 'stock' },
      { template: 'x', key: 'hero', file: 'a.jpg', source: 'licensed' },
      { template: 'x', key: 'hero', file: 'a.jpg', source: 'ai-generated', generation: {} },
    ] })).toThrow(/images\[0\]: give either[\s\S]*unknown slot roof[\s\S]*inside the manifest's folder[\s\S]*source must be[\s\S]*needs its licence[\s\S]*generation\.model/);
    expect(() => readManifest({ images: [] })).toThrow(/version/);
  });
  it('gives a template\'s own entry first, and shares a category\'s images out in turn', () => {
    const m = readManifest({ version: 1, images: [
      { template: 't1', key: 'hero', file: 'own-hero.jpg', source: 'own' },
      { category: 'transport', slot: 'hero', file: 'h1.jpg', source: 'licensed', licence: 'L1' },
      { category: 'transport', slot: 'hero', file: 'h2.jpg', source: 'ai-generated', generation: { model: 'm' } },
    ] });
    const im = (t: string, k: string, slot: TemplateImage['slot'], category = 'transport') => ({ template_id: t, asset_key: k, slot, category }) as TemplateImage;
    const plan = planManifest(m, [im('t1', 'hero', 'hero'), im('t2', 'hero', 'hero'), im('t3', 'hero', 'hero'), im('t4', 'hero', 'hero'),
                                  im('t2', 'services.1', 'services'), im('t5', 'hero', 'hero', 'trades')]);
    expect(plan.get('t1')?.get('hero')?.file).toBe('own-hero.jpg');
    expect(['t2', 't3', 't4'].map(t => plan.get(t)?.get('hero')?.file)).toEqual(['h1.jpg', 'h2.jpg', 'h1.jpg']);
    expect(plan.get('t2')?.has('services.1')).toBe(false);
    expect(plan.has('t5')).toBe(false);
  });
});
