/* ==========================================================================
   en.js — global English strings.

   Every key here MUST also exist in ar.js. Module-specific keys do not belong
   here — they live in js/modules/<name>/i18n.js and are merged in at boot.
   Keys are snake_case; parameters are {placeholders}.
   ========================================================================== */

export const en = {
  /* ---------- Branding ---------- */
  app_name: 'OHS Platform',
  company_name: 'Landmark',
  app_sub: 'Occupational Health & Safety',

  /* ---------- Login ---------- */
  sign_in: 'Sign in',
  signing_in: 'Signing in…',
  username: 'Username',
  password: 'Password',
  username_required: 'Enter your username.',
  password_required: 'Enter your password.',
  invalid_credentials: 'Incorrect username or password.',
  session_expired: 'Your session has ended. Please log in again.',

  /* ---------- First-time setup / server connection ---------- */
  first_time_setup: 'First-time setup',
  script_url_prompt: 'This device is not connected yet. Paste the Apps Script Web App URL to continue. Ask Khaled if you do not have it.',
  script_url_label: 'Apps Script Web App URL',
  script_url_required: 'Enter the Apps Script Web App URL.',
  script_url_invalid: 'The URL must start with https://',
  save: 'Save',
  save_and_continue: 'Save and continue',
  cannot_reach_server: 'Cannot reach the server',
  cannot_reach_server_body: 'The app could not contact the Apps Script Web App. Check your connection, or check that the server URL saved on this device is correct.',
  retry: 'Retry',
  change_server_url: 'Change server URL',
  loading: 'Loading…',

  /* ---------- Change password ---------- */
  change_password_title: 'Change your password',
  change_password_intro: 'Before you continue, set a password only you know.',
  current_password: 'Current password',
  current_password_required: 'Enter your current password.',
  current_password_incorrect: 'Your current password is not correct.',
  new_password: 'New password',
  new_password_required: 'Enter a new password.',
  confirm_new_password: 'Confirm new password',
  password_too_short: 'Password must be at least 8 characters.',
  passwords_dont_match: 'The two passwords do not match.',
  password_changed_ok: 'Password changed.',
  sign_out: 'Sign out',

  /* ---------- API error codes (api.js err.code → message) ---------- */
  err_forbidden: 'You do not have permission to do that.',
  err_not_found: 'Not found.',
  err_validation_failed: 'Please check the highlighted fields.',
  err_conflict: 'That change conflicts with the current data. Refresh and try again.',
  err_rate_limited: 'Too many requests. Please slow down.',
  err_server_error: 'Something went wrong on the server.',
  err_network_error: 'Cannot reach the server. Check your connection.',
  err_no_script_url: 'This device is not connected to a server yet.',

  /* ---------- Language ---------- */
  lang_en: 'EN',
  lang_ar: 'ع',

  /* ---------- Themes (swatch tooltips) ---------- */
  theme_blue: 'Blue',
  theme_teal: 'Teal',
  theme_purple: 'Purple',
  theme_crimson: 'Crimson',

  /* ---------- Roles (sidebar user chip) ---------- */
  role_super_admin: 'Super admin',
  role_module_admin: 'Module admin',
  role_officer: 'Safety officer',

  /* ---------- Module display names ---------- */
  module_employees: 'Employees',
  module_equipment: 'Equipment',
  module_officer: 'Site check',

  /* ---------- Sidebar group headers (Section 8.5) ----------
     Keyed by the manifest's `group`, lower-cased: group: 'EMPLOYEES' → group_employees. */
  group_employees: 'Employees',
  group_equipment: 'Equipment',
  group_system: 'System',

  /* ---------- Navigation ----------
     The nav_* keys for module items live here rather than in each module's
     i18n.js because the module i18n merge does not exist yet — it lands with
     the first module in Stage 5, and these move across with it. */
  nav_dashboard: 'Dashboard',
  nav_field_team: 'Field Team',
  nav_safety_team: 'Safety Team',
  nav_renewals: 'Renewals',
  nav_rdt: 'RDT',
  nav_resigned: 'Resigned & Terminated',
  nav_equipment_active: 'Active Equipment',
  nav_equipment_rejected: 'Rejected Equipment',
  nav_export: 'Export',
  nav_settings: 'Settings',

  /* ---------- Placeholders (each is replaced by its real page) ---------- */
  placeholder_dashboard: 'Dashboard placeholder',
  placeholder_settings: 'Settings placeholder',
  placeholder_export: 'Export placeholder',
  placeholder_employees_field: 'Field team list placeholder',
  placeholder_employees_safety: 'Safety team list placeholder',
  placeholder_employees_renewals: 'Renewals placeholder',
  placeholder_employees_rdt: 'RDT placeholder',
  placeholder_employees_resigned: 'Resigned & terminated placeholder',
  placeholder_equipment_active: 'Active equipment placeholder',
  placeholder_equipment_rejected: 'Rejected equipment placeholder',
  placeholder_officer_home: 'Officer home placeholder',
  placeholder_officer_sync: 'Officer sync placeholder',
  placeholder_officer_locked: 'Officer lockout placeholder',
  placeholder_officer_verdict_employee: 'Employee verdict placeholder',
  placeholder_officer_verdict_equipment: 'Equipment verdict placeholder',
  placeholder_not_found: 'Page not found.',
};
