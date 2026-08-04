/**
 * Main.gs — the single Web App entry point.
 *
 * There is exactly one deployed Apps Script Web App and it exposes one real
 * handler: doPost. Every platform action is a POST carrying
 * {action, token, payload} and gets dispatched from the tables below
 * (CLAUDE.md Section 3.1).
 *
 * Two dispatch tiers:
 *   - PUBLIC_ACTIONS require no token. Only `login` and `get_config` qualify,
 *     plus the `ping` health probe (Section 3.1).
 *   - AUTHENTICATED_ACTIONS run validateSession() first. The session context is
 *     passed to the handler; the handler enforces its own role or module check.
 *
 * An action name in neither table is reported as unknown before any session
 * work happens, so a malformed call from an unauthenticated client gets the
 * accurate `unknown_action` rather than a misleading `unauthenticated`. The
 * action catalog is public in CLAUDE.md, so this leaks nothing.
 */

/** Reported by the health check so a deployment can be identified at a glance. */
var API_VERSION = '1.0';

/**
 * Actions callable without a session token.
 * @type {Object<string, function(Object): GoogleAppsScript.Content.TextOutput>}
 */
var PUBLIC_ACTIONS = {
  'ping': function (payload) {
    return okResponse({ pong: true, at: nowIso() });
  },
  'get_config': function (payload) {
    return handleGetConfig(payload);
  },
  'login': function (payload) {
    return handleLogin(payload);
  }
};

/**
 * Actions requiring a valid session. Each receives the context returned by
 * validateSession() as its first argument.
 * @type {Object<string, function(Object, Object): GoogleAppsScript.Content.TextOutput>}
 */
var AUTHENTICATED_ACTIONS = {
  'logout': function (session, payload) {
    return handleLogout(session);
  },
  'update_config': function (session, payload) {
    return handleUpdateConfig(session, payload);
  },
  'reset_user_password': function (session, payload) {
    return handleResetUserPassword(session, payload);
  }
};

/**
 * Health check. Opening the deployment URL in a browser hits this.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function doGet(e) {
  return okResponse({ service: 'OHS Platform API', version: API_VERSION });
}

/**
 * The action dispatcher.
 *
 * Nothing throws out of here: any unhandled exception becomes a `server_error`
 * envelope so the frontend always parses a well-formed response.
 *
 * @param {GoogleAppsScript.Events.DoPost} e
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return errResponse('validation_failed', 'malformed_json', { body: 'required' });
    }

    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return errResponse('validation_failed', 'malformed_json');
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errResponse('validation_failed', 'malformed_json');
    }

    var action = body.action;
    if (typeof action !== 'string' || action.trim() === '') {
      return errResponse('validation_failed', 'missing_action', { action: 'required' });
    }
    action = action.trim();

    var token = typeof body.token === 'string' ? body.token.trim() : '';
    var payload = (body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload))
      ? body.payload
      : {};

    return dispatch_(action, token, payload);

  } catch (err) {
    console.error('doPost failed: ' + (err && err.stack ? err.stack : err));
    return errResponse('server_error', String(err));
  }
}

/**
 * @private
 * Routes an action to its handler, validating the session for the ones that
 * need it. Unknown names are a validation failure rather than a 404 — the
 * request itself is malformed (Section 3.9).
 *
 * @param {string} action
 * @param {string} token
 * @param {Object} payload
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function dispatch_(action, token, payload) {
  if (Object.prototype.hasOwnProperty.call(PUBLIC_ACTIONS, action)) {
    return PUBLIC_ACTIONS[action](payload);
  }

  if (!Object.prototype.hasOwnProperty.call(AUTHENTICATED_ACTIONS, action)) {
    return errResponse('validation_failed', 'unknown_action', { action: 'unknown' });
  }

  var session;
  try {
    session = validateSession(token);
  } catch (err) {
    // validateSession throws {code, message}; anything else is a real fault and
    // belongs in the doPost catch as a server_error.
    if (err && err.code) return errResponse(err.code, err.message);
    throw err;
  }

  return AUTHENTICATED_ACTIONS[action](session, payload);
}
