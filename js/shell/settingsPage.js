/* ==========================================================================
   settingsPage.js — the super admin's control panel. Four tabs, one file
   (Section 9.1 gives settings exactly one file).

     Users       accounts and per-module permissions   (Section 3.4)
     Lists       the FieldOptions dropdowns            (Section 3.7)
     Thresholds  the Config values                     (Section 3.3)
     Data        bulk import, Drive folder, Sheet health

   WHO GETS HERE
   -------------
   Super admins only, enforced in three places that have to stay in step:
   router.js marks the route `superAdminOnly`, sidebar.js hides the nav item,
   and every action this page calls re-checks `is_super_admin` server-side. The
   first two are UX; the third is the gate (rule 5).

   THE FOCUS RULE (Section 9.3)
   ----------------------------
   The Lists and Thresholds tabs are full of text inputs bound to state. None of
   them redraws on keystroke — an `input` listener writes straight into the
   draft and returns, and only a structural change (adding a row, saving,
   leaving a field, switching tab) calls render(). The field the user is typing
   in is never rebuilt mid-word.

   DRAFTS
   ------
   Lists and Thresholds edit a draft copy, not the server's data, and show an
   "unsaved" state until Save succeeds. Parking the draft on UI means a redraw —
   a toast, a language switch — cannot silently discard half an hour of list
   editing.
   ========================================================================== */

import { UI, CURRENT_USER, CONFIG } from '../state.js';
import { api } from '../api.js';
import { render } from '../render.js';
import { t } from '../i18n/i18n.js';
import { escapeHtml, fmtDateTime, EMPTY_MARK } from '../utils/format.js';
import { sha256Hex } from '../utils/crypto.js';
import { isSuperAdmin } from '../utils/permissions.js';
import { MODULE_NAMES, ROLES } from '../constants/globals.js';
import { toast, toastSuccess, toastError } from '../components/toast.js';
import { confirmDialog, formDialog } from '../components/modal.js';
import { statusBadge } from '../components/badge.js';
import {
  parseWorkbook, buildImportPreview, summarizePreview, pendingListAdditions,
  chunkRows, ImportError, IMPORT_MAX_ROWS,
} from '../utils/excelImport.js';
import { IMPORT_SPECS } from '../constants/importSpecs.js';

/* ---------- Page constants ------------------------------------------------ */

const TABS = [
  { key: 'users',      labelKey: 'settings_tab_users' },
  { key: 'lists',      labelKey: 'settings_tab_lists' },
  { key: 'thresholds', labelKey: 'settings_tab_thresholds' },
  { key: 'data',       labelKey: 'settings_tab_data' },
];

/** Roles a super admin may assign, in the order the select offers them. */
const ASSIGNABLE_ROLES = [ROLES.SUPER_ADMIN, ROLES.MODULE_ADMIN, ROLES.OFFICER];

/**
 * The permission modules the checkbox grid offers. Officers and super admins
 * never reach the table (Section 3.4), so the grid is only shown for module
 * admins — `vehicles` is deliberately absent until that module ships and joins
 * REGISTERED_MODULES in Auth.gs.
 */
const PERMISSION_MODULES = [
  { module: MODULE_NAMES.EMPLOYEES, labelKey: 'module_employees' },
  { module: MODULE_NAMES.EQUIPMENT, labelKey: 'module_equipment' },
];

/**
 * The Config keys the Thresholds tab edits, with the bounds its inputs enforce.
 *
 * NOT here: `plan_days`. Section 6.1 is explicit that the 90-day tier was
 * removed and no cert state maps to it; the key is not in the Apps Script
 * allowlist either, so an input for it would be a control that writes nothing.
 *
 * `drive_folder_url` is a Config key too, but it belongs on the Data tab beside
 * the exports that will use it, not in a list of compliance thresholds.
 */
const THRESHOLD_FIELDS = [
  { key: 'urgent_days',          labelKey: 'settings_urgent_days',   min: 1, max: 365 },
  { key: 'soon_days',            labelKey: 'settings_soon_days',     min: 2, max: 365 },
  { key: 'session_expiry_hours', labelKey: 'settings_session_hours', min: 1, max: 168 },
  { key: 'max_stale_hours',      labelKey: 'settings_stale_hours',   min: 1, max: 720 },
];

/**
 * The RDT programme's settings, which live on ModuleSettings under `employees`
 * rather than in Config (Section 2).
 *
 * They sit on the Thresholds tab because that is what they are — the numbers
 * the RDT selection derives from. A fifth tab for seven fields would be more
 * furniture than content.
 *
 * `type` decides the control: `number` bounds-checks against min/max, `text`
 * takes whatever is typed, `bool` renders a checkbox and writes TRUE/FALSE.
 */
const RDT_SETTING_FIELDS = [
  { key: 'rdt_enabled', type: 'bool', labelKey: 'settings_rdt_enabled' },
  { key: 'rdt_fiscal_year_start_month', type: 'number', labelKey: 'settings_rdt_fy_start', min: 1, max: 12 },
  { key: 'rdt_monthly_target_pct', type: 'number', labelKey: 'settings_rdt_monthly_pct', min: 0, max: 100 },
  { key: 'rdt_yearly_target_pct', type: 'number', labelKey: 'settings_rdt_yearly_pct', min: 0, max: 1000 },
  { key: 'rdt_hire_grace_months', type: 'number', labelKey: 'settings_rdt_hire_grace', min: 0, max: 60 },
  { key: 'rdt_repeat_months', type: 'text', labelKey: 'settings_rdt_repeat_months' },
  { key: 'rdt_safety_title', type: 'text', labelKey: 'settings_rdt_safety_title' },
];

/** What a missing RDT setting reads as. Mirrors RDT_DEFAULTS in Rdt.gs. */
const RDT_SETTING_DEFAULTS = {
  rdt_enabled: 'FALSE',
  rdt_fiscal_year_start_month: '4',
  rdt_monthly_target_pct: '10',
  rdt_yearly_target_pct: '120',
  rdt_hire_grace_months: '3',
  rdt_repeat_months: '2,3',
  rdt_safety_title: 'Safety Officer',
};

/**
 * Read-only Config rows the Data tab reports. These are server-owned counters —
 * Config.gs keeps them out of ALLOWED_CONFIG_KEYS so an admin cannot set them
 * and mint duplicate IDs — shown here because "what is the next ID" is a fair
 * question to ask of the Sheet.
 */
const COUNTER_KEYS = ['next_employee_number', 'next_equipment_number'];

/**
 * Where the Data tab can import to. The spec behind each key — column aliases,
 * duplicate rules, which lists a value is checked against — lives in
 * js/constants/importSpecs.js.
 */
const IMPORT_TARGETS = [
  { key: MODULE_NAMES.EMPLOYEES, labelKey: 'module_employees' },
  { key: MODULE_NAMES.EQUIPMENT, labelKey: 'module_equipment' },
];

/**
 * Page size and cap for the walk that loads existing records before a preview.
 * 25 × 200 covers 5,000 rows, which is the import cap, so the walk can always
 * see everything an import could collide with.
 */
const IMPORT_WALK_PAGE_SIZE = 200;
const IMPORT_WALK_MAX_PAGES = 25;

/* ---------- State --------------------------------------------------------- */

function pageState() {
  if (!UI.settings) {
    UI.settings = {
      tab: 'users',

      users: { status: 'idle', seq: 0, data: null, error: null, includeInactive: false, busy: false },
      lists: { status: 'idle', seq: 0, data: null, error: null, draft: null, saving: '' },
      config: { status: 'idle', seq: 0, data: null, error: null, draft: null, saving: false },
      rdt: { status: 'idle', seq: 0, data: null, error: null, draft: null, saving: false },
      health: { status: 'idle', seq: 0, data: null, error: null },

      // One import slot per target, keyed the way IMPORT_TARGETS is.
      imports: {},
    };
  }
  return UI.settings;
}

/** The per-target import slot, created on first use. */
function importState(key) {
  const s = pageState();

  if (!s.imports[key]) {
    s.imports[key] = {
      fileName: '',
      busy: false,     // reading the file and loading what it will be compared against
      error: null,
      result: null,    // totals from the last successful commit
    };
  }
  return s.imports[key];
}

/* ---------- Loading ------------------------------------------------------- */

/**
 * "Fetch once into this slot."
 *
 * The four tabs load four unrelated things and every one needs the same guards:
 * do not refetch while in flight, do not refetch what is already good, and drop
 * an answer a newer request has overtaken.
 *
 * @param {Object} slot  one of the state slots above
 * @param {function(): Promise<Object>} fetcher
 * @param {{force?: boolean}} [opts]
 */
