/*
 * Chokepoint service worker (PWA offline shell, plan §16.4/Decision 5).
 *
 * Strategy:
 *  - Precache the app shell (index.html, manifest, icons) at install.
 *  - Runtime-cache same-origin GETs (bundled JS/CSS, /cesium/ runtime assets)
 *    with a bounded entry count (LRU-ish trim). Cesium offline imagery tiles
 *    are bundled, so the investigation works offline after first load.
 *  - NEVER cache cross-origin responses (map imagery providers stay network-
 *    bound; attribution and licensing stay honest).
 *  - Network-first for navigation requests so a fresh deploy is picked up
 *    when online; cache fallback keeps the shell usable offline.
 *  - No secrets pass through here (share state is the URL hash only, §11.2).
 */
const CACHE_NAME = "chokepoint-shell-v1";
const MAX_RUNTIME_ENTRIES = 200;

const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function trimRuntimeCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_RUNTIME_ENTRIES) return;
  // Delete oldest-first by URL (insertion order is fetch order; good enough
  // for a bounded shell cache — determinism is not required here).
  const excess = keys.length - MAX_RUNTIME_ENTRIES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cross-origin: network only

  if (request.mode === "navigate") {
    // Network-first navigation with cache fallback (offline shell).
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  // Cache-first for same-origin assets (hashed bundle filenames + /cesium/).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches
            .open(CACHE_NAME)
            .then((c) => c.put(request, copy).then(() => trimRuntimeCache(c)));
        }
        return response;
      });
    }),
  );
});
