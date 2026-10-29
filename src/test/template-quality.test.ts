import { describe, expect, it } from 'vitest';
import { contentFlags, prepareTemplate } from '../../supabase/functions/_shared/site-template.ts';
import {
  CHECKS, browserChecks, combine, failingChecks, mergeResults, pageStaticChecks, staticChecks,
} from '../../supabase/functions/_shared/template-quality.ts';

const assets = [{ key: 'hero', url: 'https://a.test/hero.jpg' }, { key: 'services', url: 'https://a.test/s.jpg' }];
const byId = (rs: { id: string; status: string }[]) => Object.fromEntries(rs.map(r => [r.id, r.status]));

describe('booking links at import', () => {
  it('sends every link that reads as booking to the booking page, whatever it pointed at', () => {
    const t = prepareTemplate({ id: 'x', name: 'Verve Hair Salon', pages: [{ path: '/', html:
      '<nav><a href="{{BASE}}/contact">Book Now</a><a href="{{BASE}}/services">Services</a></nav>'
      + '<a class="btn" href="{{BASE}}/contact"><svg></svg> Request an appointment</a><a href="tel:+15550100">Book by phone</a>'
      + '<a href="#">Get a free quote</a><a href="{{BASE}}/about">Booked solid? Read about us</a>' }] });
    const h = t.pages[0].html;
    expect(h).toContain('<a href="{{BOOKING_URL}}">Book Now</a>');
    expect(h).toContain('<a href="{{BASE}}/services">Services</a>');
    expect(h).toContain('<a class="btn" href="{{BOOKING_URL}}"><svg></svg> Request an appointment</a>');
    expect(h).toContain('href="tel:{{brand.phone_tel}}">Book by phone</a>');        // a call stays a call
    expect(h).toContain('<a href="{{BOOKING_URL}}">Get a free quote</a>');
    expect(h).toContain('<a href="{{BASE}}/about">Booked solid? Read about us</a>');
  });
});

describe('sample content flags', () => {
  it('finds US addresses and figures', () => {
    const f = contentFlags('<p>Find us at 418 Ironside Ave, Cedar Grove OH 43004. Salon in Nashville, TN.</p>'
      + '<p>18,000+ moves, 98% on time, 500+ reviews</p>', '/');
    expect(f.filter(x => x.kind === 'address').length).toBeGreaterThanOrEqual(3);
    expect(f.filter(x => x.kind === 'statistic').map(x => x.sample).join(' ')).toMatch(/18,000\+.*98%.*500\+/s);
  });
  it('does not take ordinary words for a state', () => {
    expect(contentFlags('<h2>GET IN TOUCH</h2><p>Pay now or later. Sign in.</p>', '/').filter(x => x.kind === 'address')).toEqual([]);
  });
  it('reads the description search engines show', () => {
    expect(contentFlags('<meta name="description" content="Call 555-273-0199"><p>Hi</p>', '/').some(x => x.kind === 'phone')).toBe(true);
  });
});

describe('checks without a browser', () => {
  const page = { path: '/', html: '<img src="{{ASSET:hero.2}}" alt="A van"><img src="{{ASSET:gallery}}"><img src="{{ASSET:services.1}}" alt="">'
    + '<a href="{{BASE}}/contact">Book now</a><a href="{{BOOKING_URL}}">Reserve</a>' };
  const r = pageStaticChecks(page, assets, [{ kind: 'price', page: '/', sample: '$55' }, { kind: 'review', page: '/', sample: 'Reviews' },
                                             { kind: 'address', page: '/about', sample: 'Nashville, TN' }]);

  it('finds images without a picture or an alt text, stray booking links and sample content', () => {
    expect(byId(r)).toEqual({ unsafe_html: 'pass', broken_images: 'fail', image_alt: 'fail', booking_links: 'fail', sample_content: 'fail' });
    expect(r.find(x => x.id === 'broken_images')?.items).toEqual(['{{ASSET:gallery}} has no image']);  // hero.2 falls back to hero
    expect(r.find(x => x.id === 'image_alt')?.items).toEqual(['{{ASSET:gallery}}']);                   // alt="" is decoration
    expect(r.find(x => x.id === 'booking_links')?.items).toEqual(['"Book now" → {{BASE}}/contact']);
    expect(r.find(x => x.id === 'sample_content')?.items).toEqual(['price: …$55…']);                   // reviews are the reviewer's; other pages apart
  });
  it('pass on a clean page', () => {
    const ok = pageStaticChecks({ path: '/', html: '<img src="{{ASSET:hero}}" alt="x"><a href="{{BOOKING_URL}}">Book now</a>' }, assets);
    expect(ok.every(x => x.status === 'pass')).toBe(true);
  });
  it('flag unsafe HTML, which no reason overrides', () => {
    expect(byId(pageStaticChecks({ path: '/', html: '<p onclick="x()">x</p>' }, assets)).unsafe_html).toBe('fail');
    expect(CHECKS.find(c => c.id === 'unsafe_html')?.overridable).toBe(false);
  });
  it('leave the browser\'s checks not run, which does not stop approval', () => {
    const all = staticChecks([page], assets);
    expect(all.filter(x => x.status === 'not_run').map(x => x.id).sort()).toEqual(['overflow', 'renders']);
    expect(failingChecks({ results: all }).map(x => x.id).sort()).toEqual(['booking_links', 'broken_images', 'image_alt']);
  });
});

describe('checks in a browser', () => {
  const seen = { rendered: true, textChars: 900, overflow: [{ width: 320, scrollWidth: 328, culprits: ['div.stat'] }, { width: 375, scrollWidth: 375, culprits: [] }],
                 images: [{ src: 'https://a.test/hero.jpg', loaded: true, width: 1600, height: 900 }, { src: 'https://a.test/x.jpg', loaded: false, width: 0, height: 0 }] };
  it('report overflow with what sticks out, and images that do not load', () => {
    const r = browserChecks('/', seen);
    expect(byId(r)).toEqual({ renders: 'pass', overflow: 'fail', broken_images: 'fail' });
    expect(r.find(x => x.id === 'overflow')?.detail).toBe('Wider than the screen at 320 px (328 px).');
    expect(r.find(x => x.id === 'overflow')?.items).toEqual(['div.stat']);
  });
  it('do not blame the template when no image could be loaded at all (no network)', () => {
    const r = browserChecks('/', { ...seen, images: seen.images.map(i => ({ ...i, loaded: false })) });
    expect(byId(r).broken_images).toBe('not_run');
  });
  it('fail a page that draws nothing', () => {
    expect(byId(browserChecks('/', { ...seen, textChars: 0 })).renders).toBe('fail');
  });
  it('combine with the static results, one result per check and page', () => {
    const base = staticChecks([{ path: '/', html: '<img src="{{ASSET:hero}}" alt="x">' }], assets);
    const all = combine(base, browserChecks('/', seen));
    expect(all.filter(x => x.id === 'broken_images')).toHaveLength(1);
    expect(byId(all)).toMatchObject({ renders: 'pass', overflow: 'fail', broken_images: 'fail' });
    expect(mergeResults(all, [{ id: 'overflow', page: '/', status: 'pass', detail: 'Fits.' }]).find(x => x.id === 'overflow')?.status).toBe('pass');
  });
  it('count stale results (a page edited since) as stopping approval', () => {
    expect(failingChecks({ results: [{ id: 'overflow', page: '/', status: 'stale', detail: '' }] })).toHaveLength(1);
  });
});
