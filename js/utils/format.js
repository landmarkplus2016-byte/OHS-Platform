/* ==========================================================================
   format.js — pure display helpers. No state, no DOM, no API.

   escapeHtml and initials so far. fmtDate, daysUntil and todayISO join them
   when the first date-rendering page lands (Stage 5).
   ========================================================================== */

/**
 * Escape a value for safe interpolation into an HTML template literal.
 *
 * Every piece of server data that reaches innerHTML goes through this — the app
 * renders by string concatenation, so an unescaped apostrophe in a name is a
 * broken page and an unescaped tag is an injection.
 *
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * First letters of the first two words of a name, for an avatar bubble.
 *
 * Works the same in Arabic — it takes whatever the first characters are without
 * assuming a script, and the browser lays them out per the document direction.
 *
 * @param {string} name e.g. 'Ahmed Hassan'
 * @returns {string} e.g. 'AH'
 */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}
