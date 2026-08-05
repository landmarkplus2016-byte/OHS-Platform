/* ==========================================================================
   excelImport.js — bulk-loading a workbook the admin picked off their disk.

   Ported from OHS-DB's file of the same name, in the same three stages:

     parseWorkbook       bytes            → { rows, warnings }
     buildImportPreview  parsed + current → { rows, summary }   (pure)
     — commit lives in the caller, because the platform writes through the API

   OHS-DB's third stage wrote to a local DATA object. Here the write is
   `bulk_import_employees` / `bulk_import_equipment`, so this file stops at the
   reviewed preview and js/shell/settingsPage.js turns it into API calls.

   The other difference: OHS-DB set nested paths (`personal.subcontractor`).
   The platform's Sheet columns are flat (Section 2), so a column target is just
   a key.

   Uses the CDN global window.XLSX loaded by index.html. Never an npm package.

   WHAT THIS FILE DOES NOT DO
   --------------------------
   It does not validate business rules. Whether a title exists in FieldOptions,
   whether a date is real, whether a national_id collides — the server answers
   all of that per row (Section 3.5) and rejects the whole batch if any row
   fails. What the preview decides is only which rows to *send* and what to do
   with duplicates, which is a question the server cannot answer for the admin.
   ========================================================================== */

import { t } from '../i18n/i18n.js';

/** Rows per call, matching the server's cap (Section 3.9). */
export const IMPORT_MAX_ROWS = 5000;

/**
 * Thrown for a file this module cannot get as far as rows. `code` is an i18n key
 * suffix, so callers render it with t('import_err_' + code).
 */
export class ImportError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'ImportError';
    this.code = code;
  }
}

/* ---------- Header normalisation ------------------------------------------ */

/**
 * Collapses a header to a comparable form: lowercase, punctuation to spaces, a
 * space inserted at every letter/digit boundary, whitespace squeezed.
 *
 * This is what makes 'Sub-Contractor', 'sub contractor' and 'SubContractor' one
 * key, and what lets the single alias 'wah p' cover both 'WAHP' and 'WAH P'.
 * Straight from OHS-DB — it has been fed real Landmark workbooks.
 *
 * @param {*} header
 * @returns {string}
 */
export function normHeader(header) {
  return String(header == null ? '' : header)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------- Cell parsing --------------------------------------------------- */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

/** Rejects impossible dates, so a misread never becomes a real-looking expiry. */
function isValidYMD(y, m, d) {
  if (!(y >= 1900 && y <= 2200)) return false;
  if (!(m >= 1 && m <= 12)) return false;

  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d >= 1 && d <= daysInMonth;
}

/** Two-digit years: 70-99 are 1900s, 00-69 are 2000s. */
function fixYear(y) {
  if (y >= 1000) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

/**
 * Excel serial day → 'YYYY-MM-DD'.
 *
 * 25569 is the serial of 1970-01-01, and the offset absorbs Excel's fictional
 * 1900-02-29 for every date after 1900-03-01 — every date this app will see.
 * Read back in UTC so no timezone can shift the day.
 */
function fromSerial(n) {
  const days = Math.floor(n);
  if (!(days >= 1 && days < 300000)) return '';

  const date = new Date((days - 25569) * 86400000);
  if (Number.isNaN(date.getTime())) return '';

  return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * Text date → 'YYYY-MM-DD', or '' if it is not a date this app understands.
 *
 * Purely numeric forms are read DAY-FIRST — '05/03/2026' is 5 March. There is
 * no way to tell 05/03 from 03/05 in the data, so the convention is fixed
 * rather than guessed per row, and it matches the workbooks' origin.
 */
function parseDateString(raw) {
  const s = String(raw).trim();
  if (!s) return '';

  // ISO, or the leading date of an ISO timestamp.
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]|$)/.exec(s);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return isValidYMD(y, mo, d) ? ymd(y, mo, d) : '';
  }

  // Numeric, day-first: 04/03/2026, 04-03-26, 04.03.2026
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
  if (m) {
    const [d, mo, y] = [+m[1], +m[2], fixYear(+m[3])];
    return isValidYMD(y, mo, d) ? ymd(y, mo, d) : '';
  }

  // Month-name, day-first: 04-Mar-2026, 4 March 2026
  m = /^(\d{1,2})[\s\-/]+([a-z]{3,9})\.?[\s\-/]+(\d{2,4})$/i.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    const [d, y] = [+m[1], fixYear(+m[3])];
    return mo && isValidYMD(y, mo, d) ? ymd(y, mo, d) : '';
  }

  // Month-name first: Mar 4, 2026
  m = /^([a-z]{3,9})\.?[\s\-/]+(\d{1,2}),?[\s\-/]+(\d{2,4})$/i.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    const [d, y] = [+m[2], fixYear(+m[3])];
    return mo && isValidYMD(y, mo, d) ? ymd(y, mo, d) : '';
  }

  return '';
}