async function loadInto(slot, fetcher, opts) {
  if (slot.status === 'loading') return;
  if (!(opts && opts.force) && slot.status !== 'idle') return;

  const mySeq = ++slot.seq;
  slot.status = 'loading';
  slot.error = null;
  render();

  try {
    const data = await fetcher();
    if (mySeq !== slot.seq) return;

    slot.data = data;
    slot.status = 'ready';
  } catch (err) {
    if (mySeq !== slot.seq) return;

    slot.status = 'error';
    slot.error = err;
    console.error('[settings] load failed:', err);
  }

  render();
}

/** list_users with the current "show inactive" setting. */
function fetchUsers() {
  return api.call('list_users', { include_inactive: pageState().users.includeInactive });
}

/** list_field_options, unwrapped to the {list_key: [...]} map. */
async function fetchFieldOptions() {
  const data = await api.call('list_field_options', {});
  return data.options || {};
}

/** Kick off whatever the visible tab needs. Cheap once the data is in hand. */
function loadActiveTab() {
  const s = pageState();

  if (s.tab === 'users') {
    loadInto(s.users, fetchUsers);
    return;
  }

  if (s.tab === 'lists') {
    loadInto(s.lists, fetchFieldOptions);
    return;
  }

  if (s.tab === 'thresholds') {
    loadInto(s.config, () => api.call('list_config', {}));
    loadInto(s.rdt, () => api.call('list_module_settings', { module: MODULE_NAMES.EMPLOYEES }));
    return;
  }

  if (s.tab === 'data') {
    loadInto(s.config, () => api.call('list_config', {}));

    // The health panel reports on three tabs of the Sheet at once, so it asks
    // for all three. allSettled keeps one refusal from blanking the panel —
    // it reports what it got and an em dash for what it did not.
    loadInto(s.health, async () => {
      const [employees, equipment, users] = await Promise.allSettled([
        api.call('list_employee_stats', {}),
        api.call('list_equipment_stats', {}),
        api.call('list_users', { include_inactive: true }),
      ]);

      return {
        employees: employees.status === 'fulfilled' ? employees.value : null,
        equipment: equipment.status === 'fulfilled' ? equipment.value : null,
        users: users.status === 'fulfilled' ? users.value : null,
      };
    });
  }
}

/* ---------- Shared rendering bits ----------------------------------------- */

/** What a panel shows while loading or after a failure. */
function slotState(slot, retryAction) {
  if (slot.status === 'error') {
    return `<div class="cell-empty">
      ${escapeHtml(t('err_' + ((slot.error && slot.error.code) || 'server_error')))}
      <button type="button" class="btn btn-ghost btn-sm"
              data-action="${escapeHtml(retryAction)}">${escapeHtml(t('retry'))}</button>
    </div>`;
  }
  return `<div class="cell-empty">${escapeHtml(t('loading_data'))}</div>`;
}

/** One <option>, marked selected when it matches. */
function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

/** An on/off switch — styled as a switch, a real checkbox underneath. */
function toggle(attrs, checked, label) {
  return `
    <label class="switch" title="${escapeHtml(label)}">
      <input type="checkbox" ${attrs} ${checked ? 'checked' : ''}
             aria-label="${escapeHtml(label)}">
      <span class="switch-track"><span class="switch-knob"></span></span>
    </label>`;
}

/* ==========================================================================
   TAB 1 — Users (Section 3.4)
   ========================================================================== */

/** The permission checkbox grid inside the user modal. */
function permissionGridHtml(permissions) {
  const byModule = new Map((permissions || []).map((p) => [p.module, p]));

  return `
    <div class="perm-grid">
      <div class="perm-row perm-head">
        <span>${escapeHtml(t('settings_perm_module'))}</span>
        <span>${escapeHtml(t('settings_perm_view'))}</span>
        <span>${escapeHtml(t('settings_perm_edit'))}</span>
      </div>
      ${PERMISSION_MODULES.map((entry) => {
        const grant = byModule.get(entry.module) || {};
        const label = t(entry.labelKey);

        return `
          <div class="perm-row">
            <span>${escapeHtml(label)}</span>
            <input type="checkbox" data-perm-view="${escapeHtml(entry.module)}"
                   ${grant.can_view ? 'checked' : ''}
                   aria-label="${escapeHtml(label + ' — ' + t('settings_perm_view'))}">
            <input type="checkbox" data-perm-edit="${escapeHtml(entry.module)}"
                   ${grant.can_edit ? 'checked' : ''}
                   aria-label="${escapeHtml(label + ' — ' + t('settings_perm_edit'))}">
          </div>`;
      }).join('')}
    </div>`;
}

/**
 * The user form. `user` is null when adding.
 *
 * Adding collects a first password; editing does not. Changing someone else's
 * password is `reset_user_password` — a different action with different
 * consequences (it signs them out everywhere and forces another change on next
 * login), and burying it inside a general Save is how a password gets reset by
 * accident.
 */
function userFormHtml(user) {
  const isEdit = !!user;
  const role = isEdit ? user.role : ROLES.MODULE_ADMIN;

  return `
    <div class="field">
      <label for="user-username">${escapeHtml(t('username'))}</label>
      <input id="user-username" type="text" autocomplete="off" spellcheck="false"
             value="${escapeHtml(isEdit ? user.username : '')}" ${isEdit ? 'disabled' : ''}>
      ${isEdit ? `<div class="field-hint">${escapeHtml(t('settings_username_locked'))}</div>` : ''}
    </div>

    <div class="field">
      <label for="user-display-name">${escapeHtml(t('settings_display_name'))}</label>
      <input id="user-display-name" type="text" autocomplete="off"
             value="${escapeHtml(isEdit ? user.display_name : '')}">
    </div>

    ${isEdit ? '' : `
      <div class="field">
        <label for="user-password">${escapeHtml(t('settings_first_password'))}</label>
        <input id="user-password" type="password" autocomplete="new-password">
        <div class="field-hint">${escapeHtml(t('settings_first_password_hint'))}</div>
      </div>

      <div class="field">
        <label for="user-password-2">${escapeHtml(t('confirm_new_password'))}</label>
        <input id="user-password-2" type="password" autocomplete="new-password">
      </div>`}

    <div class="field">
      <label for="user-role">${escapeHtml(t('settings_role'))}</label>
      <select id="user-role">
        ${ASSIGNABLE_ROLES.map((r) => option(r, t('role_' + r), role)).join('')}
      </select>
    </div>

    <label class="check">
      <input type="checkbox" id="user-active" ${!isEdit || user.active ? 'checked' : ''}>
      ${escapeHtml(t('settings_active'))}
    </label>

    <div class="perm-section" data-perm-section>
      <div class="field-label">${escapeHtml(t('settings_permissions'))}</div>
      ${permissionGridHtml(isEdit ? user.permissions : [])}
      <div class="field-hint">${escapeHtml(t('settings_perm_hint'))}</div>
    </div>`;
}

/**
 * Show the permission grid only for module admins, and keep view ticked
 * whenever edit is.
 *
 * The server applies that same implication (normalizePermissionsInput_). A
 * checkbox pair that disagrees with what gets saved is worse than no checkbox.
 */
function bindUserForm(root) {
  const roleSelect = root.querySelector('#user-role');
  const section = root.querySelector('[data-perm-section]');

  function syncRole() {
    section.hidden = roleSelect.value !== ROLES.MODULE_ADMIN;
  }

  roleSelect.addEventListener('change', syncRole);
  syncRole();

  root.querySelectorAll('[data-perm-edit]').forEach((editBox) => {
    editBox.addEventListener('change', () => {
      if (!editBox.checked) return;

      const viewBox = root.querySelector(`[data-perm-view="${editBox.dataset.permEdit}"]`);
      if (viewBox) viewBox.checked = true;
    });
  });

  root.querySelectorAll('[data-perm-view]').forEach((viewBox) => {
    viewBox.addEventListener('change', () => {
      if (viewBox.checked) return;

      const editBox = root.querySelector(`[data-perm-edit="${viewBox.dataset.permView}"]`);
      if (editBox) editBox.checked = false;
    });
  });
}

/** Read the permission grid back out. */
function readPermissions(root) {
  return PERMISSION_MODULES.map((entry) => ({
    module: entry.module,
    can_view: !!root.querySelector(`[data-perm-view="${entry.module}"]`).checked,
    can_edit: !!root.querySelector(`[data-perm-edit="${entry.module}"]`).checked,
  }));
}

