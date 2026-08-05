/* ==========================================================================
   officer/pages/officerLockedPage.js — the fail-closed lockout (Section 7.4,
   rule 18).

   Route '#/check/locked'. Every officer route except the sign-in card and the
   sync page redirects here while the cached snapshot is older than
   `max_stale_hours`.

   One action, and it is the honest one: sync. No override, no supervisor
   bypass, no "continue anyway" hidden behind a long press. An officer who hits
   this in the field leaves the site or calls a colleague — that is the field
   procedure, and a screen that offered a way past it would quietly become the
   procedure instead.

   Two wordings, because two situations bring an officer here and they need
   different things said to them:

     never synced   a new phone. Nothing is wrong; sync once and it works.
     stale          the data expired. Something needs doing before any check.
   ========================================================================== */

import { t } from '../../../i18n/i18n.js';
import { escapeHtml } from '../../../utils/format.js';
import { go } from '../../../router.js';
import { toast } from '../../../components/toast.js';
import { officerSync } from '../dataActions.js';
import { getStaleState, hasNeverSynced } from '../staleCheck.js';

export function renderOfficerLockedPage() {
  const state = getStaleState();
  const neverSynced = hasNeverSynced();

  const title = neverSynced ? t('off_locked_never_title') : t('off_locked_title');
  const body = neverSynced
    ? t('off_locked_never_body')
    : t('off_locked_body', { hours: state.max_stale_hours });

  return `
    <div class="officer-lock">
      <div class="lock-icon" aria-hidden="true">${neverSynced ? '↻' : '🔒'}</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>

      <button type="button" class="btn btn-primary btn-lg btn-block"
              data-action="lock-sync">↻ ${escapeHtml(t('off_sync_now'))}</button>
    </div>`;
}

export function bindOfficerLockedPageEvents() {
  const btn = document.querySelector('[data-action="lock-sync"]');
  if (!btn) return;

  let busy = false;

  btn.addEventListener('click', async () => {
    if (busy) return;

    busy = true;
    btn.disabled = true;
    btn.textContent = t('off_syncing');

    try {
      await officerSync();
      // officerSync has already recomputed the staleness state, so the guard
      // will let this navigation through.
      go('check/home');
    } catch (err) {
      busy = false;
      btn.disabled = false;
      btn.textContent = '↻ ' + t('off_sync_now');

      // Still locked. That is the correct outcome of a failed sync here — the
      // officer stays on this screen until a sync actually succeeds.
      if (err && err.code !== 'unauthenticated') {
        toast(t(err.code === 'network_error' ? 'off_locked_offline' : 'off_sync_failed'), 'error');
      }
      console.error('[officer] sync from lockout failed:', err);
    }
  });
}
