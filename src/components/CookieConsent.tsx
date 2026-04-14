import React, { useState, useEffect } from 'react';
import { X, Cookie } from 'lucide-react';

const STORAGE_KEY = 'flyttgo_cookie_consent';

type Choice = 'all' | 'essential' | null;

/**
 * GDPR cookie consent banner.
 *
 * Stores the user's choice in localStorage under flyttgo_cookie_consent
 * as either 'all' (analytics OK) or 'essential' (only strictly
 * necessary cookies). Other components / scripts that want to know
 * whether they can fire analytics should call hasAnalyticsConsent().
 *
 * Also dispatches a custom 'flyttgo:consent' window event when the
 * choice changes, so a future analytics loader can subscribe to it
 * and start tracking the moment consent is granted (no full reload
 * required).
 */
export function hasAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY) === 'all';
}

export default function CookieConsent() {
  const [choice, setChoice] = useState<Choice>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = window.localStorage.getItem(STORAGE_KEY) as Choice;
    setChoice(stored ?? null);
  }, []);

  const save = (value: 'all' | 'essential') => {
    window.localStorage.setItem(STORAGE_KEY, value);
    setChoice(value);
    window.dispatchEvent(new CustomEvent('flyttgo:consent', { detail: value }));
  };

  // Don't render until we've checked localStorage — avoids a flash
  // of the banner on every page load for users who already chose.
  if (!mounted) return null;
  if (choice !== null) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md z-50 animate-in slide-in-from-bottom-5"
    >
      <div className="bg-white border border-gray-200 rounded-2xl shadow-2xl p-5 sm:p-6">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Cookie className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-gray-900 mb-1">We use cookies</h2>
            <p className="text-xs text-gray-600 leading-relaxed">
              FlyttGo uses essential cookies to keep you signed in and your booking flow working.
              We&apos;d also like to use analytics cookies to understand how customers use the site
              so we can make it better. You can change your choice any time.
            </p>
          </div>
          <button
            type="button"
            aria-label="Reject non-essential cookies"
            onClick={() => save('essential')}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <button
            type="button"
            onClick={() => save('essential')}
            className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition"
          >
            Essential only
          </button>
          <button
            type="button"
            onClick={() => save('all')}
            className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition"
          >
            Accept all
          </button>
        </div>

        <p className="text-[10px] text-gray-400 mt-3 text-center">
          See our <a href="/privacy" className="text-emerald-600 hover:underline">privacy policy</a> for details.
        </p>
      </div>
    </div>
  );
}
