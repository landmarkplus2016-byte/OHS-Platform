/* ==========================================================================
   i18n.js — translation lookup and language switching.

   CLAUDE.md Section 8.1. All UI text goes through t('key'). The language
   preference is per-device and lives in localStorage.ohsp_lang.
   ========================================================================== */

import { en } from './en.js';
import { ar } from './ar.js';
import { render } from '../render.js';

const DICTS = { en, ar };
const STORAGE_KEY = 'ohsp_lang';

/**
 * Current language, seeded from the device preference. Default 'en'
 * (Section 8.1). Config.primary_language can override this on a device that has
 * never chosen a language — main.js applies that at boot.
 */
let currentLang = localStorage.getItem(STORAGE_KEY) || 'en';
if (!DICTS[currentLang]) currentLang = 'en';

// Apply dir/lang on module load so the very first paint is already correct —
// RTL must be in place before anything renders.
applyDocumentLang(currentLang);

function applyDocumentLang(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Merge a module's own strings into the global dictionaries (Section 5.1).
 *
 * Called at import time from js/modules/<name>/i18n.js, which every manifest
 * imports — so by the time main.js registers the modules, their keys are in.
 *
 * A key that already exists is a hard boot error (rule 12.4). Two modules
 * quietly overwriting each other's strings is the kind of bug that only shows
 * up on the one page nobody opened before shipping.
 *
 * @param {string} moduleName for the error message
 * @param {{en: Object, ar: Object}} dicts
 */
export function registerModuleDict(moduleName, dicts) {
  Object.keys(DICTS).forEach((lang) => {
    const incoming = (dicts && dicts[lang]) || {};
    const target = DICTS[lang];

    Object.keys(incoming).forEach((key) => {
      if (key in target) {
        throw new Error(
          `[i18n] Module "${moduleName}" redefines existing ${lang} key "${key}".`
        );
      }
      target[key] = incoming[key];
    });
  });

  // Every key must exist in both languages (Section 8.1). Missing translations
  // fall back to the key itself, which is visible but easy to miss — so say so
  // in the console rather than letting it ship silently.
  const missing = Object.keys((dicts && dicts.en) || {})
    .filter((key) => !((dicts && dicts.ar) || {})[key]);

  if (missing.length) {
    console.warn(`[i18n] Module "${moduleName}" is missing Arabic for:`, missing);
  }
}

/**
 * Translate a key, substituting {placeholder} params. Unknown keys fall back to
 * the key itself, which makes a missing translation obvious in the UI instead of
 * rendering blank.
 *
 * @param {string} key
 * @param {Object} [params] e.g. { cert: 'MCU', days: 12 }
 * @returns {string}
 */
export function t(key, params) {
  const dict = DICTS[currentLang] || en;
  let s = key in dict ? dict[key] : key;

  if (params) {
    for (const p in params) {
      s = s.split('{' + p + '}').join(params[p]);
    }
  }
  return s;
}

/**
 * Switch language: update state, persist to the device, flip document dir/lang,
 * and redraw. Layout flips on its own because all CSS uses logical properties
 * (Section 8.2).
 *
 * @param {'en'|'ar'} lang
 */
export function setLanguage(lang) {
  if (!DICTS[lang] || lang === currentLang) return;
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  applyDocumentLang(lang);
  render();
}

export function getLanguage() {
  return currentLang;
}

/**
 * True when this device has never explicitly picked a language, so
 * Config.primary_language is still allowed to decide. Used once, at boot.
 *
 * @returns {boolean}
 */
export function hasDeviceLanguagePreference() {
  return localStorage.getItem(STORAGE_KEY) !== null;
}
