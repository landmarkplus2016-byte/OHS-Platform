/**
 * Rdt.gs — random drug testing: the selection algorithm and its six actions
 * (CLAUDE.md Section 3.5).
 *
 * WHAT THIS IMPLEMENTS
 * --------------------
 * Landmark's policy is 120% coverage per fiscal year:
 *
 *   Apr–Jan (10 months)   10% of the eligible pool each month, drawn only from
 *                         employees not yet tested this year → 100% coverage
 *   Feb–Mar (2 months)    10% each month, drawn only from employees who HAVE
 *                         been tested this year → the extra 20%
 *
 * The eligible pool is recomputed at the moment of every selection, never frozen
 * at the start of the year. Someone who crosses their new-hire grace in August
 * joins the pool in August; someone archived in September leaves it in September.
 *
 * WHY THE POOL EXCLUDES EXPIRED MCUs
 * ----------------------------------
 * An expired medical check-up means the employee is about to retake the full
 * MCU, which itself includes a drug test. Booking them a standalone RDT in that
 * window is duplicated work. They re-enter the pool the moment a renewed MCU
 * expiry lands. This is a hard exclusion, not a warning.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * RDT never touches a site-check verdict. An employee overdue for testing is
 * still `cleared` for site work if their certificates hold. RDT is HR compliance
 * paperwork; Compliance.gs does not import anything from this file and must not.
 *
 * Officers never see any of it — Officer.gs returns no RdtLog rows and no RDT
 * settings under any circumstance.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The three states a log row moves between. */
var RDT_STATUSES = ['selected', 'completed', 'missed'];

/** The only two results a completed test can carry. */
var RDT_RESULTS = ['pass', 'fail'];

/** ModuleSettings keys under the `employees` module that configure RDT. */
var RDT_SETTING_KEYS = {
  ENABLED: 'rdt_enabled',
  FY_START_MONTH: 'rdt_fiscal_year_start_month',
  MONTHLY_PCT: 'rdt_monthly_target_pct',
  YEARLY_PCT: 'rdt_yearly_target_pct',
  HIRE_GRACE: 'rdt_hire_grace_months',
  REPEAT_MONTHS: 'rdt_repeat_months',
  SAFETY_TITLE: 'rdt_safety_title'
};

/**
 * What `enable RDT` seeds, and what a missing or unreadable setting falls back
 * to. Section 2 lists these same values as the tab's defaults.
 */
var RDT_DEFAULTS = {
  fiscal_year_start_month: 4,
  monthly_target_pct: 10,
  yearly_target_pct: 120,
  hire_grace_months: 3,
  repeat_months: [2, 3],
  safety_title: 'Safety Officer'
};

/** Entries on the dashboard's "recent activity" strip. */
var RDT_RECENT_LIMIT = 15;

/** Paging for list_rdt_history. */
var RDT_HISTORY_PAGE_SIZE_DEFAULT = 100;
var RDT_HISTORY_PAGE_SIZE_MAX = 500;

/** Notes are an admin's shorthand, not a report. */
var RDT_NOTES_MAX = 500;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * The RDT configuration, coerced from the ModuleSettings strings into the types
 * the algorithm actually wants.
 *
 * Every field falls back to its default rather than failing: a hand-edited '12'
 * in rdt_monthly_target_pct should change the quota, but a hand-edited 'ten'
 * should not stop the page from loading. `enabled` is the exception — it is the
 * master switch, so it is strictly TRUE or off.
 *
 * @param {Object} moduleSettings  From getModuleSettingsMap().
 * @return {Object}
 */
