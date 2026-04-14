import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { LANG_STORAGE_KEY } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useApp, Page } from '../lib/store';
import { LogIn, Bell, User as UserIcon } from 'lucide-react';
import { useNotifications } from '../hooks/useNotifications';
import type { Page as PageType } from '../lib/store';

type Lang = 'en' | 'no';

const MOVING_TOOLS = [
  { label: 'Van Size Calculator', desc: 'Find the right van for your move', page: 'van-guide' as Page },
  { label: 'Moving Checklist',    desc: 'Step-by-step packing guide',       page: 'checklist' as Page },
  { label: 'Subscription Plans',  desc: 'Save with a driver subscription',  page: 'subscriptions' as Page },
];

const CORPORATE_LINKS = [
  { label: 'Bulk Booking Management', desc: 'Multi-location deliveries at scale',    page: 'bulk-booking' as Page },
  { label: 'Recurring Deliveries',    desc: 'Daily, weekly or monthly scheduling',   page: 'recurring-deliveries' as Page },
  { label: 'Company Dashboard Info',  desc: 'Track spending & delivery performance', page: 'company-dashboard-info' as Page },
  { label: 'Invoice & Billing',       desc: 'Consolidated monthly invoices',         page: 'invoice-billing' as Page },
  { label: 'Corporate API Access',    desc: 'Integrate FlyttGo into your systems',   page: 'corporate-api-access' as Page },
  { label: 'Corporate Dashboard',     desc: 'Enterprise logistics command center',   page: 'corporate-dashboard' as Page },
];

