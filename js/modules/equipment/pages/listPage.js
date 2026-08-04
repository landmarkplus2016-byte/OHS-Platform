/* ==========================================================================
   equipment/pages/listPage.js — the Active Equipment list.

   Filtering, searching and paging all happen server-side (Section 3.6) — this
   page sends `list_equipment` a query and renders what comes back. The verdict
   and the third-party inspection state come pre-derived in each row's `derived`
   block; nothing here computes one (rule: the server derives, the frontend
   displays).

   The team leader arrives joined onto every row — `team_leader_name` and
   `team_leader_archived` — so drawing the list costs exactly one request
   (Section 3.6).

   THE FOCUS RULE (Section 9.3)
   ---------------------------
   The search box drives a live filter, and every re-render replaces #app
   wholesale. Two things stop that from eating the caret:

     1. Typing does NOT redraw. It updates state and starts a 300ms debounce;
        only when that fires does the page refetch and redraw.
     2. When the redraw does happen, render.js snapshots the focused element's
        id plus its selection range and restores both afterwards. This page opts
        in by giving the input a stable id (`eqp-search`).
   ========================================================================== */

import { UI } from '../../../state.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { t } from '../../../i18n/i18n.js';
import { escapeHtml, fmtDate, fmtDateTime, EMPTY_MARK } from '../../../utils/format.js';
import { canEdit } from '../../../utils/permissions.js';
import { certStateBadge, verdictBadge } from '../../../components/badge.js';
import { toastError } from '../../../components/toast.js';
import { MODULE_NAMES } from '../../../constants/globals.js';
import { listEquipment, loadFieldOptions } from '../dataActions.js';
import { VERDICTS, PAGE_SIZE, listKeyFor } from '../constants.js';

/** How long after the last keystroke the search fires. */
const SEARCH_DEBOUNCE_MS = 300;

/** Debounce timer, module-scoped so a redraw cannot orphan it. */
let searchTimer = null;

/**
 * Page state, parked on UI so it survives a redraw and is wiped by
 * clearSession() on sign-out.
 */
function pageState() {
  if (!UI.equipmentList) {
    UI.equipmentList = {
      search: '',
      verdict: '',
      item: '',
      brand: '',
      page: 1,

      status: 'idle',   // idle → loading → ready | error
      queryKey: null,   // the query `data` belongs to
      seq: 0,           // guards against an older fetch landing last
      data: null,
      options: null,
      error: null,
    };
  }
  return UI.equipmentList;
}

/** Identifies a query, so we can tell whether the data in hand still answers it. */
function queryKey(s) {
  return [s.search, s.verdict, s.item, s.brand, s.page].join(' ');
}

/** Marks the current data stale and redraws; bind() then refetches. */
function invalidate(s) {
  s.status = 'idle';
  render();
}

/* ---------- Data ---------------------------------------------------------- */

/**
 * Fetch the current query if we do not already have its answer.
 *
 * Called from bind on every draw, so it must be cheap and idempotent when the
 * data is already good — hence the queryKey check.
 */
async function ensureData() {
  const s = pageState();
  const key = queryKey(s);

  if (s.status === 'loading') return;
  if (s.status === 'ready' && s.queryKey === key) return;
  if (s.status === 'error' && s.queryKey === key) return;

  const mySeq = ++s.seq;
  s.status = 'loading';
  s.queryKey = key;
  s.error = null;
  render();

  const filters = {};
  // The server names this filter `worst_state` (Section 3.6); the value it
  // matches is a verdict. See constants.js.
  if (s.verdict) filters.worst_state = s.verdict;
  if (s.item) filters.item = s.item;
  if (s.brand) filters.brand = s.brand;

  try {
    const [data, options] = await Promise.all([
      listEquipment({
        include_rejected: false,
        search: s.search || undefined,
        filters,
        page: s.page,
        page_size: PAGE_SIZE,
      }),
      loadFieldOptions(),
    ]);

    // A faster-typing user may already have fired a newer query; if so this
    // answer is stale and applying it would rewind the page under them.
    if (mySeq !== s.seq) return;

    s.data = data;
    s.options = options;
    s.status = 'ready';
  } catch (err) {
    if (mySeq !== s.seq) return;

    s.status = 'error';
    s.error = err;
    console.error('[equipment] list failed:', err);
    toastError(err);
  }

  render();
}

/* ---------- Rendering ----------------------------------------------------- */

/** One <option>, marked selected when it matches. */
function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

/** Options for a FieldOptions-backed filter, plus the "All" entry. */
function listOptions(options, listKey, selected) {
  const list = (options && options[listKey]) || [];

  // Inactive options still appear when one is currently selected: a filter that
  // silently drops the value it is filtering by would show the wrong rows.
  const visible = list.filter((o) => o.active || o.option_value === selected);

  return option('', t('filter_all'), selected)
    + visible.map((o) => option(o.option_value, o.option_value, selected)).join('');
}

