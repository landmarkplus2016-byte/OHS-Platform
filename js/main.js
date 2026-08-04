/* ==========================================================================
   main.js — the boot sequence. Nothing else runs before this.

   Section 4.3, steps 1-4:
     read the device's Apps Script URL → get_config → router → first draw.

   The two screens defined here (first-time setup, cannot-reach-server) are the
   only ones drawn outside render(). They exist precisely for the states where
   the app cannot reach a server, so they must not depend on one. They carry
   their own styles for the same reason: they are the user's only way out of a
   misconfigured device, and must render even if a stylesheet failed to load.
   ========================================================================== */

import { SCRIPT_URL, setScriptUrl, setConfig } from './state.js';
import { api } from './api.js';
import { initRouter } from './router.js';
import { render } from './render.js';
import { t, setLanguage, hasDeviceLanguagePreference } from './i18n/i18n.js';

/** localStorage key holding this device's Apps Script Web App URL. Never in code. */
const SCRIPT_URL_KEY = 'ohsp_script_url';

/**
 * Styles for the boot screens only. Colors come from tokens.css — no literal
 * hex (rule 15) — and spacing uses logical properties so these screens flip
 * with the rest of the app in Arabic.
 */
const BOOT_STYLES = `
  .boot-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .boot-card {
    width: 100%;
    max-width: 460px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-md);
    padding: 28px;
  }
  .boot-brand {
    font-size: 20px;
    font-weight: 700;
    color: var(--text);
  }
  .boot-subtitle {
    margin-block-start: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  .boot-title {
    margin-block-start: 22px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }
  .boot-body {
    margin-block-start: 8px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text2);
  }
  .boot-label {
    display: block;
    margin-block-start: 20px;
    margin-block-end: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text2);
  }
  .boot-input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--card);
    color: var(--text);
    outline: none;
  }
  .boot-input:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft);
  }
  .boot-error {
    margin-block-start: 8px;
    font-size: 12px;
    color: var(--danger);
    min-height: 16px;
  }
  .boot-actions {
    display: flex;
    gap: 10px;
    margin-block-start: 18px;
  }
  .boot-btn {
    flex: 1;
    padding: 11px 16px;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    background: var(--primary);
    color: var(--navy-text-strong);
    font-weight: 600;
  }
  .boot-btn:hover { background: var(--primary-dark); }
  .boot-btn.ghost {
    background: transparent;
    border-color: var(--border);
    color: var(--text2);
  }
  .boot-btn.ghost:hover { background: var(--bg); }
  .boot-loading {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: 14px;
  }
`;

/* ---------- Boot screens -------------------------------------------------- */

/** Shared header for both boot screens. */
function bootHeader() {
  return `
    <div class="boot-brand">${t('app_name')}</div>
    <div class="boot-subtitle">${t('company_name')} — ${t('app_sub')}</div>`;
}

/**
 * "First-time setup" — collects the Apps Script URL, stores it on the device,
 * and reloads so boot() runs again with a URL in hand. The URL lives in
 * localStorage and never in code (rule 2).
 */
function renderSetupScreen(app) {
  app.innerHTML = `
    <style>${BOOT_STYLES}</style>
    <div class="boot-screen">
      <div class="boot-card">
        ${bootHeader()}

        <div class="boot-title">${t('first_time_setup')}</div>
        <p class="boot-body">${t('script_url_prompt')}</p>

        <label class="boot-label" for="setup-url">${t('script_url_label')}</label>
        <input
          class="boot-input"
          id="setup-url"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          placeholder="https://script.google.com/macros/s/…/exec">

        <div class="boot-error" id="setup-error"></div>

        <div class="boot-actions">
          <button class="boot-btn" id="setup-save" type="button">${t('save_and_continue')}</button>
        </div>
      </div>
    </div>`;

  const input = app.querySelector('#setup-url');
  const error = app.querySelector('#setup-error');

  function save() {
    const url = input.value.trim();

    if (!url) {
      error.textContent = t('script_url_required');
      input.focus();
      return;
    }
    if (!/^https:\/\//i.test(url)) {
      error.textContent = t('script_url_invalid');
      input.focus();
      return;
    }

    localStorage.setItem(SCRIPT_URL_KEY, url);
    setScriptUrl(url);
    location.reload();
  }

  app.querySelector('#setup-save').addEventListener('click', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
  });
  input.focus();
}

/** Shown while get_config is in flight. */
function renderLoadingScreen(app) {
  app.innerHTML = `
    <style>${BOOT_STYLES}</style>
    <div class="boot-loading">${t('loading')}</div>`;
}

/**
 * get_config failed. Two ways out: try again (the network may be back), or drop
 * the saved URL and go back to setup (the URL may be wrong, or the deployment
 * may have been replaced with a new one).
 */
function renderServerErrorScreen(app) {
  app.innerHTML = `
    <style>${BOOT_STYLES}</style>
    <div class="boot-screen">
      <div class="boot-card">
        ${bootHeader()}

        <div class="boot-title">${t('cannot_reach_server')}</div>
        <p class="boot-body">${t('cannot_reach_server_body')}</p>

        <div class="boot-actions">
          <button class="boot-btn" id="boot-retry" type="button">${t('retry')}</button>
          <button class="boot-btn ghost" id="boot-change-url" type="button">${t('change_server_url')}</button>
        </div>
      </div>
    </div>`;

  app.querySelector('#boot-retry').addEventListener('click', () => start(app));

  app.querySelector('#boot-change-url').addEventListener('click', () => {
    localStorage.removeItem(SCRIPT_URL_KEY);
    setScriptUrl('');
    location.reload();
  });
}

/* ---------- Boot ---------------------------------------------------------- */

/** Fetch config, then hand the app over to the router. */
async function start(app) {
  renderLoadingScreen(app);

  let config;
  try {
    // No token — get_config is one of the two unauthenticated actions (3.3).
    config = await api.call('get_config');
  } catch (err) {
    console.error('[boot] get_config failed:', err);
    renderServerErrorScreen(app);
    return;
  }

  setConfig(config);

  // Config.primary_language is the default for *new* devices only. Once a user
  // has picked a language here, that choice wins.
  if (!hasDeviceLanguagePreference() && config.primary_language) {
    setLanguage(config.primary_language);
  }

  initRouter();
  render();
}

function boot() {
  const app = document.getElementById('app');
  if (!app) {
    console.error('[OHS Platform] Mount point #app not found in index.html.');
    return;
  }

  setScriptUrl(localStorage.getItem(SCRIPT_URL_KEY) || '');

  if (!SCRIPT_URL) {
    renderSetupScreen(app);
    return;
  }

  start(app);
}

/* A `type="module"` script is deferred, so it normally runs before
   DOMContentLoaded fires — but guard anyway in case that changes. */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
