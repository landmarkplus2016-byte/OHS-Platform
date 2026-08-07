/**
 * FieldOptions.gs — dropdown option lists and per-module settings
 * (CLAUDE.md Section 3.7).
 *
 * Two tabs live here:
 *
 *   FieldOptions    every list-driven dropdown in the platform, keyed by
 *                   (list_key, option_value). Read by anyone authenticated,
 *                   written by super admins only — a dropdown edit touches
 *                   every module, so it is not a module-admin power.
 *
 *   ModuleSettings  per-module tunables — blocker_certs, warning_certs, and the
 *                   whole rdt_* block Rdt.gs runs on. Read by any authenticated
 *                   admin, written by super admins only, for the same reason:
 *                   these are the rules a module derives by, not a preference.
 *
 * Both are loaded once per request and cached, so a list action that validates
 * fifty rows against `subcontractors` reads the tab once (Section 3.9).
 */

/**
 * Every list the platform recognizes. A `list_key` outside this set is a typo,
 * not a new list — adding a list means adding it here first, the same way a new
 * module joins REGISTERED_MODULES in Auth.gs.
 */
var FIELD_OPTION_LISTS = [
  'field_titles',
  'safety_titles',
  'contractors',
  'subcontractors',
  'employment_status',
  'legal_permission',
  'equipment_items',
  'equipment_brands'
];

/** @private Per-request caches (Section 3.9). */
var FIELD_OPTIONS_CACHE_ = null;
var MODULE_SETTINGS_CACHE_ = null;

// ---------------------------------------------------------------------------
// FieldOptions reads
// ---------------------------------------------------------------------------

/**
 * The whole FieldOptions tab as {list_key: [{option_value, sort_order, active}]},
 * each list sorted by sort_order then value. Every known list is present, empty
 * when the tab holds no rows for it, so callers never branch on undefined.
 *
 * @return {Object<string, Array<Object>>}
 */
function getFieldOptionsMap() {
  if (FIELD_OPTIONS_CACHE_) return FIELD_OPTIONS_CACHE_;

  var map = {};
  for (var k = 0; k < FIELD_OPTION_LISTS.length; k++) map[FIELD_OPTION_LISTS[k]] = [];

  var rows = readAllRows(SHEET_NAMES.FIELD_OPTIONS);
  for (var i = 0; i < rows.length; i++) {
    var listKey = normalizeString(rows[i].list_key);
    var value = normalizeString(rows[i].option_value);
    if (listKey === '' || value === '') continue;

    if (!map[listKey]) map[listKey] = [];
    map[listKey].push({
      option_value: value,
      sort_order: toSortOrder_(rows[i].sort_order, map[listKey].length + 1),
      active: normalizeBoolean(rows[i].active)
    });
  }

  for (var key in map) {
    if (Object.prototype.hasOwnProperty.call(map, key)) map[key].sort(compareOptions_);
  }

  FIELD_OPTIONS_CACHE_ = map;
  return map;
}

/** Drops the cached FieldOptions map. Called after any write to the tab. */
function clearFieldOptionsCache() {
  FIELD_OPTIONS_CACHE_ = null;
}

/**
 * One list's options, or [] when the list is unknown or empty.
 * @param {string} listKey
 * @return {Array<Object>}
 */
function getFieldOptionList(listKey) {
  return getFieldOptionsMap()[normalizeString(listKey)] || [];
}

/**
 * Resolves a submitted value to the option exactly as it is stored, or null
 * when the list has no such option.
 *
 * Matching is case-insensitive and trimmed, and the *stored* spelling is what
 * comes back — so an import carrying 'landmark' is written as 'Landmark' and
 * the list stays free of near-duplicates.
 *
 * Inactive options still resolve. Deactivating an option hides it from new
 * dropdowns; it must not make an existing record unsavable, which is what would
 * happen if an admin edited an old employee's title and the save was rejected
 * over a subcontractor they never touched.
 *
 * @param {string} listKey
 * @param {*} value
 * @return {string|null}
 */
