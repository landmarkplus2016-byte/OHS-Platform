/**
 * Users.gs — user and permission actions (CLAUDE.md Section 3.4).
 *
 * All of these are super-admin gated except `reset_user_password`, which is the
 * one action a user may aim at themselves.
 *
 * Password handling here mirrors Auth.gs: hashes arrive already computed by the
 * browser (Section 4.2), are compared as strings, and are never returned by any
 * action or written to a log.
 *
 * TWO RULES RUN THROUGH EVERY MUTATION BELOW
 *
 *   The last super admin is untouchable (rule 20). Demoting, deactivating, or
 *   deleting the only remaining one would lock every human out of user
 *   management with no way back in — the check runs server-side on every user
 *   mutation and answers `conflict`.
 *
 *   Nothing is deleted (rule 6). deactivate_user flips a flag; the row, its
 *   audit stamps, and its history stay forever.
 */

/** A SHA-256 hex digest as produced by js/utils/crypto.js. */
var SHA256_HEX_RE_ = /^[0-9a-f]{64}$/i;

/** Columns `update_user` accepts. `username` is deliberately absent — see below. */
var USER_UPDATABLE_FIELDS = ['display_name', 'role', 'active'];

// ---------------------------------------------------------------------------
// Action handlers — reads
// ---------------------------------------------------------------------------

