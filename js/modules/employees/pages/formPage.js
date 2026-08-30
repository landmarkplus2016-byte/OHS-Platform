/* ==========================================================================
   employees/pages/formPage.js — add and edit, one form.

   Both routes land here:
     #/employee/new/field   → create, team fixed by the route
     #/employee/LM-…/edit   → update, team read from the record

   Team decides the shape of the form (Section 6.1): safety-team employees carry
   three extra certificates and three qualification flags that field-team
   employees do not.

   Typing never redraws. Every input writes straight into the page's `values`
   object, so the DOM is the source of truth for nothing — which means an
   unrelated redraw (a language switch, a toast) cannot lose half-entered work,
   and the caret is never disturbed mid-word.

   Client-side validation is the courtesy layer. The Apps Script validates
   everything again and owns the answer (rule 5); its `field_errors` are mapped
   back onto the same inputs below.
   ========================================================================== */

import { UI } from '../../../state.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { t } from '../../../i18n/i18n.js';
import { escapeHtml } from '../../../utils/format.js';
import { toastSuccess, toastError } from '../../../components/toast.js';
import { teamBadge } from '../../../components/badge.js';
import { confirmDialog } from '../../../components/modal.js';
import {
  createEmployee, updateEmployee, getEmployee, loadFieldOptions,
  archiveEmployee, loadArchiveStatuses,
} from '../dataActions.js';
import { invalidateEmployeeDetail } from './detailPage.js';
import { invalidateResignedList } from './resignedPage.js';
import {
  TEAMS, CERT_LABEL_KEYS, QUAL_KEYS, QUAL_LABEL_KEYS, certKeysFor, listKeyFor,
  isArchiveStatus,
} from '../constants.js';

/**
 * Defaults for a new record. Both are picked up only when the FieldOptions list
 * actually offers them — a Sheet that renamed 'Active' should not silently get
 * an employee whose status matches no option.
 */
const NEW_DEFAULTS = { employment_status: 'Active', legal_permission: 'Pending' };

/** Server `field_errors` codes → the message shown under the input. */
const FIELD_ERROR_KEYS = {
  required: 'field_required',
  duplicate: 'emp_err_national_id_duplicate',
  invalid_format: 'emp_err_invalid_date',
  unknown_option: 'emp_err_unknown_option',
};

/**
 * Page state. `key` identifies which form is open, so navigating from one
 * employee's edit form to another's resets rather than showing stale values.
 */
function pageState() {
  if (!UI.employeeForm) {
    UI.employeeForm = {
      key: null,
      mode: 'create',
      team: TEAMS.FIELD,
      employeeId: null,
      status: 'idle',
      values: {},
      original: {},
      errors: {},
      formError: '',
      options: null,
      busy: false,
    };
  }
  return UI.employeeForm;
}

/** Every column this form can write. */
function writableFields(team) {
  const fields = ['national_id', 'name', 'title', 'contractor', 'subcontractor',
    'hired_date', 'employment_status', 'legal_permission'];

  certKeysFor(team).forEach((key) => {
    fields.push('cert_' + key + '_expiry');
    fields.push('cert_' + key + '_link');
    fields.push('cert_' + key + '_na');
    fields.push('cert_' + key + '_suspended');
  });

  if (team === TEAMS.SAFETY) QUAL_KEYS.forEach((key) => fields.push('qual_' + key));

  // No drug-test fields. Tests are events on the RdtLog tab, not columns on the
  // employee, and they are recorded from the RDT page where the selection they
  // belong to is in view.

  return fields;
}

/* ---------- Data ---------------------------------------------------------- */

/**
 * Which columns hold a boolean rather than a string — the qualification flags
 * and the two per-certificate flags. Everything else on this form is text.
 */
function isBooleanField(field) {
  return field.indexOf('qual_') === 0
    || /^cert_.+_(na|suspended)$/.test(field);
}

/** Seed `values` for a brand-new employee. */
function blankValues(team, options) {
  const values = {};
  writableFields(team).forEach((field) => {
    values[field] = isBooleanField(field) ? false : '';
  });

  Object.keys(NEW_DEFAULTS).forEach((field) => {
    const list = (options && options[listKeyFor(field, team)]) || [];
    const match = list.find((o) => o.active && o.option_value === NEW_DEFAULTS[field]);
    if (match) values[field] = match.option_value;
  });

  return values;
}

