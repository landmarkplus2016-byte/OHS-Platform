/* ==========================================================================
   employees/rdtImportDialog.js — backfill completed drug tests from a file.

   WHAT THIS EXPECTS
   -----------------
   One row per test. A `national_id` or an `employee_id` to say who, a date to
   say when, and optionally a result and a note. That is the whole contract.

   It is emphatically *not* the shape of the legacy workbook this was built to
   rescue, which carries one row per employee with an `RDT 1 Date` and an
   `RDT 2 Date` beside each other. Fanning those into events is a transformation
   of one particular spreadsheet, done once by hand; building it into the
   platform would fossilise that spreadsheet's layout in code that outlives it.

   WHY THE FILE IS NOT SPLIT INTO CHUNKS
   -------------------------------------
   `bulk_import_rdt` is all-or-nothing per call — one bad row rejects everything
   and the Sheet is untouched. Chunking would silently trade that away: a third
   chunk failing leaves the first two already written, and nobody can tell by
   looking which half arrived. A file past the cap is refused so the admin splits
   it deliberately, knowing what they are giving up.

   WHY THE PREVIEW BLOCKS ON A MISSING DATE
   ----------------------------------------
   The server would reject the whole call for one dateless row anyway. Catching
   it here means the admin reads "line 47 has no date" instead of "nothing was
   imported", which is the difference between a fixable file and a mystery.
   ========================================================================== */

import { t } from '../../i18n/i18n.js';
import { escapeHtml, fmtDate } from '../../utils/format.js';
import { formDialog } from '../../components/modal.js';
import { parseWorkbook, ImportError } from '../../utils/excelImport.js';
import { bulkImportRdt } from './dataActions.js';
import { RDT_IMPORT_SPEC, RDT_IMPORT_MAX_ROWS } from './constants.js';

/**
 * @private
 * Everything the preview needs to say about a parsed file.
 *
 * @param {Array<Object>} parsed rows from parseWorkbook
 * @returns {Object}
 */
function summarize(parsed) {
  const dated = [];
  const undated = [];
  let withResult = 0;

  parsed.forEach((row) => {
    if (row.record.test_date) {
      dated.push(row);
      if (row.record.result) withResult += 1;
    } else {
      undated.push(row);
    }
  });

  const dates = dated.map((row) => row.record.test_date).sort();

  return {
    total: parsed.length,
    dated: dated.length,
    undated,
    with_result: withResult,
    first: dates.length ? dates[0] : '',
    last: dates.length ? dates[dates.length - 1] : '',
  };
}

/** @private The preview block, redrawn each time a file is chosen. */
function summaryHtml(summary, warnings) {
  if (!summary.total) {
    return `<div class="cell-empty">${escapeHtml(t('emp_rdt_import_nothing'))}</div>`;
  }

  const lines = [`
    <div class="rdt-import-line">
      <b>${escapeHtml(t('emp_rdt_import_count', { count: summary.dated }))}</b>
      ${summary.first
        ? `<span class="cell-sub">${escapeHtml(fmtDate(summary.first))} — ${
            escapeHtml(fmtDate(summary.last))
          }</span>`
        : ''}
    </div>
    <div class="rdt-import-line cell-sub">${
      escapeHtml(t('emp_rdt_import_with_result', { count: summary.with_result }))
    }</div>`];

  if (summary.undated.length) {
    // Named line by line: the admin has to find them in the file, and "3 rows
    // are bad" does not help them do that.
    const where = summary.undated
      .slice(0, 10)
      .map((row) => row.excel_row)
      .join(', ');

    lines.push(`
      <div class="banner banner-warn">
        ${escapeHtml(t('emp_rdt_import_no_date', { count: summary.undated.length, rows: where }))}
      </div>`);
  }

  if (summary.dated > RDT_IMPORT_MAX_ROWS) {
    lines.push(`
      <div class="banner banner-warn">
        ${escapeHtml(t('emp_rdt_import_too_many', { max: RDT_IMPORT_MAX_ROWS }))}
      </div>`);
  }

  warnings.forEach((text) => {
    lines.push(`<div class="rdt-import-line cell-sub">${escapeHtml(text)}</div>`);
  });

  return lines.join('');
}

