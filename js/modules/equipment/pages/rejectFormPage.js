/* ==========================================================================
   equipment/pages/rejectFormPage.js — rejecting one item, with its reason.

   #/equipment/LM-…/reject

   A page rather than a modal. Rejection is the equipment module's soft delete
   (rule 6) and the reason it carries is the only record of *why* — it shows up
   on the rejected list, on the detail page, and in the officer's blocked
   verdict (Section 6.3). A reason typed into a one-line modal field tends to
   read like one; giving it a page and a textarea tends to get a sentence.

   The date defaults to today because that is nearly always right, and stays
   editable because paperwork sometimes lands late.

   `rejected_by` is not on this form and never will be: audit authorship comes
   from the session server-side, never from the client (Section 3.9).
   ========================================================================== */

import { UI } from '../../../state.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { t } from '../../../i18n/i18n.js';
import { escapeHtml, todayISO } from '../../../utils/format.js';
import { canEdit } from '../../../utils/permissions.js';
import { MODULE_NAMES } from '../../../constants/globals.js';
import { toastSuccess, toastError } from '../../../components/toast.js';
import { getEquipment, rejectEquipment } from '../dataActions.js';
import { invalidateEquipmentDetail } from './detailPage.js';
import { invalidateEquipmentList } from './listPage.js';
import { invalidateRejectedEquipment } from './rejectedPage.js';

/** Server `field_errors` codes → the message shown under the input. */
const FIELD_ERROR_KEYS = {
  required: 'field_required',
  invalid_format: 'eqp_err_invalid_date',
};

function pageState() {
  if (!UI.equipmentReject) {
    UI.equipmentReject = {
      key: null,
      equipmentId: null,
      status: 'idle',
      item: null,
      values: { rejection_date: '', rejection_reason: '' },
      errors: {},
      formError: '',
      busy: false,
    };
  }
  return UI.equipmentReject;
}

/* ---------- Data ---------------------------------------------------------- */

async function ensureData(params) {
  const s = pageState();

  const equipmentId = params && params.id;
  if (s.key === equipmentId && s.status !== 'idle') return;

  s.key = equipmentId;
  s.equipmentId = equipmentId;
  s.status = 'loading';
  s.errors = {};
  s.formError = '';
  s.values = { rejection_date: todayISO(), rejection_reason: '' };
  render();

  try {
    const data = await getEquipment(equipmentId);
    s.item = data.equipment;

    // Already rejected — there is nothing to do here. Send the user to the
    // record instead of letting them submit a second rejection that the server
    // would treat as a no-op.
    if (s.item.rejected) {
      s.key = null;
      s.status = 'idle';
      go('equipment/:id', { id: equipmentId });
      return;
    }

    s.status = 'ready';
  } catch (err) {
    s.status = 'error';
    console.error('[equipment] reject form load failed:', err);
    toastError(err);
  }

  render();
}

/* ---------- Rendering ----------------------------------------------------- */

function fieldError(s, field) {
  const code = s.errors[field];
  if (!code) return '';

  const key = FIELD_ERROR_KEYS[code] || 'err_validation_failed';
  return `<div class="err">${escapeHtml(t(key))}</div>`;
}

/**
 * @param {Object} params route params, {id}
 * @returns {string} HTML
 */
