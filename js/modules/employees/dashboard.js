/* ==========================================================================
   employees/dashboard.js — what the employee module contributes to the
   dashboard (Section 5.5).

   Three exports, wired into the manifest's `dashboard` block:

     load()    fetches list_employee_stats; the shell calls it from its bind
     kpis()    the row of four KPI cards
     charts()  the row of three charts, plus the Recently Updated list

   `kpis` and `charts` are synchronous — the shell composes the page in one
   pass — so they render whatever state `load` has reached. That is the same
   page/bind split every route in this module uses.

   THE COUNTS ARE THE SERVER'S
   ---------------------------
   Nothing here counts anything. `list_employee_stats` derives every employee
   once and returns totals (Section 6.6), so the dashboard, the team lists and
   the officer app cannot disagree about what "expired" means.

   The KPI row mixes units deliberately (Section 5.5): "Certificates expired"
   counts certificates, the other three count employees. The card says so in its
   own sub-line rather than leaving the reader to work out why the numbers do
   not add up to headcount.
   ========================================================================== */

import { UI } from '../../state.js';
import { go } from '../../router.js';
import { render } from '../../render.js';
import { t } from '../../i18n/i18n.js';
import { escapeHtml, fmtDate, fmtDateTime } from '../../utils/format.js';
import { worstStateBadge } from '../../components/badge.js';
import { barChart, targetBar } from '../../components/charts.js';
import { listEmployeeStats } from './dataActions.js';
import { CERT_LABEL_KEYS } from './constants.js';

/** Bars are ranked, so a long tail past this adds height without adding signal. */
const MAX_BARS = 8;

/** Parked on UI so it survives a redraw and is wiped by clearSession(). */
function dashState() {
  if (!UI.employeeDashboard) {
    UI.employeeDashboard = {
      status: 'idle',   // idle → loading → ready | error
      seq: 0,
      data: null,
      error: null,
    };
  }
  return UI.employeeDashboard;
}

/* ---------- Data ---------------------------------------------------------- */

/**
 * Fetch the stats if we do not already have them.
 *
 * Called from the dashboard page's bind on every draw, so it must be cheap and
 * idempotent once the data is in hand. Unlike a list page there is no query to
 * invalidate against — the figures are only refetched when the user asks, via
 * the retry button or by navigating back to the dashboard after a sign-out.
 *
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<void>}
 */
export async function loadEmployeeDashboard(opts) {
  const s = dashState();

  if (s.status === 'loading') return;
  if (!(opts && opts.force) && s.status !== 'idle') return;

  const mySeq = ++s.seq;
  s.status = 'loading';
  s.error = null;
  render();

  try {
    const data = await listEmployeeStats();
    if (mySeq !== s.seq) return;

    s.data = data;
    s.status = 'ready';
  } catch (err) {
    if (mySeq !== s.seq) return;

    s.status = 'error';
    s.error = err;

    // No toast. The dashboard draws one section per module, and a module admin
    // with two grants would get two error toasts for one failed page load; the
    // section says so in place instead.
    console.error('[employees] dashboard stats failed:', err);
  }

  render();
}

/* ---------- Shared bits --------------------------------------------------- */

/** The figure a KPI shows before the data lands. */
function kpiValue(s, read) {
  return s.status === 'ready' ? String(read(s.data)) : '—';
}

/** The line a chart card shows in place of itself while loading or on failure. */
function chartState(s) {
  if (s.status === 'error') {
    return `<div class="chart-empty">
      ${escapeHtml(t('err_' + ((s.error && s.error.code) || 'server_error')))}
      <button type="button" class="btn btn-ghost btn-sm"
              data-action="dash-retry-employees">${escapeHtml(t('retry'))}</button>
    </div>`;
  }
  return `<div class="chart-empty">${escapeHtml(t('loading_data'))}</div>`;
}

/** A certificate's display name; unknown keys fall back to the key itself. */
function certLabel(key) {
  return t(CERT_LABEL_KEYS[key] || key);
}

