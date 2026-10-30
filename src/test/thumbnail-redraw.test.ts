import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  assetsImageMap, thumbnailImagesHash, thumbnailImagesKey, thumbnailPath, type ImageMap,
} from '../../supabase/functions/_shared/image-library.ts';
import { sha256Hex } from '../../supabase/functions/_shared/template-images.ts';
import { bucketPath, oldThumbnails, parseArgs, selectTemplates, thumbnailPage, unknownIds, type ThumbnailRow } from '../../scripts/redraw-thumbnails.ts';

/* The same map and text as supabase/tests/thumbnail_redraw.test.sql ("the
 * picture key"): the script records what the database compares. */
const MAP = { images: {
  'services.1': { source: 'library' as const, bucket: 'site-image-library', path: 'appointments/abc.jpg', focal_x: 0.4, focal_y: 0.25, alt: 'A' },
  hero: { source: 'assets' as const, url: 'https://a.test/hero.jpg' },
  Team: { source: 'fallback' as const, shape: 'portrait' as const },
} };

describe('what a thumbnail was drawn with (00024)', () => {
  it('writes the picture key as the database does: slots in byte order, address or stored file, focal point, no alt text', () => {
    expect(thumbnailImagesKey(MAP)).toBe('Team=-||\nhero=https://a.test/hero.jpg||\nservices.1=site-image-library/appointments/abc.jpg|400|250');
  });
  it('and the same text as site_template_images_key() in the migration describes', async () => {
    const sql = await readFile(new URL('../../supabase/migrations/00024_thumbnail_redraw.sql', import.meta.url), 'utf8');
    expect(sql).toContain("e.key || '=' ||");
    expect(sql).toContain("ORDER BY e.key COLLATE \"C\"");
    expect(sql).toContain('round((e.value ->> \'focal_x\')::numeric * 1000)');
  });
  it('hashes it with SHA-256; a new description changes nothing, a new picture or focal point does', async () => {
    const h = await thumbnailImagesHash(MAP);
    expect(h).toBe(await sha256Hex(new TextEncoder().encode(thumbnailImagesKey(MAP))));
    expect(await thumbnailImagesHash({ images: { ...MAP.images, hero: { ...MAP.images.hero, alt: 'Other', source: 'template' } } } as never)).toBe(h);
    expect(await thumbnailImagesHash({ images: { ...MAP.images, hero: { url: 'https://a.test/h2.jpg' } } })).not.toBe(h);
    expect(await thumbnailImagesHash({ images: { ...MAP.images, 'services.1': { ...MAP.images['services.1'], focal_x: 0.3 } } })).not.toBe(h);
    expect(await thumbnailImagesHash({ images: { hero: { url: 'https://a.test/hero.jpg' } } }))
      .toBe(await sha256Hex(new TextEncoder().encode('hero=https://a.test/hero.jpg||')));        // as the SQL test
  });
  it('the importer records the map its own assets give (as site_template_assets_map() does)', () => {
    const pages = [{ html: '<img src="{{ASSET:hero}}"><img src="{{ASSET:services.2}}"><img src="{{ASSET:thumbnail}}">' },
                   { html: '<img src="{{ASSET:team.1}}"><img src="{{ASSET:hero}}">' }];
    const assets = [{ key: 'hero', url: 'https://a.test/h.jpg' }, { key: 'services', url: 'https://a.test/s.jpg' }, { key: 'thumbnail', url: 'https://a.test/t.jpg' }];
    expect(assetsImageMap(pages, assets)).toEqual({ images: {
      hero: { url: 'https://a.test/h.jpg' }, 'services.2': { url: 'https://a.test/s.jpg' }, 'team.1': {} } });
    expect(thumbnailImagesKey(assetsImageMap(pages, assets))).toBe('hero=https://a.test/h.jpg||\nservices.2=https://a.test/s.jpg||\nteam.1=-||');
  });
  it('stores a redrawn thumbnail under a new name for new images (no browser shows the old one)', () => {
    expect(thumbnailPath('salon-verve01', 'abcdef0123456789'.repeat(4))).toBe('salon-verve01/thumbnail-abcdef012345.jpg');
  });
});

