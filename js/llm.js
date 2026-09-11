/*
 * llm.js — OPTIONAL enhancement layer. It ships disabled. The application is
 * fully functional without it; nothing here runs unless the user configures
 * a provider and turns the layer on in Settings.
 *
 * What it can add, when enabled, and where each shows up:
 *   - Cleaner structured extraction from messy CV text, plus a one-sentence
 *     profile summary (Roster: "Enhance tags with AI").
 *   - Richer, less templated collaboration-topic proposals for an assembled
 *     team (RFP Talent Search, and Team Explorer's complementary-team mode).
 *   - Concrete guidance on closing roster-level capacity gaps: what kind of
 *     partner or hire would fill a specific unmet requirement (RFP Talent
 *     Search's capacity-gap list).
 *   - A short fit rationale and proposal angle for each of a scholar's
 *     top Find Funding matches.
 *
 * Every one of these sends only capability-level data (grouped tags, gap
 * terms, public opportunity text) rather than raw CV text; enhanceProfile is
 * the sole exception, gated by its own separate "allow CV text" consent
 * checkbox in Settings.
 *
 * Providers supported, and why there are only two code paths for six of them:
 * Anthropic's Messages API has its own request/response shape, so it gets a
 * dedicated branch. Every other provider listed here — OpenAI, Google Gemini,
 * xAI's Grok, a locally-running Ollama, or anything else — now exposes (or
 * has always exposed) an OpenAI-compatible /chat/completions endpoint, so
 * they all share one code path and differ only in their base URL and whether
 * a real API key is required (Ollama's isn't; it ignores whatever string you
 * send). Anthropic-compat-endpoint details, and each vendor's actual base
 * URL, are the kind of thing that changes, so PROVIDERS below is the one
 * place to update if a vendor moves theirs.
 *
 * Design principles:
 *   - Bring-your-own-key. The key is stored only in this browser (IndexedDB)
 *     and is sent only to the provider endpoint the user selected.
 *   - Explicit consent. Callers must check isEnabled() first; the UI makes the
 *     privacy tradeoff visible before any CV text is transmitted.
 */
