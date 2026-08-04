/* ==========================================================================
   render.js — the single draw path. Every state change ends here.

   One job: pick the right shell and the right page for the current state, write
   it into #app, and bind that page's events. The guards live here rather than in
   the router so they apply on every draw, however it was triggered — a
   navigation, a language switch, or a data refresh.

   Stage 3 draws the login screen for real and placeholders for everything else.
   The admin and officer shells arrive in Stage 4.
   ========================================================================== */

import { CONFIG, CURRENT_USER, ROUTE } from './state.js';
import { renderLoginPage, bindLoginPageEvents } from './shell/loginPage.js';
import { renderChangePasswordPage, bindChangePasswordEvents } from './shell/changePasswordPage.js';
import { go, homeRoute, KNOWN_ROUTES } from './router.js';
import { t } from './i18n/i18n.js';

/**
 * Routes a user with must_change_password = TRUE may still reach. Everything
 * else redirects to the change-password screen (Section 4.3, step 9).
 *
 * 'logout' is exempt so the user is never trapped: someone who cannot recall
 * their current password must still be able to sign out.
 */
const PASSWORD_CHANGE_EXEMPT_ROUTES = new Set(['change-password', 'logout']);

/** Temporary Stage 3 body for routes whose real page has not been built yet. */
function renderPlaceholder(key) {
  return `<div class="stage-placeholder">${t(key)}</div>`;
}

export function render() {
  const app = document.getElementById('app');
  if (!app) return;

  // ---- Guard 1: no session → login, whatever the hash says. --------------
  // Refreshing the page lands here by design: the token is memory-only
  // (Section 4.5).
  if (!CURRENT_USER) {
    app.innerHTML = renderLoginPage(CONFIG);
    bindLoginPageEvents();
    return;
  }

  // ---- Guard 2: forced password change blocks every other route. ---------
  // Section 4.1.c / 4.3 step 9. UI-only enforcement, by design — the account is
  // already authenticated, so this is a usability policy, not a security one.
  if (CURRENT_USER.must_change_password && !PASSWORD_CHANGE_EXEMPT_ROUTES.has(ROUTE)) {
    go('change-password');
    return;
  }

  // ---- Guard 3: signed in but pointed at '' or the login screen. ---------
  if (!ROUTE || ROUTE === 'login') {
    go(homeRoute(CURRENT_USER));
    return;
  }

  // ---- Pages --------------------------------------------------------------
  if (!KNOWN_ROUTES.has(ROUTE)) {
    app.innerHTML = renderPlaceholder('placeholder_not_found');
    return;
  }

  switch (ROUTE) {
    case 'dashboard':
      app.innerHTML = renderPlaceholder('placeholder_dashboard');
      break;

    case 'change-password':
      app.innerHTML = renderChangePasswordPage();
      bindChangePasswordEvents();
      break;

    case 'check/home':
      app.innerHTML = renderPlaceholder('placeholder_officer_home');
      break;

    default:
      app.innerHTML = renderPlaceholder('placeholder_not_found');
  }
}