/* Tiny "5m ago" / "2h ago" / "3d ago" formatter for the notifications
 * dropdown. Avoids pulling in date-fns just for one string. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60)        return 'just now';
  if (diffSec < 3600)      return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400)    return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604_800)   return `${Math.floor(diffSec / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Header() {
  const { profile, signOut, user } = useAuth();
  const { setPage, currentPage, setShowAuthModal, setAuthMode } = useApp();
  const { t, i18n: i18nInstance } = useTranslation();
  const [mobileOpen,    setMobileOpen]    = useState(false);
  const [toolsOpen,     setToolsOpen]     = useState(false);
  const [companiesOpen, setCompaniesOpen] = useState(false);
  const [langOpen,      setLangOpen]      = useState(false);
  const [userMenuOpen,  setUserMenuOpen]  = useState(false);
  const [notifOpen,     setNotifOpen]     = useState(false);
  const [scrolled,      setScrolled]      = useState(false);
  const lang: Lang = (i18nInstance.language === 'no' ? 'no' : 'en');
  const headerRef = useRef<HTMLElement>(null);
  /* Two refs for the language switcher: the button lives inside the
   * scroll-collapsing top bar (overflow-hidden), while the popover is
   * rendered as a sibling of that bar so it escapes the clip. Outside
   * click detection has to check both nodes. */
  const langBtnRef = useRef<HTMLButtonElement>(null);
  const langPopRef = useRef<HTMLDivElement>(null);

  /* Real-time notifications for the bell icon. Returns an empty list
   * silently if the notifications table / RLS / publication aren't
   * applied yet (see docs/notifications-migration.sql). */
  const { notifications, unreadCount, markAllRead } = useNotifications(user?.id ?? null);

  // Scroll-aware top strip (shrinks after 40px)
  useEffect(() => {
    const onScroll = () => {
      const s = window.scrollY > 40;
      setScrolled(s);
      /* When the top bar collapses out of view, force-close any open
       * language dropdown so its popover doesn't hang in mid-air. */
      if (s) setLangOpen(false);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* Sync <html lang> with the active language whenever it changes. */
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang === 'no' ? 'nb-NO' : 'en';
    }
  }, [lang]);

  // Outside-click closes all open dropdowns
  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (headerRef.current && !headerRef.current.contains(target)) closeAll();
      const inLangBtn = langBtnRef.current?.contains(target) ?? false;
      const inLangPop = langPopRef.current?.contains(target) ?? false;
      if (!inLangBtn && !inLangPop) setLangOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function closeAll() {
    setToolsOpen(false);
    setCompaniesOpen(false); setUserMenuOpen(false);
    setNotifOpen(false);
  }

  function toggle(which: 'tools' | 'companies' | 'user' | 'notif') {
    setToolsOpen(which === 'tools'        ? (s) => !s : false);
    setCompaniesOpen(which === 'companies'? (s) => !s : false);
    setUserMenuOpen(which === 'user'      ? (s) => !s : false);
    setNotifOpen(which === 'notif'        ? (s) => !s : false);
  }

  function handleNav(page: Page) { setPage(page); setMobileOpen(false); closeAll(); }

  function openSignIn() {
    setAuthMode('signin');
    setShowAuthModal(true);
    setMobileOpen(false);
    closeAll();
  }

  function openSignUp() {
    setAuthMode('signup');
    setShowAuthModal(true);
    setMobileOpen(false);
    closeAll();
  }

  function chooseLang(l: Lang) {
    void i18n.changeLanguage(l);
    setLangOpen(false);
    if (typeof window !== 'undefined') window.localStorage.setItem(LANG_STORAGE_KEY, l);
    /* Sync <html lang="…"> for SEO + assistive tech */
    if (typeof document !== 'undefined') {
      document.documentElement.lang = l === 'no' ? 'nb-NO' : 'en';
    }
  }

  const chevron = (open: boolean) => (
    <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
    </svg>
  );

  const navBtn = (label: string, page: Page, onClick?: () => void) => (
    <button
      onClick={onClick ?? (() => handleNav(page))}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
        currentPage === page ? 'text-emerald-600 bg-emerald-50' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
      }`}
    >{label}</button>
  );

  const dropdown = (
    open: boolean,
    label: string,
    which: 'tools' | 'companies' | 'user',
    children: React.ReactNode,
    alignRight = false
  ) => (
    <div className="relative">
      <button
        onClick={() => toggle(which)}
        className={`flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition ${
          open ? 'text-emerald-600 bg-emerald-50' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
        }`}
      >{label}{chevron(open)}</button>
      {open && (
        <div className={`absolute top-full ${alignRight ? 'right-0' : 'left-0'} mt-2 bg-white rounded-2xl shadow-xl border border-gray-100 z-50`}>
          {children}
        </div>
      )}
    </div>
  );

  return (
    <>
    {/* Mobile menu backdrop — dims page beneath the header when menu is open */}
    {mobileOpen && (
      <div
        className="lg:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-30 transition-opacity"
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />
    )}
    <header ref={headerRef} className="sticky top-0 z-40 shadow-md">

      {/* Wrapper hosts the top bar AND the language popover as
       * siblings, so the popover escapes the top bar's overflow-hidden
       * clip. Relative so the popover can absolutely position itself
       * beneath the top bar. */}
      <div className="relative">
        {/* TOP BAR — collapses on scroll */}
        <div
          className={`bg-[#1A365D] text-white overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${
            scrolled ? 'max-h-0 opacity-0' : 'max-h-12 opacity-100'
          }`}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-9 text-xs">
              <div className="flex items-center gap-4">
                <a href="tel:+447432112438" className="flex items-center gap-1.5 text-white/80 hover:text-white transition">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
                  </svg>
                  +44 7432 112438
                </a>
                <span className="text-white/30 hidden sm:block">|</span>
                <span className="text-white/70 hidden sm:block">{t('header.tagline')}</span>
              </div>
              <button
                ref={langBtnRef}
                onClick={() => setLangOpen((o) => !o)}
                className="flex items-center gap-1 text-white/70 hover:text-white transition text-xs"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064"/>
                </svg>
                {lang === 'en' ? '🇬🇧 EN' : '🇳🇴 NO'}
                {chevron(langOpen)}
              </button>
            </div>
          </div>
        </div>

        {/* Language popover — sibling of the collapsing bar so
         * overflow-hidden can't clip it. We reuse the same
         * max-w-7xl padding layout to right-align against the
         * button on every viewport width. */}
        {langOpen && !scrolled && (
          <div ref={langPopRef} className="absolute inset-x-0 top-9 z-50 pointer-events-none">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-end">
              <div className="pointer-events-auto w-32 bg-white rounded-xl shadow-lg border border-gray-100 py-1 mt-1">
                {(['en', 'no'] as Lang[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => chooseLang(l)}
                    className={`w-full text-left px-4 py-2 text-sm transition ${
                      lang === l ? 'text-emerald-600 font-semibold bg-emerald-50' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {l === 'en' ? '🇬🇧 English' : '🇳🇴 Norsk'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MAIN NAV */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Logo */}
            <button onClick={() => handleNav('home')} className="flex items-center gap-2.5 flex-shrink-0">
              <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center shadow-sm">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2-1 2 1 2-1 2 1 2-1zm0 0l2 1 2-1 2 1V6a1 1 0 00-1-1h-4"/>
                </svg>
              </div>
              <span className="text-xl font-bold text-gray-900">Flytt<span className="text-emerald-600">Go</span></span>
            </button>

            {/* Desktop nav */}
            <nav className="hidden lg:flex items-center gap-0.5">
              {navBtn(t('header.home'), 'home')}
              {navBtn(t('header.services'), 'services')}

              {/* Moving Tools */}
              {dropdown(toolsOpen, t('header.movingTools'), 'tools', (
                <div className="w-64 py-2">
                  {MOVING_TOOLS.map((tool) => (
                    <button key={tool.label} onClick={() => handleNav(tool.page)}
                      className="w-full text-left px-4 py-3 hover:bg-emerald-50 transition group">
                      <div className="text-sm font-semibold text-gray-800 group-hover:text-emerald-700">{tool.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{tool.desc}</div>
                    </button>
                  ))}
                </div>
              ))}

              <button onClick={() => handleNav('driver-onboarding')} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition">{t('header.becomeDriver')}</button>

              {/* Companies */}
              {dropdown(companiesOpen, t('header.companies'), 'companies', (
                <div className="w-80 py-3">
                  <div className="px-4 pb-2 border-b border-gray-100 mb-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('header.corporate')}</p>
                  </div>
                  {CORPORATE_LINKS.map((link) => (
                    <button key={link.label} onClick={() => handleNav(link.page)}
                      className="w-full text-left px-4 py-3 hover:bg-emerald-50 transition group">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:bg-emerald-600 transition">
                          <svg className="w-4 h-4 text-emerald-600 group-hover:text-white transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5"/>
                          </svg>
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-800 group-hover:text-emerald-700">{link.label}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{link.desc}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                  <div className="px-4 pt-2 border-t border-gray-100 mt-2">
                    <button onClick={() => handleNav('corporate')} className="w-full py-2.5 bg-[#1A365D] text-white rounded-xl text-sm font-semibold hover:bg-[#2D4A7A] transition">{t('header.createCorp')}</button>
                  </div>
                </div>
              ), true)}
            </nav>

            {/* Right side */}
            <div className="flex items-center gap-2">
              <button onClick={() => handleNav('booking')} className="hidden sm:flex items-center gap-1.5 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition shadow-sm">{t('header.bookNow')}</button>

              {/* Notifications bell — signed-in only. Subscribes to
               * the notifications table over Supabase Realtime; flips
               * a red dot on the bell when there's anything unread. */}
              {user && profile && (
                <div className="relative">
                  <button
                    onClick={() => {
                      const willOpen = !notifOpen;
                      toggle('notif');
                      if (willOpen) markAllRead();
                    }}
                    className="p-2 rounded-lg hover:bg-gray-100 transition relative"
                    aria-label={unreadCount > 0 ? `${t('header.notifications')} (${unreadCount})` : t('header.notifications')}
                  >
                    <Bell className="w-5 h-5 text-gray-600" />
                    {unreadCount > 0 && (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
                    )}
                  </button>
                  {notifOpen && (
                    <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-gray-900">{t('header.notifications')}</h3>
                        {notifications.length > 0 && (
                          <span className="text-[10px] text-gray-400">{notifications.length} most recent</span>
                        )}
                      </div>
                      {notifications.length === 0 ? (
                        <div className="py-10 px-4 text-center">
                          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                            <Bell className="w-5 h-5 text-gray-400" />
                          </div>
                          <p className="text-sm text-gray-500">{t('header.notificationsEmpty')}</p>
                          <p className="text-xs text-gray-400 mt-1">{t('header.notificationsHint')}</p>
                        </div>
                      ) : (
                        <ul className="max-h-96 overflow-y-auto divide-y divide-gray-100">
                          {notifications.map((n) => (
                            <li key={n.id}>
                              <button
                                onClick={() => {
                                  if (n.link_page) handleNav(n.link_page as PageType);
                                  else closeAll();
                                }}
                                className="w-full text-left px-4 py-3 hover:bg-gray-50 transition flex items-start gap-3"
                              >
                                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${n.read_at ? 'bg-transparent' : 'bg-emerald-500'}`} />
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold text-gray-900 truncate">{n.title}</div>
                                  {n.body && <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</div>}
                                  <div className="text-[10px] text-gray-400 mt-1">{relativeTime(n.created_at)}</div>
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              {user && profile ? (
                <div className="relative">
                  <button onClick={() => toggle('user')} className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-gray-50 transition">
                    <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-700 font-semibold text-sm flex-shrink-0">
                      {(profile.first_name?.[0] || 'U').toUpperCase()}
                    </div>
                    <span className="hidden sm:block text-sm font-medium text-gray-700">
                      {profile.role === 'admin' ? 'FLYTTGO' : profile.first_name || 'User'}
                    </span>
                    {chevron(userMenuOpen)}
                  </button>
                  {userMenuOpen && (
                    <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50">
                      <div className="px-4 py-3 border-b border-gray-100">
                        <p className="text-sm font-bold text-gray-900 truncate">
                          {profile.role === 'admin' ? 'FLYTTGO Dashboard' : `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'User'}
                        </p>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{profile.email}</p>
                        <span className="inline-block mt-1.5 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-semibold rounded uppercase tracking-wide">
                          {profile.role}
                        </span>
                      </div>
                      <button onClick={() => handleNav('profile')} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition">
                        <UserIcon className="w-4 h-4 text-gray-500" />
                        {t('header.profile')}
                      </button>
                      {profile.role === 'customer' && (<>
                        <button onClick={() => handleNav('customer-dashboard')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition">{t('header.dashboard')}</button>
                        <button onClick={() => handleNav('my-bookings')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition">{t('header.myBookings')}</button>
                      </>)}
                      {profile.role === 'driver' && (
                        <button onClick={() => handleNav('driver-portal')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition">{t('header.driverPortal')}</button>
                      )}
                      {profile.role === 'admin' && (
                        <button onClick={() => handleNav('admin')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition">{t('header.adminDash')}</button>
                      )}
                      <hr className="my-1 border-gray-100"/>
                      <button onClick={() => { signOut(); setPage('home'); closeAll(); }} className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition font-medium">{t('header.signOut')}</button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <button
                    onClick={openSignIn}
                    className="hidden sm:flex items-center gap-1.5 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition shadow-sm"
                  >
                    <LogIn className="w-4 h-4" />
                    {t('header.signIn')}
                  </button>
                  <button
                    onClick={openSignUp}
                    className="hidden sm:flex items-center gap-1.5 px-4 py-2 border border-emerald-600 text-emerald-600 rounded-lg text-sm font-semibold hover:bg-emerald-50 transition shadow-sm"
                  >
                    {t('header.signUp')}
                  </button>
                </>
              )}

              <button onClick={() => setMobileOpen((o) => !o)} className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition">
                <svg className="w-6 h-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {mobileOpen
                    ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                    : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/>}
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* MOBILE MENU — slide down with dim backdrop */}
        <div
          className={`lg:hidden border-t border-gray-100 bg-white overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${
            mobileOpen ? 'max-h-[28rem] opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="max-w-7xl mx-auto px-4 pt-3 pb-4 space-y-1">
            {([
              [t('header.home'),         'home'],
              [t('header.services'),     'services'],
              [t('header.becomeDriver'), 'driver-onboarding'],
              [t('header.companies'),    'corporate'],
              ['Moving Checklist',       'checklist'],
            ] as [string, Page][]).map(([label, page]) => (
              <button key={page} onClick={() => handleNav(page)}
                className={`block w-full text-left px-4 py-2.5 text-sm font-medium rounded-lg ${currentPage === page ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
            {!user && (
              <>
                <button
                  onClick={openSignIn}
                  className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 mt-2"
                >
                  <LogIn className="w-4 h-4" />
                  {t('header.signIn')}
                </button>
                <button
                  onClick={openSignUp}
                  className="w-full py-2.5 border border-emerald-600 text-emerald-600 rounded-lg text-sm font-semibold mt-1 hover:bg-emerald-50 transition"
                >
                  {t('header.signUp')}
                </button>
              </>
            )}
            <button onClick={() => handleNav('booking')} className="block w-full py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold text-center mt-1">{t('header.bookNow')}</button>
          </div>
        </div>
      </div>

    </header>
    </>
  );
}
