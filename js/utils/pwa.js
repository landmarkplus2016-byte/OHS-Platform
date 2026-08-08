/* ==========================================================================
   pwa.js — service worker registration.

   One job: get service-worker.js registered, and stay silent about it. The
   worker itself decides what to cache (see the header comment there); this
   file only decides *whether* to install one.

   Registration is fire-and-forget on purpose. Boot must not wait on it and
   must not fail because of it — a device where the worker cannot install is a
   device where the app still works online, which is every admin's situation
   anyway. Only the officer's offline shell depends on it.
   ========================================================================== */

/**
 * Register the service worker, if this device can have one.
 *
 * Skipped in three cases, each of which would otherwise throw:
 *
 *   - no `serviceWorker` in navigator — older browsers, and any WebView with
 *     it switched off
 *   - a non-secure origin — workers need HTTPS. localhost counts as secure,
 *     so `python -m http.server` during development is fine; a LAN IP over
 *     plain http is not, and that is the usual reason it goes quiet when
 *     testing from a phone against a dev machine
 *   - `file://` — the app cannot run from there at all (see index.html), but
 *     failing loudly here would bury the clearer module/CORS error
 *
 * The worker URL is resolved from `import.meta.url` rather than written as a
 * root-absolute path, because GitHub Pages serves this repo from
 * `/OHS-Platform/` and a leading slash would look for it one directory too
 * high. Two levels up from `js/utils/` is the app root either way.
 *
 * @returns {void}
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!self.isSecureContext) return;
  if (location.protocol === 'file:') return;

  // .href rather than the URL object: register() takes strings, and relying on
  // implicit stringification is a needless bet on the implementation.
  const workerUrl = new URL('../../service-worker.js', import.meta.url).href;
  const scope = new URL('../../', import.meta.url).href;

  navigator.serviceWorker.register(workerUrl, { scope }).then((registration) => {
    registration.addEventListener('updatefound', () => {
      const incoming = registration.installing;
      if (!incoming) return;

      incoming.addEventListener('statechange', () => {
        // `controller` is null on the very first install — that is a new
        // worker taking over an uncontrolled page, not an update to report.
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          console.info('[pwa] A new version is cached and will load on next open.');
        }
      });
    });
  }).catch((err) => {
    console.warn('[pwa] Service worker registration failed:', err);
  });
}
