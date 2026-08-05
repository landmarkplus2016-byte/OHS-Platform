/* ==========================================================================
   officer/pages/officerVerdictEmployeePage.js — route '#/check/employee/:id'.

   The card itself is drawn by the employee module through its manifest
   (Section 5.6) — this file only names the route's page and bind, and says
   which action the Refresh button calls.

   Everything shared with the equipment card lives in ./verdictPage.js.
   ========================================================================== */

import { makeVerdictPage } from './verdictPage.js';
import { officerGetEmployee } from '../dataActions.js';

const page = makeVerdictPage({
  kind: 'employee',
  fetchEntity: officerGetEmployee,
});

export const renderOfficerVerdictEmployeePage = page.render;
export const bindOfficerVerdictEmployeePageEvents = page.bind;
