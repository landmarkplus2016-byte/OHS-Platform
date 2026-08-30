/* ==========================================================================
   employees/pages/detailPage.js — one employee, everything about them.

   `get_employee` returns the record, its renewal history and the equipment
   assigned to it in a single call (Section 3.5), so this page makes exactly one
   request and renders three sections from it.

   Certificate states, the worst-state roll-up and the site-check verdict all
   arrive pre-derived. The only arithmetic here is "how many days until this
   date", which is a label, not a decision.
   ========================================================================== */

import { UI } from '../../../state.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { t } from '../../../i18n/i18n.js';
import { escapeHtml, fmtDate, fmtDateTime, daysUntil, EMPTY_MARK } from '../../../utils/format.js';
import { canEdit, canView } from '../../../utils/permissions.js';
import { MODULE_NAMES } from '../../../constants/globals.js';
import {
  certStateBadge, worstStateBadge, verdictBadge, teamBadge, statusBadge, qualBadge,
  rdtStatusBadge, rdtResultBadge,
} from '../../../components/badge.js';
import { toastSuccess, toastError, toast } from '../../../components/toast.js';
import { confirmDialog, formDialog } from '../../../components/modal.js';
import {
  getEmployee, archiveEmployee, unarchiveEmployee, loadArchiveStatuses, deleteRdtEntry,
} from '../dataActions.js';
import { openRdtRecordDialog } from '../rdtRecordDialog.js';
import { openRdtEditDialog } from '../rdtEditDialog.js';
import { invalidateRdt } from './rdtPage.js';
import { invalidateRdtHistory } from './rdtHistoryPage.js';
import { invalidateResignedList } from './resignedPage.js';
import {
  TEAMS, CERT_LABEL_KEYS, QUAL_KEYS, QUAL_LABEL_KEYS, certKeysFor,
} from '../constants.js';

/** Page state, keyed by employee so returning to a different one refetches. */
function pageState() {
  if (!UI.employeeDetail) {
    UI.employeeDetail = { id: null, status: 'idle', data: null, error: null, busy: false };
  }
  return UI.employeeDetail;
}

/** Drop the cached record so the next draw refetches it. */
function invalidate() {
  const s = pageState();
  s.status = 'idle';
  s.data = null;
}

/* ---------- Data ---------------------------------------------------------- */

async function ensureData(employeeId) {
  const s = pageState();

  if (s.id === employeeId && (s.status === 'loading' || s.status === 'ready' || s.status === 'error')) return;

  s.id = employeeId;
  s.status = 'loading';
  s.error = null;
  render();

  try {
    s.data = await getEmployee(employeeId);
    s.status = 'ready';
  } catch (err) {
    s.status = 'error';
    s.error = err;
    console.error('[employees] get_employee failed:', err);
    if (err && err.code !== 'not_found') toastError(err);
  }

  render();
}

/* ---------- Rendering ----------------------------------------------------- */

/** One label/value pair in a detail grid. */
function displayField(labelKey, value) {
  const text = value === null || value === undefined || value === '' ? EMPTY_MARK : value;
  const muted = text === EMPTY_MARK ? ' muted' : '';

  return `
    <div class="field-disp">
      <div class="lab">${escapeHtml(t(labelKey))}</div>
      <div class="val${muted}">${escapeHtml(text)}</div>
    </div>`;
}

/** "12d left" / "5d ago", or nothing when there is no date. */
function daysLabel(iso) {
  const days = daysUntil(iso);
  if (days === null) return '';

  const text = days >= 0
    ? t('emp_days_left', { days })
    : t('emp_days_ago', { days: Math.abs(days) });

  return `<span class="cert-days">${escapeHtml(text)}</span>`;
}

/**
 * A certificate row: name, expiry with a days hint, its server-derived state,
 * and — only when a link is actually recorded — a button to open the file.
 */
