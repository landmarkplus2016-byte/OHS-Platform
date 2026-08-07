/**
 * Employees.gs — every employee action in CLAUDE.md Section 3.5.
 *
 * Shape of every handler:
 *   1. permission gate     requireModuleView / requireModuleEdit ('employees')
 *   2. payload validation   unknown keys rejected, field errors collected
 *   3. sheet work           through Sheets.gs only
 *   4. derivation           deriveEmployeeDerived on every returned row
 *
 * Three rules run through all of it:
 *
 *   Audit fields come from the session, never the payload (Section 3.9).
 *   employee_id, created_at/by, updated_at/by, archived_at/by are set here; if
 *   a client sends them they are dropped without complaint.
 *
 *   Nothing is ever deleted (rule 6). archive_employee flips a flag; the row,
 *   its certificates, and its renewal history stay forever.
 *
 *   Config, FieldOptions, and ModuleSettings are read once per request. Their
 *   loaders cache in module globals that live and die with the execution, so a
 *   200-row list validates and derives against a single read of each tab.
 */

// ---------------------------------------------------------------------------
// Column groups (CLAUDE.md Section 2, Employees tab)
// ---------------------------------------------------------------------------

/** Every certificate on the tab. The last three apply to safety team only. */
var EMPLOYEE_CERT_KEYS = [
  'wah_practical', 'wah_theoretical', 'ra', 'fa', 'ff', 'ec', 'mcu',
  'ppe', 'lifting', 'scaffolding'
];

/** Boolean qualification flags, stored as `qual_<key>`. */
var EMPLOYEE_QUAL_KEYS = ['nebosh', 'iso_45001', 'osha'];

/* Drug testing is not a column on this tab. One employee can be tested many
   times a year, and each test carries a status, a result and notes — that is an
   event log, and it lives on RdtLog (Section 2). Rdt.gs owns all of it. */

/** The only two teams. `team` is immutable after creation. */
var EMPLOYEE_TEAMS = ['field', 'safety'];

/**
 * Dropdown columns → the FieldOptions list that governs them. `title` is absent
 * because its list depends on the team (field_titles vs safety_titles); it is
 * resolved by employeeTitleList_().
 */
var EMPLOYEE_OPTION_FIELDS = {
  contractor: 'contractors',
  subcontractor: 'subcontractors',
  employment_status: 'employment_status',
  legal_permission: 'legal_permission'
};

/**
 * Dropdowns that bulk import may extend when `auto_add_unknown_options` is set.
 *
 * employment_status and legal_permission are deliberately excluded: the verdict
 * rules key off the exact values 'Active' and 'Approved' (Section 6.2), so a
 * misspelled status in a spreadsheet must fail the import rather than quietly
 * become a new option that silently blocks everyone who carries it.
 */
var EMPLOYEE_AUTO_ADD_FIELDS = ['title', 'contractor', 'subcontractor'];

/**
 * Columns the server owns. Accepted in a payload and ignored, rather than
 * rejected as unknown — an honest client that echoes back a full employee
 * object should not be punished for it (Section 3.9).
 */
var EMPLOYEE_SERVER_FIELDS = [
  'employee_id', 'archived', 'archived_at', 'archived_by',
  'created_at', 'created_by', 'updated_at', 'updated_by', 'derived'
];

/** Paging defaults for list_employees (Section 3.5). */
var EMPLOYEE_PAGE_SIZE_DEFAULT = 50;
var EMPLOYEE_PAGE_SIZE_MAX = 200;

/** Row caps: bulk import per call, and the audit view of RenewalHistory. */
var EMPLOYEE_IMPORT_MAX_ROWS = 5000;
var RENEWAL_HISTORY_CAP = 500;

/** How many "Recently updated" rows list_employee_stats returns (Section 5.5). */
var EMPLOYEE_RECENT_LIMIT = 6;

/** @private Built once per execution by employeeWritableFields_(). */
var EMPLOYEE_WRITABLE_CACHE_ = null;

/**
 * @private
 * Every column a client may write, in schema order.
 * @return {Array<string>}
 */
function employeeWritableFields_() {
  if (EMPLOYEE_WRITABLE_CACHE_) return EMPLOYEE_WRITABLE_CACHE_;

  var fields = ['national_id', 'name', 'team', 'title', 'contractor', 'subcontractor',
    'hired_date', 'employment_status', 'legal_permission'];

  for (var c = 0; c < EMPLOYEE_CERT_KEYS.length; c++) {
    fields.push('cert_' + EMPLOYEE_CERT_KEYS[c] + '_expiry');
    fields.push('cert_' + EMPLOYEE_CERT_KEYS[c] + '_link');
  }
  for (var q = 0; q < EMPLOYEE_QUAL_KEYS.length; q++) {
    fields.push('qual_' + EMPLOYEE_QUAL_KEYS[q]);
  }

  EMPLOYEE_WRITABLE_CACHE_ = fields;
  return fields;
}

// ---------------------------------------------------------------------------
// Action handlers — reads
// ---------------------------------------------------------------------------

