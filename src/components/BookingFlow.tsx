import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { useApp } from '../lib/store';
import { supabase } from '../lib/supabase';
import { VAN_TYPES, INVENTORY_ITEMS, PROPERTY_PRESETS, calculatePrice, recommendVan } from '../lib/constants';
import NorwayAddressAutocomplete, { NorwegianAddress } from './NorwayAddressAutocomplete';
import { formatNorwegianAddress, validateNorwegianAddress } from '../utils/formatNorwegianAddress';
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
  const { bookingData, setBookingData, setPage } = useApp();

  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 6;

  /* ── Structured addresses (replaces old string fields) ── */
  const [pickupAddress, setPickupAddress] = useState<StructuredAddress>(emptyAddress());
  const [dropoffAddress, setDropoffAddress] = useState<StructuredAddress>(emptyAddress());

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

  /* ── Pricing ── */
  const [distanceKm, setDistanceKm] = useState(bookingData.distanceKm || 10);
  const [estimatedHours, setEstimatedHours] = useState(2);

  /* ── Validation ── */
  const [addressErrors, setAddressErrors] = useState<{ pickup?: string; dropoff?: string }>({});

  /* ── Legal acceptance ── */
  const [legalAccepted, setLegalAccepted] = useState(false);

  /* ── Submission ── */
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  /* Calculate price */
  const pricing = calculatePrice(
    vanType || 'medium_van',
    estimatedHours,
    safeNum(distanceKm),
    helpers,
    additionalServices
  );

  /* Auto-calculate distance when both addresses have coords */
  useEffect(() => {
    if (pickupAddress.lat && pickupAddress.lng && dropoffAddress.lat && dropoffAddress.lng) {
      const R = 6371;
      const dLat = (dropoffAddress.lat - pickupAddress.lat) * Math.PI / 180;
      const dLon = (dropoffAddress.lng - pickupAddress.lng) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(pickupAddress.lat * Math.PI / 180) *
        Math.cos(dropoffAddress.lat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const km = Math.round(R * c);
      setDistanceKm(km);
    }
  }, [pickupAddress.lat, pickupAddress.lng, dropoffAddress.lat, dropoffAddress.lng]);

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
      setError('Please sign in to complete your booking.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      /* ── STRUCTURED address insert (replaces old string-based insert) ── */
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert({
          user_id: user.id,
          customer_email: email,
          customer_name: name,
          customer_phone: phone,

          /* STRUCTURED PICKUP — replaces pickup_address: string */
          pickup_street: pickupAddress.street_name,
          pickup_house_number: pickupAddress.house_number,
          pickup_postcode: pickupAddress.postcode,
          pickup_city: pickupAddress.city,
          pickup_lat: pickupAddress.lat,
          pickup_lng: pickupAddress.lng,
          /* Legacy compatibility field */
          pickup_address: pickupAddress.formatted || formatNorwegianAddress(pickupAddress).oneLine,

          /* STRUCTURED DELIVERY — replaces dropoff_address: string */
          delivery_street: dropoffAddress.street_name,
          delivery_house_number: dropoffAddress.house_number,
          delivery_postcode: dropoffAddress.postcode,
          delivery_city: dropoffAddress.city,
          delivery_lat: dropoffAddress.lat,
          delivery_lng: dropoffAddress.lng,
          /* Legacy compatibility field */
          dropoff_address: dropoffAddress.formatted || formatNorwegianAddress(dropoffAddress).oneLine,

          /* Move details */
          move_type: moveType,
          property_type: propertyType,
          van_type: vanType || recommendVan(totalVolume),
          helpers_count: helpers,
          additional_services: additionalServices,
          inventory_items: inventory,

          /* Schedule */
          move_date: moveDate,
          move_time: moveTime,
          notes,

          /* Pricing */
          distance_km: distanceKm,
          estimated_hours: estimatedHours,
          price_estimate: safeNum(pricing.total),
          original_price: safeNum(pricing.total),
          subtotal: safeNum(pricing.subtotal),
          vat_amount: safeNum(pricing.vat),

          status: 'awaiting_driver',
        })
        .select()
        .single();

      if (bookingError) throw bookingError;

      /* ── ESCROW PAYMENT ── */
      const { error: escrowError } = await supabase
        .from('escrow_payments')
        .insert({
          booking_id: booking.id,
          user_id: user.id,
          amount: safeNum(pricing.total),
          status: 'pending',
        });

      if (escrowError) console.warn('Escrow insert failed:', escrowError);

      /* ── STRIPE CHECKOUT ── */
      try {
        const res = await fetch(
          'https://jomhtghowrtegjfddite.databasepad.com/functions/v1/create-checkout-session',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookingId: booking.id,
              amount: safeNum(pricing.total),
              pickupAddress: pickupAddress.formatted,
              deliveryAddress: dropoffAddress.formatted,
              customerEmail: email,
            }),
          }
        );
        const checkout = await res.json();
        if (checkout.url) {
          window.location.href = checkout.url;
          return;
        }
      } catch (stripeErr) {
        console.warn('Stripe checkout failed, redirecting to dashboard:', stripeErr);
      }

      /* Fallback: go to dashboard */
      setPage('customer-dashboard');

    } catch (err: any) {
      console.error('Booking submission failed:', err);
      setError(err.message || 'Booking failed. Please try again.');
    }

    setSaving(false);
  };

  /* ─── STEP LABELS ─── */
  const stepLabels = ['Addresses', 'Move Details', 'Inventory', 'Schedule', 'Summary', 'Confirm'];

  /* ─── RENDER ─── */
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#0B2E59] to-[#1a4a8a] text-white py-10">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h1 className="text-3xl font-extrabold mb-2">Book Your Move</h1>
          <p className="text-white/70">Instant prices · Verified drivers · Secure escrow payment</p>
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
            <h2 className="text-xl font-bold text-gray-900 mb-1">Where are you moving?</h2>
            <p className="text-gray-500 text-sm mb-6">Start typing to search the official Norwegian address registry</p>

            <div className="space-y-6">
              {/* PICKUP */}
              <div>
                <NorwayAddressAutocomplete
                  id="pickup-address"
                  label="Pickup Address"
                  value={pickupAddress.formatted}
                  placeholder="e.g. Karl Johans gate 12, Oslo"
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
                  label="Delivery Address"
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

              {/* Distance indicator */}
              {pickupAddress.lat && dropoffAddress.lat && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3">
                  <svg className="w-5 h-5 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  <div>
                    <p className="text-emerald-800 text-sm font-semibold">Distance calculated: ~{distanceKm} km</p>
                    <p className="text-emerald-600 text-xs">Using GPS coordinates from Kartverket</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            STEP 2 — MOVE TYPE
        ═══════════════════════════════════════════ */}
        {step === 2 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-1">What are you moving?</h2>
            <p className="text-gray-500 text-sm mb-6">This helps us match the right van and driver</p>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Van Size</label>
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
              <label className="block text-sm font-medium text-gray-700 mb-2">Additional Helpers</label>
              <div className="flex items-center gap-4">
                <button type="button" onClick={() => setHelpers(h => Math.max(0, h - 1))}
                  className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50">−</button>
                <span className="text-xl font-bold text-gray-800 w-8 text-center">{helpers}</span>
                <button type="button" onClick={() => setHelpers(h => Math.min(3, h + 1))}
                  className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50">+</button>
                <span className="text-sm text-gray-500">× 350 NOK/hr each</span>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            STEP 3 — INVENTORY
        ═══════════════════════════════════════════ */}
        {step === 3 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-1">What items are you moving?</h2>
            <p className="text-gray-500 text-sm mb-6">This helps us recommend the right van size</p>

            {/* Property preset buttons */}
            <div className="mb-6">
              <p className="text-sm font-medium text-gray-700 mb-2">Quick fill by property type:</p>
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
            <h2 className="text-xl font-bold text-gray-900 mb-1">When is your move?</h2>
            <p className="text-gray-500 text-sm mb-6">Choose your preferred date and time</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Move Date <span className="text-red-500">*</span></label>
                <input type="date" value={moveDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => { setMoveDate(e.target.value); setError(''); }}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B2E59]/20 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Preferred Start Time</label>
                <select value={moveTime} onChange={e => setMoveTime(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B2E59]/20 outline-none bg-white">
                  {['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Estimated Duration (hours)</label>
                <div className="flex items-center gap-4">
                  <button type="button" onClick={() => setEstimatedHours(h => Math.max(2, h - 0.5))}
                    className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50">−</button>
                  <span className="text-xl font-bold text-gray-800 w-12 text-center">{estimatedHours}h</span>
                  <button type="button" onClick={() => setEstimatedHours(h => Math.min(12, h + 0.5))}
                    className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50">+</button>
                </div>
                <p className="text-xs text-gray-500 mt-2">Minimum 2 hours. Final price may adjust based on actual time.</p>
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
              <h2 className="text-xl font-bold text-gray-900 mb-1">Your Contact Details</h2>
              <p className="text-gray-500 text-sm mb-6">So your driver can reach you</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B2E59]/20 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
                    <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+47 XXX XX XXX"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B2E59]/20 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                    <input value={email} onChange={e => setEmail(e.target.value)} type="email"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B2E59]/20 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Special Instructions (optional)</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                    placeholder="e.g. 3rd floor, no lift. Fragile items need extra care."
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B2E59]/20 outline-none resize-none" />
                </div>
              </div>
            </div>

            {/* Booking summary */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
              <h3 className="font-bold text-gray-800 mb-4">Booking Summary</h3>
              <div className="space-y-3 text-sm">
                {/* Addresses in official Norwegian format */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="flex gap-3 mb-3">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full mt-1.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">PICKUP</p>
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
                      <p className="text-xs text-gray-400 mb-0.5">DELIVERY</p>
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
                    <p className="text-gray-500 text-xs">Van</p>
                    <p className="font-medium">{VAN_TYPES.find(v => v.id === vanType)?.name || 'TBD'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-500 text-xs">Date</p>
                    <p className="font-medium">{moveDate || 'TBD'} {moveTime}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-500 text-xs">Duration</p>
                    <p className="font-medium">{estimatedHours}h estimated</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-500 text-xs">Distance</p>
                    <p className="font-medium">~{distanceKm} km</p>
                  </div>
                </div>

                {/* Price breakdown */}
                <div className="border-t pt-3 space-y-2">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Base ({estimatedHours}h × {VAN_TYPES.find(v => v.id === vanType)?.pricePerHour || 850} NOK/h)</span>
                    <span>{safeNum(pricing.basePrice).toFixed(0)} NOK</span>
                  </div>
                  {safeNum(pricing.distanceCharge) > 0 && (
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Distance charge</span>
                      <span>{safeNum(pricing.distanceCharge).toFixed(0)} NOK</span>
                    </div>
                  )}
                  {safeNum(pricing.helpersCharge) > 0 && (
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Helpers ({helpers})</span>
                      <span>{safeNum(pricing.helpersCharge).toFixed(0)} NOK</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>VAT (25% MVA)</span>
                    <span>{safeNum(pricing.vat).toFixed(0)} NOK</span>
                  </div>
                  <div className="flex justify-between text-base font-bold text-gray-900 border-t pt-2">
                    <span>Total (incl. VAT)</span>
                    <span className="text-emerald-700">{safeNum(pricing.total).toFixed(0)} NOK</span>
                  </div>
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
              <h2 className="text-xl font-bold text-gray-900 mb-1">Legal Agreements</h2>
              <p className="text-gray-500 text-sm mb-6">Please review and accept before confirming your booking</p>
              <CustomerLegalAcceptance onAccepted={setLegalAccepted} />
            </div>

            {/* Final confirm button */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-bold text-gray-900 text-lg">Total: {safeNum(pricing.total).toFixed(0)} NOK</p>
                  <p className="text-gray-500 text-xs">Held in escrow until delivery confirmed</p>
                </div>
                <div className="text-right text-xs text-gray-400">
                  <p>Pickup: {formatNorwegianAddress(pickupAddress).short}</p>
                  <p>Delivery: {formatNorwegianAddress(dropoffAddress).short}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving || !legalAccepted}
                className="w-full py-4 bg-emerald-600 text-white rounded-xl font-bold text-base hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" />
                    </svg>
                    Processing...
                  </>
                ) : (
                  <>
                    🔒 Confirm & Pay {safeNum(pricing.total).toFixed(0)} NOK
                  </>
                )}
              </button>
              {!legalAccepted && (
                <p className="text-center text-xs text-red-500 mt-2">Please tick all boxes above to continue</p>
              )}
            </div>
          </div>
        )}

        {/* ── NAV BUTTONS ── */}
        <div className="flex items-center justify-between mt-8">
          <button type="button" onClick={goBack}
            className={`px-6 py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition ${step === 1 ? 'invisible' : ''}`}>
            ← Back
          </button>
          {step < TOTAL_STEPS && (
            <button type="button" onClick={goNext}
              className="px-8 py-3 bg-[#0B2E59] text-white rounded-xl font-semibold hover:bg-[#0B2E59]/90 transition">
              Continue →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