function rdtSettings_(moduleSettings) {
  function read(key) {
    return normalizeString(readModuleSetting_(moduleSettings, 'employees', key));
  }

  function intIn(key, fallback, min, max) {
    var num = Number(read(key));
    if (!isFinite(num)) return fallback;
    num = Math.round(num);
    return (num < min || num > max) ? fallback : num;
  }

  // '2,3' → [2, 3]. Anything unparseable in the list is dropped; an empty
  // result means no repeat phase at all, which is a legitimate configuration
  // (a 100% programme rather than a 120% one).
  var repeatRaw = read(RDT_SETTING_KEYS.REPEAT_MONTHS);
  var repeatMonths;
  if (repeatRaw === '') {
    repeatMonths = RDT_DEFAULTS.repeat_months.slice();
  } else {
    repeatMonths = [];
    var parts = repeatRaw.split(',');
    for (var i = 0; i < parts.length; i++) {
      var month = Math.round(Number(normalizeString(parts[i])));
      if (isFinite(month) && month >= 1 && month <= 12 && repeatMonths.indexOf(month) === -1) {
        repeatMonths.push(month);
      }
    }
  }

  var safetyTitle = read(RDT_SETTING_KEYS.SAFETY_TITLE);

  return {
    enabled: normalizeBoolean(read(RDT_SETTING_KEYS.ENABLED)),
    fiscal_year_start_month: intIn(RDT_SETTING_KEYS.FY_START_MONTH, RDT_DEFAULTS.fiscal_year_start_month, 1, 12),
    monthly_target_pct: intIn(RDT_SETTING_KEYS.MONTHLY_PCT, RDT_DEFAULTS.monthly_target_pct, 0, 100),
    yearly_target_pct: intIn(RDT_SETTING_KEYS.YEARLY_PCT, RDT_DEFAULTS.yearly_target_pct, 0, 1000),
    hire_grace_months: intIn(RDT_SETTING_KEYS.HIRE_GRACE, RDT_DEFAULTS.hire_grace_months, 0, 60),
    repeat_months: repeatMonths,
    safety_title: safetyTitle === '' ? RDT_DEFAULTS.safety_title : safetyTitle
  };
}

// ---------------------------------------------------------------------------
// Fiscal year
// ---------------------------------------------------------------------------

/**
 * The fiscal year an ISO date falls inside.
 *
 * With a start month of 4, everything from 2026-04-01 to 2027-03-31 is
 * "2026-2027". The label is stamped onto a log row once at selection and never
 * recomputed, so a test selected in March and completed in April still counts
 * against the year it was selected in.
 *
 * @param {string} iso        'YYYY-MM-DD'
 * @param {number} startMonth 1–12
 * @return {{label: string, start_year: number, end_year: number,
 *           start_date: string, end_date: string}}
 */
function rdtFiscalYear_(iso, startMonth) {
  var year = Number(iso.slice(0, 4));
  var month = Number(iso.slice(5, 7));

  var startYear = month >= startMonth ? year : year - 1;
  var endYear = startYear + 1;

  // The last day of the year is the day before the next one begins.
  var nextStart = new Date(Date.UTC(endYear, startMonth - 1, 1));
  nextStart.setUTCDate(nextStart.getUTCDate() - 1);

  return {
    label: startYear + '-' + endYear,
    start_year: startYear,
    end_year: endYear,
    start_date: startYear + '-' + padNumber_(startMonth, 2) + '-01',
    end_date: nextStart.toISOString().slice(0, 10)
  };
}

/** True when this month draws repeat tests rather than first-time ones. */
function rdtIsRepeatMonth_(iso, settings) {
  return settings.repeat_months.indexOf(Number(iso.slice(5, 7))) !== -1;
}

/**
 * @private
 * The date `months` calendar months before `iso` — the new-hire grace cutoff.
 *
 * Calendar months rather than the 30.44-day approximation OHS-DB used: "hired
 * three months ago" is a claim about the calendar, and on the boundary day the
 * two disagree in a way nobody can explain to an admin. Day-of-month overflow
 * clamps the way Date does (31 May minus 3 months is 28 or 29 February), which
 * is the direction that keeps someone in their grace period rather than
 * selecting them a day early.
 */
function rdtGraceCutoff_(iso, months) {
  var d = new Date(Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1 - months,
    Number(iso.slice(8, 10))
  ));
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Eligibility (CLAUDE.md Section 3.5, "RDT eligibility")
// ---------------------------------------------------------------------------

/**
 * Everyone in scope except for the MCU rule.
 *
 * Split out from rdtEligible_ so the dashboard can report how many otherwise
 * eligible people the MCU exclusion dropped. Keeping the shared filter in one
 * place is what stops the two counts from drifting apart.
 *
 * @param {Array<Object>} rows      Every Employees row.
 * @param {string} iso              Today.
 * @param {Object} settings         From rdtSettings_().
 * @return {Array<Object>}
 */
function rdtEligibleIgnoringMcu_(rows, iso, settings) {
  var cutoff = rdtGraceCutoff_(iso, settings.hire_grace_months);
  var safetyTitle = settings.safety_title.toLowerCase();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (normalizeString(row.employee_id) === '') continue;
    if (normalizeBoolean(row.archived)) continue;
    if (normalizeString(row.employment_status).toLowerCase() !== 'active') continue;

    // Field team is in scope at every title. Safety team only at the one title
    // that does site work — managers, coordinators and directors are out.
    if (normalizeString(row.team).toLowerCase() === 'safety'
      && normalizeString(row.title).toLowerCase() !== safetyTitle) continue;

    // No hire date is a data gap, and a data gap cannot prove the grace period
    // has passed. Fail closed.
    var hired = normalizeIsoDate(row.hired_date);
    if (hired === '' || hired > cutoff) continue;

    out.push(row);
  }
  return out;
}