/**
 * `list_employees` — paged, filtered, searched, with derivation on every
 * returned row (Section 3.5).
 *
 * Derivation is the expensive half of this action, so it runs on the page slice
 * only — except when `filters.worst_state` is set, which cannot be evaluated
 * without deriving every matching row first. That is the cost Section 3.5
 * accepts to keep the client dumb.
 *
 * @param {Object} session  Context from validateSession().
 * @param {Object} payload  {team?, include_archived?, search?, filters?, page?, page_size?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListEmployees(session, payload) {
  var denied = requireModuleView(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, [
    'team', 'include_archived', 'search', 'filters', 'page', 'page_size'
  ]);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var filters = (payload && payload.filters) || {};
  if (typeof filters !== 'object' || Array.isArray(filters)) {
    return errResponse('validation_failed', 'invalid_filters', { filters: 'invalid_type' });
  }

  var filterUnknown = collectUnknownKeys_(filters, ['subcontractor', 'title', 'worst_state']);
  if (hasKeys_(filterUnknown)) {
    return errResponse('validation_failed', 'unknown_filter_fields', filterUnknown);
  }

  var fieldErrors = {};

  var team = normalizeString(payload && payload.team).toLowerCase();
  if (team !== '' && EMPLOYEE_TEAMS.indexOf(team) === -1) fieldErrors.team = 'invalid_value';

  var worstState = normalizeString(filters.worst_state).toLowerCase();
  if (worstState !== '' && STATE_RANKS[worstState] === undefined) {
    fieldErrors.worst_state = 'invalid_value';
  }

  var page = readPositiveInt_(payload && payload.page, 1);
  if (page === null) fieldErrors.page = 'invalid_number';

  var pageSize = readPositiveInt_(payload && payload.page_size, EMPLOYEE_PAGE_SIZE_DEFAULT);
  if (pageSize === null) fieldErrors.page_size = 'invalid_number';

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  pageSize = Math.min(pageSize, EMPLOYEE_PAGE_SIZE_MAX);

  var includeArchived = normalizeBoolean(payload && payload.include_archived);
  var search = normalizeString(payload && payload.search).toLowerCase();
  var subcontractor = normalizeString(filters.subcontractor).toLowerCase();
  var title = normalizeString(filters.title).toLowerCase();

  // --- Cheap filters first, derivation last -------------------------------
  var rows = readAllRows(SHEET_NAMES.EMPLOYEES);
  var matched = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (normalizeString(row.employee_id) === '') continue;
    if (!includeArchived && normalizeBoolean(row.archived)) continue;
    if (team !== '' && normalizeString(row.team).toLowerCase() !== team) continue;
    if (subcontractor !== '' && normalizeString(row.subcontractor).toLowerCase() !== subcontractor) continue;
    if (title !== '' && normalizeString(row.title).toLowerCase() !== title) continue;
    if (search !== '' && !matchesEmployeeSearch_(row, search)) continue;
    matched.push({ row: row, derived: null });
  }

  matched.sort(compareEmployeesByName_);

  var ctx = employeeContext_();
  if (worstState !== '') {
    var kept = [];
    for (var w = 0; w < matched.length; w++) {
      matched[w].derived = deriveEmployee_(matched[w].row, ctx);
      if (matched[w].derived.worst_state === worstState) kept.push(matched[w]);
    }
    matched = kept;
  }

  var start = (page - 1) * pageSize;
  var slice = matched.slice(start, start + pageSize);

  var employees = [];
  for (var s = 0; s < slice.length; s++) {
    var derived = slice[s].derived || deriveEmployee_(slice[s].row, ctx);
    employees.push(shapeEmployee_(slice[s].row, derived));
  }

  return okResponse({
    employees: employees,
    total_matching: matched.length,
    page: page,
    page_size: pageSize
  });
}

/**
 * `get_employee` — one employee, their renewal history, and the equipment
 * assigned to them (Section 3.5).
 *
 * `assigned_equipment` is empty for a module admin who cannot view equipment.
 * The join is a convenience for the employee detail page, not a hole around the
 * permission model — a user with no equipment grant sees no equipment.
 *
 * @param {Object} session
 * @param {Object} payload  {employee_id}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleGetEmployee(session, payload) {
  var denied = requireModuleView(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['employee_id']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var employeeId = normalizeString(payload && payload.employee_id);
  if (employeeId === '') {
    return errResponse('validation_failed', 'invalid_payload', { employee_id: 'required' });
  }

  var row = readRowByKey(SHEET_NAMES.EMPLOYEES, 'employee_id', employeeId);
  if (!row) return errResponse('not_found', 'employee_not_found');

  var ctx = employeeContext_();

  return okResponse({
    employee: shapeEmployee_(row, deriveEmployee_(row, ctx)),
    renewal_history: renewalHistoryFor_(employeeId, ''),
    rdt_history: rdtHistoryFor_(employeeId),
    assigned_equipment: canViewModule(session, 'equipment')
      ? assignedEquipmentFor_(row, ctx)
      : []
  });
}

/**
 * `list_renewal_history` — the append-only certificate renewal log
 * (Section 3.5).
 *
 * With no filters this is the audit view: the whole tab, newest first, capped
 * at RENEWAL_HISTORY_CAP rows.
 *
 * @param {Object} session
 * @param {Object} payload  {employee_id?, cert_key?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListRenewalHistory(session, payload) {
  var denied = requireModuleView(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['employee_id', 'cert_key']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var employeeId = normalizeString(payload && payload.employee_id);
  var certKey = normalizeString(payload && payload.cert_key);
  var history = renewalHistoryFor_(employeeId, certKey);

  return okResponse({
    renewal_history: history.slice(0, RENEWAL_HISTORY_CAP),
    total_matching: history.length
  });
}

/**
 * `list_employee_stats` — the aggregate counts behind the dashboard's employee
 * KPI row and chart row (CLAUDE.md Section 5.5).
 *
 * The dashboard could page through list_employees and count client-side, but
 * that is the whole roster over the wire to render four numbers, and it would
 * put a second copy of the counting rules in the frontend. This makes one pass
 * over the tab and returns only the totals.
 *
 * Every figure counts *active* employees — archived rows are excluded here for
 * the same reason they are excluded from the team lists.
 *
 * Definitions, because the KPI row mixes units on purpose (Section 5.5):
 *   totals.active / field / safety   employees
 *   totals.certs_expired             certificates, summed across employees
 *   totals.employees_urgent          employees with at least one cert `urgent`
 *   totals.compliant                 employees whose worst_state is `valid`
 *
 * @param {Object} session  Context from validateSession().
 * @param {Object} payload  None.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListEmployeeStats(session, payload) {
  var denied = requireModuleView(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, []);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var ctx = employeeContext_();
  var rows = readAllRows(SHEET_NAMES.EMPLOYEES);

  var totals = {
    active: 0,
    field: 0,
    safety: 0,
    certs_expired: 0,
    employees_urgent: 0,
    compliant: 0
  };

  var byCert = {};            // cert_key → employees whose cert is `urgent`
  var bySubcontractor = {};   // subcontractor → headcount
  var recent = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (normalizeString(row.employee_id) === '') continue;
    if (normalizeBoolean(row.archived)) continue;

    var derived = deriveEmployee_(row, ctx);

    totals.active++;
    if (normalizeString(row.team).toLowerCase() === 'safety') totals.safety++;
    else totals.field++;

    totals.certs_expired += derived.expired_count;
    if (derived.worst_state === CERT_STATES.VALID) totals.compliant++;

    // `urgent` is the state for "expires within urgent_days", which is the
    // window the KPI and the chart above it both name (Section 5.5). A cert the
    // MCU rule has pushed to `suspended` is counted as suspended, not urgent —
    // it is already a blocker, and it shows up in the KPI beside this one.
    var sawUrgent = false;
    for (var certKey in derived.per_cert) {
      if (!Object.prototype.hasOwnProperty.call(derived.per_cert, certKey)) continue;
      if (derived.per_cert[certKey] !== CERT_STATES.URGENT) continue;

      sawUrgent = true;
      byCert[certKey] = (byCert[certKey] || 0) + 1;
    }
    if (sawUrgent) totals.employees_urgent++;

    var sub = normalizeString(row.subcontractor);
    if (sub !== '') bySubcontractor[sub] = (bySubcontractor[sub] || 0) + 1;

    recent.push({
      employee_id: normalizeString(row.employee_id),
      name: normalizeString(row.name),
      team: normalizeString(row.team).toLowerCase(),
      subcontractor: sub,
      worst_state: derived.worst_state,
      updated_at: normalizeIsoDateTime(row.updated_at)
    });
  }

  recent.sort(function (a, b) {
    if (a.updated_at === b.updated_at) return 0;
    return a.updated_at > b.updated_at ? -1 : 1;
  });

  return okResponse({
    generated_at: nowIso(),
    today: ctx.today,
    thresholds: ctx.thresholds,
    totals: totals,

    // The newest updated_at on the tab, which the settings Data tab reports as
    // this module's health. `recent` is already sorted newest first.
    last_updated_at: recent.length ? recent[0].updated_at : '',

    by_cert: countMapToList_(byCert, 'cert_key'),
    by_subcontractor: countMapToList_(bySubcontractor, 'subcontractor'),
    rdt: rdtCoverage_(rows, ctx),
    recent: recent.slice(0, EMPLOYEE_RECENT_LIMIT)
  });
}

// ---------------------------------------------------------------------------
// Action handlers — writes
// ---------------------------------------------------------------------------

/**
 * `create_employee` — inserts one employee (Section 3.5).
 *
 * The duplicate check and the ID reservation both happen inside the script
 * lock. Outside it, two admins submitting the same national_id within the same
 * second would each see a clean check and both write.
 *
 * @param {Object} session
 * @param {Object} payload  The employee object, minus every server-set field.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleCreateEmployee(session, payload) {
  var denied = requireModuleEdit(session, 'employees');
  if (denied) return denied;

  var input = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  var team = normalizeString(input.team).toLowerCase();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('create_employee: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var rows = readAllRows(SHEET_NAMES.EMPLOYEES);
    var validation = validateEmployeeInput_(input, {
      mode: 'create',
      team: team,
      selfId: '',
      nationalIndex: nationalIdIndex_(rows),
      autoAdd: false,
      pendingOptions: {},
      listAdded: {}
    });

    if (hasKeys_(validation.errors)) {
      return errResponse('validation_failed', 'invalid_employee', validation.errors);
    }

    var stampedAt = nowIso();
    var newRow = validation.values;
    newRow.employee_id = reserveEmployeeIds_(1, employeeIdIndex_(rows), session.user.user_id)[0];
    newRow.archived = 'FALSE';
    newRow.archived_at = '';
    newRow.archived_by = '';
    newRow.created_at = stampedAt;
    newRow.created_by = session.user.user_id;
    newRow.updated_at = stampedAt;
    newRow.updated_by = session.user.user_id;

    appendRow(SHEET_NAMES.EMPLOYEES, newRow);

    return okResponse({
      employee: shapeEmployee_(newRow, deriveEmployee_(newRow, employeeContext_()))
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * `update_employee` — merges a partial update into one employee (Section 3.5).
 *
 * Three rules from the spec, in order:
 *   - an archived employee is read-only; unarchive first (`conflict`)
 *   - `team` never changes, and is dropped silently if sent
 *   - every certificate expiry that actually changes appends a RenewalHistory
 *     row, which is the only record of who renewed what and when
 *
 * @param {Object} session
 * @param {Object} payload  {employee_id, updates}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleUpdateEmployee(session, payload) {
  var denied = requireModuleEdit(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['employee_id', 'updates']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var employeeId = normalizeString(payload && payload.employee_id);
  var updates = payload && payload.updates;

  var fieldErrors = {};
  if (employeeId === '') fieldErrors.employee_id = 'required';
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    fieldErrors.updates = 'required';
  }
  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('update_employee: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var rows = readAllRows(SHEET_NAMES.EMPLOYEES);
    var current = findEmployeeRow_(rows, employeeId);
    if (!current) return errResponse('not_found', 'employee_not_found');

    if (normalizeBoolean(current.archived)) {
      return errResponse('conflict', 'employee_archived');
    }

    var validation = validateEmployeeInput_(updates, {
      mode: 'update',
      team: normalizeString(current.team).toLowerCase(),
      selfId: employeeId,
      nationalIndex: nationalIdIndex_(rows),
      autoAdd: false,
      pendingOptions: {},
      listAdded: {}
    });

    if (hasKeys_(validation.errors)) {
      return errResponse('validation_failed', 'invalid_employee', validation.errors);
    }

    var stampedAt = nowIso();
    var changes = validation.values;
    changes.updated_at = stampedAt;
    changes.updated_by = session.user.user_id;

    var historyRows = renewalRowsForChanges_(
      current, changes, stampedAt, session.user.user_id, nextHistoryNumber_()
    );

    var merged = updateRowByKey(SHEET_NAMES.EMPLOYEES, 'employee_id', employeeId, changes);
    if (!merged) return errResponse('not_found', 'employee_not_found');

    appendRows(SHEET_NAMES.RENEWAL_HISTORY, historyRows);

    return okResponse({
      employee: shapeEmployee_(merged, deriveEmployee_(merged, employeeContext_()))
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * `archive_employee` — the soft delete (Section 3.5). Idempotent.
 *
 * Assigned equipment is left alone on purpose: the equipment keeps its
 * `team_leader_id` and surfaces an "owner archived" warning instead
 * (Section 6.3), so nothing silently loses its owner.
 *
 * `reason` is accepted, logged, and not stored — the Employees tab in
 * Section 2 has no note column, and inventing one is a schema change that goes
 * through Khaled.
 *
 * @param {Object} session
 * @param {Object} payload  {employee_id, reason?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleArchiveEmployee(session, payload) {
  var denied = requireModuleEdit(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['employee_id', 'reason']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var employeeId = normalizeString(payload && payload.employee_id);
  if (employeeId === '') {
    return errResponse('validation_failed', 'invalid_payload', { employee_id: 'required' });
  }

  var current = readRowByKey(SHEET_NAMES.EMPLOYEES, 'employee_id', employeeId);
  if (!current) return errResponse('not_found', 'employee_not_found');

  var reason = normalizeString(payload && payload.reason);
  if (reason !== '') {
    console.log('archive_employee ' + employeeId + ' by ' + session.user.user_id + ': ' + reason);
  }

  // Already archived — return the row as-is rather than re-stamping who did it.
  if (normalizeBoolean(current.archived)) {
    return okResponse({
      employee: shapeEmployee_(current, deriveEmployee_(current, employeeContext_()))
    });
  }

  var stampedAt = nowIso();
  var merged = updateRowByKey(SHEET_NAMES.EMPLOYEES, 'employee_id', employeeId, {
    archived: 'TRUE',
    archived_at: stampedAt,
    archived_by: session.user.user_id,
    updated_at: stampedAt,
    updated_by: session.user.user_id
  });

  return okResponse({
    employee: shapeEmployee_(merged, deriveEmployee_(merged, employeeContext_()))
  });
}

/**
 * `unarchive_employee` — brings a resigned/terminated employee back
 * (Section 3.5). Idempotent.
 *
 * The national_id uniqueness rule only covers non-archived employees, so
 * someone else may have taken this ID while this row sat archived. That is a
 * `conflict` the admin has to resolve, not something to silently allow.
 *
 * @param {Object} session
 * @param {Object} payload  {employee_id}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleUnarchiveEmployee(session, payload) {
  var denied = requireModuleEdit(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['employee_id']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var employeeId = normalizeString(payload && payload.employee_id);
  if (employeeId === '') {
    return errResponse('validation_failed', 'invalid_payload', { employee_id: 'required' });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('unarchive_employee: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var rows = readAllRows(SHEET_NAMES.EMPLOYEES);
    var current = findEmployeeRow_(rows, employeeId);
    if (!current) return errResponse('not_found', 'employee_not_found');

    if (!normalizeBoolean(current.archived)) {
      return okResponse({
        employee: shapeEmployee_(current, deriveEmployee_(current, employeeContext_()))
      });
    }

    var nationalId = normalizeString(current.national_id).toLowerCase();
    var holder = nationalIdIndex_(rows)[nationalId];
    if (nationalId !== '' && holder && holder !== employeeId) {
      console.warn('unarchive_employee blocked: ' + nationalId + ' now held by ' + holder);
      return errResponse('conflict', 'national_id_taken');
    }

    var stampedAt = nowIso();
    var merged = updateRowByKey(SHEET_NAMES.EMPLOYEES, 'employee_id', employeeId, {
      archived: 'FALSE',
      archived_at: '',
      archived_by: '',
      updated_at: stampedAt,
      updated_by: session.user.user_id
    });

    return okResponse({
      employee: shapeEmployee_(merged, deriveEmployee_(merged, employeeContext_()))
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * `bulk_import_employees` — validate everything, then write everything
 * (Section 3.5).
 *
 * All-or-nothing by design: one bad row rejects the whole call and the Sheet is
 * untouched, so a half-imported spreadsheet can never happen. Row-level detail
 * comes back in `row_errors` alongside the standard `field_errors`, since a
 * per-field map cannot express "row 42's national_id is a duplicate".
 *
 * Unknown dropdown values requested via `auto_add_unknown_options` are held in
 * memory during validation and only written once every row has passed — the
 * FieldOptions tab must not grow new entries for an import that gets rejected.
 *
 * @param {Object} session
 * @param {Object} payload  {rows, on_duplicate?, auto_add_unknown_options?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleBulkImportEmployees(session, payload) {
  var denied = requireModuleEdit(session, 'employees');
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
  } else if (inputRows.length > EMPLOYEE_IMPORT_MAX_ROWS) {
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
    console.error('bulk_import_employees: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var pairs = readAllRowsWithIndex(SHEET_NAMES.EMPLOYEES);
    var existingRows = [];
    for (var e = 0; e < pairs.length; e++) existingRows.push(pairs[e].data);

    var nationalIndex = nationalIdIndex_(existingRows);
    var rowByEmployeeId = {};
    for (var x = 0; x < pairs.length; x++) {
      var xid = normalizeString(pairs[x].data.employee_id);
      if (xid !== '') rowByEmployeeId[xid] = pairs[x];
    }

    var pendingOptions = {};
    var listAdded = {};
    var rowErrors = [];
    var plan = [];
    var payloadNationalIds = {};

    // --- Pass 1: validate every row, write nothing -------------------------
    for (var i = 0; i < inputRows.length; i++) {
      var input = inputRows[i];
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        rowErrors.push({ row: i, errors: { row: 'invalid_type' } });
        continue;
      }

      var nationalId = normalizeString(input.national_id).toLowerCase();
      var existingId = nationalId === '' ? undefined : nationalIndex[nationalId];
      var isDuplicate = existingId !== undefined;

      // Two rows in the same file claiming one national_id is always an error;
      // there is no policy under which both could be applied.
      if (nationalId !== '' && payloadNationalIds[nationalId] !== undefined) {
        rowErrors.push({
          row: i,
          errors: { national_id: 'duplicate_in_payload' }
        });
        continue;
      }

      var mode = (isDuplicate && onDuplicate === 'overwrite') ? 'update' : 'create';
      var currentRow = isDuplicate ? rowByEmployeeId[existingId] : null;
      var team = mode === 'update'
        ? normalizeString(currentRow.data.team).toLowerCase()
        : normalizeString(input.team).toLowerCase();

      // A row being skipped is still validated — Section 3.5 rejects the whole
      // import if any row is invalid, whether or not it would have been applied.
      var validation = validateEmployeeInput_(input, {
        mode: mode,
        team: team,
        selfId: isDuplicate ? existingId : '',
        nationalIndex: nationalIndex,
        autoAdd: autoAdd,
        pendingOptions: pendingOptions,
        listAdded: listAdded
      });

      if (hasKeys_(validation.errors)) {
        rowErrors.push({ row: i, errors: validation.errors });
        continue;
      }

      if (nationalId !== '') payloadNationalIds[nationalId] = true;

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

    var newIds = reserveEmployeeIds_(creates.length, employeeIdIndex_(existingRows), actingUserId);
    var newRows = [];
    for (var n = 0; n < creates.length; n++) {
      var newRow = creates[n].values;
      newRow.employee_id = newIds[n];
      newRow.archived = 'FALSE';
      newRow.archived_at = '';
      newRow.archived_by = '';
      newRow.created_at = stampedAt;
      newRow.created_by = actingUserId;
      newRow.updated_at = stampedAt;
      newRow.updated_by = actingUserId;
      newRows.push(newRow);
    }

    var rowUpdates = [];
    var historyRows = [];
    var historyNumber = nextHistoryNumber_();
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

      var rows = renewalRowsForChanges_(
        plan[u].target.data, changes, stampedAt, actingUserId, historyNumber
      );
      historyNumber += rows.length;
      for (var h = 0; h < rows.length; h++) historyRows.push(rows[h]);

      rowUpdates.push({ row: plan[u].target.row, data: changes });
      updatedCount++;
    }

    updateRowsAt(SHEET_NAMES.EMPLOYEES, rowUpdates);
    appendRows(SHEET_NAMES.EMPLOYEES, newRows);
    appendRows(SHEET_NAMES.RENEWAL_HISTORY, historyRows);

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
 * Validates and normalizes a client-supplied employee object into sheet-ready
 * values.
 *
 * On `create` the three required columns are enforced; on `update` only the
 * keys actually present are touched, so a partial update never blanks a column
 * it did not mention.
 *
 * Safety-only certificates (ppe, lifting, scaffolding) are accepted on a field
 * employee rather than rejected. The derivation ignores them for that team
 * (Compliance.gs), and rejecting them would fail imports of legacy sheets that
 * carry the columns for everyone.
 *
 * @param {Object} input
 * @param {Object} ctx  {mode, team, selfId, nationalIndex, autoAdd,
 *                       pendingOptions, listAdded}
 * @return {{values: Object, errors: Object}}
 */
