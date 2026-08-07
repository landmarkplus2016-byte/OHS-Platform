/**
 * Equipment.gs — every equipment action in CLAUDE.md Section 3.6.
 *
 * Same shape as Employees.gs:
 *   1. permission gate     requireModuleView / requireModuleEdit ('equipment')
 *   2. payload validation   unknown keys rejected, field errors collected
 *   3. sheet work           through Sheets.gs only
 *   4. derivation           deriveEquipmentDerived on every returned row
 *
 * Two things are specific to this module:
 *
 *   Every response joins the team leader. Employees is read once per request
 *   (equipmentEmployeesById_) and reused for the `team_leader_name` /
 *   `team_leader_archived` columns and for the "owner archived" warning inside
 *   deriveEquipmentDerived, so rendering a list never costs the frontend a
 *   second call (Section 3.6).
 *
 *   Rejection is the soft delete (rule 6). A rejected item keeps its row, its
 *   serial numbers, and its inspection history forever; only the flag moves, and
 *   only through reject_equipment / unreject_equipment.
 */

// ---------------------------------------------------------------------------
// Column groups (CLAUDE.md Section 2, Equipment tab)
// ---------------------------------------------------------------------------

/** Dropdown columns → the FieldOptions list that governs them. */
/*
 * `subcontractor` shares the employees' `subcontractors` list rather than
 * getting one of its own. A company that supplies people supplies their gear;
 * two lists would drift the moment somebody renamed "Upper" on one of them.
 */
var EQUIPMENT_OPTION_FIELDS = {
  item: 'equipment_items',
  brand: 'equipment_brands',
  subcontractor: 'subcontractors'
};

/** Dropdowns bulk import may extend when `auto_add_unknown_options` is set. */
var EQUIPMENT_AUTO_ADD_FIELDS = ['item', 'brand', 'subcontractor'];

/** The only two results a completed wave can carry (Section 2). */
var EQUIPMENT_WAVE_RESULTS = ['pass', 'fail'];

/**
 * Columns the server owns. Accepted in a payload and ignored rather than
 * rejected as unknown, so a client that echoes back a full equipment object —
 * joined columns included — is not punished for it (Section 3.9).
 *
 * `rejected` is in here because it is never written through update_equipment;
 * handleUpdateEquipment intercepts an attempt to flip it before validation runs
 * and answers `conflict`.
 */
var EQUIPMENT_SERVER_FIELDS = [
  'equipment_id', 'rejected', 'rejection_date', 'rejected_by', 'rejection_reason',
  'created_at', 'created_by', 'updated_at', 'updated_by', 'derived',
  'team_leader_name', 'team_leader_archived'
];

/** Paging defaults for list_equipment (Section 3.6). */
var EQUIPMENT_PAGE_SIZE_DEFAULT = 50;
var EQUIPMENT_PAGE_SIZE_MAX = 200;

/** Row caps: bulk import per call, and the audit view of InspectionHistory. */
var EQUIPMENT_IMPORT_MAX_ROWS = 5000;
var INSPECTION_HISTORY_CAP = 500;

/** @private Built once per execution by equipmentWritableFields_(). */
var EQUIPMENT_WRITABLE_CACHE_ = null;

/** @private Employees, read once per request (Section 3.6). */
var EQUIPMENT_EMPLOYEES_CACHE_ = null;

/**
 * @private
 * Every column a client may write, in schema order.
 * @return {Array<string>}
 */
function equipmentWritableFields_() {
  if (EQUIPMENT_WRITABLE_CACHE_) return EQUIPMENT_WRITABLE_CACHE_;

  var fields = ['team_leader_id', 'subcontractor', 'item', 'brand', 'date_of_manufacture',
    'serial_no', 'third_party_sn', 'third_party_inspection_end_date'];

  for (var w = 0; w < EQUIPMENT_WAVES.length; w++) {
    fields.push('wave_' + EQUIPMENT_WAVES[w] + '_date');
    fields.push('wave_' + EQUIPMENT_WAVES[w] + '_result');
  }
  fields.push('comments');

  EQUIPMENT_WRITABLE_CACHE_ = fields;
  return fields;
}

// ---------------------------------------------------------------------------
// Action handlers — reads
// ---------------------------------------------------------------------------

