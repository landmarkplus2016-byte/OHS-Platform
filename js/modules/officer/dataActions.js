/* ==========================================================================
   officer/dataActions.js — the officer app's only door to the server, and the
   only place the mobile session exception is implemented.

   Rule 9: pages never call api.call directly. The three officer actions from
   Section 3.8 are wrapped here, together with the session and cache handling
   that has to happen around them.

   ---- The sessionStorage exception (Section 7.2) ----

   Admin tokens are memory-only (Section 4.5): refresh the page, log in again.
   The officer app is the one documented exception. An officer keeps the phone
   in a pocket between lookups, and re-authenticating at every tower is not a
   workable field procedure, so their token also goes to sessionStorage and is
   restored on the next open.

   Two things keep that acceptable, and both must stay true:
     - officer sessions are read-only (rule 16), so a stolen phone with a live
       token can read a roster and change nothing;
     - sign-out clears the token *and* the cache (Section 7.7).

   sessionStorage and not localStorage: the token still dies with the browsing
   context, so it cannot outlive the app the way a localStorage token would.
   ========================================================================== */

import { api } from '../../api.js';
import {
  setToken, setCurrentUser, setPermissions, clearSession,
} from '../../state.js';
import { go } from '../../router.js';
import { ROLES } from '../../constants/globals.js';
import { sha256Hex, getDeviceId } from '../../utils/crypto.js';
import {
  saveSnapshot, cacheClear, ensureSnapshotLoaded, updateSnapshotEntity,
} from './cache.js';
import { refreshStaleState, resetStaleState } from './staleCheck.js';
import {
  queueWave, flushOutbox, ensureOutboxLoaded, pendingCount, resetOutbox,
} from './outbox.js';

/** sessionStorage key holding the officer's restorable session. */
const SESSION_KEY = 'ohsp_officer_session';

/* ---------- Session persistence ------------------------------------------- */

/**
 * Persist the session so the next open restores it.
 *
 * The user block and the permission array ride along because a restore has to
 * rebuild the whole session, not just the token — and neither carries anything
 * secret (`password_hash` is never returned by any action, Section 3.4).
 *
 * @param {{token: string, user: Object, permissions: Array}} session
 */
function persistSession(session) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (err) {
    // Private browsing, or a storage quota. The session still works for this
    // page life; it just will not survive a reload.
    console.warn('[officer] cannot persist the session:', err);
  }
}

/**
 * Forget the persisted session.
 *
 * Exported as well as used internally: the sign-in card calls it on mount. If
 * that screen is showing, whatever is in storage is void — either the officer
 * signed out, or a call came back `unauthenticated` and api.js cleared the
 * session — and leaving a dead token there would have the next boot restore it
 * only to be kicked out again on the first request.
 */
export function forgetOfficerSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (err) {
    console.warn('[officer] cannot clear the persisted session:', err);
  }
}

/** @private Internal alias, so the calls below read as intent not as API. */
const forgetSession = forgetOfficerSession;

/**
 * Restore a persisted officer session into state, at boot.
 *
 * Only ever restores an officer: anything else in that key is a bug or a
 * tampered value, and an admin session must never come back from storage
 * (Section 4.5). The token is not validated here — the first authenticated call
 * does that, and api.js turns an `unauthenticated` answer into a clean logout.
 *
 * @returns {boolean} whether a session was restored
 */
export function restoreOfficerSession() {
  let raw;
  try {
    raw = sessionStorage.getItem(SESSION_KEY);
  } catch (err) {
    return false;
  }
  if (!raw) return false;

  let session;
  try {
    session = JSON.parse(raw);
  } catch (err) {
    forgetSession();
    return false;
  }

  const user = session && session.user;
  if (!session.token || !user || user.role !== ROLES.OFFICER) {
    forgetSession();
    return false;
  }

  setToken(session.token);
  setCurrentUser(user);
  setPermissions(session.permissions || []);
  return true;
}

/* ---------- Actions ------------------------------------------------------- */

