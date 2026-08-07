/**
 * Officer.gs — the three read-only actions the mobile PWA calls
 * (CLAUDE.md Sections 3.8 and 7).
 *
 * Officers get a different API surface, not a filtered view of the admin one.
 * Every response here is built by an allowlist shaper — shapeOfficerEmployee_
 * and shapeOfficerEquipment_ name the fields they emit rather than copying an
 * admin object and deleting from it. A denylist would leak the next column
 * somebody adds to the schema; an allowlist stays closed by default (Section
 * 7.6).
 *
 * What that means in practice, per Section 7.6:
 *   - no `_link` columns          file URLs are useless at a tower site
 *   - no `comments`               admin notes, not officer-facing
 *   - no `*_by` audit fields      who edited what is an admin question
 *   - no history tabs             RenewalHistory / InspectionHistory never load
 *   - no users, no password data  never returned by any action anyway
 *
 * Also absent, and worth naming because Section 7.6 does not: `created_at` and
 * `updated_at`. Section 7.6 strips only the `*_by` half of each audit pair, but
 * its positive list of what officers DO see is identity fields, dates, quals,
 * and the derived block — and no screen in Section 7.5 renders a row timestamp.
 * The officer's freshness signal is `synced_at` on the snapshot, not per-record.
 *
 * Archived employees and rejected equipment never appear — not in the snapshot,
 * and `not_found` from the single-entity fetches. An officer scanning a badge
 * for someone who left the company gets the same answer as one scanning a badge
 * that was never issued.
 *
 * Everything here is a read. Officers do not write in v1 (rule 16), and there
 * is no code path in this file that touches a sheet with anything but a read.
 */

// ---------------------------------------------------------------------------
// Role gate
// ---------------------------------------------------------------------------

/**
 * @private
 * Guard for the top of every officer action. Same contract as
 * requireModuleView: an envelope to return immediately, or null to proceed.
 *
 * The check is `role === 'officer'` exactly — a super admin is refused here.
 * That is not an oversight: Section 3.8 scopes these actions to the officer
 * role, and an admin has the richer, unstripped list/get actions for the same
 * data. Keeping the two surfaces disjoint means the stripping rules in this
 * file are the only rules that ever apply to an officer_* response, with no
 * second caller profile to reason about.
 *
 * @param {Object} session  Context from validateSession().
 * @return {GoogleAppsScript.Content.TextOutput|null}
 */
function requireOfficer_(session) {
  if (session && session.user && session.user.role === ROLES.OFFICER) return null;
  console.warn('officer action denied: ' + describeSession_(session));
  return errResponse('forbidden', 'officer_role_required');
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * `officer_sync` — the full stripped snapshot the phone caches in IndexedDB
 * (Sections 3.8, 7.3).
 *
 * This is the heaviest action in the API and the one an officer runs least
 * often: it derives every active employee and every active piece of equipment
 * in one pass. Unpaged on purpose — the snapshot is the officer's entire
 * offline database, and a partial one would fail closed at the worst moment
 * (Section 7.4).
 *
 * `max_stale_hours` travels with the snapshot rather than being read from
 * `get_config` at lockout time, because the lockout check has to work with no
 * signal (Section 7.4). The value the officer is judged against is the one that
 * was in force when they last synced.
 *
 * @param {Object} session  Context from validateSession().
 * @param {Object} payload  None.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleOfficerSync(session, payload) {
  var denied = requireOfficer_(session);
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, []);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var ctx = officerContext_();

  // --- Employees: active only ----------------------------------------------
  var employees = [];
  for (var e = 0; e < ctx.employeeRows.length; e++) {
    var employeeRow = ctx.employeeRows[e];
    if (normalizeString(employeeRow.employee_id) === '') continue;
    if (normalizeBoolean(employeeRow.archived)) continue;
    employees.push(shapeOfficerEmployee_(employeeRow, deriveEmployee_(employeeRow, ctx)));
  }
  employees.sort(compareOfficerEmployees_);

  // --- Equipment: not rejected ---------------------------------------------
  var equipmentRows = readAllRows(SHEET_NAMES.EQUIPMENT);
  var equipment = [];
  for (var q = 0; q < equipmentRows.length; q++) {
    var equipmentRow = equipmentRows[q];
    if (normalizeString(equipmentRow.equipment_id) === '') continue;
    if (normalizeBoolean(equipmentRow.rejected)) continue;
    equipment.push(shapeOfficerEquipment_(
      equipmentRow, deriveEquipment_(equipmentRow, ctx), ctx.employeesById
    ));
  }
  equipment.sort(compareOfficerEquipment_);

  return okResponse({
    synced_at: nowIso(),
    max_stale_hours: getConfigNumber('max_stale_hours', CONFIG_DEFAULTS.max_stale_hours),
    thresholds: ctx.thresholds,
    employees: employees,
    equipment: equipment,
    field_options: getFieldOptionsMap()
  });
}

