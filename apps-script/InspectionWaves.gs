/**
 * InspectionWaves.gs — the internal inspection wave, as an event log.
 *
 * A wave used to be three pairs of columns on the Equipment row: `wave_1_date` /
 * `wave_1_result` through `wave_3_*`. Three fixed slots cannot hold a comment, an
 * author, or a fourth inspection — and once officers record waves from the field
 * (Section 3.8) all three of those become required. So the wave moved to a tab of
 * its own, the same way drug testing moved to RdtLog and for the same reason.
 *
 * One row is one inspection. Append-only: a wave recorded in error is **voided**,
 * never deleted (rule 6). Voided rows stay visible in history and count for
 * nothing.
 *
 * ---- What reads this file ----
 *
 *   Compliance.gs      findLatestCompletedWave_() picks the newest non-voided
 *                      wave for an item; a `fail` there blocks it (Section 6.3)
 *   Equipment.gs       equipmentContext_() groups the tab once per request
 *   Officer.gs         officerContext_() does the same for a sync
 *   Employees.gs       assignedEquipmentFor_() on the employee detail page
 *
 * ---- Two authors, two doors ----
 *
 * `record_inspection_wave` is the admin's, gated on edit `equipment`.
 * `officer_record_wave` is the officer's, gated on the officer role and living in
 * this file rather than Officer.gs because everything it touches is here.
 *
 * They are deliberately not one handler with a permission branch. Officer.gs's
 * header states the principle — officers get a different API surface, not a
 * filtered view of the admin one — and keeping them disjoint means the officer
 * write path has exactly one entry point to audit, permanently.
 */

// ---------------------------------------------------------------------------
// Schema (CLAUDE.md Section 2, InspectionWaves tab)
// ---------------------------------------------------------------------------

/**
 * The tab's columns, in order. setupInspectionWavesTab() writes exactly this row
 * and nothing else decides the layout.
 *
 * The approval columns sit at the end rather than beside `result`, because
 * addWaveApprovalColumns() appends them to a tab that already exists and the two
 * layouts must converge. Same reasoning as addEmployeeCertFlagColumns().
 */
var INSPECTION_WAVE_HEADERS = [
  'wave_id', 'equipment_id', 'wave_no', 'fiscal_year', 'wave_date', 'result', 'comments',
  'origin', 'client_id',
  'voided', 'voided_at', 'voided_by', 'void_reason',
  'recorded_at', 'recorded_by', 'updated_at', 'updated_by',
  'approval_status', 'reviewed_at', 'reviewed_by', 'rejection_reason'
];

/**
 * How a row came to exist. Nothing filters on it — every origin counts toward
 * the verdict alike — but "did an officer or an admin file this" is a question
 * worth being able to answer without a second migration. Mirrors RdtLog.origin.
 */
var INSPECTION_WAVE_ORIGINS = ['officer', 'admin', 'migration'];

/**
 * The review states a wave can be in.
 *
 * An officer's wave lands `pending` and waits for an admin to confirm what they
 * found. An admin's lands `approved` — the admin filing it *is* the review, and
 * a queue that asks you to approve your own typing is a queue nobody reads.
 *
 * `rejected` is the review's other outcome and behaves like `voided` for the
 * verdict: the row stays, and it counts for nothing. The two are kept apart
 * because they answer different questions — voiding says the inspection should
 * never have been filed, rejecting says it was filed and the finding was not
 * accepted. Collapsing them would lose which of those happened.
 */
var WAVE_APPROVAL_STATES = ['pending', 'approved', 'rejected'];

/**
 * The internal wave programme: three inspections a year, one per quarter, with
 * the fourth quarter given over to the third-party inspection.
 *
 * This is why `wave_no` is derived from `wave_date` and never allocated. The
 * wave number *is* the fiscal quarter — Q1 is wave 1, Q2 wave 2, Q3 wave 3 —
 * so a re-inspection after a rejected wave carries the same number as the one
 * it replaces, with nothing to reset and no counter to keep in step.
 *
 * A wave dated in Q4 gets WAVE_SLOT_OFF_CYCLE. It records, and it drives the
 * verdict exactly like any other wave, but it fills no slot: an officer who
 * finds a frayed harness in February must always be able to write that down,
 * and refusing the entry would mean the platform's answer to a real hazard was
 * "not this quarter".
 */
var WAVE_SLOT_QUARTERS = [1, 2, 3];
var WAVE_SLOT_OFF_CYCLE = 0;

/** ModuleSettings fallback when `equipment.wave_fiscal_year_start_month` is unset. */
var WAVE_FISCAL_START_MONTH_DEFAULT = 4;

/** Free-text ceiling, matching RdtLog.notes. */
var WAVE_COMMENTS_MAX = 500;

/** Paging for list_inspection_waves. */
var WAVE_PAGE_SIZE_DEFAULT = 50;
var WAVE_PAGE_SIZE_MAX = 500;

/** @private The tab, read once per request and grouped by equipment. */
var INSPECTION_WAVE_CACHE_ = null;

// ---------------------------------------------------------------------------
// Shared reads — what the derivation and every handler run on
// ---------------------------------------------------------------------------

/**
 * Every wave on the tab, shaped, newest first.
 *
 * Cached in a module global for the life of the execution, so a list action that
 * derives 200 items reads the tab once (Section 2, "Server-side lookups").
 *
 * A missing tab is not an error here. Until setupInspectionWavesTab() has run the
 * platform still works: every item reads as having no waves, which is exactly
 * what it had before the feature existed. The frontend deploys by pushing to
 * main and the Sheet cannot be migrated in the same instant — the same
 * degradation addEmployeeCertFlagColumns() was written for.
 *
 * @return {Array<Object>}
 */
function readInspectionWaves_() {
  if (INSPECTION_WAVE_CACHE_) return INSPECTION_WAVE_CACHE_;

  var rows;
  try {
    rows = readAllRows(SHEET_NAMES.INSPECTION_WAVES);
  } catch (err) {
    console.warn('InspectionWaves tab not found — treating every item as having ' +
      'no waves. Run setupInspectionWavesTab() to create it.');
    INSPECTION_WAVE_CACHE_ = [];
    return INSPECTION_WAVE_CACHE_;
  }

  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (normalizeString(rows[i].wave_id) === '') continue;
    out.push(shapeInspectionWave_(rows[i]));
  }

  out.sort(compareWavesNewestFirst_);
  INSPECTION_WAVE_CACHE_ = out;
  return out;
}

/** @private Drops the per-request cache after a write. */
function clearInspectionWaveCache_() {
  INSPECTION_WAVE_CACHE_ = null;
}

