// Device preflight and read-only inventory of the Claude Code environment.
// Never reads token values: only key names / booleans are reported.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { claudeHome, claudeJsonPath, dataDir } from './paths.mjs';
import { now } from './db.mjs';
import { scanText } from './security.mjs';

const pexec = promisify(execFile);

export function sha256File(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; }
}

function cmpVer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

export function findClaudeBinary() {
  if (process.env.CURI_CLAUDE_BIN) return fs.existsSync(process.env.CURI_CLAUDE_BIN) ? process.env.CURI_CLAUDE_BIN : null;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, 'claude');
    if (dir && fs.existsSync(p)) return p;
  }
  const home = os.homedir();
  for (const p of [path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude')]) if (fs.existsSync(p)) return p;
  const bundled = path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code');
  if (fs.existsSync(bundled)) {
    const vers = fs.readdirSync(bundled).filter(v => /^\d+\.\d+\.\d+$/.test(v)).sort(cmpVer).reverse();
    for (const v of vers) for (const h of fs.readdirSync(path.join(bundled, v))) {
      const p = path.join(bundled, v, h, 'claude.app', 'Contents', 'MacOS', 'claude');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

async function run(cmd, args, timeout = 20000, env = {}) {
  try {
    const { stdout, stderr } = await pexec(cmd, args, { timeout, env: { ...process.env, ...env }, maxBuffer: 4 << 20 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (e) {
    return { ok: false, stdout: String(e.stdout || '').trim(), stderr: String(e.stderr || e.message).trim().slice(0, 500), code: e.code };
  }
}

async function toolVersion(cmd, args = ['--version']) {
  const r = await run(cmd, args, 8000);
  return r.ok ? (r.stdout || r.stderr).split('\n')[0] : null;
}

export async function claudeAuthStatus(bin) {
  if (!bin) return { available: false };
  const r = await run(bin, ['auth', 'status'], 20000);
  try {
    const j = JSON.parse(r.stdout);
    // Only non-secret fields are surfaced.
    return { available: true, loggedIn: Boolean(j.loggedIn), authMethod: j.authMethod ?? null, apiProvider: j.apiProvider ?? null };
  } catch {
    return { available: true, loggedIn: null, note: 'Unrecognised "claude auth status" format in this version.' };
  }
}

export async function preflight() {
  const bin = findClaudeBinary();
  let freeBytes = null;
  try { const s = fs.statfsSync(os.homedir()); freeBytes = s.bavail * s.bsize; } catch {}
  let network = { github: null };
  try { const r = await fetch('https://api.github.com/zen', { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'CURI' } }); network.github = r.status < 500; } catch { network.github = false; }
  const [git, node, claudeVersion, auth] = await Promise.all([toolVersion('git'), Promise.resolve(process.version), bin ? toolVersion(bin) : null, claudeAuthStatus(bin)]);
  return {
    checked_at: now(),
    os: { platform: process.platform, release: os.release(), arch: process.arch, macos: process.platform === 'darwin' ? (await run('sw_vers', ['-productVersion'])).stdout : null },
    disk_free_gb: freeBytes != null ? Math.round(freeBytes / 1e9) : null,
    network,
    toolchain: { node, git, rust: await toolVersion('cargo'), github_token_present: Boolean(process.env.GITHUB_TOKEN) },
    claude: { binary: bin, on_path: Boolean(bin && !bin.includes('Application Support')), version: claudeVersion, auth },
    paths: { curi_data: dataDir(), claude_home: claudeHome(), claude_json: claudeJsonPath() },
  };
}

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const o = {};
  for (const line of m[1].split('\n')) { const k = line.match(/^([\w-]+):\s*(.*)$/); if (k) o[k[1]] = k[2].replace(/^["']|["']$/g, ''); }
  return o;
}

function walkSkills(root, scope, out, depth = 0) {
  if (!fs.existsSync(root) || depth > 6) return;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory() && !e.isSymbolicLink()) {
      const sk = path.join(p, 'SKILL.md');
      if (fs.existsSync(sk)) {
        const text = fs.readFileSync(sk, 'utf8');
        const fm = frontmatter(text);
        const managed = fs.existsSync(path.join(p, '.curi-managed.json'));
        out.push({ kind: 'skill', scope, name: fm.name || e.name, dir: p, description: (fm.description || '').slice(0, 300), bytes: text.length, sha256: sha256File(sk), managed_by_curi: managed, security: scanText(text, { source: sk }).summary });
      } else walkSkills(p, scope, out, depth + 1);
    }
  }
}

export function inventory() {
  const home = claudeHome();
  const skills = [];
  walkSkills(path.join(home, 'skills'), 'user', skills);
  walkSkills(path.join(home, 'plugins'), 'plugin', skills);
  const mcp = [];
  let claudeJsonError = null;
  try {
    const cj = JSON.parse(fs.readFileSync(claudeJsonPath(), 'utf8'));
    for (const [name, cfg] of Object.entries(cj.mcpServers || {})) mcp.push({ kind: 'mcp', scope: 'user', name, transport: cfg.type || (cfg.url ? 'http' : 'stdio'), command: cfg.command || cfg.url || null, args: cfg.args || [], env_keys: Object.keys(cfg.env || {}), headers_keys: Object.keys(cfg.headers || {}) });
    for (const [proj, pc] of Object.entries(cj.projects || {})) for (const [name, cfg] of Object.entries(pc.mcpServers || {})) mcp.push({ kind: 'mcp', scope: 'local', project: proj, name, transport: cfg.type || (cfg.url ? 'http' : 'stdio'), command: cfg.command || cfg.url || null, args: cfg.args || [], env_keys: Object.keys(cfg.env || {}) });
  } catch (e) { claudeJsonError = e.code === 'ENOENT' ? 'ausente' : e.message; }
  let settings = null;
  try { settings = Object.keys(JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'))); } catch {}
  const claudeMd = path.join(home, 'CLAUDE.md');
  // Name collisions across scopes (user vs plugin). Account-synced (claude.ai) skills are not visible on disk.
  const byName = new Map();
  for (const s of skills) byName.set(s.name, [...(byName.get(s.name) || []), s]);
  const conflicts = [...byName.entries()].filter(([, v]) => v.length > 1).map(([name, v]) => ({ name, locations: v.map(s => `${s.scope}:${s.dir}`) }));
  const mcpDupes = Object.entries(mcp.reduce((m, s) => ((m[s.command + ' ' + s.args.join(' ')] ||= []).push(`${s.scope}:${s.name}`), m), {})).filter(([, v]) => v.length > 1).map(([cmd, v]) => ({ command: cmd, entries: v }));
  return {
    observed_at: now(),
    claude_home: home,
    skills, mcp, conflicts, mcp_duplicates: mcpDupes,
    settings_keys: settings,
    claude_md: fs.existsSync(claudeMd) ? { exists: true, bytes: fs.statSync(claudeMd).size, sha256: sha256File(claudeMd) } : { exists: false },
    claude_json: claudeJsonError ? { error: claudeJsonError } : { path: claudeJsonPath(), sha256: sha256File(claudeJsonPath()) },
    limits: ['claude.ai account skills can\'t be detected by reading files; use a Claude Code session to list them.'],
  };
}

export async function mcpHealth(bin, env = {}) {
  if (!bin) return { available: false, servers: [] };
  const r = await run(bin, ['mcp', 'list'], 90000, env);
  const servers = [];
  for (const line of (r.stdout + '\n' + r.stderr).split('\n')) {
    const m = line.match(/^([\w.@-]+):\s+(.*?)\s+-\s+(✔|✓|✗|✘|⚠|!)\s*(.*)$/u);
    if (m) servers.push({ name: m[1], target: m[2], healthy: /✔|✓/.test(m[3]), status: m[4].trim() });
  }
  return { available: true, ok: r.ok, servers, raw_error: r.ok ? null : r.stderr };
}
