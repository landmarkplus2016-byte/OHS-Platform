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

/**
 * Where a log row came from.
 *
 *   selection  the monthly random draw, or a swap within it
 *   manual     an admin recorded a test that happened outside the draw
 *   import     backfilled from a legacy record by bulk_import_rdt
 *
 * Nothing filters on this yet — every origin counts toward coverage alike. It
 * is recorded so the question it exists for ("does a for-cause test discharge
 * the random obligation?") can be answered later without a second migration,
 * and so a coverage figure can always be traced back to how it was earned.
 */
var RDT_ORIGINS = ['selection', 'manual', 'import'];

/**
 * What an unset origin reads as.
 *
 * Every row written before the origin column existed came from the monthly draw
 * — generate and swap were the only two writers — so a blank is not unknown
 * provenance, it is a selection that predates the column.
 */
var RDT_ORIGIN_DEFAULT = 'selection';

/** ModuleSettings keys under the `employees` module that configure RDT. */
var RDT_SETTING_KEYS = {
  ENABLED: 'rdt_enabled',
  FY_START_MONTH: 'rdt_fiscal_year_start_month',
  MONTHLY_PCT: 'rdt_monthly_target_pct',
  YEARLY_PCT: 'rdt_yearly_target_pct',
  HIRE_GRACE: 'rdt_hire_grace_months',
  REPEAT_MONTHS: 'rdt_repeat_months'
};

/* No title key. The programme used to name the one safety-team title in scope,
   and briefly also named the management titles to leave out; both are gone.
   Scope is decided by the medical, not the job title — see rdtEligible_.

   A `rdt_safety_title` or `rdt_excluded_titles` row left on the ModuleSettings
   tab from an earlier version is inert. Nothing reads either one. */

/**
 * What `enable RDT` seeds, and what a missing or unreadable setting falls back
 * to. Section 2 lists these same values as the tab's defaults.
 */
var RDT_DEFAULTS = {
  fiscal_year_start_month: 4,
  monthly_target_pct: 10,
  yearly_target_pct: 120,
  hire_grace_months: 3,
  repeat_months: [2, 3]
};

/** Entries on the dashboard's "recent activity" strip. */
var RDT_RECENT_LIMIT = 15;

/** Paging for list_rdt_history. */
var RDT_HISTORY_PAGE_SIZE_DEFAULT = 100;
var RDT_HISTORY_PAGE_SIZE_MAX = 500;

/** Notes are an admin's shorthand, not a report. */
var RDT_NOTES_MAX = 500;

/** Rows per bulk_import_rdt call, matching the cap in Section 3.9. */
var RDT_IMPORT_MAX_ROWS = 5000;

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

  return {
    enabled: normalizeBoolean(read(RDT_SETTING_KEYS.ENABLED)),
    fiscal_year_start_month: intIn(RDT_SETTING_KEYS.FY_START_MONTH, RDT_DEFAULTS.fiscal_year_start_month, 1, 12),
    monthly_target_pct: intIn(RDT_SETTING_KEYS.MONTHLY_PCT, RDT_DEFAULTS.monthly_target_pct, 0, 100),
    yearly_target_pct: intIn(RDT_SETTING_KEYS.YEARLY_PCT, RDT_DEFAULTS.yearly_target_pct, 0, 1000),
    hire_grace_months: intIn(RDT_SETTING_KEYS.HIRE_GRACE, RDT_DEFAULTS.hire_grace_months, 0, 60),
    repeat_months: repeatMonths
  };
}

// ---------------------------------------------------------------------------
// Fiscal year
// ---------------------------------------------------------------------------

/**
 * The fiscal year an ISO date falls inside.
 *
 * The calendar itself lives in Utils.gs as fiscalYearFor_, because inspection
 * waves need the same April year and two copies of it would disagree the first
 * time one was corrected. This wrapper stays because every caller in this file
 * reads as RDT code, and because the *policy* below is RDT's alone:
 *
 * The label is stamped onto a log row once at selection and never recomputed,
 * so a test selected in March and completed in April still counts against the
 * year it was selected in.
 *
 * @param {string} iso        'YYYY-MM-DD'
 * @param {number} startMonth 1–12
 * @return {{label: string, start_year: number, end_year: number,
 *           start_date: string, end_date: string}}
 */