function validateEmployeeInput_(input, ctx) {
  var errors = {};
  var values = {};
  var isCreate = ctx.mode === 'create';

  var errorsFromUnknown = collectUnknownKeys_(
    input, employeeWritableFields_().concat(EMPLOYEE_SERVER_FIELDS)
  );
  for (var badKey in errorsFromUnknown) {
    if (Object.prototype.hasOwnProperty.call(errorsFromUnknown, badKey)) {
      errors[badKey] = errorsFromUnknown[badKey];
    }
  }

  // --- team ---------------------------------------------------------------
  // Immutable after creation, so an update drops it without complaining
  // (Section 3.5).
  if (isCreate) {
    var team = normalizeString(input.team).toLowerCase();
    if (team === '') {
      errors.team = 'required';
    } else if (EMPLOYEE_TEAMS.indexOf(team) === -1) {
      errors.team = 'invalid_value';
    } else {
      values.team = team;
      ctx.team = team;
    }
  }

  // --- required identity columns -------------------------------------------
  if (isCreate || has_(input, 'name')) {
    var name = normalizeString(input.name);
    if (name === '') errors.name = 'required';
    else values.name = name;
  }

  if (isCreate || has_(input, 'national_id')) {
    var nationalId = normalizeString(input.national_id);
    if (nationalId === '') {
      errors.national_id = 'required';
    } else {
      var holder = ctx.nationalIndex[nationalId.toLowerCase()];
      if (holder !== undefined && holder !== ctx.selfId) {
        errors.national_id = 'duplicate';
      } else {
        values.national_id = nationalId;
      }
    }
  }

  // --- dropdown columns -----------------------------------------------------
  // A blank clears the field; a non-blank value must exist in its FieldOptions
  // list and is stored with the list's own spelling.
  for (var optionField in EMPLOYEE_OPTION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(EMPLOYEE_OPTION_FIELDS, optionField)) continue;
    if (!has_(input, optionField)) continue;
    applyOptionField_(values, errors, input, optionField, EMPLOYEE_OPTION_FIELDS[optionField], ctx);
  }

  if (has_(input, 'title')) {
    applyOptionField_(values, errors, input, 'title', employeeTitleList_(ctx.team), ctx);
  }

  // --- dates ----------------------------------------------------------------
  applyDateField_(values, errors, input, 'hired_date');

  for (var c = 0; c < EMPLOYEE_CERT_KEYS.length; c++) {
    applyDateField_(values, errors, input, 'cert_' + EMPLOYEE_CERT_KEYS[c] + '_expiry');

    var linkField = 'cert_' + EMPLOYEE_CERT_KEYS[c] + '_link';
    if (has_(input, linkField)) values[linkField] = normalizeString(input[linkField]);
  }

  // --- qualification flags --------------------------------------------------
  // Section 2 stores booleans as the literal 'TRUE'/'FALSE', never blank-for-
  // false, so a create fills in every flag the payload left out.
  for (var q = 0; q < EMPLOYEE_QUAL_KEYS.length; q++) {
    var qualField = 'qual_' + EMPLOYEE_QUAL_KEYS[q];
    if (!has_(input, qualField)) {
      if (isCreate) values[qualField] = 'FALSE';
      continue;
    }

    var raw = input[qualField];
    if (raw === '' || raw === null || raw === undefined) {
      values[qualField] = 'FALSE';
    } else if (raw === true || raw === false || isBooleanString_(raw)) {
      values[qualField] = booleanToSheet(raw);
    } else {
      errors[qualField] = 'invalid_type';
    }
  }

  return { values: values, errors: errors };
}

