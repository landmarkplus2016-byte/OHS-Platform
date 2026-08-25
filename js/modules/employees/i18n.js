/* ==========================================================================
   employees/i18n.js — the employee module's strings, merged into the global
   dictionaries at boot (Section 5.1).

   Importing this file registers the keys. manifest.js imports it, and main.js
   imports the manifest, so the merge happens before the first render.

   Every key must exist in both languages, and a key that already exists
   anywhere is a boot-time hard error (rule 12.4). Module keys are prefixed
   `emp_` unless they are unmistakably employee-domain already (nav_*, cert_*,
   qual_*) — that prefix is what keeps the equipment module from colliding when
   it defines its own "Serial number" or "Add item" label.

   Shared vocabulary — cert states, verdicts, team names, Cancel/Confirm — is
   NOT here. It lives in js/i18n/en.js because components/badge.js and
   components/modal.js render it for every module.
   ========================================================================== */

import { registerModuleDict } from '../../i18n/i18n.js';

const en = {
  /* ---------- Navigation (Section 8.5) ---------- */
  nav_field_team: 'Field Team',
  nav_safety_team: 'Safety Team',
  nav_renewals: 'Renewals',
  nav_rdt: 'RDT',
  nav_resigned: 'Resigned & Terminated',

  /* ---------- Certificates ---------- */
  cert_wah_practical: 'Working at Height — Practical',
  cert_wah_theoretical: 'Working at Height — Theoretical',
  cert_ra: 'Risk Assessment',
  cert_fa: 'First Aid',
  cert_ff: 'Fire Fighting',
  /* The `ec` key predates this label — the certificate was called Emergency
     Care until it was renamed. Same certificate, same dates, same four Sheet
     columns; only what it is called changed. Renaming the key would mean
     migrating cert_ec_expiry / _link / _na / _suspended across every employee
     to buy nothing but a tidier abbreviation. */
  cert_ec: 'Electrical',
  cert_mcu: 'Medical Check-up',
  cert_ppe: 'PPE Inspection',
  cert_lifting: 'Lifting',
  cert_scaffolding: 'Scaffolding',

  /* ---------- Qualifications (safety team) ---------- */
  qual_nebosh: 'NEBOSH',
  qual_iso_45001: 'ISO 45001',
  qual_osha: 'OSHA',

  /* ---------- Column headers ---------- */
  emp_col_name: 'Name',
  emp_col_national_id: 'National ID',
  emp_col_title: 'Title',
  emp_col_contractor: 'Contractor',
  emp_col_subcontractor: 'Subcontractor',
  emp_col_state: 'State',
  emp_col_verdict: 'Site check',
  emp_col_quals: 'Qualifications',
  emp_col_updated: 'Updated',
  emp_col_certificate: 'Certificate',
  emp_col_expiry: 'Expiry',
  emp_col_days: 'Days',
  emp_col_employee: 'Employee',
  emp_col_team: 'Team',
  emp_col_archived_on: 'Archived on',

  /* ---------- Field labels ---------- */
  emp_field_name: 'Full name',
  emp_field_national_id: 'National ID',
  emp_field_title: 'Title',
  emp_field_contractor: 'Contractor',
  emp_field_subcontractor: 'Subcontractor',
  emp_field_hired_date: 'Hired date',
  emp_field_employment_status: 'Employment status',
  emp_field_legal_permission: 'Legal permission',
  emp_field_expiry_date: 'Expiry date',
  emp_field_cert_link: 'Certificate link',

  /* ---------- Section headers ---------- */
  emp_section_personal: 'Personal Details',
  emp_section_certs: 'Certificates',
  emp_section_quals: 'Qualifications',
  emp_section_drug: 'Drug Testing',
  emp_section_history: 'Renewal History',
  emp_section_equipment: 'Assigned Equipment',
  emp_section_record: 'Record',

  /* ---------- List page ---------- */
  emp_add: '+ Add employee',
  emp_search_placeholder: 'Search by name or national ID…',
  emp_filter_state: 'Compliance state',
  emp_filter_title: 'Title',
  emp_filter_subcontractor: 'Subcontractor',
  emp_expired_count: '{count} expired',
  emp_none_yet: 'No employees on this team yet.',

  /* ---------- Detail page ---------- */
  emp_not_found: 'That employee no longer exists.',
  emp_open_cert: 'View certificate',
  emp_no_certs_recorded: 'No certificates recorded for this employee yet.',
  emp_no_history: 'No renewals recorded yet.',
  emp_no_equipment: 'No equipment is assigned to this employee.',
  emp_history_old: 'Previous expiry',
  emp_history_new: 'New expiry',
  emp_history_when: 'Renewed',
  emp_history_by: 'By',
  emp_equipment_item: 'Item',
  emp_equipment_serial: 'Serial no.',
  emp_equipment_verdict: 'Verdict',
  emp_archived_banner: 'This employee is archived. Unarchive them to make changes.',

  /* ---------- Archive / unarchive ---------- */
  emp_archive: 'Archive',
  emp_unarchive: 'Unarchive',
  emp_archive_title: 'Archive This Employee?',
  emp_archive_message: 'They stop appearing in the team lists and are blocked at every site check. Nothing is deleted — you can unarchive them at any time.',
  emp_archive_reason: 'Reason (optional)',
  emp_archive_reason_ph: 'Resigned, terminated…',
  emp_archive_status: 'Employment status',
  emp_archive_on_status_title: 'Archive Them Too?',
  emp_archive_on_status_message: '"{status}" is saved. Archiving also removes them from the team lists and files them under Resigned & Terminated. Leave it and they stay on the team list with that status.',
  emp_archive_on_status_decline: 'Not now',
  emp_err_status_not_terminal: 'That status does not mean the employee has left, so it cannot be used to archive them.',
  emp_archived_ok: 'Employee archived.',
  emp_unarchive_title: 'Unarchive This Employee?',
  emp_unarchive_message: 'They return to the team lists and are checked for compliance again.',
  emp_unarchived_ok: 'Employee unarchived.',
  emp_national_id_taken: 'Another active employee now holds that national ID. Resolve the duplicate first.',

  /* ---------- Form ---------- */
  emp_new_title: 'New Employee',
  emp_saved_ok: 'Employee saved.',
  emp_created_ok: 'Employee created.',
  emp_err_name_required: 'Enter the employee’s full name.',
  emp_err_national_id_required: 'Enter the national ID.',
  emp_err_national_id_duplicate: 'Another active employee already has that national ID.',
  emp_err_invalid_date: 'Use a valid date.',
  emp_err_unknown_option: 'Pick a value from the list.',
  emp_err_no_changes: 'Nothing has changed.',
  emp_cert_link_ph: 'https://drive.google.com/…',
  emp_team_locked: 'Team is set when the employee is created and cannot change.',

  /* The two per-certificate flags on the form (Section 6.1). Worded as what
     they mean, not as the column name: an admin ticking a box should not have
     to know the word "derivation". */
  emp_cert_na_label: 'Not required (N/A)',
  emp_cert_suspended_label: 'Course suspended',

  /* ---------- Renewals page ---------- */
  emp_renewals_intro: 'Every certificate coming up for renewal, soonest first.',
  emp_renewals_window: 'Window',
  emp_renewals_window_30: 'Next 30 days',
  emp_renewals_window_60: 'Next 60 days',
  emp_renewals_window_90: 'Next 90 days',
  emp_renewals_window_all: 'All, including expired',
  emp_renewals_cert: 'Certificate',
  emp_renewals_count: '{count} renewals',
  emp_renewals_none: 'No certificates fall inside this window.',
  emp_days_left: '{days}d left',
  emp_days_ago: '{days}d ago',

  /* ---------- RDT page ---------- */
  emp_rdt_intro: 'Monthly random selection and yearly coverage tracking.',
  emp_rdt_pct: '{pct}%',

  // Onboarding
  emp_rdt_enable_title: 'Random Drug Testing Is Not Set Up',
  emp_rdt_enable_body: 'Turn this on to run the monthly random selection and track coverage across the fiscal year. Defaults are an April–March year, 10% of the eligible pool each month, and a 120% yearly target — all adjustable in Settings afterwards.',
  emp_rdt_enable_button: 'Enable RDT',
  emp_rdt_enable_super_admin_only: 'Only a super admin can enable RDT.',
  emp_rdt_enabled: 'RDT is on.',
  emp_rdt_disabled: 'RDT is not enabled for this dataset.',

  // Yearly progress
  emp_rdt_fiscal_year: 'Fiscal year {label}',
  emp_rdt_pool_size: 'Eligible employees',
  emp_rdt_unique_tested: 'Employees tested',
  emp_rdt_coverage: 'Coverage',
  emp_rdt_target_progress: '{pct}% of the yearly target',
  emp_rdt_first_round_marker: 'First round complete',

  // Monthly selection
  emp_rdt_this_month: "This Month's Selection",
  emp_rdt_phase_first: 'First-round tests (Apr–Jan)',
  emp_rdt_phase_repeat: 'Repeat tests (Feb–Mar)',
  emp_rdt_quota_line: '{quota} of {pool} eligible ({pct}%)',
  emp_rdt_mcu_excluded: '{count} otherwise eligible employees are excluded this month — their medical check-up has expired, and the renewal includes a drug test.',
  emp_rdt_no_selection: 'No selection has been generated for this month yet.',
  emp_rdt_generate: 'Generate This Month',
  emp_rdt_regenerate: 'Regenerate',
  emp_rdt_regenerate_confirm: "Draw this month's list again? Picks not yet marked completed or missed will be discarded. Completed and missed entries are kept.",
  emp_rdt_generated: '{count} employees selected.',
  emp_rdt_no_candidates: 'Nobody is available to select for this phase right now.',

  // Row actions
  emp_rdt_mark_completed: 'Mark completed',
  emp_rdt_mark_missed: 'Mark missed',
  emp_rdt_swap: 'Swap',
  emp_rdt_edit: 'Edit',
  emp_rdt_revert: 'Undo',
  emp_rdt_delete: 'Delete',

  // Complete / edit dialog
  emp_rdt_complete_title: 'Record Test Result',
  emp_rdt_edit_title: 'Correct Test Result',
  emp_rdt_test_date: 'Test date',
  emp_rdt_result: 'Result',
  emp_rdt_result_pass: 'Pass',
  emp_rdt_result_fail: 'Fail',
  emp_rdt_notes: 'Notes',
  emp_rdt_date_required: 'Pick the date the test was carried out.',
  emp_rdt_completed: 'Test recorded.',
  emp_rdt_edited: 'Entry updated.',

  // Record a test that happened outside the monthly draw
  emp_rdt_record: 'Record a test',
  emp_rdt_record_title: 'Record a Drug Test',
  emp_rdt_record_intro: 'For a test carried out outside the monthly selection — a for-cause test, or one recorded on paper. It counts toward this year’s coverage like any other completed test.',
  emp_rdt_record_employee: 'Employee',
  emp_rdt_record_pick: '— Select an employee —',
  emp_rdt_record_manual: 'Enter the employee ID. The roster could not be loaded.',
  emp_rdt_record_save: 'Record test',
  emp_rdt_record_employee_required: 'Choose which employee was tested.',
  emp_rdt_record_employee_unknown: 'No employee with that ID.',
  emp_rdt_record_duplicate: 'This employee already has a test logged on that date.',
  emp_rdt_recorded: 'Test recorded for {name}.',
  emp_rdt_date_future: 'A test cannot be dated in the future.',
  emp_rdt_result_none: 'Not recorded',
  emp_rdt_result_none_hint: 'Leave as “Not recorded” when the outcome was never written down. The test still counts toward coverage.',

  // Importing past tests
  emp_rdt_import: 'Import past tests',
  emp_rdt_import_title: 'Import Past Drug Tests',
  emp_rdt_import_intro: 'For bringing historical tests onto the platform. Every row is imported as a completed test, and each one is filed under the fiscal year its date falls in.',
  emp_rdt_import_file: 'Spreadsheet',
  emp_rdt_import_hint: 'One row per test. Columns: National ID (or Employee ID), Test Date, and optionally Result and Notes.',
  emp_rdt_import_none: 'Pick a file to see what it contains.',
  emp_rdt_import_nothing: 'That file holds no usable test rows.',
  emp_rdt_import_count: '{count} tests',
  emp_rdt_import_with_result: '{count} carry a recorded result — the rest import with the result left blank.',
  emp_rdt_import_no_date: '{count} rows have no readable test date (line {rows}). Fix them in the file: nothing is imported until every row is valid.',
  emp_rdt_import_fix_dates: 'Fix the rows with no test date first — the import is all or nothing.',
  emp_rdt_import_too_many: 'That is more than {max} rows. Split the file: importing in chunks would risk writing half the history.',
  emp_rdt_import_save: 'Import tests',
  emp_rdt_import_row_errors: 'The server rejected {count} rows, starting at line {row}. Open the browser console for the full list.',
  emp_rdt_import_done: 'Imported {added} tests. {skipped} were already on record.',
  emp_rdt_import_years: 'By fiscal year — {breakdown}',

  // Miss
  emp_rdt_miss_title: 'Mark Test Missed',
  emp_rdt_miss_body: 'The employee returns to the untested pool and can be selected again in a later month.',
  emp_rdt_miss_reason: 'Reason',
  emp_rdt_miss_placeholder: 'On leave, refused, no-show…',
  emp_rdt_missed: 'Marked missed.',

  // Swap
  emp_rdt_swap_confirm: 'Replace {name} with a random draw from the remaining eligible pool?',
  emp_rdt_swapped: '{oldName} swapped for {newName}.',
  emp_rdt_swap_no_replacement: 'Nobody is left in the eligible pool to swap in. Mark the test missed instead.',

  // Revert and delete
  emp_rdt_revert_confirm: 'Return this entry to "selected"? The recorded date and result are cleared.',
  emp_rdt_reverted: 'Entry reset to selected.',
  emp_rdt_delete_confirm: 'Delete this entry? This cannot be undone.',
  emp_rdt_deleted: 'Entry deleted.',

  // Statuses
  emp_rdt_status_selected: 'Selected',
  emp_rdt_status_completed: 'Completed',
  emp_rdt_status_missed: 'Missed',

  // Recent activity + history
  emp_rdt_recent: 'Recent Activity',
  emp_rdt_view_history: 'View full log',
  emp_rdt_history_title: 'RDT Log',
  emp_rdt_history_sub: 'Every selection, completion and miss this fiscal year.',
  emp_rdt_history_empty: 'No RDT entries yet.',
  emp_rdt_filter_month: 'Month',
  emp_rdt_col_status: 'Status',
  emp_rdt_col_selected_at: 'Selected',
  emp_rdt_col_log_id: 'Log ID',
  emp_rdt_n_entries: '{count} entries',
  emp_rdt_export: 'Export log',

  /* ---------- Resigned page ---------- */
  emp_resigned_intro: 'Archived employees. Read-only — unarchive one to edit it again.',
  emp_resigned_none: 'Nobody is archived.',
  emp_resigned_count: '{count} archived',

  /* ---------- Verdict reasons (Sections 6.2, 6.4) ----------
     The other half of the derived block: the server sends {type, text_key,
     text_params} and the wording lives here. `{cert}` arrives as a raw cert key
     — officerCard.js translates it through CERT_LABEL_KEYS before it reaches
     t(), so an officer never reads "mcu expired 5 days ago". */
  reason_employment_status: 'Employment status is {status}, not Active',
  reason_archived: 'This employee is archived',
  reason_legal_permission: 'Legal permission is {status}, not Approved',
  reason_expired: '{cert} expired {days} days ago',
  reason_expiring: '{cert} expires in {days} days',
  reason_wah_suspended: '{cert} is suspended — the medical check-up has expired',
  reason_cert_suspended: '{cert} is suspended — the course has been withdrawn',

  /* ---------- Dashboard (Section 5.5) ----------
     The KPI row mixes units on purpose, so three of the four cards carry a note
     saying what they count. */
  emp_dash_kpi_total: 'Total Active Employees',
  emp_dash_split_field: '{count} field',
  emp_dash_split_safety: '{count} safety',
  emp_dash_kpi_expired: 'Certificates Expired',
  emp_dash_kpi_expired_note: 'certificates, not people',
  emp_dash_kpi_urgent: 'Expiring in ≤{days} Days',
  emp_dash_kpi_people_note: 'employees with at least one',
  emp_dash_kpi_compliant: 'Fully Compliant',
  emp_dash_kpi_compliant_note: 'every certificate valid',

  emp_dash_chart_by_cert: 'Expiries in Next {days} Days by Certificate',
  emp_dash_no_expiries: 'Nothing expires in this window.',
  emp_dash_chart_by_sub: 'Headcount by Subcontractor',
  emp_dash_no_subcontractors: 'No subcontractor is recorded on any employee.',

  emp_dash_chart_rdt: 'RDT Coverage',
  emp_dash_rdt_pct: '{pct}%',
  emp_dash_rdt_caption: '{tested} of {pool} tested · target {target}%',
  emp_dash_rdt_tests: '{count} tests recorded',
  emp_dash_rdt_since: 'since {date}',
  emp_dash_rdt_off: 'RDT Tracking Is Off',
  emp_dash_rdt_off_hint: 'Enable random drug testing on the RDT page to track coverage here.',

  emp_dash_recent: 'Recently Updated',
  emp_dash_recent_none: 'No employee has been updated yet.',
};