/**
 * An ApiError as text for the super admin.
 *
 * Two server answers get their own sentence because they are the two that will
 * actually come up: a username already taken, and the last-super-admin guard
 * (rule 20). Everything else falls back to the generic code text.
 */
function userErrorText(err) {
  const code = err && err.code;

  if (code === 'validation_failed' && err.field_errors && err.field_errors.username === 'duplicate') {
    return t('settings_err_username_taken');
  }
  if (code === 'conflict' && err.message === 'cannot_demote_last_super_admin') {
    return t('settings_err_last_super_admin');
  }
  return t('err_' + (code || 'server_error'));
}

/** Mark the user list stale and redraw; bind() refetches. */
function invalidateUsers() {
  pageState().users.status = 'idle';
  render();
}

/** Open the add-user modal and create the account. */
async function openAddUser() {
  const saved = await formDialog({
    title: t('settings_add_user'),
    bodyHtml: userFormHtml(null),
    confirmLabel: t('settings_create_user'),
    bind: bindUserForm,

    submit: async (root, setError) => {
      const username = root.querySelector('#user-username').value.trim();
      const displayName = root.querySelector('#user-display-name').value.trim();
      const password = root.querySelector('#user-password').value;
      const confirm = root.querySelector('#user-password-2').value;

      if (!username) { setError(t('settings_err_username_required')); return false; }
      if (!displayName) { setError(t('settings_err_display_name_required')); return false; }
      if (password.length < 8) { setError(t('password_too_short')); return false; }
      if (password !== confirm) { setError(t('passwords_dont_match')); return false; }

      try {
        await api.call('create_user', {
          username,
          password_hash: await sha256Hex(password),
          display_name: displayName,
          role: root.querySelector('#user-role').value,
          active: !!root.querySelector('#user-active').checked,
          permissions: readPermissions(root),
        });
        return true;
      } catch (err) {
        setError(userErrorText(err));
        return false;
      }
    },
  });

  if (saved) {
    toastSuccess(t('settings_user_created'));
    invalidateUsers();
  }
}

/** Open the edit-user modal for an existing account. */
async function openEditUser(user) {
  const saved = await formDialog({
    title: t('settings_edit_user'),
    bodyHtml: userFormHtml(user),
    bind: bindUserForm,

    submit: async (root, setError) => {
      const displayName = root.querySelector('#user-display-name').value.trim();
      if (!displayName) { setError(t('settings_err_display_name_required')); return false; }

      try {
        await api.call('update_user', {
          user_id: user.user_id,
          updates: {
            display_name: displayName,
            role: root.querySelector('#user-role').value,
            active: !!root.querySelector('#user-active').checked,
          },
          permissions: readPermissions(root),
        });
        return true;
      } catch (err) {
        setError(userErrorText(err));
        return false;
      }
    },
  });

  if (saved) {
    toastSuccess(t('settings_user_saved'));
    invalidateUsers();
  }
}

/**
 * Admin password reset (Section 4.2). No current password is asked for — the
 * super admin is not proving they know it — and the server sets
 * force_password_change so the user replaces it on their next login.
 */
async function openResetPassword(user) {
  const done = await formDialog({
    title: t('settings_reset_password_for', { name: user.display_name }),
    confirmLabel: t('settings_reset_password'),
    bodyHtml: `
      <p class="modal-body">${escapeHtml(t('settings_reset_password_intro'))}</p>

      <div class="field">
        <label for="reset-password">${escapeHtml(t('new_password'))}</label>
        <input id="reset-password" type="password" autocomplete="new-password">
      </div>

      <div class="field">
        <label for="reset-password-2">${escapeHtml(t('confirm_new_password'))}</label>
        <input id="reset-password-2" type="password" autocomplete="new-password">
      </div>`,

    submit: async (root, setError) => {
      const password = root.querySelector('#reset-password').value;
      const confirm = root.querySelector('#reset-password-2').value;

      if (password.length < 8) { setError(t('password_too_short')); return false; }
      if (password !== confirm) { setError(t('passwords_dont_match')); return false; }

      try {
        await api.call('reset_user_password', {
          user_id: user.user_id,
          new_password_hash: await sha256Hex(password),
        });
        return true;
      } catch (err) {
        setError(userErrorText(err));
        return false;
      }
    },
  });

  if (done) toastSuccess(t('settings_password_reset_ok'));
}

/**
 * Flip a user's active flag.
 *
 * Deactivating goes through `deactivate_user` rather than `update_user`: it is
 * the platform's soft delete, it signs the user out everywhere, and Section 3.4
 * gives it its own action precisely so it carries its own audit trail.
 * Reactivating is an ordinary update.
 */
async function setUserActive(user, next) {
  const s = pageState();
  if (s.users.busy) return;

  if (!next) {
    const answer = await confirmDialog({
      title: t('settings_deactivate_title'),
      message: t('settings_deactivate_message', { name: user.display_name }),
      confirmLabel: t('settings_deactivate'),
      danger: true,
    });

    if (!answer) {
      render();  // put the toggle back where it was
      return;
    }
  }

  s.users.busy = true;
  render();

  try {
    if (next) await api.call('update_user', { user_id: user.user_id, updates: { active: true } });
    else await api.call('deactivate_user', { user_id: user.user_id });

    toastSuccess(t(next ? 'settings_user_reactivated' : 'settings_user_deactivated'));
    s.users.status = 'idle';
  } catch (err) {
    console.error('[settings] set active failed:', err);
    toast(userErrorText(err), 'error');
  } finally {
    s.users.busy = false;
    render();
  }
}

/** A user's grants as a short phrase — "Employees (edit), Equipment (view)". */
function permissionSummary(user) {
  if (user.role === ROLES.SUPER_ADMIN) return t('settings_perm_all');
  if (user.role === ROLES.OFFICER) return t('settings_perm_officer');

  const held = (user.permissions || [])
    .filter((p) => p.can_view || p.can_edit)
    .map((p) => {
      const entry = PERMISSION_MODULES.find((m) => m.module === p.module);
      const label = entry ? t(entry.labelKey) : p.module;
      return `${label} (${t(p.can_edit ? 'settings_perm_edit' : 'settings_perm_view')})`;
    });

  return held.length ? held.join(', ') : t('settings_perm_none');
}

function renderUserRow(user) {
  const id = escapeHtml(user.user_id);
  const isSelf = !!CURRENT_USER && CURRENT_USER.user_id === user.user_id;

  return `
    <tr class="${user.active ? '' : 'row-inactive'}">
      <td>
        <b>${escapeHtml(user.username)}</b>
        <div class="cell-sub">${id}${isSelf ? ' · ' + escapeHtml(t('settings_you')) : ''}</div>
      </td>
      <td>${escapeHtml(user.display_name)}</td>
      <td>${statusBadge(t('role_' + user.role), user.role === ROLES.SUPER_ADMIN)}</td>
      <td class="cell-sub">${escapeHtml(permissionSummary(user))}</td>
      <td>${escapeHtml(user.last_login_at ? fmtDateTime(user.last_login_at) : t('settings_never'))}</td>
      <td>${toggle(`data-user-active="${id}"`, user.active, t('settings_active'))}</td>
      <td class="cell-actions" data-stop-row-click>
        <button type="button" class="btn btn-ghost btn-sm"
                data-action="edit-user" data-user-id="${id}">${escapeHtml(t('edit'))}</button>
        <button type="button" class="btn btn-ghost btn-sm"
                data-action="reset-password" data-user-id="${id}">${escapeHtml(t('settings_reset_password'))}</button>
        <button type="button" class="btn btn-ghost btn-sm"
                data-action="toggle-active" data-user-id="${id}">${escapeHtml(
                  t(user.active ? 'settings_deactivate' : 'settings_reactivate')
                )}</button>
      </td>
    </tr>`;
}

