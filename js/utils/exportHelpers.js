/* ==========================================================================
   exportHelpers.js — Excel, CSV and PDF writers.

   Adapted from OHS-DB's file of the same name, with one change that matters:
   OHS-DB flattened a nested employee object into columns by hand, so the util
   had to know every certificate key. Here the server already returns flat Sheet
   columns (shapeEmployee_ / shapeEquipment_), so the column set is *derived from
   the records themselves* — this file names no field of any module and stays
   correct when the schema grows.

   Uses the CDN globals window.XLSX and window.jspdf loaded by index.html. Never
   an npm package.

   THE ROUND TRIP
   --------------
   Excel and CSV headers are the raw Sheet column names, untranslated. That is
   deliberate: `bulk_import_employees` expects those names, so an export is
   already a valid import file. Translated labels appear only in the PDF, which
   is for reading rather than re-importing.

   CAPS
   ----
   The two limits below are OHS-DB's, unchanged. They are enforced by the caller
   before it ever gets here — an export is refused, never silently truncated.
   ========================================================================== */

import { t } from '../i18n/i18n.js';
import { fmtDate, todayISO } from './format.js';

/** Rows per spreadsheet, matching the server's bulk-import cap. */
export const SPREADSHEET_ROW_CAP = 5000;

/** Records per PDF. One page each, so this is a page count as much as a row cap. */
export const PDF_ROW_CAP = 100;

/** Columns never written to a spreadsheet: the derived block is flattened instead. */
const DERIVED_KEY = 'derived';

/**
 * Fields inside `derived` worth a column. Everything else in there is an object
 * or an array — per_cert, blockers, warnings — which has no honest spreadsheet
 * representation and belongs in the PDF or the app.
 */
const DERIVED_SCALARS = [
  'verdict', 'worst_state', 'third_party_state', 'expired_count', 'expiring_soon_count',
];

/** Triggers a client-side download from an in-memory string. */
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** `OHS-Employees-2026-08-05.xlsx` */
function filenameFor(prefix, extension) {
  return `OHS-${prefix}-${todayISO()}.${extension}`;
}

/**
 * One record as a flat row of primitives.
 *
 * Booleans become TRUE/FALSE to match how the Sheet stores them (Section 2), so
 * a round trip through Excel and back reads identically. The derived block is
 * replaced by its scalar fields under a `derived_` prefix — present for
 * reference, and ignored by the import because the server owns those columns.
 *
 * @param {Object} record  an employee or equipment object from the API
 * @returns {Object}
 */
export function flattenForSpreadsheet(record) {
  const row = {};

  Object.keys(record).forEach((key) => {
    if (key === DERIVED_KEY) return;

    const value = record[key];
    if (value === null || value === undefined) row[key] = '';
    else if (typeof value === 'boolean') row[key] = value ? 'TRUE' : 'FALSE';
    else if (typeof value === 'object') return;   // nothing else should be here
    else row[key] = value;
  });

  const derived = record[DERIVED_KEY] || {};
  DERIVED_SCALARS.forEach((key) => {
    if (derived[key] === undefined) return;
    row['derived_' + key] = derived[key];
  });

  return row;
}

/**
 * Every column across the whole set, in first-seen order.
 *
 * Taking the union rather than the first record's keys matters for employees:
 * the server sends every column on every row, but a future partial shape would
 * otherwise lose a column that only some records carry.
 *
 * @param {Array<Object>} rows  already flattened
 * @returns {Array<string>}
 */
function unionColumns(rows) {
  const seen = [];
  const known = new Set();

  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (known.has(key)) return;
      known.add(key);
      seen.push(key);
    });
  });

  return seen;
}

/** A worksheet with a stable column order and no missing cells. */
function toSheet(records) {
  const rows = records.map(flattenForSpreadsheet);
  const header = unionColumns(rows);

  const filled = rows.map((row) => {
    const out = {};
    header.forEach((key) => { out[key] = row[key] === undefined ? '' : row[key]; });
    return out;
  });

  return window.XLSX.utils.json_to_sheet(filled, { header });
}

