/* ==========================================================================
   service-worker.js — the offline shell for the officer PWA (Section 9.1).

   WHAT THIS CACHES, AND WHAT IT MUST NEVER CACHE
   ----------------------------------------------
   This worker caches *shell assets only*: HTML, CSS, JS, icons, background
   art. It never caches a single byte of platform data.

   That is not a performance choice, it is rule 18. The officer's data cache is
   the IndexedDB snapshot in `js/modules/officer/cache.js`, and `staleCheck.js`
   fails the app closed when that snapshot passes `max_stale_hours`. If this
   worker also held a copy of an API response, an officer past the lockout
   threshold could be served a stale verdict from HTTP cache that the staleness
   check never sees — a verdict with no freshness guarantee at all, which is
   precisely the failure mode the fail-closed rule exists to prevent.

   So the fetch handler below calls respondWith() for exactly two things:

     1. same-origin GET requests  (the app's own files)
     2. the three pinned CDN libraries index.html loads

   Everything else — every POST, and in particular every request to
   script.google.com — falls through with no respondWith() at all. An untouched
   request is handled by the browser exactly as if no worker were installed.
   That is the strongest guarantee available here: not "we choose not to cache
   the API", but "the API never enters this file's control flow".

   STRATEGIES
   ----------
   navigations        network-first with a 4s timeout, falling back to the
                      cached shell. Online, a deploy is live immediately;
                      offline or on tower-site signal, the app still opens.
   same-origin assets stale-while-revalidate. Serves instantly from cache and
                      refreshes it in the background, so the load after a
                      deploy picks up new files without a version bump.
   CDN libraries      cache-first. Pinned versions that never change contents.

   WHY THERE IS NO EXHAUSTIVE PRECACHE LIST
   ----------------------------------------
   PRECACHE below holds the boot shell and nothing more. Listing all ~60 JS
   modules would be a second source of truth to keep in step with the file
   tree by hand, and a forgotten entry is a blank screen offline.

   It is not needed: main.js statically imports every module (Section 5.3), so
   one online visit pulls the whole tree through the stale-while-revalidate
   path and into the cache. Officers must sync before leaving for a site
   anyway (Section 7.4, field procedure), and that sync is such a visit.

   DEPLOYING
   ---------
   Bump CACHE_VERSION to force every client to discard its caches and refetch.
   Routine deploys do not need it — stale-while-revalidate picks changes up on
   its own. Bump it when a file is renamed or removed, or when a cached asset
   is known to be bad.
   ========================================================================== */

const CACHE_VERSION = 'v1';

