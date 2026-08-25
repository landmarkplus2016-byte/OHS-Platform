/* ==========================================================================
   equipment/waveDialog.js — the three dialogs that write an inspection wave.

   Record, correct, and void. They live here rather than on a page because two
   pages open them: the capped card on an item's detail page, and the fleet-wide
   review queue. A dialog defined twice is a dialog that drifts.

   Each resolves to the server's `{wave, derived}` on success, or null when the
   admin dismissed it. The `derived` block is why the callers do not have to
   refetch to repaint a verdict — the write already told them what it changed.

   ---- Why the errors are mapped here ----

   The server answers with stable codes, never sentences (Section 3.1), and
   formDialog's `setError` wants a translated string. Mapping them next to the
   form that produced them keeps each code's message beside the field it belongs
   to, which is the whole reason formDialog runs submit before it closes.
   ========================================================================== */

import { t } from '../../i18n/i18n.js';
import { escapeHtml, todayISO } from '../../utils/format.js';
import { formDialog, confirmDialog } from '../../components/modal.js';
import { WAVE_RESULTS, WAVE_RESULT_LABEL_KEYS } from './constants.js';
import {
  recordInspectionWave, updateInspectionWave, voidInspectionWave,
  approveInspectionWave, rejectInspectionWave,
} from './dataActions.js';

/** Matches the server's WAVE_COMMENTS_MAX, so the field stops before the API does. */
const COMMENTS_MAX = 500;

/**
 * The shared form body. `wave` is null when recording, or the wave being
 * corrected.
 *
 * The date is capped at today with a `max` attribute because the server refuses
 * a future wave outright — an inspection is something that happened, and a
 * mistyped year should be caught in the picker rather than as a rejected save.
 */
function waveFormHtml(wave) {
  const current = wave || {};
  const date = current.wave_date || todayISO();
  const result = current.result || '';
  const comments = current.comments || '';

  return `
    <div class="field">
      <label for="wave-date">${escapeHtml(t('eqp_wave_field_date'))}</label>
      <input id="wave-date" name="wave_date" type="date"
             value="${escapeHtml(date)}" max="${escapeHtml(todayISO())}">
    </div>

    <div class="field">
      <label for="wave-result">${escapeHtml(t('eqp_wave_field_result'))}</label>
      <select id="wave-result" name="result">
        <option value="">—</option>
        ${WAVE_RESULTS.map((value) => `
          <option value="${escapeHtml(value)}"${value === result ? ' selected' : ''}>
            ${escapeHtml(t(WAVE_RESULT_LABEL_KEYS[value]))}
          </option>`).join('')}
      </select>
    </div>

    <div class="field">
      <label for="wave-comments">${escapeHtml(t('eqp_wave_field_comments'))}</label>
      <textarea id="wave-comments" name="comments" rows="3"
                maxlength="${COMMENTS_MAX}"
                placeholder="${escapeHtml(t('eqp_wave_comments_hint'))}">${escapeHtml(comments)}</textarea>
    </div>`;
}

/** Reads the form back. Trimming here means a comment of spaces stores as blank. */
function readWaveForm(root) {
  return {
    wave_date: root.querySelector('[name="wave_date"]').value.trim(),
    result: root.querySelector('[name="result"]').value.trim(),
    comments: root.querySelector('[name="comments"]').value.trim(),
  };
}

/**
 * Client-side check, so the obvious mistakes never cost a round trip. The server
 * validates the same things regardless — this is for speed, not for safety
 * (rule 5).
 *
 * @returns {string} a translated message, or '' when the form is usable
 */
function localError(values) {
  if (!values.wave_date) return t('eqp_wave_err_date_required');
  if (values.wave_date > todayISO()) return t('eqp_wave_err_future');
  if (!values.result) return t('eqp_wave_err_result_required');
  return '';
}

/**
 * A server failure as a sentence for the dialog's error line.
 *
 * @param {ApiError} err
 * @returns {string}
 */
export function waveErrorMessage(err) {
  const code = err && err.code;
  const fields = (err && err.field_errors) || {};

  if (code === 'not_found') return t('eqp_wave_err_item_gone');
  if (code === 'conflict') return t('eqp_wave_err_voided');
  if (code === 'forbidden') return t('err_forbidden');
  if (code === 'network_error') return t('err_network_error');

  if (code === 'validation_failed') {
    if (fields.wave_date === 'future_date') return t('eqp_wave_err_future');
    if (fields.wave_date) return t('eqp_wave_err_date_required');
    if (fields.result) return t('eqp_wave_err_result_required');
    if (fields.comments === 'too_long') return t('eqp_wave_err_comments_long');
    return t('err_validation_failed');
  }

  return t('err_server_error');
}

