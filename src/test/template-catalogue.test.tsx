import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/* The catalogue reads templates through src/lib/whiteLabel (Supabase); here
 * the cards are rendered from summaries only. */
vi.mock('../lib/whiteLabel', () => ({
  loadTemplate: async () => null,
  loadTemplateHome: async () => null,
  thumbnailOf: (t: { assets: { key: string; url: string }[] }) => t.assets.find(a => a.key === 'thumbnail')?.url ?? null,
}));
const { default: TemplateCatalogue } = await import('../components/whiteLabel/TemplateCatalogue');

const base = { industry: ['hair-salon', 'beauty'], status: 'approved' as const, review_note: null, reviewed_at: null };
const templates = [
  { ...base, id: 'salon-verve01', name: 'Verve Hair Salon', style: 'chic', features: ['pricing', 'team', 'faq'], page_count: 5,
    assets: [{ key: 'hero', url: 'https://a.test/hero.jpg' }, { key: 'thumbnail', url: 'https://a.test/salon-verve01/thumbnail.jpg' }] },
  { ...base, id: 'salon-other01', name: 'Other Salon', style: 'bold', features: [], page_count: 1, assets: [{ key: 'hero', url: 'https://a.test/h.jpg' }] },
  { ...base, id: 'salon-draft01', name: 'Draft Salon', style: null, status: 'imported' as const, assets: [] },
];

describe('the catalogue cards', () => {
  const html = renderToStaticMarkup(
    <TemplateCatalogue templates={templates} selected="" onSelect={() => {}} canEdit brand={{ name: 'Acme' }} sellerNotice="n" />);

  it('show the thumbnail lazily, in one shape, zooming only without reduced motion', () => {
    expect(html).toMatch(/<img src="https:\/\/a\.test\/salon-verve01\/thumbnail\.jpg" alt="" loading="lazy"/);
    expect(html).toContain('aspect-[4/3]');
    expect(html).toContain('group-hover:scale-[1.04]');
    expect(html).toContain('motion-reduce:group-hover:scale-100');
    expect(html).not.toMatch(/translateY|--travel/);                  // no scrolling on hover
  });
  it('fall back to the live miniature without a thumbnail', () => {
    const other = html.slice(html.indexOf('Preview Other Salon'));
    expect(other.slice(0, 600)).not.toContain('<img');
    expect(other.slice(0, 600)).toContain('animate-pulse');           // the miniature, loading
  });
  it('say the style, the pages, the features and what it is best for', () => {
    expect(html).toContain('chic');
    expect(html).toContain('5 pages');
    expect(html).toContain('1 page<');
    for (const f of ['Prices', 'Team', 'FAQ']) expect(html).toContain(`>${f}<`);
    expect(html).toContain('Best for hair salon and beauty');
  });
  it('offer approved templates only, in the order given (no popularity sorting)', () => {
    expect(html).not.toContain('Draft Salon');
    expect(html.indexOf('Verve Hair Salon')).toBeLessThan(html.indexOf('Other Salon'));
  });
});