/**
 * `list_equipment` — paged, filtered, searched, with derivation and the team
 * leader join on every returned row (Section 3.6).
 *
 * `filters.worst_state` keeps the name Section 3.6 gives it, but equipment has
 * no worst_state: its derived block carries `third_party_state` and `verdict`,
 * and the example value in the spec ('blocked') is a verdict. So the filter is
 * matched against `derived.verdict`. As with employees, setting it forces
 * derivation of every matching row before paging.
 *
 * @param {Object} session  Context from validateSession().
 * @param {Object} payload  {include_rejected?, search?, filters?, page?, page_size?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListEquipment(session, payload) {
  var denied = requireModuleView(session, 'equipment');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, [
    'include_rejected', 'search', 'filters', 'page', 'page_size'
  ]);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var filters = (payload && payload.filters) || {};
  if (typeof filters !== 'object' || Array.isArray(filters)) {
    return errResponse('validation_failed', 'invalid_filters', { filters: 'invalid_type' });
  }

  var filterUnknown = collectUnknownKeys_(filters, [
    'item', 'brand', 'subcontractor', 'team_leader_id', 'worst_state'
  ]);
  if (hasKeys_(filterUnknown)) {
    return errResponse('validation_failed', 'unknown_filter_fields', filterUnknown);
  }

  var fieldErrors = {};

  var verdictFilter = normalizeString(filters.worst_state).toLowerCase();
  if (verdictFilter !== '' && !isVerdict_(verdictFilter)) {
    fieldErrors.worst_state = 'invalid_value';
  }

  var page = readPositiveInt_(payload && payload.page, 1);
  if (page === null) fieldErrors.page = 'invalid_number';

  var pageSize = readPositiveInt_(payload && payload.page_size, EQUIPMENT_PAGE_SIZE_DEFAULT);
  if (pageSize === null) fieldErrors.page_size = 'invalid_number';

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  pageSize = Math.min(pageSize, EQUIPMENT_PAGE_SIZE_MAX);

  var includeRejected = normalizeBoolean(payload && payload.include_rejected);
  var search = normalizeString(payload && payload.search).toLowerCase();
  var item = normalizeString(filters.item).toLowerCase();
  var brand = normalizeString(filters.brand).toLowerCase();
  var subcontractor = normalizeString(filters.subcontractor).toLowerCase();
  var teamLeaderId = normalizeString(filters.team_leader_id);

  // --- Cheap filters first, derivation last -------------------------------
  var rows = readAllRows(SHEET_NAMES.EQUIPMENT);
  var matched = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (normalizeString(row.equipment_id) === '') continue;
    if (!includeRejected && normalizeBoolean(row.rejected)) continue;
    if (item !== '' && normalizeString(row.item).toLowerCase() !== item) continue;
    if (brand !== '' && normalizeString(row.brand).toLowerCase() !== brand) continue;
    if (subcontractor !== '' && normalizeString(row.subcontractor).toLowerCase() !== subcontractor) continue;
    if (teamLeaderId !== '' && normalizeString(row.team_leader_id) !== teamLeaderId) continue;
    if (search !== '' && !matchesEquipmentSearch_(row, search)) continue;
    matched.push({ row: row, derived: null });
  }

  matched.sort(compareEquipment_);

  var ctx = equipmentContext_();
  if (verdictFilter !== '') {
    var kept = [];
    for (var v = 0; v < matched.length; v++) {
      matched[v].derived = deriveEquipment_(matched[v].row, ctx);
      if (matched[v].derived.verdict === verdictFilter) kept.push(matched[v]);
    }
    matched = kept;
  }

  var start = (page - 1) * pageSize;
  var slice = matched.slice(start, start + pageSize);

  var equipment = [];
  for (var s = 0; s < slice.length; s++) {
    var derived = slice[s].derived || deriveEquipment_(slice[s].row, ctx);
    equipment.push(shapeEquipment_(slice[s].row, derived, ctx.employeesById));
  }

  return okResponse({
    equipment: equipment,
    total_matching: matched.length,
    page: page,
    page_size: pageSize
  });
}

/**
 * `get_equipment` — one item, its inspection history, and the resolved team
 * leader (Section 3.6).
 *
 * `team_leader` is null when the item is unassigned, and also when the stored
 * `team_leader_id` no longer resolves — the raw id stays on the object either
 * way, so a dangling reference is visible rather than silently blanked.
 *
 * @param {Object} session
 * @param {Object} payload  {equipment_id}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleGetEquipment(session, payload) {
  var denied = requireModuleView(session, 'equipment');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['equipment_id']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var equipmentId = normalizeString(payload && payload.equipment_id);
  if (equipmentId === '') {
    return errResponse('validation_failed', 'invalid_payload', { equipment_id: 'required' });
  }

  var row = readRowByKey(SHEET_NAMES.EQUIPMENT, 'equipment_id', equipmentId);
  if (!row) return errResponse('not_found', 'equipment_not_found');

  var ctx = equipmentContext_();

  return okResponse({
    equipment: shapeEquipment_(row, deriveEquipment_(row, ctx), ctx.employeesById),
    inspection_history: inspectionHistoryFor_(equipmentId),
    team_leader: shapeTeamLeader_(ctx.employeesById[normalizeString(row.team_leader_id)])
  });
}

/**
 * `list_inspection_history` — the append-only third-party inspection log
 * (Section 3.6).
 *
 * With no `equipment_id` this is the audit view: the whole tab, newest first,
 * capped at INSPECTION_HISTORY_CAP rows.
 *
 * @param {Object} session
 * @param {Object} payload  {equipment_id?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListInspectionHistory(session, payload) {
  var denied = requireModuleView(session, 'equipment');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['equipment_id']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var history = inspectionHistoryFor_(normalizeString(payload && payload.equipment_id));

  return okResponse({
    inspection_history: history.slice(0, INSPECTION_HISTORY_CAP),
    total_matching: history.length
  });
}

/**
 * `list_equipment_stats` — the aggregate counts behind the dashboard's
 * equipment KPI row and chart row (CLAUDE.md Section 5.5).
 *
 * The employee twin of this action explains the reasoning: one pass over the
 * tab, only totals on the wire, and the counting rules stated once
 * (list_employee_stats, Employees.gs).
 *
 * Definitions:
 *   totals.active                 non-rejected items
 *   totals.inspections_expired    active items whose third-party date has passed
 *   totals.inspections_urgent     active items expiring within urgent_days
 *   totals.rejected_this_month    items rejected in the current calendar month
 *
 * `rejected_this_month` is the one figure counted over rejected rows — it is a
 * measure of what left the inventory, so excluding rejected items would make it
 * permanently zero.
 *
 * @param {Object} session  Context from validateSession().
 * @param {Object} payload  None.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListEquipmentStats(session, payload) {
  var denied = requireModuleView(session, 'equipment');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, []);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var ctx = equipmentContext_();
  var rows = readAllRows(SHEET_NAMES.EQUIPMENT);
  var monthPrefix = ctx.today.slice(0, 7); // 'YYYY-MM'

  var totals = {
    active: 0,
    inspections_expired: 0,
    inspections_urgent: 0,
    inspections_missing: 0,
    rejected_this_month: 0
  };

  var byVerdict = { cleared: 0, warning: 0, blocked: 0 };
  var byItem = {};   // item type → active items expiring within urgent_days

  // The newest updated_at across the whole tab, rejected rows included — the
  // settings Data tab reports it as this module's health, and a rejection is
  // just as much a sign of life as an edit.
  var lastUpdatedAt = '';

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (normalizeString(row.equipment_id) === '') continue;

    var updatedAt = normalizeIsoDateTime(row.updated_at);
    if (updatedAt > lastUpdatedAt) lastUpdatedAt = updatedAt;

    if (normalizeBoolean(row.rejected)) {
      if (normalizeIsoDate(row.rejection_date).slice(0, 7) === monthPrefix) {
        totals.rejected_this_month++;
      }
      continue;
    }

    var derived = deriveEquipment_(row, ctx);
    totals.active++;

    if (byVerdict[derived.verdict] !== undefined) byVerdict[derived.verdict]++;

    if (derived.third_party_state === CERT_STATES.EXPIRED) {
      totals.inspections_expired++;
    } else if (derived.third_party_state === CERT_STATES.URGENT) {
      totals.inspections_urgent++;

      var item = normalizeString(row.item);
      if (item !== '') byItem[item] = (byItem[item] || 0) + 1;
    } else if (derived.third_party_state === CERT_STATES.MISSING) {
      totals.inspections_missing++;
    }
  }

  return okResponse({
    generated_at: nowIso(),
    today: ctx.today,
    thresholds: ctx.thresholds,
    totals: totals,
    last_updated_at: lastUpdatedAt,
    by_verdict: byVerdict,
    by_item: countMapToList_(byItem, 'item')
  });
}

// ---------------------------------------------------------------------------
// Action handlers — writes
// ---------------------------------------------------------------------------

/**
 * `create_equipment` — inserts one item (Section 3.6).
 *
 * The uniqueness checks on both serial numbers and the ID reservation happen
 * inside the same script lock, for the reason create_employee does it: two
 * admins submitting the same serial in the same second would each see a clean
 * check and both write.
 *
 * @param {Object} session
 * @param {Object} payload  The equipment object, minus every server-set field.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleCreateEquipment(session, payload) {
  var denied = requireModuleEdit(session, 'equipment');
  if (denied) return denied;

  var input = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('create_equipment: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var rows = readAllRows(SHEET_NAMES.EQUIPMENT);
    var validation = validateEquipmentInput_(input, {
      mode: 'create',
      selfId: '',
      serialIndex: equipmentSerialIndex_(rows, 'serial_no'),
      thirdPartyIndex: equipmentSerialIndex_(rows, 'third_party_sn'),
      employeesById: equipmentEmployeesById_(),
      autoAdd: false,
      pendingOptions: {},
      listAdded: {}
    });

    if (hasKeys_(validation.errors)) {
      return errResponse('validation_failed', 'invalid_equipment', validation.errors);
    }

    var stampedAt = nowIso();
    var newRow = validation.values;
    newRow.equipment_id = reserveEquipmentIds_(1, equipmentIdIndex_(rows), session.user.user_id)[0];
    newRow.rejected = 'FALSE';
    newRow.rejection_date = '';
    newRow.rejected_by = '';
    newRow.rejection_reason = '';
    newRow.created_at = stampedAt;
    newRow.created_by = session.user.user_id;
    newRow.updated_at = stampedAt;
    newRow.updated_by = session.user.user_id;

    appendRow(SHEET_NAMES.EQUIPMENT, newRow);

    var ctx = equipmentContext_();
    return okResponse({
      equipment: shapeEquipment_(newRow, deriveEquipment_(newRow, ctx), ctx.employeesById)
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * `update_equipment` — merges a partial update into one item (Section 3.6).
 *
 * Two rules from the spec:
 *   - `rejected` never moves through here. The spec calls out true→false as a
 *     `conflict`; false→true is refused the same way, because it would set the
 *     flag without the rejection date, reason, and author that reject_equipment
 *     stamps.
 *   - a changed `third_party_inspection_end_date` appends an InspectionHistory
 *     row, which is the only record of who extended an inspection and when.
 *
 * A rejected item stays editable. Unlike an archived employee (whose record is
 * frozen), rejected equipment is often still being corrected — a serial typo, a
 * reassignment — and Section 3.6 restricts only the flag itself.
 *
 * @param {Object} session
 * @param {Object} payload  {equipment_id, updates}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleUpdateEquipment(session, payload) {
  var denied = requireModuleEdit(session, 'equipment');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['equipment_id', 'updates']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var equipmentId = normalizeString(payload && payload.equipment_id);
  var updates = payload && payload.updates;

  var fieldErrors = {};
  if (equipmentId === '') fieldErrors.equipment_id = 'required';
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    fieldErrors.updates = 'required';
  }
  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('update_equipment: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var rows = readAllRows(SHEET_NAMES.EQUIPMENT);
    var current = findEquipmentRow_(rows, equipmentId);
    if (!current) return errResponse('not_found', 'equipment_not_found');

    var isRejected = normalizeBoolean(current.rejected);
    if (has_(updates, 'rejected') && normalizeBoolean(updates.rejected) !== isRejected) {
      return errResponse('conflict', isRejected ? 'use_unreject_equipment' : 'use_reject_equipment');
    }

    var validation = validateEquipmentInput_(updates, {
      mode: 'update',
      selfId: equipmentId,
      serialIndex: equipmentSerialIndex_(rows, 'serial_no'),
      thirdPartyIndex: equipmentSerialIndex_(rows, 'third_party_sn'),
      employeesById: equipmentEmployeesById_(),
      autoAdd: false,
      pendingOptions: {},
      listAdded: {}
    });

    if (hasKeys_(validation.errors)) {
      return errResponse('validation_failed', 'invalid_equipment', validation.errors);
    }

    var stampedAt = nowIso();
    var changes = validation.values;
    changes.updated_at = stampedAt;
    changes.updated_by = session.user.user_id;

    var historyRows = inspectionRowsForChanges_(
      current, changes, stampedAt, session.user.user_id, nextInspectionNumber_()
    );

    var merged = updateRowByKey(SHEET_NAMES.EQUIPMENT, 'equipment_id', equipmentId, changes);
    if (!merged) return errResponse('not_found', 'equipment_not_found');

    appendRows(SHEET_NAMES.INSPECTION_HISTORY, historyRows);

    var ctx = equipmentContext_();
    return okResponse({
      equipment: shapeEquipment_(merged, deriveEquipment_(merged, ctx), ctx.employeesById)
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * `reject_equipment` — the soft delete (Section 3.6). Idempotent.
 *
 * `rejection_date` defaults to today when the payload omits it; `rejected_by`
 * always comes from the session, never the client (Section 3.9).
 *
 * @param {Object} session
 * @param {Object} payload  {equipment_id, rejection_date?, rejection_reason?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleRejectEquipment(session, payload) {
  var denied = requireModuleEdit(session, 'equipment');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['equipment_id', 'rejection_date', 'rejection_reason']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var equipmentId = normalizeString(payload && payload.equipment_id);
  var rawDate = payload && payload.rejection_date;

  var fieldErrors = {};
  if (equipmentId === '') fieldErrors.equipment_id = 'required';

  var rejectionDate = todayIso();
  if (normalizeString(rawDate) !== '') {
    rejectionDate = normalizeIsoDate(rawDate);
    if (rejectionDate === '') fieldErrors.rejection_date = 'invalid_format';
  }

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  var current = readRowByKey(SHEET_NAMES.EQUIPMENT, 'equipment_id', equipmentId);
  if (!current) return errResponse('not_found', 'equipment_not_found');

  var ctx = equipmentContext_();

  // Already rejected — return the row as-is rather than re-stamping who did it.
  if (normalizeBoolean(current.rejected)) {
    return okResponse({
      equipment: shapeEquipment_(current, deriveEquipment_(current, ctx), ctx.employeesById)
    });
  }

  var stampedAt = nowIso();
  var merged = updateRowByKey(SHEET_NAMES.EQUIPMENT, 'equipment_id', equipmentId, {
    rejected: 'TRUE',
    rejection_date: rejectionDate,
    rejected_by: session.user.user_id,
    rejection_reason: normalizeString(payload && payload.rejection_reason),
    updated_at: stampedAt,
    updated_by: session.user.user_id
  });

  return okResponse({
    equipment: shapeEquipment_(merged, deriveEquipment_(merged, ctx), ctx.employeesById)
  });
}

/**
 * `unreject_equipment` — puts a rejected item back in service (Section 3.6).
 * Idempotent.
 *
 * Both serial numbers are unique across non-rejected equipment only, so another
 * item may have taken either of them while this one sat rejected. That is a
 * `conflict` for the admin to resolve, not something to silently allow.
 *
 * @param {Object} session
 * @param {Object} payload  {equipment_id}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleUnrejectEquipment(session, payload) {
  var denied = requireModuleEdit(session, 'equipment');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['equipment_id']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var equipmentId = normalizeString(payload && payload.equipment_id);
  if (equipmentId === '') {
    return errResponse('validation_failed', 'invalid_payload', { equipment_id: 'required' });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('unreject_equipment: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var rows = readAllRows(SHEET_NAMES.EQUIPMENT);
    var current = findEquipmentRow_(rows, equipmentId);
    if (!current) return errResponse('not_found', 'equipment_not_found');

    var ctx = equipmentContext_();

    if (!normalizeBoolean(current.rejected)) {
      return okResponse({
        equipment: shapeEquipment_(current, deriveEquipment_(current, ctx), ctx.employeesById)
      });
    }

    var collision = serialCollision_(rows, current, equipmentId);
    if (collision) {
      console.warn('unreject_equipment blocked: ' + collision.field + ' held by ' + collision.holder);
      return errResponse('conflict', collision.field + '_taken');
    }

    var stampedAt = nowIso();
    var merged = updateRowByKey(SHEET_NAMES.EQUIPMENT, 'equipment_id', equipmentId, {
      rejected: 'FALSE',
      rejection_date: '',
      rejected_by: '',
      rejection_reason: '',
      updated_at: stampedAt,
      updated_by: session.user.user_id
    });

    return okResponse({
      equipment: shapeEquipment_(merged, deriveEquipment_(merged, ctx), ctx.employeesById)
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * `bulk_import_equipment` — validate everything, then write everything
 * (Section 3.6, same shape and semantics as bulk_import_employees).
 *
 * All-or-nothing: one bad row rejects the whole call and the Sheet is untouched.
 * Duplicates are matched on `serial_no` — the identity an inventory spreadsheet
 * actually carries — and `third_party_sn` is still checked for collisions
 * against every other item.
 *
 * Unknown dropdown values requested via `auto_add_unknown_options` are held in
 * memory during validation and only written once every row has passed — the
 * FieldOptions tab must not grow new entries for an import that gets rejected.
 *
 * @param {Object} session
 * @param {Object} payload  {rows, on_duplicate?, auto_add_unknown_options?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleBulkImportEquipment(session, payload) {
  var denied = requireModuleEdit(session, 'equipment');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['rows', 'on_duplicate', 'auto_add_unknown_options']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var inputRows = payload && payload.rows;
  var onDuplicate = normalizeString(payload && payload.on_duplicate) || 'skip';
  var autoAdd = normalizeBoolean(payload && payload.auto_add_unknown_options);

  var fieldErrors = {};
  if (!Array.isArray(inputRows) || inputRows.length === 0) {
    fieldErrors.rows = 'required';
  } else if (inputRows.length > EQUIPMENT_IMPORT_MAX_ROWS) {
    fieldErrors.rows = 'too_many';
  }
  if (onDuplicate !== 'skip' && onDuplicate !== 'overwrite') {
    fieldErrors.on_duplicate = 'invalid_value';
  }
  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('bulk_import_equipment: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var pairs = readAllRowsWithIndex(SHEET_NAMES.EQUIPMENT);
    var existingRows = [];
    for (var e = 0; e < pairs.length; e++) existingRows.push(pairs[e].data);

    var serialIndex = equipmentSerialIndex_(existingRows, 'serial_no');
    var thirdPartyIndex = equipmentSerialIndex_(existingRows, 'third_party_sn');
    var employeesById = equipmentEmployeesById_();

    var rowByEquipmentId = {};
    for (var x = 0; x < pairs.length; x++) {
      var xid = normalizeString(pairs[x].data.equipment_id);
      if (xid !== '') rowByEquipmentId[xid] = pairs[x];
    }

    var pendingOptions = {};
    var listAdded = {};
    var rowErrors = [];
    var plan = [];
    var payloadSerials = {};
    var payloadThirdPartySerials = {};

    // --- Pass 1: validate every row, write nothing -------------------------
    for (var i = 0; i < inputRows.length; i++) {
      var input = inputRows[i];
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        rowErrors.push({ row: i, errors: { row: 'invalid_type' } });
        continue;
      }

      var serial = normalizeString(input.serial_no).toLowerCase();
      var thirdPartySn = normalizeString(input.third_party_sn).toLowerCase();

      // Two rows in one file claiming the same serial is always an error; there
      // is no policy under which both could be applied.
      if (serial !== '' && payloadSerials[serial] !== undefined) {
        rowErrors.push({ row: i, errors: { serial_no: 'duplicate_in_payload' } });
        continue;
      }
      if (thirdPartySn !== '' && payloadThirdPartySerials[thirdPartySn] !== undefined) {
        rowErrors.push({ row: i, errors: { third_party_sn: 'duplicate_in_payload' } });
        continue;
      }

      var existingId = serial === '' ? undefined : serialIndex[serial];
      var isDuplicate = existingId !== undefined;
      var mode = (isDuplicate && onDuplicate === 'overwrite') ? 'update' : 'create';
      var currentRow = isDuplicate ? rowByEquipmentId[existingId] : null;

      // A row being skipped is still validated — Section 3.6 rejects the whole
      // import if any row is invalid, whether or not it would have been applied.
      var validation = validateEquipmentInput_(input, {
        mode: mode,
        selfId: isDuplicate ? existingId : '',
        serialIndex: serialIndex,
        thirdPartyIndex: thirdPartyIndex,
        employeesById: employeesById,
        autoAdd: autoAdd,
        pendingOptions: pendingOptions,
        listAdded: listAdded
      });

      if (hasKeys_(validation.errors)) {
        rowErrors.push({ row: i, errors: validation.errors });
        continue;
      }

      if (serial !== '') payloadSerials[serial] = true;
      if (thirdPartySn !== '') payloadThirdPartySerials[thirdPartySn] = true;

      if (isDuplicate && onDuplicate === 'skip') {
        plan.push({ action: 'skip' });
      } else if (isDuplicate) {
        plan.push({ action: 'update', target: currentRow, values: validation.values });
      } else {
        plan.push({ action: 'create', values: validation.values });
      }
    }

    if (rowErrors.length > 0) {
      return rowErrorResponse_(rowErrors);
    }

    // --- Pass 2: write ------------------------------------------------------
    var actingUserId = session.user.user_id;
    var stampedAt = nowIso();

    for (var listKey in pendingOptions) {
      if (!Object.prototype.hasOwnProperty.call(pendingOptions, listKey)) continue;
      for (var pendingValue in pendingOptions[listKey]) {
        if (!Object.prototype.hasOwnProperty.call(pendingOptions[listKey], pendingValue)) continue;
        addFieldOption(listKey, pendingOptions[listKey][pendingValue], actingUserId);
      }
    }

    var creates = [];
    for (var c = 0; c < plan.length; c++) {
      if (plan[c].action === 'create') creates.push(plan[c]);
    }

    var newIds = reserveEquipmentIds_(creates.length, equipmentIdIndex_(existingRows), actingUserId);
    var newRows = [];
    for (var n = 0; n < creates.length; n++) {
      var newRow = creates[n].values;
      newRow.equipment_id = newIds[n];
      newRow.rejected = 'FALSE';
      newRow.rejection_date = '';
      newRow.rejected_by = '';
      newRow.rejection_reason = '';
      newRow.created_at = stampedAt;
      newRow.created_by = actingUserId;
      newRow.updated_at = stampedAt;
      newRow.updated_by = actingUserId;
      newRows.push(newRow);
    }

    var rowUpdates = [];
    var historyRows = [];
    var historyNumber = nextInspectionNumber_();
    var updatedCount = 0;
    var skippedCount = 0;

    for (var u = 0; u < plan.length; u++) {
      if (plan[u].action === 'skip') {
        skippedCount++;
        continue;
      }
      if (plan[u].action !== 'update') continue;

      var changes = plan[u].values;
      changes.updated_at = stampedAt;
      changes.updated_by = actingUserId;

      var rows = inspectionRowsForChanges_(
        plan[u].target.data, changes, stampedAt, actingUserId, historyNumber
      );
      historyNumber += rows.length;
      for (var h = 0; h < rows.length; h++) historyRows.push(rows[h]);

      rowUpdates.push({ row: plan[u].target.row, data: changes });
      updatedCount++;
    }

    updateRowsAt(SHEET_NAMES.EQUIPMENT, rowUpdates);
    appendRows(SHEET_NAMES.EQUIPMENT, newRows);
    appendRows(SHEET_NAMES.INSPECTION_HISTORY, historyRows);

    return okResponse({
      added: newRows.length,
      updated: updatedCount,
      skipped: skippedCount,
      list_added: listAdded
    });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * @private
 * Validates and normalizes a client-supplied equipment object into sheet-ready
 * values.
 *
 * On `create` the two required columns are enforced; on `update` only the keys
 * actually present are touched, so a partial update never blanks a column it did
 * not mention.
 *
 * Required is exactly what Section 2 marks required — `serial_no` and
 * `third_party_sn`. `item` and `brand` are validated against FieldOptions when
 * present but may be blank, which is what lets a legacy inventory sheet import
 * before its dropdown lists have been curated.
 *
 * A wave result with no matching wave date is accepted rather than rejected:
 * derivation ignores an incomplete wave (Compliance.gs), and an admin part-way
 * through recording a round should not be blocked from saving.
 *
 * @param {Object} input
 * @param {Object} ctx  {mode, selfId, serialIndex, thirdPartyIndex, employeesById,
 *                       autoAdd, pendingOptions, listAdded}
 * @return {{values: Object, errors: Object}}
 */