function resolveFieldOption(listKey, value) {
  var target = normalizeString(value).toLowerCase();
  if (target === '') return null;

  var options = getFieldOptionList(listKey);
  for (var i = 0; i < options.length; i++) {
    if (options[i].option_value.toLowerCase() === target) return options[i].option_value;
  }
  return null;
}

/**
 * Appends a new option to a list and returns it as stored. Used by the bulk
 * import path when `auto_add_unknown_options` is set (Section 3.5).
 *
 * A value that already exists is returned untouched rather than duplicated.
 *
 * @param {string} listKey
 * @param {*} value
 * @param {string} actingUserId
 * @return {string} the stored option value
 */
function addFieldOption(listKey, value, actingUserId) {
  var existing = resolveFieldOption(listKey, value);
  if (existing !== null) return existing;

  var key = normalizeString(listKey);
  var option = normalizeString(value);
  var stamped = nowIso();

  appendRow(SHEET_NAMES.FIELD_OPTIONS, {
    list_key: key,
    option_value: option,
    sort_order: String(nextSortOrder_(key)),
    active: 'TRUE',
    updated_at: stamped,
    updated_by: actingUserId
  });

  clearFieldOptionsCache();
  return option;
}

// ---------------------------------------------------------------------------
// ModuleSettings reads
// ---------------------------------------------------------------------------

/**
 * The ModuleSettings tab as a nested map {module: {setting_key: value}} — the
 * canonical shape readModuleSetting_ in Compliance.gs expects.
 *
 * @return {Object<string, Object<string, string>>}
 */
function getModuleSettingsMap() {
  if (MODULE_SETTINGS_CACHE_) return MODULE_SETTINGS_CACHE_;

  var rows = readAllRows(SHEET_NAMES.MODULE_SETTINGS);
  var map = {};

  for (var i = 0; i < rows.length; i++) {
    var module = normalizeString(rows[i].module);
    var key = normalizeString(rows[i].setting_key);
    if (module === '' || key === '') continue;

    if (!map[module]) map[module] = {};
    map[module][key] = normalizeString(rows[i].setting_value);
  }

  MODULE_SETTINGS_CACHE_ = map;
  return map;
}

