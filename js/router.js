/* ==========================================================================
   router.js — hash-based routing (CLAUDE.md rule 10).

   One job: keep location.hash, the ROUTE / ROUTE_PARAMS state, and the drawn
   view in sync. No page markup lives here, and no permission checks — the
   access guard sits in render.js so it runs on every draw regardless of how
   render() was reached.

   GitHub Pages has no server-side routing, so every route is a '#/…' fragment.

   Stage 3 route table. Module manifests append their own routes here in
   Stage 4+ (Section 5.3), which is why KNOWN_ROUTES is a mutable Set rather
   than a frozen list.
   ========================================================================== */

import { ROUTE, ROUTE_PARAMS, setRoute } from './state.js';
import { render } from './render.js';
import { ROLES } from './constants/globals.js';

/**
 * Routes whose name spans more than one path segment. Checked before the
 * single-segment fallback so '#/check/home' does not parse as route 'check'
 * with a param of 'home'.
 */
const MULTI_SEGMENT_ROUTES = new Set([
  'check/home',
]);

/** Every route the shell can draw right now. Unknown routes render a not-found. */
export const KNOWN_ROUTES = new Set([
  'login',
  'change-password',
  'dashboard',
  'check/home',
]);

/**
 * Parse location.hash into { route, params }.
 *
 *   ''                        -> { route: '',               params: {} }
 *   '#/login'                 -> { route: 'login',          params: {} }
 *   '#/dashboard'             -> { route: 'dashboard',      params: {} }
 *   '#/check/home'            -> { route: 'check/home',     params: {} }
 *   '#/employee/LM-EMP-0001'  -> { route: 'employee',       params: { id: 'LM-EMP-0001' } }
 */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const segs = raw.split('/').filter(Boolean);

  if (segs.length === 0) return { route: '', params: {} };

  const twoSeg = segs.length >= 2 ? segs[0] + '/' + segs[1] : null;
  if (twoSeg && MULTI_SEGMENT_ROUTES.has(twoSeg)) {
    return { route: twoSeg, params: segs[2] ? { id: segs[2] } : {} };
  }

  return { route: segs[0], params: segs[1] ? { id: segs[1] } : {} };
}

/** Build the hash for a (route, params) pair. Inverse of parseHash. */
function buildHash(route, params) {
  const id = params && params.id ? '/' + params.id : '';
  return '#/' + route + id;
}

/**
 * Navigate: update state, sync the URL, draw. Setting location.hash queues a
 * 'hashchange'; onHashChange() dedupes it against the state we just wrote, so
 * a navigation renders exactly once.
 *
 * @param {string} route
 * @param {Object} [params]
 */
export function go(route, params) {
  setRoute(route, params || {});

  const hash = buildHash(route, params);
  if (location.hash !== hash) location.hash = hash;

  render();
}

/** Fired for hash changes we did not cause: back/forward, or a hand-edited URL. */
function onHashChange() {
  const { route, params } = parseHash();

  const sameRoute = route === ROUTE;
  const sameId = (params.id || null) === (ROUTE_PARAMS.id || null);
  if (sameRoute && sameId) return;

  setRoute(route, params);
  render();
}

/**
 * Where a freshly logged-in user lands: officers get the mobile shell, everyone
 * else the admin dashboard (Section 4.3 step 8, Section 4.6).
 *
 * @param {Object} user  the `user` block from `login`
 * @returns {string} route name
 */
export function homeRoute(user) {
  return user && user.role === ROLES.OFFICER ? 'check/home' : 'dashboard';
}

/**
 * Register the hashchange listener and seed ROUTE from the initial hash.
 * main.js calls render() once after this returns.
 */
export function initRouter() {
  window.addEventListener('hashchange', onHashChange);

  const { route, params } = parseHash();
  setRoute(route, params);
}