function validateEquipmentInput_(input, ctx) {
  var errors = {};
  var values = {};
  var isCreate = ctx.mode === 'create';

  var errorsFromUnknown = collectUnknownKeys_(
    input, equipmentWritableFields_().concat(EQUIPMENT_SERVER_FIELDS)
  );
  for (var badKey in errorsFromUnknown) {
    if (Object.prototype.hasOwnProperty.call(errorsFromUnknown, badKey)) {
      errors[badKey] = errorsFromUnknown[badKey];
    }
  }

  // --- serial numbers -------------------------------------------------------
  applySerialField_(values, errors, input, 'serial_no', ctx.serialIndex, ctx, isCreate);
  applySerialField_(values, errors, input, 'third_party_sn', ctx.thirdPartyIndex, ctx, isCreate);

  // --- dropdown columns -----------------------------------------------------
  // A blank clears the field; a non-blank value must exist in its FieldOptions
  // list and is stored with the list's own spelling.
  for (var optionField in EQUIPMENT_OPTION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(EQUIPMENT_OPTION_FIELDS, optionField)) continue;
    if (!has_(input, optionField)) continue;
    applyEquipmentOption_(values, errors, input, optionField,
      EQUIPMENT_OPTION_FIELDS[optionField], ctx);
  }

  // --- team leader ----------------------------------------------------------
  // Blank unassigns. A named leader must exist, archived or not — an assignment
  // survives the owner's archival and surfaces as a warning instead
  // (Section 6.3).
  if (has_(input, 'team_leader_id')) {
    var leaderId = normalizeString(input.team_leader_id);
    if (leaderId === '') {
      values.team_leader_id = '';
    } else if (!ctx.employeesById[leaderId]) {
      errors.team_leader_id = 'unknown_employee';
    } else {
      values.team_leader_id = leaderId;
    }
  }

  // --- dates and wave results -----------------------------------------------
  applyDateField_(values, errors, input, 'date_of_manufacture');
  applyDateField_(values, errors, input, 'third_party_inspection_end_date');

  for (var w = 0; w < EQUIPMENT_WAVES.length; w++) {
    applyDateField_(values, errors, input, 'wave_' + EQUIPMENT_WAVES[w] + '_date');

    var resultField = 'wave_' + EQUIPMENT_WAVES[w] + '_result';
    if (!has_(input, resultField)) continue;

    var result = normalizeString(input[resultField]).toLowerCase();
    if (result === '') {
      values[resultField] = '';
    } else if (EQUIPMENT_WAVE_RESULTS.indexOf(result) === -1) {
      errors[resultField] = 'invalid_value';
    } else {
      values[resultField] = result;
    }
  }

  // --- free text ------------------------------------------------------------
  if (has_(input, 'comments')) values.comments = normalizeString(input.comments);

  return { values: values, errors: errors };
}