/**
 * `officer_get_employee` — one live employee, for the Refresh button on the
 * verdict page (Sections 3.8, 7.5).
 *
 * Not the normal display path. The card renders from cache; this runs only when
 * the officer explicitly asks for confirmation, so it reads a single row rather
 * than paying for the snapshot's full-tab scan.
 *
 * @param {Object} session
 * @param {Object} payload  {employee_id}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleOfficerGetEmployee(session, payload) {
  var denied = requireOfficer_(session);
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

  // Archived reads as "no such employee" here. The officer's cache still holds
  // the row from before they left; refreshing is how it gets corrected.
  if (normalizeBoolean(row.archived)) {
    return errResponse('not_found', 'employee_not_found');
  }

  var ctx = {
    today: todayIso(),
    thresholds: getComplianceThresholds(),
    moduleSettings: getModuleSettingsMap()
  };

  return okResponse({
    employee: shapeOfficerEmployee_(row, deriveEmployee_(row, ctx)),
    fetched_at: nowIso()
  });
}

/**
 * `officer_get_equipment` — one live piece of equipment, same Refresh path
 * (Sections 3.8, 7.5).
 *
 * The equipment verdict needs the team leader's row to raise its "owner
 * archived" warning (Section 6.3), so one employee is read by key. The whole
 * Employees tab is deliberately not loaded: a single refresh should cost two
 * row reads, not a full scan.
 *
 * @param {Object} session
 * @param {Object} payload  {equipment_id}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleOfficerGetEquipment(session, payload) {
  var denied = requireOfficer_(session);
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

  // Rejected reads as "no such equipment", for the same reason archived does on
  // the employee side.
  if (normalizeBoolean(row.rejected)) {
    return errResponse('not_found', 'equipment_not_found');
  }

  var ctx = {
    today: todayIso(),
    thresholds: getComplianceThresholds(),
    moduleSettings: getModuleSettingsMap(),
    employeesById: officerLeaderMap_(row.team_leader_id)
  };

  return okResponse({
    equipment: shapeOfficerEquipment_(row, deriveEquipment_(row, ctx), ctx.employeesById),
    fetched_at: nowIso()
  });
}

// ---------------------------------------------------------------------------
// Derivation context
// ---------------------------------------------------------------------------

/**
 * @private
 * The per-request derivation inputs for a full sync, plus the Employees rows
 * themselves.
 *
 * Deliberately not employeeContext_() + equipmentContext_(): both of those are
 * right for their own module, but using them together would read the Employees
 * tab twice — once for the employee list, once inside equipmentEmployeesById_()
 * to build the team leader join. A sync reads it once and serves both.
 *
 * Archived employees stay in `employeesById` even though they are filtered out
 * of the snapshot: they are exactly the rows that make deriveEquipmentDerived
 * raise its "owner archived" warning, and dropping them would silently turn
 * that warning off.
 *
 * @return {{today: string, thresholds: Object, moduleSettings: Object,
 *           employeesById: Object<string, Object>, employeeRows: Array<Object>}}
 */
function officerContext_() {
  var rows = readAllRows(SHEET_NAMES.EMPLOYEES);

  var byId = {};
  for (var i = 0; i < rows.length; i++) {
    var id = normalizeString(rows[i].employee_id);
    if (id !== '') byId[id] = rows[i];
  }

  return {
    today: todayIso(),
    thresholds: getComplianceThresholds(),
    moduleSettings: getModuleSettingsMap(),
    employeesById: byId,
    employeeRows: rows
  };
}

/**
 * @private
 * A one-entry {employee_id → row} map for a single equipment refresh, or an
 * empty map when the item has no team leader or the reference is dangling.
 *
 * @param {*} teamLeaderId
 * @return {Object<string, Object>}
 */
function officerLeaderMap_(teamLeaderId) {
  var leaderId = normalizeString(teamLeaderId);
  if (leaderId === '') return {};

  var leader = readRowByKey(SHEET_NAMES.EMPLOYEES, 'employee_id', leaderId);
  if (!leader) return {};

  var map = {};
  map[leaderId] = leader;
  return map;
}

// ---------------------------------------------------------------------------
// Officer shapes (Section 7.6)
// ---------------------------------------------------------------------------

