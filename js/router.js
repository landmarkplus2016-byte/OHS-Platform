/* ==========================================================================
   router.js — hash-based routing (CLAUDE.md rule 10).

   Two jobs, both about routes and nothing else:

     1. Keep location.hash, the ROUTE / ROUTE_PARAMS state, and the drawn view
        in sync.
     2. Own the route table, which modules populate at boot by handing over
        their manifests (Section 5.3), and the access rules that decide whether
        a given user may stand on a given route.

   No page markup lives here. Guards are *defined* here — they are rules about
   routes — but they are *applied* by render.js, so they run on every draw
   however it was triggered: a navigation, a language switch, or a session
   cleared out from under the app by api.js.

   GitHub Pages has no server-side routing, so every route is a '#/…' fragment.
   ========================================================================== */

import { ROUTE, ROUTE_PARAMS, setRoute } from './state.js';
import { render } from './render.js';
import { ROLES, MODULE_NAMES } from './constants/globals.js';
import { canAccessRoute } from './utils/permissions.js';

/**
 * Manifest names that correspond to a row in the `Permissions` tab. A module
 * outside this set (the officer app) is gated by role instead — see
 * officer/manifest.js.
 */
const PERMISSION_MODULES = new Set(Object.values(MODULE_NAMES));

/**
 * Routes the shell owns rather than any module. They have no `page` function:
 * render.js draws them, because two of them (login, change-password) render
 * outside the shell entirely and the rest are shell pages by definition.
 */
const SHELL_ROUTES = [
  { path: 'login' },
  { path: 'change-password' },
  { path: 'dashboard', titleKey: 'nav_dashboard' },
  { path: 'export',    titleKey: 'nav_export' },
  { path: 'settings',  titleKey: 'nav_settings', superAdminOnly: true },
];

/**
 * Routes exempt from the officer/admin split below. Changing your password is
 * something every role does (Section 4.2), and it draws without a shell — so
 * neither "officers belong in check/*" nor "admins do not" applies to it.
 *
 * Without this exemption an officer with must_change_password would ping-pong:
 * guard 2 sends them to change-password, guard 4 sends them back to check/home.
 */
const SHELL_NEUTRAL_ROUTES = new Set(['change-password']);

/** Every registered route, in registration order. Rebuilt by registerModules. */
let ROUTE_TABLE = [];

/** path → entry, for the exact lookups render.js and the guards do. */
const ROUTE_BY_PATH = new Map();

/** The registered manifests, in the order main.js listed them. */
let MODULES = [];

/* ---------- Registration -------------------------------------------------- */

/**
 * @param {Object} entry {path, page?, module?, titleKey?, superAdminOnly?}
 */
function addRoute(entry) {
  const path = entry.path;

  // A collision means two modules claim the same URL and one of them would be
  // unreachable. Fail loudly at boot rather than mysteriously at navigation
  // time — same policy as an i18n key collision (rule 12.4).
  if (ROUTE_BY_PATH.has(path)) {
    throw new Error('[router] Duplicate route registered: ' + path);
  }

  const segments = path.split('/').filter(Boolean);

  const record = {
    path,
    segments,
    paramCount: segments.filter((s) => s.charAt(0) === ':').length,
    page: entry.page || null,
    module: entry.module || null,
    titleKey: entry.titleKey || null,
    superAdminOnly: entry.superAdminOnly === true,
  };

  ROUTE_TABLE.push(record);
  ROUTE_BY_PATH.set(path, record);
}

/**
 * Build the route table from the shell's own routes plus every module manifest
 * (Section 5.3). Called once by main.js, before initRouter().
 *
 * A module's route paths are registered verbatim — 'field' is reachable at
 * '#/field', 'check/employee/:id' at '#/check/employee/LM-EMP-0001'. There is
 * no automatic module-name prefix: the sidebar reads better with short URLs,
 * and the duplicate check above catches any clash between modules.
 *
 * @param {Array<Object>} modules manifest objects
 */