/**
 * Any date-ish cell → 'YYYY-MM-DD'.
 *
 * `bad` is true only when the cell held something that could not be read, so
 * the caller warns about a real misread and not about an ordinary empty cell.
 *
 * @returns {{value: string, bad: boolean}}
 */
function parseDateCell(v) {
  if (v === null || v === undefined || v === '') return { value: '', bad: false };

  if (v instanceof Date) {
    return Number.isNaN(v.getTime())
      ? { value: '', bad: true }
      : { value: ymd(v.getFullYear(), v.getMonth() + 1, v.getDate()), bad: false };
  }

  if (typeof v === 'number') {
    const value = fromSerial(v);
    return { value, bad: !value };
  }

  const s = String(v).trim();
  if (!s || s === '-' || s === '—') return { value: '', bad: false };

  const value = parseDateString(s);
  return { value, bad: !value };
}

const BOOL_NEGATIVE = ['', 'no', 'n', '0', 'false', 'none', 'na', 'n a', '-', '—'];
const BOOL_POSITIVE = ['yes', 'y', '1', 'true', 'x', '✓', 'v', 'have', 'holder', 'done'];

/**
 * A flag cell → 'TRUE' / 'FALSE', the literal strings the Sheet stores
 * (Section 2).
 *
 * Explicit negatives are false, explicit positives are true, and anything else
 * non-empty — a date, a certificate number — reads as true, because in these
 * workbooks the column is filled in only when the person holds the thing.
 */
function parseBoolCell(v) {
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';

  const s = String(v == null ? '' : v).trim().toLowerCase()
    .replace(/[^a-z0-9✓]+/g, ' ')
    .trim();

  if (BOOL_NEGATIVE.includes(s)) return 'FALSE';
  if (BOOL_POSITIVE.includes(s)) return 'TRUE';
  return 'TRUE';
}

/**
 * Text cells: trimmed, inner whitespace squeezed. A national ID stored as a
 * number stringifies without exponent notation well past 14 digits.
 */
function parseTextCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  return String(v).replace(/\s+/g, ' ').trim();
}

/** An enum cell — lowercased, so 'Pass' and 'PASS' both reach the server as 'pass'. */
function parseEnumCell(v) {
  return parseTextCell(v).toLowerCase();
}

/* ---------- Reading the workbook ------------------------------------------ */

/**
 * Finds the row that looks like the header: the one mapping the most known
 * columns, requiring an identifying column plus two others.
 *
 * Scanning instead of assuming row 1 survives the title and logo rows these
 * files usually carry above the table.
 *
 * @param {Array<Array>} grid
 * @param {Map<string, Object>} aliasMap
 * @param {Array<string>} identityColumns  at least one must be present
 * @returns {{index: number, map: Map<string, number>}|null}
 */
function findHeaderRow(grid, aliasMap, identityColumns) {
  let best = null;
  const limit = Math.min(grid.length, 10);

  for (let i = 0; i < limit; i++) {
    const map = new Map();

    for (let c = 0; c < grid[i].length; c++) {
      const column = aliasMap.get(normHeader(grid[i][c]));
      // First column wins if a header repeats across the sheet.
      if (column && !map.has(column.field)) map.set(column.field, c);
    }

    const identifies = identityColumns.some((field) => map.has(field));
    if (identifies && map.size >= 3 && (!best || map.size > best.map.size)) {
      best = { index: i, map };
    }
  }

  return best;
}

