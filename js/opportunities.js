/*
 * opportunities.js — OPTIONAL live funding search. Off by default; nothing
 * here makes a network call unless the user turns it on in Settings.
 *
 * What it does: takes one scholar's profile (built by extract.js, exactly
 * like a roster member) and finds open or forecasted U.S. federal funding
 * opportunities that match it, using Grants.gov's public search API.
 *
 * Why Grants.gov and not a scraper: Grants.gov publishes a documented REST
 * endpoint (v1/api/search2, and v1/api/fetchOpportunity for opportunity
 * detail) that is explicitly described as requiring no login and no API key.
 * That means this feature can query real, current solicitations without
 * scraping the grants.gov website, which would be fragile, likely against
 * its terms, and exactly the kind of traffic that trips rate limiters.
 *
 * Two honest caveats, stated here rather than buried:
 *
 *  1. Schema uncertainty. Grants.gov documents this API for server-side and
 *     scripted use; it does not commit to a browser-CORS contract, and this
 *     app has no server of its own. The first call each session is a real
 *     test of whether a direct browser fetch is even possible; if it is not,
 *     callers get a clear error and a link to search grants.gov manually
 *     instead of a silent failure. Field names in the JSON response are also
 *     not pinned down by a formal, versioned spec, so this module reads them
 *     defensively (several known aliases, then a fallback heuristic) rather
 *     than assuming one exact shape.
 *  2. This is a network call the roster's privacy story does not otherwise
 *     make. Sending a scholar's top research terms (never their CV text) to
 *     a government API is a smaller disclosure than the optional AI layer's,
 *     but it is still data leaving the device, so it is off by default and
 *     gated the same way: an explicit toggle, described plainly, in Settings.
 *
 * NIH RePORTER and the NSF Award API are deliberately not wired in here.
 * Both are free, public, no-key APIs, but they return *awarded* projects,
 * not open calls, so "match a CV to an RFP" is not what they answer. They
 * are better fits for a later, separate "who else works in this area"
 * feature, and conflating them with opportunity search would blur exactly
 * the distinction this project's methodology is otherwise careful about.
 */
