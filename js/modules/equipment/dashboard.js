/* ==========================================================================
   equipment/dashboard.js — what the equipment module contributes to the
   dashboard (Section 5.5).

   Same three exports as the employee module's dashboard file, and for the same
   reasons: `load` fetches, `kpis` and `charts` render synchronously from
   whatever state the fetch has reached.

   The two modules share no code (rule 12.3) — only the shapes in
   js/components/charts.js, which is shared ground, and the shell that decides
   whether to call either of them at all.

   Every figure is the server's. `list_equipment_stats` derives each item once
   and returns totals (Section 6.6); nothing here decides what "expired" means.
   ========================================================================== */

import { UI } from '../../state.js';
import { render } from '../../render.js';
import { t } from '../../i18n/i18n.js';
import { escapeHtml } from '../../utils/format.js';
import { barChart, stackedBarChart } from '../../components/charts.js';
import { listEquipmentStats } from './dataActions.js';

/** Bars are ranked, so a long tail past this adds height without adding signal. */
const MAX_BARS = 8;

/** The two verdicts the ownership chart splits on, worst first. */
const NON_COMPLIANT = [
  { verdict: 'blocked', colorToken: '--blocked' },
  { verdict: 'warning', colorToken: '--warn' },
];

/** Parked on UI so it survives a redraw and is wiped by clearSession(). */
function dashState() {
  if (!UI.equipmentDashboard) {
    UI.equipmentDashboard = {
      status: 'idle',   // idle → loading → ready | error
      seq: 0,
      data: null,
      error: null,
    };
  }
  return UI.equipmentDashboard;
}

/* ---------- Data ---------------------------------------------------------- */

/**
 * Fetch the stats if we do not already have them. Cheap and idempotent once the
 * data is in hand, because the dashboard page's bind calls it on every draw.
 *
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<void>}
 */
export async function loadEquipmentDashboard(opts) {
  const s = dashState();

  if (s.status === 'loading') return;
  if (!(opts && opts.force) && s.status !== 'idle') return;

  const mySeq = ++s.seq;
  s.status = 'loading';
  s.error = null;
  render();

  try {
    const data = await listEquipmentStats();
    if (mySeq !== s.seq) return;

    s.data = data;
    s.status = 'ready';
  } catch (err) {
    if (mySeq !== s.seq) return;

    s.status = 'error';
    s.error = err;

    // No toast, for the reason the employee dashboard gives: a user with both
    // grants would get two toasts for one failed page load.
    console.error('[equipment] dashboard stats failed:', err);
  }

  render();
}

/* ---------- Shared bits --------------------------------------------------- */

function kpiValue(s, read) {
  return s.status === 'ready' ? String(read(s.data)) : '—';
}

function chartState(s) {
  if (s.status === 'error') {
    return `<div class="chart-empty">
      ${escapeHtml(t('err_' + ((s.error && s.error.code) || 'server_error')))}
      <button type="button" class="btn btn-ghost btn-sm"
              data-action="dash-retry-equipment">${escapeHtml(t('retry'))}</button>
    </div>`;
  }
  return `<div class="chart-empty">${escapeHtml(t('loading_data'))}</div>`;
}

/* ---------- KPI row ------------------------------------------------------- */

/**
 * The four KPI cards (Section 5.5). All four count items — unlike the employee
 * row, the units here do not mix.
 *
 * @returns {string} HTML
 */
export function renderEquipmentKpis() {
  const s = dashState();
  const ready = s.status === 'ready';
  const totals = (s.data && s.data.totals) || {};
  const urgentDays = (s.data && s.data.thresholds && s.data.thresholds.urgent_days) || 30;

  return `
    <div class="kpi-row" data-dash-section="equipment">
      <div class="kpi blue">
        <div class="n">${escapeHtml(kpiValue(s, (d) => d.totals.active))}</div>
        <div class="l">${escapeHtml(t('eqp_dash_kpi_total'))}</div>
        <div class="kpi-note">${escapeHtml(t('eqp_dash_kpi_total_note'))}</div>
      </div>

      <div class="kpi red">
        <div class="n">${escapeHtml(kpiValue(s, (d) => d.totals.inspections_expired))}</div>
        <div class="l">${escapeHtml(t('eqp_dash_kpi_expired'))}</div>
        ${ready ? `
          <div class="kpi-note">${escapeHtml(t('eqp_dash_kpi_missing_note', {
            count: totals.inspections_missing,
          }))}</div>` : ''}
      </div>

      <div class="kpi amber">
        <div class="n">${escapeHtml(kpiValue(s, (d) => d.totals.inspections_urgent))}</div>
        <div class="l">${escapeHtml(t('eqp_dash_kpi_urgent', { days: urgentDays }))}</div>
      </div>

      <div class="kpi green">
        <div class="n">${escapeHtml(kpiValue(s, (d) => d.totals.rejected_this_month))}</div>
        <div class="l">${escapeHtml(t('eqp_dash_kpi_rejected'))}</div>
        <div class="kpi-note">${escapeHtml(t('eqp_dash_kpi_rejected_note'))}</div>
      </div>
    </div>`;
}