/** alias → column, built once per spec. First definition wins on a clash. */
function buildAliasMap(columns) {
  const map = new Map();

  columns.forEach((column) => {
    column.aliases.forEach((alias) => {
      if (!map.has(alias)) map.set(alias, column);
    });
  });

  return map;
}

/**
 * Reads one sheet into partial records.
 *
 * @param {Object} sheet       an XLSX worksheet
 * @param {Object} spec        the module's import spec (see settingsPage.js)
 * @param {string} sheetLabel  the workbook's own sheet name, shown in warnings
 * @param {Object} defaults    columns forced onto every row from this sheet
 * @param {function(string): void} warn
 * @param {Map} aliasMap
 * @returns {Array<{record: Object, present: Array<string>, excel_row: number, sheet: string}>}
 */
function parseSheet(sheet, spec, sheetLabel, defaults, warn, aliasMap) {
  const grid = window.XLSX.utils.sheet_to_json(sheet, {
    header: 1, raw: true, blankrows: false, defval: '',
  });

  const header = findHeaderRow(grid, aliasMap, spec.identityColumns);
  if (!header) {
    warn(t('import_warn_no_header', { sheet: sheetLabel }));
    return [];
  }

  // Surface anything in the header row we could not place, so an unrecognised
  // spelling shows up as a visible gap rather than a silently missing column.
  const unmapped = grid[header.index]
    .map((h) => parseTextCell(h))
    .filter((h) => h && !aliasMap.has(normHeader(h)));

  if (unmapped.length) {
    warn(t('import_warn_unmapped', { sheet: sheetLabel, cols: unmapped.join(', ') }));
  }

  const columnsHere = spec.columns.filter((c) => header.map.has(c.field));
  const out = [];

  for (let r = header.index + 1; r < grid.length; r++) {
    const cells = grid[r];
    if (!cells || cells.every((c) => c === '' || c === null || c === undefined)) continue;

    const record = { ...defaults };
    const present = Object.keys(defaults);
    const excelRow = r + 1;   // 1-based, as shown in Excel's own row gutter

    columnsHere.forEach((column) => {
      const raw = cells[header.map.get(column.field)];

      if (column.type === 'date') {
        const { value, bad } = parseDateCell(raw);
        if (bad) {
          warn(t('import_warn_bad_date', {
            row: excelRow, sheet: sheetLabel, value: parseTextCell(raw),
          }));
        }
        record[column.field] = value;
      } else if (column.type === 'bool') {
        record[column.field] = parseBoolCell(raw);
      } else if (column.type === 'enum') {
        record[column.field] = parseEnumCell(raw);
      } else {
        record[column.field] = parseTextCell(raw);
      }

      present.push(column.field);
    });

    // Identity is the one thing we cannot invent.
    if (!spec.identityColumns.some((field) => record[field])) {
      warn(t('import_warn_row_skipped', { row: excelRow, sheet: sheetLabel }));
      continue;
    }

    out.push({ record, present, excel_row: excelRow, sheet: sheetLabel });
  }

  return out;
}