/** @private Resolves one dropdown value, auto-adding it when the import allows. */
function applyOptionField_(values, errors, input, field, listKey, ctx) {
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

  if (ctx.autoAdd && EMPLOYEE_AUTO_ADD_FIELDS.indexOf(field) !== -1) {
    if (!ctx.pendingOptions[listKey]) ctx.pendingOptions[listKey] = {};
    ctx.pendingOptions[listKey][lower] = raw;

    if (!ctx.listAdded[field]) ctx.listAdded[field] = [];
    ctx.listAdded[field].push(raw);

    values[field] = raw;
    return;
  }

  errors[field] = 'unknown_option';
}

/** @private Validates one ISO date column; blank clears it. */
function applyDateField_(values, errors, input, field) {
  if (!has_(input, field)) return;

  var raw = input[field];
  if (normalizeString(raw) === '') {
    values[field] = '';
    return;
  }

  var iso = normalizeIsoDate(raw);
  if (iso === '') {
    errors[field] = 'invalid_format';
    return;
  }
  values[field] = iso;
}

// ---------------------------------------------------------------------------
// Derivation and output shaping
// ---------------------------------------------------------------------------

/**
 * @private
 * The per-request derivation inputs. Every loader behind this is cached, so
 * calling it once per handler costs one read of Config, FieldOptions, and
 * ModuleSettings for the whole request (Section 6.5).
 *
 * @return {{today: string, thresholds: Object, moduleSettings: Object}}
 */