/**
 * @private
 * Validates one serial-number column: required, unique across non-rejected
 * equipment, stored with the submitted spelling.
 *
 * On an update the column is only touched when the payload mentions it — but if
 * it is mentioned, it may not be blanked. Section 2 marks both serials required,
 * and an item with no serial cannot be identified in the field.
 */
function applySerialField_(values, errors, input, field, index, ctx, isCreate) {
  if (!isCreate && !has_(input, field)) return;

  var serial = normalizeString(input[field]);
  if (serial === '') {
    errors[field] = 'required';
    return;
  }

  var holder = index[serial.toLowerCase()];
  if (holder !== undefined && holder !== ctx.selfId) {
    errors[field] = 'duplicate';
    return;
  }
  values[field] = serial;
}

/**
 * @private
 * Resolves one dropdown value, auto-adding it when the import allows.
 *
 * Kept local to this module rather than shared with the employee equivalent:
 * each module validates its own dropdowns, and the two differ in which fields
 * may be auto-added.
 */
function applyEquipmentOption_(values, errors, input, field, listKey, ctx) {
  var raw = normalizeString(input[field]);
  if (raw === '') {
    values[field] = '';
    return;
  }

  var canonical = resolveFieldOption(listKey, raw);
  if (canonical !== null) {
    values[field] = canonical;
    return;
  }

  // Options added earlier in this same import are not on the tab yet.
  var pending = ctx.pendingOptions[listKey];
  var lower = raw.toLowerCase();
  if (pending && pending[lower] !== undefined) {
    values[field] = pending[lower];
    return;
  }

  if (ctx.autoAdd && EQUIPMENT_AUTO_ADD_FIELDS.indexOf(field) !== -1) {
    if (!ctx.pendingOptions[listKey]) ctx.pendingOptions[listKey] = {};
    ctx.pendingOptions[listKey][lower] = raw;

    if (!ctx.listAdded[field]) ctx.listAdded[field] = [];
    ctx.listAdded[field].push(raw);

    values[field] = raw;
    return;
  }

  errors[field] = 'unknown_option';
}