/** Drops the cached ModuleSettings map. Called after any write to the tab. */
function clearModuleSettingsCache() {
  MODULE_SETTINGS_CACHE_ = null;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * `list_field_options` — any authenticated user.
 *
 * Dropdown values are needed on every form and to render a stored value on
 * every list, so this is deliberately the least gated read in the API. It
 * exposes nothing but the option strings themselves.
 *
 * @param {Object} session  Context from validateSession(). Unused beyond auth.
 * @param {Object} payload  {list_key?} — omit for every list.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListFieldOptions(session, payload) {
  var unknown = collectUnknownKeys_(payload, ['list_key']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var listKey = normalizeString(payload && payload.list_key);
  if (listKey === '') {
    return okResponse({ options: getFieldOptionsMap() });
  }

  if (FIELD_OPTION_LISTS.indexOf(listKey) === -1) {
    return errResponse('validation_failed', 'unknown_list_key', { list_key: 'unknown' });
  }

  var single = {};
  single[listKey] = getFieldOptionList(listKey);
  return okResponse({ options: single });
}

/**
 * `update_field_options` — super admin only.
 *
 * Full replacement of one list. Options in the payload are upserted; options
 * already in the tab but absent from the payload are deactivated rather than
 * removed, so an employee or equipment row that still references a retired
 * value keeps displaying it (Section 3.7).
 *
 * Everything is validated before anything is written — a list with one bad
 * entry leaves the tab untouched.
 *
 * @param {{user: Object}} session
 * @param {Object} payload  {list_key, options: [{option_value, sort_order?, active?}]}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleUpdateFieldOptions(session, payload) {
  if (!session.user.is_super_admin) {
    return errResponse('forbidden', 'super_admin_required');
  }

  var unknown = collectUnknownKeys_(payload, ['list_key', 'options']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var listKey = normalizeString(payload && payload.list_key);
  var options = payload && payload.options;

  var fieldErrors = {};
  if (listKey === '') {
    fieldErrors.list_key = 'required';
  } else if (FIELD_OPTION_LISTS.indexOf(listKey) === -1) {
    fieldErrors.list_key = 'unknown';
  }
  if (!Array.isArray(options)) fieldErrors.options = 'required';

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  // --- Validate every entry, collecting the clean set ----------------------
  var clean = [];
  var seen = {};

  for (var i = 0; i < options.length; i++) {
    var entry = options[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fieldErrors['options[' + i + ']'] = 'invalid_type';
      continue;
    }

    var value = normalizeString(entry.option_value);
    if (value === '') {
      fieldErrors['options[' + i + '].option_value'] = 'required';
      continue;
    }

    var dedupeKey = value.toLowerCase();
    if (seen[dedupeKey]) {
      fieldErrors['options[' + i + '].option_value'] = 'duplicate';
      continue;
    }
    seen[dedupeKey] = true;

    var sortOrder = (entry.sort_order === undefined || entry.sort_order === '')
      ? i + 1
      : Number(entry.sort_order);
    if (!isFinite(sortOrder)) {
      fieldErrors['options[' + i + '].sort_order'] = 'invalid_number';
      continue;
    }

    clean.push({
      option_value: value,
      dedupe_key: dedupeKey,
      sort_order: Math.round(sortOrder),
      active: entry.active === undefined ? true : normalizeBoolean(entry.active)
    });
  }

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_options', fieldErrors);
  }

  // --- Write ---------------------------------------------------------------
  var stampedAt = nowIso();
  var stampedBy = session.user.user_id;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('update_field_options: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var pairs = readAllRowsWithIndex(SHEET_NAMES.FIELD_OPTIONS);
    var existingByValue = {};

    for (var r = 0; r < pairs.length; r++) {
      if (normalizeString(pairs[r].data.list_key) !== listKey) continue;
      var stored = normalizeString(pairs[r].data.option_value);
      if (stored === '') continue;
      existingByValue[stored.toLowerCase()] = pairs[r];
    }

    // Upsert everything the payload carries.
    var rowUpdates = [];
    var additions = [];

    for (var c = 0; c < clean.length; c++) {
      var fields = {
        list_key: listKey,
        option_value: clean[c].option_value,
        sort_order: String(clean[c].sort_order),
        active: booleanToSheet(clean[c].active),
        updated_at: stampedAt,
        updated_by: stampedBy
      };

      var target = existingByValue[clean[c].dedupe_key];
      if (target) {
        rowUpdates.push({ row: target.row, data: fields });
        delete existingByValue[clean[c].dedupe_key];
      } else {
        additions.push(fields);
      }
    }

    // Whatever is left was dropped from the list — soft-delete it (rule 6).
    for (var leftover in existingByValue) {
      if (!Object.prototype.hasOwnProperty.call(existingByValue, leftover)) continue;
      rowUpdates.push({
        row: existingByValue[leftover].row,
        data: { active: 'FALSE', updated_at: stampedAt, updated_by: stampedBy }
      });
    }

    updateRowsAt(SHEET_NAMES.FIELD_OPTIONS, rowUpdates);
    appendRows(SHEET_NAMES.FIELD_OPTIONS, additions);
  } finally {
    lock.releaseLock();
  }

  clearFieldOptionsCache();

  var result = {};
  result[listKey] = getFieldOptionList(listKey);
  return okResponse({ options: result });
}

/**
 * `list_module_settings` — the ModuleSettings tab, whole or for one module
 * (Section 3.7).
 *
 * Readable by any authenticated admin, because the settings decide what pages
 * show: the RDT page cannot render its onboarding state without knowing whether
 * RDT is on. Officers never reach this — the shell routes them elsewhere and
 * officer_sync strips settings from their snapshot regardless.
 *
 * @param {Object} session
 * @param {Object} payload  {module?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListModuleSettings(session, payload) {
  var unknown = collectUnknownKeys_(payload, ['module']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var module = normalizeString(payload && payload.module);
  var map = getModuleSettingsMap();

  if (module === '') return okResponse({ settings: map });

  var single = {};
  single[module] = map[module] || {};
  return okResponse({ settings: single });
}

/**
 * `update_module_settings` — super admin only (Section 3.7).
 *
 * Same reasoning as update_field_options: these are the numbers a module's
 * behavior is derived from, so changing one changes what every admin sees. A
 * module admin who owns `employees` still cannot rewrite the rules the
 * employees module runs by.
 *
 * Keys are upserted, not replaced wholesale — sending one key leaves the rest
 * of the module's settings untouched. That matters because the RDT settings
 * form and a future compliance-rules form would both write to `employees`, and
 * neither should silently blank the other's rows.
 *
 * @param {{user: Object}} session
 * @param {Object} payload  {module, updates: {key: value}}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleUpdateModuleSettings(session, payload) {
  if (!session.user.is_super_admin) {
    return errResponse('forbidden', 'super_admin_required');
  }

  var unknown = collectUnknownKeys_(payload, ['module', 'updates']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var module = normalizeString(payload && payload.module);
  var updates = payload && payload.updates;

  var fieldErrors = {};
  if (module === '') fieldErrors.module = 'required';
  else if (REGISTERED_MODULES.indexOf(module) === -1) fieldErrors.module = 'unknown';

  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    fieldErrors.updates = 'required';
  }

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  // Everything on this tab is stored as a string (Section 2). Coercion into
  // numbers and booleans happens where a setting is read, not here — this
  // handler has no idea what any given key means.
  var clean = {};
  for (var key in updates) {
    if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;

    var settingKey = normalizeString(key);
    if (settingKey === '') {
      fieldErrors.updates = 'invalid_key';
      continue;
    }
    clean[settingKey] = normalizeString(updates[key]);
  }

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  var stampedAt = nowIso();
  var stampedBy = session.user.user_id;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('update_module_settings: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var pairs = readAllRowsWithIndex(SHEET_NAMES.MODULE_SETTINGS);
    var existing = {};

    for (var r = 0; r < pairs.length; r++) {
      if (normalizeString(pairs[r].data.module) !== module) continue;
      var storedKey = normalizeString(pairs[r].data.setting_key);
      if (storedKey !== '') existing[storedKey] = pairs[r];
    }

    var rowUpdates = [];
    var additions = [];

    for (var settingName in clean) {
      if (!Object.prototype.hasOwnProperty.call(clean, settingName)) continue;

      var fields = {
        module: module,
        setting_key: settingName,
        setting_value: clean[settingName],
        updated_at: stampedAt,
        updated_by: stampedBy
      };

      if (existing[settingName]) rowUpdates.push({ row: existing[settingName].row, data: fields });
      else additions.push(fields);
    }

    updateRowsAt(SHEET_NAMES.MODULE_SETTINGS, rowUpdates);
    appendRows(SHEET_NAMES.MODULE_SETTINGS, additions);
  } finally {
    lock.releaseLock();
  }

  clearModuleSettingsCache();

  var result = {};
  result[module] = getModuleSettingsMap()[module] || {};
  return okResponse({ settings: result });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** @private sort_order as a number, falling back to the row's position. */
function toSortOrder_(raw, fallback) {
  var num = Number(normalizeString(raw));
  return isFinite(num) ? num : fallback;
}

/** @private Orders a list by sort_order, then alphabetically to break ties. */
function compareOptions_(a, b) {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.option_value.toLowerCase() < b.option_value.toLowerCase() ? -1 : 1;
}

/** @private The next free sort_order for a list — one past its current max. */
function nextSortOrder_(listKey) {
  var options = getFieldOptionList(listKey);
  var max = 0;
  for (var i = 0; i < options.length; i++) {
    if (options[i].sort_order > max) max = options[i].sort_order;
  }
  return max + 1;
}
