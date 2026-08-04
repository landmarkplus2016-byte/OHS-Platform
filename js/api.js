/* ==========================================================================
   api.js — the ONLY file in the frontend that talks to Apps Script.

   CLAUDE.md rules 1 and 9: pages, components and modules never fetch. They call
   api.call('action_name', payload) and get back the `data` block, or a rejected
   promise carrying an ApiError.

   Transport (Section 3.1):
     - One endpoint, one verb: POST to SCRIPT_URL, action dispatched in the body.
     - Content-Type is text/plain;charset=utf-8 so the browser skips the CORS
       preflight, which Apps Script Web Apps cannot answer. The body is still
       JSON — only the header lies.
   ========================================================================== */

import { SCRIPT_URL, TOKEN, UI, clearSession } from './state.js';
import { go } from './router.js';

/**
 * The single error type every caller sees. `code` is one of the fixed codes in
 * Section 3.1, plus two client-side ones: 'network_error' and 'no_script_url'.
 *
 * Callers branch on err.code — never on err.message, which exists for the
 * developer console only and is never shown to a user.
 */
export class ApiError extends Error {
  constructor(code, message, fieldErrors) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.field_errors = fieldErrors || null;
  }
}

/**
 * Call an Apps Script action.
 *
 * @param {string} action  e.g. 'list_employees'
 * @param {Object} [payload]
 * @returns {Promise<Object>} the `data` block on success
 * @throws {ApiError} on any failure
 */
async function call(action, payload) {
  if (!SCRIPT_URL) {
    throw new ApiError('no_script_url', 'No Apps Script URL configured on this device.');
  }

  const body = JSON.stringify({
    action,
    token: TOKEN,
    payload: payload || {},
  });

  let raw;
  try {
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow', // Apps Script 302s to script.googleusercontent.com
    });
    raw = await response.text();
  } catch (err) {
    // Offline, DNS failure, CORS rejection, deployment not shared publicly.
    throw new ApiError('network_error', err && err.message ? err.message : 'fetch failed');
  }

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (err) {
    // Apps Script serves an HTML error page when the deployment is broken or
    // not shared with "Anyone". Keep a slice of it for the console.
    console.error('[api] Non-JSON response for action "' + action + '":', raw);
    throw new ApiError('server_error', 'Malformed response: ' + String(raw).slice(0, 200));
  }

  if (envelope && envelope.ok === true) {
    return envelope.data;
  }

  const code = (envelope && envelope.error) || 'server_error';
  const message = (envelope && envelope.message) || 'Request failed';

  // Involuntary logout (Section 4.4). Covers all three ejection causes — token
  // expired, account deactivated, session superseded by another device.
  //
  // Excluded: `login` itself answers `unauthenticated` for a wrong password
  // (Section 3.2, step 2). There is no session to clear there, and redirecting
  // would wipe the form the user is standing in — so the login page handles
  // that code itself, as bad credentials.
  if (code === 'unauthenticated' && action !== 'login') {
    clearSession();
    UI.notice = 'session_expired'; // read and cleared by the login page
    go('login');
  }

  throw new ApiError(code, message, envelope && envelope.field_errors);
}

export const api = { call };
