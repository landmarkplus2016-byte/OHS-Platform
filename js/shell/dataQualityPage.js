/* ==========================================================================
   dataQualityPage.js — the record-integrity worklist (Section 3.10).

   WHAT THIS SCREEN IS FOR
   -----------------------
   Every record on the platform that contradicts itself or is missing something
   it should carry. It is the page you open to answer "what is wrong with our
   data", and it is deliberately not the page that answers "who may work today"
   — that is the dashboard and the verdict cards, and a finding here never
   changes either of them.

   Two severities, and the split is a real distinction rather than a priority
   guess:

     contradiction  the record disagrees with itself. Something is definitely
                    wrong here, whoever looks at it.
     gap            something is not recorded. It may be an oversight or it may
                    be fine; the platform cannot tell, and says so.

   GROUPED BY CHECK, NOT BY RECORD
   -------------------------------
   The same cleanup is nearly always the same fix repeated. Thirty-six blank
   certificates is one afternoon's work when they are listed together and a
   scavenger hunt when they are scattered across thirty-six employees. So the
   page groups by check and lists the records under each.

   EVERY ROW IS A LINK
   -------------------
   A finding carries the route to the form that fixes it. A page that tells you
   what is wrong and then makes you go and find it is a page nobody works
   through — that is the difference between this and an export.

   WHAT IT WILL NEVER GROW
   -----------------------
   A bulk-fix button. The fix differs per record and is a judgement only
   somebody who knows the roster can make: a blank MCU resolves either to "enter
   the medical" or to "tick N/A", and a button picking one would invent that
   answer across the whole roster (Section 3.10).
   ========================================================================== */

import { UI } from '../state.js';
import { go } from '../router.js';
import { render } from '../render.js';
import { t } from '../i18n/i18n.js';
import { escapeHtml } from '../utils/format.js';
import { hasAnyViewPermission } from '../utils/permissions.js';
import { toastError } from '../components/toast.js';
import { api } from '../api.js';

/** Findings shown per check before the group collapses behind a "show all". */
const GROUP_PREVIEW_LIMIT = 8;

function pageState() {
  if (!UI.dataQuality) {
    UI.dataQuality = {
      status: 'idle',
      seq: 0,
      data: null,
      error: null,
      severity: '',      // '' | 'contradiction' | 'gap'
      expanded: {},      // check → true, for groups the admin opened
    };
  }
  return UI.dataQuality;
}

/**
 * Drop the cached findings so the next render refetches.
 *
 * Exported because every write anywhere on the platform can resolve a finding —
 * an employee edit, an archive, a wave approval. Rather than have each of those
 * pages know about this one, the topbar Refresh button and a fresh navigation
 * both land here. Callers that already know they fixed something may call it
 * directly.
 */
export function invalidateDataQuality() {
  const s = pageState();
  s.status = 'idle';
  s.data = null;
}

/* ---------- Data ---------------------------------------------------------- */

async function ensureData() {
  const s = pageState();

  // `error` is in this guard deliberately, and it is the difference between a
  // failed load and a retry storm. bind runs on every render(), ensureData
  // renders when it fails, and a guard that let `error` through would fetch →
  // fail → render → fetch forever, against a rate-limited backend (Section 3.9)
  // that would start returning 429 and never stop being asked.
  //
  // Recovery is explicit instead: the Retry button below, the topbar Refresh,
  // or navigating away and back.
  if (s.status === 'loading' || s.status === 'ready' || s.status === 'error') return;

  const mySeq = ++s.seq;
  s.status = 'loading';
  s.error = null;
  render();

  try {
    // Deliberately unpaged: the whole point is to see the size of the problem,
    // and the server caps at 500. A roster that ever produces more than that
    // has a bigger issue than this page's scroll length.
    const data = await api.call('list_data_issues', { page_size: 500 });
    if (mySeq !== s.seq) return;

    s.data = data;
    s.status = 'ready';
  } catch (err) {
    if (mySeq !== s.seq) return;

    s.status = 'error';
    s.error = err;
    console.error('[data-quality] load failed:', err);
    toastError(err);
  }

  render();
}

