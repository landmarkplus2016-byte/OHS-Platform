/**
 * Auth.gs — login, logout, and session validation (CLAUDE.md Sections 3.2, 4).
 *
 * Password handling: hashes are computed CLIENT-SIDE with SHA-256 and compared
 * here as strings. This file never hashes anything, and `password_hash` never
 * leaves Auth.gs — sanitizeUser_() strips it before the row travels anywhere
 * else.
 *
 * The three session rules from Section 4.1:
 *   a. Fixed expiry — session_expiry_hours from creation, no sliding window.
 *   b. Single active session per user — login wipes that user's other sessions.
 *   c. force_password_change on new accounts and admin resets.
 */

/**
 * Modules the platform currently registers. Super admins receive a synthesized
 * grant covering all of them so the frontend never special-cases super admin
 * (Section 3.2); officers receive implicit view-only across all of them
 * (Section 2, Permissions rules).
 *
 * Adding a module means adding it here — 'vehicles' joins the list when the
 * cars module ships.
 */
var REGISTERED_MODULES = ['employees', 'equipment'];

/** Valid values for Users.role. */
var ROLES = {
  SUPER_ADMIN: 'super_admin',
  MODULE_ADMIN: 'module_admin',
  OFFICER: 'officer'
};

// ---------------------------------------------------------------------------
// Session validation
// ---------------------------------------------------------------------------

/**
 * Validates a session token and builds the request context.
 *
 * Runs the sequence from Section 3.9 before any action-specific logic:
 *   1. token exists in Sessions            → else unauthenticated
 *   2. expires_at is in the future         → else delete row, unauthenticated
 *   3. Users row exists and active = TRUE  → else delete row, unauthenticated
 *   4. fresh permissions loaded            (super admins skip the table)
 *
 * Role and permission decisions use the freshly-read Users row, not the values
 * cached on the Sessions row — a role change takes effect on the next call.
 *
 * Throws `{code: 'unauthenticated', message: '...'}` rather than returning an
 * envelope, so the dispatcher decides how to render the failure.
 *
 * @param {string} token
 * @return {{session: Object, user: Object, permissions: Array<Object>}}
 */
function validateSession(token) {
  var t = normalizeString(token);
  if (t === '') throw authError_('missing_token');

  var sessionRow = readRowByKey(SHEET_NAMES.SESSIONS, 'token', t);
  if (!sessionRow) throw authError_('invalid_token');

  var expiresAt = normalizeIsoDateTime(sessionRow.expires_at);
  var expiresMs = parseIsoUtcMs_(expiresAt);
  if (expiresMs === null || expiresMs <= Date.now()) {
    deleteRowByKey(SHEET_NAMES.SESSIONS, 'token', t);
    throw authError_('session_expired');
  }

  var userRow = readRowByKey(SHEET_NAMES.USERS, 'user_id', sessionRow.user_id);
  if (!userRow) {
    deleteRowByKey(SHEET_NAMES.SESSIONS, 'token', t);
    throw authError_('user_not_found');
  }
  if (!normalizeBoolean(userRow.active)) {
    deleteRowByKey(SHEET_NAMES.SESSIONS, 'token', t);
    throw authError_('user_inactive');
  }

  var user = sanitizeUser_(userRow);

  return {
    session: {
      token: t,
      user_id: user.user_id,
      role: user.role,
      is_super_admin: user.is_super_admin,
      expires_at: expiresAt,
      device_id: normalizeString(sessionRow.device_id),
      created_at: normalizeIsoDateTime(sessionRow.created_at)
    },
    user: user,
    permissions: loadPermissions_(user)
  };
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * `login` — exchanges username + password hash for a session token.
 *
 * Every credential failure returns the same code and message. Wrong username,
 * wrong hash, inactive account, and never-set password are indistinguishable
 * to the caller; the real reason is logged server-side only.
 *
 * @param {Object} payload  {username, password_hash, device_id}
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleLogin(payload) {
  var username = normalizeString(payload && payload.username);
  var passwordHash = normalizeString(payload && payload.password_hash);
  var deviceId = normalizeString(payload && payload.device_id);

  var fieldErrors = {};
  if (username === '') fieldErrors.username = 'required';
  if (passwordHash === '') fieldErrors.password_hash = 'required';
  if (hasKeys_(fieldErrors)) {
    return errResponse('validation_failed', 'missing_credentials', fieldErrors);
  }

  var userRow = findUserByUsername_(username);
  if (!userRow) {
    console.warn('login rejected: no such username "' + username + '"');
    return errResponse('unauthenticated', 'invalid_credentials');
  }

  var storedHash = normalizeString(userRow.password_hash);
  if (storedHash === '') {
    // Bootstrap state — the account exists but no password has been set yet.
    console.warn('login rejected: no password set for ' + userRow.user_id);
    return errResponse('unauthenticated', 'invalid_credentials');
  }
  if (storedHash.toLowerCase() !== passwordHash.toLowerCase()) {
    console.warn('login rejected: bad password for ' + userRow.user_id);
    return errResponse('unauthenticated', 'invalid_credentials');
  }
  if (!normalizeBoolean(userRow.active)) {
    console.warn('login rejected: inactive account ' + userRow.user_id);
    return errResponse('unauthenticated', 'invalid_credentials');
  }

  var user = sanitizeUser_(userRow);
  var expiryHours = getConfigNumber('session_expiry_hours', CONFIG_DEFAULTS.session_expiry_hours);
  var token = generateUuid();
  var createdAt = nowIso();
  var expiresAt = isoFromMs_(Date.now() + expiryHours * 3600000);

  // The single-session rule is a delete followed by an insert; a script lock
  // keeps two concurrent logins from interleaving into two live sessions.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.error('login: could not acquire script lock for ' + user.user_id);
    return errResponse('server_error', 'lock_timeout');
  }

  try {
    deleteRowsWhere(SHEET_NAMES.SESSIONS, 'user_id', user.user_id);

    appendRow(SHEET_NAMES.SESSIONS, {
      token: token,
      user_id: user.user_id,
      role: user.role,
      is_super_admin: booleanToSheet(user.is_super_admin),
      expires_at: expiresAt,
      device_id: deviceId,
      created_at: createdAt
    });

    updateRowByKey(SHEET_NAMES.USERS, 'user_id', user.user_id, {
      last_login_at: createdAt
    });
  } finally {
    lock.releaseLock();
  }

  return okResponse({
    token: token,
    user: {
      user_id: user.user_id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      is_super_admin: user.is_super_admin,
      must_change_password: user.force_password_change
    },
    permissions: loadPermissions_(user)
  });
}

