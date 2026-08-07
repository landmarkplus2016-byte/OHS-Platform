/* ==========================================================================
   importSpecs.js — what a spreadsheet column is allowed to be called.

   One entry per importable Sheet column: where the value lands, how to read the
   cell, and every spelling seen in the wild. Aliases are matched against
   normHeader() from js/utils/excelImport.js, so they are written already
   normalised — lowercase, no punctuation, digits spaced off letters.

   Ported from OHS-DB's COLUMNS table, with the targets flattened: OHS-DB set
   nested paths (`personal.subcontractor`), the platform's Sheet columns are
   flat (Section 2), so a target is just a column name.

   WHY THIS IS ITS OWN FILE
   ------------------------
   It is data, not page logic, and two hundred lines of alias tables inside
   settingsPage.js would bury the tab it belongs to. It sits in js/constants/
   next to globals.js for the same reason that file exists: values more than one
   caller needs and no single module owns. The shell reads it today; a
   module-owned import UI could read the same table tomorrow.

   ADDING A SPELLING
   -----------------
   A header the matcher does not recognise is reported as a warning, never
   dropped silently — so the first real import surfaces the miss, and the fix is
   one string in the `aliases` array below.
   ========================================================================== */

import { MODULE_NAMES } from './globals.js';
import { inList } from '../utils/excelImport.js';

/* ---------- Employees (Section 3.5) --------------------------------------- */

/** cert key → the aliases its expiry column answers to. */
const CERT_ALIASES = {
  wah_practical: [
    'wah expiry date practical', 'wah practical', 'wah practical expiry date',
    'work at height practical', 'work at height practical expiry date',
    'wah p', 'practical wah',
  ],
  wah_theoretical: [
    'wah expiry date theoretical', 'wah theoretical', 'wah theoretical expiry date',
    'work at height theoretical', 'work at height theoretical expiry date',
    'wah t', 'theoretical wah',
  ],
  ra: ['ra expiry date', 'ra', 'ra expiry', 'risk assessment', 'risk assessment expiry date'],
  fa: ['fa expiry date', 'fa', 'fa expiry', 'first aid', 'first aid expiry date'],
  ff: ['ff expiry date', 'ff', 'ff expiry', 'fire fighting', 'firefighting', 'fire fighting expiry date'],
  ec: [
    'ec expiry date', 'ec', 'ec expiry', 'emergency coordinator',
    'emergency coordinator expiry date', 'emergency co ordinator', 'emergency care',
  ],
  mcu: [
    'mcu expiry date', 'mcu', 'mcu expiry', 'medical check up', 'medical checkup',
    'medical check up expiry date', 'medical',
  ],
  ppe: ['ppe inspection', 'ppe', 'ppe expiry date', 'ppe inspection expiry date', 'ppe inspection date'],
  lifting: ['lifting', 'lifting expiry date', 'lifting expiry', 'lifting equipment', 'lifting inspection'],
  scaffolding: ['scaffolding', 'scaffold', 'scaffolding expiry date', 'scaffolding expiry'],
};

/**
 * Certificate *link* columns are deliberately absent.
 *
 * A Drive URL pasted into a spreadsheet cell is the single most common way to
 * import a broken link, and the platform never fetches the file to find out
 * (Non-Goals: file uploads). Links are added on the employee form, one at a
 * time, by someone who just clicked it.
 */
