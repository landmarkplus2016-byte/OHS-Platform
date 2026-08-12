/* ==========================================================================
   charts.js — the two chart shapes the dashboard draws.

   Shared ground, not module ground: employees and equipment both want a
   horizontal bar list and a donut, and rule 12.1 says anything two modules need
   lives here rather than inside one of them.

   Like badge.js, nothing here computes anything. It is handed rows the server
   already counted and turns them into markup (Section 6.6).

   WHY BARS ARE DIVS AND ONLY THE DONUT IS SVG
   -------------------------------------------
   An SVG bar chart does not flip in Arabic. `dir="rtl"` is a CSS-layout signal
   and SVG geometry ignores it, so every bar would still grow left-to-right with
   its labels mirrored around it. Bars built from divs with logical properties
   flip for free (Section 8.2), which is the whole reason the codebase bans
   physical properties.

   A donut has no direction — it is a circle — so it draws as SVG, with its
   legend in HTML so the text alongside still flips.

   COLOURS
   -------
   Rule 15: no hex outside tokens.css. Callers pass a CSS variable *name*
   ('--primary', '--blocked') and it lands in a `var()`, never a literal.
   ========================================================================== */

import { t } from '../i18n/i18n.js';
import { escapeHtml } from '../utils/format.js';

/** Fallback bar colour when a caller does not name one. */
const DEFAULT_BAR_TOKEN = '--primary';

/** Donut geometry, in the coordinate space of its 120×120 viewBox. */
const DONUT = { size: 120, center: 60, radius: 54, hole: 32 };

/**
 * Only a CSS custom-property name may reach a style attribute. A caller that
 * passes anything else gets the default rather than an injected declaration.
 *
 * @param {string} token e.g. '--warn'
 * @returns {string} a safe `var(--x)` expression
 */
function colorVar(token) {
  const name = /^--[a-z0-9-]+$/i.test(String(token || '')) ? token : DEFAULT_BAR_TOKEN;
  return `var(${name})`;
}

/**
 * A horizontal bar list: one row per entry, each a label, a count, and a track
 * filled proportionally to the largest value in the set.
 *
 * Bars are scaled against the maximum rather than the total — this is a
 * "compare these categories" chart, not a "share of a whole" one, and scaling
 * to the total makes every bar unreadably short as soon as there are more than
 * a handful of categories.
 *
 * @param {Array<{label: string, value: number, colorToken?: string}>} rows
 * @param {{emptyKey?: string, limit?: number}} [options]
 *        emptyKey  i18n key for the "nothing to show" line (default 'no_results')
 *        limit     keep only the first N rows; the caller has already sorted
 * @returns {string} HTML
 */
export function barChart(rows, options) {
  const opts = options || {};
  const all = Array.isArray(rows) ? rows.filter((r) => r && r.value > 0) : [];

  if (all.length === 0) {
    return `<div class="chart-empty">${escapeHtml(t(opts.emptyKey || 'no_results'))}</div>`;
  }

  const visible = opts.limit ? all.slice(0, opts.limit) : all;
  const max = Math.max(...visible.map((r) => r.value));

  return `<div class="bar-chart">${visible.map((row) => `
    <div class="bar-row">
      <div class="bar-head">
        <span class="bar-label">${escapeHtml(row.label)}</span>
        <span class="bar-value">${escapeHtml(String(row.value))}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill"
             style="inline-size: ${Math.max(2, Math.round((row.value / max) * 100))}%;
                    background: ${colorVar(row.colorToken)}"></div>
      </div>
    </div>`).join('')}</div>`;
}

/**
 * A horizontal bar list where each bar is divided into segments — same row
 * anatomy as barChart(), but the track carries a breakdown instead of one
 * colour.
 *
 * This exists rather than a second donut because the question it answers is
 * "compare these categories, and within each one, what is the split" — two
 * facts per row. A donut can only carry the second.
 *
 * Segments are laid out with flex and sized in percent of the row's own total,
 * so the divided bar still reads as one length against the longest row, and it
 * flips in Arabic for free (Section 8.2) exactly as barChart() does.
 *
 * A caller that wants a legend renders one itself — the shape of a legend
 * depends on whether the segments mean the same thing on every row, and here
 * they do, so one legend serves the whole chart rather than one per row.
 *
 * @param {Array<{label: string, value: number,
 *                segments: Array<{value: number, colorToken?: string, label?: string}>}>} rows
 *        `value` is the row total and drives the ranking against `max`;
 *        `segments` divide it. A caller passing segments that do not sum to
 *        `value` gets a short bar, not an error — the total is the caller's
 *        fact to state.
 * @param {{emptyKey?: string, limit?: number}} [options]
 * @returns {string} HTML
 */
