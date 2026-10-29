/**
 * The frame of a company's white-label page: its header (logo, name,
 * "Book a move", or its shop) and footer (who sells, terms, privacy, contact) in place
 * of FlyttGo's own. The seller is always stated (docs/WHITE_LABEL.md).
 */
import { useApp } from '../../lib/store';
import { textOn, type PublicSite } from '../../lib/whiteLabel';

export function BrandHeader({ site }: { site: PublicSite }) {
  const { setPage } = useApp();
  const bg = site.primary_color ?? '#0b2e59';
  const home = site.domain && typeof window !== 'undefined' && window.location.hostname === site.domain ? '/' : `/b/${site.slug}`;
  return (
    <header style={{ background: bg, color: textOn(bg) }} className="sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <a href={home} className="flex items-center gap-3 min-w-0">
          {site.logo_url
            ? <img src={site.logo_url} alt={site.display_name} className="h-9 w-auto max-w-[140px] object-contain bg-white rounded p-0.5" />
            : null}
          <span className="font-bold text-lg truncate">{site.display_name}</span>
        </a>
        {/* A page with only a shop: the shop in place of booking (00020). */}
        <button onClick={() => setPage(site.shop && site.booking === 'none' ? 'shop' : 'booking')}
          style={{ background: site.accent_color ?? '#10b981', color: textOn(site.accent_color ?? '#10b981') }}
          className="px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap">
          {site.shop && site.booking === 'none' ? 'Shop'
            : site.booking === 'jobs' ? 'Ask for a job' : site.booking === 'appointments' ? 'Book a time' : 'Book a move'}
        </button>
      </div>
    </header>
  );
}

export function BrandFooter({ site }: { site: PublicSite }) {
  const { setPage } = useApp();
  const terms = site.seller_model === 'company' ? site.terms_url : null;
  const privacy = site.seller_model === 'company' ? site.privacy_url : null;
  const s = site.seller;
  return (
    <footer className="bg-gray-900 text-gray-300 text-sm">
      <div className="max-w-6xl mx-auto px-4 py-8 grid gap-6 md:grid-cols-3">
        <div>
          <div className="font-semibold text-white mb-1">{site.display_name}</div>
          {site.tagline && <div className="text-gray-400">{site.tagline}</div>}
        </div>
        <div>
          <div className="font-semibold text-white mb-1">Seller</div>
          <div>{s.name}{s.org_number ? `, org. nr. ${s.org_number}${s.vat_registered ? ' MVA' : ''}` : ''}</div>
          {s.address && <div>{s.address}</div>}
          <div className="text-gray-400 mt-1">{site.seller_notice}</div>
        </div>
        <div>
          <div className="font-semibold text-white mb-1">Customer service</div>
          {site.support.email && <div><a className="underline" href={`mailto:${site.support.email}`}>{site.support.email}</a></div>}
          {site.support.phone && <div><a className="underline" href={`tel:${site.support.phone.replace(/[^\d+]/g, '')}`}>{site.support.phone}</a></div>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {terms ? <a className="underline" href={terms} target="_blank" rel="noopener noreferrer">Terms</a>
                   : <button className="underline" onClick={() => setPage('terms')}>Terms</button>}
            {privacy ? <a className="underline" href={privacy} target="_blank" rel="noopener noreferrer">Privacy</a>
                     : <button className="underline" onClick={() => setPage('privacy')}>Privacy</button>}
          </div>
        </div>
      </div>
      <div className="text-center text-xs text-gray-500 pb-6">Powered by FlyttGo</div>
    </footer>
  );
}
