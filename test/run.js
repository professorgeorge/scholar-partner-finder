/*
 * Node harness: exercises parse -> extract -> engine on the sample corpus.
 * Run with: node test/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Load the browser modules; each IIFE attaches to globalThis.GCX.
require('../js/lexicon.js');
require('../js/parse.js');
require('../js/extract.js');
require('../js/engine.js');
const GCX = globalThis.GCX;

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
    const parsed = await GCX.parse.parseBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), f);
    const prof = GCX.extract.buildProfile(parsed.text, { filename: f, currentYear: 2026 });
    profiles.push(prof);
    const groups = GCX.extract.groupCapabilities(prof);
    console.log(`  ${prof.name} <${prof.email}> | methods: ${groups.method.map(m => m.term).slice(0,3).join(', ')} | disciplines: ${groups.discipline.map(m => m.term).slice(0,2).join(', ')}`);
  }
  assert(profiles.length === cvFiles.length, `profiled all ${cvFiles.length} CVs`);
  assert(profiles.every(p => p.name && p.name !== 'Unnamed scholar'), 'every profile has a name');
  assert(profiles.every(p => p.email.includes('@')), 'every profile has an email');

  // ---- 2. DOCX and PDF fixtures ---------------------------------------
  hr('Binary format parsers');
  if (fs.existsSync(path.join(FIX, 'sample.docx'))) {
    const b = fs.readFileSync(path.join(FIX, 'sample.docx'));
    const r = await GCX.parse.parseBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'sample.docx');
    console.log('  docx text (first 90 chars): ' + JSON.stringify(r.text.slice(0, 90)));
    assert(/machine learning/i.test(r.text) && /water resources/i.test(r.text), 'DOCX parser recovered expected text');
  } else { console.log('  (no docx fixture)'); }
  if (fs.existsSync(path.join(FIX, 'sample.pdf'))) {
    const b = fs.readFileSync(path.join(FIX, 'sample.pdf'));
    const r = await GCX.parse.parseBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'sample.pdf');
    console.log('  pdf text (first 90 chars): ' + JSON.stringify(r.text.slice(0, 90)));
    assert(/machine learning/i.test(r.text), 'PDF parser recovered expected text from content stream');
  } else { console.log('  (no pdf fixture)'); }

  // ---- 3. RFP analysis ------------------------------------------------
  hr('RFP analysis');
  const rfpText = fs.readFileSync(path.join(SAMPLES, 'rfp_smart_communities.txt'), 'utf8');
  const rfp = GCX.engine.analyzeRFP(rfpText);
  const topRfp = Object.keys(rfp.tf).sort((a,b)=>rfp.tf[b]-rfp.tf[a]).slice(0,12);
  console.log('  top RFP concepts: ' + topRfp.join(', '));
  console.log('  detected themes: ' + rfp.themes.join(', '));
  assert(rfp.themes.length > 0, 'RFP themes detected');
  assert(Object.keys(rfp.tf).some(t => /water/.test(t)) , 'RFP includes water requirement');

  // ---- 4. Individual ranking ------------------------------------------
  hr('Scholar ranking for RFP');
  const corpus = GCX.engine.buildCorpus(profiles, [rfp.tf]);
  const ranked = GCX.engine.scoreScholarsForRFP(profiles, rfp, {}, corpus);
  ranked.forEach((r, i) => {
    console.log(`  ${i+1}. ${r.profile.name}  composite=${r.composite.toFixed(3)} relevance=${r.relevance.toFixed(3)}  [${r.matched.slice(0,4).map(m=>m.term).join(', ')}]`);
  });
  const top4 = ranked.slice(0,4).map(r => r.profile.name);
  assert(!top4.includes('Henry Okafor'), 'off-topic cybersecurity scholar is not in the top 4');
  assert(ranked[0].relevance > ranked[ranked.length-1].relevance, 'ranking is ordered by fit');

  // ---- 5. Team assembly + coverage + gaps -----------------------------
  hr('Team assembly (coverage-maximising, size 4)');
  const team = GCX.engine.assembleTeam(profiles, rfp, { size: 4 }, corpus);
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
  const poolGaps = GCX.engine.poolGapAnalysis(profiles, rfp, corpus);
  console.log('  capacity gaps (no one in pool): ' + poolGaps.map(g=>g.term).join(' | '));
  assert(poolGaps.some(g => /desalination|indigenous/.test(g.term)), 'capacity gap detects desalination or indigenous knowledge (nobody has it)');

  // ---- 6. Bridge scholars ---------------------------------------------
  hr('Bridge scholars (connectors)');
  const bridges = GCX.engine.bridgeScholars(profiles, GCX.engine.buildCorpus(profiles));
  bridges.slice(0,3).forEach((b,i)=> console.log(`  ${i+1}. ${b.profile.name}  centrality=${b.centrality.toFixed(3)} links=${b.bridges}`));
  assert(bridges.length === profiles.length, 'bridge score computed for every scholar');

  // ---- 7. Complementary pairs (team mode) -----------------------------
  hr('Complementary pairs (no RFP)');
  const pairs = GCX.engine.complementaryPairs(profiles, GCX.engine.buildCorpus(profiles), 5);
  pairs.forEach((p,i)=> console.log(`  ${i+1}. ${p.a.name} + ${p.b.name}  score=${p.score.toFixed(2)} sim=${p.similarity.toFixed(2)}`));
  assert(pairs.length === 5, 'returned top complementary pairs');

  // ---- 8. Topic suggestions -------------------------------------------
  hr('Collaboration topic suggestions (team)');
  const topics = GCX.engine.suggestTopics(team.members.map(m=>m.profile), rfp, corpus);
  topics.forEach((t,i)=> console.log(`  ${i+1}. ${t.text}`));
  assert(topics.length > 0, 'generated at least one collaboration topic');

  // ---- 9. Find Funding: offline reuse of the engine, run in reverse -----
  // (one scholar vs many opportunity documents, instead of one RFP vs many
  // scholars). No network call here; this only exercises the ranking math,
  // which is what js/opportunities.js adds on top of live Grants.gov data.
  hr('Find Funding: scholar-vs-opportunities ranking (offline)');
  require('../js/store.js'); require('../js/opportunities.js'); require('../js/llm.js');
  const ada = profiles.find(p => /Ada Nwosu/.test(p.name));
  const ben = profiles.find(p => /Ben Carter/.test(p.name));
  const kws = GCX.opportunities.topKeywords(ada, 4);
  assert(kws.length > 0 && kws.length <= 4, `derived ${kws.length} search keyword(s) for a scholar: ${kws.join(', ')}`);
  const aiOpp = { id: 'AI1', title: 'AI and NLP for Public Services', agency: 'NSF',
    text: 'Seeks proposals on artificial intelligence, natural language processing, and machine learning for government service delivery.' };
  const waterOpp = { id: 'W1', title: 'Coastal Water Infrastructure Resilience', agency: 'EPA',
    text: 'Seeks proposals on water infrastructure, geospatial analysis, and environmental science for coastal climate resilience.' };
  const rankedForAda = GCX.opportunities._rankForProfile(ada, [waterOpp, aiOpp]);
  const rankedForBen = GCX.opportunities._rankForProfile(ben, [waterOpp, aiOpp]);
  console.log(`  Ada (NLP/ML) ranks: ${rankedForAda.map(r => r.opportunity.id + '=' + r.relevance.toFixed(2)).join(', ')}`);
  console.log(`  Ben (water/geospatial) ranks: ${rankedForBen.map(r => r.opportunity.id + '=' + r.relevance.toFixed(2)).join(', ')}`);
  assert(rankedForAda[0].opportunity.id === 'AI1', 'the AI/NLP opportunity ranks first for an AI/NLP scholar');
  assert(rankedForBen[0].opportunity.id === 'W1', 'the water-infrastructure opportunity ranks first for a water/geospatial scholar');
  assert(rankedForAda[0].matched.length > 0, 'a top match is explainable via shared terms, same as RFP Talent Search');

  // Local-relay URL routing (pure logic; no network, no IndexedDB involved).
  const directUrls = GCX.opportunities._urlsFor({ proxyBaseUrl: '' });
  assert(directUrls.search === 'https://api.grants.gov/v1/api/search2', 'defaults to calling Grants.gov directly when no relay is set');
  const proxiedUrls = GCX.opportunities._urlsFor({ proxyBaseUrl: 'http://127.0.0.1:8787/' });
  assert(proxiedUrls.search === 'http://127.0.0.1:8787/v1/api/search2', 'routes through the local relay when one is configured (trailing slash handled)');
  assert(proxiedUrls.fetch === 'http://127.0.0.1:8787/v1/api/fetchOpportunity', 'relay routing covers the detail-fetch endpoint too');

  // ---- 10. Optional AI layer: new explain* helpers (mocked provider) -----
  // No real network call or API key involved: global.fetch is stubbed to
  // return a canned Anthropic-shaped reply, which is enough to exercise the
  // prompt construction and JSON-parsing path for the new functions without
  // depending on network access or a real key.
  hr('AI layer: explainGaps / explainMatches (mocked provider, no network)');
  const originalFetch = global.fetch;
  function mockReply(json) {
    global.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(json) }] }) });
  }
  await GCX.llm.setConfig({ enabled: true, apiKey: 'test-key', provider: 'anthropic', model: 'test' }).catch(() => {}); // store is unavailable in Node; cache is still set synchronously
  assert(GCX.llm.isEnabled(), 'AI layer reports enabled once a key is set, even without IndexedDB');

  mockReply([{ title: 'indigenous knowledge', detail: 'Seek a tribal-liaison co-PI or a partnership with a Native-serving institution.' }]);
  const gapGuidance = await GCX.llm.explainGaps([{ term: 'indigenous knowledge', category: 'theme' }], rfp.text);
  assert(gapGuidance.length === 1 && /tribal|Native/.test(gapGuidance[0].detail), 'explainGaps returns concrete, parsed guidance from a mocked reply');

  mockReply([{ title: aiOpp.title, detail: 'Strong fit given the NLP background; frame the proposal around service-delivery chatbots.' }]);
  const matchExplain = await GCX.llm.explainMatches(ada, rankedForAda, kws);
  assert(matchExplain.length === 1 && matchExplain[0].title === aiOpp.title, 'explainMatches returns guidance keyed to the right opportunity title');

  global.fetch = originalFetch;

  hr(failures === 0 ? 'ALL CHECKS PASSED' : (failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
