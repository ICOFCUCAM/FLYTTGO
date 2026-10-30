import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFlyttgoHost, isTransportHost, transportUrl, TRANSPORT_HOST } from '../lib/hosts';
import { pageToPath, pageTitle, pathToPage } from '../lib/pageRoutes';

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

  it('links to it stay on the same site until its own address is set', () => {
    vi.stubEnv('VITE_TRANSPORT_URL', '');
    expect(transportUrl()).toBe('/transport');
    vi.stubEnv('VITE_TRANSPORT_URL', 'https://transport.flyttgo.no/');
    expect(transportUrl()).toBe('https://transport.flyttgo.no');
  });
});
