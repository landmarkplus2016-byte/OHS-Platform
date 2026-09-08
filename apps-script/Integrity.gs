/**
 * Integrity.gs — record integrity: the check catalogue and `list_data_issues`
 * (CLAUDE.md Section 3.10).
 *
 * WHAT THIS ANSWERS, AND WHAT IT DOES NOT
 * ---------------------------------------
 * Compliance.gs answers "may this person work today". This file answers "does
 * this record contradict itself". They are different questions asked at
 * different moments, and keeping them apart is the whole design:
 *
 *   Compliance.gs   runs per row on every list, every verdict, every officer
 *                   snapshot. It is about dates, and it is on the hot path.
 *   Integrity.gs    runs once, for one admin page, over the whole roster. It is
 *                   about bookkeeping, and nothing waits on it.
 *
 * A finding here never affects a verdict, a compliance state or a dashboard KPI.
 * An employee with a malformed national_id is still `cleared` if their
 * certificates are in order. Same separation RDT has, and for the same reason.
 *
 * WHY THERE IS NO BULK FIX
 * ------------------------
 * The fix differs per record and is a judgement only somebody who knows the
 * roster can make. A blank MCU resolves either to "enter the medical" or to
 * "tick N/A", and a script picking one would invent that answer across the
 * whole roster. Every finding carries an `edit_route` to the form that fixes
 * it; the existing write actions stay the only way in. This is the same
 * reasoning that gave previewStatusArchiveDrift() no apply counterpart.
 *
 * WHAT IS DELIBERATELY NOT CHECKED
 * --------------------------------
 * Whether an `_na` flag is *correct*. "This Site Engineer has their medical
 * marked N/A and probably shouldn't" is not mechanically decidable — it needs
 * somebody who knows the roster, and a page that asserted it would be wrong
 * often enough to train admins into ignoring the page. The counts ride along in
 * `patterns` so a human can spot it. Never as a finding.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The two severities (Section 3.10).
 *
 *   contradiction  the record disagrees with itself. Something is definitely
 *                  wrong here, whoever looks at it.
 *   gap            something is not recorded. It may be an oversight or it may
 *                  be fine; the platform cannot tell, and says so rather than
 *                  guessing.
 *
 * Two rather than three on purpose: a third tier always collapses back into one
 * of these in practice, and an admin working a list does not need a priority
 * ranking so much as a "is this definitely broken" flag.
 */
var DQ_SEVERITIES = ['contradiction', 'gap'];

/** Modules that can contribute findings, in the order the page shows them. */
var DQ_MODULES = ['employees', 'equipment'];

/**
 * Egyptian national ID: exactly 14 digits (Section 2).
 *
 * Two live records fail this today, one 13 digits and one 15 — both almost
 * certainly a lost or doubled keystroke at import rather than a real ID.
 */
var DQ_NATIONAL_ID_PATTERN = /^\d{14}$/;

/**
 * Hire dates before this are the Excel serial-zero artifact, not history.
 *
 * A date read as a number rather than a date lands in 1905, and fourteen rows
 * carry one. The bound is deliberately loose rather than matching `1905-07-..`
 * exactly: a tighter rule would be more precise about today's bug and would
 * miss the next variant of the same import failure. Landmark did not employ
 * anybody before this.
 */
var DQ_MIN_PLAUSIBLE_HIRE_DATE = '1990-01-01';

/** A wave waiting on review longer than this is a finding (Section 3.10). */
var DQ_WAVE_PENDING_MAX_DAYS = 14;

/** Paging for list_data_issues. */
var DQ_PAGE_SIZE_DEFAULT = 100;
var DQ_PAGE_SIZE_MAX = 500;

// ---------------------------------------------------------------------------
// Action handler
// ---------------------------------------------------------------------------