/**
 * `logout` — deletes the session row. Idempotent: succeeds whether or not the
 * row was still there.
 *
 * @param {{session: Object}} session  The context from validateSession().
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleLogout(session) {
  deleteRowByKey(SHEET_NAMES.SESSIONS, 'token', session.session.token);
  return okResponse({});
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * @private
 * Case-insensitive username lookup. Scans Users rather than using
 * readRowByKey, whose matching is case-sensitive by design.
 */
function findUserByUsername_(username) {
  var target = username.toLowerCase();
  var rows = readAllRows(SHEET_NAMES.USERS);
  for (var i = 0; i < rows.length; i++) {
    if (normalizeString(rows[i].username).toLowerCase() === target) return rows[i];
  }
  return null;
}

/**
 * @private
 * Converts a raw Users row into the safe internal shape: real booleans, no
 * password_hash. Nothing outside this file should ever see the hash.
 */
function sanitizeUser_(row) {
  return {
    user_id: normalizeString(row.user_id),
    username: normalizeString(row.username),
    display_name: normalizeString(row.display_name),
    role: normalizeString(row.role),
    is_super_admin: normalizeBoolean(row.is_super_admin) || normalizeString(row.role) === ROLES.SUPER_ADMIN,
    active: normalizeBoolean(row.active),
    force_password_change: normalizeBoolean(row.force_password_change),
    created_at: normalizeIsoDateTime(row.created_at),
    created_by: normalizeString(row.created_by),
    updated_at: normalizeIsoDateTime(row.updated_at),
    updated_by: normalizeString(row.updated_by),
    last_login_at: normalizeIsoDateTime(row.last_login_at)
  };
}

/**
 * @private
 * Resolves a user's effective permissions.
 *
 *   super admin  → every registered module, view + edit (table bypassed)
 *   officer      → every registered module, view only, never edit
 *   module admin → whatever the Permissions tab grants; missing row = no access
 */
function loadPermissions_(user) {
  if (user.is_super_admin) {
    return REGISTERED_MODULES.map(function (module) {
      return { module: module, can_view: true, can_edit: true };
    });
  }

  if (user.role === ROLES.OFFICER) {
    return REGISTERED_MODULES.map(function (module) {
      return { module: module, can_view: true, can_edit: false };
    });
  }

  var rows = readRowsWhere(SHEET_NAMES.PERMISSIONS, 'user_id', user.user_id);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var module = normalizeString(rows[i].module);
    if (module === '') continue;
    out.push({
      module: module,
      can_view: normalizeBoolean(rows[i].can_view),
      can_edit: normalizeBoolean(rows[i].can_edit)
    });
  }
  return out;
}

/** @private Builds the error object validateSession throws. */
function authError_(message) {
  return { code: 'unauthenticated', message: message };
}

/**
 * @private
 * Parses 'YYYY-MM-DDTHH:MM:SS' as UTC and returns epoch ms, or null.
 * The stored value carries no zone suffix, so 'Z' is appended explicitly —
 * without it the runtime would read it in the script's timezone.
 */
function parseIsoUtcMs_(value) {
  var str = normalizeString(value);
  if (str === '') return null;

  var ms = Date.parse(/[Zz]$|[+-]\d{2}:\d{2}$/.test(str) ? str : str + 'Z');
  return isNaN(ms) ? null : ms;
}

/** @private Epoch ms → 'YYYY-MM-DDTHH:MM:SS' UTC. */
function isoFromMs_(ms) {
  return new Date(ms).toISOString().slice(0, 19);
}
