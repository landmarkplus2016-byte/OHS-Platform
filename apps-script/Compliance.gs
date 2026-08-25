/**
 * Compliance.gs — the single source of truth for compliance states and
 * verdicts (CLAUDE.md Section 6).
 *
 * Every list_* and get_* action calls in here once per row and ships the result
 * in the row's `derived` block. The frontend never re-derives — admin lists,
 * dashboard, officer app, and exports all read the same computed answer, so
 * "what the admin saw" and "what the officer saw" cannot drift.
 *
 * Nothing in this file touches SpreadsheetApp. Thresholds and module settings
 * are loaded once per request by the caller and passed in.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The seven certificate states (Section 6.1). There is no `plan` tier. */
var CERT_STATES = {
  SUSPENDED: 'suspended',
  EXPIRED: 'expired',
  URGENT: 'urgent',
  SOON: 'soon',
  MISSING: 'missing',
  VALID: 'valid',
  NA: 'na'
};

/** The three verdicts (Sections 6.2, 6.3). */
var VERDICTS = {
  CLEARED: 'cleared',
  WARNING: 'warning',
  BLOCKED: 'blocked'
};

/**
 * Worst-wins ranking: suspended > expired > urgent > soon > missing > valid.
 * `missing` outranks `valid` because absent data is a worse answer than a good
 * one, but it never becomes a blocker or a warning on its own (Section 6.2).
 *
 * `na` ranks below `valid` and is additionally skipped by the aggregate loop —
 * a certificate the admin marked "not applicable" is not required work, so it
 * can never be the worst thing about an employee (Section 6.1).
 */
var STATE_RANKS = {
  suspended: 6,
  expired: 5,
  urgent: 4,
  soon: 3,
  missing: 1,
  valid: 0,
  na: -1
};

/** Certs that go `suspended` when MCU is expired. */
var WAH_KEYS = ['wah_practical', 'wah_theoretical'];

/** Certs that apply to a field-team employee. */
var APPLICABLE_CERTS_FIELD = ['wah_practical', 'wah_theoretical', 'ra', 'fa', 'ff', 'ec', 'mcu'];

/** Safety-team employees carry the field set plus three more. */
var APPLICABLE_CERTS_SAFETY = APPLICABLE_CERTS_FIELD.concat(['ppe', 'lifting', 'scaffolding']);

/** Fallbacks when ModuleSettings has no row (Section 6.2). */
var DEFAULT_BLOCKER_CERTS = ['wah_practical', 'wah_theoretical', 'mcu'];
var DEFAULT_WARNING_CERTS = ['fa', 'ff', 'ra', 'ec'];

/**
 * The three retired `wave_N_*` column pairs on the Equipment tab.
 *
 * Waves live on the InspectionWaves tab now. This survives for exactly one
 * caller — migrateWavesToLog(), which reads those columns to copy them across —
 * and should go with them when the columns are eventually deleted by hand.
 */
var EQUIPMENT_WAVES = [1, 2, 3];

// ---------------------------------------------------------------------------
// Thresholds and module settings
// ---------------------------------------------------------------------------

/**
 * Builds the thresholds object from Config. Callers load this once per request
 * and pass it to every derivation (Section 6.5).
 *
 * @return {{urgent_days: number, soon_days: number}}
 */
function getComplianceThresholds() {
  return {
    urgent_days: getConfigNumber('urgent_days', CONFIG_DEFAULTS.urgent_days),
    soon_days: getConfigNumber('soon_days', CONFIG_DEFAULTS.soon_days)
  };
}

/**
 * Reads `employees.blocker_certs` from ModuleSettings. These certs block a site
 * check when expired or suspended.
 *
 * @param {Object} moduleSettings
 * @return {Array<string>}
 */
function getBlockerCerts(moduleSettings) {
  return parseCertList_(
    readModuleSetting_(moduleSettings, 'employees', 'blocker_certs'),
    DEFAULT_BLOCKER_CERTS
  );
}

/**
 * Reads `employees.warning_certs` from ModuleSettings. These certs warn when
 * expired or urgent, but never block.
 *
 * @param {Object} moduleSettings
 * @return {Array<string>}
 */
function getWarningCerts(moduleSettings) {
  return parseCertList_(
    readModuleSetting_(moduleSettings, 'employees', 'warning_certs'),
    DEFAULT_WARNING_CERTS
  );
}

// ---------------------------------------------------------------------------
// Certificate state
// ---------------------------------------------------------------------------

/**
 * Classifies one expiry date into a state (Section 6.1).
 *
 * Returns four of the seven states. The other three are decisions about the
 * certificate rather than about its date, and deriveEmployeeDerived applies them
 * on top: `na` and `suspended` come from the row's own flag columns, and
 * `suspended` is additionally a cross-certificate outcome of an expired MCU.
 * Keeping this function about the date alone is what lets equipment reuse it for
 * `third_party_inspection_end_date`, which has no flags.
 *
 * A cert expiring today is `urgent`, not `expired`: the rule is
 * `expiry_date < today`.
 *
 * @param {*} dateStr    Expiry date, any shape normalizeIsoDate accepts.
 * @param {*} today      Reference date; defaults to today (UTC).
 * @param {{urgent_days: number, soon_days: number}} thresholds
 * @return {string}
 */
