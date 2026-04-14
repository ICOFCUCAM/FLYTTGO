
import React, { createContext, useContext, useState, ReactNode } from 'react';

export type Page =
  | 'home' | 'booking' | 'subscriptions' | 'customer-dashboard'
  | 'driver-portal' | 'admin' | 'my-bookings' | 'van-guide'
  | 'checklist' | 'driver-onboarding' | 'terms' | 'privacy'
  | 'liability' | 'driver-terms' | 'services' | 'corporate'
  | 'bulk-booking' | 'recurring-deliveries' | 'company-dashboard-info'
  | 'invoice-billing' | 'corporate-api-access' | 'corporate-dashboard'
  | 'profile';

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
  const [currentPage, setPage] = useState<Page>('home');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'driver-signup'>('signin');
  const [bookingData, setBookingDataState] = useState<BookingData>(defaultBooking);

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