export function registerModules(modules) {
  ROUTE_TABLE = [];
  ROUTE_BY_PATH.clear();
  MODULES = Array.isArray(modules) ? modules : [];

  SHELL_ROUTES.forEach(addRoute);

  MODULES.forEach((manifest) => {
    // A route that also appears in the sidebar borrows that entry's label for
    // the topbar title. Routes with no sidebar entry (detail and form pages,
    // from Stage 5 on) fall back to the module's own display name.
    const titleKeys = new Map();
    (manifest.sidebar || []).forEach((item) => titleKeys.set(item.route, item.labelKey));

    (manifest.routes || []).forEach((route) => {
      addRoute({
        path: route.path,
        page: route.page,
        module: PERMISSION_MODULES.has(manifest.name) ? manifest.name : null,
        titleKey: titleKeys.get(route.path) || manifest.displayNameKey || null,
      });
    });
  });
}

/** The registered manifests. The sidebar and dashboard compose themselves from these. */
export function getModules() {
  return MODULES;
}

/**
 * The table entry for an exact route path, or null if nothing owns it.
 *
 * @param {string} path
 * @returns {Object|null}
 */
export function findRoute(path) {
  return ROUTE_BY_PATH.get(path) || null;
}

/* ---------- Matching ------------------------------------------------------ */

/**
 * Find the registered route that matches a concrete path, capturing ':param'
 * segments as it goes.
 *
 * Where more than one pattern matches, the one with the fewest parameters wins,
 * so a literal always beats a wildcard — '#/employee/new' resolves to a future
 * 'employee/new' rather than to 'employee/:id' with id 'new'.
 *
 * @param {Array<string>} segments
 * @returns {{entry: Object, params: Object}|null}
 */
function matchRoute(segments) {
  let best = null;

  for (const entry of ROUTE_TABLE) {
    if (entry.segments.length !== segments.length) continue;
    if (best && entry.paramCount >= best.entry.paramCount) continue;

    const params = {};
    let matched = true;

    for (let i = 0; i < segments.length; i++) {
      const pattern = entry.segments[i];

      if (pattern.charAt(0) === ':') {
        params[pattern.slice(1)] = segments[i];
      } else if (pattern !== segments[i]) {
        matched = false;
        break;
      }
    }

    if (matched) best = { entry, params };
  }

  return best;
}

/**
 * Parse location.hash into { route, params }.
 *
 * `route` is the registered *pattern*, not the literal path, so ROUTE stays
 * comparable to the route names the sidebar and the guards use:
 *
 *   ''                              -> { route: '',                    params: {} }
 *   '#/field'                       -> { route: 'field',               params: {} }
 *   '#/equipment/rejected'          -> { route: 'equipment/rejected',  params: {} }
 *   '#/check/employee/LM-EMP-0001'  -> { route: 'check/employee/:id',  params: {id: 'LM-EMP-0001'} }
 *   '#/nonsense'                    -> { route: 'nonsense',            params: {} }   (not-found)
 */
function parseHash() {
  const segments = location.hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);

  if (segments.length === 0) return { route: '', params: {} };

  const match = matchRoute(segments);
  if (match) return { route: match.entry.path, params: match.params };

  // Unknown path. Keep it intact so the address bar and the not-found page agree.
  return { route: segments.join('/'), params: {} };
}

/**
 * Build the hash for a (route, params) pair. Inverse of parseHash: substitutes
 * each ':name' segment with params.name.
 *
 * @param {string} route
 * @param {Object} [params]
 * @returns {string}
 */
function buildHash(route, params) {
  const path = String(route || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.charAt(0) !== ':') return segment;

      const value = params ? params[segment.slice(1)] : '';
      return encodeURIComponent(value === undefined || value === null ? '' : value);
    })
    .join('/');

  return '#/' + path;
}