const EMPLOYEE_COLUMNS = [
  { field: 'national_id', type: 'text', aliases: [
    'national id', 'national i d', 'nationalid', 'nid', 'natid',
    'national id number', 'id number', 'national number',
  ] },
  { field: 'name', type: 'text', aliases: [
    'name', 'full name', 'employee name', 'employee full name',
  ] },
  { field: 'team', type: 'enum', aliases: ['team', 'employee team', 'roster'] },

  { field: 'employment_status', type: 'text', aliases: [
    'status', 'employment status', 'employee status', 'work status',
  ] },
  { field: 'title', type: 'text', aliases: [
    'title', 'job title', 'position', 'job position', 'designation',
  ] },
  { field: 'contractor', type: 'text', aliases: ['contractor', 'main contractor'] },
  { field: 'subcontractor', type: 'text', aliases: [
    'subcontractor', 'sub contractor', 'subcon', 'sub con', 'sub company',
  ] },
  { field: 'hired_date', type: 'date', aliases: [
    'hired date', 'hire date', 'date of hire', 'hiring date', 'date of hiring',
    'joining date', 'date of joining',
  ] },
  { field: 'legal_permission', type: 'text', aliases: [
    'legal permission approval', 'legal permission', 'legal permission status',
    'legal approval', 'legal',
  ] },

  ...Object.keys(CERT_ALIASES).map((key) => ({
    field: 'cert_' + key + '_expiry',
    type: 'date',
    aliases: CERT_ALIASES[key],
  })),

  { field: 'qual_nebosh', type: 'bool', aliases: ['nebosh', 'nebosh igc', 'nebosh i g c'] },
  { field: 'qual_iso_45001', type: 'bool', aliases: ['iso', 'iso 45001', 'iso 45001 lead auditor'] },
  { field: 'qual_osha', type: 'bool', aliases: ['osha', 'osha 30', 'osha certificate'] },

  /* No RDT columns. Drug tests are events on the RdtLog tab, not employee
     columns, and there is no import path for them — a test is created by the
     monthly selection on #/rdt and completed there. A legacy spreadsheet that
     still carries RDT-shaped columns imports fine; those columns map to nothing
     and are ignored. */
];

/* ---------- Equipment (Section 3.6) --------------------------------------- */

const EQUIPMENT_COLUMNS = [
  { field: 'serial_no', type: 'text', aliases: [
    'serial no', 'serial number', 'serial', 'sn', 'equipment serial', 'equipment serial no',
  ] },
  { field: 'third_party_sn', type: 'text', aliases: [
    'third party sn', 'third party serial', 'third party serial no',
    'third party serial number', '3rd party sn', '3rd party serial', 'tp sn',
  ] },
  { field: 'item', type: 'text', aliases: ['item', 'item type', 'equipment', 'equipment type', 'type'] },
  { field: 'brand', type: 'text', aliases: ['brand', 'make', 'manufacturer'] },
  { field: 'date_of_manufacture', type: 'date', aliases: [
    'date of manufacture', 'manufacture date', 'manufacturing date', 'dom', 'made on',
  ] },
  { field: 'third_party_inspection_end_date', type: 'date', aliases: [
    'third party inspection end date', 'third party inspection', 'third party expiry',
    'third party end date', 'inspection end date', 'inspection expiry',
    '3rd party inspection end date', 'certificate expiry',
  ] },
  { field: 'team_leader_id', type: 'text', aliases: [
    'team leader id', 'team leader', 'leader id', 'assigned to', 'employee id', 'holder',
  ] },

  { field: 'wave_1_date', type: 'date', aliases: ['wave 1 date', 'wave 1', 'w 1 date', 'first wave date'] },
  { field: 'wave_1_result', type: 'enum', aliases: ['wave 1 result', 'w 1 result', 'first wave result'] },
  { field: 'wave_2_date', type: 'date', aliases: ['wave 2 date', 'wave 2', 'w 2 date', 'second wave date'] },
  { field: 'wave_2_result', type: 'enum', aliases: ['wave 2 result', 'w 2 result', 'second wave result'] },
  { field: 'wave_3_date', type: 'date', aliases: ['wave 3 date', 'wave 3', 'w 3 date', 'third wave date'] },
  { field: 'wave_3_result', type: 'enum', aliases: ['wave 3 result', 'w 3 result', 'third wave result'] },

  { field: 'comments', type: 'text', aliases: ['comments', 'comment', 'notes', 'remarks'] },
];

/* ---------- The specs ------------------------------------------------------ */

/**
 * Everything an import of one module needs.
 *
 *   columns          the alias table above
 *   sheets           sheet-name rules; each match forces `defaults` onto its rows
 *   derive           optional; fills in fields no column or default supplied,
 *                    before the preview validates the row
 *   identityColumns  at least one must be non-empty or the row is not a record
 *   duplicateKey     the value the server keys duplicates on
 *   identify         a record's primary key, for "duplicate of LM-EMP-0007"
 *   describe         a human label for one row of the preview
 *   optionColumns    columns validated against a FieldOptions list
 *
 * `addable: false` on an option column means an unknown value there can never
 * be added to the list. That mirrors the server: EMPLOYEE_AUTO_ADD_FIELDS
 * excludes employment_status and legal_permission because the verdict rules key
 * off the exact strings 'Active' and 'Approved' (Section 6.2), so a misspelling
 * must fail the import rather than quietly become a new option that blocks
 * everyone carrying it.
 */
