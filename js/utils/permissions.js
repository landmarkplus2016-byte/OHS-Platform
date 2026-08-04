/* ==========================================================================
   permissions.js — the frontend's read of the current user's permissions.

   CLAUDE.md rule 5: this is UX only. The Apps Script is the security gate and
   re-checks every action server-side. Hiding a sidebar item here stops a user
   from stumbling into a page they cannot use; it stops nobody determined.

   PERMISSIONS is the array `login` returned: [{module, can_view, can_edit}].
   Super admins receive a fully-populated array from the server (Section 3.2),
   so the is_super_admin short-circuit below is belt-and-braces — the array
   alone would already answer true.
   ========================================================================== */

import { CURRENT_USER, PERMISSIONS } from '../state.js';

/** @returns {boolean} true when the signed-in user bypasses the permission table. */
export function isSuperAdmin() {
  return !!(CURRENT_USER && CURRENT_USER.is_super_admin);
}

/** The {module, can_view, can_edit} row for a module, or null. */
function grantFor(module) {
  if (!module) return null;
  return PERMISSIONS.find((p) => p && p.module === module) || null;
}

/**
 * May the current user see this module at all?
 *
 * @param {string} module e.g. 'employees'
 * @returns {boolean}
 */
export function canView(module) {
  if (!CURRENT_USER) return false;
  if (isSuperAdmin()) return true;

  const grant = grantFor(module);
  return !!(grant && grant.can_view);
}

/**
 * May the current user change this module's data? Officers are never granted
 * edit anywhere (rule 16), which the server enforces and the permissions array
 * it sends back reflects.
 *
 * @param {string} module
 * @returns {boolean}
 */
export function canEdit(module) {
  if (!CURRENT_USER) return false;
  if (isSuperAdmin()) return true;

  const grant = grantFor(module);
  return !!(grant && grant.can_edit);
}

/**
 * Does the user have view access to at least one module? Gates the module
 * section of the sidebar: a module admin with nothing granted yet gets the
 * Dashboard and SYSTEM entries, and no empty group headers above them.
 *
 * @returns {boolean}
 */
export function hasAnyViewPermission() {
  if (isSuperAdmin()) return true;
  return PERMISSIONS.some((p) => p && p.can_view);
}

/**
 * May the user open this route?
 *
 * Takes a *resolved route entry* from the router's table rather than a route
 * string, so this file never has to import the router — the dependency runs one
 * way, router → permissions.
 *
 * An unknown route (entry === null) is allowed through: it is a not-found, not
 * a permission failure, and the two should not look the same to the user.
 *
 * @param {Object|null} entry {module, superAdminOnly} from router.findRoute()
 * @returns {boolean}
 */
export function canAccessRoute(entry) {
  if (!entry) return true;
  if (entry.superAdminOnly && !isSuperAdmin()) return false;
  if (entry.module && !canView(entry.module)) return false;
  return true;
}