function rdtFiscalYear_(iso, startMonth) {
  return fiscalYearFor_(iso, startMonth);
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
 * Everyone in scope except for the MCU rule: employed, here long enough to be
 * past the new-hire grace, and nothing else.
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
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (normalizeString(row.employee_id) === '') continue;
    if (normalizeBoolean(row.archived)) continue;
    if (normalizeString(row.employment_status).toLowerCase() !== 'active') continue;

    // Neither team nor title is looked at. See rdtEligible_ for why.

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
 *
 * The two flag columns fail the test outright, whatever the date says. `na`
 * means the admin has decided this employee has no medical on the platform's
 * books, and `suspended` means the one on file is void — either way there is no
 * live medical to reason from, which is exactly the situation the MCU exclusion
 * exists for. Checking the date alone would let an N/A medical with a stale
 * future date keep somebody in the pool.
 */
function rdtHasValidMcu_(row, iso) {
  if (normalizeBoolean(row.cert_mcu_na)) return false;
  if (normalizeBoolean(row.cert_mcu_suspended)) return false;

  var expiry = normalizeIsoDate(row.cert_mcu_expiry);
  return expiry !== '' && expiry >= iso;
}

/**
 * The full eligible pool: in scope AND holding a valid MCU.
 *
 * THE MEDICAL IS THE SCOPE RULE, NOT THE JOB TITLE
 * ------------------------------------------------
 * The programme used to decide scope by title — field team at every title, the
 * safety team only at `rdt_safety_title` — with a list of management titles
 * layered on top to catch the ones that rule missed. Both are gone, and neither
 * should come back.
 *
 * An employee who holds a live MCU is an employee Landmark sends for medicals,
 * and that is the same population the drug programme is aimed at. Management who
 * never go to site never take an MCU, so they leave the pool on their own, by a
 * fact already on their record rather than by a list somebody has to remember to
 * update. A title list has to be maintained: it is wrong the first time a role is
 * renamed, the first time a new one is added, and the first time somebody's team
 * column is set wrong by an import. The medical is maintained anyway, because
 * the compliance side of the platform depends on it.
 *
 * The exclusion this replaced ran the other way as well, and that half is worth
 * keeping in view: an expired MCU also drops somebody out, because the renewal
 * itself carries a drug test. So the pool is exactly "people with a current
 * medical on file", in both directions.
 */
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
      origin: rdtNormalizeOrigin_(rows[i].origin),
      updated_at: normalizeIsoDateTime(rows[i].updated_at),
      updated_by: normalizeString(rows[i].updated_by)
    });
  }
  return out;
}

/**
 * @private
 * Reads the origin column, defaulting anything blank or unrecognised.
 *
 * An absent column reads as undefined until addRdtOriginColumn() has run, which
 * is exactly the same as a blank cell — both mean "written before this existed",
 * and both land on `selection`. That is what lets the code deploy before the
 * Sheet is migrated.
 */