(function (GCX) {
  'use strict';

  // Single source of truth for provider defaults, shared by llm.js and the
  // Settings UI (js/app.js reads PROVIDERS rather than duplicating this list).
  // "family" picks the request/response shape: 'anthropic' or 'openai'
  // (OpenAI-compatible chat/completions, which most providers now speak).
  var PROVIDERS = {
    anthropic: { label: 'Anthropic (Claude)', family: 'anthropic', defaultBaseUrl: '', modelPlaceholder: 'claude-3-5-haiku-latest', defaultModel: 'claude-3-5-haiku-latest', keyRequired: true },
    openai: { label: 'OpenAI', family: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', modelPlaceholder: 'gpt-4o-mini', defaultModel: 'gpt-4o-mini', keyRequired: true },
    gemini: { label: 'Google Gemini', family: 'openai', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', modelPlaceholder: 'gemini-2.5-flash', defaultModel: 'gemini-2.5-flash', keyRequired: true },
    grok: { label: 'xAI (Grok)', family: 'openai', defaultBaseUrl: 'https://api.x.ai/v1', modelPlaceholder: 'grok-4-fast', defaultModel: 'grok-4-fast', keyRequired: true },
    ollama: { label: 'Ollama (local, no key needed)', family: 'openai', defaultBaseUrl: 'http://localhost:11434/v1', modelPlaceholder: 'llama3.2', defaultModel: 'llama3.2', keyRequired: false },
    custom: { label: 'Other (OpenAI-compatible)', family: 'openai', defaultBaseUrl: '', modelPlaceholder: 'model name for your endpoint', defaultModel: '', keyRequired: true }
  };

  var DEFAULT = {
    enabled: false,
    provider: 'anthropic',        // one of the PROVIDERS keys above
    apiKey: '',
    model: 'claude-3-5-haiku-latest',
    baseUrl: '',                  // overrides the provider's defaultBaseUrl when set
    allowCvText: false            // extra explicit consent to send CV text
  };

  var cache = null;

  function getConfig() {
    if (cache) return Promise.resolve(cache);
    if (!GCX.store) { cache = Object.assign({}, DEFAULT); return Promise.resolve(cache); }
    return GCX.store.getSetting('llm', null).then(function (v) {
      cache = Object.assign({}, DEFAULT, v || {});
      return cache;
    });
  }

  function setConfig(cfg) {
    cache = Object.assign({}, DEFAULT, cfg || {});
    return GCX.store ? GCX.store.setSetting('llm', cache) : Promise.resolve(cache);
  }

  function presetFor(cfg) { return PROVIDERS[cfg && cfg.provider] || PROVIDERS.anthropic; }

  // Ollama's OpenAI-compatible endpoint requires a non-empty Authorization
  // value but doesn't check it, so an empty key there is not a missing key.
  function effectiveApiKey(cfg) {
    if (cfg.apiKey) return cfg.apiKey;
    return presetFor(cfg).keyRequired === false ? 'local' : '';
  }

  function baseUrlFor(cfg) {
    if (cfg.baseUrl && cfg.baseUrl.trim()) return cfg.baseUrl.trim().replace(/\/+$/, '');
    return presetFor(cfg).defaultBaseUrl || 'https://api.openai.com/v1';
  }

  function isEnabled() { return !!(cache && cache.enabled && effectiveApiKey(cache)); }

  function extractJson(text) {
    if (!text) return null;
    // Tolerate code fences and surrounding prose.
    var m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    var body = m ? m[1] : text;
    var start = body.indexOf('{'); var startA = body.indexOf('[');
    if (startA !== -1 && (start === -1 || startA < start)) start = startA;
    if (start === -1) return null;
    for (var end = body.length; end > start; end--) {
      try { return JSON.parse(body.slice(start, end)); } catch (e) { /* keep trimming */ }
    }
    return null;
  }

  // Low-level completion. Returns plain text. Throws on failure.
  function complete(prompt, opts) {
    opts = opts || {};
    return getConfig().then(function (cfg) {
      var key = effectiveApiKey(cfg);
      if (!key) throw new Error('No API key configured.');
      if (presetFor(cfg).family === 'openai') {
        return fetch(baseUrlFor(cfg) + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model: cfg.model || presetFor(cfg).defaultModel, max_tokens: opts.maxTokens || 1024, temperature: opts.temperature != null ? opts.temperature : 0.4,
            messages: [{ role: 'system', content: opts.system || 'You are a careful research-development analyst.' }, { role: 'user', content: prompt }]
          })
        }).then(handle).then(function (j) { return j.choices[0].message.content; }).catch(function (e) {
          if (cfg.provider === 'ollama' && e instanceof TypeError) {
            throw new Error('Could not reach Ollama at ' + baseUrlFor(cfg) + '. Make sure `ollama serve` is running, and that OLLAMA_ORIGINS allows this page\u2019s origin (Ollama allows localhost by default, so this usually just works if the app itself is also running locally; a hosted copy of the app needs OLLAMA_ORIGINS set explicitly).');
          }
          throw e;
        });
      }
      // Anthropic Messages API.
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: cfg.model || presetFor(cfg).defaultModel, max_tokens: opts.maxTokens || 1024,
          system: opts.system || 'You are a careful research-development analyst.',
          messages: [{ role: 'user', content: prompt }]
        })
      }).then(handle).then(function (j) { return (j.content || []).map(function (b) { return b.text || ''; }).join(''); });
    });
  }

  function handle(res) {
    if (!res.ok) {
      return res.text().then(function (t) {
        var msg = 'API error ' + res.status;
        try { var j = JSON.parse(t); if (j.error) msg += ': ' + (j.error.message || j.error.type || ''); } catch (e) { if (t) msg += ': ' + t.slice(0, 200); }
        if (res.status === 0 || res.status === 403) msg += ' (a browser CORS restriction may be blocking this provider; some endpoints require a proxy).';
        throw new Error(msg);
      });
    }
    return res.json();
  }

  // ---- higher-level helpers ---------------------------------------------

  // Improve a profile's tags from its raw text. Returns {tags, summary}.
  function enhanceProfile(profile) {
    if (!isEnabled() || !cache.allowCvText) return Promise.reject(new Error('LLM layer or CV-text consent is disabled.'));
    var prompt = 'From the following academic CV, extract the scholar\'s core research expertise as a JSON object with keys ' +
      '"methods" (research methods/techniques), "topics" (substantive research areas), "domains" (disciplines), ' +
      '"infrastructure" (facilities, datasets, equipment, partnerships), and "summary" (one sentence). ' +
      'Use short canonical phrases, lowercase, no duplicates. Return only JSON.\n\nCV:\n' + profile.rawText.slice(0, 12000);
    return complete(prompt, { system: 'You extract structured research capabilities from CVs. Output only valid JSON.', maxTokens: 900, temperature: 0.1 })
      .then(function (txt) {
        var j = extractJson(txt) || {};
        var tags = [].concat(j.methods || [], j.topics || [], j.domains || [], j.infrastructure || [])
          .filter(function (x) { return typeof x === 'string' && x.trim(); })
          .map(function (x) { return x.trim().toLowerCase(); });
        return { tags: Array.from(new Set(tags)), summary: j.summary || '' };
      });
  }

  // Richer collaboration topics for a set of members, optionally toward an RFP.
  function richTopics(members, rfpText, localTopics) {
    if (!isEnabled()) return Promise.reject(new Error('LLM layer is disabled.'));
    var roster = members.map(function (m) {
      var caps = GCX.extract ? GCX.extract.groupCapabilities(m) : { method: [], discipline: [], theme: [] };
      return '- ' + (m.name || 'Scholar') + ': ' +
        (caps.discipline || []).map(function (c) { return c.term; }).slice(0, 3).join(', ') + ' | ' +
        (caps.method || []).map(function (c) { return c.term; }).slice(0, 5).join(', ') +
        (m.affiliation ? ' (' + m.affiliation + ')' : '');
    }).join('\n');
    var prompt = 'You are helping assemble a research team. Here are the members and their expertise:\n' + roster +
      (rfpText ? '\n\nThey are responding to this funding opportunity:\n' + rfpText.slice(0, 4000) : '') +
      '\n\nPropose 4 to 6 specific, fundable collaborative research directions that genuinely require combining these ' +
      'people\'s complementary strengths (not work any one of them could do alone). For each, give a one-line title and ' +
      'two sentences on the idea and who does what. Return JSON: an array of objects with keys "title" and "detail".';
    return complete(prompt, { system: 'You are a seasoned research-development officer who writes concrete, credible collaboration proposals.', maxTokens: 1400, temperature: 0.6 })
      .then(function (txt) {
        var j = extractJson(txt);
        if (Array.isArray(j)) return j.filter(function (x) { return x && x.title; });
        return (localTopics || []).map(function (t) { return { title: t.text, detail: t.rationale }; });
      });
  }

  // Guidance on roster-level capacity gaps: for each unmet RFP requirement,
  // suggest concretely how to close it (a type of external partner, or what
  // a targeted hire's expertise should look like). Only the gap terms and the
  // RFP text are sent, same privacy footprint as richTopics above; no CV text.
  function explainGaps(gaps, rfpText) {
    if (!isEnabled()) return Promise.reject(new Error('LLM layer is disabled.'));
    if (!gaps || !gaps.length) return Promise.resolve([]);
    var list = gaps.slice(0, 10).map(function (g) { return '- ' + (g.term || g); }).join('\n');
    var prompt = 'A research roster was scored against a funding opportunity. These requirements are NOT covered by ' +
      'anyone currently in the roster:\n' + list +
      (rfpText ? '\n\nOpportunity context:\n' + rfpText.slice(0, 3000) : '') +
      '\n\nFor each uncovered requirement, suggest in two sentences how a research office might realistically close it: ' +
      'the kind of external partner or collaborator to seek, or what a targeted hire\'s expertise should look like. Be ' +
      'concrete rather than generic. Return JSON: an array of objects with keys "title" (the requirement) and "detail" ' +
      '(the suggestion), one per requirement, in the order given.';
    return complete(prompt, { system: 'You are a research-development officer advising on how to close specific capability gaps.', maxTokens: 1000, temperature: 0.4 })
      .then(function (txt) {
        var j = extractJson(txt);
        return Array.isArray(j) ? j.filter(function (x) { return x && x.title; }) : [];
      });
  }

  // Rationale for a scholar's top-ranked Find Funding matches: only the
  // scholar's grouped capabilities (never raw CV text) plus the public
  // opportunity text are sent, so no extra consent beyond the general AI
  // toggle is required, matching richTopics's privacy footprint.
  function explainMatches(profile, ranked, keywords) {
    if (!isEnabled()) return Promise.reject(new Error('LLM layer is disabled.'));
    if (!ranked || !ranked.length) return Promise.resolve([]);
    var caps = GCX.extract ? GCX.extract.groupCapabilities(profile) : { method: [], discipline: [] };
    var capLine = (caps.discipline || []).map(function (c) { return c.term; }).slice(0, 3).join(', ') + '; methods: ' +
      (caps.method || []).map(function (c) { return c.term; }).slice(0, 6).join(', ');
    var top = ranked.slice(0, 5);
    var oppList = top.map(function (r, i) {
      var o = r.opportunity;
      return (i + 1) + '. "' + o.title + '" (' + (o.agency || 'unknown agency') + ', closes ' + (o.closeDate || 'unknown') + '): ' +
        (o.text || '').slice(0, 800);
    }).join('\n\n');
    var prompt = 'A scholar has this expertise: ' + capLine + ' (searched using the terms: ' + (keywords || []).join(', ') + ').\n\n' +
      'Here are candidate funding opportunities, already ranked by an automated topical match:\n\n' + oppList +
      '\n\nFor each opportunity, in order, write two sentences: whether it is a strong fit and why, and one concrete idea ' +
      'for how this scholar could frame a proposal to it. Return JSON: an array of objects with keys "title" (matching the ' +
      'opportunity title given) and "detail", in the same order as given.';
    return complete(prompt, { system: 'You are a research-development officer helping a scholar decide which funding calls to pursue.', maxTokens: 1200, temperature: 0.5 })
      .then(function (txt) {
        var j = extractJson(txt);
        return Array.isArray(j) ? j.filter(function (x) { return x && x.title; }) : [];
      });
  }

  function testConnection() {
    return complete('Reply with the single word: ok', { maxTokens: 16, temperature: 0 })
      .then(function (t) { return { ok: true, text: (t || '').trim() }; });
  }

  GCX.llm = {
    DEFAULT: DEFAULT,
    PROVIDERS: PROVIDERS,
    getConfig: getConfig,
    setConfig: setConfig,
    isEnabled: isEnabled,
    complete: complete,
    enhanceProfile: enhanceProfile,
    richTopics: richTopics,
    explainGaps: explainGaps,
    explainMatches: explainMatches,
    testConnection: testConnection,
    _extractJson: extractJson
  };
})(typeof window !== 'undefined' ? (window.GCX = window.GCX || {}) : (globalThis.GCX = globalThis.GCX || {}));
