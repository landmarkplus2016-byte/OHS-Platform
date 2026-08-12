/* ==========================================================================
   equipment/pages/formPage.js — add and edit, one form.

   Both routes land here:
     #/equipment/new        → create
     #/equipment/LM-…/edit  → update

   Typing never redraws. Every input writes straight into the page's `values`
   object, so the DOM is the source of truth for nothing — which means an
   unrelated redraw (a language switch, a toast) cannot lose half-entered work,
   and the caret is never disturbed mid-word.

   Client-side validation is the courtesy layer. The Apps Script validates
   everything again and owns the answer (rule 5); its `field_errors` are mapped
   back onto the same inputs below.

   THE TEAM LEADER PICKER
   ---------------------
   `team_leader_id` references an employee, and the server rejects an id that
   resolves to nobody — so the form offers the real roster rather than asking an
   admin to remember an ID. That roster comes from `list_employees`, which an
   equipment-only module admin is not allowed to call. When they cannot, the
   picker degrades to a plain ID input instead of showing an empty select or an
   error they cannot act on.

   Rejection is not editable here. `rejected` moves only through
   reject_equipment / unreject_equipment; sending it in an update is a
   `conflict` server-side (Section 3.6).
   ========================================================================== */

import { UI } from '../../../state.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { t } from '../../../i18n/i18n.js';
import { escapeHtml } from '../../../utils/format.js';
import { canView } from '../../../utils/permissions.js';
import { MODULE_NAMES } from '../../../constants/globals.js';
import { toastSuccess, toastError } from '../../../components/toast.js';
import {
  createEquipment, updateEquipment, getEquipment, loadFieldOptions, listAssignableEmployees,
} from '../dataActions.js';
import { invalidateEquipmentDetail } from './detailPage.js';
import { invalidateEquipmentList } from './listPage.js';
import { listKeyFor } from '../constants.js';

/** Server `field_errors` codes → the message shown under the input. */
const FIELD_ERROR_KEYS = {
  required: 'field_required',
  duplicate: 'eqp_err_serial_duplicate',
  invalid_format: 'eqp_err_invalid_date',
  invalid_value: 'eqp_err_unknown_option',
  unknown_option: 'eqp_err_unknown_option',
  unknown_employee: 'eqp_err_unknown_employee',
};

/**
 * Page state. `key` identifies which form is open, so navigating from one
 * item's edit form to another's resets rather than showing stale values.
 */
function pageState() {
  if (!UI.equipmentForm) {
    UI.equipmentForm = {
      key: null,
      mode: 'create',
      equipmentId: null,
      status: 'idle',
      values: {},
      original: {},
      errors: {},
      formError: '',
      options: null,
      employees: null,   // null = no picker (no permission, or the fetch failed)
      busy: false,
    };
  }
  return UI.equipmentForm;
}

/**
 * Every column this form can write (Section 2, Equipment tab).
 *
 * No wave fields. A wave is an event with its own date, author and comment, not
 * an attribute of the item — it is recorded from the item's detail page or from
 * an officer's phone, and the server rejects a wave column sent through
 * `update_equipment` as an unknown key.
 */
function writableFields() {
  return ['item', 'brand', 'serial_no', 'third_party_sn',
    'date_of_manufacture', 'third_party_inspection_end_date',
    'subcontractor', 'team_leader_id', 'comments'];
}

/** The `key` a set of route params describes, so a draw can tell stale state. */
function keyFor(params) {
  return params && params.id ? 'edit:' + params.id : 'new';
}

/* ---------- Data ---------------------------------------------------------- */

/** Seed `values` for a brand-new item. */
function blankValues() {
  const values = {};
  writableFields().forEach((field) => { values[field] = ''; });
  return values;
}

/** Copy an existing record's writable columns into `values`. */
function valuesFrom(item) {
  const values = {};
  writableFields().forEach((field) => { values[field] = item[field] || ''; });
  return values;
}

/**
 * The roster for the team-leader picker, or null when this admin cannot have
 * one. A failed fetch is not fatal — the form falls back to the ID input.
 */
async function loadEmployees() {
  if (!canView(MODULE_NAMES.EMPLOYEES)) return null;

  try {
    return await listAssignableEmployees();
  } catch (err) {
    console.warn('[equipment] team leader picker unavailable:', err);
    return null;
  }
}

