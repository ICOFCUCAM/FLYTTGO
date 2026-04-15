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
  'payment':                 '/payment',
  'tracking':                '/track',
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

  /* Supabase auth callback (email confirmation, magic link, OAuth) */
  'auth-callback':           '/auth/callback',

  /* Driver onboarding status (pending/approved/rejected) */
  'driver-application-status': '/driver-application-status',

  /* Informational / marketing */
  'about':                   '/about',
  'contact':                 '/contact',
  'faq':                     '/faq',
  'help':                    '/help',
  'safety':                  '/safety',
  'careers':                 '/careers',
  'press':                   '/press',
  'sustainability':          '/sustainability',

  /* Fallback for unknown routes. No real path — pathToPage() returns
   * this id for anything it can't match. setPage('not-found') still
   * updates history.pushState to whatever URL triggered the fallback. */
  'not-found':               '/404',
};

/* Inverted lookup. Built once at module load. */
const PATH_TO_PAGE: Record<string, Page> = Object.entries(PAGE_TO_PATH)
  .reduce<Record<string, Page>>((acc, [page, path]) => {
    acc[path] = page as Page;
    return acc;
  }, {});

/**
 * Per-page SEO metadata — title, meta description and a dedicated
 * OG image where we have one (otherwise we fall back to /og.svg in
 * applyPageMeta below). Everything here feeds straight into the
 * <meta> tags on navigation.
 */
export interface PageMeta {
  title:       string;
  description: string;
  image?:      string;
}

const PAGE_TITLES: Record<Page, string> = {
  'home':                    'FlyttGo — Norway\u2019s #1 Moving Marketplace',
  'booking':                 'Book a Move · FlyttGo',
  'payment':                 'Secure Payment · FlyttGo',
  'tracking':                'Track Your Delivery · FlyttGo',
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
  'auth-callback':           'Signing you in… · FlyttGo',
  'driver-application-status': 'Driver Application Status · FlyttGo',
  'not-found':               'Page Not Found · FlyttGo',
};

/**
 * Per-page meta description, keyed off the same Page id. These are
 * the strings Google, LinkedIn, WhatsApp and X use when someone
 * shares a FlyttGo link — keep them honest, specific and ~155 chars.
 */
const PAGE_DESCRIPTIONS: Record<Page, string> = {
  'home':
    "Book verified, insured movers and cargo drivers across Norway. Real-time tracking, transparent pricing, escrow payment. Oslo, Bergen, Trondheim and more.",
  'booking':
    'Book your next move in under 3 minutes. Get an instant quote, pick a verified driver, and track your delivery live — all with escrow payment built in.',
  'payment':
    'Secure escrow checkout for your FlyttGo booking. Pay with card, Vipps, Google Pay or corporate invoice — money is held until the delivery is confirmed.',
  'tracking':
    'Track your FlyttGo delivery in real time. Live driver location, ETA, progress timeline and in-app chat with your driver.',
  'services':
    'From single-item deliveries to full office relocations — every FlyttGo service is run by registered Norwegian carriers with goods-in-transit insurance.',
  'van-guide':
    'Not sure what size van you need? Compare Small, Medium, Large and Luton options side-by-side and get an instant recommendation for your move.',
  'checklist':
    'The complete moving checklist for Norway. Timeline, packing order, utilities, address change — everything you need for a stress-free move.',
  'subscriptions':
    'Drive for FlyttGo and keep more of what you earn. Pick a subscription that matches your volume — lower commission, higher dispatch priority.',
  'driver-onboarding':
    'Apply to become a FlyttGo driver. Flexible hours, weekly payouts, verified jobs across Norway. Requirements, fees and application walkthrough inside.',
  'customer-dashboard':
    'Your FlyttGo dashboard — active bookings, past moves, receipts and driver tracking all in one place.',
  'my-bookings':
    'View, track and manage every FlyttGo booking from one place — with live driver location, receipts and dispute tools.',
  'driver-portal':
    'The FlyttGo driver portal — active jobs, earnings, payouts and subscription settings.',
  'admin':
    'Internal FlyttGo admin dashboard.',
  'profile':
    'Manage your FlyttGo profile, notification settings and language preferences.',
  'corporate':
    'FlyttGo for businesses — bulk booking, recurring deliveries, consolidated invoicing and API access for Norwegian companies at every scale.',
  'corporate-dashboard':
    'The FlyttGo corporate dashboard — track delivery volume, spending and performance across your whole organisation.',
  'bulk-booking':
    'Upload multiple delivery jobs at once. Perfect for retailers, warehouses and event logistics managing dozens of drops in a single run.',
  'recurring-deliveries':
    'Set up daily, weekly or monthly delivery runs with automatic driver assignment. Ideal for scheduled freight, laundry, catering and more.',
  'company-dashboard-info':
    'Take the tour of the FlyttGo corporate dashboard — reporting, user management, invoicing and analytics.',
  'invoice-billing':
    'Consolidated monthly invoicing, MVA-compliant receipts and flexible payment terms for FlyttGo business customers.',
  'corporate-api-access':
    'The FlyttGo REST API — create bookings, track deliveries and reconcile invoices straight from your ERP, WMS or e-commerce platform.',
  'terms':
    'FlyttGo\u2019s Terms of Service — the rules that govern using the FlyttGo marketplace as a customer or business.',
  'privacy':
    "FlyttGo\u2019s Privacy Policy. How we collect, use and protect your data under Norwegian and EU privacy law (GDPR).",
  'liability':
    'FlyttGo\u2019s liability terms — goods in transit cover, claim process, driver responsibilities and dispute resolution.',
  'driver-terms':
    'The FlyttGo Driver Agreement — commission, commitments, conduct and the rules for accepting jobs on the FlyttGo platform.',
  'about':
    'FlyttGo is Norway\u2019s #1 moving marketplace. Verified drivers, escrow payment, real-time tracking — built in Oslo, run by Norwegians.',
  'contact':
    'Get in touch with FlyttGo — phone, email, WhatsApp, office address and a contact form. Support available 7 days a week, 08:00\u201322:00.',
  'faq':
    'Answers to the most common questions about booking, payment, drivers, insurance and cancellations on FlyttGo.',
  'help':
    'Browse help articles and guides for booking, payment, safety, account management and using FlyttGo for business.',
  'safety':
    'How FlyttGo keeps you safe — 6-step driver vetting, mandatory goods-in-transit insurance, escrow payments and our damage claims process.',
  'careers':
    'Join the FlyttGo team. Open roles in engineering, design, operations, support and marketing — plus how to apply as a driver.',
  'press':
    'Press & media kit for FlyttGo — quick facts, executive bios, brand assets and press contact.',
  'sustainability':
    'How FlyttGo makes moving greener — shared routes, EV fleet incentives, reusable moving kits and carbon offset on every booking.',
  'auth-callback':
    'Confirming your FlyttGo account and signing you in. You\u2019ll be redirected to your dashboard automatically.',
  'driver-application-status':
    'Track the status of your FlyttGo driver application — pending review, approved, or rejected with next steps.',
  'not-found':
    "The page you were looking for doesn't exist. Find what you need from the FlyttGo homepage, or book a move from any of our services.",
};