/** Copy an existing record's writable columns into `values`. */
function valuesFrom(employee, team) {
  const values = {};
  writableFields(team).forEach((field) => {
    const raw = employee[field];
    values[field] = isBooleanField(field) ? raw === true : (raw || '');
  });
  return values;
}

async function ensureData(params) {
  const s = pageState();

  const isCreate = !params.id;
  const key = keyFor(params);
  if (s.key === key && s.status !== 'idle') return;

  s.key = key;
  s.mode = isCreate ? 'create' : 'update';
  s.employeeId = params.id || null;
  s.status = 'loading';
  s.errors = {};
  s.formError = '';
  render();

  try {
    if (isCreate) {
      const team = params.team === TEAMS.SAFETY ? TEAMS.SAFETY : TEAMS.FIELD;
      const options = await loadFieldOptions();

      s.team = team;
      s.options = options;
      s.values = blankValues(team, options);
      s.original = {};
    } else {
      const [data, options] = await Promise.all([getEmployee(params.id), loadFieldOptions()]);
      const employee = data.employee;

      s.team = employee.team === TEAMS.SAFETY ? TEAMS.SAFETY : TEAMS.FIELD;
      s.options = options;
      s.values = valuesFrom(employee, s.team);
      s.original = { ...s.values };

      // An archived record is read-only until it is unarchived (Section 3.5),
      // so there is nothing to edit — send the user back to look at it. Clear
      // the key first: leaving it set with status 'loading' would make a later
      // return to this URL match the guard above and hang on the spinner.
      if (employee.archived) {
        s.key = null;
        s.status = 'idle';
        go('employee/:id', { id: params.id });
        return;
      }
    }
    s.status = 'ready';
  } catch (err) {
    s.status = 'error';
    console.error('[employees] form load failed:', err);
    toastError(err);
  }

  render();
}

/* ---------- Rendering ----------------------------------------------------- */

/** The error line under one input, when that input has one. */
function fieldError(s, field) {
  const code = s.errors[field];
  if (!code) return '';

  const key = FIELD_ERROR_KEYS[code] || 'err_validation_failed';
  return `<div class="err">${escapeHtml(t(key))}</div>`;
}

/** A text input bound to `values[field]`. */
function textInput(s, field, labelKey, options) {
  const opts = options || {};
  const id = 'emp-f-' + field;

  return `
    <div class="field">
      <label for="${id}">${escapeHtml(t(labelKey))}${opts.required ? ' *' : ''}</label>
      <input id="${id}" data-field="${escapeHtml(field)}"
             type="${opts.type || 'text'}"
             ${opts.placeholder ? `placeholder="${escapeHtml(opts.placeholder)}"` : ''}
             autocomplete="off"
             ${opts.disabled ? 'disabled' : ''}
             value="${escapeHtml(s.values[field] || '')}">
      ${fieldError(s, field)}
    </div>`;
}

/** A checkbox bound to `values[field]`. */
function checkInput(s, field, labelKey, options) {
  const opts = options || {};
  const id = 'emp-f-' + field;

  return `
    <label class="check ${escapeHtml(opts.className || '')}" for="${id}">
      <input type="checkbox" id="${id}" data-field="${escapeHtml(field)}"
             ${s.values[field] ? 'checked' : ''}
             ${opts.disabled ? 'disabled' : ''}>
      <span>${escapeHtml(t(labelKey))}</span>
    </label>`;
}

/** A select filled from a FieldOptions list. */
function selectInput(s, field, labelKey) {
  const id = 'emp-f-' + field;
  const selected = s.values[field] || '';
  const list = (s.options && s.options[listKeyFor(field, s.team)]) || [];

  // A deactivated option still renders while it is the record's current value,
  // so opening an old employee and saving an unrelated change cannot silently
  // blank a column the admin never touched.
  const visible = list.filter((o) => o.active || o.option_value === selected);

  return `
    <div class="field">
      <label for="${id}">${escapeHtml(t(labelKey))}</label>
      <select id="${id}" data-field="${escapeHtml(field)}">
        <option value="">—</option>
        ${visible.map((o) => `
          <option value="${escapeHtml(o.option_value)}"${o.option_value === selected ? ' selected' : ''}>
            ${escapeHtml(o.option_value)}
          </option>`).join('')}
      </select>
      ${fieldError(s, field)}
    </div>`;
}