/** Read a File into an ArrayBuffer. FileReader, because older Safari has no File#arrayBuffer. */
function readFileBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new ImportError('unreadable', 'FileReader failed'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Read a workbook into partial records.
 *
 * Sheets are matched against `spec.sheets` when the spec defines them — that is
 * how the legacy Landmark workbook's "Field Team" / "Safety Team" tabs each set
 * `team` on their rows without the file carrying a team column. A spec with no
 * sheet rules reads the first sheet only.
 *
 * @param {File} file
 * @param {Object} spec
 * @returns {Promise<{rows: Array<Object>, warnings: Array<string>}>}
 * @throws {ImportError}
 */
export async function parseWorkbook(file, spec) {
  if (!window.XLSX) throw new ImportError('no_library', 'SheetJS did not load from the CDN.');
  if (!file) throw new ImportError('no_file', 'No file selected.');

  const buffer = await readFileBuffer(file);

  let workbook;
  try {
    workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true });
  } catch (err) {
    throw new ImportError('unparseable', err && err.message ? err.message : 'XLSX.read failed');
  }

  if (!workbook.SheetNames || !workbook.SheetNames.length) {
    throw new ImportError('empty_workbook', 'The workbook has no sheets.');
  }

  const warnings = [];
  const warn = (text) => warnings.push(text);
  const aliasMap = buildAliasMap(spec.columns);
  const rows = [];

  if (spec.sheets && spec.sheets.length) {
    let matchedAny = false;

    spec.sheets.forEach((rule) => {
      const name = workbook.SheetNames.find((n) => rule.aliases.includes(normHeader(n)));
      if (!name) return;

      matchedAny = true;
      rows.push(...parseSheet(
        workbook.Sheets[name], spec, name, rule.defaults || {}, warn, aliasMap
      ));
    });

    // A workbook whose tabs are named something else entirely still imports —
    // it just has to carry the columns the sheet rules would have supplied.
    if (!matchedAny) {
      const name = workbook.SheetNames[0];
      warn(t('import_warn_no_named_sheets', { sheet: name }));
      rows.push(...parseSheet(workbook.Sheets[name], spec, name, {}, warn, aliasMap));
    }
  } else {
    const name = workbook.SheetNames[0];
    rows.push(...parseSheet(workbook.Sheets[name], spec, name, {}, warn, aliasMap));
  }

  if (!rows.length && !warnings.length) {
    throw new ImportError('no_rows', 'The sheet has headers but no data rows.');
  }

  return { rows, warnings };
}

/* ---------- Preview -------------------------------------------------------- */

/** Case- and space-insensitive membership test for a dropdown list. */
function inList(list, value) {
  if (!value) return true;   // an empty cell is not an unknown value

  const needle = String(value).trim().toLowerCase();
  return (list || []).some((entry) => {
    const option = typeof entry === 'string' ? entry : entry.option_value;
    return String(option).trim().toLowerCase() === needle;
  });
}

/**
 * Classifies every parsed row against what is already stored and picks its
 * default action. Pure — reads its inputs and mutates nothing.
 *
 * A row can have several problems at once. `status` carries the one that drives
 * the default action (duplicate first — it is the only one that risks writing
 * over a real record), while `reasons` lists all of them for the admin to read.
 *
 * @param {Array<Object>} parsedRows   from parseWorkbook
 * @param {Object} spec                the module's import spec
 * @param {Array<Object>} existing     current records from the server
 * @param {Object} fieldOptions        {list_key: [{option_value, active}]}
 * @returns {{rows: Array<Object>, summary: Object}}
 */