function renderUsersTab(s) {
  const slot = s.users;

  const toolbar = `
    <div class="filter-bar">
      <label class="check">
        <input type="checkbox" id="users-show-inactive" ${slot.includeInactive ? 'checked' : ''}>
        ${escapeHtml(t('settings_show_inactive'))}
      </label>

      <div class="count">${escapeHtml(
        slot.status === 'ready' ? t('settings_user_count', { count: slot.data.users.length }) : ''
      )}</div>

      <button type="button" class="btn btn-primary btn-sm"
              data-action="add-user">${escapeHtml(t('settings_add_user'))}</button>
    </div>`;

  if (slot.status !== 'ready') return toolbar + slotState(slot, 'retry-users');

  const rows = slot.data.users;

  return toolbar + `
    <table class="tbl">
      <thead>
        <tr>
          <th>${escapeHtml(t('username'))}</th>
          <th>${escapeHtml(t('settings_display_name'))}</th>
          <th>${escapeHtml(t('settings_role'))}</th>
          <th>${escapeHtml(t('settings_permissions'))}</th>
          <th>${escapeHtml(t('settings_col_last_login'))}</th>
          <th>${escapeHtml(t('settings_active'))}</th>
          <th>${escapeHtml(t('actions'))}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.length ? rows.map(renderUserRow).join('') : `
          <tr><td colspan="7" class="cell-empty">${escapeHtml(t('settings_no_users'))}</td></tr>`}
      </tbody>
    </table>`;
}

function bindUsersTab(root) {
  const s = pageState();

  const showInactive = root.querySelector('#users-show-inactive');
  if (showInactive) {
    showInactive.addEventListener('change', () => {
      s.users.includeInactive = showInactive.checked;
      s.users.status = 'idle';
      render();
    });
  }

  const addBtn = root.querySelector('[data-action="add-user"]');
  if (addBtn) addBtn.addEventListener('click', openAddUser);

  const retry = root.querySelector('[data-action="retry-users"]');
  if (retry) retry.addEventListener('click', () => loadInto(s.users, fetchUsers, { force: true }));

  const findUser = (userId) => (s.users.data
    ? s.users.data.users.find((u) => u.user_id === userId)
    : null);

  root.querySelectorAll('[data-action="edit-user"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const user = findUser(btn.dataset.userId);
      if (user) openEditUser(user);
    });
  });

  root.querySelectorAll('[data-action="reset-password"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const user = findUser(btn.dataset.userId);
      if (user) openResetPassword(user);
    });
  });

  root.querySelectorAll('[data-action="toggle-active"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const user = findUser(btn.dataset.userId);
      if (user) setUserActive(user, !user.active);
    });
  });

  root.querySelectorAll('[data-user-active]').forEach((box) => {
    box.addEventListener('change', () => {
      const user = findUser(box.dataset.userActive);
      if (user) setUserActive(user, box.checked);
    });
  });
}

/* ==========================================================================
   TAB 2 — Lists (Section 3.7)
   ========================================================================== */

/** The editable copy, seeded from the server's answer on first render. */
function listsDraft(s) {
  if (!s.lists.draft && s.lists.status === 'ready') {
    s.lists.draft = {};
    Object.keys(s.lists.data).forEach((listKey) => {
      s.lists.draft[listKey] = s.lists.data[listKey].map(toDraftOption);
    });
  }
  return s.lists.draft || {};
}

/** A server option as an editable row. */
function toDraftOption(o) {
  return {
    option_value: o.option_value,
    sort_order: o.sort_order,
    active: o.active !== false,
  };
}

/** True when a list's draft differs from what the server last returned. */
function listIsDirty(s, listKey) {
  const saved = (s.lists.data && s.lists.data[listKey]) || [];
  const draft = listsDraft(s)[listKey] || [];

  if (saved.length !== draft.length) return true;

  return draft.some((row, i) => row.option_value !== saved[i].option_value
    || Number(row.sort_order) !== Number(saved[i].sort_order)
    || row.active !== (saved[i].active !== false));
}

function renderListPanel(s, listKey) {
  const rows = listsDraft(s)[listKey] || [];
  const key = escapeHtml(listKey);
  const dirty = listIsDirty(s, listKey);
  const saving = s.lists.saving === listKey;

  return `
    <div class="card list-panel" data-list-key="${key}">
      <div class="list-head">
        <h3>${escapeHtml(t('list_' + listKey))}</h3>
        ${dirty ? `<span class="badge badge-warning">${escapeHtml(t('settings_unsaved'))}</span>` : ''}
      </div>

      <div class="list-rows">
        ${rows.length ? rows.map((row, i) => `
          <div class="list-row">
            <input type="text" class="list-value" id="list-${key}-${i}-value"
                   data-list-field="option_value" data-index="${i}"
                   value="${escapeHtml(row.option_value)}"
                   aria-label="${escapeHtml(t('settings_option_value'))}">

            <input type="number" class="list-order" id="list-${key}-${i}-order"
                   data-list-field="sort_order" data-index="${i}" min="0" step="1"
                   value="${escapeHtml(String(row.sort_order))}"
                   aria-label="${escapeHtml(t('settings_sort_order'))}">

            ${toggle(`data-list-field="active" data-index="${i}"`, row.active, t('settings_active'))}

            <button type="button" class="btn btn-ghost btn-sm"
                    data-list-remove="${i}">${escapeHtml(t('settings_remove'))}</button>
          </div>`).join('') : `
          <div class="cell-empty">${escapeHtml(t('settings_list_empty'))}</div>`}
      </div>

      <div class="list-actions">
        <button type="button" class="btn btn-ghost btn-sm"
                data-list-add>${escapeHtml(t('settings_add_option'))}</button>
        <button type="button" class="btn btn-primary btn-sm" data-list-save
                ${!dirty || saving ? 'disabled' : ''}>${escapeHtml(t(saving ? 'saving' : 'save'))}</button>
      </div>
    </div>`;
}

function renderListsTab(s) {
  if (s.lists.status !== 'ready') return slotState(s.lists, 'retry-lists');

  const keys = Object.keys(s.lists.data).sort();
  if (!keys.length) return `<div class="cell-empty">${escapeHtml(t('settings_no_lists'))}</div>`;

  return `
    <p class="tab-intro">${escapeHtml(t('settings_lists_intro'))}</p>
    <div class="list-grid">${keys.map((key) => renderListPanel(s, key)).join('')}</div>`;
}

/**
 * Save one list. Full replacement — the server deactivates whatever is missing
 * rather than deleting it, so records still referencing a retired value keep
 * displaying it (Section 3.7).
 */
async function saveList(listKey) {
  const s = pageState();
  if (s.lists.saving) return;

  const rows = listsDraft(s)[listKey] || [];

  if (rows.some((row) => !String(row.option_value).trim())) {
    toast(t('settings_err_blank_option'), 'error');
    return;
  }

  s.lists.saving = listKey;
  render();

  try {
    const data = await api.call('update_field_options', {
      list_key: listKey,
      options: rows.map((row, i) => ({
        option_value: String(row.option_value).trim(),
        sort_order: Number(row.sort_order) || i + 1,
        active: row.active,
      })),
    });

    // Re-seed the saved copy AND the draft from the server's answer, so the
    // panel stops reading dirty and shows whatever the server normalised.
    const saved = data && data.options && data.options[listKey];
    if (saved) {
      s.lists.data[listKey] = saved;
      s.lists.draft[listKey] = saved.map(toDraftOption);
    } else {
      s.lists.status = 'idle';
      s.lists.draft = null;
    }

    toastSuccess(t('settings_list_saved', { list: t('list_' + listKey) }));
  } catch (err) {
    console.error('[settings] update_field_options failed:', err);
    toastError(err);
  } finally {
    s.lists.saving = '';
    render();
  }
}

function bindListsTab(root) {
  const s = pageState();

  const retry = root.querySelector('[data-action="retry-lists"]');
  if (retry) {
    retry.addEventListener('click', () => {
      s.lists.draft = null;
      loadInto(s.lists, fetchFieldOptions, { force: true });
    });
  }

  root.querySelectorAll('[data-list-key]').forEach((panel) => {
    const listKey = panel.dataset.listKey;
    const rows = listsDraft(s)[listKey] || [];

    panel.querySelectorAll('[data-list-field]').forEach((input) => {
      const index = Number(input.dataset.index);
      const field = input.dataset.listField;
      if (!rows[index]) return;

      if (field === 'active') {
        input.addEventListener('change', () => {
          rows[index].active = input.checked;
          render();
        });
        return;
      }

      // Typing writes straight into the draft and does NOT redraw (Section
      // 9.3). The only visible consequence of a keystroke is the "unsaved"
      // badge, which is not worth rebuilding the field the user is inside — so
      // it appears on blur instead.
      input.addEventListener('input', () => {
        rows[index][field] = field === 'sort_order' ? Number(input.value) : input.value;
      });
      input.addEventListener('blur', () => render());
    });

    const addBtn = panel.querySelector('[data-list-add]');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        rows.push({ option_value: '', sort_order: rows.length + 1, active: true });
        render();
      });
    }

    panel.querySelectorAll('[data-list-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        rows.splice(Number(btn.dataset.listRemove), 1);
        render();
      });
    });

    const saveBtn = panel.querySelector('[data-list-save]');
    if (saveBtn) saveBtn.addEventListener('click', () => saveList(listKey));
  });
}

