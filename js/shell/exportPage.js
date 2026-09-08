/* ==========================================================================
   exportPage.js — download a filtered set of records as Excel, CSV or PDF.

   Ported from OHS-DB's export page, with the one structural difference the
   platform forces: OHS-DB filtered a local DATA blob and knew the match count
   for free. Here the server owns the data, so the count is a `page_size: 1`
   probe and the download itself is a page walk — nothing is exported that the
   count did not promise, because both ask the same query.

   WHAT LIVES HERE AND WHAT DOES NOT
   ---------------------------------
   The per-module tables below are module knowledge sitting in the shell, the
   same trade the Data tab's IMPORT_TARGETS makes: the alternative is a new
   `export` slot on every manifest, and this page is the only thing that would
   ever read it. If a third module ships, that trade flips.

   No export *formatting* is here. Shaping and file writing live in
   js/utils/exportHelpers.js, exactly as in OHS-DB.

   THE TWO SPREADSHEETS
   --------------------
   `Excel` is the full record: every raw Sheet column, re-importable as-is.
   `Report` is what goes to management and to a customer — a Dashboard sheet of
   aggregates, then the same records with the internal columns dropped.

   They are two cards rather than one, because the thing that makes the Excel
   export useful (raw column names, every audit field, the derived block) is
   exactly what makes it wrong to hand to a customer, and the thing that makes
   the report readable is what would break `bulk_import_employees` if it were the
   only export. Neither can be the other's default.

   Both the omitted-column rule and the Dashboard content live here rather than
   in exportHelpers.js: they name fields of specific modules, and that file
   deliberately names none.

   CAPS
   ----
   OHS-DB's limits, unchanged: 100 records for PDF, 5,000 for Excel and CSV.
   Over the cap the format's card is disabled with a visible reason. An export
   is never silently truncated.
   ========================================================================== */

import { UI, CONFIG } from '../state.js';
import { api } from '../api.js';
import { render } from '../render.js';
import { t } from '../i18n/i18n.js';
import { escapeHtml, fmtDate, todayISO } from '../utils/format.js';
import { canView } from '../utils/permissions.js';
import { MODULE_NAMES } from '../constants/globals.js';
import { toast, toastError } from '../components/toast.js';
import {
  exportToExcel, exportToCSV, exportToPDF, exportToReport, exportBlockReason,
  pdfDate, pdfFlag, pdfText, SPREADSHEET_ROW_CAP, PDF_ROW_CAP,
} from '../utils/exportHelpers.js';

/** Page size for the walk that fetches the full set. The server caps at 200. */
const WALK_PAGE_SIZE = 200;

/** Circuit breaker: 5,000 rows is the export cap, so 25 pages can always cover it. */
const WALK_MAX_PAGES = 25;

/* ---------- Per-module export definitions --------------------------------- */

/**
 * The certificate states the compliance filter offers, worst first. Repeated
 * from the employees module's constants rather than imported, for the reason in
 * the header.
 *
 * `na` is the seventh state and is deliberately absent: this drives the
 * `worst_state` filter, and `na` never becomes a worst state.
 */
const CERT_STATES = ['suspended', 'expired', 'urgent', 'soon', 'missing', 'valid'];

/** The three verdicts, worst first — the equipment filter's options. */
const VERDICTS = ['blocked', 'warning', 'cleared'];

/**
 * Certificate keys, read off a record rather than listed.
 *
 * Every employee the server returns carries every `cert_<key>_expiry` column
 * (shapeEmployee_), so the record is a more reliable source for this than a
 * copy of the schema kept here would be.
 */
function certKeysOf(employee) {
  return Object.keys(employee)
    .map((key) => /^cert_(.+)_expiry$/.exec(key))
    .filter(Boolean)
    .map((match) => match[1]);
}

/* ---------- Report shaping ------------------------------------------------ */

