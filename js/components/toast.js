/* ==========================================================================
   toast.js — transient confirmations and errors.

   Toasts live on document.body, outside #app, so a render() that replaces the
   whole shell does not wipe a message the user has not read yet. That matters
   here: almost every toast follows a save, and a save is followed by a redraw.
   ========================================================================== */

import { t } from '../i18n/i18n.js';
import { escapeHtml } from '../utils/format.js';

const STACK_ID = 'toast-stack';
const DEFAULT_MS = 2600;
const ERROR_MS = 4200;

/** The container, created on first use. */
function stack() {
  let el = document.getElementById(STACK_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = STACK_ID;
    el.className = 'toast-stack';
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Show a message.
 *
 * @param {string} message already translated
 * @param {'info'|'success'|'error'} [kind]
 */
export function toast(message, kind) {
  const el = document.createElement('div');
  el.className = 'toast toast-' + (kind || 'info');
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = escapeHtml(message);

  stack().appendChild(el);

  const life = kind === 'error' ? ERROR_MS : DEFAULT_MS;
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 200);
  }, life);
}

/** Shorthand for the happy path. */
export function toastSuccess(message) {
  toast(message, 'success');
}

/**
 * Show an ApiError as a message the user can act on.
 *
 * Maps `err.code` to an i18n key and never shows `err.message`, which exists
 * for the console only (Section 3.1). `unauthenticated` is deliberately absent:
 * api.js has already cleared the session and routed to login by the time a
 * caller catches it, so a toast would land on a screen that is about to be
 * replaced.
 *
 * @param {Object} err an ApiError
 * @param {string} [fallbackKey] i18n key when the code has no message of its own
 */
export function toastError(err, fallbackKey) {
  const code = (err && err.code) || 'server_error';
  const known = [
    'forbidden', 'not_found', 'validation_failed', 'conflict',
    'rate_limited', 'server_error', 'network_error', 'no_script_url',
  ];

  const key = known.includes(code) ? 'err_' + code : (fallbackKey || 'err_server_error');
  toast(t(key), 'error');
}
