/*
 * service-worker.js — offline app shell caching.
 * Only same-origin app files are precached. The optional pdf.js CDN request is
 * always allowed to hit the network and is never cached here.
 */
var CACHE = 'grant-crosswalk-v2'; // bumped alongside the app's rename and the addition of opportunities.js below
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
  './js/opportunities.js',
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
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});