/**
 * Columns the report drops by name.
 *
 * Three groups, each for its own reason:
 *
 *   audit trail   who touched the row and when. Internal bookkeeping — it tells
 *                 a customer nothing about their equipment or their people.
 *   national_id   personal data. A compliance report leaves the building; a
 *                 roster of national ID numbers should not go with it.
 *   admin fields  `comments` is explicitly admin-only (Section 7.6), and
 *                 `rejected_by` is an author column like the rest.
 *
 * `archived` and `rejected` are dropped for a different reason: both are already
 * decided by the filter that produced the set, so the column repeats the filter
 * on every row and can only confuse a reader who does not know what it means.
 */
const REPORT_OMITTED_COLUMNS = new Set([
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'archived', 'archived_at', 'archived_by',
  'national_id',
  'rejected', 'rejected_by',
  'comments',
]);

/**
 * True when a column has no place in a report.
 *
 * Beyond the named set: the `derived_` block (the aggregates it summarises are
 * on the Dashboard, where a manager can read them without counting rows), the
 * certificate `_link` / `_na` / `_suspended` columns (a Drive URL is dead text
 * in print and the two flags are admin decisions, not facts about the person),
 * and the retired `wave_N_*` columns, which nothing has written since the log
 * moved to InspectionWaves.
 *
 * The certificate `_expiry` dates stay. They are the report.
 *
 * @param {string} key
 * @returns {boolean}
 */
function omitReportColumn(key) {
  if (REPORT_OMITTED_COLUMNS.has(key)) return true;
  if (key.indexOf('derived_') === 0) return true;
  if (/^cert_.+_(link|na|suspended)$/.test(key)) return true;
  if (/^wave_\d+_(date|result)$/.test(key)) return true;
  return false;
}

/** A share of the whole as a percentage, to one decimal. 0 when there is no whole. */
function sharePct(part, total) {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
}

/**
 * Counts per group, sorted by count descending, ties broken by label so the
 * order is stable between two exports of the same set.
 *
 * @param {Array<Object>} records
 * @param {function(Object): string} labelOf  '' for a record with nothing recorded
 * @param {string} blankLabel                 what to call the '' bucket
 * @returns {Array<{label: string, total: number, blocked: number, warning: number}>}
 */
function groupByLabel(records, labelOf, blankLabel) {
  const groups = new Map();

  records.forEach((record) => {
    const raw = (labelOf(record) || '').trim();
    const label = raw === '' ? blankLabel : raw;

    if (!groups.has(label)) groups.set(label, { label, total: 0, blocked: 0, warning: 0 });

    const group = groups.get(label);
    group.total += 1;

    const verdict = (record.derived || {}).verdict;
    if (verdict === 'blocked') group.blocked += 1;
    else if (verdict === 'warning') group.warning += 1;
  });

  return Array.from(groups.values()).sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total;
    return a.label < b.label ? -1 : (a.label > b.label ? 1 : 0);
  });
}

/** The filters that produced this set, spelled out for the Dashboard. */
function describeFilters(module, selection) {
  const parts = [];

  module.filters.forEach((filter) => {
    const value = selection[filter.key];
    if (!value) return;

    const label = t(filter.labelKey);

    if (filter.kind === 'checkbox') parts.push(label);
    else if (filter.kind === 'static') {
      const option = filter.options.find((o) => o.value === value);
      parts.push(`${label}: ${option ? t(option.labelKey) : value}`);
    } else parts.push(`${label}: ${value}`);
  });

  return parts.length === 0 ? t('export_report_no_filters') : parts.join('  ·  ');
}

/**
 * The block every report opens with: what this is, who it is about, when it was
 * run, and — the part that matters most when somebody queries a number six weeks
 * later — which filters produced it.
 */
function coverSection(module, selection, records) {
  return {
    heading: t('export_report_title', { module: t(module.labelKey) }),
    rows: [
      [t('export_report_company'), CONFIG.company_name || ''],
      [t('export_report_generated'), fmtDate(todayISO())],
      [t('export_report_filters'), describeFilters(module, selection)],
      [t('export_report_total'), records.length],
    ],
  };
}

