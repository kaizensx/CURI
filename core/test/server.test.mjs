import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sandbox } from './helpers.mjs';

sandbox('server');
const { openDb } = await import('../src/db.mjs');
const { importSeeds } = await import('../src/registry.mjs');
const { startServer } = await import('../src/server.mjs');
const seed = openDb(); importSeeds(seed); seed.close();
const token = 'a'.repeat(64);
const s = await startServer({ port: 0, token });
after(() => s.close());

function req(path, { method = 'POST', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: s.port, path, method, headers: { Host: `127.0.0.1:${s.port}`, ...headers } }, res => {
      let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

test('binds loopback only', () => assert.equal(s.server.address().address, '127.0.0.1'));
test('rejects missing/wrong token', async () => {
  assert.equal((await req('/api/status', { headers: { 'Content-Type': 'application/json' } })).status, 401);
  assert.equal((await req('/api/status', { headers: { ...auth, Authorization: 'Bearer ' + 'b'.repeat(64) } })).status, 401);
});
test('rejects DNS-rebinding Host and foreign Origin (CSRF)', async () => {
  assert.equal((await req('/api/status', { headers: { ...auth, Host: 'evil.example:80' } })).status, 421);
  assert.equal((await req('/api/status', { headers: { ...auth, Origin: 'http://evil.example' } })).status, 403);
});
test('no CORS, strict CSP on every response', async () => {
  const r = await req('/', { method: 'GET' });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(r.headers['access-control-allow-origin'], undefined);
});
test('unknown action and prototype keys are refused', async () => {
  assert.equal((await req('/api/exec', { headers: auth, body: '{"cmd":"id"}' })).status, 404);
  assert.equal((await req('/api/constructor', { headers: auth, body: '{}' })).status, 404);
  assert.equal((await req('/api/__proto__', { headers: auth, body: '{}' })).status, 404);
});
test('path traversal blocked for static files', async () => {
  assert.equal((await req('/../core/src/server.mjs', { method: 'GET' })).status, 404);
  assert.equal((await req('/%2e%2e/core/package.json', { method: 'GET' })).status, 404);
});
test('authorized action works and redacts secrets', async () => {
  const r = JSON.parse((await req('/api/search', { headers: auth, body: JSON.stringify({ query: 'react bits', limit: 3 }) })).body);
  assert.equal(r.ok, true);
  assert.equal(r.data.results[0].id, 'web:reactbits.dev');
  const bad = JSON.parse((await req('/api/scanText', { headers: auth, body: JSON.stringify({ text: 'token ghp_' + 'A'.repeat(36) }) })).body);
  assert.ok(!JSON.stringify(bad).includes('A'.repeat(36)));
});

test('openExternal only accepts public http(s) URLs', async () => {
  for (const url of ['file:///etc/passwd', 'http://127.0.0.1:22/', 'javascript:alert(1)', 'x']) {
    const r = await req('/api/openExternal', { headers: auth, body: JSON.stringify({ url }) });
    assert.equal(r.status, 400, url);
  }
});

// ---- UI regression guards ----
import fs from 'node:fs';
import path from 'node:path';
const { ACTIONS } = await import('../src/api.mjs');
const { paths } = await import('../src/paths.mjs');
const uiFiles = (dir => { const out = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|css|html)$/.test(e.name)) out.push(p); } }; walk(dir); return out; })(paths.appDir);

test('every API action the UI calls exists in Core (no dead buttons)', () => {
  const used = new Set();
  for (const f of uiFiles.filter(f => f.endsWith('.js'))) for (const m of fs.readFileSync(f, 'utf8').matchAll(/api\('([A-Za-z]+)'/g)) used.add(m[1]);
  const missing = [...used].filter(a => !Object.hasOwn(ACTIONS, a));
  assert.deepEqual(missing, []);
  assert.ok(used.size >= 30, `UI uses ${used.size} actions`);
});
test('UI never injects HTML strings (untrusted repo text stays text)', () => {
  for (const f of uiFiles.filter(f => f.endsWith('.js'))) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/, f);
});
test('all UI modules and styles are served with correct types', async () => {
  for (const f of uiFiles) {
    const rel = path.relative(paths.appDir, f);
    const r = await req(`/${rel}`, { method: 'GET' });
    assert.equal(r.status, 200, rel);
    assert.match(r.headers['content-type'], f.endsWith('.js') ? /javascript/ : f.endsWith('.css') ? /css/ : /html/, rel);
  }
});

test('UI never passes raw (possibly null) children to replaceChildren; uses fill()', () => {
  const offenders = [];
  for (const f of uiFiles.filter(f => f.endsWith('.js') && !f.endsWith('dom.js'))) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => { if (/\.replaceChildren\(/.test(l) && /\?|null|&&/.test(l.slice(l.indexOf('.replaceChildren(')))) offenders.push(`${path.basename(f)}:${i + 1}`); });
  }
  assert.deepEqual(offenders, []);
});
test('every operation kind the UI starts is registered in the engine', async () => {
  await import('../src/installers.mjs');
  const { kinds } = await import('../src/operations.mjs');
  const used = new Set();
  for (const f of uiFiles.filter(f => f.endsWith('.js'))) for (const m of fs.readFileSync(f, 'utf8').matchAll(/runOperation\('([\w.]+)'/g)) used.add(m[1]);
  assert.deepEqual([...used].filter(k => !kinds().includes(k)), []);
  assert.ok(used.size >= 10, `UI uses ${used.size} operation kinds`);
});