/* ---------- Charts -------------------------------------------------------- */

/** "Inspections expiring in next 30 days by item type". */
function renderByItemCard(s, urgentDays) {
  const body = s.status === 'ready'
    ? barChart(
      (s.data.by_item || []).map((row) => ({
        label: row.item,
        value: row.count,
        colorToken: '--warn',
      })),
      { emptyKey: 'eqp_dash_no_expiries', limit: MAX_BARS }
    )
    : chartState(s);

  return `
    <div class="card">
      <h3>${escapeHtml(t('eqp_dash_chart_by_item', { days: urgentDays }))}</h3>
      ${body}
    </div>`;
}

/**
 * One chart row: the server's `by_subcontractor` list plus the unowned bucket,
 * as stacked-bar rows.
 *
 * The unowned bucket goes last whatever its size. It is not a company competing
 * for position in the ranking — it is a gap in the data, and reading it as the
 * biggest offender would be wrong.
 *
 * Which is also why the ranked list is trimmed here rather than by the chart's
 * own `limit`: that slices the head of the array, and the bucket appended after
 * it would be the first row dropped the moment there are eight companies.
 */
function subcontractorRows(data) {
  const unownedShown = data.no_subcontractor && data.no_subcontractor.count > 0;
  const room = unownedShown ? MAX_BARS - 1 : MAX_BARS;

  const rows = (data.by_subcontractor || []).slice(0, room).map((row) => ({
    label: row.subcontractor,
    value: row.count,
    segments: NON_COMPLIANT.map((seg) => ({
      value: row[seg.verdict] || 0,
      colorToken: seg.colorToken,
      label: t('verdict_' + seg.verdict),
    })),
  }));

  if (unownedShown) {
    const unowned = data.no_subcontractor;
    rows.push({
      label: t('eqp_dash_sub_unrecorded'),
      value: unowned.count,
      segments: NON_COMPLIANT.map((seg) => ({
        value: unowned[seg.verdict] || 0,
        colorToken: seg.colorToken,
        label: t('verdict_' + seg.verdict),
      })),
    });
  }

  return rows;
}

/**
 * "Non-compliant equipment by subcontractor" — who owns the gear that is
 * blocked or expiring, ranked worst first.
 *
 * This card replaced a verdict donut, which drew the same three numbers the KPI
 * row above already carries: blocked was the expired count, warning was urgent
 * plus missing, cleared was the remainder. Restating them in a circle told the
 * admin nothing new. Ownership is the fact the KPI row genuinely cannot reach,
 * and it is the one the `subcontractor` column was added to answer (Section 2).
 *
 * Cleared items are deliberately absent. A company with 200 compliant slings and
 * 3 expired ones is not a smaller problem than one with 3 items, all expired —
 * this chart is the call list, not a census.
 */
function renderBySubcontractorCard(s) {
  const body = s.status === 'ready'
    ? stackedBarChart(subcontractorRows(s.data), { emptyKey: 'eqp_dash_no_non_compliant' })
    : chartState(s);

  const legend = s.status === 'ready'
    ? `<div class="chart-legend">${NON_COMPLIANT.map((seg) => `
        <span class="legend-row">
          <span class="legend-dot" style="background: var(${seg.colorToken})"></span>
          <span class="legend-label">${escapeHtml(t('verdict_' + seg.verdict))}</span>
          <b class="legend-value">${escapeHtml(String(
      (s.data.by_verdict && s.data.by_verdict[seg.verdict]) || 0
    ))}</b>
        </span>`).join('')}</div>`
    : '';

  return `
    <div class="card">
      <h3>${escapeHtml(t('eqp_dash_chart_by_sub'))}</h3>
      ${legend}
      ${body}
    </div>`;
}

/**
 * The equipment chart block: the two charts of Section 5.5.
 *
 * @returns {string} HTML
 */
export function renderEquipmentCharts() {
  const s = dashState();
  const urgentDays = (s.data && s.data.thresholds && s.data.thresholds.urgent_days) || 30;

  return `
    <div class="chart-row chart-row-2">
      ${renderByItemCard(s, urgentDays)}
      ${renderBySubcontractorCard(s)}
    </div>`;
}

/* ---------- Events -------------------------------------------------------- */

/**
 * Wire the retry button. Scoped to `root`, which the dashboard page supplies.
 *
 * @param {Element} root
 */
export function bindEquipmentDashboard(root) {
  if (!root) return;

  loadEquipmentDashboard();

  root.querySelectorAll('[data-action="dash-retry-equipment"]').forEach((btn) => {
    btn.addEventListener('click', () => loadEquipmentDashboard({ force: true }));
  });
}
