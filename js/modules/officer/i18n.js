/* ==========================================================================
   officer/i18n.js — the officer app's strings, merged into the global
   dictionaries at boot (Section 5.1).

   Prefixed `off_` for the same reason every module prefixes: the dictionaries
   are merged flat, and a redefined key is a boot-time hard error (rule 12.4).

   What is NOT here, because the shell already owns it: username, password,
   sign_in, sign_out, refresh, back, retry, loading, the verdict labels, the
   cert state labels, and every err_* code. The officer app renders the same
   vocabulary as the admin app wherever it means the same thing — an officer and
   an admin looking at the same certificate must read the same word for it.

   The one deliberate divergence is `off_na`: Section 7.5 says a `missing` cert
   shows as "N/A" in the field, because from a tower "no date recorded" and "not
   applicable" are the same non-answer. The underlying state stays `missing`;
   only the label changes.
   ========================================================================== */

import { registerModuleDict } from '../../i18n/i18n.js';

const en = {
  /* ---------- Login ---------- */
  off_login_subtitle: 'Site check — officer sign-in',

  /* ---------- Home and search ---------- */
  off_search_placeholder: 'Name, National ID, or serial number…',
  off_search_hint: 'Search a crew member or a piece of equipment',
  off_recent: 'Recent Lookups',
  off_results: 'Results',
  off_no_results: 'Nothing matches that',
  off_clear_search: 'Clear',

  /* ---------- Sync strip ---------- */
  off_as_of: 'Data as of',
  off_sync: 'Sync',
  off_syncing: 'Syncing…',
  off_synced_ok: 'Data updated',
  off_sync_failed: 'Sync failed — you are still on your old data',
  off_age_today: 'today',
  off_age_days: '{days}d ago',
  off_stale_warn: 'Your data is {days} days old — sync soon',

  /* ---------- Sync page ---------- */
  off_sync_title: 'Sync Data',
  off_sync_intro: 'Pull the latest employees and equipment onto this phone. Do this before heading to a site with no signal.',
  off_last_synced: 'Last synced',
  off_never_synced: 'Never',
  off_sync_now: 'Sync now',

  /* ---------- Lockout (Section 7.4) ---------- */
  off_locked_title: 'Sync Required',
  off_locked_body: 'Your cached data is more than {hours} hours old. Sync before checking anyone. There is no way past this screen — if you have no signal, leave the site or call a colleague.',
  off_locked_never_title: 'Sync to Get Started',
  off_locked_never_body: 'This phone has no data yet. Sync once while you have signal, and site checks will work offline from then on.',
  off_locked_offline: 'Still no connection. Move to where you have signal and try again.',

  /* ---------- Verdict page ---------- */
  off_verdict_sub_cleared: 'Cleared to work',
  off_verdict_sub_warning: 'Cleared, but needs attention',
  off_verdict_sub_blocked: 'Do not allow work',
  off_issues: 'Issues Found',
  off_refreshed: 'Updated from the server',
  off_refresh_failed: 'Could not refresh — showing your cached data',
  off_refresh_gone: 'This record is no longer active. Sync to update your data.',
  off_not_found_title: 'Not in Your Data',
  off_not_found_body: 'This record is not in the snapshot on this phone. It may have been added since your last sync.',
  off_na: 'N/A',
  off_days_left: '{days}d left',
  off_days_ago: '{days}d ago',

  /* ---------- Recording an inspection wave ----------
     The one thing an officer can write (Section 3.8). The wording leans on
     "recorded" rather than "saved" throughout: a wave sitting in the outbox has
     been recorded by the officer and not yet saved by the server, and the
     difference is the whole reason the queue is visible at all. */
  off_wave_record: 'Record inspection',
  off_wave_record_title: 'Record an inspection',
  off_wave_submit: 'Record it',
  off_wave_field_date: 'Date',
  off_wave_field_result: 'Result',
  off_wave_field_comments: 'What did you find?',
  off_wave_comments_hint: 'Condition, damage, anything the next inspection should know.',
  off_wave_verdict_note: 'The verdict above updates once this reaches the server.',

  off_wave_saved: 'Inspection recorded.',
  off_wave_queued: 'Saved on this phone — it will upload when you have signal.',
  off_wave_none: 'No inspection recorded yet',
  off_wave_pending_label: 'Waiting to upload',
  off_wave_pending_note: '{count} inspection(s) on this phone are not on the record yet.',
  off_wave_pending_banner: '{count} inspection(s) waiting to upload.',
  off_wave_retry: 'Retry',
  off_wave_flush_sent: '{count} inspection(s) uploaded.',
  off_wave_flush_failed: '{count} inspection(s) could not be uploaded and were discarded.',
  off_wave_flush_offline: 'Still no connection — they are safe on this phone.',

  off_wave_err_date: 'Enter the date of the inspection.',
  off_wave_err_future: 'An inspection cannot be dated in the future.',
  off_wave_err_result: 'Choose pass or fail.',
  off_wave_err_comments_long: 'That is too long.',
  off_wave_err_item_gone: 'This item is no longer active. Sync to update your data.',

  off_signout_pending_title: 'Unsent inspections',
  off_signout_pending_message: '{count} inspection(s) on this phone have not reached the server. Signing out erases them. Get signal and try again, or sign out and lose them.',
  off_signout_discard: 'Sign out anyway',

  /* ---------- Result kinds ---------- */
  off_kind_employee: 'Employee',
  off_kind_equipment: 'Equipment',
};