/** The filter bar. The search input carries the id render.js restores focus to. */
function renderFilters(s) {
  const total = s.data ? s.data.total_matching : 0;
  const shown = s.data ? s.data.equipment.length : 0;

  return `
    <div class="filter-bar">
      <div class="field filter-search">
        <label for="eqp-search">${escapeHtml(t('search'))}</label>
        <input id="eqp-search" type="search" autocomplete="off" spellcheck="false"
               placeholder="${escapeHtml(t('eqp_search_placeholder'))}"
               value="${escapeHtml(s.search)}">
      </div>

      <div class="field">
        <label for="eqp-filter-verdict">${escapeHtml(t('eqp_filter_verdict'))}</label>
        <select id="eqp-filter-verdict" data-filter="verdict">
          ${option('', t('filter_all'), s.verdict)}
          ${VERDICTS.map((v) => option(v, t('verdict_' + v), s.verdict)).join('')}
        </select>
      </div>

      <div class="field">
        <label for="eqp-filter-item">${escapeHtml(t('eqp_filter_item'))}</label>
        <select id="eqp-filter-item" data-filter="item">
          ${listOptions(s.options, listKeyFor('item'), s.item)}
        </select>
      </div>

      <div class="field">
        <label for="eqp-filter-brand">${escapeHtml(t('eqp_filter_brand'))}</label>
        <select id="eqp-filter-brand" data-filter="brand">
          ${listOptions(s.options, listKeyFor('brand'), s.brand)}
        </select>
      </div>

      <div class="count">${escapeHtml(t('showing_count', { shown, total }))}</div>
    </div>`;
}

/**
 * The team leader cell. An archived owner is a non-blocking warning
 * (Section 6.3), so it is called out here rather than hidden.
 */
function teamLeaderCell(item) {
  if (!item.team_leader_id) {
    return `<span class="cell-sub">${escapeHtml(t('eqp_unassigned'))}</span>`;
  }

  return `
    ${escapeHtml(item.team_leader_name || item.team_leader_id)}
    ${item.team_leader_archived
      ? `<div class="cell-danger">${escapeHtml(t('eqp_owner_archived'))}</div>`
      : `<div class="cell-sub">${escapeHtml(item.team_leader_id)}</div>`}`;
}

/** One equipment row. */
function renderRow(item, editable) {
  const derived = item.derived || {};

  return `
    <tr class="row-clickable" data-equipment-id="${escapeHtml(item.equipment_id)}">
      <td>
        <b>${escapeHtml(item.item || EMPTY_MARK)}</b>
        <div class="cell-sub">${escapeHtml(item.brand || EMPTY_MARK)} · ${escapeHtml(item.equipment_id)}</div>
      </td>
      <td class="cell-mono">${escapeHtml(item.serial_no)}</td>
      <td class="cell-mono">${escapeHtml(item.third_party_sn)}</td>
      <td>${teamLeaderCell(item)}</td>
      <td>
        ${escapeHtml(fmtDate(item.third_party_inspection_end_date))}
        <div>${certStateBadge(derived.third_party_state)}</div>
      </td>
      <td>${verdictBadge(derived.verdict)}</td>
      <td>${escapeHtml(fmtDateTime(item.updated_at))}</td>
      <td data-stop-row-click>
        <button type="button" class="btn btn-ghost btn-sm"
                data-action="view" data-equipment-id="${escapeHtml(item.equipment_id)}">${escapeHtml(t('view'))}</button>
        ${editable ? `
          <button type="button" class="btn btn-ghost btn-sm"
                  data-action="edit" data-equipment-id="${escapeHtml(item.equipment_id)}">${escapeHtml(t('edit'))}</button>` : ''}
      </td>
    </tr>`;
}

