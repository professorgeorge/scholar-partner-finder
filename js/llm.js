/*
 * llm.js — OPTIONAL enhancement layer. It ships disabled. The application is
 * fully functional without it; nothing here runs unless the user pastes their
 * own API key and turns the layer on in Settings.
 *
 * What it can add, when enabled:
 *   - Cleaner structured extraction from messy CV text (better tags).
 *   - Richer, less templated collaboration-topic proposals.
 *   - A short narrative rationale for a proposed team.
 *
 * Design principles:
 *   - Bring-your-own-key. The key is stored only in this browser (IndexedDB)
 *     and is sent only to the provider endpoint the user selected.
 *   - Explicit consent. Callers must check isEnabled() first; the UI makes the
 *     privacy tradeoff visible before any CV text is transmitted.
 *   - Provider-agnostic: Anthropic Messages API, or any OpenAI-compatible
 *     chat-completions endpoint (OpenAI, Azure, local servers, gateways).
 */
(function (SPF) {
  'use strict';

  var DEFAULT = {
    enabled: false,
    provider: 'anthropic',        // 'anthropic' | 'openai'
    apiKey: '',
    model: 'claude-3-5-haiku-latest',
    baseUrl: '',                  // for openai-compatible custom endpoints
    allowCvText: false            // extra explicit consent to send CV text
  };

  var cache = null;

  function getConfig() {
    if (cache) return Promise.resolve(cache);
    if (!SPF.store) { cache = Object.assign({}, DEFAULT); return Promise.resolve(cache); }
    return SPF.store.getSetting('llm', null).then(function (v) {
      cache = Object.assign({}, DEFAULT, v || {});
      return cache;
    });
  }

  function setConfig(cfg) {
    cache = Object.assign({}, DEFAULT, cfg || {});
    return SPF.store ? SPF.store.setSetting('llm', cache) : Promise.resolve(cache);
  }

  function isEnabled() { return !!(cache && cache.enabled && cache.apiKey); }

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
      if (!cfg.apiKey) throw new Error('No API key configured.');
      if (cfg.provider === 'openai') {
        var base = cfg.baseUrl && cfg.baseUrl.trim() ? cfg.baseUrl.replace(/\/+$/, '') : 'https://api.openai.com/v1';
        return fetch(base + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
          body: JSON.stringify({
            model: cfg.model, max_tokens: opts.maxTokens || 1024, temperature: opts.temperature != null ? opts.temperature : 0.4,
            messages: [{ role: 'system', content: opts.system || 'You are a careful research-development analyst.' }, { role: 'user', content: prompt }]
          })
        }).then(handle).then(function (j) { return j.choices[0].message.content; });
      }
      // Default: Anthropic Messages API.
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: cfg.model, max_tokens: opts.maxTokens || 1024,
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
      var caps = SPF.extract ? SPF.extract.groupCapabilities(m) : { method: [], discipline: [], theme: [] };
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

  function testConnection() {
    return complete('Reply with the single word: ok', { maxTokens: 16, temperature: 0 })
      .then(function (t) { return { ok: true, text: (t || '').trim() }; });
  }

  SPF.llm = {
    DEFAULT: DEFAULT,
    getConfig: getConfig,
    setConfig: setConfig,
    isEnabled: isEnabled,
    complete: complete,
    enhanceProfile: enhanceProfile,
    richTopics: richTopics,
    testConnection: testConnection,
    _extractJson: extractJson
  };
})(typeof window !== 'undefined' ? (window.SPF = window.SPF || {}) : (globalThis.SPF = globalThis.SPF || {}));