const ar = {
  /* ---------- Navigation ---------- */
  nav_field_team: 'الفريق الميداني',
  nav_safety_team: 'فريق السلامة',
  nav_renewals: 'التجديدات',
  nav_rdt: 'اختبار المخدرات',
  nav_resigned: 'المستقيلون والمنتهية خدمتهم',

  /* ---------- Certificates ---------- */
  cert_wah_practical: 'العمل على ارتفاع — عملي',
  cert_wah_theoretical: 'العمل على ارتفاع — نظري',
  cert_ra: 'تقييم المخاطر',
  cert_fa: 'الإسعافات الأولية',
  cert_ff: 'مكافحة الحريق',
  cert_ec: 'السلامة الكهربائية',
  cert_mcu: 'الفحص الطبي',
  cert_ppe: 'فحص مهمات الوقاية',
  cert_lifting: 'الرفع',
  cert_scaffolding: 'السقالات',

  /* ---------- Qualifications ---------- */
  qual_nebosh: 'نيبوش',
  qual_iso_45001: 'أيزو 45001',
  qual_osha: 'أوشا',

  /* ---------- Column headers ---------- */
  emp_col_name: 'الاسم',
  emp_col_national_id: 'الرقم القومي',
  emp_col_title: 'المسمى الوظيفي',
  emp_col_contractor: 'المقاول',
  emp_col_subcontractor: 'مقاول الباطن',
  emp_col_state: 'الحالة',
  emp_col_verdict: 'الفحص الميداني',
  emp_col_quals: 'المؤهلات',
  emp_col_updated: 'آخر تحديث',
  emp_col_certificate: 'الشهادة',
  emp_col_expiry: 'تاريخ الانتهاء',
  emp_col_days: 'الأيام',
  emp_col_employee: 'الموظف',
  emp_col_team: 'الفريق',
  emp_col_archived_on: 'تاريخ الأرشفة',

  /* ---------- Field labels ---------- */
  emp_field_name: 'الاسم بالكامل',
  emp_field_national_id: 'الرقم القومي',
  emp_field_title: 'المسمى الوظيفي',
  emp_field_contractor: 'المقاول',
  emp_field_subcontractor: 'مقاول الباطن',
  emp_field_hired_date: 'تاريخ التعيين',
  emp_field_employment_status: 'حالة التوظيف',
  emp_field_legal_permission: 'التصريح القانوني',
  emp_field_expiry_date: 'تاريخ الانتهاء',
  emp_field_cert_link: 'رابط الشهادة',

  /* ---------- Section headers ---------- */
  emp_section_personal: 'البيانات الشخصية',
  emp_section_certs: 'الشهادات',
  emp_section_quals: 'المؤهلات',
  emp_section_drug: 'اختبار المخدرات',
  emp_section_history: 'سجل التجديدات',
  emp_section_equipment: 'المعدات المخصصة',
  emp_section_record: 'تسجيل',

  /* ---------- List page ---------- */
  emp_add: '+ إضافة موظف',
  emp_search_placeholder: 'ابحث بالاسم أو الرقم القومي…',
  emp_filter_state: 'حالة الامتثال',
  emp_filter_title: 'المسمى الوظيفي',
  emp_filter_subcontractor: 'مقاول الباطن',
  emp_expired_count: '{count} منتهية',
  emp_none_yet: 'لا يوجد موظفون في هذا الفريق بعد.',

  /* ---------- Detail page ---------- */
  emp_not_found: 'هذا الموظف لم يعد موجودًا.',
  emp_open_cert: 'عرض الشهادة',
  emp_no_certs_recorded: 'لم تُسجَّل أي شهادات لهذا الموظف بعد.',
  emp_no_history: 'لا توجد تجديدات مسجلة بعد.',
  emp_no_equipment: 'لا توجد معدات مخصصة لهذا الموظف.',
  emp_history_old: 'الانتهاء السابق',
  emp_history_new: 'الانتهاء الجديد',
  emp_history_when: 'تاريخ التجديد',
  emp_history_by: 'بواسطة',
  emp_equipment_item: 'الصنف',
  emp_equipment_serial: 'الرقم التسلسلي',
  emp_equipment_verdict: 'النتيجة',
  emp_archived_banner: 'هذا الموظف مؤرشف. أعِد تفعيله لإجراء أي تعديل.',

  /* ---------- Archive / unarchive ---------- */
  emp_archive: 'أرشفة',
  emp_unarchive: 'إلغاء الأرشفة',
  emp_archive_title: 'أرشفة هذا الموظف؟',
  emp_archive_message: 'لن يظهر في قوائم الفرق وسيُمنع في كل فحص ميداني. لا يُحذف أي شيء — يمكنك إلغاء الأرشفة في أي وقت.',
  emp_archive_reason: 'السبب (اختياري)',
  emp_archive_reason_ph: 'استقالة، إنهاء خدمة…',
  emp_archive_status: 'حالة التوظيف',
  emp_archive_on_status_title: 'هل تريد أرشفته أيضًا؟',
  emp_archive_on_status_message: 'تم حفظ "{status}". الأرشفة تزيله أيضًا من قوائم الفرق وتدرجه ضمن المستقيلين والمنتهية خدمتهم. إن تركته فسيبقى في قائمة الفريق بهذه الحالة.',
  emp_archive_on_status_decline: 'ليس الآن',
  emp_err_status_not_terminal: 'هذه الحالة لا تعني أن الموظف قد ترك العمل، لذا لا يمكن استخدامها للأرشفة.',
  emp_archived_ok: 'تمت أرشفة الموظف.',
  emp_unarchive_title: 'إلغاء أرشفة هذا الموظف؟',
  emp_unarchive_message: 'سيعود إلى قوائم الفرق وسيخضع لفحص الامتثال مرة أخرى.',
  emp_unarchived_ok: 'تم إلغاء أرشفة الموظف.',
  emp_national_id_taken: 'يوجد موظف نشط آخر بنفس الرقم القومي. عالج التكرار أولًا.',

  /* ---------- Form ---------- */
  emp_new_title: 'موظف جديد',
  emp_saved_ok: 'تم حفظ بيانات الموظف.',
  emp_created_ok: 'تم إنشاء الموظف.',
  emp_err_name_required: 'أدخل اسم الموظف بالكامل.',
  emp_err_national_id_required: 'أدخل الرقم القومي.',
  emp_err_national_id_duplicate: 'يوجد موظف نشط آخر بنفس الرقم القومي.',
  emp_err_invalid_date: 'أدخل تاريخًا صحيحًا.',
  emp_err_unknown_option: 'اختر قيمة من القائمة.',
  emp_err_no_changes: 'لم يتغير أي شيء.',
  emp_cert_link_ph: 'https://drive.google.com/…',
  emp_team_locked: 'يُحدَّد الفريق عند الإنشاء ولا يمكن تغييره.',

  emp_cert_na_label: 'غير مطلوبة',
  emp_cert_suspended_label: 'الدورة موقوفة',

  /* ---------- Renewals page ---------- */
  emp_renewals_intro: 'كل الشهادات القادمة للتجديد، الأقرب أولًا.',
  emp_renewals_window: 'المدة',
  emp_renewals_window_30: 'خلال 30 يومًا',
  emp_renewals_window_60: 'خلال 60 يومًا',
  emp_renewals_window_90: 'خلال 90 يومًا',
  emp_renewals_window_all: 'الكل، بما فيها المنتهية',
  emp_renewals_cert: 'الشهادة',
  emp_renewals_count: '{count} تجديد',
  emp_renewals_none: 'لا توجد شهادات ضمن هذه المدة.',
  emp_days_left: 'باقي {days} يوم',
  emp_days_ago: 'منذ {days} يوم',

  /* ---------- RDT page ---------- */
  emp_rdt_intro: 'الاختيار العشوائي الشهري وتتبع التغطية السنوية.',
  emp_rdt_pct: '{pct}%',

  // Onboarding
  emp_rdt_enable_title: 'الاختبار العشوائي للمخدرات غير مُفعّل',
  emp_rdt_enable_body: 'فعّل هذه الخاصية لتشغيل الاختيار العشوائي الشهري وتتبع التغطية على مدار السنة المالية. الإعدادات الافتراضية: سنة من أبريل إلى مارس، 10% من المؤهلين كل شهر، وهدف سنوي 120% — وكلها قابلة للتعديل من الإعدادات لاحقًا.',
  emp_rdt_enable_button: 'تفعيل اختبار المخدرات',
  emp_rdt_enable_super_admin_only: 'التفعيل متاح للمشرف العام فقط.',
  emp_rdt_enabled: 'تم تفعيل اختبار المخدرات.',
  emp_rdt_disabled: 'اختبار المخدرات غير مُفعّل لهذه البيانات.',

  // Yearly progress
  emp_rdt_fiscal_year: 'السنة المالية {label}',
  emp_rdt_pool_size: 'الموظفون المؤهلون',
  emp_rdt_unique_tested: 'الموظفون الذين تم اختبارهم',
  emp_rdt_coverage: 'التغطية',
  emp_rdt_target_progress: '{pct}% من الهدف السنوي',
  emp_rdt_first_round_marker: 'اكتمال الجولة الأولى',

  // Monthly selection
  emp_rdt_this_month: 'اختيار هذا الشهر',
  emp_rdt_phase_first: 'اختبارات الجولة الأولى (أبريل–يناير)',
  emp_rdt_phase_repeat: 'اختبارات معادة (فبراير–مارس)',
  emp_rdt_quota_line: '{quota} من {pool} مؤهل ({pct}%)',
  emp_rdt_mcu_excluded: 'تم استبعاد {count} من الموظفين المؤهلين هذا الشهر — انتهى فحصهم الطبي، وتجديده يتضمن اختبار مخدرات.',
  emp_rdt_no_selection: 'لم يتم إنشاء اختيار لهذا الشهر بعد.',
  emp_rdt_generate: 'إنشاء اختيار هذا الشهر',
  emp_rdt_regenerate: 'إعادة الإنشاء',
  emp_rdt_regenerate_confirm: 'إعادة سحب قائمة هذا الشهر؟ سيتم حذف الاختيارات التي لم تُسجَّل كمكتملة أو فائتة. أما المكتملة والفائتة فتبقى كما هي.',
  emp_rdt_generated: 'تم اختيار {count} موظف.',
  emp_rdt_no_candidates: 'لا يوجد أحد متاح للاختيار في هذه المرحلة حاليًا.',

  // Row actions
  emp_rdt_mark_completed: 'تسجيل كمكتمل',
  emp_rdt_mark_missed: 'تسجيل كفائت',
  emp_rdt_swap: 'استبدال',
  emp_rdt_edit: 'تعديل',
  emp_rdt_revert: 'تراجع',
  emp_rdt_delete: 'حذف',

  // Complete / edit dialog
  emp_rdt_complete_title: 'تسجيل نتيجة الاختبار',
  emp_rdt_edit_title: 'تصحيح نتيجة الاختبار',
  emp_rdt_test_date: 'تاريخ الاختبار',
  emp_rdt_result: 'النتيجة',
  emp_rdt_result_pass: 'ناجح',
  emp_rdt_result_fail: 'راسب',
  emp_rdt_notes: 'ملاحظات',
  emp_rdt_date_required: 'اختر تاريخ إجراء الاختبار.',
  emp_rdt_completed: 'تم تسجيل الاختبار.',
  emp_rdt_edited: 'تم تحديث السجل.',

  // تسجيل اختبار جرى خارج الاختيار الشهري
  emp_rdt_record: 'تسجيل اختبار',
  emp_rdt_record_title: 'تسجيل اختبار مخدرات',
  emp_rdt_record_intro: 'لاختبار أُجري خارج الاختيار الشهري — اختبار بناءً على شبهة، أو اختبار مسجَّل ورقيًا. يُحتسب ضمن تغطية هذا العام مثل أي اختبار مكتمل.',
  emp_rdt_record_employee: 'الموظف',
  emp_rdt_record_pick: '— اختر موظفًا —',
  emp_rdt_record_manual: 'أدخل رقم الموظف. تعذّر تحميل قائمة الموظفين.',
  emp_rdt_record_save: 'تسجيل الاختبار',
  emp_rdt_record_employee_required: 'اختر الموظف الذي جرى اختباره.',
  emp_rdt_record_employee_unknown: 'لا يوجد موظف بهذا الرقم.',
  emp_rdt_record_duplicate: 'لهذا الموظف اختبار مسجَّل بالفعل في هذا التاريخ.',
  emp_rdt_recorded: 'تم تسجيل اختبار لـ {name}.',
  emp_rdt_date_future: 'لا يمكن أن يكون تاريخ الاختبار في المستقبل.',
  emp_rdt_result_none: 'غير مسجَّلة',
  emp_rdt_result_none_hint: 'اترك «غير مسجَّلة» إذا لم تُدوَّن النتيجة أصلًا. يُحتسب الاختبار ضمن التغطية على أي حال.',

  // استيراد الاختبارات السابقة
  emp_rdt_import: 'استيراد اختبارات سابقة',
  emp_rdt_import_title: 'استيراد اختبارات مخدرات سابقة',
  emp_rdt_import_intro: 'لنقل الاختبارات التاريخية إلى المنصة. يُستورد كل سطر كاختبار مكتمل، ويُدرَج ضمن السنة المالية التي يقع تاريخه فيها.',
  emp_rdt_import_file: 'ملف الجدول',
  emp_rdt_import_hint: 'سطر واحد لكل اختبار. الأعمدة: الرقم القومي (أو رقم الموظف)، وتاريخ الاختبار، واختياريًا النتيجة والملاحظات.',
  emp_rdt_import_none: 'اختر ملفًا لعرض محتواه.',
  emp_rdt_import_nothing: 'لا يحتوي هذا الملف على أسطر اختبار صالحة.',
  emp_rdt_import_count: '{count} اختبار',
  emp_rdt_import_with_result: '{count} منها تحمل نتيجة مسجَّلة — والباقي يُستورد بنتيجة فارغة.',
  emp_rdt_import_no_date: '{count} سطرًا بلا تاريخ اختبار مقروء (السطر {rows}). صحّحها في الملف: لا يُستورد شيء حتى تصح كل الأسطر.',
  emp_rdt_import_fix_dates: 'صحّح الأسطر التي بلا تاريخ اختبار أولًا — الاستيراد إما كامل أو لا شيء.',
  emp_rdt_import_too_many: 'العدد يتجاوز {max} سطر. قسّم الملف: الاستيراد على دفعات يخاطر بكتابة نصف السجل فقط.',
  emp_rdt_import_save: 'استيراد الاختبارات',
  emp_rdt_import_row_errors: 'رفض الخادم {count} سطرًا، بدءًا من السطر {row}. افتح وحدة تحكم المتصفح لعرض القائمة كاملة.',
  emp_rdt_import_done: 'تم استيراد {added} اختبار. و{skipped} كانت مسجَّلة بالفعل.',
  emp_rdt_import_years: 'حسب السنة المالية — {breakdown}',

  // Miss
  emp_rdt_miss_title: 'تسجيل الاختبار كفائت',
  emp_rdt_miss_body: 'يعود الموظف إلى مجموعة غير المختبَرين ويمكن اختياره مرة أخرى في شهر لاحق.',
  emp_rdt_miss_reason: 'السبب',
  emp_rdt_miss_placeholder: 'في إجازة، رفض، لم يحضر…',
  emp_rdt_missed: 'تم التسجيل كفائت.',

  // Swap
  emp_rdt_swap_confirm: 'استبدال {name} بموظف يُسحب عشوائيًا من المؤهلين المتبقين؟',
  emp_rdt_swapped: 'تم استبدال {oldName} بـ {newName}.',
  emp_rdt_swap_no_replacement: 'لم يتبق أحد في مجموعة المؤهلين للاستبدال. سجّل الاختبار كفائت بدلًا من ذلك.',

  // Revert and delete
  emp_rdt_revert_confirm: 'إعادة هذا السجل إلى حالة «مختار»؟ سيتم مسح التاريخ والنتيجة المسجلين.',
  emp_rdt_reverted: 'تمت إعادة السجل إلى «مختار».',
  emp_rdt_delete_confirm: 'حذف هذا السجل؟ لا يمكن التراجع عن ذلك.',
  emp_rdt_deleted: 'تم حذف السجل.',

  // Statuses
  emp_rdt_status_selected: 'مختار',
  emp_rdt_status_completed: 'مكتمل',
  emp_rdt_status_missed: 'فائت',

  // Recent activity + history
  emp_rdt_recent: 'النشاط الأخير',
  emp_rdt_view_history: 'عرض السجل الكامل',
  emp_rdt_history_title: 'سجل اختبار المخدرات',
  emp_rdt_history_sub: 'كل اختيار واكتمال وتفويت خلال السنة المالية.',
  emp_rdt_history_empty: 'لا توجد سجلات اختبار مخدرات بعد.',
  emp_rdt_filter_month: 'الشهر',
  emp_rdt_col_status: 'الحالة',
  emp_rdt_col_selected_at: 'تاريخ الاختيار',
  emp_rdt_col_log_id: 'رقم السجل',
  emp_rdt_n_entries: '{count} سجل',
  emp_rdt_export: 'تصدير السجل',

  /* ---------- Resigned page ---------- */
  emp_resigned_intro: 'الموظفون المؤرشفون. للعرض فقط — ألغِ الأرشفة للتعديل.',
  emp_resigned_none: 'لا يوجد موظفون مؤرشفون.',
  emp_resigned_count: '{count} مؤرشف',

  /* ---------- Verdict reasons (Sections 6.2, 6.4) ---------- */
  reason_employment_status: 'حالة التوظيف {status} وليست نشطًا',
  reason_archived: 'هذا الموظف مؤرشف',
  reason_legal_permission: 'التصريح القانوني {status} وليس معتمدًا',
  reason_expired: 'انتهت {cert} منذ {days} يومًا',
  reason_expiring: 'تنتهي {cert} خلال {days} يومًا',
  reason_wah_suspended: '{cert} موقوفة — انتهى الفحص الطبي',
  reason_cert_suspended: '{cert} موقوفة — تم سحب الدورة',

  /* ---------- Dashboard (Section 5.5) ---------- */
  emp_dash_kpi_total: 'إجمالي الموظفين النشطين',
  emp_dash_split_field: '{count} ميداني',
  emp_dash_split_safety: '{count} سلامة',
  emp_dash_kpi_expired: 'شهادات منتهية',
  emp_dash_kpi_expired_note: 'شهادات، وليس أشخاصًا',
  emp_dash_kpi_urgent: 'تنتهي خلال {days} يومًا أو أقل',
  emp_dash_kpi_people_note: 'موظفون لديهم شهادة واحدة على الأقل',
  emp_dash_kpi_compliant: 'ملتزمون بالكامل',
  emp_dash_kpi_compliant_note: 'كل الشهادات سارية',

  emp_dash_chart_by_cert: 'الشهادات المنتهية خلال {days} يومًا حسب النوع',
  emp_dash_no_expiries: 'لا شيء ينتهي خلال هذه المدة.',
  emp_dash_chart_by_sub: 'العدد حسب مقاول الباطن',
  emp_dash_no_subcontractors: 'لم يُسجَّل مقاول باطن لأي موظف.',

  emp_dash_chart_rdt: 'تغطية اختبار المخدرات',
  emp_dash_rdt_pct: '{pct}%',
  emp_dash_rdt_caption: 'تم اختبار {tested} من {pool} · المستهدف {target}%',
  emp_dash_rdt_tests: '{count} اختبار مسجل',
  emp_dash_rdt_since: 'منذ {date}',
  emp_dash_rdt_off: 'تتبع اختبار المخدرات غير مُفعّل',
  emp_dash_rdt_off_hint: 'فعّل الاختبار العشوائي للمخدرات من صفحة RDT لتتبع التغطية هنا.',

  emp_dash_recent: 'آخر التحديثات',
  emp_dash_recent_none: 'لم يُحدَّث أي موظف بعد.',
};

registerModuleDict('employees', { en, ar });