/**
 * The href a nav link should carry. Links navigate by href rather than by a
 * click handler, so middle-click and "open in new tab" behave, and the browser
 * gives us the hashchange for free.
 *
 * @param {string} route
 * @param {Object} [params]
 * @returns {string}
 */
export function hrefFor(route, params) {
  return buildHash(route, params);
}

/* ---------- Navigation ---------------------------------------------------- */

/**
 * Navigate: update state, sync the URL, draw. Setting location.hash queues a
 * 'hashchange'; onHashChange() dedupes it against the state we just wrote, so
 * a navigation renders exactly once.
 *
 * @param {string} route registered route path, e.g. 'check/employee/:id'
 * @param {Object} [params] values for that route's ':' segments
 */
export function go(route, params) {
  setRoute(route, params || {});

  const hash = buildHash(route, params);
  if (location.hash !== hash) location.hash = hash;

  render();
}

/** Shallow equality for two params objects. */
function sameParams(a, b) {
  const aKeys = Object.keys(a || {});
  const bKeys = Object.keys(b || {});

  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

/** Fired for hash changes we did not cause: back/forward, or a hand-edited URL. */
function onHashChange() {
  const { route, params } = parseHash();

  if (route === ROUTE && sameParams(params, ROUTE_PARAMS)) return;

  setRoute(route, params);
  render();
}

/* ---------- Guards -------------------------------------------------------- */

/** True for any officer-app route (Section 7). */
function isCheckRoute(route) {
  return route === 'check' || route.indexOf('check/') === 0;
}

/**
 * Where a freshly logged-in user lands: officers get the mobile shell, everyone
 * else the admin dashboard (Section 4.3 step 8, Section 4.6).
 *
 * @param {Object} user the `user` block from `login`
 * @returns {string} route name
 */
export function homeRoute(user) {
  return user && user.role === ROLES.OFFICER ? 'check/home' : 'dashboard';
}

/**
 * Decide whether a user is allowed to stand on a route, and where to send them
 * if not. Pure — it reads its inputs and returns a route name, and render.js
 * does the redirecting.
 *
 * Order matters. Each guard assumes the ones above it have already passed.
 *
 * @param {Object|null} user CURRENT_USER
 * @param {string} route ROUTE
 * @returns {string|null} route to redirect to, or null to stay put
 */
export function guardRoute(user, route) {
  // 1. No session → login, whatever the hash says. Refreshing the page lands
  //    here by design: the admin token is memory-only (Section 4.5).
  if (!user) {
    return route === 'login' ? null : 'login';
  }

  // 2. Forced password change blocks every other route (Section 4.1.c). UI-only
  //    enforcement, by design — the account is already authenticated, so this is
  //    a usability policy, not a security one.
  if (user.must_change_password && route !== 'change-password') {
    return 'change-password';
  }

  // 3. Signed in but pointed at nothing, or back at the login screen.
  if (!route || route === 'login') {
    return homeRoute(user);
  }

  // 4 & 5. One URL, two apps (Section 7.1). Officers live inside 'check/*';
  //        admins never enter it.
  if (!SHELL_NEUTRAL_ROUTES.has(route)) {
    const isOfficer = user.role === ROLES.OFFICER;

    if (isOfficer && !isCheckRoute(route)) return 'check/home';
    if (!isOfficer && isCheckRoute(route)) return 'dashboard';
  }

  // 6. Module permission. UX only — the Apps Script re-checks every action
  //    (rule 5). An unregistered route falls through to the not-found page
  //    rather than being treated as a permission failure.
  if (!canAccessRoute(findRoute(route))) {
    return 'dashboard';
  }

  return null;
}

/* ---------- Boot ---------------------------------------------------------- */

/**
 * Register the hashchange listener and seed ROUTE from the initial hash.
 * Must run after registerModules(), since parsing the hash needs the table.
 * main.js calls render() once after this returns.
 */
export function initRouter() {
  window.addEventListener('hashchange', onHashChange);

  const { route, params } = parseHash();
  setRoute(route, params);
}
