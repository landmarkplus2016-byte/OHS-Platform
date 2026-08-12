/* ==========================================================================
   equipment/officerCard.js — what the equipment module contributes to the
   officer app (Sections 5.6, 7.5).

   The employee-side twin of this file lives in the employee module and the two
   share no code (rule 12.3) — only the shapes in components/verdictCard.js,
   which is shared ground.

   Everything here reads the *stripped* snapshot from `officer_sync`
   (Section 7.6). In particular there is no `comments` field: admin notes are
   named explicitly as something officers do not see, and they never arrive.

   Nothing is derived here. `derived.verdict` and `derived.third_party_state`
   are computed by Compliance.gs and shipped with the snapshot (Section 6.6).
   ========================================================================== */

import { t } from '../../i18n/i18n.js';
import { escapeHtml, fmtDate, EMPTY_MARK } from '../../utils/format.js';
import {
  renderVerdictHero, renderIssues, renderStateLine, renderPanel,
  renderEntityNotFound, identityTag, daysHint,
} from '../../components/verdictCard.js';
import { WAVE_RESULT_LABEL_KEYS } from './constants.js';

/** Equipment in the snapshot, or an empty list before the first sync. */
function inventory(snapshot) {
  return (snapshot && Array.isArray(snapshot.equipment)) ? snapshot.equipment : [];
}

/**
 * Turn one snapshot row into the result shape the officer home page renders.
 *
 * `primary_text` leads with the item type and brand because that is what the
 * officer is holding; the serial number goes underneath, since it is what they
 * searched by and needs to be verifiable against the tag on the strap.
 *
 * `avatar` overrides the initials the officer list would otherwise derive from
 * the title — "Harness · 3M" has no meaningful initials, and the same glyph the
 * sidebar uses for this module reads instantly as "a thing, not a person".
 */
function toResult(equipment) {
  const title = [equipment.item, equipment.brand].filter(Boolean).join(' · ');
  const sub = [equipment.serial_no, equipment.team_leader_name || equipment.subcontractor]
    .filter(Boolean).join(' · ');

  return {
    kind: 'equipment',
    id: equipment.equipment_id,
    primary_text: title || equipment.equipment_id,
    secondary_text: sub,
    avatar: '▣',
    verdict: (equipment.derived && equipment.derived.verdict) || 'blocked',
  };
}

/**
 * Case-insensitive substring match on either serial number or the item type.
 *
 * Both serials are searchable because the tag an officer can actually read in
 * the field is sometimes the third-party one and sometimes the manufacturer's,
 * and they should not have to know which is which before they can type it.
 *
 * @param {string} query
 * @param {Object} snapshot
 * @returns {Array<Object>} result objects
 */
export function searchEquipment(query, snapshot) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];

  return inventory(snapshot)
    .filter((equipment) => {
      const serial = String(equipment.serial_no || '').toLowerCase();
      const thirdPartySn = String(equipment.third_party_sn || '').toLowerCase();
      const item = String(equipment.item || '').toLowerCase();
      return serial.includes(needle) || thirdPartySn.includes(needle) || item.includes(needle);
    })
    .map(toResult);
}

/**
 * One item as a result object, for the Recent list. Null when it is no longer
 * in the snapshot.
 *
 * @param {string} equipmentId
 * @param {Object} snapshot
 * @returns {Object|null}
 */
export function findEquipmentResult(equipmentId, snapshot) {
  const equipment = inventory(snapshot).find((row) => row.equipment_id === equipmentId);
  return equipment ? toResult(equipment) : null;
}

/** What this item is, and who is carrying it. */
function renderIdentity(equipment) {
  const heading = [equipment.item, equipment.brand].filter(Boolean).join(' · ');

  return `
    <div class="officer-id-card">
      <div class="id-name">${escapeHtml(heading || equipment.equipment_id)}</div>
      <div class="id-sub">${escapeHtml(equipment.serial_no || '')}</div>
      <div class="id-tags">
        ${identityTag(equipment.equipment_id, '')}
        ${equipment.subcontractor ? identityTag(equipment.subcontractor, '') : ''}
        ${equipment.team_leader_name
          ? identityTag(equipment.team_leader_name, equipment.team_leader_archived ? 'bad' : '')
          : ''}
      </div>
    </div>`;
}

/** A plain label/value row, for the identifiers that carry no state. */
function detailLine(label, value) {
  return `
    <div class="cert-line">
      <div class="cert-line-main">
        <div class="cert-line-name">${escapeHtml(label)}</div>
      </div>
      <div class="cert-line-value">${escapeHtml(value || EMPTY_MARK)}</div>
    </div>`;
}

/**
 * The third-party inspection — the item's primary compliance date, and the only
 * one carrying a derived state (Section 6.3).
 */