/**
 * Sign in from the officer app. Same `login` action as the admin (Section 7.2)
 * — the role comes back from the server, it is not something the client picks.
 *
 * The plain-text password stops in this function: only the SHA-256 hash is sent
 * (rule 7).
 *
 * @param {string} username
 * @param {string} password plain text, hashed before it leaves
 * @returns {Promise<Object>} the `user` block
 * @throws {ApiError} `unauthenticated` on bad credentials
 */
export async function officerLogin(username, password) {
  const data = await api.call('login', {
    username,
    password_hash: await sha256Hex(password),
    device_id: getDeviceId(),
  });

  setToken(data.token);
  setCurrentUser(data.user);
  setPermissions(data.permissions || []);

  // Only officers get the persisted session. An admin who signs in through the
  // mobile card — possible, since the same action serves both — keeps the
  // memory-only session Section 4.5 requires.
  if (data.user && data.user.role === ROLES.OFFICER) {
    persistSession({
      token: data.token,
      user: data.user,
      permissions: data.permissions || [],
    });
  }

  return data.user;
}

/**
 * `officer_sync` — pull the full stripped snapshot and store it (Section 3.8).
 *
 * The cache is only replaced once the server has answered, so a sync that fails
 * halfway leaves the officer with the snapshot they already had rather than
 * with nothing.
 *
 * @returns {Promise<{snapshot: Object, synced_at: string}>}
 * @throws {ApiError}
 */
export async function officerSync() {
  // Flush *before* pulling, not after. The officer has signal right now, and a
  // wave sent first comes back inside the snapshot that follows — so the card
  // they open next shows it as recorded rather than still pending, with the
  // server's verdict already applied to it.
  try {
    await flushOutbox();
  } catch (err) {
    console.warn('[officer] pre-sync flush failed; syncing anyway:', err);
  }

  const snapshot = await api.call('officer_sync', {});

  const syncedAt = await saveSnapshot(snapshot);
  await refreshStaleState();

  return { snapshot, synced_at: syncedAt };
}

/**
 * `officer_get_employee` — the Refresh button on an employee verdict card.
 *
 * Updates that one record in the cached snapshot and leaves `synced_at` alone
 * (see cache.updateSnapshotEntity): refreshing one card says nothing about the
 * freshness of the rest, and must not defer a lockout.
 *
 * @param {string} employeeId
 * @returns {Promise<Object>} the refreshed, stripped employee
 * @throws {ApiError} `not_found` when the employee has been archived
 */
export async function officerGetEmployee(employeeId) {
  const data = await api.call('officer_get_employee', { employee_id: employeeId });

  await updateSnapshotEntity('employees', 'employee_id', data.employee);
  return data.employee;
}

/**
 * `officer_get_equipment` — the same, for an equipment card.
 *
 * @param {string} equipmentId
 * @returns {Promise<Object>} the refreshed, stripped equipment
 * @throws {ApiError} `not_found` when the item has been rejected
 */
export async function officerGetEquipment(equipmentId) {
  const data = await api.call('officer_get_equipment', { equipment_id: equipmentId });

  await updateSnapshotEntity('equipment', 'equipment_id', data.equipment);
  return data.equipment;
}

/**
 * `officer_record_wave` — file an inspection wave from the field (Section 3.8).
 *
 * The one write an officer session performs. It tries the server first and falls
 * back to the queue, rather than queueing everything and flushing later: an
 * officer standing in coverage should see the wave land, and a verdict that
 * changed should change on screen while they are still holding the item.
 *
 * Only `network_error` queues. Every other failure is the server having an
 * opinion — the item was rejected, the date is in the future — and queueing that
 * would hide a refusal behind a "saved" message and retry it forever.
 *
 * @param {{equipment_id: string, wave_date: string, result: string, comments?: string}} wave
 * @returns {Promise<{queued: boolean, wave: Object|null}>}
 * @throws {ApiError} for anything the server actively refused
 */
