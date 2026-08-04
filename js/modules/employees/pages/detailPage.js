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
} from '../../../components/badge.js';
import { toastSuccess, toastError, toast } from '../../../components/toast.js';
import { confirmDialog } from '../../../components/modal.js';
import { getEmployee, archiveEmployee, unarchiveEmployee } from '../dataActions.js';
import {
  TEAMS, CERT_LABEL_KEYS, QUAL_KEYS, QUAL_LABEL_KEYS, certKeysFor, rdtKeysFor,
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

  return `
    <div class="cert-row">
      <div class="cert-info">
        <div class="name">${escapeHtml(t(CERT_LABEL_KEYS[certKey]))}</div>
        <div class="date">${escapeHtml(fmtDate(expiry))} ${daysLabel(expiry)}</div>
      </div>
      <div class="cert-actions">
        ${certStateBadge(perCert[certKey])}
        ${link ? `
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
 * Equipment assigned to this employee. The server returns [] when the signed-in
 * admin has no view permission on the equipment module, so an empty list here
 * means "none assigned" only for someone who can see equipment at all — which
 * is why the section is skipped entirely for everyone else.
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
            <tr>
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
      <div class="card">
        <div class="detail-grid">
          ${rdtKeysFor(employee.team)
            .map((key) => displayField('emp_field_' + key, employee[key] ? fmtDate(employee[key]) : ''))
            .join('')}
        </div>
      </div>

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

async function doArchive(employeeId) {
  const s = pageState();
  if (s.busy) return;

  const answer = await confirmDialog({
    title: t('emp_archive_title'),
    message: t('emp_archive_message'),
    confirmLabel: t('emp_archive'),
    danger: true,
    input: { label: t('emp_archive_reason'), placeholder: t('emp_archive_reason_ph') },
  });
  if (!answer) return;

  s.busy = true;
  try {
    await archiveEmployee(employeeId, answer.value);
    toastSuccess(t('emp_archived_ok'));

    // The team lists no longer contain this employee — drop their cached pages
    // so they refetch rather than showing a row that is gone.
    delete UI.employeeList;
    invalidate();
  } catch (err) {
    console.error('[employees] archive failed:', err);
    toastError(err);
  } finally {
    s.busy = false;
    render();
  }
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

    delete UI.employeeList;
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
}

/** Called by the form page after a save, so the detail view shows fresh data. */
export function invalidateEmployeeDetail() {
  invalidate();
}
