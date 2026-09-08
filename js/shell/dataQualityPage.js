/* ==========================================================================
   dataQualityPage.js — the record-integrity worklist (Section 3.10).

   WHAT THIS SCREEN IS FOR
   -----------------------
   Every record on the platform that contradicts itself or is missing something
   it should carry. It is the page you open to answer "what is wrong with our
   data", and deliberately not the page that answers "who may work today" — a
   finding here never changes a verdict.

   Two severities, and the split is a real distinction rather than a priority
   guess:

     contradiction  the record disagrees with itself. Something is definitely
                    wrong here, whoever looks at it.
     gap            something is not recorded. It may be an oversight or it may
                    be fine; the platform cannot tell, and says so.

   WHY IT LOOKS LIKE EVERY OTHER LIST
   ----------------------------------
   Filter bar, then `table.tbl`, then a pager — the same three pieces as Field
   Team, Active Equipment and the wave log, built from the same classes. This
   page is a list of records with a problem, which is the same shape as a list
   of employees with a certificate state, and an admin should not have to learn
   a second way of reading a table. The check is a filter, not a layout.

   EVERY ROW IS A LINK
   -------------------
   A finding carries the route to the form that fixes it, so the row and its
   action button both go straight there. A page that tells you what is wrong
   and then makes you go and find it is a page nobody works through.

   WHAT IT WILL NEVER GROW
   -----------------------
   A bulk-fix button. The fix differs per record and is a judgement only
   somebody who knows the roster can make: a blank MCU resolves either to
   "enter the medical" or to "tick N/A", and a button picking one would invent
   that answer across the whole roster (Section 3.10).
   ========================================================================== */

import { UI } from '../state.js';
import { go } from '../router.js';
import { render } from '../render.js';
import { t } from '../i18n/i18n.js';
import { escapeHtml } from '../utils/format.js';
import { hasAnyViewPermission } from '../utils/permissions.js';
import { toastError } from '../components/toast.js';
import { api } from '../api.js';

/** Findings per page. Matches the other admin lists. */
const PAGE_SIZE = 50;

function pageState() {
  if (!UI.dataQuality) {
    UI.dataQuality = {
      status: 'idle',
      seq: 0,
      data: null,
      error: null,
      severity: '',       // '' | 'contradiction' | 'gap'
      check: '',          // '' | a check name
      search: '',
      page: 1,
      checkOptions: null, // held from the first unfiltered load
    };
  }
  return UI.dataQuality;
}

/**
 * Drop the cached findings so the next render refetches.
 *
 * Exported because a write anywhere on the platform can resolve a finding — an
 * employee edit, an archive, a wave approval. Rather than have every page know
 * about this one, navigating here fresh and the topbar Refresh both land here.
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
  // fail → render → fetch forever against a rate-limited backend (Section 3.9).
  // Recovery is the explicit Retry in the empty row.
  if (s.status === 'loading' || s.status === 'ready' || s.status === 'error') return;

  const mySeq = ++s.seq;
  s.status = 'loading';
  s.error = null;
  render();

  try {
    // Severity and check filter server-side, so `total_matching` describes the
    // filtered set exactly as it does on the employee list.
    const data = await api.call('list_data_issues', {
      severity: s.severity || undefined,
      check: s.check || undefined,
      page: s.page,
      page_size: PAGE_SIZE,
    });
    if (mySeq !== s.seq) return;

    s.data = data;
    s.status = 'ready';

    // Hold the full check list from the first unfiltered load. Without this,
    // picking a check would shrink the dropdown to that one option, stranding
    // the admin with no way back to the others.
    if (!s.check && !s.severity && data.by_check) {
      s.checkOptions = Object.keys(data.by_check).sort();
    }
  } catch (err) {
    if (mySeq !== s.seq) return;

    s.status = 'error';
    s.error = err;
    console.error('[data-quality] load failed:', err);
    toastError(err);
  }

  render();
}

/** Refetch from page 1 — for any filter change. */
function applyFilters() {
  const s = pageState();
  s.page = 1;
  s.status = 'idle';
  s.data = null;
  ensureData();
}

/**
 * The findings to draw: the loaded page, narrowed by the search box.
 *
 * Search filters in place rather than refetching, because it matches within the
 * page the admin is already looking at and a round trip per keystroke would be
 * slower and noisier than the filter is worth. Severity and check go to the
 * server, because those change which findings exist at all.
 */