function deriveCertState(dateStr, today, thresholds) {
  var expiry = normalizeIsoDate(dateStr);
  if (expiry === '') return CERT_STATES.MISSING;

  var limits = normalizeThresholds_(thresholds);
  var days = daysBetweenIso_(resolveToday_(today), expiry);
  if (days === null) return CERT_STATES.MISSING;

  if (days < 0) return CERT_STATES.EXPIRED;
  if (days <= limits.urgent_days) return CERT_STATES.URGENT;
  if (days <= limits.soon_days) return CERT_STATES.SOON;
  return CERT_STATES.VALID;
}

/**
 * Worst-wins rank for a state. Unknown states rank 0 so a bad value can never
 * outrank a real problem.
 *
 * @param {string} state
 * @return {number}
 */
function stateRank(state) {
  var rank = STATE_RANKS[state];
  return rank === undefined ? 0 : rank;
}

// ---------------------------------------------------------------------------
// Employee derivation (Sections 6.1, 6.2, 6.4)
// ---------------------------------------------------------------------------

/**
 * Builds the full `derived` block for one employee row.
 *
 * @param {Object} employeeRow  Raw Employees row.
 * @param {*} today
 * @param {{urgent_days: number, soon_days: number}} thresholds
 * @param {Object} moduleSettings
 * @return {Object} {per_cert, worst_state, expired_count, expiring_soon_count,
 *                   verdict, blockers, warnings}
 */
function deriveEmployeeDerived(employeeRow, today, thresholds, moduleSettings) {
  var row = employeeRow || {};
  var refDate = resolveToday_(today);
  var limits = normalizeThresholds_(thresholds);

  var applicable = normalizeString(row.team).toLowerCase() === 'safety'
    ? APPLICABLE_CERTS_SAFETY
    : APPLICABLE_CERTS_FIELD;

  // --- 1. Per-cert states --------------------------------------------------
  // Two admin flags on the row outrank the expiry date (Section 6.1):
  //
  //   cert_<key>_na          this certificate does not apply to this employee
  //   cert_<key>_suspended   it applies, but it is void right now
  //
  // N/A wins when both are ticked — a certificate that is not required cannot
  // be suspended, so there is nothing for the second flag to say. The form
  // enforces the same precedence by disabling the suspended box, but the answer
  // is decided here; the client is never the gate (rule 5).
  var perCert = {};
  var expiryDates = {};
  var manualSuspended = {};

  for (var i = 0; i < applicable.length; i++) {
    var key = applicable[i];
    var raw = row['cert_' + key + '_expiry'];
    expiryDates[key] = normalizeIsoDate(raw);

    if (normalizeBoolean(row['cert_' + key + '_na'])) {
      perCert[key] = CERT_STATES.NA;
    } else if (normalizeBoolean(row['cert_' + key + '_suspended'])) {
      perCert[key] = CERT_STATES.SUSPENDED;
      manualSuspended[key] = true;
    } else {
      perCert[key] = deriveCertState(raw, refDate, limits);
    }
  }

  // --- 2. WAH suspension ---------------------------------------------------
  // MCU is the medical prerequisite for working at heights: when it lapses,
  // both WAH certs are void regardless of their own dates. A WAH cert with no
  // date stays `missing` — there is nothing to suspend — and one flagged N/A
  // stays `na` for the same reason. Applied before the worst_state and blocker
  // passes so it cascades (Section 6.1).
  //
  // The trigger is strictly `mcu === expired`, so an MCU the admin flagged N/A
  // or manually suspended does not cascade. A manually suspended MCU is already
  // a blocker in its own right; whether it should also void WAH is a policy
  // question, not a mechanical one, and it is not one this file gets to answer.
  if (perCert.mcu === CERT_STATES.EXPIRED) {
    for (var w = 0; w < WAH_KEYS.length; w++) {
      var wahKey = WAH_KEYS[w];
      if (perCert[wahKey] === undefined) continue;
      if (perCert[wahKey] === CERT_STATES.MISSING || perCert[wahKey] === CERT_STATES.NA) continue;
      perCert[wahKey] = CERT_STATES.SUSPENDED;
    }
  }

  // --- 3. Aggregates -------------------------------------------------------
  // N/A takes no part: it is recorded in per_cert so the UI can show the badge,
  // but it is not required work, so it neither competes for worst_state nor
  // counts toward anything (Section 6.1).
  var worstState = CERT_STATES.VALID;
  var expiredCount = 0;
  var expiringSoonCount = 0;

  for (var certKey in perCert) {
    if (!Object.prototype.hasOwnProperty.call(perCert, certKey)) continue;
    var state = perCert[certKey];
    if (state === CERT_STATES.NA) continue;

    if (stateRank(state) > stateRank(worstState)) worstState = state;
    if (state === CERT_STATES.EXPIRED) expiredCount++;
    if (state === CERT_STATES.URGENT || state === CERT_STATES.SOON) expiringSoonCount++;
  }

  // --- 4. Blockers ---------------------------------------------------------
  var blockerCerts = getBlockerCerts(moduleSettings);
  var warningCerts = getWarningCerts(moduleSettings);
  var blockers = [];

  var employmentStatus = normalizeString(row.employment_status);
  if (employmentStatus.toLowerCase() !== 'active') {
    blockers.push(reason_('employment_status', 'reason_employment_status', {
      status: employmentStatus
    }));
  }

  if (normalizeBoolean(row.archived)) {
    blockers.push(reason_('archived', 'reason_archived', {}));
  }

  var legalPermission = normalizeString(row.legal_permission);
  if (legalPermission.toLowerCase() !== 'approved') {
    blockers.push(reason_('legal_permission', 'reason_legal_permission', {
      status: legalPermission
    }));
  }

  // Expired blocker certs first, then suspensions — this is the order the
  // Section 6.4 example shows (MCU expired, then both WAH suspended).
  //
  // A cert flagged N/A never reaches either loop: its state is `na`, which
  // matches neither test. That is the whole of the "excluded from the verdict"
  // rule — there is no separate skip to keep in sync.
  for (var b = 0; b < blockerCerts.length; b++) {
    var bKey = blockerCerts[b];
    if (perCert[bKey] !== CERT_STATES.EXPIRED) continue;
    blockers.push(reason_('cert_expired', 'reason_expired', {
      cert: bKey,
      days: Math.abs(daysBetweenIso_(refDate, expiryDates[bKey]) || 0)
    }));
  }

  for (var s = 0; s < blockerCerts.length; s++) {
    var sKey = blockerCerts[s];
    if (perCert[sKey] !== CERT_STATES.SUSPENDED) continue;
    blockers.push(suspendedReason_(sKey, manualSuspended));
  }

  // --- 5. Warnings (only meaningful when nothing blocks) -------------------
  var warnings = [];
  if (blockers.length === 0) {
    for (var u = 0; u < blockerCerts.length; u++) {
      var uKey = blockerCerts[u];
      if (perCert[uKey] !== CERT_STATES.URGENT) continue;
      warnings.push(reason_('cert_expiring', 'reason_expiring', {
        cert: uKey,
        days: daysBetweenIso_(refDate, expiryDates[uKey]) || 0
      }));
    }

    for (var v = 0; v < warningCerts.length; v++) {
      var vKey = warningCerts[v];
      var vState = perCert[vKey];
      if (vState === CERT_STATES.SUSPENDED) {
        // A suspended cert is void, which is at least as bad as an expired one
        // — but the tier is the cert's, not the state's. On a warning cert that
        // means a warning, the same way an expired one does.
        warnings.push(suspendedReason_(vKey, manualSuspended));
      } else if (vState === CERT_STATES.EXPIRED) {
        warnings.push(reason_('cert_expired', 'reason_expired', {
          cert: vKey,
          days: Math.abs(daysBetweenIso_(refDate, expiryDates[vKey]) || 0)
        }));
      } else if (vState === CERT_STATES.URGENT) {
        warnings.push(reason_('cert_expiring', 'reason_expiring', {
          cert: vKey,
          days: daysBetweenIso_(refDate, expiryDates[vKey]) || 0
        }));
      }
    }
  }

  return {
    worst_state: worstState,
    expired_count: expiredCount,
    expiring_soon_count: expiringSoonCount,
    per_cert: perCert,
    verdict: verdictFrom_(blockers, warnings),
    blockers: blockers,
    warnings: warnings
  };
}

