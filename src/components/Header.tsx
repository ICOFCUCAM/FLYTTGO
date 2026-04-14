import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { useApp, Page } from '../lib/store';
import { LogIn, Bell, User as UserIcon } from 'lucide-react';

const T = {
  EN: {
    home: 'Home', services: 'Services', movingTools: 'Moving Tools', pricing: 'Pricing',
    cities: 'Cities', becomeDriver: 'Become a Driver', companies: 'Companies',
    vanCalc: 'Van Calculator', bookNow: 'Book Now', signIn: 'Sign In',
    dashboard: 'Dashboard', myBookings: 'My Bookings', driverPortal: 'Driver Portal',
    adminDash: 'Admin Dashboard', signOut: 'Sign Out', tagline: 'Smart Moving & Transport Services',
    corporate: 'Corporate Logistics Portal', createCorp: 'Create Corporate Account →',
    profile: 'Profile',
  },
  NO: {
    home: 'Hjem', services: 'Tjenester', movingTools: 'Verktøy', pricing: 'Priser',
    cities: 'Byer', becomeDriver: 'Bli sjåfør', companies: 'Bedrifter',
    vanCalc: 'Bilkalkulator', bookNow: 'Bestill nå', signIn: 'Logg inn',
    dashboard: 'Kontrollpanel', myBookings: 'Mine bestillinger', driverPortal: 'Sjåførportal',
    adminDash: 'Admin-panel', signOut: 'Logg ut', tagline: 'Smart moving og transporttjenester',
    corporate: 'Bedriftslogistikkportal', createCorp: 'Opprett bedriftskonto →',
    profile: 'Profil',
  },
} as const;
type Lang = 'EN' | 'NO';
const LANG_STORAGE_KEY = 'flyttgo_lang';

const SERVICES = [
  { label: 'Furniture Moving',   icon: '🛋️', page: 'services' as Page },
  { label: 'House Moving',       icon: '🏠', page: 'services' as Page },
  { label: 'Appliance Delivery', icon: '🔌', page: 'services' as Page },
  { label: 'Cargo Transport',    icon: '📦', page: 'services' as Page },
  { label: 'Store Delivery',     icon: '🏪', page: 'services' as Page },
  { label: 'Business Logistics', icon: '🏢', page: 'corporate' as Page },
];

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

function readStoredLang(): Lang {
  if (typeof window === 'undefined') return 'EN';
  const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
  return stored === 'NO' ? 'NO' : 'EN';
}

