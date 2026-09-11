#!/usr/bin/env node
/*
 * grants-proxy.js — an optional, zero-dependency local relay for the Find
 * Funding feature (js/opportunities.js).
 *
 * Why this exists: Grant Crosswalk is a static, serverless app by
 * design, and Grants.gov's public search2 / fetchOpportunity endpoints are
 * documented as needing no login and no API key, but are NOT documented as
 * supporting arbitrary cross-origin requests from a browser. If your browser
 * blocks the direct call, this script is the smallest possible fix that
 * keeps the app's privacy design intact: it runs on YOUR machine, forwards
 * requests to Grants.gov exactly as the browser would have, and adds the
 * header that lets a page served from localhost call it. Nothing here talks
 * to any third-party server; it is a relay, not a service.
 *
 * Usage:
 *   node tools/grants-proxy.js            # listens on http://127.0.0.1:8787
 *   PORT=9000 node tools/grants-proxy.js  # or a different port
 *
 * Then, in the app's Settings → Live funding search, set "Local relay URL" to
 * http://127.0.0.1:8787 and save. Everything else about the feature (what
 * gets sent, the opt-in toggle, caching) is unchanged; only the network hop
 * changes.
 *
 * This deliberately only forwards to the two Grants.gov endpoints the app
 * actually calls, not to arbitrary URLs, so it can't be turned into an
 * open proxy by a malicious page.
 */
'use strict';
const http = require('http');
const https = require('https');

const PORT = parseInt(process.env.PORT, 10) || 8787;
const ALLOWED_PATHS = {
  '/v1/api/search2': 'api.grants.gov',
  '/v1/api/fetchOpportunity': 'api.grants.gov'
};

function withCors(res, status, headers, body) {
  res.writeHead(status, Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }, headers || {}));
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const host = ALLOWED_PATHS[url.pathname];

  if (req.method === 'OPTIONS') { withCors(res, 204, {}, ''); return; }
  if (!host) { withCors(res, 404, { 'Content-Type': 'text/plain' }, 'Not a recognised Grants.gov path.'); return; }
  if (req.method !== 'POST') { withCors(res, 405, { 'Content-Type': 'text/plain' }, 'Only POST is relayed.'); return; }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const upstream = https.request({
      hostname: host,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, (upRes) => {
      const upChunks = [];
      upRes.on('data', (c) => upChunks.push(c));
      upRes.on('end', () => withCors(res, upRes.statusCode || 502, { 'Content-Type': upRes.headers['content-type'] || 'application/json' }, Buffer.concat(upChunks)));
    });
    upstream.on('error', (e) => withCors(res, 502, { 'Content-Type': 'text/plain' }, 'Could not reach Grants.gov: ' + e.message));
    upstream.write(body);
    upstream.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Grants.gov relay listening on http://127.0.0.1:' + PORT);
  console.log('Point Settings \u2192 Live funding search \u2192 Local relay URL at that address.');
  console.log('Only forwards POST requests to /v1/api/search2 and /v1/api/fetchOpportunity on api.grants.gov.');
});
