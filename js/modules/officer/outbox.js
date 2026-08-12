/* ==========================================================================
   officer/outbox.js — inspection waves waiting for signal.

   The officer app exists because officers work at tower sites, and tower sites
   are where there is no signal. A wave that could only be submitted online would
   be unusable in exactly the place it is meant to be used, so a submission that
   cannot reach the server is written here and sent when the phone next can.

   This is the platform's only write queue, and it is scoped as narrowly as it
   can be: one action, one row type, no updates, no deletes. Admin writes are
   still never queued (a non-goal in CLAUDE.md) — admins have desks.

   ---- What makes a retry safe ----

   Every entry carries a `client_id`, generated here when the wave is queued and
   sent with every attempt. The server stores it and refuses a second row for the
   same key, returning the one it already has.

   That is not belt-and-braces. The dangerous failure is not "the request
   failed" — it is "the request succeeded and the answer never arrived", which on
   a phone at the edge of coverage is routine. Without the key, that entry is
   still in the queue, gets sent again, and a second inspection appears against
   the same item on the same day. Nobody would ever catch it.

   ---- Why entries are removed on validation_failed ----

   A flush stops on `network_error` and keeps everything: there is still no
   signal, and the queue is doing its job. But a `validation_failed` or
   `not_found` will fail identically forever — the item was rejected, or the
   payload is malformed — so the entry is dropped and surfaced. A queue that
   retries an impossible write forever is a queue that hides it.
   ========================================================================== */

import { api } from '../../api.js';
import { openDb } from './cache.js';

/** The object store added in DB_VERSION 2. Keyed by `client_id`. */
const STORE = 'outbox';

/** How many times one entry is retried before it is parked for the officer. */
const MAX_ATTEMPTS = 8;

/**
 * Pause between sends during a flush, in ms.
 *
 * Section 3.9 rate-limits a session to 60 actions a minute. A backlog fired as
 * fast as the phone can manage would trip it and turn a successful flush into a
 * string of `rate_limited` answers, so sends are spaced.
 */
const SEND_GAP_MS = 250;

/** Mirror of the queue for synchronous `page()` reads, same shape as cache.js. */
let pendingCache = [];

/* ---------- Store access -------------------------------------------------- */

/**
 * Every queued entry, oldest first.
 *
 * @returns {Promise<Array<Object>>}
 */
export async function listPending() {
  const db = await openDb();

  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  rows.sort((a, b) => String(a.queued_at).localeCompare(String(b.queued_at)));
  pendingCache = rows;
  return rows;
}

/** @private One write, resolving on transaction commit like cache.js does. */
async function putEntry(entry) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry, entry.client_id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Outbox write aborted'));
  });
}

/** @private */
async function deleteEntry(clientId) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(clientId);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Outbox delete aborted'));
  });
}

/**
 * Queue one wave for sending.
 *
 * @param {{equipment_id: string, wave_date: string, result: string, comments?: string}} wave
 * @returns {Promise<Object>} the stored entry
 */
export async function queueWave(wave) {
  const entry = {
    // crypto.randomUUID is available in every browser that has the service
    // worker and IndexedDB this app already requires; the fallback covers an
    // insecure-context dev server, where `crypto` is not exposed.
    client_id: (self.crypto && self.crypto.randomUUID)
      ? self.crypto.randomUUID()
      : 'cid-' + Date.now() + '-' + Math.random().toString(16).slice(2),

    equipment_id: wave.equipment_id,
    wave_date: wave.wave_date,
    result: wave.result,
    comments: wave.comments || '',

    queued_at: new Date().toISOString(),
    attempts: 0,
    last_error: '',
  };

  await putEntry(entry);
  await listPending();
  return entry;
}

/** Remove one entry — used when a send succeeds, or is permanently refused. */
export async function discardWave(clientId) {
  await deleteEntry(clientId);
  await listPending();
}

/* ---------- Synchronous readers (for `page()` functions) ------------------ */

/**
 * The queue as it stands in memory. Pages render synchronously and cannot
 * await, exactly as with the snapshot mirror in cache.js.
 *
 * @returns {Array<Object>}
 */
export function getPendingWaves() {
  return pendingCache;
}

/** How many waves are waiting. Drives the badge on the home screen. */
export function pendingCount() {
  return pendingCache.length;
}

/**
 * The queued waves for one item, newest first.
 *
 * @param {string} equipmentId
 * @returns {Array<Object>}
 */