// ---------------------------------------------------------------------------
// Derivation and output shaping
// ---------------------------------------------------------------------------

/**
 * @private
 * The per-request derivation inputs, including the Employees join.
 *
 * Every loader behind this is cached, so calling it once per handler costs one
 * read each of Config, ModuleSettings, and Employees for the whole request
 * (Sections 3.6, 6.5).
 *
 * @return {{today: string, thresholds: Object, moduleSettings: Object,
 *           employeesById: Object<string, Object>}}
 */
function equipmentContext_() {
  return {
    today: todayIso(),
    thresholds: getComplianceThresholds(),
    moduleSettings: getModuleSettingsMap(),
    employeesById: equipmentEmployeesById_()
  };
}

/** @private deriveEquipmentDerived with the request context already applied. */
function deriveEquipment_(row, ctx) {
  return deriveEquipmentDerived(
    row, ctx.today, ctx.thresholds, ctx.moduleSettings, ctx.employeesById
  );
}

/**
 * @private
 * {employee_id → Employees row} for the whole tab, archived included, read once
 * per request.
 *
 * Archived employees must stay in the map: they are exactly the rows that make
 * deriveEquipmentDerived raise its "owner archived" warning, and dropping them
 * would turn that warning into a silently blank team leader name.
 *
 * @return {Object<string, Object>}
 */
