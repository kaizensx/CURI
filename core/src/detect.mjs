// Environment detection: what is actually installed, configured or connected on this device —
// whether or not CURI put it there — matched to registry resources. Read-only probes through the
// platform layer (executables, apps, package managers) and the agents layer (Claude Code, Claude
// Desktop and the claude.ai account mirror, Codex, Cursor, Gemini CLI, Windsurf, VS Code).
// Registry status changes only between detection-owned states; manual decisions are never touched.
import fs from 'node:fs';
import path from 'node:path';
import { CORE_ROOT } from './paths.mjs';
import { now, tx, setPref, getPref } from './db.mjs';
import { audit } from './audit-log.mjs';
import { indexResource } from './registry.mjs';
import { OS, MANAGERS, which, run, versionOf, installedApps, appVersion, packageManagers, pythonPackages, deviceInfo } from './platform.mjs';
import { inspectAgents } from './agents.mjs';
import { getFacts, deviceContext } from './facts.mjs';
import { profile } from './profile.mjs';

const DETECTION_OWNED = ['CATALOGUED', 'NEEDS_VERIFICATION', 'ON_DEMAND', 'INSTALLED', 'CONFIGURED'];
export const LOCAL_TYPES = new Set(['bin', 'app', 'brew', 'cask', 'pip', 'npm', 'uv', 'pipx', 'cargo', 'winget', 'scoop', 'flatpak', 'skill', 'dir', 'env']);
const GENERIC = new Set(['cli', 'app', 'run', 'server', 'mcp', 'main', 'test', 'dev', 'start', 'build', 'index', 'tool', 'tools', 'agent', 'skills', 'review', 'code-review', 'debug', 'docs', 'help', 'setup', 'init', 'install', 'python', 'node', 'git', 'time', 'fetch', 'memory', 'search', 'browser', 'design', 'frontend-design', 'testing', 'security']);
export const detectors = () => JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'data', 'detectors.json'), 'utf8')).resources;