/**
 * True when the employee holds a valid MCU today.
 *
 * The boundary is `>= today`: an MCU expiring today is still valid, mirroring
 * how deriveCertState treats the same edge (Section 6.1).
 */
function rdtHasValidMcu_(row, iso) {
  var expiry = normalizeIsoDate(row.cert_mcu_expiry);
  return expiry !== '' && expiry >= iso;
}

/** The full eligible pool: in scope AND holding a valid MCU. */
function rdtEligible_(rows, iso, settings) {
  var base = rdtEligibleIgnoringMcu_(rows, iso, settings);
  var out = [];
  for (var i = 0; i < base.length; i++) {
    if (rdtHasValidMcu_(base[i], iso)) out.push(base[i]);
  }
  return out;
}

/** Round-to-nearest, per the policy: 137 × 10% = 13.7 → 14. */
function rdtMonthlyQuota_(poolSize, pct) {
  return Math.round((pct / 100) * poolSize);
}

/**
 * @private
 * Fisher–Yates on a copy. The only ordering ever applied to the candidate pool
 * before it is sliced to quota — no sort, no seed, no reproducibility. That is
 * the whole point of a random testing programme.
 */
function rdtShuffle_(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

// ---------------------------------------------------------------------------
// Log reads
// ---------------------------------------------------------------------------

/**
 * @private
 * Every RdtLog row, normalized. Read once per request by the handler that needs
 * it and passed down — the tab is small (a few hundred rows a year) but a
 * re-read per employee would not be.
 */
function rdtAllEntries_() {
  var rows = readAllRows(SHEET_NAMES.RDT_LOG);
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var logId = normalizeString(rows[i].log_id);
    if (logId === '') continue;

    out.push({
      log_id: logId,
      employee_id: normalizeString(rows[i].employee_id),
      fiscal_year: normalizeString(rows[i].fiscal_year),
      selected_at: normalizeIsoDate(rows[i].selected_at),
      selected_by: normalizeString(rows[i].selected_by),
      test_date: normalizeIsoDate(rows[i].test_date),
      status: normalizeString(rows[i].status).toLowerCase(),
      result: normalizeString(rows[i].result).toLowerCase(),
      notes: normalizeString(rows[i].notes),
      updated_at: normalizeIsoDateTime(rows[i].updated_at),
      updated_by: normalizeString(rows[i].updated_by)
    });
  }
  return out;
}

/** @private {employee_id → [entry]} */
function rdtGroupByEmployee_(entries) {
  var map = {};
  for (var i = 0; i < entries.length; i++) {
    var id = entries[i].employee_id;
    if (!map[id]) map[id] = [];
    map[id].push(entries[i]);
  }
  return map;
}

/** @private Has this employee a completed test in the given fiscal year? */
function rdtTestedThisYear_(entries, fyLabel) {
  if (!entries) return false;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].fiscal_year === fyLabel && entries[i].status === 'completed') return true;
  }
  return false;
}

/**
 * @private
 * Has this employee already been selected or completed in the given calendar
 * month? A `missed` entry does NOT count — being missed re-opens someone for a
 * later draw, including a re-draw in the same month.
 */
function rdtBusyThisMonth_(entries, monthIso) {
  if (!entries) return false;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].status === 'missed') continue;
    var when = entries[i].selected_at || entries[i].test_date;
    if (when && when.slice(0, 7) === monthIso) return true;
  }
  return false;
}

/**
 * @private
 * A log entry with the employee's identity joined on, so no page has to make a
 * second call to render a table row.
 */
function rdtShapeEntry_(entry, employeeRow) {
  var out = {
    log_id: entry.log_id,
    employee_id: entry.employee_id,
    fiscal_year: entry.fiscal_year,
    selected_at: entry.selected_at,
    selected_by: entry.selected_by,
    test_date: entry.test_date,
    status: entry.status,
    result: entry.result,
    notes: entry.notes,
    updated_at: entry.updated_at,
    updated_by: entry.updated_by,
    name: '',
    team: '',
    title: '',
    subcontractor: ''
  };

  if (employeeRow) {
    out.name = normalizeString(employeeRow.name);
    out.team = normalizeString(employeeRow.team).toLowerCase();
    out.title = normalizeString(employeeRow.title);
    out.subcontractor = normalizeString(employeeRow.subcontractor);
  }
  return out;
}

