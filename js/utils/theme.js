/* ==========================================================================
   theme.js — the four accent themes (Section 8.3).

   Switching a theme swaps --primary / --primary-dark / --primary-soft via the
   [data-theme] attribute on <html>. Every rule is already in tokens.css, so
   nothing here touches a color value — this file only decides which attribute
   is set.

   The navy sidebar and header never change with the theme. Only buttons, active
   nav borders, badges and chart accents follow it.

   The preference is per-device, like the language, and lives in
   localStorage.ohsp_theme.
   ========================================================================== */

import { render } from '../render.js';

/** The four themes, in the order the swatch picker shows them. */
export const THEMES = ['blue', 'teal', 'purple', 'crimson'];

const STORAGE_KEY = 'ohsp_theme';
const DEFAULT_THEME = 'blue';

let currentTheme = localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
if (!THEMES.includes(currentTheme)) currentTheme = DEFAULT_THEME;

// Applied on module load, before anything renders, so the first paint is
// already in the user's accent rather than flashing the default first.
applyDocumentTheme(currentTheme);

function applyDocumentTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

/** @returns {string} one of THEMES */
export function getTheme() {
  return currentTheme;
}

/**
 * Switch accent theme: persist to the device, flip the attribute, redraw.
 * The redraw is only needed so the active swatch moves — the colors themselves
 * change the moment the attribute does.
 *
 * @param {string} theme one of THEMES
 */
export function setTheme(theme) {
  if (!THEMES.includes(theme) || theme === currentTheme) return;

  currentTheme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
  applyDocumentTheme(theme);
  render();
}
