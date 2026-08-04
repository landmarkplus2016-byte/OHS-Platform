/* ==========================================================================
   render.js — the single draw path. Every state change ends here.

   One job: pick the right shell and the right page for the current state, write
   it into #app, and bind that page's events.

   The route guards are defined in router.js — they are rules about routes — but
   they are applied here, so they run on every draw however it was triggered: a
   navigation, a language switch, a theme change, or a session cleared out from
   under the app by api.js.

   Three shells:
     - none        login and change-password, which draw a centered card
     - officer     the phone frame (Stage 8); Stage 4 draws the bare page
     - admin       sidebar + topbar + content
   ========================================================================== */

import { CONFIG, CURRENT_USER, ROUTE, ROUTE_PARAMS } from './state.js';
import { renderLoginPage, bindLoginPageEvents } from './shell/loginPage.js';
import { renderChangePasswordPage, bindChangePasswordEvents } from './shell/changePasswordPage.js';
import { renderSidebar, bindSidebarEvents } from './shell/sidebar.js';
import { renderTopbar } from './shell/topbar.js';
import { go, guardRoute, findRoute, getModules } from './router.js';
import { ROLES } from './constants/globals.js';
import { t } from './i18n/i18n.js';

/**
 * Shell-owned routes have no page function in the route table (router.js
 * SHELL_ROUTES) — they are drawn from here instead.
 *
 * Dashboard, Settings and Export are placeholders until Stages 6 and 9 build
 * js/shell/dashboardPage.js, settingsPage.js and exportPage.js.
 */
const SHELL_PAGES = new Map([
  ['dashboard', () => renderPlaceholder('placeholder_dashboard')],
  ['settings',  () => renderPlaceholder('placeholder_settings')],
  ['export',    () => renderPlaceholder('placeholder_export')],
]);

/** Temporary page body for routes whose real page has not been built yet. */
function renderPlaceholder(key) {
  return `<div class="page-placeholder">${t(key)}</div>`;
}

/** The topbar title for a route: its own label, or the app name as a fallback. */
function pageTitle(entry) {
  return t(entry && entry.titleKey ? entry.titleKey : 'app_name');
}

/** The body for the current route, or a not-found. */
function renderPageBody(entry) {
  if (!entry) return renderPlaceholder('placeholder_not_found');

  if (entry.page) return entry.page(ROUTE_PARAMS);

  const shellPage = SHELL_PAGES.get(entry.path);
  return shellPage ? shellPage() : renderPlaceholder('placeholder_not_found');
}

export function render() {
  const app = document.getElementById('app');
  if (!app) return;

  // ---- Guards ------------------------------------------------------------
  const redirect = guardRoute(CURRENT_USER, ROUTE);
  if (redirect) {
    go(redirect); // re-enters render() with the corrected route
    return;
  }

  // ---- Shell-less screens -------------------------------------------------
  if (!CURRENT_USER) {
    app.innerHTML = renderLoginPage(CONFIG);
    bindLoginPageEvents();
    return;
  }

  if (ROUTE === 'change-password') {
    app.innerHTML = renderChangePasswordPage();
    bindChangePasswordEvents();
    return;
  }

  const entry = findRoute(ROUTE);

  // ---- Officer shell ------------------------------------------------------
  // Guard 4 in router.js has already pinned officers inside 'check/*', so
  // reaching here as an officer means an officer route. Stage 8 wraps this in
  // the phone frame from js/shell/officerShell.js; for now the page draws bare.
  if (CURRENT_USER.role === ROLES.OFFICER) {
    app.innerHTML = renderPageBody(entry);
    return;
  }

  // ---- Admin shell --------------------------------------------------------
  app.innerHTML = `
    <div class="app">
      ${renderSidebar(getModules())}
      <div class="main">
        ${renderTopbar(pageTitle(entry))}
        <div class="content">${renderPageBody(entry)}</div>
      </div>
    </div>`;

  bindSidebarEvents();
}