/**
 * `list_data_issues` — every record that contradicts itself or is missing
 * something it should carry.
 *
 * Permission is per module rather than one gate at the top: a module admin who
 * cannot see equipment does not learn how many equipment records are broken.
 * Officers cannot reach this at all — every branch requires a module view, and
 * an officer session holds none of the admin permissions.
 *
 * @param {Object} session
 * @param {Object} payload  {modules?, severity?, check?, page?, page_size?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListDataIssues(session, payload) {
  // Officers are refused outright rather than left to fall through.
  // canViewModule already returns false for every module on an officer session,
  // so the fall-through would return an empty list and leak nothing — but
  // "you may not ask this" and "there is nothing to report" are different
  // answers, and only one of them is true. Section 9.3 forbids showing this
  // page to an officer; this is that rule stated once, at the door.
  if (session && session.user && session.user.role === ROLES.OFFICER) {
    console.warn('list_data_issues: refused officer session ' + session.user.user_id);
    return errResponse('forbidden', 'module_view_denied');
  }

  var unknown = collectUnknownKeys_(payload, [
    'modules', 'severity', 'check', 'page', 'page_size'
  ]);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var fieldErrors = {};

  var severity = normalizeString(payload && payload.severity).toLowerCase();
  if (severity !== '' && DQ_SEVERITIES.indexOf(severity) === -1) {
    fieldErrors.severity = 'invalid_value';
  }

  var check = normalizeString(payload && payload.check);

  var requested = (payload && payload.modules) || null;
  if (requested !== null && !Array.isArray(requested)) fieldErrors.modules = 'invalid_type';

  var page = readPositiveInt_(payload && payload.page, 1);
  if (page === null) fieldErrors.page = 'invalid_number';

  var pageSize = readPositiveInt_(payload && payload.page_size, DQ_PAGE_SIZE_DEFAULT);
  if (pageSize === null) fieldErrors.page_size = 'invalid_number';

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  pageSize = Math.min(pageSize, DQ_PAGE_SIZE_MAX);

  // Which modules this session may actually be told about. An explicit
  // `modules` narrows the set; it can never widen it past the permission.
  var modules = [];
  for (var m = 0; m < DQ_MODULES.length; m++) {
    var name = DQ_MODULES[m];
    if (requested !== null && requested.indexOf(name) === -1) continue;
    if (!canViewModule(session, name)) continue;
    modules.push(name);
  }

  var today = todayIso();
  var moduleSettings = getModuleSettingsMap();
  var findings = [];
  var patterns = {};

  if (modules.indexOf('employees') !== -1) {
    var employeeRows = readAllRows(SHEET_NAMES.EMPLOYEES);
    findings = findings.concat(dqEmployeeFindings_(employeeRows, today, moduleSettings));
    patterns.employees = dqEmployeePatterns_(employeeRows);
  }

  if (modules.indexOf('equipment') !== -1) {
    findings = findings.concat(dqEquipmentFindings_(today));
  }

  // Counts describe the whole result set, not the page — an admin needs to know
  // there are 63 problems before deciding to work through page 1 of 7.
  var counts = { contradiction: 0, gap: 0 };
  var byCheck = {};
  var matched = [];

  for (var i = 0; i < findings.length; i++) {
    var finding = findings[i];
    if (severity !== '' && finding.severity !== severity) continue;
    if (check !== '' && finding.check !== check) continue;

    counts[finding.severity]++;
    byCheck[finding.check] = (byCheck[finding.check] || 0) + 1;
    matched.push(finding);
  }

  matched.sort(dqCompareFindings_);

  var start = (page - 1) * pageSize;
  return okResponse({
    findings: matched.slice(start, start + pageSize),
    total_matching: matched.length,
    counts: counts,
    by_check: byCheck,
    patterns: patterns,
    modules: modules,
    page: page,
    page_size: pageSize,
    today: today
  });
}

/**
 * @private
 * Contradictions before gaps, then by check so identical problems sit together,
 * then by entity id so the order is stable between calls.
 *
 * Grouping by check rather than by record is the point: the same cleanup is
 * nearly always the same fix repeated, and thirty-six blank certificates
 * scattered across thirty-six employees is a scavenger hunt where one grouped
 * list is an afternoon's work.
 */
function dqCompareFindings_(a, b) {
  if (a.severity !== b.severity) return a.severity === 'contradiction' ? -1 : 1;
  if (a.check !== b.check) return a.check < b.check ? -1 : 1;
  if (a.entity_id !== b.entity_id) return a.entity_id < b.entity_id ? -1 : 1;
  return a.field < b.field ? -1 : (a.field > b.field ? 1 : 0);
}

/** @private One finding in the Section 3.10 shape. */
function dqFinding_(spec) {
  return {
    module: spec.module,
    entity_id: spec.entity_id,
    entity_label: spec.entity_label,
    severity: spec.severity,
    check: spec.check,
    field: spec.field || '',
    text_key: 'dq_' + spec.check,
    text_params: spec.text_params || {},
    edit_route: spec.edit_route
  };
}

