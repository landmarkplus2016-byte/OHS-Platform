/* ==========================================================================
   equipment/manifest.js — how the equipment module introduces itself to the
   shell (Section 5.2).

   Same shape as the employee manifest, a different group. The two modules share
   no code and never import from each other (rule 12); the only thing they have
   in common is that the shell reads both the same way.

   Each route carries two functions: `page` returns the HTML for the current
   state, and `bind` runs once that HTML is in the DOM. `bind` is also where a
   page starts loading the data it does not have yet — `page` is synchronous, so
   it cannot await anything.

   Importing ./i18n.js is what merges the module's strings into the global
   dictionaries. It has to happen before the first render, and it does, because
   main.js imports this file at boot.
   ========================================================================== */

import { MODULE_NAMES } from '../../constants/globals.js';
import './i18n.js';

import { renderEquipmentListPage, bindEquipmentListPageEvents } from './pages/listPage.js';
import { renderRejectedEquipmentPage, bindRejectedEquipmentPageEvents } from './pages/rejectedPage.js';
import { renderEquipmentDetailPage, bindEquipmentDetailPageEvents } from './pages/detailPage.js';
import { renderEquipmentFormPage, bindEquipmentFormEvents } from './pages/formPage.js';
import { renderEquipmentRejectPage, bindEquipmentRejectPageEvents } from './pages/rejectFormPage.js';
import {
  renderEquipmentKpis, renderEquipmentCharts, bindEquipmentDashboard,
} from './dashboard.js';
import {
  searchEquipment, findEquipmentResult, renderEquipmentVerdictCard,
} from './officerCard.js';

export const manifest = {
  name: MODULE_NAMES.EQUIPMENT,
  displayNameKey: 'module_equipment',
  group: 'EQUIPMENT',

  routes: [
    { path: 'equipment',          page: renderEquipmentListPage,     bind: bindEquipmentListPageEvents },
    { path: 'equipment/rejected', page: renderRejectedEquipmentPage, bind: bindRejectedEquipmentPageEvents },

    // Detail and form routes have no sidebar entry, so the topbar falls back to
    // the module's display name. 'equipment/new' and 'equipment/rejected' are
    // two-segment literals competing with 'equipment/:id'; the router resolves
    // the one with the fewest ':' segments first, so a literal always wins
    // whatever the registration order.
    { path: 'equipment/new',        page: renderEquipmentFormPage,   bind: bindEquipmentFormEvents },
    { path: 'equipment/:id',        page: renderEquipmentDetailPage, bind: bindEquipmentDetailPageEvents },
    { path: 'equipment/:id/edit',   page: renderEquipmentFormPage,   bind: bindEquipmentFormEvents },
    { path: 'equipment/:id/reject', page: renderEquipmentRejectPage, bind: bindEquipmentRejectPageEvents },
  ],

  sidebar: [
    { labelKey: 'nav_equipment_active',   route: 'equipment',          icon: '▣' },
    { labelKey: 'nav_equipment_rejected', route: 'equipment/rejected', icon: '✕' },
  ],

  /**
   * What this module adds to the dashboard (Section 5.2), drawn only when the
   * user can view `equipment`. Same three-part shape as the employee manifest —
   * two render slots and the bind that starts their fetch.
   */
  dashboard: {
    kpis: renderEquipmentKpis,
    charts: renderEquipmentCharts,
    bind: bindEquipmentDashboard,
  },

  /**
   * What this module contributes to the officer app (Sections 5.6, 7.5). Same
   * four-part contract the employee manifest implements; the officer shell
   * merges both without knowing what either one holds.
   */
  officer: {
    entityKind: 'equipment',
    searchEntities: searchEquipment,
    findEntity: findEquipmentResult,
    renderVerdictCard: renderEquipmentVerdictCard,
  },
};
