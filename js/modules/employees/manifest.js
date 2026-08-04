/* ==========================================================================
   employees/manifest.js — how the employee module introduces itself to the
   shell (Section 5.2).

   The shell knows nothing about employees beyond what is in this object. It
   reads `routes` to build the route table, `sidebar` to build the nav, and
   `group` to decide which header those nav items sit under.

   Stage 4 registers the module with placeholder pages so the shell can be built
   and navigated against something real. Stage 5 swaps every `page` below for
   the actual renderer from ./pages/ — nothing else in this file changes, and
   nothing outside this file changes either. That is the point of the manifest.
   ========================================================================== */

import { MODULE_NAMES } from '../../constants/globals.js';
import { t } from '../../i18n/i18n.js';

/** Temporary Stage 4 page body. Removed when the real pages land in Stage 5. */
function placeholder(key) {
  return `<div class="page-placeholder">${t(key)}</div>`;
}

export const manifest = {
  name: MODULE_NAMES.EMPLOYEES,
  displayNameKey: 'module_employees',
  group: 'EMPLOYEES',

  routes: [
    { path: 'field',     page: () => placeholder('placeholder_employees_field') },
    { path: 'safety',    page: () => placeholder('placeholder_employees_safety') },
    { path: 'renewals',  page: () => placeholder('placeholder_employees_renewals') },
    { path: 'rdt',       page: () => placeholder('placeholder_employees_rdt') },
    { path: 'resigned',  page: () => placeholder('placeholder_employees_resigned') },
  ],

  sidebar: [
    { labelKey: 'nav_field_team',  route: 'field',    icon: '⚙' },
    { labelKey: 'nav_safety_team', route: 'safety',   icon: '⛑' },
    { labelKey: 'nav_renewals',    route: 'renewals', icon: '⏱' },
    { labelKey: 'nav_rdt',         route: 'rdt',      icon: '⚕' },
    { labelKey: 'nav_resigned',    route: 'resigned', icon: '⊘' },
  ],
};
