/**
 * FlyttGo's own hosts. Any other host serving the app is a company's
 * verified domain for its white-label page (docs/WHITE_LABEL.md), and so is
 * <slug>.flyttgo.no. transport.flyttgo.no is FlyttGo's moving and transport
 * front page (docs/HOMEPAGES.md); its slug is reserved (00027).
 */
export const TRANSPORT_HOST = 'transport.flyttgo.no';

export function isFlyttgoHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'flyttgo.no' || h === 'www.flyttgo.no' || h === TRANSPORT_HOST || h === 'localhost' || h === '127.0.0.1'
    || h.endsWith('.vercel.app') || h.endsWith('.local');
}

/** True on the moving and transport front page's own address. */
export function isTransportHost(host: string): boolean {
  return host.toLowerCase() === TRANSPORT_HOST;
}

/**
 * Where links to the moving and transport front page go: its own address
 * once VITE_TRANSPORT_URL is set (after the subdomain is live in DNS and on
 * Vercel), else /transport on the same site, which shows the same page and
 * keeps the visitor signed in.
 */
export function transportUrl(): string {
  return (import.meta.env.VITE_TRANSPORT_URL ?? '').replace(/\/+$/, '') || '/transport';
}
