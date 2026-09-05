/*
 * Node harness: exercises parse -> extract -> engine on the sample corpus.
 * Run with: node test/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Load the browser modules; each IIFE attaches to globalThis.SPF.
require('../js/lexicon.js');
require('../js/parse.js');
require('../js/extract.js');
require('../js/engine.js');
const SPF = globalThis.SPF;

const SAMPLES = path.join(__dirname, '..', 'samples');
const FIX = path.join(__dirname, 'fixtures');

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  PASS ' + msg); }
  else { console.log('  FAIL ' + msg); failures++; }
}
function hr(t) { console.log('\n=== ' + t + ' ==='); }

async function main() {
  // ---- 1. Parse + profile every sample CV -----------------------------
  hr('Parse and profile CVs');
  const cvFiles = fs.readdirSync(SAMPLES).filter(f => f.startsWith('cv_') && f.endsWith('.txt'));
  const profiles = [];
  for (const f of cvFiles) {
    const buf = fs.readFileSync(path.join(SAMPLES, f));
    const parsed = await SPF.parse.parseBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), f);
    const prof = SPF.extract.buildProfile(parsed.text, { filename: f, currentYear: 2026 });
    profiles.push(prof);
    const groups = SPF.extract.groupCapabilities(prof);
    console.log(`  ${prof.name} <${prof.email}> | methods: ${groups.method.map(m => m.term).slice(0,3).join(', ')} | disciplines: ${groups.discipline.map(m => m.term).slice(0,2).join(', ')}`);
  }
  assert(profiles.length === cvFiles.length, `profiled all ${cvFiles.length} CVs`);
  assert(profiles.every(p => p.name && p.name !== 'Unnamed scholar'), 'every profile has a name');
  assert(profiles.every(p => p.email.includes('@')), 'every profile has an email');

  // ---- 2. DOCX and PDF fixtures ---------------------------------------
  hr('Binary format parsers');
  if (fs.existsSync(path.join(FIX, 'sample.docx'))) {
    const b = fs.readFileSync(path.join(FIX, 'sample.docx'));
    const r = await SPF.parse.parseBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'sample.docx');
    console.log('  docx text (first 90 chars): ' + JSON.stringify(r.text.slice(0, 90)));
    assert(/machine learning/i.test(r.text) && /water resources/i.test(r.text), 'DOCX parser recovered expected text');
  } else { console.log('  (no docx fixture)'); }
  if (fs.existsSync(path.join(FIX, 'sample.pdf'))) {
    const b = fs.readFileSync(path.join(FIX, 'sample.pdf'));
    const r = await SPF.parse.parseBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'sample.pdf');
    console.log('  pdf text (first 90 chars): ' + JSON.stringify(r.text.slice(0, 90)));
    assert(/machine learning/i.test(r.text), 'PDF parser recovered expected text from content stream');
  } else { console.log('  (no pdf fixture)'); }

  // ---- 3. RFP analysis ------------------------------------------------
  hr('RFP analysis');
  const rfpText = fs.readFileSync(path.join(SAMPLES, 'rfp_smart_communities.txt'), 'utf8');
  const rfp = SPF.engine.analyzeRFP(rfpText);
  const topRfp = Object.keys(rfp.tf).sort((a,b)=>rfp.tf[b]-rfp.tf[a]).slice(0,12);
  console.log('  top RFP concepts: ' + topRfp.join(', '));
  console.log('  detected themes: ' + rfp.themes.join(', '));
  assert(rfp.themes.length > 0, 'RFP themes detected');
  assert(Object.keys(rfp.tf).some(t => /water/.test(t)) , 'RFP includes water requirement');

  // ---- 4. Individual ranking ------------------------------------------
  hr('Scholar ranking for RFP');
  const corpus = SPF.engine.buildCorpus(profiles, [rfp.tf]);
  const ranked = SPF.engine.scoreScholarsForRFP(profiles, rfp, {}, corpus);
  ranked.forEach((r, i) => {
    console.log(`  ${i+1}. ${r.profile.name}  composite=${r.composite.toFixed(3)} relevance=${r.relevance.toFixed(3)}  [${r.matched.slice(0,4).map(m=>m.term).join(', ')}]`);
  });
  const top4 = ranked.slice(0,4).map(r => r.profile.name);
  assert(!top4.includes('Henry Okafor'), 'off-topic cybersecurity scholar is not in the top 4');
  assert(ranked[0].relevance > ranked[ranked.length-1].relevance, 'ranking is ordered by fit');

  // ---- 5. Team assembly + coverage + gaps -----------------------------
  hr('Team assembly (coverage-maximising, size 4)');
  const team = SPF.engine.assembleTeam(profiles, rfp, { size: 4 }, corpus);
  team.members.forEach((m, i) => {
    console.log(`  ${i+1}. ${m.profile.name}  (relevance ${m.relevance.toFixed(3)}) contributes: ${m.contributes.slice(0,4).map(c=>c.term).join(', ')}`);
  });
  console.log(`  coverage=${(team.coverage*100).toFixed(1)}%  complementarity=${team.complementarity.toFixed(2)}  redundancy=${team.redundancy.toFixed(2)}  interdisciplinarity=${team.interdisciplinarity}  teamFit=${team.teamFit.toFixed(3)}`);
  assert(team.members.length === 4, 'assembled a team of 4');
  assert(team.coverage > 0.4, 'team covers a substantial share of RFP requirements');
  assert(team.interdisciplinarity >= 3, 'team spans at least three disciplines');
  const teamNames = team.members.map(m=>m.profile.name);
  assert(teamNames.includes('Ada Nwosu') || teamNames.includes('Farid Hassan'), 'team includes an AI/ML or data-science capability');
  assert(teamNames.includes('Ben Carter'), 'team includes water-resources capability');

  hr('Gap analysis (team and pool)');
  console.log('  team gaps: ' + team.gaps.slice(0,6).map(g=>g.term+(g.noOneInPool?' [none in pool]':'')).join(' | '));
  const poolGaps = SPF.engine.poolGapAnalysis(profiles, rfp, corpus);
  console.log('  capacity gaps (no one in pool): ' + poolGaps.map(g=>g.term).join(' | '));
  assert(poolGaps.some(g => /desalination|indigenous/.test(g.term)), 'capacity gap detects desalination or indigenous knowledge (nobody has it)');

  // ---- 6. Bridge scholars ---------------------------------------------
  hr('Bridge scholars (connectors)');
  const bridges = SPF.engine.bridgeScholars(profiles, SPF.engine.buildCorpus(profiles));
  bridges.slice(0,3).forEach((b,i)=> console.log(`  ${i+1}. ${b.profile.name}  centrality=${b.centrality.toFixed(3)} links=${b.bridges}`));
  assert(bridges.length === profiles.length, 'bridge score computed for every scholar');

  // ---- 7. Complementary pairs (team mode) -----------------------------
  hr('Complementary pairs (no RFP)');
  const pairs = SPF.engine.complementaryPairs(profiles, SPF.engine.buildCorpus(profiles), 5);
  pairs.forEach((p,i)=> console.log(`  ${i+1}. ${p.a.name} + ${p.b.name}  score=${p.score.toFixed(2)} sim=${p.similarity.toFixed(2)}`));
  assert(pairs.length === 5, 'returned top complementary pairs');

  // ---- 8. Topic suggestions -------------------------------------------
  hr('Collaboration topic suggestions (team)');
  const topics = SPF.engine.suggestTopics(team.members.map(m=>m.profile), rfp, corpus);
  topics.forEach((t,i)=> console.log(`  ${i+1}. ${t.text}`));
  assert(topics.length > 0, 'generated at least one collaboration topic');

  hr(failures === 0 ? 'ALL CHECKS PASSED' : (failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
