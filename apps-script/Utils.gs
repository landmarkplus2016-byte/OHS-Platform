/**
 * Utils.gs — response envelopes, timestamps, IDs, and value normalization.
 *
 * Everything in here is shared by every other .gs file. Apps Script puts all
 * top-level functions in one global scope, so these are callable directly from
 * Main.gs, Auth.gs, Sheets.gs, etc. with no imports.
 *
 * Conventions enforced here (CLAUDE.md Section 2, "Data type conventions"):
 *   - Dates      → 'YYYY-MM-DD'
 *   - Datetimes  → 'YYYY-MM-DDTHH:MM:SS' (UTC)
 *   - Booleans   → literal 'TRUE' / 'FALSE' in the Sheet, real booleans in JS
 *   - Empty      → '' (never null, never 'N/A', never '-')
 */

// ---------------------------------------------------------------------------
// Response envelopes (CLAUDE.md Section 3.1)
// ---------------------------------------------------------------------------

/**
 * Wraps any object as a JSON text response.
 *
 * Note: Apps Script Web Apps ignore attempts to set arbitrary response headers,
 * so the MIME type is the only thing we control. The frontend posts as
 * text/plain to dodge the CORS preflight; the response coming back as JSON is
 * fine.
 *
 * @param {Object} obj
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Success envelope: {ok: true, data: {...}}
 * @param {Object} data
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function okResponse(data) {
  return jsonResponse({ ok: true, data: data || {} });
}

/**
 * Failure envelope: {ok: false, error, message, field_errors}
 *
 * `code` must be one of the fixed error codes in CLAUDE.md Section 3.1:
 * unauthenticated | forbidden | not_found | validation_failed | conflict |
 * rate_limited | server_error. No ad-hoc error strings.
 *
 * `message` is for developer console visibility only — the frontend maps
 * `error` (and each `field_errors` value) to an i18n key and never displays
 * `message` to an end user.
 *
 * @param {string} code
 * @param {string} message
 * @param {Object=} fieldErrors  Map of field name → stable error code.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function errResponse(code, message, fieldErrors) {
  return jsonResponse({
    ok: false,
    error: code,
    message: (message === undefined || message === null) ? '' : String(message),
    field_errors: fieldErrors || null
  });
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Current UTC datetime as 'YYYY-MM-DDTHH:MM:SS' (no milliseconds, no trailing Z).
 * @return {string}
 */
function nowIso() {
  return new Date().toISOString().slice(0, 19);
}

/**
 * Current UTC date as 'YYYY-MM-DD'.
 * @return {string}
 */
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

/**
 * RFC 4122 version 4 UUID, lowercase hex with dashes.
 *
 * Used for session tokens. Utilities.getUuid() is Apps Script's built-in v4
 * generator; this wrapper exists so callers never reach for Utilities directly.
 *
 * @return {string}
 */
function generateUuid() {
  return Utilities.getUuid().toLowerCase();
}

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

/**
 * Coerces a Sheet cell (or a payload field) to a real boolean.
 *
 * True only for real `true` or the literal string 'TRUE' (case-insensitive,
 * trimmed). Everything else — 'FALSE', '', 0, 1, 'yes', null, undefined — is
 * false. Deliberately strict: the Sheet stores 'TRUE'/'FALSE' and nothing else,
 * so anything unexpected should fail closed.
 *
 * @param {*} value
 * @return {boolean}
 */
function normalizeBoolean(value) {
  if (value === true) return true;
  if (typeof value === 'string' && value.trim().toUpperCase() === 'TRUE') return true;
  return false;
}

/**
 * Serializes a boolean for storage in the Sheet as the literal 'TRUE'/'FALSE'.
 * @param {*} value
 * @return {string}
 */
function booleanToSheet(value) {
  return normalizeBoolean(value) ? 'TRUE' : 'FALSE';
}

/**
 * Coerces any date-ish value to 'YYYY-MM-DD', or '' when there is no date.
 *
 * Handles the three shapes a date can arrive in:
 *   1. A JS Date — what getValues() returns for a real date cell. Read with
 *      LOCAL getters, because Sheets builds that Date at midnight in the
 *      script's timezone; using toISOString() here would shift the day
 *      backwards for any timezone east of UTC (Cairo is UTC+2/+3, so it always
 *      would).
 *   2. A number — a raw Sheets date serial (days since 1899-12-30).
 *   3. A string — already ISO, an ISO datetime we truncate, or something else
 *      parseable. Anything unparseable returns ''.
 *
 * @param {*} value
 * @return {string} 'YYYY-MM-DD' or ''
 */
function normalizeIsoDate(value) {
  if (value === null || value === undefined || value === '') return '';

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return formatLocalDate_(value);
  }

  if (typeof value === 'number') {
    if (!isFinite(value)) return '';
    // Sheets serial epoch is 1899-12-30. Build in UTC and read back in UTC so
    // no timezone shift can creep in.
    var fromSerial = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
    if (isNaN(fromSerial.getTime())) return '';
    return fromSerial.toISOString().slice(0, 10);
  }

  var str = String(value).trim();
  if (str === '') return '';

  // Already 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM:SS' — take the date part as-is.
  var isoMatch = str.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];

  var parsed = new Date(str);
  if (isNaN(parsed.getTime())) return '';
  return formatLocalDate_(parsed);
}

/**
 * Coerces any datetime-ish value to 'YYYY-MM-DDTHH:MM:SS', or '' when empty.
 *
 * Date objects from the Sheet are read with local getters for the same reason
 * as normalizeIsoDate — the value was written in the script's timezone and
 * should read back unchanged, not shifted.
 *
 * @param {*} value
 * @return {string}
 */
function normalizeIsoDateTime(value) {
  if (value === null || value === undefined || value === '') return '';

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return formatLocalDate_(value) + 'T' + formatLocalTime_(value);
  }

  var str = String(value).trim();
  if (str === '') return '';

  var isoMatch = str.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (isoMatch) return isoMatch[1] + 'T' + isoMatch[2];

  // A bare date is a valid datetime at midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str + 'T00:00:00';

  var parsed = new Date(str);
  if (isNaN(parsed.getTime())) return '';
  return formatLocalDate_(parsed) + 'T' + formatLocalTime_(parsed);
}

/**
 * Trims any value to a string. null/undefined become ''.
 * @param {*} value
 * @return {string}
 */
function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * True when the object has at least one own key. Used to decide whether a
 * collected field_errors map should turn into a validation_failed response.
 *
 * @param {Object} obj
 * @return {boolean}
 */
function hasKeys_(obj) {
  if (!obj) return false;
  for (var k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Private formatting helpers
// ---------------------------------------------------------------------------

/** @private */
function pad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

/** @private Formats a Date's LOCAL calendar day as 'YYYY-MM-DD'. */
function formatLocalDate_(d) {
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
}

/** @private Formats a Date's LOCAL wall-clock time as 'HH:MM:SS'. */
function formatLocalTime_(d) {
  return pad2_(d.getHours()) + ':' + pad2_(d.getMinutes()) + ':' + pad2_(d.getSeconds());
}