/* ==========================================================================
   TAB 3 — Thresholds (Section 3.3)
   ========================================================================== */

/** A Config value as a string, falling back to the server's own default. */
function configValue(s, key) {
  const config = (s.config.data && s.config.data.config) || {};
  const defaults = (s.config.data && s.config.data.defaults) || {};

  if (config[key] !== undefined && config[key] !== '') return String(config[key]);
  return defaults[key] !== undefined ? String(defaults[key]) : '';
}

/** The editable copy of the Config values this tab owns. */
function configDraft(s) {
  if (!s.config.draft && s.config.status === 'ready') {
    s.config.draft = {};
    THRESHOLD_FIELDS.forEach((field) => {
      s.config.draft[field.key] = configValue(s, field.key);
    });
  }
  return s.config.draft || {};
}

function thresholdsDirty(s) {
  const draft = configDraft(s);
  return THRESHOLD_FIELDS.some((field) => String(draft[field.key]) !== configValue(s, field.key));
}

function renderThresholdsTab(s) {
  if (s.config.status !== 'ready') return slotState(s.config, 'retry-config');

  const draft = configDraft(s);
  const dirty = thresholdsDirty(s);

  return `
    <p class="tab-intro">${escapeHtml(t('settings_thresholds_intro'))}</p>

    <div class="card">
      <div class="threshold-grid">
        ${THRESHOLD_FIELDS.map((field) => `
          <div class="field">
            <label for="cfg-${escapeHtml(field.key)}">${escapeHtml(t(field.labelKey))}</label>
            <input id="cfg-${escapeHtml(field.key)}" type="number"
                   data-config-key="${escapeHtml(field.key)}"
                   min="${field.min}" max="${field.max}" step="1"
                   value="${escapeHtml(String(draft[field.key]))}">
            <div class="field-hint">${escapeHtml(t(field.labelKey + '_hint'))}</div>
          </div>`).join('')}
      </div>

      <div class="banner banner-warn">${escapeHtml(t('settings_threshold_rule'))}</div>

      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-action="reset-config"
                ${dirty ? '' : 'disabled'}>${escapeHtml(t('cancel'))}</button>
        <button type="button" class="btn btn-primary" data-action="save-config"
                ${!dirty || s.config.saving ? 'disabled' : ''}>${escapeHtml(
                  t(s.config.saving ? 'saving' : 'save')
                )}</button>
      </div>
    </div>

    ${renderRdtSettingsCard(s)}`;
}

/* ---------- RDT settings (ModuleSettings, not Config) ---------------------- */

/** An RDT setting as a string, falling back to the server's own default. */
function rdtSettingValue(s, key) {
  const settings = (s.rdt.data && s.rdt.data.settings && s.rdt.data.settings[MODULE_NAMES.EMPLOYEES]) || {};

  if (settings[key] !== undefined && settings[key] !== '') return String(settings[key]);
  return RDT_SETTING_DEFAULTS[key];
}

function rdtDraft(s) {
  if (!s.rdt.draft && s.rdt.status === 'ready') {
    s.rdt.draft = {};
    RDT_SETTING_FIELDS.forEach((field) => {
      s.rdt.draft[field.key] = rdtSettingValue(s, field.key);
    });
  }
  return s.rdt.draft || {};
}

function rdtDirty(s) {
  const draft = rdtDraft(s);
  return RDT_SETTING_FIELDS.some((field) => String(draft[field.key]) !== rdtSettingValue(s, field.key));
}

function renderRdtSettingsCard(s) {
  if (s.rdt.status !== 'ready') return slotState(s.rdt, 'retry-rdt');

  const draft = rdtDraft(s);
  const dirty = rdtDirty(s);

  const control = (field) => {
    const value = String(draft[field.key]);

    if (field.type === 'bool') {
      return `
        <label class="check-row">
          <input type="checkbox" data-rdt-key="${escapeHtml(field.key)}"
                 ${value.toUpperCase() === 'TRUE' ? 'checked' : ''}>
          <span>${escapeHtml(t(field.labelKey))}</span>
        </label>`;
    }

    const attrs = field.type === 'number'
      ? `type="number" min="${field.min}" max="${field.max}" step="1"`
      : 'type="text"';

    return `
      <div class="field">
        <label for="rdt-${escapeHtml(field.key)}">${escapeHtml(t(field.labelKey))}</label>
        <input id="rdt-${escapeHtml(field.key)}" ${attrs}
               data-rdt-key="${escapeHtml(field.key)}" value="${escapeHtml(value)}">
        <div class="field-hint">${escapeHtml(t(field.labelKey + '_hint'))}</div>
      </div>`;
  };

  const [enabledField, ...rest] = RDT_SETTING_FIELDS;

  return `
    <div class="section-head">${escapeHtml(t('settings_rdt_title'))}</div>
    <div class="card">
      <p class="tab-intro">${escapeHtml(t('settings_rdt_intro'))}</p>

      ${control(enabledField)}
      <div class="field-hint">${escapeHtml(t('settings_rdt_enabled_hint'))}</div>

      <div class="threshold-grid">${rest.map(control).join('')}</div>

      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-action="reset-rdt"
                ${dirty ? '' : 'disabled'}>${escapeHtml(t('cancel'))}</button>
        <button type="button" class="btn btn-primary" data-action="save-rdt"
                ${!dirty || s.rdt.saving ? 'disabled' : ''}>${escapeHtml(
                  t(s.rdt.saving ? 'saving' : 'save')
                )}</button>
      </div>
    </div>`;
}

/** Send only what changed, after bounds-checking the numbers. */
async function saveRdtSettings() {
  const s = pageState();
  if (s.rdt.saving) return;

  const draft = rdtDraft(s);
  const updates = {};

  for (const field of RDT_SETTING_FIELDS) {
    const value = String(draft[field.key]).trim();
    if (value === rdtSettingValue(s, field.key)) continue;

    if (field.type === 'number') {
      const num = Number(value);
      if (!Number.isFinite(num) || num < field.min || num > field.max) {
        toast(t('settings_err_out_of_range', {
          field: t(field.labelKey), min: field.min, max: field.max,
        }), 'error');
        return;
      }
      updates[field.key] = String(Math.round(num));
      continue;
    }

    // The repeat-months list is the one text field with a shape. A typo here
    // would silently drop the Feb/Mar phase, so it is checked rather than
    // trusted — the server coerces unparseable entries away without complaint.
    if (field.key === 'rdt_repeat_months' && value !== '') {
      const months = value.split(',').map((part) => Number(part.trim()));
      const valid = months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12);

      if (!valid) {
        toast(t('settings_rdt_repeat_invalid'), 'error');
        return;
      }
    }

    updates[field.key] = value;
  }

  if (!Object.keys(updates).length) return;

  s.rdt.saving = true;
  render();

  try {
    const data = await api.call('update_module_settings', {
      module: MODULE_NAMES.EMPLOYEES,
      updates,
    });

    s.rdt.data = { settings: data.settings };
    s.rdt.draft = null;

    // Every RDT number decides what the RDT page and the dashboard card show,
    // and both are holding an answer computed under the old ones.
    delete UI.employeeRdt;
    delete UI.employeeRdtHistory;
    delete UI.employeeDashboard;

    toastSuccess(t('settings_config_saved'));
  } catch (err) {
    console.error('[settings] update_module_settings failed:', err);
    toastError(err);
  } finally {
    s.rdt.saving = false;
    render();
  }
}