/**
 * Open the import dialog. Resolves with the server's summary when rows were
 * written, or null when the admin dismissed it.
 *
 * @returns {Promise<{added: number, updated: number, skipped: number,
 *                    by_fiscal_year: Object}|null>}
 */
export async function openRdtImportDialog() {
  let parsed = [];
  let summary = summarize([]);
  let outcome = null;

  const saved = await formDialog({
    title: t('emp_rdt_import_title'),
    confirmLabel: t('emp_rdt_import_save'),
    wide: true,
    bodyHtml: `
      <p class="modal-intro">${escapeHtml(t('emp_rdt_import_intro'))}</p>

      <div class="field">
        <label for="rdt-import-file">${escapeHtml(t('emp_rdt_import_file'))}</label>
        <input id="rdt-import-file" type="file" accept=".xlsx,.xls,.csv">
        <div class="field-hint">${escapeHtml(t('emp_rdt_import_hint'))}</div>
      </div>

      <div id="rdt-import-summary" class="rdt-import-summary">
        <div class="cell-empty">${escapeHtml(t('emp_rdt_import_none'))}</div>
      </div>`,

    bind: (root) => {
      const input = root.querySelector('#rdt-import-file');
      const target = root.querySelector('#rdt-import-summary');

      input.addEventListener('change', async () => {
        parsed = [];
        summary = summarize([]);
        target.innerHTML = `<div class="cell-empty">${escapeHtml(t('loading_data'))}</div>`;

        try {
          const result = await parseWorkbook(input.files[0], RDT_IMPORT_SPEC);
          parsed = result.rows;
          summary = summarize(parsed);
          target.innerHTML = summaryHtml(summary, result.warnings);
        } catch (err) {
          console.error('[employees] rdt import parse failed:', err);

          const key = err instanceof ImportError
            ? 'import_err_' + err.code
            : 'err_server_error';
          target.innerHTML = `<div class="banner banner-warn">${escapeHtml(t(key))}</div>`;
        }
      });
    },

    submit: async (root, setError) => {
      if (!summary.dated) {
        setError(t('emp_rdt_import_nothing'));
        return false;
      }
      if (summary.undated.length) {
        setError(t('emp_rdt_import_fix_dates'));
        return false;
      }
      if (summary.dated > RDT_IMPORT_MAX_ROWS) {
        setError(t('emp_rdt_import_too_many', { max: RDT_IMPORT_MAX_ROWS }));
        return false;
      }

      const rows = parsed.map((row) => ({
        national_id: row.record.national_id || '',
        employee_id: row.record.employee_id || '',
        test_date: row.record.test_date,
        result: row.record.result || '',
        notes: row.record.notes || '',
      }));

      try {
        outcome = await bulkImportRdt(rows, 'skip');
        return true;
      } catch (err) {
        console.error('[employees] bulk_import_rdt failed:', err);

        // Per-row detail is the whole value of an all-or-nothing import: the
        // admin needs to know which lines to fix, not that the import failed.
        if (err && err.row_errors && err.row_errors.length) {
          console.table(err.row_errors.map((entry) => ({
            file_row: parsed[entry.row] ? parsed[entry.row].excel_row : entry.row,
            who: parsed[entry.row]
              ? (parsed[entry.row].record.name || parsed[entry.row].record.national_id)
              : '',
            problem: JSON.stringify(entry.errors),
          })));

          const first = err.row_errors[0];
          const line = parsed[first.row] ? parsed[first.row].excel_row : first.row + 1;
          setError(t('emp_rdt_import_row_errors', {
            count: err.row_errors.length,
            row: line,
          }));
          return false;
        }

        setError(t('err_server_error'));
        return false;
      }
    },
  });

  return saved ? outcome : null;
}