// ---------------------------------------------------------------------------
// Employee checks
// ---------------------------------------------------------------------------

/**
 * Every finding across the Employees tab.
 *
 * Archived employees are checked for contradictions but not for gaps. A record
 * of somebody who left years ago with no legal permission on file is not work
 * anybody is going to do, and burying twelve live problems under two hundred
 * historical ones is how a page like this stops being read. A contradiction on
 * an archived row still shows, because it says the archive itself is wrong.
 *
 * @param {Array<Object>} rows           Every Employees row.
 * @param {string} today
 * @param {Object} moduleSettings
 * @return {Array<Object>}
 */
function dqEmployeeFindings_(rows, today, moduleSettings) {
  var archiveStatuses = employeeArchiveStatuses_(moduleSettings);
  var lowerStatuses = [];
  for (var s = 0; s < archiveStatuses.length; s++) {
    lowerStatuses.push(archiveStatuses[s].toLowerCase());
  }

  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var employeeId = normalizeString(row.employee_id);
    if (employeeId === '') continue;

    var archived = normalizeBoolean(row.archived);
    var status = normalizeString(row.employment_status);
    var isTerminal = lowerStatuses.indexOf(status.toLowerCase()) !== -1;

    var base = {
      module: 'employees',
      entity_id: employeeId,
      entity_label: normalizeString(row.name),
      edit_route: 'employee/' + employeeId + '/edit'
    };

    // --- Contradictions ----------------------------------------------------

    // The two flags are independent columns and neither rewrites the other, so
    // both can be ticked. Compliance resolves it (na wins), but the record is
    // still saying two things at once and one of them is wrong.
    var applicable = normalizeString(row.team).toLowerCase() === 'safety'
      ? APPLICABLE_CERTS_SAFETY
      : APPLICABLE_CERTS_FIELD;

    for (var c = 0; c < applicable.length; c++) {
      var certKey = applicable[c];
      if (normalizeBoolean(row['cert_' + certKey + '_na']) &&
          normalizeBoolean(row['cert_' + certKey + '_suspended'])) {
        out.push(dqFinding_(dqExtend_(base, {
          severity: 'contradiction',
          check: 'cert_na_and_suspended',
          field: 'cert_' + certKey + '_na',
          text_params: { cert: certKey }
        })));
      }
    }

    // The two archive drifts. Section 2 is explicit that `archived` and
    // `employment_status` answer different questions and neither derives from
    // the other — which is exactly how they came to disagree. Neither of these
    // is visible from a list page: the team pages do not show `archived`, and
    // the resigned page renders the certificate roll-up rather than the status.
    if (archived && status !== '' && !isTerminal) {
      out.push(dqFinding_(dqExtend_(base, {
        severity: 'contradiction',
        check: 'archived_status_drift',
        field: 'employment_status',
        text_params: { status: status }
      })));
    }

    if (!archived && isTerminal) {
      out.push(dqFinding_(dqExtend_(base, {
        severity: 'contradiction',
        check: 'status_archive_drift',
        field: 'archived',
        text_params: { status: status }
      })));
    }

    var nationalId = normalizeString(row.national_id);
    if (nationalId !== '' && !DQ_NATIONAL_ID_PATTERN.test(nationalId)) {
      out.push(dqFinding_(dqExtend_(base, {
        severity: 'contradiction',
        check: 'national_id_malformed',
        field: 'national_id',
        text_params: { length: String(nationalId.length) }
      })));
    }

    var hired = normalizeIsoDate(row.hired_date);
    if (hired !== '' && hired < DQ_MIN_PLAUSIBLE_HIRE_DATE) {
      out.push(dqFinding_(dqExtend_(base, {
        severity: 'contradiction',
        check: 'hire_date_implausible',
        field: 'hired_date',
        text_params: { date: hired }
      })));
    }

    // Somebody recorded this person as trained to climb while no medical is on
    // the books. PRACTICAL ONLY — the theoretical is classroom training and
    // needs no medical (Section 6.1), so a theoretical with no MCU is not a
    // contradiction and must not be raised as one.
    var practical = normalizeIsoDate(row.cert_wah_practical_expiry);
    var practicalLive = practical !== '' &&
      !normalizeBoolean(row.cert_wah_practical_na) &&
      practical >= today;
    var mcuAbsent = normalizeIsoDate(row.cert_mcu_expiry) === '' &&
      !normalizeBoolean(row.cert_mcu_na);

    if (!archived && practicalLive && mcuAbsent) {
      out.push(dqFinding_(dqExtend_(base, {
        severity: 'contradiction',
        check: 'wah_practical_without_mcu',
        field: 'cert_mcu_expiry',
        text_params: { expiry: practical }
      })));
    }

    // --- Gaps (live records only) ------------------------------------------
    if (archived) continue;

    for (var g = 0; g < applicable.length; g++) {
      var gapKey = applicable[g];
      if (normalizeIsoDate(row['cert_' + gapKey + '_expiry']) !== '') continue;
      if (normalizeBoolean(row['cert_' + gapKey + '_na'])) continue;
      if (normalizeBoolean(row['cert_' + gapKey + '_suspended'])) continue;

      out.push(dqFinding_(dqExtend_(base, {
        severity: 'gap',
        check: 'cert_blank_not_na',
        field: 'cert_' + gapKey + '_expiry',
        text_params: { cert: gapKey }
      })));
    }

    // A missing hire date is not only untidy: rdtEligibleIgnoringMcu_ fails it
    // closed, so the employee drops out of the drug-testing pool without ever
    // appearing in the RDT page's excluded count. Silently outside the
    // programme is worse than visibly excluded from it.
    if (normalizeString(row.hired_date) === '') {
      out.push(dqFinding_(dqExtend_(base, {
        severity: 'gap',
        check: 'hire_date_missing',
        field: 'hired_date',
        text_params: {}
      })));
    }

    if (normalizeString(row.legal_permission) === '') {
      out.push(dqFinding_(dqExtend_(base, {
        severity: 'gap',
        check: 'legal_permission_missing',
        field: 'legal_permission',
        text_params: {}
      })));
    }
  }

  return out;
}

