/* ==========================================================================
   verdictCard.js — the pieces every officer verdict card is built from
   (Section 7.5).

   Shared ground, not module ground. Employees and equipment both draw a
   colour-coded hero, an identity block, an "Issues found" list and a list of
   dated states — the same four shapes with different contents. Rule 12.1 says
   anything two modules need lives here rather than inside one of them, and
   duplicating a safety-critical hero in two places is how the red one ends up
   subtly different from the other red one.

   What stays in the modules: what an employee *is*, which certificates apply to
   a team, what a serial number means. This file knows only verdicts, states and
   dates.

   Nothing here derives anything. Every verdict, state and reason arrives
   pre-derived from the server (Section 6.6) — this file picks a colour and an
   icon for values it is handed.
   ========================================================================== */

import { t } from '../i18n/i18n.js';
import { escapeHtml, fmtDate, daysUntil, EMPTY_MARK } from '../utils/format.js';
import { certStateBadge } from './badge.js';

/** The three verdicts → the glyph in the hero. */
const VERDICT_ICONS = {
  cleared: '✓',
  warning: '⚠',
  blocked: '✕',
};

/**
 * The colour-coded hero: back, refresh, big icon, verdict, one-line summary.
 *
 * Back and Refresh are placed by logical properties (Section 8.2), so in Arabic
 * back sits on the right and refresh on the left without an RTL override.
 *
 * The Refresh button's busy state is not a parameter: the officer page toggles
 * the button element directly rather than redrawing the whole card to grey out
 * one control (see officer/pages/verdictPage.js).
 *
 * @param {Object} options
 * @param {string} options.verdict 'cleared' | 'warning' | 'blocked'
 * @param {boolean} [options.canRefresh] false hides Refresh — for a card with
 *        nothing on the server to refresh against
 * @returns {string} HTML
 */
export function renderVerdictHero(options) {
  const opts = options || {};
  const verdict = VERDICT_ICONS[opts.verdict] ? opts.verdict : 'blocked';
  const canRefresh = opts.canRefresh !== false;

  return `
    <div class="verdict-hero ${verdict}">
      <button type="button" class="verdict-nav back" data-action="officer-back"
              aria-label="${escapeHtml(t('back'))}">←</button>

      ${canRefresh ? `
        <button type="button" class="verdict-nav refresh" data-action="officer-refresh"
                aria-label="${escapeHtml(t('refresh'))}">↻</button>` : ''}

      <div class="verdict-icon" aria-hidden="true">${VERDICT_ICONS[verdict]}</div>
      <div class="verdict-label">${escapeHtml(t('verdict_' + verdict))}</div>
      <div class="verdict-sub">${escapeHtml(t('off_verdict_sub_' + verdict))}</div>
    </div>`;
}

/**
 * The "Issues found" list: blockers with a red edge, warnings with an amber one.
 *
 * `text_key` + `text_params` is exactly what t() takes (Section 6.4), so a
 * reason goes straight through — except that some params are raw domain keys
 * rather than display text. `resolveParams` is where the owning module turns
 * `{cert: 'mcu'}` into `{cert: 'Medical Check-up'}`; without it the officer
 * would read "mcu expired 5 days ago".
 *
 * Renders nothing at all when there is nothing wrong. A cleared card needs no
 * empty "no issues" panel — the green hero already said it.
 *
 * @param {Object} derived the server's derived block
 * @param {function(Object): Object} [resolveParams]
 * @returns {string} HTML
 */
export function renderIssues(derived, resolveParams) {
  const blockers = (derived && derived.blockers) || [];
  const warnings = (derived && derived.warnings) || [];
  if (blockers.length === 0 && warnings.length === 0) return '';

  const line = (reason, kind) => {
    const params = resolveParams
      ? resolveParams(reason.text_params || {})
      : (reason.text_params || {});

    return `
      <div class="reason-item ${kind}">
        <span class="reason-ic" aria-hidden="true">${kind === 'blocker' ? '✕' : '⚠'}</span>
        <span class="reason-txt">${escapeHtml(t(reason.text_key, params))}</span>
      </div>`;
  };

  return `
    <div class="officer-section">
      <h3 class="${blockers.length ? 'is-blocked' : 'is-warning'}">${escapeHtml(t('off_issues'))}</h3>
      ${blockers.map((reason) => line(reason, 'blocker')).join('')}
      ${warnings.map((reason) => line(reason, 'warning')).join('')}
    </div>`;
}

