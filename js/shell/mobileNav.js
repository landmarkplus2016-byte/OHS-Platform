/* ==========================================================================
   mobileNav.js — the admin shell's bottom navigation ribbon, drawn on narrow
   screens instead of the sidebar.

   Admins work on desktop (Section 1) and that has not changed: this is the same
   navigation, in the shape a phone can use. The sidebar is a 230px column that
   on a phone became a full-height wall of links the user had to scroll past
   before reaching the page they asked for. Here the page is the whole screen and
   the destinations sit in a fixed strip along the bottom, one tap away.

   It owns no list of pages. `visibleNavItems` in sidebar.js is the single source
   of both navs, permission filtering included, so a module that adds a page gets
   it in both places or neither.

   The strip cannot hold the sidebar footer as well — theme, language, who is
   signed in, and sign out — so those live behind a trailing "More" button that
   opens them as a sheet. It is painted navy like the strip above it, which is
   what lets .userchip, .lang-toggle and .side-signout be reused exactly as the
   sidebar renders them.
   ========================================================================== */

import { CURRENT_USER, ROUTE } from '../state.js';
import { hrefFor } from '../router.js';
import { t, getLanguage, setLanguage } from '../i18n/i18n.js';
import { escapeHtml, initials } from '../utils/format.js';
import { renderThemeSwatches, bindThemeSwatches } from '../components/themeSwatches.js';
import { visibleNavItems, signOut } from './sidebar.js';

/**
 * The route the active tab was last scrolled into view for.
 *
 * Every draw re-runs the bind, and a live-filter page redraws on each keystroke
 * (render.js). Re-centring the strip that often would make it twitch under the
 * user's thumb while they type, so the scroll happens once per navigation.
 */
let scrolledRoute = null;

/**
 * One tab: icon above a label, the whole thing a real href so middle-click and
 * "open in new tab" behave exactly as they do in the sidebar.
 *
 * @param {Object} item {labelKey, route, icon}
 * @param {string} activeRoute
 * @returns {string} HTML
 */
function tab(item, activeRoute) {
  const isActive = item.route === activeRoute;

  return `
    <a href="${hrefFor(item.route)}"
       class="mnav-link${isActive ? ' active' : ''}"
       ${isActive ? 'aria-current="page"' : ''}>
      <span class="ic">${escapeHtml(item.icon || '')}</span>
      <span class="lbl">${escapeHtml(t(item.labelKey))}</span>
    </a>`;
}

/**
 * The sheet behind "More": everything the sidebar keeps in its footer.
 *
 * Rendered closed on every draw, and a navigation redraws the shell, so tapping
 * a tab from inside the sheet closes it without a line of code.
 *
 * @returns {string} HTML
 */
function moreSheet() {
  const user = CURRENT_USER || {};
  const lang = getLanguage();

  return `
    <div class="mnav-sheet" hidden>
      <div class="mnav-sheet-panel" role="dialog" aria-modal="true"
           aria-label="${escapeHtml(t('nav_more'))}">
        <button type="button" class="mnav-sheet-close" data-action="close-more"
                aria-label="${escapeHtml(t('close'))}">✕</button>

        <div class="userchip">
          <div class="avatar">${escapeHtml(initials(user.display_name))}</div>
          <div>
            <div class="who">${escapeHtml(user.display_name || '')}</div>
            <div class="role">${escapeHtml(user.role ? t('role_' + user.role) : '')}</div>
          </div>
        </div>

        ${renderThemeSwatches()}

        <div class="lang-toggle">
          <button type="button" class="${lang === 'en' ? 'active' : ''}" data-lang="en">${escapeHtml(t('lang_en'))}</button>
          <button type="button" class="${lang === 'ar' ? 'active' : ''}" data-lang="ar">${escapeHtml(t('lang_ar'))}</button>
        </div>

        <button type="button" class="side-signout" data-action="signout">${escapeHtml(t('sign_out'))}</button>
      </div>
    </div>`;
}

/**
 * @param {Array<Object>} modules registered manifests
 * @returns {string} HTML
 */
export function renderMobileNav(modules) {
  const items = visibleNavItems(modules);

  return `
    <div class="mobile-nav">
      ${moreSheet()}
      <nav class="mnav-scroll" aria-label="${escapeHtml(t('nav_menu'))}">
        ${items.map((item) => tab(item, ROUTE)).join('')}
        <button type="button" class="mnav-link" data-action="open-more"
                aria-haspopup="dialog">
          <span class="ic">☰</span>
          <span class="lbl">${escapeHtml(t('nav_more'))}</span>
        </button>
      </nav>
    </div>`;
}

/**
 * Bring the active tab into view when the route has changed.
 *
 * `block: 'nearest'` keeps this a horizontal scroll only — the strip is fixed to
 * the bottom of the viewport, so there is never a vertical adjustment worth
 * making, and asking for one would yank the page the user is reading.
 */
function scrollActiveIntoView(root) {
  if (scrolledRoute === ROUTE) return;
  scrolledRoute = ROUTE;

  const active = root.querySelector('.mnav-link.active');
  if (active && typeof active.scrollIntoView === 'function') {
    active.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}

export function bindMobileNavEvents() {
  const root = document.querySelector('.mobile-nav');
  if (!root) return;

  const sheet = root.querySelector('.mnav-sheet');

  function setSheetOpen(open) {
    if (open) sheet.removeAttribute('hidden');
    else sheet.setAttribute('hidden', '');
  }

  root.querySelector('[data-action="open-more"]').addEventListener('click', () => setSheetOpen(true));
  root.querySelector('[data-action="close-more"]').addEventListener('click', () => setSheetOpen(false));

  // A tap on the dimmed area outside the panel closes it, the way every sheet
  // on a phone does. The panel itself stops the event from reaching here.
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) setSheetOpen(false);
  });

  bindThemeSwatches(sheet);

  sheet.querySelectorAll('[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
  });

  sheet.querySelector('[data-action="signout"]').addEventListener('click', signOut);

  scrollActiveIntoView(root);
}
