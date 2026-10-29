/**
 * FlyttGo's own hosts. Any other host serving the app is a company's
 * verified domain for its white-label page (docs/WHITE_LABEL.md), and so is
 * <slug>.flyttgo.no.
 */
export function isFlyttgoHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'flyttgo.no' || h === 'www.flyttgo.no' || h === 'localhost' || h === '127.0.0.1'
    || h.endsWith('.vercel.app') || h.endsWith('.local');
}
