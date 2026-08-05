/* ==========================================================================
   officer/pages/officerSyncPage.js — route '#/check/sync' (Section 7.5).

   Reachable from the sync strip and from the lockout screen. One job, one
   button: pull a fresh snapshot onto the phone.

   This route is exempt from the staleness guard — it has to be, since it is the
   only way out of a lockout (Section 7.4).
   ========================================================================== */

import { t } from '../../../i18n/i18n.js';
import { escapeHtml, fmtDateTime } from '../../../utils/format.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { toast, toastSuccess } from '../../../components/toast.js';
import { officerSync } from '../dataActions.js';
import { getStaleState, staleAgeDays } from '../staleCheck.js';

/** "12 Aug 2026 · 3d ago", or "Never" on a phone that has not synced. */
function lastSyncedLine() {
  const state = getStaleState();
  if (!state.synced_at) return t('off_never_synced');

  const days = staleAgeDays();
  const age = days === null ? '' : (days === 0 ? t('off_age_today') : t('off_age_days', { days }));

  return fmtDateTime(state.synced_at) + (age ? ' · ' + age : '');
}

export function renderOfficerSyncPage() {
  return `
    <div class="officer-body officer-sync-page">
      <h2>${escapeHtml(t('off_sync_title'))}</h2>
      <p class="officer-intro">${escapeHtml(t('off_sync_intro'))}</p>

      <div class="officer-panel">
        <div class="sync-fact">
          <span class="lab">${escapeHtml(t('off_last_synced'))}</span>
          <span class="val">${escapeHtml(lastSyncedLine())}</span>
        </div>
      </div>

      <button type="button" class="btn btn-primary btn-lg btn-block"
              data-action="run-sync">↻ ${escapeHtml(t('off_sync_now'))}</button>
    </div>`;
}

export function bindOfficerSyncPageEvents() {
  const btn = document.querySelector('[data-action="run-sync"]');
  if (!btn) return;

  let busy = false;

  btn.addEventListener('click', async () => {
    if (busy) return;

    busy = true;
    btn.disabled = true;
    btn.textContent = t('off_syncing');

    try {
      await officerSync();
      toastSuccess(t('off_synced_ok'));
      go('check/home');
    } catch (err) {
      busy = false;
      btn.disabled = false;
      btn.textContent = '↻ ' + t('off_sync_now');

      // The old snapshot is untouched by a failed sync (see dataActions), so an
      // officer who was working stays working — they just did not get newer
      // data. An officer who was locked out stays locked out.
      if (err && err.code !== 'unauthenticated') {
        toast(t(err.code === 'network_error' ? 'off_locked_offline' : 'off_sync_failed'), 'error');
      }
      console.error('[officer] sync failed:', err);
      render();
    }
  });
}
