import { useEffect } from 'react';
import { hasAnalyticsConsent } from './CookieConsent';

/**
 * Loads Plausible Analytics into the page — only after the user has
 * actively granted consent in the cookie banner. Plausible is itself
 * cookieless and GDPR-friendly so technically doesn't require consent
 * in the EU, but gating it gives the user explicit control.
 *
 * Listens for the 'flyttgo:consent' window event so analytics start
 * the moment the user clicks "Accept all" — no page reload required.
 *
 * Replace `data-domain="flyttgo.no"` with your real domain, or wire
 * to import.meta.env.VITE_PLAUSIBLE_DOMAIN if you want it env-driven.
 */
const PLAUSIBLE_SCRIPT_ID = 'flyttgo-plausible';
const PLAUSIBLE_DOMAIN = 'flyttgo.no';
const PLAUSIBLE_SRC = 'https://plausible.io/js/script.js';

function injectPlausible() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(PLAUSIBLE_SCRIPT_ID)) return;
  const s = document.createElement('script');
  s.id = PLAUSIBLE_SCRIPT_ID;
  s.defer = true;
  s.src = PLAUSIBLE_SRC;
  s.setAttribute('data-domain', PLAUSIBLE_DOMAIN);
  document.head.appendChild(s);
}

export default function Analytics() {
  useEffect(() => {
    if (hasAnalyticsConsent()) injectPlausible();

    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === 'all') injectPlausible();
    };
    window.addEventListener('flyttgo:consent', onConsent);
    return () => window.removeEventListener('flyttgo:consent', onConsent);
  }, []);

  return null;
}