/**
 * @private
 * The counts a human reads to spot what the checks are forbidden to assert,
 * AND the records behind them.
 *
 * Section 3.10 rules out raising "this N/A flag looks wrong" as a finding,
 * because it is not mechanically decidable. But the *shape* of the data is
 * worth showing: twenty-two medicals marked N/A, six of them on Site Engineers,
 * is a pattern somebody who knows the roster can read in a second and the
 * platform cannot read at all.
 *
 * THE RECORDS SHIP WITH THE COUNTS, AND MUST
 * ------------------------------------------
 * A count on its own is a dead end. "7 Site Engineers have their medical marked
 * N/A" is only useful to somebody who can then look at those seven and say
 * which are wrong — and if the page cannot show them, it has asked a question
 * it gives nobody the means to answer. So each title carries its employees, and
 * the page makes them navigable to the form that fixes them.
 *
 * This does not soften the rule it sits beside. The platform still asserts
 * nothing about whether any of these flags is correct; it just stops hiding who
 * they belong to.
 */
function dqEmployeePatterns_(rows) {
  var naByCert = {};
  var mcuNaByTitle = {};
  var mcuNaEmployees = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (normalizeString(row.employee_id) === '') continue;
    if (normalizeBoolean(row.archived)) continue;

    var applicable = normalizeString(row.team).toLowerCase() === 'safety'
      ? APPLICABLE_CERTS_SAFETY
      : APPLICABLE_CERTS_FIELD;

    for (var c = 0; c < applicable.length; c++) {
      var key = applicable[c];
      if (!normalizeBoolean(row['cert_' + key + '_na'])) continue;
      naByCert[key] = (naByCert[key] || 0) + 1;

      if (key === 'mcu') {
        var employeeId = normalizeString(row.employee_id);
        mcuNaEmployees.push({
          employee_id: employeeId,
          name: normalizeString(row.name),
          title: normalizeString(row.title) || '(no title)',
          team: normalizeString(row.team).toLowerCase(),
          subcontractor: normalizeString(row.subcontractor),
          edit_route: 'employee/' + employeeId + '/edit'
        });

        var title = normalizeString(row.title) || '(no title)';
        mcuNaByTitle[title] = (mcuNaByTitle[title] || 0) + 1;
      }
    }
  }

  // Sorted by title then name, so the page can group without re-sorting and the
  // order is stable between calls.
  mcuNaEmployees.sort(function (a, b) {
    if (a.title !== b.title) return a.title < b.title ? -1 : 1;
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
  });

  return {
    na_by_cert: naByCert,
    mcu_na_by_title: mcuNaByTitle,
    mcu_na_employees: mcuNaEmployees
  };
}

