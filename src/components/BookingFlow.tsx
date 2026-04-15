import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { useApp } from '../lib/store';
import { supabase } from '../lib/supabase';
import { VAN_TYPES, INVENTORY_ITEMS, PROPERTY_PRESETS, calculatePrice, recommendVan } from '../lib/constants';
import NorwayAddressAutocomplete, { NorwegianAddress } from './NorwayAddressAutocomplete';
import { formatNorwegianAddress, validateNorwegianAddress } from '../utils/formatNorwegianAddress';
import { fetchServerPrice, ServerPriceResult } from '../lib/calculatePrice';
import { getRouteDistance, RouteResult } from '../lib/routing';
import { CustomerLegalAcceptance } from './LegalAcceptance';

/* ─────────────────────────────────────────────
   TYPES
───────────────────────────────────────────── */

interface StructuredAddress {
  street_name: string;
  house_number: string;
  postcode: string;
  city: string;
  country: 'Norway';
  lat: number | null;
  lng: number | null;
  formatted: string;
}

const emptyAddress = (): StructuredAddress => ({
  street_name: '',
  house_number: '',
  postcode: '',
  city: '',
  country: 'Norway',
  lat: null,
  lng: null,
  formatted: '',
});

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */

function safeNum(v: any): number {
  const n = Number(v ?? 0);
  return isNaN(n) ? 0 : n;
}

/* ─────────────────────────────────────────────
   BOOKING FLOW
───────────────────────────────────────────── */