/**
 * `list_users` — every account plus its permission grants (Section 3.4).
 *
 * Password hashes are never in the response. sanitizeUser_ in Auth.gs drops the
 * column before the row leaves that file, and nothing here adds it back.
 *
 * @param {{user: Object}} session  Context from validateSession().
 * @param {Object} payload  {include_inactive?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListUsers(session, payload) {
  if (!session.user.is_super_admin) {
    return errResponse('forbidden', 'super_admin_required');
  }

  var unknown = collectUnknownKeys_(payload, ['include_inactive']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var includeInactive = normalizeBoolean(payload && payload.include_inactive);
  var grants = permissionsByUser_();
  var rows = readAllRows(SHEET_NAMES.USERS);
  var users = [];

  for (var i = 0; i < rows.length; i++) {
    if (normalizeString(rows[i].user_id) === '') continue;

    var user = sanitizeUser_(rows[i]);
    if (!includeInactive && !user.active) continue;

    user.permissions = grants[user.user_id] || [];
    users.push(user);
  }

  users.sort(function (a, b) {
    var an = a.username.toLowerCase();
    var bn = b.username.toLowerCase();
    return an === bn ? 0 : (an < bn ? -1 : 1);
  });

  return okResponse({ users: users });
}

/**
 * `list_permissions` — the raw Permissions tab (Section 3.4).
 *
 * There is intentionally no `set_permission` action: grants are only ever
 * written through create_user and update_user, so the matrix has exactly one
 * write path.
 *
 * @param {{user: Object}} session
 * @param {Object} payload  None.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleListPermissions(session, payload) {
  if (!session.user.is_super_admin) {
    return errResponse('forbidden', 'super_admin_required');
  }

  var unknown = collectUnknownKeys_(payload, []);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var rows = readAllRows(SHEET_NAMES.PERMISSIONS);
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var userId = normalizeString(rows[i].user_id);
    var module = normalizeString(rows[i].module);
    if (userId === '' || module === '') continue;

    out.push({
      user_id: userId,
      module: module,
      can_view: normalizeBoolean(rows[i].can_view),
      can_edit: normalizeBoolean(rows[i].can_edit)
    });
  }

  return okResponse({ permissions: out });
}

// ---------------------------------------------------------------------------
// Action handlers — writes
// ---------------------------------------------------------------------------

/**
 * `create_user` — inserts one account (Section 3.4).
 *
 * The username uniqueness check and the ID reservation both happen inside the
 * script lock, for the reason create_employee does it: two super admins
 * submitting the same username in the same second would each see a clean check
 * and both write.
 *
 * New accounts always get force_password_change = TRUE (rule 4.1.c) — the
 * super admin picks the first password, and the user must replace it on their
 * first login.
 *
 * @param {{user: Object}} session
 * @param {Object} payload  {username, password_hash, display_name, role, active?, permissions?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleCreateUser(session, payload) {
  if (!session.user.is_super_admin) {
    return errResponse('forbidden', 'super_admin_required');
  }

  var unknown = collectUnknownKeys_(payload, [
    'username', 'password_hash', 'display_name', 'role', 'active', 'permissions'
  ]);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var username = normalizeString(payload && payload.username);
  var passwordHash = normalizeString(payload && payload.password_hash);
  var displayName = normalizeString(payload && payload.display_name);
  var role = normalizeString(payload && payload.role).toLowerCase();

  var fieldErrors = {};
  if (username === '') fieldErrors.username = 'required';
  if (displayName === '') fieldErrors.display_name = 'required';
  if (passwordHash === '') {
    fieldErrors.password_hash = 'required';
  } else if (!SHA256_HEX_RE_.test(passwordHash)) {
    fieldErrors.password_hash = 'invalid_format';
  }
  if (!isKnownRole_(role)) fieldErrors.role = 'invalid_value';

  var grants = normalizePermissionsInput_(payload && payload.permissions, role, fieldErrors);

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  var stampedAt = nowIso();
  var actingUserId = session.user.user_id;
  var newUserId;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('create_user: could not acquire script lock');
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    if (findUserByUsername_(username)) {
      return errResponse('validation_failed', 'username_taken', { username: 'duplicate' });
    }

    newUserId = nextUserId_();

    appendRow(SHEET_NAMES.USERS, {
      user_id: newUserId,
      username: username,
      password_hash: passwordHash,
      force_password_change: booleanToSheet(true),
      display_name: displayName,
      role: role,
      is_super_admin: booleanToSheet(role === ROLES.SUPER_ADMIN),
      active: booleanToSheet(payload && payload.active === undefined ? true : normalizeBoolean(payload.active)),
      created_at: stampedAt,
      created_by: actingUserId,
      updated_at: stampedAt,
      updated_by: actingUserId,
      last_login_at: ''
    });

    writePermissions_(newUserId, grants, stampedAt, actingUserId);
  } finally {
    lock.releaseLock();
  }

  return okResponse({ user: readShapedUser_(newUserId) });
}

/**
 * `update_user` — a partial update plus an optional full permission replacement
 * (Section 3.4).
 *
 * `username` is not updatable and is dropped without complaint if present: it
 * is the login handle, and every audit column in the platform references
 * `user_id` precisely so a rename would not have to rewrite history.
 *
 * @param {{user: Object}} session
 * @param {Object} payload  {user_id, updates?, permissions?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleUpdateUser(session, payload) {
  if (!session.user.is_super_admin) {
    return errResponse('forbidden', 'super_admin_required');
  }

  var unknown = collectUnknownKeys_(payload, ['user_id', 'updates', 'permissions']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var userId = normalizeString(payload && payload.user_id);
  if (userId === '') {
    return errResponse('validation_failed', 'invalid_payload', { user_id: 'required' });
  }

  var current = readRowByKey(SHEET_NAMES.USERS, 'user_id', userId);
  if (!current) return errResponse('not_found', 'user_not_found');

  var updates = (payload && payload.updates) || {};
  if (typeof updates !== 'object' || Array.isArray(updates)) {
    return errResponse('validation_failed', 'invalid_payload', { updates: 'invalid_type' });
  }

  var fieldErrors = {};
  var changes = {};

  // `username` is accepted and ignored rather than rejected, so an honest client
  // that echoes back a whole user object is not punished for it (Section 3.9).
  for (var key in updates) {
    if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
    if (key === 'username') continue;
    if (USER_UPDATABLE_FIELDS.indexOf(key) === -1) fieldErrors[key] = 'unknown';
  }

  if (has_(updates, 'display_name')) {
    var displayName = normalizeString(updates.display_name);
    if (displayName === '') fieldErrors.display_name = 'required';
    else changes.display_name = displayName;
  }

  var role = normalizeString(current.role).toLowerCase();
  if (has_(updates, 'role')) {
    role = normalizeString(updates.role).toLowerCase();
    if (!isKnownRole_(role)) {
      fieldErrors.role = 'invalid_value';
    } else {
      changes.role = role;
      changes.is_super_admin = booleanToSheet(role === ROLES.SUPER_ADMIN);
    }
  }

  var active = normalizeBoolean(current.active);
  if (has_(updates, 'active')) {
    active = normalizeBoolean(updates.active);
    changes.active = booleanToSheet(active);
  }

  var replacePermissions = payload && payload.permissions !== undefined;
  var grants = replacePermissions
    ? normalizePermissionsInput_(payload.permissions, role, fieldErrors)
    : [];

  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  // Rule 20. Both a demotion and a deactivation can strand the platform, so the
  // guard asks the same question of either: would this leave zero active super
  // admins?
  var stillSuperAdmin = role === ROLES.SUPER_ADMIN && active;
  var conflict = guardLastSuperAdmin_(current, stillSuperAdmin);
  if (conflict) return conflict;

  var stampedAt = nowIso();
  var actingUserId = session.user.user_id;

  changes.updated_at = stampedAt;
  changes.updated_by = actingUserId;
  updateRowByKey(SHEET_NAMES.USERS, 'user_id', userId, changes);

  if (replacePermissions) {
    writePermissions_(userId, grants, stampedAt, actingUserId);
  }

  // Sessions are only dropped on deactivation.
  //
  // A role or permission change does NOT need it: validateSession re-reads the
  // Users row and the Permissions tab on every single call (Section 3.9), so a
  // demotion takes effect on the target's very next request without evicting
  // them. Dropping sessions here would also sign a super admin out of their own
  // tab the moment they corrected their own display name.
  if (!active) {
    deleteRowsWhere(SHEET_NAMES.SESSIONS, 'user_id', userId);
  }

  return okResponse({ user: readShapedUser_(userId) });
}

/**
 * `deactivate_user` — the soft delete (Section 3.4). Idempotent.
 *
 * Separate from update_user because it is the closest thing the platform has to
 * a delete, and it deserves its own name in the audit log rather than hiding
 * inside a generic update.
 *
 * @param {{user: Object}} session
 * @param {Object} payload  {user_id}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleDeactivateUser(session, payload) {
  if (!session.user.is_super_admin) {
    return errResponse('forbidden', 'super_admin_required');
  }

  var unknown = collectUnknownKeys_(payload, ['user_id']);
  if (hasKeys_(unknown)) {
    return errResponse('validation_failed', 'unknown_payload_fields', unknown);
  }

  var userId = normalizeString(payload && payload.user_id);
  if (userId === '') {
    return errResponse('validation_failed', 'invalid_payload', { user_id: 'required' });
  }

  var current = readRowByKey(SHEET_NAMES.USERS, 'user_id', userId);
  if (!current) return errResponse('not_found', 'user_not_found');

  var conflict = guardLastSuperAdmin_(current, false);
  if (conflict) return conflict;

  updateRowByKey(SHEET_NAMES.USERS, 'user_id', userId, {
    active: booleanToSheet(false),
    updated_at: nowIso(),
    updated_by: session.user.user_id
  });

  // Their permission rows stay. Reactivating an account should restore the
  // access it had, not silently hand it back with nothing granted.
  deleteRowsWhere(SHEET_NAMES.SESSIONS, 'user_id', userId);

  return okResponse({ user: readShapedUser_(userId) });
}

/**
 * `reset_user_password` — the two reset flows from Section 4.2.
 *
 *   Admin reset (super admin → someone else)
 *     No current password needed. Sets force_password_change = TRUE and deletes
 *     ALL of the target's sessions, so they are kicked out everywhere and must
 *     change the password again on their next login.
 *
 *   Self-reset (any user → themselves)
 *     current_password_hash is required and verified. Clears
 *     force_password_change to FALSE and deletes every session for that user
 *     EXCEPT the one making the call — changing your own password must not sign
 *     you out of the tab you are standing in.
 *
 * A super admin resetting their own password takes the self-reset path, current
 * password and all: `user_id === session user_id` is what selects the flow, not
 * the role.
 *
 * NOTE on the 8-character minimum (Section 4.2): the server only ever sees a
 * digest, so password length is not knowable here. The length rule is enforced
 * in the browser; what this handler can verify is that the payload really is a
 * SHA-256 hex digest, which it does. Anyone calling the API directly can bypass
 * the length policy — that is inherent to hashing client-side and is accepted.
 *
 * @param {{session: Object, user: Object}} session  Context from validateSession().
 * @param {Object} payload  {user_id, new_password_hash, current_password_hash?}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleResetUserPassword(session, payload) {
  var targetUserId = normalizeString(payload && payload.user_id);
  var newHash = normalizeString(payload && payload.new_password_hash);
  var currentHash = normalizeString(payload && payload.current_password_hash);

  var fieldErrors = {};
  if (targetUserId === '') fieldErrors.user_id = 'required';
  if (newHash === '') {
    fieldErrors.new_password_hash = 'required';
  } else if (!SHA256_HEX_RE_.test(newHash)) {
    fieldErrors.new_password_hash = 'invalid_format';
  }
  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'invalid_payload', fieldErrors);
  }

  var actingUserId = session.user.user_id;
  var isSelf = targetUserId === actingUserId;

  // Only a super admin may touch someone else's password.
  if (!isSelf && !session.user.is_super_admin) {
    console.warn('reset_user_password refused: ' + actingUserId + ' targeted ' + targetUserId);
    return errResponse('forbidden', 'super_admin_required');
  }

  var targetRow = readRowByKey(SHEET_NAMES.USERS, 'user_id', targetUserId);
  if (!targetRow) {
    return errResponse('not_found', 'user_not_found');
  }

  if (isSelf) {
    if (currentHash === '') {
      return errResponse('validation_failed', 'current_password_required', {
        current_password_hash: 'required'
      });
    }

    var storedHash = normalizeString(targetRow.password_hash);
    if (storedHash === '' || storedHash.toLowerCase() !== currentHash.toLowerCase()) {
      console.warn('reset_user_password refused: wrong current password for ' + actingUserId);
      return errResponse('validation_failed', 'current_password_incorrect', {
        current_password_hash: 'incorrect'
      });
    }
  }

  // Rule 8: updated_at / updated_by come from the session, never the payload.
  updateRowByKey(SHEET_NAMES.USERS, 'user_id', targetUserId, {
    password_hash: newHash,
    force_password_change: booleanToSheet(!isSelf),
    updated_at: nowIso(),
    updated_by: actingUserId
  });

  if (isSelf) {
    deleteOtherSessions_(targetUserId, session.session.token);
  } else {
    deleteRowsWhere(SHEET_NAMES.SESSIONS, 'user_id', targetUserId);
  }

  return okResponse({});
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** @private True for one of the three values Users.role accepts. */
function isKnownRole_(role) {
  return role === ROLES.SUPER_ADMIN || role === ROLES.MODULE_ADMIN || role === ROLES.OFFICER;
}

