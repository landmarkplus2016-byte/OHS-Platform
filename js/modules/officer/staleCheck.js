/* ==========================================================================
   officer/staleCheck.js — the fail-closed lockout (Section 7.4, rule 18).

   One question: is the cached snapshot older than `max_stale_hours`? Three
   answers, from Section 7.4:

     within the window   normal — verdict lookups work from cache
     beyond the window   locked — every route but sync redirects to the lockout
     no cache at all     locked — sync before anything else works

   No override, no supervisor bypass. An officer who hits a lockout in the field
   leaves the site or calls a colleague; the app has no answer for them and is
   not supposed to.

   ---- Why there are two functions ----

   isCacheStale() is the real check and it is async, because the timestamp lives
   in IndexedDB. The router's guard is synchronous — render() calls it and
   immediately writes the DOM — so it cannot await anything.

   So the answer is computed asynchronously and cached in a module variable that
   isCacheStaleSync() reads. The contract:

     - boot and every sync call refreshStaleState() and await it, so the value
       is known before the first officer draw
     - the guard reads the last known value
     - until the first check completes the state is UNKNOWN, which the guard
       treats as stale — unknown freshness is not proof of freshness, and
       rule 18 says which way to fail

   The `max_stale_hours` used is the one that travelled with the snapshot, not
   the one in CONFIG. The lockout has to work with no signal, so it is judged
   against the policy that was in force at the officer's last sync.
   ========================================================================== */

import { CONFIG } from '../../state.js';
import { loadSyncedAt, ensureSnapshotLoaded } from './cache.js';

/** Section 7.4's default, used when neither the snapshot nor CONFIG says. */
const DEFAULT_MAX_STALE_HOURS = 72;

/** The three answers the guard can get. */
export const STALE_STATE = {
  UNKNOWN: 'unknown',
  FRESH: 'fresh',
  STALE: 'stale',
  NEVER_SYNCED: 'never_synced',
};

/** Last computed answer, plus the numbers the UI shows alongside it. */
let state = {
  status: STALE_STATE.UNKNOWN,
  synced_at: null,
  age_hours: null,
  max_stale_hours: DEFAULT_MAX_STALE_HOURS,
};

/* ---------- The check ----------------------------------------------------- */

/**
 * The lockout threshold in force for the officer, in hours.
 *
 * Snapshot first (it is what the server sent with the data being judged), then
 * CONFIG (a device that has never synced but has booted), then the default.
 *
 * @param {Object|null} snapshot
 * @returns {number}
 */
function maxStaleHours(snapshot) {
  const candidates = [
    snapshot && snapshot.max_stale_hours,
    CONFIG && CONFIG.max_stale_hours,
    DEFAULT_MAX_STALE_HOURS,
  ];

  for (const value of candidates) {
    const hours = Number(value);
    if (Number.isFinite(hours) && hours > 0) return hours;
  }
  return DEFAULT_MAX_STALE_HOURS;
}

/**
 * Hours between an ISO timestamp and now, or null when it cannot be read.
 *
 * The server writes `synced_at` as 'YYYY-MM-DDTHH:MM:SS' with no zone, and
 * means UTC (Section 2, data type conventions). Date.parse would read a bare
 * datetime in the *device's* timezone, which in Cairo would make every fresh
 * sync look two or three hours old — so the 'Z' is appended when absent.
 *
 * @param {string|null} syncedAt
 * @returns {number|null}
 */
function hoursSince(syncedAt) {
  const str = String(syncedAt || '').trim();
  if (!str) return null;

  const withZone = /[Zz]$|[+-]\d{2}:\d{2}$/.test(str) ? str : str + 'Z';
  const ms = Date.parse(withZone);
  if (Number.isNaN(ms)) return null;

  return (Date.now() - ms) / 3600000;
}

/**
 * The real check: read the cache and decide (Section 7.4).
 *
 * @returns {Promise<boolean>} true when the app must lock — including when
 *          this device has never synced at all
 */
export async function isCacheStale() {
  const result = await refreshStaleState();
  return result.status !== STALE_STATE.FRESH;
}

/**
 * Recompute the cached answer. Call at boot, after every sync, and whenever the
 * officer app is about to trust the cache again.
 *
 * A cache read that throws is treated as "never synced" rather than being
 * allowed to propagate: an unreadable IndexedDB is exactly the situation where
 * the officer must not be shown a verdict.
 *
 * @returns {Promise<{status: string, synced_at: ?string, age_hours: ?number,
 *                    max_stale_hours: number}>}
 */
export async function refreshStaleState() {
  let snapshot = null;
  let syncedAt = null;

  try {
    snapshot = await ensureSnapshotLoaded();
    syncedAt = await loadSyncedAt();
  } catch (err) {
    console.error('[officer] cannot read the offline cache:', err);
    state = {
      status: STALE_STATE.NEVER_SYNCED,
      synced_at: null,
      age_hours: null,
      max_stale_hours: maxStaleHours(null),
    };
    return state;
  }

  const limit = maxStaleHours(snapshot);
  const age = hoursSince(syncedAt);

  // No snapshot, no timestamp, or a timestamp we cannot parse: all the same
  // outcome. There is nothing here that may be shown to an officer.
  if (!snapshot || age === null) {
    state = {
      status: STALE_STATE.NEVER_SYNCED,
      synced_at: syncedAt || null,
      age_hours: null,
      max_stale_hours: limit,
    };
    return state;
  }

  state = {
    status: age > limit ? STALE_STATE.STALE : STALE_STATE.FRESH,
    synced_at: syncedAt,
    age_hours: age,
    max_stale_hours: limit,
  };
  return state;
}

/* ---------- Synchronous readers (for the router guard and the shell) ------- */

/**
 * The last computed answer, without touching IndexedDB.
 *
 * @returns {{status: string, synced_at: ?string, age_hours: ?number,
 *            max_stale_hours: number}}
 */
export function getStaleState() {
  return state;
}

/**
 * The guard's question, synchronously. UNKNOWN counts as stale — see the header.
 *
 * @returns {boolean}
 */
export function isCacheStaleSync() {
  return state.status !== STALE_STATE.FRESH;
}

/** True only when this device has no usable snapshot at all. */
export function hasNeverSynced() {
  return state.status === STALE_STATE.NEVER_SYNCED;
}

/**
 * Whole days since the last sync, for the sync strip's "· 3d" hint. Null when
 * there has never been one.
 *
 * @returns {number|null}
 */
export function staleAgeDays() {
  if (state.age_hours === null) return null;
  return Math.floor(state.age_hours / 24);
}

/**
 * True when the cache is still valid but close enough to the limit to warn
 * about it — the amber banner under the sync strip in the prototype.
 *
 * "Close enough" is the last fifth of the window: 14 hours of a 72-hour policy,
 * which is a shift's notice rather than an arbitrary hour count that would mean
 * something different every time the threshold is retuned.
 *
 * @returns {boolean}
 */
export function isNearlyStale() {
  if (state.status !== STALE_STATE.FRESH || state.age_hours === null) return false;
  return state.age_hours >= state.max_stale_hours * 0.8;
}

/** Reset to UNKNOWN — sign-out, so the next officer is judged from scratch. */
export function resetStaleState() {
  state = {
    status: STALE_STATE.UNKNOWN,
    synced_at: null,
    age_hours: null,
    max_stale_hours: DEFAULT_MAX_STALE_HOURS,
  };
}
