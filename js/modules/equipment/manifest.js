/* ==========================================================================
   equipment/manifest.js — how the equipment module introduces itself to the
   shell (Section 5.2).

   Same shape as the employee manifest, a different group. The two modules share
   no code and never import from each other (rule 12); the only thing they have
   in common is that the shell reads both the same way.

   Stage 4 registers placeholder pages. Stage 7 swaps them for ./pages/.
   ========================================================================== */

import { MODULE_NAMES } from '../../constants/globals.js';
import { t } from '../../i18n/i18n.js';

/** Temporary Stage 4 page body. Removed when the real pages land in Stage 7. */
function placeholder(key) {
  return `<div class="page-placeholder">${t(key)}</div>`;
}

export const manifest = {
  name: MODULE_NAMES.EQUIPMENT,
  displayNameKey: 'module_equipment',
  group: 'EQUIPMENT',

  routes: [
    { path: 'equipment',          page: () => placeholder('placeholder_equipment_active') },
    { path: 'equipment/rejected', page: () => placeholder('placeholder_equipment_rejected') },
  ],

  sidebar: [
    { labelKey: 'nav_equipment_active',   route: 'equipment',          icon: '▣' },
    { labelKey: 'nav_equipment_rejected', route: 'equipment/rejected', icon: '✕' },
  ],
};
