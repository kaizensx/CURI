// AI agent environments on this device: where each agent keeps its MCP servers, skills and plugins,
// per operating system. Read-only. Only documented configuration files and official CLIs are read;
// authentication files (auth.json, cookies, tokens) are never opened.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OS, run, which } from './platform.mjs';
import { claudeHome, claudeJsonPath } from './paths.mjs';
import { findClaudeBinary } from './env.mjs';

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const appSupport = name => (OS === 'macos' ? path.join(HOME, 'Library', 'Application Support', name) : OS === 'windows' ? path.join(APPDATA, name) : path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), name));
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const exists = p => { try { return fs.existsSync(p); } catch { return false; } };
const lineOf = c => [c.command, ...(c.args || []), c.url || c.serverUrl || c.httpUrl].filter(Boolean).join(' ');
const mcpFrom = (obj, scope) => Object.entries(obj || {}).map(([name, c]) => ({ name, scope, command: c.command || null, args: c.args || [], url: c.url || c.serverUrl || c.httpUrl || null, line: lineOf(c), enabled: c.disabled !== true && c.enabled !== false }));

function frontmatter(md) {
  const fm = md?.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] || '';
  return { name: fm.match(/^name:\s*["']?([^"'\n]+)/m)?.[1]?.trim() || null, description: fm.match(/^description:\s*["']?([^\n]+?)["']?\s*$/m)?.[1]?.trim().slice(0, 240) || null };
}
function skillsIn(dir, scope) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const md = path.join(dir, e.name, 'SKILL.md');
    if (!exists(md)) continue;
    let text = '';
    try { text = fs.readFileSync(md, 'utf8').slice(0, 4000); } catch {}
    const marker = readJson(path.join(dir, e.name, '.curi-managed.json'));
    const fm = frontmatter(text);
    out.push({ name: e.name, title: fm.name || e.name, description: fm.description, path: path.join(dir, e.name), scope, managed_by: marker ? 'curi' : 'external', repo: marker?.repo || null, commit: marker?.commit || null });
  }
  return out;
}