/**
 * @private
 * Validates a `permissions` payload into rows ready for the tab.
 *
 * Two roles never reach the table at all (Section 3.4): super admins bypass it
 * entirely, and officers carry implicit view-only across every module and can
 * never be granted edit. For both, an incoming array is ignored rather than
 * rejected — the frontend is free to send the checkboxes it happened to have on
 * screen, and the server decides they do not apply.
 *
 * @param {*} input        The raw payload value.
 * @param {string} role    The role the user will have after this call.
 * @param {Object} errors  Field-error map, appended to in place.
 * @return {Array<{module: string, can_view: boolean, can_edit: boolean}>}
 */
function normalizePermissionsInput_(input, role, errors) {
  if (role === ROLES.SUPER_ADMIN || role === ROLES.OFFICER) return [];
  if (input === undefined || input === null) return [];

  if (!Array.isArray(input)) {
    errors.permissions = 'invalid_type';
    return [];
  }

  var out = [];
  var seen = {};

  for (var i = 0; i < input.length; i++) {
    var entry = input[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors['permissions[' + i + ']'] = 'invalid_type';
      continue;
    }

    var module = normalizeString(entry.module).toLowerCase();
    if (REGISTERED_MODULES.indexOf(module) === -1) {
      errors['permissions[' + i + '].module'] = 'unknown';
      continue;
    }
    if (seen[module]) {
      errors['permissions[' + i + '].module'] = 'duplicate';
      continue;
    }
    seen[module] = true;

    var canEdit = normalizeBoolean(entry.can_edit);

    out.push({
      module: module,
      // Edit without view is not a state the UI can express and not one the
      // permission checks would read sensibly, so granting edit implies view.
      can_view: normalizeBoolean(entry.can_view) || canEdit,
      can_edit: canEdit
    });
  }

  return out;
}

