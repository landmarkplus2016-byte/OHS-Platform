/* ==========================================================================
   format.js — pure display helpers. No state, no DOM, no API.

   Stage 3 needs escapeHtml only. fmtDate, daysUntil and todayISO join it when
   the first date-rendering page lands (Stage 4).
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
