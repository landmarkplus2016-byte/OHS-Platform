/* ==========================================================================
   employees/pages/resignedPage.js — archived employees.

   Read-only by design. Nothing is ever deleted (rule 6): a resignation or a
   termination flips `archived`, and the record, its certificates and its
   renewal history stay forever. The only action here is putting someone back.

   ONE COMPROMISE WORTH KNOWING
   ---------------------------
   `list_employees` offers `include_archived` — "and archived", not "archived
   only" (Section 3.5). So this page asks for everyone and keeps the archived
   rows, which means it over-fetches by roughly the size of the active roster.

   That is acceptable at Landmark's scale and it is honest about the API we
   have; the alternative is a new server-side filter, which is a spec change
   that goes through Khaled. Search and paging are applied here for the same
   reason — the server cannot page a set it does not know we are narrowing.
   ========================================================================== */

import { UI } from '../../../state.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { t } from '../../../i18n/i18n.js';
import { escapeHtml, fmtDateTime } from '../../../utils/format.js';
import { canEdit } from '../../../utils/permissions.js';
import { MODULE_NAMES } from '../../../constants/globals.js';
import { teamBadge, worstStateBadge } from '../../../components/badge.js';
import { toast, toastSuccess, toastError } from '../../../components/toast.js';
import { confirmDialog } from '../../../components/modal.js';
import { listAllEmployees, unarchiveEmployee } from '../dataActions.js';
import { BULK_PAGE_SIZE, MAX_PAGE_WALK, PAGE_SIZE } from '../constants.js';

/** How long after the last keystroke the search applies. */
const SEARCH_DEBOUNCE_MS = 300;

let searchTimer = null;

function pageState() {
  if (!UI.employeeResigned) {
    UI.employeeResigned = {
      search: '',
      page: 1,

      status: 'idle',
      seq: 0,
      employees: [],
      error: null,
      busy: false,
    };
  }
  return UI.employeeResigned;
}

/**
 * Drop this page's cached roster, so it refetches next time it is drawn.
 *
 * Archiving and unarchiving are the only things that move a record between a
 * team list and this one, and both happen on *other* pages — the detail page,
 * and the form page's post-save offer. Each of those already drops
 * `UI.employeeList`; without this they left this page's own cache behind, so an
 * employee archived from their detail page vanished from Field Team correctly
 * and never appeared under Resigned & Terminated until the session was cleared.
 *
 * Exported rather than inlined as `delete UI.employeeResigned` at each call
 * site, mirroring invalidateEmployeeDetail(): the page that owns a cache key is
 * the page that should own the invalidation, and a key spelled out in four
 * files is a key that gets forgotten in the fifth.
 */
export function invalidateResignedList() {
  delete UI.employeeResigned;
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
    const result = await listAllEmployees(
      { include_archived: true },
      { pageSize: BULK_PAGE_SIZE, maxPages: MAX_PAGE_WALK }
    );

    if (mySeq !== s.seq) return;

    s.employees = result.employees.filter((employee) => employee.archived);
    s.status = 'ready';
  } catch (err) {
    if (mySeq !== s.seq) return;

    s.status = 'error';
    s.error = err;
    console.error('[employees] resigned load failed:', err);
    toastError(err);
  }

  render();
}

/** The archived rows matching the search box. */
function visibleRows(s) {
  const query = s.search.trim().toLowerCase();
  if (!query) return s.employees;

  return s.employees.filter((employee) =>
    employee.name.toLowerCase().includes(query)
    || employee.national_id.toLowerCase().includes(query));
}

/* ---------- Rendering ----------------------------------------------------- */

function renderRow(employee, editable) {
  const derived = employee.derived || {};

  return `
    <tr class="row-clickable" data-employee-id="${escapeHtml(employee.employee_id)}">
      <td>
        <b>${escapeHtml(employee.name)}</b>
        <div class="cell-sub">${escapeHtml(employee.employee_id)}</div>
      </td>
      <td class="cell-mono">${escapeHtml(employee.national_id)}</td>
      <td>${teamBadge(employee.team)}</td>
      <td>${escapeHtml(employee.title || '—')}</td>
      <td>${escapeHtml(employee.subcontractor || '—')}</td>
      <td>${worstStateBadge(derived.worst_state)}</td>
      <td>${escapeHtml(fmtDateTime(employee.archived_at))}</td>
      <td data-stop-row-click>
        <button type="button" class="btn btn-ghost btn-sm" data-action="view"
                data-employee-id="${escapeHtml(employee.employee_id)}">${escapeHtml(t('view'))}</button>
        ${editable ? `
          <button type="button" class="btn btn-ghost btn-sm" data-action="unarchive"
                  data-employee-id="${escapeHtml(employee.employee_id)}"
                  data-employee-name="${escapeHtml(employee.name)}">${escapeHtml(t('emp_unarchive'))}</button>` : ''}
      </td>
    </tr>`;
}