/**
 * @private
 * Replaces a user's rows in the Permissions tab.
 *
 * Delete-then-insert, which Section 3.4 asks for ("fully replaces the user's
 * permission set"). That is not a breach of rule 6: the rule names employees,
 * equipment, and users — the records that carry history. Permissions is a
 * current-state matrix, like Sessions, and a stale grant kept "for the audit
 * trail" would only make it harder to answer who can do what today.
 *
 * Grants with neither flag set are dropped rather than written: Section 2 says
 * a missing row IS no access, so writing false/false says the same thing in
 * more rows.
 *
 * @param {string} userId
 * @param {Array<Object>} grants
 * @param {string} stampedAt
 * @param {string} actingUserId
 */
function writePermissions_(userId, grants, stampedAt, actingUserId) {
  deleteRowsWhere(SHEET_NAMES.PERMISSIONS, 'user_id', userId);

  var rows = [];
  for (var i = 0; i < grants.length; i++) {
    if (!grants[i].can_view && !grants[i].can_edit) continue;

    rows.push({
      user_id: userId,
      module: grants[i].module,
      can_view: booleanToSheet(grants[i].can_view),
      can_edit: booleanToSheet(grants[i].can_edit),
      updated_at: stampedAt,
      updated_by: actingUserId
    });
  }

  if (rows.length) appendRows(SHEET_NAMES.PERMISSIONS, rows);
}

