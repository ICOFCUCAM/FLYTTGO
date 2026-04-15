import React, { Suspense, lazy, useEffect } from 'react';
import { useApp } from '../lib/store';
import Header from './Header';
import AuthModal from './AuthModal';

const HomePage           = lazy(() => import('./HomePage'));
const BookingFlow        = lazy(() => import('./BookingFlow'));
const DriverPortal       = lazy(() => import('./DriverPortal'));
const DriverOnboarding   = lazy(() => import('./DriverOnboarding'));
const MovingChecklist    = lazy(() => import('./MovingChecklist'));
const SubscriptionPlans  = lazy(() => import('./SubscriptionPlans'));
const VanGuide           = lazy(() => import('./VanGuide'));
const CustomerDashboard  = lazy(() => import('./CustomerDashboard'));
const MyBookings         = lazy(() => import('./MyBookings'));
const AdminDashboard     = lazy(() => import('./AdminDashboard'));
const TermsPage          = lazy(() => import('../pages/TermsPage'));
const PrivacyPage        = lazy(() => import('../pages/PrivacyPage'));
const LiabilityPage      = lazy(() => import('../pages/LiabilityPage'));
const DriverTermsPage    = lazy(() => import('../pages/DriverTermsPage'));
const ServicesPage       = lazy(() => import('../pages/ServicesPage'));
const CorporatePage             = lazy(() => import('../pages/CorporatePage'));
const CorporateDashboard        = lazy(() => import('../pages/CorporateDashboard'));
const CorporateBulkBookingPage  = lazy(() => import('../pages/CorporateBulkBookingPage'));
const RecurringDeliveriesPage   = lazy(() => import('../pages/RecurringDeliveriesPage'));
const CompanyDashboardInfoPage  = lazy(() => import('../pages/CompanyDashboardInfoPage'));
const InvoiceBillingPage        = lazy(() => import('../pages/InvoiceBillingPage'));
const CorporateApiAccessPage    = lazy(() => import('../pages/CorporateApiAccessPage'));
const ProfilePage        = lazy(() => import('../pages/ProfilePage'));
const AboutUsPage        = lazy(() => import('../pages/AboutUsPage'));
const ContactPage        = lazy(() => import('../pages/ContactPage'));
const FaqPage            = lazy(() => import('../pages/FaqPage'));
const HelpCenterPage     = lazy(() => import('../pages/HelpCenterPage'));
const SafetyPage         = lazy(() => import('../pages/SafetyPage'));
const CareersPage        = lazy(() => import('../pages/CareersPage'));
const PressPage          = lazy(() => import('../pages/PressPage'));
const SustainabilityPage = lazy(() => import('../pages/SustainabilityPage'));
const TrackingPage       = lazy(() => import('../pages/TrackingPage'));
const PaymentPage        = lazy(() => import('../pages/PaymentPage'));
const AuthCallbackPage   = lazy(() => import('../pages/auth/callback'));
const DriverApplicationStatusPage = lazy(() => import('../pages/DriverApplicationStatusPage'));
const NotFoundPage       = lazy(() => import('../pages/NotFoundPage'));
const Footer             = lazy(() => import('./Footer'));

function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function AppLayout() {
  const { currentPage } = useApp();

  /* Scroll to the top of the viewport whenever the current page
   * changes. Without this, clicking a link from deep down the page
   * (e.g. anything in the footer) renders the new page but leaves
   * the scroll position where it was, so the customer lands on the
   * bottom of the new page instead of its hero. */
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [currentPage]);

  const legalPages = ['terms', 'privacy', 'liability', 'driver-terms'];
  /* The auth callback page is a transient, full-screen landing surface
   * for Supabase email-confirmation / OAuth redirects — chrome would
   * just be visual noise during the ~100 ms session handoff. */
  const showHeader = currentPage !== 'auth-callback';
  const showFooter = !['booking', 'driver-portal', 'admin', 'auth-callback'].includes(currentPage);

  const renderPage = () => {
    switch (currentPage) {
      case 'home':             return <HomePage />;
      case 'booking':          return <BookingFlow />;
      case 'driver-portal':    return <DriverPortal />;
      case 'driver-onboarding':return <DriverOnboarding />;
      case 'checklist':        return <MovingChecklist />;
      case 'subscriptions':    return <SubscriptionPlans />;
      case 'van-guide':           return <VanGuide />;
      case 'customer-dashboard':  return <CustomerDashboard />;
      case 'my-bookings':         return <MyBookings />;
      case 'admin':               return <AdminDashboard />;
      case 'terms':               return <TermsPage />;
      case 'privacy':          return <PrivacyPage />;
      case 'liability':        return <LiabilityPage />;
      case 'driver-terms':     return <DriverTermsPage />;
      case 'services':          return <ServicesPage />;
      case 'corporate':              return <CorporatePage />;
      case 'corporate-dashboard':    return <CorporateDashboard />;
      case 'bulk-booking':           return <CorporateBulkBookingPage />;
      case 'recurring-deliveries':   return <RecurringDeliveriesPage />;
      case 'company-dashboard-info': return <CompanyDashboardInfoPage />;
      case 'invoice-billing':        return <InvoiceBillingPage />;
      case 'corporate-api-access':   return <CorporateApiAccessPage />;
      case 'profile':                return <ProfilePage />;
      case 'about':                  return <AboutUsPage />;
      case 'contact':                return <ContactPage />;
      case 'faq':                    return <FaqPage />;
      case 'help':                   return <HelpCenterPage />;
      case 'safety':                 return <SafetyPage />;
      case 'careers':                return <CareersPage />;
      case 'press':                  return <PressPage />;
      case 'sustainability':         return <SustainabilityPage />;
      case 'tracking':               return <TrackingPage />;
      case 'payment':                return <PaymentPage />;
      case 'auth-callback':          return <AuthCallbackPage />;
      case 'driver-application-status': return <DriverApplicationStatusPage />;
      case 'not-found':              return <NotFoundPage />;
      default:                       return <NotFoundPage />;
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {showHeader && <Header />}
      <AuthModal />
      <Suspense fallback={<Loading />}>
        {renderPage()}
      </Suspense>
      {showFooter && (
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
      )}
    </div>
  );
}
