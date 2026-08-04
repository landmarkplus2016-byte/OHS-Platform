/**
 * Users.gs — user and permission actions (CLAUDE.md Section 3.4).
 *
 * All of these are super-admin gated except `reset_user_password`, which is the
 * one action a user may aim at themselves.
 *
 * Built so far: reset_user_password.
 * Still to come: list_users, create_user, update_user, deactivate_user,
 * list_permissions.
 *
 * Password handling here mirrors Auth.gs: hashes arrive already computed by the
 * browser (Section 4.2), are compared as strings, and are never returned by any
 * action or written to a log.
 */

/** A SHA-256 hex digest as produced by js/utils/crypto.js. */
var SHA256_HEX_RE_ = /^[0-9a-f]{64}$/i;

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
