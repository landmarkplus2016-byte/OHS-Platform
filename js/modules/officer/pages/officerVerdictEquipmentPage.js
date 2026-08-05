/* ==========================================================================
   officer/pages/officerVerdictEquipmentPage.js — route '#/check/equipment/:id'.

   The employee page's twin. The card is drawn by the equipment module through
   its manifest; this file names the route's page and bind and points Refresh at
   `officer_get_equipment`.
   ========================================================================== */

import { makeVerdictPage } from './verdictPage.js';
import { officerGetEquipment } from '../dataActions.js';

const page = makeVerdictPage({
  kind: 'equipment',
  fetchEntity: officerGetEquipment,
});

export const renderOfficerVerdictEquipmentPage = page.render;
export const bindOfficerVerdictEquipmentPageEvents = page.bind;
