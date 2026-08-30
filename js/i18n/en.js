/* ==========================================================================
   en.js — global English strings.

   Every key here MUST also exist in ar.js. Module-specific keys do not belong
   here — they live in js/modules/<name>/i18n.js and are merged in at boot.
   Keys are snake_case; parameters are {placeholders}.
   ========================================================================== */

export const en = {
  /* ---------- Branding ---------- */
  app_name: 'OHS Platform',
  company_name: 'Landmark-Plus',
  app_sub: 'Occupational Health & Safety',

  // The year is passed in, never written into the string — a hardcoded one is
  // wrong from the first of January and nobody notices for months.
  copyright: '{company} © {year}',

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
  first_time_setup: 'First-Time Setup',
  script_url_prompt: 'This device is not connected yet. Paste the Apps Script Web App URL to continue. Ask Khaled if you do not have it.',
  script_url_label: 'Apps Script Web App URL',
  script_url_required: 'Enter the Apps Script Web App URL.',
  script_url_invalid: 'The URL must start with https://',
  save: 'Save',
  save_and_continue: 'Save and continue',
  cannot_reach_server: 'Cannot Reach the Server',
  cannot_reach_server_body: 'The app could not contact the Apps Script Web App. Check your connection, or check that the server URL saved on this device is correct.',
  retry: 'Retry',
  change_server_url: 'Change server URL',
  loading: 'Loading…',

  /* ---------- Change password ---------- */
  change_password_title: 'Change Your Password',
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
     Module nav labels moved into js/modules/<name>/i18n.js with Stage 5. What
     is left here belongs to the shell itself. */
  nav_dashboard: 'Dashboard',
  nav_export: 'Export',
  nav_settings: 'Settings',

  // The mobile bottom ribbon (js/shell/mobileNav.js). `nav_more` is the tab
  // holding the sidebar footer; `nav_menu` labels the ribbon for screen readers.
  nav_more: 'More',
  nav_menu: 'Navigation',
  close: 'Close',

  /* ---------- Certificate states (Section 6.1) ----------
     Shared: components/badge.js renders these for every module. There is no
     `plan` tier — anything past soon_days is plain `valid`.

     `state_na` is the admin wording: "the admin decided this does not apply".
     The officer app shows both it and `missing` as off_na — see Section 7.5. */
  state_suspended: 'Suspended',
  state_expired: 'Expired',
  state_urgent: 'Urgent',
  state_soon: 'Soon',
  state_missing: 'Missing',
  state_valid: 'Valid',
  state_na: 'Not applicable',

  /* ---------- Verdicts (Sections 6.2, 6.3) ---------- */
  verdict_cleared: 'Cleared',
  verdict_warning: 'Warning',
  verdict_blocked: 'Blocked',

  /* ---------- Teams ----------
     Shared rather than module-local: badge.js draws team badges, and the
     officer app labels employees by team too. */
  team_field: 'Field',
  team_safety: 'Safety',

  /* ---------- Shared UI verbs and nouns ---------- */
  cancel: 'Cancel',
  confirm: 'Confirm',
  edit: 'Edit',
  view: 'View',
  back: 'Back',
  refresh: 'Refresh',
  refresh_hint: 'Reload this page from the server. Clears any search or filter you have set.',
  refreshed_ok: 'Reloaded from the server.',
  search: 'Search',
  saving: 'Saving…',
  actions: 'Actions',
  filter_all: 'All',
  select_all: 'Select all',
  clear_selection: 'Clear',
  no_results: 'Nothing matches the current filters.',
  loading_data: 'Loading…',
  field_required: 'This field is required.',
  showing_count: 'Showing {shown} of {total}',
  page_x_of_y: 'Page {page} of {pages}',
  prev_page: 'Previous',
  next_page: 'Next',
  open_link: 'Open',

  /* ---------- Dashboard shell (Section 5.5) ----------
     Only the frame lives here. Every KPI label, chart title and empty state
     belongs to the module that draws it, so those keys live in
     js/modules/<name>/i18n.js. */
  dash_greeting: 'Welcome back, {name}.',
  dash_no_modules: 'You do not have view access to any module yet. Ask Khaled to grant you one.',

  /* ---------- Settings (Sections 3.3, 3.4, 3.7) ----------
     Shell keys, not module keys: the settings page belongs to the shell, and no
     module contributes to it. */
  settings_sub: 'Platform configuration for {company}.',
  settings_tab_users: 'Users',
  settings_tab_lists: 'Lists',
  settings_tab_thresholds: 'Thresholds',
  settings_tab_data: 'Data',

  /* Users tab */
  settings_add_user: '+ Add user',
  settings_create_user: 'Create user',
  settings_edit_user: 'Edit User',
  settings_display_name: 'Display name',
  settings_role: 'Role',
  settings_active: 'Active',
  settings_permissions: 'Permissions',
  settings_show_inactive: 'Show deactivated accounts',
  settings_user_count: '{count} accounts',
  settings_no_users: 'No accounts yet.',
  settings_col_last_login: 'Last login',
  settings_never: 'Never',
  settings_you: 'you',
  settings_username_locked: 'The username is the login handle and cannot change. Every audit record points at the user ID instead.',
  settings_first_password: 'First password',
  settings_first_password_hint: 'At least 8 characters. The user must change it on their first login.',
  settings_perm_module: 'Module',
  settings_perm_view: 'View',
  settings_perm_edit: 'Edit',
  settings_perm_hint: 'Granting edit grants view with it. Super admins and officers do not use this grid.',
  settings_perm_all: 'All modules',
  settings_perm_officer: 'Field lookup only',
  settings_perm_none: 'Nothing granted',
  settings_reset_password: 'Reset password',
  settings_reset_password_for: 'Reset the Password for {name}',
  settings_reset_password_intro: 'This signs them out everywhere and forces another password change on their next login. You do not need their current password.',
  settings_password_reset_ok: 'Password reset.',
  settings_deactivate: 'Deactivate',
  settings_reactivate: 'Reactivate',
  settings_deactivate_title: 'Deactivate This Account?',
  settings_deactivate_message: '{name} is signed out everywhere and cannot log in again until reactivated. Nothing is deleted — their permissions are kept for when they come back.',
  settings_user_created: 'Account created.',
  settings_user_saved: 'Account saved.',
  settings_user_deactivated: 'Account deactivated.',
  settings_user_reactivated: 'Account reactivated.',
  settings_err_username_required: 'Enter a username.',
  settings_err_display_name_required: 'Enter a display name.',
  settings_err_username_taken: 'That username is already in use.',
  settings_err_last_super_admin: 'This is the last active super admin. Promote someone else first.',

  /* Lists tab */
  settings_lists_intro: 'The dropdown options every form offers. Removing an option deactivates it — records that already carry the value keep showing it.',
  settings_option_value: 'Option',
  settings_sort_order: 'Order',
  settings_add_option: '+ Add option',
  settings_remove: 'Remove',
  settings_unsaved: 'Unsaved',
  settings_list_empty: 'This list has no options yet.',
  settings_no_lists: 'No option lists are configured.',
  settings_list_saved: '{list} saved.',
  settings_err_blank_option: 'Every option needs a value. Fill it in or remove the row.',

  /* The FieldOptions lists, keyed by list_key (Section 3.7) */
  list_field_titles: 'Field Team Titles',
  list_safety_titles: 'Safety Team Titles',
  list_contractors: 'Contractors',
  list_subcontractors: 'Subcontractors',
  list_employment_status: 'Employment Status',
  list_legal_permission: 'Legal Permission',
  list_equipment_items: 'Equipment Items',
  list_equipment_brands: 'Equipment Brands',

  /* Thresholds tab */
  settings_thresholds_intro: 'Platform-wide settings. Compliance thresholds change what every badge and verdict says, so the lists refresh as soon as you save.',
  settings_urgent_days: 'Urgent threshold (days)',
  settings_urgent_days_hint: 'A certificate expiring within this many days reads Urgent.',
  settings_soon_days: 'Soon threshold (days)',
  settings_soon_days_hint: 'Beyond this, a certificate is simply Valid. There is no third tier.',
  settings_session_hours: 'Session length (hours)',
  settings_session_hours_hint: 'How long a login lasts. Fixed from sign-in — it does not extend with activity.',
  settings_stale_hours: 'Officer cache limit (hours)',
  settings_stale_hours_hint: 'An officer whose data is older than this is locked out until they sync. No override.',
  settings_threshold_rule: 'The urgent threshold must be smaller than the soon threshold — otherwise one of the two tiers can never be reached.',

  /* ---------- RDT settings (ModuleSettings, employees module) ---------- */
  settings_rdt_title: 'Random Drug Testing',
  settings_rdt_intro: 'The rules the monthly selection runs by. Changing them changes who is drawn next month; entries already logged are untouched.',
  settings_rdt_enabled: 'Run random drug testing',
  settings_rdt_enabled_hint: 'Off hides the programme and shows an onboarding card on the RDT page. Existing log entries are kept.',
  settings_rdt_fy_start: 'Fiscal year starts in month',
  settings_rdt_fy_start_hint: '1–12. Landmark runs April to March, so 4.',
  settings_rdt_monthly_pct: 'Monthly target (%)',
  settings_rdt_monthly_pct_hint: 'Share of the eligible pool drawn each month, rounded to the nearest person.',
  settings_rdt_yearly_pct: 'Yearly target (%)',
  settings_rdt_yearly_pct_hint: 'Coverage goal for the year. 120% means everyone once, plus a fifth of the pool a second time.',
  settings_rdt_hire_grace: 'New-hire grace (months)',
  settings_rdt_hire_grace_hint: 'New hires are covered by their hiring medical for this long and are not drawn until it passes.',
  settings_rdt_repeat_months: 'Repeat-phase months',
  settings_rdt_repeat_months_hint: 'Comma-separated month numbers that draw from employees already tested this year. Default 2,3 for February and March.',
  settings_rdt_repeat_invalid: 'Repeat months must be comma-separated numbers from 1 to 12.',
  settings_config_saved: 'Settings saved.',
  settings_err_out_of_range: '{field} must be between {min} and {max}.',

  /* Data tab */
  settings_data_intro: 'Bulk import, the shared Drive folder, and what the Sheet currently holds.',
  settings_import_into: 'Import {module}',
  settings_import_file: 'Spreadsheet',
  settings_import_hint: 'An .xlsx or .csv. Column names are matched loosely, so “National ID”, “national_id” and “NationalID” all work. You review every row before anything is written.',
  settings_import_reading: 'Reading the file and checking it against what is already stored…',
  settings_import_ok: 'Imported: {added} added, {updated} updated, {skipped} skipped.',
  settings_import_result: 'Last import: {added} added, {updated} updated, {skipped} skipped.',
  settings_import_row_error: 'The row from spreadsheet line {row} was rejected ({fields}). Nothing was written — fix that row and import again.',

  /* Import review modal */
  import_review_title: 'Review {module} Import',
  import_commit: 'Import selected rows',
  import_summary: '{total} rows · {importing} to import · {overwriting} to overwrite · {skipped} skipped',
  import_col_row: 'Line',
  import_col_record: 'Record',
  import_col_status: 'Status',
  import_col_reasons: 'Notes',
  import_col_action: 'Action',
  import_col_lists: 'Lists',
  import_status_new: 'New',
  import_status_duplicate: 'Already exists',
  import_status_unknown_option: 'New list value',
  import_status_conflict: 'Repeated in file',
  import_status_blocked: 'Cannot import',
  import_action_import: 'Import',
  import_action_overwrite: 'Overwrite',
  import_action_skip: 'Skip',
  import_add_to_list: 'Add value',
  import_bulk_overwrite: 'Overwrite all existing',
  import_bulk_skip_dupes: 'Skip all existing',
  import_bulk_import_new: 'Import all new',
  import_warnings_title: '{count} Things to Check',
  import_warnings_more: '…and {count} more, in the browser console.',
  import_reason_duplicate: '{key} already belongs to {name}',
  import_reason_duplicate_in_file: '{key} appears more than once in this file',
  import_reason_unknown_option: '“{value}” is not in the {field} list yet',
  import_reason_bad_option: '“{value}” is not a valid {field} — fix it in the spreadsheet',
  import_err_nothing_selected: 'Every row is set to Skip. Choose at least one to import.',

  /* Spreadsheet parsing warnings (js/utils/excelImport.js) */
  import_warn_no_header: 'No header row found on “{sheet}” — nothing was read from it.',
  import_warn_unmapped: '“{sheet}”: these columns were not recognised and are ignored — {cols}',
  import_warn_bad_date: 'Line {row} of “{sheet}”: “{value}” is not a date the platform can read, so it was left empty.',
  import_warn_row_skipped: 'Line {row} of “{sheet}” has no identifying value and was skipped.',
  import_warn_no_named_sheets: 'No sheet named for a team was found, so “{sheet}” was read instead. Make sure every row carries a team column.',

  /* ---------- Export (Sections 3.5, 3.6) ---------- */
  export_intro: 'Download a filtered set of records. Nothing is truncated — if a set is too large for a format, that format is disabled.',
  export_include_archived: 'Include archived',
  export_include_rejected: 'Include rejected',
  export_match_count: '{count} records match',
  export_excel: 'Excel',
  export_excel_desc: 'One row per record, every column. Re-importable as-is.',
  export_csv: 'CSV',
  export_csv_desc: 'The same columns as Excel, as plain text.',
  export_pdf: 'PDF cards',
  export_pdf_desc: 'One printable page per record.',
  export_preparing: 'Preparing the download…',
  export_empty: 'Nothing matches these filters.',
  export_limit_pdf: 'Too many for a PDF — narrow the filters to {cap} or fewer.',
  export_limit_spreadsheet: 'Too many for one file — narrow the filters to {cap} or fewer.',
  export_caps_note: 'PDF is capped at {pdf} records; Excel and CSV at {spreadsheet}.',

  settings_drive_folder: 'Drive Folder',
  settings_drive_folder_label: 'Shared folder URL',
  settings_drive_folder_hint: 'Where exports are filed. The platform never uploads anything itself — this is the link it opens for you.',

  settings_health: 'Sheet Health',
  settings_health_tab: 'Records',
  settings_health_rows: 'Active',
  settings_health_updated: 'Last change',
  settings_health_note: 'Counts exclude archived employees and rejected equipment.',
  settings_next_employee_number: 'Next employee number',
  settings_next_equipment_number: 'Next equipment number',

  /* Spreadsheet parsing (js/utils/excelImport.js) */
  import_err_no_library: 'The spreadsheet library did not load. Check your connection and reload the page.',
  import_err_no_file: 'Pick a file first.',
  import_err_unreadable: 'That file could not be read.',
  import_err_unparseable: 'That file is not a spreadsheet the platform can read.',
  import_err_empty_workbook: 'That workbook has no sheets.',
  import_err_no_rows: 'The sheet has a header row but no data under it.',

  /* ---------- Not found ----------
     The last placeholder standing. Every other screen now has a real page; this
     one is not a page anyone builds. */
  placeholder_not_found: 'Page not found.',
};
