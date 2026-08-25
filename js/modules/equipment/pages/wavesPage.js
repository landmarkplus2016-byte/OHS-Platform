/* ==========================================================================
   equipment/pages/wavesPage.js — the internal inspection wave log.

   Two routes, one page:

     #/equipment/waves        every wave across the fleet
     #/equipment/waves/:id    the same view scoped to one item

   The fleet-wide form is the reason this page exists. When only admins recorded
   waves, the person who typed one already knew what it said. Officers file from
   towers now, and without a review queue a failed inspection recorded this
   morning is invisible until somebody happens to open that item. This is where
   an admin sees what came in — and where "an officer cannot correct a submitted
   wave, an admin does it for them" actually gets done.

   Filtering and paging are the server's (`list_inspection_waves`), like every
   other list in the platform. The rule against unpaginated lists applies here
   more than most: the log only ever grows.
   ========================================================================== */

import { UI } from '../../../state.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { t, getLanguage } from '../../../i18n/i18n.js';
import { escapeHtml, fmtDate, EMPTY_MARK } from '../../../utils/format.js';
import { canEdit } from '../../../utils/permissions.js';
import { MODULE_NAMES } from '../../../constants/globals.js';
import { statusBadge } from '../../../components/badge.js';
import { toast, toastSuccess, toastError } from '../../../components/toast.js';
import { exportToExcel, exportBlockReason } from '../../../utils/exportHelpers.js';
import { listInspectionWaves } from '../dataActions.js';
import {
  openCorrectWaveDialog, openVoidWaveDialog,
  openApproveWaveDialog, openRejectWaveDialog,
} from '../waveDialog.js';
import {
  WAVE_RESULTS, WAVE_RESULT_LABEL_KEYS, WAVE_ORIGIN_LABEL_KEYS, WAVE_PAGE_SIZE,
  WAVE_APPROVAL_LABEL_KEYS, WAVE_SLOTS, WAVE_SLOT_OFF_CYCLE,
} from '../constants.js';
import { waveApprovalBadge } from '../waveBadge.js';
import { invalidateEquipmentList } from './listPage.js';
import { invalidateEquipmentDetail } from './detailPage.js';

/** How many months the filter offers, counting back from this one. */
const MONTH_CHOICES = 18;

function pageState() {
  if (!UI.equipmentWaves) {
    UI.equipmentWaves = {
      equipmentId: '',   // set from the route; '' is the fleet-wide view
      month: '',
      result: '',
      origin: '',
      approval: '',
      waveNo: '',
      includeVoided: false,
      page: 1,

      status: 'idle',
      queryKey: null,
      seq: 0,
      data: null,
      error: null,
      busy: false,
      exporting: false,
    };
  }
  return UI.equipmentWaves;
}

/** Every filter is applied server-side, so all of them belong in the key. */
function queryKey(s) {
  return [
    s.equipmentId, s.month, s.result, s.origin, s.approval, s.waveNo,
    s.includeVoided, s.page,
  ].join(' ');
}

/* ---------- Data ---------------------------------------------------------- */

function filterParams(s) {
  const params = {};
  if (s.equipmentId) params.equipment_id = s.equipmentId;
  if (s.month) params.month = s.month;
  if (s.result) params.result = s.result;
  if (s.origin) params.origin = s.origin;
  if (s.approval) params.approval_status = s.approval;
  if (s.waveNo) params.wave_no = s.waveNo;
  if (s.includeVoided) params.include_voided = true;
  return params;
}

async function ensureData() {
  const s = pageState();
  const key = queryKey(s);

  if (s.status === 'loading') return;
  if (s.status !== 'idle' && s.queryKey === key) return;

  // A stale response from a filter the admin has already moved off must not
  // overwrite a newer one — the same guard the RDT history page uses.
  const mySeq = ++s.seq;
  s.status = 'loading';
  s.queryKey = key;
  s.error = null;
  render();

  try {
    const data = await listInspectionWaves({
      ...filterParams(s),
      page: s.page,
      page_size: WAVE_PAGE_SIZE,
    });
    if (mySeq !== s.seq) return;

    s.data = data;
    s.status = 'ready';
  } catch (err) {
    if (mySeq !== s.seq) return;

    s.status = 'error';
    s.error = err;
    console.error('[equipment] list_inspection_waves failed:', err);
    toastError(err);
  }

  render();
}

/* ---------- Rendering ----------------------------------------------------- */

/** The last MONTH_CHOICES months as 'YYYY-MM', newest first. */
function recentMonths() {
  const months = [];
  const now = new Date();

  for (let i = 0; i < MONTH_CHOICES; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/** 'YYYY-MM' → "August 2026" in the active language. */
function monthOptionLabel(ym) {
  const [year, month] = ym.split('-').map(Number);
  const locale = getLanguage() === 'ar' ? 'ar-EG' : 'en-GB';

  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1));
}

