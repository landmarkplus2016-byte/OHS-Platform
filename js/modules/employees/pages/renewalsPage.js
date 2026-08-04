/* ==========================================================================
   employees/pages/renewalsPage.js — every certificate coming up for renewal,
   soonest first.

   WHERE THE WORK HAPPENS
   ----------------------
   Section 3.5 has no `list_renewals` action, and adding one is a spec change
   that goes through Khaled — so this page composes the view from
   `list_employees`, which is the action that exists.

   That splits the work honestly:
     - the server filters (team, subcontractor), pages, and derives every
       certificate state into `derived.per_cert`;
     - this page pivots one employee row into one row per certificate, drops the
       ones outside the chosen window, and orders them by days remaining.

   The pivot and the ordering are presentation. No state is computed here — the
   badge on each row is the one the server already decided (rule: the server
   derives, the frontend displays).
   ========================================================================== */

import { UI } from '../../../state.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { t } from '../../../i18n/i18n.js';
import { escapeHtml, fmtDate, daysUntil } from '../../../utils/format.js';
import { certStateBadge, teamBadge } from '../../../components/badge.js';
import { toastError } from '../../../components/toast.js';
import { listAllEmployees, loadFieldOptions } from '../dataActions.js';
import {
  TEAMS, CERT_LABEL_KEYS, certKeysFor, BULK_PAGE_SIZE, MAX_PAGE_WALK, PAGE_SIZE,
} from '../constants.js';

/** Window options, in days. 0 means "everything, including already expired". */
const WINDOWS = [
  { value: '30', labelKey: 'emp_renewals_window_30' },
  { value: '60', labelKey: 'emp_renewals_window_60' },
  { value: '90', labelKey: 'emp_renewals_window_90' },
  { value: '0', labelKey: 'emp_renewals_window_all' },
];

/** Every certificate key either team can carry, for the cert-type filter. */
const ALL_CERT_KEYS = certKeysFor(TEAMS.SAFETY);

function pageState() {
  if (!UI.employeeRenewals) {
    UI.employeeRenewals = {
      window: '90',
      team: '',
      subcontractor: '',
      certKey: '',
      page: 1,

      status: 'idle',
      queryKey: null,
      seq: 0,
      employees: [],
      options: null,
      truncated: false,
      error: null,
    };
  }
  return UI.employeeRenewals;
}

/** Only the filters the *server* applies belong in the fetch key. */
function queryKey(s) {
  return [s.team, s.subcontractor].join(' ');
}

/* ---------- Data ---------------------------------------------------------- */

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

  const filters = {};
  if (s.subcontractor) filters.subcontractor = s.subcontractor;

  try {
    const [result, options] = await Promise.all([
      listAllEmployees(
        { team: s.team || undefined, include_archived: false, filters },
        { pageSize: BULK_PAGE_SIZE, maxPages: MAX_PAGE_WALK }
      ),
      loadFieldOptions(),
    ]);

    if (mySeq !== s.seq) return;

    s.employees = result.employees;
    s.truncated = result.truncated;
    s.options = options;
    s.status = 'ready';
  } catch (err) {
    if (mySeq !== s.seq) return;

    s.status = 'error';
    s.error = err;
    console.error('[employees] renewals load failed:', err);
    toastError(err);
  }

  render();
}

/* ---------- The pivot ----------------------------------------------------- */

/**
 * Flatten employees into one row per certificate that has an expiry date, then
 * filter by window and cert type and sort by urgency.
 *
 * Certificates with no date recorded are left out: `missing` is a data gap for
 * the admin to close, not a renewal to schedule (Section 6.2).
 *
 * @returns {Array<{employee, certKey, expiry, days, state}>}
 */
function buildRows(s) {
  const windowDays = Number(s.window);
  const rows = [];

  s.employees.forEach((employee) => {
    const perCert = (employee.derived && employee.derived.per_cert) || {};

    certKeysFor(employee.team).forEach((certKey) => {
      if (s.certKey && certKey !== s.certKey) return;

      const expiry = employee['cert_' + certKey + '_expiry'];
      if (!expiry) return;

      const days = daysUntil(expiry);
      if (days === null) return;

      // A positive window keeps anything already expired plus everything due
      // inside it; "All" keeps the lot.
      if (windowDays > 0 && days > windowDays) return;

      rows.push({ employee, certKey, expiry, days, state: perCert[certKey] });
    });
  });

  return rows.sort((a, b) => a.days - b.days);
}

/* ---------- Rendering ----------------------------------------------------- */

