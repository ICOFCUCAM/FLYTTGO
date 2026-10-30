/**
 * The old menu bar's functions, wired into the design's own header on the
 * platform front page (docs/HOMEPAGES.md; owner, 2026-10-30):
 *   - the EN/NO language switch;
 *   - once signed in: the notifications bell and the account menu (dashboard,
 *     driver portal or admin by role, bookings, jobs, profile, sign out) in
 *     place of the design's Sign in link;
 *   - the design's "Moving" and "Companies" items open the old Moving Tools
 *     and Companies menus.
 * Everything here uses the same translations, auth and notifications as the
 * site's Header.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import i18n, { LANG_STORAGE_KEY } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { useApp, type Page } from '../../lib/store';
import { useNotifications } from '../../hooks/useNotifications';

type MenuItem = { label: string; desc?: string; page?: Page; scroll?: string };

function chooseLang(l: 'en' | 'no') {
  void i18n.changeLanguage(l);
  try { window.localStorage.setItem(LANG_STORAGE_KEY, l); } catch { /* private mode */ }
}

/** A dropdown under an element of the design, closed by any click outside it. */
function Dropdown({ anchor, items, onPick, onClose }: {
  anchor: DOMRect; items: MenuItem[]; onPick: (item: MenuItem) => void; onClose: () => void;
}) {
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.fgp-dropdown')) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const t = window.setTimeout(() => document.addEventListener('click', close), 0);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', onClose, { passive: true });
    return () => { window.clearTimeout(t); document.removeEventListener('click', close); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', onClose); };
  }, [onClose]);
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 300));
  return createPortal(
    <div className="fgp-dropdown fixed z-[60] w-72 rounded-xl border border-gray-100 bg-white py-2 shadow-xl"
      style={{ top: anchor.bottom + 8, left }} role="menu">
      {items.map(item => (
        <button key={item.label} type="button" role="menuitem" onClick={() => onPick(item)}
          className="w-full text-left px-4 py-2.5 hover:bg-emerald-50 transition group">
          <div className="text-sm font-semibold text-gray-800 group-hover:text-emerald-700">{item.label}</div>
          {item.desc && <div className="text-xs text-gray-500 mt-0.5">{item.desc}</div>}
        </button>
      ))}
    </div>,
    document.body);
}

