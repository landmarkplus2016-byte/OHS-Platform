/* ==========================================================================
   equipment/pages/rejectedPage.js — rejected equipment.

   Read-only by design. Nothing is ever deleted (rule 6): rejecting an item
   flips `rejected`, and the record, its serial numbers and its inspection
   history stay forever. The only action here is putting an item back in
   service.

   ONE COMPROMISE WORTH KNOWING
   ---------------------------
   `list_equipment` offers `include_rejected` — "and rejected", not "rejected
   only" (Section 3.6). So this page asks for everything and keeps the rejected
   rows, which means it over-fetches by roughly the size of the active
   inventory.

   That is acceptable at Landmark's scale and it is honest about the API we
   have; the alternative is a new server-side filter, which is a spec change
   that goes through Khaled. Search and paging are applied here for the same
   reason — the server cannot page a set it does not know we are narrowing.
   ========================================================================== */

import { UI } from '../../../state.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { t } from '../../../i18n/i18n.js';
import { escapeHtml, fmtDate, EMPTY_MARK } from '../../../utils/format.js';
import { canEdit } from '../../../utils/permissions.js';
import { MODULE_NAMES } from '../../../constants/globals.js';
import { toast, toastSuccess, toastError } from '../../../components/toast.js';
import { confirmDialog } from '../../../components/modal.js';
import { listAllEquipment, unrejectEquipment } from '../dataActions.js';
import { invalidateEquipmentList } from './listPage.js';
import { BULK_PAGE_SIZE, MAX_PAGE_WALK, PAGE_SIZE } from '../constants.js';

/** How long after the last keystroke the search applies. */
const SEARCH_DEBOUNCE_MS = 300;

let searchTimer = null;

function pageState() {
  if (!UI.equipmentRejected) {
    UI.equipmentRejected = {
      search: '',
      page: 1,

      status: 'idle',
      seq: 0,
      equipment: [],
      error: null,
      busy: false,
    };
  }
  return UI.equipmentRejected;
}

/* ---------- Data ---------------------------------------------------------- */

async function ensureData() {
  const s = pageState();
  if (s.status === 'loading' || s.status === 'ready' || s.status === 'error') return;

  const mySeq = ++s.seq;
  s.status = 'loading';
  s.error = null;
  render();

  try {
    const result = await listAllEquipment(
      { include_rejected: true },
      { pageSize: BULK_PAGE_SIZE, maxPages: MAX_PAGE_WALK }
    );

    if (mySeq !== s.seq) return;

    s.equipment = result.equipment.filter((item) => item.rejected);
    s.status = 'ready';
  } catch (err) {
    if (mySeq !== s.seq) return;

    s.status = 'error';
    s.error = err;
    console.error('[equipment] rejected load failed:', err);
    toastError(err);
  }

  render();
}

/** The rejected rows matching the search box — same fields the server searches. */
function visibleRows(s) {
  const query = s.search.trim().toLowerCase();
  if (!query) return s.equipment;

  return s.equipment.filter((item) =>
    String(item.serial_no || '').toLowerCase().includes(query)
    || String(item.third_party_sn || '').toLowerCase().includes(query)
    || String(item.item || '').toLowerCase().includes(query));
}

/* ---------- Rendering ----------------------------------------------------- */

function renderRow(item, editable) {
  return `
    <tr class="row-clickable" data-equipment-id="${escapeHtml(item.equipment_id)}">
      <td>
        <b>${escapeHtml(item.item || EMPTY_MARK)}</b>
        <div class="cell-sub">${escapeHtml(item.brand || EMPTY_MARK)} · ${escapeHtml(item.equipment_id)}</div>
      </td>
      <td class="cell-mono">${escapeHtml(item.serial_no)}</td>
      <td class="cell-mono">${escapeHtml(item.third_party_sn)}</td>
      <td>${escapeHtml(fmtDate(item.rejection_date))}</td>
      <td>${escapeHtml(item.rejection_reason || EMPTY_MARK)}</td>
      <td data-stop-row-click>
        <button type="button" class="btn btn-ghost btn-sm" data-action="view"
                data-equipment-id="${escapeHtml(item.equipment_id)}">${escapeHtml(t('view'))}</button>
        ${editable ? `
          <button type="button" class="btn btn-ghost btn-sm" data-action="unreject"
                  data-equipment-id="${escapeHtml(item.equipment_id)}"
                  data-equipment-label="${escapeHtml((item.item || item.equipment_id) + ' · ' + item.serial_no)}">
            ${escapeHtml(t('eqp_unreject'))}
          </button>` : ''}
      </td>
    </tr>`;
}