export function pendingWavesFor(equipmentId) {
  return pendingCache
    .filter((entry) => entry.equipment_id === equipmentId)
    .sort((a, b) => String(b.queued_at).localeCompare(String(a.queued_at)));
}

/** Read the queue into memory once. Safe to call on every bind. */
export function ensureOutboxLoaded() {
  return listPending();
}

/** Empty the mirror on sign-out. The store itself is cleared by cacheClear(). */
export function resetOutbox() {
  pendingCache = [];
}

/* ---------- Flushing ------------------------------------------------------ */

/** @private A promise while a flush is running, so two cannot overlap. */
let flushing = null;

/** @private */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send everything queued, oldest first.
 *
 * Never rejects. A flush runs in the background — on mount, on `online`, after a
 * sync — and a rejected promise nobody is awaiting is a console error and
 * nothing else. The outcome comes back as counts instead.
 *
 * @returns {Promise<{sent: number, failed: number, remaining: number, offline: boolean}>}
 */
export function flushOutbox() {
  if (flushing) return flushing;

  flushing = runFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** @private Guards the one-time `online` registration below. */
let autoFlushInstalled = false;

/**
 * Flush whenever the phone regains connectivity.
 *
 * Registered once and never removed — it outlives any single page, which is the
 * point: an officer walks out of a dead zone with the app open on a verdict card
 * and the queue should empty itself without them thinking about it.
 *
 * `navigator.onLine` is not consulted anywhere else in this file. It reports
 * whether the device has *a* network, not whether Apps Script is reachable, and
 * at a tower those differ often enough that trusting it would strand waves. The
 * event is a useful hint to try again; the attempt itself is the real test.
 *
 * @param {function(Object): void} [onFlushed] called with the flush result
 */
export function installOutboxAutoFlush(onFlushed) {
  if (autoFlushInstalled) return;
  autoFlushInstalled = true;

  window.addEventListener('online', () => {
    flushOutbox()
      .then((result) => {
        if (result.sent > 0 || result.failed > 0) {
          console.log('[officer] auto-flush on reconnect:', result);
          if (typeof onFlushed === 'function') onFlushed(result);
        }
      })
      .catch((err) => console.error('[officer] auto-flush failed:', err));
  });
}

/** @private */
async function runFlush() {
  let sent = 0;
  let failed = 0;
  let offline = false;

  let entries;
  try {
    entries = await listPending();
  } catch (err) {
    console.error('[officer] cannot read the outbox:', err);
    return { sent: 0, failed: 0, remaining: 0, offline: false };
  }

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];

    if (i > 0) await sleep(SEND_GAP_MS);

    try {
      await api.call('officer_record_wave', {
        equipment_id: entry.equipment_id,
        wave_date: entry.wave_date,
        result: entry.result,
        comments: entry.comments,
        client_id: entry.client_id,
      });

      await discardWave(entry.client_id);
      sent += 1;
    } catch (err) {
      const code = err && err.code;

      // Still no signal. Everything left stays queued, and the flush stops
      // rather than working through a list that will all fail the same way.
      if (code === 'network_error') {
        offline = true;
        break;
      }

      // api.js has already cleared the session and routed to the sign-in card.
      // The queue survives — only sign-out clears it — and flushes again once
      // the officer is back in.
      if (code === 'unauthenticated') break;

      // Slow down and try the rest on the next flush.
      if (code === 'rate_limited') break;

      // Permanently refused: the item was rejected, or the payload is bad.
      // Retrying forever would bury it, so it is dropped and reported.
      if (code === 'validation_failed' || code === 'not_found' || code === 'forbidden') {
        console.error('[officer] wave permanently refused, discarding:', code, entry);
        await discardWave(entry.client_id);
        failed += 1;
        continue;
      }

      // A server error might be transient. Count the attempt and give up on this
      // entry only after MAX_ATTEMPTS, so a persistent fault cannot wedge the
      // queue for good.
      entry.attempts = (entry.attempts || 0) + 1;
      entry.last_error = String(code || 'server_error');

      if (entry.attempts >= MAX_ATTEMPTS) {
        console.error('[officer] wave exceeded retry budget, discarding:', entry);
        await discardWave(entry.client_id);
        failed += 1;
      } else {
        await putEntry(entry);
      }
      break;
    }
  }

  const remaining = (await listPending()).length;
  return { sent, failed, remaining, offline };
}
