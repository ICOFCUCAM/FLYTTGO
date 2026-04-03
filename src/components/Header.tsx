import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { useApp, Page } from '../lib/store';

const T = {
  EN: {
    home: 'Home', services: 'Services', movingTools: 'Moving Tools', pricing: 'Pricing',
    cities: 'Cities', becomeDriver: 'Become a Driver', companies: 'Companies',
    vanCalc: 'Van Calculator', bookNow: 'Book Now', signIn: 'Sign In',
    dashboard: 'Dashboard', myBookings: 'My Bookings', driverPortal: 'Driver Portal',
    adminDash: 'Admin Dashboard', signOut: 'Sign Out', tagline: 'Smart Moving & Transport Services',
    corporate: 'Corporate Logistics Portal', createCorp: 'Create Corporate Account →',
  },
  NO: {
    home: 'Hjem', services: 'Tjenester', movingTools: 'Verktøy', pricing: 'Priser',
    cities: 'Byer', becomeDriver: 'Bli sjåfør', companies: 'Bedrifter',
    vanCalc: 'Bilkalkulator', bookNow: 'Bestill nå', signIn: 'Logg inn',
    dashboard: 'Kontrollpanel', myBookings: 'Mine bestillinger', driverPortal: 'Sjåførportal',
    adminDash: 'Admin-panel', signOut: 'Logg ut', tagline: 'Smart moving og transporttjenester',
    corporate: 'Bedriftslogistikkportal', createCorp: 'Opprett bedriftskonto →',
  },
} as const;
type Lang = 'EN' | 'NO';

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
  { label: 'Corporate API Access',    desc: 'Integrate FlyttGo into your systems',  page: 'corporate-api-access' as Page },
  { label: 'Corporate Dashboard',     desc: 'Enterprise logistics command center',   page: 'corporate-dashboard' as Page },
];

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

export default function Header() {
  const { profile, signOut, user } = useAuth();
  const { setPage, currentPage } = useApp();
  const [mobileOpen,    setMobileOpen]    = useState(false);
  const [servicesOpen,  setServicesOpen]  = useState(false);
  const [toolsOpen,     setToolsOpen]     = useState(false);
  const [companiesOpen, setCompaniesOpen] = useState(false);
  const [langOpen,      setLangOpen]      = useState(false);
  const [userMenuOpen,  setUserMenuOpen]  = useState(false);
  const [lang,          setLang]          = useState<Lang>('EN');
  const headerRef = useRef<HTMLDivElement>(null);
  const langRef   = useRef<HTMLDivElement>(null);
  const t = T[lang];

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
  }

  function toggle(which: 'services' | 'tools' | 'companies' | 'user') {
    setServicesOpen(which === 'services' ? (s) => !s : false);
    setToolsOpen(which === 'tools' ? (s) => !s : false);
    setCompaniesOpen(which === 'companies' ? (s) => !s : false);
    setUserMenuOpen(which === 'user' ? (s) => !s : false);
  }

  function handleNav(page: Page) { setPage(page); setMobileOpen(false); closeAll(); }

  async function handleGoogleSignIn() {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
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
    <header ref={headerRef} className="sticky top-0 z-40 shadow-md">

      {/* TOP BAR */}
      <div className="bg-[#1A365D] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-9 text-xs">
            <div className="flex items-center gap-4">
              <a href="tel:+4474321124438" className="flex items-center gap-1.5 text-white/80 hover:text-white transition">
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
                    <button key={l} onClick={() => { setLang(l); setLangOpen(false); }}
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

              <button onClick={() => handleNav('home')} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition">{t.pricing}</button>
              <button onClick={() => handleNav('home')} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition">{t.cities}</button>
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
              <button onClick={() => handleNav('van-guide')} className="hidden xl:flex items-center gap-1.5 px-4 py-2 border border-emerald-600 text-emerald-600 rounded-lg text-sm font-semibold hover:bg-emerald-50 transition">{t.vanCalc}</button>
              <button onClick={() => handleNav('booking')} className="hidden sm:flex items-center gap-1.5 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition shadow-sm">{t.bookNow}</button>

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
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50">
                      <div className="px-4 py-3 border-b border-gray-100">
                        <p className="text-sm font-bold text-gray-900">
                          {profile.role === 'admin' ? 'FLYTTGO Dashboard' : `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'User'}
                        </p>
                        <p className="text-xs text-gray-500 capitalize mt-0.5">{profile.role}</p>
                      </div>
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
                <button onClick={handleGoogleSignIn}
                  className="hidden sm:flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition shadow-sm">
                  <GoogleIcon/>{t.signIn} with Google
                </button>
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

        {/* MOBILE MENU */}
        {mobileOpen && (
          <div className="lg:hidden border-t border-gray-100 bg-white pb-4">
            <div className="max-w-7xl mx-auto px-4 pt-3 space-y-1">
              {([
                [t.home, 'home'], [t.services, 'services'], [t.becomeDriver, 'driver-onboarding'],
                [t.companies, 'corporate'], [t.vanCalc, 'van-guide'], ['Moving Checklist', 'checklist'],
              ] as [string, Page][]).map(([label, page]) => (
                <button key={page} onClick={() => handleNav(page)}
                  className={`block w-full text-left px-4 py-2.5 text-sm font-medium rounded-lg ${currentPage === page ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-gray-50'}`}>
                  {label}
                </button>
              ))}
              {!user && (
                <button onClick={handleGoogleSignIn} className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 mt-2">
                  <GoogleIcon/>{t.signIn} with Google
                </button>
              )}
              <button onClick={() => handleNav('booking')} className="block w-full py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold text-center mt-1">{t.bookNow}</button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
