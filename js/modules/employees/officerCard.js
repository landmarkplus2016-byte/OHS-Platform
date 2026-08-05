/* ==========================================================================
   employees/officerCard.js — what the employee module contributes to the
   officer app (Sections 5.6, 7.5).

   Three functions, wired into the manifest's `officer` block. The officer shell
   knows none of this: it asks every module for matches, merges them, and asks
   whichever module owns the tapped entity to draw the card.

   Everything here reads the *stripped* snapshot the server sent to
   `officer_sync` (Section 7.6): identity fields, cert expiry dates with no
   links, qualification flags, and the derived block. There are no certificate
   links, no comments and no audit trail to render, because none of them arrived.

   Nothing is derived here. `derived.verdict` and `derived.per_cert` are computed
   by Compliance.gs and shipped with the snapshot — the officer's phone renders
   them and never recomputes them (Section 6.6).
   ========================================================================== */

import { t } from '../../i18n/i18n.js';
import { escapeHtml } from '../../utils/format.js';
import {
  renderVerdictHero, renderIssues, renderStateLine, renderPanel,
  renderEntityNotFound, identityTag,
} from '../../components/verdictCard.js';
import { CERT_LABEL_KEYS, certKeysFor, TEAMS } from './constants.js';

/** Employees in the snapshot, or an empty list before the first sync. */
function roster(snapshot) {
  return (snapshot && Array.isArray(snapshot.employees)) ? snapshot.employees : [];
}

/**
 * Turn one snapshot row into the result shape the officer home page renders
 * (Section 5.2, `officer.searchEntities`).
 *
 * `secondary_text` is title + ID rather than the National ID: the officer is
 * usually holding the ID card they searched by, and what they need from the
 * result row is which of the three Ahmeds this one is.
 */
function toResult(employee) {
  const parts = [employee.title, employee.employee_id].filter(Boolean);

  return {
    kind: 'employee',
    id: employee.employee_id,
    primary_text: employee.name,
    secondary_text: parts.join(' · '),
    verdict: (employee.derived && employee.derived.verdict) || 'blocked',
  };
}

/**
 * Case-insensitive substring match on name or National ID.
 *
 * National ID matching is not lower-cased for its own sake — the column is
 * digits — but it goes through the same comparison so a query never has to be
 * classified as "a name" or "a number" before it can be run.
 *
 * @param {string} query
 * @param {Object} snapshot
 * @returns {Array<Object>} result objects
 */
export function searchEmployees(query, snapshot) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];

  return roster(snapshot)
    .filter((employee) => {
      const name = String(employee.name || '').toLowerCase();
      const nationalId = String(employee.national_id || '').toLowerCase();
      return name.includes(needle) || nationalId.includes(needle);
    })
    .map(toResult);
}

/**
 * One employee as a result object, for the Recent list. Null when they are no
 * longer in the snapshot.
 *
 * @param {string} employeeId
 * @param {Object} snapshot
 * @returns {Object|null}
 */
export function findEmployeeResult(employeeId, snapshot) {
  const employee = roster(snapshot).find((row) => row.employee_id === employeeId);
  return employee ? toResult(employee) : null;
}

/**
 * Reason params carry raw domain keys, not display text: the server sends
 * `{cert: 'mcu', days: 5}` (Section 6.4). Translate the cert key here, where the
 * cert vocabulary lives — components/verdictCard.js must not know what an 'mcu'
 * is, and an officer must never read "mcu expired 5 days ago".
 */
function resolveReasonParams(params) {
  if (!params || !params.cert) return params || {};

  const labelKey = CERT_LABEL_KEYS[params.cert];
  return { ...params, cert: labelKey ? t(labelKey) : params.cert };
}

/** Name, National ID, and the pills that identify who this is. */
function renderIdentity(employee) {
  const isSafety = employee.team === TEAMS.SAFETY;
  const status = employee.employment_status || '';
  const legal = employee.legal_permission || '';

  // The two pills that can block a site check are coloured by whether they are
  // the value that clears it. The exact strings come from FieldOptions, so the
  // test is against the one value Section 6.2 treats as passing, case-folded.
  const statusOk = status.toLowerCase() === 'active';
  const legalOk = legal.toLowerCase() === 'approved';

  return `
    <div class="officer-id-card">
      <div class="id-name">${escapeHtml(employee.name)}</div>
      <div class="id-sub">${escapeHtml(employee.national_id || '')}</div>
      <div class="id-tags">
        ${identityTag(t(isSafety ? 'team_safety' : 'team_field'), isSafety ? 'team-safety' : 'team-field')}
        ${identityTag(employee.title, '')}
        ${identityTag(status, statusOk ? 'ok' : 'bad')}
        ${identityTag(legal, legalOk ? 'ok' : 'bad')}
        ${identityTag(employee.subcontractor, '')}
      </div>
    </div>`;
}

/** Every certificate that applies to this employee's team, with its state. */
function renderCertificates(employee) {
  const perCert = (employee.derived && employee.derived.per_cert) || {};
  const keys = certKeysFor(employee.team);

  const lines = keys.map((certKey) => renderStateLine({
    label: t(CERT_LABEL_KEYS[certKey] || certKey),
    iso: employee['cert_' + certKey + '_expiry'],
    state: perCert[certKey],
  })).join('');

  return renderPanel(t('emp_section_certs'), lines);
}

/**
 * The employee verdict card — the officer's entire product (Section 7.5).
 *
 * Layout, top to bottom: colour-coded hero, identity block, issues found, all
 * certificates.
 *
 * @param {string} employeeId
 * @param {Object|null} snapshot
 * @returns {string} HTML
 */
export function renderEmployeeVerdictCard(employeeId, snapshot) {
  const employee = roster(snapshot).find((row) => row.employee_id === employeeId);
  if (!employee) return renderEntityNotFound();

  const derived = employee.derived || {};

  return `
    ${renderVerdictHero({ verdict: derived.verdict })}
    ${renderIdentity(employee)}
    ${renderIssues(derived, resolveReasonParams)}
    ${renderCertificates(employee)}
    <div class="officer-tail"></div>`;
}