export function renderRejectedEquipmentPage() {
  const s = pageState();
  const editable = canEdit(MODULE_NAMES.EQUIPMENT);

  const head = `
    <div class="page-head">
      <div>
        <div class="page-head-sub">${escapeHtml(t('eqp_rejected_intro'))}</div>
      </div>
    </div>`;

  if (s.status !== 'ready') {
    return `
      <div class="equipment-rejected">
        ${head}
        <div class="cell-empty">${escapeHtml(t(s.status === 'error' ? 'err_server_error' : 'loading_data'))}</div>
      </div>`;
  }

  const rows = visibleRows(s);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(s.page, pages);
  const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return `
    <div class="equipment-rejected">
      ${head}

      <div class="filter-bar">
        <div class="field filter-search">
          <label for="eqp-rejected-search">${escapeHtml(t('search'))}</label>
          <input id="eqp-rejected-search" type="search" autocomplete="off" spellcheck="false"
                 placeholder="${escapeHtml(t('eqp_search_placeholder'))}"
                 value="${escapeHtml(s.search)}">
        </div>
        <div class="count">${escapeHtml(t('eqp_rejected_count', { count: rows.length }))}</div>
      </div>

      <table class="tbl">
        <thead>
          <tr>
            <th>${escapeHtml(t('eqp_col_item'))}</th>
            <th>${escapeHtml(t('eqp_col_serial'))}</th>
            <th>${escapeHtml(t('eqp_col_third_party_sn'))}</th>
            <th>${escapeHtml(t('eqp_col_rejected_on'))}</th>
            <th>${escapeHtml(t('eqp_col_rejection_reason'))}</th>
            <th>${escapeHtml(t('actions'))}</th>
          </tr>
        </thead>
        <tbody>
          ${slice.length
            ? slice.map((item) => renderRow(item, editable)).join('')
            : `<tr><td colspan="6" class="cell-empty">${escapeHtml(t(s.search ? 'no_results' : 'eqp_rejected_none'))}</td></tr>`}
        </tbody>
      </table>

      ${pages > 1 ? `
        <div class="pager">
          <button type="button" class="btn btn-ghost btn-sm" data-page="prev" ${page <= 1 ? 'disabled' : ''}>
            ${escapeHtml(t('prev_page'))}
          </button>
          <span class="pager-label">${escapeHtml(t('page_x_of_y', { page, pages }))}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-page="next" ${page >= pages ? 'disabled' : ''}>
            ${escapeHtml(t('next_page'))}
          </button>
        </div>` : ''}
    </div>`;
}

/* ---------- Unreject ------------------------------------------------------ */

async function doUnreject(equipmentId, label) {
  const s = pageState();
  if (s.busy) return;

  const answer = await confirmDialog({
    title: t('eqp_unreject_title'),
    message: `${label} — ${t('eqp_unreject_message')}`,
    confirmLabel: t('eqp_unreject'),
  });
  if (!answer) return;

  s.busy = true;
  try {
    await unrejectEquipment(equipmentId);
    toastSuccess(t('eqp_unrejected_ok'));

    s.status = 'idle';           // this row belongs on the active list now
    invalidateEquipmentList();
  } catch (err) {
    console.error('[equipment] unreject failed:', err);

    // The one conflict this action produces is worth naming: another active
    // item took one of these serial numbers while this one sat rejected
    // (Section 3.6).
    if (err && err.code === 'conflict') toast(t('eqp_serial_taken'), 'error');
    else toastError(err);
  } finally {
    s.busy = false;
    render();
  }
}

/* ---------- Events -------------------------------------------------------- */

export function bindRejectedEquipmentPageEvents() {
  const root = document.querySelector('.equipment-rejected');
  if (!root) return;

  const s = pageState();
  ensureData();

  /* Same rule as the active list (Section 9.3): typing does not redraw, and the
     debounced redraw that follows has its caret restored by render.js. */
  const searchInput = root.querySelector('#eqp-rejected-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      s.search = searchInput.value;

      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        s.page = 1;
        render();
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  root.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      s.page += btn.dataset.page === 'next' ? 1 : -1;
      if (s.page < 1) s.page = 1;
      render();
    });
  });

  root.querySelectorAll('tr.row-clickable').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-stop-row-click]')) return;
      go('equipment/:id', { id: row.dataset.equipmentId });
    });
  });

  root.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', () => go('equipment/:id', { id: btn.dataset.equipmentId }));
  });

  root.querySelectorAll('[data-action="unreject"]').forEach((btn) => {
    btn.addEventListener('click', () => doUnreject(btn.dataset.equipmentId, btn.dataset.equipmentLabel));
  });
}

/** Called after any write that changes what belongs on this list. */
export function invalidateRejectedEquipment() {
  delete UI.equipmentRejected;
}