function employeeContext_() {
  return {
    today: todayIso(),
    thresholds: getComplianceThresholds(),
    moduleSettings: getModuleSettingsMap()
  };
}

/** @private deriveEmployeeDerived with the request context already applied. */
function deriveEmployee_(row, ctx) {
  return deriveEmployeeDerived(row, ctx.today, ctx.thresholds, ctx.moduleSettings);
}

/**
 * @private
 * Converts a raw Employees row into the API shape: real booleans, ISO dates,
 * every column present, and the derived block attached.
 *
 * Columns are emitted whether or not the Sheet holds a value, so the frontend
 * never has to guard for undefined on a field it knows the schema has.
 */
function shapeEmployee_(row, derived) {
  var out = {
    employee_id: normalizeString(row.employee_id),
    national_id: normalizeString(row.national_id),
    name: normalizeString(row.name),
    team: normalizeString(row.team).toLowerCase(),
    title: normalizeString(row.title),
    contractor: normalizeString(row.contractor),
    subcontractor: normalizeString(row.subcontractor),
    hired_date: normalizeIsoDate(row.hired_date),
    employment_status: normalizeString(row.employment_status),
    legal_permission: normalizeString(row.legal_permission),
    archived: normalizeBoolean(row.archived),
    archived_at: normalizeIsoDateTime(row.archived_at),
    archived_by: normalizeString(row.archived_by),
    created_at: normalizeIsoDateTime(row.created_at),
    created_by: normalizeString(row.created_by),
    updated_at: normalizeIsoDateTime(row.updated_at),
    updated_by: normalizeString(row.updated_by)
  };

  for (var c = 0; c < EMPLOYEE_CERT_KEYS.length; c++) {
    var key = EMPLOYEE_CERT_KEYS[c];
    out['cert_' + key + '_expiry'] = normalizeIsoDate(row['cert_' + key + '_expiry']);
    out['cert_' + key + '_link'] = normalizeString(row['cert_' + key + '_link']);
  }
  for (var q = 0; q < EMPLOYEE_QUAL_KEYS.length; q++) {
    out['qual_' + EMPLOYEE_QUAL_KEYS[q]] = normalizeBoolean(row['qual_' + EMPLOYEE_QUAL_KEYS[q]]);
  }

  out.derived = derived;
  return out;
}