/** Verdict counts. The same three values both modules derive (Section 6). */
function verdictSection(records) {
  const counts = { cleared: 0, warning: 0, blocked: 0 };
  records.forEach((record) => {
    const verdict = (record.derived || {}).verdict;
    if (counts[verdict] !== undefined) counts[verdict] += 1;
  });

  return {
    heading: t('export_dash_verdict'),
    head: [t('export_dash_verdict'), t('export_dash_count'), t('export_dash_share')],
    rows: VERDICTS.map((verdict) => [
      t('verdict_' + verdict), counts[verdict], sharePct(counts[verdict], records.length),
    ]),
  };
}

/** A group table: label, total, and how many of them are blocked or warning. */
function groupSection(heading, labelHeading, groups) {
  return {
    heading,
    head: [labelHeading, t('export_dash_count'), t('verdict_blocked'), t('verdict_warning')],
    rows: groups.map((g) => [g.label, g.total, g.blocked, g.warning]),
  };
}

/**
 * The two modules this page can export, each declaring its filters, its list
 * action, and how a record becomes a PDF page.
 *
 * `filters` entries are rendered generically by renderFilterBar: `kind` picks
 * the control, `options` fills a select, and `toQuery` folds the selection into
 * the action's payload.
 */
const EXPORT_MODULES = [
  {
    key: MODULE_NAMES.EMPLOYEES,
    labelKey: 'module_employees',
    action: 'list_employees',
    resultKey: 'employees',
    filePrefix: 'Employees',
    sheetName: 'Employees',

    filters: [
      { key: 'team', labelKey: 'emp_col_team', kind: 'static',
        options: [
          { value: 'field', labelKey: 'team_field' },
          { value: 'safety', labelKey: 'team_safety' },
        ] },
      { key: 'worst_state', labelKey: 'emp_filter_state', kind: 'static',
        options: CERT_STATES.map((state) => ({ value: state, labelKey: 'state_' + state })) },
      { key: 'subcontractor', labelKey: 'emp_filter_subcontractor', kind: 'list', listKey: 'subcontractors' },
      { key: 'include_archived', labelKey: 'export_include_archived', kind: 'checkbox' },
    ],

    /** Filter selections → the `list_employees` payload (Section 3.5). */
    toQuery(selection) {
      const filters = {};
      if (selection.worst_state) filters.worst_state = selection.worst_state;
      if (selection.subcontractor) filters.subcontractor = selection.subcontractor;

      return {
        team: selection.team || undefined,
        include_archived: !!selection.include_archived,
        filters,
      };
    },

    report: {
      /**
       * The Dashboard sheet for an employee report.
       *
       * Read top to bottom it answers, in order: what is this, how many people
       * can work today, how bad is the certificate position, which certificates
       * are driving it, and whose people they are. That last one is the question
       * a subcontractor meeting opens with and no other sheet answers.
       */
      sections(records, selection, module) {
        const total = records.length;

        // Certificate keys in the order the records carry them, restricted to
        // the ones that actually apply to somebody — per_cert only holds a
        // team's applicable certs, so a field-only export never prints a
        // scaffolding row that would read as "nobody has it" (Section 6.1).
        const certKeys = [];
        const seenCert = new Set();
        records.forEach((employee) => {
          Object.keys((employee.derived || {}).per_cert || {}).forEach((key) => {
            if (seenCert.has(key)) return;
            seenCert.add(key);
            certKeys.push(key);
          });
        });

        const stateCounts = {};
        const certCounts = {};
        certKeys.forEach((key) => { certCounts[key] = {}; });

        records.forEach((employee) => {
          const derived = employee.derived || {};

          const worst = derived.worst_state;
          if (worst) stateCounts[worst] = (stateCounts[worst] || 0) + 1;

          const perCert = derived.per_cert || {};
          Object.keys(perCert).forEach((key) => {
            if (!certCounts[key]) return;
            const state = perCert[key];
            certCounts[key][state] = (certCounts[key][state] || 0) + 1;
          });
        });

        return [
          coverSection(module, selection, records),
          verdictSection(records),

          {
            // Counted over people, not certificates — one employee with four
            // expired certs is one row here and four in the table below. The
            // two never sum to each other and are not meant to.
            heading: t('export_dash_worst_state'),
            head: [t('export_dash_state'), t('export_dash_count'), t('export_dash_share')],
            rows: CERT_STATES
              .filter((state) => (stateCounts[state] || 0) > 0)
              .map((state) => [
                t('state_' + state), stateCounts[state], sharePct(stateCounts[state], total),
              ]),
          },

          {
            heading: t('export_dash_by_cert'),
            head: [
              t('export_dash_certificate'),
              t('state_expired'), t('state_urgent'), t('state_soon'), t('state_suspended'),
            ],
            rows: certKeys.map((key) => [
              t('cert_' + key),
              certCounts[key].expired || 0,
              certCounts[key].urgent || 0,
              certCounts[key].soon || 0,
              certCounts[key].suspended || 0,
            ]),
          },

          groupSection(
            t('export_dash_by_subcontractor'),
            t('emp_filter_subcontractor'),
            groupByLabel(records, (e) => e.subcontractor, t('export_dash_not_recorded'))
          ),

          groupSection(
            t('export_dash_by_team'),
            t('emp_col_team'),
            groupByLabel(
              records,
              (e) => t(e.team === 'safety' ? 'team_safety' : 'team_field'),
              t('export_dash_not_recorded')
            )
          ),
        ];
      },
    },

    pdf: {
      title: (e) => e.name,
      subtitle: (e) => [
        e.employee_id,
        t(e.team === 'safety' ? 'team_safety' : 'team_field'),
        e.employment_status,
      ].filter(Boolean).join('  ·  '),

      sections(e) {
        const derived = e.derived || {};
        const perCert = derived.per_cert || {};

        return [
          {
            heading: t('emp_section_personal'),
            rows: [
              [t('emp_field_national_id'), pdfText(e.national_id)],
              [t('emp_field_title'), pdfText(e.title)],
              [t('emp_field_contractor'), pdfText(e.contractor)],
              [t('emp_field_subcontractor'), pdfText(e.subcontractor)],
              [t('emp_field_hired_date'), pdfDate(e.hired_date)],
              [t('emp_field_employment_status'), pdfText(e.employment_status)],
              [t('emp_field_legal_permission'), pdfText(e.legal_permission)],
              [t('emp_col_verdict'), pdfText(derived.verdict ? t('verdict_' + derived.verdict) : '')],
            ],
          },
          {
            heading: t('emp_section_certs'),
            valueHeading: t('emp_col_expiry'),
            // Only the certs this employee's team actually carries have a
            // derived state, so per_cert is what decides which rows print.
            rows: certKeysOf(e)
              .filter((key) => perCert[key] !== undefined)
              .map((key) => [
                t('cert_' + key),
                `${pdfDate(e['cert_' + key + '_expiry'])}  (${t('state_' + perCert[key])})`,
              ]),
          },
          {
            heading: t('emp_section_quals'),
            // Field-team employees have no qualification columns filled; an
            // empty section is dropped by the writer rather than printed blank.
            rows: e.team === 'safety' ? [
              [t('qual_nebosh'), pdfFlag(e.qual_nebosh)],
              [t('qual_iso_45001'), pdfFlag(e.qual_iso_45001)],
              [t('qual_osha'), pdfFlag(e.qual_osha)],
            ] : [],
          },
          // No drug-testing section. An employee card prints what is on the
          // employee record, and drug tests are not on it — they are events on
          // RdtLog. The RDT log has its own export on #/rdt/history.
        ];
      },
    },
  },

  {
    key: MODULE_NAMES.EQUIPMENT,
    labelKey: 'module_equipment',
    action: 'list_equipment',
    resultKey: 'equipment',
    filePrefix: 'Equipment',
    sheetName: 'Equipment',

    filters: [
      { key: 'item', labelKey: 'eqp_filter_item', kind: 'list', listKey: 'equipment_items' },
      { key: 'brand', labelKey: 'eqp_filter_brand', kind: 'list', listKey: 'equipment_brands' },
      { key: 'subcontractor', labelKey: 'eqp_filter_subcontractor', kind: 'list', listKey: 'subcontractors' },
      { key: 'worst_state', labelKey: 'eqp_filter_verdict', kind: 'static',
        options: VERDICTS.map((verdict) => ({ value: verdict, labelKey: 'verdict_' + verdict })) },
      { key: 'include_rejected', labelKey: 'export_include_rejected', kind: 'checkbox' },
    ],

    /**
     * Filter selections → the `list_equipment` payload (Section 3.6).
     *
     * The server calls the verdict filter `worst_state` even though equipment
     * has no worst_state — the same name mismatch the equipment module's
     * dataActions absorbs.
     */
    toQuery(selection) {
      const filters = {};
      if (selection.item) filters.item = selection.item;
      if (selection.brand) filters.brand = selection.brand;
      if (selection.subcontractor) filters.subcontractor = selection.subcontractor;
      if (selection.worst_state) filters.worst_state = selection.worst_state;

      return {
        include_rejected: !!selection.include_rejected,
        filters,
      };
    },

    report: {
      /**
       * The Dashboard sheet for an equipment report.
       *
       * The owning-company table is the one the dashboard chart exists for
       * (Section 5.5) and the reason `subcontractor` was added to the tab at
       * all: "whose expired harness is this" is the question a report to a
       * customer has to be able to answer.
       */
      sections(records, selection, module) {
        const total = records.length;

        const thirdParty = {};
        records.forEach((item) => {
          const state = (item.derived || {}).third_party_state;
          if (state) thirdParty[state] = (thirdParty[state] || 0) + 1;
        });

        return [
          coverSection(module, selection, records),
          verdictSection(records),

          {
            heading: t('export_dash_third_party'),
            head: [t('export_dash_state'), t('export_dash_count'), t('export_dash_share')],
            // `suspended` is absent: it is applied on top of a date by the
            // employee derivation only, and a third-party inspection has no
            // flag columns to suspend it with (Section 6.5).
            rows: CERT_STATES
              .filter((state) => state !== 'suspended' && (thirdParty[state] || 0) > 0)
              .map((state) => [
                t('state_' + state), thirdParty[state], sharePct(thirdParty[state], total),
              ]),
          },

          groupSection(
            t('export_dash_by_item'),
            t('eqp_filter_item'),
            groupByLabel(records, (q) => q.item, t('export_dash_not_recorded'))
          ),

          groupSection(
            t('export_dash_by_owner'),
            t('eqp_filter_subcontractor'),
            // The blank bucket is real and is never dropped: the column was
            // added after the tab was in use and nothing was backfilled, so
            // hiding it would understate the fleet (Section 2).
            groupByLabel(records, (q) => q.subcontractor, t('export_dash_not_recorded'))
          ),
        ];
      },
    },

    pdf: {
      title: (q) => `${q.item || t('module_equipment')} — ${q.serial_no}`,
      subtitle: (q) => [
        q.equipment_id,
        q.brand,
        q.derived && q.derived.verdict ? t('verdict_' + q.derived.verdict) : '',
      ].filter(Boolean).join('  ·  '),

      sections(q) {
        const derived = q.derived || {};

        return [
          {
            heading: t('eqp_section_identity'),
            rows: [
              [t('eqp_field_item'), pdfText(q.item)],
              [t('eqp_field_brand'), pdfText(q.brand)],
              [t('eqp_field_serial_no'), pdfText(q.serial_no)],
              [t('eqp_field_third_party_sn'), pdfText(q.third_party_sn)],
              [t('eqp_field_date_of_manufacture'), pdfDate(q.date_of_manufacture)],
            ],
          },
          {
            heading: t('eqp_section_assignment'),
            rows: [
              [t('eqp_field_subcontractor'), pdfText(q.subcontractor)],
              [t('eqp_col_team_leader'), pdfText(q.team_leader_name || q.team_leader_id)],
              [t('eqp_col_verdict'), pdfText(derived.verdict ? t('verdict_' + derived.verdict) : '')],
            ],
          },
          {
            heading: t('eqp_section_inspection'),
            valueHeading: t('eqp_col_date'),
            rows: [
              [t('eqp_field_third_party_end'), pdfDate(q.third_party_inspection_end_date)],
            ],
          },
          {
            heading: t('eqp_section_waves'),
            valueHeading: t('eqp_col_result'),
            rows: [1, 2, 3].map((n) => [
              t('eqp_wave_n', { n }),
              q['wave_' + n + '_result']
                ? `${pdfDate(q['wave_' + n + '_date'])}  (${t('eqp_wave_' + q['wave_' + n + '_result'])})`
                : pdfDate(q['wave_' + n + '_date']),
            ]),
          },
          {
            heading: t('eqp_section_rejection'),
            rows: q.rejected ? [
              [t('eqp_field_rejection_date'), pdfDate(q.rejection_date)],
              [t('eqp_field_rejection_reason'), pdfText(q.rejection_reason)],
            ] : [],
          },
        ];
      },
    },
  },
];