/** Page id → canonical URL path. */
export function pageToPath(page: Page): string {
  return PAGE_TO_PATH[page] ?? '/';
}

/** Page id → meta description. */
export function pageDescription(page: Page): string {
  return PAGE_DESCRIPTIONS[page] ?? PAGE_DESCRIPTIONS.home;
}

/** Page id → structured SEO meta bundle (title + description). */
export function pageMeta(page: Page): PageMeta {
  return {
    title:       pageTitle(page),
    description: pageDescription(page),
  };
}

/**
 * Apply page meta to the document head. Updates <title>, meta
 * description, canonical link, OpenGraph and Twitter tags in place.
 * Creates missing tags if they're not already in index.html so
 * deep-linked pages still get the right head from a cold load.
 */
export function applyPageMeta(page: Page): void {
  if (typeof document === 'undefined') return;
  const meta  = pageMeta(page);
  const path  = pageToPath(page);
  const url   = `https://flyttgo.no${path === '/' ? '' : path}`;
  const image = 'https://flyttgo.no/og.svg';

  document.title = meta.title;
  upsertMeta('name',     'description',      meta.description);
  upsertLink('canonical', url);

  upsertMeta('property', 'og:title',        meta.title);
  upsertMeta('property', 'og:description',  meta.description);
  upsertMeta('property', 'og:url',          url);
  upsertMeta('property', 'og:image',        image);
  upsertMeta('property', 'og:type',         'website');
  upsertMeta('property', 'og:site_name',    'FlyttGo');

  upsertMeta('name',     'twitter:card',        'summary_large_image');
  upsertMeta('name',     'twitter:title',        meta.title);
  upsertMeta('name',     'twitter:description',  meta.description);
  upsertMeta('name',     'twitter:image',        image);
}

function upsertMeta(keyAttr: 'name' | 'property', keyValue: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[${keyAttr}="${keyValue}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(keyAttr, keyValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel: string, href: string) {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/**
 * URL path → page id. Trailing slashes are ignored (so `/about/` and
 * `/about` both resolve). Unknown paths return 'home' so the router
 * defaults to the landing page.
 */
export function pathToPage(path: string): Page {
  if (!path) return 'home';
  const normalised = path === '/' ? '/' : path.replace(/\/+$/, '');
  /* Unknown paths resolve to 'not-found' rather than silently
   * serving the homepage. NotFoundPage sets robots=noindex so
   * Google doesn't index the garbage URL, and the user sees a
   * proper 404 instead of a confusing home view. */
  return PATH_TO_PAGE[normalised] ?? 'not-found';
}

/** Page id → browser tab title. */
export function pageTitle(page: Page): string {
  return PAGE_TITLES[page] ?? 'FlyttGo';
}
