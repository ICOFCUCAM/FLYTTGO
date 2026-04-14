import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { en } from './locales/en';
import { no } from './locales/no';

/**
 * i18next setup.
 *
 * The Header has a small EN/NO toggle whose choice is stored in
 * localStorage under `flyttgo_lang`. We point i18next at the same key
 * so the two stay in sync — switching language anywhere on the site
 * (including the toggle) immediately re-renders every component that
 * uses the useTranslation() hook.
 *
 * Detection order:
 *   1. localStorage flyttgo_lang — what the user explicitly chose.
 *   2. navigator.language — what their browser reports.
 *   3. fallback to 'en'.
 *
 * Translations live in src/lib/locales/{en,no}.ts. Keys are nested by
 * surface (header / footer / home / etc) and addressed with a
 * colon-separated path like t('header.signIn').
 */

const LANG_STORAGE_KEY = 'flyttgo_lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      no: { translation: no },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'no'],
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANG_STORAGE_KEY,
      /* We persist through Header.chooseLang() and only on an
       * explicit user choice — auto-picked browser values stay
       * in-memory so they don't freeze over-time. */
      caches: [],
    },
  });

/**
 * Browser language → FlyttGo language code.
 *
 * Matches anything that starts with `no`, `nb` (Norwegian Bokmål),
 * `nn` (Nynorsk) or `se` (Northern Sami — Norwegian indigenous
 * language) to the 'no' bundle. Everything else falls back to 'en'.
 * Handles both `nb-NO` and `nb_NO` separator styles.
 */
function normaliseBrowserLang(raw: string | undefined | null): 'en' | 'no' {
  if (!raw) return 'en';
  const head = raw.toLowerCase().split(/[-_]/)[0];
  if (head === 'no' || head === 'nb' || head === 'nn' || head === 'se') return 'no';
  return 'en';
}

if (typeof window !== 'undefined') {
  const stored = window.localStorage.getItem(LANG_STORAGE_KEY);

  /* The Header used to store 'EN'/'NO' (uppercase). Normalise the
   * legacy form once on boot so i18next doesn't mismatch. */
  if (stored === 'EN') {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'en');
    void i18n.changeLanguage('en');
  } else if (stored === 'NO') {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'no');
    void i18n.changeLanguage('no');
  } else if (!stored) {
    /* First visit — pick a language from the browser. i18next's
     * LanguageDetector only picks it up when the navigator string
     * is literally 'en' or 'no', which misses `nb-NO`, `nn-NO`,
     * `en-US`, `en-GB` etc. Normalise ourselves so Norwegian
     * visitors land on the Norwegian site automatically. */
    const fromNav = typeof navigator !== 'undefined'
      ? (navigator.languages && navigator.languages[0]) || navigator.language
      : 'en';
    const picked = normaliseBrowserLang(fromNav);
    void i18n.changeLanguage(picked);
    /* Do NOT persist the auto-picked value — we only cache it once
     * the user explicitly chooses via the header toggle, so that
     * visitors on a different device still get fresh detection. */
  }
}

export default i18n;
export { LANG_STORAGE_KEY };
