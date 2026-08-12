/* ==========================================================================
   officer/pages/verdictPage.js — the machinery both verdict pages are built
   from (Section 7.5).

   The employee card and the equipment card differ in three things: the entity
   kind in the URL, which action refreshes them, and which module draws them.
   Everything else — read from cache, draw, wire Back, wire Refresh, deal with
   a refresh that fails — is the same page twice.

   So it is written once. makeVerdictPage() returns the {render, bind} pair a
   route needs, and the two page files are the thin wrappers that name them.

   ---- Cache first, always ----

   Rule 17: the card draws from the cached snapshot with no server call. The
   officer taps a result and the verdict is on screen immediately, signal or no
   signal. Refresh is the only thing here that touches the network, and it is
   never automatic — it is a button the officer presses when they want
   confirmation (Section 7.5).
   ========================================================================== */

import { t } from '../../../i18n/i18n.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { toast, toastSuccess } from '../../../components/toast.js';
import { getCachedSnapshot } from '../cache.js';
import { loadOfficerSnapshot, loadOfficerOutbox } from '../dataActions.js';
import { pendingCount } from '../outbox.js';
import { renderVerdictCardFor } from '../search.js';
import { openOfficerWaveSheet } from '../waveSheet.js';

/**
 * Build the render/bind pair for one entity kind.
 *
 * @param {Object} options
 * @param {string} options.kind 'employee' | 'equipment' — matches the module's
 *        manifest.officer.entityKind and the middle segment of the route
 * @param {function(string): Promise<Object>} options.fetchEntity the module's
 *        live single-entity action, used only by the Refresh button
 * @returns {{render: function(Object): string, bind: function(Object): void}}
 */
export function makeVerdictPage(options) {
  const { kind, fetchEntity } = options;

  function renderPage(params) {
    const entityId = (params && params.id) || '';
    const snapshot = getCachedSnapshot();

    // Nothing read from IndexedDB yet — bind() is about to fix that, and this
    // draw is the one frame in between.
    if (!snapshot) {
      return `<div class="officer-body"><div class="officer-empty">${t('loading')}</div></div>`;
    }

    const card = renderVerdictCardFor(kind, entityId, snapshot);
    if (card === null) {
      console.error('[officer] no module owns entity kind "' + kind + '"');
      return `<div class="officer-body"><div class="officer-empty">${t('err_server_error')}</div></div>`;
    }

    return card;
  }

  function bindPage(params) {
    const entityId = (params && params.id) || '';

    // Back returns to the search rather than to browser history: the officer
    // may have arrived here from the Recent list, from a search, or from a
    // reloaded URL, and "back" means the same thing in all three.
    document.querySelectorAll('[data-action="officer-back"]').forEach((btn) => {
      btn.addEventListener('click', () => go('check/home'));
    });

    const refreshBtn = document.querySelector('[data-action="officer-refresh"]');
    if (refreshBtn) {
      // Scoped to this bind, which runs once per draw — a second press while
      // the first is in flight is ignored without any state living past it.
      let busy = false;

      refreshBtn.addEventListener('click', async () => {
        if (busy) return;

        busy = true;
        refreshBtn.disabled = true;
        refreshBtn.textContent = '⋯';

        try {
          await fetchEntity(entityId);
          render(); // redraws the card from the freshly-updated cache
          toastSuccess(t('off_refreshed'));
        } catch (err) {
          busy = false;
          refreshBtn.disabled = false;
          refreshBtn.textContent = '↻';

          // `not_found` is not a failure to reach the server — it is the server
          // saying this employee has been archived, or this item rejected. The
          // officer keeps seeing their cached card (it is all they have) but
          // needs to know it is out of date.
          if (err && err.code === 'not_found') {
            toast(t('off_refresh_gone'), 'error');
          } else if (err && err.code !== 'unauthenticated') {
            // `unauthenticated` is already handled by api.js, which has cleared
            // the session and routed to the sign-in card by now.
            toast(t('off_refresh_failed'), 'error');
          }
          console.error('[officer] refresh failed for ' + kind + ' ' + entityId + ':', err);
        }
      });
    }

    // Recording a wave. The button is drawn by the module's card — this page
    // does not know what an inspection wave is, only that a card can ask for one
    // to be recorded against the entity it is showing.
    //
    // Reaching this at all means the cache is fresh: the stale lockout redirects
    // every route but sync (staleCheck.js, rule 18), and this is one of them.
    // That is the intent, not a side effect — an officer working from a snapshot
    // too old to read a verdict from is also too old to be identifying the item
    // in their hands.
    const recordBtn = document.querySelector('[data-action="officer-record-wave"]');
    if (recordBtn) {
      let recording = false;

      recordBtn.addEventListener('click', async () => {
        if (recording) return;
        recording = true;

        try {
          const outcome = await openOfficerWaveSheet({
            equipment_id: recordBtn.dataset.equipmentId || entityId,
            label: recordBtn.dataset.label || '',
          });
          if (!outcome) return;

          // Queued rather than sent: there was no signal. Say so plainly — the
          // officer needs to know the wave is on the phone and not yet on the
          // record, so they do not walk away assuming it landed.
          if (outcome.queued) toast(t('off_wave_queued'), 'warn');
          else toastSuccess(t('off_wave_saved'));

          await loadOfficerOutbox();
          render();
        } catch (err) {
          console.error('[officer] wave sheet failed for ' + entityId + ':', err);
        } finally {
          recording = false;
        }
      });
    }

    if (!getCachedSnapshot()) {
      loadOfficerSnapshot()
        .then((snapshot) => {
          if (snapshot) render();
        })
        .catch((err) => console.error('[officer] cannot read the cached snapshot:', err));
    }

    // The pending list is drawn into the card, so it has to be in memory before
    // the draw that shows it.
    //
    // Redrawing only on a *change* is what stops this looping: render() re-runs
    // bind(), so a redraw that fires whenever the queue is non-empty would never
    // settle on a card with a wave waiting.
    const drawnWith = pendingCount();
    loadOfficerOutbox()
      .then(() => {
        if (pendingCount() !== drawnWith) render();
      })
      .catch((err) => console.error('[officer] cannot read the outbox:', err));
  }

  return { render: renderPage, bind: bindPage };
}
