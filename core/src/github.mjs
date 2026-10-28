// GitHub + web source verification. Respects rate limits, uses ETag conditional requests, and never
// persists tokens (GITHUB_TOKEN is read from env per request only).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { now, tx } from './db.mjs';
import { audit } from './audit-log.mjs';
import { indexResource } from './registry.mjs';

const pexec = promisify(execFile);
const API = 'https://api.github.com';
const UA = 'CURI/3.0 (+local-first resource registry)';

export function setProvider(db, provider, status, detail = null, rateLimit = null) {
  db.prepare(`INSERT INTO provider_status(provider,status,detail,rate_limit,checked_at) VALUES (?,?,?,?,?)
    ON CONFLICT(provider) DO UPDATE SET status=excluded.status, detail=excluded.detail, rate_limit=COALESCE(excluded.rate_limit, provider_status.rate_limit), checked_at=excluded.checked_at`)
    .run(provider, status, detail, rateLimit ? JSON.stringify(rateLimit) : null, now());
}

// Token from the Keychain (CURI → Ligações), cached briefly in memory; never persisted elsewhere.
let tokenCache = { value: null, at: 0 };
async function githubToken() {
  if (Date.now() - tokenCache.at < 60000) return tokenCache.value;
  const { credentialFor } = await import('./connections.mjs');
  tokenCache = { value: await credentialFor('github').catch(() => null), at: Date.now() };
  return tokenCache.value;
}
export function clearGithubTokenCache() { tokenCache = { value: null, at: 0 }; }

export async function ghFetch(db, pathname, { timeoutMs = 15000 } = {}) {
  const url = API + pathname;
  const cached = db.prepare('SELECT * FROM http_cache WHERE url=?').get(url);
  const headers = { 'User-Agent': UA, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const token = process.env.GITHUB_TOKEN || await githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    setProvider(db, 'github', 'unreachable', e.message);
    const err = new Error(`GitHub inacessível: ${e.message}`); err.code = 'OFFLINE'; throw err;
  }
  const kind = pathname.startsWith('/search') ? 'search' : 'core';
  const rl = { kind, limit: +res.headers.get('x-ratelimit-limit'), remaining: +res.headers.get('x-ratelimit-remaining'), reset: new Date(+res.headers.get('x-ratelimit-reset') * 1000).toISOString(), authenticated: Boolean(token) };
  if (res.status === 304 && cached) {
    setProvider(db, 'github', 'ok', 'cache 304', rl);
    return { status: 200, body: JSON.parse(cached.body), fromCache: true, rateLimit: rl };
  }
  if ((res.status === 403 || res.status === 429) && rl.remaining === 0) {
    setProvider(db, 'github', 'rate_limited', `reset ${rl.reset}`, rl);
    const err = new Error(`Limite de pedidos GitHub atingido (${kind}); reset ${rl.reset}. Defina GITHUB_TOKEN para limites maiores.`); err.code = 'RATE_LIMIT'; err.reset = rl.reset; throw err;
  }
  const text = await res.text();
  setProvider(db, 'github', res.ok || res.status === 404 ? 'ok' : 'error', `HTTP ${res.status}`, rl);
  if (res.ok) {
    db.prepare(`INSERT INTO http_cache(url,etag,last_modified,status,body,fetched_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(url) DO UPDATE SET etag=excluded.etag, last_modified=excluded.last_modified, status=excluded.status, body=excluded.body, fetched_at=excluded.fetched_at`)
      .run(url, res.headers.get('etag'), res.headers.get('last-modified'), res.status, text, now());
  }
  return { status: res.status, body: text ? safeJson(text) : null, fromCache: false, rateLimit: rl };
}

function safeJson(t) { try { return JSON.parse(t); } catch { return { raw: t.slice(0, 500) }; } }

// Existence + HEAD commit via git protocol: no REST quota consumed, no code executed.
export async function lsRemote(url, { timeoutMs = 20000 } = {}) {
  try {
    const { stdout } = await pexec('git', ['ls-remote', '--symref', url, 'HEAD'], { timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' } });
    const head = stdout.match(/^([0-9a-f]{40})\s+HEAD$/m)?.[1];
    const branch = stdout.match(/^ref: refs\/heads\/(\S+)\s+HEAD$/m)?.[1];
    return head ? { exists: true, head, branch } : { exists: false, error: 'sem HEAD' };
  } catch (e) {
    const msg = String(e.stderr || e.message);
    if (/not found|Repository not found|could not read Username/i.test(msg)) return { exists: false, error: 'repositório inexistente ou privado' };
    return { exists: null, error: msg.split('\n')[0].slice(0, 200) };
  }
}

export async function webCheck(url, { timeoutMs = 15000 } = {}) {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.text()).slice(0, 200000);
    const title = body.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() || null;
    return { ok: res.ok, status: res.status, finalUrl: res.url, title };
  } catch (e) {
    return { ok: false, status: null, error: e.message };
  }
}