/** The modules the current user may export. */
function visibleModules() {
  return EXPORT_MODULES.filter((module) => canView(module.key));
}

/** A module definition by key, or the first one the user can see. */
function moduleFor(key) {
  const visible = visibleModules();
  return visible.find((module) => module.key === key) || visible[0] || null;
}

/* ---------- State --------------------------------------------------------- */

function pageState() {
  if (!UI.exportPage) {
    UI.exportPage = {
      module: EXPORT_MODULES[0].key,

      // Filter selections per module, so switching tabs keeps each one's set.
      selection: {},

      count: { status: 'idle', seq: 0, value: 0, queryKey: null, error: null },
      options: { status: 'idle', seq: 0, data: null, error: null },
      busy: '',   // the format currently downloading
    };
  }
  return UI.exportPage;
}

/** The selection object for a module, created on first use. */
function selectionFor(moduleKey) {
  const s = pageState();
  if (!s.selection[moduleKey]) s.selection[moduleKey] = {};
  return s.selection[moduleKey];
}

/** Identifies a query, so we can tell whether the count in hand still answers it. */
function queryKeyFor(module, selection) {
  return module.key + ' ' + JSON.stringify(module.toQuery(selection));
}

/* ---------- Data ---------------------------------------------------------- */

/**
 * The match count for the current filters.
 *
 * `page_size: 1` because only `total_matching` is wanted — the server still
 * derives the whole matching set when a state filter is on (Section 3.5), but
 * one row comes back over the wire instead of hundreds.
 */