// ---------------------------------------------------------------------------
// Renewal history
// ---------------------------------------------------------------------------

/**
 * @private
 * Builds one RenewalHistory row per certificate expiry that actually changes.
 *
 * Only real changes are logged — writing the same date back is not a renewal,
 * and an append-only tab full of no-op rows is an audit trail nobody reads.
 *
 * @param {Object} current      The row as it stands.
 * @param {Object} changes      The validated updates about to be applied.
 * @param {string} stampedAt
 * @param {string} actingUserId
 * @param {number} startNumber  First free history sequence number.
 * @return {Array<Object>}
 */
function renewalRowsForChanges_(current, changes, stampedAt, actingUserId, startNumber) {
  var out = [];
  var next = startNumber;

  for (var i = 0; i < EMPLOYEE_CERT_KEYS.length; i++) {
    var certKey = EMPLOYEE_CERT_KEYS[i];
    var field = 'cert_' + certKey + '_expiry';
    if (!has_(changes, field)) continue;

    var oldExpiry = normalizeIsoDate(current[field]);
    var newExpiry = normalizeIsoDate(changes[field]);
    if (oldExpiry === newExpiry) continue;

    out.push({
      history_id: 'RH-' + padNumber_(next, 4),
      employee_id: normalizeString(current.employee_id),
      cert_key: certKey,
      old_expiry: oldExpiry,
      new_expiry: newExpiry,
      renewed_at: stampedAt,
      renewed_by: actingUserId
    });
    next++;
  }

  return out;
}

