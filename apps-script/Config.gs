/**
 * Config.gs — platform-wide settings (CLAUDE.md Section 3.3).
 *
 * The Config tab is a flat key/value store. Everything in it is stored as a
 * string; callers coerce when they read. `get_config` is one of only two
 * actions that need no token — the login screen has to render before anyone
 * has logged in.
 */

/**
 * Keys `update_config` is allowed to write. Anything not listed here is
 * rejected as an unknown key.
 *
 * Deliberately excluded: next_employee_number, next_equipment_number,
 * next_vehicle_number. Those counters are owned by the server and incremented
 * under a script lock during ID generation (Section 3.9); letting an admin set
 * them from the UI is how you get duplicate employee IDs.
 */
var ALLOWED_CONFIG_KEYS = [
  'app_name',
  'company_name',
  'primary_language',
  'session_expiry_hours',
  'max_stale_hours',
  'employee_id_prefix',
  'equipment_id_prefix',
  'vehicle_id_prefix',
  'urgent_days',
  'soon_days',
  'drive_folder_url'
];

/** Keys that must parse as a positive number. */
var NUMERIC_CONFIG_KEYS = [
  'session_expiry_hours',
  'max_stale_hours',
  'urgent_days',
  'soon_days'
];

/** Fallbacks used when a Config row is missing or unreadable. */
var CONFIG_DEFAULTS = {
  app_name: 'OHS Platform',
  company_name: 'Landmark',
  primary_language: 'en',
  session_expiry_hours: 8,
  max_stale_hours: 72,
  urgent_days: 30,
  soon_days: 60
};

/** @private Per-request cache — Config is read once per request (Section 3.9). */
var CONFIG_CACHE_ = null;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Every Config row as a plain object keyed by `key`, values as strings.
 * @return {Object<string, string>}
 */
function getConfigMap() {
  if (CONFIG_CACHE_) return CONFIG_CACHE_;

  var rows = readAllRows(SHEET_NAMES.CONFIG);
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var key = normalizeString(rows[i].key);
    if (key === '') continue;
    map[key] = normalizeString(rows[i].value);
  }

  CONFIG_CACHE_ = map;
  return map;
}

/** Drops the cached Config map. Called after any write. */
function clearConfigCache() {
  CONFIG_CACHE_ = null;
}

/**
 * A single Config value as a string, or `fallback` when absent or blank.
 * @param {string} key
 * @param {string=} fallback
 * @return {string}
 */
function getConfigValue(key, fallback) {
  var value = getConfigMap()[key];
  if (value === undefined || value === '') {
    return fallback === undefined ? '' : fallback;
  }
  return value;
}

/**
 * A single Config value as a positive number, or `fallback` when absent or
 * unparseable. Guards every threshold read so one bad cell can't produce NaN
 * comparisons downstream in Compliance.gs.
 *
 * @param {string} key
 * @param {number} fallback
 * @return {number}
 */
function getConfigNumber(key, fallback) {
  var raw = getConfigMap()[key];
  if (raw === undefined || raw === '') return fallback;

  var num = Number(raw);
  if (!isFinite(num) || num <= 0) return fallback;
  return num;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * `get_config` — the boot subset the frontend needs before login.
 *
 * No token required. Returns only these five keys; the rest of the Config tab
 * is never exposed to an unauthenticated caller.
 *
 * @param {Object} payload  Unused.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleGetConfig(payload) {
  return okResponse({
    app_name: getConfigValue('app_name', CONFIG_DEFAULTS.app_name),
    company_name: getConfigValue('company_name', CONFIG_DEFAULTS.company_name),
    primary_language: getConfigValue('primary_language', CONFIG_DEFAULTS.primary_language),
    session_expiry_hours: getConfigNumber('session_expiry_hours', CONFIG_DEFAULTS.session_expiry_hours),
    max_stale_hours: getConfigNumber('max_stale_hours', CONFIG_DEFAULTS.max_stale_hours)
  });
}

/**
 * `update_config` — super admin only.
 *
 * Validates every key against ALLOWED_CONFIG_KEYS and every value against its
 * type rule before writing anything. A payload with one bad key writes nothing.
 *
 * @param {{user: Object}} session  The context returned by validateSession().
 * @param {Object} payload  {updates: {key: value, ...}}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleUpdateConfig(session, payload) {
  if (!session.user.is_super_admin) {
    return errResponse('forbidden', 'super_admin_required');
  }

  var updates = payload && payload.updates;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return errResponse('validation_failed', 'missing_updates', { updates: 'required' });
  }

  var keys = Object.keys(updates);
  if (keys.length === 0) {
    return errResponse('validation_failed', 'missing_updates', { updates: 'required' });
  }

  // --- Validate everything first; write nothing until it all passes ---------
  var fieldErrors = {};
  var clean = {};

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var raw = updates[key];

    if (ALLOWED_CONFIG_KEYS.indexOf(key) === -1) {
      fieldErrors[key] = 'unknown';
      continue;
    }
    if (raw === null || raw === undefined || typeof raw === 'object') {
      fieldErrors[key] = 'invalid_type';
      continue;
    }

    var value = normalizeString(raw);

    if (NUMERIC_CONFIG_KEYS.indexOf(key) !== -1) {
      var num = Number(value);
      if (value === '' || !isFinite(num) || num <= 0) {
        fieldErrors[key] = 'invalid_number';
        continue;
      }
    }

    if (key === 'primary_language' && value !== 'en' && value !== 'ar') {
      fieldErrors[key] = 'invalid_value';
      continue;
    }

    clean[key] = value;
  }

  // Cross-field rule: the two-tier ladder collapses if urgent reaches soon —
  // one tier becomes unreachable in deriveCertState (Section 6.1).
  if (!hasKeys_(fieldErrors)) {
    var current = getConfigMap();
    var urgent = Number(clean.urgent_days !== undefined
      ? clean.urgent_days
      : (current.urgent_days || CONFIG_DEFAULTS.urgent_days));
    var soon = Number(clean.soon_days !== undefined
      ? clean.soon_days
      : (current.soon_days || CONFIG_DEFAULTS.soon_days));

    if (isFinite(urgent) && isFinite(soon) && urgent >= soon) {
      if (clean.urgent_days !== undefined) fieldErrors.urgent_days = 'must_be_less_than_soon_days';
      if (clean.soon_days !== undefined) fieldErrors.soon_days = 'must_be_greater_than_urgent_days';
    }
  }

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_config_updates', fieldErrors);
  }

  // --- Write ---------------------------------------------------------------
  var stampedAt = nowIso();
  var stampedBy = session.user.user_id;

  for (var writeKey in clean) {
    if (!Object.prototype.hasOwnProperty.call(clean, writeKey)) continue;

    var written = updateRowByKey(SHEET_NAMES.CONFIG, 'key', writeKey, {
      value: clean[writeKey],
      updated_at: stampedAt,
      updated_by: stampedBy
    });

    // Allowlisted key with no row yet (Sheet predates the key).
    if (!written) {
      appendRow(SHEET_NAMES.CONFIG, {
        key: writeKey,
        value: clean[writeKey],
        updated_at: stampedAt,
        updated_by: stampedBy
      });
    }
  }

  clearConfigCache();
  return okResponse({ config: getConfigMap() });
}