async function ensureCount() {
  const s = pageState();
  const module = moduleFor(s.module);
  if (!module) return;

  const selection = selectionFor(module.key);
  const key = queryKeyFor(module, selection);

  if (s.count.status === 'loading') return;
  if (s.count.status !== 'idle' && s.count.queryKey === key) return;

  const mySeq = ++s.count.seq;
  s.count.status = 'loading';
  s.count.queryKey = key;
  s.count.error = null;
  render();

  try {
    const data = await api.call(module.action, {
      ...module.toQuery(selection),
      page: 1,
      page_size: 1,
    });

    if (mySeq !== s.count.seq) return;

    s.count.value = data.total_matching || 0;
    s.count.status = 'ready';
  } catch (err) {
    if (mySeq !== s.count.seq) return;

    s.count.status = 'error';
    s.count.error = err;
    console.error('[export] count failed:', err);
  }

  render();
}

/** The dropdown options that fill the list-backed filters. */
function ensureOptions() {
  const s = pageState();
  if (s.options.status !== 'idle') return;

  const mySeq = ++s.options.seq;
  s.options.status = 'loading';

  api.call('list_field_options', {})
    .then((data) => {
      if (mySeq !== s.options.seq) return;
      s.options.data = data.options || {};
      s.options.status = 'ready';
      render();
    })
    .catch((err) => {
      if (mySeq !== s.options.seq) return;
      s.options.status = 'error';
      s.options.error = err;
      console.error('[export] field options failed:', err);
      render();
    });
}

