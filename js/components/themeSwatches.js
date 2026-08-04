/* ==========================================================================
   themeSwatches.js — the four-circle accent picker.

   Lives in the sidebar footer today; it is a component rather than part of
   sidebar.js because the officer shell gets the same picker in Stage 8, and a
   component is shared ground where a shell file is not.
   ========================================================================== */

import { THEMES, getTheme, setTheme } from '../utils/theme.js';
import { t } from '../i18n/i18n.js';

/** @returns {string} HTML */
export function renderThemeSwatches() {
  const active = getTheme();

  const swatches = THEMES.map((theme) => `
    <button
      type="button"
      class="swatch ${theme}${theme === active ? ' active' : ''}"
      data-theme-swatch="${theme}"
      title="${t('theme_' + theme)}"
      aria-label="${t('theme_' + theme)}"
      aria-pressed="${theme === active}"></button>`).join('');

  return `<div class="swatches">${swatches}</div>`;
}

/**
 * @param {ParentNode} root the container the swatches were rendered into
 */
export function bindThemeSwatches(root) {
  if (!root) return;

  root.querySelectorAll('[data-theme-swatch]').forEach((btn) => {
    btn.addEventListener('click', () => setTheme(btn.dataset.themeSwatch));
  });
}
