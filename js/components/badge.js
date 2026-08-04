/* ==========================================================================
   badge.js — every coloured pill in the admin UI.

   Shared ground, not module ground: employees, equipment and the officer app
   all show cert states and verdicts, and rule 12.1 says anything two modules
   need lives here rather than inside one of them.

   These render *server-derived* values. Nothing in this file decides what state
   something is in — it is handed `derived.per_cert.mcu` or `derived.verdict`
   and picks a colour (Section 6.6).
   ========================================================================== */

import { t } from '../i18n/i18n.js';
import { escapeHtml } from '../utils/format.js';

/**
 * The six certificate states (Section 6.1) → their CSS class. There is no
 * `plan` tier; anything past soon_days is plain `valid`.
 */
const CERT_STATE_CLASSES = {
  suspended: 'cs-suspended',
  expired: 'cs-expired',
  urgent: 'cs-urgent',
  soon: 'cs-soon',
  missing: 'cs-missing',
  valid: 'cs-valid',
};

/** The three verdicts (Sections 6.2, 6.3). */
const VERDICT_CLASSES = {
  cleared: 'badge-cleared',
  warning: 'badge-warning',
  blocked: 'badge-blocked',
};

/**
 * A certificate state badge — 'Expired', 'Urgent', 'Suspended'…
 *
 * @param {string} state one of the six states from `derived.per_cert`
 * @param {{labelOverride?: string}} [options] label text to use instead of the
 *        state's own. The officer app shows `missing` as "N/A" (Section 7.5);
 *        the admin app never does.
 * @returns {string} HTML
 */
export function certStateBadge(state, options) {
  const key = CERT_STATE_CLASSES[state] ? state : 'missing';
  const label = (options && options.labelOverride) || t('state_' + key);

  return `<span class="cert-state ${CERT_STATE_CLASSES[key]}">${escapeHtml(label)}</span>`;
}

/**
 * The worst-state badge for a whole employee — `derived.worst_state`. Same
 * colours as a single certificate, because it *is* one of the six states.
 *
 * @param {string} state
 * @returns {string} HTML
 */
export function worstStateBadge(state) {
  return certStateBadge(state);
}

/**
 * A site-check verdict badge — cleared / warning / blocked.
 *
 * @param {string} verdict `derived.verdict`
 * @returns {string} HTML
 */
export function verdictBadge(verdict) {
  const cls = VERDICT_CLASSES[verdict] || 'badge-inactive';
  const label = VERDICT_CLASSES[verdict] ? t('verdict_' + verdict) : verdict;

  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

/**
 * A team badge. The two teams are visually distinct everywhere they appear
 * together — renewals, RDT, the resigned list.
 *
 * @param {string} team 'field' | 'safety'
 * @returns {string} HTML
 */
export function teamBadge(team) {
  const isSafety = team === 'safety';
  const label = t(isSafety ? 'team_safety' : 'team_field');

  return `<span class="badge ${isSafety ? 'badge-team-safety' : 'badge-team-field'}">${escapeHtml(label)}</span>`;
}

/**
 * A pill for a free-text status column — employment status, legal permission.
 * `positive` picks the colour; the text is whatever the Sheet holds, so a new
 * FieldOptions value renders without a code change.
 *
 * @param {string} text
 * @param {boolean} positive
 * @returns {string} HTML
 */
export function statusBadge(text, positive) {
  if (!text) return '';
  return `<span class="badge ${positive ? 'badge-active' : 'badge-inactive'}">${escapeHtml(text)}</span>`;
}

/**
 * A qualification flag: filled when held, muted when not.
 *
 * @param {string} label already translated
 * @param {boolean} held
 * @returns {string} HTML
 */
export function qualBadge(label, held) {
  return `<span class="badge ${held ? 'badge-cleared' : 'badge-inactive'}">${escapeHtml(label)} ${held ? '✓' : '—'}</span>`;
}