/** @private Newest selection first; ties broken by log_id so the order is stable. */
function rdtCompareEntries_(a, b) {
  if (a.selected_at !== b.selected_at) return a.selected_at > b.selected_at ? -1 : 1;
  if (a.log_id === b.log_id) return 0;
  return a.log_id > b.log_id ? -1 : 1;
}

/**
 * @private
 * The next free RDT log number, from the highest existing `RDT-######`.
 *
 * Same reasoning as nextHistoryNumber_ in Employees.gs: Section 2 gives Config
 * counters to entity IDs only, and log rows are only ever appended under the
 * script lock that writes them.
 */
function rdtNextNumber_(entries) {
  var max = 0;
  for (var i = 0; i < entries.length; i++) {
    var match = entries[i].log_id.match(/(\d+)\s*$/);
    if (!match) continue;
    var num = Number(match[1]);
    if (isFinite(num) && num > max) max = num;
  }
  return max + 1;
}

/** @private {employee_id → row} across an already-read Employees set. */
function rdtEmployeeIndex_(rows) {
  var index = {};
  for (var i = 0; i < rows.length; i++) {
    var id = normalizeString(rows[i].employee_id);
    if (id !== '') index[id] = rows[i];
  }
  return index;
}

/**
 * @private
 * Coverage against the yearly target, over the *current* eligible pool.
 *
 * The denominator moving as the pool moves is deliberate: the target is
 * `round(120% × pool)`, and both halves should describe who is actually
 * testable today. Someone tested in May who has since entered an MCU-renewal
 * window leaves both the numerator and the denominator together.
 */
function rdtProgress_(pool, byEmployee, fyLabel, settings) {
  var target = rdtMonthlyQuota_(pool.length, settings.yearly_target_pct);
  var completed = 0;
  var unique = 0;

  for (var i = 0; i < pool.length; i++) {
    var entries = byEmployee[normalizeString(pool[i].employee_id)] || [];
    var any = false;

    for (var e = 0; e < entries.length; e++) {
      if (entries[e].fiscal_year !== fyLabel || entries[e].status !== 'completed') continue;
      completed++;
      any = true;
    }
    if (any) unique++;
  }

  return {
    fiscal_year: fyLabel,
    pool_size: pool.length,
    yearly_target: target,
    completed_count: completed,
    unique_tested_count: unique,
    coverage_pct: pool.length === 0 ? 0 : Math.round((unique / pool.length) * 1000) / 10,
    target_pct: target === 0 ? 0 : Math.round((completed / target) * 1000) / 10
  };
}

// ---------------------------------------------------------------------------
// Action handlers — reads
// ---------------------------------------------------------------------------