/** Send only the keys that actually changed. */
async function saveThresholds() {
  const s = pageState();
  if (s.config.saving) return;

  const draft = configDraft(s);
  const updates = {};

  for (const field of THRESHOLD_FIELDS) {
    const value = String(draft[field.key]).trim();
    if (value === configValue(s, field.key)) continue;

    const num = Number(value);
    if (!Number.isFinite(num) || num < field.min || num > field.max) {
      toast(t('settings_err_out_of_range', {
        field: t(field.labelKey), min: field.min, max: field.max,
      }), 'error');
      return;
    }
    updates[field.key] = String(Math.round(num));
  }

  if (!Object.keys(updates).length) return;

  s.config.saving = true;
  render();

  try {
    const data = await api.call('update_config', { updates });

    s.config.data = Object.assign({}, s.config.data, { config: data.config });
    s.config.draft = null;

    // Thresholds decide every badge on every list, and those lists are holding
    // rows derived under the old numbers. Dropping their cached pages is what
    // makes the change visible without a reload.
    invalidateModuleCaches();

    toastSuccess(t('settings_config_saved'));
  } catch (err) {
    console.error('[settings] update_config failed:', err);

    // The one cross-field rule the server enforces deserves its own sentence.
    const fieldErrors = (err && err.field_errors) || {};
    if (fieldErrors.urgent_days || fieldErrors.soon_days) toast(t('settings_threshold_rule'), 'error');
    else toastError(err);
  } finally {
    s.config.saving = false;
    render();
  }
}

/**
 * Drop every module's cached page state.
 *
 * The shell knowing these key names is a small wart — the alternative is a
 * manifest slot for "forget what you cached", which is more machinery than two
 * call sites justify. If a third module ships, that trade flips.
 */
function invalidateModuleCaches() {
  delete UI.employeeList;
  delete UI.employeeDashboard;
  delete UI.employeeRdt;
  delete UI.employeeRdtHistory;
  delete UI.equipmentList;
  delete UI.equipmentDashboard;
}

function bindThresholdsTab(root) {
  const s = pageState();
  const draft = configDraft(s);

  const retry = root.querySelector('[data-action="retry-config"]');
  if (retry) {
    retry.addEventListener('click', () => {
      s.config.draft = null;
      loadInto(s.config, () => api.call('list_config', {}), { force: true });
    });
  }

  // Same rule as the Lists tab: typing updates the draft, it does not redraw.
  root.querySelectorAll('[data-config-key]').forEach((input) => {
    input.addEventListener('input', () => {
      draft[input.dataset.configKey] = input.value;
    });
    input.addEventListener('blur', () => render());
  });

  const saveBtn = root.querySelector('[data-action="save-config"]');
  if (saveBtn) saveBtn.addEventListener('click', saveThresholds);

  const resetBtn = root.querySelector('[data-action="reset-config"]');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      s.config.draft = null;
      render();
    });
  }

  bindRdtSettings(root);
}

/** The RDT card at the bottom of the same tab. */
function bindRdtSettings(root) {
  const s = pageState();
  const draft = rdtDraft(s);

  const retry = root.querySelector('[data-action="retry-rdt"]');
  if (retry) {
    retry.addEventListener('click', () => {
      s.rdt.draft = null;
      loadInto(
        s.rdt,
        () => api.call('list_module_settings', { module: MODULE_NAMES.EMPLOYEES }),
        { force: true }
      );
    });
  }

  root.querySelectorAll('[data-rdt-key]').forEach((input) => {
    // The checkbox has no half-typed state, so it can redraw immediately and
    // light up Save. Text and number inputs write to the draft on every
    // keystroke and only redraw on blur, so the caret is never disturbed.
    if (input.type === 'checkbox') {
      input.addEventListener('change', () => {
        draft[input.dataset.rdtKey] = input.checked ? 'TRUE' : 'FALSE';
        render();
      });
      return;
    }

    input.addEventListener('input', () => {
      draft[input.dataset.rdtKey] = input.value;
    });
    input.addEventListener('blur', () => render());
  });

  const saveBtn = root.querySelector('[data-action="save-rdt"]');
  if (saveBtn) saveBtn.addEventListener('click', saveRdtSettings);

  const resetBtn = root.querySelector('[data-action="reset-rdt"]');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      s.rdt.draft = null;
      render();
    });
  }
}

/* ==========================================================================
   TAB 4 — Data
   ========================================================================== */

function renderImportPanel(target) {
  const slot = importState(target.key);
  const key = escapeHtml(target.key);

  return `
    <div class="card import-panel" data-import="${key}">
      <h3>${escapeHtml(t('settings_import_into', { module: t(target.labelKey) }))}</h3>

      <div class="field">
        <label for="import-file-${key}">${escapeHtml(t('settings_import_file'))}</label>
        <input id="import-file-${key}" type="file" accept=".xlsx,.xls,.csv" data-import-file
               ${slot.busy ? 'disabled' : ''}>
        <div class="field-hint">${escapeHtml(t('settings_import_hint'))}</div>
      </div>

      ${slot.busy ? `
        <div class="banner banner-warn">${escapeHtml(t('settings_import_reading'))}</div>` : ''}

      ${slot.error ? `<div class="banner banner-danger">${escapeHtml(slot.error)}</div>` : ''}

      ${slot.result ? `
        <div class="banner banner-warn">${escapeHtml(t('settings_import_result', slot.result))}</div>` : ''}
    </div>`;
}

/** One row of the Sheet health panel. */
function healthRow(labelKey, count, lastUpdated) {
  return `
    <div class="health-row">
      <span>${escapeHtml(t(labelKey))}</span>
      <span class="health-count">${escapeHtml(count === null ? EMPTY_MARK : String(count))}</span>
      <span class="cell-sub">${escapeHtml(lastUpdated ? fmtDateTime(lastUpdated) : EMPTY_MARK)}</span>
    </div>`;
}

function renderHealthPanel(s) {
  if (s.health.status !== 'ready') {
    return `
      <div class="card">
        <h3>${escapeHtml(t('settings_health'))}</h3>
        ${slotState(s.health, 'retry-health')}
      </div>`;
  }

  const { employees, equipment, users } = s.health.data;
  const config = (s.config.data && s.config.data.config) || {};

  return `
    <div class="card">
      <h3>${escapeHtml(t('settings_health'))}</h3>

      <div class="health-table">
        <div class="health-row health-head">
          <span>${escapeHtml(t('settings_health_tab'))}</span>
          <span>${escapeHtml(t('settings_health_rows'))}</span>
          <span>${escapeHtml(t('settings_health_updated'))}</span>
        </div>
        ${healthRow('module_employees',
          employees ? employees.totals.active : null,
          employees ? employees.last_updated_at : '')}
        ${healthRow('module_equipment',
          equipment ? equipment.totals.active : null,
          equipment ? equipment.last_updated_at : '')}
        ${healthRow('settings_tab_users', users ? users.users.length : null, '')}
      </div>

      <div class="health-counters">
        ${COUNTER_KEYS.map((key) => `
          <div class="field-disp">
            <div class="lab">${escapeHtml(t('settings_' + key))}</div>
            <div class="val">${escapeHtml(config[key] || EMPTY_MARK)}</div>
          </div>`).join('')}
      </div>

      <div class="field-hint">${escapeHtml(t('settings_health_note'))}</div>

      <div class="form-actions">
        <button type="button" class="btn btn-ghost btn-sm"
                data-action="refresh-health">${escapeHtml(t('refresh'))}</button>
      </div>
    </div>`;
}

function renderDriveFolderPanel(s) {
  if (s.config.status !== 'ready') {
    return `
      <div class="card">
        <h3>${escapeHtml(t('settings_drive_folder'))}</h3>
        ${slotState(s.config, 'retry-config')}
      </div>`;
  }

  const current = (s.config.data.config || {}).drive_folder_url || '';

  return `
    <div class="card">
      <h3>${escapeHtml(t('settings_drive_folder'))}</h3>

      <div class="field">
        <label for="cfg-drive-folder">${escapeHtml(t('settings_drive_folder_label'))}</label>
        <input id="cfg-drive-folder" type="url" inputmode="url" spellcheck="false"
               placeholder="https://drive.google.com/drive/folders/…"
               value="${escapeHtml(current)}">
        <div class="field-hint">${escapeHtml(t('settings_drive_folder_hint'))}</div>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-primary btn-sm"
                data-action="save-drive-folder">${escapeHtml(t('save'))}</button>
      </div>
    </div>`;
}

function renderDataTab(s) {
  return `
    <p class="tab-intro">${escapeHtml(t('settings_data_intro'))}</p>

    <div class="settings-row">
      ${IMPORT_TARGETS.map(renderImportPanel).join('')}
    </div>

    <div class="settings-row">
      ${renderDriveFolderPanel(s)}
      ${renderHealthPanel(s)}
    </div>`;
}

/* ---------- Import: parse → review → commit -------------------------------- */

/**
 * Everything already stored for a module, so the preview can tell a new record
 * from a duplicate.
 *
 * A page walk, because Section 3.5 has no "give me every identity" action and
 * inventing one for a screen used a few times a year is not worth a schema
 * conversation. It is the one genuinely heavy call on this page.
 */