function visibleFindings(s) {
  const all = (s.data && s.data.findings) || [];
  const needle = s.search.trim().toLowerCase();
  if (needle === '') return all;

  return all.filter((f) => (
    (f.entity_label || '').toLowerCase().indexOf(needle) !== -1 ||
    (f.entity_id || '').toLowerCase().indexOf(needle) !== -1
  ));
}

/* ---------- Rendering ----------------------------------------------------- */

function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${
    escapeHtml(label)
  }</option>`;
}

/** The check dropdown, listing only checks that actually have findings. */
function renderCheckOptions(s) {
  const known = s.checkOptions || [];
  return option('', t('dq_filter_all_checks'), s.check)
    + known.map((c) => option(c, t('dq_check_' + c), s.check)).join('');
}

/** The filter bar. Same pieces as every other list: search, selects, count. */
function renderFilters(s) {
  const total = s.data ? s.data.total_matching : 0;
  const shown = visibleFindings(s).length;

  return `
    <div class="filter-bar">
      <div class="field filter-search">
        <label for="dq-search">${escapeHtml(t('search'))}</label>
        <input id="dq-search" type="search" autocomplete="off" spellcheck="false"
               placeholder="${escapeHtml(t('dq_search_placeholder'))}"
               value="${escapeHtml(s.search)}">
      </div>

      <div class="field">
        <label for="dq-filter-severity">${escapeHtml(t('dq_filter_severity'))}</label>
        <select id="dq-filter-severity" data-filter="severity">
          ${option('', t('filter_all'), s.severity)}
          ${option('contradiction', t('dq_severity_contradiction'), s.severity)}
          ${option('gap', t('dq_severity_gap'), s.severity)}
        </select>
      </div>

      <div class="field">
        <label for="dq-filter-check">${escapeHtml(t('dq_filter_check'))}</label>
        <select id="dq-filter-check" data-filter="check">
          ${renderCheckOptions(s)}
        </select>
      </div>

      <div class="count">${escapeHtml(t('showing_count', { shown, total }))}</div>
    </div>`;
}

/** The severity badge, using the same badge classes as every other list. */
function severityBadge(severity) {
  const cls = severity === 'contradiction' ? 'badge-blocked' : 'badge-warning';
  return `<span class="badge ${cls}">${escapeHtml(t('dq_severity_' + severity))}</span>`;
}

/**
 * One finding row.
 *
 * The "why it matters" sentence sits under the issue name as a `cell-sub`, the
 * same way the employee list puts the record id under the name. It is the line
 * that turns a field name into a decision, and it belongs beside the finding
 * rather than in a paragraph above the table.
 */
function renderRow(finding) {
  return `
    <tr class="row-clickable" data-dq-route="${escapeHtml(finding.edit_route)}">
      <td>
        <b>${escapeHtml(finding.entity_label || finding.entity_id)}</b>
        <div class="cell-sub">${escapeHtml(finding.entity_id)}</div>
      </td>
      <td>${severityBadge(finding.severity)}</td>
      <td>
        ${escapeHtml(t('dq_check_' + finding.check))}
        <div class="cell-sub">${escapeHtml(t('dq_why_' + finding.check))}</div>
      </td>
      <td>${escapeHtml(t(finding.text_key, finding.text_params || {}))}</td>
      <td data-stop-row-click>
        <button type="button" class="btn btn-ghost btn-sm"
                data-dq-route="${escapeHtml(finding.edit_route)}">${escapeHtml(t('dq_fix'))}</button>
      </td>
    </tr>`;
}

/** The results table, or the state standing in for it. */
function renderTable(s) {
  const columnCount = 5;

  const header = `
    <thead>
      <tr>
        <th>${escapeHtml(t('dq_col_record'))}</th>
        <th>${escapeHtml(t('dq_col_severity'))}</th>
        <th>${escapeHtml(t('dq_col_issue'))}</th>
        <th>${escapeHtml(t('dq_col_detail'))}</th>
        <th>${escapeHtml(t('actions'))}</th>
      </tr>
    </thead>`;

  if (s.status === 'loading' || s.status === 'idle') {
    return `<table class="tbl">${header}
      <tbody><tr><td colspan="${columnCount}" class="cell-empty">${
        escapeHtml(t('loading_data'))
      }</td></tr></tbody></table>`;
  }

  if (s.status === 'error') {
    return `<table class="tbl">${header}
      <tbody><tr><td colspan="${columnCount}" class="cell-empty">
        ${escapeHtml(t('err_' + ((s.error && s.error.code) || 'server_error')))}
        <button type="button" class="btn btn-ghost btn-sm" data-action="retry">${
          escapeHtml(t('retry'))
        }</button>
      </td></tr></tbody></table>`;
  }

  const rows = visibleFindings(s);
  if (rows.length === 0) {
    const filtered = s.search || s.severity || s.check;
    return `<table class="tbl">${header}
      <tbody><tr><td colspan="${columnCount}" class="cell-empty">
        ${escapeHtml(t(filtered ? 'no_results' : 'dq_all_clear'))}
      </td></tr></tbody></table>`;
  }

  return `<table class="tbl">${header}
    <tbody>${rows.map(renderRow).join('')}</tbody></table>`;
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
 * The N/A pattern note (Section 3.10), below the table.
 *
 * The checks are forbidden from asserting that an N/A flag is wrong, because
 * that is not mechanically decidable. But the shape of the data is worth
 * showing: somebody who knows the roster reads "6 Site Engineers have their
 * medical marked N/A" in a second, and the platform cannot read it at all.
 *
 * Below the worklist rather than above it — it is context, not work, and it
 * must never be the first thing between an admin and the table.
 */
function renderPatterns(s) {
  if (s.status !== 'ready') return '';

  const patterns = (s.data.patterns && s.data.patterns.employees) || null;
  const byTitle = patterns && patterns.mcu_na_by_title;
  if (!byTitle) return '';

  const rows = Object.keys(byTitle)
    .map((title) => ({ title, count: byTitle[title] }))
    .sort((a, b) => b.count - a.count);
  if (!rows.length) return '';

  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return `
    <section class="dq-patterns">
      <div class="section-head">${escapeHtml(t('dq_patterns_title', { count: total }))}</div>
      <div class="dq-patterns-note">${escapeHtml(t('dq_patterns_note'))}</div>
      <table class="tbl">
        <thead>
          <tr>
            <th>${escapeHtml(t('dq_col_title'))}</th>
            <th>${escapeHtml(t('dq_col_count'))}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.title)}</td>
              <td>${row.count}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </section>`;
}

/** @returns {string} HTML */
export function renderDataQualityPage() {
  const s = pageState();

  if (!hasAnyViewPermission()) {
    return `<div class="data-quality">
      <div class="page-placeholder">${escapeHtml(t('dq_no_modules'))}</div></div>`;
  }

  return `
    <div class="data-quality">
      ${renderFilters(s)}
      ${renderTable(s)}
      ${renderPager(s)}
      ${renderPatterns(s)}
    </div>`;
}

/* ---------- Events -------------------------------------------------------- */

export function bindDataQualityPageEvents() {
  const root = document.querySelector('.data-quality');
  if (!root) return;

  ensureData();

  root.querySelectorAll('[data-filter]').forEach((el) => {
    el.addEventListener('change', () => {
      pageState()[el.getAttribute('data-filter')] = el.value;
      applyFilters();
    });
  });

  // Search narrows the loaded page rather than refetching on every keystroke.
  // render.js restores focus and caret from the input's id, so the redraw does
  // not eat what is being typed (Section 9.3).
  const search = root.querySelector('#dq-search');
  if (search) {
    search.addEventListener('input', () => {
      pageState().search = search.value;
      render();
    });
  }

  root.querySelectorAll('[data-page]').forEach((el) => {
    el.addEventListener('click', () => {
      const s = pageState();
      s.page += el.getAttribute('data-page') === 'next' ? 1 : -1;
      s.status = 'idle';
      s.data = null;
      ensureData();
    });
  });

  const retry = root.querySelector('[data-action="retry"]');
  if (retry) {
    retry.addEventListener('click', () => {
      invalidateDataQuality();
      render();
    });
  }

  // Straight to the form that fixes it. The finding is not marked resolved
  // here — it disappears on the next load because the record changed, which is
  // the only signal worth trusting.
  //
  // Both the row and its button carry the route, so the button's own listener
  // handles the click and the row's listener ignores anything inside the
  // actions cell — otherwise one click would navigate twice.
  root.querySelectorAll('[data-dq-route]').forEach((el) => {
    el.addEventListener('click', (event) => {
      if (el.tagName === 'TR' && event.target.closest('[data-stop-row-click]')) return;
      invalidateDataQuality();
      go(el.getAttribute('data-dq-route'));
    });
  });
}