async function ensureData(params) {
  const s = pageState();

  const isCreate = !params.id;
  const key = keyFor(params);
  if (s.key === key && s.status !== 'idle') return;

  s.key = key;
  s.mode = isCreate ? 'create' : 'update';
  s.equipmentId = params.id || null;
  s.status = 'loading';
  s.errors = {};
  s.formError = '';
  render();

  try {
    if (isCreate) {
      const [options, employees] = await Promise.all([loadFieldOptions(), loadEmployees()]);

      s.options = options;
      s.employees = employees;
      s.values = blankValues();
      s.original = {};
    } else {
      const [data, options, employees] = await Promise.all([
        getEquipment(params.id), loadFieldOptions(), loadEmployees(),
      ]);
      const item = data.equipment;

      s.options = options;
      s.employees = employees;
      s.values = valuesFrom(item);
      s.original = { ...s.values };

      // A rejected item is edited by returning it to service first — the
      // detail page is where that button lives. Clear the key before leaving:
      // leaving it set with status 'loading' would make a later return to this
      // URL match the guard above and hang on the spinner.
      if (item.rejected) {
        s.key = null;
        s.status = 'idle';
        go('equipment/:id', { id: params.id });
        return;
      }
    }
    s.status = 'ready';
  } catch (err) {
    s.status = 'error';
    console.error('[equipment] form load failed:', err);
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
  const id = 'eqp-f-' + field;

  return `
    <div class="field">
      <label for="${id}">${escapeHtml(t(labelKey))}${opts.required ? ' *' : ''}</label>
      <input id="${id}" data-field="${escapeHtml(field)}"
             type="${opts.type || 'text'}"
             ${opts.placeholder ? `placeholder="${escapeHtml(opts.placeholder)}"` : ''}
             autocomplete="off"
             value="${escapeHtml(s.values[field] || '')}">
      ${opts.hint ? `<div class="cell-sub">${escapeHtml(opts.hint)}</div>` : ''}
      ${fieldError(s, field)}
    </div>`;
}

/** A select filled from a FieldOptions list. */
function selectInput(s, field, labelKey) {
  const id = 'eqp-f-' + field;
  const selected = s.values[field] || '';
  const list = (s.options && s.options[listKeyFor(field)]) || [];

  // A deactivated option still renders while it is the record's current value,
  // so opening an old item and saving an unrelated change cannot silently blank
  // a column the admin never touched.
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

/** The team-leader control: a roster picker, or a plain ID input. */
function teamLeaderInput(s) {
  if (!s.employees) {
    return textInput(s, 'team_leader_id', 'eqp_field_team_leader', {
      hint: t('eqp_team_leader_manual'),
    });
  }

  const selected = s.values.team_leader_id || '';

  // An employee archived since this item was assigned still renders, so an
  // unrelated save cannot silently drop the assignment. The roster itself only
  // carries active employees.
  const known = s.employees.some((employee) => employee.employee_id === selected);

  return `
    <div class="field">
      <label for="eqp-f-team_leader_id">${escapeHtml(t('eqp_field_team_leader'))}</label>
      <select id="eqp-f-team_leader_id" data-field="team_leader_id">
        <option value="">${escapeHtml(t('eqp_team_leader_none'))}</option>
        ${selected && !known
          ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`
          : ''}
        ${s.employees.map((employee) => `
          <option value="${escapeHtml(employee.employee_id)}"${employee.employee_id === selected ? ' selected' : ''}>
            ${escapeHtml(employee.name)} · ${escapeHtml(employee.employee_id)}
          </option>`).join('')}
      </select>
      ${fieldError(s, 'team_leader_id')}
    </div>`;
}

/**
 * @param {Object} params route params — {} for new, {id} for edit
 * @returns {string} HTML
 */
export function renderEquipmentFormPage(params) {
  const s = pageState();

  // The first draw of a route happens before bind() has loaded anything, so
  // check that the state in hand belongs to *this* form — otherwise navigating
  // from one item's edit page to another's would flash the first one's values
  // for a frame.
  if (s.key !== keyFor(params)) {
    return `<div class="equipment-form"><div class="cell-empty">${escapeHtml(t('loading_data'))}</div></div>`;
  }

  if (s.status !== 'ready') {
    return `<div class="equipment-form"><div class="cell-empty">${escapeHtml(
      t(s.status === 'error' ? 'err_server_error' : 'loading_data')
    )}</div></div>`;
  }

  const isCreate = s.mode === 'create';

  return `
    <div class="equipment-form">
      <div class="page-head">
        <div>
          <div class="page-head-title">${escapeHtml(isCreate ? t('eqp_new_title') : (s.values.item || t('module_equipment')))}</div>
          <div class="page-head-sub">${escapeHtml(isCreate ? '' : s.equipmentId)}</div>
        </div>
        <div class="page-head-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="cancel">${escapeHtml(t('cancel'))}</button>
          <button type="button" class="btn btn-primary btn-sm" data-action="save"
                  ${s.busy ? 'disabled' : ''}>${escapeHtml(s.busy ? t('saving') : t('save'))}</button>
        </div>
      </div>

      ${s.formError ? `<div class="banner banner-danger">${escapeHtml(s.formError)}</div>` : ''}

      <div class="section-head">${escapeHtml(t('eqp_section_identity'))}</div>
      <div class="card">
        <div class="detail-grid">
          ${selectInput(s, 'item', 'eqp_field_item')}
          ${selectInput(s, 'brand', 'eqp_field_brand')}
          ${textInput(s, 'serial_no', 'eqp_field_serial_no', { required: true })}
          ${textInput(s, 'third_party_sn', 'eqp_field_third_party_sn', { required: true })}
          ${textInput(s, 'date_of_manufacture', 'eqp_field_date_of_manufacture', { type: 'date' })}
        </div>
      </div>

      <div class="section-head">${escapeHtml(t('eqp_section_inspection'))}</div>
      <div class="card">
        <div class="detail-grid">
          ${textInput(s, 'third_party_inspection_end_date', 'eqp_field_third_party_end', { type: 'date' })}
        </div>
      </div>

      <div class="section-head">${escapeHtml(t('eqp_section_assignment'))}</div>
      <div class="card">
        <div class="detail-grid">
          ${selectInput(s, 'subcontractor', 'eqp_field_subcontractor')}
          ${teamLeaderInput(s)}
        </div>
      </div>

      ${isCreate ? '' : `
        <div class="section-head">${escapeHtml(t('eqp_section_waves'))}</div>
        <div class="card">
          <div class="cell-empty">${escapeHtml(t('eqp_wave_form_hint'))}</div>
          <div class="page-head-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-action="open-waves">
              ${escapeHtml(t('eqp_wave_view_log'))}
            </button>
          </div>
        </div>`}

      <div class="section-head">${escapeHtml(t('eqp_section_notes'))}</div>
      <div class="card">
        <div class="field">
          <label for="eqp-f-comments">${escapeHtml(t('eqp_field_comments'))}</label>
          <textarea id="eqp-f-comments" data-field="comments" rows="3">${escapeHtml(s.values.comments || '')}</textarea>
          ${fieldError(s, 'comments')}
        </div>
      </div>
    </div>`;
}

/* ---------- Save ---------------------------------------------------------- */

/** Required-field checks. Everything else the server owns. */
function validate(s) {
  const errors = {};

  if (!String(s.values.serial_no || '').trim()) errors.serial_no = 'required';
  if (!String(s.values.third_party_sn || '').trim()) errors.third_party_sn = 'required';

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
  const payload = isCreate ? { ...s.values } : changedValues(s);

  if (!isCreate && Object.keys(payload).length === 0) {
    s.formError = t('eqp_err_no_changes');
    render();
    return;
  }

  s.busy = true;
  render();

  try {
    const data = isCreate
      ? await createEquipment(payload)
      : await updateEquipment(s.equipmentId, payload);

    toastSuccess(t(isCreate ? 'eqp_created_ok' : 'eqp_saved_ok'));

    // Both caches now describe the world before this save.
    invalidateEquipmentList();
    invalidateEquipmentDetail();

    s.key = null;   // so re-entering the form reloads rather than reusing this
    s.busy = false;

    go('equipment/:id', { id: data.equipment.equipment_id });
  } catch (err) {
    s.busy = false;
    console.error('[equipment] save failed:', err);

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
export function bindEquipmentFormEvents(params) {
  const root = document.querySelector('.equipment-form');
  if (!root) return;

  ensureData(params || {});

  const s = pageState();

  /* Inputs write into state and never redraw. The form is a controlled
     surface: `values` is the truth, the DOM is just how it is shown. */
  root.querySelectorAll('[data-field]').forEach((el) => {
    const field = el.dataset.field;

    el.addEventListener('input', () => {
      s.values[field] = el.value;

      // Clear the error the moment the user starts fixing it, without a redraw:
      // the message sits next to the input, so blanking the node is enough.
      if (s.errors[field]) {
        delete s.errors[field];
        const err = el.parentElement && el.parentElement.querySelector('.err');
        if (err) err.textContent = '';
      }
    });
  });

  const cancel = root.querySelector('[data-action="cancel"]');
  if (cancel) {
    cancel.addEventListener('click', () => {
      s.key = null;
      if (s.mode === 'update' && s.equipmentId) go('equipment/:id', { id: s.equipmentId });
      else go('equipment');
    });
  }

  const saveBtn = root.querySelector('[data-action="save"]');
  if (saveBtn) saveBtn.addEventListener('click', save);

  // Waves are not a field of this form. The button leaves it for the log, which
  // is where they are recorded and corrected.
  const openWaves = root.querySelector('[data-action="open-waves"]');
  if (openWaves) {
    openWaves.addEventListener('click', () => {
      s.key = null;
      go('equipment/waves/:id', { id: s.equipmentId });
    });
  }
}
