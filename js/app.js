/*
 * app.js — UI controller. Vanilla JS, classic script, no build step.
 * Depends on the GCX.* modules loaded before it.
 */
(function (GCX) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var pct = function (x) { return Math.round(x * 100); };
  var title = function (s) { return GCX.engine.titleCase(s); };

  var state = { profiles: [], lastRfp: null, lastCorpus: null, lastResults: null, lastTeam: null, lastTopics: null };

  // ---------- toast ----------
  function toast(msg, isErr) {
    var t = el('div', 'toast' + (isErr ? ' err' : ''), esc(msg));
    $('toastWrap').appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 250); }, isErr ? 4200 : 2600);
  }

  // ---------- theme ----------
  function applyTheme(mode) {
    if (mode === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else if (mode === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    if (GCX.store) GCX.store.setSetting('theme', next);
  }

  // ---------- navigation ----------
  function setView(name) {
    ['rfp', 'roster', 'team', 'funding', 'settings'].forEach(function (v) {
      $('view-' + v).classList.toggle('active', v === name);
    });
    Array.prototype.forEach.call($('nav').children, function (b) { b.classList.toggle('active', b.dataset.view === name); });
    if (name === 'team') renderTeamExplorer();
    if (name === 'funding') renderFundingScholarPicker();
  }

  // ---------- avatar ----------
  function avatarColor(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return 'hsl(' + h + ',55%,45%)'; }
  function initials(name) { var p = name.trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }

  // ---------- roster ----------
  function updateCount() {
    $('rosterCount').textContent = state.profiles.length + ' scholar' + (state.profiles.length === 1 ? '' : 's');
    $('rosterSub').textContent = state.profiles.length ? state.profiles.length + ' in library' : '';
    var hint = $('rfpRosterHint');
    if (hint) hint.textContent = state.profiles.length ? '' : 'Your roster is empty. Add CVs under the Roster tab, or load the sample scholars.';
  }

  function renderRoster() {
    var box = $('rosterList'); box.innerHTML = '';
    if (!state.profiles.length) {
      box.appendChild(el('div', 'empty', '<div class="big">📚</div><p>No scholars yet. Drop CV files, paste a CV, or load the samples.</p>'));
      return;
    }
    state.profiles.slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); }).forEach(function (p) {
      var row = el('div', 'scholar-row');
      var av = el('div', 'avatar'); av.style.background = avatarColor(p.name || '?'); av.textContent = initials(p.name || '?');
      var main = el('div', 'scholar-main');
      var g = GCX.extract.groupCapabilities(p);
      var caps = (g.discipline.slice(0, 2).concat(g.method.slice(0, 3))).map(function (c) { return title(c.term); }).join(' · ');
      main.innerHTML = '<div class="name">' + esc(p.name) + (p.edited ? ' <span class="badge green" style="font-size:9px">curated</span>' : '') + '</div>' +
        '<div class="aff">' + esc(p.affiliation || p.sourceFile || '') + '</div>' +
        '<div class="hint" style="margin-top:2px">' + esc(caps || 'No capabilities detected — click to add tags') + '</div>';
      var acts = el('div', 'acts');
      var editBtn = el('button', 'btn ghost small', 'Edit'); editBtn.onclick = function () { openScholar(p); };
      var delBtn = el('button', 'btn ghost small', '✕'); delBtn.title = 'Remove'; delBtn.onclick = function () { removeProfile(p); };
      acts.appendChild(editBtn); acts.appendChild(delBtn);
      row.appendChild(av); row.appendChild(main); row.appendChild(acts);
      row.querySelector('.scholar-main').style.cursor = 'pointer';
      main.onclick = function () { openScholar(p); };
      box.appendChild(row);
    });
  }

  function persist(p) { if (GCX.store && GCX.store.available) return GCX.store.putProfile(p); return Promise.resolve(); }

  function removeProfile(p) {
    state.profiles = state.profiles.filter(function (x) { return x.id !== p.id; });
    if (GCX.store && GCX.store.available) GCX.store.deleteProfile(p.id);
    renderRoster(); updateCount();
  }

  // ---------- file ingestion ----------
  var ACCEPT = /\.(pdf|docx|doc|txt|md|markdown|rtf|html?|json)$/i;

  async function ingestFiles(files) {
    var list = Array.prototype.slice.call(files).filter(function (f) { return ACCEPT.test(f.name); });
    if (!list.length) { toast('No supported files found (PDF, DOCX, TXT, MD, RTF, HTML).', true); return; }
    var added = 0, warned = 0;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      try {
        var parsed = await GCX.parse.parseFile(f);
        if (parsed.warning) { warned++; }
        if (!parsed.text || parsed.text.length < 20) { toast('Little text from ' + f.name + '. ' + (parsed.warning || ''), true); continue; }
        var prof = GCX.extract.buildProfile(parsed.text, { filename: f.name });
        state.profiles.push(prof);
        await persist(prof);
        added++;
      } catch (e) { toast('Failed: ' + f.name + ' — ' + e.message, true); }
    }
    renderRoster(); updateCount();
    if (added) toast('Added ' + added + ' scholar' + (added === 1 ? '' : 's') + (warned ? ' (' + warned + ' with parse warnings)' : ''));
  }

  function addFromText() {
    var txt = $('pasteCv').value.trim();
    if (txt.length < 40) { toast('Paste a longer CV.', true); return; }
    var prof = GCX.extract.buildProfile(txt, { filename: '' });
    state.profiles.push(prof); persist(prof);
    $('pasteCv').value = '';
    renderRoster(); updateCount(); toast('Added ' + prof.name);
    openScholar(prof);
  }

  // ---------- scholar edit modal ----------
  var modalCtx = null;
  function openScholar(p) {
    modalCtx = p;
    $('modalTitle').textContent = 'Edit scholar';
    var g = GCX.extract.groupCapabilities(p);
    var body = $('modalBody'); body.innerHTML = '';
    var f1 = el('label', 'field', '<span>Name</span>'); var i1 = el('input'); i1.type = 'text'; i1.value = p.name || ''; f1.appendChild(i1);
    var f2 = el('label', 'field', '<span>Affiliation</span>'); var i2 = el('input'); i2.type = 'text'; i2.value = p.affiliation || ''; f2.appendChild(i2);
    var f3 = el('label', 'field', '<span>Email</span>'); var i3 = el('input'); i3.type = 'text'; i3.value = p.email || ''; f3.appendChild(i3);
    body.appendChild(f1); body.appendChild(f2); body.appendChild(f3);

    var capWrap = el('div');
    function renderChips() {
      capWrap.innerHTML = '<div class="hint" style="margin-bottom:6px">Detected capabilities — remove anything wrong, and add what is missing. Curated tags are weighted strongly.</div>';
      var cats = [['discipline', 'Disciplines'], ['method', 'Methods'], ['theme', 'Themes'], ['infrastructure', 'Infrastructure'], ['funder', 'Funders']];
      var gg = GCX.extract.groupCapabilities(p);
      cats.forEach(function (c) {
        var items = (gg[c[0]] || []).filter(function (x) { return (p.tagsRemoved || []).indexOf(x.term) === -1; });
        if (!items.length) return;
        var wrap = el('div'); wrap.style.margin = '6px 0';
        wrap.appendChild(el('div', 'hint', c[1]));
        var chips = el('div', 'chips');
        items.forEach(function (it) {
          var chip = el('span', 'chip ' + c[0], esc(title(it.term)) + ' <span class="x">✕</span>');
          chip.querySelector('.x').onclick = function () { p.tagsRemoved = (p.tagsRemoved || []).concat([it.term]); p.edited = true; renderChips(); };
          chips.appendChild(chip);
        });
        wrap.appendChild(chips); capWrap.appendChild(wrap);
      });
      if (p.tagsAdded && p.tagsAdded.length) {
        var wrap2 = el('div'); wrap2.style.margin = '6px 0'; wrap2.appendChild(el('div', 'hint', 'Added by you'));
        var chips2 = el('div', 'chips');
        p.tagsAdded.forEach(function (t) {
          var chip = el('span', 'chip method', esc(title(t)) + ' <span class="x">✕</span>');
          chip.querySelector('.x').onclick = function () { p.tagsAdded = p.tagsAdded.filter(function (x) { return x !== t; }); renderChips(); };
          chips2.appendChild(chip);
        });
        wrap2.appendChild(chips2); capWrap.appendChild(wrap2);
      }
      var addRow = el('div', 'btn-row'); addRow.style.marginTop = '8px';
      var addInput = el('input'); addInput.type = 'text'; addInput.placeholder = 'Add a capability, e.g. remote sensing'; addInput.style.flex = '1';
      var addBtn = el('button', 'btn small', 'Add tag');
      function doAdd() { var v = addInput.value.trim().toLowerCase(); if (!v) return; p.tagsAdded = (p.tagsAdded || []).concat([v]); p.tagsRemoved = (p.tagsRemoved || []).filter(function (x) { return x !== v; }); p.edited = true; addInput.value = ''; renderChips(); }
      addBtn.onclick = doAdd; addInput.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } };
      addRow.appendChild(addInput); addRow.appendChild(addBtn); capWrap.appendChild(addRow);
    }
    renderChips();
    body.appendChild(capWrap);

    if (p.aiSummary) {
      body.insertBefore(el('p', 'hint', '<em>AI summary:</em> ' + esc(p.aiSummary)), capWrap);
    }

    if (GCX.llm && GCX.llm.isEnabled()) {
      var aiBtn = el('button', 'btn secondary small', 'Enhance tags with AI'); aiBtn.style.marginTop = '10px';
      aiBtn.onclick = function () {
        aiBtn.disabled = true; aiBtn.textContent = 'Working...';
        GCX.llm.enhanceProfile(p).then(function (r) {
          p.tagsAdded = Array.from(new Set((p.tagsAdded || []).concat(r.tags))); p.edited = true;
          if (r.summary) p.aiSummary = r.summary;
          openScholar(p); // re-render so the new summary and tags both show
          toast('AI added ' + r.tags.length + ' tags'); aiBtn.disabled = false; aiBtn.textContent = 'Enhance tags with AI';
        }).catch(function (e) { toast(e.message, true); aiBtn.disabled = false; aiBtn.textContent = 'Enhance tags with AI'; });
      };
      body.appendChild(aiBtn);
    }

    var raw = el('details', 'raw', '<summary>View extracted text</summary>');
    raw.appendChild(el('pre', null, esc(p.rawText.slice(0, 8000))));
    body.appendChild(raw);

    var foot = $('modalFooter'); foot.innerHTML = '';
    var save = el('button', 'btn', 'Save changes');
    save.onclick = function () {
      p.name = i1.value.trim() || p.name; p.affiliation = i2.value.trim(); p.email = i3.value.trim(); p.edited = true;
      persist(p); renderRoster(); updateCount(); closeModal(); toast('Saved ' + p.name);
    };
    var cancel = el('button', 'btn secondary', 'Close'); cancel.onclick = closeModal;
    foot.appendChild(cancel); foot.appendChild(save);
    $('modalBackdrop').classList.add('open');
  }
  function closeModal() { $('modalBackdrop').classList.remove('open'); modalCtx = null; }

  // ---------- RFP analysis ----------
  function weights() {
    return { relevance: +$('wRelevance').value, recent: +$('wRecent').value, funding: +$('wFunding').value };
  }
  function analyze() {
    var text = $('rfpText').value.trim();
    if (text.length < 30) { toast('Paste a longer RFP or topic.', true); return; }
    if (!state.profiles.length) { toast('Add scholars to your roster first.', true); setView('roster'); return; }
    var rfp = GCX.engine.analyzeRFP(text);
    var corpus = GCX.engine.buildCorpus(state.profiles, [rfp.tf]);
    var results = GCX.engine.scoreScholarsForRFP(state.profiles, rfp, weights(), corpus);
    var team = GCX.engine.assembleTeam(state.profiles, rfp, { size: +$('teamSize').value }, corpus);
    var poolGaps = GCX.engine.poolGapAnalysis(state.profiles, rfp, corpus);
    var topics = GCX.engine.suggestTopics(team.members.map(function (m) { return m.profile; }), rfp, corpus);
    state.lastRfp = rfp; state.lastCorpus = corpus; state.lastResults = results; state.lastTeam = team; state.lastTopics = topics;
    renderRfpResults(rfp, results, team, poolGaps, topics);
  }

  function conceptChips(list, keyName) {
    return '<div class="chips">' + list.map(function (m) {
      var term = keyName ? m[keyName] : m.term; var cat = m.category || 'phrase';
      return '<span class="chip ' + cat + '">' + esc(title(term)) + '</span>';
    }).join('') + '</div>';
  }

  function renderRfpResults(rfp, results, team, poolGaps, topics) {
    var box = $('rfpResults'); box.innerHTML = '';

    // Team summary metrics
    var teamCard = el('div', 'card pad');
    teamCard.appendChild(el('div', 'section-title', '<h2>Recommended team</h2><span class="sub">Coverage-maximising, ' + team.members.length + ' members</span>'));
    var mrow = el('div', 'metric-row');
    mrow.innerHTML =
      metric('Requirement coverage', pct(team.coverage) + '<small>%</small>') +
      metric('Complementarity', team.complementarity.toFixed(2)) +
      metric('Overlap', team.redundancy.toFixed(2)) +
      metric('Disciplines', String(team.interdisciplinarity)) +
      metric('Team fit', pct(team.teamFit) + '<small>%</small>');
    teamCard.appendChild(mrow);
    team.members.forEach(function (m, i) {
      var d = el('div', 'team-member');
      d.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><span class="rank-num">' + (i + 1) + '</span>' +
        '<strong>' + esc(m.profile.name) + '</strong>' +
        '<span class="faint small" style="margin-left:auto">relevance ' + m.relevance.toFixed(2) + '</span></div>' +
        '<div class="hint" style="margin:6px 0 4px">Adds to the proposal:</div>' +
        conceptChips(m.contributes.slice(0, 6));
      teamCard.appendChild(d);
    });
    if (team.gaps && team.gaps.length) {
      teamCard.appendChild(el('div', 'hint', 'This team still leaves uncovered: ' + team.gaps.slice(0, 6).map(function (g) { return title(g.term); }).join(', ') + '.'));
    }
    box.appendChild(teamCard);

    // Capacity gaps (pool-level)
    var gapCard = el('div', 'card pad'); gapCard.style.marginTop = '16px';
    gapCard.appendChild(el('div', 'section-title', '<h2>Capacity gaps</h2><span class="sub">RFP requirements no one in your roster covers</span>'));
    if (!poolGaps.length) gapCard.appendChild(el('p', 'faint small', 'Your roster covers every detected requirement at least partially. Strong position.'));
    else {
      gapCard.appendChild(el('p', 'hint', 'These point to where you may need an external partner, a new hire, or a targeted invitation:'));
      poolGaps.slice(0, 12).forEach(function (gp) {
        var g = el('div', 'gap-item');
        g.innerHTML = '<span class="chip ' + (gp.category || 'phrase') + '">' + esc(title(gp.term)) + '</span><span class="faint small" style="margin-left:auto">no coverage</span>';
        gapCard.appendChild(g);
      });
      if (GCX.llm && GCX.llm.isEnabled()) {
        var gapGuidance = el('div', 'topic-list'); gapGuidance.style.marginTop = '10px';
        var gapBtn = el('button', 'btn secondary small', 'Get AI guidance on closing these gaps');
        gapBtn.onclick = function () {
          gapBtn.disabled = true; gapBtn.textContent = 'Thinking...';
          GCX.llm.explainGaps(poolGaps, rfp.text)
            .then(function (arr) {
              gapGuidance.innerHTML = '';
              arr.forEach(function (t) { gapGuidance.appendChild(el('div', 'topic', esc(t.title) + '<div class="why">' + esc(t.detail) + '</div>')); });
              gapGuidance.appendChild(el('div', 'hint', 'Generated with your AI layer.'));
              toast('Drafted guidance for ' + arr.length + ' gap(s)');
            })
            .catch(function (e) { toast(e.message, true); })
            .then(function () { gapBtn.disabled = false; gapBtn.textContent = 'Get AI guidance on closing these gaps'; });
        };
        gapCard.appendChild(gapBtn);
        gapCard.appendChild(gapGuidance);
      }
    }
    box.appendChild(gapCard);

    // Collaboration topics
    var topicCard = el('div', 'card pad'); topicCard.style.marginTop = '16px';
    var tHead = el('div', 'section-title', '<h2>Collaboration topics</h2><span class="sub">Starting points that require combining these strengths</span>');
    topicCard.appendChild(tHead);
    var topicList = el('div', 'topic-list');
    function paintTopics(items, ai) {
      topicList.innerHTML = '';
      items.forEach(function (t) {
        var d = el('div', 'topic');
        d.innerHTML = '<div>' + esc(t.title || t.text) + '</div>' + (t.detail || t.rationale ? '<div class="why">' + esc(t.detail || t.rationale) + '</div>' : '');
        topicList.appendChild(d);
      });
      if (ai) topicList.appendChild(el('div', 'hint', 'Generated with your AI layer.'));
    }
    paintTopics(topics, false);
    topicCard.appendChild(topicList);
    if (GCX.llm && GCX.llm.isEnabled()) {
      var aiTopics = el('button', 'btn secondary small', 'Draft richer proposals with AI'); aiTopics.style.marginTop = '10px';
      aiTopics.onclick = function () {
        aiTopics.disabled = true; aiTopics.textContent = 'Drafting...';
        GCX.llm.richTopics(team.members.map(function (m) { return m.profile; }), rfp.text, topics)
          .then(function (arr) { paintTopics(arr, true); toast('Drafted ' + arr.length + ' proposals'); })
          .catch(function (e) { toast(e.message, true); })
          .then(function () { aiTopics.disabled = false; aiTopics.textContent = 'Draft richer proposals with AI'; });
      };
      topicCard.appendChild(aiTopics);
    }
    box.appendChild(topicCard);

    // Full ranking
    var rankCard = el('div', 'card'); rankCard.style.marginTop = '16px';
    rankCard.appendChild(el('div', 'section-title', '<h2 style="padding:16px 18px 0">Full ranking</h2>'));
    var maxComp = results.length ? results[0].composite || 1 : 1;
    results.forEach(function (r, i) {
      var it = el('div', 'rank-item' + (i < team.members.length ? ' top' : ''));
      var head = el('div', 'rank-head');
      head.innerHTML = '<span class="rank-num">' + (i + 1) + '</span><span class="rank-name">' + esc(r.profile.name) +
        ' <span class="faint small">' + esc(r.profile.affiliation || '') + '</span></span>' +
        '<span class="score-val">' + pct(r.composite) + '</span>';
      it.appendChild(head);
      var bar = el('div', 'scorebar'); bar.innerHTML = '<i style="width:' + Math.max(3, (r.composite / (maxComp || 1)) * 100) + '%"></i>'; it.appendChild(bar);
      if (r.matched.length) {
        var m = el('div', 'matched');
        m.innerHTML = '<span class="hint">Matches: </span>' + conceptChips(r.matched.slice(0, 8));
        it.appendChild(m);
      } else {
        it.appendChild(el('div', 'hint matched', 'No direct term matches with this opportunity.'));
      }
      rankCard.appendChild(it);
    });
    box.appendChild(rankCard);

    // Export
    var exportRow = el('div', 'btn-row'); exportRow.style.margin = '16px 2px';
    var rep = el('button', 'btn', 'Download report (HTML)'); rep.onclick = function () { downloadReport(rfp, results, team, poolGaps, topics); };
    exportRow.appendChild(rep);
    box.appendChild(exportRow);
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function metric(k, v) { return '<div class="metric"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }

  // ---------- report export ----------
  function downloadReport(rfp, results, team, poolGaps, topics) {
    var css = 'body{font:14px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a2230;max-width:820px;margin:32px auto;padding:0 18px}' +
      'h1{font-size:24px}h2{font-size:18px;border-bottom:2px solid #0f766e;padding-bottom:4px;margin-top:28px}' +
      '.chip{display:inline-block;background:#d7eeeb;color:#0b5c55;border-radius:999px;padding:2px 9px;font-size:12px;margin:2px}' +
      'table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e2e6ec;padding:7px 8px;text-align:left;font-size:13px}' +
      '.muted{color:#5b6675}.mem{border:1px solid #e2e6ec;border-radius:8px;padding:10px 12px;margin:8px 0}';
    var h = [];
    h.push('<h1>Grant Crosswalk — RFP report</h1>');
    h.push('<p class="muted">Generated ' + new Date().toLocaleString() + '. All analysis performed locally.</p>');
    h.push('<h2>Opportunity</h2><p>' + esc(rfp.text.slice(0, 900)) + (rfp.text.length > 900 ? '…' : '') + '</p>');
    h.push('<h2>Recommended team</h2>');
    h.push('<p><b>Coverage</b> ' + pct(team.coverage) + '% &nbsp; <b>Complementarity</b> ' + team.complementarity.toFixed(2) +
      ' &nbsp; <b>Overlap</b> ' + team.redundancy.toFixed(2) + ' &nbsp; <b>Disciplines</b> ' + team.interdisciplinarity + ' &nbsp; <b>Team fit</b> ' + pct(team.teamFit) + '%</p>');
    team.members.forEach(function (m, i) {
      h.push('<div class="mem"><b>' + (i + 1) + '. ' + esc(m.profile.name) + '</b> <span class="muted">' + esc(m.profile.affiliation || '') + ' — relevance ' + m.relevance.toFixed(2) + '</span><br>' +
        'Contributes: ' + m.contributes.slice(0, 6).map(function (c) { return '<span class="chip">' + esc(title(c.term)) + '</span>'; }).join('') + '</div>');
    });
    if (poolGaps.length) h.push('<h2>Capacity gaps (no one covers)</h2><p>' + poolGaps.slice(0, 14).map(function (g) { return '<span class="chip" style="background:#fdefd6;color:#b45309">' + esc(title(g.term)) + '</span>'; }).join('') + '</p>');
    h.push('<h2>Collaboration topics</h2><ol>' + topics.map(function (t) { return '<li>' + esc(t.title || t.text) + (t.detail || t.rationale ? ' <span class="muted">— ' + esc(t.detail || t.rationale) + '</span>' : '') + '</li>'; }).join('') + '</ol>');
    h.push('<h2>Full ranking</h2><table><tr><th>#</th><th>Scholar</th><th>Score</th><th>Relevance</th><th>Top matches</th></tr>');
    results.forEach(function (r, i) {
      h.push('<tr><td>' + (i + 1) + '</td><td>' + esc(r.profile.name) + '</td><td>' + pct(r.composite) + '</td><td>' + r.relevance.toFixed(2) + '</td><td>' +
        r.matched.slice(0, 5).map(function (m) { return esc(title(m.term)); }).join(', ') + '</td></tr>');
    });
    h.push('</table>');
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>RFP report</title><style>' + css + '</style></head><body>' + h.join('\n') + '</body></html>';
    var blob = new Blob([html], { type: 'text/html' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'rfp-report.html'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------- team explorer ----------
  function renderTeamExplorer() {
    if (state.profiles.length < 2) {
      $('pairsList').innerHTML = '<p class="faint small">Add at least two scholars.</p>';
      $('bridgesList').innerHTML = '<p class="faint small">Add at least two scholars.</p>';
      $('teamSeed').innerHTML = ''; $('teamModeResult').innerHTML = '';
      return;
    }
    var corpus = GCX.engine.buildCorpus(state.profiles);
    var pairs = GCX.engine.complementaryPairs(state.profiles, corpus, 6);
    $('pairsList').innerHTML = pairs.map(function (p, i) {
      return '<div class="rank-item"><div class="rank-head"><span class="rank-num">' + (i + 1) + '</span>' +
        '<span class="rank-name">' + esc(p.a.name) + ' <span class="faint">+</span> ' + esc(p.b.name) + '</span></div>' +
        '<div class="hint" style="margin-top:4px">overlap ' + p.similarity.toFixed(2) + ' · ' + (p.similarity < 0.08 ? 'very distinct strengths' : p.similarity < 0.3 ? 'complementary with common ground' : 'overlapping') + '</div></div>';
    }).join('');
    var bridges = GCX.engine.bridgeScholars(state.profiles, corpus);
    $('bridgesList').innerHTML = bridges.slice(0, 6).map(function (b, i) {
      return '<div class="rank-item"><div class="rank-head"><span class="rank-num">' + (i + 1) + '</span>' +
        '<span class="rank-name">' + esc(b.profile.name) + '</span><span class="faint small">' + b.bridges + ' links</span></div></div>';
    }).join('');
    var seed = $('teamSeed'); seed.innerHTML = '<option value="">(auto)</option>' + state.profiles.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
  }

  function buildComplementaryTeam() {
    var size = Math.max(2, Math.min(6, +$('teamModeSize').value || 3));
    var seed = $('teamSeed').value || null;
    var res = GCX.engine.complementaryTeam(state.profiles, { size: size, seedId: seed });
    var corpus = GCX.engine.buildCorpus(state.profiles);
    var topics = GCX.engine.suggestTopics(res.members, null, corpus);
    var box = $('teamModeResult'); box.innerHTML = '';
    var mrow = el('div', 'metric-row');
    mrow.innerHTML = metric('Members', String(res.members.length)) + metric('Complementarity', res.metrics.complementarity.toFixed(2)) +
      metric('Overlap', res.metrics.redundancy.toFixed(2)) + metric('Disciplines', String(res.metrics.interdisciplinarity));
    box.appendChild(mrow);
    res.members.forEach(function (m) {
      var g = GCX.extract.groupCapabilities(m);
      var d = el('div', 'team-member');
      d.innerHTML = '<strong>' + esc(m.name) + '</strong> <span class="faint small">' + esc(m.affiliation || '') + '</span>' +
        '<div style="margin-top:6px">' + conceptChips((g.discipline.slice(0, 2).concat(g.method.slice(0, 4)))) + '</div>';
      box.appendChild(d);
    });
    if (topics.length) {
      box.appendChild(el('h3', null, 'Suggested topics'));
      var topicList = el('div', 'topic-list');
      function paint(items) {
        topicList.innerHTML = '';
        items.forEach(function (t) { topicList.appendChild(el('div', 'topic', esc(t.title || t.text) + '<div class="why">' + esc(t.detail || t.rationale) + '</div>')); });
      }
      paint(topics);
      box.appendChild(topicList);
      if (GCX.llm && GCX.llm.isEnabled()) {
        var aiBtn = el('button', 'btn secondary small', 'Draft richer proposals with AI'); aiBtn.style.marginTop = '10px';
        aiBtn.onclick = function () {
          aiBtn.disabled = true; aiBtn.textContent = 'Drafting...';
          GCX.llm.richTopics(res.members, null, topics)
            .then(function (arr) { paint(arr); topicList.appendChild(el('div', 'hint', 'Generated with your AI layer.')); toast('Drafted ' + arr.length + ' proposals'); })
            .catch(function (e) { toast(e.message, true); })
            .then(function () { aiBtn.disabled = false; aiBtn.textContent = 'Draft richer proposals with AI'; });
        };
        box.appendChild(aiBtn);
      }
    }
  }

  // ---------- find funding (one scholar vs many open RFPs) ----------
  function renderFundingScholarPicker() {
    var sel = $('fundingScholarSelect');
    if (!state.profiles.length) { sel.innerHTML = '<option value="">(no scholars in roster \u2014 paste a CV below instead)</option>'; return; }
    sel.innerHTML = state.profiles.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + (p.affiliation ? ' \u2014 ' + esc(p.affiliation) : '') + '</option>'; }).join('');
  }

  function fundingProfile() {
    var pasted = $('fundingPasteCv').value.trim();
    if (pasted.length > 30) return GCX.extract.buildProfile(pasted, { filename: '' });
    var id = $('fundingScholarSelect').value;
    return state.profiles.filter(function (p) { return p.id === id; })[0] || null;
  }

  function renderFundingResults(profile, keywords, ranked, fromCache) {
    var box = $('fundingResults'); box.innerHTML = '';
    var head = el('div', 'card pad');
    head.innerHTML = '<div class="section-title"><h2>Matches for ' + esc(profile.name) + '</h2><span class="sub">' + (fromCache ? 'from cache' : 'live from Grants.gov') + '</span></div>' +
      '<p class="hint" style="margin-top:-6px">Searched with: ' + conceptChips(keywords.map(function (k) { return { term: k, category: 'phrase' }; })) + '</p>';
    box.appendChild(head);

    if (!ranked.length) {
      box.appendChild(el('div', 'empty card pad', '<div class="big">\uD83D\uDCED</div><p>No open or forecasted opportunities came back for these terms. Try a broader agency filter, or fewer / different search terms.</p>'));
      return;
    }
    var listCard = el('div', 'card'); listCard.style.marginTop = '16px';
    listCard.appendChild(el('div', 'section-title', '<h2 style="padding:16px 18px 0">Ranked opportunities</h2>'));
    var maxRel = ranked[0].relevance || 1;
    ranked.forEach(function (r, i) {
      var o = r.opportunity;
      var it = el('div', 'rank-item' + (i < 3 ? ' top' : ''));
      var link = GCX.opportunities.detailUrl(o);
      var head2 = el('div', 'rank-head');
      head2.innerHTML = '<span class="rank-num">' + (i + 1) + '</span><span class="rank-name">' +
        (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">' + esc(o.title) + '</a>' : esc(o.title)) +
        ' <span class="faint small">' + esc(o.agency || '') + (o.closeDate ? ' &middot; closes ' + esc(o.closeDate) : '') + '</span></span>' +
        '<span class="score-val">' + pct(r.relevance) + '</span>';
      it.appendChild(head2);
      var bar = el('div', 'scorebar'); bar.innerHTML = '<i style="width:' + Math.max(3, (r.relevance / (maxRel || 1)) * 100) + '%"></i>'; it.appendChild(bar);
      if (o.thin) it.appendChild(el('div', 'hint', 'Ranked on title only; open the listing for the full synopsis.'));
      if (r.matched.length) { var m = el('div', 'matched'); m.innerHTML = '<span class="hint">Matches: </span>' + conceptChips(r.matched.slice(0, 8)); it.appendChild(m); }
      var rationale = el('div', 'hint', ''); rationale.style.cssText = 'display:none;margin-top:6px'; it.appendChild(rationale);
      it._rationaleEl = rationale;
      listCard.appendChild(it);
    });
    box.appendChild(listCard);

    if (GCX.llm && GCX.llm.isEnabled()) {
      var matchBtn = el('button', 'btn secondary small', 'Draft AI rationale for top matches'); matchBtn.style.margin = '14px 2px';
      matchBtn.onclick = function () {
        matchBtn.disabled = true; matchBtn.textContent = 'Drafting...';
        GCX.llm.explainMatches(profile, ranked, keywords)
          .then(function (arr) {
            var items = listCard.querySelectorAll('.rank-item');
            arr.forEach(function (a) {
              var idx = ranked.findIndex(function (r) { return r.opportunity.title === a.title; });
              if (idx === -1 || !items[idx]) return;
              var slot = items[idx]._rationaleEl;
              slot.style.display = ''; slot.textContent = a.detail;
            });
            toast('Drafted rationale for ' + arr.length + ' match(es)');
          })
          .catch(function (e) { toast(e.message, true); })
          .then(function () { matchBtn.disabled = false; matchBtn.textContent = 'Draft AI rationale for top matches'; });
      };
      box.appendChild(matchBtn);
    }
  }

  function renderFundingFallback(keywords, message) {
    var box = $('fundingResults'); box.innerHTML = '';
    var c = el('div', 'card pad callout warn');
    var url = GCX.opportunities.manualSearchUrl(keywords || []);
    c.innerHTML = '<strong>Could not search Grants.gov directly.</strong><p style="margin:8px 0">' + esc(message) + '</p>' +
      (keywords && keywords.length ? '<a class="btn secondary small" href="' + esc(url) + '" target="_blank" rel="noopener">Open this search on grants.gov \u2192</a>' : '');
    box.appendChild(c);
  }

  function searchFunding() {
    var profile = fundingProfile();
    if (!profile) { toast('Pick a scholar or paste a CV first.', true); return; }
    var btn = $('fundingSearchBtn'); btn.disabled = true; btn.textContent = 'Searching\u2026';
    $('fundingResults').innerHTML = '<div class="empty card pad"><div class="big">\u23F3</div><p>Querying Grants.gov\u2026</p></div>';
    var overrides = {
      agencyFilter: $('fundingAgency').value.trim().toUpperCase(),
      onlyOpenAndForecasted: $('fundingOpenOnly').checked
    };
    GCX.opportunities.searchForProfile(profile, overrides)
      .then(function (r) { renderFundingResults(profile, r.keywords, r.ranked, r.fromCache); })
      .catch(function (e) {
        var kws = GCX.opportunities.topKeywords(profile, 4);
        renderFundingFallback(kws, e.message);
      })
      .then(function () { btn.disabled = false; btn.textContent = 'Search Grants.gov'; });
  }

  // ---------- settings / LLM ----------
  function loadSettings() {
    GCX.store.getSetting('theme', 'system').then(applyTheme);
    GCX.store.getSetting('pdfEnhanced', false).then(function (v) { $('pdfEnhanced').checked = !!v; if (v) enablePdfJs(); });
    GCX.llm.getConfig().then(function (cfg) {
      $('llmProvider').value = cfg.provider; $('llmKey').value = cfg.apiKey || ''; $('llmModel').value = cfg.model || '';
      $('llmBaseUrl').value = cfg.baseUrl || ''; $('llmEnabled').checked = !!cfg.enabled; $('llmAllowCv').checked = !!cfg.allowCvText;
      applyProviderUI(cfg.provider);
      updateLlmBadge();
    });
    GCX.opportunities.getSettings().then(function (cfg) {
      $('fundingEnabled').checked = !!cfg.enabled;
      $('fundingMaxKw').value = cfg.maxKeywords; $('fundingMaxKwV').textContent = cfg.maxKeywords;
      $('fundingRows').value = cfg.rows; $('fundingRowsV').textContent = cfg.rows;
      $('fundingProxyUrl').value = cfg.proxyBaseUrl || '';
      updateFundingBadge();
    });
  }
  function updateFundingBadge() {
    GCX.opportunities.getSettings().then(function (cfg) {
      var b = $('fundingBadge'); b.textContent = cfg.enabled ? 'On' : 'Off'; b.className = 'badge ' + (cfg.enabled ? 'green' : 'amber');
    });
  }
  function saveFunding() {
    GCX.opportunities.setSettings({
      enabled: $('fundingEnabled').checked,
      maxKeywords: +$('fundingMaxKw').value,
      rows: +$('fundingRows').value,
      proxyBaseUrl: $('fundingProxyUrl').value.trim()
    }).then(function () { updateFundingBadge(); toast('Funding search settings saved'); });
  }
  function testFunding() {
    saveFunding();
    $('fundingStatus').textContent = 'Testing\u2026';
    GCX.opportunities.testConnection()
      .then(function (r) { $('fundingStatus').textContent = 'Connected. Grants.gov returned ' + r.hitCount + ' result(s) for a test query.'; })
      .catch(function (e) { $('fundingStatus').textContent = 'Failed: ' + e.message; });
  }
  function clearFundingCache() {
    if (GCX.store && GCX.store.clearCache) GCX.store.clearCache().then(function () { toast('Cached funding-search results cleared'); });
  }
  var PROVIDER_HINTS = {
    anthropic: '',
    openai: '',
    gemini: 'Uses Gemini\u2019s OpenAI-compatible endpoint. Get a key from Google AI Studio.',
    grok: 'Uses xAI\u2019s OpenAI-compatible endpoint. Get a key from the xAI console.',
    ollama: 'No API key needed \u2014 Ollama ignores whatever you send. Make sure `ollama serve` is running. Ollama allows localhost by default, so this just works if you\u2019re also running this app locally; if you\u2019re using a hosted copy of this app instead, Ollama will block it unless you set OLLAMA_ORIGINS to that page\u2019s address.',
    custom: 'Point this at any OpenAI-compatible /chat/completions endpoint \u2014 Azure OpenAI, OpenRouter, a self-hosted gateway, vLLM, LM Studio, etc.'
  };
  function applyProviderUI(providerKey) {
    var preset = (GCX.llm.PROVIDERS && GCX.llm.PROVIDERS[providerKey]) || {};
    var isAnthropic = providerKey === 'anthropic';
    $('baseUrlField').hidden = isAnthropic;
    $('llmBaseUrl').placeholder = preset.defaultBaseUrl || 'https://...';
    $('llmModel').placeholder = 'e.g. ' + (preset.modelPlaceholder || 'model name');
    $('llmKey').placeholder = preset.keyRequired === false ? 'Not required for Ollama' : 'Paste your API key';
    $('llmProviderHint').textContent = PROVIDER_HINTS[providerKey] || '';
  }
  function updateLlmBadge() {
    GCX.llm.getConfig().then(function () {
      var on = GCX.llm.isEnabled();
      var b = $('llmBadge'); b.textContent = on ? 'On' : 'Off'; b.className = 'badge ' + (on ? 'green' : 'amber');
    });
  }
  function saveLlm() {
    var providerKey = $('llmProvider').value;
    var preset = (GCX.llm.PROVIDERS && GCX.llm.PROVIDERS[providerKey]) || {};
    var cfg = {
      provider: providerKey, apiKey: $('llmKey').value.trim(), model: $('llmModel').value.trim() || preset.defaultModel || 'claude-3-5-haiku-latest',
      baseUrl: $('llmBaseUrl').value.trim(), enabled: $('llmEnabled').checked, allowCvText: $('llmAllowCv').checked
    };
    GCX.llm.setConfig(cfg).then(function () { updateLlmBadge(); toast('AI settings saved'); });
  }
  function testLlm() {
    saveLlm();
    $('llmStatus').textContent = 'Testing...';
    GCX.llm.testConnection().then(function (r) { $('llmStatus').textContent = 'Connected. Provider replied: "' + r.text + '"'; })
      .catch(function (e) { $('llmStatus').textContent = 'Failed: ' + e.message; });
  }

  // ---------- optional pdf.js ----------
  function enablePdfJs() {
    if (GCX.pdfjs && GCX.pdfjs.ready) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = function () {
        try {
          var lib = window.pdfjsLib;
          lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          GCX.pdfjs = {
            ready: true,
            extract: function (bytes) {
              return lib.getDocument({ data: bytes }).promise.then(function (doc) {
                var pages = [];
                var seq = Promise.resolve();
                for (var i = 1; i <= doc.numPages; i++) {
                  (function (n) { seq = seq.then(function () { return doc.getPage(n).then(function (pg) { return pg.getTextContent(); }).then(function (tc) { pages.push(tc.items.map(function (it) { return it.str; }).join(' ')); }); }); })(i);
                }
                return seq.then(function () { return pages.join('\n'); });
              });
            }
          };
          resolve();
        } catch (e) { reject(e); }
      };
      s.onerror = function () { reject(new Error('Could not load pdf.js (offline or blocked).')); };
      document.head.appendChild(s);
    });
  }

  // ---------- export / import roster ----------
  function exportRoster() {
    GCX.store.exportAll().then(function (data) {
      data.profiles = state.profiles; // ensure current in-memory state
      var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'scholar-roster.json'; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
  }
  function importRoster(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var data = JSON.parse(r.result);
        var arr = data.profiles || data;
        if (!Array.isArray(arr)) throw new Error('No profiles in file.');
        var byId = {}; state.profiles.forEach(function (p) { byId[p.id] = true; });
        var n = 0; arr.forEach(function (p) { if (p && p.id && !byId[p.id]) { state.profiles.push(p); persist(p); n++; } });
        renderRoster(); updateCount(); toast('Imported ' + n + ' scholars');
      } catch (e) { toast('Import failed: ' + e.message, true); }
    };
    r.readAsText(file);
  }

  // ---------- wiring ----------
  function wire() {
    Array.prototype.forEach.call($('nav').children, function (b) { b.onclick = function () { setView(b.dataset.view); }; });
    $('themeToggle').onclick = toggleTheme;
    $('themeToggle2').onclick = toggleTheme;

    // dropzone
    var dz = $('dropzone');
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
    dz.addEventListener('drop', function (e) { if (e.dataTransfer.files) ingestFiles(e.dataTransfer.files); });
    $('pickFilesBtn').onclick = function () { $('fileInput').click(); };
    $('pickFolderBtn').onclick = function () { $('folderInput').click(); };
    $('fileInput').onchange = function (e) { ingestFiles(e.target.files); e.target.value = ''; };
    $('folderInput').onchange = function (e) { ingestFiles(e.target.files); e.target.value = ''; };
    $('addPasteBtn').onclick = addFromText;
    $('exportRosterBtn').onclick = exportRoster;
    $('importRosterBtn').onclick = function () { $('importInput').click(); };
    $('importInput').onchange = function (e) { if (e.target.files[0]) importRoster(e.target.files[0]); e.target.value = ''; };
    $('clearRosterBtn').onclick = function () {
      if (!state.profiles.length) return;
      if (!confirm('Remove all ' + state.profiles.length + ' scholars from this device?')) return;
      state.profiles = []; if (GCX.store.available) GCX.store.clearProfiles(); renderRoster(); updateCount(); toast('Roster cleared');
    };

    // RFP
    ['wRelevance', 'wRecent', 'wFunding', 'teamSize'].forEach(function (id) {
      $(id).oninput = function () { $(id + 'V').textContent = $(id).value; };
    });
    $('analyzeBtn').onclick = analyze;
    $('rfpUploadBtn').onclick = function () {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pdf,.docx,.txt,.md,.rtf,.html,.htm';
      inp.onchange = function () { if (inp.files[0]) GCX.parse.parseFile(inp.files[0]).then(function (r) { $('rfpText').value = r.text; if (r.warning) toast(r.warning, true); else toast('Loaded ' + inp.files[0].name); }); };
      inp.click();
    };

    // team explorer
    $('buildTeamBtn').onclick = buildComplementaryTeam;

    // find funding
    $('fundingSearchBtn').onclick = searchFunding;
    ['fundingMaxKw', 'fundingRows'].forEach(function (id) {
      $(id).oninput = function () { $(id + 'V').textContent = $(id).value; };
    });
    $('fundingSaveBtn').onclick = saveFunding;
    $('fundingTestBtn').onclick = testFunding;
    $('fundingClearCacheBtn').onclick = clearFundingCache;

    // settings
    $('llmProvider').onchange = function () {
      applyProviderUI($('llmProvider').value);
      // Auto-fill the base URL with the new provider's default, but only if
      // the field is currently empty or still held a previous provider's
      // default — never clobber something the user deliberately typed.
      var preset = (GCX.llm.PROVIDERS && GCX.llm.PROVIDERS[$('llmProvider').value]) || {};
      var allDefaults = Object.keys(GCX.llm.PROVIDERS || {}).map(function (k) { return GCX.llm.PROVIDERS[k].defaultBaseUrl; });
      if (!$('llmBaseUrl').value.trim() || allDefaults.indexOf($('llmBaseUrl').value.trim()) !== -1) {
        $('llmBaseUrl').value = preset.defaultBaseUrl || '';
      }
    };
    $('llmSaveBtn').onclick = saveLlm;
    $('llmTestBtn').onclick = testLlm;
    $('pdfEnhanced').onchange = function () {
      var on = $('pdfEnhanced').checked; GCX.store.setSetting('pdfEnhanced', on);
      if (on) enablePdfJs().then(function () { toast('Enhanced PDF parsing ready'); }).catch(function (e) { toast(e.message, true); $('pdfEnhanced').checked = false; });
    };

    // modal
    $('modalClose').onclick = closeModal;
    $('modalBackdrop').addEventListener('click', function (e) { if (e.target === $('modalBackdrop')) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }

  // ---------- init ----------
  function init() {
    wire();
    if (GCX.store && GCX.store.available) {
      loadSettings();
      GCX.store.getProfiles().then(function (arr) {
        state.profiles = arr || [];
        renderRoster(); updateCount();
      }).catch(function () { renderRoster(); updateCount(); });
    } else {
      applyTheme('system');
      renderRoster(); updateCount();
      toast('Local storage is unavailable; your roster will not persist between sessions.', true);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.GCX = window.GCX || {});