/**
 * One certificate: expiry date, the Drive link, and the two flags that override
 * the date (Section 6.1).
 *
 * `na` says the certificate does not apply to this employee — the date and link
 * go dead, because there is nothing to record. `suspended` says it applies but
 * is void right now, so the date stays editable: the expiry is still a real
 * fact about the certificate, it just is not the one that decides the state.
 *
 * N/A disables the suspended box because it wins outright in derivation. The
 * server applies that precedence itself; this is the courtesy layer showing the
 * user what it is going to do (rule 5).
 */
function certCard(s, certKey) {
  const expiryField = 'cert_' + certKey + '_expiry';
  const linkField = 'cert_' + certKey + '_link';
  const naField = 'cert_' + certKey + '_na';
  const suspendedField = 'cert_' + certKey + '_suspended';

  const na = !!s.values[naField];
  const suspended = !!s.values[suspendedField];

  return `
    <div class="cert-edit${na ? ' cert-edit-na' : ''}${!na && suspended ? ' cert-edit-suspended' : ''}"
         data-cert-block="${escapeHtml(certKey)}">
      <div class="cert-edit-title">${escapeHtml(t(CERT_LABEL_KEYS[certKey]))}</div>
      ${textInput(s, expiryField, 'emp_field_expiry_date', { type: 'date', disabled: na })}
      ${textInput(s, linkField, 'emp_field_cert_link', {
        type: 'url', placeholder: t('emp_cert_link_ph'), disabled: na,
      })}
      <div class="cert-edit-flags">
        ${checkInput(s, naField, 'emp_cert_na_label', { className: 'cert-flag-na' })}
        ${checkInput(s, suspendedField, 'emp_cert_suspended_label', {
          className: 'cert-flag-suspended', disabled: na,
        })}
      </div>
    </div>`;
}

/** The `key` a set of route params describes, so a draw can tell stale state. */
function keyFor(params) {
  return params && params.id ? 'edit:' + params.id : 'new:' + (params && params.team);
}

/**
 * @param {Object} params route params — {team} for new, {id} for edit
 * @returns {string} HTML
 */
