// Provider connections: API keys in the Keychain, metadata in SQLite, real connection tests against
// each provider's documented read-only endpoint. Removing a connection only removes local access.
import { now } from './db.mjs';
import { audit } from './audit-log.mjs';
import * as vault from './vault.mjs';

export const PROVIDERS = {
  github: {
    name: 'GitHub', method: 'token', docs: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
    hint: 'Fine-grained personal token with read access to public repositories only.',
    capabilities: ['API quota of 5000 requests/h (instead of 60)', '30 searches/min (instead of 10)', 'Full metadata (licence, topics, releases)'],
    async test(key) {
      const r = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'CURI', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 401) return { ok: false, status: 'invalid', detail: 'GitHub rejected the token (401). It may have expired or been revoked.' };
      if (!r.ok) return { ok: false, status: 'error', detail: `GitHub answered HTTP ${r.status}.` };
      const j = await r.json();
      return { ok: true, account: j.login, detail: `Connected as ${j.login}`, quota: { limit: +r.headers.get('x-ratelimit-limit'), remaining: +r.headers.get('x-ratelimit-remaining') } };
    },
  },
  anthropic: {
    name: 'Anthropic API', method: 'api_key', docs: 'https://docs.claude.com/en/api/overview',
    hint: 'Anthropic Console key. Billed separately from a Claude subscription.',
    capabilities: ['Model-assisted candidate analysis (optional, costs money)'],
    async test(key) {
      const r = await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 401) return { ok: false, status: 'invalid', detail: 'Anthropic rejected the key (401).' };
      if (r.status === 403) return { ok: false, status: 'forbidden', detail: 'Valid key, but not allowed to list models (403).' };
      if (!r.ok) return { ok: false, status: 'error', detail: `Anthropic answered HTTP ${r.status}.` };
      return { ok: true, detail: 'Key accepted by the API.' };
    },
  },
  openai: {
    name: 'OpenAI', method: 'api_key', docs: 'https://platform.openai.com/docs/api-reference/authentication',
    hint: 'OpenAI platform project key.',
    capabilities: ['Available to MCP integrations that need it'],
    async test(key) {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
      if (r.status === 401) return { ok: false, status: 'invalid', detail: 'OpenAI rejected the key (401).' };
      if (!r.ok) return { ok: false, status: 'error', detail: `OpenAI answered HTTP ${r.status}.` };
      return { ok: true, detail: 'Key accepted by the API.' };
    },
  },
  google: {
    name: 'Google AI (Gemini)', method: 'api_key', docs: 'https://ai.google.dev/gemini-api/docs/api-key',
    hint: 'Google AI Studio key.',
    capabilities: ['Available to MCP integrations that need it'],
    async test(key) {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
      if (r.status === 400 || r.status === 401 || r.status === 403) return { ok: false, status: 'invalid', detail: `Google rejected the key (HTTP ${r.status}).` };
      if (!r.ok) return { ok: false, status: 'error', detail: `Google answered HTTP ${r.status}.` };
      return { ok: true, detail: 'Key accepted by the API.' };
    },
  },
};

const account = provider => `provider:${provider}`;

function upsert(db, provider, fields) {
  const cur = db.prepare('SELECT * FROM connections WHERE provider=?').get(provider);
  const row = { method: PROVIDERS[provider].method, account: null, has_secret: 0, status: 'not_configured', detail: null, capabilities: null, last_tested: null, last_ok: null, ...cur, ...fields, updated_at: now() };
  db.prepare(`INSERT INTO connections(provider,method,account,has_secret,status,detail,capabilities,last_tested,last_ok,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(provider) DO UPDATE SET method=excluded.method, account=excluded.account, has_secret=excluded.has_secret, status=excluded.status, detail=excluded.detail, capabilities=excluded.capabilities, last_tested=excluded.last_tested, last_ok=excluded.last_ok, updated_at=excluded.updated_at`)
    .run(provider, row.method, row.account, row.has_secret, row.status, row.detail, row.capabilities, row.last_tested, row.last_ok, row.updated_at);
}

// Connections tested by versions before 3.3 stored their result in Portuguese.
const englishDetail = d => (d ? d.replace(/^Ligado como /, 'Connected as ') : d);

export function listConnections(db) {
  const rows = new Map(db.prepare('SELECT * FROM connections').all().map(r => [r.provider, r]));
  return Object.entries(PROVIDERS).map(([id, p]) => {
    const r = rows.get(id) || {};
    return { provider: id, name: p.name, method: p.method, hint: p.hint, docs: p.docs, capabilities: p.capabilities, status: r.status || 'not_configured', account: r.account || null, detail: englishDetail(r.detail) || null, has_secret: Boolean(r.has_secret), last_tested: r.last_tested || null, last_ok: r.last_ok || null, keychain: vault.available() };
  });
}

async function runTest(provider, key) {
  try { return await PROVIDERS[provider].test(key); }
  catch (e) { return { ok: false, status: 'unreachable', detail: `Couldn't reach the provider: ${e.name === 'TimeoutError' ? 'timed out' : e.message}` }; }
}

