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
 * The seven certificate states (Section 6.1) → their CSS class. There is no
 * `plan` tier; anything past soon_days is plain `valid`.
 *
 * `na` sits outside the worst-to-best ladder: it is the admin saying this
 * certificate does not apply to this employee, so it is neither good news nor
 * bad. Its colour says "not part of the question" rather than "fine".
 */
const CERT_STATE_CLASSES = {
  suspended: 'cs-suspended',
  expired: 'cs-expired',
  urgent: 'cs-urgent',
  soon: 'cs-soon',
  missing: 'cs-missing',
  valid: 'cs-valid',
  na: 'cs-na',
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

/**
 * The three RDT log states (Section 2).
 *
 * `selected` reuses the amber `plan` tokens, which Section 8.3 keeps around for
 * exactly this kind of non-compliance badge — an outstanding pick is neither a
 * problem nor a success, it is work not done yet.
 */
const RDT_STATUS_CLASSES = {
  selected: 'badge-rdt-selected',
  completed: 'badge-cleared',
  missed: 'badge-blocked',
};

/**
 * An RDT status badge — Selected / Completed / Missed.
 *
 * @param {string} status
 * @returns {string} HTML
 */
export function rdtStatusBadge(status) {
  const cls = RDT_STATUS_CLASSES[status] || 'badge-inactive';
  const label = RDT_STATUS_CLASSES[status] ? t('emp_rdt_status_' + status) : status;

  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

/**
 * An RDT result badge — Pass / Fail. Returns '' for an entry with no result,
 * so a caller can drop it in unconditionally beside a status badge.
 *
 * @param {string} result 'pass' | 'fail' | ''
 * @returns {string} HTML
 */
export function rdtResultBadge(result) {
  if (result !== 'pass' && result !== 'fail') return '';

  return `<span class="badge ${result === 'pass' ? 'badge-cleared' : 'badge-blocked'}">${
    escapeHtml(t('emp_rdt_result_' + result))
  }</span>`;
}
