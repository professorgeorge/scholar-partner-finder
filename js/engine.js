/*
 * engine.js — the analytical core. No network, no dependencies.
 *
 * Design choices worth stating plainly:
 *
 *  - Concepts are weighted by TF-IDF across the current pool. A term that
 *    every scholar lists (say, "research") is nearly worthless for telling
 *    people apart; a term only two scholars share is highly informative.
 *    IDF encodes exactly that intuition, which is what makes the pool useful
 *    for finding distinctive, combinable expertise rather than generic fit.
 *
 *  - Relevance to an RFP is cosine similarity between the scholar's concept
 *    vector and the RFP's. It is symmetric, bounded in [0,1], and every score
 *    can be decomposed into the specific shared terms that produced it.
 *
 *  - Team assembly maximises weighted RFP *coverage* with diminishing returns:
 *    adding a member who addresses an unmet requirement helps far more than
 *    adding a fifth person who duplicates the first four. This is the formal
 *    expression of complementarity, solved greedily (a (1-1/e)-approximation
 *    to weighted maximum coverage, which is the right and well-understood tool
 *    here).
 *
 *  - We never collapse a team into a single opaque number. Coverage,
 *    complementarity, redundancy, bridge strength and interdisciplinarity are
 *    reported separately, because a VP defending a shortlist needs the parts,
 *    not just a verdict.
 */