export function renderEmployeeFormPage(params) {
  const s = pageState();

  // The first draw of a route happens before bind() has loaded anything, so
  // check that the state in hand belongs to *this* form — otherwise navigating
  // from one employee's edit page to another's would flash the first one's
  // values for a frame.
  if (s.key !== keyFor(params)) {
    return `<div class="employee-form"><div class="cell-empty">${escapeHtml(t('loading_data'))}</div></div>`;
  }

  if (s.status !== 'ready') {
    return `<div class="employee-form"><div class="cell-empty">${escapeHtml(
      t(s.status === 'error' ? 'err_server_error' : 'loading_data')
    )}</div></div>`;
  }

  const isCreate = s.mode === 'create';
  const certKeys = certKeysFor(s.team);

  return `
    <div class="employee-form">
      <div class="page-head">
        <div>
          <div class="page-head-title">${escapeHtml(isCreate ? t('emp_new_title') : (s.values.name || ''))}</div>
          <div class="page-head-sub">${escapeHtml(isCreate ? t('emp_team_locked') : s.employeeId)}</div>
        </div>
        <div class="page-head-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="cancel">${escapeHtml(t('cancel'))}</button>
          <button type="button" class="btn btn-primary btn-sm" data-action="save"
                  ${s.busy ? 'disabled' : ''}>${escapeHtml(s.busy ? t('saving') : t('save'))}</button>
        </div>
      </div>

      <div class="badge-row">${teamBadge(s.team)}</div>
      ${s.formError ? `<div class="banner banner-danger">${escapeHtml(s.formError)}</div>` : ''}

      <div class="section-head">${escapeHtml(t('emp_section_personal'))}</div>
      <div class="card">
        <div class="detail-grid">
          ${textInput(s, 'name', 'emp_field_name', { required: true })}
          ${textInput(s, 'national_id', 'emp_field_national_id', { required: true })}
          ${selectInput(s, 'title', 'emp_field_title')}
          ${selectInput(s, 'contractor', 'emp_field_contractor')}
          ${selectInput(s, 'subcontractor', 'emp_field_subcontractor')}
          ${textInput(s, 'hired_date', 'emp_field_hired_date', { type: 'date' })}
          ${selectInput(s, 'employment_status', 'emp_field_employment_status')}
          ${selectInput(s, 'legal_permission', 'emp_field_legal_permission')}
        </div>
      </div>

      <div class="section-head">${escapeHtml(t('emp_section_certs'))}</div>
      <div class="card">
        <div class="cert-edit-grid">
          ${certKeys.map((key) => certCard(s, key)).join('')}
        </div>
      </div>

      ${s.team === TEAMS.SAFETY ? `
        <div class="section-head">${escapeHtml(t('emp_section_quals'))}</div>
        <div class="card">
          <div class="check-row">
            ${QUAL_KEYS.map((key) => `
              <label class="check">
                <input type="checkbox" id="emp-f-qual_${escapeHtml(key)}"
                       data-field="qual_${escapeHtml(key)}"
                       ${s.values['qual_' + key] ? 'checked' : ''}>
                <span>${escapeHtml(t(QUAL_LABEL_KEYS[key]))}</span>
              </label>`).join('')}
          </div>
        </div>` : ''}

    </div>`;
}

/* ---------- Save ---------------------------------------------------------- */

/** Required-field checks. Everything else the server owns. */
function validate(s) {
  const errors = {};

  if (!String(s.values.name || '').trim()) errors.name = 'required';
  if (!String(s.values.national_id || '').trim()) errors.national_id = 'required';

  return errors;
}

/** Only the columns that actually changed, for an update. */
function changedValues(s) {
  const changes = {};

  Object.keys(s.values).forEach((field) => {
    if (s.values[field] !== s.original[field]) changes[field] = s.values[field];
  });

  return changes;
}

/**
 * After a save that set a terminal employment status, offer to archive.
 *
 * `employment_status` and `archived` answer different questions — why someone
 * left, and whether the platform still lists them — and nothing derives one
 * from the other. Left to itself that produced people marked Resigned who were
 * still on the Field Team list and absent from Resigned & Terminated, because
 * only `archived` moves a record between those two pages.
 *
 * The offer comes *after* the save rather than before it so neither answer is
 * ambiguous: the status is already stored, Escape declines the archive alone,
 * and there is no reading of this dialog under which work is lost. Archiving
 * stays an explicit act with a reason and an author, which is what
 * `archived_by` / `archived_at` are for — a dropdown quietly stamping them
 * would be worse than the drift it fixes.
 *
 * Never throws: the save it follows has already succeeded and been reported, so
 * a failure here is reported on its own terms rather than turned into a
 * validation error against a form that was fine.
 *
 * @param {string} employeeId
 * @param {string|undefined} nextStatus  absent when the status did not change
 */
async function offerArchive(employeeId, nextStatus) {
  if (!nextStatus) return;

  try {
    const statuses = await loadArchiveStatuses();
    if (!isArchiveStatus(nextStatus, statuses)) return;

    const answer = await confirmDialog({
      title: t('emp_archive_on_status_title'),
      message: t('emp_archive_on_status_message', { status: nextStatus }),
      confirmLabel: t('emp_archive'),
      cancelLabel: t('emp_archive_on_status_decline'),
      danger: true,
      input: { label: t('emp_archive_reason'), placeholder: t('emp_archive_reason_ph') },
    });
    if (!answer) return;

    // The status is already on the row from the save, so it is not resent here.
    await archiveEmployee(employeeId, answer.value);
    toastSuccess(t('emp_archived_ok'));

    // Both lists change hands here: off a team list, onto Resigned & Terminated.
    delete UI.employeeList;
    invalidateResignedList();
    invalidateEmployeeDetail();
  } catch (err) {
    console.error('[employees] archive after status change failed:', err);
    toastError(err);
  }
}