async function fetchExistingRecords(spec) {
  const records = [];

  for (let page = 1; page <= IMPORT_WALK_MAX_PAGES; page++) {
    const data = await api.call(spec.listAction, {
      include_archived: spec.module === MODULE_NAMES.EMPLOYEES ? true : undefined,
      include_rejected: spec.module === MODULE_NAMES.EQUIPMENT ? true : undefined,
      page,
      page_size: IMPORT_WALK_PAGE_SIZE,
    });

    const batch = data[spec.listResultKey] || [];
    records.push(...batch);

    if (batch.length === 0 || records.length >= data.total_matching) break;
  }

  return records;
}

/**
 * Read the picked file, classify every row, and open the review modal.
 *
 * Nothing is written until the admin confirms in that modal, so cancelling at
 * any point costs nothing — the same guarantee OHS-DB's import made.
 */
async function pickImportFile(targetKey, file) {
  const slot = importState(targetKey);
  const spec = IMPORT_SPECS[targetKey];
  if (!spec || slot.busy) return;

  slot.error = null;
  slot.result = null;
  slot.fileName = file ? file.name : '';
  slot.busy = true;
  render();

  let preview;
  let warnings;

  try {
    const parsed = await parseWorkbook(file, spec);
    warnings = parsed.warnings;

    const [existing, options] = await Promise.all([
      fetchExistingRecords(spec),
      api.call('list_field_options', {}).then((data) => data.options || {}),
    ]);

    preview = buildImportPreview(parsed.rows, spec, existing, options);
  } catch (err) {
    console.error('[settings] import preview failed:', err);

    slot.error = err instanceof ImportError
      ? t('import_err_' + err.code)
      : t('err_' + ((err && err.code) || 'server_error'));
    slot.busy = false;
    render();
    return;
  }

  slot.busy = false;
  render();

  if (!preview.rows.length) {
    slot.error = t('import_err_no_rows');
    if (warnings && warnings.length) console.warn('[settings] import warnings:', warnings);
    render();
    return;
  }

  await openImportPreview(targetKey, spec, preview, warnings);
}

/** Status → the badge class its pill uses in the preview table. */
const PREVIEW_STATUS_CLASSES = {
  new: 'badge-cleared',
  duplicate: 'badge-warning',
  unknown_option: 'badge-warning',
  conflict: 'badge-blocked',
  blocked: 'badge-blocked',
};

/** The actions a row may be given, and which statuses may be given them. */
function actionsFor(row) {
  if (row.blocked) return ['skip'];
  if (row.status === 'conflict') return ['skip'];
  if (row.status === 'duplicate') return ['skip', 'overwrite'];
  return ['skip', 'import'];
}

/** The live counter line above the preview table. */
function previewSummaryHtml(rows) {
  const summary = summarizePreview(rows);

  return escapeHtml(t('import_summary', summary));
}

/** One reviewable row. */
function previewRowHtml(row) {
  const actions = actionsFor(row);
  const addable = row.unknowns.filter((u) => u.addable);

  return `
    <tr data-preview-row="${row.index}">
      <td class="cell-mono">${escapeHtml(String(row.excel_row))}</td>
      <td>
        <b>${escapeHtml(row.label)}</b>
        ${row.sheet ? `<div class="cell-sub">${escapeHtml(row.sheet)}</div>` : ''}
      </td>
      <td>
        <span class="badge ${PREVIEW_STATUS_CLASSES[row.status] || 'badge-inactive'}">
          ${escapeHtml(t('import_status_' + row.status))}
        </span>
      </td>
      <td class="cell-sub">${escapeHtml(row.reasons.join(' · ') || '—')}</td>
      <td>
        <select data-preview-action="${row.index}" ${actions.length < 2 ? 'disabled' : ''}>
          ${actions.map((action) => option(action, t('import_action_' + action), row.action)).join('')}
        </select>
      </td>
      <td>
        ${addable.length ? `
          <label class="check">
            <input type="checkbox" data-preview-add="${row.index}" ${row.add_options ? 'checked' : ''}>
            ${escapeHtml(t('import_add_to_list'))}
          </label>` : '—'}
      </td>
    </tr>`;
}

/**
 * The review modal.
 *
 * Every row is rendered, not a page of them: the admin has to be able to reach
 * any row's action, and a preview that silently applied defaults to rows it did
 * not show would be worse than a long scroll. The bulk buttons are what makes a
 * thousand-row file manageable.
 *
 * Changing a select does NOT redraw — it writes into the preview row and
 * patches the summary line in place. Rebuilding a table of selects on every
 * change would throw away the focus of the control being used (Section 9.3).
 */
async function openImportPreview(targetKey, spec, preview, warnings) {
  const rows = preview.rows;

  const bodyHtml = `
    ${warnings && warnings.length ? `
      <div class="banner banner-warn import-warnings">
        <b>${escapeHtml(t('import_warnings_title', { count: warnings.length }))}</b>
        <ul>${warnings.slice(0, 8).map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
        ${warnings.length > 8 ? `<div class="cell-sub">${escapeHtml(t('import_warnings_more', {
          count: warnings.length - 8,
        }))}</div>` : ''}
      </div>` : ''}

    <div class="import-bulk">
      <span class="import-summary" data-preview-summary>${previewSummaryHtml(rows)}</span>
      <div class="import-bulk-actions">
        <button type="button" class="btn btn-ghost btn-sm"
                data-preview-bulk="overwrite">${escapeHtml(t('import_bulk_overwrite'))}</button>
        <button type="button" class="btn btn-ghost btn-sm"
                data-preview-bulk="skip-duplicates">${escapeHtml(t('import_bulk_skip_dupes'))}</button>
        <button type="button" class="btn btn-ghost btn-sm"
                data-preview-bulk="import-new">${escapeHtml(t('import_bulk_import_new'))}</button>
      </div>
    </div>

    <div class="import-table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>${escapeHtml(t('import_col_row'))}</th>
            <th>${escapeHtml(t('import_col_record'))}</th>
            <th>${escapeHtml(t('import_col_status'))}</th>
            <th>${escapeHtml(t('import_col_reasons'))}</th>
            <th>${escapeHtml(t('import_col_action'))}</th>
            <th>${escapeHtml(t('import_col_lists'))}</th>
          </tr>
        </thead>
        <tbody>${rows.map(previewRowHtml).join('')}</tbody>
      </table>
    </div>`;

  const committed = await formDialog({
    title: t('import_review_title', { module: t(spec.labelKey) }),
    confirmLabel: t('import_commit'),
    wide: true,
    bodyHtml,

    bind: (root) => {
      const summaryEl = root.querySelector('[data-preview-summary]');
      const refresh = () => { summaryEl.textContent = previewSummaryHtml(rows); };

      root.querySelectorAll('[data-preview-action]').forEach((select) => {
        select.addEventListener('change', () => {
          rows[Number(select.dataset.previewAction)].action = select.value;
          refresh();
        });
      });

      root.querySelectorAll('[data-preview-add]').forEach((box) => {
        box.addEventListener('change', () => {
          const row = rows[Number(box.dataset.previewAdd)];
          row.add_options = box.checked;

          // Refusing to extend the list makes the row unimportable: the server
          // rejects an unknown option, and one rejected row rejects the whole
          // batch (Section 3.5). So the two controls move together.
          if (!box.checked && row.action !== 'skip') {
            row.action = 'skip';

            const select = root.querySelector(`[data-preview-action="${row.index}"]`);
            if (select) select.value = 'skip';
          }
          refresh();
        });
      });

      root.querySelectorAll('[data-preview-bulk]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.previewBulk;

          rows.forEach((row) => {
            const allowed = actionsFor(row);

            if (mode === 'overwrite' && row.status === 'duplicate') row.action = 'overwrite';
            else if (mode === 'skip-duplicates' && row.status === 'duplicate') row.action = 'skip';
            else if (mode === 'import-new' && row.status !== 'duplicate') {
              row.action = allowed.includes('import') ? 'import' : 'skip';
            }
          });

          // Push the new actions back into the selects rather than redrawing.
          root.querySelectorAll('[data-preview-action]').forEach((select) => {
            select.value = rows[Number(select.dataset.previewAction)].action;
          });
          refresh();
        });
      });
    },

    submit: async (root, setError) => {
      const result = await commitImport(spec, rows, setError);
      if (!result) return false;

      importState(targetKey).result = result;
      return true;
    },
  });

  if (committed) {
    toastSuccess(t('settings_import_ok', importState(targetKey).result));

    invalidateModuleCaches();
    pageState().health.status = 'idle';
    render();
  }
}

