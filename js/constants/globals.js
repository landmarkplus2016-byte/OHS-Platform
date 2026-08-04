/* ==========================================================================
   globals.js — cross-module enums. Values that more than one module needs and
   that belong to no single module.

   Only what is actually in use lives here. ERROR_CODES stays in api.js until a
   second file needs it.
   ========================================================================== */

/** Users.role values (Section 2, `Users` tab). */
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  MODULE_ADMIN: 'module_admin',
  OFFICER: 'officer',
};

/**
 * The permission modules — the `module` column of the `Permissions` tab
 * (Section 2). A module manifest whose `name` appears here owns a permission
 * module, and its routes are gated by canView(module).
 *
 * `vehicles` is reserved (Section 2, future-reserved tabs) and has no manifest
 * yet. The officer app is deliberately absent: officers are gated by role, not
 * by this table.
 */
export const MODULE_NAMES = {
  EMPLOYEES: 'employees',
  EQUIPMENT: 'equipment',
  VEHICLES: 'vehicles',
};
