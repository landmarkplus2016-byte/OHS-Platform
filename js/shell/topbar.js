/* ==========================================================================
   topbar.js — the admin shell's page header: title on the leading edge,
   page actions on the trailing edge.

   Deliberately dumb. It renders what it is handed and binds nothing: the
   actions belong to the page that supplied them, so that page binds them in its
   own bind*Events function. Otherwise every new button in the app would need a
   line in this file.

   In practice `actionsHtml` arrives empty and the trailing edge is filled after
   the fact: a page marks its buttons [data-topbar-actions] and render.js moves
   them into .topbar-actions once the page has bound them (hoistPageActions).
   The parameter stays because a shell-drawn action would have no page to come
   from, and this is where it would go.
   ========================================================================== */

import { escapeHtml } from '../utils/format.js';

/**
 * @param {string} title already translated, plain text
 * @param {string} [actionsHtml] markup for the trailing-edge buttons
 * @returns {string} HTML
 */
export function renderTopbar(title, actionsHtml) {
  return `
    <div class="topbar">
      <div class="title">${escapeHtml(title)}</div>
      <div class="topbar-actions">${actionsHtml || ''}</div>
    </div>`;
}