/**
 * One dated row with a state badge — a certificate, an inspection end date.
 *
 * The officer display rule from Section 7.5: a `missing` state shows as "N/A"
 * with an em-dash date, not "Missing". From a tower, "no date recorded" and
 * "not applicable" are the same non-answer; the distinction only matters to the
 * admin who maintains the data. The derived state itself is untouched — this is
 * a label swap, nothing more.
 *
 * A cert the admin flagged N/A collapses into the same line, and this is the
 * one place where the two really are identical rather than merely displayed
 * alike: both mean "no valid record, and that is not a problem". They keep
 * their own badge colours so the admin-facing screens can still tell them
 * apart; only here do they read the same.
 *
 * @param {Object} options
 * @param {string} options.label already translated
 * @param {string} options.iso expiry date, may be empty
 * @param {string} options.state one of the seven derived states
 * @returns {string} HTML
 */
export function renderStateLine(options) {
  const { label, iso, state } = options || {};
  const isNa = state === 'na';

  // `suspended` keeps its own badge even with no date on record. A manually
  // suspended cert need not have one, and the reasons list above already names
  // it as an issue — an "N/A" line under a blocked verdict reads as a
  // contradiction. Every other state falls back to the blank line when the date
  // is missing, which is the case that produced the rule in the first place.
  const isBlank = isNa || state === 'missing' || (!iso && state !== 'suspended');

  const badge = isBlank
    ? certStateBadge(isNa ? 'na' : 'missing', { labelOverride: t('off_na') })
    : certStateBadge(state);

  return `
    <div class="cert-line">
      <div class="cert-line-main">
        <div class="cert-line-name">${escapeHtml(label)}</div>
        <div class="cert-line-date">${isBlank ? EMPTY_MARK : escapeHtml(fmtDate(iso)) + ' ' + daysHint(iso)}</div>
      </div>
      ${badge}
    </div>`;
}

/**
 * "12d left" / "5d ago". A label, not a decision — the badge beside it carries
 * the state the server derived.
 *
 * @param {string} iso
 * @returns {string} HTML
 */
export function daysHint(iso) {
  const days = daysUntil(iso);
  if (days === null) return '';

  const text = days >= 0
    ? t('off_days_left', { days })
    : t('off_days_ago', { days: Math.abs(days) });

  return `<span class="cert-days">${escapeHtml(text)}</span>`;
}

/**
 * A titled panel — "All certificates", "Inspection".
 *
 * @param {string} title already translated
 * @param {string} bodyHtml
 * @returns {string} HTML
 */
export function renderPanel(title, bodyHtml) {
  return `
    <div class="officer-panel">
      <h3>${escapeHtml(title)}</h3>
      ${bodyHtml}
    </div>`;
}

/**
 * Shown when the officer opens an entity that is not in their snapshot — a
 * record created since their last sync, or a hand-typed URL.
 *
 * Deliberately not a verdict. An unknown entity has no verdict, and a card that
 * defaulted to green or red would be inventing one.
 *
 * @returns {string} HTML
 */
export function renderEntityNotFound() {
  return `
    <div class="officer-missing">
      <button type="button" class="btn btn-ghost btn-sm" data-action="officer-back">← ${escapeHtml(t('back'))}</button>
      <div class="officer-missing-icon" aria-hidden="true">?</div>
      <h2>${escapeHtml(t('off_not_found_title'))}</h2>
      <p>${escapeHtml(t('off_not_found_body'))}</p>
    </div>`;
}

/**
 * A small pill for the identity block — team, title, status.
 *
 * @param {string} text
 * @param {string} [variant] extra class: 'ok' | 'warn' | 'bad' | ''
 * @returns {string} HTML
 */
export function identityTag(text, variant) {
  if (!text) return '';
  return `<span class="id-tag${variant ? ' ' + variant : ''}">${escapeHtml(text)}</span>`;
}
