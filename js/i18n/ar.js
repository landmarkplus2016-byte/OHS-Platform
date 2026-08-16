/* ==========================================================================
   ar.js — global Arabic strings.

   Must stay key-for-key identical to en.js. A key present here but missing
   there (or the reverse) is a bug — t() falls back to the raw key.
   ========================================================================== */

export const ar = {
  /* ---------- Branding ---------- */
  app_name: 'منصة السلامة والصحة المهنية',
  company_name: 'لاندمارك بلس',
  app_sub: 'السلامة والصحة المهنية',
  copyright: '{company} © {year}',

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
  nav_export: 'التصدير',
  nav_settings: 'الإعدادات',
  nav_more: 'المزيد',
  nav_menu: 'التنقل',
  close: 'إغلاق',

  /* ---------- Certificate states (Section 6.1) ---------- */
  state_suspended: 'موقوفة',
  state_expired: 'منتهية',
  state_urgent: 'عاجلة',
  state_soon: 'قريبة',
  state_missing: 'غير مسجلة',
  state_valid: 'سارية',
  state_na: 'غير مطلوبة',

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

  /* ---------- Dashboard shell (Section 5.5) ---------- */
  dash_greeting: 'أهلًا بعودتك، {name}.',
  dash_no_modules: 'ليس لديك صلاحية عرض أي وحدة حتى الآن. اطلب من خالد منحك صلاحية.',

  /* ---------- Settings (Sections 3.3, 3.4, 3.7) ---------- */
  settings_sub: 'إعدادات المنصة الخاصة بـ {company}.',
  settings_tab_users: 'المستخدمون',
  settings_tab_lists: 'القوائم',
  settings_tab_thresholds: 'الحدود',
  settings_tab_data: 'البيانات',

  /* Users tab */
  settings_add_user: '+ إضافة مستخدم',
  settings_create_user: 'إنشاء مستخدم',
  settings_edit_user: 'تعديل المستخدم',
  settings_display_name: 'الاسم المعروض',
  settings_role: 'الدور',
  settings_active: 'نشط',
  settings_permissions: 'الصلاحيات',
  settings_show_inactive: 'إظهار الحسابات المعطّلة',
  settings_user_count: '{count} حساب',
  settings_no_users: 'لا توجد حسابات بعد.',
  settings_col_last_login: 'آخر دخول',
  settings_never: 'أبدًا',
  settings_you: 'أنت',
  settings_username_locked: 'اسم المستخدم هو معرّف الدخول ولا يمكن تغييره. كل سجلات التدقيق تشير إلى رقم المستخدم بدلًا منه.',
  settings_first_password: 'كلمة المرور الأولى',
  settings_first_password_hint: '٨ أحرف على الأقل. سيُطلب من المستخدم تغييرها عند أول دخول.',
  settings_perm_module: 'الوحدة',
  settings_perm_view: 'عرض',
  settings_perm_edit: 'تعديل',
  settings_perm_hint: 'منح التعديل يمنح العرض معه. المدير العام والمفتشون لا يستخدمون هذا الجدول.',
  settings_perm_all: 'كل الوحدات',
  settings_perm_officer: 'الفحص الميداني فقط',
  settings_perm_none: 'لا توجد صلاحيات',
  settings_reset_password: 'إعادة تعيين كلمة المرور',
  settings_reset_password_for: 'إعادة تعيين كلمة مرور {name}',
  settings_reset_password_intro: 'سيتم تسجيل خروجه من كل الأجهزة وسيُطلب منه تغيير كلمة المرور عند أول دخول. لا تحتاج إلى كلمة مروره الحالية.',
  settings_password_reset_ok: 'تمت إعادة تعيين كلمة المرور.',
  settings_deactivate: 'تعطيل',
  settings_reactivate: 'إعادة تفعيل',
  settings_deactivate_title: 'تعطيل هذا الحساب؟',
  settings_deactivate_message: 'سيتم تسجيل خروج {name} من كل الأجهزة ولن يستطيع الدخول حتى إعادة التفعيل. لا يُحذف أي شيء — تُحفظ صلاحياته لحين عودته.',
  settings_user_created: 'تم إنشاء الحساب.',
  settings_user_saved: 'تم حفظ الحساب.',
  settings_user_deactivated: 'تم تعطيل الحساب.',
  settings_user_reactivated: 'تمت إعادة تفعيل الحساب.',
  settings_err_username_required: 'أدخل اسم المستخدم.',
  settings_err_display_name_required: 'أدخل الاسم المعروض.',
  settings_err_username_taken: 'اسم المستخدم هذا مستخدم بالفعل.',
  settings_err_last_super_admin: 'هذا آخر مدير عام نشط. عيّن مديرًا عامًا آخر أولًا.',

  /* Lists tab */
  settings_lists_intro: 'خيارات القوائم المنسدلة في كل النماذج. حذف خيار يعطّله فقط — السجلات التي تحمله تستمر في عرضه.',
  settings_option_value: 'الخيار',
  settings_sort_order: 'الترتيب',
  settings_add_option: '+ إضافة خيار',
  settings_remove: 'حذف',
  settings_unsaved: 'غير محفوظ',
  settings_list_empty: 'لا توجد خيارات في هذه القائمة بعد.',
  settings_no_lists: 'لا توجد قوائم خيارات معرّفة.',
  settings_list_saved: 'تم حفظ {list}.',
  settings_err_blank_option: 'كل خيار يحتاج إلى قيمة. أدخلها أو احذف السطر.',

  /* FieldOptions lists */
  list_field_titles: 'المسميات الوظيفية للفريق الميداني',
  list_safety_titles: 'المسميات الوظيفية لفريق السلامة',
  list_contractors: 'المقاولون',
  list_subcontractors: 'مقاولو الباطن',
  list_employment_status: 'حالة التوظيف',
  list_legal_permission: 'التصريح القانوني',
  list_equipment_items: 'أصناف المعدات',
  list_equipment_brands: 'ماركات المعدات',

  /* Thresholds tab */
  settings_thresholds_intro: 'إعدادات على مستوى المنصة. حدود الامتثال تغيّر كل الحالات والنتائج، لذلك تُحدَّث القوائم فور الحفظ.',
  settings_urgent_days: 'حد الإنذار العاجل (أيام)',
  settings_urgent_days_hint: 'الشهادة التي تنتهي خلال هذا العدد من الأيام تُعرض كـ«عاجل».',
  settings_soon_days: 'حد الإنذار القريب (أيام)',
  settings_soon_days_hint: 'بعد هذا الحد تكون الشهادة «سارية» فقط. لا توجد مرحلة ثالثة.',
  settings_session_hours: 'مدة الجلسة (ساعات)',
  settings_session_hours_hint: 'مدة صلاحية تسجيل الدخول، تُحسب من وقت الدخول ولا تمتد بالنشاط.',
  settings_stale_hours: 'حد قِدَم بيانات المفتش (ساعات)',
  settings_stale_hours_hint: 'المفتش الذي تتجاوز بياناته هذا الحد يُقفل عليه التطبيق حتى يزامن. بلا استثناء.',
  settings_threshold_rule: 'يجب أن يكون حد الإنذار العاجل أصغر من حد الإنذار القريب، وإلا أصبحت إحدى المرحلتين غير قابلة للوصول.',

  /* ---------- إعدادات اختبار المخدرات (ModuleSettings، وحدة الموظفين) ---------- */
  settings_rdt_title: 'الاختبار العشوائي للمخدرات',
  settings_rdt_intro: 'القواعد التي يعمل بها الاختيار الشهري. تغييرها يغيّر من سيُسحب الشهر القادم، أما السجلات المسجَّلة بالفعل فلا تتأثر.',
  settings_rdt_enabled: 'تشغيل الاختبار العشوائي للمخدرات',
  settings_rdt_enabled_hint: 'الإيقاف يخفي البرنامج ويعرض بطاقة تفعيل في صفحة RDT. تُحفظ السجلات الموجودة.',
  settings_rdt_fy_start: 'شهر بداية السنة المالية',
  settings_rdt_fy_start_hint: 'من 1 إلى 12. لاندمارك تبدأ من أبريل حتى مارس، أي 4.',
  settings_rdt_monthly_pct: 'الهدف الشهري (%)',
  settings_rdt_monthly_pct_hint: 'نسبة المؤهلين التي تُسحب كل شهر، مقرَّبة لأقرب شخص.',
  settings_rdt_yearly_pct: 'الهدف السنوي (%)',
  settings_rdt_yearly_pct_hint: 'هدف التغطية للسنة. 120% تعني اختبار الجميع مرة، وخُمس المجموعة مرة ثانية.',
  settings_rdt_hire_grace: 'مهلة التعيين الجديد (أشهر)',
  settings_rdt_hire_grace_hint: 'الموظفون الجدد مشمولون بالفحص الطبي عند التعيين خلال هذه المدة ولا يُسحبون قبل انقضائها.',
  settings_rdt_repeat_months: 'أشهر مرحلة الإعادة',
  settings_rdt_repeat_months_hint: 'أرقام أشهر مفصولة بفواصل تسحب من الموظفين الذين تم اختبارهم هذا العام. الافتراضي 2,3 أي فبراير ومارس.',
  settings_rdt_repeat_invalid: 'أشهر الإعادة يجب أن تكون أرقامًا من 1 إلى 12 مفصولة بفواصل.',
  settings_rdt_safety_title: 'المسمى الوظيفي المشمول في فريق السلامة',
  settings_rdt_safety_title_hint: 'المسمى الوحيد الذي يُختبر من فريق السلامة. أما الفريق الميداني فيُختبر بكل المسميات.',
  settings_config_saved: 'تم حفظ الإعدادات.',
  settings_err_out_of_range: 'يجب أن تكون قيمة {field} بين {min} و {max}.',

  /* Data tab */
  settings_data_intro: 'الاستيراد الجماعي، ومجلد Drive المشترك، ومحتوى الجدول الحالي.',
  settings_import_into: 'استيراد {module}',
  settings_import_file: 'ملف الجدول',
  settings_import_hint: 'ملف ‎.xlsx أو ‎.csv. تُطابَق أسماء الأعمدة بمرونة، فتعمل «الرقم القومي» و national_id و NationalID جميعًا. ستراجع كل صف قبل كتابة أي شيء.',
  settings_import_reading: 'جارٍ قراءة الملف ومقارنته بالبيانات المخزنة…',
  settings_import_ok: 'تم الاستيراد: {added} مضاف، {updated} محدَّث، {skipped} متخطّى.',
  settings_import_result: 'آخر استيراد: {added} مضاف، {updated} محدَّث، {skipped} متخطّى.',
  settings_import_row_error: 'الصف رقم {row} في الملف مرفوض ({fields}). لم تُكتب أي بيانات — صحّح هذا الصف ثم أعد الاستيراد.',

  /* Import review modal */
  import_review_title: 'مراجعة استيراد {module}',
  import_commit: 'استيراد الصفوف المحددة',
  import_summary: '{total} صف · {importing} للاستيراد · {overwriting} للاستبدال · {skipped} متخطّى',
  import_col_row: 'السطر',
  import_col_record: 'السجل',
  import_col_status: 'الحالة',
  import_col_reasons: 'ملاحظات',
  import_col_action: 'الإجراء',
  import_col_lists: 'القوائم',
  import_status_new: 'جديد',
  import_status_duplicate: 'موجود بالفعل',
  import_status_unknown_option: 'قيمة قائمة جديدة',
  import_status_conflict: 'مكرر داخل الملف',
  import_status_blocked: 'غير قابل للاستيراد',
  import_action_import: 'استيراد',
  import_action_overwrite: 'استبدال',
  import_action_skip: 'تخطّي',
  import_add_to_list: 'إضافة القيمة',
  import_bulk_overwrite: 'استبدال كل الموجود',
  import_bulk_skip_dupes: 'تخطّي كل الموجود',
  import_bulk_import_new: 'استيراد كل الجديد',
  import_warnings_title: '{count} ملاحظة تحتاج مراجعة',
  import_warnings_more: '…و {count} أخرى في سجل المتصفح.',
  import_reason_duplicate: '{key} مسجَّل بالفعل باسم {name}',
  import_reason_duplicate_in_file: '{key} مكرر أكثر من مرة في هذا الملف',
  import_reason_unknown_option: '«{value}» غير موجودة في قائمة {field} بعد',
  import_reason_bad_option: '«{value}» ليست قيمة صحيحة لـ {field} — صحّحها في الملف',
  import_err_nothing_selected: 'كل الصفوف مضبوطة على «تخطّي». اختر صفًا واحدًا على الأقل للاستيراد.',

  /* Spreadsheet parsing warnings */
  import_warn_no_header: 'لم يُعثر على صف عناوين في «{sheet}» — لم تُقرأ منه أي بيانات.',
  import_warn_unmapped: '«{sheet}»: لم يتم التعرف على هذه الأعمدة وسيتم تجاهلها — {cols}',
  import_warn_bad_date: 'السطر {row} في «{sheet}»: «{value}» ليست تاريخًا يمكن للمنصة قراءته، لذلك تُرك فارغًا.',
  import_warn_row_skipped: 'السطر {row} في «{sheet}» بلا قيمة تعريفية وتم تخطّيه.',
  import_warn_no_named_sheets: 'لم يُعثر على ورقة باسم فريق، لذلك قُرئت «{sheet}» بدلًا منها. تأكد أن كل صف يحمل عمود الفريق.',

  /* ---------- Export (Sections 3.5, 3.6) ---------- */
  export_intro: 'نزّل مجموعة مفلترة من السجلات. لا يُقتطع أي شيء — إذا كانت المجموعة أكبر من حد الصيغة، تُعطَّل تلك الصيغة.',
  export_include_archived: 'تضمين المؤرشفين',
  export_include_rejected: 'تضمين المرفوضة',
  export_match_count: '{count} سجل مطابق',
  export_excel: 'إكسل',
  export_excel_desc: 'صف لكل سجل بكل الأعمدة. قابل لإعادة الاستيراد كما هو.',
  export_csv: 'CSV',
  export_csv_desc: 'نفس أعمدة إكسل كنص عادي.',
  export_pdf: 'بطاقات PDF',
  export_pdf_desc: 'صفحة قابلة للطباعة لكل سجل.',
  export_preparing: 'جارٍ تجهيز الملف…',
  export_empty: 'لا توجد سجلات مطابقة لهذه الفلاتر.',
  export_limit_pdf: 'العدد أكبر من أن يُصدَّر كـ PDF — ضيّق الفلاتر إلى {cap} أو أقل.',
  export_limit_spreadsheet: 'العدد أكبر من أن يُصدَّر في ملف واحد — ضيّق الفلاتر إلى {cap} أو أقل.',
  export_caps_note: 'حد PDF هو {pdf} سجل، وحد إكسل و CSV هو {spreadsheet}.',

  settings_drive_folder: 'مجلد Drive',
  settings_drive_folder_label: 'رابط المجلد المشترك',
  settings_drive_folder_hint: 'مكان حفظ ملفات التصدير. المنصة لا ترفع أي ملف بنفسها — هذا هو الرابط الذي تفتحه لك.',

  settings_health: 'حالة الجدول',
  settings_health_tab: 'السجلات',
  settings_health_rows: 'النشط',
  settings_health_updated: 'آخر تغيير',
  settings_health_note: 'الأعداد لا تشمل الموظفين المؤرشفين ولا المعدات المرفوضة.',
  settings_next_employee_number: 'رقم الموظف التالي',
  settings_next_equipment_number: 'رقم المعدة التالي',

  /* Spreadsheet parsing */
  import_err_no_library: 'لم تُحمَّل مكتبة الجداول. تحقق من الاتصال وأعد تحميل الصفحة.',
  import_err_no_file: 'اختر ملفًا أولًا.',
  import_err_unreadable: 'تعذّرت قراءة هذا الملف.',
  import_err_unparseable: 'هذا الملف ليس جدولًا تستطيع المنصة قراءته.',
  import_err_empty_workbook: 'لا يحتوي هذا الملف على أي أوراق.',
  import_err_no_rows: 'الورقة تحتوي على صف عناوين فقط بدون بيانات.',

  /* ---------- Not found ---------- */
  placeholder_not_found: 'الصفحة غير موجودة.',
};