// ---------------------------------------------------------------------------
// Equipment checks
// ---------------------------------------------------------------------------

/**
 * Every finding across the Equipment tab and its wave log.
 *
 * Rejected items are skipped entirely. A rejected item is out of service, and
 * chasing its missing paperwork is work nobody should be asked to do.
 *
 * @param {string} today
 * @return {Array<Object>}
 */
function dqEquipmentFindings_(today) {
  var rows = readAllRows(SHEET_NAMES.EQUIPMENT);
  var out = [];
  var labels = {};

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var equipmentId = normalizeString(row.equipment_id);
    if (equipmentId === '') continue;

    var label = normalizeString(row.item);
    var serial = normalizeString(row.serial_no);
    if (serial !== '') label = label + ' · ' + serial;
    labels[equipmentId] = label;

    if (normalizeBoolean(row.rejected)) continue;

    var base = {
      module: 'equipment',
      entity_id: equipmentId,
      entity_label: label,
      edit_route: 'equipment/' + equipmentId + '/edit'
    };

    // The column was added after the tab was in use and nothing was backfilled
    // — guessing that every existing item is in-house would be inventing
    // ownership (Section 2). So a blank is real, and it is the reason "whose
    // expired harness is this" cannot be answered for these items.
    if (normalizeString(row.subcontractor) === '') {
      out.push(dqFinding_(dqExtend_(base, {
        severity: 'gap',
        check: 'equipment_no_subcontractor',
        field: 'subcontractor',
        text_params: {}
      })));
    }

    if (normalizeIsoDate(row.third_party_inspection_end_date) === '') {
      out.push(dqFinding_(dqExtend_(base, {
        severity: 'gap',
        check: 'equipment_no_third_party',
        field: 'third_party_inspection_end_date',
        text_params: {}
      })));
    }
  }

  out = out.concat(dqStaleWaveFindings_(today, labels));
  return out;
}

/**
 * @private
 * Officer waves that have sat unreviewed too long.
 *
 * This one is a genuine safety matter rather than bookkeeping. A pending *pass*
 * counts for nothing until an admin approves it (Section 6.3), so an officer
 * who inspected a harness three weeks ago and cleared it has had no effect on
 * the item at all — and unlike a pending fail, nothing about that is visible
 * unless somebody opens the review queue.
 *
 * @param {string} today
 * @param {Object<string, string>} labels  equipment_id → display label. The
 *     wave map holds raw wave rows with no item joined onto them, so the label
 *     is threaded in from the Equipment read the caller has already done.
 * @return {Array<Object>}
 */
function dqStaleWaveFindings_(today, labels) {
  var byEquipment = wavesByEquipmentId_();
  var out = [];
  if (!byEquipment) return out;

  for (var equipmentId in byEquipment) {
    if (!Object.prototype.hasOwnProperty.call(byEquipment, equipmentId)) continue;

    var waves = byEquipment[equipmentId] || [];
    for (var i = 0; i < waves.length; i++) {
      var wave = waves[i];
      if (waveApprovalOf_(wave) !== 'pending') continue;

      var waveDate = normalizeIsoDate(wave.wave_date);
      if (waveDate === '') continue;

      var age = daysBetweenIso_(waveDate, today);
      if (age === null || age <= DQ_WAVE_PENDING_MAX_DAYS) continue;

      out.push(dqFinding_({
        module: 'equipment',
        entity_id: equipmentId,
        entity_label: (labels && labels[equipmentId]) || equipmentId,
        severity: 'gap',
        check: 'wave_pending_stale',
        field: 'approval_status',
        text_params: { days: String(age), date: waveDate },

        // Straight to the review queue for this item, not to the edit form —
        // the fix is a decision on the wave, not a change to the equipment.
        edit_route: 'equipment/waves/' + equipmentId
      }));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** @private Shallow merge, so each finding can extend the per-record base. */
function dqExtend_(base, extra) {
  var out = {};
  for (var k in base) {
    if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
  }
  for (var e in extra) {
    if (Object.prototype.hasOwnProperty.call(extra, e)) out[e] = extra[e];
  }
  return out;
}
