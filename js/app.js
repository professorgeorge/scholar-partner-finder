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

  // ---------- custom line-icon set (no emoji, consistent across the app) ----------
  var ICONS = {
    network: '<circle cx="6" cy="8" r="2.3"/><circle cx="18" cy="6" r="2.3"/><circle cx="15" cy="18" r="2.3"/><path d="M8.2 8.7 15.8 6.6"/><path d="M17 8.1 15.6 15.7"/><path d="M13.1 16.8 7.9 9.6"/>',
    upload: '<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5"/><path d="M10 16h5"/>',
    wand: '<path d="M4 20 14 10"/><path d="M15 4.5l1 2.2 2.4.8-2.4.8-1 2.2-1-2.2L11.6 7.5 14 6.7z"/><path d="M6.5 4.5l.5 1.2 1.3.5-1.3.5-.5 1.2-.5-1.2L4.7 6.7 6 6.2z"/>',
    people: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 20c0-3 2.6-5 5.5-5s5.5 2 5.5 5"/><path d="M16 6a3 3 0 0 1 0 6"/><path d="M17 15c2 .6 3.5 2.2 3.5 5"/>',
    search: '<circle cx="11" cy="11" r="6.2"/><path d="M20 20l-4.2-4.2"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/><path d="M12 1v3"/><path d="M12 20v3"/><path d="M1 12h3"/><path d="M20 12h3"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><circle cx="12" cy="15.5" r="1.4"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    layers: '<path d="M12 3 21 8 12 13 3 8z"/><path d="M3 12l9 5 9-5"/><path d="M3 16l9 5 9-5"/>',
    pin: '<path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10z"/><circle cx="12" cy="11" r="2.2"/>'
  };
  function svgIcon(name, size) {
    var s = size || 24;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  function iconBubble(name) { return '<span class="icon-bubble">' + svgIcon(name, 26) + '</span>'; }

  var state = {
    profiles: [],        // active project's roster (a filtered view of _all)
    _all: [],            // every profile across projects, in memory
    projects: [],        // [{id, name, createdAt, isSample}]
    activeProjectId: null,
    lastRfp: null, lastCorpus: null, lastResults: null, lastTeam: null, lastTopics: null,
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

  // ---------- projects (workspaces) ----------
  // Every roster lives inside a named project. A user's projects stay isolated
  // from one another, and the bundled demo data lives in its own sample project
  // so it can never blend into real work.
  var SAMPLE_PROJECT_NAME = 'Sample data';
  function uid(prefix) { return (prefix || 'p_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function currentProject() { return state.projects.filter(function (p) { return p.id === state.activeProjectId; })[0] || null; }
  function refreshActiveProfiles() { state.profiles = state._all.filter(function (p) { return p.projectId === state.activeProjectId; }); }

  function renderProjectSelect() {
    var sel = $('projectSelect'); if (!sel) return;
    var items = state.projects.slice().sort(function (a, b) {
      return ((a.isSample ? 1 : 0) - (b.isSample ? 1 : 0)) || ((a.createdAt || 0) - (b.createdAt || 0));
    });
    sel.innerHTML = items.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === state.activeProjectId ? ' selected' : '') + '>' +
        esc(p.name) + (p.isSample ? ' (demo)' : '') + '</option>';
    }).join('');
  }

  function createProject(name, opts) {
    opts = opts || {};
    var proj = { id: uid(), name: (name || 'Untitled project').trim(), createdAt: Date.now(), isSample: !!opts.isSample };
    state.projects.push(proj);
    if (SPF.store && SPF.store.available) SPF.store.putProject(proj);
    return proj;
  }

  function findSampleProject() { return state.projects.filter(function (p) { return p.isSample; })[0] || null; }

  function switchProject(id) {
    if (!id || id === state.activeProjectId) { renderProjectSelect(); return; }
    state.activeProjectId = id;
    if (SPF.store && SPF.store.available) SPF.store.setSetting('activeProject', id);
    // Entering a different workspace: drop RFP results tied to the old roster.
    state.baseRfp = null; state.lastRfpText = '';
    state.rfpEdits = { removed: [], added: [], boosts: {} };
    state.teamConstraints = { include: [], exclude: [] };
    state.rosterQuery = ''; if ($('rosterSearch')) $('rosterSearch').value = '';
    if ($('rfpResults')) renderRfpEmpty($('rfpResults'));
    refreshActiveProfiles();
    renderProjectSelect(); renderRoster(); updateCount();
  }

  function newProjectPrompt() {
    var name = window.prompt('Name this project (e.g. “NSF Smart Communities” or “College of Engineering roster”):', '');
    if (name === null) return;
    name = name.trim(); if (!name) return;
    var proj = createProject(name);
    switchProject(proj.id);
    setView('roster');
    toast('Created project “' + proj.name + '”. Add CVs to build its roster.');
  }

  function renameActiveProject() {
    var proj = currentProject(); if (!proj) return;
    if (proj.isSample) { toast('The demo project cannot be renamed.', true); return; }
    var name = window.prompt('Rename project:', proj.name);
    if (name === null) return; name = name.trim(); if (!name) return;
    proj.name = name;
    if (SPF.store && SPF.store.available) SPF.store.putProject(proj);
    renderProjectSelect(); renderProjectsPanel(); toast('Renamed to “' + name + '”');
  }

  function deleteActiveProject() {
    var proj = currentProject(); if (!proj) return;
    var realCount = state.projects.filter(function (p) { return !p.isSample; }).length;
    if (!proj.isSample && realCount <= 1) { toast('This is your only project. Create another before deleting it.', true); return; }
    var n = state._all.filter(function (p) { return p.projectId === proj.id; }).length;
    if (!window.confirm('Delete project “' + proj.name + '” and its ' + n + ' scholar' + (n === 1 ? '' : 's') + ' from this device? This cannot be undone.')) return;
    state._all = state._all.filter(function (p) { return p.projectId !== proj.id; });
    state.projects = state.projects.filter(function (p) { return p.id !== proj.id; });
    if (SPF.store && SPF.store.available) { SPF.store.deleteProjectProfiles(proj.id); SPF.store.deleteProject(proj.id); }
    var next = state.projects.filter(function (p) { return !p.isSample; })[0] || state.projects[0];
    state.activeProjectId = null;
    switchProject(next ? next.id : (createProject('My first project').id));
    renderProjectsPanel();
    toast('Deleted project “' + proj.name + '”');
  }

  // Register a freshly built profile into memory under the active project.
  function addProfileToState(prof, projectId) {
    prof.projectId = projectId || state.activeProjectId;
    state._all.push(prof);
    if (prof.projectId === state.activeProjectId) state.profiles.push(prof);
    return prof;
  }

  // ---------- navigation ----------
  function setView(name) {
    ['rfp', 'roster', 'team', 'settings'].forEach(function (v) {
      $('view-' + v).classList.toggle('active', v === name);
    });
    Array.prototype.forEach.call($('nav').children, function (b) { b.classList.toggle('active', b.dataset.view === name); });
    if (name === 'team') renderTeamExplorer();
    if (name === 'settings') renderProjectsPanel();
  }

  function renderProjectsPanel() {
    var box = $('projectsList'); if (!box) return;
    box.innerHTML = '';
    var items = state.projects.slice().sort(function (a, b) {
      return ((a.isSample ? 1 : 0) - (b.isSample ? 1 : 0)) || ((a.createdAt || 0) - (b.createdAt || 0));
    });
    items.forEach(function (p) {
      var count = state._all.filter(function (x) { return x.projectId === p.id; }).length;
      var row = el('div', 'proj-row' + (p.id === state.activeProjectId ? ' active' : ''));
      var info = el('div');
      info.innerHTML = '<strong>' + esc(p.name) + '</strong>' +
        (p.isSample ? ' <span class="badge amber" style="font-size:9px">demo</span>' : '') +
        (p.id === state.activeProjectId ? ' <span class="badge green" style="font-size:9px">active</span>' : '') +
        '<div class="hint">' + count + ' scholar' + (count === 1 ? '' : 's') + '</div>';
      var acts = el('div', 'acts');
      if (p.id !== state.activeProjectId) {
        var open = el('button', 'btn ghost small', 'Open');
        open.onclick = function () { switchProject(p.id); renderProjectsPanel(); };
        acts.appendChild(open);
      }
      row.appendChild(info); row.appendChild(acts);
      box.appendChild(row);
    });
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
    var proj = currentProject();
    if (proj && proj.isSample) {
      var banner = el('div', 'callout warn'); banner.style.margin = '0 14px 10px';
      banner.innerHTML = 'This is bundled <strong>demo data</strong>, kept separate from your own projects. To work with real CVs, switch to (or create) another project.';
      var mk = el('button', 'btn small'); mk.textContent = 'New project'; mk.style.marginTop = '8px'; mk.onclick = newProjectPrompt;
      banner.appendChild(mk);
      box.appendChild(banner);
    }
    if (!state.profiles.length) {
      var msg = proj && proj.isSample
        ? iconBubble('people') + '<p>The demo project is empty. Use <strong>Load 8 sample scholars</strong> on the left.</p>'
        : iconBubble('people') + '<p>No scholars in <strong>' + esc(proj ? proj.name : 'this project') + '</strong> yet.<br>Drop CV files on the left, paste a CV, or choose a folder of CVs. They stay on your device.</p>';
      box.appendChild(el('div', 'empty', msg));
      return;
    }
    var q = (state.rosterQuery || '').trim().toLowerCase();
    var shown = state.profiles.slice()
      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); })
      .filter(function (p) { return profileMatchesQuery(p, q); });
    if (!shown.length) {
      box.appendChild(el('div', 'empty', iconBubble('search') + '<p>No scholars match “' + esc(state.rosterQuery) + '”.</p>'));
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

  // Guided empty state for the RFP view: a short "how it works" with working
  // shortcuts, so a first-time user is never staring at a blank panel.
  function renderRfpEmpty(box) {
    box.innerHTML = '';
    var hasRoster = state.profiles.length > 0;
    var card = el('div', 'card pad guide');
    var head = el('div', 'guide-head');
    head.innerHTML = '<span class="guide-mark">' + svgIcon('network', 30) + '</span>' +
      '<div><h2>Match your scholars to an opportunity</h2>' +
      '<p class="hint">Three steps. Everything runs on your device; nothing is uploaded unless you turn on the optional AI layer.</p></div>';
    card.appendChild(head);

    var steps = el('div', 'guide-steps');
    [
      ['upload', '1 · Build a roster', hasRoster
        ? 'This project has ' + state.profiles.length + ' scholar' + (state.profiles.length === 1 ? '' : 's') + '. Add more any time in the Roster tab.'
        : 'Add faculty CVs (PDF, Word, or text) in the Roster tab. They stay on your device.'],
      ['doc', '2 · Paste the opportunity', 'Drop an RFP, solicitation, or a short topic into the box on the left. The tool reads it as a set of requirements you can edit.'],
      ['wand', '3 · Analyze', 'Get a ranked shortlist, a coverage-maximising team, a coverage matrix, capacity gaps, and collaboration topics, each traceable to specific terms.']
    ].forEach(function (s) {
      var st = el('div', 'guide-step');
      st.innerHTML = '<span class="step-ico">' + svgIcon(s[0], 22) + '</span><div><div class="step-t">' + s[1] + '</div><div class="hint">' + s[2] + '</div></div>';
      steps.appendChild(st);
    });
    card.appendChild(steps);

    var row = el('div', 'btn-row'); row.style.marginTop = '4px';
    if (!hasRoster) {
      var addBtn = el('button', 'btn', 'Add CVs to the roster'); addBtn.onclick = function () { setView('roster'); };
      row.appendChild(addBtn);
      var demoBtn = el('button', 'btn secondary', 'Explore with demo data'); demoBtn.onclick = loadSamples;
      row.appendChild(demoBtn);
    } else {
      var sampleBtn = el('button', 'btn secondary', 'Use a sample RFP');
      sampleBtn.onclick = function () { if (SPF.samples) { $('rfpText').value = SPF.samples.rfp; $('rfpText').focus(); toast('Sample RFP loaded; press Analyze'); } };
      row.appendChild(sampleBtn);
    }
    var helpLink = el('button', 'btn ghost', 'How it works'); helpLink.onclick = openHelp;
    row.appendChild(helpLink);
    card.appendChild(row);
    box.appendChild(card);
  }

  // ---------- help panel ----------
  function helpBodyHtml() {
    function block(icon, t, body) {
      return '<div class="help-row"><span class="step-ico">' + svgIcon(icon, 22) + '</span><div><div class="step-t">' + t + '</div><div class="hint">' + body + '</div></div></div>';
    }
    return '' +
      '<p class="hint">Scholar Partner Finder helps you assemble a research team for a funding opportunity, and explains every choice. It runs entirely in your browser.</p>' +
      '<h3 class="help-h">The workflow</h3>' +
      block('layers', 'Projects', 'Each project is a separate workspace with its own roster. Switch or create projects from the top bar. The bundled demo data lives in its own sample project and never mixes with your real work.') +
      block('upload', 'Roster', 'Add CVs by dropping files, choosing a folder, or pasting text. Reading a CV is imperfect, so open any scholar to fix the name, remove a wrong capability, or add a tag. Curated tags count strongly.') +
      block('doc', 'RFP Talent Search', 'Paste an opportunity and press Analyze. You can edit the requirements the tool extracted, mark some as a must, pin or exclude scholars, and export the result as HTML or CSV.') +
      block('network', 'Team Explorer', 'Independent of any RFP, this surfaces complementary pairs and the bridge scholars who connect many others.') +
      '<h3 class="help-h">Reading the team metrics</h3>' +
      '<ul class="help-list">' +
      '<li><strong>Requirement coverage</strong>: the share of the opportunity\'s requirements the team addresses.</li>' +
      '<li><strong>Complementarity</strong>: how distinct the members\' strengths are (higher is more distinct).</li>' +
      '<li><strong>Overlap</strong>: how much the members duplicate one another (lower is better).</li>' +
      '<li><strong>Disciplines</strong>: how many distinct disciplines the team spans.</li>' +
      '<li><strong>Team fit</strong>: coverage adjusted for complementarity. The parts are always shown, never just this one number.</li>' +
      '</ul>' +
      '<h3 class="help-h">Privacy</h3>' +
      block('lock', 'Your documents stay on your device', 'CV text, profiles, and rosters are stored locally in your browser. Nothing is transmitted unless you explicitly enable the optional AI layer in Settings and provide your own API key.') +
      '<p class="hint" style="margin-top:12px">Outputs are heuristic aids for your judgment, not advice or decisions. See the disclaimer at the foot of the page.</p>';
  }
  function openHelp() { $('helpBody').innerHTML = helpBodyHtml(); $('helpBackdrop').classList.add('open'); }
  function closeHelp() { $('helpBackdrop').classList.remove('open'); }

  function persist(p) {
    if (state.activeProjectId && p.projectId == null) p.projectId = state.activeProjectId;
    if (SPF.store && SPF.store.available) return SPF.store.putProfile(p);
    return Promise.resolve();
  }

  function removeProfile(p) {
    state.profiles = state.profiles.filter(function (x) { return x.id !== p.id; });
    state._all = state._all.filter(function (x) { return x.id !== p.id; });
    if (SPF.store && SPF.store.available) SPF.store.deleteProfile(p.id);
    renderRoster(); updateCount();
  }

  // ---------- file ingestion ----------
  var ACCEPT = /\.(pdf|docx|doc|txt|md|markdown|rtf|html?|json)$/i;

  function normName(n) { return String(n || '').trim().toLowerCase().replace(/\s+/g, ' '); }

  // Guard: keep the user's own CVs out of the read-only demo project.
  function blockedBySampleProject() {
    var proj = currentProject();
    if (proj && proj.isSample) {
      toast('The demo project is for sample data only. Create or switch to another project to add your own CVs.', true);
      newProjectPrompt();
      return true;
    }
    return false;
  }

  async function ingestFiles(files) {
    var list = Array.prototype.slice.call(files).filter(function (f) { return ACCEPT.test(f.name); });
    if (!list.length) { toast('No supported files found (PDF, DOCX, TXT, MD, RTF, HTML).', true); return; }
    if (blockedBySampleProject()) return;
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
        addProfileToState(prof);
        await persist(prof);
        added++;
      } catch (e) { toast('Failed: ' + f.name + ' — ' + e.message, true); }
    }
    renderRoster(); updateCount();
    if (added) toast('Added ' + added + ' scholar' + (added === 1 ? '' : 's') + ' to “' + esc(currentProject() ? currentProject().name : '') + '”' +
      (warned ? ' (' + warned + ' with parse warnings)' : '') + (dupes ? '; skipped ' + dupes + ' already in roster' : ''));
    else if (dupes) toast('All ' + dupes + ' already in this project (matched by name).', true);
  }

  function addFromText() {
    var txt = $('pasteCv').value.trim();
    if (txt.length < 40) { toast('Paste a longer CV.', true); return; }
    if (blockedBySampleProject()) return;
    var prof = SPF.extract.buildProfile(txt, { filename: '' });
    addProfileToState(prof); persist(prof);
    $('pasteCv').value = '';
    renderRoster(); updateCount(); toast('Added ' + prof.name);
    openScholar(prof);
  }

  // Load the bundled demo scholars into their own sample project, creating and
  // switching to it so demo data never lands in a real roster.
  function loadSamples() {
    if (!SPF.samples) { toast('Sample data unavailable.', true); return; }
    var demo = findSampleProject() || createProject(SAMPLE_PROJECT_NAME, { isSample: true });
    if (state.activeProjectId !== demo.id) switchProject(demo.id);
    var existing = {}; state.profiles.forEach(function (p) { existing[normName(p.name)] = true; });
    var n = 0;
    SPF.samples.scholars.forEach(function (s) {
      var prof = SPF.extract.buildProfile(s.text, { filename: s.filename });
      prof.sample = true;
      if (existing[normName(prof.name)]) return;
      addProfileToState(prof, demo.id); persist(prof); n++;
    });
    renderRoster(); updateCount();
    if (!$('rfpText').value.trim()) $('rfpText').value = SPF.samples.rfp;
    setView('roster');
    toast(n ? ('Loaded ' + n + ' sample scholars into the demo project') : 'Demo project already loaded');
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
  // Export only the active project's roster, so a shared file carries one
  // project's scholars and cannot smuggle in another's.
  function exportRoster() {
    var proj = currentProject();
    var data = {
      version: 2, exportedAt: Date.now(),
      projectName: proj ? proj.name : 'roster',
      profiles: state.profiles.map(function (p) { return Object.assign({}, p, { projectId: undefined }); })
    };
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    var safe = (proj ? proj.name : 'roster').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'roster';
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'scholar-roster-' + safe + '.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  // Import always lands in a new project, so imported scholars never merge into
  // an existing roster by surprise.
  function importRoster(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var data = JSON.parse(r.result);
        var arr = data.profiles || data;
        if (!Array.isArray(arr)) throw new Error('No profiles in file.');
        var base = (data.projectName || file.name.replace(/\.json$/i, '') || 'Imported roster');
        var proj = createProject('Imported: ' + base);
        switchProject(proj.id);
        var seen = {}; var n = 0;
        arr.forEach(function (p) {
          if (!p) return;
          var nk = normName(p.name);
          if (nk && nk !== 'unnamed scholar' && seen[nk]) return;
          seen[nk] = true;
          p.id = p.id || ('s_' + Math.random().toString(36).slice(2, 10));
          addProfileToState(p, proj.id); persist(p); n++;
        });
        renderProjectSelect(); renderRoster(); updateCount();
        toast('Imported ' + n + ' scholars into “' + proj.name + '”');
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
      var proj = currentProject();
      if (!confirm('Remove all ' + state.profiles.length + ' scholars from “' + (proj ? proj.name : 'this project') + '”? Other projects are not affected.')) return;
      var ids = {}; state.profiles.forEach(function (p) { ids[p.id] = true; });
      state._all = state._all.filter(function (p) { return !ids[p.id]; });
      state.profiles = [];
      if (SPF.store && SPF.store.available && proj) SPF.store.deleteProjectProfiles(proj.id);
      renderRoster(); updateCount(); toast('Roster cleared for this project');
    };

    // projects
    if ($('projectSelect')) $('projectSelect').onchange = function () { switchProject($('projectSelect').value); };
    if ($('newProjectBtn')) $('newProjectBtn').onclick = newProjectPrompt;
    if ($('renameProjectBtn')) $('renameProjectBtn').onclick = renameActiveProject;
    if ($('deleteProjectBtn')) $('deleteProjectBtn').onclick = deleteActiveProject;
    if ($('newProjectBtn2')) $('newProjectBtn2').onclick = newProjectPrompt;

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

    // help
    if ($('helpBtn')) $('helpBtn').onclick = openHelp;
    if ($('helpClose')) $('helpClose').onclick = closeHelp;
    if ($('helpDone')) $('helpDone').onclick = closeHelp;
    if ($('helpBackdrop')) $('helpBackdrop').addEventListener('click', function (e) { if (e.target === $('helpBackdrop')) closeHelp(); });

    // modal
    $('modalClose').onclick = closeModal;
    $('modalBackdrop').addEventListener('click', function (e) { if (e.target === $('modalBackdrop')) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); closeHelp(); } });
  }

  // ---------- init ----------
  function bootstrapProjects(activeId) {
    if (!state.projects.length) {
      // First run, or data from before projects existed: create a default
      // project and adopt any pre-existing profiles into it so nothing is lost.
      var def = createProject('My first project');
      state._all.forEach(function (p) { if (p.projectId == null) { p.projectId = def.id; if (SPF.store && SPF.store.available) SPF.store.putProfile(p); } });
      activeId = def.id;
    } else {
      var home = state.projects.filter(function (p) { return !p.isSample; })[0] || state.projects[0];
      state._all.forEach(function (p) { if (p.projectId == null) { p.projectId = home.id; if (SPF.store && SPF.store.available) SPF.store.putProfile(p); } });
      if (!activeId || !state.projects.some(function (p) { return p.id === activeId; })) activeId = home.id;
    }
    state.activeProjectId = activeId;
    if (SPF.store && SPF.store.available) SPF.store.setSetting('activeProject', activeId);
    refreshActiveProfiles();
  }
  function finishInit() { renderProjectSelect(); renderRoster(); updateCount(); renderProjectsPanel(); if ($('rfpResults')) renderRfpEmpty($('rfpResults')); }

  function init() {
    wire();
    if (SPF.store && SPF.store.available) {
      loadSettings();
      Promise.all([SPF.store.getProjects(), SPF.store.getProfiles(), SPF.store.getSetting('activeProject', null)])
        .then(function (res) {
          state.projects = res[0] || [];
          state._all = res[1] || [];
          bootstrapProjects(res[2]);
          finishInit();
        }).catch(function () { bootstrapProjects(null); finishInit(); });
    } else {
      applyTheme('system');
      bootstrapProjects(null);
      finishInit();
      toast('Local storage is unavailable; your projects will not persist between sessions.', true);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.SPF = window.SPF || {});
