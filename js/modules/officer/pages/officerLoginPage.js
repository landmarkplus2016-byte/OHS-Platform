/* ==========================================================================
   officer/pages/officerLoginPage.js — the mobile sign-in card (Section 7.2).

   Route '#/check'. The admin login lives at '#/login' and looks nothing like
   this: full-bleed navy, touch-sized fields, no shell around it.

   Same `login` action as the admin (Section 7.2) — the role is decided by the
   server from the Users tab, never by which screen someone signed in through.
   What differs is what happens after: officerLogin() persists the session to
   sessionStorage so the officer is not signing in again at every tower, and the
   app routes to a first sync when the phone has no data yet.
   ========================================================================== */

import { UI, CONFIG } from '../../../state.js';
import { t, setLanguage, getLanguage } from '../../../i18n/i18n.js';
import { escapeHtml } from '../../../utils/format.js';
import { go } from '../../../router.js';
import { ROLES } from '../../../constants/globals.js';
import { officerLogin, forgetOfficerSession } from '../dataActions.js';
import { refreshStaleState, STALE_STATE } from '../staleCheck.js';

/** ApiError code → the message shown under the fields. */
function loginErrorMessage(err) {
  switch (err && err.code) {
    case 'unauthenticated':   return t('invalid_credentials');
    case 'validation_failed': return t('err_validation_failed');
    case 'rate_limited':      return t('err_rate_limited');
    case 'network_error':     return t('err_network_error');
    case 'no_script_url':     return t('err_no_script_url');
    default:                  return t('err_server_error');
  }
}

export function renderOfficerLoginPage() {
  const lang = getLanguage();
  const appName = escapeHtml((CONFIG && CONFIG.app_name) || t('app_name'));
  const company = escapeHtml((CONFIG && CONFIG.company_name) || t('company_name'));

  // A one-shot notice from an involuntary logout (Section 4.4). Read and clear
  // it so it shows on this draw only.
  const notice = UI.notice;
  if (notice) delete UI.notice;

  return `
    <div class="officer-login">
      <div class="mark">LMP</div>
      <h1>${appName}</h1>
      <div class="sub">${company} — ${escapeHtml(t('off_login_subtitle'))}</div>

      ${notice === 'session_expired'
        ? `<div class="officer-login-notice">${escapeHtml(t('session_expired'))}</div>`
        : ''}

      <div class="field">
        <label for="off-username">${escapeHtml(t('username'))}</label>
        <input id="off-username" type="text" autocomplete="username"
               autocapitalize="none" spellcheck="false" inputmode="text">
      </div>

      <div class="field">
        <label for="off-password">${escapeHtml(t('password'))}</label>
        <input id="off-password" type="password" autocomplete="current-password">
      </div>

      <div id="off-login-err" class="officer-login-err"></div>

      <button type="button" class="btn btn-primary btn-lg btn-block"
              data-action="officer-signin">${escapeHtml(t('sign_in'))}</button>

      <div class="officer-login-lang">
        <button type="button" class="${lang === 'en' ? 'active' : ''}" data-lang="en">${escapeHtml(t('lang_en'))}</button>
        <button type="button" class="${lang === 'ar' ? 'active' : ''}" data-lang="ar">${escapeHtml(t('lang_ar'))}</button>
      </div>
    </div>`;
}

export function bindOfficerLoginPageEvents() {
  const root = document.querySelector('.officer-login');
  if (!root) return;

  // Standing on this screen means there is no valid session, whatever
  // sessionStorage still holds. Drop it, or the next boot restores a dead token
  // and is bounced straight back here.
  forgetOfficerSession();

  root.querySelectorAll('[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
  });

  const usernameInput = root.querySelector('#off-username');
  const passwordInput = root.querySelector('#off-password');
  const errEl = root.querySelector('#off-login-err');
  const signInBtn = root.querySelector('[data-action="officer-signin"]');

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
      const user = await officerLogin(username, password);

      // An admin who signs in here is not kept in the officer app: the router
      // would bounce them out of 'check/*' anyway, so send them where they
      // belong rather than through a redirect they can watch happen.
      if (user.role !== ROLES.OFFICER) {
        go(user.must_change_password ? 'change-password' : 'dashboard');
        return;
      }

      if (user.must_change_password) {
        go('change-password');
        return;
      }

      // Where an officer lands depends on what is on the phone. A device that
      // has never synced, or whose cache went stale while they were signed out,
      // goes straight to the lockout screen and its one button — there is
      // nothing they could usefully do on the home page first (Section 7.4).
      const state = await refreshStaleState();
      go(state.status === STALE_STATE.FRESH ? 'check/home' : 'check/locked');
    } catch (err) {
      busy = false;
      signInBtn.disabled = false;
      signInBtn.textContent = t('sign_in');
      errEl.textContent = loginErrorMessage(err);
      console.error('[officer] login failed:', err);
    }
  }

  signInBtn.addEventListener('click', doLogin);

  [usernameInput, passwordInput].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
    });
  });

  // No autofocus: on a phone it opens the keyboard over the card before the
  // officer has seen which app they are in.
}