function equipmentEmployeesById_() {
  if (EQUIPMENT_EMPLOYEES_CACHE_) return EQUIPMENT_EMPLOYEES_CACHE_;

  var rows = readAllRows(SHEET_NAMES.EMPLOYEES);
  var byId = {};
  for (var i = 0; i < rows.length; i++) {
    var id = normalizeString(rows[i].employee_id);
    if (id !== '') byId[id] = rows[i];
  }

  EQUIPMENT_EMPLOYEES_CACHE_ = byId;
  return byId;
}

/**
 * @private
 * Converts a raw Equipment row into the API shape: real booleans, ISO dates,
 * every column present, the team leader joined, and the derived block attached.
 *
 * Columns are emitted whether or not the Sheet holds a value, so the frontend
 * never has to guard for undefined on a field it knows the schema has.
 */
function shapeEquipment_(row, derived, employeesById) {
  var leaderId = normalizeString(row.team_leader_id);
  var leader = (leaderId !== '' && employeesById) ? employeesById[leaderId] : null;

  var out = {
    equipment_id: normalizeString(row.equipment_id),
    team_leader_id: leaderId,
    team_leader_name: leader ? normalizeString(leader.name) : '',
    team_leader_archived: leader ? normalizeBoolean(leader.archived) : false,
    subcontractor: normalizeString(row.subcontractor),
    item: normalizeString(row.item),
    brand: normalizeString(row.brand),
    date_of_manufacture: normalizeIsoDate(row.date_of_manufacture),
    serial_no: normalizeString(row.serial_no),
    third_party_sn: normalizeString(row.third_party_sn),
    third_party_inspection_end_date: normalizeIsoDate(row.third_party_inspection_end_date),
    comments: normalizeString(row.comments),
    rejected: normalizeBoolean(row.rejected),
    rejection_date: normalizeIsoDate(row.rejection_date),
    rejected_by: normalizeString(row.rejected_by),
    rejection_reason: normalizeString(row.rejection_reason),
    created_at: normalizeIsoDateTime(row.created_at),
    created_by: normalizeString(row.created_by),
    updated_at: normalizeIsoDateTime(row.updated_at),
    updated_by: normalizeString(row.updated_by)
  };

  for (var w = 0; w < EQUIPMENT_WAVES.length; w++) {
    var n = EQUIPMENT_WAVES[w];
    out['wave_' + n + '_date'] = normalizeIsoDate(row['wave_' + n + '_date']);
    out['wave_' + n + '_result'] = normalizeString(row['wave_' + n + '_result']).toLowerCase();
  }

  out.derived = derived;
  return out;
}

