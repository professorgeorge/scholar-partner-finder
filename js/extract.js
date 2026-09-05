/*
 * extract.js — turn CV text into a structured scholar profile.
 *
 * Two signals are combined:
 *   (a) Lexicon capabilities: canonical methods, disciplines, funders,
 *       infrastructure and themes recognised from the curated lexicon.
 *   (b) Salient phrases: section-weighted 1-3 word phrases mined from the
 *       text. Their corpus-level IDF is applied later, in engine.js, once
 *       the whole pool is known.
 *
 * Extraction is heuristic and transparent by design: every profile is fully
 * editable in the UI, because no automated reader is perfect and a dean
 * defending a shortlist needs to trust and correct what it sees.
 */
(function (SPF) {
  'use strict';

  var LEX = SPF.lexicon;

  // Weight the same phrase differently depending on the CV section it sits in.
  var SECTION_WEIGHT = {
    research: 2.0, skills: 2.0, grants: 1.8, publications: 1.4,
    experience: 1.2, education: 0.7, teaching: 0.6, service: 0.5, other: 1.0
  };

  var CATEGORY_WEIGHT = {
    method: 1.6, discipline: 1.3, theme: 1.3, infrastructure: 1.4, funder: 0.8, phrase: 1.0
  };

  function normalize(s) {
    return (s || '')
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/[^a-z0-9+#\-\s]/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function isYear(tok) { return /^(19|20)\d{2}$/.test(tok); }

  // Segment the CV into sections keyed by our known section types, so we can
  // weight phrases by where they appear.
  function segment(text) {
    var lines = text.split('\n');
    var sections = {}; // type -> array of lines
    var current = 'other';
    var headerMap = {};
    Object.keys(LEX.SECTION_HEADERS).forEach(function (type) {
      LEX.SECTION_HEADERS[type].forEach(function (h) { headerMap[h] = type; });
    });
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var probe = line.trim().toLowerCase().replace(/[:\-–—]+$/, '').trim();
      var words = probe.split(/\s+/);
      // A section header is a short line that equals or starts with a known header.
      var matched = null;
      if (words.length <= 6 && probe.length <= 42 && probe.length >= 4) {
        if (headerMap[probe]) matched = headerMap[probe];
        else {
          for (var h in headerMap) {
            if (probe === h || probe.indexOf(h) === 0) { matched = headerMap[h]; break; }
          }
        }
      }
      if (matched) { current = matched; if (!sections[current]) sections[current] = []; continue; }
      if (!sections[current]) sections[current] = [];
      sections[current].push(line);
    }
    return sections;
  }

  // Mine section-weighted phrase frequencies (1-3 grams).
  function minePhrases(sections) {
    var freq = Object.create(null); // phrase -> weighted count
    Object.keys(sections).forEach(function (type) {
      var w = SECTION_WEIGHT[type] || 1.0;
      var raw = sections[type].join(' \n ')
        .replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi, ' ')
        .replace(/https?:\/\/\S+/gi, ' ');
      var block = normalize(raw);
      // Split into segments at punctuation-ish boundaries to avoid crossing clauses.
      var segs = block.split(/[\n]+| {2,}/);
      segs.forEach(function (seg) {
        var toks = seg.split(' ').filter(Boolean);
        for (var i = 0; i < toks.length; i++) {
          for (var n = 1; n <= 3; n++) {
            if (i + n > toks.length) break;
            var gram = toks.slice(i, i + n);
            if (LEX.STOPSET[gram[0]] || LEX.STOPSET[gram[n - 1]]) continue;
            if (gram.some(function (g) { return isYear(g) || /^\d+$/.test(g) || g.length < 2; })) continue;
            var phrase = gram.join(' ');
            if (n === 1 && phrase.length < 4) continue;
            freq[phrase] = (freq[phrase] || 0) + w;
          }
        }
      });
    });
    return freq;
  }

  // Recognise canonical capabilities from the lexicon across the whole text.
  function tagCapabilities(fullNorm, sections) {
    var found = {}; // canonical -> {category, count, canonical}
    // Give a light boost to hits inside high-signal sections.
    var highSignal = normalize(((sections.research || []).concat(sections.skills || [], sections.grants || [])).join(' '));
    LEX.index.forEach(function (entry) {
      // Whole-word/phrase match.
      var v = entry.variant;
      var pattern = new RegExp('(^|[^a-z0-9])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])', 'g');
      var count = (fullNorm.match(pattern) || []).length;
      if (!count) return;
      var boost = (highSignal.match(pattern) || []).length > 0 ? 1.5 : 1.0;
      var cur = found[entry.canonical];
      var weighted = count * boost;
      if (!cur) found[entry.canonical] = { canonical: entry.canonical, category: entry.category, count: weighted };
      else { cur.count += weighted; }
    });
    return found;
  }

  function guessIdentity(text, filename) {
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var email = (text.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i) || [])[0] || '';
    var name = '';
    for (var i = 0; i < Math.min(lines.length, 8); i++) {
      var l = lines[i];
      if (/\d/.test(l)) continue;
      if (l.length > 48) continue;
      var lc = l.toLowerCase();
      if (/curriculum vitae|resume|^cv$/.test(lc)) continue;
      if (Object.keys(LEX.SECTION_HEADERS).some(function (t) { return LEX.SECTION_HEADERS[t].indexOf(lc) !== -1; })) continue;
      var words = l.split(/\s+/);
      var capish = words.filter(function (w) { return /^[A-Z][A-Za-z.\-']*$/.test(w); }).length;
      if (words.length >= 1 && words.length <= 5 && capish >= Math.max(1, words.length - 1)) { name = l.replace(/,.*$/, '').trim(); break; }
    }
    if (!name && filename) {
      name = filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-]+/g, ' ')
        .replace(/\b(cv|resume|curriculum|vitae|vita)\b/gi, '').replace(/\s+/g, ' ').trim();
      name = name.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }
    var affiliation = '';
    for (var j = 0; j < Math.min(lines.length, 15); j++) {
      if (/university|institute|college|laboratory|national lab|school of|department of/i.test(lines[j]) && lines[j].length < 90) {
        affiliation = lines[j]; break;
      }
    }
    return { name: name || 'Unnamed scholar', email: email, affiliation: affiliation };
  }

  function computeMetrics(text, sections, currentYear) {
    var years = (text.match(/\b(19|20)\d{2}\b/g) || []).map(Number);
    var recent = years.filter(function (y) { return y >= currentYear - 5 && y <= currentYear + 1; }).length;
    var pubBlock = (sections.publications || []).join('\n');
    var pubCount = (pubBlock.match(/\b(19|20)\d{2}\b/g) || []).length; // rough proxy: one year per reference
    var amounts = (text.match(/\$\s?[\d,]+(?:\.\d+)?\s?(k|thousand|m|million|b|billion)?/gi) || []);
    var grantDollars = amounts.reduce(function (sum, a) {
      var num = parseFloat(a.replace(/[^0-9.]/g, '')) || 0;
      if (/m|million/i.test(a)) num *= 1e6; else if (/b|billion/i.test(a)) num *= 1e9; else if (/k|thousand/i.test(a)) num *= 1e3;
      return sum + num;
    }, 0);
    return {
      wordCount: (text.match(/\S+/g) || []).length,
      approxPublications: pubCount,
      recentActivity: recent,
      grantDollars: grantDollars,
      latestYear: years.length ? Math.max.apply(null, years) : null
    };
  }

  /*
   * Build a profile from raw CV text.
   * options: { filename, id, currentYear }
   */
  function buildProfile(text, options) {
    options = options || {};
    var currentYear = options.currentYear || new Date().getFullYear();
    text = SPF.parse ? SPF.parse.cleanText(text) : text;
    var sections = segment(text);
    var fullNorm = normalize(text);
    var identity = guessIdentity(text, options.filename);
    var capabilities = tagCapabilities(fullNorm, sections);
    var phraseFreq = minePhrases(sections);
    var metrics = computeMetrics(text, sections, currentYear);

    // Concept map: lexicon canonicals get their category weight; salient
    // phrases enter as 'phrase' concepts. IDF is applied later by the engine.
    var concepts = Object.create(null); // key -> {term, category, tf}
    Object.keys(capabilities).forEach(function (canon) {
      var c = capabilities[canon];
      concepts[canon] = { term: canon, category: c.category, tf: c.count * CATEGORY_WEIGHT[c.category] };
    });
    Object.keys(phraseFreq).forEach(function (p) {
      // If a phrase is already a lexicon canonical, fold it in rather than duplicate.
      if (concepts[p]) { concepts[p].tf += phraseFreq[p] * CATEGORY_WEIGHT.phrase; return; }
      concepts[p] = { term: p, category: 'phrase', tf: phraseFreq[p] * CATEGORY_WEIGHT.phrase };
    });

    return {
      id: options.id || ('s_' + Math.random().toString(36).slice(2, 10)),
      name: identity.name,
      email: identity.email,
      affiliation: identity.affiliation,
      sourceFile: options.filename || '',
      addedAt: Date.now(),
      rawText: text,
      concepts: concepts,          // key -> {term, category, tf}
      capabilities: capabilities,  // canonical -> {category, count}
      metrics: metrics,
      edited: false,               // set true once a human curates it
      tagsAdded: [],               // manual additions
      tagsRemoved: []              // manual removals
    };
  }

  // Return capability lists grouped by category for display.
  function groupCapabilities(profile) {
    var groups = { method: [], discipline: [], theme: [], infrastructure: [], funder: [] };
    Object.keys(profile.capabilities).forEach(function (canon) {
      var c = profile.capabilities[canon];
      if (groups[c.category]) groups[c.category].push({ term: canon, count: c.count });
    });
    Object.keys(groups).forEach(function (g) { groups[g].sort(function (a, b) { return b.count - a.count; }); });
    return groups;
  }

  SPF.extract = {
    buildProfile: buildProfile,
    groupCapabilities: groupCapabilities,
    normalize: normalize,
    segment: segment,
    SECTION_WEIGHT: SECTION_WEIGHT,
    CATEGORY_WEIGHT: CATEGORY_WEIGHT
  };
})(typeof window !== 'undefined' ? (window.SPF = window.SPF || {}) : (globalThis.SPF = globalThis.SPF || {}));