/**
 * @private
 * RenewalHistory rows for an employee and/or a certificate, newest first.
 * Both filters are optional; blank means "everything".
 *
 * @param {string} employeeId
 * @param {string} certKey
 * @return {Array<Object>}
 */
function renewalHistoryFor_(employeeId, certKey) {
  var rows = readAllRows(SHEET_NAMES.RENEWAL_HISTORY);
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (employeeId !== '' && normalizeString(rows[i].employee_id) !== employeeId) continue;
    if (certKey !== '' && normalizeString(rows[i].cert_key) !== certKey) continue;

    out.push({
      history_id: normalizeString(rows[i].history_id),
      employee_id: normalizeString(rows[i].employee_id),
      cert_key: normalizeString(rows[i].cert_key),
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
 * The next free RenewalHistory sequence number.
 *
 * Derived from the highest existing `RH-####` rather than a Config counter:
 * Section 2 gives Config counters to employee, equipment, and vehicle IDs only,
 * and history rows are only ever appended under the same script lock that
 * writes them.
 *
 * @return {number}
 */
function nextHistoryNumber_() {
  var rows = readAllRows(SHEET_NAMES.RENEWAL_HISTORY);
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

/* has_() moved to Utils.gs — Equipment.gs and Users.gs need it too, and a
   helper three files depend on is not a private one. */

/** @private True for the literal strings the Sheet stores booleans as. */
function isBooleanString_(value) {
  if (typeof value !== 'string') return false;
  var upper = value.trim().toUpperCase();
  return upper === 'TRUE' || upper === 'FALSE';
}

/**
 * @private
 * Reads a positive integer from a payload field.
 * @return {number|null} `fallback` when absent, null when present but unusable.
 */
function readPositiveInt_(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;

  var num = Number(value);
  if (!isFinite(num) || num < 1) return null;
  return Math.floor(num);
}

/** @private Which titles list applies to a team. */
function employeeTitleList_(team) {
  return normalizeString(team).toLowerCase() === 'safety' ? 'safety_titles' : 'field_titles';
}

/** @private Case-insensitive contains across name and national_id (Section 3.5). */
function matchesEmployeeSearch_(row, lowerQuery) {
  if (normalizeString(row.name).toLowerCase().indexOf(lowerQuery) !== -1) return true;
  return normalizeString(row.national_id).toLowerCase().indexOf(lowerQuery) !== -1;
}

/** @private Alphabetical by name — the order every employee list renders in. */
function compareEmployeesByName_(a, b) {
  var an = normalizeString(a.row.name).toLowerCase();
  var bn = normalizeString(b.row.name).toLowerCase();
  if (an === bn) return 0;
  return an < bn ? -1 : 1;
}

/* The dashboard's RDT coverage block used to be computed here from the flat
   rdt_* columns. It now reads the RdtLog tab and lives in Rdt.gs beside the
   eligibility rules it shares with the selection algorithm — list_employee_stats
   above still calls rdtCoverage_(rows, ctx), it just resolves to the other file
   now (Apps Script has one global scope). */

/** @private Linear lookup in an already-loaded row set. */
function findEmployeeRow_(rows, employeeId) {
  for (var i = 0; i < rows.length; i++) {
    if (normalizeString(rows[i].employee_id) === employeeId) return rows[i];
  }
  return null;
}

/**
 * @private
 * {lowercased national_id → employee_id} across non-archived employees only.
 *
 * Uniqueness is scoped to active employees (Section 3.5), so a national_id
 * freed by an archival can be reused — which is what makes unarchiving a
 * collision worth checking for.
 */
function nationalIdIndex_(rows) {
  var index = {};
  for (var i = 0; i < rows.length; i++) {
    if (normalizeBoolean(rows[i].archived)) continue;

    // A row with no employee_id is not a real employee — a half-typed line left
    // in the tab. Indexing it would hand callers an ID that resolves to nothing.
    var employeeId = normalizeString(rows[i].employee_id);
    if (employeeId === '') continue;

    var nationalId = normalizeString(rows[i].national_id).toLowerCase();
    if (nationalId === '') continue;
    index[nationalId] = employeeId;
  }
  return index;
}

/** @private {employee_id → true} for every row, archived included. */
function employeeIdIndex_(rows) {
  var index = {};
  for (var i = 0; i < rows.length; i++) {
    var id = normalizeString(rows[i].employee_id);
    if (id !== '') index[id] = true;
  }
  return index;
}

/**
 * @private
 * Reserves a block of employee IDs and advances Config.next_employee_number.
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
function reserveEmployeeIds_(count, existingIds, actingUserId) {
  if (count <= 0) return [];

  var prefix = getConfigValue('employee_id_prefix', 'LM-EMP-');
  var next = Math.floor(getConfigNumber('next_employee_number', 1));
  if (!isFinite(next) || next < 1) next = 1;

  var ids = [];
  while (ids.length < count) {
    var candidate = prefix + padNumber_(next, 4);
    next++;
    if (existingIds[candidate]) continue;
    ids.push(candidate);
  }

  writeConfigCounter_('next_employee_number', next, actingUserId);
  return ids;
}

/**
 * @private
 * Writes a Config counter and drops the cached Config map.
 *
 * Counters are excluded from ALLOWED_CONFIG_KEYS in Config.gs — they are the
 * server's to move, never an admin's — so this is the only path that sets them.
 */
function writeConfigCounter_(key, value, actingUserId) {
  var stampedAt = nowIso();
  var fields = {
    value: String(value),
    updated_at: stampedAt,
    updated_by: actingUserId
  };

  if (!updateRowByKey(SHEET_NAMES.CONFIG, 'key', key, fields)) {
    fields.key = key;
    appendRow(SHEET_NAMES.CONFIG, fields);
  }
  clearConfigCache();
}

/**
 * @private
 * Brief refs for the equipment assigned to an employee, each with its verdict
 * (Section 3.5).
 */
function assignedEquipmentFor_(employeeRow, ctx) {
  var employeeId = normalizeString(employeeRow.employee_id);
  if (employeeId === '') return [];

  var employeesById = {};
  employeesById[employeeId] = employeeRow;

  var rows = readAllRows(SHEET_NAMES.EQUIPMENT);
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (normalizeString(rows[i].team_leader_id) !== employeeId) continue;

    var derived = deriveEquipmentDerived(
      rows[i], ctx.today, ctx.thresholds, ctx.moduleSettings, employeesById
    );

    out.push({
      equipment_id: normalizeString(rows[i].equipment_id),
      item: normalizeString(rows[i].item),
      brand: normalizeString(rows[i].brand),
      serial_no: normalizeString(rows[i].serial_no),
      rejected: normalizeBoolean(rows[i].rejected),
      verdict: derived.verdict
    });
  }

  return out;
}

/**
 * @private
 * The validation_failed envelope for a bulk import, carrying per-row detail.
 *
 * `field_errors` keeps its contract for generic frontend handling; `row_errors`
 * is the extra channel Section 3.5's "per-row error array" needs, which a flat
 * field map cannot carry.
 *
 * @param {Array<{row: number, errors: Object}>} rowErrors
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function rowErrorResponse_(rowErrors) {
  return jsonResponse({
    ok: false,
    error: 'validation_failed',
    message: 'import_rows_invalid',
    field_errors: { rows: 'invalid' },
    row_errors: rowErrors
  });
}