function renderCertRow(employee, certKey, perCert) {
  const expiry = employee['cert_' + certKey + '_expiry'];
  const link = employee['cert_' + certKey + '_link'];
  const state = perCert[certKey];

  // An N/A certificate shows no date at all, even when one is on file. The
  // admin said it does not apply; a live "expires in 12 days" underneath that
  // is the record arguing with itself. The date is not deleted — it comes back
  // the moment the flag is unticked in the form.
  const dateLine = state === 'na'
    ? EMPTY_MARK
    : `${escapeHtml(fmtDate(expiry))} ${daysLabel(expiry)}`;

  return `
    <div class="cert-row${state === 'na' ? ' cert-row-na' : ''}${state === 'suspended' ? ' cert-row-suspended' : ''}">
      <div class="cert-info">
        <div class="name">${escapeHtml(t(CERT_LABEL_KEYS[certKey]))}</div>
        <div class="date">${dateLine}</div>
      </div>
      <div class="cert-actions">
        ${certStateBadge(state)}
        ${link && state !== 'na' ? `
          <button type="button" class="btn btn-ghost btn-sm"
                  data-action="open-cert" data-url="${escapeHtml(link)}">${escapeHtml(t('emp_open_cert'))}</button>` : ''}
      </div>
    </div>`;
}

