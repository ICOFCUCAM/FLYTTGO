import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/* The catalogue reads templates through src/lib/whiteLabel (Supabase); here
 * the cards are rendered from summaries only. */
vi.mock('../lib/whiteLabel', () => ({
  loadTemplate: async () => null,
  loadTemplateHome: async () => null,
  loadLibraryCategories: async () => [],
  loadRenderImages: async () => null,
  thumbnailOf: (t: { assets: { key: string; url: string }[] }) => t.assets.find(a => a.key === 'thumbnail')?.url ?? null,
}));
const { default: TemplateCatalogue } = await import('../components/whiteLabel/TemplateCatalogue');
const { default: TemplateGallery } = await import('../components/whiteLabel/TemplateGallery');
const { default: TemplatePreview } = await import('../components/whiteLabel/TemplatePreview');
const { BATCH, NO_FILTER, categoryOf, facets, filterTemplates } = await import('../components/whiteLabel/gallery');
type Filter = typeof NO_FILTER;

const base = { industry: ['hair-salon', 'beauty'], status: 'approved' as const, review_note: null, reviewed_at: null };
const templates = [
  { ...base, id: 'salon-verve01', name: 'Verve Hair Salon', style: 'chic', features: ['pricing', 'team', 'faq'], page_count: 5,
    assets: [{ key: 'hero', url: 'https://a.test/hero.jpg' }, { key: 'thumbnail', url: 'https://a.test/salon-verve01/thumbnail.jpg' }] },
  { ...base, id: 'salon-other01', name: 'Other Salon', style: 'bold', features: [], page_count: 1, assets: [{ key: 'hero', url: 'https://a.test/h.jpg' }] },
  { ...base, id: 'salon-draft01', name: 'Draft Salon', style: null, status: 'imported' as const, assets: [] },
];
const offered = templates.filter(t => t.status === 'approved');
const noop = () => {};
const gallery = (props: Partial<Parameters<typeof TemplateGallery>[0]> = {}) => renderToStaticMarkup(
  <TemplateGallery templates={offered} selected="" canEdit filter={NO_FILTER} onFilter={noop} opening={null}
    onPreview={noop} onChoose={noop} onClose={noop} {...props} />);

describe('the Website card', () => {
  const card = (selected: string, canEdit = true) => renderToStaticMarkup(
    <TemplateCatalogue templates={templates} selected={selected} onSelect={noop} canEdit={canEdit} brand={{ name: 'Acme' }} sellerNotice="n" />);

  it('shows the current choice with Preview and Change, and a button to browse every offered website', () => {
    const html = card('salon-verve01');
    expect(html).toContain('Your website');
    expect(html).toContain('Verve Hair Salon');
    expect(html).toContain('Best for hair salon and beauty');
    expect(html).toContain('<img src="https://a.test/salon-verve01/thumbnail.jpg"');
    expect(html).toContain('Preview all pages');
    expect(html).toContain('>Change<');
    expect(html).toMatch(/Browse all 2 websites/);                   // approved ones only
  });
  it('has no grid of its own: other templates are only in the gallery', () => {
    const html = card('salon-verve01');
    expect(html).not.toContain('Other Salon');
    expect(html).not.toContain('role="dialog"');                      // the gallery opens on Browse
  });
  it('shows "No template" when none is chosen', () => {
    const html = card('');
    expect(html).toContain('No template');
    expect(html).toContain('Simple branded front page');
    expect(html).not.toContain('Preview all pages');
  });
  it('shows a chosen template without a thumbnail as the live miniature (one, never in the grid)', () => {
    const html = card('salon-other01');
    expect(html).toContain('Other Salon');
    expect(html).toContain('animate-pulse');                          // TemplateThumb, loading
  });
  it('marks a chosen template that is no longer offered', () => {
    expect(card('salon-draft01')).toContain('No longer in the catalogue');
  });
  it('says so when nothing is offered yet', () => {
    const html = renderToStaticMarkup(<TemplateCatalogue templates={[templates[2]]} selected="" onSelect={noop} canEdit brand={{ name: 'Acme' }} sellerNotice="n" />);
    expect(html).toContain('No templates are offered yet');
  });
});

