/* ==========================================================================
   employees/rdtEditDialog.js — correct a drug-test entry that already exists.

   WHY THIS IS NOT ON A PAGE
   -------------------------
   Same reason as rdtRecordDialog beside it: two screens need it and neither
   owns it. The RDT page opens it to complete a pick or fix one it drew; the
   employee detail page opens it to fix a test recorded against that person.
   Same fields, same validation, same action — written once so the two cannot
   drift.

   COMPLETE AND EDIT ARE ONE DIALOG
   --------------------------------
   Both capture a date, an outcome and a note, and both end in the same
   `update_rdt_entry` call. Completing starts blank at today; editing pre-fills
   from the entry. Only the title and the success message differ, which is not
   enough difference to justify two of anything.

   WHY AN OUTCOME IS REQUIRED HERE AND OPTIONAL WHEN RECORDING
   -----------------------------------------------------------
   `create_rdt_entry` accepts a blank result, because a test copied off a paper
   register often never had one written down. `update_rdt_entry` does not: the
   server requires pass or fail on any row whose status is `completed`
   (Section 3.5). So a row created with no outcome cannot have its *date* fixed
   without an outcome being supplied at the same time.

   That is checked here rather than left to the server, so the message lands
   beside the field that caused it instead of arriving as a generic failure
   after a round trip. It is the server's rule either way — this only says so
   earlier.
   ========================================================================== */

import { t } from '../../i18n/i18n.js';
import { escapeHtml, todayISO } from '../../utils/format.js';
import { formDialog } from '../../components/modal.js';
import { updateRdtEntry } from './dataActions.js';
import { RDT_RESULTS } from './constants.js';

/**
 * @private
 * The outcome control.
 *
 * The blank option is offered only when the entry being edited already carries
 * a blank outcome. Otherwise it would invite an admin to erase a recorded
 * pass or fail into nothing, which the server would refuse anyway — an option
 * that cannot be saved does not belong in the list.
 */
function resultControl(current, allowBlank) {
  const options = RDT_RESULTS.map((value) => `
    <option value="${value}"${value === current ? ' selected' : ''}>${
    escapeHtml(t('emp_rdt_result_' + value))
  }</option>`).join('');

  const blank = allowBlank
    ? `<option value=""${current === '' ? ' selected' : ''}>${
      escapeHtml(t('emp_rdt_result_none'))
    }</option>`
    : '';

  return `
    <div class="field">
      <label for="rdt-result">${escapeHtml(t('emp_rdt_result'))}</label>
      <select id="rdt-result">${blank}${options}</select>
    </div>`;
}

/**
 * Open the dialog and, on save, update one RdtLog row to `completed`.
 *
 * @param {Object} options
 * @param {string} options.logId          the entry to write to
 * @param {Object} [options.entry]        the entry as it stands; absent when completing a pick
 * @returns {Promise<boolean>} true when the entry was saved
 */
export async function openRdtEditDialog(options) {
  const logId = options.logId;
  const entry = options.entry || null;
  const isEdit = !!entry;

  const testDate = (entry && entry.test_date) || todayISO();
  const result = entry ? (entry.result || '') : 'pass';

  // Only a row that is already blank may stay blank — see the header note.
  const allowBlank = isEdit && result === '';
  const notes = (entry && entry.notes) || '';

  return formDialog({
    title: t(isEdit ? 'emp_rdt_edit_title' : 'emp_rdt_complete_title'),
    bodyHtml: `
      <div class="field">
        <label for="rdt-test-date">${escapeHtml(t('emp_rdt_test_date'))}</label>
        <input id="rdt-test-date" type="date" value="${escapeHtml(testDate)}"
               max="${escapeHtml(todayISO())}">
      </div>

      ${resultControl(result, allowBlank)}

      <div class="field">
        <label for="rdt-notes">${escapeHtml(t('emp_rdt_notes'))}</label>
        <textarea id="rdt-notes" rows="3" maxlength="500">${escapeHtml(notes)}</textarea>
      </div>`,

    submit: async (root, setError) => {
      const date = root.querySelector('#rdt-test-date').value;
      const outcome = root.querySelector('#rdt-result').value;

      if (!date) {
        setError(t('emp_rdt_date_required'));
        return false;
      }
      // The server refuses a future test date too; this only saves the trip.
      if (date > todayISO()) {
        setError(t('emp_rdt_date_future'));
        return false;
      }
      if (!outcome) {
        setError(t('emp_rdt_result_required'));
        return false;
      }

      try {
        await updateRdtEntry(logId, {
          status: 'completed',
          test_date: date,
          result: outcome,
          notes: root.querySelector('#rdt-notes').value,
        });
        return true;
      } catch (err) {
        console.error('[employees] update_rdt_entry failed:', err);
        setError(t('err_server_error'));
        return false;
      }
    },
  });
}
