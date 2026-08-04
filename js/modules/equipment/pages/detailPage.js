/* ==========================================================================
   equipment/pages/detailPage.js — one item, everything about it.

   `get_equipment` returns the record, its inspection history and the resolved
   team leader in a single call (Section 3.6), so this page makes exactly one
   request and renders four sections from it.

   The verdict, the third-party inspection state, and the reason list all arrive
   pre-derived (Section 6.4). Each blocker and warning is {type, text_key,
   text_params}, which goes straight to t() — the frontend owns the wording, the
   server owns the judgement. The only arithmetic here is "how many days until
   this date", which is a label, not a decision.

   THE TEAM LEADER LINK
   -------------------
   Opening the assigned employee is a jump into the employee module's route,
   which is a route name, not an import (rule 12). It is drawn only when the
   signed-in admin can view employees — otherwise the router's own guard would
   bounce them to the dashboard on arrival, which reads as a bug rather than as
   a permission boundary.
   ========================================================================== */

import { UI } from '../../../state.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { t } from '../../../i18n/i18n.js';
import { escapeHtml, fmtDate, fmtDateTime, daysUntil, EMPTY_MARK } from '../../../utils/format.js';
import { canEdit, canView } from '../../../utils/permissions.js';
import { MODULE_NAMES } from '../../../constants/globals.js';
import { certStateBadge, verdictBadge, teamBadge, statusBadge } from '../../../components/badge.js';
import { toast, toastSuccess, toastError } from '../../../components/toast.js';
import { confirmDialog } from '../../../components/modal.js';
import { getEquipment, unrejectEquipment } from '../dataActions.js';
import { invalidateEquipmentList } from './listPage.js';
import { invalidateRejectedEquipment } from './rejectedPage.js';
import { WAVES, WAVE_RESULT_LABEL_KEYS, waveDateField, waveResultField } from '../constants.js';

/** Page state, keyed by item so returning to a different one refetches. */
function pageState() {
  if (!UI.equipmentDetail) {
    UI.equipmentDetail = { id: null, status: 'idle', data: null, error: null, busy: false };
  }
  return UI.equipmentDetail;
}

/** Drop the cached record so the next draw refetches it. */
function invalidate() {
  const s = pageState();
  s.status = 'idle';
  s.data = null;
}

/* ---------- Data ---------------------------------------------------------- */