function snapshot(db, b, source) {
  db.prepare('INSERT INTO repo_snapshots(full_name,stars,forks,open_issues,pushed_at,latest_release,archived,source,captured_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(String(b.full_name).toLowerCase(), b.stargazers_count ?? null, b.forks_count ?? null, b.open_issues_count ?? null, b.pushed_at ?? null, null, b.archived ? 1 : 0, source, now());
}
export { snapshot as recordSnapshot };

// Verifies one registry resource against its live source and records evidence. Never changes install state.
export async function verifyResource(db, id, { useApi = true } = {}) {
  const r = db.prepare('SELECT * FROM resources WHERE id=?').get(id);
  if (!r) throw new Error(`Recurso inexistente: ${id}`);
  const ts = now();
  const out = { id, checks: [] };
  if (r.gh_full_name) {
    const ls = await lsRemote(`https://github.com/${r.gh_full_name}.git`);
    out.checks.push({ kind: 'git-ls-remote', ...ls });
    let api = null;
    if (useApi) {
      try { api = await ghFetch(db, `/repos/${r.gh_full_name}`); out.checks.push({ kind: 'github-api', status: api.status, fromCache: api.fromCache }); }
      catch (e) { out.checks.push({ kind: 'github-api', error: e.message, code: e.code }); }
    }
    tx(db, () => {
      if (ls.exists === true) {
        db.prepare('UPDATE resources SET head_commit=?, last_verified=?, updated_at=? WHERE id=?').run(ls.head, ts, ts, id);
        db.prepare('INSERT INTO evidence(resource_id,kind,class,summary,data,source_url,captured_at) VALUES (?,?,?,?,?,?,?)')
          .run(id, 'source-exists', 'original', `Repositório acessível; HEAD ${ls.head.slice(0, 12)} (${ls.branch || '?'})`, JSON.stringify(ls), `https://github.com/${r.gh_full_name}`, ts);
      } else if (ls.exists === false && (!api || api.status === 404)) {
        db.prepare('UPDATE resources SET status=?, updated_at=? WHERE id=? AND status NOT IN (\'INSTALLED\',\'CONFIGURED\')').run('UNAVAILABLE', ts, id);
        db.prepare('INSERT INTO evidence(resource_id,kind,class,summary,source_url,captured_at) VALUES (?,?,?,?,?,?)').run(id, 'source-missing', 'original', `Fonte indisponível: ${ls.error}`, `https://github.com/${r.gh_full_name}`, ts);
      }
      if (api?.status === 200) {
        const b = api.body;
        snapshot(db, b, 'github-api');
        const lic = b.license?.spdx_id && b.license.spdx_id !== 'NOASSERTION' ? b.license.spdx_id : (b.license ? 'NOASSERTION' : 'none');
        db.prepare('UPDATE resources SET license=CASE WHEN license=\'unknown\' OR license IS NULL THEN ? ELSE license END, description=COALESCE(description, ?), last_verified=?, updated_at=? WHERE id=?')
          .run(lic, b.description || null, ts, ts, id);
        if (b.archived) db.prepare('UPDATE resources SET status=\'DEPRECATED\', risk_notes=trim(COALESCE(risk_notes,\'\') || \' Repositório arquivado.\') WHERE id=? AND status NOT IN (\'INSTALLED\',\'CONFIGURED\')').run(id);
        if (b.full_name.toLowerCase() !== r.gh_full_name) {
          db.prepare('INSERT OR IGNORE INTO aliases(resource_id,alias) VALUES (?,?)').run(id, b.full_name);
          db.prepare('INSERT INTO evidence(resource_id,kind,class,summary,source_url,captured_at) VALUES (?,?,?,?,?,?)').run(id, 'renamed', 'original', `Repositório movido/renomeado para ${b.full_name} (URL original preservado).`, b.html_url, ts);
        }
        if (b.topics?.length) for (const t of b.topics.slice(0, 20)) db.prepare('INSERT OR IGNORE INTO tags(resource_id,tag) VALUES (?,?)').run(id, `topic:${t}`);
        db.prepare('INSERT INTO evidence(resource_id,kind,class,summary,data,source_url,captured_at) VALUES (?,?,?,?,?,?,?)')
          .run(id, 'github-metadata', 'original', `GitHub: licença ${lic}, último push ${b.pushed_at}, arquivado=${b.archived}`, JSON.stringify({ description: b.description, license: lic, pushed_at: b.pushed_at, archived: b.archived, default_branch: b.default_branch, topics: b.topics }), b.html_url, ts);
      }
      indexResource(db, id);
    });
  } else {
    const w = await webCheck(r.canonical_url);
    out.checks.push({ kind: 'http', ...w });
    tx(db, () => {
      if (w.ok) {
        db.prepare('UPDATE resources SET last_verified=?, updated_at=? WHERE id=?').run(ts, ts, id);
        db.prepare('INSERT INTO evidence(resource_id,kind,class,summary,data,source_url,captured_at) VALUES (?,?,?,?,?,?,?)')
          .run(id, 'source-exists', 'original', `HTTP ${w.status}${w.title ? ` — "${w.title.slice(0, 80)}"` : ''}`, JSON.stringify(w), r.canonical_url, ts);
      } else {
        db.prepare('INSERT INTO evidence(resource_id,kind,class,summary,data,source_url,captured_at) VALUES (?,?,?,?,?,?,?)')
          .run(id, 'source-check-failed', 'original', `Verificação falhou: ${w.status ?? w.error}`, JSON.stringify(w), r.canonical_url, ts);
      }
    });
  }
  audit(db, 'system', 'resource.verify', id, { checks: out.checks.map(c => ({ kind: c.kind, exists: c.exists, status: c.status, error: c.error })) });
  return out;
}
