/* ==========================================================================
   officer/pages/officerHomePage.js — search and Recent (Section 7.5).

   Route '#/check/home'. The officer's whole workflow starts here: type, tap,
   read the verdict.

   Search runs entirely against the cached snapshot — no network call, cache
   first (rule 17). The results come from every module's `searchEntities`
   merged into one list (Section 5.6), so this page never learns what an
   employee or a serial number is.

   ---- Why the results are patched in place ----

   Rebuilding #app on every keystroke is exactly how OHS-DB lost focus on every
   letter typed. render.js does restore focus and caret for any input with a
   stable id, so a full redraw would work — but on a phone it also rebuilds the
   header, the sync strip and the whole result list forty times a word. Here the
   input keeps its own DOM node and only the results container is rewritten,
   which is the other option the rule allows and the cheaper one.
   ========================================================================== */

import { UI } from '../../../state.js';
import { t } from '../../../i18n/i18n.js';
import { escapeHtml, initials } from '../../../utils/format.js';
import { go } from '../../../router.js';
import { getCachedSnapshot } from '../cache.js';
import { loadOfficerSnapshot, loadOfficerOutbox, officerFlushOutbox } from '../dataActions.js';
import { pendingCount, installOutboxAutoFlush } from '../outbox.js';
import { searchAllEntities, resolveEntity } from '../search.js';
import { toast, toastSuccess } from '../../../components/toast.js';
import { render } from '../../../render.js';

/** How many entries the Recent list keeps (Section 7.5). */
const RECENT_LIMIT = 5;

/**
 * Don't re-attempt an automatic flush more often than this.
 *
 * `bind()` runs on every draw, and a page with a stubborn queue would otherwise
 * hammer the server once per keystroke in the search box. The officer always has
 * the Retry button, which ignores the cooldown.
 */
const AUTO_FLUSH_COOLDOWN_MS = 30000;
let lastAutoFlush = 0;

/**
 * The pending count the current DOM was drawn with, so a redraw only happens
 * when it actually changed.
 *
 * This is not an optimisation. `render()` re-runs `bind()`, so a bind that
 * redraws unconditionally after an async read never stops.
 */
let drawnPendingCount = 0;

/**
 * Read the outbox into memory and redraw only if the banner would now differ.
 *
 * @returns {Promise<void>}
 */
function redrawIfPendingChanged() {
  return loadOfficerOutbox()
    .then(() => {
      if (pendingCount() === drawnPendingCount) return;

      drawnPendingCount = pendingCount();
      render();
    })
    .catch((err) => console.error('[officer] cannot read the outbox:', err));
}

/** The live query, kept on UI so it survives a redraw and dies with the session. */
function query() {
  return UI.officerSearch || '';
}

/**
 * The Recent list: [{kind, id}], newest first, memory only.
 *
 * Stored as references rather than as rendered rows so each draw re-reads the
 * current verdict from the snapshot — a card the officer refreshed a minute ago
 * shows its new colour here too.
 */
function recentRefs() {
  if (!Array.isArray(UI.officerRecent)) UI.officerRecent = [];
  return UI.officerRecent;
}

/** Record a lookup. Called when the officer opens a verdict card. */
export function rememberLookup(kind, id) {
  const refs = recentRefs().filter((ref) => !(ref.kind === kind && ref.id === id));
  refs.unshift({ kind, id });
  UI.officerRecent = refs.slice(0, RECENT_LIMIT);
}

/* ---------- Rendering ----------------------------------------------------- */

/**
 * One tappable row. `verdict` is server-derived; this only picks a colour.
 *
 * The avatar is a module's own glyph when it supplies one and initials
 * otherwise. Initials read well for a person and badly for a thing — "Harness ·
 * 3M" would come out as "H·" — so equipment sends an icon instead, and a mixed
 * result list stays scannable as people-versus-gear at a glance.
 */
function resultItem(result) {
  const verdict = ['cleared', 'warning', 'blocked'].includes(result.verdict)
    ? result.verdict
    : 'blocked';

  return `
    <button type="button" class="result-item" data-kind="${escapeHtml(result.kind)}" data-id="${escapeHtml(result.id)}">
      <span class="avatar">${escapeHtml(result.avatar || initials(result.primary_text))}</span>
      <span class="result-info">
        <span class="result-name">${escapeHtml(result.primary_text)}</span>
        <span class="result-meta">${escapeHtml(result.secondary_text || '')}</span>
      </span>
      <span class="v-dot v-${verdict}" aria-label="${escapeHtml(t('verdict_' + verdict))}"></span>
    </button>`;
}

/** An icon-led empty state. */
function emptyState(icon, message) {
  return `
    <div class="officer-empty">
      <div class="big" aria-hidden="true">${icon}</div>
      <div>${escapeHtml(message)}</div>
    </div>`;
}

/**
 * The results area: search hits when there is a query, Recent when there is
 * not, and an empty state when neither has anything.
 *
 * @returns {string} HTML — the inner content of #off-results
 */
