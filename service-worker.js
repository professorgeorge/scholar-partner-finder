/*
 * service-worker.js — offline app shell caching.
 *
 * Strategy: network-first for same-origin GET requests, with the cache as an
 * offline fallback. When you are online you always receive the freshly deployed
 * files (so a push to GitHub Pages shows up on the next load), and when you are
 * offline the last-seen copy is served from the cache. The optional pdf.js CDN
 * request is cross-origin and always goes straight to the network.
 *
 * The cache name is versioned. Bump it whenever the shell changes so that an
 * updated worker deletes the previous cache on activation. Because the bytes of
 * this file then change, the browser detects the new worker, installs it, and
 * (via skipWaiting + clients.claim) takes control promptly.
 */
var CACHE = 'spf-v4';
var SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/lexicon.js',
  './js/parse.js',
  './js/extract.js',
  './js/engine.js',
  './js/store.js',
  './js/llm.js',
  './js/samples-data.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // let CDN/API go to network
  // Network-first: prefer the freshly deployed file, fall back to cache offline.
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined);
      });
    })
  );
});
