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
    provider: 'anthropic',        // key of PROVIDERS below
    apiKey: '',
    model: '',                    // blank means "use the provider's default"
    baseUrl: '',                  // override for openai-compatible / local endpoints
    allowCvText: false            // extra explicit consent to send CV text
  };

  /*
   * Provider registry. Three request styles are supported:
   *   - 'anthropic': the Anthropic Messages API.
   *   - 'openai':    any OpenAI-compatible /chat/completions endpoint. Most
   *                  providers below (OpenAI, xAI Grok, Groq, OpenRouter, a
   *                  local Ollama server, and custom gateways) share this shape,
   *                  differing only in base URL, default model, and whether a
   *                  key is required.
   *   - 'gemini':    Google's Generative Language generateContent endpoint.
   *
   * `keyless` marks a provider (Ollama) that needs no API key. `editableBase`
   * controls whether the Settings UI exposes a Base URL field. `hint` is shown
   * under the provider picker. Model names drift over time, so each is only a
   * sensible default the user can override.
   */
  var PROVIDERS = {
    anthropic: {
      label: 'Anthropic (Claude)', style: 'anthropic', baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-haiku-latest', keyless: false, editableBase: false,
      hint: 'Key from console.anthropic.com. Browser access uses Anthropic’s direct-access header.'
    },
    gemini: {
      label: 'Google Gemini (free tier)', style: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-1.5-flash', keyless: false, editableBase: false,
      hint: 'Free tier: create a key at aistudio.google.com/apikey. Works directly from the browser.'
    },
    groq: {
      label: 'Groq (free tier, fast)', style: 'openai', baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.1-8b-instant', keyless: false, editableBase: false,
      hint: 'Free API key at console.groq.com/keys. Fast, OpenAI-compatible. Browsers with CORS restrictions may need a proxy.'
    },
    openrouter: {
      label: 'OpenRouter (free models)', style: 'openai', baseUrl: 'https://openrouter.ai/api/v1',
      model: 'meta-llama/llama-3.1-8b-instruct:free', keyless: false, editableBase: false,
      hint: 'Key at openrouter.ai/keys. Many free models (slugs ending in :free) are listed at openrouter.ai/models.'
    },
    grok: {
      label: 'xAI (Grok)', style: 'openai', baseUrl: 'https://api.x.ai/v1',
      model: 'grok-2-latest', keyless: false, editableBase: false,
      hint: 'Key from console.x.ai. OpenAI-compatible endpoint.'
    },
    openai: {
      label: 'OpenAI', style: 'openai', baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini', keyless: false, editableBase: true,
      hint: 'Key from platform.openai.com. Direct browser calls can be blocked by CORS; a gateway or proxy may be needed.'
    },
    ollama: {
      label: 'Ollama (local, no key)', style: 'openai', baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1', keyless: true, editableBase: true,
      hint: 'Runs on your machine, no key needed. Start Ollama with OLLAMA_ORIGINS="*" so the browser may call it. A page served over https (e.g. GitHub Pages) cannot reach http://localhost — open a local copy over http for Ollama.'
    },
    custom: {
      label: 'OpenAI-compatible (custom)', style: 'openai', baseUrl: 'https://api.openai.com/v1',
      model: '', keyless: false, editableBase: true,
      hint: 'Any OpenAI-compatible endpoint (Azure, LM Studio, a gateway). Set the Base URL and model.'
    }
  };
  function providerOf(id) { return PROVIDERS[id] || PROVIDERS.openai; }

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

  function isEnabled() {
    if (!cache || !cache.enabled) return false;
    return !!(cache.apiKey || providerOf(cache.provider).keyless);
  }

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

  // Low-level completion. Returns plain text. Throws on failure. Routes by the
  // selected provider's request style.
  function complete(prompt, opts) {
    opts = opts || {};
    return getConfig().then(function (cfg) {
      var prov = providerOf(cfg.provider);
      var key = (cfg.apiKey || '').trim();
      if (!prov.keyless && !key) throw new Error('No API key configured.');
      var model = (cfg.model || '').trim() || prov.model;
      if (!model) throw new Error('No model set for this provider.');
      var system = opts.system || 'You are a careful research-development analyst.';
      var maxTokens = opts.maxTokens || 1024;
      var temperature = opts.temperature != null ? opts.temperature : 0.4;
      var base = (cfg.baseUrl && cfg.baseUrl.trim() ? cfg.baseUrl.trim() : prov.baseUrl).replace(/\/+$/, '');

      if (prov.style === 'anthropic') {
        return fetch(base + '/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({ model: model, max_tokens: maxTokens, system: system, messages: [{ role: 'user', content: prompt }] })
        }).then(handle).then(function (j) { return (j.content || []).map(function (b) { return b.text || ''; }).join(''); });
      }

      if (prov.style === 'gemini') {
        var url = base + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
        return fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: maxTokens, temperature: temperature }
          })
        }).then(handle).then(function (j) {
          var c = (j.candidates || [])[0];
          var parts = (c && c.content && c.content.parts) || [];
          return parts.map(function (p) { return p.text || ''; }).join('');
        });
      }

      // Default: OpenAI-compatible /chat/completions (OpenAI, Grok, Groq,
      // OpenRouter, Ollama, custom gateways).
      var headers = { 'Content-Type': 'application/json' };
      if (key) headers['Authorization'] = 'Bearer ' + key;
      if (cfg.provider === 'openrouter') { headers['HTTP-Referer'] = 'https://scholar-partner-finder.app'; headers['X-Title'] = 'Scholar Partner Finder'; }
      return fetch(base + '/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: model, max_tokens: maxTokens, temperature: temperature,
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }]
        })
      }).then(handle).then(function (j) {
        var ch = (j.choices || [])[0];
        return (ch && ch.message && ch.message.content) || '';
      });
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
    PROVIDERS: PROVIDERS,
    providerOf: providerOf,
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