function rdtNormalizeOrigin_(raw) {
  var value = normalizeString(raw).toLowerCase();
  return RDT_ORIGINS.indexOf(value) === -1 ? RDT_ORIGIN_DEFAULT : value;
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
    origin: entry.origin || RDT_ORIGIN_DEFAULT,
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
        origin: 'selection',
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
 * `create_rdt_entry` — record a test that happened outside the monthly draw.
 *
 * WHY THIS EXISTS
 * ---------------
 * Until now the only way a `completed` row could come into being was to draw a
 * selection and then mark it done. That leaves no door for a test the programme
 * did not plan: a for-cause test, one carried out while the platform was not yet
 * running, or a paper record being transcribed. Those are facts, and a system
 * that cannot record a fact pushes people back to the spreadsheet.
 *
 * WHY IT ONLY CREATES `completed`
 * -------------------------------
 * `selected` is refused outright. Hand-writing a selection is precisely the
 * hand-picking the programme exists to prevent — the only two ways into that
 * state stay the random draw and the swap, both of which shuffle. An admin who
 * could type a name into a selection could quietly turn a testing programme into
 * a targeting one, and no amount of audit trail undoes that.
 *
 * `missed` is refused for a duller reason: it means "a planned test did not
 * happen", so there has to have been a plan. Turning a selection into a missed
 * one is update_rdt_entry's job; creating a miss from nothing records an absence
 * that was never expected in the first place.
 *
 * WHY `result` IS OPTIONAL HERE AND REQUIRED IN update_rdt_entry
 * --------------------------------------------------------------
 * They are different moments. Marking a pending test complete means the lab slip
 * is in hand, so an outcome is fair to insist on. Recording a historical test
 * often means copying a date off a register that never captured the outcome —
 * Landmark's own legacy workbook holds 148 test dates and not one pass or fail.
 * Section 2 already allows `result` to be blank on a completed row; demanding one
 * here would only push admins into inventing a `pass`.
 *
 * @param {Object} session
 * @param {Object} payload  {employee_id, test_date, result?, notes?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleCreateRdtEntry(session, payload) {
  var denied = requireModuleEdit(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['employee_id', 'test_date', 'result', 'notes']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var settings = rdtSettings_(getModuleSettingsMap());
  if (!settings.enabled) {
    return errResponse('validation_failed', 'rdt_disabled', { rdt: 'disabled' });
  }

  var today = todayIso();
  var fieldErrors = {};

  var employeeId = normalizeString(payload && payload.employee_id);
  if (employeeId === '') fieldErrors.employee_id = 'required';

  var testDate = normalizeIsoDate(payload && payload.test_date);
  if (normalizeString(payload && payload.test_date) === '') {
    fieldErrors.test_date = 'required';
  } else if (testDate === '') {
    fieldErrors.test_date = 'invalid_format';
  } else if (testDate > today) {
    // A test cannot have been completed tomorrow. Almost always a typo in the
    // year, and one that would file the test under the wrong fiscal year.
    fieldErrors.test_date = 'future';
  }

  var result = normalizeString(payload && payload.result).toLowerCase();
  if (result !== '' && RDT_RESULTS.indexOf(result) === -1) fieldErrors.result = 'invalid_value';

  var notes = normalizeString(payload && payload.notes);
  if (notes.length > RDT_NOTES_MAX) fieldErrors.notes = 'too_long';

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('create_rdt_entry: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    // Archived employees are valid targets: their tests are history, and
    // rdtProgress_ already drops them from coverage by counting over the current
    // pool rather than over everyone who was ever tested.
    var employeeRow = readRowByKey(SHEET_NAMES.EMPLOYEES, 'employee_id', employeeId);
    if (!employeeRow) return errResponse('not_found', 'employee_not_found');

    var entries = rdtAllEntries_();
    var existing = rdtTestDateIndex_(entries)[rdtTestDateKey_(employeeId, testDate)];
    if (existing !== undefined) {
      // Two tests for one person on one day is double entry every time it is not
      // a mistake in the date. Refusing is also what makes the import idempotent.
      //
      // The existing log_id goes in `message`, which Section 3.1 reserves for
      // developer visibility — `field_errors` is for validation_failed, and this
      // is not a bad field, it is a row that is already there.
      console.warn('create_rdt_entry: ' + employeeId + ' already has a test on ' +
        testDate + ' as ' + existing);
      return errResponse('conflict', 'rdt_test_already_recorded');
    }

    var row = rdtCompletedRow_({
      log_id: 'RDT-' + padNumber_(rdtNextNumber_(entries), 6),
      employee_id: employeeId,
      test_date: testDate,
      result: result,
      notes: notes,
      origin: 'manual',
      acting_user_id: session.user.user_id,
      stamped_at: nowIso(),
      settings: settings
    });

    appendRow(SHEET_NAMES.RDT_LOG, row);

    return okResponse({ entry: rdtShapeEntry_(rdtNormalizeRow_(row), employeeRow) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * @private
 * Builds one `completed` RdtLog row from a test that has already happened.
 *
 * Shared by create_rdt_entry and bulk_import_rdt so the two cannot drift on the
 * three decisions that matter:
 *
 *   fiscal_year comes from the test date, computed once here and never again
 *   (Section 2). A test on 20 March belongs to the year that is ending, not the
 *   one starting in April, whatever month it is recorded in.
 *
 *   selected_at is set to the test date. There was no selection event to date it
 *   from, and leaving it blank would drop the entry out of the history page's
 *   month filter and sort it above everything else. The test date is the truest
 *   thing available about when this belongs.
 *
 *   selected_by is the person recording it, not a claim about who drew it. The
 *   `origin` column is what says nobody drew it at all.
 *
 * @param {Object} spec
 * @return {Object} a row ready for appendRow / appendRows
 */
function rdtCompletedRow_(spec) {
  return {
    log_id: spec.log_id,
    employee_id: spec.employee_id,
    fiscal_year: rdtFiscalYear_(spec.test_date, spec.settings.fiscal_year_start_month).label,
    selected_at: spec.test_date,
    selected_by: spec.acting_user_id,
    test_date: spec.test_date,
    status: 'completed',
    result: spec.result || '',
    notes: spec.notes || '',
    origin: spec.origin,
    updated_at: spec.stamped_at,
    updated_by: spec.acting_user_id
  };
}

/** @private The key one employee's test on one day is identified by. */
function rdtTestDateKey_(employeeId, testDate) {
  return employeeId + '|' + testDate;
}

/**
 * @private
 * {employee|date → log_id} across every entry that carries a test date.
 *
 * Rows without one — `selected` and `missed` — are absent by construction, which
 * is right: neither records a test having happened, so neither should block one
 * from being recorded.
 */
function rdtTestDateIndex_(entries) {
  var index = {};
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].test_date === '') continue;
    index[rdtTestDateKey_(entries[i].employee_id, entries[i].test_date)] = entries[i].log_id;
  }
  return index;
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
 * `bulk_import_rdt` — backfill completed tests from a legacy record.
 *
 * ONE ROW IS ONE TEST
 * -------------------
 * The payload is event-shaped: each row is a single test on a single date. That
 * is deliberately *not* the shape of the workbook this was built for, which
 * carries one row per employee with an `RDT 1 Date` and an `RDT 2 Date`. Fanning
 * those two columns into events is a one-time transformation of one particular
 * spreadsheet, and teaching either this action or the shared import UI to do it
 * would leave that spreadsheet's shape fossilised in the platform forever. The
 * transformation happens once, outside the codebase; this only ever sees tests.
 *
 * Column position in such a workbook carries no meaning worth importing, either.
 * In Landmark's own file `RDT 1` spans two fiscal years and plenty of people's
 * `RDT 2` is their only test of the current one, so reading the second column as
 * "the repeat-phase test" would file tests under the wrong phase. Every row is
 * just a date, and `fiscal_year` falls out of that date.
 *
 * ALL OR NOTHING
 * --------------
 * Same contract as bulk_import_employees: every row is validated before any row
 * is written, and one bad row rejects the call with the Sheet untouched. A
 * half-imported history is worse than none, because nobody can tell by looking
 * which half arrived.
 *
 * @param {Object} session
 * @param {Object} payload  {rows, on_duplicate?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleBulkImportRdt(session, payload) {
  var denied = requireModuleEdit(session, 'employees');
  if (denied) return denied;

  var unknown = collectUnknownKeys_(payload, ['rows', 'on_duplicate']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var settings = rdtSettings_(getModuleSettingsMap());
  if (!settings.enabled) {
    return errResponse('validation_failed', 'rdt_disabled', { rdt: 'disabled' });
  }

  var inputRows = payload && payload.rows;
  var onDuplicate = normalizeString(payload && payload.on_duplicate) || 'skip';

  var fieldErrors = {};
  if (!Array.isArray(inputRows) || inputRows.length === 0) {
    fieldErrors.rows = 'required';
  } else if (inputRows.length > RDT_IMPORT_MAX_ROWS) {
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
    console.error('bulk_import_rdt: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    var today = todayIso();
    var employeeRows = readAllRows(SHEET_NAMES.EMPLOYEES);
    var byId = rdtEmployeeIndex_(employeeRows);
    var byNationalId = rdtNationalIdIndex_(employeeRows);

    // One read of RdtLog, not two. rdtAllEntries_ would re-fetch the same range
    // to give back the same rows in the same shape, and on a 5,000-row import
    // that is a whole extra round trip for nothing.
    var pairs = readAllRowsWithIndex(SHEET_NAMES.RDT_LOG);
    var entries = [];
    var rowByLogId = {};   // {log_id → sheet row}, for an overwrite to merge into

    for (var p = 0; p < pairs.length; p++) {
      if (normalizeString(pairs[p].data.log_id) === '') continue;

      var entry = rdtNormalizeRow_(pairs[p].data);
      entries.push(entry);
      rowByLogId[entry.log_id] = pairs[p].row;
    }

    var existingIndex = rdtTestDateIndex_(entries);

    var rowErrors = [];
    var plan = [];
    var seenInPayload = {};

    // --- Pass 1: validate every row, write nothing --------------------------
    for (var i = 0; i < inputRows.length; i++) {
      var input = inputRows[i];
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        rowErrors.push({ row: i, errors: { row: 'invalid_type' } });
        continue;
      }

      var errors = collectUnknownKeys_(
        input, ['employee_id', 'national_id', 'test_date', 'result', 'notes']
      );

      var resolved = rdtResolveEmployee_(input, byId, byNationalId);
      if (resolved.error) errors.employee = resolved.error;

      var testDate = normalizeIsoDate(input.test_date);
      if (normalizeString(input.test_date) === '') {
        errors.test_date = 'required';
      } else if (testDate === '') {
        errors.test_date = 'invalid_format';
      } else if (testDate > today) {
        errors.test_date = 'future';
      }

      var result = normalizeString(input.result).toLowerCase();
      if (result !== '' && RDT_RESULTS.indexOf(result) === -1) errors.result = 'invalid_value';

      var notes = normalizeString(input.notes);
      if (notes.length > RDT_NOTES_MAX) errors.notes = 'too_long';

      if (hasKeys_(errors)) {
        rowErrors.push({ row: i, errors: errors });
        continue;
      }

      var key = rdtTestDateKey_(resolved.employee_id, testDate);

      // The same test twice in one file is always an error. Unlike a collision
      // with the existing log, there is no policy under which both could apply —
      // one of the two rows is simply wrong.
      if (seenInPayload[key] !== undefined) {
        rowErrors.push({ row: i, errors: { test_date: 'duplicate_in_payload' } });
        continue;
      }
      seenInPayload[key] = true;

      var clashesWith = existingIndex[key];
      if (clashesWith !== undefined) {
        // Skip is what makes re-running the same file a no-op. Overwrite is for
        // the case that actually happens later: a lab returning outcomes for
        // tests whose dates were imported months earlier.
        plan.push(onDuplicate === 'overwrite'
          ? { action: 'overwrite', row: rowByLogId[clashesWith], result: result, notes: notes }
          : { action: 'skip' });
        continue;
      }

      plan.push({
        action: 'create',
        employee_id: resolved.employee_id,
        test_date: testDate,
        result: result,
        notes: notes
      });
    }

    if (rowErrors.length > 0) {
      return rowErrorResponse_(rowErrors);
    }

    // --- Pass 2: write ------------------------------------------------------
    var actingUserId = session.user.user_id;
    var stampedAt = nowIso();
    var nextNumber = rdtNextNumber_(entries);

    var newRows = [];
    var rowUpdates = [];
    var skipped = 0;
    var byFiscalYear = {};

    for (var k = 0; k < plan.length; k++) {
      if (plan[k].action === 'skip') { skipped++; continue; }

      if (plan[k].action === 'overwrite') {
        rowUpdates.push({
          row: plan[k].row,
          data: {
            result: plan[k].result,
            notes: plan[k].notes,
            updated_at: stampedAt,
            updated_by: actingUserId
          }
        });
        continue;
      }

      var row = rdtCompletedRow_({
        log_id: 'RDT-' + padNumber_(nextNumber + newRows.length, 6),
        employee_id: plan[k].employee_id,
        test_date: plan[k].test_date,
        result: plan[k].result,
        notes: plan[k].notes,
        origin: 'import',
        acting_user_id: actingUserId,
        stamped_at: stampedAt,
        settings: settings
      });

      byFiscalYear[row.fiscal_year] = (byFiscalYear[row.fiscal_year] || 0) + 1;
      newRows.push(row);
    }

    updateRowsAt(SHEET_NAMES.RDT_LOG, rowUpdates);
    appendRows(SHEET_NAMES.RDT_LOG, newRows);

    console.log('bulk_import_rdt: added ' + newRows.length + ', updated ' + rowUpdates.length +
      ', skipped ' + skipped + ' — ' + JSON.stringify(byFiscalYear));

    return okResponse({
      added: newRows.length,
      updated: rowUpdates.length,
      skipped: skipped,

      // The year breakdown is the check that the file landed where it was meant
      // to. A backfill that reports every test under the current year has almost
      // certainly had its dates misread.
      by_fiscal_year: byFiscalYear
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * @private
 * {lowercased national_id → {active: [employee_id], archived: [employee_id]}}
 * across every employee, archived included.
 *
 * Deliberately not Employees.gs's nationalIdIndex_, which skips archived rows
 * because it exists to police uniqueness among the living. This index exists to
 * find whoever a historical test belongs to, and a fair share of Landmark's
 * legacy test records name people who have since left — dropping them would
 * silently lose that part of the history.
 *
 * The two buckets are kept apart rather than merged so an ambiguous national_id
 * can be reported as ambiguous instead of resolved by luck of iteration order.
 */
function rdtNationalIdIndex_(rows) {
  var index = {};

  for (var i = 0; i < rows.length; i++) {
    var employeeId = normalizeString(rows[i].employee_id);
    if (employeeId === '') continue;

    var nationalId = normalizeString(rows[i].national_id).toLowerCase();
    if (nationalId === '') continue;

    if (!index[nationalId]) index[nationalId] = { active: [], archived: [] };
    if (normalizeBoolean(rows[i].archived)) index[nationalId].archived.push(employeeId);
    else index[nationalId].active.push(employeeId);
  }
  return index;
}

/**
 * @private
 * Works out which employee an import row is about.
 *
 * `employee_id` wins when present — it is unambiguous by construction. Otherwise
 * the national_id is matched, and the live record is preferred over an archived
 * one: where the same person holds both (a rehire, or a roster that was never
 * tidied), the tests belong on the record whose coverage is still being counted.
 *
 * Two live records for one national_id should be impossible — uniqueness is
 * enforced on create — but if the tab ever holds them, this reports the row as
 * ambiguous rather than picking one. Guessing which of two people was tested is
 * not a thing an importer should do quietly.
 *
 * @return {{employee_id: string, error: string}} `error` is '' on success
 */
function rdtResolveEmployee_(input, byId, byNationalId) {
  var employeeId = normalizeString(input.employee_id);
  if (employeeId !== '') {
    return byId[employeeId]
      ? { employee_id: employeeId, error: '' }
      : { employee_id: '', error: 'not_found' };
  }

  var nationalId = normalizeString(input.national_id).toLowerCase();
  if (nationalId === '') return { employee_id: '', error: 'required' };

  var found = byNationalId[nationalId];
  if (!found) return { employee_id: '', error: 'not_found' };

  if (found.active.length === 1) return { employee_id: found.active[0], error: '' };
  if (found.active.length > 1) return { employee_id: '', error: 'ambiguous' };
  if (found.archived.length === 1) return { employee_id: found.archived[0], error: '' };
  if (found.archived.length > 1) return { employee_id: '', error: 'ambiguous' };

  return { employee_id: '', error: 'not_found' };
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
      origin: 'selection',
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

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

/**
 * One-shot: adds the `origin` column to the RdtLog tab and backfills every
 * existing row with 'selection'.
 *
 * Run once from the Apps Script editor after deploying this version. It is
 * idempotent — a column that already exists is left alone — so re-running after
 * a failure is safe.
 *
 * The backfill is honest rather than a placeholder. Before this column existed,
 * the only two writers of an RdtLog row were generate_rdt_selection and
 * swap_rdt_selection, so every row already on the tab did come from the random
 * draw. That is the difference between this migration and
 * addEquipmentSubcontractorColumn, which backfills nothing because guessing an
 * owner would be inventing data.
 *
 * Until it has run the platform still works: a missing column reads as
 * undefined, rdtNormalizeOrigin_ turns that into 'selection', and nothing reads
 * the value for anything but display. That degradation is deliberate — the
 * frontend deploys by pushing to main and the Sheet cannot be migrated in the
 * same instant.
 *
 * @return {{added: boolean, column_index: number, backfilled_rows: number}}
 */
function addRdtOriginColumn() {
  var sheet = getSheet(SHEET_NAMES.RDT_LOG);
  var headers = getHeaders(SHEET_NAMES.RDT_LOG).slice();

  var existing = headers.indexOf('origin');
  if (existing !== -1) {
    console.log('addRdtOriginColumn: nothing to do — column already at index ' + (existing + 1));
    return { added: false, column_index: existing + 1, backfilled_rows: 0 };
  }

  headers.push('origin');
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Backfill in one write. Section 2 keeps every column populated rather than
  // relying on blank-means-default, so leaving the new cells empty would put the
  // tab out of spec even though it would read the same.
  var dataRows = sheet.getLastRow() - 1;
  if (dataRows > 0) {
    var block = [];
    for (var r = 0; r < dataRows; r++) block.push([RDT_ORIGIN_DEFAULT]);

    var range = sheet.getRange(2, headers.length, dataRows, 1);
    range.setNumberFormat('@');
    range.setValues(block);
  }

  clearSheetCache();
  console.log('addRdtOriginColumn: added column at index ' + headers.length +
    ', backfilled ' + dataRows + ' rows as ' + RDT_ORIGIN_DEFAULT);
  return { added: true, column_index: headers.length, backfilled_rows: dataRows };
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
    origin: rdtNormalizeOrigin_(row.origin),
    updated_at: normalizeIsoDateTime(row.updated_at),
    updated_by: normalizeString(row.updated_by)
  };
}