// Same name is not enough for skills: the description must also agree when both are known.
const words = t => new Set(String(t || '').toLowerCase().match(/[a-z0-9]{4,}/g) || []);
export function similar(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return null;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}
const stripVer = t => t.replace(/^(@?[^@=\s]+)(?:@[^/\s]*|==.*)$/, '$1').toLowerCase();
const tokensOf = line => String(line || '').split(/[\s"'=,]+/).filter(Boolean).flatMap(t => [stripVer(t), stripVer(t.split('/').pop())]);

// Matching signals per resource, from hand-written probes plus inspected facts and the profile.
function buildIndex(db, ctx) {
  const det = detectors();
  const rows = db.prepare('SELECT * FROM resources').all();
  const idx = new Map();
  const claims = { bin: new Map(), skill: new Map(), plugin: new Map() };
  const descs = new Map();
  const claim = (kind, key, id, desc) => { if (!key || key.length < 3 || GENERIC.has(key)) return; const s = claims[kind].get(key) || new Set(); s.add(id); claims[kind].set(key, s); if (desc) descs.set(`${kind}:${key}`, desc); };
  for (const r of rows) {
    const f = getFacts(db, r.id);
    const p = profile(r, f, ctx);
    const sig = { probes: det[r.id] || [], pkgs: { npm: new Set(), pip: new Set(), brew: new Set(), cask: new Set(), cargo: new Set(), winget: new Set(), flatpak: new Set(), uv: new Set(), pipx: new Set(), scoop: new Set() }, mcpTokens: new Set(), mcpUrls: new Set(), marketplaces: new Set() };
    for (const x of f?.packages?.npm || []) { sig.pkgs.npm.add(x.name); for (const b of x.bin || []) claim('bin', b, r.id); }
    for (const x of f?.packages?.pypi || []) { const n = x.name.toLowerCase(); sig.pkgs.pip.add(n); sig.pkgs.uv.add(n); sig.pkgs.pipx.add(n); }
    for (const x of f?.packages?.brew || []) sig.pkgs.brew.add(x.name);
    for (const x of f?.packages?.cask || []) sig.pkgs.cask.add(x.name);
    for (const x of f?.packages?.crates || []) sig.pkgs.cargo.add(x.name);
    for (const b of [...(f?.pyproject?.scripts || []), ...(f?.cargo?.bins || [])]) claim('bin', b, r.id);
    for (const o of p.options) {
      if (o.method === 'package' && sig.pkgs[o.manager]) sig.pkgs[o.manager].add(o.manager === 'uv' || o.manager === 'pipx' ? o.name.toLowerCase() : o.name);
      if (o.method === 'package' && (o.manager === 'uv' || o.manager === 'pipx')) sig.pkgs.pip.add(o.name.toLowerCase());
      if (o.method === 'mcp' && !o.shared) {
        if (o.url) sig.mcpUrls.add(o.url.replace(/\/$/, '').toLowerCase());
        const pkg = (o.args || []).find(a => !a.startsWith('-') && a !== 'mcp' && a !== 'run');
        if (pkg && !['npx', 'uvx', 'docker'].includes(pkg)) sig.mcpTokens.add(stripVer(pkg));
        if (o.command && !['npx', 'uvx', 'docker', 'node', 'python', 'python3'].includes(o.command)) sig.mcpTokens.add(o.command.toLowerCase());
      }
    }
    for (const x of f?.packages?.npm || []) if (/mcp/i.test(x.name)) sig.mcpTokens.add(x.name.toLowerCase());
    for (const x of f?.mcp_registry?.packages || []) if (x.identifier) sig.mcpTokens.add(x.identifier.toLowerCase());
    if (f?.marketplace?.name) sig.marketplaces.add(f.marketplace.name);
    for (const pl of f?.marketplace?.plugins || []) claim('plugin', pl.name, r.id);
    if (f?.plugin?.name) claim('plugin', f.plugin.name, r.id);
    for (const s of (f?.skills || []).filter(s => !s.internal)) claim('skill', s.name, r.id, s.description);
    idx.set(r.id, { r, sig, kind: p.kind });
  }
  // A name only identifies a resource when exactly one resource claims it.
  const unique = kind => new Map([...claims[kind]].filter(([, s]) => s.size === 1).map(([k, s]) => [k, [...s][0]]));
  return { idx, bins: unique('bin'), skills: unique('skill'), plugins: unique('plugin'), descs };
}

export async function scanSystem(db, { onStage = () => {}, cancelled = () => false } = {}) {
  const ts = now();
  const device = deviceInfo();
  onStage('A identificar gestores de pacotes', 0.04);
  const managers = await packageManagers();
  const ctx = { managers, runtimes: deviceContext(db).runtimes };
  onStage('A preparar a correspondência com o catálogo', 0.08);
  const { idx, bins: binClaims, skills: skillClaims, plugins: pluginClaims, descs } = buildIndex(db, ctx);
  // Account skills need positive description evidence; local skill folders may lack a description.
  const skillId = (s, strict = false) => { const id = skillClaims.get(s.name); if (!id) return null; const sim = similar(s.description, descs.get(`skill:${s.name}`)); return (sim === null && !strict) || sim >= 0.3 ? id : null; };

  onStage('A procurar ferramentas de linha de comando', 0.12);
  const probeBins = new Set([...idx.values()].flatMap(x => x.sig.probes.filter(p => p.bin).map(p => p.bin)));
  for (const b of binClaims.keys()) probeBins.add(b);
  const RUNTIME_BINS = ['node', 'python3', 'python', 'git', 'uv', 'cargo', 'docker', 'brew', 'npm', 'go', 'java', 'ffmpeg', 'rea', 'codex', 'gh'];
  for (const b of RUNTIME_BINS) probeBins.add(b);
  const bins = new Map();
  let i = 0;
  for (const b of probeBins) {
    if (cancelled()) return { cancelled: true };
    const p = which(b);
    if (p) bins.set(b, { path: p, version: null });
    if (++i % 40 === 0) onStage(`Ferramentas de linha de comando (${i}/${probeBins.size})`, 0.12 + 0.16 * (i / probeBins.size));
  }
  const binVersion = async b => { const e = bins.get(b); if (!e) return null; if (e.version === null) { const probe = [...idx.values()].flatMap(x => x.sig.probes).find(x => x.bin === b); e.version = versionOf(await run(e.path, probe?.args || ['--version'], 5000)) || ''; } return e.version || null; };

  onStage('A listar aplicações', 0.3);
  const apps = await installedApps();
  if (cancelled()) return { cancelled: true };

  const lists = {};
  const mgrs = Object.entries(MANAGERS).filter(([k]) => managers[k]?.available);
  for (const [n, [k, m]] of mgrs.entries()) {
    onStage(`A consultar ${m.label}`, 0.36 + 0.24 * (n / Math.max(1, mgrs.length)));
    lists[k] = await m.list(managers[k].path).catch(() => new Map());
    managers[k].count = lists[k].size;
    if (cancelled()) return { cancelled: true };
  }
  onStage('A consultar pacotes Python', 0.62);
  const pip = await pythonPackages();

  onStage('A ler agentes: Claude Code, Claude Desktop, Codex, Cursor…', 0.7);
  const agents = await inspectAgents();
  if (cancelled()) return { cancelled: true };

  onStage('A associar ao catálogo', 0.86);
  const byId = new Map();
  const claimedMcp = new Set(), claimedSkill = new Set(), claimedPlugin = new Set(), claimedApp = new Set();
  const mcpFound = (a, m) => ({ type: 'mcp', name: m.name, agent: a.id, agent_label: a.label, scope: m.scope, enabled: m.enabled, detail: m.line.slice(0, 200) });
  for (const [id, { sig }] of idx) {
    const found = [];
    for (const p of sig.probes) {
      if (p.bin && bins.has(p.bin)) found.push({ type: 'bin', name: p.bin, version: await binVersion(p.bin), path: bins.get(p.bin).path });
      if (p.app && apps.has(p.app)) { claimedApp.add(p.app); found.push({ type: 'app', name: p.app, version: await appVersion(apps.get(p.app)), path: apps.get(p.app).path }); }
      if (p.brew && lists.brew?.has(p.brew)) found.push({ type: 'brew', name: p.brew, version: lists.brew.get(p.brew) });
      if (p.cask && lists.cask?.has(p.cask)) found.push({ type: 'cask', name: p.cask, version: lists.cask.get(p.cask) });
      if (p.pip && pip.pkgs.has(p.pip)) found.push({ type: 'pip', name: p.pip, version: pip.pkgs.get(p.pip).version, path: pip.pkgs.get(p.pip).python });
      if (p.npm && lists.npm?.has(p.npm)) found.push({ type: 'npm', name: p.npm, version: lists.npm.get(p.npm) });
      if (p.mcp) for (const a of agents) for (const m of a.mcp) if (new RegExp(p.mcp).test(m.line)) { claimedMcp.add(`${a.id}:${m.name}`); found.push(mcpFound(a, m)); }
      if (p.env && process.env[p.env]) found.push({ type: 'env', name: p.env });
      if (p.dir && fs.existsSync(p.dir.replace(/^~/, process.env.HOME || ''))) found.push({ type: 'dir', name: p.dir });
      if (p.claude) { const cc = agents.find(a => a.id === 'claude-code'); if (cc?.binary) found.push({ type: 'bin', name: 'claude', version: versionOf(await run(cc.binary, ['--version'])), path: cc.binary }); }
    }
    for (const [mgr, names] of Object.entries(sig.pkgs)) for (const n of names) {
      if (mgr === 'pip') { if (pip.pkgs.has(n)) found.push({ type: 'pip', name: n, version: pip.pkgs.get(n).version, path: pip.pkgs.get(n).python }); }
      else if (lists[mgr]?.has(n)) found.push({ type: mgr, name: n, version: lists[mgr].get(n) });
    }
    for (const a of agents) for (const m of a.mcp) {
      const url = (m.url || '').replace(/\/$/, '').toLowerCase();
      if ((url && sig.mcpUrls.has(url)) || tokensOf(m.line).some(t => sig.mcpTokens.has(t))) { claimedMcp.add(`${a.id}:${m.name}`); found.push(mcpFound(a, m)); }
    }
    byId.set(id, found);
  }
  // Name-based claims (unique names only): skills, plugins and claude.ai account skills.
  const byRepo = new Map([...idx.values()].filter(x => x.r.gh_full_name).map(x => [x.r.gh_full_name.toLowerCase(), x.r.id]));
  for (const a of agents) {
    for (const s of a.skills) {
      const id = (s.repo && byRepo.get(s.repo.toLowerCase())) || skillId(s);
      if (id) { claimedSkill.add(`${a.id}:${s.name}`); byId.get(id).push({ type: 'skill', name: s.name, agent: a.id, agent_label: a.label, scope: s.scope, managed_by: s.managed_by, path: s.path, version: s.commit?.slice(0, 7) || null }); }
    }
    for (const s of a.account_skills || []) {
      const id = skillId(s, true);
      if (id) { claimedSkill.add(`${a.id}:${s.name}`); byId.get(id).push({ type: 'account-skill', name: s.name, agent: 'claude-account', agent_label: 'Conta claude.ai', enabled: s.enabled, managed_by: 'account' }); }
    }
    for (const pl of a.plugins) {
      const id = [...idx.values()].find(x => pl.marketplace && x.sig.marketplaces.has(pl.marketplace))?.r.id || pluginClaims.get(pl.name);
      if (id) { claimedPlugin.add(pl.id); byId.get(id).push({ type: 'plugin', name: pl.id, agent: a.id, agent_label: a.label, version: pl.version, scope: pl.scope, enabled: pl.enabled, managed_by: pl.managed_by }); }
    }
  }
  const results = [...byId].filter(([, f]) => f.length).map(([id, found]) => { const d = dedupe(found); return { id, found: d, state: stateOf(d) }; });

  // Apply: detection-owned states only; manual decisions (REJECTED, DEPRECATED, …) are left alone.
  const changes = { installed: [], configured: [], removed: [] };
  tx(db, () => {
    const prev = new Set(db.prepare("SELECT DISTINCT resource_id FROM installed_instances WHERE health='detected' AND resource_id IS NOT NULL").all().map(r => r.resource_id));
    db.prepare("DELETE FROM installed_instances WHERE health='detected'").run();
    const ins = db.prepare(`INSERT INTO installed_instances(resource_id,name,kind,scope,path,managed_by_curi,checksum,health,details,observed_at) VALUES (?,?,?,?,?,0,NULL,'detected',?,?)
      ON CONFLICT(kind,scope,name) DO UPDATE SET resource_id=excluded.resource_id, path=excluded.path, details=excluded.details, observed_at=excluded.observed_at, health=CASE WHEN installed_instances.managed_by_curi=1 THEN installed_instances.health ELSE 'detected' END`);
    for (const m of results) {
      const r = db.prepare('SELECT id, status FROM resources WHERE id=?').get(m.id);
      if (!r) continue;
      for (const f of m.found) ins.run(m.id, f.name, `detected:${f.type}`, [f.agent, f.scope].filter(Boolean).join(':') || 'system', f.path || null, JSON.stringify({ version: f.version || null, detail: f.detail || null, enabled: f.enabled ?? null, agent: f.agent || null, agent_label: f.agent_label || null, managed_by: f.managed_by || null }), ts);
      const next = m.state === 'installed' ? 'INSTALLED' : 'CONFIGURED';
      if (DETECTION_OWNED.includes(r.status) && r.status !== next) {
        db.prepare('UPDATE resources SET status=?, updated_at=? WHERE id=?').run(next, ts, m.id);
        (next === 'INSTALLED' ? changes.installed : changes.configured).push(m.id);
      }
      const summary = m.found.slice(0, 6).map(f => `${f.type} ${f.name}${f.version ? ` ${f.version}` : ''}${f.agent_label ? ` (${f.agent_label})` : ''}`).join(' · ');
      const text = `Encontrado neste dispositivo: ${summary}`;
      const last = db.prepare("SELECT summary FROM evidence WHERE resource_id=? AND kind='detection' ORDER BY id DESC LIMIT 1").get(m.id);
      if (last?.summary !== text) db.prepare('INSERT INTO evidence(resource_id,kind,class,summary,data,captured_at) VALUES (?,?,?,?,?,?)').run(m.id, 'detection', 'original', text, JSON.stringify(m.found), ts);
      prev.delete(m.id);
      indexResource(db, m.id);
    }
    for (const id of prev) {
      const r = db.prepare('SELECT status FROM resources WHERE id=?').get(id);
      if (r && ['INSTALLED', 'CONFIGURED'].includes(r.status) && !db.prepare('SELECT 1 FROM installed_instances WHERE resource_id=? AND managed_by_curi=1').get(id)) {
        db.prepare("UPDATE resources SET status='CATALOGUED', updated_at=? WHERE id=?").run(ts, id);
        db.prepare('INSERT INTO evidence(resource_id,kind,class,summary,captured_at) VALUES (?,?,?,?,?)').run(id, 'detection', 'original', 'Já não foi encontrado neste dispositivo.', ts);
        changes.removed.push(id);
      }
    }
  });

  const runtimes = {};
  for (const b of ['node', 'git', 'uv', 'cargo', 'docker', 'go', 'java', 'brew']) runtimes[b === 'brew' ? 'homebrew' : b] = bins.has(b) ? (await binVersion(b)) || 'presente' : null;
  const py = bins.get('python3') || bins.get('python');
  runtimes.python3 = py ? versionOf(await run(py.path, ['--version'])) : null;
  const cc = agents.find(a => a.id === 'claude-code');
  runtimes.claude = cc?.binary ? versionOf(await run(cc.binary, ['--version'])) : null;
  if (OS === 'macos') runtimes.xcode = apps.has('Xcode') ? await appVersion(apps.get('Xcode')) : null;

  const knownApps = new Set([...idx.values()].flatMap(x => x.sig.probes.filter(p => p.app).map(p => p.app)));
  const report = {
    scanned_at: ts, device, managers, runtimes,
    binaries: Object.fromEntries([...bins].filter(([b]) => RUNTIME_BINS.includes(b)).map(([b, v]) => [b, v.path])),
    agents: agents.map(a => ({ id: a.id, label: a.label, present: a.present, config: a.config, writable: a.writable, manage: a.manage, notes: a.notes,
      counts: { mcp: a.mcp.length, skills: a.skills.length, plugins: a.plugins.length, account_skills: (a.account_skills || []).length },
      mcp: a.mcp.map(m => ({ ...m, matched: claimedMcp.has(`${a.id}:${m.name}`) })),
      skills: a.skills.map(s => ({ name: s.name, description: s.description, scope: s.scope, managed_by: s.managed_by, repo: s.repo, matched: claimedSkill.has(`${a.id}:${s.name}`) })),
      plugins: a.plugins.map(p => ({ ...p, matched: claimedPlugin.has(p.id) })),
      account_skills: (a.account_skills || []).map(s => ({ name: s.name, description: s.description, enabled: s.enabled, origin: s.origin, matched: claimedSkill.has(`${a.id}:${s.name}`) })) })),
    matched: results.map(m => ({ ...m, name: idx.get(m.id)?.r.name || m.id, kind: idx.get(m.id)?.kind })),
    sources: { executables_checked: probeBins.size, executables_found: bins.size, apps: apps.size, packages: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.size])), pip_packages: pip.pkgs.size, pythons: pip.pythons, agents: agents.filter(a => a.present).length },
    not_in_catalog: { apps: [...apps.keys()].filter(a => !claimedApp.has(a) && !knownApps.has(a)).sort(), npm_global: [...(lists.npm?.keys() || [])].filter(n => ![...idx.values()].some(x => x.sig.pkgs.npm.has(n))) },
    changes,
  };
  setPref(db, 'last_system_scan', report);
  audit(db, 'system', 'system.scan', null, { matched: results.length, agents: report.sources.agents, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.length])) });
  onStage('Concluído', 1);
  return report;
}

// installed: something local exists · configured: only agent configuration (MCP/plugin) · account: only claude.ai
export function stateOf(found) {
  if (found.some(f => LOCAL_TYPES.has(f.type) && f.managed_by !== 'account')) return 'installed';
  if (found.some(f => ['mcp', 'plugin'].includes(f.type) && f.managed_by !== 'account')) return 'configured';
  return 'account';
}

function dedupe(found) {
  const seen = new Set();
  return found.filter(f => { const k = `${f.type}:${f.name}:${f.agent || ''}:${f.scope || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export const lastScan = db => getPref(db, 'last_system_scan', null);
