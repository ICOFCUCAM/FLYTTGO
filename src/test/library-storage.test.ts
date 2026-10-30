import { describe, expect, it } from 'vitest';
import { readCatalogue, type CatalogueEntry } from '../../supabase/functions/_shared/image-library.ts';
import {
  DEFAULT_NEEDS, MAX_PER_CATEGORY, retireSql, categoryNeeds, groupOf, licenceTier, onePerGroup, selectCategory, selectionReport, shapeQuotas,
  slotShape, tagsOf, targetSize, webEntry, type Candidate, type ShapeNeeds,
} from '../../scripts/prepare-library-images.ts';
import {
  describePlan, isThumbnailFile, planDedupe, retiredFiles, sharedExt, type ImageRow, type StoredObject, type TemplateRow,
} from '../../scripts/dedupe-template-assets.ts';

const SHA = (c: string) => c.repeat(64);

/* ── Shrinking ─────────────────────────────────────────────────────────── */

describe('web size (prepare-library-images)', () => {
  it('brings the long side to 2000 px keeping the shape, and never enlarges', () => {
    expect(targetSize(4000, 2500)).toEqual({ width: 2000, height: 1250 });
    expect(targetSize(2400, 3600)).toEqual({ width: 1333, height: 2000 });
    expect(targetSize(1600, 900)).toEqual({ width: 1600, height: 900 });
    expect(targetSize(2000, 2000)).toEqual({ width: 2000, height: 2000 });
    expect(targetSize(3000, 1000, 1500)).toEqual({ width: 1500, height: 500 });
  });

  it('keeps everything known about the original, with the new bytes\' facts and the original recorded', () => {
    const e: CatalogueEntry = {
      sha256: SHA('a'), file: 'a.jpg', width: 4000, height: 2500, category: 'transport', shape: 'hero', tags: ['van'], alt: 'A van',
      origin: 'pexels — A. Person', licence: 'Pexels License', licence_evidence: 'https://www.pexels.com/photo/van-1234/ ; https://www.pexels.com/license/',
      sources: [{ url: 'https://images.pexels.com/photos/1234/x.jpeg' }], focal_x: 0.4, focal_y: 0.6,
    };
    const w = webEntry(e, { file: 'transport/bbbb.webp', sha256: SHA('b'), width: 2000, height: 1250, bytes: 300_000 }, { bytes: 4_000_000 });
    expect(w).toMatchObject({ sha256: SHA('b'), file: 'transport/bbbb.webp', width: 2000, height: 1250, shape: 'hero', category: 'transport',
      tags: ['van'], alt: 'A van', origin: e.origin, licence: e.licence, licence_evidence: e.licence_evidence, focal_x: 0.4, focal_y: 0.6 });
    expect(w.sources).toEqual([...e.sources!, { resized_from: { sha256: SHA('a'), width: 4000, height: 2500, bytes: 4_000_000 } }]);
    expect(() => readCatalogue({ version: 1, images: [w] })).not.toThrow();        // the loader takes it
  });
});

/* ── What the templates need ───────────────────────────────────────────── */

describe('slot shapes, as the database reads them (00023)', () => {
  it('reads the recorded slot, else the key', () => {
    expect(slotShape('hero.1', 'hero')).toBe('hero');
    expect(slotShape('bg', null)).toBe('hero');
    expect(slotShape('team.2', null)).toBe('portrait');
    expect(slotShape('products.1', null)).toBe('square');
    expect(slotShape('map', null)).toBe('map');
    expect(slotShape('services-grid.3', 'services')).toBe('wide');
    expect(slotShape('coverage.1', 'other')).toBe('wide');              // 'other' falls to the key: coverage is about
    expect(slotShape('misc', 'other', 800, 1200)).toBe('portrait');     // else the image it had
    expect(slotShape('misc', null)).toBe('wide');
  });

  it('counts per category the slots of each shape and the most one template has (maps and thumbnails are no photo slots)', () => {
    const page = (keys: string[]) => ({ html: keys.map(k => `<img src="{{ASSET:${k}}}">`).join('') });
    const n = categoryNeeds([
      { id: 'a', industry: ['moving'], status: 'approved', pages: [page(['hero', 'services.1', 'misc', 'map', 'thumbnail']), page(['hero', 'team.1'])] },
      { id: 'b', industry: ['moving'], status: 'imported', pages: [page(['hero', 'services.1'])] },
      { id: 'c', industry: ['moving'], status: 'retired', pages: [page(['hero'])] },
      { id: 'd', industry: ['dentist'], status: 'approved', pages: [page(['hero'])] },
    ], [{ template_id: 'a', asset_key: 'misc', slot: 'other', width: 800, height: 800 }]);
    expect(Object.keys(n)).toEqual(['transport']);
    expect(n.transport).toEqual({ templates: 2, slots: { hero: 2, wide: 2, square: 1, portrait: 1 },
                                  mostInATemplate: { hero: 1, wide: 1, square: 1, portrait: 1 } });
  });
});

