/* ==========================================================================
   format.js — pure display helpers. No state, no DOM, no API.

   One rule worth stating plainly: nothing here derives compliance. Cert states
   and verdicts come from the server's `derived` block (rule: the server
   derives, the frontend displays). daysUntil below counts days for a label
   like "12 days left" — it never decides whether that is urgent.
   ========================================================================== */

import { getLanguage } from '../i18n/i18n.js';

/**
 * Escape a value for safe interpolation into an HTML template literal.
 *
 * Every piece of server data that reaches innerHTML goes through this — the app
 * renders by string concatenation, so an unescaped apostrophe in a name is a
 * broken page and an unescaped tag is an injection.
 *
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * First letters of the first two words of a name, for an avatar bubble.
 *
 * Works the same in Arabic — it takes whatever the first characters are without
 * assuming a script, and the browser lays them out per the document direction.
 *
 * @param {string} name e.g. 'Ahmed Hassan'
 * @returns {string} e.g. 'AH'
 */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/** Placeholder shown wherever a value is empty. */
export const EMPTY_MARK = '—';

/**
 * Format an ISO date ('YYYY-MM-DD') as 'DD MMM YYYY' — Gregorian in both
 * languages, per Section 8.1. Empty or unparseable input renders as an em dash
 * rather than 'Invalid Date'.
 *
 * The date is parsed as UTC midnight and formatted in UTC, so a stored
 * '2026-08-04' cannot display as the 3rd for a user east or west of the server.
 *
 * @param {string} iso
 * @returns {string}
 */
export function fmtDate(iso) {
  const date = parseIsoDate(iso);
  if (!date) return EMPTY_MARK;

  return new Intl.DateTimeFormat(getLanguage() === 'ar' ? 'ar-EG' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Format an ISO datetime as its date part. Audit stamps are datetimes; lists
 * show them as dates.
 *
 * @param {string} iso 'YYYY-MM-DDTHH:MM:SS'
 * @returns {string}
 */
export function fmtDateTime(iso) {
  return fmtDate(String(iso || '').slice(0, 10));
}

/**
 * Whole days from today until an ISO date. Negative means it is in the past.
 *
 * Both ends are UTC midnight, matching how Compliance.gs counts, so a label
 * never disagrees with the state badge sitting next to it.
 *
 * @param {string} iso
 * @returns {number|null} null when there is no usable date
 */
export function daysUntil(iso) {
  const date = parseIsoDate(iso);
  if (!date) return null;

  const today = new Date(todayISO() + 'T00:00:00Z');
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

/**
 * Today as 'YYYY-MM-DD' in the browser's own timezone.
 *
 * Local, not UTC: this seeds date inputs and the RDT wave date, where the user
 * means the day they are standing in. UTC would hand a Cairo admin yesterday's
 * date for the first two hours after midnight.
 *
 * @returns {string}
 */
export function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** @returns {Date|null} an ISO date string as UTC midnight. */
function parseIsoDate(iso) {
  const str = String(iso || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;

  const date = new Date(str + 'T00:00:00Z');
  return Number.isNaN(date.getTime()) ? null : date;
}