/**
 * Every record matching the current filters, by walking pages until the server
 * runs out.
 *
 * The walk asks for the same query the count did, so what downloads is exactly
 * what the card promised. `maxPages` is a circuit breaker against a server bug
 * that always reports more rows, not a business limit — the export caps are
 * checked before this ever runs.
 *
 * @returns {Promise<Array<Object>>}
 */
async function fetchAllMatching(module, selection) {
  const query = module.toQuery(selection);
  const records = [];

  for (let page = 1; page <= WALK_MAX_PAGES; page++) {
    const data = await api.call(module.action, {
      ...query,
      page,
      page_size: WALK_PAGE_SIZE,
    });

    const batch = data[module.resultKey] || [];
    records.push(...batch);

    if (batch.length === 0 || records.length >= data.total_matching) break;

    if (page === WALK_MAX_PAGES) {
      console.warn('[export] page walk hit its cap at', records.length, 'rows');
    }
  }

  return records;
}

/* ---------- Rendering ----------------------------------------------------- */

function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

/** One filter control, drawn from its definition. */
function renderFilter(filter, selection, options) {
  const id = 'export-filter-' + filter.key;
  const current = selection[filter.key] || '';

  if (filter.kind === 'checkbox') {
    return `
      <label class="check">
        <input type="checkbox" id="${id}" data-filter="${escapeHtml(filter.key)}"
               ${selection[filter.key] ? 'checked' : ''}>
        ${escapeHtml(t(filter.labelKey))}
      </label>`;
  }

  let entries;
  if (filter.kind === 'list') {
    // Inactive options still appear when one is currently selected: a filter
    // that silently drops the value it filters by would export the wrong set.
    entries = ((options && options[filter.listKey]) || [])
      .filter((o) => o.active || o.option_value === current)
      .map((o) => option(o.option_value, o.option_value, current))
      .join('');
  } else {
    entries = filter.options.map((o) => option(o.value, t(o.labelKey), current)).join('');
  }

  return `
    <div class="field">
      <label for="${id}">${escapeHtml(t(filter.labelKey))}</label>
      <select id="${id}" data-filter="${escapeHtml(filter.key)}">
        ${option('', t('filter_all'), current)}
        ${entries}
      </select>
    </div>`;
}