/* ── Picking ───────────────────────────────────────────────────────────── */

let n = 0;
function cand(p: Partial<Candidate> & { shape: Candidate['shape'] }): Candidate {
  n++;
  const sha = (p.sha256 ?? n.toString(16).padStart(64, '0'));
  return { sha256: sha, file: `${sha}.jpg`, category: 'transport', width: 2400, height: 1500, bytes: 1_000_000, format: 'jpg', tier: 1,
           group: `sha:${sha}`, tags: [], author: null, entry: {} as CatalogueEntry, ...p };
}
const NEEDS = (slots: Partial<ShapeNeeds['slots']>, most: Partial<ShapeNeeds['slots']> = {}): ShapeNeeds => ({
  templates: 3, slots: { hero: 0, wide: 0, square: 0, portrait: 0, ...slots }, mostInATemplate: { hero: 0, wide: 0, square: 0, portrait: 0, ...most } });

describe('the selection', () => {
  it('ranks licences: documented (Pexels or Unsplash with evidence), then the owner\'s own or AI, then unknown', () => {
    expect(licenceTier({ licence: 'Pexels License', licence_evidence: 'https://www.pexels.com/license/', origin: 'pexels' })).toBe(1);
    expect(licenceTier({ licence: 'Unsplash License', licence_evidence: 'https://unsplash.com/license', origin: 'unsplash' })).toBe(1);
    expect(licenceTier({ licence: 'Pexels License', origin: 'pexels' })).toBe(3);
    expect(licenceTier({ licence: 'unknown — owner to confirm', origin: 'owner repo ICOFCUCAM/fako-journeys (origin unknown)' })).toBe(2);
    expect(licenceTier({ licence: 'unknown — owner to confirm', origin: 'unknown' }, 'AI-generated (embedded C2PA content credentials: OpenAI)')).toBe(2);
    expect(licenceTier({ licence: 'unknown — owner to confirm', origin: 'stock (file name: unsplash)' })).toBe(3);
  });

  it('groups near-duplicates: the harvest\'s group, else the same Pexels or Unsplash photo', () => {
    expect(groupOf({ sha256: SHA('a') }, 120)).toBe('group:120');
    expect(groupOf({ sha256: SHA('a'), licence_evidence: 'https://www.pexels.com/photo/family-of-elephants-35447814/ ; https://www.pexels.com/license/' })).toBe('pexels:35447814');
    expect(groupOf({ sha256: SHA('a'), sources: [{ url: 'https://images.pexels.com/photos/35447814/pexels-photo-35447814.jpeg?w=400' }] })).toBe('pexels:35447814');
    expect(groupOf({ sha256: SHA('a'), sources: ['https://images.unsplash.com/photo-1576678927484-cc907957088c?w=400'] })).toBe('unsplash:1576678927484-cc907957088c');
    expect(groupOf({ sha256: SHA('a') })).toBe(`sha:${SHA('a')}`);
  });

  it('keeps one per group: a JPEG, PNG or WebP before an AVIF, then the licence, then the larger original', () => {
    const avif = cand({ shape: 'wide', group: 'g', format: 'avif', width: 4000 });
    const small = cand({ shape: 'wide', group: 'g', width: 1200, height: 800 });
    const big = cand({ shape: 'wide', group: 'g', width: 2400 });
    const { kept, dropped } = onePerGroup([avif, small, big]);
    expect(kept).toEqual([big]);
    expect(dropped.map(d => d.reason)).toEqual(['a near-duplicate of a chosen image', 'an AVIF whose group has a JPEG, PNG or WebP version']);
    expect(onePerGroup([avif]).kept).toEqual([avif]);                    // an AVIF alone is kept (and converted)
  });

  it('shares the target out by the templates\' slots, at least what one template needs, and passes a short shape\'s share on', () => {
    const avail = { hero: 50, wide: 50, square: 50, portrait: 50 };
    expect(shapeQuotas(40, NEEDS({ hero: 10, wide: 30 }), avail)).toEqual({ hero: 10, wide: 30, square: 0, portrait: 0 });
    expect(shapeQuotas(40, NEEDS({ hero: 2, wide: 90, portrait: 8 }, { hero: 2, portrait: 6 }), avail)).toEqual({ hero: 2, wide: 32, square: 0, portrait: 6 });
    // Only 3 portraits: the rest goes to the others by weight.
    expect(shapeQuotas(40, NEEDS({ hero: 10, wide: 10, portrait: 20 }), { ...avail, portrait: 3 })).toEqual({ hero: 19, wide: 18, square: 0, portrait: 3 });
    // Wide slots only, few wide photos: heroes (which fill wide slots) take the rest; squares are not asked for.
    expect(shapeQuotas(40, NEEDS({ wide: 10 }), { hero: 30, wide: 5, square: 9, portrait: 0 })).toEqual({ hero: 30, wide: 5, square: 0, portrait: 0 });
    // Fewer than the target: everything that fits.
    expect(shapeQuotas(40, NEEDS({ hero: 1, wide: 1 }), { hero: 2, wide: 3, square: 0, portrait: 0 })).toEqual({ hero: 2, wide: 3, square: 0, portrait: 0 });
    // No needs read: the defaults.
    const d = shapeQuotas(40, null, avail);
    expect(d.hero + d.wide + d.square + d.portrait).toBe(40);
    expect(d.wide).toBeGreaterThan(d.hero);
    expect(DEFAULT_NEEDS.wide).toBeGreaterThan(DEFAULT_NEEDS.square);
  });

  it('picks the documented licences and larger originals first, varies the subjects, and says why the rest is left', () => {
    const owner = cand({ shape: 'wide', tier: 2, tags: ['road'] });
    const docSmall = cand({ shape: 'wide', tier: 1, width: 1200, height: 800, tags: ['road'] });
    const docBig = cand({ shape: 'wide', tier: 1, tags: ['van', 'road'] });
    const docSameTags = cand({ shape: 'wide', tier: 1, width: 2300, tags: ['van', 'road'] });
    const docOther = cand({ shape: 'wide', tier: 1, width: 2200, tags: ['boxes'] });
    const unknown = cand({ shape: 'wide', tier: 3 });
    const r = selectCategory([owner, docSmall, docBig, docSameTags, docOther, unknown], 3, NEEDS({ wide: 10 }));
    expect(r.chosen).toEqual([docBig, docOther, docSameTags]);         // the smaller same-subject one waits for a different subject
    expect(r.skipped.map(s => s.reason)).toEqual(Array(3).fill('beyond the 3 wide image(s) for this category'));
    expect(selectCategory([owner, unknown], 3, NEEDS({ wide: 10 })).chosen).toEqual([owner, unknown]);
  });

  it('never more than 60 per category, and nothing in a shape the templates do not have', () => {
    const many = Array.from({ length: 80 }, () => cand({ shape: 'wide' }));
    expect(selectCategory(many, 100, NEEDS({ wide: 5 })).chosen).toHaveLength(MAX_PER_CATEGORY);
    const r = selectCategory([cand({ shape: 'square' })], 40, NEEDS({ wide: 5 }));
    expect(r.chosen).toEqual([]);
    expect(r.skipped[0].reason).toBe("the category's templates have no square slot");
  });

  it('retires the library\'s pending originals with their reason, recorded in their history, in one transaction', () => {
    const sql = retireSql([{ id: 'abc', review_status: 'pending', reason: "not in the web-size selection (owner's decision)" }]);
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain("review_reason = 'not in the web-size selection (owner''s decision)'");
    expect(sql).toContain("'to', 'retired'");
    expect(sql).toContain("WHERE id = 'abc' AND review_status = 'pending';");
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('reads tags in lower case with their words', () => {
    expect(tagsOf({ tags: ['Moving Van', 'boxes'] } as CatalogueEntry)).toEqual(['moving van', 'moving', 'boxes']);
  });

  it('reports counts per category and shape, sizes and reasons', () => {
    const c = cand({ shape: 'hero', category: 'transport' });
    const md = selectionReport({
      categories: [{ id: 'transport', needs: NEEDS({ hero: 3 }), available: { hero: 1, wide: 0, square: 0, portrait: 0 },
                     quotas: { hero: 1, wide: 0, square: 0, portrait: 0 }, chosen: [{ ...c, outBytes: 300 * 1024 }],
                     skipped: [{ c: cand({ shape: 'wide' }), reason: 'a near-duplicate of a chosen image' }] }],
      refused: [{ file: 'x.jpg', category: 'transport', reason: 'smaller than 800 px on its long side' }],
      needsSource: 'test', total: { files: 1, bytes: 300 * 1024, originalBytes: 1_000_000 }, shrunk: true, generated: 'now',
    });
    expect(md).toContain('| Moving and transport (transport) | 3 | 1 / 1 · 3 | 0 / 0 · 0 | 0 / 0 · 0 | 0 / 0 · 0 | 1 | 0.3 MB | 1 / 0 / 0 |');
    expect(md).toContain('| a near-duplicate of a chosen image | 1 |');
    expect(md).toContain('| smaller than 800 px on its long side | 1 |');
    expect(md).toContain('Local only: nothing was uploaded.');
  });
});

/* ── Duplicate template files ──────────────────────────────────────────── */

const URL_ = 'https://flyttgo.supabase.co';
const PUB = `${URL_}/storage/v1/object/public/site-template-assets/`;
const tpl = (id: string, extra: TemplateRow['assets'] = []): TemplateRow => ({ id, assets: [
  { key: 'hero', url: `${PUB}${id}/hero.jpg` }, { key: 'services.1', url: `${PUB}${id}/services.1.jpg` },
  { key: 'thumbnail', url: `${PUB}${id}/thumbnail.jpg` }, ...extra] });
const img = (id: string, key: string, sha: string | null, history: ImageRow['history'] = []): ImageRow =>
  ({ template_id: id, asset_key: key, url: `${PUB}${id}/${key}.jpg`, sha256: sha, history });
const obj = (path: string, size = 250_000, mimetype = 'image/jpeg'): StoredObject => ({ path, size, mimetype });

describe('removing duplicate template files (dedupe-template-assets)', () => {
  const templates = [tpl('a'), tpl('b'), tpl('c')];
  const images = ['a', 'b', 'c'].flatMap(t => [img(t, 'hero', SHA('1')), img(t, 'services.1', SHA('2'))]);
  const objects = ['a', 'b', 'c'].flatMap(t => [obj(`${t}/hero.jpg`), obj(`${t}/services.1.jpg`), obj(`${t}/thumbnail.jpg`, 40_000)]);

  it('keeps one shared copy per picture, moves every slot to it and removes the earlier copies; thumbnails stay', () => {
    const p = planDedupe({ supabaseUrl: URL_, templates, images, objects });
    expect(p.shared.map(s => [s.path, s.slots, s.templates, s.exists, s.source])).toEqual([
      [`shared/${SHA('1')}.jpg`, 3, 3, false, 'a/hero.jpg'], [`shared/${SHA('2')}.jpg`, 3, 3, false, 'a/services.1.jpg']]);
    expect(p.moves).toHaveLength(6);
    expect(p.moves[0]).toEqual({ template: 'a', key: 'hero', from: `${PUB}a/hero.jpg`, to: `${PUB}shared/${SHA('1')}.jpg`, sha256: SHA('1') });
    expect(p.moves.some(m => m.key === 'thumbnail')).toBe(false);
    expect(p.remove.map(r => r.path)).toEqual(['a/hero.jpg', 'a/services.1.jpg', 'b/hero.jpg', 'b/services.1.jpg', 'c/hero.jpg', 'c/services.1.jpg']);
    expect(p.totals).toMatchObject({ bucketFiles: 9, thumbnails: 3, removeFiles: 6, removeBytes: 1_500_000, newFiles: 2, newBytes: 500_000, savedBytes: 1_000_000 });
    expect(describePlan(p)[0]).toContain('9 files');
  });

  it('is safe to run again: a moved template plans nothing, and its recorded earlier copies are still removed', () => {
    const shared = (t: string): TemplateRow => ({ id: t, assets: [
      { key: 'hero', url: `${PUB}shared/${SHA('1')}.jpg` }, { key: 'services.1', url: `${PUB}shared/${SHA('2')}.jpg` },
      { key: 'thumbnail', url: `${PUB}${t}/thumbnail.jpg` }] });
    const movedImages = images.map(i => ({ ...i, url: `${PUB}shared/${SHA(i.asset_key === 'hero' ? '1' : '2')}.jpg` }));
    const stored = [...objects, obj(`shared/${SHA('1')}.jpg`), obj(`shared/${SHA('2')}.jpg`)];
    const moved = images.map(i => ({ template_id: i.template_id, asset_key: i.asset_key, from_url: i.url,
                                     to_url: `${PUB}shared/${SHA(i.asset_key === 'hero' ? '1' : '2')}.jpg`, sha256: i.sha256! }));
    const p = planDedupe({ supabaseUrl: URL_, templates: ['a', 'b', 'c'].map(shared), images: movedImages, objects: stored, moved });
    expect(p.moves).toEqual([]);
    expect(p.shared.every(s => s.exists)).toBe(true);
    expect(p.remove).toHaveLength(6);
    expect(p.totals.newFiles).toBe(0);
    // Without the record, nothing it cannot prove is a copy is removed.
    expect(planDedupe({ supabaseUrl: URL_, templates: ['a', 'b', 'c'].map(shared), images: movedImages, objects: stored }).remove).toEqual([]);
  });

  it('keeps a file still used (an asset, a slot or a slot\'s history) and leaves what it cannot place, with the reason', () => {
    const t = [tpl('a', [{ key: 'about', url: `${PUB}a/about.jpg` }, { key: 'ext', url: 'https://elsewhere.example/x.jpg' }]), tpl('b')];
    const i = [img('a', 'hero', SHA('1')), img('a', 'services.1', SHA('2')), img('b', 'hero', SHA('1'), [{ url: `${PUB}b/old-hero.jpg` }]),
               { ...img('b', 'services.1', SHA('2')), url: `${PUB}b/other.jpg` }];
    const o = [...['a', 'b'].flatMap(x => [obj(`${x}/hero.jpg`), obj(`${x}/services.1.jpg`)]), obj('a/about.jpg'), obj('b/old-hero.jpg')];
    const p = planDedupe({ supabaseUrl: URL_, templates: t, images: i, objects: o });
    expect(p.left.map(l => `${l.template}/${l.key}: ${l.reason}`)).toEqual([
      'a/about: no SHA-256 recorded (run with --hash-unknown)', 'a/ext: not in the template bucket', 'b/services.1: its recorded image has another address']);
    expect(p.remove.map(r => r.path)).toEqual(['a/hero.jpg', 'a/services.1.jpg', 'b/hero.jpg']);
    // With the file hashed it moves too.
    const h = planDedupe({ supabaseUrl: URL_, templates: t, images: i, objects: o, hashes: new Map([['a/about.jpg', SHA('1')]]) });
    expect(h.moves.find(m => m.key === 'about')?.to).toBe(`${PUB}shared/${SHA('1')}.jpg`);
  });

  it('names a shared copy by its stored type; thumbnails are recognised by name', () => {
    expect(sharedExt('a/x.jpeg')).toBe('jpg');
    expect(sharedExt('a/x.bin', 'image/png')).toBe('png');
    expect(sharedExt('a/x.gif')).toBeNull();
    expect(isThumbnailFile('a/thumbnail.jpg') && isThumbnailFile('a/thumbnail-0123456789ab.jpg')).toBe(true);
    expect(isThumbnailFile('a/thumbnail-notes.jpg') || isThumbnailFile('shared/thumbnail.jpg/x')).toBe(false);
  });

  it('lists the stored files of retired library images only (their records stay)', () => {
    const rows = [{ storage_path: 'community/a.jpg', review_status: 'retired' }, { storage_path: 'community/b.jpg', review_status: 'pending' },
                  { storage_path: 'community/c.jpg', review_status: 'retired' }];
    expect(retiredFiles(rows, [obj('community/a.jpg'), obj('community/b.jpg')]).map(f => f.path)).toEqual(['community/a.jpg']);
  });
});