function renderResults() {
  const snapshot = getCachedSnapshot();
  const q = query().trim();

  if (q) {
    const results = searchAllEntities(q, snapshot);
    if (results.length === 0) return emptyState('–', t('off_no_results'));

    return `
      <div class="section-h">${escapeHtml(t('off_results'))}</div>
      <div class="result-list">${results.map(resultItem).join('')}</div>`;
  }

  const recent = recentRefs()
    .map((ref) => resolveEntity(ref, snapshot))
    .filter(Boolean);

  if (recent.length === 0) return emptyState('🔎', t('off_search_hint'));

  return `
    <div class="section-h">${escapeHtml(t('off_recent'))}</div>
    <div class="result-list">${recent.map(resultItem).join('')}</div>`;
}

/**
 * The unsent-waves banner.
 *
 * Shown whenever anything is queued, on the screen the officer passes through
 * most. A wave sitting on a phone is not on the record, and the officer is the
 * only person who can do anything about it — so it says how many, and offers the
 * retry rather than waiting for the next automatic attempt.
 */
function renderPendingBanner() {
  const count = pendingCount();
  if (count === 0) return '';

  return `
    <div class="banner banner-warn officer-pending">
      <span>${escapeHtml(t('off_wave_pending_banner', { count }))}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-action="retry-uploads">
        ${escapeHtml(t('off_wave_retry'))}
      </button>
    </div>`;
}

export function renderOfficerHomePage() {
  const q = query();

  return `
    <div class="officer-body">
      ${renderPendingBanner()}

      <div class="search-box">
        <span class="ic" aria-hidden="true">🔍</span>
        <input id="off-search" type="search" inputmode="search"
               autocomplete="off" autocapitalize="none" spellcheck="false"
               placeholder="${escapeHtml(t('off_search_placeholder'))}"
               value="${escapeHtml(q)}"
               aria-label="${escapeHtml(t('search'))}">
        <button type="button" class="search-clear${q ? '' : ' is-hidden'}"
                data-action="clear-search"
                aria-label="${escapeHtml(t('off_clear_search'))}">×</button>
      </div>

      <div id="off-results">${renderResults()}</div>
    </div>`;
}

export function bindOfficerHomePageEvents() {
  const root = document.querySelector('.officer-body');
  if (!root) return;

  const input = root.querySelector('#off-search');
  const resultsEl = root.querySelector('#off-results');
  const clearBtn = root.querySelector('[data-action="clear-search"]');

  /** Rewrite only the results, leaving the input node (and its caret) alone. */
  function refreshResults() {
    resultsEl.innerHTML = renderResults();
    clearBtn.classList.toggle('is-hidden', !query());
  }

  input.addEventListener('input', () => {
    UI.officerSearch = input.value;
    refreshResults();
  });

  clearBtn.addEventListener('click', () => {
    UI.officerSearch = '';
    input.value = '';
    refreshResults();
    input.focus();
  });

  // Delegated, so patching innerHTML above never leaves a dead row behind.
  resultsEl.addEventListener('click', (event) => {
    const item = event.target.closest('.result-item');
    if (!item) return;

    const { kind, id } = item.dataset;
    rememberLookup(kind, id);
    go('check/' + kind + '/:id', { id });
  });

  // The snapshot may not be in memory yet on the first draw after a reload —
  // read it, then redraw so the results appear (see cache.js on the split
  // between the synchronous page() and the asynchronous store).
  if (!getCachedSnapshot()) {
    loadOfficerSnapshot()
      .then((snapshot) => {
        if (snapshot) render();
      })
      .catch((err) => console.error('[officer] cannot read the cached snapshot:', err));
  }

  /* ---- The outbox ---- */

  // Landing on home is the most reliable moment an officer is holding the phone
  // and might have signal again, so it is where a queued wave gets its chance.
  installOutboxAutoFlush(() => redrawIfPendingChanged());

  // render() re-runs bind(), so anything here that redraws unconditionally is an
  // infinite loop. Both the load and the flush redraw only when the count they
  // are showing actually moved.
  redrawIfPendingChanged();

  if (pendingCount() > 0 && Date.now() - lastAutoFlush > AUTO_FLUSH_COOLDOWN_MS) {
    lastAutoFlush = Date.now();

    officerFlushOutbox()
      .then((result) => {
        if (result.sent > 0) toastSuccess(t('off_wave_flush_sent', { count: result.sent }));
        if (result.failed > 0) toast(t('off_wave_flush_failed', { count: result.failed }), 'error');
        redrawIfPendingChanged();
      })
      .catch((err) => console.error('[officer] outbox flush on home failed:', err));
  }

  const retryBtn = root.querySelector('[data-action="retry-uploads"]');
  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      try {
        const result = await officerFlushOutbox();

        if (result.sent > 0) toastSuccess(t('off_wave_flush_sent', { count: result.sent }));
        else if (result.offline) toast(t('off_wave_flush_offline'), 'warn');
        if (result.failed > 0) toast(t('off_wave_flush_failed', { count: result.failed }), 'error');
      } finally {
        render();
      }
    });
  }
}