/* ---------- Rendering ----------------------------------------------------- */

/** The two severity counts, plus an all-clear when both are zero. */
function renderSummary(data) {
  const counts = data.counts || {};
  const contradictions = counts.contradiction || 0;
  const gaps = counts.gap || 0;

  if (contradictions === 0 && gaps === 0) {
    return `
      <div class="card dq-summary is-clear">
        <div class="dq-clear">${escapeHtml(t('dq_all_clear'))}</div>
      </div>`;
  }

  const s = pageState();
  const tile = (key, value, tone) => `
    <button class="dq-tile ${tone}${s.severity === key ? ' is-active' : ''}"
            data-dq-severity="${escapeHtml(key)}">
      <span class="dq-tile-value">${value}</span>
      <span class="dq-tile-label">${escapeHtml(t('dq_severity_' + key))}</span>
    </button>`;

  return `
    <div class="card dq-summary">
      <div class="dq-tiles">
        ${tile('contradiction', contradictions, 'is-blocked')}
        ${tile('gap', gaps, 'is-warning')}
        <button class="dq-tile${s.severity === '' ? ' is-active' : ''}" data-dq-severity="">
          <span class="dq-tile-value">${contradictions + gaps}</span>
          <span class="dq-tile-label">${escapeHtml(t('dq_severity_all'))}</span>
        </button>
      </div>
      <div class="dq-summary-note">${escapeHtml(t('dq_summary_note'))}</div>
    </div>`;
}

/** One finding row: what is wrong, on which record, linking to the fix. */
function renderFinding(finding) {
  return `
    <button class="dq-row" data-dq-route="${escapeHtml(finding.edit_route)}">
      <span class="dq-row-entity">
        <span class="dq-row-label">${escapeHtml(finding.entity_label || finding.entity_id)}</span>
        <span class="dq-row-id">${escapeHtml(finding.entity_id)}</span>
      </span>
      <span class="dq-row-text">${escapeHtml(t(finding.text_key, finding.text_params || {}))}</span>
      <span class="dq-row-go" aria-hidden="true">›</span>
    </button>`;
}

/**
 * One check's group: a heading with its count, then its records.
 *
 * Long groups collapse to a preview because the header count is the number that
 * matters — an admin deciding what to work on needs "36 blank certificates",
 * not thirty-six names before the next heading.
 */
function renderGroup(check, findings) {
  const s = pageState();
  const expanded = s.expanded[check] === true;
  const shown = expanded ? findings : findings.slice(0, GROUP_PREVIEW_LIMIT);
  const hidden = findings.length - shown.length;

  const severity = findings[0].severity;
  const more = hidden > 0
    ? `<button class="dq-more" data-dq-expand="${escapeHtml(check)}">${
        escapeHtml(t('dq_show_all', { count: hidden }))
      }</button>`
    : '';

  const collapse = expanded && findings.length > GROUP_PREVIEW_LIMIT
    ? `<button class="dq-more" data-dq-expand="${escapeHtml(check)}">${
        escapeHtml(t('dq_show_fewer'))
      }</button>`
    : '';

  return `
    <section class="card dq-group">
      <div class="dq-group-head">
        <span class="badge ${severity === 'contradiction' ? 'is-blocked' : 'is-warning'}">${
          escapeHtml(t('dq_severity_' + severity))
        }</span>
        <span class="dq-group-title">${escapeHtml(t('dq_check_' + check))}</span>
        <span class="dq-group-count">${findings.length}</span>
      </div>
      <div class="dq-group-why">${escapeHtml(t('dq_why_' + check))}</div>
      <div class="dq-rows">${shown.map(renderFinding).join('')}</div>
      ${more}${collapse}
    </section>`;
}

/**
 * The N/A pattern note (Section 3.10).
 *
 * The checks are forbidden from asserting that an N/A flag is wrong, because
 * that is not mechanically decidable. But the shape of the data is worth
 * showing: a human who knows the roster reads "6 Site Engineers have their
 * medical marked N/A" in a second, and the platform cannot read it at all.
 */
