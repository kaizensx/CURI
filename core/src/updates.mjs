// What CURI installed that has a newer version: skills whose repository moved on, plugins whose
// marketplace lists a newer version, and npm/Homebrew tools with a newer release. Only reads; every
// update it finds comes with the operation that applies it, which goes through the usual policy.
import { getPref, setPref, now } from './db.mjs';
import { lsRemote } from './github.mjs';
import { MANAGERS, OS, run, which } from './platform.mjs';

const HEX = /^[0-9a-f]{7,40}$/i;
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const short = v => (HEX.test(v || '') ? v.slice(0, 7) : v);

async function marketplaceEntry(repo, name) {
  if (!REPO.test(repo || '')) return null;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/.claude-plugin/marketplace.json`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return (await res.json()).plugins?.find(p => p.name === name) || null;
  } catch { return null; }
}

// A marketplace entry without a version: the plugin's own manifest has it.
async function pluginManifestVersion(repo, source) {
  if (!REPO.test(repo || '') || (source != null && typeof source !== 'string')) return null;
  const dir = String(source || '.').replace(/^\.\/?/, '').replace(/\/$/, '');
  if (dir.includes('..')) return null;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${dir ? `${dir}/` : ''}.claude-plugin/plugin.json`, { signal: AbortSignal.timeout(15000) });
    return res.ok ? (await res.json()).version || null : null;
  } catch { return null; }
}

// Latest published version of a package, for the managers that can say it without installing.
async function latestPackage(manager, name) {
  const m = MANAGERS[manager];
  if (!m?.os.includes(OS)) return null;
  const bin = which(m.bin);
  if (!bin) return null;
  if (manager === 'npm') return (await run(bin, ['view', name, 'version'], 20000))?.trim() || null;
  if (manager === 'brew' || manager === 'cask') {
    try {
      const j = JSON.parse(await run(bin, ['info', '--json=v2', ...(manager === 'cask' ? ['--cask'] : []), name], 30000) || '{}');
      return j.formulae?.[0]?.versions?.stable || j.casks?.[0]?.version || null;
    } catch { return null; }
  }
  return null;
}

export async function checkUpdates(db) {
  const items = [];
  const rows = kind => db.prepare(`SELECT name, kind, checksum, details, resource_id FROM installed_instances WHERE managed_by_curi=1 AND ${kind}`).all();

  for (const s of rows("kind='skill'")) {
    const d = JSON.parse(s.details || '{}');
    if (!d.repo || s.name === 'curi-resource-router') continue;
    const ls = await lsRemote(`https://github.com/${d.repo}.git`).catch(() => null);
    if (ls?.exists && ls.head && s.checksum && ls.head !== s.checksum) items.push({ kind: 'skill', name: s.name, resource_id: s.resource_id, current: short(s.checksum), latest: short(ls.head),
      op: { kind: 'skill.install', params: { repo: d.repo, path: d.path, name: s.name, resource_id: s.resource_id, update: true } } });
  }

  for (const p of rows("kind='plugin'")) {
    const d = JSON.parse(p.details || '{}');
    const [plugin] = p.name.split('@');
    const entry = await marketplaceEntry(d.marketplace, plugin);
    // Plugins without a version number are versioned by the commit they were installed from.
    const latest = HEX.test(d.version || '') ? (await lsRemote(`https://github.com/${d.marketplace}.git`).catch(() => null))?.head || null
      : entry?.version || await pluginManifestVersion(d.marketplace, entry?.source);
    const same = !latest || !d.version || (HEX.test(d.version) ? latest.startsWith(d.version) || d.version.startsWith(latest) : latest === d.version);
    if (!same) items.push({ kind: 'plugin', name: plugin, full: p.name, resource_id: p.resource_id, current: short(d.version), latest: short(latest), op: { kind: 'plugin.update', params: { plugin: p.name } } });
  }

  for (const p of rows("kind LIKE 'package:%'")) {
    const manager = p.kind.slice(8);
    const current = JSON.parse(p.details || '{}').version || null;
    const latest = await latestPackage(manager, p.name);
    if (latest && current && latest !== current) items.push({ kind: 'package', manager, name: p.name, resource_id: p.resource_id, current, latest,
      op: { kind: 'package.upgrade', params: { manager, name: p.name, resource_id: p.resource_id } } });
  }

  const result = { checked_at: now(), items };
  setPref(db, 'updates_last', result);
  return result;
}

export const lastUpdates = db => getPref(db, 'updates_last', null);
