/* ==========================================================================
   topbar.js — the admin shell's page header: title on the leading edge,
   page actions on the trailing edge.

   Deliberately dumb. It renders what it is handed and binds nothing: the
   actions belong to the page that supplied them, so that page binds them in its
   own bind*Events function. Otherwise every new button in the app would need a
   line in this file.
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
