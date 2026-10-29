// Local desktop UI server. Loopback-only, bearer-token auth, Host/Origin checks against DNS
// rebinding/CSRF, strict CSP, no CORS, allowlisted actions only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb } from './db.mjs';
import { paths } from './paths.mjs';
import { dispatch } from './api.mjs';
import { launchCheck } from './bootstrap.mjs';
import { redact } from './audit-log.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const SEC_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

export function loadOrCreateToken() {
  try { const t = fs.readFileSync(paths.uiToken, 'utf8').trim(); if (t.length >= 32) return t; } catch {}
  const t = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(paths.uiToken, t, { mode: 0o600 });
  return t;
}

export async function startServer({ port = 0, host = '127.0.0.1', token = loadOrCreateToken() } = {}) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('The app server only accepts loopback.');
  const db = openDb();
  const launch = await launchCheck(db);
  // The starter catalogue ships with the app and only writes to CURI's own database, so it's there from
  // the first launch: "Explore in read-only mode" shows real resources before setup. Setup re-imports
  // it idempotently.
  try {
    if (!db.prepare('SELECT COUNT(*) n FROM resources').get().n) { const { importSeeds } = await import('./registry.mjs'); launch.seeded = importSeeds(db).resourcesAfter; }
  } catch {}
  try { const { syncCuratedCapabilities } = await import('./registry.mjs'); launch.capabilities_linked = syncCuratedCapabilities(db); } catch {}
  try { const { seedFacts } = await import('./facts.mjs'); launch.facts_seeded = seedFacts(db); } catch {}
  // Operations worker: resume interrupted work, then run anything approved or covered by consent.
  const opsMod = await import('./operations.mjs');
  const { kickWorker } = await import('./api.mjs');
  launch.recovered_operations = opsMod.recover(db);
  // Detect what is installed when the app opens (at most hourly); runs visibly in the operations modal.
  try {
    const { getPref } = await import('./db.mjs');
    const last = getPref(db, 'last_system_scan', null);
    if (!process.env.CURI_NO_STARTUP_SCAN && (!last || Date.now() - new Date(last.scanned_at).getTime() > 3600e3)) await opsMod.enqueue(db, 'system.scan', {}, { actor: 'agent' });
  } catch {}
  kickWorker(db);
  const workerTimer = setInterval(() => kickWorker(db), 5000);
  // Autonomous maintenance while the app is open (each task has its own interval; cheap when nothing is due).
  const { maintenancePass } = await import('./maintenance.mjs');
  const maintain = () => { if (!process.env.CURI_NO_STARTUP_SCAN) maintenancePass(db).then(() => kickWorker(db)).catch(() => {}); };
  const maintTimer = setInterval(maintain, 10 * 60e3);
  const maintFirst = setTimeout(maintain, 20e3);
  maintTimer.unref(); maintFirst.unref();
  workerTimer.unref();
  const tokenBuf = Buffer.from(token);
  let allowedHosts = new Set();

  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      // Opt-in diagnostics: path, status and user agent only (never headers, token or bodies).
      if (process.env.CURI_ACCESS_LOG) fs.appendFileSync(path.join(paths.logs, 'access.log'), `${new Date().toISOString()} ${req.method} ${req.url.split('#')[0].slice(0, 200)} ${code} ${String(req.headers['user-agent'] || '').slice(0, 120)}\n`);
      res.writeHead(code, { 'Content-Type': type, ...SEC_HEADERS });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    if (!allowedHosts.has(req.headers.host)) return send(421, { error: 'Host not allowed' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'POST') return send(405, { error: 'Use POST' });
      const origin = req.headers.origin;
      if (origin && !allowedHosts.has(origin.replace(/^http:\/\//, ''))) return send(403, { error: 'Origin not allowed' });
      const auth = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      if (auth.length !== tokenBuf.length || !crypto.timingSafeEqual(auth, tokenBuf)) return send(401, { error: 'Invalid token' });
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'JSON required' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 5e6) return send(413, { error: 'Request too large' }); }
      let params = {};
      try { params = raw ? JSON.parse(raw) : {}; } catch { return send(400, { error: 'Invalid JSON' }); }
      try {
        const out = await dispatch(db, url.pathname.slice(5), params);
        return send(200, { ok: true, data: redact(out ?? null) });
      } catch (e) {
        return send(e.status || 400, { ok: false, error: e.message });
      }
    }
    if (req.method !== 'GET') return send(405, { error: 'Method not allowed' });
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(paths.appDir, rel);
    if (!file.startsWith(paths.appDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'Not found', 'text/plain; charset=utf-8');
    return send(200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const actual = server.address().port;
  allowedHosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`, `[::1]:${actual}`]);
  return { server, db, maintain: async () => { await maintenancePass(db, { actor: 'user', force: true }); kickWorker(db); }, port: actual, url: `http://127.0.0.1:${actual}/#token=${token}`, launch, close: async () => { clearInterval(workerTimer); clearInterval(maintTimer); clearTimeout(maintFirst); const { stopWorker } = await import('./api.mjs'); await stopWorker(); await new Promise(r => server.close(r)); db.close(); } };
}
