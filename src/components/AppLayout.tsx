import React, { Suspense, lazy, useEffect } from 'react';
import { useApp } from '../lib/store';
import Header from './Header';
import { useWhiteLabel } from '../lib/whiteLabelContext';
import { ownBooking as ownCompanyBooking } from '../lib/whiteLabel';
import { BrandFooter, BrandHeader } from './whiteLabel/BrandFrame';
import AuthModal from './AuthModal';
import { isEmbedded, useEmbedResize } from '../lib/embed';
import { isTransportHost } from '../lib/hosts';

const HomePage           = lazy(() => import('./HomePage'));
const PlatformHomePage   = lazy(() => import('./PlatformHomePage'));
const HomeV2Page         = lazy(() => import('./homeV2/HomeV2Page'));
const DesignLab          = lazy(() => import('./homeV2/lab/DesignLab'));
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
const AcceptInvitationPage = lazy(() => import('../pages/AcceptInvitationPage'));
const WhiteLabelPlansPage  = lazy(() => import('../pages/WhiteLabelPlansPage'));
const WhiteLabelDpaPage    = lazy(() => import('../pages/WhiteLabelDpaPage'));
const BrandSitePage        = lazy(() => import('../pages/BrandSitePage'));
const EmbedPage            = lazy(() => import('../pages/EmbedPage'));
const ServiceBookingPage   = lazy(() => import('../pages/ServiceBookingPage'));
const MyServicesPage       = lazy(() => import('../pages/MyServicesPage'));
const ShopPage             = lazy(() => import('../pages/ShopPage'));
const AccountingPage       = lazy(() => import('../pages/AccountingPage'));
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
  /* On a company's white-label page its own header and footer replace
   * FlyttGo's (the booking flow keeps working as usual underneath). */
  const { site } = useWhiteLabel();
  const branded = !!site && ['brand-site', 'booking', 'shop', 'payment', 'my-bookings', 'my-services', 'tracking', 'auth-callback', 'terms', 'privacy'].includes(currentPage);
  /* A company outside moving books its own jobs, appointments, tables or
   * rooms, not moves; a page with only a shop sends "book" to the shop (00020). */
  const ownBooking = !!site && ownCompanyBooking(site.booking);
  const shopOnly = !!site && site.booking === 'none' && !!site.shop;
  /* In the booking widget's frame on the company's own website (src/lib/embed.ts):
   * no header or footer, and the frame follows the page's height. */
  const embedded = currentPage === 'embed' || isEmbedded();
  useEmbedResize(embedded && currentPage !== 'embed');

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
  /* flyttgo.no shows the platform front page; transport.flyttgo.no the
   * moving and transport one (docs/HOMEPAGES.md). Both have FlyttGo's menu bar
   * (on the platform page with its Platform dropdown and square corners) and footer. */
  const platformHome = currentPage === 'home' && !isTransportHost(window.location.hostname);
  const showHeader = currentPage !== 'auth-callback' && currentPage !== 'home-lab' && !embedded;
  const showFooter = !embedded && (!['booking', 'driver-portal', 'admin', 'auth-callback', 'home-lab'].includes(currentPage) || (currentPage === 'booking' && (ownBooking || shopOnly)));

  const renderPage = () => {
    switch (currentPage) {
      /* flyttgo.no: the platform's front page; transport.flyttgo.no and
       * /transport: the moving and transport front page (docs/HOMEPAGES.md). */
      case 'home':             return platformHome ? <PlatformHomePage /> : <HomePage />;
      case 'transport-home':   return <HomePage />;
      /* The restructured homepage under review (docs/HOMEPAGE_RESTRUCTURE.md). */
      case 'home-preview':     return <HomeV2Page />;
      /* The private design lab for the preview (never on production hosts; docs/HOMEPAGE_RESTRUCTURE.md). */
      case 'home-lab':         return <DesignLab />;
      case 'booking':          return ownBooking ? <ServiceBookingPage /> : shopOnly ? <ShopPage /> : <BookingFlow />;
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
      case 'accept-invitation':      return <AcceptInvitationPage />;
      case 'white-label':            return <WhiteLabelPlansPage />;
      case 'white-label-dpa':        return <WhiteLabelDpaPage />;
      case 'brand-site':             return <BrandSitePage />;
      case 'embed':                  return <EmbedPage />;
      case 'my-services':            return <MyServicesPage />;
      case 'shop':                   return <ShopPage />;
      case 'accounting':             return <AccountingPage />;
      case 'not-found':              return <NotFoundPage />;
      default:                       return <NotFoundPage />;
    }
  };

  return (
    <div className={embedded ? 'bg-white' : 'min-h-screen bg-white'}>
      {showHeader && (branded && site ? <BrandHeader site={site} /> : <Header />)}
      <AuthModal />
      <Suspense fallback={<Loading />}>
        {renderPage()}
      </Suspense>
      {showFooter && currentPage !== 'brand-site' && (branded && site ? <BrandFooter site={site} /> : (
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
      ))}
      {currentPage === 'brand-site' && site && !site.page && !embedded && <BrandFooter site={site} />}
    </div>
  );
}