// Minimal TOML reader for Codex's [mcp_servers.<name>] tables (command, args, url, enabled).
export function codexMcp(text) {
  const out = new Map();
  let cur = null;
  for (const l of text.split('\n')) {
    const s = l.match(/^\s*\[mcp_servers\.("?)([A-Za-z0-9_-]+)\1\]\s*$/);
    if (s) { cur = { name: s[2], args: [] }; out.set(s[2], cur); continue; }
    if (/^\s*\[/.test(l)) { cur = null; continue; }
    if (!cur) continue;
    const kv = l.match(/^\s*([a-z_]+)\s*=\s*(.+?)\s*$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (k === 'command' || k === 'url') cur[k] = v.replace(/^["']|["']$/g, '');
    else if (k === 'args') { try { cur.args = JSON.parse(v.replace(/'/g, '"')); } catch {} }
    else if (k === 'enabled') cur.enabled = v !== 'false';
  }
  return [...out.values()].map(c => ({ name: c.name, scope: 'user', command: c.command || null, args: c.args, url: c.url || null, line: lineOf(c), enabled: c.enabled !== false }));
}

async function claudeCode() {
  const bin = findClaudeBinary();
  const cj = readJson(claudeJsonPath()) || {};
  const mcp = mcpFrom(cj.mcpServers, 'user');
  const projects = Object.keys(cj.projects || {});
  for (const [proj, pc] of Object.entries(cj.projects || {})) {
    mcp.push(...mcpFrom(pc.mcpServers, `local:${path.basename(proj)}`));
    const shared = readJson(path.join(proj, '.mcp.json'));
    if (shared?.mcpServers) mcp.push(...mcpFrom(shared.mcpServers, `project:${path.basename(proj)}`));
  }
  const skills = skillsIn(path.join(claudeHome(), 'skills'), 'user');
  for (const proj of projects.slice(0, 60)) skills.push(...skillsIn(path.join(proj, '.claude', 'skills'), `project:${path.basename(proj)}`));
  let plugins = [], pluginsError = null;
  if (bin) {
    const t = await run(bin, ['plugin', 'list', '--json'], 30000);
    try { plugins = JSON.parse(t).map(p => ({ id: p.id, name: String(p.id).split('@')[0], marketplace: String(p.id).split('@')[1] || null, version: p.version || null, scope: p.scope, enabled: Boolean(p.enabled), managed_by: p.scope === 'synced' ? 'account' : 'local' })); }
    catch { pluginsError = 'O Claude Code não devolveu a lista de plugins.'; }
  }
  return { id: 'claude-code', label: 'Claude Code', present: Boolean(bin) || exists(claudeHome()), binary: bin, config: claudeJsonPath(), writable: Boolean(bin), mcp, skills, plugins, notes: pluginsError ? [pluginsError] : [], manage: { kind: 'cli', how: 'O CURI instala, ativa e remove através do próprio Claude Code (claude mcp / claude plugin).' } };
}

function claudeDesktop() {
  const dir = appSupport('Claude');
  const cfgPath = path.join(dir, 'claude_desktop_config.json');
  const cfg = readJson(cfgPath);
  const account = [];
  // Skills enabled in the claude.ai account are mirrored by Claude Desktop into a manifest (metadata only).
  const sp = path.join(dir, 'local-agent-mode-sessions', 'skills-plugin');
  try {
    for (const a of fs.readdirSync(sp)) for (const b of fs.readdirSync(path.join(sp, a))) {
      const m = readJson(path.join(sp, a, b, 'manifest.json'));
      for (const s of m?.skills || []) account.push({ name: s.name, description: (s.description || '').slice(0, 240), enabled: s.enabled !== false, origin: s.creatorType === 'user' ? 'adicionada por si' : s.creatorType === 'anthropic' ? 'Anthropic' : (s.creatorType || null), updated_at: s.updatedAt || null, scope: 'account', managed_by: 'account' });
    }
  } catch {}
  const seen = new Set();
  const accountSkills = account.filter(s => (seen.has(s.name) ? false : seen.add(s.name)));
  return { id: 'claude-desktop', label: 'Claude Desktop', present: exists(dir), config: exists(cfgPath) ? cfgPath : null, writable: false, mcp: mcpFrom(cfg?.mcpServers, 'desktop'), skills: [], account_skills: accountSkills, plugins: [],
    notes: accountSkills.length ? [`${accountSkills.length} skills da sua conta claude.ai, sincronizadas pelo Claude Desktop.`] : [],
    manage: { kind: 'account', url: 'https://claude.ai/settings/capabilities', how: 'As skills e conectores da conta são geridos em claude.ai › Definições › Capacidades. Os servidores MCP locais do Claude Desktop estão em Definições › Programador.' } };
}

function codex() {
  const home = process.env.CODEX_HOME || path.join(HOME, '.codex');
  const cfg = path.join(home, 'config.toml');
  let mcp = [];
  try { mcp = codexMcp(fs.readFileSync(cfg, 'utf8')); } catch {}
  return { id: 'codex', label: 'Codex', present: exists(home), binary: which('codex'), config: exists(cfg) ? cfg : null, writable: false, mcp, skills: skillsIn(path.join(home, 'skills'), 'user'), plugins: [], notes: [], manage: { kind: 'file', how: 'Servidores MCP em ~/.codex/config.toml ([mcp_servers.*]); skills em ~/.codex/skills.' } };
}

function jsonAgent(id, label, file, key, dirs = []) {
  const cfg = readJson(file);
  const present = exists(file) || dirs.some(exists);
  return { id, label, present, config: exists(file) ? file : null, writable: false, mcp: mcpFrom(cfg?.[key], 'user'), skills: [], plugins: [], notes: [], manage: { kind: 'file', how: `Servidores MCP em ${file.replace(HOME, '~')}.` } };
}

export async function inspectAgents() {
  const list = [
    await claudeCode(),
    claudeDesktop(),
    codex(),
    jsonAgent('cursor', 'Cursor', path.join(HOME, '.cursor', 'mcp.json'), 'mcpServers', [path.join(HOME, '.cursor')]),
    jsonAgent('gemini', 'Gemini CLI', path.join(HOME, '.gemini', 'settings.json'), 'mcpServers', [path.join(HOME, '.gemini')]),
    jsonAgent('windsurf', 'Windsurf', path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers'),
    jsonAgent('vscode', 'VS Code', path.join(appSupport('Code'), 'User', 'mcp.json'), 'servers'),
  ];
  return list;
}
