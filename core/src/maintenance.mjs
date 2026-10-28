// Autonomous maintenance: the plan of routine work CURI does on its own. Each task is checked against
// the autonomy policy *before* it is queued: work the current mode covers runs unattended; work that
// would need approval is listed as a suggestion instead of piling up approval requests. Runs from
// the background service and from the app's worker. Never installs anything new on its own.
import { getPref, setPref, now } from './db.mjs';
import { enqueue, preview } from './operations.mjs';
import { lsRemote } from './github.mjs';
import { claudeJsonPath } from './paths.mjs';
import { OS } from './platform.mjs';
import fs from 'node:fs';

export const TASKS = {
  scan: { label: 'Detect what\'s installed across all agents', every: 'auto_scan_hours', default: 6 },
  verify: { label: 'Check that catalogue sources are still available', every: 'auto_verify_hours', default: 24 },
  repair: { label: 'Repair CURI\'s MCP servers that disappeared from the configuration', every: 'auto_repair_hours', default: 6 },
  update_skills: { label: 'Update skills CURI installed when their repository changes', every: 'auto_update_hours', default: 24 },
  update_plugins: { label: 'Update plugins CURI installed', every: 'auto_update_hours', default: 24 },
  update_packages: { label: 'Update tools CURI installed (Homebrew, npm, uv…)', every: 'auto_package_update_hours', default: 168 },
  discover: { label: 'Look for relevant new projects on GitHub', every: 'auto_discover_hours', default: 0 },
  stars: { label: 'Review your GitHub stars', every: 'auto_stars_hours', default: 0 },
};

const due = (db, key, hours) => {
  if (!hours) return false;
  const last = getPref(db, `last_${key}`, null);
  return !last || Date.now() - new Date(last).getTime() > hours * 3600e3;
};
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

async function onBattery() {
  if (OS !== 'macos') return false;
  try { const { execFileSync } = await import('node:child_process'); return /Battery Power/.test(execFileSync('/usr/bin/pmset', ['-g', 'batt']).toString()); } catch { return false; }
}

// Candidate work for this pass (kind, params, label), before policy.
async function candidates(db, { force = false } = {}) {
  const out = [];
  const hours = k => getPref(db, TASKS[k].every, TASKS[k].default);
  const want = k => force || due(db, k, hours(k));
  if (want('scan')) out.push({ task: 'scan', kind: 'system.scan', params: {}, label: TASKS.scan.label });
  if (want('verify')) out.push({ task: 'verify', kind: 'sources.verify', params: { limit: 40 }, label: TASKS.verify.label });
  if (want('repair')) {
    const registered = readJson(claudeJsonPath())?.mcpServers || {};
    for (const d of db.prepare('SELECT name FROM mcp_definitions WHERE enabled=1').all()) if (!registered[d.name]) out.push({ task: 'repair', kind: 'mcp.enable', params: { name: d.name, repair: true }, label: `Repair the ${d.name} MCP server` });
  }
  if (want('update_skills')) {
    for (const s of db.prepare("SELECT name, checksum, details, resource_id FROM installed_instances WHERE kind='skill' AND managed_by_curi=1").all()) {
      const d = JSON.parse(s.details || '{}');
      if (!d.repo || s.name === 'curi-resource-router') continue;
      const ls = await lsRemote(`https://github.com/${d.repo}.git`).catch(() => null);
      if (ls?.exists && ls.head && ls.head !== s.checksum) out.push({ task: 'update_skills', kind: 'skill.install', params: { repo: d.repo, path: d.path, name: s.name, resource_id: s.resource_id, update: true }, label: `Update the ${s.name} skill (${s.checksum?.slice(0, 7)} → ${ls.head.slice(0, 7)})` });
    }
  }
  if (want('update_plugins')) for (const p of db.prepare("SELECT name FROM installed_instances WHERE kind='plugin' AND managed_by_curi=1").all()) out.push({ task: 'update_plugins', kind: 'plugin.update', params: { plugin: p.name }, label: `Update the ${p.name} plugin` });
  if (want('update_packages')) for (const p of db.prepare("SELECT name, kind, resource_id FROM installed_instances WHERE kind LIKE 'package:%' AND managed_by_curi=1").all()) out.push({ task: 'update_packages', kind: 'package.upgrade', params: { manager: p.kind.slice(8), name: p.name, resource_id: p.resource_id }, label: `Update ${p.name}` });
  if (want('discover')) {
    out.push({ task: 'discover', kind: 'discover', params: { mode: 'frontier', maxQueries: 6 }, label: TASKS.discover.label });
    // The user's saved searches marked "automatic" run too, one per pass (oldest first).
    const saved = getPref(db, 'saved_searches', []).filter(x => x.auto).sort((a, b) => (a.last || '').localeCompare(b.last || ''));
    if (saved[0]) { out.push({ task: 'discover', kind: 'discover', params: { mode: 'task', intent: saved[0].intent }, label: `Saved search: ${saved[0].intent}` }); saved[0].last = new Date().toISOString(); setPref(db, 'saved_searches', getPref(db, 'saved_searches', []).map(x => (x.intent === saved[0].intent ? saved[0] : x))); }
  }
  if (want('stars') && db.prepare("SELECT 1 FROM connections WHERE provider='github' AND status='connected'").get()) out.push({ task: 'stars', kind: 'github.stars', params: {}, label: TASKS.stars.label });
  return out;
}

// One pass: queue what policy covers, keep the rest as suggestions. Returns what happened.
export async function maintenancePass(db, { actor = 'agent', force = false } = {}) {
  if (getPref(db, 'pause_on_battery', true) && await onBattery()) return { skipped: 'On battery: maintenance postponed.', queued: [], suggestions: getPref(db, 'maintenance_suggestions', []) };
  const queued = [], suggestions = [];
  const doneTasks = new Set();
  for (const c of await candidates(db, { force })) {
    let p;
    try { p = await preview(db, c.kind, c.params); } catch (e) { suggestions.push({ ...c, reason: e.message, blocked: true }); continue; }
    if (p.decision === 'auto') {
      const op = await enqueue(db, c.kind, c.params, { actor });
      queued.push({ ...c, op: op.id });
    } else suggestions.push({ ...c, reason: p.reasons.at(-1), category: p.category, blocked: p.decision === 'block' });
    doneTasks.add(c.task);
  }
  for (const t of doneTasks) setPref(db, `last_${t}`, now());
  setPref(db, 'maintenance_suggestions', suggestions.slice(0, 30));
  setPref(db, 'last_maintenance', { at: now(), queued: queued.length, suggestions: suggestions.length });
  return { queued, suggestions };
}

export function maintenanceStatus(db) {
  return {
    tasks: Object.entries(TASKS).map(([id, t]) => ({ id, label: t.label, every_hours: getPref(db, t.every, t.default), pref: t.every, last: getPref(db, `last_${id}`, null) })),
    last: getPref(db, 'last_maintenance', null),
    suggestions: getPref(db, 'maintenance_suggestions', []),
  };
}
