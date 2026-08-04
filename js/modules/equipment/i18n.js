/* ==========================================================================
   equipment/i18n.js — the equipment module's strings, merged into the global
   dictionaries at boot (Section 5.1).

   Importing this file registers the keys. manifest.js imports it, and main.js
   imports the manifest, so the merge happens before the first render.

   Every key must exist in both languages, and a key that already exists
   anywhere is a boot-time hard error (rule 12.4). Module keys are prefixed
   `eqp_` unless they are unmistakably equipment-domain already (nav_equipment_*,
   reason_third_party_*) — that prefix is what keeps "Serial number" here from
   colliding with a future module's own.

   The `reason_*` keys are the other half of the derived block: Section 6.4 hands
   the frontend {text_key, text_params} for every blocker and warning, and the
   detail page passes them straight to t(). They live here because they are
   equipment's verdict vocabulary; the officer app will render the same strings
   from the same keys when it lands.

   Shared vocabulary — verdicts, cert states, Cancel/Confirm — is NOT here. It
   lives in js/i18n/en.js because components/badge.js renders it for every
   module.
   ========================================================================== */

import { registerModuleDict } from '../../i18n/i18n.js';

const en = {
  /* ---------- Navigation (Section 8.5) ---------- */
  nav_equipment_active: 'Active Equipment',
  nav_equipment_rejected: 'Rejected Equipment',

  /* ---------- Column headers ---------- */
  eqp_col_item: 'Item',
  eqp_col_brand: 'Brand',
  eqp_col_serial: 'Serial no.',
  eqp_col_third_party_sn: 'Third-party S/N',
  eqp_col_team_leader: 'Team leader',
  eqp_col_inspection: 'Inspection ends',
  eqp_col_verdict: 'Verdict',
  eqp_col_updated: 'Updated',
  eqp_col_rejected_on: 'Rejected on',
  eqp_col_rejection_reason: 'Reason',
  eqp_col_wave: 'Wave',
  eqp_col_date: 'Date',
  eqp_col_result: 'Result',

  /* ---------- Field labels ---------- */
  eqp_field_item: 'Item type',
  eqp_field_brand: 'Brand',
  eqp_field_serial_no: 'Serial number',
  eqp_field_third_party_sn: 'Third-party serial number',
  eqp_field_date_of_manufacture: 'Date of manufacture',
  eqp_field_third_party_end: 'Third-party inspection ends',
  eqp_field_team_leader: 'Assigned team leader',
  eqp_field_comments: 'Comments',
  eqp_field_wave_date: 'Date',
  eqp_field_wave_result: 'Result',
  eqp_field_rejection_date: 'Rejection date',
  eqp_field_rejection_reason: 'Rejection reason',

  /* ---------- Section headers ---------- */
  eqp_section_identity: 'Identification',
  eqp_section_inspection: 'Third-party inspection',
  eqp_section_waves: 'Internal inspection waves',
  eqp_section_issues: 'Issues found',
  eqp_section_notes: 'Comments',
  eqp_section_history: 'Inspection history',
  eqp_section_assignment: 'Assignment',
  eqp_section_rejection: 'Rejection',

  /* ---------- List page ---------- */
  eqp_add: '+ Add equipment',
  eqp_search_placeholder: 'Search by serial number or item…',
  eqp_filter_verdict: 'Verdict',
  eqp_filter_item: 'Item type',
  eqp_filter_brand: 'Brand',
  eqp_none_yet: 'No equipment recorded yet.',
  eqp_unassigned: 'Unassigned',
  eqp_owner_archived: 'Owner archived',

  /* ---------- Detail page ---------- */
  eqp_not_found: 'That equipment no longer exists.',
  eqp_no_history: 'No inspection changes recorded yet.',
  eqp_no_comments: 'No comments recorded.',
  eqp_no_issues: 'Nothing is blocking this item.',
  eqp_no_waves: 'No internal wave has been recorded yet.',
  eqp_history_old: 'Previous end date',
  eqp_history_new: 'New end date',
  eqp_history_when: 'Changed',
  eqp_history_by: 'By',
  eqp_wave_pass: 'Pass',
  eqp_wave_fail: 'Fail',
  eqp_wave_pending: 'Not run',
  eqp_wave_n: 'Wave {wave}',
  eqp_view_team_leader: 'Open employee',
  eqp_rejected_banner: 'This item is rejected and is blocked at every site check.',
  eqp_days_left: '{days}d left',
  eqp_days_ago: '{days}d ago',

  /* ---------- Team leader card ----------
     Equipment owns these labels rather than borrowing the employee module's:
     the dictionaries are merged globally, so `emp_col_title` would resolve —
     but it would make this page silently depend on a module it must not know
     about (rule 12). */
  eqp_leader_national_id: 'National ID',
  eqp_leader_title: 'Title',
  eqp_leader_subcontractor: 'Subcontractor',

  /* ---------- Reject / unreject ---------- */
  eqp_reject: 'Reject',
  eqp_unreject: 'Return to service',
  eqp_reject_title: 'Reject this equipment',
  eqp_reject_intro: 'It stops appearing in the active list and is blocked at every site check. Nothing is deleted — you can return it to service at any time.',
  eqp_reject_reason_ph: 'Damaged beyond repair, failed inspection…',
  eqp_reject_confirm: 'Reject equipment',
  eqp_rejected_ok: 'Equipment rejected.',
  eqp_unreject_title: 'Return this equipment to service?',
  eqp_unreject_message: 'It returns to the active list and is checked for compliance again.',
  eqp_unrejected_ok: 'Equipment returned to service.',
  eqp_serial_taken: 'Another active item now holds one of these serial numbers. Resolve the duplicate first.',

  /* ---------- Rejected page ---------- */
  eqp_rejected_intro: 'Rejected equipment. Read-only — return an item to service to edit it again.',
  eqp_rejected_none: 'Nothing is rejected.',
  eqp_rejected_count: '{count} rejected',

  /* ---------- Form ---------- */
  eqp_new_title: 'New equipment',
  eqp_saved_ok: 'Equipment saved.',
  eqp_created_ok: 'Equipment created.',
  eqp_err_serial_required: 'Enter the serial number.',
  eqp_err_third_party_sn_required: 'Enter the third-party serial number.',
  eqp_err_serial_duplicate: 'Another active item already has that serial number.',
  eqp_err_invalid_date: 'Use a valid date.',
  eqp_err_unknown_option: 'Pick a value from the list.',
  eqp_err_unknown_employee: 'That employee does not exist.',
  eqp_err_no_changes: 'Nothing has changed.',
  eqp_team_leader_none: '— Unassigned —',
  eqp_team_leader_manual: 'Enter the employee ID of the team leader. You do not have access to the employee list.',

  /* ---------- Verdict reasons (Sections 6.3, 6.4) ---------- */
  reason_equipment_rejected: 'Rejected: {reason}',
  reason_third_party_expired: 'Third-party inspection expired {days} days ago',
  reason_third_party_expiring: 'Third-party inspection ends in {days} days',
  reason_third_party_missing: 'No third-party inspection recorded',
  reason_wave_failed: 'Wave {wave} failed on {date}',
  reason_owner_archived: 'Assigned to {name}, who is archived — needs reassignment',
};

