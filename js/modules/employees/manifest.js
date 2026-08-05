/* ==========================================================================
   employees/manifest.js — how the employee module introduces itself to the
   shell (Section 5.2).

   The shell knows nothing about employees beyond what is in this object. It
   reads `routes` to build the route table, `sidebar` to build the nav, and
   `group` to decide which header those nav items sit under.

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

import {
  renderFieldListPage, bindFieldListPageEvents,
  renderSafetyListPage, bindSafetyListPageEvents,
} from './pages/listPage.js';
import { renderEmployeeDetailPage, bindEmployeeDetailPageEvents } from './pages/detailPage.js';
import { renderEmployeeFormPage, bindEmployeeFormEvents } from './pages/formPage.js';
import { renderRenewalsPage, bindRenewalsPageEvents } from './pages/renewalsPage.js';
import { renderRdtPage, bindRdtPageEvents } from './pages/rdtPage.js';
import { renderResignedPage, bindResignedPageEvents } from './pages/resignedPage.js';
import {
  renderEmployeeKpis, renderEmployeeCharts, bindEmployeeDashboard,
} from './dashboard.js';
import {
  searchEmployees, findEmployeeResult, renderEmployeeVerdictCard,
} from './officerCard.js';

export const manifest = {
  name: MODULE_NAMES.EMPLOYEES,
  displayNameKey: 'module_employees',
  group: 'EMPLOYEES',

  routes: [
    { path: 'field',    page: renderFieldListPage,  bind: bindFieldListPageEvents },
    { path: 'safety',   page: renderSafetyListPage, bind: bindSafetyListPageEvents },
    { path: 'renewals', page: renderRenewalsPage,   bind: bindRenewalsPageEvents },
    { path: 'rdt',      page: renderRdtPage,        bind: bindRdtPageEvents },
    { path: 'resigned', page: renderResignedPage,   bind: bindResignedPageEvents },

    // Detail and form routes have no sidebar entry, so the topbar falls back to
    // the module's display name. `employee/new/:team` is registered before
    // `employee/:id/edit` for readability only — the router resolves literals
    // ahead of ':' segments whatever the order.
    { path: 'employee/:id',      page: renderEmployeeDetailPage, bind: bindEmployeeDetailPageEvents },
    { path: 'employee/new/:team', page: renderEmployeeFormPage,  bind: bindEmployeeFormEvents },
    { path: 'employee/:id/edit',  page: renderEmployeeFormPage,  bind: bindEmployeeFormEvents },
  ],

  sidebar: [
    { labelKey: 'nav_field_team',  route: 'field',    icon: '⚙' },
    { labelKey: 'nav_safety_team', route: 'safety',   icon: '⛑' },
    { labelKey: 'nav_renewals',    route: 'renewals', icon: '⏱' },
    { labelKey: 'nav_rdt',         route: 'rdt',      icon: '⚕' },
    { labelKey: 'nav_resigned',    route: 'resigned', icon: '⊘' },
  ],

  /**
   * What this module adds to the dashboard (Section 5.2), drawn only when the
   * user can view `employees`.
   *
   * `kpis` and `charts` are the two slots Section 5.2 defines. `bind` is the
   * same page/bind split every route above uses: the two render functions are
   * synchronous, so something has to start the fetch once their markup is in
   * the DOM, and that is what the shell calls `bind` for.
   */
  dashboard: {
    kpis: renderEmployeeKpis,
    charts: renderEmployeeCharts,
    bind: bindEmployeeDashboard,
  },

  /**
   * What this module contributes to the officer app (Sections 5.6, 7.5).
   *
   * `entityKind` is the middle segment of the officer route, so an employee card
   * lives at '#/check/employee/LM-EMP-0001'. The officer shell reads this block
   * and nothing else about employees — it never imports from this folder.
   *
   * `findEntity` is what keeps the Recent list honest: it stores {kind, id} only
   * and re-resolves through here on every draw, so a record whose verdict
   * changed after a Refresh shows the new one rather than a remembered dot.
   */
  officer: {
    entityKind: 'employee',
    searchEntities: searchEmployees,
    findEntity: findEmployeeResult,
    renderVerdictCard: renderEmployeeVerdictCard,
  },
};