function renderInspection(equipment) {
  const derived = equipment.derived || {};

  const lines = [
    renderStateLine({
      label: t('eqp_field_third_party_end'),
      iso: equipment.third_party_inspection_end_date,
      state: derived.third_party_state,
    }),
    detailLine(t('eqp_field_third_party_sn'), equipment.third_party_sn),
    detailLine(t('eqp_field_date_of_manufacture'), equipment.date_of_manufacture
      ? fmtDate(equipment.date_of_manufacture)
      : ''),
  ].join('');

  return renderPanel(t('eqp_field_third_party_end'), lines);
}

/**
 * One recorded wave: when it ran, how it went, and what the officer wrote.
 *
 * Waves have no derived state of their own — only the most recent completed one
 * feeds the verdict (Section 6.3) — so each row shows its date and result
 * verbatim.
 *
 * The comment is shown. It is the one thing on this card written by another
 * officer for this one, and "webbing frayed near the D-ring, watch it" is worth
 * more at a tower than any date on the page.
 */
function waveLine(wave, pending) {
  const resultKey = WAVE_RESULT_LABEL_KEYS[wave.result];
  const label = pending
    ? t('off_wave_pending_label')
    : `${t('eqp_col_wave')} ${wave.wave_no}`;

  return `
    <div class="cert-line${pending ? ' cert-line-pending' : ''}">
      <div class="cert-line-main">
        <div class="cert-line-name">${escapeHtml(label)}</div>
        <div class="cert-line-date">
          ${wave.wave_date ? escapeHtml(fmtDate(wave.wave_date)) + ' ' + daysHint(wave.wave_date) : EMPTY_MARK}
        </div>
        ${wave.comments
          ? `<div class="cert-line-note">${escapeHtml(wave.comments)}</div>`
          : ''}
      </div>
      ${wave.result
        ? `<span class="cert-state ${wave.result === 'fail' ? 'cs-expired' : 'cs-valid'}">${
            escapeHtml(resultKey ? t(resultKey) : wave.result)
          }</span>`
        : `<span class="cert-state cs-missing">${escapeHtml(t('off_na'))}</span>`}
    </div>`;
}

/**
 * The internal inspection waves, newest first, with anything still queued on
 * this phone shown above them.
 *
 * `snapshot.pending_waves` is put there by the officer module before it calls
 * this card (see officer/search.js). It is not read from the outbox directly:
 * rule 12 keeps this module out of another module's folder, and the officer app
 * is the thing that owns the queue — this card only draws what it is handed.
 *
 * A queued wave is deliberately *not* allowed to change the hero or the issues
 * list. Rule 13 puts compliance derivation on the server, and until this wave
 * reaches it the verdict on screen is still the last one the server calculated.
 * Saying so plainly is more honest than a colour the phone invented.
 */
function renderWaves(equipment, pending) {
  const recorded = Array.isArray(equipment.waves) ? equipment.waves : [];
  const queued = pending || [];

  if (recorded.length === 0 && queued.length === 0) {
    return renderPanel(
      t('eqp_col_wave'),
      `<div class="cert-line"><div class="cert-line-main">
        <div class="cert-line-name">${escapeHtml(t('off_wave_none'))}</div>
      </div></div>`
    );
  }

  const lines = [
    ...queued.map((wave) => waveLine(wave, true)),
    ...recorded.map((wave) => waveLine(wave, false)),
  ].join('');

  const note = queued.length
    ? `<div class="cert-line-note">${escapeHtml(t('off_wave_pending_note', { count: queued.length }))}</div>`
    : '';

  return renderPanel(t('eqp_col_wave'), lines + note);
}

/**
 * The equipment verdict card (Section 7.5).
 *
 * Same four-part layout as the employee card — hero, identity, issues, dated
 * states — so an officer moving between the two reads the same page twice.
 *
 * @param {string} equipmentId
 * @param {Object|null} snapshot
 * @returns {string} HTML
 */
export function renderEquipmentVerdictCard(equipmentId, snapshot) {
  const equipment = inventory(snapshot).find((row) => row.equipment_id === equipmentId);
  if (!equipment) return renderEntityNotFound();

  const derived = equipment.derived || {};

  // Waves queued on this phone for this item, handed over by the officer app.
  const pending = ((snapshot && snapshot.pending_waves) || [])
    .filter((wave) => wave.equipment_id === equipmentId);

  return `
    ${renderVerdictHero({ verdict: derived.verdict })}
    ${renderIdentity(equipment)}
    ${renderIssues(derived)}
    ${renderInspection(equipment)}
    ${renderWaves(equipment, pending)}

    <div class="officer-card-actions">
      <button type="button" class="btn btn-primary btn-lg" data-action="officer-record-wave"
              data-equipment-id="${escapeHtml(equipment.equipment_id)}">
        ${escapeHtml(t('off_wave_record'))}
      </button>
    </div>
    <div class="officer-tail"></div>`;
}