function renderPatterns(data) {
  const patterns = (data.patterns && data.patterns.employees) || null;
  const byTitle = patterns && patterns.mcu_na_by_title;
  if (!byTitle) return '';

  const rows = Object.keys(byTitle)
    .map((title) => ({ title, count: byTitle[title] }))
    .sort((a, b) => b.count - a.count);

  if (!rows.length) return '';

  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return `
    <section class="card dq-patterns">
      <div class="section-head">${escapeHtml(t('dq_patterns_title', { count: total }))}</div>
      <div class="dq-patterns-note">${escapeHtml(t('dq_patterns_note'))}</div>
      <div class="dq-pattern-rows">
        ${rows.map((row) => `
          <div class="dq-pattern-row">
            <span>${escapeHtml(row.title)}</span>
            <span class="dq-pattern-count">${row.count}</span>
          </div>`).join('')}
      </div>
    </section>`;
}

/** @returns {string} HTML */
export function renderDataQualityPage() {
  const s = pageState();

  const head = `
    <div class="page-head">
      <div>
        <div class="page-head-sub">${escapeHtml(t('dq_subtitle'))}</div>
      </div>
    </div>`;

  if (!hasAnyViewPermission()) {
    return `<div class="data-quality">${head}
      <div class="page-placeholder">${escapeHtml(t('dq_no_modules'))}</div></div>`;
  }

  if (s.status === 'loading' || s.status === 'idle') {
    return `<div class="data-quality">${head}
      <div class="page-placeholder">${escapeHtml(t('loading'))}</div></div>`;
  }

  if (s.status === 'error') {
    return `<div class="data-quality">${head}
      <div class="page-placeholder">
        <div>${escapeHtml(t('dq_load_failed'))}</div>
        <button class="btn-primary" data-dq-retry>${escapeHtml(t('dq_retry'))}</button>
      </div></div>`;
  }

  const data = s.data || {};
  const findings = data.findings || [];

  // Group by check, preserving the server's sort — contradictions first, then
  // by check, so the groups come out in severity order without a second sort.
  const order = [];
  const groups = {};
  findings.forEach((finding) => {
    if (s.severity !== '' && finding.severity !== s.severity) return;
    if (!groups[finding.check]) {
      groups[finding.check] = [];
      order.push(finding.check);
    }
    groups[finding.check].push(finding);
  });

  const body = order.length
    ? order.map((check) => renderGroup(check, groups[check])).join('')
    : `<div class="page-placeholder">${escapeHtml(t('dq_none_in_filter'))}</div>`;

  return `
    <div class="data-quality">
      ${head}
      ${renderSummary(data)}
      ${body}
      ${renderPatterns(data)}
    </div>`;
}

/* ---------- Events -------------------------------------------------------- */

export function bindDataQualityPageEvents() {
  const root = document.querySelector('.data-quality');
  if (!root) return;

  ensureData();

  // The only way out of the error state, since ensureData refuses to retry on
  // its own. Explicit beats automatic here: a person pressing a button knows
  // they are asking again, and a loop does not.
  const retry = root.querySelector('[data-dq-retry]');
  if (retry) {
    retry.addEventListener('click', () => {
      invalidateDataQuality();
      render();
    });
  }

  root.querySelectorAll('[data-dq-severity]').forEach((el) => {
    el.addEventListener('click', () => {
      const s = pageState();
      s.severity = el.getAttribute('data-dq-severity') || '';
      render();
    });
  });

  root.querySelectorAll('[data-dq-expand]').forEach((el) => {
    el.addEventListener('click', () => {
      const s = pageState();
      const check = el.getAttribute('data-dq-expand');
      s.expanded[check] = !s.expanded[check];
      render();
    });
  });

  // Straight to the form that fixes it. The finding is not marked resolved
  // here — it disappears on the next load because the underlying record
  // changed, which is the only signal that can be trusted (rule 13's spirit:
  // the server decides what is true, the page displays it).
  root.querySelectorAll('[data-dq-route]').forEach((el) => {
    el.addEventListener('click', () => {
      invalidateDataQuality();
      go(el.getAttribute('data-dq-route'));
    });
  });
}