/**
 * {equipment_id → [wave, ...]} for the derivation, newest first.
 *
 * **Voided and rejected waves are excluded here**, which is the whole of what
 * both states mean: the row survives in history, and the verdict stops seeing
 * it. Doing the filter once at the source means no derivation path can forget
 * it.
 *
 * Pending waves *are* included, and must be. A pending fail blocks the item —
 * an officer who finds damaged gear takes it out of service on the spot, and
 * waiting for an admin to agree before that happens would put the delay in
 * exactly the wrong place. Which pending waves count for what is decided in
 * Compliance.gs, not by hiding them here.
 *
 * @return {Object<string, Array<Object>>}
 */
function wavesByEquipmentId_() {
  var waves = readInspectionWaves_();
  var byId = {};

  for (var i = 0; i < waves.length; i++) {
    if (waves[i].voided) continue;
    if (waves[i].approval_status === 'rejected') continue;

    var id = waves[i].equipment_id;
    if (id === '') continue;

    if (!byId[id]) byId[id] = [];
    byId[id].push(waves[i]);
  }

  return byId;
}

/**
 * The waves for one item, newest first — voided rows included or not.
 *
 * @param {string} equipmentId
 * @param {boolean} includeVoided
 * @return {Array<Object>}
 */
function wavesForEquipment_(equipmentId, includeVoided) {
  var waves = readInspectionWaves_();
  var out = [];

  for (var i = 0; i < waves.length; i++) {
    if (waves[i].equipment_id !== equipmentId) continue;
    if (!includeVoided && waves[i].voided) continue;
    out.push(waves[i]);
  }
  return out;
}

/**
 * @private
 * One raw row as the API shape: real booleans, ISO dates, every column present.
 */
function shapeInspectionWave_(row) {
  var waveNo = Number(normalizeString(row.wave_no));
  var origin = normalizeString(row.origin).toLowerCase() || 'admin';

  return {
    wave_id: normalizeString(row.wave_id),
    equipment_id: normalizeString(row.equipment_id),
    wave_no: isFinite(waveNo) && waveNo > 0 ? Math.floor(waveNo) : WAVE_SLOT_OFF_CYCLE,
    fiscal_year: normalizeString(row.fiscal_year),
    wave_date: normalizeIsoDate(row.wave_date),
    result: normalizeString(row.result).toLowerCase(),
    comments: normalizeString(row.comments),
    origin: origin,
    client_id: normalizeString(row.client_id),
    approval_status: normalizeWaveApproval_(row.approval_status, origin),
    reviewed_at: normalizeIsoDateTime(row.reviewed_at),
    reviewed_by: normalizeString(row.reviewed_by),
    rejection_reason: normalizeString(row.rejection_reason),
    voided: normalizeBoolean(row.voided),
    voided_at: normalizeIsoDateTime(row.voided_at),
    voided_by: normalizeString(row.voided_by),
    void_reason: normalizeString(row.void_reason),
    recorded_at: normalizeIsoDateTime(row.recorded_at),
    recorded_by: normalizeString(row.recorded_by),
    updated_at: normalizeIsoDateTime(row.updated_at),
    updated_by: normalizeString(row.updated_by)
  };
}

/**
 * @private
 * A stored approval value, defaulted by origin when the cell is blank.
 *
 * A blank means the row predates the approval columns, and the honest default
 * depends on who filed it. An admin's wave and a migrated one were already
 * counting toward the verdict before this feature existed, so reading them as
 * `approved` preserves exactly what the fleet said yesterday. An officer's was
 * counting too — but the whole point of the change is that an officer's finding
 * is confirmed before it stands, and defaulting those to `pending` puts the
 * handful that exist in front of an admin instead of grandfathering them past
 * the review they now require.
 *
 * @param {*} raw
 * @param {string} origin  Already lowercased.
 * @return {string}
 */
function normalizeWaveApproval_(raw, origin) {
  var value = normalizeString(raw).toLowerCase();
  if (WAVE_APPROVAL_STATES.indexOf(value) !== -1) return value;
  return origin === 'officer' ? 'pending' : 'approved';
}

/**
 * @private
 * Newest first: by wave_date, ties broken by wave_no.
 *
 * The same ordering Section 6.3 defines for "most recent completed wave", so the
 * list an admin reads and the wave the verdict picked agree by construction. A
 * wave with no date sorts last — it has not happened yet.
 */
function compareWavesNewestFirst_(a, b) {
  if (a.wave_date !== b.wave_date) {
    if (a.wave_date === '') return 1;
    if (b.wave_date === '') return -1;
    return a.wave_date > b.wave_date ? -1 : 1;
  }
  if (a.wave_no !== b.wave_no) return b.wave_no - a.wave_no;
  return 0;
}

// ---------------------------------------------------------------------------
// ID and sequence allocation
// ---------------------------------------------------------------------------

/**
 * @private
 * The next free `IW-######`, derived from the highest on the tab.
 *
 * Not a Config counter: Section 2 gives those to employee, equipment, and
 * vehicle IDs only, and wave rows are only ever appended under the script lock
 * that writes them — the same reasoning as nextHistoryNumber_() in Employees.gs.
 *
 * @param {Array<Object>} waves
 * @return {number}
 */
function nextWaveIdNumber_(waves) {
  var max = 0;

  for (var i = 0; i < waves.length; i++) {
    var match = waves[i].wave_id.match(/(\d+)\s*$/);
    if (!match) continue;
    var num = Number(match[1]);
    if (isFinite(num) && num > max) max = num;
  }
  return max + 1;
}

/**
 * The month Landmark's inspection year starts on, from ModuleSettings.
 *
 * Configurable rather than hardcoded for the same reason RDT's is: it is a
 * calendar policy, not a domain rule. It sits under `equipment` and not in the
 * global Config because the employee module already owns its own copy — the two
 * happen to both be April today, and nothing says they must move together.
 *
 * @return {number} 1–12
 */
function waveFiscalStartMonth_() {
  var raw = Number(readModuleSetting_(
    getModuleSettingsMap(), 'equipment', 'wave_fiscal_year_start_month'
  ));

  if (!isFinite(raw) || raw < 1 || raw > 12) return WAVE_FISCAL_START_MONTH_DEFAULT;
  return Math.floor(raw);
}

