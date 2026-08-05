/* ==========================================================================
   officer/cache.js — the officer's offline database (Section 7.3).

   One IndexedDB database, `ohsp-officer`, with one object store, `kv`, holding
   two keys:

     snapshot    the full stripped payload from `officer_sync`
     synced_at   ISO timestamp of the last successful sync

   IndexedDB and not localStorage: the snapshot is the whole roster plus the
   whole inventory, which outgrows localStorage's quota, and the rule "never
   store the cached snapshot in localStorage" says so outright.

   The cache is deliberately independent of the session (Section 7.2). A token
   that expires while the officer is out of signal does not touch what is stored
   here — the verdict card keeps working from cache until it goes stale, and
   only an explicit sign-out wipes it.

   ---- The memory mirror ----

   Pages render synchronously: `page()` returns a string and cannot await. Every
   read here is a promise, so the snapshot is also held in a module-level
   variable that pages read with getCachedSnapshot(). The rule is:

     bind()  → await ensureSnapshotLoaded(), then render() again
     page()  → getCachedSnapshot(), synchronous, possibly null on the first draw

   That is the same "start the fetch in bind, draw what you have in page" shape
   every admin page uses; the store behind it just happens to be local.
   ========================================================================== */

const DB_NAME = 'ohsp-officer';
const DB_VERSION = 1;
const STORE = 'kv';

export const KEY_SNAPSHOT = 'snapshot';
export const KEY_SYNCED_AT = 'synced_at';

/**
 * The open database, kept as its in-flight promise so concurrent callers share
 * one connection rather than racing to open several.
 */
let dbPromise = null;

/** The memory mirror of the stored snapshot, and whether we have looked yet. */
let snapshotCache = null;
let snapshotLoaded = false;

/* ---------- Low-level store access ---------------------------------------- */

/**
 * Open (and on first use, create) the database.
 *
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Cannot open ' + DB_NAME));

    // Fires when another tab holds an older version open. Rare — the officer
    // app is a single-tab PWA — but a silent hang here would look like a dead
    // Sync button, so it surfaces as a failure the caller can report.
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab.'));
  });

  // A failed open must not be memoised, or the app could never recover from a
  // transient error without a reload.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

/**
 * Read one key.
 *
 * @param {string} key
 * @returns {Promise<*>} the stored value, or undefined when absent
 */
export async function cacheGet(key) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(key);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Write one key.
 *
 * Resolves on transaction complete rather than on request success: the write is
 * only durable once the transaction commits, and a sync that reported success
 * before then could be lost by a phone locking mid-write.
 *
 * @param {string} key
 * @param {*} value must be structured-cloneable — plain JSON here
 * @returns {Promise<void>}
 */
export async function cacheSet(key, value) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Cache write aborted'));
  });
}

/**
 * Empty the store — every key, not just the two we name.
 *
 * Called on sign-out (Section 7.7): a shared work phone handed to the next
 * officer must carry nothing of the last one.
 *
 * @returns {Promise<void>}
 */
export async function cacheClear() {
  snapshotCache = null;
  snapshotLoaded = false;

  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Cache clear aborted'));
  });
}

/* ---------- Snapshot ------------------------------------------------------ */

/**
 * The cached snapshot, or null when this device has never synced.
 *
 * @returns {Promise<Object|null>}
 */
export async function loadSnapshot() {
  const value = await cacheGet(KEY_SNAPSHOT);

  snapshotCache = value || null;
  snapshotLoaded = true;
  return snapshotCache;
}

/**
 * Store a fresh snapshot and stamp the sync clock.
 *
 * `synced_at` comes from the server's own value when it sent one, so the
 * staleness clock is not at the mercy of a phone with the wrong date. It is
 * written *after* the snapshot: if the two writes are interrupted in between, a
 * snapshot with no timestamp reads as infinitely stale and locks the app, which
 * is the direction rule 18 wants it to fail.
 *
 * @param {Object} snapshot the `officer_sync` data block
 * @returns {Promise<string>} the stored synced_at
 */
export async function saveSnapshot(snapshot) {
  const syncedAt = (snapshot && snapshot.synced_at) || new Date().toISOString().slice(0, 19);

  await cacheSet(KEY_SNAPSHOT, snapshot);
  await cacheSet(KEY_SYNCED_AT, syncedAt);

  snapshotCache = snapshot;
  snapshotLoaded = true;
  return syncedAt;
}

/**
 * When the cache was last filled, or null when it never was.
 *
 * Read from its own key rather than from `snapshot.synced_at`, so the staleness
 * check stays honest even if a future snapshot shape drops the field.
 *
 * @returns {Promise<string|null>}
 */
export async function loadSyncedAt() {
  const value = await cacheGet(KEY_SYNCED_AT);
  return value || null;
}

/* ---------- The memory mirror --------------------------------------------- */

/**
 * The snapshot as it stands in memory. Synchronous, for `page()` functions.
 *
 * Returns null both when nothing is cached and when nothing has been read yet —
 * a page cannot tell those apart, and does not need to: `bind()` has already
 * started the read, and the second draw will have it.
 *
 * Where the difference does matter, ask staleCheck.js instead: it distinguishes
 * "never synced" from "stale" from "not looked yet", and it is the only place
 * that distinction changes what an officer is allowed to see.
 *
 * @returns {Object|null}
 */
export function getCachedSnapshot() {
  return snapshotCache;
}

/**
 * Read the snapshot into memory once. Safe to call on every bind.
 *
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<Object|null>}
 */
export async function ensureSnapshotLoaded(opts) {
  if (snapshotLoaded && !(opts && opts.force)) return snapshotCache;
  return loadSnapshot();
}

/**
 * Replace one entity inside the cached snapshot, after a Refresh (Section 7.5).
 *
 * Deliberately does NOT touch `synced_at`. Refreshing one employee says nothing
 * about the freshness of the other two hundred, and moving the clock would let
 * an officer hold a lockout off indefinitely by refreshing a single card — the
 * opposite of what rule 18 asks for.
 *
 * An entity that is not already in the snapshot is appended, which is what
 * happens when the officer refreshes a record created since their last sync.
 *
 * @param {'employees'|'equipment'} collection the snapshot array to update
 * @param {string} idField 'employee_id' | 'equipment_id'
 * @param {Object} entity the fresh, server-stripped record
 * @returns {Promise<Object|null>} the updated snapshot
 */
export async function updateSnapshotEntity(collection, idField, entity) {
  const snapshot = await ensureSnapshotLoaded();
  if (!snapshot || !entity) return snapshot;

  const list = Array.isArray(snapshot[collection]) ? snapshot[collection] : [];
  const id = entity[idField];
  const index = list.findIndex((row) => row && row[idField] === id);

  if (index >= 0) list[index] = entity;
  else list.push(entity);

  snapshot[collection] = list;

  await cacheSet(KEY_SNAPSHOT, snapshot);
  snapshotCache = snapshot;
  return snapshot;
}