const SHELL_CACHE   = `ohsp-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `ohsp-runtime-${CACHE_VERSION}`;
const VENDOR_CACHE  = `ohsp-vendor-${CACHE_VERSION}`;

const CURRENT_CACHES = [SHELL_CACHE, RUNTIME_CACHE, VENDOR_CACHE];

/** How long a navigation waits for the network before falling back to cache. */
const NAV_TIMEOUT_MS = 4000;

/**
 * The app shell URL. Resolved against the worker's own location so the same
 * file works at `/` locally and at `/OHS-Platform/` on GitHub Pages — nothing
 * in this file may assume it is served from a domain root.
 */
const SHELL_URL = new URL('./', self.location).href;

/**
 * The boot shell: what the app needs to draw *something* with no network.
 * Everything else arrives through the runtime cache as it is used.
 */
const PRECACHE = [
  './',
  './index.html',
  './css/tokens.css',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/pages.css',
  './js/main.js',
  './manifest.webmanifest',
  './background.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

/**
 * The pinned third-party libraries index.html loads. Cross-origin, so the
 * responses come back opaque — we never read them, only replay them, which is
 * all a <script src> needs. Caching them keeps an offline boot free of failed
 * script loads.
 */
const VENDOR_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

/* ---------- Install ------------------------------------------------------- */

/**
 * Precache the boot shell.
 *
 * Each entry is added individually rather than through cache.addAll(), which
 * rejects the whole install if any single request fails. One missing optional
 * asset should not leave the user with no worker at all.
 */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);

    await Promise.all(PRECACHE.map(async (path) => {
      try {
        // cache: 'reload' bypasses the HTTP cache, so a fresh install never
        // precaches a copy the browser was already holding from before a deploy.
        await cache.add(new Request(path, { cache: 'reload' }));
      } catch (err) {
        console.warn('[sw] precache skipped:', path, err);
      }
    }));

    // The new worker takes over without waiting for every tab to close. Safe
    // here: the app is a single page that loads its whole module tree at boot,
    // so there is no half-old, half-new code path to land in.
    await self.skipWaiting();
  })());
});

/* ---------- Activate ------------------------------------------------------ */

/** Drop caches from earlier CACHE_VERSIONs, then claim open tabs. */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();

    await Promise.all(names.map((name) => {
      if (name.startsWith('ohsp-') && CURRENT_CACHES.indexOf(name) === -1) {
        return caches.delete(name);
      }
      return Promise.resolve(false);
    }));

    await self.clients.claim();
  })());
});

/* ---------- Fetch --------------------------------------------------------- */

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Reads only. Every POST — which is every Apps Script action, since the API
  // is POST-for-everything (Section 3.1) — leaves this function untouched.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Opening the app: shell first, so the router can boot with no signal.
  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (VENDOR_URLS.indexOf(stripQuery(url)) !== -1) {
    event.respondWith(cacheFirst(request, VENDOR_CACHE));
    return;
  }

  // Anything else — script.google.com above all — is left to the browser.
});

/* ---------- Strategies ---------------------------------------------------- */

/**
 * Network-first for the app shell, with a timeout.
 *
 * Always resolves against SHELL_URL rather than the requested URL: the router
 * is hash-based (rule 10), so `#/check/home` and `#/dashboard` are the same
 * document, and caching them separately would store the same bytes twice.
 *
 * The timeout matters more than it looks. Without it, a tower site with signal
 * bad enough to accept a connection but not complete one leaves the officer
 * watching a blank page instead of falling back to a shell that works.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function navigationResponse(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await withTimeout(fetch(request), NAV_TIMEOUT_MS);

    if (response && response.ok) {
      cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(SHELL_URL) || await cache.match('./index.html');
    if (cached) return cached;
    throw err;
  }
}

/**
 * Serve from cache immediately, refresh the cache in the background.
 *
 * The revalidation is deliberately not awaited — the point is that the user
 * never waits on it. Its result lands in the cache for the *next* load, which
 * is how a deploy reaches a client without a CACHE_VERSION bump.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  // caches.match() searches every cache, not just RUNTIME_CACHE. That matters:
  // the CSS and main.js were put in SHELL_CACHE by the precache step, so a
  // lookup against the runtime cache alone would miss them on the first
  // offline load and fall through to a 504 — with the files sitting right
  // there in the other cache. Reads are global; writes stay in RUNTIME_CACHE.
  const cached = await caches.match(request);

  const network = fetch(request).then((response) => {
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  }).catch((err) => {
    // Offline with nothing cached is a real failure; offline with a cached
    // copy already returned below is not worth a console entry.
    if (!cached) console.warn('[sw] fetch failed, nothing cached:', request.url, err);
    return null;
  });

  if (cached) return cached;

  const response = await network;
  if (response) return response;

  return new Response('', { status: 504, statusText: 'Offline and not cached' });
}

/**
 * Cache-first, for immutable pinned assets.
 *
 * Opaque responses (status 0, from the no-cors cross-origin fetch) are stored
 * as-is. We cannot inspect them to confirm they are real, which is the known
 * cost of caching cross-origin scripts; the mitigation is that the URLs are
 * version-pinned and a CACHE_VERSION bump clears them.
 *
 * @param {Request} request
 * @param {string} cacheName
 * @returns {Promise<Response>}
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[sw] vendor fetch failed:', request.url, err);
    return new Response('', { status: 504, statusText: 'Offline and not cached' });
  }
}

/* ---------- Helpers ------------------------------------------------------- */

/**
 * Reject a promise that has not settled in time.
 *
 * The underlying fetch is not aborted — letting it finish means its response
 * still reaches the HTTP cache, so a slow network is not wasted work.
 *
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 * @template T
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err)   => { clearTimeout(timer); reject(err); }
    );
  });
}

/** A URL without its query string or hash, for matching against VENDOR_URLS. */
function stripQuery(url) {
  return url.origin + url.pathname;
}

/* ---------- Messages ------------------------------------------------------ */

/**
 * Lets the page ask a waiting worker to activate now. Nothing calls this yet —
 * registerServiceWorker() in js/utils/pwa.js only logs that an update is
 * ready. It is here so an "Update available, reload" prompt can be added
 * later without touching the worker.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
