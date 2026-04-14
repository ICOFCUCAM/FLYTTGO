
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { pageToPath, pathToPage, applyPageMeta } from './pageRoutes';

export type Page =
  | 'home' | 'booking' | 'subscriptions' | 'customer-dashboard'
  | 'driver-portal' | 'admin' | 'my-bookings' | 'van-guide'
  | 'checklist' | 'driver-onboarding' | 'terms' | 'privacy'
  | 'liability' | 'driver-terms' | 'services' | 'corporate'
  | 'bulk-booking' | 'recurring-deliveries' | 'company-dashboard-info'
  | 'invoice-billing' | 'corporate-api-access' | 'corporate-dashboard'
  | 'profile'
  /* Informational / marketing pages referenced from the footer. */
  | 'about' | 'contact' | 'faq' | 'help' | 'safety'
  | 'careers' | 'press' | 'sustainability'
  /* Real-time delivery tracking + payment/escrow checkout. */
  | 'tracking' | 'payment'
  /* Fallback for URLs that don't match any known route. */
  | 'not-found';

interface AppState {
  currentPage: Page;
  setPage: (page: Page) => void;
  showAuthModal: boolean;
  setShowAuthModal: (show: boolean) => void;
  authMode: 'signin' | 'signup' | 'driver-signup';
  setAuthMode: (mode: 'signin' | 'signup' | 'driver-signup') => void;
  bookingData: BookingData;
  setBookingData: (data: Partial<BookingData>) => void;
  resetBooking: () => void;
}

/**
 * Structured Norwegian address — mirrors the shape returned by
 * NorwayAddressAutocomplete.onSelect (Kartverket lookup). When the
 * homepage Booking Widget produces one of these, we stash it in
 * BookingData so BookingFlow can pre-fill its address fields without
 * the customer having to re-enter anything.
 */
export interface NorwegianAddressData {
  street_name: string;
  house_number: string;
  postcode: string;
  city: string;
  country: 'Norway';
  lat: number | null;
  lng: number | null;
  formatted: string;
}

export interface BookingData {
  step: number;
  pickupAddress: string; pickupLat?: number | null; pickupLng?: number | null;
  pickupPostcode?: string; pickupCity?: string;
  pickupAddressData?: NorwegianAddressData;
  dropoffAddress: string; dropoffLat?: number | null; dropoffLng?: number | null;
  dropoffPostcode?: string; dropoffCity?: string;
  dropoffAddressData?: NorwegianAddressData;
  distanceKm?: number | null; durationMinutes?: number | null;
  moveType: string; propertyType: string; bedrooms: string;
  inventory: Record<string, number>; vanType: string; helpers: number;
  additionalServices: string[]; moveDate: string; moveTime: string;
  name: string; phone: string; email: string; notes: string;
  estimatedPrice: number; estimatedVolume: number;
}

const defaultBooking: BookingData = {
  step: 1, pickupAddress: '', pickupLat: null, pickupLng: null,
  pickupPostcode: '', pickupCity: '', dropoffAddress: '', dropoffLat: null,
  dropoffLng: null, dropoffPostcode: '', dropoffCity: '', distanceKm: null,
  durationMinutes: null, moveType: '', propertyType: '', bedrooms: '',
  inventory: {}, vanType: '', helpers: 0, additionalServices: [],
  moveDate: '', moveTime: '', name: '', phone: '', email: '', notes: '',
  estimatedPrice: 0, estimatedVolume: 0,
};

const AppContext = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  /* Seed the page state from the URL so deep links / browser refresh
   * / share links open the right view instead of always booting to
   * the home page. SSR-safe: falls back to 'home' outside the
   * browser. */
  const initialPage: Page =
    typeof window !== 'undefined' ? pathToPage(window.location.pathname) : 'home';

  const [currentPage, setCurrentPage] = useState<Page>(initialPage);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'driver-signup'>('signin');
  const [bookingData, setBookingDataState] = useState<BookingData>(defaultBooking);

  /* setPage acts as a navigation call: it updates the in-memory
   * page state AND pushes a history entry so the URL changes, the
   * back button works, and the page is shareable. Components don't
   * have to know anything about routing — they still call setPage. */
  const setPage = useCallback((page: Page) => {
    setCurrentPage(page);
    if (typeof window !== 'undefined') {
      /* Don't rewrite the URL when showing the 404 page — the user's
       * original URL should stay in the address bar so they can copy
       * it into a bug report and so a refresh hits the same path. */
      if (page === 'not-found') return;
      const path = pageToPath(page);
      if (window.location.pathname !== path) {
        window.history.pushState({ page }, '', path);
      }
    }
  }, []);

  /* Back / forward button handling — sync our page state from the
   * URL that the browser navigates to. We never pushState from here
   * to avoid feedback loops. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => setCurrentPage(pathToPage(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /* Keep SEO meta (<title>, meta description, canonical link,
   * OpenGraph and Twitter cards) in sync with the current page so
   * browser tabs, link previews on Slack/WhatsApp/LinkedIn, and
   * search-engine snippets all pick up the right copy per route. */
  useEffect(() => {
    applyPageMeta(currentPage);
  }, [currentPage]);

  const setBookingData = (data: Partial<BookingData>) => {
    setBookingDataState(prev => ({ ...prev, ...data }));
  };

  const resetBooking = () => setBookingDataState(defaultBooking);

  return (
    <AppContext.Provider
      value={{
        currentPage,
        setPage,
        showAuthModal,
        setShowAuthModal,
        authMode,
        setAuthMode,
        bookingData,
        setBookingData,
        resetBooking,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
