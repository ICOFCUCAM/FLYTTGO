/**
 * A template's home page in miniature, as theme galleries show them: the
 * whole page drawn at desktop width in the company's name and colours,
 * scaled down to the card. Hovering scrolls slowly down the page. The page
 * is loaded only when the card comes into view, and drawn sandboxed without
 * scripts, as the published site is.
 */
import { useEffect, useRef, useState } from 'react';
import { renderTemplatePage, type Brand } from '../../../supabase/functions/_shared/site-template';
import { loadTemplateHome, type SiteTemplateSummary } from '../../lib/whiteLabel';

/** The width the page is drawn at before it is scaled down, and how much of it is drawn. */
const PAGE_WIDTH = 1280;
const PAGE_HEIGHT = 3200;

const homes = new Map<string, Promise<{ path: string; html: string } | null>>();
/** Each home page is fetched once, however often the catalogue is filtered. */
const homeOf = (id: string) => {
  if (!homes.has(id)) homes.set(id, loadTemplateHome(id).catch(() => null));
  return homes.get(id)!;
};

const hostsOf = (assets: { url: string }[]) =>
  assets.map(a => { try { return new URL(a.url).host; } catch { return ''; } }).filter(Boolean);

export default function TemplateThumb({ template, brand, sellerNotice, height = 260 }: {
  template: SiteTemplateSummary; brand: Brand; sellerNotice: string; height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const [doc, setDoc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); seen.disconnect(); } }, { rootMargin: '300px' });
    const size = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    seen.observe(el); size.observe(el);
    return () => { seen.disconnect(); size.disconnect(); };
  }, []);

  /* The parent builds the brand afresh on each render: redraw only when it changes. */
  const brandKey = JSON.stringify(brand);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    const brand = JSON.parse(brandKey) as Brand;
    homeOf(template.id).then(home => {
      if (!live) return;
      if (!home) { setFailed(true); return; }
      setDoc(renderTemplatePage(home.html, {
        brand, assets: template.assets, pageUrl: () => '#', bookingUrl: '#', sellerNotice,
        assetHosts: hostsOf(template.assets),
      }));
    });
    return () => { live = false; };
  }, [visible, template.id, template.assets, brandKey, sellerNotice]);

  const scale = width ? width / PAGE_WIDTH : 0;
  /* How far hovering scrolls: the drawn page less what the card shows. */
  const travel = scale ? Math.max(0, PAGE_HEIGHT * scale - height) : 0;
  const cover = template.assets.find(a => a.key === 'hero')?.url ?? template.assets[0]?.url;

  return (
    <div ref={box} className="group relative w-full overflow-hidden bg-gray-100" style={{ height }}>
      {doc && scale > 0 ? (
        <div className="absolute left-0 top-0 transition-transform ease-in-out group-hover:[transform:translateY(var(--travel))]"
          style={{ ['--travel' as string]: `-${travel}px`, transitionDuration: `${Math.max(2, travel / 120)}s` }}>
          <iframe title={`${template.name}: home page`} sandbox="" srcDoc={doc} tabIndex={-1} aria-hidden="true" scrolling="no"
            className="pointer-events-none border-0 bg-white origin-top-left"
            style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})` }} />
        </div>
      ) : failed && cover ? (
        <img src={cover} alt="" loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-gray-100 to-gray-200" />
      )}
    </div>
  );
}