// ---------------------------------------------------------------------------
// Equipment derivation (Sections 6.3, 6.4)
// ---------------------------------------------------------------------------

/**
 * Builds the `derived` block for one equipment row.
 *
 * Equipment uses its own urgent threshold when ModuleSettings carries
 * `equipment.urgent_days`; otherwise it falls back to the global value.
 *
 * Internal inspection waves arrive in `wavesByEquipmentId` rather than being read
 * off the row. They live on their own tab (InspectionWaves.gs) because three
 * fixed column pairs could not hold a comment, an author, or a fourth
 * inspection. Callers group the tab once per request and pass the map, the same
 * way `employeesById` is threaded through for the team leader join.
 *
 * An absent map means no waves, not an error: it is what every item looks like
 * before the migration has run, and the verdict falls back to the third-party
 * date alone — exactly the behaviour of an item that has never been inspected
 * internally.
 *
 * @param {Object} equipmentRow    Raw Equipment row.
 * @param {*} today
 * @param {{urgent_days: number, soon_days: number}} thresholds
 * @param {Object} moduleSettings
 * @param {Object<string, Object>=} employeesById  employee_id → Employees row.
 * @param {Object<string, Array<Object>>=} wavesByEquipmentId  equipment_id →
 *     live waves (neither voided nor rejected), newest first. Pending waves are
 *     included: a pending fail blocks, a pending pass does not clear.
 * @return {Object} {third_party_state, verdict, blockers, warnings}
 */
