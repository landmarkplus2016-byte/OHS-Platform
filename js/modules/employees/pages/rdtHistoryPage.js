/* ==========================================================================
   employees/pages/rdtHistoryPage.js — the full RDT log for a fiscal year.

   The RDT dashboard shows this month and the fifteen newest entries. This is
   the rest of it: every selection, completion and miss in the year, filtered
   by month, team, status and result, and exportable.

   Filtering and paging are the server's (`list_rdt_history`), not this page's.
   The log passes a hundred rows within two months of a programme starting, and
   the rule against unpaginated lists applies to it like any other table.

   The export is the exception: it downloads the *whole* filtered set rather
   than the page on screen, so it walks pages until the server runs out. What an
   admin means by "export this view" is the view, not the fifty rows they can
   currently see.
   ========================================================================== */

import { UI } from '../../../state.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { t, getLanguage } from '../../../i18n/i18n.js';
import { escapeHtml, fmtDate } from '../../../utils/format.js';
import { teamBadge, rdtStatusBadge, rdtResultBadge } from '../../../components/badge.js';
import { toast, toastError } from '../../../components/toast.js';
import { exportToExcel, exportBlockReason } from '../../../utils/exportHelpers.js';
import { listRdtOverview, listRdtHistory } from '../dataActions.js';
import { TEAMS, RDT_STATUSES, RDT_RESULTS, RDT_HISTORY_PAGE_SIZE } from '../constants.js';

function pageState() {
  if (!UI.employeeRdtHistory) {
    UI.employeeRdtHistory = {
      month: '',
      team: '',
      rdtStatus: '',
      result: '',
      page: 1,

      status: 'idle',
      queryKey: null,
      seq: 0,
      data: null,
      meta: null,      // settings + fiscal year, from list_rdt_overview
      error: null,
      exporting: false,
    };
  }
  return UI.employeeRdtHistory;
}

/** Every filter here is applied server-side, so all of them belong in the key. */
function queryKey(s) {
  return [s.month, s.team, s.rdtStatus, s.result, s.page].join(' ');
}

/* ---------- Data ---------------------------------------------------------- */

function filterParams(s) {
  const params = {};
  if (s.month) params.month = s.month;
  if (s.team) params.team = s.team;
  if (s.rdtStatus) params.status = s.rdtStatus;
  if (s.result) params.result = s.result;
  return params;
}

async function ensureData() {
  const s = pageState();
  const key = queryKey(s);

  if (s.status === 'loading') return;
  if (s.status !== 'idle' && s.queryKey === key) return;

  const mySeq = ++s.seq;
  s.status = 'loading';
  s.queryKey = key;
  s.error = null;
  render();

  try {
    // The overview is what tells this page which fiscal year it is looking at
    // and which months that year spans. It is cheap and it is already cached by
    // the browser's own connection reuse, so fetching it alongside keeps the
    // month filter honest when the year rolls over.
    const [meta, data] = await Promise.all([
      s.meta ? Promise.resolve(s.meta) : listRdtOverview(),
      listRdtHistory({ ...filterParams(s), page: s.page, page_size: RDT_HISTORY_PAGE_SIZE }),
    ]);

    if (mySeq !== s.seq) return;

    s.meta = meta;
    s.data = data;
    s.status = 'ready';
  } catch (err) {
    if (mySeq !== s.seq) return;

    s.status = 'error';
    s.error = err;
    console.error('[employees] rdt history load failed:', err);
    toastError(err);
  }

  render();
}

/* ---------- Rendering ----------------------------------------------------- */