function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${
    value === selected ? ' selected' : ''
  }>${escapeHtml(label)}</option>`;
}

function renderFilters(s) {
  return `
    <div class="filter-bar">
      <div class="field">
        <label for="wv-month">${escapeHtml(t('eqp_wave_filter_month'))}</label>
        <select id="wv-month" data-filter="month">
          ${option('', t('filter_all'), s.month)}
          ${recentMonths().map((m) => option(m, monthOptionLabel(m), s.month)).join('')}
        </select>
      </div>

      <div class="field">
        <label for="wv-result">${escapeHtml(t('eqp_col_result'))}</label>
        <select id="wv-result" data-filter="result">
          ${option('', t('filter_all'), s.result)}
          ${WAVE_RESULTS.map((v) => option(v, t(WAVE_RESULT_LABEL_KEYS[v]), s.result)).join('')}
        </select>
      </div>

      <div class="field">
        <label for="wv-origin">${escapeHtml(t('eqp_wave_filter_origin'))}</label>
        <select id="wv-origin" data-filter="origin">
          ${option('', t('filter_all'), s.origin)}
          ${Object.keys(WAVE_ORIGIN_LABEL_KEYS)
            .map((v) => option(v, t(WAVE_ORIGIN_LABEL_KEYS[v]), s.origin)).join('')}
        </select>
      </div>

      <div class="field">
        <label for="wv-approval">${escapeHtml(t('eqp_wave_filter_status'))}</label>
        <select id="wv-approval" data-filter="approval">
          ${option('', t('filter_all'), s.approval)}
          ${Object.keys(WAVE_APPROVAL_LABEL_KEYS)
            .map((v) => option(v, t(WAVE_APPROVAL_LABEL_KEYS[v]), s.approval)).join('')}
        </select>
      </div>

      <div class="field">
        <label for="wv-slot">${escapeHtml(t('eqp_col_wave'))}</label>
        <select id="wv-slot" data-filter="waveNo">
          ${option('', t('filter_all'), s.waveNo)}
          ${WAVE_SLOTS.map((v) => option(v, t('eqp_wave_n', { wave: v }), s.waveNo)).join('')}
          ${option(WAVE_SLOT_OFF_CYCLE, t('eqp_wave_off_cycle'), s.waveNo)}
        </select>
      </div>

      <div class="field">
        <label for="wv-voided">
          <input id="wv-voided" type="checkbox" data-filter-check="includeVoided"
                 ${s.includeVoided ? 'checked' : ''}>
          ${escapeHtml(t('eqp_wave_show_voided'))}
        </label>
      </div>

      <div class="count">${escapeHtml(t('eqp_wave_n_entries', { count: s.data.total_matching }))}</div>

      <button type="button" class="btn btn-ghost btn-sm" data-action="export"
              ${s.exporting ? 'disabled' : ''}>${
        escapeHtml(t(s.exporting ? 'export_preparing' : 'eqp_wave_export'))
      }</button>
    </div>`;
}

function renderRow(wave, editable, scoped) {
  const labelKey = WAVE_RESULT_LABEL_KEYS[wave.result];
  const originKey = WAVE_ORIGIN_LABEL_KEYS[wave.origin];
  const itemLabel = [wave.item, wave.brand].filter(Boolean).join(' · ');

  // Wave 0 is an inspection recorded in Q4, the third-party quarter. It counts
  // toward the verdict like any other but fills no slot, so it is labelled
  // rather than numbered.
  const slotLabel = String(wave.wave_no) === WAVE_SLOT_OFF_CYCLE
    ? t('eqp_wave_off_cycle')
    : t('eqp_wave_n', { wave: wave.wave_no });

  const reviewable = editable && !wave.voided && wave.approval_status === 'pending';

  return `
    <tr class="${wave.voided || wave.approval_status === 'rejected' ? 'row-voided' : ''}">
      <td>${escapeHtml(fmtDate(wave.wave_date))}</td>

      ${scoped ? '' : `
        <td>
          <b><a class="link-plain" data-equipment-id="${escapeHtml(wave.equipment_id)}">${
            escapeHtml(itemLabel || wave.equipment_id)
          }</a></b>
          <div class="cell-sub">${escapeHtml(wave.serial_no || wave.equipment_id)}</div>
        </td>`}

      <td>
        ${escapeHtml(slotLabel)}
        ${wave.fiscal_year ? `<div class="cell-sub">${escapeHtml(wave.fiscal_year)}</div>` : ''}
      </td>

      <td>${labelKey
        ? statusBadge(t(labelKey), wave.result === 'pass')
        : `<span class="cell-sub">${escapeHtml(t('eqp_wave_pending'))}</span>`}</td>

      <td>${waveApprovalBadge(wave)}</td>

      <td class="rdt-notes-cell">
        ${escapeHtml(wave.comments || '')}
        ${wave.voided
          ? `<div class="cell-sub">${escapeHtml(t('eqp_wave_voided_note', { reason: wave.void_reason }))}</div>`
          : ''}
      </td>

      <td class="cell-sub">
        ${escapeHtml(wave.recorded_by_name || EMPTY_MARK)}
        ${originKey ? `<div class="cell-sub">${escapeHtml(t(originKey))}</div>` : ''}
      </td>

      ${editable ? `
        <td class="cell-actions">
          ${reviewable ? `
            <button type="button" class="btn btn-primary btn-sm" data-action="approve-wave"
                    data-wave-id="${escapeHtml(wave.wave_id)}">${escapeHtml(t('eqp_wave_approve'))}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="reject-wave"
                    data-wave-id="${escapeHtml(wave.wave_id)}">${escapeHtml(t('eqp_wave_reject'))}</button>` : ''}
          ${wave.voided ? '' : `
            <button type="button" class="btn btn-ghost btn-sm" data-action="correct-wave"
                    data-wave-id="${escapeHtml(wave.wave_id)}">${escapeHtml(t('eqp_wave_correct'))}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="void-wave"
                    data-wave-id="${escapeHtml(wave.wave_id)}">${escapeHtml(t('eqp_wave_void'))}</button>`}
        </td>` : ''}
    </tr>`;
}

/**
 * @param {Object} params route params — {id} on the scoped route, empty on the
 *        fleet-wide one
 * @returns {string} HTML
 */
export function renderEquipmentWavesPage(params) {
  const s = pageState();
  const scoped = !!(params && params.id);

  const head = `
    <div class="page-head">
      <div>
        <div class="page-head-title">${escapeHtml(t('eqp_waves_title'))}</div>
        <div class="page-head-sub">${escapeHtml(
          scoped ? t('eqp_waves_sub_item', { id: params.id }) : t('eqp_waves_sub')
        )}</div>
      </div>
      <button type="button" class="btn btn-ghost" data-action="back">${escapeHtml(t('back'))}</button>
    </div>`;

  if (s.status !== 'ready') {
    return `
      <div class="equipment-waves">
        ${head}
        <div class="cell-empty">${
          escapeHtml(t(s.status === 'error' ? 'err_server_error' : 'loading_data'))
        }</div>
      </div>`;
  }

  const editable = canEdit(MODULE_NAMES.EQUIPMENT);
  const pages = Math.max(1, Math.ceil(s.data.total_matching / s.data.page_size));
  const columns = 6 + (scoped ? 0 : 1) + (editable ? 1 : 0);

  return `
    <div class="equipment-waves">
      ${head}
      ${renderFilters(s)}

      <table class="tbl">
        <thead>
          <tr>
            <th>${escapeHtml(t('eqp_col_date'))}</th>
            ${scoped ? '' : `<th>${escapeHtml(t('eqp_col_item'))}</th>`}
            <th>${escapeHtml(t('eqp_col_wave'))}</th>
            <th>${escapeHtml(t('eqp_col_result'))}</th>
            <th>${escapeHtml(t('eqp_col_status'))}</th>
            <th>${escapeHtml(t('eqp_col_comments'))}</th>
            <th>${escapeHtml(t('eqp_col_recorded_by'))}</th>
            ${editable ? '<th></th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${s.data.waves.length
            ? s.data.waves.map((wave) => renderRow(wave, editable, scoped)).join('')
            : `<tr><td colspan="${columns}" class="cell-empty">${
                escapeHtml(t('eqp_waves_empty'))
              }</td></tr>`}
        </tbody>
      </table>

      ${pages > 1 ? `
        <div class="pager">
          <button type="button" class="btn btn-ghost btn-sm" data-page="prev"
                  ${s.data.page <= 1 ? 'disabled' : ''}>${escapeHtml(t('prev_page'))}</button>
          <span class="pager-label">${
            escapeHtml(t('page_x_of_y', { page: s.data.page, pages }))
          }</span>
          <button type="button" class="btn btn-ghost btn-sm" data-page="next"
                  ${s.data.page >= pages ? 'disabled' : ''}>${escapeHtml(t('next_page'))}</button>
        </div>` : ''}
    </div>`;
}

/* ---------- Export -------------------------------------------------------- */

/** Every row matching the current filters — the view, not the page on screen. */
async function fetchAllFiltered(s) {
  const waves = [];
  let page = 1;

  for (;;) {
    const data = await listInspectionWaves({ ...filterParams(s), page, page_size: 500 });
    waves.push(...data.waves);

    if (waves.length >= data.total_matching || data.waves.length === 0) break;
    if (page >= 20) break;   // circuit breaker, same reasoning as listAllEquipment
    page += 1;
  }
  return waves;
}

async function exportWaves() {
  const s = pageState();
  if (s.exporting) return;

  s.exporting = true;
  render();

  try {
    const waves = await fetchAllFiltered(s);

    const blocked = exportBlockReason('excel', waves.length);
    if (blocked) {
      toast(blocked, 'error');
      return;
    }

    exportToExcel(waves, {
      sheetName: 'InspectionWaves',
      filePrefix: 'Inspection-waves',
    });
  } catch (err) {
    console.error('[equipment] wave export failed:', err);
    toastError(err);
  } finally {
    s.exporting = false;
    render();
  }
}

/* ---------- Wave actions -------------------------------------------------- */

async function runWaveDialog(open) {
  const s = pageState();
  if (s.busy) return;

  s.busy = true;
  try {
    const saved = await open();
    if (!saved) return;

    toastSuccess(t('eqp_wave_saved'));

    // A correction or a void can flip the item's verdict, so anything showing
    // that verdict has to forget what it cached.
    invalidateEquipmentList();
    invalidateEquipmentDetail();
    s.status = 'idle';
  } catch (err) {
    console.error('[equipment] wave write failed:', err);
    toastError(err);
  } finally {
    s.busy = false;
    render();
  }
}

function findWave(waveId) {
  const s = pageState();
  const waves = (s.data && s.data.waves) || [];
  return waves.find((wave) => wave.wave_id === waveId) || null;
}

/* ---------- Events -------------------------------------------------------- */

/**
 * @param {Object} params route params, {id} on the scoped route
 */
export function bindEquipmentWavesPageEvents(params) {
  const root = document.querySelector('.equipment-waves');
  if (!root) return;

  const s = pageState();
  const scopeId = (params && params.id) || '';

  // Arriving on a different scope than last time is a different query. Reset the
  // filters with it: an origin filter left over from the fleet-wide view would
  // silently hide rows on an item the admin just opened.
  if (s.equipmentId !== scopeId) {
    s.equipmentId = scopeId;
    s.month = '';
    s.result = '';
    s.origin = '';
    s.approval = '';
    s.waveNo = '';
    s.includeVoided = false;
    s.page = 1;
    s.status = 'idle';
  }

  ensureData();

  root.querySelectorAll('[data-filter]').forEach((select) => {
    select.addEventListener('change', () => {
      s[select.dataset.filter] = select.value;
      s.page = 1;
      s.status = 'idle';
      render();
    });
  });

  root.querySelectorAll('[data-filter-check]').forEach((box) => {
    box.addEventListener('change', () => {
      s[box.dataset.filterCheck] = box.checked;
      s.page = 1;
      s.status = 'idle';
      render();
    });
  });

  root.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      s.page += btn.dataset.page === 'next' ? 1 : -1;
      if (s.page < 1) s.page = 1;
      s.status = 'idle';
      render();
    });
  });

  root.querySelectorAll('[data-equipment-id]').forEach((link) => {
    link.addEventListener('click', () => go('equipment/:id', { id: link.dataset.equipmentId }));
  });

  root.querySelectorAll('[data-action="correct-wave"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wave = findWave(btn.dataset.waveId);
      if (wave) runWaveDialog(() => openCorrectWaveDialog(wave));
    });
  });

  root.querySelectorAll('[data-action="void-wave"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wave = findWave(btn.dataset.waveId);
      if (wave) runWaveDialog(() => openVoidWaveDialog(wave));
    });
  });

  root.querySelectorAll('[data-action="approve-wave"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wave = findWave(btn.dataset.waveId);
      if (wave) runWaveDialog(() => openApproveWaveDialog(wave));
    });
  });

  root.querySelectorAll('[data-action="reject-wave"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wave = findWave(btn.dataset.waveId);
      if (wave) runWaveDialog(() => openRejectWaveDialog(wave));
    });
  });

  const back = root.querySelector('[data-action="back"]');
  if (back) {
    back.addEventListener('click', () => (
      scopeId ? go('equipment/:id', { id: scopeId }) : go('equipment')
    ));
  }

  const exportBtn = root.querySelector('[data-action="export"]');
  if (exportBtn) exportBtn.addEventListener('click', exportWaves);
}

/** Drop the cached log — called after a wave is written anywhere else. */
export function invalidateEquipmentWaves() {
  const s = pageState();
  s.status = 'idle';
  s.data = null;
}