/** The match count, or what is standing in for it. */
function renderCount(s) {
  if (s.count.status === 'error') {
    return `<span class="count-error">${escapeHtml(
      t('err_' + ((s.count.error && s.count.error.code) || 'server_error'))
    )}</span>`;
  }
  if (s.count.status !== 'ready') return escapeHtml(t('loading_data'));

  return escapeHtml(t('export_match_count', { count: s.count.value }));
}

/** One format card. Disabled with a reason when the count puts it out of range. */
function renderFormatCard(format, icon, s) {
  const count = s.count.status === 'ready' ? s.count.value : 0;
  const blocked = s.count.status === 'ready' ? exportBlockReason(format, count) : t('loading_data');
  const busy = s.busy === format;

  return `
    <button type="button" class="ex-card" data-format="${escapeHtml(format)}"
            ${blocked || busy ? 'disabled' : ''}>
      <div class="ex-icon">${icon}</div>
      <div class="ex-body">
        <div class="ex-name">${escapeHtml(t('export_' + format))}</div>
        <div class="ex-desc">${escapeHtml(t('export_' + format + '_desc'))}</div>
        ${busy ? `<div class="ex-note">${escapeHtml(t('export_preparing'))}</div>` : ''}
        ${blocked && !busy ? `<div class="ex-warn">${escapeHtml(blocked)}</div>` : ''}
      </div>
    </button>`;
}

/**
 * The export page.
 *
 * @returns {string} HTML
 */
