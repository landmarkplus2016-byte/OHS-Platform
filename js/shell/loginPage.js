/* ==========================================================================
   loginPage.js — the login screen. Rendered by render.js whenever there is no
   session, whatever the hash says.

   Section 4.3, steps 4-9: app_name in the header, hash the password in the
   browser, exchange it for a token, then route by role.
   ========================================================================== */

import { UI, setToken, setCurrentUser, setPermissions } from '../state.js';
import { t, setLanguage, getLanguage } from '../i18n/i18n.js';
import { api } from '../api.js';
import { sha256Hex, getDeviceId } from '../utils/crypto.js';
import { escapeHtml } from '../utils/format.js';
import { go, homeRoute } from '../router.js';

/**
 * Map an ApiError code to a user-facing message.
 *
 * `unauthenticated` means one thing here and something else everywhere else:
 * on a login attempt it is a wrong username or password, not an expired
 * session, so api.js deliberately does not intercept it for this action.
 */
function loginErrorMessage(err) {
  const code = err && err.code;

  switch (code) {
    case 'unauthenticated':   return t('invalid_credentials');
    case 'validation_failed': return t('err_validation_failed');
    case 'rate_limited':      return t('err_rate_limited');
    case 'network_error':     return t('err_network_error');
    case 'no_script_url':     return t('err_no_script_url');
    default:                  return t('err_server_error');
  }
}

/**
 * @param {Object} [config] the `get_config` block; app_name and company_name
 *                          come from the server and override the i18n defaults.
 * @returns {string} HTML
 */
export function renderLoginPage(config) {
  const cfg = config || {};
  const lang = getLanguage();

  const appName = escapeHtml(cfg.app_name || t('app_name'));
  const companyName = escapeHtml(cfg.company_name || t('company_name'));

  // A one-shot notice left behind by an involuntary logout (Section 4.4). Read
  // it and clear it so it shows on this draw only.
  const notice = UI.notice;
  if (notice) delete UI.notice;

  return `
    <div class="login-wrap">
      <div class="login-card">
        <div class="mark">
          <img src="icons/icon-192.png" alt="${appName}" width="72" height="72">
        </div>
        <h1>${appName}</h1>
        <div class="sub">${companyName} — ${t('app_sub')}</div>

        <div class="lang-row">
          <button type="button" class="btn btn-ghost btn-sm${lang === 'en' ? ' active' : ''}" data-lang="en">${t('lang_en')}</button>
          <button type="button" class="btn btn-ghost btn-sm${lang === 'ar' ? ' active' : ''}" data-lang="ar">${t('lang_ar')}</button>
        </div>

        ${notice === 'session_expired' ? `<div class="login-notice">${t('session_expired')}</div>` : ''}

        <div class="field">
          <label for="login-username">${t('username')}</label>
          <input id="login-username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false">
        </div>

        <div class="field">
          <label for="login-password">${t('password')}</label>
          <input id="login-password" type="password" autocomplete="current-password">
        </div>

        <div id="login-err" class="err"></div>

        <button type="button" class="btn btn-primary btn-block" data-action="signin">${t('sign_in')}</button>

        <div class="login-legal">${t('copyright', {
    company: companyName,
    year: new Date().getFullYear(),
  })}</div>
      </div>
    </div>`;
}

export function bindLoginPageEvents() {
  const root = document.querySelector('.login-wrap');
  if (!root) return;

  // Language toggle — works before login, since i18n needs no session.
  root.querySelectorAll('[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
  });

  const usernameInput = root.querySelector('#login-username');
  const passwordInput = root.querySelector('#login-password');
  const errEl = root.querySelector('#login-err');
  const signInBtn = root.querySelector('[data-action="signin"]');

  let busy = false;

  async function doLogin() {
    if (busy) return;

    errEl.textContent = '';
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username) {
      errEl.textContent = t('username_required');
      usernameInput.focus();
      return;
    }
    if (!password) {
      errEl.textContent = t('password_required');
      passwordInput.focus();
      return;
    }

    busy = true;
    signInBtn.disabled = true;
    signInBtn.textContent = t('signing_in');

    try {
      // Section 4.2: the plain-text password stops here. Only the hash travels.
      const passwordHash = await sha256Hex(password);

      const data = await api.call('login', {
        username,
        password_hash: passwordHash,
        device_id: getDeviceId(),
      });

      // Memory only — never localStorage (Section 4.3).
      setToken(data.token);
      setCurrentUser(data.user);
      setPermissions(data.permissions);

      if (data.user.must_change_password) {
        go('change-password');
      } else {
        go(homeRoute(data.user));
      }
      // The DOM is replaced by that navigation — nothing left to reset here.
    } catch (err) {
      busy = false;
      signInBtn.disabled = false;
      signInBtn.textContent = t('sign_in');
      errEl.textContent = loginErrorMessage(err);
      console.error('[login] failed:', err);
    }
  }

  signInBtn.addEventListener('click', doLogin);

  // Enter submits from either field.
  [usernameInput, passwordInput].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
    });
  });

  usernameInput.focus();
}
