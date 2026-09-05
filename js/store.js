/*
 * store.js — local persistence via IndexedDB.
 *
 * The roster (a dean's or VP's growing library of faculty CVs) is the asset
 * that makes this tool pay off: build it once, and every future RFP becomes a
 * fast query. Everything is stored on-device, in this browser, and never
 * transmitted. A plain JSON export/import is provided so a roster can be
 * backed up, moved between machines, or shared deliberately.
 */
(function (SPF) {
  'use strict';

  var DB_NAME = 'scholar_partner_finder';
  var DB_VERSION = 1;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('searches')) db.createObjectStore('searches', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var s = t.objectStore(store);
        var out = fn(s);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function getAll(store) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var req = db.transaction(store, 'readonly').objectStore(store).openCursor();
        req.onsuccess = function (e) { var c = e.target.result; if (c) { out.push(c.value); c.continue(); } else resolve(out); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  var store = {
    available: typeof indexedDB !== 'undefined',

    getProfiles: function () { return getAll('profiles'); },
    putProfile: function (p) { return tx('profiles', 'readwrite', function (s) { s.put(p); }); },
    putProfiles: function (arr) { return tx('profiles', 'readwrite', function (s) { arr.forEach(function (p) { s.put(p); }); }); },
    deleteProfile: function (id) { return tx('profiles', 'readwrite', function (s) { s.delete(id); }); },
    clearProfiles: function () { return tx('profiles', 'readwrite', function (s) { s.clear(); }); },

    getSetting: function (key, dflt) {
      return open().then(function (db) {
        return new Promise(function (resolve) {
          var req = db.transaction('meta', 'readonly').objectStore('meta').get(key);
          req.onsuccess = function () { resolve(req.result ? req.result.value : dflt); };
          req.onerror = function () { resolve(dflt); };
        });
      });
    },
    setSetting: function (key, value) { return tx('meta', 'readwrite', function (s) { s.put({ key: key, value: value }); }); },

    getSearches: function () { return getAll('searches'); },
    putSearch: function (rec) { return tx('searches', 'readwrite', function (s) { s.put(rec); }); },
    deleteSearch: function (id) { return tx('searches', 'readwrite', function (s) { s.delete(id); }); },

    // Full JSON snapshot for backup / transfer.
    exportAll: function () {
      return Promise.all([getAll('profiles'), getAll('meta'), getAll('searches')]).then(function (r) {
        // Strip the API key from any exported settings; keys never leave in a backup.
        var meta = r[1].map(function (m) { return m.key === 'llm' ? { key: 'llm', value: Object.assign({}, m.value, { apiKey: '' }) } : m; });
        return { version: 1, exportedAt: Date.now(), profiles: r[0], meta: meta, searches: r[2] };
      });
    },
    importAll: function (data) {
      if (!data || !data.profiles) return Promise.reject(new Error('Not a valid export file.'));
      return store.putProfiles(data.profiles).then(function () {
        return Promise.all((data.searches || []).map(function (s) { return store.putSearch(s); }));
      });
    }
  };

  SPF.store = store;
})(typeof window !== 'undefined' ? (window.SPF = window.SPF || {}) : (globalThis.SPF = globalThis.SPF || {}));
