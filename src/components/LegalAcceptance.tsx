import React, { useState } from 'react';
import { useApp } from '../lib/store';

/* ================= CUSTOMER BOOKING LEGAL ACCEPTANCE ================= */

interface CustomerLegalAcceptanceProps {
  onAccepted: (accepted: boolean) => void;
  compact?: boolean;
}

export function CustomerLegalAcceptance({ onAccepted, compact = false }: CustomerLegalAcceptanceProps) {
  const { setPage } = useApp();

  const [checks, setChecks] = useState({
    notResponsible: false,
    claimsToDriver: false,
    accurateInfo: false,
    termsAccepted: false,
    privacyAccepted: false,
  });

  const allAccepted = Object.values(checks).every(Boolean);

  const toggle = (key: keyof typeof checks) => {
    const updated = { ...checks, [key]: !checks[key] };
    setChecks(updated);
    onAccepted(Object.values(updated).every(Boolean));
  };

  const checkboxItems = [
    {
      key: 'notResponsible' as const,
      label: 'I understand that FlyttGo is a marketplace platform only and is NOT responsible for any damage, loss, theft, or delay of my goods during transport.',
      required: true,
    },
    {
      key: 'claimsToDriver' as const,
      label: 'I agree that any claims for damage or loss must be directed to the Transport Provider\'s registered company and their insurer — NOT to FlyttGo.',
      required: true,
    },
    {
      key: 'accurateInfo' as const,
      label: 'I confirm that the information I have provided (addresses, item descriptions, contact details) is accurate and complete. I understand that inaccurate information may result in additional charges.',
      required: true,
    },
    {
      key: 'termsAccepted' as const,
      label: (
        <span>
          I have read and accept the{' '}
          <button type="button" onClick={() => setPage('terms')} className="text-[#0B2E59] underline font-medium hover:text-[#0B2E59]/80">
            Terms & Conditions
          </button>
          {' '}and{' '}
          <button type="button" onClick={() => setPage('liability')} className="text-[#0B2E59] underline font-medium hover:text-[#0B2E59]/80">
            Liability Policy
          </button>
          .
        </span>
      ),
      required: true,
    },
    {
      key: 'privacyAccepted' as const,
      label: (
        <span>
          I have read and accept the{' '}
          <button type="button" onClick={() => setPage('privacy')} className="text-[#0B2E59] underline font-medium hover:text-[#0B2E59]/80">
            Privacy Policy
          </button>
          {' '}and consent to the processing of my personal data for booking purposes.
        </span>
      ),
      required: true,
    },
  ];

  return (
    <div className={`${compact ? 'space-y-3' : 'space-y-4'}`}>
      {/* Legal Warning Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p className="text-amber-800 text-xs font-semibold mb-1">⚠️ Please Read Before Booking</p>
        <p className="text-amber-700 text-xs leading-relaxed">
          FlyttGo is a marketplace connecting you with independent Transport Providers. FlyttGo does not transport goods and provides no insurance. All liability for your goods rests with the Transport Provider's company.
        </p>
      </div>

      {/* Checkboxes */}
      <div className={`space-y-${compact ? '2' : '3'}`}>
        {checkboxItems.map((item) => (
          <label
            key={item.key}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
              checks[item.key]
                ? 'border-green-300 bg-green-50'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="relative flex-shrink-0 mt-0.5">
              <input
                type="checkbox"
                checked={checks[item.key]}
                onChange={() => toggle(item.key)}
                className="sr-only"
              />
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                checks[item.key]
                  ? 'bg-green-600 border-green-600'
                  : 'border-gray-300 bg-white'
              }`}>
                {checks[item.key] && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </div>
            <span className="text-xs text-gray-700 leading-relaxed flex-1">
              {item.label}
              {item.required && (
                <span className="text-red-500 ml-1" title="Required">*</span>
              )}
            </span>
          </label>
        ))}
      </div>

      {/* Status indicator */}
      {!allAccepted && (
        <p className="text-xs text-red-500 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5C3.498 18.333 4.46 20 6 20z" />
          </svg>
          All boxes must be ticked before you can confirm your booking.
        </p>
      )}
      {allAccepted && (
        <p className="text-xs text-green-600 flex items-center gap-1.5 font-medium">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          All legal requirements accepted. You may proceed.
        </p>
      )}
    </div>
  );
}

/* ================= DRIVER APPLICATION LEGAL ACCEPTANCE ================= */

interface DriverLegalAcceptanceProps {
  onAccepted: (accepted: boolean) => void;
}

export function DriverLegalAcceptance({ onAccepted }: DriverLegalAcceptanceProps) {
  const { setPage } = useApp();

  const [checks, setChecks] = useState({
    registeredCompany: false,
    validInsurance: false,
    fullLiability: false,
    marketplaceOnly: false,
    noSubcontracting: false,
    documentAccuracy: false,
    termsAccepted: false,
    driverAgreement: false,
  });

  const allAccepted = Object.values(checks).every(Boolean);

  const toggle = (key: keyof typeof checks) => {
    const updated = { ...checks, [key]: !checks[key] };
    setChecks(updated);
    onAccepted(Object.values(updated).every(Boolean));
  };

  const checkboxItems = [
    {
      key: 'registeredCompany' as const,
      label: 'I confirm that I operate exclusively under a validly registered Norwegian company (AS, ENK, or equivalent) with a current organization number, and that I will provide proof of registration during onboarding.',
      critical: true,
    },
    {
      key: 'validInsurance' as const,
      label: 'I confirm that my company maintains valid, current, and comprehensive transport insurance covering goods in transit (minimum NOK 500,000 per consignment) and public liability (minimum NOK 5,000,000 per incident), and that this insurance covers all commercial transport operations.',
      critical: true,
    },
    {
      key: 'fullLiability' as const,
      label: 'I accept full and exclusive liability for all goods in my care from pickup to delivery. I acknowledge that FlyttGo bears zero liability for any damage, loss, theft, or delay of goods, and that all claims must be handled by my company\'s insurance.',
      critical: true,
    },
    {
      key: 'marketplaceOnly' as const,
      label: 'I understand and accept that FlyttGo is a marketplace platform only, is not my employer, does not employ me or my staff, provides no insurance, and has no liability for services I provide to Customers.',
      critical: true,
    },
    {
      key: 'noSubcontracting' as const,
      label: 'I confirm I will not subcontract jobs booked through the Platform to third parties without prior written Customer consent, and that any permitted subcontractors are covered by my company\'s insurance.',
      critical: false,
    },
    {
      key: 'documentAccuracy' as const,
      label: 'I confirm that all documents and information I submit during onboarding and verification are genuine, accurate, and current. I understand that submission of false documents is a criminal offence and will result in permanent ban and possible prosecution.',
      critical: true,
    },
    {
      key: 'termsAccepted' as const,
      label: (
        <span>
          I have read and accept the{' '}
          <button type="button" onClick={() => setPage('terms')} className="text-[#0B2E59] underline font-medium">
            Terms & Conditions
          </button>
          {' '}and{' '}
          <button type="button" onClick={() => setPage('liability')} className="text-[#0B2E59] underline font-medium">
            Liability & Insurance Policy
          </button>
          .
        </span>
      ),
      critical: false,
    },
    {
      key: 'driverAgreement' as const,
      label: (
        <span>
          I have read and accept the{' '}
          <button type="button" onClick={() => setPage('driver-terms')} className="text-[#0B2E59] underline font-medium">
            Driver Terms & Agreement
          </button>
          {' '}and commit to maintaining compliance with all requirements throughout my time on the Platform.
        </span>
      ),
      critical: false,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Critical Warning */}
      <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
        <p className="text-red-800 text-xs font-bold mb-2">🔴 MANDATORY LEGAL DECLARATIONS — ALL REQUIRED</p>
        <p className="text-red-700 text-xs leading-relaxed">
          The following declarations are mandatory. By ticking each box, you are making a legally binding declaration. False declarations may result in immediate removal from the Platform, forfeiture of earnings, and legal action. FlyttGo conducts ongoing compliance checks.
        </p>
      </div>

      {/* Checkboxes */}
      <div className="space-y-3">
        {checkboxItems.map((item) => (
          <label
            key={item.key}
            className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
              checks[item.key]
                ? 'border-green-300 bg-green-50'
                : item.critical
                  ? 'border-red-100 hover:border-red-200 hover:bg-red-50/30'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="relative flex-shrink-0 mt-0.5">
              <input
                type="checkbox"
                checked={checks[item.key]}
                onChange={() => toggle(item.key)}
                className="sr-only"
              />
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                checks[item.key]
                  ? 'bg-green-600 border-green-600'
                  : item.critical
                    ? 'border-red-400 bg-white'
                    : 'border-gray-300 bg-white'
              }`}>
                {checks[item.key] && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </div>
            <div className="flex-1">
              {item.critical && !checks[item.key] && (
                <span className="inline-block text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded mb-1">CRITICAL REQUIREMENT</span>
              )}
              <span className="text-xs text-gray-700 leading-relaxed block">
                {item.label}
                <span className="text-red-500 ml-1">*</span>
              </span>
            </div>
          </label>
        ))}
      </div>

      {/* Completion status */}
      <div className={`rounded-xl px-4 py-3 ${allAccepted ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {allAccepted ? (
              <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5C3.498 18.333 4.46 20 6 20z" />
              </svg>
            )}
            <span className={`text-xs font-medium ${allAccepted ? 'text-green-700' : 'text-gray-600'}`}>
              {Object.values(checks).filter(Boolean).length} of {Object.keys(checks).length} declarations completed
            </span>
          </div>
          {allAccepted && (
            <span className="text-xs text-green-600 font-semibold">Ready to submit</span>
          )}
        </div>
        {!allAccepted && (
          <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-[#0B2E59] h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${(Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= MINI LEGAL NOTICE (for footer of checkout) ================= */

export function MiniLegalNotice() {
  const { setPage } = useApp();
  return (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
      <p className="text-xs text-gray-500 leading-relaxed text-center">
        By proceeding, you confirm that FlyttGo is a marketplace platform only. FlyttGo is not liable for goods in transit.
        All claims must be directed to the Transport Provider's company.{' '}
        <button onClick={() => setPage('liability')} className="text-[#0B2E59] underline">Liability Policy</button>
        {' · '}
        <button onClick={() => setPage('terms')} className="text-[#0B2E59] underline">Terms</button>
        {' · '}
        <button onClick={() => setPage('privacy')} className="text-[#0B2E59] underline">Privacy</button>
      </p>
    </div>
  );
}

/* ================= INLINE LEGAL DISCLAIMER (in-page banner) ================= */

export function LiabilityBanner({ variant = 'customer' }: { variant?: 'customer' | 'driver' }) {
  const { setPage } = useApp();

  if (variant === 'driver') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-red-600 text-sm">⚠️</span>
          </div>
          <div>
            <p className="font-bold text-red-800 text-sm mb-1">Driver Liability Notice</p>
            <p className="text-red-700 text-xs leading-relaxed">
              As a Transport Provider on FlyttGo, you bear full and exclusive liability for all goods in your care. FlyttGo provides no insurance. You must operate under a registered company with valid transit insurance at all times.{' '}
              <button onClick={() => setPage('liability')} className="underline font-medium">Read full policy →</button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-amber-600 text-sm">ℹ️</span>
        </div>
        <div>
          <p className="font-bold text-amber-800 text-sm mb-1">Important: FlyttGo is a Marketplace Only</p>
          <p className="text-amber-700 text-xs leading-relaxed">
            FlyttGo connects you with independent Transport Providers but does not transport goods itself and provides no insurance. Any claims for damage or loss must be directed to the Transport Provider's company.{' '}
            <button onClick={() => setPage('liability')} className="underline font-medium">Learn more →</button>
          </p>
        </div>
      </div>
    </div>
  );
}
