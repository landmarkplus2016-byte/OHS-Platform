/* ==========================================================================
   globals.js — cross-module enums. Values that more than one module needs and
   that belong to no single module.

   Only what is actually in use lives here. MODULE_NAMES arrives with the module
   registry (Stage 4); ERROR_CODES stays in api.js until a second file needs it.
   ========================================================================== */

/** Users.role values (Section 2, `Users` tab). */
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  MODULE_ADMIN: 'module_admin',
  OFFICER: 'officer',
};