function deriveEquipmentDerived(
  equipmentRow, today, thresholds, moduleSettings, employeesById, wavesByEquipmentId
) {
  var row = equipmentRow || {};
  var refDate = resolveToday_(today);
  var limits = normalizeThresholds_(thresholds);

  var equipmentUrgent = Number(readModuleSetting_(moduleSettings, 'equipment', 'urgent_days'));
  if (isFinite(equipmentUrgent) && equipmentUrgent > 0) {
    limits = { urgent_days: equipmentUrgent, soon_days: limits.soon_days };
  }

  var thirdPartyDate = normalizeIsoDate(row.third_party_inspection_end_date);
  var thirdPartyState = deriveCertState(thirdPartyDate, refDate, limits);

  var blockers = [];
  var warnings = [];

  // --- Blockers ------------------------------------------------------------
  if (normalizeBoolean(row.rejected)) {
    blockers.push(reason_('rejected', 'reason_equipment_rejected', {
      reason: normalizeString(row.rejection_reason)
    }));
  }

  if (thirdPartyState === CERT_STATES.EXPIRED) {
    blockers.push(reason_('third_party_expired', 'reason_third_party_expired', {
      days: Math.abs(daysBetweenIso_(refDate, thirdPartyDate) || 0)
    }));
  }

  var equipmentId = normalizeString(row.equipment_id);
  var itemWaves = (wavesByEquipmentId && wavesByEquipmentId[equipmentId]) || [];

  // An approved fail keeps the item out of service.
  var latestWave = findLatestCompletedWave_(itemWaves);
  if (latestWave && latestWave.result === 'fail') {
    blockers.push(reason_('wave_failed', 'reason_wave_failed', {
      wave: latestWave.wave,
      date: latestWave.date
    }));
  }

  // An unresolved fail does too, whoever filed it and whether or not an admin
  // has got to it yet. The asymmetry with a pending pass below is the whole of
  // the review policy: an officer can take equipment out of service on their
  // own word, and cannot put it back.
  var pendingFail = findPendingFailedWave_(itemWaves);
  if (pendingFail) {
    blockers.push(reason_('wave_pending_fail', 'reason_wave_pending_fail', {
      wave: pendingFail.wave,
      date: pendingFail.date
    }));
  }

  // --- Warnings (only meaningful when nothing blocks) ----------------------
  if (blockers.length === 0) {
    // A pending pass is invisible to the verdict — findLatestCompletedWave_
    // never sees it — so the item sits on whatever its last approved wave and
    // third-party date say. This says so out loud, because otherwise an
    // inspection an officer filed this morning leaves no trace on the item
    // until somebody opens the review queue.
    var pendingPass = findPendingPassedWave_(itemWaves);
    if (pendingPass) {
      warnings.push(reason_('wave_pending_review', 'reason_wave_pending_review', {
        wave: pendingPass.wave,
        date: pendingPass.date
      }));
    }

    // Missing proof of inspection is not the same as a failed one, but it is
    // not safe to fully clear either (Section 6.3).
    if (thirdPartyState === CERT_STATES.MISSING) {
      warnings.push(reason_('third_party_missing', 'reason_third_party_missing', {}));
    } else if (thirdPartyState === CERT_STATES.URGENT) {
      warnings.push(reason_('third_party_expiring', 'reason_third_party_expiring', {
        days: daysBetweenIso_(refDate, thirdPartyDate) || 0
      }));
    }

    var leaderId = normalizeString(row.team_leader_id);
    if (leaderId !== '' && employeesById) {
      var leader = employeesById[leaderId];
      if (leader && normalizeBoolean(leader.archived)) {
        warnings.push(reason_('owner_archived', 'reason_owner_archived', {
          name: normalizeString(leader.name)
        }));
      }
    }
  }

  return {
    third_party_state: thirdPartyState,
    verdict: verdictFrom_(blockers, warnings),
    blockers: blockers,
    warnings: warnings
  };
}

/**
 * @private
 * The most recent *approved* completed wave — one with a date and a result.
 *
 * Section 6.3 defines "most recent" by latest date, ties broken by the highest
 * wave number. Unchanged by the move to a log, and unchanged by the review
 * flow; what changed is which waves are eligible to be it.
 *
 * Only approved waves are, and that is the load-bearing half of the review
 * policy. A pending pass is not an item that has been cleared — it is an item
 * whose clearance nobody has confirmed — so it must not be able to displace the
 * last wave that *was* confirmed. A pending fail is handled separately and
 * blocks on its own (findPendingFailedWave_), which is why filtering here is
 * safe rather than permissive.
 *
 * The caller has already dropped voided and rejected waves
 * (wavesByEquipmentId_ in InspectionWaves.gs filters them at the source), so
 * everything reaching here is live. Doing it there rather than here means no
 * derivation path can forget.
 *
 * The list arrives newest-first, but this does not assume it — a scan costs
 * nothing on a handful of waves and the answer stays right if a caller ever
 * hands over an unsorted array.
 *
 * @param {Array<Object>} waves  Live waves for one item.
 * @return {{wave: number, date: string, result: string}|null}
 */
function findLatestCompletedWave_(waves) {
  return findLatestWaveWhere_(waves, function (wave) {
    return waveApprovalOf_(wave) === 'approved';
  });
}

/**
 * @private
 * The most recent unresolved failed wave, or null.
 *
 * This is what lets an officer take equipment out of service without waiting.
 * It deliberately does not care whether a later approved pass exists: a fail
 * nobody has ruled on is an open question about the item, and an open question
 * about a harness is answered by not using the harness. Approving or rejecting
 * it is what closes the question, and either one removes it from here.
 *
 * @param {Array<Object>} waves
 * @return {{wave: number, date: string, result: string}|null}
 */
