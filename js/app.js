/*
 * app.js — UI controller. Vanilla JS, classic script, no build step.
 * Depends on the SPF.* modules loaded before it.
 */
(function (SPF) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var pct = function (x) { return Math.round(x * 100); };
  var title = function (s) { return SPF.engine.titleCase(s); };

  var state = {
    profiles: [], lastRfp: null, lastCorpus: null, lastResults: null, lastTeam: null, lastTopics: null,
    baseRfp: null, lastRfpText: '', rosterQuery: '',
    rfpEdits: { removed: [], added: [], boosts: {} },
    teamConstraints: { include: [], exclude: [] }
  };

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
    if (SPF.store) SPF.store.setSetting('theme', next);
  }

  // ---------- navigation ----------
  function setView(name) {
    ['rfp', 'roster', 'team', 'settings'].forEach(function (v) {
      $('view-' + v).classList.toggle('active', v === name);
    });
    Array.prototype.forEach.call($('nav').children, function (b) { b.classList.toggle('active', b.dataset.view === name); });
    if (name === 'team') renderTeamExplorer();
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

  function profileMatchesQuery(p, q) {
    if (!q) return true;
    var hay = [p.name, p.affiliation, p.sourceFile].join(' ').toLowerCase();
    Object.keys(p.capabilities || {}).forEach(function (c) { hay += ' ' + c; });
    (p.tagsAdded || []).forEach(function (t) { hay += ' ' + t; });
    return hay.indexOf(q) !== -1;
  }

  function renderRoster() {
    var box = $('rosterList'); box.innerHTML = '';
    if (!state.profiles.length) {
      box.appendChild(el('div', 'empty', '<div class="big">📚</div><p>No scholars yet. Drop CV files, paste a CV, or load the samples.</p>'));
      return;
    }
    var q = (state.rosterQuery || '').trim().toLowerCase();
    var shown = state.profiles.slice()
      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); })
      .filter(function (p) { return profileMatchesQuery(p, q); });
    if (!shown.length) {
      box.appendChild(el('div', 'empty', '<div class="big">🔎</div><p>No scholars match “' + esc(state.rosterQuery) + '”.</p>'));
      return;
    }
    shown.forEach(function (p) {
      var row = el('div', 'scholar-row');
      var av = el('div', 'avatar'); av.style.background = avatarColor(p.name || '?'); av.textContent = initials(p.name || '?');
      var main = el('div', 'scholar-main');
      var g = SPF.extract.groupCapabilities(p);
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

  function persist(p) { if (SPF.store && SPF.store.available) return SPF.store.putProfile(p); return Promise.resolve(); }

  function removeProfile(p) {
    state.profiles = state.profiles.filter(function (x) { return x.id !== p.id; });
    if (SPF.store && SPF.store.available) SPF.store.deleteProfile(p.id);
    renderRoster(); updateCount();
  }

  // ---------- file ingestion ----------
  var ACCEPT = /\.(pdf|docx|doc|txt|md|markdown|rtf|html?|json)$/i;

  function normName(n) { return String(n || '').trim().toLowerCase().replace(/\s+/g, ' '); }

  async function ingestFiles(files) {
    var list = Array.prototype.slice.call(files).filter(function (f) { return ACCEPT.test(f.name); });
    if (!list.length) { toast('No supported files found (PDF, DOCX, TXT, MD, RTF, HTML).', true); return; }
    var existing = Object.create(null);
    state.profiles.forEach(function (p) { var n = normName(p.name); if (n && n !== 'unnamed scholar') existing[n] = true; });
    var added = 0, warned = 0, dupes = 0;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      try {
        var parsed = await SPF.parse.parseFile(f);
        if (parsed.warning) { warned++; }
        if (!parsed.text || parsed.text.length < 20) { toast('Little text from ' + f.name + '. ' + (parsed.warning || ''), true); continue; }
        var prof = SPF.extract.buildProfile(parsed.text, { filename: f.name });
        var key = normName(prof.name);
        if (key && key !== 'unnamed scholar' && existing[key]) { dupes++; continue; }
        if (key && key !== 'unnamed scholar') existing[key] = true;
        state.profiles.push(prof);
        await persist(prof);
        added++;
      } catch (e) { toast('Failed: ' + f.name + ' — ' + e.message, true); }
    }
    renderRoster(); updateCount();
    if (added) toast('Added ' + added + ' scholar' + (added === 1 ? '' : 's') +
      (warned ? ' (' + warned + ' with parse warnings)' : '') + (dupes ? '; skipped ' + dupes + ' already in roster' : ''));
    else if (dupes) toast('All ' + dupes + ' already in your roster (matched by name).', true);
  }

  function addFromText() {
    var txt = $('pasteCv').value.trim();
    if (txt.length < 40) { toast('Paste a longer CV.', true); return; }
    var prof = SPF.extract.buildProfile(txt, { filename: '' });
    state.profiles.push(prof); persist(prof);
    $('pasteCv').value = '';
    renderRoster(); updateCount(); toast('Added ' + prof.name);
    openScholar(prof);
  }

  function loadSamples() {
    if (!SPF.samples) { toast('Sample data unavailable.', true); return; }
    var existing = {}; state.profiles.forEach(function (p) { existing[p.name] = true; });
    var n = 0;
    SPF.samples.scholars.forEach(function (s) {
      var prof = SPF.extract.buildProfile(s.text, { filename: s.filename });
      if (existing[prof.name]) return;
      state.profiles.push(prof); persist(prof); n++;
    });
    renderRoster(); updateCount();
    if (!$('rfpText').value.trim()) $('rfpText').value = SPF.samples.rfp;
    toast('Loaded ' + n + ' sample scholars and a sample RFP');
  }

  // ---------- scholar edit modal ----------
  var modalCtx = null;
  function openScholar(p) {
    modalCtx = p;
    $('modalTitle').textContent = 'Edit scholar';
    var g = SPF.extract.groupCapabilities(p);
    var body = $('modalBody'); body.innerHTML = '';
    var f1 = el('label', 'field', '<span>Name</span>'); var i1 = el('input'); i1.type = 'text'; i1.value = p.name || ''; f1.appendChild(i1);
    var f2 = el('label', 'field', '<span>Affiliation</span>'); var i2 = el('input'); i2.type = 'text'; i2.value = p.affiliation || ''; f2.appendChild(i2);
    var f3 = el('label', 'field', '<span>Email</span>'); var i3 = el('input'); i3.type = 'text'; i3.value = p.email || ''; f3.appendChild(i3);
    body.appendChild(f1); body.appendChild(f2); body.appendChild(f3);

    var capWrap = el('div');
    function renderChips() {
      capWrap.innerHTML = '<div class="hint" style="margin-bottom:6px">Detected capabilities — remove anything wrong, and add what is missing. Curated tags are weighted strongly.</div>';
      var cats = [['discipline', 'Disciplines'], ['method', 'Methods'], ['theme', 'Themes'], ['infrastructure', 'Infrastructure'], ['funder', 'Funders']];
      var gg = SPF.extract.groupCapabilities(p);
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

    if (SPF.llm && SPF.llm.isEnabled()) {
      var aiBtn = el('button', 'btn secondary small', 'Enhance tags with AI'); aiBtn.style.marginTop = '10px';
      aiBtn.onclick = function () {
        aiBtn.disabled = true; aiBtn.textContent = 'Working...';
        SPF.llm.enhanceProfile(p).then(function (r) {
          p.tagsAdded = Array.from(new Set((p.tagsAdded || []).concat(r.tags))); p.edited = true; renderChips();
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
  // Analyze from the textarea. Editing the requirement text is a fresh read,
  // so any prior requirement edits or team pins for a different RFP are cleared.
  function analyze() {
    var text = $('rfpText').value.trim();
    if (text.length < 30) { toast('Paste a longer RFP or topic.', true); return; }
    if (!state.profiles.length) { toast('Add scholars to your roster first.', true); setView('roster'); return; }
    if (text !== state.lastRfpText) {
      state.rfpEdits = { removed: [], added: [], boosts: {} };
      state.teamConstraints = { include: [], exclude: [] };
    }
    state.baseRfp = SPF.engine.analyzeRFP(text);
    state.lastRfpText = text;
    runAnalysis();
  }

  // Recompute everything from the base RFP plus the human's requirement edits
  // and team constraints. Cheap at this scale, so every edit re-runs live.
  function runAnalysis() {
    if (!state.baseRfp) return;
    var rfp = SPF.engine.applyRequirementEdits(state.baseRfp, state.rfpEdits);
    var corpus = SPF.engine.buildCorpus(state.profiles, [rfp.tf]);
    var results = SPF.engine.scoreScholarsForRFP(state.profiles, rfp, weights(), corpus);
    var team = SPF.engine.assembleTeam(state.profiles, rfp, {
      size: +$('teamSize').value,
      include: state.teamConstraints.include,
      exclude: state.teamConstraints.exclude
    }, corpus);
    var poolGaps = SPF.engine.poolGapAnalysis(state.profiles, rfp, corpus);
    var topics = SPF.engine.suggestTopics(team.members.map(function (m) { return m.profile; }), rfp, corpus);
    state.lastRfp = rfp; state.lastCorpus = corpus; state.lastResults = results; state.lastTeam = team; state.lastTopics = topics; state.lastPoolGaps = poolGaps;
    renderRfpResults(rfp, results, team, poolGaps, topics);
  }

  // Preserve scroll position across the live re-renders that requirement edits
  // and team pins trigger, so the page does not jump under the user.
  function reanalyzePreservingScroll() {
    var y = window.scrollY;
    runAnalysis();
    window.scrollTo({ top: y });
  }

  function conceptChips(list, keyName) {
    return '<div class="chips">' + list.map(function (m) {
      var term = keyName ? m[keyName] : m.term; var cat = m.category || 'phrase';
      return '<span class="chip ' + cat + '">' + esc(title(term)) + '</span>';
    }).join('') + '</div>';
  }

  // ---------- requirement editor ----------
  // The extracted requirement set is a heuristic read, so it is made
  // correctable in exactly the way scholar profiles already are.
  function renderRequirementEditor(rfp) {
    var card = el('div', 'card pad'); card.style.marginBottom = '16px';
    card.appendChild(el('div', 'section-title',
      '<h2>Requirements the tool will match</h2><span class="sub">Editable. Remove noise, add what the call implies, mark a must.</span>'));
    card.appendChild(el('p', 'hint', 'Coverage, gaps, and the ranking all run on this set. A starred requirement counts double.'));

    var terms = Object.keys(rfp.tf).sort(function (a, b) { return rfp.tf[b] - rfp.tf[a]; });
    var wrap = el('div', 'chips'); wrap.style.marginTop = '4px';
    terms.forEach(function (t) {
      var cat = (rfp.concepts[t] || {}).category || 'phrase';
      var must = !!state.rfpEdits.boosts[t];
      var chip = el('span', 'chip req ' + cat + (must ? ' must' : ''));
      chip.innerHTML = '<span class="star" title="Mark as a must (counts double)">' + (must ? '★' : '☆') + '</span>' +
        esc(title(t)) + ' <span class="x" title="Remove requirement">✕</span>';
      chip.querySelector('.star').onclick = function () {
        if (must) delete state.rfpEdits.boosts[t]; else state.rfpEdits.boosts[t] = 2;
        reanalyzePreservingScroll();
      };
      chip.querySelector('.x').onclick = function () {
        state.rfpEdits.removed = state.rfpEdits.removed.concat([t]);
        state.rfpEdits.added = state.rfpEdits.added.filter(function (a) { return (typeof a === 'string' ? a : a.term) !== t; });
        delete state.rfpEdits.boosts[t];
        reanalyzePreservingScroll();
      };
      wrap.appendChild(chip);
    });
    card.appendChild(wrap);

    var addRow = el('div', 'btn-row'); addRow.style.marginTop = '10px';
    var input = el('input'); input.type = 'text'; input.placeholder = 'Add a requirement the call implies, e.g. desalination'; input.style.flex = '1'; input.style.minWidth = '220px';
    var addBtn = el('button', 'btn small', 'Add requirement');
    function doAdd() {
      var v = input.value.trim().toLowerCase();
      if (!v) return;
      state.rfpEdits.removed = state.rfpEdits.removed.filter(function (x) { return x !== v; });
      state.rfpEdits.added = state.rfpEdits.added.concat([v]);
      input.value = '';
      reanalyzePreservingScroll();
    }
    addBtn.onclick = doAdd; input.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } };
    addRow.appendChild(input); addRow.appendChild(addBtn);
    var edited = state.rfpEdits.removed.length || state.rfpEdits.added.length || Object.keys(state.rfpEdits.boosts).length;
    if (edited) {
      var reset = el('button', 'btn ghost small', 'Reset to detected');
      reset.onclick = function () { state.rfpEdits = { removed: [], added: [], boosts: {} }; reanalyzePreservingScroll(); };
      addRow.appendChild(reset);
    }
    card.appendChild(addRow);
    return card;
  }

  // ---------- coverage matrix ----------
  // Requirement-by-member strengths: who on the team covers what, with the
  // still-uncovered requirements made obvious. The most defensible artifact.
  function renderCoverageMatrix(team) {
    var m = team.coverageMatrix;
    if (!m || !m.rows.length || !m.members.length) return null;
    var card = el('div', 'card pad'); card.style.marginTop = '16px';
    card.appendChild(el('div', 'section-title',
      '<h2>Who covers what</h2><span class="sub">Each requirement against each team member. Amber rows are uncovered.</span>'));

    var CAP = 20;
    var rows = m.rows;
    var shown = rows.slice(0, CAP);
    var scroll = el('div'); scroll.style.overflowX = 'auto';
    var tbl = el('table', 'cov-matrix');
    var thead = '<thead><tr><th class="req-col">Requirement</th>' +
      m.members.map(function (n) { return '<th title="' + esc(n) + '">' + esc(shortName(n)) + '</th>'; }).join('') +
      '<th>Team</th></tr></thead>';
    var body = shown.map(function (r) {
      var cells = r.perMember.map(function (s) { return '<td class="cov-cell">' + covSwatch(s) + '</td>'; }).join('');
      var badge = r.covered ? '<span class="cov-yes">' + Math.round(r.best * 100) + '</span>' : '<span class="cov-no">gap</span>';
      return '<tr class="' + (r.covered ? '' : 'uncovered') + '"><td class="req-col"><span class="chip ' + r.category + '">' + esc(title(r.term)) + '</span></td>' +
        cells + '<td>' + badge + '</td></tr>';
    }).join('');
    tbl.innerHTML = thead + '<tbody>' + body + '</tbody>';
    scroll.appendChild(tbl);
    card.appendChild(scroll);
    if (rows.length > CAP) card.appendChild(el('p', 'hint', 'Showing the ' + CAP + ' highest-weighted of ' + rows.length + ' requirements.'));
    card.appendChild(el('p', 'hint', 'Cell shade is how strongly that member addresses the requirement, from pale (little) to solid (the roster’s strongest).'));
    return card;
  }
  function shortName(n) { var p = String(n).trim().split(/\s+/); return p.length > 1 ? (p[0][0] + '. ' + p[p.length - 1]) : n; }
  function covSwatch(s) {
    var a = Math.max(0, Math.min(1, s));
    var op = a === 0 ? 0 : (0.12 + 0.88 * a);
    return '<span class="swatch" style="opacity:' + op.toFixed(2) + '"></span>';
  }

  function renderRfpResults(rfp, results, team, poolGaps, topics) {
    var box = $('rfpResults'); box.innerHTML = '';

    // Editable requirement set (drives everything below).
    box.appendChild(renderRequirementEditor(rfp));

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
    if (state.teamConstraints.include.length || state.teamConstraints.exclude.length) {
      var note = el('div', 'hint');
      var parts = [];
      if (state.teamConstraints.include.length) parts.push(state.teamConstraints.include.length + ' pinned in');
      if (state.teamConstraints.exclude.length) parts.push(state.teamConstraints.exclude.length + ' excluded');
      note.innerHTML = 'Human constraints applied: ' + parts.join(', ') + '. ';
      var clr = el('button', 'btn ghost small', 'Clear constraints');
      clr.onclick = function () { state.teamConstraints = { include: [], exclude: [] }; reanalyzePreservingScroll(); };
      note.appendChild(clr);
      teamCard.appendChild(note);
    }
    team.members.forEach(function (m, i) {
      var d = el('div', 'team-member');
      d.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><span class="rank-num">' + (i + 1) + '</span>' +
        '<strong>' + esc(m.profile.name) + '</strong>' + (m.pinned ? ' <span class="badge green" style="font-size:9px">pinned</span>' : '') +
        '<span class="faint small" style="margin-left:auto">relevance ' + m.relevance.toFixed(2) + '</span></div>' +
        '<div class="hint" style="margin:6px 0 4px">Adds to the proposal:</div>' +
        conceptChips(m.contributes.slice(0, 6));
      teamCard.appendChild(d);
    });
    if (team.gaps && team.gaps.length) {
      teamCard.appendChild(el('div', 'hint', 'This team still leaves uncovered: ' + team.gaps.slice(0, 6).map(function (g) { return title(g.term); }).join(', ') + '.'));
    }
    box.appendChild(teamCard);

    // Coverage matrix
    var cov = renderCoverageMatrix(team);
    if (cov) box.appendChild(cov);

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
    if (SPF.llm && SPF.llm.isEnabled()) {
      var aiTopics = el('button', 'btn secondary small', 'Draft richer proposals with AI'); aiTopics.style.marginTop = '10px';
      aiTopics.onclick = function () {
        aiTopics.disabled = true; aiTopics.textContent = 'Drafting...';
        SPF.llm.richTopics(team.members.map(function (m) { return m.profile; }), rfp.text, topics)
          .then(function (arr) { paintTopics(arr, true); toast('Drafted ' + arr.length + ' proposals'); })
          .catch(function (e) { toast(e.message, true); })
          .then(function () { aiTopics.disabled = false; aiTopics.textContent = 'Draft richer proposals with AI'; });
      };
      topicCard.appendChild(aiTopics);
    }
    box.appendChild(topicCard);

    // Full ranking (with pin / exclude and left-off explanations)
    var alsoRanById = {}; (team.alsoRan || []).forEach(function (a) { alsoRanById[a.profile.id] = a; });
    var teamIds = {}; team.members.forEach(function (m) { teamIds[m.profile.id] = true; });
    var rankCard = el('div', 'card'); rankCard.style.marginTop = '16px';
    rankCard.appendChild(el('div', 'section-title', '<h2 style="padding:16px 18px 0">Full ranking</h2><span class="sub" style="padding-top:16px">Pin a scholar onto the team, or exclude one</span>'));
    var maxComp = results.length ? results[0].composite || 1 : 1;
    results.forEach(function (r, i) {
      var onTeam = teamIds[r.profile.id];
      var excluded = state.teamConstraints.exclude.indexOf(r.profile.id) !== -1;
      var pinned = state.teamConstraints.include.indexOf(r.profile.id) !== -1;
      var it = el('div', 'rank-item' + (onTeam ? ' top' : '') + (excluded ? ' excluded' : ''));
      var head = el('div', 'rank-head');
      head.innerHTML = '<span class="rank-num">' + (i + 1) + '</span><span class="rank-name">' + esc(r.profile.name) +
        ' <span class="faint small">' + esc(r.profile.affiliation || '') + '</span></span>' +
        '<span class="score-val">' + pct(r.composite) + '</span>';
      var acts = el('span', 'rank-acts');
      var pinBtn = el('button', 'chip-btn' + (pinned ? ' on' : ''), pinned ? 'Pinned' : 'Pin');
      pinBtn.title = 'Force this scholar onto the team';
      pinBtn.onclick = function () { toggleConstraint('include', r.profile.id); };
      var exBtn = el('button', 'chip-btn' + (excluded ? ' on' : ''), excluded ? 'Excluded' : 'Exclude');
      exBtn.title = 'Keep this scholar off the team';
      exBtn.onclick = function () { toggleConstraint('exclude', r.profile.id); };
      acts.appendChild(pinBtn); acts.appendChild(exBtn);
      head.appendChild(acts);
      it.appendChild(head);
      var bar = el('div', 'scorebar'); bar.innerHTML = '<i style="width:' + Math.max(3, (r.composite / (maxComp || 1)) * 100) + '%"></i>'; it.appendChild(bar);
      if (r.matched.length) {
        var mm = el('div', 'matched');
        mm.innerHTML = '<span class="hint">Matches: </span>' + conceptChips(r.matched.slice(0, 8));
        it.appendChild(mm);
      } else {
        it.appendChild(el('div', 'hint matched', 'No direct term matches with this opportunity.'));
      }
      // Why a strong candidate was left off the team.
      var ar = alsoRanById[r.profile.id];
      if (!onTeam && !excluded && ar && ar.redundantWith && r.relevance >= 0.05) {
        var why = 'Left off: adds about ' + pct(ar.marginalCoverage) + '% new coverage' +
          (ar.overlap > 0.05 ? ', overlapping most with ' + esc(ar.redundantWith) : '') + '.';
        it.appendChild(el('div', 'hint why-off', why));
      }
      rankCard.appendChild(it);
    });
    box.appendChild(rankCard);

    // Export
    var exportRow = el('div', 'btn-row'); exportRow.style.margin = '16px 2px';
    var rep = el('button', 'btn', 'Download report (HTML)'); rep.onclick = function () { downloadReport(rfp, results, team, poolGaps, topics); };
    var csv = el('button', 'btn secondary', 'Download ranking (CSV)'); csv.onclick = function () { downloadCsv(results, team); };
    exportRow.appendChild(rep); exportRow.appendChild(csv);
    box.appendChild(exportRow);
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggleConstraint(kind, id) {
    var other = kind === 'include' ? 'exclude' : 'include';
    var arr = state.teamConstraints[kind];
    var idx = arr.indexOf(id);
    if (idx === -1) {
      state.teamConstraints[kind] = arr.concat([id]);
      state.teamConstraints[other] = state.teamConstraints[other].filter(function (x) { return x !== id; });
    } else {
      state.teamConstraints[kind] = arr.filter(function (x) { return x !== id; });
    }
    reanalyzePreservingScroll();
  }

  function metric(k, v) { return '<div class="metric"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }

  // ---------- report export ----------
  function downloadReport(rfp, results, team, poolGaps, topics) {
    var css = 'body{font:14px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a2230;max-width:820px;margin:32px auto;padding:0 18px}' +
      'h1{font-size:24px}h2{font-size:18px;border-bottom:2px solid #0f766e;padding-bottom:4px;margin-top:28px}' +
      '.chip{display:inline-block;background:#d7eeeb;color:#0b5c55;border-radius:999px;padding:2px 9px;font-size:12px;margin:2px}' +
      'table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e2e6ec;padding:7px 8px;text-align:left;font-size:13px}' +
      '.muted{color:#5b6675}.mem{border:1px solid #e2e6ec;border-radius:8px;padding:10px 12px;margin:8px 0}' +
      '.cov td,.cov th{text-align:center;font-variant-numeric:tabular-nums}.cov td:first-child,.cov th:first-child{text-align:left}' +
      '.cov tr.gap{background:#fdf4e6}.cov .g{color:#b45309;font-weight:700}';
    var h = [];
    h.push('<h1>Scholar Partner Finder — RFP report</h1>');
    h.push('<p class="muted">Generated ' + new Date().toLocaleString() + '. All analysis performed locally.</p>');
    h.push('<h2>Opportunity</h2><p>' + esc(rfp.text.slice(0, 900)) + (rfp.text.length > 900 ? '…' : '') + '</p>');
    h.push('<h2>Recommended team</h2>');
    h.push('<p><b>Coverage</b> ' + pct(team.coverage) + '% &nbsp; <b>Complementarity</b> ' + team.complementarity.toFixed(2) +
      ' &nbsp; <b>Overlap</b> ' + team.redundancy.toFixed(2) + ' &nbsp; <b>Disciplines</b> ' + team.interdisciplinarity + ' &nbsp; <b>Team fit</b> ' + pct(team.teamFit) + '%</p>');
    team.members.forEach(function (m, i) {
      h.push('<div class="mem"><b>' + (i + 1) + '. ' + esc(m.profile.name) + '</b> <span class="muted">' + esc(m.profile.affiliation || '') + ' — relevance ' + m.relevance.toFixed(2) + '</span><br>' +
        'Contributes: ' + m.contributes.slice(0, 6).map(function (c) { return '<span class="chip">' + esc(title(c.term)) + '</span>'; }).join('') + '</div>');
    });
    // Requirement-by-member coverage matrix.
    if (team.coverageMatrix && team.coverageMatrix.rows.length) {
      var cm = team.coverageMatrix;
      h.push('<h2>Who covers what</h2>');
      h.push('<table class="cov"><tr><th>Requirement</th>' + cm.members.map(function (n) { return '<th>' + esc(n) + '</th>'; }).join('') + '<th>Team</th></tr>');
      cm.rows.slice(0, 24).forEach(function (r) {
        var cells = r.perMember.map(function (s) { return '<td>' + (s > 0.01 ? Math.round(s * 100) : '·') + '</td>'; }).join('');
        h.push('<tr class="' + (r.covered ? '' : 'gap') + '"><td>' + esc(title(r.term)) + '</td>' + cells +
          '<td>' + (r.covered ? Math.round(r.best * 100) : '<span class="g">gap</span>') + '</td></tr>');
      });
      h.push('</table><p class="muted">Values are each member’s strength on the requirement, 0–100, relative to the roster’s strongest. Amber rows are uncovered by the team.</p>');
    }
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

  // CSV of the ranking, for offices that work in a spreadsheet.
  function downloadCsv(results, team) {
    var teamIds = {}; team.members.forEach(function (m) { teamIds[m.profile.id] = true; });
    function q(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var rows = [['rank', 'scholar', 'affiliation', 'on_team', 'composite', 'relevance', 'recent', 'funding', 'top_matches']];
    results.forEach(function (r, i) {
      rows.push([
        i + 1, r.profile.name, r.profile.affiliation || '', teamIds[r.profile.id] ? 'yes' : 'no',
        r.composite.toFixed(4), r.relevance.toFixed(4), (r.recent || 0).toFixed(4), (r.funding || 0).toFixed(4),
        r.matched.slice(0, 6).map(function (m) { return title(m.term); }).join('; ')
      ]);
    });
    var csv = rows.map(function (row) { return row.map(q).join(','); }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'rfp-ranking.csv'; a.click();
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
    var corpus = SPF.engine.buildCorpus(state.profiles);
    var pairs = SPF.engine.complementaryPairs(state.profiles, corpus, 6);
    $('pairsList').innerHTML = pairs.map(function (p, i) {
      return '<div class="rank-item"><div class="rank-head"><span class="rank-num">' + (i + 1) + '</span>' +
        '<span class="rank-name">' + esc(p.a.name) + ' <span class="faint">+</span> ' + esc(p.b.name) + '</span></div>' +
        '<div class="hint" style="margin-top:4px">overlap ' + p.similarity.toFixed(2) + ' · ' + (p.similarity < 0.08 ? 'very distinct strengths' : p.similarity < 0.3 ? 'complementary with common ground' : 'overlapping') + '</div></div>';
    }).join('');
    var bridges = SPF.engine.bridgeScholars(state.profiles, corpus);
    $('bridgesList').innerHTML = bridges.slice(0, 6).map(function (b, i) {
      return '<div class="rank-item"><div class="rank-head"><span class="rank-num">' + (i + 1) + '</span>' +
        '<span class="rank-name">' + esc(b.profile.name) + '</span><span class="faint small">' + b.bridges + ' links</span></div></div>';
    }).join('');
    var seed = $('teamSeed'); seed.innerHTML = '<option value="">(auto)</option>' + state.profiles.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
  }

  function buildComplementaryTeam() {
    var size = Math.max(2, Math.min(6, +$('teamModeSize').value || 3));
    var seed = $('teamSeed').value || null;
    var res = SPF.engine.complementaryTeam(state.profiles, { size: size, seedId: seed });
    var corpus = SPF.engine.buildCorpus(state.profiles);
    var topics = SPF.engine.suggestTopics(res.members, null, corpus);
    var box = $('teamModeResult'); box.innerHTML = '';
    var mrow = el('div', 'metric-row');
    mrow.innerHTML = metric('Members', String(res.members.length)) + metric('Complementarity', res.metrics.complementarity.toFixed(2)) +
      metric('Overlap', res.metrics.redundancy.toFixed(2)) + metric('Disciplines', String(res.metrics.interdisciplinarity));
    box.appendChild(mrow);
    res.members.forEach(function (m) {
      var g = SPF.extract.groupCapabilities(m);
      var d = el('div', 'team-member');
      d.innerHTML = '<strong>' + esc(m.name) + '</strong> <span class="faint small">' + esc(m.affiliation || '') + '</span>' +
        '<div style="margin-top:6px">' + conceptChips((g.discipline.slice(0, 2).concat(g.method.slice(0, 4)))) + '</div>';
      box.appendChild(d);
    });
    if (topics.length) {
      box.appendChild(el('h3', null, 'Suggested topics'));
      topics.forEach(function (t) { var d = el('div', 'topic', esc(t.text) + '<div class="why">' + esc(t.rationale) + '</div>'); box.appendChild(d); });
    }
  }

  // ---------- settings / LLM ----------
  function loadSettings() {
    SPF.store.getSetting('theme', 'system').then(applyTheme);
    SPF.store.getSetting('pdfEnhanced', false).then(function (v) { $('pdfEnhanced').checked = !!v; if (v) enablePdfJs(); });
    SPF.llm.getConfig().then(function (cfg) {
      $('llmProvider').value = cfg.provider; $('llmKey').value = cfg.apiKey || ''; $('llmModel').value = cfg.model || '';
      $('llmBaseUrl').value = cfg.baseUrl || ''; $('llmEnabled').checked = !!cfg.enabled; $('llmAllowCv').checked = !!cfg.allowCvText;
      $('baseUrlField').hidden = cfg.provider !== 'openai';
      updateLlmBadge();
    });
  }
  function updateLlmBadge() {
    SPF.llm.getConfig().then(function (cfg) {
      var on = cfg.enabled && cfg.apiKey;
      var b = $('llmBadge'); b.textContent = on ? 'On' : 'Off'; b.className = 'badge ' + (on ? 'green' : 'amber');
    });
  }
  function saveLlm() {
    var cfg = {
      provider: $('llmProvider').value, apiKey: $('llmKey').value.trim(), model: $('llmModel').value.trim() || (($('llmProvider').value === 'openai') ? 'gpt-4o-mini' : 'claude-3-5-haiku-latest'),
      baseUrl: $('llmBaseUrl').value.trim(), enabled: $('llmEnabled').checked, allowCvText: $('llmAllowCv').checked
    };
    SPF.llm.setConfig(cfg).then(function () { updateLlmBadge(); toast('AI settings saved'); });
  }
  function testLlm() {
    saveLlm();
    $('llmStatus').textContent = 'Testing...';
    SPF.llm.testConnection().then(function (r) { $('llmStatus').textContent = 'Connected. Provider replied: "' + r.text + '"'; })
      .catch(function (e) { $('llmStatus').textContent = 'Failed: ' + e.message; });
  }

  // ---------- optional pdf.js ----------
  function enablePdfJs() {
    if (SPF.pdfjs && SPF.pdfjs.ready) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = function () {
        try {
          var lib = window.pdfjsLib;
          lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          SPF.pdfjs = {
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
    SPF.store.exportAll().then(function (data) {
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
    $('loadSamplesBtn').onclick = loadSamples;
    $('exportRosterBtn').onclick = exportRoster;
    $('importRosterBtn').onclick = function () { $('importInput').click(); };
    $('importInput').onchange = function (e) { if (e.target.files[0]) importRoster(e.target.files[0]); e.target.value = ''; };
    $('clearRosterBtn').onclick = function () {
      if (!state.profiles.length) return;
      if (!confirm('Remove all ' + state.profiles.length + ' scholars from this device?')) return;
      state.profiles = []; if (SPF.store.available) SPF.store.clearProfiles(); renderRoster(); updateCount(); toast('Roster cleared');
    };

    // roster search
    var rs = $('rosterSearch');
    if (rs) rs.oninput = function () { state.rosterQuery = rs.value; renderRoster(); };

    // RFP: label updates live; releasing a slider re-runs if an analysis exists.
    ['wRelevance', 'wRecent', 'wFunding', 'teamSize'].forEach(function (id) {
      $(id).oninput = function () { $(id + 'V').textContent = $(id).value; };
      $(id).onchange = function () { if (state.baseRfp) reanalyzePreservingScroll(); };
    });
    $('analyzeBtn').onclick = analyze;
    $('rfpSampleBtn').onclick = function () { if (SPF.samples) { $('rfpText').value = SPF.samples.rfp; toast('Loaded sample RFP'); } };
    $('rfpUploadBtn').onclick = function () {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pdf,.docx,.txt,.md,.rtf,.html,.htm';
      inp.onchange = function () { if (inp.files[0]) SPF.parse.parseFile(inp.files[0]).then(function (r) { $('rfpText').value = r.text; if (r.warning) toast(r.warning, true); else toast('Loaded ' + inp.files[0].name); }); };
      inp.click();
    };

    // team explorer
    $('buildTeamBtn').onclick = buildComplementaryTeam;

    // settings
    $('llmProvider').onchange = function () { $('baseUrlField').hidden = $('llmProvider').value !== 'openai'; };
    $('llmSaveBtn').onclick = saveLlm;
    $('llmTestBtn').onclick = testLlm;
    $('pdfEnhanced').onchange = function () {
      var on = $('pdfEnhanced').checked; SPF.store.setSetting('pdfEnhanced', on);
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
    if (SPF.store && SPF.store.available) {
      loadSettings();
      SPF.store.getProfiles().then(function (arr) {
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
})(window.SPF = window.SPF || {});