const ar = {
  /* ---------- Login ---------- */
  off_login_subtitle: 'فحص الموقع — دخول ضابط السلامة',

  /* ---------- Home and search ---------- */
  off_search_placeholder: 'الاسم أو الرقم القومي أو الرقم التسلسلي…',
  off_search_hint: 'ابحث عن عامل أو معدة',
  off_recent: 'آخر عمليات البحث',
  off_results: 'النتائج',
  off_no_results: 'لا توجد نتائج مطابقة',
  off_clear_search: 'مسح',

  /* ---------- Sync strip ---------- */
  off_as_of: 'البيانات حتى',
  off_sync: 'مزامنة',
  off_syncing: 'جاري المزامنة…',
  off_synced_ok: 'تم تحديث البيانات',
  off_sync_failed: 'فشلت المزامنة — ما زلت على بياناتك القديمة',
  off_age_today: 'اليوم',
  off_age_days: 'منذ {days} يوم',
  off_stale_warn: 'عمر بياناتك {days} يوم — قم بالمزامنة قريباً',

  /* ---------- Sync page ---------- */
  off_sync_title: 'مزامنة البيانات',
  off_sync_intro: 'حمّل أحدث بيانات العاملين والمعدات على هذا الهاتف. افعل ذلك قبل التوجه لموقع بدون تغطية.',
  off_last_synced: 'آخر مزامنة',
  off_never_synced: 'لم تتم',
  off_sync_now: 'زامن الآن',

  /* ---------- Lockout (Section 7.4) ---------- */
  off_locked_title: 'المزامنة مطلوبة',
  off_locked_body: 'بياناتك المخزنة أقدم من {hours} ساعة. قم بالمزامنة قبل فحص أي شخص. لا يوجد تجاوز لهذه الشاشة — إذا لم تكن هناك تغطية، غادر الموقع أو اتصل بزميل.',
  off_locked_never_title: 'ابدأ بالمزامنة',
  off_locked_never_body: 'لا توجد بيانات على هذا الهاتف بعد. زامن مرة واحدة أثناء وجود تغطية، وستعمل الفحوصات بدون إنترنت بعدها.',
  off_locked_offline: 'ما زال لا يوجد اتصال. انتقل لمكان به تغطية وحاول مرة أخرى.',

  /* ---------- Verdict page ---------- */
  off_verdict_sub_cleared: 'مصرح له بالعمل',
  off_verdict_sub_warning: 'مصرح ولكن يحتاج انتباه',
  off_verdict_sub_blocked: 'لا تسمح بالعمل',
  off_issues: 'المشاكل الموجودة',
  off_refreshed: 'تم التحديث من الخادم',
  off_refresh_failed: 'تعذر التحديث — يتم عرض بياناتك المخزنة',
  off_refresh_gone: 'هذا السجل لم يعد نشطاً. قم بالمزامنة لتحديث بياناتك.',
  off_not_found_title: 'غير موجود في بياناتك',
  off_not_found_body: 'هذا السجل غير موجود في النسخة المخزنة على هذا الهاتف. ربما أُضيف بعد آخر مزامنة.',
  off_na: 'غير متاح',
  off_days_left: 'باقي {days} يوم',
  off_days_ago: 'منذ {days} يوم',

  /* ---------- تسجيل موجة فحص ---------- */
  off_wave_record: 'تسجيل فحص',
  off_wave_record_title: 'تسجيل فحص',
  off_wave_submit: 'تسجيل',
  off_wave_field_date: 'التاريخ',
  off_wave_field_result: 'النتيجة',
  off_wave_field_comments: 'ماذا رصدت؟',
  off_wave_comments_hint: 'الحالة، أي تلف، وأي شيء يجب أن يعرفه الفحص التالي.',
  off_wave_verdict_note: 'يتحدث الحكم أعلاه بمجرد وصول هذا الفحص إلى الخادم.',

  off_wave_saved: 'تم تسجيل الفحص.',
  off_wave_queued: 'محفوظ على هذا الهاتف — سيُرفع عند توفر الشبكة.',
  off_wave_none: 'لم يُسجَّل أي فحص بعد',
  off_wave_pending_label: 'في انتظار الرفع',
  off_wave_pending_note: '{count} فحص على هذا الهاتف لم يُسجَّل بعد في النظام.',
  off_wave_pending_banner: '{count} فحص في انتظار الرفع.',
  off_wave_retry: 'إعادة المحاولة',
  off_wave_flush_sent: 'تم رفع {count} فحص.',
  off_wave_flush_failed: 'تعذّر رفع {count} فحص وتم استبعادها.',
  off_wave_flush_offline: 'لا يزال الاتصال منقطعاً — الفحوصات محفوظة على هذا الهاتف.',

  off_wave_err_date: 'أدخل تاريخ الفحص.',
  off_wave_err_future: 'لا يمكن أن يكون تاريخ الفحص في المستقبل.',
  off_wave_err_result: 'اختر ناجح أو راسب.',
  off_wave_err_comments_long: 'النص طويل أكثر من اللازم.',
  off_wave_err_item_gone: 'هذا الصنف لم يعد نشطاً. قم بالمزامنة لتحديث بياناتك.',

  off_signout_pending_title: 'فحوصات لم تُرفع',
  off_signout_pending_message: '{count} فحص على هذا الهاتف لم يصل إلى الخادم. تسجيل الخروج سيمحوها. أعد المحاولة عند توفر الشبكة، أو سجّل الخروج وستفقدها.',
  off_signout_discard: 'تسجيل الخروج على أي حال',

  /* ---------- Result kinds ---------- */
  off_kind_employee: 'عامل',
  off_kind_equipment: 'معدة',
};

registerModuleDict('officer', { en, ar });
