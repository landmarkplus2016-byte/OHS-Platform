/* ==========================================================================
   equipment/constants.js — the equipment module's own vocabulary.

   Keys here mirror the Sheet's column names exactly (Section 2): the columns
   are `wave_1_date` and `wave_1_result`, so the wave numbers below are what the
   form and the detail page concatenate into column names rather than carrying a
   mapping table.

   Nothing in this file derives anything. Which verdict an item is in, and what
   state its third-party inspection is in, come from the server's `derived`
   block (Section 6.3).
   ========================================================================== */

/** The three internal inspection waves, in order (Section 2). */
export const WAVES = [1, 2, 3];

/** The only two results a completed wave can carry. */
export const WAVE_RESULTS = ['pass', 'fail'];

/** wave result → i18n key. An empty result is a wave that has not run yet. */
export const WAVE_RESULT_LABEL_KEYS = {
  pass: 'eqp_wave_pass',
  fail: 'eqp_wave_fail',
};

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

/** The `wave_N_date` column name for a wave number. */
export function waveDateField(wave) {
  return 'wave_' + wave + '_date';
}

/** The `wave_N_result` column name for a wave number. */
export function waveResultField(wave) {
  return 'wave_' + wave + '_result';
}

/**
 * The FieldOptions list key for a dropdown column.
 *
 * @param {string} field 'item' | 'brand' | 'subcontractor'
 * @returns {string|null}
 */
export function listKeyFor(field) {
  return LIST_FIELD_KEYS[field] || null;
}
