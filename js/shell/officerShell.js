/* ==========================================================================
   officerShell.js — the phone frame every officer page is drawn inside
   (Sections 7.1, 8.6).

   Three parts, top to bottom:

     .phone         the frame. Full-width on a phone, a centred 420px column on
                    a desktop, so the same URL is usable from both.
     .officer-hbar  navy header: app name, who is signed in, language, sign out.
     .sync-strip    "Data as of …" plus a Sync button, and an amber banner when
                    the cache is getting close to its limit.

   The sync strip is skipped on two screens, per the brief:

     the sign-in card   there is no session and no cache to describe yet
     the lockout        it would offer a second, quieter route to the same sync
                        the screen is already asking for, next to a message
                        saying nothing else works

   The verdict pages keep the strip: an officer reading a card should be able to
   see how old the data behind it is without navigating away from it.
   ========================================================================== */

import { CURRENT_USER, CONFIG } from '../state.js';
import { t, setLanguage, getLanguage } from '../i18n/i18n.js';
import { escapeHtml, fmtDateTime } from '../utils/format.js';
import { go } from '../router.js';
import { confirmDialog } from '../components/modal.js';
import { officerLogout } from '../modules/officer/dataActions.js';
import { getStaleState, staleAgeDays, isNearlyStale } from '../modules/officer/staleCheck.js';

/** Routes that draw without the sync strip. */
const NO_STRIP_ROUTES = new Set(['check', 'check/locked']);

/** Routes that draw without the header — the sign-in card owns its full screen. */
const NO_HEADER_ROUTES = new Set(['check']);

/* ---------- Pieces -------------------------------------------------------- */

function renderHeader() {
  const appName = escapeHtml((CONFIG && CONFIG.app_name) || t('app_name'));
  const who = escapeHtml((CURRENT_USER && CURRENT_USER.display_name) || '');
  const lang = getLanguage();

  return `
    <div class="officer-hbar">
      <div class="brand">
        <div class="mark">LMP</div>
        <div>
          <div class="name">${appName}</div>
          <div class="sub">${who}</div>
        </div>
      </div>
      <div class="hbar-actions">
        <button type="button" class="hbar-btn" data-action="officer-lang">
          ${escapeHtml(lang === 'en' ? t('lang_ar') : t('lang_en'))}
        </button>
        <button type="button" class="hbar-btn" data-action="officer-signout"
                aria-label="${escapeHtml(t('sign_out'))}">⏻</button>
      </div>
    </div>`;
}

/**
 * "Data as of 4 Aug 2026 · 2d ago" and a Sync button, plus an amber warning in
 * the last fifth of the freshness window.
 *
 * The age is shown in days rather than hours because that is the unit the
 * officer plans in — "sync before the weekend", not "sync in 14 hours".
 */
function renderSyncStrip() {
  const state = getStaleState();
  const days = staleAgeDays();

  const asOf = state.synced_at
    ? `${escapeHtml(t('off_as_of'))} <b>${escapeHtml(fmtDateTime(state.synced_at))}</b>`
      + (days === null ? '' : ` · ${escapeHtml(days === 0 ? t('off_age_today') : t('off_age_days', { days }))}`)
    : `${escapeHtml(t('off_last_synced'))} <b>${escapeHtml(t('off_never_synced'))}</b>`;

  return `
    <div class="sync-strip">
      <div class="as-of">${asOf}</div>
      <button type="button" data-action="officer-open-sync">↻ ${escapeHtml(t('off_sync'))}</button>
    </div>
    ${isNearlyStale() && days !== null
      ? `<div class="stale-banner">⚠ ${escapeHtml(t('off_stale_warn', { days }))}</div>`
      : ''}`;
}

/* ---------- Shell --------------------------------------------------------- */

/**
 * Wrap a page body in the officer shell.
 *
 * @param {string} pageBody HTML from the route's page function
 * @param {string} route the current ROUTE, which decides what the shell shows
 * @returns {string} HTML
 */
export function renderOfficerShell(pageBody, route) {
  const showHeader = !NO_HEADER_ROUTES.has(route);
  const showStrip = !NO_STRIP_ROUTES.has(route);

  return `
    <div class="phone">
      ${showHeader ? renderHeader() : ''}
      ${showStrip ? renderSyncStrip() : ''}
      ${pageBody}
    </div>`;
}

/**
 * Wire the shell's own controls. Called after the shell is in the DOM and
 * before the page's own bind, the same order the admin shell uses.
 */
export function bindOfficerShellEvents() {
  const root = document.querySelector('.phone');
  if (!root) return;

  const langBtn = root.querySelector('[data-action="officer-lang"]');
  if (langBtn) {
    langBtn.addEventListener('click', () => {
      setLanguage(getLanguage() === 'en' ? 'ar' : 'en');
    });
  }

  const syncBtn = root.querySelector('[data-action="officer-open-sync"]');
  if (syncBtn) {
    syncBtn.addEventListener('click', () => go('check/sync'));
  }

  const signOutBtn = root.querySelector('[data-action="officer-signout"]');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
      // Section 7.7: signing out wipes the session, the cached snapshot and the
      // Recent list. Deliberately harsher than an involuntary logout, which
      // leaves the cache alone — this is the "handing the shared phone over"
      // action, and nothing of this officer may survive it.
      //
      // The one thing that survives is a wave the officer recorded and could
      // not send. officerLogout tries to flush first and asks before discarding
      // anything left — an inspection somebody performed is not collateral for
      // handing a phone over.
      signOutBtn.disabled = true;
      officerLogout({
        confirmDiscard: async (count) => {
          const answer = await confirmDialog({
            title: t('off_signout_pending_title'),
            message: t('off_signout_pending_message', { count }),
            confirmLabel: t('off_signout_discard'),
            danger: true,
          });
          return answer !== null;
        },
      })
        .then((signedOut) => {
          if (!signedOut) signOutBtn.disabled = false;
        })
        .catch((err) => {
          signOutBtn.disabled = false;
          console.error('[officer] sign-out failed:', err);
        });
    });
  }
}