/**
 * Turn the reviewed rows into API calls.
 *
 * Three steps, in this order:
 *
 *   1. Extend the dropdown lists with the values the admin ticked, through
 *      `update_field_options`. Doing it first means the employees that
 *      reference those values are valid by the time they land.
 *   2. Send the rows marked Import with `on_duplicate: 'skip'`.
 *   3. Send the rows marked Overwrite with `on_duplicate: 'overwrite'`.
 *
 * Two calls rather than one because the API's duplicate policy is per call and
 * the admin's decision is per row — splitting the set is what maps one onto the
 * other. `auto_add_unknown_options` is always false: step 1 has already added
 * exactly the values that were approved, and leaving it on would let the server
 * add the ones that were not.
 *
 * Skipped rows are never sent. That matters more than it looks: the server
 * validates every row in a payload whether or not it would be applied, so a
 * skipped bad row would still reject the batch.
 *
 * @returns {Promise<Object|null>} totals, or null when the caller should stay open
 */
async function commitImport(spec, rows, setError) {
  const toImport = rows.filter((row) => row.action === 'import').map((row) => row.record);
  const toOverwrite = rows.filter((row) => row.action === 'overwrite').map((row) => row.record);

  if (!toImport.length && !toOverwrite.length) {
    setError(t('import_err_nothing_selected'));
    return null;
  }

  const totals = { added: 0, updated: 0, skipped: rows.filter((r) => r.action === 'skip').length };

  try {
    await applyListAdditions(pendingListAdditions(rows));

    const passes = [
      { rows: toImport, policy: 'skip' },
      { rows: toOverwrite, policy: 'overwrite' },
    ];

    for (const pass of passes) {
      if (!pass.rows.length) continue;

      for (const batch of chunkRows(pass.rows, IMPORT_MAX_ROWS)) {
        const data = await api.call(spec.action, {
          rows: batch,
          on_duplicate: pass.policy,
          auto_add_unknown_options: false,
        });

        totals.added += data.added || 0;
        totals.updated += data.updated || 0;
      }
    }

    return totals;
  } catch (err) {
    console.error('[settings] import commit failed:', err);
    setError(importErrorText(err, rows));
    return null;
  }
}

/**
 * Add approved values to their FieldOptions lists.
 *
 * `update_field_options` is a full replacement, so each list is read, appended
 * to, and written back whole — dropping the read would wipe every option the
 * file did not happen to mention.
 *
 * @param {Object<string, Array<string>>} additions
 */
async function applyListAdditions(additions) {
  const listKeys = Object.keys(additions);
  if (!listKeys.length) return;

  const current = (await api.call('list_field_options', {})).options || {};

  for (const listKey of listKeys) {
    const existing = current[listKey] || [];
    const merged = existing.map((o) => ({
      option_value: o.option_value,
      sort_order: o.sort_order,
      active: o.active !== false,
    }));

    additions[listKey].forEach((value, i) => {
      merged.push({ option_value: value, sort_order: existing.length + i + 1, active: true });
    });

    await api.call('update_field_options', { list_key: listKey, options: merged });
  }

  // The Lists tab is now behind; drop its draft so it reloads with the additions.
  const s = pageState();
  s.lists.status = 'idle';
  s.lists.draft = null;
}

/**
 * A bulk-import failure as text.
 *
 * `row_errors` is the shape only the two import actions produce (api.js
 * ApiError). Its `row` is an index into the batch that was sent, so it is
 * translated back to the spreadsheet's own row number — "row 3 of the payload"
 * means nothing to someone looking at Excel.
 */
function importErrorText(err, previewRows) {
  const rowErrors = err && err.row_errors;

  if (rowErrors && rowErrors.length) {
    const first = rowErrors[0];
    const sent = previewRows.filter((row) => row.action === 'import' || row.action === 'overwrite');
    const culprit = sent[first.row];
    const fields = Object.keys(first.errors || {}).join(', ');

    return t('settings_import_row_error', {
      row: culprit ? culprit.excel_row : first.row,
      fields,
    });
  }

  return t('err_' + ((err && err.code) || 'server_error'));
}

async function saveDriveFolder(root) {
  const input = root.querySelector('#cfg-drive-folder');
  if (!input) return;

  const url = input.value.trim();
  if (url && !/^https:\/\//i.test(url)) {
    toast(t('script_url_invalid'), 'error');
    return;
  }

  try {
    const data = await api.call('update_config', { updates: { drive_folder_url: url } });
    const s = pageState();

    s.config.data = Object.assign({}, s.config.data, { config: data.config });
    toastSuccess(t('settings_config_saved'));
  } catch (err) {
    console.error('[settings] drive folder save failed:', err);
    toastError(err);
  }

  render();
}

function bindDataTab(root) {
  const s = pageState();

  IMPORT_TARGETS.forEach((target) => {
    const panel = root.querySelector(`[data-import="${target.key}"]`);
    if (!panel) return;

    const fileInput = panel.querySelector('[data-import-file]');
    if (!fileInput) return;

    // Picking a file is the whole interaction: it parses, classifies, and opens
    // the review modal. Everything else the import needs is decided in there.
    fileInput.addEventListener('change', () => {
      pickImportFile(target.key, fileInput.files && fileInput.files[0]);
    });
  });

  const saveFolder = root.querySelector('[data-action="save-drive-folder"]');
  if (saveFolder) saveFolder.addEventListener('click', () => saveDriveFolder(root));

  const refresh = root.querySelector('[data-action="refresh-health"]');
  const retryHealth = root.querySelector('[data-action="retry-health"]');

  [refresh, retryHealth].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      s.health.status = 'idle';
      loadActiveTab();
    });
  });

  const retryConfig = root.querySelector('[data-action="retry-config"]');
  if (retryConfig) {
    retryConfig.addEventListener('click', () => {
      s.config.draft = null;
      loadInto(s.config, () => api.call('list_config', {}), { force: true });
    });
  }
}

/* ==========================================================================
   The page
   ========================================================================== */

/** Body for the active tab. */
function renderTabBody(s) {
  if (s.tab === 'lists') return renderListsTab(s);
  if (s.tab === 'thresholds') return renderThresholdsTab(s);
  if (s.tab === 'data') return renderDataTab(s);
  return renderUsersTab(s);
}

/**
 * The settings page.
 *
 * The super-admin check here is belt-and-braces: router.js already redirects a
 * module admin away from this route. It exists so a future change to the route
 * table cannot quietly turn this into a page anyone can read.
 *
 * @returns {string} HTML
 */
export function renderSettingsPage() {
  if (!isSuperAdmin()) {
    return `<div class="page-placeholder">${escapeHtml(t('err_forbidden'))}</div>`;
  }

  const s = pageState();

  return `
    <div class="settings">
      <div class="page-head">
        <div>
          <div class="page-head-title">${escapeHtml(t('nav_settings'))}</div>
          <div class="page-head-sub">${escapeHtml(t('settings_sub', {
            company: CONFIG.company_name || t('company_name'),
          }))}</div>
        </div>
      </div>

      <div class="tabs" role="tablist">
        ${TABS.map((tab) => `
          <button type="button" role="tab" class="tab${tab.key === s.tab ? ' active' : ''}"
                  aria-selected="${tab.key === s.tab}"
                  data-tab="${escapeHtml(tab.key)}">${escapeHtml(t(tab.labelKey))}</button>`).join('')}
      </div>

      <div class="tab-body">${renderTabBody(s)}</div>
    </div>`;
}

/**
 * Wire the tab strip, then whatever the active tab needs.
 *
 * Runs on every draw. Each tab's own load guard makes the repeat calls free
 * once its data is in hand.
 */
export function bindSettingsPageEvents() {
  const root = document.querySelector('.settings');
  if (!root) return;

  const s = pageState();

  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (s.tab === btn.dataset.tab) return;

      s.tab = btn.dataset.tab;
      render();
    });
  });

  loadActiveTab();

  const body = root.querySelector('.tab-body');
  if (!body) return;

  if (s.tab === 'users') bindUsersTab(body);
  else if (s.tab === 'lists') bindListsTab(body);
  else if (s.tab === 'thresholds') bindThresholdsTab(body);
  else if (s.tab === 'data') bindDataTab(body);
}
