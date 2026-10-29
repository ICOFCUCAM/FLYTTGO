/**
 * The booking widget's page (/embed/<slug>, framed by public/widget.js on a
 * company's own website). It shows the company's booking flow from its
 * white-label page (BrandSitePage's booking: FlyttGo's moves, or the
 * company's jobs or appointments), compact and without FlyttGo's header.
 *
 * Who may frame it: the websites the company listed (Corporate dashboard →
 * API and widget). The browser enforces that with the frame-ancestors
 * header (middleware.ts); this page checks its parent again, and shows
 * nothing of the flow elsewhere. No API key is involved.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useWhiteLabel } from '../lib/whiteLabelContext';
import { embedVisit, startEmbed, useEmbedResize } from '../lib/embed';
import { isAllowedParent, parentOrigin } from '../../supabase/functions/_shared/widget';

const BookingFlow = lazy(() => import('../components/BookingFlow'));
const ServiceBookingPage = lazy(() => import('./ServiceBookingPage'));

type Check = 'checking' | 'allowed' | 'not-framed' | 'not-allowed';

export default function EmbedPage() {
  const { site, loading } = useWhiteLabel();
  const [check, setCheck] = useState<Check>('checking');

  useEffect(() => {
    if (loading) return;
    if (!site) { setCheck('not-allowed'); return; }
    if (window.self === window.top) { setCheck('not-framed'); return; }
    const parent = parentOrigin({
      ancestorOrigins: window.location.ancestorOrigins ?? null,
      referrer: document.referrer || null,
      claimed: new URLSearchParams(window.location.search).get('origin'),
    });
    if (parent && isAllowedParent(parent, site.widget_origins ?? [], window.location.origin)) {
      startEmbed({ slug: site.slug, parent });
      setCheck('allowed');
    } else {
      setCheck('not-allowed');
    }
  }, [site, loading]);
  useEmbedResize(check === 'allowed' && !!embedVisit());

  if (loading || check === 'checking') return <div className="p-6 text-center text-gray-400 text-sm">Loading…</div>;
  if (!site) return (
    <div className="p-6 text-center text-sm text-gray-600">This booking page isn't available.</div>
  );
  if (check === 'not-framed') return (
    <div className="p-6 text-center text-sm text-gray-600">
      This page is the booking widget for {site.display_name}'s website.{' '}
      <a className="underline text-[#0B2E59]" href={`/b/${site.slug}`}>Open {site.display_name}'s booking page</a>
    </div>
  );
  if (check === 'not-allowed') return (
    <div className="p-6 text-center text-sm text-gray-600">
      The booking widget is not set up for this website.{' '}
      <a className="underline text-[#0B2E59]" href={`/b/${site.slug}`} target="_blank" rel="noopener noreferrer">
        Book on {site.display_name}'s page
      </a>
    </div>
  );

  return (
    <div className="bg-white">
      <div className="px-4 pt-4 text-sm font-semibold text-gray-700">{site.display_name}</div>
      <Suspense fallback={<div className="p-6 text-center text-gray-400 text-sm">Loading…</div>}>
        {site.booking === 'moves' ? <BookingFlow />
          : site.booking === 'jobs' || site.booking === 'appointments' ? <ServiceBookingPage />
          : <div className="p-6 text-center text-sm text-gray-600">Online booking is not open yet.</div>}
      </Suspense>
      <p className="px-4 pb-4 text-xs text-gray-500">{site.booking === 'moves' ? `${site.seller_notice} ` : ''}Powered by FlyttGo.</p>
    </div>
  );
}