/* ---------- KPI row ------------------------------------------------------- */

/**
 * The four KPI cards (Section 5.5).
 *
 * @returns {string} HTML
 */
export function renderEmployeeKpis() {
  const s = dashState();
  const ready = s.status === 'ready';
  const totals = (s.data && s.data.totals) || {};
  const urgentDays = (s.data && s.data.thresholds && s.data.thresholds.urgent_days) || 30;

  return `
    <div class="kpi-row" data-dash-section="employees">
      <div class="kpi blue">
        <div class="n">${escapeHtml(kpiValue(s, (d) => d.totals.active))}</div>
        <div class="l">${escapeHtml(t('emp_dash_kpi_total'))}</div>
        ${ready ? `
          <div class="kpi-split">
            <span>${escapeHtml(t('emp_dash_split_field', { count: totals.field }))}</span>
            <span>${escapeHtml(t('emp_dash_split_safety', { count: totals.safety }))}</span>
          </div>` : ''}
      </div>

      <div class="kpi red">
        <div class="n">${escapeHtml(kpiValue(s, (d) => d.totals.certs_expired))}</div>
        <div class="l">${escapeHtml(t('emp_dash_kpi_expired'))}</div>
        <div class="kpi-note">${escapeHtml(t('emp_dash_kpi_expired_note'))}</div>
      </div>

      <div class="kpi amber">
        <div class="n">${escapeHtml(kpiValue(s, (d) => d.totals.employees_urgent))}</div>
        <div class="l">${escapeHtml(t('emp_dash_kpi_urgent', { days: urgentDays }))}</div>
        <div class="kpi-note">${escapeHtml(t('emp_dash_kpi_people_note'))}</div>
      </div>

      <div class="kpi green">
        <div class="n">${escapeHtml(kpiValue(s, (d) => d.totals.compliant))}</div>
        <div class="l">${escapeHtml(t('emp_dash_kpi_compliant'))}</div>
        <div class="kpi-note">${escapeHtml(t('emp_dash_kpi_compliant_note'))}</div>
      </div>
    </div>`;
}

/* ---------- Charts -------------------------------------------------------- */

/** "Expiries in next 30 days by certificate" — the window the KPI above uses. */
function renderByCertCard(s, urgentDays) {
  const body = s.status === 'ready'
    ? barChart(
      (s.data.by_cert || []).map((row) => ({
        label: certLabel(row.cert_key),
        value: row.count,
        colorToken: '--warn',
      })),
      { emptyKey: 'emp_dash_no_expiries', limit: MAX_BARS }
    )
    : chartState(s);

  return `
    <div class="card">
      <h3>${escapeHtml(t('emp_dash_chart_by_cert', { days: urgentDays }))}</h3>
      ${body}
    </div>`;
}

/** "Headcount by subcontractor". */
function renderBySubcontractorCard(s) {
  const body = s.status === 'ready'
    ? barChart(
      (s.data.by_subcontractor || []).map((row) => ({
        label: row.subcontractor,
        value: row.count,
        colorToken: '--teal',
      })),
      { emptyKey: 'emp_dash_no_subcontractors', limit: MAX_BARS }
    )
    : chartState(s);

  return `
    <div class="card">
      <h3>${escapeHtml(t('emp_dash_chart_by_sub'))}</h3>
      ${body}
    </div>`;
}

/**
 * The RDT coverage card: a headline percentage and a bar measuring it against
 * the yearly target.
 *
 * Coverage is unique tested employees ÷ the eligible pool, which cannot exceed
 * 100% however many waves run — the target is 120%, so the card also shows the
 * raw test count, which is the number that can pass it. Both come straight from
 * the server (Section 5.5).
 *
 * With no RDT settings on the ModuleSettings tab the card says tracking is off
 * rather than showing a zero that looks like a compliance failure.
 */
