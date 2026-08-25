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
  eqp_field_subcontractor: 'Owner / subcontractor',
  eqp_field_comments: 'Comments',
  eqp_field_wave_date: 'Date',
  eqp_field_wave_result: 'Result',
  eqp_field_rejection_date: 'Rejection date',
  eqp_field_rejection_reason: 'Rejection reason',

  /* ---------- Section headers ---------- */
  eqp_section_identity: 'Identification',
  eqp_section_inspection: 'Third-Party Inspection',
  eqp_section_waves: 'Internal Inspection Waves',
  eqp_section_issues: 'Issues Found',
  eqp_section_notes: 'Comments',
  eqp_section_history: 'Inspection History',
  eqp_section_assignment: 'Assignment',
  eqp_section_rejection: 'Rejection',

  /* ---------- List page ---------- */
  eqp_add: '+ Add equipment',
  eqp_search_placeholder: 'Search by serial number or item…',
  eqp_filter_verdict: 'Verdict',
  eqp_filter_item: 'Item type',
  eqp_filter_brand: 'Brand',
  eqp_filter_subcontractor: 'Owner',
  eqp_none_yet: 'No equipment recorded yet.',
  eqp_unassigned: 'Unassigned',
  eqp_owner_unknown: 'Owner not recorded',
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

  /* ---------- Inspection waves ---------- */
  nav_equipment_waves: 'Inspection Waves',
  eqp_col_comments: 'Comments',
  eqp_col_recorded_by: 'Recorded by',
  eqp_col_item: 'Item',
  eqp_col_date: 'Date',
  eqp_col_result: 'Result',

  eqp_wave_origin_officer: 'Officer, in the field',
  eqp_wave_origin_admin: 'Admin',
  eqp_wave_origin_migration: 'Imported from the old columns',

  eqp_wave_record: '+ Record wave',
  eqp_wave_record_title: 'Record an inspection wave',
  eqp_wave_record_confirm: 'Record wave',
  eqp_wave_correct: 'Correct',
  eqp_wave_correct_title: 'Correct wave {wave}',
  eqp_wave_void: 'Void',
  eqp_wave_saved: 'Inspection wave saved.',
  eqp_wave_more: '{count} older wave(s) not shown.',
  eqp_wave_view_all: 'View all {count} →',
  eqp_wave_view_log: 'Open the wave log →',
  eqp_wave_form_hint: 'Inspection waves are recorded on their own, not as a field of this item — so a wave keeps the date it happened, who recorded it, and what they found.',

  eqp_wave_field_date: 'Date of inspection',
  eqp_wave_field_result: 'Result',
  eqp_wave_field_comments: 'Comments',
  eqp_wave_comments_hint: 'What was found — condition, damage, anything the next inspection should know.',

  eqp_wave_void_title: 'Void wave {wave}?',
  eqp_wave_void_message: 'The wave stays on the record and stops counting toward the verdict. It is never deleted.',
  eqp_wave_void_confirm: 'Void it',
  eqp_wave_void_reason: 'Why is it being voided?',
  eqp_wave_void_reason_hint: 'e.g. recorded against the wrong item',
  eqp_wave_voided_note: 'Voided — {reason}',

  eqp_wave_err_date_required: 'Enter the date the inspection happened.',
  eqp_wave_err_future: 'An inspection cannot be dated in the future.',
  eqp_wave_err_result_required: 'Choose pass or fail.',
  eqp_wave_err_comments_long: 'That comment is too long.',
  eqp_wave_err_item_gone: 'That item has been rejected or no longer exists.',
  eqp_wave_err_voided: 'That wave has been voided and cannot be corrected.',

  /* ---------- The wave log page ---------- */
  eqp_waves_title: 'Inspection Waves',
  eqp_waves_sub: 'Every internal inspection across the fleet, newest first.',
  eqp_waves_sub_item: 'Every inspection recorded against {id}.',
  eqp_waves_empty: 'No inspection waves match these filters.',
  eqp_wave_filter_month: 'Month',
  eqp_wave_filter_origin: 'Recorded by',
  eqp_wave_filter_status: 'Review',
  eqp_wave_show_voided: 'Include voided',
  eqp_wave_n_entries: '{count} wave(s)',
  eqp_wave_export: 'Export',

  // --- Review (Section 6.3) ------------------------------------------------
  eqp_col_status: 'Review',
  eqp_wave_off_cycle: 'Off-cycle',
  eqp_wave_status_pending: 'Awaiting review',
  eqp_wave_status_approved: 'Approved',
  eqp_wave_status_rejected: 'Rejected',
  eqp_wave_status_voided: 'Voided',

  eqp_wave_approve: 'Approve',
  eqp_wave_approve_title: 'Approve wave {wave}?',
  eqp_wave_approve_confirm: 'Approve it',
  eqp_wave_approve_pass_message: 'The pass starts counting and the item can be cleared for use.',
  eqp_wave_approve_fail_message: 'The item stays blocked, now on a confirmed failed inspection.',

  eqp_wave_reject: 'Reject',
  eqp_wave_reject_title: 'Reject wave {wave}?',
  eqp_wave_reject_message: 'The inspection stays on the record and stops counting toward the verdict. The quarter’s wave opens up again for a re-inspection.',
  eqp_wave_reject_confirm: 'Reject it',
  eqp_wave_reject_reason: 'Why is it being rejected?',
  eqp_wave_reject_reason_hint: 'e.g. finding could not be confirmed on site',
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
  eqp_reject_title: 'Reject This Equipment',
  eqp_reject_intro: 'It stops appearing in the active list and is blocked at every site check. Nothing is deleted — you can return it to service at any time.',
  eqp_reject_reason_ph: 'Damaged beyond repair, failed inspection…',
  eqp_reject_confirm: 'Reject equipment',
  eqp_rejected_ok: 'Equipment rejected.',
  eqp_unreject_title: 'Return This Equipment to Service?',
  eqp_unreject_message: 'It returns to the active list and is checked for compliance again.',
  eqp_unrejected_ok: 'Equipment returned to service.',
  eqp_serial_taken: 'Another active item now holds one of these serial numbers. Resolve the duplicate first.',

  /* ---------- Rejected page ---------- */
  eqp_rejected_intro: 'Rejected equipment. Read-only — return an item to service to edit it again.',
  eqp_rejected_none: 'Nothing is rejected.',
  eqp_rejected_count: '{count} rejected',

  /* ---------- Form ---------- */
  eqp_new_title: 'New Equipment',
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
  reason_wave_pending_fail: 'An officer reported a failed inspection on {date}, awaiting review',
  reason_wave_pending_review: 'An inspection from {date} is waiting to be approved',
  reason_owner_archived: 'Assigned to {name}, who is archived — needs reassignment',

  /* ---------- Dashboard (Section 5.5) ---------- */
  eqp_dash_kpi_total: 'Total Active Equipment',
  eqp_dash_kpi_total_note: 'rejected items excluded',
  eqp_dash_kpi_expired: 'Inspections Expired',
  eqp_dash_kpi_missing_note: '{count} with no inspection date',
  eqp_dash_kpi_urgent: 'Expiring in ≤{days} Days',
  eqp_dash_kpi_rejected: 'Rejected This Month',
  eqp_dash_kpi_rejected_note: 'this calendar month',

  eqp_dash_chart_by_item: 'Inspections Expiring in Next {days} Days by Item Type',
  eqp_dash_no_expiries: 'No inspection ends in this window.',
  eqp_dash_chart_by_sub: 'Non-Compliant Equipment by Subcontractor',
  eqp_dash_sub_unrecorded: 'No owner recorded',
  eqp_dash_no_non_compliant: 'Every active item is cleared.',
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
  eqp_field_subcontractor: 'المالك / مقاول الباطن',
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
  eqp_filter_subcontractor: 'المالك',
  eqp_none_yet: 'لا توجد معدات مسجلة بعد.',
  eqp_unassigned: 'غير مخصصة',
  eqp_owner_unknown: 'المالك غير مسجل',
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

  /* ---------- موجات الفحص ---------- */
  nav_equipment_waves: 'موجات الفحص',
  eqp_col_comments: 'ملاحظات',
  eqp_col_recorded_by: 'سجّلها',
  eqp_col_item: 'الصنف',
  eqp_col_date: 'التاريخ',
  eqp_col_result: 'النتيجة',

  eqp_wave_origin_officer: 'مسؤول السلامة، في الموقع',
  eqp_wave_origin_admin: 'مشرف',
  eqp_wave_origin_migration: 'مستورد من الأعمدة القديمة',

  eqp_wave_record: '+ تسجيل موجة',
  eqp_wave_record_title: 'تسجيل موجة فحص داخلي',
  eqp_wave_record_confirm: 'تسجيل الموجة',
  eqp_wave_correct: 'تصحيح',
  eqp_wave_correct_title: 'تصحيح الموجة {wave}',
  eqp_wave_void: 'إلغاء',
  eqp_wave_saved: 'تم حفظ موجة الفحص.',
  eqp_wave_more: 'لا تظهر {count} موجة أقدم.',
  eqp_wave_view_all: 'عرض الكل ({count}) ←',
  eqp_wave_view_log: 'فتح سجل الموجات ←',
  eqp_wave_form_hint: 'تُسجَّل موجات الفحص بشكل مستقل وليست حقلاً في هذا الصنف — لتحتفظ كل موجة بتاريخ إجرائها ومَن سجّلها وما تم رصده.',

  eqp_wave_field_date: 'تاريخ الفحص',
  eqp_wave_field_result: 'النتيجة',
  eqp_wave_field_comments: 'ملاحظات',
  eqp_wave_comments_hint: 'ما تم رصده — الحالة، أي تلف، وأي شيء يجب أن تعرفه الموجة التالية.',

  eqp_wave_void_title: 'إلغاء الموجة {wave}؟',
  eqp_wave_void_message: 'تبقى الموجة في السجل ويتوقف احتسابها في الحكم. لا تُحذف أبداً.',
  eqp_wave_void_confirm: 'إلغاؤها',
  eqp_wave_void_reason: 'ما سبب الإلغاء؟',
  eqp_wave_void_reason_hint: 'مثال: سُجِّلت على صنف خاطئ',
  eqp_wave_voided_note: 'ملغاة — {reason}',

  eqp_wave_err_date_required: 'أدخل تاريخ إجراء الفحص.',
  eqp_wave_err_future: 'لا يمكن أن يكون تاريخ الفحص في المستقبل.',
  eqp_wave_err_result_required: 'اختر ناجح أو راسب.',
  eqp_wave_err_comments_long: 'الملاحظات طويلة أكثر من اللازم.',
  eqp_wave_err_item_gone: 'هذا الصنف مرفوض أو لم يعد موجوداً.',
  eqp_wave_err_voided: 'هذه الموجة ملغاة ولا يمكن تصحيحها.',

  /* ---------- صفحة سجل الموجات ---------- */
  eqp_waves_title: 'موجات الفحص',
  eqp_waves_sub: 'كل فحص داخلي على مستوى المعدات، الأحدث أولاً.',
  eqp_waves_sub_item: 'كل فحص مسجَّل على {id}.',
  eqp_waves_empty: 'لا توجد موجات فحص تطابق هذه المرشحات.',
  eqp_wave_filter_month: 'الشهر',
  eqp_wave_filter_origin: 'سجّلها',
  eqp_wave_filter_status: 'المراجعة',
  eqp_wave_show_voided: 'إظهار الملغاة',
  eqp_wave_n_entries: '{count} موجة',
  eqp_wave_export: 'تصدير',

  // --- Review (Section 6.3) ------------------------------------------------
  eqp_col_status: 'المراجعة',
  eqp_wave_off_cycle: 'خارج الدورة',
  eqp_wave_status_pending: 'بانتظار المراجعة',
  eqp_wave_status_approved: 'معتمدة',
  eqp_wave_status_rejected: 'مرفوضة',
  eqp_wave_status_voided: 'ملغاة',

  eqp_wave_approve: 'اعتماد',
  eqp_wave_approve_title: 'اعتماد الموجة {wave}؟',
  eqp_wave_approve_confirm: 'اعتمادها',
  eqp_wave_approve_pass_message: 'يبدأ احتساب النجاح ويمكن اعتماد الصنف للاستخدام.',
  eqp_wave_approve_fail_message: 'يظل الصنف محظوراً، والآن استناداً إلى فحص راسب مؤكَّد.',

  eqp_wave_reject: 'رفض',
  eqp_wave_reject_title: 'رفض الموجة {wave}؟',
  eqp_wave_reject_message: 'يبقى الفحص في السجل ويتوقف احتسابه في الحكم، وتُفتح موجة الربع من جديد لإعادة الفحص.',
  eqp_wave_reject_confirm: 'رفضها',
  eqp_wave_reject_reason: 'ما سبب الرفض؟',
  eqp_wave_reject_reason_hint: 'مثال: تعذّر تأكيد الملاحظة في الموقع',
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
  reason_wave_pending_fail: 'أبلغ مسؤول السلامة عن فحص راسب بتاريخ {date}، بانتظار المراجعة',
  reason_wave_pending_review: 'فحص بتاريخ {date} بانتظار الاعتماد',
  reason_owner_archived: 'مخصصة لـ {name} وهو مؤرشف — تحتاج إعادة تخصيص',

  /* ---------- Dashboard (Section 5.5) ---------- */
  eqp_dash_kpi_total: 'إجمالي المعدات النشطة',
  eqp_dash_kpi_total_note: 'باستثناء المرفوضة',
  eqp_dash_kpi_expired: 'فحوصات منتهية',
  eqp_dash_kpi_missing_note: '{count} بدون تاريخ فحص',
  eqp_dash_kpi_urgent: 'تنتهي خلال {days} يومًا أو أقل',
  eqp_dash_kpi_rejected: 'مرفوضة هذا الشهر',
  eqp_dash_kpi_rejected_note: 'خلال الشهر الميلادي الحالي',

  eqp_dash_chart_by_item: 'الفحوصات المنتهية خلال {days} يومًا حسب نوع الصنف',
  eqp_dash_no_expiries: 'لا ينتهي أي فحص خلال هذه المدة.',
  eqp_dash_chart_by_sub: 'المعدات غير الملتزمة حسب مقاول الباطن',
  eqp_dash_sub_unrecorded: 'المالك غير مسجل',
  eqp_dash_no_non_compliant: 'جميع المعدات النشطة مطابقة.',
};

registerModuleDict('equipment', { en, ar });