function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function renderFilters(s, total) {
  const subs = (s.options && s.options.subcontractors) || [];
  const visibleSubs = subs.filter((o) => o.active || o.option_value === s.subcontractor);

  return `
    <div class="filter-bar">
      <div class="field">
        <label for="ren-window">${escapeHtml(t('emp_renewals_window'))}</label>
        <select id="ren-window" data-filter="window">
          ${WINDOWS.map((w) => option(w.value, t(w.labelKey), s.window)).join('')}
        </select>
      </div>

      <div class="field">
        <label for="ren-team">${escapeHtml(t('emp_col_team'))}</label>
        <select id="ren-team" data-filter="team">
          ${option('', t('filter_all'), s.team)}
          ${option(TEAMS.FIELD, t('team_field'), s.team)}
          ${option(TEAMS.SAFETY, t('team_safety'), s.team)}
        </select>
      </div>

      <div class="field">
        <label for="ren-cert">${escapeHtml(t('emp_renewals_cert'))}</label>
        <select id="ren-cert" data-filter="certKey">
          ${option('', t('filter_all'), s.certKey)}
          ${ALL_CERT_KEYS.map((key) => option(key, t(CERT_LABEL_KEYS[key]), s.certKey)).join('')}
        </select>
      </div>

      <div class="field">
        <label for="ren-sub">${escapeHtml(t('emp_filter_subcontractor'))}</label>
        <select id="ren-sub" data-filter="subcontractor">
          ${option('', t('filter_all'), s.subcontractor)}
          ${visibleSubs.map((o) => option(o.option_value, o.option_value, s.subcontractor)).join('')}
        </select>
      </div>

      <div class="count">${escapeHtml(t('emp_renewals_count', { count: total }))}</div>
    </div>`;
}

function renderRow(row) {
  const daysText = row.days >= 0
    ? t('emp_days_left', { days: row.days })
    : t('emp_days_ago', { days: Math.abs(row.days) });

  return `
    <tr class="row-clickable row-${escapeHtml(row.state || 'missing')}"
        data-employee-id="${escapeHtml(row.employee.employee_id)}">
      <td>
        <b>${escapeHtml(row.employee.name)}</b>
        <div class="cell-sub">${escapeHtml(row.employee.employee_id)}</div>
      </td>
      <td>${teamBadge(row.employee.team)}</td>
      <td>${escapeHtml(t(CERT_LABEL_KEYS[row.certKey] || row.certKey))}</td>
      <td>${escapeHtml(fmtDate(row.expiry))}</td>
      <td><b>${escapeHtml(daysText)}</b></td>
      <td>${certStateBadge(row.state)}</td>
      <td>${escapeHtml(row.employee.subcontractor || '—')}</td>
    </tr>`;
}

export function renderRenewalsPage() {
  const s = pageState();

  const header = `
    <thead>
      <tr>
        <th>${escapeHtml(t('emp_col_employee'))}</th>
        <th>${escapeHtml(t('emp_col_team'))}</th>
        <th>${escapeHtml(t('emp_col_certificate'))}</th>
        <th>${escapeHtml(t('emp_col_expiry'))}</th>
        <th>${escapeHtml(t('emp_col_days'))}</th>
        <th>${escapeHtml(t('emp_col_state'))}</th>
        <th>${escapeHtml(t('emp_col_subcontractor'))}</th>
      </tr>
    </thead>`;

  if (s.status !== 'ready') {
    return `
      <div class="employee-renewals">
        <div class="page-head">
          <div>
            <div class="page-head-title">${escapeHtml(t('nav_renewals'))}</div>
            <div class="page-head-sub">${escapeHtml(t('emp_renewals_intro'))}</div>
          </div>
        </div>
        <div class="cell-empty">${escapeHtml(t(s.status === 'error' ? 'err_server_error' : 'loading_data'))}</div>
      </div>`;
  }

  const rows = buildRows(s);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(s.page, pages);
  const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return `
    <div class="employee-renewals">
      <div class="page-head">
        <div>
          <div class="page-head-title">${escapeHtml(t('nav_renewals'))}</div>
          <div class="page-head-sub">${escapeHtml(t('emp_renewals_intro'))}</div>
        </div>
      </div>

      ${renderFilters(s, rows.length)}

      <table class="tbl">
        ${header}
        <tbody>
          ${slice.length
            ? slice.map(renderRow).join('')
            : `<tr><td colspan="7" class="cell-empty">${escapeHtml(t('emp_renewals_none'))}</td></tr>`}
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

/* ---------- Events -------------------------------------------------------- */

export function bindRenewalsPageEvents() {
  const root = document.querySelector('.employee-renewals');
  if (!root) return;

  const s = pageState();
  ensureData();

  root.querySelectorAll('[data-filter]').forEach((select) => {
    select.addEventListener('change', () => {
      const field = select.dataset.filter;
      s[field] = select.value;
      s.page = 1;

      // team and subcontractor are server-side filters, so changing either
      // means refetching. window and cert type are applied to data we already
      // hold, so they only need a redraw.
      if (field === 'team' || field === 'subcontractor') s.status = 'idle';
      render();
    });
  });

  root.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      s.page += btn.dataset.page === 'next' ? 1 : -1;
      if (s.page < 1) s.page = 1;
      render();
    });
  });

  root.querySelectorAll('tr.row-clickable').forEach((row) => {
    row.addEventListener('click', () => go('employee/:id', { id: row.dataset.employeeId }));
  });
}