export function stackedBarChart(rows, options) {
  const opts = options || {};
  const all = Array.isArray(rows) ? rows.filter((r) => r && r.value > 0) : [];

  if (all.length === 0) {
    return `<div class="chart-empty">${escapeHtml(t(opts.emptyKey || 'no_results'))}</div>`;
  }

  const visible = opts.limit ? all.slice(0, opts.limit) : all;
  const max = Math.max(...visible.map((r) => r.value));

  return `<div class="bar-chart">${visible.map((row) => {
    const segments = (Array.isArray(row.segments) ? row.segments : [])
      .filter((seg) => seg && seg.value > 0);

    return `
    <div class="bar-row">
      <div class="bar-head">
        <span class="bar-label">${escapeHtml(row.label)}</span>
        <span class="bar-value">${escapeHtml(String(row.value))}</span>
      </div>
      <div class="bar-track">
        <div class="bar-stack"
             style="inline-size: ${Math.max(2, Math.round((row.value / max) * 100))}%">
          ${segments.map((seg) => `
            <span class="bar-seg"
                  style="flex: ${seg.value};
                         background: ${colorVar(seg.colorToken)}"
                  ${seg.label ? `title="${escapeHtml(`${seg.label}: ${seg.value}`)}"` : ''}></span>`
    ).join('')}
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

/**
 * A donut with a centred total and a legend beside it.
 *
 * Segments are drawn as pie wedges and a hole is punched with a `--card`
 * coloured circle, rather than as a stroked arc. Both work; this one keeps the
 * maths to two points on a circle and stays crisp at any hole size.
 *
 * A single non-zero segment is drawn as a full ring instead of an arc — an arc
 * sweeping exactly 360° collapses to nothing, because its start and end points
 * are the same coordinate.
 *
 * @param {Array<{label: string, value: number, colorToken: string}>} segments
 * @param {{centerLabelKey?: string, emptyKey?: string}} [options]
 * @returns {string} HTML
 */
export function donutChart(segments, options) {
  const opts = options || {};
  const present = (Array.isArray(segments) ? segments : []).filter((s) => s && s.value > 0);
  const total = present.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return `<div class="chart-empty">${escapeHtml(t(opts.emptyKey || 'no_results'))}</div>`;
  }

  const wedges = present.length === 1
    ? `<circle cx="${DONUT.center}" cy="${DONUT.center}" r="${DONUT.radius}"
               fill="${colorVar(present[0].colorToken)}"/>`
    : present.map(wedge(total)).join('');

  return `
    <div class="donut-wrap">
      <svg class="donut" viewBox="0 0 ${DONUT.size} ${DONUT.size}" role="img"
           aria-label="${escapeHtml(present.map((s) => `${s.label}: ${s.value}`).join(', '))}">
        ${wedges}
        <circle cx="${DONUT.center}" cy="${DONUT.center}" r="${DONUT.hole}" fill="var(--card)"/>
        <text class="donut-total" x="${DONUT.center}" y="${DONUT.center - 2}"
              text-anchor="middle">${escapeHtml(String(total))}</text>
        ${opts.centerLabelKey ? `
          <text class="donut-caption" x="${DONUT.center}" y="${DONUT.center + 13}"
                text-anchor="middle">${escapeHtml(t(opts.centerLabelKey))}</text>` : ''}
      </svg>

      <div class="donut-legend">
        ${present.map((s) => `
          <div class="legend-row">
            <span class="legend-dot" style="background: ${colorVar(s.colorToken)}"></span>
            <span class="legend-label">${escapeHtml(s.label)}</span>
            <b class="legend-value">${escapeHtml(String(s.value))}</b>
          </div>`).join('')}
      </div>
    </div>`;
}

/**
 * Closure over the running total, so each wedge knows where the previous one
 * ended. Returned as a mapper because the accumulator has to survive the
 * iteration.
 *
 * @param {number} total
 * @returns {function(Object): string}
 */
function wedge(total) {
  let consumed = 0;

  return (segment) => {
    const fraction = segment.value / total;
    const from = arcPoint(consumed);
    const to = arcPoint(consumed + fraction);
    const largeArc = fraction > 0.5 ? 1 : 0;
    consumed += fraction;

    return `<path d="M ${DONUT.center} ${DONUT.center} L ${from} A ${DONUT.radius} ${DONUT.radius} `
      + `0 ${largeArc} 1 ${to} Z" fill="${colorVar(segment.colorToken)}"/>`;
  };
}

/** A point on the donut's rim, at `fraction` of the way round from 12 o'clock. */
function arcPoint(fraction) {
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  const x = DONUT.center + DONUT.radius * Math.cos(angle);
  const y = DONUT.center + DONUT.radius * Math.sin(angle);
  return `${round(x)} ${round(y)}`;
}

/** Three decimals is well under a pixel at this size and keeps the path short. */
function round(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * A labelled progress bar — a headline figure measured against a target, which
 * is what the RDT coverage card needs and no chart shape above expresses.
 *
 * The fill is capped at 100% of the track while the caption keeps the true
 * figure, so overshooting the target reads as "done", not as a bar running off
 * the card.
 *
 * @param {{value: number, target: number, caption: string, colorToken?: string}} spec
 * @returns {string} HTML
 */
export function targetBar(spec) {
  const target = spec.target > 0 ? spec.target : 100;
  const pct = Math.max(0, Math.min(100, Math.round((spec.value / target) * 100)));

  return `
    <div class="target-bar">
      <div class="bar-track">
        <div class="bar-fill" style="inline-size: ${pct}%;
             background: ${colorVar(spec.colorToken)}"></div>
      </div>
      <div class="target-caption">${escapeHtml(spec.caption)}</div>
    </div>`;
}