/**
 * @private
 * The team leader block on get_equipment: enough to render the assignment and
 * link through to the employee, nothing more.
 *
 * @param {Object|undefined} employeeRow
 * @return {Object|null}
 */
function shapeTeamLeader_(employeeRow) {
  if (!employeeRow) return null;

  return {
    employee_id: normalizeString(employeeRow.employee_id),
    name: normalizeString(employeeRow.name),
    national_id: normalizeString(employeeRow.national_id),
    team: normalizeString(employeeRow.team).toLowerCase(),
    title: normalizeString(employeeRow.title),
    subcontractor: normalizeString(employeeRow.subcontractor),
    employment_status: normalizeString(employeeRow.employment_status),
    archived: normalizeBoolean(employeeRow.archived)
  };
}

// ---------------------------------------------------------------------------
// Inspection history
// ---------------------------------------------------------------------------

/**
 * @private
 * Builds an InspectionHistory row when the third-party inspection end date
 * actually changes (Section 3.6).
 *
 * Only real changes are logged — writing the same date back is not a new
 * inspection, and an append-only tab full of no-op rows is an audit trail nobody
 * reads.
 *
 * Returns an array (of 0 or 1 rows) so callers can accumulate it the same way
 * the employee path accumulates renewal rows.
 *
 * @param {Object} current      The row as it stands.
 * @param {Object} changes      The validated updates about to be applied.
 * @param {string} stampedAt
 * @param {string} actingUserId
 * @param {number} startNumber  First free history sequence number.
 * @return {Array<Object>}
 */
function inspectionRowsForChanges_(current, changes, stampedAt, actingUserId, startNumber) {
  var field = 'third_party_inspection_end_date';
  if (!has_(changes, field)) return [];

  var oldExpiry = normalizeIsoDate(current[field]);
  var newExpiry = normalizeIsoDate(changes[field]);
  if (oldExpiry === newExpiry) return [];

  return [{
    history_id: 'IH-' + padNumber_(startNumber, 4),
    equipment_id: normalizeString(current.equipment_id),
    old_expiry: oldExpiry,
    new_expiry: newExpiry,
    renewed_at: stampedAt,
    renewed_by: actingUserId
  }];
}

/**
 * @private
 * InspectionHistory rows for one item, newest first. A blank `equipmentId`
 * means everything — the audit view.
 *
 * @param {string} equipmentId
 * @return {Array<Object>}
 */
function inspectionHistoryFor_(equipmentId) {
  var rows = readAllRows(SHEET_NAMES.INSPECTION_HISTORY);
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (equipmentId !== '' && normalizeString(rows[i].equipment_id) !== equipmentId) continue;

    out.push({
      history_id: normalizeString(rows[i].history_id),
      equipment_id: normalizeString(rows[i].equipment_id),
      old_expiry: normalizeIsoDate(rows[i].old_expiry),
      new_expiry: normalizeIsoDate(rows[i].new_expiry),
      renewed_at: normalizeIsoDateTime(rows[i].renewed_at),
      renewed_by: normalizeString(rows[i].renewed_by)
    });
  }

  out.sort(function (a, b) {
    if (a.renewed_at === b.renewed_at) return 0;
    return a.renewed_at > b.renewed_at ? -1 : 1;
  });
  return out;
}

/**
 * @private
 * The next free InspectionHistory sequence number.
 *
 * Derived from the highest existing `IH-####` rather than a Config counter, for
 * the reason nextHistoryNumber_ gives: Section 2 gives Config counters to
 * employee, equipment, and vehicle IDs only, and history rows are only ever
 * appended under the same script lock that writes them.
 *
 * @return {number}
 */