export async function officerRecordWave(wave) {
  const clientId = (self.crypto && self.crypto.randomUUID)
    ? self.crypto.randomUUID()
    : 'cid-' + Date.now() + '-' + Math.random().toString(16).slice(2);

  try {
    const data = await api.call('officer_record_wave', { ...wave, client_id: clientId });

    // The server sent back what the item now derives to, so the card can repaint
    // without a re-sync. Rule 13 holds: the phone displays a verdict, it never
    // works one out.
    if (data.derived) {
      const snapshot = await ensureSnapshotLoaded();
      const item = snapshot && (snapshot.equipment || [])
        .find((row) => row.equipment_id === wave.equipment_id);

      if (item) {
        item.derived = data.derived;
        item.waves = [data.wave, ...(item.waves || [])];
        await updateSnapshotEntity('equipment', 'equipment_id', item);
      }
    }

    return { queued: false, wave: data.wave };
  } catch (err) {
    if (err && err.code === 'network_error') {
      await queueWave(wave);
      return { queued: true, wave: null };
    }
    throw err;
  }
}

/**
 * Send anything the outbox is holding. Never rejects — see outbox.flushOutbox.
 *
 * @returns {Promise<{sent: number, failed: number, remaining: number, offline: boolean}>}
 */
export function officerFlushOutbox() {
  return flushOutbox();
}

/** Read the queue into memory. Pages call this from `bind`, then re-render. */
export function loadOfficerOutbox() {
  return ensureOutboxLoaded();
}

/**
 * Sign out (Section 7.7): the session token, the cached snapshot, and the
 * in-memory Recent list all go.
 *
 * This is the deliberate difference from an *involuntary* logout. An expired
 * session leaves the cache intact so the verdict card keeps working offline;
 * only signing out on purpose wipes the device, which is what handing a shared
 * work phone to the next officer amounts to.
 *
 * The server call is best-effort — a phone with no signal must still be able to
 * sign out locally, and the session row expires on its own anyway (Section 4.1).
 *
 * ---- The outbox guard ----
 *
 * Sign-out wipes the device, and that now includes any wave the officer recorded
 * but could not send. So it tries to flush first, and if anything is still
 * queued afterwards it asks rather than deciding: an inspection somebody
 * performed and wrote down is not acceptable collateral for tidying up a shared
 * phone.
 *
 * `confirmDiscard` is supplied by the caller instead of being imported, so this
 * file keeps its one job — talking to the server — and the sign-out button owns
 * the dialog. A caller that passes nothing gets the safe reading: refuse.
 *
 * @param {{confirmDiscard?: function(number): Promise<boolean>}} [opts]
 * @returns {Promise<boolean>} false when the officer backed out
 */
export async function officerLogout(opts) {
  // Best-effort: if there is signal, this empties the queue and the question
  // below never gets asked.
  try {
    await flushOutbox();
  } catch (err) {
    console.warn('[officer] pre-logout flush failed:', err);
  }

  const stranded = pendingCount();
  if (stranded > 0) {
    const confirmDiscard = opts && opts.confirmDiscard;
    const proceed = confirmDiscard ? await confirmDiscard(stranded) : false;

    if (!proceed) {
      console.warn('[officer] sign-out cancelled with ' + stranded + ' wave(s) unsent');
      return false;
    }
    console.warn('[officer] signing out and discarding ' + stranded + ' unsent wave(s)');
  }

  try {
    await api.call('logout', {});
  } catch (err) {
    console.warn('[officer] logout call failed; clearing locally anyway:', err);
  }

  forgetSession();

  try {
    await cacheClear();
  } catch (err) {
    console.error('[officer] could not clear the offline cache:', err);
  }

  resetOutbox();
  resetStaleState();
  clearSession(); // also empties UI, which holds the Recent list
  go('check');
  return true;
}

/**
 * The snapshot, read into memory if it is not there yet. Pages call this from
 * `bind` and then re-render.
 *
 * @returns {Promise<Object|null>}
 */
export function loadOfficerSnapshot() {
  return ensureSnapshotLoaded();
}
