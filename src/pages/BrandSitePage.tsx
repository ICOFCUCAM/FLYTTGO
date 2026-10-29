/**
 * A company's white-label page (/b/<slug>, its subdomain or its own
 * domain). With a website template from the library, the page is shown in
 * a sandboxed iframe: no scripts, nothing it can reach in this window;
 * links open at the top level (to another page of the site, or booking).
 * Without one, a simple branded front page.
 */
import { useApp } from '../lib/store';
import { textOn } from '../lib/whiteLabel';
import { useWhiteLabel } from '../lib/whiteLabelContext';

export default function BrandSitePage() {
  const { setPage } = useApp();
  const { site, loading } = useWhiteLabel();

  if (loading) return <div className="min-h-[60vh] flex items-center justify-center text-gray-400">Loading…</div>;
  if (!site) return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold mb-2">This booking page isn't available</h1>
      <p className="text-gray-500 mb-6">The address may be wrong, or the company's page is not active.</p>
      <a href="https://flyttgo.no" className="text-[#0B2E59] underline">Go to FlyttGo</a>
    </div>
  );

  if (site.page) {
    return (
      <iframe
        title={`${site.display_name}`}
        srcDoc={site.page.html}
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
        referrerPolicy="no-referrer"
        className="w-full border-0 block"
        style={{ height: 'calc(100vh - 4rem)' }}
      />
    );
  }

  const bg = site.primary_color ?? '#0b2e59';
  const accent = site.accent_color ?? '#10b981';
  return (
    <div>
      <section style={{ background: bg, color: textOn(bg) }} className="px-4 py-20">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4">{site.display_name}</h1>
          <p className="text-lg opacity-90 mb-8">{site.tagline ?? (site.booking === 'moves' ? 'Book your move online: an instant price, verified drivers and live tracking.' : 'Book online in a minute.')}</p>
          <button onClick={() => setPage('booking')} style={{ background: accent, color: textOn(accent) }}
            className="px-6 py-3 rounded-xl font-semibold text-lg">{site.booking === 'appointments' ? 'Book a time' : site.booking === 'jobs' ? 'Ask for a job' : 'Get a price and book'}</button>
        </div>
      </section>
      {site.booking === 'moves' && <section className="max-w-4xl mx-auto px-4 py-12 grid md:grid-cols-3 gap-6 text-sm text-gray-600">
        <div><h2 className="font-bold text-gray-900 mb-1">Price before you book</h2>The price is calculated from your addresses, van size and helpers. No surprises.</div>
        <div><h2 className="font-bold text-gray-900 mb-1">Verified drivers</h2>Every move is carried out by a vetted driver with goods-in-transit insurance.</div>
        <div><h2 className="font-bold text-gray-900 mb-1">Follow your move</h2>Track the driver live on the day and get messages along the way.</div>
      </section>}
    </div>
  );
}
