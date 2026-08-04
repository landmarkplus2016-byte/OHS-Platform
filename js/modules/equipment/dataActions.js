/* ==========================================================================
   equipment/dataActions.js — the equipment module's only door to the server.

   Rule 9: pages never call api.call directly. They call these wrappers, so the
   action names and payload shapes from Section 3.6 are written down in exactly
   one place. If the API contract changes, this file changes and no page does.

   Every function returns the `data` block or rejects with an ApiError — api.js
   has already unwrapped the envelope and dealt with involuntary logout.

   ONE BORROWED ACTION
   -------------------
   listAssignableEmployees() calls `list_employees`. That is not a module
   isolation break: rule 12 forbids importing from another module's *folder*,
   and the Apps Script API is shared ground — equipment rows carry a
   `team_leader_id` that references an employee, so the form has to offer real
   employees to pick from. It is gated on the caller having view permission for
   employees, because the server will answer `forbidden` otherwise; the form
   falls back to a plain ID input in that case.
   ========================================================================== */

import { api } from '../../api.js';

/* ---------- Reads --------------------------------------------------------- */

/**
 * `list_equipment` — paged and filtered server-side.
 *
 * @param {Object} [params] {include_rejected, search, filters, page, page_size}
 * @returns {Promise<{equipment: Array, total_matching: number, page: number, page_size: number}>}
 */
export function listEquipment(params) {
  return api.call('list_equipment', params || {});
}

/**
 * Every item matching a query, by walking `list_equipment` pages until the
 * server runs out.
 *
 * The rejected list needs this: Section 3.6 offers `include_rejected` — "and
 * rejected", not "rejected only" — so that page asks for everything and keeps
 * the rejected rows itself. It over-fetches by roughly the size of the active
 * inventory, which is acceptable at Landmark's scale and honest about the API
 * we have; the alternative is a new server-side filter, which is a spec change
 * that goes through Khaled.
 *
 * `maxPages` is a circuit breaker, not a business limit — it stops a server bug
 * that always reports more rows from turning one page load into an endless
 * request loop.
 *
 * @param {Object} params same as listEquipment, minus page/page_size
 * @param {{pageSize?: number, maxPages?: number}} [opts]
 * @returns {Promise<{equipment: Array, truncated: boolean}>}
 */
export async function listAllEquipment(params, opts) {
  const pageSize = (opts && opts.pageSize) || 200;
  const maxPages = (opts && opts.maxPages) || 20;

  const equipment = [];
  let page = 1;
  let truncated = false;

  for (;;) {
    const data = await listEquipment({ ...params, page, page_size: pageSize });
    equipment.push(...data.equipment);

    if (equipment.length >= data.total_matching || data.equipment.length === 0) break;

    if (page >= maxPages) {
      console.warn('[equipment] page walk hit its cap at', equipment.length, 'rows');
      truncated = true;
      break;
    }
    page += 1;
  }

  return { equipment, truncated };
}

/**
 * `get_equipment` — one item plus its inspection history and resolved team
 * leader.
 *
 * @param {string} equipmentId
 * @returns {Promise<{equipment: Object, inspection_history: Array, team_leader: Object|null}>}
 */
export function getEquipment(equipmentId) {
  return api.call('get_equipment', { equipment_id: equipmentId });
}

/**
 * `list_inspection_history` — omit the id for the audit view across every item.
 *
 * @param {string} [equipmentId]
 * @returns {Promise<{inspection_history: Array, total_matching: number}>}
 */
