// Resource view model for the Library: real presence on this device (any agent, any installer),
// the profile, and the actions that make sense for this kind of resource in its current state.
// Each action is either a queued operation (runs in the progress modal), an assisted step (opens
// the right place with instructions), or a copyable project command. No action only flips a status.
import { getResource } from './registry.mjs';
import { profileFor, deviceContext, getFacts } from './facts.mjs';
import { stateOf, LOCAL_TYPES } from './detect.mjs';
import { OS, MANAGERS } from './platform.mjs';
import { getPref } from './db.mjs';
import fs from 'node:fs';
import { claudeJsonPath } from './paths.mjs';
import { marksFor } from './marks.mjs';

// Prerequisites CURI can install for an option that is not ready yet.
const PREREQ = {
  uv: { macos: { manager: 'brew', name: 'uv' }, linux: { manager: 'brew', name: 'uv' }, windows: { manager: 'winget', name: 'astral-sh.uv' } },
  pipx: { macos: { manager: 'brew', name: 'pipx' }, linux: { manager: 'brew', name: 'pipx' }, windows: { manager: 'scoop', name: 'pipx' } },
  node: { macos: { manager: 'brew', name: 'node' }, linux: { manager: 'brew', name: 'node' }, windows: { manager: 'winget', name: 'OpenJS.NodeJS.LTS' } },
  cargo: { macos: { manager: 'brew', name: 'rust' }, linux: { manager: 'brew', name: 'rust' }, windows: { manager: 'winget', name: 'Rustlang.Rustup' } },
};
const PREREQ_LABEL = { uv: 'uv (Astral)', pipx: 'pipx', node: 'Node.js', cargo: 'Rust (Cargo)', brew: 'Homebrew', claude: 'Claude Code', docker: 'Docker', rea: 'REA (rea-agents)' };

export function presenceOf(db, id) {
  const rows = db.prepare('SELECT * FROM installed_instances WHERE resource_id=?').all(id);
  const found = rows.map(r => {
    const d = JSON.parse(r.details || '{}');
    const type = r.kind.replace(/^detected:/, '').replace(/^package:/, '');
    return { type, name: r.name, version: d.version || (r.kind === 'skill' ? r.checksum?.slice(0, 7) : null), agent: d.agent || (r.kind === 'skill' || r.kind === 'plugin' ? 'claude-code' : null), agent_label: d.agent_label || (r.kind === 'skill' || r.kind === 'plugin' ? 'Claude Code' : null),
      scope: r.scope, enabled: d.enabled ?? null, managed_by: r.managed_by_curi ? 'curi' : d.managed_by || 'external', path: r.path, health: r.health, observed_at: r.observed_at, detail: d.detail || null, marketplace: d.marketplace || null };
  });
  // Merge CURI-managed and detected rows of the same thing.
  const seen = new Map();
  for (const f of found) { const k = `${f.type}:${f.name}`; const prev = seen.get(k); if (!prev || f.managed_by === 'curi') seen.set(k, { ...prev, ...f, managed_by: f.managed_by === 'curi' || prev?.managed_by === 'curi' ? 'curi' : f.managed_by }); }
  const list = [...seen.values()];
  return { found: list, state: list.length ? stateOf(list) : null };
}

const registeredMcp = () => { try { return new Set(Object.keys(JSON.parse(fs.readFileSync(claudeJsonPath(), 'utf8')).mcpServers || {})); } catch { return new Set(); } };
const op = (label, kind, params, extra = {}) => ({ type: 'op', label, op: { kind, params }, ...extra });
const open = (label, url, extra = {}) => ({ type: 'open', label, url, ...extra });