export const IMPORT_SPECS = {
  [MODULE_NAMES.EMPLOYEES]: {
    module: MODULE_NAMES.EMPLOYEES,
    labelKey: 'module_employees',
    action: 'bulk_import_employees',
    listAction: 'list_employees',
    listResultKey: 'employees',
    columns: EMPLOYEE_COLUMNS,

    // The legacy Landmark workbook is one tab per team with no team column, so
    // the tab name is what sets it. A workbook that carries its own `team`
    // column works too — the column is read after the default is applied.
    //
    // The third tab holds the people who have left. It is the one tab whose
    // rows arrive already archived, which is why `archived` is a default here
    // and nowhere else: everywhere else in the API that flag is the server's
    // (Section 3.9), and `bulk_import_employees` honours it on a create only —
    // re-importing this workbook can never bury or resurrect anybody.
    sheets: [
      { aliases: ['field team', 'field', 'field team data', 'field employees'],
        defaults: { team: 'field' } },
      { aliases: ['safety team', 'safety', 'safety team data', 'safety employees'],
        defaults: { team: 'safety' } },
      { aliases: [
        'resigned', 'terminated', 'resigned terminated', 'resigned and terminated',
        'ex employees', 'former employees', 'leavers', 'archive', 'archived',
      ], defaults: { archived: 'TRUE' } },
    ],

    /**
     * Fills in what a tab could not say for itself, before the row is previewed.
     *
     * The resigned tab carries no team, and unlike the other two its name cannot
     * supply one — the people on it left from both teams. The title is the only
     * evidence in the row, so a title that appears in `safety_titles` reads as
     * safety and everything else reads as field. A blank title is field: the
     * safety roster is the small, explicitly-named one, so an unknown is far
     * more likely to belong to the other.
     *
     * Runs before the dropdown checks in buildImportPreview, because the titles
     * list a row is validated against depends on the team decided here.
     *
     * Returns a new record — `buildImportPreview` promises to mutate nothing.
     */
    derive: (record, fieldOptions) => {
      if (record.team) return record;

      const isSafety = Boolean(record.title)
        && inList(fieldOptions && fieldOptions.safety_titles, record.title);

      return { ...record, team: isSafety ? 'safety' : 'field' };
    },

    identityColumns: ['national_id', 'name'],
    duplicateKey: (record) => record.national_id,
    identify: (record) => record.employee_id,
    describe: (record) => record.name || record.national_id || '',

    optionColumns: [
      { field: 'title', labelKey: 'emp_field_title', addable: true,
        listKey: (record) => (record.team === 'safety' ? 'safety_titles' : 'field_titles') },
      { field: 'contractor', labelKey: 'emp_field_contractor', addable: true, listKey: 'contractors' },
      { field: 'subcontractor', labelKey: 'emp_field_subcontractor', addable: true, listKey: 'subcontractors' },
      { field: 'employment_status', labelKey: 'emp_field_employment_status', addable: false, listKey: 'employment_status' },
      { field: 'legal_permission', labelKey: 'emp_field_legal_permission', addable: false, listKey: 'legal_permission' },
    ],
  },

  [MODULE_NAMES.EQUIPMENT]: {
    module: MODULE_NAMES.EQUIPMENT,
    labelKey: 'module_equipment',
    action: 'bulk_import_equipment',
    listAction: 'list_equipment',
    listResultKey: 'equipment',
    columns: EQUIPMENT_COLUMNS,

    // No sheet rules: equipment has no per-team split, so the first sheet is
    // the sheet.
    sheets: null,

    identityColumns: ['serial_no', 'third_party_sn'],
    duplicateKey: (record) => record.serial_no,
    identify: (record) => record.equipment_id,
    describe: (record) => [record.item, record.serial_no].filter(Boolean).join(' — '),

    optionColumns: [
      { field: 'item', labelKey: 'eqp_field_item', addable: true, listKey: 'equipment_items' },
      { field: 'brand', labelKey: 'eqp_field_brand', addable: true, listKey: 'equipment_brands' },
    ],
  },
};
