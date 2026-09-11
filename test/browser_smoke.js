/*
 * Headless-Chromium smoke test over the DevTools Protocol (no external deps).
 * Serves the app, drives real DOM interactions, and fails on any uncaught
 * exception or console error.
 */
'use strict';
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = 8099;
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.join(ROOT, p);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const srv = await serve();
  const userDir = '/tmp/cdp-' + Date.now();
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=9222', '--user-data-dir=' + userDir, 'about:blank'
  ], { stdio: 'ignore' });

  // Wait for the debugging endpoint.
  let ver = null;
  for (let i = 0; i < 50; i++) { try { ver = JSON.parse(await httpGet('http://127.0.0.1:9222/json/version')); break; } catch (e) { await sleep(200); } }
  if (!ver) throw new Error('Chrome DevTools endpoint did not come up');

  let targets = JSON.parse(await httpGet('http://127.0.0.1:9222/json'));
  let page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0; const pending = {}; const errors = []; const consoleErrs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrs.push(m.params.args.map(a => a.value || a.description || '').join(' '));
    }
  };
  const send = (method, params) => new Promise((res) => { const id = ++msgId; pending[id] = res; ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };

  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
  await sleep(1200);

  let fail = 0; const check = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };

  const title = await evalJs('document.title');
  check(title === 'Grant Crosswalk', 'page title loaded: ' + title);
  check(await evalJs('typeof GCX!=="undefined" && !!GCX.engine'), 'GCX modules present in the browser');

  // Populate the roster the same way a real user would: paste each CV's text
  // and click "Add from text". These CV fixtures are test-only (samples/) and
  // are never shipped to or seen by a real user of the app.
  const sampleDir = path.join(ROOT, 'samples');
  const cvTexts = fs.readdirSync(sampleDir).filter(f => f.startsWith('cv_')).map(f => fs.readFileSync(path.join(sampleDir, f), 'utf8'));
  const rfpFixtureText = fs.readFileSync(path.join(sampleDir, 'rfp_smart_communities.txt'), 'utf8');
  await evalJs(`(async () => {
    const texts = ${JSON.stringify(cvTexts)};
    for (const t of texts) {
      document.getElementById('pasteCv').value = t;
      document.getElementById('addPasteBtn').click();
      await new Promise(r => setTimeout(r, 120));
    }
  })()`);
  await sleep(400);
  const count = await evalJs("document.getElementById('rosterCount').textContent");
  check(/8 scholars/.test(count), 'added 8 scholars via the paste-CV flow (' + count + ')');
  const rosterActive = await evalJs("document.getElementById('view-roster').classList.contains('active')");
  check(rosterActive, 'Roster is the default landing view');
  const onboardingText = await evalJs("document.getElementById('onboarding').innerText");
  check(!/sample/i.test(onboardingText), 'onboarding banner does not reference the removed sample-data feature');

  // Go to RFP view, paste a sample RFP as a real user would, run analysis
  await evalJs("document.querySelector('[data-view=rfp]').click()");
  await evalJs(`document.getElementById('rfpText').value = ${JSON.stringify(rfpFixtureText)}`);
  await evalJs("document.getElementById('analyzeBtn').click()");
  await sleep(600);
  const resText = await evalJs("document.getElementById('rfpResults').innerText");
  check(/Recommended team/.test(resText), 'team section rendered');
  check(/Requirement coverage/.test(resText), 'coverage metric rendered');
  check(/Capacity gaps/.test(resText), 'capacity gaps section rendered');
  check(/Collaboration topics/.test(resText), 'topics section rendered');
  check(/Full ranking/.test(resText), 'full ranking rendered');
  check(/Ben Carter/.test(resText), 'a known scholar appears in results');

  // Team explorer
  await evalJs("document.querySelector('[data-view=team]').click()");
  await sleep(300);
  const pairs = await evalJs("document.getElementById('pairsList').innerText");
  check(pairs.length > 10, 'complementary pairs rendered');
  await evalJs("document.getElementById('buildTeamBtn').click()");
  await sleep(300);
  const teamResultHtml = await evalJs("document.getElementById('teamModeResult').innerHTML");
  check(!/Draft richer proposals with AI/.test(teamResultHtml), 'AI proposal button is absent while the AI layer is off (default)');

  // Find Funding: gated by consent until enabled in Settings
  await evalJs("document.querySelector('[data-view=funding]').click()");
  await sleep(200);
  const pickerOptions = await evalJs("document.getElementById('fundingScholarSelect').options.length");
  check(pickerOptions === 8, 'funding scholar picker populated (' + pickerOptions + ' options)');
  await evalJs("document.getElementById('fundingSearchBtn').click()");
  await sleep(300);
  const gatedText = await evalJs("document.getElementById('fundingResults').innerText");
  check(/turned off/.test(gatedText), 'search is consent-gated until enabled in Settings');

  // Enable it, then confirm the feature degrades gracefully with no
  // internet access in this sandbox (a real deployment would return results).
  await evalJs("document.querySelector('[data-view=settings]').click()");
  await sleep(150);
  await evalJs("document.getElementById('fundingEnabled').checked = true; document.getElementById('fundingSaveBtn').click()");
  await sleep(150);
  await evalJs("document.querySelector('[data-view=funding]').click()");
  await sleep(150);
  await evalJs("document.getElementById('fundingSearchBtn').click()");
  await sleep(2000);
  const searchedText = await evalJs("document.getElementById('fundingResults').innerText");
  check(/Matches for|Could not search Grants\.gov/.test(searchedText), 'funding search resolved (live results or graceful fallback)');
  if (/Could not search/.test(searchedText)) {
    const hasManualLink = await evalJs("!!document.querySelector('#fundingResults a[href*=\"grants.gov\"]')");
    check(hasManualLink, 'fallback includes a manual grants.gov search link');
  }

  // LLM provider dropdown: switching providers should auto-fill the base URL
  // with that provider's default and update the key-field hint, without a
  // real network call.
  await evalJs("document.querySelector('[data-view=settings]').click()");
  await sleep(150);
  await evalJs("document.getElementById('llmProvider').value = 'gemini'; document.getElementById('llmProvider').dispatchEvent(new Event('change'))");
  await sleep(100);
  const geminiBaseUrl = await evalJs("document.getElementById('llmBaseUrl').value");
  check(geminiBaseUrl === 'https://generativelanguage.googleapis.com/v1beta', `switching to Gemini auto-fills its base URL (got "${geminiBaseUrl}")`);
  await evalJs("document.getElementById('llmProvider').value = 'ollama'; document.getElementById('llmProvider').dispatchEvent(new Event('change'))");
  await sleep(100);
  const ollamaKeyPlaceholder = await evalJs("document.getElementById('llmKey').placeholder");
  check(/not required/i.test(ollamaKeyPlaceholder), 'switching to Ollama shows a "no key required" hint on the key field');
  const ollamaBaseUrl = await evalJs("document.getElementById('llmBaseUrl').value");
  check(ollamaBaseUrl === 'http://localhost:11434/v1', `switching to Ollama auto-fills its local base URL (got "${ollamaBaseUrl}")`);
  await evalJs("document.getElementById('llmProvider').value = 'anthropic'; document.getElementById('llmProvider').dispatchEvent(new Event('change'))");
  await sleep(100);
  const baseUrlHiddenForAnthropic = await evalJs("document.getElementById('baseUrlField').hidden");
  check(baseUrlHiddenForAnthropic === true, 'the base URL field hides again when switching back to Anthropic');

  // Roster edit modal opens
  await evalJs("document.querySelector('[data-view=roster]').click()");
  await sleep(200);
  const opened = await evalJs("(function(){var b=document.querySelector('#rosterList .btn.ghost'); if(!b) return false; b.click(); return document.getElementById('modalBackdrop').classList.contains('open');})()");
  check(opened === true, 'scholar edit modal opens');

  check(errors.length === 0, 'no uncaught exceptions' + (errors.length ? ': ' + errors.join(' | ') : ''));
  check(consoleErrs.filter(e => !/service-worker|Failed to register|404/.test(e)).length === 0, 'no console errors' + (consoleErrs.length ? ': ' + consoleErrs.join(' | ') : ''));

  ws.close(); chrome.kill(); srv.close();
  console.log(fail === 0 ? '\n=== BROWSER SMOKE PASSED ===' : '\n=== ' + fail + ' BROWSER CHECK(S) FAILED ===');
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
