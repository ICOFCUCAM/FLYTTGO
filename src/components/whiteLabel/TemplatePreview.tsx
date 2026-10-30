/**
 * A template's full preview (docs/WHITE_LABEL.md → Website templates): each
 * page in the company's own name, colours and contact details, at desktop
 * width, as a tablet (768 px) or as a phone (390 px), page by page (tabs,
 * previous and next), with "Choose this website". Opened from the gallery it
 * also steps to the previous or next website of the gallery's results, so
 * the gallery's filters stay as they were. Pages are drawn sandboxed without
 * scripts, as the published site is.
 */
import { useRef, useState } from 'react';
import { hostsOf, renderTemplatePage, type Brand, type RenderImages } from '../../../supabase/functions/_shared/site-template';
import { imageUrls } from '../../../supabase/functions/_shared/image-library';
import type { SiteTemplate } from '../../lib/whiteLabel';
import { useDialog } from './useDialog';

const btn = 'px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50';

/** The preview's screen sizes: a desktop (the full width), a tablet and a phone. */
const DEVICES = [
  { id: 'desktop', label: 'Desktop', width: 0 },
  { id: 'tablet', label: 'Tablet', width: 768 },
  { id: 'phone', label: 'Phone', width: 390 },
] as const;
type Device = (typeof DEVICES)[number]['id'];

const pageName = (path: string) => path === '/' ? 'Home' : path.replace(/^\//, '').replace(/[-/]/g, ' ').replace(/^./, c => c.toUpperCase());

export default function TemplatePreview({ template, path, onPath, selected, canEdit, onChoose, onClose, brand, sellerNotice, step, images }: {
  template: SiteTemplate;
  path: string;
  onPath: (path: string) => void;
  selected: string;
  canEdit: boolean;
  onChoose: () => void;
  onClose: () => void;
  brand: Brand;
  sellerNotice: string;
  /** From the gallery: where this website is in its results, and how to step to the one before or after. */
  step?: { at: number; of: number; go: (by: -1 | 1) => void; loading: boolean };
  /** The resolved images (00023: the company's own, the template's approved ones, the library's or a plain block); none: the template's assets. */
  images?: RenderImages | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, onClose);
  const [device, setDevice] = useState<Device>('desktop');
  const pages = template.pages;
  const at = Math.max(0, pages.findIndex(p => p.path === path));
  const go = (i: number) => onPath(pages[(i + pages.length) % pages.length].path);
  const frame = DEVICES.find(d => d.id === device) ?? DEVICES[0];
  return (
    <div ref={box} tabIndex={-1} className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-2 sm:p-4 outline-none" role="dialog" aria-modal="true"
      aria-label={`Preview of ${template.name}`}>
      <div className="bg-white rounded-2xl w-full max-w-7xl h-[94vh] flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b">
          {step && (
            <div className="inline-flex items-center gap-1" role="group" aria-label="Websites">
              <button onClick={() => step.go(-1)} disabled={step.of < 2 || step.loading} className={`${btn} bg-gray-100`} aria-label="Previous website">‹</button>
              <span className="text-xs text-gray-600 tabular-nums" aria-live="polite">{step.loading ? 'Opening…' : `${step.at + 1} of ${step.of}`}</span>
              <button onClick={() => step.go(1)} disabled={step.of < 2 || step.loading} className={`${btn} bg-gray-100`} aria-label="Next website">›</button>
            </div>
          )}
          <h2 className="font-semibold mr-1">{template.name}</h2>
          <span className="text-[11px] font-semibold rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5">
            Preview: your name and colours, sample content
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {selected === template.id ? <span className="text-sm font-semibold text-[#0B2E59] self-center">✓ Chosen</span>
              : <button disabled={!canEdit} onClick={onChoose} className={`${btn} bg-[#0B2E59] text-white`}>Choose this website</button>}
            <button data-autofocus onClick={onClose} className={`${btn} bg-gray-100`}>Close</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-gray-50">
          <button onClick={() => go(at - 1)} disabled={pages.length < 2} className={`${btn} bg-white border border-gray-200`} aria-label="Previous page">‹ Previous</button>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Pages">
            {pages.map(p => (
              <button key={p.path} onClick={() => onPath(p.path)} aria-pressed={p.path === path}
                className={`px-2.5 py-1 rounded text-xs ${p.path === path ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200'}`}>{pageName(p.path)}</button>
            ))}
          </div>
          <button onClick={() => go(at + 1)} disabled={pages.length < 2} className={`${btn} bg-white border border-gray-200`} aria-label="Next page">Next ›</button>
          <span className="text-xs text-gray-600">Page {at + 1} of {pages.length}</span>
          <div className="ml-auto inline-flex rounded-lg border border-gray-200 bg-white p-0.5" role="group" aria-label="Screen size">
            {DEVICES.map(d => (
              <button key={d.id} onClick={() => setDevice(d.id)} aria-pressed={device === d.id} title={d.width ? `${d.width} px wide` : 'Full width'}
                className={`px-3 py-1 rounded-md text-xs font-semibold ${device === d.id ? 'bg-[#0B2E59] text-white' : 'text-gray-700'}`}>{d.label}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-h-0 bg-gray-200 overflow-auto flex justify-center">
          <iframe key={`${template.id}${path}`} title={`${template.name}: ${pageName(path)} (${frame.label.toLowerCase()})`} sandbox=""
            className={`bg-white ${frame.width ? 'self-stretch shadow-xl sm:my-3 sm:rounded-lg border border-gray-300 shrink-0' : 'w-full h-full'}`}
            style={frame.width ? { width: frame.width, maxWidth: '100%' } : undefined}
            srcDoc={renderTemplatePage(pages[at]?.html ?? '', {
              brand, assets: template.assets, pageUrl: () => '#', bookingUrl: '#', sellerNotice, images,
              assetHosts: hostsOf([...template.assets, ...imageUrls(images)], brand.logoUrl),
            })} />
        </div>
        <p className="text-xs text-gray-600 px-3 py-2 border-t">Shown with your name, colours and contact details; the wording is the template's sample; the pictures are those your site shows (yours, the library's for this kind of business, or a plain colour block). On your site every "book" button opens your booking page.</p>
      </div>
    </div>
  );
}