const ar = {
  /* ---------- Navigation ---------- */
  nav_equipment_active: 'المعدات النشطة',
  nav_equipment_rejected: 'المعدات المرفوضة',

  /* ---------- Column headers ---------- */
  eqp_col_item: 'الصنف',
  eqp_col_brand: 'الماركة',
  eqp_col_serial: 'الرقم التسلسلي',
  eqp_col_third_party_sn: 'الرقم التسلسلي للجهة الفاحصة',
  eqp_col_team_leader: 'قائد الفريق',
  eqp_col_inspection: 'انتهاء الفحص',
  eqp_col_verdict: 'النتيجة',
  eqp_col_updated: 'آخر تحديث',
  eqp_col_rejected_on: 'تاريخ الرفض',
  eqp_col_rejection_reason: 'السبب',
  eqp_col_wave: 'الموجة',
  eqp_col_date: 'التاريخ',
  eqp_col_result: 'النتيجة',

  /* ---------- Field labels ---------- */
  eqp_field_item: 'نوع الصنف',
  eqp_field_brand: 'الماركة',
  eqp_field_serial_no: 'الرقم التسلسلي',
  eqp_field_third_party_sn: 'الرقم التسلسلي للجهة الفاحصة',
  eqp_field_date_of_manufacture: 'تاريخ التصنيع',
  eqp_field_third_party_end: 'انتهاء فحص الجهة الخارجية',
  eqp_field_team_leader: 'قائد الفريق المسؤول',
  eqp_field_comments: 'ملاحظات',
  eqp_field_wave_date: 'التاريخ',
  eqp_field_wave_result: 'النتيجة',
  eqp_field_rejection_date: 'تاريخ الرفض',
  eqp_field_rejection_reason: 'سبب الرفض',

  /* ---------- Section headers ---------- */
  eqp_section_identity: 'بيانات التعريف',
  eqp_section_inspection: 'فحص الجهة الخارجية',
  eqp_section_waves: 'موجات الفحص الداخلي',
  eqp_section_issues: 'الملاحظات المرصودة',
  eqp_section_notes: 'ملاحظات',
  eqp_section_history: 'سجل الفحوصات',
  eqp_section_assignment: 'التخصيص',
  eqp_section_rejection: 'الرفض',

  /* ---------- List page ---------- */
  eqp_add: '+ إضافة معدة',
  eqp_search_placeholder: 'ابحث بالرقم التسلسلي أو الصنف…',
  eqp_filter_verdict: 'النتيجة',
  eqp_filter_item: 'نوع الصنف',
  eqp_filter_brand: 'الماركة',
  eqp_none_yet: 'لا توجد معدات مسجلة بعد.',
  eqp_unassigned: 'غير مخصصة',
  eqp_owner_archived: 'المسؤول مؤرشف',

  /* ---------- Detail page ---------- */
  eqp_not_found: 'هذه المعدة لم تعد موجودة.',
  eqp_no_history: 'لا توجد تغييرات فحص مسجلة بعد.',
  eqp_no_comments: 'لا توجد ملاحظات مسجلة.',
  eqp_no_issues: 'لا يوجد ما يمنع استخدام هذه المعدة.',
  eqp_no_waves: 'لم تُسجَّل أي موجة فحص داخلي بعد.',
  eqp_history_old: 'تاريخ الانتهاء السابق',
  eqp_history_new: 'تاريخ الانتهاء الجديد',
  eqp_history_when: 'تاريخ التغيير',
  eqp_history_by: 'بواسطة',
  eqp_wave_pass: 'ناجح',
  eqp_wave_fail: 'راسب',
  eqp_wave_pending: 'لم تُجرَ',
  eqp_wave_n: 'الموجة {wave}',
  eqp_view_team_leader: 'فتح ملف الموظف',
  eqp_rejected_banner: 'هذه المعدة مرفوضة وممنوعة في كل فحص ميداني.',
  eqp_days_left: 'باقي {days} يوم',
  eqp_days_ago: 'منذ {days} يوم',

  /* ---------- Team leader card ---------- */
  eqp_leader_national_id: 'الرقم القومي',
  eqp_leader_title: 'المسمى الوظيفي',
  eqp_leader_subcontractor: 'مقاول الباطن',

  /* ---------- Reject / unreject ---------- */
  eqp_reject: 'رفض',
  eqp_unreject: 'إعادة للخدمة',
  eqp_reject_title: 'رفض هذه المعدة',
  eqp_reject_intro: 'لن تظهر في قائمة المعدات النشطة وستُمنع في كل فحص ميداني. لا يُحذف أي شيء — يمكنك إعادتها للخدمة في أي وقت.',
  eqp_reject_reason_ph: 'تلف غير قابل للإصلاح، رسوب في الفحص…',
  eqp_reject_confirm: 'رفض المعدة',
  eqp_rejected_ok: 'تم رفض المعدة.',
  eqp_unreject_title: 'إعادة هذه المعدة للخدمة؟',
  eqp_unreject_message: 'ستعود إلى قائمة المعدات النشطة وتخضع لفحص الامتثال مرة أخرى.',
  eqp_unrejected_ok: 'تمت إعادة المعدة للخدمة.',
  eqp_serial_taken: 'يوجد صنف نشط آخر بأحد هذين الرقمين التسلسليين. عالج التكرار أولًا.',

  /* ---------- Rejected page ---------- */
  eqp_rejected_intro: 'المعدات المرفوضة. للعرض فقط — أعِد المعدة للخدمة لتتمكن من تعديلها.',
  eqp_rejected_none: 'لا توجد معدات مرفوضة.',
  eqp_rejected_count: '{count} مرفوضة',

  /* ---------- Form ---------- */
  eqp_new_title: 'معدة جديدة',
  eqp_saved_ok: 'تم حفظ بيانات المعدة.',
  eqp_created_ok: 'تم إنشاء المعدة.',
  eqp_err_serial_required: 'أدخل الرقم التسلسلي.',
  eqp_err_third_party_sn_required: 'أدخل الرقم التسلسلي للجهة الفاحصة.',
  eqp_err_serial_duplicate: 'يوجد صنف نشط آخر بنفس الرقم التسلسلي.',
  eqp_err_invalid_date: 'أدخل تاريخًا صحيحًا.',
  eqp_err_unknown_option: 'اختر قيمة من القائمة.',
  eqp_err_unknown_employee: 'هذا الموظف غير موجود.',
  eqp_err_no_changes: 'لم يتغير أي شيء.',
  eqp_team_leader_none: '— غير مخصصة —',
  eqp_team_leader_manual: 'أدخل رقم الموظف الخاص بقائد الفريق. لا تملك صلاحية الاطلاع على قائمة الموظفين.',

  /* ---------- Verdict reasons ---------- */
  reason_equipment_rejected: 'مرفوضة: {reason}',
  reason_third_party_expired: 'انتهى فحص الجهة الخارجية منذ {days} يوم',
  reason_third_party_expiring: 'ينتهي فحص الجهة الخارجية خلال {days} يوم',
  reason_third_party_missing: 'لا يوجد فحص جهة خارجية مسجل',
  reason_wave_failed: 'رسبت الموجة {wave} بتاريخ {date}',
  reason_owner_archived: 'مخصصة لـ {name} وهو مؤرشف — تحتاج إعادة تخصيص',
};

registerModuleDict('equipment', { en, ar });
