import type { Page } from '../../lib/store';

/**
 * One site from the new design's sections (docs/HOMEPAGE_RESTRUCTURE.md, "One site, one header"). The
 * full design, every section, stays at /preview/home, the design studio's canvas. The homepage at `/`
 * keeps the overview; each product's full section lives on its own page. A link or menu item that
 * points at a section not on the current page goes to the page that holds it.
 */
export const HOME_SECTIONS = ['hero', 'booking', 'entry-points', 'marketplace', 'moving-services', 'business-workspace', 'explore-more', 'driver-network', 'final-cta'];

export const PAGE_SECTIONS: Partial<Record<Page, string[]>> = {
  'my-company': ['business-workspace', 'financial-administration'],
  'my-company-finance': ['financial-administration'],
  'industries': ['industry-experiences'],
  'how-it-works-page': ['unified-platform', 'how-flyttgo-works', 'marketplace-network-experience'],
  'moving-hub': ['moving-services', 'booking', 'how-it-works', 'van-types', 'booking-guarantees'],
  'corporate': ['business'],
  'white-label': ['white-label-builder'],
};

/* Where a section lives when it is not on the homepage. */
export const SECTION_PAGE: Record<string, Page> = {
  'financial-administration': 'my-company-finance',
  'industry-experiences': 'industries',
  'unified-platform': 'how-it-works-page',
  'how-flyttgo-works': 'how-it-works-page',
  'marketplace-network-experience': 'how-it-works-page',
  'how-it-works': 'moving-hub',
  'van-types': 'moving-hub',
  'booking-guarantees': 'moving-hub',
  'business': 'corporate',
  'white-label-builder': 'white-label',
};

/** The key a section is known by: its id, or "hero" and "final-cta" for the sections without one. */
export const sectionKey = (s: Element) => s.id || (s.classList.contains('hero') ? 'hero' : s.classList.contains('final-cta') ? 'final-cta' : '');