export function renderExportPage() {
  const s = pageState();
  const modules = visibleModules();

  if (modules.length === 0) {
    return `<div class="page-placeholder">${escapeHtml(t('dash_no_modules'))}</div>`;
  }

  const module = moduleFor(s.module);
  const selection = selectionFor(module.key);
  const options = s.options.data;

  return `
    <div class="export-page">
      <div class="page-head">
        <div>
          <div class="page-head-sub">${escapeHtml(t('export_intro'))}</div>
        </div>
      </div>

      ${modules.length > 1 ? `
        <div class="tabs" role="tablist">
          ${modules.map((entry) => `
            <button type="button" role="tab" class="tab${entry.key === module.key ? ' active' : ''}"
                    aria-selected="${entry.key === module.key}"
                    data-export-module="${escapeHtml(entry.key)}">${escapeHtml(t(entry.labelKey))}</button>`).join('')}
        </div>` : ''}

      <div class="filter-bar">
        ${module.filters.map((filter) => renderFilter(filter, selection, options)).join('')}
        <div class="count">${renderCount(s)}</div>
      </div>

      <div class="export-cards">
        ${renderFormatCard('report', '▦', s)}
        ${renderFormatCard('excel', '▤', s)}
        ${renderFormatCard('csv', '▥', s)}
        ${renderFormatCard('pdf', '▨', s)}
      </div>

      <p class="export-note">${escapeHtml(t('export_caps_note', {
        pdf: PDF_ROW_CAP, spreadsheet: SPREADSHEET_ROW_CAP,
      }))}</p>
    </div>`;
}

/* ---------- Running an export --------------------------------------------- */

async function runExport(format) {
  const s = pageState();
  if (s.busy) return;

  const module = moduleFor(s.module);
  if (!module) return;

  const selection = selectionFor(module.key);

  s.busy = format;
  render();

  try {
    const records = await fetchAllMatching(module, selection);

    // Re-check against the set actually in hand rather than the count that was
    // on screen when the card was drawn — someone else may have added rows
    // between the probe and the walk.
    const blocked = exportBlockReason(format, records.length);
    if (blocked) {
      toast(blocked, 'error');
      return;
    }

    if (format === 'report') {
      exportToReport(records, {
        sheetName: module.sheetName,
        filePrefix: module.filePrefix,
        dashboardName: t('export_sheet_dashboard'),
        sections: module.report.sections(records, selection, module),
        omitColumn: omitReportColumn,
      });
    } else if (format === 'excel') {
      exportToExcel(records, { sheetName: module.sheetName, filePrefix: module.filePrefix });
    } else if (format === 'csv') {
      exportToCSV(records, { filePrefix: module.filePrefix });
    } else {
      exportToPDF(records, {
        filePrefix: module.filePrefix + '-Cards',
        title: module.pdf.title,
        subtitle: module.pdf.subtitle,
        sections: module.pdf.sections,
      });
    }
  } catch (err) {
    console.error('[export] export failed:', err);
    toastError(err);
  } finally {
    s.busy = '';
    render();
  }
}

/* ---------- Events -------------------------------------------------------- */

export function bindExportPageEvents() {
  const root = document.querySelector('.export-page');
  if (!root) return;

  const s = pageState();
  const module = moduleFor(s.module);
  if (!module) return;

  ensureOptions();
  ensureCount();

  root.querySelectorAll('[data-export-module]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (s.module === btn.dataset.exportModule) return;

      s.module = btn.dataset.exportModule;
      s.count.status = 'idle';   // a different module is a different question
      render();
    });
  });

  const selection = selectionFor(module.key);

  root.querySelectorAll('[data-filter]').forEach((control) => {
    control.addEventListener('change', () => {
      selection[control.dataset.filter] = control.type === 'checkbox'
        ? control.checked
        : control.value;

      s.count.status = 'idle';
      render();
    });
  });

  root.querySelectorAll('.ex-card[data-format]').forEach((card) => {
    card.addEventListener('click', () => runExport(card.dataset.format));
  });
}