export default function HeaderExtras({ root }: { root: HTMLElement }) {
  const { t, i18n: { language } } = useTranslation();
  const { user, profile, signOut } = useAuth();
  const { setPage } = useApp();
  const { notifications, unreadCount, markAllRead } = useNotifications(user?.id ?? null);
  const [menu, setMenu] = useState<{ items: MenuItem[]; rect: DOMRect } | null>(null);

  const movingMenu: MenuItem[] = [
    { label: t('home.serviceMoving', 'Moving services'), scroll: '#moving-services' },
    { label: t('header.transport', 'Moving & transport'), page: 'transport-home' },
    { label: t('home.toolCalcTitle', 'Van Size Calculator'), desc: t('header.toolCalcDesc', 'Find the right van for your move'), page: 'van-guide' },
    { label: t('home.toolCheckTitle', 'Moving Checklist'), desc: t('header.toolCheckDesc', 'Step-by-step packing guide'), page: 'checklist' },
    { label: t('header.subPlans', 'Subscription Plans'), desc: t('header.subPlansDesc', 'Save with a driver subscription'), page: 'subscriptions' },
    { label: t('header.becomeDriver', 'Become a Driver'), page: 'driver-onboarding' },
    { label: t('header.bookNow', 'Book Now'), page: 'booking' },
  ];
  const companiesMenu: MenuItem[] = [
    { label: t('header.corporate', 'Corporate Logistics Portal'), page: 'corporate' },
    { label: t('home.corpBulk', 'Bulk Booking Management'), desc: t('home.corpBulkDesc', 'Multi-location deliveries at scale'), page: 'bulk-booking' },
    { label: t('home.corpRecurring', 'Recurring Deliveries'), desc: t('home.corpRecurringDesc', 'Daily, weekly or monthly scheduling'), page: 'recurring-deliveries' },
    { label: t('home.corpAnalytics', 'Company Dashboard Info'), desc: t('home.corpAnalyticsDesc', 'Track spending & delivery performance'), page: 'company-dashboard-info' },
    { label: t('home.corpInvoice', 'Invoice & Billing'), desc: t('home.corpInvoiceDesc', 'Consolidated monthly invoices'), page: 'invoice-billing' },
    { label: t('home.corpApi', 'Corporate API Access'), desc: t('home.corpApiDesc', 'Integrate FlyttGo into your systems'), page: 'corporate-api-access' },
    { label: t('header.createCorp', 'Create Corporate Account →'), page: 'corporate' },
  ];

  const pick = (item: MenuItem) => {
    setMenu(null);
    if (item.scroll) root.querySelector(item.scroll)?.scrollIntoView({ behavior: 'smooth' });
    else if (item.page) setPage(item.page);
  };

  /* The design's Moving and Companies items open their menus. */
  useEffect(() => {
    const moving = root.querySelector<HTMLElement>('#primary-navigation a[href="#moving-services"]');
    const companies = root.querySelector<HTMLElement>('#primary-navigation a[data-menu="companies"]');
    const open = (items: MenuItem[]) => (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ items, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
    };
    const onMoving = open(movingMenu);
    const onCompanies = open(companiesMenu);
    moving?.addEventListener('click', onMoving);
    companies?.addEventListener('click', onCompanies);
    for (const a of [moving, companies]) a?.setAttribute('aria-haspopup', 'menu');
    return () => { moving?.removeEventListener('click', onMoving); companies?.removeEventListener('click', onCompanies); };
    // The menus' labels follow the language; the anchors are found again then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, language]);

  /* Signed in, the account menu takes the place of the design's Sign in link. */
  useEffect(() => {
    const signIn = root.querySelector<HTMLElement>('[data-page="auth:signin"]');
    if (signIn) signIn.style.display = user ? 'none' : '';
  }, [root, user]);

  const role = profile?.role;
  const accountMenu: MenuItem[] = [
    ...(role === 'admin' ? [{ label: t('header.adminDash', 'Admin Dashboard'), page: 'admin' as Page }]
      : role === 'driver' ? [{ label: t('header.driverPortal', 'Driver Portal'), page: 'driver-portal' as Page }]
      : [{ label: t('header.dashboard', 'Dashboard'), page: 'customer-dashboard' as Page }]),
    { label: t('header.myBookings', 'My Bookings'), page: 'my-bookings' },
    { label: t('header.myServices', 'My jobs and appointments'), page: 'my-services' },
    { label: t('header.profile', 'Profile'), page: 'profile' },
  ];
  const name = role === 'admin' ? 'FLYTTGO' : profile?.first_name || t('header.dashboard', 'Dashboard');

  return (
    <span className="inline-flex items-center gap-3 font-sans">
      <span className="inline-flex rounded-full border border-gray-200 text-xs font-semibold overflow-hidden" role="group" aria-label="Language">
        {(['en', 'no'] as const).map(l => (
          <button key={l} type="button" onClick={() => chooseLang(l)} aria-pressed={language === l}
            className={`px-2.5 py-1 ${language === l ? 'bg-[#1A365D] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{l.toUpperCase()}</button>
        ))}
      </span>
      {user && (
        <>
          <button type="button" aria-label={t('header.notifications', 'Notifications')}
            onClick={e => { setMenu({ rect: e.currentTarget.getBoundingClientRect(), items: notifications.length
              ? notifications.slice(0, 6).map(n => ({ label: n.title, desc: n.body ?? undefined }))
              : [{ label: t('header.notificationsEmpty', "You're all caught up"), desc: t('header.notificationsHint', 'New booking updates will appear here.') }] }); void markAllRead(); }}
            className="relative p-1.5 text-gray-600 hover:text-[#1A365D]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 11-6 0"/></svg>
            {unreadCount > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-emerald-600 text-white text-[10px] leading-4 text-center">{unreadCount}</span>}
          </button>
          <button type="button" onClick={e => setMenu({ rect: e.currentTarget.getBoundingClientRect(), items: [...accountMenu, { label: t('header.signOut', 'Sign Out'), page: undefined }] })}
            className="text-sm font-semibold text-[#1A365D] hover:text-emerald-700" aria-haspopup="menu">{name} ▾</button>
        </>
      )}
      {menu && <Dropdown anchor={menu.rect} items={menu.items} onClose={() => setMenu(null)}
        onPick={item => {
          if (item.label === t('header.signOut', 'Sign Out') && !item.page) { setMenu(null); void signOut().then(() => setPage('home')); return; }
          pick(item);
        }} />}
    </span>
  );
}