/**
 * Download an .xlsx.
 *
 * @param {Array<Object>} records
 * @param {{sheetName: string, filePrefix: string}} spec
 */
export function exportToExcel(records, spec) {
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, toSheet(records), spec.sheetName);

  window.XLSX.writeFile(workbook, filenameFor(spec.filePrefix, 'xlsx'));
}

/**
 * Download a .csv with the same columns as the Excel export.
 *
 * A BOM is prepended so Excel opens Arabic subcontractor names as UTF-8 rather
 * than as mojibake in the system codepage.
 *
 * @param {Array<Object>} records
 * @param {{filePrefix: string}} spec
 */
export function exportToCSV(records, spec) {
  const csv = window.XLSX.utils.sheet_to_csv(toSheet(records));

  downloadBlob('﻿' + csv, filenameFor(spec.filePrefix, 'csv'), 'text/csv;charset=utf-8;');
}

/**
 * Download a PDF with one page per record.
 *
 * The caller supplies the page shape, because what belongs on an employee card
 * and what belongs on an equipment card is module knowledge and this file has
 * none:
 *
 *   title(record)     the heading line
 *   subtitle(record)  the grey line under it
 *   sections(record)  [{heading, rows: [[label, value], ...]}]
 *
 * Empty sections are dropped rather than printed as an empty table — a field
 * team employee has no qualifications section at all, rather than a blank one.
 *
 * @param {Array<Object>} records
 * @param {{filePrefix: string, title: function, subtitle: function, sections: function}} spec
 */
export function exportToPDF(records, spec) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // The navy from tokens.css. jsPDF takes RGB triples and cannot read a CSS
  // variable, so this is the one place a colour is written out — it is a
  // document instruction, not a stylesheet rule (rule 15).
  const headStyles = { fillColor: [15, 25, 66], textColor: 255, fontStyle: 'bold' };

  records.forEach((record, index) => {
    if (index > 0) doc.addPage();

    doc.setFontSize(16);
    doc.setTextColor(0);
    doc.text(String(spec.title(record) || ''), 14, 18);

    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(String(spec.subtitle(record) || ''), 14, 25);
    doc.setTextColor(0);

    let y = 32;
    spec.sections(record).forEach((section) => {
      if (!section || !section.rows || section.rows.length === 0) return;

      doc.autoTable({
        startY: y,
        theme: 'grid',
        headStyles,
        head: [[section.heading, section.valueHeading || '']],
        body: section.rows,
      });

      y = doc.lastAutoTable.finalY + 4;
    });
  });

  doc.save(filenameFor(spec.filePrefix, 'pdf'));
}

/**
 * A date for a PDF cell: formatted, or an em dash.
 *
 * Exported because every module's `sections` builder needs it and none of them
 * should each invent their own empty-date placeholder.
 *
 * @param {string} iso
 * @returns {string}
 */
export function pdfDate(iso) {
  return iso ? fmtDate(iso) : '—';
}

/** A yes/no for a PDF cell. */
export function pdfFlag(value) {
  return value ? '✓' : '—';
}

/** A plain value for a PDF cell, with an em dash for anything empty. */
export function pdfText(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text === '' ? '—' : text;
}

/**
 * Why a format cannot run at this record count, or '' when it can.
 *
 * Having nothing to export blocks as firmly as having too much — a zero-row
 * spreadsheet is a support call, not a download.
 *
 * @param {string} format 'excel' | 'csv' | 'pdf'
 * @param {number} count
 * @returns {string} already-translated reason, or ''
 */
export function exportBlockReason(format, count) {
  if (count === 0) return t('export_empty');
  if (format === 'pdf' && count > PDF_ROW_CAP) return t('export_limit_pdf', { cap: PDF_ROW_CAP });
  if (format !== 'pdf' && count > SPREADSHEET_ROW_CAP) {
    return t('export_limit_spreadsheet', { cap: SPREADSHEET_ROW_CAP });
  }
  return '';
}