export function resourceView(db, id) {
  const r = getResource(db, id);
  if (!r) return null;
  const ctx = deviceContext(db);
  const prof = profileFor(db, id, ctx);
  const pres = presenceOf(db, id);
  const facts = getFacts(db, id);
  const own = prof.options.filter(o => !o.shared);
  const state = pres.state || (prof.kind === 'reference' ? 'reference' : ['library', 'framework'].includes(prof.kind) || (prof.kind === 'components' && !own.length) ? 'project' : own.length ? 'available' : 'reference');
  const actions = { primary: null, install: [], manage: [], assist: [], project: prof.project_use, docs: [] };

  // Manage what is present, per installed instance.
  for (const f of pres.found) {
    const where = f.agent_label ? ` (${f.agent_label})` : '';
    if (f.type === 'plugin') {
      if (f.managed_by === 'account' || f.scope === 'synced') actions.assist.push(open('Manage in your claude.ai account', 'https://claude.ai/settings/capabilities', { hint: `${f.name} is synced from your account.` }));
      else {
        actions.manage.push(f.enabled === false ? op(`Enable ${f.name}`, 'plugin.enable', { plugin: f.name }) : op(`Disable ${f.name}`, 'plugin.disable', { plugin: f.name }));
        actions.manage.push(op(`Update ${f.name}`, 'plugin.update', { plugin: f.name }));
        actions.manage.push(op(`Uninstall ${f.name}`, 'plugin.uninstall', { plugin: f.name }, { danger: true }));
      }
    } else if (f.type === 'mcp' && f.agent === 'claude-code') {
      const def = db.prepare('SELECT name FROM mcp_definitions WHERE name=?').get(f.name);
      actions.manage.push(op('Test MCP connection', 'mcp.check', {}));
      if (def) actions.manage.push(op(`Disable ${f.name}${where}`, 'mcp.disable', { name: f.name }, { danger: true }));
      else if (f.scope === 'user' || f.scope?.startsWith('local')) actions.manage.push(op(`Remove ${f.name} from Claude Code`, 'mcp.remove', { name: f.name, scope: f.scope.startsWith('local') ? 'local' : 'user' }, { danger: true }));
    } else if (f.type === 'mcp') {
      actions.assist.push({ type: 'reveal', label: `Open configuration${where}`, hint: `${f.agent_label} keeps its MCP servers in its own file; CURI only reads it.`, agent: f.agent });
    } else if (f.type === 'skill' && f.managed_by === 'curi') {
      const m = db.prepare("SELECT details FROM installed_instances WHERE kind='skill' AND name=?").get(f.name);
      const d = m ? JSON.parse(m.details || '{}') : {};
      if (d.repo) actions.manage.push(op(`Update skill ${f.name}`, 'skill.install', { repo: d.repo, path: d.path, name: f.name, resource_id: id }));
      actions.manage.push(op(`Remove skill ${f.name}`, 'skill.remove', { name: f.name }, { danger: true }));
    } else if (f.type === 'account-skill') {
      if (!actions.assist.some(a => a.url === 'https://claude.ai/settings/capabilities')) actions.assist.push(open('Manage skills in your claude.ai account', 'https://claude.ai/settings/capabilities', { hint: 'Account skills are managed by claude.ai and synced to Claude Desktop.' }));
    } else if (MANAGERS[f.type] && MANAGERS[f.type].os.includes(OS)) {
      actions.manage.push(op(`Update (${MANAGERS[f.type].label})`, 'package.upgrade', { manager: f.type, name: f.name, resource_id: id }));
      actions.manage.push(op(`Uninstall (${MANAGERS[f.type].label})`, 'package.remove', { manager: f.type, name: f.name, resource_id: id }, { danger: true }));
    }
  }

  // Install / connect options not yet present.
  const presentNames = new Set(pres.found.map(f => f.name.toLowerCase()));
  const presentTypes = new Set(pres.found.map(f => f.type));
  const appPresent = prof.kind === 'app' && pres.found.some(f => ['app', 'cask', 'winget', 'flatpak', 'scoop'].includes(f.type));
  for (const o of prof.options) {
    if (!o.supported_here) continue;
    let a = null;
    if (o.method === 'plugin') { if (presentTypes.has('plugin') && [...presentNames].some(n => n.split('@')[0] === o.plugin.toLowerCase())) continue; a = op(o.label === 'Claude Code plugin' ? 'Install plugin in Claude Code' : `Install plugin ${o.plugin}`, 'plugin.install', { marketplace: o.marketplace, plugin: o.plugin, resource_id: id }); }
    else if (o.method === 'skill') { if (presentNames.has(o.name.toLowerCase())) continue; a = op(`Install skill ${o.name}`, 'skill.install', { repo: o.repo, path: o.path, name: o.name, resource_id: id }, { group: 'skills', description: o.description, scripts: o.has_scripts }); }
    else if (o.method === 'mcp' && o.shared && registeredMcp().has(o.name)) continue;
    else if (o.method === 'mcp') { if (pres.found.some(f => f.type === 'mcp' && f.agent === 'claude-code' && (!o.name || f.name === o.name))) continue; a = op(/^Give /.test(o.label || '') ? o.label : pres.found.some(f => f.type === 'mcp') ? `Add to Claude Code: ${o.label}` : `Enable in Claude Code: ${o.label}`, 'mcp.add', { resource_id: id, option_id: o.id }, { secrets: o.secrets, auth: o.auth || null, setup: o.setup || null }); }
    else if (o.method === 'package') { if (appPresent && ['cask', 'winget', 'flatpak', 'scoop'].includes(o.manager)) continue; if (presentTypes.has(o.manager) || (['uv', 'pipx'].includes(o.manager) && (presentTypes.has('uv') || presentTypes.has('pipx') || presentTypes.has('pip')))) continue; a = op(`Install with ${MANAGERS[o.manager]?.label || o.manager}`, 'package.install', { manager: o.manager, name: o.name, version: o.version || null, from: o.from || null, resource_id: id, evidence: o.evidence }, { sub: o.label }); }
    else if (o.method === 'download') { if (appPresent) continue; a = open(o.label || 'Download', o.url, { hint: 'Assisted install: the official installer opens in your browser.' }); actions.assist.push(a); continue; }
    if (!a) continue;
    a.evidence = o.evidence;
    a.shared = Boolean(o.shared);
    if (!o.ready) {
      a.disabled = true;
      a.missing = o.missing.map(m => PREREQ_LABEL[m] || m);
      const fix = o.missing.map(m => PREREQ[m]?.[OS]).filter(Boolean)[0];
      if (fix && (ctx.managers[fix.manager]?.available)) a.prereq = op(`Install ${PREREQ_LABEL[o.missing[0]]} first`, 'package.install', { manager: fix.manager, name: fix.name, publisher: 'homebrew' });
    }
    actions.install.push(a);
  }
  const ready = actions.install.filter(a => !a.disabled && !a.shared);
  // Primary: what most people want next for this kind in this state.
  if (pres.state === 'account' && ready.length) actions.primary = ready.find(a => a.op.kind !== 'skill.install') || null;
  else if (!pres.state) actions.primary = ready.find(a => a.op.kind === 'plugin.install') || ready.find(a => a.op.kind === 'mcp.add') || ready.find(a => a.op.kind === 'package.install') || (ready.length === 1 ? ready[0] : null);
  else if (pres.state === 'configured' && ready.some(a => a.op.kind === 'package.install')) actions.primary = null;
  actions.docs.push(open('Documentation', prof.docs));
  if (r.gh_full_name) actions.docs.push(open('Repository', `https://github.com/${r.gh_full_name}`));
  else if (r.canonical_url !== prof.docs) actions.docs.push(open('Website', r.canonical_url));

  const alternatives = alternativesFor(db, r, prof);
  return { resource: r, mine: marksFor(db, id), profile: prof, presence: pres, state, actions, alternatives, facts: summarizeFacts(facts), device: { os: OS, scanned_at: getPref(db, 'last_system_scan', null)?.scanned_at || null } };
}

