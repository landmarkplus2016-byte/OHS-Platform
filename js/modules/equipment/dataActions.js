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
 * `list_equipment_stats` — the aggregate counts the dashboard's equipment
 * section draws (Section 5.5).
 *
 * One call rather than a page walk: the server counts over the whole tab and
 * sends back totals, so the dashboard never pulls the inventory to render four
 * numbers.
 *
 * @returns {Promise<{totals: Object, by_verdict: Object, by_item: Array,
 *                    by_subcontractor: Array, no_subcontractor: Object,
 *                    thresholds: Object}>}
 */
export function listEquipmentStats() {
  return api.call('list_equipment_stats', {});
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

/* ---------- Inspection waves ---------------------------------------------- */

/**
 * `list_inspection_waves` — the wave log (Section 3.6).
 *
 * One action behind two screens. Pass `equipment_id` for one item's history;
 * omit it and pass filters for the fleet-wide review queue.
 *
 * @param {Object} [params] {equipment_id, month, result, recorded_by, origin,
 *        include_voided, search, page, page_size}
 * @returns {Promise<{waves: Array, total_matching: number, page: number, page_size: number}>}
 */
export function listInspectionWaves(params) {
  return api.call('list_inspection_waves', params || {});
}

/**
 * `record_inspection_wave` — file a wave against an item.
 *
 * Resolves with the wave *and* the item's freshly derived block, so the caller
 * can repaint the verdict without a second read.
 *
 * @param {{equipment_id: string, wave_date: string, result: string, comments?: string}} wave
 * @returns {Promise<{wave: Object, derived: Object|null}>}
 */
export function recordInspectionWave(wave) {
  return api.call('record_inspection_wave', {
    equipment_id: wave.equipment_id,
    wave_date: wave.wave_date,
    result: wave.result,
    comments: wave.comments || '',
  });
}

/**
 * `update_inspection_wave` — correct a wave in place.
 *
 * Only the date, the result, and the comment can move. A wave filed against the
 * wrong item is voided and re-filed, never edited across.
 *
 * @param {string} waveId
 * @param {{wave_date?: string, result?: string, comments?: string}} updates
 * @returns {Promise<{wave: Object, derived: Object|null}>}
 */
export function updateInspectionWave(waveId, updates) {
  return api.call('update_inspection_wave', { wave_id: waveId, updates });
}

/**
 * `void_inspection_wave` — stop a wave counting, without deleting it (rule 6).
 *
 * The reason is required by the server, not merely encouraged: a wave that
 * vanishes from the verdict with nothing saying why is the thing voiding exists
 * to prevent.
 *
 * @param {string} waveId
 * @param {string} reason
 * @returns {Promise<{wave: Object, derived: Object|null}>}
 */
export function voidInspectionWave(waveId, reason) {
  return api.call('void_inspection_wave', { wave_id: waveId, reason });
}

/**
 * `approve_inspection_wave` — confirm an officer's finding.
 *
 * The wave starts counting in full from here. Until it does, a pending pass
 * changes nothing about the item's verdict, so this is the act that lets an
 * officer's inspection put equipment back into service.
 *
 * @param {string} waveId
 * @returns {Promise<{wave: Object, derived: Object|null}>}
 */
export function approveInspectionWave(waveId) {
  return api.call('approve_inspection_wave', { wave_id: waveId });
}

/**
 * `reject_inspection_wave` — do not accept an officer's finding.
 *
 * The row stays on the record with the reason on it and stops counting, and the
 * quarter's slot opens up again for a re-inspection.
 *
 * @param {string} waveId
 * @param {string} reason required by the server
 * @returns {Promise<{wave: Object, derived: Object|null}>}
 */
export function rejectInspectionWave(waveId, reason) {
  return api.call('reject_inspection_wave', { wave_id: waveId, reason });
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