/**
 * The slot a wave date falls in: 1, 2, 3, or WAVE_SLOT_OFF_CYCLE.
 *
 * Derived, never allocated. Three internal waves a year, one per quarter, with
 * Q4 given over to the third-party inspection — so the quarter *is* the wave
 * number, and an inspection filed to replace a rejected one carries the same
 * number as long as it happens in the same quarter.
 *
 * The consequence worth knowing: an inspection that slips into the next quarter
 * files under *that* quarter's number, and the slot it was meant to fill stays
 * empty for that year. That is a true statement about the programme — the wave
 * was missed — and inventing a number that hid it would make the coverage
 * figures say the opposite of what happened.
 *
 * @param {string} iso  'YYYY-MM-DD'
 * @return {number}
 */
function waveSlotFor_(iso) {
  var quarter = fiscalQuarterFor_(iso, waveFiscalStartMonth_());
  return WAVE_SLOT_QUARTERS.indexOf(quarter) === -1 ? WAVE_SLOT_OFF_CYCLE : quarter;
}

/**
 * @private
 * The wave already stored under this idempotency key, or null.
 *
 * This is what makes the officer's offline outbox safe to retry. A queued wave
 * whose response was lost — sent, written, answer never delivered — gets sent
 * again on the next flush; without this lookup that retry writes a second
 * inspection against the same item on the same day, and a phantom wave on a
 * safety record is exactly the kind of error nobody catches.
 *
 * @param {Array<Object>} waves
 * @param {string} clientId
 * @return {Object|null}
 */
