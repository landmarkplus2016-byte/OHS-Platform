/* ==========================================================================
   render.js — the single draw path. Every state change ends here.

   One job: pick the right shell and the right page for the current state, write
   it into #app, and bind that page's events.

   The route guards are defined in router.js — they are rules about routes — but
   they are applied here, so they run on every draw however it was triggered: a
   navigation, a language switch, a theme change, or a session cleared out from
   under the app by api.js.

   Three shells:
     - none        the admin login and change-password, which draw a centered card
     - officer     the phone frame, including the officer's own sign-in card
     - admin       sidebar + topbar + content
   ========================================================================== */

import { CONFIG, CURRENT_USER, ROUTE, ROUTE_PARAMS } from './state.js';
import { renderLoginPage, bindLoginPageEvents } from './shell/loginPage.js';
import { renderChangePasswordPage, bindChangePasswordEvents } from './shell/changePasswordPage.js';
import { renderSidebar, bindSidebarEvents } from './shell/sidebar.js';
import { renderMobileNav, bindMobileNavEvents } from './shell/mobileNav.js';
import { renderTopbar, bindTopbarEvents } from './shell/topbar.js';
import { renderDashboardPage, bindDashboardPageEvents } from './shell/dashboardPage.js';
import { renderSettingsPage, bindSettingsPageEvents } from './shell/settingsPage.js';
import { renderExportPage, bindExportPageEvents } from './shell/exportPage.js';
import { renderOfficerShell, bindOfficerShellEvents } from './shell/officerShell.js';
import { go, guardRoute, findRoute, getModules, isCheckRoute } from './router.js';
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

/* ---------- Page actions in the topbar ------------------------------------ */

/**
 * Move a page's primary buttons out of the page body and into the topbar.
 *
 * The topbar already owns the route's name (see topbar.js), so a page that also
 * drew its own title was saying the same thing twice. With the page title gone,
 * a lone "+ Add" row floating above the filter bar would be worse than the
 * duplication was — so the buttons go up beside the title they belong to, which
 * is what the topbar's trailing edge was built for.
 *
 * A page opts in by wrapping its buttons in an element marked
 * `data-topbar-actions`. Everything inside is moved; the wrapper itself is
 * dropped, so a page that opts in leaves no empty row behind.
 *
 * Called *after* bindPage on purpose. The page binds its buttons while they are
 * still inside its own root — `root.querySelector('[data-action="add"]')` finds
 * them exactly as before — and appendChild moves a node without disturbing the
 * listeners already on it. That is what keeps this a shell concern only: no
 * page had to learn where its buttons end up.
 */
function hoistPageActions(app) {
  const slot = app.querySelector('.topbar-actions');
  const source = app.querySelector('[data-topbar-actions]');
  if (!slot || !source) return;

  while (source.firstChild) slot.appendChild(source.firstChild);
  source.remove();
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

/**
 * How many guard redirects one draw may chain before we stop following them.
 *
 * A redirect re-enters render() through go(), so two guards that disagree about
 * where a user belongs recurse until the stack overflows — a frozen tab, and a
 * RangeError surfacing wherever the navigation was started. On a login screen
 * that reads as "something went wrong on the server", which is the wrong thing
 * to tell someone whose credentials were fine.
 *
 * Three is more than any legitimate chain needs (the longest real one is
 * login → home → lockout). Past that we stop, log, and draw whatever route we
 * are standing on rather than take the app down.
 */
const MAX_GUARD_REDIRECTS = 3;

/** Redirects followed so far in the current draw. Reset on every settled draw. */
let redirectDepth = 0;

export function render() {
  const app = document.getElementById('app');
  if (!app) return;

  // ---- Guards ------------------------------------------------------------
  const redirect = guardRoute(CURRENT_USER, ROUTE);
  if (redirect) {
    if (redirectDepth >= MAX_GUARD_REDIRECTS) {
      console.error(
        '[render] Guard redirect loop at route "' + ROUTE + '" → "' + redirect +
        '". Drawing the current route instead.'
      );
      redirectDepth = 0;
    } else {
      redirectDepth++;
      go(redirect); // re-enters render() with the corrected route
      return;
    }
  } else {
    redirectDepth = 0;
  }

  const focusSnapshot = captureFocus();

  // ---- Shell-less screens -------------------------------------------------
  // Two sign-in screens for one app (Section 7.1). The router's first guard has
  // already decided which route a session-less visitor belongs on, so 'check'
  // here means the mobile card — drawn inside the phone frame, since a login
  // that sat on a desktop-width page would be the wrong app on a phone.
  if (!CURRENT_USER) {
    if (isCheckRoute(ROUTE)) {
      const loginEntry = findRoute('check');
      app.innerHTML = renderOfficerShell(renderPageBody(loginEntry), 'check');
      bindOfficerShellEvents();
      bindPage(loginEntry);
    } else {
      app.innerHTML = renderLoginPage(CONFIG);
      bindLoginPageEvents();
    }
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
  // reaching here as an officer means an officer route. The shell binds before
  // the page, matching the admin branch below: the frame is wired first, then
  // whatever is standing inside it.
  if (CURRENT_USER.role === ROLES.OFFICER) {
    app.innerHTML = renderOfficerShell(renderPageBody(entry), ROUTE);
    bindOfficerShellEvents();
    bindPage(entry);
    restoreFocus(focusSnapshot);
    return;
  }

  // ---- Admin shell --------------------------------------------------------
  // Both navs are always drawn; CSS shows one of them (layout.css). Which one is
  // a question about the viewport, and the viewport can change without a redraw —
  // a rotated phone, a resized window — so deciding it here in JS would leave an
  // admin with no navigation at all until they next navigated.
  app.innerHTML = `
    <div class="app">
      ${renderSidebar(getModules())}
      <div class="main">
        ${renderTopbar(pageTitle(entry))}
        <div class="content">${renderPageBody(entry)}</div>
      </div>
      ${renderMobileNav(getModules())}
    </div>`;

  bindSidebarEvents();
  bindMobileNavEvents();
  bindTopbarEvents();
  bindPage(entry);
  hoistPageActions(app);
  restoreFocus(focusSnapshot);
}