describe('the redraw script (scripts/redraw-thumbnails.ts)', () => {
  const row = (id: string, state: ThumbnailRow['state'], category = 'appointments'): ThumbnailRow => ({
    template_id: id, name: id, category, status: 'approved', mode: 'library', thumbnail_url: null, drawn_with: null, images: 'x', state });
  const rows = [row('a', 'stale'), row('b', 'fresh'), row('c', 'missing'), row('d', 'stale', 'transport')];
  const none = { ids: null, category: null, all: false, missing: false, limit: null };

  const clean = { cleanOld: false, olderThanDays: 7, delete: false };
  it('is a dry run by default, writing to a local folder, and draws the missing thumbnails too', () => {
    expect(parseArgs([])).toEqual({ ...none, missing: true, out: 'thumbnail-redraw', upload: false, ...clean });
    expect(parseArgs(['--ids', 'a, b', '--category', 'appointments', '--all', '--stale-only', '--limit', '3', '--out', 'x', '--upload']))
      .toEqual({ ids: ['a', 'b'], category: 'appointments', all: true, missing: false, limit: 3, out: 'x', upload: true, ...clean });
    expect(parseArgs(['--clean-old', '--older-than', '10', '--delete'])).toMatchObject({ cleanOld: true, olderThanDays: 10, delete: true });
    expect(parseArgs(['--clean-old', '--older-than', '0'])).toMatchObject({ olderThanDays: 7, delete: false });
  });
  it('draws the stale and the missing ones (only the stale with --stale-only), the named ones or all, in one category, the first N', () => {
    const ids = (o: Partial<typeof none>) => selectTemplates(rows, { ...none, ...o }).map(r => r.template_id);
    expect(ids({})).toEqual(['a', 'd']);
    expect(ids({ missing: true })).toEqual(['a', 'c', 'd']);
    expect(ids(parseArgs([]))).toEqual(['a', 'c', 'd']);
    expect(ids({ category: 'appointments' })).toEqual(['a']);
    expect(ids({ ids: ['b', 'c'] })).toEqual(['b', 'c']);                // whatever their state
    expect(ids({ all: true })).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({ all: true, limit: 2 })).toEqual(['a', 'b']);
    expect(unknownIds(rows, ['a', 'zz'])).toEqual(['zz']);
  });
  it('removes only a template\'s earlier thumbnail files, older than the days given, never the current one', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const files = [
      { name: 'thumbnail.jpg', created_at: '2026-10-30T01:00:00Z' },                 // imported, replaced since: old
      { name: 'thumbnail-0123456789ab.jpg', created_at: '2026-11-01T00:00:00Z' },     // earlier redraw: old
      { name: 'thumbnail-abcdefabcdef.jpg', created_at: '2026-11-08T00:00:00Z' },     // earlier redraw, 2 days: kept
      { name: 'thumbnail-fedcbafedcba.jpg', created_at: '2026-10-01T00:00:00Z' },     // current: kept
      { name: 'hero-1.jpg', created_at: '2026-10-01T00:00:00Z' },                     // not a thumbnail: kept
    ];
    expect(oldThumbnails('t1', files, 't1/thumbnail-fedcbafedcba.jpg', now, 7)).toEqual(['t1/thumbnail.jpg', 't1/thumbnail-0123456789ab.jpg']);
    expect(oldThumbnails('t1', files, null, now, 7)).toEqual([]);                   // no current thumbnail: keep all
    expect(bucketPath('https://x.supabase.co/storage/v1/object/public/site-template-assets/t1/thumbnail-fedcbafedcba.jpg?v=2'))
      .toBe('t1/thumbnail-fedcbafedcba.jpg');
    expect(bucketPath('https://x.supabase.co/storage/v1/object/public/other/t1/thumbnail.jpg')).toBeNull();
  });
  it('renders the home page as the template\'s own demo with the resolved images, never the imported photos', () => {
    const t = { name: 'Verve Hair Salon', assets: [{ key: 'hero', url: 'https://old.test/storage/v1/object/public/site-template-assets/shared/containers.jpg' }],
      pages: [{ path: '/about', html: '<p>About</p>' },
              { path: '/', html: '<h1>{{brand.name}}</h1><img src="{{ASSET:hero}}" alt="Containers"><img src="{{ASSET:team.1}}" alt="Team">' }] };
    const map: ImageMap = { template: 't', category: 'appointments', mode: 'library', images: {
      hero: { source: 'library', shape: 'hero', bucket: 'site-image-library', path: 'appointments/abc.jpg', alt: 'A stylist at work' },
      'team.1': { source: 'fallback', shape: 'portrait' } } };
    const page = thumbnailPage(t, map, 'https://flyttgo.supabase.co')!;
    expect(page.html).toContain('<h1>Verve Hair Salon</h1>');                       // its own name (demoBrand)
    expect(page.html).toContain('https://flyttgo.supabase.co/storage/v1/object/public/site-image-library/appointments/abc.jpg');
    expect(page.html).toContain('alt="A stylist at work"');
    expect(page.html).not.toContain('containers.jpg');
    expect(page.html).toContain('data:image/svg+xml');                              // team.1: the neutral block
    expect(page.hosts).toContain('flyttgo.supabase.co');                            // the browser may load the library's images
    expect(thumbnailPage({ ...t, pages: [] }, map, 'https://flyttgo.supabase.co')).toBeNull();
  });
});