describe('the gallery', () => {
  const html = gallery();

  it('is a labelled full-screen dialog with search, sort, categories with counts and filters', () => {
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="gallery-title"/);
    expect(html).toContain('Choose your website');
    expect(html).toContain('2 websites');
    expect(html).toContain('type="search"');
    expect(html).toMatch(/<option value="recommended"[^>]*>Recommended<\/option><option value="name">Name A–Z<\/option>/);
    expect(html).toContain('Salons, wellness and bookings');
    expect(html).toContain('What it has');
    for (const f of ['Prices', 'Menu', 'Gallery', 'Testimonials', 'Team', 'FAQ', 'Contact']) expect(html).toContain(`>${f}<`);
    expect(html).toContain('Any style');
    expect(html).toContain('aria-label="Close the gallery"');
  });
  it('lays the cards out 1, 2, 3, 4 and 5 across as the screen widens', () => {
    expect(html).toContain('grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1600px]:grid-cols-5');
  });
  it('shows the thumbnail lazily, in one shape, zooming only without reduced motion', () => {
    expect(html).toMatch(/<img src="https:\/\/a\.test\/salon-verve01\/thumbnail\.jpg" alt="" loading="lazy"/);
    expect(html).toContain('aspect-[16/10]');
    expect(html).toContain('group-hover:scale-[1.04]');
    expect(html).toContain('motion-reduce:group-hover:scale-100');
  });
  it('shows a plain card with the name and style without a thumbnail: no photo, no live page', () => {
    const other = html.slice(html.indexOf('aria-labelledby="tpl-salon-other01"'));
    const picture = other.slice(0, other.indexOf('</article>'));
    expect(picture).toContain('data-placeholder');
    expect(picture).toContain('Other Salon');
    expect(picture).toMatch(/>bold</);
    expect(picture).not.toContain('<img');
    expect(picture).not.toContain('<iframe');
    expect(picture).not.toContain('https://a.test/h.jpg');
  });
  it('puts Preview and Choose over the picture, shown on hover, keyboard focus and touch screens', () => {
    expect(html).toContain('aria-label="Preview Verve Hair Salon"');
    expect(html).toContain('aria-label="Choose Verve Hair Salon"');
    expect(html).toContain('group-hover:opacity-100');
    expect(html).toContain('group-focus-within:opacity-100');
    expect(html).toContain('[@media(hover:none)]:opacity-100');
  });
  it('says what each template has, its style, pages and what it is best for', () => {
    expect(html).toContain('Best for hair salon and beauty');
    expect(html).toContain('chic · 5 pages · Prices, Team, FAQ');
    expect(html).toContain('bold · 1 page');
  });
  it('offers the "No template" option first and approved templates only, in the order given', () => {
    expect(html).toContain('No template');
    expect(html.indexOf('No template')).toBeLessThan(html.indexOf('Verve Hair Salon'));
    expect(html).not.toContain('Draft Salon');
    expect(html.indexOf('tpl-salon-verve01')).toBeLessThan(html.indexOf('tpl-salon-other01'));
    expect(html).toMatch(/Showing <strong>2<\/strong> of <strong>2<\/strong> websites/);
  });
  it('marks the chosen template and lets only owners and admins choose', () => {
    const chosen = gallery({ selected: 'salon-verve01' });
    expect(chosen).toContain('✓ Chosen');
    expect(chosen).not.toContain('aria-label="Choose Verve Hair Salon"');
    expect(chosen).toContain('aria-label="Choose Other Salon"');
    const viewer = gallery({ canEdit: false });
    expect(viewer).toMatch(/<button disabled=""[^>]*aria-label="Choose Other Salon"/);
    expect(viewer).toContain('Only the company');
  });
  it('shows the cards in batches with "Show more"', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...templates[1], id: `t-${String(i).padStart(2, '0')}`, name: `Template ${String(i).padStart(2, '0')}` }));
    const page = gallery({ templates: many });
    expect(BATCH).toBe(24);
    expect(page).toMatch(/Showing <strong>24<\/strong> of <strong>30<\/strong>/);
    expect(page).toContain('Template 23');
    expect(page).not.toContain('Template 24');
    expect(page).toContain('Show more (6 of 6 left)');
  });
  it('says so when nothing matches, and keeps the filters shown', () => {
    const none = gallery({ filter: { ...NO_FILTER, query: 'zzz', features: ['menu'] } });
    expect(none).toContain('No website matches');
    expect(none).toContain('Show all websites');
    expect(none).toContain('aria-label="Remove filter “zzz”"');
    expect(none).toContain('aria-label="Remove filter Menu"');
    expect(none).not.toContain('No template');                        // only unfiltered
  });
});

