/* ==========================================================================
   changePasswordPage.js — the forced change-password screen.

   Reached two ways, both routed to '#/change-password':
     - a new account or an admin reset arrives with must_change_password = true
       (Section 4.1.c), and render.js pins the user here until it clears
     - the user navigates here deliberately

   Section 4.2, self-reset: the server verifies current_password_hash, clears
   force_password_change, and keeps THIS session alive while dropping the user's
   other sessions.
   ========================================================================== */

import { CURRENT_USER } from '../state.js';
import { t } from '../i18n/i18n.js';
import { api } from '../api.js';
import { sha256Hex } from '../utils/crypto.js';
import { go, homeRoute } from '../router.js';
import { signOut } from './sidebar.js';

/** Section 4.2 — enforced here, and re-checked as a hash-format test server-side. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Map a failed reset to a message. `field_errors.current_password_hash` is the
 * one the server sets when the current password does not match; everything else
 * falls back to the generic code mapping.
 */
function resetErrorMessage(err) {
  const fieldErrors = (err && err.field_errors) || {};

  if (fieldErrors.current_password_hash === 'incorrect') return t('current_password_incorrect');
  if (fieldErrors.current_password_hash === 'required') return t('current_password_required');

  switch (err && err.code) {
    case 'validation_failed': return t('err_validation_failed');
    case 'forbidden':         return t('err_forbidden');
    case 'not_found':         return t('err_not_found');
    case 'rate_limited':      return t('err_rate_limited');
    case 'network_error':     return t('err_network_error');
    default:                  return t('err_server_error');
  }
}

/** @returns {string} HTML — shares the centered auth card with the login screen. */
export function renderChangePasswordPage() {
  return `
    <div class="login-wrap">
      <div class="login-card">
        <div class="mark">OHS</div>
        <h1>${t('change_password_title')}</h1>
        <div class="sub">${t('change_password_intro')}</div>

        <div class="field">
          <label for="cp-current">${t('current_password')}</label>
          <input id="cp-current" type="password" autocomplete="current-password">
        </div>

        <div class="field">
          <label for="cp-new">${t('new_password')}</label>
          <input id="cp-new" type="password" autocomplete="new-password">
        </div>

        <div class="field">
          <label for="cp-confirm">${t('confirm_new_password')}</label>
          <input id="cp-confirm" type="password" autocomplete="new-password">
        </div>

        <div id="cp-err" class="err"></div>

        <button type="button" class="btn btn-primary btn-block" data-action="save">${t('save')}</button>

        <div class="auth-footer">
          <button type="button" class="btn btn-ghost btn-sm" data-action="signout">${t('sign_out')}</button>
        </div>
      </div>
    </div>`;
}

export function bindChangePasswordEvents() {
  const root = document.querySelector('.login-wrap');
  if (!root) return;

  const currentInput = root.querySelector('#cp-current');
  const newInput = root.querySelector('#cp-new');
  const confirmInput = root.querySelector('#cp-confirm');
  const errEl = root.querySelector('#cp-err');
  const saveBtn = root.querySelector('[data-action="save"]');

  let busy = false;

  async function save() {
    if (busy) return;

    errEl.textContent = '';
    const current = currentInput.value;
    const next = newInput.value;
    const confirm = confirmInput.value;

    if (!current) {
      errEl.textContent = t('current_password_required');
      currentInput.focus();
      return;
    }
    if (!next) {
      errEl.textContent = t('new_password_required');
      newInput.focus();
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      errEl.textContent = t('password_too_short');
      newInput.focus();
      return;
    }
    if (next !== confirm) {
      errEl.textContent = t('passwords_dont_match');
      confirmInput.focus();
      return;
    }

    busy = true;
    saveBtn.disabled = true;

    try {
      // Both hashes are computed here; neither plain-text password is sent.
      const [currentHash, newHash] = await Promise.all([
        sha256Hex(current),
        sha256Hex(next),
      ]);

      await api.call('reset_user_password', {
        user_id: CURRENT_USER.user_id,
        current_password_hash: currentHash,
        new_password_hash: newHash,
      });

      // The server cleared force_password_change; mirror it locally so the
      // render guard stops pinning us here. The session survives the reset by
      // design (Section 4.2), so there is no need to log in again.
      CURRENT_USER.must_change_password = false;

      go(homeRoute(CURRENT_USER));
    } catch (err) {
      busy = false;
      saveBtn.disabled = false;
      errEl.textContent = resetErrorMessage(err);
      console.error('[change-password] failed:', err);
    }
  }

  // Escape hatch. Without it, a user who cannot recall their current password is
  // stuck on this screen — the guard blocks every other route. Shared with the
  // sidebar's Sign out so both do exactly the same thing.
  saveBtn.addEventListener('click', save);
  root.querySelector('[data-action="signout"]').addEventListener('click', signOut);

  [currentInput, newInput, confirmInput].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
  });

  currentInput.focus();
}
