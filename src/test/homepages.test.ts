import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFlyttgoHost, isProductionHost, isTransportHost, transportUrl, TRANSPORT_HOST } from '../lib/hosts';
import { pageToPath, pageTitle, pathToPage } from '../lib/pageRoutes';
import { LIVE_NEW_DESIGN, newDesign } from '../lib/siteDesign';

/* docs/HOMEPAGES.md: flyttgo.no shows the platform's front page, and the
 * moving and transport front page is transport.flyttgo.no and /transport. */
describe('the two front pages', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('transport.flyttgo.no is FlyttGo\'s own host, not a company page', () => {
    expect(isFlyttgoHost(TRANSPORT_HOST)).toBe(true);
    expect(isFlyttgoHost('TRANSPORT.flyttgo.no')).toBe(true);
    expect(isTransportHost('transport.flyttgo.no')).toBe(true);
    expect(isTransportHost('flyttgo.no')).toBe(false);
    expect(isFlyttgoHost('acme.flyttgo.no')).toBe(false);
    expect(isFlyttgoHost('transport.flyttgo.no.evil.com')).toBe(false);
  });

  it('the moving and transport front page keeps its own path', () => {
    expect(pageToPath('transport-home')).toBe('/transport');
    expect(pathToPage('/transport')).toBe('transport-home');
    expect(pathToPage('/transport/')).toBe('transport-home');
    expect(pathToPage('/')).toBe('home');
    expect(pageTitle('transport-home')).toMatch(/Moving & Transport/);
    expect(pageTitle('home')).not.toMatch(/Moving/);
  });

  it('the restructured homepage is under review on its own path', () => {
    expect(pathToPage('/preview/home')).toBe('home-preview');
    expect(pageToPath('home-preview')).toBe('/preview/home');
  });

  it('the design lab has its own preview path and never opens on a production host', () => {
    expect(pathToPage('/preview/lab')).toBe('home-lab');
    expect(pageToPath('home-lab')).toBe('/preview/lab');
    expect(isProductionHost('flyttgo.no')).toBe(true);
    expect(isProductionHost('WWW.flyttgo.no')).toBe(true);
    expect(isProductionHost('transport.flyttgo.no')).toBe(true);
    expect(isProductionHost('flyttgo-git-preview.vercel.app')).toBe(false);
    expect(isProductionHost('localhost')).toBe(false);
  });

  it('the new design shows on preview addresses, on flyttgo.no only after the switch, never on company domains', () => {
    expect(newDesign('flyttgo-git-preview.vercel.app')).toBe(true);
    expect(newDesign('localhost')).toBe(true);
    expect(newDesign('flyttgo.no')).toBe(LIVE_NEW_DESIGN);
    expect(newDesign('www.flyttgo.no')).toBe(LIVE_NEW_DESIGN);
    expect(newDesign('transport.flyttgo.no')).toBe(LIVE_NEW_DESIGN);
    expect(newDesign('acme-ror.no')).toBe(false);
    expect(newDesign('acme.flyttgo.no')).toBe(false);
  });

  it('the selected design uses only variants the lab offers', async () => {
    const { DEFAULT_VARIANTS, VARIANT_OPTIONS } = await import('../components/homeV2/design.config');
    for (const o of VARIANT_OPTIONS) expect(o.options.map(x => x.value)).toContain(DEFAULT_VARIANTS[o.key]);
    expect(Object.keys(DEFAULT_VARIANTS).sort()).toEqual(VARIANT_OPTIONS.map(o => o.key).sort());
  });

  it('links to it stay on the same site until its own address is set', () => {
    vi.stubEnv('VITE_TRANSPORT_URL', '');
    expect(transportUrl()).toBe('/transport');
    vi.stubEnv('VITE_TRANSPORT_URL', 'https://transport.flyttgo.no/');
    expect(transportUrl()).toBe('https://transport.flyttgo.no');
  });
});
