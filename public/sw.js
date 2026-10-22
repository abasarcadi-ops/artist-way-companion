// Service worker for Artist's Way.
//
// Network first for every same-origin GET: the network gets 2.5 s to answer,
// then the cached copy is used (straight away when offline). Every good
// network answer is stored, so the cache follows the latest deploy.
// Navigations fall back to the cached index.html. Cross-origin requests and
// anything that is not a GET are left alone.
//
// Scripts are the exception: they wait for the network however long it takes,
// and the cache stands in only when there is no network at all. After a
// deploy, a timeout could hand the page some modules from the old release and
// some from the new one, and a module graph mixed like that can fail to start,
// which leaves a blank screen.
//
// This replaces the v1 worker at the same URL (/sw.js) and scope (/). On
// activate it deletes every cache except its own, which removes v1's
// "artists-way-v1". skipWaiting and clients.claim make it take over open pages
// at once; the app decides when to reload (never while the writing timer runs).

// The release number. Bump it whenever anything in public/ changes, and keep
// it equal to APP_VERSION in ui/store.js (Settings shows that one). A new
// VERSION is what makes open apps pick up a release: the new worker installs,
// takes over, and the app reloads once.
const VERSION = '2.0.0';
const CACHE = `artists-way-${VERSION}`;
const NETWORK_TIMEOUT_MS = 2500;

// The app shell, relative to this file, precached on install so the app works
// offline from the first visit. KEEP IN SYNC with public/:
//   - every file the page loads: index.html, styles.css, accents.css, app.js
//     and every module it imports (core.js, content.js, accents.js, ui/*.js),
//     fonts/fonts.css and each woff2 it names, manifest.json and the icons.
//   - when a file in public/ is added, removed or renamed, update this list.
//     A listed file that 404s makes the install fail, and then the old worker
//     stays in charge.
// npm run e2e checks this list against the files in public/ (sw.js itself and
// fonts/OFL.txt are left out on purpose).
const SHELL = [
  'index.html',
  'styles.css',
  'accents.css',
  'app.js',
  'core.js',
  'content.js',
  'accents.js',
  'ui/artist.js',
  'ui/book.js',
  'ui/dates.js',
  'ui/dom.js',
  'ui/kept.js',
  'ui/settings.js',
  'ui/sheet.js',
  'ui/sheets.js',
  'ui/slots.js',
  'ui/sound.js',
  'ui/store.js',
  'ui/toast.js',
  'ui/today.js',
  'ui/writing.js',
  'manifest.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'fonts/fonts.css',
  'fonts/schibsted-grotesk-v7-latin.woff2',
  'fonts/schibsted-grotesk-v7-latin-ext.woff2',
  'fonts/schibsted-grotesk-v7-italic-latin.woff2',
  'fonts/schibsted-grotesk-v7-italic-latin-ext.woff2',
];

const INDEX_URL = new URL('index.html', self.location.href).href;
const INDEX_PATH = new URL(INDEX_URL).pathname;
const ROOT_PATH = new URL('./', self.location.href).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const navigation = request.mode === 'navigate';
  // Cache keys never carry a query string: /?today=... is still the shell,
  // and app.js?v=2 is still app.js.
  const key = navigation ? INDEX_URL : url.origin + url.pathname;
  const storeAs = navigation && url.pathname !== ROOT_PATH && url.pathname !== INDEX_PATH ? null : key;

  const network = fetch(request);
  // Store a good answer even when the cache answered first; waitUntil keeps
  // the worker alive until the copy is written.
  event.waitUntil(network.then((response) => store(storeAs, response)).catch(() => {}));
  // Module scripts and module preloads both arrive with destination "script".
  const script = request.destination === 'script';
  event.respondWith(script ? networkUnlessOffline(network, key) : networkFirst(network, key));
});

async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(
    SHELL.map(async (path) => {
      const url = new URL(path, self.location.href).href;
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error(`Precache failed: ${path} answered ${response.status}`);
      await cache.put(url, unredirected(response));
    }),
  );
}

async function networkFirst(network, key) {
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(resolve, NETWORK_TIMEOUT_MS, null);
  });
  try {
    const response = await Promise.race([network, timedOut]);
    if (response) return response;
    // Slow network: answer from the cache if it has a copy, otherwise keep waiting.
    return (await fromCache(key)) || (await network);
  } catch (error) {
    // Offline, or the request failed.
    const cached = await fromCache(key);
    if (cached) return cached;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Waits for the network, with no timeout. Only a failed request (offline)
// falls back to the cached copy.
async function networkUnlessOffline(network, key) {
  try {
    return await network;
  } catch (error) {
    const cached = await fromCache(key);
    if (cached) return cached;
    throw error;
  }
}

function fromCache(key) {
  return caches.match(key, { cacheName: CACHE, ignoreVary: true });
}

// Clones synchronously, before the page starts reading the body.
function store(key, response) {
  if (!key || response.status !== 200 || response.type !== 'basic') return undefined;
  const copy = unredirected(response.clone());
  return caches.open(CACHE).then((cache) => cache.put(key, copy));
}

// A navigation must never be answered with a redirected response (the browser
// refuses it), so redirected copies are stored as plain ones.
function unredirected(response) {
  if (!response.redirected) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
