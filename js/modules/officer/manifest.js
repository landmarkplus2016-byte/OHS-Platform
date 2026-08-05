/* ==========================================================================
   officer/manifest.js — the officer app's routes (Section 7).

   The officer app registers like any other module, but it is not a *permission*
   module: its name is absent from MODULE_NAMES, so the router leaves
   `entry.module` null and never asks canView() about it. Officers are gated by
   role instead — the router pins an officer inside 'check/*' and keeps everyone
   else out of it (Section 7.1: same URL, different shell).

   That is also why there is no `group` and no `sidebar` here. The officer shell
   has no sidebar; it has the phone frame in js/shell/officerShell.js.

   There is also no `officer` block. That block is how a *domain* module — the
   employees, the equipment — contributes entities to this app. This module is
   the app; it consumes those blocks rather than publishing one.

   ---- The routes ----

     check                  the mobile sign-in card. The admin login is
                            '#/login' and looks nothing like it.
     check/home             search + Recent
     check/sync             the manual sync page
     check/locked           the fail-closed lockout (Section 7.4)
     check/employee/:id     verdict card, drawn by the employees module
     check/equipment/:id    verdict card, drawn by the equipment module

   'check' and 'check/sync' are the two routes exempt from the staleness guard
   in router.js: one runs before there is a session, and the other is the only
   way out of a lockout.
   ========================================================================== */

import './i18n.js';

import { renderOfficerLoginPage, bindOfficerLoginPageEvents } from './pages/officerLoginPage.js';
import { renderOfficerHomePage, bindOfficerHomePageEvents } from './pages/officerHomePage.js';
import { renderOfficerSyncPage, bindOfficerSyncPageEvents } from './pages/officerSyncPage.js';
import { renderOfficerLockedPage, bindOfficerLockedPageEvents } from './pages/officerLockedPage.js';
import {
  renderOfficerVerdictEmployeePage, bindOfficerVerdictEmployeePageEvents,
} from './pages/officerVerdictEmployeePage.js';
import {
  renderOfficerVerdictEquipmentPage, bindOfficerVerdictEquipmentPageEvents,
} from './pages/officerVerdictEquipmentPage.js';

export const manifest = {
  name: 'officer',
  displayNameKey: 'module_officer',

  routes: [
    { path: 'check',        page: renderOfficerLoginPage,  bind: bindOfficerLoginPageEvents },
    { path: 'check/home',   page: renderOfficerHomePage,   bind: bindOfficerHomePageEvents },
    { path: 'check/sync',   page: renderOfficerSyncPage,   bind: bindOfficerSyncPageEvents },
    { path: 'check/locked', page: renderOfficerLockedPage, bind: bindOfficerLockedPageEvents },

    // ':id' is captured into ROUTE_PARAMS and handed to both page and bind.
    { path: 'check/employee/:id',
      page: renderOfficerVerdictEmployeePage,
      bind: bindOfficerVerdictEmployeePageEvents },
    { path: 'check/equipment/:id',
      page: renderOfficerVerdictEquipmentPage,
      bind: bindOfficerVerdictEquipmentPageEvents },
  ],
};