function renderRdtCard(s) {
  let body;

  if (s.status !== 'ready') {
    body = chartState(s);
  } else if (!s.data.rdt || !s.data.rdt.tracking) {
    body = `
      <div class="chart-empty">
        <b>${escapeHtml(t('emp_dash_rdt_off'))}</b>
        <div class="chart-empty-hint">${escapeHtml(t('emp_dash_rdt_off_hint'))}</div>
      </div>`;
  } else {
    const rdt = s.data.rdt;

    body = `
      <div class="rdt-coverage">
        <div class="rdt-headline">${escapeHtml(t('emp_dash_rdt_pct', { pct: rdt.coverage_pct }))}</div>
        ${targetBar({
          value: rdt.coverage_pct,
          target: rdt.target_pct,
          colorToken: '--primary',
          caption: t('emp_dash_rdt_caption', {
            tested: rdt.tested_employees,
            pool: rdt.pool,
            target: rdt.target_pct,
          }),
        })}
        <div class="rdt-meta">
          ${escapeHtml(t('emp_dash_rdt_tests', { count: rdt.tests_recorded }))}
          · ${escapeHtml(t('emp_dash_rdt_since', { date: fmtDate(rdt.year_start) }))}
        </div>
      </div>`;
  }

  return `
    <div class="card">
      <h3>${escapeHtml(t('emp_dash_chart_rdt'))}</h3>
      ${body}
    </div>`;
}

/** The six most recently modified employees. Rows open the employee. */
function renderRecentCard(s) {
  let body;

  if (s.status !== 'ready') {
    body = chartState(s);
  } else if (!s.data.recent || s.data.recent.length === 0) {
    body = `<div class="chart-empty">${escapeHtml(t('emp_dash_recent_none'))}</div>`;
  } else {
    body = `<div class="recent-list">${s.data.recent.map((row) => `
      <div class="recent-row" role="button" tabindex="0"
           data-dash-employee-id="${escapeHtml(row.employee_id)}">
        <div class="recent-main">
          <b>${escapeHtml(row.name)}</b>
          <div class="cell-sub">${escapeHtml(row.employee_id)}</div>
        </div>
        ${worstStateBadge(row.worst_state)}
        <div class="recent-when">${escapeHtml(fmtDateTime(row.updated_at))}</div>
      </div>`).join('')}</div>`;
  }

  return `
    <div class="card">
      <h3>${escapeHtml(t('emp_dash_recent'))}</h3>
      ${body}
    </div>`;
}

/**
 * The employee chart block: the three charts of Section 5.5, then the Recently
 * Updated list on a row of its own.
 *
 * Recently Updated rides along here rather than in a slot of its own because
 * the manifest's dashboard contract is two functions — KPIs and charts
 * (Section 5.2). Adding a third slot for one card would be a change to the
 * module contract every future module then has to know about.
 *
 * @returns {string} HTML
 */
export function renderEmployeeCharts() {
  const s = dashState();
  const urgentDays = (s.data && s.data.thresholds && s.data.thresholds.urgent_days) || 30;

  return `
    <div class="chart-row chart-row-3">
      ${renderByCertCard(s, urgentDays)}
      ${renderBySubcontractorCard(s)}
      ${renderRdtCard(s)}
    </div>

    <div class="chart-row chart-row-1">
      ${renderRecentCard(s)}
    </div>`;
}

/* ---------- Events -------------------------------------------------------- */

/**
 * Wire the retry button and the Recently Updated rows.
 *
 * Scoped to `root` — the dashboard page passes its own container so this cannot
 * reach into another module's section.
 *
 * @param {Element} root
 */
export function bindEmployeeDashboard(root) {
  if (!root) return;

  loadEmployeeDashboard();

  root.querySelectorAll('[data-action="dash-retry-employees"]').forEach((btn) => {
    btn.addEventListener('click', () => loadEmployeeDashboard({ force: true }));
  });

  root.querySelectorAll('[data-dash-employee-id]').forEach((row) => {
    const open = () => go('employee/:id', { id: row.dataset.dashEmployeeId });

    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      open();
    });
  });
}
