/* ==========================================================================
   topbar.js — the admin shell's page header: title on the leading edge,
   page actions on the trailing edge.

   Deliberately dumb about *page* actions. It renders what it is handed and
   binds none of them: they belong to the page that supplied them, so that page
   binds them in its own bind*Events function. Otherwise every new button in the
   app would need a line in this file.

   In practice `actionsHtml` arrives holding only the shell's own Refresh button
   and the rest of the trailing edge is filled after the fact: a page marks its
   buttons [data-topbar-actions] and render.js moves them into .topbar-actions
   once the page has bound them (hoistPageActions). Because those are appended,
   Refresh sits on the inner side and a page's primary button keeps the outer
   edge, which is where the eye goes for it.

   Refresh is the one action drawn *and* bound here, because it belongs to no
   page — it is the shell's, and it applies to whichever page is standing in it.
   ========================================================================== */

import { escapeHtml } from '../utils/format.js';
import { clearPageCaches } from '../state.js';
import { t } from '../i18n/i18n.js';
import { toastSuccess } from '../components/toast.js';
import { render } from '../render.js';

/**
 * The shell's own trailing-edge action.
 *
 * Icon plus a label rather than a bare glyph: the sidebar can afford icon-only
 * navigation because those items never change, but a button that silently
 * throws away what is on screen and refetches it should say what it does.
 *
 * @returns {string} HTML
 */
function renderRefreshButton() {
  const label = escapeHtml(t('refresh'));

  // The label is wrapped rather than left as a bare text node so the narrow
  // layout can hide it (layout.css). aria-label carries it either way — CSS
  // takes the text out of the accessibility tree along with the pixels.
  return `
    <button type="button" class="btn btn-ghost btn-sm topbar-refresh"
            data-action="refresh" aria-label="${label}"
            title="${escapeHtml(t('refresh_hint'))}">
      <span class="ic" aria-hidden="true">⟳</span><span>${label}</span>
    </button>`;
}

/**
 * @param {string} title already translated, plain text
 * @param {string} [actionsHtml] markup for the trailing-edge buttons; the shell's
 *                               Refresh button is drawn ahead of whatever is passed
 * @returns {string} HTML
 */
export function renderTopbar(title, actionsHtml) {
  return `
    <div class="topbar">
      <div class="title">${escapeHtml(title)}</div>
      <div class="topbar-actions">${renderRefreshButton()}${actionsHtml || ''}</div>
    </div>`;
}

/**
 * Bind the shell's Refresh button.
 *
 * Dropping the caches and redrawing is the whole of it. Every page's
 * `ensureData` starts a fetch when it finds no cached state, so the redraw is
 * what triggers the refetch — this never calls the API itself, and so needs to
 * know nothing about which page it is refreshing or what that page loads.
 *
 * The render.js import is circular (render.js draws this topbar), which is the
 * same shape router.js already has with it and works for the same reason:
 * `render` is a hoisted function declaration and is only ever called from a
 * click, long after both modules have finished evaluating.
 */
export function bindTopbarEvents() {
  const btn = document.querySelector('.topbar [data-action="refresh"]');
  if (!btn) return;

  btn.addEventListener('click', () => {
    clearPageCaches();
    render();

    // The page often redraws to something that looks identical — same rows, in
    // the same order — so without a word it reads as a button that did nothing.
    toastSuccess(t('refreshed_ok'));
  });
}