/** The 12 'YYYY-MM' months of a fiscal year, in calendar order from its start. */
function fiscalMonths(meta) {
  if (!meta || !meta.fiscal_year) return [];

  const startMonth = meta.settings.fiscal_year_start_month;
  const months = [];

  for (let i = 0; i < 12; i += 1) {
    const offset = startMonth - 1 + i;
    const year = meta.fiscal_year.start_year + Math.floor(offset / 12);
    months.push(`${year}-${String((offset % 12) + 1).padStart(2, '0')}`);
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
  const months = fiscalMonths(s.meta);

  return `
    <div class="filter-bar">
      <div class="field">
        <label for="rdth-month">${escapeHtml(t('emp_rdt_filter_month'))}</label>
        <select id="rdth-month" data-filter="month">
          ${option('', t('filter_all'), s.month)}
          ${months.map((m) => option(m, monthOptionLabel(m), s.month)).join('')}
        </select>
      </div>

      <div class="field">
        <label for="rdth-team">${escapeHtml(t('emp_col_team'))}</label>
        <select id="rdth-team" data-filter="team">
          ${option('', t('filter_all'), s.team)}
          ${option(TEAMS.FIELD, t('team_field'), s.team)}
          ${option(TEAMS.SAFETY, t('team_safety'), s.team)}
        </select>
      </div>

      <div class="field">
        <label for="rdth-status">${escapeHtml(t('emp_rdt_col_status'))}</label>
        <select id="rdth-status" data-filter="rdtStatus">
          ${option('', t('filter_all'), s.rdtStatus)}
          ${RDT_STATUSES.map((v) => option(v, t('emp_rdt_status_' + v), s.rdtStatus)).join('')}
        </select>
      </div>

      <div class="field">
        <label for="rdth-result">${escapeHtml(t('emp_rdt_result'))}</label>
        <select id="rdth-result" data-filter="result">
          ${option('', t('filter_all'), s.result)}
          ${RDT_RESULTS.map((v) => option(v, t('emp_rdt_result_' + v), s.result)).join('')}
        </select>
      </div>

      <div class="count">${escapeHtml(t('emp_rdt_n_entries', { count: s.data.total_matching }))}</div>

      <button type="button" class="btn btn-ghost btn-sm" data-action="export"
              ${s.exporting ? 'disabled' : ''}>${
        escapeHtml(t(s.exporting ? 'export_preparing' : 'emp_rdt_export'))
      }</button>
    </div>`;
}

function renderRow(entry) {
  return `
    <tr>
      <td>${escapeHtml(fmtDate(entry.selected_at))}</td>
      <td>
        <b><a class="link-plain" data-employee-id="${escapeHtml(entry.employee_id)}">${
          escapeHtml(entry.name || entry.employee_id)
        }</a></b>
        <div class="cell-sub">${escapeHtml(entry.employee_id)}</div>
      </td>
      <td>${teamBadge(entry.team)}</td>
      <td class="cell-mono">${escapeHtml(entry.log_id)}</td>
      <td>${escapeHtml(entry.test_date ? fmtDate(entry.test_date) : '—')}</td>
      <td>${rdtStatusBadge(entry.status)}</td>
      <td>${rdtResultBadge(entry.result) || '—'}</td>
      <td class="rdt-notes-cell">${escapeHtml(entry.notes || '')}</td>
    </tr>`;
}

export function renderRdtHistoryPage() {
  const s = pageState();

  const head = `
    <div class="page-head">
      <div>
        <div class="page-head-title">${escapeHtml(t('emp_rdt_history_title'))}</div>
        <div class="page-head-sub">${escapeHtml(
          s.meta && s.meta.fiscal_year
            ? t('emp_rdt_fiscal_year', { label: s.meta.fiscal_year.label })
            : t('emp_rdt_history_sub')
        )}</div>
      </div>
      <button type="button" class="btn btn-ghost" data-action="back">${escapeHtml(t('back'))}</button>
    </div>`;

  if (s.status !== 'ready') {
    return `
      <div class="employee-rdt-history">
        ${head}
        <div class="cell-empty">${
          escapeHtml(t(s.status === 'error' ? 'err_server_error' : 'loading_data'))
        }</div>
      </div>`;
  }

  // RDT switched off entirely — nothing to show and nothing to filter.
  if (s.data.enabled === false) {
    return `
      <div class="employee-rdt-history">
        ${head}
        <div class="cell-empty">${escapeHtml(t('emp_rdt_disabled'))}</div>
      </div>`;
  }

  const pages = Math.max(1, Math.ceil(s.data.total_matching / s.data.page_size));

  return `
    <div class="employee-rdt-history">
      ${head}
      ${renderFilters(s)}

      <table class="tbl">
        <thead>
          <tr>
            <th>${escapeHtml(t('emp_rdt_col_selected_at'))}</th>
            <th>${escapeHtml(t('emp_col_name'))}</th>
            <th>${escapeHtml(t('emp_col_team'))}</th>
            <th>${escapeHtml(t('emp_rdt_col_log_id'))}</th>
            <th>${escapeHtml(t('emp_rdt_test_date'))}</th>
            <th>${escapeHtml(t('emp_rdt_col_status'))}</th>
            <th>${escapeHtml(t('emp_rdt_result'))}</th>
            <th>${escapeHtml(t('emp_rdt_notes'))}</th>
          </tr>
        </thead>
        <tbody>
          ${s.data.entries.length
            ? s.data.entries.map(renderRow).join('')
            : `<tr><td colspan="8" class="cell-empty">${escapeHtml(t('emp_rdt_history_empty'))}</td></tr>`}
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

/**
 * Every row matching the current filters, by walking pages until the server
 * runs out. The on-screen page is 100 rows; the export is the whole view.
 */
async function fetchAllFiltered(s) {
  const entries = [];
  let page = 1;

  for (;;) {
    const data = await listRdtHistory({ ...filterParams(s), page, page_size: 500 });
    entries.push(...data.entries);

    if (entries.length >= data.total_matching || data.entries.length === 0) break;
    if (page >= 20) break;   // circuit breaker, same reasoning as listAllEmployees
    page += 1;
  }
  return entries;
}

async function exportHistory() {
  const s = pageState();
  if (s.exporting) return;

  s.exporting = true;
  render();

  try {
    const entries = await fetchAllFiltered(s);

    const blocked = exportBlockReason('excel', entries.length);
    if (blocked) {
      toast(blocked, 'error');
      return;
    }

    // Raw column names, untranslated, like every other spreadsheet the platform
    // writes — an export should read back as the tab it came from.
    exportToExcel(entries, {
      sheetName: 'RdtLog',
      filePrefix: 'RDT-' + ((s.meta && s.meta.fiscal_year && s.meta.fiscal_year.label) || 'log'),
    });
  } catch (err) {
    console.error('[employees] rdt history export failed:', err);
    toastError(err);
  } finally {
    s.exporting = false;
    render();
  }
}

/* ---------- Events -------------------------------------------------------- */

export function bindRdtHistoryPageEvents() {
  const root = document.querySelector('.employee-rdt-history');
  if (!root) return;

  const s = pageState();
  ensureData();

  root.querySelectorAll('[data-filter]').forEach((select) => {
    select.addEventListener('change', () => {
      s[select.dataset.filter] = select.value;
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

  root.querySelectorAll('[data-employee-id]').forEach((link) => {
    link.addEventListener('click', () => go('employee/:id', { id: link.dataset.employeeId }));
  });

  const back = root.querySelector('[data-action="back"]');
  if (back) back.addEventListener('click', () => go('rdt'));

  const exportBtn = root.querySelector('[data-action="export"]');
  if (exportBtn) exportBtn.addEventListener('click', exportHistory);
}

/** Drop the cached log — called after any write on the RDT dashboard. */
export function invalidateRdtHistory() {
  const s = pageState();
  s.status = 'idle';
  s.data = null;
  s.meta = null;
}
