/**
 * Sheets.gs — the only file that touches SpreadsheetApp.
 *
 * Every other .gs file reads and writes through these helpers. Rows are plain
 * objects keyed by the header names in row 1 of each tab, so callers work with
 * `row.employee_id` rather than column indexes.
 *
 * The Sheet ID never appears anywhere: this script is container-bound to
 * 'OHS Platform DB', so getActiveSpreadsheet() is enough (CLAUDE.md rule 3).
 *
 * Storage format: every cell is written as plain text so the Sheet holds
 * exactly what CLAUDE.md Section 2 specifies — ISO date strings, literal
 * 'TRUE'/'FALSE', blank for empty — and Sheets never silently converts a date
 * string into a date serial. The flip side is that reads return strings for
 * numeric columns too; callers coerce with Number() where they need a number.
 */

/** The 12 tabs from CLAUDE.md Section 2. */
var SHEET_NAMES = {
  CONFIG: 'Config',
  USERS: 'Users',
  SESSIONS: 'Sessions',
  PERMISSIONS: 'Permissions',
  EMPLOYEES: 'Employees',
  RENEWAL_HISTORY: 'RenewalHistory',
  EQUIPMENT: 'Equipment',
  INSPECTION_HISTORY: 'InspectionHistory',
  FIELD_OPTIONS: 'FieldOptions',
  MODULE_SETTINGS: 'ModuleSettings',
  VEHICLES: 'Vehicles',
  VEHICLE_HISTORY: 'VehicleHistory'
};

// ---------------------------------------------------------------------------
// Per-request caches
//
// Each Web App request is its own script execution, so these globals live and
// die with the request — exactly the "cached in-memory for the duration of the
// request" behavior described in CLAUDE.md Section 3.9.
// ---------------------------------------------------------------------------

/** @private {Object|null} */
var SPREADSHEET_CACHE_ = null;
/** @private {Object} tab name → Sheet */
var SHEET_CACHE_ = {};
/** @private {Object} tab name → array of header strings */
var HEADER_CACHE_ = {};

/**
 * Drops the per-request caches. Only needed by long-running entry points (the
 * nightly trigger, manual test functions) that outlive a single logical request.
 */
function clearSheetCache() {
  SPREADSHEET_CACHE_ = null;
  SHEET_CACHE_ = {};
  HEADER_CACHE_ = {};
}

/** @private @return {GoogleAppsScript.Spreadsheet.Spreadsheet} */
function getSpreadsheet_() {
  if (!SPREADSHEET_CACHE_) {
    SPREADSHEET_CACHE_ = SpreadsheetApp.getActiveSpreadsheet();
    if (!SPREADSHEET_CACHE_) {
      throw new Error('No active spreadsheet — this script must stay bound to OHS Platform DB.');
    }
  }
  return SPREADSHEET_CACHE_;
}

// ---------------------------------------------------------------------------
// Sheet and header access
// ---------------------------------------------------------------------------

/**
 * Returns a tab by name. Throws if the tab does not exist — a missing tab is a
 * setup error, not a runtime condition to handle.
 *
 * @param {string} name
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet(name) {
  if (SHEET_CACHE_[name]) return SHEET_CACHE_[name];

  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Sheet tab not found: ' + name);

  SHEET_CACHE_[name] = sheet;
  return sheet;
}

/**
 * Returns row 1 of a tab as an array of header strings, cached per request.
 * Trailing empty header cells are dropped.
 *
 * @param {string} sheetName
 * @return {Array<string>}
 */
function getHeaders(sheetName) {
  if (HEADER_CACHE_[sheetName]) return HEADER_CACHE_[sheetName];

  var sheet = getSheet(sheetName);
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) throw new Error('Sheet has no header row: ' + sheetName);

  var raw = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = [];
  for (var i = 0; i < raw.length; i++) {
    headers.push(String(raw[i]).trim());
  }
  while (headers.length && headers[headers.length - 1] === '') headers.pop();
  if (!headers.length) throw new Error('Sheet has no header row: ' + sheetName);

  HEADER_CACHE_[sheetName] = headers;
  return headers;
}