/**
 * @private
 * One employee as an officer sees them: who they are, when their certificates
 * expire, which qualifications they hold, and the verdict.
 *
 * Certificate expiry dates are emitted without their `_link` partners. The cert
 * keys come from EMPLOYEE_CERT_KEYS rather than a list of their own, so a cert
 * added to the schema reaches the officer app with its date and without its
 * link, automatically.
 *
 * Both teams get all ten cert columns. The safety-only three are blank for a
 * field employee, and the officer card renders per-cert state from the derived
 * block — a blank date here is the same "no record" the admin sees.
 *
 * @param {Object} row      Raw Employees row.
 * @param {Object} derived  Block from deriveEmployeeDerived.
 * @return {Object}
 */
function shapeOfficerEmployee_(row, derived) {
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
    legal_permission: normalizeString(row.legal_permission)
  };

  for (var c = 0; c < EMPLOYEE_CERT_KEYS.length; c++) {
    var certKey = EMPLOYEE_CERT_KEYS[c];
    out['cert_' + certKey + '_expiry'] = normalizeIsoDate(row['cert_' + certKey + '_expiry']);
  }
  for (var q = 0; q < EMPLOYEE_QUAL_KEYS.length; q++) {
    out['qual_' + EMPLOYEE_QUAL_KEYS[q]] = normalizeBoolean(row['qual_' + EMPLOYEE_QUAL_KEYS[q]]);
  }

  /* No RDT here, deliberately (Section 7.6). Drug testing is HR compliance
     paperwork and has no bearing on whether someone may work today — the
     verdict does not depend on it, so an officer at a tower has no use for it
     and no business seeing who has been tested. */

  out.derived = derived;
  return out;
}

/**
 * @private
 * One piece of equipment as an officer sees it: what it is, its two serial
 * numbers, its inspection dates, its wave results, and the verdict.
 *
 * `comments` is absent — Section 7.6 names it explicitly as admin-only. So are
 * the rejection columns: a rejected item never reaches this function, so
 * `rejected: false` and three empty fields would be noise on every row of the
 * snapshot.
 *
 * `team_leader_name` is joined in because the officer card names the holder,
 * and `team_leader_archived` because the "needs reassignment" warning reads
 * better next to the flag that caused it. Neither is an audit field.
 *
 * @param {Object} row      Raw Equipment row.
 * @param {Object} derived  Block from deriveEquipmentDerived.
 * @param {Object<string, Object>} employeesById
 * @return {Object}
 */
function shapeOfficerEquipment_(row, derived, employeesById) {
  var leaderId = normalizeString(row.team_leader_id);
  var leader = (leaderId !== '' && employeesById) ? employeesById[leaderId] : null;

  var out = {
    equipment_id: normalizeString(row.equipment_id),
    team_leader_id: leaderId,
    team_leader_name: leader ? normalizeString(leader.name) : '',
    team_leader_archived: leader ? normalizeBoolean(leader.archived) : false,
    item: normalizeString(row.item),
    brand: normalizeString(row.brand),
    date_of_manufacture: normalizeIsoDate(row.date_of_manufacture),
    serial_no: normalizeString(row.serial_no),
    third_party_sn: normalizeString(row.third_party_sn),
    third_party_inspection_end_date: normalizeIsoDate(row.third_party_inspection_end_date)
  };

  for (var w = 0; w < EQUIPMENT_WAVES.length; w++) {
    var n = EQUIPMENT_WAVES[w];
    out['wave_' + n + '_date'] = normalizeIsoDate(row['wave_' + n + '_date']);
    out['wave_' + n + '_result'] = normalizeString(row['wave_' + n + '_result']).toLowerCase();
  }

  out.derived = derived;
  return out;
}

// ---------------------------------------------------------------------------
// Snapshot ordering
// ---------------------------------------------------------------------------

/**
 * @private
 * Alphabetical by name — the same order every admin employee list renders in,
 * so the officer's search results and the admin's list agree.
 */
function compareOfficerEmployees_(a, b) {
  var an = a.name.toLowerCase();
  var bn = b.name.toLowerCase();
  if (an === bn) return 0;
  return an < bn ? -1 : 1;
}

/**
 * @private
 * Item type, then serial number. Serial breaks the tie because a site holds
 * many harnesses and the serial is the only thing that tells two of them apart.
 */
function compareOfficerEquipment_(a, b) {
  var ai = a.item.toLowerCase();
  var bi = b.item.toLowerCase();
  if (ai !== bi) return ai < bi ? -1 : 1;

  var as = a.serial_no.toLowerCase();
  var bs = b.serial_no.toLowerCase();
  if (as === bs) return 0;
  return as < bs ? -1 : 1;
}
