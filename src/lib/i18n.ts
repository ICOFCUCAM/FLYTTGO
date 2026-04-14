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
      caches: ['localStorage'],
    },
  });

/* The Header used to store the language as 'EN' / 'NO' (uppercase
 * two-letter codes). i18next expects lowercase IETF-ish codes. If the
 * stored value is the legacy uppercase form, normalise it once on
 * boot so we don't have a mismatch. */
if (typeof window !== 'undefined') {
  const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
  if (stored === 'EN') {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'en');
    void i18n.changeLanguage('en');
  } else if (stored === 'NO') {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'no');
    void i18n.changeLanguage('no');
  }
}

export default i18n;
export { LANG_STORAGE_KEY };