export default function BookingFlow() {
  const { profile, user } = useAuth();
  const { bookingData, setBookingData, setPage, setShowAuthModal, setAuthMode } = useApp();
  const { t } = useTranslation();

  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 6;

  /* ── Structured addresses (replaces old string fields) ──
   * Pre-fill from bookingData if the home page Booking Widget already
   * captured a Norwegian address — that way customers don't have to
   * re-type it after clicking "Book Now" from the home page. */
  const [pickupAddress, setPickupAddress] = useState<StructuredAddress>(
    () => (bookingData.pickupAddressData as StructuredAddress | undefined) ?? emptyAddress()
  );
  const [dropoffAddress, setDropoffAddress] = useState<StructuredAddress>(
    () => (bookingData.dropoffAddressData as StructuredAddress | undefined) ?? emptyAddress()
  );

  /* ── Move details ── */
  const [moveType, setMoveType] = useState(bookingData.moveType || '');
  const [propertyType, setPropertyType] = useState(bookingData.propertyType || '');
  const [vanType, setVanType] = useState(bookingData.vanType || '');
  const [helpers, setHelpers] = useState(bookingData.helpers || 0);
  const [inventory, setInventory] = useState<Record<string, number>>(bookingData.inventory || {});
  const [additionalServices, setAdditionalServices] = useState<string[]>(bookingData.additionalServices || []);

  /* ── Schedule & contact ── */
  const [moveDate, setMoveDate] = useState(bookingData.moveDate || '');
  const [moveTime, setMoveTime] = useState(bookingData.moveTime || '09:00');
  const [name, setName] = useState(profile?.first_name ? `${profile.first_name} ${profile.last_name || ''}`.trim() : '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [email, setEmail] = useState(user?.email || '');
  const [notes, setNotes] = useState('');

  /* ── Pricing ──
   *
   * Two-track strategy:
   *
   *   1. CLIENT PREVIEW (always works, no deploy dependency)
   *      On every coordinate change we hit OSRM's public API
   *      directly from the browser via getRouteDistance() and
   *      run the calculatePrice() formula from constants.ts with
   *      the result. This guarantees the Step 1 distance pill and
   *      Step 5 summary always show real numbers, even if no
   *      Supabase Edge Function has been deployed yet.
   *
   *   2. SERVER-AUTHORITATIVE (preferred when available)
   *      In parallel, we call the calculate-price Edge Function
   *      via fetchServerPrice(). When it responds, its numbers
   *      override the client preview. If the function isn't
   *      deployed or is unreachable, we silently continue with
   *      the client preview — no hard failure.
   *
   *   3. INSERT PATH
   *      handleSubmit prefers serverPrice for the booking insert
   *      (trust-safe), and falls back to the client preview if
   *      the server never responded. Either way the insert writes
   *      a real distance + price, not zeros or placeholders.
   */
  const [estimatedHours, setEstimatedHours] = useState(2);
  const [clientRoute,  setClientRoute]      = useState<RouteResult | null>(null);
  const [serverPrice,  setServerPrice]      = useState<ServerPriceResult | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError,   setPricingError]   = useState<string | null>(null);

  /* Local mirror of the calculatePrice() formula from constants.ts
   * — computed from the CLIENT distance so the Step 5 summary can
   * render a breakdown even before (or instead of) the server
   * response. */
  const clientPricing = clientRoute
    ? calculatePrice(
        vanType || 'medium_van',
        estimatedHours,
        clientRoute.distanceKm,
        helpers,
        additionalServices,
      )
    : null;

  /* Effective values — server wins if available, else client preview. */
  const distanceKm     = serverPrice?.distance_km            ?? clientRoute?.distanceKm   ?? 0;
  const durationMin    = serverPrice?.duration_minutes       ?? clientRoute?.durationMinutes ?? 0;
  const routingProvider: 'OSRM' | 'haversine-fallback' | 'osrm' | 'haversine' | null =
    serverPrice?.routing_provider ?? clientRoute?.source ?? null;
  const priceTotal     = serverPrice?.price_total            ?? clientPricing?.total       ?? 0;
  const priceSubtotal  = serverPrice?.price_subtotal         ?? clientPricing?.subtotal    ?? 0;
  const vatAmount      = serverPrice?.vat_amount             ?? clientPricing?.vat         ?? 0;
  const basePrice      = serverPrice?.breakdown?.base_price      ?? clientPricing?.basePrice      ?? 0;
  const distanceCharge = serverPrice?.breakdown?.distance_charge ?? clientPricing?.distanceCharge ?? 0;
  const helpersCharge  = serverPrice?.breakdown?.helpers_charge  ?? clientPricing?.helpersCharge  ?? 0;

  /* Ready-to-submit means we have AT LEAST a client-side number
   * set. The submit button stays disabled until this is true so a
   * booking is never inserted with a zero price. */
  const pricingReady = !!(serverPrice || clientPricing);

  /* ── Validation ── */
  const [addressErrors, setAddressErrors] = useState<{ pickup?: string; dropoff?: string }>({});

  /* ── Legal acceptance ── */
  const [legalAccepted, setLegalAccepted] = useState(false);

  /* ── Submission ── */
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  /* ── CLIENT PREVIEW: browser-side OSRM distance ──
   * Runs on every address change. Always succeeds (falls back to
   * Haversine × 1.4 if OSRM is down) so the Step 1 pill and the
   * summary step always have real numbers to show. Independent of
   * the server-side calculate-price call below. */
  useEffect(() => {
    let cancelled = false;
    if (!pickupAddress.lat || !pickupAddress.lng || !dropoffAddress.lat || !dropoffAddress.lng) {
      setClientRoute(null);
      return;
    }
    (async () => {
      const res = await getRouteDistance(
        { lat: pickupAddress.lat!, lng: pickupAddress.lng! },
        { lat: dropoffAddress.lat!, lng: dropoffAddress.lng! },
      );
      if (cancelled || !res) return;
      setClientRoute(res);
    })();
    return () => { cancelled = true; };
  }, [pickupAddress.lat, pickupAddress.lng, dropoffAddress.lat, dropoffAddress.lng]);

  /* ── SERVER: calculate-price edge function ──
   * Fires on every pricing-input change. If the function is
   * deployed and reachable, its numbers override the client
   * preview. If not, we silently keep the client preview — no
   * hard failure, so the booking flow is never stuck. */
  useEffect(() => {
    let cancelled = false;
    if (!pickupAddress.lat || !pickupAddress.lng || !dropoffAddress.lat || !dropoffAddress.lng) {
      setServerPrice(null);
      setPricingError(null);
      return;
    }
    setPricingLoading(true);
    setPricingError(null);
    (async () => {
      try {
        const res = await fetchServerPrice({
          pickupLat:           pickupAddress.lat!,
          pickupLng:           pickupAddress.lng!,
          dropoffLat:          dropoffAddress.lat!,
          dropoffLng:          dropoffAddress.lng!,
          vanType:             vanType || 'medium_van',
          helpers,
          additionalServices,
          estimatedHours,
        });
        if (!cancelled) setServerPrice(res);
      } catch (err) {
        if (!cancelled) {
          setServerPrice(null);
          setPricingError((err as Error).message);
        }
      } finally {
        if (!cancelled) setPricingLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    pickupAddress.lat, pickupAddress.lng,
    dropoffAddress.lat, dropoffAddress.lng,
    vanType, helpers, additionalServices, estimatedHours,
  ]);

  /* ── INVENTORY helpers ── */
  const totalVolume = Object.entries(inventory).reduce((sum, [name, qty]) => {
    const item = Object.values(INVENTORY_ITEMS).flat().find(i => i.name === name);
    return sum + (item?.volume || 0) * qty;
  }, 0);

  const applyPreset = (presetName: string) => {
    const preset = PROPERTY_PRESETS[presetName];
    if (preset) setInventory(preset);
  };

  const updateInventory = (itemName: string, delta: number) => {
    setInventory(prev => {
      const current = prev[itemName] || 0;
      const next = Math.max(0, current + delta);
      if (next === 0) {
        const { [itemName]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [itemName]: next };
    });
  };

  /* ── VALIDATION ── */
  const validateAddresses = (): boolean => {
    const errs: { pickup?: string; dropoff?: string } = {};

    if (!pickupAddress.formatted && !pickupAddress.street_name) {
      errs.pickup = 'Pickup address is required';
    } else if (pickupAddress.postcode && !/^\d{4}$/.test(pickupAddress.postcode)) {
      errs.pickup = 'Norwegian postcode must be 4 digits';
    } else if (!pickupAddress.city && pickupAddress.street_name) {
      errs.pickup = 'City is required';
    }

    if (!dropoffAddress.formatted && !dropoffAddress.street_name) {
      errs.dropoff = 'Delivery address is required';
    } else if (dropoffAddress.postcode && !/^\d{4}$/.test(dropoffAddress.postcode)) {
      errs.dropoff = 'Norwegian postcode must be 4 digits';
    } else if (!dropoffAddress.city && dropoffAddress.street_name) {
      errs.dropoff = 'City is required';
    }

    setAddressErrors(errs);
    return Object.keys(errs).length === 0;
  };

  /* ── STEP NAVIGATION ── */
  const goNext = () => {
    if (step === 1) {
      if (!validateAddresses()) return;
    }
    if (step === 2) {
      if (!moveType) { setError('Please select a move type'); return; }
    }
    if (step === 4) {
      if (!moveDate) { setError('Please select a move date'); return; }
    }
    setError('');
    setStep(s => Math.min(s + 1, TOTAL_STEPS));
    window.scrollTo(0, 0);
  };

  const goBack = () => {
    setError('');
    setStep(s => Math.max(s - 1, 1));
    window.scrollTo(0, 0);
  };

  /* ── SUBMIT ── */
  const handleSubmit = async () => {
    if (!legalAccepted) {
      setError('Please accept all legal requirements before proceeding.');
      return;
    }
    if (!user) {
      /* Auto-open the sign-in modal instead of just showing a
       * "please sign in" message and leaving the customer to figure
       * out where to click. They've already filled out 6 steps —
       * every extra friction point here loses us a booking.
       * BookingData (addresses, inventory, pricing, etc.) lives in
       * the app store so it survives the auth modal opening and
       * closing, and after signing in they just click Confirm & Pay
       * again with all their work intact. */
      setAuthMode('signin');
      setShowAuthModal(true);
      setError('Please sign in to complete your booking.');
      return;
    }
    if (!name.trim() || !phone.trim() || !email.trim()) {
      setError('Please fill in your name, phone, and email before submitting.');
      return;
    }
    if (!moveType) {
      setError('Please choose a move type before submitting.');
      return;
    }
    if (!pickupAddress?.formatted || !dropoffAddress?.formatted) {
      setError('Please set both pickup and drop-off addresses.');
      return;
    }

    /* Pricing gate: we need AT LEAST a client-preview number
     * (from getRouteDistance() + calculatePrice()) so the insert
     * never writes zeros. Server-side serverPrice is preferred
     * when available — see the effective-value accessors above. */
    if (!pricingReady) {
      setError('Calculating price… please wait a moment and try again.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      /* Use the simple flat columns the bookings table actually has —
       * the table stores one address per location (pickup_address /
       * dropoff_address) plus postcode/city/lat/lng as flat columns.
       * `status` must be a value that satisfies the CHECK constraint
       * ('pending','confirmed','driver_assigned','pickup_arrived',
       *  'loading','in_transit','completed','cancelled'). */
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert({
          customer_id: user.id,
          customer_email: email,
          customer_name: name,
          customer_phone: phone,

          pickup_address: pickupAddress.formatted || formatNorwegianAddress(pickupAddress).oneLine,
          pickup_postcode: pickupAddress.postcode,
          pickup_city: pickupAddress.city,
          pickup_lat: pickupAddress.lat,
          pickup_lng: pickupAddress.lng,

          dropoff_address: dropoffAddress.formatted || formatNorwegianAddress(dropoffAddress).oneLine,
          dropoff_postcode: dropoffAddress.postcode,
          dropoff_city: dropoffAddress.city,
          dropoff_lat: dropoffAddress.lat,
          dropoff_lng: dropoffAddress.lng,

          /* Move details */
          move_type: moveType,
          van_type: vanType || recommendVan(totalVolume),
          helpers,
          additional_services: additionalServices,
          items: inventory,

          /* Schedule */
          move_date: moveDate || null,
          move_time: moveTime || null,
          customer_notes: notes,

          /* Pricing — effective values prefer the server-side
           * calculate-price result (trust-safe) and fall back to
           * the client-side OSRM preview + constants.calculatePrice
           * formula when the edge function is unavailable. Either
           * way the insert writes a real distance + price, not
           * zeros. See the accessors at the top of this component. */
          distance_km:     distanceKm,
          estimated_hours: estimatedHours,
          price_estimate:  priceTotal,
          original_price:  priceTotal,

          status: 'pending',
          payment_status: 'pending',
        })
        .select()
        .single();

      if (bookingError) throw bookingError;

      /* ── ESCROW PAYMENT ── */
      const { error: escrowError } = await supabase
        .from('escrow_payments')
        .insert({
          booking_id:      booking.id,
          amount:          priceTotal,
          original_amount: priceTotal,
          status:          'held',
        });

      if (escrowError) console.warn('Escrow insert failed:', escrowError);

      /* ── Hand off to the PaymentPage. The booking row is now live
       * with payment_status = 'pending', and escrow_payments has
       * a matching 'held' row. PaymentPage picks the provider
       * (Stripe Checkout / Vipps / Google Pay / Corporate Invoice)
       * and fires the right Edge Function. On success it flips
       * payment_status → 'paid' and escrow_payments → 'escrow'. */
      setPage('payment');

    } catch (err: any) {
      /* Log the full error object to DevTools so we can see column
       * names, constraint violations, RLS errors, etc. — the
       * single-line .message is often a generic "insert failed"
       * that doesn't tell us what actually went wrong. */
      console.error('[BookingFlow] Booking submission failed:', err, {
        pickupAddress,
        dropoffAddress,
        distanceKm,
        priceTotal,
        vanType,
        helpers,
        estimatedHours,
      });
      const message =
        err?.message ||
        err?.error_description ||
        err?.details ||
        'Booking failed. Please try again.';
      setError(message);
      /* Scroll the error banner into view — on Step 6 the user is
       * usually scrolled to the bottom where the confirm button is,
       * and would otherwise never see the error that just rendered
       * at the top of the page. */
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      }
    }

    setSaving(false);
  };

  /* ─── STEP LABELS ─── */
  const stepLabels = [
    t('booking.stepAddresses'),
    t('booking.stepDetails'),
    t('booking.stepInventory'),
    t('booking.stepSchedule'),
    t('booking.stepSummary'),
    t('booking.stepConfirm'),
  ];

  /* ─── RENDER ─── */
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#0B2E59] to-[#1a4a8a] text-white py-10">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h1 className="text-3xl font-extrabold mb-2">{t('booking.heroTitle')}</h1>
          <p className="text-white/70">{t('booking.heroSubtitle')}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            {stepLabels.map((label, i) => {
              const sNum = i + 1;
              const isActive = sNum === step;
              const isDone = sNum < step;
              return (
                <div key={label} className="flex flex-col items-center gap-1 flex-1">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all
                    ${isDone ? 'bg-green-500 text-white' : isActive ? 'bg-[#0B2E59] text-white ring-4 ring-[#0B2E59]/20' : 'bg-gray-100 text-gray-400'}`}>
                    {isDone ? (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : sNum}
                  </div>
                  <span className={`text-[10px] hidden sm:block ${isActive ? 'text-[#0B2E59] font-semibold' : 'text-gray-400'}`}>{label}</span>
                </div>
              );
            })}
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className="bg-gradient-to-r from-[#0B2E59] to-emerald-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${((step - 1) / (TOTAL_STEPS - 1)) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Persistent sign-in hint for unsigned visitors. Rather
         * than letting them fill out all 6 steps and blocking at
         * the final submit, show an inline banner upfront on every
         * step with a one-click "Sign in" button that opens the
         * auth modal. BookingData (addresses, inventory, etc.)
         * lives in the app store so it survives the modal open/
         * close cycle — after signing in their work is still here. */}
        {!user && (
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-900">Sign in to complete your booking</p>
              <p className="text-xs text-blue-700 mt-0.5">
                You can fill in all the details now — we&apos;ll ask you to sign in before you confirm payment.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setAuthMode('signin'); setShowAuthModal(true); }}
              className="flex-shrink-0 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition"
            >
              Sign In
            </button>
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* ═══════════════════════════════════════════
            STEP 1 — ADDRESSES
        ═══════════════════════════════════════════ */}
        {step === 1 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-1">{t('booking.addrTitle')}</h2>
            <p className="text-gray-500 text-sm mb-6">{t('booking.addrSubtitle')}</p>

            <div className="space-y-6">
              {/* PICKUP */}
              <div>
                <NorwayAddressAutocomplete
                  id="pickup-address"
                  label={t('booking.addrPickupLabel')}
                  value={pickupAddress.formatted}
                  placeholder={t('booking.addrPickupPlaceholder')}
                  required
                  error={addressErrors.pickup}
                  onSelect={(addr: NorwegianAddress) => {
                    setPickupAddress({
                      street_name: addr.street_name,
                      house_number: addr.house_number,
                      postcode: addr.postcode,
                      city: addr.city,
                      country: 'Norway',
                      lat: addr.lat,
                      lng: addr.lng,
                      formatted: addr.formatted,
                    });
                    setAddressErrors(prev => ({ ...prev, pickup: undefined }));
                  }}
                />
                {/* Structured display after selection */}
                {pickupAddress.street_name && (
                  <div className="mt-2 bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700">
                    <span className="font-semibold">Stored:</span>{' '}
                    {formatNorwegianAddress(pickupAddress).oneLine}
                    {pickupAddress.lat && (
                      <span className="text-blue-400 ml-2 font-mono">
                        [{pickupAddress.lat.toFixed(5)}, {pickupAddress.lng?.toFixed(5)}]
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* DROPOFF */}
              <div>
                <NorwayAddressAutocomplete
                  id="dropoff-address"
                  label={t('booking.addrDropoffLabel')}
                  value={dropoffAddress.formatted}
                  placeholder="e.g. Aker Brygge 1, Oslo"
                  required
                  error={addressErrors.dropoff}
                  onSelect={(addr: NorwegianAddress) => {
                    setDropoffAddress({
                      street_name: addr.street_name,
                      house_number: addr.house_number,
                      postcode: addr.postcode,
                      city: addr.city,
                      country: 'Norway',
                      lat: addr.lat,
                      lng: addr.lng,
                      formatted: addr.formatted,
                    });
                    setAddressErrors(prev => ({ ...prev, dropoff: undefined }));
                  }}
                />
                {dropoffAddress.street_name && (
                  <div className="mt-2 bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700">
                    <span className="font-semibold">Stored:</span>{' '}
                    {formatNorwegianAddress(dropoffAddress).oneLine}
                    {dropoffAddress.lat && (
                      <span className="text-blue-400 ml-2 font-mono">
                        [{dropoffAddress.lat.toFixed(5)}, {dropoffAddress.lng?.toFixed(5)}]
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Distance indicator. Two-track pricing model:
               *   - clientRoute is the immediate OSRM-from-browser
               *     number (always lands, Haversine × 1.4 fallback)
               *   - serverPrice is the authoritative number from
               *     calculate-price (preferred when available)
               * The pill shows whichever is ready first and upgrades
               * to the server number silently if/when it arrives. */}
              {pickupAddress.lat && dropoffAddress.lat && (() => {
                /* Nothing yet → spinner */
                if (!clientRoute && !serverPrice) {
                  return (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3">
                      <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0"/>
                      <div>
                        <p className="text-blue-800 text-sm font-semibold">Calculating driving distance…</p>
                        <p className="text-blue-600 text-xs">Querying OSRM for real road distance</p>
                      </div>
                    </div>
                  );
                }

                /* We have at least one number — render it. Prefer
                 * server, fall back to client. */
                const km   = distanceKm;
                const mins = durationMin;
                const durationText =
                  mins >= 60
                    ? `${Math.floor(mins / 60)}h ${mins % 60}m`
                    : `${mins}m`;

                /* Provider label for the subtitle. Normalise both
                 * client ('osrm' / 'haversine') and server
                 * ('OSRM' / 'haversine-fallback') variants into one
                 * customer-facing string. */
                const providerIsOsrm =
                  routingProvider === 'OSRM' || routingProvider === 'osrm';
                const providerLabel = providerIsOsrm
                  ? 'via OSRM'
                  : 'via Haversine × 1.4 fallback';
                const sourceLabel = serverPrice
                  ? `Calculated server-side ${providerLabel}`
                  : `Calculated in browser ${providerLabel}`;

                return (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
                    </svg>
                    <div>
                      <p className="text-emerald-800 text-sm font-semibold">
                        {km.toFixed(1)} km · ~{durationText} drive
                      </p>
                      <p className="text-emerald-600 text-xs">{sourceLabel}</p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            STEP 2 — MOVE TYPE
        ═══════════════════════════════════════════ */}
        {step === 2 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-1">{t('booking.moveTitle')}</h2>
            <p className="text-gray-500 text-sm mb-6">{t('booking.moveSubtitle')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { id: 'apartment', label: 'Apartment', icon: '🏢' },
                { id: 'house', label: 'House', icon: '🏠' },
                { id: 'office', label: 'Office', icon: '💼' },
                { id: 'student', label: 'Student Move', icon: '🎓' },
                { id: 'furniture', label: 'Furniture', icon: '🛋️' },
                { id: 'delivery', label: 'Delivery', icon: '📦' },
              ].map(t => (
                <button key={t.id} type="button"
                  onClick={() => { setMoveType(t.id); setError(''); }}
                  className={`p-4 rounded-xl border-2 text-center transition-all ${
                    moveType === t.id
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <div className="text-3xl mb-2">{t.icon}</div>
                  <div className="text-sm font-medium text-gray-800">{t.label}</div>
                </button>
              ))}
            </div>

            {moveType && (
              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('booking.vanSizeLabel')}</label>
                <div className="grid grid-cols-2 gap-3">
                  {VAN_TYPES.map(van => (
                    <button key={van.id} type="button"
                      onClick={() => setVanType(van.id)}
                      className={`p-4 rounded-xl border-2 text-left transition-all ${
                        vanType === van.id ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
                      }`}>
                      <div className="font-semibold text-sm text-gray-900">{van.name}</div>
                      <div className="text-xs text-gray-500 mt-1">{van.capacity} · {van.payload}</div>
                      <div className="text-xs text-emerald-600 font-semibold mt-1">{van.pricePerHour} NOK/hr</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('booking.helpersLabel')}</label>
              <div className="flex items-center gap-4">
                <button type="button" onClick={() => setHelpers(h => Math.max(0, h - 1))}
                  className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50">−</button>
                <span className="text-xl font-bold text-gray-800 w-8 text-center">{helpers}</span>
                <button type="button" onClick={() => setHelpers(h => Math.min(3, h + 1))}
                  className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50">+</button>
                <span className="text-sm text-gray-500">{t('booking.helpersPerHour')}</span>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            STEP 3 — INVENTORY
        ═══════════════════════════════════════════ */}
        {step === 3 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-1">{t('booking.inventoryTitle')}</h2>
            <p className="text-gray-500 text-sm mb-6">{t('booking.inventorySubtitle')}</p>

            {/* Property preset buttons */}
            <div className="mb-6">
              <p className="text-sm font-medium text-gray-700 mb-2">{t('booking.inventoryPreset')}</p>
              <div className="flex flex-wrap gap-2">
                {Object.keys(PROPERTY_PRESETS).map(preset => (
                  <button key={preset} type="button"
                    onClick={() => applyPreset(preset)}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium text-gray-700 transition">
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Volume indicator */}
            {totalVolume > 0 && (
              <div className="mb-6 bg-emerald-50 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-emerald-800 font-semibold text-sm">Total Volume: {totalVolume.toFixed(1)} m³</p>
                  <p className="text-emerald-600 text-xs mt-0.5">Recommended: {VAN_TYPES.find(v => v.id === recommendVan(totalVolume))?.name}</p>
                </div>
                <button type="button" onClick={() => setVanType(recommendVan(totalVolume))}
                  className="px-3 py-2 bg-emerald-600 text-white text-xs rounded-lg font-semibold hover:bg-emerald-700 transition">
                  Use Recommended
                </button>
              </div>
            )}

            {/* Inventory by category */}
            {Object.entries(INVENTORY_ITEMS).map(([category, items]) => (
              <div key={category} className="mb-5">
                <h3 className="font-semibold text-gray-800 text-sm mb-3 border-b pb-2">{category}</h3>
                <div className="space-y-2">
                  {items.map(item => (
                    <div key={item.name} className="flex items-center justify-between py-2">
                      <div>
                        <span className="text-sm text-gray-700">{item.name}</span>
                        <span className="text-xs text-gray-400 ml-2">{item.volume}m³ · {item.weight}kg</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => updateInventory(item.name, -1)}
                          className="w-7 h-7 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center text-sm">−</button>
                        <span className="w-6 text-center text-sm font-medium text-gray-800">
                          {inventory[item.name] || 0}
                        </span>
                        <button type="button" onClick={() => updateInventory(item.name, 1)}
                          className="w-7 h-7 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center text-sm">+</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══════════════════════════════════════════
            STEP 4 — SCHEDULE
        ═══════════════════════════════════════════ */}
        {step === 4 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-1">{t('booking.scheduleTitle')}</h2>
            <p className="text-gray-500 text-sm mb-6">{t('booking.scheduleSubtitle')}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('booking.dateLabel')} <span className="text-red-500">*</span></label>
                <input type="date" value={moveDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => { setMoveDate(e.target.value); setError(''); }}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B2E59]/20 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('booking.timeLabel')}</label>
                <select value={moveTime} onChange={e => setMoveTime(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B2E59]/20 outline-none bg-white">
                  {['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('booking.durationLabel')}</label>
                <div className="flex items-center gap-4">
                  <button type="button" onClick={() => setEstimatedHours(h => Math.max(2, h - 0.5))}
                    className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50">−</button>
                  <span className="text-xl font-bold text-gray-800 w-12 text-center">{estimatedHours}h</span>
                  <button type="button" onClick={() => setEstimatedHours(h => Math.min(12, h + 0.5))}
                    className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50">+</button>
                </div>
                <p className="text-xs text-gray-500 mt-2">{t('booking.durationHint')}</p>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            STEP 5 — CONTACT & SUMMARY
        ═══════════════════════════════════════════ */}
        {step === 5 && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-1">{t('booking.contactTitle')}</h2>
              <p className="text-gray-500 text-sm mb-6">{t('booking.contactSubtitle')}</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('booking.nameLabel')}</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B2E59]/20 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('booking.phoneLabel')}</label>
                    <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+47 XXX XX XXX"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B2E59]/20 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('booking.emailLabel')}</label>
                    <input value={email} onChange={e => setEmail(e.target.value)} type="email"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B2E59]/20 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('booking.notesLabel')}</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                    placeholder={t('booking.notesPlaceholder')}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B2E59]/20 outline-none resize-none" />
                </div>
              </div>
            </div>

            {/* Booking summary */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
              <h3 className="font-bold text-gray-800 mb-4">{t('booking.summaryTitle')}</h3>
              <div className="space-y-3 text-sm">
                {/* Addresses in official Norwegian format */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="flex gap-3 mb-3">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full mt-1.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">{t('booking.summaryPickup')}</p>
                      {formatNorwegianAddress(pickupAddress).line1 && (
                        <p className="font-medium text-gray-800">{formatNorwegianAddress(pickupAddress).line1}</p>
                      )}
                      {formatNorwegianAddress(pickupAddress).line2 && (
                        <p className="text-gray-600">{formatNorwegianAddress(pickupAddress).line2}</p>
                      )}
                      <p className="text-gray-400 text-xs">Norway</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-2 h-2 bg-red-500 rounded-full mt-1.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">{t('booking.summaryDelivery')}</p>
                      {formatNorwegianAddress(dropoffAddress).line1 && (
                        <p className="font-medium text-gray-800">{formatNorwegianAddress(dropoffAddress).line1}</p>
                      )}
                      {formatNorwegianAddress(dropoffAddress).line2 && (
                        <p className="text-gray-600">{formatNorwegianAddress(dropoffAddress).line2}</p>
                      )}
                      <p className="text-gray-400 text-xs">Norway</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-500 text-xs">{t('booking.summaryVan')}</p>
                    <p className="font-medium">{VAN_TYPES.find(v => v.id === vanType)?.name || t('booking.summaryTbd')}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-500 text-xs">{t('booking.summaryDate')}</p>
                    <p className="font-medium">{moveDate || t('booking.summaryTbd')} {moveTime}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-500 text-xs">{t('booking.summaryDuration')}</p>
                    <p className="font-medium">{estimatedHours}{t('booking.summaryHoursEst')}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-500 text-xs">{t('booking.summaryDistance')}</p>
                    <p className="font-medium">~{distanceKm} km</p>
                  </div>
                </div>

                {/* Price breakdown — prefers server-side numbers
                 * when calculate-price is deployed, falls back to
                 * the client OSRM preview + local calculatePrice()
                 * formula when it isn't. Either way the breakdown
                 * lines render real figures, not zeros. */}
                <div className="border-t pt-3 space-y-2">
                  {!pricingReady ? (
                    <p className="text-center text-xs text-gray-400 py-4">Calculating price…</p>
                  ) : (
                    <>
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>{t('booking.priceBase')} ({estimatedHours}h × {VAN_TYPES.find(v => v.id === vanType)?.pricePerHour || 850} NOK/h)</span>
                        <span>{basePrice.toFixed(0)} NOK</span>
                      </div>
                      {distanceCharge > 0 && (
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>{t('booking.priceDistance')}</span>
                          <span>{distanceCharge.toFixed(0)} NOK</span>
                        </div>
                      )}
                      {helpersCharge > 0 && (
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>{t('booking.priceHelpers')} ({helpers})</span>
                          <span>{helpersCharge.toFixed(0)} NOK</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>{t('booking.priceVat')}</span>
                        <span>{vatAmount.toFixed(0)} NOK</span>
                      </div>
                      <div className="flex justify-between text-base font-bold text-gray-900 border-t pt-2">
                        <span>{t('booking.priceTotal')}</span>
                        <span className="text-emerald-700">{priceTotal.toFixed(0)} NOK</span>
                      </div>
                      <p className="text-[10px] text-gray-400 text-center pt-1">
                        {serverPrice
                          ? `Distance + price calculated server-side (${serverPrice.routing_provider})`
                          : 'Distance + price calculated in browser · will be re-verified server-side at submit'}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            STEP 6 — LEGAL ACCEPTANCE & CONFIRM
        ═══════════════════════════════════════════ */}
        {step === 6 && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-1">{t('booking.legalTitle')}</h2>
              <p className="text-gray-500 text-sm mb-6">{t('booking.legalSubtitle')}</p>
              <CustomerLegalAcceptance onAccepted={setLegalAccepted} />
            </div>

            {/* Final confirm button */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-bold text-gray-900 text-lg">{t('booking.totalLabel')} {priceTotal.toFixed(0)} NOK</p>
                  <p className="text-gray-500 text-xs">{t('booking.escrowNote')}</p>
                </div>
                <div className="text-right text-xs text-gray-400">
                  <p>{t('booking.summaryPickup')}: {formatNorwegianAddress(pickupAddress).short}</p>
                  <p>{t('booking.summaryDelivery')}: {formatNorwegianAddress(dropoffAddress).short}</p>
                </div>
              </div>

              {/* Inline error banner right above the confirm button.
               * The top-of-page error still renders too (useful for
               * other steps) but on Step 6 the customer is usually
               * scrolled to the bottom, so they would miss a
               * top-only error. Duplicating it here makes any submit
               * failure immediately visible.
               *
               * Special-case the "sign in" error: show a big Sign In
               * button in the banner itself so the customer can one-
               * click their way out of it without hunting for the
               * top-of-page banner. */}
              {error && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                  <p className="font-semibold">Booking failed</p>
                  <p className="text-red-600 text-xs mt-1 break-words">{error}</p>
                  {!user ? (
                    <button
                      type="button"
                      onClick={() => { setAuthMode('signin'); setShowAuthModal(true); }}
                      className="mt-3 px-4 py-2 bg-[#0B2E59] text-white rounded-lg text-xs font-semibold hover:bg-[#1a4a8a] transition"
                    >
                      Sign in to continue →
                    </button>
                  ) : (
                    <p className="text-red-500 text-[10px] mt-2">
                      Open DevTools (F12) → Console tab for the full error details.
                    </p>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving || !legalAccepted || !pricingReady}
                className="w-full py-4 bg-emerald-600 text-white rounded-xl font-bold text-base hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" />
                    </svg>
                    {t('booking.processing')}
                  </>
                ) : !pricingReady ? (
                  <>Calculating price…</>
                ) : (
                  <>
                    🔒 {t('booking.confirmPayBtn')} {priceTotal.toFixed(0)} NOK
                  </>
                )}
              </button>
              {!legalAccepted && (
                <p className="text-center text-xs text-red-500 mt-2">{t('booking.tickBoxes')}</p>
              )}
            </div>
          </div>
        )}

        {/* ── NAV BUTTONS ── */}
        <div className="flex items-center justify-between mt-8">
          <button type="button" onClick={goBack}
            className={`px-6 py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition ${step === 1 ? 'invisible' : ''}`}>
            ← {t('booking.navBack')}
          </button>
          {step < TOTAL_STEPS && (
            <button type="button" onClick={goNext}
              className="px-8 py-3 bg-[#0B2E59] text-white rounded-xl font-semibold hover:bg-[#0B2E59]/90 transition">
              {t('booking.navContinue')} →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
