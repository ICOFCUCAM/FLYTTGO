/**
 * A template's home page in miniature: the page drawn at desktop width in
 * the company's name and colours, scaled down to the card. The catalogue
 * shows the importer's thumbnail (a picture) where a template has one and
 * this live miniature where it has none. The page is loaded only when the
 * card comes into view, and drawn sandboxed without scripts, as the
 * published site is. Without `height` it fills the box it is put in.
 */
import { useEffect, useRef, useState } from 'react';
import { hostsOf, renderTemplatePage, type Brand, type RenderImages } from '../../../supabase/functions/_shared/site-template';
import { imageUrls } from '../../../supabase/functions/_shared/image-library';
import { loadTemplateHome, type SiteTemplateSummary } from '../../lib/whiteLabel';

/** The width the page is drawn at before it is scaled down, and how much of it is drawn. */
const PAGE_WIDTH = 1280;
const PAGE_HEIGHT = 1600;

const homes = new Map<string, Promise<{ path: string; html: string } | null>>();
/** Each home page is fetched once, however often the catalogue is filtered. */
const homeOf = (id: string) => {
  if (!homes.has(id)) homes.set(id, loadTemplateHome(id).catch(() => null));
  return homes.get(id)!;
};


export default function TemplateThumb({ template, brand, sellerNotice, height, images }: {
  template: SiteTemplateSummary; brand: Brand; sellerNotice: string; height?: number;
  /** The resolved images (00023); none: the template's assets. */
  images?: RenderImages | null;
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
        brand, assets: template.assets, pageUrl: () => '#', bookingUrl: '#', sellerNotice, images,
        assetHosts: hostsOf([...template.assets, ...imageUrls(images)], brand.logoUrl),
      }));
    });
    return () => { live = false; };
  }, [visible, template.id, template.assets, brandKey, sellerNotice, images]);

  const scale = width ? width / PAGE_WIDTH : 0;
  /* Without the page: its hero as resolved, else (before the library) its first asset. */
  const cover = images ? (images.byKey.hero?.url ?? undefined)
    : template.assets.find(a => a.key === 'hero')?.url ?? template.assets.find(a => a.key !== 'thumbnail')?.url;

  return (
    <div ref={box} className={`relative w-full overflow-hidden bg-gray-100 ${height ? '' : 'h-full'}`} style={height ? { height } : undefined}>
      {doc && scale > 0 ? (
        <div className="absolute left-0 top-0">
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
