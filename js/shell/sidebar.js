/* ==========================================================================
   sidebar.js — the admin navigation, composed from module manifests
   (Sections 5.4 and 8.5).

   The shell owns three things in this list — Dashboard at the top, and Export
   and Settings in the SYSTEM group at the bottom. Everything between them comes
   from whatever modules registered themselves at boot. Adding the vehicles
   module later puts a VEHICLES group between EQUIPMENT and SYSTEM without a
   line changing in this file.

   Every item is filtered against the current user's permissions, and a group
   with nothing visible in it is dropped entirely — no empty headers.

   Filtering here is for UX only. The Apps Script is the security gate (rule 5).
   ========================================================================== */

import { CURRENT_USER, ROUTE, clearSession } from '../state.js';
import { api } from '../api.js';
import { go, hrefFor } from '../router.js';
import { t, getLanguage, setLanguage } from '../i18n/i18n.js';
import { canView, isSuperAdmin, hasAnyViewPermission } from '../utils/permissions.js';
import { escapeHtml, initials } from '../utils/format.js';
import { renderThemeSwatches, bindThemeSwatches } from '../components/themeSwatches.js';

/**
 * The shell's own SYSTEM group. Settings carries the same super-admin flag the
 * router holds for the route, so hiding it here and blocking it there stay in
 * step (Section 8.5).
 */
const SYSTEM_ITEMS = [
  { labelKey: 'nav_export',   route: 'export',   icon: '↓' },
  { labelKey: 'nav_settings', route: 'settings', icon: '⚙', superAdminOnly: true },
];

/** The shell's own first item, above every module group. */
const DASHBOARD_ITEM = { labelKey: 'nav_dashboard', route: 'dashboard', icon: '◇' };

/**
 * The modules that contribute nav items to this user, in manifest order.
 *
 * A module needs a group, at least one sidebar item, and view permission. Split
 * out because the mobile bottom bar asks the same question (visibleNavItems),
 * and two copies of this predicate would drift the first time it changed.
 *
 * @param {Array<Object>} modules
 * @returns {Array<Object>}
 */
function visibleModules(modules) {
  if (!hasAnyViewPermission()) return [];

  return (modules || []).filter((manifest) => (
    manifest.group && manifest.sidebar && manifest.sidebar.length > 0 && canView(manifest.name)
  ));
}

/** The SYSTEM items this user may see. */
function visibleSystemItems() {
  return SYSTEM_ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin());
}

/**
 * Every destination this user may reach, flattened into sidebar order:
 * Dashboard, then each module group's items, then SYSTEM.
 *
 * Exported for mobileNav.js, which shows exactly these destinations in exactly
 * this order — the bottom bar is the same navigation in a different shape, not a
 * second, hand-maintained list of pages.
 *
 * @param {Array<Object>} modules registered manifests
 * @returns {Array<Object>} {labelKey, route, icon}
 */
export function visibleNavItems(modules) {
  const items = [DASHBOARD_ITEM];

  visibleModules(modules).forEach((manifest) => {
    items.push(...manifest.sidebar);
  });

  return items.concat(visibleSystemItems());
}

/**
 * One nav link.
 *
 * @param {Object} item {labelKey, route, icon}
 * @param {string} activeRoute
 * @returns {string} HTML
 */
function navItem(item, activeRoute) {
  const isActive = item.route === activeRoute;
  const icon = item.icon ? `<span class="ic">${escapeHtml(item.icon)}</span>` : '';

  return `
    <a href="${hrefFor(item.route)}"
       class="nav-link${isActive ? ' active' : ''}"
       ${isActive ? 'aria-current="page"' : ''}>${icon}<span>${escapeHtml(t(item.labelKey))}</span></a>`;
}

/**
 * One group: an uppercase header and its visible items, or '' when nothing in
 * it is visible.
 *
 * @param {string} labelKey i18n key for the header
 * @param {Array<Object>} items
 * @param {string} activeRoute
 * @returns {string} HTML
 */