/** The renewal history table (Section 3.5 returns it newest-first). */
function renderHistory(history) {
  if (!history || history.length === 0) {
    return `<div class="card"><div class="cell-empty">${escapeHtml(t('emp_no_history'))}</div></div>`;
  }

  return `
    <div class="card">
      <table class="tbl tbl-flush">
        <thead>
          <tr>
            <th>${escapeHtml(t('emp_col_certificate'))}</th>
            <th>${escapeHtml(t('emp_history_old'))}</th>
            <th>${escapeHtml(t('emp_history_new'))}</th>
            <th>${escapeHtml(t('emp_history_when'))}</th>
            <th>${escapeHtml(t('emp_history_by'))}</th>
          </tr>
        </thead>
        <tbody>
          ${history.map((row) => `
            <tr>
              <td>${escapeHtml(CERT_LABEL_KEYS[row.cert_key] ? t(CERT_LABEL_KEYS[row.cert_key]) : row.cert_key)}</td>
              <td>${escapeHtml(fmtDate(row.old_expiry))}</td>
              <td>${escapeHtml(fmtDate(row.new_expiry))}</td>
              <td>${escapeHtml(fmtDateTime(row.renewed_at))}</td>
              <td class="cell-sub">${escapeHtml(row.renewed_by)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/**
 * This employee's drug-test log, newest first.
 *
 * WHAT MAY BE WRITTEN FROM HERE, AND WHAT MAY NOT
 * -----------------------------------------------
 * Three things, and one line runs under all of them: a *completed* row is a
 * record of a test that happened to this person, so recording, correcting and
 * removing one all belong on their file. An admin who has just typed a wrong
 * date is looking at this table, and sending them to the RDT page to fix it
 * would be ceremony for its own sake.
 *
 * Everything that touches a *pick* — completing one, missing it, swapping it,
 * reverting it — stays on the RDT page, where the month's quota and the
 * eligible pool are on screen beside it. A pick completed from a page with
 * sight of neither is how a programme quietly drifts off target, and that
 * reasoning has not changed. It is why the row buttons below appear on
 * `completed` rows only: a `selected` or `missed` row is a pick, and deleting
 * one from here would shrink the month's selection with nothing in view to say
 * by how much.
 *
 * @param {Array<Object>} history rows from get_employee's `rdt_history`
 * @param {Object} employee the employee whose file this is
 * @param {boolean} editable whether the signed-in admin may write
 * @returns {string} HTML
 */
function renderRdtHistory(history, employee, editable) {
  const foot = editable
    ? `<div class="rdt-card-foot">
         <button type="button" class="btn btn-ghost btn-sm" data-rdt-record>${
           escapeHtml(t('emp_rdt_record'))
         }</button>
       </div>`
    : '';

  if (!history || history.length === 0) {
    return `
      <div class="card">
        <div class="cell-empty">${escapeHtml(t('emp_rdt_history_empty'))}</div>
        ${foot}
      </div>`;
  }

  return `
    <div class="card">
      <table class="tbl tbl-flush">
        <thead>
          <tr>
            <th>${escapeHtml(t('emp_rdt_col_selected_at'))}</th>
            <th>${escapeHtml(t('emp_rdt_test_date'))}</th>
            <th>${escapeHtml(t('emp_rdt_col_status'))}</th>
            <th>${escapeHtml(t('emp_rdt_result'))}</th>
            <th>${escapeHtml(t('emp_rdt_notes'))}</th>
            ${editable ? `<th>${escapeHtml(t('actions'))}</th>` : ''}
          </tr>
        </thead>
        <tbody>
          ${history.map((row) => `
            <tr>
              <td>${escapeHtml(fmtDate(row.selected_at))}</td>
              <td>${escapeHtml(row.test_date ? fmtDate(row.test_date) : '—')}</td>
              <td>${rdtStatusBadge(row.status)}</td>
              <td>${rdtResultBadge(row.result) || '—'}</td>
              <td class="rdt-notes-cell">${escapeHtml(row.notes || '')}</td>
              ${editable ? `<td class="cell-actions">${rdtRowActions(row)}</td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>
      ${foot}
    </div>`;
}

/**
 * The per-row buttons in the Drug Testing table.
 *
 * Offered on `completed` rows only, and that line is the same one the section's
 * header comment draws. A completed row is a record of a test that happened to
 * this person — correcting a mistyped date on it, or removing one entered
 * against the wrong file, is about them and nothing else, so their file is the
 * right place for it.
 *
 * A `selected` or `missed` row is a *pick*. Completing, missing, swapping or
 * reverting one moves this month's quota, and dropping one from here would
 * shrink the month's selection with neither the quota nor the eligible pool in
 * sight. Those stay on the RDT page, where both are on screen.
 *
 * Delete is the documented exception to rule 6 (Section 2, RdtLog) and the only
 * hard delete in the platform, which is why it is confirmed and styled as the
 * destructive act it is.
 */
function rdtRowActions(row) {
  if (row.status !== 'completed') return '';

  return `
    <button type="button" class="btn btn-ghost btn-sm"
            data-rdt-edit="${escapeHtml(row.log_id)}">${escapeHtml(t('emp_rdt_edit'))}</button>
    <button type="button" class="btn btn-danger btn-sm"
            data-rdt-delete="${escapeHtml(row.log_id)}">${escapeHtml(t('emp_rdt_delete'))}</button>`;
}

/**
 * Equipment assigned to this employee. The server returns [] when the signed-in
 * admin has no view permission on the equipment module, so an empty list here
 * means "none assigned" only for someone who can see equipment at all — which
 * is why the section is skipped entirely for everyone else.
 *
 * Rows link into the equipment module's detail route. That is a route name, not
 * an import: modules never reach into each other's folders (rule 12), and the
 * router owns the mapping from '#/equipment/LM-EQP-0001' to whichever module
 * registered it.
 */
function renderAssignedEquipment(equipment) {
  if (!equipment || equipment.length === 0) {
    return `<div class="card"><div class="cell-empty">${escapeHtml(t('emp_no_equipment'))}</div></div>`;
  }

  return `
    <div class="card">
      <table class="tbl tbl-flush">
        <thead>
          <tr>
            <th>${escapeHtml(t('emp_equipment_item'))}</th>
            <th>${escapeHtml(t('emp_equipment_serial'))}</th>
            <th>${escapeHtml(t('emp_equipment_verdict'))}</th>
          </tr>
        </thead>
        <tbody>
          ${equipment.map((item) => `
            <tr class="row-clickable" data-equipment-id="${escapeHtml(item.equipment_id)}">
              <td>
                <b>${escapeHtml(item.item)}</b>
                <div class="cell-sub">${escapeHtml(item.brand)} · ${escapeHtml(item.equipment_id)}</div>
              </td>
              <td class="cell-mono">${escapeHtml(item.serial_no)}</td>
              <td>${verdictBadge(item.verdict)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/**
 * @param {Object} params route params, {id}
 * @returns {string} HTML
 */
export function renderEmployeeDetailPage(params) {
  const s = pageState();
  const employeeId = params && params.id;

  if (s.status === 'loading' || s.status === 'idle' || s.id !== employeeId) {
    return `<div class="employee-detail"><div class="cell-empty">${escapeHtml(t('loading_data'))}</div></div>`;
  }

  if (s.status === 'error') {
    const notFound = s.error && s.error.code === 'not_found';
    return `
      <div class="employee-detail">
        <div class="card">
          <div class="cell-empty">${escapeHtml(t(notFound ? 'emp_not_found' : 'err_server_error'))}</div>
          <div class="page-head-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-action="back">${escapeHtml(t('back'))}</button>
          </div>
        </div>
      </div>`;
  }

  const employee = s.data.employee;
  const derived = employee.derived || {};
  const perCert = derived.per_cert || {};
  const editable = canEdit(MODULE_NAMES.EMPLOYEES);
  const certKeys = certKeysFor(employee.team);

  return `
    <div class="employee-detail" data-employee-id="${escapeHtml(employee.employee_id)}">
      <div class="page-head">
        <div>
          <div class="page-head-title">${escapeHtml(employee.name)}</div>
          <div class="page-head-sub">${escapeHtml(employee.employee_id)} · ${escapeHtml(employee.national_id)}</div>
        </div>
        <div class="page-head-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="back">${escapeHtml(t('back'))}</button>
          ${editable && !employee.archived ? `
            <button type="button" class="btn btn-primary btn-sm" data-action="edit">${escapeHtml(t('edit'))}</button>
            <button type="button" class="btn btn-danger btn-sm" data-action="archive">${escapeHtml(t('emp_archive'))}</button>` : ''}
          ${editable && employee.archived ? `
            <button type="button" class="btn btn-primary btn-sm" data-action="unarchive">${escapeHtml(t('emp_unarchive'))}</button>` : ''}
        </div>
      </div>

      ${employee.archived ? `<div class="banner banner-warn">${escapeHtml(t('emp_archived_banner'))}</div>` : ''}

      <div class="badge-row">
        ${teamBadge(employee.team)}
        ${worstStateBadge(derived.worst_state)}
        ${verdictBadge(derived.verdict)}
        ${statusBadge(employee.employment_status, employee.employment_status === 'Active')}
        ${statusBadge(employee.legal_permission, employee.legal_permission === 'Approved')}
      </div>

      <div class="section-head">${escapeHtml(t('emp_section_personal'))}</div>
      <div class="card">
        <div class="detail-grid">
          ${displayField('emp_field_name', employee.name)}
          ${displayField('emp_field_national_id', employee.national_id)}
          ${displayField('emp_field_title', employee.title)}
          ${displayField('emp_field_contractor', employee.contractor)}
          ${displayField('emp_field_subcontractor', employee.subcontractor)}
          ${displayField('emp_field_hired_date', employee.hired_date ? fmtDate(employee.hired_date) : '')}
          ${displayField('emp_field_employment_status', employee.employment_status)}
          ${displayField('emp_field_legal_permission', employee.legal_permission)}
          ${employee.archived ? displayField('emp_col_archived_on', fmtDateTime(employee.archived_at)) : ''}
        </div>
      </div>

      <div class="section-head">${escapeHtml(t('emp_section_certs'))}</div>
      <div class="card">
        <div class="cert-list">
          ${certKeys.map((key) => renderCertRow(employee, key, perCert)).join('')}
        </div>
      </div>

      ${employee.team === TEAMS.SAFETY ? `
        <div class="section-head">${escapeHtml(t('emp_section_quals'))}</div>
        <div class="card">
          <div class="badge-row">
            ${QUAL_KEYS.map((key) => qualBadge(t(QUAL_LABEL_KEYS[key]), employee['qual_' + key])).join('')}
          </div>
        </div>` : ''}

      <div class="section-head">${escapeHtml(t('emp_section_drug'))}</div>
      ${renderRdtHistory(s.data.rdt_history, s.data.employee, editable)}

      <div class="section-head">${escapeHtml(t('emp_section_history'))}</div>
      ${renderHistory(s.data.renewal_history)}

      ${canView(MODULE_NAMES.EQUIPMENT) ? `
        <div class="section-head">${escapeHtml(t('emp_section_equipment'))}</div>
        ${renderAssignedEquipment(s.data.assigned_equipment)}` : ''}
    </div>`;
}

/* ---------- Events -------------------------------------------------------- */

/** Where "Back" goes: the list this employee belongs to. */
function backRoute(employee) {
  if (!employee) return 'field';
  if (employee.archived) return 'resigned';
  return employee.team === TEAMS.SAFETY ? 'safety' : 'field';
}

/**
 * Open a certificate file in a new tab.
 *
 * Only http(s) is followed. The link is an admin-entered string from the Sheet,
 * and `javascript:` in an href is script execution, not navigation.
 */
function openCertificate(url) {
  if (!/^https?:\/\//i.test(url)) {
    console.warn('[employees] refusing to open non-http certificate link:', url);
    toast(t('err_not_found'), 'error');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Archive, asking for the employment status that goes with it.
 *
 * The status is required rather than optional because leaving it out is how the
 * two fields came to disagree: `archived` decides which list someone appears
 * in, `employment_status` records why they left, and nothing derives one from
 * the other. Archiving without asking had been landing records in Resigned &
 * Terminated still labelled Active — invisible on that page, which renders the
 * certificate roll-up rather than the status, and awkward to fix afterwards
 * because an archived row rejects every update.
 *
 * A formDialog rather than a confirmDialog: there are two fields now, and the
 * server can still refuse the status, which has to be readable next to the
 * select rather than in a toast over a dialog that has already closed.
 */
async function doArchive(employeeId) {
  const s = pageState();
  if (s.busy) return;

  const statuses = await loadArchiveStatuses();

  await formDialog({
    title: t('emp_archive_title'),
    confirmLabel: t('emp_archive'),
    danger: true,
    bodyHtml: `
      <p class="modal-intro">${escapeHtml(t('emp_archive_message'))}</p>
      <div class="field">
        <label for="archive-status">${escapeHtml(t('emp_archive_status'))}</label>
        <select id="archive-status">
          ${statuses.map((status) => `
            <option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="archive-reason">${escapeHtml(t('emp_archive_reason'))}</label>
        <input id="archive-reason" type="text" autocomplete="off"
               placeholder="${escapeHtml(t('emp_archive_reason_ph'))}">
      </div>`,

    submit: async (root, setError) => {
      const status = root.querySelector('#archive-status').value;
      const reason = root.querySelector('#archive-reason').value.trim();

      try {
        await archiveEmployee(employeeId, reason, status);
      } catch (err) {
        console.error('[employees] archive failed:', err);
        setError(archiveErrorMessage(err));
        return false;
      }

      toastSuccess(t('emp_archived_ok'));

      // The employee has moved between two lists, so both caches are now wrong:
      // the team lists still hold a row that is gone, and Resigned & Terminated
      // is missing the one that just arrived.
      delete UI.employeeList;
      invalidateResignedList();
      invalidate();
      return true;
    },
  });

  render();
}

/**
 * A server rejection turned into a line the admin can act on.
 *
 * `not_terminal` is the one worth naming: it means the dropdown offered a status
 * the `employees.archive_statuses` row does not consider a departure, so the two
 * have drifted and retrying will not help.
 */
function archiveErrorMessage(err) {
  const fieldErrors = (err && err.field_errors) || {};

  if (fieldErrors.employment_status === 'not_terminal') return t('emp_err_status_not_terminal');
  if (fieldErrors.employment_status === 'unknown_option') return t('emp_err_unknown_option');

  return t(err && err.code === 'not_found' ? 'err_not_found' : 'err_server_error');
}

async function doUnarchive(employeeId) {
  const s = pageState();
  if (s.busy) return;

  const answer = await confirmDialog({
    title: t('emp_unarchive_title'),
    message: t('emp_unarchive_message'),
    confirmLabel: t('emp_unarchive'),
  });
  if (!answer) return;

  s.busy = true;
  try {
    await unarchiveEmployee(employeeId);
    toastSuccess(t('emp_unarchived_ok'));

    // The same move, in reverse — both lists are stale either way.
    delete UI.employeeList;
    invalidateResignedList();
    invalidate();
  } catch (err) {
    console.error('[employees] unarchive failed:', err);

    // The one conflict this action produces is worth naming: someone else took
    // the national ID while this record sat archived (Section 3.5).
    if (err && err.code === 'conflict') toast(t('emp_national_id_taken'), 'error');
    else toastError(err);
  } finally {
    s.busy = false;
    render();
  }
}

/**
 * @param {Object} params route params, {id}
 */
export function bindEmployeeDetailPageEvents(params) {
  const root = document.querySelector('.employee-detail');
  if (!root) return;

  const employeeId = params && params.id;
  ensureData(employeeId);

  const s = pageState();
  const employee = s.data && s.data.employee;

  const back = root.querySelector('[data-action="back"]');
  if (back) back.addEventListener('click', () => go(backRoute(employee)));

  const edit = root.querySelector('[data-action="edit"]');
  if (edit) edit.addEventListener('click', () => go('employee/:id/edit', { id: employeeId }));

  const archive = root.querySelector('[data-action="archive"]');
  if (archive) archive.addEventListener('click', () => doArchive(employeeId));

  const unarchive = root.querySelector('[data-action="unarchive"]');
  if (unarchive) unarchive.addEventListener('click', () => doUnarchive(employeeId));

  root.querySelectorAll('[data-action="open-cert"]').forEach((btn) => {
    btn.addEventListener('click', () => openCertificate(btn.dataset.url));
  });

  // Assigned equipment → that item's detail page. Only these rows carry
  // data-equipment-id, so the selector needs no further scoping.
  root.querySelectorAll('tr[data-equipment-id]').forEach((row) => {
    row.addEventListener('click', () => go('equipment/:id', { id: row.dataset.equipmentId }));
  });

  const recordTest = root.querySelector('[data-rdt-record]');
  if (recordTest) recordTest.addEventListener('click', () => doRecordTest(employee));

  root.querySelectorAll('[data-rdt-edit]').forEach((btn) => {
    btn.addEventListener('click', () => doEditTest(btn.dataset.rdtEdit));
  });

  root.querySelectorAll('[data-rdt-delete]').forEach((btn) => {
    btn.addEventListener('click', () => doDeleteTest(btn.dataset.rdtDelete));
  });
}

/**
 * @private
 * The RDT entry on screen under this log_id.
 *
 * Read back out of the page's own loaded data rather than passed through the
 * button: a data attribute carrying a whole entry would have to be serialised
 * into the markup, and the row is already here.
 */
function findRdtEntry(logId) {
  const s = pageState();
  const history = (s.data && s.data.rdt_history) || [];
  return history.find((row) => row.log_id === logId) || null;
}

/**
 * Correct a completed test on this employee's file — a mistyped date, the wrong
 * outcome, a note.
 *
 * Shares its dialog with the RDT page (rdtEditDialog.js), so the two screens
 * cannot disagree about what may be corrected or how it is validated.
 */
async function doEditTest(logId) {
  const entry = findRdtEntry(logId);
  if (!entry) return;

  const saved = await openRdtEditDialog({ logId: logId, entry: entry });
  if (!saved) return;

  invalidateRdtCaches();
  toastSuccess(t('emp_rdt_edited'));
  render();
}

/**
 * Delete one entry from the log.
 *
 * This is the platform's only hard delete, permitted here because an RdtLog row
 * is a plan rather than an entity record (Section 2, RdtLog). It is confirmed
 * every time, and the confirmation says it cannot be undone — because it cannot.
 */
async function doDeleteTest(logId) {
  const s = pageState();
  if (s.busy) return;

  const answer = await confirmDialog({
    title: t('emp_rdt_delete'),
    message: t('emp_rdt_delete_confirm'),
    confirmLabel: t('emp_rdt_delete'),
    danger: true,
  });
  if (!answer) return;

  s.busy = true;
  try {
    await deleteRdtEntry(logId);
    invalidateRdtCaches();
    toastSuccess(t('emp_rdt_deleted'));
  } catch (err) {
    console.error('[employees] delete_rdt_entry failed:', err);
    toastError(err);
  } finally {
    s.busy = false;
    render();
  }
}

/**
 * @private
 * Every view that counts the same log: this file, the RDT dashboard, its
 * history page, and the dashboard's coverage card.
 *
 * One function because three call sites here need the same four, and three
 * copies of the list is how one of them ends up short by a cache.
 */
function invalidateRdtCaches() {
  invalidate();
  invalidateRdt();
  invalidateRdtHistory();
  delete UI.employeeDashboard;
}

/**
 * Record an off-cycle drug test for the employee on screen.
 *
 * The dialog runs its own submit so a duplicate-date rejection can land beside
 * the date field; all that is left here is dropping the caches the new row makes
 * stale — this page's own copy, and the two RDT views that count the same log.
 *
 * @param {Object} employee
 */
async function doRecordTest(employee) {
  if (!employee) return;

  const saved = await openRdtRecordDialog({ employee });
  if (!saved) return;

  invalidateRdtCaches();
  toastSuccess(t('emp_rdt_recorded', { name: employee.name }));
  render();
}

/** Called by the form page after a save, so the detail view shows fresh data. */
export function invalidateEmployeeDetail() {
  invalidate();
}