function findPendingFailedWave_(waves) {
  return findLatestWaveWhere_(waves, function (wave) {
    return waveApprovalOf_(wave) === 'pending' &&
      normalizeString(wave.result).toLowerCase() === 'fail';
  });
}

/**
 * @private
 * The most recent pending passed wave, or null. Drives a warning only — a pass
 * changes nothing until somebody confirms it.
 *
 * @param {Array<Object>} waves
 * @return {{wave: number, date: string, result: string}|null}
 */
function findPendingPassedWave_(waves) {
  return findLatestWaveWhere_(waves, function (wave) {
    return waveApprovalOf_(wave) === 'pending' &&
      normalizeString(wave.result).toLowerCase() === 'pass';
  });
}

/**
 * @private
 * A wave's review state, defaulted the way shapeInspectionWave_ defaults it.
 *
 * Derivation runs on shaped waves in every real path, so this is belt and
 * braces — but deriveEquipmentDerived is also called directly by the test
 * helpers with hand-built rows, and a blank there must not silently read as
 * "not approved" and unblock an item.
 */
function waveApprovalOf_(wave) {
  var value = normalizeString(wave.approval_status).toLowerCase();
  if (value === 'pending' || value === 'approved' || value === 'rejected') return value;
  return normalizeString(wave.origin).toLowerCase() === 'officer' ? 'pending' : 'approved';
}

/**
 * @private
 * The newest wave with a date and a result that satisfies `predicate`.
 *
 * @param {Array<Object>} waves
 * @param {function(Object): boolean} predicate
 * @return {{wave: number, date: string, result: string}|null}
 */