export function listInspectionHistory(equipmentId) {
  return api.call('list_inspection_history', equipmentId ? { equipment_id: equipmentId } : {});
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

/**
 * Active employees, for the team-leader picker on the form.
 *
 * Walks `list_employees` because the picker needs the whole roster, not a page
 * of it. Rejects with `forbidden` when the signed-in admin cannot view
 * employees — the caller checks the permission first and falls back to a plain
 * ID input.
 *
 * @param {{pageSize?: number, maxPages?: number}} [opts]
 * @returns {Promise<Array<{employee_id: string, name: string, team: string, archived: boolean}>>}
 */
export async function listAssignableEmployees(opts) {
  const pageSize = (opts && opts.pageSize) || 200;
  const maxPages = (opts && opts.maxPages) || 20;

  const employees = [];
  let page = 1;

  for (;;) {
    const data = await api.call('list_employees', {
      include_archived: false,
      page,
      page_size: pageSize,
    });
    employees.push(...data.employees);

    if (employees.length >= data.total_matching || data.employees.length === 0) break;

    if (page >= maxPages) {
      console.warn('[equipment] employee walk hit its cap at', employees.length, 'rows');
      break;
    }
    page += 1;
  }

  return employees.map((employee) => ({
    employee_id: employee.employee_id,
    name: employee.name,
    team: employee.team,
    archived: employee.archived === true,
  }));
}

/* ---------- Writes -------------------------------------------------------- */

/**
 * `create_equipment`.
 *
 * @param {Object} data writable equipment fields only — the server sets
 *        equipment_id, every rejection column and every audit column, and
 *        rejects unknown keys
 * @returns {Promise<{equipment: Object}>}
 */
export function createEquipment(data) {
  return api.call('create_equipment', data);
}

/**
 * `update_equipment` — a partial update. A changed
 * `third_party_inspection_end_date` appends an InspectionHistory row
 * server-side.
 *
 * `rejected` is never sent through here: the server answers `conflict` and
 * points at the dedicated actions below (Section 3.6).
 *
 * @param {string} equipmentId
 * @param {Object} updates
 * @returns {Promise<{equipment: Object}>}
 */
export function updateEquipment(equipmentId, updates) {
  return api.call('update_equipment', { equipment_id: equipmentId, updates });
}

/**
 * `reject_equipment` — the soft delete. Idempotent.
 *
 * @param {string} equipmentId
 * @param {{rejection_date?: string, rejection_reason?: string}} [details]
 * @returns {Promise<{equipment: Object}>}
 */
export function rejectEquipment(equipmentId, details) {
  const payload = { equipment_id: equipmentId };
  const info = details || {};

  if (info.rejection_date) payload.rejection_date = info.rejection_date;
  if (info.rejection_reason) payload.rejection_reason = info.rejection_reason;

  return api.call('reject_equipment', payload);
}

/**
 * `unreject_equipment`. Rejects with `conflict` when another active item has
 * taken either of this one's serial numbers in the meantime.
 *
 * @param {string} equipmentId
 * @returns {Promise<{equipment: Object}>}
 */
export function unrejectEquipment(equipmentId) {
  return api.call('unreject_equipment', { equipment_id: equipmentId });
}

/**
 * `bulk_import_equipment` — all or nothing. On a validation failure the
 * rejected ApiError carries `row_errors`: [{row, errors}].
 *
 * @param {Array<Object>} rows
 * @param {{on_duplicate?: 'skip'|'overwrite', auto_add_unknown_options?: boolean}} [opts]
 * @returns {Promise<{added: number, updated: number, skipped: number, list_added: Object}>}
 */
export function bulkImportEquipment(rows, opts) {
  const options = opts || {};

  return api.call('bulk_import_equipment', {
    rows,
    on_duplicate: options.on_duplicate || 'skip',
    auto_add_unknown_options: options.auto_add_unknown_options === true,
  });
}

/* ---------- Field options cache ------------------------------------------- */

/**
 * Dropdown options change perhaps twice a year, and the list filters plus the
 * form need them on every draw. Caching the in-flight promise means the two
 * pages that mount together share one request, and a redraw does not fire
 * another.
 *
 * Module-scoped on purpose: rule 12 keeps each module's data access inside its
 * own folder, so this is the equipment module's cache and the employee module
 * keeps its own. Two modules mounted in one session cost one extra fetch of a
 * small tab — the price of not sharing mutable state across a module boundary.
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