function navGroup(labelKey, items, activeRoute) {
  if (items.length === 0) return '';

  return `
    <div class="nav-group">
      <div class="nav-group-label">${escapeHtml(t(labelKey))}</div>
      ${items.map((item) => navItem(item, activeRoute)).join('')}
    </div>`;
}

/**
 * The module-contributed groups, in manifest order. Two modules declaring the
 * same `group` share one header, which is what makes a group a grouping rather
 * than a per-module heading.
 *
 * @param {Array<Object>} modules
 * @param {string} activeRoute
 * @returns {string} HTML
 */
function moduleGroups(modules, activeRoute) {
  // Insertion order is manifest order, which is the order main.js listed them.
  const groups = new Map();

  visibleModules(modules).forEach((manifest) => {
    if (!groups.has(manifest.group)) groups.set(manifest.group, []);
    groups.get(manifest.group).push(...manifest.sidebar);
  });

  let html = '';
  groups.forEach((items, group) => {
    html += navGroup('group_' + group.toLowerCase(), items, activeRoute);
  });

  return html;
}

/**
 * @param {Array<Object>} modules registered manifests
 * @returns {string} HTML
 */
export function renderSidebar(modules) {
  const user = CURRENT_USER || {};
  const lang = getLanguage();
  const activeRoute = ROUTE;

  // A module admin with nothing granted yet gets Dashboard and SYSTEM only.
  const groupsHtml = moduleGroups(modules, activeRoute);

  const systemItems = visibleSystemItems();

  return `
    <aside class="sidebar">
      <div class="side-logo">
        <img class="logo-img" src="LMP%20Logo%20White.png" alt="${escapeHtml(t('company_name'))}">
        <div class="name">${escapeHtml(t('app_name'))}</div>
        <div class="sub">${escapeHtml(t('app_sub'))}</div>
      </div>

      <nav class="nav">
        ${navItem(DASHBOARD_ITEM, activeRoute)}
        ${groupsHtml}
        ${navGroup('group_system', systemItems, activeRoute)}
      </nav>

      <div class="side-bottom">
        ${renderThemeSwatches()}

        <div class="lang-toggle">
          <button type="button" class="${lang === 'en' ? 'active' : ''}" data-lang="en">${escapeHtml(t('lang_en'))}</button>
          <button type="button" class="${lang === 'ar' ? 'active' : ''}" data-lang="ar">${escapeHtml(t('lang_ar'))}</button>
        </div>

        <div class="userchip">
          <div class="avatar">${escapeHtml(initials(user.display_name))}</div>
          <div>
            <div class="who">${escapeHtml(user.display_name || '')}</div>
            <div class="role">${escapeHtml(user.role ? t('role_' + user.role) : '')}</div>
          </div>
        </div>

        <button type="button" class="side-signout" data-action="signout">${escapeHtml(t('sign_out'))}</button>
      </div>
    </aside>`;
}

/**
 * Explicit sign-out (Section 4.4): tell the server to drop the session row,
 * then clear it locally and land on the login screen.
 *
 * The local clear happens whether or not the call succeeds. A failed `logout`
 * means the session is already gone server-side or the device is offline —
 * neither is a reason to keep the user signed in on this machine.
 *
 * Lives here because the sidebar owns the admin shell's sign-out control. The
 * change-password screen imports it: that screen draws without a sidebar, but
 * it needs the identical escape hatch for a user who cannot recall their
 * current password.
 */
export async function signOut() {
  try {
    await api.call('logout');
  } catch (err) {
    console.warn('[sidebar] logout call failed, clearing locally:', err);
  }

  clearSession();
  go('login'); // CURRENT_USER is null now, so render() draws the login screen
}

export function bindSidebarEvents() {
  const root = document.querySelector('.sidebar');
  if (!root) return;

  // Nav links are real hrefs — the browser navigates and fires hashchange, so
  // middle-click and "open in new tab" behave. Nothing to bind for them.

  bindThemeSwatches(root);

  root.querySelectorAll('[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
  });

  root.querySelector('[data-action="signout"]').addEventListener('click', signOut);
}
