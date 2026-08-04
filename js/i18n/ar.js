/* ==========================================================================
   ar.js — global Arabic strings.

   Must stay key-for-key identical to en.js. A key present here but missing
   there (or the reverse) is a bug — t() falls back to the raw key.
   ========================================================================== */

export const ar = {
  /* ---------- Branding ---------- */
  app_name: 'منصة السلامة والصحة المهنية',
  company_name: 'لاندمارك',
  app_sub: 'السلامة والصحة المهنية',

  /* ---------- Login ---------- */
  sign_in: 'دخول',
  signing_in: '…جاري الدخول',
  username: 'اسم المستخدم',
  password: 'كلمة السر',
  username_required: 'أدخل اسم المستخدم.',
  password_required: 'أدخل كلمة السر.',
  invalid_credentials: 'اسم المستخدم أو كلمة السر غير صحيحة.',
  session_expired: 'انتهت الجلسة. برجاء تسجيل الدخول مرة أخرى.',

  /* ---------- First-time setup / server connection ---------- */
  first_time_setup: 'الإعداد لأول مرة',
  script_url_prompt: 'هذا الجهاز غير متصل بعد. الصق رابط تطبيق Apps Script للمتابعة. اطلبه من خالد إذا لم يكن لديك.',
  script_url_label: 'رابط تطبيق Apps Script',
  script_url_required: 'أدخل رابط تطبيق Apps Script.',
  script_url_invalid: 'يجب أن يبدأ الرابط بـ https://',
  save: 'حفظ',
  save_and_continue: 'حفظ ومتابعة',
  cannot_reach_server: 'تعذر الوصول إلى الخادم',
  cannot_reach_server_body: 'لم يتمكن التطبيق من الاتصال بتطبيق Apps Script. تحقق من الاتصال بالإنترنت، أو من صحة رابط الخادم المحفوظ على هذا الجهاز.',
  retry: 'إعادة المحاولة',
  change_server_url: 'تغيير رابط الخادم',
  loading: '…جاري التحميل',

  /* ---------- Change password ---------- */
  change_password_title: 'تغيير كلمة السر',
  change_password_intro: 'قبل المتابعة، اختر كلمة سر لا يعرفها غيرك.',
  current_password: 'كلمة السر الحالية',
  current_password_required: 'أدخل كلمة السر الحالية.',
  current_password_incorrect: 'كلمة السر الحالية غير صحيحة.',
  new_password: 'كلمة السر الجديدة',
  new_password_required: 'أدخل كلمة السر الجديدة.',
  confirm_new_password: 'تأكيد كلمة السر الجديدة',
  password_too_short: 'يجب ألا تقل كلمة السر عن ٨ أحرف.',
  passwords_dont_match: 'كلمتا السر غير متطابقتين.',
  password_changed_ok: 'تم تغيير كلمة السر.',
  sign_out: 'تسجيل الخروج',

  /* ---------- API error codes (api.js err.code → message) ---------- */
  err_forbidden: 'ليس لديك صلاحية للقيام بذلك.',
  err_not_found: 'غير موجود.',
  err_validation_failed: 'برجاء مراجعة الحقول المحددة.',
  err_conflict: 'هذا التعديل يتعارض مع البيانات الحالية. حدّث الصفحة وحاول مرة أخرى.',
  err_rate_limited: 'طلبات كثيرة جدًا. برجاء التمهل.',
  err_server_error: 'حدث خطأ في الخادم.',
  err_network_error: 'تعذر الوصول إلى الخادم. تحقق من الاتصال بالإنترنت.',
  err_no_script_url: 'هذا الجهاز غير متصل بخادم بعد.',

  /* ---------- Language ---------- */
  lang_en: 'EN',
  lang_ar: 'ع',

  /* ---------- Themes (swatch tooltips) ---------- */
  theme_blue: 'أزرق',
  theme_teal: 'أزرق مخضر',
  theme_purple: 'بنفسجي',
  theme_crimson: 'قرمزي',

  /* ---------- Roles (sidebar user chip) ---------- */
  role_super_admin: 'مدير عام',
  role_module_admin: 'مدير وحدة',
  role_officer: 'مسؤول سلامة',

  /* ---------- Module display names ---------- */
  module_employees: 'الموظفون',
  module_equipment: 'المعدات',
  module_officer: 'فحص الموقع',

  /* ---------- Sidebar group headers (Section 8.5) ---------- */
  group_employees: 'الموظفون',
  group_equipment: 'المعدات',
  group_system: 'النظام',

  /* ---------- Navigation ---------- */
  nav_dashboard: 'لوحة المعلومات',
  nav_equipment_active: 'المعدات النشطة',
  nav_equipment_rejected: 'المعدات المرفوضة',
  nav_export: 'التصدير',
  nav_settings: 'الإعدادات',

  /* ---------- Certificate states (Section 6.1) ---------- */
  state_suspended: 'موقوفة',
  state_expired: 'منتهية',
  state_urgent: 'عاجلة',
  state_soon: 'قريبة',
  state_missing: 'غير مسجلة',
  state_valid: 'سارية',

  /* ---------- Verdicts (Sections 6.2, 6.3) ---------- */
  verdict_cleared: 'مسموح',
  verdict_warning: 'تحذير',
  verdict_blocked: 'ممنوع',

  /* ---------- Teams ---------- */
  team_field: 'ميداني',
  team_safety: 'سلامة',

  /* ---------- Shared UI verbs and nouns ---------- */
  cancel: 'إلغاء',
  confirm: 'تأكيد',
  edit: 'تعديل',
  view: 'عرض',
  back: 'رجوع',
  refresh: 'تحديث',
  search: 'بحث',
  saving: 'جارٍ الحفظ…',
  actions: 'إجراءات',
  filter_all: 'الكل',
  select_all: 'تحديد الكل',
  clear_selection: 'مسح',
  no_results: 'لا توجد نتائج مطابقة للفلاتر الحالية.',
  loading_data: 'جارٍ التحميل…',
  field_required: 'هذا الحقل مطلوب.',
  showing_count: 'عرض {shown} من {total}',
  page_x_of_y: 'صفحة {page} من {pages}',
  prev_page: 'السابق',
  next_page: 'التالي',
  open_link: 'فتح',

  /* ---------- Placeholders (each is replaced by its real page) ---------- */
  placeholder_dashboard: 'لوحة المعلومات (مؤقت)',
  placeholder_settings: 'الإعدادات (مؤقت)',
  placeholder_export: 'التصدير (مؤقت)',
  placeholder_equipment_active: 'المعدات النشطة (مؤقت)',
  placeholder_equipment_rejected: 'المعدات المرفوضة (مؤقت)',
  placeholder_officer_home: 'الصفحة الرئيسية للمفتش (مؤقت)',
  placeholder_officer_sync: 'مزامنة بيانات المفتش (مؤقت)',
  placeholder_officer_locked: 'قفل بسبب قدم البيانات (مؤقت)',
  placeholder_officer_verdict_employee: 'نتيجة فحص الموظف (مؤقت)',
  placeholder_officer_verdict_equipment: 'نتيجة فحص المعدة (مؤقت)',
  placeholder_not_found: 'الصفحة غير موجودة.',
};