export function buildImportPreview(parsedRows, spec, existing, fieldOptions) {
  const byKey = new Map();

  (existing || []).forEach((record) => {
    const key = spec.duplicateKey(record);
    if (key) byKey.set(String(key).trim().toLowerCase(), record);
  });

  const seenInFile = new Map();
  const rows = [];

  parsedRows.forEach((item, index) => {
    const record = item.record;
    const reasons = [];

    const rawKey = spec.duplicateKey(record);
    const key = rawKey ? String(rawKey).trim().toLowerCase() : '';
    const match = key ? byKey.get(key) : null;

    // Two rows in one file claiming the same identity is always an error —
    // there is no policy under which both could be applied, and the server
    // rejects the whole batch for it (Section 3.5).
    const collidesInFile = key !== '' && seenInFile.has(key);
    if (key !== '') seenInFile.set(key, index);

    if (match) {
      reasons.push(t('import_reason_duplicate', {
        key: rawKey, name: spec.describe(match),
      }));
    }
    if (collidesInFile) {
      reasons.push(t('import_reason_duplicate_in_file', { key: rawKey }));
    }

    // Unknown dropdown values, per the lists this module's spec names.
    const unknowns = [];
    let blocked = false;

    (spec.optionColumns || []).forEach((entry) => {
      const value = record[entry.field];
      if (!value) return;

      const listKey = typeof entry.listKey === 'function' ? entry.listKey(record) : entry.listKey;
      if (inList(fieldOptions && fieldOptions[listKey], value)) return;

      const addable = entry.addable !== false;
      unknowns.push({ field: entry.field, listKey, value, addable });

      // A non-addable column — employment_status, legal_permission — carries a
      // value the verdict rules read literally (Section 6.2). An unknown one
      // cannot be waved through by extending the list, so the row is
      // unimportable until the spreadsheet is corrected.
      if (!addable) blocked = true;

      reasons.push(t(addable ? 'import_reason_unknown_option' : 'import_reason_bad_option', {
        field: t(entry.labelKey), value,
      }));
    });

    let status = 'new';
    if (blocked) status = 'blocked';
    else if (collidesInFile) status = 'conflict';
    else if (match) status = 'duplicate';
    else if (unknowns.length) status = 'unknown_option';

    rows.push({
      index,
      record,
      present: item.present,
      excel_row: item.excel_row,
      sheet: item.sheet,
      label: spec.describe(record),
      duplicate_of: match ? spec.identify(match) : '',
      status,
      reasons,
      blocked,

      // Duplicates default to Skip — never silently overwrite a real record.
      // A same-file collision defaults to Skip too, because sending it would
      // reject the batch. A blocked row can only be skipped. Everything else
      // defaults to Import.
      action: (blocked || match || collidesInFile) ? 'skip' : 'import',

      // Addable unknowns join their lists by default, matching OHS-DB.
      unknowns,
      add_options: unknowns.some((u) => u.addable),
    });
  });

  return { rows, summary: summarizePreview(rows) };
}

/**
 * Counts for the preview header.
 *
 * `skipped`, `importing` and `overwriting` follow the live actions, so they
 * track what the admin changed; the rest describe what was found.
 *
 * @param {Array<Object>} rows
 * @returns {Object}
 */
export function summarizePreview(rows) {
  return {
    total: rows.length,
    new: rows.filter((r) => r.status === 'new').length,
    duplicates: rows.filter((r) => r.status === 'duplicate').length,
    unknowns: rows.filter((r) => r.status === 'unknown_option').length,
    conflicts: rows.filter((r) => r.status === 'conflict').length,
    blocked: rows.filter((r) => r.status === 'blocked').length,
    importing: rows.filter((r) => r.action === 'import').length,
    overwriting: rows.filter((r) => r.action === 'overwrite').length,
    skipped: rows.filter((r) => r.action === 'skip').length,
  };
}

/**
 * The list additions the approved rows call for, grouped by list.
 *
 * Only rows that are actually being sent AND have their add-to-list box ticked
 * contribute — a value the admin chose to skip must not quietly extend a
 * dropdown.
 *
 * @param {Array<Object>} rows
 * @returns {Object<string, Array<string>>} {list_key: [value, ...]}
 */
export function pendingListAdditions(rows) {
  const byList = {};

  rows.forEach((row) => {
    if (row.action === 'skip' || !row.add_options) return;

    row.unknowns.forEach((unknown) => {
      if (!unknown.addable) return;
      if (!byList[unknown.listKey]) byList[unknown.listKey] = [];

      const already = byList[unknown.listKey].some(
        (value) => value.toLowerCase() === String(unknown.value).toLowerCase()
      );
      if (!already) byList[unknown.listKey].push(unknown.value);
    });
  });

  return byList;
}

/**
 * Split rows into server-sized batches. The server caps a call at
 * IMPORT_MAX_ROWS (Section 3.9) and the frontend is the one that chunks.
 *
 * @param {Array<Object>} rows
 * @param {number} [size]
 * @returns {Array<Array<Object>>}
 */
export function chunkRows(rows, size) {
  const limit = size || IMPORT_MAX_ROWS;
  const out = [];

  for (let i = 0; i < rows.length; i += limit) {
    out.push(rows.slice(i, i + limit));
  }
  return out;
}
