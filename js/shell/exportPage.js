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

   CAPS
   ----
   OHS-DB's limits, unchanged: 100 records for PDF, 5,000 for Excel and CSV.
   Over the cap the format's card is disabled with a visible reason. An export
   is never silently truncated.
   ========================================================================== */

import { UI } from '../state.js';
import { api } from '../api.js';
import { render } from '../render.js';
import { t } from '../i18n/i18n.js';
import { escapeHtml } from '../utils/format.js';
import { canView } from '../utils/permissions.js';
import { MODULE_NAMES } from '../constants/globals.js';
import { toast, toastError } from '../components/toast.js';
import {
  exportToExcel, exportToCSV, exportToPDF, exportBlockReason,
  pdfDate, pdfFlag, pdfText, SPREADSHEET_ROW_CAP, PDF_ROW_CAP,
} from '../utils/exportHelpers.js';

/** Page size for the walk that fetches the full set. The server caps at 200. */
const WALK_PAGE_SIZE = 200;

/** Circuit breaker: 5,000 rows is the export cap, so 25 pages can always cover it. */
const WALK_MAX_PAGES = 25;

/* ---------- Per-module export definitions --------------------------------- */

/**
 * The six certificate states, worst first — the compliance filter's options.
 * Repeated from the employees module's constants rather than imported, for the
 * reason in the header.
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
          {
            heading: t('emp_section_drug'),
            rows: e.team === 'safety'
              ? [[t('emp_field_rdt'), pdfDate(e.rdt)]]
              : [
                [t('emp_field_rdt_1'), pdfDate(e.rdt_1)],
                [t('emp_field_rdt_2'), pdfDate(e.rdt_2)],
              ],
          },
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
      if (selection.worst_state) filters.worst_state = selection.worst_state;

      return {
        include_rejected: !!selection.include_rejected,
        filters,
      };
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
          <div class="page-head-title">${escapeHtml(t('nav_export'))}</div>
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

    if (format === 'excel') {
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