/**
 * `list_rdt_overview` — everything the RDT dashboard draws, in one call.
 *
 * The page needs the pool, the quota, this month's selection, yearly progress
 * and recent activity to render a single screen. Four actions would mean four
 * reads of the same two tabs; this is one of each.
 *
 * @param {Object} session
 * @param {Object} payload  None.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListRdtOverview(session, payload) {
  var denied = requireModuleView(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, []);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var settings = rdtSettings_(getModuleSettingsMap());
  if (!settings.enabled) return okResponse({ enabled: false });

  var today = todayIso();
  var monthIso = today.slice(0, 7);
  var fy = rdtFiscalYear_(today, settings.fiscal_year_start_month);

  var employeeRows = readAllRows(SHEET_NAMES.EMPLOYEES);
  var byId = rdtEmployeeIndex_(employeeRows);

  var inScope = rdtEligibleIgnoringMcu_(employeeRows, today, settings);
  var pool = [];
  for (var i = 0; i < inScope.length; i++) {
    if (rdtHasValidMcu_(inScope[i], today)) pool.push(inScope[i]);
  }

  var entries = rdtAllEntries_();
  var byEmployee = rdtGroupByEmployee_(entries);

  var thisMonth = [];
  var recent = [];
  for (var e = 0; e < entries.length; e++) {
    if (entries[e].selected_at.slice(0, 7) === monthIso) thisMonth.push(entries[e]);
    if (entries[e].fiscal_year === fy.label) recent.push(entries[e]);
  }
  thisMonth.sort(rdtCompareEntries_);
  recent.sort(rdtCompareEntries_);

  function shape(list) {
    var out = [];
    for (var k = 0; k < list.length; k++) {
      out.push(rdtShapeEntry_(list[k], byId[list[k].employee_id]));
    }
    return out;
  }

  return okResponse({
    enabled: true,
    settings: settings,
    fiscal_year: fy,
    month: {
      iso: monthIso,
      is_repeat_phase: rdtIsRepeatMonth_(today, settings),
      quota: rdtMonthlyQuota_(pool.length, settings.monthly_target_pct)
    },
    pool: {
      size: pool.length,
      mcu_excluded: inScope.length - pool.length
    },
    progress: rdtProgress_(pool, byEmployee, fy.label, settings),
    this_month: shape(thisMonth),
    recent: shape(recent.slice(0, RDT_RECENT_LIMIT)),
    today: today
  });
}

/**
 * `list_rdt_history` — the fiscal-year log, filtered and paged.
 *
 * Filtering happens here rather than on the client because the log outgrows a
 * single page within a couple of months and rule "never render an unpaginated
 * list" applies to it like everything else.
 *
 * @param {Object} session
 * @param {Object} payload  {fiscal_year?, month?, team?, status?, result?, page?, page_size?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListRdtHistory(session, payload) {
  var denied = requireModuleView(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, [
    'fiscal_year', 'month', 'team', 'status', 'result', 'page', 'page_size'
  ]);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var settings = rdtSettings_(getModuleSettingsMap());
  if (!settings.enabled) return okResponse({ enabled: false, entries: [], total_matching: 0 });

  var fieldErrors = {};

  var month = normalizeString(payload && payload.month);
  if (month !== '' && !/^\d{4}-\d{2}$/.test(month)) fieldErrors.month = 'invalid_format';

  var team = normalizeString(payload && payload.team).toLowerCase();
  if (team !== '' && EMPLOYEE_TEAMS.indexOf(team) === -1) fieldErrors.team = 'invalid_value';

  var status = normalizeString(payload && payload.status).toLowerCase();
  if (status !== '' && RDT_STATUSES.indexOf(status) === -1) fieldErrors.status = 'invalid_value';

  var result = normalizeString(payload && payload.result).toLowerCase();
  if (result !== '' && RDT_RESULTS.indexOf(result) === -1) fieldErrors.result = 'invalid_value';

  var page = readPositiveInt_(payload && payload.page, 1);
  if (page === null) fieldErrors.page = 'invalid_number';

  var pageSize = readPositiveInt_(payload && payload.page_size, RDT_HISTORY_PAGE_SIZE_DEFAULT);
  if (pageSize === null) fieldErrors.page_size = 'invalid_number';

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  pageSize = Math.min(pageSize, RDT_HISTORY_PAGE_SIZE_MAX);

  var today = todayIso();
  var fyLabel = normalizeString(payload && payload.fiscal_year)
    || rdtFiscalYear_(today, settings.fiscal_year_start_month).label;

  var byId = rdtEmployeeIndex_(readAllRows(SHEET_NAMES.EMPLOYEES));
  var entries = rdtAllEntries_();
  var matched = [];

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (entry.fiscal_year !== fyLabel) continue;
    if (month !== '' && entry.selected_at.slice(0, 7) !== month) continue;
    if (status !== '' && entry.status !== status) continue;
    if (result !== '' && entry.result !== result) continue;

    var employeeRow = byId[entry.employee_id];
    if (team !== '' && (!employeeRow || normalizeString(employeeRow.team).toLowerCase() !== team)) continue;

    matched.push(rdtShapeEntry_(entry, employeeRow));
  }

  matched.sort(rdtCompareEntries_);

  var start = (page - 1) * pageSize;
  return okResponse({
    enabled: true,
    fiscal_year: fyLabel,
    entries: matched.slice(start, start + pageSize),
    total_matching: matched.length,
    page: page,
    page_size: pageSize
  });
}

// ---------------------------------------------------------------------------
// Action handlers — writes
// ---------------------------------------------------------------------------

/**
 * `generate_rdt_selection` — draw this month's list and write it.
 *
 * The whole draw happens inside the script lock: the candidate filter reads
 * which employees are already selected this month, and two admins pressing
 * Generate within the same second would otherwise each see a clean month and
 * both write a full quota.
 *
 * @param {Object} session
 * @param {Object} payload  {regenerate?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleGenerateRdtSelection(session, payload) {
  var denied = requireModuleEdit(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['regenerate']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var settings = rdtSettings_(getModuleSettingsMap());
  if (!settings.enabled) {
    return errResponse('validation_failed', 'rdt_disabled', { rdt: 'disabled' });
  }

  var regenerate = normalizeBoolean(payload && payload.regenerate);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('generate_rdt_selection: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var today = todayIso();
    var monthIso = today.slice(0, 7);
    var fy = rdtFiscalYear_(today, settings.fiscal_year_start_month);

    // Read the log before anything is deleted, and take the next free number
    // from that. Numbering off the post-delete tab would hand a discarded pick's
    // log_id to a new one, and Section 2 says IDs are never reused.
    var nextNumber = rdtNextNumber_(rdtAllEntries_());

    // Regenerating discards this month's *unfinished* picks only. A completed
    // test is a fact and a missed one is a record of an attempt; neither is
    // something a re-draw gets to erase.
    if (regenerate) {
      var pairs = readAllRowsWithIndex(SHEET_NAMES.RDT_LOG);
      var sheet = getSheet(SHEET_NAMES.RDT_LOG);

      for (var p = pairs.length - 1; p >= 0; p--) {
        var data = pairs[p].data;
        if (normalizeString(data.status).toLowerCase() !== 'selected') continue;
        if (normalizeIsoDate(data.selected_at).slice(0, 7) !== monthIso) continue;
        sheet.deleteRow(pairs[p].row);
      }
    }

    var employeeRows = readAllRows(SHEET_NAMES.EMPLOYEES);
    var byId = rdtEmployeeIndex_(employeeRows);
    var pool = rdtEligible_(employeeRows, today, settings);
    var quota = rdtMonthlyQuota_(pool.length, settings.monthly_target_pct);

    // Re-read after the deletions: whoever was just discarded is available to
    // be drawn again, and rdtBusyThisMonth_ has to see that.
    var byEmployee = rdtGroupByEmployee_(rdtAllEntries_());
    var isRepeat = rdtIsRepeatMonth_(today, settings);

    var candidates = [];
    for (var i = 0; i < pool.length; i++) {
      var employeeId = normalizeString(pool[i].employee_id);
      var mine = byEmployee[employeeId];

      if (rdtBusyThisMonth_(mine, monthIso)) continue;

      // Feb/Mar top up coverage with repeats, so they draw only from people who
      // already have a first-round test. Apr–Jan do the first round, so they
      // draw only from people who do not.
      var tested = rdtTestedThisYear_(mine, fy.label);
      if (isRepeat !== tested) continue;

      candidates.push(pool[i]);
    }

    var picked = rdtShuffle_(candidates).slice(0, Math.min(quota, candidates.length));

    var stampedAt = nowIso();
    var newRows = [];

    for (var k = 0; k < picked.length; k++) {
      newRows.push({
        log_id: 'RDT-' + padNumber_(nextNumber + k, 6),
        employee_id: normalizeString(picked[k].employee_id),
        fiscal_year: fy.label,
        selected_at: today,
        selected_by: session.user.user_id,
        test_date: '',
        status: 'selected',
        result: '',
        notes: '',
        updated_at: stampedAt,
        updated_by: session.user.user_id
      });
    }

    appendRows(SHEET_NAMES.RDT_LOG, newRows);

    var created = [];
    for (var n = 0; n < newRows.length; n++) {
      created.push(rdtShapeEntry_(newRows[n], byId[newRows[n].employee_id]));
    }

    return okResponse({
      created: created,
      quota: quota,
      pool_size: pool.length,
      candidates: candidates.length,
      is_repeat_phase: isRepeat
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * `update_rdt_entry` — every state change one log row can undergo.
 *
 * Mark completed, mark missed, revert to selected, and correct a completed
 * entry are one handler rather than four actions because they are one write
 * with four validation shapes. Splitting them would mean four handlers that
 * each read the tab, find the row, and stamp the same two audit columns.
 *
 * @param {Object} session
 * @param {Object} payload  {log_id, status?, test_date?, result?, notes?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleUpdateRdtEntry(session, payload) {
  var denied = requireModuleEdit(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['log_id', 'status', 'test_date', 'result', 'notes']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var logId = normalizeString(payload && payload.log_id);
  if (logId === '') {
    return errResponse('validation_failed', 'invalid_payload', { log_id: 'required' });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('update_rdt_entry: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var found = null;
    var pairs = readAllRowsWithIndex(SHEET_NAMES.RDT_LOG);
    for (var i = 0; i < pairs.length; i++) {
      if (normalizeString(pairs[i].data.log_id) === logId) { found = pairs[i]; break; }
    }
    if (!found) return errResponse('not_found', 'rdt_entry_not_found');

    var current = found.data;
    var fieldErrors = {};

    // Omitting `status` means "edit this row in place" — the state stays
    // whatever it already was.
    var status = has_(payload, 'status')
      ? normalizeString(payload.status).toLowerCase()
      : normalizeString(current.status).toLowerCase();
    if (RDT_STATUSES.indexOf(status) === -1) fieldErrors.status = 'invalid_value';

    var testDate = has_(payload, 'test_date')
      ? normalizeIsoDate(payload.test_date)
      : normalizeIsoDate(current.test_date);
    if (has_(payload, 'test_date')
      && normalizeString(payload.test_date) !== '' && testDate === '') {
      fieldErrors.test_date = 'invalid_format';
    }

    var result = has_(payload, 'result')
      ? normalizeString(payload.result).toLowerCase()
      : normalizeString(current.result).toLowerCase();

    var notes = has_(payload, 'notes')
      ? normalizeString(payload.notes)
      : normalizeString(current.notes);
    if (notes.length > RDT_NOTES_MAX) fieldErrors.notes = 'too_long';

    if (status === 'completed') {
      // A completed test without a date or an outcome is not a completed test.
      if (testDate === '') fieldErrors.test_date = fieldErrors.test_date || 'required';
      if (RDT_RESULTS.indexOf(result) === -1) fieldErrors.result = 'required';
    } else {
      // Missed and selected both mean "no test happened", so neither carries a
      // date or a result. Clearing them here rather than rejecting them lets the
      // caller send a whole row back without having to blank fields itself.
      testDate = '';
      result = '';
    }

    if (hasKeys_(fieldErrors)) {
      return errResponse('validation_failed', 'invalid_payload', fieldErrors);
    }

    var merged = updateRowAt(SHEET_NAMES.RDT_LOG, found.row, {
      test_date: testDate,
      status: status,
      result: result,
      notes: notes,
      updated_at: nowIso(),
      updated_by: session.user.user_id
    });
    if (!merged) return errResponse('not_found', 'rdt_entry_not_found');

    var employeeRow = readRowByKey(
      SHEET_NAMES.EMPLOYEES, 'employee_id', normalizeString(merged.employee_id)
    );

    return okResponse({ entry: rdtShapeEntry_(rdtNormalizeRow_(merged), employeeRow) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * `swap_rdt_selection` — replace one selected employee with a random draw.
 *
 * A swap is not a miss. Missed means "we tried and it did not happen" and keeps
 * a record; a swap means "we knew in advance they would not be there", so the
 * original row is deleted rather than kept as a failed attempt. The replacement
 * is drawn from the same pool under the same rules — including the MCU
 * exclusion, which is the one an ad-hoc manual swap would be most likely to
 * miss.
 *
 * @param {Object} session
 * @param {Object} payload  {log_id}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleSwapRdtSelection(session, payload) {
  var denied = requireModuleEdit(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['log_id']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var logId = normalizeString(payload && payload.log_id);
  if (logId === '') {
    return errResponse('validation_failed', 'invalid_payload', { log_id: 'required' });
  }

  var settings = rdtSettings_(getModuleSettingsMap());
  if (!settings.enabled) {
    return errResponse('validation_failed', 'rdt_disabled', { rdt: 'disabled' });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('swap_rdt_selection: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var pairs = readAllRowsWithIndex(SHEET_NAMES.RDT_LOG);
    var found = null;
    for (var i = 0; i < pairs.length; i++) {
      if (normalizeString(pairs[i].data.log_id) === logId) { found = pairs[i]; break; }
    }
    if (!found) return errResponse('not_found', 'rdt_entry_not_found');

    // Only an unfinished pick can be swapped. Swapping a completed test would
    // delete a real result.
    if (normalizeString(found.data.status).toLowerCase() !== 'selected') {
      return errResponse('conflict', 'rdt_entry_not_selected');
    }

    var today = todayIso();
    var monthIso = today.slice(0, 7);
    var fy = rdtFiscalYear_(today, settings.fiscal_year_start_month);
    var isRepeat = rdtIsRepeatMonth_(today, settings);

    var employeeRows = readAllRows(SHEET_NAMES.EMPLOYEES);
    var byId = rdtEmployeeIndex_(employeeRows);
    var pool = rdtEligible_(employeeRows, today, settings);

    var entries = rdtAllEntries_();
    var byEmployee = rdtGroupByEmployee_(entries);
    var outgoingId = normalizeString(found.data.employee_id);

    var candidates = [];
    for (var c = 0; c < pool.length; c++) {
      var employeeId = normalizeString(pool[c].employee_id);
      if (employeeId === outgoingId) continue;

      var mine = byEmployee[employeeId];
      if (rdtBusyThisMonth_(mine, monthIso)) continue;
      if (rdtTestedThisYear_(mine, fy.label) !== isRepeat) continue;

      candidates.push(pool[c]);
    }

    // Nothing is written when there is nobody to write. The original pick stays
    // exactly as it was, so the admin can mark it missed instead.
    if (candidates.length === 0) {
      return errResponse('conflict', 'no_replacement_available');
    }

    var replacement = rdtShuffle_(candidates)[0];
    var stampedAt = nowIso();

    var row = {
      log_id: 'RDT-' + padNumber_(rdtNextNumber_(entries), 6),
      employee_id: normalizeString(replacement.employee_id),
      fiscal_year: fy.label,
      selected_at: today,
      selected_by: session.user.user_id,
      test_date: '',
      status: 'selected',
      result: '',
      notes: '',
      updated_at: stampedAt,
      updated_by: session.user.user_id
    };

    getSheet(SHEET_NAMES.RDT_LOG).deleteRow(found.row);
    appendRow(SHEET_NAMES.RDT_LOG, row);

    return okResponse({
      removed_employee_id: outgoingId,
      removed_employee_name: byId[outgoingId] ? normalizeString(byId[outgoingId].name) : '',
      entry: rdtShapeEntry_(row, byId[row.employee_id])
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * `delete_rdt_entry` — remove one log row.
 *
 * The documented exception to rule 6 (see the RdtLog notes in Section 2): a log
 * row is a plan, not an entity record, and a selection generated in error is
 * noise rather than history. Idempotent — deleting a row that is already gone
 * succeeds, so a double-click cannot produce an error the admin has to read.
 *
 * @param {Object} session
 * @param {Object} payload  {log_id}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleDeleteRdtEntry(session, payload) {
  var denied = requireModuleEdit(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['log_id']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var logId = normalizeString(payload && payload.log_id);
  if (logId === '') {
    return errResponse('validation_failed', 'invalid_payload', { log_id: 'required' });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('delete_rdt_entry: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var removed = deleteRowByKey(SHEET_NAMES.RDT_LOG, 'log_id', logId);
    return okResponse({ deleted: removed });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Dashboard support
// ---------------------------------------------------------------------------

/**
 * The dashboard's RDT coverage block (Section 5.5).
 *
 * Called by list_employee_stats with the Employees rows it has already read, so
 * the dashboard costs one extra read of RdtLog and nothing else. Returns
 * `{tracking: false}` when RDT is switched off, which is the state Section 5.5
 * asks the card to render.
 *
 * @param {Array<Object>} employeeRows  Every Employees row, already read.
 * @param {{today: string, moduleSettings: Object}} ctx
 * @return {Object}
 */
