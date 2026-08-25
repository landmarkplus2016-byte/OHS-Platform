/* ==========================================================================
   equipment/constants.js — the equipment module's own vocabulary.

   Keys here mirror the Sheet's column names exactly (Section 2).

   Nothing in this file derives anything. Which verdict an item is in, and what
   state its third-party inspection is in, come from the server's `derived`
   block (Section 6.3).
   ========================================================================== */

/**
 * Waves are rows on the InspectionWaves tab, not columns on the item.
 *
 * There used to be a `WAVES = [1, 2, 3]` here and a pair of helpers that built
 * `wave_1_date` / `wave_1_result` column names from it. Both are gone: an item
 * now carries an open-ended `waves` array, numbered by the server, and nothing
 * on the client concatenates a column name.
 */

/** The only two results a completed wave can carry. */
export const WAVE_RESULTS = ['pass', 'fail'];

/**
 * How many waves the equipment detail card shows before it defers to the full
 * log.
 *
 * Five is enough to see the recent pattern — the run of passes a fail
 * interrupts — without the card growing without limit on an item inspected
 * monthly for two years. Everything above that is one tap away on the waves
 * page.
 */
export const WAVE_CARD_LIMIT = 5;

/** Rows per page on the fleet-wide waves page. */
export const WAVE_PAGE_SIZE = 50;

/** Wave origin → i18n key, for the badge that says who filed it. */
export const WAVE_ORIGIN_LABEL_KEYS = {
  officer: 'eqp_wave_origin_officer',
  admin: 'eqp_wave_origin_admin',
  migration: 'eqp_wave_origin_migration',
};

/** wave result → i18n key. An empty result is a wave that has not run yet. */
export const WAVE_RESULT_LABEL_KEYS = {
  pass: 'eqp_wave_pass',
  fail: 'eqp_wave_fail',
};

/**
 * Review state → i18n key.
 *
 * An officer's wave lands `pending` and waits for an admin to confirm what they
 * found; an admin's is `approved` as it is written. `rejected` keeps the row on
 * the record and stops it counting — the same outcome as a void, reached by a
 * different decision (Section 6.3).
 */
export const WAVE_APPROVAL_LABEL_KEYS = {
  pending: 'eqp_wave_status_pending',
  approved: 'eqp_wave_status_approved',
  rejected: 'eqp_wave_status_rejected',
};

/**
 * The three internal wave slots, one per quarter of the April fiscal year, plus
 * the off-cycle bucket for anything recorded in Q4.
 *
 * Q4 is the third-party inspection's quarter and has no internal slot, but an
 * officer who finds damaged gear in February still has to be able to write it
 * down — so it records as wave 0 and drives the verdict like any other wave
 * while filling no slot. The server is the authority on this (waveSlotFor_);
 * these values exist only to label the filter.
 */
export const WAVE_SLOTS = ['1', '2', '3'];
export const WAVE_SLOT_OFF_CYCLE = '0';

/**
 * Dropdown columns → the FieldOptions list that fills them.
 *
 * `subcontractor` borrows the employees' list rather than owning one. The
 * company that supplies the people supplies the gear, and two lists would drift
 * the first time somebody renamed one of them. This mirrors
 * EQUIPMENT_OPTION_FIELDS in Equipment.gs, which is the gate.
 */
export const LIST_FIELD_KEYS = {
  item: 'equipment_items',
  brand: 'equipment_brands',
  subcontractor: 'subcontractors',
};

/**
 * The three verdicts, worst first — the order the list page's verdict filter
 * offers them in (Section 6.3).
 *
 * The server calls this filter `worst_state` (Section 3.6), but equipment has
 * no worst_state: its derived block carries `third_party_state` and `verdict`,
 * and the value the filter matches is a verdict. dataActions.js is where that
 * name mismatch is absorbed, so nothing above it has to know.
 */
export const VERDICTS = ['blocked', 'warning', 'cleared'];

/** Rows per page. The server caps page_size at 200 whatever we ask for. */
export const PAGE_SIZE = 50;

/**
 * Page size for the one page that needs every row before it can render — the
 * rejected list, which walks pages until the server runs out.
 */
export const BULK_PAGE_SIZE = 200;

/**
 * How many pages that walk takes before giving up. 20 × 200 = 4,000 items,
 * comfortably past Landmark's inventory; the cap exists so a server bug cannot
 * turn one page load into an unbounded request loop.
 */
export const MAX_PAGE_WALK = 20;

/**
 * The FieldOptions list key for a dropdown column.
 *
 * @param {string} field 'item' | 'brand' | 'subcontractor'
 * @returns {string|null}
 */
export function listKeyFor(field) {
  return LIST_FIELD_KEYS[field] || null;
}
