/* ==========================================================================
   state.js — the app's in-memory state. One module, one job: hold state.

   No rendering, no API calls, no routing logic lives here.

   Exports are `let` bindings, which ES modules expose as *live* bindings — an
   importer that does `import { TOKEN } from './state.js'` always reads the
   current value, not a snapshot taken at import time. Importers must never
   assign to them directly; use the setters below.

   SECURITY (CLAUDE.md Section 4.3): TOKEN lives here and nowhere else. It is
   never written to localStorage. Admin sessions are memory-only — a page
   refresh means logging in again, by design. The officer app is the single
   documented exception (sessionStorage, Section 7.2) and handles that in its
   own module.
   ========================================================================== */

/** Apps Script Web App URL. Device-level config, mirrored in localStorage.ohsp_script_url. */
export let SCRIPT_URL = '';

/**
 * The public config block from `get_config`: app_name, company_name,
 * primary_language, session_expiry_hours, max_stale_hours. Fetched once at boot,
 * before login. Belongs to the server/device, not to the session, so it survives
 * clearSession() — the login screen still needs app_name after a sign-out.
 */
export let CONFIG = {};

/** Session token from `login`. Memory only — never persisted for admin sessions. */
export let TOKEN = null;

/** The logged-in user: {user_id, username, display_name, role, is_super_admin, must_change_password}. */
export let CURRENT_USER = null;

/** Array of {module, can_view, can_edit}. Super admins receive a fully-populated array from the server. */
export let PERMISSIONS = [];

/** Current route path, e.g. 'employees/field'. Set by the router. */
export let ROUTE = '';

/** Params parsed out of the current route, e.g. {id: 'LM-EMP-0001'}. */
export let ROUTE_PARAMS = {};

/**
 * Transient per-page UI state — search text, active filters, current page number,
 * expanded rows. Cleared on logout. Pages read and mutate its properties directly
 * (it is a plain object); it is only ever *replaced* by clearSession().
 */
export let UI = {};

/* ---------- Setters ------------------------------------------------------- */

export function setScriptUrl(url) {
  SCRIPT_URL = url || '';
}

export function setConfig(config) {
  CONFIG = config || {};
}

export function setToken(token) {
  TOKEN = token || null;
}

export function setCurrentUser(user) {
  CURRENT_USER = user || null;
}

export function setPermissions(permissions) {
  PERMISSIONS = Array.isArray(permissions) ? permissions : [];
}

export function setRoute(route, params) {
  ROUTE = route || '';
  ROUTE_PARAMS = params || {};
}

/**
 * Wipes everything tied to the logged-in user. SCRIPT_URL survives — it is a
 * property of the device, not of the session, so the next user on this machine
 * does not have to paste the Apps Script URL again.
 *
 * ROUTE / ROUTE_PARAMS are left alone; the caller decides where to navigate next.
 */
export function clearSession() {
  TOKEN = null;
  CURRENT_USER = null;
  PERMISSIONS = [];
  UI = {};
}