function findLatestWaveWhere_(waves, predicate) {
  var best = null;
  if (!waves || !waves.length) return null;

  for (var i = 0; i < waves.length; i++) {
    var date = normalizeIsoDate(waves[i].wave_date);
    var result = normalizeString(waves[i].result).toLowerCase();
    if (date === '' || result === '') continue;
    if (!predicate(waves[i])) continue;

    var waveNo = Number(waves[i].wave_no) || 0;
    var candidate = { wave: waveNo, date: date, result: result };
    if (!best || candidate.date > best.date ||
        (candidate.date === best.date && candidate.wave > best.wave)) {
      best = candidate;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** @private Builds one blocker/warning entry in the Section 6.4 shape. */
function reason_(type, textKey, textParams) {
  return { type: type, text_key: textKey, text_params: textParams || {} };
}

/**
 * @private
 * The reason entry for a suspended certificate, worded for *why* it is
 * suspended.
 *
 * Both routes to `suspended` produce the same state and the same violet badge,
 * but they are different facts and the officer standing at the gate needs the
 * right one: "the medical has expired" tells the team leader to renew the MCU,
 * while "the certificate is suspended" tells them to ask the office. Guessing
 * the first when the truth is the second sends someone to renew a medical that
 * was never the problem.
 *
 * @param {string} certKey
 * @param {Object<string, boolean>} manualSuspended  Keys flagged on the row.
 * @return {Object}
 */
function suspendedReason_(certKey, manualSuspended) {
  return manualSuspended[certKey]
    ? reason_('cert_suspended', 'reason_cert_suspended', { cert: certKey })
    : reason_('wah_suspended', 'reason_wah_suspended', { cert: certKey });
}

/** @private blocked > warning > cleared. */
function verdictFrom_(blockers, warnings) {
  if (blockers.length > 0) return VERDICTS.BLOCKED;
  if (warnings.length > 0) return VERDICTS.WARNING;
  return VERDICTS.CLEARED;
}

/** @private Fills in any missing threshold with its Config default. */
function normalizeThresholds_(thresholds) {
  var t = thresholds || {};
  var urgent = Number(t.urgent_days);
  var soon = Number(t.soon_days);

  return {
    urgent_days: (isFinite(urgent) && urgent > 0) ? urgent : CONFIG_DEFAULTS.urgent_days,
    soon_days: (isFinite(soon) && soon > 0) ? soon : CONFIG_DEFAULTS.soon_days
  };
}

/** @private Reference date as 'YYYY-MM-DD', defaulting to today (UTC). */
function resolveToday_(today) {
  var resolved = normalizeIsoDate(today);
  return resolved === '' ? todayIso() : resolved;
}

/**
 * @private
 * Whole days from `fromIso` to `toIso`. Positive means `toIso` is in the
 * future. Both parsed as UTC midnight, so DST can never shift the count.
 *
 * @return {number|null} null when either date is unusable.
 */
function daysBetweenIso_(fromIso, toIso) {
  var from = utcMidnightMs_(fromIso);
  var to = utcMidnightMs_(toIso);
  if (from === null || to === null) return null;
  return Math.round((to - from) / 86400000);
}

/** @private 'YYYY-MM-DD' → epoch ms at UTC midnight, or null. */
function utcMidnightMs_(iso) {
  var str = normalizeIsoDate(iso);
  if (str === '') return null;

  var parts = str.split('-');
  var ms = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return isNaN(ms) ? null : ms;
}

/**
 * @private
 * Reads one ModuleSettings value, tolerating the three shapes it can arrive in:
 *   - nested map:  {employees: {blocker_certs: '...'}}   ← canonical
 *   - flat map:    {'employees.blocker_certs': '...'}
 *   - raw rows:    [{module, setting_key, setting_value}, ...]
 *
 * @return {string} '' when absent.
 */
function readModuleSetting_(moduleSettings, module, settingKey) {
  if (!moduleSettings) return '';

  if (Array.isArray(moduleSettings)) {
    for (var i = 0; i < moduleSettings.length; i++) {
      var r = moduleSettings[i] || {};
      if (normalizeString(r.module) === module && normalizeString(r.setting_key) === settingKey) {
        return normalizeString(r.setting_value);
      }
    }
    return '';
  }

  var nested = moduleSettings[module];
  if (nested && typeof nested === 'object' && nested[settingKey] !== undefined) {
    return normalizeString(nested[settingKey]);
  }

  var flat = moduleSettings[module + '.' + settingKey];
  return flat === undefined ? '' : normalizeString(flat);
}

/** @private Comma-separated cert list → trimmed array, or the default. */
function parseCertList_(raw, fallback) {
  var value = normalizeString(raw);
  if (value === '') return fallback.slice();

  var parts = value.split(',');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var key = normalizeString(parts[i]);
    if (key !== '') out.push(key);
  }
  return out.length ? out : fallback.slice();
}

// ---------------------------------------------------------------------------
// Test harness (BUILD.md Stage 2.3)
//
// Run testDerivation() from the Apps Script editor and read the execution log.
// Touches no Sheet — every row is constructed in memory, so it is safe to run
// against the live spreadsheet.
// ---------------------------------------------------------------------------

/** Runs every Stage 2.3 derivation case and logs a pass/fail line for each. */
function testDerivation() {
  var thresholds = { urgent_days: 30, soon_days: 60 };
  var settings = {};
  var today = todayIso();
  var results = { passed: 0, failed: 0 };

  // --- 1. Everything valid -------------------------------------------------
  var d1 = deriveEmployeeDerived(testEmployee_({}), today, thresholds, settings);
  check_(results, '1. all valid → cleared', d1.verdict === VERDICTS.CLEARED, d1.verdict);

  // --- 2. Expired MCU cascades to both WAH certs ---------------------------
  var d2 = deriveEmployeeDerived(testEmployee_({
    cert_mcu_expiry: testDateOffset_(-5),
    cert_wah_practical_expiry: testDateOffset_(200),
    cert_wah_theoretical_expiry: testDateOffset_(200)
  }), today, thresholds, settings);

  check_(results, '2. expired MCU → blocked', d2.verdict === VERDICTS.BLOCKED, d2.verdict);
  check_(results, '2. expired MCU → 3 blockers', d2.blockers.length === 3, d2.blockers.length);
  check_(results, '2. mcu = expired', d2.per_cert.mcu === CERT_STATES.EXPIRED, d2.per_cert.mcu);
  check_(results, '2. wah_practical = suspended',
    d2.per_cert.wah_practical === CERT_STATES.SUSPENDED, d2.per_cert.wah_practical);
  check_(results, '2. wah_theoretical = suspended',
    d2.per_cert.wah_theoretical === CERT_STATES.SUSPENDED, d2.per_cert.wah_theoretical);
  check_(results, '2. worst_state = suspended',
    d2.worst_state === CERT_STATES.SUSPENDED, d2.worst_state);
  check_(results, '2. expired_count = 1', d2.expired_count === 1, d2.expired_count);

  // --- 3. Expired MCU with a missing WAH cert ------------------------------
  var d3 = deriveEmployeeDerived(testEmployee_({
    cert_mcu_expiry: testDateOffset_(-5),
    cert_wah_practical_expiry: '',
    cert_wah_theoretical_expiry: testDateOffset_(200)
  }), today, thresholds, settings);

  check_(results, '3. missing WAH stays missing',
    d3.per_cert.wah_practical === CERT_STATES.MISSING, d3.per_cert.wah_practical);
  check_(results, '3. other WAH suspended',
    d3.per_cert.wah_theoretical === CERT_STATES.SUSPENDED, d3.per_cert.wah_theoretical);
  check_(results, '3. 2 blockers', d3.blockers.length === 2, d3.blockers.length);

  // --- 4. WAH urgent -------------------------------------------------------
  var d4 = deriveEmployeeDerived(testEmployee_({
    cert_wah_practical_expiry: testDateOffset_(20)
  }), today, thresholds, settings);
  check_(results, '4. WAH in 20 days → warning', d4.verdict === VERDICTS.WARNING, d4.verdict);

  // --- 5. No 90-day plan tier ---------------------------------------------
  var d5 = deriveEmployeeDerived(testEmployee_({
    cert_ra_expiry: testDateOffset_(75)
  }), today, thresholds, settings);
  check_(results, '5. 75 days out = valid', d5.per_cert.ra === CERT_STATES.VALID, d5.per_cert.ra);
  check_(results, '5. 75 days out → cleared', d5.verdict === VERDICTS.CLEARED, d5.verdict);

  // --- 6. Archived ---------------------------------------------------------
  var d6 = deriveEmployeeDerived(testEmployee_({ archived: 'TRUE' }), today, thresholds, settings);
  check_(results, '6. archived → blocked', d6.verdict === VERDICTS.BLOCKED, d6.verdict);

  // --- 6a. N/A excludes a cert from state, counts, and the verdict ----------
  var d6a = deriveEmployeeDerived(testEmployee_({
    cert_ff_expiry: testDateOffset_(-40),
    cert_ff_na: 'TRUE'
  }), today, thresholds, settings);

  check_(results, '6a. N/A cert = na', d6a.per_cert.ff === CERT_STATES.NA, d6a.per_cert.ff);
  check_(results, '6a. N/A ignores its own expired date',
    d6a.worst_state === CERT_STATES.VALID, d6a.worst_state);
  check_(results, '6a. N/A not counted', d6a.expired_count === 0, d6a.expired_count);
  check_(results, '6a. N/A raises no warning', d6a.verdict === VERDICTS.CLEARED, d6a.verdict);

  // --- 6b. N/A MCU does not cascade to WAH ---------------------------------
  var d6b = deriveEmployeeDerived(testEmployee_({
    cert_mcu_expiry: testDateOffset_(-5),
    cert_mcu_na: 'TRUE'
  }), today, thresholds, settings);

  check_(results, '6b. N/A MCU leaves WAH alone',
    d6b.per_cert.wah_practical === CERT_STATES.VALID, d6b.per_cert.wah_practical);
  check_(results, '6b. N/A MCU → cleared', d6b.verdict === VERDICTS.CLEARED, d6b.verdict);

  // --- 6c. Manual suspension on a blocker cert -----------------------------
  var d6c = deriveEmployeeDerived(testEmployee_({
    cert_wah_practical_suspended: 'TRUE'
  }), today, thresholds, settings);

  check_(results, '6c. flagged cert = suspended',
    d6c.per_cert.wah_practical === CERT_STATES.SUSPENDED, d6c.per_cert.wah_practical);
  check_(results, '6c. blocker cert suspended → blocked',
    d6c.verdict === VERDICTS.BLOCKED, d6c.verdict);
  check_(results, '6c. reason is cert_suspended, not wah_suspended',
    d6c.blockers.length === 1 && d6c.blockers[0].text_key === 'reason_cert_suspended',
    d6c.blockers);

  // --- 6d. Manual suspension on a warning cert -----------------------------
  var d6d = deriveEmployeeDerived(testEmployee_({
    cert_fa_suspended: 'TRUE'
  }), today, thresholds, settings);

  check_(results, '6d. warning cert suspended → warning',
    d6d.verdict === VERDICTS.WARNING, d6d.verdict);
  check_(results, '6d. worst_state = suspended',
    d6d.worst_state === CERT_STATES.SUSPENDED, d6d.worst_state);

  // --- 6e. N/A beats suspended when both are ticked ------------------------
  var d6e = deriveEmployeeDerived(testEmployee_({
    cert_ppe_na: 'TRUE',
    cert_ppe_suspended: 'TRUE',
    team: 'safety',
    cert_ppe_expiry: testDateOffset_(365),
    cert_lifting_expiry: testDateOffset_(365),
    cert_scaffolding_expiry: testDateOffset_(365)
  }), today, thresholds, settings);

  check_(results, '6e. N/A wins over suspended',
    d6e.per_cert.ppe === CERT_STATES.NA, d6e.per_cert.ppe);
  check_(results, '6e. → cleared', d6e.verdict === VERDICTS.CLEARED, d6e.verdict);

  // --- 6f. Expired MCU still cascades over a manually suspended WAH --------
  var d6f = deriveEmployeeDerived(testEmployee_({
    cert_mcu_expiry: testDateOffset_(-5),
    cert_wah_practical_suspended: 'TRUE'
  }), today, thresholds, settings);

  check_(results, '6f. manual flag keeps its own reason',
    d6f.blockers.length === 3 && d6f.blockers[1].text_key === 'reason_cert_suspended',
    d6f.blockers);
  check_(results, '6f. cascaded WAH keeps the MCU reason',
    d6f.blockers.length === 3 && d6f.blockers[2].text_key === 'reason_wah_suspended',
    d6f.blockers);

  // --- 7. Equipment: third-party expired -----------------------------------
  var e7 = deriveEquipmentDerived(testEquipment_({
    third_party_inspection_end_date: testDateOffset_(-1)
  }), today, thresholds, settings, {});
  check_(results, '7. third-party expired → blocked', e7.verdict === VERDICTS.BLOCKED, e7.verdict);

  // --- 8. Equipment: no third-party date -----------------------------------
  var e8 = deriveEquipmentDerived(testEquipment_({
    third_party_inspection_end_date: ''
  }), today, thresholds, settings, {});
  check_(results, '8. third-party missing → warning', e8.verdict === VERDICTS.WARNING, e8.verdict);

  // --- 9. Equipment: latest wave failed ------------------------------------
  // Waves now arrive from the log rather than off the row (InspectionWaves.gs).
  // The rule is unchanged: newest completed wave decides, and a fail blocks.
  var e9 = deriveEquipmentDerived(testEquipment_({
    third_party_inspection_end_date: testDateOffset_(200)
  }), today, thresholds, settings, {}, testWaves_([
    { wave_no: 1, wave_date: testDateOffset_(-60), result: 'pass' },
    { wave_no: 2, wave_date: testDateOffset_(-10), result: 'fail' }
  ]));
  check_(results, '9. latest wave failed → blocked', e9.verdict === VERDICTS.BLOCKED, e9.verdict);

  // --- 9b. An older fail does not outrank a newer pass ---------------------
  var e9b = deriveEquipmentDerived(testEquipment_({
    third_party_inspection_end_date: testDateOffset_(200)
  }), today, thresholds, settings, {}, testWaves_([
    { wave_no: 1, wave_date: testDateOffset_(-60), result: 'fail' },
    { wave_no: 2, wave_date: testDateOffset_(-10), result: 'pass' }
  ]));
  check_(results, '9b. remediated fail → cleared', e9b.verdict === VERDICTS.CLEARED, e9b.verdict);

  // --- 9c. A wave with no result cannot decide anything --------------------
  var e9c = deriveEquipmentDerived(testEquipment_({
    third_party_inspection_end_date: testDateOffset_(200)
  }), today, thresholds, settings, {}, testWaves_([
    { wave_no: 1, wave_date: testDateOffset_(-60), result: 'fail' },
    { wave_no: 2, wave_date: testDateOffset_(-1), result: '' }
  ]));
  check_(results, '9c. incomplete newest wave → older fail still blocks',
    e9c.verdict === VERDICTS.BLOCKED, e9c.verdict);

  // --- 9d. An item with no waves at all ------------------------------------
  // What every item looks like before the migration has run. The third-party
  // date alone decides, exactly as it did before waves existed.
  var e9d = deriveEquipmentDerived(testEquipment_({
    third_party_inspection_end_date: testDateOffset_(200)
  }), today, thresholds, settings, {}, {});
  check_(results, '9d. no waves → cleared', e9d.verdict === VERDICTS.CLEARED, e9d.verdict);

  // --- 10. Equipment: wave passed, inspection urgent -----------------------
  var e10 = deriveEquipmentDerived(testEquipment_({
    third_party_inspection_end_date: testDateOffset_(20)
  }), today, thresholds, settings, {}, testWaves_([
    { wave_no: 1, wave_date: testDateOffset_(-60), result: 'pass' },
    { wave_no: 2, wave_date: testDateOffset_(-10), result: 'pass' }
  ]));
  check_(results, '10. inspection in 20 days → warning', e10.verdict === VERDICTS.WARNING, e10.verdict);

  // --- 11. Equipment: archived owner ---------------------------------------
  var e11 = deriveEquipmentDerived(testEquipment_({
    third_party_inspection_end_date: testDateOffset_(200),
    team_leader_id: 'LM-EMP-0001'
  }), today, thresholds, settings, {
    'LM-EMP-0001': { employee_id: 'LM-EMP-0001', name: 'Ahmed Hassan', archived: 'TRUE' }
  });
  check_(results, '11. archived owner → warning', e11.verdict === VERDICTS.WARNING, e11.verdict);

  console.log('---');
  console.log('testDerivation: ' + results.passed + ' passed, ' + results.failed + ' failed');
  return results;
}

/** @private Logs one assertion and tallies it. */
function check_(results, label, condition, actual) {
  if (condition) {
    results.passed++;
    console.log('PASS  ' + label);
  } else {
    results.failed++;
    console.log('FAIL  ' + label + '  (got: ' + JSON.stringify(actual) + ')');
  }
}

/** @private A compliant field employee, before overrides are applied. */
function testEmployee_(overrides) {
  var far = testDateOffset_(365);
  var row = {
    employee_id: 'LM-EMP-TEST',
    name: 'Test Employee',
    team: 'field',
    employment_status: 'Active',
    legal_permission: 'Approved',
    archived: 'FALSE',
    cert_wah_practical_expiry: far,
    cert_wah_theoretical_expiry: far,
    cert_ra_expiry: far,
    cert_fa_expiry: far,
    cert_ff_expiry: far,
    cert_ec_expiry: far,
    cert_mcu_expiry: far
  };
  return testApplyOverrides_(row, overrides);
}

/** @private A compliant equipment item, before overrides are applied. */
function testEquipment_(overrides) {
  var row = {
    equipment_id: 'LM-EQP-TEST',
    item: 'Harness',
    brand: '3M',
    serial_no: 'SN-TEST',
    third_party_sn: 'TP-TEST',
    third_party_inspection_end_date: testDateOffset_(365),
    rejected: 'FALSE'
  };
  return testApplyOverrides_(row, overrides);
}

/**
 * @private
 * A {equipment_id → waves} map for the test item, as wavesByEquipmentId_ would
 * build it. Voided and rejected waves are filtered at the source there, so
 * anything passed here is live.
 *
 * A wave with no `approval_status` reads as approved (waveApprovalOf_ defaults
 * by origin, and a hand-built row has no origin either). That keeps every test
 * written before the review flow meaning what it meant — pass an explicit
 * `approval_status: 'pending'` to exercise the review.
 */
function testWaves_(waves) {
  var map = {};
  map['LM-EQP-TEST'] = waves || [];
  return map;
}

/** @private */
function testApplyOverrides_(row, overrides) {
  for (var key in (overrides || {})) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) row[key] = overrides[key];
  }
  return row;
}

/** @private 'YYYY-MM-DD' this many days from today (negative = past). */
function testDateOffset_(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}
