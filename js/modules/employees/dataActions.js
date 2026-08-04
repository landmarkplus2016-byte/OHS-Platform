/* ==========================================================================
   employees/dataActions.js — the employee module's only door to the server.

   Rule 9: pages never call api.call directly. They call these wrappers, so the
   action names and payload shapes from Section 3.5 are written down in exactly
   one place. If the API contract changes, this file changes and no page does.

   Every function returns the `data` block or rejects with an ApiError — api.js
   has already unwrapped the envelope and dealt with involuntary logout.
   ========================================================================== */

import { api } from '../../api.js';

/* ---------- Reads --------------------------------------------------------- */

/**
 * `list_employees` — paged and filtered server-side.
 *
 * @param {Object} [params] {team, include_archived, search, filters, page, page_size}
 * @returns {Promise<{employees: Array, total_matching: number, page: number, page_size: number}>}
 */
export function listEmployees(params) {
  return api.call('list_employees', params || {});
}

/**
 * Every employee matching a query, by walking `list_employees` pages until the
 * server runs out.
 *
 * Two pages genuinely need the whole set before they can draw anything: the
 * renewals view pivots employees into one row per certificate and sorts by days
 * remaining, and the resigned view has to filter to archived records itself
 * (Section 3.5 offers `include_archived`, not "archived only"). Neither
 * ordering can be expressed as a page request, so the walk is the honest way to
 * get there.
 *
 * `maxPages` is a circuit breaker, not a business limit — it stops a server bug
 * that always reports more rows from turning one page load into an endless
 * request loop.
 *
 * @param {Object} params same as listEmployees, minus page/page_size
 * @param {{pageSize?: number, maxPages?: number}} [opts]
 * @returns {Promise<{employees: Array, truncated: boolean}>}
 */
export async function listAllEmployees(params, opts) {
  const pageSize = (opts && opts.pageSize) || 200;
  const maxPages = (opts && opts.maxPages) || 20;

  const employees = [];
  let page = 1;
  let truncated = false;

  for (;;) {
    const data = await listEmployees({ ...params, page, page_size: pageSize });
    employees.push(...data.employees);

    if (employees.length >= data.total_matching || data.employees.length === 0) break;

    if (page >= maxPages) {
      console.warn('[employees] page walk hit its cap at', employees.length, 'rows');
      truncated = true;
      break;
    }
    page += 1;
  }

  return { employees, truncated };
}

/**
 * `get_employee` — one employee plus their renewal history and assigned
 * equipment.
 *
 * @param {string} employeeId
 * @returns {Promise<{employee: Object, renewal_history: Array, assigned_equipment: Array}>}
 */
export function getEmployee(employeeId) {
  return api.call('get_employee', { employee_id: employeeId });
}

/**
 * `list_renewal_history` — both filters optional; omit them for the audit view.
 *
 * @param {{employee_id?: string, cert_key?: string}} [params]
 * @returns {Promise<{renewal_history: Array, total_matching: number}>}
 */
export function listRenewalHistory(params) {
  return api.call('list_renewal_history', params || {});
}

/**
 * `list_rdt_eligible` — active, non-archived employees whose MCU has not
 * expired.
 *
 * @param {string} [team] 'field' | 'safety'; omit for both
 * @returns {Promise<{employees: Array, total_matching: number}>}
 */
export function listRdtEligible(team) {
  return api.call('list_rdt_eligible', team ? { team } : {});
}

/**
 * `list_field_options` — every dropdown list, or one of them.
 *
 * @param {string} [listKey]
 * @returns {Promise<{options: Object<string, Array>}>}
 */
export function listFieldOptions(listKey) {
  return api.call('list_field_options', listKey ? { list_key: listKey } : {});
}

/* ---------- Writes -------------------------------------------------------- */

/**
 * `create_employee`.
 *
 * @param {Object} data writable employee fields only — the server sets
 *        employee_id and every audit column, and rejects unknown keys
 * @returns {Promise<{employee: Object}>}
 */
export function createEmployee(data) {
  return api.call('create_employee', data);
}

/**
 * `update_employee` — a partial update. Any certificate expiry that actually
 * changes appends a RenewalHistory row server-side.
 *
 * @param {string} employeeId
 * @param {Object} updates
 * @returns {Promise<{employee: Object}>}
 */
export function updateEmployee(employeeId, updates) {
  return api.call('update_employee', { employee_id: employeeId, updates });
}

/**
 * `archive_employee` — the soft delete. Idempotent.
 *
 * @param {string} employeeId
 * @param {string} [reason]
 * @returns {Promise<{employee: Object}>}
 */
export function archiveEmployee(employeeId, reason) {
  const payload = { employee_id: employeeId };
  if (reason) payload.reason = reason;

  return api.call('archive_employee', payload);
}

/**
 * `unarchive_employee`. Rejects with `conflict` when another active employee
 * has taken this one's national_id in the meantime.
 *
 * @param {string} employeeId
 * @returns {Promise<{employee: Object}>}
 */
export function unarchiveEmployee(employeeId) {
  return api.call('unarchive_employee', { employee_id: employeeId });
}

/**
 * `bulk_import_employees` — all or nothing. On a validation failure the
 * rejected ApiError carries `row_errors`: [{row, errors}].
 *
 * @param {Array<Object>} rows
 * @param {{on_duplicate?: 'skip'|'overwrite', auto_add_unknown_options?: boolean}} [opts]
 * @returns {Promise<{added: number, updated: number, skipped: number, list_added: Object}>}
 */
export function bulkImportEmployees(rows, opts) {
  const options = opts || {};

  return api.call('bulk_import_employees', {
    rows,
    on_duplicate: options.on_duplicate || 'skip',
    auto_add_unknown_options: options.auto_add_unknown_options === true,
  });
}

/**
 * `record_rdt_wave` — stamps one wave date across many employees.
 *
 * @param {Array<string>} employeeIds
 * @param {'rdt_1'|'rdt_2'|'rdt'} wave
 * @param {string} date ISO 'YYYY-MM-DD'
 * @returns {Promise<{updated: number, not_found: Array<string>}>}
 */
export function recordRdtWave(employeeIds, wave, date) {
  return api.call('record_rdt_wave', { employee_ids: employeeIds, wave, date });
}

/* ---------- Field options cache ------------------------------------------- */

/**
 * Dropdown options change perhaps twice a year, and the list filters plus the
 * form need them on every draw. Caching the in-flight promise means the two
 * pages that mount together share one request, and a redraw does not fire
 * another.
 *
 * Kept here rather than in state.js UI because it belongs to the server, not to
 * the session — but it is deliberately module-scoped, so a full page reload
 * (which is what a sign-out amounts to for admins) starts clean.
 */
let optionsPromise = null;

/**
 * The `{list_key: [{option_value, sort_order, active}]}` map, fetched once.
 *
 * @param {{force?: boolean}} [opts] force a refetch after a lists edit
 * @returns {Promise<Object<string, Array>>}
 */
export function loadFieldOptions(opts) {
  if (!optionsPromise || (opts && opts.force)) {
    optionsPromise = listFieldOptions()
      .then((data) => (data && data.options) || {})
      .catch((err) => {
        optionsPromise = null; // let the next caller retry
        throw err;
      });
  }
  return optionsPromise;
}