(function (GCX) {
  'use strict';

  var SEARCH_URL = 'https://api.grants.gov/v1/api/search2';
  var FETCH_URL = 'https://api.grants.gov/v1/api/fetchOpportunity';
  var MANUAL_SEARCH_URL = 'https://www.grants.gov/search-grants';
  var DETAIL_URL = 'https://www.grants.gov/search-results-detail/';

  var DEFAULT = {
    enabled: false,          // off until the user opts in
    rows: 20,                // hits requested per keyword query
    maxKeywords: 4,          // number of the scholar's top terms to query with
    agencyFilter: '',        // optional free-text agency code, e.g. "NSF", "NIH"
    onlyOpenAndForecasted: true,
    enrichTop: 12,           // how many hits get a follow-up fetchOpportunity call for full text
    cacheHours: 12,
    proxyBaseUrl: ''         // optional: tools/grants-proxy.js, for when a direct browser call is blocked
  };

  var CATEGORY_QUERY_WEIGHT = { method: 1.5, discipline: 1.4, theme: 1.3, infrastructure: 1.2, funder: 0.2, phrase: 1.0 };

  // ---- settings -----------------------------------------------------------

  function getSettings() {
    if (!GCX.store) return Promise.resolve(Object.assign({}, DEFAULT));
    return GCX.store.getSetting('opportunities', null).then(function (v) {
      return Object.assign({}, DEFAULT, v || {});
    });
  }
  function setSettings(cfg) {
    var merged = Object.assign({}, DEFAULT, cfg || {});
    return GCX.store ? GCX.store.setSetting('opportunities', merged) : Promise.resolve(merged);
  }

  // ---- picking search keywords from a scholar profile ---------------------

  // Prefer the scholar's most distinctive, contentful terms; funder mentions
  // (e.g. "NSF" appearing because they've been funded by it before) make poor
  // search keywords, so they are heavily downweighted rather than excluded
  // outright (a scholar whose CV is almost entirely a funder's name should
  // still get *something* to search with).
  function topKeywords(profile, n) {
    n = n || DEFAULT.maxKeywords;
    var tf = GCX.engine.effectiveTf(profile);
    var scored = Object.keys(tf).map(function (t) {
      var cat = (profile.concepts && profile.concepts[t] && profile.concepts[t].category) || 'phrase';
      return { term: t, category: cat, score: tf[t] * (CATEGORY_QUERY_WEIGHT[cat] || 1) };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var out = [];
    for (var i = 0; i < scored.length && out.length < n; i++) {
      // Skip a term that is just a substring of one already chosen (e.g. avoid
      // querying "learning" separately from "machine learning").
      var t = scored[i].term;
      if (out.some(function (o) { return o.indexOf(t) !== -1 || t.indexOf(o) !== -1; })) continue;
      out.push(t);
    }
    return out;
  }

  // ---- Grants.gov client ---------------------------------------------------

  function fetchJson(url, body, opts) {
    opts = opts || {};
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 12000) : null;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) return res.text().then(function (t) { throw new Error('Grants.gov returned ' + res.status + (t ? ': ' + t.slice(0, 200) : '')); });
      return res.json();
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error((opts.viaProxy ? 'Your local relay' : 'Grants.gov') + ' did not respond in time.');
      // A bare "Failed to fetch" / TypeError is the browser's generic name for
      // several problems. Which one is most likely depends on whether this
      // went straight to Grants.gov or through the optional local relay.
      if (e instanceof TypeError) {
        if (opts.viaProxy) {
          throw new Error('Could not reach your local relay at ' + url + '. Check that `node tools/grants-proxy.js` is running, and that the URL in Settings matches.');
        }
        throw new Error('Could not reach Grants.gov directly from the browser (likely blocked by the browser\u2019s cross-origin policy, or you are offline). Use the manual search link instead, or run the small local relay described in the README.');
      }
      throw e;
    });
  }

  // The response shape is not pinned down by a public, versioned schema, so
  // hits are located defensively rather than assumed to sit at one exact path.
  function findHitsArray(json) {
    var candidates = [
      json && json.data && json.data.oppHits,
      json && json.oppHits,
      json && json.data && json.data.data && json.data.data.oppHits,
      json && json.data
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (Array.isArray(candidates[i])) return candidates[i];
    }
    return [];
  }

  function firstOf(obj, keys) {
    for (var i = 0; i < keys.length; i++) if (obj[keys[i]] != null && obj[keys[i]] !== '') return obj[keys[i]];
    return '';
  }

  // Best-effort pick of the longest plain-string field in a record, used as a
  // fallback description when the exact field name for synopsis text isn't
  // known or has changed upstream.
  function longestStringField(obj, excludeKeys) {
    var best = '';
    Object.keys(obj || {}).forEach(function (k) {
      if (excludeKeys.indexOf(k) !== -1) return;
      var v = obj[k];
      if (typeof v === 'string' && v.length > best.length) best = v;
    });
    return best;
  }

  function normalizeHit(raw) {
    var id = firstOf(raw, ['id', 'opportunityId', 'oppId', 'opportunity_id']);
    var number = firstOf(raw, ['number', 'opportunityNumber', 'oppNumber']);
    var title = firstOf(raw, ['title', 'opportunityTitle', 'oppTitle']);
    var agency = firstOf(raw, ['agency', 'agencyName', 'agencyCode']);
    var openDate = firstOf(raw, ['openDate', 'postDate']);
    var closeDate = firstOf(raw, ['closeDate', 'closeDateStr', 'responseDate']);
    var status = firstOf(raw, ['oppStatus', 'status']);
    return {
      id: String(id || ''), number: String(number || ''), title: String(title || '(untitled opportunity)'),
      agency: String(agency || ''), openDate: String(openDate || ''), closeDate: String(closeDate || ''),
      status: String(status || ''),
      text: [title, agency, longestStringField(raw, ['title', 'opportunityTitle', 'oppTitle'])].filter(Boolean).join('. '),
      thin: true, // no full synopsis yet; enrichment may replace text and clear this
      raw: raw
    };
  }

  function searchOnce(keyword, cfg) {
    var body = { keyword: keyword, rows: cfg.rows, startRecordNum: 0 };
    if (cfg.agencyFilter) body.agencies = [cfg.agencyFilter];
    if (cfg.onlyOpenAndForecasted) body.oppStatuses = ['forecasted', 'posted'];
    return fetchJson(urlsFor(cfg).search, body, { viaProxy: !!cfg.proxyBaseUrl }).then(function (json) {
      return findHitsArray(json).map(normalizeHit);
    });
  }

  function enrichOne(opp, cfg) {
    if (!opp.id) return Promise.resolve(opp);
    return fetchJson(urlsFor(cfg).fetch, { opportunityId: opp.id }, { viaProxy: !!cfg.proxyBaseUrl }).then(function (json) {
      var rec = (json && json.data) || json || {};
      var synopsisObj = rec.synopsis || rec.synopsisDetail || rec;
      var text = longestStringField(synopsisObj, []);
      if (text && text.length > opp.text.length) { opp.text = text; opp.thin = false; }
      return opp;
    }).catch(function () { return opp; }); // enrichment is best-effort; never let it fail the whole search
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Resolve which base to call: direct to Grants.gov by default, or through
  // the optional local relay (tools/grants-proxy.js) if the user has pointed
  // one at a running instance, for browsers that block the direct call.
  function urlsFor(cfg) {
    var base = (cfg.proxyBaseUrl || '').trim().replace(/\/+$/, '');
    if (!base) return { search: SEARCH_URL, fetch: FETCH_URL };
    return { search: base + '/v1/api/search2', fetch: base + '/v1/api/fetchOpportunity' };
  }

  // Sequential, politely-paced calls: one keyword query at a time, then a
  // capped number of detail lookups. This is a handful of requests per
  // search, not a scraping-style crawl, and is easy to keep that way.
  function runSearch(keywords, cfg) {
    var byId = {};
    var order = [];
    function absorb(hits) {
      hits.forEach(function (h) {
        var key = h.id || (h.title + '|' + h.agency);
        if (!byId[key]) { byId[key] = h; order.push(key); }
      });
    }
    // The first query is deliberately NOT wrapped in a try/catch. If
    // Grants.gov is unreachable (offline, or the browser blocks the
    // cross-origin request), this is where that has to surface plainly to
    // the caller, rather than being absorbed and misreported as "zero
    // matches found". Only once connectivity is established does a single
    // bad keyword get treated as non-fatal.
    return searchOnce(keywords[0], cfg).then(function (hits) {
      absorb(hits);
      var chain = Promise.resolve();
      keywords.slice(1).forEach(function (kw) {
        chain = chain.then(function () { return delay(200); })
          .then(function () { return searchOnce(kw, cfg); })
          .then(absorb)
          .catch(function () { /* one bad keyword shouldn't sink an otherwise-working search */ });
      });
      return chain.then(function () {
        var opps = order.map(function (k) { return byId[k]; });
        var toEnrich = opps.slice(0, cfg.enrichTop);
        var rest = opps.slice(cfg.enrichTop);
        var echain = Promise.resolve();
        toEnrich.forEach(function (o) {
          echain = echain.then(function () { return delay(150); }).then(function () { return enrichOne(o, cfg); });
        });
        return echain.then(function () { return toEnrich.concat(rest); });
      });
    });
  }

  // ---- caching --------------------------------------------------------------

  function cacheKeyFor(keywords, cfg) {
    return 'grantsgov:' + JSON.stringify({ k: keywords.slice().sort(), a: cfg.agencyFilter || '', s: !!cfg.onlyOpenAndForecasted, r: cfg.rows });
  }
  function cacheLookup(key, hours) {
    if (!GCX.store) return Promise.resolve(null);
    return GCX.store.getCacheEntry(key).then(function (rec) {
      if (!rec) return null;
      var ageMs = Date.now() - (rec.savedAt || 0);
      if (ageMs > (hours || DEFAULT.cacheHours) * 3600 * 1000) return null;
      return rec.value;
    });
  }
  function cacheStore(key, value) {
    if (!GCX.store) return Promise.resolve();
    return GCX.store.setCacheEntry(key, value);
  }

  // ---- ranking: reuses the existing engine, run in the other direction -----
  // (RFP Talent Search is "one RFP vs many scholars"; this is "one scholar
  // vs many opportunity documents". Same cosine-similarity machinery either
  // way, so no changes to engine.js were needed.)

  function rankForProfile(profile, opps) {
    var analyses = opps.map(function (o) { return { opp: o, a: GCX.engine.analyzeRFP(o.text) }; });
    var corpus = GCX.engine.buildCorpus([profile], analyses.map(function (x) { return x.a.tf; }));
    var pv = GCX.engine.vectorize(GCX.engine.effectiveTf(profile), corpus);
    var results = analyses.map(function (x) {
      var ov = GCX.engine.vectorize(x.a.tf, corpus);
      var relevance = GCX.engine.cosine(pv, ov);
      var matched = [];
      Object.keys(ov).forEach(function (t) {
        if (pv[t]) matched.push({ term: t, category: (x.a.concepts[t] && x.a.concepts[t].category) || 'phrase', contribution: pv[t] * ov[t] });
      });
      matched.sort(function (a, b) { return b.contribution - a.contribution; });
      return { opportunity: x.opp, relevance: relevance, matched: matched.slice(0, 8) };
    });
    results.sort(function (a, b) { return b.relevance - a.relevance; });
    return results;
  }

  // ---- public entry points --------------------------------------------------

  function searchForProfile(profile, overrides) {
    return getSettings().then(function (base) {
      var cfg = Object.assign({}, base, overrides || {});
      if (!cfg.enabled) return Promise.reject(new Error('Live funding search is turned off. Enable it in Settings to send search terms to Grants.gov.'));
      var keywords = topKeywords(profile, cfg.maxKeywords);
      if (!keywords.length) return Promise.reject(new Error('Could not find enough distinctive terms in this CV to search with. Add a few tags to the scholar first.'));
      var key = cacheKeyFor(keywords, cfg);
      return cacheLookup(key, cfg.cacheHours).then(function (cached) {
        if (cached) return { keywords: keywords, ranked: rankForProfile(profile, cached), fromCache: true };
        return runSearch(keywords, cfg).then(function (opps) {
          return cacheStore(key, opps).then(function () {
            return { keywords: keywords, ranked: rankForProfile(profile, opps), fromCache: false };
          });
        });
      });
    });
  }

  function testConnection() {
    return getSettings().then(function (cfg) {
      return searchOnce('research', Object.assign({}, cfg, { rows: 1 }));
    }).then(function (hits) {
      return { ok: true, hitCount: hits.length };
    });
  }

  function manualSearchUrl(keywords) {
    return MANUAL_SEARCH_URL + '?keywords=' + encodeURIComponent((keywords || []).join(' '));
  }
  function detailUrl(opp) {
    return opp && opp.id ? DETAIL_URL + opp.id : '';
  }

  GCX.opportunities = {
    DEFAULT: DEFAULT,
    getSettings: getSettings,
    setSettings: setSettings,
    topKeywords: topKeywords,
    searchForProfile: searchForProfile,
    testConnection: testConnection,
    manualSearchUrl: manualSearchUrl,
    detailUrl: detailUrl,
    _rankForProfile: rankForProfile, // exposed for the offline test harness
    _urlsFor: urlsFor                // exposed for the offline test harness
  };
})(typeof window !== 'undefined' ? (window.GCX = window.GCX || {}) : (globalThis.GCX = globalThis.GCX || {}));