function waveByClientId_(waves, clientId) {
  if (clientId === '') return null;

  for (var i = 0; i < waves.length; i++) {
    if (waves[i].client_id === clientId) return waves[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared write path
// ---------------------------------------------------------------------------

/**
 * @private
 * Validates a wave submission from either door and returns sheet-ready values.
 *
 * The admin and the officer submit the same thing — an item, a date, a result, a
 * comment — so they validate through one function. What differs is who may call
 * them and what `origin` gets stamped, and that lives in the handlers.
 *
 * @param {Object} input
 * @param {Object} ctx  {equipmentById, today}
 * @return {{values: Object, errors: Object}}
 */
function validateWaveInput_(input, ctx) {
  var errors = {};
  var values = {};

  var equipmentId = normalizeString(input.equipment_id);
  if (equipmentId === '') {
    errors.equipment_id = 'required';
  } else if (!ctx.equipmentById[equipmentId]) {
    errors.equipment_id = 'unknown_equipment';
  } else if (normalizeBoolean(ctx.equipmentById[equipmentId].rejected)) {
    // A rejected item is out of service. Inspecting it is not a thing that
    // should be recorded as if it were in the fleet.
    errors.equipment_id = 'equipment_rejected';
  } else {
    values.equipment_id = equipmentId;
  }

  var waveDate = normalizeIsoDate(input.wave_date);
  if (normalizeString(input.wave_date) === '') {
    errors.wave_date = 'required';
  } else if (waveDate === '') {
    errors.wave_date = 'invalid_format';
  } else if (waveDate > ctx.today) {
    // An inspection is a thing that happened. A future date is a typo or a
    // phone with a wrong clock, and either way it would sort to the top of the
    // history and drive the verdict from a wave nobody performed.
    errors.wave_date = 'future_date';
  } else {
    values.wave_date = waveDate;
  }

  var result = normalizeString(input.result).toLowerCase();
  if (result === '') {
    errors.result = 'required';
  } else if (EQUIPMENT_WAVE_RESULTS.indexOf(result) === -1) {
    errors.result = 'invalid_value';
  } else {
    values.result = result;
  }

  var comments = normalizeString(input.comments);
  if (comments.length > WAVE_COMMENTS_MAX) {
    errors.comments = 'too_long';
  } else {
    values.comments = comments;
  }

  return { values: values, errors: errors };
}

/**
 * @private
 * {equipment_id → row} for validation, read once.
 *
 * @return {Object<string, Object>}
 */
function equipmentByIdMap_() {
  var rows = readAllRows(SHEET_NAMES.EQUIPMENT);
  var byId = {};

  for (var i = 0; i < rows.length; i++) {
    var id = normalizeString(rows[i].equipment_id);
    if (id !== '') byId[id] = rows[i];
  }
  return byId;
}

/**
 * @private
 * Appends one validated wave and returns it, shaped.
 *
 * MUST be called inside a script lock: it reads the highest wave_id and writes
 * based on it.
 *
 * `wave_no` needs no lock of its own any more — it comes from the wave's own
 * date, so two officers filing against the same item in the same second get the
 * same slot without either read racing the other. That is a real consequence of
 * the quarter model rather than a coincidence: the number describes *when* the
 * inspection happened, and nothing about the tab's contents can change that.
 *
 * @param {Object} values     From validateWaveInput_.
 * @param {string} origin     One of INSPECTION_WAVE_ORIGINS.
 * @param {string} clientId   '' for admin submissions.
 * @param {string} actingUserId
 * @return {Object} the shaped wave
 */
function appendInspectionWave_(values, origin, clientId, actingUserId) {
  var waves = readInspectionWaves_();
  var stampedAt = nowIso();

  // An admin filing a wave is the review. An officer's waits for one.
  var approved = origin !== 'officer';

  var row = {
    wave_id: 'IW-' + padNumber_(nextWaveIdNumber_(waves), 6),
    equipment_id: values.equipment_id,
    wave_no: String(waveSlotFor_(values.wave_date)),
    fiscal_year: fiscalYearFor_(values.wave_date, waveFiscalStartMonth_()).label,
    wave_date: values.wave_date,
    result: values.result,
    comments: values.comments,
    origin: origin,
    client_id: clientId,
    approval_status: approved ? 'approved' : 'pending',
    reviewed_at: approved ? stampedAt : '',
    reviewed_by: approved ? actingUserId : '',
    rejection_reason: '',
    voided: 'FALSE',
    voided_at: '',
    voided_by: '',
    void_reason: '',
    recorded_at: stampedAt,
    recorded_by: actingUserId,
    updated_at: stampedAt,
    updated_by: actingUserId
  };

  appendRow(SHEET_NAMES.INSPECTION_WAVES, row);
  clearInspectionWaveCache_();

  return shapeInspectionWave_(row);
}

// ---------------------------------------------------------------------------
// Action handlers — read
// ---------------------------------------------------------------------------

/**
 * `list_inspection_waves` — the wave log, filtered and paged (Section 3.6).
 *
 * Serves two screens from one action: the capped card on an equipment detail
 * page (`equipment_id` set) and the fleet-wide review queue (no `equipment_id`,
 * filters instead). They differ only in what they filter by, and two handlers
 * for that would be two places to keep the shape in step.
 *
 * Every entry carries the item's identity and the recorder's display name joined
 * in, so neither page makes a second call to render a table — the same reason
 * `list_rdt_overview` joins employee fields onto its entries.
 *
 * @param {Object} session
 * @param {Object} payload  {equipment_id?, month?, result?, recorded_by?,
 *                           origin?, include_voided?, search?, page?, page_size?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListInspectionWaves(session, payload) {
  var denied = requireModuleView(session, 'equipment');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, [
    'equipment_id', 'month', 'result', 'recorded_by', 'origin', 'approval_status',
    'fiscal_year', 'wave_no', 'include_voided', 'search', 'page', 'page_size'
  ]);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var fieldErrors = {};

  var month = normalizeString(payload && payload.month);
  if (month !== '' && !/^\d{4}-\d{2}$/.test(month)) fieldErrors.month = 'invalid_format';

  var result = normalizeString(payload && payload.result).toLowerCase();
  if (result !== '' && EQUIPMENT_WAVE_RESULTS.indexOf(result) === -1) {
    fieldErrors.result = 'invalid_value';
  }

  var origin = normalizeString(payload && payload.origin).toLowerCase();
  if (origin !== '' && INSPECTION_WAVE_ORIGINS.indexOf(origin) === -1) {
    fieldErrors.origin = 'invalid_value';
  }

  // The filter behind the review queue: `pending` is the admin's inbox.
  var approval = normalizeString(payload && payload.approval_status).toLowerCase();
  if (approval !== '' && WAVE_APPROVAL_STATES.indexOf(approval) === -1) {
    fieldErrors.approval_status = 'invalid_value';
  }

  var fiscalYear = normalizeString(payload && payload.fiscal_year);
  if (fiscalYear !== '' && !/^\d{4}-\d{4}$/.test(fiscalYear)) {
    fieldErrors.fiscal_year = 'invalid_format';
  }

  var waveNo = normalizeString(payload && payload.wave_no);
  if (waveNo !== '' && !/^[0-3]$/.test(waveNo)) fieldErrors.wave_no = 'invalid_value';

  var page = readPositiveInt_(payload && payload.page, 1);
  if (page === null) fieldErrors.page = 'invalid_number';

  var pageSize = readPositiveInt_(payload && payload.page_size, WAVE_PAGE_SIZE_DEFAULT);
  if (pageSize === null) fieldErrors.page_size = 'invalid_number';

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  pageSize = Math.min(pageSize, WAVE_PAGE_SIZE_MAX);

  var equipmentId = normalizeString(payload && payload.equipment_id);
  var recordedBy = normalizeString(payload && payload.recorded_by);
  var search = normalizeString(payload && payload.search).toLowerCase();

  // Voided waves are hidden unless asked for. They are history, not the record
  // of what the item's inspections say — that is the whole distinction voiding
  // draws — so the default view is the one that matches the verdict.
  var includeVoided = normalizeBoolean(payload && payload.include_voided);

  var equipmentById = equipmentByIdMap_();
  var names = userNamesById_();
  var waves = readInspectionWaves_();
  var matched = [];

  for (var i = 0; i < waves.length; i++) {
    var wave = waves[i];
    if (!includeVoided && wave.voided) continue;
    if (equipmentId !== '' && wave.equipment_id !== equipmentId) continue;
    if (result !== '' && wave.result !== result) continue;
    if (origin !== '' && wave.origin !== origin) continue;
    if (approval !== '' && wave.approval_status !== approval) continue;
    if (fiscalYear !== '' && wave.fiscal_year !== fiscalYear) continue;
    if (waveNo !== '' && String(wave.wave_no) !== waveNo) continue;
    if (recordedBy !== '' && wave.recorded_by !== recordedBy) continue;
    if (month !== '' && wave.wave_date.slice(0, 7) !== month) continue;

    var item = equipmentById[wave.equipment_id] || null;
    if (search !== '' && !matchesWaveSearch_(wave, item, search)) continue;

    matched.push(shapeWaveForList_(wave, item, names));
  }

  var start = (page - 1) * pageSize;

  return okResponse({
    waves: matched.slice(start, start + pageSize),
    total_matching: matched.length,
    page: page,
    page_size: pageSize
  });
}

// ---------------------------------------------------------------------------
// Action handlers — admin writes
// ---------------------------------------------------------------------------

/**
 * `record_inspection_wave` — an admin files a wave (Section 3.6).
 *
 * @param {Object} session
 * @param {Object} payload  {equipment_id, wave_date, result, comments?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleRecordInspectionWave(session, payload) {
  var denied = requireModuleEdit(session, 'equipment');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, [
    'equipment_id', 'wave_date', 'result', 'comments'
  ]);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  return recordWave_(session, payload, 'admin', '');
}

/**
 * `update_inspection_wave` — an admin corrects a wave in place (Section 3.6).
 *
 * This is the correction path the officer does not have. An officer's wave is
 * frozen the moment it reaches the server; if it is wrong, an admin fixes it
 * here or voids it, and either way the change is stamped with who made it.
 *
 * `equipment_id` and `wave_no` cannot move. A wave filed against the wrong item
 * is not a wave to be edited into the right one — it is one to void, and a fresh
 * one to file, so both facts survive.
 *
 * @param {Object} session
 * @param {Object} payload  {wave_id, updates: {wave_date?, result?, comments?}}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleUpdateInspectionWave(session, payload) {
  var denied = requireModuleEdit(session, 'equipment');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['wave_id', 'updates']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var waveId = normalizeString(payload && payload.wave_id);
  var updates = payload && payload.updates;

  var fieldErrors = {};
  if (waveId === '') fieldErrors.wave_id = 'required';
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    fieldErrors.updates = 'required';
  }
  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  var updateUnknown = collectUnknownKeys_(updates, ['wave_date', 'result', 'comments']);
  if (hasKeys_(updateUnknown)) {
    return errResponse('validation_failed', 'unknown_update_fields', updateUnknown);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('update_inspection_wave: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var found = findWaveRow_(waveId);
    if (!found) return errResponse('not_found', 'wave_not_found');

    var current = shapeInspectionWave_(found.data);
    if (current.voided) {
      // Correcting a wave that counts for nothing is a contradiction: whatever
      // the corrected values said, the verdict would not read them.
      return errResponse('conflict', 'wave_voided');
    }

    var today = todayIso();
    var changes = {};
    var errors = {};

    if (has_(updates, 'wave_date')) {
      var waveDate = normalizeIsoDate(updates.wave_date);
      if (normalizeString(updates.wave_date) === '') errors.wave_date = 'required';
      else if (waveDate === '') errors.wave_date = 'invalid_format';
      else if (waveDate > today) errors.wave_date = 'future_date';
      else {
        changes.wave_date = waveDate;

        // The slot and the year are functions of the date, so a correction that
        // moves the date has to move both with it. Leaving them behind would
        // produce a wave filed in October still numbered as Q1 — the one way
        // the derived model can go out of step with itself.
        changes.wave_no = String(waveSlotFor_(waveDate));
        changes.fiscal_year = fiscalYearFor_(waveDate, waveFiscalStartMonth_()).label;
      }
    }

    if (has_(updates, 'result')) {
      var result = normalizeString(updates.result).toLowerCase();
      if (result === '') errors.result = 'required';
      else if (EQUIPMENT_WAVE_RESULTS.indexOf(result) === -1) errors.result = 'invalid_value';
      else changes.result = result;
    }

    if (has_(updates, 'comments')) {
      var comments = normalizeString(updates.comments);
      if (comments.length > WAVE_COMMENTS_MAX) errors.comments = 'too_long';
      else changes.comments = comments;
    }

    if (hasKeys_(errors)) {
      return errResponse('validation_failed', 'invalid_wave', errors);
    }

    changes.updated_at = nowIso();
    changes.updated_by = session.user.user_id;

    var merged = updateRowAt(SHEET_NAMES.INSPECTION_WAVES, found.row, changes);
    clearInspectionWaveCache_();

    return okResponse(waveWriteResponse_(shapeInspectionWave_(merged)));
  } finally {
    lock.releaseLock();
  }
}

/**
 * `void_inspection_wave` — marks a wave as not counting, without deleting it
 * (Section 3.6).
 *
 * Rule 6 has one documented exception in this platform and it is RdtLog, not
 * this tab. A wave is a record that somebody inspected a piece of safety
 * equipment and wrote down what they found; deleting that is destroying
 * evidence, whatever the reason. So the row stays, the verdict stops reading it,
 * and the reason is on the record next to who decided.
 *
 * Idempotent: voiding an already-voided wave returns it unchanged rather than
 * re-stamping who did it.
 *
 * @param {Object} session
 * @param {Object} payload  {wave_id, reason}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleVoidInspectionWave(session, payload) {
  var denied = requireModuleEdit(session, 'equipment');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['wave_id', 'reason']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var waveId = normalizeString(payload && payload.wave_id);
  var reason = normalizeString(payload && payload.reason);

  var fieldErrors = {};
  if (waveId === '') fieldErrors.wave_id = 'required';

  // Required, not optional. A voided wave with no reason is an inspection that
  // vanished from the record with nothing saying why — which is the situation
  // voiding-instead-of-deleting exists to prevent.
  if (reason === '') fieldErrors.reason = 'required';
  else if (reason.length > WAVE_COMMENTS_MAX) fieldErrors.reason = 'too_long';

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('void_inspection_wave: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var found = findWaveRow_(waveId);
    if (!found) return errResponse('not_found', 'wave_not_found');

    var current = shapeInspectionWave_(found.data);
    if (current.voided) {
      return okResponse(waveWriteResponse_(current));
    }

    var stampedAt = nowIso();
    var merged = updateRowAt(SHEET_NAMES.INSPECTION_WAVES, found.row, {
      voided: 'TRUE',
      voided_at: stampedAt,
      voided_by: session.user.user_id,
      void_reason: reason,
      updated_at: stampedAt,
      updated_by: session.user.user_id
    });
    clearInspectionWaveCache_();

    return okResponse(waveWriteResponse_(shapeInspectionWave_(merged)));
  } finally {
    lock.releaseLock();
  }
}

/**
 * `approve_inspection_wave` — an admin confirms an officer's finding.
 *
 * The wave starts counting toward the item's verdict in full: an approved pass
 * clears it, an approved fail keeps it blocked. Before this, a pending pass was
 * doing nothing at all (Section 6.3), so approving is the act that lets an
 * officer's inspection put equipment back into service.
 *
 * Idempotent — approving an already-approved wave returns it unchanged rather
 * than re-stamping who did it, matching void.
 *
 * @param {Object} session
 * @param {Object} payload  {wave_id}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleApproveInspectionWave(session, payload) {
  return reviewWave_(session, payload, 'approved');
}

/**
 * `reject_inspection_wave` — an admin does not accept an officer's finding.
 *
 * The row stays on the tab forever with the reason and the reviewer on it, and
 * counts for nothing from that moment (wavesByEquipmentId_ drops it at the
 * source, exactly as it drops a voided one). It also frees the wave's slot: the
 * quarter has no accepted inspection again, so a re-inspection inside the same
 * quarter files under the same number.
 *
 * `reason` is required, for the reason it is required on void — a finding that
 * stopped counting with nothing saying why is a finding that disappeared.
 *
 * @param {Object} session
 * @param {Object} payload  {wave_id, reason}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleRejectInspectionWave(session, payload) {
  return reviewWave_(session, payload, 'rejected');
}

/**
 * @private
 * The body both review actions share.
 *
 * @param {Object} session
 * @param {Object} payload
 * @param {string} decision  'approved' | 'rejected'
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function reviewWave_(session, payload, decision) {
  var denied = requireModuleEdit(session, 'equipment');
  if (denied) return denied;

  var rejecting = decision === 'rejected';
  var allowed = rejecting ? ['wave_id', 'reason'] : ['wave_id'];

  var unknown = collectUnknownKeys_(payload, allowed);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var waveId = normalizeString(payload && payload.wave_id);
  var reason = normalizeString(payload && payload.reason);

  var fieldErrors = {};
  if (waveId === '') fieldErrors.wave_id = 'required';
  if (rejecting) {
    if (reason === '') fieldErrors.reason = 'required';
    else if (reason.length > WAVE_COMMENTS_MAX) fieldErrors.reason = 'too_long';
  }
  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('review wave (' + decision + '): could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var found = findWaveRow_(waveId);
    if (!found) return errResponse('not_found', 'wave_not_found');

    var current = shapeInspectionWave_(found.data);

    // A voided wave is already outside the verdict. Reviewing it would be
    // deciding about a record that was withdrawn, and the two states would then
    // both claim to explain why it does not count.
    if (current.voided) return errResponse('conflict', 'wave_voided');

    if (current.approval_status === decision) {
      return okResponse(waveWriteResponse_(current));
    }

    var stampedAt = nowIso();
    var merged = updateRowAt(SHEET_NAMES.INSPECTION_WAVES, found.row, {
      approval_status: decision,
      reviewed_at: stampedAt,
      reviewed_by: session.user.user_id,
      // Cleared on approval so a wave rejected and later approved does not keep
      // a reason that no longer describes it.
      rejection_reason: rejecting ? reason : '',
      updated_at: stampedAt,
      updated_by: session.user.user_id
    });
    clearInspectionWaveCache_();

    return okResponse(waveWriteResponse_(shapeInspectionWave_(merged)));
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Action handler — the officer's door
// ---------------------------------------------------------------------------

/**
 * `officer_record_wave` — an officer files a wave from the field (Section 3.8).
 *
 * The one write an officer session can perform, and the end of rule 16's
 * read-only guarantee. What replaces that guarantee is narrower and worth
 * stating plainly, because the sessionStorage token exception in Section 7.2 now
 * rests on it: this handler appends one row to one tab. It cannot modify any
 * entity, cannot delete anything, cannot reach the Equipment row, and every row
 * it writes carries the officer's user_id in `recorded_by`.
 *
 * `client_id` is the officer's idempotency key, generated on the phone when the
 * wave is queued. A submission whose response never arrived is retried by the
 * outbox on the next flush; without the key that retry writes a second
 * inspection against the same item on the same day. Returning the existing row
 * makes a flush safe to repeat as many times as the signal demands.
 *
 * @param {Object} session
 * @param {Object} payload  {equipment_id, wave_date, result, comments?, client_id}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleOfficerRecordWave(session, payload) {
  var denied = requireOfficer_(session);
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, [
    'equipment_id', 'wave_date', 'result', 'comments', 'client_id'
  ]);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var clientId = normalizeString(payload && payload.client_id);
  if (clientId === '') {
    // Required for officers, unlike admins. An admin submits from a form that
    // either succeeded or visibly did not; an officer submits from a queue that
    // retries on their behalf, and a retry with no key is a duplicate.
    return errResponse('validation_failed', 'invalid_payload', { client_id: 'required' });
  }

  return recordWave_(session, payload, 'officer', clientId);
}

// ---------------------------------------------------------------------------
// Shared write path for both record actions
// ---------------------------------------------------------------------------

/**
 * @private
 * Validate, lock, dedupe, append — the body both record actions share.
 *
 * The permission gate and the unknown-key check stay with the callers, because
 * those are exactly what differs between an admin and an officer. Everything
 * from validation down is identical, and a wave written through one door must be
 * indistinguishable from one written through the other.
 *
 * @param {Object} session
 * @param {Object} payload
 * @param {string} origin    'admin' | 'officer'
 * @param {string} clientId  '' for admin
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function recordWave_(session, payload, origin, clientId) {
  var input = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('record wave (' + origin + '): could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    // Inside the lock: a duplicate check outside it would let two flushes of the
    // same queued wave both pass before either wrote.
    var existing = waveByClientId_(readInspectionWaves_(), clientId);
    if (existing) {
      console.log('record wave: client_id ' + clientId + ' already stored as ' +
        existing.wave_id + ' — returning it unchanged');
      return okResponse(waveWriteResponse_(existing));
    }

    var validation = validateWaveInput_(input, {
      equipmentById: equipmentByIdMap_(),
      today: todayIso()
    });

    if (hasKeys_(validation.errors)) {
      // An unknown or rejected item is `not_found` rather than a field error:
      // the officer's cached snapshot is simply behind the server, and the app
      // handles that code by telling them to re-sync.
      if (validation.errors.equipment_id === 'unknown_equipment' ||
          validation.errors.equipment_id === 'equipment_rejected') {
        return errResponse('not_found', 'equipment_not_found');
      }
      return errResponse('validation_failed', 'invalid_wave', validation.errors);
    }

    var wave = appendInspectionWave_(
      validation.values, origin, clientId, session.user.user_id
    );

    return okResponse(waveWriteResponse_(wave));
  } finally {
    lock.releaseLock();
  }
}

/**
 * @private
 * The response every wave write returns: the wave, plus the item's freshly
 * derived block.
 *
 * The derived block rides along so the caller never has to follow a write with a
 * read to find out what it changed. It matters most on the phone: an officer who
 * records a fail needs the card to turn red immediately, and rule 13 forbids the
 * client working that out for itself — so the server that applied the wave sends
 * back what it now means.
 *
 * @param {Object} wave  Shaped.
 * @return {Object}
 */
function waveWriteResponse_(wave) {
  var equipmentRow = readRowByKey(
    SHEET_NAMES.EQUIPMENT, 'equipment_id', wave.equipment_id
  );

  return {
    wave: wave,
    derived: equipmentRow ? deriveEquipment_(equipmentRow, equipmentContext_()) : null
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * @private
 * A wave row with its sheet row number, for the in-place writes.
 *
 * @param {string} waveId
 * @return {{row: number, data: Object}|null}
 */
function findWaveRow_(waveId) {
  var pairs = readAllRowsWithIndex(SHEET_NAMES.INSPECTION_WAVES);

  for (var i = 0; i < pairs.length; i++) {
    if (normalizeString(pairs[i].data.wave_id) === waveId) return pairs[i];
  }
  return null;
}

/** @private Built once per execution by userNamesById_(). */
var WAVE_USER_NAME_CACHE_ = null;

/**
 * @private
 * {user_id → display_name}, read once per execution.
 *
 * Only ever used by the admin-facing list. Officers never see a user list of any
 * kind (Section 7.6), and the officer's own wave rows travel without an author.
 *
 * @return {Object<string, string>}
 */
function userNamesById_() {
  if (WAVE_USER_NAME_CACHE_) return WAVE_USER_NAME_CACHE_;

  var rows = readAllRows(SHEET_NAMES.USERS);
  var names = {};

  for (var i = 0; i < rows.length; i++) {
    var id = normalizeString(rows[i].user_id);
    if (id !== '') names[id] = normalizeString(rows[i].display_name);
  }

  WAVE_USER_NAME_CACHE_ = names;
  return names;
}

/**
 * @private
 * One wave with the item and the recorder joined in, for a list response.
 *
 * `recorded_by_name` falls back to the raw user_id rather than to a blank: a
 * deactivated user's rows should still say who filed them. A migrated wave has
 * no recorder at all and correctly reads as empty.
 */
function shapeWaveForList_(wave, equipmentRow, names) {
  var out = {};
  for (var key in wave) {
    if (Object.prototype.hasOwnProperty.call(wave, key)) out[key] = wave[key];
  }

  out.recorded_by_name = wave.recorded_by === ''
    ? ''
    : (names[wave.recorded_by] || wave.recorded_by);
  out.voided_by_name = wave.voided_by === ''
    ? ''
    : (names[wave.voided_by] || wave.voided_by);
  out.reviewed_by_name = wave.reviewed_by === ''
    ? ''
    : (names[wave.reviewed_by] || wave.reviewed_by);

  out.item = equipmentRow ? normalizeString(equipmentRow.item) : '';
  out.brand = equipmentRow ? normalizeString(equipmentRow.brand) : '';
  out.serial_no = equipmentRow ? normalizeString(equipmentRow.serial_no) : '';
  out.subcontractor = equipmentRow ? normalizeString(equipmentRow.subcontractor) : '';
  out.equipment_rejected = equipmentRow ? normalizeBoolean(equipmentRow.rejected) : false;

  return out;
}

/**
 * @private
 * A list of waves with recorder names joined, for one already-loaded item.
 *
 * What `get_equipment` uses so its waves array matches the shape
 * `list_inspection_waves` returns — the detail card and the fleet page render
 * from the same fields rather than each knowing its own dialect.
 *
 * @param {Array<Object>} waves
 * @param {Object} equipmentRow
 * @return {Array<Object>}
 */
function wavesWithNames_(waves, equipmentRow) {
  var names = userNamesById_();
  var out = [];

  for (var i = 0; i < waves.length; i++) {
    out.push(shapeWaveForList_(waves[i], equipmentRow, names));
  }
  return out;
}

/** @private Case-insensitive match across the item's identifiers and the comment. */
function matchesWaveSearch_(wave, equipmentRow, lowerQuery) {
  var haystack = [
    wave.equipment_id,
    wave.comments,
    equipmentRow ? equipmentRow.item : '',
    equipmentRow ? equipmentRow.brand : '',
    equipmentRow ? equipmentRow.serial_no : '',
    equipmentRow ? equipmentRow.third_party_sn : ''
  ].join(' ').toLowerCase();

  return haystack.indexOf(lowerQuery) !== -1;
}

// ---------------------------------------------------------------------------
// Tab setup
// ---------------------------------------------------------------------------

/**
 * One-shot: creates the InspectionWaves tab with its header row.
 *
 * Run once from the Apps Script editor, before migrateWavesToLog(). Idempotent —
 * an existing tab is left exactly as it stands, so re-running after a failure is
 * safe.
 *
 * It cannot go through getSheet(), which throws on a missing tab by design
 * (Sheets.gs) — a missing tab is a setup error everywhere else in the codebase,
 * and this is the one place that is allowed to fix it.
 *
 * @return {{created: boolean, headers: Array<string>}}
 */
function setupInspectionWavesTab() {
  var spreadsheet = getSpreadsheet_();
  var existing = spreadsheet.getSheetByName(SHEET_NAMES.INSPECTION_WAVES);

  if (existing) {
    console.log('setupInspectionWavesTab: tab already exists — nothing to do');
    return { created: false, headers: INSPECTION_WAVE_HEADERS };
  }

  var sheet = spreadsheet.insertSheet(SHEET_NAMES.INSPECTION_WAVES);

  // Plain text on the whole tab, so Sheets never turns an ISO date string into a
  // date serial or '0715' into the number 715 (Sheets.gs, storage format).
  sheet.getRange(1, 1, sheet.getMaxRows(), INSPECTION_WAVE_HEADERS.length)
    .setNumberFormat('@');

  sheet.getRange(1, 1, 1, INSPECTION_WAVE_HEADERS.length)
    .setValues([INSPECTION_WAVE_HEADERS])
    .setFontWeight('bold');
  sheet.setFrozenRows(1);

  clearSheetCache();
  console.log('setupInspectionWavesTab: created with ' +
    INSPECTION_WAVE_HEADERS.length + ' columns');
  return { created: true, headers: INSPECTION_WAVE_HEADERS };
}

/**
 * One-shot: adds the approval and fiscal-year columns to a tab that already
 * exists, and backfills every row.
 *
 * Run once from the Apps Script editor if the InspectionWaves tab was created
 * before the review flow existed. Idempotent — a column already present is left
 * alone, so re-running after a failure is safe. A tab created by
 * setupInspectionWavesTab() from now on already has all four and needs nothing.
 *
 * The backfill is the same judgement shapeInspectionWave_ makes for a blank
 * cell, written down once: admin and migrated rows read as `approved` because
 * they were already driving the verdict and nothing about them changed; officer
 * rows read as `pending`, because an officer's finding now waits for a review
 * and the few already on the tab should join that queue rather than skip it.
 *
 * `wave_no` is recomputed from each row's own date, since the number is now the
 * fiscal quarter rather than a per-item counter. Rows with no date keep what
 * they have — there is nothing to derive from.
 *
 * @return {{added: Array<string>, rows: number, renumbered: number,
 *     pending: number}}
 */
function addWaveApprovalColumns() {
  var sheet = getSheet(SHEET_NAMES.INSPECTION_WAVES);
  var headers = getHeaders(SHEET_NAMES.INSPECTION_WAVES);

  var wanted = ['fiscal_year', 'approval_status', 'reviewed_at', 'reviewed_by', 'rejection_reason'];
  var added = [];

  for (var i = 0; i < wanted.length; i++) {
    if (headers.indexOf(wanted[i]) !== -1) continue;

    var col = headers.length + 1;
    sheet.getRange(1, col, sheet.getMaxRows(), 1).setNumberFormat('@');
    sheet.getRange(1, col).setValue(wanted[i]).setFontWeight('bold');
    headers.push(wanted[i]);
    added.push(wanted[i]);
  }

  clearSheetCache();
  clearInspectionWaveCache_();

  // --- Backfill ------------------------------------------------------------
  var startMonth = waveFiscalStartMonth_();
  var pairs = readAllRowsWithIndex(SHEET_NAMES.INSPECTION_WAVES);
  var renumbered = 0;
  var pending = 0;

  for (var r = 0; r < pairs.length; r++) {
    var row = pairs[r].data;
    if (normalizeString(row.wave_id) === '') continue;

    var origin = normalizeString(row.origin).toLowerCase() || 'admin';
    var date = normalizeIsoDate(row.wave_date);
    var changes = {};

    if (normalizeString(row.approval_status) === '') {
      changes.approval_status = origin === 'officer' ? 'pending' : 'approved';
      if (changes.approval_status === 'pending') pending++;
    }

    if (date !== '') {
      if (normalizeString(row.fiscal_year) === '') {
        changes.fiscal_year = fiscalYearFor_(date, startMonth).label;
      }

      var slot = String(waveSlotFor_(date));
      if (normalizeString(row.wave_no) !== slot) {
        changes.wave_no = slot;
        renumbered++;
      }
    }

    if (hasKeys_(changes)) updateRowAt(SHEET_NAMES.INSPECTION_WAVES, pairs[r].row, changes);
  }

  clearInspectionWaveCache_();

  console.log('addWaveApprovalColumns: ' + added.length + ' columns added (' +
    (added.join(', ') || 'none') + '), ' + pairs.length + ' rows scanned, ' +
    renumbered + ' renumbered to their fiscal quarter, ' +
    pending + ' officer waves now awaiting review');

  return { added: added, rows: pairs.length, renumbered: renumbered, pending: pending };
}

// ---------------------------------------------------------------------------
// Migration — the wave_1/2/3 columns into the log
// ---------------------------------------------------------------------------

/**
 * Logs what migrateWavesToLog() would write, and writes nothing.
 *
 * Run this first and read the execution log. The count is the check: it should
 * equal the number of non-empty wave slots across the Equipment tab. If it is
 * far off, the columns hold something other than what this reads them as, and
 * that is worth knowing before the write rather than after.
 *
 * @return {Object} the same summary migrateWavesToLog() returns
 */
function previewWaveMigration() {
  return migrateWaves_(false);
}

/**
 * Copies every recorded wave_1/2/3 slot into the InspectionWaves tab.
 *
 * Idempotent: a slot already carrying a row for the same (equipment_id, wave_no)
 * is skipped, so a second run reports zero added and a run interrupted halfway
 * can simply be repeated.
 *
 * **It does not clear the columns.** They stay on the Equipment tab as dead
 * history until deleted by hand. A migration that destroys its own source is one
 * nobody can check afterwards, and the columns cost nothing to leave.
 *
 * Three things are deliberately not invented:
 *
 *   `recorded_by` is blank. Nothing on the Equipment row records who filed a
 *   wave — that is the gap this whole feature closes — and stamping the admin
 *   who happens to run the migration would put a name against inspections they
 *   never performed.
 *
 *   `recorded_at` is the wave's own date at midnight, not the migration clock.
 *   The row is a record of an inspection that happened then.
 *
 *   `origin` is 'migration', so a coverage figure can always be traced back to
 *   whether it was earned before or after the platform tracked waves properly.
 *
 * @return {{applied: boolean, added: number, skipped: number, items: number,
 *     incomplete: number}}
 */
function migrateWavesToLog() {
  return migrateWaves_(true);
}

/**
 * @private
 * @param {boolean} apply
 * @return {Object}
 */
function migrateWaves_(apply) {
  // Fails loudly rather than silently migrating into nothing.
  getSheet(SHEET_NAMES.INSPECTION_WAVES);

  var existing = readInspectionWaves_();

  // Keyed on the date rather than the old slot number, because the slot is now
  // derived from the date and the two no longer mean the same thing. What makes
  // a re-run a no-op is "this item already has an inspection on this day",
  // which is the honest statement of what a duplicate would be.
  var taken = {};
  for (var e = 0; e < existing.length; e++) {
    if (existing[e].wave_date === '') continue;
    taken[existing[e].equipment_id + '#' + existing[e].wave_date] = true;
  }

  var startMonth = waveFiscalStartMonth_();
  var equipmentRows = readAllRows(SHEET_NAMES.EQUIPMENT);
  var nextId = nextWaveIdNumber_(existing);

  var newRows = [];
  var skipped = 0;
  var incomplete = 0;
  var itemsTouched = {};

  for (var r = 0; r < equipmentRows.length; r++) {
    var equipmentId = normalizeString(equipmentRows[r].equipment_id);
    if (equipmentId === '') continue;

    for (var w = 0; w < EQUIPMENT_WAVES.length; w++) {
      var waveNo = EQUIPMENT_WAVES[w];
      var date = normalizeIsoDate(equipmentRows[r]['wave_' + waveNo + '_date']);
      var result = normalizeString(equipmentRows[r]['wave_' + waveNo + '_result']).toLowerCase();

      // An untouched slot is not a wave that happened.
      if (date === '' && result === '') continue;

      if (date !== '' && taken[equipmentId + '#' + date]) {
        skipped++;
        continue;
      }

      // A slot with one half filled in is migrated as it stands rather than
      // dropped or guessed at. It will not drive the verdict — Section 6.3 needs
      // both a date and a result — but it is what the tab says, and the point of
      // a migration is to carry that across faithfully.
      if (date === '' || result === '') incomplete++;

      // The old column position is discarded, not carried over. `wave_1_date`
      // meant "the first inspection we did"; the new number means "the quarter
      // it happened in", and an inspection filed in the old wave-1 column but
      // dated November is a Q3 wave. Keeping the column's number would put the
      // migrated history on a different calendar from everything recorded after
      // it, which is the one thing a migration must not do.
      var slot = date === '' ? WAVE_SLOT_OFF_CYCLE : waveSlotFor_(date);
      if (date !== '') taken[equipmentId + '#' + date] = true;

      newRows.push({
        wave_id: 'IW-' + padNumber_(nextId, 6),
        equipment_id: equipmentId,
        wave_no: String(slot),
        fiscal_year: date === '' ? '' : fiscalYearFor_(date, startMonth).label,
        wave_date: date,
        result: result,
        comments: '',
        origin: 'migration',
        client_id: '',
        // Migrated waves were already driving the verdict from the Equipment
        // row before this tab existed. Landing them as `pending` would put
        // years of settled history into the admin's review queue on day one.
        approval_status: 'approved',
        reviewed_at: '',
        reviewed_by: '',
        rejection_reason: '',
        voided: 'FALSE',
        voided_at: '',
        voided_by: '',
        void_reason: '',
        recorded_at: date === '' ? '' : date + 'T00:00:00',
        recorded_by: '',
        updated_at: date === '' ? '' : date + 'T00:00:00',
        updated_by: ''
      });
      nextId++;
      itemsTouched[equipmentId] = true;
    }
  }

  if (apply && newRows.length > 0) {
    appendRows(SHEET_NAMES.INSPECTION_WAVES, newRows);
    clearInspectionWaveCache_();
  }

  var summary = {
    applied: apply && newRows.length > 0,
    added: newRows.length,
    skipped: skipped,
    items: Object.keys(itemsTouched).length,
    incomplete: incomplete
  };

  console.log((apply ? 'migrateWavesToLog' : 'previewWaveMigration') + ': ' +
    newRows.length + (apply ? ' waves written' : ' waves would be written') +
    ' across ' + summary.items + ' items, ' + skipped + ' already migrated, ' +
    incomplete + ' with a date or a result but not both');

  return summary;
}