async function ensureData(equipmentId) {
  const s = pageState();

  if (s.id === equipmentId && (s.status === 'loading' || s.status === 'ready' || s.status === 'error')) return;

  s.id = equipmentId;
  s.status = 'loading';
  s.error = null;
  render();

  try {
    s.data = await getEquipment(equipmentId);
    s.status = 'ready';
  } catch (err) {
    s.status = 'error';
    s.error = err;
    console.error('[equipment] get_equipment failed:', err);
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
    ? t('eqp_days_left', { days })
    : t('eqp_days_ago', { days: Math.abs(days) });

  return `<span class="cert-days">${escapeHtml(text)}</span>`;
}

/**
 * The blockers and warnings the server derived, as sentences.
 *
 * `text_key` + `text_params` is exactly what t() takes (Section 6.4), so this
 * renders a reason the frontend has never had to work out for itself.
 */
function renderIssues(derived) {
  const blockers = derived.blockers || [];
  const warnings = derived.warnings || [];

  if (blockers.length === 0 && warnings.length === 0) {
    return `<div class="card"><div class="cell-empty">${escapeHtml(t('eqp_no_issues'))}</div></div>`;
  }

  const line = (reason, kind) => `
    <div class="banner banner-${kind}">${escapeHtml(t(reason.text_key, reason.text_params || {}))}</div>`;

  return `
    <div class="card">
      ${blockers.map((reason) => line(reason, 'danger')).join('')}
      ${warnings.map((reason) => line(reason, 'warn')).join('')}
    </div>`;
}

/** The three internal waves. A wave with no date has not run yet. */
function renderWaves(item) {
  const recorded = WAVES.filter((wave) => item[waveDateField(wave)] || item[waveResultField(wave)]);

  if (recorded.length === 0) {
    return `<div class="card"><div class="cell-empty">${escapeHtml(t('eqp_no_waves'))}</div></div>`;
  }

  return `
    <div class="card">
      <table class="tbl tbl-flush">
        <thead>
          <tr>
            <th>${escapeHtml(t('eqp_col_wave'))}</th>
            <th>${escapeHtml(t('eqp_col_date'))}</th>
            <th>${escapeHtml(t('eqp_col_result'))}</th>
          </tr>
        </thead>
        <tbody>
          ${recorded.map((wave) => {
            const result = item[waveResultField(wave)];
            const labelKey = WAVE_RESULT_LABEL_KEYS[result];

            return `
              <tr>
                <td>${escapeHtml(t('eqp_wave_n', { wave }))}</td>
                <td>${escapeHtml(fmtDate(item[waveDateField(wave)]))}</td>
                <td>${labelKey
                  ? statusBadge(t(labelKey), result === 'pass')
                  : `<span class="cell-sub">${escapeHtml(t('eqp_wave_pending'))}</span>`}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

/** The inspection history table (Section 3.6 returns it newest-first). */
function renderHistory(history) {
  if (!history || history.length === 0) {
    return `<div class="card"><div class="cell-empty">${escapeHtml(t('eqp_no_history'))}</div></div>`;
  }

  return `
    <div class="card">
      <table class="tbl tbl-flush">
        <thead>
          <tr>
            <th>${escapeHtml(t('eqp_history_old'))}</th>
            <th>${escapeHtml(t('eqp_history_new'))}</th>
            <th>${escapeHtml(t('eqp_history_when'))}</th>
            <th>${escapeHtml(t('eqp_history_by'))}</th>
          </tr>
        </thead>
        <tbody>
          ${history.map((row) => `
            <tr>
              <td>${escapeHtml(fmtDate(row.old_expiry))}</td>
              <td>${escapeHtml(fmtDate(row.new_expiry))}</td>
              <td>${escapeHtml(fmtDateTime(row.renewed_at))}</td>
              <td class="cell-sub">${escapeHtml(row.renewed_by)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/** Who this item is assigned to, with a jump into their record. */
function renderAssignment(item, leader) {
  if (!item.team_leader_id) {
    return `<div class="card"><div class="cell-empty">${escapeHtml(t('eqp_unassigned'))}</div></div>`;
  }

  // The id resolved to nobody — a dangling reference. Show the raw id rather
  // than an empty row, so the admin can see what to fix.
  if (!leader) {
    return `
      <div class="card">
        <div class="detail-grid">
          ${displayField('eqp_field_team_leader', item.team_leader_id)}
        </div>
      </div>`;
  }

  return `
    <div class="card">
      <div class="badge-row">
        ${teamBadge(leader.team)}
        ${leader.archived ? `<span class="badge badge-inactive">${escapeHtml(t('eqp_owner_archived'))}</span>` : ''}
      </div>
      <div class="detail-grid">
        ${displayField('eqp_field_team_leader', leader.name)}
        ${displayField('eqp_leader_national_id', leader.national_id)}
        ${displayField('eqp_leader_title', leader.title)}
        ${displayField('eqp_leader_subcontractor', leader.subcontractor)}
      </div>
      ${canView(MODULE_NAMES.EMPLOYEES) ? `
        <div class="page-head-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="open-leader"
                  data-employee-id="${escapeHtml(leader.employee_id)}">${escapeHtml(t('eqp_view_team_leader'))}</button>
        </div>` : ''}
    </div>`;
}

/**
 * @param {Object} params route params, {id}
 * @returns {string} HTML
 */
export function renderEquipmentDetailPage(params) {
  const s = pageState();
  const equipmentId = params && params.id;

  if (s.status === 'loading' || s.status === 'idle' || s.id !== equipmentId) {
    return `<div class="equipment-detail"><div class="cell-empty">${escapeHtml(t('loading_data'))}</div></div>`;
  }

  if (s.status === 'error') {
    const notFound = s.error && s.error.code === 'not_found';
    return `
      <div class="equipment-detail">
        <div class="card">
          <div class="cell-empty">${escapeHtml(t(notFound ? 'eqp_not_found' : 'err_server_error'))}</div>
          <div class="page-head-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-action="back">${escapeHtml(t('back'))}</button>
          </div>
        </div>
      </div>`;
  }

  const item = s.data.equipment;
  const derived = item.derived || {};
  const editable = canEdit(MODULE_NAMES.EQUIPMENT);

  return `
    <div class="equipment-detail" data-equipment-id="${escapeHtml(item.equipment_id)}">
      <div class="page-head">
        <div>
          <div class="page-head-title">${escapeHtml(item.item || item.equipment_id)}</div>
          <div class="page-head-sub">${escapeHtml(item.brand || EMPTY_MARK)} · ${escapeHtml(item.equipment_id)} · ${escapeHtml(item.serial_no)}</div>
        </div>
        <div class="page-head-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="back">${escapeHtml(t('back'))}</button>
          ${editable && !item.rejected ? `
            <button type="button" class="btn btn-primary btn-sm" data-action="edit">${escapeHtml(t('edit'))}</button>
            <button type="button" class="btn btn-danger btn-sm" data-action="reject">${escapeHtml(t('eqp_reject'))}</button>` : ''}
          ${editable && item.rejected ? `
            <button type="button" class="btn btn-primary btn-sm" data-action="unreject">${escapeHtml(t('eqp_unreject'))}</button>` : ''}
        </div>
      </div>

      ${item.rejected ? `<div class="banner banner-warn">${escapeHtml(t('eqp_rejected_banner'))}</div>` : ''}

      <div class="badge-row">
        ${verdictBadge(derived.verdict)}
        ${certStateBadge(derived.third_party_state)}
      </div>

      <div class="section-head">${escapeHtml(t('eqp_section_issues'))}</div>
      ${renderIssues(derived)}

      <div class="section-head">${escapeHtml(t('eqp_section_identity'))}</div>
      <div class="card">
        <div class="detail-grid">
          ${displayField('eqp_field_item', item.item)}
          ${displayField('eqp_field_brand', item.brand)}
          ${displayField('eqp_field_serial_no', item.serial_no)}
          ${displayField('eqp_field_third_party_sn', item.third_party_sn)}
          ${displayField('eqp_field_date_of_manufacture', item.date_of_manufacture ? fmtDate(item.date_of_manufacture) : '')}
        </div>
      </div>

      <div class="section-head">${escapeHtml(t('eqp_section_inspection'))}</div>
      <div class="card">
        <div class="cert-row">
          <div class="cert-info">
            <div class="name">${escapeHtml(t('eqp_field_third_party_end'))}</div>
            <div class="date">
              ${escapeHtml(fmtDate(item.third_party_inspection_end_date))}
              ${daysLabel(item.third_party_inspection_end_date)}
            </div>
          </div>
          <div class="cert-actions">${certStateBadge(derived.third_party_state)}</div>
        </div>
      </div>

      <div class="section-head">${escapeHtml(t('eqp_section_waves'))}</div>
      ${renderWaves(item)}

      <div class="section-head">${escapeHtml(t('eqp_section_assignment'))}</div>
      ${renderAssignment(item, s.data.team_leader)}

      ${item.rejected ? `
        <div class="section-head">${escapeHtml(t('eqp_section_rejection'))}</div>
        <div class="card">
          <div class="detail-grid">
            ${displayField('eqp_field_rejection_date', item.rejection_date ? fmtDate(item.rejection_date) : '')}
            ${displayField('eqp_field_rejection_reason', item.rejection_reason)}
          </div>
        </div>` : ''}

      <div class="section-head">${escapeHtml(t('eqp_section_notes'))}</div>
      <div class="card">
        ${item.comments
          ? `<p class="modal-body">${escapeHtml(item.comments)}</p>`
          : `<div class="cell-empty">${escapeHtml(t('eqp_no_comments'))}</div>`}
      </div>

      <div class="section-head">${escapeHtml(t('eqp_section_history'))}</div>
      ${renderHistory(s.data.inspection_history)}
    </div>`;
}

/* ---------- Actions ------------------------------------------------------- */

async function doUnreject(equipmentId) {
  const s = pageState();
  if (s.busy) return;

  const answer = await confirmDialog({
    title: t('eqp_unreject_title'),
    message: t('eqp_unreject_message'),
    confirmLabel: t('eqp_unreject'),
  });
  if (!answer) return;

  s.busy = true;
  try {
    await unrejectEquipment(equipmentId);
    toastSuccess(t('eqp_unrejected_ok'));

    invalidateEquipmentList();
    invalidateRejectedEquipment();
    invalidate();
  } catch (err) {
    console.error('[equipment] unreject failed:', err);

    if (err && err.code === 'conflict') toast(t('eqp_serial_taken'), 'error');
    else toastError(err);
  } finally {
    s.busy = false;
    render();
  }
}

/* ---------- Events -------------------------------------------------------- */

/**
 * @param {Object} params route params, {id}
 */
export function bindEquipmentDetailPageEvents(params) {
  const root = document.querySelector('.equipment-detail');
  if (!root) return;

  const equipmentId = params && params.id;
  ensureData(equipmentId);

  const s = pageState();
  const item = s.data && s.data.equipment;

  const back = root.querySelector('[data-action="back"]');
  if (back) {
    back.addEventListener('click', () => go(item && item.rejected ? 'equipment/rejected' : 'equipment'));
  }

  const edit = root.querySelector('[data-action="edit"]');
  if (edit) edit.addEventListener('click', () => go('equipment/:id/edit', { id: equipmentId }));

  const reject = root.querySelector('[data-action="reject"]');
  if (reject) reject.addEventListener('click', () => go('equipment/:id/reject', { id: equipmentId }));

  const unreject = root.querySelector('[data-action="unreject"]');
  if (unreject) unreject.addEventListener('click', () => doUnreject(equipmentId));

  const openLeader = root.querySelector('[data-action="open-leader"]');
  if (openLeader) {
    openLeader.addEventListener('click', () => go('employee/:id', { id: openLeader.dataset.employeeId }));
  }
}

/** Called by the form and reject pages after a write, so the detail refetches. */
export function invalidateEquipmentDetail() {
  invalidate();
}