export function renderResignedPage() {
  const s = pageState();
  const editable = canEdit(MODULE_NAMES.EMPLOYEES);

  const head = `
    <div class="page-head">
      <div>
        <div class="page-head-sub">${escapeHtml(t('emp_resigned_intro'))}</div>
      </div>
    </div>`;

  if (s.status !== 'ready') {
    return `
      <div class="employee-resigned">
        ${head}
        <div class="cell-empty">${escapeHtml(t(s.status === 'error' ? 'err_server_error' : 'loading_data'))}</div>
      </div>`;
  }

  const rows = visibleRows(s);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(s.page, pages);
  const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return `
    <div class="employee-resigned">
      ${head}

      <div class="filter-bar">
        <div class="field filter-search">
          <label for="resigned-search">${escapeHtml(t('search'))}</label>
          <input id="resigned-search" type="search" autocomplete="off" spellcheck="false"
                 placeholder="${escapeHtml(t('emp_search_placeholder'))}"
                 value="${escapeHtml(s.search)}">
        </div>
        <div class="count">${escapeHtml(t('emp_resigned_count', { count: rows.length }))}</div>
      </div>

      <table class="tbl">
        <thead>
          <tr>
            <th>${escapeHtml(t('emp_col_name'))}</th>
            <th>${escapeHtml(t('emp_col_national_id'))}</th>
            <th>${escapeHtml(t('emp_col_team'))}</th>
            <th>${escapeHtml(t('emp_col_title'))}</th>
            <th>${escapeHtml(t('emp_col_subcontractor'))}</th>
            <th>${escapeHtml(t('emp_col_state'))}</th>
            <th>${escapeHtml(t('emp_col_archived_on'))}</th>
            <th>${escapeHtml(t('actions'))}</th>
          </tr>
        </thead>
        <tbody>
          ${slice.length
            ? slice.map((employee) => renderRow(employee, editable)).join('')
            : `<tr><td colspan="8" class="cell-empty">${escapeHtml(t(s.search ? 'no_results' : 'emp_resigned_none'))}</td></tr>`}
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

/* ---------- Unarchive ----------------------------------------------------- */

async function doUnarchive(employeeId, name) {
  const s = pageState();
  if (s.busy) return;

  const answer = await confirmDialog({
    title: t('emp_unarchive_title'),
    message: `${name} — ${t('emp_unarchive_message')}`,
    confirmLabel: t('emp_unarchive'),
  });
  if (!answer) return;

  s.busy = true;
  try {
    await unarchiveEmployee(employeeId);
    toastSuccess(t('emp_unarchived_ok'));

    s.status = 'idle';       // this row belongs on a team list now
    delete UI.employeeList;
  } catch (err) {
    console.error('[employees] unarchive failed:', err);

    if (err && err.code === 'conflict') toast(t('emp_national_id_taken'), 'error');
    else toastError(err);
  } finally {
    s.busy = false;
    render();
  }
}

/* ---------- Events -------------------------------------------------------- */

export function bindResignedPageEvents() {
  const root = document.querySelector('.employee-resigned');
  if (!root) return;

  const s = pageState();
  ensureData();

  /* Same rule as the team lists (Section 9.3): typing does not redraw, and the
     debounced redraw that follows has its caret restored by render.js. */
  const searchInput = root.querySelector('#resigned-search');
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
      go('employee/:id', { id: row.dataset.employeeId });
    });
  });

  root.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', () => go('employee/:id', { id: btn.dataset.employeeId }));
  });

  root.querySelectorAll('[data-action="unarchive"]').forEach((btn) => {
    btn.addEventListener('click', () => doUnarchive(btn.dataset.employeeId, btn.dataset.employeeName));
  });
}
