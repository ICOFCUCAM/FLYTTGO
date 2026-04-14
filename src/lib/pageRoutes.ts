import type { Page } from './store';

/**
 * Bidirectional map between in-app Page ids and URL paths.
 *
 * We keep the existing setPage() API so the whole codebase doesn't
 * have to learn a router — the store layer pushes to history.pushState
 * whenever setPage runs and listens to popstate to sync the state
 * back when the user hits back / forward.
 *
 * Paths are chosen for SEO value rather than matching the Page id 1:1
 * (e.g. `driver-onboarding` → `/become-a-driver`, `subscriptions` →
 * `/driver-subscriptions`). Add to both maps when introducing a new
 * page — pathToPage falls back to 'home' for unknown paths.
 */

const PAGE_TO_PATH: Record<Page, string> = {
  /* Core flows */
  'home':                    '/',
  'booking':                 '/book',
  'services':                '/services',
  'van-guide':               '/van-size-guide',
  'checklist':               '/moving-checklist',
  'subscriptions':           '/driver-subscriptions',
  'driver-onboarding':       '/become-a-driver',

  /* Authenticated dashboards */
  'customer-dashboard':      '/dashboard',
  'my-bookings':             '/my-bookings',
  'driver-portal':           '/driver',
  'admin':                   '/admin',
  'profile':                 '/profile',

  /* Corporate */
  'corporate':               '/business',
  'corporate-dashboard':     '/business/dashboard',
  'bulk-booking':            '/business/bulk-booking',
  'recurring-deliveries':    '/business/recurring-deliveries',
  'company-dashboard-info':  '/business/about-dashboard',
  'invoice-billing':         '/business/invoicing',
  'corporate-api-access':    '/business/api',

  /* Legal */
  'terms':                   '/terms',
  'privacy':                 '/privacy',
  'liability':               '/liability',
  'driver-terms':            '/driver-terms',

  /* Informational / marketing */
  'about':                   '/about',
  'contact':                 '/contact',
  'faq':                     '/faq',
  'help':                    '/help',
  'safety':                  '/safety',
  'careers':                 '/careers',
  'press':                   '/press',
  'sustainability':          '/sustainability',
};

/* Inverted lookup. Built once at module load. */
const PATH_TO_PAGE: Record<string, Page> = Object.entries(PAGE_TO_PATH)
  .reduce<Record<string, Page>>((acc, [page, path]) => {
    acc[path] = page as Page;
    return acc;
  }, {});

/* Per-page <title> strings. Kept next to the routes so new pages
 * get a proper tab title by default — you still have to remember to
 * add an entry but at least the lookup is in one place. */
const PAGE_TITLES: Record<Page, string> = {
  'home':                    'FlyttGo — Norway\u2019s #1 Moving Marketplace',
  'booking':                 'Book a Move · FlyttGo',
  'services':                'Services · FlyttGo',
  'van-guide':               'Van Size Guide · FlyttGo',
  'checklist':               'Moving Checklist · FlyttGo',
  'subscriptions':           'Driver Subscription Plans · FlyttGo',
  'driver-onboarding':       'Become a Driver · FlyttGo',
  'customer-dashboard':      'Dashboard · FlyttGo',
  'my-bookings':             'My Bookings · FlyttGo',
  'driver-portal':           'Driver Portal · FlyttGo',
  'admin':                   'Admin · FlyttGo',
  'profile':                 'Profile · FlyttGo',
  'corporate':               'FlyttGo for Business',
  'corporate-dashboard':     'Corporate Dashboard · FlyttGo',
  'bulk-booking':            'Bulk Booking · FlyttGo',
  'recurring-deliveries':    'Recurring Deliveries · FlyttGo',
  'company-dashboard-info':  'Corporate Dashboard Tour · FlyttGo',
  'invoice-billing':         'Invoice & Billing · FlyttGo',
  'corporate-api-access':    'API Access · FlyttGo',
  'terms':                   'Terms of Service · FlyttGo',
  'privacy':                 'Privacy Policy · FlyttGo',
  'liability':               'Liability · FlyttGo',
  'driver-terms':            'Driver Terms · FlyttGo',
  'about':                   'About FlyttGo',
  'contact':                 'Contact FlyttGo',
  'faq':                     'FAQ · FlyttGo',
  'help':                    'Help Center · FlyttGo',
  'safety':                  'Safety & Insurance · FlyttGo',
  'careers':                 'Careers · FlyttGo',
  'press':                   'Press & Media · FlyttGo',
  'sustainability':          'Sustainability · FlyttGo',
};

/** Page id → canonical URL path. */
export function pageToPath(page: Page): string {
  return PAGE_TO_PATH[page] ?? '/';
}

/**
 * URL path → page id. Trailing slashes are ignored (so `/about/` and
 * `/about` both resolve). Unknown paths return 'home' so the router
 * defaults to the landing page.
 */
export function pathToPage(path: string): Page {
  if (!path) return 'home';
  const normalised = path === '/' ? '/' : path.replace(/\/+$/, '');
  return PATH_TO_PAGE[normalised] ?? 'home';
}

/** Page id → browser tab title. */
export function pageTitle(page: Page): string {
  return PAGE_TITLES[page] ?? 'FlyttGo';
}