describe('the gallery filters', () => {
  const t = (id: string, name: string, industry: string[], style: string | null, features: string[]) => ({ id, name, industry, style, features });
  const all = [
    t('m1', 'Swiftmove', ['moving', 'movers'], 'bold', ['pricing', 'gallery', 'faq']),
    t('r1', 'Alouette', ['restaurant', 'food'], 'editorial', ['menu', 'gallery']),
    t('m2', 'Boxwell', ['moving', 'storage'], 'editorial', ['pricing']),
    t('x1', 'Oddity', ['stamps'], null, []),
  ];
  const f = (p: Partial<Filter>): Filter => ({ ...NO_FILTER, ...p });
  const ids = (p: Partial<Filter>) => filterTemplates(all, f(p)).map(x => x.id);

  it('put each template in its importer category, "other" when none fits', () => {
    expect(all.map(categoryOf)).toEqual(['transport', 'hospitality', 'transport', 'other']);
  });
  it('filter by category, every ticked feature and style', () => {
    expect(ids({ category: 'transport' })).toEqual(['m1', 'm2']);
    expect(ids({ features: ['pricing', 'gallery'] })).toEqual(['m1']);
    expect(ids({ style: 'editorial' })).toEqual(['r1', 'm2']);
    expect(ids({ category: 'transport', style: 'editorial' })).toEqual(['m2']);
  });
  it('search name, style, industry, features and category, every word', () => {
    expect(ids({ query: 'swift' })).toEqual(['m1']);
    expect(ids({ query: 'editorial' })).toEqual(['r1', 'm2']);
    expect(ids({ query: 'storage' })).toEqual(['m2']);
    expect(ids({ query: 'menu' })).toEqual(['r1']);
    expect(ids({ query: 'transport bold' })).toEqual(['m1']);
    expect(ids({ query: 'hospitality' })).toEqual(['r1']);
  });
  it('keep the catalogue order for Recommended and sort by name on request (no popularity)', () => {
    expect(ids({})).toEqual(['m1', 'r1', 'm2', 'x1']);
    expect(ids({ sort: 'name' })).toEqual(['r1', 'm2', 'x1', 'm1']);
  });
  it('count each choice with the other choices applied', () => {
    const c = facets(all, f({ category: 'transport', features: ['gallery'] }));
    expect(c.all).toBe(2);                                            // m1, r1 have a gallery
    expect(c.categories.map(x => [x.id, x.count])).toEqual([['transport', 1], ['hospitality', 1], ['other', 0]]);
    expect(c.features.find(x => x.id === 'pricing')?.count).toBe(2);   // within transport
    expect(c.features.some(x => x.id === 'services')).toBe(false);
    expect(c.styles.map(s => [s.id, s.count])).toEqual([['bold', 1], ['editorial', 0]]);
  });
  it('leave out a feature every template has, unless it is chosen', () => {
    const everyone = all.map(t => ({ ...t, features: [...new Set([...(t.features ?? []), 'contact'])] }));
    expect(facets(everyone, f({})).features.some(x => x.id === 'contact')).toBe(false);
    expect(facets(everyone, f({ features: ['contact'] })).features.some(x => x.id === 'contact')).toBe(true);
  });
});

describe('the image library in the catalogue (00023)', () => {
  it('a category with library photos shows the plain card, not the thumbnail drawn with the imported photos', () => {
    const html = gallery({ libraryCategories: ['appointments'] });
    expect(html).not.toContain('salon-verve01/thumbnail.jpg');
    expect(html).toContain('data-placeholder');
    expect(gallery({ libraryCategories: ['transport'] })).toContain('salon-verve01/thumbnail.jpg');
  });
  it('the preview shows the resolved images instead of the template\'s assets', () => {
    const t = { ...templates[0], pages: [{ path: '/', html: '<img src="{{ASSET:hero}}" alt="Containers"><img src="{{ASSET:team.1}}" alt="Team">' }], content_flags: [] };
    const html = renderToStaticMarkup(
      <TemplatePreview template={t} path="/" onPath={noop} selected="" canEdit onChoose={noop} onClose={noop} brand={{ name: 'Acme', primaryColor: '#336699' }}
        sellerNotice="n" images={{ mode: 'library', byKey: { hero: { url: 'https://lib.test/site-image-library/salon.jpg', alt: 'A salon', source: 'library' } } }} />);
    expect(html).toContain('https://lib.test/site-image-library/salon.jpg');
    expect(html).not.toContain('https://a.test/hero.jpg');
    expect(html).toContain('alt=&quot;A salon&quot;');
    expect(html).toContain('data:image/svg+xml');                     // team.1: the plain block
  });
});

describe('the preview', () => {
  const t = { ...templates[0], pages: [{ path: '/', html: '<h1>Home</h1>' }, { path: '/our-team', html: '<h1>Team</h1>' }], content_flags: [] };
  const html = renderToStaticMarkup(
    <TemplatePreview template={t} path="/our-team" onPath={noop} selected="" canEdit onChoose={noop} onClose={noop}
      brand={{ name: 'Acme' }} sellerNotice="n" step={{ at: 2, of: 10, go: noop, loading: false }} />);

  it('shows every page sandboxed at three screen sizes, with Choose', () => {
    expect(html).toMatch(/role="dialog" aria-modal="true"/);
    expect(html).toContain('sandbox=""');
    for (const d of ['Desktop', 'Tablet', 'Phone']) expect(html).toContain(`>${d}<`);
    expect(html).toContain('>Our team<');
    expect(html).toContain('Page 2 of 2');
    expect(html).toContain('Choose this website');
    expect(html).toContain('Preview: your name and colours, sample content');
  });
  it('steps through the gallery results from the gallery', () => {
    expect(html).toContain('aria-label="Previous website"');
    expect(html).toContain('aria-label="Next website"');
    expect(html).toContain('3 of 10');
  });
});
