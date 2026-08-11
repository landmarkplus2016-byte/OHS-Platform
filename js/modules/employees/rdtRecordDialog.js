/* ==========================================================================
   employees/rdtRecordDialog.js — record a drug test that happened outside the
   monthly draw.

   WHY THIS IS NOT ON A PAGE
   -------------------------
   Two screens need it and neither owns it. The RDT page opens it with no
   employee chosen, so it offers the roster; the employee detail page opens it
   already scoped to the person whose file is on screen. Same dialog, same
   validation, same server action — so it lives beside the module's other shared
   pieces rather than being written twice and drifting.

   WHAT IT CANNOT DO
   -----------------
   It records a *completed* test and nothing else. There is no status control
   because the server refuses the other two states and each refusal matters:
   writing a `selected` row by hand would let an admin choose who gets tested,
   which is the one thing a random programme must never permit, and a `missed`
   row needs a plan to have missed — that transition belongs to the RDT page,
   against a pick that already exists.

   A blank result is a legitimate answer, not an unfilled field. A test copied
   off a paper register frequently has a date and no outcome; the honest record
   of that is an empty result, not a guessed `pass`.
   ========================================================================== */

import { t } from '../../i18n/i18n.js';
import { escapeHtml, todayISO } from '../../utils/format.js';
import { formDialog } from '../../components/modal.js';
import { listAllEmployees, createRdtEntry } from './dataActions.js';
import { RDT_RESULTS } from './constants.js';

/**
 * @private
 * The roster the picker offers: active employees, name order.
 *
 * Archived people are left out deliberately. Their tests are history, and
 * history arrives through the import — an admin recording a test today is
 * recording it for somebody currently on the books. The server is more
 * permissive than this on purpose (it accepts archived employees so the import
 * can reach them); this is the narrower thing the form needs.
 *
 * Returns null when the roster cannot be fetched, which the caller renders as a
 * plain ID input rather than an empty select — the same degradation the
 * equipment form's team-leader picker makes.
 *
 * @returns {Promise<Array<Object>|null>}
 */
async function loadRoster() {
  try {
    const { employees } = await listAllEmployees({ include_archived: false });
    return employees;
  } catch (err) {
    console.warn('[employees] rdt record dialog: roster unavailable, falling back to ID entry', err);
    return null;
  }
}

/** @private The employee control: a fixed label, a roster picker, or an ID input. */
function employeeControl(employee, roster) {
  if (employee) {
    return `
      <div class="field">
        <label>${escapeHtml(t('emp_rdt_record_employee'))}</label>
        <div class="field-static">
          <b>${escapeHtml(employee.name || employee.employee_id)}</b>
          <span class="cell-sub">${escapeHtml(employee.employee_id)}</span>
        </div>
      </div>`;
  }

  if (!roster) {
    return `
      <div class="field">
        <label for="rdt-employee">${escapeHtml(t('emp_rdt_record_employee'))}</label>
        <input id="rdt-employee" type="text" autocomplete="off">
        <div class="field-hint">${escapeHtml(t('emp_rdt_record_manual'))}</div>
      </div>`;
  }

  return `
    <div class="field">
      <label for="rdt-employee">${escapeHtml(t('emp_rdt_record_employee'))}</label>
      <select id="rdt-employee">
        <option value="">${escapeHtml(t('emp_rdt_record_pick'))}</option>
        ${roster.map((row) => `
          <option value="${escapeHtml(row.employee_id)}">
            ${escapeHtml(row.name)} · ${escapeHtml(row.employee_id)}
          </option>`).join('')}
      </select>
    </div>`;
}

/**
 * Open the dialog and, on save, write one completed RdtLog row.
 *
 * @param {Object} [options]
 * @param {{employee_id: string, name?: string}} [options.employee]
 *        Pre-scope to one person and hide the picker.
 * @returns {Promise<boolean>} true when a test was recorded
 */
export async function openRdtRecordDialog(options) {
  const employee = (options && options.employee) || null;
  const roster = employee ? null : await loadRoster();

  return formDialog({
    title: t('emp_rdt_record_title'),
    confirmLabel: t('emp_rdt_record_save'),
    bodyHtml: `
      <p class="modal-intro">${escapeHtml(t('emp_rdt_record_intro'))}</p>

      ${employeeControl(employee, roster)}

      <div class="field">
        <label for="rdt-test-date">${escapeHtml(t('emp_rdt_test_date'))}</label>
        <input id="rdt-test-date" type="date" value="${escapeHtml(todayISO())}"
               max="${escapeHtml(todayISO())}">
      </div>

      <div class="field">
        <label for="rdt-result">${escapeHtml(t('emp_rdt_result'))}</label>
        <select id="rdt-result">
          <option value="" selected>${escapeHtml(t('emp_rdt_result_none'))}</option>
          ${RDT_RESULTS.map((value) => `
            <option value="${value}">${escapeHtml(t('emp_rdt_result_' + value))}</option>`).join('')}
        </select>
        <div class="field-hint">${escapeHtml(t('emp_rdt_result_none_hint'))}</div>
      </div>

      <div class="field">
        <label for="rdt-notes">${escapeHtml(t('emp_rdt_notes'))}</label>
        <textarea id="rdt-notes" rows="3" maxlength="500"></textarea>
      </div>`,

    submit: async (root, setError) => {
      const employeeId = employee
        ? employee.employee_id
        : root.querySelector('#rdt-employee').value.trim();
      const testDate = root.querySelector('#rdt-test-date').value;

      if (!employeeId) {
        setError(t('emp_rdt_record_employee_required'));
        return false;
      }
      if (!testDate) {
        setError(t('emp_rdt_date_required'));
        return false;
      }
      // The server rejects a future date too (Section 3.5) — this only saves the
      // round trip and puts the message next to the field that caused it.
      if (testDate > todayISO()) {
        setError(t('emp_rdt_date_future'));
        return false;
      }

      try {
        await createRdtEntry({
          employee_id: employeeId,
          test_date: testDate,
          result: root.querySelector('#rdt-result').value,
          notes: root.querySelector('#rdt-notes').value,
        });
        return true;
      } catch (err) {
        console.error('[employees] create_rdt_entry failed:', err);

        // The one rejection with something useful to say: this person already
        // has a test logged on this date, so the admin is either double-entering
        // or has the wrong date. A generic error would leave them pressing Save.
        if (err && err.code === 'conflict' && err.message === 'rdt_test_already_recorded') {
          setError(t('emp_rdt_record_duplicate'));
        } else if (err && err.code === 'not_found') {
          setError(t('emp_rdt_record_employee_unknown'));
        } else {
          setError(t('err_server_error'));
        }
        return false;
      }
    },
  });
}