async function save() {
  const s = pageState();
  if (s.busy) return;

  s.errors = validate(s);
  s.formError = '';

  if (Object.keys(s.errors).length) {
    render();
    return;
  }

  const isCreate = s.mode === 'create';
  const payload = isCreate
    ? { ...s.values, team: s.team }
    : changedValues(s);

  if (!isCreate && Object.keys(payload).length === 0) {
    s.formError = t('emp_err_no_changes');
    render();
    return;
  }

  s.busy = true;
  render();

  try {
    const data = isCreate
      ? await createEmployee(payload)
      : await updateEmployee(s.employeeId, payload);

    toastSuccess(t(isCreate ? 'emp_created_ok' : 'emp_saved_ok'));

    // Both caches now describe the world before this save.
    delete UI.employeeList;
    invalidateEmployeeDetail();

    s.key = null;   // so re-entering the form reloads rather than reusing this
    s.busy = false;

    // `payload` carries employment_status only when it changed, so editing an
    // unrelated field on someone already marked Resigned does not nag.
    await offerArchive(data.employee.employee_id, payload.employment_status);

    go('employee/:id', { id: data.employee.employee_id });
  } catch (err) {
    s.busy = false;
    console.error('[employees] save failed:', err);

    if (err && err.code === 'validation_failed' && err.field_errors) {
      s.errors = err.field_errors;
      s.formError = t('err_validation_failed');
    } else {
      toastError(err);
    }
    render();
  }
}

/* ---------- Events -------------------------------------------------------- */

/**
 * @param {Object} params route params
 */
export function bindEmployeeFormEvents(params) {
  const root = document.querySelector('.employee-form');
  if (!root) return;

  ensureData(params || {});

  const s = pageState();

  /* Inputs write into state and never redraw. The form is a controlled
     surface: `values` is the truth, the DOM is just how it is shown. */
  root.querySelectorAll('[data-field]').forEach((el) => {
    const field = el.dataset.field;
    const isCheckbox = el.type === 'checkbox';

    el.addEventListener(isCheckbox ? 'change' : 'input', () => {
      s.values[field] = isCheckbox ? el.checked : el.value;

      // Clear the error the moment the user starts fixing it, without a redraw:
      // the message sits next to the input, so removing the node is enough.
      if (s.errors[field]) {
        delete s.errors[field];
        const err = el.parentElement && el.parentElement.querySelector('.err');
        if (err) err.textContent = '';
      }
    });
  });

  /* The two certificate flags restyle their own block in place. Same reason the
     rest of the form never redraws: a redraw here would throw away the caret in
     whichever date field the admin was part-way through typing. */
  root.querySelectorAll('[data-cert-block]').forEach((block) => {
    const naBox = block.querySelector('.cert-flag-na input');
    const suspendedBox = block.querySelector('.cert-flag-suspended input');
    if (!naBox || !suspendedBox) return;

    const paint = () => {
      const na = naBox.checked;

      block.classList.toggle('cert-edit-na', na);
      block.classList.toggle('cert-edit-suspended', !na && suspendedBox.checked);

      // N/A means there is nothing to record and nothing to suspend. The
      // suspended flag keeps whatever value it had — unticking N/A brings it
      // back rather than silently clearing a decision somebody made.
      block.querySelectorAll('input[type="date"], input[type="url"]')
        .forEach((input) => { input.disabled = na; });
      suspendedBox.disabled = na;
    };

    naBox.addEventListener('change', paint);
    suspendedBox.addEventListener('change', paint);
  });

  const cancel = root.querySelector('[data-action="cancel"]');
  if (cancel) {
    cancel.addEventListener('click', () => {
      s.key = null;
      if (s.mode === 'update' && s.employeeId) go('employee/:id', { id: s.employeeId });
      else go(s.team === TEAMS.SAFETY ? 'safety' : 'field');
    });
  }

  const saveBtn = root.querySelector('[data-action="save"]');
  if (saveBtn) saveBtn.addEventListener('click', save);
}
