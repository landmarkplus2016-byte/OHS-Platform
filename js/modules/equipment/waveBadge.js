/* ==========================================================================
   equipment/waveBadge.js — the review-state badge for one inspection wave.

   Its own file because two pages draw it: the capped card on an item's detail
   page and the fleet-wide review queue. The same reasoning that put the wave
   dialogs in waveDialog.js — a badge defined twice is a badge that drifts, and
   these two are read side by side often enough that a drift would show.

   It stays inside the equipment module rather than moving to js/components/,
   because the states it names are this module's (Section 6.3) and no other
   module has a review queue. Rule 12 sends code to components/ when a *second
   module* needs it, not when a second page does.
   ========================================================================== */

import { t } from '../../i18n/i18n.js';
import { escapeHtml, EMPTY_MARK } from '../../utils/format.js';
import { WAVE_APPROVAL_LABEL_KEYS } from './constants.js';

/**
 * The verdict palette, reused rather than reinvented.
 *
 * An admin scanning this column is asking the same question they ask of a
 * verdict — is this settled, does it need me, is it out — so it answers in the
 * same colours. Pending is the amber "needs attention"; rejected is the red
 * "does not count".
 */
const APPROVAL_CLASSES = {
  pending: 'badge-warning',
  approved: 'badge-cleared',
  rejected: 'badge-blocked',
};

/**
 * A wave's review state as a badge, with the rejection reason beneath it.
 *
 * A voided wave reads as voided and nothing else. It is outside the review
 * entirely — voiding says the inspection should never have been filed, where
 * rejecting says it was filed and not accepted — and showing "Approved" next to
 * "Voided" would read as a contradiction rather than as history.
 *
 * @param {Object} wave a wave as list_inspection_waves returns it
 * @returns {string} HTML
 */
export function waveApprovalBadge(wave) {
  if (wave.voided) {
    return `<span class="badge badge-inactive">${escapeHtml(t('eqp_wave_status_voided'))}</span>`;
  }

  const key = WAVE_APPROVAL_LABEL_KEYS[wave.approval_status];
  if (!key) return `<span class="cell-sub">${EMPTY_MARK}</span>`;

  return `
    <span class="badge ${APPROVAL_CLASSES[wave.approval_status]}">${escapeHtml(t(key))}</span>
    ${wave.approval_status === 'rejected' && wave.rejection_reason
      ? `<div class="cell-sub">${escapeHtml(wave.rejection_reason)}</div>`
      : ''}`;
}
