/* ==========================================================================
   officer/waveSheet.js — the form an officer fills in at a tower.

   The admin has its own wave dialog in the equipment module. This is not that
   one reused, and the duplication is deliberate on two counts:

     Rule 12 forbids the officer module importing from js/modules/equipment/,
     and the admin dialog belongs to that module.

     They are not the same form. The admin's is a desk form with a date picker
     defaulting to today and a free choice of date. This one is thumb-sized:
     large Pass / Fail targets, the date already filled in, and a comment box
     that is optional but is the whole reason the field officer is the right
     person to be recording this.

   What it shares is the shape of the answer, and that is enforced by the server
   validating both the same way, not by a shared function.
   ========================================================================== */

import { t } from '../../i18n/i18n.js';
import { escapeHtml, todayISO } from '../../utils/format.js';
import { formDialog } from '../../components/modal.js';
import { officerRecordWave } from './dataActions.js';

/** Matches the server's WAVE_COMMENTS_MAX. */
const COMMENTS_MAX = 500;

/**
 * A server failure as a sentence.
 *
 * `not_found` is the one worth naming separately: it means the item has been
 * rejected or removed since this officer last synced, and the answer is to
 * re-sync rather than to try again.
 */
function errorMessage(err) {
  const code = err && err.code;
  const fields = (err && err.field_errors) || {};

  if (code === 'not_found') return t('off_wave_err_item_gone');
  if (code === 'forbidden') return t('err_forbidden');
  if (code === 'rate_limited') return t('err_rate_limited');

  if (code === 'validation_failed') {
    if (fields.wave_date === 'future_date') return t('off_wave_err_future');
    if (fields.wave_date) return t('off_wave_err_date');
    if (fields.result) return t('off_wave_err_result');
    if (fields.comments === 'too_long') return t('off_wave_err_comments_long');
    return t('err_validation_failed');
  }

  return t('err_server_error');
}

/**
 * Open the record sheet for one item.
 *
 * @param {{equipment_id: string, label: string}} item
 * @returns {Promise<{queued: boolean, wave: Object|null}|null>} null if dismissed
 */
export async function openOfficerWaveSheet(item) {
  let outcome = null;

  await formDialog({
    title: t('off_wave_record_title'),
    confirmLabel: t('off_wave_submit'),
    bodyHtml: `
      <p class="modal-body">${escapeHtml(item.label || item.equipment_id)}</p>

      <div class="field">
        <label for="ow-date">${escapeHtml(t('off_wave_field_date'))}</label>
        <input id="ow-date" name="wave_date" type="date"
               value="${escapeHtml(todayISO())}" max="${escapeHtml(todayISO())}">
      </div>

      <div class="field">
        <label>${escapeHtml(t('off_wave_field_result'))}</label>
        <div class="officer-choice-row">
          <label class="officer-choice officer-choice-pass">
            <input type="radio" name="result" value="pass">
            <span>${escapeHtml(t('eqp_wave_pass'))}</span>
          </label>
          <label class="officer-choice officer-choice-fail">
            <input type="radio" name="result" value="fail">
            <span>${escapeHtml(t('eqp_wave_fail'))}</span>
          </label>
        </div>
      </div>

      <div class="field">
        <label for="ow-comments">${escapeHtml(t('off_wave_field_comments'))}</label>
        <textarea id="ow-comments" name="comments" rows="3" maxlength="${COMMENTS_MAX}"
                  placeholder="${escapeHtml(t('off_wave_comments_hint'))}"></textarea>
      </div>

      <p class="modal-body cell-sub">${escapeHtml(t('off_wave_verdict_note'))}</p>`,

    submit: async (root, setError) => {
      const checked = root.querySelector('[name="result"]:checked');
      const values = {
        equipment_id: item.equipment_id,
        wave_date: root.querySelector('[name="wave_date"]').value.trim(),
        result: checked ? checked.value : '',
        comments: root.querySelector('[name="comments"]').value.trim(),
      };

      // Checked here so an officer with no signal is not told to try again by a
      // queue that would have accepted a wave with no result in it.
      if (!values.wave_date) {
        setError(t('off_wave_err_date'));
        return false;
      }
      if (values.wave_date > todayISO()) {
        setError(t('off_wave_err_future'));
        return false;
      }
      if (!values.result) {
        setError(t('off_wave_err_result'));
        return false;
      }

      try {
        outcome = await officerRecordWave(values);
        return true;
      } catch (err) {
        console.error('[officer] record wave failed:', err);
        setError(errorMessage(err));
        return false;
      }
    },
  });

  return outcome;
}