function rdtCoverage_(employeeRows, ctx) {
  var settings = rdtSettings_(ctx.moduleSettings);
  if (!settings.enabled) return { tracking: false };

  var fy = rdtFiscalYear_(ctx.today, settings.fiscal_year_start_month);
  var pool = rdtEligible_(employeeRows, ctx.today, settings);
  var byEmployee = rdtGroupByEmployee_(rdtAllEntries_());
  var progress = rdtProgress_(pool, byEmployee, fy.label, settings);

  return {
    tracking: true,
    fiscal_year: fy.label,
    year_start: fy.start_date,
    target_pct: settings.yearly_target_pct,
    pool: progress.pool_size,
    tested_employees: progress.unique_tested_count,
    tests_recorded: progress.completed_count,
    coverage_pct: progress.coverage_pct
  };
}

/**
 * An employee's RDT log, newest first — the detail page's "RDT history" block.
 *
 * @param {string} employeeId
 * @return {Array<Object>}
 */
function rdtHistoryFor_(employeeId) {
  var entries = rdtAllEntries_();
  var out = [];

  for (var i = 0; i < entries.length; i++) {
    if (entries[i].employee_id === employeeId) out.push(entries[i]);
  }
  out.sort(rdtCompareEntries_);
  return out;
}

/**
 * @private
 * A raw sheet row (what updateRowAt hands back) in the shape rdtShapeEntry_
 * expects. The read path gets this from rdtAllEntries_; the write path needs it
 * for the one row it just merged.
 */
function rdtNormalizeRow_(row) {
  return {
    log_id: normalizeString(row.log_id),
    employee_id: normalizeString(row.employee_id),
    fiscal_year: normalizeString(row.fiscal_year),
    selected_at: normalizeIsoDate(row.selected_at),
    selected_by: normalizeString(row.selected_by),
    test_date: normalizeIsoDate(row.test_date),
    status: normalizeString(row.status).toLowerCase(),
    result: normalizeString(row.result).toLowerCase(),
    notes: normalizeString(row.notes),
    updated_at: normalizeIsoDateTime(row.updated_at),
    updated_by: normalizeString(row.updated_by)
  };
}