export function renderEquipmentRejectPage(params) {
  const s = pageState();
  const equipmentId = params && params.id;

  if (s.key !== equipmentId || s.status === 'loading' || s.status === 'idle') {
    return `<div class="equipment-reject"><div class="cell-empty">${escapeHtml(t('loading_data'))}</div></div>`;
  }

  if (s.status === 'error') {
    return `
      <div class="equipment-reject">
        <div class="card">
          <div class="cell-empty">${escapeHtml(t('err_server_error'))}</div>
          <div class="page-head-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-action="cancel">${escapeHtml(t('back'))}</button>
          </div>
        </div>
      </div>`;
  }

  // Permission is UX only — the Apps Script rejects the write regardless
  // (rule 5) — but a form the user cannot submit should not be drawn.
  if (!canEdit(MODULE_NAMES.EQUIPMENT)) {
    return `
      <div class="equipment-reject">
        <div class="card">
          <div class="cell-empty">${escapeHtml(t('err_forbidden'))}</div>
          <div class="page-head-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-action="cancel">${escapeHtml(t('back'))}</button>
          </div>
        </div>
      </div>`;
  }

  const item = s.item;

  return `
    <div class="equipment-reject">
      <div class="page-head">
        <div>
          <div class="page-head-title">${escapeHtml(t('eqp_reject_title'))}</div>
          <div class="page-head-sub">
            ${escapeHtml(item.item || item.equipment_id)} · ${escapeHtml(item.equipment_id)} · ${escapeHtml(item.serial_no)}
          </div>
        </div>
        <div class="page-head-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="cancel">${escapeHtml(t('cancel'))}</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="reject"
                  ${s.busy ? 'disabled' : ''}>${escapeHtml(s.busy ? t('saving') : t('eqp_reject_confirm'))}</button>
        </div>
      </div>

      <div class="banner banner-warn">${escapeHtml(t('eqp_reject_intro'))}</div>
      ${s.formError ? `<div class="banner banner-danger">${escapeHtml(s.formError)}</div>` : ''}

      <div class="card">
        <div class="detail-grid">
          <div class="field">
            <label for="eqp-reject-date">${escapeHtml(t('eqp_field_rejection_date'))}</label>
            <input id="eqp-reject-date" data-field="rejection_date" type="date"
                   value="${escapeHtml(s.values.rejection_date)}">
            ${fieldError(s, 'rejection_date')}
          </div>
        </div>

        <div class="field">
          <label for="eqp-reject-reason">${escapeHtml(t('eqp_field_rejection_reason'))}</label>
          <textarea id="eqp-reject-reason" data-field="rejection_reason" rows="3"
                    placeholder="${escapeHtml(t('eqp_reject_reason_ph'))}">${escapeHtml(s.values.rejection_reason)}</textarea>
          ${fieldError(s, 'rejection_reason')}
        </div>
      </div>
    </div>`;
}

/* ---------- Submit -------------------------------------------------------- */

async function submit() {
  const s = pageState();
  if (s.busy) return;

  s.errors = {};
  s.formError = '';

  // The server defaults a blank date to today, but an admin who cleared the
  // field meant something by it — ask rather than guess.
  if (!String(s.values.rejection_date || '').trim()) {
    s.errors.rejection_date = 'required';
    render();
    return;
  }

  s.busy = true;
  render();

  try {
    await rejectEquipment(s.equipmentId, {
      rejection_date: s.values.rejection_date,
      rejection_reason: s.values.rejection_reason,
    });

    toastSuccess(t('eqp_rejected_ok'));

    invalidateEquipmentList();
    invalidateRejectedEquipment();
    invalidateEquipmentDetail();

    s.key = null;
    s.busy = false;

    go('equipment/:id', { id: s.equipmentId });
  } catch (err) {
    s.busy = false;
    console.error('[equipment] reject failed:', err);

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
 * @param {Object} params route params, {id}
 */
export function bindEquipmentRejectPageEvents(params) {
  const root = document.querySelector('.equipment-reject');
  if (!root) return;

  ensureData(params || {});

  const s = pageState();

  root.querySelectorAll('[data-field]').forEach((el) => {
    const field = el.dataset.field;

    el.addEventListener('input', () => {
      s.values[field] = el.value;

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
      go('equipment/:id', { id: s.equipmentId || (params && params.id) });
    });
  }

  const rejectBtn = root.querySelector('[data-action="reject"]');
  if (rejectBtn) rejectBtn.addEventListener('click', submit);
}