export function summarizeFacts(f) {
  if (!f) return null;
  return { source: f.source, inspected_at: f.inspected_at, reachable: f.reachable, stars: f.stars ?? null, license: f.license ?? null, pushed_at: f.pushed_at ?? null, archived: f.archived ?? false, language: f.language ?? null,
    latest_release: f.latest_release ? { tag: f.latest_release.tag, published_at: f.latest_release.published_at } : null, packages: Object.fromEntries(Object.entries(f.packages || {}).map(([k, v]) => [k, v.map(x => ({ name: x.name, version: x.version }))])),
    skills: (f.skills || []).filter(s => !s.internal).length, internal_skills: (f.skills || []).filter(s => s.internal).length, plugins: f.marketplace?.plugins?.length || (f.plugin ? 1 : 0), mcp_registry: Boolean(f.mcp_registry),
    requires_python: f.pyproject?.requires_python || (f.packages?.pypi || [])[0]?.requires_python || null, engines: f.package_json?.engines || null, json_output: f.mentions?.json_output || false, title: f.title || null, description: f.description || null };
}

// Alternatives share capabilities and kind family; installed ones first, then the best verified.
export function alternativesFor(db, r, prof, limit = 6) {
  const caps = db.prepare('SELECT capability_id FROM resource_capabilities WHERE resource_id=?').all(r.id).map(x => x.capability_id);
  if (!caps.length) return [];
  const rows = db.prepare(`SELECT r.id, r.name, r.type, r.status, r.description, COUNT(*) shared FROM resource_capabilities rc JOIN resources r ON r.id=rc.resource_id
    WHERE rc.capability_id IN (${caps.map(() => '?').join(',')}) AND r.id<>? AND r.status NOT IN ('REJECTED','DEPRECATED') GROUP BY r.id ORDER BY shared DESC, (r.status IN ('INSTALLED','CONFIGURED')) DESC, r.last_verified DESC LIMIT 40`).all(...caps, r.id);
  const related = new Set(prof.related || []);
  return rows.map(x => ({ ...x, kind: profileFor(db, x.id)?.kind, related: related.has(x.id), overlap: x.shared / caps.length }))
    .filter(x => x.related || x.overlap >= 0.5)
    .sort((a, b) => (b.related - a.related) || (b.overlap - a.overlap))
    .slice(0, limit);
}
