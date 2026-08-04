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
};
