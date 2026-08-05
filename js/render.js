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
import { renderDashboardPage, bindDashboardPageEvents } from './shell/dashboardPage.js';
import { renderSettingsPage, bindSettingsPageEvents } from './shell/settingsPage.js';
import { renderExportPage, bindExportPageEvents } from './shell/exportPage.js';
import { go, guardRoute, findRoute, getModules } from './router.js';
import { ROLES } from './constants/globals.js';
import { t } from './i18n/i18n.js';

/**
 * Shell-owned routes have no page function in the route table (router.js
 * SHELL_ROUTES) — they are drawn from here instead.
 *
 * Same {page, bind} shape a module route carries, so a shell page can start a
 * fetch once its markup is in the DOM exactly as a module page does.
 *
 * Every shell route now has a real page; renderPlaceholder is kept for
 * not-found, which is not a page anyone builds.
 */
const SHELL_PAGES = new Map([
  ['dashboard', { page: renderDashboardPage, bind: bindDashboardPageEvents }],
  ['settings',  { page: renderSettingsPage,  bind: bindSettingsPageEvents }],
  ['export',    { page: renderExportPage,    bind: bindExportPageEvents }],
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
  return shellPage ? shellPage.page() : renderPlaceholder('placeholder_not_found');
}

/** Attach the current page's listeners, once its HTML is in the DOM. */
function bindPage(entry) {
  if (!entry) return;

  // A module route carries its own bind; a shell route's lives in SHELL_PAGES,
  // because the route table has no page or bind for the routes the shell owns.
  const bind = entry.bind || (SHELL_PAGES.get(entry.path) || {}).bind;
  if (!bind) return;

  try {
    bind(ROUTE_PARAMS);
  } catch (err) {
    // A page that throws while binding must not take the shell down with it —
    // the sidebar is already drawn, so the user can still navigate away.
    console.error('[render] bind failed for route "' + ROUTE + '":', err);
  }
}

/* ---------- Caret preservation across a redraw ---------------------------- */

/**
 * Every draw replaces #app wholesale, which destroys the focused control. On a
 * page where a text input drives a live filter, that is how OHS-DB lost focus
 * on every keystroke (Section 9.3).
 *
 * Rather than leave each page to remember, the draw path itself snapshots the
 * focused control and puts the caret back afterwards. A page opts in simply by
 * giving its input a stable `id`.
 *
 * @returns {{id: string, route: string, start: ?number, end: ?number}|null}
 */
function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.id) return null;

  const tag = el.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return null;

  const snapshot = { id: el.id, route: ROUTE, start: null, end: null };

  // selectionStart throws on input types that have no text selection
  // (date, number, checkbox…). Those still get focus back, just no caret.
  try {
    snapshot.start = el.selectionStart;
    snapshot.end = el.selectionEnd;
  } catch (err) {
    /* no selection on this input type */
  }

  return snapshot;
}

/**
 * Restore focus and caret, but only if we are still on the route the snapshot
 * was taken on — a navigation that happens to reuse an id must not steal focus
 * on arrival.
 */
function restoreFocus(snapshot) {
  if (!snapshot || snapshot.route !== ROUTE) return;

  const el = document.getElementById(snapshot.id);
  if (!el || el === document.activeElement) return;

  el.focus();

  if (snapshot.start !== null && typeof el.setSelectionRange === 'function') {
    try {
      el.setSelectionRange(snapshot.start, snapshot.end);
    } catch (err) {
      /* input type does not support selection ranges */
    }
  }
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

  const focusSnapshot = captureFocus();

  // ---- Shell-less screens -------------------------------------------------
  if (!CURRENT_USER) {
    app.innerHTML = renderLoginPage(CONFIG);
    bindLoginPageEvents();
    restoreFocus(focusSnapshot);
    return;
  }

  if (ROUTE === 'change-password') {
    app.innerHTML = renderChangePasswordPage();
    bindChangePasswordEvents();
    restoreFocus(focusSnapshot);
    return;
  }

  const entry = findRoute(ROUTE);

  // ---- Officer shell ------------------------------------------------------
  // Guard 4 in router.js has already pinned officers inside 'check/*', so
  // reaching here as an officer means an officer route. Stage 8 wraps this in
  // the phone frame from js/shell/officerShell.js; for now the page draws bare.
  if (CURRENT_USER.role === ROLES.OFFICER) {
    app.innerHTML = renderPageBody(entry);
    bindPage(entry);
    restoreFocus(focusSnapshot);
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
  bindPage(entry);
  restoreFocus(focusSnapshot);
}