function nextInspectionNumber_() {
  var rows = readAllRows(SHEET_NAMES.INSPECTION_HISTORY);
  var max = 0;

  for (var i = 0; i < rows.length; i++) {
    var match = normalizeString(rows[i].history_id).match(/(\d+)\s*$/);
    if (!match) continue;
    var num = Number(match[1]);
    if (isFinite(num) && num > max) max = num;
  }
  return max + 1;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** @private True for one of the three verdicts (Section 6.3). */
function isVerdict_(value) {
  return value === VERDICTS.CLEARED || value === VERDICTS.WARNING || value === VERDICTS.BLOCKED;
}

/**
 * @private
 * Case-insensitive contains across both serials, item, and owning
 * subcontractor (Section 3.6).
 *
 * The subcontractor is searchable as well as filterable because the question
 * asked at a desk is usually "show me Upper's gear", and typing the name is
 * faster than reaching for the filter.
 */
function matchesEquipmentSearch_(row, lowerQuery) {
  if (normalizeString(row.serial_no).toLowerCase().indexOf(lowerQuery) !== -1) return true;
  if (normalizeString(row.third_party_sn).toLowerCase().indexOf(lowerQuery) !== -1) return true;
  if (normalizeString(row.subcontractor).toLowerCase().indexOf(lowerQuery) !== -1) return true;
  return normalizeString(row.item).toLowerCase().indexOf(lowerQuery) !== -1;
}

/** @private Item type, then serial — the order every equipment list renders in. */
function compareEquipment_(a, b) {
  var aItem = normalizeString(a.row.item).toLowerCase();
  var bItem = normalizeString(b.row.item).toLowerCase();
  if (aItem !== bItem) return aItem < bItem ? -1 : 1;

  var aSerial = normalizeString(a.row.serial_no).toLowerCase();
  var bSerial = normalizeString(b.row.serial_no).toLowerCase();
  if (aSerial === bSerial) return 0;
  return aSerial < bSerial ? -1 : 1;
}

/** @private Linear lookup in an already-loaded row set. */
function findEquipmentRow_(rows, equipmentId) {
  for (var i = 0; i < rows.length; i++) {
    if (normalizeString(rows[i].equipment_id) === equipmentId) return rows[i];
  }
  return null;
}

/**
 * @private
 * {lowercased serial → equipment_id} across non-rejected equipment only.
 *
 * Uniqueness is scoped to active equipment (Section 3.6), so a serial freed by a
 * rejection can be reused — which is what makes unrejecting a collision worth
 * checking for.
 *
 * @param {Array<Object>} rows
 * @param {string} column  'serial_no' or 'third_party_sn'
 * @return {Object<string, string>}
 */
function equipmentSerialIndex_(rows, column) {
  var index = {};
  for (var i = 0; i < rows.length; i++) {
    if (normalizeBoolean(rows[i].rejected)) continue;

    // A row with no equipment_id is not a real item — a half-typed line left in
    // the tab. Indexing it would hand callers an ID that resolves to nothing.
    var equipmentId = normalizeString(rows[i].equipment_id);
    if (equipmentId === '') continue;

    var serial = normalizeString(rows[i][column]).toLowerCase();
    if (serial === '') continue;
    index[serial] = equipmentId;
  }
  return index;
}

/** @private {equipment_id → true} for every row, rejected included. */
function equipmentIdIndex_(rows) {
  var index = {};
  for (var i = 0; i < rows.length; i++) {
    var id = normalizeString(rows[i].equipment_id);
    if (id !== '') index[id] = true;
  }
  return index;
}

/**
 * @private
 * Whether either of a rejected item's serials is now held by an active one.
 *
 * @param {Array<Object>} rows
 * @param {Object} current
 * @param {string} equipmentId
 * @return {{field: string, holder: string}|null}
 */
function serialCollision_(rows, current, equipmentId) {
  var columns = ['serial_no', 'third_party_sn'];

  for (var c = 0; c < columns.length; c++) {
    var serial = normalizeString(current[columns[c]]).toLowerCase();
    if (serial === '') continue;

    var holder = equipmentSerialIndex_(rows, columns[c])[serial];
    if (holder !== undefined && holder !== equipmentId) {
      return { field: columns[c], holder: holder };
    }
  }
  return null;
}

/**
 * @private
 * Reserves a block of equipment IDs and advances Config.next_equipment_number.
 *
 * MUST be called inside a script lock — read-increment-write on the counter is
 * exactly the race Section 3.9 puts the lock there for.
 *
 * Any candidate already present on the tab is skipped rather than reused, so a
 * counter that drifted behind reality (a manual Sheet edit, a restored backup)
 * self-heals instead of producing a duplicate primary key.
 *
 * @param {number} count
 * @param {Object<string, boolean>} existingIds
 * @param {string} actingUserId
 * @return {Array<string>}
 */
function reserveEquipmentIds_(count, existingIds, actingUserId) {
  if (count <= 0) return [];

  var prefix = getConfigValue('equipment_id_prefix', 'LM-EQP-');
  var next = Math.floor(getConfigNumber('next_equipment_number', 1));
  if (!isFinite(next) || next < 1) next = 1;

  var ids = [];
  while (ids.length < count) {
    var candidate = prefix + padNumber_(next, 4);
    next++;
    if (existingIds[candidate]) continue;
    ids.push(candidate);
  }

  writeConfigCounter_('next_equipment_number', next, actingUserId);
  return ids;
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

/**
 * One-shot: adds the `subcontractor` column to the Equipment tab.
 *
 * Run once from the Apps Script editor after deploying this version. It is
 * idempotent — a column that already exists is left alone — so re-running after
 * a failure is safe.
 *
 * Nothing is backfilled. The column is text, blank is a legal value meaning
 * "not recorded", and there is no honest default: guessing that every existing
 * row is in-house would be inventing ownership data. Rows get their owner from
 * the import, or from the equipment form, one deliberate act at a time.
 *
 * Until it has run the platform still works: a missing column reads as
 * undefined, normalizeString turns that into '', and every piece of equipment
 * behaves exactly as it did before — it simply has no owner on file. That
 * degradation is deliberate, because the frontend deploys by pushing to main
 * and the Sheet cannot be migrated in the same instant.
 *
 * @return {{added: boolean, column_index: number}}
 */
function addEquipmentSubcontractorColumn() {
  var sheet = getSheet(SHEET_NAMES.EQUIPMENT);
  var headers = getHeaders(SHEET_NAMES.EQUIPMENT).slice();

  var existing = headers.indexOf('subcontractor');
  if (existing !== -1) {
    console.log('addEquipmentSubcontractorColumn: nothing to do — column already at index ' +
      (existing + 1));
    return { added: false, column_index: existing + 1 };
  }

  headers.push('subcontractor');
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  clearSheetCache();
  console.log('addEquipmentSubcontractorColumn: added column at index ' + headers.length);
  return { added: true, column_index: headers.length };
}