/**
 * 1-based column number for a header name.
 * @param {string} sheetName
 * @param {string} headerName
 * @return {number}
 */
function getColumnIndex(sheetName, headerName) {
  var headers = getHeaders(sheetName);
  var idx = headers.indexOf(headerName);
  if (idx === -1) {
    throw new Error('Unknown column "' + headerName + '" on sheet ' + sheetName);
  }
  return idx + 1;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Reads every data row of a tab as an object keyed by header name.
 * Returns [] when the tab holds only its header row.
 *
 * @param {string} sheetName
 * @return {Array<Object>}
 */
function readAllRows(sheetName) {
  var pairs = readAllRowsWithIndex(sheetName);
  var out = [];
  for (var i = 0; i < pairs.length; i++) out.push(pairs[i].data);
  return out;
}

/**
 * Same as readAllRows but each entry carries its 1-based sheet row number, for
 * callers that need to write back to a specific row.
 *
 * @param {string} sheetName
 * @return {Array<{row: number, data: Object}>}
 */
function readAllRowsWithIndex(sheetName) {
  var sheet = getSheet(sheetName);
  var headers = getHeaders(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    out.push({ row: r + 2, data: rowValuesToObject_(headers, values[r]) });
  }
  return out;
}

/**
 * Finds the first row whose `keyColumn` equals `keyValue`.
 *
 * Comparison is trimmed string equality — IDs, tokens, and usernames are all
 * text. Case-sensitive by design; callers that need a case-insensitive match
 * (username lookup in Auth.gs) scan readAllRows themselves.
 *
 * @param {string} sheetName
 * @param {string} keyColumn
 * @param {*} keyValue
 * @return {Object|null}
 */
function readRowByKey(sheetName, keyColumn, keyValue) {
  var found = findRowByKey_(sheetName, keyColumn, keyValue);
  return found ? found.data : null;
}

/**
 * Every row matching a column value — for tabs with non-unique keys such as
 * Permissions (per user), RenewalHistory (per employee), or FieldOptions
 * (per list_key).
 *
 * @param {string} sheetName
 * @param {string} column
 * @param {*} value
 * @return {Array<Object>}
 */
function readRowsWhere(sheetName, column, value) {
  var target = normalizeKey_(value);
  var rows = readAllRows(sheetName);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (normalizeKey_(rows[i][column]) === target) out.push(rows[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Appends one row, mapping the object onto the tab's header order. Headers with
 * no matching key are written blank. Keys that match no header are ignored with
 * a logged warning — a typo shouldn't silently discard a whole write, but it
 * shouldn't blow up an otherwise valid one either.
 *
 * @param {string} sheetName
 * @param {Object} rowObject
 * @return {number} the 1-based row number written
 */
function appendRow(sheetName, rowObject) {
  var sheet = getSheet(sheetName);
  var headers = getHeaders(sheetName);

  warnUnknownKeys_(sheetName, headers, rowObject);

  var targetRow = sheet.getLastRow() + 1;
  writeRow_(sheet, headers, targetRow, objectToRowValues_(headers, rowObject));
  return targetRow;
}

/**
 * Appends many rows in a single write.
 *
 * The per-row appendRow re-reads getLastRow() and issues its own setValues, so
 * a 2,000-row import would spend the whole execution budget on round trips.
 * This builds the full block in memory and writes it once.
 *
 * @param {string} sheetName
 * @param {Array<Object>} rowObjects
 * @return {number} the 1-based row number of the first row written, or 0 when
 *     `rowObjects` was empty.
 */
function appendRows(sheetName, rowObjects) {
  if (!rowObjects || rowObjects.length === 0) return 0;

  var sheet = getSheet(sheetName);
  var headers = getHeaders(sheetName);

  var values = [];
  for (var i = 0; i < rowObjects.length; i++) {
    warnUnknownKeys_(sheetName, headers, rowObjects[i]);
    values.push(objectToRowValues_(headers, rowObjects[i]));
  }

  var startRow = sheet.getLastRow() + 1;
  var range = sheet.getRange(startRow, 1, values.length, headers.length);
  range.setNumberFormat('@');
  range.setValues(values);
  return startRow;
}

/**
 * Merges `updatesObject` into a row identified by its sheet row number.
 *
 * The counterpart to updateRowByKey for callers that already know the row —
 * either because they hold it from readAllRowsWithIndex, or because the tab has
 * a composite key (FieldOptions is keyed by list_key + option_value) that
 * single-column matching cannot express.
 *
 * @param {string} sheetName
 * @param {number} rowNumber  1-based; must be >= 2 (row 1 is the header).
 * @param {Object} updatesObject
 * @return {Object|null} the merged row, or null when the row number is out of range
 */
function updateRowAt(sheetName, rowNumber, updatesObject) {
  var sheet = getSheet(sheetName);
  var headers = getHeaders(sheetName);
  if (!(rowNumber >= 2) || rowNumber > sheet.getLastRow()) return null;

  warnUnknownKeys_(sheetName, headers, updatesObject);

  var current = rowValuesToObject_(
    headers,
    sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0]
  );

  var values = objectToRowValues_(headers, mergeRow_(headers, current, updatesObject));
  writeRow_(sheet, headers, rowNumber, values);
  return rowValuesToObject_(headers, values);
}

/**
 * Merges updates into many rows with one read and one write.
 *
 * Used by the batch paths — bulk import overwrites and RDT wave recording —
 * where the per-row helpers would cost two range operations per employee.
 * Rewriting the whole data range is last-write-wins against a concurrent
 * editor, which is the concurrency model CLAUDE.md already accepts; callers
 * still take a script lock so two batch writes cannot interleave.
 *
 * @param {string} sheetName
 * @param {Array<{row: number, data: Object}>} updates
 * @return {number} how many rows were merged
 */
function updateRowsAt(sheetName, updates) {
  if (!updates || updates.length === 0) return 0;

  var sheet = getSheet(sheetName);
  var headers = getHeaders(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var range = sheet.getRange(2, 1, lastRow - 1, headers.length);
  var values = range.getValues();
  var touched = 0;

  for (var i = 0; i < updates.length; i++) {
    var index = updates[i].row - 2;
    if (index < 0 || index >= values.length) continue;

    warnUnknownKeys_(sheetName, headers, updates[i].data);
    var current = rowValuesToObject_(headers, values[index]);
    values[index] = objectToRowValues_(headers, mergeRow_(headers, current, updates[i].data));
    touched++;
  }

  if (touched === 0) return 0;

  range.setNumberFormat('@');
  range.setValues(values);
  return touched;
}

/**
 * Merges `updatesObject` into the row matched by `keyColumn`/`keyValue` and
 * writes it back. Fields absent from `updatesObject` keep their current value.
 *
 * @param {string} sheetName
 * @param {string} keyColumn
 * @param {*} keyValue
 * @param {Object} updatesObject
 * @return {Object|null} the merged row, or null when no row matched
 */
function updateRowByKey(sheetName, keyColumn, keyValue, updatesObject) {
  var found = findRowByKey_(sheetName, keyColumn, keyValue);
  if (!found) return null;

  var headers = getHeaders(sheetName);
  warnUnknownKeys_(sheetName, headers, updatesObject);

  var values = objectToRowValues_(headers, mergeRow_(headers, found.data, updatesObject));
  writeRow_(getSheet(sheetName), headers, found.row, values);
  return rowValuesToObject_(headers, values);
}

/**
 * Removes the first row matching `keyColumn`/`keyValue`.
 *
 * Hard deletion is only ever legitimate on Sessions (logout, expiry cleanup,
 * single-session enforcement) and Permissions (full replacement of a user's
 * grants). Entity tabs never delete — employees archive, equipment gets
 * rejected, users deactivate (CLAUDE.md rule 6).
 *
 * @param {string} sheetName
 * @param {string} keyColumn
 * @param {*} keyValue
 * @return {boolean} true if a row was removed
 */
function deleteRowByKey(sheetName, keyColumn, keyValue) {
  var found = findRowByKey_(sheetName, keyColumn, keyValue);
  if (!found) return false;
  getSheet(sheetName).deleteRow(found.row);
  return true;
}

/**
 * Removes every row matching `keyColumn`/`keyValue`. Deletes bottom-up so
 * earlier row numbers stay valid as rows shift.
 *
 * @param {string} sheetName
 * @param {string} keyColumn
 * @param {*} keyValue
 * @return {number} how many rows were removed
 */
function deleteRowsWhere(sheetName, keyColumn, keyValue) {
  var target = normalizeKey_(keyValue);
  var pairs = readAllRowsWithIndex(sheetName);
  var sheet = getSheet(sheetName);
  var removed = 0;

  for (var i = pairs.length - 1; i >= 0; i--) {
    if (normalizeKey_(pairs[i].data[keyColumn]) === target) {
      sheet.deleteRow(pairs[i].row);
      removed++;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** @private @return {{row: number, data: Object}|null} */
function findRowByKey_(sheetName, keyColumn, keyValue) {
  var target = normalizeKey_(keyValue);
  if (target === '') return null;

  var pairs = readAllRowsWithIndex(sheetName);
  for (var i = 0; i < pairs.length; i++) {
    if (normalizeKey_(pairs[i].data[keyColumn]) === target) return pairs[i];
  }
  return null;
}

/**
 * @private
 * Builds a full header-keyed row from a current row plus a set of updates.
 * Only keys that are real headers are taken from `updates`; everything else
 * keeps its current value, so a partial update never blanks a column.
 */
function mergeRow_(headers, current, updates) {
  var merged = {};
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    merged[h] = (updates && Object.prototype.hasOwnProperty.call(updates, h))
      ? updates[h]
      : current[h];
  }
  return merged;
}

/** @private Normalizes any key-ish value to a comparable string. */
function normalizeKey_(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return normalizeIsoDateTime(value);
  return String(value).trim();
}

/**
 * @private
 * Converts one row of raw cell values into a header-keyed object. Date cells
 * become ISO strings so callers never handle a Date; everything else is
 * stringified and trimmed, keeping the "blank means empty" convention.
 */
function rowValuesToObject_(headers, values) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    var v = values[i];
    if (v === null || v === undefined) {
      obj[headers[i]] = '';
    } else if (v instanceof Date) {
      obj[headers[i]] = normalizeIsoDateTime(v);
    } else if (typeof v === 'boolean') {
      obj[headers[i]] = v ? 'TRUE' : 'FALSE';
    } else {
      obj[headers[i]] = String(v).trim();
    }
  }
  return obj;
}

/**
 * @private
 * Converts a header-keyed object into an array of cell values in header order,
 * applying the storage conventions from CLAUDE.md Section 2.
 */
function objectToRowValues_(headers, obj) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    row.push(toCellValue_(obj[headers[i]]));
  }
  return row;
}

/** @private */
function toCellValue_(value) {
  if (value === null || value === undefined) return '';
  if (value === true) return 'TRUE';
  if (value === false) return 'FALSE';
  if (value instanceof Date) return normalizeIsoDateTime(value);
  if (typeof value === 'number') return String(value);
  return String(value);
}

/**
 * @private
 * Writes a full row and forces plain-text formatting first, so ISO date
 * strings stay strings instead of being converted into date serials.
 */
function writeRow_(sheet, headers, rowNumber, values) {
  var range = sheet.getRange(rowNumber, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([values]);
}

/** @private Logs — but does not reject — object keys that match no header. */
function warnUnknownKeys_(sheetName, headers, obj) {
  if (!obj) return;
  var unknown = [];
  for (var key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    if (headers.indexOf(key) === -1) unknown.push(key);
  }
  if (unknown.length) {
    console.warn('Sheets: ignoring unknown column(s) on ' + sheetName + ': ' + unknown.join(', '));
  }
}
