/* ==========================================================================
   officer/manifest.js — the officer app's routes (Section 7).

   The officer app registers like any other module, but it is not a *permission*
   module: its name is absent from MODULE_NAMES, so the router leaves
   `entry.module` null and never asks canView() about it. Officers are gated by
   role instead — the router pins an officer inside 'check/*' and keeps everyone
   else out of it (Section 7.1: same URL, different shell).

   That is also why there is no `group` and no `sidebar` here. The officer shell
   has no sidebar; it gets a phone frame in Stage 8.

   Stage 4 registers placeholder pages so the guards can be exercised. Stage 8
   swaps them for the real pages in ./pages/.
   ========================================================================== */

import { t } from '../../i18n/i18n.js';

/**
 * Temporary Stage 4 page body. Full-page rather than .page-placeholder, because
 * officer routes render without the admin shell around them.
 */
function placeholder(key) {
  return `<div class="stage-placeholder">${t(key)}</div>`;
}

export const manifest = {
  name: 'officer',
  displayNameKey: 'module_officer',

  routes: [
    { path: 'check/home',          page: () => placeholder('placeholder_officer_home') },
    { path: 'check/sync',          page: () => placeholder('placeholder_officer_sync') },
    { path: 'check/locked',        page: () => placeholder('placeholder_officer_locked') },
    // ':id' is captured into ROUTE_PARAMS and handed to the page function.
    // The placeholders ignore it; the Stage 8 verdict cards read params.id.
    { path: 'check/employee/:id',  page: () => placeholder('placeholder_officer_verdict_employee') },
    { path: 'check/equipment/:id', page: () => placeholder('placeholder_officer_verdict_equipment') },
  ],
};
