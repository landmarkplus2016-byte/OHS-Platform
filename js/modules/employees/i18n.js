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
  cert_ec: 'Emergency Care',
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
  emp_col_last_rdt: 'Last RDT',

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
  emp_field_rdt_1: 'RDT — wave 1',
  emp_field_rdt_2: 'RDT — wave 2',
  emp_field_rdt: 'RDT',

  /* ---------- Section headers ---------- */
  emp_section_personal: 'Personal details',
  emp_section_certs: 'Certificates',
  emp_section_quals: 'Qualifications',
  emp_section_drug: 'Drug testing',
  emp_section_history: 'Renewal history',
  emp_section_equipment: 'Assigned equipment',
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
  emp_archive_title: 'Archive this employee?',
  emp_archive_message: 'They stop appearing in the team lists and are blocked at every site check. Nothing is deleted — you can unarchive them at any time.',
  emp_archive_reason: 'Reason (optional)',
  emp_archive_reason_ph: 'Resigned, terminated…',
  emp_archived_ok: 'Employee archived.',
  emp_unarchive_title: 'Unarchive this employee?',
  emp_unarchive_message: 'They return to the team lists and are checked for compliance again.',
  emp_unarchived_ok: 'Employee unarchived.',
  emp_national_id_taken: 'Another active employee now holds that national ID. Resolve the duplicate first.',

  /* ---------- Form ---------- */
  emp_new_title: 'New employee',
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
  emp_rdt_intro: 'Employees eligible for testing — active, not archived, medical check-up not expired.',
  emp_rdt_wave: 'Wave',
  emp_rdt_wave_1: 'RDT wave 1',
  emp_rdt_wave_2: 'RDT wave 2',
  emp_rdt_wave_single: 'RDT (safety team)',
  emp_rdt_date: 'Test date',
  emp_rdt_record: 'Record wave',
  emp_rdt_selected: '{count} selected',
  emp_rdt_none_selected: 'Select at least one employee.',
  emp_rdt_date_required: 'Pick the date the test was carried out.',
  emp_rdt_recorded: 'Recorded for {count} employees.',
  emp_rdt_none_eligible: 'No employees are eligible for testing right now.',
  emp_rdt_confirm_title: 'Record this wave?',
  emp_rdt_confirm_message: '{count} employees will have {wave} set to {date}. Existing dates for that wave are overwritten.',

  /* ---------- Resigned page ---------- */
  emp_resigned_intro: 'Archived employees. Read-only — unarchive one to edit it again.',
  emp_resigned_none: 'Nobody is archived.',
  emp_resigned_count: '{count} archived',

  /* ---------- Dashboard (Section 5.5) ----------
     The KPI row mixes units on purpose, so three of the four cards carry a note
     saying what they count. */
  emp_dash_kpi_total: 'Total active employees',
  emp_dash_split_field: '{count} field',
  emp_dash_split_safety: '{count} safety',
  emp_dash_kpi_expired: 'Certificates expired',
  emp_dash_kpi_expired_note: 'certificates, not people',
  emp_dash_kpi_urgent: 'Expiring in ≤{days} days',
  emp_dash_kpi_people_note: 'employees with at least one',
  emp_dash_kpi_compliant: 'Fully compliant',
  emp_dash_kpi_compliant_note: 'every certificate valid',

  emp_dash_chart_by_cert: 'Expiries in next {days} days by certificate',
  emp_dash_no_expiries: 'Nothing expires in this window.',
  emp_dash_chart_by_sub: 'Headcount by subcontractor',
  emp_dash_no_subcontractors: 'No subcontractor is recorded on any employee.',

  emp_dash_chart_rdt: 'RDT coverage',
  emp_dash_rdt_pct: '{pct}%',
  emp_dash_rdt_caption: '{tested} of {pool} tested · target {target}%',
  emp_dash_rdt_tests: '{count} tests recorded',
  emp_dash_rdt_since: 'since {date}',
  emp_dash_rdt_off: 'RDT tracking is off',
  emp_dash_rdt_off_hint: 'Set rdt_year_start and rdt_target_pct for the employees module to track coverage here.',

  emp_dash_recent: 'Recently updated',
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
  cert_ec: 'الرعاية الطارئة',
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
  emp_col_last_rdt: 'آخر اختبار',

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
  emp_field_rdt_1: 'اختبار المخدرات — الموجة 1',
  emp_field_rdt_2: 'اختبار المخدرات — الموجة 2',
  emp_field_rdt: 'اختبار المخدرات',

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
  emp_rdt_intro: 'الموظفون المؤهلون للاختبار — نشطون، غير مؤرشفين، والفحص الطبي غير منتهٍ.',
  emp_rdt_wave: 'الموجة',
  emp_rdt_wave_1: 'اختبار المخدرات — الموجة 1',
  emp_rdt_wave_2: 'اختبار المخدرات — الموجة 2',
  emp_rdt_wave_single: 'اختبار المخدرات (فريق السلامة)',
  emp_rdt_date: 'تاريخ الاختبار',
  emp_rdt_record: 'تسجيل الموجة',
  emp_rdt_selected: 'تم تحديد {count}',
  emp_rdt_none_selected: 'اختر موظفًا واحدًا على الأقل.',
  emp_rdt_date_required: 'اختر تاريخ إجراء الاختبار.',
  emp_rdt_recorded: 'تم التسجيل لعدد {count} موظف.',
  emp_rdt_none_eligible: 'لا يوجد موظفون مؤهلون للاختبار حاليًا.',
  emp_rdt_confirm_title: 'تسجيل هذه الموجة؟',
  emp_rdt_confirm_message: 'سيتم ضبط {wave} بتاريخ {date} لعدد {count} موظف. ستُستبدل التواريخ الحالية لهذه الموجة.',

  /* ---------- Resigned page ---------- */
  emp_resigned_intro: 'الموظفون المؤرشفون. للعرض فقط — ألغِ الأرشفة للتعديل.',
  emp_resigned_none: 'لا يوجد موظفون مؤرشفون.',
  emp_resigned_count: '{count} مؤرشف',

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
  emp_dash_rdt_off_hint: 'اضبط rdt_year_start و rdt_target_pct لوحدة الموظفين لتتبع التغطية هنا.',

  emp_dash_recent: 'آخر التحديثات',
  emp_dash_recent_none: 'لم يُحدَّث أي موظف بعد.',
};

registerModuleDict('employees', { en, ar });