// Saves only after a successful test, so an invalid key never replaces a working one.
export async function saveCredential(db, provider, secret, { actor = 'user', skipTest = false } = {}) {
  if (!PROVIDERS[provider]) throw new Error('Unsupported provider.');
  const t = skipTest ? { ok: true, detail: 'Saved without testing.' } : await runTest(provider, secret);
  if (!t.ok) {
    audit(db, actor, 'connection.rejected', provider, { status: t.status });
    return { saved: false, ...t };
  }
  await vault.setSecret(account(provider), secret);
  upsert(db, provider, { has_secret: 1, status: skipTest ? 'unverified' : 'connected', account: t.account || null, detail: t.detail, last_tested: now(), last_ok: skipTest ? null : now() });
  audit(db, actor, 'connection.saved', provider, { account: t.account || null });
  return { saved: true, ...t };
}

export async function testConnection(db, provider, { actor = 'user' } = {}) {
  if (!PROVIDERS[provider]) throw new Error('Unsupported provider.');
  const key = await vault.getSecret(account(provider));
  if (!key) { upsert(db, provider, { has_secret: 0, status: 'not_configured', detail: 'No credential saved.' }); return { ok: false, status: 'not_configured' }; }
  const t = await runTest(provider, key);
  upsert(db, provider, { has_secret: 1, status: t.ok ? 'connected' : t.status, account: t.account ?? undefined, detail: t.detail, last_tested: now(), ...(t.ok ? { last_ok: now() } : {}) });
  audit(db, actor, 'connection.test', provider, { ok: t.ok, status: t.status || 'connected' });
  return t;
}

export async function removeCredential(db, provider, { actor = 'user' } = {}) {
  if (!PROVIDERS[provider]) throw new Error('Unsupported provider.');
  const removed = await vault.deleteSecret(account(provider));
  upsert(db, provider, { has_secret: 0, status: 'not_configured', account: null, detail: 'Local access removed. The credential stays valid at the provider until you revoke it there.' });
  audit(db, actor, 'connection.removed', provider, { keychain_item_removed: removed });
  return { removed };
}

// For trusted in-process callers (GitHub client, MCP launcher). Never returned over the UI API.
// ref: 'github' | 'provider:github' | 'secret:<name>' (free-form secrets used by MCP servers).
export async function credentialFor(ref) {
  const r = String(ref);
  if (r.startsWith('secret:')) return vault.getSecret(r);
  return vault.getSecret(account(r.replace(/^provider:/, '')));
}

const SECRET_RX = /^secret:[a-z0-9][a-z0-9._-]{0,48}$/;
export async function saveNamedSecret(db, ref, value, { actor = 'user' } = {}) {
  if (!SECRET_RX.test(ref)) throw new Error('Invalid secret name (use lowercase letters, numbers, . _ -).');
  await vault.setSecret(ref, value);
  audit(db, actor, 'secret.saved', ref, null);
  return { saved: true, ref };
}
export async function deleteNamedSecret(db, ref, { actor = 'user' } = {}) {
  if (!SECRET_RX.test(ref)) throw new Error('Invalid secret name.');
  const removed = await vault.deleteSecret(ref);
  audit(db, actor, 'secret.removed', ref, { removed });
  return { removed };
}
export const hasNamedSecret = ref => (SECRET_RX.test(ref) ? vault.hasSecret(ref) : Promise.resolve(false));

// Existing GitHub sign-ins on this device, through supported mechanisms only (GitHub CLI's
// `gh auth token`, or GITHUB_TOKEN in the environment). Nothing is read until the user asks.
export async function githubExisting() {
  const { which, run } = await import('./platform.mjs');
  const gh = which('gh');
  let ghUser = null;
  if (gh) { const t = await run(gh, ['auth', 'status', '--hostname', 'github.com'], 10000); ghUser = t?.match(/account\s+(\S+)|as\s+(\S+)/)?.slice(1).find(Boolean) || (t && /Logged in/i.test(t) ? 'signed in' : null); }
  return { gh_cli: Boolean(gh), gh_logged_in: Boolean(ghUser), gh_user: ghUser, env_token: Boolean(process.env.GITHUB_TOKEN) };
}
export async function adoptGithubCli(db, { actor = 'user' } = {}) {
  const { which } = await import('./platform.mjs');
  const gh = which('gh');
  if (!gh) throw new Error('The GitHub CLI (gh) isn\'t installed.');
  const { execFile } = await import('node:child_process');
  const token = await new Promise((res, rej) => execFile(gh, ['auth', 'token', '--hostname', 'github.com'], { timeout: 10000 }, (e, out) => (e ? rej(new Error('The GitHub CLI isn\'t signed in.')) : res(String(out).trim()))));
  if (!token) throw new Error('The GitHub CLI didn\'t return a token.');
  return saveCredential(db, 'github', token, { actor });
}
