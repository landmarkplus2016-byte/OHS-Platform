/* ==========================================================================
   employees/constants.js — the employee module's own vocabulary.

   Certificate keys here mirror the Sheet's column names exactly (Section 2):
   the column is `cert_wah_practical_expiry`, so the key is `wah_practical`.
   That is what lets the form and the detail page build column names by string
   concatenation instead of carrying a mapping table.

   Nothing in this file derives anything. Which certs *apply* to a team is a
   schema fact — the states they are in come from the server.
   ========================================================================== */

/** The two teams. `team` is chosen at creation and never changes after. */
export const TEAMS = { FIELD: 'field', SAFETY: 'safety' };

/** Certificates every field-team employee carries. */
export const CERT_KEYS_FIELD = [
  'wah_practical',
  'wah_theoretical',
  'ra',
  'fa',
  'ff',
  'ec',
  'mcu',
];

/** Safety-team employees carry the field set plus three of their own. */
export const CERT_KEYS_SAFETY = [...CERT_KEYS_FIELD, 'ppe', 'lifting', 'scaffolding'];

/** cert key → i18n key for its display name. */
export const CERT_LABEL_KEYS = {
  wah_practical: 'cert_wah_practical',
  wah_theoretical: 'cert_wah_theoretical',
  ra: 'cert_ra',
  fa: 'cert_fa',
  ff: 'cert_ff',
  ec: 'cert_ec',
  mcu: 'cert_mcu',
  ppe: 'cert_ppe',
  lifting: 'cert_lifting',
  scaffolding: 'cert_scaffolding',
};

/**
 * Dropdown columns → the FieldOptions list that fills them.
 *
 * `title` is a function because its list depends on the team: a field-team
 * title and a safety-team title are different vocabularies, and offering both
 * in one select is how records end up with a title their team never uses.
 */
export const LIST_FIELD_KEYS = {
  title: (team) => (team === TEAMS.SAFETY ? 'safety_titles' : 'field_titles'),
  contractor: 'contractors',
  subcontractor: 'subcontractors',
  employment_status: 'employment_status',
  legal_permission: 'legal_permission',
};

/**
 * The three states an RdtLog row moves between (Section 2).
 *
 * `selected` is a plan, `completed` is a fact, `missed` is a recorded failure
 * to carry the plan out. Only `completed` counts toward yearly coverage.
 */
export const RDT_STATUSES = ['selected', 'completed', 'missed'];

/** The only two outcomes a completed test can carry. */
export const RDT_RESULTS = ['pass', 'fail'];

/* Status and result labels are built by concatenation in badge.js —
   `emp_rdt_status_<status>`, `emp_rdt_result_<result>` — the same way cert
   states and verdicts are, so a new value needs one key and no map entry. */

/** Rows on the RDT history page. The server caps page_size at 500. */
export const RDT_HISTORY_PAGE_SIZE = 100;

/** Boolean qualification columns, stored as `qual_<key>`. Safety team only. */
export const QUAL_KEYS = ['nebosh', 'iso_45001', 'osha'];

/** qual key → i18n key. */
export const QUAL_LABEL_KEYS = {
  nebosh: 'qual_nebosh',
  iso_45001: 'qual_iso_45001',
  osha: 'qual_osha',
};

/**
 * The certificate states the list page's state filter offers, worst first
 * (Section 6.1).
 *
 * `na` is the seventh state and is deliberately not here: this list drives the
 * `worst_state` filter, and `na` takes no part in the worst-state roll-up. An
 * option that can never match a row is worse than no option at all.
 */
export const CERT_STATES = ['suspended', 'expired', 'urgent', 'soon', 'missing', 'valid'];

/** Rows per page. The server caps page_size at 200 whatever we ask for. */
export const PAGE_SIZE = 50;

/**
 * Page size for the pages that need every row before they can render — the
 * renewals pivot and the resigned list. Both walk pages until the server runs
 * out; this is the size of each step.
 */
export const BULK_PAGE_SIZE = 200;

/**
 * How many pages those walks take before giving up. 20 × 200 = 4,000
 * employees, comfortably past Landmark's headcount; the cap exists so a server
 * bug cannot turn one page load into an unbounded request loop.
 */
export const MAX_PAGE_WALK = 20;

/**
 * Which certificates apply to a team (Section 6.1). Safety-only certs are left
 * blank on field employees and are not rendered for them.
 *
 * @param {string} team
 * @returns {Array<string>}
 */
export function certKeysFor(team) {
  return team === TEAMS.SAFETY ? CERT_KEYS_SAFETY : CERT_KEYS_FIELD;
}

/**
 * The FieldOptions list key for a dropdown column on a given team.
 *
 * @param {string} field e.g. 'title', 'subcontractor'
 * @param {string} team
 * @returns {string|null}
 */
export function listKeyFor(field, team) {
  const entry = LIST_FIELD_KEYS[field];
  if (!entry) return null;

  return typeof entry === 'function' ? entry(team) : entry;
}