/**
 * @private
 * The Permissions tab grouped as {user_id: [{module, can_view, can_edit}]}.
 * Read once so list_users does not re-scan the tab per user.
 *
 * @return {Object<string, Array<Object>>}
 */
function permissionsByUser_() {
  var rows = readAllRows(SHEET_NAMES.PERMISSIONS);
  var byUser = {};

  for (var i = 0; i < rows.length; i++) {
    var userId = normalizeString(rows[i].user_id);
    var module = normalizeString(rows[i].module);
    if (userId === '' || module === '') continue;

    if (!byUser[userId]) byUser[userId] = [];
    byUser[userId].push({
      module: module,
      can_view: normalizeBoolean(rows[i].can_view),
      can_edit: normalizeBoolean(rows[i].can_edit)
    });
  }

  return byUser;
}

/**
 * @private
 * Rule 20: refuse a change that would leave the platform with no active super
 * admin.
 *
 * Counts the *other* active super admins rather than recounting the whole tab
 * after a hypothetical write — the target's own future state arrives as
 * `willRemainSuperAdmin`, which keeps demotion and deactivation on one code
 * path.
 *
 * @param {Object} targetRow           The Users row about to change.
 * @param {boolean} willRemainSuperAdmin
 * @return {GoogleAppsScript.Content.TextOutput|null} conflict envelope, or null
 */
function guardLastSuperAdmin_(targetRow, willRemainSuperAdmin) {
  if (willRemainSuperAdmin) return null;

  var targetId = normalizeString(targetRow.user_id);
  var wasSuperAdmin = normalizeBoolean(targetRow.is_super_admin)
    || normalizeString(targetRow.role).toLowerCase() === ROLES.SUPER_ADMIN;

  if (!wasSuperAdmin || !normalizeBoolean(targetRow.active)) return null;

  var rows = readAllRows(SHEET_NAMES.USERS);
  for (var i = 0; i < rows.length; i++) {
    if (normalizeString(rows[i].user_id) === targetId) continue;
    if (!normalizeBoolean(rows[i].active)) continue;

    var isSuper = normalizeBoolean(rows[i].is_super_admin)
      || normalizeString(rows[i].role).toLowerCase() === ROLES.SUPER_ADMIN;
    if (isSuper) return null;
  }

  console.warn('refused: would leave no active super admin (target ' + targetId + ')');
  return errResponse('conflict', 'cannot_demote_last_super_admin');
}

/**
 * @private
 * The next free `USR###`.
 *
 * Derived from the highest existing id rather than a Config counter: Section 2
 * gives Config counters to employee, equipment, and vehicle ids only, and this
 * runs inside the create_user script lock.
 *
 * @return {string}
 */
function nextUserId_() {
  var rows = readAllRows(SHEET_NAMES.USERS);
  var max = 0;

  for (var i = 0; i < rows.length; i++) {
    var match = normalizeString(rows[i].user_id).match(/(\d+)\s*$/);
    if (!match) continue;

    var num = Number(match[1]);
    if (isFinite(num) && num > max) max = num;
  }

  return 'USR' + padNumber_(max + 1, 3);
}

/**
 * @private
 * Re-reads a user and shapes it the way list_users does, so a create or update
 * response and a subsequent list agree field for field.
 *
 * @param {string} userId
 * @return {Object|null}
 */
function readShapedUser_(userId) {
  var row = readRowByKey(SHEET_NAMES.USERS, 'user_id', userId);
  if (!row) return null;

  var user = sanitizeUser_(row);
  user.permissions = permissionsByUser_()[userId] || [];
  return user;
}

/**
 * @private
 * Deletes every session belonging to a user except the one identified by
 * `keepToken`. Deletes by token rather than by row index so each removal
 * re-resolves its own row — safe however the rows shift underneath.
 *
 * In practice this removes nothing: the single-session rule (4.1.b) means a
 * user has one session, and it is the one we are keeping. It exists for the
 * case where a login raced with this call.
 *
 * @param {string} userId
 * @param {string} keepToken
 * @return {number} how many sessions were removed
 */
function deleteOtherSessions_(userId, keepToken) {
  var rows = readRowsWhere(SHEET_NAMES.SESSIONS, 'user_id', userId);
  var removed = 0;

  for (var i = 0; i < rows.length; i++) {
    var token = normalizeString(rows[i].token);
    if (token === '' || token === keepToken) continue;
    if (deleteRowByKey(SHEET_NAMES.SESSIONS, 'token', token)) removed++;
  }
  return removed;
}