/**
 * Record a new wave against an item.
 *
 * @param {{equipment_id: string, label?: string}} item
 * @returns {Promise<{wave: Object, derived: Object|null}|null>}
 */
export async function openRecordWaveDialog(item) {
  let saved = null;

  await formDialog({
    title: t('eqp_wave_record_title'),
    bodyHtml: `
      ${item.label ? `<p class="modal-body">${escapeHtml(item.label)}</p>` : ''}
      ${waveFormHtml(null)}`,
    confirmLabel: t('eqp_wave_record_confirm'),
    submit: async (root, setError) => {
      const values = readWaveForm(root);

      const invalid = localError(values);
      if (invalid) {
        setError(invalid);
        return false;
      }

      try {
        saved = await recordInspectionWave({
          equipment_id: item.equipment_id,
          ...values,
        });
        return true;
      } catch (err) {
        console.error('[equipment] record_inspection_wave failed:', err);
        setError(waveErrorMessage(err));
        return false;
      }
    },
  });

  return saved;
}

/**
 * Correct a wave that is already on the record.
 *
 * Sends every field rather than only the changed ones. The server treats an
 * absent key as "leave alone", so a diff would work — but the admin is looking
 * at a filled-in form and expects it to be what gets saved, and computing a diff
 * to save three short strings buys nothing.
 *
 * @param {Object} wave the wave as the list returned it
 * @returns {Promise<{wave: Object, derived: Object|null}|null>}
 */
export async function openCorrectWaveDialog(wave) {
  let saved = null;

  await formDialog({
    title: t('eqp_wave_correct_title', { wave: wave.wave_no }),
    bodyHtml: waveFormHtml(wave),
    confirmLabel: t('save'),
    submit: async (root, setError) => {
      const values = readWaveForm(root);

      const invalid = localError(values);
      if (invalid) {
        setError(invalid);
        return false;
      }

      try {
        saved = await updateInspectionWave(wave.wave_id, values);
        return true;
      } catch (err) {
        console.error('[equipment] update_inspection_wave failed:', err);
        setError(waveErrorMessage(err));
        return false;
      }
    },
  });

  return saved;
}

/**
 * Void a wave — stop it counting, without deleting it (rule 6).
 *
 * The reason is `required`, matching the server. A voided inspection with
 * nothing saying why is an inspection that disappeared from the record, which is
 * exactly what voiding-instead-of-deleting exists to prevent.
 *
 * @param {Object} wave
 * @returns {Promise<{wave: Object, derived: Object|null}|null>}
 */
export async function openVoidWaveDialog(wave) {
  const answer = await confirmDialog({
    title: t('eqp_wave_void_title', { wave: wave.wave_no }),
    message: t('eqp_wave_void_message'),
    confirmLabel: t('eqp_wave_void_confirm'),
    danger: true,
    input: {
      label: t('eqp_wave_void_reason'),
      placeholder: t('eqp_wave_void_reason_hint'),
      required: true,
    },
  });
  if (!answer) return null;

  return voidInspectionWave(wave.wave_id, answer.value);
}

/**
 * Approve an officer's wave — confirm what they found.
 *
 * The confirmation names what changes, because approving is not a formality: a
 * pending pass is doing nothing to the verdict until this runs, so this is the
 * moment an item an officer inspected actually goes back into service.
 *
 * @param {Object} wave
 * @returns {Promise<{wave: Object, derived: Object|null}|null>}
 */
export async function openApproveWaveDialog(wave) {
  const answer = await confirmDialog({
    title: t('eqp_wave_approve_title', { wave: wave.wave_no }),
    message: t(
      wave.result === 'fail' ? 'eqp_wave_approve_fail_message' : 'eqp_wave_approve_pass_message'
    ),
    confirmLabel: t('eqp_wave_approve_confirm'),
  });
  if (!answer) return null;

  return approveInspectionWave(wave.wave_id);
}

/**
 * Reject an officer's wave — do not accept the finding.
 *
 * The reason is required for the same reason it is on void: a finding that
 * stopped counting with nothing saying why is a finding that disappeared. The
 * row stays on the record either way.
 *
 * @param {Object} wave
 * @returns {Promise<{wave: Object, derived: Object|null}|null>}
 */
export async function openRejectWaveDialog(wave) {
  const answer = await confirmDialog({
    title: t('eqp_wave_reject_title', { wave: wave.wave_no }),
    message: t('eqp_wave_reject_message'),
    confirmLabel: t('eqp_wave_reject_confirm'),
    danger: true,
    input: {
      label: t('eqp_wave_reject_reason'),
      placeholder: t('eqp_wave_reject_reason_hint'),
      required: true,
    },
  });
  if (!answer) return null;

  return rejectInspectionWave(wave.wave_id, answer.value);
}