/** The results table, or the state standing in for it. */
function renderTable(s, editable) {
  const columnCount = 8;

  const header = `
    <thead>
      <tr>
        <th>${escapeHtml(t('eqp_col_item'))}</th>
        <th>${escapeHtml(t('eqp_col_serial'))}</th>
        <th>${escapeHtml(t('eqp_col_third_party_sn'))}</th>
        <th>${escapeHtml(t('eqp_col_team_leader'))}</th>
        <th>${escapeHtml(t('eqp_col_inspection'))}</th>
        <th>${escapeHtml(t('eqp_col_verdict'))}</th>
        <th>${escapeHtml(t('eqp_col_updated'))}</th>
        <th>${escapeHtml(t('actions'))}</th>
      </tr>
    </thead>`;

  if (s.status === 'loading' || s.status === 'idle') {
    return `<table class="tbl">${header}
      <tbody><tr><td colspan="${columnCount}" class="cell-empty">${escapeHtml(t('loading_data'))}</td></tr></tbody>
    </table>`;
  }

  if (s.status === 'error') {
    return `<table class="tbl">${header}
      <tbody><tr><td colspan="${columnCount}" class="cell-empty">
        ${escapeHtml(t('err_' + ((s.error && s.error.code) || 'server_error')))}
        <button type="button" class="btn btn-ghost btn-sm" data-action="retry">${escapeHtml(t('retry'))}</button>
      </td></tr></tbody>
    </table>`;
  }

  const rows = s.data.equipment;
  if (rows.length === 0) {
    const hasFilters = s.search || s.verdict || s.item || s.brand;
    return `<table class="tbl">${header}
      <tbody><tr><td colspan="${columnCount}" class="cell-empty">
        ${escapeHtml(t(hasFilters ? 'no_results' : 'eqp_none_yet'))}
      </td></tr></tbody>
    </table>`;
  }

  return `<table class="tbl">${header}
    <tbody>${rows.map((item) => renderRow(item, editable)).join('')}</tbody>
  </table>`;
}

/** Prev/next, hidden when everything fits on one page. */
function renderPager(s) {
  if (s.status !== 'ready') return '';

  const pages = Math.max(1, Math.ceil(s.data.total_matching / s.data.page_size));
  if (pages <= 1) return '';

  return `
    <div class="pager">
      <button type="button" class="btn btn-ghost btn-sm" data-page="prev"
              ${s.page <= 1 ? 'disabled' : ''}>${escapeHtml(t('prev_page'))}</button>
      <span class="pager-label">${escapeHtml(t('page_x_of_y', { page: s.page, pages }))}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-page="next"
              ${s.page >= pages ? 'disabled' : ''}>${escapeHtml(t('next_page'))}</button>
    </div>`;
}

/**
 * @returns {string} HTML
 */
export function renderEquipmentListPage() {
  const s = pageState();
  const editable = canEdit(MODULE_NAMES.EQUIPMENT);

  return `
    <div class="equipment-list">
      <div class="page-head">
        <div class="page-head-title">${escapeHtml(t('nav_equipment_active'))}</div>
        ${editable ? `
          <button type="button" class="btn btn-primary btn-sm" data-action="add">${escapeHtml(t('eqp_add'))}</button>` : ''}
      </div>

      ${renderFilters(s)}
      ${renderTable(s, editable)}
      ${renderPager(s)}
    </div>`;
}

/* ---------- Events -------------------------------------------------------- */

export function bindEquipmentListPageEvents() {
  const root = document.querySelector('.equipment-list');
  if (!root) return;

  const s = pageState();

  // Kick off the fetch for whatever query the state currently describes. Safe
  // to call on every draw — it returns immediately when the data already
  // answers the query.
  ensureData();

  /* --- Search: debounce, then refetch --------------------------------------
     No render() on keystroke, so the input the user is typing in is never
     rebuilt mid-word. When the debounce does fire and the page redraws,
     render.js puts focus and the caret back (see the header comment). */
  const searchInput = root.querySelector('#eqp-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      s.search = searchInput.value;

      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        s.page = 1;
        invalidate(s);
      }, SEARCH_DEBOUNCE_MS);
    });

    // Enter skips the wait.
    searchInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      clearTimeout(searchTimer);
      s.page = 1;
      invalidate(s);
    });
  }

  root.querySelectorAll('[data-filter]').forEach((select) => {
    select.addEventListener('change', () => {
      s[select.dataset.filter] = select.value;
      s.page = 1;
      invalidate(s);
    });
  });

  root.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      s.page += btn.dataset.page === 'next' ? 1 : -1;
      if (s.page < 1) s.page = 1;
      invalidate(s);
    });
  });

  const retry = root.querySelector('[data-action="retry"]');
  if (retry) retry.addEventListener('click', () => invalidate(s));

  const addBtn = root.querySelector('[data-action="add"]');
  if (addBtn) addBtn.addEventListener('click', () => go('equipment/new'));

  /* --- Row navigation ------------------------------------------------------
     One listener per row rather than per cell: the actions cell marks itself
     [data-stop-row-click] so its buttons do not also open the row. */
  root.querySelectorAll('tr.row-clickable').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-stop-row-click]')) return;
      go('equipment/:id', { id: row.dataset.equipmentId });
    });
  });

  root.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', () => go('equipment/:id', { id: btn.dataset.equipmentId }));
  });

  root.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => go('equipment/:id/edit', { id: btn.dataset.equipmentId }));
  });
}

/** Called after any write, so the list refetches instead of showing stale rows. */
export function invalidateEquipmentList() {
  delete UI.equipmentList;
}
