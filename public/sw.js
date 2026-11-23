// __BUILD_ID__ is replaced at build time (see vite.config.js) so every deploy gets a fresh cache
// and activate() evicts the previous one (old hashed assets no longer pile up).
const CACHE_NAME = 'repwise-__BUILD_ID__';
const APP_SHELL = ['./', './index.html', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function cachePut(request, response) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
}

// Pages: network first (so a deploy shows up on the next load), cache when offline.
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const clean = new URL(request.url);
      clean.search = '';
      await cachePut(clean.href, response.clone());
    }
    return response;
  } catch {
    return (
      (await caches.match(request, { ignoreSearch: true })) ||
      (await caches.match('./index.html')) ||
      (await caches.match('./')) ||
      Response.error()
    );
  }
}

// Static assets (hashed filenames): cache first, refresh in the background.
async function handleAsset(event, request) {
  const cached = await caches.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response && response.status === 200) await cachePut(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never touch external requests (Gemini API calls, fonts, …)
  if (url.origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? handleNavigation(request) : handleAsset(event, request));
});