export default function Header() {
  const { profile, signOut, user } = useAuth();
  const { setPage, currentPage, setShowAuthModal, setAuthMode } = useApp();
  const [mobileOpen,    setMobileOpen]    = useState(false);
  const [servicesOpen,  setServicesOpen]  = useState(false);
  const [toolsOpen,     setToolsOpen]     = useState(false);
  const [companiesOpen, setCompaniesOpen] = useState(false);
  const [langOpen,      setLangOpen]      = useState(false);
  const [userMenuOpen,  setUserMenuOpen]  = useState(false);
  const [notifOpen,     setNotifOpen]     = useState(false);
  const [lang,          setLang]          = useState<Lang>(readStoredLang);
  const [scrolled,      setScrolled]      = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const langRef   = useRef<HTMLDivElement>(null);
  const t = T[lang];

  // Scroll-aware top strip (shrinks after 40px)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Outside-click closes all open dropdowns
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) closeAll();
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function closeAll() {
    setServicesOpen(false); setToolsOpen(false);
    setCompaniesOpen(false); setUserMenuOpen(false);
    setNotifOpen(false);
  }

  function toggle(which: 'services' | 'tools' | 'companies' | 'user' | 'notif') {
    setServicesOpen(which === 'services'  ? (s) => !s : false);
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
    setLang(l);
    setLangOpen(false);
    if (typeof window !== 'undefined') window.localStorage.setItem(LANG_STORAGE_KEY, l);
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
    which: 'services' | 'tools' | 'companies' | 'user',
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
              <span className="text-white/70 hidden sm:block">{t.tagline}</span>
            </div>
            <div className="relative" ref={langRef}>
              <button onClick={() => setLangOpen((o) => !o)} className="flex items-center gap-1 text-white/70 hover:text-white transition text-xs">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064"/>
                </svg>
                {lang === 'EN' ? '🇬🇧 EN' : '🇳🇴 NO'}
                {chevron(langOpen)}
              </button>
              {langOpen && (
                <div className="absolute right-0 top-full mt-2 w-32 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
                  {(['EN', 'NO'] as Lang[]).map((l) => (
                    <button key={l} onClick={() => chooseLang(l)}
                      className={`w-full text-left px-4 py-2 text-sm transition ${lang === l ? 'text-emerald-600 font-semibold bg-emerald-50' : 'text-gray-700 hover:bg-gray-50'}`}>
                      {l === 'EN' ? '🇬🇧 English' : '🇳🇴 Norsk'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
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
              {navBtn(t.home, 'home')}

              {/* Services */}
              {dropdown(servicesOpen, t.services, 'services', (
                <div className="w-52 py-2">
                  {SERVICES.map((s) => (
                    <button key={s.label} onClick={() => handleNav(s.page)}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition flex items-center gap-3">
                      <span>{s.icon}</span>{s.label}
                    </button>
                  ))}
                </div>
              ))}

              {/* Moving Tools */}
              {dropdown(toolsOpen, t.movingTools, 'tools', (
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

              <button onClick={() => handleNav('driver-onboarding')} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition">{t.becomeDriver}</button>

              {/* Companies */}
              {dropdown(companiesOpen, t.companies, 'companies', (
                <div className="w-80 py-3">
                  <div className="px-4 pb-2 border-b border-gray-100 mb-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t.corporate}</p>
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
                    <button onClick={() => handleNav('corporate')} className="w-full py-2.5 bg-[#1A365D] text-white rounded-xl text-sm font-semibold hover:bg-[#2D4A7A] transition">{t.createCorp}</button>
                  </div>
                </div>
              ), true)}
            </nav>

            {/* Right side */}
            <div className="flex items-center gap-2">
              <button onClick={() => handleNav('booking')} className="hidden sm:flex items-center gap-1.5 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition shadow-sm">{t.bookNow}</button>

              {/* Notifications bell — signed-in only */}
              {user && profile && (
                <div className="relative">
                  <button
                    onClick={() => toggle('notif')}
                    className="p-2 rounded-lg hover:bg-gray-100 transition relative"
                    aria-label="Notifications"
                  >
                    <Bell className="w-5 h-5 text-gray-600" />
                  </button>
                  {notifOpen && (
                    <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-gray-900">Notifications</h3>
                      </div>
                      <div className="py-10 px-4 text-center">
                        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                          <Bell className="w-5 h-5 text-gray-400" />
                        </div>
                        <p className="text-sm text-gray-500">You&apos;re all caught up</p>
                        <p className="text-xs text-gray-400 mt-1">New booking updates will appear here.</p>
                      </div>
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
                        {t.profile}
                      </button>
                      {profile.role === 'customer' && (<>
                        <button onClick={() => handleNav('customer-dashboard')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition">{t.dashboard}</button>
                        <button onClick={() => handleNav('my-bookings')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition">{t.myBookings}</button>
                      </>)}
                      {profile.role === 'driver' && (
                        <button onClick={() => handleNav('driver-portal')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition">{t.driverPortal}</button>
                      )}
                      {profile.role === 'admin' && (
                        <button onClick={() => handleNav('admin')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition">{t.adminDash}</button>
                      )}
                      <hr className="my-1 border-gray-100"/>
                      <button onClick={() => { signOut(); setPage('home'); closeAll(); }} className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition font-medium">{t.signOut}</button>
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
                    {t.signIn}
                  </button>
                  <button
                    onClick={openSignUp}
                    className="hidden sm:flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-cyan-500 to-purple-500 text-white rounded-lg text-sm font-semibold hover:from-cyan-600 hover:to-purple-600 transition shadow-sm"
                  >
                    Sign Up
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
              [t.home, 'home'], [t.services, 'services'], [t.becomeDriver, 'driver-onboarding'],
              [t.companies, 'corporate'], ['Moving Checklist', 'checklist'],
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
                  {t.signIn}
                </button>
                <button
                  onClick={openSignUp}
                  className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-purple-500 text-white rounded-lg text-sm font-semibold mt-1"
                >
                  Sign Up
                </button>
              </>
            )}
            <button onClick={() => handleNav('booking')} className="block w-full py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold text-center mt-1">{t.bookNow}</button>
          </div>
        </div>
      </div>

    </header>
    </>
  );
}