(function (GCX) {
  'use strict';

  var LEX = GCX.lexicon;
  var EX = GCX.extract;

  function titleCase(s) {
    return String(s).replace(/\b([a-z])/g, function (m, c) { return c.toUpperCase(); })
      .replace(/\b(Nlp|Hpc|Gis|Ai|Ml|Rct|Iot|Nsf|Nih|Doe|Dod|Nasa|Neh|Cfd|Fea|Sem)\b/gi, function (m) { return m.toUpperCase(); });
  }

  // Effective concept TF for a profile, honouring manual curation.
  function effectiveTf(profile) {
    var tf = Object.create(null);
    Object.keys(profile.concepts || {}).forEach(function (k) {
      if ((profile.tagsRemoved || []).indexOf(k) !== -1) return;
      tf[k] = profile.concepts[k].tf;
    });
    (profile.tagsAdded || []).forEach(function (t) {
      var key = t.toLowerCase();
      tf[key] = Math.max(tf[key] || 0, 3.0); // manual tags are strong, deliberate signals
    });
    return tf;
  }

  function categoryOf(profile, term) {
    if (profile.concepts && profile.concepts[term]) return profile.concepts[term].category;
    if (LEX) {
      for (var i = 0; i < LEX.index.length; i++) if (LEX.index[i].canonical === term) return LEX.index[i].category;
    }
    return 'phrase';
  }

  // Build IDF over the pool (optionally including the RFP as one more document).
  function buildCorpus(profiles, extraDocs) {
    var df = Object.create(null);
    var docs = profiles.map(effectiveTf);
    if (extraDocs) extraDocs.forEach(function (d) { docs.push(d); });
    var N = docs.length || 1;
    docs.forEach(function (tf) {
      Object.keys(tf).forEach(function (t) { if (tf[t] > 0) df[t] = (df[t] || 0) + 1; });
    });
    var idf = Object.create(null);
    Object.keys(df).forEach(function (t) { idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1; });
    return { idf: idf, N: N, df: df, defaultIdf: Math.log(N + 1) + 1 };
  }

  function idfOf(corpus, term) { return corpus.idf[term] != null ? corpus.idf[term] : corpus.defaultIdf; }

  function vectorize(tf, corpus) {
    var v = Object.create(null);
    Object.keys(tf).forEach(function (t) { if (tf[t] > 0) v[t] = tf[t] * idfOf(corpus, t); });
    return v;
  }

  function norm(v) { var s = 0; for (var k in v) s += v[k] * v[k]; return Math.sqrt(s); }

  function normalizeVec(v) {
    var n = norm(v); if (!n) return Object.create(null);
    var out = Object.create(null); for (var k in v) out[k] = v[k] / n; return out;
  }

  function cosine(a, b) {
    var na = norm(a), nb = norm(b);
    if (!na || !nb) return 0;
    var dot = 0, small = a, big = b;
    if (Object.keys(a).length > Object.keys(b).length) { small = b; big = a; }
    for (var k in small) if (big[k] != null) dot += small[k] * big[k];
    return dot / (na * nb);
  }

  // ---- RFP analysis ------------------------------------------------------

  // Program-boilerplate and generic tokens that produce junk requirement
  // phrases in RFP text. Lexicon capabilities are never filtered by this.
  var RFP_STOP = (function () {
    var s = Object.create(null);
    ('program programs solicitation synopsis proposal proposals proposer proposers ' +
      'foundation national invites invite invited award awards anticipated approximately ' +
      'encouraged strongly credible plan plans following several genuine integrative ' +
      'improves improve improved spanning team teams areas area interest interests ' +
      'capabilities capability broader impacts total reuse smart connected cc science ' +
      'sciences use-inspired ai-enabled successful combine must broaden translation ' +
      'practice pair pairs input especially attention proposed interventions')
      .split(/\s+/).forEach(function (w) { s[w] = true; });
    return s;
  })();

  function analyzeRFP(text) {
    text = GCX.parse ? GCX.parse.cleanText(text) : text;
    var nrm = EX.normalize(text);
    // Treat the whole RFP as one block; boost lexicon capabilities.
    var caps = capsFromNorm(nrm);
    var phrases = phrasesFromText(text);
    var concepts = Object.create(null); // key -> {term, category, tf}
    Object.keys(caps).forEach(function (canon) {
      concepts[canon] = { term: canon, category: caps[canon].category, tf: caps[canon].count * (EX.CATEGORY_WEIGHT[caps[canon].category] || 1) };
    });
    Object.keys(phrases).forEach(function (p) {
      if (concepts[p]) { concepts[p].tf += phrases[p]; return; }
      concepts[p] = { term: p, category: 'phrase', tf: phrases[p] };
    });

    // Requirement-salience filter: keep every lexicon capability, plus the most
    // salient multi-word phrases that are not program boilerplate. This is what
    // coverage, gaps and relevance run on, so the RFP is read as a set of real
    // requirements rather than a bag of every n-gram in the announcement.
    var reqTf = Object.create(null);
    var phraseCandidates = [];
    Object.keys(concepts).forEach(function (key) {
      var c = concepts[key];
      if (c.category !== 'phrase') { reqTf[key] = c.tf; return; }
      var words = key.split(' ');
      if (words.length < 2) return;
      if (words.some(function (w) { return LEX.STOPSET[w] || RFP_STOP[w]; })) return;
      phraseCandidates.push({ key: key, tf: c.tf, len: words.length });
    });
    phraseCandidates.sort(function (a, b) { return (b.tf - a.tf) || (b.len - a.len) || (a.key < b.key ? -1 : 1); });
    phraseCandidates.slice(0, 18).forEach(function (pc) { reqTf[pc.key] = concepts[pc.key].tf; });

    var themes = Object.keys(caps).filter(function (c) { return caps[c].category === 'theme'; });
    var funders = Object.keys(caps).filter(function (c) { return caps[c].category === 'funder'; });
    return { text: text, concepts: concepts, tf: reqTf, themes: themes, funders: funders };
  }

  function capsFromNorm(fullNorm) {
    var found = {};
    LEX.index.forEach(function (entry) {
      var v = entry.variant;
      var pattern = new RegExp('(^|[^a-z0-9])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])', 'g');
      var count = (fullNorm.match(pattern) || []).length;
      if (!count) return;
      var cur = found[entry.canonical];
      if (!cur) found[entry.canonical] = { category: entry.category, count: count };
      else cur.count += count;
    });
    return found;
  }

  function phrasesFromText(text) {
    // Own normalisation that PRESERVES list and clause boundaries (commas,
    // conjunctions, punctuation) so a phrase never spans two list items.
    var block = String(text).toLowerCase()
      .replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g, ' | ')   // emails
      .replace(/https?:\/\/\S+/g, ' | ')                            // urls
      .replace(/[’']/g, "'")
      .replace(/\b(and|or|to|of|for|with|in|the)\b/g, ' | ')
      .replace(/[.,;:()\[\]/]+/g, ' | ')
      .replace(/[^a-z0-9+#\-\s|]/g, ' ');
    var segs = block.split(/[|\n]+/);
    var freq = Object.create(null);
    segs.forEach(function (seg) {
      var toks = seg.split(' ').filter(Boolean);
      for (var i = 0; i < toks.length; i++) {
        for (var n = 1; n <= 3; n++) {
          if (i + n > toks.length) break;
          var gram = toks.slice(i, i + n);
          // For RFP requirement mining, reject any phrase containing a stopword.
          if (gram.some(function (g) { return LEX.STOPSET[g]; })) continue;
          if (gram.some(function (g) { return /^\d+$/.test(g) || g.length < 2 || /^(19|20)\d{2}$/.test(g); })) continue;
          var phrase = gram.join(' ');
          if (n === 1 && phrase.length < 4) continue;
          freq[phrase] = (freq[phrase] || 0) + 1;
        }
      }
    });
    return freq;
  }

  // ---- individual scoring ------------------------------------------------

  function normArr(vals) {
    var max = Math.max.apply(null, vals.concat([0]));
    return function (x) { return max > 0 ? x / max : 0; };
  }

  /*
   * Rank scholars for an RFP.
   * weights: {relevance, recent, funding} (need not sum to 1; normalised).
   * Returns array sorted by composite, each item fully explainable.
   */
  function scoreScholarsForRFP(profiles, rfpAnalysis, weights, corpus) {
    weights = Object.assign({ relevance: 0.7, recent: 0.2, funding: 0.1 }, weights || {});
    var wsum = weights.relevance + weights.recent + weights.funding || 1;
    corpus = corpus || buildCorpus(profiles, [rfpAnalysis.tf]);
    var rfpVec = vectorize(rfpAnalysis.tf, corpus);
    var recentNorm = normArr(profiles.map(function (p) { return p.metrics ? p.metrics.recentActivity : 0; }));
    var fundNorm = normArr(profiles.map(function (p) { return p.metrics ? Math.log10(1 + (p.metrics.grantDollars || 0)) : 0; }));

    var results = profiles.map(function (p) {
      var tf = effectiveTf(p);
      var vec = vectorize(tf, corpus);
      var relevance = cosine(vec, rfpVec);
      var recent = recentNorm(p.metrics ? p.metrics.recentActivity : 0);
      var funding = fundNorm(p.metrics ? Math.log10(1 + (p.metrics.grantDollars || 0)) : 0);
      var composite = (weights.relevance * relevance + weights.recent * recent + weights.funding * funding) / wsum;
      // Explainability: which shared terms drove the relevance.
      var matched = [];
      Object.keys(rfpVec).forEach(function (t) {
        if (vec[t]) matched.push({ term: t, category: categoryOf(p, t), contribution: vec[t] * rfpVec[t] });
      });
      matched.sort(function (a, b) { return b.contribution - a.contribution; });
      return {
        profile: p, relevance: relevance, recent: recent, funding: funding,
        composite: composite, matched: matched.slice(0, 10)
      };
    });
    results.sort(function (a, b) { return b.composite - a.composite; });
    return results;
  }

  // ---- team assembly (weighted maximum coverage, greedy) -----------------

  function rfpConceptStrengths(profiles, rfpAnalysis, corpus) {
    // For each RFP concept, raw strength (tf*idf) per scholar and the pool max.
    var rfpTerms = Object.keys(rfpAnalysis.tf).filter(function (t) { return rfpAnalysis.tf[t] > 0; });
    var vectors = profiles.map(function (p) { return vectorize(effectiveTf(p), corpus); });
    var poolMax = Object.create(null);
    rfpTerms.forEach(function (t) {
      var mx = 0;
      vectors.forEach(function (v) { if (v[t] > mx) mx = v[t]; });
      poolMax[t] = mx;
    });
    return { rfpTerms: rfpTerms, vectors: vectors, poolMax: poolMax };
  }

  function memberNorm(vec, term, poolMax) {
    if (!poolMax[term]) return 0;
    return Math.min(1, (vec[term] || 0) / poolMax[term]);
  }

  function coverageValue(memberVectors, rfpAnalysis, ctx) {
    // Sum over RFP concepts of rfpWeight * (best member normalised strength).
    var totalWeight = 0, covered = 0;
    var perTerm = {};
    ctx.rfpTerms.forEach(function (t) {
      var w = rfpAnalysis.tf[t];
      totalWeight += w;
      var best = 0;
      memberVectors.forEach(function (v) { var s = memberNorm(v, t, ctx.poolMax); if (s > best) best = s; });
      covered += w * best;
      perTerm[t] = best;
    });
    return { value: covered, fraction: totalWeight > 0 ? covered / totalWeight : 0, perTerm: perTerm, totalWeight: totalWeight };
  }

  /*
   * Greedy team assembly maximising RFP coverage.
   * opts: { size, relevanceFloor }
   */
  function assembleTeam(profiles, rfpAnalysis, opts, corpus) {
    opts = Object.assign({ size: 4, relevanceFloor: 0.03 }, opts || {});
    corpus = corpus || buildCorpus(profiles, [rfpAnalysis.tf]);
    var ctx = rfpConceptStrengths(profiles, rfpAnalysis, corpus);
    var rfpVec = vectorize(rfpAnalysis.tf, corpus);

    // Precompute relevance to filter out irrelevant candidates.
    var candidates = profiles.map(function (p, idx) {
      return { p: p, idx: idx, vec: ctx.vectors[idx], relevance: cosine(ctx.vectors[idx], rfpVec) };
    }).filter(function (c) { return c.relevance >= opts.relevanceFloor; });
    if (candidates.length === 0) candidates = profiles.map(function (p, idx) {
      return { p: p, idx: idx, vec: ctx.vectors[idx], relevance: cosine(ctx.vectors[idx], rfpVec) };
    });

    var team = [];
    var chosenVecs = [];
    var lastValue = 0;
    var contributions = []; // parallel to team: {term, gain}
    while (team.length < opts.size && candidates.length) {
      var best = null, bestGain = 0, bestCov = null;
      candidates.forEach(function (c) {
        var cov = coverageValue(chosenVecs.concat([c.vec]), rfpAnalysis, ctx);
        var gain = cov.value - lastValue;
        if (gain > bestGain || best === null) { best = c; bestGain = gain; bestCov = cov; }
      });
      if (!best || bestGain <= 1e-9 && team.length > 0) break;
      // Record what this member newly contributes.
      var prevCov = coverageValue(chosenVecs, rfpAnalysis, ctx);
      var newlyCovered = ctx.rfpTerms.map(function (t) {
        return { term: t, gain: (bestCov.perTerm[t] - (prevCov.perTerm[t] || 0)) * rfpAnalysis.tf[t] };
      }).filter(function (x) { return x.gain > 1e-6; }).sort(function (a, b) { return b.gain - a.gain; });
      team.push(best);
      chosenVecs.push(best.vec);
      contributions.push(newlyCovered.slice(0, 6));
      lastValue = bestCov.value;
      candidates = candidates.filter(function (c) { return c !== best; });
    }

    var members = team.map(function (t, i) {
      return { profile: t.p, relevance: t.relevance, contributes: contributions[i].map(function (x) { return { term: x.term, category: categoryOf(t.p, x.term), gain: x.gain }; }) };
    });
    var metrics = teamMetrics(team.map(function (t) { return t.vec; }), team.map(function (t) { return t.p; }), rfpAnalysis, ctx);
    var gaps = gapAnalysis(rfpAnalysis, ctx, chosenVecs);
    return {
      members: members,
      coverage: metrics.coverage,
      complementarity: metrics.complementarity,
      redundancy: metrics.redundancy,
      bridge: metrics.bridge,
      interdisciplinarity: metrics.interdisciplinarity,
      disciplines: metrics.disciplines,
      teamFit: metrics.teamFit,
      gaps: gaps
    };
  }

  function teamMetrics(vecs, profs, rfpAnalysis, ctx) {
    var cov = coverageValue(vecs, rfpAnalysis, ctx);
    // Pairwise cosine → redundancy; complementarity is its inverse.
    var pairs = 0, simSum = 0, bridgePairs = 0;
    for (var i = 0; i < vecs.length; i++) {
      for (var j = i + 1; j < vecs.length; j++) {
        var s = cosine(vecs[i], vecs[j]);
        simSum += s; pairs++;
        // A usable "bridge" is some shared vocabulary but not near-identity.
        if (s > 0.04 && s < 0.6) bridgePairs++;
      }
    }
    var redundancy = pairs ? simSum / pairs : 0;
    var complementarity = 1 - redundancy;
    var bridge = pairs ? bridgePairs / pairs : (vecs.length === 1 ? 1 : 0);
    // Distinct disciplines represented.
    var disc = {};
    profs.forEach(function (p) {
      Object.keys(p.capabilities || {}).forEach(function (c) { if (p.capabilities[c].category === 'discipline') disc[c] = true; });
    });
    var disciplines = Object.keys(disc);
    var interdisc = disciplines.length;
    // Overall team fit: coverage rewarded, with a complementarity multiplier.
    var teamFit = cov.fraction * (0.6 + 0.4 * complementarity);
    return {
      coverage: cov.fraction, complementarity: complementarity, redundancy: redundancy,
      bridge: bridge, interdisciplinarity: interdisc, disciplines: disciplines, teamFit: teamFit
    };
  }

  // ---- gap analysis ------------------------------------------------------

  function gapAnalysis(rfpAnalysis, ctx, memberVectors) {
    // Requirement r is a gap for the given member set (or pool if memberVectors omitted)
    // when the best available normalised strength is below a threshold.
    var THRESH = 0.15;
    var scope = memberVectors || ctx.vectors;
    var gaps = [];
    ctx.rfpTerms.forEach(function (t) {
      var best = 0;
      scope.forEach(function (v) { var s = memberNorm(v, t, ctx.poolMax); if (s > best) best = s; });
      var poolBest = 0;
      ctx.vectors.forEach(function (v) { var s = memberNorm(v, t, ctx.poolMax); if (s > poolBest) poolBest = s; });
      var noOneInPool = ctx.poolMax[t] === 0;
      if (best < THRESH) {
        gaps.push({
          term: t, weight: rfpAnalysis.tf[t], category: (rfpAnalysis.concepts[t] || {}).category || 'phrase',
          bestStrength: best, existsInPool: !noOneInPool && poolBest >= THRESH, noOneInPool: noOneInPool
        });
      }
    });
    gaps.sort(function (a, b) { return b.weight - a.weight; });
    return gaps;
  }

  function poolGapAnalysis(profiles, rfpAnalysis, corpus) {
    corpus = corpus || buildCorpus(profiles, [rfpAnalysis.tf]);
    var ctx = rfpConceptStrengths(profiles, rfpAnalysis, corpus);
    return gapAnalysis(rfpAnalysis, ctx, ctx.vectors).filter(function (g) { return g.noOneInPool; });
  }

  // ---- bridge scholars (pool-level connectors) ---------------------------

  function bridgeScholars(profiles, corpus) {
    corpus = corpus || buildCorpus(profiles);
    var vecs = profiles.map(function (p) { return vectorize(effectiveTf(p), corpus); });
    var scores = profiles.map(function (p, i) {
      var sum = 0, links = 0;
      for (var j = 0; j < profiles.length; j++) {
        if (i === j) continue;
        var s = cosine(vecs[i], vecs[j]);
        sum += s;
        if (s > 0.05 && s < 0.6) links++; // meaningful-but-not-redundant links
      }
      return { profile: p, centrality: profiles.length > 1 ? sum / (profiles.length - 1) : 0, bridges: links };
    });
    // A good connector links to many people at moderate similarity.
    scores.sort(function (a, b) { return (b.bridges + b.centrality) - (a.bridges + a.centrality); });
    return scores;
  }

  // ---- complementary pairs and teams (team mode, no RFP) -----------------

  function complementaryPairs(profiles, corpus, limit) {
    corpus = corpus || buildCorpus(profiles);
    // Unit-normalise so a longer CV does not masquerade as more complementary.
    var vecs = profiles.map(function (p) { return normalizeVec(vectorize(effectiveTf(p), corpus)); });
    var pairs = [];
    for (var i = 0; i < profiles.length; i++) {
      for (var j = i + 1; j < profiles.length; j++) {
        var a = vecs[i], b = vecs[j];
        var unionMass = 0, overlapMass = 0;
        var keys = {}; Object.keys(a).forEach(function (k) { keys[k] = 1; }); Object.keys(b).forEach(function (k) { keys[k] = 1; });
        Object.keys(keys).forEach(function (k) {
          var av = a[k] || 0, bv = b[k] || 0;
          unionMass += Math.max(av, bv); overlapMass += Math.min(av, bv);
        });
        var sim = cosine(a, b);
        // Complementarity: broad combined coverage, with enough shared ground
        // to collaborate but not so much they are redundant.
        var bridgeFactor = sim > 0.03 && sim < 0.55 ? 1 : (sim >= 0.55 ? 0.4 : 0.6);
        var score = unionMass * bridgeFactor * (1 - 0.5 * sim);
        pairs.push({ a: profiles[i], b: profiles[j], similarity: sim, unionMass: unionMass, overlap: overlapMass, score: score });
      }
    }
    pairs.sort(function (x, y) { return y.score - x.score; });
    return limit ? pairs.slice(0, limit) : pairs;
  }

  // Greedy complementary team of a given size around an optional seed (team mode).
  function complementaryTeam(profiles, opts, corpus) {
    opts = Object.assign({ size: 3, seedId: null }, opts || {});
    corpus = corpus || buildCorpus(profiles);
    var vecs = {}; profiles.forEach(function (p) { vecs[p.id] = normalizeVec(vectorize(effectiveTf(p), corpus)); });
    var chosen = [];
    if (opts.seedId) { var seed = profiles.filter(function (p) { return p.id === opts.seedId; })[0]; if (seed) chosen.push(seed); }
    if (!chosen.length) {
      // Seed with the highest-mass (most-specified) scholar.
      var seeded = profiles.slice().sort(function (a, b) { return norm(vecs[b.id]) - norm(vecs[a.id]); })[0];
      if (seeded) chosen.push(seeded);
    }
    function unionVec(members) {
      var u = {}; members.forEach(function (m) { var v = vecs[m.id]; for (var k in v) u[k] = Math.max(u[k] || 0, v[k]); }); return u;
    }
    while (chosen.length < opts.size) {
      var cur = unionVec(chosen);
      var curMass = 0; for (var k in cur) curMass += cur[k];
      var best = null, bestGain = -1;
      profiles.forEach(function (p) {
        if (chosen.indexOf(p) !== -1) return;
        var u = unionVec(chosen.concat([p]));
        var mass = 0; for (var kk in u) mass += u[kk];
        var gain = mass - curMass;
        // Require some bridge to at least one member.
        var maxSim = 0; chosen.forEach(function (m) { var s = cosine(vecs[p.id], vecs[m.id]); if (s > maxSim) maxSim = s; });
        var bridgeOk = maxSim > 0.03;
        var adj = gain * (bridgeOk ? 1 : 0.5);
        if (adj > bestGain) { bestGain = adj; best = p; }
      });
      if (!best) break;
      chosen.push(best);
    }
    var metrics = teamMetricsNoRfp(chosen.map(function (m) { return vecs[m.id]; }), chosen);
    return { members: chosen, metrics: metrics };
  }

  function teamMetricsNoRfp(vecs, profs) {
    var pairs = 0, simSum = 0;
    for (var i = 0; i < vecs.length; i++) for (var j = i + 1; j < vecs.length; j++) { simSum += cosine(vecs[i], vecs[j]); pairs++; }
    var redundancy = pairs ? simSum / pairs : 0;
    var disc = {};
    profs.forEach(function (p) { Object.keys(p.capabilities || {}).forEach(function (c) { if (p.capabilities[c].category === 'discipline') disc[c] = true; }); });
    return { complementarity: 1 - redundancy, redundancy: redundancy, interdisciplinarity: Object.keys(disc).length, disciplines: Object.keys(disc) };
  }

  // ---- collaboration topic suggestions (local) ---------------------------

  function distinctiveConcepts(member, otherProfiles, corpus, k) {
    var mv = normalizeVec(vectorize(effectiveTf(member), corpus));
    var others = otherProfiles.map(function (p) { return normalizeVec(vectorize(effectiveTf(p), corpus)); });
    var scored = Object.keys(mv).map(function (t) {
      var otherMax = 0; others.forEach(function (o) { if ((o[t] || 0) > otherMax) otherMax = o[t]; });
      var cat = categoryOf(member, t);
      // Prefer contentful categories and readable multi-word phrases.
      var catBoost = (cat === 'method' || cat === 'theme' || cat === 'discipline' || cat === 'infrastructure') ? 1.4 : 1.0;
      return { term: t, category: cat, distinct: (mv[t] - 0.6 * otherMax) * catBoost };
    }).filter(function (x) { return x.distinct > 0; });
    scored.sort(function (a, b) { return b.distinct - a.distinct; });
    return scored.slice(0, k || 3);
  }

  function sharedConcepts(members, corpus, k) {
    var counts = {}; var termCat = {};
    members.forEach(function (m) {
      var v = vectorize(effectiveTf(m), corpus);
      Object.keys(v).forEach(function (t) { var cat = categoryOf(m, t); if (cat === 'funder') return; counts[t] = (counts[t] || 0) + 1; termCat[t] = cat; });
    });
    var shared = Object.keys(counts).filter(function (t) { return counts[t] >= 2; })
      .map(function (t) {
        var cat = termCat[t];
        var meaning = (cat !== 'phrase' ? 1.2 : 0) + (t.indexOf(' ') !== -1 ? 0.5 : 0);
        // Cap the count contribution so a term everyone shares (e.g. a common
        // affiliation) cannot outrank a distinctive, contentful bridge concept.
        return { term: t, category: cat, n: counts[t], rank: meaning * 2 + Math.min(counts[t], 3) };
      });
    shared.sort(function (a, b) { return b.rank - a.rank; });
    return shared.slice(0, k || 5);
  }

  function suggestTopics(members, rfpAnalysis, corpus) {
    corpus = corpus || buildCorpus(members, rfpAnalysis ? [rfpAnalysis.tf] : null);
    if (members.length < 1) return [];
    var distinctByMember = members.map(function (m) {
      return { m: m, d: distinctiveConcepts(m, members.filter(function (x) { return x !== m; }), corpus, 3) };
    });
    var shared = sharedConcepts(members, corpus, 5);
    var themeTerms = [];
    if (rfpAnalysis) {
      themeTerms = (rfpAnalysis.themes || []).slice(0, 3);
      if (!themeTerms.length) {
        themeTerms = Object.keys(rfpAnalysis.tf).sort(function (a, b) { return rfpAnalysis.tf[b] - rfpAnalysis.tf[a]; }).slice(0, 3);
      }
    }
    var topics = [];
    function nameOf(m) { return m.name || 'a scholar'; }
    function firstDistinct(idx) { var d = distinctByMember[idx].d[0]; return d ? d.term : null; }

    // Concept sets per member (excluding funders) for per-pair bridge finding.
    var memberKeys = members.map(function (m) {
      var tf = effectiveTf(m); var set = {};
      Object.keys(tf).forEach(function (t) { if (tf[t] > 0) { var cat = categoryOf(m, t); if (cat !== 'funder') set[t] = { cat: cat, w: tf[t] }; } });
      return set;
    });
    function pairBridge(i, j) {
      var a = memberKeys[i], b = memberKeys[j], best = null, bestScore = -1;
      Object.keys(a).forEach(function (t) {
        if (!b[t]) return;
        var meaning = (a[t].cat !== 'phrase' ? 1.2 : 0) + (t.indexOf(' ') !== -1 ? 0.5 : 0);
        var sc = meaning + Math.min(a[t].w + b[t].w, 4) * 0.1;
        if (sc > bestScore) { bestScore = sc; best = t; }
      });
      return best;
    }

    // 1) Pairwise combinations of distinctive strengths.
    for (var i = 0; i < members.length; i++) {
      for (var j = i + 1; j < members.length && topics.length < 8; j++) {
        var da = firstDistinct(i), db = firstDistinct(j);
        if (!da || !db || da === db) continue;
        var theme = themeTerms.length ? themeTerms[topics.length % themeTerms.length] : null;
        var bridge = pairBridge(i, j);
        var t;
        if (theme) {
          t = 'Combine ' + nameOf(members[i]) + "'s " + titleCase(da) + ' with ' + nameOf(members[j]) + "'s " + titleCase(db) +
            ' to address ' + titleCase(theme) + (bridge ? ', building on their shared ground in ' + titleCase(bridge) : '') + '.';
        } else {
          t = 'A joint line of work uniting ' + titleCase(da) + ' (' + nameOf(members[i]) + ') and ' + titleCase(db) +
            ' (' + nameOf(members[j]) + ')' + (bridge ? ', connected through ' + titleCase(bridge) : '') + '.';
        }
        topics.push({ text: t, rationale: 'Distinctive strengths of two members' + (bridge ? ' with a shared collaboration bridge' : '') + '.' });
      }
    }

    // 2) Whole-team integrative topic tied to the RFP's leading requirement.
    if (members.length >= 2) {
      var strengths = distinctByMember.map(function (x, idx) { return x.d[0] ? titleCase(x.d[0].term) : null; }).filter(Boolean);
      strengths = strengths.filter(function (v, idx, arr) { return arr.indexOf(v) === idx; });
      if (strengths.length >= 2) {
        var target = themeTerms[0] ? titleCase(themeTerms[0]) : (shared[0] ? titleCase(shared[0].term) : 'a shared research problem');
        var list = strengths.length > 2 ? strengths.slice(0, -1).join(', ') + ', and ' + strengths[strengths.length - 1] : strengths.join(' and ');
        topics.push({
          text: 'An integrative program on ' + target + ' that fuses ' + list + ' across the team.',
          rationale: 'Team-level synthesis toward the leading RFP theme.'
        });
      }
    }

    // 3) Bridge-led topic if the team shares a strong common concept.
    if (shared[0] && shared[0].n >= 2) {
      var extend = distinctByMember.map(function (x) { return x.d[0] ? titleCase(x.d[0].term) : null; }).filter(Boolean).slice(0, 2);
      if (extend.length) {
        topics.push({
          text: 'Extend the team\'s common expertise in ' + titleCase(shared[0].term) + ' toward ' + extend.join(' and ') + '.',
          rationale: 'Leverages an existing shared foundation as a low-friction starting collaboration.'
        });
      }
    }
    // Deduplicate and cap.
    var seen = {}; var out = [];
    topics.forEach(function (t) { if (!seen[t.text]) { seen[t.text] = 1; out.push(t); } });
    return out.slice(0, 6);
  }

  GCX.engine = {
    buildCorpus: buildCorpus,
    vectorize: vectorize,
    effectiveTf: effectiveTf,
    cosine: cosine,
    analyzeRFP: analyzeRFP,
    scoreScholarsForRFP: scoreScholarsForRFP,
    assembleTeam: assembleTeam,
    gapAnalysis: gapAnalysis,
    poolGapAnalysis: poolGapAnalysis,
    bridgeScholars: bridgeScholars,
    complementaryPairs: complementaryPairs,
    complementaryTeam: complementaryTeam,
    suggestTopics: suggestTopics,
    distinctiveConcepts: distinctiveConcepts,
    sharedConcepts: sharedConcepts,
    titleCase: titleCase
  };
})(typeof window !== 'undefined' ? (window.GCX = window.GCX || {}) : (globalThis.GCX = globalThis.GCX || {}));
